import { canonicalKey } from "./crawler.ts";
import type { PageEntry } from "./types.ts";

/** Source file for a crawled URL, relative to the Lume project root. */
export function pageOutputPath(url: string, origin: string, slug?: string): string {
  try {
    const u = new URL(url);
    if (slug) {
      const dir = u.pathname.replace(/^\//, "").replace(/\/$/, "");
      return dir ? `${dir}/${slug}.vto` : `${slug}.vto`;
    }
    const clean = u.pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
    return `${clean}.vto`;
  } catch {
    const pathname = url.startsWith(origin) ? url.slice(origin.length) : url;
    const clean = pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
    return `${clean}.vto`;
  }
}

/** Public URL path of a crawled page in the generated site. */
export function pageCanonicalPath(url: string, slug?: string): string {
  try {
    const u = new URL(url);
    if (slug) {
      const dir = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
      return `${dir}/${slug}/`;
    }
    // A path with a file extension (`/feed.xml`, `/old/page.html`) is kept as it is.
    if (/\.[a-z0-9]+$/i.test(u.pathname)) return u.pathname;
    return u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  } catch {
    return "/";
  }
}

/** Source file that makes Lume output exactly the given URL path. */
export function outputPathForUrl(path: string): string {
  const clean = path.replace(/^\//, "");
  if (clean === "" || clean.endsWith("/")) return `${clean.replace(/\/$/, "") || "index"}.vto`;
  return `${clean.replace(/\.html?$/i, "")}.vto`;
}

/**
 * Crawled URL → path in the generated site, keyed by `canonicalKey`.
 *
 * `overrides` come from the rules file (`urls`) and win over the derived path:
 * that is how `/blog/?page=2` becomes `/blog/2/`.
 */
export function buildUrlPathMap(
  pages: PageEntry[],
  overrides: Record<string, string> = {},
): Map<string, string> {
  const map = new Map<string, string>();
  for (const page of pages) {
    map.set(canonicalKey(page.url), pageCanonicalPath(page.url, page.slug));
  }
  for (const [url, path] of Object.entries(overrides)) {
    try {
      map.set(canonicalKey(url), path);
    } catch {
      // a malformed override is reported by the rules validation
    }
  }
  return map;
}

/** File inside a built `_site` that serves a URL path. */
export function siteFileCandidates(path: string): string[] {
  const clean = decodeURIComponent(path.split(/[?#]/)[0]).replace(/^\//, "");
  if (clean === "" || clean.endsWith("/")) return [`${clean}index.html`];
  return [clean, `${clean}/index.html`, `${clean}.html`];
}
