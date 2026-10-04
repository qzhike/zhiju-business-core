export const taskExecutionModule = Object.freeze({
  name: 'task-execution',
  status: 'IM_06_WI_01_APPLICATION_PERSISTENCE_FOUNDATION' as const,
});

export {
  CONTEXT_BUILDER_POLICY_PROFILE_KEY,
  TASK_READINESS_POLICY_PROFILE_KEY,
  WORK_ORDER_VALIDATION_POLICY_PROFILE_KEY,
  validateContextBuilderPolicy,
  validateTaskReadinessPolicy,
  validateWorkOrderValidationPolicy,
} from './business/policy-profiles.js';
export {
  TASK_READINESS_EVALUATOR_PROFILE_KEY,
  WORK_ORDER_VALIDATION_EVALUATOR_PROFILE_KEY,
  resolveTaskReadinessEvaluatorProfile,
  resolveWorkOrderValidationEvaluatorProfile,
} from './business/evaluator-profiles.js';
export type {
  ContextBuilderPolicyRules,
  PolicyProfileValidationResult,
  TaskReadinessPolicyRules,
  WorkOrderValidationPolicyRules,
} from './business/policy-profiles.js';
export {
  createTaskExecutionDatabase,
  withTaskExecutionTransaction,
  withTaskExecutionSnapshotTransaction,
  digestCanonicalPayload,
  CANONICALIZATION_VERSION,
  PAYLOAD_HASH_ALGORITHM,
} from './persistence/task-execution-db.js';
export type {
  TaskExecutionDb,
  TaskExecutionTransaction,
  TaskExecutionTransactionContext,
  TaskExecutionPrincipalKind,
  CommandReceiptTable,
  OutboxEventTable,
  InboxMessageTable,
  ProcessInstanceTable,
  ProcessStepTable,
  AuditRecordTable,
  ReferenceEdgeTable,
  ContractViolationTable,
} from './persistence/task-execution-db.js';

export type { ProcessInstanceInsert } from './persistence/task-execution-repository.js';
export { TaskExecutionRepository } from './persistence/task-execution-repository.js';

export {
  TaskExecutionPersistenceError,
  TASK_EXECUTION_PAYLOAD_HASH_MISMATCH,
  TASK_EXECUTION_PROMOTED_MIRROR_MISMATCH,
  TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
  validatePromotedMirror,
  assertHashMatches,
} from './persistence/write-guards.js';

export {
  executeTaskExecutionCommand,
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
  CommandFacts,
  CommandBodyResult,
  CommandExecution,
  CommandResult,
  CommandAuditInput,
  OutboxEventInput,
  ReferenceEdgeInput,
  ProcessStepInput,
} from './persistence/command-runner.js';

// IM-06 (#204): Task DRAFT creation for `execution.create_task@1.0` / `@2.0`
// (Spec 003 §16). The handler consumes the EnterpriseProject-owned internal
// Project scope Port; authorization is revalidated by the composition entry
// before the idempotency claim.
export {
  handleCreateTask,
  createTaskIdempotencyScope,
  CREATE_TASK_COMMAND,
  TASK_DRAFT_CREATION_BINDINGS,
  EXECUTION_PROJECT_REF_INVALID,
  EXECUTION_DELIVERY_ITEM_REF_INVALID,
  EXECUTION_PARENT_TASK_REF_INVALID,
  EXECUTION_DEFINITION_REF_INVALID,
  EXECUTION_TASK_ALREADY_EXISTS,
  DEPENDENCY_UNAVAILABLE,
} from './business/task-draft-creation.js';
export type {
  TaskDraftCreationBinding,
  TaskDraftCreationPorts,
  TaskExecutionCreationProjectScopeOutcome,
  TaskExecutionCreationProjectScopePort,
  TaskExecutionCreationProjectScopeRequest,
} from './business/task-draft-creation.js';
export { TaskDraftRepository } from './persistence/task-draft-repository.js';
export type {
  TaskDefinitionSnapshotInsert,
  TaskRootInsert,
  TaskScopeRow,
} from './persistence/task-draft-repository.js';
export type {
  TaskTable,
  TaskDefinitionSnapshotTable,
  ExecutionJudgmentTable,
} from './persistence/task-execution-db.js';

