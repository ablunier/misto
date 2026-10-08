import type { AssetManifest, AssetUrl } from "./types.ts";

interface DownloadOptions {
  skipJs?: boolean;
  localiseExternal?: boolean;
  origin?: string;
  /**
   * Manifest of an earlier run. Its filenames are kept, and an asset whose
   * file is still on disk is not fetched again.
   */
  existing?: Record<string, string>;
}

/** Shared regex for matching CSS url() references. */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Extract all URLs referenced via url() in a CSS string, resolved against
 * `baseUrl`. Skips data: URIs. Returns absolute URL strings.
 */
export function extractCssUrls(css: string, baseUrl: string): string[] {
  const urls: string[] = [];
  for (const m of css.matchAll(CSS_URL_RE)) {
    const raw = m[2].trim();
    if (!raw || raw.startsWith("data:")) continue;
    try {
      urls.push(new URL(raw, baseUrl).toString());
    } catch {
      // ignore unresolvable
    }
  }
  return urls;
}

/** Classify a URL as "font" or "img" by its file extension. */
function cssAssetType(url: string): Extract<AssetUrl["type"], "img" | "font"> {
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
    if (/^(woff2?|ttf|otf|eot)$/.test(ext)) return "font";
  } catch { /* fall through */ }
  return "img";
}

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchAsset(url: string): Promise<Uint8Array | null> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "misto (+https://github.com/ablunier/misto)" },
        redirect: "follow",
      });

      if (resp.status === 429 && attempt < MAX_RETRIES) {
        await delay(1000 * Math.pow(2, attempt));
        continue;
      }

      if (!resp.ok) return null;
      return new Uint8Array(await resp.arrayBuffer());
    } catch {
      if (attempt < MAX_RETRIES) {
        await delay(1000 * Math.pow(2, attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

export function localFilename(url: string, usedNames: Set<string>): string {
  let name: string;
  try {
    name = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "asset";
  } catch {
    name = "asset";
  }
  if (!name) name = "asset";

  let candidate = name;
  let counter = 2;
  while (usedNames.has(candidate)) {
    const dot = name.lastIndexOf(".");
    candidate =
      dot >= 0 ? `${name.slice(0, dot)}_${counter}${name.slice(dot)}` : `${name}_${counter}`;
    counter++;
  }
  usedNames.add(candidate);
  return candidate;
}

export function rewriteCssUrls(css: string, cssOriginalUrl: string, manifest: Record<string, string>): string {
  return css.replace(CSS_URL_RE, (match, quote, rawUrl) => {
    try {
      const resolved = new URL(rawUrl.trim(), cssOriginalUrl).toString();
      const local = manifest[resolved];
      if (local) return `url(${quote}${local}${quote})`;
    } catch {
      // ignore unresolvable
    }
    return match;
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

export async function downloadAssets(
  assets: AssetUrl[],
  outputDir: string,
  options: DownloadOptions = {},
  onProgress?: (done: number, total: number) => void,
): Promise<AssetManifest> {
  const manifest: Record<string, string> = { ...options.existing };
  const usedNames: Record<string, Set<string>> = {
    css: new Set(),
    js: new Set(),
    img: new Set(),
    font: new Set(),
  };
  for (const localPath of Object.values(manifest)) {
    const [, , type, filename] = localPath.split("/");
    usedNames[type]?.add(filename);
  }

  function isSameOrigin(url: string): boolean {
    if (!options.origin) return true;
    try {
      return new URL(url).host === new URL(options.origin).host;
    } catch {
      return false;
    }
  }

  function plan(url: string, type: AssetUrl["type"]): string {
    if (!manifest[url]) {
      manifest[url] = `/assets/${type}/${localFilename(url, usedNames[type])}`;
    }
    return manifest[url];
  }

  async function write(localPath: string, data: Uint8Array | string): Promise<void> {
    const absPath = `${outputDir}${localPath}`;
    await Deno.mkdir(absPath.slice(0, absPath.lastIndexOf("/")), { recursive: true });
    if (typeof data === "string") await Deno.writeTextFile(absPath, data);
    else await Deno.writeFile(absPath, data);
  }

  const toFetch = assets.filter((a) => {
    if (options.skipJs && a.type === "js") return false;
    if (!options.localiseExternal && !isSameOrigin(a.original)) return false;
    return true;
  });

  // Assign local paths first so CSS rewriting can reference the full manifest
  const planned = toFetch.map((asset) => ({ asset, localPath: plan(asset.original, asset.type) }));

  const cssQueue: Array<{ text: string; originalUrl: string; localPath: string }> = [];
  const failed: string[] = [];
  let done = 0;

  for (const { asset, localPath } of planned) {
    onProgress?.(++done, planned.length);
    if (await exists(`${outputDir}${localPath}`)) continue;

    const data = await fetchAsset(asset.original);
    if (!data) {
      failed.push(asset.original);
      continue;
    }

    if (asset.type === "css") {
      cssQueue.push({ text: new TextDecoder().decode(data), originalUrl: asset.original, localPath });
    } else {
      await write(localPath, data);
    }
  }

  // Discover and download assets referenced by url() inside downloaded CSS
  // (background images, web fonts). Must run before rewriting so new paths
  // are in the manifest when rewriteCssUrls runs.
  for (const { text, originalUrl } of cssQueue) {
    for (const discovered of extractCssUrls(text, originalUrl)) {
      if (!options.localiseExternal && !isSameOrigin(discovered)) continue;
      const known = discovered in manifest;
      const localPath = plan(discovered, cssAssetType(discovered));
      if (known && await exists(`${outputDir}${localPath}`)) continue;
      if (failed.includes(discovered)) continue;
      const data = await fetchAsset(discovered);
      if (!data) {
        failed.push(discovered);
        continue;
      }
      await write(localPath, data);
    }
  }

  // A reference to an asset that never arrived must keep pointing at the
  // original, not at a local file that does not exist.
  for (const url of failed) delete manifest[url];

  // Write CSS after manifest is complete so url() rewrites are correct
  for (const { text, originalUrl, localPath } of cssQueue) {
    await write(localPath, rewriteCssUrls(text, originalUrl, manifest));
  }

  return { map: manifest, failed };
}
