#!/usr/bin/env node
// Generated from verify.mts by npm run core:build. Do not edit directly.
import { readFile } from "node:fs/promises";
import { verifyActionEvidencePassport } from "./passport.mjs";
function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : void 0;
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return value;
}
const passport = JSON.parse(await readFile(argument("--passport"), "utf8"));
const trust = JSON.parse(await readFile(argument("--trust"), "utf8"));
const result = await verifyActionEvidencePassport(passport, trust);
process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
if (!result.valid) process.exitCode = 1;
