#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyCalldataFixtures,
  verifyM2Pair,
} from '../thoughtproof-sentinel-paired-v2/verify.reference.mjs';
import type { KeyRegistry, Receipt } from '../../sdk/dist/types.js';

const directory = dirname(fileURLToPath(import.meta.url));

function readText(name: string): string {
  return readFileSync(resolve(directory, name), 'utf8');
}

function readJson<T = unknown>(name: string): T {
  return JSON.parse(readText(name)) as T;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function runFinalPairChecks({ log = console.log }: { log?: (message: string) => void } = {}) {
  const expected = readJson<typeof import('./expected.json')>('expected.json');
  const thoughtProofKeys = readJson<typeof import('./thoughtproof-keys.json')>('thoughtproof-keys.json');
  const trustedIssuerKeys = readJson<KeyRegistry>('priorseal-trusted-issuer-keys.json');
  const results: { name: string; code: string; subjectBindingCode?: string }[] = [];

  for (const [name, expectedHash] of Object.entries(expected.sourceFilesSha256)) {
    const actualHash = sha256(readText(name));
    if (actualHash !== expectedHash) {
      throw new Error(`${name}: expected source SHA-256 ${expectedHash}, received ${actualHash}`);
    }
  }

  const calldataResults = verifyCalldataFixtures(readJson(expected.calldataFixtures));
  results.push(...calldataResults);
  for (const result of calldataResults) log(`PASS ${result.name}: ${result.code}`);

  for (const vector of expected.cases) {
    const artifact = readJson<typeof import('./export-m2-match.json')>(vector.export);
    const priorSealReceipt = readJson<Receipt>(vector.receipt);
    const result = await verifyM2Pair({
      artifact,
      priorSealReceipt,
      keyDocument: thoughtProofKeys,
      trustedIssuerKeys,
      expected,
      allowVectorOnly: vector.allowVectorOnly,
    });
    const code = 'code' in result ? String(result.code) : 'UNKNOWN_RESULT';
    const subjectBindingCode = 'subjectBindingCode' in result ? String(result.subjectBindingCode) : undefined;
    if (code !== vector.expectedCode) {
      throw new Error(`${vector.name}: expected ${vector.expectedCode}, received ${code}`);
    }
    if (
      vector.expectedSubjectBindingCode &&
      subjectBindingCode !== vector.expectedSubjectBindingCode
    ) {
      throw new Error(
        `${vector.name}: expected subject ${vector.expectedSubjectBindingCode}, received ${subjectBindingCode}`,
      );
    }
    results.push({
      name: vector.name,
      code,
      ...(subjectBindingCode ? { subjectBindingCode } : {}),
    });
    log(
      `PASS ${vector.name}: ${code}${subjectBindingCode ? ` + ${subjectBindingCode}` : ''}`,
    );
  }

  log(
    'BOUNDARY ThoughtProof kid tp-sentinel-export-ed25519-2026-09-vector is vector-only, not a production trust root. M1 namespace/export/digest remain unchanged. Oracle Watch is out of scope; GOAT requires a separate explicit go.',
  );
  log(`PASS ${results.length}/${results.length} final-pair checks`);
  return results;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runFinalPairChecks();
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
