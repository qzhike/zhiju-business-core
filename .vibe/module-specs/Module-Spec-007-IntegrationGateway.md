# Module-Spec-007-IntegrationGateway

版本：v0.2
日期：2026-09-01
状态：`CURRENT MODULE CONTRACT BASELINE / WI-01 ADDITIVE BINDING QUERY CONTRACT LANDED 2026-08-28 / FEISHU OPTIONAL MINOR ACCEPTED / RUNTIME USER PROGRESSION CONFIRMED / FIELD-LEVEL PAYLOAD/EVENT/RESULT SCHEMAS LANDED 2026-08-18 / ISSUE #17 RUNTIME SLICE LANDED 2026-08-22 / IM-05 WI-05 IMPLEMENTATION AND GIT DELIVERY COMPLETE 2026-08-30 / PR #135 MERGED / ISSUE #125 CLOSED / ISSUE #24 FORMAL ADAPTER ATTEMPT QUERY PORT LOCAL TECHNICAL VERIFICATION PASS / ISSUE #24 OPEN / PR NOT YET CREATED / REAL EXTERNAL PROVIDER NOT RUN`

## 1. 模块责任

本节是 API 字段路由摘要，不重新维护模块职责、非职责、依赖或 Schema 所有权；如有差异，以 `02-zhiju-core-architecture.md` 第 20 节为准。

IntegrationGateway 是 InboundEnvelope、ChannelBinding、Channel/Runtime/Render Attempt、RawExternalReceipt、Quarantine 和 AdapterHealth Observation 的唯一写入 Owner。它是飞书、Runtime、Renderer 与 Core 之间的 Anti-Corruption Layer，只记录外部协议事实与尝试，不拥有 Project/Task/Artifact/Quality/Release 规则或任何业务完成语义。

本模块位于同步依赖最外层，可调用业务模块公开 Application Port；业务 Domain 不依赖本模块 SDK/DTO，只通过 Port/Event 协作。API 测试规格见 [`Module-Test-007-IntegrationGateway.md`](../module-tests/Module-Test-007-IntegrationGateway.md)。飞书原始协议字段、幂等键、Binding、消息/文件/卡片、投递回执和安全映射由 [`Feishu-Channel-Contract-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md) 专项维护；Runtime 原始协议、Execution Package、本地 CLI Process Driver、标准事件、Result/Usage、Resume/Retry 和 CLI Profile 由 [`Runtime-Adapter-Contract-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md) 专项维护。两个专项均不得改变本模块或其他模块的业务所有权。

## 2. 模块类型

