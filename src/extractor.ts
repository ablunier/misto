import { DOMParser } from "@b-fuze/deno-dom";
import type { AssetUrl, CrawledPage, ExtractedPage } from "./types.ts";

type ParsedDoc = NonNullable<ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>>;

function extractMeta(doc: ParsedDoc, name: string): string {
  return doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content")?.trim() ?? "";
}

const SEARCH_INPUT_NAMES = new Set(["q", "s", "search", "query", "keyword"]);

/**
 * Return absolute action URLs of GET search forms found anywhere in the document.
 * Used by the generator to create a static Lume search index page at each action path.
 */
export function extractSearchActions(doc: ParsedDoc, base: URL): string[] {
  const seen = new Set<string>();
  const actions: string[] = [];
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
    if (!action) continue;
    const resolved = resolveUrl(action, base);
    if (resolved && !seen.has(resolved)) {
      seen.add(resolved);
      actions.push(resolved);
    }
  }
  return actions;
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

  // Discover url() references in <style> blocks (e.g. background images)
  const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  for (const el of doc.querySelectorAll("style")) {
    const text = el.textContent ?? "";
    for (const m of text.matchAll(CSS_URL_RE)) {
      const raw = m[2].trim();
      if (!raw || raw.startsWith("data:")) continue;
      const resolved = resolveUrl(raw, base);
      if (resolved) add(resolved, "img");
    }
  }

  // Discover url() references in inline style attributes
  for (const el of doc.querySelectorAll("[style]")) {
    const styleAttr = el.getAttribute("style") ?? "";
    for (const m of styleAttr.matchAll(CSS_URL_RE)) {
      const raw = m[2].trim();
      if (!raw || raw.startsWith("data:")) continue;
      const resolved = resolveUrl(raw, base);
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
    slug: page.slug,
    searchActions: extractSearchActions(doc, base),
  };
}

export function extractBaseLayout(page: CrawledPage): string {
  const doc = new DOMParser().parseFromString(page.rawHtml, "text/html");
  if (!doc) return "{{ content }}";

  // Remove WordPress and plugin-specific meta tags
  const removeSelectors = [
    'meta[name="generator"]',
    'meta[name="msapplication-config"]',
    'meta[name="csrf-token"]',
    'link[rel="xmlrpc"]',
    'link[rel="wlwmanifest"]',
    'link[rel="pingback"]',
    'link[rel="alternate"][hreflang="x-default"]',
  ];
  for (const sel of removeSelectors) {
    for (const el of doc.querySelectorAll(sel)) {
      el.parentNode?.removeChild(el);
    }
  }

  // Remove WordPress-specific scripts and data
  for (const script of doc.querySelectorAll("script")) {
    const content = script.textContent || "";
    // Remove Google Analytics, Hotjar, and similar tracking scripts
    if (/google-analytics|gtag|hotjar|analytics|tracking/i.test(content)) {
      script.parentNode?.removeChild(script);
      continue;
    }
    // Remove WordPress-specific initialization scripts
    if (/wp-emoji|qtranslate|wp-settings|wp-json|rest_nonce/i.test(content)) {
      script.parentNode?.removeChild(script);
      continue;
    }
    // Keep script but remove if it's inline configuration for removed plugins
    const src = script.getAttribute("src") || "";
    if (/wp-includes|wp-content\/plugins|wp-admin|gtag|analytics|tracking/i.test(src)) {
      script.parentNode?.removeChild(script);
    }
  }

  // Remove style tags with WordPress-specific content
  for (const style of doc.querySelectorAll("style")) {
    const content = style.textContent || "";
    if (/wp-|qtranslate|emoji|dashicon/i.test(content)) {
      style.parentNode?.removeChild(style);
    }
  }

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
