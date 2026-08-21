# Module-Test-006-ReleasePublication

版本：v0.5
日期：2026-08-21
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA TESTS PASSING 2026-08-18 / PR-14 REVIEW REMEDIATED 2026-08-18 / PR-14 SECOND-ROUND REMEDIATED 2026-08-18 / RUNTIME RECEIPT VALIDATOR UNIT+E2E PASSING 2026-08-21 (#15)`

对应规格：[`Module-Spec-006-ReleasePublication.md`](../module-specs/Module-Spec-006-ReleasePublication.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| RP-API-D-001 | Design | ReleasePublication Module Spec 与 Catalog | 12 Command、5 Query、8 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=5 events=8`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| RP-API-U-001 | Unit | 未 fully approved Revision 请求 Authorize | 拒绝 `RELEASE_REVISION_NOT_APPROVED`/not ready | 无运行时实现 | `NOT RUN` |
| RP-API-U-002 | Unit | PREPARED 后替换 Representation/Recipient/Destination | 拒绝 `RELEASE_PACKAGE_FROZEN`，要求新 Release | 无运行时实现 | `NOT RUN` |
| RP-API-U-003 | Unit | same stable key 不同 packageHash Receipt | 拒绝 attempt/receipt conflict，原事实不覆盖 | Runtime Receipt Validator（#15 / IM-RP-001）：`receipt-validator.test.ts` 覆盖 5 条——同 stable key 不同 packageHash → `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT` 且 ledger 原 Receipt 原样保留；同 rawReceiptRef 重复提交 → `RELEASE_RECEIPT_ALREADY_RECORDED`；occurredAt 晚于 requestedAt + deliveryTimeout → `RELEASE_RECEIPT_STALE`；attempt 未登记 / destination 或 package 不匹配 → `RELEASE_RECEIPT_TARGET_MISMATCH`；合法早到 Receipt 接受并形成 Formal Receipt | `PASS — RUNTIME UNIT (#15)` |
| RP-API-C-001 | Contract | Agent ActorSnapshot 带 actingFor Human Authorize | Human-only Contract 拒绝，不调用外部 Publisher | **Schema 层**：`release.authorize_release` 与 `release.recall_release` 在 `authorizingHumanRef` 上强制 `principalKind: HUMAN`，Agent principalKind 直接被 Schema 拒绝（见 `release-authorize-release-command-agent-forbidden.json` / `release-recall-release-command-agent-forbidden.json`）。**运行时**：ActorSnapshot / actingFor / envelope actor 必须为 Human 的完整不变量是 Runtime TODO，本 Issue 仅建立 Schema 层的 HUMAN_ONLY guard | `PARTIAL — SCHEMA PASS (authorizingHumanRef principalKind), RUNTIME TODO (ActorSnapshot / actingFor)` |
| RP-API-C-002 | Contract | Raw Receipt 与 release/destination/package 不匹配 | 不形成 Formal Receipt；记录 target mismatch | **Schema 层**：`formalReceiptSubmission` 强制 required 携带 `attemptRef` / `destinationId` / `packageRef` / `rawReceiptRef` / `receiptPayloadHash`，缺失任一即拒（`release-record-publication-receipt-command-missing-raw-receipt-ref.json` 验证 rawReceiptRef 必填）。**运行时**：跨 aggregate 的 Raw Receipt vs release/destination/package/attempt 不匹配检测、以及同 stable key 不同 packageHash 去重（duplicate / late）由 Runtime Receipt Validator 承担；本 Issue 仅交付 Schema 结构前提，duplicate / late 的 Runtime 实现由 #15（IM-RP-001）承接 | `PARTIAL — SCHEMA PASS (structural prerequisites), RUNTIME TODO (#15)` |
| RP-API-C-003 | Contract | `record_publication_failure` 提交 `outcome: SUCCEEDED/PENDING` 或缺失 `occurredAt` | Schema 拒绝 outcome 非 `FAILED|UNKNOWN`；缺失 `occurredAt` 拒绝 | `release-record-publication-failure-command-illegal-outcome.json`（outcome 拒绝）、`release-publication-failed-event-illegal-outcome.json`（event outcome 拒绝）、`release-record-publication-failure-command-missing-occurred-at.json`（required 拒绝） | `PASS — FIELD SCHEMA` |
| RP-API-C-004 | Contract | `PublicationAttemptRequested` 携带 presigned URL / 临时下载链接 | Schema 拒绝（公开 Event 不允许附加字段） | `release-publication-attempt-requested-event-presigned-url.json` 触发 `additionalProperties` 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-005 | Contract | Formal Receipt Command 携带 `recipientEmail/recipientPhone/personalName` | Schema 拒绝（Formal Receipt 不应包含敏感接收方明细） | **Schema 层**：`formalReceiptSubmission` 在 receipt 顶层 `additionalProperties: false`，因此位于 receipt 直属字段的 `recipientEmail` 等被拒（`release-record-publication-receipt-command-recipient-details-leak.json`）。**未覆盖**：Module-Spec-006 §2 把 `providerResult` 定义为 `CanonicalJson`，本 Issue 保留该开放语义；将敏感字段塞入 `providerResult` 不会被 Schema 层拦截，必须由运行时 Receipt Validator / Publisher 在 Provider Result 入库前进行 PII 字段白名单或脱敏 | `PARTIAL — SCHEMA PASS (receipt top-level closure), RUNTIME TODO (providerResult PII minimization)` |
| RP-API-C-006 | Contract | `PublicationSucceeded` 携带 `deliveredDocumentBody` / `informalFeishuSend` | Schema 拒绝未知字段 | **Schema 层**：`PublicationSucceeded` payload 严格 `additionalProperties: false`，未知字段被拒（`release-publication-succeeded-event-file-body-leak.json` 文件正文、`release-publication-succeeded-event-plain-feishu-send.json` 额外标记字段）。**未覆盖**：普通飞书文件发送冒充 Formal Release 的来源链检查（必须证明一条未经 `authorize_release` 的 IntegrationGateway 消息无法产出 `PublicationSucceeded`）是运行时验证，由 RP-API-E-002 覆盖；本 Schema 不持该事实 | `PARTIAL — SCHEMA PASS (unknown-field closure), PROVENANCE RUNTIME TODO (RP-API-E-002)` |
| RP-API-C-007 | Contract | `ReleaseView` Result Data 携带 `approvedDocumentBody` | Schema 拒绝（Result Data 不得包含未授权字段） | `release.get_release` Result 拒绝 unauthorized 字段；`releaseView.attemptRefs / receiptRefs` 维持 Module-Spec §4 定义的 `ObjectRef[]` / `ContentAddressedRef[]` 普通数组语义（不施加 `uniqueItems`，保留 API-Contract v0.1 §3 的 `T[]` 与 `Set<T>` 区分） | `PASS — FIELD SCHEMA` |
| RP-API-E-001 | E2E | 两个 Destination 一成功一失败 | 状态 PARTIALLY_RELEASED；成功 Receipt 保留；失败项同 Package 幂等重试 | 失败路径（record_publication_failure）仍无 Runtime Handler；一成功一迟到的变体由 RP-API-E-003 覆盖 | `NOT RUN — failure path pending runtime handler` |
| RP-API-E-002 | E2E | 普通飞书文件发送成功与正式 REL 路径对比 | 只有正式授权 Release 产生 Formal Receipt/Completion Event | 无飞书/Release 运行时；同来源链不变量（Envelope actor + ActorSnapshot + Authorization Decision + Release Authorization）由 Runtime Handler / Receipt Validator 共同保证 | `NOT RUN` |
| RP-API-E-003 | E2E | REL-801 fixture：两个 Destination 一早到成功一迟到回执（`tests/fixtures/runtime/rel-801-late-receipt-timeline.json` 受控序列回放，非真实飞书） | 早到 Receipt 保留；迟到项拒绝 `RELEASE_RECEIPT_STALE`；状态 PARTIALLY_RELEASED | `release-publication-runtime.e2e.test.ts` 回放 fixture 时间线：Destination A 成功 Receipt 进入 ledger，Destination B 迟到提交被拒且不改变 A 的事实，Release 评估为 PARTIALLY_RELEASED | `PASS — RUNTIME E2E (#15, simulated provider)` |
| RP-API-M-001 | Manual | REL-801 冻结 Package Fixture | 审核者能核对 Revision、ABS、RRS、Package、Destination、Attempt 和 Receipt Hash 链 | REL-801 late-receipt 时间线 fixture 已准备（`tests/fixtures/runtime/rel-801-late-receipt-timeline.json`，含 attempt → rawReceipt → late submission 三段时间线），可沿时间线核对状态；完整冻结 Package / 真实 Provider 人工验收仍不可执行 | `PARTIAL — timeline fixture ready, full manual walkthrough NOT RUN` |

## 本阶段结果

- 设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 字段级 Schema 测试：RP-API-C-002 / C-003 / C-004 / C-007 全部 `PASS`；RP-API-C-001 / C-005 / C-006 由 Schema 层部分 `PASS`，其余不变量（ActorSnapshot / actingFor 完整检查、FormalReceipt.providerResult PII 最小化、普通飞书发送冒充 Formal Release 的来源链）由 Runtime Handler / Publisher / Receipt Validator 共同保证，本 Issue 不假装覆盖。
- 当时切片 `pnpm clean && pnpm verify` 输出：`catalog=200 registry=200 schema_status={"FULL":177,"ENVELOPE_ONLY":23}`，release-publication 模块 25 个操作全部 `FULL`。Issue #9 退出 Gate 时全仓已为 `schema_status={"FULL":200}`（无 `ENVELOPE_ONLY`）。
- PR #14 review remediation（v0.3）：
  - P1：`PublicationFailureSubmission.occurredAt` 现作为 required，新增 `release-record-publication-failure-command-missing-occurred-at.json` 回归测试。
  - P2：把 7 个普通数组（`attemptRefs / receiptRefs / triggeringRefs / affectedDestinations / requiredActions / publicationAttemptPage.sourceWatermarks / publicationReceiptPage.sourceWatermarks`）的 `uniqueItems` 移除，恢复 API-Contract v0.1 §3 的 `T[]` 语义；保留 `Set<T>` / `NonEmptySet<T>` 上的 `uniqueItems`。
- PR #14 second-round remediation（v0.4）：
  - P1（duplicate / late receipt 验收边界）：Issue #5 验收目标第 4 条中"重复/迟到回执"运行时实现不属于字段 Schema 范围，已拆分为 #15（IM-RP-001）。Schema 层补强 `formalReceiptSubmission.rawReceiptRef` required fixture 与测试（`release-record-publication-receipt-command-missing-raw-receipt-ref.json`），为 Runtime 去重提供结构前提；Runtime Validator 与跨 aggregate 拒收由 #15 实现。
  - P1（PR / Issue 描述一致性）：本 Module-Test 与 Issue #5 验收清单已同步到 v0.4，明确列出 Schema PASS / Runtime TODO 的归属。
- 运行时实现（Unit / E2E / Manual）尚未落地，由后续 PR / Issue 推进；duplicate / late 由 #15 承接。
- IM-RP-001（#15）Runtime Receipt Validator（2026-08-21）：
  - RP-API-U-003 全部 5 条单元测试 `PASS`（`modules/release-publication/src/receipt-validator.test.ts`）；
  - 新增 RP-API-E-003：E2E 回放 `tests/fixtures/runtime/rel-801-late-receipt-timeline.json`，一早到成功一迟到，PARTIALLY_RELEASED 保留早到 Receipt，迟到项触发 `RELEASE_RECEIPT_STALE`；
  - 持久化载体为 In-Memory `ReleaseReceiptLedger`（DDL / 真实 Repository 仍 `NOT RUN`）；迟到窗口 `deliveryTimeout` 由调用方注入，未改任何 Contract Schema；
  - 飞书 / 邮件 Provider 真实注入的 late receipt 仍 `NOT RUN`（IntegrationGateway Runtime 由 #17 追踪）。
- 测试遗留：未创建临时脚本或测试文件；所有 25 个 happy-path / negative-path 场景在测试文件中以确定性方式构造。
