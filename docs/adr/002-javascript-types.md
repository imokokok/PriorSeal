# ADR 002: Core language and type checking

## Original decision

The Node ESM core retained JavaScript, explicit runtime validation, and selective JSDoc checking to avoid a large protocol rewrite. The decision would be revisited after public SDK extraction or repeated boundary and type defects.

## Amendment (2026-09-22): incremental TypeScript sources

The public TypeScript SDK now exists. Core protocol and application modules moved to `.mts` sources while Node and Worker entry points continue to import checked-in `.mjs` runtime files. Runtime validation remains mandatory because protocol inputs and signed evidence are untrusted.

`npm run core:build` generates each `.mjs` file from its `.mts` source. `npm run core:check` checks that every generated file is present and current, including before a production build. `npm run typecheck` checks all `src/**/*.mts` sources with strict TypeScript settings. Protocol golden vectors and runtime input validation remain required.

## Completion (2026-09-22): production source migration

Every runtime module under `src/` now has a TypeScript source. The existing `.mjs` paths remain generated deployment artifacts so Node, Workers, the SDK bundle, and callers retain their runtime imports. `src/domain/rfc3161-source.mts` generates `src/domain/rfc3161.mjs`; the distinct source name preserves the SDK's narrow `rfc3161.d.mts` type boundary. `npm run core:check` also rejects runtime files without a TypeScript source. Worker platform and binding types are generated from Wrangler configuration and checked in CI. Tests, examples, and operational scripts remain JavaScript until a concrete interface or maintenance need justifies converting them.

The follow-up pass typed authorization and timestamp evidence, policy parsing, RWA attempt journals, observation jobs, RPC responses, archive access, observation orchestration, and both persistence adapters. External JSON still crosses runtime validation. The Cloudflare Node HTTP adapter retains two local structural casts for its narrower upstream declarations.
