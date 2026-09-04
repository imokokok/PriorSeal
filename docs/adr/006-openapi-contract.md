# ADR 006: OpenAPI contract
**Context:** UI and API types can drift. **Decision:** publish versioned OpenAPI at `/openapi/v1.json` and keep additive v1 evolution. **Alternatives:** handwritten documentation only or codegen-only. **Consequences:** contract review becomes explicit; generated client tooling can be introduced later. **Revisit triggers:** multiple external clients or duplicated DTOs.
