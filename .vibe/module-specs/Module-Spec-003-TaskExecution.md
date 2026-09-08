# Module-Spec-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`FIELD-LEVEL IDL BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / PR #10 SCHEMA REMEDIATION USER REVIEWED 2026-08-17 / PR #12 INTEGRATION GATE PASSED / HANDLER IMPLEMENTATION NOT STARTED`

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

## 10. IM-02 WI-04 持久化切片

TaskExecution owning Schema 独立拥有八张标准事务技术表，并遵守 Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和可用的 masked audit surface。Canonical payload↔hash 强校验、Task Handler、Runtime Dispatcher 与业务 Repository 仍为 `NOT RUN`，不得由 DDL Gate 代替。

## 11. IM-06 技术设计

状态：`TECHNICAL DESIGN APPROVED 2026-09-08 / NOT REGISTERED / NOT IMPLEMENTED`。设计方向已获批准；本节是 #152–#154 经用户批准的未来字段设计基准，批准范围为 [技术决定 TD-01–04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)。第 2–6 节现有 @1.0 定义及当前 201 项 Registry 不变。本节不把 Domain 内部命令名自动视为公开 API。

### 11.1 公共规则与设计操作清单

以下 payload 只列业务字段；Command/Query Envelope 沿用共享 API。CREATE 的新 target identity 由 Envelope 给出；MUTATE 的 expectedAggregateVersion 只在 Envelope，不能复制进 payload。CAS 及 fencing 在实现中采用精确整数，超出可无损公开编码范围时拒绝而非截断。Query 都是 AUTHORITATIVE 且检查 IdentityPolicy、完整 Scope/Purpose，不能使用 Board Projection。

`Hash` 指现有 PayloadHash；`Exact<T>` 指 ContentAddressedRef<T>；`Snap<T>` 指 SnapshotRef<T>。下述新 Ref objectType 须与对应新增 Schema 一并注册；不接受任意 objectType/NamespaceCode。`PolicyRef`/`EvaluatorRef` 均为 exact VersionedRef，不解析 latest。所有时间使用 UtcInstant；ttl 从版本化 Policy 读取，缺失 Policy/不支持版本直接拒绝，不内置默认无限期授权。

