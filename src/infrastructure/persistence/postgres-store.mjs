import { hashJson } from '../../domain/hashing.mjs';

// The adapter accepts an injected pg Pool, keeping PostgreSQL optional for the offline verifier.
export function createPostgresStore(pool) {
  if (!pool?.query) throw new TypeError('createPostgresStore requires a pg-compatible pool');
  return {
    async saveIntent(intent) {
      const result = await pool.query(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json,intent_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (intent_id) DO UPDATE SET intent_id=EXCLUDED.intent_id WHERE intents.intent_hash=EXCLUDED.intent_hash RETURNING intent_json`, [intent.intentId, intent.intentHash, intent.schema, intent.chainId, intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, intent.validUntil, intent.constraints ?? null, intent]);
      if (result.rows[0]) return result.rows[0].intent_json;
      const error = new Error('DUPLICATE_INTENT');
      error.code = 'DUPLICATE_INTENT';
      throw error;
    },
    async getIntent(intentId) { const result = await pool.query('SELECT intent_json FROM intents WHERE intent_id = $1 LIMIT 1', [intentId]); return result.rows[0]?.intent_json; },
    async saveObservation(observation) { const result = await pool.query(`INSERT INTO execution_observations (intent_hash,chain_id,tx_hash,status,block_number,observed_at,finality_state,observation_json,observation_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (chain_id,tx_hash,observation_hash) DO NOTHING RETURNING observation_json`, [observation.intentHash ?? null, observation.chainId, observation.txHash, observation.status, observation.blockNumber, observation.observedAt, observation.finalityState, observation, hashJson(observation)]); return result.rows[0]?.observation_json ?? observation; },
    async getObservation(chainId, txHash) { const result = await pool.query('SELECT observation_json FROM execution_observations WHERE chain_id = $1 AND tx_hash = $2 ORDER BY id DESC LIMIT 1', [chainId, txHash]); return result.rows[0]?.observation_json; },
    async appendAuthorizationLog({ authorizationHash, acceptedAt }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT pg_advisory_xact_lock(hashtext('priorseal:authorization-log'))");
        const existing = await client.query('SELECT sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash FROM authorization_log WHERE authorization_hash=$1', [authorizationHash]);
        if (existing.rows[0]) { await client.query('COMMIT'); const row = existing.rows[0]; return { sequence: Number(row.sequence), authorizationHash: row.authorization_hash, acceptedAt: Number(row.accepted_at), previousEntryHash: row.previous_entry_hash, entryHash: row.entry_hash }; }
        const previous = await client.query('SELECT sequence,entry_hash FROM authorization_log ORDER BY sequence DESC LIMIT 1');
        const sequence = Number(previous.rows[0]?.sequence ?? 0) + 1;
        const previousEntryHash = previous.rows[0]?.entry_hash ?? null;
        const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
        await client.query('INSERT INTO authorization_log (sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash) VALUES ($1,$2,$3,$4,$5)', [sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash]);
        await client.query('COMMIT');
        return { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash };
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async listAuthorizationLog() { const result = await pool.query('SELECT sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash FROM authorization_log ORDER BY sequence'); return result.rows.map((row) => ({ sequence: Number(row.sequence), authorizationHash: row.authorization_hash, acceptedAt: Number(row.accepted_at), previousEntryHash: row.previous_entry_hash, entryHash: row.entry_hash })); },
    async saveAuthorization(record) {
      const value = record.authorization;
      const result = await pool.query(`INSERT INTO authorizations (authorization_id,authorization_hash,intent_hash,principal_id,principal_account,authorizer_address,authorizer_type,executor_address,authorization_nonce,expires_at,max_uses,uses,status,bound_tx_hash,authorization_json,acceptance_json,policy_json,witness_evidence_json,timestamp_evidence_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (authorization_id) DO NOTHING RETURNING *`, [value.authorizationId, hashJson(value), value.intentHash, value.principal.id, value.principal.account, value.authorizer.address, value.authorizer.type, value.delegate.executor, value.authorizationNonce, value.expiresAt, Number(value.maxUses), record.uses, record.status, record.boundTxHash, value, record.acceptance, record.policyEvidence ?? record.policy, record.witnessEvidence ?? null, record.timestampEvidence ?? null]);
      if (result.rows[0]) return rowToAuthorization(result.rows[0]);
      return this.getAuthorization(value.authorizationId);
    },
    async getAuthorization(id) { const result = await pool.query('SELECT * FROM authorizations WHERE authorization_id=$1', [id]); return result.rows[0] && rowToAuthorization(result.rows[0]); },
    async bindAuthorization(id, txHash) {
      const result = await pool.query(`UPDATE authorizations SET bound_tx_hash=COALESCE(bound_tx_hash,$2),uses=CASE WHEN bound_tx_hash IS NULL THEN 1 ELSE uses END,status='BOUND' WHERE authorization_id=$1 AND (bound_tx_hash IS NULL OR bound_tx_hash=$2) RETURNING *`, [id, txHash]);
      if (result.rows[0]) return { ok: true, record: rowToAuthorization(result.rows[0]) };
      const existing = await pool.query('SELECT authorization_id FROM authorizations WHERE authorization_id=$1', [id]);
      return { ok: false, code: existing.rows[0] ? 'AUTHORIZATION_ALREADY_USED' : 'AUTHORIZATION_NOT_FOUND' };
    },
    async saveReceipt(receipt) { const result = await pool.query('INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (receipt_id) DO NOTHING RETURNING receipt_json', [receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, receipt, receipt.signature ?? null]); if (result.rows[0]) return result.rows[0].receipt_json; const existing = await pool.query('SELECT receipt_json FROM receipts WHERE receipt_id = $1', [receipt.receiptId]); return existing.rows[0]?.receipt_json; },
    async getReceipt(receiptId) { const result = await pool.query('SELECT receipt_json FROM receipts WHERE receipt_id = $1', [receiptId]); return result.rows[0]?.receipt_json; },
    async getIdempotency(scope, key) { const result = await pool.query('SELECT request_hash,response_json,expires_at FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2', [scope, key]); const row = result.rows[0]; return row ? { requestHash: row.request_hash, response: row.response_json, expiresAt: new Date(row.expires_at).getTime() } : undefined; },
    async reserveIdempotency({ scope, key, requestHash, response, expiresAt }) {
      const result = await pool.query(`INSERT INTO idempotency_records (scope,idempotency_key,request_hash,response_json,expires_at) VALUES ($1,$2,$3,$4,to_timestamp($5 / 1000.0)) ON CONFLICT (scope,idempotency_key) DO UPDATE SET request_hash=EXCLUDED.request_hash,response_json=EXCLUDED.response_json,expires_at=EXCLUDED.expires_at,created_at=now() WHERE idempotency_records.expires_at <= now() RETURNING response_json`, [scope, key, requestHash, response, expiresAt]);
      if (result.rows[0]) return { replay: false, response };
      const existing = await pool.query('SELECT request_hash,response_json,expires_at FROM idempotency_records WHERE scope = $1 AND idempotency_key = $2', [scope, key]);
      if (!existing.rows[0]) throw new Error('Idempotency record disappeared during request');
      if (existing.rows[0].request_hash !== requestHash) { const error = new Error('Idempotency key was reused with a different request'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
      return { replay: true, response: existing.rows[0].response_json };
    },
    async enqueueJob(job) { const result = await pool.query(`INSERT INTO observation_jobs (job_id,idempotency_key,input_json,state,attempts,next_attempt_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6 / 1000.0)) ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [job.jobId, job.idempotencyKey, job.input, job.state, job.attempts, job.nextAttemptAt]); return rowToJob(result.rows[0]); },
    async claimDueJobs(now, limit = 10) { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await client.query(`WITH due AS (SELECT job_id FROM observation_jobs WHERE state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at <= to_timestamp($1 / 1000.0) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE observation_jobs j SET state = 'RUNNING', attempts = j.attempts + 1, updated_at = now() FROM due WHERE j.job_id = due.job_id RETURNING j.*`, [now, limit]); await client.query('COMMIT'); return result.rows.map(rowToJob); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } },
    async saveJob(job) { const result = await pool.query(`UPDATE observation_jobs SET state=$2,attempts=$3,next_attempt_at=to_timestamp($4 / 1000.0),observation_json=$5,error_json=$6,updated_at=now() WHERE job_id=$1 RETURNING *`, [job.jobId, job.state, job.attempts, job.nextAttemptAt, job.observation, job.error]); return rowToJob(result.rows[0]); },
    async getJob(jobId) { const result = await pool.query('SELECT * FROM observation_jobs WHERE job_id = $1', [jobId]); return result.rows[0] && rowToJob(result.rows[0]); },
    async health() { await pool.query('SELECT 1'); return 'postgresql'; },
  };
}

function rowToJob(row) { return { jobId: row.job_id, idempotencyKey: row.idempotency_key, input: row.input_json, state: row.state, attempts: row.attempts, nextAttemptAt: new Date(row.next_attempt_at).getTime(), observation: row.observation_json, error: row.error_json, createdAt: new Date(row.created_at).getTime() }; }
function rowToAuthorization(row) { return { authorization: row.authorization_json, acceptance: row.acceptance_json, policy: row.policy_json?.result ?? row.policy_json, policyEvidence: row.policy_json?.schema === 'priorseal.policy-evidence.v1' ? row.policy_json : undefined, ...(row.timestamp_evidence_json ? { timestampEvidence: row.timestamp_evidence_json } : {}), ...(row.witness_evidence_json ? { witnessEvidence: row.witness_evidence_json } : {}), status: row.status, boundTxHash: row.bound_tx_hash, uses: row.uses }; }
