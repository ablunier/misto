# Misto

A Deno CLI tool that crawls websites and generates [Lume](https://lume.land/) static site projects from them. Point it at any URL and get a ready-to-serve Lume project.

Misto is also the Galician word for match — the fire-lighting stick.

## Usage

Run directly from JSR:

```sh
deno run -A jsr:@ablunier/misto/cli
```

Or install globally:

```sh
deno install --allow-net --allow-write --allow-read -n misto jsr:@ablunier/misto/cli
```

Then run:

```sh
misto --url https://example.com
```

If `--url` is omitted, misto prompts for one interactively.

## How it works

misto runs a linear pipeline:

1. **Crawl** — BFS crawl from the seed URL; respects `robots.txt`, handles redirects, retries, and rate limiting (429 back-off); optionally seeds from `sitemap.xml`
2. **Extract** — Parses HTML; isolates content via semantic selectors (`<main>`, `[role="main"]`, `<article>`); builds the base Lume layout
3. **Download** — Fetches CSS, JS, and images; rewrites `url()` references in CSS; deduplicates assets by original URL
4. **Generate** — Bootstraps a Lume project; writes `_config.ts`, base layout, `_data/site.yaml`, and `.vto` page files with YAML frontmatter

## Generated output

```
output/
├── _config.ts
├── _data/site.yaml
├── _includes/layouts/base.vto
├── assets/
│   ├── css/
│   ├── js/
│   └── img/
└── [pages].vto
```

After generation:

```sh
cd output && deno task serve
```

## Development

```sh
# Run with file watching
deno task dev

# Run tests
deno test
```

## Requirements

- [Deno](https://deno.land/) v2+

## License

MIT
