import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { evaluateInsightProtocolTrust } from '../../sdk/dist/insight-protocol-trust.js';
import {
  EXECUTION_PROFILE_V1_ID,
  verifyExecutionReceipt,
} from '../../sdk/dist/insight-execution-v5.js';
import {
  contentId,
  createInsightProtocolTrust,
  createSignedExecution,
  snapshotPin,
} from '../helpers/insight-protocol-fixture.mjs';

const signer = privateKeyToAccount(generatePrivateKey());
const differentId = `0x${'f'.repeat(64)}`;
const clone = (value) => structuredClone(value);
async function fixture(options = {}) {
  return {
    proof: await createSignedExecution({ signer, ...options }),
    trust: createInsightProtocolTrust({ signer, ...options }),
  };
}
function changeSnapshot(trust, mutate) {
  const snapshot = JSON.parse(trust.registrySnapshot.rawJson);
  mutate(snapshot);
  trust.registrySnapshot = snapshotPin(snapshot);
}
function unpinPolicy(trust) {
  delete trust.consumerPolicy.policyId;
  delete trust.consumerPolicy.policyRawJson;
}
function changePolicy(trust, mutate) {
  const { policyId: _ignored, ...body } = JSON.parse(trust.consumerPolicy.policyRawJson);
  mutate(body);
  const policyId = contentId(body);
  trust.consumerPolicy.policyId = policyId;
  trust.consumerPolicy.policyRawJson = JSON.stringify({ policyId, ...body });
}
async function expectCode(proof, trust, expected) {
  const result = await evaluateInsightProtocolTrust(proof, trust);
  assert.equal(result.valid, false);
  assert.equal(result.code, expected);
  return result;
}

test('real v5 signature and pinned production protocol pass as separate checks', async (t) => {
  t.mock.method(Date, 'now', () => 1200000);
  const { proof, trust } = await fixture();
  const crypto = await verifyExecutionReceipt(proof, {
    keyRegistry: JSON.parse(trust.registrySnapshot.rawJson),
    now: 1200,
  });
  assert.equal(crypto.valid, true);
  assert.equal(crypto.cryptographicValid, true);
  assert.equal(crypto.trustedAttester, true);
  const protocol = await evaluateInsightProtocolTrust(proof, trust);
  assert.equal(protocol.valid, true);
  assert.equal(protocol.code, 'SIGNED_PROFILE_VERIFIED');
  assert.equal(protocol.scope, 'signed-profile');
  assert.equal(protocol.profileId, EXECUTION_PROFILE_V1_ID);
  assert.equal(protocol.matchedReleaseFloor, trust.consumerPolicy.registryReleaseIds[0]);
  assert.equal(protocol.registrySnapshotSha256, trust.registrySnapshot.sha256);
  assert.equal(protocol.registrySnapshotByteLength, trust.registrySnapshot.byteLength);
});

test('protocol verification does not claim signature validity; every caller must check both', async () => {
  const { proof, trust } = await fixture();
  proof.signature = `0x${'0'.repeat(130)}`;
  assert.equal((await evaluateInsightProtocolTrust(proof, trust)).valid, true);
  assert.equal(
    (
      await verifyExecutionReceipt(proof, {
        keyRegistry: JSON.parse(trust.registrySnapshot.rawJson),
        now: 1200,
      })
    ).valid,
    false,
  );
});

test('native v5 rejects tampered UID, environment, profile and transaction fields', async () => {
  const { proof, trust } = await fixture();
  const options = { keyRegistry: JSON.parse(trust.registrySnapshot.rawJson), now: 1200 };
  for (const mutation of [
    (p) => {
      p.uid = differentId;
    },
    (p) => {
      p.data.environment = 'nonproduction';
    },
    (p) => {
      p.data.profileId = differentId;
    },
    (p) => {
      p.data.txHash = differentId;
    },
  ]) {
    const changed = clone(proof);
    mutation(changed);
    assert.equal((await verifyExecutionReceipt(changed, options)).cryptographicValid, false);
  }
});

