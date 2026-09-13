import { hashJson } from './hashing.mjs';
import { PriorSealError } from './errors.mjs';
import { signEd25519Statement, verifyEd25519Statement } from './ed25519.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';

export const TRANSPARENCY_CHECKPOINT_SCHEMA = 'priorseal.transparency-checkpoint.v1';

export function buildTransparencyEvidence({ entries, acceptance, issuer, keyId, privateKeyPem, issuedAt, anchor = null, before }) {
  const acceptedIndex = entries.findIndex((entry) => entry.sequence === acceptance.sequence && entry.entryHash === acceptance.entryHash);
  if (acceptedIndex < 0) throw new TypeError('Authorization acceptance is not present in the transparency log');
  let checkpointEntries = entries;
  let verifiedAnchor = null;
  if (anchor) {
    if (before !== undefined && anchor.anchoredAt > before) throw new PriorSealError('TRANSPARENCY_AFTER_EXECUTION', 'Transparency anchor must precede execution');
    const anchorEntry = entries[Number(anchor.size) - 1];
    if (!anchorEntry || anchorEntry.entryHash !== anchor.headEntryHash) throw new TypeError('Configured transparency anchor does not match the local log');
    if (Number(anchor.size) > acceptedIndex) {
      checkpointEntries = entries.slice(0, Number(anchor.size));
      verifiedAnchor = anchor;
    }
  }
  const checkpoint = { schema: TRANSPARENCY_CHECKPOINT_SCHEMA, domain: 'priorseal/transparency-checkpoint/v1', size: checkpointEntries.length, headEntryHash: checkpointEntries.at(-1)?.entryHash ?? null, issuedAt, issuer, algorithm: 'Ed25519', keyId, anchor: verifiedAnchor };
  const signedCheckpoint = privateKeyPem ? signEd25519Statement(checkpoint, privateKeyPem) : checkpoint;
  return { checkpoint: signedCheckpoint, chain: checkpointEntries.slice(acceptedIndex) };
}

export function verifyTransparencyEvidence(evidence, acceptance, publicKeyPem, { before } = {}) {
  const checkpoint = evidence?.checkpoint;
  const chain = evidence?.chain;
  try {
    assertSafeJson(evidence);
    assertOnlyFields(evidence, ['checkpoint', 'chain'], 'transparency evidence');
    assertOnlyFields(checkpoint, ['schema', 'domain', 'size', 'headEntryHash', 'issuedAt', 'issuer', 'algorithm', 'keyId', 'anchor', 'signature'], 'transparency checkpoint');
    for (const entry of chain ?? []) assertOnlyFields(entry, ['sequence', 'authorizationHash', 'acceptedAt', 'previousEntryHash', 'entryHash'], 'transparency entry');
    if (checkpoint?.anchor) assertOnlyFields(checkpoint.anchor, ['type', 'chainId', 'contract', 'txHash', 'blockNumber', 'anchoredAt', 'size', 'headEntryHash'], 'transparency anchor');
  } catch { return false; }
  if (!checkpoint?.signature || checkpoint.schema !== TRANSPARENCY_CHECKPOINT_SCHEMA || checkpoint.domain !== 'priorseal/transparency-checkpoint/v1' || checkpoint.algorithm !== 'Ed25519' || checkpoint.issuer !== acceptance.issuer || checkpoint.keyId !== acceptance.keyId || !Number.isSafeInteger(checkpoint.issuedAt) || checkpoint.issuedAt < acceptance.acceptedAt || !Number.isSafeInteger(checkpoint.size) || checkpoint.size < 1 || !/^[0-9a-f]{64}$/.test(checkpoint.headEntryHash) || !Array.isArray(chain) || !chain.length) return false;
  if (chain[0].sequence !== acceptance.sequence || chain[0].entryHash !== acceptance.entryHash) return false;
  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index];
    if (!Number.isSafeInteger(entry.sequence) || entry.sequence < 1 || !Number.isSafeInteger(entry.acceptedAt) || entry.acceptedAt < 1 || !/^[0-9a-f]{64}$/.test(entry.authorizationHash) || !/^[0-9a-f]{64}$/.test(entry.entryHash) || (entry.previousEntryHash !== null && !/^[0-9a-f]{64}$/.test(entry.previousEntryHash))) return false;
    if (entry.entryHash !== hashJson({ sequence: entry.sequence, authorizationHash: entry.authorizationHash, acceptedAt: entry.acceptedAt, previousEntryHash: entry.previousEntryHash })) return false;
    if (index > 0 && (entry.sequence !== chain[index - 1].sequence + 1 || entry.previousEntryHash !== chain[index - 1].entryHash)) return false;
  }
  if (chain.at(-1).entryHash !== checkpoint.headEntryHash || chain.at(-1).sequence !== checkpoint.size) return false;
  if (checkpoint.anchor && (!validAnchor(checkpoint.anchor) || checkpoint.anchor.size !== checkpoint.size || checkpoint.anchor.headEntryHash !== checkpoint.headEntryHash || (before !== undefined && checkpoint.anchor.anchoredAt > before))) return false;
  return verifyEd25519Statement(checkpoint, publicKeyPem);
}

function validAnchor(anchor) {
  return anchor.type === 'eip155'
    && Number.isSafeInteger(anchor.chainId) && anchor.chainId > 0
    && /^0x[0-9a-f]{40}$/.test(anchor.contract)
    && /^0x[0-9a-f]{64}$/.test(anchor.txHash)
    && Number.isSafeInteger(anchor.blockNumber) && anchor.blockNumber >= 0
    && Number.isSafeInteger(anchor.anchoredAt) && anchor.anchoredAt >= 0
    && Number.isSafeInteger(anchor.size) && anchor.size > 0
    && /^[0-9a-f]{64}$/.test(anchor.headEntryHash);
}
