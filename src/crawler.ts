import { DOMParser } from "@b-fuze/deno-dom";
import type { CrawlOptions, CrawledPage } from "./types.ts";

type ParsedDoc = NonNullable<ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>>;

export function normalizeUrl(raw: string): string {
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(withScheme);
  url.hostname = url.hostname.toLowerCase();
  url.hash = "";
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

function canonicalize(url: URL): string {
  const c = new URL(url.toString());
  c.hash = "";
  if (c.pathname !== "/" && c.pathname.endsWith("/")) {
    c.pathname = c.pathname.slice(0, -1);
  }
  return c.toString().toLowerCase();
}

function extractTitle(doc: ParsedDoc): string {
  return (
    doc.querySelector("title")?.textContent?.trim() ||
    doc.querySelector("h1")?.textContent?.trim() ||
    ""
  );
}

function hasNoFollow(doc: ParsedDoc): boolean {
  const content =
    doc.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
  return content.toLowerCase().includes("nofollow");
}

function extractLinks(doc: ParsedDoc, base: URL, origin: string): string[] {
  const links: string[] = [];
  for (const anchor of doc.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href) continue;
    try {
      const resolved = new URL(href, base);
      if (!resolved.protocol.startsWith("http")) continue;
      if (resolved.origin.toLowerCase() !== origin) continue;
      resolved.hash = "";
      links.push(resolved.toString());
    } catch {
      // skip malformed hrefs
    }
  }
  return links;
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url: string): Promise<string | null> {
  const headers = { "User-Agent": "misto/0.1 (+https://github.com/ablunier/misto)" };
  try {
    const resp = await fetch(url, { headers, redirect: "follow" });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export function parseSitemapLocs(xml: string): { urls: string[]; subSitemaps: string[] } {
  // deno-dom only supports HTML; extract <loc> text with regex instead.
  const extractLocs = (block: string): string[] => {
    const locs: string[] = [];
    for (const m of block.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)) {
      const val = m[1].trim();
      if (val) locs.push(val);
    }
    return locs;
  };

  const urlsetMatch = xml.match(/<urlset[\s\S]*?<\/urlset>/i);
  const indexMatch = xml.match(/<sitemapindex[\s\S]*?<\/sitemapindex>/i);

  return {
    urls: urlsetMatch ? extractLocs(urlsetMatch[0]) : [],
    subSitemaps: indexMatch ? extractLocs(indexMatch[0]) : [],
  };
}

export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  // Collect candidate sitemap URLs from robots.txt, then fall back to defaults.
  const candidates: string[] = [];
  const robotsTxt = await fetchText(`${origin}/robots.txt`);
  if (robotsTxt) {
    for (const line of robotsTxt.split(/\r?\n/)) {
      const m = line.match(/^Sitemap:\s*(.+)$/i);
      if (m) candidates.push(m[1].trim());
    }
  }
  if (candidates.length === 0) {
    candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);
  }

  const allUrls = new Set<string>();
  const fetchedSitemaps = new Set<string>();

  const processSitemap = async (url: string) => {
    if (fetchedSitemaps.has(url)) return;
    fetchedSitemaps.add(url);
    const xml = await fetchText(url);
    if (!xml) return;
    const { urls, subSitemaps } = parseSitemapLocs(xml);
    for (const u of urls) allUrls.add(u);
    for (const sub of subSitemaps) await processSitemap(sub);
  };

  // When coming from robots.txt process all; from defaults stop at first hit.
  const fromRobots = robotsTxt
    ? candidates.filter((c) => !c.startsWith(origin + "/sitemap"))
    : [];
  if (fromRobots.length > 0) {
    for (const c of candidates) await processSitemap(c);
  } else {
    for (const c of candidates) {
      await processSitemap(c);
      if (allUrls.size > 0) break;
    }
  }

  return [...allUrls].filter((u) => {
    try {
      return new URL(u).origin.toLowerCase() === origin.toLowerCase();
    } catch {
      return false;
    }
  });
}

const MAX_REDIRECTS = 5;
const MAX_RETRIES = 3;

async function fetchPage(
  url: string,
): Promise<{ html: string; status: number; finalUrl: string } | null> {
  const headers = { "User-Agent": "misto/0.1 (+https://github.com/ablunier/misto)" };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Manually follow redirects so we can enforce the chain limit
    let currentUrl = url;
    let resp: Response | undefined;

    for (let r = 0; r <= MAX_REDIRECTS; r++) {
      try {
        resp = await fetch(currentUrl, { headers, redirect: "manual" });
      } catch {
        return null;
      }

      if (resp.status >= 300 && resp.status < 400) {
        if (r === MAX_REDIRECTS) return null; // redirect chain too long
        const location = resp.headers.get("location");
        if (!location) break;
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          return null;
        }
        continue;
      }
      break;
    }

    if (!resp) return null;

    if (resp.status === 429 && attempt < MAX_RETRIES) {
      await delay(1000 * Math.pow(2, attempt)); // 1 s, 2 s, 4 s
      continue;
    }

    const ct = resp.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;

    return { html: await resp.text(), status: resp.status, finalUrl: currentUrl };
  }

  return null;
}

export async function crawl(
  startUrl: string,
  options: CrawlOptions,
  onProgress?: (currentUrl: string, found: number) => void,
): Promise<{ pages: CrawledPage[]; failed: string[]; sitemapCount?: number }> {
  const origin = new URL(startUrl).origin.toLowerCase();
  const visited = new Set<string>();
  const queue: string[] = [startUrl];
  let sitemapCount: number | undefined;

  if (options.useSitemap) {
    const sitemapUrls = await fetchSitemapUrls(origin);
    sitemapCount = sitemapUrls.length;
    for (const u of sitemapUrls) {
      try {
        if (new URL(u).origin.toLowerCase() === origin) queue.push(u);
      } catch { /* skip */ }
    }
  }
  const pages: CrawledPage[] = [];
  const failed: string[] = [];

  while (queue.length > 0 && pages.length < options.maxPages) {
    const url = queue.shift()!;
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch {
      continue;
    }

    const key = canonicalize(urlObj);
    if (visited.has(key)) continue;
    visited.add(key);

    onProgress?.(url, pages.length);

    const result = await fetchPage(url);

    if (!result) {
      failed.push(url);
      if (queue.length > 0) await delay(options.delayMs);
      continue;
    }

    // Mark final URL as visited too (after redirect)
    if (result.finalUrl !== url) {
      try {
        visited.add(canonicalize(new URL(result.finalUrl)));
      } catch {
        // ignore
      }
    }

    const doc = new DOMParser().parseFromString(result.html, "text/html");
    if (!doc) {
      failed.push(url);
      if (queue.length > 0) await delay(options.delayMs);
      continue;
    }

    if (options.respectRobots && hasNoFollow(doc)) {
      if (queue.length > 0) await delay(options.delayMs);
      continue;
    }

    pages.push({
      url: result.finalUrl,
      title: extractTitle(doc),
      statusCode: result.status,
      rawHtml: result.html,
    });

    const base = new URL(result.finalUrl);
    for (const link of extractLinks(doc, base, origin)) {
      const linkKey = canonicalize(new URL(link));
      if (!visited.has(linkKey)) {
        queue.push(link);
      }
    }

    if (queue.length > 0) await delay(options.delayMs);
  }

  return { pages, failed, sitemapCount };
}
