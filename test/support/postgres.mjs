// Generated from postgres.mts by npm run core:build. Do not edit directly.
function testPostgresPool({ query, connect }) {
  return { query, connect: connect ?? (async () => {
    throw new Error("Unexpected database transaction");
  }) };
}
function pgliteClient(database) {
  return { query: (sql, parameters) => database.query(sql, parameters), release() {
  } };
}
function pglitePool(database) {
  const client = pgliteClient(database);
  return testPostgresPool({
    query: (sql, parameters) => database.query(sql, parameters),
    connect: async () => client
  });
}
export {
  pgliteClient,
  pglitePool,
  testPostgresPool
};
