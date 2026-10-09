// Composition entry points of the API layer. The transport (or a future
// Workspace BFF) uses these adapters to turn authenticated requests into the
// trusted contexts the owning modules consume; business modules never import
// each other directly.

export {
  RESOLVE_POLICY_COMMAND,
  RESOLVE_POLICY_PURPOSE,
  createContextSourceSliceEntry,
} from './context-source-slice-entry.js';
export type {
  ContextSourceSliceEntry,
  ContextSourceSliceEntryConfig,
  ContextSourceSliceSession,
} from './context-source-slice-entry.js';
export { CompositionBoundaryError } from './decision-boundary.js';
export { createResolutionReceiptEntry } from './resolution-receipt-entry.js';
export type {
  ResolutionReceiptEntry,
  ResolutionReceiptEntryConfig,
  ResolutionReceiptSession,
} from './resolution-receipt-entry.js';
export { createCreateTaskEntry } from './create-task-entry.js';
export type {
  CreateTaskEntry,
  CreateTaskEntryConfig,
  CreateTaskSession,
} from './create-task-entry.js';
export { createRevisionEligibilityEntry } from './revision-eligibility-entry.js';
export type {
  RevisionEligibilityEntry,
  RevisionEligibilityEntryConfig,
  RevisionEligibilitySession,
} from './revision-eligibility-entry.js';
export { createTaskReadinessEntry } from './task-readiness-entry.js';
export type {
  TaskReadinessEntry,
  TaskReadinessEntryConfig,
  TaskReadinessSession,
} from './task-readiness-entry.js';
export { createWorkOrderDraftEntry } from './work-order-draft-entry.js';
export type {
  WorkOrderDraftEntry,
  WorkOrderDraftEntryConfig,
  WorkOrderDraftSession,
} from './work-order-draft-entry.js';
export { createInitialContextEntry } from './initial-context-entry.js';
export type {
  InitialContextCapabilityCodes,
  InitialContextEntry,
  InitialContextEntryConfig,
  InitialContextSession,
} from './initial-context-entry.js';
export { createWorkOrderValidationEntry } from './work-order-validation-entry.js';
export type { WorkOrderValidationEntryConfig } from './work-order-validation-entry.js';
export { createControlledFirstRunEntry } from './controlled-first-run-entry.js';
export type {
  ControlledFirstRunEntryConfig,
  ControlledFirstRunSession,
} from './controlled-first-run-entry.js';
export { createUsageProvenanceEntry } from './usage-provenance-entry.js';
export type {
  UsageProvenanceEntryConfig,
  UsageProvenanceSession,
} from './usage-provenance-entry.js';
export {
  ControlledFinalRecoveryWorker,
  createControlledFinalRecoveryWorker,
} from './controlled-final-recovery-worker.js';
export type {
  ControlledFinalRecoveryWorkerConfig,
  ControlledFinalRecoveryHostConfig,
} from './controlled-final-recovery-worker.js';

export {
  createBlockedInputRecoveryEntry,
  createRecoveryProcessAuthorities,
  createRecoveryDependencyPorts,
  readFrozenEligibilityForConsumer,
} from './blocked-input-recovery-entry.js';
export type {
  BlockedInputRecoveryEntryConfig,
  RecoverySession,
} from './blocked-input-recovery-entry.js';

export { createBlockedInputRecoveryWorker } from './blocked-input-recovery-worker.js';
export type { BlockedInputRecoveryWorkerConfig } from './blocked-input-recovery-worker.js';

export * from './formal-completion-entry.js';

export * from './task-completed-delivery-entry.js';

// IM-06 TD-05 (#248): the Human Project Task Board read entry and the finite
// export/publish and retention-maintenance passes.
export { createTaskBoardEntry, verifyBoardResult } from './task-board-entry.js';
export type { TaskBoardEntryConfig, TaskBoardSession } from './task-board-entry.js';
export {
  TaskBoardDispatcherError,
  createTaskBoardDispatcher,
  runTaskBoardExportPass,
  runTaskBoardMaintenancePass,
} from './task-board-dispatcher.js';
export type {
  PreparedTaskBoardProject,
  TaskBoardDispatcherConfig,
  TaskBoardDispatcherFactoryConfig,
  TaskBoardDispatcherPorts,
  TaskBoardDispatcherProject,
  TaskBoardDispatcherTarget,
  TaskBoardExportResult,
  TaskBoardTechnicalBoundary,
} from './task-board-dispatcher.js';
export { resolveTaskBoardPolicy } from './task-board-policy.js';
export type { BoardPolicyResolutionContext } from './task-board-policy.js';

export * from './company-rule-entry.js';
