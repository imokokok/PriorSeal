# Code organization

The source tree follows a dependency rule: outer layers may depend on inner layers, but domain code must not depend on HTTP, persistence, or blockchain implementations.

```text
src/
  domain/          Pure protocol models, validation, hashing, signatures, and policy rules
  application/     Use cases and background-work orchestration
  infrastructure/  EVM RPC, key-file, and persistence adapters
  interfaces/      Transport-specific request handling and response writing
  bootstrap/       Process startup and environment wiring
  index.mjs        Stable local library surface
```

`examples/` contains runnable, non-production walkthroughs. They write generated material only beneath `examples/receipt-artifacts/`, which is ignored by Git. Tests mirror the source layers under `test/`.

When adding a feature, start with the domain rule or value object, add an application use case when orchestration is required, then implement the infrastructure adapter and interface. Keep adapter construction in `bootstrap/`; inject dependencies into application code and HTTP server factories.
