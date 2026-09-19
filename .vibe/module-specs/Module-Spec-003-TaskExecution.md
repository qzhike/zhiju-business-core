# Module-Spec-003-TaskExecution

版本：v0.2
日期：2026-08-17
状态：`FIELD-LEVEL IDL BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / PR #10 SCHEMA REMEDIATION USER REVIEWED 2026-08-17 / PR #12 INTEGRATION GATE PASSED / IM-06 WI-01 APPLICATION & PERSISTENCE FOUNDATION IMPLEMENTED 2026-09-08 / #165 DRAFT VERSION PINS @1.1 CONTRACT IMPLEMENTED 2026-09-11 / #202 TASK DRAFT CREATION REFERENCE AND PERSISTENCE BOUNDARY APPROVED AND IMPLEMENTED (#204, V3001) 2026-09-15 / #206 TASK READINESS PRODUCTION AND READY TRANSITION BOUNDARY DESIGN MERGED 2026-09-16 (PR #207) / #208 TASK READINESS PRODUCER, READY CONSUMER, V3002 AND BOTH AUTHORIZATION ENTRIES IMPLEMENTED 2026-09-16 (CATALOG 214, TE-P206-001–018 EXECUTED ON REAL PostgreSQL; COMPLETED-DEPENDENCY AND BLOCKING-INFORMATIONREQUEST BRANCHES NOT RUN) / OTHER HANDLER IMPLEMENTATION NOT STARTED / #210 WORKORDER DRAFT CREATION, EXACT DRAFT READ AND PRINCIPAL-KIND PLATFORM DELTA DESIGN APPROVED 2026-09-17 (SECTION 18; REVIEWED 67e5df57; HUMAN APPROVAL RECORDED) / #212 WORKORDER DRAFT CREATION AND EXACT DRAFT READ, IDENTITYPOLICY PORTS AND PLATFORM V0004 IMPLEMENTED 2026-09-18 (CATALOG 215, V3003, TE-P210-001–023 EXECUTED ON REAL PostgreSQL 18.6; TWO SUB-BRANCHES NOT RUN) / #214 INITIAL CONTEXT BUILD AND EXACT SNAPSHOT READ DESIGN APPROVED 2026-09-18 (PR #215) / #216 INITIAL CONTEXT BUILD, AUTHORITATIVE SNAPSHOT READ, IDENTITYPOLICY PORT AND V3004 IMPLEMENTED 2026-09-19 (CATALOG 215 UNCHANGED, TE-214-D-001–018 EXECUTED ON REAL PostgreSQL 18.6, FIVE SUB-BRANCHES NOT RUN; VERIFY FULL PASS 2026-09-19, INDEPENDENT REVIEW AND PR PENDING)`

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
| `execution.mark_task_ready@1.0` | `Task / MUTATE` | `readinessSnapshotRef: SnapshotRef<TaskReadiness>; requestedAt: UtcInstant` | `task.execution.mark_task_ready`（已发布值，2026-09-16 按 §15.1 同一规则修正本行设计期文字；见 §17.4）；依赖、输入、权限满足；不接受调用者布尔值或调用者时间 |
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
EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH
EXECUTION_DRAFT_SNAPSHOT_STALE
EXECUTION_CONTEXT_SOURCE_INVALID
EXECUTION_CONTEXT_TARGET_INVALID
EXECUTION_CONTEXT_INPUT_REQUIRED
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

- 44 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已由用户审核；Runtime Adapter v0.1 已获用户推进确认并进入 Implementation Milestone Plan，同时保留 6 个尚未纳入基准的 additive Command；
- `contracts/src/operations/task-execution.schema.ts` 已注册基线 37 个操作、#158 的 @1.0 Draft/initial Context 两项操作、#165 的三个 @1.1 兼容操作及 #175 的 `execution.create_task@2.0`；PR #10 Review 识别的 8 类 strict Schema 偏差均已修复，Draft/initial Context 正负向 Contract 回归已补齐；
- TaskExecution 直接复用权威 `core/work-order/1.0#/$defs/*`；WorkOrder Core Contract 与 `create_work_order` 使用同一组 `$defs`，且 `requestedBy` 统一为 `PrincipalRef`；Core Contract 不再被开放 `CanonicalJson` 降级；
- 注册到 `ContractRegistry` 后所有 44 项 TaskExecution `schemaStatus` 为 `FULL`；当前全仓 Catalog/Registry 为 214 项（#183 追加两个 IdentityPolicy PolicyVersion 操作，#191/#192 追加两个权威 Query，#208 追加 `execution.build_task_readiness@1.0`），历史 Compatibility Baseline 仍为 200 项；
- 6 个 Runtime Adapter additive Command（heartbeat / progress / suspend / resume / authoritative usage / cancellation ack）仍未进入本模块 Schema 与当前 214 项 Registry，等待用户审核通过后单独补齐；
- IM-06 WI-01（Issue #151）落地模块自有 application/persistence 基础：`@zhiju/task-execution` 提供 Kysely schema、`createTaskExecutionDatabase`、`withTaskExecutionTransaction`、`executeTaskExecutionCommand`、`TaskExecutionRepository`，单一受信事务上下文建立路径，幂等/CAS/Scope mirror/Process 父子 Scope/Hash 一致性 guard 与 controlled fault 回滚均已落实；可由 disposable PostgreSQL gate 复测；
- Context Builder、Dispatcher、Runtime、Projection 与 WorkOrder/Context/Run/Completion/Query 的业务 Handler 仍不存在；模块自有业务 Repository 目前只服务 Task DRAFT 创建与 Task Readiness 判断/READY 转换，不与任何其他模块 Repository 或跨 Schema 读取交叉；
- #206 设计（2026-09-16，本节 §17）固定 Task Readiness 生产与 READY 转换边界，并已由 #208 实现（实现事实见 §17.11）：`execution.build_task_readiness@1.0` 为唯一新增 operation（Catalog 213 → 214，历史 Baseline 200 不变）、`zhiju.execution.task_readiness` 与已决定的 `zhiju.execution.task_definition_snapshot` 为本切片注册的两个引用身份、两个 create-task Major 的 Task 寻址按创建事实版本绑定、生产者不发布事件而消费者发布恰一条 `execution.TaskReady@1.0`。Readiness Handler、`execution_judgment` 持久化（`V3002`）、Spec 001 §15.5 两个授权 Port 条目与 READY 转换均已交付并在真实 PostgreSQL 上执行 `TE-P206-001`–`018`；依赖已 `COMPLETED` 的 Completion Evaluation 可用性分支与 blocking InformationRequest 分支仍 `NOT RUN`，因为它们依赖的上游 producer 尚未交付；
- 对应 Unit、Contract、E2E 与人工验收中，Schema fixture、Review 修复回归、IM-06 WI-01 持久化 gate 以及 #208 的 `TE-P206-001`–`018`（真实 PostgreSQL）已执行；WorkOrder/Context/Run/Completion/Query 的 Handler、Runtime/DB E2E、外部 Provider 与人工业务验收仍为 `NOT RUN`。

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

状态：`TECHNICAL DESIGN APPROVED 2026-09-08 / EXPIRY ADDENDUM APPROVED 2026-09-09 / CONTRACT SCHEMA AND REGISTRY IMPLEMENTED 2026-09-10 / BUILDER POLICY BINDING CONTRACT IMPLEMENTED 2026-09-11 / #165 DRAFT VERSION PINS @1.1 CONTRACT IMPLEMENTED 2026-09-11 / #167 INITIAL CONTEXT RESULT CONTRACT IMPLEMENTED 2026-09-12 / #175 TASK V2 CREATION CONTRACT IMPLEMENTED 2026-09-12 / #176 POLICY/EVALUATOR RESOLUTION APPROVED 2026-09-12 DESIGN VERIFIED / #183 POLICYVERSION STATIC CONTRACT REGISTERED 2026-09-13 / #214 INITIAL CONTEXT BUILD AND EXACT SNAPSHOT-READ DESIGN APPROVED 2026-09-18（§19，PR #215）AND IMPLEMENTED 2026-09-19 BY Issue #216（V3004；VERIFY FULL PASS 2026-09-19、INDEPENDENT REVIEW AND PR PENDING）`。设计方向已获批准；本节是 #152–#154 经用户批准的字段设计基准，批准范围为 [技术决定 TD-01–04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)。第 2–6 节既有 @1.0 定义及历史 200 项 Compatibility Baseline 不变；当前全仓 Registry 为 213 项。本节不把 Domain 内部命令名自动视为公开 API。

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

Hash 在 Ref/持久化完整性列保存，payload 不嵌自身 Hash。Draft Snapshot 的 id 与 Contract/业务版本 id 不混用；Root aggregateVersion 仅用于 CAS。首次 @1.1 请求不携带尚不存在的 workOrderContractRef，不带 answeredInformationRefs；回答后的构建继续使用旧 `ContextBuildRequest@1.0`。首次与后续操作共享同一 ProjectContext v1.0 输出和 `ContextSnapshotBuilt@1.0`，不修改旧事件字段；既有 @1.0 合法调用保持原字段形状（`build_initial_context_snapshot@1.0` 的 Schema/Envelope 字段形状不变，但其业务可满足性由 §19.1（R-214-1）判定并精确 supersede 本节与 §11.2.6 的既有表述：无满足输入、无 Handler、无授权路径、所有调用 fail closed——“形状合法”仅指 Schema 接受原字段，不构成可成功的业务输入）。

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

状态：`APPROVED DESIGN / SCHEMA, REGISTRY, GENERATED TYPES AND FIXTURES IMPLEMENTED 2026-09-11 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。本节把批准的 DRAFT/Context 解环边界落到可执行契约；不改变既有 @1.0 的 Schema/Envelope 字段形状（`build_initial_context_snapshot@1.0` 的业务可满足性由 §19.1（R-214-1）判定并精确 supersede：该版本无满足输入、不实现、不建授权路径，见该节）。

`InitialWorkOrderDraft@1.1` 复用 `WorkOrderDraft` 的全部业务字段，但 `versionPins` 使用独立的 `DraftVersionPins@1.1`。其必填字段为 `contextBuilderPolicyRef`、`workOrderSchemaRef`、`skillRefs`、`templateRefs`、`capabilityPolicyRef` 和 `runtimeAdapterContractRef`；`regulatoryProfileRef` 与 `qualityProfileRef` 可选。`contextBuilderPolicyRef` 必须是 `VersionedRef` 且 `objectType=zhiju.identity.policy`；各数组保持唯一。`DraftVersionPins` 明确不允许 `projectContextContractRef`，该字段不能以空值、占位 Ref 或预分配 Hash 的形式出现在 DRAFT。

以下三个版本化操作与旧版本并存：`create_work_order@1.1` 接受 `InitialWorkOrderDraft`，`get_work_order_draft@1.1` 返回同一 DRAFT 形状，`build_initial_context_snapshot@1.1` 只接受 `draftSnapshotRef`、projection、purpose、audience、sourceSlices、builderPolicyRef 和可选 expiresAt。旧 `create_work_order@1.0`、`get_work_order_draft@1.0` 与冻结后 `build_context_snapshot@1.0` 的合法字段和 Envelope 语义保持不变；`build_initial_context_snapshot@1.0` 同样保持字段形状与 Envelope 语义不变，但按 §19.1（R-214-1）其业务上无可满足输入——Schema 仍接受原字段形状，不存在可成功调用，本节“与旧版本并存”仅指契约层的形状共存。

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
- 本节所有行为在批准与实现前保持 `NOT RUN`；Schema/纯 helper 通过不证明 Policy 对象存在、当前授权有效或 Handler 已实现。TaskReadinessBuilder 的输入算法、依赖/输入/blocker 集合、`validUntil` 组合与失败面已由 §17（#206 设计）固定，仍未注册、未实现。

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

## 17. Task Readiness 生产与 READY 转换边界（#206 设计）

状态：`T2 / DESIGN MERGED 2026-09-16（PR #207，merge commit 47966816e9ba96dc89b21d502176dfc413cfd7bc）/ INDEPENDENT DESIGN REVIEW APPROVE 2026-09-16（reviewed revision 2155d4dd89437694632c0e35ca65b7d6d46d720f）/ EXPLICIT HUMAN DESIGN APPROVAL RECORDED 2026-09-16（Issue #206）/ IMPLEMENTED 2026-09-16 BY Issue #208（契约、两个 objectType、`EXECUTION_TASK_REF_INVALID` 注册、Spec 001 §15.5 两条授权条目、V3002、生产者与 READY 消费者 Handler、组成层接线、TE-P206-001–018 真实 PostgreSQL；实现事实见 §17.11）/ MERGED 2026-09-16（PR #209，merge commit `0dc1bcef9a9f1e21219a015ac0f8b5d6768fe250`，Issue #208 已关闭）/ INDEPENDENT REVIEW APPROVE ON `c09dd80f5bd81f19dadb31d2c31868863e9f6c94`（正式记录见 `.vibe/reviews/pr-209/Review.md`）/ HUMAN TECHNICAL REVIEW RECORDED/ COMPLETED 依赖可用性与 blocking InformationRequest 分支 NOT RUN / WorkOrder、Context、Run/Completion 与人工业务验收 NOT RUN`。本节回应 [Issue #206](https://github.com/qzhike/zhiju-business-core/issues/206)，把 #154 已批准的权威判断原则、#176 已批准并部分交付的 Policy/Evaluator 边界，与 #202/#204 已交付的版本绑定 DRAFT 事实收敛为一套可实现语义，使 #204 创建的 Task 能到达 `READY` 而不在实现时发明兼容、授权或跨模块语义。字段级权威在本节；依据、备选与被否方案见[决定 §16](../decisions/task-execution-human-operated.md#16-task-readiness-生产与-ready-转换边界提案206)；READY 动作的授权组成由 [Spec 001 §15.5](Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 拥有；验证矩阵见 [Module Test 003](../module-tests/Module-Test-003-TaskExecution.md#task-readiness-生产与-ready-转换边界206-设计)。

本节定义字段与语义；Issues #206/#208 的实现事实、注册结果与未运行边界见 §17.11。本节与 §17.11 都不改 §2–§6 的既有 @1.0 定义、§11 的 TD-01–04 基准、§15 的逐版本 Purpose、§16 的创建事实与接受集、200 项历史 Compatibility Baseline 或任何已冻结 fixture；Catalog 已由 #208 按 §17.4 从 213 增至 214。Task READY 之外的行为（WorkOrder DRAFT、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、人工业务验收）不在本切片。

### 17.1 对账事实与剩余缺口

对账 revision：`75553dec7afd87f25dc38230db9f884921b7e899`（本分支起点，与远端 `main` 一致）。

| 位置 | 已提交事实（可核验） | 对账结论 |
|---|---|---|
| 两个 create-task Major | `execution.create_task@1.0`/`@2.0` 的 owning Handler、闭集引用判定、EP 只读 Port、`V3001` 的 `task`/`task_definition_snapshot` 与组合指针已由 #204 交付并在真实 PostgreSQL 通过（§16.9、`TE-P202-001`–`015`） | 两个 Major 都**只**创建 `DRAFT`；Task READY 目前没有任何入口 |
| `execution.mark_task_ready@1.0` | 已在 213 项 Catalog 注册，`kind=COMMAND`、`owner=task-execution`、`schemaStatus=FULL`；注册 Schema 为历史通用形状 `readinessSnapshotRef: SnapshotRef; requestedAt: UtcInstant`；compat metadata 的 Purpose 为 `task.execution.mark_task_ready`（`v1.0-baseline`） | 该操作**已发布并冻结**：payload/result/接受集与 metadata 不得收窄或改写；§3 的 `execution.task.mark_ready` 是设计期文字，按 §15.1 对 `create_task`/`create_work_order` 的同一做法修正为已发布值 |
| `execution.build_task_readiness@1.0` | 仅 §11.1/§11.3/§11.6/§11.9 的设计行；无注册条目、无 operation-specific Result Schema、无 Purpose、无 fixture | 本切片的**唯一新增公开 operation** |
| `TaskReadiness` 引用身份 | §11.3 用 `SnapshotRef<TaskReadiness>`（判断 kind `TASK_READINESS`），但 Registry 中没有任何 `TaskReadiness` objectType | 必须注册**单一** canonical identity；不得由 TypeScript 名称或 Handler 隐式发出 |
| `TaskDefinitionSnapshot` 引用身份 | §16.7 已决定 `zhiju.execution.task_definition_snapshot`（CONTENT_ADDRESSED、Project Scope、不可变、不可作 BusinessOutput），但**本 revision 未注册**；`execution.create_task` 两个版本都没有 Result Schema 返回它 | 本切片注册该身份并由 Readiness 生产者以自己的 payload 携带；**不改** `create_task` 的 Schema/Result/接受集，v1 冻结 fixture 逐字节不变 |
| Policy 解析 | `identity.resolve_policy@1.0` 的契约、Handler、Purpose 授权与 V1005 scoped 事实已由 #183/#186 交付；`execution.task_readiness.policy@1.0` 与 `te.task_readiness.evaluator@1.0` 的静态注册与纯解析已由 #179/#189 交付 | 本切片**消费**既有边界，不新增 policy schema、不新增 registry 版本、不实现新的解析机制 |
| Evaluator 确定性实现 | 全仓不存在 Evaluator 实现、解析调用点与判断产出（§11.9、决定 §12.9） | 本切片只固定规则与失败面；确定性实现属依赖实现切片 |
| Task 自有 blocker 与依赖完成事实 | `information_request` 与 `completion evaluation` 表/Handler 均不存在（§33 仍为设计行） | 首个版本的 blocker 与“依赖已 COMPLETED 且判断可用”分支必须显式定义，并在无合法事实可产生时标 `NOT RUN` |
| 已注册的 Task 公开事件 | 213 项 Catalog 的 `execution.*` Event 恰 11 项，含 `execution.TaskReady@1.0`/`execution.TaskCompleted@1.0`，无 `TaskCreated`、无 `TaskReadinessBuilt`（§16.5） | 生产者**不得**发布事件（无已注册事件可发布）；消费者恰好发布一条已注册的 `execution.TaskReady@1.0` |

**缺口**：READY 转换由谁执行、以什么独立授权、消费什么判断事实、如何用一套规则寻址两个 create-task Major 创建的 Task、判断与转换各自提交哪些不可变事实——这些在实现前缺失，且不能由 Implementer 自行选择。

### 17.2 公共引用身份（本 revision 决定，实现时随对应操作注册）

| objectType | Owner | kind | Scope | 不可变 / 版本 | BusinessOutput | 解引用规则 |
|---|---|---|---|---|---|---|
| `zhiju.execution.task_definition_snapshot` | task-execution | CONTENT_ADDRESSED（`§16.7` 已决定） | Project（`enterpriseId` + `projectId` 必填，等于该 Task 的 Scope） | 不可变事实；不另建可变版本；无独立版本链 | 否 | 按 exact `objectId`（= `task_definition_snapshot.snapshot_id`）+ 完整 canonical payload Hash（= `payload_hash`）；**不使用** `aggregate_version`、latest 或 `schema_version` 定位 |
| `zhiju.execution.task_readiness` | task-execution | SNAPSHOT（生产者 CREATE target 与 Result Ref 同一身份） | Project（两个成员必填，等于被判断 Task 的 Scope） | 不可变判断事实；不另建可变 Root、无 CAS 版本、无 current pointer | 否 | 按 exact `objectId` + `snapshotId` + 完整 canonical payload Hash 读取；不接受 latest、`aggregate_version`、kind/objectType 变体或跨 Project Scope |

