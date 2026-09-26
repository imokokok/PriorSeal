/** Preparation only: public GETs, Insight diagnostic capture and chain review.
 * This script cannot invoke InterAI /verify or create a READY marker.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertTrack1Registry } from "./interai-track1-registry.mjs";
import { command } from "./run-interai-track1-live-window.mjs";

process.umask(0o077);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documents = path.resolve(root, "..");
const insight = path.join(
	documents,
	"insight/.worktrees/interai-track1-operator",
);
const collaboration = path.join(
	documents,
	"partnerships/interai-collaboration/file",
);
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== "--output" || !path.isAbsolute(argv[1]))
	throw new Error("Required: --output NEW_ABSOLUTE_PRIVATE_DIRECTORY");
const output = argv[1];
await mkdir(output, { mode: 0o700 });
await mkdir(path.join(output, "stage-logs"), { mode: 0o700 });
const beganAt = new Date().toISOString();
const observations: unknown[] = [];
let proxyRequired = false;
const save = async (name: string, value: unknown) =>
	writeFile(path.join(output, name), `${JSON.stringify(value, null, 2)}\n`, {
		mode: 0o600,
		flag: "wx",
	});
const urls = [
	["insight-ready", "https://www.oracleinsight.xyz/api/v1/health/ready"],
	["interai-public-ready", "https://api.interailabs.dev/ready"],
	["oracle-keys", "https://www.oracleinsight.xyz/.well-known/oracle-keys.json"],
];
for (const [name, url] of urls) {
	let text: string;
	let route = "direct";
	const args = [
		"--silent",
		"--show-error",
		"--fail-with-body",
		"--connect-timeout",
		"5",
		"--max-time",
		"12",
		"--retry",
		"0",
	];
	try {
		text = execFileSync("curl", [...args, "--noproxy", "*", url], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch {
		route = "configured-local-proxy";
		proxyRequired = true;
		text = execFileSync(
			"curl",
			[...args, "--noproxy", "", "--proxy", "http://127.0.0.1:7890", url],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		);
	}
	const body = JSON.parse(text) as unknown;
	if (name === "oracle-keys") assertTrack1Registry(body);
	await save(`${name}.json`, body);
	observations.push({
		name,
		url,
		route,
		checkedAt: new Date().toISOString(),
		sha256: createHash("sha256").update(text).digest("hex"),
	});
}
const env = { ...process.env };
if (proxyRequired) env.HTTPS_PROXY = "http://127.0.0.1:7890";
await command(
	"Insight-only diagnostic capture (not a live READY/JIT)",
	insight,
	process.execPath,
	[
		`--env-file=${path.join(documents, "insight/.env.local")}`,
		"--import",
		"tsx",
		"scripts/interai-track1/capture-preflight-gates.mts",
		"--output",
		path.join(output, "diagnostic-insight-gates"),
		"--trust-root-dir",
		path.join(
			collaboration,
			"2026-09-24-interai-track1-final-binding-review-candidate-source-record",
		),
		"--profile",
		"interai",
	],
	env,
	path.join(output, "stage-logs/01-insight-diagnostic"),
);
await command(
	"Base Sepolia review-only quote and exact-call simulation",
	root,
	process.execPath,
	[
		"scripts/generate-interai-track1-executable-candidate.mjs",
		"--gate-dir",
		path.join(output, "diagnostic-insight-gates"),
		"--allowance-record",
		path.join(
			collaboration,
			"2026-09-24-interai-track1-allowance-prerequisite-record/allowance-receipt.json",
		),
		"--output",
		path.join(output, "review-only-candidate"),
		"--archive",
		path.join(output, "review-only-source-record"),
		"--mode",
		"review",
	],
	env,
	path.join(output, "stage-logs/02-chain-review"),
);
const candidate = JSON.parse(
	await readFile(
		path.join(output, "review-only-candidate/candidate-run-package.json"),
		"utf8",
	),
) as Record<string, unknown>;
const source = JSON.parse(
	await readFile(
		path.join(
			output,
			"diagnostic-insight-gates/source-oracle-safety-check-v3.json",
		),
		"utf8",
	),
) as Record<string, unknown>;
const destination = JSON.parse(
	await readFile(
		path.join(
			output,
			"diagnostic-insight-gates/destination-oracle-safety-check-v3.json",
		),
		"utf8",
	),
) as Record<string, unknown>;
const summary = {
	status: "PREPARATION_REHEARSAL_PASS",
	beganAt,
	finishedAt: new Date().toISOString(),
	observations,
	proxyRequired,
	source: source.data,
	destination: destination.data,
	network: candidate.network,
	executorReadiness: candidate.executorReadiness,
	quote: candidate.quote,
	projection: candidate.interaiSixFieldProjection,
	interaiVerifyRequests: 0,
	transactionSigning: false,
	broadcast: false,
	reusableForTonight: false,
};
await save("rehearsal-summary.json", summary);
process.stdout.write(
	`Preparation rehearsal PASS; private evidence: ${output}\n`,
);
