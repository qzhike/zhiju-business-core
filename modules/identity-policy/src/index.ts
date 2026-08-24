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
