import { assertEquals } from "@std/assert";
import { parseDocument } from "../scripts/lib/dom.ts";
import { buildHints, chromeSkeleton, findContentRegion, outline, uniqueSelector } from "../scripts/lib/hints.ts";
import type { PageEntry } from "../scripts/lib/types.ts";

function entry(id: string, url: string, slug?: string): PageEntry {
  return { id, url, title: "", status: 200, file: `html/${id}.html`, ...(slug ? { slug } : {}) };
}

const page = (main: string, extra = "") =>
  `<html lang="gl"><head><meta name="generator" content="WordPress 6.4"></head><body class="page-id-7">
  <header id="top"><nav><a class="current" href="/">Home</a></nav></header>
  <main class="site-main">${main}</main>${extra}
  <footer class="site-footer">f</footer></body></html>`;

Deno.test("findContentRegion: prefers <main>", () => {
  const doc = parseDocument(`<body><main><article>a</article><article>b</article></main></body>`)!;
  assertEquals(findContentRegion(doc)?.tagName, "MAIN");
});

Deno.test("findContentRegion: refuses to pick among several articles", () => {
  const doc = parseDocument(`<body><div><article>a</article><article>b</article></div></body>`)!;
  assertEquals(findContentRegion(doc), null);
});

Deno.test("findContentRegion: takes a lone article", () => {
  const doc = parseDocument(`<body><div><article class="post">a</article></div></body>`)!;
  assertEquals(findContentRegion(doc)?.tagName, "ARTICLE");
});

Deno.test("uniqueSelector: qualifies with the parent until the match is unique", () => {
  const doc = parseDocument(`<body><div class="a"><p class="x">1</p></div><div class="b"><p class="x">2</p></div></body>`)!;
  const second = doc.querySelectorAll("p")[1];
  // deno-lint-ignore no-explicit-any
  assertEquals(uniqueSelector(doc, second as any), "div.b > p.x");
});

Deno.test("chromeSkeleton: ignores per-page state and numbering", () => {
  const a = parseDocument(`<body><header class="h current-menu"></header><main id="post-12" class="x"><p>a</p></main><footer></footer></body>`)!;
  const b = parseDocument(`<body><header class="h"></header><main id="post-99" class="y"><h1>b</h1></main><script></script><footer></footer></body>`)!;
  assertEquals(chromeSkeleton(a, findContentRegion(a)), chromeSkeleton(b, findContentRegion(b)));
  assertEquals(chromeSkeleton(a, findContentRegion(a)), ["body: header.h [main#post-#] footer"]);
});

Deno.test("buildHints: clusters pages by shared chrome and names the largest base", () => {
  const hints = buildHints("https://example.com", [
    { entry: entry("0001", "https://example.com/"), html: page("<p>home</p>") },
    { entry: entry("0002", "https://example.com/about"), html: page("<h1>About</h1>") },
    { entry: entry("0003", "https://example.com/docs/a"), html: page("<h1>A</h1>", `<aside class="toc">t</aside>`) },
  ]);
  assertEquals(hints.templates.map((t) => [t.name, t.pages]), [["base", 2], ["docs", 1]]);
  assertEquals(hints.templates[0].contentSelector, "main.site-main");
  assertEquals(hints.templates[1].pageIds, ["0003"]);
  assertEquals(hints.languages, { gl: 3 });
  assertEquals(hints.generators, { "WordPress 6.4": 3 });
  assertEquals(hints.cruft[0], { kind: "cms-head", what: 'meta[name="generator"]', pages: 3 });
});

Deno.test("buildHints: reports pagination only when the page has a pagination nav", () => {
  const list = `<ul class="posts"><li>1</li><li>2</li><li>3</li></ul>`;
  const nav = `<nav class="pagination"><a rel="next" href="?page=2">next</a></nav>`;
  const hints = buildHints("https://example.com", [
    { entry: entry("0001", "https://example.com/blog/"), html: page(list + nav) },
    { entry: entry("0002", "https://example.com/blog/?page=2", "blog"), html: page(list + nav) },
    { entry: entry("0003", "https://example.com/?p=5", "five"), html: page("<p>post five</p>") },
    { entry: entry("0004", "https://example.com/?p=6", "six"), html: page("<p>post six</p>") },
  ]);
  assertEquals(hints.pagination.length, 1);
  assertEquals(hints.pagination[0].pages.map((p) => p.n), [1, 2]);
  assertEquals(hints.pagination[0].list, { selector: "ul.posts", itemsOnFirstPage: 3 });
  assertEquals(hints.queryStringPages, 3);
});

Deno.test("buildHints: finds search forms and literal template syntax", () => {
  const hints = buildHints("https://example.com", [
    {
      entry: entry("0001", "https://example.com/"),
      html: page(`<form action="/search"><input type="search" name="q"></form><code>{{ x }}</code>`),
    },
  ]);
  assertEquals(hints.searchForms, [{ action: "https://example.com/search", pages: 1 }]);
  assertEquals(hints.pagesWithTemplateSyntax, 1);
});

Deno.test("outline: collapses repeated siblings and stops at the depth limit", () => {
  const doc = parseDocument(`<body><ul class="l"><li><a>one</a></li><li><a>two</a></li></ul></body>`)!;
  // deno-lint-ignore no-explicit-any
  const lines = outline(doc, doc.querySelector("ul") as any, 1);
  assertEquals(lines, ["ul.l (6 chars)", "  li ×2 (3 chars) … 1 children"]);
});
