/**
 * MVP01 DocumentDelivery wire and persisted facts.
 *
 * The owning authority is `.vibe/module-specs/Module-Spec-MVP01-DocumentDelivery.md`;
 * the B1 design owns the isolation choices. Every shape here is a closed
 * object: optional fields are omitted, never `null`, and no client field can
 * carry an owner, actor, authorization or object-store locator.
 */

export const PROJECT_ANALYSIS_UNAVAILABLE = Object.freeze({
  status: 'UNAVAILABLE',
  reasonCode: 'ANALYSIS_NOT_CONNECTED',
});

export const CAPABILITIES = Object.freeze(['PROJECT_CUSTODY'] as const);

export const BATCH_STATUSES = [
  'AWAITING_UPLOAD',
  'RECEIVING',
  'STAGED',
  'EXTRACTING',
  'RECEIVED',
  'PARTIAL',
  'FAILED',
  'REJECTED',
  'ABANDONED',
  'UNKNOWN',
] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const ATTEMPT_KINDS = ['UPLOAD', 'EXTRACT'] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];

export const ATTEMPT_STATUSES = [
  'PREPARED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
  'ABANDONED',
] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const ENTRY_STATUSES = ['ACCEPTED', 'UNSUPPORTED', 'CORRUPT', 'READ_LIMITED'] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const RECOVERY_ACTIONS = [
  'RECONCILE',
  'RETRY_UPLOAD',
  'CONTINUE_EXTRACTION',
  'ABANDON',
] as const;
export type RecoveryAction = (typeof RECOVERY_ACTIONS)[number];

