// Generated from integration-readiness.mts by npm run core:build. Do not edit directly.
import { getAddress } from "viem";
import { signEd25519Statement, verifyEd25519Statement } from "./ed25519.mjs";
import { hashJson } from "./hashing.mjs";
const INTEGRATION_READINESS_SCHEMA = "priorseal.integration-readiness.v1";
const INTEGRATION_READINESS_DOMAIN = "priorseal/integration-readiness/v1";
const SMOKE_TEST_ADDRESS = "0x0000000000000000000000000000000000000000";
function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError(`Integration readiness ${field} must be a positive integer`);
  return Number(value);
}
function boundedString(value, field, max = 512) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new TypeError(`Integration readiness ${field} is invalid`);
  return value;
}
function evmAddress(value) {
  if (typeof value !== "string") throw new TypeError("Integration readiness subjectAddress must be an EVM address");
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new TypeError("Integration readiness subjectAddress must be an EVM address");
  }
}
function inspection(value) {
  const observedChainId = value?.chain?.observedChainId;
  if (!["SUPPORTED", "UNSUPPORTED"].includes(value?.chain?.support) || !["AVAILABLE", "NOT_CONFIGURED", "CHAIN_ID_MISMATCH", "UNAVAILABLE"].includes(value?.chain?.rpc) || observedChainId !== null && !Number.isSafeInteger(observedChainId) || ![null, "evm-json-rpc"].includes(value?.chain?.source) || !["EOA", "CONTRACT", "NOT_OBSERVED"].includes(value?.subject?.kind) || value.subject.codeHash !== null && !/^0x[0-9a-f]{64}$/.test(value.subject.codeHash) || value.subject.codeBytes !== null && (!Number.isSafeInteger(value.subject.codeBytes) || value.subject.codeBytes < 0)) {
    throw new TypeError("Integration readiness inspection is invalid");
  }
  if (value.subject.kind === "NOT_OBSERVED" && (value.subject.codeHash !== null || value.subject.codeBytes !== null)) throw new TypeError("Unobserved integration readiness subjects cannot contain code facts");
  if (value.subject.kind !== "NOT_OBSERVED" && (value.subject.codeHash === null || value.subject.codeBytes === null)) throw new TypeError("Observed integration readiness subjects must contain code facts");
  return value;
}
function workflow({ chainId, subjectAddress, keyRegistryUrl }) {
  const origin = new URL(keyRegistryUrl).origin;
  const isSmokeTest = subjectAddress === SMOKE_TEST_ADDRESS;
  const targetTemplate = `${origin}/v1/integration-readiness?chainId=${chainId}&subjectAddress={publicEvmAddress}`;
  const nextActions = [
    ...isSmokeTest ? [{
      rel: "run_real_target",
      method: "GET",
      href: targetTemplate,
      description: "Replace {publicEvmAddress} with the public EOA or contract that you actually intend to integrate. The zero-address smoke test only verifies discovery, payment, and signed delivery."
    }] : [],
    {
      rel: "read_capabilities",
      method: "GET",
      href: `${origin}/v1/capabilities`,
      description: "Read the live payment rails, evidence products, and Agent-credit capabilities before selecting a workflow."
    },
    {
      rel: "prepare_controlled_execution",
      method: "GET",
      href: `${origin}/.well-known/priorseal-agent.json`,
      description: "Read the Agent integration manifest before preparing a bounded authorization. A readiness report never grants transaction authority or permits broadcast."
    }
  ];
  return {
    stage: isSmokeTest ? "SMOKE_TEST" : "TARGET_INSPECTED",
    nextActions
  };
}
function buildIntegrationReadiness({
  chainId,
  subjectAddress,
  inspection: result,
  issuer,
  keyId = "default",
  issuedAt = Math.floor(Date.now() / 1e3),
  expiresAt = issuedAt + 300,
  keyRegistry,
  payment
}) {
  const normalizedChainId = positiveInteger(chainId, "chainId");
  const normalizedAddress = evmAddress(subjectAddress);
  const normalizedIssuer = boundedString(issuer, "issuer", 256);
  const normalizedKeyId = boundedString(keyId, "keyId", 128);
  const normalizedIssuedAt = positiveInteger(issuedAt, "issuedAt");
  const normalizedExpiresAt = positiveInteger(expiresAt, "expiresAt");
  if (normalizedExpiresAt <= normalizedIssuedAt || normalizedExpiresAt - normalizedIssuedAt > 3600) throw new TypeError("Integration readiness expiresAt must be after issuedAt and within one hour");
  if (!keyRegistry || keyRegistry.schema !== "priorseal.keys.v1" || !/^[0-9a-f]{64}$/.test(keyRegistry.hash) || typeof keyRegistry.url !== "string" || !/^https:\/\//.test(keyRegistry.url)) throw new TypeError("Integration readiness key registry digest is invalid");
  if (!payment || payment.protocol !== "x402" || payment.method !== "GET" || payment.path !== "/v1/integration-readiness" || typeof payment.price !== "string" || !/^\$(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(payment.price)) throw new TypeError("Integration readiness payment descriptor is invalid");
  const checked = inspection(result);
  const input = { chainId: normalizedChainId, subjectAddress: normalizedAddress };
  const inputHash = hashJson(input);
  const readinessId = `pir_${hashJson({ inputHash, inspection: checked, issuer: normalizedIssuer, keyId: normalizedKeyId, issuedAt: normalizedIssuedAt, expiresAt: normalizedExpiresAt }).slice(0, 32)}`;
  return {
    schema: INTEGRATION_READINESS_SCHEMA,
    domain: INTEGRATION_READINESS_DOMAIN,
    readinessId,
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedExpiresAt,
    input: { ...input, inputHash },
    inspection: checked,
    issuer: normalizedIssuer,
    keyId: normalizedKeyId,
    algorithm: "Ed25519",
    keyRegistry,
    payment,
    workflow: workflow({ chainId: normalizedChainId, subjectAddress: normalizedAddress, keyRegistryUrl: keyRegistry.url }),
    limitations: [
      "This is a read-only point-in-time check of public chain configuration and bytecode presence; it does not submit transactions or custody keys.",
      "EOA or CONTRACT describes only whether eth_getCode returned empty bytecode at the checked state. It does not prove address control, contract safety, ownership, authorization, or business suitability.",
      "A zero-address result is an integration smoke test only. Run a separate report for the public target you actually intend to integrate.",
      "Verify this signature with the issuer key from the published key registry and apply independent RPC and security review before relying on the result."
    ]
  };
}
function signIntegrationReadiness(report, privateKeyPem) {
  return signEd25519Statement(report, privateKeyPem);
}
function verifyIntegrationReadiness(value, publicKeyPem) {
  if (!value || value.schema !== INTEGRATION_READINESS_SCHEMA || value.domain !== INTEGRATION_READINESS_DOMAIN || value.algorithm !== "Ed25519") return false;
  return verifyEd25519Statement(value, publicKeyPem);
}
export {
  INTEGRATION_READINESS_DOMAIN,
  INTEGRATION_READINESS_SCHEMA,
  buildIntegrationReadiness,
  signIntegrationReadiness,
  verifyIntegrationReadiness
};
