# Module-Test-007-IntegrationGateway

版本：v0.3
日期：2026-09-01（字段级 Schema 增补于 2026-08-18，Issue #17 运行时切片实现于 2026-08-22，WI-01 Binding Query 回归于 2026-08-28，IM-05 WI-05 本地 Renderer/Persistence/Openability 验证于 2026-08-30，Issue #24 formal Adapter Attempt Query Port 本地技术验证于 2026-09-01）
状态：`API CONTRACT TEST BASELINE / WI-01 ADDITIVE BINDING QUERY CONTRACT REGRESSION PASS / ISSUE #17 RUNTIME SLICE PASS / IM-05 WI-05 UNIT + CONTRACT + PERSISTENCE + LOCAL OFFICE OPENABILITY + GIT DELIVERY PASS / PR #135 MERGED / ISSUE #125 CLOSED / ISSUE #24 FORMAL ADAPTER ATTEMPT QUERY PORT AND INDEPENDENT AUTHORITY COMPOSITION PASS IN PR #147 / EXACT-HEAD CI PASS / ISSUE #24 CLOSED / REAL EXTERNAL PROVIDER + PRODUCTION + INDEPENDENT BUSINESS ACCEPTANCE NOT RUN`

对应规格：[`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

Feishu Channel 原始协议与现有 IntegrationGateway API 的专项映射测试见 [`Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md)。专项测试覆盖 32 个场景；4 个 Design Gate 已完成静态 `DESIGN VERIFIED`，其余 28 个真实飞书、Unit、Contract、E2E 与 Manual 均保持 `NOT RUN`。

Feishu 专项必须独立验证 `businessContextRefs/runtimeContextExternalRef` 的强弱引用边界，以及 `deliveryMode/replyToExternalRef` 的同 Binding 约束；这四个 optional minor 字段已随用户 2026-08-16 推进确认纳入 API v0.1 基准，但不改变本文件历史测试结果。

Runtime 原始协议与 IntegrationGateway API 的专项映射测试见 [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md)。专项覆盖本地 CLI Process Driver、Dispatch、Event、Result、Usage、Cancel、Resume/Retry、Lease/Fencing 和 CLI Profile；4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景保持 `NOT RUN`。

## Schema 级测试用例与结果（2026-08-18 落地，2026-08-18 review 第一至四轮修复）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-D-001 | Design | IntegrationGateway Module Spec 与 Catalog | 9 Command、6 Query、9 Event 名称/Owner/字段完整且无重复 | `commands=9 queries=6 events=9`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| IG-API-S-001 | Schema | 9 个 Command Payload Schema 与 Registry 解析 | 每个 Command 可由 Ajv 解析且必填字段闭合 | `registry.operationCount=201`；24 个 integration-gateway operation 全部标记 `FULL` | `PASS` |
| IG-API-S-002 | Schema | 6 个 Query Payload + 6 个 Result Schema 与 Registry 解析 | 每个 Query 的 Payload 与 Result Schema 均可由 Ajv 解析 | `RenderAttemptBindingView` 已注册；6 个 Query Result 均有可执行 Schema | `PASS` |
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
| IG-API-S-022 | Schema | `integration.get_render_attempt_binding@1.0` 携带原始 Request、request hash、成功 Result 与 raw receipt | Binding Result 可由 Ajv 解析，成功状态必须携带成功结果和 receipt | `integration-render-attempt-binding-result-valid.json` 与 Query Envelope 均 `valid=true` | `PASS` |
| IG-API-S-023 | Schema | Binding Result 携带 credentials/Presigned URL、缺少成功结果或 FAILED 状态携带成功结果 | `additionalProperties`、`required` 或 `false schema` 拒绝；未知 Binding major 由 Registry 拒绝 | 4 类负向变体分别触发预期错误；`2.0` 触发 `operationRegistry` | `PASS` |

[`contracts/src/operations/integration-gateway.schema.test.ts`](../../contracts/src/operations/integration-gateway.schema.test.ts) 与 [`contracts/src/canonical-content.test.ts`](../../contracts/src/canonical-content.test.ts) 已覆盖 24 个 operation 的 Registry 对账、6 个 Query Result、Binding Secret/状态负向 fixture 与既有通用 Attempt Query 兼容性；全量 `pnpm test` 为 `25 个测试文件 PASS / 17 个 skipped`、`363 passed / 241 skipped`。

review 同时指出本次 PR 不足以声称 Issue #6 全部 8 条验收完成：

