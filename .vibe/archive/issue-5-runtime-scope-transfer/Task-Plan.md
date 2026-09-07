> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-5-runtime-scope-transfer/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-5-runtime-scope-transfer/Task-Plan.md).

# Issue #5 Runtime 范围迁移计划

## 目标

Issue #5 仅以 ReleasePublication 25 个字段级操作契约为关闭边界。将尚未实现的三个 Runtime 验收边界迁移到独立 Issue，并同步 GitHub Issue、HL-Spec 与 Module Test，确保未完成工作具有明确 Owner，且关闭 #5 不会被误解为 Runtime 已通过。

## 范围

1. 创建 Release Authorization ActorSnapshot / `actingFor` 运行时不变量 Issue（#22）。
2. 创建 `providerResult` PII 最小化 Issue（#23）。
3. 创建普通飞书发送与 Formal Release 来源链隔离 Issue（#24）。
4. 更新 Issue #5 的验收清单与后续 Issue 关联。
5. 更新 HL-Spec、Module-Test-006 及当前验收报告中的 Issue Owner 和关闭边界。

不在本任务中实现上述 Runtime 能力，也不把对应 `PARTIAL` / `NOT RUN` 状态改写为 `PASS`。

## 里程碑与人工检查产物

| 里程碑 | 产出物 | 人工检查方法 |
|---|---|---|
| M1：Runtime 工作有明确 Owner | 三个 GitHub Runtime Issue | 检查每个 Issue 的输入、预期结果、测试编号、依赖与关闭条件 |
| M2：权威状态一致 | Issue #5、HL-Spec、Module-Test-006、验收报告的范围迁移修改 | 对照搜索结果，确认不再有“#5 因三项 Runtime TODO 保持 OPEN”的现行声明 |
| M3：关闭准备完成 | 验证结果与未提交差异 | 确认测试状态仍如实保留 `PARTIAL` / `NOT RUN`，且 #5 只在修改合入 `main` 后关闭 |

## 成功条件

- 三个 Runtime Issue 均已创建并由 Issue #5 明确引用。
- Issue #5 的字段 Schema 验收项标记完成，Runtime 工作明确迁移，不再由 #5 承接。
- HL-Spec、Module-Test-006 和当前验收报告与 GitHub 状态一致。
- 文档检查和仓库验证通过，没有生成文件漂移或无关改动。
- 修改经用户检查确认后再执行 Git commit。
