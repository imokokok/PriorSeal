import { keccak256, toBytes } from 'viem';
import {
  resolveKeyStatus,
  type KeyRegistry,
  type RoutableAttestation,
} from 'verify-insight-receipt';
import {
  EXECUTION_DOMAIN,
  EXECUTION_PRIMARY_TYPE,
  EXECUTION_PROFILE_V1_ID,
  executionTypesForSchemaVersion,
} from './insight-execution-v5.js';

/** Independently obtained input. A manifest must never grant trust to its own registry. */
export type InsightProtocolTrust = {
  schema: 'insight.protocol-trust.v1';
  registrySnapshot: { rawJson: string; sha256: string; byteLength: number };
  registryReleases: { releaseId: string; rawJson: string }[];
  executionProfiles: { profileId: string; rawJson: string }[];
  consumerPolicy: {
    allowedSchemaVersions: number[];
    allowedProfileIds: string[];
    /** Lineage floors, matching Insight's lineage-floor-any rule. */
    registryReleaseIds: string[];
    /** Optional immutable partner policy; when present, its actual pins must match. */
    policyId?: string;
    policyRawJson?: string;
  };
};

export type InsightProtocolResult = {
  valid: boolean;
  code: string;
  scope: 'signed-profile' | 'legacy-snapshot';
  profileId: string | null;
  registryReleaseId: string | null;
  policyId: string | null;
  registrySnapshotSha256: string | null;
  registrySnapshotByteLength: number | null;
  matchedReleaseFloor: string | null;
  required: string[];
};

type JsonObject = Record<string, unknown>;
const MAX_RAW_BYTES = 512 * 1024;
const hashId = /^0x[0-9a-fA-F]{64}$/;
const hexSha = /^[0-9a-fA-F]{64}$/;
const object = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Same JSON/JCS content addressing used by Insight's immutable release/profile objects. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  throw new TypeError('Not canonical JSON');
}

function readRaw(raw: unknown): JsonObject {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > MAX_RAW_BYTES)
    throw new TypeError('Invalid protocol JSON');
  const parsed: unknown = JSON.parse(raw);
  if (!object(parsed)) throw new TypeError('Protocol JSON must be an object');
  return parsed;
}

const idOf = (body: JsonObject) => keccak256(toBytes(canonical(body))).toLowerCase();
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const hashList = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.every((item) => typeof item === 'string' && hashId.test(item)) &&
  new Set(value.map((item) => item.toLowerCase())).size === value.length;
const sameIds = (left: unknown, right: string[]) =>
  hashList(left) &&
  same(left.map((id) => id.toLowerCase()).sort(), right.map((id) => id.toLowerCase()).sort());

function addressedObjects(
  entries: unknown,
  idKey: 'releaseId' | 'profileId',
  bodyKey: 'release' | 'profile',
) {
  if (!Array.isArray(entries) || entries.length > 64)
    throw new TypeError('Invalid addressed objects');
  const objects = new Map<string, JsonObject>();
  for (const entry of entries) {
    if (!object(entry) || typeof entry[idKey] !== 'string' || !hashId.test(entry[idKey]))
      throw new TypeError('Invalid object ID');
    const id = entry[idKey].toLowerCase();
    if (objects.has(id)) throw new TypeError('Ambiguous object ID');
    const parsed = readRaw(entry.rawJson);
    const body = object(parsed[bodyKey]) ? parsed[bodyKey] : parsed;
    if (
      parsed[bodyKey] !== undefined &&
      (!object(parsed[bodyKey]) ||
        (parsed[idKey] !== undefined && String(parsed[idKey]).toLowerCase() !== id))
    )
      throw new TypeError('Mismatched response wrapper');
    if (idOf(body) !== id) throw new TypeError('Content-addressed object hash mismatch');
    objects.set(id, body);
  }
  return objects;
}

