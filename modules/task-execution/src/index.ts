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
