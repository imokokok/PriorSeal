# Restricted Automated Operation — Private Pilot Run Pack

This is the execution package for a **single, test-only, restricted automated
operation**. It turns the local Evidence Pack drill into a controlled staging
pilot without creating a public design-partner page, form, lead list, or
marketing workflow.

The files in this directory are reusable, public-safe templates. A completed
scope, delivery record, trust root, Evidence Pack, addresses, contacts, and
retention location must stay in a customer-controlled private system. Do not
commit them. The two conventional local filenames are ignored by Git:

- `pilot-scope.private.json`
- `evidence-pack-delivery.private.md`

## Boundary

The pilot may exercise one reviewed `CONTRACT_CALL` using
`priorseal.execution-profile.exact-call.v1`, with an exact target, calldata,
value limit, deadline, authorization nonce, route binding, and code-hash guard.
It is not a production authorization, a custody service, an investment product,
or permission to move real funds. Use a staging/test chain and `testOnly: true`
in every scope record.

PriorSeal creates and verifies evidence. The Node integrator remains responsible
for signer custody and broadcasting. For this Node execution path, a shared
PostgreSQL attempt store is mandatory when multiple routes use the same signer;
the local journal is not a multi-host durability mechanism.

## Roles and separation

| Role | Required responsibility |
| --- | --- |
| Authorizer | Approves the narrowly defined action and expiry; must not be the executor owner. |
| Executor owner | Controls the Node execution gateway, signer custody, and broadcast path. |
| Evidence owner | Controls issuer configuration, evidence creation, and retention. |
| Independent reviewer | Verifies the delivered pack with a separately provided trust root; must not be the executor or evidence owner. |
| Recovery owner | Resolves retained `UNCERTAIN` attempts using reconciliation, never automatic re-broadcast. |

The role names in a completed record may be private references rather than
personal information. The scope validator rejects an authorizer who is also the
executor owner, and a reviewer who is also the executor owner or evidence owner.

## 1. Create and validate the private scope

Copy [`pilot-scope.template.json`](./pilot-scope.template.json) to a
customer-controlled private directory, replace every placeholder, then run the
offline validator:

```bash
npm run validate:restricted-automation-pilot-pack -- /secure/customer/pilot-scope.private.json
```

Passing means the record is structurally complete for this **test-only** run
pack. It does not grant authorization and it does not inspect keys, networks,
or an execution environment. The validator deliberately prints only status
codes, never the supplied scope values.

The completed scope must define:

- exactly one normalized executor and call target, plus an exact calldata hash and reviewed router code hash;
- a maximum native value and validity window of 60–3,600 seconds;
- PostgreSQL durability and a shared signer scope;
- a named evidence audience, issuer-key reference, retention period, and delivery record reference;
- all seven required acceptance checks.

## 2. Prepare the staging environment

Before any authorization is issued, the executor owner and recovery owner must
confirm all of the following:

- The reviewed source commit, built artifact, execution profile, chain ID,
  target address, call encoding, router bytecode hash, and max value agree with
  the private scope.
- Every path able to broadcast with the shared signer goes through the same
  guarded gateway and durable PostgreSQL store.
- The attempt store is migrated using the existing execution-attempt migration
  described in [the database runbook](../../docs/runbooks/database.md). This
  run pack introduces **no new database schema or migration**.
- Issuer, audience, key identifiers, clock, and proof mode are configured
  according to [the operations runbook](../../docs/runbooks/operations.md).
- The trust root is prepared for a separate delivery channel. It must never be
  silently accepted from the Evidence Pack under review.
- The independent reviewer, recovery owner, and evidence retention location are
  available before the first broadcast.

Stop the pilot immediately if the real router bytecode cannot be matched to its
approved code hash, the durable store is unavailable, the reviewer cannot use a
separate trust root, or any unguarded signer/broadcast route exists.

## 3. Establish the local baseline

Run the included local drill first. It proves that the shipped example can
create a deterministic Evidence Pack and that its verifier works with a
separately supplied trust root:

```bash
mkdir -p /tmp/priorseal-local-evm
npm install --prefix /tmp/priorseal-local-evm --no-save ganache@7.9.2
GANACHE_MODULE=/tmp/priorseal-local-evm/node_modules/ganache/dist/node/core.js \
  PRIORSEAL_PILOT_OUTPUT_DIR=/tmp/priorseal-pilot-evidence \
  npm run pilot:restricted-automation

npm run verify:restricted-automation-pilot -- \
  /tmp/priorseal-pilot-evidence/evidence-pack.json \
  /tmp/priorseal-pilot-evidence/trust-root.json
```

For the output format and negative controls covered by the local drill, see the
[pilot README](./README.md). The local generated trust root is test-only and
must not become a customer trust root.

## 4. Execute the bounded staging acceptance plan

Run the following checks through the actual guarded staging integration, then
retain its Evidence Pack and durable attempt records. Do not mark an unchecked
control as passed.

1. Execute the exact authorized operation once inside its approved validity window.
2. Change the recipient or call target and confirm rejection before broadcast.
3. Replay the same authorization and confirm rejection.
4. Reuse the nonce on another guarded route and confirm cross-route rejection.
5. Change or simulate a changed router code hash and confirm rejection; retain
   the resulting `UNCERTAIN` attempt for recovery.
6. Reconcile that `UNCERTAIN` attempt from independent chain evidence without
   resubmitting the operation.
7. Have the independent reviewer run the offline verifier with the separately
   delivered trust root and record the result.

The gateway semantics behind these checks are documented in the
[DeFi execution gateway reference](../../docs/product/defi-execution-gateway.md).

## 5. Deliver the Evidence Pack and record acceptance

Copy [`EVIDENCE-PACK-DELIVERY.template.md`](./EVIDENCE-PACK-DELIVERY.template.md)
to a customer-controlled private location. Record hashes for the scope, pack,
trust root, run summary, verifier source/version, verifier output, and delivery
channel reference. The reviewer must receive the trust root separately and
perform their own verification.

The delivery record is complete only when all acceptance boxes are checked, an
independent reviewer has recorded their result, retention is assigned, and a
recovery owner has accepted the `UNCERTAIN` procedure. Evidence proves these
bounded checks only; it does not prove the safety or suitability of arbitrary
future actions.

## 6. Gate any paid pilot discussion

Only after the completed private delivery record has been independently
reviewed should the parties decide whether to draft a paid-pilot scope. That
decision should preserve the same boundaries: exact profile, named owners,
durable attempts, independent evidence verification, retention, and recovery.
No website publication or design-partner intake is required by this run pack.
