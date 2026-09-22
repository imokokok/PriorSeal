export function createMemoryWitnessStore() {
  const attestations = new Map<string, Record<string, unknown>>();
  return {
    async get(requestHash: string, witnessId: string) { return attestations.get(`${witnessId}:${requestHash}`); },
    async save(requestHash: string, witnessId: string, attestation: Record<string, unknown>) {
      const key = `${witnessId}:${requestHash}`;
      if (!attestations.has(key)) attestations.set(key, structuredClone(attestation));
      return structuredClone(attestations.get(key)!);
    },
    async health() { return 'memory'; },
  };
}
