# Repository collaboration rules

## Git identity and publishing

- Before creating or rewriting a commit, verify that both author and committer use `imokokok <145034722+imokokok@users.noreply.github.com>`.
- Never use a generated, agent, shared-machine, or other third-party identity for commits in this repository.
- Before reporting a push as successful, verify `origin/main` (or the requested remote ref) by SHA.
- Preserve remote history by default. Use a force push only when the user explicitly requests a history rewrite, and prefer `--force-with-lease`.
