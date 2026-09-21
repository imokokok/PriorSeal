# Cloudflare production runbook

PriorSeal deploys the web console and API as one Cloudflare Worker. `wrangler.jsonc` is the reviewed production manifest: the apex and `www` hostnames are Worker Custom Domains; static assets come from `web/dist`; `/v1/*`, `/health/*`, `/.well-known/*`, and `/openapi/*` execute Worker-first; Hyperdrive connects to Neon; `priorseal-observations` delivers observation jobs; and the minute cron recovers persisted jobs that need another delivery.

## Release

1. After publishing the v2-aware SDK/verifier, apply database migrations through `010_authorization_merkle_index.sql` with the direct Neon connection and run `npm run production:check` from the controlled migration environment.
2. Run `npm ci` and `npm run release:check`. Do not deploy if lint, types, tests, browser E2E, coverage, dependency audit, frontend build, or the Wrangler dry-run fails.
3. Confirm the Worker Secrets named in `wrangler.jsonc` exist. To enable the optional private uploaded-evidence archive, also set `PRIORSEAL_ARCHIVE_CREDENTIALS_JSON` as a Worker secret after migration 009 is applied; configure only token hashes, never raw bearer tokens. Follow [the archive runbook](project-evidence-archive.md) for scoped writer/reviewer credentials. Never copy their values into the manifest, logs, issue trackers, or this runbook.
4. Commit the exact release contents, ensure the worktree is clean, and deploy with `npm run worker:deploy`. The command tags the Worker version with the full Git SHA; record the resulting Worker version ID and SHA together.
5. Verify `/health/live`, `/health/ready`, `/v1/version`, `/v1/capabilities`, `/.well-known/priorseal-keys.json`, the console root and new console routes, and HTTPS on both `priorseal.xyz` and `www.priorseal.xyz`. Run the read-only smoke below against the exact deployed SHA before considering configuration/asset delivery complete.
6. Run `PRIORSEAL_EXPECTED_VERSION=$(git rev-parse HEAD) npm run production:smoke` for a persisted, locally verified EIP-712 authorization and RFC 3161 proof without spending funds. Use the same exact-version variable with `npm run production:smoke:pending` when queue or cron bindings change; it additionally proves that a missing transaction reaches a durable terminal `UNDETERMINED` job state. The exponential production retry window can take about ten minutes. To resume a previously interrupted check without creating a second pending job, set `PRIORSEAL_PENDING_JOB_ID` to the returned durable job ID.
7. For a no-spend observer compatibility drill, bind a legacy v1 intent to a previously confirmed public EVM transaction, download its receipt bundle, and verify it locally with a separately pinned public key. This does not replace a v2 live-execution drill: a v2 `COMPLETED` receipt requires the authorization and RFC 3161 evidence to exist before the transaction executes.

## Read-only release verification

The default `production:smoke` command above deliberately creates a synthetic zero-value authorization and independently checks its stored EIP-712/RFC 3161 evidence. It uses a temporary generated test signer and does not broadcast a transaction. Use the explicit `--read-only` mode when only GET requests are authorized or desired:

```sh
PRIORSEAL_EXPECTED_VERSION=$(git rev-parse HEAD) npm run production:smoke -- --read-only
```

This checks the exact Worker Git tag, PostgreSQL readiness, audience/issuer, the exact-call profile, EIP-712 support, the configured RPC for every expected chain, proof mode, the new console pages, and their entry asset against the locally built `web/dist/index.html`. It also compares the deployed console, exact-call, verifier, archive and quickstart JavaScript chunks byte-for-byte with the current release build. Configuration does not prove current RPC/TSA reachability, and GET-only checks do not create a new timestamp or exercise wallet signing. Keep the existing synthetic authorization smoke as the separate end-to-end proof check when authorized.

Defaults target issuer/audience `priorseal.xyz`, proof mode `rfc3161`, and chain IDs `1,8453,42161`. Override deliberately with `PRIORSEAL_BASE_URL`, `PRIORSEAL_EXPECTED_ISSUER`, `PRIORSEAL_EXPECTED_AUDIENCE`, `PRIORSEAL_EXPECTED_PROOF_MODE`, or `PRIORSEAL_EXPECTED_CHAINS`. To verify `www`, change only the base URL; issuer/audience remain the deployment identity. `PRIORSEAL_EXPECTED_POLICY_FILE=config/authorization-policy.public-beta.json` additionally compares the public capability hash with the reviewed policy. `PRIORSEAL_EXPECTED_HTML_FILE` can identify a separately retained release build's HTML.