| 设计操作 | Target/mode 或 Consistency | Payload | Result.data | Purpose / Actor |
|---|---|---|---|---|
| `execution.create_task@2.0` | Task / CREATE | `projectRef; definition: TaskDefinitionV2; initialAssignee?` | 与 create_task 的 CommandResult 约定相同；targetRef=Task | 复用 `execution.task.create`；Human，或既有 Coordinator Capability 下的 Agent，只创建 DRAFT |
| `execution.get_task_state@1.0` | A | `taskRef: ObjectRef<Task>` | `TaskStateView` | 设计 `execution.task.read`；有 Scope 权限的 Human/Service |
| `execution.get_work_order_draft@1.0` | A | `workOrderRef: ObjectRef<WorkOrder>` | `{draftSnapshotRef: Exact<WorkOrderDraftSnapshot>, draft: WorkOrderDraft, rootAggregateVersion: NonNegativeInt, status: WorkOrderStatus}` | 设计 `execution.work_order.draft.read`；Human/Builder/Validator；只接受 DRAFT Root |
| `execution.build_initial_context_snapshot@1.0` | ContextSnapshot / CREATE | `request: InitialContextBuildRequest` | `{contextSnapshotRef: Snap<ProjectContext>}` | 设计 `execution.context.build.initial`；ContextBuilder Service，代表 Human 授权 Intent |
| `execution.build_task_readiness@1.0` | TaskReadiness / CREATE | `taskRef; taskDefinitionRef: Exact<TaskDefinitionSnapshot>; policyRef; evaluatorRef` | `{readinessSnapshotRef: Snap<TaskReadiness>}` | 设计 `execution.task.readiness.build`；ReadinessBuilder Service |
| `execution.validate_work_order_draft@1.0` | WorkOrderValidation / CREATE | `draftSnapshotRef; candidateContract: WorkOrderContract; policyRef; evaluatorRef` | `{validationSnapshotRef: Snap<WorkOrderValidation>}` | 设计 `execution.work_order.draft.validate`；WorkOrderValidator Service |
| `execution.validate_agent_result@1.0` | AgentResultValidationBundle / CREATE | `agentResultRef; runRef; runtimeAttemptRef; policyRef; evaluatorRef` | `{bundleRef: Exact<AgentResultValidationBundle>, schemaValidationRef, identityValidationRef, runBindingValidationRef, scopeValidationRef, businessOutputValidationRef}` | 设计 `execution.agent_result.validate`；ResultValidator Service；五个 Ref 均 Exact<ValidationResult> |
| `execution.get_execution_judgment@1.0` | A | `judgmentRef: ExecutionJudgmentRef` | `{fact: ExecutionJudgment, useStatus: Closed<USABLE\|STALE\|EXPIRED\|REVOKED>, checkedAt, reasonCodes: ReasonCode[]}` | 设计 `execution.judgment.read`；同 Scope 的 owning Service/授权 Human |
| `execution.record_run_result@1.0` | Run / MUTATE | `agentResultRef: Exact<AgentResult>` | `{runRef,status: RESULT_RECORDED,agentResultRef}` | 设计 `execution.run.result.record`；ResultIngestion Service |
| `execution.finalize_run_from_acceptance@1.0` | Run / MUTATE | `acceptanceRecordRef: Exact<AgentResultAcceptanceRecord>` | `{runRef,status: Closed<SUCCEEDED\|INVALID_RESULT>,acceptanceRecordRef}` | 设计 `execution.run.finalize`；ResultValidator Service |
| `execution.expire_run@1.0` | Run / MUTATE | `reason: Closed<LEASE_EXPIRED\|DEADLINE_EXCEEDED>` | `{runRef,status: Closed<TIMED_OUT\|ABANDONED>,endedAt}` | 设计 `execution.run.expire`；LeaseMonitor Service；不接受调用者 terminalStatus/当前时间 |
| `execution.reconcile_work_order_execution@1.0` | WorkOrder / MUTATE | `triggerRef: TypedReference` | `{workOrderRef,status: WorkOrderStatus}` | 设计 `execution.work_order.reconcile`；WorkExecutionProcess Service；trigger 仅定位，结论从 owning facts 重算 |
| `execution.reconcile_task_execution@1.0` | Task / MUTATE | `triggerRef: TypedReference` | `{taskRef,status: TaskStatus}` | 设计 `execution.task.reconcile`；TaskExecutionProcess Service；不得由此设 COMPLETED |

新操作的注册清单同时包括 Spec 007 的 Runtime Binding Query 和 Spec 002 的 Source Slice capture/exact Query、Resolution Receipt Query；本节仅拥有 execution 命名空间。新 Purpose 不能通过默认 Service 通配授权开放，必须注册到 IdentityPolicy 的版本化 capability/policy 并保留 ActorSnapshot/AuthorizationDecision。

### 11.2 首次 Context 的精确输入

```text
WorkOrderDraftSnapshot
  snapshotId: UuidV7
  workOrderRef: ObjectRef<WorkOrder>
  taskRef: ObjectRef<Task>
  scopeRef: ScopeRef
  draft: WorkOrderDraft
  capturedAt: UtcInstant
  createdBy: PrincipalRef

InitialContextBuildRequest
  draftSnapshotRef: Exact<WorkOrderDraftSnapshot>
  projectionType: NamespaceCode
  purpose: NamespaceCode
  audience: PrincipalRef
  sourceSlices: NonEmptySet<Exact<ContextSourceSlice>>
  builderPolicyRef: VersionedRef<Policy>
  expiresAt?: UtcInstant
```

Hash 在 Ref/持久化完整性列保存，payload 不嵌自身 Hash。Draft Snapshot 的 id 与 Contract/业务版本 id 不混用；Root aggregateVersion 仅用于 CAS。首次请求不携带尚不存在的 workOrderContractRef，不带 answeredInformationRefs；回答后的构建继续使用旧 `ContextBuildRequest@1.0`。首次与后续操作共享同一 ProjectContext v1.0 输出和 `ContextSnapshotBuilt@1.0`，不修改旧事件字段。

合法调用示例（符号均为已持久化的精确 Ref，不是 API 字面占位值）：

