# Repository collaboration rules

## Product and commercialization scope

- Treat Insight and PriorSeal as a three-part commercial portfolio by default: Insight can be sold independently, PriorSeal can be sold independently, and Insight + PriorSeal can be sold as an integrated decision, authorization, execution, and verification evidence workflow.
- Do not narrow customer discovery, positioning, partnerships, pricing, or go-to-market work to PriorSeal alone unless the user explicitly asks for PriorSeal-only work.
- When evaluating prospects, identify which of the three offers fits the buyer instead of assuming that every prospect should buy both products.

## Public identity and product links

- Use `YuTao Peng` as the user's full name.
- Add the `YuTao Peng` signature only to emails. Do not add a name/signature closing to GitHub comments, Issues, Discussion replies, direct messages, private messages, chat messages, or similar conversational posts unless the user explicitly requests one for that specific message.
- Insight website: `https://www.oracleinsight.xyz/`
- Insight GitHub: `https://github.com/imokokok/Insight.git`
- PriorSeal website: `https://priorseal.xyz/`
- PriorSeal GitHub: `https://github.com/imokokok/PriorSeal.git`

## Git identity and publishing

- For authorized GitHub work, reuse the existing GitHub CLI authentication with `gh` while `gh auth status` confirms it is valid. Do not ask the user to log in again while that stored session works. If it expires, start the standard `gh auth login --hostname github.com --web --git-protocol https` flow and let the user complete any browser/device authorization. Never ask the user to paste a token into chat, print long-lived credentials, or write GitHub tokens into repository files, project instructions, or Codex memory.
- During GitHub device authorization, show the user the current one-time device code and verification URL in the active conversation when needed for their approval. Never store the device code; if it expires, start a fresh device flow.
- Before creating or rewriting a commit, verify that both author and committer use `imokokok <145034722+imokokok@users.noreply.github.com>`.
- Never use a generated, agent, shared-machine, or other third-party identity for commits in this repository.
- Before reporting a push as successful, verify `origin/main` (or the requested remote ref) by SHA.
- For GitHub network operations, try the configured direct connection first. If it fails or times out, automatically detect and retry through the user's local proxy without waiting for another instruction. When ClashX is listening on `127.0.0.1:7890`, prefer command-scoped `git -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 ...` settings; do not persist proxy settings globally.
- Using a proxy must never change the required author or committer identity. Re-verify both identities before committing and verify the requested remote ref by SHA after pushing.
- Preserve remote history by default. Use a force push only when the user explicitly requests a history rewrite, and prefer `--force-with-lease`.

## Local Node.js version

- The repository pins Node.js `22.23.2` in `.node-version` and `.nvmrc`. CI reads `node-version-file: .node-version`, the production image uses `node:22.23.2-alpine`, and `engines.node` stays `22.x`.
- Run `nvm use` (or `fnm use`) after entering the repository. `npm run prepare` does not install a Node version for you, so a shell that defaults to another major will fail the CI parity step.
- A shell hook that switches automatically is optional; if you add one, keep it scoped to this directory. Do not change the machine-wide default Node.js version for other projects.

## TypeScript source policy

- Write all new production, integration, deployment, migration, and operational source code in TypeScript. Use `.mts` for Node ESM code and `.ts`/`.tsx` in the SDK and web workspaces.
- Treat checked-in `.mjs` files beside `.mts` files as generated runtime artifacts. Edit the TypeScript source and run `npm run core:build`; never edit those generated files directly.
- JavaScript is allowed only for reviewed build tooling, frozen portable examples, generated standalone verifiers, and legacy tests that have not yet justified migration. Adding a new JavaScript exception requires an explicit repository-policy change.
- Keep runtime validation at every untrusted JSON, signature, RPC, HTTP, environment, and persistence boundary; TypeScript types do not replace protocol validation.

## Local Vercel access

- The user authorized reuse of the saved Vercel credential in future tasks. On this workstation, load `VERCEL_TOKEN` from `/Users/imokokok/Documents/insight/.env.vercel.local` for authorized Vercel work; do not ask the user to supply it again while it remains valid.
- This private, Git-ignored file also holds the verified Insight Vercel team/project identifiers when available. PriorSeal production runs on Cloudflare; do not change its hosting provider as part of credential configuration.
- Never print the credential, put it in tracked files, expose it to browser code, or add it to application runtime variables. For Node commands, use `--env-file=/Users/imokokok/Documents/insight/.env.vercel.local`; API tools should load it privately and use the Authorization header.
- Reusing a credential does not authorize unrelated deployments or account changes. If authentication fails, report the failure and request a replacement only when needed.

## Partner joint-run instructions

- For partner integration preparation, rehearsal, fresh bundles, live execution, post-run verification, or replies, first read `/Users/imokokok/Documents/partnerships/AGENTS.md`, then `/Users/imokokok/Documents/partnerships/COLLABORATION-DOCS-STANDARD.md`, then `/Users/imokokok/Documents/partnerships/JOINT-RUN-PLAYBOOK.md`. Continue with the partnerships root README, the partner README, and the current stage fact sources. These rules supplement this repository's rules.
- Apply this read order at a new joint-run task/window or context resumption. Within an unchanged continuous task, reuse already-read rules and recheck changed rules and the latest partner status. Dated retrospectives explain historical lessons; current partner facts determine scope, permissions and protocol conditions.
- Follow the user's order for rehearsals and live runs: perform the authorized work and preserve raw evidence immediately; deliver complete English and Chinese replies in the conversation, explicitly stating required attachments and final files or no attachment; update formal collaboration documents last. Preserve existing authorization and required per-bundle GO or single-send gates; do not mark a draft as sent.

## Parallel agent worktrees

- One task = one branch = one worktree in `~/Documents/insight-worktrees/PriorSeal-<slug>`. Never do feature work, `git checkout`, `git reset --hard`, `git clean`, or `git stash` in the primary checkout.
- Run the shared tool from this repository's root with `node ~/Documents/insight/scripts/worktree.mjs <command>`. The script prints the exact commands for this repository; there is no `npm run wt` here.
- Declare the files a task will touch with `create <slug> --paths "..."`. A refused claim means another active task owns that path; coordinate instead of overriding.
- Dependency manifests (`package.json`, any nested lockfile), cron bundles, and migration files are serial by category. A dependency change requires `deps <slug> --isolate` before `npm install`; never install through the shared `node_modules` symlink.
- `status` reports the stage each task is stuck in and the next action. `ship` is the only commit/push/PR/auto-merge path; it verifies the required `release-check` gate before merging and refuses on overlap with another open PR.
- Write `.handoff.local` with `handoff <slug> --next "..."` before a long pause; resume with `resume <slug>` instead of re-deriving context.
