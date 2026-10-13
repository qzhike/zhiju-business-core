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

状态：`DESIGN APPROVED 2026-09-23 / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-23 / HUMAN DESIGN APPROVED 2026-09-23 / PR #226 MERGED / ADDITIONAL LOCAL FULL PASS 2026-09-26 / APPLICABLE EXECUTABLE CASES PASS / RESIDUAL PREREQUISITES PARTIAL / CLOSURE SCOPE APPROVED 2026-09-26`。依据 Spec 007 final 增量与 Runtime Adapter 受控 Driver addendum；本矩阵不把静态 fixture 当作实际 Driver 证据。`PARTIAL` 行只证明明列的已执行子场景，其余仍 `NOT RUN`。

关闭适用性按[决定 §22.8](../decisions/task-execution-human-operated.md#228-issue-224-关闭验收边界确认2026-09-26)执行：真实 PolicySnapshot 取代保留 `NOT RUN`，随 owning 写入能力后续验收；首 Run 的 lease/deadline 同界；独立 Usage/Completion 与外部/人工维持非目标。该人类批准不把 `PARTIAL` 改成完整 `PASS`，当前可达路径仍须通过独立审查。

| ID | 层级与输入 | 必须观测的结果 | 实际 |
|---|---|---|---|
| IG-FINAL-D-001 | 新 Attempt 预分配独立实例 ID 并传给实际 synthetic Driver；真实 ack 回显后 IG 同事务提交 Adapter 实例身份；Run 启动后 Driver 实际释放 FINAL；IG `readFinal(attemptRef)`、持久化、以仅含 Attempt Ref 的独立 Query 读回 | 实例身份 `ObjectRef<zhiju.runtime.runtime>` 与 Attempt 不同且一对一，内部授权 Port 返回原 ack 的同一 Ref；final `submittedByRuntime`、观察与 Query 身份 Ref 完全一致；原 invocation 的稳定 submission Ref、完整 payload Hash、ack observation ID、bindingHash/fencing/Run/Scope 闭合；一个不可变 final Observation；Query 返回已提交完整受控 Result body 与 Hash/Ref/来源，不返回秘密或原始 Prompt/stdout | PASS（OWNING/PG + CONTRACT）：原 actual invoke/ack 建立唯一独立实例，真实 FINAL 的 submission/body/hash/ack/session/binding/fencing/Scope 与 Attempt-only 授权 Query 精确一致。完整响应、逐项必填遗漏/null、错误 Ref kind/type/ID 与请求 caller body/预测 Hash 拒绝；原身份与 final 不变，不把预分配当有效身份。 |
| IG-FINAL-D-002 | 仅预分配实例 ID 但 Driver 未调用/无真实 ack、ack 回显另一 ID 或原 binding、final 尚未释放、Attempt UNKNOWN、错 Driver profile、caller 仅提供 Result body 或预期 fixture Hash | 预分配不成为有效 Adapter 身份；内部 Port/final Query 不产生成功视图；没有原调用观察不得构造 final；不存在第二次 invoke；无授权 protected read 为 0 | PASS（OWNING/PG + CONTRACT）：调用前预分配、无 ack、final 未释放、UNKNOWN、错误实例 ID/binding/profile 均不产成功身份/final，Driver 无重复调用；caller 仅给 body/预期 Hash 或错完整 Attempt Ref 被拒绝。历史 final Query Grant 撤销与错 Actor/session/Scope 的 owning 边界在 protected SELECT 前拒绝，所需计数为零。 |
| IG-FINAL-D-003 | 同 Attempt/ack/实例身份/submission 重读、ack/final 事务提交后响应/进度丢失；同 id 异 Hash、第二实例或第二 final、换 ack/session/Run/fencing/Adapter Ref、错 Scope | 合法重读精确原身份 Ref、submission Ref/Hash/时间且各只有一行；冲突安全隔离，不覆盖原观察/ack/身份；TE 不能用新的自洽 payload 冒名 | PASS（OWNING/PG）：同一 committed ack/final 与新入口重读精确原 Ref/Hash/时间；冲突 submission/body、Attempt/实例/Scope/binding/fencing/Run/session 自洽改 Hash 均拒绝且原观察不变，安全冲突 Audit 不含原文。ack 成功事务故障回滚后，两次同键 dispatch 从原 Driver readBack 并发补交，实例 ID 不变、Driver 一次，唯一 ack/RawReceipt/身份/Event；无原 ack 不补成功。 |
| IG-FINAL-D-004 | 原调用在 Run 到期后才释放 final，或写入 final 时 TE 已 terminal；IG 与 TE 异步/暂时不可用 | IG 可以保留真实迟到历史观察；TE 按当前 Run/Claim/期限单独拒绝执行资格；IG Query 不投影 Run SUCCEEDED | PASS（OWNING/PG，限定路径）：真实 Run 到期后释放 final、TE 已 TIMED_OUT/EXPIRED 后才保存 final 均只保留 IG 历史观察，TE submit 拒绝、无 Result/Receipt，原终态不变。IG Driver final 读取暂时故障恢复原调用；IG 已提交而 TE submit 暂时不可用时按原键/Attempt 恢复且不再 invoke。IG Query 不投影 TE 成功。 |
| IG-FINAL-D-005 | PostgreSQL 空库/#222 升级/二次 no-op；app-role 直 SQL 将预分配 ID 伪造为实例、缺 source Receipt、错原 Attempt/ack FK/Hash/Scope/fencing/Result Run/session、UPDATE/DELETE、异 Project/无 Context；Renderer 旧行 | 本 Schema 内实例身份与原 Attempt/ack/Receipt 的镜像、source、唯一性、不可变、RLS/ACL 拒绝；历史 Runtime ack 可读但不凭空补实例，Renderer Receipt/Attempt 查询无损；Driver 实际调用由集成证据另证 | PASS（PERSISTENCE/OWNING）：V7003/V7004 空库、V7002 原 ack 备份升级、二次 no-op，历史列逐项保留、planned identity NULL、不自动造身份/final；owning ack Query 原样读回。Renderer 旧 Attempt/Receipt/Outbox 列无损且 owning Binding Query/replay 相同。RLS/ACL/无 Context/跨 Project/不可变拒绝；原 actual ack/PENDING source 的合法 SQL 基线回滚，15 项实例来源和 14 项 final FK/Scope/hash/fencing/Run/session/Adapter 镜像置换均拒绝且无残留。真实 Driver 调用另由 owning 链证明。 |
| IG-FINAL-D-006 | IG final 观察已提交而 TE handoff 未开始/失败，TE 重启以原 Run 已存 Attempt Ref 查询；未提交 final 或另一个 Attempt Ref 查询；模拟 Worker 重启 | 仅凭同一 Attempt Ref 精确取回唯一 final 的 submission Ref、实例 Ref、原 body/hash；未提交或错 Ref 不可用；Driver 不二次 invoke、不以 TE 待提交 Result 反向生成观察 | PASS（OWNING/PG）：IG 提交前后 Driver/入口重建、无 final 等待与错 Attempt 拒绝；已提交 final 只按原 Run Attempt 取原 submission/实例/body/hash。TE submit 前故障以及五个目标提交后 Process 未记步均按原稳定键恢复至 terminal；定时 worker 和两个真实 Process 运行不再 invoke，不以 TE 请求反造 IG 观察。 |

## #229 两 invocation 恢复来源矩阵

状态：`DESIGN APPROVED / HUMAN DESIGN APPROVED 2026-09-27 / IMPLEMENTATION PRESENT (#231) / OWNING RECOVERY DIAGNOSTICS EXECUTED / EXACT REVISION FULL AND REVIEW EVIDENCE IN PR #232`；[Spec007 #229](../module-specs/Module-Spec-007-IntegrationGateway.md#229-受控-blocked_input-与第二-invocation-映射实现契约)。原IG-FINAL矩阵的证据层级和PARTIAL保留。

| ID | 输入 / 层级 | 预期 / 结果 |
|---|---|---|
| IG-REC-D-001 | Controlled Driver+owningdispatch/Observation/Query+PostgreSQL；Run-1固定blocking模板，合法Run-2新Context/Bundle/Attempt的空COMPLETED模板 | OWNING/PG/CONTROLLED PASS：两实际 invoke，独立 Attempt/实例/session/submission 与 Query 原 body/hash、两条 TE 独立验证链；IG 不确认答案或完成 WorkOrder。 |
| IG-REC-D-002 | 实际Driver负例+PostgreSQL；同Run换session/Context/fencing、Run-1final送Run-2、未schedule/Resolution或撤权/过期资格的dispatch | OWNING/PG/CONTROLLED PASS：Run-2 actual Driver wrong session 回调无 final Observation/TE Result；旧 fencing/Attempt/Context/Bundle/runtime binding 拒绝、late Run-1 body 不绑定 Run-2；缺 Resolution/schedule 或失效资格无新 invocation；三种不支持第二 outcome 拒绝。 |
| IG-REC-D-003 | 两真实Worker/Process；ack/final observation提交前故障与提交后handoff/progress丢失、同键并发读回 | OWNING/PG/CONTROLLED PASS：两个实际 Worker、ack COMMITTED 事务回滚后同实例 readBack、13 target 交接丢失原键恢复，无二次 invoke/重复 Observation；TE owning eligibility Port 保持。真实 Provider/CLI/Feishu/HTTP/manual NOT RUN。 |


## #233 非空受控 final 设计用例

authority为Spec 007 #233与Runtime Contract #233；#235有限受控运行证据如下。

| ID | 层级 / 输入 | 预期 | 实际 / 结果 |
|---|---|---|---|---|
| IG-COMP-D-001 | Application + PostgreSQL / 实际normal/recovered invocation、Human已提交output release | 原ack/adapter实例/attempt/session/Run/fencing不变，实际Artifact Ref/Receipt后才生成固定final bytes/hash，IG只封存观察 | OWNING/PG/CONTROLLED PASS：normal/recovered三个versioned模板真实invoke；Human actual Artifact提交后原session/attempt/实例/fencing释放非空final，IG只封存；Run-2独立Context/instance/session。 |
| IG-COMP-D-002 | Application + PostgreSQL / 预分配未提交输出、错invocation/Receipt/hash、双release、restart与late release | release独立授权/读取拒绝wrong-source；同原调用重读同bytes不重新invoke；迟到仅历史、TE不接纳，无第二final | APPLICATION/PG/CONTROLLED PASS（已执行）：premature未提交output拒绝、Human-only实际有Grant非Human/actingFor拒绝、冲突第二release拒绝、journal restart同原final/无新invoke；formal sealed output在Run已expire后仍不能产生TE Result/Completion。全部wrong invocation绑定与expiry后首次release子项NOT RUN。 |

## IM06-CANCEL 迟到 final 来源验收

状态：`T2 / HUMAN DESIGN APPROVED 2026-10-03 / INDEPENDENT DESIGN REVIEW APPROVE 2026-10-03 / IMPLEMENTED IN #244 PROPOSED REVISION / RUNTIME EVIDENCE IN THE PULL REQUEST`。

authority 为 [Spec 007 的 IM06-CANCEL 段](../module-specs/Module-Spec-007-IntegrationGateway.md#im06-cancel-原-invocation-的迟到-final-历史观察已批准设计)，关联 TE CANCEL-D-003/004/006/008。

| ID | 输入 / 层级 | 必需预期 | 当前结果 |
|---|---|---|---|
| IG-CANCEL-D-001 | 支持两次执行 profile 的真实 Run/reservation 与 invocation/ack/start，原 final 固定后延迟至取消及 expiry 提交；两种原 final 释放次序 | 原 Attempt/session/模板/body/submission/Observation Hash 可读回，晚到只证明历史；无第二 invoke、无 Cancel ACK 或伪造 Provider Receipt | PASS（#244 真实 PostgreSQL，见 PR）：CANCELLING 与 ABANDONED 两种次序的迟到 final 均只读回历史 Observation，无第二 invoke/Cancel ACK |
| IG-CANCEL-D-002 | late consumer 分别缺 Binding/final Grant，wrong Attempt/Scope/session/fencing/hash 或复制 caller JSON | protected read 先授权；自洽错来源不成为合法 LATE_RESULT，原历史与另一 Run 不覆盖 | PASS（#244 真实 PostgreSQL，见 PR）：错 Attempt/Run/Scope/session/hash 或缺 caller JSON 均不成为合法 LATE_RESULT，原历史不被覆盖 |
| IG-CANCEL-D-003 | IG Observation 提交后 TE Audit 写失败/依赖不可用，原 source 重试与 worker 重启 | 源保持不可变、读回同原 bytes/Hash，不重新调用 Driver；未实际提交隔离 Audit 不宣称已处理，TE 业务无接纳 | PASS（#244 真实 PostgreSQL，见 PR）：Audit 写失败后原 source 仍按原身份读回并可重试，Driver 不重新调用、TE 无接纳 |

原 Query/Observation Schema、公开契约与现行 runtime 证据保持；#244 的 IG-CANCEL-D 行结果记录在对应 Issue/PR，外部/人工维持各自 NOT RUN。

## IM06-USAGE 历史原调用来源设计验收

状态：`T2 DETAILED DESIGN APPROVED 2026-10-04 / DESIGN TECHNICAL REVIEW PASSED 2026-10-04 / HUMAN DESIGN APPROVED 2026-10-04 / IMPLEMENTED 2026-10-04 (Issue #246) / PARTIAL RUNTIME EVIDENCE`。authority 为 [Spec 007 IM06-USAGE](../module-specs/Module-Spec-007-IntegrationGateway.md#im06-usage-原调用来源的只读消费提案)，当前 mapping 唯一见 Spec 001 §15.18；关联 TE USAGE-D-001/003/004/006。严格读单测在 `modules/integration-gateway/src/runtime/controlled-runtime-dispatch.test.ts`；未执行变体保持 NOT RUN。

| ID | 输入 / 层级 | 必需预期 | 当前结果 |
|---|---|---|---|
| IG-USAGE-D-001 | Owning/PG/controlled；原 actual invoke/ack/start，无 final 与实际原 final 已封存，expiry/ABANDONED 后原历史、Run-2 独立来源 | 原 Binding/RawReceipt/ack/Adapter identity/Observation 的完整 Ref/hash/Scope/fencing/session 精确读回，synthetic source 不冒充 Provider；无 final 只在当前读权有效的确定 not-found 下成立，不再 invoke/readBack/readFinal，不补任何业务行，Run-2 不用 Run-1 来源 | PARTIAL（PG：真实 synthetic invoke/ack/start、CANCELLING 与 ABANDONED 取消隔离后的 Run、以及 BOUNDED_RECOVERY Run-1/Context-2 Run-2，Usage 读回各自原 Binding/RawReceipt/ack/Adapter identity/Observation 的精确 Ref/hash/Scope；无 final 只在 owning 确定 not-found 下成立。未执行：expiry 后对照的独立断言） |
| IG-USAGE-D-002 | Unit/Contract + PG；原 identity/Observation canonical/hash/mirror、body/header hash、ack session 与 Adapter instance 单字段冲突；错 target/Scope/caller DTO，预分配未 ack | canonical Observation Hash 与 Result Header payload Hash 分别校验，错值不提升为真实来源；无真实 ack 不返实际 identity；库内非法镜像触发 guard 的证据与 owning helper 的冲突拒绝分层，不通过直接写表制造 positive source | PARTIAL（Unit：`controlled-runtime-dispatch.test.ts` 对 request/binding/identity payload/identity mirror/ack observation hash/final result hash/final mirror 单字段冲突逐项拒绝；mirror-only 探针：仅改 `runtime_final_observation.runtime_submission_ref.externalId` → FINAL_INVALID，仅改 `runtime_attempt_observation.acknowledged_at` → BINDING_INVALID；self-consistent 错误来源探针：只改 canonical ack 的 `bindingHash` 或 `rawReceiptRef.contentHash` 并重算 observation hash，Binding 与 final 读均以 owning integrity error 拒绝；完整 TypedRef 绑定探针：只改 canonical ack 的 `attemptRef.objectType`（保留 id/scope）或 canonical final 的 `runtimeAdapterIdentityRef.objectType` 并重算自身 hash，同样拒绝（ack 的完整 Attempt Ref 必须等于已授权 exact Attempt，final 的完整 Adapter Ref 必须等于已验证 owning identity Ref，含 kind/objectType）；canonical Observation Hash 与 Result Header payload Hash 分别校验，预分配未 ack 不返 identity，owning not-found 与 integrity failure 分离。PG：真实读回正例。未执行：PostgreSQL 直接注入库内非法镜像的 guard 分层证据） |
| IG-USAGE-D-003 | Security/PG；Binding/identity/final 三项分别缺当前 Grant/错 consumer action、读取后撤权、IP/DB/网络故障与合法 final-not-found 对照 | 先授权再保护读取，缺一 protected read 为0；返前撤权/依赖故障安全失败，不伪装无 final；SERVICE body 只到受信 TE composition，Human 输出无 session/Prompt/token/stdout/客户正文；既有 Query/Driver/Worker/Renderer 语义与 Schema 保持 | PARTIAL（PG：三项 IG read 各自缺当前 Grant 时整 Query 拒绝且对应 owning read 为 0；Human 输出无 session/Prompt/token/stdout/客户正文；既有 Query/Driver/Worker/Renderer 语义与 Schema 由 `pnpm verify:code` 全量保持。未执行：错 consumer action、读取后撤权、IP/DB/网络故障与合法 final-not-found 的 PG 对照） |

未来实现 required full，实际原 Driver invocation、immutable sources、权限与数据库 guard 结果分别记录在 Issue/PR；旧 FINAL/REC/COMP/CANCEL 证据和外部/人工 NOT RUN 不因本设计重标。

## #277 ZIP 原提交与一次重传设计场景

状态：`DESIGN APPROVED / NOT RUN`。字段见 [IG #277](../module-specs/Module-Spec-007-IntegrationGateway.md#277-zip-提交意图与一次完整重传提案)。以下均需受控真实流/对象/owning Source Receipt；保留 IG-D14 安全测试与执行证据边界。

| ID | 输入 / 故障 | 必须观察的 owning 结果 | 实际 / 结果 |
|---|---|---|---|
| IG-277-001 | 已授权NEW/EXISTING准备请求，一ZIP+多行note，policy ref/hash仅取EP原request公开结果；伪造/替换当前新entry的policy；重复click/同request不同intake target | 唯一原intake/Receipt、原文/hash/ANALYZE绑定；policy与原preset逐项全等才接受，不注入默认；第二target拒绝；Query两selector读回同结果，零Query写/签token/分析 | 未执行 / NOT RUN |
| IG-277-002 | 首CREATE/ticket响应丢失→重登→原Query确认CLOSED_NO_OBJECT/RESTART→首次restart；连接中断/token到期 | Query同次返回真实aggregateVersion与uploadState；分别填Envelope CAS和payload generation，当前权限与hash/原key检查；同intake仅generation2、原内容byte0上传；原票据/fencing失效；replay同代同token原expiry | 未执行 / NOT RUN |
| IG-277-003 | 旧流未停/对象状态UNKNOWN/已STAGED或已有link；Query后Root版本或generation改变；双restart并发；代2失败；旧finish迟到；restart响应丢失 | UNKNOWN/STAGED/link或过期CAS拒绝重传，零新token/代次；并发一winner，代次不超过2；旧finish不commit，响应丢失不增加次数且原restartCommand不改CAS；token密文不可用安全失败、过期不可返回 | 未执行 / NOT RUN |
| IG-277-004 | 有效DOCX+MD+不支持条目/坏DOCX；零可分析entry但有note；unsafe路径/bomb/DOCX二级预算超限 | 安全部分源/原bytes/逐entry限制保留；零有效ZIP entry拒分析；unsafe零manifest Event/dispatch，不以说明或technical extraction伪造可读报告 | 未执行 / NOT RUN |
| IG-277-005 | object写成功link失败、entry或note accept后crash；manifest提交前失败 | 原step IDs/key/Receipt续接，无重复源；已link资料不可cleanup；manifest未commit不READY，说明未接纳不能丢弃后handoff | 未执行 / NOT RUN |
| IG-277-006 | manifest/Receipt/Event任一写点失败/提交后重复投递；EP暂不可用；TE已接收但无Run | IG同事务回滚或真实完整提交；EP原Eventreadback去重；custody不丢，analysis独立PENDING/UNKNOWN；不将202/Task/Request说成Runner启动 | 未执行 / NOT RUN |

## D14 / RD-01 首条资料链路设计场景

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。对应 owning Spec 的 D14 专节与 [Spec Delta](../decisions/d14-rd01-first-customer-flow.md)。下表是未来正链、必要反例与恢复验收；本 Issue 只做设计对账，不写实现测试、不运行客户任务，真实执行均 `NOT RUN`。后续使用脱敏独立 Runner 原输出、真实 owning receipts 和 PostgreSQL/HTTP/Browser 分层取证，不用合成 snapshot 代替。

| ID | 输入 / 故障 trace | 预期 owning 结果 | 实际 / 结果 |
|---|---|---|---|
| IG-D14-001 | 合法 ZIP 含 DOCX/UTF-8 MD、同 bytes 不同 entries、非支持文件 | 原包/原条目 bytes/hash 与独立 entry identities；EP accepted source refs；PARTIAL 不静默全读，合法源才可 dispatch | 未执行 / `NOT RUN` |
| IG-D14-002 | zip-slip/驱动器/NUL/link/碰撞/加密/分卷/CRC/外层及 DOCX bomb | 受控 stream 累计上限/限时；整体隔离 zero dispatch，零越界读写；安全错误无正文/host path | 未执行 / `NOT RUN` |
| IG-D14-003 | 损坏 DOCX/非 UTF-8 MD/图片或嵌入读取上限/零可读源 | 逐 entry CORRUPT/UNSUPPORTED/READ_LIMITED；零可分析源拒绝，不空成功；Reader ceiling 限 READ，不证明语义 | 未执行 / `NOT RUN` |
| IG-D14-004 | staging object 成功 link 失败、entry EP commit 后 worker crash | 孤立对象可审计；原 intake/key/Receipt 续接零重复 root，已 link/retention 资料不 cleanup，未 manifest commit 不 READY | 未执行 / `NOT RUN` |
| IG-D14-005 | 真实 profile 原 ack/final，改 manifest/narrative/extraction hash/session/fencing | 原调用只观察实际 bytes；绑定错误拒绝；IG raw!=TE acceptance!=EP accepted report，各证据分列 | 未执行 / `NOT RUN` |
| IG-D14-006 | timeout UNKNOWN/重放、lease过期/取消后晚报告、锁定 CLI 不可用 | 原 readback 禁重复 invoke；late 历史，profile unavailable 明确失败；不 silent fallback，不重写 inputs | 未执行 / `NOT RUN` |

首轮恢复追加场景（同为 `NOT RUN`）：**IG-D14-007** — ACTIVE初轮窗口补料分析、窗口关闭后的late report；预期：原start只读、phase/Package/Run绑定；可留原观察，不覆盖可操作报告或重发调用。

## D14 Runner 原调用与锁验收（#256）

状态：`PROPOSED / NOT REGISTERED / NOT RUN / INTERNAL CONTRACT CASE SET EXECUTED (#264)`。对应 [IG owning锁与观察](../module-specs/Module-Spec-007-IntegrationGateway.md#d14-runner-物化锁与原调用观察提案256)。future实际调用、journal、原bytes/hash与当前独立权限必需；只读安装和旧controlledsynthetic证据不能替代。#264 只覆盖内部 lock 契约与 `preflightD14RunnerMaterialization` 的 contract 级用例（`modules/integration-gateway/src/runtime/d14-runner-lock-preflight.test.ts`）；本表 IG-LOCK 行全部保持 `NOT RUN`，因为尚无真实 invocation/journal/独立权限证据。

| ID | 输入 / 故障 | 预期owning判定 | 实际 / 结果 |
|---|---|---|---|
| IG-LOCK-001 | approvedconfig、只读Darwinfacts、缺部署pins/未准入客户数据/模型别名 | 不混三层，Ubuntu物化缺值零invoke；actualProvider/model与锁逐字段核验，无fallback | 未执行 / `NOT RUN` |
| IG-LOCK-002 | 真CLIack与final、spawn前后crash、journal/IG提交后response丢失 | 稳定原Attempt/key/bindings，只readback原调用；gapUNKNOWN，零重复spawn/伪ack/session | 未执行 / `NOT RUN` |
| IG-LOCK-003 | 原control观察，同ID异Hash/wrongsession/Scope/Run2引用Run1、缺读权 | canonical/source/bindings完整校验；冲突隔离，缺权保护读0，不从caller自洽JSON倒造来源 | 未执行 / `NOT RUN` |
| IG-LOCK-004 | stop请求、父进程exit、全cgroup停止、ACK未知及迟到输出 | request/signal/localstop/UNKNOWN分别持久；localstop不是ProviderACK，原late历史稳定不改TE状态/业务current | 未执行 / `NOT RUN` |
| IG-LOCK-005 | 同final同Hash、异Hash第二final、输出停止写前后替换/path/link/inputhash漂移 | 原outputbytes不可变、一finalidentity；冲突隔离，停止写后重新hash，零错来源可用报告；raw观察不等于TE/EP接纳 | 未执行 / `NOT RUN` |

## D12 / Q11 Markdown 与受控导出技术设计场景（#260）

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。对应 [IG D12](../module-specs/Module-Spec-007-IntegrationGateway.md#d12--q11-markdown-与导出技术边界提案260)；旧OOXML/Provider证据不覆盖本增量。

| ID | 输入 | 预期 | 当前实际输出 / 结果 |
|---|---|---|---|
| IG-D12-001 | 新登记Markdown profile及完整支持Canonical Document；错version/input/Binding/输出checksum | 同input/version确定bytes；失败/UNKNOWN不能伪造成功Binding/Representation，旧OOXML profile不变 | 未登记/实现Markdown profile / NOT RUN |
| IG-D12-002 | exact已提交Batch请求、staging/readback、DB rollback、finalize timeout、双Worker/过期fence、有Link orphan | Attempt稳定、UNKNOWN读原object/version、不盲目重做；过期Worker不发布AVAILABLE；关联对象不误删，技术诊断不泄密 | 无新ZIP Adapter/存储流程 / NOT RUN |
| IG-D12-003 | 服务器下载响应/浏览器click冒充RawExternalReceipt，或新导出Attempt冒充formal Adapter Attempt | 不晋升FormalReceipt/成功发布/Completion；未调用客户发送Provider | 无新受控流组合 / NOT RUN |

## Markdown 输入、真实原输出与表示设计场景（#259）

权威为 [IG #259](../module-specs/Module-Spec-007-IntegrationGateway.md#markdown-建议生成原输出与渲染提案259)，真实Runner/Host acceptance与内容专业验收独立。

| ID / 输入 | 可核验预期 | 实际 / 结果 |
|---|---|---|
| IG-MF-001 / MF-01/02合法生成lock、exactinputs/Intent/Run→真实md/identityMap/report原输出 | Attempt提交后invoke，input只读/独立output；原三份bytes/hash/observations封存，TE/ART后续各自决定，不从exit或selfcheck造candidate | 未执行 / NOT RUN |
| IG-MF-002 / MF-04单建议UTF-8 .md/.markdown边界10MiB、chunked超限/断流/异bytes重放/恶意HTML/path/伪base | 一个file/B/S/author/token绑定，完整readback后READY；失败/UNKNOWN保留原intake无重复上传/dispatch；安全隔离不变Revision | 未执行 / NOT RUN |
| IG-MF-003 / MF-11错session/Run/lease/fencing/hash/manifest/JSON重复key、取消/到期late、第二final异hash | 原observation分域完整复验；错来源隔离/迟到仅历史，UNKNOWN不second invoke、不空final、不覆写raw | 未执行 / NOT RUN |
| IG-MF-004 / MF-12合法legacy {request:RenderRequest}及新flat Markdown请求；wrong operation/profile/schema/digest/identityMap/inputHash、roundTrip/checksum/UNKNOWN | legacy在request_render@1.0按原renderPolicyRef/stableIdempotencyKey/requestedAt与支持集处理，在request_markdown_render@1.0拒shape；新Markdown只走新入口、送旧入口拒绝，无自动转换/fallback；新binding的真实originalOperation/原请求/hash与技术round-trip精确核，错误无success，ART才注册；旧消费者/分析profile不扩大 | 未执行 / NOT RUN |

## 已实现的 Markdown Renderer 技术子用例（#270）

实现权威为 [IG §已实现的确定性 Markdown Renderer](../module-specs/Module-Spec-007-IntegrationGateway.md#已实现的确定性-markdown-renderer270)。下表只把 #270 实际执行的技术子用例标为 PASS；IG-MF-001～004 的整行仍为 `NOT RUN`。

| ID / 归属 | 输入 | 可核验预期 | 实际 / 结果 |
|---|---|---|---|
| IG-MF-004-T1 / Renderer 确定性 | 封闭 `artifact.markdown_document.schema@1.0` payload（标题、段落含 STRONG、分隔线、有序列表、含转义 pipe 与 blank cell 的表） | 同一 tree 两次渲染 bytes/checksum 相同，输出形状固定为 `## …`/`**…**`/`---`/`2. …`/`| … |` 与三连字符分隔行；`MARKDOWN_RENDERER_PROFILE` 冻结 | 已执行 / PASS |
| IG-MF-004-T2 / Renderer 边界 | `renderMarkdownInline` 的控制字符、STRONG/EMPHASIS 组合、inline code fence 加长、`<br>` 硬换行、前导空白、`[^`/`](`/`![` 序列；checkbox 样式的列表项；非封闭 profile payload | 控制字符转义后语义不变；三重 marker 用 `***`；code 内反引号自动加长 fence；硬换行输出 `<br>`；前导空白返回 `INTEGRATION_MARKDOWN_RENDER_INVALID`；会读回成链接/图片/脚注的序列与 checkbox 列表项被转义；非法 payload 返回 `INTEGRATION_RENDER_INPUT_MISMATCH` | 已执行 / PASS |
| IG-MF-004-T3 / 跨模块 round-trip | 已检入 procurement 快照与全部聚焦 fixture | ART `verifyMarkdownRoundTrip` 对 renderer 输出重新 `parse`，tree/身份/cv1 Hash 相等；不一致返回 `ARTIFACT_MARKDOWN_LOSSY` | 已执行 / PASS（`ART-MF-006-T2` 同批证据） |

未执行：`request_markdown_suggestion_intake@1.0`、`get_markdown_suggestion_intake@1.0`、`request_markdown_render@1.0`、`get_markdown_render_binding@1.0`、原输出观察、Attempt/Binding/Representation 接线、真实 Host/Provider/object store/HTTP/browser 与人工验收。

## Markdown Attempt / Binding 技术验收（#279）

`tests/persistence/markdown-review.test.ts` 承担 IG-MF-004 的本切片：实际 FROZEN Canonical→确定性 renderer→原 output/receipt staging/readback→ART round-trip→finalize→RawReceipt/Binding→登记。验证同 key 原 Receipt 重放、错误 renderer digest/original operation、failed/late 无成功 Binding、finalize UNKNOWN、显式恢复原 Attempt/对象版本/Receipt 以及当前 Service 撤权。旧 renderer/Representation 回归仍由原 persistence suite 验证。生产外部 Host/Renderer/Ceph/OpenBao 为 NOT RUN。
