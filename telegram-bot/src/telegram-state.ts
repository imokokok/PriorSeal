import { DurableObject } from 'cloudflare:workers'
import { decideUpdateReservation } from './update-reservation.js'

type CheckCommand = 'check' | 'other'
type Reservation = 'reserved' | 'duplicate' | 'in_progress' | 'rate_limited'
const EVIDENCE_RETENTION_SECONDS = 30 * 86_400
const MAX_SOURCE_EVIDENCE_RECORDS = 100
export const SPONSORED_TRIAL_MONTHLY_CREDIT_CAP = 200
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
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS polymarket_trials (
        telegram_user_id TEXT PRIMARY KEY,
        update_id INTEGER NOT NULL,
        requested_at INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0
      )`)
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS assessment_confirmations (
        token TEXT PRIMARY KEY,
        telegram_user_id TEXT NOT NULL,
        market_slug TEXT NOT NULL,
        side TEXT NOT NULL,
        quoted_cost INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0
      )`)
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS assessment_confirmations_expiry ON assessment_confirmations(expires_at)')
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS sponsored_trial_budget (
        month TEXT NOT NULL,
        update_id INTEGER NOT NULL,
        credits INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        reserved_at INTEGER NOT NULL,
        PRIMARY KEY(month, update_id)
      )`)
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

  reservePolymarketTrial(telegramUserId: number, updateId: number, now: number): 'reserved' | 'used' | 'in_progress' {
    if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 || !Number.isSafeInteger(updateId) ||
        updateId < 0 || !Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid Telegram trial reservation')
    const userId = String(telegramUserId)
    const sql = this.ctx.storage.sql
    const existing = sql.exec<{ update_id: number; requested_at: number; completed: number }>(
      'SELECT update_id, requested_at, completed FROM polymarket_trials WHERE telegram_user_id = ? LIMIT 1', userId,
    ).toArray()[0]
    if (existing?.completed === 1) return 'used'
    if (existing && existing.requested_at > now - 120) return 'in_progress'
    sql.exec('INSERT OR REPLACE INTO polymarket_trials(telegram_user_id, update_id, requested_at, completed) VALUES (?, ?, ?, 0)',
      userId, updateId, now)
    return 'reserved'
  }

  completePolymarketTrial(telegramUserId: number, updateId: number): void {
    this.ctx.storage.sql.exec(
      'UPDATE polymarket_trials SET completed = 1 WHERE telegram_user_id = ? AND update_id = ?',
      String(telegramUserId), updateId,
    )
  }

  releasePolymarketTrial(telegramUserId: number, updateId: number): void {
    this.ctx.storage.sql.exec(
      'DELETE FROM polymarket_trials WHERE telegram_user_id = ? AND update_id = ? AND completed = 0',
      String(telegramUserId), updateId,
    )
  }

  createAssessmentConfirmation(token: string, telegramUserId: number, slug: string, side: 'up' | 'down', cost: number, now: number): void {
    if (!/^[a-f0-9]{24}$/.test(token) || !Number.isSafeInteger(telegramUserId) || telegramUserId <= 0 ||
        !/^[a-z0-9][a-z0-9_-]{1,199}$/i.test(slug) || !Number.isSafeInteger(cost) || cost < 0 ||
        !Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid assessment confirmation')
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM assessment_confirmations WHERE expires_at <= ?', now)
    sql.exec('INSERT INTO assessment_confirmations(token, telegram_user_id, market_slug, side, quoted_cost, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      token, String(telegramUserId), slug, side, cost, now + 7 * 86_400)
  }

  consumeAssessmentConfirmation(token: string, telegramUserId: number, now: number): { slug: string; side: 'up' | 'down'; cost: number } | null {
    const sql = this.ctx.storage.sql
    const row = sql.exec<{ market_slug: string; side: string; quoted_cost: number; expires_at: number; consumed: number }>(
      'SELECT market_slug, side, quoted_cost, expires_at, consumed FROM assessment_confirmations WHERE token = ? AND telegram_user_id = ? LIMIT 1',
      token, String(telegramUserId),
    ).toArray()[0]
    if (!row || row.expires_at <= now || row.consumed !== 0 || (row.side !== 'up' && row.side !== 'down')) return null
    sql.exec('UPDATE assessment_confirmations SET consumed = 1 WHERE token = ? AND consumed = 0', token)
    return { slug: row.market_slug, side: row.side, cost: row.quoted_cost }
  }

  reserveSponsoredTrialBudget(updateId: number, credits: number, now: number): boolean {
    if (!Number.isSafeInteger(updateId) || updateId < 0 || !Number.isSafeInteger(credits) || credits <= 0 ||
        !Number.isSafeInteger(now) || now < 0) return false
    const month = new Date(now * 1000).toISOString().slice(0, 7)
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM sponsored_trial_budget WHERE month < ?', month)
    const existing = sql.exec<{ completed: number; reserved_at: number }>(
      'SELECT completed, reserved_at FROM sponsored_trial_budget WHERE month = ? AND update_id = ? LIMIT 1', month, updateId,
    ).toArray()[0]
    if (existing?.completed === 1 || (existing && existing.reserved_at > now - 120)) return false
    if (existing) sql.exec('DELETE FROM sponsored_trial_budget WHERE month = ? AND update_id = ? AND completed = 0', month, updateId)
    const total = sql.exec<{ credits: number }>(
      'SELECT COALESCE(SUM(credits), 0) AS credits FROM sponsored_trial_budget WHERE month = ?', month,
    ).toArray()[0]?.credits ?? 0
    if (total + credits > SPONSORED_TRIAL_MONTHLY_CREDIT_CAP) return false
    sql.exec('INSERT INTO sponsored_trial_budget(month, update_id, credits, completed, reserved_at) VALUES (?, ?, ?, 0, ?)', month, updateId, credits, now)
    return true
  }

  completeSponsoredTrialBudget(updateId: number, now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new TypeError('Invalid sponsored trial completion time')
    this.ctx.storage.sql.exec('UPDATE sponsored_trial_budget SET completed = 1 WHERE update_id = ?', updateId)
  }

  releaseSponsoredTrialBudget(updateId: number, now: number): void {
    const month = new Date(now * 1000).toISOString().slice(0, 7)
    this.ctx.storage.sql.exec('DELETE FROM sponsored_trial_budget WHERE update_id = ? AND completed = 0', updateId)
  }
}
