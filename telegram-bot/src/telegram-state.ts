import { DurableObject } from 'cloudflare:workers'
import { decideUpdateReservation } from './update-reservation.js'

type CheckCommand = 'check' | 'other'
type Reservation = 'reserved' | 'duplicate' | 'in_progress' | 'rate_limited'
const EVIDENCE_RETENTION_SECONDS = 30 * 86_400
const MAX_SOURCE_EVIDENCE_RECORDS = 100
export const MAX_SCENARIO_REQUESTS_PER_HOUR = 60
export const MAX_SCENARIO_REQUESTS_PER_DAY = 500

/** Per-chat durable update deduplication and rolling usage limits. */
export class TelegramBotState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS updates (
          update_id INTEGER PRIMARY KEY,
          created_at INTEGER NOT NULL,
          completed INTEGER NOT NULL DEFAULT 0
        )
      `)
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS checks (
          update_id INTEGER PRIMARY KEY,
          requested_at INTEGER NOT NULL
        )
      `)
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS checks_requested_at ON checks(requested_at)')
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS source_evidence (
          update_id INTEGER PRIMARY KEY,
          market_id TEXT NOT NULL,
          collected_at TEXT NOT NULL,
          evidence_hash TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          recorded_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `)
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS source_evidence_expires_at ON source_evidence(expires_at)')
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS lending_assessments (id INTEGER PRIMARY KEY AUTOINCREMENT, requested_at INTEGER NOT NULL)')
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS lending_assessments_requested_at ON lending_assessments(requested_at)')
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS swap_settlements (id INTEGER PRIMARY KEY AUTOINCREMENT, requested_at INTEGER NOT NULL)')
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS swap_settlements_requested_at ON swap_settlements(requested_at)')
      const nextExpiry = ctx.storage.sql.exec<{ expires_at: number }>(
        'SELECT MIN(expires_at) AS expires_at FROM source_evidence',
      ).toArray()[0]?.expires_at
      if (typeof nextExpiry === 'number') await ctx.storage.setAlarm(nextExpiry * 1000)
    })
  }

  reserveUpdate(updateId: number, now: number, command: CheckCommand): Reservation {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM updates WHERE created_at < ?', now - 86_400)
    sql.exec('DELETE FROM checks WHERE requested_at < ?', now - 86_400)
    const existing = sql.exec<{ update_id: number; created_at: number; completed: number }>(
      'SELECT update_id, created_at, completed FROM updates WHERE update_id = ? LIMIT 1', updateId,
    ).toArray()
    const prior = existing[0]
    const decision = decideUpdateReservation(prior ? { createdAt: prior.created_at, completed: prior.completed } : null, now)
    if (decision === 'duplicate') return 'duplicate'
    if (decision === 'in_progress') return 'in_progress'
    if (prior) {
      sql.exec('DELETE FROM checks WHERE update_id = ?', updateId)
      sql.exec('DELETE FROM updates WHERE update_id = ? AND completed = 0', updateId)
    }

    if (command === 'check') {
      const hourly = sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM checks WHERE requested_at > ?', now - 3_600,
      ).toArray()[0]?.total ?? 0
      const daily = sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM checks WHERE requested_at > ?', now - 86_400,
      ).toArray()[0]?.total ?? 0
      if (hourly >= MAX_SCENARIO_REQUESTS_PER_HOUR || daily >= MAX_SCENARIO_REQUESTS_PER_DAY) {
        sql.exec('INSERT INTO updates(update_id, created_at, completed) VALUES (?, ?, 0)', updateId, now)
        return 'rate_limited'
      }
      sql.exec('INSERT INTO checks(update_id, requested_at) VALUES (?, ?)', updateId, now)
    }

    sql.exec('INSERT INTO updates(update_id, created_at, completed) VALUES (?, ?, 0)', updateId, now)
    return 'reserved'
  }

  completeUpdate(updateId: number): void {
    this.ctx.storage.sql.exec('UPDATE updates SET completed = 1 WHERE update_id = ?', updateId)
  }

  releaseUpdate(updateId: number): void {
    this.ctx.storage.sql.exec('DELETE FROM checks WHERE update_id = ?', updateId)
    this.ctx.storage.sql.exec('DELETE FROM updates WHERE update_id = ? AND completed = 0', updateId)
  }

  async storeSourceEvidence(
    updateId: number,
    marketId: string,
    collectedAt: string,
    evidenceHash: string,
    payloadJson: string,
    now: number,
  ): Promise<void> {
    if (!Number.isSafeInteger(updateId) || updateId < 0 || !marketId || marketId.length > 100 ||
        !Number.isFinite(Date.parse(collectedAt)) || !/^0x[\da-f]{64}$/i.test(evidenceHash) ||
        new TextEncoder().encode(payloadJson).byteLength > 64 * 1024 || !Number.isSafeInteger(now) || now < 0) {
      throw new TypeError('Invalid verified Polymarket source evidence record')
    }
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM source_evidence WHERE expires_at <= ?', now)
    sql.exec(
      'INSERT OR REPLACE INTO source_evidence(update_id, market_id, collected_at, evidence_hash, payload_json, recorded_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      updateId, marketId, collectedAt, evidenceHash.toLowerCase(), payloadJson, now, now + EVIDENCE_RETENTION_SECONDS,
    )
    sql.exec(
      'DELETE FROM source_evidence WHERE update_id IN (SELECT update_id FROM source_evidence ORDER BY recorded_at DESC LIMIT -1 OFFSET ?)',
      MAX_SOURCE_EVIDENCE_RECORDS,
    )
    await this.scheduleEvidenceExpiry()
  }

  async getSourceEvidence(updateId: number, now: number): Promise<{
    marketId: string
    collectedAt: string
    evidenceHash: string
    payloadJson: string
  } | null> {
    if (!Number.isSafeInteger(updateId) || updateId < 0 || !Number.isSafeInteger(now) || now < 0) {
      throw new TypeError('Invalid source evidence record lookup')
    }
    const sql = this.ctx.storage.sql
    const row = sql.exec<{
      market_id: string; collected_at: string; evidence_hash: string; payload_json: string; expires_at: number
    }>(
      'SELECT market_id, collected_at, evidence_hash, payload_json, expires_at FROM source_evidence WHERE update_id = ? LIMIT 1',
      updateId,
    ).toArray()[0]
    if (!row) return null
    if (row.expires_at <= now) {
      sql.exec('DELETE FROM source_evidence WHERE update_id = ?', updateId)
      await this.scheduleEvidenceExpiry()
      return null
    }
    return {
      marketId: row.market_id,
      collectedAt: row.collected_at,
      evidenceHash: row.evidence_hash,
      payloadJson: row.payload_json,
    }
  }

  async alarm(): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    this.ctx.storage.sql.exec('DELETE FROM source_evidence WHERE expires_at <= ?', now)
    await this.scheduleEvidenceExpiry()
  }

  private async scheduleEvidenceExpiry(): Promise<void> {
    const nextExpiry = this.ctx.storage.sql.exec<{ expires_at: number }>(
      'SELECT MIN(expires_at) AS expires_at FROM source_evidence',
    ).toArray()[0]?.expires_at
    if (typeof nextExpiry === 'number') await this.ctx.storage.setAlarm(nextExpiry * 1000)
    else await this.ctx.storage.deleteAlarm()
  }

  reserveLendingAssessment(now: number): boolean {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM lending_assessments WHERE requested_at < ?', now - 86_400)
    const hourly = sql.exec<{ total: number }>(
      'SELECT COUNT(*) AS total FROM lending_assessments WHERE requested_at > ?', now - 3_600,
    ).toArray()[0]?.total ?? 0
    const daily = sql.exec<{ total: number }>(
      'SELECT COUNT(*) AS total FROM lending_assessments WHERE requested_at > ?', now - 86_400,
    ).toArray()[0]?.total ?? 0
    if (hourly >= MAX_SCENARIO_REQUESTS_PER_HOUR || daily >= MAX_SCENARIO_REQUESTS_PER_DAY) return false
    sql.exec('INSERT INTO lending_assessments(requested_at) VALUES (?)', now)
    return true
  }

  reserveSwapSettlement(now: number): boolean {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM swap_settlements WHERE requested_at < ?', now - 86_400)
    const hourly = sql.exec<{ total: number }>(
      'SELECT COUNT(*) AS total FROM swap_settlements WHERE requested_at > ?', now - 3_600,
    ).toArray()[0]?.total ?? 0
    const daily = sql.exec<{ total: number }>(
      'SELECT COUNT(*) AS total FROM swap_settlements WHERE requested_at > ?', now - 86_400,
    ).toArray()[0]?.total ?? 0
    if (hourly >= 3 || daily >= 10) return false
    sql.exec('INSERT INTO swap_settlements(requested_at) VALUES (?)', now)
    return true
  }
}
