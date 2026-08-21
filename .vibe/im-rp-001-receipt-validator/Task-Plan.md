# IM-RP-001 Runtime Receipt Validator Task Plan（Issue #15）

日期：2026-08-21
状态：`IN PROGRESS`
对应 Issue：[#15](https://github.com/qzhike/zhiju-business-core/issues/15)
分支：`galendai/15-im-rp-001-runtime-duplicate-late-receipt-detecti`

## 目标

在 ReleasePublication Runtime 中落实 `release.record_publication_receipt` 的重复 / 迟到回执检测（承接 Issue #5 验收目标第 4 条中"重复/迟到回执"的运行时部分，即 Module-Test-006 的 RP-API-U-003）：

1. 同 stable key 不同 packageHash → 拒绝 `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT`，原 Receipt 不覆盖；
2. 同 `rawReceiptRef` 重复提交 → 拒绝 `RELEASE_RECEIPT_ALREADY_RECORDED`；
3. 迟到窗口（`occurredAt` 晚于 `attempt.requestedAt + deliveryTimeout`）→ 拒绝 `RELEASE_RECEIPT_STALE`；
4. E2E Fixture：同一 Package 两个 Destination 一成功一迟到，PARTIALLY_RELEASED 正确保留早到成功 Receipt；
5. REL-801 Manual Fixture：审核者能沿 attempt → rawReceipt → late submission 时间线核对状态。

## 范围决策（假设显式化）

| 决策 | 选择 | 依据 |
|---|---|---|
| 持久化载体 | `ReleaseReceiptLedger` 接口 + In-Memory 实现；DDL/Repository 仍 `NOT RUN` | HL-Spec §11 明确数据库验证 `NOT RUN`；IM-01 exit gate 不做 DDL/Migration/Repository |
| `policy.delivery.deliveryTimeout` | 不改 contracts Schema；迟到窗口作为 validator 显式入参注入 | Issue #15 依赖项注明"待与 Policy 域所有者确认"，本切片不代替该确认 |
| 错误码集合 | 三个 Issue 指定码 + 复用 Module-Spec-006 §6 已有 `RELEASE_RECEIPT_TARGET_MISMATCH`（attempt 不存在或 receipt 与 attempt 的 destination/package 不匹配）；新增 `RELEASE_RECEIPT_STALE` 入 §6 | Spec §6 已定义 TARGET_MISMATCH；STALE 为本 Issue 新增 |
| Runtime 形态 | 领域服务层（Validator + 薄编排 Runtime），不引入 Command Envelope / HTTP Handler | 仓库尚无任何 Runtime Handler 基础设施；模块骨架状态 |
| 与 Issue #5 关系 | PR 不写 `Closes #5`；#5 待本 PR 合并后由维护者关闭 | Issue #15 验收目标最后一条 |

## 非目标

- 不实现 PostgreSQL DDL、Migration、RLS、真实 Repository。
- 不实现飞书 / 邮件 Provider 的真实注入（IntegrationGateway Runtime 由 #17 追踪）；E2E 用受控 fixture 序列模拟 Provider 回执。
- 不改任何 Contract Schema / Registry / compatibility baseline（contracts 保持 FULL:200 不变）。
- 不实现 Publisher、complete_release 完整命令流、Recall 流程。

## 阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 文档先行：Module-Spec-006 §6 新增 `RELEASE_RECEIPT_STALE`、§9 状态更新；Module-Test-006 RP-API-U-003 归属更新 | `DONE` |
| 2 | 实现 `receipt-validator.ts`（稳定键索引 + 三类拒绝 + target mismatch 校验）与 `release-publication-runtime.ts`（outcome/PARTIALLY_RELEASED 评估） | `DONE` |
| 3 | 单元测试 RP-API-U-003 三条 + happy path + target mismatch；E2E 测试回放 REL-801 fixture | `DONE` |
| 4 | REL-801 Manual Fixture（attempt → rawReceipt → late submission 时间线 JSON） | `DONE` |
| 5 | `pnpm verify` 全绿 + Verification Report | `DONE` |

## 修改清单

1. 新建 `modules/release-publication/src/receipt-validator.ts`
2. 新建 `modules/release-publication/src/release-publication-runtime.ts`
3. 新建 `modules/release-publication/src/receipt-validator.test.ts`（Unit，RP-API-U-003）
4. 新建 `modules/release-publication/src/release-publication-runtime.e2e.test.ts`（E2E）
5. 新建 `tests/fixtures/runtime/rel-801-late-receipt-timeline.json`（Manual/E2E 共用可控 fixture）
6. 更新 `modules/release-publication/src/index.ts` 导出
7. 更新 `.vibe/module-specs/Module-Spec-006-ReleasePublication.md`
8. 更新 `.vibe/module-tests/Module-Test-006-ReleasePublication.md`
9. 更新 `.vibe/high-level-docs/HL-Spec.md` §11 状态段
10. 新建本目录 `Verification-Report.md`

## 测试用例计划

| ID | 层级 | 输入 | 预期输出 |
|---|---|---|---|
| RP-API-U-003a | Unit | 同 stableIdempotencyKey、不同 packageHash 的第二次 Receipt | `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT`；ledger 中原 Receipt 原样保留 |
| RP-API-U-003b | Unit | 同 rawReceiptRef（contentHash 相同）重复提交 | `RELEASE_RECEIPT_ALREADY_RECORDED` |
| RP-API-U-003c | Unit | occurredAt > requestedAt + deliveryTimeout | `RELEASE_RECEIPT_STALE` |
| RP-API-U-003d | Unit | attemptRef 未登记 / destinationId 或 packageRef 与 Attempt 不一致 | `RELEASE_RECEIPT_TARGET_MISMATCH` |
| RP-API-U-003e | Unit | 合法早到 Receipt | 接受并形成 Formal PublicationReceipt 事实 |
| RP-API-E-003 | E2E | REL-801：Destination A 早到成功、Destination B 迟到 | A Receipt 保留、B 拒 `RELEASE_RECEIPT_STALE`、状态 PARTIALLY_RELEASED |
