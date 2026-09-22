# ADR 002: Core language and type checking

## Original decision

The Node ESM core retained JavaScript, explicit runtime validation, and selective JSDoc checking to avoid a large protocol rewrite. The decision would be revisited after public SDK extraction or repeated boundary and type defects.

## Amendment (2026-09-22): incremental TypeScript sources

The public TypeScript SDK now exists. Core protocol and application modules are being migrated incrementally to `.mts` sources while Node and Worker entry points continue to import checked-in `.mjs` runtime files. This replaces the original JavaScript-source decision for migrated modules; unmigrated modules remain JavaScript. Runtime validation remains mandatory because protocol inputs and signed evidence are untrusted.

`npm run core:build` generates each `.mjs` file from its `.mts` source. `npm run core:check` checks that every generated file is present and current, including before a production build. `npm run typecheck` checks all `src/**/*.mts` sources with strict TypeScript settings. Continue migrating module by module and preserve protocol golden vectors and runtime input validation.
