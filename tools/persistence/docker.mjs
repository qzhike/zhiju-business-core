import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function docker(args, options = {}) {
  const { stdout } = await execFileAsync('docker', args, {
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout;
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
export async function resolveTagDigest(repository, tag) {
  const stdout = await docker([
    'buildx',
    'imagetools',
    'inspect',
    `${repository}:${tag}`,
    '--format',
    '{{.Manifest.Digest}}',
  ]);
  const digest = stdout.trim();
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`could not resolve manifest digest for ${repository}:${tag}: ${digest}`);
  }
  return digest;
}
