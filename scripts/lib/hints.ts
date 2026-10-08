import { extractAssets, resolveUrl } from "./assets.ts";
import { type DomElement, type ParsedDoc, parseDocument } from "./dom.ts";
import { extractListStructure, hasPaginationSignal, hintSelector, pageNumber, stripPageIndicator } from "./paginator.ts";
import type { PageEntry } from "./types.ts";

/**
 * Suggestions about a crawled site's structure.
 *
 * Nothing here decides anything. Every site has its particular things, so the
 * agent reads these hints, checks them against real pages and makes the call.
 */

// ---------------------------------------------------------------------------
// Content region
// ---------------------------------------------------------------------------

const CONTENT_SELECTORS = ["main", '[role="main"]', "#content", "#main", "#main-content"];

/**
 * Best guess at the element holding a page's own content.
 *
 * Deliberately refuses to pick among several `<article>`s: teaser cards and
 * testimonials are articles too.
 */
export function findContentRegion(doc: ParsedDoc): DomElement | null {
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) return el as DomElement;
  }
  const articles = doc.querySelectorAll("article");
  return articles.length === 1 ? articles[0] as DomElement : null;
}

/** A selector that matches only `el` in its document, as short as possible. */
export function uniqueSelector(doc: ParsedDoc, el: DomElement): string {
  let selector = hintSelector(el);
  let parent = el.parentElement;
  while (doc.querySelectorAll(selector).length > 1 && parent && parent.tagName !== "HTML") {
    selector = `${hintSelector(parent as DomElement)} > ${selector}`;
    parent = parent.parentElement;
  }
  return selector;
}

// ---------------------------------------------------------------------------
// Template clusters
// ---------------------------------------------------------------------------

const NON_STRUCTURAL = new Set(["script", "style", "noscript", "link", "meta", "template", "br"]);

/** Classes that mark state or identity of one page, not the template. */
const PAGE_CLASS_RE = /current|active|selected|open|^(post|page|item|id|term|cat|tag)-#$/i;

function normalize(token: string): string {
  return token.replace(/\d+/g, "#");
}

/** `tag#id.class` with per-page noise removed, so two pages of one template agree. */
function structuralKey(el: DomElement, withClasses: boolean): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  let key = id ? `${tag}#${normalize(id)}` : tag;
  if (withClasses) {
    const classes = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map(normalize)
      .filter((c) => !PAGE_CLASS_RE.test(c));
    key += [...new Set(classes)].sort().map((c) => `.${c}`).join("");
  }
  return key;
}

function structuralChildren(el: DomElement): DomElement[] {
  return [...el.children].filter((c) => !NON_STRUCTURAL.has(c.tagName.toLowerCase())) as DomElement[];
}

/**
 * The chrome around a page's content, one line per level from `<body>` down
 * to the content region. Pages of one template are never identical outside
 * their content, so only the elements beside the path to the content count,
 * and only by tag, id and stable classes.
 */
export function chromeSkeleton(doc: ParsedDoc, region: DomElement | null): string[] {
  const body = doc.body as DomElement | null;
  if (!body) return ["(no body)"];
  if (!region || region === body) {
    return [`body: ${structuralChildren(body).map((c) => structuralKey(c, true)).join(" ")} (no content region)`];
  }

  const path: DomElement[] = [];
  for (let el: DomElement | null = region; el && el !== body; el = el.parentElement as DomElement | null) {
    path.unshift(el);
  }

  const lines: string[] = [];
  let parent = body;
  for (const step of path) {
    const keys = structuralChildren(parent).map((child) =>
      child === step ? `[${structuralKey(child, false)}]` : structuralKey(child, true)
    );
    lines.push(`${structuralKey(parent, false)}: ${keys.join(" ")}`);
    parent = step;
  }
  return lines;
}

export interface TemplateHint {
  /** Suggested layout name. */
  name: string;
  pages: number;
  /** Suggested content selector, taken from the first page; `null` if none was found. */
  contentSelector: string | null;
  /** The shared chrome; `[x]` marks the path to the content. */
  skeleton: string[];
  /** First path segment → number of pages. */
  sections: Record<string, number>;
  sample: Array<{ id: string; url: string }>;
  pageIds: string[];
}

