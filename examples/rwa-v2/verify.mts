// Offline full workflow. All keys, feeds and observations below are SIMULATION.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as prior from '../../sdk/dist/index.js';
import { workflowFixture } from './workflow-fixture.mjs';
let insight = prior;
if (process.argv[2]) {
  const peer=resolve(process.argv[2]);
  execFileSync(process.execPath,['scripts/check-rwa-parity.mjs','--peer',peer],{stdio:'inherit'});
  const module=await import(pathToFileURL(join(peer,'sdk/dist/index.js')).href);
  insight=module.default ?? module;
}
const x=await workflowFixture(prior,insight);
{
  const bundle={receipt:x.receipt(),authority:x.input.authority.proof,execution:x.input.execution.proof};
  const verified=await prior.inspectRwaReceiptBundle(bundle as unknown as Parameters<typeof prior.inspectRwaReceiptBundle>[0],x.input.authority.trust,x.options);
  assert.equal(verified.admissible,true,JSON.stringify(verified));
  const lowOutput=structuredClone(x.observed);
  if (!Array.isArray(lowOutput.transfers) || lowOutput.transfers.length < 2) throw new TypeError('Expected output transfer in fixture');
  (lowOutput.transfers[1] as { amount: string }).amount='1';
  const failure=await prior.inspectRwaReceiptBundle({...bundle,receipt:x.receipt(lowOutput)} as unknown as Parameters<typeof prior.inspectRwaReceiptBundle>[0],x.input.authority.trust,x.options);
  assert.equal(failure.integrity,'PASS');assert.equal(failure.execution,'FAILED');assert.equal(failure.admissible,false);
  console.log(JSON.stringify({environment:'SIMULATION',networkCalls:0,producer:process.argv[2]?'Insight actual built SDK':'pinned Insight vendored SDK',sameSecondLinkedAssessments:true,principalAuthorized:true,semanticCallValidated:true,verification:verified,authenticInsufficientOutputRejected:failure.execution==='FAILED',productionReadiness:'NOT_ACTIVATED'},null,2));
}
