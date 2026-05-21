import { assertEquals, assertStringIncludes } from "@std/assert";
import { extractBaseLayout, extractPage } from "./extractor.ts";
import type { CrawledPage } from "./types.ts";

function makePage(rawHtml: string, url = "https://example.com/page"): CrawledPage {
  return { url, title: "fallback title", statusCode: 200, rawHtml };
}

// extractPage — title

Deno.test("extractPage: uses <title> element", () => {
  const page = makePage("<html><head><title>My Title</title></head><body></body></html>");
  assertEquals(extractPage(page).title, "My Title");
});

Deno.test("extractPage: falls back to <h1> when no <title>", () => {
  const page = makePage("<html><body><h1>Heading Title</h1></body></html>");
  assertEquals(extractPage(page).title, "Heading Title");
});

Deno.test("extractPage: falls back to page.title when neither present", () => {
  const page = makePage("<html><body><p>No heading</p></body></html>");
  assertEquals(extractPage(page).title, "fallback title");
});

// extractPage — description

Deno.test("extractPage: extracts meta description", () => {
  const page = makePage(
    `<html><head><meta name="description" content="Page summary"></head><body></body></html>`,
  );
  assertEquals(extractPage(page).description, "Page summary");
});

Deno.test("extractPage: returns empty description when absent", () => {
  const page = makePage("<html><body></body></html>");
  assertEquals(extractPage(page).description, "");
});

// extractPage — contentHtml selection priority

Deno.test("extractPage: prefers <main> for content", () => {
  const page = makePage(
    `<html><body><nav>nav</nav><main><p>Main content</p></main></body></html>`,
  );
  assertStringIncludes(extractPage(page).contentHtml, "Main content");
});

Deno.test("extractPage: falls back to [role=main]", () => {
  const page = makePage(
    `<html><body><div role="main"><p>Role main content</p></div></body></html>`,
  );
  assertStringIncludes(extractPage(page).contentHtml, "Role main content");
});

Deno.test("extractPage: falls back to <article>", () => {
  const page = makePage(
    `<html><body><article><p>Article content</p></article></body></html>`,
  );
  assertStringIncludes(extractPage(page).contentHtml, "Article content");
});

Deno.test("extractPage: falls back to <body>", () => {
  const page = makePage(`<html><body><p>Body content</p></body></html>`);
  assertStringIncludes(extractPage(page).contentHtml, "Body content");
});

Deno.test("extractPage: strips <script> and <style> from content", () => {
  const page = makePage(
    `<html><body><main><p>Kept</p><script>alert(1)</script><style>body{}</style></main></body></html>`,
  );
  const { contentHtml } = extractPage(page);
  assertStringIncludes(contentHtml, "Kept");
  assertEquals(contentHtml.includes("<script>"), false);
  assertEquals(contentHtml.includes("<style>"), false);
});

// extractPage — asset extraction

Deno.test("extractPage: extracts CSS links", () => {
  const page = makePage(
    `<html><head><link rel="stylesheet" href="/style.css"></head><body></body></html>`,
  );
  const assets = extractPage(page).assetUrls;
  assertEquals(assets.length, 1);
  assertEquals(assets[0].type, "css");
  assertEquals(assets[0].original, "https://example.com/style.css");
});

Deno.test("extractPage: extracts JS scripts", () => {
  const page = makePage(
    `<html><head><script src="/app.js"></script></head><body></body></html>`,
  );
  const assets = extractPage(page).assetUrls;
  assertEquals(assets.length, 1);
  assertEquals(assets[0].type, "js");
  assertEquals(assets[0].original, "https://example.com/app.js");
});

Deno.test("extractPage: extracts images", () => {
  const page = makePage(
    `<html><body><img src="/photo.png"></body></html>`,
  );
  const assets = extractPage(page).assetUrls;
  assertEquals(assets.length, 1);
  assertEquals(assets[0].type, "img");
  assertEquals(assets[0].original, "https://example.com/photo.png");
});

Deno.test("extractPage: extracts favicon", () => {
  const page = makePage(
    `<html><head><link rel="icon" href="/favicon.ico"></head><body></body></html>`,
  );
  const assets = extractPage(page).assetUrls;
  assertEquals(assets.some((a) => a.original === "https://example.com/favicon.ico"), true);
});

Deno.test("extractPage: extracts og:image", () => {
  const page = makePage(
    `<html><head><meta property="og:image" content="https://example.com/og.jpg"></head><body></body></html>`,
  );
  const assets = extractPage(page).assetUrls;
  assertEquals(assets.some((a) => a.original === "https://example.com/og.jpg"), true);
});

Deno.test("extractPage: deduplicates assets by URL", () => {
  const page = makePage(
    `<html><head>
      <link rel="stylesheet" href="/style.css">
      <link rel="stylesheet" href="/style.css">
    </head><body></body></html>`,
  );
  const assets = extractPage(page).assetUrls;
  const cssAssets = assets.filter((a) => a.type === "css");
  assertEquals(cssAssets.length, 1);
});

Deno.test("extractPage: resolves relative asset URLs against page URL", () => {
  const page = makePage(
    `<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>`,
    "https://example.com/section/page",
  );
  const assets = extractPage(page).assetUrls;
  assertEquals(assets[0].original, "https://example.com/section/style.css");
});

// extractBaseLayout

Deno.test("extractBaseLayout: injects {{ content }} into <main>", () => {
  const page = makePage(
    `<html><body><main><p>Original</p></main></body></html>`,
  );
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "{{ content }}");
  assertEquals(layout.includes("<p>Original</p>"), false);
});

Deno.test("extractBaseLayout: injects {{ content }} into <article> when no <main>", () => {
  const page = makePage(
    `<html><body><article><p>Article</p></article></body></html>`,
  );
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "{{ content }}");
});

Deno.test("extractBaseLayout: injects {{ content }} into <body> as last resort", () => {
  const page = makePage(`<html><body><p>Content</p></body></html>`);
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "{{ content }}");
});

Deno.test("extractBaseLayout: rewrites local CSS href to /assets/css/", () => {
  const page = makePage(
    `<html><head><link rel="stylesheet" href="/css/style.css"></head><body><main></main></body></html>`,
  );
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "/assets/css/style.css");
});

Deno.test("extractBaseLayout: rewrites local JS src to /assets/js/", () => {
  const page = makePage(
    `<html><head><script src="/js/app.js"></script></head><body><main></main></body></html>`,
  );
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "/assets/js/app.js");
});

Deno.test("extractBaseLayout: rewrites local img src to /assets/img/", () => {
  const page = makePage(
    `<html><body><main></main><img src="/images/logo.png"></body></html>`,
  );
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "/assets/img/logo.png");
});

Deno.test("extractBaseLayout: preserves external CSS href", () => {
  const page = makePage(
    `<html><head><link rel="stylesheet" href="https://cdn.example.net/reset.css"></head><body><main></main></body></html>`,
  );
  const layout = extractBaseLayout(page);
  assertStringIncludes(layout, "https://cdn.example.net/reset.css");
});
