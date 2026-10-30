import type {
	AuthorizationFlowResult,
	ExecutionStatus,
	ObservationResult,
} from "./types.js";

/**
 * A serializable view of a single wallet- or agent-mediated action. It makes
 * the hand-off between assessment, authorization, submission, observation,
 * and verification explicit without ever acquiring a wallet or executor key.
 */
export const WALLET_GUARDED_ACTION_SCHEMA =
	"priorseal.wallet-guarded-action.v1" as const;

export type WalletGuardedActionState =
	| "AWAITING_RISK"
	| "RISK_BLOCKED"
	| "RISK_CLEARED"
	| "PREPARED"
	| "AWAITING_AUTHORIZATION_SIGNATURE"
	| "AUTHORIZED"
	| "SUBMITTED"
	| "OBSERVING"
	| "OBSERVED"
	| "VERIFIED"
	| "UNKNOWN"
	| "FAILED"
	| "CANCELLED";

export type WalletGuardRiskVerdict = "ALLOW" | "CAUTION" | "BLOCK";

export type WalletGuardedAction = {
	schema: typeof WALLET_GUARDED_ACTION_SCHEMA;
	actionId: string;
	intentId: string;
	chainId: number;
	state: WalletGuardedActionState;
	risk: {
		verdict: WalletGuardRiskVerdict;
		decisionId: string | null;
		assessedAt: number;
	} | null;
	authorization: {
		authorizationId: string;
		account: string;
		expiresAt: number;
		acceptedAt: number;
	} | null;
	submission: { txHash: string; submittedAt: number } | null;
	observation: {
		status: ExecutionStatus;
		receiptId: string | null;
		observedAt: number;
	} | null;
	verification: { receiptId: string; verifiedAt: number } | null;
	history: WalletGuardedActionTransition[];
};

export type WalletGuardedActionTransition = {
	event: WalletGuardedActionEvent["type"];
	from: WalletGuardedActionState;
	to: WalletGuardedActionState;
	at: number;
};

export type WalletGuardedActionEvent =
	| {
			type: "RISK_EVALUATED";
			verdict: WalletGuardRiskVerdict;
			decisionId?: string;
			at?: number;
	  }
	| { type: "AUTHORIZATION_PREPARED"; at?: number }
	| { type: "AUTHORIZATION_SIGNATURE_REQUESTED"; at?: number }
	| {
			type: "AUTHORIZATION_ACCEPTED";
			result: AuthorizationFlowResult;
			at?: number;
	  }
	| { type: "SUBMISSION_RECORDED"; txHash: string; at?: number }
	| { type: "OBSERVATION_STARTED"; at?: number }
	| { type: "OBSERVATION_RECORDED"; result: ObservationResult; at?: number }
	| {
			type: "VERIFICATION_RECORDED";
			receiptId: string;
			valid: boolean;
			at?: number;
	  }
	| { type: "FAILED"; at?: number }
	| { type: "CANCELLED"; at?: number };

export type WalletGuardedActionSummary = {
	state: WalletGuardedActionState;
	title: string;
	detail: string;
	nextStep: string;
	terminal: boolean;
	maySubmit: boolean;
	mayObserve: boolean;
};

const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** Create a new action record. No transaction, signing request, or network call occurs here. */
export function createWalletGuardedAction(input: {
	actionId: string;
	intentId: string;
	chainId: number;
}): WalletGuardedAction {
	if (typeof input.actionId !== "string" || !ACTION_ID.test(input.actionId))
		throw new TypeError("actionId must be 3–128 safe identifier characters");
	if (typeof input.intentId !== "string" || !ACTION_ID.test(input.intentId))
		throw new TypeError("intentId must be 3–128 safe identifier characters");
	if (!Number.isSafeInteger(input.chainId) || input.chainId < 1)
		throw new TypeError("chainId must be a positive safe integer");
	return {
		schema: WALLET_GUARDED_ACTION_SCHEMA,
		actionId: input.actionId,
		intentId: input.intentId,
		chainId: input.chainId,
		state: "AWAITING_RISK",
		risk: null,
		authorization: null,
		submission: null,
		observation: null,
		verification: null,
		history: [],
	};
}

