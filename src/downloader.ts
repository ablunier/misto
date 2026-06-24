import type { AssetManifest, AssetUrl } from "./types.ts";

interface DownloadOptions {
  skipJs?: boolean;
  localiseExternal?: boolean;
  origin?: string;
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
        headers: { "User-Agent": "misto/0.1 (+https://github.com/misto)" },
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

export async function downloadAssets(
  assets: AssetUrl[],
  outputDir: string,
  options: DownloadOptions = {},
): Promise<AssetManifest> {
  const manifest: Record<string, string> = {};
  const usedNames: Record<string, Set<string>> = {
    css: new Set(),
    js: new Set(),
    img: new Set(),
    font: new Set(),
  };

  function isSameOrigin(url: string): boolean {
    if (!options.origin) return true;
    try {
      return new URL(url).host === new URL(options.origin).host;
    } catch {
      return false;
    }
  }

  const toFetch = assets.filter((a) => {
    if (options.skipJs && a.type === "js") return false;
    if (!options.localiseExternal && !isSameOrigin(a.original)) return false;
    return true;
  });

  // Assign local paths first so CSS rewriting can reference the full manifest
  const planned: Array<{ asset: AssetUrl; localPath: string }> = [];
  for (const asset of toFetch) {
    const filename = localFilename(asset.original, usedNames[asset.type]);
    const localPath = `/assets/${asset.type}/${filename}`;
    manifest[asset.original] = localPath;
    planned.push({ asset, localPath });
  }

  const cssQueue: Array<{ text: string; originalUrl: string; absPath: string }> = [];
  const failed: string[] = [];

  for (const { asset, localPath } of planned) {
    const data = await fetchAsset(asset.original);
    if (!data) {
      failed.push(asset.original);
      continue;
    }

    const absPath = `${outputDir}${localPath}`;
    const dir = absPath.slice(0, absPath.lastIndexOf("/"));
    await Deno.mkdir(dir, { recursive: true });

    if (asset.type === "css") {
      cssQueue.push({ text: new TextDecoder().decode(data), originalUrl: asset.original, absPath });
    } else {
      await Deno.writeFile(absPath, data);
    }
  }

  // Discover and download assets referenced by url() inside downloaded CSS
  // (background images, web fonts). Must run before rewriting so new paths
  // are in the manifest when rewriteCssUrls runs.
  for (const { text, originalUrl } of cssQueue) {
    for (const discovered of extractCssUrls(text, originalUrl)) {
      if (manifest[discovered]) continue; // already planned
      if (!options.localiseExternal && !isSameOrigin(discovered)) continue;
      const type = cssAssetType(discovered);
      const filename = localFilename(discovered, usedNames[type]);
      const localPath = `/assets/${type}/${filename}`;
      manifest[discovered] = localPath;
      const data = await fetchAsset(discovered);
      if (!data) {
        failed.push(discovered);
        continue;
      }
      const absPath = `${outputDir}${localPath}`;
      const dir = absPath.slice(0, absPath.lastIndexOf("/"));
      await Deno.mkdir(dir, { recursive: true });
      await Deno.writeFile(absPath, data);
    }
  }

  // Write CSS after manifest is complete so url() rewrites are correct
  for (const { text, originalUrl, absPath } of cssQueue) {
    const rewritten = rewriteCssUrls(text, originalUrl, manifest);
    await Deno.writeTextFile(absPath, rewritten);
  }

  return { map: manifest, failed };
}
