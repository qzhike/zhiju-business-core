# IM-01 IntegrationGateway 23 操作字段级契约 - 实施计划

版本：v0.1
日期：2026-08-18
任务：完成 GitHub issue #6

## 1. 目标

把 `contracts/registry/public-api.v1.json` 中 integration-gateway 模块下的 23 个 ENVELOPE_ONLY 操作升级为 FULL，并提供：

- 9 个 Command Payload Schema
- 5 个 Query Payload Schema + 5 个 Query Result Schema
- 9 个 Event Payload Schema

覆盖的字段域：External Identity / Binding、Inbound Envelope、Attachment / ExternalRef、Outbound Intent、Destination、Attempt、Receipt、Recall / withdrawal、UNKNOWN delivery outcome。

## 2. 核心不变量与负向约束

1. IntegrationGateway 是 Anti-Corruption Layer：所有入站先认证、Hash、Claim、规范化；Event 仅报告外部事实与适配结果。
2. `externalEventRef` 为 Provider 语义幂等键（飞书 `im.message.receive_v1` 用 `app + tenant + message_id`），不等于传输事件头 ID。
3. `observedOutcome` 仅允许 `SUCCEEDED / FAILED / UNKNOWN`，`UNKNOWN` 用于超时；任何超时不得报 FAILED 或 SUCCEEDED。
4. `attemptStatus` 含 `UNKNOWN`、`QUARANTINED`；终态枚举保持闭合。
5. Channel Binding 是路由上下文，不授予 Enterprise / Project 权限；普通飞书文本 / 文件不自动形成 Approval / Release / Completion。
6. `stableIdempotencyKey` 强制存在；`requestPayloadHash` 与 `receiptPayloadHash` 强制 SHA-256 内容哈希。
7. Runtime Session / Continuation 只是受控 ExternalRef，不参与身份、权限或业务对象相等性。
8. 严格闭包：`additionalProperties: false`；access token、app secret、原始 credential、未脱敏联系方式、任意 webhook body 不得进入普通 Event / Error。
9. `deliveryMode` 缺省视为 `NEW_MESSAGE`；`REPLY/REPLY_IN_THREAD` 仅作 optional minor 字段（Feishu Channel v0.1 已推进确认纳入基准）。

## 3. 公共类型与本地定义

参考 quality-governance / release-publication 模式。命名以模块内 `$defs/<name>` 暴露：

```
inboundEnvelopeSubmission    -> InboundEnvelopeSubmission
channelBindingDefinition     -> ChannelBindingDefinition
feishuDeliveryRequest        -> FeishuDeliveryRequest
runtimeDispatchRequest       -> RuntimeDispatchRequest
runtimeControlRequest        -> RuntimeControlRequest
renderRequest                -> RenderRequest
rawReceiptSubmission         -> RawReceiptSubmission
quarantineDefinition         -> QuarantineDefinition

channelBindingView           -> ChannelBindingView
adapterAttemptView           -> AdapterAttemptView
adapterHealthView            -> AdapterHealthView
adapterHealthPage            -> Page<AdapterHealthView>
```

Enum：
- `adapterKind`：`FEISHU_CHANNEL | RUNTIME | RENDERER | OBJECT_STORAGE | EXTERNAL_AUTHORITY`
- `attemptStatus`：`CREATED | DISPATCHABLE | CLAIMED | IN_FLIGHT | SUCCEEDED | FAILED | UNKNOWN | CANCELLED | QUARANTINED`
- `inboundStatus`：`ACCEPTED | REJECTED | QUARANTINED`
- `adapterObservedStatus`：`HEALTHY | DEGRADED | UNAVAILABLE | UNKNOWN`
- `deliveryMode`：`NEW_MESSAGE | REPLY | REPLY_IN_THREAD`
- `observedOutcome`：`SUCCEEDED | FAILED | UNKNOWN`
- `failureOutcome`：`FAILED | UNKNOWN`（用于 Succeeded/Failed 终态事件 outcome 字段）

Object Locator：复用 artifact / quality 模式 `^[a-z0-9][a-z0-9._-]*(?:/[A-Za-z0-9._-]+)+$`。

## 4. Operation Payload 字段约束

### 4.1 Command Payload

| Operation | Required Payload Fields |
|---|---|
| `accept_inbound_envelope` | `submission: InboundEnvelopeSubmission` |
| `bind_channel_context` | `definition: ChannelBindingDefinition; bindingDecisionRef: ContentAddressedRef<BusinessDecision>` |
| `request_feishu_delivery` | `request: FeishuDeliveryRequest` |
| `request_runtime_dispatch` | `request: RuntimeDispatchRequest` |
| `request_runtime_cancel` | `request: RuntimeControlRequest`（continuationRef optional） |
| `request_runtime_resume` | `request: RuntimeControlRequest`（continuationRef required） |
| `request_render` | `request: RenderRequest` |
| `record_external_receipt` | `receipt: RawReceiptSubmission` |
| `quarantine_external_event` | `definition: QuarantineDefinition` |

### 4.2 Query Payload / Result

