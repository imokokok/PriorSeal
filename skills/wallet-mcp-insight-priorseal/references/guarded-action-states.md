# Guarded Action states

`priorseal-sdk` provides a serializable state record for a single guarded
action. It records workflow facts; it does not store a private key, authorize a
new call, or submit a transaction by itself.

```text
AWAITING_RISK
  ├─ BLOCK → RISK_BLOCKED (terminal)
  └─ ALLOW / CAUTION → RISK_CLEARED → PREPARED
      → AWAITING_AUTHORIZATION_SIGNATURE → AUTHORIZED
      → SUBMITTED → OBSERVING → OBSERVED → VERIFIED
```

`REVERTED` produces `FAILED`. `PENDING` remains `OBSERVING`. A reorg, missing
transaction, RPC timeout/error, unsupported chain, or inactive accepted
authorization produces `UNKNOWN`.

The only permitted transition from `UNKNOWN` is `OBSERVATION_STARTED` for the
same stored transaction hash. This prohibits accidental replacement submission
when a wallet or RPC response is ambiguous.

Use `summarizeWalletGuardedAction()` for a safe UI title, detail, and next step.
The `GuardedActionCard` exported by the web console is presentation-only;
integrators must persist the state record at each boundary.
