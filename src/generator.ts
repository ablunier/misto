import type { AssetManifest, ExtractedPage, GeneratorOptions } from "./types.ts";

export function pageOutputPath(url: string, origin: string): string {
  const pathname = url.startsWith(origin) ? url.slice(origin.length) : url;
  const clean = pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
  return `${clean}.vto`;
}

export function yamlStr(value: string): string {
  const needsQuotes = /[:#\[\]{},|>&*!'"\\%@`]/.test(value) || value.includes("\n") || value.trim() !== value;
  if (!needsQuotes) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function rewritePaths(html: string, manifest: AssetManifest): string {
  let result = html;
  for (const [original, local] of Object.entries(manifest.map)) {
    // Replace absolute URLs
    result = result.split(original).join(local);
    // Replace root-relative URLs
    try {
      const rootRel = new URL(original).pathname;
      result = result.split(`="${rootRel}"`).join(`="${local}"`);
      result = result.split(`='${rootRel}'`).join(`='${local}'`);
    } catch {
      // ignore
    }
  }
  return result;
}

export function rewriteInternalLinks(html: string, origin: string): string {
  return html.replace(/(href|action|content)="(https?:\/\/[^"]+)"/g, (match, attr, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin === origin) {
        return `${attr}="${parsed.pathname}"`;
      }
    } catch {
      // ignore malformed URLs
    }
    return match;
  });
}

function configTs(): string {
  return `import lume from "lume/mod.ts";

const site = lume();

site.copy("assets");

export default site;
`;
}

export async function generateProject(
  pages: ExtractedPage[],
  layout: string,
  manifest: AssetManifest,
  options: GeneratorOptions,
): Promise<void> {
  const out = options.outputDir;
  const origin = (() => {
    try {
      return new URL(options.siteLocation).origin;
    } catch {
      return "";
    }
  })();
  await Deno.mkdir(out, { recursive: true });
  const lumeInit = new Deno.Command("deno", {
    args: ["run", "-A", "https://lume.land/init.ts", out, "--no-cms"],
    stdin: "piped",
    stdout: "inherit",
    stderr: "inherit",
  });
  const child = lumeInit.spawn();
  // Select "Basic" (default) for any interactive prompts by sending Enter
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("\n"));
  await writer.close();
  const { code } = await child.output();
  if (code !== 0) throw new Error(`lume init exited with code ${code}`);

  await Deno.mkdir(`${out}/_includes/layouts`, { recursive: true });
  await Deno.mkdir(`${out}/_data`, { recursive: true });
  await Deno.mkdir(`${out}/assets/css`, { recursive: true });
  await Deno.mkdir(`${out}/assets/js`, { recursive: true });
  await Deno.mkdir(`${out}/assets/img`, { recursive: true });

  await Deno.writeTextFile(`${out}/_config.ts`, configTs());

  const siteTitle = pages[0]?.title ?? (origin ? new URL(origin).hostname : "My Site");
  await Deno.writeTextFile(`${out}/_data/site.yaml`, `title: ${yamlStr(siteTitle)}\nlang: en\n`);

  const layoutWithLinks = rewriteInternalLinks(layout, origin);
  const layoutWithPaths = rewritePaths(layoutWithLinks, manifest);
  await Deno.writeTextFile(`${out}/_includes/layouts/base.vto`, layoutWithPaths);

  for (const page of pages) {
    const outPath = pageOutputPath(page.url, origin);
    const dir = outPath.includes("/")
      ? `${out}/${outPath.slice(0, outPath.lastIndexOf("/"))}`
      : out;
    await Deno.mkdir(dir, { recursive: true });

    let canonicalPath: string;
    try {
      const u = new URL(page.url);
      canonicalPath = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    } catch {
      canonicalPath = "/";
    }

    const fm = [
      "---",
      `title: ${yamlStr(page.title)}`,
      ...(page.description ? [`description: ${yamlStr(page.description)}`] : []),
      `layout: layouts/base.vto`,
      `url: ${canonicalPath}`,
      "---",
      "",
    ].join("\n");

    let content = rewriteInternalLinks(page.contentHtml, origin);
    content = rewritePaths(content, manifest);

    await Deno.writeTextFile(`${out}/${outPath}`, fm + content + "\n");
  }
}