```text
WO-1 DRAFT -> Draft DS-1(hash=D1)
EP capture -> Slice SS-1(hash=S1)
build_initial_context_snapshot(DS-1, [SS-1], purpose=P, audience=A, policy=BP-1)
  -> CTX-1(hash=C1); build metadata = {DS-1,SS-1,P,A,BP-1}
validate_work_order_draft(DS-1,candidateContract(context=CTX-1),VP-1,EV-1)
  -> WV-1(subjectContractHash=W1)
freeze_work_order(WO-1,expectedAggregateVersion=1,contractHash=W1,validation=WV-1)
  -> frozen WO-1 Contract W1; DS-1/SS-1/CTX-1 unchanged
```

Builder 成功发布前读锁 WorkOrder Root并核对其仍 DRAFT、当前 Draft pointer==DS-1；Freeze 在 WorkOrder 更新锁内重复核对。只读依赖锁不授权跨 Aggregate 写入。若 Builder 成功后 Draft 被合法换代，CTX-1 作为历史仍存在，Freeze 拒绝它，且 `create_run` 无法使用没有 frozen Contract 认可的 Context。

### 11.3 判断事实形状、生产和消费

```text
JudgmentHeader
  judgmentId: UuidV7
  judgmentKind: Closed<TASK_READINESS|WORK_ORDER_VALIDATION|RESULT_VALIDATION_BUNDLE|VALIDATION_RESULT|COMPLETION_EVALUATION>
  scopeRef: ScopeRef
  subjectRefs: NonEmptySet<TypedReference>
  inputHash: PayloadHash
  policyRef: VersionedRef<Policy>
  evaluatorRef: VersionedRef<Evaluator>
  producedBy: PrincipalRef
  actorSnapshotRef: SnapshotRef<ActorSnapshot>
  authorizationDecisionRef: Exact<AuthorizationDecision>
  evaluatedAt: UtcInstant
  validUntil: UtcInstant
  sourceWatermarks: SourceWatermark[]
  checks: JudgmentCheck[]

JudgmentCheck
  checkCode: NamespaceCode
  outcome: Closed<SATISFIED|UNSATISFIED|UNSUPPORTED|STALE>
  factRefs: TypedReference[]
  reasonCodes: ReasonCode[]
```

ExecutionJudgmentRef 为受支持五类 Ref 的闭集；TaskReadiness/WorkOrderValidation 使用 SnapshotRef，其余使用 Exact Ref。ExecutionJudgment 为 header + 各 kind 的明确 payload，禁止任意 CanonicalJson 或跨类型 ID fallback。Hash 由完整事实 payload 规范化计算；`inputHash` 包含有序/去重规则明确的 subject refs、Policy/Evaluator 与事实清单，不含自身 judgmentId。生效期限不超过输入 AuthorizationDecision/Context/Policy 期限的最小值。

| Kind / 自有 payload | 生产端 | 消费端与必要 guard |
|---|---|---|
| TASK_READINESS：`taskDefinitionRef; dependencyStates[{taskRef,aggregateVersion,completionEvaluationRef?}]; inputRefs; ready:boolean` | build_task_readiness 读取 Task、依赖 Task、自有 blocker 与外部精确输入；循环依赖、未完成必要依赖/输入无权读取不 ready | mark_task_ready 比对 definition pointer、完整依赖集合/版本、当前阻塞、调用动作的独立授权；producer 的授权不能转让给 consumer |
| WORK_ORDER_VALIDATION：`draftSnapshotRef; candidateContractHash; contextSnapshotRef; validation: WorkOrderValidation` | validate_work_order_draft 检查 Core §4.13 全部不变量，candidate 的 requestedBy/issuer 与授权归因相符 | freeze_work_order 重算两类 Hash、校验 Draft/Context metadata、期限、Action/Target/Scope；引用有效但 subject 不匹配仍拒绝 |
| RESULT_VALIDATION_BUNDLE：`agentResultRef; runRef; runtimeAttemptRef; runAggregateVersion; validationRefs[5]` | validate_agent_result 一个 bundle Aggregate 创建五个带 kind、subject、bundleId 的不可变子事实；共享受信观测基线 | accept_agent_result 的五个 Ref 必须来自同 bundle，且 Result/Run/Attempt 精确相同；重新检查当前 Run/lease/fencing/Scope/claim |
| VALIDATION_RESULT：`bundleRefIdentity; validationKind: Closed<SCHEMA\|IDENTITY\|RUN_BINDING\|SCOPE\|BUSINESS_OUTPUT>; valid:boolean` | 子事实 Hash 不引用 bundle 的完整 Hash；bundle 保存子 Ref；避免循环 Hash | 不能混用 kind、其他 Run 的 valid=true、旧 bundle 或拼接五份不同时点结论 |
| COMPLETION_EVALUATION：`targetRef; criteriaHash; factRefs; blockerRefs; criterionResults; outcome: Closed<SATISFIED\|UNSATISFIED>; observedTargetVersion` | 现有 evaluate_work_order_completion/evaluate_task_completion，在 owning Aggregate 事务附属创建 | 满足全部 required 条件才推进 COMPLETED；历史事实保留，useStatus 由当前重新检查派生，不覆盖旧 outcome |

