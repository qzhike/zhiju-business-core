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

## IM-06 Runtime Binding 设计用例

关联 Spec 007 的 Runtime Binding Query设计；以下未实现，不改变旧测试证据。

| ID | 输入 | 预期 | 结果 |
|---|---|---|---|
| IG-TD-001 | 同AttemptRef但替换Run/Contract/Context/Capability/lease/fencing任一项 | TaskExecution exact binding校验失败，不start_run | NOT RUN |
| IG-TD-002 | synthetic Driver未调用，fixture伪造SUCCEEDED/Receipt | owning写入拒绝；真实合成调用可保存source=SYNTHETIC_DRIVER | NOT RUN |
| IG-TD-003 | 超时UNKNOWN同键重放/真实reconciliation | 无二次dispatch；追加Observation不改request/binding | NOT RUN |
| IG-TD-004 | 跨Scope Query或试图读取Token/Continuation Secret | 拒绝或最小化投影；不存在敏感字段 | NOT RUN |

### WI-03 Driver 证据来源细化

权威为 [Runtime profile](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#受控-driver-输入输出与调度)及 Spec 007 Runtime Binding Query；每个反例采用 otherwise-valid 原始请求、Hash、已提交同 Scope 对象与 Service 授权。设计静态审阅不改变下列业务运行结果。

| ID | 输入 / 故障 | 预期读回 / 禁止效果 | 当前结果 |
|---|---|---|---|
| IG-WI03-D-001 | 正常 ack 场景：原 request/binding 已提交，实际调用 Driver；保存安全 ack 的 ObjectLocator/Hash，经 record_external_receipt 提交后更新 Attempt | 调用次数 1；Query 可读原 requestHash/bindingHash，SUCCEEDED 的 acknowledgement 指向实际 synthetic session、Observation、exact Raw Receipt；source=SYNTHETIC_DRIVER | NOT RUN |
| IG-WI03-D-002 | Fixture 未调用 Driver，却带 SUCCEEDED/Receipt/expectedOutcome；或实际 ack 替换 bindingHash/lease/session | 不产生成功 Observation；精确来源/绑定不符拒绝；自洽 Hash 不替代真实调用；无 Token/secret 输出 | NOT RUN |
| IG-WI03-D-003 | 延迟 ack，超时 UNKNOWN，同稳定键重放三次，随后释放原调用 ack 并 readback | 无二次 dispatch；无 ack 时 Query 省略 acknowledgement；原调用读回后才追加 Observation。Run lease 已过期时仍不得 start | NOT RUN |
| IG-WI03-D-004 | Raw Receipt 已提交但 Attempt success 事务前崩溃；另在 success/Outbox 提交后 Worker 确认前崩溃 | 前者孤立 Receipt 不证明成功，恢复核验原 ack 后补交 Attempt；后者原 Observation/Receipt 重放，无第二成功事件；相同 identity 异 Hash 拒绝 | NOT RUN |
| IG-WI03-D-005 | 同稳定键不同 requestHash，或 Fixture 中途更换 Result 样本/合成 RuntimeBinding；延迟 final 仍携带原 token/submission | 冲突不替换原调用，原样本/Hash/来源可追溯；late final 交给 TE 接收边界隔离，不由 IG 修改 Run、Acceptance 或 Completion | NOT RUN |

### 首个 READY Run 的 Attempt/Receipt 设计矩阵（提案）

| ID | 层级与输入 | 预期 | 当前结果 |
|---|---|---|---|
| IG-RUN-D-001 | 已提交 TE Run/ACTIVE Claim 与当前 Bundle；IG 按独立授权读 Binding，提交 Attempt 后真实调用 synthetic Driver，再经 owning `record_external_receipt@1.0`/Observation 成功 | 原 request、binding、Raw Receipt、ack/session/Observation Hash 精确，SUCCEEDED 和唯一已注册成功 Event；新增 Query 完整读回且无 secret | NOT RUN |
| IG-RUN-D-002 | TE Binding 权限或 Bundle 消费权限缺失、撤销、到期；request 中置换任一 Ref/RuntimeBinding/lease/fencing/Scope | protected read 前或提交前拒绝，Driver 调用 0 次；不以 caller CanonicalJson 或静态 selector 代替当前 TE/IP 权威 | NOT RUN |
| IG-RUN-D-003 | Driver 未调用的 fixture SUCCEEDED、无原始 ack 的 caller Receipt、错 session/Hash/source、UNKNOWN 后同键重放 | 无可用 SUCCEEDED/ack；UNKNOWN 不二次调用；只有原调用真实 ack 可追加调和 Observation | NOT RUN |
| IG-RUN-D-004 | `V7001` 历史 Renderer Receipt、未来 Runtime Receipt、错 kind/Attempt FK/Scope/Hash 与两类 Query | 历史 Renderer 行和约束保留；Runtime kind 只连真实 RuntimeAttempt；公开 RawExternalReceipt identity 唯一；错 kind 直 SQL 被拒绝 | NOT RUN |
| IG-RUN-D-005 | Raw Receipt 已提交而 Attempt 状态未提交、Attempt SUCCEEDED 后 Worker 进度未提交、两次并发同键请求 | 原已提交事实不伪造 success；原键/Observation 恢复，唯一成功 Event/Driver 调用；异 payload 冲突 | NOT RUN |

以上均须用真实 owning 入口与 PostgreSQL 约束执行；静态设计/合成样本本身不记录为运行通过。

### IM06-FINAL 原调用 final 观察设计矩阵

状态：`DESIGN APPROVED 2026-09-23 / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-23 / HUMAN DESIGN APPROVED 2026-09-23 / DRAFT PR #226 PARTIAL EXECUTION / LOCAL FULL PASS 2026-09-24 / EXACT HEAD EVIDENCE IN PR #226`。依据 Spec 007 final 增量与 Runtime Adapter 受控 Driver addendum；本矩阵不把静态 fixture 当作实际 Driver 证据。`PARTIAL` 行只证明明列的已执行子场景，其余仍 `NOT RUN`。

| ID | 层级与输入 | 必须观测的结果 | 实际 |
|---|---|---|---|
| IG-FINAL-D-001 | 新 Attempt 预分配独立实例 ID 并传给实际 synthetic Driver；真实 ack 回显后 IG 同事务提交 Adapter 实例身份；Run 启动后 Driver 实际释放 FINAL；IG `readFinal(attemptRef)`、持久化、以仅含 Attempt Ref 的独立 Query 读回 | 实例身份 `ObjectRef<zhiju.runtime.runtime>` 与 Attempt 不同且一对一，内部授权 Port 返回原 ack 的同一 Ref；final `submittedByRuntime`、观察与 Query 身份 Ref 完全一致；原 invocation 的稳定 submission Ref、完整 payload Hash、ack observation ID、bindingHash/fencing/Run/Scope 闭合；一个不可变 final Observation；Query 返回已提交完整受控 Result body 与 Hash/Ref/来源，不返回秘密或原始 Prompt/stdout | PARTIAL：原调用、身份、FINAL 观察与授权读回 PASS；完整负向身份矩阵 NOT RUN |
| IG-FINAL-D-002 | 仅预分配实例 ID 但 Driver 未调用/无真实 ack、ack 回显另一 ID 或原 binding、final 尚未释放、Attempt UNKNOWN、错 Driver profile、caller 仅提供 Result body 或预期 fixture Hash | 预分配不成为有效 Adapter 身份；内部 Port/final Query 不产生成功视图；没有原调用观察不得构造 final；不存在第二次 invoke；无授权 protected read 为 0 | NOT RUN |
| IG-FINAL-D-003 | 同 Attempt/ack/实例身份/submission 重读、ack/final 事务提交后响应/进度丢失；同 id 异 Hash、第二实例或第二 final、换 ack/session/Run/fencing/Adapter Ref、错 Scope | 合法重读精确原身份 Ref、submission Ref/Hash/时间且各只有一行；冲突安全隔离，不覆盖原观察/ack/身份；TE 不能用新的自洽 payload 冒名 | PARTIAL：同一 final 重读、提交后恢复、同 Attempt 异 submission 冲突拒绝 PASS；其他身份/字段冲突 NOT RUN |
| IG-FINAL-D-004 | 原调用在 Run 到期后才释放 final，或写入 final 时 TE 已 terminal；IG 与 TE 异步/暂时不可用 | IG 可以保留真实迟到历史观察；TE 按当前 Run/Claim/期限单独拒绝执行资格；IG Query 不投影 Run SUCCEEDED | PARTIAL：真实期限后释放/观察 final，TE 拒绝迟到提交 PASS；不可用分支 NOT RUN |
| IG-FINAL-D-005 | PostgreSQL 空库/#222 升级/二次 no-op；app-role 直 SQL 将预分配 ID 伪造为实例、缺 source Receipt、错原 Attempt/ack FK/Hash/Scope、UPDATE/DELETE、异 Project/无 Context；Renderer 旧行 | 本 Schema 内实例身份与原 Attempt/ack/Receipt 的镜像、source、唯一性、不可变、RLS/ACL 拒绝；历史 Runtime ack 可读但不凭空补实例，Renderer Receipt/Attempt 查询无损；Driver 实际调用由集成证据另证 | PARTIAL：V7003 空库、历史升级、二次 no-op PASS；针对新增 IG 身份与 final 观察表的直 SQL、RLS/不可变负例及完整 SQL 矩阵 NOT RUN |
| IG-FINAL-D-006 | IG final 观察已提交而 TE handoff 未开始/失败，TE 重启以原 Run 已存 Attempt Ref 查询；未提交 final 或另一个 Attempt Ref 查询；模拟 Worker 重启 | 仅凭同一 Attempt Ref 精确取回唯一 final 的 submission Ref、实例 Ref、原 body/hash；未提交或错 Ref 不可用；Driver 不二次 invoke、不以 TE 待提交 Result 反向生成观察 | PARTIAL：IG 提交前新 Driver 读原 final，提交后新入口按 Attempt 读回 PASS；错 Attempt/故障分支 NOT RUN |