`TaskReadiness` 的 Ref 形状固定为 `{kind: 'SNAPSHOT', objectType: 'zhiju.execution.task_readiness', objectId: <judgment_id>, snapshotId: <judgment_id>, scope: {enterpriseId, projectId}, contentHash: <canonical payload SHA-256>` }`。`objectId == snapshotId` 与已注册的 `zhiju.identity.policy_version`（§13.2）同理：判断没有可变 Root、没有 CAS 版本、没有可搬移的指针，因此单一不可变身份同时承载两个成员；这与 `zhiju.execution.context_snapshot`（存在独立 Aggregate Root，`objectId != snapshotId`，见 #167 正例 fixture）的区别是对象形态差异，不是命名分歧。

- 两个身份都**不由** TypeScript 名称、表名、Handler 内部约定或 `CanonicalJson` 推断；未注册名称不得被发出、返回或消费，也不得作为 legacy 别名被接受。
- `task_readiness` 的 `contentHash` 覆盖完整判断 payload（header + kind payload），**不含**自身 `judgmentId` 之外的任何外部可变事实；判断的 `inputHash` 单独覆盖输入清单（§17.6）。
- `task_definition_snapshot` 在两个 Major 下的形状差异（`TaskDefinition` / `TaskDefinitionV2`）由该行的 `schema_version` 表达，**不**分裂为两个 objectType。

### 17.3 两个 create-task Major 的 Task 寻址规则

**事实。** `task_execution.task` 不保存 objectType 拼写；Task 的创建 Major 只由创建事实表达：`task_definition_snapshot.schema_version`（`'1.0'`/`'2.0'`），而 `V3001` 的 creation-identity guard 已强制该快照所属的 `command_receipt` 是 `execution.create_task`、其 `command_version` 等于该提升列、其 target/Scope 等于本 Task，且 Receipt 仍为 `PENDING`（§16.9）。因此“该 Task 由哪个已发布 Major 创建”是一个由 owning 事实**精确、不可变**证明的事实，且每个 Task 恰有一个这样的创建快照（同 Scope 的重复 CREATE 由 `EXECUTION_TASK_ALREADY_EXISTS` 与唯一约束拒绝）。

**备选与选择（详见[决定 §16.2](../decisions/task-execution-human-operated.md#162-p-206-2-task-寻址规则)）。**

| 备选 | 结果 |
|---|---|
| A 闭集接受两种 Task 拼写 | **不采用**。同一 Task 会有两个可互换的公开拼写，与 §16.1/§16.3「逐版本精确、不做别名」的已批准规则冲突；且 `mark_task_ready@1.0` 没有任何版本字段能把它绑定到创建路径，两种拼写同时合法等于把创建期的版本收窄退化为别名 |
| B 版本绑定判别（由 owning 事实派生） | **采用**。书写在请求里的拼写必须等于该 Task 创建 Major 的拼写；判别值来自不可变创建事实，不由调用者提供、不由 payload 新字段表达、不由 `aggregate_version` 或当前指针推导 |
| C 新增 operation major（如 `execution.mark_task_ready@2.0`） | **不采用**。它不解决问题：@1.0 已发布且必须继续服务它可服务的 Task，其 envelope `targetRef` 仍要被闭合，判别规则仍是 B；同时新增一个仅按 Task 来源可用的第二消费者会增加公开面（Catalog 214 → 215）而语义不变。若未来确需新 major，须作为独立 additive 提案批准 |

**闭合规则 R-206-1（两个 Readiness 操作共用，大小写敏感、逐字符相等）**

1. 生产者 `payload.taskRef` 与消费者 Envelope `targetRef` 的 `objectType` 必须**恰好**等于该 Task 创建 Major 对应的拼写：`schema_version='1.0'` → `execution.task`；`schema_version='2.0'` → `zhiju.execution.task`。
2. 另一版本的拼写、裸本地名（如 `Task`）、前缀剥离或补全、大小写变体、`zhiju.execution.task`/`execution.task` 互换一律拒绝（`EXECUTION_TASK_REF_INVALID`）；不做规范化、不做 fuzzy 查找、不回退 latest。
3. `kind` 必须为 `OBJECT`；`objectId` 必须等于 `task_id`；`scope` 必须恰好是 `{enterpriseId, projectId}` 且与该 Task 的 Scope 列逐字段相等（Project 锚定，不接受 Platform 或 Enterprise-only 形态）。
4. 创建快照只用于判定拼写与选择 definition 形状；`current_definition_snapshot_id`/hash 仍必须与本次命令携带/判断记录的 definition pointer 逐字段相等（§17.5 第 2 步、§17.8 第 4 步）。
5. 两个 Readiness 操作都**不接受**任何形式的大小写/别名回退：`EXECUTION_TASK_REF_INVALID` 是唯一拒绝码，其安全外观不区分“拼写错误”“Scope 不符”或“不可见”。

**为什么这不产生别名、不改写 v1 fixture**：别名意味着同一对象在**业务接受集**里有第二个可用名字；R-206-1 让每个 Task 恰好有一个被接受的拼写，另一个拼写在任何层都不能取得业务成功。v1 的冻结 fixture、v2 的 `const`、两个 Major 的注册 Schema、`references` 声明与 200 项历史 Baseline 都不变；本规则是 owning Handler 的模块级收窄（与 §16.1 对 `parentTaskRef`/`dependencyTaskRefs` 的处理同类），不新增公开字段、不改写任何历史 payload。

**TaskDefinitionSnapshot 的 schema-version 绑定**：判断事实记录的 `taskDefinitionRef` 是 Exact Ref（`objectId` + 完整 Hash），消费时必须与 Task Root 的 `current_definition_snapshot_id`/`current_definition_hash` 逐字段相等；该行的 `schema_version` 决定用哪一个 definition 形状解释 payload（`1.0` = `TaskDefinition`、`2.0` = `TaskDefinitionV2`），且**必须**与 R-206-1 第 1 步的创建 Major 一致。二者不一致（今日没有任何已注册操作能产生，只能由直 SQL 篡改或未来版本化定义变更操作产生）一律 fail closed（`EXECUTION_DEFINITION_REF_INVALID`），不得按“当前形状”猜测或静默重解释。

### 17.4 Readiness 生产操作的 Contract/Registry Delta

| 项 | 固定值 |
|---|---|
| operation / version | `execution.build_task_readiness@1.0` |
| Owner / kind | `task-execution` / `COMMAND` |
| Target / mode | `zhiju.execution.task_readiness` / `CREATE`；`expectedAggregateVersion` 必须省略；CREATE 的新 target identity 由 Envelope 给出，`targetRef.objectId` 即本次判断的 `judgment_id`，同 Project Scope 内必须唯一 |
| authorizationPurpose | `execution.task.readiness.build`（新增，公开 `public-api.v1.json` 与 `operation-compatibility-metadata.v1.json` 同步注册） |
| dataClassification | `INTERNAL` |
| Payload | `taskRef: ObjectRef<Task>; taskDefinitionRef: Exact<TaskDefinitionSnapshot>; policyRef: VersionedRef<Policy>; evaluatorRef: VersionedRef<Evaluator>`（全部 required，closed，无未知字段） |
| Result.data | `{readinessSnapshotRef: SnapshotRef<TaskReadiness>}`，由 operation-specific `resultSchemaRef`（`execution_build_task_readiness_result`）注册 |
| Schema 可闭合的部分 | `taskDefinitionRef` 的 `objectType` 以 `const` 固定为 `zhiju.execution.task_definition_snapshot` 且 Scope 收窄为 Project（`enterpriseId` + `projectId` 必填，与 #167 的 `contextSnapshotReference` 同法）；`policyRef` 固定 `zhiju.identity.policy`；`evaluatorRef` 固定 `zhiju.execution.evaluator_profile`；Result 的 `readinessSnapshotRef` 固定 `zhiju.execution.task_readiness` 与 Project Scope 形状，并与 `targetRef` 做跨字段绑定校验（纯 helper，与 `validateInitialContextCommandResult` 同族） |
| Schema 不可闭合、由 owning Handler 闭合的部分 | `payload.taskRef` 的拼写（两种合法取值，按 R-206-1 由创建事实判定）；`policyRef.scope` 必须携带 `enterpriseId` 且与 Envelope/受信上下文一致（§12.2 首版不接受空或 Platform Scope），并由当次 `identity.resolve_policy@1.0` 返回的 `scopeRef` 逐字段复核；Envelope `targetRef.objectId` 与 `readinessSnapshotRef.objectId`/`snapshotId` 的相等；`readinessSnapshotRef.contentHash` 与持久化 payload 重算 Hash 的相等 |
| `references` 声明 | `/targetRef` → OBJECT / `zhiju.execution.task_readiness`；`/payload/taskDefinitionRef` → CONTENT_ADDRESSED / `zhiju.execution.task_definition_snapshot`；`/payload/policyRef` → VERSIONED / `zhiju.identity.policy`；`/payload/evaluatorRef` → VERSIONED / `zhiju.execution.evaluator_profile`。**`/payload/taskRef` 有意不声明**：它的合法取值随 Task 的创建 Major 而定，Schema 与 Registry 都无法表达，收窄由 §17.3 的 Handler 规则完成（与 `create_task@2.0` 不声明两版本 `parentTaskRef`/`dependencyTaskRefs` 同理） |
| `resultReferences` 声明 | `/data/readinessSnapshotRef` → SNAPSHOT / `zhiju.execution.task_readiness` |
| Consistency / result 规则 | COMMAND 无 `allowedConsistency`；成功结果只返回该 SnapshotRef，不返回判断正文、依赖状态、Policy 正文或任何跨模块事实；Result 只含 `targetRef`/`data`/既有 Envelope 字段 |
| Actor 边界 | 调用者持自己的 ActorSnapshot 与 `execution.task.readiness.build` Decision，该 Decision 由 [Spec 001 §15.5](Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 的**生产者条目**（`CREATE_TARGET_TYPE` / `taskReadinessBuildV1`）签发与重验；允许 Human，或受约束的 Readiness/执行 Service（Domain §18.8：Agent 不能直接设置状态，Service 按规则执行）。该 Purpose 不包含 READY 转换、不包含 WorkOrder/Run/Completion 资格，也不能由 `PrincipalKind`、角色名、`actingFor` 或 `initialAssignee` 自动放行；生产者自身读 Task/依赖/输入所需的其他 Purpose（§17.5 第 5 步、§17.6）各自独立授权，不能互相转让。消费者条目是另一条独立映射，生产者的 Decision 与 Grant 不能用于 READY 转换 |
| PayloadGuard | **不新增**专用构建期技术 Policy：payload/result 是有界小对象，适用 [PostgreSQL §5.5](../high-level-docs/07-postgresql-logical-model-v0.1.md#55-默认-payload-guard) 的默认 Command Guard 与共享 Envelope 预算（同 #158/#167/#175/#192 的处理），不注册 `payloadGuardPolicyRef` |
| 生成物与 fixture | `contracts/registry/public-api.v1.json`（+1 条目）、`contracts/registry/operation-compatibility-metadata.v1.json`（+1 条目）、`contracts/src/generated/public-api.ts`、`contracts/src/generated/types/task-execution.ts`、`operation-registration.ts` 的 `assertTaskReadinessOperationRegistrations`/`assertTaskReadinessCompatibilityMetadata`；正例 `tests/fixtures/contracts/task-readiness/build-task-readiness-command-valid.json` 与 `build-task-readiness-result-valid.json`；负例至少覆盖 `taskRef` 错误拼写/错 kind/非 Project Scope、`taskDefinitionRef` 错 objectType 或错 kind 或缺 Hash、`policyRef`/`evaluatorRef` 错 objectType、未知字段、Result 与 `targetRef` 的 objectId/Scope 不等、`readinessSnapshotRef` 的 `kind`/`objectType`/Scope 变体 |
| Catalog 计数 | **213 → 214**；TaskExecution 公开条目 **43 → 44**（24 Command / 9 Query / 11 Event）；历史 200 项 Compatibility Baseline **不变**（additive 追加，不改写任何既有条目） |

**历史 `execution.mark_task_ready@1.0` 的调和**：其注册 Schema（通用 `snapshotRef`）、`schemaVersion`/`schemaStatus`、Catalog 条目与 compat metadata **逐字节不变**，不收窄为固定 objectType、不新增 `targetObjectType`、不补 Purpose 字段；`snapshotReference` 的通用性保留给历史读回。逐版本 canonical Purpose 取其已发布值 `task.execution.mark_task_ready`（compat metadata 的 `v1.0-baseline` 行），§3 的设计期文字 `execution.task.mark_ready` 据此修正，与 §15.1 对 `create_task@1.0`/`create_work_order@1.0` 的处理一致。接受集与授权由 owning Handler 与 [Spec 001 §15.5](Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 的内部 Port 闭合，**不**通过改写注册 Schema 实现。

### 17.5 TaskReadiness 输入算法（闭合）

生产者在一个 owning 事务内按固定顺序执行；任一步拒绝即不产生判断事实、不写 Receipt 的成功结果、不写 Outbox：

1. **命令级前置（拒绝，不产出解释性判断）**：Registry 精确 `(type, version)` 校验 → 组合层从已验证 Decision 行派生受信上下文 → [Spec 001 §15.5](Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 的**生产者条目**（Purpose `execution.task.readiness.build`、`CREATE_TARGET_TYPE`、config key `taskReadinessBuildV1`）在幂等 Claim 与历史 Receipt 返回**之前**签发/重验授权（精确 Decision id/hash、Actor/实际 principal、认证上下文、operation/version/Purpose、payload hash、`targetRef`、Project Scope、ALLOW、未过期，并以当次受信时间重读当前 covering Grant/Policy）→ Registry 已闭合的形状校验（含 Result/`targetRef` 的跨字段绑定）。CREATE identity 的唯一性不由前置读判定，而是在取得 Claim 后由主键/唯一约束裁决（第 8 步）。
2. **Task Root 与 definition pointer**：在同一 owning 事务内按 `task_id` 读取 Task（RLS 限定受信 Enterprise/Project）；不存在或不可见 → `NOT_FOUND`（不区分“不存在”“跨 Scope”“已删除”）。要求 `status='DRAFT'`（否则 `EXECUTION_TASK_NOT_EXECUTABLE`）、Envelope `expectedAggregateVersion` **必须省略**（本操作是 CREATE，不是对 Task 的 MUTATE）、R-206-1 的身份闭合成立、`payload.taskDefinitionRef.objectId`/`contentHash` 与 `current_definition_snapshot_id`/`current_definition_hash` 逐字段相等（否则 `EXECUTION_JUDGMENT_INVALID`），并把 Task 的 `aggregate_version` 作为本次观测记入事实清单与 `inputHash`（消费端必须重新观察到同一版本，见 §17.8 第 4 步）。随后读取该 definition 快照行，要求其 `schema_version` 与 R-206-1 第 1 步的创建 Major 一致（否则 `EXECUTION_DEFINITION_REF_INVALID`）。
3. **依赖集合枚举**：依赖集合**只**由被 pointer 固定的 definition payload 的 `definition.dependencyTaskRefs` 决定（两版本都是 `Set<ObjectRef<Task>>`，按 objectId 稳定序去重）；不从当前指针之外的任何视图、不是当前 Root 的其他列、也不是调用者提供的清单。逐项要求：`kind=OBJECT`、`objectType` 等于创建 Major 的 Task 拼写（否则 `EXECUTION_DEFINITION_REF_INVALID`）、Scope 与 Envelope 逐字段相等（跨 Project/Enterprise → `EXECUTION_DEFINITION_REF_INVALID`）、`objectId != task_id`（自引用 → `EXECUTION_DEFINITION_REF_INVALID`）。
4. **依赖可用性观察与环检测**：在同一事务内读取每个依赖 Task 行（同 Scope，RLS 限定）与该 Task 的当前 Completion Evaluation 事实指针；对每个依赖记录 `{taskRef, aggregateVersion, completionEvaluationRef?, completionUseStatus}`。**环检测**覆盖“本 Task + 其直接与传递依赖”构成的子图（沿 `dependencyTaskRefs` 递归，访问集合有界于同 Scope 已提交 Task）；发现环即拒绝 `EXECUTION_TASK_DEPENDENCY_CYCLE`。环属于 Domain §18.6 第 3 条的图不变量违反，不是可通过等待满足的条件，因此**不**产出解释性判断。
   - **不可见/未提交依赖**：在该 Project Scope 内不存在对应 Task 行（含“Task 从未创建”“被 RLS 隐藏”）→ 对应 `DEPENDENCY_SATISFIED` 检查 `UNSATISFIED`，`ready=false`，不区分不存在与不可见。
   - **CANCELLED 依赖**：`DEPENDENCY_SATISFIED` `UNSATISFIED`，`ready=false`。
   - **依赖未 COMPLETED**：`DEPENDENCY_SATISFIED` `UNSATISFIED`（`reasonCode=DEPENDENCY_NOT_COMPLETED`），`ready=false`。
   - **依赖 COMPLETED**：必须同时重验其 Completion Evaluation 事实仍精确存在且当前可用（`completionUseStatus=USABLE`）；不可用则 `DEPENDENCY_SATISFIED` 记录 `STALE`，`ready=false`。首版该分支为 `NOT RUN`：Task 进入 `COMPLETED` 只能由 `evaluate_task_completion@1.0` 完成（§11.5），而该操作与 Completion Evaluation 持久化尚未交付，因此当前不存在可产生此分支的合法事实。
5. **输入引用解析**：输入集合只由被 pointer 固定的 definition payload 的 `definition.inputRefs`（`TypedReference[]`）决定。首版**支持集恰好为** `zhiju.project.context_source_slice`（CONTENT_ADDRESSED、Exact id + 完整 Hash + Project Scope），经 owning 只读 AUTHORITATIVE `project.get_context_source_slice@1.0` 解析（#188 已交付）；解析结果按该 Query 的闭集 `useStatus` 映射：`USABLE` → `INPUT_REF_RESOLVED` `SATISFIED`；`EXPIRED` → `STALE`（`reasonCode=INPUT_REF_EXPIRED`）；`REVOKED` → `STALE`（`reasonCode=INPUT_REF_REVOKED`）。查询按该 Query 自身的 Purpose（`project.context_source.read`）与调用者授权重验；依赖不可用 → `DEPENDENCY_UNAVAILABLE`（不得当作“已满足”或“不存在”）。
   - **支持集之外的一切引用形态**（其他 objectType、`ObjectRef`/`VersionedRef`/`SnapshotRef`、`zhiju.artifact.artifact_revision`、`ExternalRef` 任一分支持有或无 `tenantOrAccountRef`、未知 namespace）→ `INPUT_REF_RESOLVED` `UNSUPPORTED`，`ready=false`。**不得**被当作“无输入”“已满足”或跳过；**不得**由本操作擅自扩展支持集，也不得仅因实现已有其他 owning Query 就顺带放宽。
   - `inputRefs` 为空的定义合法：此时不产生 `INPUT_REF_RESOLVED` 检查行，也不因此产生 blocker；空集不等于“未解析”。
   - 未携带 `tenantOrAccountRef` 的 `ExternalRef` 在 §16.3 只是“声明的来源意图”，**不得**作为可执行输入事实；因此它在 Readiness 一律 `UNSUPPORTED`，不因缺少顶层 `scope` 而被静默接受。
6. **blocker 集合推导**：blocker 集合由 owning 事实推导，独立于调用者输入。首版集合为“绑定到本 Task 且未有效解决的 blocking InformationRequest”的全部成员（按 `information_request` 的 `taskRef` + `blocking=true` + 未达到有效 Resolution 推导，稳定序去重）；非空即 `NO_BLOCKING_INFORMATION_REQUEST` `UNSATISFIED`，`ready=false`，`factRefs` 列出每个 blocker Ref。调用者**不能**通过省略 payload 字段把 blocker 变空（payload 本就没有 blocker 字段），也不能用“输入为空”替代。首版该分支为 `NOT RUN`：`information_request` 表与 Handler 未交付，当前不存在可产生该分支的合法事实。
7. **判定汇总**：`ready = 全部必需检查 SATISFIED`。存在任一 `UNSUPPORTED` 时 `ready=false`；存在 `STALE`/`UNSATISFIED` 时 `ready=false`。失败的判断仍被提交为不可变事实（§11.3「不满足一般业务条件时允许生成解释性失败判断」），其消费端按 §17.8 映射为相应的稳定错误。
8. **持久化与提交**：取得幂等 Claim 后、首个业务写入前不再需要跨模块证明（本操作不改写 Task Root）；同一 owning 事务写入 §17.7 的事实并 finalize Receipt/Audit/Reference Edge；**不写 Outbox**。同一 Project Scope 内 `judgment_id` 已存在时由主键/唯一约束裁决为 `CONCURRENCY_CONFLICT`（不返回他人结果）。故障注入、依赖不可用或任一检查拒绝都整体回滚，不留 `PENDING` Receipt 或部分事实。

### 17.6 Policy、Evaluator 与期限推导

| 项 | 固定语义 |
|---|---|
| Policy 解析 | `payload.policyRef` 的当次观察**只能**来自 `identity.resolve_policy@1.0` 的返回（#186 已实现），逐字段映射 `policyRef → policyVersionRef`、`contentHash → policy_content_hash`、`effectiveFrom → effective_from`、`supersededAt → superseded_at`；解析是独立授权读取，须持自己的 `identity.policy.resolve_policy` Decision（§12.5）。不得由调用者自报、由 `objectId/versionId` 推导、用 fixture 值或历史 Receipt 充当当次观察 |
| profile 匹配 | `PolicyVersionResolutionView.policyDocument` 必须通过已交付的 `validateTaskReadinessPolicy` 对 `execution.task_readiness.policy@1.0` 的 closed 校验（必需 `maxReadinessValiditySeconds`、未知字段拒绝）；`policySchemaRefs` 必须含该 profile 的 canonical typed ref；未知 profile 版本或字段 → `EXECUTION_CRITERION_UNSUPPORTED`（拒绝创建，不产出判断） |
| Policy 生命周期 | `useStatus` 必须为 `USABLE`；`NOT_YET_EFFECTIVE`/`SUPERSEDED`/`REVOKED` → 拒绝（`EXECUTION_JUDGMENT_STALE`）。判断行保存当次观察的 `policy_version_ref`/`content_hash`/`effective_from`/可空 `superseded_at` 镜像，使判断可用性可解释 |
| Evaluator 匹配 | `payload.evaluatorRef` 必须与构建期静态注册的 `te.task_readiness.evaluator@1.0` 全字段精确相等（`kind`/`objectType=zhiju.execution.evaluator_profile`/`objectId`/`versionId`/`scope={}`）；其他 key/身份/版本或任何非 Platform Scope → `EXECUTION_CRITERION_UNSUPPORTED`（拒绝创建）。首版只有这一个选择器 |
| `evaluatedAt` | 受信服务端当前时间（模块既有受信时钟语义），在判定求值点取得；**不接受**调用者时间。生产操作 payload 没有时间字段，消费者 `mark_task_ready@1.0` 的 `requestedAt`（冻结字段）只作为“调用者声明的请求时刻”记入 Receipt/Audit，**绝不**参与期限、有效期、CAS 或授权判定 |
| `validUntil` | `min(evaluatedAt + maxReadinessValiditySeconds, 产出 Decision 的 expiresAt, 每个已解析输入自身的有限上界（如 Slice 的 `validUntil`，仅在 owning 读取返回有限值时）, 每个 COMPLETED 依赖的 Completion Evaluation 的有限有效期上界)`. 缺省/无限上界**不**被解释为无限期授权；任一参与项缺失时该项不参与 min，而不是变成无限 |
| 时间边界 | `now >= validUntil`、`now >= Decision.expiresAt`、`now >= Policy.supersededAt` 或 Policy/Evaluator 不再可解析时，新消费一律 fail closed；长事务必须在提交点以受信时间重验，不能用事务开始时间通过 |
| 检查行与顺序 | 检查按固定序列生成：`DEPENDENCY_SATISFIED`（每个依赖一行，按依赖 Ref 的 canonical 字节序）、`INPUT_REF_RESOLVED`（每个输入一行，同序规则）、`NO_BLOCKING_INFORMATION_REQUEST`（至多一行）。`checkCode` 是上述闭集；`factRefs` 与 `reasonCodes` 各自去重并按 canonical 字节序稳定排序；`outcome` 取值 `Closed<SATISFIED\|UNSATISFIED\|UNSUPPORTED\|STALE>` |
| 解释码 | 首版闭集：`DEPENDENCY_TASK_MISSING`、`DEPENDENCY_TASK_CANCELLED`、`DEPENDENCY_NOT_COMPLETED`、`DEPENDENCY_COMPLETION_STALE`、`INPUT_REF_EXPIRED`、`INPUT_REF_REVOKED`、`INPUT_REF_UNSUPPORTED_KIND`、`INPUT_REF_EXTERNAL_UNBOUND`、`BLOCKING_INFORMATION_REQUEST_UNRESOLVED`；均为 upper-snake 稳定解释码，不作为公开错误码 |
| `inputHash` | 规范化 Hash，覆盖：有序去重的 subject refs（Task Ref、`taskDefinitionRef`）、`policyVersionRef` + `content_hash` + `effective_from` + 可空 `superseded_at`、`evaluatorRef`，以及完整事实清单（每个依赖的 Ref + `aggregateVersion` + `completionEvaluationRef?` + `completionUseStatus`、每个输入的 Ref + owning `useStatus` + owning 观测的版本/Hash、每个 blocker Ref）；**不含**自身 `judgmentId` |
| `contentHash` | 覆盖完整判断 payload（含 header 的 `judgmentId`、`evaluatedAt`、`validUntil`、`checks`），canonicalization v1；与 `readinessSnapshotRef.contentHash` 相等 |

### 17.7 持久化事实与事务边界（生产者）

| 事实 | 内容与约束 |
|---|---|
| `task_execution.execution_judgment`（Aggregate/事实行，**未分配 migration**） | `judgment_id`（= Envelope `targetRef.objectId`，UuidV7，主键）；`judgment_kind`（closed 五类，本切片只写 `TASK_READINESS`）；`enterprise_id`/`project_id`（Project Scope 镜像，创建后不可变）；subject 镜像 `task_id` + `task_definition_snapshot_id` + `task_definition_hash`（32 字节）；`policy_version_ref`/`policy_content_hash`/`policy_effective_from`/可空 `policy_superseded_at`；`evaluator_ref`；`input_hash`；`evaluated_at`/`valid_until`；`ready`；`canonical_payload` + `payload_hash`（SHA-256、32 字节、canonicalization v1）；`request_payload_hash`（32 字节，绑定产生本判断的在途请求）；`source_command_id`；`created_at`/`created_by_principal_id` |
| 不可变性与 ACL | app 角色无 `UPDATE`/`DELETE`（`REVOKE UPDATE, DELETE`）；行创建后 Scope、subject、policy/evaluator 绑定、`input_hash`、`evaluated_at`/`valid_until`、`ready` 与 payload 全部不可改写；判断 identity 独立于任何 CAS 版本，没有 current pointer |
| RLS | 每行显式保存 `enterprise_id`/`project_id`，`FORCE RLS` + `context_allows_project`（与 `V3001` 同族）；不依赖“隐藏 Ref”代替授权；不建立跨 Schema FK 或 Join |
| payload↔镜像 guard | `SECURITY DEFINER` 的 mirror guard 逐项核对 Scope、subject 镜像（Task/definition id + hash）、policy 观察镜像与 `payload_hash`，并用 schema 内 canonicalization v1 由 `canonical_payload` 重算 Hash（复用 `V3001` 的 owner-only `task_execution.canonical_jsonb_text`；app 角色不可执行该函数） |
| 来源命令绑定 guard | `SECURITY INVOKER` 的 creation-identity guard 要求 `source_command_id` 指向一条**仍为 `PENDING`** 的 `execution.build_task_readiness` Receipt，其 `command_version='1.0'`、target type/id 与 Project Scope 等于本判断的 `zhiju.execution.task_readiness` 身份与 Scope，且 `request_payload_hash` 等于本行的 `request_payload_hash`；即该判断必须由**声称的那条命令自身的在途事务**写入。因此复用他人 Receipt、事后补写判断、或把另一命令的请求哈希贴到本判断都不能成立（与 §16.9 的 creation-identity guard 同法，但判断 payload 是命令产出的结论而非请求 payload，故只绑定请求 Hash 与 target/Scope，不要求 payload 逐字节等于请求） |
| `command_receipt` | 沿用 #151 runner：同键同输入返回原结果；同键异输入 `IDEMPOTENCY_PAYLOAD_CONFLICT` 并写 DENIED Audit；`idempotency_scope` 由服务端按 `commandType@commandVersion` + Project Scope 组合 |
| `audit_record` | 成功与拒绝（授权、依赖不可用、绑定失败、幂等冲突、唯一冲突）都留稳定 `error_code`；不记录客户正文、不记录其他 Scope 的存在性 |
| `reference_edge` | 只对**本事务已证明存在**的引用写入：Task（owner 为本次判断，target 使用创建 Major 的拼写）、`taskDefinitionRef`、`policyVersionRef`、`evaluatorRef`。未提交的依赖 Task、未解析的输入与 blocker 只存在于判断 payload：其 Edge 由证明其存在与当前有效的 owning 动作在各自事务写入，避免悬空 Edge |
| `outbox_event` | **0 行**。生产者不发布任何公开事件：Catalog 没有 `execution.TaskReadinessBuilt@1.0`，Handler 不得发布未注册事件（§16.5 同理）。若未来需要该事件，须作为独立 additive 提案批准并同步 Catalog 计数（例如 214 → 215）、`references`、Envelope/Result 与正负 fixture |
| 幂等与并发 | ① 同键同输入重放返回原 Receipt/结果，不新增判断/Edge；② 同键异输入按幂等冲突拒绝；③ 同一 Project Scope 内 `judgment_id` 已存在（重复 CREATE identity）→ `CONCURRENCY_CONFLICT`，不返回他人结果；④ **并发构建者合法**：同一 Task 允许多个不同 `judgment_id` 的判断共存（方法不同、时点不同）；没有“第二个判断取代第一个”的路径，也没有需要 CAS 的 current pointer；⑤ 生产者不改写 Task Root，因此与 READY 转换、其他判断之间没有 Root 竞争 |
| 观测时点 | 本模块自有事实（Task、依赖、blocker）在同一 owning 事务内读取，因此记录的观测对提交时点一致；跨模块读取（Policy、Slice）只承诺记录的观测时点一致性（§10.1），消费者必须按 §17.8 重新观察并比较 |
| 回滚 | 任一检查拒绝、依赖不可用或注入故障都整体回滚：不留 `PENDING` Receipt、判断行、Edge 或成功的 Audit 结论；重试可从零开始 |

### 17.8 `execution.mark_task_ready@1.0` 消费边界

单一顺序，任一步失败即拒绝且无业务副作用（不写 Root 状态、Receipt 成功结果、Edge 或 Outbox）。注册 Schema 与 Catalog 条目不变，payload 仍为 `readinessSnapshotRef: SnapshotRef; requestedAt: UtcInstant`。

1. **Registry + 授权**：Registry 精确 `(type, version)` 校验（历史通用 Schema，接受集不变）→ 组合层从已验证 Decision 行派生受信上下文 → [Spec 001 §15.5](Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 的**消费者条目**（Purpose `task.execution.mark_task_ready`、`TARGET_TYPE`、config key `taskReadyV1`，与生产者条目互相独立）在**幂等 Claim 与历史 Receipt 返回之前**签发/重验授权（精确 Decision id/hash、Actor/实际 principal、认证上下文、`execution.mark_task_ready`/`1.0`、Purpose `task.execution.mark_task_ready`、payload hash、精确 target、Project Scope、ALLOW、未过期，并重读当前 covering Grant/Policy）。撤销、到期、配置漂移、target 替换、Policy 不可用一律 fail closed；历史 Receipt 不恢复授权资格；生产者的 Decision、Grant 或受信配置结果都不能替代本条目。
2. **判断事实读取与完整性**：按 exact `readinessSnapshotRef` 读取判断行（`kind=SNAPSHOT`、`objectType=zhiju.execution.task_readiness`、`objectId==snapshotId`、Project Scope 等于 Envelope Scope、`contentHash` 等于由持久化 `canonical_payload` 重算的 Hash）；错 kind/objectType/Scope/Hash、未知、不可见统一 `EXECUTION_JUDGMENT_INVALID`，不泄露其他 Scope 是否存在该判断。
3. **判断可用性**：`judgment_kind` 必须为 `TASK_READINESS`；`now < valid_until`（提交点受信时钟）；当次重新解析 Policy 并要求 `useStatus=USABLE`、`content_hash`/`effective_from`/可空 `superseded_at` 与判断镜像逐字段相等（否则 `EXECUTION_JUDGMENT_STALE`）；Evaluator 必须仍被支持（否则 `EXECUTION_CRITERION_UNSUPPORTED`）。
4. **Task/Scope/definition 绑定**：Envelope `targetRef` 按 R-206-1 闭合并等于判断的 subject Task Ref；Task Root 必须可见、`status='DRAFT'`（否则 `EXECUTION_TASK_NOT_EXECUTABLE`）、`aggregate_version` 等于 Envelope `expectedAggregateVersion`（否则 `CONCURRENCY_CONFLICT`）、且等于判断记录的观测版本（否则 `EXECUTION_JUDGMENT_STALE`）；`current_definition_snapshot_id`/`current_definition_hash` 必须与判断的 `taskDefinitionRef` 逐字段相等（否则 `EXECUTION_JUDGMENT_STALE`）。
5. **完整依赖/输入/blocker 重验（提交点）**：消费者按 §17.5 第 3–6 步**用自己的授权**重新观察同一闭合集合，并要求与判断记录的观测量**逐项相等**：依赖集合成员（由被 pointer 固定的 payload 决定）、每个依赖的 `aggregateVersion` 与 `completionEvaluationRef`/`completionUseStatus`、每个输入的 owning `useStatus` 与观测版本/Hash、blocker 集合成员。任何不一致 → `EXECUTION_JUDGMENT_STALE`（要求重建判断，不在消费端“就地修正”）；发现环 → `EXECUTION_TASK_DEPENDENCY_CYCLE`；依赖不可用 → `DEPENDENCY_UNAVAILABLE`。
6. **判定映射（稳定错误优先级）**：判断含任一 `UNSUPPORTED` 检查 → `EXECUTION_CRITERION_UNSUPPORTED`；否则 `ready=false` → `EXECUTION_TASK_READINESS_UNSATISFIED`；`ready=true` 且第 1–5 步全部通过才继续。**不**把 `ready` 当作调用者可传入的值，也不接受任何调用者自报的检查清单。
7. **状态转换（DRAFT-only CAS）**：单条受 guard 的 UPDATE，`WHERE` 同时包含 `task_id`、`enterprise_id`、`project_id`、`status='DRAFT'`、`aggregate_version = expectedAggregateVersion`、`current_definition_snapshot_id`、`current_definition_hash`，置 `status='READY'`、`aggregate_version = aggregate_version + 1`。0 行时回读区分：不可见 → `NOT_FOUND`；状态不再为 `DRAFT` → `EXECUTION_TASK_NOT_EXECUTABLE`；版本不符 → `CONCURRENCY_CONFLICT`；指针不符 → `EXECUTION_JUDGMENT_STALE`。**BACKLOG 不在本转换路径**：首版只实现 `DRAFT → READY`，没有把 `BACKLOG` 设为中间态的公开操作，也不得由该命令顺带写入其他状态。
8. **同事务事实与事件**：在同一 Task 事务提交转换、`command_receipt`、`audit_record`、`reference_edge`（Task owner → 判断 Ref、definition Ref；判断 owner → Task Ref）与**恰一条**已注册 `execution.TaskReady@1.0` Outbox 行，payload 保持 `{taskRef, readinessSnapshotRef, readyAt}`：`taskRef` 使用创建 Major 拼写与 Project Scope，`readinessSnapshotRef` 与本次判断逐字段相等，`readyAt` 取受信转换时刻（Receipt `completed_at`）；Outbox 的 aggregate type/id/version 为本次转换后的 Task identity 与新 `aggregate_version`，correlation/causation 来自 Envelope。不发布第二类事件，不返回未注册事件名。

**重放、竞争与失效**：

- 同键同输入重放返回原 Receipt/结果，不产生第二次转换、第二条 Event 或新版本；同键异输入 `IDEMPOTENCY_PAYLOAD_CONFLICT`。
- 授权在上次成功后失效、Grant/Policy 漂移、Decision 过期时，同键重放仍 fail closed（第 1 步先于历史 Receipt 返回）。
- 已 READY 或已离开 `DRAFT` 的 Task 再次收到 READY 请求（含用另一判断、另一键）→ `EXECUTION_TASK_NOT_EXECUTABLE`，状态与版本不变。
- 两个消费者用不同键并发 READY 同一 Task：CAS 恰一个获胜，失败方读回后返回 `EXECUTION_TASK_NOT_EXECUTABLE`，无部分事实。
- 两个判断都已提交（两个构建者）：各自仍可被消费，但只有第一个成功的 CAS 发生转换；后续消费按上一条拒绝。判断与 Edge 保留为历史。
- 判断在上游事实变化（依赖版本前进、输入 EXPIRED/REVOKED、出现新 blocker）后不可再用：消费端 `EXECUTION_JUDGMENT_STALE`，且必须重建判断；历史判断行不删除、不更新，`useStatus` 由当前重验派生。
- 直接 SQL 篡改（改写判断 payload/镜像/Scope、UPDATE/DELETE 不可变行、跨 Project 插入）由 mirror guard、ACL 与 RLS 拒绝；`READY` 不加 Root 新列，因此不存在“只改指针、不改事实”的伪造转换路径。

### 17.9 稳定错误码与安全外观

| 错误码 | 触发条件 | 安全外观 |
|---|---|---|
| `EXECUTION_TASK_REF_INVALID`（**本切片新增**） | R-206-1 的 Task 拼写/kind/Scope 闭合失败（生产者 `payload.taskRef` 与消费者 Envelope `targetRef` 同一规则） | 不区分“拼写错误”“Scope 不符”“不可见”；不返回其他 Scope 的对象存在性 |
| `EXECUTION_TASK_DEPENDENCY_CYCLE` | “本 Task + 传递依赖”子图成环（生产者与消费者同一判定） | 拒绝、无事实/无转换；不列出图外对象 |
| `EXECUTION_TASK_READINESS_UNSATISFIED` | 判断 `ready=false` 且不含 `UNSUPPORTED` 检查 | 只返回稳定码；逐项原因只进同事务 Audit |
| `EXECUTION_CRITERION_UNSUPPORTED` | profile/Evaluator 版本不支持（创建端拒绝），或判断含 `UNSUPPORTED` 检查（消费端） | 不 READY；不忽略未识别字段或不支持判据 |
| `EXECUTION_JUDGMENT_INVALID` | 判断 Ref 的 kind/objectType/Scope/Hash 不合法、不可用、未知，或 definition pointer 与 `taskDefinitionRef` 不等 | 统一不可用；内部分类只进 Audit |
| `EXECUTION_JUDGMENT_STALE` | 期限已过、Policy 观察漂移/被取代、依赖/输入/blocker 观测与记录不一致 | 不转换；要求重建判断；历史保留 |
| `EXECUTION_DEFINITION_REF_INVALID` | 存储的 definition 事实自身不闭合（依赖 Ref 的拼写/kind/Scope/自引用，或 `schema_version` 与创建 Major 不一致） | 拒绝；不重解释、不猜测形状 |
| `EXECUTION_TASK_NOT_EXECUTABLE` | Root 状态不允许 READY（非 `DRAFT`，含已 READY/COMPLETED/CANCELLED） | 不写状态、不发布事件 |
| `CONCURRENCY_CONFLICT` | `expectedAggregateVersion` 不符，或判断 CREATE identity 已被占用 | 不覆盖既有事实 |
| `NOT_FOUND` / `COMMAND_TARGET_MISMATCH` | Task 或判断在该 Scope 不可见；Envelope target 与命令目标不符 | 沿用既有语义，不泄露跨 Scope 存在性 |
| `IDEMPOTENCY_PAYLOAD_CONFLICT` | 同键异输入 | 保留原 Receipt/结果并写 DENIED Audit |
| `DEPENDENCY_UNAVAILABLE` | IdentityPolicy/EnterpriseProject 等 owning 依赖暂时不可查询 | fail closed；不得当作“空结果”“默认 Policy”“输入已满足”或“已授权” |
| 共享授权码 | 沿用既有 `AUTHORIZATION_DECISION_INVALID`/`AUTHORIZATION_EXPIRED`/`AUTHORIZATION_REVOKED` | 内部分类只进安全 Audit |

本切片只新增 `EXECUTION_TASK_REF_INVALID` 一个模块稳定码；`EXECUTION_JUDGMENT_INVALID`/`EXECUTION_JUDGMENT_STALE`/`EXECUTION_CRITERION_UNSUPPORTED` 沿用 §11.7 已批准但尚未注册的语义，本切片一并把它们带入实现范围；`EXECUTION_TASK_DEPENDENCY_CYCLE`/`EXECUTION_TASK_READINESS_UNSATISFIED`/`EXECUTION_TASK_NOT_EXECUTABLE` 沿用 §6 既有码。所有错误在该切片实现时随实现注册，本节只固定语义。

### 17.10 验收矩阵与未运行边界

- 设计/静态分量（引用身份、R-206-1 规则、operation/Registry 声明、创建事实与事件边界）由 `TE-P206-D-*` 对账；可执行分量由 `TE-P206-001`–`018` 定义，全部为未来执行输入。
- 本 revision **不改**代码、契约、Registry、生成物、migration 或 fixture：Catalog 保持 213、历史 Baseline 保持 200、v1/v2 冻结 fixture 与两个 `create_task` Major 的接受集逐字节不变；本节新增的 operation、objectType、error code 与 `V3002` 均**未注册、未实现、未分配 migration 编号**。
- 未运行边界：生产者/消费者 Handler、`execution_judgment` 持久化、Spec 001 §15.5 的两个授权条目（签发/重验与组成层接线）、真实 PostgreSQL、RLS/ACL、直 SQL 篡改、回滚、并发、重放与 `execution.TaskReady@1.0` 的实际发布全部 `NOT RUN`；依赖未交付导致的不可达分支（依赖 COMPLETED 可用性、blocking InformationRequest blocker）单独标注，不因无事实可产生而写成 PASS。
- 依赖 #179/#186/#188/#189 的既有证据只证明各自的静态注册/解析或单模块 Handler slice，不证明本切片的判断产出、READY 转换或跨模块业务链已可运行。

### 17.11 实现事实与验证边界（#208，2026-09-16）

状态：`T2 / IMPLEMENTED AND EXECUTED ON REAL PostgreSQL / INDEPENDENT REVIEW AND HUMAN TECHNICAL REVIEW PENDING`。[Issue #208](https://github.com/qzhike/zhiju-business-core/issues/208) 按 §17 的已批准设计交付本切片；本节只记录实现事实、必须的可核验点与仍然 `NOT RUN` 的边界，执行证据（revision、测试计数、PostgreSQL 版本与迁移路径、Catalog/Registry/Baseline 计数、独立审查结论与人类技术批准）保存在 Issue 与 PR，不另建并行报告。

**注册与生成物**

- `execution.build_task_readiness@1.0` 已按 §17.4 注册：owner `task-execution`、`COMMAND`、`targetObjectType=zhiju.execution.task_readiness`、`concurrencyMode=CREATE`、Purpose `execution.task.readiness.build`、`dataClassification=INTERNAL`、无专用 PayloadGuard、operation-specific `resultSchemaRef`（`execution_build_task_readiness_result`）。四条 `references` 与一条 `resultReferences` 与设计逐项一致；`/payload/taskRef` 仍**不**声明。
- 两个引用身份已注册为 objectType：`zhiju.execution.task_readiness`（`OBJECT`/`SNAPSHOT`）、`zhiju.execution.task_definition_snapshot`（`CONTENT_ADDRESSED`）；`zhiju.execution.evaluator_profile`（`VERSIONED`）随 `evaluatorRef` 声明一并注册。
- 生成物：`public-api.v1.json`（+1 条目）、`operation-compatibility-metadata.v1.json`（+1 条目，`semanticDeclaration=im-06-task-readiness-registration`）、`contracts/src/generated/public-api.ts`、`contracts/src/generated/types/task-execution.ts`，并由 `assertTaskReadinessOperationRegistrations`/`assertTaskReadinessCompatibilityMetadata` 在构建期闭合。正/负例 fixture 位于 `tests/fixtures/contracts/task-readiness/`，跨字段绑定校验由纯 helper `validateBuildTaskReadinessCommandResult` 承担。
- 计数：Catalog/Registry 213 → **214**，TaskExecution 43 → **44**（24 Command / 9 Query / 11 Event）；历史 **200** 项 Compatibility Baseline、两个 `create_task` Major 的接受集与 `execution.mark_task_ready@1.0` 的注册 Schema/Catalog 条目/compat metadata 逐字节不变。
- 唯一新增的模块稳定码是 `EXECUTION_TASK_REF_INVALID`；`EXECUTION_JUDGMENT_INVALID`/`EXECUTION_JUDGMENT_STALE`/`EXECUTION_CRITERION_UNSUPPORTED` 按 §17.9 沿用 §11.7 语义进入实现，`EXECUTION_TASK_DEPENDENCY_CYCLE`/`EXECUTION_TASK_READINESS_UNSATISFIED`/`EXECUTION_TASK_NOT_EXECUTABLE` 沿用 §6 既有码。

**授权组成（Spec 001 §15.5）**

- IdentityPolicy 新增内部 `TaskExecutionReadinessAuthorizationPort`（`modules/identity-policy/src/commands/task-execution-readiness-authorization.ts`），两条精确 `(type, version)` 条目互不替代：生产者 `execution.build_task_readiness@1.0`（Purpose `execution.task.readiness.build`、action 同名、`CREATE_TARGET_TYPE`、config key `taskReadinessBuildV1`、target `zhiju.execution.task_readiness` 单值）与消费者 `execution.mark_task_ready@1.0`（Purpose `task.execution.mark_task_ready`、action `execution.task.mark_ready`、`TARGET_TYPE`、config key `taskReadyV1`、target 为两个已发布 Task 拼写的闭集）。
- `TARGET_TYPE` 是本 Port 解释的新 selector 类型；§15.2 的其余覆盖规则（ACTIVE、`[validFrom, validTo)`、精确 action、空 `constraints`、缺省 `maxUses`、Grant Policy Snapshot 一致且当前有效、禁止分段拼接）不变。两条条目都复用 V1006 的 `target_object_type`/`target_object_id` 列，**没有**新的 IdentityPolicy 迁移。拒绝路径只写同事务脱敏 `DENIED` Audit，不签发 Decision。
- 两个方向都在各自幂等 Claim 与历史 Receipt 返回**之前**重验：生产者见 §17.5 第 1 步，消费者见 §17.8 第 1 步。生产者的 Decision/Grant 不能授权 READY 转换，消费者的也不能授权 build；两个 target objectType 集合不重叠。

**持久化（V3002）**

- `migrations/task_execution/V3002__task_readiness_judgment.sql` 建立 `task_execution.execution_judgment`：§17.7 列集合 + `canonicalization_version`，主键 `judgment_id`、`UNIQUE (enterprise_id, project_id, judgment_id)`、32 字节 hash 长度 CHECK、`valid_until >= evaluated_at`、封闭 `judgment_kind` CHECK（本切片只允许 `TASK_READINESS`）。判断 identity 独立于任何 CAS 版本：没有 current pointer、没有取代边、没有可变状态列。
- 双 guard：`SECURITY DEFINER` 的 mirror guard 由 `canonical_payload` 重算 Scope/subject/Policy 观察镜像并用 owner-only 的 `task_execution.canonical_jsonb_text` 重算 `payload_hash`；`SECURITY INVOKER` 的 creation-identity guard 要求 `source_command_id` 指向仍在途（`outcome='PENDING'`）的 `execution.build_task_readiness@1.0` Receipt，其 target type/id 与 Project Scope 等于本判断且 `request_payload_hash` 等于本行同名列。app 角色 `REVOKE UPDATE, DELETE`，表 `FORCE RLS` + `context_allows_project`，无跨 Schema FK/Join。
- 判断写入**不写** `outbox_event`。READY 转换**不新增** Task Root 列：它是单条受 guard 的 `UPDATE`（`task_id`、`enterprise_id`、`project_id`、`status='DRAFT'`、`aggregate_version`、`current_definition_snapshot_id`、`current_definition_hash` 同时入 `WHERE`），置 `READY` 并把 `aggregate_version` 加一；0 行时回读区分 `NOT_FOUND`/`EXECUTION_TASK_NOT_EXECUTABLE`/`CONCURRENCY_CONFLICT`/`EXECUTION_JUDGMENT_STALE`。转换事务写 Receipt、Audit、Reference Edge 与恰一条 `execution.TaskReady@1.0`。

**Handler 与组成层**

- 生产者 `handleBuildTaskReadiness`（`modules/task-execution/src/business/task-readiness-production.ts`）与消费者 `handleMarkTaskReady`（`business/task-ready-transition.ts`）共用 `business/task-readiness-plan.ts` 的闭合算法：R-206-1 身份闭合、只由被 pointer 固定的 definition payload 决定的依赖集合与输入集合、Kahn 拓扑判环（覆盖“本 Task + 传递依赖”子图）、单一支持输入种类 `zhiju.project.context_source_slice`、blocker 派生、稳定排序的检查行与 reason code、`inputHash` 与 `validUntil`。两个入口都用同一算法重新观测，消费者要求与记录逐项相等。
- 组成层 `apps/api/src/composition/task-readiness-entry.ts`（`createTaskReadinessEntry`）在幂等 Claim 之前完成 Registry 精确版本校验、Decision/Actor 绑定与本操作**自己那一条**授权重验，随后把 Policy 解析与 Slice 解引用分别交给 `identity.resolve_policy@1.0` 与 `project.get_context_source_slice@1.0`，各自签发自己的 Decision；两条 owning 读取不可用时映射为 `DEPENDENCY_UNAVAILABLE`，不降级为默认值。
- **实现期补充的记录字段**：判断 canonical payload 除 §17.7 的镜像外还记录当次 **Policy 版本键**（`policyRef`）与 Task 观察版本（`taskAggregateVersion`）。原因是 `policyVersionRef` 是解析出的不可变版本事实身份（`SnapshotRef`，`objectId == snapshotId`），而 §17.8 第 3 步要求消费者在提交点**重新解析** Policy，这需要一个可解析的版本键；观察版本是 §17.8 第 4 步与 `inputHash` 的比对对象。两者都进入 `inputHash` 与 `contentHash`，因此不可被事后替换。
- **观测枚举**：依赖观测为 `{taskRef, aggregateVersion|null, completionEvaluationRef|null, completionUseStatus}`，其中 `completionUseStatus ∈ {USABLE, STALE, NOT_COMPLETED, CANCELLED, MISSING}`；输入观测为 `{inputRef, resolution ∈ {USABLE, EXPIRED, REVOKED, UNSUPPORTED}, validUntil|null}`；检查行为 `{checkCode, outcome, factRefs, reasonCodes}`，顺序为“每个依赖一行、每个输入一行、至多一行 blocker 检查”。`USABLE`/`STALE` 是设计为 COMPLETED 依赖固定的两个取值，其余三个取值分别对应设计中 `DEPENDENCY_TASK_MISSING`/`DEPENDENCY_TASK_CANCELLED`/`DEPENDENCY_NOT_COMPLETED` 三个不可用分支。
- **`validUntil`**：`min(evaluatedAt + maxReadinessValiditySeconds, 产出 Decision 的 expiresAt, 每个 `USABLE` 输入的有限上界)`。Policy 上界与 Decision 上界始终参与，因此 `validUntil` 始终有限；无有限上界的项不参与 min，不被解释为无限期。
- **提交点时间重验**：消费者在完成 Policy 重解析、Task/definition 绑定与完整依赖/输入/blocker 重观察之后、执行不可逆 CAS 之前，重新读取受信时钟，并以该当次时间同时重验 `now < valid_until`、`now < 判断镜像的 policySupersededAt`（存在时）与 `now < 产出该请求授权的 Decision expiresAt`。任一项越界即拒绝（前两者 `EXECUTION_JUDGMENT_STALE`，第三项共享码 `AUTHORIZATION_EXPIRED`），因此长事务不能在事务开始时刻尚未过期、而在 owning reads 之后已经过期的情况下完成转换。§17.8 第 3 步的首次过期检查保留为快速失败路径，实际裁决以提交点读取为准。
- **单一提交时刻**：转换事件与 Receipt 共用同一个受信时刻。Handler 在提交点读到的时间即 `execution.TaskReady@1.0` 的 `readyAt` 与 Outbox 行的 `occurred_at`，并通过 `CommandBodyResult.committedAt` 交给共享 runner 写入该命令 `command_receipt.completed_at`，因此 §17.8 第 8 步“`readyAt` 取受信转换时刻（Receipt `completed_at`）”是构造性相等，而不是两个独立时钟的巧合。其他命令不传该值，runner 行为逐字节不变。

**已知边界与后续候选**

- 事件 payload 的平台既有约定：`execution.TaskReady@1.0` 的**注册** payload 是 `{taskRef, readinessSnapshotRef, readyAt}`，而 TaskExecution 的 Outbox 行还必须携带 promoted Scope 镜像（`enterpriseId`/`projectId`），因为 `V3000` 的 `outbox_scope_mirror_guard` 与共享 runner 都要求每个事件 payload 内嵌该镜像——已交付的 EnterpriseProject 与 IdentityPolicy 事件发射同此约定。本切片沿用该约定，未改写 `V3000`、未放宽共享 runner、未修改注册的 Event Schema。注册 Event payload 与 Outbox 行 payload 的这处全平台分叉应作为独立 additive 提案处理，不属本切片。

**未运行边界**

- `TE-P206-005` 的“依赖已 `COMPLETED` 且 Completion Evaluation 当前可用”分支与 `TE-P206-010` 的 blocking InformationRequest 分支保持 `NOT RUN`：`execution.evaluate_task_completion@1.0` 与 `information_request` 生产者未交付，当前不存在可产生这两个分支的合法事实；实现按设计把它们确定性映射为 `STALE`/`UNSATISFIED`，但“无事实可产生”不等于通过。
- 本切片未覆盖的边界仍 `NOT RUN`：WorkOrder DRAFT（其后由 [Issue #212](https://github.com/qzhike/zhiju-business-core/issues/212) 实现并执行，见 §18.14）、WorkOrder 校验/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection（TD-05–07）、受控退出 Fixture、外部 Provider/Runtime、飞书通道与人工业务验收；`TaskCompleted` 等 Task 公开事件未注册也未发布。
- 迁移验证与 PostgreSQL 验收覆盖空库、既有 V3000/V3001 之上的 forward 迁移、二次 no-op、RLS/ACL、直 SQL 篡改、回滚与并发；这些证据随本切片的执行记录保存在 Issue/PR，不改变 TD-01–04 其他表的 `NOT RUN` 状态。

## 18. WorkOrder DRAFT 创建与精确 Draft 读取边界（#210 设计）

状态：`T2 / DESIGN APPROVED 2026-09-17（Issue #210）/ INDEPENDENT REVIEW COMPLETED ON 67e5df57 / EXPLICIT HUMAN DESIGN APPROVAL RECORDED / IMPLEMENTED AND EXECUTED 2026-09-18 BY Issue #212 / TE-P210-001–023 EXECUTED ON REAL PostgreSQL 18.6 / MERGED 2026-09-18（PR [#213](https://github.com/qzhike/zhiju-business-core/pull/213)，merge commit `f0dccc9601316752dca15b393ef24f31199929f8`，Issue #212 已关闭 `COMPLETED`）/ INDEPENDENT REVIEW AND HUMAN TECHNICAL REVIEW RECORDED ON `4deffa472bfb5f96f85224d3ec930b43a0e61ba8`（第 1 轮 `REQUEST_CHANGES` 于 `296a20b898726270a2a86664b4e6705189ddd757` → 第 2 轮关闭该 finding 并路由 `HUMAN_REVIEW_REQUIRED`，exact-head GitHub Actions `verify` SUCCESS 与独立 `vibe verify full --json` PASS；正式记录见 [`reviews/pr-213/Review.md`](../reviews/pr-213/Review.md)）`。本节回应 [Issue #210](https://github.com/qzhike/zhiju-business-core/issues/210)：在 #158/#165 已注册的 WorkOrder DRAFT 契约、#190/#200 已交付的逐版本创建授权映射、#202/#204 的 Task DRAFT 创建事实先例与 #206/#208 的版本绑定寻址先例之上，固定 `execution.create_work_order@1.0`/`@1.1` 的创建边界与 `execution.get_work_order_draft@1.0`/`@1.1` 的精确读取规则。本节不注册任何 operation/objectType/Event、不分配 migration、不改写已发布接受集、注册 Schema、兼容元数据或历史 200 项 Compatibility Baseline；实现事实与验证边界见 §18.14。依据、备选与被否方案见[决定 §17](../decisions/task-execution-human-operated.md#17-workorder-draft-创建与精确-draft-读取边界提案210)。

