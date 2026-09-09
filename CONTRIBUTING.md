# Contributing

Use Node 22+ for repository development (`nvm use` reads the checked-in `.nvmrc`). SDK consumers may use Node 20+. Keep protocol changes additive, update golden vectors for deliberate wire changes, and run `npm run release:check` before a pull request. Do not commit `.env`, PEM files, RPC URLs with credentials, database URLs, receipts containing sensitive metadata, or generated `web/dist`.

Before starting a larger change, open an issue describing the evidence or integration problem it solves. Design-partner work follows [COLLABORATING.md](COLLABORATING.md); implementation contributions should include focused tests and any compatibility documentation affected by wire-format changes.
