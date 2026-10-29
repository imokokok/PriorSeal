export const REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY = 11;
const RUNTIME_CAPABILITY = 'cloudflare-runtime';

/**
 * Fails closed unless the ordered D1 migrations have recorded the exact
 * capability required by this Worker. After a successful primary-key lookup,
 * this isolate retains only the boolean result, never a D1 binding, query
 * result, Request, Response, or other invocation-scoped I/O object.
 */
export function createSchemaCapabilityGuard() {
  let ready = false;
  let pending: Promise<void> | undefined;
  return async (database: D1Database) => {
    if (ready) return;
    const check = pending ??= (async () => {
      const capability = await database.prepare('SELECT version FROM priorseal_schema_capabilities WHERE capability=?')
        .bind(RUNTIME_CAPABILITY)
        .first<{ version: number }>();
      if (capability?.version !== REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY) {
        throw new TypeError(`D1 runtime schema capability ${REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY} is required`);
      }
      ready = true;
    })();
    try {
      await check;
    } finally {
      if (pending === check) pending = undefined;
    }
  };
}