- 第 3 条（Inbound/Outbound/Attempt/Receipt 字段语义）通过 `IG-API-S-001..S-015` 的 Schema 闭合证明，但运行时 `stableIdempotencyKey` dedup、`observedAt` 时序、`replyToExternalRef` 同 Binding 归属仍为 `NOT RUN`；
- 第 4 条（fixtures 覆盖重复、撤回、权限失败、UNKNOWN delivery outcome）中的本地纯运行时子集已由 Issue #17 的 U-001/U-002/U-003/U-004/U-005 推进为 `PASS`；真实飞书/Runtime/数据库/E2E 的撤回、权限和外部回执仍为 `NOT RUN`；
- 第 5 条（敏感字段负向）在 Schema 层 11 个 fixture 与 Issue #17 U-006 的三类运行时拒绝均为 `PASS`；真实 Provider 日志/审计管线的外部安全审查仍为 `NOT RUN`。

## Issue #17 运行时切片测试结果（2026-08-22）

以下测试直接对应 Issue #17 的本地可验证关闭条件。结果来自 `modules/integration-gateway/src/integration-gateway-runtime.test.ts` 的当前执行。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-U-004 | Unit | 已接收消息随后收到撤回事件 | Origin 为 `WITHDRAWN`；原 InboundEnvelope/字节引用保留 | receive envelope 与 recall envelope 均保留；late receive 不恢复 `ACTIVE`；同 message `externalId` 的另一 account recall 不撤回本 account Origin | `PASS` |
| IG-API-U-005 | Unit | 已绑定 Project A 的成员请求 Project B，显式 Authorization Port 返回 DENY | 在 IntegrationGateway 入口拒绝；Binding 不产生权限 | 同 Scope 进入 `INTEGRATION_CHANNEL_MEMBER_NOT_AUTHORIZED`；跨 Project 进入 `INTEGRATION_CHANNEL_BINDING_SCOPE_MISMATCH`；未调用跨 Scope Authz Port | `PASS` |
| IG-API-U-006 | Unit | Audit 候选输入分别携带 access token、app secret、webhook body | 三类敏感输入均被拒绝；安全诊断不保存原值 | 三类输入均为 `INTEGRATION_SENSITIVE_DATA_REJECTED`；安全 metadata 可记录且不落原 metadata | `PASS` |