```text
AttemptStatus = Closed<CREATED | DISPATCHABLE | CLAIMED | IN_FLIGHT | SUCCEEDED | FAILED | UNKNOWN | CANCELLED | QUARANTINED>
InboundStatus = Closed<ACCEPTED | REJECTED | QUARANTINED>
AdapterKind = Closed<FEISHU_CHANNEL | RUNTIME | RENDERER | OBJECT_STORAGE | EXTERNAL_AUTHORITY>

InboundEnvelopeSubmission
├── adapterCode: NamespaceCode
├── adapterVersion: NonEmptyString
├── accountExternalRef: ExternalRef
├── externalEventRef: ExternalRef
├── externalEventType: NonEmptyString
├── occurredAt?: UtcInstant
├── receivedAt: UtcInstant
├── authenticationMetadataRef: ContentAddressedRef<AuthenticationMetadata>
├── payloadRef: ObjectLocator
├── payloadHash: PayloadHash
├── dataClassification: NamespaceCode
└── transportMetadata: CanonicalJson

ChannelBindingDefinition
├── adapterCode: NamespaceCode
├── accountExternalRef: ExternalRef
├── channelExternalRef: ExternalRef
├── threadOrTopicExternalRef?: ExternalRef
├── projectRef: ObjectRef<Project>
├── enterpriseRef: ObjectRef<Enterprise>
├── businessContextRefs?: Set<TypedReference>
├── runtimeContextExternalRef?: ExternalRef
├── purpose: NamespaceCode
├── bindingPolicyRef: VersionedRef<Policy>
└── effectivePeriod: EffectivePeriod

FeishuDeliveryRequest
├── sourceBusinessRef: TypedReference
├── destinationBindingRef: ObjectRef<ChannelBinding>
├── deliveryMode?: Closed<NEW_MESSAGE | REPLY | REPLY_IN_THREAD>
├── replyToExternalRef?: ExternalRef
├── recipientRefs: Set<ExternalRef>
├── contentContractRef: ContentAddressedRef<ChannelContent>
├── attachmentRefs: RepresentationRef[]
├── interactionContractRef?: ContentAddressedRef<InteractionContract>
├── stableIdempotencyKey: NonEmptyString
├── requestedAt: UtcInstant
└── deliveryPolicyRef: VersionedRef<Policy>

RuntimeDispatchRequest
├── workOrderRef: ObjectRef<WorkOrder>
├── runRef: ObjectRef<Run>
├── workOrderContractRef: ContentAddressedRef<WorkOrderContract>
├── contextSnapshotRef: SnapshotRef<ProjectContext>
├── capabilityGrantRef: ContentAddressedRef<CapabilityGrantBundle>
├── runtimeBinding: CanonicalJson
├── stableIdempotencyKey: NonEmptyString
└── requestedAt: UtcInstant

RuntimeControlRequest
├── runRef: ObjectRef<Run>
├── runtimeAttemptRef: ObjectRef<RuntimeAttempt>
├── continuationRef?: ExternalRef
├── reasonCode: ReasonCode
├── stableIdempotencyKey: NonEmptyString
└── requestedAt: UtcInstant

RenderRequest
├── revisionRef: ContentAddressedRef<ArtifactRevision>
├── canonicalContentRef: ObjectLocator
├── inputHash: ContentHash
├── outputFormat: NamespaceCode
├── rendererId: NamespaceCode
├── rendererVersion: NonEmptyString
├── renderPolicyRef: VersionedRef<Policy>
├── stableIdempotencyKey: NonEmptyString
└── requestedAt: UtcInstant

RawReceiptSubmission
├── attemptKind: AdapterKind
├── attemptRef: ObjectRef<AdapterAttempt>
├── providerReceiptRef: ExternalRef
├── receiptPayloadRef: ObjectLocator
├── receiptPayloadHash: PayloadHash
├── observedOutcome: Closed<SUCCEEDED | FAILED | UNKNOWN>
├── occurredAt?: UtcInstant
└── recordedAt: UtcInstant

QuarantineDefinition
├── inboundEnvelopeRef?: ContentAddressedRef<InboundEnvelope>
├── attemptRef?: ObjectRef<AdapterAttempt>
├── conflictRefs: TypedReference[]
├── reasonCode: ReasonCode
├── observedHashes: NonEmptySet<PayloadHash>
├── safeDiagnostic: SafeSummary
└── quarantinedAt: UtcInstant
```

`businessContextRefs`、`runtimeContextExternalRef`、`deliveryMode` 和 `replyToExternalRef` 是 Feishu Channel v0.1 提出的向后兼容 optional minor 字段，已随用户 2026-08-16 推进确认纳入 API v0.1 基准：

- `businessContextRefs` 只允许同一 Project 下的 Task、WorkOrder、InformationRequest、ApprovalRequest 或 Release 等已注册 Typed Reference；不得放入飞书消息、Runtime Session 或 workspace path；
- `runtimeContextExternalRef` 只用于可观测路由，永远不参与身份、权限或业务对象相等性；
- `deliveryMode` 缺省为 `NEW_MESSAGE`；`REPLY/REPLY_IN_THREAD` 必须同时给出属于同一 Binding 的 `replyToExternalRef`；
- 这些字段 absent 时保持旧 Consumer 语义，属于向后兼容 Minor；不得借此扩大身份或权限。

`externalEventRef` 表示 Provider 的语义幂等标识，不保证等于传输事件头 ID。飞书 `im.message.receive_v1` 必须使用 `app + tenant + message_id`；其他当前允许的飞书事件使用 `app + tenant + header.event_id`。Provider 原始投递 ID 仍保存在认证/传输元数据中用于审计。

## 3. Command Payload Contract

