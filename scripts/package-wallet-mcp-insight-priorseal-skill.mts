import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd();
const directory = "skills/wallet-mcp-insight-priorseal";
const output = path.join(
	root,
	"web",
	"public",
	"downloads",
	"wallet-mcp-insight-priorseal-skill-v0.2.0.zip",
);
const required = [
	`${directory}/SKILL.md`,
	`${directory}/README.md`,
	`${directory}/mcp.json`,
	`${directory}/examples/connection-check.mts`,
	`${directory}/references/compatibility-gate.md`,
	`${directory}/references/guarded-action-states.md`,
] as const;

for (const file of required) await access(path.join(root, file));
if (process.argv.includes("--check")) {
	await access(output);
	const listed = await run("/usr/bin/unzip", ["-Z1", output]);
	const files = new Set(listed.stdout.split("\n").filter(Boolean));
	for (const file of required)
		if (!files.has(file)) throw new Error(`Skill archive is missing ${file}`);
} else {
	await mkdir(path.dirname(output), { recursive: true });
	await rm(output, { force: true });
	await run("/usr/bin/zip", ["-r", "-X", output, directory], { cwd: root });
	process.stdout.write(`built ${path.relative(root, output)}\n`);
}
