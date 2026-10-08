import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
/* global fetch, setTimeout, clearTimeout */

async function run(args, env = {}) {
  const child = spawn('pnpm', args, { stdio: 'inherit', env: { ...process.env, ...env } });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`workspace check exited ${code}`)),
    );
  });
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function start(command, args, env, url) {
  const child = spawn(command, args, { stdio: 'inherit', env: { ...process.env, ...env } });
  child.on('error', () => {});
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('Application failed to start');
      try {
        if ((await fetch(url)).ok) return child;
      } catch {
        /* Bounded readiness polling. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Application readiness timeout');
  } catch (error) {
    await stop(child);
    throw error;
  }
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
  await exited;
  clearTimeout(timer);
}
async function checkProductionBundle() {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const text = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const forbidden of [
      'DEVELOPMENT_FIXTURE_ONLY',
      'DEMO-PROFILE-CANDIDATE',
      'zhiju-workspace-development-fixture-v1',
      'OIDC_SECRET_SENTINEL',
      '@zhiju/artifact',
      '@zhiju/contracts',
      'loadFixture',
    ]) {
      assert(!text.includes(forbidden), `production bundle contains ${forbidden}`);
    }
  }
}

const bffPort = await freePort();
const webPort = await freePort();
const upstream = `http://127.0.0.1:${bffPort}`;
const origin = `http://127.0.0.1:${webPort}`;
let bff;
let web;
try {
  await run(['--filter', '@zhiju/workspace-bff', 'build']);
  await run(['--filter', '@zhiju/workspace-web', 'build'], {
    NODE_ENV: 'production',
    WORKSPACE_FIXTURE_MODE: 'true',
    VITE_WORKSPACE_FIXTURES: 'true',
    OIDC_CLIENT_SECRET: 'OIDC_SECRET_SENTINEL',
  });
  await checkProductionBundle();
  bff = await start(
    'node',
    ['apps/workspace-bff/dist/main.js'],
    { NODE_ENV: 'production', PORT: String(bffPort), WORKSPACE_FIXTURE_MODE: 'true' },
    `${upstream}/bff/health`,
  );
  web = await start(
    'node',
    ['apps/workspace-web/tools/serve.mjs'],
    { NODE_ENV: 'production', PORT: String(webPort), BFF_URL: upstream },
    `${origin}/bff/health`,
  );
  const bootstrap = await fetch(`${origin}/bff/bootstrap`);
  assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await bootstrap.json(), {
    accessState: 'REAUTH_REQUIRED',
    businessActionsEnabled: false,
  });
  for (const path of [
    '/bff/fixture/execute',
    '/bff/upload',
    '/bff/accept-report',
    '/bff/business',
    '/bff/health',
  ]) {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actorKind: 'HUMAN', fixture: true }),
    });
    assert.equal(response.status, 503);
    const error = await response.json();
    assert.equal(error.code, 'UI_SERVICE_NOT_CONFIGURED');
    assert(!JSON.stringify(error).includes('HUMAN'));
  }
  for (const path of [
    '/bff/missing',
    '/api/missing',
    '/api',
    '/assets/missing.js',
    '/src/main.tsx',
    '/not-a-page',
    '/projects/demo/analysis/id.json',
    '/assets/%2e%2e/index.html',
  ]) {
    const response = await fetch(`${origin}${path}`, { headers: { Accept: 'text/html' } });
    assert(response.status >= 400, `${path} must not be HTML 200`);
  }
  const page = await fetch(`${origin}/projects/demo/startup/exact-report`, {
    headers: { Accept: 'text/html' },
  });
  assert.equal(page.status, 200);
  assert(page.headers.get('content-security-policy').includes("script-src 'self'"));
  const apiAccept = await fetch(`${origin}/workbench`, { headers: { Accept: 'application/json' } });
  assert.equal(apiAccept.status, 404);
  await run(
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'tests/workspace/playwright.config.ts',
      '--grep',
      'production',
    ],
    { WORKSPACE_TEST_URL: origin },
  );
  await stop(web);
  web = undefined;
  // Even selecting the fixture mode cannot activate fixtures with a production build.
  await run(['--filter', '@zhiju/workspace-web', 'exec', 'vite', 'build', '--mode', 'fixture'], {
    NODE_ENV: 'production',
  });
  await checkProductionBundle();
  await run(['--filter', '@zhiju/workspace-web', 'build:fixture']);
  const refused = spawn('node', ['apps/workspace-web/tools/serve.mjs'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(webPort) },
    stdio: 'ignore',
  });
  const refusalCode = await new Promise((resolve) => refused.once('exit', resolve));
  assert.notEqual(refusalCode, 0, 'production server must reject fixture artifacts');
  web = await start(
    'node',
    ['apps/workspace-web/tools/serve.mjs'],
    { NODE_ENV: 'development', PORT: String(webPort), BFF_URL: upstream },
    `${origin}/bff/health`,
  );
  await run(
    [
      'exec',
      'playwright',
      'test',
      '--config',
      'tests/workspace/playwright.config.ts',
      '--grep-invert',
      'production',
    ],
    { WORKSPACE_TEST_URL: origin },
  );
  await stop(web);
  web = undefined;
  // Leave the ordinary build artifact in a production-safe state after fixture tests.
  await run(['--filter', '@zhiju/workspace-web', 'build'], { NODE_ENV: 'production' });
  await checkProductionBundle();
  console.log(
    'workspace_shell=PASS independent_builds=Web,BFF production_rejection=PASS fixture_browser=PASS',
  );
} finally {
  await stop(web);
  await stop(bff);
}