| Contract | Target / mode | Payload | Authorization purpose / 主要约束 |
|---|---|---|---|
| `integration.accept_inbound_envelope@1.0` | `InboundEnvelope / CREATE` | `submission: InboundEnvelopeSubmission` | `integration.inbound.accept`；先认证/Hash/唯一 Claim；same external event + same Hash 幂等，不调用业务 Repository |
| `integration.bind_channel_context@1.0` | `ChannelBinding / CREATE` | `definition: ChannelBindingDefinition; bindingDecisionRef: ContentAddressedRef<BusinessDecision>` | `integration.channel.bind`；`HUMAN_ONLY` 或执行精确 Human Decision；Binding 不授予群成员权限 |
| `integration.request_feishu_delivery@1.0` | `ChannelDeliveryAttempt / CREATE` | `request: FeishuDeliveryRequest` | `integration.feishu.delivery.request`；先提交 Attempt 后调用外部；普通发送不得冒充 Release |
| `integration.request_runtime_dispatch@1.0` | `RuntimeAttempt / CREATE` | `request: RuntimeDispatchRequest` | `integration.runtime.dispatch.request`；Session 是 ExternalRef，不是 Run ID；不持有长期 Human 权限 |
| `integration.request_runtime_cancel@1.0` | `RuntimeControlAttempt / CREATE` | `request: RuntimeControlRequest`，`continuationRef` optional | `integration.runtime.cancel.request`；只执行 Core 已提交 cancel intent；超时 UNKNOWN |
| `integration.request_runtime_resume@1.0` | `RuntimeControlAttempt / CREATE` | `request: RuntimeControlRequest`，`continuationRef` required | `integration.runtime.resume.request`；只允许同 Run 安全 SUSPENDED；terminal/final BLOCKED_INPUT 不能 resume |
| `integration.request_render@1.0` | `RenderAttempt / CREATE` | `request: RenderRequest` | `integration.render.request`；输入 Hash/Renderer Version 固定；成功后仍需 Artifact 登记 Representation |
| `integration.record_external_receipt@1.0` | `RawExternalReceipt / CREATE` | `receipt: RawReceiptSubmission` | `integration.external_receipt.record`；只记录 Adapter 观察；不直接满足 Release/Task/Run Completion |
| `integration.quarantine_external_event@1.0` | `QuarantineRecord / CREATE` | `definition: QuarantineDefinition` | `integration.external.quarantine`；Hash 冲突/未知 Major/认证异常；不得覆盖首个 Envelope |

## 4. Query Payload 与 Result Contract

```text
ChannelBindingView
├── channelBindingRef: ObjectRef<ChannelBinding>
├── aggregateVersion: NonNegativeInt
├── definition: ChannelBindingDefinition
├── status: NamespaceCode
└── resolvedPurpose: NamespaceCode

AdapterAttemptView
├── attemptRef: ObjectRef<AdapterAttempt>
├── adapterKind: AdapterKind
├── status: AttemptStatus
├── stableIdempotencyKeyHash: ContentHash
├── requestPayloadHash: PayloadHash
├── leaseExpiresAt?: UtcInstant
├── rawReceiptRef?: ContentAddressedRef<RawExternalReceipt>
├── externalRef?: ExternalRef
├── errorCode?: ReasonCode
└── updatedAt: UtcInstant

AdapterHealthView
├── adapterCode: NamespaceCode
├── adapterVersion: NonEmptyString
├── observedStatus: Closed<HEALTHY | DEGRADED | UNAVAILABLE | UNKNOWN>
├── capabilityCodes: Set<NamespaceCode>
├── observedAt: UtcInstant
├── latency: ValueEnvelope<Duration>
├── safeErrorCode?: ReasonCode
└── observationRef: ContentAddressedRef<AdapterHealthObservation>
```

| Contract | Consistency | Payload | Result data |
|---|:---:|---|---|
| `integration.get_channel_binding@1.0` | A | `bindingRef?: ObjectRef<ChannelBinding>; adapterCode?: NamespaceCode; accountExternalRef?: ExternalRef; channelExternalRef?: ExternalRef; threadOrTopicExternalRef?: ExternalRef; purpose: NamespaceCode` | `ChannelBindingView`；External lookup 需脱敏且 Scope 授权 |
| `integration.get_delivery_attempt@1.0` | A | `attemptRef: ObjectRef<ChannelDeliveryAttempt>` | `AdapterAttemptView` |
| `integration.get_runtime_attempt@1.0` | A | `attemptRef: ObjectRef<RuntimeAttempt>` | `AdapterAttemptView` |
| `integration.get_render_attempt@1.0` | A | `attemptRef: ObjectRef<RenderAttempt>` | `AdapterAttemptView` |
| `integration.get_render_attempt_binding@1.0` | A | `attemptRef: ObjectRef<RenderAttempt>` | `RenderAttemptBindingView`；返回原始 RenderRequest、request payload hash、成功结果和 raw receipt ref，不暴露凭证或 Presigned URL |
| `integration.get_adapter_health@1.0` | P | `adapterCodes: Set<NamespaceCode>; observedAfter?: UtcInstant; page: PageRequest` | `Page<AdapterHealthView>`；Health 不代表业务动作成功 |

