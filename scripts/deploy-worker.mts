import { execFileSync, spawnSync } from 'node:child_process';

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Refusing to deploy a dirty worktree; commit the exact release contents first');
const revision = git('rev-parse', 'HEAD');
if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Could not determine the release Git SHA');

const result = spawnSync('npm', ['exec', '--', 'wrangler', 'deploy', '--tag', revision, '--message', `Git ${revision}`], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