## API Test 维度结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-U-001 | Unit | same external event ID + same Hash 三次 | 返回同一 Envelope/处理结果；只调用一次等价业务 Command | dispatch callback 仅执行 1 次；三次结果复用首个 Envelope；dispatch 抛错后 identity 已 Claim，重放不再 dispatch | `PASS` |
| IG-API-U-002 | Unit | same external event ID + different Hash | 首个 Envelope 不变；新事件 Quarantine | 首个 Envelope 保留；Hash 冲突生成 1 条 Quarantine；后续同 Hash 重放仍返回首个 Envelope | `PASS` |
| IG-API-U-003 | Unit | Runtime/Channel external call timeout | Attempt 为 UNKNOWN，不报告 FAILED/SUCCEEDED | timeout 后为 `UNKNOWN` + `INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN`；稳定键重放不再次调用 Provider；timeout 后迟到 rejection 不改写状态且无 unhandled rejection | `PASS` |
| IG-API-U-007 | Unit/Provenance | 已登记 `integration.adapter_attempt`、`SUCCEEDED` 状态、精确 External Delivery Request；伪造 ID、wrong type/scope、缺少正式 External Delivery Request 和通用 Runtime Attempt | Query 只返回完整登记的正式 Adapter Attempt；伪造/错误/缺失绑定返回 `undefined`；通用 Runtime Attempt 既有语义不变 | `IntegrationGatewayRuntime.getFormalAdapterAttempt` 返回登记的 exact binding；ReleasePublication 组合回归以独立登记的 Authority fixture 注入相同 Port、不得从 Raw Receipt 投影 authority；fabricated ID、wrong type/scope 和缺失正式 External Delivery Request 均被拒绝 | `PASS — focused 3 files / 49 tests; Provider NOT RUN` |
| IG-API-C-001 | Contract | Inbound 未知 Major 或未知 required extension | Quarantine，不猜测映射，不写业务状态 | 未知 Major 与未知 required extension 均 Quarantine；dispatch callback 为 0 次 | `PASS` |
| IG-API-C-002 | Contract | RenderSucceeded 的 inputHash、完整内容寻址 revision 或 renderer 不匹配 Request | 拒绝 mismatch，不把结果当作已登记 Representation | inputHash、revision contentHash/immutableVersionId、rendererId mismatch 均为 `INTEGRATION_RENDER_INPUT_MISMATCH`；匹配输入通过。本切片无 Artifact 登记 Port，不把本地计数当作 Representation 不变量 | `PASS` |
| IG-API-E-001 | E2E | InformationRequest 卡片发出、授权回答、重复回调 | 一个 Answer Candidate/Submission；未授权成员被拒绝；不重复恢复 WorkOrder | 无飞书实现 | `NOT RUN` |
| IG-API-E-002 | E2E | Attempt 提交后进程崩溃并重放 | 复用稳定 key；不重复不可控副作用；Receipt 可补记 | 无 Adapter/Persistence | `NOT RUN` |
| IG-API-M-001 | Manual | 飞书/Runtime/Render 脱敏协议 Fixture | 审核者能看到 ExternalRef→Envelope/Attempt→Raw Receipt→业务 Command 的边界 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 维度：`PASS`，`pnpm verify` 中 format / lint / typecheck / Vitest 317 个测试 / 架构边界 / Catalog 对账共 6 项 Gate 全部通过；2026-08-18 review 第一轮 3 个 P1 inline（Resume required `continuationRef` / `replyToExternalRef` conditional / `businessContextRefs` no ExternalRef）已修复；第二轮 4 个 P1（`ChannelBindingView.status` 用错 enum / `latency` 未收紧为 `ValueEnvelope<Duration>` / `businessContextRefs` 缺 objectType 白名单 / duplicate 用例不构成验收）与 2 个 P2（`attachmentRefs`/`conflictRefs` 过紧 uniqueItems / `adapterCodes` 过紧 NonEmptySet）已修复；第三轮恢复 `adapterCodes` 的 Set 唯一性并通过 S-020/S-021 成对回归；第四轮已同步设计计划与本测试文档的契约及验证证据。duplicate fixture 仍仅作为 Schema 闭包回归，U-002 已在 runtime focused test 中证明运行时首事实保留与 Quarantine。
- Issue #17 运行时切片：U-001/U-002/U-003/U-004/U-005/U-006、C-001/C-002 均为 `PASS`；focused file 共 13 个测试（C-001 参数化为两个 Provider 拒绝场景），覆盖幂等、Hash 冲突、UNKNOWN、迟到 rejection 观察、协议拒绝、Render 绑定含 renderer mismatch、撤回、跨 account Origin 隔离、recall 缺消息引用 Quarantine、Claim-before-dispatch、显式权限拒绝和 Audit/Masking。
- 真实 Handler、Repository、Adapter、Database、E2E、External、Manual：继续 `NOT RUN`；本次实现不声称 Issue #6 全部 8 条验收完成，PR #16 不再 `Closes #6`，未覆盖边界由 [Issue #27](https://github.com/qzhike/zhiju-business-core/issues/27) 追踪。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)。
- Feishu Channel 专项：`DESIGN VERIFIED / USER PROGRESSION CONFIRMED 2026-08-16`；不得据此更改本文件 9 个 API 基准用例的历史状态。
- Runtime Adapter 专项：4 个 Design Gate 已 `DESIGN VERIFIED`，其余 28 个场景为 `NOT RUN`；6 个 additive TaskExecution Command proposal 未进入 Catalog。
- 测试遗留：Schema focused tests 当前为 35/35，Issue #17 runtime focused tests 为 13/13；2026-08-18 review 修复期间新增的临时调试文件 `tests/integration-debug.test.ts` 已删除；本地无临时测试脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| IG-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| IG-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

#27 的业务 Migration/Repository、Provider、跨进程验证与 payload↔hash Gate 仍为 `NOT RUN`。

