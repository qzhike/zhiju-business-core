export const enterpriseProjectModule = Object.freeze({
  name: 'enterprise-project',
  status: 'APPLICATION_PERSISTENCE_FOUNDATION' as const,
});

export {
  createEnterpriseProjectDatabase,
  withEnterpriseProjectTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/enterprise-db.js';
export type {
  EnterpriseProjectDb,
  EnterpriseProjectTransaction,
  EnterpriseProjectTransactionContext,
} from './persistence/enterprise-db.js';
export { EnterpriseProjectRepository } from './persistence/enterprise-project-repository.js';
export type { ProcessInstanceInsert } from './persistence/enterprise-project-repository.js';
export {
  EnterprisePersistenceError,
  ENTERPRISE_PAYLOAD_HASH_MISMATCH,
  ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
  ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
} from './persistence/write-guards.js';
export {
  executeEnterpriseProjectCommand,
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