### 18.1 对账事实（revision `bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`）

| 位置 | 已提交事实（可核验来源） | 对账结论 |
|---|---|---|
| `create_work_order@1.0` 创建授权 | `modules/identity-policy/src/commands/task-execution-creation-authorization.ts` 的 `TASK_EXECUTION_CREATION_BINDINGS`：Purpose `task.execution.create_work_order`、action `execution.work_order.create.v1`、target objectType `execution.work_order`、config key `workOrderV1`（#200 交付） | 已交付事实把 @1.0 的 CREATE target 拼写固定为 legacy `execution.work_order` |
| `create_work_order@1.1` 创建授权 | 同表：action `execution.work_order.create.v1_1`、target `zhiju.execution.work_order`、config key `workOrderV11`；`public-api.v1.json` 声明 `/targetRef` → OBJECT/`zhiju.execution.work_order` | 两个 Major 共用 Purpose，但 target 拼写与 Grant action 各自精确 |
| `create_work_order@1.0` payload | 200 项 Baseline 成员（`execution_create_work_order_payload` 与 `workOrderDraft`）：`draft.taskRef` 是通用 `objectRef`；`versionPins` 是 Core `VersionPins`（必填 `projectContextContractRef`） | 形状逐字节冻结；它既不约束 Task 拼写，也不携带 WorkOrder 自身拼写 |
| `create_work_order@1.1` payload | `initialWorkOrderDraft`：`taskRef` 同为通用 `objectRef`；`versionPins` 为 `DraftVersionPins`（无 `projectContextContractRef`） | 两个 Major 的 DRAFT 形状由 `versionPins` 区分，不能互相替代 |
| `get_work_order_draft@1.0`/`@1.1` | 均已注册且 `schemaStatus=FULL`：`/payload/workOrderRef` 固定 `const zhiju.execution.work_order`；`/draftSnapshotRef` 固定 `zhiju.execution.work_order_draft_snapshot`；`draft` 分别为 `WorkOrderDraft`/`InitialWorkOrderDraft`；**两者都不在 200 项 Baseline 中**（Baseline defs 只有 `workOrderDraft`/`workOrderStatus`） | 已发布接受集只接受 canonical 拼写；@1.0 的 result 形状与 @1.1 的创建事实不兼容 |
| Draft Snapshot 的声明形状 | `$defs.workOrderDraftSnapshot`/`initialWorkOrderDraftSnapshot` 把 `workOrderRef` 与 `taskRef` 都固定为 canonical（`zhiju.execution.work_order`/`zhiju.execution.task`）；两个 def 没有任何引用调用点，被注册 operation 使用的只是 `zhiju.execution.work_order_draft_snapshot` 这个 CONTENT_ADDRESSED objectType；Baseline 不含这两个 def | 声明形状当前无法忠实承载 legacy 拼写；改动它不触及任何已注册接受集 |
| Task 创建身份 | Task 由哪个 Major 创建只由 `task_definition_snapshot.schema_version`（`'1.0'`/`'2.0'`）表达，`V3001` 的 creation-identity guard 把它绑定到在途 `execution.create_task` Receipt；R-206-1 已据此推导拼写（`execution.task`/`zhiju.execution.task`），#208 已实现 | Task 拼写是可由 owning 不可变事实精确证明的事实，与 WorkOrder 版本无关 |
| legacy 拼写的注册状态 | `execution.work_order`/`execution.task` 都不是 Registry objectType（`taskExecutionObjectTypes` 只含 `zhiju.*` 条目）；`execution.work_order` 只出现在冻结 Baseline 的 integration-gateway envelope enum 与 #200 binding 中 | 本 revision 不把 legacy 拼写升级为注册 objectType（与 R-206-1 的处理一致） |
| WorkOrder 业务表与 Handler | `task_execution` 只有 V3000 技术表、V3001 的 `task`/`task_definition_snapshot` 与 V3002 的 `execution_judgment`；无 `work_order`/`work_order_draft_snapshot` 表、无 `create_work_order`/`get_work_order_draft` Handler、无组成层入口 | 本节固定的身份、生命周期、持久化与幂等边界是实现的全部安全前置 |

