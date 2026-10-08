import { assertEquals } from "@std/assert";
import vento from "jsr:@vento/vento@^1.14.0";
import { escapeVento, splitFrontMatter, wrapEcho } from "../scripts/lib/vento.ts";

async function render(template: string): Promise<string> {
  const result = await vento().runString(template, {});
  return result.content;
}

Deno.test("escapeVento: Vento prints the original text back", async () => {
  const html = `<p>Hello {{ name }} and {{# comment #}} and {{{ triple }}}</p>`;
  assertEquals(await render(escapeVento(html)), html);
});

Deno.test("wrapEcho: leaves markup without {{ untouched", () => {
  assertEquals(wrapEcho("<p>plain</p>"), "<p>plain</p>");
});

Deno.test("wrapEcho: Vento prints the original text back", async () => {
  const html = `<pre>{{ for item of items }}\n  {{ item |> upper }}\n{{ /for }}</pre>`;
  assertEquals(await render(wrapEcho(html)), html);
});

Deno.test("wrapEcho: content holding an echo closing tag still round-trips", async () => {
  const html = `<code>{{ echo }}raw{{ /echo }}</code>`;
  assertEquals(await render(wrapEcho(html)), html);
});

Deno.test("splitFrontMatter: separates front matter from the body", () => {
  assertEquals(splitFrontMatter("---\na: 1\n---\n<p>x</p>"), { frontMatter: "---\na: 1\n---\n", body: "<p>x</p>" });
  assertEquals(splitFrontMatter("<p>x</p>"), { frontMatter: "", body: "<p>x</p>" });
});