The deployed secret policy must allow `CONTRACT_CALL` and must not contain transfer-only `allowedAssets`, `allowedRecipients`, or `maxAmount` constraints if exact-call is advertised. The reviewed public-beta policy supports both transfer and exact-call. The restrictive production policy example intentionally starts with empty allowlists/zero maximum and cannot be copied unchanged while promising router exact-call support. Do not remove customer security controls merely to obtain a green capability check; choose a reviewed compatible profile/policy instead. Base Sepolia is a supported development profile but is not one of the default production policy chains.

To check the private archive without writing evidence, supply a temporary mode-0600 JSON file through `PRIORSEAL_ARCHIVE_SMOKE_CREDENTIALS_FILE`. Its structure is:

```json
{
  "credentials": [
    {
      "token": "<raw scoped token from the operator secret manager>",
      "projectId": "<expected project>",
      "environment": "production",
      "role": "reviewer"
    }
  ]
}
```

Use `PRIORSEAL_REQUIRE_ARCHIVE=1` to require both an enabled archive and a credential file. The script reads scoped metadata/export pages, checks `private, no-store`, and compares hashes of any already-existing artifact; it never uploads one. If credentials for another project are supplied and an existing artifact is available, it checks that cross-project retrieval returns 404. Empty archives cannot demonstrate existing-object isolation, and reviewer upload denial is intentionally not exercised by a GET-only script; those boundaries remain covered by the automated HTTP/PostgreSQL tests. Output contains only deployment/scope/check summaries, never tokens or artifact contents. Keep the temporary file outside the repository, deliver credentials privately, and remove the temporary copy after the check.

## Bindings and recovery

The production Worker requires `HYPERDRIVE`, `OBSERVATION_QUEUE`, `HTTP_RATE_LIMITER`, `CF_VERSION_METADATA`, and `ASSETS`. Publish the updated offline SDK and move relying clients to its v2-aware verifier before deploying the issuer: older SDK builds reject new Merkle receipts. Apply `npm run db:migrate` with the direct database URL before deploying this release: migration 010 atomically backfills the authorization Merkle index while holding the append lock, so schedule it during a low-traffic window. Cold-start readiness now requires migration 010 and its index; the durable result and lease columns from migration 008 remain required. When archive credentials are configured, migration 009 and its scoped archive schema are also required; enabling credentials before migration can make cold-start readiness fail. The Rate Limiting binding protects dynamic API routes with a shared per-location counter and fails closed if the binding is unavailable. Queue delivery is at-least-once, so database writes remain idempotent. A nonterminal queue delivery sends a fresh delayed prompt before acknowledging the current message; this keeps future work alive even when a prompt arrives slightly before `next_attempt_at` and avoids coupling the eight business attempts to one Queue message's retry counter. PostgreSQL owns job state and lease ownership; the minute cron and queue prompts can reclaim an expired `RUNNING` lease after an interrupted consumer.

If queue deliveries fail, inspect Worker logs without printing request bodies or secrets, fix the dependency, then let the cron recover eligible rows. If Hyperdrive cannot reach Neon, keep readiness failed and do not bypass schema checks. If an RPC endpoint fails, preserve the pending/undetermined distinction and rotate only to another explicitly configured endpoint for the same chain.

## DNS and rollback

Cloudflare is authoritative through `adrian.ns.cloudflare.com` and `tanner.ns.cloudflare.com`. Worker Custom Domains own the active DNS records and certificates. The previous origin values are `A @ 216.24.57.1` and `CNAME www priorseal.xyz`; retain them only as audited rollback data, not as active Cloudflare records. Recursive resolvers can continue using the previous nameservers until their cached delegation expires, so keep the previous hosting service healthy for at least 48 hours after the registrar cutover. Do not remove it until both domains have served the expected Worker build over HTTPS, the production flow has passed, and the overlap window has elapsed.

To roll back while Cloudflare remains authoritative, remove the two Worker Custom Domains and recreate the recorded proxied apex A and `www` CNAME origin records. To roll back to another DNS provider, first restore a complete tested zone there, then change nameservers at the registrar. Nameserver changes can take 24–48 hours, so never delete the working Cloudflare zone as a first response.

After stable cutover, remove obsolete provider-specific build artifacts from the repository. The current `Dockerfile`, `docker-compose.yml`, and Node bootstrap are intentionally retained as the supported local-development path; they are provider-neutral and are not used by the Cloudflare production deployment.
