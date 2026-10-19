import { setTimeout, clearTimeout } from 'node:timers';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { createHash } from 'node:crypto';
import { readFile, realpath, mkdir, mkdtemp, lstat, access } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { join } from 'node:path';
import {
  LOCAL_OMP_OVERLAY,
  LOCAL_OMP_TOOL_FILES,
  validateLocalOmpProfile,
  verifyOmpStartup,
} from '@zhiju/integration-gateway';
import { writePrivateJson } from './config.mjs';
const execute = promisify(execFile);
async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}
async function executable(name) {
  for (const directory of (process.env.PATH ?? '').split(':')) {
    if (!directory) continue;
    const path = join(directory, name);
    try {
      await access(path, constants.X_OK);
      if ((await lstat(path)).isDirectory()) continue;
      return await realpath(path);
    } catch {
      /* Try the next explicit PATH entry. */
    }
  }
  throw new Error('ENV_B_RUNNER_EXECUTABLE_MISSING');
}
/** No prompt is sent. Only the actual empty RPC session state is inspected. */
async function probe(binary, root, overlay, instructions) {
  const environment = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8' };
  for (const name of ['DATA', 'STATE', 'CACHE', 'CONFIG']) {
    environment['XDG_' + name + '_HOME'] = join(root, name);
    await mkdir(join(root, name), { mode: 0o700 });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        '--mode',
        'rpc',
        '--config',
        overlay,
        '--no-session',
        '--no-title',
        '--no-ui',
        '--no-lsp',
        '--no-pty',
        '--no-extensions',
        '--no-skills',
        '--no-rules',
        '--no-prewalk',
        '--tools',
        'read,grep,glob,write',
        '--append-system-prompt',
        instructions,
      ],
      { cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let buffer = '',
      bytes = 0,
      result,
      failed = false;
    const decoder = new StringDecoder('utf8');
    const stop = () => {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 1000).unref();
    };
    const timer = setTimeout(() => {
      failed = true;
      stop();
    }, 30000);
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('ENV_B_RUNNER_STARTUP_FAILED'));
    });
    child.stderr.on('data', (b) => {
      bytes += b.length;
      if (bytes > 33554432) {
        failed = true;
        stop();
      }
    });
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 33554432) {
        failed = true;
        stop();
        return;
      }
      buffer += decoder.write(chunk);
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        try {
          const value = JSON.parse(line);
          if (value.type === 'response' && value.id === 'env-b-state') {
            if (value.success === true) result = value.data;
            else failed = true;
            stop();
          }
        } catch {
          failed = true;
          stop();
        }
      }
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (failed || !result) reject(new Error('ENV_B_RUNNER_STARTUP_FAILED'));
      else resolve(result);
    });
    child.stdin.write(JSON.stringify({ type: 'get_state', id: 'env-b-state' }) + '\n');
  });
}
export async function initializeRunnerProfile(config) {
  const defaultFile = join(config.dataDir, 'omp-profile.json');
  const file = config.runner.profileFile ?? defaultFile;
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.executionRoot !== join(config.dataDir, 'runner-attempts'))
      throw new Error('ENV_B_RUNNER_EXECUTION_ROOT_MISMATCH');
    const profile = await validateLocalOmpProfile(raw, 'MACOS_MANUAL_TEST');
    if (profile.projectRoot !== config.runner.projectRoot)
      throw new Error('ENV_B_RUNNER_PROJECT_MISMATCH');
    return profile;
  } catch (error) {
    if (error.code !== 'ENOENT' || config.runner.profileFile) throw error;
  }
  const executionRoot = join(config.dataDir, 'runner-attempts');
  await mkdir(executionRoot, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(config.dataDir, 'omp-preflight-'));
  const binary = await executable('omp');
  const version = (
    await execute(binary, ['--version'], { timeout: 15000, maxBuffer: 4096 })
  ).stdout.trim();
  const requirements = await readFile(
    join(config.runner.projectRoot, 'runner_evidence/requirements.txt'),
    'utf8',
  );
  if (requirements.trim() !== 'jsonschema==4.26.0')
    throw new Error('ENV_B_RUNNER_DEPENDENCY_UNSUPPORTED');
  const pythonRoot = join(config.dataDir, 'runner-python'),
    python = join(pythonRoot, 'bin/python3');
  try {
    await access(python, constants.X_OK);
  } catch {
    await execute(await executable('python3'), ['-m', 'venv', '--copies', pythonRoot], {
      timeout: 60000,
      maxBuffer: 1048576,
    });
  }
  try {
    await execute(
      python,
      [
        '-c',
        'import importlib.metadata; assert importlib.metadata.version("jsonschema")=="4.26.0"',
      ],
      { timeout: 15000, maxBuffer: 4096 },
    );
  } catch {
    await execute(
      python,
      ['-m', 'pip', 'install', '--disable-pip-version-check', 'jsonschema==4.26.0'],
      { timeout: 120000, maxBuffer: 1048576 },
    );
  }
  const overlay = join(root, 'overlay.json');
  await writePrivateJson(overlay, LOCAL_OMP_OVERLAY, true);
  const instructions = join(config.runner.projectRoot, 'AGENTS.md');
  const state = await probe(binary, root, overlay, instructions);
  const model = {
    provider: state.model?.provider,
    id: state.model?.id,
    thinking: state.thinkingLevel,
  };
  verifyOmpStartup(state, {
    provider: model.provider,
    model: model.id,
    thinking: model.thinking,
    instructionText: await readFile(instructions, 'utf8'),
  });
  const profile = {
    profile: 'workspace.macos_manual_omp@1',
    projectRoot: config.runner.projectRoot,
    executionRoot,
    executable: { path: binary, sha256: await sha256(binary), version },
    python: { path: await realpath(python), sha256: await sha256(python) },
    model,
    authenticationHome: await realpath(process.env.HOME),
    tools: Object.fromEntries(
      await Promise.all(
        LOCAL_OMP_TOOL_FILES.map(async (file) => [
          file,
          await sha256(join(config.runner.projectRoot, file)),
        ]),
      ),
    ),
    overlay: LOCAL_OMP_OVERLAY,
  };
  await validateLocalOmpProfile(profile, 'MACOS_MANUAL_TEST');
  await writePrivateJson(defaultFile, profile, true);
  return profile;
}
