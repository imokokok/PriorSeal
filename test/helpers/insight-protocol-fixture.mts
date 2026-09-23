import { createHash } from 'node:crypto';
import { hashTypedData, keccak256, toBytes } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import {
  EXECUTION_DOMAIN,
  EXECUTION_PRIMARY_TYPE,
  EXECUTION_PROFILE_V1_ID,
  executionTypesForSchemaVersion,
} from '../../sdk/dist/insight-execution-v5.js';

// Exact immutable Insight profile, MIT; source 76a22ac242512c06cd0e21e3fcd4452867b52e57.
// Copyright (c) 2026 Insight (oracleinsight.xyz). SDK THIRD_PARTY_NOTICES includes full permission.
export const profileBody = {
  kind: 'ExecutionReceiptSemanticProfile',
  profileVersion: 1,
  receipt: {
    primaryType: 'ExecutionReceipt',
    profileIdSignedInSchemaVersions: [5],
    legacyImplicitSchemaVersions: [3, 4],
  },
  commitments: {
    preTradeUidsHash: {
      algorithm: 'keccak256',
      inclusion: 'omit entries equal to zero bytes32',
      ordering: 'route order, source first',
      encoding: 'concatenate each retained uid as 32 raw bytes without separators',
      emptyInput: 'keccak256 of empty bytes',
    },
    measuredFieldsHash: {
      algorithm: 'keccak256',
      universe: ['actualFeeUsd', 'executedAmountUsd', 'mevRiskBps', 'quotedAmountUsd'],
      normalization: 'deduplicate, sort lexicographically, then join with comma',
      encoding: 'UTF-8 bytes of the normalized string',
      emptyInput: 'keccak256 of empty bytes',
    },
    reasonCodesHash: {
      algorithm: 'keccak256',
      normalization: 'deduplicate and sort lexicographically',
      encoding: 'ABI encode the sorted values as string[]',
      emptyInput: 'keccak256 of ABI-encoded empty string[]',
    },
  },
  sentinels: {
    destinationPreTradeUid: {
      value: `0x${'0'.repeat(64)}`,
      meaning: 'no destination pre-trade gate; omitted from preTradeUidsHash',
    },
    attestationAgeAtExecSeconds: {
      value: 4294967295,
      meaning: 'paired pre-trade attestation did not exist at execution time',
    },
  },
  scales: {
    quotedPrice: 8,
    executedPrice: 8,
    quotedAmountUsd: 6,
    executedAmountUsd: 6,
    actualFeeUsd: 6,
    priceDeltaBps: 4,
    maxSlippageBps: 0,
    mevRiskBps: 4,
  },
  enumerations: {
    environment: ['production', 'nonproduction'],
    bindingMode: ['VERIFIED', 'SELF_REPORTED'],
    fillStatus: ['FULL', 'PARTIAL', 'REVERTED', 'FAILED'],
    priceExecutionStatus: ['FAITHFUL', 'DEVIATED', 'NOT_EXECUTED', 'UNDETERMINED'],
  },
  verdictRules: [
    'NOT_EXECUTED when fillStatus is REVERTED or FAILED',
    'UNDETERMINED when quotedPrice or executedPrice is not positive',
    'DEVIATED when slippageSatisfied is false',
    'DEVIATED when independenceSatisfied is false',
    'DEVIATED when fillStatus is PARTIAL',
    'UNDETERMINED when preTradeSignedAt is absent, non-positive, or after executedAt',
    'UNDETERMINED when executedAt is after a supplied preTradeValidUntil',
    'UNDETERMINED when bindingMode is not VERIFIED',
    'FAITHFUL otherwise',
  ],
};
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const contentId = (body: unknown) => keccak256(toBytes(canonicalJson(body)));
export function snapshotPin(snapshot: unknown) {
  const rawJson = typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot);
  return {
    rawJson,
    sha256: createHash('sha256').update(rawJson, 'utf8').digest('hex'),
    byteLength: Buffer.byteLength(rawJson, 'utf8'),
  };
}

/** Pure test fixtures. The caller provides its own ephemeral signer; no network or account is used. */
type TrustOptions = { signer: string | { address: string }; version?: number; legacyWithoutRelease?: boolean; withPolicy?: boolean };
type ConsumerPolicy = { allowedSchemaVersions: number[]; allowedProfileIds: string[]; registryReleaseIds: string[]; policyId?: string; policyRawJson?: string };

