# Module-Test-006-ReleasePublication

版本：v0.3
日期：2026-08-18
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA TESTS PASSING 2026-08-18 / PR-14 REVIEW REMEDIATED 2026-08-18`

对应规格：[`Module-Spec-006-ReleasePublication.md`](../module-specs/Module-Spec-006-ReleasePublication.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| RP-API-D-001 | Design | ReleasePublication Module Spec 与 Catalog | 12 Command、5 Query、8 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=5 events=8`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| RP-API-U-001 | Unit | 未 fully approved Revision 请求 Authorize | 拒绝 `RELEASE_REVISION_NOT_APPROVED`/not ready | 无运行时实现 | `NOT RUN` |
| RP-API-U-002 | Unit | PREPARED 后替换 Representation/Recipient/Destination | 拒绝 `RELEASE_PACKAGE_FROZEN`，要求新 Release | 无运行时实现 | `NOT RUN` |
| RP-API-U-003 | Unit | same stable key 不同 packageHash Receipt | 拒绝 attempt/receipt conflict，原事实不覆盖 | 无运行时实现 | `NOT RUN` |
| RP-API-C-001 | Contract | Agent ActorSnapshot 带 actingFor Human Authorize | Human-only Contract 拒绝，不调用外部 Publisher | **Schema 层**：`release.authorize_release` 与 `release.recall_release` 在 `authorizingHumanRef` 上强制 `principalKind: HUMAN`，Agent principalKind 直接被 Schema 拒绝（见 `release-authorize-release-command-agent-forbidden.json` / `release-recall-release-command-agent-forbidden.json`）。**运行时**：ActorSnapshot / actingFor / envelope actor 必须为 Human 的完整不变量是 Runtime TODO，本 Issue 仅建立 Schema 层的 HUMAN_ONLY guard | `PARTIAL — SCHEMA PASS (authorizingHumanRef principalKind), RUNTIME TODO (ActorSnapshot / actingFor)` |
| RP-API-C-002 | Contract | Raw Receipt 与 release/destination/package 不匹配 | 不形成 Formal Receipt；记录 target mismatch | 字段级 `formalReceiptSubmission` 强制携带 release/destination/package/attempt 引用；运行时校验待落地 | `PARTIAL — SCHEMA PASS, RUNTIME TODO` |
| RP-API-C-003 | Contract | `record_publication_failure` 提交 `outcome: SUCCEEDED/PENDING` 或缺失 `occurredAt` | Schema 拒绝 outcome 非 `FAILED|UNKNOWN`；缺失 `occurredAt` 拒绝 | `release-record-publication-failure-command-illegal-outcome.json`（outcome 拒绝）、`release-publication-failed-event-illegal-outcome.json`（event outcome 拒绝）、`release-record-publication-failure-command-missing-occurred-at.json`（required 拒绝） | `PASS — FIELD SCHEMA` |
| RP-API-C-004 | Contract | `PublicationAttemptRequested` 携带 presigned URL / 临时下载链接 | Schema 拒绝（公开 Event 不允许附加字段） | `release-publication-attempt-requested-event-presigned-url.json` 触发 `additionalProperties` 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-005 | Contract | Formal Receipt Command 携带 `recipientEmail/recipientPhone/personalName` | Schema 拒绝（Formal Receipt 不应包含敏感接收方明细） | **Schema 层**：`formalReceiptSubmission` 在 receipt 顶层 `additionalProperties: false`，因此位于 receipt 直属字段的 `recipientEmail` 等被拒（`release-record-publication-receipt-command-recipient-details-leak.json`）。**未覆盖**：Module-Spec-006 §2 把 `providerResult` 定义为 `CanonicalJson`，本 Issue 保留该开放语义；将敏感字段塞入 `providerResult` 不会被 Schema 层拦截，必须由运行时 Receipt Validator / Publisher 在 Provider Result 入库前进行 PII 字段白名单或脱敏 | `PARTIAL — SCHEMA PASS (receipt top-level closure), RUNTIME TODO (providerResult PII minimization)` |
| RP-API-C-006 | Contract | `PublicationSucceeded` 携带 `deliveredDocumentBody` / `informalFeishuSend` | Schema 拒绝未知字段 | **Schema 层**：`PublicationSucceeded` payload 严格 `additionalProperties: false`，未知字段被拒（`release-publication-succeeded-event-file-body-leak.json` 文件正文、`release-publication-succeeded-event-plain-feishu-send.json` 额外标记字段）。**未覆盖**：普通飞书文件发送冒充 Formal Release 的来源链检查（必须证明一条未经 `authorize_release` 的 IntegrationGateway 消息无法产出 `PublicationSucceeded`）是运行时验证，由 RP-API-E-002 覆盖；本 Schema 不持该事实 | `PARTIAL — SCHEMA PASS (unknown-field closure), PROVENANCE RUNTIME TODO (RP-API-E-002)` |
| RP-API-C-007 | Contract | `ReleaseView` Result Data 携带 `approvedDocumentBody` | Schema 拒绝（Result Data 不得包含未授权字段） | `release.get_release` Result 拒绝 unauthorized 字段；`releaseView.attemptRefs / receiptRefs` 维持 Module-Spec §4 定义的 `ObjectRef[]` / `ContentAddressedRef[]` 普通数组语义（不施加 `uniqueItems`，保留 API-Contract v0.1 §3 的 `T[]` 与 `Set<T>` 区分） | `PASS — FIELD SCHEMA` |
| RP-API-E-001 | E2E | 两个 Destination 一成功一失败 | 状态 PARTIALLY_RELEASED；成功 Receipt 保留；失败项同 Package 幂等重试 | 无 Publisher / Receipt Validator | `NOT RUN` |
| RP-API-E-002 | E2E | 普通飞书文件发送成功与正式 REL 路径对比 | 只有正式授权 Release 产生 Formal Receipt/Completion Event | 无飞书/Release 运行时；同来源链不变量（Envelope actor + ActorSnapshot + Authorization Decision + Release Authorization）由 Runtime Handler / Receipt Validator 共同保证 | `NOT RUN` |
| RP-API-M-001 | Manual | REL-801 冻结 Package Fixture | 审核者能核对 Revision、ABS、RRS、Package、Destination、Attempt 和 Receipt Hash 链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- 设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 字段级 Schema 测试：RP-API-C-002 / C-003 / C-004 / C-007 全部 `PASS`；RP-API-C-001 / C-005 / C-006 由 Schema 层部分 `PASS`，其余不变量（ActorSnapshot / actingFor 完整检查、FormalReceipt.providerResult PII 最小化、普通飞书发送冒充 Formal Release 的来源链）由 Runtime Handler / Publisher / Receipt Validator 共同保证，本 Issue 不假装覆盖。
- `pnpm clean && pnpm verify` 输出：`catalog=200 registry=200 schema_status={"FULL":177,"ENVELOPE_ONLY":23}`，release-publication 模块 25 个操作全部 `FULL`。
- PR #14 review remediation（v0.3）：
  - P1：`PublicationFailureSubmission.occurredAt` 现作为 required，新增 `release-record-publication-failure-command-missing-occurred-at.json` 回归测试。
  - P2：把 7 个普通数组（`attemptRefs / receiptRefs / triggeringRefs / affectedDestinations / requiredActions / publicationAttemptPage.sourceWatermarks / publicationReceiptPage.sourceWatermarks`）的 `uniqueItems` 移除，恢复 API-Contract v0.1 §3 的 `T[]` 语义；保留 `Set<T>` / `NonEmptySet<T>` 上的 `uniqueItems`。
- 运行时实现（Unit / E2E / Manual）尚未落地，由后续 PR / Issue 推进。
- 测试遗留：未创建临时脚本或测试文件；所有 25 个 happy-path / negative-path 场景在测试文件中以确定性方式构造。
