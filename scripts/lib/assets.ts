import type { ParsedDoc } from "./dom.ts";
import type { AssetUrl } from "./types.ts";

const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

export function resolveUrl(href: string, base: URL): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** Split a `srcset` value into its URLs, dropping the width/density descriptors. */
export function srcsetUrls(value: string): string[] {
  return value
    .split(/,\s+|,(?=\S+\s)/)
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** Every stylesheet, script, image and icon a document references, as absolute URLs. */
export function extractAssets(doc: ParsedDoc, base: URL): AssetUrl[] {
  const assets: AssetUrl[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null, type: AssetUrl["type"]) => {
    if (!raw) return;
    const url = resolveUrl(raw.trim(), base);
    if (!url || !/^https?:/.test(url) || seen.has(url)) return;
    seen.add(url);
    assets.push({ original: url, type });
  };

  for (const el of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
    add(el.getAttribute("href"), "css");
  }

  for (const el of doc.querySelectorAll("script[src]")) {
    add(el.getAttribute("src"), "js");
  }

  for (const el of doc.querySelectorAll("img[src], picture source[src]")) {
    add(el.getAttribute("src"), "img");
  }

  for (const el of doc.querySelectorAll("img[srcset], picture source[srcset]")) {
    for (const url of srcsetUrls(el.getAttribute("srcset") ?? "")) add(url, "img");
  }

  const iconSelectors = [
    'link[rel~="icon"][href]',
    'link[rel~="apple-touch-icon"][href]',
    'link[rel="manifest"][href]',
  ];
  for (const sel of iconSelectors) {
    for (const el of doc.querySelectorAll(sel)) add(el.getAttribute("href"), "img");
  }

  const metaImageSelectors = [
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="image"]',
    'meta[name="msapplication-TileImage"]',
    'link[rel="image_src"]',
  ];
  for (const sel of metaImageSelectors) {
    for (const el of doc.querySelectorAll(sel)) {
      add(el.getAttribute("content") ?? el.getAttribute("href"), "img");
    }
  }

  // url() references in <style> blocks and inline style attributes
  const addCssUrls = (css: string) => {
    for (const m of css.matchAll(CSS_URL_RE)) {
      const raw = m[2].trim();
      // `url(#gradient)` points at an SVG element in the same document, not a
      // file. Resolving it yields the page itself, which would then be
      // downloaded and stored as an "image".
      if (!raw || raw.startsWith("#") || raw.startsWith("data:")) continue;
      add(raw, "img");
    }
  };
  for (const el of doc.querySelectorAll("style")) addCssUrls(el.textContent ?? "");
  for (const el of doc.querySelectorAll("[style]")) addCssUrls(el.getAttribute("style") ?? "");

  return assets;
}
