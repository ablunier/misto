#!/usr/bin/env -S deno run --allow-read --allow-write
import { srcsetUrls } from "./lib/assets.ts";
import { CliError, emit, EXIT, EXIT_HELP, parseArgs, rejectUnknown, requireString, runMain, sample } from "./lib/cli.ts";
import { canonicalKey } from "./lib/crawler.ts";
import { parseDocument, type ParsedDoc } from "./lib/dom.ts";
import { buildUrlPathMap, siteFileCandidates } from "./lib/paths.ts";
import { compileRules, matchRule, type RulesFile } from "./lib/rules.ts";
import { DEFAULT_WORKSPACE, Workspace } from "./lib/workspace.ts";

const HELP = `Usage: deno run --allow-read --allow-write scripts/verify.ts --site <dir> [options]

Compare a built Lume site with the crawl it was migrated from. Build first
(deno task build), then point --site at the output folder.

Checks:
  missing      a crawled page has no file in the built site
  textDiffers  a built page lost text the original page had (share of the
               original's words found in the built page is below --threshold)
  brokenLinks  a link, image, script or stylesheet in the built site points at
               a local path that does not exist. "crawled": true means the
               target is a crawled page that was not migrated; false means the
               crawl never reached it (raise --max-pages, or it was already broken)

Options:
  --site <dir>         Built site, usually <project>/_site (required)
  --workspace <dir>    Workspace written by crawl.ts (default: ${DEFAULT_WORKSPACE})
  --rules <file>       Rules file, for its "urls" overrides and "skip" rules
                       (default: <workspace>/rules.json)
  --threshold <0-1>    Minimum share of original words kept (default: 0.9)
  --include-skipped    Also check pages claimed by a "skip": true rule
  --help               Show this help

Prints a JSON summary to stdout; full lists go to <workspace>/verify-report.json.

${EXIT_HELP}

Example:
  deno run --allow-read --allow-write scripts/verify.ts --site ./site/_site`;

async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

async function* walkHtml(dir: string, prefix = ""): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) yield* walkHtml(`${dir}/${entry.name}`, rel);
    else if (entry.name.endsWith(".html")) yield rel;
  }
}

