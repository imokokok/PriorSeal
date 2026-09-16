#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  verifyCalldataFixtures,
  verifyM2Pair,
} from '../thoughtproof-sentinel-paired-v2/verify.mjs';

const directory = dirname(fileURLToPath(import.meta.url));

function readText(name) {
  return readFileSync(resolve(directory, name), 'utf8');
}

function readJson(name) {
  return JSON.parse(readText(name));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function runFinalPairChecks({ log = console.log } = {}) {
  const expected = readJson('expected.json');
  const thoughtProofKeys = readJson('thoughtproof-keys.json');
  const trustedIssuerKeys = readJson('priorseal-trusted-issuer-keys.json');
  const results = [];

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
    const artifact = readJson(vector.export);
    const priorSealReceipt = readJson(vector.receipt);
    const result = await verifyM2Pair({
      artifact,
      priorSealReceipt,
      keyDocument: thoughtProofKeys,
      trustedIssuerKeys,
      expected,
      allowVectorOnly: vector.allowVectorOnly,
    });
    if (result.code !== vector.expectedCode) {
      throw new Error(`${vector.name}: expected ${vector.expectedCode}, received ${result.code}`);
    }
    if (
      vector.expectedSubjectBindingCode &&
      result.subjectBindingCode !== vector.expectedSubjectBindingCode
    ) {
      throw new Error(
        `${vector.name}: expected subject ${vector.expectedSubjectBindingCode}, received ${result.subjectBindingCode}`,
      );
    }
    results.push({
      name: vector.name,
      code: result.code,
      ...(result.subjectBindingCode ? { subjectBindingCode: result.subjectBindingCode } : {}),
    });
    log(
      `PASS ${vector.name}: ${result.code}${result.subjectBindingCode ? ` + ${result.subjectBindingCode}` : ''}`,
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
