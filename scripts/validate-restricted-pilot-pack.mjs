// Generated from validate-restricted-pilot-pack.mts by npm run core:build. Do not edit directly.
import { readFile } from "node:fs/promises";
import { RESTRICTED_PILOT_SCOPE_SCHEMA, validateRestrictedPilotScope } from "./restricted-pilot-pack-validation.mjs";
function writeResult(result) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
}
async function main() {
  if (process.argv.length !== 3) {
    writeResult({
      schema: "priorseal.restricted-automation-pilot-readiness.v1",
      valid: false,
      codes: ["USAGE_SCOPE_PATH_REQUIRED"]
    });
    process.exitCode = 1;
    return;
  }
  let input;
  try {
    input = JSON.parse(await readFile(process.argv[2], "utf8"));
  } catch {
    writeResult({
      schema: "priorseal.restricted-automation-pilot-readiness.v1",
      valid: false,
      codes: ["READ_OR_PARSE_FAILED"]
    });
    process.exitCode = 1;
    return;
  }
  const result = validateRestrictedPilotScope(input);
  writeResult({
    schema: "priorseal.restricted-automation-pilot-readiness.v1",
    scopeSchema: RESTRICTED_PILOT_SCOPE_SCHEMA,
    valid: result.valid,
    codes: result.codes,
    verification: result.valid ? "SCOPE_COMPLETE" : "SCOPE_INCOMPLETE"
  });
  if (!result.valid) {
    process.exitCode = 1;
  }
}
void main();
