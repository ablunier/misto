import { globToRegExp } from "jsr:@std/path@^1.0.0/glob-to-regexp";
import { stringify } from "jsr:@std/yaml@^1.0.0";
import { CliError } from "./cli.ts";
import { type DomElement, type ParsedDoc, parseDocument } from "./dom.ts";
import { outputPathForUrl, pageCanonicalPath, pageOutputPath } from "./paths.ts";
import { rewriteDom, type RewriteOptions } from "./rewrite.ts";
import type { PageEntry } from "./types.ts";
import { wrapEcho } from "./vento.ts";

/**
 * The rules file: how the agent tells `extract.ts` to turn crawled pages into
 * page files. See references/rules.md for the format as the agent reads it.
 */

/** A frontmatter value taken from the crawled page. */
export interface FieldSource {
  selector: string;
  /** Read this attribute instead of the element's text. */
  attr?: string;
  /** Take the element's inner HTML instead of its text. */
  html?: boolean;
  /** Collect every match into a list instead of the first one. */
  all?: boolean;
  /** Used when the selector matches nothing. */
  default?: unknown;
}

/** `{ selector }` extracts, `{ value }` is a literal object, anything else is a literal. */
export type FieldSpec = FieldSource | { value: unknown } | string | number | boolean | null | unknown[];

export interface Rule {
  name: string;
  /** Glob(s) on the URL path, e.g. `/blog/*`. `*` stays within a segment, `**` crosses them. */
  match?: string | string[];
  /** Regular expression on the full crawled URL, for query-string sites. */
  matchUrl?: string;
  /** Explicit page ids. */
  pages?: string[];
  /** Path globs that take pages back out of this rule. */
  exclude?: string | string[];
  /** Matched pages are deliberately not written (handled by a paginator, dropped, …). */
  skip?: boolean;
  /** Selector of the element whose inner HTML becomes the page body. */
  content?: string;
  /** Selectors removed from the content before it is written. */
  remove?: string[];
  /** Layout path as Lume expects it, e.g. `layouts/post.vto`. */
  layout?: string;
  /** Extra frontmatter fields. */
  data?: Record<string, FieldSpec>;
}

export interface RulesFile {
  /** Only `"html"` is supported: page bodies are written as HTML in `.vto` files. */
  format?: "html";
  /** Applied to every rule that does not set the same key. */
  defaults?: Pick<Rule, "content" | "remove" | "layout" | "data">;
  /** Crawled URL → path in the generated site, overriding the derived one. */
  urls?: Record<string, string>;
  rules: Rule[];
}

interface CompiledRule {
  rule: Rule;
  match: RegExp[];
  exclude: RegExp[];
  matchUrl: RegExp | null;
  pages: Set<string>;
}

