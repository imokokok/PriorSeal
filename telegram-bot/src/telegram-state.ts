import { DurableObject } from 'cloudflare:workers'

type CheckCommand = 'check' | 'other'
type Reservation = 'reserved' | 'duplicate' | 'rate_limited'

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
}