`ready`/`valid` 是生产端输出，不是调用方输入；不满足一般业务条件时允许生成解释性失败判断。身份/权限不合法时拒绝创建，不能利用判断接口探测其他 Scope。`get_execution_judgment` 读取被授权的历史事实并提供当前 useStatus；历史不再可用不是“没有存在过”。未知/错 Hash/错 Scope 的 Ref 返回统一不可用错误；具体内部分类留 Audit。

accept_agent_result 的 caller disposition 必须等于 owning validator 重算结论；REPLAY validation 在接收端基于持久化 final claim重算。身份/绑定/Scope 异常 QUARANTINED；Schema 或合法范围内输出引用失效 REJECTED；五项检查有效则 ACCEPTED。没有足够 ExpectedOutput 的合法 BLOCKED_INPUT/PARTIAL 不因“未完成任务”被拒绝：businessOutputValidation 验证实际声明的输出有效性，完整性由 Completion 独立判断。

### 11.4 Run 控制的精确状态和幂等

- create_run 将 Run 置 CREATED，同时创建本 Run 的模块内 ACTIVE reservation、不可变 Capability binding、精确 lease/fencing；不写 WorkOrder Root。attemptNumber 取该 WorkOrder 历史已提交最大值+1，Claim/attempt/fencing 的并发唯一性由数据库保证。
- start_run 仅对合法 CREATED/STARTING Run 生效：读取 IG exact Binding（Spec 007），要求 SUCCEEDED 且 acknowledgement 与 Run/Contract/Context/Capability/RuntimeBinding 全等、lease/deadline 未到期。在成功事务中记录必要 STARTING→RUNNING transition，不制造 dispatch 前已启动事件；重复同命令返回原结果。
- submit_agent_result 只追加 Result Aggregate 和 Run 维度 final reservation，先锁 Run 并核对 RUNNING、lease、fencing 与绑定；不更新 Run Root。record_run_result 再锁 Run，确认该 Result 是唯一 reservation、仍 RUNNING且未过期，设置 resultRef/RESULT_RECORDED。不同 final identity 即使 Hash 相同也不可替换；相同 identity/hash 走持久化重放。
- cancel 只接受非 terminal 且未 RESULT_RECORDED 的可取消执行态；与 record 争同一 Run 锁。取消获胜后的 Result只能隔离；record 获胜则取消返回状态冲突。finalize 要求 RESULT_RECORDED、resultRef 匹配、Acceptance 通过精确查询、无隔离且 lease/deadline 有效。ACCEPTED→SUCCEEDED；REJECTED/QUARANTINED→INVALID_RESULT。Contract final outcome 不直接决定 WorkOrder 完成。
- expire_run 按服务端时钟重验传入原因：deadline 已到期且不在 CANCELLING 时 TIMED_OUT；lease 已到期或 CANCELLING 到期未确认时 ABANDONED。原因尚不成立则拒绝，不能接受 caller endedAt。terminal transition、Claim RELEASED/EXPIRED、Audit/Receipt/Outbox 同一个 Run 事务提交；terminal 后禁止改成其他 terminal 状态。
- 不同命令键重放 terminal finalize：若 exact result/acceptance/terminal 与已存结论一致，返回无新业务变化的原 terminal 结果；不允许新版本或第二个 RunTerminated。冲突 Ref 返回稳定错误。同键先通过 Command Receipt 重放。
- lease、deadline、fencing、Claim、Result/Acceptance 检查必须在提交点重验；长事务过期不能靠事务开始时间通过。

### 11.5 WorkOrder 与 Task 跨 Aggregate 推进

