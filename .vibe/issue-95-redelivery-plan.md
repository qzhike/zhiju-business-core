# Issue #95 / IM-04 WI-06 重新验证与交付计划

状态：实现重新验证通过，文档待用户检查

目标：核对当前 Structured Document Human Edit 与 deterministic internal Diff 实现是否满足 WI-06 关闭条件；若满足，则从精确验证提交重新创建 PR，等待精确提交 CI，通过后合并并关闭 Issue #95。

边界：不修改或删除 WI-07 worktree 中的未提交内容；不将 Provider、生产环境、公开 HTTP、跨模块、Renderer、Quality、Approval、Release 或独立人工验收未执行项误报为已验证。

交付顺序：

1. 读取 HL-Spec、Artifact Module Spec、Module Test、Issue #95 和现有实现记录。
2. 核对实现提交、worktree 状态、main 基线及 WI-06 接受条件。
3. 运行聚焦测试、完整验证和真实 PostgreSQL 持久化门禁，并记录实际结果。
4. 若关闭条件满足，从精确验证提交创建新分支和 PR，等待 exact-head CI。
5. 通过后按精确 head 合并，回读远端 main、祖先关系、PR 和 Issue 状态。

验证记录：聚焦 Unit 1 文件/4 passed；`pnpm verify` 的格式、Lint、TypeScript、全量 Unit、Architecture、Contract 和 PostgreSQL persistence gate 均通过；全量 Unit 为 30 文件/380 passed/265 skipped，Contract 为 201 operations/201 FULL，Persistence 为 26 文件/280 passed；pinned PostgreSQL 18.6/Flyway 11.20.3 空库 migrate、第二次 migrate no-op 和容器清理通过。组合流程故障注入为 `PARTIAL PASS / INJECTION NOT RUN`，独立人工及外部边界保持 `NOT RUN`。

当前判断：Issue #95 定义内的 Artifact 内部实现关闭条件已满足，可进入重新创建 PR、exact-head CI、合并和 Issue 关闭流程。
