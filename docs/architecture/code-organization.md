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

Maintained runtime, SDK, web, test, and operational sources are TypeScript. Run `npm run core:build` after changing `.mts` files; it generates checked-in `.mjs` entry points, and `npm run core:check` detects stale output. `npm run portable:check` also compares the 402Signal and WAK v1.0.1 standalone bundles with their TypeScript-backed builds. Some published example verifiers keep their original JavaScript bytes for reproducible evidence. Their maintained reference sources are TypeScript, while the 402Signal route guard is a pinned third-party file. The source policy rejects new JavaScript exceptions and missing TypeScript counterparts.

When adding a feature, start with the domain rule or value object, add an application use case when orchestration is required, then implement the infrastructure adapter and interface. Keep adapter construction in `bootstrap/`; inject dependencies into application code and HTTP server factories.
