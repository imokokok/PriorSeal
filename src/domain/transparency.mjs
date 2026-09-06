import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalize, hashJson } from './hashing.mjs';

export const TRANSPARENCY_CHECKPOINT_SCHEMA = 'runproof.transparency-checkpoint.v1';

export function buildTransparencyEvidence({ entries, acceptance, issuer, keyId, privateKeyPem, issuedAt, anchor = null }) {
  const acceptedIndex = entries.findIndex((entry) => entry.sequence === acceptance.sequence && entry.entryHash === acceptance.entryHash);
  if (acceptedIndex < 0) throw new TypeError('Authorization acceptance is not present in the transparency log');
  let checkpointEntries = entries;
  let verifiedAnchor = null;
  if (anchor) {
    const anchorEntry = entries[Number(anchor.size) - 1];
    if (!anchorEntry || anchorEntry.entryHash !== anchor.headEntryHash) throw new TypeError('Configured transparency anchor does not match the local log');
    if (Number(anchor.size) > acceptedIndex) {
      checkpointEntries = entries.slice(0, Number(anchor.size));
      verifiedAnchor = anchor;
    }
  }
  const checkpoint = { schema: TRANSPARENCY_CHECKPOINT_SCHEMA, domain: 'runproof/transparency-checkpoint/v1', size: checkpointEntries.length, headEntryHash: checkpointEntries.at(-1)?.entryHash ?? null, issuedAt, issuer, algorithm: 'Ed25519', keyId, anchor: verifiedAnchor };
  const signedCheckpoint = privateKeyPem ? { ...checkpoint, signature: sign(null, Buffer.from(canonicalize(checkpoint)), createPrivateKey(privateKeyPem)).toString('base64url') } : checkpoint;
  return { checkpoint: signedCheckpoint, chain: checkpointEntries.slice(acceptedIndex) };
}

export function verifyTransparencyEvidence(evidence, acceptance, publicKeyPem) {
  const checkpoint = evidence?.checkpoint;
  const chain = evidence?.chain;
  if (!checkpoint?.signature || checkpoint.schema !== TRANSPARENCY_CHECKPOINT_SCHEMA || !Array.isArray(chain) || !chain.length) return false;
  if (chain[0].sequence !== acceptance.sequence || chain[0].entryHash !== acceptance.entryHash) return false;
  for (let index = 0; index < chain.length; index += 1) {
    const entry = chain[index];
    if (entry.entryHash !== hashJson({ sequence: entry.sequence, authorizationHash: entry.authorizationHash, acceptedAt: entry.acceptedAt, previousEntryHash: entry.previousEntryHash })) return false;
    if (index > 0 && (entry.sequence !== chain[index - 1].sequence + 1 || entry.previousEntryHash !== chain[index - 1].entryHash)) return false;
  }
  if (chain.at(-1).entryHash !== checkpoint.headEntryHash || chain.at(-1).sequence !== checkpoint.size) return false;
  if (checkpoint.anchor && (checkpoint.anchor.size !== checkpoint.size || checkpoint.anchor.headEntryHash !== checkpoint.headEntryHash)) return false;
  const { signature, ...unsigned } = checkpoint;
  try { return verify(null, Buffer.from(canonicalize(unsigned)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64url')); } catch { return false; }
}