两个 reconcile Command 只写各自目标 Root/transition/Audit/Receipt/Outbox；不顺带修改 Run、另一 WorkOrder、Task 或 DeliveryItem。triggerRef 只接受同 Scope 精确 Run/Acceptance/InformationRequestResolution/CompletionEvaluation 等本模块已提交事实；不存在、错 target 关联或不支持类型拒绝。后台扫描可用已知持久事实发起同一动作，不能传任意 desiredStatus。

WorkOrder reconcile 的优先规则：COMPLETED/CANCELLED/EXPIRED/FAILED terminal 不改；有效 active Run 存在时 RUNNING；已提交且未解决的 blocking Request 或 final BLOCKED_INPUT 尚未充分解决时 WAITING_INPUT；已授权 schedule_work_order_retry 后保持 RETRY_PENDING，直到 create_run成功再为 RUNNING；Run 已终结且无 blocker 时 COMPLETION_PENDING，交由独立 Evaluator 判定。尚无 Run 的 DRAFT/READY/QUEUED 不凭 reconcile 自动推进。FAILED_EXECUTION 是否可 Retry 由冻结 executionPolicy/maxAttempts/budget决定，不能统一映射 COMPLETED。

Task reconcile 的优先规则：COMPLETED/CANCELLED 保持历史；未解决 blocker→WAITING_INPUT；有正在执行的 WorkOrder→IN_PROGRESS；全部相关 WorkOrder 无 active 且有可评估事实→COMPLETION_PENDING；DRAFT 不通过 reconcile 绕过 mark_task_ready。进入 COMPLETED 仅由 evaluate_task_completion完成；不采用“所有 WorkOrder COMPLETED”作为充分条件。当前没有支持 IN_REVIEW/CHANGES_REQUIRED 的 Human 控制入口，本设计不制造该正向路径。

阻塞判断读取 owning InformationRequest 全量集合，不能信任 caller blockingRefs为空。延迟创建 Request 的窗口由 final BLOCKED_INPUT reservation/Result事实保守阻塞：即便 Request Process 未运行，Completion 也不得提前成功。原 final BLOCKED_INPUT 的 blockers 只有在关联 Request 全部获得有效 Resolution、新 Context及后继 Run 合法结果后才可视为已处理。

### 11.6 WorkOrder Criterion 与 Task v2

WorkOrder 七类 criterionType 和 Core v1.0字段类型不变：inputBindings是NonEmptyString集合，expectedCondition是NonEmptyString，failureDisposition是NamespaceCode。首版Evaluator profile将绑定字符串限定为 `expectedOutput.<outputSlot>`（输出五类，可多个slot）、`informationRequests`（NO_BLOCKING_INFORMATION_REQUEST，恰一个，表示当前WO及Run的完整请求集合）或 `requiredProposals`（REQUIRED_PROPOSAL_PROCESSED，恰一个）。不接受错类型绑定；集合按稳定ID排序，重复criterionId/slot拒绝。expectedCondition 只支持各类型的机械条件，不执行字符串表达式；unknown evaluator/version返回 UNSUPPORTED。required=false 结果仍记录，但不得解除独立安全约束。

| criterionType | 精确事实与 SATISFIED 条件 |
|---|---|
| EXPECTED_OUTPUT_PRESENT | 按 ExpectedOutput.outputSlot 和 cardinality 对已核验 BusinessOutput 分组，零/多于上限失败 |
| OUTPUT_REF_VALID | owning exact Query 返回同 id/hash/Scope，合法生命周期且未撤销；ExternalRef/Workspace path 不满足 |
| OUTPUT_CREATED_BY_WORK_ORDER | owning Artifact Revision provenance 的 WorkOrder/Run/Result Ref 与当前链相同；creationRequired=true 时不能复用无该来源的旧 Revision |
| NO_BLOCKING_INFORMATION_REQUEST | 完整 owning blocker 集合为空或每项都已有效 RESOLVED；EXPIRED、ANSWERED、投递成功不满足；本阶段不支持 cancel override 绕过 |
| OUTPUT_SCHEMA_VALID | 以冻结 ExpectedOutput.schemaRef 验证对应正式对象的版本化 Schema；未注册/不支持即失败 |
| OUTPUT_WITHIN_TARGET_SCOPE | 对照冻结 TargetScope，验证完整 Enterprise/Project/目标关系；不能只比较 projectId |
| REQUIRED_PROPOSAL_PROCESSED | Required proposal 有精确 owning Decision/Command Receipt 和匹配结论；首版仅支持 §11.7 CustomerMaterial 映射，其他类型 UNSUPPORTED |

