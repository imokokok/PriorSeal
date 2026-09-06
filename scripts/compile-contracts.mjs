import { mkdir, readFile, writeFile } from 'node:fs/promises';
import solc from 'solc';

const names = ['RunProofAuthorizationModule.sol', 'RunProofTransparencyAnchor.sol'];
const sources = Object.fromEntries(await Promise.all(names.map(async (name) => [name, { content: await readFile(new URL(`../contracts/${name}`, import.meta.url), 'utf8') }])));
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources, settings: { outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exitCode = 1;
} else {
  const contracts = Object.values(output.contracts ?? {}).flatMap((file) => Object.keys(file));
  console.log(`Compiled ${contracts.length} Solidity contracts/interfaces.`);
  if (process.argv.includes('--write')) {
    const directory = new URL('../.runproof/contracts/', import.meta.url);
    await mkdir(directory, { recursive: true });
    for (const file of Object.values(output.contracts ?? {})) {
      for (const [name, artifact] of Object.entries(file)) {
        await writeFile(new URL(`${name}.json`, directory), `${JSON.stringify({ contractName: name, abi: artifact.abi, bytecode: artifact.evm.bytecode.object ? `0x${artifact.evm.bytecode.object}` : '0x' }, null, 2)}\n`);
      }
    }
    console.log(`Wrote contract artifacts to ${directory.pathname}`);
  }
}