test('a genuinely signed unknown profile is cryptographically sound but unsupported', async () => {
  const { proof, trust } = await fixture({ overrides: { profileId: differentId } });
  const result = await verifyExecutionReceipt(proof, {
    keyRegistry: JSON.parse(trust.registrySnapshot.rawJson),
    now: 1200,
  });
  assert.equal(result.cryptographicValid, true);
  assert.equal(result.valid, false);
  assert.equal(result.code, 'unsupported_profile');
  await expectCode(proof, trust, 'UNSUPPORTED_SIGNED_PROFILE');
});

test('absent trust/snapshot and independently mismatched hash or byte count fail closed', async () => {
  const { proof, trust } = await fixture();
  await expectCode(proof, undefined, 'INSIGHT_PROTOCOL_TRUST_REQUIRED');
  const missing = clone(trust);
  delete missing.registrySnapshot;
  await expectCode(proof, missing, 'REGISTRY_SNAPSHOT_REQUIRED');
  for (const mutate of [
    (t) => {
      t.registrySnapshot.rawJson += ' ';
    },
    (t) => {
      t.registrySnapshot.byteLength += 1;
    },
    (t) => {
      t.registrySnapshot.sha256 = '0'.repeat(64);
    },
  ]) {
    const changed = clone(trust);
    mutate(changed);
    await expectCode(proof, changed, 'REGISTRY_SNAPSHOT_MISMATCH');
  }
});

test('SHA-256 covers exact UTF-8 bytes including non-ASCII metadata', async () => {
  const { proof, trust } = await fixture();
  changeSnapshot(trust, (raw) => {
    raw.note = '离线证据';
  });
  assert.ok(trust.registrySnapshot.byteLength > trust.registrySnapshot.rawJson.length);
  assert.equal((await evaluateInsightProtocolTrust(proof, trust)).valid, true);
  trust.registrySnapshot.byteLength = trust.registrySnapshot.rawJson.length;
  await expectCode(proof, trust, 'REGISTRY_SNAPSHOT_MISMATCH');
});

test('registry must describe the exact field layout/domain, once only', async () => {
  const { proof, trust } = await fixture();
  for (const mutate of [
    (raw) => {
      raw.schemas.ExecutionReceipt.eip712.domain.chainId = 8453;
    },
    (raw) => {
      raw.schemas.ExecutionReceipt.eip712.types.ExecutionReceipt.pop();
    },
    (raw) => {
      raw.schemas.Duplicate = clone(raw.schemas.ExecutionReceipt);
    },
  ]) {
    const changed = clone(trust);
    changeSnapshot(changed, mutate);
    await expectCode(proof, changed, 'REGISTRY_SCHEMA_MISMATCH');
  }
});

test('production registry preserves its documented omitted-role attester default', async () => {
  const { proof, trust } = await fixture();
  changeSnapshot(trust, (raw) => {
    delete raw.public_keys[0].role;
  });
  assert.equal((await evaluateInsightProtocolTrust(proof, trust)).valid, true);
});

test('sample/unknown key roles, duplicate IDs/addresses and competing aliases are rejected', async () => {
  const { proof, trust } = await fixture();
  for (const mutate of [
    (raw) => {
      raw.public_keys[0].role = 'sample';
    },
    (raw) => {
      raw.public_keys[0].role = 'production';
    },
    (raw) => {
      raw.public_keys.push({ ...raw.public_keys[0], key_id: 'duplicate-address' });
    },
    (raw) => {
      raw.public_keys.push({ ...raw.public_keys[0], public_key: `0x${'a'.repeat(40)}` });
    },
    (raw) => {
      raw.keys = clone(raw.public_keys);
    },
    (raw) => {
      raw.revoked = [];
    },
  ]) {
    const changed = clone(trust);
    changeSnapshot(changed, mutate);
    await expectCode(proof, changed, 'REGISTRY_PRODUCTION_SIGNER_REQUIRED');
  }
});

