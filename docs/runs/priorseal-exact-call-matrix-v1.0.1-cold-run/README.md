# PriorSeal exact-call matrix v1.0.1 — independent cold-run packet

This packet records how to reproduce the published synthetic matrix from a clean
checkout and gives a consistent, reviewable result format. External v1.0.1
replays and a separately written reader have since been reported; their scopes
are recorded below and in the [independent-review disposition](INDEPENDENT-REVIEW-DISPOSITION.md).

## Frozen inputs

- Repository: <https://github.com/imokokok/PriorSeal>
- Repository commit: `2ff89d86611257b4440232e5c2793926b3d52043`
- Matrix: `examples/open-evidence-lab-exact-call-matrix-v1/`
- Contract version: `1.0.1`
- Committed runner report SHA-256: `223db1554639f242eae559b1f010dcabe3e9466e610cfa95aefe2e1ce564a363`

The commit is the reproducibility pin. The contract version is the version of
the matrix interface; the independent run should record both values.

## Run from a clean checkout

Use Node.js 22 or later and a POSIX shell. Copy this block into a fresh
directory. Do not add `--write`; the check should leave the pinned checkout
unchanged.

```sh
set -eu
git clone https://github.com/imokokok/PriorSeal.git priorseal-v1.0.1-cold-run
cd priorseal-v1.0.1-cold-run
git checkout --detach 2ff89d86611257b4440232e5c2793926b3d52043
test "$(git rev-parse HEAD)" = "2ff89d86611257b4440232e5c2793926b3d52043"
node --version
npm --version
npm ci
node examples/open-evidence-lab-exact-call-matrix-v1/verify.mjs > /tmp/priorseal-v1.0.1-cold-run-report.json
cmp /tmp/priorseal-v1.0.1-cold-run-report.json examples/open-evidence-lab-exact-call-matrix-v1/report.json
node -e 'const {createHash}=require("node:crypto"); const {readFileSync}=require("node:fs"); console.log(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' /tmp/priorseal-v1.0.1-cold-run-report.json
```

`npm ci` may need access to the package registry to install the pinned
dependencies. The matrix command itself uses local files and requires no
network access. The command exits non-zero if a check fails. If `npm ci`, the
runner, or `cmp` fails, preserve the actual output and report the failure; do
not edit the fixture or expected results to make the run pass.

## Expected result

- `summary.result` is `PASS` and all six cases have `pass: true`.
- The authorizer recovery matches the declared signer, the acceptance
  signature verifies, and the authorization check at `notBefore` passes.
- The runner output is byte-identical to the committed `report.json`; its
  SHA-256 is the value listed above.
- Case 04 reports the envelope as `bound: true`, with
  `EXECUTION_UNAVAILABLE` in `availabilityCodes`, and the outcome remains
  `UNDETERMINED`. The report also preserves the shipped profile's raw binding
  (`bound: false`) for that case; v1.0.1 applies the published availability
  partition in the comparison.
- Case 05 reports both `OUTSIDE_TIME_WINDOW` and
  `OUTSIDE_AUTHORIZATION_WINDOW` for the late `executedAt` value.

Expected values are public in `expected.json` and `report.json`. This is an
answer-exposed reproducibility run, not a blind benchmark.

## What to report

Copy [RESULT-TEMPLATE.md](RESULT-TEMPLATE.md) into a reply or attach it to the
OEL evidence-run record. Include the command and the actual outputs needed to
review the claim. Redact personal paths or machine identifiers if desired;
never include credentials, private keys, or environment secrets.

A clean run of the published runner establishes repeatability of this pinned
artifact on the reported environment. Running the included reader is not a new
independent implementation. If you also write or update a reader from
`INPUT-CONTRACT.md`, describe that separately and identify which checks it
independently implements.

## Reported external runs

The following records are separate evidence types and should not be combined
into a broader claim:

- [Fresh-clone runner report](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6134006661): pinned v1.0.1, 6/6 PASS, byte-identical to the committed report. Expected results were public, and the published `verify.mjs` was used; this was not an independent reader. The operator also disclosed an npm audit result of one low and one high finding.
- [Second fresh-clone replay](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6140571875): pinned v1.0.1, 6/6 PASS and byte-identical output on Ubuntu 22.04.5 / Node 20.20.2. This is below the packet's requested Node 22, so it is recorded as an additional replay rather than a run meeting the stated environment requirement.
- [Independent Python reader report](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6144104923): 89 comparable fields equal, 0 different, 13 not comparable. It checked hashes, signatures, case comparisons and selected lifecycle behavior from published materials. Its eight specification/documentation findings and boundaries are listed in the disposition.
- [Independent reader rerun](https://github.com/probityai/agent-evidence-atlas/issues/64#issuecomment-6155239434): a second operator reproduced the independent reader's comparison, with the reported output differing only in the recorded Python version.

These are answer-exposed synthetic checks. They do not establish real-chain
behavior, production use, a security audit, adoption, integration, a pilot, or
endorsement.

## Scope

The data and keys are synthetic public test material. This run makes no claim
about real-chain observation, transaction execution or finality, production
key custody, a security audit, adoption, integration, pilot, or endorsement.
The PriorSeal producer's raw case-04 binding is not changed by this matrix
revision; the report records it separately from the v1.0.1 contract
partition.
