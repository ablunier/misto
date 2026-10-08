/**
 * Crawled HTML is not a template. A documentation page showing `{{ name }}`
 * would be evaluated by Vento, and the build fails or prints the wrong thing.
 */

const ECHO_CLOSE_RE = /\{\{-?\s*\/echo\s*-?\}\}/;

/** Escape every literal `{{` so Vento prints it instead of evaluating it. */
export function escapeVento(html: string): string {
  return html.replaceAll("{{", '{{ "{{" }}');
}

/**
 * Make a whole page body safe. An `echo` block keeps the markup readable; it
 * cannot hold its own closing tag, so that rare case is escaped tag by tag.
 */
export function wrapEcho(html: string): string {
  if (!html.includes("{{")) return html;
  if (ECHO_CLOSE_RE.test(html)) return escapeVento(html);
  return `{{ echo }}${html}{{ /echo }}`;
}

const TAG_RE = /\{\{[\s\S]*?\}\}/g;
const PLACEHOLDER_OPEN = "⟪misto:";
const PLACEHOLDER_RE = /⟪misto:(\d+)⟫/g;

/** Marks a value that holds a Vento tag and must not be treated as a URL. */
export const VENTO_PLACEHOLDER = PLACEHOLDER_OPEN;

/**
 * Swap Vento tags for inert tokens so the markup can go through an HTML
 * parser, which would otherwise entity-encode `>` and quotes inside them.
 */
export function protectVentoTags(html: string): { html: string; restore: (out: string) => string } {
  const tags: string[] = [];
  const protectedHtml = html.replace(TAG_RE, (tag) => {
    tags.push(tag);
    return `${PLACEHOLDER_OPEN}${tags.length - 1}⟫`;
  });
  return {
    html: protectedHtml,
    restore: (out) => out.replace(PLACEHOLDER_RE, (_, i) => tags[Number(i)] ?? ""),
  };
}

const FRONT_MATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/** Split a template's front matter from its markup. */
export function splitFrontMatter(source: string): { frontMatter: string; body: string } {
  const match = source.match(FRONT_MATTER_RE);
  return match
    ? { frontMatter: match[0], body: source.slice(match[0].length) }
    : { frontMatter: "", body: source };
}