IM-04 规格复审确认：通用 `AdapterAttemptView` 只提供状态、请求 Payload Hash 和 Receipt Ref，不能让 Artifact 复验原始 Revision/canonical content/input Hash/Renderer 与成功输出的完整绑定。Representation Handler 开发前必须 additive 定义 `integration.get_render_attempt_binding@1.0`，返回只读 `RenderAttemptBindingView={attemptRef,status,request,requestPayloadHash,succeededResult,rawReceiptRef}`；它不得暴露 Provider 凭证、Presigned URL 或跨模块 Repository。WI-01 已以 additive 方式把该 Operation 加入当前 201 项 Registry；冻结的 v1.0 历史 Compatibility Baseline 仍为 200 项，Handler、真实 Provider、数据库和外部测试仍为 `NOT RUN`。

## 5. Event Payload Contract

| Contract | Payload |
|---|---|
| `integration.InboundEnvelopeAccepted@1.0` | `inboundEnvelopeRef: ContentAddressedRef<InboundEnvelope>; adapterCode: NamespaceCode; externalEventRef: ExternalRef; resolvedPrincipalRef?: PrincipalRef; targetCommandRef?: ContentAddressedRef<CommandReceipt>` |
| `integration.InboundEnvelopeRejected@1.0` | `inboundEnvelopeRef?: ContentAddressedRef<InboundEnvelope>; adapterCode: NamespaceCode; externalEventRef: ExternalRef; reasonCode: ReasonCode; quarantineRef?: ContentAddressedRef<QuarantineRecord>` |
| `integration.ChannelAnswerReceived@1.0` | `inboundEnvelopeRef: ContentAddressedRef<InboundEnvelope>; channelBindingRef: ObjectRef<ChannelBinding>; informationRequestRef: ObjectRef<InformationRequest>; responderRef: PrincipalRef; normalizedAnswerRef: ContentAddressedRef<ChannelAnswer>; sourceExternalRef: ExternalRef` |
| `integration.ChannelDeliverySucceeded@1.0` | `attemptRef: ObjectRef<ChannelDeliveryAttempt>; sourceBusinessRef: TypedReference; destinationBindingRef: ObjectRef<ChannelBinding>; rawReceiptRef: ContentAddressedRef<RawExternalReceipt>; occurredAt: UtcInstant` |
| `integration.ChannelDeliveryFailed@1.0` | `attemptRef: ObjectRef<ChannelDeliveryAttempt>; sourceBusinessRef: TypedReference; outcome: Closed<FAILED \| UNKNOWN>; reasonCode: ReasonCode; rawReceiptRef?: ContentAddressedRef<RawExternalReceipt>` |
| `integration.RuntimeDispatchSucceeded@1.0` | `attemptRef: ObjectRef<RuntimeAttempt>; workOrderRef: ObjectRef<WorkOrder>; runRef: ObjectRef<Run>; runtimeSessionRef: ExternalRef; rawReceiptRef: ContentAddressedRef<RawExternalReceipt>` |
| `integration.RuntimeDispatchFailed@1.0` | `attemptRef: ObjectRef<RuntimeAttempt>; workOrderRef: ObjectRef<WorkOrder>; runRef: ObjectRef<Run>; outcome: Closed<FAILED \| UNKNOWN>; reasonCode: ReasonCode` |
| `integration.RenderSucceeded@1.0` | `attemptRef: ObjectRef<RenderAttempt>; revisionRef: ContentAddressedRef<ArtifactRevision>; outputObjectRef: ObjectLocator; outputChecksum: ContentHash; rendererId: NamespaceCode; rendererVersion: NonEmptyString; rawReceiptRef: ContentAddressedRef<RawExternalReceipt>` |
| `integration.RenderFailed@1.0` | `attemptRef: ObjectRef<RenderAttempt>; revisionRef: ContentAddressedRef<ArtifactRevision>; outcome: Closed<FAILED \| UNKNOWN>; reasonCode: ReasonCode; rendererId: NamespaceCode; rendererVersion: NonEmptyString` |

Integration Event 只报告外部事实或适配结果；不得发布 TaskCompleted、Approval 生效、Formal Release Completion 或 EffectiveBinding。

## 6. 模块错误码

```text
INTEGRATION_ADAPTER_UNKNOWN
INTEGRATION_ADAPTER_VERSION_UNSUPPORTED
INTEGRATION_INBOUND_AUTHENTICATION_FAILED
INTEGRATION_INBOUND_EVENT_REPLAY_CONFLICT
INTEGRATION_INBOUND_PAYLOAD_HASH_MISMATCH
INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED
INTEGRATION_CHANNEL_BINDING_NOT_FOUND
INTEGRATION_CHANNEL_BINDING_SCOPE_MISMATCH
INTEGRATION_CHANNEL_MEMBER_NOT_AUTHORIZED
INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT
INTEGRATION_ATTEMPT_LEASE_INVALID
INTEGRATION_ATTEMPT_TERMINAL
INTEGRATION_RUNTIME_RESUME_NOT_ALLOWED
INTEGRATION_RUNTIME_RESULT_LATE
INTEGRATION_RENDER_INPUT_MISMATCH
INTEGRATION_RECEIPT_ATTEMPT_MISMATCH
INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN
INTEGRATION_QUARANTINE_REQUIRED
INTEGRATION_SENSITIVE_DATA_REJECTED
```

