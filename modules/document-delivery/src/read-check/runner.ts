import { setTimeout as delay } from 'node:timers/promises';
import { acquireExclusiveLock, lockPathFor } from '../custody/locks.js';
import { MvpError } from '../domain/errors.js';
import type { SourcePreviewReader } from '../preview/reader.js';
import type { SourcePreview } from '../preview/types.js';
import { READ_CHECK_PROFILE_HASH, READ_CHECK_TIME_MS, readCheckResult } from './profile.js';
import type { ReadCheckRepository } from './repository.js';
import type { ReadCheckIdentity, ReadCheckLease, ReadCheckScope } from './types.js';

export class ReadCheckRunner {
  readonly #stop = new AbortController();
  readonly #lockPath: string;
  #running: Promise<void> | undefined;
  #requested = false;
  constructor(
    readonly repository: ReadCheckRepository,
    readonly reader: SourcePreviewReader,
    identity: string,
    readonly preview: (
      identity: ReadCheckIdentity,
      scope: ReadCheckScope,
      sourceId: string,
      manifestId: string,
      signal: AbortSignal,
    ) => Promise<SourcePreview>,
  ) {
    this.#lockPath = lockPathFor(`batch-read-checks:${identity}`);
  }

  async startup(): Promise<void> {
    const pending = await this.repository.db.pendingReadChecks();
    for (const task of pending.filter((row) => row.status !== 'QUEUED')) {
      const execution = await acquireExclusiveLock(this.#lockPath);
      let readers: Awaited<ReturnType<SourcePreviewReader['acquireIdleLock']>> = null;
      try {
        readers = execution === null ? null : await this.reader.acquireIdleLock();
        if (execution !== null && readers !== null) await this.repository.reconcile(task, task);
        else await this.repository.finish(task, task, 'UNKNOWN', 'CHECK_INTERRUPTED');
      } finally {
        await readers?.release();
        await execution?.release();
      }
    }
    this.kick();
  }

  kick(): void {
    if (this.#stop.signal.aborted) return;
    this.#requested = true;
    if (this.#running !== undefined) return;
    this.#running = this.#drain()
      .catch(() => undefined)
      .finally(() => {
        this.#running = undefined;
        if (this.#requested && !this.#stop.signal.aborted) this.kick();
      });
  }

  async whenIdle(): Promise<void> {
    while (this.#running !== undefined) await this.#running;
  }
  async close(): Promise<void> {
    this.#stop.abort();
    await this.whenIdle();
  }

  #needsDrain(): boolean {
    return this.#requested && !this.#stop.signal.aborted;
  }

  async #drain(): Promise<void> {
    do {
      this.#requested = false;
      const jobs = await this.repository.db.pendingReadChecks(this.#stop.signal);
      for (const job of jobs) {
        if (this.#stop.signal.aborted) return;
        if (job.status !== 'QUEUED') continue;
        const lock = await acquireExclusiveLock(this.#lockPath);
        if (lock === null) return;
        try {
          await this.#run(job, job);
        } finally {
          await lock.release();
        }
      }
    } while (this.#needsDrain());
  }

  async #run(identity: ReadCheckIdentity, scope: ReadCheckScope): Promise<void> {
    let lease: ReadCheckLease | undefined;
    const timeout = AbortSignal.timeout(READ_CHECK_TIME_MS);
    const signal = AbortSignal.any([timeout, this.#stop.signal]);
    const cancelled = () => signal.aborted;
    try {
      lease = await this.repository.claim(identity, scope, signal);
      signal.throwIfAborted();
      if (lease === undefined) return;
      if (lease.profileHash !== READ_CHECK_PROFILE_HASH) {
        await this.repository.finish(identity, scope, 'FAILED', 'DEPENDENCY_UNAVAILABLE', lease);
        return;
      }
      while (!cancelled()) {
        const entry = await this.repository.next(lease, signal);
        signal.throwIfAborted();
        if (entry === undefined) {
          await this.repository.finish(identity, scope, 'COMPLETED', '', lease, signal);
          return;
        }
        let preview: SourcePreview | undefined;
        if (entry.sourceRef !== undefined) {
          preview = await this.preview(
            identity,
            scope,
            entry.sourceRef.sourceId,
            lease.manifestId,
            signal,
          );
          if (cancelled()) break;
          if (preview.limitations.includes('BUSY')) {
            await delay(100, undefined, { signal });
            continue;
          }
          if (preview.limitations.includes('DEPENDENCY_UNAVAILABLE')) {
            await this.repository.finish(
              identity,
              scope,
              'FAILED',
              'DEPENDENCY_UNAVAILABLE',
              lease,
            );
            return;
          }
        }
        const result = readCheckResult(entry, preview, new Date().toISOString());
        try {
          signal.throwIfAborted();
          await this.repository.commit(lease, result, signal);
        } catch (error) {
          if (
            error instanceof MvpError &&
            ['INSTANCE_ACCESS_DENIED', 'RECOVERY_NOT_ALLOWED'].includes(error.code)
          )
            throw error;
          const confirmed = await this.repository
            .confirmed(lease, result, AbortSignal.timeout(20_000))
            .catch(() => undefined);
          if (confirmed === false && cancelled()) signal.throwIfAborted();
          if (!confirmed) {
            await this.repository.finish(identity, scope, 'UNKNOWN', 'CHECK_INTERRUPTED', lease);
            return;
          }
        }
        // A confirmed commit may have finished just before cancellation; preserve that fact.
        if (
          (await this.repository.get(identity, scope, AbortSignal.timeout(20_000))).status ===
          'COMPLETED'
        )
          return;
        signal.throwIfAborted();
        // Yield between files so interactive preview requests can acquire the same slot.
        await delay(25, undefined, { signal });
      }
      await this.repository.finish(
        identity,
        scope,
        this.#stop.signal.aborted ? 'INTERRUPTED' : 'FAILED',
        this.#stop.signal.aborted ? 'CHECK_INTERRUPTED' : 'CHECK_TIME_LIMIT',
        lease,
      );
    } catch (error) {
      const reason = this.#stop.signal.aborted
        ? 'CHECK_INTERRUPTED'
        : timeout.aborted
          ? 'CHECK_TIME_LIMIT'
          : error instanceof MvpError && error.code === 'INSTANCE_ACCESS_DENIED'
            ? 'AUTHORIZATION_CHANGED'
            : error instanceof MvpError && error.code === 'STORAGE_INTEGRITY_ERROR'
              ? 'STORAGE_INTEGRITY_ERROR'
              : 'DEPENDENCY_UNAVAILABLE';
      const status = this.#stop.signal.aborted && lease !== undefined ? 'INTERRUPTED' : 'FAILED';
      // If the database is unreachable the durable RUNNING row remains occupied;
      // startup reconciliation, not a second execution, resolves its outcome.
      await this.repository
        .finish(identity, scope, status, reason, lease, AbortSignal.timeout(20_000))
        .catch(() => undefined);
    }
  }
}
