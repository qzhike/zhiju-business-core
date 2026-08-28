export const artifactModule = Object.freeze({
  name: 'artifact',
  status: 'WI_02_PERSISTENCE_FOUNDATION' as const,
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

export { ArtifactRepository } from './persistence/artifact-repository.js';
export type { ProcessInstanceInsert } from './persistence/artifact-repository.js';

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
