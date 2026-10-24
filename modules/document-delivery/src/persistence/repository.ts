/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- node-postgres types every row as any; each raw row here is immediately narrowed by the closed row mappers, and no wire value is rendered directly. */
import type { PoolClient } from 'pg';
import { newUuidV7 } from '@zhiju/shared-kernel';

import { createCursorCodec, type CursorCodec, type CursorScope } from '../domain/cursor.js';
import { fail } from '../domain/errors.js';
import { manifestHash, assertManifestEntries } from '../domain/manifest.js';
import type {
  AttemptRecord,
  BatchDetail,
  BatchRecord,
  BatchView,
  EntryPage,
  InputManifest,
  ManifestEntry,
  ManifestSummary,
  ObjectReceipt,
  Page,
  ProjectRecord,
  ProjectSummary,
  ProjectView,
  Receipt,
  RecoveryAction,
  RequestRecord,
  RequestView,
  SourceRef,
} from '../domain/types.js';
import { entryObjectKey } from '../custody/keys.js';
import type { MvpDatabase } from './db.js';
import { isUniqueViolation, nullableStringColumn, stringColumn, type Queryable } from './db.js';
import {
  attemptRecord,
  attemptSummary,
  batchRecord,
  batchView,
  entryRecord,
  manifestRecord,
  projectRecord,
  projectSummary,
  projectView,
  requestRecord,
} from './rows.js';

const PROJECT_COLUMNS =
  'owner_id, project_id, customer_name, title, created_at, version, last_batch_no, active_batch_id';
const BATCH_COLUMNS =
  'owner_id, project_id, batch_id, batch_no, kind, original_name, declared_bytes, zip_sha256, note, policy_version, status, generation, version, original_request_id, created_at, manifest_id, reason_codes, original_zip_source, observed_at';
const ATTEMPT_COLUMNS =
  'owner_id, project_id, batch_id, attempt_id, kind, number, generation, status, process_incarnation, fencing_token, started_at, ended_at, reason_codes, staged_object_receipts, authorization_request_id, authorized_owner_id, authorized_auth_epoch, original_input_sha256';
const REQUEST_COLUMNS =
  'owner_id, project_id, request_id, operation, target_id, original_payload, payload_hash, authorization_fact, receipt, committed_at';

export interface WriteIntent {
  readonly requestId: string;
  readonly projectId: string;
  readonly targetId: string;
  readonly operation: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
}

export interface WriteOutcome<T> {
  readonly data: T;
  readonly receipt: Receipt;
  readonly replayed: boolean;
}

export interface CreateProjectInput {
  readonly projectId: string;
  readonly customerName: string;
  readonly title: string;
}

export interface CreateBatchInput {
  readonly projectId: string;
  readonly batchId: string;
  readonly expectedProjectVersion: number;
  readonly originalName: string;
  readonly declaredBytes: number;
  readonly zipSha256: string;
  readonly note?: string;
}

export interface RecoveryInput {
  readonly projectId: string;
  readonly batchId: string;
  readonly expectedBatchVersion: number;
  readonly action: RecoveryAction;
  readonly attemptId: string;
}

export interface StoredSourceLookup {
  readonly sourceRef: SourceRef;
  readonly objectKey: string;
  /** Safe display name only; never used to construct a host path. */
  readonly fileName: string;
}

export interface BatchState {
  readonly batch: BatchRecord;
  readonly attempts: readonly AttemptRecord[];
  readonly originalObjectKey?: string;
}

function transitionEvent(
  client: PoolClient,
  input: {
    ownerId: string;
    projectId: string;
    batchId?: string;
    attemptId?: string;
    eventType: string;
    requestId?: string;
    fromStatus?: string;
    toStatus?: string;
    reasonCodes?: readonly string[];
    at: string;
  },
): Promise<unknown> {
  return client.query(
    `INSERT INTO document_delivery.custody_events
       (owner_id, project_id, event_id, batch_id, attempt_id, event_type, from_status, to_status, reason_codes, request_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)`,
    [
      input.ownerId,
      input.projectId,
      newUuidV7(),
      input.batchId ?? null,
      input.attemptId ?? null,
      input.eventType,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      JSON.stringify(input.reasonCodes ?? []),
      input.requestId ?? null,
      input.at,
    ],
  );
}

export function permittedActions(
  batch: BatchRecord,
  attempts: readonly AttemptRecord[],
): readonly RecoveryAction[] {
  if (['RECEIVED', 'PARTIAL', 'REJECTED', 'ABANDONED'].includes(batch.status)) return [];
  if (batch.manifestId !== undefined) return [];
  if (batch.status === 'UNKNOWN') return ['RECONCILE'];
  if (batch.status === 'RECEIVING') return ['RECONCILE'];
  if (batch.status === 'STAGED')
    return batch.originalZipSource === undefined ? ['ABANDON'] : ['CONTINUE_EXTRACTION', 'ABANDON'];
  if (batch.status === 'FAILED') {
    const actions: RecoveryAction[] = ['ABANDON'];
    const unfinishedUpload = attempts.some(
      (attempt) =>
        attempt.kind === 'UPLOAD' && ['PREPARED', 'RUNNING', 'UNKNOWN'].includes(attempt.status),
    );
    const unfinishedExtract = attempts.some(
      (attempt) =>
        attempt.kind === 'EXTRACT' && ['PREPARED', 'RUNNING', 'UNKNOWN'].includes(attempt.status),
    );
    if (!unfinishedUpload && batch.originalZipSource === undefined) actions.unshift('RETRY_UPLOAD');
    if (!unfinishedExtract && batch.originalZipSource !== undefined)
      actions.unshift('CONTINUE_EXTRACTION');
    return actions;
  }
  if (batch.status === 'AWAITING_UPLOAD') {
    const current = attempts.at(-1);
    if (current !== undefined && ['FAILED', 'ABANDONED'].includes(current.status))
      return ['RETRY_UPLOAD', 'ABANDON'];
    return ['ABANDON'];
  }
  return [];
}

export class MvpRepository {
  readonly #db: MvpDatabase;
  readonly #cursors: CursorCodec;
  readonly #now: () => Date;
  readonly #incarnation: string;

  constructor(options: {
    database: MvpDatabase;
    cursorKey: Buffer;
    incarnation: string;
    now?: () => Date;
  }) {
    this.#db = options.database;
    this.#cursors = createCursorCodec(options.cursorKey);
    this.#incarnation = options.incarnation;
    this.#now = options.now ?? (() => new Date());
  }

  get database(): MvpDatabase {
    return this.#db;
  }

