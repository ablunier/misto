import { assertEquals } from "@std/assert";
import { localFilename, rewriteCssUrls } from "./downloader.ts";

// localFilename

Deno.test("localFilename: extracts filename from URL path", () => {
  const used = new Set<string>();
  assertEquals(localFilename("https://example.com/assets/style.css", used), "style.css");
});

Deno.test("localFilename: handles deep path", () => {
  const used = new Set<string>();
  assertEquals(localFilename("https://example.com/a/b/c/logo.png", used), "logo.png");
});

Deno.test("localFilename: resolves collision by inserting _2 before extension", () => {
  const used = new Set<string>(["style.css"]);
  assertEquals(localFilename("https://example.com/other/style.css", used), "style_2.css");
});

Deno.test("localFilename: resolves multiple collisions incrementally", () => {
  const used = new Set<string>(["app.js", "app_2.js"]);
  assertEquals(localFilename("https://example.com/app.js", used), "app_3.js");
});

Deno.test("localFilename: preserves extension in collision suffix", () => {
  const used = new Set<string>(["logo.png"]);
  assertEquals(localFilename("https://example.com/logo.png", used), "logo_2.png");
});

Deno.test("localFilename: falls back to 'asset' when URL has no path segment", () => {
  const used = new Set<string>();
  assertEquals(localFilename("https://example.com/", used), "asset");
});

Deno.test("localFilename: adds resolved name to usedNames set", () => {
  const used = new Set<string>();
  localFilename("https://example.com/main.js", used);
  assertEquals(used.has("main.js"), true);
});

// rewriteCssUrls

Deno.test("rewriteCssUrls: rewrites url() when present in manifest", () => {
  const manifest = { "https://example.com/images/bg.png": "/assets/img/bg.png" };
  const css = `body { background: url(https://example.com/images/bg.png); }`;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result, `body { background: url(/assets/img/bg.png); }`);
});

Deno.test("rewriteCssUrls: rewrites url() with double quotes", () => {
  const manifest = { "https://example.com/images/bg.png": "/assets/img/bg.png" };
  const css = `body { background: url("https://example.com/images/bg.png"); }`;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result, `body { background: url("/assets/img/bg.png"); }`);
});

Deno.test("rewriteCssUrls: rewrites url() with single quotes", () => {
  const manifest = { "https://example.com/images/bg.png": "/assets/img/bg.png" };
  const css = `body { background: url('https://example.com/images/bg.png'); }`;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result, `body { background: url('/assets/img/bg.png'); }`);
});

Deno.test("rewriteCssUrls: resolves relative url() against CSS source URL", () => {
  const manifest = { "https://example.com/images/bg.png": "/assets/img/bg.png" };
  const css = `body { background: url(../images/bg.png); }`;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result, `body { background: url(/assets/img/bg.png); }`);
});

Deno.test("rewriteCssUrls: leaves url() unchanged when not in manifest", () => {
  const manifest = {};
  const css = `body { background: url(https://cdn.other.com/bg.png); }`;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result, css);
});

Deno.test("rewriteCssUrls: rewrites multiple url() calls in one stylesheet", () => {
  const manifest = {
    "https://example.com/img/a.png": "/assets/img/a.png",
    "https://example.com/img/b.png": "/assets/img/b.png",
  };
  const css = `
    .a { background: url(https://example.com/img/a.png); }
    .b { background: url(https://example.com/img/b.png); }
  `;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result.includes("/assets/img/a.png"), true);
  assertEquals(result.includes("/assets/img/b.png"), true);
});

Deno.test("rewriteCssUrls: handles data URIs without modifying them", () => {
  const manifest = {};
  const css = `body { background: url("data:image/png;base64,abc123"); }`;
  const result = rewriteCssUrls(css, "https://example.com/css/style.css", manifest);
  assertEquals(result, css);
});
