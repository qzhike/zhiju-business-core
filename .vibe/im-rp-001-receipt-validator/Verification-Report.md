# IM-RP-001 Runtime Receipt Validator Verification Report（Issue #15）

日期：2026-08-21
分支：`galendai/15-im-rp-001-runtime-duplicate-late-receipt-detecti`
对应计划：[`Task-Plan.md`](./Task-Plan.md)

## 验证命令与结果

| 命令 | 结果 |
|---|---|
| `pnpm format:check` | `PASS`（全部匹配 Prettier） |
| `pnpm lint` | `PASS`（0 error / 0 warning） |
| `pnpm typecheck` | `PASS`（`tsc -b` 无错误） |
| `pnpm test` | `PASS` — 15 test files / **297 tests**（基线 287 + 本切片 10） |
| `pnpm architecture` | `PASS` — `architecture_boundaries=PASS source_roots=10` |
| `pnpm contracts:check` | `PASS` — `public_api_generation=PASS operations=200`、`typescript_types=PASS payloads=200 query_results=44 core_contracts=6`、`catalog_registry=PASS catalog=200 registry=200 schema_status={"FULL":200}`、`compatibility=PASS baseline=v1.0 findings=0` |

本切片未修改任何 Contract Schema / Registry / baseline，contracts 门禁数字与 IM-01 exit gate 完全一致。

## 新增测试清单

单元（`modules/release-publication/src/receipt-validator.test.ts`，8 条）：

| 测试 | 对应用例 | 断言要点 |
|---|---|---|
| RP-API-U-003a | 同 stable key 不同 packageHash | `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT`；category=CONFLICT；原 Receipt（rawReceiptRef digest `cc…`）在 ledger 中原样保留；冲突 rawReceiptRef 未入库 |
| RP-API-U-003b | 同 rawReceiptRef 重复提交 | `RELEASE_RECEIPT_ALREADY_RECORDED`；category=CONFLICT |
| RP-API-U-003c | occurredAt 超窗（90s > 60s window） | `RELEASE_RECEIPT_STALE`；category=LIFECYCLE；retryDisposition=NEW_COMMAND_REQUIRED；ledger 无新增 Receipt |
| RP-API-U-003c boundary | occurredAt 恰在窗口边界（60s） | 接受（窗口为闭区间上界） |
| RP-API-U-003d | attempt 未登记 / destination 不匹配 / package 不匹配 | 三者均 `RELEASE_RECEIPT_TARGET_MISMATCH` |
| RP-API-U-003e | 合法早到 Receipt | 接受并形成 Formal Receipt record；同定义重复注册幂等成功 |
| attempt 注册冲突 | stable key 重绑不同 packageHash / destination | 注册期即拒 `RELEASE_ATTEMPT_IDEMPOTENCY_CONFLICT` |
| 重试共享 key | 同 key 两次 attempt（attemptNumber 1→2） | 注册均成功；仅第一条 Receipt 落账，第二条拒 ALREADY_RECORDED |

E2E（`modules/release-publication/src/release-publication-runtime.e2e.test.ts`，2 条，回放 `tests/fixtures/runtime/rel-801-late-receipt-timeline.json`）：

| 测试 | 断言要点 |
|---|---|
| RP-API-E-003 主时间线 | Step 3（Destination A 早到）接受；Step 4（Destination B 迟到 90s）拒 `RELEASE_RECEIPT_STALE`；Step 5（Step 3 原样重放）拒 `RELEASE_RECEIPT_ALREADY_RECORDED`；终态 `PARTIALLY_RELEASED`，succeeded=[A]，pending=[B]，receiptRefs=1 |
| Stale 拒绝不改账 | 仅回放至 Step 4：状态保持 PUBLISHING，receiptRefs=0 |

## 人工验收口径（REL-801 / RP-API-M-001）

`tests/fixtures/runtime/rel-801-late-receipt-timeline.json` 即审核者可沿读的时间线 fixture：
attempt A/B（requestedAt `2026-08-21T00:00:00Z`，同 packageHash `ab01…`）→ rawReceipt A（occurredAt `+5s`，digest `cc01…`）→ 迟到提交 B（occurredAt `+90s` > 60s 窗口）。每步带 `expect.outcome` 与终态断言。**注意**：这是受控 runtime fixture，不代表真实飞书 / 邮件 Provider 或数据库已运行。

## 未执行的外部 / 人工验证（NOT RUN）

- PostgreSQL DDL / Migration / 真实 Repository 持久化；
- 飞书 / 邮件 Provider 真实注入 late receipt（IntegrationGateway Runtime 由 #17 追踪）；
- HTTP Handler / Command Envelope 层接入；
- 完整 REL-801 冻结 Package 人工走查（Revision / ABS / RRS Hash 链核对）。

## 结论

Issue #15 的 Runtime Receipt Validator 验收目标中，单元测试、E2E Fixture、REL-801 时间线 fixture、`pnpm verify` 全绿四项已达成；Provider 真实注入项受 #17 阻塞，以受控 fixture 等价覆盖并在文档中显式声明。合并后 Issue #15 可关闭，Issue #5 方可由维护者执行 `Closes #5`。
