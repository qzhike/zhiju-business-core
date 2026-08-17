# Module-Spec-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`FIELD-LEVEL IDL BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / PR #10 SCHEMA REMEDIATION USER REVIEWED 2026-08-17 / MAIN INTEGRATION VERIFIED / HANDLER IMPLEMENTATION NOT STARTED`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

TaskExecution 是 Task、WorkOrder、ContextSnapshot、Run、AgentResult、InformationRequest、Usage 与 Completion/Recovery Process 的唯一写入 Owner。它拥有“谁被授权尝试做什么、在什么上下文中发生了哪次执行”，但不拥有 Project Fact、ArtifactRevision 内容、Gate、Approval、Release 或 Harness Session 内部状态。

同步读取 IdentityPolicy Decision 与 EnterpriseProject/Artifact/QualityGovernance/ReleasePublication 的权限裁剪 Query；Runtime 外部副作用只能通过 IntegrationGateway Port。测试规格：[`Module-Test-003-TaskExecution.md`](../module-tests/Module-Test-003-TaskExecution.md)。Runtime 原始协议、Execution Package、本地 CLI Process Driver、标准事件、Result/Usage 和 CLI Profile 由 [`Runtime-Adapter-Contract-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md) 专项维护；该专项不得改变本模块的业务所有权。

## 2. 模块类型

```text
TaskStatus = Closed<DRAFT | BACKLOG | READY | IN_PROGRESS | WAITING_INPUT | BLOCKED | IN_REVIEW | CHANGES_REQUIRED | COMPLETION_PENDING | COMPLETED | CANCELLED>
WorkOrderStatus = Closed<DRAFT | READY | QUEUED | RUNNING | WAITING_INPUT | COMPLETION_PENDING | RETRY_PENDING | COMPLETED | FAILED | CANCELLED | EXPIRED>
RunStatus = Closed<CREATED | STARTING | RUNNING | SUSPENDED | CANCELLING | RESULT_RECORDED | SUCCEEDED | INVALID_RESULT | FAILED | TIMED_OUT | CANCELLED | ABANDONED | INVALIDATED>
ExecutionOutcome = Closed<COMPLETED | PARTIAL | BLOCKED_INPUT | BLOCKED_POLICY | FAILED_EXECUTION | CANCELLED_BY_RUNTIME>
InformationRequestStatus = Closed<OPEN | DELIVERY_PENDING | DELIVERED | ANSWERED | UNDER_VALIDATION | CLARIFICATION_REQUIRED | ANSWER_REJECTED | RESOLVED | DELIVERY_FAILED | EXPIRED | CANCELLED>
TerminalRunStatus = Closed<SUCCEEDED | INVALID_RESULT | FAILED | TIMED_OUT | CANCELLED | ABANDONED | INVALIDATED>

TaskDefinition
├── deliveryItemRef?: VersionedRef<DeliveryItem>
├── parentTaskRef?: ObjectRef<Task>
├── taskType: NamespaceCode
├── title: NonEmptyString
├── objective: NonEmptyString
├── priority: NamespaceCode
├── riskLevel: NamespaceCode
├── dependencyTaskRefs: Set<ObjectRef<Task>>
├── inputRefs: TypedReference[]
├── expectedOutputSpec: CanonicalJson
├── completionCriteria: CanonicalJson
└── dueConstraint?: CanonicalJson

WorkOrderDraft
├── taskRef: ObjectRef<Task>
├── requestedBy: PrincipalRef
├── objective: Objective
├── targetScope: TargetScope
├── inputRefs: InputRef[]
├── constraints: CanonicalJson[]
├── allowedCapabilities: CapabilityGrant[]
├── deniedCapabilities: CapabilityGrant[]
├── expectedOutputs: ExpectedOutput[]
├── completionCriteria: CompletionCriterion[]
├── riskAndQuality: RiskAndQuality
├── executionPolicy: ExecutionPolicy
├── budget: ExecutionBudget
├── harnessPolicy: HarnessPolicy
├── modelPolicy: ModelPolicy
└── versionPins: VersionPins

ContextBuildRequest
├── workOrderRef: ObjectRef<WorkOrder>
├── workOrderContractRef: ContentAddressedRef<WorkOrderContract>
├── projectionType: NamespaceCode
├── purpose: NamespaceCode
├── audience: PrincipalRef
├── sourceSlices: NonEmptySet<ContentAddressedRef<ContextSourceSlice>>
├── answeredInformationRefs: TypedReference[]
├── builderPolicyRef: VersionedRef<Policy>
└── expiresAt?: UtcInstant

RuntimeBinding
├── adapterCode: NamespaceCode
├── adapterVersion: NonEmptyString
├── harnessId: NamespaceCode
├── harnessVersion: NonEmptyString
├── provider: NamespaceCode
├── modelId: NonEmptyString
├── modelConfigHash: PayloadHash
└── executionNodeRef?: ExternalRef

RuntimeBindingSummary
├── adapterCode: NamespaceCode
├── adapterVersion: NonEmptyString
├── harnessId: NamespaceCode
├── harnessVersion: NonEmptyString
├── provider: NamespaceCode
├── modelId: NonEmptyString
└── modelConfigHash: PayloadHash

RunCreation
├── workOrderRef: ObjectRef<WorkOrder>
├── workOrderContractRef: ContentAddressedRef<WorkOrderContract>
├── attemptNumber: PositiveInt
├── runtimeBinding: RuntimeBinding
├── contextSnapshotRef: SnapshotRef<ProjectContext>
├── capabilityGrantRef: ContentAddressedRef<CapabilityGrantBundle>
├── leasePolicyRef: VersionedRef<Policy>
└── executionDeadline?: UtcInstant

RuntimeInputRequired
├── runtimeEventRef: ExternalRef
├── question: NonEmptyString
├── reason: NonEmptyString
├── expectedAnswerSpec: CanonicalJson
├── blocking: boolean
├── requestedResponderRole?: NamespaceCode
├── continuationRef?: ExternalRef
└── occurredAt: UtcInstant

InformationRequestDefinition
├── taskRef?: ObjectRef<Task>
├── workOrderRef?: ObjectRef<WorkOrder>
├── runRef?: ObjectRef<Run>
├── relatedRefs: NonEmptySet<TypedReference>
├── requestType: NamespaceCode
├── question: NonEmptyString
├── reason: NonEmptyString
├── expectedAnswerSpec: CanonicalJson
├── requestedResponder: CanonicalJson
├── blocking: boolean
├── dueAt?: UtcInstant
└── expiresAt?: UtcInstant

AnswerSubmission
├── answerId: UuidV7
├── responder: PrincipalRef
├── answerContent: CanonicalJson
├── sourceRefs: TypedReference[]
├── channelSourceRef?: ExternalRef
├── submittedAt: UtcInstant
└── payloadHash: PayloadHash

CompletionEvaluationInput
├── criteriaHash: PayloadHash
├── factRefs: NonEmptySet<TypedReference>
├── blockingRefs: TypedReference[]
├── sourceWatermarks: SourceWatermark[]
├── evaluatorRef: VersionedRef<Evaluator>
└── evaluatedAt: UtcInstant
```

`Objective`、`TargetScope`、`InputRef`、`CapabilityGrant`、`ExpectedOutput`、`CompletionCriterion`、`RiskAndQuality`、`ExecutionPolicy`、`ExecutionBudget`、`HarnessPolicy`、`ModelPolicy`、`VersionPins`、`WorkOrderContract`、`ProjectContextContract` 和 `AgentResultContract` 的字段以 `03-core-contracts.md` 为唯一权威，不在本文件复制。可执行 Schema 必须直接引用或逐字段等价实现该权威结构，不得把这些 Core Contract 降级为开放 `CanonicalJson`。

## 3. Command Payload Contract

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `execution.create_task@1.0` | `Task / CREATE` | `projectRef: ObjectRef<Project>; definition: TaskDefinition; initialAssignee?: CanonicalJson` | `execution.task.create`；Agent 仅在 Coordinator Capability 下创建 DRAFT，不能直接 READY |
| `execution.mark_task_ready@1.0` | `Task / MUTATE` | `readinessSnapshotRef: SnapshotRef<TaskReadiness>; requestedAt: UtcInstant` | `execution.task.mark_ready`；依赖、输入、权限满足；不接受调用者布尔值 |
| `execution.create_work_order@1.0` | `WorkOrder / CREATE` | `draft: WorkOrderDraft; expiresAt?: UtcInstant` | `execution.work_order.create`；Scope 不得超出 Task；Human-only Capability 禁止授予 Agent |
| `execution.freeze_work_order@1.0` | `WorkOrder / MUTATE` | `workOrderContract: WorkOrderContract; validationSnapshotRef: SnapshotRef<WorkOrderValidation>; specificationHash: PayloadHash` | `execution.work_order.freeze`；READY 后 Specification 不可变；Hash 必须匹配 |
| `execution.queue_work_order@1.0` | `WorkOrder / MUTATE` | `queuePolicyRef: VersionedRef<Policy>; notBefore?: UtcInstant; requestedRuntimeClass?: NamespaceCode` | `execution.work_order.queue`；必须 READY、未过期且预算可用 |
| `execution.build_context_snapshot@1.0` | `ContextSnapshot / CREATE` | `request: ContextBuildRequest` | `execution.context.build`；Source Slice 精确版本、同 Scope、按 Purpose 裁剪；创建后不可变 |
| `execution.create_run@1.0` | `Run / CREATE` | `creation: RunCreation` | `execution.run.create`；同 WorkOrder 默认只有一个 active claim；attempt 单调 |
| `execution.start_run@1.0` | `Run / MUTATE` | `leaseId: UuidV7; fencingToken: NonNegativeInt; runtimeAttemptRef: ObjectRef<RuntimeAttempt>; startedAt: UtcInstant` | `execution.run.start`；Token/Context/Runtime Binding 固定；过期 lease 拒绝 |
| `execution.request_run_cancel@1.0` | `Run / MUTATE` | `reason: Justification; requestedAt: UtcInstant; cancellationPolicyRef: VersionedRef<Policy>` | `execution.run.cancel.request`；进入 CANCELLING，不虚构 Runtime 已取消 |
| `execution.record_runtime_input_required@1.0` | `Run / MUTATE` | `inputRequired: RuntimeInputRequired` | `execution.run.input_required.record`；控制事件不是 final AgentResult；是否可 Resume 由 Policy 判定 |
| `execution.submit_agent_result@1.0` | `AgentResult / CREATE` | `agentResultContract: AgentResultContract; runFencingToken: NonNegativeInt; runtimeSubmissionRef: ExternalRef` | `execution.agent_result.submit`；绑定精确 Run；同 Result ID/Hash 幂等，不同 Hash Quarantine |
| `execution.accept_agent_result@1.0` | `AgentResultAcceptanceRecord / CREATE` | `agentResultRef: ContentAddressedRef<AgentResult>; schemaValidationRef: ContentAddressedRef<ValidationResult>; identityValidationRef: ContentAddressedRef<ValidationResult>; runBindingValidationRef: ContentAddressedRef<ValidationResult>; scopeValidationRef: ContentAddressedRef<ValidationResult>; businessOutputValidationRef: ContentAddressedRef<ValidationResult>; disposition: Closed<ACCEPTED \| REJECTED \| QUARANTINED>; reasons: ReasonCode[]` | `execution.agent_result.accept`；仅 Validator Service；ACCEPTED 不等于 WorkOrder 完成 |
| `execution.open_information_request@1.0` | `InformationRequest / CREATE` | `definition: InformationRequestDefinition` | `execution.information_request.open`；blocking 请求必须有明确 BlockedRef |
| `execution.record_information_delivery@1.0` | `InformationRequest / APPEND` | `deliveryAttemptRef: ObjectRef<ChannelDeliveryAttempt>; destinationRef: ExternalRef; outcome: Closed<DELIVERED \| FAILED \| UNKNOWN>; receiptRef?: ContentAddressedRef<RawExternalReceipt>; occurredAt: UtcInstant; errorCode?: ReasonCode` | `execution.information_request.delivery.record`；UNKNOWN 不得当 FAILED/DELIVERED；expected version 必填 |
| `execution.submit_information_answer@1.0` | `InformationRequest / APPEND` | `answer: AnswerSubmission` | `execution.information_request.answer.submit`；映射 Principal、Scope、nonce 和 AnswerSpec 校验；重复渠道事件幂等 |
| `execution.resolve_information_request@1.0` | `InformationRequest / MUTATE` | `acceptedAnswerRef: ContentAddressedRef<InformationAnswer>; resolutionDisposition: NamespaceCode; domainCommandRefs: NonEmptySet<ContentAddressedRef<CommandReceipt>>; resolvedBy: PrincipalRef; resolvedAt: UtcInstant; justification: Justification` | `execution.information_request.resolve`；Agent 不能采纳自己的答案；ANSWERED 不等于 RESOLVED |
| `execution.schedule_work_order_retry@1.0` | `WorkOrder / MUTATE` | `previousRunRef: ObjectRef<Run>; retryReason: ReasonCode; nextAttemptNumber: PositiveInt; notBefore?: UtcInstant; selectedRuntimeBinding?: RuntimeBinding; retryPolicyRef: VersionedRef<Policy>` | `execution.work_order.retry.schedule`；新 Run，不修改 terminal Run；预算/次数须允许 |
| `execution.evaluate_work_order_completion@1.0` | `WorkOrder / EVALUATE` | `input: CompletionEvaluationInput` | `execution.work_order.evaluate_completion`；Evaluator 解析 ExpectedOutput/InformationRequest，不信任 executionOutcome |
| `execution.evaluate_task_completion@1.0` | `Task / EVALUATE` | `input: CompletionEvaluationInput` | `execution.task.evaluate_completion`；多个 WorkOrder、正式输出和质量条件精确计算 |

## 4. Query Payload 与 Result Contract

```text
RunStateView
├── runRef: ObjectRef<Run>
├── aggregateVersion: NonNegativeInt
├── workOrderRef: ObjectRef<WorkOrder>
├── attemptNumber: PositiveInt
├── status: RunStatus
├── runtimeBinding: RuntimeBinding
├── contextSnapshotRef: SnapshotRef<ProjectContext>
├── leaseExpiresAt?: UtcInstant
├── currentFencingToken: NonNegativeInt
├── resultRef?: ContentAddressedRef<AgentResult>
└── terminationReason?: ReasonCode

InformationRequestView
├── informationRequestRef: ObjectRef<InformationRequest>
├── aggregateVersion: NonNegativeInt
├── definition: InformationRequestDefinition
├── status: InformationRequestStatus
├── deliveryRefs: ContentAddressedRef<DeliveryRecord>[]
├── answerRefs: ContentAddressedRef<InformationAnswer>[]
├── acceptedAnswerRef?: ContentAddressedRef<InformationAnswer>
└── resolutionRef?: ContentAddressedRef<RequestResolution>

UsageAndProvenanceView
├── runRef: ObjectRef<Run>
├── runtimeUsageRef?: ContentAddressedRef<RuntimeUsageRecord>
├── agentDeclaredUsage: ValueEnvelope<CanonicalJson>
├── authoritativeSource: Closed<PROVIDER | RUNTIME_ADAPTER | HARNESS | AGENT_DECLARED | UNAVAILABLE>
├── provenance: CanonicalJson
└── reconciliationStatus: NamespaceCode

TaskBoardItem
├── taskRef: ObjectRef<Task>
├── aggregateVersion: NonNegativeInt
├── title: NonEmptyString
├── status: TaskStatus
├── assignee?: CanonicalJson
├── blockerRefs: TypedReference[]
├── activeWorkOrderRefs: ObjectRef<WorkOrder>[]
└── completionEvaluationRef?: ContentAddressedRef<CompletionEvaluation>
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `execution.get_work_order_contract@1.0` | A | `workOrderRef: ObjectRef<WorkOrder>` | `WorkOrderContract` + `ContentAddressedRef<WorkOrderContract>`；必须精确冻结版本 |
| `execution.get_context_snapshot@1.0` | A | `contextSnapshotRef: SnapshotRef<ProjectContext>` | `ProjectContextContract`；Hash/Scope/Purpose 完整校验 |
| `execution.get_run_state@1.0` | A | `runRef: ObjectRef<Run>` | `RunStateView` |
| `execution.get_agent_result@1.0` | A | `agentResultRef: ContentAddressedRef<AgentResult>` | `AgentResultContract` + 独立 Acceptance Record；不得把 acceptance 写回 Payload |
| `execution.get_information_request@1.0` | A | `informationRequestRef: ObjectRef<InformationRequest>` | `InformationRequestView` |
| `execution.get_usage_and_provenance@1.0` | A | `runRef: ObjectRef<Run>` | `UsageAndProvenanceView`；未知 Usage 不是 0 |
| `execution.get_task_board_slice@1.0` | P | `projectRef: ObjectRef<Project>; statuses: Set<TaskStatus>; assigneeRef?: PrincipalRef; deliveryItemRef?: VersionedRef<DeliveryItem>; page: PageRequest` | `Page<TaskBoardItem>`；Projection 不用于完成判定 |

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `execution.TaskReady@1.0` | `taskRef: ObjectRef<Task>; readinessSnapshotRef: SnapshotRef<TaskReadiness>; readyAt: UtcInstant` |
| `execution.WorkOrderBecameReady@1.0` | `workOrderRef: ObjectRef<WorkOrder>; taskRef: ObjectRef<Task>; workOrderContractRef: ContentAddressedRef<WorkOrderContract>; expiresAt?: UtcInstant` |
| `execution.WorkOrderQueued@1.0` | `workOrderRef: ObjectRef<WorkOrder>; queuePolicyRef: VersionedRef<Policy>; notBefore?: UtcInstant` |
| `execution.ContextSnapshotBuilt@1.0` | `contextSnapshotRef: SnapshotRef<ProjectContext>; workOrderRef: ObjectRef<WorkOrder>; projectionType: NamespaceCode; coverageStatus: NamespaceCode` |
| `execution.RunStarted@1.0` | `runRef: ObjectRef<Run>; workOrderRef: ObjectRef<WorkOrder>; attemptNumber: PositiveInt; runtimeBindingSummary: RuntimeBindingSummary; contextSnapshotRef: SnapshotRef<ProjectContext>` |
| `execution.RunTerminated@1.0` | `runRef: ObjectRef<Run>; workOrderRef: ObjectRef<WorkOrder>; terminalStatus: TerminalRunStatus; terminationReason: ReasonCode; agentResultRef?: ContentAddressedRef<AgentResult>; endedAt: UtcInstant` |
| `execution.AgentResultAccepted@1.0` | `agentResultRef: ContentAddressedRef<AgentResult>; acceptanceRecordRef: ContentAddressedRef<AgentResultAcceptanceRecord>; runRef: ObjectRef<Run>; workOrderRef: ObjectRef<WorkOrder>; businessOutputRefs: TypedReference[]` |
| `execution.InformationRequestOpened@1.0` | `informationRequestRef: ObjectRef<InformationRequest>; workOrderRef?: ObjectRef<WorkOrder>; blocking: boolean; requestedResponder: CanonicalJson; deliveryPurpose: NamespaceCode` |
| `execution.InformationRequestResolved@1.0` | `informationRequestRef: ObjectRef<InformationRequest>; acceptedAnswerRef: ContentAddressedRef<InformationAnswer>; resolutionRef: ContentAddressedRef<RequestResolution>; affectedWorkRefs: TypedReference[]` |
| `execution.WorkOrderCompleted@1.0` | `workOrderRef: ObjectRef<WorkOrder>; evaluationRef: ContentAddressedRef<CompletionEvaluation>; satisfiedOutputRefs: TypedReference[]; completedAt: UtcInstant` |
| `execution.TaskCompleted@1.0` | `taskRef: ObjectRef<Task>; evaluationRef: ContentAddressedRef<CompletionEvaluation>; satisfiedFactRefs: TypedReference[]; completedAt: UtcInstant` |

Event 不携带 Runtime Token、Continuation Secret、完整 Context、Prompt、模型隐藏推理或 Workspace 文件正文。

## 6. 模块错误码

```text
EXECUTION_TASK_NOT_EXECUTABLE
EXECUTION_TASK_DEPENDENCY_CYCLE
EXECUTION_TASK_READINESS_UNSATISFIED
EXECUTION_WORK_ORDER_SCOPE_INVALID
EXECUTION_WORK_ORDER_SPEC_IMMUTABLE
EXECUTION_WORK_ORDER_HASH_MISMATCH
EXECUTION_WORK_ORDER_EXPIRED
EXECUTION_WORK_ORDER_BUDGET_EXHAUSTED
EXECUTION_ACTIVE_RUN_EXISTS
EXECUTION_RUN_ATTEMPT_CONFLICT
EXECUTION_RUN_LEASE_INVALID
EXECUTION_RUN_FENCING_TOKEN_STALE
EXECUTION_TERMINAL_RUN_IMMUTABLE
EXECUTION_FINAL_RESULT_EXISTS
EXECUTION_AGENT_RESULT_RUN_MISMATCH
EXECUTION_AGENT_RESULT_REPLAY_CONFLICT
EXECUTION_AGENT_RESULT_OUTPUT_INVALID
EXECUTION_LATE_RESULT_QUARANTINED
EXECUTION_INFORMATION_REQUEST_UNRESOLVED
EXECUTION_INFORMATION_ANSWER_UNAUTHORIZED
EXECUTION_INFORMATION_ANSWER_CONFLICT
EXECUTION_INFORMATION_ANSWER_SPEC_MISMATCH
EXECUTION_COMPLETION_CRITERIA_UNSATISFIED
```

## 7. 不变量与持久化边界

1. Task、WorkOrder、Run、AgentResult 和 InformationRequest 是独立对象与完成层级。
2. READY WorkOrder Contract、ContextSnapshot 和 AgentResult 均不可变、带 Hash、禁止 latest。
3. 同一 WorkOrder 默认只有一个 active Run claim；Run Context/Capability/fencing 创建后不可替换。
4. 一个 Run 只接受一个 final Result；相同 ID/Hash 幂等，不同 Hash Quarantine。
5. final BLOCKED_INPUT 解决后创建新 ContextSnapshot 和新 Run；只有 final 前的安全 SUSPENDED 控制事件可按 Policy Resume。
6. Agent/Runtime 自报 COMPLETED 不完成 WorkOrder/Task；Completion 只由 Evaluator 和正式 Ref 派生。
7. WorkspaceOutput、Prompt、Session 和飞书消息不满足 ExpectedBusinessOutput。
8. Runtime/Provider Usage 优先于 Agent 自报；缺失为 UNKNOWN/UNAVAILABLE。

## 8. 可人工验收的模块产出

里程碑 `API-TE-01` 的人工产出是可审阅 Fixture：一个冻结 WorkOrder 产生 Run-1，final BLOCKED_INPUT 后经授权答案形成新 ContextSnapshot 和 Run-2；Run-1、Usage、AgentResult 不变；AgentResult 的 scratch DOCX 不满足正式输出，Agent 也不能完成 Task。这里只验证 Contract 链，不代表 Runtime 或飞书闭环已运行。

### 8.1 Runtime Adapter additive proposal

Runtime Adapter v0.1 对照 Domain Model 后识别以下公开写入缺口：

提案覆盖 heartbeat、runtime progress、run suspension、same-run resume、authoritative usage 和 cancellation acknowledgement 六类写操作；完整候选名称与版本只在 Runtime 专项 Contract 第 15.1 节维护，避免审核前被机械计入正式 Catalog。

这些操作是 `USER REVIEW PENDING` 的 additive proposal，不属于本文件当前已审核的 19 Command，也未进入 200 项 Catalog。审核通过后必须统一补齐 payload、授权、并发、错误、Catalog 和测试；审核前不得通过直接写 TaskExecution Repository 绕过 public port。

## 9. 当前状态

- 37 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已由用户审核；Runtime Adapter v0.1 已获用户推进确认并进入 Implementation Milestone Plan，同时保留 6 个尚未纳入基准的 additive Command；
- `contracts/src/operations/task-execution.schema.ts` 已注册所有 37 个操作；PR #10 Review 识别的 8 类 strict Schema 偏差均已修复，`TE-API-S-009` 至 `TE-API-S-016` 回归为 `PASSED`；
- TaskExecution 直接复用权威 `core/work-order/1.0#/$defs/*`；WorkOrder Core Contract 与 `create_work_order` 使用同一组 `$defs`，且 `requestedBy` 统一为 `PrincipalRef`；Core Contract 不再被开放 `CanonicalJson` 降级；
- 注册到 `ContractRegistry` 后所有 37 项 `schemaStatus` 从 `ENVELOPE_ONLY` 提升到 `FULL`；总 Catalog 仍为 200 项；
- 6 个 Runtime Adapter additive Command（heartbeat / progress / suspend / resume / authoritative usage / cancellation ack）仍未进入本模块 Schema 与 200 项 Registry，等待用户审核通过后单独补齐；
- Context Builder、Dispatcher、Runtime、Evaluator、Persistence、Projection 与 Handler 实现均不存在；
- 对应 Unit、Contract、E2E 与人工验收中，Schema fixture 与 Review 修复回归已执行；Handler、Runtime/DB E2E 和人工验收仍为 `NOT RUN`。
