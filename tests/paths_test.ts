import { assertEquals } from "@std/assert";
import {
  buildUrlPathMap,
  outputPathForUrl,
  pageCanonicalPath,
  pageOutputPath,
  siteFileCandidates,
} from "../scripts/lib/paths.ts";
import { canonicalKey } from "../scripts/lib/crawler.ts";

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

// pageCanonicalPath

Deno.test("pageCanonicalPath: adds a trailing slash", () => {
  assertEquals(pageCanonicalPath("https://example.com/about"), "/about/");
});

Deno.test("pageCanonicalPath: keeps a path with a file extension", () => {
  assertEquals(pageCanonicalPath("https://example.com/old/page.html"), "/old/page.html");
});

Deno.test("pageCanonicalPath: query-string page uses its slug", () => {
  assertEquals(pageCanonicalPath("https://example.com/?p=72", "my-post"), "/my-post/");
});

// outputPathForUrl

Deno.test("outputPathForUrl: directory URL maps to a .vto file", () => {
  assertEquals(outputPathForUrl("/blog/2/"), "blog/2.vto");
  assertEquals(outputPathForUrl("/"), "index.vto");
});

// buildUrlPathMap

Deno.test("buildUrlPathMap: overrides win over the derived path", () => {
  const pages = [
    { id: "0001", url: "https://example.com/blog/", title: "", status: 200, file: "" },
    { id: "0002", url: "https://example.com/blog/?page=2", title: "", status: 200, slug: "blog", file: "" },
  ];
  const map = buildUrlPathMap(pages, { "https://example.com/blog/?page=2": "/blog/2/" });
  assertEquals(map.get(canonicalKey("https://example.com/blog")), "/blog/");
  assertEquals(map.get(canonicalKey("https://example.com/blog/?page=2")), "/blog/2/");
});

// siteFileCandidates

Deno.test("siteFileCandidates: directory path resolves to its index.html", () => {
  assertEquals(siteFileCandidates("/about/"), ["about/index.html"]);
  assertEquals(siteFileCandidates("/"), ["index.html"]);
});

Deno.test("siteFileCandidates: file path is tried as is and as a directory", () => {
  assertEquals(siteFileCandidates("/assets/css/a.css?v=2"), ["assets/css/a.css", "assets/css/a.css/index.html", "assets/css/a.css.html"]);
});
