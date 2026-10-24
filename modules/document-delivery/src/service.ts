import { newUuidV7, sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';

import { acquireExclusiveLock, type ExclusiveLock } from './custody/locks.js';
import { StoreIntegrityError, type MvpFileStore, type StoredObject } from './custody/file-store.js';
import {
  attemptLockPath,
  entryObjectKey,
  originalObjectKey,
  stagingObjectKey,
} from './custody/keys.js';
import { scanInputPackage } from './custody/scan.js';
import { ZipSafetyError } from './custody/zip.js';
import { fail, MvpError } from './domain/errors.js';
import { manifestHash } from './domain/manifest.js';
import { MVP_EXTRACTOR_VERSION, MVP_INPUT_POLICY_VERSION } from './domain/policy.js';
import type {
  AttemptRecord,
  BatchDetail,
  BatchRecord,
  BatchSummary,
  BatchView,
  EntryPage,
  InputManifest,
  ManifestEntry,
  ObjectReceipt,
  Page,
  ProjectSummary,
  ProjectView,
  RecoveryAction,
  SessionView,
  SourceRef,
  StoredSource,
} from './domain/types.js';
import {
  closedObject,
  fileLabel,
  noteText,
  positiveBytes,
  projectName,
  safeInteger,
  sha256Hex,
  uuidV7,
} from './domain/validation.js';
import type { MvpDatabase } from './persistence/db.js';
import { MvpRepository } from './persistence/repository.js';
import { batchView } from './persistence/rows.js';
import type {
  CreateBatchInput,
  CreateProjectInput,
  WriteIntent,
  WriteOutcome,
  BatchState,
} from './persistence/repository.js';

export interface MvpServiceOptions {
  readonly database: MvpDatabase;
  readonly store: MvpFileStore;
  readonly cursorKey: Buffer;
  readonly incarnation: string;
  readonly now?: () => Date;
}

export interface SessionIdentity {
  readonly ownerId: string;
  readonly displayName: string;
  readonly authEpoch: number;
}

export interface UploadInput {
  readonly projectId: string;
  readonly batchId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly contentLength: number;
  readonly chunks: AsyncIterable<Uint8Array>;
}

export interface RecoveryResult {
  readonly batch: BatchView;
  readonly recoveryRequestId: string;
}

function isRecoveryAction(value: unknown): value is RecoveryAction {
  return (
    value === 'RECONCILE' ||
    value === 'RETRY_UPLOAD' ||
    value === 'CONTINUE_EXTRACTION' ||
    value === 'ABANDON'
  );
}

function payloadHash(
  operation: string,
  projectId: string,
  targetId: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return sha256CanonicalJson({
    protocol: 'mvp@1',
    operation,
    projectId,
    targetId,
    payload,
  } as CanonicalJsonValue);
}

/**
 * The single MVP01 business service. HTTP composition only parses transport
 * and supplies the currently verified binding; every ownership, idempotency,
 * state, authorization-epoch and content decision lives here.
 */
export class MvpService {
  readonly #db: MvpDatabase;
  readonly #store: MvpFileStore;
  readonly #repository: MvpRepository;
  readonly #now: () => Date;
  readonly #background = new Set<Promise<void>>();
  #instanceId: string | undefined;

  constructor(options: MvpServiceOptions) {
    this.#db = options.database;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#repository = new MvpRepository({
      database: options.database,
      cursorKey: options.cursorKey,
      incarnation: options.incarnation,
      now: this.#now,
    });
  }

  get repository(): MvpRepository {
    return this.#repository;
  }

  #schedule(task: Promise<void>): void {
    const tracked = task
      .catch(() => undefined)
      .finally(() => {
        this.#background.delete(tracked);
      });
    this.#background.add(tracked);
  }

  /** Wait for every extraction this process started; used by shutdown and tests. */
  async whenIdle(): Promise<void> {
    while (this.#background.size > 0) await Promise.all([...this.#background]);
  }

  async startup(): Promise<void> {
    const installation = await this.#db.installation();
    if (installation === undefined) throw new Error('MVP_INSTALLATION_MISMATCH');
    if (
      installation.schemaVersion !== 'mvp.document_delivery@1' ||
      installation.storeId !== this.#store.identity.storeId ||
      installation.storeIdentity !== this.#store.identity.storeIdentity ||
      installation.instanceId !== this.#store.identity.instanceId
    )
      throw new Error('MVP_INSTALLATION_MISMATCH');
    this.#instanceId = installation.instanceId;
  }

  session(identity: SessionIdentity): SessionView {
    return {
      ownerId: identity.ownerId,
      displayName: identity.displayName,
      authEpoch: identity.authEpoch,
      capabilities: ['PROJECT_CUSTODY'],
      instanceId: this.#instanceId ?? fail('DEPENDENCY_UNAVAILABLE'),
    };
  }

  resolveBinding(
    issuer: string,
    subject: string,
  ): Promise<
    | {
        ownerId: string;
        displayName: string;
        authEpoch: number;
        enabled: boolean;
      }
    | undefined
  > {
    return this.#db.resolveBinding(issuer, subject);
  }

  currentBinding(ownerId: string) {
    return this.#db.currentBinding(ownerId);
  }

  createProject(
    identity: SessionIdentity,
    input: {
      requestId: string;
      projectId: string;
      payload: unknown;
    },
  ): Promise<WriteOutcome<{ project: ProjectView }>> {
    const payload = closedObject(input.payload, ['customerName', 'title']);
    const projectId = uuidV7(input.projectId);
    const requestId = uuidV7(input.requestId);
    const intent: WriteIntent = {
      requestId,
      projectId,
      targetId: projectId,
      operation: 'mvp.create_project',
      payload,
      payloadHash: payloadHash('mvp.create_project', projectId, projectId, payload),
    };
    const body: CreateProjectInput = {
      projectId,
      customerName: projectName(payload.customerName),
      title: projectName(payload.title),
    };
    return this.#repository.createProject(identity.ownerId, identity.authEpoch, intent, body);
  }

  createBatch(
    identity: SessionIdentity,
    input: {
      requestId: string;
      projectId: string;
      batchId: string;
      payload: unknown;
    },
  ): Promise<WriteOutcome<{ batch: BatchView }>> {
    const closed = closedObject(
      input.payload,
      ['expectedProjectVersion', 'originalName', 'declaredBytes', 'zipSha256'],
      ['note'],
    );
    const projectId = uuidV7(input.projectId);
    const batchId = uuidV7(input.batchId);
    const expectedProjectVersion = safeInteger(closed.expectedProjectVersion);
    const body: CreateBatchInput = {
      projectId,
      batchId,
      expectedProjectVersion,
      originalName: fileLabel(closed.originalName, 1024),
      declaredBytes: positiveBytes(closed.declaredBytes),
      zipSha256: sha256Hex(closed.zipSha256),
      ...(closed.note === undefined
        ? {}
        : { note: noteText(closed.note) ?? fail('INVALID_REQUEST') }),
    };
    const intent: WriteIntent = {
      requestId: uuidV7(input.requestId),
      projectId,
      targetId: batchId,
      operation: 'mvp.create_input_batch',
      payload: closed,
      payloadHash: payloadHash('mvp.create_input_batch', projectId, batchId, closed),
    };
    return this.#repository.createBatch(identity.ownerId, identity.authEpoch, intent, body);
  }

  listProjects(
    identity: SessionIdentity,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ProjectSummary>> {
    return this.#repository.listProjects(identity.ownerId, identity.authEpoch, limit, cursor);
  }

  getProject(identity: SessionIdentity, projectId: string): Promise<ProjectView> {
    return this.#repository.getProject(identity.ownerId, uuidV7(projectId));
  }

  async listBatches(
    identity: SessionIdentity,
    projectId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<BatchSummary>> {
    const page = await this.#repository.listBatches(
      identity.ownerId,
      identity.authEpoch,
      uuidV7(projectId),
      limit,
      cursor,
    );
    return {
      items: page.items.map((batch) => ({
        batchId: batch.batchId,
        projectId: batch.projectId,
        batchNo: batch.batchNo,
        kind: batch.kind,
        originalName: batch.originalName,
        declaredBytes: batch.declaredBytes,
        zipSha256: batch.zipSha256,
        status: batch.status,
        version: batch.version,
        createdAt: batch.createdAt,
        reasonCodes: batch.reasonCodes,
        ...(batch.manifestId === undefined ? {} : { manifestId: batch.manifestId }),
      })),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  getBatch(
    identity: SessionIdentity,
    projectId: string,
    batchId: string,
    attemptLimit: number,
    attemptCursor: string | undefined,
  ): Promise<BatchDetail> {
    return this.#repository.getBatchDetail(
      identity.ownerId,
      identity.authEpoch,
      uuidV7(projectId),
      uuidV7(batchId),
      attemptLimit,
      attemptCursor,
    );
  }

  getEntries(
    identity: SessionIdentity,
    projectId: string,
    batchId: string,
    manifestId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<EntryPage> {
    return this.#repository.listEntries(
      identity.ownerId,
      identity.authEpoch,
      uuidV7(projectId),
      uuidV7(batchId),
      uuidV7(manifestId),
      limit,
      cursor,
    );
  }

  getRequest(identity: SessionIdentity, requestId: string) {
    return this.#repository.getRequestView(identity.ownerId, uuidV7(requestId));
  }

  async readSource(
    identity: SessionIdentity,
    projectId: string,
    batchId: string,
    sourceId: string,
  ): Promise<StoredSource & { readonly bytes: Buffer }> {
    const lookup = await this.#repository.storedSource(
      identity.ownerId,
      uuidV7(projectId),
      uuidV7(batchId),
      uuidV7(sourceId),
    );
    let bytes: Buffer;
    try {
      bytes = await this.#store.readVerified(lookup.objectKey, lookup.sourceRef);
    } catch (error) {
      if (error instanceof StoreIntegrityError) fail('STORAGE_INTEGRITY_ERROR');
      throw error;
    }
    return { ...lookup, bytes };
  }

  async recover(
    identity: SessionIdentity,
    input: {
      requestId: string;
      projectId: string;
      batchId: string;
      payload: unknown;
    },
  ): Promise<WriteOutcome<RecoveryResult>> {
    const payload = closedObject(input.payload, ['expectedBatchVersion', 'action']);
    if (!isRecoveryAction(payload.action)) fail('INVALID_REQUEST');
    const expectedBatchVersion = safeInteger(payload.expectedBatchVersion);
    const projectId = uuidV7(input.projectId);
    const batchId = uuidV7(input.batchId);
    const requestId = uuidV7(input.requestId);
    const action = payload.action;
    const attemptId = newUuidV7();
    const intent: WriteIntent = {
      requestId,
      projectId,
      targetId: batchId,
      operation: 'mvp.recover_input_batch',
      payload,
      payloadHash: payloadHash('mvp.recover_input_batch', projectId, batchId, payload),
    };
    const result = await this.#repository.recover(
      identity.ownerId,
      identity.authEpoch,
      intent,
      {
        projectId,
        batchId,
        expectedBatchVersion,
        action,
        attemptId,
      },
      (state) => this.#guardRecovery(state, action),
    );
    if (result.replayed) return result;
    if (action === 'RECONCILE') {
      await this.#reconcile(identity, projectId, batchId);
      const detail = await this.#repository.getBatchDetail(
        identity.ownerId,
        identity.authEpoch,
        projectId,
        batchId,
        1,
        undefined,
      );
      return { ...result, data: { ...result.data, batch: detail.batch } };
    }
    if (action === 'CONTINUE_EXTRACTION') {
      this.#schedule(
        this.#executeExtraction(
          identity.ownerId,
          projectId,
          batchId,
          attemptId,
          result.data.batch.currentAttempt?.generation ?? 1,
          identity.authEpoch,
        ),
      );
    }
    return result;
  }

  /** Prove old writers stopped while the repository holds the batch CAS lock. */
  async #guardRecovery(state: BatchState, action: RecoveryAction): Promise<() => Promise<void>> {
    const locks: ExclusiveLock[] = [];
    const release = async (): Promise<void> => {
      const results = await Promise.allSettled(locks.map((lock) => lock.release()));
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    };
    try {
      for (const attempt of state.attempts) {
        const lock = await acquireExclusiveLock(
          attemptLockPath(this.#store.root, attempt.attemptId),
        );
        if (lock === null) fail('RECOVERY_NOT_ALLOWED');
        locks.push(lock);
      }
      let completeOriginal = false;
      let completeStaged = false;
      for (const attempt of state.attempts.filter((item) => item.kind === 'UPLOAD')) {
        const staged = await this.#store.inspectStaged(stagingObjectKey(attempt.attemptId));
        if (
          staged?.sha256 === state.batch.zipSha256 &&
          staged.byteLength === state.batch.declaredBytes
        )
          completeStaged = true;
        const inspected = await this.#store.inspect(
          originalObjectKey(
            state.batch.ownerId,
            state.batch.projectId,
            state.batch.batchId,
            attempt.attemptId,
          ),
        );
        if (inspected !== null) {
          if (
            inspected.sha256 !== state.batch.zipSha256 ||
            inspected.byteLength !== state.batch.declaredBytes
          )
            fail('STORAGE_INTEGRITY_ERROR');
          completeOriginal = true;
        }
      }
      if (action === 'RETRY_UPLOAD' && (completeOriginal || completeStaged))
        fail('RECOVERY_NOT_ALLOWED');
      if (action === 'CONTINUE_EXTRACTION' && !completeOriginal) fail('RECOVERY_NOT_ALLOWED');
      return release;
    } catch (error) {
      await release();
      if (error instanceof StoreIntegrityError) fail('STORAGE_INTEGRITY_ERROR');
      throw error;
    }
  }

  async #reconcile(identity: SessionIdentity, projectId: string, batchId: string): Promise<void> {
    const state = await this.#repository.readBatchState(identity.ownerId, projectId, batchId);
    if (state.batch.manifestId !== undefined) return;
    const upload = [...state.attempts].reverse().find((attempt) => attempt.kind === 'UPLOAD');
    if (upload === undefined || state.batch.originalZipSource !== undefined) {
      if (state.batch.status !== 'UNKNOWN')
        await this.#repository.markUploadUnknown(identity.ownerId, projectId, batchId);
      return;
    }
    const objectKey = originalObjectKey(identity.ownerId, projectId, batchId, upload.attemptId);
    const lock = await acquireExclusiveLock(attemptLockPath(this.#store.root, upload.attemptId));
    if (lock === null) return;
    try {
      let inspected: StoredObject | null;
      try {
        inspected = await this.#store.inspect(objectKey);
        if (inspected === null) {
          const stagedKey = stagingObjectKey(upload.attemptId);
          const staged = await this.#store.inspectStaged(stagedKey);
          if (
            staged?.sha256 === state.batch.zipSha256 &&
            staged.byteLength === state.batch.declaredBytes
          ) {
            await this.#store.publishStaged(stagedKey, objectKey);
            inspected = await this.#store.inspect(objectKey);
          }
        }
      } catch (error) {
        if (error instanceof StoreIntegrityError) fail('STORAGE_INTEGRITY_ERROR');
        throw error;
      }
      if (inspected === null) {
        await this.#repository.failIncompleteUpload(
          identity.ownerId,
          projectId,
          batchId,
          upload.attemptId,
        );
        return;
      }
      if (
        inspected.byteLength !== state.batch.declaredBytes ||
        inspected.sha256 !== state.batch.zipSha256
      ) {
        await this.#repository.failIncompleteUpload(
          identity.ownerId,
          projectId,
          batchId,
          upload.attemptId,
        );
        return;
      }
      await this.#repository.convergeUploadStaged(
        identity.ownerId,
        identity.authEpoch,
        projectId,
        batchId,
        upload.attemptId,
        {
          objectKey,
          sha256: inspected.sha256,
          byteLength: inspected.byteLength,
          mediaType: 'application/zip',
        },
      );
    } finally {
      await lock.release();
    }
  }

  async upload(identity: SessionIdentity, input: UploadInput): Promise<{ batch: BatchView }> {
    const projectId = uuidV7(input.projectId);
    const batchId = uuidV7(input.batchId);
    const attemptId = uuidV7(input.attemptId);
    const generation = safeInteger(input.generation);
    if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0)
      fail('INVALID_REQUEST');
    const state = await this.#repository.readBatchState(identity.ownerId, projectId, batchId);
    if (input.contentLength !== state.batch.declaredBytes) fail('INVALID_REQUEST');
    const lock = await acquireExclusiveLock(attemptLockPath(this.#store.root, attemptId));
    if (lock === null) fail('UPLOAD_BUSY');
    let completed: { batch: BatchRecord; attempt: AttemptRecord } | undefined;
    try {
      await this.#repository.claimUpload(
        identity.ownerId,
        identity.authEpoch,
        projectId,
        batchId,
        attemptId,
        generation,
      );
      const stagedKey = stagingObjectKey(attemptId);
      let staged: StoredObject;
      try {
        staged = await this.#store.writeStaged(stagedKey, input.chunks, state.batch.declaredBytes);
      } catch (error) {
        await this.#store.remove(stagedKey).catch(() => undefined);
        await this.#repository
          .failUpload(identity.ownerId, projectId, batchId, attemptId, ['UPLOAD_INCOMPLETE'])
          .catch(() => undefined);
        if (error instanceof StoreIntegrityError) fail('INPUT_REJECTED');
        throw error;
      }
      if (
        staged.byteLength !== state.batch.declaredBytes ||
        staged.sha256 !== state.batch.zipSha256
      ) {
        await this.#store.remove(stagedKey).catch(() => undefined);
        await this.#repository.failUpload(identity.ownerId, projectId, batchId, attemptId, [
          'UPLOAD_INCOMPLETE',
        ]);
        fail('INPUT_REJECTED');
      }
      const finalKey = originalObjectKey(identity.ownerId, projectId, batchId, attemptId);
      try {
        await this.#store.publishStaged(stagedKey, finalKey);
      } catch (error) {
        await this.#store.remove(stagedKey).catch(() => undefined);
        await this.#repository.markUploadUnknown(identity.ownerId, projectId, batchId);
        if (error instanceof StoreIntegrityError) fail('STORAGE_INTEGRITY_ERROR');
        fail('OUTCOME_UNKNOWN');
      }
      const receipt: ObjectReceipt = {
        objectKey: finalKey,
        sha256: staged.sha256,
        byteLength: staged.byteLength,
        mediaType: 'application/zip',
      };
      try {
        completed = await this.#repository.completeUpload(
          identity.ownerId,
          identity.authEpoch,
          projectId,
          batchId,
          attemptId,
          generation,
          receipt,
        );
      } catch (error) {
        if (error instanceof MvpError && error.code === 'RECOVERY_NOT_ALLOWED') {
          await this.#repository
            .markUploadUnknown(identity.ownerId, projectId, batchId)
            .catch(() => undefined);
        }
        throw error;
      }
    } finally {
      await lock.release();
    }
    this.#schedule(
      this.#executeExtraction(
        identity.ownerId,
        projectId,
        batchId,
        completed.attempt.attemptId,
        completed.attempt.generation,
        identity.authEpoch,
      ),
    );
    return { batch: batchView(completed.batch, completed.attempt) };
  }

  async resumePendingExtractions(): Promise<void> {
    const pending = await this.#db.pendingExtractions();
    for (const item of pending) {
      const state = await this.#repository
        .readBatchState(item.ownerId, item.projectId, item.batchId)
        .catch(() => undefined);
      if (state === undefined || state.batch.manifestId !== undefined) continue;
      const binding = await this.#db.currentBinding(item.ownerId);
      if (
        binding === undefined ||
        !binding.enabled ||
        binding.authEpoch !== item.authorizedAuthEpoch
      ) {
        const lock = await acquireExclusiveLock(attemptLockPath(this.#store.root, item.attemptId));
        if (lock === null) continue;
        try {
          await this.#repository
            .failExtraction(item.ownerId, item.projectId, item.batchId, item.attemptId, false, [
              'AUTHORIZATION_CHANGED',
            ])
            .catch(() => undefined);
        } finally {
          await lock.release();
        }
        continue;
      }
      await this.#executeExtraction(
        item.ownerId,
        item.projectId,
        item.batchId,
        item.attemptId,
        item.generation,
        binding.authEpoch,
      );
    }
  }

  async #executeExtraction(
    ownerId: string,
    projectId: string,
    batchId: string,
    attemptId: string,
    generation: number,
    authEpoch: number,
  ): Promise<void> {
    const lock = await acquireExclusiveLock(attemptLockPath(this.#store.root, attemptId));
    if (lock === null) return;
    try {
      const binding = await this.#db.currentBinding(ownerId);
      if (binding === undefined || !binding.enabled || binding.authEpoch !== authEpoch) return;
      let claimed: AttemptRecord;
      try {
        claimed = await this.#repository.claimExtraction(
          ownerId,
          authEpoch,
          projectId,
          batchId,
          attemptId,
          generation,
        );
      } catch (error) {
        if (error instanceof MvpError && error.code === 'RECOVERY_NOT_ALLOWED') return;
        throw error;
      }
      const state = await this.#repository.readBatchState(ownerId, projectId, batchId);
      const original = state.batch.originalZipSource;
      const objectKey = state.originalObjectKey;
      if (original === undefined || objectKey === undefined) {
        await this.#repository.failExtraction(ownerId, projectId, batchId, attemptId, false, [
          'STORAGE_INTEGRITY_ERROR',
        ]);
        return;
      }
      let bytes: Buffer;
      try {
        bytes = await this.#store.readVerified(objectKey, {
          sha256: original.sha256,
          byteLength: original.byteLength,
        });
      } catch (error) {
        if (error instanceof StoreIntegrityError) {
          await this.#repository.failExtraction(ownerId, projectId, batchId, attemptId, false, [
            'STORAGE_INTEGRITY_ERROR',
          ]);
          return;
        }
        throw error;
      }
      const scanned = scanInputPackage(bytes);
      const receipts: ObjectReceipt[] = [];
      const entries: ManifestEntry[] = [];
      for (const entry of scanned.entries) {
        const sourceId = newUuidV7();
        let sourceRef: SourceRef | undefined;
        if (entry.status === 'ACCEPTED') {
          if (entry.content === undefined || entry.mediaType === undefined)
            throw new Error('accepted entry has no content');
          const key = entryObjectKey(ownerId, projectId, batchId, attemptId, entry.ordinal);
          const stored = await this.#store.putImmutable(key, entry.content, entry.mediaType);
          if (stored.sha256 !== entry.sha256 || stored.byteLength !== entry.byteLength)
            throw new StoreIntegrityError();
          receipts.push({
            objectKey: key,
            sha256: stored.sha256,
            byteLength: stored.byteLength,
            mediaType: entry.mediaType,
          });
          sourceRef = {
            projectId,
            batchId,
            sourceId,
            kind: 'ACCEPTED_ENTRY',
            sha256: entry.sha256,
            byteLength: entry.byteLength,
            mediaType: entry.mediaType,
          };
        }
        entries.push({
          entryId: newUuidV7(),
          ordinal: entry.ordinal,
          originalName: entry.originalName,
          normalizedPath: entry.normalizedPath,
          status: entry.status,
          reasonCodes: entry.reasonCodes,
          ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
          byteLength: entry.byteLength,
          sha256: entry.sha256,
          ...(sourceRef === undefined ? {} : { sourceRef }),
        });
      }
      const createdAt = this.#now().toISOString();
      const base = {
        manifestId: newUuidV7(),
        schemaVersion: 'mvp.input_manifest@1' as const,
        ownerId,
        projectId,
        batchId,
        batchNo: state.batch.batchNo,
        originalZip: original,
        entries,
        policyVersion: MVP_INPUT_POLICY_VERSION,
        extractorVersion: MVP_EXTRACTOR_VERSION,
        createdAt,
        ...(state.batch.note === undefined ? {} : { note: state.batch.note }),
      };
      const manifest: InputManifest = { ...base, manifestHash: manifestHash(base) };
      await this.#repository.acceptManifest(
        ownerId,
        authEpoch,
        projectId,
        batchId,
        claimed.attemptId,
        generation,
        manifest,
        entries,
        receipts,
      );
    } catch (error) {
      if (error instanceof ZipSafetyError) {
        await this.#repository
          .failExtraction(ownerId, projectId, batchId, attemptId, true, [error.code])
          .catch(() => undefined);
        return;
      }
      if (error instanceof StoreIntegrityError) {
        await this.#repository
          .failExtraction(ownerId, projectId, batchId, attemptId, false, [
            'STORAGE_INTEGRITY_ERROR',
          ])
          .catch(() => undefined);
        return;
      }
      if (error instanceof MvpError) return;
      await this.#repository
        .failExtraction(ownerId, projectId, batchId, attemptId, false, ['EXTRACTION_FAILED'])
        .catch(() => undefined);
    } finally {
      await lock.release();
    }
  }
}
