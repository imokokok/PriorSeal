# ADR 002: Core language and type checking

## Original decision

The Node ESM core retained JavaScript, explicit runtime validation, and selective JSDoc checking to avoid a large protocol rewrite. The decision would be revisited after public SDK extraction or repeated boundary and type defects.

## Amendment (2026-09-22): incremental TypeScript sources

The public TypeScript SDK now exists. Core protocol and application modules moved to `.mts` sources while Node and Worker entry points continue to import checked-in `.mjs` runtime files. Runtime validation remains mandatory because protocol inputs and signed evidence are untrusted.

`npm run core:build` generates each `.mjs` file from its `.mts` source. `npm run core:check` checks that every generated file is present and current, including before a production build. `npm run typecheck` checks all `src/**/*.mts` sources with strict TypeScript settings. Protocol golden vectors and runtime input validation remain required.

## Completion (2026-09-22): production source migration

Every runtime module under `src/` now has a TypeScript source. The existing `.mjs` paths remain generated deployment artifacts so Node, Workers, the SDK bundle, and callers retain their runtime imports. `src/domain/rfc3161-source.mts` generates `src/domain/rfc3161.mjs`; the distinct source name preserves the SDK's narrow `rfc3161.d.mts` type boundary. `npm run core:check` also rejects runtime files without a TypeScript source. Worker platform and binding types are generated from Wrangler configuration and checked in CI. Tests, examples, and operational scripts remain JavaScript until a concrete interface or maintenance need justifies converting them.

The follow-up pass typed authorization and timestamp evidence, policy parsing, RWA attempt journals, observation jobs, RPC responses, archive access, observation orchestration, and both persistence adapters. External JSON still crosses runtime validation. The Cloudflare Node HTTP adapter retains two local structural casts for its narrower upstream declarations.

## Amendment (2026-09-23): TypeScript-first maintenance policy

All new production, integration, deployment, migration and operational source code must be TypeScript. Node ESM maintenance sources use `.mts`; their checked-in `.mjs` files are generated compatibility artifacts. Strict checking for these sources is configured in `tsconfig.maintenance.json`, and `npm run source:policy` rejects new handwritten JavaScript in production source trees or operational scripts unless the repository policy explicitly records a reviewed exception.

The production deployment, database migration, readiness, smoke, transparency-anchor, key-rotation, local execution drill, D1 adapter check, RWA execution-profile verification and portfolio integration scripts have TypeScript sources. Shared durable-state and RWA workflow fixtures, plus authorization and RPC boundary tests, are also checked TypeScript. Their `.mjs` counterparts are generated compatibility artifacts.

## Completion (2026-09-24): maintained tooling and tests

All maintained operational and vector-generation logic now has strict `.mts` sources, and every repository test has a checked TypeScript source. Mutation-heavy adversarial suites isolate intentionally malformed values at narrow fixture adapters while the surrounding control flow remains strictly checked. Portable examples, standalone verifier bundles, vendored code, and the minimal `build-core.mjs` bootstrap remain reviewed JavaScript because JavaScript is part of their distribution or bootstrapping contract. The frozen WAK bundle documentation retains one Python compatibility launcher that only replaces its process with the TypeScript packager; it contains no packaging logic. Runtime parsing and validation remain authoritative for every untrusted input.
