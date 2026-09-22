// Generated from memory-witness-store.mts by npm run core:build. Do not edit directly.
function createMemoryWitnessStore() {
  const attestations = /* @__PURE__ */ new Map();
  return {
    async get(requestHash, witnessId) {
      return attestations.get(`${witnessId}:${requestHash}`);
    },
    async save(requestHash, witnessId, attestation) {
      const key = `${witnessId}:${requestHash}`;
      if (!attestations.has(key)) attestations.set(key, structuredClone(attestation));
      return structuredClone(attestations.get(key));
    },
    async health() {
      return "memory";
    }
  };
}
export {
  createMemoryWitnessStore
};
