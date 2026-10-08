#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write
import { CliError, emit, EXIT, EXIT_HELP, log, parseArgs, rejectUnknown, requireInt, requireString, runMain, sample } from "./lib/cli.ts";
import { crawl, normalizeUrl } from "./lib/crawler.ts";
import { DEFAULT_WORKSPACE, Workspace } from "./lib/workspace.ts";

const HELP = `Usage: deno run --allow-net --allow-read --allow-write scripts/crawl.ts --url <url> [options]

Crawl a website breadth-first from <url>, staying on its origin, and store every
HTML page in the workspace for the other scripts.

Options:
  --url <url>          Entry point (required). The scheme defaults to https.
  --workspace <dir>    Where to store the crawl (default: ${DEFAULT_WORKSPACE})
  --max-pages <n>      Stop after n pages (default: 500)
  --delay <ms>         Pause between requests (default: 200)
  --sitemap            Also seed the queue from robots.txt / sitemap.xml
  --help               Show this help

Writes:
  <workspace>/pages.json    { startUrl, origin, pages: [{ id, url, title, status, slug?, file }] }
  <workspace>/html/<id>.html
  <workspace>/failed.json   URLs that could not be fetched

Running it again replaces the previous crawl; other workspace files are kept.
Prints a JSON summary to stdout and progress to stderr.

${EXIT_HELP}

Example:
  deno run --allow-net --allow-read --allow-write scripts/crawl.ts --url https://example.com --sitemap`;

export async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv, {
    string: ["url", "workspace", "max-pages", "delay"],
    boolean: ["sitemap", "help"],
    default: { workspace: DEFAULT_WORKSPACE, "max-pages": "500", delay: "200" },
  });
  if (args.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  rejectUnknown(args, ["url", "workspace", "max-pages", "delay", "sitemap", "help"]);

  const rawUrl = requireString(args.url, "url", "Example: scripts/crawl.ts --url https://example.com");
  const maxPages = requireInt(args["max-pages"], "max-pages", 1);
  const delayMs = requireInt(args.delay, "delay", 0);

  let startUrl: string;
  try {
    startUrl = normalizeUrl(rawUrl);
  } catch {
    throw new CliError(`--url is not a valid URL. Received: "${rawUrl}"`);
  }

  log(`Crawling ${startUrl}`);
  let reported = 0;
  const { pages, failed, sitemapCount } = await crawl(
    startUrl,
    { maxPages, delayMs, respectRobots: true, useSitemap: args.sitemap },
    (_url, found) => {
      if (found >= reported + 25) {
        reported = found;
        log(`  ${found} pages…`);
      }
    },
  );

  if (pages.length === 0) {
    throw new CliError(
      `No HTML pages could be fetched from ${startUrl}. Check the URL, that the site is reachable, ` +
        `and that it serves text/html.`,
      EXIT.empty,
    );
  }

  const workspace = new Workspace(args.workspace);
  const index = await workspace.writeCrawl(startUrl, pages, failed);

  emit({
    workspace: workspace.dir,
    origin: index.origin,
    pages: pages.length,
    reachedMaxPages: pages.length >= maxPages,
    ...(args.sitemap ? { sitemapUrls: sitemapCount ?? 0 } : {}),
    queryStringPages: pages.filter((p) => p.slug).length,
    failed: sample(failed),
    index: workspace.path("pages.json"),
    next: "Run scripts/inspect.ts to get hints about the site's templates.",
  });
  return EXIT.ok;
}

if (import.meta.main) await runMain(main);
