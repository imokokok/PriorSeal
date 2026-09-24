// Generated from rwa-source-lock.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
const run = promisify(execFile), root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "rwa-source-lock-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = ["package.json", "scripts/check-rwa-parity.mjs", "protocol/rwa-source-lock.json", "protocol/rwa-execution-profiles.v1.json", "sdk/src/insight-rwa.ts", "sdk/src/insight-rwa-call.ts", "sdk/src/insight-rwa-v2.ts", "examples/rwa-v2/golden.json"];
  for (const path of paths) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await copyFile(join(root, path), join(dir, path));
  }
  return { dir, check: () => run(process.execPath, [join(dir, "scripts/check-rwa-parity.mjs"), "--peer", root]) };
}
test("source lock validates a reproduced snapshot and rejects shared implementation drift", async (t) => {
  const x = await fixture(t);
  await x.check();
  await appendFile(join(x.dir, "sdk/src/insight-rwa-v2.ts"), "\n// accidental drift\n");
  await assert.rejects(x.check(), /RWA_SOURCE_DRIFT/);
});
test("source lock rejects golden vector mutation", async (t) => {
  const x = await fixture(t);
  await appendFile(join(x.dir, "examples/rwa-v2/golden.json"), " ");
  await assert.rejects(x.check(), /RWA_SOURCE_DRIFT/);
});
test("peer comparison rejects different lock versions even with matching local sources", async (t) => {
  const x = await fixture(t), path = join(x.dir, "protocol/rwa-source-lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  lock.version = "unreviewed";
  await writeFile(path, JSON.stringify(lock));
  await assert.rejects(x.check(), /RWA_LOCK_DIVERGENCE/);
});
test("source lock cannot silently omit a protected input", async (t) => {
  const x = await fixture(t), path = join(x.dir, "protocol/rwa-source-lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  delete lock.sha256["protocol/rwa-execution-profiles.v1.json"];
  await writeFile(path, JSON.stringify(lock));
  await assert.rejects(x.check(), /RWA_LOCK_PATHS_INVALID/);
});
