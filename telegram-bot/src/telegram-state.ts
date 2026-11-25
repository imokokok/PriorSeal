import { DurableObject } from 'cloudflare:workers'

type CheckCommand = 'check' | 'other'
type Reservation = 'reserved' | 'duplicate' | 'rate_limited'
const EVIDENCE_RETENTION_SECONDS = 30 * 86_400
const MAX_SOURCE_EVIDENCE_RECORDS = 100

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
    })
  }

  reserveUpdate(updateId: number, now: number, command: CheckCommand): Reservation {
    const sql = this.ctx.storage.sql
    sql.exec('DELETE FROM updates WHERE created_at < ?', now - 86_400)
    sql.exec('DELETE FROM checks WHERE requested_at < ?', now - 86_400)
    const existing = sql.exec<{ update_id: number }>(
      'SELECT update_id FROM updates WHERE update_id = ? LIMIT 1', updateId,
    ).toArray()
    if (existing.length) return 'duplicate'

    if (command === 'check') {
      const hourly = sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM checks WHERE requested_at > ?', now - 3_600,
      ).toArray()[0]?.total ?? 0
      const daily = sql.exec<{ total: number }>(
        'SELECT COUNT(*) AS total FROM checks WHERE requested_at > ?', now - 86_400,
      ).toArray()[0]?.total ?? 0
      if (hourly >= 3 || daily >= 10) {
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

  storeSourceEvidence(
    updateId: number,
    marketId: string,
    collectedAt: string,
    evidenceHash: string,
    payloadJson: string,
    now: number,
  ): void {
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
    if (hourly >= 3 || daily >= 10) return false
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
