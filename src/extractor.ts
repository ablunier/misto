import { DOMParser } from "@b-fuze/deno-dom";
import type { AssetUrl, CrawledPage, ExtractedPage } from "./types.ts";

type ParsedDoc = NonNullable<ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>>;

function extractMeta(doc: ParsedDoc, name: string): string {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() ?? "";
}

function extractContent(doc: ParsedDoc): string {
  const region =
    doc.querySelector("main") ??
    doc.querySelector('[role="main"]') ??
    doc.querySelector("article") ??
    doc.querySelector("body");
  if (!region) return "";

  for (const el of region.querySelectorAll("script, style")) {
    el.parentNode?.removeChild(el);
  }
  return region.innerHTML;
}

function resolveUrl(href: string, base: URL): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isExternal(url: string, origin: string): boolean {
  try {
    return new URL(url).origin !== origin;
  } catch {
    return true;
  }
}

function extractAssets(doc: ParsedDoc, base: URL): AssetUrl[] {
  const assets: AssetUrl[] = [];
  const seen = new Set<string>();

  const add = (url: string, type: AssetUrl["type"]) => {
    if (!seen.has(url)) {
      seen.add(url);
      assets.push({ original: url, type });
    }
  };

  for (const el of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
    const href = el.getAttribute("href");
    if (!href) continue;
    const resolved = resolveUrl(href, base);
    if (resolved) add(resolved, "css");
  }

  for (const el of doc.querySelectorAll("script[src]")) {
    const src = el.getAttribute("src");
    if (!src) continue;
    const resolved = resolveUrl(src, base);
    if (resolved) add(resolved, "js");
  }

  for (const el of doc.querySelectorAll("img[src]")) {
    const src = el.getAttribute("src");
    if (!src) continue;
    const resolved = resolveUrl(src, base);
    if (resolved) add(resolved, "img");
  }

  const iconSelectors = [
    'link[rel~="icon"][href]',
    'link[rel~="apple-touch-icon"][href]',
    'link[rel="manifest"][href]',
  ];
  for (const sel of iconSelectors) {
    for (const el of doc.querySelectorAll(sel)) {
      const href = el.getAttribute("href");
      if (!href) continue;
      const resolved = resolveUrl(href, base);
      if (resolved) add(resolved, "img");
    }
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
      const val = el.getAttribute("content") ?? el.getAttribute("href");
      if (!val) continue;
      const resolved = resolveUrl(val, base);
      if (resolved) add(resolved, "img");
    }
  }

  return assets;
}

export function extractPage(page: CrawledPage): ExtractedPage {
  const doc = new DOMParser().parseFromString(page.rawHtml, "text/html");
  if (!doc) {
    return { url: page.url, title: page.title, description: "", contentHtml: "", assetUrls: [] };
  }

  const base = new URL(page.url);
  return {
    url: page.url,
    title:
      doc.querySelector("title")?.textContent?.trim() ||
      doc.querySelector("h1")?.textContent?.trim() ||
      page.title,
    description: extractMeta(doc, "description"),
    contentHtml: extractContent(doc),
    assetUrls: extractAssets(doc, base),
  };
}

export function extractBaseLayout(page: CrawledPage): string {
  const doc = new DOMParser().parseFromString(page.rawHtml, "text/html");
  if (!doc) return "{{ content }}";

  const base = new URL(page.url);

  for (const el of doc.querySelectorAll('link[rel="stylesheet"][href]')) {
    const href = el.getAttribute("href");
    if (!href) continue;
    const resolved = resolveUrl(href, base);
    if (!resolved || isExternal(resolved, base.origin)) continue;
    const filename = new URL(resolved).pathname.split("/").pop() ?? "style.css";
    el.setAttribute("href", `/assets/css/${filename}`);
  }

  for (const el of doc.querySelectorAll("script[src]")) {
    const src = el.getAttribute("src");
    if (!src) continue;
    const resolved = resolveUrl(src, base);
    if (!resolved || isExternal(resolved, base.origin)) continue;
    const filename = new URL(resolved).pathname.split("/").pop() ?? "script.js";
    el.setAttribute("src", `/assets/js/${filename}`);
  }

  for (const el of doc.querySelectorAll("img[src]")) {
    const src = el.getAttribute("src");
    if (!src) continue;
    const resolved = resolveUrl(src, base);
    if (!resolved || isExternal(resolved, base.origin)) continue;
    const filename = new URL(resolved).pathname.split("/").pop() ?? "image";
    el.setAttribute("src", `/assets/img/${filename}`);
  }

  const region =
    doc.querySelector("main") ??
    doc.querySelector('[role="main"]') ??
    doc.querySelector("article");

  if (region) {
    region.innerHTML = "{{ content }}";
  } else {
    const body = doc.querySelector("body");
    if (body) body.innerHTML = "{{ content }}";
  }

  return doc.querySelector("html")?.outerHTML ?? "{{ content }}";
}