test('trust windows and revocation are evaluated at signed execution time', async () => {
  const { proof, trust } = await fixture();
  for (const mutate of [
    (raw) => {
      raw.public_keys[0].revoked = true;
    },
    (raw) => {
      raw.revoked_keys.push({ key_id: raw.public_keys[0].key_id });
    },
    (raw) => {
      raw.public_keys[0].validFrom = new Date(1101000).toISOString();
    },
    (raw) => {
      raw.public_keys[0].validUntil = new Date(1099000).toISOString();
    },
  ]) {
    const changed = clone(trust);
    changeSnapshot(changed, mutate);
    await expectCode(proof, changed, 'REGISTRY_SIGNER_UNTRUSTED');
  }
  for (const value of ['invalid', undefined]) {
    const changed = clone(trust);
    changeSnapshot(changed, (raw) => {
      raw.public_keys[0].validUntil = value;
    });
    await expectCode(proof, changed, 'REGISTRY_PRODUCTION_SIGNER_REQUIRED');
  }
});

test('a valid native nonproduction signature cannot satisfy production protocol trust', async (t) => {
  t.mock.method(Date, 'now', () => 1200000);
  const { proof, trust } = await fixture({ overrides: { environment: 'nonproduction' } });
  assert.equal(
    (
      await verifyExecutionReceipt(proof, {
        keyRegistry: JSON.parse(trust.registrySnapshot.rawJson),
        now: 1200,
      })
    ).valid,
    true,
  );
  await expectCode(proof, trust, 'NONPRODUCTION_EXECUTION');
});

test('content-addressed profile body is required and cannot be changed in place', async () => {
  const { proof, trust } = await fixture();
  const missing = clone(trust);
  missing.executionProfiles = [];
  await expectCode(proof, missing, 'IMMUTABLE_PROFILE_REQUIRED');
  const changed = clone(trust);
  const raw = JSON.parse(changed.executionProfiles[0].rawJson);
  raw.profile.scales.quotedPrice = 18;
  changed.executionProfiles[0].rawJson = JSON.stringify(raw);
  await expectCode(proof, changed, 'INVALID_INSIGHT_PROTOCOL_EVIDENCE');
});

test('release lineage requires all traversed bodies, exact content IDs, and an allowed floor', async () => {
  const { proof, trust } = await fixture();
  const absentAncestor = clone(trust);
  absentAncestor.registryReleases.pop();
  await expectCode(proof, absentAncestor, 'UNKNOWN_REGISTRY_RELEASE');
  const altered = clone(trust);
  const wrapper = JSON.parse(altered.registryReleases[0].rawJson);
  wrapper.release.registryRevision = 'tampered';
  altered.registryReleases[0].rawJson = JSON.stringify(wrapper);
  await expectCode(proof, altered, 'INVALID_INSIGHT_PROTOCOL_EVIDENCE');
  const differentFloor = clone(trust);
  unpinPolicy(differentFloor);
  differentFloor.consumerPolicy.registryReleaseIds = [differentId];
  await expectCode(proof, differentFloor, 'REGISTRY_RELEASE_NOT_ADMITTED_BY_POLICY');
});

test('candidate equal to floor is admitted only when its exact body is available', async () => {
  const { proof, trust } = await fixture();
  unpinPolicy(trust);
  const releaseId = JSON.parse(trust.registrySnapshot.rawJson).registryRelease.releaseId;
  trust.consumerPolicy.registryReleaseIds = [releaseId];
  assert.equal((await evaluateInsightProtocolTrust(proof, trust)).valid, true);
  trust.registryReleases = trust.registryReleases.filter((entry) => entry.releaseId !== releaseId);
  await expectCode(proof, trust, 'UNKNOWN_REGISTRY_RELEASE');
});