## IM-05 WI-05 Renderer 用例（Issue #125）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-IM05-WI05-U-001 | Unit/Renderer | 同一 Canonical Document/Workbook bytes 与同一 Renderer Profile 重复渲染 | DOCX/XLSX bytes 与 SHA-256 完全一致；ZIP entry 顺序、时间和 XML 顺序固定 | `deterministic-ooxml-renderer.test.ts` 两类参数化输入逐字节及 checksum 相等，ZIP magic/目标 entry 存在；focused file 共 4 tests passed | `PASS` |
| IG-IM05-WI05-U-002 | Unit/Renderer | Document→XLSX、Workbook→DOCX、错误 input hash、错误 renderer ID/version/format | 外部副作用前 fail closed；不产生 output、Receipt 或成功事件 | Document/XLSX profile、声明 hash、format、renderer ID 与 version 替换均被 `RendererInputError` 拒绝；Artifact 组合负例继续覆盖 Binding 字段替换 | `PASS` |
| IG-IM05-WI05-U-003 | Unit/Security | canonical/source/output locator 或 receipt 候选包含 URL、credential、token、secret | 返回稳定安全错误；公开 Binding/事件/日志无敏感值 | Object Store 拒绝 credential-like locator 和不同 bytes 覆盖；`V7001` CHECK/Repository 仅持久化 opaque locator、ExternalRef 与 hash，不保存原始 payload | `PASS` |
| IG-IM05-WI05-P-001 | Persistence/Migration | 空库应用 `V7001`，再运行第二次 migrate | RenderAttempt/RawReceipt 表、RLS/ACL/不可变保护成功；第二次 no-op | PostgreSQL 18.6/Flyway 11.20.3 空库应用 `V7001` 成功；second migrate=`No migration necessary`；容器删除 | `PASS` |
| IG-IM05-WI05-P-002 | Persistence/Idempotency | same stable key/same request hash replay；same key/different hash；renderer version/content 改变 | 首种复用同 Attempt；第二种稳定冲突；版本/内容变化必须使用新 Attempt | same key/same hash 返回同一 Binding 且 Provider 仅调用 1 次；key/request/attempt identity 冲突返回 `INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT` | `PASS` |
| IG-IM05-WI05-P-003 | Persistence/UNKNOWN | Provider timeout 后以相同 stable key replay，再执行权威 reconcile | 初始和 replay 均为同一 `UNKNOWN` 且 Provider 只调用一次；只有匹配 attempt-derived locator/media/output bytes/checksum/canonical Receipt readback 可推进 | timeout 与 replay 均为同一 `UNKNOWN`、Provider calls=1；伪造 checksum 与用 output 替换 Receipt 均返回 `INTEGRATION_RENDER_OUTPUT_MISMATCH`，权威 output/receipt readback 才推进 `SUCCEEDED` | `PASS` |
| IG-IM05-WI05-P-004 | Persistence/Atomicity | 成功结果未经权威验证，或在 Receipt/Outbox/Attempt 更新后注入回滚 | 验证拒绝进入 `FAILED` 且 Raw Receipt/成功 Outbox 为 0；提交 fault 时三类写入全部回滚，不得存在半成功 Binding | `verifySucceeded=false` 的 Provider outcome 落为 `FAILED`、Raw Receipt=0、成功 Outbox=0；受控提交 fault 后 Attempt 保持 `CREATED`、Raw Receipt=0、成功 Outbox=0 | `PASS` |
| IG-IM05-WI05-P-005 | Persistence/RLS | 无 Context、wrong Project、直接终态改写/删除、跨 Schema读取 Artifact | zero-row/`42501`；终态不可改写；IntegrationGateway App 无 Artifact Repository/Schema 权限 | wrong Project read 为 zero-row；Attempt UPDATE/DELETE 与 Artifact Schema read 均为 `42501`；FORCE RLS/owner policy/受控函数签名通过 catalog 回归 | `PASS` |
| IG-IM05-WI05-C-001 | Contract/Query | `get_render_attempt_binding` 读取 CREATED/FAILED/UNKNOWN/SUCCEEDED | 只有 SUCCEEDED 携带 exact succeededResult/rawReceiptRef；全部结果通过 201-operation Contract Registry | PostgreSQL 用例实际读回四种状态；FAILED/CREATED/UNKNOWN 无 success 字段，SUCCEEDED 含 exact output/receipt；Registry `201/201 FULL` | `PASS` |
| IG-IM05-WI05-C-002 | Tooling/CI | 无 `dist`/`.tsbuildinfo` 的冷工作区执行 lint/typecheck/test | Persistence test project 能解析 `@zhiju/integration-gateway` 类型；不得依赖本地旧 build artifact | PR #135 首轮 CI run `33320335089` 暴露缺失 reference；增加 IntegrationGateway project reference 后，`pnpm clean && pnpm verify` 从零构建产物通过，GitHub run `33320566486` 在 exact head `d3a1394` 上成功 | `PASS (CLEAN LOCAL + EXACT-HEAD CI)` |
| IG-IM05-WI05-E-001 | Integration | exact RenderAttempt Binding 作为公开 Port 输入既有 Artifact Representation Handler | exact binding 注册；revision/input/format/renderer/checksum/scope/receipt/非成功状态全部拒绝 | 真实 Renderer `SUCCEEDED` Binding 经公开 Port 完成 Artifact Handler 登记；既有替换/状态/Scope/receipt 负例与本轮真实链路均通过 PostgreSQL Gate | `PASS (CONTROLLED PUBLIC-PORT/PERSISTENCE)` |
| IG-IM05-WI05-M-001 | Manual/Openability | 一份脱敏 Document 与 Workbook，含 input bytes/hash、attempt/request hash、output checksum、Binding、Representation 与检查表 | DOCX/XLSX 在批准应用中可打开；身份/checksum 可独立比较；输出清理完成 | DOCX `9da593bff44cc62d4e1b693af7dec80aabb884a3eaa58dd3e94854bff8a894ef`/3939 bytes 在 Word 打开并展示标题、段落、表格；XLSX `81d7aac6eb8a9cfc55046758705587466e4e8fa1a5010347fda46c4f4ae94e86`/3495 bytes 在 Excel 打开并展示 A1:C3；公式 XML 已保留但未验证完整计算引擎；ZIP 完整性通过，临时输出删除 | `PASS (LOCAL MANUAL OPENABILITY) / REAL CUSTOMER ACCEPTANCE NOT RUN` |
