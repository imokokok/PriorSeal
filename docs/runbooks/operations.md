# Operations runbook

Start locally: `cp .env.example .env.local`, configure only development RPC/key file paths, then run `npm --prefix web ci`, `npm run start:api`, and `npm --prefix web run dev`. Use `GET /health/live` for process liveness and `/health/ready` for dependency readiness.

When RPC failures rise, do not mark transactions failed. Check endpoint health/chain ID, rotate to a configured fallback, and replay affected jobs. For a reorg, retain the original receipt, re-observe after finality, issue a new receipt marked `REORGED`/superseding evidence, and notify relying systems.

For issuer-key rotation: place historical public keys in a public-only JSON file and set `RUNPROOF_KEY_REGISTRY_FILE` to its path. The file shape is `{ "schema": "runproof.keys.v1", "keys": [{ "issuer": "runproof", "keyId": "old", "algorithm": "Ed25519", "publicKey": "-----BEGIN PUBLIC KEY-----...", "status": "retired", "validFrom": 1700000000, "validUntil": 1800000000 }] }`. Configure the new signing key under a new `RUNPROOF_KEY_ID`; the active key is merged into the published registry. Never put private-key fields in this file. If an issuer key is compromised, mark it revoked, rotate immediately, preserve audit evidence, and disclose affected receipt time ranges.

For legacy RPC URL exposure: releases before the source-identifier fix could embed the entire configured endpoint in observations and signed receipts. Do not rewrite signed receipts because doing so invalidates their signatures. Immediately rotate any RPC credential embedded in a URL, update `RUNPROOF_RPC_*`, restart the service, and stop distributing old receipt files until the credential is invalid. Unsigned observation rows may be access-restricted or removed only under the organization's evidence-retention policy.
