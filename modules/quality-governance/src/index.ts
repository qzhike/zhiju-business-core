export const qualityGovernanceModule = Object.freeze({
  name: 'quality-governance',
  status: 'IM_05_WI01_APPLICATION_PERSISTENCE_FOUNDATION' as const,
});

export {
  createQualityGovernanceDatabase,
  withQualityGovernanceTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/quality-db.js';
export type {
  QualityGovernanceDb,
  QualityTransaction,
  QualityTransactionContext,
  QualityPrincipalKind,
} from './persistence/quality-db.js';

export { QualityGovernanceRepository } from './persistence/quality-repository.js';
export type { ProcessInstanceInsert, ProcessStepInsert } from './persistence/quality-repository.js';

export {
  executeQualityGovernanceCommand,
  assertEnvelopeMatchesContext,
  CommandExecutionError,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  INBOX_PAYLOAD_CONFLICT,
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
  InboxMessageInput,
  ProcessStepInput,
  OutboxEventInput,
  ReferenceEdgeInput,
} from './persistence/command-runner.js';

export {
  QualityPersistenceError,
  QUALITY_PAYLOAD_HASH_MISMATCH,
  QUALITY_PROMOTED_MIRROR_MISMATCH,
  QUALITY_CONTEXT_PRINCIPAL_MISMATCH,
  QUALITY_CONTEXT_SCOPE_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
} from './persistence/write-guards.js';

export {
  validateQualityAuthorities,
  QualityAuthorityError,
  QUALITY_REFERENCE_VALIDATION_FAILED,
} from './application/authority-ports.js';
export type {
  IdentityPolicyAuthorityPort,
  EnterpriseProjectAuthorityPort,
  ArtifactAuthorityPort,
  QualityAuthorityPorts,
  QualityAuthorityValidationInput,
  QualityAuthorityValidation,
} from './application/authority-ports.js';