// IM-06 (#208): Task Readiness production and the `DRAFT` → `READY` transition
// (Spec 003 §17). The producer consumes the IdentityPolicy-owned Policy
// resolution and the EnterpriseProject-owned input-reference reads through
// internal Ports; each entry revalidates its own authorization at the
// composition boundary before the idempotency claim.
export {
  BUILD_TASK_READINESS_COMMAND,
  buildTaskReadinessIdempotencyScope,
  handleBuildTaskReadiness,
  AUTHORIZATION_EXPIRED,
  EXECUTION_TASK_REF_INVALID,
  EXECUTION_JUDGMENT_INVALID,
  EXECUTION_JUDGMENT_STALE,
  EXECUTION_CRITERION_UNSUPPORTED,
  EXECUTION_TASK_DEPENDENCY_CYCLE,
  EXECUTION_TASK_READINESS_UNSATISFIED,
  EXECUTION_TASK_NOT_EXECUTABLE,
  NOT_FOUND,
  TASK_READINESS_OBJECT_TYPE,
  TASK_DEFINITION_SNAPSHOT_OBJECT_TYPE,
  POLICY_VERSION_OBJECT_TYPE,
  EVALUATOR_PROFILE_OBJECT_TYPE,
} from './business/task-readiness-production.js';
export type {
  TaskReadinessPolicyPort,
  TaskReadinessPolicyResolution,
  TaskReadinessProducerPorts,
} from './business/task-readiness-production.js';
export {
  MARK_TASK_READY_COMMAND,
  TASK_READY_EVENT,
  TASK_READY_EVENT_VERSION,
  handleMarkTaskReady,
} from './business/task-ready-transition.js';
export type { TaskReadyTransitionPorts } from './business/task-ready-transition.js';
export {
  SUPPORTED_INPUT_OBJECT_TYPE,
  TASK_READINESS_TASK_BINDINGS,
  exactProjectScope,
  observeReadiness,
  readTaskRefClosure,
  taskSpellingForSchemaVersion,
} from './business/task-readiness-plan.js';
export type {
  DependencyCompletionUseStatus,
  DependencyObservation,
  InputObservation,
  InputResolution,
  ReadinessCheckRow,
  ReadinessObservation,
  ReadinessScope,
  TaskReadinessInputRefPort,
  TaskReadinessInputRefResolution,
} from './business/task-readiness-plan.js';
export {
  TASK_READINESS_JUDGMENT_KIND,
  TASK_READINESS_TARGET_TYPE,
  TaskReadinessRepository,
} from './persistence/task-readiness-repository.js';
export type {
  ExecutionJudgmentInsert,
  ExecutionJudgmentRow,
  TaskGraphNodeRow,
  TaskReadyCasInput,
  TaskReadyCasResult,
} from './persistence/task-readiness-repository.js';

