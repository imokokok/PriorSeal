// Generated from cloudflare-schema.mts by npm run core:build. Do not edit directly.
const REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY = 11;
const RUNTIME_CAPABILITY = "cloudflare-runtime";
function createSchemaCapabilityGuard() {
  let ready = false;
  let pending;
  return async (database) => {
    if (ready) return;
    const check = pending ??= (async () => {
      const capability = await database.prepare("SELECT version FROM priorseal_schema_capabilities WHERE capability=?").bind(RUNTIME_CAPABILITY).first();
      if (capability?.version !== REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY) {
        throw new TypeError(`D1 runtime schema capability ${REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY} is required`);
      }
      ready = true;
    })();
    try {
      await check;
    } finally {
      if (pending === check) pending = void 0;
    }
  };
}
export {
  REQUIRED_D1_RUNTIME_SCHEMA_CAPABILITY,
  createSchemaCapabilityGuard
};
