// Generated from errors.mts by npm run core:build. Do not edit directly.
class PriorSealError extends Error {
  code;
  details;
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PriorSealError";
    this.code = code;
    this.details = details;
  }
}
export {
  PriorSealError
};
