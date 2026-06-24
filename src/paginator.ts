import { DOMParser } from "@b-fuze/deno-dom";
import type { AssetManifest, ExtractedPage, PaginationGroup } from "./types.ts";
import { rewriteInternalLinks, rewritePaths } from "./generator.ts";

type Element = NonNullable<ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>>["body"];

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Page-indicator query param names we strip to find the base URL of a group. */
const PAGE_PARAMS = ["page", "paged", "p", "pg"];

/**
 * Return a normalised base key for a URL by stripping pagination indicators:
 * - Query params: ?page=N, ?paged=N, ?p=N, ?pg=N
 * - Path segments: /page/N/ or /N at the end (only for purely numeric segments)
 */
export function stripPageIndicator(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Strip query-based pagination
    for (const p of PAGE_PARAMS) u.searchParams.delete(p);
    // Strip path-based pagination: /page/N or trailing /N (purely numeric)
    u.pathname = u.pathname
      .replace(/\/page\/\d+\/?$/, "/")
      .replace(/\/\d+\/?$/, (match, offset, str) => {
        // Only strip if the preceding segment is not numeric (avoid stripping /blog/2021/)
        const prev = str.slice(0, offset);
        return /\/page\/$/.test(prev) ? "/" : match;
      });
    // Normalise trailing slash
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString().toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

/**
 * Derive a 1-based page number from a URL, or 1 if no indicator is found.
 */
export function pageNumber(rawUrl: string): number {
  try {
    const u = new URL(rawUrl);
    for (const p of PAGE_PARAMS) {
      const v = u.searchParams.get(p);
      if (v && /^\d+$/.test(v)) return parseInt(v, 10);
    }
    // Path-based: /page/N or trailing /N
    const m = u.pathname.match(/\/page\/(\d+)\/?$/) ?? u.pathname.match(/\/(\d+)\/?$/);
    if (m) return parseInt(m[1], 10);
  } catch { /* ignore */ }
  return 1;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function parseFragment(html: string): ReturnType<InstanceType<typeof DOMParser>["parseFromString"]> {
  return new DOMParser().parseFromString(
    `<html><body>${html}</body></html>`,
    "text/html",
  );
}

/**
 * Returns true when the HTML fragment contains a pagination nav signal:
 * - an element with class matching /pag(e|inat)/i, or
 * - a link with rel="next" or rel="prev"
 */
export function hasPaginationSignal(html: string): boolean {
  const doc = parseFragment(html);
  if (!doc) return false;
  if (doc.querySelector('[class*="paginat"], [class*="pagination"], nav[class*="pag"]')) return true;
  if (doc.querySelector('a[rel="next"], a[rel="prev"], link[rel="next"]')) return true;
  // Also look for any element whose class contains "pag"
  for (const el of doc.querySelectorAll("[class]")) {
    const cls = el.getAttribute("class") ?? "";
    if (/\bpag/i.test(cls)) return true;
  }
  return false;
}

/**
 * Find the "list container" element: the one with the most direct children
 * sharing the same tag, indicating a repeated-item list (cards, articles, etc.).
 * Requires at least 2 same-tag children.
 */
function findListContainer(doc: ReturnType<typeof parseFragment>): Element | null {
  if (!doc) return null;
  let best: Element | null = null;
  let bestScore = 1;

  for (const el of doc.querySelectorAll("ul, ol, div, section, article")) {
    const children = [...el.children];
    if (children.length < 2) continue;
    const firstTag = children[0].tagName;
    const sameTagCount = children.filter((c) => c.tagName === firstTag).length;
    if (sameTagCount > bestScore) {
      bestScore = sameTagCount;
      best = el as unknown as Element;
    }
  }

  return best;
}

/**
 * Derive a CSS selector from a list open tag, e.g. `<ul class="dreams-list">` → `ul.dreams-list`.
 * Uses the first class token for specificity.
 */
function selectorFromOpenTag(listOpenTag: string): string | null {
  const tagMatch = listOpenTag.match(/^<(\w+)/);
  if (!tagMatch) return null;
  const tagName = tagMatch[1].toLowerCase();
  const classMatch = listOpenTag.match(/class="([^"]+)"/);
  if (!classMatch) return tagName;
  const firstClass = classMatch[1].trim().split(/\s+/)[0];
  return firstClass ? `${tagName}.${firstClass}` : tagName;
}

/**
 * Extract direct children of the container identified by `selector` from the HTML fragment.
 * Falls back to the heuristic `findListContainer` if the selector yields nothing.
 * Unlike `findListContainer`, this accepts a container with only 1 child — necessary
 * for the last page of a paginated group which may have fewer items.
 */
export function extractItemsByHint(contentHtml: string, selector: string): string[] {
  const doc = parseFragment(contentHtml);
  if (!doc) return [];

  // Try the known selector first (from page 1 structure)
  const containerBySelector = selector ? doc.querySelector(selector) : null;
  const container = containerBySelector ?? findListContainer(doc);
  if (!container) return [];

  return [...(container as unknown as { children: Iterable<Element> }).children].map(
    (c) => (c as unknown as { outerHTML: string }).outerHTML,
  );
}

/**
 * Find a pagination nav element: a <nav> or element whose class matches /pag/i
 * that comes after the list container in document order.
 */
function findNavElement(
  doc: ReturnType<typeof parseFragment>,
  listContainer: Element,
): Element | null {
  if (!doc) return null;

  // Prefer a <nav> sibling or cousin after the list container
  const body = doc.querySelector("body");
  if (!body) return null;

  let foundList = false;
  for (const el of body.querySelectorAll("*")) {
    if (el === (listContainer as unknown)) foundList = true;
    if (!foundList) continue;
    if (el.tagName === "NAV" || /\bpag/i.test(el.getAttribute("class") ?? "")) {
      return el as unknown as Element;
    }
  }

  // Fallback: any nav-ish element anywhere
  return (doc.querySelector("nav") ?? null) as unknown as Element | null;
}

// ---------------------------------------------------------------------------
// Structure extraction
// ---------------------------------------------------------------------------

interface ListStructure {
  items: string[];
  listOpenTag: string;
  listCloseTag: string;
  navClass: string;
  prefix: string;
  suffix: string;
  size: number;
}

/**
 * Extract the paginated list structure from a page's contentHtml.
 * Returns null if no repeating list or pagination nav can be found.
 */
export function extractListStructure(contentHtml: string): ListStructure | null {
  const doc = parseFragment(contentHtml);
  if (!doc) return null;

  const listContainer = findListContainer(doc);
  if (!listContainer) return null;

  const navEl = findNavElement(doc, listContainer);

  // Collect item HTML strings from the list container's direct children
  const items = [...(listContainer as unknown as { children: Iterable<Element> }).children].map(
    (c) => (c as unknown as { outerHTML: string }).outerHTML,
  );
  if (items.length < 2) return null;

  // Build the list open/close tags with original attributes
  const lc = listContainer as unknown as {
    tagName: string;
    attributes: Iterable<{ name: string; value: string }>;
    outerHTML: string;
  };
  const tagName = lc.tagName.toLowerCase();
  const attrs = [...lc.attributes]
    .map((a) => ` ${a.name}="${a.value}"`)
    .join("");
  const listOpenTag = `<${tagName}${attrs}>`;
  const listCloseTag = tagName;

  // Nav class
  const navClass = (navEl as unknown as { getAttribute: (n: string) => string | null } | null)
    ?.getAttribute("class") ?? "pagination-nav";

  // Prefix / suffix via marker substitution
  const MARKER_LIST = "<!--MISTO-LIST-->";
  const MARKER_NAV = "<!--MISTO-NAV-->";

  (listContainer as unknown as { outerHTML: string; parentNode: { innerHTML: string } });
  // Replace list container content with a marker, keeping the open/close tags
  (listContainer as unknown as { innerHTML: string }).innerHTML = MARKER_LIST;
  if (navEl) {
    (navEl as unknown as { outerHTML: string });
    // Replace the whole nav element with a marker using its parent
    const navParent = (navEl as unknown as { parentNode: { innerHTML: string } }).parentNode;
    if (navParent) {
      navParent.innerHTML = navParent.innerHTML.replace(
        (navEl as unknown as { outerHTML: string }).outerHTML,
        MARKER_NAV,
      );
    } else {
      (navEl as unknown as { innerHTML: string }).innerHTML = MARKER_NAV;
    }
  }

  const body = doc.querySelector("body");
  const marked = body?.innerHTML ?? "";

  // Split on markers
  const listMarkerIdx = marked.indexOf(listOpenTag);
  if (listMarkerIdx === -1) return null;

  const prefix = marked.slice(0, listMarkerIdx);
  const afterList = marked.slice(listMarkerIdx + listOpenTag.length);
  // After the list open tag we have MARKER_LIST + </${tagName}>
  const listEndIdx = afterList.indexOf(`</${tagName}>`);
  const afterListClose = listEndIdx >= 0 ? afterList.slice(listEndIdx + tagName.length + 3) : afterList;

  let suffix: string;
  if (navEl) {
    const navMarkerIdx = afterListClose.indexOf(MARKER_NAV);
    suffix = navMarkerIdx >= 0 ? afterListClose.slice(navMarkerIdx + MARKER_NAV.length) : afterListClose;
  } else {
    suffix = afterListClose;
  }

  return {
    items,
    listOpenTag,
    listCloseTag,
    navClass,
    prefix,
    suffix,
    size: items.length,
  };
}

// ---------------------------------------------------------------------------
// Group detection
// ---------------------------------------------------------------------------

/**
 * Detect groups of pages that are paginated versions of the same content.
 * Returns one PaginationGroup per detected group, ready for paginator generation.
 */
export function detectPaginationGroups(pages: ExtractedPage[]): PaginationGroup[] {
  // Index pages by base key
  const byBase = new Map<string, ExtractedPage[]>();
  for (const page of pages) {
    const key = stripPageIndicator(page.url);
    const group = byBase.get(key) ?? [];
    group.push(page);
    byBase.set(key, group);
  }

  const groups: PaginationGroup[] = [];

  for (const [baseKey, members] of byBase) {
    if (members.length < 2) continue; // single page — not a group

    // Sort by page number
    members.sort((a, b) => pageNumber(a.url) - pageNumber(b.url));
    const page1 = members[0];

    // Require a pagination nav signal on page 1
    if (!hasPaginationSignal(page1.contentHtml)) continue;

    // Extract list structure from page 1
    const structure = extractListStructure(page1.contentHtml);
    if (!structure) continue;

    // Derive a CSS selector from the detected list container so we can find
    // the same container on subsequent pages even when they have only 1 item.
    const containerSelector = selectorFromOpenTag(structure.listOpenTag) ?? "";

    // Collect items from all pages in order
    const allItems: string[] = [...structure.items];
    for (const member of members.slice(1)) {
      const memberItems = extractItemsByHint(member.contentHtml, containerSelector);
      allItems.push(...memberItems);
    }

    // Derive outputDir from the base URL pathname
    let outputDir: string;
    try {
      const pathname = new URL(baseKey).pathname;
      outputDir = pathname.replace(/^\//, "").replace(/\/$/, "");
    } catch {
      outputDir = "";
    }

    groups.push({
      baseUrl: page1.url,
      outputDir,
      pages: members,
      items: allItems,
      prefix: structure.prefix,
      suffix: structure.suffix,
      listOpenTag: structure.listOpenTag,
      listCloseTag: structure.listCloseTag,
      navClass: structure.navClass,
      size: structure.size,
      title: page1.title,
      description: page1.description,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Paginator file generation
// ---------------------------------------------------------------------------

/**
 * Generate the content of a Lume `.page.ts` paginator file for a group.
 *
 * The generated file uses `paginate()` (Lume core, no extra plugin) to emit
 * one page per batch of items, with a dynamically computed pagination nav.
 */
export function generatePaginatorFile(
  group: PaginationGroup,
  origin: string,
  urlPathMap: Map<string, string>,
  manifest: AssetManifest,
): string {
  const baseDir = group.outputDir ? `/${group.outputDir}` : "";

  // Rewrite internal links and asset paths in every item
  const rewrittenItems = group.items.map((item) => {
    let h = rewriteInternalLinks(item, origin, urlPathMap);
    h = rewritePaths(h, manifest);
    return h;
  });

  let prefix = rewriteInternalLinks(group.prefix, origin, urlPathMap);
  prefix = rewritePaths(prefix, manifest);

  let suffix = rewriteInternalLinks(group.suffix, origin, urlPathMap);
  suffix = rewritePaths(suffix, manifest);

  // Closing tag for the list container
  const listClose = `</${group.listCloseTag}>`;

  // Serialize data as JSON-safe string literals
  const itemsJson = JSON.stringify(rewrittenItems, null, 2);
  const prefixJson = JSON.stringify(prefix);
  const suffixJson = JSON.stringify(suffix);
  const listOpenJson = JSON.stringify(group.listOpenTag);
  const listCloseJson = JSON.stringify(listClose);
  const navClassJson = JSON.stringify(group.navClass);
  const titleJson = JSON.stringify(group.title);
  const descJson = JSON.stringify(group.description);
  const baseDirJson = JSON.stringify(baseDir);

  return `// Generated by misto
// Lume paginator for: ${group.baseUrl}

const ITEMS: string[] = ${itemsJson};

const PREFIX = ${prefixJson};
const SUFFIX = ${suffixJson};
const LIST_OPEN = ${listOpenJson};
const LIST_CLOSE = ${listCloseJson};
const NAV_CLASS = ${navClassJson};
const SIZE = ${group.size};
const TITLE = ${titleJson};
const DESCRIPTION = ${descJson};
const BASE_DIR = ${baseDirJson};

interface Pagination {
  page: number;
  totalPages: number;
  previous?: string;
  next?: string;
}

function renderNav(p: Pagination): string {
  const prevLi = p.previous
    ? \`<li class="previous"><a href="\${p.previous}" rel="prev" aria-label="Más reciente">Más reciente</a></li>\`
    : \`<li class="previous disabled" aria-disabled="true" aria-label="Más reciente"><span>Más reciente</span></li>\`;

  const pageItems = Array.from({ length: p.totalPages }, (_, i) => i + 1)
    .map((n) => {
      const url = n === 1 ? \`\${BASE_DIR}/\` : \`\${BASE_DIR}/\${n}/\`;
      return n === p.page
        ? \`<li class="active" aria-current="page"><span>\${n}</span></li>\`
        : \`<li><a href="\${url}">\${n}</a></li>\`;
    })
    .join("");

  const nextLi = p.next
    ? \`<li class="next"><a href="\${p.next}" rel="next" aria-label="Más antiguo">Más antiguo</a></li>\`
    : \`<li class="next disabled" aria-disabled="true" aria-label="Más antiguo"><span>Más antiguo</span></li>\`;

  return \`<nav class="\${NAV_CLASS}"><ul class="pagination-list">\${prevLi}\${pageItems}\${nextLi}</ul></nav>\`;
}

// deno-lint-ignore no-explicit-any
export default function* ({ paginate }: any) {
  const pages = paginate(ITEMS, {
    size: SIZE,
    url: (n: number) => n === 1 ? \`\${BASE_DIR}/\` : \`\${BASE_DIR}/\${n}/\`,
  });

  for (const page of pages) {
    yield {
      title: TITLE,
      description: DESCRIPTION,
      layout: "layouts/base.vto",
      url: page.url,
      content: PREFIX + LIST_OPEN + page.results.join("") + LIST_CLOSE + renderNav(page.pagination) + SUFFIX,
    };
  }
}
`;
}

// ---------------------------------------------------------------------------
// URL map helpers
// ---------------------------------------------------------------------------

/**
 * Compute the new canonical path for page N of a group.
 * Page 1 → `${baseDir}/`, page N → `${baseDir}/${N}/`.
 */
export function paginationUrl(group: PaginationGroup, n: number): string {
  const baseDir = group.outputDir ? `/${group.outputDir}` : "";
  return n === 1 ? `${baseDir}/` : `${baseDir}/${n}/`;
}
