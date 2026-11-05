// Runs npm scripts in parallel with bounded concurrency and prefixed output.
// Usage: node scripts/run-checks-parallel.mjs <npm-script-name> [...more]
// Concurrency can be tuned with CHECKS_PARALLEL_LIMIT (default: 6).
//
// A plain `node`/`npx` command line runs directly instead of through `npm run`,
// which saves one npm process (about 0.3 s) per check.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { EOL } from "node:os";
import os from "node:os";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
const names: string[] = process.argv.slice(2);
if (names.length === 0) {
  console.error("Usage: node scripts/run-checks-parallel.mjs <npm-script-name> [...more]");
  process.exit(1);
}
const scripts: Record<string, string | undefined> = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")
).scripts;
const cpus = os.availableParallelism?.() ?? os.cpus().length;
const limit = Number(process.env.CHECKS_PARALLEL_LIMIT ?? Math.max(2, Math.min(6, cpus - 2)));
const results = new Map<string, number>();
function commandFor(name: string): [string, string[]] {
  const script = scripts[name];
  if (typeof script !== "string") return ["npm", ["run", "--silent", name]];
  if (/^(node|npx|tsgo|tsc|eslint)\s/.test(script) && !/&&|\|\||;|>|\||\$\(/.test(script)) return ["sh", ["-c", script]];
  return ["npm", ["run", "--silent", name]];
}
function run(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const [command, args] = commandFor(name);
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${join(process.cwd(), "node_modules", ".bin")}:${process.env.PATH ?? ""}` }
    });
    const tag = `[${name}] `;
    const pipe = (stream: Readable, out: NodeJS.WriteStream): void => {
      let buffer = "";
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buffer += chunk;
        const lines = buffer.split(EOL);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.length > 0) out.write(`${tag}${line}${EOL}`);
        }
      });
      stream.on("end", () => {
        if (buffer.length > 0) out.write(`${tag}${buffer}${EOL}`);
      });
    };
    pipe(child.stdout, process.stdout);
    pipe(child.stderr, process.stderr);
    child.on("close", (code) => {
      results.set(name, code ?? 1);
      resolve();
    });
  });
}
async function main(): Promise<void> {
  const queue = [...names];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const name = queue.shift();
      if (name === undefined) return;
      await run(name);
    }
  });
  await Promise.all(workers);
  const failures = names.filter((name) => results.get(name) !== 0);
  if (failures.length > 0) {
    console.error(`Failed checks: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`All ${names.length} checks passed.`);
}
await main();
