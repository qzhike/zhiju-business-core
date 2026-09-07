> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/api-contract-v0.1/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/api-contract-v0.1/Task-Plan.md).

# Command / Query / Event API Contract v0.1 工作计划

状态：`COMPLETE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / IMPLEMENTATION NOT STARTED`
日期：2026-08-13
执行者：Codex（主 Agent）

## 1. 前提与范围

- 用户已确认 `.vibe/high-level-docs/` 高层设计基准审核通过。
- 本阶段按 `HL-Spec.md` 第 7 节进入 `Command / Query / Event API Contract v0.1`。
- 本阶段只完成设计规格、模块规格和设计验证记录，不创建业务代码、DDL、Migration 或运行时适配器。
- 已冻结的产品边界、七模块所有权、四个 Core Contract、Typed Reference、公开 Catalog 和 PostgreSQL 逻辑边界不得被静默改变。

## 2. 交付物

1. 七个逻辑模块对应的 `Module-Spec-[ID]-[ModuleName].md`，明确公开 API 责任和模块边界。
2. 字段级 Command / Query / Event API Contract v0.1。
3. 本阶段测试文档，记录 Contract 静态检查用例、输入、预期输出、实际输出和结果。
4. 对 `HL-Spec.md` 与验证基准的阶段状态、文档路由和 Gate 进行同步更新。

## 3. 执行步骤与验证

1. 读取 API 任务的权威文档集，整理待确认项与冲突。
   - 验证：每个设计决定可追溯到唯一权威文档；不以摘要覆盖详细定义。
2. 建立跨模块共享 API 规则和七模块字段级契约。
   - 验证：Catalog 中每个公开 Command、Query、Event 都有唯一 Owner 和明确 payload schema 或 schema family。
3. 补齐模块规格与设计测试文档，并同步高层入口和验证基准。
   - 验证：文件命名、链接、版本、错误语义、权限、幂等、分页和事件 envelope 一致。
4. 执行静态 Gate 并记录结果。
   - 验证：目录覆盖、Catalog 覆盖、重复名称、Owner、引用和 Markdown 基本质量检查全部有当前证据。

## 4. 阶段里程碑与任务分配

| 里程碑 | 负责人 | 产出物 | 可供用户手动测试的内容 | 状态 |
|---|---|---|---|---|
| API-M1 共享契约 | Codex 主 Agent | `API-Contract-v0.1.md` | 审核 Envelope、并发、幂等、分页、错误、版本和安全规则 | `BASELINE` |
| API-M2 模块字段 | Codex 主 Agent | 七份 Module Spec | 逐模块抽查公开名称的 target、payload、result、event 和 Human-only 边界 | `BASELINE` |
| API-M3 测试与静态 Gate | Codex 主 Agent | 七份 Module Test、[`Verification-Report.md`](Verification-Report.md) | 检查每个用例的输入/预期/实际，核对 200 名称零差异 | `DESIGN VERIFIED` |
| API-M4 用户审核 | 用户 | 审核结论和修订意见 | 按模块或整体确认 API v0.1；确认前不进入飞书 Channel Contract | `USER REVIEWED 2026-08-13` |

本阶段未启用 Sub-Agent，所有产出由主 Agent 负责，避免跨 Agent 文档所有权重叠。

## 5. 人工审核 Gate

用户已于 2026-08-13 明确确认“API v0.1 审核通过”。本阶段状态同步变更仍须交由用户检查；用户明确确认提交前不执行 Git Commit，也不进入 Feishu Channel Contract 或实现代码。
