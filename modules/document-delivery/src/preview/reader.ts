import { fork, execFile, type ChildProcess } from 'node:child_process';
import { acquireExclusiveLock, lockPathFor } from '../custody/locks.js';
import { promisify } from 'node:util';
import { mkdir, lstat, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREVIEW_PROFILE,
  PREVIEW_LIMITS as limits,
  PREVIEW_REASONS,
  PreviewFailure,
  previewLimit,
  type PreviewReason,
} from './profile.js';
import { directoryBytes, hash } from './files.js';
import type { PreviewSource, SourcePreview, PreviewSections } from './types.js';

const exec = promisify(execFile);
let active = false;
export interface PreviewOptions {
  readonly runnerRoot?: string;
  readonly python?: string;
  readonly temporaryRoot: string;
}

function failure(source: PreviewSource, reason: PreviewReason): SourcePreview {
  return {
    sourceRef: source.sourceRef,
    manifestId: source.manifestId,
    fileName: source.fileName,
    profileId: PREVIEW_PROFILE,
    status: ['FORMAT_NOT_SUPPORTED', 'NESTED_TABLE_NOT_SUPPORTED'].includes(reason)
      ? 'UNSUPPORTED'
      : 'UNAVAILABLE',
    limitations: [
      ...source.reasonCodes.filter(
        (code): code is PreviewReason => code === 'EXTERNAL_TEMPLATE_NOT_LOADED',
      ),
      reason,
    ],
  };
}

