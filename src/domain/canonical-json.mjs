// Generated from canonical-json.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
function canonicalize(value) {
  if (value === void 0) throw new TypeError("undefined is not valid canonical JSON");
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("non-finite number is not valid canonical JSON");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === void 0) throw new TypeError("unsupported canonical JSON value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("canonical JSON requires a plain object");
  const object = value;
  return `{${Object.keys(object).sort().map((key) => {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new TypeError("unsafe canonical JSON key");
    return `${JSON.stringify(key)}:${canonicalize(object[key])}`;
  }).join(",")}}`;
}
function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}
function hashJson(value) {
  return sha256Hex(canonicalize(value));
}
export {
  canonicalize,
  hashJson,
  sha256Hex
};
