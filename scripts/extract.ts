#!/usr/bin/env -S deno run --allow-read --allow-write
import { CliError, emit, EXIT, EXIT_HELP, log, parseArgs, rejectUnknown, requireString, runMain, sample } from "./lib/cli.ts";
import { canonicalKey } from "./lib/crawler.ts";
import { buildUrlPathMap } from "./lib/paths.ts";
import { compileRules, extractPage, matchRule, type RulesFile } from "./lib/rules.ts";
import { DEFAULT_WORKSPACE, Workspace } from "./lib/workspace.ts";

const HELP = `Usage: deno run --allow-read --allow-write scripts/extract.ts --out <dir> [options]

Write one Lume page file per crawled page, following the rules you wrote in
<workspace>/rules.json: which pages belong to which template, where their
content is, what to strip, which layout they use and which frontmatter fields
to read from the markup. The format is described in references/rules.md.

Each file gets YAML frontmatter (title, description, layout, url, your fields)
and the content's HTML with URLs rewritten through assets.json and the crawled
page map. Bodies containing a literal {{ are wrapped so Vento prints them.

Options:
  --out <dir>          Lume project directory (required)
  --workspace <dir>    Workspace written by crawl.ts (default: ${DEFAULT_WORKSPACE})
  --rules <file>       Rules file (default: <workspace>/rules.json)
  --only <rule>        Only process pages claimed by this rule (repeatable)
  --dry-run            Report what would be written without writing anything
  --help               Show this help

Existing files are overwritten, so re-running discards hand edits to generated
pages: use --only to redo a single template.

Prints a JSON summary to stdout; the full lists go to <workspace>/extract-report.json.
Check "unmatched" (no rule claims the page) and "noContent" (the rule's content
selector matched nothing): those pages were not written.

${EXIT_HELP}

Examples:
  deno run --allow-read --allow-write scripts/extract.ts --out ./site --dry-run
  deno run --allow-read --allow-write scripts/extract.ts --out ./site --only post`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    string: ["out", "workspace", "rules", "only"],
    boolean: ["dry-run", "help"],
    collect: ["only"],
    default: { workspace: DEFAULT_WORKSPACE },
  });
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  rejectUnknown(args, ["out", "workspace", "rules", "only", "dry-run", "help"]);

  const out = requireString(args.out, "out", "Example: scripts/extract.ts --out ./site").replace(/\/+$/, "");
  const workspace = new Workspace(args.workspace);
  const index = await workspace.readPages();

  const loaded = await workspace.readRules<RulesFile>(args.rules);
  if (!loaded) {
    throw new CliError(
      `No rules file at "${args.rules ?? workspace.path("rules.json")}". Write one first: ` +
        `see references/rules.md and assets/rules.example.json.`,
      EXIT.workspace,
    );
  }
  const rules = compileRules(loaded.rules, loaded.path);
  const only = new Set(args.only as string[]);
  for (const name of only) {
    if (!rules.some((r) => r.rule.name === name)) {
      throw new CliError(`--only "${name}" is not a rule in ${loaded.path}. Rules: ${rules.map((r) => r.rule.name).join(", ")}`);
    }
  }

  const manifest = await workspace.readManifest();
  if (!manifest) log("Note: no assets.json in the workspace; asset references are not localised. Run scripts/download.ts first.");
  const overrides = loaded.rules.urls ?? {};
  const overrideByKey = new Map(Object.entries(overrides).map(([url, path]) => [canonicalKey(url), path]));
  const urlPathMap = buildUrlPathMap(index.pages, overrides);

  const written: Array<{ id: string; rule: string; file: string }> = [];
  const skipped: Array<{ id: string; url: string; rule: string }> = [];
  const unmatched: Array<{ id: string; url: string }> = [];
  const noContent: Array<{ id: string; url: string; rule: string; selector: string }> = [];
  const missingFields: Array<{ id: string; url: string; rule: string; fields: string[] }> = [];
  const byRule: Record<string, number> = {};
  const owners = new Map<string, string>();
  const collisions: Array<{ file: string; pages: string[] }> = [];

  for (const page of index.pages) {
    const rule = matchRule(rules, page);
    if (!rule) {
      if (only.size === 0) unmatched.push({ id: page.id, url: page.url });
      continue;
    }
    if (only.size > 0 && !only.has(rule.name)) continue;
    if (rule.skip) {
      skipped.push({ id: page.id, url: page.url, rule: rule.name });
      continue;
    }

    const result = extractPage(page, await workspace.readHtml(page), rule, {
      origin: index.origin,
      manifest: manifest?.map,
      urlPathMap,
      overridden: overrideByKey.get(canonicalKey(page.url)),
    });
    if (!result.ok) {
      noContent.push({ id: page.id, url: page.url, rule: rule.name, selector: rule.content ?? "" });
      continue;
    }

    const { outputPath, source, missingFields: missing } = result.page;
    const owner = owners.get(outputPath);
    if (owner) {
      // Two crawled URLs for one page (`/about` and `/about/?lang=en`): the first wins.
      const collision = collisions.find((c) => c.file === outputPath) ?? { file: outputPath, pages: [owner] };
      if (collision.pages.length === 1) collisions.push(collision);
      collision.pages.push(page.id);
      continue;
    }
    owners.set(outputPath, page.id);

    if (!args["dry-run"]) {
      const file = `${out}/${outputPath}`;
      await Deno.mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
      await Deno.writeTextFile(file, source);
    }
    written.push({ id: page.id, rule: rule.name, file: outputPath });
    byRule[rule.name] = (byRule[rule.name] ?? 0) + 1;
    if (missing.length > 0) missingFields.push({ id: page.id, url: page.url, rule: rule.name, fields: missing });
  }

  const report = await workspace.writeReport("extract-report.json", {
    dryRun: args["dry-run"],
    written,
    skipped,
    unmatched,
    noContent,
    missingFields,
    collisions,
  });

  emit({
    dryRun: args["dry-run"],
    out,
    written: written.length,
    byRule,
    skipped: skipped.length,
    unmatched: sample(unmatched, 15),
    noContent: sample(noContent, 15),
    missingFields: sample(missingFields, 15),
    collisions: sample(collisions, 15),
    report,
  });

  return written.length === 0 && skipped.length === 0 ? EXIT.empty : EXIT.ok;
}

if (import.meta.main) await runMain(main);
