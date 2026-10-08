import { DOMParser } from "jsr:@b-fuze/deno-dom@^0.1.56";

export type ParsedDoc = NonNullable<ReturnType<InstanceType<typeof DOMParser>["parseFromString"]>>;
export type DomElement = ParsedDoc["body"];

export function parseDocument(html: string): ParsedDoc | null {
  return new DOMParser().parseFromString(html, "text/html");
}

/** Parse a markup fragment; its nodes end up under `doc.body`. */
export function parseFragment(html: string): ParsedDoc | null {
  return parseDocument(`<html><body>${html}</body></html>`);
}

/** True when the markup is a whole document rather than a fragment. */
export function isFullDocument(html: string): boolean {
  return /^\s*(<!doctype|<html[\s>])/i.test(html);
}

/** Serialize a parsed document back to markup, with its doctype. */
export function serializeDocument(doc: ParsedDoc): string {
  return `<!DOCTYPE html>\n${doc.documentElement?.outerHTML ?? ""}\n`;
}
