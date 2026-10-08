# rules.json

`scripts/extract.ts` reads `.misto/rules.json` (or `--rules <file>`) and writes one page file per
crawled page. A complete example is in `assets/rules.example.json`.

```json
{
  "defaults": { "layout": "layouts/base.vto", "remove": ["script", "style"] },
  "urls": { "https://example.com/blog/?page=2": "/blog/2/" },
  "rules": [
    { "name": "blog-list", "match": "/blog", "skip": true },
    {
      "name": "post",
      "match": "/blog/*",
      "content": "article.post .entry-content",
      "layout": "layouts/post.vto",
      "data": {
        "title": { "selector": "article.post h1" },
        "date": { "selector": "time", "attr": "datetime" },
        "type": "post"
      }
    },
    { "name": "page", "match": "/**", "content": "main" }
  ]
}
```

## Top level

| Key | Meaning |
|---|---|
| `rules` | Required. Checked in order; **the first rule that matches a page wins**, so put specific rules before general ones. |
| `defaults` | `content`, `remove`, `layout` and `data` applied to every rule that does not set them. `data` is merged per field. |
| `urls` | Crawled URL → new path, overriding the derived one. Links to that page everywhere are rewritten to the new path, and the page (if a rule writes it) is output there. |
| `format` | Optional; only `"html"`. Bodies are written as HTML in `.vto` files. |

## Selecting pages

A rule needs at least one of these; a page matching any of them is claimed.

| Key | Meaning |
|---|---|
| `match` | Glob or list of globs on the URL **path**, ignoring case and a trailing slash. `*` stays inside one segment, `**` crosses segments: `/blog/*` matches `/blog/hello` but not `/blog/2024/hello`; `/blog/**` matches both and `/blog` itself. `/**` matches everything. |
| `matchUrl` | Regular expression on the full crawled URL. For sites whose pages differ by query string: `"[?&]p=\\d+"`. |
| `pages` | List of page ids from `pages.json`, for one-offs. |
| `exclude` | Globs on the path that take pages back out of the rule. |

`skip: true` claims pages without writing them: lists you replace with a paginator, pages the user
dropped. Skipped pages are not reported as unmatched, and `verify.ts` does not expect them.

## Writing pages

| Key | Meaning |
|---|---|
| `content` | Required unless `skip`. CSS selector; the **inner HTML** of the first match becomes the page body. |
| `remove` | Selectors removed from inside the content: share buttons, the `<h1>` the layout prints from `title`, inline scripts. |
| `layout` | Required unless `skip`. As Lume expects it, relative to `_includes`: `layouts/post.vto`. |
| `data` | Extra frontmatter fields, below. |

Every page gets `title` (from `<title>`), `description` (from the meta description, when present),
`layout` and `url` without asking. A `data` field of the same name replaces it, which is how the
` | Site name` suffix of a `<title>` is avoided: take `title` from the `<h1>`.

## Data fields

Fields are read from the **whole document**, before `remove` is applied and after URLs are
rewritten. So an `<h1>` can feed `title` and still be removed from the body, and an image `src`
comes out as its local asset path.

| Form | Result |
|---|---|
| `"type": "post"` (string, number, boolean, null, array) | The literal value. |
| `{ "selector": "h1" }` | Text of the first match, whitespace collapsed. |
| `{ "selector": "time", "attr": "datetime" }` | An attribute of the first match. |
| `{ "selector": ".lead", "html": true }` | Inner HTML of the first match. |
| `{ "selector": ".tags a", "all": true }` | List with every match. |
| `{ "selector": "...", "default": "x" }` | `default` when nothing matches. Without it the field is left out and the page is listed under `missingFields`. |
| `{ "value": { "any": "object" } }` | A literal object. |

Use a `date` in ISO form (`2024-05-01`) so Lume can sort by it; a `datetime` attribute usually has
it. A date only available as prose ("May 1st, 2024") needs fixing by hand or a different source
(`meta[property="article:published_time"]` with `attr: "content"` is common).

## Output

- File: derived from the URL. `/about/` → `about.vto`, `/` → `index.vto`,
  `/blog/hello` → `blog/hello.vto`.
- `url` in the frontmatter keeps the original path, so the site's addresses do not change.
- Query-string pages (`/?p=72`) have no path of their own. The crawler gave each a `slug` from its
  title (see `pages.json`), so they land at `/<slug>/`. Use `urls` to choose a better address.
- URLs inside the body are rewritten: downloaded assets to their manifest path, crawled pages to
  their new path, other same-site URLs to root-relative, external URLs untouched.
- A body containing a literal `{{` is wrapped in `{{ echo }}…{{ /echo }}` so Vento prints it.

## Reading the report

`extract.ts` prints counts and the first entries of each list; the full lists are in
`.misto/extract-report.json`. Always run with `--dry-run` first.

| List | Meaning | Usual fix |
|---|---|---|
| `unmatched` | No rule claims the page; not written. | Add a rule, or a `skip` rule. |
| `noContent` | The rule's `content` selector matched nothing; not written. | The page is another template: add a more specific rule before this one. |
| `missingFields` | A field selector matched nothing; page written without that field. | Add a `default`, or fix the selector. |
| `collisions` | Several crawled URLs map to one file; only the first was written. | Usually harmless duplicates. `skip` the extras or give them distinct `urls`. |
