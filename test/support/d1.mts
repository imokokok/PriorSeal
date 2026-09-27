import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/** Executes adapter SQL against SQLite, including D1's atomic batch boundary. */
export function testD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../../d1/migrations/0001_initial.sql', import.meta.url), 'utf8'));
  const calls: { sql: string; values: SQLInputValue[] }[] = [];
  const batches: number[] = [];
  type Statement = D1PreparedStatement & { execute(): { results: unknown[] } };
  const prepared = (sql: string, values: SQLInputValue[] = []): Statement => ({
    bind: (...next: SQLInputValue[]) => prepared(sql, next),
    async first() { calls.push({ sql, values }); return sqlite.prepare(sql).get(...values) ?? null; },
    async all() { calls.push({ sql, values }); return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { calls.push({ sql, values }); return { results: [], meta: sqlite.prepare(sql).run(...values) }; },
    execute() {
      calls.push({ sql, values });
      const statement = sqlite.prepare(sql);
      if (/^SELECT|\bRETURNING\b/i.test(sql)) return { results: statement.all(...values) };
      statement.run(...values);
      return { results: [] };
    },
  } as unknown as Statement);
  const database = {
    prepare: prepared,
    async batch(statements: Statement[]) {
      batches.push(statements.length);
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } as unknown as D1Database;
  return { sqlite, database, calls, batches };
}