// IM-06 (#212): WorkOrder DRAFT creation and the exact draft reads
// (Spec 003 §18). The creation handler consumes the IdentityPolicy-owned
// Human-only classification boundary and writes the WorkOrder Root, its
// immutable draft Snapshot and one Reference Edge; the read handler returns
// committed facts only and writes nothing. Both entries revalidate their own
// authorization at the composition boundary before the idempotency claim.
export {
  handleCreateWorkOrder,
  createWorkOrderIdempotencyScope,
  CREATE_WORK_ORDER_COMMAND,
  WORK_ORDER_DRAFT_CREATION_BINDINGS,
  EXECUTION_WORK_ORDER_REF_INVALID,
  EXECUTION_WORK_ORDER_ALREADY_EXISTS,
  EXECUTION_WORK_ORDER_SCOPE_INVALID,
  HUMAN_ONLY_CAPABILITY,
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
} from './business/work-order-draft-creation.js';
export type {
  WorkOrderCapabilityBoundaryPort,
  WorkOrderCapabilityClassificationRequest,
  WorkOrderCapabilityClassificationResult,
  WorkOrderDraftCreationBinding,
  WorkOrderDraftCreationPorts,
  WorkOrderDraftPrincipalRef,
} from './business/work-order-draft-creation.js';
export {
  handleGetWorkOrderDraft,
  GET_WORK_ORDER_DRAFT_QUERY,
  WORK_ORDER_DRAFT_READ_BINDINGS,
  WORK_ORDER_DRAFT_SNAPSHOT_OBJECT_TYPE,
  AGGREGATE_STATE_NOT_ALLOWED,
  REFERENCE_INVALID,
} from './business/work-order-draft-read.js';
export type {
  WorkOrderDraftReadBinding,
  WorkOrderDraftReadInput,
  WorkOrderDraftReadResult,
} from './business/work-order-draft-read.js';
export { WorkOrderDraftRepository } from './persistence/work-order-draft-repository.js';
export type {
  BoundTaskRow,
  WorkOrderDraftSnapshotIdentityRow,
  WorkOrderDraftSnapshotInsert,
  WorkOrderDraftSnapshotRow,
  WorkOrderRootInsert,
  WorkOrderRootRow,
} from './persistence/work-order-draft-repository.js';
export type {
  WorkOrderTable,
  WorkOrderDraftSnapshotTable,
} from './persistence/task-execution-db.js';

// IM-06 (#216): initial Context Snapshot build and the authoritative Snapshot
// read (Spec 003 §19). The build handler consumes the EnterpriseProject-owned
// Source Slice read Port and the IdentityPolicy-owned Policy resolve Port
// through internal Ports; the deterministic assembly is pure and writes
// nothing itself. The read returns committed facts only and writes nothing.
// Both entries revalidate their own authorization at the composition boundary
// before the idempotency claim or the read.
export {
  assembleInitialContext,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  EXECUTION_CONTEXT_TARGET_INVALID,
  EXECUTION_CONTEXT_INPUT_REQUIRED,
  SLICE_OMISSION_EFFECT_ON_TASK,
  DRAFT_INPUT_OMISSION_CATEGORY,
  DRAFT_INPUT_OMISSION_EFFECT_ON_TASK,
  DRAFT_INPUT_NOT_CAPTURED,
  DRAFT_INPUT_KIND_NOT_SUPPORTED,
  ENTERPRISE_FACT_OBJECT_TYPE,
} from './business/initial-context-assembly.js';
export type {
  InitialContextAssemblyDraft,
  InitialContextAssemblyInput,
  InitialContextAssemblyOutcome,
  InitialContextAssemblyPolicy,
  InitialContextAssemblyRequest,
  InitialContextAssemblySlice,
} from './business/initial-context-assembly.js';
export {
  handleBuildInitialContext,
  buildInitialContextIdempotencyScope,
  BUILD_INITIAL_CONTEXT_SNAPSHOT_COMMAND,
  BUILD_INITIAL_CONTEXT_SNAPSHOT_VERSION,
  EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
  EXECUTION_DRAFT_SNAPSHOT_STALE,
  POLICY_NOT_EFFECTIVE,
  POLICY_EXPIRED,
} from './business/initial-context-build.js';
export type {
  ContextBuilderPolicyPort,
  ContextBuilderPolicyResolution,
  ContextSourceSliceObservation,
  ContextSourceSliceReadPort,
  InitialContextBuildPorts,
  InitialContextDraftReadDecision,
} from './business/initial-context-build.js';
export {
  handleGetContextSnapshot,
  GET_CONTEXT_SNAPSHOT_QUERY,
  GET_CONTEXT_SNAPSHOT_VERSION,
} from './business/context-snapshot-read.js';
export type {
  GetContextSnapshotInput,
  GetContextSnapshotResult,
} from './business/context-snapshot-read.js';
export {
  CONTEXT_SNAPSHOT_OBJECT_TYPE,
  ContextSnapshotRepository,
} from './persistence/context-snapshot-repository.js';
export type {
  ContextSnapshotBuildInsert,
  ContextSnapshotInsert,
  ContextSnapshotLegacyRow,
  ContextSnapshotRow,
} from './persistence/context-snapshot-repository.js';
export type {
  ContextSnapshotTable,
  ContextSnapshotBuildTable,
  ContextSnapshotLegacyTable,
} from './persistence/task-execution-db.js';

