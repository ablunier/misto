import { assertEquals, assertStringIncludes } from "@std/assert";
import { pageOutputPath, rewriteInternalLinks, rewritePaths, yamlStr } from "./generator.ts";
import type { AssetManifest } from "./types.ts";

// pageOutputPath

Deno.test("pageOutputPath: root URL maps to index.vto", () => {
  assertEquals(pageOutputPath("https://example.com/", "https://example.com"), "index.vto");
});

Deno.test("pageOutputPath: root with no trailing slash maps to index.vto", () => {
  assertEquals(pageOutputPath("https://example.com", "https://example.com"), "index.vto");
});

Deno.test("pageOutputPath: top-level page maps to page.vto", () => {
  assertEquals(pageOutputPath("https://example.com/about", "https://example.com"), "about.vto");
});

Deno.test("pageOutputPath: nested page preserves directory structure", () => {
  assertEquals(
    pageOutputPath("https://example.com/blog/my-post", "https://example.com"),
    "blog/my-post.vto",
  );
});

Deno.test("pageOutputPath: strips trailing slash from page path", () => {
  assertEquals(
    pageOutputPath("https://example.com/about/", "https://example.com"),
    "about.vto",
  );
});

Deno.test("pageOutputPath: query-param root URL with slug maps to slug.vto", () => {
  assertEquals(
    pageOutputPath("https://example.com/?p=56", "https://example.com", "hello-world"),
    "hello-world.vto",
  );
});

Deno.test("pageOutputPath: query-param URL with path and slug nests under directory", () => {
  assertEquals(
    pageOutputPath("https://example.com/blog/?p=56", "https://example.com", "my-post"),
    "blog/my-post.vto",
  );
});

Deno.test("pageOutputPath: slug without query string still uses slug", () => {
  assertEquals(
    pageOutputPath("https://example.com/", "https://example.com", "override"),
    "override.vto",
  );
});

// yamlStr

Deno.test("yamlStr: simple alphanumeric string needs no quotes", () => {
  assertEquals(yamlStr("Hello World"), "Hello World");
});

Deno.test("yamlStr: string with colon gets quoted", () => {
  const result = yamlStr("Title: Subtitle");
  assertStringIncludes(result, '"');
});

Deno.test("yamlStr: string with hash gets quoted", () => {
  const result = yamlStr("Page #1");
  assertStringIncludes(result, '"');
});

Deno.test("yamlStr: string with leading space gets quoted", () => {
  const result = yamlStr(" leading");
  assertStringIncludes(result, '"');
});

Deno.test("yamlStr: string with trailing space gets quoted", () => {
  const result = yamlStr("trailing ");
  assertStringIncludes(result, '"');
});

Deno.test("yamlStr: string with double quote escapes it", () => {
  const result = yamlStr(`Say "hello"`);
  assertStringIncludes(result, '\\"');
});

Deno.test("yamlStr: string with backslash escapes it", () => {
  const result = yamlStr("path\\to\\file");
  assertStringIncludes(result, "\\\\");
});

Deno.test("yamlStr: string with newline gets quoted", () => {
  const result = yamlStr("line1\nline2");
  assertStringIncludes(result, '"');
});

Deno.test("yamlStr: string with bracket gets quoted", () => {
  const result = yamlStr("[item]");
  assertStringIncludes(result, '"');
});

// rewritePaths

function manifest(map: Record<string, string>): AssetManifest {
  return { map, failed: [] };
}

Deno.test("rewritePaths: replaces absolute URL in HTML", () => {
  const html = `<img src="https://example.com/img/logo.png">`;
  const result = rewritePaths(html, manifest({ "https://example.com/img/logo.png": "/assets/img/logo.png" }));
  assertEquals(result, `<img src="/assets/img/logo.png">`);
});

Deno.test("rewritePaths: replaces root-relative URL in HTML", () => {
  const html = `<link href="/css/style.css">`;
  const result = rewritePaths(
    html,
    manifest({ "https://example.com/css/style.css": "/assets/css/style.css" }),
  );
  assertStringIncludes(result, "/assets/css/style.css");
});

Deno.test("rewritePaths: leaves URLs not in manifest untouched", () => {
  const html = `<img src="https://cdn.other.com/photo.jpg">`;
  const result = rewritePaths(html, manifest({}));
  assertEquals(result, html);
});

Deno.test("rewritePaths: replaces all occurrences of the same URL", () => {
  const html = `<img src="https://example.com/logo.png"><img src="https://example.com/logo.png">`;
  const result = rewritePaths(
    html,
    manifest({ "https://example.com/logo.png": "/assets/img/logo.png" }),
  );
  assertEquals(result.includes("https://example.com/logo.png"), false);
});

// rewriteInternalLinks

Deno.test("rewriteInternalLinks: rewrites same-origin href to pathname", () => {
  const html = `<a href="https://example.com/about">About</a>`;
  const result = rewriteInternalLinks(html, "https://example.com");
  assertEquals(result, `<a href="/about">About</a>`);
});

Deno.test("rewriteInternalLinks: preserves external href", () => {
  const html = `<a href="https://other.com/page">External</a>`;
  const result = rewriteInternalLinks(html, "https://example.com");
  assertEquals(result, html);
});

Deno.test("rewriteInternalLinks: rewrites action attribute", () => {
  const html = `<form action="https://example.com/submit">`;
  const result = rewriteInternalLinks(html, "https://example.com");
  assertEquals(result, `<form action="/submit">`);
});

Deno.test("rewriteInternalLinks: rewrites content attribute (canonical)", () => {
  const html = `<link rel="canonical" content="https://example.com/page">`;
  const result = rewriteInternalLinks(html, "https://example.com");
  assertStringIncludes(result, `content="/page"`);
});

Deno.test("rewriteInternalLinks: rewrites multiple links in one HTML string", () => {
  const html = `<a href="https://example.com/a">A</a><a href="https://example.com/b">B</a>`;
  const result = rewriteInternalLinks(html, "https://example.com");
  assertEquals(result, `<a href="/a">A</a><a href="/b">B</a>`);
});

Deno.test("rewriteInternalLinks: uses urlPathMap to resolve query-param URL to slug path", () => {
  const urlPathMap = new Map([["https://example.com/?p=56", "/hello-world/"]]);
  const html = `<a href="https://example.com/?p=56">Post</a>`;
  const result = rewriteInternalLinks(html, "https://example.com", urlPathMap);
  assertEquals(result, `<a href="/hello-world/">Post</a>`);
});

Deno.test("rewriteInternalLinks: urlPathMap strips fragment before lookup", () => {
  const urlPathMap = new Map([["https://example.com/?p=56", "/hello-world/"]]);
  const html = `<a href="https://example.com/?p=56#section">Post</a>`;
  const result = rewriteInternalLinks(html, "https://example.com", urlPathMap);
  assertEquals(result, `<a href="/hello-world/">Post</a>`);
});

Deno.test("rewriteInternalLinks: falls back to pathname for unmapped same-origin URL when map provided", () => {
  const urlPathMap = new Map([["https://example.com/?p=1", "/post-one/"]]);
  const html = `<a href="https://example.com/about">About</a>`;
  const result = rewriteInternalLinks(html, "https://example.com", urlPathMap);
  assertEquals(result, `<a href="/about">About</a>`);
});

Deno.test("rewriteInternalLinks: rewrites http:// link when origin uses https://", () => {
  const html = `<a href="http://example.com/about">About</a>`;
  const result = rewriteInternalLinks(html, "https://example.com");
  assertEquals(result, `<a href="/about">About</a>`);
});
