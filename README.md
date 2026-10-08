# Misto

An [Agent Skill](https://agentskills.io) that migrates an existing website into a
[Lume](https://lume.land/) static site project.

Every website has its particular things, so the migration is run by an AI agent, not by a fixed
pipeline. The agent reads the crawled site, works out its templates, asks you what you want
(which pages, which plugins, what to drop, how the code should be organised) and writes the Lume
project. The scripts bundled with the skill do the mechanical work for it: crawling, downloading
assets, rewriting URLs, extracting pages in bulk and checking the result against the original.

Misto is also the Galician word for match — the fire-lighting stick.

## Install

The skill is this repository. Put it where your agent looks for skills, in a folder named `misto`:

```sh
# Claude Code, for your user
git clone https://github.com/ablunier/misto ~/.claude/skills/misto

# or for one project
git clone https://github.com/ablunier/misto .claude/skills/misto
```

Other agents that support the Agent Skills format use their own skills folder; the layout is the
same.

Requires [Deno](https://deno.com/) 2+ and internet access.

## Use

Ask your agent:

> Migrate https://example.com to Lume

It will crawl the site, show you what it found, ask a few questions and build the project. Expect
a conversation, not a one-shot command.

## What is in the skill

```
SKILL.md              instructions the agent follows
scripts/              what the agent runs
├── crawl.ts            site → .misto/ workspace
├── inspect.ts          hints about templates; outline of a page
├── download.ts         assets → project, plus the asset manifest
├── rewrite.ts          URL rewriting for a layout or fragment
├── extract.ts          rules.json → one page file per crawled page
├── verify.ts           built site vs the crawl
└── lib/                shared modules
references/           read by the agent when needed
├── lume.md             the Lume features a migration touches
├── plugins.md          which Lume plugins to offer, and when
├── rules.md            the rules.json format
└── pitfalls.md         how crawled sites mislead
assets/               templates the agent adapts
```

The scripts also work by hand. Each one documents itself:

```sh
deno run --allow-net --allow-read --allow-write scripts/crawl.ts --help
```

## Development

```sh
deno task test     # unit tests and an end-to-end run against a local fixture site
deno task check
```

Scripts declare their dependencies inline (`jsr:` specifiers), so they run from any directory
without this repository's `deno.json`.

## License

MIT
