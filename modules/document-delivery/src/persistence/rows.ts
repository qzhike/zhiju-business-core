import { fail } from '../domain/errors.js';
import { manifestHash, manifestSummary } from '../domain/manifest.js';
import { PROJECT_ANALYSIS_UNAVAILABLE } from '../domain/types.js';
import type {
  AttemptRecord,
  AttemptSummary,
  BatchRecord,
  BatchSummary,
  BatchView,
  InputManifest,
  ManifestEntry,
  ManifestSummary,
  ObjectReceipt,
  ProjectRecord,
  ProjectSummary,
  ProjectView,
  Receipt,
  RequestRecord,
  SourceRef,
} from '../domain/types.js';
import {
  hexColumn,
  jsonColumn,
  nullableStringColumn,
  numberColumn,
  reasonCodesColumn,
  stringColumn,
  timestampColumn,
} from './db.js';

type Row = Record<string, unknown>;

export function sourceRefFromJson(value: unknown): SourceRef | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) fail('DEPENDENCY_UNAVAILABLE');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (
    keys !== 'batchId,byteLength,kind,mediaType,projectId,sha256,sourceId' ||
    typeof record.projectId !== 'string' ||
    typeof record.batchId !== 'string' ||
    typeof record.sourceId !== 'string' ||
    (record.kind !== 'ORIGINAL_ZIP' && record.kind !== 'ACCEPTED_ENTRY') ||
    typeof record.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(record.sha256) ||
    typeof record.byteLength !== 'number' ||
    typeof record.mediaType !== 'string'
  )
    fail('DEPENDENCY_UNAVAILABLE');
  return {
    projectId: record.projectId,
    batchId: record.batchId,
    sourceId: record.sourceId,
    kind: record.kind,
    sha256: record.sha256,
    byteLength: record.byteLength,
    mediaType: record.mediaType,
  };
}

function parseReceipts(value: unknown): readonly ObjectReceipt[] {
  if (!Array.isArray(value)) fail('DEPENDENCY_UNAVAILABLE');
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) fail('DEPENDENCY_UNAVAILABLE');
    const record = item as Record<string, unknown>;
    if (
      typeof record.objectKey !== 'string' ||
      typeof record.sha256 !== 'string' ||
      typeof record.byteLength !== 'number' ||
      typeof record.mediaType !== 'string'
    )
      fail('DEPENDENCY_UNAVAILABLE');
    return {
      objectKey: record.objectKey,
      sha256: record.sha256,
      byteLength: record.byteLength,
      mediaType: record.mediaType,
    };
  });
}

export function projectRecord(row: Row): ProjectRecord {
  const activeBatchId = nullableStringColumn(row, 'active_batch_id');
  return {
    projectId: stringColumn(row, 'project_id'),
    ownerId: stringColumn(row, 'owner_id'),
    customerName: stringColumn(row, 'customer_name'),
    title: stringColumn(row, 'title'),
    createdAt: timestampColumn(row, 'created_at'),
    version: numberColumn(row, 'version'),
    lastBatchNo: numberColumn(row, 'last_batch_no'),
    ...(activeBatchId === undefined ? {} : { activeBatchId }),
  };
}

export function projectSummary(project: ProjectRecord): ProjectSummary {
  return {
    projectId: project.projectId,
    customerName: project.customerName,
    title: project.title,
    createdAt: project.createdAt,
    version: project.version,
  };
}

export function projectView(project: ProjectRecord): ProjectView {
  return {
    ...projectSummary(project),
    lastBatchNo: project.lastBatchNo,
    ...(project.activeBatchId === undefined ? {} : { activeBatchId: project.activeBatchId }),
    analysis: PROJECT_ANALYSIS_UNAVAILABLE,
  };
}

export function batchRecord(row: Row): BatchRecord {
  const note = nullableStringColumn(row, 'note');
  const manifestId = nullableStringColumn(row, 'manifest_id');
  const originalZipSource = sourceRefFromJson(row.original_zip_source);
  return {
    batchId: stringColumn(row, 'batch_id'),
    ownerId: stringColumn(row, 'owner_id'),
    projectId: stringColumn(row, 'project_id'),
    batchNo: numberColumn(row, 'batch_no'),
    kind: stringColumn(row, 'kind') === 'INITIAL' ? 'INITIAL' : 'SUPPLEMENT',
    originalName: stringColumn(row, 'original_name'),
    declaredBytes: numberColumn(row, 'declared_bytes'),
    zipSha256: hexColumn(row, 'zip_sha256'),
    policyVersion: stringColumn(row, 'policy_version'),
    status: stringColumn(row, 'status') as BatchRecord['status'],
    generation: numberColumn(row, 'generation'),
    version: numberColumn(row, 'version'),
    originalRequestId: stringColumn(row, 'original_request_id'),
    createdAt: timestampColumn(row, 'created_at'),
    reasonCodes: reasonCodesColumn(row, 'reason_codes') as BatchRecord['reasonCodes'],
    observedAt: timestampColumn(row, 'observed_at'),
    ...(note === undefined ? {} : { note }),
    ...(manifestId === undefined ? {} : { manifestId }),
    ...(originalZipSource === undefined ? {} : { originalZipSource }),
  };
}

export function batchSummary(batch: BatchRecord): BatchSummary {
  return {
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
  };
}

