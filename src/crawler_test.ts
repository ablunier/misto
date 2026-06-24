import { assertEquals } from "@std/assert";
import { normalizeUrl, parseSitemapLocs, titleToSlug } from "./crawler.ts";

// normalizeUrl

Deno.test("normalizeUrl: adds https to schemeless input", () => {
  assertEquals(normalizeUrl("example.com"), "https://example.com/");
});

Deno.test("normalizeUrl: lowercases hostname", () => {
  assertEquals(normalizeUrl("HTTPS://Example.COM/path"), "https://example.com/path");
});

Deno.test("normalizeUrl: strips trailing slash from non-root path", () => {
  assertEquals(normalizeUrl("https://example.com/path/"), "https://example.com/path");
});

Deno.test("normalizeUrl: preserves trailing slash on root", () => {
  assertEquals(normalizeUrl("https://example.com/"), "https://example.com/");
});

Deno.test("normalizeUrl: strips fragment", () => {
  assertEquals(normalizeUrl("https://example.com/page#section"), "https://example.com/page");
});

Deno.test("normalizeUrl: preserves query string", () => {
  assertEquals(normalizeUrl("https://example.com/search?q=hello"), "https://example.com/search?q=hello");
});

Deno.test("normalizeUrl: strips both trailing slash and fragment", () => {
  assertEquals(normalizeUrl("https://example.com/path/#anchor"), "https://example.com/path");
});

// parseSitemapLocs

Deno.test("parseSitemapLocs: extracts URLs from urlset", () => {
  const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/</loc></url>
  <url><loc>https://example.com/about</loc></url>
</urlset>`;
  const result = parseSitemapLocs(xml);
  assertEquals(result.urls, ["https://example.com/", "https://example.com/about"]);
  assertEquals(result.subSitemaps, []);
});

Deno.test("parseSitemapLocs: extracts sub-sitemaps from sitemapindex", () => {
  const xml = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
  <sitemap><loc>https://example.com/sitemap-posts.xml</loc></sitemap>
</sitemapindex>`;
  const result = parseSitemapLocs(xml);
  assertEquals(result.urls, []);
  assertEquals(result.subSitemaps, [
    "https://example.com/sitemap-pages.xml",
    "https://example.com/sitemap-posts.xml",
  ]);
});

Deno.test("parseSitemapLocs: returns empty arrays for empty XML", () => {
  const result = parseSitemapLocs("<root></root>");
  assertEquals(result.urls, []);
  assertEquals(result.subSitemaps, []);
});

Deno.test("parseSitemapLocs: ignores whitespace-only loc elements", () => {
  const xml = `<urlset><url><loc>   </loc></url><url><loc>https://example.com/</loc></url></urlset>`;
  const result = parseSitemapLocs(xml);
  assertEquals(result.urls, ["https://example.com/"]);
});

// titleToSlug

Deno.test("titleToSlug: lowercases and hyphenates words", () => {
  assertEquals(titleToSlug("Hello World"), "hello-world");
});

Deno.test("titleToSlug: strips diacritics", () => {
  assertEquals(titleToSlug("Héllo Wörld"), "hello-world");
});

Deno.test("titleToSlug: removes special characters", () => {
  assertEquals(titleToSlug("My Post #1 & More!"), "my-post-1-more");
});

Deno.test("titleToSlug: collapses multiple spaces", () => {
  assertEquals(titleToSlug("  multiple   spaces  "), "multiple-spaces");
});

Deno.test("titleToSlug: collapses consecutive hyphens", () => {
  assertEquals(titleToSlug("hello -- world"), "hello-world");
});

Deno.test("titleToSlug: trims leading and trailing hyphens", () => {
  assertEquals(titleToSlug("!hello!"), "hello");
});

Deno.test("titleToSlug: preserves numbers", () => {
  assertEquals(titleToSlug("Post 123"), "post-123");
});

Deno.test("titleToSlug: returns 'page' for empty string", () => {
  assertEquals(titleToSlug(""), "page");
});

Deno.test("titleToSlug: returns 'page' for all-special-char string", () => {
  assertEquals(titleToSlug("!!!"), "page");
});

Deno.test("titleToSlug: truncates very long titles to 100 characters", () => {
  const long = "word ".repeat(80).trim(); // 399 chars
  const result = titleToSlug(long);
  assertEquals(result.length <= 100, true);
  assertEquals(result.endsWith("-"), false);
});
