#!/usr/bin/env -S deno run --allow-read --allow-write
import { CliError, emit, EXIT, EXIT_HELP, parseArgs, rejectUnknown, requireInt, runMain } from "./lib/cli.ts";
import { type DomElement, parseDocument } from "./lib/dom.ts";
import { buildHints, outline } from "./lib/hints.ts";
import { DEFAULT_WORKSPACE, Workspace } from "./lib/workspace.ts";

const HELP = `Usage: deno run --allow-read --allow-write scripts/inspect.ts [options]

Without --page: analyse the whole crawl and write <workspace>/hints.json with
suggested template clusters, content selectors, pagination candidates, search
forms, languages, CMS/tracking cruft and asset counts. Prints a summary as JSON.
These are suggestions to check against real pages, not decisions.

With --page: look inside one crawled page without reading the whole file.

Options:
  --workspace <dir>    Workspace written by crawl.ts (default: ${DEFAULT_WORKSPACE})
  --page <id|url>      Inspect one page instead of the whole crawl
  --outline            With --page: print a tag/id/class tree (the default)
  --html               With --page: print the markup of the selected element
  --selector <css>     With --page: start from this element instead of <body>
  --depth <n>          With --outline: levels to show (default: 6)
  --help               Show this help

${EXIT_HELP}

Examples:
  deno run --allow-read --allow-write scripts/inspect.ts
  deno run --allow-read --allow-write scripts/inspect.ts --page 0003 --depth 4
  deno run --allow-read --allow-write scripts/inspect.ts --page 0003 --selector "header" --html`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    string: ["workspace", "page", "selector", "depth"],
    boolean: ["outline", "html", "help"],
    default: { workspace: DEFAULT_WORKSPACE, depth: "6" },
  });
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  rejectUnknown(args, ["workspace", "page", "selector", "depth", "outline", "html", "help"]);

  const workspace = new Workspace(args.workspace);
  const index = await workspace.readPages();

  if (args.page !== undefined) {
    const entry = workspace.findPage(index, args.page);
    const doc = parseDocument(await workspace.readHtml(entry));
    if (!doc) throw new CliError(`${entry.file} could not be parsed as HTML.`, EXIT.failure);

    let root = doc.body as DomElement;
    if (args.selector) {
      const matches = doc.querySelectorAll(args.selector);
      if (matches.length === 0) {
        throw new CliError(
          `--selector "${args.selector}" matches nothing on page ${entry.id} (${entry.url}). ` +
            `Run with --outline and no --selector to see what is there.`,
          EXIT.empty,
        );
      }
      root = matches[0] as DomElement;
      if (matches.length > 1) console.error(`Note: "${args.selector}" matches ${matches.length} elements; showing the first.`);
    }

    if (args.html) {
      console.log(args.selector ? root.outerHTML : doc.documentElement?.outerHTML ?? "");
    } else {
      console.log(`# ${entry.id} ${entry.url}`);
      console.log(outline(doc, root, requireInt(args.depth, "depth", 1)).join("\n"));
    }
    return EXIT.ok;
  }

  if (args.selector || args.html || args.outline) {
    throw new CliError("--outline, --html and --selector need --page <id|url>.");
  }

  const pages = [];
  for (const entry of index.pages) pages.push({ entry, html: await workspace.readHtml(entry) });
  const hints = buildHints(index.origin, pages);
  await workspace.writeHints(hints);

  // pageIds can run to hundreds per template; they stay in the file.
  emit({
    ...hints,
    templates: hints.templates.map(({ pageIds: _pageIds, ...template }) => template),
    pagination: hints.pagination.map((group) => ({ ...group, pages: group.pages.length })),
    cruft: hints.cruft.slice(0, 15),
    file: workspace.path("hints.json"),
    next: "Outline two or three pages per template (--page <id> --outline) to confirm the clusters before writing layouts.",
  });
  return EXIT.ok;
}

if (import.meta.main) await runMain(main);
