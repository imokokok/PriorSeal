# ADR 003: Native Node HTTP
**Context:** API surface is small and has no routing-framework need. **Decision:** retain Node HTTP behind `interfaces/http`. **Alternatives:** Express/Fastify. **Consequences:** middleware and validation stay explicit and testable; framework features are not free. **Revisit triggers:** complex authentication, content negotiation, or a materially larger route set.
