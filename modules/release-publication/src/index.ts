export * from './receipt-validator.js';
export * from './release-publication-runtime.js';
export * from './package-hash.js';
export * from './release-publication-validation.js';
export * from './release-publication-authorization.js';
export * from './provider-result.js';
export * from './release-publication-handlers.js';

export {
  createReleasePublicationDatabase,
  withReleasePublicationTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/release-publication-db.js';
export type {
  ReleasePublicationDb,
  ReleaseTransaction,
  ReleaseTransactionContext,
  ReleasePrincipalKind,
} from './persistence/release-publication-db.js';

export { ReleasePublicationBusinessRepository } from './persistence/release-publication-business-repository.js';
export type {
  BusinessWriteOutcome,
  ReleaseWriteResult,
  ReleaseDraftInsert,
  ReleaseSelectionReplacement,
  ReleaseDestinationReplacement,
  ReleasePrepareInput,
  ReleaseCancelInput,
} from './persistence/release-publication-business-repository.js';

export {
  executeReleasePublicationCommand,
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
} from './persistence/release-publication-command-runner.js';
export type {
  CommandEnvelope,
  CommandBodyResult,
  CommandExecution,
  CommandResult,
  InboxMessageInput,
  ProcessStepInput,
  OutboxEventInput,
  ReferenceEdgeInput,
  CommandAuditInput,
} from './persistence/release-publication-command-runner.js';

export const releasePublicationModule = Object.freeze({
  name: 'release-publication',
  status: 'IM_05_WI07_RELEASE_PUBLICATION' as const,
});