test('release must bind the known v5 profile and matching schema descriptor', async () => {
  const { proof, trust } = await fixture();
  for (const [mutate, code] of [
    [
      (body) => {
        body.schemaCatalog.ExecutionReceipt.profileId = differentId;
      },
      'RELEASE_PROFILE_MISMATCH',
    ],
    [
      (body) => {
        body.schemaCatalog.ExecutionReceipt.domain.chainId = 8453;
      },
      'RELEASE_SCHEMA_MISMATCH',
    ],
  ]) {
    const changed = clone(trust);
    const body = JSON.parse(changed.registryReleases[0].rawJson).release;
    mutate(body);
    const releaseId = contentId(body);
    changed.registryReleases[0] = { releaseId, rawJson: JSON.stringify(body) };
    changeSnapshot(changed, (raw) => {
      raw.registryRelease.releaseId = releaseId;
    });
    await expectCode(proof, changed, code);
  }
});

test('consumer schema/profile admission remains authoritative independently of signatures', async () => {
  const { proof, trust } = await fixture();
  const wrongSchema = clone(trust);
  unpinPolicy(wrongSchema);
  wrongSchema.consumerPolicy.allowedSchemaVersions = [4];
  await expectCode(proof, wrongSchema, 'SCHEMA_NOT_ADMITTED_BY_POLICY');
  const wrongProfile = clone(trust);
  unpinPolicy(wrongProfile);
  wrongProfile.consumerPolicy.allowedProfileIds = [differentId];
  await expectCode(proof, wrongProfile, 'PROFILE_NOT_ADMITTED_BY_POLICY');
});

test('immutable policy pins/hash/reachability cannot be relabelled by the caller', async () => {
  const { proof, trust } = await fixture();
  const wrongId = clone(trust);
  wrongId.consumerPolicy.policyId = differentId;
  await expectCode(proof, wrongId, 'POLICY_ID_MISMATCH');
  const wrongPins = clone(trust);
  wrongPins.consumerPolicy.registryReleaseIds = [differentId];
  await expectCode(proof, wrongPins, 'POLICY_PINS_MISMATCH');
  const missing = clone(trust);
  delete missing.consumerPolicy.policyRawJson;
  await expectCode(proof, missing, 'IMMUTABLE_POLICY_REQUIRED');
  const disabled = clone(trust);
  changePolicy(disabled, (body) => {
    body.productionReachability = 'disabled';
  });
  await expectCode(proof, disabled, 'POLICY_NOT_PRODUCTION_REACHABLE');
});

test('legacy result is relative to preserved bytes, never a signed-profile verdict', async () => {
  const { proof, trust } = await fixture({ version: 4 });
  const result = await evaluateInsightProtocolTrust(proof, trust);
  assert.equal(result.valid, true);
  assert.equal(result.scope, 'legacy-snapshot');
  assert.equal(result.code, 'LEGACY_SNAPSHOT_VERIFIED');
  assert.equal(result.profileId, null);
  assert.equal(result.registryReleaseId, null);
  await expectCode(proof, undefined, 'INSIGHT_PROTOCOL_TRUST_REQUIRED');
});

test('legacy snapshot cannot bypass an explicitly requested release floor', async () => {
  const { proof, trust } = await fixture({ version: 4 });
  unpinPolicy(trust);
  trust.consumerPolicy.registryReleaseIds = [differentId];
  await expectCode(proof, trust, 'REGISTRY_RELEASE_REQUIRED');
});

test('legacy with declared lineage must prove it and stays snapshot scoped', async () => {
  const { proof, trust } = await fixture({ version: 4, legacyWithoutRelease: false });
  const result = await evaluateInsightProtocolTrust(proof, trust);
  assert.equal(result.valid, true);
  assert.equal(result.scope, 'legacy-snapshot');
  trust.registryReleases = [];
  await expectCode(proof, trust, 'UNKNOWN_REGISTRY_RELEASE');
});

test('v5 registry semantic profile must agree with the signed profile', async () => {
  const { proof, trust } = await fixture();
  for (const mutate of [
    (raw) => {
      delete raw.schemas.ExecutionReceipt.semanticProfile;
    },
    (raw) => {
      raw.schemas.ExecutionReceipt.semanticProfile.profileId = differentId;
    },
  ]) {
    const changed = clone(trust);
    changeSnapshot(changed, mutate);
    await expectCode(proof, changed, 'REGISTRY_PROFILE_MISMATCH');
  }
});
