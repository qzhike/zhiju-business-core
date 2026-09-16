# Module-Spec-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`FIELD-LEVEL IDL BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / PR #10 SCHEMA REMEDIATION USER REVIEWED 2026-08-17 / PR #12 INTEGRATION GATE PASSED / IM-06 WI-01 APPLICATION & PERSISTENCE FOUNDATION IMPLEMENTED 2026-09-08 / #165 DRAFT VERSION PINS @1.1 CONTRACT IMPLEMENTED 2026-09-11 / HANDLER IMPLEMENTATION NOT STARTED`

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

InitialWorkOrderDraft
├── same fields as WorkOrderDraft except the versionPins shape
└── versionPins: DraftVersionPins

DraftVersionPins
├── contextBuilderPolicyRef: VersionedRef<Policy>
├── workOrderSchemaRef: VersionedRef
├── skillRefs: Set<VersionedRef>
├── templateRefs: Set<VersionedRef>
├── capabilityPolicyRef: VersionedRef
├── runtimeAdapterContractRef: VersionedRef
├── regulatoryProfileRef?: VersionedRef
└── qualityProfileRef?: VersionedRef

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
| `execution.create_task@1.0` | `Task / CREATE` | `projectRef: ObjectRef<Project>; definition: TaskDefinition; initialAssignee?: CanonicalJson` | `task.execution.create_task`；Agent 仅在 Coordinator Capability 下创建 DRAFT，不能直接 READY |
| `execution.create_task@2.0` | `Task / CREATE` | `projectRef: ObjectRef<zhiju.project.project>; definition: TaskDefinitionV2; initialAssignee?: CanonicalJson` | `execution.task.create`；`expectedOutputSpec`/`completionCriteria` 为注册的 closed shape，不退回任意 CanonicalJson；`inputRefs` 按 §2 为 `TypedReference[]`；Human，或既有 Coordinator Capability 下的 Agent，只创建 DRAFT；合法字段见 §11.6 |
| `execution.mark_task_ready@1.0` | `Task / MUTATE` | `readinessSnapshotRef: SnapshotRef<TaskReadiness>; requestedAt: UtcInstant` | `execution.task.mark_ready`；依赖、输入、权限满足；不接受调用者布尔值 |
| `execution.create_work_order@1.0` | `WorkOrder / CREATE` | `draft: WorkOrderDraft; expiresAt?: UtcInstant` | `task.execution.create_work_order`；Scope 不得超出 Task；Human-only Capability 禁止授予 Agent |
| `execution.create_work_order@1.1` | `WorkOrder / CREATE` | `draft: InitialWorkOrderDraft; expiresAt?: UtcInstant` | `task.execution.create_work_order`；DRAFT 不携带 `projectContextContractRef`；保留 @1.0 合法调用 |
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

这些操作是 `USER REVIEW PENDING` 的 additive proposal，不属于本文件当前已审核的 20 Command，也未进入当前 211 项 Catalog（历史 Compatibility Baseline 为 200 项）。审核通过后必须统一补齐 payload、授权、并发、错误、Catalog 和测试；审核前不得通过直接写 TaskExecution Repository 绕过 public port。

## 9. 当前状态

- 43 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已由用户审核；Runtime Adapter v0.1 已获用户推进确认并进入 Implementation Milestone Plan，同时保留 6 个尚未纳入基准的 additive Command；
- `contracts/src/operations/task-execution.schema.ts` 已注册基线 37 个操作、#158 的 @1.0 Draft/initial Context 两项操作、#165 的三个 @1.1 兼容操作及 #175 的 `execution.create_task@2.0`；PR #10 Review 识别的 8 类 strict Schema 偏差均已修复，Draft/initial Context 正负向 Contract 回归已补齐；
- TaskExecution 直接复用权威 `core/work-order/1.0#/$defs/*`；WorkOrder Core Contract 与 `create_work_order` 使用同一组 `$defs`，且 `requestedBy` 统一为 `PrincipalRef`；Core Contract 不再被开放 `CanonicalJson` 降级；
- 注册到 `ContractRegistry` 后所有 43 项 TaskExecution `schemaStatus` 为 `FULL`；当前全仓 Catalog/Registry 为 213 项（#183 追加两个 IdentityPolicy PolicyVersion 操作，#191/#192 追加两个权威 Query），历史 Compatibility Baseline 仍为 200 项；
- 6 个 Runtime Adapter additive Command（heartbeat / progress / suspend / resume / authoritative usage / cancellation ack）仍未进入本模块 Schema 与当前 211 项 Registry，等待用户审核通过后单独补齐；
- IM-06 WI-01（Issue #151）落地模块自有 application/persistence 基础：`@zhiju/task-execution` 提供 Kysely schema、`createTaskExecutionDatabase`、`withTaskExecutionTransaction`、`executeTaskExecutionCommand`、`TaskExecutionRepository`，单一受信事务上下文建立路径，幂等/CAS/Scope mirror/Process 父子 Scope/Hash 一致性 guard 与 controlled fault 回滚均已落实；可由 disposable PostgreSQL gate 复测；
- Context Builder、Dispatcher、Runtime、Evaluator、Projection 与 Handler 实现均不存在；模块自有业务 Repository 仅暴露 `insertProcessInstance` 给当前技术 Aggregate，不与任何业务表/其他模块 Repository 交叉；
- 对应 Unit、Contract、E2E 与人工验收中，Schema fixture、Review 修复回归与 IM-06 WI-01 持久化 gate 已执行；Handler、Runtime/DB E2E 和人工业务验收仍为 `NOT RUN`。

## 10. IM-02 WI-04 持久化切片

TaskExecution owning Schema 独立拥有八张标准事务技术表，并遵守 Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和可用的 masked audit surface。Canonical payload↔hash 强校验、Task Handler、Runtime Dispatcher 与业务 Repository 仍为 `NOT RUN`，不得由 DDL Gate 代替。

### 10.1 IM-06 WI-01 application/persistence 基础（Issue #151）

