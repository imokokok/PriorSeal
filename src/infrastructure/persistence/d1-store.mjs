// Generated from d1-store.mts by npm run core:build. Do not edit directly.
import { randomUUID } from "node:crypto";
import { hashJson } from "../../domain/hashing.mjs";
import { archivePage } from "../../application/archive/evidence-archive.mjs";
import { createMerkleProof, merkleAppendNodes, merkleNodeKey, requiredMerkleNodes } from "../../domain/merkle-log.mjs";
import { persistedAcceptance, persistedArchiveEntry, persistedAuthorization, persistedCount, persistedIntent, persistedJobError, persistedJobInput, persistedJobResult, persistedJson, persistedObservation, persistedPolicy, persistedReceipt, persistedStatus, persistedWorkerObservation } from "./persisted-records.mjs";
const json = (value) => value == null ? null : JSON.stringify(value);
const parsed = (value, label) => value == null ? null : persistedJson(value, label);
const numeric = (value) => value == null ? null : typeof value === "number" && Number.isFinite(value) ? value : null;
const failed = (code, message = code) => Object.assign(new Error(message), { code });
const logEntry = (row) => ({ sequence: Number(row.sequence), authorizationHash: row.authorization_hash, acceptedAt: Number(row.accepted_at), previousEntryHash: row.previous_entry_hash, entryHash: row.entry_hash });
function authorizationRecord(row) {
  const policyEvidence = persistedPolicy(row.policy_json);
  return {
    authorization: persistedAuthorization(row.authorization_json),
    acceptance: persistedAcceptance(row.acceptance_json),
    policy: policyEvidence?.result ?? policyEvidence,
    ...policyEvidence?.schema === "priorseal.policy-evidence.v1" ? { policyEvidence } : {},
    ...row.timestamp_evidence_json ? { timestampEvidence: parsed(row.timestamp_evidence_json, "timestamp evidence") } : {},
    ...row.witness_evidence_json ? { witnessEvidence: parsed(row.witness_evidence_json, "witness evidence") } : {},
    status: persistedStatus(row.status, "authorization.status"),
    boundTxHash: row.bound_tx_hash,
    uses: persistedCount(row.uses, "authorization.uses")
  };
}
function jobRecord(row, includeLease = false) {
  return {
    jobId: persistedStatus(row.job_id, "job.jobId"),
    idempotencyKey: row.idempotency_key,
    input: persistedJobInput(row.input_json),
    state: persistedStatus(row.state, "job.state"),
    attempts: persistedCount(row.attempts, "job.attempts"),
    nextAttemptAt: persistedCount(row.next_attempt_at, "job.nextAttemptAt"),
    observation: row.observation_json == null ? null : persistedWorkerObservation(row.observation_json),
    result: persistedJobResult(row.result_json),
    error: persistedJobError(row.error_json),
    createdAt: persistedCount(row.created_at, "job.createdAt"),
    ...includeLease && row.lease_token ? { leaseToken: row.lease_token } : {}
  };
}
function assertReceiptIdentity(existing, candidate) {
  if (existing && hashJson(existing) !== hashJson(candidate)) throw failed("RECEIPT_ID_CONFLICT", "Receipt ID is already associated with different signed evidence");
}
function createD1Store(database) {
  if (!database?.prepare || !database?.batch) throw new TypeError("createD1Store requires a D1 binding");
  const statement = (sql, ...values) => database.prepare(sql).bind(...values);
  const first = (sql, ...values) => statement(sql, ...values).first();
  const all = async (sql, ...values) => (await statement(sql, ...values).all()).results;
  const run = (sql, ...values) => statement(sql, ...values).run();
  const batch = (statements) => database.batch(statements);
  async function merkleStatements(sequence, entryHash) {
    const previous = /* @__PURE__ */ new Map();
    let level = 0;
    while (sequence % 2 ** (level + 1) === 0) {
      const start = sequence - 2 ** level;
      const left = await first("SELECT node_hash FROM authorization_log_merkle_nodes WHERE start_sequence=? AND level=?", start, level);
      if (!left) throw new TypeError("Authorization Merkle index is incomplete");
      previous.set(merkleNodeKey(start, level), left.node_hash);
      level++;
    }
    return merkleAppendNodes(sequence, entryHash, (start, depth) => previous.get(merkleNodeKey(start, depth))).map((node) => statement("INSERT INTO authorization_log_merkle_nodes (start_sequence,level,node_hash) VALUES (?,?,?)", node.start, node.level, node.hash));
  }
  async function appendLog(authorizationHash, acceptedAt, record, intent) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await first("SELECT * FROM authorization_log WHERE authorization_hash=?", authorizationHash);
      if (existing) return logEntry(existing);
      const head = await first("SELECT * FROM authorization_log ORDER BY sequence DESC LIMIT 1");
      const sequence = Number(head?.sequence ?? 0) + 1;
      const previousEntryHash = head?.entry_hash ?? null;
      const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
      const log = { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash };
      const statements = [statement("INSERT INTO authorization_log (sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash) VALUES (?,?,?,?,?)", sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash), ...await merkleStatements(sequence, entryHash)];
      if (record && intent) statements.push(...authorizationStatements(record, intent, sequence));
      try {
        await batch(statements);
        return log;
      } catch (error) {
        if (record) {
          const saved = await first("SELECT * FROM authorizations WHERE authorization_id=?", record.authorization.authorizationId);
          if (saved) return logEntry(await first("SELECT * FROM authorization_log WHERE sequence=?", persistedAcceptance(saved.acceptance_json).sequence));
          const nonce = await first("SELECT authorization_id FROM authorizations WHERE authorization_nonce=?", record.authorization.authorizationNonce);
          if (nonce) throw failed("AUTHORIZATION_NONCE_REUSED", "Authorization nonce has already been used");
        }
        const winner = await first("SELECT * FROM authorization_log WHERE authorization_hash=?", authorizationHash);
        if (winner) return logEntry(winner);
        if (await first("SELECT intent_hash FROM intents WHERE intent_id=? AND intent_hash<>?", intent?.intentId ?? "", intent?.intentHash ?? "")) throw failed("DUPLICATE_INTENT");
        if (await first("SELECT sequence FROM authorization_log WHERE sequence=?", sequence)) continue;
        throw error;
      }
    }
    throw new Error("Authorization log append contention exceeded retry limit");
  }
  function authorizationStatements(record, intent, sequence) {
    const value = record.authorization;
    return [
      statement(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json,intent_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET intent_id=excluded.intent_id WHERE intents.intent_hash=excluded.intent_hash`, intent.intentId, intent.intentHash, intent.schema, Number(intent.chainId), intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, Number(intent.validUntil), json(intent.constraints), json(intent)),
      statement(`INSERT INTO authorizations (authorization_id,authorization_hash,intent_hash,principal_id,principal_account,authorizer_address,authorizer_type,executor_address,authorization_nonce,expires_at,max_uses,uses,status,bound_tx_hash,authorization_json,acceptance_json,policy_json,witness_evidence_json,timestamp_evidence_json,log_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.authorizationId, hashJson(value), value.intentHash, value.principal.id, value.principal.account, value.authorizer.address, value.authorizer.type, value.delegate.executor, value.authorizationNonce, Number(value.expiresAt), Number(value.maxUses), Number(record.uses), record.status, record.boundTxHash, json(value), json(record.acceptance), json(record.policyEvidence ?? record.policy), json(record.witnessEvidence), json(record.timestampEvidence), sequence)
    ];
  }
  const store = {
    archiveRetention: "until_operator_deletion",
    async saveArchiveEntry(entry) {
      await run(`INSERT INTO project_evidence_archive (project_id,environment,entry_id,artifact_hash,kind,created_at,tx_hash,authorization_id,status,supersedes_id,entry_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,environment,entry_id) DO NOTHING`, entry.projectId, entry.environment, entry.id, entry.artifactHash, entry.kind, entry.createdAt, entry.txHash, entry.authorizationId, entry.status, entry.supersedesId, json(entry));
      const saved = await this.getArchiveEntry(entry, entry.id);
      if (saved?.supersedesId !== entry.supersedesId) throw failed("ARCHIVE_CONFLICT", "Archive entry already has a different supersession relationship");
      return saved;
    },
    async getArchiveEntry(access, id) {
      const row = await first("SELECT entry_json,sequence FROM project_evidence_archive WHERE project_id=? AND environment=? AND entry_id=?", access.projectId, access.environment, id);
      return row && { ...persistedArchiveEntry(row.entry_json), sequence: Number(row.sequence) };
    },
    async listArchiveEntries(query) {
      const snapshot = query.cursor?.snapshot ?? Number((await first("SELECT COALESCE(MAX(sequence),0) AS snapshot FROM project_evidence_archive WHERE project_id=? AND environment=?", query.projectId, query.environment))?.snapshot ?? 0);
      const columns = query.includeArtifacts ? "entry_json,sequence" : "sequence,project_id,environment,entry_id,artifact_hash,kind,created_at,tx_hash,authorization_id,status,supersedes_id";
      const rows = await all(`SELECT ${columns} FROM project_evidence_archive WHERE project_id=? AND environment=? AND sequence<=? AND (? IS NULL OR sequence<?) AND (? IS NULL OR tx_hash=?) AND (? IS NULL OR authorization_id=?) AND (? IS NULL OR status=?) AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) ORDER BY sequence DESC LIMIT ?`, query.projectId, query.environment, snapshot, query.cursor?.after ?? null, query.cursor?.after ?? null, query.filters.txHash, query.filters.txHash, query.filters.authorizationId, query.filters.authorizationId, query.filters.status, query.filters.status, query.filters.from, query.filters.from, query.filters.to, query.filters.to, query.limit + 1);
      return archivePage(rows.map((row) => query.includeArtifacts ? { ...persistedArchiveEntry(row.entry_json), sequence: Number(row.sequence) } : { id: row.entry_id, projectId: row.project_id, environment: row.environment, kind: row.kind, createdAt: Number(row.created_at), artifactHash: row.artifact_hash, supersedesId: row.supersedes_id, txHash: row.tx_hash, authorizationId: row.authorization_id, status: row.status, artifact: void 0, verification: "NOT_VERIFIED_BY_ARCHIVE", sequence: Number(row.sequence) }), query, snapshot);
    },
    async saveIntent(intent) {
      const saved = await first(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json,intent_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET intent_id=excluded.intent_id WHERE intents.intent_hash=excluded.intent_hash RETURNING intent_json`, intent.intentId, intent.intentHash, intent.schema, Number(intent.chainId), intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, Number(intent.validUntil), json(intent.constraints), json(intent));
      if (!saved) throw failed("DUPLICATE_INTENT");
      return persistedIntent(saved.intent_json);
    },
    async getIntent(id) {
      const row = await first("SELECT intent_json FROM intents WHERE intent_id=?", id);
      return row ? persistedIntent(row.intent_json) : void 0;
    },
    async saveObservation(observation) {
      await run("INSERT INTO execution_observations (intent_hash,chain_id,tx_hash,status,block_number,observed_at,finality_state,observation_json,observation_hash) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(chain_id,tx_hash,observation_hash) DO NOTHING", String(observation.intentHash ?? "") || null, Number(observation.chainId), observation.txHash, observation.status, numeric(observation.blockNumber), numeric(observation.observedAt), typeof observation.finalityState === "string" ? observation.finalityState : null, json(observation), hashJson(observation));
      return observation;
    },
    async getObservation(chainId, txHash) {
      const row = await first("SELECT observation_json FROM execution_observations WHERE chain_id=? AND tx_hash=? ORDER BY id DESC LIMIT 1", Number(chainId), txHash);
      return row ? persistedObservation(row.observation_json) : void 0;
    },
    async appendAuthorizationLog({ authorizationHash, acceptedAt }) {
      return appendLog(authorizationHash, acceptedAt);
    },
    async listAuthorizationLog() {
      return (await all("SELECT * FROM authorization_log ORDER BY sequence")).map(logEntry);
    },
    async getAuthorizationMerkleSnapshot(acceptance, size = null) {
      const accepted = await first("SELECT entry_hash FROM authorization_log WHERE sequence=?", acceptance.sequence);
      if (accepted?.entry_hash !== acceptance.entryHash) throw new TypeError("Authorization acceptance does not match the local log");
      const head = size == null ? await first("SELECT * FROM authorization_log ORDER BY sequence DESC LIMIT 1") : await first("SELECT * FROM authorization_log WHERE sequence=?", size);
      if (!head || Number(head.sequence) < acceptance.sequence) throw new TypeError("Authorization is not present in the Merkle checkpoint");
      const nodes = /* @__PURE__ */ new Map();
      for (const node of requiredMerkleNodes(acceptance.sequence, Number(head.sequence))) {
        const found = await first("SELECT node_hash FROM authorization_log_merkle_nodes WHERE start_sequence=? AND level=?", node.start, node.level);
        if (found) nodes.set(merkleNodeKey(node.start, node.level), found.node_hash);
      }
      const proof = createMerkleProof(acceptance.entryHash, acceptance.sequence, Number(head.sequence), nodes);
      return { size: Number(head.sequence), headEntryHash: head.entry_hash, merkleRoot: proof.root, proof: proof.path };
    },
    async saveAcceptedAuthorization({ authorization, acceptedAt, createRecord }) {
      const saved = await this.getAuthorization(authorization.authorizationId);
      if (saved) return saved;
      if (await first("SELECT authorization_id FROM authorizations WHERE authorization_nonce=?", authorization.authorizationNonce)) throw failed("AUTHORIZATION_NONCE_REUSED", "Authorization nonce has already been used");
      if (await first("SELECT intent_hash FROM intents WHERE intent_id=? AND intent_hash<>?", authorization.intent.intentId, authorization.intentHash)) throw failed("DUPLICATE_INTENT");
      const authorizationHash = hashJson(authorization);
      const existing = await first("SELECT * FROM authorization_log WHERE authorization_hash=?", authorizationHash);
      if (existing) {
        const record = createRecord(logEntry(existing));
        try {
          await batch(authorizationStatements(record, authorization.intent, existing.sequence));
        } catch (error) {
          const winner = await this.getAuthorization(authorization.authorizationId);
          if (winner) return winner;
          throw error;
        }
        return record;
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const head = await first("SELECT * FROM authorization_log ORDER BY sequence DESC LIMIT 1");
        const sequence = Number(head?.sequence ?? 0) + 1;
        const previousEntryHash = head?.entry_hash ?? null;
        const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
        const record = createRecord({ sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash });
        const statements = [statement("INSERT INTO authorization_log (sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash) VALUES (?,?,?,?,?)", sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash), ...await merkleStatements(sequence, entryHash), ...authorizationStatements(record, authorization.intent, sequence)];
        try {
          await batch(statements);
          return record;
        } catch (error) {
          const winner = await this.getAuthorization(authorization.authorizationId);
          if (winner) return winner;
          if (await first("SELECT authorization_id FROM authorizations WHERE authorization_nonce=?", authorization.authorizationNonce)) throw failed("AUTHORIZATION_NONCE_REUSED", "Authorization nonce has already been used");
          if (await first("SELECT intent_hash FROM intents WHERE intent_id=? AND intent_hash<>?", authorization.intent.intentId, authorization.intentHash)) throw failed("DUPLICATE_INTENT");
          if (await first("SELECT sequence FROM authorization_log WHERE sequence=?", sequence)) continue;
          throw error;
        }
      }
      throw new Error("Authorization log append contention exceeded retry limit");
    },
    async saveAuthorization(record) {
      const existing = await this.getAuthorization(record.authorization.authorizationId);
      if (existing) return existing;
      try {
        await batch(authorizationStatements(record, record.authorization.intent, record.acceptance.sequence));
      } catch (error) {
        const winner = await this.getAuthorization(record.authorization.authorizationId);
        if (winner) return winner;
        throw error;
      }
      return record;
    },
    async getAuthorization(id) {
      const row = await first("SELECT * FROM authorizations WHERE authorization_id=?", id);
      return row ? authorizationRecord(row) : void 0;
    },
    async bindAuthorization(id, txHash) {
      const row = await first(`UPDATE authorizations SET bound_tx_hash=COALESCE(bound_tx_hash,?),uses=CASE WHEN bound_tx_hash IS NULL THEN 1 ELSE uses END,status='BOUND' WHERE authorization_id=? AND (bound_tx_hash IS NULL OR bound_tx_hash=?) RETURNING *`, txHash, id, txHash);
      if (row) return { ok: true, record: authorizationRecord(row) };
      return { ok: false, code: await first("SELECT 1 FROM authorizations WHERE authorization_id=?", id) ? "AUTHORIZATION_ALREADY_USED" : "AUTHORIZATION_NOT_FOUND" };
    },
    async saveObservationReceipt({ authorizationId, claimAuthorization, observation, receipt }) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = receipt && await first("SELECT receipt_json FROM receipts WHERE receipt_id=?", receipt.receiptId);
        if (existing && receipt) assertReceiptIdentity(persistedReceipt(existing.receipt_json), receipt);
        const statements = [];
        if (claimAuthorization) statements.push(statement(`UPDATE authorizations SET bound_tx_hash=COALESCE(bound_tx_hash,?),uses=CASE WHEN bound_tx_hash IS NULL THEN 1 ELSE uses END,status='BOUND' WHERE authorization_id=? AND (bound_tx_hash IS NULL OR bound_tx_hash=?) RETURNING authorization_id`, observation.txHash, authorizationId ?? null, observation.txHash));
        const guard = claimAuthorization ? " WHERE EXISTS (SELECT 1 FROM authorizations WHERE authorization_id=? AND bound_tx_hash=?)" : " WHERE 1";
        statements.push(statement(`INSERT INTO execution_observations (intent_hash,chain_id,tx_hash,status,block_number,observed_at,finality_state,observation_json,observation_hash) SELECT ?,?,?,?,?,?,?,?,?${guard} ON CONFLICT(chain_id,tx_hash,observation_hash) DO NOTHING`, String(observation.intentHash ?? "") || null, Number(observation.chainId), observation.txHash, observation.status, numeric(observation.blockNumber), numeric(observation.observedAt), typeof observation.finalityState === "string" ? observation.finalityState : null, json(observation), hashJson(observation), ...claimAuthorization ? [authorizationId ?? null, observation.txHash] : []));
        if (receipt && !existing) statements.push(statement(`INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) SELECT ?,?,?,?,?,?,?,?,?${guard}`, receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, json(receipt), receipt.signature ?? null, ...claimAuthorization ? [authorizationId ?? null, observation.txHash] : []));
        try {
          const results = await batch(statements);
          if (claimAuthorization && !results[0].results.length) return { ok: false, code: await first("SELECT 1 FROM authorizations WHERE authorization_id=?", authorizationId ?? null) ? "AUTHORIZATION_ALREADY_USED" : "AUTHORIZATION_NOT_FOUND" };
          return { ok: true };
        } catch (error) {
          if (receipt && attempt === 0 && await first("SELECT receipt_json FROM receipts WHERE receipt_id=?", receipt.receiptId)) continue;
          throw error;
        }
      }
      throw new Error("Receipt persistence retry exhausted");
    },
    async saveReceipt(receipt) {
      await run("INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(receipt_id) DO NOTHING", receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, json(receipt), receipt.signature ?? null);
      const row = await first("SELECT receipt_json FROM receipts WHERE receipt_id=?", receipt.receiptId);
      const existing = row ? persistedReceipt(row.receipt_json) : null;
      assertReceiptIdentity(existing, receipt);
      return existing;
    },
    async getReceipt(id) {
      const row = await first("SELECT receipt_json FROM receipts WHERE receipt_id=?", id);
      return row ? persistedReceipt(row.receipt_json) : null;
    },
    async getIdempotency(scope, key) {
      const row = await first("SELECT request_hash,response_json,expires_at FROM idempotency_records WHERE scope=? AND idempotency_key=?", scope, key);
      return row ? { requestHash: row.request_hash, response: persistedJson(row.response_json, "idempotency response"), expiresAt: Number(row.expires_at) } : void 0;
    },
    async reserveIdempotency({ scope, key, requestHash, response, expiresAt }) {
      const saved = await first(`INSERT INTO idempotency_records (scope,idempotency_key,request_hash,response_json,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,response_json=excluded.response_json,expires_at=excluded.expires_at,created_at=unixepoch()*1000 WHERE idempotency_records.expires_at<=unixepoch()*1000 RETURNING response_json`, scope, key, requestHash, json(response), expiresAt);
      if (saved) return { replay: false, response };
      const existing = await this.getIdempotency(scope, key);
      if (!existing) throw new Error("Idempotency record disappeared during request");
      if (existing.requestHash !== requestHash) throw failed("IDEMPOTENCY_CONFLICT", "Idempotency key was reused with a different request");
      return { replay: true, response: existing.response };
    },
    async enqueueJob(job) {
      const row = await first(`INSERT INTO observation_jobs (job_id,idempotency_key,input_json,state,attempts,next_attempt_at) VALUES (?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`, job.jobId, job.idempotencyKey ?? `${job.input.chainId}:${job.input.txHash}`, json(job.input), job.state, job.attempts, job.nextAttemptAt);
      return jobRecord(row);
    },
    async claimDueJobs(now, limit = 10, leaseDurationMs = 15 * 6e4) {
      const leaseToken = randomUUID();
      const rows = await all(`UPDATE observation_jobs SET state='RUNNING',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE job_id IN (SELECT job_id FROM observation_jobs WHERE (state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=?) OR (state='RUNNING' AND lease_expires_at<=?) ORDER BY COALESCE(lease_expires_at,next_attempt_at) LIMIT ?) RETURNING *`, leaseToken, now + leaseDurationMs, now, now, now, limit);
      return rows.map((row) => jobRecord(row, true));
    },
    async saveJob(job) {
      const row = await first(`UPDATE observation_jobs SET state=?,attempts=?,next_attempt_at=?,observation_json=?,result_json=?,error_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND lease_token=? RETURNING *`, job.state, job.attempts, job.nextAttemptAt, json(job.observation), json(job.result), json(job.error), Date.now(), job.jobId, job.leaseToken ?? null);
      return row ? jobRecord(row) : void 0;
    },
    async getJob(jobId) {
      const row = await first("SELECT * FROM observation_jobs WHERE job_id=?", jobId);
      return row ? jobRecord(row) : void 0;
    },
    async health() {
      await first("SELECT 1");
      return "d1";
    }
  };
  return store;
}
export {
  createD1Store
};
