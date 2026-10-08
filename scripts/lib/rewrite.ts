import { srcsetUrls } from "./assets.ts";
import { canonicalKey } from "./crawler.ts";
import { isFullDocument, parseDocument, parseFragment, type ParsedDoc, serializeDocument } from "./dom.ts";
import { escapeVento, protectVentoTags, splitFrontMatter, VENTO_PLACEHOLDER } from "./vento.ts";

/**
 * URL rewriting for crawled markup.
 *
 * Every rewrite happens on the parsed DOM, one attribute at a time. Replacing
 * substrings across serialized HTML corrupts unrelated markup: a manifest
 * entry whose pathname is `/` turns every `href="/"` into a link to that asset.
 */

export interface RewriteOptions {
  /** Origin of the crawled site; links outside it are left untouched. */
  origin: string;
  /** URL of the page the markup came from, used to resolve relative references. */
  baseUrl?: string;
  /** Downloaded assets: original absolute URL → local path. */
  manifest?: Record<string, string>;
  /** Crawled page URL (as `canonicalKey`) → path in the generated site. */
  urlPathMap?: Map<string, string>;
}

const SKIP_PREFIXES = ["#", "javascript:", "mailto:", "tel:", "data:", "blob:", "about:"];

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/** Attributes carrying a single URL. */
export const URL_ATTRS = ["href", "src", "action", "poster", "data", "formaction"];

const META_IMAGE_RE = /^(og:image(:secure_url)?|twitter:image(:src)?|image|msapplication-TileImage)$/i;

/**
 * Map one URL reference to its equivalent in the generated site.
 *
 * Returns `null` when the reference should be left exactly as it is: external
 * links, non-navigational schemes, and anything that fails to resolve.
 */
export function mapUrl(raw: string, options: RewriteOptions, assetsOnly = false): string | null {
  const value = raw.trim();
  if (!value || value.includes(VENTO_PLACEHOLDER)) return null;

  const lower = value.toLowerCase();
  if (SKIP_PREFIXES.some((p) => lower.startsWith(p))) return null;

  let resolved: URL;
  let origin: URL;
  try {
    origin = new URL(options.origin);
    resolved = new URL(value, options.baseUrl || options.origin);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(resolved.protocol)) return null;

  const hash = resolved.hash;
  resolved.hash = "";

  // A downloaded asset always wins: the manifest holds the real filename,
  // which differs from the URL's when two assets shared a name.
  const local = options.manifest?.[resolved.toString()];
  if (local) return local + hash;
  if (assetsOnly) return null;

  if (resolved.host.toLowerCase() !== origin.host.toLowerCase()) return null;

  // http:// links on an https:// site point at the same pages.
  resolved.protocol = origin.protocol;
  const mapped = options.urlPathMap?.get(canonicalKey(resolved));
  if (mapped) return mapped + hash;

  // Unknown same-site target: make it root-relative so it survives the page
  // moving and the site changing domain.
  return resolved.pathname + resolved.search + hash;
}

function rewriteSrcset(value: string, options: RewriteOptions): string {
  let out = value;
  for (const url of srcsetUrls(value)) {
    const mapped = mapUrl(url, options);
    if (mapped) out = out.split(url).join(mapped);
  }
  return out;
}

function rewriteCss(css: string, options: RewriteOptions): string {
  return css.replace(CSS_URL_RE, (match, quote, raw) => {
    const mapped = mapUrl(raw, options);
    return mapped ? `url(${quote}${mapped}${quote})` : match;
  });
}

/** Rewrite every URL reference in a parsed document, in place. */
export function rewriteDom(doc: ParsedDoc, options: RewriteOptions): void {
  for (const el of doc.querySelectorAll("*")) {
    const tag = el.tagName.toLowerCase();
    if (tag === "base") continue;

    for (const attr of URL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value === null) continue;
      const mapped = mapUrl(value, options);
      if (mapped !== null) el.setAttribute(attr, mapped);
    }

    const srcset = el.getAttribute("srcset");
    if (srcset) el.setAttribute("srcset", rewriteSrcset(srcset, options));

    const style = el.getAttribute("style");
    if (style?.includes("url(")) el.setAttribute("style", rewriteCss(style, options));

    if (tag === "style" && el.textContent.includes("url(")) {
      el.textContent = rewriteCss(el.textContent, options);
    }

    // Social-card images are assets; `og:url` and friends are left for the
    // layout to template.
    if (tag === "meta" && META_IMAGE_RE.test(el.getAttribute("property") ?? el.getAttribute("name") ?? "")) {
      const mapped = mapUrl(el.getAttribute("content") ?? "", options, true);
      if (mapped !== null) el.setAttribute("content", mapped);
    }
  }
}

/** Rewrite the URLs of a markup fragment. */
export function rewriteFragment(html: string, options: RewriteOptions): string {
  const doc = parseFragment(html);
  if (!doc) return html;
  rewriteDom(doc, options);
  return doc.body.innerHTML;
}

export interface RewriteSourceOptions extends RewriteOptions {
  /**
   * How to read `{{ … }}` in the input. `"tags"`: they are Vento tags written
   * by whoever authored the template, and come out untouched. `"literal"`:
   * they are text from the crawled site, and come out escaped.
   */
  vento: "tags" | "literal";
}

/**
 * Rewrite the URLs of a file: a whole document or a fragment, plain crawled
 * HTML or a Vento template with front matter.
 */
export function rewriteSource(source: string, options: RewriteSourceOptions): string {
  const { frontMatter, body } = splitFrontMatter(source);
  const guard = options.vento === "tags" ? protectVentoTags(body) : { html: body, restore: (s: string) => s };

  const full = isFullDocument(guard.html);
  const doc = full ? parseDocument(guard.html) : parseFragment(guard.html);
  if (!doc) return source;
  rewriteDom(doc, options);

  let out = full ? serializeDocument(doc) : doc.body.innerHTML;
  out = options.vento === "literal" ? escapeVento(out) : guard.restore(out);
  return frontMatter + out;
}
