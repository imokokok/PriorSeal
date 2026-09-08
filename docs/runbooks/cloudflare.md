# Cloudflare production runbook

PriorSeal deploys the web console and API as one Cloudflare Worker. `wrangler.jsonc` is the reviewed production manifest: the apex and `www` hostnames are Worker Custom Domains; static assets come from `web/dist`; `/v1/*`, `/health/*`, `/.well-known/*`, and `/openapi/*` execute Worker-first; Hyperdrive connects to Neon; `priorseal-observations` delivers observation jobs; and the minute cron recovers persisted jobs that need another delivery.

## Release

1. Apply database migrations through `007_observation_job_results.sql` with the direct Neon connection and run `npm run production:check` from the controlled migration environment.
2. Run `npm ci` and `npm run release:check`. Do not deploy if lint, types, tests, browser E2E, coverage, dependency audit, frontend build, or the Wrangler dry-run fails.
3. Confirm the Worker Secrets named in `wrangler.jsonc` exist. Never copy their values into the manifest, logs, issue trackers, or this runbook.
4. Deploy with `npm run worker:deploy`. Record the resulting Worker version ID and Git commit SHA together.
5. Verify `/health/live`, `/health/ready`, `/v1/version`, `/.well-known/priorseal-keys.json`, the console root, and HTTPS on both `priorseal.xyz` and `www.priorseal.xyz`.
6. Run `npm run production:smoke` for a persisted, locally verified EIP-712 authorization and RFC 3161 proof without spending funds. Run `npm run production:smoke:pending` when queue or cron bindings change; it additionally proves that a missing transaction reaches a durable terminal `UNDETERMINED` job state. The exponential production retry window can take about ten minutes. To resume a previously interrupted check without creating a second pending job, set `PRIORSEAL_PENDING_JOB_ID` to the returned durable job ID.
7. For a no-spend observer compatibility drill, bind a legacy v1 intent to a previously confirmed public EVM transaction, download its receipt bundle, and verify it locally with a separately pinned public key. This does not replace a v2 live-execution drill: a v2 `COMPLETED` receipt requires the authorization and RFC 3161 evidence to exist before the transaction executes.

## Bindings and recovery

The production Worker requires `HYPERDRIVE`, `OBSERVATION_QUEUE`, and `ASSETS`. Schema readiness is checked before serving a cold runtime and fails closed if migration 007 or its durable result column is missing. Queue delivery is at-least-once, so database writes remain idempotent. A nonterminal queue delivery sends a fresh delayed prompt before acknowledging the current message; this keeps future work alive even when a prompt arrives slightly before `next_attempt_at` and avoids coupling the eight business attempts to one Queue message's retry counter. The scheduled handler is recovery, not a second source of truth: PostgreSQL owns job state and the queue only prompts processing.

If queue deliveries fail, inspect Worker logs without printing request bodies or secrets, fix the dependency, then let the cron recover eligible rows. If Hyperdrive cannot reach Neon, keep readiness failed and do not bypass schema checks. If an RPC endpoint fails, preserve the pending/undetermined distinction and rotate only to another explicitly configured endpoint for the same chain.

## DNS and rollback

Cloudflare is authoritative through `adrian.ns.cloudflare.com` and `tanner.ns.cloudflare.com`. Worker Custom Domains own the active DNS records and certificates. The previous origin values are `A @ 216.24.57.1` and `CNAME www priorseal.xyz`; retain them only as audited rollback data, not as active Cloudflare records. Recursive resolvers can continue using the previous nameservers until their cached delegation expires, so keep the previous hosting service healthy for at least 48 hours after the registrar cutover. Do not remove it until both domains have served the expected Worker build over HTTPS, the production flow has passed, and the overlap window has elapsed.

To roll back while Cloudflare remains authoritative, remove the two Worker Custom Domains and recreate the recorded proxied apex A and `www` CNAME origin records. To roll back to another DNS provider, first restore a complete tested zone there, then change nameservers at the registrar. Nameserver changes can take 24–48 hours, so never delete the working Cloudflare zone as a first response.

After stable cutover, remove obsolete provider-specific build artifacts from the repository. The current `Dockerfile`, `docker-compose.yml`, and Node bootstrap are intentionally retained as the supported local-development path; they are provider-neutral and are not used by the Cloudflare production deployment.
