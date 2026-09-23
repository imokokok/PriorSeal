// Generated from compile-contracts.mts by npm run core:build. Do not edit directly.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import solc from "solc";
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseCompilerOutput(value) {
  if (!isRecord(value)) throw new Error("Solidity compiler returned a non-object response");
  const messages = Array.isArray(value.errors) ? value.errors : [];
  const errors2 = messages.map((entry) => {
    if (!isRecord(entry) || typeof entry.severity !== "string" || typeof entry.formattedMessage !== "string") {
      throw new Error("Solidity compiler returned a malformed diagnostic");
    }
    return { severity: entry.severity, formattedMessage: entry.formattedMessage };
  });
  if (!isRecord(value.contracts)) {
    if (errors2.some((entry) => entry.severity === "error")) return { contracts: {}, errors: errors2 };
    throw new Error("Solidity compiler response is missing contracts");
  }
  const contracts = {};
  for (const [sourceName, sourceValue] of Object.entries(value.contracts)) {
    if (!isRecord(sourceValue)) throw new Error(`Solidity compiler returned malformed contracts for ${sourceName}`);
    const sourceContracts = {};
    for (const [contractName, artifactValue] of Object.entries(sourceValue)) {
      if (!isRecord(artifactValue) || !isRecord(artifactValue.evm) || !isRecord(artifactValue.evm.bytecode) || typeof artifactValue.evm.bytecode.object !== "string" || !("abi" in artifactValue)) {
        throw new Error(`Solidity compiler returned malformed artifact ${sourceName}:${contractName}`);
      }
      sourceContracts[contractName] = {
        abi: artifactValue.abi,
        evm: { bytecode: { object: artifactValue.evm.bytecode.object } }
      };
    }
    contracts[sourceName] = sourceContracts;
  }
  return { contracts, errors: errors2 };
}
const names = ["PriorSealAuthorizationModule.sol", "PriorSealTransparencyAnchor.sol"];
const sources = Object.fromEntries(await Promise.all(names.map(async (name) => [name, { content: await readFile(new URL(`../contracts/${name}`, import.meta.url), "utf8") }])));
const output = parseCompilerOutput(JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources, settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } }))));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exitCode = 1;
} else {
  const contracts = Object.values(output.contracts ?? {}).flatMap((file) => Object.keys(file));
  console.log(`Compiled ${contracts.length} Solidity contracts/interfaces.`);
  if (process.argv.includes("--write")) {
    const directory = new URL("../.priorseal/contracts/", import.meta.url);
    await mkdir(directory, { recursive: true });
    for (const file of Object.values(output.contracts ?? {})) {
      for (const [name, artifact] of Object.entries(file)) {
        await writeFile(new URL(`${name}.json`, directory), `${JSON.stringify({ contractName: name, abi: artifact.abi, bytecode: artifact.evm.bytecode.object ? `0x${artifact.evm.bytecode.object}` : "0x" }, null, 2)}
`);
      }
    }
    console.log(`Wrote contract artifacts to ${directory.pathname}`);
  }
}
