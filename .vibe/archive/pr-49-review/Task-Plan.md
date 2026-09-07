> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/pr-49-review/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/pr-49-review/Task-Plan.md).

# PR #49 代码审查与交付计划

## 范围

- PR：#49 `feat(identity-policy): actor snapshot, decision port and access queries`
- 工作项：IM-02 WI-09，原始 Issue：#37
- 审查基准：PR head `31c9c1061029b57722cae80c7b4b8da45496d522`
- base：`galendai/36-im-02-wi-08-roles-capabilities-policy-snapshots`

## 成功标准

1. 对照 HL-Spec、IdentityPolicy Module Spec、WI-09 Issue/Runbook、API Registry 与实际 diff，给出可复现且定位明确的审查结论。
2. 对每个确认缺陷先补充失败回归和同步项目文档，再做最小实现修复。
3. 运行聚焦测试、全量 `pnpm verify` 与必要的架构/契约检查；将真实 PostgreSQL、Handler、外部身份和人工验收边界分别标为 `PASS` 或 `NOT RUN`。
4. 将确认的修复记录发布到 PR #49 comments，并在最终 head 上重新审查。
5. 用户检查并确认工作树改动后，才创建提交；提交、推送、精确合并和 Issue #37 关闭必须使用最新 head 并逐项核验。

## 当前基线

- 工作树初始无未提交改动。
- PR #49 当前为 OPEN，head 为上面的 SHA，`verify` CI 为 SUCCESS；这只是旧 base 上的基线。
- PR #49 的 GitHub base commit 仍为 `7bf9f62ef6e4c369bb7c32437aa63a32dab6e496`，但 base 分支当前已前进到 `0a3349eed0e4bb943a7a39b86f58a69888d8201a`；GitHub 当前报告 `mergeable=DIRTY`。必须先集成该 base 分支，再对最终 head 做语义复审和 CI 验证。
- Issue #37 当前为 OPEN；PR 正文含 `Closes #37`，但 GitHub API 当前未返回 closing reference，需在交付前修正并核验。

## 审查记录

本文件随审查推进更新；所有发现、回归、验证和交付状态必须以当前精确 head 为准，不把历史快照当作当前事实。

## 本地修复阶段结果（2026-08-24）

- 最新 WI-08 base 已集成；原 head 的 Scope、完整 canonical facts、引用元数据/内容寻址、公开结果 Contract 和事务角色 fixture 问题已补失败回归并修复。
- 静态、类型、架构、Catalog/Registry、兼容性与 Vitest 通过；独立 `pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上 `11 files / 166 tests PASS`，二次 migrate no-op、容器已清理。
- 最新 `pnpm verify` 编排静态阶段通过，但 Docker Hub 未认证 registry 的 `EOF/429` 阻断其最后 Gate；最终文档保留该 `NOT RUN` 边界，不将其写成完整 orchestrator PASS。
- 当前仍待：用户检查工作树并确认；随后才能提交、推送、在最终 exact head 发布 PR comment、精确合并 PR #49，并核验后手动关闭 Issue #37。
