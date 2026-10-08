import { parseArgs } from "jsr:@std/cli@^1.0.0/parse-args";

export { parseArgs };

/** Exit codes shared by every script; each `--help` lists them. */
export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
  empty: 3,
  workspace: 4,
  problems: 5,
} as const;

export const EXIT_HELP = `Exit codes:
  0  success
  1  unexpected failure
  2  invalid or missing arguments
  3  nothing to do (no pages crawled, no rule matched)
  4  workspace missing or incomplete
  5  ran fine, but found problems to fix (verify.ts only)`;

export class CliError extends Error {
  constructor(message: string, readonly code: number = EXIT.usage) {
    super(message);
  }
}

/** Result data goes to stdout as JSON; everything else goes to stderr. */
export function emit(result: unknown): void {
  console.log(JSON.stringify(result, null, 2));
}

export function log(message: string): void {
  console.error(message);
}

export function requireString(value: unknown, flag: string, usage: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new CliError(`--${flag} is required.\n${usage}`);
}

export function requireInt(value: unknown, flag: string, min: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new CliError(`--${flag} must be an integer >= ${min}. Received: "${value}"`);
  }
  return n;
}

/** Reject flags the script does not know, so a typo is not silently ignored. */
export function rejectUnknown(args: Record<string, unknown>, known: string[]): void {
  for (const key of Object.keys(args)) {
    if (key === "_" || known.includes(key)) continue;
    throw new CliError(`Unknown option --${key}. Run with --help to see the options.`);
  }
}

/** Cap a list for stdout; the full list lives in a workspace file. */
export function sample<T>(items: T[], max = 20): { total: number; shown: T[] } {
  return { total: items.length, shown: items.slice(0, max) };
}

export async function runMain(main: (args: string[]) => Promise<number>): Promise<never> {
  try {
    Deno.exit(await main(Deno.args));
  } catch (err) {
    if (err instanceof CliError) {
      log(`Error: ${err.message}`);
      Deno.exit(err.code);
    }
    log(`Error: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    Deno.exit(EXIT.failure);
  }
}
