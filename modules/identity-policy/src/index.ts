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
  COMMAND_CONTEXT_MISMATCH,
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
} from './persistence/command-runner.js';
