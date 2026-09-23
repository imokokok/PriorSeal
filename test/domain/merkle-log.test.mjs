// Generated from merkle-log.test.mts by npm run core:build. Do not edit directly.
import test from "node:test";
import assert from "node:assert/strict";
import { createMerkleProof, merkleAppendNodes, merkleNodeKey, verifyMerkleProof } from "../../src/domain/merkle-log.mjs";
test("compact proofs agree on one root for every leaf across irregular tree sizes", () => {
  const nodes = /* @__PURE__ */ new Map();
  const entries = [];
  const sizes = /* @__PURE__ */ new Set([1, 2, 3, 4, 5, 7, 8, 9, 13, 16, 31, 32, 33, 64, 100, 128]);
  for (let sequence = 1; sequence <= 128; sequence += 1) {
    const entryHash = sequence.toString(16).padStart(64, "0");
    entries.push(entryHash);
    for (const node of merkleAppendNodes(sequence, entryHash, (start, level) => nodes.get(merkleNodeKey(start, level)))) nodes.set(merkleNodeKey(node.start, node.level), node.hash);
    if (!sizes.has(sequence)) continue;
    let expectedRoot;
    for (let index = 1; index <= sequence; index += 1) {
      const { root, path } = createMerkleProof(entries[index - 1], index, sequence, nodes);
      expectedRoot ??= root;
      assert.equal(root, expectedRoot);
      assert.equal(verifyMerkleProof(entries[index - 1], index, sequence, path, root), true);
      assert.equal(verifyMerkleProof(entries[index - 1], index, sequence, path, "f".repeat(64)), false);
      if (path.length) assert.equal(verifyMerkleProof(entries[index - 1], index, sequence, [{ ...path[0], side: path[0].side === "left" ? "right" : "left" }, ...path.slice(1)], root), false);
    }
  }
});
