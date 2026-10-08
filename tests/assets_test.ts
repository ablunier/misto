import { assertEquals } from "@std/assert";
import { extractAssets, srcsetUrls } from "../scripts/lib/assets.ts";
import { parseDocument } from "../scripts/lib/dom.ts";

function assetsOf(html: string, url = "https://example.com/page") {
  return extractAssets(parseDocument(html)!, new URL(url));
}

Deno.test("extractAssets: extracts CSS links", () => {
  const assets = assetsOf(`<html><head><link rel="stylesheet" href="/style.css"></head><body></body></html>`);
  assertEquals(assets, [{ original: "https://example.com/style.css", type: "css" }]);
});

Deno.test("extractAssets: extracts JS scripts", () => {
  const assets = assetsOf(`<html><head><script src="/app.js"></script></head><body></body></html>`);
  assertEquals(assets, [{ original: "https://example.com/app.js", type: "js" }]);
});

Deno.test("extractAssets: extracts images", () => {
  const assets = assetsOf(`<html><body><img src="/photo.png"></body></html>`);
  assertEquals(assets, [{ original: "https://example.com/photo.png", type: "img" }]);
});

Deno.test("extractAssets: extracts srcset candidates", () => {
  const assets = assetsOf(`<html><body><img srcset="/a.png 1x, /b.png 2x"></body></html>`);
  assertEquals(assets.map((a) => a.original), ["https://example.com/a.png", "https://example.com/b.png"]);
});

Deno.test("extractAssets: extracts favicon and og:image", () => {
  const assets = assetsOf(
    `<html><head><link rel="icon" href="/favicon.ico"><meta property="og:image" content="https://example.com/og.jpg"></head><body></body></html>`,
  );
  assertEquals(assets.map((a) => a.original), ["https://example.com/favicon.ico", "https://example.com/og.jpg"]);
});

Deno.test("extractAssets: deduplicates assets by URL", () => {
  const assets = assetsOf(
    `<html><head><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/style.css"></head><body></body></html>`,
  );
  assertEquals(assets.length, 1);
});

Deno.test("extractAssets: resolves relative URLs against the page URL", () => {
  const assets = assetsOf(
    `<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>`,
    "https://example.com/section/page",
  );
  assertEquals(assets[0].original, "https://example.com/section/style.css");
});

Deno.test("extractAssets: discovers url() in <style> blocks and style attributes", () => {
  const assets = assetsOf(
    `<html><head><style>.a{background:url('/bg.png')}</style></head><body><div style="background:url(/hero.jpg)"></div></body></html>`,
  );
  assertEquals(assets.map((a) => a.original), ["https://example.com/bg.png", "https://example.com/hero.jpg"]);
});

Deno.test("extractAssets: skips data: URIs and SVG fragment references", () => {
  const assets = assetsOf(
    `<html><body><div style="background:url(data:image/png;base64,AAA)"></div><svg style="fill:url(#gradient)"></svg></body></html>`,
  );
  assertEquals(assets, []);
});

Deno.test("srcsetUrls: drops descriptors", () => {
  assertEquals(srcsetUrls("a.png 480w, b.png 800w"), ["a.png", "b.png"]);
  assertEquals(srcsetUrls("only.png"), ["only.png"]);
});