首版 ExpectedOutput/WorkOrder Criterion 的注册适配器只支持 ContentAddressed ArtifactRevision 和 CustomerMaterial 相关 Receipt；不能从该表推出所有 allowedObjectTypes 已实现。对于已有 Core 模式字段，首版WorkOrder Evaluator的expectedCondition固定字符串 `satisfied`，不解释任意自然语言；既有Core示例的 `one ContentAddressedRef points to a frozen revision` 仅作为EXACTLY_ONE正式Revision条件的显式注册别名，不通用解析。failureDisposition限定既有NamespaceCode形状的 `block_until_satisfied` 或 `require_human_review`，不允许 required 条件失败后标成成功。缺少机械对应的 Core condition仍 UNSUPPORTED，并在计划创建时拒绝可执行冻结。

```text
TaskDefinitionV2 = TaskDefinition except:
  expectedOutputSpec: {schemaVersion: "1.0", outputs: ExpectedOutput[]}
  completionCriteria: {schemaVersion: "1.0", criteria: NonEmptySet<TaskCriterionV1>}

TaskCriterionV1
  criterionId: NamespaceCode
  criterionType: Closed<EXPECTED_OUTPUTS_SATISFIED|NO_BLOCKING_INFORMATION_REQUEST|REQUIRED_WORK_ORDERS_COMPLETED|REVISION_ACCEPTANCE_READY|REVISION_FULLY_APPROVED>
  required: boolean
  evaluatorRef: VersionedRef<Evaluator>
  bindings: one of
    {outputSlots: NonEmptySet<NamespaceCode>}     # output/quality criteria
    {scope: "ALL_CHILD_WORK_ORDERS"}              # required work
    {scope: "TASK_AND_CHILD_WORK_ORDERS"}        # no-blocker criterion
  expectedCondition: {satisfied: true}
  failureDisposition: Closed<BLOCK|REQUIRE_HUMAN_REVIEW>

TaskStateView
  taskRef, aggregateVersion, definitionRef: Exact<TaskDefinitionSnapshot>
  status: TaskStatus
  dependencyTaskRefs, workOrderRefs, blockerRefs
  completionEvaluationRef?: Exact<CompletionEvaluation>
```

bindings 的分支由 criterionType 唯一决定，不接受错分支或未知字段。TaskDefinitionSnapshot 在 Task CREATE 事务创建并不可变；后续定义变更必须另行版本化操作，不允许任意 overwrite。REQUIRED_WORK_ORDERS_COMPLETED 枚举目标Task全部child WorkOrder，集合必须非空且所有成员都由各自有效Completion Evaluation证明；不能凭空集取得成功，也不要求Task创建前WorkOrder已存在。评估时保存精确集合与输入版本，在Task提交锁内重读一致后才能完成。正式输出与无阻塞条件仍需独立满足。READINESS 禁止新 Task 依赖不存在/同 Scope 错 Project/成环 Task。

REVISION_ACCEPTANCE_READY 通过 Artifact exact Revision + Quality 的精确 RevisionAcceptance Query 检查适用 mandatory gates、未失效和 READY；REVISION_FULLY_APPROVED 再检查 exact ApprovalBundle、当前有效 Human Approvals 和未失效链。Quality 的历史 Snapshot Query 不等于当前有效性证明，消费端必须调用 owning current-validity Port；该 Port 明确契约见本设计的 Quality 补充。Task 首版不新增 RELEASED Criterion；Release/DeliveryItem 完成继续由对应 Owner 判断。新 profile 有意比开放 CanonicalJson严格，故使用 @2.0，禁止改变 create_task@1.0 的旧 Schema或重写历史 payload。

### 11.7 首版 InformationRequest 与错误矩阵

设计 `expectedAnswerSpec` profile 为 `execution.answer.customer_material.v1`，字段：`candidateMaterialRef: VersionedRef<CustomerMaterial>; requiredSourceRefs: NonEmptySet<Exact<SourceMaterial>>`。`answerContent` 精确形状为 `{candidateMaterialRef, confirmedMaterialRef: VersionedRef<CustomerMaterial>}`；两者必须属于同一 CustomerMaterial Root/Scope，且经 EP Receipt Query 证明该设计形成该 confirmed version。附件只接受 ACCEPTED SourceMaterial；actual Source selections 必须覆盖请求冻结 requiredSourceRefs。答案不复制客户正文。未知 profile 不接受为可执行 blocking Request。