| Operation | Payload | Result |
|---|---|---|
| `get_channel_binding` | `bindingRef?; adapterCode?; accountExternalRef?; channelExternalRef?; threadOrTopicExternalRef?; purpose` | `ChannelBindingView` |
| `get_delivery_attempt` | `attemptRef` | `AdapterAttemptView` |
| `get_runtime_attempt` | `attemptRef` | `AdapterAttemptView` |
| `get_render_attempt` | `attemptRef` | `AdapterAttemptView` |
| `get_adapter_health` | `adapterCodes: Set<NamespaceCode>; observedAfter?; page` | `Page<AdapterHealthView>`（含 `ValueEnvelope<Duration>` latency） |

### 4.3 Event Payload

| Event | Payload |
|---|---|
| `InboundEnvelopeAccepted` | `inboundEnvelopeRef; adapterCode; externalEventRef; resolvedPrincipalRef?; targetCommandRef?` |
| `InboundEnvelopeRejected` | `inboundEnvelopeRef?; adapterCode; externalEventRef; reasonCode; quarantineRef?` |
| `ChannelAnswerReceived` | `inboundEnvelopeRef; channelBindingRef; informationRequestRef; responderRef; normalizedAnswerRef; sourceExternalRef` |
| `ChannelDeliverySucceeded` | `attemptRef; sourceBusinessRef; destinationBindingRef; rawReceiptRef; occurredAt` |
| `ChannelDeliveryFailed` | `attemptRef; sourceBusinessRef; destinationBindingRef?; outcome: FAILED\|UNKNOWN; reasonCode; rawReceiptRef?` |
| `RuntimeDispatchSucceeded` | `attemptRef; workOrderRef; runRef; runtimeSessionRef; rawReceiptRef` |
| `RuntimeDispatchFailed` | `attemptRef; workOrderRef; runRef; outcome: FAILED\|UNKNOWN; reasonCode` |
| `RenderSucceeded` | `attemptRef; revisionRef; outputObjectRef; outputChecksum; rendererId; rendererVersion; rawReceiptRef` |
| `RenderFailed` | `attemptRef; revisionRef; outcome: FAILED\|UNKNOWN; reasonCode; rendererId; rendererVersion` |

## 5. 修改清单

1. 新建 `contracts/src/operations/integration-gateway.schema.ts`
2. 新建 `contracts/src/operations/integration-gateway.schema.test.ts`（覆盖 9 Command + 5 Query/Result + 9 Event Happy-path + 6 个 Schema 维度负向 Fixture 断言）
3. 新建 6 个负向 Fixture：
   - `tests/fixtures/contracts/integration-accept-inbound-envelope-command-duplicate-hash.json`
   - `tests/fixtures/contracts/integration-channel-delivery-failed-event-webhook-body-leak.json`
   - `tests/fixtures/contracts/integration-render-succeeded-event-presigned-url.json`
   - `tests/fixtures/contracts/integration-inbound-envelope-accepted-event-access-token-leak.json`
   - `tests/fixtures/contracts/integration-record-external-receipt-command-illegal-observed-outcome.json`
   - `tests/fixtures/contracts/integration-quarantine-external-event-command-missing-observed-hashes.json`
4. 修改 `contracts/src/operations/index.ts`：导入并导出新 schema，加入 `executableOperationSchemas`
5. 修改 `tools/contracts/check-catalog.mjs`：把 `integration-gateway` 加入 `implementedOwners`
6. 修改 `contracts/registry/public-api.v1.json`：23 个 integration-gateway operation `schemaStatus: ENVELOPE_ONLY → FULL`
7. 修改 `contracts/src/registry.test.ts`：FULL 数量 177 → 200，新增 integration-gateway 模块分布断言，把 "does not claim executable result schemas for unfinished modules" 替换为对未知 operation type 的拒绝断言
8. 重新运行 `pnpm contracts:generate` 生成 `contracts/src/generated/public-api.ts`
9. 同步更新权威文档：`README.md` 列出 IntegrationGateway 23 个 FULL；`HL-Spec.md` §7 / §11 同步 IntegrationGateway 字段级 Schema 落地；`Module-Spec-007` §9 状态行；`Module-Test-007` 增加 Schema 维度 PASS 用例与结果表

## 6. 验证结果

```text
pnpm clean
pnpm verify
- prettier --check .                              => All matched files use Prettier code style!
- eslint .                                        => no errors
- tsc -b --pretty false                           => no errors
- vitest run                                      => 204 / 204 passed
- node tools/architecture/check-boundaries.mjs    => architecture_boundaries=PASS source_roots=10
- node tools/contracts/generate-public-api.mjs --check
  && node tools/contracts/check-catalog.mjs       => public_api_generation=PASS operations=200
                                                  => catalog_registry=PASS catalog=200 registry=200
                                                     schema_status={"FULL":200}
```

## 7. 范围限定与未执行项

本 Issue 不实现：

- Handler / Repository / Persistence / Migration；
- 真实飞书 Adapter / Runtime Adapter / Renderer Adapter；
- Webhook server / Outbox / Retry worker / Credential management；
- 6 个 additive TaskExecution Command proposal（来自 Runtime Adapter v0.1，未进入 Catalog）；
- IM-DG-005 / IM-DG-006 仍待独立审核。

不变量与持久化边界仍只由 `Module-Spec-007` §7 维护，Schema 层只确保结构闭合、enum 闭合、`additionalProperties: false` 与显式 required 字段集合。运行时去重、UNKNOWN 升级、超时与 Recall 路径的真正判定仍为 `NOT RUN`。
