# Repository collaboration rules

## Git identity and publishing

- Before creating or rewriting a commit, verify that both author and committer use `imokokok <145034722+imokokok@users.noreply.github.com>`.
- Never use a generated, agent, shared-machine, or other third-party identity for commits in this repository.
- Before reporting a push as successful, verify `origin/main` (or the requested remote ref) by SHA.
- For GitHub network operations, try the configured direct connection first. If it fails or times out, automatically detect and retry through the user's local proxy without waiting for another instruction. When ClashX is listening on `127.0.0.1:7890`, prefer command-scoped `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 ...` settings; do not persist proxy settings globally.
- Using a proxy must never change the required author or committer identity. Re-verify both identities before committing and verify the requested remote ref by SHA after pushing.
- Preserve remote history by default. Use a force push only when the user explicitly requests a history rewrite, and prefer `--force-with-lease`.
