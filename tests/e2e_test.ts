import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { main as crawl } from "../scripts/crawl.ts";
import { main as download } from "../scripts/download.ts";
import { main as extract } from "../scripts/extract.ts";
import { main as inspect } from "../scripts/inspect.ts";
import { main as rewrite } from "../scripts/rewrite.ts";
import { main as verify } from "../scripts/verify.ts";
import { EXIT } from "../scripts/lib/cli.ts";

/**
 * The whole skill pipeline against a small site served locally: two templates,
 * a paginated list with query-string URLs, two stylesheets sharing a filename
 * and a page showing literal template syntax.
 */

const chrome = (body: string, css = "/css/style.css") =>
  `<!DOCTYPE html><html lang="gl"><head><title>T</title><link rel="stylesheet" href="${css}">
  <meta name="generator" content="TestCMS 1.0"></head><body>
  <header><a href="/"><img src="/img/logo.png" alt="logo"></a><nav><a href="/about">About</a> <a href="/blog/">Blog</a></nav></header>
  ${body}
  <footer>Footer text</footer></body></html>`;

const page = (title: string, content: string) =>
  chrome(`<main><h1>${title}</h1>${content}</main>`).replace("<title>T</title>", `<title>${title}</title>`);

const post = (title: string, content: string) =>
  chrome(
    `<div id="wrap"><article class="post"><h1>${title}</h1><time datetime="2024-01-02">2 Jan</time>${content}</article>
    <aside class="sidebar">Recent posts</aside></div>`,
    "/blog/css/style.css",
  ).replace("<title>T</title>", `<title>${title} | Blog</title>`);

const list = (n: number, items: string[]) =>
  page(
    "Blog",
    `<ul class="posts">${items.map((i) => `<li><a href="/blog/${i}">${i}</a></li>`).join("")}</ul>
     <nav class="pagination"><a rel="${n === 1 ? "next" : "prev"}" href="/blog/${n === 1 ? "?page=2" : ""}">more</a></nav>`,
  );

const PNG = new Uint8Array([137, 80, 78, 71]);

function handler(req: Request): Response {
  const url = new URL(req.url);
  const htmlResponse = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
  switch (url.pathname) {
    case "/":
      return htmlResponse(page("Home", `<p>Welcome home. <a href="about">Relative link</a></p>`));
    case "/about":
      return htmlResponse(page("About", `<p>About us text.</p><p style="background:url(/img/bg.png)">styled</p>`));
    case "/blog/":
      return htmlResponse(
        url.searchParams.get("page") === "2" ? list(2, ["second-post"]) : list(1, ["first-post", "second-post"]),
      );
    case "/blog/first-post":
      return htmlResponse(post("First post", `<p>Write <code>{{ name }}</code> in a template.</p>`));
    case "/blog/second-post":
      return htmlResponse(post("Second post", `<p>Back to <a href="/blog/?page=2">page two</a>.</p>`));
    case "/css/style.css":
      return new Response("body{background:url(../img/bg.png)}", { headers: { "content-type": "text/css" } });
    case "/blog/css/style.css":
      return new Response(".post{color:red}", { headers: { "content-type": "text/css" } });
    case "/img/logo.png":
    case "/img/bg.png":
      return new Response(PNG, { headers: { "content-type": "image/png" } });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
}

/** Run a script's `main`, returning its exit code and what it printed to stdout. */
async function run(main: (argv: string[]) => Promise<number>, argv: string[]) {
  const original = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    const code = await main(argv);
    const stdout = lines.join("\n");
    let json;
    try {
      json = JSON.parse(stdout);
    } catch { /* not every mode prints JSON */ }
    return { code, stdout, json };
  } finally {
    console.log = original;
  }
}

