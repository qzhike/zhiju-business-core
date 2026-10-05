export const identityPolicyModule = Object.freeze({
  name: 'identity-policy',
  status: 'PERSISTENCE_FOUNDATION' as const,
});

export {
  issueExecutionCapabilityBundle,
  readExecutionCapabilityBundle,
  readIntegrityForExpiry,
} from './commands/execution-capability-bundle.js';
export {
  createControlledFirstRunAuthorizationPort,
  CONTROLLED_FIRST_RUN_BINDINGS,
} from './commands/work-order-validation-authorization.js';
export {
  createUsageProvenanceAuthorizationPort,
  USAGE_PROVENANCE_BINDINGS,
} from './commands/work-order-validation-authorization.js';
export type {
  ControlledFirstRunAuthorizationConfig,
  ControlledFirstRunAuthorizationInput,
  ControlledFirstRunRevalidationInput,
  ControlledFirstRunCapabilityCodes,
} from './commands/work-order-validation-authorization.js';
export type {
  UsageProvenanceAuthorizationConfig,
  UsageProvenanceBinding,
  UsageProvenanceCapabilityCodes,
  UsageProvenanceCapabilityKey,
} from './commands/work-order-validation-authorization.js';
export {
  createTaskBoardAuthorizationPort,
  TASK_BOARD_BINDINGS,
  TASK_BOARD_PURPOSES,
} from './commands/work-order-validation-authorization.js';
export { taskBoardAuthorizationSourceHash } from './commands/task-board-source-hash.js';
export type {
  SelectedAuthorizationGrant,
  TaskBoardAuthorizationSource,
  TaskBoardAuthorizationSourceEntry,
} from './commands/task-board-source-hash.js';
export type {
  TaskBoardAuthorizationConfig,
  TaskBoardBinding,
  TaskBoardCapabilityCodes,
  TaskBoardCapabilityKey,
} from './commands/work-order-validation-authorization.js';
export type { ExecutionCapabilityBundlePorts } from './commands/execution-capability-bundle.js';

