#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
import { extractAssets } from "./lib/assets.ts";
import { emit, EXIT, EXIT_HELP, log, parseArgs, rejectUnknown, requireString, runMain, sample } from "./lib/cli.ts";
import { parseDocument } from "./lib/dom.ts";
import { downloadAssets } from "./lib/downloader.ts";
import type { AssetUrl } from "./lib/types.ts";
import { DEFAULT_WORKSPACE, Workspace } from "./lib/workspace.ts";

const HELP = `Usage: deno run --allow-net --allow-read --allow-write scripts/download.ts --out <dir> [options]

Download the stylesheets, scripts, images and fonts the crawled pages reference
into <dir>/assets/{css,js,img,font}/, rewrite url() references inside the CSS,
and record where every asset went in <workspace>/assets.json.

That manifest owns the filenames: two assets with the same name get distinct
files (style.css, style_2.css), so never derive a local path from a URL.
extract.ts and rewrite.ts read it to rewrite references.

Options:
  --out <dir>             Lume project directory (required)
  --workspace <dir>       Workspace written by crawl.ts (default: ${DEFAULT_WORKSPACE})
  --no-js                 Skip JavaScript files
  --localise-external     Also download assets hosted on other domains (CDNs, fonts)
  --help                  Show this help

Safe to run again: filenames of an earlier run are kept and files already on
disk are not fetched twice. A failed download does not stop the others.
Prints a JSON summary to stdout and progress to stderr.

${EXIT_HELP}

Example:
  deno run --allow-net --allow-read --allow-write scripts/download.ts --out ./site --localise-external`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    string: ["out", "workspace"],
    boolean: ["js", "localise-external", "help"],
    negatable: ["js"],
    default: { workspace: DEFAULT_WORKSPACE, js: true },
  });
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  rejectUnknown(args, ["out", "workspace", "js", "localise-external", "help"]);

  const out = requireString(args.out, "out", "Example: scripts/download.ts --out ./site").replace(/\/+$/, "");
  const workspace = new Workspace(args.workspace);
  const index = await workspace.readPages();

  const assets = new Map<string, AssetUrl>();
  for (const entry of index.pages) {
    const doc = parseDocument(await workspace.readHtml(entry));
    if (!doc) continue;
    for (const asset of extractAssets(doc, new URL(entry.url))) {
      if (!assets.has(asset.original)) assets.set(asset.original, asset);
    }
  }

  log(`Found ${assets.size} assets in ${index.pages.length} pages`);
  const previous = await workspace.readManifest();
  const manifest = await downloadAssets(
    [...assets.values()],
    out,
    {
      skipJs: !args.js,
      localiseExternal: args["localise-external"],
      origin: index.origin,
      existing: previous?.map,
    },
    (done, total) => {
      if (done % 25 === 0 || done === total) log(`  ${done}/${total}`);
    },
  );
  await workspace.writeManifest(manifest);

  const counts: Record<string, number> = { css: 0, js: 0, img: 0, font: 0 };
  for (const local of Object.values(manifest.map)) counts[local.split("/")[2]]++;
  const skippedExternal = [...assets.keys()].filter((url) => !(url in manifest.map) && !manifest.failed.includes(url));

  emit({
    out,
    downloaded: Object.keys(manifest.map).length,
    byType: counts,
    failed: sample(manifest.failed),
    notDownloaded: {
      ...sample(skippedExternal, 10),
      why: "external hosts (pass --localise-external) or JavaScript skipped with --no-js; references keep their original URL",
    },
    manifest: workspace.path("assets.json"),
  });
  return EXIT.ok;
}

if (import.meta.main) await runMain(main);