Deno.test("pipeline: crawl → inspect → download → extract → verify", async () => {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, handler);
  const origin = `http://127.0.0.1:${server.addr.port}`;
  const tmp = await Deno.makeTempDir({ prefix: "misto-e2e-" });
  const ws = `${tmp}/.misto`;
  const out = `${tmp}/site`;
  const read = (path: string) => Deno.readTextFile(path);

  try {
    // crawl
    const crawled = await run(crawl, ["--url", origin, "--workspace", ws, "--delay", "0"]);
    assertEquals(crawled.code, EXIT.ok);
    assertEquals(crawled.json.pages, 6);
    const index = JSON.parse(await read(`${ws}/pages.json`));
    assertEquals(index.origin, origin);
    const idOf = (path: string) => index.pages.find((p: { url: string }) => p.url === origin + path).id;

    // inspect: two templates, one paginated list
    const inspected = await run(inspect, ["--workspace", ws]);
    assertEquals(inspected.json.templates.map((t: { name: string; pages: number }) => [t.name, t.pages]), [
      ["base", 4],
      ["blog", 2],
    ]);
    assertEquals(inspected.json.templates[0].contentSelector, "main");
    assertEquals(inspected.json.templates[1].contentSelector, "article.post");
    assertEquals(inspected.json.pagination.length, 1);
    assertEquals(inspected.json.generators, { "TestCMS 1.0": 6 });
    assertEquals(inspected.json.pagesWithTemplateSyntax, 1);

    const outlined = await run(inspect, ["--workspace", ws, "--page", idOf("/blog/first-post"), "--depth", "3"]);
    assertStringIncludes(outlined.stdout, "article.post");
    const header = await run(inspect, ["--workspace", ws, "--page", idOf("/about"), "--selector", "header", "--html"]);
    assert(header.stdout.startsWith("<header>"));

    // download: the two style.css files get distinct names, CSS url() is followed
    const downloaded = await run(download, ["--workspace", ws, "--out", out]);
    assertEquals(downloaded.json.failed.total, 0);
    const manifest = JSON.parse(await read(`${ws}/assets.json`));
    assertEquals(
      new Set([manifest.map[`${origin}/css/style.css`], manifest.map[`${origin}/blog/css/style.css`]]),
      new Set(["/assets/css/style.css", "/assets/css/style_2.css"]),
    );
    assertEquals(manifest.map[`${origin}/img/bg.png`], "/assets/img/bg.png");
    assertEquals(await read(`${out}${manifest.map[`${origin}/css/style.css`]}`), "body{background:url(/assets/img/bg.png)}");

    // download again: nothing is renamed
    await run(download, ["--workspace", ws, "--out", out]);
    assertEquals(JSON.parse(await read(`${ws}/assets.json`)).map, manifest.map);

    // rewrite: a crawled page as the starting point of a layout
    const layout = await run(rewrite, ["--workspace", ws, "--page", idOf("/blog/first-post")]);
    assertStringIncludes(layout.stdout, `href="${manifest.map[`${origin}/blog/css/style.css`]}"`);
    assertStringIncludes(layout.stdout, `src="/assets/img/logo.png"`);
    assertStringIncludes(layout.stdout, `<a href="/about/">About</a>`);
    assertStringIncludes(layout.stdout, `{{ "{{" }} name }}`);

    // extract
    await Deno.writeTextFile(
      `${ws}/rules.json`,
      JSON.stringify({
        defaults: { layout: "layouts/base.vto" },
        urls: { [`${origin}/blog/?page=2`]: "/blog/2/" },
        rules: [
          { name: "list", match: "/blog", skip: true },
          {
            name: "post",
            match: "/blog/*",
            content: "article.post",
            remove: ["h1", "time"],
            layout: "layouts/post.vto",
            data: { title: { selector: "article h1" }, date: { selector: "time", attr: "datetime" } },
          },
          { name: "about", match: "/about", content: "main" },
        ],
      }),
    );

    const dry = await run(extract, ["--workspace", ws, "--out", out, "--dry-run"]);
    assertEquals(dry.json.written, 3);
    assertEquals(dry.json.unmatched.total, 1); // the home page: no rule claims it
    assertEquals(dry.json.skipped, 2);
    assertEquals(await Deno.stat(`${out}/about.vto`).catch(() => null), null);

    const extracted = await run(extract, ["--workspace", ws, "--out", out]);
    assertEquals(extracted.json.byRule, { post: 2, about: 1 });

    const first = await read(`${out}/blog/first-post.vto`);
    assertStringIncludes(first, "title: First post\n");
    assertStringIncludes(first, "date: '2024-01-02'\n");
    assertStringIncludes(first, "layout: layouts/post.vto\n");
    assertStringIncludes(first, "url: /blog/first-post/\n");
    assertStringIncludes(first, "{{ echo }}<p>Write <code>{{ name }}</code> in a template.</p>{{ /echo }}");
    assertStringIncludes(await read(`${out}/blog/second-post.vto`), `<a href="/blog/2/">page two</a>`);
    assertStringIncludes(await read(`${out}/about.vto`), `url(/assets/img/bg.png)`);

    // verify against a stand-in for the built site
    const site = `${out}/_site`;
    const built = async (path: string, source: string) => {
      await Deno.mkdir(`${site}${path}`, { recursive: true });
      await Deno.writeTextFile(`${site}${path}index.html`, source);
    };
    const original = (path: string) => read(`${ws}/html/${idOf(path)}.html`);
    await built("/", await original("/"));
    await built("/about/", await original("/about"));
    await built("/blog/first-post/", await original("/blog/first-post"));
    await built("/blog/second-post/", "<html><body><p>Second post</p><a href='/nowhere/'>x</a></body></html>");

    const verified = await run(verify, ["--workspace", ws, "--site", site]);
    assertEquals(verified.code, EXIT.problems);
    assertEquals(verified.json.missing.total, 0); // the two list pages are skipped by rule
    assertEquals(verified.json.skippedByRule, 2);
    assertEquals(verified.json.textDiffers.shown.map((p: { file: string }) => p.file), ["blog/second-post/index.html"]);
    assert(verified.json.brokenLinks.shown.some((l: { target: string }) => l.target === "/nowhere/"));
  } finally {
    await server.shutdown();
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("scripts: a missing workspace is reported with what to do", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "misto-e2e-" });
  try {
    let message = "";
    try {
      await inspect(["--workspace", `${tmp}/nope`]);
    } catch (err) {
      message = (err as Error).message;
      assertEquals((err as { code: number }).code, EXIT.workspace);
    }
    assertStringIncludes(message, "Run scripts/crawl.ts first");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