/**
 * Applies one safe state transition to an immutable action record.
 * In particular, UNKNOWN never returns to a submission-ready state: reconcile
 * the original transaction by observing it again instead of broadcasting a
 * replacement transaction.
 */
export function transitionWalletGuardedAction(
	action: WalletGuardedAction,
	event: WalletGuardedActionEvent,
): WalletGuardedAction {
	assertAction(action);
	const at = event.at ?? Date.now();
	if (!Number.isSafeInteger(at) || at < 0)
		throw new TypeError("event time must be a non-negative safe integer");
	const next = structuredClone(action);
	const from = action.state;
	let to: WalletGuardedActionState;

	switch (event.type) {
		case "RISK_EVALUATED": {
			requireState(action, ["AWAITING_RISK"], event.type);
			if (!["ALLOW", "CAUTION", "BLOCK"].includes(event.verdict))
				throw new TypeError("risk verdict must be ALLOW, CAUTION, or BLOCK");
			if (
				event.decisionId !== undefined &&
				(typeof event.decisionId !== "string" || event.decisionId.length > 256)
			)
				throw new TypeError("decisionId must be a string up to 256 characters");
			next.risk = {
				verdict: event.verdict,
				decisionId: event.decisionId ?? null,
				assessedAt: at,
			};
			to = event.verdict === "BLOCK" ? "RISK_BLOCKED" : "RISK_CLEARED";
			break;
		}
		case "AUTHORIZATION_PREPARED":
			requireState(action, ["RISK_CLEARED"], event.type);
			to = "PREPARED";
			break;
		case "AUTHORIZATION_SIGNATURE_REQUESTED":
			requireState(action, ["PREPARED"], event.type);
			to = "AWAITING_AUTHORIZATION_SIGNATURE";
			break;
		case "AUTHORIZATION_ACCEPTED": {
			requireState(
				action,
				["PREPARED", "AWAITING_AUTHORIZATION_SIGNATURE"],
				event.type,
			);
			const authorization = event.result?.accepted?.authorization;
			const acceptedAt = event.result?.authorizationWindow?.checkedAt;
			if (!authorization || typeof acceptedAt !== "number")
				throw new TypeError("authorization result is incomplete");
			if (
				authorization.intent.intentId !== action.intentId ||
				Number(authorization.intent.chainId) !== action.chainId
			)
				throw new TypeError(
					"accepted authorization does not match this action intent or chain",
				);
			if (!/^0x[0-9a-fA-F]{40}$/.test(authorization.principal.account))
				throw new TypeError(
					"accepted authorization has an invalid principal account",
				);
			if (
				!Number.isSafeInteger(authorization.expiresAt) ||
				authorization.expiresAt < 0
			)
				throw new TypeError("accepted authorization has an invalid expiry");
			next.authorization = {
				authorizationId: authorization.authorizationId,
				account: authorization.principal.account.toLowerCase(),
				expiresAt: authorization.expiresAt,
				acceptedAt,
			};
			to = event.result.authorizationWindow.active ? "AUTHORIZED" : "UNKNOWN";
			break;
		}
		case "SUBMISSION_RECORDED":
			requireState(action, ["AUTHORIZED"], event.type);
			if (!TX_HASH.test(event.txHash))
				throw new TypeError("txHash must be a 32-byte transaction hash");
			if (
				!action.authorization ||
				action.authorization.expiresAt <= Math.floor(at / 1000)
			)
				throw new TypeError(
					"an active authorization is required before recording submission",
				);
			next.submission = { txHash: event.txHash.toLowerCase(), submittedAt: at };
			to = "SUBMITTED";
			break;
		case "OBSERVATION_STARTED":
			requireState(action, ["SUBMITTED", "UNKNOWN"], event.type);
			if (!action.submission)
				throw new TypeError(
					"an original submission is required before observation",
				);
			to = "OBSERVING";
			break;
		case "OBSERVATION_RECORDED": {
			requireState(action, ["OBSERVING"], event.type);
			if (!action.submission)
				throw new TypeError(
					"an original submission is required before recording observation",
				);
			const execution = event.result?.observation;
			if (!execution || !isExecutionStatus(execution.status))
				throw new TypeError(
					"observation result has an invalid execution status",
				);
			if (
				execution.txHash &&
				execution.txHash.toLowerCase() !== action.submission.txHash
			)
				throw new TypeError(
					"observation transaction hash does not match the original submission",
				);
			const receiptId = event.result.receipt?.receiptId ?? null;
			next.observation = {
				status: execution.status,
				receiptId,
				observedAt: at,
			};
			to =
				execution.status === "CONFIRMED"
					? "OBSERVED"
					: execution.status === "REVERTED"
						? "FAILED"
						: execution.status === "PENDING"
							? "OBSERVING"
							: "UNKNOWN";
			break;
		}
		case "VERIFICATION_RECORDED":
			requireState(action, ["OBSERVED"], event.type);
			if (
				typeof event.receiptId !== "string" ||
				event.receiptId.length < 1 ||
				event.receiptId.length > 256
			)
				throw new TypeError(
					"receiptId must be a non-empty string up to 256 characters",
				);
			if (event.receiptId !== action.observation?.receiptId)
				throw new TypeError(
					"verification receipt does not match the observed receipt",
				);
			if (typeof event.valid !== "boolean")
				throw new TypeError("verification result must be boolean");
			if (event.valid)
				next.verification = { receiptId: event.receiptId, verifiedAt: at };
			to = event.valid ? "VERIFIED" : "FAILED";
			break;
		case "FAILED":
			requireState(
				action,
				[
					"AWAITING_RISK",
					"RISK_CLEARED",
					"PREPARED",
					"AWAITING_AUTHORIZATION_SIGNATURE",
					"AUTHORIZED",
					"SUBMITTED",
					"OBSERVING",
					"OBSERVED",
				],
				event.type,
			);
			to = "FAILED";
			break;
		case "CANCELLED":
			requireState(
				action,
				[
					"AWAITING_RISK",
					"RISK_CLEARED",
					"PREPARED",
					"AWAITING_AUTHORIZATION_SIGNATURE",
					"AUTHORIZED",
				],
				event.type,
			);
			to = "CANCELLED";
			break;
		default:
			return assertNever(event);
	}

	next.state = to;
	next.history.push({ event: event.type, from, to, at });
	return next;
}

