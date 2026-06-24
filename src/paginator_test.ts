import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  detectPaginationGroups,
  extractListStructure,
  generatePaginatorFile,
  hasPaginationSignal,
  pageNumber,
  paginationUrl,
  stripPageIndicator,
} from "./paginator.ts";
import type { AssetManifest, ExtractedPage } from "./types.ts";

// ---------------------------------------------------------------------------
// stripPageIndicator
// ---------------------------------------------------------------------------

Deno.test("stripPageIndicator: strips ?page=N query param", () => {
  const result = stripPageIndicator("https://example.com/blog/?page=2");
  assertEquals(result.includes("page="), false);
  assertStringIncludes(result, "example.com/blog");
});

Deno.test("stripPageIndicator: leaves URL without page indicator unchanged", () => {
  const result = stripPageIndicator("https://example.com/blog/");
  assertStringIncludes(result, "example.com");
  assertEquals(result.includes("page="), false);
});

Deno.test("stripPageIndicator: strips ?paged=N", () => {
  const result = stripPageIndicator("https://example.com/?paged=3");
  assertEquals(result.includes("paged="), false);
});

Deno.test("stripPageIndicator: strips /page/N/ path segment", () => {
  const result = stripPageIndicator("https://example.com/blog/page/2/");
  assertEquals(result.includes("/page/2"), false);
});

Deno.test("stripPageIndicator: two paginated URLs share the same base key", () => {
  const base1 = stripPageIndicator("https://example.com/blog/?page=2");
  const base2 = stripPageIndicator("https://example.com/blog/?page=3");
  assertEquals(base1, base2);
});

Deno.test("stripPageIndicator: page-1 URL (no indicator) matches paginated URLs", () => {
  const base1 = stripPageIndicator("https://example.com/es/");
  const base2 = stripPageIndicator("https://example.com/es/?page=2");
  assertEquals(base1, base2);
});

// ---------------------------------------------------------------------------
// pageNumber
// ---------------------------------------------------------------------------

Deno.test("pageNumber: returns 1 for URL with no page indicator", () => {
  assertEquals(pageNumber("https://example.com/blog/"), 1);
});

Deno.test("pageNumber: returns N for ?page=N", () => {
  assertEquals(pageNumber("https://example.com/blog/?page=3"), 3);
});

Deno.test("pageNumber: returns N for ?paged=N", () => {
  assertEquals(pageNumber("https://example.com/?paged=5"), 5);
});

// ---------------------------------------------------------------------------
// hasPaginationSignal
// ---------------------------------------------------------------------------

Deno.test("hasPaginationSignal: detects class containing 'pag'", () => {
  const html = `<nav class="pagination-wrapper"><ul><li><a href="/2">2</a></li></ul></nav>`;
  assertEquals(hasPaginationSignal(html), true);
});

Deno.test("hasPaginationSignal: detects rel=next link", () => {
  const html = `<a href="/page/2" rel="next">Next</a>`;
  assertEquals(hasPaginationSignal(html), true);
});

Deno.test("hasPaginationSignal: returns false for plain content", () => {
  const html = `<p>Some paragraph without any pagination.</p>`;
  assertEquals(hasPaginationSignal(html), false);
});

// ---------------------------------------------------------------------------
// extractListStructure
// ---------------------------------------------------------------------------

const LIST_HTML = `
<div class="search-wrapper">
  <form method="get" action="/search"><input type="search" name="q"></form>
</div>
<ul class="items-list">
  <li><article><a href="/item/1">Item 1</a></article></li>
  <li><article><a href="/item/2">Item 2</a></article></li>
  <li><article><a href="/item/3">Item 3</a></article></li>
</ul>
<nav class="pagination-wrapper">
  <ul class="pagination-list">
    <li class="active"><span>1</span></li>
    <li><a href="/page/2">2</a></li>
  </ul>
</nav>
<footer class="site-footer">© 2024</footer>
`;

Deno.test("extractListStructure: extracts items from list container", () => {
  const result = extractListStructure(LIST_HTML);
  assertEquals(result !== null, true);
  assertEquals(result!.items.length, 3);
  assertStringIncludes(result!.items[0], "Item 1");
  assertStringIncludes(result!.items[2], "Item 3");
});

Deno.test("extractListStructure: captures list open tag with class", () => {
  const result = extractListStructure(LIST_HTML);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.listOpenTag, "items-list");
});

Deno.test("extractListStructure: prefix contains content before the list", () => {
  const result = extractListStructure(LIST_HTML);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.prefix, "search-wrapper");
});

Deno.test("extractListStructure: suffix contains content after the nav", () => {
  const result = extractListStructure(LIST_HTML);
  assertEquals(result !== null, true);
  assertStringIncludes(result!.suffix, "site-footer");
});

Deno.test("extractListStructure: returns null for content without a repeating list", () => {
  const html = `<p>A paragraph.</p><p>Another paragraph.</p>`;
  assertEquals(extractListStructure(html), null);
});

Deno.test("extractListStructure: size equals item count on the page", () => {
  const result = extractListStructure(LIST_HTML);
  assertEquals(result!.size, 3);
});

// ---------------------------------------------------------------------------
// detectPaginationGroups
// ---------------------------------------------------------------------------

function makeExtractedPage(
  url: string,
  contentHtml: string,
  title = "Test",
): ExtractedPage {
  return { url, title, description: "desc", contentHtml, assetUrls: [] };
}

const PAGE1_HTML = `
<ul class="card-list">
  <li class="card">Card A</li>
  <li class="card">Card B</li>
</ul>
<nav class="pagination-nav">
  <a href="/?page=2" rel="next">Next</a>
</nav>
`;

