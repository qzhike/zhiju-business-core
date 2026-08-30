export const qualityGovernanceModule = Object.freeze({
  name: 'quality-governance',
  status: 'IM_05_WI02_EVIDENCE_PROFILE_LIFECYCLE' as const,
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

export {
  handleCaptureEvidenceCandidate,
  handleVerifyEvidence,
  handleRevokeEvidence,
  handleCreateEvidenceLink,
  handleCreateQualityProfileDraft,
  handleActivateQualityProfile,
  handleGetEvidence,
  handleGetQualityProfile,
  canonicalDefinitionKey,
} from './business/quality-business-handlers.js';
export type {
  QualityCommandEnvelope,
  CaptureEvidenceCandidatePayload,
  VerifyEvidencePayload,
  RevokeEvidencePayload,
  CreateEvidenceLinkPayload,
  CreateQualityProfileDraftPayload,
  ActivateQualityProfilePayload,
  GetEvidencePayload,
  GetQualityProfilePayload,
} from './business/quality-business-handlers.js';

export {
  QualityBusinessError,
  QUALITY_EVIDENCE_SOURCE_INCOMPLETE,
  QUALITY_EVIDENCE_SCOPE_INVALID,
  QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED,
  QUALITY_EVIDENCE_NOT_VERIFIED,
  QUALITY_EVIDENCE_LINK_TARGET_MISMATCH,
  QUALITY_EVIDENCE_QUERY_NOT_FOUND,
  QUALITY_EVIDENCE_IDENTITY_CONFLICT,
  QUALITY_EVIDENCE_ALREADY_REVOKED,
  QUALITY_EVIDENCE_EXPECTED_VERSION_REQUIRED,
  QUALITY_PROFILE_IMMUTABLE,
  QUALITY_PROFILE_DEPENDENCY_CYCLE,
  QUALITY_PROFILE_REQUIREMENT_INCOMPLETE,
  QUALITY_PROFILE_SCOPE_INVALID,
  QUALITY_PROFILE_QUERY_NOT_FOUND,
  QUALITY_PROFILE_HUMAN_ONLY_DENIED,
  QUALITY_PROFILE_IDENTITY_CONFLICT,
  QUALITY_PROFILE_EXPECTED_VERSION_REQUIRED,
} from './business/quality-business-errors.js';

export { QualityBusinessRepository } from './persistence/quality-business-repository.js';
export type {
  BusinessWriteOutcome,
  EvidenceInsert,
  EvidenceVerificationAppend,
  EvidenceRevocationAppend,
  EvidenceLinkInsert,
  QualityProfileDraftInsert,
  QualityProfileActivation,
  ProfileDraftWriteResult,
} from './persistence/quality-business-repository.js';
export type {
  IdentityPolicyAuthorityPort,
  EnterpriseProjectAuthorityPort,
  ArtifactAuthorityPort,
  QualityAuthorityPorts,
  QualityAuthorityValidationInput,
  QualityAuthorityValidation,
} from './application/authority-ports.js';