/** A presentation-safe action card model for wallets and Agent UIs. */
export function summarizeWalletGuardedAction(
	action: WalletGuardedAction,
): WalletGuardedActionSummary {
	assertAction(action);
	const entries: Record<
		WalletGuardedActionState,
		Omit<WalletGuardedActionSummary, "state">
	> = {
		AWAITING_RISK: {
			title: "Risk assessment required",
			detail:
				"Do not request a signature or submit a transaction before the decision input is assessed.",
			nextStep: "Assess the exact proposed action.",
			terminal: false,
			maySubmit: false,
			mayObserve: false,
		},
		RISK_BLOCKED: {
			title: "Risk blocked",
			detail:
				"The risk decision blocked this action. No authorization or transaction may be created from this record.",
			nextStep: "Stop and present the risk reason.",
			terminal: true,
			maySubmit: false,
			mayObserve: false,
		},
		RISK_CLEARED: {
			title: "Risk cleared for review",
			detail:
				"The action may be prepared for principal review; this is not transaction permission.",
			nextStep: "Prepare the bounded authorization.",
			terminal: false,
			maySubmit: false,
			mayObserve: false,
		},
		PREPARED: {
			title: "Authorization prepared",
			detail: "Canonical fields are ready to show the principal.",
			nextStep: "Request an authorization signature.",
			terminal: false,
			maySubmit: false,
			mayObserve: false,
		},
		AWAITING_AUTHORIZATION_SIGNATURE: {
			title: "Awaiting authorization signature",
			detail: "Only the principal may approve the bounded authorization.",
			nextStep: "Wait for the wallet response.",
			terminal: false,
			maySubmit: false,
			mayObserve: false,
		},
		AUTHORIZED: {
			title: "Authorized",
			detail:
				"A bounded authorization was accepted. Transaction submission remains a separate, single action.",
			nextStep: "Submit the exact approved transaction once.",
			terminal: false,
			maySubmit: true,
			mayObserve: false,
		},
		SUBMITTED: {
			title: "Submitted",
			detail:
				"The original transaction hash is recorded. Do not submit a replacement while the outcome is unresolved.",
			nextStep: "Observe the original transaction.",
			terminal: false,
			maySubmit: false,
			mayObserve: true,
		},
		OBSERVING: {
			title: "Observing execution",
			detail:
				"PriorSeal is reconciling the original transaction and authorization.",
			nextStep: "Wait for a terminal observation.",
			terminal: false,
			maySubmit: false,
			mayObserve: true,
		},
		OBSERVED: {
			title: "Execution observed",
			detail:
				"The original transaction was confirmed and has a receipt to verify.",
			nextStep: "Verify the receipt independently.",
			terminal: false,
			maySubmit: false,
			mayObserve: false,
		},
		VERIFIED: {
			title: "Receipt verified",
			detail: "The observed receipt passed the recorded verification step.",
			nextStep:
				"Archive or provide the receipt to the intended evidence consumer.",
			terminal: true,
			maySubmit: false,
			mayObserve: false,
		},
		UNKNOWN: {
			title: "Outcome unknown",
			detail:
				"Do not resubmit. Reconcile the original transaction hash until its outcome is known.",
			nextStep: "Observe the original transaction again.",
			terminal: false,
			maySubmit: false,
			mayObserve: true,
		},
		FAILED: {
			title: "Action failed",
			detail: "The guarded action did not complete as a verified execution.",
			nextStep: "Review the recorded evidence before proposing a new action.",
			terminal: true,
			maySubmit: false,
			mayObserve: false,
		},
		CANCELLED: {
			title: "Action cancelled",
			detail: "No transaction was recorded from this guarded action.",
			nextStep: "Create a new action only if the principal wants to continue.",
			terminal: true,
			maySubmit: false,
			mayObserve: false,
		},
	};
	return { state: action.state, ...entries[action.state] };
}

function assertAction(action: WalletGuardedAction): void {
	if (
		!action ||
		action.schema !== WALLET_GUARDED_ACTION_SCHEMA ||
		!ACTION_ID.test(action.actionId) ||
		!ACTION_ID.test(action.intentId) ||
		!Number.isSafeInteger(action.chainId) ||
		action.chainId < 1 ||
		!Array.isArray(action.history)
	)
		throw new TypeError("wallet guarded action is malformed");
}

function requireState(
	action: WalletGuardedAction,
	allowed: WalletGuardedActionState[],
	event: string,
): void {
	if (!allowed.includes(action.state))
		throw new TypeError(`${event} is not allowed from ${action.state}`);
}

function isExecutionStatus(value: unknown): value is ExecutionStatus {
	return (
		typeof value === "string" &&
		[
			"PENDING",
			"CONFIRMED",
			"REVERTED",
			"REORGED",
			"NOT_FOUND",
			"RPC_ERROR",
			"RPC_TIMEOUT",
			"UNSUPPORTED_CHAIN",
		].includes(value)
	);
}

function assertNever(value: never): never {
	throw new TypeError(`Unknown wallet guard event: ${String(value)}`);
}
