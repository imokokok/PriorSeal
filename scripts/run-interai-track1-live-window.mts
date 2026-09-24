/** READY-gated host sequence: Insight capture, JIT candidate, request, one /verify. */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
	if (!value) throw new Error(message);
}
function args(): Map<string, string> {
	const values = process.argv.slice(2);
	assert(
		values.length % 2 === 0,
		"Usage: --ready-file FILE --output-root DIR [--proxy http://127.0.0.1:7890]",
	);
	const parsed = new Map<string, string>();
	for (let i = 0; i < values.length; i += 2) {
		assert(
			values[i]?.startsWith("--") && values[i + 1] && !parsed.has(values[i]),
			"Invalid or duplicate option",
		);
		parsed.set(values[i], values[i + 1]);
	}
	for (const key of parsed.keys())
		assert(
			["--ready-file", "--output-root", "--proxy"].includes(key),
			`Unsupported option: ${key}`,
		);
	for (const key of ["--ready-file", "--output-root"])
		assert(parsed.has(key), `Missing ${key}`);
	if (parsed.has("--proxy"))
		assert(
			parsed.get("--proxy") === "http://127.0.0.1:7890",
			"Only the configured local proxy is permitted",
		);
	return parsed;
}
async function command(
	label: string,
	cwd: string,
	commandName: string,
	commandArgs: string[],
	env: NodeJS.ProcessEnv,
): Promise<void> {
	process.stdout.write(`Starting ${label}\n`);
	await new Promise<void>((resolve, reject) => {
		const child = spawn(commandName, commandArgs, {
			cwd,
			env,
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`${label} failed; NO_RUN`)),
		);
	});
}
async function main(): Promise<void> {
	process.umask(0o077);
	const opts = args();
	const readyFile = path.resolve(opts.get("--ready-file") ?? "");
	const outputRoot = path.resolve(opts.get("--output-root") ?? "");
	const now = Date.now();
	const start = Date.parse("2026-09-25T12:00:00Z");
	const end = Date.parse("2026-09-25T13:00:00Z");
	assert(now >= start && now < end, "Outside agreed Asia/Shanghai live window");
	const ready = JSON.parse(await readFile(readyFile, "utf8")) as Record<
		string,
		unknown
	>;
	assert(
		ready.channel === "original-email-thread" &&
			ready.message === "READY" &&
			typeof ready.receivedAtIso === "string",
		"Alejandro READY not recorded from original email thread",
	);
	const readyAt = Date.parse(ready.receivedAtIso);
	assert(
		Number.isFinite(readyAt) &&
			readyAt >= start &&
			readyAt <= now &&
			readyAt < end,
		"READY time outside agreed window",
	);
	const priorSealRoot = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
	);
	const documentsRoot = path.resolve(priorSealRoot, "..");
	const insightRoot = path.join(documentsRoot, "insight");
	const trustRootDir = path.join(
		documentsRoot,
		"partnerships/interai-collaboration/file/2026-09-24-interai-track1-final-binding-review-candidate-source-record",
	);
	const allowanceRecord = path.join(
		documentsRoot,
		"partnerships/interai-collaboration/file/2026-09-24-interai-track1-allowance-prerequisite-record/allowance-receipt.json",
	);
	const gateDir = path.join(outputRoot, "fresh-insight-gates");
	const candidateDir = path.join(outputRoot, "jit-candidate");
	const archiveDir = path.join(outputRoot, "jit-candidate-source-record");
	const requestFile = path.join(outputRoot, "interai-verify-request.json");
	const verifyDir = path.join(outputRoot, "verify-evidence");
	await mkdir(outputRoot, { recursive: false, mode: 0o700 });
	const env = { ...process.env };
	if (opts.has("--proxy")) env.HTTPS_PROXY = opts.get("--proxy");
	await command(
		"fresh Insight v3 capture",
		insightRoot,
		"node",
		[
			"--env-file=.env.local",
			"--import",
			"tsx",
			"scripts/interai-track1/capture-preflight-gates.mts",
			"--output",
			gateDir,
			"--trust-root-dir",
			trustRootDir,
			"--profile",
			"interai",
		],
		env,
	);
	await command(
		"JIT Base Sepolia candidate",
		priorSealRoot,
		"node",
		[
			"scripts/generate-interai-track1-executable-candidate.mjs",
			"--gate-dir",
			gateDir,
			"--allowance-record",
			allowanceRecord,
			"--output",
			candidateDir,
			"--archive",
			archiveDir,
			"--mode",
			"live",
		],
		env,
	);
	await command(
		"InterAI request binding",
		priorSealRoot,
		"node",
		[
			"scripts/build-interai-track1-direct-request.mjs",
			"--candidate-dir",
			candidateDir,
			"--output",
			requestFile,
		],
		env,
	);
	const verifyArgs = [
		"scripts/run-interai-track1-direct-preflight.mjs",
		"--candidate-dir",
		candidateDir,
		"--request-file",
		requestFile,
		"--ready-file",
		readyFile,
		"--output-dir",
		verifyDir,
	];
	if (opts.has("--proxy"))
		verifyArgs.push("--proxy", opts.get("--proxy") ?? "");
	await command(
		"single direct authenticated InterAI /verify",
		priorSealRoot,
		"node",
		verifyArgs,
		env,
	);
	process.stdout.write(
		`Non-broadcast preflight evidence retained under ${outputRoot}\n`,
	);
}

main().catch((error: unknown) => {
	process.stderr.write(
		`NO_RUN: ${error instanceof Error ? error.message : "unknown error"}\n`,
	);
	process.exitCode = 2;
});
