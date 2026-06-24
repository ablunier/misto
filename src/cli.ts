import { Command } from "@cliffy/command";
import { Checkbox, Input } from "@cliffy/prompt";
import { Table } from "@cliffy/table";
import { crawl, normalizeUrl } from "./crawler.ts";
import { extractBaseLayout, extractPage } from "./extractor.ts";
import { downloadAssets } from "./downloader.ts";
import { generateProject } from "./generator.ts";
import type { AssetUrl, CrawlOptions } from "./types.ts";

const VERSION = "0.1.1";

class Spinner {
  static #frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  #encoder = new TextEncoder();
  #text: string;
  #timer: ReturnType<typeof setInterval> | undefined;
  #frame = 0;

  constructor(text: string) {
    this.#text = text;
  }

  set text(value: string) {
    this.#text = value;
  }

  start(): this {
    if (!Deno.stdout.isTerminal()) return this;
    this.#timer = setInterval(() => {
      const frame = Spinner.#frames[this.#frame++ % Spinner.#frames.length];
      Deno.stdout.writeSync(this.#encoder.encode(`\r  ${frame} ${this.#text}`));
    }, 80);
    return this;
  }

  stop(): void {
    if (!this.#timer) return;
    clearInterval(this.#timer);
    Deno.stdout.writeSync(this.#encoder.encode("\r" + " ".repeat(80) + "\r"));
  }
}

function toPath(url: string, origin: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname + (u.search ? u.search : "");
    return path || "/";
  } catch {
    return url.replace(origin, "") || "/";
  }
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

type CliOptions = {
  url?: string;
  output: string;
  maxPages: number;
  delay: number;
  localiseAssets?: true;
  js: boolean;
  sitemap?: true;
  dryRun?: true;
  yes?: true;
};

export async function run(): Promise<void> {
  await new Command()
    .name("misto")
    .version(VERSION)
    .description("Crawl any website and generate a Lume project from it.")
    .option("-u, --url <url:string>", "Entry point URL (prompted if not provided)")
    .option("-o, --output <dir:string>", "Output directory", { default: "./output" })
    .option("--max-pages <number:integer>", "Maximum pages to crawl", { default: 500 })
    .option("--delay <ms:integer>", "Delay between requests in ms", { default: 200 })
    .option("--localise-assets", "Download external CDN assets locally")
    .option("--no-js", "Skip JavaScript asset download")
    .option("--sitemap", "Seed crawl queue from sitemap.xml (checks robots.txt first)")
    .option("--dry-run", "Crawl and list pages without generating files")
    .option("--yes", "Migrate all pages without prompting")
    .action(async (options: CliOptions) => {
      let rawUrl = options.url;

      if (!rawUrl) {
        rawUrl = await Input.prompt({
          message: "Enter the starting URL to crawl",
          hint: "e.g. https://lume.land",
          validate: (value) => {
            if (!value.trim()) return "URL is required";

            try {
              const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
              new URL(url);

              return true;
            } catch {
              return "Please enter a valid URL";
            }
          },
        });
      }

      let startUrl: string;

      try {
        startUrl = normalizeUrl(rawUrl.trim());
      } catch {
        console.error(`Error: Invalid URL — "${rawUrl}"`);
        Deno.exit(1);
      }

      console.log(`\nStarting crawl from: ${startUrl}\n`);

      const crawlOptions: CrawlOptions = {
        maxPages: options.maxPages,
        delayMs: options.delay,
        respectRobots: true,
        useSitemap: options.sitemap,
      };

      const spinner = new Spinner("Crawling…  0 pages found");
      spinner.start();

      const { pages, failed, sitemapCount } = await crawl(
        startUrl,
        crawlOptions,
        (_currentUrl, found) => {
          spinner.text = `Crawling…  ${found} page${found === 1 ? "" : "s"} found`;
        },
      );

      spinner.stop();

      if (options.sitemap) {
        if (sitemapCount && sitemapCount > 0) {
          console.log(`Sitemap: ${sitemapCount} URL${sitemapCount === 1 ? "" : "s"} discovered.`);
        } else {
          console.log("Sitemap: none found — falling back to link crawl.");
        }
      }

      if (pages.length === 0) {
        console.error("\nNo pages found. Check the URL and try again.");
        Deno.exit(2);
      }

      const origin = new URL(startUrl).origin;
      const rows = pages.map((p, i) => [
        String(i + 1).padStart(3),
        truncate(toPath(p.url, origin), 45),
        truncate(p.title || "(no title)", 30),
        String(p.statusCode),
      ]);

      console.log();
      new Table()
        .header(["  #", "URL", "Title", "Status"])
        .body(rows)
        .border(true)
        .render();

      console.log(`\nTotal: ${pages.length} page${pages.length === 1 ? "" : "s"} found`);

      if (options.maxPages <= pages.length) {
        console.log(`\nNote: crawl stopped at the --max-pages limit (${options.maxPages}).`);
      }

      if (options.dryRun) {
        if (failed.length > 0) {
          console.log(`\nWarning: ${failed.length} URL${failed.length === 1 ? "" : "s"} could not be fetched.`);
        }
        Deno.exit(0);
      }

      let selectedPages: typeof pages;
      if (options.yes) {
        selectedPages = pages;
      } else {
        const SELECT_ALL = "__select_all__";
        const checkboxOptions = [
          { name: "[ Select all ]", value: SELECT_ALL },
          ...pages.map((p) => ({
            name: `${truncate(toPath(p.url, origin), 40)}  ${truncate(p.title || "(no title)", 35)}`,
            value: p.url,
          })),
        ];

        const selection: string[] = await Checkbox.prompt({
          message: "Select pages to migrate",
          options: checkboxOptions,
          minOptions: 1,
        });

        const selectedUrls = new Set<string>(
          selection.includes(SELECT_ALL) ? pages.map((p) => p.url) : selection,
        );
        selectedPages = pages.filter((p) => selectedUrls.has(p.url));
      }

      console.log(
        `\n${selectedPages.length} page${selectedPages.length === 1 ? "" : "s"} selected.\n`,
      );

      const assetSpinner = new Spinner("Collecting assets…");
      assetSpinner.start();

      const assetMap = new Map<string, AssetUrl>();
      for (const page of selectedPages) {
        for (const asset of extractPage(page).assetUrls) {
          if (!assetMap.has(asset.original)) {
            assetMap.set(asset.original, asset);
          }
        }
      }

      assetSpinner.stop();

      const allAssets = [...assetMap.values()];
      const counts = { css: 0, js: 0, img: 0, font: 0 };
      for (const a of allAssets) {
        counts[a.type]++;
      }

      console.log("Asset inventory:");
      console.log(`  CSS files : ${counts.css}`);
      console.log(`  JS files  : ${counts.js}`);
      console.log(`  Images    : ${counts.img}`);
      console.log(`  Total     : ${allAssets.length}`);

      // Download assets
      const downloadSpinner = new Spinner(`Downloading ${allAssets.length} asset${allAssets.length === 1 ? "" : "s"}…`);
      downloadSpinner.start();

      const manifest = await downloadAssets(allAssets, options.output, {
        skipJs: options.js === false,
        localiseExternal: options.localiseAssets,
        origin: new URL(startUrl).origin,
      });

      downloadSpinner.stop();

      const downloaded = Object.keys(manifest.map).length;
      console.log(`\nDownloaded ${downloaded} asset${downloaded === 1 ? "" : "s"}.`);

      const genSpinner = new Spinner("Generating Lume project…");
      genSpinner.start();

      const extractedPages = selectedPages.map(extractPage);
      const layout = extractBaseLayout(pages[0]);

      await generateProject(extractedPages, layout, manifest, {
        outputDir: options.output,
        siteLocation: startUrl,
      }, () => genSpinner.stop());

      genSpinner.stop();

      console.log(`\nLume project generated → ${options.output}`);
      console.log(`  cd ${options.output} && deno task serve`);

      const failedDownloads = manifest.failed;
      const hasErrors = failed.length > 0 || failedDownloads.length > 0;

      if (hasErrors) {
        console.log("\n--- Error summary ---");
        
        if (failed.length > 0) {
          console.log(`\nFailed to crawl (${failed.length}):`);
          for (const u of failed) console.log(`  - ${u}`);
        }

        if (failedDownloads.length > 0) {
          console.log(`\nFailed to download (${failedDownloads.length}):`);
          for (const u of failedDownloads) console.log(`  - ${u}`);
        }
      }
    })
    .parse(Deno.args);
}
