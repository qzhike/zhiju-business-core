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
