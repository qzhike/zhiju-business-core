# Module-Test-006-ReleasePublication

版本：v0.2
日期：2026-08-18
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA TESTS PASSING 2026-08-18`

对应规格：[`Module-Spec-006-ReleasePublication.md`](../module-specs/Module-Spec-006-ReleasePublication.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| RP-API-D-001 | Design | ReleasePublication Module Spec 与 Catalog | 12 Command、5 Query、8 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=5 events=8`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| RP-API-U-001 | Unit | 未 fully approved Revision 请求 Authorize | 拒绝 `RELEASE_REVISION_NOT_APPROVED`/not ready | 无运行时实现 | `NOT RUN` |
| RP-API-U-002 | Unit | PREPARED 后替换 Representation/Recipient/Destination | 拒绝 `RELEASE_PACKAGE_FROZEN`，要求新 Release | 无运行时实现 | `NOT RUN` |
| RP-API-U-003 | Unit | same stable key 不同 packageHash Receipt | 拒绝 attempt/receipt conflict，原事实不覆盖 | 无运行时实现 | `NOT RUN` |
| RP-API-C-001 | Contract | Agent ActorSnapshot 带 actingFor Human Authorize | Human-only Contract 拒绝，不调用外部 Publisher | `release.authorize_release` 与 `release.recall_release` 在 `authorizingHumanRef` 上强制 `principalKind: HUMAN`，Agent 直接被 Schema 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-002 | Contract | Raw Receipt 与 release/destination/package 不匹配 | 不形成 Formal Receipt；记录 target mismatch | 字段级 `formalReceiptSubmission` 强制携带 release/destination/package/attempt 引用；运行时校验待落地 | `PARTIAL — SCHEMA PASS, RUNTIME TODO` |
| RP-API-C-003 | Contract | `record_publication_failure` 提交 `outcome: SUCCEEDED/PENDING` | Schema 拒绝，仅允许 `FAILED|UNKNOWN` | `release-record-publication-failure-command-illegal-outcome.json` 与 `release-publication-failed-event-illegal-outcome.json` 触发 enum 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-004 | Contract | `PublicationAttemptRequested` 携带 presigned URL / 临时下载链接 | Schema 拒绝（公开 Event 不允许附加字段） | `release-publication-attempt-requested-event-presigned-url.json` 触发 `additionalProperties` 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-005 | Contract | Formal Receipt Command 携带 `recipientEmail/recipientPhone/personalName` | Schema 拒绝（Formal Receipt 不应包含敏感接收方明细） | `release-record-publication-receipt-command-recipient-details-leak.json` 触发 `additionalProperties` 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-006 | Contract | `PublicationSucceeded` 携带 `deliveredDocumentBody` / `informalFeishuSend` | Schema 拒绝（公开 Event 不得携带文件正文或冒充 Formal Release 的元数据） | `release-publication-succeeded-event-file-body-leak.json` 与 `release-publication-succeeded-event-plain-feishu-send.json` 触发 `additionalProperties` 拒绝 | `PASS — FIELD SCHEMA` |
| RP-API-C-007 | Contract | `ReleaseView` Result Data 携带 `approvedDocumentBody` | Schema 拒绝（Result Data 不得包含未授权字段） | `release.get_release` Result 拒绝 unauthorized 字段 | `PASS — FIELD SCHEMA` |
| RP-API-E-001 | E2E | 两个 Destination 一成功一失败 | 状态 PARTIALLY_RELEASED；成功 Receipt 保留；失败项同 Package 幂等重试 | 无 Publisher / Receipt Validator | `NOT RUN` |
| RP-API-E-002 | E2E | 普通飞书文件发送成功与正式 REL 路径对比 | 只有正式授权 Release 产生 Formal Receipt/Completion Event | 无飞书/Release 运行时 | `NOT RUN` |
| RP-API-M-001 | Manual | REL-801 冻结 Package Fixture | 审核者能核对 Revision、ABS、RRS、Package、Destination、Attempt 和 Receipt Hash 链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- 设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 字段级 Schema 测试（RP-API-C-001 / C-003 / C-004 / C-005 / C-006 / C-007）：`PASS`，由 `contracts/src/operations/release-publication.schema.test.ts` 覆盖；`pnpm verify` 全绿。
- `pnpm clean && pnpm verify` 输出：`catalog=200 registry=200 schema_status={"FULL":177,"ENVELOPE_ONLY":23}`，release-publication 模块 25 个操作全部 `FULL`。
- 运行时实现（Unit / E2E / Manual）尚未落地，由后续 PR / Issue 推进。
- 测试遗留：未创建临时脚本或测试文件；所有 25 个 happy-path / negative-path 场景在测试文件中以确定性方式构造。
