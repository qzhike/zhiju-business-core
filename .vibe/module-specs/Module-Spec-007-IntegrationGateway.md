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

TD-02 受控 Driver 的完整输入/输出由 [Runtime profile](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#受控-driver-输入输出与调度)拥有；Fixture 配置不能作为公开请求字段或成功证明。RawReceiptSubmission 的 attemptKind 为 RUNTIME，attemptRef 来自已提交 Attempt；providerReceiptRef 标识实际 synthetic receipt，receiptPayloadRef/hash 来自保存的安全原始 ack；occurredAt 仅在真实观察存在时填入，recordedAt 为受信记录时间。先由既有 record_external_receipt 提交 RawExternalReceipt，再由 IG Worker 在自己的 Attempt 事务校验 exact Receipt、追加 Observation、更新成功状态并写 Outbox。目标事务提交后、Worker 进度确认前崩溃时按原稳定键/Observation identity 重放；孤立 Receipt 不是 SUCCEEDED。该步骤是既有 owning Worker 的内部职责，不是调用方任意设置 status 的新公开 API；不得通过调用者自带 Receipt 反向构造可信 binding。

### IM-06 READY Run 启动增量（提案，2026-09-22）

状态：`T2 / HUMAN DESIGN APPROVED 2026-09-22 / LOCAL IMPLEMENTATION 2026-09-23 / PR #222 CI FULL PASS 2026-09-23（6a41b41）/ REVIEW APPROVE ON 6a41b41`。本项把上述已批准 TD-02 Binding Query 用于 #219 后的首个 canonical READY Run，细节见[Spec 003 §22](Module-Spec-003-TaskExecution.md#22-ready--queued--受控-run-启动增量设计提案)和[决定 §21](../decisions/task-execution-human-operated.md#21-ready-workorder-到受控-run-启动的增量设计提案)。新增 `integration.get_runtime_attempt_binding@1.0` 的结果采用上文已批准 `RuntimeAttemptBindingView` 闭集；本波次仅支持 `source=SYNTHETIC_DRIVER`，Provider 分支留待 IM-08，不改变现有 `get_runtime_attempt@1.0` Schema。

`request_runtime_dispatch@1.0` 仅由受信 IG Service 在独立当前授权下执行：先经 TE 的新 `get_run_dispatch_binding@1.0` 取得原 Run/ACTIVE Claim，再经 IdentityPolicy owning Port 重验 Bundle 与本次 IG 消费权限；原公开 request 的七个引用/RuntimeBinding 成员必须与 TE 精确读回逐字段一致，`stableIdempotencyKey` 固定到该 Run/attempt，`requestedAt` 取受信 Service 时刻。Attempt Ref 使用已发布的 `integration.runtime_attempt` spelling，原 request/hash、invocationBinding/hash、Project Scope 与稳定键先同事务提交，Receipt/Audit/Reference Edges 同事务；不得把还没执行的 Driver 标成 SUCCEEDED。不同 payload 复用稳定键拒绝，不能创建第二 Attempt。

固定 synthetic RuntimeBinding：`adapterCode='te.human_operated.synthetic'`、`adapterVersion='1.0'`、`harnessId='zhiju.runtime.synthetic'`、`harnessVersion='1.0'`、`provider='synthetic'`、`modelId='synthetic'`、`modelConfigHash=SHA-256(canonicalization-v1({}))`，`executionNodeRef` 缺省。此映射使用 §21.6 静态 selector 的技术模式，但 Driver 是否确实安装、调用和返回 ack 必须由本模块的运行时事实证明。原 request 的 `runtimeBinding:CanonicalJson` 只允许此闭合集，任何额外字段、版本漂移或 caller 提供的另一个自洽 Hash 均拒绝。

IG Worker 在 Attempt 提交后从自己的已提交原 request/Binding 形成最小 Driver 输入。实际调用产出的 session、ack 与 RawExternalReceipt 必须互相绑定 attempt、Run、lease/fencing、bindingHash；Raw Receipt 先由 owning 入口提交，然后 Attempt 事务追加不可变 Observation、状态 SUCCEEDED 与已注册成功 Event。超时/不明结果为 UNKNOWN，同稳定键重放不再调用；只有原调用真实 ack 的独立读回可追加调和 Observation。`get_runtime_attempt_binding@1.0` 在独立当前授权下按精确 Attempt Ref 返回原 request/hash、不可变 invocation/hash 和真实成功 Observation；缺 ack、错 Scope、过期或撤权不得伪造 SUCCEEDED 投影，未授权时 repository 读数为 0。Query 结果不带 token、密钥或可执行路径。Run lease 过期后仍可审计历史 Attempt，但 TE 不得因此 start。

本切片的 IG 新表/权限与真实 PostgreSQL 正反例见 PostgreSQL §37、`IG-RUN-D-*`；真实 CLI/Provider、正式 Runtime Profile conformance、Result/Usage/Completion 保持 `NOT RUN`。

### IM-06 受控 final 观察与权威读取增量（提案，2026-09-23）

状态：`T2 / DESIGN APPROVED 2026-09-23 / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-23 / HUMAN DESIGN APPROVED 2026-09-23 / PR #226 MERGED / ADDITIONAL LOCAL FULL PASS 2026-09-26 / INDEPENDENT REVIEW PENDING FOR LOCAL CHANGES`。本项接续已提交 synthetic ack 和 RUNNING Run；Result、Validation、Acceptance 与 terminal 状态由 [Spec 003 §23](Module-Spec-003-TaskExecution.md#23-受控-final-agentresult-接纳与-run-终结增量设计提案)拥有。本模块只证明**原 Driver invocation 实际交付了哪一份 final payload**，不替 TaskExecution 判断它是否合格。

在原 Attempt 创建事务内预分配不同于 attemptId 的 Adapter 实例 UUIDv7，作为最小原调用输入并不可变封存；预分配本身不产生有效 Runtime 身份。只有原 synthetic Driver 真正调用并回传与此 ID、原 bindingHash/RuntimeBinding/Scope 一致的 ack，IG 才在原 ack 成功事务提交独立、不可变的 `ObjectRef<zhiju.runtime.runtime>` owning 事实（原 Attempt 一对一，Project Scope、adapterCode/version、bindingHash、ack observation ID、source 均镜像闭合）。该对象表示实际参与本次 invocation 的 Adapter 实例，不是 Attempt 的别名，也不是静态 `zhiju.runtime.adapter_contract` selector。IG 内部 `readRuntimeAdapterIdentityForAttempt(attemptRef)` Port 只在原 Attempt SUCCEEDED、成功 ack/身份行均已提交且当前独立授权有效时返回 `{runtimeAdapterIdentityRef,attemptRef,runRef,bindingHash,runtimeBinding,ackObservationId,source}`；TE start 可用它建立 Run 的不可变身份绑定，既有公开 `get_runtime_attempt_binding@1.0` 结果保持不变。ACK 事务失败后只从原 Driver readBack 相同 ID 重放，不创造第二身份。

在已有 `SyntheticRuntimeDriver` 增加仅按原 attemptRef 读取的 `readFinal(attemptRef)` 内部 Port。原 `invoke` 在调用前固定版本化模板及 templateHash，模板不含实际 `submittedAt` 或最终 Result Hash；Driver 只在 Run start 的受控屏障释放时一次生成完整 AgentResultContract、Header Hash、稳定同 invocation 的 `runtimeSubmissionRef`、原 fencingToken、已提交的 Adapter 实例 Ref、实际观察时间和安全来源证明，并须跨 Worker 重启从原调用读回同一 bytes/ref/hash。读回调用不执行第二次 dispatch；同 attempt 的重复读回字节与 submission identity 相同。尚未释放返回无观察；同 ID 异 payload/hash、换 Run/fencing/session、缺原 ack 或错 profile 的输出拒绝并留脱敏冲突。IG Worker 只从已提交原 Attempt 和 Driver 原调用读回，核对成功 ack 的 observation/RawReceipt、Adapter 实例 Ref、requestPayloadHash、bindingHash、Run/lease/fencing 与 final 实际 Header Hash；随后在独立不可变的 `runtime_final_observation` 保存完整受控 Result body/hash 与安全投影，绑定原 dispatch CommandReceipt 并同事务写 Audit/Edge；Worker 进度在该事务提交后记录；body 只用于受信 TE 查询和故障恢复，不能包含 Secret、Prompt 或 stdout。该事务失败可按原 attempt/submission 重放，绝不能由待验证的 `submit_agent_result` body 反向构造观察。迟到 final 仍可作为历史观察保存，但不授予 TE 执行资格；IG 不把它投影成 Run 成功。

ACK 成功事务回滚留下 `CREATED` Attempt 时，同键 dispatch 重放只读原 Driver 的 `readBack`，不得再次 invoke。无原 ack 仍为 `CREATED`；存在匹配的原 ack 时按原预分配实例 ID 补交。并发补交在 Attempt 行锁下核对已提交的 ack/session、receipt payload 与实例身份，只有相同原调用可返回既有事实，不增身份、Observation 或成功 Event。

final Result 的 `provenance.runtimeSessionExternalRef` 必须精确等于原成功 ack Observation 保存的完整 session Ref。IG final 观察在事务内读取该原 ack 并核对 session；Core-valid 且自洽重算 Header Hash 的另一 session 仍是来源冲突，不能先保存为 final 再只依赖 TE 拒绝。

新增 `integration.get_runtime_final_observation@1.0`：AUTHORITATIVE QUERY，Purpose `integration.runtime.final_observation.read`，payload closed `{attemptRef:ObjectRef<integration.runtime_attempt>}`；本轮每 Attempt 最多一份已提交 final，提交前未知的 submission Ref 只在响应中返回。Result.data closed 为 `{observationRef:ContentAddressedRef<zhiju.integration.runtime_final_observation>,attemptRef,runRef,runtimeSubmissionRef,resultPayloadHash:PayloadHash,bindingHash:PayloadHash,runFencingToken:NonNegativeInt,ackObservationId:UuidV7,runtimeAdapterIdentityRef:ObjectRef<zhiju.runtime.runtime>,agentResultContract:AgentResultContract,observedAt:UtcInstant,source:'SYNTHETIC_DRIVER'}`。所有引用保留完整 Project Scope；`ackObservationId` 必须精确等于已发布 Binding Query 中原成功 ack 的 observationId，而非任意新 Receipt。查询在独立当前授权下只返回同 Scope、同 Attempt 唯一的已提交不可变事实；无观察、UNKNOWN、无成功 ack、错完整 Ref、撤权或跨 Project 均不可用，拒绝时 protected repository 读取数为零。结果只向独立授权的 TE SERVICE 暴露已提交的完整受控 AgentResultContract 与 Hash，不暴露 token、fixture 配置或路径；TaskExecution 从该 owning 查询获取原文并重算 Hash，并另行重验 Run 当前状态/期限。既有 `integration.get_runtime_attempt_binding@1.0` 的 Result Schema、Purpose 与接受集保持不变。

本轮仅允许已登记的 `te.human_operated.synthetic@1.0` 与 `source=SYNTHETIC_DRIVER`；无 Provider/CLI conformance、公开 final 写入命令或外部回执升级。存储和独立授权见 PostgreSQL §38、Spec 001 §15.13；实际执行子集与剩余 `NOT RUN` 项见 `IG-FINAL-D-*`。当前分支已在真实 PostgreSQL 验证原调用、Worker 重建读回和迟到 final；外部与人工验收仍 `NOT RUN`。

### #229 受控 BLOCKED_INPUT 与第二 invocation 映射（实现契约）

状态：`T2 / DESIGN APPROVED / INDEPENDENT DESIGN REVIEW PASSED 2026-09-27 / HUMAN DESIGN APPROVED 2026-09-27 / IMPLEMENTATION PRESENT (#231) / EXACT REVISION VERIFICATION AND REVIEW EVIDENCE IN PR #232`。消费 [Spec003 §24.2](Module-Spec-003-TaskExecution.md#242-唯一正向-profile冻结和实际-driver-final) 的两个有限final profile；本模块仍只拥有真实invocation/ack/final observation，不确认答案或协调WorkOrder/Task。

现有 `request_runtime_dispatch@1.0`、Attempt/Adapter identity、RawReceipt、`get_runtime_attempt_binding@1.0`、`get_runtime_final_observation@1.0` 的payload/result/Purpose不变。Run-1模板为一个既有candidate/accepted Sources的blocking proposal；Run-2模板为空COMPLETED。模板版本/完整hash在各自实际invoke前固定，Run-2由实际Run/Context-2/Bundle-2/lease/fencing形成全新dispatch/Attempt/Adapter实例/session/submission，不能把Run-1 Session、Observation、模板finalbytes作为第二次来源。两次RuntimeBinding仍为原synthetic固定值，adapter_contract静态selector仍@1.0；template支持集扩展是内部Driver增量，不冒充CLI/profile conformance。

Worker/dispatch binding资格读须接受Run已固定的Context-2；通过TE frozen eligibility与IP新Bundle当前验证，而非要求等于Contract.contextSnapshotRef。完整原Contract保留Context-1，原dispatch ack/finalprovenance则逐字段比较本Run.creation.contextSnapshotRef。每次protected read/dispatch前当前授权与期限重验；缺资格不invoke。实际final释放后IG按原ack/session/Adapter、Run/Context/Bundle/fencing/headerHash验证封存；IG不依据confirmation Receipt产生成功Result。TE独立验证proposalprofile/候选来源、Acceptance与终态。

每Attempt最多一final；IG observation事务故障或交接进度丢失只读回同一原调用，同键不再次invoke。Run-1迟到final不得绑定到Run-2；自洽重算Hash仍不能覆盖错Session/Context/fencing。无final则保持等待；final observation可保存历史但不给已terminal/expired Run执行资格。不增IG public操作/结果字段/虚构final Event，恢复仍用已有Query和受限扫描；forward guard只扩展两受控模板的已发生来源，不更新V7001–V7004。测试 `IG-REC-D-001–003` 与Runtime专项 #229 保持NOT RUN。


### #233 非空正式输出的受控 final profile（提案）

状态：`HUMAN DESIGN APPROVED 2026-09-30 / NOT RUN`。冻结 `te.human_operated.synthetic.formal@1.0` selector的精确身份见 [Spec 003 §25.1](Module-Spec-003-TaskExecution.md#251-有限冻结-profile-与精确-selectors)。RuntimeBinding adapterCode=`te.human_operated.synthetic.formal`、adapterVersion=`1.0`，harnessId=`zhiju.runtime.synthetic`、harnessVersion=`1.0`、provider/modelId=`synthetic`；modelConfigHash由实际冻结配置产生，不用旧Invocation的Hash。正常模板final=COMPLETED，恢复模板两次分别BLOCKED_INPUT与COMPLETED；其余原ack、adapter实例、session、fencing、IG final observation、公开Query与五步Process读取边界沿用已交付§23/24，不新增IG public operation或Source Event。

原Driver invocation启动时固定template/version/hash、Run/Contract/Context/Attempt/security identity，但未有Revision时不能预填一个业务Ref。Human实际Artifact提交后，受控Driver的有限释放入口绑定**原invocation**并持久记录实际revisionRef/creationCommandRef与release请求Hash；这是可重复readFinal的输入记录，不是IG/TE业务成功事实。第一次合法释放固定完整AgentResult bytes/hash/submissionRef/submittedAt；同键同输入返回原文，异输入拒绝，重启仍可读回，同Run无第二final。恢复Run-1不等待Artifact输出；Run-2只在新Context/独立Invocation启动后接受新输出。最终输出严格遵守Spec 003 §25.2的一个BusinessOutput；secret/prompt/stdout不存储，无虚构Provider Usage。

IG仅独立重验Core shape/Hash、冻结模板与实际原Invocation来源、时间/fencing/adapter绑定，按原owning Attempt事务封存final observation；不解释Receipt真实性、Revision current生命周期、business acceptance或Completion。Driver可观察迟到final为历史；TE以自身授权、Run/Claim/expiry与owning output事实裁决，不把释放成功当Core成功。释放授权为同Scope授权Human；依赖Artifact exact事实由Driver SERVICE自身读取授权取得，不借Human Decision；缺授权protected reads为0。规范与故障场景见 Runtime Contract/Test #233、IG Module-Test；#235 已实现受控 Driver 的正式释放与 immutable journal，受控执行与外部/人工证据分别记录。


#233 Driver持久化复用原synthetic invocation/final的受控对象journal（现有putImmutable/read边界），新增独立release输入journal记录，包含原Invocation identity/hash、实际Ref/Receipt、release请求Hash与第一次受信release时刻；不新增业务表或伪造Core Receipt。release/final以同Invocation稳定locator的atomic put-if-absent竞争；输者重读已提交记录，字节相同才重放，异输入拒绝；首次成功release记录提供固定submittedAt，多个Worker不能各自按now写不同final。journal写后final未写/IG未封存的崩溃，从原immutable release记录恢复同一模板/Ref/时间计算相同final并readFinal，不重新invoke。

### IM06-CANCEL 原 invocation 的迟到 final 历史观察（已批准设计）

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-03 / INDEPENDENT DESIGN REVIEW APPROVE 2026-10-03 / IMPLEMENTED IN #244 PROPOSED REVISION / RUNTIME EVIDENCE IN THE PULL REQUEST`。

批准修订与原始 Hash 见 [取消设计决定 §5](../decisions/task-execution-cancellation.md#5-人类设计批准与修订绑定2026-10-03)。实现见 #244：复用现有 IG Query/Observation 与新增 late-final 读取边界；运行证据记录在对应 Issue/PR。 TE 的接纳/隔离语义唯一见 [Spec 003 §27.3](Module-Spec-003-TaskExecution.md#273-历史来源隔离与-process-停止)，IP 依赖读取映射见 Spec 001 §15.17。

复用原实际调用的 Attempt、immutable invocation/ack、Runtime Adapter identity/session、final Observation 与两个 existing authoritative Binding/final Query；payload/result/Purpose 不变，不增加 IG public operation、final Event 或 Cancel ACK。本切片 late-isolation 的业务支持集为 TE §27.1 有既有 reservation 的两次执行 profile，IG 的原 Query/Observation 支持集不变。受控 Driver 在 ack/start 之后固定原模板/Hash，以真实取消或到期提交屏障延迟原 final，不替换 Run/Contract/Context/Bundle/fencing/submission identity，不再次 invoke。IG 只封存确实发生的原来源，允许迟到 Observation 保留历史；执行资格由 TE 判断，保存 Observation 不证明 Result 可用。

late consumer 的两个 Query 各以自身 current IP Decision 读取 exact Attempt；没有权限、来源不可验证或暂时不可用则 fail closed，不能由 caller JSON 或另一 Run 的自洽 Hash 补足。原执行租约到期不抹除 IG 历史 Observation，但并不豁免查询自身当前权限。来源异常与合法 LATE_RESULT 区分，IG 不替 TE 创建隔离 Audit、不改变 TE Root、不调用未批准 Runtime cancel/ACK。实际次数、原 bytes/Hash、历史保留及授权反例在 IG Module-Test 的 IG-CANCEL-D 行独立记录，全部 NOT RUN。

### IM06-USAGE 原调用来源的只读消费（提案）

状态：`T2 DETAILED DESIGN APPROVED 2026-10-04 / DESIGN TECHNICAL REVIEW PASSED 2026-10-04 / HUMAN DESIGN APPROVED 2026-10-04 / IMPLEMENTED 2026-10-04 (Issue #246)`。消费目标见 [Spec 003 §13](Module-Spec-003-TaskExecution.md#13-td-06-usage--provenance-补充设计)，六项授权唯一见 Spec 001 §15.18，IG 场景见 Module-Test-007 的 IG-USAGE-D。本段只规定 IG 如何证明原历史来源，不拥有 Usage/Result Acceptance 解释。实现为 `ControlledRuntimeDispatchService` 的 `getUsageRuntimeBinding` / `getUsageRuntimeAdapterIdentity` / `getUsageFinalObservation` 严格读；未执行验收保持 NOT RUN。

复用 `integration.get_runtime_attempt_binding@1.0`、`integration.get_runtime_final_observation@1.0` 和内部 `readRuntimeAdapterIdentityForAttempt(attemptRef)` 的既有结果 shape。新 usage consumer 的三个 exact Attempt Decision 分别走 Binding、Adapter identity、final 边界；内部 identity operation/Purpose 采用 Spec 001 表中精确值，不将原 start 的 mapping 扩成通用授权。SERVICE 自身当前 Decision 在每个 protected read 前、返回前重验；不对 Human 暴露完整 final body。公开 IG Schema/Purpose/支持集、Worker/Driver 的 invocation/观察写路径均不变。

来源只从原已提交 runtime_attempt、runtime_attempt_observation、raw_external_receipt、runtime_adapter_identity、runtime_final_observation 取得。Binding 校验原 request 与 invocation binding canonical hash、Scope 与成功 ack/RawReceipt/observationHash；identity 仅在原 SUCCEEDED/ack 已提交时可用，校验原 planned instance id、独立 instance!=attempt、完整 Scope、adapterCode/version、bindingHash/ackObservationId/source 与不可变 canonical identity 的各镜像和 Hash。预分配但没有真实 ack 不返回实际 identity。

本 consumer 采用的 final read 还必须验证 stored canonical observation/hash 与字段镜像，以及 Core-valid 原 body/header hash、原 ack session、Adapter identity、Attempt/Run/fencing/Scope/bindingHash。observationRef.contentHash 是 canonical Observation Hash；resultPayloadHash 是 hashContractPayload(agentResultContract)，两者不互换。现行 final Query 中可重建的 observation canonical 形状为 `{observationId,attemptId,runtimeAdapterIdentityRef,runtimeSubmissionRef,resultPayloadHash,bindingHash,observedAt,source}`，由 IG Owner 用 stored payload/mirrors 验证；TE 不能反向伪造它。读取实现若复用现有 helper，需在 usage owning 读取边界补齐当前 helper 尚未完成的 canonical integrity 校验，不能只凭公共 result Schema 合法认定真实。

三个读取各以原 Attempt 为唯一 target，不根据 Runtime session、Provider/Model 名称、caller final、TaskBoard 或其他 Run 推导 source。只有 final 未产生且本次确实有当前读权的确定 not-found 使用 `INTEGRATION_RUNTIME_FINAL_NOT_FOUND`；未知依赖/数据库/权限错误不得转换为“没有 final”。已 start 的消费者读到 ack/identity 不完整，按来源冲突向 TE 安全报告；不得补建 identity、Observation、Receipt 或调用 readBack/readFinal/invoke。每个 owning read 保持自己的来源一致性，跨三个 Port 仅合并已验证不可变事实；遇到并发 final 新提交，可留待下一读取，不返回虚构的原子全局快照。

历史读回不验证原 Run 当前执行资格，因此合法 expiry/ABANDONED 后仍能返回原 Observation；执行资格仍由 TE 自己判断。原 accepted Result 的迟到重交审计不改写 IG 原 source。返回给 TE 的源 DTO 只能在受信 composition 内消费，再由 TE allowlist 输出 summary/evidence；不扩大 IG public body 到 Human 的权限。复用原 app SELECT/RLS，无新的 schema/table/index/role/grant；SQL/角色边界见 PostgreSQL §43。

## D14 / RD-01 ZIP intake 与真实报告观察提案

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。本模块只拥有受控外部传输/物化/调用与原始观察；source custody 与报告业务快照属 EP，Run/Result 属 TE。限制与路径规则见 [ZIP handoff](../decisions/d14-rd01-first-customer-flow.md#2-zipstaging-与-host-的交接)。

| 拟操作@1.0 | 封闭 input | result / 当次 purpose |
|---|---|---|
| `integration.request_customer_zip_intake` / CREATE | `projectRef; originalName:Sensitive; declaredByteLength; zipBytesSha256; intakePolicyRef` | OBJECT `zhiju.integration.customer_zip_intake` intakeRef + opaque one-intake upload token/expiry + receiptRef；`integration.customer_zip.intake`；不接受 locator/CLI/path，当前 HUMAN 接纳权 |
| `integration.get_customer_zip_intake` / Query A | `intakeRef` | original request hash、status RECEIVING/STAGED/EXTRACTING/READY/PARTIAL/FAILED/UNKNOWN、逐 entry states/accepted source refs、安全 reasons、manifestRef?、Receipt refs、current allowedActions；`integration.customer_zip.read`；许可范围，无 storage locator/host path |

worker 使用 original intakeId/key/payload，依次原 bytes 写 staging、验证→EP register/accept ZIP→受控提取→逐合法 entry validate/register/accept→commit immutable `SNAPSHOT/zhiju.integration.customer_input_manifest`。每行 entryId/ordinal/sourceRef/bytes hash/status，manifest 包括原 intake/ZIP ref、policy/extractor versions、实际不支持/损坏/读限。只在这些事实提交后 READY/PARTIAL；失败不能把未 link 的对象算 accepted。工序状态可变但 manifest/Entry validation/Receipt 不可改；resume 先同 intake Query/owner Receipt，重复上传异 bytes 拒绝；原包安全失败 zero dispatch。网络/解包不进入 EP 数据库事务。

Runtime real-profile 由公司选择锁定，specification 与 profile 接受集在 [Runtime 专节](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#d14--rd-01-准备分析-profile-提案)。IG 使用新的内部 preparation dispatch/readback/ingest producer，不扩展现有 public synthetic-only get_runtime_attempt_binding/get_runtime_final_observation 接受集。先存 Attempt 原 request+RuntimeBinding/Package hash+稳定键+lease/fencing，提交后调用原 CLI。真实 ack/session/CLI版本/Adapter身份由 Driver 原 invocation 观察形成，不能从报告 body 反推。timeout=UNKNOWN；原键禁止第二 invoke；当前 readback 若不能证实则保持 UNKNOWN，禁止用空 Result 补齐。

final outputs 保存原 JSON/Markdown/提取件 bytes 和 bounded immutable observation，绑定 original Attempt/Run/Contract/PreparationContext/Package/outputProfile/lease/fencing/session/actual observedAt。IG 内部 `readPreparationFinalObservation(attemptRef)` 在当前 SERVICE 授权下供 TE 读取精确 bytes/ref/hash/source=PROVIDER；TE 再判断当前可接纳性，EP 再判断业务报告。错来源/改 hash/错 Scope 拒绝且安全隔离，不以 new self-consistent JSON 修补；取消/lease 过期后 late observation 仅留历史，不显示 Run/report 成功。当前 v0.1 standalone 工具没有 Host acceptance，不能跳过 IG→TE→EP。

拟错误：`INTEGRATION_ZIP_LIMIT_EXCEEDED`、`INTEGRATION_ZIP_UNSAFE`、`INTEGRATION_ZIP_CORRUPT`、`INTEGRATION_NO_ANALYZABLE_SOURCE`、`INTEGRATION_PREPARATION_PROFILE_UNAVAILABLE`、`INTEGRATION_REPORT_BINDING_INVALID`；entry unsupported/read-limited 是合法部分输入，不伪装全读或全包安全成功。

## D14 Runner 物化锁与原调用观察提案（#256）

状态：`T2 / PROPOSED / HUMAN SELECTED 2026-10-09 / TECHNICAL APPROVAL PENDING / NOT REGISTERED / DEPLOYMENT NOT IMPLEMENTED / INTERNAL LOCK CONTRACT + PREFLIGHT IMPLEMENTED 2026-10-09 (#264, CONTRACT-ONLY)`。配置选择及 `d14.runner_execution_lock@1.0` 唯一见 [锁合同](../decisions/d14-rd01-runner-profile-lock.md#2-一个版本化锁合同与三个不同证据层)；IG不批准公司数据政策或解释Run控制。Package@1.1 preparation分支的内部lockId/version/hash进入materializationManifest、packageHash与invocationHash，不能向旧Package@1.0或synthetic Query暗加字段。

未来prepare dispatcher核approved config/reviewed SHA、actual deployment observation、每个exact pin、当前IP授权与数据准入；缺失/漂移/别名/fallback/未发布rule/tool pins零invoke。仅观察到Darwin安装不能形成Ubuntu runnable lock。该物化前判定已作为内部 `preflightD14RunnerMaterialization` 实现（`modules/integration-gateway/src/runtime/d14-runner-lock-preflight.ts`，Issue #264）：调用方必须提供 owning readback 事实（八项 boundary policy、五项 input/output owning 对象、prompt/tool-permission 组、PUBLISHED 模板/规则/启动规则/词表、完整 v0.2 证据工具 pin（codeRef/runtime/dependency/command）、Ubuntu/CLI/adapter/Host 完整部署观察（含适配器与 harness 身份/版本）、Provider 固定版本绑定/模型配置/身份-API-网络-数据策略共七个 pin 的完整 ref 读回、客户数据授权（含 dataPolicy 完整 ref 与到期）），缺失/占位/浮动别名/历史复制/#257 未发布事实任一成立即拒绝（嵌套 readback 或其 ref/receipt 缺失同样返回结构化拒绝与来源路径，不以异常退出），且每条 readback 必须携带与所锁 pin 相同的**完整 canonical Ref**（kind/type/id/version/snapshot/可选 `immutableVersionId`/Scope/hash）与发布 receipt，逐字段比对（含可选字段的有无一致）后才比较 content digest 与声明 bytes；未解析或身份不一致的必需 pin 一律拒绝。content-addressed policy pin 以 type+Scope+digest 为身份，其 readback 声明的 `version` 只做浮动别名拒绝，不与锁内字段比对。真实 dispatcher 接线与调用仍 `NOT RUN`。Host先durable保存Attempt/原key/hash/lock/Package/Run/lease/fencing与invoke-once intent，再spawn；重启只按原Attempt journal读ack/outputs，spawn与journal之间的不确定故障保持UNKNOWN，不能以“未找到Receipt”再次invoke。公开旧synthetic-only get_runtime_attempt_binding/get_runtime_final_observation接受集不变。

拟内部 `readPreparationControlObservation(attemptRef, observationRef)`：当前独立SERVICE读权，返回原不可变CONTENT_ADDRESSED `zhiju.integration.preparation_control_observation`（新类型未注册）。payload闭集为 `{observationId,attemptRef,runRef,packageRef,lockId,lockVersion,lockHash,runtimeAdapterIdentityRef,runtimeSessionRef,leaseId,fencingToken,kind,observedAt,source,details,rawEvidenceRef?,rawEvidenceBytesSha256?}`；canonical hash排除自身Ref/hash。kind/source/details采用封闭判别分支：HOST_HEARTBEAT/HOST_PROCESS（原cgroup存活+受信时间）、PROGRESS/CLI_PROTOCOL（phase与有限toolEventCount/safeSummaryCode）、USAGE/PROVIDER（既有RuntimeUsageRecord测量字段）、STOP_REQUESTED/HOST_PROCESS（原TE intentRef+signal）、LOCAL_PROCESS_STOPPED/HOST_PROCESS（全树退出/egress已封闭证明）、STOP_UNKNOWN/HOST_PROCESS（安全code）。未知分支/时间/缺实际来源/错误session拒绝；phase采用TE专节的三项闭集。LOCAL_PROCESS_STOPPED不是CANCEL_ACKNOWLEDGED，缺Provider计量不伪造0；已预分配实例/session不是ack证明。

每次观察绑定原成功ack/session/身份与原invocation的完整Scope/hash；支持原eventId同Hash重放，异Hash隔离。同Run多个真实control观察可以存在，但final仍最多一个identity；相同final/output hash重复返回原事实，异Hash第二final拒绝不覆盖。原JSON/MD/extraction bytes在工具成功后由Host停止写入、重新hash并不可变封存，IG保存实际objects/byte hashes和manifest/lock/outputProfile绑定；不从report中的self-ref或新计算的自洽JSON倒推来源。输出正文只在受控证据对象，不进入普通Event/日志；不持久化隐藏推理/system prompt/transcript。wronghash/alias等确定性拒绝由适用validator分层保存，IG不宣称业务理解正确。

取消control先验证TE已提交原Human CANCELLING intent、当前独立control与依赖读权，再对原Run sandbox操作；分别保存stop request、实际signal/全树观察。ACK不明维持STOP_UNKNOWN并让TE按自己期限裁决，IG不写TE表、不造CANCELLED。原lease到期后合法late final只封存历史，不成为可用Result/EP current report；消费历史观察需自身当前授权和完整原来源，不需恢复原执行Grant。run2的session/Context/fencing不得消费run1 final。原句柄不可证、依赖不通或无读权时fail closed，UNKNOWN不被重启/fallback/空final掩盖。

## D12 / Q11 Markdown 与导出技术边界提案（#260）

状态：`T2 / PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。所有业务清单/资格/许可只由 [REL §14](Module-Spec-006-ReleasePublication.md#14-d12--q11-项目交付批次与受控导出提案260) 拥有，不增加客户发送能力，不修改现有PublicationReceipt来源链。

1. Markdown Renderer 采用已批准 ART §13.5 / #259 的 `zhiju.markdown` / `text/markdown; charset=utf-8`，只经新 `integration.request_markdown_render@1.0` / `integration.get_markdown_render_binding@1.0` 与 `artifact.register_markdown_representation@1.0` 路径。旧 `request_render@1.0` / OOXML 接受集不变；本条早期 `document.markdown` 简写不构成第二种格式。未登记 rendererId/version、未知 required 结构或 input/output 绑定不一致均在成功登记前拒绝。D12 批次能力仍独立保持未实现。
2. 受控ZIP技术Port只接受已提交REL PackageRequest/Batch的精确输入和稳定Attempt identity；IG或存储Adapter只能报告staging/readback/finalize/UNKNOWN。生成清单、来源checksum、entry路径及ZIP版本遵守REL冻结输入，不能自行拼候选或改Manifest。lease/fence过期不能返回可晋升AVAILABLE的结果；UNKNOWN按同Attempt/object/version重读，不以新键盲目重建。
3. 对象存储写入与REL业务Link分开；API/BFF不直连存储，Adapter不写REL/QMS/ART Repository。原对象bytes/media/大小/version/CRC/checksum均须权威回读，URL/Token/raw Provider诊断不进入公开事件、日志或Descriptor。合法孤儿清理须先确认无业务reverse Link及满足retention/legal hold Policy。
4. Browser/服务器流响应不是formal Adapter Attempt + ExternalDeliveryRequest +成功RawReceipt链；不得调用record_publication_receipt，不产生PublicationSucceeded/ReleaseCompleted。真实HTTP/Renderer/对象存储/download和人工交付验收均NOT RUN，技术Attempt不拥有业务完成解释权。

## Markdown 建议、生成原输出与渲染提案（#259）

状态：T2 / APPROVED DESIGN；两项 Markdown render/binding 已由 #279 登记并实现，其余仍 PROPOSED / NOT IMPLEMENTED。仅传输/外部Attempt与真实原观察属于IG；业务意图属于TE，Canonical/Revision/Representation属于ART。支持边界见 [Markdown Delta](../decisions/markdown-file-feedback.md)，不扩展D14分析或已交付synthetic Runtime接口。

| 拟操作 / mode | closed payload | closed data / purpose |
|---|---|---|
| integration.request_markdown_suggestion_intake@1.0 / CREATE，OBJECT/zhiju.integration.markdown_suggestion_intake | workScopeRef、fileId、reviewBasisRef、declaredBaseRevisionRef、submittedCurrentRevisionRef、originalName、declaredByteLength、declaredBytesSha256 | intakeRef、单intake opaque uploadToken/expiry、receiptRef；integration.markdown_suggestion.intake / HUMAN_ONLY，绑定可信作者和一个文件，不接受locator/CLI/path |
| integration.get_markdown_suggestion_intake@1.0 / AUTHORITATIVE Query | intakeRef | originalPayloadHash、状态RECEIVING/SEALED/READY/UNSUPPORTED/UNSAFE/FAILED/UNKNOWN、suggestionRef?、actualByteLength/bytesSha256?、validationRefs、safeReasonCodes、receiptRefs、currentEligibility；integration.markdown_suggestion.read，仅本人Human或自身独立处理授权的TE SERVICE |
| integration.request_markdown_render@1.0 / CREATE，既有RenderAttempt类型 | revisionRef、canonicalContentRef、inputHash、outputFormat:zhiju.markdown、rendererId/rendererVersion、markdownProfileRef、structureSchemaRef、rendererDigest、identityMapHash | attemptRef/receiptRef/status；integration.render.request，专用SERVICE；独立新操作，不作为旧request_render的Minor扩展 |
| integration.get_markdown_render_binding@1.0 / AUTHORITATIVE Query | attemptRef | attemptRef/status、originalOperation:{type:integration.request_markdown_render,version:1.0}、originalRequest/requestPayloadHash、succeededResult?、rawReceiptRef?、markdownValidation?、sourceWatermarks；integration.markdown_render_binding.read |

依据共享API §9.1，新的flat closed payload、必填profile/schema/digest/identityMap及Markdown-only接受集采用新operation；不提出request_render@1.1。旧integration.request_render@1.0继续接受原{request:RenderRequest}，其中renderPolicyRef/stableIdempotencyKey/requestedAt及原格式、授权、Hash/幂等语义均不变；旧get_render_attempt_binding@1.0和worker不消费新Markdown Attempt。合法legacy请求在旧入口沿既有支持集处理，在新入口因shape不符拒绝；新Markdown请求只能走request_markdown_render@1.0，送旧入口拒绝，不自动包装/转换或fallback。新binding的originalOperation来自owning Attempt及真实提交Receipt，与originalRequest/hash逐项核验，不由caller声明；错operation/profile/schema/digest/identityMap/inputHash或失败/UNKNOWN不得产生successful Markdown binding或Representation。

Browser只传一个10MiB以内UTF-8 .md/.markdown原流至PUT /api/markdown-suggestion-intakes/{intakeId}/content，token放header；同Session/Origin/CSRF和可信peer边界，BFF不分析/存bytes/写对象存储。IG流式限制长度、原bytes hash、UTF-8、扩展/实际mediaType、安全扫描；断流/超限/不同bytes重放不得READY。原bytes写staging→实际readback→immutable link，object finalize不确定保持SEALED/UNKNOWN；查原intake不重新上传/派生新key。上传token仅传输资格，不代替当次项目/本人授权；文件名仅safe display，不推断Artifact/base身份。

READY产生SNAPSHOT/zhiju.integration.markdown_suggestion，closed {suggestionId,intakeRef,projectRef,workScopeRef,fileId,reviewBasisRef,declaredBaseRevisionRef,submittedCurrentRevisionRef,authorRef,rawObjectRef,byteLength,bytesSha256,mediaType,validationRefs,receivedAt}，Hash=cv1完整payload排除自身Ref/hash。rawObjectRef为内部locator，由当前SERVICE exact readback Port提供，不向Browser返回；suggestionRef不等于Revision。语法/canonical/位置映射最终归ART，READY仅安全完整接收，不证明改稿可无损接纳；UNSUPPORTED/UNSAFE保留隔离原件与明确原因、不安排处理。旧base由Human声明并核ART可见存在性，仍非可信编辑来源证明；传输/后续submit的current变更不能静默改写原snapshot。

生成采用独立拟file-generation profile：dispatch前真实持久化TE request/intent/Run/Contract/FileGenerationContext/Capability/lock、Attempt/key/invoke-once journal；部署的生成lock另行批准，不能从d14.analysis或#256选择推导。固定输入只读/单输出根，禁客户指令文件/工具加载。完成后停止写入并readback整份candidate.md、identity-map.json、processing-report.json；保存各自原bytes/hash/length与outputProfile。JSON拒重复key/尾随内容/非有限数值，身份映射与报告引用逐项绑定；原件md不重写换行后充当raw hash。

原final observation为CONTENT_ADDRESSED/zhiju.integration.file_generation_observation，closed {observationId,attemptRef,runRef,contractRef,contextRef,packageRef,toolchainLockRef,submittedIntentRef,fileSourceBindingRef,runtimeAdapterIdentityRef,runtimeSessionRef,leaseId,fencingToken,outputProfileRef,outputs,rawReceiptRef,observedAt,source:PROVIDER}。outputs恰上述三份对象role/ref/rawBytesSha256/byteLength，不接受自由输出路径。IG授权readFileGenerationObservation(attemptRef,observationRef)只供TE专用SERVICE读取完整原绑定/bytes；错session/Run/Scope/hash隔离，late/cancel/expiry只留历史，不补空Result或成功候选。新profile每Run最多一个final identity，同hash重放原事实、异hash拒绝，不last-write-wins。

Markdown render由已提交RenderAttempt读取exact ART FROZEN Canonical，固定profile/renderer/digest及identity map，确定性输出→再parse/canonicalize→Hash比对。成功Binding的succeededResult沿现有RenderSucceeded形状保持exactRevision/renderer/outputLocator/checksum；markdownValidation闭集 {profileRef,structureSchemaRef,rendererDigest,identityMapHash,inputContentHash,roundTripContentHash,outputBytesSha256,outputByteLength,validatorRef,outcome:PASS}。PASS只表示本profile技术round-trip；错误/UNKNOWN不得有成功binding，不把它当Quality Gate。ART独立核Binding后才register_markdown_representation，IG不能写ART表。

新bytes查询、观察与render绑定都独立当前授权，replay不复活过期执行Grant；日志/Event只存safe code/精确refs，不放客户正文、system prompt、推理或宿主路径。拟错误INTEGRATION_MARKDOWN_INTAKE_INVALID、INTEGRATION_MARKDOWN_UNSAFE、INTEGRATION_FILE_OUTPUT_BINDING_INVALID、INTEGRATION_MARKDOWN_RENDER_INVALID；不可见masked，依赖不可达UNKNOWN。真实Host/Provider/object store/HTTP/browser/人工均NOT RUN。

## 已实现的确定性 Markdown Renderer（#270）

状态：`T2 / IMPLEMENTED (#270) / SCOPE: 确定性渲染库`。本节只记录 #270 实际交付的 renderer；上文 #259 的建议 intake、原生成输出观察仍为 `NOT IMPLEMENTED / NOT RUN`；Markdown RenderAttempt/Binding 的当前实现见下文 #279，旧 `integration.request_render@1.0` 的 `{request:RenderRequest}` 接受集与旧 worker 不变。

- 已实现 profile：`MARKDOWN_RENDERER_PROFILE`，`outputFormat: zhiju.markdown`、`rendererId: zhiju.renderer.markdown.canonical`、`rendererVersion: 1.0.0`、`mediaType: text/markdown; charset=utf-8`、`contentType: STRUCTURED_DOCUMENT`。不新增策略 selector；#279 已将此固定实现接入专用 Markdown Attempt/Binding。
- 已实现入口：`renderMarkdownDocument(content)` 与 `renderMarkdownInline(text, spans)`。输入必须是封闭 `artifact.markdown_document.schema@1.0` payload（先经 `validateMarkdownDocumentContent`），否则 `INTEGRATION_RENDER_INPUT_MISMATCH`；无法在 canonical Markdown 表达的输入（例如前导空白）返回 `INTEGRATION_MARKDOWN_RENDER_INVALID`，不静默降级。
- 确定性契约：固定 LF 行尾、固定转义（``\ ` * | < > # = ~`` 与行首 marker，以及会读回成链接/图片/脚注的 `[^`/`](`/`![` 序列和 checkbox 样式列表项）、固定列表 marker（ORDERED 用 `orderedMarker`，UNORDERED 用 `-`）、固定三连字符分隔行与单空格 cell padding；同一 canonical tree 两次渲染字节与 checksum 相同。
- round-trip 边界：renderer 不解析、不校验身份；`parse(render(tree), authoritativeIdentityMap) = tree` 由 ART 的 `verifyMarkdownRoundTrip` 独立断言，任何差异拒整份文件。
- 已执行证据：见 [Module-Test-007 已实现子用例](../module-tests/Module-Test-007-IntegrationGateway.md#已实现的-markdown-renderer-技术子用例270) 与 [Module-Test-004](../module-tests/Module-Test-004-Artifact.md#已实现的-markdown-技术子用例270)；真实 Host/Provider/object store/HTTP/browser/人工仍 `NOT RUN`。


## 已实现的 Markdown RenderAttempt / Binding（#279）

`integration.request_markdown_render@1.0` 与 `integration.get_markdown_render_binding@1.0` 已登记。新操作使用上述 flat closed payload，原 `request_render@1.0` 的格式集、包装、worker 和旧 Binding 保持独立。两类 Attempt 不能互相消费。

请求先在 IG 同一事务提交原 Command Receipt、Attempt 与 Audit，再执行确定性渲染。Attempt 持久化 `original_operation`/`source_command_id`，Binding 从 owning 原 Receipt/请求/hash 读取；不接受 caller 自报 originalOperation。只有显式允许的 SERVICE Principal 能取得每个 purpose 的当前 IP Decision；Canonical 读与 ART 独立 round-trip 通过受权 owning Port 完成。

每个 Attempt 只能插入一次 immutable `markdown_render_work`。实际输出和原 receipt bytes 均 staging/readback；完整 round-trip 成功且在原 deadline 内的 observation 保存到 `markdown_render_output`，随后 finalize，最后提交 RawReceipt、SUCCEEDED 与 Outbox。异步操作有时间界限；超时、finalize/外部结果不确定保持 UNKNOWN。恢复显式查询原 Attempt，复用已持久化的对象版本与原 receipt，重新读回校验并完成 finalize；无合法原 observation 不重启渲染，不新建 Attempt 替代。FAILED/late 不能恢复成功。数据库只允许原命令、scope/hash 与输出观察一致的成功状态，app 不能 UPDATE/DELETE 原材料。

确定性 profile/renderer digest/identity map、实际 output sha256/byteLength、完整 Canonical round-trip hash 进入 `markdownValidation`。成功字段只允许 SUCCEEDED；其余状态没有可登记的表示。真实生产 Ceph/OpenBao、外部 Renderer/Host 仍为 NOT RUN；受控 PostgreSQL/对象存储与公共 HTTP/Browser 技术验收见 Module-Test-007 与 UI01。
