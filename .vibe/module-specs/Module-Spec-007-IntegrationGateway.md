# Module-Spec-007-IntegrationGateway

版本：v0.1
日期：2026-08-16
状态：`CURRENT MODULE CONTRACT BASELINE / FEISHU OPTIONAL MINOR ACCEPTED / RUNTIME USER PROGRESSION CONFIRMED / IMPLEMENTATION PLAN DRAFT / APPLICATION CODE NOT STARTED`

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
| `integration.get_adapter_health@1.0` | P | `adapterCodes: Set<NamespaceCode>; observedAfter?: UtcInstant; page: PageRequest` | `Page<AdapterHealthView>`；Health 不代表业务动作成功 |

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

## 8. 可人工验收的模块产出

里程碑 `API-IG-01` 的人工产出是三组脱敏 Fixture：同一飞书事件重复三次只形成一个 Envelope/Command；相同 event ID 不同 Hash 进入 Quarantine；InformationRequest 卡片回答形成规范化 Answer Candidate，但未授权成员与普通“可以”不会形成 Approval；外部 timeout 保持 UNKNOWN。这里只验证 Anti-Corruption Contract，不代表真实飞书、Runtime 或 Renderer 已运行。

## 9. 当前状态

- 23 个公开 Contract 已定义字段级 payload/result/event 结构；
- API v0.1 已于 2026-08-13 通过用户审核并成为字段级基准；
- Feishu Channel Contract v0.1 已完成静态 `DESIGN VERIFIED`，四个 optional minor 字段已随用户推进确认纳入基准；Runtime Adapter Contract v0.1 已获用户推进确认并进入 Implementation Milestone Plan，Renderer Adapter、Credentials、Persistence 与测试实现均不存在；
- 对应 Unit、Contract、E2E 与人工验收均为 `NOT RUN`。
