import assert from "node:assert/strict";
import test from "node:test";

import {
	createWalletGuardedAction,
	summarizeWalletGuardedAction,
	transitionWalletGuardedAction,
} from "../../sdk/dist/index.js";

function authorizationFor(intentId: string) {
	return {
		accepted: {
			authorization: {
				authorizationId: "auth_guarded_action",
				intent: { intentId, chainId: 8453 },
				principal: { account: "0x1111111111111111111111111111111111111111" },
				expiresAt: 1_900_000_000,
			},
		},
		authorizationWindow: { active: true, checkedAt: 1_800_000_000 },
	} as never;
}

test("wallet guarded action makes the risk-to-receipt path explicit", () => {
	let action = createWalletGuardedAction({
		actionId: "action_guarded_001",
		intentId: "intent_guarded_action",
		chainId: 8453,
	});
	action = transitionWalletGuardedAction(action, {
		type: "RISK_EVALUATED",
		verdict: "ALLOW",
		decisionId: "insight_decision_001",
		at: 1_800_000_000_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "AUTHORIZATION_PREPARED",
		at: 1_800_000_001_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "AUTHORIZATION_SIGNATURE_REQUESTED",
		at: 1_800_000_002_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "AUTHORIZATION_ACCEPTED",
		result: authorizationFor("intent_guarded_action"),
		at: 1_800_000_003_000,
	});
	assert.equal(action.state, "AUTHORIZED");
	assert.equal(summarizeWalletGuardedAction(action).maySubmit, true);

	action = transitionWalletGuardedAction(action, {
		type: "SUBMISSION_RECORDED",
		txHash: `0x${"ab".repeat(32)}`,
		at: 1_800_000_004_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "OBSERVATION_STARTED",
		at: 1_800_000_005_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "OBSERVATION_RECORDED",
		result: {
			observation: { status: "CONFIRMED", txHash: `0x${"ab".repeat(32)}` },
			receipt: { receiptId: "receipt_guarded_001" },
		} as never,
		at: 1_800_000_006_000,
	});
	assert.equal(action.state, "OBSERVED");
	action = transitionWalletGuardedAction(action, {
		type: "VERIFICATION_RECORDED",
		receiptId: "receipt_guarded_001",
		valid: true,
		at: 1_800_000_007_000,
	});
	assert.equal(action.state, "VERIFIED");
	assert.equal(summarizeWalletGuardedAction(action).terminal, true);
	assert.equal(action.history.length, 8);
});

test("a BLOCK cannot reach a wallet signature or submission", () => {
	let action = createWalletGuardedAction({
		actionId: "action_guarded_002",
		intentId: "intent_guarded_blocked",
		chainId: 8453,
	});
	action = transitionWalletGuardedAction(action, {
		type: "RISK_EVALUATED",
		verdict: "BLOCK",
	});
	assert.equal(action.state, "RISK_BLOCKED");
	assert.throws(
		() =>
			transitionWalletGuardedAction(action, { type: "AUTHORIZATION_PREPARED" }),
		/not allowed/,
	);
});

test("an unknown outcome only permits observation of the original transaction", () => {
	let action = createWalletGuardedAction({
		actionId: "action_guarded_003",
		intentId: "intent_guarded_unknown",
		chainId: 8453,
	});
	action = transitionWalletGuardedAction(action, {
		type: "RISK_EVALUATED",
		verdict: "CAUTION",
		at: 1_800_000_000_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "AUTHORIZATION_PREPARED",
		at: 1_800_000_001_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "AUTHORIZATION_ACCEPTED",
		result: authorizationFor("intent_guarded_unknown"),
		at: 1_800_000_003_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "SUBMISSION_RECORDED",
		txHash: `0x${"cd".repeat(32)}`,
		at: 1_800_000_004_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "OBSERVATION_STARTED",
		at: 1_800_000_005_000,
	});
	action = transitionWalletGuardedAction(action, {
		type: "OBSERVATION_RECORDED",
		result: {
			observation: { status: "RPC_TIMEOUT", txHash: `0x${"cd".repeat(32)}` },
			receipt: null,
		} as never,
		at: 1_800_000_006_000,
	});
	assert.equal(action.state, "UNKNOWN");
	assert.equal(summarizeWalletGuardedAction(action).maySubmit, false);
	assert.equal(summarizeWalletGuardedAction(action).mayObserve, true);
	assert.throws(
		() =>
			transitionWalletGuardedAction(action, {
				type: "SUBMISSION_RECORDED",
				txHash: `0x${"ef".repeat(32)}`,
			}),
		/not allowed/,
	);
	assert.equal(
		transitionWalletGuardedAction(action, { type: "OBSERVATION_STARTED" })
			.state,
		"OBSERVING",
	);
});
