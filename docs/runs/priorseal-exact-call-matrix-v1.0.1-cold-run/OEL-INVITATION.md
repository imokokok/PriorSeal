# Draft invitation for Open Evidence Lab issue #49

This is a draft to post after the packet is available in the public PriorSeal
repository. It requests an external run; it does not represent a completed run
or a commitment from any reviewer.

---

Hi @Tetsurohhori — thanks again for independently reading and running the
pinned v1.0.0 fixture, and for identifying the gaps that led to the v1.0.1
contract clarifications.

The v1.0.1 matrix is now pinned at
[`2ff89d8`](https://github.com/imokokok/PriorSeal/tree/2ff89d86611257b4440232e5c2793926b3d52043).
I prepared a [clean-checkout run guide](https://github.com/imokokok/PriorSeal/tree/main/docs/runs/priorseal-exact-call-matrix-v1.0.1-cold-run)
and a [result template](https://github.com/imokokok/PriorSeal/blob/main/docs/runs/priorseal-exact-call-matrix-v1.0.1-cold-run/RESULT-TEMPLATE.md).

Would you, or another operator, be willing to run the pinned v1.0.1 matrix
from a fresh clone and report the environment, exact command, exit status,
report hash, and any differences? The two revision-sensitive checks are case
04's separate availability code with `bound: true` / `UNDETERMINED`, and case
05's late `executedAt` with both time-window reason codes. The expected output
is public, so this is a reproducibility run rather than a blind benchmark.

A run of the published command would establish repeatability on the reported
environment. If you also choose to independently implement or update a reader
from the contract, please report that as a separate check. Any result can be
added to the [OEL evidence-run record](https://github.com/probityai/agent-evidence-atlas/issues/64);
this invitation itself does not imply that an independent v1.0.1 run has
happened.

---
