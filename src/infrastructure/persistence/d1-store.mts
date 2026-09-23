import { randomUUID } from 'node:crypto';
import { errorCode } from '../../shared/error-code.mjs';
import { hashJson } from '../../domain/hashing.mjs';
import { archivePage, type ArchiveAccess, type ArchiveQuery } from '../../application/archive/evidence-archive.mjs';
import { createMerkleProof, merkleAppendNodes, merkleNodeKey, requiredMerkleNodes } from '../../domain/merkle-log.mjs';
import type { createMemoryStore } from './memory-store.mjs';
import type { ObservationJob } from '../../application/observations/observation-worker.mjs';

type MemoryStore = ReturnType<typeof createMemoryStore>;
type Intent = Parameters<MemoryStore['saveIntent']>[0];
type Observation = Parameters<MemoryStore['saveObservation']>[0];
type AuthorizationRecord = Parameters<MemoryStore['saveAuthorization']>[0];
type LogEntry = Awaited<ReturnType<MemoryStore['appendAuthorizationLog']>>;
type Receipt = Parameters<MemoryStore['saveReceipt']>[0] & { intentHash: string; execution: { txHash: string }; schema: string; issuer: string; keyId: string; outcome: string; signature?: string };
type ArchiveEntry = Parameters<MemoryStore['saveArchiveEntry']>[0];
type D1Value = string | number | boolean | null;
type LogRow = { sequence: number; authorization_hash: string; accepted_at: number; previous_entry_hash: string | null; entry_hash: string };
type AuthorizationRow = { authorization_json: string; acceptance_json: string; policy_json: string; timestamp_evidence_json: string | null; witness_evidence_json: string | null; status: string; bound_tx_hash: string | null; uses: number };
type JobRow = { job_id: string; idempotency_key: string; input_json: string; state: ObservationJob['state']; attempts: number; next_attempt_at: number; observation_json: string | null; result_json: string | null; error_json: string | null; created_at: number; lease_token: string | null; lease_expires_at: number | null };

const json = (value: unknown): string | null => value == null ? null : JSON.stringify(value);
const parsed = <T,>(value: string | null | undefined): T | null => value == null ? null : JSON.parse(value) as T;
const numeric = (value: unknown): number | null => value == null ? null : typeof value === 'number' && Number.isFinite(value) ? value : null;
const failed = (code: string, message = code): Error & { code: string } => Object.assign(new Error(message), { code });
const logEntry = (row: LogRow): LogEntry => ({ sequence: Number(row.sequence), authorizationHash: row.authorization_hash, acceptedAt: Number(row.accepted_at), previousEntryHash: row.previous_entry_hash, entryHash: row.entry_hash });
function authorizationRecord(row: AuthorizationRow): AuthorizationRecord {
  const policyEvidence = parsed<AuthorizationRecord['policyEvidence']>(row.policy_json);
  return {
    authorization: parsed<AuthorizationRecord['authorization']>(row.authorization_json)!,
    acceptance: parsed<AuthorizationRecord['acceptance']>(row.acceptance_json)!,
    policy: policyEvidence?.result ?? policyEvidence,
    ...(policyEvidence?.schema === 'priorseal.policy-evidence.v1' ? { policyEvidence } : {}),
    ...(row.timestamp_evidence_json ? { timestampEvidence: parsed(row.timestamp_evidence_json) } : {}),
    ...(row.witness_evidence_json ? { witnessEvidence: parsed(row.witness_evidence_json) } : {}),
    status: row.status,
    boundTxHash: row.bound_tx_hash,
    uses: Number(row.uses),
  };
}
function jobRecord(row: JobRow, includeLease = false): ObservationJob {
  return {
    jobId: row.job_id, idempotencyKey: row.idempotency_key, input: parsed<ObservationJob['input']>(row.input_json)!,
    state: row.state, attempts: Number(row.attempts), nextAttemptAt: Number(row.next_attempt_at),
    observation: parsed<ObservationJob['observation']>(row.observation_json),
    result: parsed<ObservationJob['result']>(row.result_json), error: parsed<ObservationJob['error']>(row.error_json),
    createdAt: Number(row.created_at),
    ...(includeLease && row.lease_token ? { leaseToken: row.lease_token } : {}),
  };
}
function assertReceiptIdentity(existing: unknown, candidate: Receipt) {
  if (existing && hashJson(existing) !== hashJson(candidate)) throw failed('RECEIPT_ID_CONFLICT', 'Receipt ID is already associated with different signed evidence');
}

