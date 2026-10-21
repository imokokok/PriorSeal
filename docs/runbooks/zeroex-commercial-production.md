# Guarded 0x commercial production runbook

This runbook turns on a disclosed 0x Solana service fee for an authenticated
partner tenant. It is an operational checklist, not legal, tax, accounting,
licensing, or financial advice. Do not turn on a fee profile until the operator
has approved the applicable terms, disclosures, support owner, jurisdictional
review, recipient account ownership, and accounting treatment.

## Design boundary

PriorSeal remains non-custodial: a wallet signs the exact prepared Solana
transaction, and PriorSeal neither holds the key nor rebuilds that transaction
after authorization. The fee is server-owned configuration passed to the 0x
Solana instruction API and committed into the authorization. The commercial
ledger is immutable relay evidence, not proof that a swap or token fee settled.

Each fee-bearing submission yields one deterministic ledger ID (`zcl_…`) and
one or more events (`zce_…`):

| Event | Meaning | Revenue status |
| --- | --- | --- |
| `RELAY_ATTEMPTED` | Durable fee terms were recorded before authorization claim/broadcast. | Never revenue. |
| `RELAY_NOT_CLAIMED` | The one-time authorization could not be claimed. No relay was sent by this request. | Never revenue. |
| `RELAY_SUBMITTED` | The RPC returned the same wallet transaction signature. | Unconfirmed; observe the signature. |
| `RELAY_UNKNOWN` | The RPC response was absent or inconsistent after the claim. | Unconfirmed; investigate the signature. |

Do not infer settled fee revenue from `RELAY_SUBMITTED`. Reconcile it to an
independent Solana observation and the organization’s approved accounting
records.

## Before enabling a fee profile

1. Assign a stable tenant ID, fee profile ID, owner, support route, and a
   reviewed existing SPL/Token-2022 recipient token account for the input mint.
   The runtime reads the account from Solana RPC before preparing a quote and
   rejects a missing or mint-mismatched account.
2. Keep the default `public` tenant fee-free. Give every fee-bearing tenant an
   `agentAccountId`; configure the same active account in
   `PRIORSEAL_AGENT_METER_JSON`. Configure a metered `POST` prepare route for
   `/v1/0x/guarded-swaps/prepare` and/or
   `/v1/solana/guarded-swaps/prepare`.
3. First release with `PRIORSEAL_ZEROEX_ENABLED=false` (or leave it omitted).
   While this switch is false, the runtime ignores all staged 0x values and
   cannot expose guarded 0x routes. Then set the protected 0x configuration
   only in the deployment secret store: `ZEROEX_API_KEY`, `INSIGHT_API_KEY`,
   `PRIORSEAL_ZEROEX_POLICY_JSON`, and
   `PRIORSEAL_ZEROEX_RESPONSE_SIGNING_KEYS_JSON`. Reuse the reviewed
   `PRIORSEAL_RPC_SOLANA_MAINNET` endpoint or set a dedicated
   `PRIORSEAL_ZEROEX_RPC_URL`; the dedicated value takes precedence. Do not put
   a fee in the base policy; use `PRIORSEAL_ZEROEX_TENANTS_JSON` instead. Pin
   the 0x response signing keys from the approved provider key-rotation
   process.
4. In a separately reviewed release, set `PRIORSEAL_ZEROEX_ENABLED=true` only
   after the complete configuration, tenant binding, metered route, recipient
   account, and schema checks have passed. An incomplete enabled configuration
   fails closed at startup.
5. Keep the fee recipient account and fee profile change-controlled. A change
   creates newly authorised transactions; it must not be treated as an edit to
   old records.

## Capture the first route baseline while the integration is off

Before adding any 0x program ID or address lookup table to the production
allowlist, request one small, fee-bearing route with the integration gate still
off. The repository command is intentionally quote-only: it verifies the 0x
RFC 9421 response signature, creates no authorization, does not use wallet
signer material, does not broadcast a transaction, and refuses to run if
`PRIORSEAL_ZEROEX_ENABLED=true`.

```sh
PRIORSEAL_ENVIRONMENT=production \
PRIORSEAL_ZEROEX_ENABLED=false \
ZEROEX_API_KEY="<ephemeral secret from the deployment secret store>" \
npm run zeroex:production:quote
```

Review the emitted public JSON artifact and preserve it with release evidence.
Its `programIds`, `addressLookupTables`, `route`, `zid`, fee terms, and
`fingerprint` describe exactly the signed provider response that was reviewed.
Do not treat this one quote as a blanket approval for new routes: add only the
reviewed IDs to `PRIORSEAL_ZEROEX_POLICY_JSON`, repeat the baseline after a
route/provider key change, and keep `PRIORSEAL_ZEROEX_ENABLED=false` until the
resulting policy and release check have been approved.

## Apply the durable schema before code

For the Cloudflare D1 production deployment, apply the new migration and make
sure no migration is pending:

```sh
wrangler d1 migrations apply priorseal-production --remote
wrangler d1 migrations list priorseal-production --remote
```

The relevant forward migration is
`d1/migrations/0007_zeroex_commercial_ledger.sql`. For the optional Node /
PostgreSQL runtime, apply
`migrations/016_zeroex_commercial_ledger.sql` through the normal migration
runner before enabling a fee-bearing tenant. Startup/readiness fails closed
when the required ledger table is absent.

## Release validation

1. Deploy with a fee-free public tenant first, then add one low-limit partner
   tenant.
2. Confirm `/v1/capabilities` reports guarded 0x as ready and the D1 schema
   guard has passed.
3. With a non-production wallet and explicit partner Agent credential, prepare,
   authorize, sign, and submit a deliberately small swap. Confirm the returned
   commercial review shows the exact tenant, profile, mint, recipient, fee ppm,
   and expected atomic fee.
4. Record the authorization ID, message hash, signature, ledger events, and
   independent observation result in the release evidence. Test both a normal
   submitted outcome and an intentionally unavailable RPC path where practical.
5. Verify that no browser payload can choose a tenant, fee rate, recipient,
   side, sponsorship, provider, or replacement transaction.

## Reconciliation and incident handling

Export immutable ledger events from `zeroex_commercial_ledger_events` by
tenant and time. The table is suitable for a read-only operational export;
`event_json` retains the exact fee commitment while excluding signed
transaction bytes.

```sql
SELECT ledger_id, event_type, occurred_at, tenant_id, authorization_id,
       transaction_signature, fee_profile_id, fee_mint, fee_ppm,
       recipient_token_account, expected_fee_atomic
FROM zeroex_commercial_ledger_events
WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
ORDER BY occurred_at, event_id;
```

For every `RELAY_UNKNOWN` or `RELAY_SUBMITTED`, observe the recorded
`transaction_signature` exactly once with the expected authorization context.
If the signature is absent after the configured observation window, escalate
to the operator; never resubmit a different transaction under the consumed
authorization. Preserve the exported events and observation evidence together
with the approved accounting adjustment, if any.

If the commercial ledger is unavailable, pause fee-bearing submissions and
repair storage first. The service deliberately fails before broadcast in that
case. Rotate a compromised 0x key or Agent credential through the deployment
secret process, revoke affected Agent accounts, and retain ledger/history for
the incident review.
