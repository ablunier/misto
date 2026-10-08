# Lume plugins to consider in a migration

The full catalogue is at https://lume.land/plugins/. Each plugin's page is
`https://lume.land/plugins/<name>/`: **read it before installing**, for its options and the order
it must be registered in. Install by importing and calling `site.use()`:

```ts
import metas from "lume/plugins/metas.ts";
site.use(metas());
```

Plugins can also be named at init time: `init.ts <dir> --plugins=sitemap,metas`.

Offer the user the ones the site gives a reason for, with that reason. Do not install a list by
default: every plugin is something they will maintain.

## Already on, nothing to install

`vento`, `markdown`, `json`, `yaml`, `modules` (`.page.ts` generators), `search`, `paginate`,
`url` (the `url` filter).

## Usually worth offering

| Plugin | Offer when | Notes |
|---|---|---|
| `sitemap` | Always, unless the user objects. | Replaces the crawled `sitemap.xml`. Needs `location`. |
| `metas` | The crawled `<head>` has description, Open Graph or Twitter tags. | Generates them from page data, replacing the hand-templated ones in the layout. |
| `feed` | The original site had an RSS or Atom feed (look for `link[rel="alternate"]` with a feed type). | Keep the old feed's URL so subscribers are not lost. |
| `robots` | The original had a `robots.txt` worth keeping. | Or copy the file as a static asset. |
| `redirects` | Addresses change in the migration (query-string pages given real paths, a restructured section). | Output format depends on the host; check its page. |
| `pagefind` | The original had a search form. | Static full-text search; replaces server-side search. |
| `check_urls` | Always useful during the migration. | Reports broken internal links at build time, complementing `verify.ts`. |

## When the site calls for it

| Plugin | Offer when |
|---|---|
| `multilanguage` | The site has language variants of the same pages. |
| `date` | Layouts print dates in a human format and a locale. |
| `nav` | Menus or breadcrumbs should be generated from the page tree instead of copied markup. |
| `favicon` | The user has an SVG logo and wants the icon set regenerated, instead of the copied icons. |
| `google_fonts` | The site loads Google Fonts and the user wants them self-hosted. |
| `base_path` | The site will be served from a subfolder (`example.com/docs/`). |
| `slugify_urls` | Crawled paths contain spaces, accents or uppercase the user wants normalised (this changes addresses: pair it with redirects). |
| `code_highlight` or `prism` | Technical content with code blocks whose original highlighting came from a script being dropped. |
| `json_ld` | The original pages carry JSON-LD structured data worth generating from page data. |

## Optimisation, usually a later step

These change the output without changing the content. Suggest them after the migration verifies
clean, so a regression can be told apart from a migration mistake. Assets must be added with
`site.add()` (not `site.copy()`) for them to apply.

| Plugin | Does |
|---|---|
| `lightningcss`, `postcss` | Transform and minify CSS. Crawled CSS is often already minified and sometimes invalid; try on a copy first. |
| `purgecss` | Removes unused CSS. Risky with classes added by JavaScript. |
| `terser`, `esbuild` | Minify or bundle JavaScript. |
| `minify_html` | Minifies the pages. |
| `transform_images`, `picture` | Resize and convert images; `picture` builds responsive `<picture>` markup. |
| `image_size` | Adds `width` and `height` to images, reducing layout shift. |
| `svgo` | Optimises SVG files. |
| `inline` | Inlines small CSS, JS or SVG into the HTML. |
| `sri` | Adds integrity hashes to assets kept on external CDNs. |

## Checks

| Plugin | Does |
|---|---|
| `check_urls` | Broken links, at build time. |
| `validate_html` | HTML validation of the output. Expect noise from legacy markup. |
| `seo` | Basic SEO checks (missing titles, descriptions, headings). |

## Not for a migration

Template engines (`nunjucks`, `pug`, `jsx`, `mdx`, `eta`), CSS frameworks (`tailwindcss`,
`unocss`, `sass`) and `decap_cms` are choices about how the site is developed afterwards. Bring
them up only if the user asks to change how the site is built, not just where it lives.