export function attemptRecord(row: Row): AttemptRecord {
  const ended =
    row.ended_at === null || row.ended_at === undefined
      ? undefined
      : timestampColumn(row, 'ended_at');
  return {
    attemptId: stringColumn(row, 'attempt_id'),
    ownerId: stringColumn(row, 'owner_id'),
    projectId: stringColumn(row, 'project_id'),
    batchId: stringColumn(row, 'batch_id'),
    kind: stringColumn(row, 'kind') === 'UPLOAD' ? 'UPLOAD' : 'EXTRACT',
    number: numberColumn(row, 'number'),
    generation: numberColumn(row, 'generation'),
    status: stringColumn(row, 'status') as AttemptRecord['status'],
    authorizationRequestId: stringColumn(row, 'authorization_request_id'),
    authorizedOwnerId: stringColumn(row, 'authorized_owner_id'),
    authorizedAuthEpoch: numberColumn(row, 'authorized_auth_epoch'),
    originalInputSha256: hexColumn(row, 'original_input_sha256'),
    startedAt: timestampColumn(row, 'started_at'),
    reasonCodes: reasonCodesColumn(row, 'reason_codes') as AttemptRecord['reasonCodes'],
    stagedObjectReceipts: parseReceipts(row.staged_object_receipts),
    ...(ended === undefined ? {} : { endedAt: ended }),
  };
}

export function attemptSummary(attempt: AttemptRecord): AttemptSummary {
  return {
    attemptId: attempt.attemptId,
    kind: attempt.kind,
    number: attempt.number,
    generation: attempt.generation,
    status: attempt.status,
    startedAt: attempt.startedAt,
    reasonCodes: attempt.reasonCodes,
    ...(attempt.endedAt === undefined ? {} : { endedAt: attempt.endedAt }),
  };
}

export function batchView(batch: BatchRecord, currentAttempt?: AttemptRecord): BatchView {
  return {
    ...batchSummary(batch),
    originalRequestId: batch.originalRequestId,
    policyVersion: batch.policyVersion,
    observedAt: batch.observedAt,
    ...(batch.note === undefined ? {} : { note: batch.note }),
    ...(currentAttempt === undefined ? {} : { currentAttempt: attemptSummary(currentAttempt) }),
  };
}

export function requestRecord(row: Row): RequestRecord {
  return {
    requestId: stringColumn(row, 'request_id'),
    ownerId: stringColumn(row, 'owner_id'),
    projectId: stringColumn(row, 'project_id'),
    operation: stringColumn(row, 'operation'),
    targetId: stringColumn(row, 'target_id'),
    originalPayload: jsonColumn<Record<string, unknown>>(row, 'original_payload'),
    payloadHash: hexColumn(row, 'payload_hash'),
    authorization: jsonColumn<RequestRecord['authorization']>(row, 'authorization_fact'),
    receipt: jsonColumn<Receipt>(row, 'receipt'),
    createdAt: timestampColumn(row, 'committed_at'),
  };
}

export function manifestRecord(row: Row): InputManifest {
  const payload = jsonColumn<Record<string, unknown>>(row, 'payload');
  const manifest = payload as unknown as InputManifest;
  const storedHash = hexColumn(row, 'manifest_hash');
  if (manifestHash(manifest) !== storedHash) fail('DEPENDENCY_UNAVAILABLE');
  if (manifestSummary(manifest).manifestId !== stringColumn(row, 'manifest_id'))
    fail('DEPENDENCY_UNAVAILABLE');
  if (manifest.entries.length !== numberColumn(row, 'total_entries'))
    fail('DEPENDENCY_UNAVAILABLE');
  return manifest;
}

export function manifestSummaryFromRow(row: Row): ManifestSummary {
  return manifestSummary(manifestRecord(row));
}

export function entryRecord(row: Row): ManifestEntry {
  const mediaType = nullableStringColumn(row, 'media_type');
  const byteLengthValue = row.byte_length;
  const sha256 =
    row.sha256 === null || row.sha256 === undefined ? undefined : hexColumn(row, 'sha256');
  const sourceId = nullableStringColumn(row, 'source_id');
  const sourceRef =
    sourceId === undefined
      ? undefined
      : {
          projectId: stringColumn(row, 'project_id'),
          batchId: stringColumn(row, 'batch_id'),
          sourceId,
          kind: 'ACCEPTED_ENTRY' as const,
          sha256: hexColumn(row, 'source_sha256'),
          byteLength: numberColumn(row, 'source_byte_length'),
          mediaType: stringColumn(row, 'source_media_type'),
        };
  return {
    entryId: stringColumn(row, 'entry_id'),
    ordinal: numberColumn(row, 'ordinal'),
    originalName: stringColumn(row, 'original_name'),
    normalizedPath: stringColumn(row, 'normalized_path'),
    status: stringColumn(row, 'status') as ManifestEntry['status'],
    reasonCodes: reasonCodesColumn(row, 'reason_codes') as ManifestEntry['reasonCodes'],
    ...(mediaType === undefined ? {} : { mediaType }),
    ...(byteLengthValue === null || byteLengthValue === undefined
      ? {}
      : { byteLength: numberColumn(row, 'byte_length') }),
    ...(sha256 === undefined ? {} : { sha256 }),
    ...(sourceRef === undefined ? {} : { sourceRef }),
  };
}
