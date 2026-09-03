// The adapter accepts an injected pg Pool, keeping PostgreSQL optional for the offline verifier.
export function createPostgresStore(pool) {
  if (!pool?.query) throw new TypeError('createPostgresStore requires a pg-compatible pool');
  return {
    async saveIntent(intent) {
      const result = await pool.query(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (intent_hash) DO UPDATE SET intent_hash=EXCLUDED.intent_hash RETURNING *`, [intent.intentId, intent.intentHash, intent.schema, intent.chainId, intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, intent.validUntil, intent.constraints ?? null]);
      return result.rows[0];
    },
    async getIntent(intentId) { const result = await pool.query('SELECT * FROM intents WHERE intent_id = $1 LIMIT 1', [intentId]); return result.rows[0]; },
    async saveObservation(observation) { return observation; },
    async saveReceipt(receipt) { const result = await pool.query('INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (receipt_id) DO UPDATE SET receipt_json=EXCLUDED.receipt_json RETURNING *', [receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, receipt, receipt.signature ?? null]); return result.rows[0]; },
    async getReceipt(receiptId) { const result = await pool.query('SELECT receipt_json FROM receipts WHERE receipt_id = $1', [receiptId]); return result.rows[0]?.receipt_json; },
  };
}
