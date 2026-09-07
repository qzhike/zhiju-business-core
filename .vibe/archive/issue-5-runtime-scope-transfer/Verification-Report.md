> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-5-runtime-scope-transfer/Verification-Report.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-5-runtime-scope-transfer/Verification-Report.md).

# Issue #5 Runtime 范围迁移验证报告

日期：2026-08-21

## 决策

用户批准采用“路径 B”：Issue #5 仅负责 ReleasePublication 25 个字段级操作契约。PR #14 已完成该边界；未实现的 Runtime 验收不得继续隐含挂在 #5 下，也不得因 #5 关闭而视为 `PASS`。

## Runtime Owner 迁移

| 原验收边界 | 新 Owner | 当前状态 |
|---|---|---|
| Agent / `actingFor` 完整 ActorSnapshot、Envelope actor 与 AuthorizationDecision 不变量 | [Issue #22](https://github.com/qzhike/zhiju-business-core/issues/22) | `NOT RUN` |
| Formal Receipt `providerResult` PII 最小化 | [Issue #23](https://github.com/qzhike/zhiju-business-core/issues/23) | `NOT RUN` |
| 普通飞书发送与 Formal Release 来源链隔离（RP-API-E-002） | [Issue #24](https://github.com/qzhike/zhiju-business-core/issues/24) | `NOT RUN` |

重复 / 迟到回执 Runtime 已由 [Issue #15](https://github.com/qzhike/zhiju-business-core/issues/15) 完成并关闭。

## 一致性检查

| 检查项 | 预期 | 实际 | 结果 |
|---|---|---|---|
| Issue Owner | 三项 Runtime 工作各有独立 Issue、测试编号、依赖和关闭条件 | #22、#23、#24 已创建 | `PASS` |
| Issue #5 | 字段 Schema 验收完成；Runtime 明确迁移；合入前保持 OPEN | 正文已同步；范围决策评论已发布；Issue 仍为 OPEN | `PASS` |
| HL-Spec | 不再声明 #5 因三项 Runtime 工作保持 OPEN | 已更新为 #22–#24 Owner | `PASS — LOCAL` |
| Module-Test-006 | 保留 `PARTIAL` / `NOT RUN`，同时指向新 Owner | RP-API-C-001 → #22；C-005 → #23；C-006/E-002 → #24 | `PASS — LOCAL` |
| 历史验收报告 | 保留当时结论，同时记录后续范围迁移 | 已增加后续状态或迁移说明 | `PASS — LOCAL` |
| 仓库验证 | 文档变更不破坏现有 Gate | `pnpm verify`：15 个测试文件 / 308 个测试通过；架构、生成文件、Catalog、兼容性全部通过 | `PASS` |

## 自动验证结果

- 格式检查：`PASS`。
- ESLint：`PASS`。
- TypeScript project references：`PASS`。
- Vitest：15 个测试文件、308 个测试全部 `PASS`。
- Architecture：`PASS`，`source_roots=10`。
- Public API generation：`PASS`，`operations=200`。
- Schema-derived Type：`PASS`，`payloads=200 / query_results=44 / core_contracts=6`。
- Catalog / Registry：`PASS`，`catalog=200 / registry=200 / FULL=200`。
- v1.0 compatibility：`PASS`，`operations=200 / schemas=14 / envelopes=200 / findings=0`。
- 未创建临时测试脚本或测试文件。

## 关闭 Gate

Issue #5 只有在以下条件全部满足后才能关闭：

1. GitHub Issue #5 正文已标记字段 Schema 验收完成，并明确关联 #15、#22、#23、#24。
2. 本次权威文档同步修改经用户检查确认、提交并合入 `main`。
3. 合入后的 `main` 仍明确保留 #22–#24 的 `PARTIAL` / `NOT RUN` 状态。
4. 最终查询确认 #22、#23、#24 仍为 OPEN 且 #5 为 CLOSED。

## 未执行边界

- 本任务不实现 #22–#24 的 Runtime 能力。
- 未运行真实飞书、邮件 Provider、数据库或 HTTP Handler 验收。
- Issue Owner 迁移不构成 Runtime、Integration、External 或 Manual `PASS`。
