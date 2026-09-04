import { hashJson } from '../core/hashing.mjs';

// The adapter accepts an injected pg Pool, keeping PostgreSQL optional for the offline verifier.
export function createPostgresStore(pool) {
  if (!pool?.query) throw new TypeError('createPostgresStore requires a pg-compatible pool');
  return {
    async saveIntent(intent) {
      const result = await pool.query(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json,intent_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (intent_hash) DO UPDATE SET intent_hash=EXCLUDED.intent_hash RETURNING intent_json`, [intent.intentId, intent.intentHash, intent.schema, intent.chainId, intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, intent.validUntil, intent.constraints ?? null, intent]);
      return result.rows[0].intent_json;
    },
    async getIntent(intentId) { const result = await pool.query('SELECT intent_json FROM intents WHERE intent_id = $1 LIMIT 1', [intentId]); return result.rows[0]?.intent_json; },
    async saveObservation(observation) { const result = await pool.query(`INSERT INTO execution_observations (chain_id,tx_hash,status,block_number,observed_at,finality_state,observation_json,observation_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (chain_id,tx_hash,observation_hash) DO NOTHING RETURNING observation_json`, [observation.chainId, observation.txHash, observation.status, observation.blockNumber, observation.observedAt, observation.finalityState, observation, hashJson(observation)]); return result.rows[0]?.observation_json ?? observation; },
    async getObservation(chainId, txHash) { const result = await pool.query('SELECT observation_json FROM execution_observations WHERE chain_id = $1 AND tx_hash = $2 ORDER BY id DESC LIMIT 1', [chainId, txHash]); return result.rows[0]?.observation_json; },
    async saveReceipt(receipt) { const result = await pool.query('INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (receipt_id) DO UPDATE SET receipt_json=EXCLUDED.receipt_json RETURNING *', [receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, receipt, receipt.signature ?? null]); return result.rows[0]; },
    async getReceipt(receiptId) { const result = await pool.query('SELECT receipt_json FROM receipts WHERE receipt_id = $1', [receiptId]); return result.rows[0]?.receipt_json; },
    async reserveIdempotency({ scope, key, requestHash, response, expiresAt }) {
      const result = await pool.query(`INSERT INTO idempotency_records (scope,idempotency_key,request_hash,response_json,expires_at) VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0)) ON CONFLICT (scope,idempotency_key) DO NOTHING RETURNING response_json`, [scope, key, requestHash, response, expiresAt]);
      if (result.rows[0]) return { replay: false, response };
      const existing = await pool.query('SELECT request_hash,response_json,expires_at FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2', [scope, key]);
      if (!existing.rows[0] || new Date(existing.rows[0].expires_at).getTime() < Date.now()) throw new Error('Idempotency record expired during request');
      if (existing.rows[0].request_hash !== requestHash) { const error = new Error('Idempotency key was reused with a different request'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
      return { replay: true, response: existing.rows[0].response_json };
    },
    async enqueueJob(job) { const result = await pool.query(`INSERT INTO observation_jobs (job_id,idempotency_key,input_json,state,attempts,next_attempt_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0)) ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [job.jobId, job.idempotencyKey, job.input, job.state, job.attempts, job.nextAttemptAt]); return rowToJob(result.rows[0]); },
    async claimDueJobs(now, limit = 10) { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await client.query(`WITH due AS (SELECT job_id FROM observation_jobs WHERE state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at <= to_timestamp($1 / 1000.0) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE observation_jobs j SET state = 'RUNNING', attempts = j.attempts + 1, updated_at = now() FROM due WHERE j.job_id = due.job_id RETURNING j.*`, [now, limit]); await client.query('COMMIT'); return result.rows.map(rowToJob); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } },
    async saveJob(job) { const result = await pool.query(`UPDATE observation_jobs SET state=$2,attempts=$3,next_attempt_at=to_timestamp($4 / 1000.0),observation_json=$5,error_json=$6,updated_at=now() WHERE job_id=$1 RETURNING *`, [job.jobId, job.state, job.attempts, job.nextAttemptAt, job.observation, job.error]); return rowToJob(result.rows[0]); },
    async getJob(jobId) { const result = await pool.query('SELECT * FROM observation_jobs WHERE job_id = $1', [jobId]); return result.rows[0] && rowToJob(result.rows[0]); },
  };
}

function rowToJob(row) { return { jobId: row.job_id, idempotencyKey: row.idempotency_key, input: row.input_json, state: row.state, attempts: row.attempts, nextAttemptAt: new Date(row.next_attempt_at).getTime(), observation: row.observation_json, error: row.error_json, createdAt: new Date(row.created_at).getTime() }; }
