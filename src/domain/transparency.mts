import { hashJson } from './hashing.mjs';
import { PriorSealError } from './errors.mjs';
import { signEd25519Statement, verifyEd25519Statement } from './ed25519.mjs';
import { assertOnlyFields, assertSafeJson } from '../shared/safe-json.mjs';
import { verifyMerkleProof, type MerkleProofStep } from './merkle-log.mjs';

export const TRANSPARENCY_CHECKPOINT_SCHEMA = 'priorseal.transparency-checkpoint.v1';
export const MERKLE_TRANSPARENCY_CHECKPOINT_SCHEMA = 'priorseal.transparency-checkpoint.v2';

type Acceptance = { sequence: number; entryHash: string };
type VerifiedAcceptance = Acceptance & { authorizationHash?: string; acceptedAt: number; previousEntryHash?: string | null; issuer: string; keyId: string };
type TransparencyEntry = { sequence: number; authorizationHash: string; acceptedAt: number; previousEntryHash: string | null; entryHash: string };
type Anchor = { type: string; chainId: number; contract: string; txHash: string; blockNumber: number; anchoredAt: number; size: number; headEntryHash?: string | null; merkleRoot?: string | null };
type Checkpoint = Record<string, unknown> & { schema: string; domain: string; size: number; headEntryHash: string; merkleRoot?: string; issuedAt: number; issuer: string; algorithm: string; keyId: string; signature?: string; anchor?: Anchor | null };
type TransparencyEvidence = { checkpoint?: Checkpoint | null; chain?: TransparencyEntry[]; proof?: unknown };
type VerifyOptions = { before?: number };

export function buildMerkleTransparencyEvidence({ acceptance, snapshot, issuer, keyId, privateKeyPem, issuedAt, anchor = null, before }: { acceptance: Acceptance; snapshot: { size: number; headEntryHash: string; merkleRoot: string; proof: MerkleProofStep[] } | null; issuer: string; keyId: string; privateKeyPem: string; issuedAt: number; anchor?: Anchor | null; before?: number }) {
  if (!snapshot || snapshot.size < acceptance.sequence || !privateKeyPem) throw new TypeError('Authorization Merkle proof is unavailable');
  if (anchor) {
    if (!anchor.merkleRoot || anchor.size !== snapshot.size || anchor.merkleRoot !== snapshot.merkleRoot || anchor.headEntryHash !== snapshot.headEntryHash || (before !== undefined && anchor.anchoredAt > before)) throw new PriorSealError('TRANSPARENCY_AFTER_EXECUTION', 'Verified Merkle anchor must cover the authorization before execution');
  }
  const checkpoint = { schema: MERKLE_TRANSPARENCY_CHECKPOINT_SCHEMA, domain: 'priorseal/transparency-checkpoint/v2', size: snapshot.size, headEntryHash: snapshot.headEntryHash, merkleRoot: snapshot.merkleRoot, issuedAt, issuer, algorithm: 'Ed25519', keyId, anchor };
  return { checkpoint: signEd25519Statement(checkpoint, privateKeyPem), proof: snapshot.proof };
}