## 7. 不变量与持久化边界

1. 所有入站先认证、去重、Hash/版本校验，再转换为 Core Command；相同 external ID 不同 Hash 必须 Quarantine。
2. Channel Binding 是路由上下文，不授予成员 Enterprise/Project 权限。
3. 普通飞书文本/文件只形成候选或 Attempt，不自动成为 Fact、Answer、Approval、Release 或 Artifact。
4. 外部副作用先提交 Attempt/Outbox，再以稳定 key 调用；网络不进入业务事务。
5. Timeout 保持 UNKNOWN；只有真实 Raw Receipt 才能报告 Adapter 成功。
6. Raw Receipt 不是 Formal Release Receipt；owning module 必须重新验证。
7. Runtime Session/Continuation 只是受控 ExternalRef，不是 Project/Task/Run 身份或授权凭据。
8. Adapter 不保存长期 Capability Token、模型密钥或共享 Human Credential。

### 7.1 Issue #17 可离线验证的运行时切片

Issue #17 允许先在模块内部验证不依赖真实 Provider、数据库或 HTTP 的纯运行时边界。该切片使用内存 Ledger 和显式 Port，不新增公开 Contract：

1. InboundEnvelope 按 adapter/account/event identity 与 Payload Hash 幂等；先 Claim 该 identity 再映射 Core Command；同 ID 不同 Hash 保留首个事实并创建 Quarantine。
2. 外部 Attempt 以稳定键和请求 Hash 绑定；调用超时进入 `UNKNOWN`，稳定键重放复用已记录状态；timeout 之后迟到的成功或失败不得改写 `UNKNOWN`，也必须被观察以免 unhandled rejection。正式 `integration.adapter_attempt` 还必须绑定 `integration.external_delivery_request`，通用 Runtime/Renderer Attempt 不因该正式发布约束改变既有入口语义。
3. Adapter Contract 检查未知 Provider Major 或 required extension 时拒绝映射并进入 Quarantine；Render 结果的 input Hash、完整内容寻址 Revision（包括 `immutableVersionId` 与 `contentHash`）、Renderer 与 Request 不一致时拒绝登记。
4. 撤回只把 Origin 标记为 `WITHDRAWN` 并保留已有 Envelope；Origin 身份与入站事实相同，为 adapter + account + message；`im.message.recalled_v1` 必须携带被撤回消息引用，否则 Quarantine。每个 Binding 动作必须经过显式 Authorization Port，Binding 本身不授予成员 Project 权限。
5. Audit 入口只保存安全诊断字段；access token、app secret 和原始 webhook body 一旦进入候选审计输入即拒绝，并返回 `INTEGRATION_SENSITIVE_DATA_REJECTED`。

这是实现与 Unit/Contract 测试的最小验收切片，不等于跨进程幂等、真实 Adapter Conformance、PostgreSQL 事务、外部 E2E 或人工安全审查已经完成。

### 7.2 Formal Adapter Attempt Query Port（Issue #24）

ReleasePublication 需要 IntegrationGateway 提供窄化的结构化 Query Port，而不是导入 IntegrationGateway Repository 或读取其 Schema。`getFormalAdapterAttempt(attemptRef)` 只按完整 `objectType/objectId/Scope` 解析已登记的 `integration.adapter_attempt`，并返回 `attemptRef`、`adapterKind`、`status` 与 `externalDeliveryRequestRef`；未登记、错误类型、错误 Scope、缺少正式 External Delivery Request 或不存在的事实返回 `undefined`。Formal Receipt 只接受 `SUCCEEDED` 且与 PublicationAttempt 的 External Delivery Request 完全相等的绑定。受控跨模块 Runtime E2E 的登记输入必须独立于待验证的 RawExternalReceipt fixture，禁止将 Raw Receipt 反向投影为 Query 结果。

该 Port 是跨模块组合边界，不新增公开 Contract Catalog operation。受控 Runtime 由 `IntegrationGatewayRuntime` 实现；真实 IntegrationGateway Repository、Provider、跨进程一致性和生产 Query Handler 仍属于后续外部验收范围。

## 8. 可人工验收的模块产出