本切片只落实已批准 [`task-execution-human-operated.md` §5](../decisions/task-execution-human-operated.md#5-可独立先行的技术基础切片)、[PostgreSQL §17](../high-level-docs/07-postgresql-logical-model-v0.1.md) 与 [RLS 事务上下文](../decisions/rls-transaction-context.md) 的模块内机制，未引入新公开 Contract、未新增业务表、未改变 §1–9 的 @1.0 字段、未修改 200 项 Catalog。

**模块入口**：`@zhiju/task-execution` 暴露 `executeTaskExecutionCommand`（受信事务上下文 → claim Receipt → 执行 body → finalize Receipt + Audit + Outbox + Reference Edge → 提交或回滚）、`assertEnvelopeMatchesContext`、`casProcessInstance`、`appendOutbox`/`appendReferenceEdge`/`appendAudit`/`appendProcessStep`、`TaskExecutionRepository.insertProcessInstance`。CAS 使用字符串/Buffer 在 PostgreSQL bigint 全量程内精确比较与递增，不经 `Number` 转换。

**技术表使用**：仅 `command_receipt`、`outbox_event`、`inbox_message`、`process_instance`、`process_step`、`audit_record`、`reference_edge`、`contract_violation` 八张现有技术表；以 `process_instance.aggregate_version` 作为唯一 CAS 目标；`process_instance` 不再以业务 Root Aggregate 形式出现。

**事务边界**：`withTaskExecutionTransaction` 在同一连接先 `SET LOCAL ROLE platform_context_establisher` → `establish_transaction_context` → `SET LOCAL ROLE task_execution_app` → 调 body；commit/rollback/异常后同一连接新事务不可见旧 Context；并发连接之间不污染；过期 Decision 在 `statement_timestamp()` 重验时被识别为空集。

**写 guard**：
- canonical payload → SHA-256 hash 必须等于列存 `payload_hash`/`request_payload_hash`/`result_payload_hash`（outbox 范围同时由 `task_execution.guard_outbox_scope_mirror` 触发器守护 `enterpriseId`/`projectId` mirror）；
- envelope 字段必须与受信 Context 的 principalId/principalKind/actorSnapshotId/authorizationDecisionId/policySnapshotId/enterpriseId/correlationId/allowedProjectIds 完全一致；
- runner 入口对 envelope 做顶层字段复制并 `Object.freeze`,得到不可变 envelope snapshot;`CAS/Outbox/Reference Edge/Audit/Process Step/finalizeReceipt` 全部从 snapshot 读取字段,body 内对原 envelope 的 mutate 不会改变实际命令目标。`CommandExecution.insertProcessInstance(row)` 是唯一向 `process_instance` 写入的入口;runner 闭包捕获 trx 与 `CommandFacts`,body 不能替换事务、Repository 或事实源。`CommandExecution` 仍按类型公开 `trx` 作为事务句柄供上层 helper 复用,但 helper 内部读到的 envelope 字段全部来自 snapshot,不接受调用方 mutated 输入。
- `CommandFacts` 在 module 实例内由 unique `Symbol()` 标识(不是 `Symbol.for`),`Object.freeze` 后注入 envelope 目标;`TaskExecutionRepository.insertProcessInstance` 通过 `COMMAND_FACTS_RUNTIME_BRAND` 校验同一 symbol 引用并复核 `Object.isFrozen`。注:unique Symbol brand 本身是可枚举属性,JavaScript 语义上可被 spread 复制,故不作为 public proof 单独使用;实际保护来自 `CommandExecution.insertProcessInstance` 的闭包绑定 — body 拿不到 `CommandFacts`,且 `execution` 没有 `commandFacts` 字段,无法在 body 内重新构造等价事实。
- `process_instance` 创建路径逐项校验 `targetType === 'ProcessInstance'`、`processId === commandFacts.targetId`、`enterpriseId === commandFacts.enterpriseId`、`projectId === commandFacts.projectId`（含 NULL）。不匹配抛 `TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH`；同一命令只能 mint 一个 Process Aggregate，不允许在授权集合内换 Process id 或 Project 后落库；
- process_instance 创建主体 `created_by_principal_id` 必须等于 `platform_security.context_principal_id()`，enterprise_id 与 project_id 必须通过 `platform_security.context_allows_enterprise` / `context_allows_project` 检查，否则 `TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH` 或 `TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH`；
- `casProcessInstance` 在 UPDATE 阶段把 `enterprise_id` 与 `project_id` 列入 WHERE（`project_id IS NULL` 处理 envelope 无 projectId 情形），envelope `targetType` 必须为 `ProcessInstance`；若冲突读回发现行 scope 与 envelope 不一致则抛 `COMMAND_TARGET_MISMATCH`，拒绝留下任何成功的 Process 推进、Audit、Outbox 或 Reference Edge；跨 Enterprise 行由 RLS 不可见时返回 `NOT_FOUND`（不强行暴露 scope mismatch，保持既有安全语义）；
- outbox/Reference Edge/Process Step 的 owner/processId/process parent 必须与 envelope targetType/targetId 相符；
- Process Step 的 enterprise_id/project_id 由 `task_execution.guard_process_step_scope` 触发器与父 Process 镜像；
- 同 `idempotency_scope + idempotency_key` 顺序/并发重放均通过数据库唯一约束与 `ON CONFLICT DO NOTHING` 裁决；异 Hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` 并 DENIED 审计，不覆盖原 Receipt/结果。

**显式不做**：
- 不复制 IdentityPolicy/AuthorizationDecision 验证：Context 由调用方提供的可信快照带入；本模块只校验 envelope 与 Context 一致，不裁决 AuthorizationDecision 真实性；
- 不开放跨模块 Repository 读写：仅 `task_execution.*` 表，仅 `task_execution_app` 角色；
- 不引入新公开 Command/Query/Event，不修改 §2–6、§11 已批准字段，不复用 `Runtime-Adapter` 6 项 additive proposal；
- 不进入业务 Handler、Runtime Driver、Completion 评估、Production、Provider/Feishu/CLI Runtime 验证、跨模块业务 E2E 与独立人工业务验收（保持 `NOT RUN`）。

**Verify**：`tests/persistence/task-execution-command-runner.test.ts` 在 `vibe verify full` 的 disposable PostgreSQL gate 内运行；聚焦 Contract 测试在 `pnpm test`。`pnpm contracts:check` 检查当前 211 项 Catalog，并保留历史 200 项 Compatibility Baseline。

## 11. IM-06 技术设计

状态：`TECHNICAL DESIGN APPROVED 2026-09-08 / EXPIRY ADDENDUM APPROVED 2026-09-09 / CONTRACT SCHEMA AND REGISTRY IMPLEMENTED 2026-09-10 / BUILDER POLICY BINDING CONTRACT IMPLEMENTED 2026-09-11 / #165 DRAFT VERSION PINS @1.1 CONTRACT IMPLEMENTED 2026-09-11 / #167 INITIAL CONTEXT RESULT CONTRACT IMPLEMENTED 2026-09-12 / #175 TASK V2 CREATION CONTRACT IMPLEMENTED 2026-09-12 / #176 POLICY/EVALUATOR RESOLUTION APPROVED 2026-09-12 DESIGN VERIFIED / #183 POLICYVERSION STATIC CONTRACT REGISTERED 2026-09-13 / HANDLER NOT IMPLEMENTED`。设计方向已获批准；本节是 #152–#154 经用户批准的字段设计基准，批准范围为 [技术决定 TD-01–04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)。第 2–6 节既有 @1.0 定义及历史 200 项 Compatibility Baseline 不变；当前全仓 Registry 为 213 项。本节不把 Domain 内部命令名自动视为公开 API。

### 11.1 公共规则与设计操作清单

以下 payload 只列业务字段；Command/Query Envelope 沿用共享 API。CREATE 的新 target identity 由 Envelope 给出；MUTATE 的 expectedAggregateVersion 只在 Envelope，不能复制进 payload。CAS 及 fencing 在实现中采用精确整数，超出可无损公开编码范围时拒绝而非截断。Query 都是 AUTHORITATIVE 且检查 IdentityPolicy、完整 Scope/Purpose，不能使用 Board Projection。

`Hash` 指现有 PayloadHash；`Exact<T>` 指 ContentAddressedRef<T>；`Snap<T>` 指 SnapshotRef<T>。下述新 Ref objectType 须与对应新增 Schema 一并注册；不接受任意 objectType/NamespaceCode。`PolicyRef`/`EvaluatorRef` 均为 exact VersionedRef，不解析 latest。所有时间使用 UtcInstant；ttl 从版本化 Policy 读取，缺失 Policy/不支持版本直接拒绝，不内置默认无限期授权。

| 设计操作 | Target/mode 或 Consistency | Payload | Result.data | Purpose / Actor |
|---|---|---|---|---|
| `execution.create_task@2.0` | Task / CREATE | `projectRef; definition: TaskDefinitionV2; initialAssignee?` | 与 create_task 的 CommandResult 约定相同；targetRef=Task | 复用 `execution.task.create`；Human，或既有 Coordinator Capability 下的 Agent，只创建 DRAFT |
| `execution.get_task_state@1.0` | A | `taskRef: ObjectRef<Task>` | `TaskStateView` | 设计 `execution.task.read`；有 Scope 权限的 Human/Service |
| `execution.get_work_order_draft@1.0` | A | `workOrderRef: ObjectRef<WorkOrder>` | `{draftSnapshotRef: Exact<WorkOrderDraftSnapshot>, draft: WorkOrderDraft, expiresAt?: UtcInstant, rootAggregateVersion: NonNegativeInt, status: WorkOrderStatus}` | 设计 `execution.work_order.draft.read`；Human/Builder/Validator；只接受 DRAFT Root |
| `execution.get_work_order_draft@1.1` | A | `workOrderRef: ObjectRef<WorkOrder>` | `{draftSnapshotRef: Exact<WorkOrderDraftSnapshot>, draft: InitialWorkOrderDraft, expiresAt?: UtcInstant, rootAggregateVersion: NonNegativeInt, status: WorkOrderStatus}` | 设计 `execution.work_order.draft.read`；返回不含 `projectContextContractRef` 的 DRAFT |
| `execution.build_initial_context_snapshot@1.0` | ContextSnapshot / CREATE | `request: InitialContextBuildRequest` | `{contextSnapshotRef: Snap<ProjectContext>}` | 设计 `execution.context.build.initial`；ContextBuilder Service，代表 Human 授权 Intent |
| `execution.build_initial_context_snapshot@1.1` | ContextSnapshot / CREATE | `request: InitialContextBuildRequest` | `{contextSnapshotRef: Snap<ProjectContext>}` | 设计 `execution.context.build.initial`；DRAFT 分支不接收 frozen Contract Ref |
| `execution.build_task_readiness@1.0` | TaskReadiness / CREATE | `taskRef; taskDefinitionRef: Exact<TaskDefinitionSnapshot>; policyRef; evaluatorRef` | `{readinessSnapshotRef: Snap<TaskReadiness>}` | 设计 `execution.task.readiness.build`；ReadinessBuilder Service；Policy/Evaluator profile 与消费时重验见 §11.9 |
| `execution.validate_work_order_draft@1.0` | WorkOrderValidation / CREATE | `draftSnapshotRef; candidateContract: WorkOrderContract; policyRef; evaluatorRef` | `{validationSnapshotRef: Snap<WorkOrderValidation>}` | 设计 `execution.work_order.draft.validate`；WorkOrderValidator Service；Policy/Evaluator profile 与消费时重验见 §11.9 |
| `execution.validate_agent_result@1.0` | AgentResultValidationBundle / CREATE | `agentResultRef; runRef; runtimeAttemptRef; policyRef; evaluatorRef` | `{bundleRef: Exact<AgentResultValidationBundle>, schemaValidationRef, identityValidationRef, runBindingValidationRef, scopeValidationRef, businessOutputValidationRef}` | 设计 `execution.agent_result.validate`；ResultValidator Service；五个 Ref 均 Exact<ValidationResult> |
| `execution.get_execution_judgment@1.0` | A | `judgmentRef: ExecutionJudgmentRef` | `{fact: ExecutionJudgment, useStatus: Closed<USABLE\|STALE\|EXPIRED\|REVOKED>, checkedAt, reasonCodes: ReasonCode[]}` | 设计 `execution.judgment.read`；同 Scope 的 owning Service/授权 Human |
| `execution.record_run_result@1.0` | Run / MUTATE | `agentResultRef: Exact<AgentResult>` | `{runRef,status: RESULT_RECORDED,agentResultRef}` | 设计 `execution.run.result.record`；ResultIngestion Service |
| `execution.finalize_run_from_acceptance@1.0` | Run / MUTATE | `acceptanceRecordRef: Exact<AgentResultAcceptanceRecord>` | `{runRef,status: Closed<SUCCEEDED\|INVALID_RESULT>,acceptanceRecordRef}` | 设计 `execution.run.finalize`；ResultValidator Service |
| `execution.expire_run@1.0` | Run / MUTATE | `reason: Closed<LEASE_EXPIRED\|DEADLINE_EXCEEDED>` | `{runRef,status: Closed<TIMED_OUT\|ABANDONED>,endedAt}` | 设计 `execution.run.expire`；LeaseMonitor Service；不接受调用者 terminalStatus/当前时间 |
| `execution.reconcile_work_order_execution@1.0` | WorkOrder / MUTATE | `triggerRef: TypedReference` | `{workOrderRef,status: WorkOrderStatus}` | 设计 `execution.work_order.reconcile`；WorkExecutionProcess Service；trigger 仅定位，结论从 owning facts 重算 |
| `execution.reconcile_task_execution@1.0` | Task / MUTATE | `triggerRef: TypedReference` | `{taskRef,status: TaskStatus}` | 设计 `execution.task.reconcile`；TaskExecutionProcess Service；不得由此设 COMPLETED |

新操作的注册清单同时包括 Spec 007 的 Runtime Binding Query 和 Spec 002 的 Source Slice capture/exact Query、Resolution Receipt Query；本节仅拥有 execution 命名空间。新 Purpose 不能通过默认 Service 通配授权开放，必须注册到 IdentityPolicy 的版本化 capability/policy 并保留 ActorSnapshot/AuthorizationDecision。其中 `policyRef`/`evaluatorRef` 的解析来源、首版 profile、版本注册与消费时重验由 §11.9 固定（#176 已批准设计，尚未实现）。

### 11.2 首次 Context 的精确输入

```text
WorkOrderDraftSnapshot
  snapshotId: UuidV7
  workOrderRef: ObjectRef<WorkOrder>
  taskRef: ObjectRef<Task>
  scopeRef: ScopeRef
  draft: WorkOrderDraft
  expiresAt?: UtcInstant
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

Hash 在 Ref/持久化完整性列保存，payload 不嵌自身 Hash。Draft Snapshot 的 id 与 Contract/业务版本 id 不混用；Root aggregateVersion 仅用于 CAS。首次 @1.1 请求不携带尚不存在的 workOrderContractRef，不带 answeredInformationRefs；回答后的构建继续使用旧 `ContextBuildRequest@1.0`。首次与后续操作共享同一 ProjectContext v1.0 输出和 `ContextSnapshotBuilt@1.0`，不修改旧事件字段；既有 @1.0 合法调用保持原字段形状。

合法调用示例（符号均为已持久化的精确 Ref，不是 API 字面占位值）：

```text
WO-1 DRAFT -> Draft DS-1(hash=D1)
EP capture -> Slice SS-1(hash=S1)
build_initial_context_snapshot(DS-1, [SS-1], purpose=P, audience=A, policy=BP-1)
  -> CTX-1(hash=C1); build metadata = {DS-1,SS-1,P,A,BP-1}
validate_work_order_draft(DS-1,candidateContract(context=CTX-1),VP-1,EV-1)
  -> WV-1(subjectContractHash=W1)
freeze_work_order(target=WO-1,expectedAggregateVersion=V,
  workOrderContract=candidateContract,validationSnapshotRef=WV-1,
  specificationHash=candidateContract.specificationHash)
  -> frozen WO-1 Contract W1; DS-1/SS-1/CTX-1 unchanged
```

`V` 是 owning Query 返回的当前 Root CAS 版本，不能从 DS-1 的 identity 推导或硬编码为 1；`W1` 是完整 Contract 的 payload Hash，不是 specificationHash。示例中的 target/version 属于 Envelope，其余三个字段才是现有 Freeze payload。Validator 与 Freeze 必须接收同一完整 candidate，包括签发元数据；验证后重新生成 issuedAt、Contract identity 或其他字段会改变 candidate Hash，必须重新验证。

Builder 成功发布前读锁 WorkOrder Root并核对其仍 DRAFT、当前 Draft pointer==DS-1；Freeze 在 WorkOrder 更新锁内重复核对。只读依赖锁不授权跨 Aggregate 写入。若 Builder 成功后 Draft 被合法换代，CTX-1 作为历史仍存在，Freeze 拒绝它，且 `create_run` 无法使用没有 frozen Contract 认可的 Context。

#### 11.2.1 字段映射与引用校验

本节展开 TD-01 已批准的精确绑定，不新增操作或改变 Core v1.0。首次请求的六个必填字段保持 §11.2 定义；只有 expiresAt 可选，其有效期组合规则见 §11.2.5.4。`projectionType` 虽以 NamespaceCode 传输，仍须满足 Core §3.4 已注册集合，不能以未知值回退。空 sourceSlices、未注册 objectType、latest 或缺 Hash 在 Schema/引用校验阶段拒绝。

| 输入 / 输出字段 | 唯一来源与消费约束 |
|---|---|
| Draft snapshotId / hash | create_work_order 同事务持久化的不可变事实；按 exact id + 完整 canonical payload Hash 解引用，不能把 Root aggregateVersion 当 snapshotId。比较 Root current pointer 的 identity/hash，而非只比较 WorkOrder id |
| Draft workOrderRef / taskRef / scopeRef | 与已存在 Root、Root 所属 Task 及 Envelope Enterprise/Project 完整一致；draft.taskRef 与 Snapshot taskRef 一致。不存在、错 Hash、错 parent 或无权读取不得继续组装 |
| ProjectContext projectRef / enterpriseRef / workContext | 从已核验 Scope 和已提交 Task/WorkOrder 推导；workContext.taskRef/workOrderRef 及 projection.requestedByWorkOrderRef（若出现）必须指向同一输入 Root，不引用未来 Contract |
| ProjectContext projection / sourceManifest / items | projection 与请求 purpose/audience/builderPolicyRef 一致；每个 Slice 同 Scope、purpose、audience 且 owning Query 返回 USABLE。Builder 再按 Draft targetScope、inputRefs.permittedUse/contentAccessMode、Policy 裁剪，保留 omission/redaction/coverage；Manifest 只列实际采用的精确来源 |
| Candidate workOrderRef / taskRef / projectRef / requestedBy | 来自上述 Root/Scope 与 draft.requestedBy；不能借 candidate 替换请求主体。header.issuedBy、issuedAt 等签发归因按受信 Validator/签发规则校验，不由 Ref 的存在性推导授权 |
| Candidate objective 至 versionPins | draft 中对应字段逐字段相等；其中 contextSnapshotRef 是唯一由本次已提交 Context 补入的执行规范字段。不得在组装时默认增加 Capability、修改 Objective/Scope 或补写未知策略 |
| Candidate expiresAt | 与创建时保存在 Root 和 exact Draft Snapshot 的期限存在性和值完全一致；Query 返回同一值。映射、Hash 范围与到期判断见 §11.2.4；不得以签发元数据为由省略或改变期限 |
| Candidate payloadHash / specificationHash | 分别按 Core §2、§4.3/4.13 的规范范围计算；contextSnapshotRef 属于冻结规范。Validation 的 candidateContractHash、Context Ref 与实际提交 candidate 一致；Hash 正确不能替代引用存在性、授权或可执行性判断 |

Build metadata 是 ContextSnapshot 的不可变附属绑定，逻辑字段由 PostgreSQL §33 拥有，不扩展 ProjectContext v1.0 payload。INITIAL 绑定唯一 Draft Ref，不存在 frozen Contract Ref；FROZEN 绑定唯一原 Contract Ref，不使用 Draft Ref。两者均保存实际 sourceSlices、purpose/audience/builderPolicyRef 与输出 Snapshot 的精确关联；FROZEN 还保存原请求 answeredInformationRefs（可为空）。成功 Snapshot 与 metadata/Receipt/Reference Edge/Outbox 同事务提交，不能出现可读成功 Snapshot 却找不到输入绑定。

#### 11.2.2 失败与恢复矩阵

表中错误复用共享 API 及 §11.7；诊断原因保留在受权限控制的 Audit，不以不同外观泄露其他 Scope 对象是否存在。所有消费动作有独立当前授权，Builder/Validator 曾获授权不等于 Freeze/Run 获授权。

| 输入、竞争或中断位置 | 可判定结果 | 恢复与禁止效果 |
|---|---|---|
| Draft id 不存在、Hash 不符、parent/Scope 不符 | `REFERENCE_INVALID`；Envelope 授权/Scope 先按共享规则拒绝 | 无成功 Snapshot/Validation；重新获取合法 exact Ref，不尝试 latest 或占位 Hash |
| 已合法解析 Draft，但 Root 非 DRAFT 或 current pointer 不同 | `EXECUTION_DRAFT_SNAPSHOT_STALE` | Builder 发布前拒绝；Freeze 前出现则保留旧 Context 为历史，重新读取当前合法输入。不得引入未批准的 DRAFT 编辑入口 |
| Slice 不存在、动态 View 冒充 Slice、错 Hash/Scope/Purpose/Audience、非 USABLE | `EXECUTION_CONTEXT_SOURCE_INVALID` | 无成功 Context；经 EP owning capture/query 获取新合法输入，不能修改旧 Slice |
| 当前 Decision 过期/撤销，或 Builder Policy 无法解析 | 共享授权错误 / `REFERENCE_INVALID`；暂时不可查询为 `DEPENDENCY_UNAVAILABLE` | fail closed；不采用默认永久有效 Policy，不将依赖不可用当作空内容继续 |
| Context 来源绑定与 candidate/Draft 不符，或判断 subject/Hash 不符 | `EXECUTION_JUDGMENT_INVALID`；过期/输入失效为 `EXECUTION_JUDGMENT_STALE` | 不 READY；判断内容与 executable/coverage 结论由 §11.3 拥有，本项不定义放行捷径 |
| Root/Snapshot/Query 期限镜像不符；candidate 期限省略或改变；消费前跨过期限 | 按 §11.2.4 分别使用 `REFERENCE_INVALID`、`EXECUTION_JUDGMENT_INVALID` 或对应到期错误 | 不通过冻结；创建缺省不得冻结时补值，创建有期限不得省略/提前/延后；历史与重放不重新授权 |
| 两个 Freeze 使用相同 expectedAggregateVersion | 仅一个 CAS 成功，另一为 `AGGREGATE_VERSION_CONFLICT`；已不允许转换时为 `AGGREGATE_STATE_NOT_ALLOWED` | 只保存一个 frozen Contract；失败请求不能覆盖赢家的 Context/Contract |
| Slice 已提交，Context 提交前失败 | Slice 保留；Context 事务全部回滚，无成功 Receipt/Event | 重放原 capture 得到原 Slice；仍有效时重试 build，失效时新 capture/new key；不跨模块补偿删除已提交 Slice |
| Context 已提交、响应丢失或 Validation/Freeze 前中断 | 原 Snapshot/metadata/成功 Receipt 保留，WorkOrder 仍按实际提交状态 | 同键同输入返回原结果；后续消费重新验资格。重放不把过期/已失配 Snapshot 重新变成可执行 |
| Validation 已提交但 Freeze 失败；Freeze 提交后响应丢失 | 前者保留不可变判断但不 READY；后者 Contract/READY/成功技术事实已原子提交 | 前者在判断仍有效且输入相同条件下重试；后者同键返回原结果，不再次签发 Contract |
| capture/build/validate/freeze 同键异 payload Hash | `IDEMPOTENCY_PAYLOAD_CONFLICT` | 不调用业务 Handler、不生成第二份成功事实；变更输入必须新 key，新的不可变输出使用新 identity |

跨模块来源的当前授权/生命周期采用[设计决定 §10.1](../decisions/task-execution-human-operated.md#101-判断顺序与时效)所述观测时点一致性：消费前读 owning Query 并记录版本/watermark，后续撤销经失效/Impact 处理。只读 WorkOrder 行锁解决本模块 DRAFT 竞态，不宣称锁住 EP 来源或建立分布式原子提交。

#### 11.2.3 冻结后 Retry 的独立绑定

冻结后仍使用 §2 的完整 ContextBuildRequest：workOrderRef、workOrderContractRef、projectionType、purpose、audience、非空 sourceSlices、answeredInformationRefs、builderPolicyRef 均必填，expiresAt 可选；不能把首次入口当作无 Contract 的 Retry 旁路。原 Contract 必须可精确读回，且 Ref 属于该 WorkOrder 的 frozen binding。新 Snapshot 需重新校验授权、来源、期限及原冻结 Scope/Capability；答案和 Receipt 的采纳判断由 #154 对应 §11.7 拥有。

`Context-2` 的 FROZEN metadata 指向原 Contract，可使用新 Slice/已解决答案；`Run-2.creation.contextSnapshotRef` 指向 Context-2，`Run-2.creation.workOrderContractRef` 仍指向原 Contract。原 Contract.contextSnapshotRef 始终为 Context-1，Context-1 的 payload/hash 和 Run-1 的固定绑定不变。不能要求 Retry Context 等于 Contract.contextSnapshotRef，否则合法新输入无法进入 Run；也不能据此允许任意 Context，必须核验新 Snapshot 的原 Contract 绑定。到期 Contract 不得创建新 Run；改变 Objective/Scope/Completion 仍须新 WorkOrder。

#### 11.2.4 创建期限与冻结期限

状态：`APPROVED 2026-09-09 / CONTRACT SCHEMA REGISTERED 2026-09-10 / HANDLER NOT IMPLEMENTED`，依据[期限补充决定](../decisions/task-execution-human-operated.md#84-td-01-创建期限与冻结期限补充)。本节是本轮期限字段和错误行为的唯一 API 权威。

1. `create_work_order@1.0` 的 payload 形状不变。可选 expiresAt 的“未提供”或精确 UtcInstant 原样保存于 WorkOrder Root，并在同事务创建的 WorkOrderDraftSnapshot 顶层保存 `expiresAt?: UtcInstant`；不把它塞入既有 WorkOrderDraft。Snapshot 的完整 payload Hash 包含该字段的存在性和值，缺省不序列化为 null。创建时若提供期限，服务端当前时间必须严格早于期限，否则以现有 `API_VALUE_INVALID` 拒绝，不创建 Root/Receipt 成功事实。
2. 新 `get_work_order_draft@1.0` Result.data 返回 `expiresAt?: UtcInstant`，其存在性和值必须与 exact Snapshot、Root 一致。Root 与 Snapshot 不一致属于 `REFERENCE_INVALID`，不能信任 Query 调用者提供的期限。已过期但仍为 DRAFT 的 Root 可在当前读取授权下返回历史事实；返回 DRAFT 不意味着可以继续构建或冻结。
3. candidate Contract.expiresAt 必须与创建期限的存在性和值完全一致：创建有 T0，则省略、更早或更晚均拒绝；创建未提供，则 candidate 也必须省略。该字段按既有规则进入完整 Contract payloadHash，不改变 specificationHash 的覆盖范围；不能以 specificationHash 相同证明期限未变。Validator 产生解释性不通过判断，Freeze 用 `EXECUTION_JUDGMENT_INVALID` 拒绝期限映射不符的输入。改变期限须新建 WorkOrder，本次不新增 DRAFT 编辑或延长期限 API。
4. 初次 Builder 发布、Validator 产出可用判断及 Freeze 提交前，均读取上述 exact 期限并以受信服务端当前时间重验；`now >= expiresAt` 即不可用，不能使用 caller 时间或事务开始时间绕过。Builder 无成功 Snapshot，Validator 不得产生可执行通过判断，Freeze 不进入 READY；期限已过时 Builder 使用 `AGGREGATE_STATE_NOT_ALLOWED`，Validator 和 Freeze 使用 `EXECUTION_JUDGMENT_STALE` 拒绝新消费。判断 validUntil 不得晚于已提供的 WorkOrder 期限，仍受其他输入/授权/Policy 更早期限限制。已提交历史不删除，重放原成功 Receipt 不重新赋予执行资格。
5. 冻结后 Root 与 Contract 的 expiresAt 仍是同一不可变期限，WorkOrderBecameReady 事件中的可选 expiresAt 必须一致；FROZEN Context 构建、queue、create_run 和 start_run 都要检查 Root/Contract 一致且未到期，不能只看滞后的 Root status。期限映射错误为 `REFERENCE_INVALID`，已到期为 `AGGREGATE_STATE_NOT_ALLOWED`。尚未到期也不能越过 Context、Decision、Capability、lease/deadline 的独立期限。已经 RUNNING 的 Run 如何收尾仍由 #153 的既有 lease/deadline 与终态规则拥有；本项不新增到期强杀或跨 Root 同步状态转换。
6. 创建未提供 expiresAt 只表示没有 caller 指定的 WorkOrder 绝对到期时间，不默认生成期限，也不代表无限授权；既有版本化 Policy、Decision、Context、Capability 和 Run lease/deadline 检查继续生效。Context 请求自身的可选 expiresAt 不替代或改写 WorkOrder 期限；首次 Context 的有效期组合、effective 值写入与消费重验由 §11.2.5.4 拥有。其他已注册旧 @1.0 Schema 和历史 Compatibility Baseline 不变；此选择是待实施业务语义的明确化，不能以旧 Schema 接受 candidate 为理由免除跨字段校验。

#### 11.2.5 Context Builder Policy ref 绑定

首次入口与冻结候选使用同一 Builder Policy 身份链，但不把 Hash 自引用塞入通用 `VersionedRef`。新入口的 `builderPolicyRef` 必须是 `VersionedRef<Policy>` 且 `objectType=zhiju.identity.policy`；ProjectContext projection 和 WorkOrder `versionPins.contextBuilderPolicyRef` 在 WI-02 新链中保存同一 `objectType/objectId/versionId/scope`。旧 Core v1.0 的结构 Schema 为历史读回保留 `zhiju.context.policy`，但该 legacy 值不能通过本节的 WI-02 绑定校验。

Context build metadata 的 Builder Policy binding 形状为：

```text
ContextBuilderPolicyBinding
├── builderPolicyRef: VersionedRef<Policy>  // exact zhiju.identity.policy
├── contentHash: ContentHash                 // IdentityPolicy snapshot payload hash
├── effectiveFrom: UtcInstant
└── supersededAt?: UtcInstant
```

`contentHash/effectiveFrom/supersededAt` 来自 IdentityPolicy 的 exact Policy snapshot 解析，不由 caller 自报，也不由 `objectId/versionId` 推导。成功 metadata 与 ContextSnapshot 同事务保存；metadata 不扩展 ProjectContext v1.0 payload，也不改变旧 frozen-build 请求的字段必填语义。

#### 11.2.5.1 绑定来源与消费位置

四个位置的唯一来源和约束如下：

| 位置 | 保存字段 | 必须满足 |
|---|---|---|
| `InitialContextBuildRequest.builderPolicyRef` | exact `zhiju.identity.policy` VersionedRef | 缺失、legacy/任意 namespace、错 kind 或 Scope 先于组装拒绝 |
| `ProjectContext.projection.builderPolicyRef` | 与请求同一 PolicyRef | 候选组装只复制已校验 ref，不从 Draft、source slice 或默认值重选 Policy |
| `context_snapshot_build` metadata | PolicyRef + contentHash + validity window | metadata 与 Snapshot 同事务；Hash/有效期是本次解析的不可变观察，不接受异 Hash 覆盖 |
| Frozen WorkOrder `versionPins.contextBuilderPolicyRef` | 与 projection/request 同一 PolicyRef | Validator 与 Freeze 都重新解析当前 Policy，并比较 ref、Hash、有效期后才允许候选进入冻结链 |

`VersionedRef` 的版本字段使用 `versionId`；“version”在本节不允许用显示 label、latest 或 current 替代。Scope 比较包含 enterpriseId/projectId 的有无和值，contentHash 比较 algorithm/digest/canonicalizationVersion 的全部字段。

#### 11.2.5.2 校验顺序与 fail-closed 矩阵

候选组装、Validator 和 Freeze 各自消费前必须调用同一绑定校验，并以当前受信服务时间检查 `effectiveFrom <= now < supersededAt`（无 `supersededAt` 表示未被该 Policy snapshot supersede）：

| 反例 | 结果 | 禁止效果 |
|---|---|---|
| 任一 ref/metadata/resolved Policy 缺失 | `REFERENCE_INVALID` / 绑定校验 invalid | 不猜默认 Policy、不生成部分 metadata、不发布 Snapshot |
| objectType 为 `zhiju.context.policy`、`identity.policy` 或其他 namespace | `REFERENCE_INVALID` / `POLICY_OBJECT_TYPE_INVALID` | 新 WI-02 入口不得生成未注册或任意 namespace；legacy 只可走兼容读回 |
| objectId、versionId、kind 或 Scope 任一不等 | `EXECUTION_JUDGMENT_INVALID` / `POLICY_REF_MISMATCH` | 不把 P1 构建结果组装成 P2 Contract，不进入 Validator/Freeze |
| 同一 Policy key 的 contentHash 不等，或 metadata Hash 与 IdentityPolicy 解析不等 | `EXECUTION_JUDGMENT_INVALID` / `POLICY_CONTENT_HASH_MISMATCH` | 不采用 caller Hash，不覆盖已提交 metadata，不签发候选 Contract |
| effectiveFrom 尚未到达、supersededAt 已到达或各位置有效期不等 | `EXECUTION_JUDGMENT_STALE` / `POLICY_NOT_EFFECTIVE`、`POLICY_EXPIRED` 或 `POLICY_VALIDITY_MISMATCH` | fail closed；不把过期 Policy 当永久有效，不以历史成功 Receipt 重新赋予消费资格 |
| ref 结构通过但 IdentityPolicy 对象不存在/不可查询/当前授权失效 | `REFERENCE_INVALID` 或 `DEPENDENCY_UNAVAILABLE` | Schema 通过不等于对象存在或授权通过；无成功 Snapshot/Validation/READY |

以上校验只拥有跨字段绑定和 metadata 观察一致性；IdentityPolicy 对象存在性、Scope 权威归属、当前授权与业务状态分别由 owning Query/Handler 负责。有效期字符串先按 UTC 组件逐项校验再参与比较：不存在的日历日期（如 `2026-02-30`、非闰年 `2026-02-29`）与越界时刻按畸形值 fail closed，不能依赖运行时的日期归一化把非法输入折算成另一个真实时刻。§11.2.5.4 的期限上界共享同一解析规则。真实 Handler、PostgreSQL 业务链和生产/人工验收在本阶段仍为 `NOT RUN`。

#### 11.2.5.3 Initial Context CommandResult 与 canonical SnapshotRef

状态：`APPROVED 2026-09-10 / RESULT SCHEMA, REGISTRY AND GENERATED TYPES IMPLEMENTED 2026-09-12 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。依据 [#167](https://github.com/qzhike/zhiju-business-core/issues/167) 与[决定 §8.8](../decisions/task-execution-human-operated.md#88-167-initial-context-result-与-canonical-snapshotref)。本节是首次 Context 命令返回引用的唯一 API 权威，不改变旧 `build_context_snapshot@1.0`。

`execution.build_initial_context_snapshot@1.0` 与 `@1.1` 注册可执行 Result Schema，描述 operation-specific CommandResult data：

```text
InitialContextCommandResult
└── contextSnapshotRef: SnapshotRef<ProjectContextContract>
    ├── kind: Closed<SNAPSHOT>
    ├── objectType: Closed<zhiju.execution.context_snapshot>
    ├── objectId: UuidV7
    ├── snapshotId: UuidV7
    ├── scope: ProjectScope             // enterpriseId 与 projectId 均必填
    └── contentHash: ContentHash         // SHA-256 / 64 hex / canonicalizationVersion=1
```

1. 两个版本的 `resultSchemaRef` 分别是各自 `$defs` 中的 `..._result` 定义，Registry 条目显式注册该引用；只声明 `resultReferences` 不构成可验证返回路径。COMMAND 的结果 Schema 是显式可选加入的：未注册 `resultSchemaRef` 的命令不接受 operation-specific data，`validateOperationResult` 以 `operationResultRegistry` 拒绝。
2. `data.contextSnapshotRef` 必须同时满足 Result Schema 与跨字段绑定：`scope` 是 **Project Scope**，`enterpriseId` 与 `projectId` 都是必填字段——共享 `scopeRef` 允许的 `{}` 或仅 `enterpriseId` 在本入口一律拒绝；CommandResult `targetRef` 的 canonical objectType 必须是 `zhiju.execution.context_snapshot`，`objectId` 必须等于返回 Ref 的 `objectId`，Scope 的 enterpriseId/projectId 有无和值必须相等。只比较 objectId、或把 `zhiju.project.context_snapshot` 当作同一对象，都不能通过。该收紧只作用于新增的 Initial Context Result Ref Schema 与 canonical 绑定，不改变通用 `ScopeRef`，也不改变既有 Query 的接受集合。
3. canonical 名称是新入口的唯一输出；`zhiju.project.context_snapshot` 仅是 Core v1.0 历史读回身份，既不能由本入口产生，也不能在跨字段比较中与 canonical 名称互换。返回引用必须指向本次已提交的 Snapshot：同一 `objectId` 只能有该次构建产生的 `snapshotId` 与 `contentHash`，同键异 payload Hash 属于 `IDEMPOTENCY_PAYLOAD_CONFLICT`，由 Handler 判定。
4. authoritative `execution.get_context_snapshot@1.0` 的输入 Ref 与结果 Ref 必须逐字段相等（含 `snapshotId` 与完整 `contentHash` 三元组），防止返回与请求不同的 Snapshot。该 Query 既有 Schema、接受集合与历史 namespace 读回语义不变；不得用返回结果反推或放宽请求校验。
5. 旧 `execution.build_context_snapshot@1.0` 保持必填 `workOrderContractRef` 和原返回形状，不注册 operation-specific Result Schema，也不接受 `draftSnapshotRef` 分支。

| 反例 | 结果 | 禁止效果 |
|---|---|---|
| 命令未注册 Result Schema，或用 `resultReferences` 冒充返回契约 | `operationResultRegistry` / 构建期缺 Schema 错误 | 不产生「已实现精确返回路径」的结论；Handler 不接受未注册 data |
| 缺 `contextSnapshotRef`，或 `kind`/`objectType` 为 legacy/任意 namespace | `REFERENCE_INVALID`（Schema `required`/`const`） | 不返回 legacy 身份，不以任意 namespace 代替 canonical |
| `snapshotId` 缺失、`scope` 非 Project Scope（缺 enterpriseId 或 projectId，含空 Scope）、`contentHash` 非 SHA-256/64 hex/version 1 | `REFERENCE_INVALID`（Schema `required`）或 `MISSING_CONTEXT_SNAPSHOT_PROJECT_SCOPE` | 不把残缺 Ref 当可读回对象；不默认补全 Scope 或 Hash，也不因 target 与结果双方都缺 projectId 就判为一致 |
| `targetRef.objectId` 与返回 Ref 不等，或 objectType/Scope 不一致 | `EXECUTION_JUDGMENT_INVALID` / `CONTEXT_SNAPSHOT_TARGET_MISMATCH` | 不把另一次构建的 Snapshot 组装成本次成功结果 |
| Query 返回与请求不同的 `objectId`/`snapshotId`/`contentHash`/`scope`/`objectType` | `REFERENCE_INVALID` / `CONTEXT_SNAPSHOT_READ_MISMATCH` | 不用结果覆盖请求；不回退到 latest 或同 objectId 的其他 Snapshot |
| Snapshot 未提交、已提交但不可读 | `REFERENCE_INVALID` 或 `DEPENDENCY_UNAVAILABLE` | fail closed；不生成部分成功结果，不把未提交引用写入 Contract/Event |
| 同键同输入重复请求，或同键异 payload Hash 重放 | 前者返回原 `contextSnapshotRef`/Receipt，不产生第二个 Snapshot；后者 `IDEMPOTENCY_PAYLOAD_CONFLICT` | 不签发第二份成功事实，不以不同 Hash 覆盖已提交 Snapshot 的 `snapshotId`/`contentHash` |

第 2–5 项的结构与跨字段判断由共享 `ContractRegistry` 的 Result Schema 与纯契约绑定校验拥有；对象存在性、幂等裁决、授权与提交顺序仍由 owning Handler 与 PostgreSQL 业务链负责，本轮保持 `NOT RUN`。

#### 11.2.5.4 首次 Context 的期限上界与 effective expiresAt

状态：`APPROVED 2026-09-10 / SCHEMA, REGISTRY, GENERATED TYPES, FIXTURES AND PURE CONTRACT BINDING IMPLEMENTED 2026-09-12 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。依据 [#168](https://github.com/qzhike/zhiju-business-core/issues/168) 与[决定 §8.9](../decisions/task-execution-human-operated.md#89-168-initial-context-期限上界与-effective-expiresat)。本节是首次 Context 期限组合与 effective expiresAt 的唯一 API 权威，不改变 §11.2.4 的 WorkOrder 创建/冻结期限，也不改变旧 `build_context_snapshot@1.0`。

`InitialContextBuildRequest.expiresAt`（§11.2 的 @1.0 与 @1.1 均已有该可选字段）是本次 Context 的有效期上界，不是 WorkOrder 期限的替代或改写入口。INITIAL `context_snapshot_build` metadata 保存以下不可变观察：

```text
InitialContextExpiryBinding
├── requestExpiresAt?: UtcInstant     // 请求上界的原样观察
└── effectiveExpiresAt?: UtcInstant   // 本次 Context 的有效期；缺省表示没有有限上界
```

1. 请求提供期限 T 时，T 就是 effective expiresAt，并且必须不晚于每个有限上界：WorkOrder Root/Draft Snapshot 的创建期限、每个被消费 Source Slice 的 `validUntil`、以及当前 Builder Policy 解析出的有限终止时刻（`supersededAt`）。任一处 `T > bound` 即拒绝并保留被违反的上界路径，不静默截断为最小值。上界自身的读取授权与当前有效性仍由 §11.2.1 与 §11.2.5.2 拥有。
2. 请求未提供期限时，effective expiresAt 取上述有限上界的最小值。所有来源都没有有限上界时保持缺省；缺省只表示本次构建没有组合出有限期限，不表示无限授权——既有版本化 Policy、Decision、Context、Capability 与 Run lease/deadline 检查继续独立生效。当前已注册的 `ContextSourceSlice` 必须携带 `validUntil`，因此合法首次请求总是至少存在一个有限上界；缺省分支只描述组合规则的边界，不作为放宽输入的依据。
3. 组合与到期判断使用受信服务端当前时间，不能使用 caller 时间或事务开始时间。请求期限本身已过期或 `now >= effectiveExpiresAt` 即不可继续构建或消费，不发布成功 Snapshot。
4. effective expiresAt 必须写入本次已提交 ProjectContext Snapshot 的可选 `expiresAt`：存在性和值都与该 Snapshot 完全一致，并随完整 payloadHash 固定。Core v1.0 本体、必填集合与历史 Compatibility Baseline 不变；缺失、额外写入或不一致属于 `CONTEXT_EXPIRY_MISMATCH`。
5. metadata 必须原样记录请求上界：缺失、改写或以其来源（签发元数据、事务时间、本地默认值）替换属于 `EXPIRY_OBSERVATION_MISMATCH`；effective 被截断、放宽、事后重写或缺失属于 `EXPIRY_EFFECTIVE_MISMATCH`。metadata 与 Snapshot 同事务提交并保持不可变，重试不得覆盖。
6. Builder 发布前、Validator 产出可用判断前、Freeze 提交前以及 Run 创建/启动前，都从已提交事实重新读取 effective expiresAt 与其他独立期限，并以最新受信服务端时间重验。已过期时 Builder 不发布成功 Snapshot（`AGGREGATE_STATE_NOT_ALLOWED`），Validator 与 Freeze 拒绝新消费（`EXECUTION_JUDGMENT_STALE`）；期限映射错误仍按 §11.2.4 使用 `REFERENCE_INVALID` 或 `EXECUTION_JUDGMENT_INVALID`。
7. 已提交 Snapshot、判断与 Receipt 保留为不可变历史：同键同输入重放返回原结果，不重算期限，也不重新赋予执行资格。长事务跨过期限时提交前重验失败即回滚本次事务，不修改已提交事实，也不把其他 Root 状态改成 EXPIRED。
8. 冻结后 Retry 按 §11.2.3 使用完整 `ContextBuildRequest` 并重新组合一份新的 Context 期限；原 Contract、Context-1 与 Run-1 的 Ref/Hash/期限保持不变。WorkOrder 期限继续按 §11.2.4 原样继承，本节的请求上界不改写 Root、Contract 或 `WorkOrderBecameReady`。

| 反例 | 结果 | 禁止效果 |
|---|---|---|
| 请求期限晚于 WorkOrder 期限、任一 Source Slice `validUntil` 或 Builder Policy 有限上界 | 绑定校验 `EXPIRY_UPPER_BOUND_EXCEEDED`；构建按 §11.2.4 使用对应到期/拒绝错误 | 不取最小值继续、不静默截断、不放宽任一上界 |
| 请求无期限但记载了请求上界，或有期限却未记录/改写了它 | `EXPIRY_OBSERVATION_MISMATCH` | 不补值、不省略，不以 caller 或事务时间替代已观察事实 |
| effective expiresAt 与组合结果不符、缺失、被截断放宽或事后重写 | `EXPIRY_EFFECTIVE_MISMATCH` | 不发布成功 Snapshot，不以历史成功 Receipt 重新授权 |
| ProjectContext `expiresAt` 与 effective 不一致、缺失或额外写入 | `CONTEXT_EXPIRY_MISMATCH` | 不让 Snapshot payload 与 metadata/Hash 分离，不部分提交 |
| 构建前过期、长事务内跨过期限 | Builder `AGGREGATE_STATE_NOT_ALLOWED`；Validator/Freeze `EXECUTION_JUDGMENT_STALE` | 不发布可执行成功事实，不用事务开始时间或滞后 status 绕过，不回滚已提交上游事实 |
| 无期限请求在无有限上界时被当作无限授权 | 按缺省处理且不产生期限 | 其他 Policy/Decision/Capability/lease/deadline 检查继续独立拒绝 |
| 任一输入期限值畸形（含不存在的日历日期/越界时刻）、以 JSON null 冒充缺省、Source Slice 列表为空 | `INVALID_EXPIRY_INPUT` / `INVALID_EXPIRY_BINDING` / `MISSING_EXPIRY_BINDING` | fail closed；不把畸形值当缺省，不依赖运行时的日期归一化（如 `2026-02-30` 被折算为 3 月 2 日），也不静默扩大 Context 有效期 |

组合与镜像的跨字段判断由 `ContractRegistry` 的 `initialContextExpiryBinding` Schema 与 `validateInitialContextExpiryBinding` 纯契约校验拥有；对象存在性、幂等裁决、提交顺序和真实期限重验仍由 owning Handler 与 PostgreSQL 业务链负责，本轮保持 `NOT RUN`。

#### 11.2.6 #165 DRAFT VersionPins 与首次 Context 的 @1.1 兼容契约

状态：`APPROVED DESIGN / SCHEMA, REGISTRY, GENERATED TYPES AND FIXTURES IMPLEMENTED 2026-09-11 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。本节把批准的 DRAFT/Context 解环边界落到可执行契约；不改变既有 @1.0 合法调用。

`InitialWorkOrderDraft@1.1` 复用 `WorkOrderDraft` 的全部业务字段，但 `versionPins` 使用独立的 `DraftVersionPins@1.1`。其必填字段为 `contextBuilderPolicyRef`、`workOrderSchemaRef`、`skillRefs`、`templateRefs`、`capabilityPolicyRef` 和 `runtimeAdapterContractRef`；`regulatoryProfileRef` 与 `qualityProfileRef` 可选。`contextBuilderPolicyRef` 必须是 `VersionedRef` 且 `objectType=zhiju.identity.policy`；各数组保持唯一。`DraftVersionPins` 明确不允许 `projectContextContractRef`，该字段不能以空值、占位 Ref 或预分配 Hash 的形式出现在 DRAFT。

以下三个版本化操作与旧版本并存：`create_work_order@1.1` 接受 `InitialWorkOrderDraft`，`get_work_order_draft@1.1` 返回同一 DRAFT 形状，`build_initial_context_snapshot@1.1` 只接受 `draftSnapshotRef`、projection、purpose、audience、sourceSlices、builderPolicyRef 和可选 expiresAt。旧 `create_work_order@1.0`、`get_work_order_draft@1.0`、冻结后 `build_context_snapshot@1.0` 与 `build_initial_context_snapshot@1.0` 的合法字段和 Envelope 语义保持不变。

首次链按以下边界推进：DRAFT 只保存独立 Draft VersionPins；CTX-1 提交成功后，候选 Frozen WorkOrder Contract 才补入完整 `contextSnapshotRef`，并在 `versionPins.projectContextContractRef` 保存同一 Snapshot Ref。候选顶层与嵌套 Ref 必须逐字段完全相等：`kind`、canonical `objectType`、`objectId`、`snapshotId`、Scope 中 enterpriseId/projectId 的有无和值，以及 contentHash 的 algorithm/digest/canonicalizationVersion。候选组装、Validator 和 Freeze 都必须重新执行该绑定校验；缺失、错 Hash、错 Scope、Draft stale 或 Retry 输入改变时 fail closed，不生成部分成功事实。

本 Issue 只交付上述 Schema、Envelope/Registry、兼容元数据、生成类型、fixtures 与 TE-WI02-D-013 级别的纯契约正反例。Context Handler、业务 migration、真实 PostgreSQL 首次链、Provider/Feishu/Runtime 和人工业务验收仍为 `NOT RUN`。

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

ExecutionJudgmentRef 为受支持五类 Ref 的闭集；TaskReadiness/WorkOrderValidation 使用 SnapshotRef，其余使用 Exact Ref。ExecutionJudgment 为 header + 各 kind 的明确 payload，禁止任意 CanonicalJson 或跨类型 ID fallback。Hash 由完整事实 payload 规范化计算；`inputHash` 包含有序/去重规则明确的 subject refs、Policy/Evaluator 与事实清单，不含自身 judgmentId。生效期限不超过输入 AuthorizationDecision/Context/Policy 期限的最小值。WorkOrderValidation 的 validUntil 还不得晚于 §11.2.4 已提供的 WorkOrder 期限；产出可用判断和 Freeze 消费时均重新检查当前时间。

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
- start_run 同时遵循 §11.2.4 的 Root/Contract 期限一致且未到期检查；仅对合法 CREATED/STARTING Run 生效：读取 IG exact Binding（Spec 007），要求 SUCCEEDED 且 acknowledgement 与 Run/Contract/Context/Capability/RuntimeBinding 全等、lease/deadline 未到期。在成功事务中记录必要 STARTING→RUNNING transition，不制造 dispatch 前已启动事件；重复同命令返回原结果。
- submit_agent_result 只追加 Result Aggregate 和 Run 维度 final reservation，先锁 Run 并核对 RUNNING、lease、fencing 与绑定；不更新 Run Root。record_run_result 再锁 Run，确认该 Result 是唯一 reservation、仍 RUNNING且未过期，设置 resultRef/RESULT_RECORDED。不同 final identity 即使 Hash 相同也不可替换；相同 identity/hash 走持久化重放。
- cancel 只接受非 terminal 且未 RESULT_RECORDED 的可取消执行态；与 record 争同一 Run 锁。取消获胜后的 Result只能隔离；record 获胜则取消返回状态冲突。finalize 要求 RESULT_RECORDED、resultRef 匹配、Acceptance 通过精确查询、无隔离且 lease/deadline 有效。ACCEPTED→SUCCEEDED；REJECTED/QUARANTINED→INVALID_RESULT。Contract final outcome 不直接决定 WorkOrder 完成。
- expire_run 按服务端时钟重验传入原因：deadline 已到期且不在 CANCELLING 时 TIMED_OUT；lease 已到期或 CANCELLING 到期未确认时 ABANDONED。原因尚不成立则拒绝，不能接受 caller endedAt。terminal transition、Claim RELEASED/EXPIRED、Audit/Receipt/Outbox 同一个 Run 事务提交；terminal 后禁止改成其他 terminal 状态。
- 不同命令键重放 terminal finalize：若 exact result/acceptance/terminal 与已存结论一致，返回无新业务变化的原 terminal 结果；不允许新版本或第二个 RunTerminated。冲突 Ref 返回稳定错误。同键先通过 Command Receipt 重放。
- lease、deadline、fencing、Claim、Result/Acceptance 检查必须在提交点重验；长事务过期不能靠事务开始时间通过。

TD-02 的入口版本、批准依据及 IM-DG-006 适用性见 [设计决定 §9.2](../decisions/task-execution-human-operated.md#92-控制入口与-im-dg-006-适用性)，逐项拒绝反例见 [WI-03 矩阵](../module-tests/Module-Test-003-TaskExecution.md#wi-03-控制入口与拒绝反例)。受控 Driver 只产生合成 ack/Result；Ingestion 的 runtimeSubmissionRef 与 runFencingToken 来自该实际调用观察和原 invocation，不从任意 caller 声明建立可信来源。延迟 Result 原样进入接收校验；拒绝/隔离不能留下可用 final reservation、RESULT_RECORDED、Acceptance 或业务输出。已存在的 immutable Result/Acceptance 仅保留历史，不能因重放获得新的执行资格。

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

REVISION_ACCEPTANCE_READY 通过 Artifact exact Revision + Quality 的精确 RevisionAcceptance Query 检查适用 mandatory gates、未失效和 READY；REVISION_FULLY_APPROVED 再检查 exact ApprovalBundle、当前有效 Human Approvals 和未失效链。Quality 的历史 Snapshot Query 不等于当前有效性证明，消费端必须调用 owning current-validity Port；该 Port 明确契约见本设计的 Quality 补充。该 current-validity Port 已由 #192 交付为 `quality.get_revision_execution_eligibility@1.0`（质量模块权威 Query，Purpose `quality.revision.execution_eligibility.read`；Catalog/Registry 由 212 增至 213），Quality 侧契约见 [Spec 005](Module-Spec-005-QualityGovernance.md#im-06-revision-当前执行资格-query-设计)；TE 侧调用、Completion 消费与跨模块业务链仍为 `NOT RUN`。Task 首版不新增 RELEASED Criterion；Release/DeliveryItem 完成继续由对应 Owner 判断。新 profile 有意比开放 CanonicalJson严格，故使用 @2.0，禁止改变 create_task@1.0 的旧 Schema或重写历史 payload。

Issue #175 已把该 Major 落到可执行契约：`execution.create_task@2.0` 注册为 Target 固定 `zhiju.execution.task`、mode CREATE、Owner TaskExecution、Purpose `execution.task.create` 的 Command，Payload 为 `projectRef: ObjectRef<zhiju.project.project>; definition: TaskDefinitionV2; initialAssignee?`；`TaskDefinitionV2` 的字段集合与 `TaskDefinition` 相同，其中 `expectedOutputSpec`/`completionCriteria` 两个开放成员替换为注册的 closed shape；`inputRefs` 按 §2 的已批准 `TypedReference[]` 注册为普通数组（`dependencyTaskRefs` 仍为 Set），不复用 @1.0 payload 中 `uniqueItems` 的历史实现偏差，因此 v2 接受重复引用且不改写调用方列表。五类 `TaskCriterionV1` 的 closed Schema、criterionType 与三个 bindings 分支的唯一对应、任意 expectedCondition 表达式与未知字段由注册 Schema 拒绝；重复 criterionId、重复 outputSlot 与未解析的 output-slot 绑定由纯契约校验 `validateTaskDefinitionBinding` 拒绝。`evaluatorRef` 保持通用 `VersionedRef`（与 Core `completionCriterion.evaluatorRef` 一致，不新增 objectType）；Evaluator 存在性、支持版本、Policy 有效性与真实授权仍由 owning Handler 判定，保持 NOT IMPLEMENTED/NOT RUN。

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


### 11.9 首批 Policy/Evaluator 解析与消费时重验（#176 提案）

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED`；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 已交付本节三个 profile 的静态注册与纯校验：`execution.context_builder.policy@1.0`、`execution.task_readiness.policy@1.0`、`execution.work_order_validation.policy@1.0` 的 canonical typed ref、closed 字段 Schema 与 `validateContextBuilderPolicy`/`validateTaskReadinessPolicy`/`validateWorkOrderValidationPolicy`（必需 profile key + closed 字段；`mandatoryCriterionTypes` 缺省与空 Set 接受、七类之外拒绝）；[Issue #189](https://github.com/qzhike/zhiju-business-core/issues/189) 已交付两个首版 Evaluator profile 选择器的构建期静态注册与纯解析（`contracts/registry/evaluator-profiles.v1.json`，registry 版本 `im06-evaluator-static-v1`）；Evaluator 确定性实现、解析调用、`validUntil` 推导、判断产出与业务持久化仍 `NOT IMPLEMENTED / NOT RUN`。依据 [Issue #176](https://github.com/qzhike/zhiju-business-core/issues/176)、[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖) 与 [Spec 001 §13](../module-specs/Module-Spec-001-IdentityPolicy.md#13-176-policy-版本身份与解析-port-设计)。本节固定 TaskExecution 三个消费者（Initial Context Builder、TaskReadinessBuilder、WorkOrderValidator）如何取得 Policy/Evaluator 输入并重验，不改变 §11.1–§11.8 已批准的字段、错误码与判定语义，也不改变 §3/§4 的既有 @1.0 操作。本节已获设计批准，但尚未产生 Handler 或业务持久化。

**Policy 解析输入的唯一来源**：`resolvedPolicy`（§11.2.5 的 `ContextBuilderPolicyBinding`）与 Builder Policy 的有限上界（§11.2.5.4 的 `supersededAt`）只能来自 `identity.resolve_policy@1.0` 的当次返回。映射是逐字段的：`policyRef → builderPolicyRef`、`contentHash → contentHash`、`effectiveFrom → effectiveFrom`、`supersededAt → supersededAt`。`validateContextBuilderPolicyBinding` 与 `validateInitialContextExpiryBinding` 仍是**纯跨字段校验**：不得由 caller 自报、由 `objectId/versionId` 推导、用 fixture 值或历史 Receipt 充当当次观察。

| 消费者 | Policy 绑定与 profile（§12.4） | Evaluator 支持边界 | 授权与重验 |
|---|---|---|---|
| Initial Context Builder（`build_initial_context_snapshot@1.0/@1.1`、冻结后 `build_context_snapshot@1.0`） | `builderPolicyRef`（`zhiju.identity.policy`）；`execution.context_builder.policy@1.0` 的 `allowedProjectionTypes` 必须包含请求 `projectionType`；有限上界仍是 Builder Policy 的 `supersededAt`，不新增 Context TTL 字段 | 不需要独立 Evaluator | Purpose `execution.context.build.initial`（已注册）的自身 Decision；candidate 组装、Validator、Freeze 各自重新解析并重跑 §11.2.5.2 |
| TaskReadinessBuilder（`build_task_readiness@1.0`，设计） | `policyRef`（`zhiju.identity.policy`）；`execution.task_readiness.policy@1.0` 的 `maxReadinessValiditySeconds` 决定 `JudgmentHeader.validUntil = min(evaluatedAt + T, authorizationDecision.expiresAt)` | profile `te.task_readiness.evaluator@1.0`（构建期静态注册）；其他版本 `EXECUTION_CRITERION_UNSUPPORTED` | Purpose `execution.task.readiness.build`（未注册）的自身 Decision；生产端读 Task/依赖/输入，不把 producer 授权转让给 `mark_task_ready` |
| WorkOrderValidator（`validate_work_order_draft@1.0`，设计） | `policyRef`（`zhiju.identity.policy`）；`execution.work_order_validation.policy@1.0` 的 `maxValidationValiditySeconds` 与可选 `mandatoryCriterionTypes` 参与判定；`validUntil` 不得晚于 §11.2.4 的 WorkOrder 期限 | profile `te.work_order_validation.evaluator@1.0`，按 §11.6 的绑定字符串 profile 解释 Core §4.9 七类 Criterion；其他类型/版本 `UNSUPPORTED` | Purpose `execution.work_order.draft.validate`（未注册）的自身 Decision；Freeze 不继承 Validator 的授权，必须重算两类 Hash 与期限 |

1. **Evaluator 版本注册**：Evaluator 是确定性实现代码，其版本以构建期静态注册表登记（沿用 `POLICY_SCHEMA_REGISTRY`/`payload-guard-policies.v1.json` 机制：静态条目、固定标识、无数据库行、无虚构 Hash），以 `VersionedRef<Evaluator>` 暴露；objectType 由本模块注册为 `zhiju.execution.evaluator_profile`，Scope 为 Platform。Evaluator ref 是 profile 选择器，不携带 `contentHash`、不参与 Policy 版本生命周期，也不得作为已提交业务事实。首版只登记两个选择器：`te.task_readiness.evaluator@1.0`、`te.work_order_validation.evaluator@1.0`；其 canonical typed ref 由 `contracts/registry/evaluator-profiles.v1.json`（registry 版本 `im06-evaluator-static-v1`）一次性分配并固定，生成副本 `contracts/src/generated/evaluator-profiles.json` 与注册源字节一致、漂移使构建失败，加载拒绝重复 key/身份、缺条目、错误 owner、未知 registry 版本与非 Platform canonical 条目。纯解析按 `kind`/`objectType`/`objectId`/`versionId`/`scope` 全字段精确匹配：未知 key 或身份、非空 Scope、错 kind、非平台 objectType、其他消费者的选择器与任何形近伪造都不解析，不做 latest/回退，也不只比较字符串尾缀或 `versionId`；解析为空由后续 owning Handler 映射为 `EXECUTION_CRITERION_UNSUPPORTED`，本节不实现该映射。
2. **消费时重验**：每次产出可用判断或提交冻结前，都以受信服务端当前时间重新解析 Policy 并重跑 §11.2.5.2 与 §11.2.5.4 的校验；`now >= effectiveExpiresAt`、`now >= supersededAt`、Decision/Capability 失效时分别按 §11.2.4/§11.2.5.4 的既有错误拒绝新消费。已提交 Context/判断/Contract 保持不可变历史，重放不重新授权。
3. **profile 语义归属**：`policyDocument` 的 profile 字段校验在 TaskExecution 内完成；IdentityPolicy 只提供不可变事实、Hash、生命周期与解析。未知字段、未知 profile 版本或语义未支持时拒绝（`EXECUTION_CRITERION_UNSUPPORTED`），不得静默忽略字段或跳过判据。
4. **profile 注册校验**：本节三个消费者的 `policySchemaRefs` 必须含各自 registry key（`execution.context_builder.policy@1.0`、`execution.task_readiness.policy@1.0`、`execution.work_order_validation.policy@1.0`；见 [Spec 001 §13.5](../module-specs/Module-Spec-001-IdentityPolicy.md#135-授权profile-schema-注册与失败审计)）的 canonical typed ref；Evaluator 版本来自本模块构建期静态注册表。任一不匹配即拒绝，不得以旧 registry 条目代替。
5. **持久化观察**：`context_snapshot_build` 继续保存 §33 已定义的 `builder_policy_ref`/`policy_content_hash`/`effective_from`/`superseded_at`；`execution_judgment` 增加同源的 `policy_content_hash`、`effective_from`、可选 `superseded_at` 与当次解析的 exact `policy_version_ref` 镜像，使判断可用性与当时观察可解释。新增字段属提案，实现时按 forward-only migration 交付，不修改已应用 V3000。
6. 本节所有行为在批准与实现前保持 `NOT RUN`；Schema/纯 helper 通过不证明 Policy 对象存在、当前授权有效或 Handler 已实现。

## 12. TD-05 Query / Task Board 补充设计

状态：`PROPOSED / NOT IMPLEMENTED`，见[设计增量](../decisions/task-execution-human-operated.md#11-剩余设计增量-td-05–07)。本节与 §13–14 待审核，§11 的 TD-01–04 仍为已批准基准。

### 12.1 权威读取与公开兼容

七个既有 Query 的 payload/result data 不变；TaskState 使用 §11 已批准的新 Query。读取开始和返回前验证有效授权、Scope/Purpose；对 mutable Root 在同一只读一致性快照组装 aggregateVersion 与子事实，不从 Board 补字段。exact Contract/Context/Result 校验 Owner、id/hash、Scope；查询不补建 Judgment、不 resolve Request、不触发 Driver 或 Completion。历史 immutable fact 的存在不等于当前可用于执行，当前有效性走 §11 Judgment/TaskState 等 owning Port。

所有 Board 响应使用共享 `QueryResult<Page<TaskBoardItem>>`。`stalenessStatus` 等诊断放共享 Envelope，不向严格的 TaskBoardPage v1 增加字段；Page 与 Envelope 的 snapshotAt/sourceWatermarks/nextCursor 一致，Hash 按共享规则计算。既有 Result Schema 只验证 data，不能代替 Envelope 的集成验证。权限不足与不存在依共享安全 Policy 折叠，不泄露跨租户行数、cursor 或故障正文。

### 12.2 owning Snapshot Export 与发布

新增内部只读 `TaskBoardSnapshotExportPort`，仅授予指定 Projection Service；输入 `{projectRef, exportPolicyRef, authorizationContext}`，输出不可变 manifest `{exportId, projectRef, snapshotAt, policyRef, rows, rowCount, rowsHash, coveredDirtyIds}`。rows 使用内部 `TaskBoardSnapshotRow = {item: TaskBoardItem, filterKeys: {deliveryItemRef?: VersionedRef<DeliveryItem>}}`，按 item.taskRef 的 Task id 的 UTF-8 字节序排序；同一 REPEATABLE READ 快照中读取 Task、child WorkOrder、blocking Request 与已提交内部 dirty marker。业务对象含完整 Enterprise/Project Scope，未解决 BLOCKED_INPUT 与 §11.5 的 reconcile 阻塞规则一致；export 不推进这些 Root。内部 Port 不接收自由过滤 SQL，不对 Human/Agent 开放，Projection writer 不直接访问 task_execution 表。

`filterKeys` 必填，其 deliveryItemRef 从该快照内 Task definition 的同名字段原样取得；源字段不存在时省略，不填 null、不按最新 DeliveryPlan 推断。item 与 filterKeys 必须从同一来源快照组装，受同一 Scope 校验。rowsHash 对完整有序 TaskBoardSnapshotRow 数组做 canonical hash，包含 filterKeys、精确 Ref 及字段有无；manifest hash 同样覆盖完整 rows。相同展示字段而筛选引用不同必须产生不同 Hash。公开 Page 仅投影 row.item，禁止把 filterKeys 加入严格的 TaskBoardItem v1。

每个影响 Board 的 owning 写事务同时追加 Scope 内 dirty marker（Task 创建/状态/字段及任何已授权的 deliveryItemRef 来源变更、WO 状态、Request/Resolution、影响 blocker 的 Result 等）；只读 Export 不写 marker、checkpoint 或派发状态。worker 在独立技术事务领取每 Project 的带 fencing 的单一 export lease，读取 owning manifest，再发布 generation。旧 worker 失去 lease 后不能切换 alias。worker 在派发技术事务中持久化完整安全 manifest 后才能发布；同一 exportId 重放必须使用原 manifest，新读快照必须使用新 exportId。消费者仅确认 manifest 明确覆盖的 dirty identities，不能以 `MAX(sequence)` 确认尚未提交的更小序号；并发晚提交 marker 会再次触发刷新。启动、恢复和定期完整导出兜底，不能依赖一次性唤醒。

每个发布 generation 保存 canonical manifest hash、行数、策略版本、来源 snapshotAt。Projection 在一事务写新 generation/rows、校验 count/hash、更新 checkpoint 并切换 alias；任一失败保留旧 alias。发布顺序由该 Project 的 fenced worker 串行分配持久化 sequence，相同 exportId/hash 重放复用，异 hash 拒绝。Board SourceWatermark 为 `sourceModule=task_execution`、`partition=task_board:<projectId>`、generation 发布 sequence；它只表示这个导出流的消费进度，不冒充 Domain Event 全局提交位置，不能传给 §10.3 的 EP Completion consumer。observedAt 是真实导出观测时间，不能用查询当前时间把旧快照变新。

这是 §07 Snapshot Export 方案的首版完整刷新实现；不需要无限保留公共 Outbox，不把 Event payload 当完整状态。导出失败、越权、无法校验的 manifest 进入脱敏 failure；不能空集合替换成功 generation。worker 崩溃于 alias 切换后、dirty 确认前，可重复相同导出/刷新，但不得漏掉新 marker。

### 12.3 过滤、分页与 freshness

过滤先约束当前授权 Enterprise/Project，再在 cursor 固定的 generation 内应用 statuses、assigneeRef、精确 deliveryItemRef；前两者读取 row.item，后者只读取 row.filterKeys.deliveryItemRef。指定 deliveryItemRef 时，只有存有同一完整规范化 VersionedRef 的行匹配，必须包含版本及 Ref 内的 Scope/其他限定字段，不能仅比较对象 id；未绑定或不同版本均不匹配。未指定该过滤器时不排除未绑定行。所有过滤先于稳定排序与分页截取，不能先取一页再过滤。禁止回查最新 Task/DeliveryPlan 补充筛选关系；当前权限仍独立重验。空 statuses 表示不限制状态。assignee 仅导出规范 PrincipalRef 的安全表示，不复制任意主体属性。首版筛选、排序和分页规则须以既有 Query payload Schema 为输入，不静默改类型。固定排序为 Task id 升序，无 offset 翻页。

Cursor 按共享 API §6.2 防篡改，绑定 query/version、Scope、requester/当前授权策略、Purpose、规范 filter hash、generationId、snapshotAt/watermarks、sort、last Task id、expiresAt。下一页读相同不可变 generation；alias 已换新也不能混读。每页仍重新授权；权限/Policy 改变时拒绝旧 cursor 并重新查询，不沿用旧授权或返回部分旧行。旧 generation 保留至所签发 cursor 的最大有效期，过期返回 QUERY_CURSOR_EXPIRED；参数/Scope/Purpose 不匹配返回 QUERY_CURSOR_SCOPE_MISMATCH。过期清理独立于只读 Query。

本 profile 的共享 Envelope `stalenessStatus` 使用 FRESH/STALE/REBUILDING/FAILED；它们是待注册的响应语义，不增改旧 data Schema。FRESH 要求所读 generation 仍是当前 alias、当前检查能确认没有未覆盖 dirty marker、无失败/重建且快照年龄在版本化 freshness Policy 阈值内；这仅是观测时点新鲜，不能授权下一条写操作。无法读 source health 为 FAILED；有待处理 marker 或超过阈值为 STALE；新版本构建中为 REBUILDING。后两者与 FAILED 可附带仍在保留期且通过当前授权检查的旧 generation，分别使用共享 status STALE/ERROR；没有可用 generation 时省略 data，禁止 OK+空 Page 掩盖故障。状态优先 FAILED > REBUILDING > STALE > FRESH。刷新阈值、cursor TTL 与保留期限从版本化 Policy 读取，缺失配置不能自称 FRESH。

Board 的 COMPLETED 是历史状态展示。进入操作前重新读取权威 TaskState 和适用 Judgment/Decision；禁止 Board blockerRefs=[]、历史 Evaluation 或 FRESH 成为 readiness/completion/授权证明。即使独立权威查询成功，也不能把同页 Board 改标 FRESH。

## 13. TD-06 Usage / Provenance 补充设计

状态：`PROPOSED / NOT IMPLEMENTED`。复用 `get_usage_and_provenance@1.0`；不新增 Runtime Usage 写命令，不改变 AgentResult Core Schema。

| 可验证输入 | 首版返回规则 |
|---|---|
| 尚无可用 final Result，或无任何 Usage 声明 | 不返回 runtimeUsageRef；agentDeclaredUsage 为 UNKNOWN 且无 value；authoritativeSource=UNAVAILABLE |
| final Result 含可定位的 Agent 声明 | agentDeclaredUsage=PRESENT，evidenceRefs 指向 exact Result；authoritativeSource=AGENT_DECLARED，仅指当前可展示来源，不是 Provider 权威计量 |
| 已隔离/拒绝的 Result 含声明 | 不提升为可用 Usage；返回 UNKNOWN 及安全原因，Provenance 可展示隔离 fact ref；不合计其数值 |
| Provider/Runtime 计量尚未实现 | runtimeUsageRef 省略；不依据 Driver 执行次数估算 token/cost，不用 PRESENT 0 替代 UNKNOWN |

当前 AgentResult 没有统一计量字段；仅当存在经后续明确 profile 解释的合法声明时才采用表中 PRESENT 分支，IM-06 默认路径为 UNKNOWN，不从自由文本、stdout 或任意 metadata 猜值。本轮不添加或收紧 AgentResult 请求字段；执行前 Budget 检查照常，无法满足的强制计量/预算 Policy 拒绝 dispatch，不能把未知当无消耗。

Query 的既有 `provenance: CanonicalJson` 输出使用安全 profile `execution.provenance.human_operated.v1`：`{profile, runRef, workOrderContractRef, contextSnapshotRef, capabilityGrantRef, runtimeBinding, attemptEvidence, resultEvidence}`。后两项使用 ValueEnvelope<CanonicalJson>；PRESENT 的 attemptEvidence 只含 exact Attempt、bindingHash、Observation/receipt refs 与 source=SYNTHETIC_DRIVER，resultEvidence 只含 exact Result、Acceptance ref（若已形成）、受验证的 Core provenance 安全字段。未知为 UNKNOWN，不造占位Ref。缺少可校验的跨模块查询时用 UNAVAILABLE 原因，不能降级信任 caller 的 provenance。

从已持久化 Run、IG binding/observation 与 immutable Result 分别取证，不把 Result 自述当作 Invocation Observation。声明与实际绑定不一致保留拒绝/隔离事实，不合成新的可信 provenance；Runtime Binding 不包含 token、secret handle、stdout、Prompt、客户正文或 continuation secret。合成 Driver 使用版本化的明确 synthetic 身份，不冒充真实 Provider/Model；不存在的 Execution Package、execution node/session 不编造 hash/ref。

`reconciliationStatus` 首版 profile 值为 `execution.usage.unavailable`、`execution.usage.agent_declared_only` 或 `execution.usage.source_conflict`；它们不表示 Provider 对账完成。Run-2 不覆盖 Run-1 的 Result/Usage/来源，每次查询按 runRef 返回独立事实，不跨 Run 汇总费用。将来增加真实计量仍须 IM-DG-006 及独立契约设计。

## 14. TD-07 受控退出 Fixture 与恢复设计

状态：`PROPOSED / NOT IMPLEMENTED`。使用同一公开 Application Port、正式 AuthorizationDecision/ActorSnapshot、真实 PostgreSQL 与可控时钟/故障点；测试 Human identity 是测试环境授权主体，不伪造生产审批。Policy/Evaluator/Adapter fixture 固定版本与 canonical hash，由正常注册/装载边界解析；unknown、过期或 Hash 不匹配直接拒绝，不能为了通过链路跳过判据。测试依赖和业务初始化分别走各 owning 入口。

| 阶段 | 正常正式输出链 | BLOCKED_INPUT 恢复链 |
|---|---|---|
| 初始化 | 已存在合法 EP/Artifact 输入；Task v2→Readiness→READY；WO Draft→EP Slice→initial Context→Validation→Freeze/Queue | 同左，冻结一个 CustomerMaterial 答案 profile 的缺输入场景 |
| 执行 | Dispatcher create Run→IG Attempt→实际 synthetic invoke/ack→start Run | Run-1 返回 final BLOCKED_INPUT，合法空输出可 Acceptance/Run SUCCEEDED |
| 结果 | Result submit→record→五类 Validation→Acceptance→finalize；所指正式 ArtifactRevision 由 Artifact owning Command 创建并核验 Scope/provenance | WO/Task 保持阻塞；服务按已提交 Result 建立关联 Request，Request 建立前的异步窗口也必须阻塞 |
| 恢复 | 不需要答案 | Human 提交 Answer，EP 确认材料，TE 核验 Receipt 采纳/resolve；冻结后 build_context 形成 CTX-2；新 Run-2/Attempt/fencing，原 Contract/CTX-1/Run-1/Result hash 不变 |
| 完成 | WO Evaluation→WO完成；Task Evaluation核验全部条件/适用质量事实→Task完成；实际 TaskCompleted Outbox→EP Inbox/独立 DeliveryItem Evaluation | Run-2 走正常结果链；新结果明确覆盖旧阻塞意图，所有关联 Request resolution 均可解析；不能只凭 RESOLVED 或新 Run 存在判成功 |

正式 Revision 的业务修改只由已授权 owning Command 发生；Driver 不直接写 Artifact 表。TD-02 所限 Proposal/结果驱动副作用须在匹配 Acceptance finalize 后处理；预置输入 Revision 与本次 WO 创建的输出不能混淆。Quality 条件通过真实 owning Gate/Approval 路径产生当前 RAS/ABS，不注入 READY 布尔值。DeliveryItem Fixture 先选满足已批准首版 Task profile、且其自身 criteria 可由本范围事实证明的受控对象；另设要求 Release 的负例，必须保持未完成，不能为过 Gate 扩展 Task RELEASED criterion。

恢复 Process 只保存当前 step/source exact ref、稳定幂等键、attemptCount、nextAttemptAt、安全 lastError；每步调用 owning Command 后再确认进度。提交成功但确认进度前崩溃重放同键；结果不明先查询 Receipt，不换键重做外部动作。临时不可用按版本化 retry Policy 有限重试，到预算上限保留失败与待处理源，不清 blocker、不写业务成功；输入/授权/Hash 错误为需处理失败，不无限重试。处理后的新合法输入生成新的 source fingerprint，旧失败与原事实仍可追溯。scan/worker 重启恢复规则沿用 §11.5，Query 不承担补偿。

退出报告在 GitHub Issue/PR 给出两条链的真实 identity/hash 与 CommandReceipt/Outbox/Inbox/Evaluation 引用，分别列 Design、Schema、Application、PostgreSQL、controlled cross-module、Provider/HTTP/Manual 结果。至少在 Result提交、Acceptance提交、Run终结、Request resolution、TaskCompleted投递后各注入一次故障，恢复前后核对 Receipt/事件数量与旧 Hash。外部 Provider、Feishu、CLI、公开 HTTP、生产与独立人工业务验收保持各自 NOT RUN，除非另有实际执行证据。

## 15. 创建 Purpose 兼容性 Spec Delta（#190）

状态：`APPROVED 2026-09-14 / EXACT MAPPING AND PURE RESOLUTION IMPLEMENTED 2026-09-14（#196）/ IDENTITY POLICY CREATION AUTHORIZATION PORT IMPLEMENTED 2026-09-15（#200）/ HANDLER AUTHORIZATION NOT RUN`。本节是已批准的最小 Delta；§3 已同步逐版本 Purpose，§11.1、§11.6 与可执行 Registry 保持原值。背景、备选及逐版本声明见[决定 §13](../decisions/task-execution-human-operated.md#13-190-taskworkorder-创建-purpose-兼容性提案)。仅涉及 TaskExecution / IdentityPolicy 创建授权边界；TD-01–04、TD-05–07 状态不变。

### 15.1 推荐的逐版本 canonical 映射

这里 canonical 指该精确 operation/version 唯一可接受的授权 Purpose，不代表操作族存在一个通用别名。

| operation/version | 唯一 Purpose（已批准） | 对现行声明的最小 Delta |
|---|---|---|
| `execution.create_task@1.0` | `task.execution.create_task` | 已修正 §3 的设计文字；保留 metadata 与旧 Schema |
| `execution.create_task@2.0` | `execution.task.create` | 保留 §3/§11.1/§11.6、public-api 与 metadata；不继承 v1 授权 |
| `execution.create_work_order@1.0` | `task.execution.create_work_order` | 已修正 §3 的设计文字；保留 metadata 与旧 Schema |
| `execution.create_work_order@1.1` | `task.execution.create_work_order` | 保留 §3、public-api 与 metadata；同 Purpose 不表示 Decision 可跨版本 |

四条已发布操作的 Registry/metadata 值变更为 **零**；历史 Compatibility Baseline、生成物、fixture 与 Catalog 计数不变。不注册 `execution.work_order.create`，也不将它作为兼容别名接受。保留其历史设计文字仅供追溯。新增版本若需要不同 Purpose，须另行提出明确版本与兼容决定，不能在本次实现时顺带增加。

已实现（#196）的静态分量，仅覆盖上表：四条 `(type, version, purpose)` 以 `contracts/registry/operation-compatibility-metadata.v1.json`（四条 Purpose 的执行来源，含两个 `@1.0`）与 `contracts/registry/public-api.v1.json`（owner/kind）为来源，经 `tools/contracts/generate-public-api.mjs` 投影为可再生成副本 `contracts/src/generated/task-execution-creation-purposes.json`，由 `pnpm contracts:check` 拒绝生成漂移，并在生成前拒绝四版本的遗漏、重复、错 owner、错 kind、越权 Purpose 或跨来源不一致；两个 `@1.0` 继续省略 public-api 字段。运行时可消费副本由 `contracts/src/task-execution-creation-purpose.ts` 发布，IdentityPolicy 模块公开导出精确解析入口 `resolveTaskExecutionCreationPurpose(commandType, commandVersion)`，解析结果保留精确 type/version。该入口只是解析事实：不含版本化 Capability/Policy 配置、Decision 签发、当前 grant 重验或 TE 幂等创建入口接线，也不解除 `authorizeCommand` 的 `1.0` 限制；§15.3 与 TE-P190-001–011 的运行验收仍未实现、未运行。

### 15.2 Actor、业务 Scope 与授权映射

继承 Domain §18.8/§19.9：四版本均只创建 DRAFT。Human 须为授权项目成员；Agent 须有既有 Coordinator Profile/Capability，普通 Agent 只能提议；Service 仅限受规则约束的 Process Manager，Task 按规则创建、WorkOrder 基于既有 Task 创建草稿。上述是设计适用边界，不能由 PrincipalKind、角色名称、`actingFor`、`requestedBy` 或 `initialAssignee` 自动放行，也不代表 Agent 自动化已经实现。

授权映射由 [Spec 001 §14](Module-Spec-001-IdentityPolicy.md#14-taskexecution-创建授权190-approved)拥有。调用者始终持自己的 ActorSnapshot 与 Decision。创建权不包含授予 Capability、READY、freeze、queue、Run、Approval 或 Release；DRAFT 中的 allowedCapabilities 只是受验证的业务输入，不能签发 grant，更不能给 Agent/Service 引入 Human-only 能力。

业务校验与授权 Scope 分开：Task 的 projectRef、targetRef、父任务/关联输入与受信 Enterprise/Project 必须闭合；WorkOrder 的 taskRef、targetScope、输入及 capability 范围不能突破 Task 与当前授权，两者取交集，不因 Enterprise 归属相同而跨 Project 放行。业务范围是包含关系；IdentityPolicy 授权事实仍按 scopeKind + enterpriseId + projectId 精确匹配，Enterprise Grant 不覆盖 Project Intent。保持现行各版本 Ref/字段接受集合，不借本提案统一 objectType 拼写。

### 15.3 调用与回放边界

1. 先由精确 type/version 选择 Schema 与 §15.1 映射；未知版本或 Purpose 无映射拒绝，不回退其他版本。服务端构造预期 Intent，校验 target、payloadHash、Scope、实际 Actor/认证上下文、type/version、Purpose、requestedCapability 和有效期；不能只信调用者传入的 expected 值。
2. 通过 IdentityPolicy owning Port 重验 `ALLOW` 与当前有效 grant/Policy，授权读取或依赖失败时 fail closed。通用 `validateAuthorizationDecision` 的精确比较本身不等于当前 grant 重验。TaskExecution 不直接读取 IdentityPolicy Repository；具体 Port 接线属于批准后的实现范围。
3. 返回幂等成功结果前也执行当前 Actor/Scope/Decision/grant 检查；首次提交前再次确认资格。撤销后旧 Decision 与原 Receipt 保留，但不能凭原 key 越权取得成功返回或创建新事实。跨模块按既有观测时点一致性，不声称获得跨模块原子撤销锁。
4. 当前资格仍有效时，同 operation/version、同 key、同输入返回原 Receipt，不重复创建 Root/Event；同键异输入仍拒绝 `IDEMPOTENCY_PAYLOAD_CONFLICT`。跨版本不是旧 Receipt 的等价重试，必须独立授权和请求，禁止通过改 version 取回另一版本 Receipt。
5. 历史审计/回放保持原 Purpose、版本、Actor、Decision 与 payload Hash，不修改或重新签发历史证据。历史 Receipt 的受权读取不赋予新动作资格；业务重放若请求新副作用，按新动作完整校验。无新副作用的技术重放不能伪装为新的创建授权。

验收与失败矩阵见 [Module Test 003](../module-tests/Module-Test-003-TaskExecution.md#创建-purpose-兼容性190-approved) 与 [Module Test 001](../module-tests/Module-Test-001-IdentityPolicy.md#taskexecution-创建授权190-approved)。外部授权错误沿用共享 `AUTHORIZATION_DECISION_INVALID` / `AUTHORIZATION_EXPIRED` / `AUTHORIZATION_REVOKED`，内部细分 Purpose/version/Scope/grant 原因仅进入安全 Audit；不泄露其他 Scope 对象存在性，不新增错误注册。

## 16. Task DRAFT 创建引用与持久化边界（#202 设计）

状态：`T2 / APPROVED 2026-09-15 / INDEPENDENT DESIGN REVIEW APPROVE / HUMAN DESIGN APPROVAL RECORDED / HANDLER, PORTS, V3001 PERSISTENCE AND COMPOSITION ENTRY IMPLEMENTED（#204）`。本节回应 [Issue #202](https://github.com/qzhike/zhiju-business-core/issues/202)，固定 `execution.create_task@1.0` 与 `@2.0` 的跨模块引用身份、DRAFT 校验时机、创建事实、公开事件与授权顺序；依据、备选与精确批准记录见[决定 §15](../decisions/task-execution-human-operated.md#15-task-draft-创建引用与持久化边界提案202)。本节不改变 §2–§6 的既有 @1.0 定义、§11 的 TD-01–04 基准、§15 的逐版本 Purpose、可执行 Registry（213 项 Catalog 与 200 项历史 Compatibility Baseline）或任何已冻结 fixture；只定义 owning Handler 的最小语义增量。实现事实与验证边界见 §16.9；本节的 Handler、Port 与 migration 已由 #204 交付，但仍不代表 Task READY、WorkOrder 或其余 IM-06 行为已实现。

### 16.1 逐版本引用身份与封闭接受集

`execution.create_task` 两个 Major 各自只有一套已发布身份，均由既有材料固定：不新增别名、不统一拼写、不改写 v1 payload。

| 字段 | `@1.0` 唯一接受的 objectType | `@2.0` 唯一接受的 objectType | kind |
|---|---|---|---|
| Envelope `targetRef`（CREATE） | `execution.task` | `zhiju.execution.task` | OBJECT |
| `payload.projectRef` | `project.project` | `zhiju.project.project` | OBJECT |
| `definition.deliveryItemRef`（可选） | `project.delivery_item` | `zhiju.project.delivery_item` | VERSIONED |
| `definition.parentTaskRef`（可选） | `execution.task` | `zhiju.execution.task` | OBJECT |
| `definition.dependencyTaskRefs[]` | `execution.task` | `zhiju.execution.task` | OBJECT |

来源：v1 冻结正例 fixture `tests/fixtures/contracts/execution-create-task-command-valid.json`（与历史 compatibility baseline 逐字节相同）与 #200 已交付的 `TASK_EXECUTION_CREATION_BINDINGS`（v1 target `execution.task`、v2 target `zhiju.execution.task`）；v2 的 `projectRef` 由注册 Schema 的 `const` 固定，并由 `public-api.v1.json` 的 `references` 声明 `zhiju.execution.task` / `zhiju.project.project`。`parentTaskRef`/`dependencyTaskRefs` 在两个版本的 Schema 中都是通用 `ObjectRef`，Schema 不约束 Task 身份，因此其逐版本拼写同样必须由 owning Handler 闭合（§16.3），否则错误模块类型或另一版本拼写会进入 parent 查询或被原样固化为 dependency 事实。静态对账见 Module-Test-003 `TE-P202-D-001` 与 `TE-P202-005`。字段分类：`payload`/`definition` 内未在上表列出的引用（`inputRefs`、v2 closed shape 内的 `acceptancePolicyRef`/`evaluatorRef`）不由本表闭合，其规则见 §16.3。

闭合规则（owning Handler 的义务，不由调用者选择）：

1. 逐 operation/version 精确匹配上表，大小写敏感、逐字符相等；另一版本的拼写、裸本地名（如 `Project`）、前缀剥离或补全、`project.project` 与 `zhiju.project.project` 互换一律拒绝（`projectRef`/`deliveryItemRef` → `EXECUTION_PROJECT_REF_INVALID` / `EXECUTION_DELIVERY_ITEM_REF_INVALID`；`parentTaskRef`/`dependencyTaskRefs` → `EXECUTION_PARENT_TASK_REF_INVALID` / `EXECUTION_DEFINITION_REF_INVALID`），不做规范化、不做 fuzzy 查找、不回退 latest。Envelope `targetRef` 的错拼写在 v2 由注册 Schema 的 `const` 拒绝，在 v1 由 #200 的授权绑定拒绝（`IDENTITY_CREATION_TARGET_INVALID`）。
2. `kind` 必须与上表一致：OBJECT（`targetRef`/`projectRef`/`parentTaskRef`/`dependencyTaskRefs[]`）与 VERSIONED（`deliveryItemRef`）。v1 的 `projectRef`/`deliveryItemRef` 与两版本的 `parentTaskRef`/`dependencyTaskRefs` 在注册 Schema 中分别是通用 `objectRef`/`versionedRef`，Schema 不约束身份，因此这些接受集由 owning Handler 与 EnterpriseProject 边界（§16.2）闭合；这是模块层接受集收窄，不修改 v1/v2 Schema、fixture、Registry 元数据或历史 Baseline。
3. 目标 Task 身份：Envelope `targetRef.objectType` 同表固定，`objectId` 由调用方提供（CREATE），Handler 只接受 UuidV7 并在同 Scope 内保证唯一（§16.4）。v1 的 `targetRef` 不携带 objectType const，因此 v1 的 `execution.task` 目标身份由 §16.1 表与 #200 绑定共同闭合，不能作为接受其他 Task 拼写的理由。

### 16.2 Project/DeliveryItem 校验归属：EnterpriseProject owning 内部 Port

**决定（方案 A）**：Project/DeliveryItem 的创建期身份与 Scope 证明由 EnterpriseProject 拥有的内部 Port `TaskExecutionCreationProjectScopePort` 提供，与 #200 的 `TaskExecutionCreationAuthorizationPort` 同构——不是公开 Command/Query、不进 Catalog、不改变任何公开接受集。

- **归属**：EnterpriseProject 拥有实现与闭集键表；TaskExecution 只消费返回事实，不读 EP Repository、表或跨 Schema Join。组合层按已验证 Decision 行构造受信上下文，调用者不能提供或覆盖。
- **输入**：`(commandType, commandVersion, projectRef, deliveryItemRef?)`，两个 Ref 必须与已接受 payload 逐字节相同；期望拼写由 Port 内部按 `commandType@commandVersion` 取值，**不接受调用者传入的期望 objectType**，因此不存在 caller-controlled aliasing。
- **闭集键表**：Port 自有的、以 (version, canonical objectType) 为键的表，映射到 EP owning 的 `enterprise_project.project` 与 `enterprise_project.delivery_item`；复用与 `project.validate_object_scope@1.0` 相同的 SELECT 与 RLS helper 语义（`context_allows_enterprise` / `context_allows_project`），但不共享公开 Query 的键集合，也不新增第二份查询实现。
- **证明谓词**（EP 权威，TaskExecution 只映射结果）：
  - Project identity：`projectRef.objectId == projectRef.scope.projectId == 受信 projectId`，且 `projectRef.scope.enterpriseId == 受信 enterpriseId`。两个 `create_task` Schema 只能约束 Ref 形状（v2 另有 objectType `const`），无法表达这些 UUID 的跨字段相等，因此该相等必须在 Port 内强制；不允许用“受信 projectId 上存在任意 ACTIVE Project 行”代替。
  - Project existence/lifecycle：在受信 `(enterpriseId, projectId)` 内存在已提交 `enterprise_project.project` 行（`(enterprise_id, project_id)` 唯一键），且 `status = 'ACTIVE'`；身份不符、不存在、跨 Enterprise、跨 Project、`SUSPENDED`、`ARCHIVED` 一律拒绝且**外观一致**，不区分“不存在”与“不可见”。
  - DeliveryItem identity：`deliveryItemRef` 的 `objectId`/`versionId`/`scope.enterpriseId`/`scope.projectId` 必须与行 `(delivery_item_id, version_id, enterprise_id, project_id)` 逐字段相等，且 `commitment_status NOT IN ('CANCELLED','REPLACED')`；不允许只比较对象 id，也不允许用受信 Project 内的任意 DeliveryItem 行代替。
- **事务边界**：Port 是只读调用，在 EP 自己的 RLS 事务内执行；TaskExecution 不因此获得 EP 表写权限，也不建立跨 Schema 事务或 FK。Port 不可用或超时不得被解释为空结果或默认通过，调用方 fail closed 并映射共享 `DEPENDENCY_UNAVAILABLE`。
- **失败映射**：Port 对外只返回闭集稳定结果（`VALID` / `INVALID`），identity/kind/scope/existence/lifecycle 四类内部原因由 EP 写入受权限控制的 Audit；TaskExecution 收敛为 `EXECUTION_PROJECT_REF_INVALID` / `EXECUTION_DELIVERY_ITEM_REF_INVALID`，不把 EP 的表/列细节带入公开错误，也不泄露其他 Scope 对象是否存在。
- **历史行为**：`project.validate_object_scope@1.0` 的公开接受集（13 个裸本地名）与其错误外观不变，且不存在 `@2.0`；`zhiju.project.project`、`zhiju.project.delivery_item` 与 `DeliveryItem` 仍不是该公开 Query 的合法输入。若未来需要公开接受 canonical 拼写，必须作为独立的 additive 契约提案显式批准，不能由实现顺带扩大。

未采用方案 B（扩展 `project.validate_object_scope@1.0` 的公开接受集）：它是对已发布、已冻结于 200 项 Baseline 的 FULL 操作做公开接受集变更，需单独批准；该 Query 的结果与错误面无法区分创建所需的身份失败，且允许 Enterprise-only 期望；把 legacy 与 canonical 拼写同时变为合法输入，会为所有消费者制造可互换别名，与 §16.1 的精确身份要求冲突。未采用方案 C（TaskExecution 自行解析拼写后直接读 EP 表）：违反“一个 owning 模块只读写自己 Schema”的边界与 #200 已确立的 owning Port 先例。

### 16.3 DRAFT 创建时的引用校验时机

规则：**语法有效的 Ref 不等于已提交事实**。DRAFT 只证明它必须固化的引用，其余引用在 DRAFT 阶段只做 Scope 闭合与形状校验，存在性与生命周期留给 READY 或对应消费边界。

| TaskDefinition / payload 字段 | DRAFT 创建时必须证明 | 推迟到 READY 或消费时 |
|---|---|---|
| `projectRef`（两版本，必填） | 经 §16.2 Port 证明已提交 Project 行、精确 Enterprise/Project Scope 与 `ACTIVE`；拼写与 kind 按 §16.1 闭合 | — |
| `definition.deliveryItemRef`（可选，VERSIONED） | 经同一 Port 证明精确 `(delivery_item_id, version_id)` 与同一 Project Scope，且未被 CANCELLED/REPLACED；完整 Ref 进入快照 payload 与镜像 | 该 DeliveryItem 后续生命周期变化由 EP owning 事实解释，不回溯改写已提交 DRAFT |
| `definition.parentTaskRef`（可选，OBJECT，本模块自有） | 由本模块在同一命令事务内只读校验：objectType 为 §16.1 表固定的 Task 拼写、同 Scope 已提交 Task、`status <> 'CANCELLED'`、非自引用（`objectId != targetRef.objectId`）；不合格拒绝 `EXECUTION_PARENT_TASK_REF_INVALID`（不跨模块、不需要 EP Port） | 父 Task 的后续状态与父子完成关系由 owning 事实与 §11.6 解释 |
| `definition.dependencyTaskRefs` | objectType 为 §16.1 表固定的 Task 拼写、kind OBJECT、Scope 与 Envelope 完全一致（同 Enterprise/Project，禁止跨 Project 直接 TaskId，Domain §18.6 第 2 条）、非自引用、集合去重由 Schema/Set 语义保证；不合格拒绝 `EXECUTION_DEFINITION_REF_INVALID`（不在 DRAFT 解析被引用 Task 是否存在） | 依赖存在性、环检测、依赖 Task 当前有效性（Readiness，§11.6、§11.8） |
| `definition.inputRefs` | 形状合法（`TypedReference[]`），且 Scope 落在 Envelope 内：Platform `{}` 允许、Enterprise 必须同 `enterpriseId`、Project 必须同 `enterpriseId`+`projectId`；`ExternalRef` 按无顶层 `scope` 的分支处理——`tenantOrAccountRef.scope` 必须落在 Envelope 内，未携带 `tenantOrAccountRef` 时作为无租户绑定的来源意图接受但不得作为正式输入事实；跨 Enterprise/Project 拒绝 `EXECUTION_DEFINITION_REF_INVALID` | 输入存在性、版本、生命周期、可用性与 Purpose 裁剪（Readiness 与 Context Builder）；`ExternalRef` 必须先经 owning 授权 Adapter/Domain Command 形成正式对象 |
| `expectedOutputSpec.outputs[].acceptancePolicyRef`、`completionCriteria.criteria[].evaluatorRef`（v2 closed shape） | 仅注册 Schema 与纯绑定校验（`validateTaskDefinitionBinding`），并校验 Scope 包含关系：Platform `{}` 允许、Enterprise 必须同 `enterpriseId`、Project 必须同 `enterpriseId`+`projectId`，跨 Enterprise/Project 拒绝 `EXECUTION_DEFINITION_REF_INVALID`；不在 DRAFT 解析引用是否存在。已批准 Evaluator selector 是 Platform Scope（`contracts/registry/evaluator-profiles.v1.json` 的 `scope: {}`），注册 v2 正例的 `evaluatorRef` 是同企业 Enterprise Scope，两者都必须在 DRAFT 通过 | Evaluator profile 与 Policy 版本的存在性、支持边界与当前有效性（Readiness/Validation/Completion，§11.6、§11.9；不支持时为 `EXECUTION_CRITERION_UNSUPPORTED`） |
| `initialAssignee`（开放形状） | 仅作为定义载荷记录并进入快照 Hash；DRAFT 不据此签发 Capability 或 Assignment | 指派语义与权限走 Domain §18.4 的显式 Command 与 §18.8 的授权边界 |
| `dueConstraint` | 形状与 Hash | 期限对 Readiness、冻结与执行的影响 |

Scope 规则按引用形态闭合。共享 `ScopeRef` 只允许三种形态（`{}`、`{enterpriseId}`、`{enterpriseId, projectId}`；只带 `projectId` 由 Schema 的 `dependentRequired` 拒绝）：

| 引用 Scope 形态 | 规则 | 允许的字段 |
|---|---|---|
| Platform `{}` | 仅在字段本身允许 Platform 身份时接受；Project 锚定字段不接受 | `inputRefs`、v2 `acceptancePolicyRef`/`evaluatorRef` |
| Enterprise `{enterpriseId}` | 必须 `enterpriseId == Envelope scopeRef.enterpriseId`；Project 锚定字段不接受（必须携带 `projectId`） | `inputRefs`、v2 `acceptancePolicyRef`/`evaluatorRef` |
| Project `{enterpriseId, projectId}` | 两个维度都必须等于 Envelope scopeRef；Project 锚定字段的唯一合法形态 | 全部字段 |

- **Project 锚定字段**（`payload.projectRef`、`definition.deliveryItemRef`、`definition.parentTaskRef`、`definition.dependencyTaskRefs[]`）：`scope` 必须是 Project 形态且与 Envelope `scopeRef` 逐字段相等；这些字段还必须满足 §16.1 的逐版本 objectType 闭集。`projectRef` 另有 `objectId == scope.projectId == 受信 projectId` 的身份相等要求（§16.2）。
- **`definition.inputRefs`**：保留引用自身 Scope，但必须落在 Envelope Scope 内——Enterprise 形态要求同一 `enterpriseId`，Project 形态要求 `enterpriseId` 与 `projectId` 都相等，Platform 形态允许。跨 Enterprise 或跨 Project 的引用在 DRAFT 直接拒绝（`EXECUTION_DEFINITION_REF_INVALID`），不进入不可变快照。其存在性、版本、生命周期与可用性属于 Readiness 与消费边界。
- **`definition.inputRefs` 中的 `ExternalRef`**：`ExternalRef` 没有顶层 `scope`（`contracts/src/common.schema.ts` 的 `externalRef` 只要求 `system`/`resourceType`/`externalId`/`observedAt`，另带可选 `tenantOrAccountRef: ObjectRef`、`payloadHash`、`adapterVersion`），因此不套用上表三形态，也不得因缺少顶层 `scope` 而被拒绝或跳过校验，按两个分支处理：
  - 携带 `tenantOrAccountRef`：其 `scope` 必须落在 Envelope Scope 内（Platform `{}` 允许、Enterprise 同 `enterpriseId`、Project 同时同 `enterpriseId`/`projectId`）；跨 Enterprise/Project 在 DRAFT 拒绝 `EXECUTION_DEFINITION_REF_INVALID`。
  - 未携带 `tenantOrAccountRef`：DRAFT 接受该无租户绑定的外部定位符，但它只是**声明的来源意图**——不得作为输入存在性、Readiness、blocker 或完成条件的事实依据，也不得替代正式对象。按 [HL-06 §3.10](../high-level-docs/06-typed-references-contract-catalog-v0.1.md#310-externalref) 与 Domain §19.7 第 3 条，`ExternalRef` 必须先由 owning 模块的授权 Adapter/Domain Command 验证并形成 SourceMaterial/AnswerSubmission/Receipt 等正式对象，才能作为正式输入被消费；§11.6 的 `OUTPUT_REF_VALID` 同样不接受 `ExternalRef`/Workspace path。
- **v2 closed shape 内的 `expectedOutputSpec.outputs[].acceptancePolicyRef` 与 `completionCriteria.criteria[].evaluatorRef`**：同样必须落在 Envelope Scope 内（Enterprise 形态同 Enterprise、Project 形态同 Enterprise+Project、Platform 形态允许），跨 Enterprise/Project 在 DRAFT 拒绝（`EXECUTION_DEFINITION_REF_INVALID`）。已批准 Evaluator selector 的 Platform Scope（`scope: {}`）与注册 v2 正例中的同企业 Enterprise-scope `evaluatorRef` 都必须通过；这仍只是**形态与包含关系**校验，引用的存在性、支持版本与当前有效性在 Readiness/Validation/Completion 判定（§11.6、§11.9）。创建期可判定的 tenant 包含关系不推迟，避免把跨租户引用固化进不可变 TaskDefinitionSnapshot。

两版本在 `inputRefs` 上的既有兼容差异保持不变：v1 沿用历史 `uniqueItems`，v2 接受重复引用（§11.6）。

### 16.4 创建事实、快照身份与幂等

一次成功的 DRAFT 创建在同一 owning 事务内提交下列事实；任一步失败整体回滚，不留 PENDING Receipt 或孤立事实。

| 事实 | 内容与约束 |
|---|---|
| `task_execution.task`（Aggregate Root） | `task_id` = 已校验 Envelope `targetRef.objectId`（UuidV7）；`enterprise_id`/`project_id` 受信 Scope 镜像；`status='DRAFT'`、`aggregate_version=1`；`current_definition_snapshot_id` + `current_definition_hash` 组合指针；可选 `delivery_item_id`/`delivery_item_version_id` 镜像；`created_at`、`created_by_principal_id`。Scope 列创建后不可变 |
| `task_execution.task_definition_snapshot`（不可变事实） | `snapshot_id`（UuidV7，应用生成，**独立于** `aggregate_version`）；`task_id`；`schema_version`（`1.0` = `TaskDefinition` payload，`2.0` = `TaskDefinitionV2` payload）；`canonical_payload`（本次命令 payload 的规范 JSON，逐字节保留 `projectRef`/`definition`/可选 `initialAssignee`）；`payload_hash`（SHA-256、32 字节、canonicalization v1）；Project/DeliveryItem 提升镜像与 Scope 镜像；`source_command_id`。整表对 app 角色无 UPDATE/DELETE |
| Root 组合指针 | `(task_id, current_definition_snapshot_id, current_definition_hash)` 组合 FK 指向同 Task 的 snapshot 行；比较必须含 hash，不能只比较 `snapshot_id`，也不能把 `aggregate_version` 当 `snapshot_id`（PostgreSQL §33） |
| `command_receipt` | 沿用 #151 runner：同键同输入返回原结果，同键异 hash `IDEMPOTENCY_PAYLOAD_CONFLICT` 且写 DENIED Audit |
| `audit_record` | 成功与拒绝（含幂等冲突、EP 校验拒绝）都留稳定 `error_code`；不记录客户正文 |
| `reference_edge` | 只对**本事务已证明存在**的引用写入：`projectRef`、可选 `deliveryItemRef`、可选 `parentTaskRef`（owner 为本次 Task，target module/type 使用对应版本的拼写）。`dependencyTaskRefs`、`inputRefs` 与 v2 的 `acceptancePolicyRef`/`evaluatorRef` 只存在于不可变快照 payload；其 Edge 由证明其存在与当前有效的 owning 动作在各自事务写入，避免指向未提交对象的悬空 Edge |
| `outbox_event` | 0 行（§16.5） |

镜像与 Hash 必须由应用计算、并受与既有技术表相同的数据库 guard 约束：提升列（Scope、`delivery_item_*`、`schema_version`、`payload_hash`）与 `canonical_payload` 逐项一致，Hash 覆盖完整 payload（含存在性而非仅值），禁止只校验 Hash 长度或只比较 `snapshot_id`。

**幂等与跨版本冲突**：#151 runner 以 `(idempotency_scope, idempotency_key)` 唯一、以 `request_payload_hash` 判定异输入。创建入口必须额外保证：

1. `idempotency_scope` 由服务端组合（含精确 `commandType@commandVersion` 与 Project Scope），不接受调用者自选。
2. 返回历史 Receipt 前必须比较持久化的 `command_type`/`command_version`（以及 `target_type`/`target_id` 镜像）与本次命令；不一致即拒绝为 `IDEMPOTENCY_PAYLOAD_CONFLICT` 并写 DENIED Audit，不返回另一版本的 Receipt。原因是 v1 的 `projectRef` 为通用 `objectRef`，v1 请求的规范 payload 可能与 v2 请求逐字节相同，仅靠 `request_payload_hash` 无法区分版本。
3. 同 operation/version、同键、同 hash 的重放返回原结果，不新增 Root/Snapshot/Edge/Event；跨版本永远不是等价重试，也没有授权继承（§15.3 第 4 条）。
4. CREATE 目标在同一 Project Scope 已存在时拒绝 `EXECUTION_TASK_ALREADY_EXISTS`，不写第二条 Root；并发同目标由唯一约束与事务裁决为单一成功。
5. EP 校验只在**首次提交**（取得幂等 Claim 后、首个业务写入前）执行；重放路径仍重新授权（§16.6）但不重跑业务证明，历史 Receipt 按原样返回——Project 或 DeliveryItem 后续归档/取消不改写已提交 DRAFT 历史。

### 16.5 公开事件边界

DRAFT 创建**有意不产生任何公开业务 Event**：本次事务不写 `outbox_event`。已注册的 Task 公开事件只有 `execution.TaskReady@1.0` 与 `execution.TaskCompleted@1.0`（当前 Catalog 213 项共 11 个 `execution.*` Event，没有 `TaskCreated`）。Domain §18.7 的 `TaskCreated` 只是 Domain 词汇，不构成发布依据；Handler 不得发布未注册 Event，也不得从 Domain 事件列表反推公开事件。

若未来需要 `TaskCreated`（或任何 DRAFT 阶段事件），必须作为独立 additive 契约提案批准：Registry 与兼容元数据条目、Catalog 计数（213 → 214）、reference 声明、生成的 Envelope/Result 与正负 fixture 一并交付；本节不预先注册，也不把该计数变化计入本次 revision。

### 16.6 授权与校验顺序（fail closed）

单一顺序，任一步失败即拒绝且无业务副作用：

1. Registry 按精确 `(commandType, commandVersion)` 校验 Envelope/Payload（含 v2 的 `targetRef`/`projectRef` const 与 closed shape）。
2. 组合层从已验证 Decision 行派生受信上下文；调用者传入的 expected 值不参与判定（§15.3 第 1 条）。
3. **在幂等 Claim 与历史 Receipt 返回之前**调用 `TaskExecutionCreationAuthorizationPort.revalidateCreation`：比较精确 Decision id/hash、Actor 与实际 principal、认证上下文、operation/version/Purpose、payload hash、`targetRef`（objectType/objectId/Project Scope）、ALLOW 与未过期，并以当次受信时间重读当前 covering Grant/Policy；撤销、到期、配置漂移、target 或版本替换、IdentityPolicy 不可用一律 fail closed（决定 §14.3，实现见 #200）。
4. 取得幂等 Claim 后、首个业务写入前调用 `TaskExecutionCreationProjectScopePort` 证明 Project/DeliveryItem（§16.2）；业务拒绝按 §16.7 映射，依赖不可用映射共享 `DEPENDENCY_UNAVAILABLE`，两者都不得留下 PENDING Receipt 或部分事实。
5. 同一 owning 事务写入 §16.4 的事实并 finalize Receipt/Audit。
6. 重放路径：仍执行第 3 步（历史 Receipt 不恢复授权资格），不执行第 4 步，不产生新事实。

### 16.7 TaskDefinitionSnapshot 的未来引用身份

`TaskDefinitionSnapshot` 的公开引用身份在**本 revision 不注册**，以免静默发明 objectType：DRAFT 创建不返回该 Ref（`execution.create_task` 两个版本都没有 operation-specific Result Schema），也不改写 v1 payload 或既有 Catalog。

未来需要返回或消费该 Ref 的切片（例如设计的 `execution.build_task_readiness@1.0` 或 Task 读取 Query）必须先取得 additive 契约批准，并同时注册：`zhiju.execution.task_definition_snapshot`，Owner `task-execution`，kind `CONTENT_ADDRESSED`，Project Scope，不可变、不另建可变版本、不可作为 BusinessOutput；Ref 形状为 `{kind: 'CONTENT_ADDRESSED', objectType: 'zhiju.execution.task_definition_snapshot', objectId: <snapshot_id>, contentHash: <payload_hash>}`，解引用按 exact `objectId` + 完整 canonical payload Hash，不使用 `aggregate_version` 或 latest。任务与快照的关联由 `task_id` 持有，不由 Ref 携带。

### 16.8 错误码与验收

新增且仅新增以下模块稳定码（随实现注册，本节只固定语义，不新的注册表）：

```text
EXECUTION_PROJECT_REF_INVALID
EXECUTION_DELIVERY_ITEM_REF_INVALID
EXECUTION_PARENT_TASK_REF_INVALID
EXECUTION_DEFINITION_REF_INVALID
EXECUTION_TASK_ALREADY_EXISTS
```

`EXECUTION_DEFINITION_REF_INVALID` 覆盖定义内其它引用（`dependencyTaskRefs`、`inputRefs`、v2 closed shape 的 `acceptancePolicyRef`/`evaluatorRef`）的 objectType/身份不闭合、Scope 不落在 Envelope 内（跨 Enterprise 或跨 Project，含 `ExternalRef.tenantOrAccountRef.scope`）与自引用；`EXECUTION_PROJECT_REF_INVALID`/`EXECUTION_DELIVERY_ITEM_REF_INVALID` 覆盖 §16.1 的拼写/kind 拒绝与 §16.2 的 Project/DeliveryItem 业务拒绝。依赖暂时不可用复用共享 `DEPENDENCY_UNAVAILABLE`，幂等冲突复用 `IDEMPOTENCY_PAYLOAD_CONFLICT`，授权错误沿用 §15.3 的共享码与 IdentityPolicy 内部原因（仅入安全 Audit）。

验收矩阵与设计/静态检查分离见 [Module Test 003](../module-tests/Module-Test-003-TaskExecution.md#task-draft-创建引用与持久化边界202-approved-design)：本节的 Schema/映射/时序静态分量可由 `TE-P202-D-*` 对账，Handler、真实 PostgreSQL、RLS/ACL、直 SQL 篡改、并发与回滚仍为 `NOT RUN`，直到对应实现切片交付。

### 16.9 实现事实与验证边界（#204，2026-09-15）

状态：`HANDLER, ENTERPRISE-PROJECT PORT, V3001 SCOPED PERSISTENCE AND COMPOSITION ENTRY IMPLEMENTED / REAL POSTGRESQL PASS / MERGED IN PR #205（2026-09-16）/ TASK READY AND OTHER IM-06 BEHAVIOR NOT RUN`。

- 入口：`handleCreateTask`（`modules/task-execution/src/business/task-draft-creation.ts`）持有两个 `create_task` Major 的全部 §16.1/§16.3 闭集判定与创建事实写入；写入经 runner 绑定的 `insertTaskDraftRoot`/`insertTaskDraftDefinition`（`persistence/command-runner.ts`），行 identity/Scope 必须等于本次命令 target，Root 主键是并发单赢家边界，Root 未插入即 `EXECUTION_TASK_ALREADY_EXISTS`。Runner 在返回历史 Receipt 前比较持久化的 `command_type`/`command_version`/`target_type`/`target_id`，不一致按 `IDEMPOTENCY_PAYLOAD_CONFLICT` 拒绝并写 DENIED Audit，跨 Major 不返回对方 Receipt。
- 持久化：`V3001__task_draft_creation.sql` 新增 `task_execution.task` 与 `task_execution.task_definition_snapshot`；Root 组合指针 `(task_id, current_definition_snapshot_id, current_definition_hash)` 以 deferrable 组合 FK 指向同 Task 快照行；两表 FORCE RLS + `context_allows_project`，app 角色无快照 UPDATE/DELETE 与 Root DELETE，Scope 列有 immutable guard；DRAFT 创建不写 `outbox_event`。
- 快照提升列由两个 guard 与一组 NULL-safe CHECK 联合闭合：`SECURITY DEFINER` 的 mirror guard 依 `canonical_jsonb_text` 重算并逐项核对 Scope、`delivery_item_*` 与 `payload_hash`；`SECURITY INVOKER` 的 creation-identity guard 要求该快照所属 `command_receipt`（`source_command_id`）是 `execution.create_task`、其 `command_version` 等于提升列 `schema_version`、其 target 身份与 Scope 等于本快照的 Task/Scope、其 `request_payload_hash` 恰好等于 `payload_hash`，且该 Receipt 仍是 `PENDING`——即该 Snapshot 必须由**声称的那条命令自身的在途事务**写入。因此 `source_command_id` 证明的不只是命令身份，而是“这份定义就是该命令请求的 payload”：复用一张真实 Receipt 换内容、把 v2 payload 改写为 `1.0` 或事后补写快照都无法成立。payload→标签方向由 NULL-safe CHECK 闭合：声明 `2.0` 的 payload 必须具备 v2 closed `expectedOutputSpec`（含 `schemaVersion='1.0'` 与 `outputs[]`）与 `completionCriteria`（含 `schemaVersion='1.0'` 与 `criteria[]`）；v1 的两个成员按契约仍是开放 CanonicalJson，因此一条 v1 命令合法携带 v2 形状成员时仍记 `1.0`，该边界由回归固定而不是被静默收窄。
- Root 的 `current_definition_*` 只能作为 CAS 转换改变：UPDATE guard 要求指针变化时 `aggregate_version` 必须前进，因此把 current pointer 指向“仅存在但并非本次创建事实”的快照会被拒绝，定义身份不会被静默替换。
- `task_execution.canonical_jsonb_text` 与共享内核 canonicalization v1 等价：NFC 归一化字符串与键、UTF-8 字节序、安全整数，并拒绝归一化后碰撞的属性名（`"é"` 与 `"e\u0301"` 同时出现时两者都拒绝）。等价性由真实入口回归证明：含 NFC 归一化、字节序、转义、安全整数（含 `-0`）、空容器与嵌套的 payload 创建成功后，数据库重算的 `sha256(canonical_jsonb_text(...))` 必须等于应用计算的 `payload_hash`；碰撞 payload 在两侧都被拒绝。
- EnterpriseProject Port：`createTaskExecutionCreationProjectScopePort`（`modules/enterprise-project/src/business/task-execution-creation-scope-port.ts`）按 `commandType@version` 闭集键表证明 Project 身份相等与 `ACTIVE` 生命周期、可选 DeliveryItem 的精确 `(delivery_item_id, version_id, enterprise_id, project_id)` 且非 CANCELLED/REPLACED；对外只返回 `VALID`/`INVALID`，内部原因写 EP `audit_record`（`TASK_CREATION_SCOPE_*`），`project.validate_object_scope@1.0` 的接受集与错误外观不变。
- 组合入口：`createCreateTaskEntry`（`apps/api/src/composition/create-task-entry.ts`）按精确版本校验注册 Envelope、读取并绑定 Decision 行与 actor，在幂等 Claim 与历史 Receipt 返回之前调用 `revalidateCreation`，随后进入 owning 事务；EP Port 在取得 Claim 之后、首个业务写入之前调用（Project 先证明、可选 DeliveryItem 后证明，以保留 §16.8 的两个稳定码且不泄露 EP 内部原因）。`idempotency_scope` 由服务端按 `commandType@version` + Project Scope 组合（`createTaskIdempotencyScope`），不接受调用者传入。
- 已验证：`TE-P202-001`–`015` 在真实 PostgreSQL 18.6 通过，覆盖引用身份/Scope 包含、Project/DeliveryItem 证明、ACL/RLS 探针、owner 直 SQL 篡改（含 Receipt 请求哈希绑定、`schema_version` 重标、指针 CAS 与 canonicalization 跨层对照）、并发单赢家、跨版本 Receipt 冲突、注入故障回滚、依赖不可用与零 Outbox；完整验证见 `vibe verify full --json`。
- 边界：v2 的 `targetRef`/`projectRef` 拼写由注册 Schema 的 `const` 先行拒绝（公开 `API_VALUE_INVALID`），owning Handler 对 Schema 未闭合的引用（v1 `projectRef`、两版本 `parentTaskRef`/`dependencyTaskRefs`/`inputRefs`/v2 policy-evaluator refs）与 Schema 已拒绝的拼写仍按 §16.1/§16.3 拒绝；`commitment_status IN ('CANCELLED','REPLACED')` 分支无合法事实可产生（`V2011`/`V2013` 把该列固定为 `PROPOSED` 且拒绝其 UPDATE），保持 `NOT RUN`。
- 未改变：Catalog 213 与历史 Baseline 200、v1 冻结 fixture 逐字节不变、两个 `create_task` Major 的注册 Schema 与公开接受集、`TaskDefinitionSnapshot` 不注册 objectType、不新增公开 Query/Event；Task READY、WorkOrder、Run/Attempt/Result、Completion 与人工业务验收不在本切片。

### 16.10 交付闭环（#204，2026-09-16）

- PR [#205](https://github.com/qzhike/zhiju-business-core/pull/205) 以 reviewed head `794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1` 通过四轮独立审查（第 1、2 轮的 blocking findings 为 Snapshot `schema_version` 身份、canonicalizer NFC 键碰撞与 Receipt `request_payload_hash` 内容绑定，均已随回归关闭），最终结论 `APPROVE`，并记录了 authorization/RLS/immutable-persistence 人类技术批准；批准记录保存在 [`.vibe/reviews/pr-205/Review.md`](../reviews/pr-205/Review.md)。
- 记录审查结论的 `357ebfb091a56131c97d9c455698a087137d794e`（仅新增 pre-close review 文档）在 [verify run 35058972506](https://github.com/qzhike/zhiju-business-core/actions/runs/35058972506) 为 `pass`；代码 revision 的 [verify run 35056590645](https://github.com/qzhike/zhiju-business-core/actions/runs/35056590645) 同为 `pass`，与同 SHA 的 `vibe verify full --json` PASS 一致。
- 以 merge commit `7faba0ab65444a816225e7fde21d9e5b758cd1a4` 合入 `main`（2026-09-16T05:31:35Z）；Issue [#204](https://github.com/qzhike/zhiju-business-core/issues/204) 已读回为 `CLOSED`（`COMPLETED`，2026-09-16T05:33:04Z），远端与本地 feature branch 均已删除。
- 已接受边界与后续候选：Receipt 必由授权 runner 产生仍属受信应用边界；`enterprise_project.canonical_jsonb_text`（V2015，#191）存在同一 NFC 键碰撞缺口，需独立 forward migration 修复；`PENDING` outcome 的完全隔离负例为建议性增强。