function firstSegment(url: string): string {
  try {
    return "/" + (new URL(url).pathname.split("/").filter(Boolean)[0] ?? "");
  } catch {
    return "/";
  }
}

function nameCluster(sections: Record<string, number>, index: number, taken: Set<string>): string {
  if (index === 0) return "base";
  const [top] = Object.entries(sections).sort((a, b) => b[1] - a[1]);
  const base = top[0] === "/" ? "home" : top[0].slice(1).toLowerCase().replace(/[^a-z0-9]+/g, "-") || "page";
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}`;
  return name;
}

// ---------------------------------------------------------------------------
// Search forms and CMS cruft
// ---------------------------------------------------------------------------

const SEARCH_INPUT_NAMES = new Set(["q", "s", "search", "query", "keyword"]);

/** Absolute action URLs of GET search forms found anywhere in the document. */
export function extractSearchActions(doc: ParsedDoc, base: URL): string[] {
  const actions = new Set<string>();
  for (const form of doc.querySelectorAll("form")) {
    const method = (form.getAttribute("method") ?? "get").toLowerCase();
    if (method !== "get") continue;
    let isSearch = form.querySelector('input[type="search"]') !== null;
    if (!isSearch) {
      for (const input of form.querySelectorAll("input")) {
        const type = (input.getAttribute("type") ?? "text").toLowerCase();
        const name = (input.getAttribute("name") ?? "").toLowerCase();
        if ((type === "text" || type === "search") && SEARCH_INPUT_NAMES.has(name)) {
          isSearch = true;
          break;
        }
      }
    }
    if (!isSearch) continue;
    const action = form.getAttribute("action");
    const resolved = action ? resolveUrl(action, base) : null;
    if (resolved) actions.add(resolved);
  }
  return [...actions];
}

/** Head elements that only make sense on the original CMS. */
export const CMS_HEAD_SELECTORS = [
  'meta[name="generator"]',
  'meta[name="msapplication-config"]',
  'meta[name="csrf-token"]',
  'link[rel="xmlrpc"]',
  'link[rel="EditURI"]',
  'link[rel="wlwmanifest"]',
  'link[rel="pingback"]',
  'link[rel="https://api.w.org/"]',
  'link[rel="alternate"][type*="oembed"]',
];

const TRACKING_RE = /google-analytics|googletagmanager|gtag\(|hotjar|matomo|piwik|fbq\(|clarity\.ms|plausible/i;
const CMS_SCRIPT_RE = /wp-emoji|qtranslate|wp-settings|wp-json|rest_nonce|wp-includes|wp-content\/plugins|wp-admin/i;
const CMS_STYLE_RE = /wp-emoji|wp-block-library|qtranslate|dashicon/i;

export interface CruftHint {
  kind: "cms-head" | "tracking-script" | "cms-script" | "cms-style";
  /** A selector for `cms-head`; otherwise a short excerpt identifying the element. */
  what: string;
  pages: number;
}

function excerpt(el: DomElement): string {
  const src = el.getAttribute("src");
  if (src) return `${el.tagName.toLowerCase()}[src="${src.split("?")[0]}"]`;
  const id = el.getAttribute("id");
  if (id) return `${el.tagName.toLowerCase()}#${id}`;
  return `${el.tagName.toLowerCase()}: ${el.textContent.trim().replace(/\s+/g, " ").slice(0, 60)}`;
}

