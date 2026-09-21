import { merkleAppendNodes, merkleNodeKey } from '../../domain/merkle-log.mjs';

// Called in the same transaction as migration 010 while the authorization-log
// advisory lock excludes concurrent appends. Memory use is O(log n); writes are
// batched and the migration is recorded only after the entire index is built.
export async function backfillAuthorizationMerkleIndex(client) {
  const peaks = new Map();
  let after = 0;
  let pending = [];
  async function flush() {
    if (!pending.length) return;
    const params = pending.flatMap(node => [node.start, node.level, node.hash]);
    const values = pending.map((_, index) => `($${index * 3 + 1},$${index * 3 + 2},$${index * 3 + 3})`).join(',');
    await client.query(`INSERT INTO authorization_log_merkle_nodes (start_sequence,level,node_hash) VALUES ${values}`, params);
    pending = [];
  }
  while (true) {
    const rows = await client.query('SELECT sequence,entry_hash FROM authorization_log WHERE sequence>$1 ORDER BY sequence LIMIT 1000', [after]);
    if (!rows.rows.length) break;
    for (const row of rows.rows) {
      const sequence = Number(row.sequence);
      if (sequence !== after + 1) throw new TypeError('Authorization log must have contiguous sequence numbers');
      const generated = merkleAppendNodes(sequence, row.entry_hash, (start, level) => peaks.get(merkleNodeKey(start, level)));
      for (let index = 0; index < generated.length; index += 1) {
        const node = generated[index];
        if (index > 0) {
          peaks.delete(merkleNodeKey(node.start, node.level - 1));
          const right = generated[index - 1];
          peaks.delete(merkleNodeKey(right.start, right.level));
        }
        peaks.set(merkleNodeKey(node.start, node.level), node.hash);
        pending.push(node);
        if (pending.length >= 500) await flush();
      }
      after = sequence;
    }
  }
  await flush();
}