里程碑 `API-IG-01` 的人工产出是三组脱敏 Fixture：同一飞书事件重复三次只形成一个 Envelope/Command；相同 event ID 不同 Hash 进入 Quarantine；InformationRequest 卡片回答形成规范化 Answer Candidate，但未授权成员与普通“可以”不会形成 Approval；外部 timeout 保持 UNKNOWN。这里只验证 Anti-Corruption Contract，不代表真实飞书、Runtime 或 Renderer 已运行。

## 9. 当前状态

- 24 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核并成为字段级基准；
- Feishu Channel Contract v0.1 已完成静态 `DESIGN VERIFIED`，四个 optional minor 字段已随用户推进确认纳入基准；Runtime Adapter Contract v0.1 已获用户推进确认并进入 Implementation Milestone Plan；真实 Renderer Adapter、Credentials、Persistence 与 Provider Conformance 仍不存在，Issue #17 的内存运行时切片及其 Unit/Contract 测试已落地；
- 字段级 Schema 已落地：`contracts/src/operations/integration-gateway.schema.ts` 已实现 9 Command + 6 Query + 9 Event Payload Schema，6 个 Query Result Schema（新增 `RenderAttemptBindingView`）；Registry 中当前 24 个 operation 均为 `FULL`，历史 23 个 operation 的 2026-08-18 升级记录保持不变；
- 2026-08-18 review 修复：Resume 操作通过 `runtimeResumeRequest` overlay 单独要求 `continuationRef`；`feishuDeliveryRequest` 通过 `if/then` 约束 `REPLY/REPLY_IN_THREAD` 必须携带 `replyToExternalRef`；`businessContextRefs` 改用专用 union 禁止 `ExternalRef`、`Runtime Session` 与 workspace path；`ChannelDeliveryFailed` 移除 spec 未声明的 `destinationBindingRef` 字段。
- 2026-08-18 review 第二轮修复：`ChannelBindingView.status` 改回 Module-Spec §4 定义的 `NamespaceCode`（不再窄化为 `InboundStatus`）；`AdapterHealthView.latency` 由 `common.valueEnvelope` 替换为本地 `valueEnvelopeDuration`，仅在 `presence=PRESENT` 时要求 `value` 为 common `duration`；`businessContextRefs` 在 per-kind 引用 schema 上叠加 objectType 白名单（`execution.task` / `execution.work_order` / `execution.information_request` / `quality.approval_request` / `release.release`），并补 `identity.principal` 等非白名单负向回归；`attachmentRefs` / `conflictRefs` 移除过度收紧的 `uniqueItems` 保留普通数组语义；`adapterCodes` 移除 `minItems=1` 但恢复 `uniqueItems`，与 Module-Spec §4 `Set<NamespaceCode>` 一致。
- 2026-08-18 review 第三轮修复：`adapterCodes` 在保留 Set 唯一性的前提下重新接受空数组；新增 `IG-API-S-020`（空数组 valid）与 `IG-API-S-021`（重复项 `uniqueItems` 错误）成对回归，纠正第二轮修复文档中"P2 已断言回归"的失真。
- 静态设计 / Schema 维度 Gate：WI-01 的 `pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm architecture` 与 `pnpm contracts:check` 全部通过；新增 Binding Query 正向、秘密字段、状态条件和未知 major 负向断言全部 PASS。
- Issue #17 的可离线验证运行时切片已于 2026-08-22 落地，覆盖 Inbound 幂等/Hash 冲突、timeout `UNKNOWN`、未知协议拒绝、Render 绑定、撤回 Origin、显式授权和 Audit/Masking；PR #26 review 补强 Claim-before-dispatch、timeout 迟到 rejection 观察、Origin 的 adapter/account 身份、recall 必填消息引用和 renderer mismatch 回归；focused tests 全部 `PASS`，完整验证结果见 `.vibe/archive/issue-17-integrationgateway-runtime-acceptance-gaps/Verification-Report.md`。
- Handler、Repository、Database、Migration、Feishu Adapter、Runtime Adapter、Renderer Adapter、Credentials、E2E 与人工业务验收仍为 `NOT RUN`，改由 [Issue #27](https://github.com/qzhike/zhiju-business-core/issues/27) 追踪；Schema 闭合或内存运行时切片不等于跨进程去重 / 真实撤回 / 真实权限 / Provider UNKNOWN / 业务撤回判定已运行；review body 中标注的 7 类字段级契约偏差已修复，模块不得据此声称 Issue #6 全部 8 条验收完成。
- Issue #24 的 controlled Runtime Query Port 已完成 exact Adapter Attempt ID/Scope/Status/External Delivery Request 绑定回归；该 Port 不替代真实 Provider、数据库 Handler 或统一跨模块业务 E2E，前两者的本地受控技术回归已通过，真实 Provider、生产 Query Handler、跨进程一致性和统一跨模块业务 E2E 继续为 `NOT RUN`。

## 10. IM-02 WI-04 持久化切片

IntegrationGateway owning Schema 在 #32 中仅获得八张标准事务技术表，并遵守 Project 行双重 RLS、Process 父子 Scope 镜像、含 owner version 的 Reference Edge 判重和可用的 masked audit surface。#27 继续拥有业务 Migration/Repository、Provider、跨进程幂等与外部 E2E；Canonical payload↔hash 强校验及这些运行时验收均为 `NOT RUN`。

## 11. IM-05 WI-05 Renderer 纵向切片实现合同（Issue #125）

1. Renderer Profile 为代码内版本化闭集，只接受 `document.docx + zhiju.renderer.docx.minimal` 和 `workbook.xlsx + zhiju.renderer.xlsx.minimal` 的声明版本；Document 与 Workbook 类型/format/profile 交叉组合必须在外部副作用前拒绝。
2. Render input package 必须包含完整 `RenderRequest`、其 canonical SHA-256、精确 `revisionRef`、canonical source locator、canonical input hash 和 Renderer Profile。Worker 从注入的 Object Storage Port 权威 readback bytes，重新计算 canonical SHA-256，并验证 Canonical Content executable Schema；调用方声明或 storage metadata 不能替代 bytes readback。
3. 使用 forward-only `V7001` 新增 RenderAttempt 与 RawExternalReceipt 业务表；不得修改已应用的 `V7000`。Project 行必须同时满足 Enterprise/Project RLS；Attempt 按 Scope + stable key hash 唯一，same key/same request hash replay，same key/different request hash 返回 `INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT`。
4. Attempt 在任何 Renderer 调用前以公开状态集内的 `CREATED` 提交；调用不占用数据库事务。所有 Provider 成功结果必须在落库前通过同一权威验证：output/receipt locator 必须由 Attempt identity 派生，media type 必须匹配 Profile，output bytes/checksum 必须一致，Receipt canonical bytes 必须精确绑定 attempt/output/checksum/renderer。验证拒绝或异常进入 `FAILED`，不得创建 Raw Receipt 或成功 Outbox；验证通过后才写入脱敏 Raw Receipt，并与 `integration.RenderSucceeded` Outbox 原子推进 `SUCCEEDED`。Timeout/不确定结果进入 `UNKNOWN`，重放不得再次调用；reconciliation 复用同一验证，不得接受自洽但替换的 output/Receipt。
5. Raw Receipt 只保存 attempt identity、opaque provider receipt ref、payload locator/hash、observed outcome 和时间；不得保存 Presigned URL、credential、token、secret 或原始敏感 payload。`integration.get_render_attempt_binding@1.0` 只能由公开 Query Handler 从 IntegrationGateway owning Repository 构造并经 ContractRegistry result validation 后返回。
6. Artifact 组合仅依赖 `RenderAttemptBindingQueryPort`；IntegrationGateway 不导入 Artifact Repository，不写 Artifact/Quality/Release Schema。Render success 与 Representation registration 均不产生 Quality PASS、Approval、Release Authorization、Release Completion 或 EffectiveBinding。
7. Local/CI Object Storage 与内置最小 OOXML Renderer 属于受控工程实现；真实 Ceph RGW/OpenBao、第三方 Renderer、公开 HTTP、生产、负载/HA、宏/外链/pivot/完整公式引擎和 pixel-perfect Office fidelity 不在本切片。

当前状态：`IMPLEMENTATION, UNIT, CONTRACT, PERSISTENCE, OFFICE OPENABILITY AND GIT DELIVERY COMPLETE / PR #135 MERGED / ISSUE #125 CLOSED`。实现 head `d3a1394663d3f953e4c686385b0ef9d8d280aefb` 已通过 exact-head review/CI 并由 merge commit `1ef1303be233901c73a0bcc8f97bce8edf7e93a7` 纳入 `main`；真实外部 Provider、Ceph RGW/OpenBao、公开 HTTP、生产、负载/HA、完整 Office 引擎与真实客户版式验收仍为 `NOT RUN`。

## IM-06 Runtime Binding Query 设计

状态：`TECHNICAL DESIGN APPROVED 2026-09-08 / NOT REGISTERED / NOT IMPLEMENTED`；关联 #153、[TD-02](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)。保持 `get_runtime_attempt@1.0` 的 AdapterAttemptView 和既有 RuntimeDispatchRequest 不变。设计新增 `integration.get_runtime_attempt_binding@1.0`：A Query，payload `{attemptRef: ObjectRef<RuntimeAttempt>}`，purpose `integration.runtime.binding.read`，仅有该 Scope 权限的 TaskExecution Dispatcher/Validator Service及授权审计 Human。

```text
RuntimeAttemptBindingView
  attemptRef: ObjectRef<RuntimeAttempt>
  status: AttemptStatus
  request: RuntimeDispatchRequest
  requestPayloadHash: PayloadHash
  invocationBinding:
    runRef, workOrderContractRef, contextSnapshotRef, capabilityGrantRef
    leaseId: UuidV7
    fencingToken: NonNegativeInt
    leaseExpiresAt: UtcInstant
    runtimeBinding: RuntimeBinding
  acknowledgement?:
    observationId: UuidV7
    rawReceiptRef: Exact<RawExternalReceipt>
    runtimeSessionRef: ExternalRef
    acknowledgedAt: UtcInstant
    source: Closed<SYNTHETIC_DRIVER|PROVIDER>
  bindingHash: PayloadHash
```

RuntimeBinding 的字段复用 Spec 003；Raw Receipt 与 acknowledgement 必须由真实执行的所选 Driver 产生，source 与 Adapter Profile 固定 namespace一致，不能由调用者传入 `SUCCEEDED`。仅 SUCCEEDED 携带 acknowledgement；其他状态省略，TaskExecution不得启动。bindingHash只规范覆盖不可变的attemptRef、原request及invocationBinding，排除自身Hash、mutable status与后续acknowledgement；acknowledgement以独立Observation/RawReceipt Hash验证。requestPayloadHash 仅覆盖原 request，不能与 bindingHash 互换；调用者不能提交一个新的 self-consistent request替代已存 request。

Runtime Worker 从 TaskExecution 权威 Run lease/binding Port 读取 lease/fencing（读取服务 capability受限，不能从 caller runtimeBinding CanonicalJson提取授权）。读取接口设计为 `execution.get_run_dispatch_binding@1.0`，字段由 Spec 003拥有。创建 Attempt 时核对 request 与该 Port的 Run/Contract/Context/Capability/RuntimeBinding匹配，提交后才调用 Driver；Token/密钥仅在受控 Adapter 进程解析，不能进入上述 Query/Receipt。

Attempt invocationBinding 创建后不可变；success observation 必须复验 invocationHash、稳定键和 session来源，原 request、Receipt、lease绑定全部同 Scope。超时 UNKNOWN、重放返回原 Attempt；允许对原 Attempt 独立真实读回并追加 reconciliation Observation，但不得二次 dispatch同键或反向由待验证 Receipt 构造 Query View。记录成功不意味着当前 lease仍有效，TE start/finalize 必须重新判断时效。

拥有关系、物理表和 guard 见 PostgreSQL 技术设计附录。旧 Renderer/FormalReceipt 行为保持原基准；本设计不授权 Runtime 六项控制命令。Runtime成功与 synthetic 技术证据必须分别标记。

## Workspace MVP D14：项目资料准备与正式启动

状态：`D14 / INITIALIZATION DIRECTION USER APPROVED 2026-10-08 / FIELD CONTRACT CLOSURE PENDING / NOT REGISTERED / NOT IMPLEMENTED`。用户批准的范围、主工作区依据及兼容规则见[正式提案 §4.7.1](../decisions/workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)。本节同步新增设计约束，不宣称本分支较早正文的实施状态等于当前 main，也不改变已发布接口。

1. ZIP 提交在正式 Project Scope 内接纳，Host 受控解包并物化客户输入、公司模板/规则及来源别名。用户文本和 ZIP 条目不得指定宿主路径、Runtime 可执行文件、模型、Skill 或 MCP；解包失败不 dispatch。
2. 分析 Driver 明确消费 PreparationContext/profile 与同一 Run/Attempt/lease/fencing；允许写受限报告输出根，客户源和模板只读。当前 synthetic profile 不证明真实 CLI 已兼容。
3. 原始报告 JSON、Markdown bytes/Hash 和文件声明从实际原 Invocation 观察；不凭自然语言猜成功、不向 EP 复制 Runtime 状态。EP/TE 独立校验和接纳，缺来源或绑定错的输出隔离。
4. Runtime 目标名单为 oh-my-pi、pi、qoder-cli、Claude Code；首版实际所用 Driver/版本/profile 由部署及技术决定固定。UNKNOWN 只回读原调用，显式重试和新输入创建受控新尝试，不同键不得无意重复执行。
