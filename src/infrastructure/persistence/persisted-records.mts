import { assertSafeJson } from '../../shared/safe-json.mjs';
import type { createMemoryStore } from './memory-store.mjs';
import type { ObservationJob } from '../../application/observations/observation-worker.mjs';

type Store = ReturnType<typeof createMemoryStore>;
type Intent = Parameters<Store['saveIntent']>[0];
type Observation = Parameters<Store['saveObservation']>[0];
type AuthorizationRecord = Parameters<Store['saveAuthorization']>[0];
type Receipt = Parameters<Store['saveReceipt']>[0] & { intentHash: string; execution: { txHash: string }; schema: string; issuer: string; keyId: string; outcome: string; signature?: string };
type ArchiveEntry = Parameters<Store['saveArchiveEntry']>[0];

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Invalid persisted ${label}`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value) throw new TypeError(`Invalid persisted ${label}`);
}

function integer(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`Invalid persisted ${label}`);
}

export function persistedJson(value: unknown, label: string): unknown {
  let parsed: unknown;
  try { parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value; }
  catch { throw new TypeError(`Invalid persisted ${label} JSON`); }
  return assertSafeJson(parsed, { maxDepth: 64 });
}

export function persistedIntent(value: unknown): Intent {
  const item = record(persistedJson(value, 'intent'), 'intent');
  for (const field of ['intentId', 'intentHash', 'schema', 'action', 'sender', 'recipient', 'asset', 'amount', 'nonce']) string(item[field], `intent.${field}`);
  if ((typeof item.chainId !== 'number' && typeof item.chainId !== 'string') || !Number.isSafeInteger(Number(item.chainId)) || Number(item.chainId) < 1) throw new TypeError('Invalid persisted intent.chainId');
  integer(item.validUntil, 'intent.validUntil');
  return item as Intent;
}

export function persistedObservation(value: unknown): Observation {
  const item = record(persistedWorkerObservation(value), 'observation');
  if ((typeof item.chainId !== 'number' && typeof item.chainId !== 'string') || !Number.isSafeInteger(Number(item.chainId)) || Number(item.chainId) < 1) throw new TypeError('Invalid persisted observation.chainId');
  return item as Observation;
}

export function persistedWorkerObservation(value: unknown): ObservationJob['observation'] {
  const item = record(persistedJson(value, 'observation'), 'observation');
  string(item.txHash, 'observation.txHash');
  string(item.status, 'observation.status');
  return item as ObservationJob['observation'];
}

export function persistedAuthorization(value: unknown): AuthorizationRecord['authorization'] {
  const item = record(persistedJson(value, 'authorization'), 'authorization');
  for (const field of ['authorizationId', 'intentHash', 'authorizationNonce']) string(item[field], `authorization.${field}`);
  persistedIntent(item.intent);
  const principal = record(item.principal, 'authorization.principal');
  string(principal.id, 'authorization.principal.id');
  string(principal.account, 'authorization.principal.account');
  const authorizer = record(item.authorizer, 'authorization.authorizer');
  string(authorizer.type, 'authorization.authorizer.type');
  string(authorizer.address, 'authorization.authorizer.address');
  const delegate = record(item.delegate, 'authorization.delegate');
  string(delegate.executor, 'authorization.delegate.executor');
  integer(item.expiresAt, 'authorization.expiresAt');
  if (!Number.isSafeInteger(Number(item.maxUses)) || Number(item.maxUses) < 1) throw new TypeError('Invalid persisted authorization.maxUses');
  return item as AuthorizationRecord['authorization'];
}

export function persistedAcceptance(value: unknown): AuthorizationRecord['acceptance'] {
  const item = record(persistedJson(value, 'acceptance'), 'acceptance');
  integer(item.sequence, 'acceptance.sequence');
  string(item.entryHash, 'acceptance.entryHash');
  return item as AuthorizationRecord['acceptance'];
}

export function persistedReceipt(value: unknown): Receipt {
  const item = record(persistedJson(value, 'receipt'), 'receipt');
  for (const field of ['receiptId', 'intentHash', 'schema', 'issuer', 'keyId', 'outcome']) string(item[field], `receipt.${field}`);
  const execution = record(item.execution, 'receipt.execution');
  string(execution.txHash, 'receipt.execution.txHash');
  return item as Receipt;
}

export function persistedArchiveEntry(value: unknown): ArchiveEntry {
  const item = record(persistedJson(value, 'archive entry'), 'archive entry');
  for (const field of ['id', 'projectId', 'environment', 'kind', 'artifactHash', 'status']) string(item[field], `archive entry.${field}`);
  integer(item.createdAt, 'archive entry.createdAt');
  return item as ArchiveEntry;
}

export function persistedJobInput(value: unknown): ObservationJob['input'] {
  const item = record(persistedJson(value, 'job input'), 'job input');
  if (item.chainId !== undefined && ((typeof item.chainId !== 'number' && typeof item.chainId !== 'string') || !Number.isSafeInteger(Number(item.chainId)) || Number(item.chainId) < 1)) throw new TypeError('Invalid persisted job input.chainId');
  string(item.txHash, 'job input.txHash');
  return item as ObservationJob['input'];
}

export function persistedJobResult(value: unknown): ObservationJob['result'] {
  if (value == null) return null;
  const item = record(persistedJson(value, 'job result'), 'job result');
  persistedWorkerObservation(item.observation);
  return item as ObservationJob['result'];
}

export function persistedJobError(value: unknown): ObservationJob['error'] {
  if (value == null) return null;
  const item = record(persistedJson(value, 'job error'), 'job error');
  string(item.code, 'job error.code');
  string(item.message, 'job error.message');
  return item as ObservationJob['error'];
}

export function persistedPolicy(value: unknown): AuthorizationRecord['policyEvidence'] | null {
  if (value == null) return null;
  const item = record(persistedJson(value, 'authorization policy'), 'authorization policy');
  if (item.schema === 'priorseal.policy-evidence.v1') {
    string(item.policyHash, 'authorization policy.policyHash');
    record(item.result, 'authorization policy.result');
  }
  return item as AuthorizationRecord['policyEvidence'];
}

export function persistedStatus(value: unknown, label: string): string {
  string(value, label);
  return value as string;
}

export function persistedCount(value: unknown, label: string): number {
  const number = Number(value);
  integer(number, label);
  return number;
}

export function persistedTimestamp(value: unknown, label: string): number {
  const milliseconds = value instanceof Date || typeof value === 'string' ? new Date(value).getTime() : Number(value);
  integer(milliseconds, label);
  return milliseconds;
}
