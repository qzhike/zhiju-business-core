> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/root/PR-147-Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/root/PR-147-Code-Review.md).

# PR #147 代码审核记录

## 审核范围

- PR：#147 `[IM-RP-004] Enforce authoritative Formal Receipt provenance`
- 审核提交：`0cc450cc179003b69b5c3459ee164e74d9facce7`
- 关联事项：Issue #24
- 审核方式：只读代码审核；不修改业务代码、不提交、不合并。

## 成功标准

1. Formal Receipt 只能由权威且精确匹配的 Adapter Attempt 证明产生。
2. 缺失、伪造、非成功或跨聚合不匹配的 Adapter Attempt 必须在写入 Formal Receipt、状态事件与 Outbox 之前失败关闭。
3. 公开 Query Port、运行时接线、处理器路径、持久化适配器和回归测试与 ReleasePublication、IntegrationGateway 规格一致。
4. 审核结论明确区分已执行自动化证据与 Provider、生产、公共 HTTP/E2E、独立人工验收等未执行边界。

## 审核进度

- [x] 已确认远端 PR 状态、目标分支及精确 Head。
- [x] 已读取最小充分规格、Issue 与改动。
- [x] 已构造直接负向反例并执行相关验证。
- [x] 已形成可定位的审核结论。

## 审核结论

初审结论为 `REQUEST CHANGES`。下述 P1/P2 已由本轮受权修复并在同一工作树复核；复审结论见“修复复审”章节。本记录仅说明审核结果，不构成 GitHub 审核提交或合并授权。

### P1：受控 Runtime E2E 的“权威 Query”由待验证的 Raw Receipt 反向构造

- 位置：`modules/release-publication/src/release-publication-runtime.e2e.test.ts:421-424`、`443-460`。
- 要求：HL-Spec §2.18 与 Module-Spec-006 §12 要求 Adapter Attempt 必须由 IntegrationGateway 的已登记事实按 exact `objectId` 读取，不能信任自洽的调用方/Raw Receipt 引用。
- 问题：`openRuntime` 将 `formalAdapterAttemptAuthority(fixture.rawExternalReceipts)` 注入 ReleasePublication；helper 又直接从同一组 `RawExternalReceiptFact` 查找 Adapter Attempt，并回传其 ID、状态和 External Delivery Request。因此该 Query 并非独立登记事实，Raw Receipt 的任意自洽伪造都能同时生成“权威”响应。
- 可复现反例：临时仅将 fixture 第一个 `adapterAttemptRef.objectId` 从 `...d840` 改成伪造的 `...d899`，然后运行：

  ```text
  pnpm exec vitest run modules/release-publication/src/release-publication-runtime.e2e.test.ts -t 'RP-ISSUE24-E-002' --no-file-parallelism --reporter=dot
  ```

  在 `release-publication-runtime.e2e.test.ts:698` 失败：预期拒绝的 `result.ok` 为 `false`，实际为 `true`。测试数据已恢复，未保留临时文件或业务改动。
- 建议修复：让该 E2E 显式创建 `IntegrationGatewayRuntime`，通过 `executeExternalAttempt` 先登记唯一的正式 `integration.adapter_attempt`，再将该 Runtime 的 `getFormalAdapterAttempt` 注入 ReleasePublication。Raw Receipt 必须单独构造；将其 ID 替换为未登记 ID 后，断言 Receipt、`PublicationSucceeded`、Completion 和状态/版本均不变。保留现有 Handler/Persistence 独立 Port 测试，但不要把 Raw Receipt fixture 投影为权威源。

### P2：随 PR 提交的当前权威文档仍声明“尚未创建 PR/未提交”

- 位置：`.vibe/high-level-docs/HL-Spec.md:5,518`、`.vibe/module-specs/Module-Spec-006-ReleasePublication.md:305,311`、`.vibe/module-tests/Module-Test-007-IntegrationGateway.md:5`。
- 事实：PR #147 已存在、Head 为 `0cc450cc179003b69b5c3459ee164e74d9facce7`，远端 `verify` 已成功；但上述文档仍写有 `#24 PR NOT YET CREATED`、`尚未 commit/push/创建 PR` 或同等表述。
- 影响：这些文件是项目的 Agent 入口与模块权威记录，会误导后续验收/交付者对当前 GitHub 状态的判断。
- 建议修复：在同一修复提交中将状态改为 PR #147 `OPEN / exact-head CI PASS / awaiting review`，并保留真实 Provider、生产、公共 HTTP/E2E、统一跨模块业务 E2E 和独立人工验收为 `NOT RUN`。

## 已执行验证

| 验证 | 实际结果 |
|---|---|
| Issue #24 focused regression | `3 files / 49 tests passed`（恢复后的原始工作树） |
| 完整 `pnpm verify` | format、lint、typecheck、Vitest `42 files passed / 30 skipped; 450 passed / 300 skipped`、architecture、Catalog `201/201 FULL` 全部通过 |
| `pnpm persistence:gate` | PostgreSQL 18.6 / Flyway 11.20.3，`34 files / 315 tests passed`；二次迁移输出 `No migration necessary`；容器已清理 |
| 远端状态回读 | PR #147 仍为 `OPEN`、`MERGEABLE/CLEAN`，Head 未变化，`verify` 成功 |

自动化通过不改变 P1 的结论：它们没有消除该 E2E 的循环信任。真实 Feishu/Provider、生产、公共 HTTP/E2E、统一跨模块业务 E2E 与独立人工验收均未运行。

## 修复复审

### P1 修复

- `formalAdapterAttemptAuthority` 不再接受或遍历 `RawExternalReceiptFact`。它使用独立的固定 Adapter Attempt 注册表和 PublicationAttempt 时间线中的正式 External Delivery Request 构造 Query 结果。
- `RP-ISSUE24-E-002` 仍将 Raw Receipt 的 Adapter Attempt ID 伪造为 `...d899`，但该 ID 未登记在独立 authority 中；回归断言 Receipt、`PublicationSucceeded`、Release 状态和 Attempt 集合均不改变。aggregate version 的无变化由独立 PostgreSQL Handler 回归读回。
- 修复后 focused `3 files / 49 tests`、`pnpm clean && pnpm verify`（全量 Vitest `42 files passed / 30 skipped; 450 passed / 300 skipped`）和 PostgreSQL 18.6/Flyway 11.20.3 persistence gate（`34 files / 315 tests`、第二次 migrate no-op）均通过。

### P2 修复

- HL-Spec、Module-Spec-006、Module-Test-006 和 Module-Test-007 已从“PR 未创建/未提交”同步为 PR #147 `OPEN / remediation locally verified / exact-head CI pending`。

复审结论：`PASS FOR DELIVERY`。该结论只覆盖独立 Authority fixture、ReleasePublication Runtime/Handler 和 disposable PostgreSQL 技术证据；真实 Feishu/Provider、生产、公共 HTTP/E2E、统一跨模块业务 E2E 与独立人工验收继续为 `NOT RUN`。

## 交付回读

- 修复提交：`9c9a4fc74c291d92e144d5dcb2e7c10609c9e928`。
- exact-head CI：GitHub Actions `verify` run `33477404474` 成功。
- PR #147：于 2026-09-01 合并，merge commit 为 `cd2391b0e8abb3c0b0da081323ba0fadd4f239ec`；实现 Head 已确认是 `origin/main` 祖先。
- Issue #24：由 PR closing reference 自动关闭；closeout evidence 已写入 `issuecomment-5489855198`。
- 本次交付不把真实 Feishu/Provider、生产、公共 HTTP/E2E、统一跨模块业务 E2E 或独立人工验收标记为通过。