export {
  handleValidateWorkOrderDraft,
  handleFreezeWorkOrder,
  handleGetWorkOrderContract,
  readExactWorkOrderValidation,
  readWorkOrderValidationContextMetadata,
} from './business/work-order-validation.js';
export type { WorkOrderValidationPorts } from './business/work-order-validation.js';
export type { WorkOrderPolicyObservation } from './business/work-order-validation-plan.js';
export {
  handleQueueWorkOrder,
  handleCreateFirstRun,
  handleStartFirstRun,
  handleReconcileFirstRun,
  handleGetRunDispatchBinding,
  handleGetRunState,
} from './business/controlled-first-run.js';
export type { ControlledFirstRunPorts } from './business/controlled-first-run.js';
export {
  scanControlledFinalCandidates,
  recoverControlledFinalRuns,
  handleSubmitFinalResult,
  handleRecordRunResult,
  handleValidateFinalResult,
  handleAcceptFinalResult,
  handleFinalizeFirstRun,
  handleExpireFirstRun,
  handleExpireFirstRunV2,
  handleCancelFirstRun,
  handleGetAcceptedAgentResult,
} from './business/controlled-final-result.js';
export type {
  CancellationPolicyResolution,
  ControlledFinalPorts,
  ControlledFinalRecoveryCommand,
  ControlledFinalRecoveryPorts,
  ControlledFirstRunCancelPorts,
} from './business/controlled-final-result.js';
export { isolateLateFinalResult } from './business/late-final-isolation.js';
export type {
  LateFinalIsolationInput,
  LateFinalIsolationPorts,
  LateFinalIsolationResult,
} from './business/late-final-isolation.js';
export {
  controlledFinalProcessId,
  listControlledFinalProgress,
  createControlledFinalProgress,
  advanceControlledFinalProgress,
  suspendTimedOutControlledFinalProgress,
} from './business/controlled-final-progress.js';
export type {
  ControlledFinalProgress,
  ControlledFinalProgressAdvance,
  ControlledFinalStep,
} from './business/controlled-final-progress.js';

export * from './business/blocked-input-recovery.js';

export * from './business/frozen-recovery-context.js';

export * from './business/recovery-root-state.js';

export {
  BLOCKED_INPUT_RECOVERY_STEPS,
  blockedInputRecoveryProcessId,
  scanBlockedInputRecoveryCandidates,
  recoverBlockedInput,
  readBlockedInputRecoveryProgress,
  type RecoveryProcessProgress,
  type RecoveryProcessPorts,
} from './business/blocked-input-recovery-process.js';

export * from './business/formal-completion.js';
export * from './business/output-creation-binding.js';

export type { DependencyCompletionPort } from './business/task-readiness-plan.js';

export * from './business/task-completed-dispatch.js';

// IM-06 (#246): `execution.get_usage_and_provenance@1.0`, the Human-operated
// Usage and execution Provenance readback (Spec 003 §13). The handler reads one
// dedicated REPEATABLE READ TE snapshot and consumes the IdentityPolicy-owned
// six-mapping authorization plus the IntegrationGateway-owned historical
// integrity reads; it writes nothing.
export {
  handleGetUsageAndProvenance,
  validateUsageSafetyProfile,
  GET_USAGE_AND_PROVENANCE_QUERY,
  GET_USAGE_AND_PROVENANCE_VERSION,
  USAGE_PROVENANCE_PROFILE,
} from './business/usage-provenance-read.js';
export type { UsageProvenancePorts, UsageReasonCode } from './business/usage-provenance-read.js';
