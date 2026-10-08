---
name: misto
description: Migrates an existing website into a Lume static site project. Crawls the live site, downloads its assets, and rebuilds it as Lume layouts and pages with the original URLs kept. Use when the user wants to migrate, convert, port, clone or archive a website (WordPress, another CMS, a hand-written or legacy site) to Lume or to a static site on Deno, or to continue a migration that has a .misto workspace.
license: MIT
compatibility: Requires Deno 2+ and internet access (to crawl the site and to install Lume).
metadata:
  version: "0.2.0"
---

# Migrating a website to Lume

You do the migration. The scripts do the mechanical parts (fetching, downloading, URL rewriting,
bulk extraction, checking) so you can spend your attention on what differs on every site: which
pages share a template, where the content starts, what is worth keeping, and what the user wants
the result to look like.

The scripts never decide. `inspect.ts` gives hints; you check them against real pages and choose.

## Scripts

All take `--help`, print JSON to stdout and progress to stderr, and never prompt. Paths are
relative to this skill's directory.

- `scripts/crawl.ts`: crawl the site into a workspace
- `scripts/inspect.ts`: hints about templates, pagination and cruft; outline or print parts of a page
- `scripts/download.ts`: download assets into the project and record them in a manifest
- `scripts/rewrite.ts`: rewrite the URLs of one layout or fragment
- `scripts/extract.ts`: write every page file from the rules you define
- `scripts/verify.ts`: compare the built site with the crawl

Run them with Deno, from the directory where the migration lives so they share one workspace:

```bash
deno run --allow-net --allow-read --allow-write <skill-dir>/scripts/crawl.ts --url https://example.com
```

The workspace is `.misto/` in the current directory (override with `--workspace`). It holds
`pages.json` (id, URL, title per page), `html/<id>.html` (raw pages), `hints.json`, `assets.json`
(the asset manifest), your `rules.json`, and reports. Read its files directly when a summary is
not enough. Suggest adding `.misto/` to the project's `.gitignore`.

## Workflow

### 1. Crawl

Ask for the URL if you do not have it, and where the Lume project should go (below: `site/`).

```bash
deno run --allow-net --allow-read --allow-write scripts/crawl.ts --url <url> --sitemap
```

Tell the user how many pages were found and which failed. If `reachedMaxPages` is true, the crawl
is incomplete: ask whether to raise `--max-pages` (default 500). The crawl stays on the start
URL's origin, so a site spread over `www.` and a bare domain needs the one that serves the pages.

### 2. Understand the site

```bash
deno run --allow-read --allow-write scripts/inspect.ts
```

Read the hints, then confirm them on real pages. For each suggested template, outline two or
three of its pages, including one that looks unlike the others (the largest and smallest help):

```bash
deno run --allow-read --allow-write scripts/inspect.ts --page 0007 --outline --depth 5
deno run --allow-read --allow-write scripts/inspect.ts --page 0007 --selector "header" --html
```

Decide:

- **The real templates.** Clusters over-split (a sidebar present on some pages) and sometimes
  under-split. Merge clusters whose difference is a per-page detail; a layout can hold it behind a
  frontmatter flag. Split a cluster when its pages have different content structure.
- **The content boundary of each template**: the selector whose inside is the page's own content.
  Everything outside goes in the layout.
- **What repeats inside content** and deserves frontmatter fields (title, date, author, tags, cover).
- **Paginated lists, search forms, language variants**, from the hints.

Read [references/pitfalls.md](references/pitfalls.md) before deciding; it lists the ways crawled
sites mislead.

### 3. Ask the user

Ask once, with what you found as context, instead of guessing. Skip a question when the answer is
obvious from the site or the user already said. Typical decisions:

- Which sections or pages to migrate, if not all. Mention anything that looks disposable (tag
  archives, author pages, search results, duplicate language variants).
- Whether your template list matches how they think of the site, when it is ambiguous.
- Third-party scripts found (analytics, tag managers, chat widgets) and CMS leftovers: keep or drop.
- Assets on other hosts (CDNs, web fonts): keep the remote links or download them
  (`--localise-external`).
- Paginated lists: regenerate them from the migrated pages with a Lume paginator (recommended, they
  stay correct when content changes) or keep them as static copies.
