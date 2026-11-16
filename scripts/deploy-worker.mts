import { execFileSync, spawnSync } from 'node:child_process';

type WorkerVersion = {
  id: string;
  number: number;
  annotations?: Record<string, string>;
};

type WorkerDeployment = {
  id: string;
  versions?: Array<{ version_id: string; percentage: number }>;
};

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Refusing to deploy a dirty worktree; commit the exact release contents first');
try {
  execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { stdio: 'inherit' });
} catch {
  throw new Error('Refusing to deploy without a fresh origin/main reference');
}
const revision = git('rev-parse', 'HEAD');
if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Could not determine the release Git SHA');
const mainRevision = git('rev-parse', 'origin/main');
if (revision !== mainRevision) throw new Error(`Refusing to deploy ${revision}: production must deploy the exact origin/main commit ${mainRevision}`);

const result = spawnSync('npm', ['exec', '--', 'wrangler', 'deploy', '--env', '', '--tag', revision, '--var', `PRIORSEAL_BUILD_VERSION:${revision}`, '--message', `Git ${revision}`], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
const status = result.status ?? 1;
if (status !== 0) {
  process.exitCode = status;
} else {
  const readWranglerJson = <T,>(args: string[]): T => {
    const inspection = spawnSync('npm', ['exec', '--', 'wrangler', ...args, '--json'], {
      encoding: 'utf8',
      env: process.env,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    if (inspection.error) throw inspection.error;
    if ((inspection.status ?? 1) !== 0) throw new Error(`Wrangler ${args.join(' ')} failed while verifying the release`);
    try {
      return JSON.parse(inspection.stdout.trim()) as T;
    } catch {
      throw new Error(`Wrangler ${args.join(' ')} returned invalid JSON while verifying the release`);
    }
  };

  const verifyPublishedRelease = async () => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        const versions = readWranglerJson<WorkerVersion[]>(['versions', 'list', '--env', '']);
        const version = versions.find((candidate) => candidate.annotations?.['workers/tag'] === revision);
        if (!version) throw new Error(`No Cloudflare Worker version is tagged with ${revision}`);

        const deployments = readWranglerJson<WorkerDeployment[]>(['deployments', 'list', '--env', '']);
        const activeDeployment = deployments.find((deployment) => deployment.versions?.some((entry) => entry.version_id === version.id && entry.percentage === 100));
        if (!activeDeployment) throw new Error(`Cloudflare Worker version ${version.number} is not deployed at 100%`);

        console.log(`Verified Cloudflare Worker version ${version.number} (${version.id}) at 100% with Git SHA ${revision}`);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    throw lastError;
  };

  await verifyPublishedRelease();
}
