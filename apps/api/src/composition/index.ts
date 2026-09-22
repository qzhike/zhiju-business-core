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
