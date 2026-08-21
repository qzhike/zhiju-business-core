# Module-Test-007-IntegrationGateway

版本：v0.1
日期：2026-08-13（字段级 Schema 增补于 2026-08-18，2026-08-18 review 第一轮修复，2026-08-18 review 第二轮修复，Issue #17 运行时切片设计于 2026-08-21、实现于 2026-08-22）
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL PAYLOAD/EVENT/RESULT SCHEMAS LANDED 2026-08-18 / 9-CLASS REVIEW FIXES APPLIED 2026-08-18 / ISSUE #17 RUNTIME SLICE PASS 2026-08-22 / REAL HANDLER + ADAPTER + DB STILL NOT RUN / PR #16 NOT CLAIMING ISSUE #6`

对应规格：[`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

Feishu Channel 原始协议与现有 IntegrationGateway API 的专项映射测试见 [`Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md)。专项测试覆盖 32 个场景；4 个 Design Gate 已完成静态 `DESIGN VERIFIED`，其余 28 个真实飞书、Unit、Contract、E2E 与 Manual 均保持 `NOT RUN`。

Feishu 专项必须独立验证 `businessContextRefs/runtimeContextExternalRef` 的强弱引用边界，以及 `deliveryMode/replyToExternalRef` 的同 Binding 约束；这四个 optional minor 字段已随用户 2026-08-16 推进确认纳入 API v0.1 基准，但不改变本文件历史测试结果。

Runtime 原始协议与 IntegrationGateway API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项覆盖本地 CLI Process Driver、Dispatch、Event、Result、Usage、Cancel、Resume/Retry、Lease/Fencing 和 CLI Profile；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景保持 `NOT RUN`。

## Schema 级测试用例与结果（2026-08-18 落地，2026-08-18 review 第一至四轮修复）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-D-001 | Design | IntegrationGateway Module Spec 与 Catalog | 9 Command、5 Query、9 Event 名称/Owner/字段完整且无重复 | `commands=9 queries=5 events=9`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| IG-API-S-001 | Schema | 9 个 Command Payload Schema 与 Registry 解析 | 每个 Command 可由 Ajv 解析且必填字段闭合 | `registry.operationCount=200`；23 个 integration-gateway operation 全部标记 `FULL`；`pnpm contracts:check=PASS` | `PASS` |
| IG-API-S-002 | Schema | 5 个 Query Payload + 5 个 Result Schema 与 Registry 解析 | 每个 Query 的 Payload 与 Result Schema 均可由 Ajv 解析 | 5 个 Result（`channelBindingView` / 3 × `adapterAttemptView` / `adapterHealthPage`）注册；`get_adapter_health` Result 包含 `Page<AdapterHealthView>` 与 `ValueEnvelope<Duration>` latency | `PASS` |
| IG-API-S-003 | Schema | 9 个 Event Payload Schema 与 Registry 解析 | 每个 Event Payload 严格闭合，不接受敏感字段 | 9 个 Event 已注册并通过 Ajv 严格 required + `additionalProperties: false` 校验 | `PASS` |
| IG-API-S-004 | Schema | inbound envelope 提交携带 `duplicateOfSubmissionRef` 等伪去重字段 | Schema 闭合拒绝额外字段；**仅闭包测试，不构成 duplicate 验收** | `integration-accept-inbound-envelope-command-duplicate-hash.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-005 | Schema | 飞书普通文本 webhook body 泄露到 Event | Event Payload 闭合拒绝 `rawWebhookBody` | `integration-channel-delivery-failed-event-webhook-body-leak.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-006 | Schema | RenderSucceeded 中携带 presigned download URL | Event Payload 闭合拒绝 | `integration-render-succeeded-event-presigned-url.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-007 | Schema | InboundEnvelopeAccepted 携带 access token / app secret | Event Payload 闭合拒绝 | `integration-inbound-envelope-accepted-event-access-token-leak.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-008 | Schema | record_external_receipt.observedOutcome 非法值 | Ajv enum 拒绝非 `SUCCEEDED/FAILED/UNKNOWN` | `integration-record-external-receipt-command-illegal-observed-outcome.json` 触发 `enum` 错误 | `PASS` |
| IG-API-S-009 | Schema | quarantine_external_event 缺失 `observedHashes` | Ajv required 拒绝 | `integration-quarantine-external-event-command-missing-observed-hashes.json` 触发 `required` 错误 | `PASS` |
| IG-API-S-010 | Schema | request_runtime_resume 缺失 `continuationRef`（review P1） | Ajv allOf overlay 强制 `continuationRef` required | `integration-request-runtime-resume-command-missing-continuation.json` 触发 `required/continuationRef` | `PASS` |
| IG-API-S-011 | Schema | request_runtime_cancel 缺失 `continuationRef`（review P1 对照） | 取消允许省略，复用同一 fixture 时必须 valid | 同 fixture 改 `commandType` 后在 `request_runtime_cancel` 下 valid=true | `PASS` |
| IG-API-S-012 | Schema | request_feishu_delivery `deliveryMode=REPLY` 但缺 `replyToExternalRef`（review P1） | if/then 约束 REPLY/REPLY_IN_THREAD 必须携带 | `integration-request-feishu-delivery-command-reply-missing-reply-to.json` 触发 `required/replyToExternalRef` | `PASS` |
| IG-API-S-013 | Schema | request_feishu_delivery `deliveryMode=REPLY_IN_THREAD` 但缺 `replyToExternalRef`（review P1） | 同上，REPLY_IN_THREAD 也被覆盖 | `integration-request-feishu-delivery-command-reply-in-thread-missing-reply-to.json` 触发 `required/replyToExternalRef` | `PASS` |
| IG-API-S-014 | Schema | request_feishu_delivery `deliveryMode=NEW_MESSAGE` 缺 `replyToExternalRef`（review P1 对照） | NEW_MESSAGE 仍允许省略 | 同 fixture 改 `deliveryMode` 后 valid=true | `PASS` |
| IG-API-S-015 | Schema | bind_channel_context `businessContextRefs` 包含飞书 message ExternalRef（review P1） | 专用 union 禁止 ExternalRef / Runtime Session / workspace path | `integration-bind-channel-context-command-external-ref-leak.json` 触发 `oneOf` + `additionalProperties` 错误 | `PASS` |
| IG-API-S-016 | Schema | bind_channel_context `businessContextRefs` 携带 `identity.principal` 等非白名单 objectType（review P1 第二轮） | per-kind objectType 白名单拒绝非业务类型 | 同 fixture 改 objectType 后 valid=false | `PASS` |
| IG-API-S-017 | Schema | bind_channel_context `businessContextRefs` 携带 `release.release` 等白名单 objectType | 同上白名单接受 | 同 fixture 改 objectType 后 valid=true | `PASS` |
| IG-API-S-018 | Schema | get_adapter_health result.latency.value 为 number 而非 ISO 8601 Duration（review P1 第二轮） | `valueEnvelopeDuration` 拒绝非 Duration | 改为 `value:42` 后 valid=false | `PASS` |
| IG-API-S-019 | Schema | get_adapter_health result.latency.value 为非法 ISO 8601 Duration | 同上拒绝 | 改为 `value:"not-a-duration"` 后 valid=false | `PASS` |
| IG-API-S-020 | Schema | get_adapter_health adapterCodes 为空数组（review P2 第三轮） | Set 允许空（语义由 Handler 维护） | empty list 后 valid=true | `PASS` |
| IG-API-S-021 | Schema | get_adapter_health adapterCodes 含重复项（review P2 第三轮） | Set 唯一性强制 uniqueItems | `['feishu.channel','feishu.channel']` 触发 `uniqueItems` 错误 | `PASS` |

