# Integration and recovery checks

Public configuration and readiness, with no key, paid call or wallet operation:

```sh
npm run integration:doctor -- --offer priorseal
npm run integration:doctor -- --offer combined
```

Insight-only users can run the same command from the Insight checkout with
`--offer insight`. A successful public check proves HTTP readiness and advertised
configuration, not live RPC/TSA availability, signer trust or an executable trade.
Diagnostic JSON contains no supplied API key. Redirects are refused to avoid
forwarding credentials to another origin.

An explicit coverage probe uses the existing Insight API and is billable under
the key's plan. Set `INSIGHT_API_KEY` in the environment, never a command argument:

```sh
npm run integration:doctor -- --offer insight --probe --asset USDC --chain 1 --freshness 300 --samples 3
```

Samples run sequentially, at least one second apart, with at most ten samples.
An insufficient freshness quorum exits nonzero and lists per-source reasons,
source ages, read durations and any participant/group shortfall. This is a
coverage diagnostic, not a signed assessment or proof of market danger. A cache
hit may return old source data; read latency and source age are different fields.

## Durable client state

`examples/durable-state/store.mjs` is a Node filesystem example for a single
writer process. It uses serialized writes, a temporary file, fsync and atomic
rename; files are private to the local user. Put the directory on persistent
storage, outside Git and any web-served directory. Local disk on an ephemeral
serverless instance is unsuitable. A pre-existing `.writer` lock refuses a
second process; after a crash, confirm the original process has stopped before
removing that lock. Corrupt state fails closed rather than silently resetting.
Use a transactional shared store with fencing for multiple hosts; this example
does not claim distributed coordination or encryption at rest.

```js
import { openDurableState } from './examples/durable-state/store.mjs';
const state = await openDurableState('/private/persistent/priorseal');
try {
  const checkpoint = await state.load('authorization:my-operation');
  const result = await client.authorizeWithWallet(request, wallet, {
    ...(checkpoint ? { checkpoint } : {}),
    onCheckpoint: value => state.save('authorization:my-operation', value),
  });
  // Persist txHash/jobId after your executor submits. Recover evidence using
  // that identity; never use a timeout as permission to submit a new trade.
} finally { await state.close(); }
```

The Insight copy can be passed as `stateAdapter` to `guard.watch`; await
`handle.done` after stopping the watcher before closing the state store. No
example automatically acknowledges recovery or resumes funds movement. Store
only checkpoints and Watch state, never wallet keys or API credentials.

## Executable local transaction and recovery drill

```sh
npm run sdk:build
npm install --prefix /tmp/priorseal-local-evm --ignore-scripts --no-audit --no-fund ganache@7.9.2
GANACHE_MODULE=/tmp/priorseal-local-evm/node_modules/ganache/dist/node/core.js node scripts/local-execution-drill.mjs
```

The drill creates an in-process EVM, test accounts, an HTTP service, and an
embedded PostgreSQL database using actual migrations. It signs an exact call,
drops the acceptance response after commit, restores the database and client
state, submits one valueless local transaction, drops the observation response,
restores again, and independently verifies the recovered receipt. It asserts
one wallet signature, one transaction nonce and one receipt. No remote RPC URL
or wallet key is accepted. It uses a local issuer-only proof; production RFC3161,
real-chain finality, RPC faults and partner acceptance require separate evidence.
Embedded PostgreSQL is not a multi-connection concurrency benchmark.

## Production health

The `Public service health` GitHub workflow checks both products every fifteen
minutes and confirms a failed check one minute later. Failures use the owner's
existing GitHub Actions notification settings; no Slack/email destination is
invented. Artifacts are kept for fourteen days. GitHub schedules can be delayed,
so this is a low-cost health check, not a one-minute uptime SLA. A failed check
does not trigger migration, transaction replay or automatic rollback.

For a failure: inspect the artifact and request time, separate liveness from
readiness, inspect the owning platform's logs, and follow the existing operations
runbook. Frontend crashes and platform-wide 5xx still require the existing Sentry
and hosting dashboards; public HTTP checks do not replace them.
