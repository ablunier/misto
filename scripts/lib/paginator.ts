import { type DomElement as Element, parseFragment } from "./dom.ts";

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
/** `tag.first-class` selector for an element, as a hint to find it again. */
export function hintSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  if (id && /^[A-Za-z][\w-]*$/.test(id)) return `${tag}#${id}`;
  const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).find((c) => /^[A-Za-z_][\w-]*$/.test(c));
  return cls ? `${tag}.${cls}` : tag;
}

export function findListContainer(doc: ReturnType<typeof parseFragment>): Element | null {
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

export interface ListStructure {
  /** `tag.class` selector of the list container. */
  selector: string;
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
  const selector = hintSelector(listContainer);

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
    selector,
    items,
    listOpenTag,
    listCloseTag,
    navClass,
    prefix,
    suffix,
    size: items.length,
  };
}