[`contracts/src/operations/integration-gateway.schema.test.ts`](../../contracts/src/operations/integration-gateway.schema.test.ts) 当前共 35 个 focused tests，覆盖 23 个 operation 的 Happy-path、5 个 Query Result、Schema 维度负向 fixture 与 review 边界；本次 `pnpm verify` 全量为 16 个测试文件、317 个测试通过。

review 同时指出本次 PR 不足以声称 Issue #6 全部 8 条验收完成：

- 第 3 条（Inbound/Outbound/Attempt/Receipt 字段语义）通过 `IG-API-S-001..S-015` 的 Schema 闭合证明，但运行时 `stableIdempotencyKey` dedup、`observedAt` 时序、`replyToExternalRef` 同 Binding 归属仍为 `NOT RUN`；
- 第 4 条（fixtures 覆盖重复、撤回、权限失败、UNKNOWN delivery outcome）中的本地纯运行时子集已由 Issue #17 的 U-001/U-002/U-003/U-004/U-005 推进为 `PASS`；真实飞书/Runtime/数据库/E2E 的撤回、权限和外部回执仍为 `NOT RUN`；
- 第 5 条（敏感字段负向）在 Schema 层 11 个 fixture 与 Issue #17 U-006 的三类运行时拒绝均为 `PASS`；真实 Provider 日志/审计管线的外部安全审查仍为 `NOT RUN`。

## Issue #17 运行时切片测试结果（2026-08-22）

以下测试直接对应 Issue #17 的本地可验证关闭条件。结果来自 `modules/integration-gateway/src/integration-gateway-runtime.test.ts` 的当前执行。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-U-004 | Unit | 已接收消息随后收到撤回事件 | Origin 为 `WITHDRAWN`；原 InboundEnvelope/字节引用保留 | receive envelope 与 recall envelope 均保留；late receive 不恢复 `ACTIVE` | `PASS` |
| IG-API-U-005 | Unit | 已绑定 Project A 的成员请求 Project B，显式 Authorization Port 返回 DENY | 在 IntegrationGateway 入口拒绝；Binding 不产生权限 | 同 Scope 进入 `INTEGRATION_CHANNEL_MEMBER_NOT_AUTHORIZED`；跨 Project 进入 `INTEGRATION_CHANNEL_BINDING_SCOPE_MISMATCH`；未调用跨 Scope Authz Port | `PASS` |
| IG-API-U-006 | Unit | Audit 候选输入分别携带 access token、app secret、webhook body | 三类敏感输入均被拒绝；安全诊断不保存原值 | 三类输入均为 `INTEGRATION_SENSITIVE_DATA_REJECTED`；安全 metadata 可记录且不落原 metadata | `PASS` |