const PAGE2_HTML = `
<ul class="card-list">
  <li class="card">Card C</li>
</ul>
<nav class="pagination-nav">
  <a href="/" rel="prev">Prev</a>
</nav>
`;

Deno.test("detectPaginationGroups: groups ?page=N pages under the same base URL", () => {
  const pages = [
    makeExtractedPage("https://example.com/", PAGE1_HTML),
    makeExtractedPage("https://example.com/?page=2", PAGE2_HTML),
  ];
  const groups = detectPaginationGroups(pages);
  assertEquals(groups.length, 1);
});

Deno.test("detectPaginationGroups: collects items from all pages in order", () => {
  const pages = [
    makeExtractedPage("https://example.com/", PAGE1_HTML),
    makeExtractedPage("https://example.com/?page=2", PAGE2_HTML),
  ];
  const groups = detectPaginationGroups(pages);
  assertEquals(groups[0].items.length, 3);
  assertStringIncludes(groups[0].items[0], "Card A");
  assertStringIncludes(groups[0].items[2], "Card C");
});

Deno.test("detectPaginationGroups: single page is not a group", () => {
  const pages = [makeExtractedPage("https://example.com/about", "<p>About us</p>")];
  const groups = detectPaginationGroups(pages);
  assertEquals(groups.length, 0);
});

Deno.test("detectPaginationGroups: pages without pagination signal are not grouped", () => {
  // Same base URL after stripping page param, but no pagination nav
  const pages = [
    makeExtractedPage("https://example.com/", "<p>Page 1</p>"),
    makeExtractedPage("https://example.com/?page=2", "<p>Page 2</p>"),
  ];
  const groups = detectPaginationGroups(pages);
  assertEquals(groups.length, 0);
});

Deno.test("detectPaginationGroups: sets outputDir from base URL pathname", () => {
  const pages = [
    makeExtractedPage("https://example.com/blog/", PAGE1_HTML),
    makeExtractedPage("https://example.com/blog/?page=2", PAGE2_HTML),
  ];
  const groups = detectPaginationGroups(pages);
  assertEquals(groups.length, 1);
  assertEquals(groups[0].outputDir, "blog");
});

// ---------------------------------------------------------------------------
// paginationUrl
// ---------------------------------------------------------------------------

Deno.test("paginationUrl: page 1 uses base dir with trailing slash", () => {
  const group = detectPaginationGroups([
    makeExtractedPage("https://example.com/es/", PAGE1_HTML),
    makeExtractedPage("https://example.com/es/?page=2", PAGE2_HTML),
  ])[0];
  assertEquals(paginationUrl(group, 1), "/es/");
});

Deno.test("paginationUrl: page N uses base dir + number", () => {
  const group = detectPaginationGroups([
    makeExtractedPage("https://example.com/es/", PAGE1_HTML),
    makeExtractedPage("https://example.com/es/?page=2", PAGE2_HTML),
  ])[0];
  assertEquals(paginationUrl(group, 2), "/es/2/");
  assertEquals(paginationUrl(group, 3), "/es/3/");
});

// ---------------------------------------------------------------------------
// generatePaginatorFile
// ---------------------------------------------------------------------------

const EMPTY_MANIFEST: AssetManifest = { map: {}, failed: [] };

Deno.test("generatePaginatorFile: contains paginate() call", () => {
  const groups = detectPaginationGroups([
    makeExtractedPage("https://example.com/blog/", PAGE1_HTML),
    makeExtractedPage("https://example.com/blog/?page=2", PAGE2_HTML),
  ]);
  const file = generatePaginatorFile(groups[0], "https://example.com", new Map(), EMPTY_MANIFEST);
  assertStringIncludes(file, "paginate(");
});

Deno.test("generatePaginatorFile: contains the correct base dir URL scheme", () => {
  const groups = detectPaginationGroups([
    makeExtractedPage("https://example.com/blog/", PAGE1_HTML),
    makeExtractedPage("https://example.com/blog/?page=2", PAGE2_HTML),
  ]);
  const file = generatePaginatorFile(groups[0], "https://example.com", new Map(), EMPTY_MANIFEST);
  assertStringIncludes(file, "/blog/");
  assertStringIncludes(file, "/blog/");
});

Deno.test("generatePaginatorFile: references pagination nav class", () => {
  const groups = detectPaginationGroups([
    makeExtractedPage("https://example.com/", PAGE1_HTML),
    makeExtractedPage("https://example.com/?page=2", PAGE2_HTML),
  ]);
  const file = generatePaginatorFile(groups[0], "https://example.com", new Map(), EMPTY_MANIFEST);
  assertStringIncludes(file, "pagination-nav");
});

Deno.test("generatePaginatorFile: exports a generator function as default", () => {
  const groups = detectPaginationGroups([
    makeExtractedPage("https://example.com/", PAGE1_HTML),
    makeExtractedPage("https://example.com/?page=2", PAGE2_HTML),
  ]);
  const file = generatePaginatorFile(groups[0], "https://example.com", new Map(), EMPTY_MANIFEST);
  assertStringIncludes(file, "export default function*");
});

Deno.test("generatePaginatorFile: inlines all items as JSON", () => {
  const groups = detectPaginationGroups([
    makeExtractedPage("https://example.com/", PAGE1_HTML),
    makeExtractedPage("https://example.com/?page=2", PAGE2_HTML),
  ]);
  const file = generatePaginatorFile(groups[0], "https://example.com", new Map(), EMPTY_MANIFEST);
  assertStringIncludes(file, "Card A");
  assertStringIncludes(file, "Card C");
});