  #scope(
    endpoint: string,
    ownerId: string,
    authEpoch: number,
    extra: { projectId?: string; batchId?: string; manifestId?: string } = {},
  ): CursorScope {
    return { endpoint, ownerId, authEpoch, ...extra };
  }

  async #findRequest(
    client: Queryable,
    ownerId: string,
    requestId: string,
  ): Promise<RequestRecord | undefined> {
    const result = await client.query(
      `SELECT ${REQUEST_COLUMNS} FROM document_delivery.requests WHERE owner_id = $1 AND request_id = $2`,
      [ownerId, requestId],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : requestRecord(row);
  }

  #assertReplay(request: RequestRecord, intent: WriteIntent): void {
    if (
      request.operation !== intent.operation ||
      request.projectId !== intent.projectId ||
      request.targetId !== intent.targetId ||
      request.payloadHash !== intent.payloadHash
    )
      fail('IDEMPOTENCY_CONFLICT');
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the result shape is supplied by the owning operation.
  async #insertRequest<T>(
    client: Queryable,
    ownerId: string,
    authEpoch: number,
    intent: WriteIntent,
    result: T,
    at: string,
  ): Promise<Receipt> {
    const receipt: Receipt = {
      requestId: intent.requestId,
      projectId: intent.projectId,
      operation: intent.operation,
      targetId: intent.targetId,
      payloadHash: intent.payloadHash,
      committedAt: at,
      result,
    };
    await client.query(
      `INSERT INTO document_delivery.requests
         (owner_id, project_id, request_id, operation, target_id, original_payload, payload_hash, authorization_fact, receipt, committed_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10)`,
      [
        ownerId,
        intent.projectId,
        intent.requestId,
        intent.operation,
        intent.targetId,
        JSON.stringify(intent.payload),
        Buffer.from(intent.payloadHash, 'hex'),
        JSON.stringify({ ownerId, authEpoch, authorizedAt: at }),
        JSON.stringify(receipt),
        at,
      ],
    );
    return receipt;
  }

  async #replay<T>(
    ownerId: string,
    intent: WriteIntent,
    projectId: string | undefined,
  ): Promise<WriteOutcome<T> | undefined> {
    const request = await this.#db.transaction(ownerId, projectId, (client) =>
      this.#findRequest(client, ownerId, intent.requestId),
    );
    if (request === undefined) return undefined;
    this.#assertReplay(request, intent);
    return { data: request.receipt.result as T, receipt: request.receipt, replayed: true };
  }

  // ------------------------------------------------------------------ reads

  async listProjects(
    ownerId: string,
    authEpoch: number,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<ProjectSummary>> {
    return this.#db.transaction(ownerId, undefined, async (client) => {
      const scope = this.#scope('projects', ownerId, authEpoch);
      const position = cursor === undefined ? undefined : this.#cursors.decode(cursor, scope);
      const upper =
        position?.upper ??
        Number(
          (
            await client.query(
              'SELECT coalesce(max(creation_seq), 0) AS upper FROM document_delivery.projects',
            )
          ).rows[0]?.upper ?? 0,
        );
      const last = position?.last ?? 0;
      const rows = (
        await client.query(
          `SELECT ${PROJECT_COLUMNS}, creation_seq FROM document_delivery.projects
           WHERE creation_seq > $1 AND creation_seq <= $2 ORDER BY creation_seq ASC LIMIT $3`,
          [last, upper, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit);
      const items = page.map((row) => projectSummary(projectRecord(row)));
      const lastRow = page.at(-1);
      return {
        items,
        ...(rows.length > limit && lastRow !== undefined
          ? {
              nextCursor: this.#cursors.encode({
                ...scope,
                upper,
                last: Number(lastRow.creation_seq),
              }),
            }
          : {}),
      };
    });
  }

  async getProject(ownerId: string, projectId: string): Promise<ProjectView> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const row = (
        await client.query(
          `SELECT ${PROJECT_COLUMNS} FROM document_delivery.projects WHERE owner_id = $1 AND project_id = $2`,
          [ownerId, projectId],
        )
      ).rows[0];
      if (row === undefined) fail('RESOURCE_NOT_FOUND');
      return projectView(projectRecord(row));
    });
  }

  async listBatches(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<BatchRecord>> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const projectRow = (
        await client.query(
          'SELECT last_batch_no FROM document_delivery.projects WHERE owner_id = $1 AND project_id = $2',
          [ownerId, projectId],
        )
      ).rows[0];
      if (projectRow === undefined) fail('RESOURCE_NOT_FOUND');
      const scope = this.#scope('batches', ownerId, authEpoch, { projectId });
      const position = cursor === undefined ? undefined : this.#cursors.decode(cursor, scope);
      const upper = position?.upper ?? Number(projectRow.last_batch_no);
      const last = position?.last ?? 0;
      const rows = (
        await client.query(
          `SELECT ${BATCH_COLUMNS} FROM document_delivery.input_batches
           WHERE owner_id = $1 AND project_id = $2
             AND batch_no > $3 AND batch_no <= $4 ORDER BY batch_no ASC LIMIT $5`,
          [ownerId, projectId, last, upper, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit).map(batchRecord);
      const lastItem = page.at(-1);
      return {
        items: page,
        ...(rows.length > limit && lastItem !== undefined
          ? {
              nextCursor: this.#cursors.encode({
                ...scope,
                upper,
                last: lastItem.batchNo,
              }),
            }
          : {}),
      };
    });
  }

  async readBatchState(ownerId: string, projectId: string, batchId: string): Promise<BatchState> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batchRow: Record<string, unknown> | undefined = (
        await client.query(
          `SELECT ${BATCH_COLUMNS}, original_object_key FROM document_delivery.input_batches WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
          [ownerId, projectId, batchId],
        )
      ).rows[0];
      if (batchRow === undefined) fail('RESOURCE_NOT_FOUND');
      const attempts = (
        await client.query(
          `SELECT ${ATTEMPT_COLUMNS} FROM document_delivery.batch_attempts
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 ORDER BY creation_seq ASC`,
          [ownerId, projectId, batchId],
        )
      ).rows.map(attemptRecord);
      const originalObjectKey = batchRow.original_object_key;
      return {
        batch: batchRecord(batchRow),
        attempts,
        ...(typeof originalObjectKey === 'string' ? { originalObjectKey } : {}),
      };
    });
  }

  async getBatchDetail(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    attemptLimit: number,
    attemptCursor: string | undefined,
  ): Promise<BatchDetail> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batchRow = (
        await client.query(
          `SELECT ${BATCH_COLUMNS} FROM document_delivery.input_batches WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
          [ownerId, projectId, batchId],
        )
      ).rows[0];
      if (batchRow === undefined) fail('RESOURCE_NOT_FOUND');
      const batch = batchRecord(batchRow);
      const scope = this.#scope('attempts', ownerId, authEpoch, { projectId, batchId });
      const position =
        attemptCursor === undefined ? undefined : this.#cursors.decode(attemptCursor, scope);
      const upper =
        position?.upper ??
        Number(
          (
            await client.query(
              `SELECT coalesce(max(creation_seq), 0) AS upper FROM document_delivery.batch_attempts
               WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
              [ownerId, projectId, batchId],
            )
          ).rows[0]?.upper ?? 0,
        );
      const last = position?.last ?? 0;
      const attemptRows = (
        await client.query(
          `SELECT ${ATTEMPT_COLUMNS}, creation_seq FROM document_delivery.batch_attempts
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
             AND creation_seq > $4 AND creation_seq <= $5
           ORDER BY creation_seq ASC LIMIT $6`,
          [ownerId, projectId, batchId, last, upper, attemptLimit + 1],
        )
      ).rows;
      const page = attemptRows.slice(0, attemptLimit).map(attemptRecord);
      const lastAttemptRow = attemptRows[attemptLimit - 1];
      const currentRow = (
        await client.query(
          `SELECT ${ATTEMPT_COLUMNS} FROM document_delivery.batch_attempts
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           ORDER BY creation_seq DESC LIMIT 1`,
          [ownerId, projectId, batchId],
        )
      ).rows[0];
      const currentAttempt = currentRow === undefined ? undefined : attemptRecord(currentRow);
      const allAttempts = (
        await client.query(
          `SELECT ${ATTEMPT_COLUMNS} FROM document_delivery.batch_attempts
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 ORDER BY creation_seq ASC`,
          [ownerId, projectId, batchId],
        )
      ).rows.map(attemptRecord);
      const manifestRow =
        batch.manifestId === undefined
          ? undefined
          : (
              await client.query(
                `SELECT payload, manifest_hash, manifest_id, total_entries FROM document_delivery.input_manifests
                 WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
                [ownerId, projectId, batchId],
              )
            ).rows[0];
      const manifest =
        manifestRow === undefined
          ? undefined
          : this.#manifestSummary(manifestRow as Record<string, unknown>);
      return {
        batch: batchView(batch, currentAttempt),
        attempts: page.map(attemptSummary),
        ...(attemptRows.length > attemptLimit && lastAttemptRow !== undefined
          ? {
              nextAttemptCursor: this.#cursors.encode({
                ...scope,
                upper,
                last: Number(lastAttemptRow.creation_seq),
              }),
            }
          : {}),
        ...(manifest === undefined ? {} : { manifest }),
        permittedActions: permittedActions(batch, allAttempts),
      };
    });
  }

  #manifestSummary(row: Record<string, unknown>): ManifestSummary {
    const manifest = manifestRecord(row);
    return {
      manifestId: manifest.manifestId,
      manifestHash: manifest.manifestHash,
      batchId: manifest.batchId,
      originalZip: manifest.originalZip,
      totalEntries: manifest.entries.length,
      acceptedEntries: manifest.entries.filter((entry) => entry.status === 'ACCEPTED').length,
      limitedEntries: manifest.entries.filter((entry) => entry.status !== 'ACCEPTED').length,
      createdAt: manifest.createdAt,
    };
  }

  async listEntries(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    manifestId: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<EntryPage> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const manifestRow = (
        await client.query(
          `SELECT payload, manifest_hash, manifest_id, total_entries
           FROM document_delivery.input_manifests
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
          [ownerId, projectId, batchId],
        )
      ).rows[0];
      if (manifestRow === undefined) fail('MANIFEST_NOT_READY');
      const manifest = manifestRecord(manifestRow as Record<string, unknown>);
      if (manifest.manifestId !== manifestId) fail('MANIFEST_NOT_READY');
      const scope = this.#scope('entries', ownerId, authEpoch, { projectId, manifestId });
      const position = cursor === undefined ? undefined : this.#cursors.decode(cursor, scope);
      const upper =
        position?.upper ??
        Number(
          (
            await client.query(
              `SELECT coalesce(max(ordinal), 0) AS upper FROM document_delivery.source_entries
               WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
              [ownerId, projectId, batchId],
            )
          ).rows[0]?.upper ?? 0,
        );
      const last = position?.last ?? -1;
      const rows = (
        await client.query(
          `SELECT * FROM document_delivery.source_entries
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
             AND ordinal > $4 AND ordinal <= $5
           ORDER BY ordinal ASC LIMIT $6`,
          [ownerId, projectId, batchId, last, upper, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit).map((row) => entryRecord(row as Record<string, unknown>));
      const lastEntry = page.at(-1);
      return {
        manifest: this.#manifestSummary(manifestRow as Record<string, unknown>),
        entries: page,
        ...(rows.length > limit && lastEntry !== undefined
          ? {
              nextCursor: this.#cursors.encode({
                ...scope,
                upper,
                last: lastEntry.ordinal,
              }),
            }
          : {}),
      };
    });
  }

  async getRequestView(ownerId: string, requestId: string): Promise<RequestView> {
    return this.#db.transaction(ownerId, undefined, async (client) => {
      const request = await this.#findRequest(client, ownerId, requestId);
      if (request === undefined) fail('RESOURCE_NOT_FOUND');
      return {
        requestId: request.requestId,
        projectId: request.projectId,
        operation: request.operation,
        targetId: request.targetId,
        payloadHash: request.payloadHash,
        receipt: request.receipt,
      };
    });
  }

  async storedSource(
    ownerId: string,
    projectId: string,
    batchId: string,
    sourceId: string,
  ): Promise<StoredSourceLookup> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batchRow = (
        await client.query(
          `SELECT status, manifest_id, original_zip_source, original_object_key
           FROM document_delivery.input_batches
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
          [ownerId, projectId, batchId],
        )
      ).rows[0];
      if (batchRow === undefined) fail('RESOURCE_NOT_FOUND');
      const manifestId = nullableStringColumn(batchRow as Record<string, unknown>, 'manifest_id');
      const status = stringColumn(batchRow as Record<string, unknown>, 'status');
      if (manifestId === undefined || !['RECEIVED', 'PARTIAL'].includes(status))
        fail('RESOURCE_NOT_FOUND');
      const manifestRow = (
        await client.query(
          `SELECT payload, manifest_hash, manifest_id, total_entries
           FROM document_delivery.input_manifests
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND manifest_id = $4`,
          [ownerId, projectId, batchId, manifestId],
        )
      ).rows[0];
      if (manifestRow === undefined) fail('RESOURCE_NOT_FOUND');
      const manifest = manifestRecord(manifestRow as Record<string, unknown>);
      if (manifest.manifestId !== manifestId) fail('RESOURCE_NOT_FOUND');
      const original = manifest.originalZip;
      if (original.sourceId === sourceId) {
        const objectKey = stringColumn(batchRow as Record<string, unknown>, 'original_object_key');
        return { sourceRef: original, objectKey, fileName: 'original.zip' };
      }
      const entryRow = (
        await client.query(
          `SELECT * FROM document_delivery.source_entries
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND source_id = $4
             AND manifest_id = $5`,
          [ownerId, projectId, batchId, sourceId, manifestId],
        )
      ).rows[0];
      if (entryRow === undefined) fail('RESOURCE_NOT_FOUND');
      const entry = entryRecord(entryRow as Record<string, unknown>);
      if (entry.sourceRef === undefined) fail('RESOURCE_NOT_FOUND');
      return {
        sourceRef: entry.sourceRef,
        objectKey: stringColumn(entryRow as Record<string, unknown>, 'object_key'),
        fileName: entry.originalName,
      };
    });
  }

  // ------------------------------------------------------------------ writes

  async #lockProject(
    client: PoolClient,
    ownerId: string,
    projectId: string,
  ): Promise<ProjectRecord> {
    const result = await client.query(
      `SELECT ${PROJECT_COLUMNS} FROM document_delivery.projects
       WHERE owner_id = $1 AND project_id = $2 FOR UPDATE`,
      [ownerId, projectId],
    );
    const row: Record<string, unknown> | undefined = result.rows[0];
    if (row === undefined) fail('RESOURCE_NOT_FOUND');
    return projectRecord(row);
  }

  async #lockBatch(
    client: PoolClient,
    ownerId: string,
    projectId: string,
    batchId: string,
  ): Promise<BatchRecord> {
    const result = await client.query(
      `SELECT ${BATCH_COLUMNS} FROM document_delivery.input_batches
       WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 FOR UPDATE`,
      [ownerId, projectId, batchId],
    );
    const row: Record<string, unknown> | undefined = result.rows[0];
    if (row === undefined) fail('RESOURCE_NOT_FOUND');
    return batchRecord(row);
  }

  async #allAttempts(
    client: PoolClient,
    ownerId: string,
    projectId: string,
    batchId: string,
  ): Promise<AttemptRecord[]> {
    const result = await client.query(
      `SELECT ${ATTEMPT_COLUMNS} FROM document_delivery.batch_attempts
       WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 ORDER BY creation_seq ASC`,
      [ownerId, projectId, batchId],
    );
    const rows: Record<string, unknown>[] = result.rows;
    return rows.map(attemptRecord);
  }

  async #assertCurrentBinding(
    client: PoolClient,
    ownerId: string,
    authEpoch: number,
  ): Promise<void> {
    const result = await client.query(
      'SELECT enabled, auth_epoch FROM document_delivery.current_binding($1)',
      [ownerId],
    );
    const row: Record<string, unknown> | undefined = result.rows[0];
    if (row === undefined) fail('RECOVERY_NOT_ALLOWED');
    if (row.enabled !== true) fail('RECOVERY_NOT_ALLOWED');
    if (Number(row.auth_epoch) !== authEpoch) fail('RECOVERY_NOT_ALLOWED');
  }

  /**
   * The persisted attempt's original authorization must still be the current
   * binding. A fresh caller at a newer epoch cannot continue an old attempt;
   * only an explicit recovery Request creates a new authorized attempt.
   */
  async #assertAttemptAuthorization(
    client: PoolClient,
    ownerId: string,
    authEpoch: number,
    attempt: AttemptRecord,
  ): Promise<void> {
    if (attempt.authorizedOwnerId !== ownerId || attempt.authorizedAuthEpoch !== authEpoch)
      fail('RECOVERY_NOT_ALLOWED');
    await this.#assertCurrentBinding(client, ownerId, authEpoch);
  }

  async #releaseActive(
    client: PoolClient,
    ownerId: string,
    projectId: string,
    batchId: string,
  ): Promise<void> {
    await client.query(
      `UPDATE document_delivery.projects SET active_batch_id = NULL, version = version + 1
       WHERE owner_id = $1 AND project_id = $2 AND active_batch_id = $3`,
      [ownerId, projectId, batchId],
    );
  }

  async #insertAttempt(
    client: PoolClient,
    input: {
      ownerId: string;
      projectId: string;
      batchId: string;
      attemptId: string;
      kind: 'UPLOAD' | 'EXTRACT';
      number: number;
      generation: number;
      authorizationRequestId: string;
      authEpoch: number;
      inputSha256: string;
      at: string;
    },
  ): Promise<AttemptRecord> {
    const result = await client.query(
      `INSERT INTO document_delivery.batch_attempts
         (owner_id, project_id, batch_id, attempt_id, kind, number, generation, status,
          process_incarnation, fencing_token, started_at, ended_at, reason_codes,
          staged_object_receipts, authorization_request_id, authorized_owner_id,
          authorized_auth_epoch, original_input_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PREPARED',$8,$9,$10,NULL,'[]'::jsonb,'[]'::jsonb,$11,$1,$12,$13)
       RETURNING ${ATTEMPT_COLUMNS}`,
      [
        input.ownerId,
        input.projectId,
        input.batchId,
        input.attemptId,
        input.kind,
        input.number,
        input.generation,
        this.#incarnation,
        newUuidV7(),
        input.at,
        input.authorizationRequestId,
        input.authEpoch,
        Buffer.from(input.inputSha256, 'hex'),
      ],
    );
    const row: Record<string, unknown> = result.rows[0];
    return attemptRecord(row);
  }

  #attemptNumber(attempts: readonly AttemptRecord[], kind: 'UPLOAD' | 'EXTRACT'): number {
    const numbers = attempts
      .filter((attempt) => attempt.kind === kind)
      .map((attempt) => attempt.number);
    return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
  }

  async #abandonUnfinished(
    client: PoolClient,
    ownerId: string,
    projectId: string,
    batchId: string,
    kind: 'UPLOAD' | 'EXTRACT',
    attempts: readonly AttemptRecord[],
    at: string,
  ): Promise<void> {
    for (const attempt of attempts) {
      if (attempt.kind !== kind) continue;
      if (!['PREPARED', 'RUNNING', 'UNKNOWN'].includes(attempt.status)) continue;
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'ABANDONED', ended_at = $1,
             reason_codes = '["RECOVERY_REQUIRED"]'::jsonb
         WHERE owner_id = $2 AND project_id = $3 AND batch_id = $4 AND attempt_id = $5`,
        [at, ownerId, projectId, batchId, attempt.attemptId],
      );
    }
  }

  async createProject(
    ownerId: string,
    authEpoch: number,
    intent: WriteIntent,
    input: CreateProjectInput,
  ): Promise<WriteOutcome<{ project: ProjectView }>> {
    try {
      return await this.#db.transaction(ownerId, undefined, async (client) => {
        const existing = await this.#findRequest(client, ownerId, intent.requestId);
        if (existing !== undefined) {
          this.#assertReplay(existing, intent);
          return {
            data: existing.receipt.result as { project: ProjectView },
            receipt: existing.receipt,
            replayed: true,
          };
        }
        const at = this.#now().toISOString();
        const project: ProjectRecord = {
          projectId: input.projectId,
          ownerId,
          customerName: input.customerName,
          title: input.title,
          createdAt: at,
          version: 1,
          lastBatchNo: 0,
        };
        const data = { project: projectView(project) };
        await client.query(
          `INSERT INTO document_delivery.projects
             (owner_id, project_id, customer_name, title, created_at, version, last_batch_no)
           VALUES ($1,$2,$3,$4,$5,1,0)`,
          [ownerId, input.projectId, input.customerName, input.title, at],
        );
        const receipt = await this.#insertRequest(client, ownerId, authEpoch, intent, data, at);
        await transitionEvent(client, {
          ownerId,
          projectId: input.projectId,
          eventType: 'PROJECT_CREATED',
          requestId: intent.requestId,
          at,
        });
        return { data, receipt, replayed: false };
      });
    } catch (error) {
      return this.#mapWriteConflict(ownerId, intent, intent.projectId, error);
    }
  }

  async createBatch(
    ownerId: string,
    authEpoch: number,
    intent: WriteIntent,
    input: CreateBatchInput,
  ): Promise<WriteOutcome<{ batch: BatchView }>> {
    try {
      return await this.#db.transaction(ownerId, input.projectId, async (client) => {
        const existing = await this.#findRequest(client, ownerId, intent.requestId);
        if (existing !== undefined) {
          this.#assertReplay(existing, intent);
          return {
            data: existing.receipt.result as { batch: BatchView },
            receipt: existing.receipt,
            replayed: true,
          };
        }
        const project = await this.#lockProject(client, ownerId, input.projectId);
        if (project.version !== input.expectedProjectVersion) fail('VERSION_CONFLICT');
        if (project.activeBatchId !== undefined) fail('PROJECT_BUSY');
        const at = this.#now().toISOString();
        const batchNo = project.lastBatchNo + 1;
        const attempt: AttemptRecord = {
          attemptId: newUuidV7(),
          ownerId,
          projectId: input.projectId,
          batchId: input.batchId,
          kind: 'UPLOAD',
          number: 1,
          generation: 1,
          status: 'PREPARED',
          authorizationRequestId: intent.requestId,
          authorizedOwnerId: ownerId,
          authorizedAuthEpoch: authEpoch,
          originalInputSha256: input.zipSha256,
          startedAt: at,
          reasonCodes: [],
          stagedObjectReceipts: [],
        };
        const batch: BatchRecord = {
          batchId: input.batchId,
          ownerId,
          projectId: input.projectId,
          batchNo,
          kind: batchNo === 1 ? 'INITIAL' : 'SUPPLEMENT',
          originalName: input.originalName,
          declaredBytes: input.declaredBytes,
          zipSha256: input.zipSha256,
          policyVersion: 'mvp.zip-input@1',
          status: 'AWAITING_UPLOAD',
          generation: 1,
          version: 1,
          originalRequestId: intent.requestId,
          createdAt: at,
          reasonCodes: [],
          observedAt: at,
          ...(input.note === undefined ? {} : { note: input.note }),
        };
        const data = { batch: batchView(batch, attempt) };
        const receipt = await this.#insertRequest(client, ownerId, authEpoch, intent, data, at);
        await client.query(
          `INSERT INTO document_delivery.input_batches
             (owner_id, project_id, batch_id, batch_no, kind, original_name, declared_bytes,
              zip_sha256, note, policy_version, status, generation, version, original_request_id,
              created_at, manifest_id, reason_codes, original_zip_source, original_object_key,
              observed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'AWAITING_UPLOAD',1,1,$11,$12,NULL,
                   '[]'::jsonb,NULL,NULL,$12)`,
          [
            ownerId,
            input.projectId,
            input.batchId,
            batchNo,
            batch.kind,
            input.originalName,
            input.declaredBytes,
            Buffer.from(input.zipSha256, 'hex'),
            input.note ?? null,
            batch.policyVersion,
            intent.requestId,
            at,
          ],
        );
        await this.#insertAttempt(client, {
          ownerId,
          projectId: input.projectId,
          batchId: input.batchId,
          attemptId: attempt.attemptId,
          kind: 'UPLOAD',
          number: 1,
          generation: 1,
          authorizationRequestId: intent.requestId,
          authEpoch,
          inputSha256: input.zipSha256,
          at,
        });
        await client.query(
          `UPDATE document_delivery.projects
           SET version = version + 1, last_batch_no = $3, active_batch_id = $4
           WHERE owner_id = $1 AND project_id = $2`,
          [ownerId, input.projectId, batchNo, input.batchId],
        );
        await transitionEvent(client, {
          ownerId,
          projectId: input.projectId,
          batchId: input.batchId,
          eventType: 'BATCH_CREATED',
          requestId: intent.requestId,
          toStatus: 'AWAITING_UPLOAD',
          at,
        });
        return { data, receipt, replayed: false };
      });
    } catch (error) {
      return this.#mapWriteConflict(ownerId, intent, input.projectId, error);
    }
  }

  async #mapWriteConflict<T>(
    ownerId: string,
    intent: WriteIntent,
    projectId: string,
    error: unknown,
  ): Promise<WriteOutcome<T>> {
    if (isUniqueViolation(error, 'requests_pkey')) {
      const replay = await this.#replay<T>(ownerId, intent, projectId);
      if (replay !== undefined) return replay;
      fail('IDEMPOTENCY_CONFLICT');
    }
    if (isUniqueViolation(error, 'requests_creation_target_unique')) fail('TARGET_EXISTS');
    if (isUniqueViolation(error, 'input_batches_active_project_unique')) fail('PROJECT_BUSY');
    if (isUniqueViolation(error)) fail('TARGET_EXISTS');
    throw error;
  }

  async claimUpload(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    attemptId: string,
    generation: number,
  ): Promise<{ batch: BatchRecord; attempt: AttemptRecord }> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      const attempts = await this.#allAttempts(client, ownerId, projectId, batchId);
      const current = attempts.at(-1);
      if (batch.status === 'RECEIVING') fail('UPLOAD_BUSY');
      if (['RECEIVED', 'PARTIAL', 'REJECTED'].includes(batch.status)) fail('BATCH_SEALED');
      if (batch.status !== 'AWAITING_UPLOAD') fail('RECOVERY_NOT_ALLOWED');
      if (current === undefined) fail('RECOVERY_NOT_ALLOWED');
      if (
        current.attemptId !== attemptId ||
        current.kind !== 'UPLOAD' ||
        current.status !== 'PREPARED' ||
        batch.generation !== generation
      )
        fail('RECOVERY_NOT_ALLOWED');
      await this.#assertAttemptAuthorization(client, ownerId, authEpoch, current);
      const at = this.#now().toISOString();
      const attemptRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.batch_attempts SET status = 'RUNNING'
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4
           RETURNING ${ATTEMPT_COLUMNS}`,
          [ownerId, projectId, batchId, attemptId],
        )
      ).rows[0];
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = 'RECEIVING', version = version + 1, observed_at = $4
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [ownerId, projectId, batchId, at],
        )
      ).rows[0];
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        fromStatus: 'AWAITING_UPLOAD',
        toStatus: 'RECEIVING',
        at,
      });
      return { batch: batchRecord(batchRow), attempt: attemptRecord(attemptRow) };
    });
  }

  async completeUpload(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    attemptId: string,
    generation: number,
    receipt: ObjectReceipt,
  ): Promise<{ batch: BatchRecord; attempt: AttemptRecord }> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      const attempts = await this.#allAttempts(client, ownerId, projectId, batchId);
      const current = attempts.at(-1);
      if (batch.status !== 'RECEIVING') fail('RECOVERY_NOT_ALLOWED');
      if (current === undefined) fail('RECOVERY_NOT_ALLOWED');
      if (
        current.attemptId !== attemptId ||
        current.kind !== 'UPLOAD' ||
        current.status !== 'RUNNING' ||
        batch.generation !== generation
      )
        fail('RECOVERY_NOT_ALLOWED');
      await this.#assertAttemptAuthorization(client, ownerId, authEpoch, current);
      const at = this.#now().toISOString();
      const sourceRef: SourceRef = {
        projectId,
        batchId,
        sourceId: newUuidV7(),
        kind: 'ORIGINAL_ZIP',
        sha256: receipt.sha256,
        byteLength: receipt.byteLength,
        mediaType: 'application/zip',
      };
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'SUCCEEDED', ended_at = $5, staged_object_receipts = $6::jsonb
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
        [ownerId, projectId, batchId, attemptId, at, JSON.stringify([receipt])],
      );
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = 'STAGED', generation = generation + 1, version = version + 1,
               original_zip_source = $4::jsonb, original_object_key = $5, observed_at = $6
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [ownerId, projectId, batchId, JSON.stringify(sourceRef), receipt.objectKey, at],
        )
      ).rows[0];
      const attempt = await this.#insertAttempt(client, {
        ownerId,
        projectId,
        batchId,
        attemptId: newUuidV7(),
        kind: 'EXTRACT',
        number: this.#attemptNumber(attempts, 'EXTRACT'),
        generation: batch.generation + 1,
        authorizationRequestId: current.authorizationRequestId,
        authEpoch: current.authorizedAuthEpoch,
        inputSha256: sourceRef.sha256,
        at,
      });
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        fromStatus: 'RECEIVING',
        toStatus: 'STAGED',
        at,
      });
      return { batch: batchRecord(batchRow), attempt };
    });
  }

  async failUpload(
    ownerId: string,
    projectId: string,
    batchId: string,
    attemptId: string,
    reasons: readonly string[],
  ): Promise<BatchRecord> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      await this.#lockBatch(client, ownerId, projectId, batchId);
      const at = this.#now().toISOString();
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'FAILED', ended_at = $4, reason_codes = $5::jsonb
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           AND status IN ('PREPARED','RUNNING','UNKNOWN')`,
        [ownerId, projectId, batchId, at, JSON.stringify(reasons)],
      );
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = 'FAILED', version = version + 1, reason_codes = $4::jsonb, observed_at = $5
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [ownerId, projectId, batchId, JSON.stringify(reasons), at],
        )
      ).rows[0];
      await this.#releaseActive(client, ownerId, projectId, batchId);
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        eventType: 'BATCH_STATE',
        toStatus: 'FAILED',
        reasonCodes: reasons,
        at,
      });
      return batchRecord(batchRow);
    });
  }

  async markUploadUnknown(ownerId: string, projectId: string, batchId: string): Promise<void> {
    await this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      if (batch.status === 'UNKNOWN') return;
      const at = this.#now().toISOString();
      await client.query(
        `UPDATE document_delivery.batch_attempts SET status = 'UNKNOWN'
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           AND status IN ('PREPARED','RUNNING')`,
        [ownerId, projectId, batchId],
      );
      await client.query(
        `UPDATE document_delivery.input_batches
         SET status = 'UNKNOWN', version = version + 1, observed_at = $4
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
        [ownerId, projectId, batchId, at],
      );
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        eventType: 'BATCH_STATE',
        toStatus: 'UNKNOWN',
        at,
      });
    });
  }

  /**
   * Persist a reconciled upload whose original object is proven absent while
   * the caller holds the exclusive attempt lock. This releases the project's
   * active batch slot and exposes the bounded retry/abandon route; it is not
   * used when a writer may still be active.
   */
  async failIncompleteUpload(
    ownerId: string,
    projectId: string,
    batchId: string,
    attemptId: string,
  ): Promise<BatchRecord> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      const attempts = await this.#allAttempts(client, ownerId, projectId, batchId);
      const attempt = attempts.find((item) => item.attemptId === attemptId);
      if (
        batch.manifestId !== undefined ||
        !['AWAITING_UPLOAD', 'RECEIVING', 'UNKNOWN'].includes(batch.status)
      )
        fail('RECOVERY_NOT_ALLOWED');
      if (attempt === undefined) fail('RECOVERY_NOT_ALLOWED');
      if (attempt.kind !== 'UPLOAD' || !['PREPARED', 'RUNNING', 'UNKNOWN'].includes(attempt.status))
        fail('RECOVERY_NOT_ALLOWED');
      const at = this.#now().toISOString();
      const reasons = ['UPLOAD_INCOMPLETE'];
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'FAILED', ended_at = $5, reason_codes = $6::jsonb
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
        [ownerId, projectId, batchId, attemptId, at, JSON.stringify(reasons)],
      );
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = 'FAILED', version = version + 1, reason_codes = $4::jsonb, observed_at = $5
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [ownerId, projectId, batchId, JSON.stringify(reasons), at],
        )
      ).rows[0];
      await this.#releaseActive(client, ownerId, projectId, batchId);
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        fromStatus: batch.status,
        toStatus: 'FAILED',
        reasonCodes: reasons,
        at,
      });
      return batchRecord(batchRow);
    });
  }

  async claimExtraction(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    attemptId: string,
    generation: number,
  ): Promise<AttemptRecord> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      const attempts = await this.#allAttempts(client, ownerId, projectId, batchId);
      const attempt = attempts.find((item) => item.attemptId === attemptId);
      if (attempt === undefined || batch.manifestId !== undefined) fail('RECOVERY_NOT_ALLOWED');
      if (
        attempt.kind !== 'EXTRACT' ||
        !['PREPARED', 'RUNNING'].includes(attempt.status) ||
        attempt.generation !== generation ||
        batch.generation !== generation ||
        (attempt.status === 'PREPARED' && batch.status !== 'STAGED') ||
        (attempt.status === 'RUNNING' && batch.status !== 'EXTRACTING')
      )
        fail('RECOVERY_NOT_ALLOWED');
      await this.#assertAttemptAuthorization(client, ownerId, authEpoch, attempt);
      const at = this.#now().toISOString();
      if (attempt.status === 'RUNNING')
        return attemptRecord(
          (
            await client.query(
              `SELECT ${ATTEMPT_COLUMNS} FROM document_delivery.batch_attempts
               WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
              [ownerId, projectId, batchId, attemptId],
            )
          ).rows[0] as Record<string, unknown>,
        );
      const attemptRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.batch_attempts SET status = 'RUNNING'
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4
           RETURNING ${ATTEMPT_COLUMNS}`,
          [ownerId, projectId, batchId, attemptId],
        )
      ).rows[0];
      await client.query(
        `UPDATE document_delivery.input_batches
         SET status = 'EXTRACTING', version = version + 1, observed_at = $4
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
        [ownerId, projectId, batchId, at],
      );
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        fromStatus: 'STAGED',
        toStatus: 'EXTRACTING',
        at,
      });
      return attemptRecord(attemptRow);
    });
  }

  async acceptManifest(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    attemptId: string,
    generation: number,
    manifest: InputManifest,
    entries: readonly ManifestEntry[],
    receipts: readonly ObjectReceipt[],
  ): Promise<{ batch: BatchRecord; manifest: ManifestSummary }> {
    assertManifestEntries(entries);
    if (
      manifest.ownerId !== ownerId ||
      manifest.projectId !== projectId ||
      manifest.batchId !== batchId ||
      manifestHash(manifest) !== manifest.manifestHash
    )
      throw new Error('manifest does not match its acceptance scope');
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      const attempts = await this.#allAttempts(client, ownerId, projectId, batchId);
      const attempt = attempts.find((item) => item.attemptId === attemptId);
      if (attempt === undefined || batch.manifestId !== undefined) fail('RECOVERY_NOT_ALLOWED');
      if (
        batch.status !== 'EXTRACTING' ||
        attempt.kind !== 'EXTRACT' ||
        attempt.status !== 'RUNNING' ||
        attempt.generation !== generation ||
        batch.generation !== generation ||
        manifest.batchNo !== batch.batchNo ||
        manifest.originalZip.sourceId !== batch.originalZipSource?.sourceId
      )
        fail('RECOVERY_NOT_ALLOWED');
      await this.#assertAttemptAuthorization(client, ownerId, authEpoch, attempt);
      const at = this.#now().toISOString();
      const accepted = entries.filter((entry) => entry.status === 'ACCEPTED').length;
      const reasons = [
        ...new Set(
          entries
            .filter((entry) => entry.status !== 'ACCEPTED')
            .flatMap((entry) => entry.reasonCodes),
        ),
      ];
      await client.query(
        `INSERT INTO document_delivery.input_manifests
           (owner_id, project_id, batch_id, manifest_id, manifest_hash, payload,
            total_entries, accepted_entries, created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
        [
          ownerId,
          projectId,
          batchId,
          manifest.manifestId,
          Buffer.from(manifest.manifestHash, 'hex'),
          JSON.stringify(manifest),
          entries.length,
          accepted,
          manifest.createdAt,
        ],
      );
      for (const entry of entries) {
        const source = entry.sourceRef;
        await client.query(
          `INSERT INTO document_delivery.source_entries
             (owner_id, project_id, batch_id, manifest_id, entry_id, ordinal, original_name,
              normalized_path, status, reason_codes, media_type, byte_length, sha256,
              source_id, source_kind, source_sha256, source_byte_length, source_media_type,
              object_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [
            ownerId,
            projectId,
            batchId,
            manifest.manifestId,
            entry.entryId,
            entry.ordinal,
            entry.originalName,
            entry.normalizedPath,
            entry.status,
            JSON.stringify(entry.reasonCodes),
            entry.mediaType ?? null,
            entry.byteLength ?? null,
            entry.sha256 === undefined ? null : Buffer.from(entry.sha256, 'hex'),
            source?.sourceId ?? null,
            source === undefined ? null : 'ACCEPTED_ENTRY',
            source === undefined ? null : Buffer.from(source.sha256, 'hex'),
            source?.byteLength ?? null,
            source?.mediaType ?? null,
            source === undefined
              ? null
              : entryObjectKey(ownerId, projectId, batchId, attemptId, entry.ordinal),
          ],
        );
      }
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'SUCCEEDED', ended_at = $5, staged_object_receipts = $6::jsonb
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
        [ownerId, projectId, batchId, attemptId, at, JSON.stringify(receipts)],
      );
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = $4, manifest_id = $5, reason_codes = $6::jsonb,
               version = version + 1, observed_at = $7
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [
            ownerId,
            projectId,
            batchId,
            accepted === entries.length ? 'RECEIVED' : 'PARTIAL',
            manifest.manifestId,
            JSON.stringify(reasons),
            at,
          ],
        )
      ).rows[0];
      await this.#releaseActive(client, ownerId, projectId, batchId);
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        fromStatus: 'EXTRACTING',
        toStatus: accepted === entries.length ? 'RECEIVED' : 'PARTIAL',
        reasonCodes: reasons,
        at,
      });
      return {
        batch: batchRecord(batchRow),
        manifest: this.#manifestSummary({
          payload: manifest,
          manifest_hash: Buffer.from(manifest.manifestHash, 'hex'),
          manifest_id: manifest.manifestId,
          total_entries: entries.length,
        }),
      };
    });
  }

  async failExtraction(
    ownerId: string,
    projectId: string,
    batchId: string,
    attemptId: string,
    rejected: boolean,
    reasons: readonly string[],
  ): Promise<BatchRecord> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      await this.#lockBatch(client, ownerId, projectId, batchId);
      const at = this.#now().toISOString();
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'FAILED', ended_at = $5, reason_codes = $6::jsonb
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
        [ownerId, projectId, batchId, attemptId, at, JSON.stringify(reasons)],
      );
      const status = rejected ? 'REJECTED' : 'FAILED';
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = $4, version = version + 1, reason_codes = $5::jsonb, observed_at = $6
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [ownerId, projectId, batchId, status, JSON.stringify(reasons), at],
        )
      ).rows[0];
      await this.#releaseActive(client, ownerId, projectId, batchId);
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        toStatus: status,
        reasonCodes: reasons,
        at,
      });
      return batchRecord(batchRow);
    });
  }

  async convergeUploadStaged(
    ownerId: string,
    authEpoch: number,
    projectId: string,
    batchId: string,
    attemptId: string,
    receipt: ObjectReceipt,
  ): Promise<BatchRecord> {
    return this.#db.transaction(ownerId, projectId, async (client) => {
      const batch = await this.#lockBatch(client, ownerId, projectId, batchId);
      if (batch.status === 'STAGED') return batch;
      const attempts = await this.#allAttempts(client, ownerId, projectId, batchId);
      const attempt = attempts.find((item) => item.attemptId === attemptId);
      if (attempt === undefined) fail('RECOVERY_NOT_ALLOWED');
      if (
        attempt.kind !== 'UPLOAD' ||
        !['PREPARED', 'RUNNING', 'UNKNOWN'].includes(attempt.status) ||
        !['RECEIVING', 'UNKNOWN'].includes(batch.status)
      )
        fail('RECOVERY_NOT_ALLOWED');
      // RECONCILE only observes a proven old writer under its exclusive lock;
      // it does not authorize new execution. The current identity may record
      // that observation even after an epoch change, while the attempt keeps
      // its original authorization. CONTINUE_EXTRACTION is the separate
      // current-epoch Request that authorizes the first real extraction.
      await this.#assertCurrentBinding(client, ownerId, authEpoch);
      const at = this.#now().toISOString();
      if (attempt.status === 'PREPARED') {
        await client.query(
          `UPDATE document_delivery.batch_attempts SET status = 'RUNNING'
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
          [ownerId, projectId, batchId, attemptId],
        );
      }
      await client.query(
        `UPDATE document_delivery.batch_attempts
         SET status = 'SUCCEEDED', ended_at = $5, staged_object_receipts = $6::jsonb
         WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3 AND attempt_id = $4`,
        [ownerId, projectId, batchId, attemptId, at, JSON.stringify([receipt])],
      );
      const sourceRef: SourceRef = {
        projectId,
        batchId,
        sourceId: newUuidV7(),
        kind: 'ORIGINAL_ZIP',
        sha256: receipt.sha256,
        byteLength: receipt.byteLength,
        mediaType: 'application/zip',
      };
      const batchRow: Record<string, unknown> = (
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = 'STAGED', version = version + 1, original_zip_source = $4::jsonb,
               original_object_key = $5, observed_at = $6
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3
           RETURNING ${BATCH_COLUMNS}`,
          [ownerId, projectId, batchId, JSON.stringify(sourceRef), receipt.objectKey, at],
        )
      ).rows[0];
      await transitionEvent(client, {
        ownerId,
        projectId,
        batchId,
        attemptId,
        eventType: 'BATCH_STATE',
        toStatus: 'STAGED',
        at,
      });
      return batchRecord(batchRow);
    });
  }

  async recover(
    ownerId: string,
    authEpoch: number,
    intent: WriteIntent,
    input: RecoveryInput,
    guard: (state: BatchState) => Promise<() => Promise<void>>,
  ): Promise<WriteOutcome<{ batch: BatchView; recoveryRequestId: string }>> {
    let release: (() => Promise<void>) | undefined;
    const transaction = this.#db.transaction(ownerId, input.projectId, async (client) => {
      const existing = await this.#findRequest(client, ownerId, intent.requestId);
      if (existing !== undefined) {
        this.#assertReplay(existing, intent);
        return {
          data: existing.receipt.result as { batch: BatchView; recoveryRequestId: string },
          receipt: existing.receipt,
          replayed: true,
        };
      }
      const project = await this.#lockProject(client, ownerId, input.projectId);
      const batch = await this.#lockBatch(client, ownerId, input.projectId, input.batchId);
      if (batch.version !== input.expectedBatchVersion) fail('VERSION_CONFLICT');
      if (batch.manifestId !== undefined) fail('RECOVERY_NOT_ALLOWED');
      if (['RECEIVED', 'PARTIAL', 'REJECTED', 'ABANDONED'].includes(batch.status))
        fail('RECOVERY_NOT_ALLOWED');
      if (project.activeBatchId !== undefined && project.activeBatchId !== input.batchId)
        fail('PROJECT_BUSY');
      const attempts = await this.#allAttempts(client, ownerId, input.projectId, input.batchId);
      if (
        input.action === 'ABANDON' &&
        ['UNKNOWN', 'RECEIVING', 'EXTRACTING'].includes(batch.status)
      )
        fail('RECOVERY_NOT_ALLOWED');
      if (input.action !== 'RECONCILE') {
        release = await guard({ batch, attempts });
      }
      const at = this.#now().toISOString();
      let nextBatch: BatchRecord = batch;
      let nextAttempt: AttemptRecord | undefined = attempts.at(-1);

      if (input.action === 'RECONCILE') {
        if (!['UNKNOWN', 'RECEIVING'].includes(batch.status)) fail('RECOVERY_NOT_ALLOWED');
      } else if (input.action === 'RETRY_UPLOAD') {
        if (!['FAILED', 'AWAITING_UPLOAD'].includes(batch.status)) fail('RECOVERY_NOT_ALLOWED');
        if (batch.originalZipSource !== undefined) fail('RECOVERY_NOT_ALLOWED');
        await this.#abandonUnfinished(
          client,
          ownerId,
          input.projectId,
          input.batchId,
          'UPLOAD',
          attempts,
          at,
        );
        const generation = batch.generation + 1;
        nextBatch = {
          ...batch,
          status: 'AWAITING_UPLOAD',
          generation,
          version: batch.version + 1,
          reasonCodes: [],
          observedAt: at,
        };
        nextAttempt = {
          attemptId: input.attemptId,
          ownerId,
          projectId: input.projectId,
          batchId: input.batchId,
          kind: 'UPLOAD',
          number: this.#attemptNumber(attempts, 'UPLOAD'),
          generation,
          status: 'PREPARED',
          authorizationRequestId: intent.requestId,
          authorizedOwnerId: ownerId,
          authorizedAuthEpoch: authEpoch,
          originalInputSha256: batch.zipSha256,
          startedAt: at,
          reasonCodes: [],
          stagedObjectReceipts: [],
        };
      } else if (input.action === 'CONTINUE_EXTRACTION') {
        if (batch.originalZipSource === undefined) fail('RECOVERY_NOT_ALLOWED');
        if (!['STAGED', 'FAILED', 'UNKNOWN'].includes(batch.status)) fail('RECOVERY_NOT_ALLOWED');
        await this.#abandonUnfinished(
          client,
          ownerId,
          input.projectId,
          input.batchId,
          'EXTRACT',
          attempts,
          at,
        );
        const generation = batch.generation + 1;
        nextBatch = {
          ...batch,
          status: 'STAGED',
          generation,
          version: batch.version + 1,
          observedAt: at,
        };
        nextAttempt = {
          attemptId: input.attemptId,
          ownerId,
          projectId: input.projectId,
          batchId: input.batchId,
          kind: 'EXTRACT',
          number: this.#attemptNumber(attempts, 'EXTRACT'),
          generation,
          status: 'PREPARED',
          authorizationRequestId: intent.requestId,
          authorizedOwnerId: ownerId,
          authorizedAuthEpoch: authEpoch,
          originalInputSha256: batch.originalZipSource.sha256,
          startedAt: at,
          reasonCodes: [],
          stagedObjectReceipts: [],
        };
      } else {
        await this.#abandonUnfinished(
          client,
          ownerId,
          input.projectId,
          input.batchId,
          'UPLOAD',
          attempts,
          at,
        );
        await this.#abandonUnfinished(
          client,
          ownerId,
          input.projectId,
          input.batchId,
          'EXTRACT',
          attempts,
          at,
        );
        nextBatch = { ...batch, status: 'ABANDONED', version: batch.version + 1, observedAt: at };
        const last = attempts.at(-1);
        nextAttempt =
          last === undefined || !['PREPARED', 'RUNNING', 'UNKNOWN'].includes(last.status)
            ? last
            : {
                ...last,
                status: 'ABANDONED',
                endedAt: at,
                reasonCodes: ['RECOVERY_REQUIRED'],
              };
      }

      const data = {
        batch: batchView(nextBatch, nextAttempt),
        recoveryRequestId: intent.requestId,
      };
      const receipt = await this.#insertRequest(client, ownerId, authEpoch, intent, data, at);
      if (input.action === 'RETRY_UPLOAD' || input.action === 'CONTINUE_EXTRACTION') {
        const attempt = await this.#insertAttempt(client, {
          ownerId,
          projectId: input.projectId,
          batchId: input.batchId,
          attemptId: input.attemptId,
          kind: nextAttempt?.kind ?? 'UPLOAD',
          number: nextAttempt?.number ?? 1,
          generation: nextBatch.generation,
          authorizationRequestId: intent.requestId,
          authEpoch,
          inputSha256:
            input.action === 'RETRY_UPLOAD'
              ? batch.zipSha256
              : (batch.originalZipSource?.sha256 ?? batch.zipSha256),
          at,
        });
        nextAttempt = attempt;
      }
      if (input.action !== 'RECONCILE') {
        await client.query(
          `UPDATE document_delivery.input_batches
           SET status = $4, generation = $5, version = version + 1,
               reason_codes = '[]'::jsonb, observed_at = $6
           WHERE owner_id = $1 AND project_id = $2 AND batch_id = $3`,
          [ownerId, input.projectId, input.batchId, nextBatch.status, nextBatch.generation, at],
        );
      }
      if (input.action === 'ABANDON') {
        await this.#releaseActive(client, ownerId, input.projectId, input.batchId);
      }
      await transitionEvent(client, {
        ownerId,
        projectId: input.projectId,
        batchId: input.batchId,
        ...(nextAttempt === undefined ? {} : { attemptId: nextAttempt.attemptId }),
        eventType: 'RECOVERY_REQUESTED',
        fromStatus: batch.status,
        toStatus: nextBatch.status,
        requestId: intent.requestId,
        at,
      });
      return { data, receipt, replayed: false };
    });
    return transaction.finally(async () => {
      // Keep the old writers excluded through the transaction's commit/rollback.
      await release?.();
    });
  }
}
