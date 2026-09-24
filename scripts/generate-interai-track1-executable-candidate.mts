import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
	type Address,
	createPublicClient,
	encodeFunctionData,
	formatEther,
	formatUnits,
	getAddress,
	type Hex,
	hashTypedData,
	http,
	isAddress,
	keccak256,
	recoverTypedDataAddress,
} from "viem";
import { baseSepolia } from "viem/chains";

const CHAIN_ID = 84_532;
const RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const EXECUTOR: Address = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const ROUTER: Address = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const QUOTER: Address = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";
const FACTORY: Address = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
const WETH: Address = "0x4200000000000000000000000000000000000006";
const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const WETH_ID = `eip155:${CHAIN_ID}/erc20:${WETH}`;
const USDC_ID = `eip155:${CHAIN_ID}/erc20:${USDC}`;
const FEE = 3_000;
const AMOUNT_IN = 1_000_000_000_000_000n;
const DECLARED_AMOUNT_USD = 4;
const MAX_SLIPPAGE_BPS = 500n;
const QUOTE_VALID_FOR_SECONDS = 60;
const MIN_ASSERTION_REMAINING_SECONDS = 180;

const EXACT_INPUT_SINGLE_ABI = [
	{
		type: "function",
		name: "exactInputSingle",
		stateMutability: "payable",
		inputs: [
			{
				name: "params",
				type: "tuple",
				components: [
					{ name: "tokenIn", type: "address" },
					{ name: "tokenOut", type: "address" },
					{ name: "fee", type: "uint24" },
					{ name: "recipient", type: "address" },
					{ name: "amountIn", type: "uint256" },
					{ name: "amountOutMinimum", type: "uint256" },
					{ name: "sqrtPriceLimitX96", type: "uint160" },
				],
			},
		],
		outputs: [{ name: "amountOut", type: "uint256" }],
	},
] as const;

const QUOTER_ABI = [
	{
		type: "function",
		name: "quoteExactInputSingle",
		stateMutability: "nonpayable",
		inputs: [
			{
				name: "params",
				type: "tuple",
				components: [
					{ name: "tokenIn", type: "address" },
					{ name: "tokenOut", type: "address" },
					{ name: "amountIn", type: "uint256" },
					{ name: "fee", type: "uint24" },
					{ name: "sqrtPriceLimitX96", type: "uint160" },
				],
			},
		],
		outputs: [
			{ name: "amountOut", type: "uint256" },
			{ name: "sqrtPriceX96After", type: "uint160" },
			{ name: "initializedTicksCrossed", type: "uint32" },
			{ name: "gasEstimate", type: "uint256" },
		],
	},
] as const;

const FACTORY_ABI = [
	{
		type: "function",
		name: "getPool",
		stateMutability: "view",
		inputs: [
			{ name: "tokenA", type: "address" },
			{ name: "tokenB", type: "address" },
			{ name: "fee", type: "uint24" },
		],
		outputs: [{ name: "pool", type: "address" }],
	},
] as const;

const ERC20_ABI = [
	{
		type: "function",
		name: "balanceOf",
		stateMutability: "view",
		inputs: [{ name: "account", type: "address" }],
		outputs: [{ name: "balance", type: "uint256" }],
	},
	{
		type: "function",
		name: "allowance",
		stateMutability: "view",
		inputs: [
			{ name: "owner", type: "address" },
			{ name: "spender", type: "address" },
		],
		outputs: [{ name: "amount", type: "uint256" }],
	},
] as const;

interface Options {
	gateDir: string;
	allowanceRecord: string;
	output: string;
	archive: string;
	mode: "review" | "live";
}

interface GateEnvelope {
	uid: Hex;
	schemaVersion: number;
	attester: Address;
	signedAt: string;
	validForSeconds: number;
	validUntil: number;
	signature: Hex;
	data: Record<string, unknown>;
	eip712: {
		domain: Record<string, unknown>;
		types: Record<string, readonly { name: string; type: string }[]>;
		primaryType: string;
	};
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
	assert(
		typeof value === "object" && value !== null && !Array.isArray(value),
		`${label} must be an object`,
	);
	return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
	assert(typeof value === "string", `${label} must be a string`);
	return value;
}

