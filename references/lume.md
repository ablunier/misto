# Lume, for migrations

A map of the Lume features a migration touches, written against Lume 3.3. Each section links the
page it comes from: **read that page before relying on a detail**, since Lume moves faster than
this file. Docs index: https://lume.land/docs/overview/about-lume/

## Create the project

https://lume.land/docs/overview/installation/

```bash
deno run -A https://lume.land/init.ts <dir> --plugins=sitemap,metas --no-cms
```

The init script asks questions unless told otherwise. Passing `--plugins=<a,b>` (at least one
name) and `--no-cms` answers them all, so it runs unattended. Other flags: `--src <dir>`,
`--theme <name>`, `--version <v>`, `--javascript` (a `_config.js` instead of `_config.ts`).

It writes `_config.ts` and `deno.json` (import map for `lume/`, tasks, permissions). Then:

```bash
deno task build     # writes _site/
deno task serve     # local server with live reload
deno task lume upgrade
```

## `_config.ts`

https://lume.land/docs/configuration/config-file/

```ts
import lume from "lume/mod.ts";
import sitemap from "lume/plugins/sitemap.ts";

const site = lume({
  location: new URL("https://example.com"), // public address, used for absolute URLs
});

site.add("assets"); // ship the downloaded assets
site.use(sitemap());

export default site;
```

Options worth knowing: `src` (source folder), `dest` (default `_site`), `location`, `prettyUrls`
(default `true`).

Files and folders starting with `_` or `.` are ignored as pages. That is why `.misto/` can sit
inside the project and why `_includes` and `_data` are special.

## Static files

https://lume.land/docs/configuration/add-files/

- `site.add("assets")` copies a folder and lets plugins process its files (CSS minifiers, image
  transforms). `site.add("img", "images")` renames the destination; `site.add([".pdf"])` adds by
  extension.
- `site.copy("assets")` copies byte for byte, bypassing plugins. Use it when a processing plugin
  breaks the crawled CSS or JS.
- Only paths inside the source folder can be added.

`download.ts` puts everything under `assets/{css,js,img,font}/` and rewrites references to
`/assets/...`, so one `site.add("assets")` is enough.

## Pages

https://lume.land/docs/creating-pages/page-files/ ·
https://lume.land/docs/creating-pages/page-data/

A page is a file with front matter and content. `extract.ts` writes `.vto` pages (HTML rendered
through Vento). Variables Lume treats specially:

| Variable | Meaning |
|---|---|
| `url` | Public URL and output file. `false` skips the page. |
| `layout` | Layout file, relative to `_includes`. |
| `date` | ISO 8601 (`2024-05-01`, `2024-05-01T10:00:00Z`). Defaults to the file's creation date, so migrated posts need it set to sort correctly. |
| `tags` | A value or a list; searchable with the `search` helper. |
| `draft` | `true` leaves the page out of the build. |
| `lang`, `id` | Used by the `multilanguage` plugin. |

Any other field (`title`, `description`, `type`, `author`, `cover`) is yours to use in layouts
and queries.

## URLs

https://lume.land/docs/creating-pages/urls/

By default `posts/hello.vto` is output as `/posts/hello/index.html` and served at `/posts/hello/`.
A `url` in the front matter overrides it:

```yaml
url: /posts/welcome/       # /posts/welcome/index.html
url: /posts/welcome.html   # that exact file
url: /feed.xml
```

`extract.ts` always writes `url` with the page's original path, so existing links and search
engine results keep working regardless of where the source file sits. If the original site used
`.html` addresses, they are kept as they are.

## Layouts and includes

https://lume.land/docs/creating-pages/layouts/

Layouts live in `_includes/` (by convention `_includes/layouts/`). A page picks one with
`layout: layouts/post.vto`. The layout prints the page with `{{ content }}` and reads the page's
front matter as plain variables:

```html
<!DOCTYPE html>
<html lang="{{ lang || "en" }}">
<head>
  <title>{{ title }} | {{ site.title }}</title>
  {{ if description }}<meta name="description" content="{{ description }}">{{ /if }}
  <link rel="canonical" href="{{ url |> url(true) }}">
</head>
<body>
  {{ include "header.vto" }}
  <main>{{ content }}</main>
  {{ include "footer.vto" }}
</body>
</html>
```

