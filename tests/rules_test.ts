import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { parse } from "jsr:@std/yaml@^1.0.0";
import { CliError } from "../scripts/lib/cli.ts";
import { canonicalKey } from "../scripts/lib/crawler.ts";
import { compileRules, extractPage, matchRule, type RulesFile } from "../scripts/lib/rules.ts";
import type { PageEntry } from "../scripts/lib/types.ts";

function entry(id: string, url: string, slug?: string): PageEntry {
  return { id, url, title: "crawled title", status: 200, file: "", ...(slug ? { slug } : {}) };
}

const file: RulesFile = {
  defaults: { layout: "layouts/base.vto", remove: ["script"] },
  rules: [
    { name: "list", match: "/blog", skip: true },
    {
      name: "post",
      match: "/blog/*",
      exclude: "/blog/drafts",
      content: "article",
      layout: "layouts/post.vto",
      data: {
        title: { selector: "h1" },
        date: { selector: "time", attr: "datetime" },
        tags: { selector: ".tag", all: true },
        cover: { selector: "img.cover", attr: "src" },
        author: { selector: ".author" },
        type: "post",
        draft: false,
      },
    },
    { name: "legacy", matchUrl: "[?&]p=\\d+", content: "main" },
    { name: "picked", pages: ["0009"], content: "main" },
    { name: "page", match: "/**", content: "main" },
  ],
};
const rules = compileRules(file, "rules.json");
const name = (id: string, url: string) => matchRule(rules, entry(id, url))?.name;

Deno.test("matchRule: first matching rule wins, globs stay within a segment", () => {
  assertEquals(name("1", "https://example.com/blog/"), "list");
  assertEquals(name("2", "https://example.com/blog/hello/"), "post");
  assertEquals(name("3", "https://example.com/blog/2024/hello"), "page");
  assertEquals(name("4", "https://example.com/"), "page");
});

Deno.test("matchRule: a section glob includes the section index", () => {
  const section = compileRules({ rules: [{ name: "docs", match: "/docs/**", content: "main", layout: "l" }] }, "r");
  assertEquals(matchRule(section, entry("1", "https://example.com/docs/"))?.name, "docs");
  assertEquals(matchRule(section, entry("2", "https://example.com/docs/a/b"))?.name, "docs");
  assertEquals(matchRule(section, entry("3", "https://example.com/docsify")), null);
});

Deno.test("matchRule: exclude, matchUrl and explicit page ids", () => {
  assertEquals(name("5", "https://example.com/blog/drafts"), "page");
  assertEquals(name("6", "https://example.com/?p=72"), "legacy");
  const picked = compileRules({ defaults: file.defaults, rules: [file.rules[3]] }, "r");
  assertEquals(matchRule(picked, entry("0009", "https://example.com/x"))?.name, "picked");
  assertEquals(matchRule(picked, entry("0001", "https://example.com/x")), null);
});

Deno.test("compileRules: names the problem in an invalid file", () => {
  assertThrows(() => compileRules({ rules: [] }, "r.json"), CliError, "non-empty");
  assertThrows(() => compileRules({ rules: [{ name: "a", content: "main", layout: "l" }] }, "r.json"), CliError, '"match"');
  assertThrows(() => compileRules({ rules: [{ name: "a", match: "/**", layout: "l" }] }, "r.json"), CliError, '"content"');
  assertThrows(() => compileRules({ rules: [{ name: "a", match: "/**", content: "main" }] }, "r.json"), CliError, '"layout"');
  assertThrows(() => compileRules({ urls: { "/x": "/y/" }, rules: file.rules }, "r.json"), CliError, "absolute");
});

const html = `<html><head><title>Hello | Site</title><meta name="description" content="A post: with colon"></head>
<body><header><a href="/">Site</a></header><article>
<h1>Hello world</h1><time datetime="2024-05-01">May 1</time><span class="tag">a</span><span class="tag">b</span>
<img class="cover" src="/img/cover.png"><p>See <a href="/blog/other">other</a> and <code>{{ name }}</code>.</p>
<script>track()</script></article></body></html>`;

const options = {
  origin: "https://example.com",
  manifest: { "https://example.com/img/cover.png": "/assets/img/cover.png" },
  urlPathMap: new Map([[canonicalKey("https://example.com/blog/other"), "/blog/other/"]]),
};

Deno.test("extractPage: writes frontmatter from the page and the rule", () => {
  const result = extractPage(entry("2", "https://example.com/blog/hello"), html, file.rules.map((r) => ({ ...file.defaults, ...r }))[1], options);
  if (!result.ok) throw new Error(result.reason);
  const [, frontMatter, body] = result.page.source.split(/^---$/m);
  assertEquals(parse(frontMatter), {
    title: "Hello world",
    description: "A post: with colon",
    layout: "layouts/post.vto",
    url: "/blog/hello/",
    date: "2024-05-01",
    tags: ["a", "b"],
    cover: "/assets/img/cover.png",
    type: "post",
    draft: false,
  });
  assertEquals(result.page.outputPath, "blog/hello.vto");
  assertEquals(result.page.missingFields, ["author"]);
  assertStringIncludes(body, `<a href="/blog/other/">other</a>`);
  assertStringIncludes(body, `src="/assets/img/cover.png"`);
  assertStringIncludes(body, "{{ echo }}");
  assertEquals(body.includes("<script>"), false);
  assertEquals(body.includes("<header>"), false);
});

Deno.test("extractPage: reports a content selector that matches nothing", () => {
  const result = extractPage(entry("2", "https://example.com/x"), html, { name: "p", content: "main", layout: "l" }, options);
  assertEquals(result, { ok: false, reason: "no-content" });
});

Deno.test("extractPage: a URL override decides the output file", () => {
  const result = extractPage(
    entry("2", "https://example.com/?p=72", "hello-world"),
    html,
    { name: "p", content: "article", layout: "l" },
    { ...options, overridden: "/posts/hello/" },
  );
  if (!result.ok) throw new Error(result.reason);
  assertEquals(result.page.outputPath, "posts/hello.vto");
  assertStringIncludes(result.page.source, "url: /posts/hello/");
});