function matchingSchemaEntry(snapshot: JsonObject, version: number): JsonObject | null {
  const catalog = object(snapshot.schemas)
    ? snapshot.schemas
    : object(snapshot.schemaCatalog)
      ? snapshot.schemaCatalog
      : null;
  if (!catalog) return null;
  const matches = Object.values(catalog).filter((value): value is JsonObject => {
    if (!object(value) || Number(value.schemaVersion) !== version) return false;
    const descriptor = object(value.eip712) ? value.eip712 : value;
    return descriptor.primaryType === EXECUTION_PRIMARY_TYPE;
  });
  if (matches.length !== 1) return null;
  return matches[0];
}

function matchingSchema(snapshot: JsonObject, version: number): JsonObject | null {
  const entry = matchingSchemaEntry(snapshot, version);
  return entry && object(entry.eip712) ? entry.eip712 : entry;
}

/** Verifies protocol interpretation/admission only; callers must also verify all signatures/pairs. */
export async function evaluateInsightProtocolTrust(
  proof: RoutableAttestation,
  trust?: InsightProtocolTrust,
): Promise<InsightProtocolResult> {
  const version = Number(proof?.data?.schemaVersion ?? proof?.schemaVersion);
  const result: InsightProtocolResult = {
    valid: false,
    code: 'INSIGHT_PROTOCOL_TRUST_REQUIRED',
    scope: version >= 5 ? 'signed-profile' : 'legacy-snapshot',
    profileId:
      typeof proof?.data?.profileId === 'string' ? proof.data.profileId.toLowerCase() : null,
    registryReleaseId: null,
    policyId: trust?.consumerPolicy?.policyId ?? null,
    registrySnapshotSha256: null,
    registrySnapshotByteLength: null,
    matchedReleaseFloor: null,
    required: [],
  };
  const fail = (code: string, requirement?: string) => ({
    ...result,
    code,
    required: requirement ? [requirement] : [],
  });
  if (!trust) return fail('INSIGHT_PROTOCOL_TRUST_REQUIRED', 'independent Insight protocol trust');
  try {
    if (trust.schema !== 'insight.protocol-trust.v1' || ![1, 2, 3, 4, 5].includes(version))
      return fail('UNSUPPORTED_INSIGHT_PROTOCOL');
    const snapshot = trust.registrySnapshot;
    if (
      !snapshot ||
      !hexSha.test(snapshot.sha256) ||
      !Number.isSafeInteger(snapshot.byteLength) ||
      snapshot.byteLength < 1
    )
      return fail(
        'REGISTRY_SNAPSHOT_REQUIRED',
        'exact receipt-adjacent registry bytes, SHA-256 and byte length',
      );
    const raw = readRaw(snapshot.rawJson);
    const bytes = new TextEncoder().encode(snapshot.rawJson);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    result.registrySnapshotSha256 = digest;
    result.registrySnapshotByteLength = bytes.length;
    if (digest !== snapshot.sha256.toLowerCase() || bytes.length !== snapshot.byteLength)
      return fail('REGISTRY_SNAPSHOT_MISMATCH');
    const policy = trust.consumerPolicy;
    if (
      !policy ||
      !Array.isArray(policy.allowedSchemaVersions) ||
      !policy.allowedSchemaVersions.length ||
      policy.allowedSchemaVersions.some((v) => !Number.isSafeInteger(v) || v < 1 || v > 5) ||
      !hashList(policy.allowedProfileIds) ||
      !hashList(policy.registryReleaseIds)
    )
      return fail('INVALID_CONSUMER_POLICY');
    if (!policy.allowedSchemaVersions.includes(version))
      return fail('SCHEMA_NOT_ADMITTED_BY_POLICY');
    if (Boolean(policy.policyId) !== Boolean(policy.policyRawJson))
      return fail('IMMUTABLE_POLICY_REQUIRED');
    if (policy.policyId && policy.policyRawJson) {
      if (!hashId.test(policy.policyId)) return fail('INVALID_POLICY_ID');
      const parsed = readRaw(policy.policyRawJson);
      const p = object(parsed.policy) ? parsed.policy : parsed;
      const { policyId, ...body } = p;
      if (
        idOf(body) !== policy.policyId.toLowerCase() ||
        (policyId !== undefined && String(policyId).toLowerCase() !== policy.policyId.toLowerCase())
      )
        return fail('POLICY_ID_MISMATCH');
      if (
        body.kind !== 'MainlinePartnerPolicy' ||
        !Array.isArray(body.surfaces) ||
        !body.surfaces.includes('execution-receipt') ||
        !object(body.pins)
      )
        return fail('POLICY_DOES_NOT_ADMIT_EXECUTION');
      if (
        !sameIds(body.pins.executionProfileIds, policy.allowedProfileIds) ||
        !sameIds(body.pins.oracleRegistryReleaseIds, policy.registryReleaseIds) ||
        !Array.isArray(body.pins.executionSchemaVersions) ||
        !same(
          [...body.pins.executionSchemaVersions].sort(),
          [...policy.allowedSchemaVersions].sort(),
        )
      )
        return fail('POLICY_PINS_MISMATCH');
      if (version === 5 && body.productionReachability !== 'enabled')
        return fail('POLICY_NOT_PRODUCTION_REACHABLE');
    }
    const descriptor = matchingSchema(raw, version);
    if (
      !descriptor ||
      !same(descriptor.domain, EXECUTION_DOMAIN) ||
      !same(descriptor.types, executionTypesForSchemaVersion(version)) ||
      descriptor.primaryType !== EXECUTION_PRIMARY_TYPE
    )
      return fail('REGISTRY_SCHEMA_MISMATCH');
    const keys = (raw.public_keys ?? raw.keys) as KeyRegistry['public_keys'];
    if (
      !Array.isArray(keys) ||
      (raw.public_keys !== undefined && raw.keys !== undefined) ||
      (raw.revoked_keys !== undefined && raw.revoked !== undefined)
    )
      return fail('REGISTRY_PRODUCTION_SIGNER_REQUIRED');
    const addresses = new Set<string>();
    const keyIds = new Set<string>();
    for (const entry of keys) {
      if (
        !entry ||
        typeof entry.public_key !== 'string' ||
        !/^0x[0-9a-fA-F]{40}$/.test(entry.public_key) ||
        typeof entry.key_id !== 'string' ||
        !entry.key_id ||
        (entry.role !== undefined && !['attester', 'sample'].includes(entry.role)) ||
        addresses.has(entry.public_key.toLowerCase()) ||
        keyIds.has(entry.key_id)
      )
        return fail('REGISTRY_PRODUCTION_SIGNER_REQUIRED');
      addresses.add(entry.public_key.toLowerCase());
      keyIds.add(entry.key_id);
    }
    const matches = keys.filter(
      (key) =>
        key &&
        typeof key.public_key === 'string' &&
        key.public_key.toLowerCase() === proof.attester?.toLowerCase(),
    );
    const key = matches[0];
    // Insight's published registry defines omitted role as the legacy attester default.
    if (
      matches.length !== 1 ||
      (key.role !== undefined && key.role !== 'attester') ||
      typeof key.revoked !== 'boolean' ||
      !Number.isFinite(Date.parse(key.validFrom)) ||
      (key.validUntil !== null && !Number.isFinite(Date.parse(key.validUntil))) ||
      (key.validUntil !== null && Date.parse(key.validUntil) < Date.parse(key.validFrom))
    )
      return fail('REGISTRY_PRODUCTION_SIGNER_REQUIRED');
    const executedAt = Number(proof.data.executedAt);
    if (
      !Number.isSafeInteger(executedAt) ||
      executedAt < 0 ||
      resolveKeyStatus(proof.attester, executedAt, raw as unknown as KeyRegistry) !== 'valid'
    )
      return fail('REGISTRY_SIGNER_UNTRUSTED');
    if (version >= 4 && proof.data.environment !== 'production')
      return fail('NONPRODUCTION_EXECUTION');
    const registryRelease = object(raw.registryRelease) ? raw.registryRelease : null;
    result.registryReleaseId =
      typeof registryRelease?.releaseId === 'string'
        ? registryRelease.releaseId.toLowerCase()
        : null;
    // Historical documents before content-addressed releases remain bound to exact pinned bytes.
    if (version < 5 && !result.registryReleaseId && !policy.registryReleaseIds.length)
      return { ...result, valid: true, code: 'LEGACY_SNAPSHOT_VERIFIED' };
    if (!result.registryReleaseId || !hashId.test(result.registryReleaseId))
      return fail('REGISTRY_RELEASE_REQUIRED', 'immutable registry release and lineage');
    if (!policy.registryReleaseIds.length) return fail('REGISTRY_RELEASE_FLOOR_REQUIRED');
    const releases = addressedObjects(trust.registryReleases, 'releaseId', 'release');
    let cursor = result.registryReleaseId;
    const seen = new Set<string>();
    while (true) {
      if (seen.has(cursor)) return fail('REGISTRY_RELEASE_LINEAGE_CYCLE');
      seen.add(cursor);
      const release = releases.get(cursor);
      if (!release || release.kind !== 'OracleRegistryProtocolRelease')
        return fail('UNKNOWN_REGISTRY_RELEASE');
      if (policy.registryReleaseIds.some((id) => id.toLowerCase() === cursor)) {
        result.matchedReleaseFloor = cursor;
        break;
      }
      if (
        typeof release.predecessorReleaseId !== 'string' ||
        !hashId.test(release.predecessorReleaseId)
      )
        return fail('REGISTRY_RELEASE_NOT_ADMITTED_BY_POLICY');
      cursor = release.predecessorReleaseId.toLowerCase();
    }
    if (version === 5) {
      if (!result.profileId || result.profileId !== EXECUTION_PROFILE_V1_ID.toLowerCase())
        return fail('UNSUPPORTED_SIGNED_PROFILE');
      if (!policy.allowedProfileIds.some((id) => id.toLowerCase() === result.profileId))
        return fail('PROFILE_NOT_ADMITTED_BY_POLICY');
      const snapshotSchema = matchingSchemaEntry(raw, version);
      if (
        !snapshotSchema ||
        !object(snapshotSchema.semanticProfile) ||
        snapshotSchema.semanticProfile.profileId !== result.profileId
      )
        return fail('REGISTRY_PROFILE_MISMATCH');
      const profiles = addressedObjects(trust.executionProfiles, 'profileId', 'profile');
      const profile = profiles.get(result.profileId);
      if (!profile || profile.kind !== 'ExecutionReceiptSemanticProfile')
        return fail('IMMUTABLE_PROFILE_REQUIRED');
      const release = releases.get(result.registryReleaseId)!;
      if (
        !object(release.schemaCatalog) ||
        !object(release.schemaCatalog.ExecutionReceipt) ||
        release.schemaCatalog.ExecutionReceipt.profileId !== result.profileId
      )
        return fail('RELEASE_PROFILE_MISMATCH');
      const releaseDescriptor = matchingSchema(release, 5);
      if (
        !releaseDescriptor ||
        !same(releaseDescriptor.domain, EXECUTION_DOMAIN) ||
        !same(releaseDescriptor.types, executionTypesForSchemaVersion(5))
      )
        return fail('RELEASE_SCHEMA_MISMATCH');
    }
    return {
      ...result,
      valid: true,
      code: version === 5 ? 'SIGNED_PROFILE_VERIFIED' : 'LEGACY_SNAPSHOT_VERIFIED',
    };
  } catch {
    return fail('INVALID_INSIGHT_PROTOCOL_EVIDENCE');
  }
}
