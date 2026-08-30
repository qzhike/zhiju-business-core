# Issue #124 交付工作计划

## 目标

审计并交付 `qzhike/zhiju-business-core#124`：ReviewIssue remediation 与 Human Approval snapshot。以当前工作树、GitHub Issue/PR、HL-Spec、相关 Module-Spec/Module-Test 和实际代码为准，保持实现、权威文档、测试与交付证据一致。

## 工作边界

- 先核对当前分支、工作树、Issue #124、依赖 Issue/PR 及现有改动。
- 仅修改 Issue #124 直接要求且由权威 Spec 支持的代码、测试和文档。
- 本地测试、CI、合成证据和 disposable PostgreSQL 不能替代 Provider、生产、外部系统或独立人工验收；未执行边界保留为 `NOT RUN`。
- 验收证据写入 GitHub Issue/PR；本记录仅作为执行前计划，不作为重复验收日志。
- 根据项目流程，代码或文档变更完成后先提示用户检查，收到确认后再执行 `git commit`。

## 成功条件

1. 实现与 HL-Spec、相关 Module-Spec、Module-Test 和实际差异一致。
2. 直接回归测试及完整项目验证通过，结果按边界准确记录。
3. 用户确认变更后，仅提交经过审计的任务相关路径。
4. PR 在验证过的 exact head 上合并，Issue #124 状态、PR 关闭关联、默认分支 ancestry 和目标交付分支清理状态均有远端回读证据。

## 当前状态

实现、文档和回归验证已完成：focused validator Unit 为 1 file/7 tests PASS；普通全量 Vitest 为 37 passed/28 skipped files、416 passed/290 skipped tests；Format、Lint、Typecheck、Architecture、201/201 FULL Contract/Catalog/Compatibility 均 PASS；正式 `node tools/persistence/gate.mjs` 已完成 PostgreSQL 18.6/Flyway 11.20.3 tag→digest 校验、`server_version=180006`、空库 35 migrations（含 V5004）、32 files/305 tests PASS、二次 `No migration necessary` 和容器清理。实现覆盖 ReviewIssue remediation、Human Approval/ABS、AGENT/Service/Runtime trusted-context 拒绝、CAS/race、duplicate Human、RLS/ACL、append-only、event provenance 与 rollback；所有数据为 `SYNTHETIC / TECHNICAL ONLY`。Provider、公开 HTTP、跨模块 E2E、生产、Workspace UI、Feishu、真实组织审批和独立人工验收保持 `NOT RUN`/`PARTIAL`。实现 commit `390b2bcb017c12706f0de7a02bbd5dbe922287a9` 与文档同步 commit `6da530d5c1b4f3bf74ed51bbcab89b2837cd95ec` 已创建并 non-force push 到目标分支；PR #133 首轮 CI 因 WI-04 长 persistence 测试超过默认 5 秒时限失败，正在修正测试时限并重跑，尚未执行 Issue close 或分支/worktree 清理。
