export const artifactModule = Object.freeze({
  name: 'artifact',
  status: 'WI_05_IMMUTABLE_REVISION_IMPLEMENTATION_COMPLETE' as const,
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
  ArtifactRevisionKind,
  ArtifactRevisionDisposition,
  ArtifactRevisionTable,
  RevisionParentTable,
  RevisionConflictKind,
  RevisionConflictTable,
  RevisionWithdrawalTable,
  RevisionInvalidationTable,
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
  ArtifactRevisionInsert,
  ArtifactRevisionCreateOutcome,
  ArtifactHeadMove,
  ArtifactHeadMoveOutcome,
  RevisionGovernanceFact,
  RevisionGovernanceOutcome,
  RevisionGovernanceState,
  RevisionGraph,
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
  handleCreateAndSealRevision,
  handleCreateMergeRevision,
  handleMoveWorkingHead,
  handleWithdrawRevision,
  handleInvalidateRevision,
  handleGetRevisionSnapshot,
  handleGetRevisionLineage,
  handleGetRevisionDiffInputs,
  handleValidateRevisionRef,
  validateArtifactRevisionContent,
  validateArtifactMergeDefinition,
} from './business/revision-service.js';
export type {
  RevisionCommandEnvelope,
  CreateAndSealRevisionPayload,
  CreateMergeRevisionPayload,
  MoveWorkingHeadPayload,
  WithdrawRevisionPayload,
  InvalidateRevisionPayload,
  GetRevisionSnapshotPayload,
  GetRevisionLineagePayload,
  GetRevisionDiffInputsPayload,
  ValidateRevisionRefPayload,
} from './business/revision-service.js';

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
  ARTIFACT_REVISION_IMMUTABLE,
  ARTIFACT_STRUCTURE_SCHEMA_INVALID,
  ARTIFACT_PARENT_REQUIRED,
  ARTIFACT_CROSS_ARTIFACT_PARENT,
  ARTIFACT_LINEAGE_CYCLE,
  ARTIFACT_MERGE_CONFLICT_UNRESOLVED,
  ARTIFACT_BRANCH_HEAD_CONFLICT,
} from './business/artifact-business-errors.js';