- Search form: static search with the `pagefind` plugin, a plain index page, or remove it.
- Lume plugins worth adding. Offer only what fits the site; see
  [references/plugins.md](references/plugins.md).
- Preferences for the code: layout and file naming, shared chrome as includes or components,
  site-wide values in `_data`, CSS and JS left as downloaded or reorganised.
- Site title, language and final domain (for `location` in `_config.ts`), if not evident.

### 4. Scaffold the project

Init Lume without prompts (details and flags in [references/lume.md](references/lume.md)):

```bash
deno run -A https://lume.land/init.ts site --plugins=sitemap --no-cms
```

Then download the assets and make Lume ship them (`site.add("assets")`; a starting
`_config.ts` is in `assets/_config.ts`):

```bash
deno run --allow-net --allow-read --allow-write scripts/download.ts --out site
```

The manifest owns the filenames: two stylesheets named `style.css` become `style.css` and
`style_2.css`. Never work out an asset's local path from its URL; let the scripts rewrite
references, or look the URL up in `.misto/assets.json`.

### 5. Write the layouts

One layout per template, in `site/_includes/layouts/`. Start from a real page of that template
with its URLs already rewritten and any literal `{{` escaped:

```bash
deno run --allow-read --allow-write scripts/rewrite.ts --page 0007 > site/_includes/layouts/post.vto
```

Then edit the file into a layout:

- Replace the inside of the content element with `{{ content }}`.
- Replace per-page values with frontmatter variables: `<title>{{ title }}</title>`, the meta
  description, canonical and `og:*` tags, `<html lang>`, per-page `<body>` classes.
- Remove what the user chose to drop.
- Check the navigation: a "current page" class frozen from the sample page must become conditional
  on `url` or be removed.
- Move chrome shared by several layouts (header, footer, head) into `_includes/` files or a parent
  layout instead of repeating it.

When you later paste more crawled markup into a template, run `rewrite.ts <file> --base-url
<page url> --in-place` on it. Vento tags you wrote are preserved; add `--escape-vento` only when
the file is still pure crawled markup.

### 6. Write the pages

Describe each template once in `.misto/rules.json` and let `extract.ts` write all its pages.
Format and examples: [references/rules.md](references/rules.md), `assets/rules.example.json`.

```bash
deno run --allow-read --allow-write scripts/extract.ts --out site --dry-run
deno run --allow-read --allow-write scripts/extract.ts --out site
```

Fix the rules until the dry run is clean:

- `unmatched`: no rule claims the page. Add a rule, or a `skip` rule if it should not be migrated.
- `noContent`: the content selector matched nothing; that page belongs to another template.
- `missingFields`: a field's selector found nothing. Give it a `default` or fix the selector.
- `collisions`: several crawled URLs produce the same file (usually query-string duplicates).

Write by hand what rules cannot express: a one-off landing page, paginators
(`assets/paginator.page.ts` with `assets/list.vto`), the search page (`assets/search.vto`),
`_data` files. Re-running `extract.ts` overwrites generated pages, so use `--only <rule>` once
you have hand-edited some.

### 7. Build and verify

```bash
cd site && deno task build
deno run --allow-read --allow-write scripts/verify.ts --site site/_site
```

`verify.ts` exits with 5 while it finds problems: `missing` pages, pages whose text differs from
the original (`textDiffers`), and `brokenLinks`. Fix the cause (usually a rule or a layout, not
the single page) and repeat until it is clean or what remains is explained. A build error naming
a `.vto` page usually means unescaped template syntax in crawled content; see the pitfalls.

Text can match while the page looks wrong. Open a page of each template with `deno task serve`,
or ask the user to, before calling it done.

### 8. Hand over

Summarise: pages migrated per template, what was dropped and why, what `verify.ts` still reports,
and anything dynamic the static site cannot do (forms, comments, logged-in areas, server-side
search) with a suggested replacement.

## Notes

- Before configuring a Lume feature or plugin, read its page on lume.land (linked from the
  references). The bundled notes are a map and can be behind the current Lume version.
- Respect the site: keep the default delay, do not raise `--max-pages` far beyond the site's size,
  and confirm the user is entitled to copy the content if that is unclear.
- A migration can be resumed. If `.misto/` exists, read `pages.json`, `rules.json` and the latest
  reports before crawling again; a new crawl replaces the stored pages.