`resolutionDisposition` 首版为已注册 `execution.resolution.customer_material_confirmed`。domainCommandRefs 必须包含对应 `project.confirm_customer_material@1.0` 的 COMMITTED Receipt；TE 经 Spec 002 窄 Query 读取并验证 candidate/result refs、Source refs、Human actor、精确 AuthorizationDecision 与 Decision provenance。resolver 的独立当前授权和 acceptedAnswer.responder 均要验证；Agent 自采纳拒绝。用户提交的 resolvedAt不能早于答案/领域提交时间，effective resolution 时间以服务端记录；Receipt不能只凭 commandId 或 correlationId匹配。

| 情况 | 设计错误码 / 既有错误 | 业务效果 |
|---|---|---|
| 初次输入 Draft 已变化/不再 DRAFT | `EXECUTION_DRAFT_SNAPSHOT_STALE`（新增） | 无成功 Context/Validation |
| Slice 不存在/错 Hash/Scope/Purpose/Audience | `EXECUTION_CONTEXT_SOURCE_INVALID`（新增） | 拒绝，安全外观统一；内部原因 Audit |
| 判断 Ref 错 kind/subject/policy/issuer/hash | `EXECUTION_JUDGMENT_INVALID`（新增） | 不推进目标 |
| 判断或依赖已过期/变更/撤销 | `EXECUTION_JUDGMENT_STALE`（新增） | 新建判断；不覆盖历史 |
| Criterion/profile/evaluator 不支持 | `EXECUTION_CRITERION_UNSUPPORTED`（新增） | 不 READY/冻结/完成 |
| Run 状态不允许控制动作 | `EXECUTION_RUN_STATE_CONFLICT`（新增） | 不写状态；终态沿用 TERMINAL_RUN_IMMUTABLE |
| 伪造 Attempt 或完整绑定不匹配 | `EXECUTION_RUNTIME_ATTEMPT_INVALID`（新增） | 不 start/accept/finalize |
| Receipt 不匹配/未提交/错误主体 | `EXECUTION_RESOLUTION_RECEIPT_INVALID`（新增） | 不 RESOLVED、不清 blocker |
| lease/fencing/Result 重放/完成条件失败 | 复用 §6 对应稳定错误 | 保留安全审计或隔离，不产生成功副作用 |

本节错误语义已批准，随相应 API 实现注册。测试矩阵见 [Module-Test-003](../module-tests/Module-Test-003-TaskExecution.md#im-06-技术设计验证矩阵)；以上所有新行为均 NOT RUN。

### 11.8 Dispatch binding 与当前完成有效性

设计 `execution.get_run_dispatch_binding@1.0`：A Query；payload `{runRef: ObjectRef<Run>}`；purpose `execution.run.dispatch_binding.read`，只授予 IG Runtime Dispatcher 与 TE Dispatcher/Validator。结果 `{runRef, workOrderRef, workOrderContractRef, contextSnapshotRef, capabilityGrantRef, runtimeBinding: RuntimeBinding, leaseId: UuidV7, fencingToken: NonNegativeInt, leaseExpiresAt: UtcInstant, executionDeadline?: UtcInstant, status: RunStatus, aggregateVersion: NonNegativeInt}`。字段全由 owning Run/Claim/不可变SecurityBinding读取；无有效ACTIVE Claim、跨Scope或过期授权拒绝，不返回Token、secret handle、workspace locator或Continuation secret。此Query弥补旧 RunStateView无法返回Capability/leaseId的缺口，禁止IG直接读TE Schema。

TaskStateView另返回 `completionUseStatus: Closed<NOT_EVALUATED|USABLE|STALE|REVOKED>`。COMPLETED保留历史状态，当前事实失效通过useStatus和immutable Impact事实解释，不从旧完成事件反推当前权限。依赖Task用于新的Readiness时必须重验其Completion Evaluation和当前事实，不能只看到status=COMPLETED即放行。跨模块一致性只保证所记录观测时点，详见设计 §10.1。
