export class RunProofError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'RunProofError'; this.code = code; this.details = details; }
}