export const SOURCE_KINDS = ['ORIGINAL_ZIP', 'ACCEPTED_ENTRY'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const REASON_CODES = [
  'ANALYSIS_NOT_CONNECTED',
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_UTF8',
  'INVALID_DOCX',
  'INVALID_XLSX',
  'ACTIVE_CONTENT_NOT_SUPPORTED',
  'EXTERNAL_REFERENCE_REQUIRES_REVIEW',
  'ZIP_UNSAFE',
  'ZIP_CORRUPT',
  'ZIP_LIMIT_EXCEEDED',
  'EXTRACTION_FAILED',
  'UPLOAD_INCOMPLETE',
  'STORAGE_INTEGRITY_ERROR',
  'AUTHORIZATION_CHANGED',
  'RECOVERY_REQUIRED',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** Immutable complete reference to one stored source object. */
export interface SourceRef {
  readonly projectId: string;
  readonly batchId: string;
  readonly sourceId: string;
  readonly kind: SourceKind;
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
}

/** Internal store receipt; never returned to a client. */
export interface ObjectReceipt {
  readonly objectKey: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly mediaType: string;
}

export interface ManifestEntry {
  readonly entryId: string;
  readonly ordinal: number;
  readonly originalName: string;
  readonly normalizedPath: string;
  readonly status: EntryStatus;
  readonly reasonCodes: readonly ReasonCode[];
  readonly mediaType?: string;
  readonly byteLength?: number;
  readonly sha256?: string;
  readonly sourceRef?: SourceRef;
}

export interface InputManifest {
  readonly manifestId: string;
  readonly schemaVersion: 'mvp.input_manifest@1';
  readonly ownerId: string;
  readonly projectId: string;
  readonly batchId: string;
  readonly batchNo: number;
  readonly originalZip: SourceRef;
  readonly note?: string;
  readonly entries: readonly ManifestEntry[];
  readonly policyVersion: string;
  readonly extractorVersion: string;
  readonly createdAt: string;
  readonly manifestHash: string;
}

export interface OperatorBinding {
  readonly ownerId: string;
  readonly displayName: string;
  readonly authEpoch: number;
  readonly enabled: boolean;
}

export interface InstallationRecord {
  readonly instanceId: string;
  readonly schemaVersion: string;
  readonly storeId: string;
  readonly storeIdentity: string;
}

export interface ProjectRecord {
  readonly projectId: string;
  readonly ownerId: string;
  readonly customerName: string;
  readonly title: string;
  readonly createdAt: string;
  readonly version: number;
  readonly lastBatchNo: number;
  readonly activeBatchId?: string;
}

export interface BatchRecord {
  readonly batchId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly batchNo: number;
  readonly kind: 'INITIAL' | 'SUPPLEMENT';
  readonly originalName: string;
  readonly declaredBytes: number;
  readonly zipSha256: string;
  readonly note?: string;
  readonly policyVersion: string;
  readonly status: BatchStatus;
  readonly generation: number;
  readonly version: number;
  readonly originalRequestId: string;
  readonly createdAt: string;
  readonly manifestId?: string;
  readonly reasonCodes: readonly ReasonCode[];
  readonly originalZipSource?: SourceRef;
  readonly observedAt: string;
}

export interface AttemptRecord {
  readonly attemptId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly batchId: string;
  readonly kind: AttemptKind;
  readonly number: number;
  readonly generation: number;
  readonly status: AttemptStatus;
  readonly authorizationRequestId: string;
  readonly authorizedOwnerId: string;
  readonly authorizedAuthEpoch: number;
  readonly originalInputSha256: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly reasonCodes: readonly ReasonCode[];
  readonly stagedObjectReceipts: readonly ObjectReceipt[];
}

export interface RequestAuthorization {
  readonly ownerId: string;
  readonly authEpoch: number;
  readonly authorizedAt: string;
}

export interface Receipt {
  readonly requestId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly targetId: string;
  readonly payloadHash: string;
  readonly committedAt: string;
  readonly result: unknown;
}

export interface RequestRecord {
  readonly requestId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly targetId: string;
  readonly originalPayload: Readonly<Record<string, unknown>>;
  readonly payloadHash: string;
  readonly authorization: RequestAuthorization;
  readonly receipt: Receipt;
  readonly createdAt: string;
}

export interface CustodyEventRecord {
  readonly eventId: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly eventType: string;
  readonly createdAt: string;
  readonly batchId?: string;
  readonly attemptId?: string;
  readonly fromStatus?: string;
  readonly toStatus?: string;
  readonly reasonCodes: readonly ReasonCode[];
  readonly requestId?: string;
}

export interface SessionView {
  readonly ownerId: string;
  readonly displayName: string;
  readonly authEpoch: number;
  readonly capabilities: readonly ['PROJECT_CUSTODY'];
  readonly instanceId: string;
}

export interface ProjectSummary {
  readonly projectId: string;
  readonly customerName: string;
  readonly title: string;
  readonly createdAt: string;
  readonly version: number;
}

export interface ProjectView extends ProjectSummary {
  readonly lastBatchNo: number;
  readonly activeBatchId?: string;
  readonly analysis: typeof PROJECT_ANALYSIS_UNAVAILABLE;
}

export interface BatchSummary {
  readonly batchId: string;
  readonly projectId: string;
  readonly batchNo: number;
  readonly kind: 'INITIAL' | 'SUPPLEMENT';
  readonly originalName: string;
  readonly declaredBytes: number;
  readonly zipSha256: string;
  readonly status: BatchStatus;
  readonly version: number;
  readonly createdAt: string;
  readonly manifestId?: string;
  readonly reasonCodes: readonly ReasonCode[];
}

export interface AttemptSummary {
  readonly attemptId: string;
  readonly kind: AttemptKind;
  readonly number: number;
  readonly generation: number;
  readonly status: AttemptStatus;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly reasonCodes: readonly ReasonCode[];
}

export interface BatchView extends BatchSummary {
  readonly originalRequestId: string;
  readonly note?: string;
  readonly policyVersion: string;
  readonly currentAttempt?: AttemptSummary;
  readonly observedAt: string;
}

export interface ManifestSummary {
  readonly manifestId: string;
  readonly manifestHash: string;
  readonly batchId: string;
  readonly originalZip: SourceRef;
  readonly totalEntries: number;
  readonly acceptedEntries: number;
  readonly limitedEntries: number;
  readonly createdAt: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
}

export interface BatchDetail {
  readonly batch: BatchView;
  readonly attempts: readonly AttemptSummary[];
  readonly nextAttemptCursor?: string;
  readonly manifest?: ManifestSummary;
  readonly permittedActions: readonly RecoveryAction[];
}

export interface EntryPage {
  readonly manifest: ManifestSummary;
  readonly entries: readonly ManifestEntry[];
  readonly nextCursor?: string;
}

export interface RequestView {
  readonly requestId: string;
  readonly projectId: string;
  readonly operation: string;
  readonly targetId: string;
  readonly payloadHash: string;
  readonly receipt: Receipt;
}

export interface StoredSource {
  readonly sourceRef: SourceRef;
  readonly objectKey: string;
  readonly fileName: string;
}
