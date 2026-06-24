import type { AssetManifest, ExtractedPage, GeneratorOptions, PageVariant } from "./types.ts";
import { detectPaginationGroups, generatePaginatorFile, paginationUrl } from "./paginator.ts";

export function pageOutputPath(url: string, origin: string, slug?: string): string {
  try {
    const u = new URL(url);
    if (slug) {
      const dir = u.pathname.replace(/^\//, "").replace(/\/$/, "");
      return dir ? `${dir}/${slug}.vto` : `${slug}.vto`;
    }
    const clean = u.pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
    return `${clean}.vto`;
  } catch {
    const pathname = url.startsWith(origin) ? url.slice(origin.length) : url;
    const clean = pathname.replace(/^\//, "").replace(/\/$/, "") || "index";
    return `${clean}.vto`;
  }
}

function pageCanonicalPath(url: string, slug?: string): string {
  try {
    const u = new URL(url);
    if (slug) {
      const dir = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
      return `${dir}/${slug}/`;
    }
    return u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  } catch {
    return "/";
  }
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

function detectLanguageFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const langParams = ["lang", "language", "locale", "_lang", "l"];
    for (const param of langParams) {
      const value = u.searchParams.get(param);
      if (value) return value.toLowerCase();
    }
  } catch {
    // ignore
  }
  return null;
}

function getCanonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove common language query parameters
    const langParams = ["lang", "language", "locale", "_lang", "l"];
    for (const param of langParams) {
      u.searchParams.delete(param);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function deduplicatePagesByLanguage(pages: ExtractedPage[]): ExtractedPage[] {
  const canonical: ExtractedPage[] = [];
  const seen = new Map<string, number>();

  for (const page of pages) {
    const canonicalUrl = getCanonicalUrl(page.url);
    const hash = `${canonicalUrl}::${page.title}`;

    if (!seen.has(hash)) {
      seen.set(hash, canonical.length);
      canonical.push(page);
    }
  }

  return canonical;
}

export function rewriteInternalLinks(
  html: string,
  origin: string,
  urlPathMap?: Map<string, string>,
): string {
  const originUrl = new URL(origin);

  return html.replace(/(href|action|content)="([^"]+)"/g, (match, attr, url) => {
    // Skip empty or non-http(s) URLs
    if (!url || url.startsWith("#") || url.startsWith("javascript:") || url.startsWith("mailto:") || url.startsWith("tel:")) {
      return match;
    }

    try {
      // Handle full URLs
      if (url.startsWith("http://") || url.startsWith("https://")) {
        const parsed = new URL(url);
        if (parsed.host !== originUrl.host) return match;

        const noFragment = url.split("#")[0];
        if (urlPathMap?.has(noFragment)) {
          return `${attr}="${urlPathMap.get(noFragment)}"`;
        }
        return `${attr}="${parsed.pathname}"`;
      }

      // Handle root-relative URLs (e.g., /page or /page/)
      if (url.startsWith("/")) {
        const noFragment = url.split("#")[0];
        // Try to resolve as absolute URL for map lookup
        try {
          const fullUrl = new URL(noFragment, origin).toString();
          if (urlPathMap?.has(fullUrl)) {
            return `${attr}="${urlPathMap.get(fullUrl)}"`;
          }
        } catch {
          // If resolution fails, just return the root-relative URL
        }
        return match;
      }

      // Handle relative URLs (e.g., page or ./page)
      const resolvedUrl = new URL(url, origin).toString();
      const noFragment = resolvedUrl.split("#")[0];
      if (urlPathMap?.has(noFragment)) {
        return `${attr}="${urlPathMap.get(noFragment)}"`;
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

/**
 * Generate a static Lume search index page using the built-in `search` helper.
 * The page lists all site pages; Lume's search plugin is pre-installed and
 * requires no extra `_config.ts` registration.
 */
function searchPageVto(canonicalPath: string): string {
  return [
    "---",
    `title: Search`,
    "layout: layouts/base.vto",
    `url: ${canonicalPath}`,
    "---",
    "",
    '<ul class="search-results">',
    '  {{ for page of search.pages("") }}',
    "  <li><a href=\"{{ page.url }}\">{{ page.title }}</a></li>",
    "  {{ /for }}",
    "</ul>",
    "",
  ].join("\n");
}

export async function generateProject(
  pages: ExtractedPage[],
  layout: string,
  manifest: AssetManifest,
  options: GeneratorOptions,
  onBeforeLumeInit?: () => void,
): Promise<void> {
  // Deduplicate pages with language variants
  const deduplicatedPages = deduplicatePagesByLanguage(pages);

  const out = options.outputDir;
  const origin = (() => {
    try {
      return new URL(options.siteLocation).origin;
    } catch {
      return "";
    }
  })();
  await Deno.mkdir(out, { recursive: true });

  onBeforeLumeInit?.();

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
  await Deno.mkdir(`${out}/assets/fonts`, { recursive: true });

  const siteTitle = deduplicatedPages[0]?.title ?? (origin ? new URL(origin).hostname : "My Site");
  await Deno.writeTextFile(`${out}/_data/site.yaml`, `title: ${yamlStr(siteTitle)}\nlang: en\n`);

  // Detect paginated groups before building the URL path map so we can map
  // old ?page=N URLs to their new clean paths (/dir/N/).
  const paginationGroups = detectPaginationGroups(deduplicatedPages);
  const groupedPageUrls = new Set<string>(
    paginationGroups.flatMap((g) => g.pages.map((p) => p.url)),
  );

  const urlPathMap = new Map<string, string>();
  for (const page of deduplicatedPages) {
    if (!groupedPageUrls.has(page.url)) {
      urlPathMap.set(page.url, pageCanonicalPath(page.url, page.slug));
    }
  }
  // Add pagination-group URLs → new clean paths
  for (const group of paginationGroups) {
    group.pages.forEach((page, idx) => {
      urlPathMap.set(page.url, paginationUrl(group, idx + 1));
    });
  }

  // Collect unique same-origin search action URLs and add them to the URL map
  // so that form action= attributes get rewritten to the generated search page paths.
  const searchActionUrls = new Set<string>();
  for (const page of deduplicatedPages) {
    for (const action of page.searchActions ?? []) {
      try {
        if (origin && new URL(action).origin === new URL(origin).origin) {
          searchActionUrls.add(action);
        }
      } catch { /* skip malformed */ }
    }
  }
  for (const actionUrl of searchActionUrls) {
    urlPathMap.set(actionUrl, pageCanonicalPath(actionUrl));
  }

  const layoutWithLinks = rewriteInternalLinks(layout, origin, urlPathMap);
  const layoutWithPaths = rewritePaths(layoutWithLinks, manifest);
  await Deno.writeTextFile(`${out}/_includes/layouts/base.vto`, layoutWithPaths);

  await Deno.writeTextFile(`${out}/_config.ts`, configTs());

  // Write normal (non-grouped) pages as .vto files
  for (const page of deduplicatedPages) {
    if (groupedPageUrls.has(page.url)) continue; // handled by paginator

    const outPath = pageOutputPath(page.url, origin, page.slug);
    const dir = outPath.includes("/")
      ? `${out}/${outPath.slice(0, outPath.lastIndexOf("/"))}`
      : out;
    await Deno.mkdir(dir, { recursive: true });

    const canonicalPath = pageCanonicalPath(page.url, page.slug);

    const fm = [
      "---",
      `title: ${yamlStr(page.title)}`,
      ...(page.description ? [`description: ${yamlStr(page.description)}`] : []),
      `layout: layouts/base.vto`,
      `url: ${canonicalPath}`,
      "---",
      "",
    ].join("\n");

    let content = rewriteInternalLinks(page.contentHtml, origin, urlPathMap);
    content = rewritePaths(content, manifest);

    await Deno.writeTextFile(`${out}/${outPath}`, fm + content + "\n");
  }

  // Write .page.ts paginators for each detected group
  for (const group of paginationGroups) {
    const fileBase = group.outputDir || "index";
    const outPath = `${fileBase}.page.ts`;
    const fileContent = generatePaginatorFile(group, origin, urlPathMap, manifest);
    await Deno.writeTextFile(`${out}/${outPath}`, fileContent);
  }

  // Write a static search index page for each detected search form action URL.
  // Uses Lume's built-in `search` helper (pre-installed, no _config.ts change needed).
  for (const actionUrl of searchActionUrls) {
    const outPath = pageOutputPath(actionUrl, origin);
    const dir = outPath.includes("/")
      ? `${out}/${outPath.slice(0, outPath.lastIndexOf("/"))}`
      : out;
    await Deno.mkdir(dir, { recursive: true });
    const canonicalPath = pageCanonicalPath(actionUrl);
    await Deno.writeTextFile(`${out}/${outPath}`, searchPageVto(canonicalPath));
  }
}
