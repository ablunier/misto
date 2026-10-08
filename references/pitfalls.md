# Pitfalls of crawled sites

What goes wrong when a crawled site is taken at face value. Each of these has broken a migration.

## Templates

- **A site has several templates.** Never assume one layout. Home, listing, article and plain page
  nearly always differ, and a section may have its own chrome.
- **Pages of one template are never identical outside their content.** Section sidebars, a class
  on `<main>`, a per-page stylesheet, a highlighted menu item. Compare the header and footer level
  around the content, not whole documents. `inspect.ts` clusters this way and still over-splits:
  two clusters that differ by one optional sibling are usually one template with a conditional.
- **A language switcher must not split a template.** It links to each page's own translation, so
  its URLs differ on every page while the markup is the same. In the layout, those links come from
  frontmatter (or the `multilanguage` plugin's `alternates`), not from the sample page.
- **State frozen from the sample page.** A layout made from one page carries that page's
  `current-menu-item` class, `aria-current`, breadcrumb, `<body class="page-id-42">`, canonical
  URL and `og:` tags. Each must become a variable, a condition on `url`, or go.
- **The home page often has no content region.** No `<main>`, or a `<main>` wrapping everything
  including what looks like chrome. It usually deserves its own layout, written by hand.

## Content boundary

- **Several `<article>` elements are usually teasers.** Cards on a listing, testimonials and
  related posts are articles too. `inspect.ts` refuses to pick among them; on a listing page the
  content is the container around them.
- **`<main>` can be too wide or too narrow.** Too wide: it includes the section sidebar that
  belongs in the layout. Too narrow: the page title sits in a hero above it. Outline a page and
  choose the element whose inside changes completely from page to page.
- **Content repeated on every page is chrome**, even inside the content element: share buttons,
  author boxes, "related posts", comment forms, newsletter sign-ups. Put it in the layout or
  `remove` it.
- **The `<title>` is not the title.** It is usually `Page name | Site name`. Take `title` from the
  page's heading and let the layout add the site name.

## Vento

- **Crawled HTML is not a template.** Documentation and blog posts about templating contain
  literal `{{ … }}`; Vue and Angular sites ship it in their markup. Vento would try to evaluate
  it: the build fails, or worse, prints something else. `extract.ts` wraps such bodies in
  `{{ echo }}` and `rewrite.ts --page` escapes each `{{` as `{{ "{{" }}`. Anything you paste from
  a crawled page by hand needs the same care. `hints.json` counts affected pages in
  `pagesWithTemplateSyntax`.
- **Vento tags do not survive an HTML parser everywhere.** Between `<head>` children or table rows
  a tag is stray text and gets moved into `<body>`. So rewrite URLs on the crawled markup first
  (`rewrite.ts --page`), then add your tags. `rewrite.ts <file>` protects tags it finds, but check
  the result when the file has tags in `<head>`.

## URLs and assets

- **The manifest owns filenames.** `download.ts` renames collisions (`style.css`, `style_2.css`)
  and drops query strings. A local path worked out from the URL by hand points at the wrong file
  or at nothing. Use the scripts, or look the URL up in `.misto/assets.json`.
- **Never rewrite URLs by search and replace on HTML.** A replace of `/` or of a short path hits
  unrelated attributes and text. `rewrite.ts` and `extract.ts` work on parsed attributes.
- **Relative URLs break when a page moves.** `img/a.png` on `/blog/post` is `/blog/img/a.png`.
  The scripts resolve against the page's original URL; markup you copy by hand needs
  `rewrite.ts <file> --base-url <the page it came from>`.
- **Query-string sites.** `/?p=72` and `/?page_id=5` are distinct pages with the same path. The
  crawler gives each a slug from its title; use `urls` in the rules for proper addresses, and
  consider the `redirects` plugin for the old ones if the host supports it.
- **`?p=` means two things.** Pagination on some sites, post id on others. The pagination hint
  only reports groups whose first page has a pagination nav; check it against the real pages.
- **Duplicates.** The same page under `/about`, `/about/?lang=en`, `/about?utm_source=…` or a
  print view. `extract.ts` lists them under `collisions`; pick one and `skip` the rest.
- **External assets stay external by default.** Fonts and libraries from CDNs keep their remote
  URL unless `download.ts --localise-external` is used. Ask the user; self-hosting avoids
  third-party requests but copies files whose licence you should check.
- **Assets only JavaScript knows about are not found.** Lazy-loaded images in `data-src`, images
  set from scripts, files fetched at runtime. `verify.ts` cannot see them either. Look for
  `data-src`/`data-srcset` in an outline and handle them by hand when present.

## What a static site cannot do

- **Forms** (contact, newsletter, comments) post to a server that will not exist. Point them at a
  form service or remove them, and tell the user.
- **Search forms** need a static replacement: the `pagefind` plugin, or a plain index page.
- **Logged-in areas, carts, anything per-visitor** cannot be migrated. Say so early.
- **Content the crawl could not reach**: pages behind forms, infinite scroll, pages only linked
  from JavaScript, anything disallowed for robots. Compare the page count with the site's sitemap
  (`crawl.ts --sitemap`) and ask the user what is missing.

## CMS leftovers

`hints.json` lists them under `cruft`. Usually safe to drop, after asking:

- Head elements that only meant something to the CMS: `generator`, `EditURI`, `wlwmanifest`,
  `pingback`, REST and oEmbed discovery links, `csrf-token`.
- Scripts and styles of the CMS itself and its plugins (emoji loaders, admin bar, block-library
  CSS nobody uses). Check that removing a stylesheet does not unstyle the content.
- Analytics and tag managers: the user decides. Never drop them silently and never keep them
  silently.
