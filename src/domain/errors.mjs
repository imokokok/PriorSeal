export class PriorSealError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PriorSealError'; this.code = code; this.details = details; }
}
