export function createMemoryWitnessStore() {
  const attestations = new Map();
  return {
    async get(requestHash, witnessId) { return attestations.get(`${witnessId}:${requestHash}`); },
    async save(requestHash, witnessId, attestation) {
      const key = `${witnessId}:${requestHash}`;
      if (!attestations.has(key)) attestations.set(key, structuredClone(attestation));
      return structuredClone(attestations.get(key));
    },
    async health() { return 'memory'; },
  };
}
