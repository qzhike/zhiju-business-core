# Module-Test-007-IntegrationGateway

版本：v0.1
日期：2026-08-13（字段级 Schema 增补于 2026-08-18）
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL PAYLOAD/EVENT/RESULT SCHEMAS LANDED 2026-08-18 / HANDLER + ADAPTER + DB STILL NOT RUN`

对应规格：[`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

Feishu Channel 原始协议与现有 IntegrationGateway API 的专项映射测试见 [`Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md)。专项测试覆盖 32 个场景；4 个 Design Gate 已完成静态 `DESIGN VERIFIED`，其余 28 个真实飞书、Unit、Contract、E2E 与 Manual 均保持 `NOT RUN`。

Feishu 专项必须独立验证 `businessContextRefs/runtimeContextExternalRef` 的强弱引用边界，以及 `deliveryMode/replyToExternalRef` 的同 Binding 约束；这四个 optional minor 字段已随用户 2026-08-16 推进确认纳入 API v0.1 基准，但不改变本文件历史测试结果。

Runtime 原始协议与 IntegrationGateway API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项覆盖本地 CLI Process Driver、Dispatch、Event、Result、Usage、Cancel、Resume/Retry、Lease/Fencing 和 CLI Profile；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景保持 `NOT RUN`。

## Schema 级测试用例与结果（2026-08-18 落地）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-D-001 | Design | IntegrationGateway Module Spec 与 Catalog | 9 Command、5 Query、9 Event 名称/Owner/字段完整且无重复 | `commands=9 queries=5 events=9`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| IG-API-S-001 | Schema | 9 个 Command Payload Schema 与 Registry 解析 | 每个 Command 可由 Ajv 解析且必填字段闭合 | `registry.operationCount=200`；23 个 integration-gateway operation 全部标记 `FULL`；`pnpm contracts:check=PASS` | `PASS` |
| IG-API-S-002 | Schema | 5 个 Query Payload + 5 个 Result Schema 与 Registry 解析 | 每个 Query 的 Payload 与 Result Schema 均可由 Ajv 解析 | 5 个 Result（`channelBindingView` / 3 × `adapterAttemptView` / `adapterHealthPage`）注册；`get_adapter_health` Result 包含 `Page<AdapterHealthView>` 与 `ValueEnvelope<Duration>` latency | `PASS` |
| IG-API-S-003 | Schema | 9 个 Event Payload Schema 与 Registry 解析 | 每个 Event Payload 严格闭合，不接受敏感字段 | 9 个 Event 已注册并通过 Ajv 严格 required + `additionalProperties: false` 校验 | `PASS` |
| IG-API-S-004 | Schema | duplicate inbound envelope（same external event id + payload hash） | 严格闭合拒绝携带 `duplicateOfSubmissionRef` 等额外字段 | `integration-accept-inbound-envelope-command-duplicate-hash.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-005 | Schema | 飞书普通文本 webhook body 泄露到 Event | Event Payload 闭合拒绝 `rawWebhookBody` | `integration-channel-delivery-failed-event-webhook-body-leak.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-006 | Schema | RenderSucceeded 中携带 presigned download URL | Event Payload 闭合拒绝 | `integration-render-succeeded-event-presigned-url.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-007 | Schema | InboundEnvelopeAccepted 携带 access token / app secret | Event Payload 闭合拒绝 | `integration-inbound-envelope-accepted-event-access-token-leak.json` 触发 `additionalProperties` 错误 | `PASS` |
| IG-API-S-008 | Schema | record_external_receipt.observedOutcome 非法值 | Ajv enum 拒绝非 `SUCCEEDED/FAILED/UNKNOWN` | `integration-record-external-receipt-command-illegal-observed-outcome.json` 触发 `enum` 错误 | `PASS` |
| IG-API-S-009 | Schema | quarantine_external_event 缺失 `observedHashes` | Ajv required 拒绝 | `integration-quarantine-external-event-command-missing-observed-hashes.json` 触发 `required` 错误 | `PASS` |

23 个 Schema 维度 Happy-path（9 Command + 5 Query Payload + 5 Query Result + 9 Event）已在 [`contracts/src/operations/integration-gateway.schema.test.ts`](../../contracts/src/operations/integration-gateway.schema.test.ts) 中覆盖；`pnpm test` 全量 204 个测试通过。

## API Test 维度结果（不变更）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-U-001 | Unit | same external event ID + same Hash 三次 | 返回同一 Envelope/处理结果；只调用一次等价业务 Command | 无 Handler / Repository | `NOT RUN` |
| IG-API-U-002 | Unit | same external event ID + different Hash | 首个 Envelope 不变；新事件 Quarantine | 无 Handler / Repository | `NOT RUN` |
| IG-API-U-003 | Unit | Runtime/Channel external call timeout | Attempt 为 UNKNOWN，不报告 FAILED/SUCCEEDED | 无 Adapter | `NOT RUN` |
| IG-API-C-001 | Contract | Inbound 未知 Major 或未知 required extension | Quarantine，不猜测映射，不写业务状态 | 无 Adapter | `NOT RUN` |
| IG-API-C-002 | Contract | RenderSucceeded 的 inputHash/revision/renderer 不匹配 Request | Artifact 不登记 Representation，记录 mismatch | 无 Repository / Renderer | `NOT RUN` |
| IG-API-E-001 | E2E | InformationRequest 卡片发出、授权回答、重复回调 | 一个 Answer Candidate/Submission；未授权成员被拒绝；不重复恢复 WorkOrder | 无飞书实现 | `NOT RUN` |
| IG-API-E-002 | E2E | Attempt 提交后进程崩溃并重放 | 复用稳定 key；不重复不可控副作用；Receipt 可补记 | 无 Adapter/Persistence | `NOT RUN` |
| IG-API-M-001 | Manual | 飞书/Runtime/Render 脱敏协议 Fixture | 审核者能看到 ExternalRef→Envelope/Attempt→Raw Receipt→业务 Command 的边界 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 维度：`PASS`，`pnpm verify` 中 format / lint / typecheck / Vitest 204 个测试 / 架构边界 / Catalog 对账共 6 项 Gate 全部通过。
- Unit/Contract/E2E/Manual：`NOT RUN`，原因是 Handler、Repository、Adapter、Database 与人工业务验收尚未实现。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- Feishu Channel 专项：`DESIGN VERIFIED / USER PROGRESSION CONFIRMED 2026-08-16`；不得据此更改本文件 9 个 API 基准用例的历史状态。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 additive TaskExecution Command proposal 未进入 Catalog。
- 测试遗留：本次新增 6 个负向 Fixture 与 23 个 Schema 测试，本地无遗留脚本。
