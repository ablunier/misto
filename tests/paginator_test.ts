import { assertEquals, assertStringIncludes } from "@std/assert";
import { extractListStructure, hasPaginationSignal, pageNumber, stripPageIndicator } from "../scripts/lib/paginator.ts";

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

Deno.test("extractListStructure: reports a selector for the list container", () => {
  const result = extractListStructure(LIST_HTML);
  assertEquals(result?.selector, "ul.items-list");
});
