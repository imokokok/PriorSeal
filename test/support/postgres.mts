import type { Pool, PoolClient } from 'pg';
import type { PGlite } from '@electric-sql/pglite';

export type TestQueryResult = { rows: unknown[] };
export type TestQuery = (sql: string, parameters?: unknown[]) => Promise<TestQueryResult>;
export type TestClient = { query: TestQuery; release: () => void };

// pg exposes a large overloaded class surface, while these tests exercise only
// query/connect/release. Keep the structural bridge in one reviewed test seam.
export function testPostgresPool({ query, connect }: { query: TestQuery; connect?: () => Promise<TestClient> }): Pool {
  return { query, connect: connect ?? (async () => { throw new Error('Unexpected database transaction'); }) } as unknown as Pool;
}

export function pgliteClient(database: PGlite): PoolClient {
  return { query: (sql: string, parameters?: unknown[]) => database.query(sql, parameters), release() {} } as unknown as PoolClient;
}

export function pglitePool(database: PGlite): Pool {
  const client = pgliteClient(database);
  return testPostgresPool({
    query: (sql, parameters) => database.query(sql, parameters),
    connect: async () => client,
  });
}
