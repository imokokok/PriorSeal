# Author-produced verification report

Date: 2026-09-20 (Asia/Shanghai). Operator: YuTao Peng / imokokok. This is an author-produced run of the adapter and the APS producer's verifier, not an independent implementation or certification.

Source: APS producer commit `948f99b85343bef2c6fa677c8543965caacfc087`; PriorSeal base `3cb63140ea4a5ee167caa316c1b66efdb7d1a5ce`. Example dependencies are registry `agent-passport-system@6.0.1`, `priorseal-sdk@0.4.0`, `viem@2.56.3`, installed from the example lockfile. Local runtime: Node.js 25.2.1; CI targets Node.js 22.

| Check | Result |
|---|---|
| Byte comparison of all four upstream case directories | Identical |
| Pinned producer manifest and its 17 JSON file digests | Match |
| Unmodified APS `verify-from-package-root.mjs` | `ALL CHECKS PASSED`, exit 0 |
| Adapter suite | 24 tests passed, 0 failed |
| Offline JSON report | Six expected outcomes, exit 0 |
| PriorSeal lint / format / typecheck / contracts / unit tests / build / web performance | Passed |
| Worker dry-run / browser E2E / coverage thresholds | Passed |
| Root production dependency audit | 0 vulnerabilities |
| Isolated example production dependency audit | 0 vulnerabilities |

The full local `release:check` command reached its final npm audit, whose direct request failed with `ECONNRESET`. Repeating that audit through the configured local proxy succeeded, as did the separate example audit. No failed code or test assertion was ignored.

The receipt-type negative test creates two in-memory, correctly signed generic receipt envelopes using public `createReceiptV1`. Their original bound decision ref is carried unchanged. Both pass generic/composite verification but fail the adapter's receipt-type or `prev` relationship checks. This does not regenerate APS decision evidence or use a nonpublic decision-ref builder.

The narrow predicate negatives exercise the adapter's explicit local mapping directly; they do not claim newly APS-issued narrow decisions. PriorSeal negative receipts are freshly principal-signed so commitment, window and call mismatches are tested independently of a broken signature. The producer's APS input files remain unchanged.

The execution mismatch retains valid signatures and decision/authorization correlation but reports `NON_COMPLIANT`. Unrelated execution reports `NOT_ASSESSABLE` and cannot produce a successful execution-correlation claim. The repeated decision is carried by two distinct authorizations and reports `singleUseEstablished: false`.

No RPC call or real transaction is made. Live revocation, APS policy correctness, action-ref recomputation, durable single-use enforcement and real-chain execution are outside this report.