function kill(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/** A read-only, single-slot boundary; every worker has private disposable files. */
export class SourcePreviewReader {
  #initialized = false;
  #stop: AbortController | undefined;
  #running: Promise<SourcePreview> | undefined;
  constructor(readonly options: PreviewOptions) {}

  acquireIdleLock() {
    return acquireExclusiveLock(lockPathFor(`read-slot:${this.options.temporaryRoot}`));
  }

  async initialize(): Promise<void> {
    const lock = await this.acquireIdleLock();
    if (lock === null) {
      this.#initialized = false;
      return;
    }
    try {
      await mkdir(this.options.temporaryRoot, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.options.temporaryRoot);
      if (
        !stat.isDirectory() ||
        stat.isSymbolicLink() ||
        (stat.mode & 0o077) !== 0 ||
        (process.getuid !== undefined && stat.uid !== process.getuid())
      )
        throw new Error('unsafe preview directory');
      for (const name of await readdir(this.options.temporaryRoot)) {
        if (/^read-[A-Za-z0-9]+$/u.test(name))
          await rm(join(this.options.temporaryRoot, name), { recursive: true, force: true });
      }
      this.#initialized = true;
    } catch {
      this.#initialized = false;
    } finally {
      await lock.release();
    }
  }

  read(
    source: PreviewSource,
    load: () => Promise<Buffer>,
    signal?: AbortSignal,
  ): Promise<SourcePreview> {
    if (active) return Promise.resolve(failure(source, 'BUSY'));
    if (
      !this.#initialized ||
      this.options.python === undefined ||
      this.options.runnerRoot === undefined ||
      !isAbsolute(this.options.python) ||
      !isAbsolute(this.options.runnerRoot)
    )
      return Promise.resolve(failure(source, 'DEPENDENCY_UNAVAILABLE'));
    active = true;
    const stop = new AbortController();
    this.#stop = stop;
    const combined = AbortSignal.any([
      stop.signal,
      AbortSignal.timeout(limits.timeMs),
      ...(signal === undefined ? [] : [signal]),
    ]);
    this.#running = (async () => {
      const lock = await this.acquireIdleLock();
      if (lock === null) return failure(source, 'BUSY');
      try {
        return await this.#read(source, load, combined, lock.descriptor);
      } finally {
        await lock.release();
      }
    })().finally(() => {
      active = false;
      this.#stop = undefined;
      this.#running = undefined;
    });
    return this.#running;
  }

  async close(): Promise<void> {
    this.#stop?.abort();
    await this.#running;
  }

  async #read(
    source: PreviewSource,
    load: () => Promise<Buffer>,
    signal: AbortSignal,
    descriptor: number,
  ): Promise<SourcePreview> {
    let directory: string | undefined;
    try {
      // Storage/authorization errors belong to the service, not an empty preview.
      const bytes = await load();
      if (signal.aborted)
        return failure(
          source,
          signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
            ? 'TIMEOUT'
            : 'CANCELLED',
        );
      if (bytes.length !== source.sourceRef.byteLength || hash(bytes) !== source.sourceRef.sha256)
        throw new PreviewFailure('INVALID_READER_OUTPUT');
      previewLimit(bytes.length, limits.sourceBytes);
      directory = await mkdtemp(join(this.options.temporaryRoot, 'read-'));
      return await this.#worker(source, bytes, directory, signal, descriptor);
    } catch (error) {
      if (error instanceof PreviewFailure) return failure(source, error.reason);
      throw error;
    } finally {
      if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    }
  }

  #worker(
    source: PreviewSource,
    bytes: Buffer,
    directory: string,
    signal: AbortSignal,
    descriptor: number,
  ): Promise<SourcePreview> {
    const workerUrl = new URL(
      import.meta.url.endsWith('.ts') ? '../../dist/preview/worker.js' : './worker.js',
      import.meta.url,
    );
    return new Promise((resolve) => {
      const child = fork(fileURLToPath(workerUrl), [], {
        detached: true,
        serialization: 'advanced',
        execArgv: ['--max-old-space-size=384'],
        env: { LANG: 'C.UTF-8', TZ: 'UTC' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc', descriptor],
      });
      let result: SourcePreview | undefined;
      let reason: PreviewReason | undefined;
      let pythonPid: number | undefined;
      let monitoring = false;
      let ended = false;
      const hasEnded = (): boolean => ended || result !== undefined || reason !== undefined;
      const reject = (code: PreviewReason): void => {
        reason ??= code;
        kill(child);
      };
      const cancelled = () => {
        reject(
          signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError'
            ? 'TIMEOUT'
            : 'CANCELLED',
        );
      };
      signal.addEventListener('abort', cancelled, { once: true });
      const monitor = async (): Promise<boolean> => {
        if (hasEnded() || child.pid === undefined) return false;
        try {
          const pids = [child.pid, ...(pythonPid === undefined ? [] : [pythonPid])];
          const snapshot = await exec('/bin/ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], {
            timeout: 3000,
            maxBuffer: limits.pipeBytes,
            env: { LANG: 'C' },
          });
          if (hasEnded()) return false;
          const lines = snapshot.stdout
            .trim()
            .split('\n')
            .map((line) => line.trim().split(/\s+/u));
          if (
            !lines.some(([pid]) => Number(pid) === child.pid) ||
            lines.some(([pid, rss]) => !pids.includes(Number(pid)) || !/^\d+$/u.test(rss ?? ''))
          )
            throw new PreviewFailure('DEPENDENCY_UNAVAILABLE');
          previewLimit(
            lines.reduce((total, [, rss]) => total + Number(rss) * 1024, 0),
            limits.memoryBytes,
          );
          previewLimit(await directoryBytes(directory), limits.temporaryBytes);
          return true;
        } catch (error) {
          if (!hasEnded())
            reject(error instanceof PreviewFailure ? error.reason : 'DEPENDENCY_UNAVAILABLE');
          return false;
        }
      };
      const timer = setInterval(() => {
        if (monitoring) return;
        monitoring = true;
        void monitor().finally(() => {
          monitoring = false;
        });
      }, 50);
      for (const pipe of [child.stdout, child.stderr]) {
        let count = 0;
        pipe?.on('data', (chunk: Buffer) => {
          count += chunk.length;
          if (count > limits.pipeBytes) reject('RESOURCE_LIMIT');
        });
      }
      child.on('error', () => {
        reason ??= 'DEPENDENCY_UNAVAILABLE';
      });
      child.on('message', (message: unknown) => {
        if (reason !== undefined || ended || typeof message !== 'object' || message === null)
          return;
        const item = message as Record<string, unknown>;
        if (
          item.kind === 'python' &&
          typeof item.pid === 'number' &&
          Number.isSafeInteger(item.pid) &&
          item.pid > 0
        ) {
          pythonPid = item.pid;
          void monitor().then((ok) => {
            if (ok && child.connected) child.send({ kind: 'go' });
          });
        } else if (
          item.kind === 'failure' &&
          PREVIEW_REASONS.includes(item.reason as PreviewReason)
        ) {
          reason = item.reason as PreviewReason;
        } else if (
          item.kind === 'result' &&
          typeof item.value === 'object' &&
          item.value !== null
        ) {
          const value = item.value as { sections: PreviewSections; limitations: PreviewReason[] };
          const limitations = [
            ...new Set([
              ...source.reasonCodes.filter(
                (code): code is PreviewReason => code === 'EXTERNAL_TEMPLATE_NOT_LOADED',
              ),
              ...value.limitations,
            ]),
          ];
          result = {
            sourceRef: source.sourceRef,
            manifestId: source.manifestId,
            fileName: source.fileName,
            profileId: PREVIEW_PROFILE,
            status: limitations.length ? 'LIMITED' : 'AVAILABLE',
            limitations,
            sections: value.sections,
          };
          if (Buffer.byteLength(JSON.stringify(result)) > limits.outputBytes)
            reject('RESOURCE_LIMIT');
        } else reject('INVALID_READER_OUTPUT');
      });
      child.once('spawn', () => {
        void monitor().then((ok) => {
          if (ok && child.connected && !signal.aborted)
            child.send({
              source,
              bytes,
              directory,
              runnerRoot: this.options.runnerRoot,
              python: this.options.python,
            });
          else if (signal.aborted) cancelled();
        });
      });
      child.once('close', () => {
        ended = true;
        clearInterval(timer);
        signal.removeEventListener('abort', cancelled);
        kill(child);
        resolve(
          reason !== undefined
            ? failure(source, reason)
            : (result ?? failure(source, 'INVALID_READER_OUTPUT')),
        );
      });
      if (signal.aborted) cancelled();
    });
  }
}
