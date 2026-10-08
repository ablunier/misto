import { assertEquals, assertStringIncludes } from "@std/assert";
import { canonicalKey } from "../scripts/lib/crawler.ts";
import { mapUrl, rewriteFragment, rewriteSource } from "../scripts/lib/rewrite.ts";

const options = {
  origin: "https://example.com",
  baseUrl: "https://example.com/blog/post",
  manifest: {
    "https://example.com/css/style.css": "/assets/css/style.css",
    "https://example.com/other/style.css": "/assets/css/style_2.css",
    "https://example.com/img/a.png": "/assets/img/a.png",
    "https://example.com/": "/assets/img/asset",
  },
  urlPathMap: new Map([
    [canonicalKey("https://example.com/?p=72"), "/my-post/"],
    [canonicalKey("https://example.com/about"), "/about/"],
  ]),
};

Deno.test("mapUrl: a downloaded asset maps to its manifest path", () => {
  assertEquals(mapUrl("/other/style.css", options), "/assets/css/style_2.css");
});

Deno.test("mapUrl: relative references resolve against the page", () => {
  assertEquals(mapUrl("../img/a.png", options), "/assets/img/a.png");
});

Deno.test("mapUrl: a crawled page maps to its new path and keeps the fragment", () => {
  assertEquals(mapUrl("https://example.com/?p=72#comments", options), "/my-post/#comments");
  assertEquals(mapUrl("http://example.com/about/", options), "/about/");
});

Deno.test("mapUrl: unknown same-site URL becomes root-relative", () => {
  assertEquals(mapUrl("https://example.com/files/doc.pdf?v=1", options), "/files/doc.pdf?v=1");
});

Deno.test("mapUrl: external links and non-navigational schemes are left alone", () => {
  assertEquals(mapUrl("https://other.org/x", options), null);
  assertEquals(mapUrl("mailto:a@example.com", options), null);
  assertEquals(mapUrl("#top", options), null);
  assertEquals(mapUrl("", options), null);
});

Deno.test("rewriteFragment: rewrites href, src, srcset and inline url()", () => {
  const out = rewriteFragment(
    `<a href="/about">About</a><img src="/img/a.png" srcset="/img/a.png 1x, /img/b.png 2x"><div style="background:url('/img/a.png')"></div>`,
    options,
  );
  assertStringIncludes(out, `href="/about/"`);
  assertStringIncludes(out, `src="/assets/img/a.png"`);
  assertStringIncludes(out, `srcset="/assets/img/a.png 1x, /img/b.png 2x"`);
  assertStringIncludes(out, `url('/assets/img/a.png')`);
});

Deno.test("rewriteFragment: a manifest entry for the site root does not hijack other attributes", () => {
  // The string-based rewriter turned every `="/"` into a link to that asset.
  const out = rewriteFragment(`<a href="/about">x</a><input value="/"><p>see /about</p>`, options);
  assertStringIncludes(out, `value="/"`);
  assertStringIncludes(out, `<p>see /about</p>`);
});

Deno.test("rewriteSource: keeps the document structure and doctype", () => {
  const out = rewriteSource(
    `<!DOCTYPE html><html lang="gl"><head><link rel="stylesheet" href="/css/style.css"></head><body><a href="/about">x</a></body></html>`,
    { ...options, vento: "literal" },
  );
  assertStringIncludes(out, "<!DOCTYPE html>");
  assertStringIncludes(out, `<html lang="gl">`);
  assertStringIncludes(out, `href="/assets/css/style.css"`);
});

Deno.test("rewriteSource: literal {{ in crawled markup is escaped", () => {
  const out = rewriteSource(`<p>Use {{ name }} here</p>`, { ...options, vento: "literal" });
  assertEquals(out, `<p>Use {{ "{{" }} name }} here</p>`);
});

Deno.test("rewriteSource: Vento tags and front matter of a template survive untouched", () => {
  const source = `---\ntitle: x\n---\n<a href="{{ "/about" |> url }}">a</a>{{ if a > b && c }}<img src="/img/a.png">{{ /if }}{{ content }}`;
  const out = rewriteSource(source, { ...options, vento: "tags" });
  assertStringIncludes(out, `---\ntitle: x\n---\n`);
  assertStringIncludes(out, `href="{{ "/about" |> url }}"`);
  assertStringIncludes(out, `{{ if a > b && c }}<img src="/assets/img/a.png">{{ /if }}{{ content }}`);
});
