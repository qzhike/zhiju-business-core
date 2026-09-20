import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DOCKER_HOST_PATTERN = /^(?:unix|tcp|npipe):\/\//;

export async function docker(args, options = {}) {
  const { stdout } = await execFileAsync('docker', args, {
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout;
}

/**
 * Testcontainers does not consume the Docker CLI's active context on every
 * macOS runtime. Respect an explicit DOCKER_HOST; otherwise make the current
 * context endpoint explicit before Testcontainers is imported.
 */
export async function configureDockerHostFromCurrentContext({
  env = process.env,
  platform = process.platform,
  inspectContext,
  socketExists = existsSync,
} = {}) {
  const explicitHost = env.DOCKER_HOST?.trim();
  if (explicitHost) {
    return { host: explicitHost, source: 'environment', configured: false };
  }
  if (platform !== 'darwin') {
    return { host: null, source: 'docker-default', configured: false };
  }

  let host;
  try {
    host = (
      await (
        inspectContext ??
        (() => docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']))
      )()
    ).trim();
  } catch (error) {
    throw new Error('Docker context endpoint is unavailable on macOS', { cause: error });
  }
  if (!DOCKER_HOST_PATTERN.test(host)) {
    throw new Error(`Docker context returned an unsupported endpoint: ${host || 'empty'}`);
  }
  if (host.startsWith('unix://')) {
    const socketPath = host.slice('unix://'.length);
    if (!socketPath || !socketExists(socketPath)) {
      throw new Error(`Docker context socket is unavailable: ${socketPath || 'empty'}`);
    }
  }

  env.DOCKER_HOST = host;
  return { host, source: 'docker-context', configured: true };
}

export async function dockerInspectImage(reference) {
  const stdout = await docker(['image', 'inspect', reference]);
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`docker image inspect returned no result for ${reference}`);
  }
  return parsed[0];
}

/**
 * Resolve the manifest digest a tag currently points to in the registry.
 * Independent of any local pull, so a tag whose content drifted away from
 * the pinned digest is detected even though `tag@digest` pulls still succeed.
 */
export function isTransientDockerRegistryError(error) {
  return /\bEOF\b|ECONNRESET|ETIMEDOUT|EAI_AGAIN|TLS handshake timeout|connection reset|(?:^|\s)50[234](?:\s|$)|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export async function resolveTagDigest(repository, tag, options = {}) {
  const {
    attempts = 3,
    retryDelayMs = 1000,
    inspectTag = docker,
    wait = delay,
    ...execOptions
  } = options;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const stdout = await inspectTag(
        [
          'buildx',
          'imagetools',
          'inspect',
          `${repository}:${tag}`,
          '--format',
          '{{.Manifest.Digest}}',
        ],
        execOptions,
      );
      const digest = stdout.trim();
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
        throw new Error(`could not resolve manifest digest for ${repository}:${tag}: ${digest}`);
      }
      return digest;
    } catch (error) {
      lastError = error;
      if (!isTransientDockerRegistryError(error) || attempt === attempts) {
        throw error;
      }
      await wait(retryDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}