/** D1's batch is the transaction boundary; concurrent log appends retry after a unique-sequence collision. */
export function createD1Store(database: D1Database) {
  if (!database?.prepare || !database?.batch) throw new TypeError('createD1Store requires a D1 binding');
  const statement = (sql: string, ...values: D1Value[]) => database.prepare(sql).bind(...values);
  const first = <T,>(sql: string, ...values: D1Value[]) => statement(sql, ...values).first<T>();
  const all = async <T,>(sql: string, ...values: D1Value[]) => (await statement(sql, ...values).all<T>()).results;
  const run = (sql: string, ...values: D1Value[]) => statement(sql, ...values).run();
  const batch = (statements: D1PreparedStatement[]) => database.batch(statements);

  async function merkleStatements(sequence: number, entryHash: string): Promise<D1PreparedStatement[]> {
    const previous = new Map<string, string>();
    let level = 0;
    while (sequence % (2 ** (level + 1)) === 0) {
      const start = sequence - 2 ** level;
      const left = await first<{ node_hash: string }>('SELECT node_hash FROM authorization_log_merkle_nodes WHERE start_sequence=? AND level=?', start, level);
      if (!left) throw new TypeError('Authorization Merkle index is incomplete');
      previous.set(merkleNodeKey(start, level), left.node_hash);
      level++;
    }
    return merkleAppendNodes(sequence, entryHash, (start, depth) => previous.get(merkleNodeKey(start, depth)))
      .map((node) => statement('INSERT INTO authorization_log_merkle_nodes (start_sequence,level,node_hash) VALUES (?,?,?)', node.start, node.level, node.hash));
  }

  async function appendLog(authorizationHash: string, acceptedAt: number, record?: AuthorizationRecord, intent?: Intent): Promise<LogEntry> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await first<LogRow>('SELECT * FROM authorization_log WHERE authorization_hash=?', authorizationHash);
      if (existing) return logEntry(existing);
      const head = await first<LogRow>('SELECT * FROM authorization_log ORDER BY sequence DESC LIMIT 1');
      const sequence = Number(head?.sequence ?? 0) + 1;
      const previousEntryHash = head?.entry_hash ?? null;
      const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
      const log = { sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash };
      const statements = [statement('INSERT INTO authorization_log (sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash) VALUES (?,?,?,?,?)', sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash), ...await merkleStatements(sequence, entryHash)];
      if (record && intent) statements.push(...authorizationStatements(record, intent, sequence));
      try { await batch(statements); return log; }
      catch (error) {
        if (record) {
          const saved = await first<AuthorizationRow>('SELECT * FROM authorizations WHERE authorization_id=?', record.authorization.authorizationId);
          if (saved) return logEntry((await first<LogRow>('SELECT * FROM authorization_log WHERE sequence=?', (parsed<AuthorizationRecord['acceptance']>(saved.acceptance_json)!).sequence))!);
          const nonce = await first('SELECT authorization_id FROM authorizations WHERE authorization_nonce=?', record.authorization.authorizationNonce);
          if (nonce) throw failed('AUTHORIZATION_NONCE_REUSED', 'Authorization nonce has already been used');
        }
        const winner = await first<LogRow>('SELECT * FROM authorization_log WHERE authorization_hash=?', authorizationHash);
        if (winner) return logEntry(winner);
        if (await first('SELECT intent_hash FROM intents WHERE intent_id=? AND intent_hash<>?', intent?.intentId ?? '', intent?.intentHash ?? '')) throw failed('DUPLICATE_INTENT');
        if (await first('SELECT sequence FROM authorization_log WHERE sequence=?', sequence)) continue;
        throw error;
      }
    }
    throw new Error('Authorization log append contention exceeded retry limit');
  }

  function authorizationStatements(record: AuthorizationRecord, intent: Intent, sequence: number): D1PreparedStatement[] {
    const value = record.authorization;
    return [
      statement(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json,intent_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET intent_id=excluded.intent_id WHERE intents.intent_hash=excluded.intent_hash`, intent.intentId, intent.intentHash, intent.schema, Number(intent.chainId), intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, Number(intent.validUntil), json(intent.constraints), json(intent)),
      statement(`INSERT INTO authorizations (authorization_id,authorization_hash,intent_hash,principal_id,principal_account,authorizer_address,authorizer_type,executor_address,authorization_nonce,expires_at,max_uses,uses,status,bound_tx_hash,authorization_json,acceptance_json,policy_json,witness_evidence_json,timestamp_evidence_json,log_sequence) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, value.authorizationId, hashJson(value), value.intentHash, value.principal.id, value.principal.account, value.authorizer.address, value.authorizer.type, value.delegate.executor, value.authorizationNonce, Number(value.expiresAt), Number(value.maxUses), Number(record.uses), record.status, record.boundTxHash, json(value), json(record.acceptance), json(record.policyEvidence ?? record.policy), json(record.witnessEvidence), json(record.timestampEvidence), sequence),
    ];
  }

  const store = {
    archiveRetention: 'until_operator_deletion',
    async saveArchiveEntry(entry: ArchiveEntry) {
      await run(`INSERT INTO project_evidence_archive (project_id,environment,entry_id,artifact_hash,kind,created_at,tx_hash,authorization_id,status,supersedes_id,entry_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,environment,entry_id) DO NOTHING`, entry.projectId, entry.environment, entry.id, entry.artifactHash, entry.kind, entry.createdAt, entry.txHash, entry.authorizationId, entry.status, entry.supersedesId, json(entry));
      const saved = await this.getArchiveEntry(entry, entry.id);
      if (saved?.supersedesId !== entry.supersedesId) throw failed('ARCHIVE_CONFLICT', 'Archive entry already has a different supersession relationship');
      return saved;
    },
    async getArchiveEntry(access: Pick<ArchiveAccess, 'projectId' | 'environment'>, id: string) {
      const row = await first<{ entry_json: string; sequence: number }>('SELECT entry_json,sequence FROM project_evidence_archive WHERE project_id=? AND environment=? AND entry_id=?', access.projectId, access.environment, id);
      return row && { ...parsed<ArchiveEntry>(row.entry_json)!, sequence: Number(row.sequence) };
    },
    async listArchiveEntries(query: ArchiveQuery) {
      const snapshot = query.cursor?.snapshot ?? Number((await first<{ snapshot: number }>('SELECT COALESCE(MAX(sequence),0) AS snapshot FROM project_evidence_archive WHERE project_id=? AND environment=?', query.projectId, query.environment))?.snapshot ?? 0);
      const columns = query.includeArtifacts ? 'entry_json,sequence' : 'sequence,project_id,environment,entry_id,artifact_hash,kind,created_at,tx_hash,authorization_id,status,supersedes_id';
      type ArchiveDbRow = { entry_json?: string; sequence: number; entry_id: string; project_id: string; environment: string; artifact_hash: string; kind: string; created_at: number; tx_hash: string | null; authorization_id: string | null; status: string; supersedes_id: string | null };
      const rows = await all<ArchiveDbRow>(`SELECT ${columns} FROM project_evidence_archive WHERE project_id=? AND environment=? AND sequence<=? AND (? IS NULL OR sequence<?) AND (? IS NULL OR tx_hash=?) AND (? IS NULL OR authorization_id=?) AND (? IS NULL OR status=?) AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?) ORDER BY sequence DESC LIMIT ?`, query.projectId, query.environment, snapshot, query.cursor?.after ?? null, query.cursor?.after ?? null, query.filters.txHash, query.filters.txHash, query.filters.authorizationId, query.filters.authorizationId, query.filters.status, query.filters.status, query.filters.from, query.filters.from, query.filters.to, query.filters.to, query.limit + 1);
      return archivePage(rows.map((row) => query.includeArtifacts
        ? { ...parsed<ArchiveEntry>(row.entry_json)!, sequence: Number(row.sequence) }
        : { id: row.entry_id, projectId: row.project_id, environment: row.environment, kind: row.kind, createdAt: Number(row.created_at), artifactHash: row.artifact_hash, supersedesId: row.supersedes_id, txHash: row.tx_hash, authorizationId: row.authorization_id, status: row.status, artifact: undefined, verification: 'NOT_VERIFIED_BY_ARCHIVE' as const, sequence: Number(row.sequence) }), query, snapshot);
    },
    async saveIntent(intent: Intent) {
      const saved = await first<{ intent_json: string }>(`INSERT INTO intents (intent_id,intent_hash,schema_version,chain_id,action,sender,recipient,asset,amount,nonce,valid_until,constraints_json,intent_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(intent_id) DO UPDATE SET intent_id=excluded.intent_id WHERE intents.intent_hash=excluded.intent_hash RETURNING intent_json`, intent.intentId, intent.intentHash, intent.schema, Number(intent.chainId), intent.action, intent.sender, intent.recipient, intent.asset, intent.amount, intent.nonce, Number(intent.validUntil), json(intent.constraints), json(intent));
      if (!saved) throw failed('DUPLICATE_INTENT');
      return parsed<Intent>(saved.intent_json)!;
    },
    async getIntent(id: string) { return parsed<Intent>((await first<{ intent_json: string }>('SELECT intent_json FROM intents WHERE intent_id=?', id))?.intent_json) ?? undefined; },
    async saveObservation(observation: Observation) {
      await run('INSERT INTO execution_observations (intent_hash,chain_id,tx_hash,status,block_number,observed_at,finality_state,observation_json,observation_hash) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(chain_id,tx_hash,observation_hash) DO NOTHING', String(observation.intentHash ?? '') || null, Number(observation.chainId), observation.txHash, observation.status, numeric(observation.blockNumber), numeric(observation.observedAt), typeof observation.finalityState === 'string' ? observation.finalityState : null, json(observation), hashJson(observation));
      return observation;
    },
    async getObservation(chainId: number | string | undefined, txHash: string) { return parsed<Observation>((await first<{ observation_json: string }>('SELECT observation_json FROM execution_observations WHERE chain_id=? AND tx_hash=? ORDER BY id DESC LIMIT 1', Number(chainId), txHash))?.observation_json) ?? undefined; },
    async appendAuthorizationLog({ authorizationHash, acceptedAt }: { authorizationHash: string; acceptedAt: number }) { return appendLog(authorizationHash, acceptedAt); },
    async listAuthorizationLog() { return (await all<LogRow>('SELECT * FROM authorization_log ORDER BY sequence')).map(logEntry); },
    async getAuthorizationMerkleSnapshot(acceptance: AuthorizationRecord['acceptance'], size: number | null = null) {
      const accepted = await first<{ entry_hash: string }>('SELECT entry_hash FROM authorization_log WHERE sequence=?', acceptance.sequence);
      if (accepted?.entry_hash !== acceptance.entryHash) throw new TypeError('Authorization acceptance does not match the local log');
      const head = size == null ? await first<LogRow>('SELECT * FROM authorization_log ORDER BY sequence DESC LIMIT 1') : await first<LogRow>('SELECT * FROM authorization_log WHERE sequence=?', size);
      if (!head || Number(head.sequence) < acceptance.sequence) throw new TypeError('Authorization is not present in the Merkle checkpoint');
      const nodes = new Map<string, string>();
      for (const node of requiredMerkleNodes(acceptance.sequence, Number(head.sequence))) {
        const found = await first<{ node_hash: string }>('SELECT node_hash FROM authorization_log_merkle_nodes WHERE start_sequence=? AND level=?', node.start, node.level);
        if (found) nodes.set(merkleNodeKey(node.start, node.level), found.node_hash);
      }
      const proof = createMerkleProof(acceptance.entryHash, acceptance.sequence, Number(head.sequence), nodes);
      return { size: Number(head.sequence), headEntryHash: head.entry_hash, merkleRoot: proof.root, proof: proof.path };
    },
    async saveAcceptedAuthorization({ authorization, acceptedAt, createRecord }: { authorization: AuthorizationRecord['authorization']; acceptedAt: number; createRecord: (log: LogEntry) => AuthorizationRecord }) {
      const saved = await this.getAuthorization(authorization.authorizationId);
      if (saved) return saved;
      if (await first('SELECT authorization_id FROM authorizations WHERE authorization_nonce=?', authorization.authorizationNonce)) throw failed('AUTHORIZATION_NONCE_REUSED', 'Authorization nonce has already been used');
      if (await first('SELECT intent_hash FROM intents WHERE intent_id=? AND intent_hash<>?', authorization.intent.intentId, authorization.intentHash)) throw failed('DUPLICATE_INTENT');
      const authorizationHash = hashJson(authorization);
      const existing = await first<LogRow>('SELECT * FROM authorization_log WHERE authorization_hash=?', authorizationHash);
      if (existing) {
        const record = createRecord(logEntry(existing));
        try { await batch(authorizationStatements(record, authorization.intent, existing.sequence)); }
        catch (error) { const winner = await this.getAuthorization(authorization.authorizationId); if (winner) return winner; throw error; }
        return record;
      }
      // The record contains the signed acceptance, so build it from the candidate log before the atomic batch.
      for (let attempt = 0; attempt < 8; attempt++) {
        const head = await first<LogRow>('SELECT * FROM authorization_log ORDER BY sequence DESC LIMIT 1');
        const sequence = Number(head?.sequence ?? 0) + 1;
        const previousEntryHash = head?.entry_hash ?? null;
        const entryHash = hashJson({ sequence, authorizationHash, acceptedAt, previousEntryHash });
        const record = createRecord({ sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash });
        const statements = [statement('INSERT INTO authorization_log (sequence,authorization_hash,accepted_at,previous_entry_hash,entry_hash) VALUES (?,?,?,?,?)', sequence, authorizationHash, acceptedAt, previousEntryHash, entryHash), ...await merkleStatements(sequence, entryHash), ...authorizationStatements(record, authorization.intent, sequence)];
        try { await batch(statements); return record; }
        catch (error) {
          const winner = await this.getAuthorization(authorization.authorizationId);
          if (winner) return winner;
          if (await first('SELECT authorization_id FROM authorizations WHERE authorization_nonce=?', authorization.authorizationNonce)) throw failed('AUTHORIZATION_NONCE_REUSED', 'Authorization nonce has already been used');
          if (await first('SELECT intent_hash FROM intents WHERE intent_id=? AND intent_hash<>?', authorization.intent.intentId, authorization.intentHash)) throw failed('DUPLICATE_INTENT');
          if (await first('SELECT sequence FROM authorization_log WHERE sequence=?', sequence)) continue;
          throw error;
        }
      }
      throw new Error('Authorization log append contention exceeded retry limit');
    },
    async saveAuthorization(record: AuthorizationRecord) {
      const existing = await this.getAuthorization(record.authorization.authorizationId);
      if (existing) return existing;
      try { await batch(authorizationStatements(record, record.authorization.intent, record.acceptance.sequence)); }
      catch (error) { const winner = await this.getAuthorization(record.authorization.authorizationId); if (winner) return winner; throw error; }
      return record;
    },
    async getAuthorization(id: string) { const row = await first<AuthorizationRow>('SELECT * FROM authorizations WHERE authorization_id=?', id); return row ? authorizationRecord(row) : undefined; },
    async bindAuthorization(id: string, txHash: string) {
      const row = await first<AuthorizationRow>(`UPDATE authorizations SET bound_tx_hash=COALESCE(bound_tx_hash,?),uses=CASE WHEN bound_tx_hash IS NULL THEN 1 ELSE uses END,status='BOUND' WHERE authorization_id=? AND (bound_tx_hash IS NULL OR bound_tx_hash=?) RETURNING *`, txHash, id, txHash);
      if (row) return { ok: true as const, record: authorizationRecord(row) };
      return { ok: false as const, code: await first('SELECT 1 FROM authorizations WHERE authorization_id=?', id) ? 'AUTHORIZATION_ALREADY_USED' : 'AUTHORIZATION_NOT_FOUND' };
    },
    async saveObservationReceipt({ authorizationId, claimAuthorization, observation, receipt }: { authorizationId?: string; claimAuthorization: boolean; observation: Observation; receipt: Receipt | null }) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = receipt && await first<{ receipt_json: string }>('SELECT receipt_json FROM receipts WHERE receipt_id=?', receipt.receiptId);
        if (existing && receipt) assertReceiptIdentity(parsed(existing.receipt_json), receipt);
        const statements: D1PreparedStatement[] = [];
        if (claimAuthorization) statements.push(statement(`UPDATE authorizations SET bound_tx_hash=COALESCE(bound_tx_hash,?),uses=CASE WHEN bound_tx_hash IS NULL THEN 1 ELSE uses END,status='BOUND' WHERE authorization_id=? AND (bound_tx_hash IS NULL OR bound_tx_hash=?) RETURNING authorization_id`, observation.txHash, authorizationId ?? null, observation.txHash));
        const guard = claimAuthorization ? ' WHERE EXISTS (SELECT 1 FROM authorizations WHERE authorization_id=? AND bound_tx_hash=?)' : ' WHERE 1';
        statements.push(statement(`INSERT INTO execution_observations (intent_hash,chain_id,tx_hash,status,block_number,observed_at,finality_state,observation_json,observation_hash) SELECT ?,?,?,?,?,?,?,?,?${guard} ON CONFLICT(chain_id,tx_hash,observation_hash) DO NOTHING`, String(observation.intentHash ?? '') || null, Number(observation.chainId), observation.txHash, observation.status, numeric(observation.blockNumber), numeric(observation.observedAt), typeof observation.finalityState === 'string' ? observation.finalityState : null, json(observation), hashJson(observation), ...(claimAuthorization ? [authorizationId ?? null, observation.txHash] : [])));
        if (receipt && !existing) statements.push(statement(`INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) SELECT ?,?,?,?,?,?,?,?,?${guard}`, receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, json(receipt), receipt.signature ?? null, ...(claimAuthorization ? [authorizationId ?? null, observation.txHash] : [])));
        try {
          const results = await batch(statements);
          if (claimAuthorization && !results[0].results.length) return { ok: false as const, code: await first('SELECT 1 FROM authorizations WHERE authorization_id=?', authorizationId ?? null) ? 'AUTHORIZATION_ALREADY_USED' : 'AUTHORIZATION_NOT_FOUND' };
          return { ok: true as const };
        } catch (error) {
          if (receipt && attempt === 0 && await first('SELECT receipt_json FROM receipts WHERE receipt_id=?', receipt.receiptId)) continue;
          throw error;
        }
      }
      throw new Error('Receipt persistence retry exhausted');
    },
    async saveReceipt(receipt: Receipt) {
      await run('INSERT INTO receipts (receipt_id,intent_hash,tx_hash,schema,issuer,key_id,outcome,receipt_json,signature) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(receipt_id) DO NOTHING', receipt.receiptId, receipt.intentHash, receipt.execution.txHash, receipt.schema, receipt.issuer, receipt.keyId, receipt.outcome, json(receipt), receipt.signature ?? null);
      const existing = parsed<Receipt>((await first<{ receipt_json: string }>('SELECT receipt_json FROM receipts WHERE receipt_id=?', receipt.receiptId))?.receipt_json);
      assertReceiptIdentity(existing, receipt);
      return existing!;
    },
    async getReceipt(id: string) { return parsed<Receipt>((await first<{ receipt_json: string }>('SELECT receipt_json FROM receipts WHERE receipt_id=?', id))?.receipt_json); },
    async getIdempotency<Response>(scope: string, key: string) {
      const row = await first<{ request_hash: string; response_json: string; expires_at: number }>('SELECT request_hash,response_json,expires_at FROM idempotency_records WHERE scope=? AND idempotency_key=?', scope, key);
      return row ? { requestHash: row.request_hash, response: parsed<Response>(row.response_json)!, expiresAt: Number(row.expires_at) } : undefined;
    },
    async reserveIdempotency<Response>({ scope, key, requestHash, response, expiresAt }: { scope: string; key: string; requestHash: string; response: Response; expiresAt: number }) {
      const saved = await first<{ response_json: string }>(`INSERT INTO idempotency_records (scope,idempotency_key,request_hash,response_json,expires_at) VALUES (?,?,?,?,?) ON CONFLICT(scope,idempotency_key) DO UPDATE SET request_hash=excluded.request_hash,response_json=excluded.response_json,expires_at=excluded.expires_at,created_at=unixepoch()*1000 WHERE idempotency_records.expires_at<=unixepoch()*1000 RETURNING response_json`, scope, key, requestHash, json(response), expiresAt);
      if (saved) return { replay: false, response };
      const existing = await this.getIdempotency<Response>(scope, key);
      if (!existing) throw new Error('Idempotency record disappeared during request');
      if (existing.requestHash !== requestHash) throw failed('IDEMPOTENCY_CONFLICT', 'Idempotency key was reused with a different request');
      return { replay: true, response: existing.response };
    },
    async enqueueJob(job: ObservationJob) {
      const row = await first<JobRow>(`INSERT INTO observation_jobs (job_id,idempotency_key,input_json,state,attempts,next_attempt_at) VALUES (?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=excluded.idempotency_key RETURNING *`, job.jobId, job.idempotencyKey ?? `${job.input.chainId}:${job.input.txHash}`, json(job.input), job.state, job.attempts, job.nextAttemptAt);
      return jobRecord(row!);
    },
    async claimDueJobs(now: number, limit = 10, leaseDurationMs = 15 * 60_000) {
      const leaseToken = randomUUID();
      const rows = await all<JobRow>(`UPDATE observation_jobs SET state='RUNNING',attempts=attempts+1,lease_token=?,lease_expires_at=?,updated_at=? WHERE job_id IN (SELECT job_id FROM observation_jobs WHERE (state IN ('QUEUED','RETRY_WAIT') AND next_attempt_at<=?) OR (state='RUNNING' AND lease_expires_at<=?) ORDER BY COALESCE(lease_expires_at,next_attempt_at) LIMIT ?) RETURNING *`, leaseToken, now + leaseDurationMs, now, now, now, limit);
      return rows.map((row) => jobRecord(row, true));
    },
    async saveJob(job: ObservationJob) {
      const row = await first<JobRow>(`UPDATE observation_jobs SET state=?,attempts=?,next_attempt_at=?,observation_json=?,result_json=?,error_json=?,lease_token=NULL,lease_expires_at=NULL,updated_at=? WHERE job_id=? AND lease_token=? RETURNING *`, job.state, job.attempts, job.nextAttemptAt, json(job.observation), json(job.result), json(job.error), Date.now(), job.jobId, job.leaseToken ?? null);
      return row ? jobRecord(row) : undefined;
    },
    async getJob(jobId: string) { const row = await first<JobRow>('SELECT * FROM observation_jobs WHERE job_id=?', jobId); return row ? jobRecord(row) : undefined; },
    async health() { await first('SELECT 1'); return 'd1'; },
  };
  return store;
}