## API Test 维度结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-U-001 | Unit | same external event ID + same Hash 三次 | 返回同一 Envelope/处理结果；只调用一次等价业务 Command | dispatch callback 仅执行 1 次；三次结果复用首个 Envelope | `PASS` |
| IG-API-U-002 | Unit | same external event ID + different Hash | 首个 Envelope 不变；新事件 Quarantine | 首个 Envelope 保留；Hash 冲突生成 1 条 Quarantine；后续同 Hash 重放仍返回首个 Envelope | `PASS` |
| IG-API-U-003 | Unit | Runtime/Channel external call timeout | Attempt 为 UNKNOWN，不报告 FAILED/SUCCEEDED | timeout 后为 `UNKNOWN` + `INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN`；稳定键重放不再次调用 Provider | `PASS` |
| IG-API-C-001 | Contract | Inbound 未知 Major 或未知 required extension | Quarantine，不猜测映射，不写业务状态 | 未知 Major 与未知 required extension 均 Quarantine；dispatch callback 为 0 次 | `PASS` |
| IG-API-C-002 | Contract | RenderSucceeded 的 inputHash、完整内容寻址 revision 或 renderer 不匹配 Request | Artifact 不登记 Representation，记录 mismatch | inputHash、revision contentHash/immutableVersionId 或 renderer mismatch 均为 `INTEGRATION_RENDER_INPUT_MISMATCH`，Representation registration 为 0；匹配输入通过 | `PASS` |
| IG-API-E-001 | E2E | InformationRequest 卡片发出、授权回答、重复回调 | 一个 Answer Candidate/Submission；未授权成员被拒绝；不重复恢复 WorkOrder | 无飞书实现 | `NOT RUN` |
| IG-API-E-002 | E2E | Attempt 提交后进程崩溃并重放 | 复用稳定 key；不重复不可控副作用；Receipt 可补记 | 无 Adapter/Persistence | `NOT RUN` |
| IG-API-M-001 | Manual | 飞书/Runtime/Render 脱敏协议 Fixture | 审核者能看到 ExternalRef→Envelope/Attempt→Raw Receipt→业务 Command 的边界 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 维度：`PASS`，`pnpm verify` 中 format / lint / typecheck / Vitest 317 个测试 / 架构边界 / Catalog 对账共 6 项 Gate 全部通过；2026-08-18 review 第一轮 3 个 P1 inline（Resume required `continuationRef` / `replyToExternalRef` conditional / `businessContextRefs` no ExternalRef）已修复；第二轮 4 个 P1（`ChannelBindingView.status` 用错 enum / `latency` 未收紧为 `ValueEnvelope<Duration>` / `businessContextRefs` 缺 objectType 白名单 / duplicate 用例不构成验收）与 2 个 P2（`attachmentRefs`/`conflictRefs` 过紧 uniqueItems / `adapterCodes` 过紧 NonEmptySet）已修复；第三轮恢复 `adapterCodes` 的 Set 唯一性并通过 S-020/S-021 成对回归；第四轮已同步设计计划与本测试文档的契约及验证证据。duplicate fixture 仍仅作为 Schema 闭包回归，U-002 已在 runtime focused test 中证明运行时首事实保留与 Quarantine。
- Issue #17 运行时切片：U-001/U-002/U-003/U-004/U-005/U-006、C-001/C-002 均为 `PASS`；focused file 共 9 个测试（C-001 参数化为两个 Provider 拒绝场景），覆盖幂等、Hash 冲突、UNKNOWN、协议拒绝、Render 绑定、撤回、显式权限拒绝和 Audit/Masking。
- 真实 Handler、Repository、Adapter、Database、E2E、External、Manual：继续 `NOT RUN`；本次实现不声称 Issue #6 全部 8 条验收完成，PR #16 不再 `Closes #6`，未覆盖边界由 [Issue #17](https://github.com/qzhike/zhiju-business-core/issues/17) 追踪。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- Feishu Channel 专项：`DESIGN VERIFIED / USER PROGRESSION CONFIRMED 2026-08-16`；不得据此更改本文件 9 个 API 基准用例的历史状态。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 additive TaskExecution Command proposal 未进入 Catalog。
- 测试遗留：Schema focused tests 当前为 35/35，Issue #17 runtime focused tests 为 9/9；2026-08-18 review 修复期间新增的临时调试文件 `tests/integration-debug.test.ts` 已删除；本地无临时测试脚本或测试文件。