A layout can have front matter of its own, including `layout:`, which nests it inside another.
Use that for templates sharing an outer shell: `post.vto` → `base.vto`. Values set in a layout's
front matter are defaults that pages override.

## Vento

https://lume.land/plugins/vento/ · https://vento.js.org/

- Print: `{{ title }}`. Autoescape is off by default in Lume, so `{{ content }}` prints HTML as is.
- Filters use the pipe: `{{ title |> upper }}`, `{{ "/about/" |> url }}`. The `url` filter
  resolves a path against the site's `location` (`url(true)` gives an absolute URL).
- Control flow: `{{ if x }}…{{ else }}…{{ /if }}`, `{{ for item of items }}…{{ /for }}`,
  `{{ set name = value }}`.
- Includes: `{{ include "header.vto" }}`, resolved from `_includes/`. Pass data with
  `{{ include "card.vto" { post } }}`.
- Raw text: `{{ echo }}…{{ /echo }}` prints its inside untouched. This is what protects crawled
  content containing `{{`.
- Comments: `{{# … #}}`.
- Expressions are JavaScript: `{{ if url == "/" }}`, `{{ url.startsWith("/blog/") ? "active" : "" }}`.

A menu's current item, frozen in the crawled markup, becomes:

```html
<a href="/blog/"{{ if url.startsWith("/blog/") }} class="current" aria-current="page"{{ /if }}>Blog</a>
```

## Shared data

https://lume.land/docs/creating-pages/shared-data/

- `_data.yml` (or `.json`, `.ts`) in a folder: its keys are variables for every page in that
  folder and below. A `blog/_data.yml` with `layout: layouts/post.vto` and `type: post` gives all
  posts those values without repeating them in each file.
- `_data/site.yml` in the root: available everywhere as `site` (`{{ site.title }}`). Good for the
  site name, navigation items, social links, footer text taken from the crawled chrome.

## Listing pages: search and paginate

https://lume.land/docs/core/searching/ · https://lume.land/plugins/search/ ·
https://lume.land/plugins/paginate/

Both helpers are installed by default.

```html
{{ for post of search.pages("type=post", "date=desc", 5) }}
  <a href="{{ post.url }}">{{ post.title }}</a>
{{ /for }}
```

`search.pages(query, sort, limit)`. Query terms are space-separated and all must hold: a bare
word is a tag; `field=value`, `field!=value`, `^=` (starts with), `$=` (ends with), `*=`
(contains), `<`, `>`, `<=`, `>=`; `a|b` for either. Sort is `field` or `field=desc`, several
separated by spaces. Also `search.page(query)` for one, `search.values("tags")` for the distinct
values of a field, `search.nextPage(url, query)` and `search.previousPage(url, query)`.

A paginated list is a generator page (`something.page.ts`) yielding one page per batch:

```ts
export const layout = "layouts/list.vto";

export default function* ({ search, paginate }: Lume.Data) {
  const posts = search.pages("type=post", "date=desc");
  for (const page of paginate(posts, { url: (n) => n === 1 ? "/blog/" : `/blog/${n}/`, size: 10 })) {
    yield page;
  }
}
```

Each yielded page has `url`, `results` (the items) and `pagination` (`page`, `totalPages`,
`totalResults`, `previous`, `next`). Ready-to-adapt copies: `assets/paginator.page.ts` and
`assets/list.vto`. For the items to be found, the migrated pages need the field the query uses
(`"type": "post"` in the rule's `data`) and a real `date`.

## Multilingual sites

https://lume.land/plugins/multilanguage/

When the crawl has language variants (`/en/…`, `/gl/…`, or `?lang=`), the `multilanguage` plugin
links translations: pages sharing an `id` and differing in `lang` are versions of each other, the
plugin prefixes URLs with the language (except `defaultLanguage`) and exposes `alternates` for a
language switcher. Since `extract.ts` writes explicit `url`s, check on the plugin's page how they
combine with its prefixes before enabling it; setting only `lang` per section in a `_data.yml`
and building the switcher from frontmatter is the simpler route.

## Deployment

https://lume.land/docs/advanced/deployment/ has recipes per host (GitHub Pages, Netlify, Deno
Deploy, Cloudflare Pages and others). Mention it when handing over; set `location` to the final
domain first.