function list(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function pathOf(url: string): string {
  const path = new URL(url).pathname;
  return path !== "/" && path.endsWith("/") ? path.slice(0, -1) : path;
}

function compileGlob(glob: string): RegExp[] {
  const clean = glob !== "/" && glob.endsWith("/") ? glob.slice(0, -1) : glob;
  const compiled = [globToRegExp(clean, { extended: true, globstar: true, caseInsensitive: true })];
  // `/blog/**` means the section, and the section's own index is part of it.
  if (clean.endsWith("/**") && clean.length > 3) compiled.push(...compileGlob(clean.slice(0, -3)));
  return compiled;
}

/** Check a parsed rules file and prepare it for matching. Throws `CliError` naming the problem. */
export function compileRules(file: RulesFile, source: string): CompiledRule[] {
  if (!file || typeof file !== "object" || !Array.isArray(file.rules) || file.rules.length === 0) {
    throw new CliError(`${source}: expected an object with a non-empty "rules" array. See references/rules.md.`);
  }
  if (file.format !== undefined && file.format !== "html") {
    throw new CliError(`${source}: "format" must be "html" (the only supported format). Received: "${file.format}"`);
  }
  for (const [url, path] of Object.entries(file.urls ?? {})) {
    try {
      new URL(url);
    } catch {
      throw new CliError(`${source}: "urls" key "${url}" must be an absolute crawled URL.`);
    }
    if (typeof path !== "string" || !path.startsWith("/")) {
      throw new CliError(`${source}: "urls" value for "${url}" must be a path starting with "/". Received: "${path}"`);
    }
  }

  const names = new Set<string>();
  return file.rules.map((raw, i) => {
    const rule: Rule = { ...file.defaults, ...raw, data: { ...file.defaults?.data, ...raw.data } };
    const where = `${source}: rules[${i}]`;
    if (!rule.name || typeof rule.name !== "string") throw new CliError(`${where} needs a "name".`);
    if (names.has(rule.name)) throw new CliError(`${where}: duplicate rule name "${rule.name}".`);
    names.add(rule.name);
    if (rule.match === undefined && rule.matchUrl === undefined && rule.pages === undefined) {
      throw new CliError(`${where} ("${rule.name}") needs one of "match", "matchUrl" or "pages". Use "match": "/**" for a catch-all.`);
    }
    if (!rule.skip && !rule.content) {
      throw new CliError(`${where} ("${rule.name}") needs a "content" selector (or "skip": true).`);
    }
    if (!rule.skip && !rule.layout) {
      throw new CliError(`${where} ("${rule.name}") needs a "layout", e.g. "layouts/base.vto" (or set it in "defaults").`);
    }
    let matchUrl: RegExp | null = null;
    if (rule.matchUrl !== undefined) {
      try {
        matchUrl = new RegExp(rule.matchUrl, "i");
      } catch (err) {
        throw new CliError(`${where} ("${rule.name}"): "matchUrl" is not a valid regular expression: ${(err as Error).message}`);
      }
    }
    return {
      rule,
      match: list(rule.match).flatMap(compileGlob),
      exclude: list(rule.exclude).flatMap(compileGlob),
      matchUrl,
      pages: new Set(rule.pages ?? []),
    };
  });
}

/** The first rule that claims a page, in file order. */
export function matchRule(rules: CompiledRule[], page: PageEntry): Rule | null {
  const path = pathOf(page.url);
  for (const { rule, match, exclude, matchUrl, pages } of rules) {
    const hit = pages.has(page.id) || match.some((re) => re.test(path)) || (matchUrl?.test(page.url) ?? false);
    if (hit && !exclude.some((re) => re.test(path))) return rule;
  }
  return null;
}

function isSource(spec: FieldSpec): spec is FieldSource {
  return typeof spec === "object" && spec !== null && !Array.isArray(spec) && "selector" in spec;
}

function readElement(el: DomElement, source: FieldSource): string {
  if (source.attr) return (el.getAttribute(source.attr) ?? "").trim();
  if (source.html) return el.innerHTML.trim();
  return el.textContent.replace(/\s+/g, " ").trim();
}

function readField(doc: ParsedDoc, spec: FieldSpec): { value: unknown; missing: boolean } {
  if (!isSource(spec)) {
    const literal = typeof spec === "object" && spec !== null && !Array.isArray(spec) && "value" in spec;
    return { value: literal ? (spec as { value: unknown }).value : spec, missing: false };
  }
  const matches = [...doc.querySelectorAll(spec.selector)] as DomElement[];
  const values = matches.map((el) => readElement(el, spec)).filter((v) => v !== "");
  if (values.length === 0) return { value: spec.default, missing: spec.default === undefined };
  return { value: spec.all ? values : values[0], missing: false };
}

export interface ExtractedPage {
  /** File to write, relative to the Lume project root. */
  outputPath: string;
  /** Complete file contents: frontmatter and body. */
  source: string;
  /** Frontmatter fields whose selector matched nothing. */
  missingFields: string[];
}

export type ExtractResult =
  | { ok: true; page: ExtractedPage }
  | { ok: false; reason: "unparseable" | "no-content" };

/**
 * Turn one crawled page into a Lume page file according to its rule.
 *
 * Fields are read from the whole document before anything is removed, so an
 * `<h1>` can become the `title` and still be dropped from the body.
 */
export function extractPage(
  page: PageEntry,
  html: string,
  rule: Rule,
  options: RewriteOptions & { urlPathMap: Map<string, string>; overridden?: string },
): ExtractResult {
  const doc = parseDocument(html);
  if (!doc) return { ok: false, reason: "unparseable" };

  // Rewrite first, so a field read from an attribute (`img[src]`) gets the new URL too.
  rewriteDom(doc, { ...options, baseUrl: page.url });

  const description = doc.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
  const url = options.overridden ?? pageCanonicalPath(page.url, page.slug);
  const data: Record<string, unknown> = {
    title: doc.querySelector("title")?.textContent.trim() || page.title,
    ...(description ? { description } : {}),
    layout: rule.layout,
    url,
  };

  const missingFields: string[] = [];
  for (const [field, spec] of Object.entries(rule.data ?? {})) {
    const { value, missing } = readField(doc, spec);
    if (missing) missingFields.push(field);
    else if (value !== undefined) data[field] = value;
  }

  const region = doc.querySelector(rule.content!) as DomElement | null;
  if (!region) return { ok: false, reason: "no-content" };
  for (const selector of rule.remove ?? []) {
    for (const el of region.querySelectorAll(selector)) el.parentNode?.removeChild(el);
  }

  const body = wrapEcho(region.innerHTML.trim());

  const frontMatter = stringify(data, { lineWidth: -1 }).trimEnd();
  return {
    ok: true,
    page: {
      outputPath: options.overridden ? outputPathForUrl(url) : pageOutputPath(page.url, options.origin, page.slug),
      source: `---\n${frontMatter}\n---\n${body}\n`,
      missingFields,
    },
  };
}