/** Words a visitor can read, with markup, scripts and styles left out. */
export function visibleWords(doc: ParsedDoc): string[] {
  const body = doc.body;
  if (!body) return [];
  for (const el of body.querySelectorAll("script, style, noscript, template")) el.parentNode?.removeChild(el);
  return body.textContent.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Share of the original's words (counted with repetition) present in the built page. */
export function wordsKept(original: string[], built: string[]): number {
  if (original.length === 0) return 1;
  const available = new Map<string, number>();
  for (const word of built) available.set(word, (available.get(word) ?? 0) + 1);
  let kept = 0;
  for (const word of original) {
    const left = available.get(word) ?? 0;
    if (left > 0) {
      kept++;
      available.set(word, left - 1);
    }
  }
  return kept / original.length;
}

function localReferences(doc: ParsedDoc): string[] {
  const refs: string[] = [];
  for (const el of doc.querySelectorAll("a[href], link[href], area[href]")) refs.push(el.getAttribute("href")!);
  for (const el of doc.querySelectorAll("script[src], img[src], source[src], video[src], audio[src], iframe[src]")) {
    refs.push(el.getAttribute("src")!);
  }
  for (const el of doc.querySelectorAll("[srcset]")) refs.push(...srcsetUrls(el.getAttribute("srcset")!));
  for (const el of doc.querySelectorAll("video[poster]")) refs.push(el.getAttribute("poster")!);
  return refs;
}

const LOCAL = "http://site.invalid";

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    string: ["site", "workspace", "rules", "threshold"],
    boolean: ["include-skipped", "help"],
    default: { workspace: DEFAULT_WORKSPACE, threshold: "0.9" },
  });
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  rejectUnknown(args, ["site", "workspace", "rules", "threshold", "include-skipped", "help"]);

  const site = requireString(args.site, "site", "Example: scripts/verify.ts --site ./site/_site").replace(/\/+$/, "");
  const threshold = Number(args.threshold);
  if (!(threshold >= 0 && threshold <= 1)) {
    throw new CliError(`--threshold must be a number between 0 and 1. Received: "${args.threshold}"`);
  }
  try {
    if (!(await Deno.stat(site)).isDirectory) throw new Error();
  } catch {
    throw new CliError(`--site "${site}" is not a directory. Build the site first (deno task build) and pass its _site folder.`);
  }

  const workspace = new Workspace(args.workspace);
  const index = await workspace.readPages();
  const loaded = await workspace.readRules<RulesFile>(args.rules);
  const rules = loaded ? compileRules(loaded.rules, loaded.path) : [];
  const urlPathMap = buildUrlPathMap(index.pages, loaded?.rules.urls);

  const missing: Array<{ id: string; url: string; expected: string }> = [];
  const textDiffers: Array<{ id: string; url: string; file: string; kept: number }> = [];
  let checked = 0;
  let skipped = 0;
  const seenPaths = new Set<string>();

  for (const page of index.pages) {
    if (!args["include-skipped"] && matchRule(rules, page)?.skip) {
      skipped++;
      continue;
    }
    const path = urlPathMap.get(canonicalKey(page.url))!;
    // Several crawled URLs can map to one page; compare the first only.
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);

    let file: string | undefined;
    for (const candidate of siteFileCandidates(path)) {
      if (await exists(`${site}/${candidate}`)) {
        file = candidate;
        break;
      }
    }
    if (!file) {
      missing.push({ id: page.id, url: page.url, expected: path });
      continue;
    }

    checked++;
    const original = parseDocument(await workspace.readHtml(page));
    const built = parseDocument(await Deno.readTextFile(`${site}/${file}`));
    if (!original || !built) continue;
    const kept = wordsKept(visibleWords(original), visibleWords(built));
    if (kept < threshold) textDiffers.push({ id: page.id, url: page.url, file, kept: Math.round(kept * 100) / 100 });
  }
  textDiffers.sort((a, b) => a.kept - b.kept);

  // A broken link to a page that was crawled means the page was not migrated;
  // one to a path that never was crawled was likely broken or out of reach before.
  const crawledPaths = new Set(urlPathMap.values());
  const broken = new Map<string, { target: string; references: number; example: string; crawled: boolean }>();
  const known = new Map<string, boolean>();
  let htmlFiles = 0;
  for await (const rel of walkHtml(site)) {
    htmlFiles++;
    const doc = parseDocument(await Deno.readTextFile(`${site}/${rel}`));
    if (!doc) continue;
    const base = new URL(`/${rel}`, LOCAL);
    for (const ref of localReferences(doc)) {
      let target: URL;
      try {
        target = new URL(ref.trim(), base);
      } catch {
        continue;
      }
      if (target.origin !== LOCAL || !ref.trim() || ref.trim().startsWith("#")) continue;
      const path = target.pathname;
      if (!known.has(path)) {
        let found = false;
        for (const candidate of siteFileCandidates(path)) {
          if (await exists(`${site}/${candidate}`)) {
            found = true;
            break;
          }
        }
        known.set(path, found);
      }
      if (known.get(path)) continue;
      const item = broken.get(path) ??
        { target: path, references: 0, example: rel, crawled: crawledPaths.has(path) || crawledPaths.has(`${path}/`) };
      item.references++;
      broken.set(path, item);
    }
  }
  const brokenLinks = [...broken.values()].sort((a, b) => b.references - a.references);

  const report = await workspace.writeReport("verify-report.json", { missing, textDiffers, brokenLinks });
  const ok = missing.length === 0 && textDiffers.length === 0 && brokenLinks.length === 0;

  emit({
    ok,
    site,
    crawledPages: index.pages.length,
    compared: checked,
    skippedByRule: skipped,
    builtHtmlFiles: htmlFiles,
    missing: sample(missing, 15),
    textDiffers: sample(textDiffers, 15),
    brokenLinks: sample(brokenLinks, 15),
    report,
  });
  return ok ? EXIT.ok : EXIT.problems;
}

if (import.meta.main) await runMain(main);
