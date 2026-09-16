export const identityPolicyModule = Object.freeze({
  name: 'identity-policy',
  status: 'PERSISTENCE_FOUNDATION' as const,
});

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