**缺口。** WorkOrder 的公开拼写与读取版本绑定、Task 跨 Major 绑定、创建期 Task 生命周期集合与锁/竞态、requester/actor 归属、DRAFT 与后续 Context/Validation/Freeze 的校验分工、`work_order` + `work_order_draft_snapshot` 的持久化与 guard、幂等/回放/并发/恢复，以及 @1.1/@2.0 读取的授权组成，在实现前都没有权威定义；若不由本节固定，实现必然自行发明身份或授权语义。

### 18.2 R-210-1 WorkOrder 寻址与读取版本绑定

**事实。** WorkOrder 的创建 Major 由不可变创建事实精确证明：本次 CREATE 的 `command_receipt` 行（`command_type='execution.create_work_order'`、`command_version` ∈ {`1.0`,`1.1`}、target 身份与 Project Scope 等于本 WorkOrder）。同一张 `task_execution.work_order` 表承载两个 Major 创建的行，行本身不存“哪个 Major”以外的拼写；拼写只由创建事实派生。

| 创建 Major（不可变创建事实） | 该 WorkOrder 唯一被接受的公开拼写 | 其 DRAFT payload 形状 | 唯一被接受的读取版本 |
|---|---|---|---|
| `execution.create_work_order@1.0` | `execution.work_order` | `WorkOrderDraft`（Core `VersionPins`） | `execution.get_work_order_draft@2.0`（**本 revision 新增设计**，§18.8） |
| `execution.create_work_order@1.1` | `zhiju.execution.work_order` | `InitialWorkOrderDraft`（`DraftVersionPins`） | `execution.get_work_order_draft@1.1`（已注册，零改动） |

**闭合规则（owning Handler 的义务，不由调用者选择）**

