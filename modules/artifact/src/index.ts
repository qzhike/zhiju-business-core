export const artifactModule = Object.freeze({
  name: 'artifact',
  status: 'WI_04_CANONICAL_CONTENT_OBJECT_IMPLEMENTATION_IN_PROGRESS' as const,
});

export {
  createArtifactDatabase,
  withArtifactTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/artifact-db.js';
export type {
  ArtifactDb,
  ArtifactTransaction,
  ArtifactTransactionContext,
  ArtifactPrincipalKind,
  CommandReceiptTable,
  OutboxEventTable,
  InboxMessageTable,
  ProcessInstanceTable,
  ProcessStepTable,
  AuditRecordTable,
  ReferenceEdgeTable,
  ContractViolationTable,
} from './persistence/artifact-db.js';

export type {
  ArtifactBusinessScope,
  ArtifactLifecycle,
  ArtifactBranchLifecycle,
  ArtifactTable,
  ArtifactBranchTable,
  ArtifactContentType,
  ArtifactContentStorageState,
  ArtifactContentFinalizationState,
  ArtifactContentOrphanOutcome,
  ArtifactContentObjectTable,
  ArtifactContentObjectLinkTable,
  ArtifactContentObjectQuarantineTable,
  ArtifactContentObjectOrphanTable,
} from './persistence/artifact-business-types.js';

export { ArtifactRepository } from './persistence/artifact-repository.js';
export type {
  ProcessInstanceInsert,
  ArtifactInsert,
  ArtifactMetadataCas,
  ArtifactArchiveCas,
  ArtifactCasOutcome,
  ContentObjectInsert,
  ContentObjectLinkInput,
  ContentObjectLinkOutcome,
  ContentObjectFinalizationInput,
  ContentObjectFinalizationOutcome,
  ContentObjectQuarantineInput,
  ContentObjectStateOutcome,
  ContentObjectOrphanInsert,
  ContentObjectOrphanClaim,
  ContentObjectOrphanCompletion,
  ContentAuditInsert,
} from './persistence/artifact-repository.js';

export { InMemoryObjectStorage } from './storage/in-memory-object-storage.js';
export type {
  ObjectStoragePort,
  ObjectStorageReadback,
  ObjectStorageReference,
} from './storage/object-storage.js';

export {
  ArtifactPersistenceError,
  ARTIFACT_PAYLOAD_HASH_MISMATCH,
  ARTIFACT_PROMOTED_MIRROR_MISMATCH,
  ARTIFACT_CONTEXT_PRINCIPAL_MISMATCH,
  ARTIFACT_CONTEXT_SCOPE_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
} from './persistence/write-guards.js';

export {
  executeArtifactCommand,
  assertEnvelopeMatchesContext,
  CommandExecutionError,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  CONCURRENCY_CONFLICT,
  COMMAND_IN_PROGRESS,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_CONTEXT_EXPIRED,
  COMMAND_CONTEXT_REJECTED,
  COMMAND_TARGET_MISMATCH,
  PAYLOAD_HASH_MISMATCH,
} from './persistence/command-runner.js';
export type {
  CommandEnvelope,
  CommandBodyResult,
  CommandExecution,
  CommandResult,
  CommandAuditInput,
  OutboxEventInput,
  ReferenceEdgeInput,
} from './persistence/command-runner.js';

export {
  handleCreateArtifact,
  handleUpdateArtifactMetadata,
  handleArchiveArtifact,
  handleGetArtifact,
  applyArtifactMetadataPatch,
} from './business/artifact-handlers.js';

export {
  stageCanonicalContent,
  linkCanonicalContent,
  finalizeCanonicalContent,
  freezeCanonicalContent,
  quarantineCanonicalContent,
  cleanupCanonicalContentOrphans,
} from './business/content-object-service.js';
export type {
  CanonicalContentCommandEnvelope,
  StageCanonicalContentPayload,
  LinkCanonicalContentPayload,
  ContentObjectView,
  LinkCanonicalContentResult,
  OrphanCleanupReport,
} from './business/content-object-service.js';
export type {
  CreateArtifactPayload,
  UpdateArtifactMetadataPayload,
  ArchiveArtifactPayload,
  GetArtifactPayload,
  ArtifactCommandEnvelope,
} from './business/artifact-handlers.js';

export {
  ArtifactBusinessError,
  ARTIFACT_SCOPE_INVALID,
  ARTIFACT_NOT_ACTIVE,
  ARTIFACT_METADATA_FIELD_FORBIDDEN,
  ARTIFACT_IDENTITY_CONFLICT,
  ARTIFACT_EXPECTED_VERSION_REQUIRED,
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_QUERY_NOT_FOUND,
  ARTIFACT_QUERY_SCOPE_MISMATCH,
  ARTIFACT_CONTENT_SCHEMA_INVALID,
  ARTIFACT_CONTENT_HASH_MISMATCH,
  ARTIFACT_CONTENT_READBACK_MISMATCH,
  ARTIFACT_CONTENT_TARGET_INVALID,
  ARTIFACT_CONTENT_OWNER_INVALID,
  ARTIFACT_CONTENT_NOT_FINALIZED,
  ARTIFACT_CONTENT_STATE_INVALID,
  ARTIFACT_CONTENT_ALREADY_FROZEN,
  ARTIFACT_CONTENT_ORPHAN_RECORD_FAILED,
  ARTIFACT_CONTENT_FINALIZATION_UNKNOWN,
} from './business/artifact-business-errors.js';
