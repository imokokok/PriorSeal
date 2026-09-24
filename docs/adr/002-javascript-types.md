# ADR 002: Core language and type checking

## Original decision

The Node ESM core retained JavaScript, explicit runtime validation, and selective JSDoc checking to avoid a large protocol rewrite. The decision would be revisited after public SDK extraction or repeated boundary and type defects.

## Amendment (2026-09-22): incremental TypeScript sources

The public TypeScript SDK now exists. Core protocol and application modules moved to `.mts` sources while Node and Worker entry points continue to import checked-in `.mjs` runtime files. Runtime validation remains mandatory because protocol inputs and signed evidence are untrusted.

`npm run core:build` generates each `.mjs` file from its `.mts` source. `npm run core:check` checks that every generated file is present and current, including before a production build. `npm run typecheck` checks all `src/**/*.mts` sources with strict TypeScript settings. Protocol golden vectors and runtime input validation remain required.

## Completion (2026-09-22): production source migration

Every runtime module under `src/` now has a TypeScript source. The existing `.mjs` paths remain generated deployment artifacts so Node, Workers, the SDK bundle, and callers retain their runtime imports. `src/domain/rfc3161-source.mts` generates `src/domain/rfc3161.mjs`; the distinct source name preserves the SDK's narrow `rfc3161.d.mts` type boundary. `npm run core:check` also rejects runtime files without a TypeScript source. Worker platform and binding types are generated from Wrangler configuration and checked in CI. At this point in the migration, tests, examples, and operational scripts remained JavaScript pending separate conversion.

The follow-up pass typed authorization and timestamp evidence, policy parsing, RWA attempt journals, observation jobs, RPC responses, archive access, observation orchestration, and both persistence adapters. External JSON still crosses runtime validation. The Cloudflare Node HTTP adapter retains two local structural casts for its narrower upstream declarations.

## Amendment (2026-09-23): TypeScript-first maintenance policy

All new production, integration, deployment, migration and operational source code must be TypeScript. Node ESM maintenance sources use `.mts`; their checked-in `.mjs` files are generated compatibility artifacts. Strict checking for these sources is configured in `tsconfig.maintenance.json`, and `npm run source:policy` rejects new handwritten JavaScript in production source trees or operational scripts unless the repository policy explicitly records a reviewed exception.

The production deployment, database migration, readiness, smoke, transparency-anchor, key-rotation, local execution drill, D1 adapter check, RWA execution-profile verification and portfolio integration scripts have TypeScript sources. Shared durable-state and RWA workflow fixtures, plus authorization and RPC boundary tests, are also checked TypeScript. Their `.mjs` counterparts are generated compatibility artifacts.

## Progress (2026-09-24): maintained tooling and tests

Maintained operational and vector-generation logic has `.mts` sources compiled with `strict` TypeScript settings, and every repository test has a checked TypeScript source. This establishes TypeScript source coverage, not complete type safety: some vector generators, example adapters, and adversarial tests still use explicit `any`. Mutation-heavy adversarial suites intentionally construct malformed values at fixture boundaries. Portable examples, standalone verifier bundles, vendored code, and the minimal `build-core.mjs` bootstrap retain JavaScript runtime files for distribution or bootstrapping. The frozen WAK bundle documentation also retains a Python compatibility launcher that only replaces its process with the TypeScript packager. Runtime parsing and validation remain authoritative for every untrusted input.

The maintained Insight/BoundaryAttest JCS helper now has a checked `.mts` source and a generated `.mjs` fixture runtime. Production smoke and integration diagnostics treat remote JSON as `unknown` and validate the fields they use before reporting success; pinned portable verifier bundles and historical WAK packages keep their existing distribution format.

## Progress (2026-09-24): owned examples

Current owned example entry points, including the receipt and RWA walkthroughs, have TypeScript sources and generated `.mjs` entry points for Node compatibility. Historical partner verification files have checked `.reference.mts` counterparts, but their original `.mjs` files remain the actual inputs or entry points of the published fixture versions. Their bytes are pinned by SHA-256 in `scripts/build-core.mts` because existing fixture manifests and distributed packages identify those exact bytes. A TypeScript reference does not make those historical versions TypeScript-built. The 402Signal standalone verifier and WAK v1.0.1 bundle are built from TypeScript sources; the WAK v1 bundle still builds from its frozen JavaScript source. The 402Signal route-guard file is reviewed third-party vendor code.

## Remaining migration and type-hardening work (audit 2026-09-24)

The repository still has first-party migration work. The file-extension inventory alone is misleading: 207 tracked `.mjs` files include generated runtime output, frozen first-party JavaScript, bundled output, and vendored code. Thirteen do not have an adjacent same-name `.mts`: eight frozen sources, three standalone bundles, one vendored file, and `src/domain/rfc3161.mjs` (generated from the deliberately distinct `rfc3161-source.mts`). `npm run source:policy` checks the declared exceptions and `npm run core:check` checks generated files and frozen hashes; passing both does not mean every historical verifier is built from TypeScript.

| Area | Current state | Completion condition |
| --- | --- | --- |
| Historical partner verifiers | Eight first-party `.mjs` files are pinned and have `.reference.mts` counterparts, listed below. The WAK v1 standalone bundle is built from its JavaScript source. | Publish new fixture versions whose build reads checked TypeScript sources and produces new manifests and hashes. Keep the existing versions byte-for-byte intact and retain their reviewed exceptions while those versions remain supported. |
| TypeScript type quality | Explicit `any` remains in several vector-generation and operational scripts, the maintained APS example adapter, frozen TypeScript references, and test fixtures. `strict: true` does not reject explicit `any`. | Replace `any` at maintained input, JSON, RPC, and fixture boundaries with `unknown` plus validation or defined types. Keep narrow, documented casts only where tests deliberately pass malformed data. Prioritize scripts that read external data or produce signed vectors. |
| Python compatibility entry | `scripts/package-web3-agent-kit-integration-spike-v1.py` invokes the generated `.mjs` packager. Frozen WAK README files still instruct users to call it. | Document the Node/TypeScript-backed command in new package versions. Retain the launcher while supported frozen READMEs require it; remove it only when that compatibility obligation ends. |

The eight historical JavaScript sources are `examples/boundaryattest-paired-v0.2/{jcs,verify}.mjs`, `examples/insight-boundaryattest-three-object-v0.2/verify.mjs`, `examples/thoughtproof-sentinel-paired-v1/verify.mjs`, `examples/thoughtproof-sentinel-paired-v2/verify.mjs`, `examples/thoughtproof-sentinel-paired-v2-final/verify.mjs`, `examples/web3-agent-kit-base-swap-v1/verify.mjs`, and `examples/web3-agent-kit-integration-spike-v1/verify.source.mjs`.

The checked-in `.mjs` files generated from current `.mts` sources are runtime artifacts, not pending source migrations. Standalone `verify.mjs` bundles remain JavaScript output by design. The 402Signal `vendor/route-guard-v0.7.3.mjs` is third-party code and should be updated from its reviewed upstream source rather than rewritten as project TypeScript. SQL migrations, Solidity contracts, and HTML are separate source languages and are outside this TypeScript migration.
