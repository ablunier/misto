import { CliError, EXIT } from "./cli.ts";
import type { AssetManifest, CrawledPage, PageEntry, PagesIndex } from "./types.ts";

/**
 * The directory every script shares. `crawl.ts` creates it; the others read
 * what earlier steps left there and add their own files.
 */
export const DEFAULT_WORKSPACE = ".misto";

const FILES = {
  pages: "pages.json",
  failed: "failed.json",
  assets: "assets.json",
  hints: "hints.json",
  rules: "rules.json",
} as const;

function join(dir: string, file: string): string {
  return `${dir.replace(/\/+$/, "")}/${file}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new CliError(`${path} is not valid JSON: ${(err as Error).message}`, EXIT.workspace);
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await Deno.writeTextFile(path, JSON.stringify(data, null, 2) + "\n");
}

export class Workspace {
  constructor(readonly dir: string) {}

  path(file: string): string {
    return join(this.dir, file);
  }

  /** Replace the crawl results. Assets, hints and rules are left alone. */
  async writeCrawl(startUrl: string, pages: CrawledPage[], failed: string[]): Promise<PagesIndex> {
    const htmlDir = this.path("html");
    await Deno.remove(htmlDir, { recursive: true }).catch(() => {});
    await Deno.mkdir(htmlDir, { recursive: true });

    const width = Math.max(4, String(pages.length).length);
    const entries: PageEntry[] = [];
    for (const [i, page] of pages.entries()) {
      const id = String(i + 1).padStart(width, "0");
      const file = `html/${id}.html`;
      await Deno.writeTextFile(this.path(file), page.rawHtml);
      entries.push({
        id,
        url: page.url,
        title: page.title,
        status: page.statusCode,
        ...(page.slug ? { slug: page.slug } : {}),
        file,
      });
    }

    const index: PagesIndex = { startUrl, origin: new URL(startUrl).origin, pages: entries };
    await writeJson(this.path(FILES.pages), index);
    await writeJson(this.path(FILES.failed), failed);
    return index;
  }

  async readPages(): Promise<PagesIndex> {
    const index = await readJson<PagesIndex>(this.path(FILES.pages));
    if (!index || !Array.isArray(index.pages)) {
      throw new CliError(
        `No crawl found in "${this.dir}" (${FILES.pages} is missing). Run scripts/crawl.ts first, ` +
          `or pass --workspace with the directory it wrote.`,
        EXIT.workspace,
      );
    }
    return index;
  }

  async readHtml(page: PageEntry): Promise<string> {
    try {
      return await Deno.readTextFile(this.path(page.file));
    } catch {
      throw new CliError(
        `${this.path(page.file)} is missing. Run scripts/crawl.ts again.`,
        EXIT.workspace,
      );
    }
  }

  /** Resolve a page by its id or its crawled URL. */
  findPage(index: PagesIndex, ref: string): PageEntry {
    const page = index.pages.find((p) => p.id === ref || p.url === ref) ??
      index.pages.find((p) => Number(p.id) === Number(ref));
    if (!page) {
      throw new CliError(`No crawled page with id or URL "${ref}". Ids are listed in ${this.path(FILES.pages)}.`);
    }
    return page;
  }

  async readManifest(): Promise<AssetManifest | null> {
    return await readJson<AssetManifest>(this.path(FILES.assets));
  }

  async writeManifest(manifest: AssetManifest): Promise<void> {
    await writeJson(this.path(FILES.assets), manifest);
  }

  async writeHints(hints: unknown): Promise<void> {
    await writeJson(this.path(FILES.hints), hints);
  }

  async readRules<T>(path?: string): Promise<{ rules: T; path: string } | null> {
    const file = path ?? this.path(FILES.rules);
    const rules = await readJson<T>(file);
    return rules ? { rules, path: file } : null;
  }

  async writeReport(name: string, report: unknown): Promise<string> {
    const path = this.path(name);
    await writeJson(path, report);
    return path;
  }
}
