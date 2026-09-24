import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadApsCase, verifyAps, verifyPair, verifySourceIntegrity } from './adapter.mjs';
import { REFERENCE_TIME } from './trust.mjs';

export async function runExample() {
  const source = verifySourceIntegrity();
  const cases: Array<Record<string, unknown>> = [];
  let permitDecisionRef: string | undefined;
  let permitAuthorizationId: string | undefined;
  let reusedDecisionRef: string | undefined;
  let reusedAuthorizationId: string | undefined;
  for (const [name, apsCase, compliance] of [
    ['permit', 'permit', 'COMPLIANT'], ['narrow', 'narrow', 'COMPLIANT'],
    ['execution-mismatch', 'permit', 'NON_COMPLIANT'], ['decision-reused', 'permit', 'COMPLIANT'],
  ] as const) {
    const receipt: unknown = JSON.parse(readFileSync(new URL(`./priorseal-inputs/${name}.json`, import.meta.url), 'utf8'));
    const result = await verifyPair(loadApsCase(apsCase), receipt);
    assert.equal(result.composition.ok, true, `${name}: ${JSON.stringify(result)}`);
    assert.equal(result.priorSeal.complianceStatus, compliance, name);
    assert.ok(result.composition.decisionRef && result.composition.authorizationId);
    if (name === 'permit') {
      permitDecisionRef = result.composition.decisionRef;
      permitAuthorizationId = result.composition.authorizationId;
    } else if (name === 'decision-reused') {
      reusedDecisionRef = result.composition.decisionRef;
      reusedAuthorizationId = result.composition.authorizationId;
    }
    assert.equal(result.singleUseEstablished, false);
    cases.push({ name, ...result });
  }
  for (const [name, code] of [['deny', 'APS_GATE_REJECTED'], ['expired', 'APS_EXPIRED_AT_REFERENCE']] as const) {
    const aps = verifyAps(loadApsCase(name));
    assert.equal(aps.code, code);
    cases.push({ name, aps, authorizationCreated: false, singleUseEstablished: false });
  }
  assert.equal(permitDecisionRef, reusedDecisionRef);
  assert.notEqual(permitAuthorizationId, reusedAuthorizationId);
  return { profile: 'aps-priorseal-offline-report.v1', source, referenceTime: REFERENCE_TIME,
    producerCommit: '948f99b85343bef2c6fa677c8543965caacfc087',
    dependencies: { aps: '6.0.1', priorseal: '0.4.0' },
    syntheticExecution: true, independentlyVerifiedChainExecution: false,
    singleUseEstablished: false, cases };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runExample(), null, 2)); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
