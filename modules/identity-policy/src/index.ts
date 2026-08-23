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
  IDENTITY_PAYLOAD_HASH_MISMATCH,
  IDENTITY_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
} from './persistence/identity-policy-repository.js';
export type {
  PrincipalInsert,
  PrincipalStateTransitionInsert,
  ExternalIdentityInput,
  ExternalIdentityLinkView,
  ScopedAssignmentInsert,
  RevocationInsert,
  PolicySnapshotInsert,
  ActorSnapshotInsert,
  AuthorizationDecisionInsert,
} from './persistence/identity-policy-repository.js';
export {
  executeIdentityCommand,
  CommandExecutionError,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  CONCURRENCY_CONFLICT,
  COMMAND_IN_PROGRESS,
  PAYLOAD_HASH_MISMATCH,
} from './persistence/command-runner.js';
export type {
  CommandEnvelope,
  CommandBodyResult,
  CommandExecution,
  CommandResult,
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
  isResolvablePolicySchemaRef,
} from './commands/static-registry.js';
