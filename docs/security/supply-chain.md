# Supply-chain controls

PriorSeal uses GitHub Actions and published artifacts as part of its release evidence. These controls help reviewers inspect the software supply chain; they do not replace independent review of an authorization, receipt, deployment, or signing key.

## Code scanning

The [CodeQL workflow](../../.github/workflows/codeql.yml) scans JavaScript and TypeScript on pull requests to `main`, pushes to `main`, a weekly schedule, and manual dispatch. It uses GitHub's `security-extended` query suite and reports findings in the repository's Security tab. Scheduled runs are important because GitHub can add or improve queries without a repository change.

CodeQL findings are triaged before a release but are not a claim that the protocol, cryptography, external RPC responses, or deployment configuration is free of defects. See the [threat model](threat-model.md) for the security properties that remain system-dependent.

## SDK release artifacts

Each `sdk-v*` tag release publishes the following release assets:

- The npm tarball and its SHA-256 checksum.
- A reproducible CycloneDX 1.6 JSON SBOM for `priorseal-sdk`, generated from the release commit's SDK lockfile and limited to the SDK's production dependency tree.
- A SHA-256 checksum for the SBOM.

The tarball and SBOM both receive GitHub build provenance attestations. Verify an asset after downloading it:

```bash
shasum -a 256 -c priorseal-sdk-<version>.tgz.sha256
gh attestation verify priorseal-sdk-<version>.tgz -R imokokok/PriorSeal
gh attestation verify priorseal-sdk-<version>.cdx.json -R imokokok/PriorSeal
```

An attestation establishes the artifact's GitHub Actions build provenance. It does not independently establish trust in the repository, tag, maintainer, package registry account, issuer key, or on-chain data. Review those trust decisions separately.

## SBOM generator maintenance

The release workflow installs the CycloneDX generator from [`tools/sbom/package-lock.json`](../../tools/sbom/package-lock.json), which fixes its version and transitive integrity hashes. The lockfile includes the validator required for `--validate`; do not replace this with an unpinned `npx` invocation. Update the tool deliberately, regenerate its lockfile, and confirm `npm audit --prefix tools/sbom --package-lock-only` has no reportable vulnerabilities before merging.
