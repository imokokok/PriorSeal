# Evidence relationship levels

PriorSeal keeps related claims separate so that one valid artifact is not presented as proof of another system's behavior. The console's evidence-relationship view is a read-only projection of existing signed fields and verifier results. It does not add a protocol schema, alter canonical bytes or issue a new verdict.

## Four distinct levels

1. **Artifact integrity and authority.** Local verification recomputes the intent, authorization, execution and receipt identities and checks the applicable signatures against independently selected trust. This establishes only the claims covered by those artifacts and keys.
2. **Cross-evidence binding.** A context commitment can establish that an exact external digest was included in the principal-signed authorization. A supported composition verifier may additionally match the attached artifact, validity window, transaction and execution fields. The partner artifact retains its own trust domain and semantics.
3. **Runtime decision use.** A commitment does not prove that an external application read the committed field, recomputed a decision or placed every signer path behind that decision. Those claims require separately reviewed integration evidence such as boundary-owned counters, negative tests, source-path review and a pinned implementation revision. PriorSeal receipts do not infer this level.
4. **Observed execution and compliance.** PriorSeal records an issuer's EVM observation and separately reports execution state and authorization compliance. Missing, pending, reorged or unrelated evidence remains `NOT_ASSESSABLE`; a confirmed correlated execution that differs from the authorization is `NON_COMPLIANT`.

## Display rules

- `VERIFIED` means the local verifier completed within its stated scope. It does not mean the issuer is trusted unless the reviewer independently confirmed the key configuration.
- `MATCHED` means every relationship supported by the selected review profile matched. Unsupported attachments remain unverified and cannot create a complete result.
- `NOT_ESTABLISHED` is not a policy violation. It means the imported evidence does not prove that claim.
- Runtime decision use is always shown as `NOT_ESTABLISHED` for a native PriorSeal receipt or review manifest. A partner's separately reviewed conformance report remains external evidence and must not be converted into a PriorSeal self-claim.

## Partner and protocol boundaries

- Partner namespaces and commitment bytes remain partner-owned. PriorSeal binds and matches them without silently importing their business semantics.
- A correlation result does not merge trust roots, verdicts or authority. Use wording such as “execution correlated to the principal-signed authorization and the external decision,” not “externally authorized execution,” unless the external protocol itself establishes that authority.
- Existing WAK envelopes, namespaces, fixed fixtures and repository ownership remain unchanged. Any runtime-enforcement conclusion belongs to the separately reviewed WAK implementation and revision, not to a PriorSeal receipt.
- Supersession, correction and dispute metadata do not by themselves revoke an earlier signed artifact or establish an adjudication process.

This separation lets Insight remain independently usable for assessment evidence, PriorSeal remain independently usable for authorization and execution evidence, and the combined workflow show exactly which cross-system relationships were established without overstating control, adoption, endorsement or economic safety.
