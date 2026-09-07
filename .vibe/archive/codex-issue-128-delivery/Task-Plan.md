> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/codex-issue-128-delivery/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/codex-issue-128-delivery/Task-Plan.md).

# Issue #128 交付任务计划

## 目标

交付 IM-05 WI-08 的合成 QMS/REL-801 退出证据与父级复核材料，严格区分可由当前仓库和一次性 PostgreSQL 环境证明的技术事实，以及 Provider、生产、客户和独立人工验收等未运行边界。

## 当前阶段

1. 读取 Issue #128、#120–#127 的远端状态及当前精确提交。
2. 对照 HL-Spec、QualityGovernance/ReleasePublication 模块规格、模块测试矩阵和已交付实现，识别证据缺口。
3. 先修订本交付涉及的权威规格与模块测试文档，再实施必要的最小代码/测试/证据变更。
4. 运行聚焦测试、完整验证和一次性 PostgreSQL 证据；清除生成物与临时测试文件。
5. 形成可审阅的 `.vibe` 交付记录，提交前展示变更并等待用户确认。

当前阶段：本地实现、权威文档同步、聚焦测试、完整 `pnpm clean && pnpm verify` 和 disposable PostgreSQL 证据均已完成；用户已确认提交，PR #139 已以最终审阅 head `306cdbc3b8c8201994a57097038c4c3f784b0412` 合并，merge commit 为 `07fc6a083897c01924f842d12dffe06fd6068261`，Issue #128 已关闭，原交付分支的本地/远端清理已完成；当前完成最终 authority docs 同步并交付 closeout。

## 交付成功标准

- 所有证据绑定精确的 Issue/PR/head、模块规格和测试用例，不使用 `latest`、`current`、跨模块 Repository 或调用方伪造 hash。
- QMS/REL-801 walkthrough 的成功、拒绝、回滚、重试、部分完成和 recall 事实可重放，并明确 `SYNTHETIC / TECHNICAL ONLY`。
- DOCX/XLSX 输出、checksum、Representation binding、ReleasePackage、Authorization、Attempt/Receipt/Failure/Partial/Recall 之间的引用关系可复核。
- 本地/CI/一次性 PostgreSQL 结果与 Provider、生产、public HTTP、Workspace UI、IM-09 集成 E2E、独立业务人工验收的 `NOT RUN` 边界分别记录。
- 只在用户确认后创建提交；推送、合并、关闭 Issue #128 和清理本交付分支均以最新远端精确状态为准。

## 当前执行结果（2026-08-31）

- `pnpm clean && pnpm verify`：`PASS`。普通 Vitest 为 `42 files passed / 30 skipped`、`432 passed / 299 skipped`；Architecture `source_roots=10`；Public API/Catalog 为 201 operations 且全部 `FULL`；compatibility baseline v1.0 为 200 operations；Persistence Gate 为 34 files/314 tests。
- QMS/REL-801 报告模式：`REV-002 FAIL`、独立 ReviewIssue/Verification、双 Human Approval、revocation/stale bundle、三次 Attempt、六条 Observation、两条 Formal Receipt、Failure、Recall 和 ImpactReview 均有 exact readback；详细 Ref/hash 见 [`Synthetic-QMS-REL-801-Exit-Report.md`](Synthetic-QMS-REL-801-Exit-Report.md)。
- 空库 Flyway、第二次 `No migration necessary`、PostgreSQL 18.6/Flyway 11.20.3 digest pin 和容器清理均通过；当前没有新增 Migration、公共 Contract 或生产运行时适配器。
- 真实 Provider、生产、公开 HTTP、统一跨模块业务 E2E、外部收件人和独立人工验收继续为 `NOT RUN`；PR #139 已合并并通过 exact-head CI，Issue #128 已关闭，父级 Issue #120 不关闭。
