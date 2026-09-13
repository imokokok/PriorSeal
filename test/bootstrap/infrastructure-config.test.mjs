import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('container development uses the supported runtime without sending local secrets', async () => {
  const [dockerfile, dockerignore, compose] = await Promise.all([read('Dockerfile'), read('.dockerignore'), read('docker-compose.yml')]);
  assert.doesNotMatch(dockerfile, /node:20/);
  assert.match(dockerfile, /FROM node:22-alpine/);
  assert.match(dockerfile, /COPY migrations \.\/migrations/);
  assert.match(dockerignore, /^\.env\.\*$/m);
  assert.match(dockerignore, /^\.priorseal$/m);
  assert.match(dockerignore, /^\*\*\/\*\.pem$/m);
  assert.match(compose, /env_file: \.env\.local/);
  assert.match(compose, /PRIORSEAL_PRIVATE_KEY_FILE: \/run\/secrets\/priorseal-issuer-private\.pem/);
  assert.match(compose, /target: priorseal-issuer-private\.pem/);
  assert.match(compose, /file: \$\{PRIORSEAL_PRIVATE_KEY_FILE:\?Set PRIORSEAL_PRIVATE_KEY_FILE in \.env\.local\}/);
  assert.match(compose, /condition: service_completed_successfully/);
  assert.match(compose, /command: \["node", "scripts\/migrate\.mjs"\]/);
});

test('Worker configuration binds rate limiting and immutable version metadata', async () => {
  const config = JSON.parse(await read('wrangler.jsonc'));
  assert.equal(config.version_metadata.binding, 'CF_VERSION_METADATA');
  assert.equal(config.ratelimits[0].name, 'HTTP_RATE_LIMITER');
  assert.equal(config.ratelimits[0].simple.limit, 60);
  assert.equal(config.vars.PRIORSEAL_BUILD_VERSION, undefined);
});
