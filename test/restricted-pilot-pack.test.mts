import test from "node:test";
import assert from "node:assert/strict";
import { validateRestrictedPilotScope } from "../scripts/restricted-pilot-pack-validation.mjs";

function completeScope(): Record<string, unknown> {
  return {
    schema: "priorseal.restricted-automation-pilot-scope.v1",
    pilotId: "acme-staging-2026-10",
    testOnly: true,
    operation: {
      chainId: 84532,
      executionProfile: "priorseal.execution-profile.exact-call.v1",
      action: "CONTRACT_CALL",
      executor: "0x1111111111111111111111111111111111111111",
      callTarget: "0x2222222222222222222222222222222222222222",
      calldataHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      routerCodeHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      maxNativeValue: "0",
      validityMaxSeconds: 900,
    },
    roles: {
      authorizer: "authorization-control-owner",
      executorOwner: "node-execution-owner",
      evidenceOwner: "evidence-control-owner",
      independentReviewer: "external-assurance-reviewer",
      recoveryOwner: "incident-recovery-owner",
    },
    durability: {
      store: "POSTGRES",
      sharedSignerScope: "staging-shared-signer-a",
      recoveryProcedure: "runbook-recovery-v1",
    },
    evidence: {
      audience: "priorseal-staging-review",
      issuerKeyId: "issuer-kid-staging-01",
      retentionDays: 365,
      deliveryReference: "customer-controlled-record-001",
    },
    requiredChecks: {
      exactAuthorizedOperation: true,
      changedRecipientRejected: true,
      replayRejected: true,
      crossRouteNonceRejected: true,
      routerMutationRejected: true,
      uncertainAttemptRecovered: true,
      externalVerificationCompleted: true,
    },
  };
}

test("restricted pilot scope accepts a complete test-only staging record", () => {
  assert.deepEqual(validateRestrictedPilotScope(completeScope()), {
    valid: true,
    codes: [],
  });
});

test("restricted pilot scope rejects placeholders and a non-distinct reviewer", () => {
  const scope = completeScope() as {
    roles: Record<string, unknown>;
    evidence: Record<string, unknown>;
  };
  scope.roles.independentReviewer = "evidence-control-owner";
  scope.evidence.issuerKeyId = "<replace-with-key-id>";

  const result = validateRestrictedPilotScope(scope);
  assert.equal(result.valid, false);
  assert.ok(result.codes.includes("INDEPENDENT_REVIEWER_NOT_DISTINCT"));
  assert.ok(result.codes.includes("EVIDENCE_ISSUER_KEY_ID_INVALID"));
});

test("restricted pilot scope requires an exact calldata commitment and a distinct authorizer", () => {
  const scope = completeScope() as {
    operation: Record<string, unknown>;
    roles: Record<string, unknown>;
  };
  scope.operation.calldataHash = "0x1234";
  scope.roles.authorizer = "node-execution-owner";

  const result = validateRestrictedPilotScope(scope);
  assert.equal(result.valid, false);
  assert.ok(result.codes.includes("CALLDATA_HASH_INVALID"));
  assert.ok(result.codes.includes("AUTHORIZER_NOT_DISTINCT_FROM_EXECUTOR"));
});

test("restricted pilot scope rejects a placeholder pilot identifier", () => {
  const scope = completeScope();
  scope.pilotId = "replace-with-private-pilot-id";

  const result = validateRestrictedPilotScope(scope);
  assert.equal(result.valid, false);
  assert.ok(result.codes.includes("PILOT_ID_INVALID"));
});