function findCruft(doc: ParsedDoc): Array<Omit<CruftHint, "pages">> {
  const found: Array<Omit<CruftHint, "pages">> = [];
  for (const sel of CMS_HEAD_SELECTORS) {
    if (doc.querySelector(sel)) found.push({ kind: "cms-head", what: sel });
  }
  for (const el of doc.querySelectorAll("script")) {
    const text = (el.getAttribute("src") ?? "") + " " + el.textContent;
    if (TRACKING_RE.test(text)) found.push({ kind: "tracking-script", what: excerpt(el as DomElement) });
    else if (CMS_SCRIPT_RE.test(text)) found.push({ kind: "cms-script", what: excerpt(el as DomElement) });
  }
  for (const el of doc.querySelectorAll("style")) {
    if (CMS_STYLE_RE.test((el.getAttribute("id") ?? "") + " " + el.textContent.slice(0, 2000))) {
      found.push({ kind: "cms-style", what: excerpt(el as DomElement) });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Site hints
// ---------------------------------------------------------------------------

export interface PaginationHint {
  /** URL of page 1. */
  baseUrl: string;
  pages: Array<{ id: string; url: string; n: number }>;
  /** The repeated-item container found on page 1, if any. */
  list: { selector: string; itemsOnFirstPage: number } | null;
}

export interface SiteHints {
  origin: string;
  pages: number;
  /** `<html lang>` value → number of pages. */
  languages: Record<string, number>;
  /** `<meta name="generator">` value → number of pages. */
  generators: Record<string, number>;
  templates: TemplateHint[];
  pagination: PaginationHint[];
  searchForms: Array<{ action: string; pages: number }>;
  /** Pages whose URL only differs by query string; they were given a slug from their title. */
  queryStringPages: number;
  /** Pages containing a literal `{{`, which Vento would try to evaluate. */
  pagesWithTemplateSyntax: number;
  cruft: CruftHint[];
  assets: { css: number; js: number; img: number; externalHosts: Record<string, number> };
}

function count(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function byCount(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]));
}

/** Analyse every crawled page and report what the site seems to be made of. */
export function buildHints(
  origin: string,
  pages: Array<{ entry: PageEntry; html: string }>,
): SiteHints {
  const languages: Record<string, number> = {};
  const generators: Record<string, number> = {};
  const searchForms: Record<string, number> = {};
  const externalHosts: Record<string, number> = {};
  const cruft = new Map<string, CruftHint>();
  const assetUrls = { css: new Set<string>(), js: new Set<string>(), img: new Set<string>(), font: new Set<string>() };
  const clusters = new Map<string, Omit<TemplateHint, "name" | "pages">>();
  const paginated = new Map<string, Array<{ entry: PageEntry; contentHtml: string }>>();
  let queryStringPages = 0;
  let pagesWithTemplateSyntax = 0;
  const originHost = new URL(origin).host;

  for (const { entry, html } of pages) {
    const doc = parseDocument(html);
    if (!doc) continue;
    const base = new URL(entry.url);

    count(languages, doc.documentElement?.getAttribute("lang")?.trim() || "(none)");
    const generator = doc.querySelector('meta[name="generator"]')?.getAttribute("content")?.trim();
    if (generator) count(generators, generator);
    for (const action of extractSearchActions(doc, base)) count(searchForms, action);
    if (entry.slug) queryStringPages++;
    if (html.includes("{{")) pagesWithTemplateSyntax++;

    for (const item of findCruft(doc)) {
      const key = `${item.kind}|${item.what}`;
      const hint = cruft.get(key) ?? { ...item, pages: 0 };
      hint.pages++;
      cruft.set(key, hint);
    }

    for (const asset of extractAssets(doc, base)) {
      if (assetUrls[asset.type].has(asset.original)) continue;
      assetUrls[asset.type].add(asset.original);
      const host = new URL(asset.original).host;
      if (host !== originHost) count(externalHosts, host);
    }

    const region = findContentRegion(doc);
    const skeleton = chromeSkeleton(doc, region);
    const key = skeleton.join("\n");
    const cluster = clusters.get(key) ?? {
      contentSelector: region ? uniqueSelector(doc, region) : null,
      skeleton,
      sections: {},
      sample: [],
      pageIds: [],
    };
    count(cluster.sections, firstSegment(entry.url));
    if (cluster.sample.length < 5) cluster.sample.push({ id: entry.id, url: entry.url });
    cluster.pageIds.push(entry.id);
    clusters.set(key, cluster);

    const group = paginated.get(stripPageIndicator(entry.url)) ?? [];
    group.push({ entry, contentHtml: (region ?? doc.body)?.innerHTML ?? "" });
    paginated.set(stripPageIndicator(entry.url), group);
  }

  const taken = new Set<string>(["base"]);
  const templates = [...clusters.values()]
    .sort((a, b) => b.pageIds.length - a.pageIds.length)
    .map((cluster, index): TemplateHint => {
      const name = nameCluster(cluster.sections, index, taken);
      taken.add(name);
      return { name, pages: cluster.pageIds.length, ...cluster, sections: byCount(cluster.sections) };
    });

  const pagination: PaginationHint[] = [];
  for (const members of paginated.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => pageNumber(a.entry.url) - pageNumber(b.entry.url));
    const first = members[0];
    // `?p=12` is a pagination parameter on some sites and a post id on others;
    // without a pagination nav on the page it is the latter.
    if (!hasPaginationSignal(first.contentHtml)) continue;
    const list = extractListStructure(first.contentHtml);
    pagination.push({
      baseUrl: first.entry.url,
      pages: members.map(({ entry }) => ({ id: entry.id, url: entry.url, n: pageNumber(entry.url) })),
      list: list ? { selector: list.selector, itemsOnFirstPage: list.size } : null,
    });
  }

  return {
    origin,
    pages: pages.length,
    languages: byCount(languages),
    generators: byCount(generators),
    templates,
    pagination,
    searchForms: Object.entries(byCount(searchForms)).map(([action, n]) => ({ action, pages: n })),
    queryStringPages,
    pagesWithTemplateSyntax,
    cruft: [...cruft.values()].sort((a, b) => b.pages - a.pages),
    assets: {
      css: assetUrls.css.size,
      js: assetUrls.js.size,
      img: assetUrls.img.size,
      externalHosts: byCount(externalHosts),
    },
  };
}

