// Generated from error-code.mts by npm run core:build. Do not edit directly.
function errorCode(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return void 0;
  return typeof error.code === "string" ? error.code : void 0;
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
export {
  errorCode,
  errorMessage
};
