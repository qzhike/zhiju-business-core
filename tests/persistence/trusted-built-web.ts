// IM-UI-01 (#266): the built production artifact server shared by the
// trusted-Human browser cases.
//
// Both cases must put the compiled `apps/workspace-web/dist` artifact in front
// of the real BFF through the deployed single-origin shape: `tools/serve.mjs`
// serves the SPA and reverse-proxies `/bff/*` to the BFF, so the browser only
// ever talks to the artifact origin. This module owns exactly that artifact
// server; each case still owns its own Core/BFF/PostgreSQL stack.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const webDist = join('apps', 'workspace-web', 'dist');
const webServerEntry = join('apps', 'workspace-web', 'tools', 'serve.mjs');
/** `tools/build-fixture.mjs` drops this marker into a development fixture dist. */
const FIXTURE_ARTIFACT_MARKER = 'fixture-build.json';
const SERVE_TIMEOUT_MS = 20_000;
const SERVE_POLL_MS = 100;

export interface BuiltWebArtifactServer {
  /** The browser-facing origin of the built SPA artifact server. */
  readonly origin: string;
  readonly stop: () => Promise<void>;
}

/**
 * The served SPA must be the production trusted artifact. A missing dist is
 * built once through the workspace build script; a development fixture dist
 * (`fixture-build.json`, which `tools/serve.mjs` refuses to serve outside
 * `NODE_ENV=development`) is rebuilt through the same production build instead
 * of being served, and a surviving marker is a hard failure.
 */
export function ensureBuiltWebArtifacts(): void {
  const dist = resolve(repositoryRoot, webDist);
  const fixture = existsSync(join(dist, FIXTURE_ARTIFACT_MARKER));
  if (!fixture && existsSync(join(dist, 'index.html'))) return;
  execFileSync('pnpm', ['--filter', '@zhiju/workspace-web', 'build'], {
    cwd: repositoryRoot,
    stdio: 'inherit',
  });
  if (existsSync(join(dist, FIXTURE_ARTIFACT_MARKER))) {
    throw new Error(
      `${webDist} still carries ${FIXTURE_ARTIFACT_MARKER} after the production build; ` +
        '#266 requires the production trusted artifact (pnpm --filter @zhiju/workspace-web build).',
    );
  }
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`building ${webDist} produced no index.html`);
  }
}

/** Starts the real artifact server on a reserved loopback port and waits for it. */
export async function startBuiltWebArtifactServer(input: {
  readonly port: number;
  readonly bffOrigin: string;
}): Promise<BuiltWebArtifactServer> {
  ensureBuiltWebArtifacts();
  const child = spawn(process.execPath, [resolve(repositoryRoot, webServerEntry)], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(input.port),
      BFF_URL: input.bffOrigin,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const lifecycle: { exited: number | null } = { exited: null };
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString('utf8')));
  child.on('exit', (code) => {
    lifecycle.exited = code;
  });

  const origin = `http://127.0.0.1:${input.port}`;
  const deadline = Date.now() + SERVE_TIMEOUT_MS;
  for (;;) {
    if (lifecycle.exited !== null) {
      throw new Error(
        `${webServerEntry} exited with ${lifecycle.exited} before serving ${origin}: ` +
          output.join('').trim(),
      );
    }
    // `tools/serve.mjs` only answers index.html for a text/html navigation.
    const serving = await fetch(`${origin}/workbench`, { headers: { accept: 'text/html' } })
      .then((response) => response.status === 200)
      .catch(() => false);
    if (serving) break;
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(
        `${webServerEntry} did not serve ${origin}/workbench within ${SERVE_TIMEOUT_MS}ms: ` +
          output.join('').trim(),
      );
    }
    // The child binds a real socket and exposes no readiness event, so the only
    // way to observe "listening" is to retry the real request; there is no
    // controllable clock for another process's bind.
    const { promise, resolve: retry } = Promise.withResolvers<undefined>();
    setTimeout(() => {
      retry(undefined);
    }, SERVE_POLL_MS);
    await promise;
  }

  return {
    origin,
    stop: async () => {
      if (lifecycle.exited !== null) return;
      const stopped = Promise.withResolvers<undefined>();
      child.on('exit', () => {
        stopped.resolve(undefined);
      });
      child.kill('SIGTERM');
      await stopped.promise;
    },
  };
}
