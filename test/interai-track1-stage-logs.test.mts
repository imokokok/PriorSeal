import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { command } from "../scripts/run-interai-track1-live-window.mjs";

test("failed host stage retains both streams and exit status without continuing", async () => {
	const directory = await mkdtemp(
		path.join(tmpdir(), "interai-stage-rehearsal-"),
	);
	const prefix = path.join(directory, "failed-capture");
	try {
		let continued = false;
		await assert.rejects(async () => {
			await command(
				"mock capture failure",
				directory,
				process.execPath,
				[
					"-e",
					'process.stdout.write("partial capture retained"); process.stderr.write("coverage insufficient"); process.exitCode = 7;',
				],
				{ ...process.env, REHEARSAL_SECRET: "must-not-be-persisted" },
				prefix,
			);
			continued = true;
		}, /failed; NO_RUN/);
		assert.equal(continued, false);
		assert.equal(
			await readFile(`${prefix}.stdout.log`, "utf8"),
			"partial capture retained",
		);
		assert.equal(
			await readFile(`${prefix}.stderr.log`, "utf8"),
			"coverage insufficient",
		);
		const resultBytes = await readFile(`${prefix}.result.json`, "utf8");
		assert.equal(JSON.parse(resultBytes).exitCode, 7);
		assert.doesNotMatch(resultBytes, /must-not-be-persisted/);
		assert.equal((await stat(`${prefix}.stdout.log`)).mode & 0o777, 0o600);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
