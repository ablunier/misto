const version = Deno.args[0];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: deno task bump <version> (e.g. 1.2.3)");
  Deno.exit(1);
}

const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
denoJson.version = version;
await Deno.writeTextFile("deno.json", JSON.stringify(denoJson, null, 2) + "\n");

const cli = await Deno.readTextFile("src/cli.ts");
await Deno.writeTextFile(
  "src/cli.ts",
  cli.replace(/^const VERSION = ".+";$/m, `const VERSION = "${version}";`),
);

console.log(`Bumped to ${version}`);