export function createInsightProtocolTrust({
  signer,
  version = 5,
  legacyWithoutRelease = version < 5,
  withPolicy = true,
}: TrustOptions) {
  const address = typeof signer === 'string' ? signer : signer.address;
  if (contentId(profileBody) !== EXECUTION_PROFILE_V1_ID)
    throw new Error('Immutable Insight profile mismatch');
  const descriptor = {
    schemaVersion: version,
    domain: EXECUTION_DOMAIN,
    types: executionTypesForSchemaVersion(version),
    primaryType: EXECUTION_PRIMARY_TYPE,
    ...(version === 5 ? { profileId: EXECUTION_PROFILE_V1_ID } : {}),
  };
  const floor = {
    kind: 'OracleRegistryProtocolRelease',
    registryRevision: 'fixture-floor',
    schemaCatalog: { ExecutionReceipt: descriptor },
  };
  const floorId = contentId(floor);
  const release = { ...floor, registryRevision: 'fixture-current', predecessorReleaseId: floorId };
  const releaseId = contentId(release);
  const key = {
    key_id: 'fixture-insight-key',
    public_key: address,
    validFrom: new Date(0).toISOString(),
    validUntil: null,
    revoked: false,
    role: 'attester',
  };
  const snapshot = {
    public_keys: [key],
    revoked_keys: [],
    schemas: {
      ExecutionReceipt: {
        schemaVersion: version,
        eip712: {
          domain: EXECUTION_DOMAIN,
          types: descriptor.types,
          primaryType: EXECUTION_PRIMARY_TYPE,
        },
        ...(version === 5 ? { semanticProfile: { profileId: EXECUTION_PROFILE_V1_ID } } : {}),
      },
    },
    ...(legacyWithoutRelease ? {} : { registryRelease: { releaseId } }),
  };
  const consumerPolicy: ConsumerPolicy = {
    allowedSchemaVersions: [version],
    allowedProfileIds: version === 5 ? [EXECUTION_PROFILE_V1_ID] : [],
    registryReleaseIds: legacyWithoutRelease ? [] : [floorId],
  };
  if (withPolicy) {
    const policyBody = {
      kind: 'MainlinePartnerPolicy',
      policyVersion: 1,
      partnerId: 'local-test-fixture',
      lifecycle: 'promoted',
      activation: 'explicit-policy-id',
      surfaces: ['execution-receipt'],
      pins: {
        executionSchemaVersions: consumerPolicy.allowedSchemaVersions,
        executionProfileIds: consumerPolicy.allowedProfileIds,
        oracleRegistryReleaseIds: consumerPolicy.registryReleaseIds,
      },
      productionReachability: version === 5 ? 'enabled' : 'disabled',
    };
    consumerPolicy.policyId = contentId(policyBody);
    consumerPolicy.policyRawJson = JSON.stringify({
      policyId: consumerPolicy.policyId,
      ...policyBody,
    });
  }
  return {
    schema: 'insight.protocol-trust.v1',
    registrySnapshot: snapshotPin(snapshot),
    registryReleases: legacyWithoutRelease
      ? []
      : [
          { releaseId, rawJson: JSON.stringify({ releaseId, release }) },
          { releaseId: floorId, rawJson: JSON.stringify(floor) },
        ],
    executionProfiles: [
      {
        profileId: EXECUTION_PROFILE_V1_ID,
        rawJson: JSON.stringify({ profileId: EXECUTION_PROFILE_V1_ID, profile: profileBody }),
      },
    ],
    consumerPolicy,
  };
}

export async function createSignedExecution({ signer, version = 5, overrides = {} }: { signer: PrivateKeyAccount; version?: number; overrides?: Record<string, unknown> }) {
  const types = executionTypesForSchemaVersion(version);
  if (!types) throw new TypeError('Unsupported execution schema version');
  const data = Object.fromEntries(
    types[EXECUTION_PRIMARY_TYPE].map(({ name, type }) => [
      name,
      type === 'bool'
        ? false
        : type === 'address'
          ? signer.address
          : type === 'bytes32'
            ? `0x${'0'.repeat(64)}`
            : type.startsWith('uint') || type.startsWith('int')
              ? 0
              : '',
    ]),
  );
  Object.assign(data, {
    schemaVersion: version,
    executedAt: 1100,
    validUntil: 2000,
    environment: 'production',
    bindingMode: 'VERIFIED',
    fillStatus: 'FULL',
    priceExecutionStatus: 'FAITHFUL',
    executionStatus: 'FAITHFUL',
    ...(version === 5 ? { profileId: EXECUTION_PROFILE_V1_ID } : {}),
    ...overrides,
  });
  const message = Object.fromEntries(
    types[EXECUTION_PRIMARY_TYPE].map(({ name, type }) => [
      name,
      type.startsWith('uint') || type.startsWith('int') ? BigInt(data[name]) : data[name],
    ]),
  );
  const typed = { domain: EXECUTION_DOMAIN, types, primaryType: EXECUTION_PRIMARY_TYPE, message } as Parameters<typeof hashTypedData>[0];
  return {
    uid: hashTypedData(typed),
    schemaVersion: version,
    data,
    attester: signer.address,
    signature: await signer.signTypedData(typed),
  };
}
