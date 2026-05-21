import type { AssetManifest, AssetUrl } from "./types.ts";

interface DownloadOptions {
  skipJs?: boolean;
  localiseExternal?: boolean;
  origin?: string;
}

async function fetchAsset(url: string): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "misto/0.1 (+https://github.com/misto)" },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    return new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
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
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, quote, rawUrl) => {
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
  const usedNames: Record<string, Set<string>> = { css: new Set(), js: new Set(), img: new Set() };

  const toFetch = assets.filter((a) => {
    if (options.skipJs && a.type === "js") return false;
    if (!options.localiseExternal && options.origin) {
      try {
        if (new URL(a.original).origin !== options.origin) return false;
      } catch {
        return false;
      }
    }
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

  // Write CSS after manifest is complete so url() rewrites are correct
  for (const { text, originalUrl, absPath } of cssQueue) {
    const rewritten = rewriteCssUrls(text, originalUrl, manifest);
    await Deno.writeTextFile(absPath, rewritten);
  }

  return { map: manifest, failed };
}
