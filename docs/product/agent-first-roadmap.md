# Personal Agent roadmap

## Product decision

PriorSeal is building for a person who uses an Agent with their own wallet. The
product's job is not to operate the Agent, hold its keys, or run an organization
workflow. Its job is to make one Agent-proposed onchain action understandable,
explicitly approved, observed, and independently reviewable.

The core loop is:

```text
Agent proposes one action
  → person reviews the limits and signs once
  → the person's chosen executor submits it
  → PriorSeal matches the observed result
  → the person retains a portable receipt
```

## Development order

1. **Personal review and confirmation.** Make the exact action, Agent identity
   claim, rationale, limits, fees, expiry, and one-time boundary clear before a
   wallet signature is requested.
2. **Safe one-action recovery.** Make pending, failed, reverted, and unknown
   submission states actionable without resubmitting automatically or expanding
   authority.
3. **Portable self-review.** Keep local verification, issuer-key trust
   selection, receipt export, and browser-local evidence reliable and easy to
   understand.
4. **Agent integration ergonomics.** Improve the SDK and MCP/HTTP discovery
   path so an Agent can prepare and recover a bounded action without receiving
   a wallet key or a standing spending mandate.
5. **Advanced profiles only after demand.** Add a profile only when its exact
   action, trust dependencies, and failure states can be shown to the person
   before they authorize it.

## Explicitly not current work

- SSO, RBAC, organization onboarding, team approval chains, and hosted
  evidence workspaces.
- Enterprise retention, project-level data administration, or a shared system
  of record.
- Session keys, recurring permissions, budgets, autonomous trading, custody,
  or transaction broadcast.

Existing archive and organization-oriented code remains unsupported for new
product scope; it is not an invitation to expand that direction. A future
change needs an explicit product decision and must preserve the individual
wallet owner's authority and portable evidence.