// IM-02 WI-05 (issue #33): low-level persistence boundary. Business command
// handlers (WI-07+) are layered on top; nothing here interprets domain
// authorization semantics.
export type {
  LookupHashPort,
  KeyedLookupHash,
  FieldEncryptionPort,
  EncryptedField,
  IdentityCryptoPorts,
} from './persistence/ports.js';
export {
  createIdentityPolicyDatabase,
  withIdentityTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/identity-db.js';
export type {
  IdentityPolicyDb,
  IdentityTransaction,
  IdentityTransactionContext,
} from './persistence/identity-db.js';
export {
  IdentityPolicyRepository,
  IdentityPersistenceError,
  IDENTITY_EXTERNAL_LINK_CONFLICT,
  IDENTITY_SENSITIVE_EXTERNAL_IDENTIFIER_FORBIDDEN,
  IDENTITY_PAYLOAD_HASH_MISMATCH,
  IDENTITY_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
  authorizationDecisionIntegrityHolds,
  policySnapshotIntegrityHolds,
} from './persistence/identity-policy-repository.js';
export type { SelectedAuthorizationDecision } from './persistence/identity-db.js';
export type {
  PrincipalInsert,
  PrincipalStateTransitionInsert,
  ExternalIdentityInput,
  ExternalIdentityLinkView,
  ScopedAssignmentInsert,
  RevocationInsert,
  PolicySnapshotInsert,
  PolicyVersionInsert,
  ActorSnapshotInsert,
  AuthorizationDecisionInsert,
} from './persistence/identity-policy-repository.js';
export {
  executeIdentityCommand,
  CommandExecutionError,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  CONCURRENCY_CONFLICT,
  COMMAND_IN_PROGRESS,
  COMMAND_CONTEXT_MISMATCH,
  COMMAND_TARGET_MISMATCH,
  PAYLOAD_HASH_MISMATCH,
} from './persistence/command-runner.js';
export type {
  CommandEnvelope,
  CommandBodyResult,
  CommandExecution,
  CommandResult,
  CommittedCommandResult,
  RejectedCommandResult,
  CommandAuditInput,
  OutboxEventInput,
} from './persistence/command-runner.js';
export {
  createBootstrapClaim,
  registerPrincipal,
  IDENTITY_BOOTSTRAP_REQUIRED,
  IDENTITY_BOOTSTRAP_CLAIM_INVALID,
  IDENTITY_BOOTSTRAP_CLAIM_CONSUMED,
  IDENTITY_BOOTSTRAP_CLAIM_EXPIRED,
  IDENTITY_BOOTSTRAP_CLAIM_CLOSED,
  IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS,
  IDENTITY_PRINCIPAL_INVALID_KIND,
} from './commands/register-principal.js';
export type {
  RegisterPrincipalInput,
  RegisterPrincipalDeps,
  PrincipalKind,
} from './commands/register-principal.js';
export {
  linkExternalIdentity,
  resolvePrincipal,
  IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED,
  IDENTITY_PRINCIPAL_NOT_FOUND,
} from './commands/link-external-identity.js';
export type {
  LinkExternalIdentityInput,
  IdentityCommandDeps,
  ResolvePrincipalInput,
  PrincipalResolutionView,
} from './commands/link-external-identity.js';
export { principalRegisteredPayload, externalIdentityLinkedPayload } from './commands/events.js';
export {
  assignRole,
  revokeRole,
  grantCapability,
  revokeCapability,
  recordPolicySnapshot,
  bootstrapMinimalAdminRole,
  IDENTITY_ROLE_SCOPE_INVALID,
  IDENTITY_ROLE_ALREADY_ACTIVE,
  IDENTITY_ROLE_NOT_ACTIVE,
  IDENTITY_CAPABILITY_HUMAN_ONLY,
  IDENTITY_CAPABILITY_SCOPE_INVALID,
  IDENTITY_CAPABILITY_ALREADY_ACTIVE,
  IDENTITY_CAPABILITY_NOT_ACTIVE,
  IDENTITY_POLICY_SNAPSHOT_INVALID,
  IDENTITY_POLICY_VERSION_UNKNOWN,
  IDENTITY_BOOTSTRAP_ROLE_INVALID,
} from './commands/role-capability-handlers.js';
export {
  recordPolicyVersion,
  resolvePolicy,
  IDENTITY_POLICY_VERSION_ALREADY_BOUND,
  IDENTITY_POLICY_SUPERSEDE_INVALID,
  IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  API_PAYLOAD_LIMIT_EXCEEDED,
  API_VALUE_INVALID,
  API_CONTRACT_TYPE_UNKNOWN,
  API_PAYLOAD_HASH_MISMATCH,
  SCOPE_MISMATCH,
  INTERNAL_CONTRACT_VIOLATION,
  RECORD_POLICY_VERSION_COMMAND,
  RESOLVE_POLICY_COMMAND,
  RECORD_POLICY_VERSION_PURPOSE,
  RESOLVE_POLICY_PURPOSE,
  POLICY_OBJECT_TYPE,
  POLICY_VERSION_OBJECT_TYPE,
} from './commands/policy-version.js';
export type {
  RecordPolicyVersionInput,
  ResolvePolicyInput,
  PolicyVersionResolutionView,
} from './commands/policy-version.js';
export type {
  AssignRoleInput,
  RevokeScopedInput,
  GrantCapabilityInput,
  RecordPolicySnapshotInput,
  BootstrapRoleInput,
} from './commands/role-capability-handlers.js';
export {
  HUMAN_ONLY_CAPABILITIES,
  HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
  isHumanOnlyCapability,
  POLICY_SCHEMA_REGISTRY,
  POLICY_SCHEMA_REGISTRY_VERSION,
  POLICY_SCHEMA_REGISTRY_VERSIONS,
  isResolvablePolicySchemaRef,
  policySchemaReference,
  registeredPolicySchemaKey,
} from './commands/static-registry.js';
export { resolveTaskExecutionCreationPurpose } from './commands/task-execution-creation-purpose.js';
export type {
  TaskExecutionCreationPurpose,
  TaskExecutionCreationPurposeResolution,
} from './commands/task-execution-creation-purpose.js';
export {
  createTaskExecutionCreationAuthorizationPort,
  TASK_EXECUTION_CREATION_BINDINGS,
  IDENTITY_CREATION_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CREATION_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CREATION_TARGET_INVALID,
} from './commands/task-execution-creation-authorization.js';
export type {
  TaskExecutionCreationAuthorizationConfig,
  TaskExecutionCreationAuthorizationInput,
  TaskExecutionCreationAuthorizationPort,
  TaskExecutionCreationAuthorizationView,
  TaskExecutionCreationBinding,
  TaskExecutionCreationCapabilityCodes,
  TaskExecutionCreationCapabilityKey,
  TaskExecutionCreationDenialReason,
  TaskExecutionCreationRevalidationFailure,
  TaskExecutionCreationRevalidationInput,
  TaskExecutionCreationRevalidationResult,
} from './commands/task-execution-creation-authorization.js';
export {
  createTaskExecutionReadinessAuthorizationPort,
  TASK_EXECUTION_READINESS_BINDINGS,
  TASK_READINESS_BUILD_PURPOSE,
  TASK_READY_PURPOSE,
  IDENTITY_READINESS_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_READINESS_CAPABILITY_CONFIG_INVALID,
  IDENTITY_READINESS_TARGET_INVALID,
} from './commands/task-execution-readiness-authorization.js';
export type {
  TaskExecutionReadinessAuthorizationConfig,
  TaskExecutionReadinessAuthorizationInput,
  TaskExecutionReadinessAuthorizationPort,
  TaskExecutionReadinessAuthorizationView,
  TaskExecutionReadinessBinding,
  TaskExecutionReadinessCapabilityCodes,
  TaskExecutionReadinessCapabilityKey,
  TaskExecutionReadinessDenialReason,
  TaskExecutionReadinessRevalidationFailure,
  TaskExecutionReadinessRevalidationInput,
  TaskExecutionReadinessRevalidationResult,
  TaskExecutionReadinessSelectorType,
} from './commands/task-execution-readiness-authorization.js';
export {
  createWorkOrderDraftReadAuthorizationPort,
  WORK_ORDER_DRAFT_READ_BINDINGS,
  WORK_ORDER_DRAFT_READ_PURPOSE,
  IDENTITY_WORK_ORDER_DRAFT_READ_UNSUPPORTED,
  IDENTITY_WORK_ORDER_DRAFT_READ_CAPABILITY_CONFIG_INVALID,
  IDENTITY_WORK_ORDER_DRAFT_READ_TARGET_INVALID,
} from './commands/work-order-draft-read-authorization.js';
export type {
  WorkOrderDraftReadAuthorizationConfig,
  WorkOrderDraftReadAuthorizationInput,
  WorkOrderDraftReadAuthorizationPort,
  WorkOrderDraftReadAuthorizationView,
  WorkOrderDraftReadBinding,
  WorkOrderDraftReadCapabilityCodes,
  WorkOrderDraftReadCapabilityKey,
  WorkOrderDraftReadDenialReason,
  WorkOrderDraftReadRevalidationFailure,
  WorkOrderDraftReadRevalidationInput,
  WorkOrderDraftReadRevalidationResult,
  WorkOrderDraftReadSelectorType,
} from './commands/work-order-draft-read-authorization.js';
export {
  createTaskExecutionContextSnapshotAuthorizationPort,
  TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS,
  CONTEXT_SNAPSHOT_BUILD_PURPOSE,
  CONTEXT_SNAPSHOT_READ_PURPOSE,
  IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
} from './commands/context-snapshot-authorization.js';
export type {
  TaskExecutionContextSnapshotAuthorizationConfig,
  TaskExecutionContextSnapshotAuthorizationInput,
  TaskExecutionContextSnapshotAuthorizationPort,
  TaskExecutionContextSnapshotAuthorizationView,
  TaskExecutionContextSnapshotBinding,
  TaskExecutionContextSnapshotCapabilityCodes,
  TaskExecutionContextSnapshotCapabilityKey,
  TaskExecutionContextSnapshotDenialReason,
  TaskExecutionContextSnapshotRevalidationFailure,
  TaskExecutionContextSnapshotRevalidationInput,
  TaskExecutionContextSnapshotRevalidationResult,
  TaskExecutionContextSnapshotSelectorType,
} from './commands/context-snapshot-authorization.js';
export {
  createContextSnapshotDraftReadAuthorizationPort,
  CONTEXT_SNAPSHOT_DRAFT_READ_BINDINGS,
} from './commands/context-snapshot-draft-read-authorization.js';
export type {
  ContextSnapshotDraftReadAuthorizationConfig,
  ContextSnapshotDraftReadAuthorizationInput,
  ContextSnapshotDraftReadAuthorizationPort,
  ContextSnapshotDraftReadAuthorizationView,
  ContextSnapshotDraftReadBinding,
  ContextSnapshotDraftReadCapabilityCodes,
  ContextSnapshotDraftReadCapabilityKey,
  ContextSnapshotDraftReadDenialReason,
  ContextSnapshotDraftReadRevalidationFailure,
  ContextSnapshotDraftReadRevalidationInput,
  ContextSnapshotDraftReadRevalidationResult,
  ContextSnapshotDraftReadSelectorType,
} from './commands/context-snapshot-draft-read-authorization.js';
export {
  createTaskExecutionCreationCapabilityBoundaryPort,
  createTaskExecutionExecutionCapabilityBoundaryPort,
  TASK_CREATION_CAPABILITY_HUMAN_ONLY,
  IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
  IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
  IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
  IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID,
} from './commands/task-execution-capability-boundary.js';
export {
  createWorkOrderValidationAuthorizationPort,
  WORK_ORDER_VALIDATION_BINDINGS,
  WORK_ORDER_DRAFT_VALIDATE_PURPOSE,
  WORK_ORDER_FREEZE_PURPOSE,
  WORK_ORDER_CONTRACT_READ_PURPOSE,
  WORK_ORDER_CONTEXT_SNAPSHOT_READ_PURPOSE,
  IDENTITY_WORK_ORDER_VALIDATION_AUTHORIZATION_UNSUPPORTED,
  IDENTITY_WORK_ORDER_VALIDATION_CAPABILITY_CONFIG_INVALID,
  IDENTITY_WORK_ORDER_VALIDATION_TARGET_INVALID,
} from './commands/work-order-validation-authorization.js';
export type {
  WorkOrderValidationAuthorizationConfig,
  WorkOrderValidationAuthorizationInput,
  WorkOrderValidationAuthorizationPort,
  WorkOrderValidationAuthorizationView,
  WorkOrderValidationBinding,
  WorkOrderValidationBoundary,
  WorkOrderValidationCapabilityCodes,
  WorkOrderValidationCapabilityKey,
  WorkOrderValidationContextReadAuthorizationInput,
  WorkOrderValidationContextReadAuthorizationView,
  WorkOrderValidationContextReadRevalidationInput,
  WorkOrderValidationContextReadRevalidationResult,
  WorkOrderValidationDenialReason,
  WorkOrderValidationDraftReadAuthorizationInput,
  WorkOrderValidationDraftReadAuthorizationView,
  WorkOrderValidationDraftReadRevalidationInput,
  WorkOrderValidationDraftReadRevalidationResult,
  WorkOrderValidationRevalidationFailure,
  WorkOrderValidationRevalidationInput,
  WorkOrderValidationRevalidationResult,
  WorkOrderValidationSelectorType,
  WorkOrderValidationTargetKind,
} from './commands/work-order-validation-authorization.js';
export type {
  TaskExecutionExecutionCapabilityBoundaryPort,
  TaskExecutionCreationCapabilityBoundaryConfig,
  TaskExecutionCreationCapabilityBoundaryOutcome,
  TaskExecutionCreationCapabilityBoundaryPort,
  TaskExecutionCreationCapabilityBoundaryRequest,
  TaskExecutionCreationCapabilityBoundaryResult,
} from './commands/task-execution-capability-boundary.js';
export {
  createActorSnapshot,
  authorizeCommand,
  validateAuthorizationDecision,
  SnapshotBoundaryError,
  DECISION_DEFAULT_TTL_SECONDS,
  IDENTITY_ACTOR_SNAPSHOT_INVALID,
  IDENTITY_DECISION_INPUT_INVALID,
} from './commands/actor-snapshot.js';
export type {
  CreateActorSnapshotInput,
  ActorSnapshotRef,
  ScopeKind,
  CommandIntent,
  AuthorizeCommandInput,
  AuthorizationDecisionView,
  DecisionValidationInput,
  DecisionValidationResult,
} from './commands/actor-snapshot.js';
export {
  checkEnterpriseAccess,
  checkProjectAccess,
  checkHumanOnlyCapability,
  getPolicySnapshot,
  IDENTITY_POLICY_SNAPSHOT_HASH_MISMATCH,
  IDENTITY_POLICY_SNAPSHOT_NOT_FOUND,
} from './commands/queries.js';
export type { AccessCheckInput, AccessDecision, PolicySnapshotView } from './commands/queries.js';
export {
  claimOutboxEvents,
  confirmPublished,
  markDeliveryFailure,
  resumeDeadLetterEvent,
  DISPATCH_DEFAULTS,
  DispatcherError,
  DISPATCHER_STALE_LEASE,
  DISPATCHER_EVENT_NOT_FOUND,
} from './messaging/dispatcher.js';
export type { ClaimedOutboxEvent } from './messaging/dispatcher.js';
export {
  consumeEvent,
  INBOX_QUARANTINE_HASH_CONFLICT,
  INBOX_QUARANTINE_HASH_MISMATCH,
  INBOX_QUARANTINE_UNKNOWN_MAJOR,
  INBOX_QUARANTINE_MISSING_EXTENSION,
  INBOX_SCOPE_CONFLICT,
  INBOX_RACE_LOST,
} from './messaging/inbox.js';
export type {
  ConsumedEvent,
  InboxConsumerContract,
  ConsumeEventDeps,
  ConsumeEventOutcome,
} from './messaging/inbox.js';

export { readRecoveryHumanEligibility } from './commands/recovery-human-eligibility.js';
export type {
  RecoveryHumanEligibilityInput,
  RecoveryHumanEligibilityAuthority,
} from './commands/recovery-human-eligibility.js';

export {
  BLOCKED_INPUT_RECOVERY_BINDINGS,
  FORMAL_OUTPUT_RECOVERY_BINDINGS,
  createRecoveryAuthorizationPort,
  type RecoveryCapabilityCodes,
} from './commands/work-order-validation-authorization.js';

export {
  createFormalCompletionAuthorizationPort,
  formalCompletionBindings,
  FORMAL_COMPLETION_CONSUMERS,
  type FormalCompletionConsumer,
  type FormalCompletionAuthorizationConfig,
} from './commands/work-order-validation-authorization.js';

export {
  createTaskCompletedDeliveryAuthorizationPort,
  taskCompletedDeliveryBindings,
  type TaskCompletedDeliveryAuthorizationConfig,
} from './commands/work-order-validation-authorization.js';