export function buildTransparencyEvidence({ entries, acceptance, issuer, keyId, privateKeyPem, issuedAt, anchor = null, before }: { entries: TransparencyEntry[]; acceptance: Acceptance; issuer: string; keyId: string; privateKeyPem?: string | null; issuedAt: number; anchor?: Anchor | null; before?: number }) {
  if (anchor?.merkleRoot) throw new TypeError('A Merkle root anchor requires a v2 transparency checkpoint');
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

export function verifyTransparencyEvidence(evidence: unknown, acceptance: VerifiedAcceptance, publicKeyPem: string, { before }: VerifyOptions = {}): boolean {
  const candidate = evidence as TransparencyEvidence | null | undefined;
  if (candidate?.checkpoint?.schema === MERKLE_TRANSPARENCY_CHECKPOINT_SCHEMA) return verifyMerkleTransparencyEvidence(evidence, acceptance, publicKeyPem, { before });
  const checkpoint = candidate?.checkpoint;
  const chain = candidate?.chain;
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
  if (chain.at(-1)?.entryHash !== checkpoint.headEntryHash || chain.at(-1)?.sequence !== checkpoint.size) return false;
  if (checkpoint.anchor && (!validAnchor(checkpoint.anchor) || checkpoint.anchor.merkleRoot || checkpoint.anchor.size !== checkpoint.size || checkpoint.anchor.headEntryHash !== checkpoint.headEntryHash || (before !== undefined && checkpoint.anchor.anchoredAt > before))) return false;
  return verifyEd25519Statement(checkpoint, publicKeyPem);
}

function verifyMerkleTransparencyEvidence(evidence: unknown, acceptance: VerifiedAcceptance, publicKeyPem: string, { before }: VerifyOptions): boolean {
  const candidate = evidence as TransparencyEvidence | null | undefined;
  const checkpoint = candidate?.checkpoint;
  try {
    assertSafeJson(evidence);
    assertOnlyFields(evidence, ['checkpoint', 'proof'], 'transparency evidence');
    assertOnlyFields(checkpoint, ['schema', 'domain', 'size', 'headEntryHash', 'merkleRoot', 'issuedAt', 'issuer', 'algorithm', 'keyId', 'anchor', 'signature'], 'transparency checkpoint');
    if (checkpoint?.anchor) assertOnlyFields(checkpoint.anchor, ['type', 'chainId', 'contract', 'txHash', 'blockNumber', 'anchoredAt', 'size', 'headEntryHash', 'merkleRoot'], 'transparency anchor');
  } catch { return false; }
  if (!checkpoint?.signature || checkpoint.domain !== 'priorseal/transparency-checkpoint/v2' || checkpoint.algorithm !== 'Ed25519' || checkpoint.issuer !== acceptance.issuer || checkpoint.keyId !== acceptance.keyId || !Number.isSafeInteger(checkpoint.issuedAt) || checkpoint.issuedAt < acceptance.acceptedAt || !Number.isSafeInteger(checkpoint.size) || checkpoint.size < acceptance.sequence || !/^[0-9a-f]{64}$/.test(checkpoint.headEntryHash ?? '') || !/^[0-9a-f]{64}$/.test(checkpoint.merkleRoot ?? '')) return false;
  if (acceptance.entryHash !== hashJson({ sequence: acceptance.sequence, authorizationHash: acceptance.authorizationHash, acceptedAt: acceptance.acceptedAt, previousEntryHash: acceptance.previousEntryHash })) return false;
  if (!verifyMerkleProof(acceptance.entryHash, acceptance.sequence, checkpoint.size, candidate?.proof, checkpoint.merkleRoot ?? '')) return false;
  if (checkpoint.anchor && (!validAnchor(checkpoint.anchor) || !checkpoint.anchor.merkleRoot || checkpoint.anchor.merkleRoot !== checkpoint.merkleRoot || checkpoint.anchor.headEntryHash !== checkpoint.headEntryHash || checkpoint.anchor.size !== checkpoint.size || (before !== undefined && checkpoint.anchor.anchoredAt > before))) return false;
  return verifyEd25519Statement(checkpoint, publicKeyPem);
}

function validAnchor(anchor: Anchor): boolean {
  return anchor.type === 'eip155'
    && Number.isSafeInteger(anchor.chainId) && anchor.chainId > 0
    && /^0x[0-9a-f]{40}$/.test(anchor.contract)
    && /^0x[0-9a-f]{64}$/.test(anchor.txHash)
    && Number.isSafeInteger(anchor.blockNumber) && anchor.blockNumber >= 0
    && Number.isSafeInteger(anchor.anchoredAt) && anchor.anchoredAt >= 0
    && Number.isSafeInteger(anchor.size) && anchor.size > 0
    && (anchor.merkleRoot ? /^[0-9a-f]{64}$/.test(anchor.merkleRoot) && (anchor.headEntryHash === undefined || /^[0-9a-f]{64}$/.test(anchor.headEntryHash ?? '')) : /^[0-9a-f]{64}$/.test(anchor.headEntryHash ?? ''));
}
