// Generated from verify-from-package-root.mts by npm run core:build. Do not edit directly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  verifyAuthorityDelegationChain,
  verifyReceiptV1Serialized,
  verifyReceiptWithDecisionV1
} from "agent-passport-system";
const PINNED = {
  receipt: {
    "did:example:agent\0key-1": "f80727401f51c1b7e41eeda7004b29aca9c9d7a017144c31f7370725514d6260",
    "did:example:boundary\0key-1": "6468a72acb50bf67fc180d0a092e22d1aa44a43268c8e2dc7b6302dc9199126c"
  },
  delegation: {
    "did:example:principal#key-1": "d69859e9701161194f0f583a2369d287ce895bf0e96b70db753b9e1e27b2bc94"
  },
  rootIssuer: "did:example:principal"
};
const resolveKey = (signer, keyId) => PINNED.receipt[`${signer}\0${keyId}`];
const dir = resolve(process.argv[2] ?? ".");
const read = (rel) => readFileSync(join(dir, rel), "utf8");
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
};
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keysOf = (o) => Object.keys(o).sort().join(",");
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseObject(text, label) {
  const value = JSON.parse(text);
  if (!isRecord(value)) throw new TypeError(`${label} must be a JSON object`);
  return value;
}
for (const line of read("MANIFEST.sha256").trim().split("\n")) {
  const [digest, rel] = line.split(/\s+/);
  check(`manifest ${rel}`, createHash("sha256").update(read(rel)).digest("hex") === digest);
}
const keys = parseObject(read("keys.json"), "keys.json");
check(
  "keys.json receipt signers equal the pinned keys",
  keys.receipt_signers.length === 2 && keys.receipt_signers.every((k) => PINNED.receipt[`${k.signer}\0${k.key_id}`] === k.public_key)
);
check(
  "keys.json delegation key equals the pinned key",
  keys.delegation_verification_methods.length === 1 && keys.delegation_verification_methods.every((k) => PINNED.delegation[k.verification_method] === k.public_key)
);
const cases = {};
for (const name of ["permit", "narrow", "deny", "expired"]) {
  const rawIntent = read(`cases/${name}/action-intent-receipt.json`);
  const rawDecision = read(`cases/${name}/policy-decision-receipt.json`);
  const intent = parseObject(rawIntent, `${name} intent`);
  const decision = parseObject(rawDecision, `${name} decision`);
  const evidence = parseObject(read(`cases/${name}/decision-evidence.json`), `${name} evidence`);
  const meta = parseObject(read(`cases/${name}/case.json`), `${name} metadata`);
  cases[name] = { decision, evidence };
  check(`${name}: intent receipt verifies from its committed bytes`, verifyReceiptV1Serialized(rawIntent, resolveKey).valid === true);
  check(`${name}: decision receipt verifies from its committed bytes`, verifyReceiptV1Serialized(rawDecision, resolveKey).valid === true);
  check(`${name}: intent receipt_type is aps:action-intent:v1`, intent.receipt_type === "aps:action-intent:v1");
  check(`${name}: intent issuer equals subject_agent`, intent.issuer === intent.subject_agent);
  check(`${name}: intent has no prev and no decision_ref`, !("prev" in intent) && !("decision_ref" in intent));
  check(
    `${name}: intent result is exactly the declared result`,
    sameJson(intent.result, { profile: "aps-action-intent-result-v1", status: "declared" })
  );
  check(`${name}: intent is signed by the agent`, intent.signatures.some((s) => s.signer === intent.subject_agent));
  check(`${name}: decision receipt_type is aps:policy-decision:v1`, decision.receipt_type === "aps:policy-decision:v1");
  check(`${name}: decision issuer is not the agent`, decision.issuer !== decision.subject_agent);
  check(`${name}: decision prev is the intent receipt_id`, decision.prev === intent.receipt_id);
  check(`${name}: decision_ref is present`, typeof decision.decision_ref === "string");
  check(
    `${name}: both receipts name one agent, action_ref and delegation_ref`,
    decision.subject_agent === intent.subject_agent && decision.action_ref === intent.action_ref && decision.delegation_ref === intent.delegation_ref
  );
  check(`${name}: decision is issued after the intent`, Date.parse(decision.issued_at) > Date.parse(intent.issued_at));
  check(`${name}: decision result equals decision_evidence.decision_output`, sameJson(decision.result, evidence.decision_output));
  check(`${name}: decision verdict is ${name === "expired" ? "permit" : name}`, decision.result.verdict === (name === "expired" ? "permit" : name));
  check(
    `${name}: authority_state has the four required members`,
    keysOf(evidence.authority_state) === "authority_basis,revocation_observations,selected_chain,spend_state"
  );
  const want = meta.expected.verifyReceiptWithDecisionV1;
  const got = verifyReceiptWithDecisionV1(decision, evidence, resolveKey);
  check(`${name}: composite valid is ${want.valid}`, got.valid === want.valid);
  check(`${name}: decision_ref_bound is ${want.decision_ref_bound}`, got.decision_ref_bound === want.decision_ref_bound);
  check(`${name}: errors are ${JSON.stringify(want.errors)}`, sameJson(got.errors, want.errors), JSON.stringify(got.errors));
  const chain = evidence.authority_state.selected_chain;
  const chainResult = verifyAuthorityDelegationChain(chain, {
    now: decision.issued_at,
    resolveVerificationKey: (_issuer, method) => PINNED.delegation[method] ?? null,
    trustRoot: (candidate) => candidate.issuer === PINNED.rootIssuer,
    resolveRevocation: () => "active"
  });
  check(`${name}: selected delegation chain verifies at the decision time`, chainResult.valid === true, JSON.stringify(chainResult.failures));
  const leaf = chain[chain.length - 1];
  check(
    `${name}: delegation_ref is the leaf delegation_id and the leaf subject is the agent`,
    leaf.delegation_id === decision.delegation_ref && leaf.subject === decision.subject_agent
  );
  const validUntil = evidence.decision_output.valid_until;
  const unexpired = validUntil === null ? null : Date.parse(validUntil) > Date.parse(keys.reference_time);
  check(`${name}: unexpired at reference time is ${meta.expected.unexpired_at_reference_time}`, unexpired === meta.expected.unexpired_at_reference_time);
}
function checkedCase(name) {
  const value = cases[name];
  if (!value) throw new Error(`missing checked case: ${name}`);
  return value;
}
const permit = checkedCase("permit");
const narrow = checkedCase("narrow");
const noKey = verifyReceiptWithDecisionV1(permit.decision, permit.evidence, () => void 0);
check("negative: unresolved key fails at receipt_invalid", noKey.valid === false && noKey.errors[0] === "receipt_invalid");
const wrongKey = verifyReceiptWithDecisionV1(permit.decision, permit.evidence, () => PINNED.receipt["did:example:agent\0key-1"]);
check("negative: the agent key does not verify a boundary signature", wrongKey.valid === false && wrongKey.errors[0] === "receipt_invalid");
const swapped = verifyReceiptWithDecisionV1(narrow.decision, permit.evidence, resolveKey);
check("negative: evidence from another case fails at decision_ref_mismatch", swapped.valid === false && swapped.errors.includes("decision_ref_mismatch"));
const cleanRaw = read("cases/permit/policy-decision-receipt.json");
const HEAD = '{\n  "profile": "aps-receipt-v1",\n';
const dupRaw = HEAD + '  "profile": "aps-receipt-v1",\n' + cleanRaw.slice(HEAD.length);
const occurrences = (text) => text.split('"profile": "aps-receipt-v1"').length - 1;
check(
  "negative setup: the clean receipt opens with its profile, and the mutation adds exactly one top-level copy",
  cleanRaw.startsWith(HEAD) && occurrences(cleanRaw) === 1 && occurrences(dupRaw) === 2 && dupRaw.length === cleanRaw.length + '  "profile": "aps-receipt-v1",\n'.length
);
const dup = verifyReceiptV1Serialized(dupRaw, resolveKey);
check("negative: a duplicated top-level member in the bytes fails at parse_error", dup.valid === false && dup.errors[0] === "parse_error", JSON.stringify(dup.errors));
const refs = new Set(Object.values(cases).map((c) => c?.decision.decision_ref));
check("the four decision_ref values are distinct", refs.size === 4);
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
