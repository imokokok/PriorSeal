# Code organization

The source tree follows a dependency rule: outer layers may depend on inner layers, but domain code must not depend on HTTP, persistence, or blockchain implementations.

```text
src/
  domain/          Pure protocol models, validation, hashing, signatures, and policy rules
  application/     Use cases and background-work orchestration
  infrastructure/  EVM RPC, key-file, and persistence adapters
  interfaces/      Transport-specific request handling and response writing
  bootstrap/       Process startup and environment wiring
  index.mts        Stable local library source (`index.mjs` is generated)
```

`examples/` contains runnable, non-production walkthroughs. They write generated material only beneath `examples/receipt-artifacts/`, which is ignored by Git. Tests mirror the source layers under `test/`.

Maintained runtime, SDK, web, test, and operational sources are TypeScript. Run `npm run core:build` after changing `.mts` runtime or example files; it checks core, SDK, and maintenance types before generating checked-in `.mjs` entry points. `npm run core:check` detects stale committed output and any stale on-demand script output already present locally. Test `.mjs` files are ignored build products: `npm run test:prepared` and `npm run test:coverage:prepared` typecheck and generate them from `.mts` before running. Use `npm run core:build:operations` and `npm run core:build:tests` before invoking test files directly, because two tests import operational helpers. Vector generators are also ignored build products; their npm commands generate them on demand, or use `npm run core:build:generators` before invoking one directly. Local QA and build helpers (web performance, contract compilation, preview, Worker deployment, and RWA execution checks) use the same pattern through `npm run core:build:tools`; their npm commands prepare them before use. Operational diagnostics (transparency anchors, production readiness and smoke checks, and rotation impact) use `npm run core:build:operations`; their documented npm commands build them before use. `npm run portable:check` compares the 402Signal and WAK v1.0.1 standalone bundles with their TypeScript-backed builds. Some published example verifiers keep their original JavaScript bytes for reproducible evidence. Their maintained reference sources are TypeScript, while the 402Signal route guard is a pinned third-party file. The source policy rejects new JavaScript exceptions and missing TypeScript counterparts.

When adding a feature, start with the domain rule or value object, add an application use case when orchestration is required, then implement the infrastructure adapter and interface. Keep adapter construction in `bootstrap/`; inject dependencies into application code and HTTP server factories.
