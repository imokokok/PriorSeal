# Operations runbook

Start locally: `cp .env.example .env`, configure only development RPC/key file paths, then run `npm --prefix web ci`, `npm run start:api`, and `npm --prefix web run dev`. Use `GET /health/live` for process liveness and `/health/ready` for dependency readiness.

When RPC failures rise, do not mark transactions failed. Check endpoint health/chain ID, rotate to a configured fallback, and replay affected jobs. For a reorg, retain the original receipt, re-observe after finality, issue a new receipt marked `REORGED`/superseding evidence, and notify relying systems.

For key rotation: publish the new public key with a new key ID and overlap validity, start signing new receipts with it, retain old public keys for historical verification, then mark the old key retired. If compromised, mark it revoked, rotate immediately, preserve audit evidence, and disclose affected receipt time ranges.
