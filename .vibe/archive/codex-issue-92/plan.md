> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/codex-issue-92/plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/codex-issue-92/plan.md).

# Issue-92 交付执行记录

## 当前范围

- Issue：#92 `[IM-04][WI-03] Implement Artifact root, metadata, branch identity, and archive lifecycle`
- 状态：CLOSED，代码、本地 Persistence 验证与 GitHub 交付已完成；closeout 文档同步待用户检查
- 当前工作树：`galendai/issue-92-closeout-doc-sync`
- 当前基线：`734aa24d2d3cfbc875af27011a8dc80148c7035d`
- 实现提交：`5cb4d1b4e97c4062de99ff66d5d357c0d47209e6`
- 当前阶段：PR #104 已合并到 `main`，merge commit 为 `9d7cb06128680bc141548115f347884aee813412`，Issue #92 已关闭，原实现远端/本地 feature branch 已删除；当前仅同步 closeout 文档

## 交付目标

依据 HL-Spec、Artifact Module Spec、相关 API/Contract 文档和 Issue-91 事务基础，实现 Artifact 长期身份、范围不可变元数据、默认分支身份、归档生命周期及 exact read model；补齐 Unit、Contract、Persistence、RLS、幂等、CAS、回滚和迁移证据。

## 明确不在本次范围

Canonical Content Object、sealed Revision、merge、Diff、Representation、Quality、Approval、Release、renderer，以及生产对象存储、生产数据库、public HTTP E2E 和真实业务验收。

## 已冻结的实现决定

- 公开创建契约没有独立业务键；使用 `businessScope + exact scope + artifactType + initial title` 的 canonical `identity_hash` 处理同 Scope 重复身份，后续标题更新不改变该指纹。
- 默认 Branch 名称固定为 `main`，UUIDv7 在创建时生成；无 Revision 时 `working_head_ref=null`、`head_version=0`。
- Root/Branch 业务写入通过 Artifact-owned security-definer 函数执行，`artifact_app` 只读业务 Root/Branch；Root/Branch 的直接 `UPDATE/DELETE` 不授予。
- 创建事件沿用公开 `artifact.ArtifactCreated@1.0`；元数据更新和归档事件先记录为 owning outbox 内部事件，不扩展当前公开 Catalog。

## 执行计划

1. 核对 Issue、仓库规范、当前代码头、HL-Spec、Artifact Module Spec、模块测试文档和 Issue-91 基础。
2. 先修订受影响的 Spec/测试文档，再实现最小垂直切片和回归测试。
3. 执行静态检查、Unit/Contract、真实 PostgreSQL 持久化/RLS/迁移探针及完整门禁，区分 `PASS` 与 `NOT RUN`。
4. 完成代码审查、差异审查和 exact-head GitHub 交付；合并后同步权威 `.vibe` closeout 状态，等待用户检查确认后再提交文档同步。

## 当前假设与边界

- 以当前仓库实际 Spec、代码和 PostgreSQL harness 为准，不把 Registry 或已有文档声明当作运行时证明。
- 所有新文档使用中文；代码注释和 Git commit message 使用英文。
- 本记录是 Issue #92 的 `.vibe` 交付记录；实现提交已通过 PR #104 合并，Issue #92 已关闭，原实现远端和本地 feature branch 已删除。当前分支只承载合并后的权威文档状态同步，尚未提交该文档同步。
