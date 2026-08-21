# IM-RP-001 Runtime Receipt Validator Verification Report（Issue #15）

日期：2026-08-21
分支：`galendai/15-im-rp-001-runtime-duplicate-late-receipt-detecti`
对应计划：[`Task-Plan.md`](./Task-Plan.md) / [`PR-21-Remediation-Plan.md`](./PR-21-Remediation-Plan.md)

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm format:check` | `PASS` |
| `pnpm lint` | `PASS`（0 error / 0 warning） |
| `pnpm typecheck` | `PASS` |
| `pnpm test` | `PASS` — 15 test files / **302 tests**（基线 287 + 本切片 15） |
| `pnpm architecture` | `PASS` — `architecture_boundaries=PASS source_roots=10` |
| `pnpm contracts:check` | `PASS` — `schema_status={"FULL":200}`、compatibility `baseline=v1.0 findings=0` |

本切片未修改任何 Contract Schema / Registry / baseline。

## PR #21 Review Remediation（本轮）

| 审查项 | 处置 | 证据 |
|---|---|---|
| P1-1 package↔release 绑定 | `startPublicationAttempt` / `recordPublicationReceipt` 校验完整 `packageRef.releaseRef`，并在 `ReleaseState` 冻结首个 package | `release-publication-runtime.e2e.test.ts` foreign-release 负例 |
| P1-2 RawExternalReceipt provenance | `RawExternalReceiptRepository` + objectType/存在性/release/destination/packageHash/attempt 校验 | `receipt-validator.test.ts` RP-API-C-002 |
| P1-3 原子落账 | Ledger `compareAndSaveReceipt`；Runtime 只走 `recordFormalReceipt` | `receipt-validator.test.ts` compareAndSave 竞争用例 |
| P1-4 Integration Provider fixture | **重定范围**：该项归属 #17 / `NOT RUN`；删除「等价覆盖」表述 | 本报告 NOT RUN；Issue #15 评论 |
| P1-5 Issue #5 关闭结论 | **不关闭 #5**；保留 ActorSnapshot / providerResult PII / 普通飞书来源链 Runtime TODO | HL-Spec / Module-Test-006 / 本结论 |

## 新增 / 更新测试清单

单元（`modules/release-publication/src/receipt-validator.test.ts`）：

| 测试 | 断言要点 |
|---|---|
| RP-API-U-003a–e 及注册/重试 | 同前：冲突 / 重复 / stale / target mismatch / 接受 |
| RP-API-C-002 Raw provenance | 非 `integration.raw_external_receipt` objectType、未加载事实、或 release/destination/packageHash/attempt 溯源字段不匹配 → `RELEASE_RECEIPT_TARGET_MISMATCH`，不落账 |
| compareAndSave 竞争 | 同 stable key 二次 insert → `RELEASE_RECEIPT_ALREADY_RECORDED`，原 digest 保留 |

E2E（`modules/release-publication/src/release-publication-runtime.e2e.test.ts`）：

| 测试 | 断言要点 |
|---|---|
| RP-API-E-003 主时间线 | 早到接受、迟到 STALE、重放 ALREADY_RECORDED、终态 PARTIALLY_RELEASED；fixture 预置 RawExternalReceipt 事实 |
| Stale 拒绝不改账 | 仅 Step 4：PUBLISHING / receiptRefs=0 |
| Foreign package 负例 | 外 Release 的 packageRef 拒 attempt 与 receipt；状态保持 AUTHORIZED |
| Start-after-partial | 早到 Receipt 后启动另一 Destination attempt / 幂等重入，不降级 `PARTIALLY_RELEASED` |

## 人工验收口径（REL-801 / RP-API-M-001）

`tests/fixtures/runtime/rel-801-late-receipt-timeline.json` 含 `rawExternalReceipts` 与 attempt → formal receipt 时间线。这是 **ReleasePublication Runtime 受控 fixture**，不是 IntegrationGateway / 真实飞书 / 邮件 Provider 路径。

## 未执行的外部 / 人工验证（NOT RUN）

- PostgreSQL DDL / Migration / 真实 Repository 持久化（唯一约束需在真实 Repository 兑现 `compareAndSaveReceipt`）；
- Integration 层飞书 / 邮件 Provider 注入 late receipt（明确归属 **Issue #17**，已从 #15 验收剔除）；
- HTTP Handler / Command Envelope 层接入；
- 完整 REL-801 冻结 Package 人工走查（Revision / ABS / RRS Hash 链核对）；
- Issue #5 剩余 Runtime 项：ActorSnapshot/actingFor、providerResult PII 最小化、普通飞书发送 Formal Release 来源链。

## 结论

在用户确认将 Integration Provider fixture 重定范围到 #17 之后，Issue #15 的 Runtime Receipt Validator 目标（单元、Runtime E2E fixture、package 绑定、Raw Receipt provenance、原子落账、`pnpm verify`）由本 PR 承担。

- **可以**在上述验证通过后关闭 Issue #15（不再要求本 PR 交付真实 Provider 注入）。
- **不可以**因本 PR 关闭 Issue #5；#5 仍有三项 Runtime 验收未完成。
- **不可以**将 Runtime 受控 fixture 描述为 Integration/Provider 等价覆盖。
