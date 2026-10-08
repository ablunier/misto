#!/usr/bin/env -S deno run --allow-read --allow-write
import { CliError, EXIT, EXIT_HELP, log, parseArgs, rejectUnknown, runMain } from "./lib/cli.ts";
import { buildUrlPathMap } from "./lib/paths.ts";
import { rewriteSource } from "./lib/rewrite.ts";
import { DEFAULT_WORKSPACE, Workspace } from "./lib/workspace.ts";

const HELP = `Usage: deno run --allow-read --allow-write scripts/rewrite.ts (--page <id|url> | <file>) [options]

Rewrite the URLs in one piece of markup so it works in the generated site:
references to downloaded assets point at their local file (from assets.json),
links to crawled pages point at their new path, and other same-site URLs become
root-relative. External URLs are left alone. Works on the parsed DOM, never by
string replacement.

Use it for what extract.ts does not write: layouts and includes.

Input (one of):
  --page <id|url>      A crawled page, as the starting point for a layout
  <file>               A file with markup taken from the crawl (document or fragment)

Options:
  --base-url <url>     With <file>: URL of the page the markup came from, to resolve
                       relative references (default: the site's start URL)
  --workspace <dir>    Workspace written by crawl.ts (default: ${DEFAULT_WORKSPACE})
  --rules <file>       Rules file whose "urls" overrides apply (default: <workspace>/rules.json)
  --escape-vento       Treat {{ }} in the input as text from the crawled site and
                       escape it. Without this flag, {{ }} in a <file> are taken as
                       Vento tags you wrote and are preserved untouched.
  --in-place           With <file>: overwrite it instead of printing to stdout
  --help               Show this help

Run it on the crawled markup first and add your Vento tags afterwards when you
can: a Vento tag between <head> children or table rows is text to an HTML
parser and gets moved.

${EXIT_HELP}

Examples:
  deno run --allow-read --allow-write scripts/rewrite.ts --page 0001 --escape-vento > site/_includes/layouts/base.vto
  deno run --allow-read --allow-write scripts/rewrite.ts site/_includes/footer.vto --base-url https://example.com/blog/ --in-place`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    string: ["page", "base-url", "workspace", "rules"],
    boolean: ["escape-vento", "in-place", "help"],
    default: { workspace: DEFAULT_WORKSPACE },
  });
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  rejectUnknown(args, ["page", "base-url", "workspace", "rules", "escape-vento", "in-place", "help"]);

  const file = args._[0] === undefined ? undefined : String(args._[0]);
  if ((args.page === undefined) === (file === undefined)) {
    throw new CliError("Pass exactly one input: --page <id|url> or a file path.");
  }
  if (args["in-place"] && !file) throw new CliError("--in-place needs a file path; --page prints to stdout.");

  const workspace = new Workspace(args.workspace);
  const index = await workspace.readPages();
  const manifest = await workspace.readManifest();
  if (!manifest) log("Note: no assets.json in the workspace yet; asset references are not localised. Run scripts/download.ts first.");
  const rules = await workspace.readRules<{ urls?: Record<string, string> }>(args.rules);

  let source: string;
  let baseUrl: string;
  if (file) {
    try {
      source = await Deno.readTextFile(file);
    } catch {
      throw new CliError(`Cannot read "${file}".`);
    }
    baseUrl = args["base-url"] ?? index.startUrl;
    try {
      new URL(baseUrl);
    } catch {
      throw new CliError(`--base-url is not a valid absolute URL. Received: "${baseUrl}"`);
    }
  } else {
    const entry = workspace.findPage(index, args.page!);
    source = await workspace.readHtml(entry);
    baseUrl = entry.url;
  }

  // A crawled page is never a template, whatever it contains.
  const literal = args["escape-vento"] || !file;
  const output = rewriteSource(source, {
    origin: index.origin,
    baseUrl,
    manifest: manifest?.map,
    urlPathMap: buildUrlPathMap(index.pages, rules?.rules.urls),
    vento: literal ? "literal" : "tags",
  });

  if (args["in-place"] && file) {
    await Deno.writeTextFile(file, output);
    log(`Rewrote ${file}`);
  } else {
    console.log(output.replace(/\n$/, ""));
  }
  return EXIT.ok;
}

if (import.meta.main) await runMain(main);
