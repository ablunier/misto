# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**misto** is an [Agent Skill](https://agentskills.io/specification) that migrates websites to
[Lume](https://lume.land/). The repository root *is* the skill: `SKILL.md` instructs an agent,
which runs the Deno scripts in `scripts/` for the mechanical work and makes the judgment calls
itself, asking the user where the site is ambiguous.

It used to be a one-shot CLI. That failed because template detection, content boundaries and
pagination differ on every site; hard-coded heuristics could not keep up. Keep that lesson: **a
script must not decide what an agent can judge better.**

## Commands

```bash
deno task test    # all tests, including tests/e2e_test.ts against a local fixture server
deno task check   # type-check scripts and tests

# Run one script by hand
deno run --allow-net --allow-read --allow-write scripts/crawl.ts --help
```

## Layout

- `SKILL.md`: frontmatter (`name` must equal the folder name, `description` drives activation)
  and the workflow. Loaded whole when the skill activates: keep it under 500 lines and move detail
  to `references/`.
- `references/`: loaded on demand. `lume.md` and `plugins.md` are written from lume.land and link
  each source page; `rules.md` documents the `extract.ts` rules format; `pitfalls.md` holds the
  hard-won knowledge about crawled sites.
- `assets/`: templates the agent copies into the generated project (unrelated to the generated
  project's own `assets/` folder).
- `scripts/*.ts`: one entry point per step. Each exports `main(argv)` and runs it under
  `import.meta.main`, so tests call `main` directly.
- `scripts/lib/`: `crawler.ts`, `downloader.ts`, `assets.ts` (asset discovery), `rewrite.ts`
  (DOM-based URL rewriting), `vento.ts` (escaping), `hints.ts` (template clusters, cruft,
  outline), `paginator.ts` (pagination helpers for hints), `rules.ts` (rules matching and page
  extraction), `paths.ts` (URL → file/path mapping), `workspace.ts` (the `.misto/` directory),
  `cli.ts` (argument and output helpers), `dom.ts` (the one place importing deno-dom).

## Conventions

### Scripts

- **No prompts, ever.** Agents run in non-interactive shells. All input comes from flags.
- **stdout is JSON data, stderr is everything else.** Summaries are capped (`sample()` in
  `cli.ts`); full lists go to a workspace file.
- **Errors say what to do next.** Throw `CliError` with the expected value and the fix; use the
  exit codes in `cli.ts` and keep `EXIT_HELP` in every `--help`.
- **Self-contained.** Dependencies are inline pinned `jsr:` specifiers in the file that uses
  them, because scripts run from the user's project directory, where this repo's `deno.json`
  does not apply. Do not add entries to the import map for script code (tests may use it).
- **Safe to re-run.** `download.ts` keeps filenames from an earlier manifest; `crawl.ts` replaces
  only the crawl.
- No npm dependencies: Deno standard library and JSR packages only.

### The workspace is the contract

Scripts communicate only through `.misto/` (`pages.json`, `html/`, `assets.json`, `hints.json`,
`rules.json`, reports). `workspace.ts` is the only module that knows the file names. Changing a
file's shape means updating `SKILL.md` and the references that describe it.

### Hints, not decisions

`hints.ts` clusters pages by the chrome around the content region and suggests a content
selector. It is allowed to be wrong; it must never be silent about what it did (the skeleton it
compared is in the output). `findContentRegion` deliberately refuses to pick among several
`<article>`s: teaser cards and testimonials are articles too.

### URLs

- **Rewrite on the DOM, never by string replacement.** `rewrite.ts` resolves each
  `href`/`src`/`srcset`/`url()` and looks it up. A substring replace on serialized HTML corrupts
  unrelated markup (a manifest entry with pathname `/` once rewrote every `href="/"`).
- **The asset manifest owns filenames.** The downloader renames collisions (`style_2.css`), so
  deriving a local path from a URL anywhere else produces 404s.
- **One URL key.** Crawled URLs are compared through `canonicalKey` in `crawler.ts` (lowercase,
  no fragment, no trailing slash). `buildUrlPathMap` in `paths.ts` is the only source of
  crawled-URL → new-path mappings, including the `urls` overrides of the rules file.

### Vento

Crawled HTML is not a template: documentation pages contain literal `{{`. Page bodies go through
`wrapEcho`; whole crawled documents through `escapeVento`. When rewriting a template the agent
wrote, its Vento tags are swapped for placeholders (`protectVentoTags`) so the HTML parser cannot
entity-encode them. `tests/vento_test.ts` renders the escaped output with real Vento.

### When changing behaviour

The agent only knows what `SKILL.md`, the references and each script's `--help` tell it. A new
flag, report field or rule key that is not documented there does not exist for the agent. Verify
Lume claims against lume.land or a real build before writing them into `references/`.