// ---------------------------------------------------------------------------
// Page outline
// ---------------------------------------------------------------------------

function label(el: DomElement): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute("id");
  const classes = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  let out = tag + (id ? `#${id}` : "") + classes.slice(0, 4).map((c) => `.${c}`).join("");
  if (classes.length > 4) out += `.(+${classes.length - 4})`;
  const role = el.getAttribute("role");
  if (role) out += `[role=${role}]`;
  return out;
}

function textLength(el: DomElement): number {
  return el.textContent.replace(/\s+/g, " ").trim().length;
}

function outlineNode(el: DomElement, depth: number, maxDepth: number, lines: string[], repeat = 1): void {
  const children = structuralChildren(el);
  const chars = textLength(el);
  let line = "  ".repeat(depth) + label(el);
  if (repeat > 1) line += ` ×${repeat}`;
  if (chars > 0) line += ` (${chars} chars)`;
  if (children.length > 0 && depth >= maxDepth) line += ` … ${children.length} children`;
  lines.push(line);
  if (depth >= maxDepth) return;

  // Collapse runs of same-shaped siblings (list items, cards) into one line.
  for (let i = 0; i < children.length;) {
    const key = structuralKey(children[i], true);
    let run = 1;
    while (i + run < children.length && structuralKey(children[i + run], true) === key) run++;
    outlineNode(children[i], depth + 1, maxDepth, lines, run);
    i += run;
  }
}

/**
 * A compact tag/id/class tree of a page, so its structure can be read without
 * loading the whole document.
 */
export function outline(doc: ParsedDoc, root: DomElement, maxDepth: number): string[] {
  const lines: string[] = [];
  if (root === doc.body) {
    const head = doc.querySelector("head");
    lines.push(`html[lang=${doc.documentElement?.getAttribute("lang") ?? ""}]`);
    lines.push(`title: ${doc.querySelector("title")?.textContent.trim() ?? ""}`);
    for (const el of head?.querySelectorAll('link[rel="stylesheet"][href]') ?? []) {
      lines.push(`stylesheet: ${el.getAttribute("href")}`);
    }
    for (const el of doc.querySelectorAll("script[src]")) lines.push(`script: ${el.getAttribute("src")}`);
    const bodyClass = doc.body?.getAttribute("class");
    if (bodyClass) lines.push(`body class: ${bodyClass}`);
    lines.push("");
  }
  outlineNode(root, 0, maxDepth, lines);
  return lines;
}