function asNumber(value: unknown, label: string): number {
	assert(
		typeof value === "number" && Number.isFinite(value),
		`${label} must be a number`,
	);
	return value;
}

function parseArgs(argv: string[]): Options {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		assert(
			key?.startsWith("--") && value,
			`Invalid argument near ${key ?? "<end>"}`,
		);
		values.set(key, value);
	}
	const gateDir = values.get("--gate-dir");
	const allowanceRecord = values.get("--allowance-record");
	const output = values.get("--output");
	const archive = values.get("--archive");
	const mode = values.get("--mode") ?? "review";
	assert(
		gateDir && allowanceRecord && output && archive,
		"Required: --gate-dir --allowance-record --output --archive",
	);
	assert(mode === "review" || mode === "live", "Unsupported candidate mode");
	assert(
		values.size === 4 || (values.size === 5 && values.has("--mode")),
		"Unsupported arguments",
	);
	return {
		gateDir: path.resolve(gateDir),
		allowanceRecord: path.resolve(allowanceRecord),
		output: path.resolve(output),
		archive: path.resolve(archive),
		mode,
	};
}

function serialize(value: unknown): string {
	return `${JSON.stringify(value, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry), 2)}\n`;
}

function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(file: string): Promise<unknown> {
	return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function parseEnvelope(value: unknown, label: string): GateEnvelope {
	const root = asRecord(value, label);
	const data = asRecord(root.data, `${label}.data`);
	const eip712 = asRecord(root.eip712, `${label}.eip712`);
	const domain = asRecord(eip712.domain, `${label}.eip712.domain`);
	const rawTypes = asRecord(eip712.types, `${label}.eip712.types`);
	assert(
		/^0x[0-9a-fA-F]{64}$/.test(asString(root.uid, `${label}.uid`)),
		`${label}.uid is invalid`,
	);
	const attester = asString(root.attester, `${label}.attester`);
	assert(isAddress(attester), `${label}.attester is invalid`);
	assert(
		/^0x[0-9a-fA-F]{130}$/.test(asString(root.signature, `${label}.signature`)),
		`${label}.signature is invalid`,
	);
	const types: Record<string, readonly { name: string; type: string }[]> = {};
	for (const [name, fields] of Object.entries(rawTypes)) {
		assert(
			Array.isArray(fields),
			`${label}.eip712.types.${name} must be an array`,
		);
		types[name] = fields.map((field, index) => {
			const entry = asRecord(field, `${label}.eip712.types.${name}[${index}]`);
			return {
				name: asString(entry.name, "typed field name"),
				type: asString(entry.type, "typed field type"),
			};
		});
	}
	return {
		uid: root.uid as Hex,
		schemaVersion: asNumber(root.schemaVersion, `${label}.schemaVersion`),
		attester: getAddress(attester),
		signedAt: asString(root.signedAt, `${label}.signedAt`),
		validForSeconds: asNumber(root.validForSeconds, `${label}.validForSeconds`),
		validUntil: asNumber(root.validUntil, `${label}.validUntil`),
		signature: root.signature as Hex,
		data,
		eip712: {
			domain,
			types,
			primaryType: asString(eip712.primaryType, `${label}.eip712.primaryType`),
		},
	};
}

async function verifyEnvelope(
	envelope: GateEnvelope,
	label: "source" | "destination",
	expectedSource: string,
	expectedDestination: string,
	registry: Record<string, unknown>,
	now: number,
): Promise<void> {
	assert(envelope.schemaVersion === 3, `${label} assertion is not schema v3`);
	assert(
		envelope.eip712.primaryType === "OracleSafetyCheck",
		`${label} primary type mismatch`,
	);
	assert(envelope.data.verdict === "PASS", `${label} verdict is not PASS`);
	assert(
		envelope.data.sourceAssetId === expectedSource,
		`${label} source asset mismatch`,
	);
	assert(
		envelope.data.destinationAssetId === expectedDestination,
		`${label} destination asset mismatch`,
	);
	assert(
		envelope.data.subjectChainId === CHAIN_ID,
		`${label} subject chain mismatch`,
	);
	assert(envelope.data.action === "swap", `${label} action mismatch`);
	assert(
		envelope.data.tradeAmountUsd === DECLARED_AMOUNT_USD * 1_000_000,
		`${label} amount mismatch`,
	);
	assert(
		envelope.validForSeconds === 600,
		`${label} validity duration mismatch`,
	);
	assert(
		envelope.validUntil === envelope.data.validUntil,
		`${label} envelope/data expiry mismatch`,
	);
	assert(
		envelope.validUntil - now >= MIN_ASSERTION_REMAINING_SECONDS,
		`${label} assertion is not fresh enough`,
	);
	assert(
		asNumber(envelope.data.participantCount, `${label}.participantCount`) >=
			asNumber(
				envelope.data.requiredParticipantCount,
				`${label}.requiredParticipantCount`,
			),
		`${label} quorum failed`,
	);
	assert(
		asNumber(envelope.data.sourceGroupCount, `${label}.sourceGroupCount`) >=
			asNumber(
				envelope.data.requiredSourceGroupCount,
				`${label}.requiredSourceGroupCount`,
			),
		`${label} independence failed`,
	);
	const typedData = {
		domain: envelope.eip712.domain,
		types: envelope.eip712.types,
		primaryType: envelope.eip712.primaryType,
		message: envelope.data,
	} as Parameters<typeof hashTypedData>[0];
	assert(
		hashTypedData(typedData) === envelope.uid,
		`${label} UID does not match signed data`,
	);
	const recovered = await recoverTypedDataAddress({
		...typedData,
		signature: envelope.signature,
	} as Parameters<typeof recoverTypedDataAddress>[0]);
	assert(
		getAddress(recovered) === envelope.attester,
		`${label} signature recovery mismatch`,
	);

	const publicKeys = registry.public_keys;
	assert(Array.isArray(publicKeys), "registry public_keys must be an array");
	const key = publicKeys
		.map((entry, index) => asRecord(entry, `registry.public_keys[${index}]`))
		.find((entry) => {
			const publicKey =
				typeof entry.public_key === "string" ? entry.public_key : "";
			return (
				isAddress(publicKey) && getAddress(publicKey) === envelope.attester
			);
		});
	assert(key, `${label} signer is absent from registry`);
	assert(key.revoked === false, `${label} signer is revoked`);
	assert(key.role !== "sample", `${label} signer is sample-only`);
	const signedAt = Date.parse(envelope.signedAt);
	assert(Number.isFinite(signedAt), `${label}.signedAt is invalid`);
	assert(
		signedAt >= Date.parse(asString(key.validFrom, "registry key validFrom")),
		`${label} predates signer validity`,
	);
	assert(
		key.validUntil === null ||
			signedAt <=
				Date.parse(asString(key.validUntil, "registry key validUntil")),
		`${label} signer expired`,
	);
}

async function writePair(
	output: string,
	archive: string,
	name: string,
	bytes: Uint8Array | string,
): Promise<void> {
	await Promise.all([
		writeFile(path.join(output, name), bytes, { flag: "wx" }),
		writeFile(path.join(archive, name), bytes, { flag: "wx" }),
	]);
}

const options = parseArgs(process.argv.slice(2));
assert(
	options.output !== options.archive,
	"output and archive directories must differ",
);
await Promise.all([
	mkdir(options.output, { recursive: false, mode: 0o700 }),
	mkdir(options.archive, { recursive: false, mode: 0o700 }),
]);

const sourcePath = path.join(
	options.gateDir,
	"source-oracle-safety-check-v3.json",
);
const destinationPath = path.join(
	options.gateDir,
	"destination-oracle-safety-check-v3.json",
);
const registryPath = path.join(options.gateDir, "oracle-keys.json");
const currentPath = path.join(options.gateDir, "oracle-registry-current.json");
const auditPath = path.join(options.gateDir, "audit-persistence-proof.json");
const [
	sourceRaw,
	destinationRaw,
	registryRaw,
	currentRaw,
	auditRaw,
	allowanceRaw,
] = await Promise.all([
	readJson(sourcePath),
	readJson(destinationPath),
	readJson(registryPath),
	readJson(currentPath),
	readJson(auditPath),
	readJson(options.allowanceRecord),
]);
const source = parseEnvelope(sourceRaw, "source");
const destination = parseEnvelope(destinationRaw, "destination");
const registry = asRecord(registryRaw, "registry");
const current = asRecord(currentRaw, "registry current");
const audit = asRecord(auditRaw, "audit proof");
const allowanceRecord = asRecord(allowanceRaw, "allowance record");
const now = Math.floor(Date.now() / 1_000);
await Promise.all([
	verifyEnvelope(source, "source", WETH_ID, USDC_ID, registry, now),
	verifyEnvelope(destination, "destination", USDC_ID, WETH_ID, registry, now),
]);
assert(
	source.attester === destination.attester,
	"Source and destination use different signers",
);
assert(registry.attestation_enabled === true, "Registry signing is disabled");
const release = asRecord(registry.registryRelease, "registry release");
assert(
	release.releaseId === current.releaseId,
	"Registry release pointer mismatch",
);
assert(
	allowanceRecord.status === "EXACT_ALLOWANCE_ESTABLISHED",
	"Allowance record is not established",
);
assert(
	allowanceRecord.allowanceAfter === AMOUNT_IN.toString(),
	"Allowance record amount mismatch",
);

const persistedRows = audit.persistedRows;
assert(
	Array.isArray(persistedRows) && persistedRows.length === 2,
	"Audit proof must contain two rows",
);
for (const envelope of [source, destination]) {
	const row = persistedRows
		.map((entry, index) => asRecord(entry, `audit row ${index}`))
		.find((entry) => entry.attestation_uid === envelope.uid);
	assert(row, `Audit row missing for ${envelope.uid}`);
	assert(
		row.signed === true && row.verdict === "PASS" && row.schema_version === 3,
		`Audit row failed for ${envelope.uid}`,
	);
	assert(
		row.chain_id === CHAIN_ID &&
			Number(row.trade_amount_usd) === DECLARED_AMOUNT_USD,
		`Audit binding mismatch for ${envelope.uid}`,
	);
}

const client = createPublicClient({
	chain: baseSepolia,
	transport: http(RPC_URL, { timeout: 30_000 }),
});
const [
	chainId,
	block,
	pendingNonce,
	ethBalance,
	wethBalance,
	routerAllowance,
	pool,
	codes,
] = await Promise.all([
	client.getChainId(),
	client.getBlock({ blockTag: "latest" }),
	client.getTransactionCount({ address: EXECUTOR, blockTag: "pending" }),
	client.getBalance({ address: EXECUTOR }),
	client.readContract({
		address: WETH,
		abi: ERC20_ABI,
		functionName: "balanceOf",
		args: [EXECUTOR],
	}),
	client.readContract({
		address: WETH,
		abi: ERC20_ABI,
		functionName: "allowance",
		args: [EXECUTOR, ROUTER],
	}),
	client.readContract({
		address: FACTORY,
		abi: FACTORY_ABI,
		functionName: "getPool",
		args: [WETH, USDC, FEE],
	}),
	Promise.all(
		[ROUTER, QUOTER, FACTORY, WETH, USDC].map((address) =>
			client.getCode({ address }),
		),
	),
]);
assert(
	chainId === CHAIN_ID,
	`Expected Base Sepolia ${CHAIN_ID}, received ${chainId}`,
);
assert(
	codes.every((code) => code && code !== "0x"),
	"A pinned contract has no bytecode",
);
assert(
	pool !== "0x0000000000000000000000000000000000000000",
	"Pinned pool is absent",
);
assert(wethBalance >= AMOUNT_IN, "Executor WETH balance is insufficient");
assert(
	routerAllowance === AMOUNT_IN,
	"Router allowance is not the exact bounded amount",
);

const quoteResult = await client.simulateContract({
	account: EXECUTOR,
	address: QUOTER,
	abi: QUOTER_ABI,
	functionName: "quoteExactInputSingle",
	args: [
		{
			tokenIn: WETH,
			tokenOut: USDC,
			amountIn: AMOUNT_IN,
			fee: FEE,
			sqrtPriceLimitX96: 0n,
		},
	],
	blockNumber: block.number,
});
const [
	quotedAmountOut,
	sqrtPriceX96After,
	initializedTicksCrossed,
	quoteGasEstimate,
] = quoteResult.result;
const amountOutMinimum =
	(quotedAmountOut * (10_000n - MAX_SLIPPAGE_BPS)) / 10_000n;
assert(amountOutMinimum > 0n, "Quote is too small");
const swapParams = {
	tokenIn: WETH,
	tokenOut: USDC,
	fee: FEE,
	recipient: EXECUTOR,
	amountIn: AMOUNT_IN,
	amountOutMinimum,
	sqrtPriceLimitX96: 0n,
};
const calldata = encodeFunctionData({
	abi: EXACT_INPUT_SINGLE_ABI,
	functionName: "exactInputSingle",
	args: [swapParams],
});
const calldataHash = keccak256(calldata);
await client.call({
	account: EXECUTOR,
	to: ROUTER,
	data: calldata,
	value: 0n,
	blockNumber: block.number,
});

const generatedAt = Math.floor(Date.now() / 1_000);
const quoteExpiresAt = generatedAt + QUOTE_VALID_FOR_SECONDS;
const exactCall = {
	chainId: CHAIN_ID,
	sender: EXECUTOR,
	target: ROUTER,
	value: "0",
	calldataHash,
	nonce: String(pendingNonce),
};
const canonicalAction = {
	schema: "interai-canonical-action/v1",
	tool_id: "evm.wallet",
	type: "transaction",
	operation: "send_transaction",
	arguments: {
		chain_id: CHAIN_ID,
		sender: EXECUTOR,
		target: ROUTER,
		value: "0",
		nonce: String(pendingNonce),
		calldata,
		calldata_hash: calldataHash,
		amount_usd: DECLARED_AMOUNT_USD,
		currency: "USD",
	},
	external_side_effect: true,
	irreversible: true,
};

const sourceBytes = await readFile(sourcePath);
const destinationBytes = await readFile(destinationPath);
const binding = (
	role: "source" | "destination",
	envelope: GateEnvelope,
	assertionBytes: Uint8Array,
) => ({
	schema: "interai.track1.oracle-safety-evidence-binding.v1",
	role,
	assertionUid: envelope.uid,
	assertionSha256: sha256(assertionBytes),
	requestHash: envelope.data.requestHash,
	exactCall,
	exactCalldata: calldata,
	economicDeclaration: { amount_usd: DECLARED_AMOUNT_USD, currency: "USD" },
});
const sourceBinding = binding("source", source, sourceBytes);
const destinationBinding = binding(
	"destination",
	destination,
	destinationBytes,
);
const sourceBindingBytes = serialize(sourceBinding);
const destinationBindingBytes = serialize(destinationBinding);

const packageDocument = {
	schema:
		options.mode === "live"
			? "interai.track1.jit-direct-verify-candidate-package.v1"
			: "interai.track1.final-binding-review-candidate-package.v1",
	packageId: `interai-track1-base-sepolia-${generatedAt}`,
	generatedAt,
	generatedAtIso: new Date(generatedAt * 1_000).toISOString(),
	purpose:
		options.mode === "live"
			? "JIT_HOST_CHECK_BEFORE_SINGLE_DIRECT_NON_BROADCAST_AUTHENTICATED_VERIFY"
			: "FINAL_BINDING_REVIEW_BEFORE_SINGLE_NON_BROADCAST_AUTHENTICATED_PREFLIGHT",
	hostPrerequisiteDisposition: "SATISFIED_AT_GENERATION",
	executionAuthorization: "INTERAI_EXECUTABLE_ALLOW_NOT_ESTABLISHED",
	network: {
		name: "Base Sepolia",
		chainId: CHAIN_ID,
		rpc: RPC_URL,
		quoteBlockNumber: block.number.toString(),
		quoteBlockHash: block.hash,
		quoteBlockTimestamp: Number(block.timestamp),
	},
	canonicalAction,
	interaiSixFieldProjection: exactCall,
	swap: {
		method: "exactInputSingle",
		tokenIn: WETH,
		tokenOut: USDC,
		fee: FEE,
		recipient: EXECUTOR,
		amountIn: AMOUNT_IN.toString(),
		amountInDisplay: `${formatUnits(AMOUNT_IN, 18)} WETH`,
		amountOutMinimum: amountOutMinimum.toString(),
		amountOutMinimumDisplay: `${formatUnits(amountOutMinimum, 6)} USDC`,
		maxSlippageBps: Number(MAX_SLIPPAGE_BPS),
	},
	quote: {
		venue: "Uniswap V3 QuoterV2",
		quoter: QUOTER,
		factory: FACTORY,
		pool,
		quotedAmountOut: quotedAmountOut.toString(),
		quotedAmountOutDisplay: `${formatUnits(quotedAmountOut, 6)} USDC`,
		sqrtPriceX96After: sqrtPriceX96After.toString(),
		initializedTicksCrossed,
		gasEstimate: quoteGasEstimate.toString(),
		observedAt: generatedAt,
		expiresAt: quoteExpiresAt,
		validForSeconds: QUOTE_VALID_FOR_SECONDS,
	},
	executorReadiness: {
		ethBalanceWei: ethBalance.toString(),
		ethBalanceDisplay: `${formatEther(ethBalance)} ETH`,
		wethBalance: wethBalance.toString(),
		routerAllowance: routerAllowance.toString(),
		requiredRouterAllowance: AMOUNT_IN.toString(),
		exactAllowance: true,
		exactCallSimulationAtQuoteBlock: "PASS",
	},
	oracleSafetyCheckV3: {
		signer: source.attester,
		source: {
			uid: source.uid,
			validUntil: source.validUntil,
			file: "source-oracle-safety-check-v3.json",
			bindingFile: "source-evidence-binding.json",
		},
		destination: {
			uid: destination.uid,
			validUntil: destination.validUntil,
			file: "destination-oracle-safety-check-v3.json",
			bindingFile: "destination-evidence-binding.json",
		},
		auditPersistenceProof: "audit-persistence-proof.json",
	},
	trustRoots: {
		registryReleaseId: current.releaseId,
		oracleKeys: "oracle-keys.json",
		currentPointer: "oracle-registry-current.json",
	},
	allowancePrerequisite: {
		record: "allowance-receipt.json",
		transaction: asRecord(allowanceRecord.transaction, "allowance transaction")
			.hash,
		performedOutsideCandidateGeneration: true,
	},
	boundaries: {
		swapSigned: false,
		swapBroadcast: false,
		priorSealExecutionRun: false,
		interaiNativePrimaryEnabledByHost: false,
		interaiCredentialExchangedOrConsumed: false,
		authenticatedInteraiPreflightCalled: false,
	},
	handoff:
		options.mode === "live"
			? {
					localFailClosedCheckRequired: true,
					singleDirectAuthenticatedVerifyAfterReady: true,
					emailCandidateHandoff: false,
					regenerationRule:
						"Any nonce, quote, calldata, calldataHash, or assertion change creates a new JIT candidate and requires a fresh local fail-closed check.",
				}
			: {
					finalBindingReviewMayProceed: true,
					singleAuthenticatedPreflightMayProceedBeforeReview: false,
					regenerationRule:
						"Any nonce, quote, calldata, calldataHash, or assertion change creates a new candidate requiring review.",
				},
};

const releaseFilename = `oracle-registry-release-${asString(current.releaseId, "release id")}.json`;
const copied = [
	["source-oracle-safety-check-v3.json", sourcePath],
	["destination-oracle-safety-check-v3.json", destinationPath],
	["audit-persistence-proof.json", auditPath],
	["oracle-keys.json", registryPath],
	["oracle-registry-current.json", currentPath],
	[releaseFilename, path.join(options.gateDir, releaseFilename)],
	["allowance-receipt.json", options.allowanceRecord],
] as const;
for (const [name, sourceFile] of copied) {
	await Promise.all([
		cp(sourceFile, path.join(options.output, name), {
			errorOnExist: true,
			force: false,
		}),
		cp(sourceFile, path.join(options.archive, name), {
			errorOnExist: true,
			force: false,
		}),
	]);
}
await writePair(
	options.output,
	options.archive,
	"source-evidence-binding.json",
	sourceBindingBytes,
);
await writePair(
	options.output,
	options.archive,
	"destination-evidence-binding.json",
	destinationBindingBytes,
);
await writePair(
	options.output,
	options.archive,
	"candidate-run-package.json",
	serialize(packageDocument),
);

const readme =
	(options.mode === "live"
		? `# InterAI Track 1 JIT direct-verify candidate\n\n`
		: `# InterAI Track 1 final-binding-review candidate\n\n`) +
	`Package: \`${packageDocument.packageId}\`\n\n` +
	`Generated: ${packageDocument.generatedAtIso}\n\n` +
	(options.mode === "live"
		? `This host-generated JIT input is for local fail-closed checks followed by one direct authenticated InterAI /verify call after READY. It is not an InterAI ALLOW or execution authorization and is not an email attachment. No swap was signed or broadcast and no PriorSeal execution step ran at generation.\n\n`
		: `This package satisfied all host-side prerequisites at generation and is submitted only for Alejandro's final binding review. It is not an InterAI ALLOW or execution authorization. No swap was signed or broadcast, no PriorSeal execution step ran, the InterAI credential remained unexchanged/unconsumed, and no authenticated InterAI preflight was made.\n\n`) +
	`The quote expires at ${new Date(quoteExpiresAt * 1_000).toISOString()}. After expiry or any volatile-field change, regenerate the complete candidate.\n`;
await writePair(options.output, options.archive, "README.md", readme);

const names = [
	"README.md",
	"candidate-run-package.json",
	"source-oracle-safety-check-v3.json",
	"destination-oracle-safety-check-v3.json",
	"source-evidence-binding.json",
	"destination-evidence-binding.json",
	"audit-persistence-proof.json",
	"allowance-receipt.json",
	"oracle-keys.json",
	"oracle-registry-current.json",
	releaseFilename,
];
const checksums: string[] = [];
for (const name of names)
	checksums.push(
		`${sha256(await readFile(path.join(options.output, name)))}  ${name}`,
	);
await writePair(
	options.output,
	options.archive,
	"SHA256SUMS.txt",
	`${checksums.join("\n")}\n`,
);

process.stdout.write(
	serialize({
		status: packageDocument.hostPrerequisiteDisposition,
		packageId: packageDocument.packageId,
		quoteExpiresAt: new Date(quoteExpiresAt * 1_000).toISOString(),
		assertionValidUntil: Math.min(source.validUntil, destination.validUntil),
		pendingNonce,
		calldataHash,
		output: options.output,
		archive: options.archive,
	}),
);