1. 一个 WorkOrder 恰好有一个被接受的公开拼写，取自其创建事实的 `command_version`：`'1.0'` → `execution.work_order`，`'1.1'` → `zhiju.execution.work_order`。大小写敏感、逐字符相等；另一版本的拼写、裸本地名（如 `WorkOrder`）、前缀剥离或补全、两个拼写互换一律拒绝。
2. `kind` 必须为 `OBJECT`；`objectId` 必须等于 `work_order_id`；`scope` 必须是 Project 形态 `{enterpriseId, projectId}` 且与该 WorkOrder 的 Scope 列逐字段相等。不做规范化、不做 fuzzy 查找、不回退 latest。
3. 读取版本与拼写**互相绑定**：`get_work_order_draft@1.1` 只接受 canonical 拼写，`get_work_order_draft@2.0` 只接受 legacy 拼写。请求另一读取版本、另一拼写、错 id、非 Project Scope 或不可见 WorkOrder 统一拒绝为 `EXECUTION_WORK_ORDER_REF_INVALID`（安全外观不区分“拼写错误”“版本不符”“Scope 不符”“不可见”，也不返回其他 Scope 的对象存在性）。该码是**读取/owning Handler 路径**的闭合码；创建路径的同一语义在更早的层被拒绝（第 5 条），不由本节码表达。
4. 两层各自精确：[Spec 001 §15.6](Module-Spec-001-IdentityPolicy.md#156-im06-wodraft-01-workorder-draft-读取授权组成提案210) 的读取授权条目按 `(type@version)` 声明该读取可接受的 target objectType 闭集，并要求请求声明的 target 与 covering Grant 的 selector 逐字符相等；**业务**上哪个拼写正确只由本节规则判定。调用者既不能靠声明另一拼写取得业务成功，也不能用另一个 target 的 Grant 提权。
5. CREATE 的 `targetRef` 仍按 #200 的既有绑定逐版本闭合（@1.0 legacy、@1.1 canonical），本节不改变它；其**真实可达的发生层**依次为：① **注册 Envelope**——`create_work_order@1.1` 带 `targetObjectType` 元数据，因此 `targetRef.objectType` 被 `const` 固定，错拼写、裸本地名、大小写变体与错 kind 在 Envelope 校验即拒绝为共享 `API_VALUE_INVALID`；`@1.0` 是 200 项 Baseline 条目、无 `targetObjectType`，其 target 不由 Schema 固定。② **`TaskExecutionCreationAuthorizationPort`（两版本）**——presented Decision 与 binding 的精确比对在幂等 Claim 与历史 Receipt 返回**之前**执行，`expectedTargetRef.objectType` 与该版本 binding 不一致即 `IDENTITY_CREATION_TARGET_INVALID`（沿用 #200 语义，内部分类只进安全 Audit）。③ **owning Handler**——创建期不再重新判定 target 拼写（①/② 已闭合），只由 §18.7 的持久化 guard 强制 `work_order_object_type` 等于 Receipt `command_version` 派生拼写。因此“创建时被授权的 target 拼写”与“创建后被接受的公开拼写”对两个 Major 恰好相同，而 `EXECUTION_WORK_ORDER_REF_INVALID` 不是创建路径码。
6. 跨版本永远不是等价重试：不得用另一个 `create_work_order` 版本的历史 Receipt 返回本版本结果，也不得凭历史 Receipt 取得创建或读取资格（沿用 §15.3 第 4–5 条）。

**为什么这不是别名。** 别名意味着同一对象在业务接受集里有第二个可用名字。R-210-1 让每个 WorkOrder 恰好一个拼写被接受，且该拼写同时决定唯一可用的读取版本；另一个拼写在授权 Port、owning Handler 与注册 Schema 三处都不能取得业务成功。两个拼写不是“同一操作的两个名字”，而是“两条已发布创建路径各自的唯一身份”，与 §16.1/§17.3 对 Task 的处理同源。

**`execution.get_work_order_draft@1.0` 的处理（本 revision 明确保留不改）。** 它已注册（但不在 200 项 Baseline 中），payload 固定 canonical、result 形状为 `WorkOrderDraft`。在本规则下没有任何创建 Major 产生“canonical 拼写 + `VersionPins` DRAFT”这一组合（@1.1 写 `DraftVersionPins`，@1.0 写 legacy 拼写），因此它**没有可满足的 IM-06 输入**。本 revision 逐字节保留它：不收窄、不放宽、不删除、不为它实现 Handler，也不把它的接受集改写为 legacy。若将来需要让它可用，必须由独立 additive 提案提供能产生该组合的创建路径或明确改写接受集，不得由实现顺带决定。

**不注册 legacy objectType。** 本 revision 不把 `execution.work_order` 注册为 Registry objectType，也不改写任何 `references` 声明：legacy 拼写与 R-206-1 的 Task 拼写一样，是 owning Handler 层的模块级接受集收窄，不是新的公开对象名。`get_work_order_draft@2.0` 的 `/payload/workOrderRef` 因此**有意不声明**（与 §17.4 对 `/payload/taskRef` 的不声明同理）。未采用方案：把 @2.0 的 `/payload/workOrderRef` 固定为 `const execution.work_order` 并同时把该 legacy 名注册为 objectType——它扩大公开命名面并需要 namespace/owner 归属决定，而“每个 WorkOrder 恰好一个被接受拼写”的结论不依赖它。

### 18.3 R-210-2 WorkOrder 与 Task 的绑定

**规则。** `draft.taskRef` 的拼写必须等于**该 Task 自身创建事实**对应的拼写（R-206-1：创建定义快照 `schema_version='1.0'` → `execution.task`，`'2.0'` → `zhiju.execution.task`）；不得由 WorkOrder 版本、payload 其他字段、Task 的 `aggregate_version` 或 objectId 推断。两个 WorkOrder Major 都接受两个 Task Major，四种组合各自合法：

| WorkOrder 创建 Major | 绑定的 Task 创建 Major | `draft.taskRef.objectType` |
|---|---|---|
| @1.0 / @1.1 | `execution.create_task@1.0`（`schema_version='1.0'`） | `execution.task` |
| @1.0 / @1.1 | `execution.create_task@2.0`（`schema_version='2.0'`） | `zhiju.execution.task` |

1. `kind` 必须为 `OBJECT`；`objectId` 必须等于 `task_id`；`scope` 必须是 Project 形态且与 Envelope `scopeRef`、Task 的 Scope 列逐字段相等。
2. 拼写/kind/id/Scope 任一不闭合 → `EXECUTION_TASK_REF_INVALID`（复用 #208 已注册码），安全外观不区分“拼写错误”“Scope 不符”“不可见”；Scope 闭合成立但同 Scope 内不存在该 Task 行 → `NOT_FOUND`。
3. Task 的创建事实必须存在且自洽：该 Task 恰有一份创建定义快照，其 `schema_version` 与其创建 Receipt 的 `command_version` 一致（`V3001` 的 creation-identity guard 已强制）。事实缺失、不可读或与拼写判定不一致 → `EXECUTION_DEFINITION_REF_INVALID`（沿用 §17.9 语义），fail closed，不按“当前形状”猜测。
4. 两个 Task 拼写仍不是别名：每个 Task 恰好一个拼写被接受，另一拼写在创建与读取两侧都不能取得业务成功。
5. 两个 WorkOrder Major 都**不**在 DRAFT 快照中记录 Task 的 `aggregate_version`：DRAFT 不写 Task Root、不建立 Task 版本 CAS，也不据此产生 staleness；Task 的后续状态与版本由 §18.4 的创建期检查与后续 READY/Freeze/Queue/Run 各自的消费边界解释。
6. **持久层也必须闭合同一 Task 身份**（不能只依赖 Handler 先验校验）：`draft.taskRef`、Snapshot 顶层 `taskRef`、Root 的 `task_id`/`task_object_type`/Project Scope 与被查验 Task 行必须被 §18.7 的数据库 guard 判为同一个事实。三处绑定中只有 `draft.taskRef` 由创建请求投影证明其来自该命令，因此顶层与 Root 的绑定必须由 guard 值比较，而不是由写入者保证；§11.2.1 已有的“`draft.taskRef` 与 Snapshot `taskRef` 一致”在数据库层同样成立。

### 18.4 创建期 Task 生命周期、锁序与并发

**允许集合（闭合）。** 仅当绑定 Task 的 `status` ∈ `{READY, IN_PROGRESS, WAITING_INPUT, BLOCKED, IN_REVIEW, CHANGES_REQUIRED, COMPLETION_PENDING}` 才可创建 DRAFT WorkOrder；`{DRAFT, BACKLOG, COMPLETED, CANCELLED}` 一律拒绝 `EXECUTION_TASK_NOT_EXECUTABLE`。理由：`DRAFT`/`BACKLOG` 是尚未满足 #154 readiness 规则的执行前状态（§8.1 要求按 Readiness 规则满足创建 WorkOrder 的生命周期要求），`COMPLETED`/`CANCELLED` 是终态；这与 Domain §19.7 第 1 条“必须引用可执行且未 CANCELLED/COMPLETED 的 Task”一致，且不新增中间态。

**不产生可执行性。** DRAFT 创建只写本模块的 WorkOrder 事实：不改 Task 状态或版本、不签发 Capability、不 READY、不 queue、不创建 Run、不发布事件。因此它既不能让 unready Task 变得可执行，也不因创建成功而给 Task/WorkOrder 任何执行资格；后续每一步都各自重新授权并重读当前事实。

**锁与读取顺序。** WorkOrder 创建事务只对绑定 Task 取**只读依赖行锁**（`SELECT … FOR SHARE`，作用于本模块 `task` 表），并在持有该锁时校验 Scope、创建事实与 status；随后插入 Root 与快照。锁顺序遵循 PostgreSQL §33 的 `Task → WorkOrder → Run → Claim`；本操作不锁其他 WorkOrder、不反向持锁、不写其他 Root。

**并发裁决（稳定结果）。**

| 相遇情形 | 裁决 |
|---|---|
| 并发 Task 转换（`mark_task_ready`、cancel 等 `FOR UPDATE` 事务）先提交 | 创建事务取得共享锁后读到新 status：仍在允许集合则创建成功；已离开集合 → `EXECUTION_TASK_NOT_EXECUTABLE`，无 Root/快照/Receipt 成功事实 |
| 创建先提交 | 后续 Task 转换正常推进；已提交的 DRAFT WorkOrder 只作为历史 DRAFT 存在，不因 Task 变化获得或失去执行资格（后续切片各自重读） |
| 同一 Task 上两个并发创建（不同 target） | 两者都可成功（Domain §19.4 `Task 1 — * WorkOrder`）；不引入 Task 侧唯一约束 |
| 同一 target 的两个并发创建 | Root 主键/唯一约束裁决为唯一成功，另一侧 `EXECUTION_WORK_ORDER_ALREADY_EXISTS`，无部分事实 |
| 长事务跨过 `expiresAt` | 提交前以受信服务端时间重验 `now < expiresAt`（§11.2.4 第 1 条），不满足即拒绝 |

### 18.5 Actor、requester 与 Human-only 归属

1. **唯一 Actor 来源**是受信会话与已验证 Decision 行（组合层从 Decision 派生的 principal/kind/ActorSnapshot/Decision id 与 hash/Scope/Purpose）。`actingFor`、payload 里的 `requestedBy`、`initialAssignee`、任何 PrincipalKind 字符串声明与转交的他人 Decision 都不是授权来源，也不参与 ALLOW 判定。
2. `draft.requestedBy` 必须**恰好等于**认证 principal 的 `PrincipalRef`（Human、Coordinator Agent、受约束 Process Manager 一体适用）；不一致 → 共享 `AUTHORIZATION_DECISION_INVALID`（内部分类只进受权限控制的 Audit）。未采用方案：允许 payload 指定“Human requester + Service 执行”的双身份——它需要额外的 identity 证明边界，且正是 Issue 禁止的 caller-supplied `requestedBy` 旁路；本 revision 不发明该边界。Service 发起时不代表“替某个 Human 请求”；Human 归属只作为 owning ActorSnapshot 的 `actingFor` metadata 存在，不进入 WorkOrder payload、不改变授权。
3. 受约束 Process Manager 的服务发起请求只允许持自己的 `task.execution.create_work_order` Decision 与覆盖 Grant（§15.2 的精确 action/selector/Scope 规则）；`actingFor` 不替代 principal、不豁免该 Service 的 capability/Purpose/Scope。
4. **Human-only 能力（分类单元与检查输入）**：判定单元是声明的 capability code，即 Core §4.7 `CapabilityGrant.capabilityType`；`actions[]`、`resourceSelectors[]`、`constraints[]`、`expiresAt`、`grantPolicyRef` **不参与** Human-only 分类，也不因 DRAFT 而签发 Grant。当认证 principal 不是 Human 时，对 `allowedCapabilities[]` 与 `deniedCapabilities[]` 每个元素的 `capabilityType` 逐项（去重、canonical 字节序稳定序）经 owning 内部分类边界 [Spec 001 §15.7](Module-Spec-001-IdentityPolicy.md#157-im06-wodraft-02-workorder-draft-声明能力的-human-only-分类边界210) 分类；任一项属于 Human-only 集合即拒绝共享码 `HUMAN_ONLY_CAPABILITY`（[共享 API §8](../api-contract-v0.1/API-Contract-v0.1.md) 的共享错误码列表；Domain §19.10 的 `WO-U-002` 同码），内部分类只进受权限控制的 Audit；owning 边界返回本次判定实际使用的 `classificationRegistryVersion`，TE 把 `{outcome, classificationRegistryVersion}` 原样记入自己的 Audit（不进入不可变 DRAFT payload），既不硬编码也不读取 owning 模块常量。分类来源只能是 owning 的版本化静态集合（`HUMAN_ONLY_CAPABILITIES`，registry version `im02-static-v1`），不由 payload、角色名或 `requestedBy` 决定；TE 不复制集合，也不把 `IDENTITY_CAPABILITY_HUMAN_ONLY`（`identity.grant_capability` 模块码）或 `CAPABILITY_HUMAN_ONLY`（IdentityPolicy 的 Decision/Audit reason）当作本操作的公开错误码。HUMAN principal 的同类声明在创建期只被结构保留，必须由拥有可执行性判断的 Validator/Freeze 与 Grant 签发边界拒绝；DRAFT 不为 Agent/Service 引入 Human-only 能力，也不因创建成功使任何 capability 可执行。
5. `actingFor`、Human `requestedBy` 或 Human Decision 的转交都不能放宽 principal-kind 与 Human-only 限制：他人 Decision 在授权 Port 的 actor/principal 绑定处即失败，不进入 Handler（§18.9 第 1 步）。
6. `allowedCapabilities`/`deniedCapabilities` 的良构键是**精确 `capabilityType` 字符串**（大小写敏感、无规范化、不比较整个 Grant 对象）：同一 `capabilityType` 不得同时出现在两侧，出现即在创建期以共享 `API_VALUE_INVALID` 拒绝并写稳定 Audit（自相矛盾的计划不是授权判断）；创建期不签发 Grant、不改写集合，实际可执行集合在后续 Validator/Freeze 与 Run capability binding 边界重新计算并收窄（Domain §19.9「Authorization Service 计算并收窄」）。
7. **持久层的归属闭合（数据库 guard 与 RLS，不由 Handler 代劳）**：受信锚是 `platform_security.context_principal_id()`，**不是** Receipt 的 creator 列。已提交事实：`V0002__schema_roles_baseline.sql` 为各模块 app 角色默认授予新表 `SELECT, INSERT, UPDATE`；`V3000__task_execution_technical_tables.sql` 的 `command_receipt_insert` policy 只检查 `context_allows_enterprise/project`，`command_receipt` 也没有 creator mirror guard，因此该列是 caller-writable，不能当作“不可伪造的 Context 来源”。设计因此要求：① WorkOrder 两表的 RLS `WITH CHECK` 强制 `created_by_principal_id` 与 `requested_by_principal_id` 等于 `platform_security.context_principal_id()`（沿用 EnterpriseProject 既有先例，如 `V2001`/`V2003` 的 INSERT policy）；② creation guard 在同一事务内直接比较 `canonical_payload -> 'draft' -> 'requestedBy'`、`canonical_payload -> 'createdBy'` 的 `principalId`、Root 两个 principal id **以及来源 Receipt 的 `created_by_principal_id`** 都与 `platform_security.context_principal_id()` 相等（Receipt 被要求等于 Context，故“在 P2 Context 内伪造 creator=P1 的同 Scope PENDING Receipt”不能通过），Receipt/Root Scope 等于本 WorkOrder 的 Project Scope。
8. **`principalKind` 的平台增量（scope 于 2026-09-17 获准扩展）**：现有 transaction context 只保存 principal id，`platform_security.context_kind()` 是 `REQUEST`/`EVENT_CONSUMER` 而非 PrincipalKind。依 [RLS 事务上下文决定 §3.5](../decisions/rls-transaction-context.md#35-210-principalkind-的向后兼容增量设计提案)，未来 bootstrap migration 保留既有 10 参数 establish 入口（legacy Context 的 kind 为 NULL），新增带非空闭集 `principalKind` 的 11 参数重载和 `platform_security.context_principal_kind()`。TaskExecution WorkOrder 路径必须使用新入口；creation guard 必须把 `draft.requestedBy` 与 Snapshot `createdBy` 的**完整** `PrincipalRef` 同时绑定到 `context_principal_id()` + `context_principal_kind()`，helper 为 NULL、id 不同或 kind 不同全部拒绝。应用受信边界仍须在建立 Context 前按 #200 Port 复核 Actor/Decision/principal/kind；数据库增量不跨 Schema 读取 IdentityPolicy，也不把声明字符串本身升级为授权来源。

### 18.6 DRAFT 与后续 Context/Validation/Freeze 的校验分工

原则：**语法有效的 Ref 不等于已提交事实**；DRAFT 只证明它必须固化的事实，其余留给对应消费边界重新读取。

| 事实 | 创建时必须证明 | 仅结构保留在不可变 draft | 必须由后续边界重新读取 |
|---|---|---|---|
| WorkOrder 身份 / Scope / 创建 version | CREATE target、拼写、Project Scope、id（§18.2） | — | Freeze/queue/Run 各自的 Root 读取 |
| 绑定 Task | 存在性/可见性、Scope、创建事实拼写（§18.3）、status 集合（§18.4），并由 §18.7 的持久层 guard 把 `draft.taskRef` ↔ Snapshot `taskRef` ↔ Root mirrors ↔ 被查验 Task 判为同一事实 | Task Ref 与 Scope 进入快照 | 后续 READY/Freeze/queue/Run 重读 Task 当前状态与定义 |
| `targetScope` 与目标引用 | 形状与 Scope 包含关系：不得超出绑定 Task 与 Envelope；Project 锚定形态与 Envelope 逐字段相等；跨 Enterprise/Project 拒绝 `EXECUTION_WORK_ORDER_SCOPE_INVALID`（沿用 §16.3 的 Scope 形态规则） | 完整字段与 Scope | Freeze 的 candidate 组装与 Scope 复核 |
| `inputRefs` | 形状 + Scope 落在 Envelope 内（Platform `{}`/同 Enterprise/同 Project；`ExternalRef` 按其有无 `tenantOrAccountRef` 两分支，未携带者只是来源意图）；跨租户拒绝 | 完整 Ref 集合 | 存在性、版本、生命周期、可用性与 Purpose 裁剪（Readiness/Context Builder）；`ExternalRef` 须先经 owning 授权 Adapter 形成正式对象 |
| `expectedOutputs[].acceptancePolicyRef`、`completionCriteria[].evaluatorRef`、`versionPins.*`、`riskAndQuality` 等 Profile Ref | 形状 + Scope 包含关系（同上）；未知 namespace 拒绝 | 完整字段 | Evaluator/Policy/Profile 的存在性、支持版本与当前有效性（Validator §11.9、`EXECUTION_CRITERION_UNSUPPORTED`） |
| `allowedCapabilities`/`deniedCapabilities` | 形状 + Scope 闭合 + 良构键（§18.5 第 6 条：精确 `capabilityType` 不得跨两侧重复）+ 非 Human 时对每个声明 `capabilityType` 的 Human-only 分类拒绝（§18.5 第 4 条，经 Spec 001 §15.7 的 owning 边界） | 完整集合 | Grant 签发/收窄与 Run capability binding；HUMAN principal 声明的 Human-only 能力必须在此被拒绝；Freeze 的可执行性判断 |
| `budget`/`executionPolicy`/`harnessPolicy`/`modelPolicy`/`constraints` | 形状与 Hash | 完整字段 | 预算与 Policy 支持、当前有效性（Freeze、queue、`create_run`） |
| `expiresAt` | 存在性与值；提供时以受信服务端时间要求 `now < expiresAt`（§11.2.4 第 1 条，违反用 `API_VALUE_INVALID`） | 原样进入 Root 与快照并进入完整 Hash | Builder/Validator/Freeze/queue/create_run/start_run 各自按当前时间重验（§11.2.4、Domain §19.7.1） |

- **@1.0 的 `versionPins.projectContextContractRef`**：该字段在 @1.0 DRAFT 中必填，但首次 Context 的循环引用正是 @1.1 要解的问题（TD-01），因此它可能指向尚未冻结的 Contract。创建期只校验该 Ref 的形状与 Scope 包含关系，不解析、不证明其存在或适用；其存在性、Hash 与适用性由 §11.2.3/§11.2.5.2 的候选组装与 Freeze 边界决定。@1.0 DRAFT 的合法创建因此不依赖任何已冻结 Contract。

**明确否定。** Schema 通过、Hash 正确、Ref 形状合法都**不**证明引用存在、当前授权有效或可执行；Human-only 能力、跨 Project 引用、缺失或过期引用、未支持的外部引用与依赖不可用都不得因“payload 通过 Schema 校验”而被当作有效。

### 18.7 持久化事实与事务边界（设计；migration 编号在实现时分配）

一次成功的 DRAFT 创建在**同一 owning 事务**提交 Root、不可变快照、Receipt、Audit 与仅指向已证明引用的 Reference Edge；任一步失败整体回滚，不留 `PENDING` Receipt 或孤立事实。本节不修改已应用的 `V3000`/`V3001`/`V3002`；未来 forward-only migration 的编号由实现 Issue 分配。

`task_execution.work_order`（Aggregate Root，**未实现**）

| 列 | 内容与约束 |
|---|---|
| `work_order_id` | = 已校验 Envelope `targetRef.objectId`（UuidV7），主键；`UNIQUE (enterprise_id, project_id, work_order_id)` |
| `enterprise_id` / `project_id` | 受信 Project Scope 镜像，创建后不可变 |
| `work_order_object_type` | 该 WorkOrder 唯一被接受的公开拼写（§18.2），创建后不可变；由 creation-identity guard 按创建 Receipt 的 `command_version` 强制 |
| `task_id` / `task_object_type` | 绑定 Task 的 identity 与创建 Major 拼写镜像（§18.3），创建后不可变；由同一 guard 按该 Task 的创建定义快照 `schema_version` 复核 |
| `status` / `aggregate_version` | 创建为 `DRAFT` / `1`；只有 owning 转换（本切片不实现）可改变；Scope 与身份列不随之改变 |
| `current_draft_snapshot_id` + `current_draft_snapshot_hash` | 组合指针；比较必须含 hash，不得只比较 `snapshot_id`，也不得把 `aggregate_version` 当 `snapshot_id` |
| `draft_schema_version` | `'1.0'` = `WorkOrderDraft` payload、`'1.1'` = `InitialWorkOrderDraft` payload；由 creation-identity guard 与 Receipt `command_version` 强制相等 |
| `expires_at` | 可空、创建后不可变；NULL 只对应 canonical payload 字段缺省，禁止用 JSON null 冒充缺省；存在性与值进入完整 payload Hash |
| `created_at` / `created_by_principal_id` / `requested_by_principal_id` | 受信时刻与归属（§18.5 第 2 条使 requested == authenticated principal） |

`task_execution.work_order_draft_snapshot`（不可变事实，**未实现**）

| 列 | 内容与约束 |
|---|---|
| `snapshot_id` | 应用生成的 UuidV7，**独立于** `aggregate_version`；主键 |
| `work_order_id` | 组合指针 FK `(work_order_id, current_draft_snapshot_id, current_draft_snapshot_hash)` 只指向同一 WorkOrder 的快照行 |
| `draft_schema_version` | 同上；与 payload 形状一一对应 |
| `canonical_payload` | `WorkOrderDraftSnapshot` 形状的规范 JSON：`{snapshotId, workOrderRef, taskRef, scopeRef, draft, expiresAt?, capturedAt, createdBy}`，逐字节保存；其中 `workOrderRef`/`taskRef` 使用 §18.2/§18.3 的派生拼写，`draft` 为该 Major 的形状 |
| 提升镜像 | `work_order_object_type`、`task_object_type`、`enterprise_id`/`project_id`、可空 `expires_at`、`payload_hash`（SHA-256、32 字节、canonicalization v1）与 `canonicalization_version`；必须与 `canonical_payload` 逐项一致（null-safe 比较，禁止 SQL NULL、JSON null 与缺省互相冒充） |
| `request_payload_hash` / `source_command_id` | 绑定产生本快照的在途请求：`source_command_id` 指向仍在途（`PENDING`）的 `execution.create_work_order` Receipt；`request_payload_hash` 列保存该 Receipt 的请求 Hash，但其**唯一证据**是 guard 由 `canonical_payload` 重建的创建请求投影（见下），同名列本身不构成证明；Receipt 的 `command_version` = `draft_schema_version`、target type/id 与 Project Scope = 本 WorkOrder |

- **创建请求投影（数据库可重建的闭合定义）**：`request(canonical_payload) = {draft: canonical_payload -> 'draft'}`，并且当且仅当 `canonical_payload` 含 `expiresAt` 成员时并入 `{expiresAt: canonical_payload -> 'expiresAt'}`。成员集合恰好是 `{draft}` 或 `{draft, expiresAt}`——注册 Schema 已把 `create_work_order` 的 payload 闭合为 `draft` 与可选 `expiresAt`，因此不存在“未知成员”分支；Snapshot header（`snapshotId`/`workOrderRef`/`taskRef`/`scopeRef`/`capturedAt`/`createdBy`）**不得**计入投影。规范化使用 owner-only 的 `task_execution.canonical_jsonb_text`（canonicalization v1），Hash 为 `sha256(convert_to(<规范化文本>, 'UTF8'))`，必须**等于**来源 Receipt 的 `request_payload_hash`。`expiresAt` 的存在性与值同样参与：增删该成员、改写其值或用 JSON null 冒充缺省都会改变投影 Hash（JSON null 已在注册 Envelope 的 `instant` 形状被拒）。`payload_hash`（覆盖完整 Snapshot payload，含 header 与成员存在性）与请求投影 Hash 是两个不同的绑定，不能互相替代，也不能只比较同名列。
- **双 guard**：`SECURITY DEFINER` 的 mirror guard 由 `canonical_payload` 重算 Scope、拼写与期限镜像及 `payload_hash`（复用 `V3001` 的 owner-only `task_execution.canonical_jsonb_text`，app 角色不可执行）；`SECURITY INVOKER` 的 creation-identity guard 强制来源 Receipt 身份与 `command_version` ↔ `work_order_object_type` ↔ `draft_schema_version` ↔ payload 内 `workOrderRef.objectType` 四者一致、上述创建请求投影 Hash 相等、`canonical_payload.expiresAt` 与 Root `expires_at` 的存在性/值一致、以及 `task_object_type` 与被绑定 Task 的创建事实一致。因此“复用他人的 Receipt 换内容”“把 @1.1 payload 重标为 `1.0`”“增删或改写 `expiresAt`”“事后补写快照或只改指针”都不能成立。
- **Task 身份闭合（持久层，不由 Handler 代劳）**：创建 guard 必须把下列四处判为**同一个事实**，任一字段不等即拒绝且不区分内部分类：① `canonical_payload -> 'draft' -> 'taskRef'`（请求声明，已由创建请求投影绑定到来源 Receipt）；② `canonical_payload -> 'taskRef'`（Snapshot 顶层引用）；③ Root 行的 `task_id`、`task_object_type`、`enterprise_id`/`project_id`；④ 被查验 `task_execution.task` 行的 `task_id`、Scope 列，及其创建定义快照 `schema_version` 派生的拼写。相等判定为 `kind='OBJECT'`、`objectType` 相同、`objectId` 相同、Project Scope 两个成员相同；③ 的 `task_object_type` 与 ①/② 的 `objectType` 都必须等于 ④ 的派生拼写。guard 在同一事务内读取 Root 行（Root 先插、Snapshot 后插，指针 FK 为 deferrable），因此不存在“先写 Snapshot 再改 Root”的窗口。**不能只依赖 Handler**：创建请求投影只证明 ① 来自该命令，②/③ 是派生写入——直 SQL 可把它们改成同 Scope 内另一创建事实自洽的 Task B，而完整 payload Hash、请求投影 Hash、Task B 创建事实与来源 Receipt 仍分别通过；因此 ①↔②↔③↔④ 的相等必须在数据库层强制（§18.3 第 6 条、§11.2.1 的 `draft.taskRef` = Snapshot `taskRef`、`TE-P210-017`）。
- **归属闭合（持久层，不由 Handler 代劳）**：受信锚是 platform transaction context 的完整 PrincipalRef：① 两表 INSERT policy 的 `WITH CHECK` 要求 `created_by_principal_id`/`requested_by_principal_id` 等于 `platform_security.context_principal_id()`（EnterpriseProject `V2001`/`V2003` 先例）；② guard 在同一事务内要求 `canonical_payload -> 'draft' -> 'requestedBy'` 与 `canonical_payload -> 'createdBy'` 的 `principalId`/`principalKind` 分别等于 `context_principal_id()`/`context_principal_kind()`，Root 两个 principal id 与来源 Receipt 的 `created_by_principal_id` 等于 Context principal id，且 Receipt/Root Scope 等于本 WorkOrder 的 Project Scope。**Receipt 的 creator 列不是受信锚**；legacy 10 参数 Context 的 kind helper 为 NULL，因此不能创建 WorkOrder。两份 payload kind 同时伪造成同一个错误值也因不等于 Context kind 而被 guard 拒绝（§18.5 第 8 条、`TE-P210-017`）。
- **不可变性与 ACL**：app 角色对快照无 `UPDATE`/`DELETE`，Root 无 `DELETE`；Scope、身份、拼写与期限列由 immutable trigger 保护；指针变化必须是 `aggregate_version` 前进的 CAS 转换（本切片不实现该转换）。
- **RLS**：两表都显式保存 `enterprise_id`/`project_id`，`FORCE RLS` + `context_allows_project`（与 `V3001`/`V3002` 同族）；不建立跨 Schema FK/Join，不复制其他 Schema 数据。
- **Outbox**：0 行（§18.10）。
- **Reference Edge**：只写本事务已证明存在的引用——绑定 Task（owner 为本次 WorkOrder，target 使用 §18.3 的创建 Major 拼写）。`inputRefs`、`versionPins`、`acceptancePolicyRef`/`evaluatorRef` 等未证明的引用只存在于不可变快照 payload，其 Edge 由证明其存在与当前有效的 owning 动作在各自事务写入（沿用 §16.4 的规则）。

### 18.8 精确 DRAFT 读取与授权组成

**读取语义（两个可满足版本同形）。** 读取按 exact identity 返回已提交事实，不重建、不推断、不补字段：

1. 按 `(type@version)` 选定唯一可接受的拼写与 result 形状（§18.2）；`workOrderRef` 必须与该 WorkOrder 的 `work_order_object_type`/`work_order_id`/Scope 逐字段相等，否则 `EXECUTION_WORK_ORDER_REF_INVALID`。
2. 读取 Root 与当前快照：`draftSnapshotRef` 的 `objectId`/`contentHash` 必须等于当前指针的 `snapshot_id` 与由 `canonical_payload` 重算的 Hash；`draft`/`expiresAt`/`status`/`rootAggregateVersion` 全部来自已提交列；Root↔快照或指针↔payload 不一致一律 `REFERENCE_INVALID`，不返回“部分成功”的结果。
3. 只接受 `status='DRAFT'` 的 Root（§11.1）；其他状态 → `AGGREGATE_STATE_NOT_ALLOWED`，不返回非 DRAFT 的 draft 内容。
4. 已过期但仍为 `DRAFT` 的 Root 在当前读取授权下仍返回历史事实（§11.2.4 第 2 条）；返回 DRAFT **不**赋予构建、校验、冻结、排队或执行资格，也不改变任何状态。
5. 读取版本与 payload 形状必须由同一创建事实派生：请求的读取版本与 Root `draft_schema_version`（= 创建 `command_version`）不一致时按第 1 条以 `EXECUTION_WORK_ORDER_REF_INVALID` 拒绝；不存在“另一版本可读同一对象”的路径。
6. 读取**不**返回判断、有效性结论或跨模块事实；`expiresAt` 只是不可变期限的原样读回。

**新增读取版本（设计，实现时注册）**

| 项 | 固定值 |
|---|---|
| operation / version | `execution.get_work_order_draft@2.0` |
| Owner / kind / Consistency | `task-execution` / `QUERY` / `AUTHORITATIVE` |
| Target | 既有 WorkOrder Root（无 `targetObjectType`、无 `concurrencyMode`；Query 不写状态） |
| authorizationPurpose | `execution.work_order.draft.read`（复用已注册 Purpose；同 Purpose 不表示 Decision 可跨版本，沿用 §15.1） |
| dataClassification | `INTERNAL` |
| Payload | `workOrderRef: ObjectRef<WorkOrder>`（**通用 `ObjectRef`**，接受集按 §18.2 第 3 条由 owning Handler 闭合；`/payload/workOrderRef` **有意不声明**，理由见 §18.2） |
| Result.data | `{draftSnapshotRef: Exact<WorkOrderDraftSnapshot>, draft: WorkOrderDraft, expiresAt?: UtcInstant, rootAggregateVersion: NonNegativeInt, status: WorkOrderStatus}`；`/draftSnapshotRef` → CONTENT_ADDRESSED / `zhiju.execution.work_order_draft_snapshot` |
| PayloadGuard | 不新增专用技术 Policy，适用 [PostgreSQL §5.5](../high-level-docs/07-postgresql-logical-model-v0.1.md#55-默认-payload-guard) 的默认 Guard（同 #158/#167/#175/#192/#208） |
| 生成物 | `contracts/src/operations/task-execution.schema.ts` 的 `versionedOperationSchemas` 新增条目与对应 `$defs`；`public-api.v1.json` +1；`operation-compatibility-metadata.v1.json` +1；`operation-registration.ts` 的 `taskExecutionRegistrations` +1 及断言；`contracts:generate` 重生成 `public-api.ts` 与 `generated/types`；正负 fixture |
| 计数 | Catalog/Registry **214 → 215**、TaskExecution **44 → 45**（24 → 25 Query）；历史 **200** 项 Baseline 不变（additive 追加，不改写任何既有条目） |

**Draft Snapshot 声明形状的增量（设计）**

| def | 现状 | 要求的改动 | 分类 |
|---|---|---|---|
| `workOrderDraftSnapshot` | `workOrderRef` 与 `taskRef` 都固定 canonical | `workOrderRef` 固定为**该 def 对应创建 Major 的拼写** `execution.work_order`；`taskRef` 改为通用 `ObjectRef`（与 `workOrderDraft.taskRef` 同形，接受集由 §18.3 闭合） | 该 def 不被任何注册 operation 的 payload/result 引用，也不在 200 项 Baseline 中；改动不改变任何已注册接受集、Catalog 计数或兼容元数据 |
| `initialWorkOrderDraftSnapshot` | `workOrderRef` 与 `taskRef` 都固定 canonical | `workOrderRef` 保持 canonical（与 @1.1 创建事实一致）；`taskRef` 改为通用 `ObjectRef` | 同上 |

**读取授权组成（本 revision 必须补齐的 owning 前置）。** `identity.authorize_command@1.0` 的签发路径硬性拒绝非 `1.0` 的 `commandVersion`（`modules/identity-policy/src/commands/actor-snapshot.ts`），因此 @1.1 与新增 @2.0 的读取当前**不存在可路由、可签发、可重验的授权路径**；仅有 Registry 里的 Purpose 字符串不足以实现权威读取。本 revision 因此固定一个 IdentityPolicy owning 内部 Port 的读取条目（[Spec 001 §15.6](Module-Spec-001-IdentityPolicy.md#156-im06-wodraft-01-workorder-draft-读取授权组成提案210)）：按 `(type@version)` 逐条声明 Purpose、Grant action、`TARGET_TYPE` selector 闭集与受信 capability config key，并在返回任何历史结果或读取事实**之前**重验精确 Decision id 与 hash、Actor/principal、认证上下文、type/version/Purpose、payload Hash、精确 target 与 Project Scope、ALLOW 与未过期，并以当次受信时间重读当前 covering Grant/Policy；撤销、到期、配置漂移、target 或版本替换、IdentityPolicy 不可用一律 fail closed。

- 该 Port 不是公开 Command/Query、不进 Catalog、不新增 capability code、不改 `authorize_command@1.0` 的接受集、不新增 IdentityPolicy 迁移（复用 V1006 既有 target 列）；`get_work_order_draft@1.0` 保留既有通用路径。
- 同一版本缺口也存在于 `execution.build_initial_context_snapshot@1.1`，它由 TD-01 的 Context 切片拥有，本 revision 有意**不**顺带关闭（#214 的闭合提案见 §19.3 与 Spec 001 §15.8，待独立审查与人类设计批准）。

### 18.9 幂等、重放、并发与恢复

沿用 #151 runner 与 #204 的既有语义，并补齐 WorkOrder 创建所需的精确绑定：

1. **顺序**：Registry 精确 `(type, version)` 校验 → 组合层从已验证 Decision 行派生受信上下文 → **在幂等 Claim 与历史 Receipt 返回之前**调用 `TaskExecutionCreationAuthorizationPort.revalidateCreation`（精确 Decision id 与 hash、Actor/实际 principal、认证上下文、type/version/Purpose、payload Hash、target、Project Scope、ALLOW 与未过期，并以当次受信时间重读当前 covering Grant/Policy）→ 取得 Claim 后、首个业务写入前证明绑定 Task（§18.3/§18.4）→ 同一 owning 事务写入 §18.7 的事实并 finalize Receipt/Audit。
2. **幂等键**：`(idempotency_scope, idempotency_key)` 唯一；`idempotency_scope` 由服务端按 `execution.create_work_order@<version>` 与 Project Scope 组合，不接受调用者传入。
3. **返回历史 Receipt 前**必须比较持久化的 `command_type`/`command_version`/`target_type`/`target_id` 与本次命令；不一致即 `IDEMPOTENCY_PAYLOAD_CONFLICT` 并写 DENIED Audit，不返回另一版本 Receipt（两个 Major 的 payload 形状不同，但该比较仍是必须的，不能只依赖 `request_payload_hash`）。
4. **重放**：同键同输入返回原结果，不新增 Root/快照/Edge/Event；生效路径仍重新授权（第 1 步），但**不重跑** Task 业务证明，历史 Receipt 按原样返回（已提交 DRAFT 不因 Task 后续状态变化被改写）。
5. **CREATE 唯一性**：同一 Project Scope 内 `work_order_id` 已存在 → `EXECUTION_WORK_ORDER_ALREADY_EXISTS`，不写第二条 Root；并发同 target 由主键与唯一约束裁决为单一成功。
6. **原子性**：Root、快照、Receipt、Audit 与 Edge 同事务；注入故障或任一检查拒绝整体回滚，不留 `PENDING` Receipt 或孤立事实，同键重试可从零开始。
7. **依赖不可用**：IdentityPolicy（以及实现若复用的其他 owning 读取）不可用一律映射共享 `DEPENDENCY_UNAVAILABLE`，不得被解释为空结果或默认通过。
8. **事务上下文**：沿用 #151 的 `context_allows_project` 与池复用隔离要求；本切片不新增池语义。

### 18.10 公开事件边界

DRAFT 创建**有意不发布任何公开业务 Event**：本事务 `outbox_event` 0 行，也不存在可发布的 WorkOrder 草案事件（Catalog 的 `execution.*` Event 恰 11 项，含 `WorkOrderBecameReady@1.0`/`WorkOrderQueued@1.0`/`WorkOrderCompleted@1.0`，没有 `WorkOrderDrafted`）。Domain §19.8 的 `WorkOrderDrafted` 只是 Domain 词汇，不是已注册公开事件；Handler 不得发布未注册事件，也不得从 Domain 事件列表反推公开事件。若将来需要该事件，必须作为独立 additive 契约提案批准，并同步 Registry、兼容元数据、reference 声明、Catalog 计数与正负 fixture。

### 18.11 稳定错误码与安全外观

| 错误码 | 触发条件 | 安全外观 |
|---|---|---|
| `EXECUTION_WORK_ORDER_REF_INVALID`（**本切片新增**） | **读取路径**的 WorkOrder 拼写、读取版本、kind、id 或 Scope 闭合失败（§18.2 第 3 条）；创建路径的同类语义在更早的层被拒 | 不区分“拼写错误”“版本不符”“Scope 不符”“不可见”；不返回其他 Scope 的对象存在性 |
| `EXECUTION_WORK_ORDER_ALREADY_EXISTS`（**本切片新增**） | 同一 Project Scope 内 CREATE identity 已存在，含并发同 target；这是该情形的**唯一**稳定码，不使用 `CONCURRENCY_CONFLICT` | 不覆盖既有事实，不返回他人结果 |
| `IDENTITY_CREATION_TARGET_INVALID` | 创建路径的 `expectedTargetRef.objectType` 与该 `(type@version)` binding 不符（@1.0 的真实可达层，沿用 #200 语义） | 内部分类只进受权限控制的 Audit；不泄露其他 Scope 存在性 |
| `EXECUTION_TASK_REF_INVALID` | 绑定 Task 的拼写/kind/id/Scope 闭合失败（R-210-2，沿用 #208 语义） | 同 #208，不区分内部原因 |
| `EXECUTION_DEFINITION_REF_INVALID` | 绑定 Task 的创建事实缺失、不可读或与拼写判定不一致（沿用 §17.9） | 拒绝，不猜测形状 |
| `EXECUTION_TASK_NOT_EXECUTABLE` | 绑定 Task 的 status 不在允许集合（复用 §6） | 不写 Root 与快照，不泄露原因细分 |
| `EXECUTION_WORK_ORDER_SCOPE_INVALID` | `targetScope`、目标引用或能力引用的 Scope 不闭合或跨租户（复用 §6） | 统一拒绝 |
| `HUMAN_ONLY_CAPABILITY` | 非 Human principal 声明的 `capabilityType` 被判为 Human-only（共享码，经 Spec 001 §15.7 的 owning 分类边界） | 不签发 Grant、不创建事实；公开错误不暴露集合内容或内部 reason |
| `API_VALUE_INVALID` / `AGGREGATE_STATE_NOT_ALLOWED` / `REFERENCE_INVALID` | 创建期限已过或 allowed/denied 的 `capabilityType` 重叠；读取非 DRAFT Root；Root↔快照、指针↔payload 或创建请求投影 Hash 不一致（共享码，§11.2.4） | 沿用既有语义 |
| `IDEMPOTENCY_PAYLOAD_CONFLICT` / `NOT_FOUND` / `DEPENDENCY_UNAVAILABLE` / 共享授权码 | 同键异输入；同 Scope 不可见；owning 依赖不可用（含分类边界不可用）；Decision/Actor/Scope/期限失败 | 沿用既有语义；内部分类只进安全 Audit |

**发生层序（同一语义可能更早被拒）**：注册 Envelope（`API_VALUE_INVALID`：@1.1 的 `targetRef.objectType` `const`、closed payload、`instant` 形状、未知字段）→ IdentityPolicy 边界（`IDENTITY_CREATION_TARGET_INVALID`、共享授权码、分类边界的 `DEPENDENCY_UNAVAILABLE`）→ owning Handler 与持久化 guard（本节的 `EXECUTION_WORK_ORDER_*`、`EXECUTION_TASK_REF_INVALID`、`EXECUTION_DEFINITION_REF_INVALID`、`HUMAN_ONLY_CAPABILITY`、`IDEMPOTENCY_PAYLOAD_CONFLICT`）。`TE-P210-*` 的每一行必须从能到达所断言层的合法基线开始，并在结果中标注实际发生层；一层更早的拒绝不得写成 Handler 的通过或失败。

本切片只新增 `EXECUTION_WORK_ORDER_REF_INVALID` 与 `EXECUTION_WORK_ORDER_ALREADY_EXISTS` 两个模块稳定码，随实现注册；其余表项全部复用已发布码。`HUMAN_ONLY_CAPABILITY` 是[共享 API §8](../api-contract-v0.1/API-Contract-v0.1.md) 既有共享码（Domain §19.10 的 `WO-U-002` 同码），不是本切片新增的模块码。

### 18.12 增量分类（本 revision 要求的契约与元数据增量）

| 已注册产物 | 需要的改动 | 分类与理由 |
|---|---|---|
| `create_work_order@1.0`（200 项 Baseline 成员） | **无**（payload、Schema、metadata 逐字节不变） | 身份语义由 owning Handler 与 §18.2 规则闭合，不重写已发布接受集 |
| `create_work_order@1.1` | **无** | 同上；其 `/targetRef` 声明与 #200 binding 一致 |
| `get_work_order_draft@1.0` | **无**（保留不改，且本切片不实现 Handler；见 §18.2） | 改写其 `const` 属于改变已发布接受集（共享 API §9.1 第 3 条、Catalog §9.2 第 5/6 行），必须走新 Major 或新操作 |
| `get_work_order_draft@1.1` | **无** | 它已是 @1.1 创建 Major 的忠实读取（canonical 拼写 + `InitialWorkOrderDraft`） |
| `get_work_order_draft@2.0` | **新增 operation 版本** | 唯一能同时满足 `create_work_order@1.0` 的 legacy 拼写与 `WorkOrderDraft` 形状的读取；additive，Catalog 214 → 215 |
| `$defs.workOrderDraftSnapshot` / `initialWorkOrderDraftSnapshot` | 拼写固定改为创建 Major 派生（`taskRef` 通用化） | 无注册 operation 引用这两个 def，也不在 Baseline；不改变任何已注册接受集、计数或 metadata |
| `operation-compatibility-metadata.v1.json` | +1 条目（@2.0，Purpose 复用 `execution.work_order.draft.read`） | additive；manual-review fingerprint 只对新条目生成 |
| `public-api.v1.json` 与生成物、`operation-registration.ts` | +1 条目与断言扩展 | additive |
| 历史 200 项 Compatibility Baseline | **不变** | `check-compatibility.mts` 的 `operationCount=200`、`envelopeDocuments=200` 与逐条比较继续通过；新版本按 `COMPATIBLE_MINOR operation-added-as-minor` 归类 |
| IdentityPolicy | 新增一个内部读取授权 Port 条目（[Spec 001 §15.6](Module-Spec-001-IdentityPolicy.md#156-im06-wodraft-01-workorder-draft-读取授权组成提案210)）与一个内部能力分类 Port（[Spec 001 §15.7](Module-Spec-001-IdentityPolicy.md#157-im06-wodraft-02-workorder-draft-声明能力的-human-only-分类边界210)） | 都不新增公开 Command/Query、不新增 capability code、不改 `authorize_command@1.0`、不新增迁移；分类集合版本由 owning 侧维护 |
| Platform transaction context | `tx_context.principal_kind`（可空仅为 legacy）、保留 10 参数 establish、新增 11 参数 establish 与 `context_principal_kind()` | 向后兼容的内部数据库合同增量；不改 `V0003`，不改变公开 API/Catalog；未来 forward-only bootstrap migration，WorkOrder 对 legacy NULL fail closed |
| TaskExecution migration | 未来 forward-only `V3003`（编号在实现 Issue 分配） | 不改 `V3000`/`V3001`/`V3002` |

### 18.13 验收矩阵与未运行边界

- 设计/静态分量（身份派生、读取版本绑定、Task 跨 Major 绑定、生命周期集合、Actor 与 requester 规则、platform transaction-context 兼容增量、校验分工、持久化与幂等边界、增量分类）由 `TE-P210-D-*` 对账；可执行分量由 `TE-P210-001`–`023` 定义（已于 2026-09-18 在真实 PostgreSQL 18.6 执行，见 §18.14），见 [Module-Test-003](../module-tests/Module-Test-003-TaskExecution.md#workorder-draft-创建与精确-draft-读取210-设计)。
- 本设计 revision **不改**代码、契约、Registry、生成物、migration 或 fixture：当时 Catalog/Registry 保持 **214**、TaskExecution 保持 **44**、历史 Baseline 保持 **200**、v1 冻结 fixture 与两个 `create_task` Major 及全部既有 WorkOrder 契约条目逐字节不变；本节新增的 operation、错误码与 migration 在该 revision 均**未注册、未实现、未分配编号**，其后由 §18.14 的 #212 按设计注册与实现（Catalog 215、TaskExecution 45、Baseline 仍 200）。
- 设计 revision 的未运行边界：WorkOrder DRAFT Handler、`work_order`/`work_order_draft_snapshot` 持久化、读取 Handler 与组成层、IdentityPolicy 读取授权条目、真实 PostgreSQL、RLS/ACL、直 SQL 篡改、回滚、并发、重放与权威读取当时全部 `NOT RUN`，其后由 #212 执行（见 §18.14 及该节保留的两个 `NOT RUN` 子分支）；首次 Context、WorkOrder 校验/冻结、Run/Attempt/Result、InformationRequest、Completion、Query/Projection（TD-05–07）、受控退出 Fixture、外部 Provider/Runtime/飞书与人工业务验收至今仍 `NOT RUN`。
- 依赖的既有证据（#200 授权 Port、#204 Task 创建、#208 readiness）只证明各自切片，不证明本节的创建、读取或跨模块业务链已可运行。
- **设计门禁已完成**：#210 的 durable scope 包含 [RLS 事务上下文决定 §3.5](../decisions/rls-transaction-context.md#35-210-principalkind-的向后兼容增量设计提案)、PostgreSQL §19.2 的 `principal_kind` 事实、11 参数 establish 重载与 `context_principal_kind()` helper，以及 TaskExecution WorkOrder 路径对新入口的消费。旧 10 参数入口兼容保留但产生 kind=NULL 的 legacy Context，不能通过 WorkOrder guard。该设计已在 revision `67e5df57db637953009ba21b2193114aec401ce6` 完成独立审查并取得明确人类设计批准；记录见 [Review.md](../reviews/pr-211/Review.md) 与 [Issue 评论](https://github.com/qzhike/zhiju-business-core/issues/210#issuecomment-5715698129)。
- 实现前置（#210 设计期记录）：Planner 仍须基于合并后的 `main` 对 WorkOrder DRAFT 创建与精确读取执行新的 `NOW + READY` 复核，且只有另行发布的实现 Issue 才授权注册、migration、Handler、Port 或组成层工作；该复核与授权已由 [Issue #212](https://github.com/qzhike/zhiju-business-core/issues/212) 承接并落地，实现事实与验证边界见 §18.14。WorkOrder、首次 Context、Validation/Freeze 与 IM-06 均**不**因本设计获批或本切片实现而完成。

### 18.14 实现事实与验证边界（#212，2026-09-18）

状态：`IMPLEMENTED AND EXECUTED 2026-09-18 BY Issue #212 / TE-P210-001–023 EXECUTED ON REAL PostgreSQL 18.6 / MERGED 2026-09-18（PR [#213](https://github.com/qzhike/zhiju-business-core/pull/213)，merge commit `f0dccc9601316752dca15b393ef24f31199929f8`）/ INDEPENDENT REVIEW AND HUMAN TECHNICAL REVIEW RECORDED ON `4deffa472bfb5f96f85224d3ec930b43a0e61ba8` / DELIVERY CLOSEOUT IN §18.15`。[Issue #212](https://github.com/qzhike/zhiju-business-core/issues/212) 按 §18 的已批准设计交付本切片；本节只记录实现事实、必须的可核验点与仍然 `NOT RUN` 的边界，执行证据（revision、测试计数、PostgreSQL 版本与迁移路径、Catalog/Registry/Baseline 计数、独立审查结论与人类技术批准）保存在 Issue 与 PR，不另建并行报告。

**注册与生成物**

- `execution.get_work_order_draft@2.0` 已按 §18.12 注册为新增 operation 版本（additive，Purpose 复用 `execution.work_order.draft.read`）；`operation-compatibility-metadata.v1.json` 相应 +1 条目，`/payload/workOrderRef` 仍不声明。
- 生成物：`public-api.v1.json`、`contracts/src/generated/public-api.ts` 与 TaskExecution 生成类型随新版本更新，`operation-registration.ts` 的断言扩展为四个 WorkOrder 条目的逐版本闭合；正/负例 fixture 相应补齐。
- 计数：Catalog/Registry 214 → **215**，TaskExecution 44 → **45**；历史 **200** 项 Compatibility Baseline（200 operations / 200 envelopes）与 `compatible-minor` 归类不变，新版本按 `operation-added-as-minor` 归类。
- 四个既有 WorkOrder 操作逐字节不变：`execution.create_work_order@1.0`（legacy 拼写、Baseline 成员）、`@1.1`（canonical）、`execution.get_work_order_draft@1.0`（保留不改）与 `@1.1` 的注册 Schema/Purpose/metadata 与 v1 冻结 fixture 均未改写。
- 两个 `$defs` 按 §18.12 的唯一改动落地：`workOrderDraftSnapshot`/`initialWorkOrderDraftSnapshot` 的 `taskRef` 改为由创建 Major 派生的通用 `objectRef`；两者不被任何已注册 operation 引用、不在 Baseline，因此不改变任何已注册接受集、计数或 metadata。

**IdentityPolicy Port（Spec 001 §15.6/§15.7）**

- 读取授权：`createWorkOrderDraftReadAuthorizationPort` + `WORK_ORDER_DRAFT_READ_BINDINGS`（`modules/identity-policy/src/commands/work-order-draft-read-authorization.ts`），两条 `@1.1`/`@2.0` 条目互不替代，读取前 `revalidateWorkOrderDraftRead` 先于任何历史结果返回。
- 分类边界：`createTaskExecutionCreationCapabilityBoundaryPort`（`modules/identity-policy/src/commands/task-execution-capability-boundary.ts`）只按精确 `capabilityType` 判定并返回闭集 `{outcome, classificationRegistryVersion}`。
- 本切片**没有**新增公开 Command/Query、capability code、Catalog 条目、registry/metadata 变更或 IdentityPolicy 迁移（复用 V1006 的既有 target 列）。

**平台事务上下文（V0004）**

- `migrations/bootstrap/V0004__platform_principal_kind.sql` 给 `platform_security.tx_context` 增加可空 `principal_kind`，`CHECK (principal_kind IS NULL OR principal_kind IN ('HUMAN','AGENT','SERVICE','RUNTIME','EXTERNAL_PARTY'))`；10 参数 `establish_transaction_context` 以原签名与原权限重建并写 NULL kind；新增 11 参数重载（`p_principal_kind` 为第三个参数）与 `platform_security.context_principal_kind()`（`STABLE SECURITY DEFINER`，与 `context_principal_id()` 相同的过期重验与同一组 15 个 EXECUTE 角色）。
- ACL 与错误行为：两条 establish 入口的 EXECUTE 仍只授予 `platform_context_establisher`，`tx_context` 表权限与普通 app/projection 角色权限不变；同事务混用两个入口或使用不同 kind 一律 `40001`，非法/NULL/空 kind `22023`；`V0003` 未被修改。

**持久化（V3003）**

- `migrations/task_execution/V3003__work_order_draft_creation.sql` 建立 `task_execution.work_order`（Root）与 `task_execution.work_order_draft_snapshot`（不可变事实），以及 `task_execution.work_order_draft_request_hash(jsonb)`；不修改 `V3000`/`V3001`/`V3002`。
- Guard 集合：`SECURITY DEFINER` 的 mirror guard、`SECURITY INVOKER` 的 creation-identity guard、Scope/身份列的 immutable guard 与指针 `aggregate_version` 前进的 root-update guard；creation-identity guard 由 `canonical_payload` 重建 `{draft, expiresAt?}` 投影并与在途 Receipt 的 `request_payload_hash` 比较，同时把 Task 身份四处闭为同一事实。
- 不可变与权限：快照 `REVOKE UPDATE, DELETE`、Root `REVOKE DELETE`（`task_execution_app`）；组合指针为 deferrable 组合 FK，只指向同一 WorkOrder 且同时绑定 id 与 hash。
- RLS：两表 `FORCE RLS` + `context_allows_project`；INSERT/UPDATE 检查除 Scope 外还把 `created_by_principal_id`/`requested_by_principal_id` 锚定到 `platform_security.context_principal_id()`，归属 guard 进一步把两份 payload 的 `PrincipalRef` 绑定到 `context_principal_id()`/`context_principal_kind()`。
- 一次成功创建恰写一条 Task Reference Edge、0 行 `outbox_event`（无已注册的 WorkOrder 草案事件）。

**Handler 与组成层**

- 入口：`createWorkOrderDraftEntry`（`apps/api/src/composition/work-order-draft-entry.ts`）提供 `create` 与 `read` 两个能力，校验注册 Envelope 的精确版本、绑定 Decision/Actor 并经对应 IdentityPolicy Port 重验后才进入幂等 Claim 与历史 Receipt 返回（§18.9）；`@1.0` 无 Handler。
- 业务实现：`modules/task-execution/src/business/work-order-draft-creation.ts`、`work-order-draft-read.ts` 与 `persistence/work-order-draft-repository.ts`。
- 创建：按 §18.2 的版本-拼写绑定寻址与 §18.3 的 Task 创建事实派生 `taskRef` 拼写（四种 WorkOrder × Task Major 组合各自合法）；按 §18.4 的闭合 status 集合拒绝 `{DRAFT, BACKLOG, COMPLETED, CANCELLED}`，并以 `Task → WorkOrder` 只读锁序序列化 Task 转换竞态；按 §18.5 第 2 条要求 `draft.requestedBy` 等于认证 principal（三角色正对照各自成立，`actingFor`/`initialAssignee`/他人 Decision 均不提权）；按 §18.5 第 4 条把非 Human 的 Human-only 声明收敛为共享码 `HUMAN_ONLY_CAPABILITY`，并把 Port 的 `{outcome, classificationRegistryVersion}` 原样记入 Audit（受控版本值证明未硬编码 owning 常量）；按 §18.6 只固化创建期义务，其余留给 Context/Validation/Freeze。
- 读取：`@1.1`/`@2.0` 各自按 R-210-1 的版本绑定返回已提交事实的逐字段精确读回（`draftSnapshotRef`、`draft`、`expiresAt`、`status`、`rootAggregateVersion`），不补字段、不重建、不返回判断；`execution.get_work_order_draft@1.0` 保留既有注册 Schema 且实现期仍无 Handler，其请求在入口以 `API_CONTRACT_TYPE_UNKNOWN` 拒绝，不会被静默当作任一 Major 的读取。已过期但仍为 DRAFT 的 Root 仍按当前读取授权返回历史事实，不赋予任何执行资格。

**实现期关闭的偏差与跨切片修复**

- 偏差（i）：creation-identity guard 需要创建请求投影 Hash，因此 `V3003` 新增 `task_execution.work_order_draft_request_hash(jsonb)` 并把 EXECUTE 授予 `task_execution_app`；该函数是其参数的纯函数、不读任何表，owner-only 的 `task_execution.canonical_jsonb_text` 仍不授予 app 角色。
- 归属闭合的层界（PR #213 第 1 轮审查修正）：creator/requester 只在 **INSERT** 锚定 `context_principal_id()`（两表 INSERT policy 的 `WITH CHECK` 与 creation-identity guard），并随后由 root-update guard 判为不可变列；`work_order_update` policy **只**检查 `context_allows_project`，不要求当前 principal 等于创建者。创建归属不是对象所有权——把 id 等式写进 UPDATE 会让非创建者的合法 owning transition（例如获准的 Validator/Process Manager）在 RLS 层被拒，与 §18.7 与 §18.5 第 7 条不符。回归见 `TE-P210-017b`：principal B 在其自己的合法 Project Context 下可执行被 root-update guard 接受的 transition（`rowCount = 1`，不含该 Project 的 Context 为 0 行），而 `created_by_principal_id`/`requested_by_principal_id` 仍不可改写（`23514`）。
- 记录细节：PostgreSQL 的 trigger 名称顺序使 creation-identity guard 在两个 guard 都比较的维度上先于 mirror guard 求值；app 角色以他人 creator 列插入时断言的是数据库实际抛出的 SQLSTATE（RLS `WITH CHECK` 胜出为 `42501`，creation-identity guard 胜出为 `22023`）。
- 跨切片修复（随本切片落地）：`tests/persistence/task-draft-creation.test.ts` 与 `tests/persistence/task-readiness.test.ts` 把 Catalog 计数 214 → 215（readiness 文件另含 TaskExecution 44 → 45）；`task-draft-creation.test.ts` 的 `firstCommittedTaskId()` 现只作用于本套件自己的 fixture Project，不再取共享 gate 数据库中最早创建的 Task（该查询会被本切片新增的 Task 破坏）。

**未运行边界**

- `TE-P210-006` 的 `EXECUTION_DEFINITION_REF_INVALID` 分支与 `TE-P210-020` 的 Root↔快照 / 指针↔payload 不一致分支保持 `NOT RUN`：`V3001` 的 creation-identity guard 加定义快照不可变与组合指针 FK 使“与创建 Receipt 不一致或不可读的绑定定义”和“单 WorkOrder 的第二张快照或无法解析的指针”都不存在合法事实生产者；两行改为断言这些闭包（`23514`/`23503`），不以替代结果冒充通过。
- WorkOrder 校验/冻结/READY/queue、首次 Context、Run/Attempt/AgentResult、InformationRequest 与 retry、Completion、Query/Projection（TD-05–07）、受控退出 Fixture、外部 Provider/Runtime/飞书、生产、负载/性能与独立人工业务验收仍 `NOT RUN`。WorkOrder DRAFT 创建与精确读取的实现与通过**不得**被报告为首次 Context、Validation/Freeze、执行、Completion 或 IM-06 完成。

### 18.15 交付闭环（#212，2026-09-18）

- PR [#213](https://github.com/qzhike/zhiju-business-core/pull/213) 以 reviewed head `4deffa472bfb5f96f85224d3ec930b43a0e61ba8` 通过两轮独立审查：第 1 轮 `REQUEST_CHANGES` 于 `296a20b898726270a2a86664b4e6705189ddd757`，唯一阻断为 `V3003` 的 `work_order_update` policy 把创建归属误作对象所有权（只有原创建者能更新 Root，会阻断非创建者的后续合法转换）；修复把该 policy 收敛为仅 `context_allows_project(enterprise_id, project_id)`、归属仍由 INSERT 锚定与 root-update guard 的不可变列保护，并新增真实 PostgreSQL 回归 `TE-P210-017b`；第 2 轮据 `4deffa472bfb5f96f85224d3ec930b43a0e61ba8` 关闭该 finding，未发现其余 agent 可修复缺陷并路由 `HUMAN_REVIEW_REQUIRED`；审查记录 commit 为 `d660635`。
- 该 exact revision 的明确人类技术批准（授权组成与重放前重验、受信 `PrincipalKind`、`V3003` 的 RLS/最小 ACL、不可变与 payload/mirror/hash/source-command identity guards、并发/CAS/幂等/回滚，以及 `V0004`/`V3003` 的空库与历史升级迁移证据）记录为 PR comment [#issuecomment-5724627247](https://github.com/qzhike/zhiju-business-core/pull/213#issuecomment-5724627247)（GitHub 自审限制不接受 Review 形式的批准）；正式记录见 [`.vibe/reviews/pr-213/Review.md`](../reviews/pr-213/Review.md)。
- exact-head 证据：GitHub Actions `verify` 在该 SHA 上为 `SUCCESS`；独立执行的 `vibe verify full --json` 为 `PASS`（resolved command `pnpm clean && pnpm verify`，exit 0），其中 Docker/PostgreSQL 18.6 persistence gate 为 43/43 files、471/471 tests，migration 应用至 `0004` 与 `3003` 且第二次 Flyway migrate 为 no-op；Catalog/Registry **215**、TaskExecution **45** 与历史 **200** 项 Compatibility Baseline 保持不变。
- 以 merge commit `f0dccc9601316752dca15b393ef24f31199929f8` 合入 `main`（2026-09-18T03:28:23Z；base `f950317d61d2a73f14f3bb0e76c1cb451e0f3fed`）；Issue [#212](https://github.com/qzhike/zhiju-business-core/issues/212) 已关闭为 `COMPLETED`，远端与本地 `galendai/im-06-taskexecution-implement-workorder-draft-cr` feature branch 均已删除。
- 已接受边界不变：`TE-P210-006` 与 `TE-P210-020` 的两个无合法事实生产者子分支，以及 §18.14 列出的 WorkOrder 校验/冻结/READY/queue、首次 Context、Run/Attempt/AgentResult、InformationRequest 与 retry、Completion、Query/Projection（TD-05–07）、受控退出 Fixture、外部 Provider/Runtime/飞书、生产、负载/性能与独立人工业务验收，仍全部 `NOT RUN`；本次合并不把任何 `NOT RUN` 项记为已执行。

## 19. 首次 Context 构建与精确快照读取边界闭合（#214 设计）

状态：`T2 / DESIGN MERGED 2026-09-18（PR [#215](https://github.com/qzhike/zhiju-business-core/pull/215)，merge commit `a9421ada90408219a83bba2570ee2c00f920b894`）/ INDEPENDENT DESIGN REVIEW COMPLETED（七轮，第 7 轮 `HUMAN_REVIEW_REQUIRED` ON `d0d060fbacb98a6e9fdac1d098792a6222de4cff`；正式记录见 [`reviews/pr-215/Review.md`](../reviews/pr-215/Review.md)）/ EXPLICIT HUMAN DESIGN APPROVAL RECORDED 2026-09-18 ON `d0d060fbacb98a6e9fdac1d098792a6222de4cff` / IMPLEMENTED 2026-09-19 BY Issue #216（`V3004`、Spec 001 §15.8 授权 Port、确定性组装、build/read Handler 与组成层；实现事实与验证边界见 §19.10）/ TE-214-D-001–018 EXECUTED ON REAL PostgreSQL 18.6 / vibe verify full PASS 2026-09-19（`pnpm clean && pnpm verify`，exit 0，含 persistence gate 44/44 files、489/489 tests，见 §19.10）/ PR #217 INDEPENDENT IMPLEMENTATION REVIEW `PLANNING_REQUIRED` ON `bce56af9007e70ee79e46bcc90d49dd0fc5b35f5` / HUMAN TECHNICAL REVIEW NOT REACHED`。本节保留 #214 已批准设计与 Issue #216 的历史实现事实；PR #217 暴露的四项阻断由 §20 候选 Delta 修正，因此本节不再单独证明当前实现可验收。它不改动任何已注册 Contract/Registry 产物（Catalog 215、TaskExecution 45、历史 200 项 Compatibility Baseline 不变；唯一的 additive 注册是按 §19.9 落地的 EP-owned objectType `zhiju.project.enterprise_fact`）、#152/#165–#168/#188/#212 已交付实现或 `V3000`–`V3003`；未列出的行为沿用 §11、§18、[决定 §8](../decisions/task-execution-human-operated.md#8-wi-02-首次构建冻结与-retry-总序)与[决定 §17](../decisions/task-execution-human-operated.md#17-workorder-draft-创建与精确-draft-读取边界提案210)。实现事实与验证边界见 §19.10，待批准修正见 §20。

### 19.1 版本绑定与可满足性（R-214-1）

| build 版本 | WorkOrder 创建 Major | `draft_schema_version` | WorkOrder 拼写 | DRAFT payload | IM-06 可满足输入 |
|---|---|---|---|---|---|
| `execution.build_initial_context_snapshot@1.1` | `execution.create_work_order@1.1` | `'1.1'` | `zhiju.execution.work_order` | `initialWorkOrderDraft` + `DraftVersionPins`（`contextBuilderPolicyRef` 钉住 `zhiju.identity.policy`，无 `projectContextContractRef`） | **唯一可满足** |
| `execution.build_initial_context_snapshot@1.0` | 无 | — | — | — | **无**（注册保留、冻结、不实现） |

1. **@1.1 只接受 @1.1 创建事实**：目标 DRAFT 的 `draft_schema_version='1.1'`、`workOrderRef` 为 canonical 拼写、`draft` 为 `initialWorkOrderDraft`，且请求的 `draftSnapshotRef`（objectId/snapshotId/contentHash/Scope）与不可变 Draft Snapshot 逐字段相等、Root 当前指针解析到同一快照。`@1.0` 创建的 DRAFT（`'1.0'`、legacy `execution.work_order`、Core `VersionPins`）一律拒绝，错误码 `EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH`（新稳定码，实现时随错误码表登记，按注册 Envelope → IdentityPolicy Port → owning Handler 的真实层序归类）。
2. **@1.0 无满足输入，三条独立理由任一即闭合**：① Core `VersionPins.contextBuilderPolicyRef` 是未钉住 namespace 的通用 `versionedRef`，无法满足 §11.2.5.1 四点精确 PolicyRef 绑定（请求/projection/metadata/versionPins 必须同一 `zhiju.identity.policy` exact snapshot ref，§11.2.5.2 的 `POLICY_OBJECT_TYPE_INVALID` fail-closed）；② 其 pins 必带 `projectContextContractRef`（Core required，§18.6 创建期只验形状），与 #165 批准的“初始链 DRAFT 不携带 `projectContextContractRef`”方向互斥；③ @1.0 创建 Major 的 legacy WorkOrder 拼写不在初始链任何消费位置的已发布拼写内。已注册、已发布的 @1.0 保持逐字节不变：不实现 Handler、不创建授权路径（任何 @1.0 构建尝试在授权层即 fail closed，无可路由授权）、不注册 legacy objectType。
3. **禁止“变相可用”**：不得通过别名、placeholder/future ref、`latest`、调用方自选规范化或另一版本的历史 Receipt 使不可满足路径可用。两个 build 版本的 request shape 虽当前字节相同，身份判定只以目标 DRAFT 的不可变创建事实（`draft_schema_version` + 拼写 + pins 形状）为准，不以 payload 相似性、Purpose 或 target 类型相同放行。

### 19.2 Snapshot 身份与权威读取契约（R-214-2）

1. **唯一身份**：初始构建只产生注册的 canonical `zhiju.execution.context_snapshot` Project Scope SnapshotRef；kind=SNAPSHOT、objectId、snapshotId、scope（enterpriseId/projectId 双必填）、contentHash（SHA-256/64hex）、canonicalizationVersion `'1'` 六字段全部进入 Result Schema 与跨字段绑定（沿用 §11.2.5.3）。`zhiju.project.context_snapshot` 只是 Core v1.0 历史读回身份，不由新入口产生、不与 canonical 名称互换。
2. **身份关系闭合**：① objectId = 命令 `targetRef.objectId`（Envelope 分配的 CREATE 身份），snapshotId 独立（应用生成，独立于 aggregate_version/CAS）；② contentHash = owner-only canonicalizer（cv1，NFC 键碰撞拒绝）对完整 ProjectContext v1.0 规范 payload 的 SHA-256，覆盖 `expiresAt` 的存在性与值（§11.2.5.4）；build metadata 不递归进 payload hash（§33）；③ `data.contextSnapshotRef` 与 `targetRef` 的 objectId/Scope 逐字段一致；④ build metadata（`context_snapshot_build`）、source command 绑定（`command_receipt` + creation-identity guard）、`reference_edge`（DRAFT→Snapshot、Snapshot→Policy snapshot、Snapshot→每片 Slice）与 Outbox `source_command_id` 四方闭合来源。
3. **`execution.get_context_snapshot@1.0` 分类结论：足够，零改动**。通用 `snapshotRef` 请求形状已同时覆盖 canonical 新事实与 legacy `zhiju.project.context_snapshot` 历史读回；结果 `contextSnapshotRef` 与请求逐字段相等（namespace-agnostic 的读取绑定校验，#167 已固定）、`contractRef` 为内容寻址 Core ProjectContextContract ref。不需要 additive 操作版本，不改其 `v1.0-baseline` 兼容元数据与接受集，不重写历史 200 项 Baseline。未提交 Snapshot 或异 Hash 重放由 Handler 拒绝（`REFERENCE_INVALID`），读取授权走 §15.8 独立条目。
4. **Core/Catalog/共享 API**：本 Delta 的分类结论为“现有 Query 足够”，不要求改动 [03-core-contracts](../high-level-docs/03-core-contracts.md) §3、Catalog 06 或共享 API 任何已发布接受集；Registry 计数与 Baseline 不变。若实现期发现该 Query 存在未预料的接受集缺口，须回到 readiness 复核而非静默改写。

### 19.3 授权组成（R-214-3）

权威条目见 [Spec 001 §15.8](../module-specs/Module-Spec-001-IdentityPolicy.md#158-im06-ctxbuild-01-首次-context-构建与权威快照读取授权组成提案214)（关闭 §15.6 第 6 条显式留给 TD-01 Context 切片、§18.8 记录的 `build_initial_context_snapshot@1.1` 缺口）。组成规则：

1. **构建单一条目**：`execution.build_initial_context_snapshot@1.1` → Purpose `execution.context.build.initial`（已注册）、Grant action `execution.context.build.initial.v1_1`、`CREATE_TARGET_TYPE` 闭集 `{zhiju.execution.context_snapshot}`、受信 capability config key `contextSnapshotBuildV11`；Decision 签发绑定精确 targetRef，重验先于幂等 Claim 与历史 Receipt 返回。@1.0 不建授权路径（§19.1 第 2 条）。
2. **每个独立动作各自授权**：精确 WorkOrder DRAFT 读（复用 §15.6 的 `workOrderDraftReadV11`）、每片 Source Slice 读（EnterpriseProject owning `project.context_source.read`，每次现签）、PolicyVersion 精确解析（`identity.policy.resolve_policy`，每次现签，沿用 `resolvePolicyView` 先例）、权威 Context Snapshot 读（§15.8 的 `contextSnapshotRead` 条目）。构建 Decision 不隐含任何依赖读取能力；无 Service 通配授权、无 caller 提供 principal 替换、无转移 Decision。
3. **拒绝路径**只写同事务脱敏 `DENIED` Audit，不签发 Decision（沿用 §15.3 边界）。

### 19.4 确定性组装边界（R-214-4）

从精确 DRAFT（§19.1）、非空精确 Source Slice 集合与精确 Builder Policy 观测确定性组装 ProjectContext v1.0：

1. **排序与去重**：Source Slice 按 (objectType, objectId, snapshotId) 字典序稳定排序；Schema `unique` 之外，组装层对 exact ref 重复再次拒绝（`EXECUTION_CONTEXT_SOURCE_INVALID`）；空集合由 Schema `nonEmpty` 与组装层双重拒绝。
2. **每片核验**（经 EP owning 读，TE 不读 owning schema）：存在、contentHash 匹配、Scope 相等、**`slice.purpose` 逐字符等于 `request.purpose`**（沿用 §11.2.1 的每片同 purpose 规则；不等 → `EXECUTION_CONTEXT_SOURCE_INVALID`，跨用途数据不得进入另一用途的 projection，也不产生“先放行再裁剪”的路径）、purpose ∈ capture policy `allowedPurposeCodes`、audience 精确匹配、状态 `USABLE`（`EXPIRED`/`REVOKED` 拒绝，missing/stale/过期依赖统一 `DEPENDENCY_UNAVAILABLE` 或 `EXECUTION_CONTEXT_SOURCE_INVALID`，按发生层归类）。
3. **Builder Policy 观测**：唯一解析来源 `identity.resolve_policy@1.0` 当次返回（TE-WI02-D-017，caller 自报/推导/历史 Receipt 充数拒绝）；`allowedProjectionTypes` 含请求 projectionType、`policySchemaRefs` 含 `execution.context_builder.policy@1.0`（#179 profile）；观测的 ref/hash/effectiveFrom/supersededAt 与请求 `builderPolicyRef` 及 DRAFT `DraftVersionPins.contextBuilderPolicyRef` 四点逐字段相等（§11.2.5.1/§11.2.5.2 fail-closed 矩阵原样沿用）。
4. **projection 块与 audience 编码**：`projection.purpose := request.purpose`（原样）；`projection.audience := audience.principalId`——请求 `audience` 是 `PrincipalRef` 而 Core `projection.audience` 是 `NonEmptyString`，确定性编码只取 `principalId`（非空性由 PrincipalRef 形状保证），编码串仅写入 payload；与 Slice 的 Audience 匹配按 `PrincipalRef` 逐字段相等，**不按编码串**匹配。`requestedByWorkOrderRef := DRAFT canonical workOrderRef`；`builderPolicyRef := 同一 PolicyRef`。
5. **ProjectContext v1.0 必填字段的来源/合并矩阵**：选择**不新增 additive Core Contract 版本、不新增公开 operation**——Core `project-context/1.0` 已注册的固定字段结构足以承载初始链，每个必填字段按下表确定性产生；若实现期发现结构性缺口，回到 readiness 复核，不静默改写 Core Schema。唯一的 additive 注册是 **EP-owned objectType `zhiju.project.enterprise_fact`**（承载第 7 条 `subjectRef` 的规范化拼写，见 §19.9；非 Core、非 operation，Catalog 计数 215 不变）。输入权威是 **#188 已发布的 Source Slice payload**（`enterprise-project.schema.ts` 的 `contextSourceSlice`/`projectContextSourceSlice` 与 `source-slice-assembly.ts` 的真实输出形状），不是假设的新字段。

   | payload 字段 | 确定性来源/合并规则 |
   |---|---|
   | `contextSnapshotId` | `:= snapshotId`（独立生成，见 §19.2） |
   | `projectRef` / `enterpriseRef` | `:= DRAFT.scopeRef` 的 projectId/enterpriseId 对应 objectRef；objectType 拼写按 EnterpriseProject 该对象的不可变创建事实派生；每片 `source.projectRef` 必须与 `projectRef` 闭为同一身份（不等 → `EXECUTION_CONTEXT_SOURCE_INVALID`） |
   | `projection` | 见第 4 条 |
   | `asOf` | `:=` 组装提交点的受信当前时间（同事务） |
   | `sourceManifest.enterpriseProfileSnapshotRef` / `qmsConfigurationRef` | 全部 Slice 对应值逐项相等（任一不等 → `EXECUTION_CONTEXT_SOURCE_INVALID`），取公共值 |
   | `sourceManifest.policyRefs` | 每片 `capturePolicyRef` + 本构建 `builderPolicyRef` 的有序并集（canonical 字符串排序，exact 去重） |
   | `sourceManifest.schemaRefs` | Builder Policy 观测的 `policySchemaRefs` + DRAFT `DraftVersionPins.workOrderSchemaRef` 的有序并集 |
   | `sourceManifest.externalAuthoritySnapshotRefs` | 各片对应字段的有序并集（现行 EP Slice 无该字段 → 空集） |
   | `sourceManifest` 其余可选成员 | 本切片不设（成员缺省，不出现） |
   | `contextItems` | 见第 6 条 fact→ContextItem 映射 |
   | `artifactContext` | `:= []`（初始切片恒空：DRAFT `inputRefs` 的采纳/裁剪见第 9 条，artifact 绑定映射没有已批准的 slice 来源，禁止发明条目） |
   | `workContext.taskRef` / `workContext.workOrderRef` | `:= DRAFT.taskRef` / DRAFT canonical workOrderRef |
   | `workContext.deliveryItemRefs` | `:= []`：DeliveryItem target 的 owning 核验需要尚未交付的 EnterpriseProject additive Port 与独立授权（见第 9 条），本切片不支持解析 |
   | `workContext.informationRequestRefs` / `blockers` / `relatedCompletionCriteriaRefs` | `:=` 空集（INITIAL 不接受答案分支，§33） |
   | `unresolvedItems` | `:= []`（初始构建不产生未决项；`inputRefs` 的 required 缺失是 fail closed 输入错误，不落到未决项，见第 9 条） |
   | `omissions` / `redactions` | 见第 7 条映射（含 DRAFT `inputRefs` 裁剪产生的 omission） |
   | `coverage.requestedScopes` | `:=` 全部 Slice purpose 的有序并集 |
   | `coverage.includedScopes` | `:= { slice.purpose : 该片 omissions 不含 `PURPOSE_FORBIDDEN` }` 的有序集合 |
   | `coverage.excludedScopes` | `:=` 全部 Slice omissions `kind` 值的有序并集 |
   | `coverage.completeness` | 任一 Slice 存在 `PURPOSE_FORBIDDEN` omission → `PARTIAL`；否则 → `COMPLETE_FOR_PURPOSE`（前提：全部 required `inputRefs` 已采纳——required 缺失在第 9 条 fail closed，不产生本行可收割的省略；`KIND_NOT_REQUESTED` 是调用方经 `requestedKinds` 的主动选择，不构成缺口；依赖缺失/不可用已在入口拒绝，不产生 `BLOCKED` 快照） |
   | `sourceWatermarks` | 各片 `source.sourceWatermark` 的 exact 并集（非空 Slice 集保证非空） |
   | `expiresAt` | `:= effectiveExpiresAt`（§11.2.5.4/#168；无有限上界时该成员不出现） |

   **DRAFT provenance 的闭合**：`sourceManifest` 为 `additionalProperties:false` 固定结构、没有 DRAFT 位置，不得注入额外成员；DRAFT 绑定经 `projection.requestedByWorkOrderRef`、每个生成的 `contextItem.provenanceRefs`（含 `draftSnapshotRef`）、build metadata 与 `reference_edge` 闭合（§19.2/§19.6）。
6. **#188 Slice 成员去向矩阵**（每个已发布 Slice 成员的确定性去向；Core v1.0 无槽的成员走同事务不可变 metadata/edge 绑定，不静默丢弃）：

   | #188 Slice 成员 | 去向 |
   |---|---|
   | `sliceId` / `scopeRef` | 存在性与 Scope 核验（§19.4 第 2 条）；`slice_refs` metadata |
   | `purpose` / `audience` | purpose 匹配与 coverage；audience 按 PrincipalRef 逐字段匹配（编码串不参与，第 4 条） |
   | `capturePolicyRef` | `sourceManifest.policyRefs` 并集 + omission/redaction 映射的 `policyRef` |
   | `capturedAt` / `validUntil` | `recordedTime` 来源（第 7 条）与期限上界（§11.2.5.4） |
   | `source.projectRef` | 与 payload `projectRef` 身份闭包（上表） |
   | `source.enterpriseProfileSnapshotRef` / `source.qmsConfigurationRef` | `sourceManifest` 公共值（上表） |
   | `source.productScopeSnapshotRef` / `source.activeBaselineRefs` | Core v1.0 无对应槽：**payload 层**经该片每条的 `contextItem.provenanceRefs`（含该片 ContentAddressedRef，内容哈希绑定完整 slice payload）与 `sourceWatermarks` 绑定；**事实层**经 `context_snapshot_build.slice_refs` + `reference_edge`（Snapshot→Slice）同事务不可变记录，mirror guard 重算。完整成员可随时经 EP owning 读按 exact ref 读回。人类审查若认定 payload 层绑定不足，回退路径是 additive Core Contract 版本（readiness 复核），不在本 Delta 静默改写 Core |
   | `source.factItems[i]` | 第 7 条 fact→ContextItem 映射 |
   | `source.omissions[j]` / `source.redactions[j]` | 第 7 条 omission/redaction 映射 |
   | `source.sourceWatermark` | `sourceWatermarks` 并集（上表） |

7. **fact→ContextItem 映射**（输入为 #188 真实形状 `{factRef, factType, riskLevel, status, value}`；`value` 为已发布的 REDACTED `ValueEnvelope`，原样通过 Core value 校验）：

   - `kind := 'FACT'`（固定常量：Enterprise Fact 即事实）；`subjectRef :=` #188 已发布 `factRef` 的确定性机械规范化 VERSIONED ref——`{kind:'VERSIONED', objectType:'zhiju.project.enterprise_fact', objectId := factRef.objectId, versionId := factRef.versionId, scope := factRef.scope}`：`objectId`/`versionId`/`scope` 原样（即 EP `propose_enterprise_fact`/`confirm_enterprise_fact` 创建并发布的权威事实身份），仅 `objectType` 拼写按注册的 canonical objectType 规范化——本 Delta 设计 **additive 注册 EP-owned `zhiju.project.enterprise_fact`**（VERSIONED；Enterprise Scope；见 §19.9：不新增公开 operation、Catalog 计数 215 不变），这不是拼写发明而是已发布事实身份的规范化引用。不同 Fact 的 `subjectRef`（objectId/versionId 不同）在 ProjectContext payload 自身即可区分；Slice ref 只保留在 `provenanceRefs` 与 build metadata/`reference_edge`，不再充当 subject；`factType` 经片内容哈希 + provenanceRefs + metadata 绑定经 EP owning 读回读。TE 不对 Fact 做 owning 解析（存在性/生命周期由 EP capture 时已核验，片内容哈希再绑定）；拒绝把 provenance ref 填入 subject 或引用未注册拼写的任何替代方案。
   - `epistemicState :=` 固定映射表 `status {CONFIRMED→CONFIRMED, DISPUTED→DISPUTED, SUPERSEDED→SUPERSEDED, PROPOSED→INFERRED}`；表外值 → `EXECUTION_CONTEXT_SOURCE_INVALID`（#188 闭集 CHECK 已保证不外溢，映射表照常 fail closed）。
   - `sensitivity :=` 固定映射表 `riskLevel {LOW→INTERNAL, MEDIUM→CUSTOMER_CONFIDENTIAL, HIGH→RESTRICTED_PERSONAL, CRITICAL→REGULATED}`；`PUBLIC_AUTHORITY` 无 Enterprise Fact 来源（企业事实不低于 INTERNAL）。
   - `permittedUses := {request.purpose}`（单元素集合；与 `slice.purpose` 恒等，第 2 条硬规则保证不与 projection 自相矛盾）。
   - `evidenceRefs := []`（#188 输出不携带 evidence；Fact 的 `sourceRefs` 已按政策 redact，不得重建）。
   - `value := factItem.value` 原样；`recordedTime := slice.capturedAt`；`provenanceRefs :=` 该片 ContentAddressedRef + `draftSnapshotRef`（有序集合）。
   - `contextItemId :=` 确定性 **RFC 9562 UUIDv7**（Core `contextItemId` 只接受 uuidV7，Common Schema 与 shared-kernel 均声明该类型为 RFC 9562 v7）：bit 0–47 `unix_ts_ms` 取本构建 `asOf` 的受信 Unix 毫秒（与 payload `asOf` 同一 V0004 transaction-context 来源，§19.5——不用 caller 时钟，也不用 Slice/Fact 自身时间）；version nibble 固定 `7`；`rand_a`（12 bit）与 `rand_b`（62 bit）取 `SHA-256(canonical_cv1(factItem) ‖ slice snapshotId ‖ 片内序号)` 摘要的确定性位段；variant 固定 `[89ab]`。前 48 位是真实 Unix 毫秒时间戳，拒绝“任意 hash 字节置 version nibble”的伪 v7（其时间戳位是随机值，违反 RFC 9562 §5.7）。同一已提交构建内同一 factItem 重算必同 id；同键重放直接返回已提交结果、不重演（§19.8）；不同 factItem 由 hash 位段区分。
   - `contextItems` 按 (片序, 片内序) 稳定追加；缺成员或成员非法 → `EXECUTION_CONTEXT_SOURCE_INVALID`。
8. **omission/redaction 映射**（输入为 #188 真实形状）：`slice.source.omissions[j] = {kind, reasonCode}`（`kind` 为 SourceKind 闭集值，`reasonCode ∈ {KIND_NOT_REQUESTED, PURPOSE_FORBIDDEN}`）→ Core omission `{category := kind, reasonCode, effectOnTask := 固定常量 'see source slice for task effect', sourceRef := 该片 ContentAddressedRef}`；`slice.source.redactions[j] = {path, reasonCode}` → Core redaction `{fieldPath := path, policyRef := slice.capturePolicyRef, reasonCode}`。成员缺失/`reasonCode` 表外值 → `EXECUTION_CONTEXT_SOURCE_INVALID`；两者按 (片序, 片内序) 稳定追加。现行 #188 Slice 恒至少含一条 omission（未请求的 SourceKind），映射按上表正常纳入，不构成拒绝。
9. **DRAFT `inputRefs` / `targetScope` 支持集**（逐字段闭合，不静默丢弃、不静默省略）：
   - `inputRefs[i]` 是 Core `InputRef` 必填六元组 `{inputRole, ref, required, permittedUse, contentAccessMode, integrityRequired}`（+可选 `epistemicExpectation`）。排序用**覆盖全部字段的 total canonical comparator**：`(inputRole, canonical_cv1(ref), required, permittedUse, contentAccessMode, integrityRequired, epistemicExpectation)` 按 canonical 字符串字典序——其中 `canonical_cv1(ref)` 是完整 `TypedReference` 的 canonical_cv1 序列化（共享 canonicalization v1），天然覆盖全部五种 variant 的所有必填/可选字段（含 `ExternalRef` 的 `system`/`resourceType`/`externalId`/`observedAt`/`tenantOrAccountRef`/`payloadHash`/`adapterVersion`、普通 typed ref 的 `scope`、ContentAddressedRef 的可选 `immutableVersionId` 等），不逐字段枚举、不漏 variant；`canonical_cv1` 对可区分 ref 的序列化值构成全序，请求数组排列置换不改变排序结果与 metadata hash（置换不变）。**同 `(inputRole, canonical_cv1(ref))` 且其余字段有任何不同 → fail closed `EXECUTION_CONTEXT_SOURCE_INVALID`**（同键 metadata 冲突不做合并/择优/保序猜测，Core `get_work_order_draft` 侧可同时合法的同键异 metadata 输入在组装边界显式拒绝）；全部字段相同 → 去重。逐条处理：
     - **采纳**：`ref` 与某 `sourceSlices` exact ref 相等。核验：① `permittedUse` 逐字符等于 `request.purpose`（矛盾的授权用途 → `EXECUTION_CONTEXT_SOURCE_INVALID`）；② `contentAccessMode` 必须是 `REFERENCE_ONLY`（Slice 即引用内容；`INLINE_FRAGMENT`/`AUTHORIZED_FETCH` 没有已批准的获取路径 → 同码 fail closed）；③ `epistemicExpectation` 存在时必须逐值等于该片**全部** factItems 推导状态的聚合值：固定偏序取最不可信 `SUPERSEDED < UNKNOWN < INFERRED < DISPUTED < CONFIRMED`（多 fact 混合状态按 worst-case 聚合，不许由确定性次序首个或最可信项代表——Core §3.6：INFERRED/DISPUTED 不得以 CONFIRMED 语气物化），不等 → 同码 fail closed；**零 fact 片无可推导状态——`epistemicExpectation` 存在时同码 fail closed**（无法核验的期望不得默认满足），期望不存在时本项无核验；④ `integrityRequired` 恒满足（Slice 内容地址哈希已核验），经 build metadata 观察记录；`inputRole` 为标签，随 metadata 观察记录。核验通过 → 内容由该片 contextItems 代表，无额外 payload 条目。
     - **required=true 且未采纳**（未在 `sourceSlices` 或为不受支持的 kind）→ fail closed `EXECUTION_CONTEXT_INPUT_REQUIRED`：影响 Completion 的缺失不得静默省略（Core §3.10），不产出 omission/unresolved，也不允许以 `PARTIAL`/`COMPLETE_FOR_PURPOSE` 收场。
     - **required=false 且未采纳**：为 `zhiju.project.context_source_slice` ContentAddressedRef → omission `{category := 'DRAFT_INPUT_REF', reasonCode := 'NOT_CAPTURED_IN_SOURCE_SLICES', effectOnTask := 固定常量, sourceRef := draftSnapshotRef}`；其他 kind/objectType → omission `{category := 'DRAFT_INPUT_REF', reasonCode := 'KIND_NOT_SUPPORTED_IN_INITIAL_BUILD', effectOnTask := 固定常量, sourceRef := draftSnapshotRef}`。通用 inputRef 的存在性/生命周期解析没有已批准的 owning 读与授权路径，不做隐式解析。
   - `targetScope.targetObjectRefs` 支持集 `:= ∅`（本切片）：DeliveryItem target 的 owning 核验需要 EnterpriseProject additive Port（闭集键 + OBJECT 身份与生命周期证明 + 错误映射）与 IdentityPolicy 独立授权条目，二者均未交付（#202 已交付 Port 只覆盖 `create_task@1.0/@2.0` 的 VERSIONED Project/DeliveryItem 证明，不可直接复用）。因此：`workContext.deliveryItemRefs := []`；`targetObjectRefs` 非空 → fail closed `EXECUTION_CONTEXT_TARGET_INVALID`。恢复该支持路径须先交付 Spec 002 owning Port 增量与 Spec 001 授权条目增量（各自 readiness 复核），本 Delta 不做半成品接线。
   - `baseContentRefs`/`allowedUnitRefs`/`forbiddenUnitRefs`/`allowedCreateTypes`/`crossObjectReferencesAllowed`/`scopePolicyRef` 属执行期 Scope 约束（§18.6 创建期义务），初始 Context payload 无对应槽，**不进入 payload、不裁剪记录**；其核验留在创建期与后续 Validation/Freeze 边界（§11.2.2）。
10. **fixture 契约**：实现切片必须落地干净正反 fixture——正例（1×`@1.1` DRAFT + 2×由 #188 真实 `assembleProjectContextSourceSlice` 输出构成的 Slice：**同 `request.purpose`**、不同 `capturedAt`、各含现行 omission 与通配 redaction、至少一片含 ≥2 个 fact；DRAFT `inputRefs` 覆盖 required 采纳与 required=false 裁剪两种）产出 golden payload 并**先经真实 `ContractRegistry` 对完整 payload 执行 ProjectContext v1.0 校验**（不只逐字段比对，uuidV7/namespaceCode 等形状约束必须由 Registry 探针证明全过），再逐字段比对 audience 编码、status/riskLevel 固定映射表、确定性 UUIDv7 `contextItemId` 重算、manifest/coverage 并集（含 `PURPOSE_FORBIDDEN → PARTIAL` 分支）与 `sourceWatermarks` 合并；另断言：① 每个 `contextItemId` 解码首 48 bit == 本构建 `asOf` 的 Unix 毫秒（RFC 9562 时间戳来源）且重算稳定；② 不同 fact 的 `subjectRef`（objectId/versionId）与 `contextItemId` 从 ProjectContext payload 自身可区分；③ `inputRefs` 请求排列置换后 payload/metadata hash 不变（置换集必须含两个不同 `ExternalRef`——不同 `system`/`externalId`、其余 metadata 相同——与一对仅 `scope` 不同的普通 typed ref，证明 comparator 覆盖全部 variant 身份字段）。负例（空 `principalId`、`factItem` 缺成员或 status/riskLevel 表外值、manifest 公共值冲突、`source.projectRef` 与 payload 身份不闭合、omission `reasonCode` 表外、JSON null 冒充缺省、**slice purpose 替换、`required:true` 未采纳、`permittedUse`/`contentAccessMode`/`epistemicExpectation` 不符、`targetObjectRefs` 非空**、**两 fact 同 `subjectRef`、零 fact 片携带 `epistemicExpectation`、混合状态片期望 `CONFIRMED`、同 `(inputRole, canonical_cv1(ref))` 不同 metadata 的重复 `inputRef`**）逐个拒绝或按第 9 条矩阵产出确定性 omission。矩阵行 `TE-214-D-003`/`004`/`017`/`018` 按本契约扩展。
11. **输入证明的边界**：Schema 有效或内容寻址只证明形状/存在，不等于已授权、可用或适用；授权（§19.3）、可用性（第 2 条）与 profile 匹配（第 3 条）相互独立、全部核验。

### 19.5 期限（R-214-5）

§11.2.4/§11.2.5.4 已批准语义原样沿用，不合并、不改写：受信当前时间（V0004 transaction-context，非 caller 时钟）、请求上界原样观察（缺省与 JSON null 不等价）、不提供时取有限上界最小值、提供时超过任一有限上界拒绝而非静默截断、metadata 与 payload 镜像逐项一致（`EXPIRY_*` fail-closed 矩阵沿用）、提交点重验、不可变历史、重放不恢复当前资格。增量一条：Builder 在持有 WorkOrder 依赖行锁的提交点以受信当前时间重验 WorkOrder 期限与 effective 期限未越过；WorkOrder 已到期按 §11.2.4 第 4 条 `AGGREGATE_STATE_NOT_ALLOWED`，Context effective 越过按 §11.2.5.4 拒绝。

### 19.6 持久化与事务边界（R-214-6）

权威存储设计见 [PostgreSQL §33](../high-level-docs/07-postgresql-logical-model-v0.1.md) 的 #214 增量；此处固定行为边界：

1. **迁移**：未来 forward-only TaskExecution migration，编号在实现 Issue 分配（预期 `V3004` 之后）；不改 `V3000`–`V3003`。迁移验证覆盖空库、历史升级、二次 migrate no-op、角色 ACL/RLS 四类隔离、immutable/direct-SQL、原子回滚、CAS/并发、池复用与长事务期限（矩阵见 Module-Test 003 `TE-214-D-*`）。
2. **不可变 Snapshot**：`task_execution.context_snapshot` 按 §8.1/§8.2 不可变 Contract Record 模式；promoted 列（object_id、snapshot_id、purpose、audience、enterprise_id/project_id、builder_version `'1.1'`、policy_snapshot_id、source_manifest_count、context_item_count、omission_count、redaction_count、coverage_state、payload_hash 32B、canonicalization_version、可空 `expires_at`/`effective_expires_at` 镜像、source_command_id、created_at/created_by_principal_id）与 canonical payload 逐项一致，归属绑定受信 Context（V0004 完整 PrincipalRef 镜像）。
3. **build metadata**：`task_execution.context_snapshot_build` 本切片只写 INITIAL 成功行（闭集 CHECK；`draft_snapshot_ref` 非空、`frozen_contract_ref` 为 NULL，两者不得同时非空或同时为空）；Policy ref/hash/effective_from/superseded_at 与 projection、请求、DraftVersionPins 逐项一致；`request_expires_at`/`effective_expires_at` 按 §11.2.5.4/#168 组合；成功 metadata 与 Snapshot 同事务，失败不留 metadata 行（Receipt 以 REJECTED 同事务收尾）。
4. **guards 与边**：mirror guard（owner-only canonicalizer 重算 hash 与提升列）、creation-identity guard（`source_command_id` 指向仍为 `PENDING` 的 build@1.1 Receipt：command_version `'1.1'`、target type/id/Scope 相等、request hash 绑定，并把 DRAFT 身份与 `draft_schema_version` 闭为同一事实）、immutable guard、RLS FORCE + `context_allows_project`、最小模块角色、`reference_edge` 同事务（跨模块 TypedRef 无 FK/Join）。
5. **回滚**：任一失败（含注入故障、依赖不可用、并发裁决失败）整事务回滚，无部分 Snapshot/metadata/Receipt/Audit/Edge/Outbox 状态；同键重试干净重跑并恰好产出一份事实。

### 19.7 事件边界（R-214-7）

`execution.ContextSnapshotBuilt@1.0`（已注册）**足够，不新增事件或版本**。初始构建成功提交时恰好写一条 Outbox：payload `contextSnapshotRef` = 已提交 canonical ref 六字段逐字段；`workOrderRef` = DRAFT canonical workOrderRef；`projectionType`/`coverageStatus` 来自已提交 payload；aggregate 硬绑定 envelope target（CREATE 模式）与创建后版本，`source_command_id` 盖章。同键同输入重放不重跑 body，不产生重复 Outbox；崩溃后同键重试由 Receipt `ON CONFLICT DO NOTHING` claim 保证单一执行者。

### 19.8 并发、幂等与恢复（R-214-8）

1. **锁与重验**：Builder 对 WorkOrder Root 取只读依赖行锁（既定锁序 Task→WorkOrder→Run→Claim，不反序、不扩大），持有至 Context 事务结束；锁内重验 `status='DRAFT'` 且当前指针 `(snapshot_id, payload_hash)` 解析等于请求 `draftSnapshotRef`；并发 Freeze/合法 Draft 换代 → `EXECUTION_DRAFT_SNAPSHOT_STALE`/`AGGREGATE_STATE_NOT_ALLOWED`，无写入。
2. **跨模块边界**：Slice 与 Policy 观测只经 owning 边界现读现签（§19.3），不呈现为分布式事务或跨 schema 锁；依赖不可用 → `DEPENDENCY_UNAVAILABLE` fail closed，不留 PENDING Receipt。
3. **幂等**（沿用 #151/#212 runner）：同键同输入先重验当前授权、再返回原 committed 结果，不重组装、不重复 Snapshot/Event/Edge；同键异输入（含跨版本、跨 target）`IDEMPOTENCY_PAYLOAD_CONFLICT` + DENIED Audit；同 target 异键由 CREATE 目标唯一约束裁决；in-flight → `COMMAND_IN_PROGRESS`。
4. **故障**：注入故障与响应丢失整事务回滚（§19.6 第 5 条）；过期/失效输入（Slice、Policy、Decision、期限）全部确定性 fail closed，稳定错误码按 §11.2.2/§11.2.5.2/§11.2.5.4 既有矩阵归类；增量码只有三个——`EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH`（§19.1）、`EXECUTION_CONTEXT_TARGET_INVALID` 与 `EXECUTION_CONTEXT_INPUT_REQUIRED`（§19.4 第 9 条），实现时随错误码表登记。

### 19.9 交付边界

- 本设计 revision 只改 durable 设计文档：当时未实现、未分配 migration、未创建授权 Port；其后由 §19.10 的 [Issue #216](https://github.com/qzhike/zhiju-business-core/issues/216) 按设计实现（`V3004`、IdentityPolicy §15.8 授权 Port、确定性组装与 build/read Handler、组成层入口）。Catalog 215、TaskExecution 45、历史 200 项 Baseline、两个 build 版本的注册 Schema/元数据与 §11/§18 全部既有事实不变。
- **唯一的 additive 注册**：EP-owned canonical objectType `zhiju.project.enterprise_fact`（VERSIONED；Enterprise Scope；既有 Enterprise Fact 版本身份，`project.propose_enterprise_fact@1.0`/`project.confirm_enterprise_fact@1.0` 创建），供 §19.4 第 7 条 `subjectRef` 的确定性规范化引用。注册设计行见 HL-Doc 06 的 #214 段；executable 交付已由 #216 落地（contracts 注册增量、构建期注册断言与 Spec 002 owning 指针同步；裸 objectType 注册无 operation/Schema 生成物）。不新增公开 operation、不改写既有 `EnterpriseFact` legacy 拼写的既有接受集合，Catalog/Baseline 计数不变。
- exact design revision `d0d060fbacb98a6e9fdac1d098792a6222de4cff` 的显式人类设计批准已于 2026-09-18 记录（[`reviews/pr-215/Review.md`](../reviews/pr-215/Review.md)）；#216 的实现范围即本节、Spec 001 §15.8、HL-Doc 06 #214 注册行、PostgreSQL §33 #214 增量与 Module-Test 003 `TE-214-D-*` 矩阵，未超出该范围。
- 独立设计审查记录存 [`reviews/pr-215/Review.md`](../reviews/pr-215/Review.md)；实现的 `vibe verify full --json` 已 PASS（2026-09-19，见 §19.10）；独立审查、人类技术批准与 PR 待完成（正式记录将存 `.vibe/reviews/pr-<number>/Review.md`）。TD-05–07 的待批准状态不因本节或 #216 改变。首次 Context 构建与权威快照读取的本地/单元/持久化证据已补齐（§19.10），Context→Validation→Freeze 完整业务链、执行、Completion 与 IM-06 完成状态仍为 `NOT RUN`。

### 19.10 实现事实与验证边界（#216，2026-09-19）

状态：`IMPLEMENTED 2026-09-19 BY Issue #216（按 exact design revision `d0d060fbacb98a6e9fdac1d098792a6222de4cff`）/ TE-214-D-001–018 EXECUTED ON REAL PostgreSQL 18.6（tests/persistence/initial-context.test.ts；persistence 目录 42 passed | 2 skipped files、463 passed | 26 skipped / 489 tests）/ vibe verify full PASS 2026-09-19（完整阶段计数与镜像 pin 漂移处理见下）/ PR #217 INDEPENDENT IMPLEMENTATION REVIEW `PLANNING_REQUIRED` ON `bce56af9007e70ee79e46bcc90d49dd0fc5b35f5` / HUMAN TECHNICAL REVIEW NOT REACHED`。[Issue #216](https://github.com/qzhike/zhiju-business-core/issues/216) 按 §19 的已批准设计交付本切片；本节只记录历史实现事实、必须的可核验点与仍然 `NOT RUN` 的边界。PR #217 的四项阻断与待批准修正见 §20；在修正实现与 `TE-217-D-*` 证据完成前，本节不得作为合并或验收依据。

- **注册与生成物**：EP-owned objectType `zhiju.project.enterprise_fact`（owner `enterprise-project`、VERSIONED）已注册于 `contracts/src/operation-registration.ts`，构建期断言 `assertInitialContextEnterpriseFactRegistration()` 接入 `contracts/src/registry.ts` 的 `ContractRegistry` 构造与 `tools/contracts/generate-public-api.mjs`，回归测试 `contracts/src/enterprise-fact-registration.test.ts`。无新增/改写公开 operation、Event、Schema、metadata 或 Baseline：Catalog 215、TaskExecution 45、历史 200 项 Compatibility Baseline 不变；裸 objectType 注册无 operation/Schema 生成物。
- **IdentityPolicy Port（Spec 001 §15.8）**：`modules/identity-policy/src/commands/context-snapshot-authorization.ts` 交付 Port 工厂 `createTaskExecutionContextSnapshotAuthorizationPort` 与闭集键表 `TASK_EXECUTION_CONTEXT_SNAPSHOT_BINDINGS`。两条条目全字段：`build_initial_context_snapshot@1.1`（Purpose `execution.context.build.initial`、action `execution.context.build.initial.v1_1`、`CREATE_TARGET_TYPE` 闭集 `{zhiju.execution.context_snapshot}`、config key `contextSnapshotBuildV11`）与 `get_context_snapshot@1.0`（Purpose 逐字符复用已发布值 `task.execution.get_context_snapshot`、内部 action `execution.context.snapshot.read`、`TARGET_TYPE` 闭集 `{zhiju.execution.context_snapshot, zhiju.project.context_snapshot}`、config key `contextSnapshotRead`）；`build_initial_context_snapshot@1.0` 无 binding，任何 @1.0 构建尝试 fail closed。错误三联 `IDENTITY_CONTEXT_SNAPSHOT_AUTHORIZATION_UNSUPPORTED`/`IDENTITY_CONTEXT_SNAPSHOT_CAPABILITY_CONFIG_INVALID`/`IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID`；拒绝路径只写同事务脱敏 `DENIED` Audit，不签发 Decision。无公开 Command/Query、capability code、Catalog 条目、registry/metadata 变更或 IdentityPolicy 迁移（复用 V1006 的既有 target 列）；单元测试 38 项、IdentityPolicy 模块 178/178 通过。
- **持久化（V3004）**：`migrations/task_execution/V3004__context_snapshot.sql` 交付两张不可变表（Context Snapshot 与 Build Metadata；INITIAL-only：`draft_snapshot_ref` 非空、`frozen_contract_ref` NULL 闭集）；mirror guard（owner-only canonicalizer 重算，22023）、creation-identity guard（PENDING build@1.1 Receipt 绑定、`draft_schema_version='1.1'` 的 canonical 拼写、build↔snapshot 成对）、immutable guard（23514）；FORCE RLS + `context_allows_project`、INSERT WITH CHECK 绑定 `context_principal_id()`、app 角色 `REVOKE UPDATE, DELETE`；`policy_snapshot_id := canonical_payload.projection.builderPolicyRef.versionId`（payload 内唯一可镜像的 Policy 身份；完整观察由 build metadata 的 `builder_policy_ref`/`policy_content_hash`/`effective_from`/`superseded_at` 与 Snapshot→Policy `reference_edge` 承载）。scratch 库应用 `V0001`–`V0004` + `V3000`→`V3004` 并完成正/负探针；两表注册进 `tests/persistence/technical-tables.test.ts`；`V3000`–`V3003` 逐字节不变。
- **Handler、组装与组成层**：`modules/task-execution/src/business/initial-context-assembly.ts`（纯 §19.4，确定性 RFC 9562 UUIDv7，golden payload 先经真实 `ContractRegistry.validateCoreContract('https://schemas.zhiju.local/core/project-context/1.0', …)` 全过）；`initial-context-build.ts`（`handleBuildInitialContext`，错误码 `EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH`/`EXECUTION_DRAFT_SNAPSHOT_STALE`，幂等 scope `buildInitialContextIdempotencyScope`，并发 UNIQUE 冲突归一化为 `CONCURRENCY_CONFLICT`）；`context-snapshot-read.ts`（legacy 拼写直接 `REFERENCE_INVALID` 不查找）；`persistence/context-snapshot-repository.ts`（新增 `readWorkOrderDraftSnapshotByIdentity`/`readWorkOrderRootForShare`）；command runner 注册 `insertContextSnapshot`/`insertContextSnapshotBuild`，`task-execution-db.ts` 注册两表；组成层 `createInitialContextEntry`（`apps/api` entry）暴露 `{build, read}`，build@1.0 因无 binding 在任何 Decision/Receipt/事实之前 fail closed `API_CONTRACT_TYPE_UNKNOWN`（TE-P210-020 先例）；Slice/Policy 依赖读各现签 Decision（`project.get_context_source_slice@1.0`/`identity.resolve_policy@1.0`）。**层界**：精确 DRAFT 读由 owning Handler 在自己 owning 事务内经自有 repository 执行——build payload 只携带 `draftSnapshotRef`（snapshot id 而非 WorkOrder 身份），组成层无法为该读命名授权 target，`workOrderDraftReadV11` 授权挂在调用方取得 ref 的 `execution.get_work_order_draft` 入口。
- **证据计数**：TaskExecution 业务单测 89/89（assembly 41、build 21、read 15、既有 12）；IdentityPolicy Port 38（模块 178/178）；组成层 15；`TE-214-D-001`–`018` 全部执行 = `PASS`（逐行结果与四处偏差标注见 [Module-Test 003](../module-tests/Module-Test-003-TaskExecution.md)）。
- **完整门禁（`vibe verify full --json`，2026-09-19，最终工作区状态）**：`{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。单元/契约阶段 68 passed | 40 skipped files（108）、1205 passed | 474 skipped tests（1679）；architecture_boundaries=PASS（source_roots=10）；public_api_generation=PASS（operations=215、policy_profiles=7、evaluator_profiles=2、creation_purposes=4）；typescript_types=PASS（payloads=215、results=56、core_contracts=6）；catalog_registry=PASS（catalog=215、registry=215、schema_status FULL=215）；compatibility=PASS（baseline v1.0：operations=200、schemas=14、envelopes=200、minor=80、findings=80）。持久化门禁（Docker，pinned `postgres:18.6` + Flyway 11.20.3）44/44 files、489/489 tests：空库 Flyway migrate 应用全部迁移至 V6004（含 `V3004 context snapshot`），历史 V6003/V6004 升级路径执行，第二次 migrate no-op（"Schema public is up to date"），容器已拆除。镜像 pin 漂移：Docker Hub `postgres:18.6` tag 从仓内 pin `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` 漂移至 `sha256:86c951e05bf56c93d95d397747fb8820ac76cc3bedb78f43abd83eedbe3666ae`；按 HL-Spec 漂移程序刷新 `tools/persistence/baseline.mjs` 的 pin（Flyway pin 不变）后完整门禁通过。
- **关键解释决定**：① header `contractId`/`contextSnapshotId` = snapshotId、`payloadHash` 占位 64 个 `0`（V3004 对含 header 的完整 payload 重算，自哈希不可能）；② read result `contractRef` 推导 `{CONTENT_ADDRESSED, zhiju.contract.project_context, objectId: snapshotId, scope, contentHash: 已存 payload hash}`；③ `contextItemId` rand 位 = `SHA-256(canonical_cv1(factItem) ‖ sliceRef.objectId ‖ 十进制片内序号)`（UTF-8 无分隔）；④ Slice 排序键 = exact ref 的 canonical-cv1 字符串（(objectType, objectId, snapshotId) 元组坍缩其中）；⑤ `factRef.objectType` 闭为 EP 唯一发布拼写 `EnterpriseFact`，装配归一化为常量 `zhiju.project.enterprise_fact`；⑥ 并发 UNIQUE 冲突 → `CONCURRENCY_CONFLICT`（readiness 先例）。
- **观察到的矩阵偏差（均非生产缺陷）**：① 003 错哈希切片 ref：EP owning read 报 `PROJECT_QUERY_REF_INVALID`、入口重抛、Handler 映射 thrown `DEPENDENCY_UNAVAILABLE`（矩阵预期 rejected `EXECUTION_CONTEXT_SOURCE_INVALID`；错 id/Scope/kind 保持原码）；② 008/015 过期 Decision 分层：真实时钟已过期先被 `establish_transaction_context`（22023）拒绝、表面 thrown `DEPENDENCY_UNAVAILABLE`，`AUTHORIZATION_EXPIRED` 仅在受信时钟越过 TTL 时可达（套件以此执行）；③ 018 跨 Scope targetObjectRef：创建层先 `EXECUTION_WORK_ORDER_SCOPE_INVALID`，构建层码经入口不可达，改单元层在真实提交事实上断言；④ 016 基线事实修正：v1.0 Baseline（200 条）本已含 `execution.get_context_snapshot`（及 legacy `execution.build_context_snapshot`），仅 `execution.build_initial_context_snapshot` 为新增。
- **已知后续项**：`execution.ContextSnapshotBuilt@1.0` 注册 Schema 把 `projectionType`/`coverageStatus` 定为 `namespaceCode`（lowercase pattern），§19.7/§11.2.5.3 要求逐字写入 uppercase enum（`DOCUMENT_WRITER`/`COMPLETE_FOR_PURPOSE`）；运行时 Outbox 不对照注册 Schema 校验 payload，Handler 按 §19.7 逐字写入；需后续契约修正 follow-up（本切片按 §19 禁止契约改动）。
- **未运行边界**：五个 `NOT RUN` 子分支——002 提交点过期复检（`work_order.expires_at` 恒等于绑定快照 `expiresAt`，期限绑定先一步触发且列不可变 23514）、002 指针已前进（V3003 双向闭包 22023/23514）、004 Builder Policy 哈希不符（owning `identity.resolve_policy@1.0` 从不可变版本行重算，无合法事实生产者，42501 闭包）、008 grant Policy Snapshot 被取代（无 `superseded_at` 写入者，Port 单测覆盖）、010 Builder×Freeze/状态迁移竞争（无算子）；013 的空库应用/历史升级/二次 no-op 属持久化门禁自身证据（tools/persistence），不作为 NOT RUN 子分支。WorkOrder 校验/冻结/READY/queue、Run/Attempt/AgentResult、InformationRequest 与 retry、Completion、Query/Projection（TD-05–07）、受控退出 Fixture、Context→Validation→Freeze 完整业务链、外部 Provider/Runtime/飞书、公开 HTTP、生产、负载/性能与独立人工业务验收仍 `NOT RUN`；本切片的通过不得报告为 Validation/Freeze、执行、Completion 或 IM-06 完成。

## 20. PR #217 首次 Context 实现审查修正 Delta（提案）

状态：`T2 / PROPOSED 2026-09-19 / PR #217 INDEPENDENT REVIEW = PLANNING_REQUIRED ON bce56af9007e70ee79e46bcc90d49dd0fc5b35f5 / EXPLICIT HUMAN DESIGN APPROVAL RECORDED 2026-09-19 / PENDING INDEPENDENT DESIGN REVIEW / IMPLEMENTATION NOT UPDATED / ALL TE-217-D-* NOT RUN`。本节响应 [`reviews/pr-217/Review.md`](../reviews/pr-217/Review.md) 的四项阻断。它保留 §19 与 #216 的历史实现证据，不把已执行测试改写成未发生；在推送后的 exact revision 通过独立设计复审后，本节将对 §19.2、§19.3、§19.4 第 1/7 条、§19.6、§19.7 及 §19.10 中冲突的前向语义构成精确 supersession。独立设计复审完成前 PR #217 保持 `NOT_READY`，不得把本文提案当作已实现事实。

### 20.1 Legacy Snapshot exact read-back

`execution.get_context_snapshot@1.0` 的已发布请求/结果 Schema 保持不变；canonical `zhiju.execution.context_snapshot` 与 legacy `zhiju.project.context_snapshot` 仍是两个不同身份，不做 alias、大小写回退或仅按 id 互换。修正后的 owning read 必须按请求 objectType 路由到两个互不替代的 owning store：

1. canonical ref 只查 `task_execution.context_snapshot`；
2. legacy ref 只查 PostgreSQL §35 定义的只读兼容事实 `task_execution.context_snapshot_legacy`；
3. 两条路径都按 objectId、snapshotId、Project Scope、完整 contentHash 与 cv1 payload 重算逐字段闭合，结果 `contextSnapshotRef` 原样等于请求；
4. 任一 store 无行、Hash/Scope/identity/content mirror 不一致均为 `REFERENCE_INVALID`，不得转查另一 store；
5. legacy store 没有应用写入者，只接收受控 migration/import manifest 已证明的历史 ProjectContext v1.0 事实。空 store 可以返回 not-found，但 Handler 不得因 objectType 为 legacy 而在查询前固定拒绝。

必须增加真实 PostgreSQL 正例：以 migration-owner 受控 fixture 导入一条 legacy committed fact，经 legacy selector 的当前授权读取成功；相同 objectId/hash 换 canonical spelling 必须失败，反向替换亦失败。

### 20.2 DRAFT 依赖读取的独立当前授权

§19.3“复用 `workOrderDraftReadV11`”的文字不可执行，因为 build payload 只携带 exact `draftSnapshotRef`，而该公开 Query 的授权 target 是 WorkOrder。修正为 Spec 001 §15.9 的专用 owning 内部 Port：

- 输入 target 是请求已经携带的完整 `zhiju.execution.work_order_draft_snapshot` ContentAddressedRef；组成层可在读取任何 TaskExecution DRAFT 行之前命名它；
- build Decision 与 DRAFT dependency-read Decision 是两个不同 Decision。后者使用独立 action/config，必须覆盖完整 target ref、Project Scope、principal、authentication context、请求 payload hash、ALLOW、期限及当前 Grant/Policy；
- 签发和重验完成后才允许进入 TaskExecution repository 读取；随后 Handler 仍须在自己的事务内核验 ref→Snapshot→WorkOrder Root→当前指针与 DRAFT 状态，并持 `FOR SHARE` 锁至提交；
- 调用方过去通过 `get_work_order_draft` 取得 ref 不是当前授权证据。DRAFT-read Grant 缺失、撤销、过期、target/hash/Scope 替换或配置漂移必须在任何 DRAFT fact 读取、幂等 Claim 与历史 Receipt 返回之前 fail closed；
- Slice 与 Policy 各自的现签 Decision 保持不变，任一依赖授权不隐含其他依赖能力。

本项不修改公开 build payload、不新增公开 operation，也不把 build capability 扩大为 DRAFT-read capability；它新增一个受信内部 capability config key 与授权条目，详见 Spec 001 §15.9。

### 20.3 注册 Event 的 additive 修正

冻结 `execution.ContextSnapshotBuilt@1.0` 及其 `NamespaceCode` 字段接受集，不原地改写历史 Schema。新增 additive `execution.ContextSnapshotBuilt@1.1`，供修正后的 initial build 成功路径独占使用：

| 字段 | `@1.1` Schema | 来源 |
|---|---|---|
| `contextSnapshotRef` | `SnapshotRef<ProjectContext>` | 已提交 canonical Snapshot ref，六字段逐项相等 |
| `workOrderRef` | `ObjectRef<WorkOrder>` | 精确 DRAFT fact 的不可变创建拼写 |
| `projectionType` | Common `ProjectionType` enum | 已提交 ProjectContext `projection.projectionType` |
| `coverageStatus` | Common `CoverageCompleteness` enum | 已提交 ProjectContext `coverage.completeness` |

payload `additionalProperties:false`，不得写入 `enterpriseId`/`projectId`；事件 Scope 只来自 Event envelope 的 `scopeRef`。成功事务必须先把完整 Event envelope 交给真实 `ContractRegistry` 验证，再写一条 `@1.1` Outbox；失败、冲突与同键重放写 0 条。`@1.0` 保留注册兼容但本修正路径不再发布。Catalog/Registry 215→216、TaskExecution 45→46，历史 200 项 Compatibility Baseline 不变，详见 Catalog 06 的 #217 Delta。

### 20.4 Source Slice total order

§19.4 第 1 条中的 `(objectType, objectId, snapshotId)` 不适用于 `CONTENT_ADDRESSED` Source Slice ref（该 variant 没有 snapshotId），其冲突文字被下列可执行全序取代：

`(objectType, objectId, immutableVersionId-or-empty, contentHash.algorithm, contentHash.canonicalizationVersion, contentHash.digest, canonical_cv1(scope))`

各字符串按 canonical UTF-8 byte order 比较；`objectType`、`objectId` 必须先于 Hash 决定顺序，完整 `canonical_cv1(ref)` 只在上述 tuple 全等时用于 exact-ref 一致性断言，不得作为首要 comparator。tuple 与完整 ref 都相等视为重复，拒绝 `EXECUTION_CONTEXT_SOURCE_INVALID`；tuple 相等而完整 ref 不等同样拒绝，禁止实现者发明未排序成员的择优规则。`contextItems`、metadata `sliceRefs`、reference-edge index 与所有相关 Hash 统一使用该顺序。

第 7 条 UUIDv7 的摘要输入同步闭合为 `SHA-256(canonical_cv1(factItem) ‖ sliceRef.objectId ‖ 十进制片内序号)`；不再使用不存在的“slice snapshotId”措辞。

### 20.5 分类、实施范围与 Gate

- 分类保持 `T2`：跨 TaskExecution、IdentityPolicy、Contracts/Catalog 与 PostgreSQL，但不改变 Product Scope 或 Core ProjectContext v1.0。
- 预期实现范围：修正 PR #217 内的组成层/Handler/Repository/V3004/测试；新增 Event `@1.1` Schema/Registry/metadata/generated types/fixtures；新增 Spec 001 §15.9 内部授权 Port。不得顺带实现 Validation/Freeze、Run 或其他 IM-06 行为。
- 本 Delta 已于 2026-09-19 获得显式人类设计批准及本轮文档 commit/push 授权；推送后的 exact revision 仍须通过独立设计审查，之后才可继续修复 PR #217。该批准不授权产品代码修复、merge 或部署。
- 修订后的 exact head 必须执行 Module-Test 003 `TE-217-D-001`–`004`、既有 `TE-214-D-*` 回归和 `vibe verify full --json`。人类技术审查只在无剩余 agent-fixable finding 后进行。
