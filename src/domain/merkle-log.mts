import { hashJson } from './hashing.mjs';

type Range = { start: number; size: number };
type NodeRange = { start: number; level: number };
export type MerkleProofStep = { side: 'left' | 'right'; hash: string };
export type MerkleProof = { root: string; path: MerkleProofStep[] };
export type MerkleNode = NodeRange & { hash: string };

// Domain-separated, ordered tree over the existing append-only entry hashes.
// Complete power-of-two subtrees are persisted so an inclusion proof needs
// only O(log n) nodes, not a scan of the authorization log.
export const merkleLeafHash = (entryHash: string): string => hashJson({ domain: 'priorseal/transparency-leaf/v1', entryHash });
export const merkleParentHash = (left: string, right: string): string => hashJson({ domain: 'priorseal/transparency-node/v1', left, right });
export const merkleNodeKey = (start: number, level: number): string => `${start}:${level}`;

function largestPowerBelow(size: number): number {
  return 2 ** Math.floor(Math.log2(size - 1));
}

function splitRange(start: number, size: number): [Range, Range] {
  const leftSize = largestPowerBelow(size);
  return [{ start, size: leftSize }, { start: start + leftSize, size: size - leftSize }];
}

function completeNodeRanges(start: number, size: number): NodeRange[] {
  if (size === 1 || Number.isInteger(Math.log2(size))) return [{ start, level: Math.log2(size) }];
  const [left, right] = splitRange(start, size);
  return [...completeNodeRanges(left.start, left.size), ...completeNodeRanges(right.start, right.size)];
}

export function requiredMerkleNodes(sequence: number, size: number): NodeRange[] {
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(size) || sequence < 1 || sequence > size) throw new TypeError('Invalid Merkle proof range');
  const nodes = new Map<string, NodeRange>();
  function visit(start: number, count: number): void {
    if (count === 1) return;
    const [left, right] = splitRange(start, count);
    const containsLeft = sequence < right.start;
    const sibling = containsLeft ? right : left;
    for (const node of completeNodeRanges(sibling.start, sibling.size)) nodes.set(merkleNodeKey(node.start, node.level), node);
    const child = containsLeft ? left : right;
    visit(child.start, child.size);
  }
  visit(1, size);
  return [...nodes.values()];
}

export function createMerkleProof(entryHash: string, sequence: number, size: number, nodes: ReadonlyMap<string, string>): MerkleProof {
  if (!/^[0-9a-f]{64}$/.test(entryHash)) throw new TypeError('Invalid Merkle leaf');
  requiredMerkleNodes(sequence, size);
  const nodeHash = (start: number, level: number): string => {
    const hash = nodes.get(merkleNodeKey(start, level));
    if (!/^[0-9a-f]{64}$/.test(hash ?? '')) throw new TypeError('Authorization Merkle index is incomplete');
    return hash as string;
  };
  const rangeHash = (start: number, count: number): string => {
    if (count === 1 || Number.isInteger(Math.log2(count))) return nodeHash(start, Math.log2(count));
    const [left, right] = splitRange(start, count);
    return merkleParentHash(rangeHash(left.start, left.size), rangeHash(right.start, right.size));
  };
  function visit(start: number, count: number): MerkleProof {
    if (count === 1) return { root: merkleLeafHash(entryHash), path: [] };
    const [left, right] = splitRange(start, count);
    const containsLeft = sequence < right.start;
    const sibling = containsLeft ? right : left;
    const child = containsLeft ? left : right;
    const result = visit(child.start, child.size);
    const hash = rangeHash(sibling.start, sibling.size);
    return { root: containsLeft ? merkleParentHash(result.root, hash) : merkleParentHash(hash, result.root), path: [...result.path, { side: containsLeft ? 'right' : 'left', hash }] };
  }
  return visit(1, size);
}

export function verifyMerkleProof(entryHash: string, sequence: number, size: number, path: unknown, expectedRoot: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(entryHash ?? '') || !/^[0-9a-f]{64}$/.test(expectedRoot ?? '') || !Array.isArray(path)) return false;
  let expectedSides: MerkleProofStep['side'][];
  try { expectedSides = merkleProofSides(sequence, size); } catch { return false; }
  if (path.length !== expectedSides.length) return false;
  let hash = merkleLeafHash(entryHash);
  for (const [index, item] of path.entries()) {
    const step = item as Partial<MerkleProofStep> | null;
    if (!step || step.side !== expectedSides[index] || !/^[0-9a-f]{64}$/.test(step.hash ?? '') || Object.keys(step).sort().join(',') !== 'hash,side') return false;
    hash = step.side === 'left' ? merkleParentHash(step.hash as string, hash) : merkleParentHash(hash, step.hash as string);
  }
  return hash === expectedRoot;
}

function merkleProofSides(sequence: number, size: number): MerkleProofStep['side'][] {
  if (!Number.isSafeInteger(sequence) || !Number.isSafeInteger(size) || sequence < 1 || sequence > size) throw new TypeError('Invalid Merkle proof range');
  let start = 1;
  const sides: MerkleProofStep['side'][] = [];
  while (size > 1) {
    const [left, right] = splitRange(start, size);
    const containsLeft = sequence < right.start;
    const child = containsLeft ? left : right;
    sides.push(containsLeft ? 'right' : 'left');
    start = child.start;
    size = child.size;
  }
  return sides.reverse();
}

export function merkleAppendNodes(sequence: number, entryHash: string, getNode: (start: number, level: number) => string | undefined): MerkleNode[] {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError('Invalid authorization-log sequence');
  const result: MerkleNode[] = [{ start: sequence, level: 0, hash: merkleLeafHash(entryHash) }];
  let current = result[0];
  while (sequence % (2 ** (current.level + 1)) === 0) {
    const leftStart = current.start - 2 ** current.level;
    const left = getNode(leftStart, current.level);
    if (!/^[0-9a-f]{64}$/.test(left ?? '')) throw new TypeError('Authorization Merkle index is incomplete');
    current = { start: leftStart, level: current.level + 1, hash: merkleParentHash(left as string, current.hash) };
    result.push(current);
  }
  return result;
}
