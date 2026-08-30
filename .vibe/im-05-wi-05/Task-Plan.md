# IM-05 WI-05 最小 DOCX/XLSX Renderer 与 Representation 闭环任务计划

日期：2026-08-30
状态：`LOCAL IMPLEMENTATION, PERSISTENCE AND OFFICE OPENABILITY VERIFIED / GITHUB DELIVERY TRACKED BY PR #135 AND ISSUE #125`

## 1. 目标与权威

本任务交付 Issue #125 的最小确定性 Renderer 切片，并以精确不可变 Artifact Revision 为输入，完成 `integration.request_render@1.0`、权威 `integration.get_render_attempt_binding@1.0` 与既有 `artifact.register_representation@1.0` 的受控组合。

权威输入为：

- `.vibe/high-level-docs/HL-Spec.md`；
- `.vibe/module-specs/Module-Spec-004-Artifact.md` 与对应 Module Test；
- `.vibe/module-specs/Module-Spec-007-IntegrationGateway.md` 与对应 Module Test；
- GitHub Issue #125；
- 已批准的 IM-DG-003、IM-DG-005，以及已交付的 IM-04 #90、#97、#98。

## 2. 假设与最小范围

1. DOCX/XLSX 是不可变 Representation，不是 Canonical Source of Truth。
2. Renderer 只接受精确 `revisionRef + canonicalContentRef + inputHash + outputFormat + rendererId + rendererVersion`；不读取 `latest/current`。
3. 本地/CI Object Storage 只暴露 opaque locator 和权威 bytes readback，不产生 Presigned URL 或凭证。
4. IntegrationGateway 独占 RenderAttempt、RawExternalReceipt、Worker 状态和 Outbox；Artifact 不跨 Schema 读取 IntegrationGateway Repository，只调用公开 Binding Query Port。
5. 外部调用发生在 `CREATED` Attempt 提交之后；timeout 保持 `UNKNOWN`，重放不盲目重复副作用，只有 reconciliation 或权威结果才能推进终态。
6. 本 WI 不新增公开 Contract，不实现 Feishu/CLI Runtime 全范围，不创建 Quality PASS、Approval、Release Authorization、Release Completion 或 EffectiveBinding。

## 3. 里程碑与验证

1. 确定性 Renderer 与本地 Object Store
   产出：最小 DOCX/XLSX bytes、固定 Renderer Profile、稳定 checksum。
   验证：相同输入/profile bytes 完全一致；内容、格式或版本变化形成不同输入 identity；ZIP/OOXML 结构可打开性检查通过。
2. IntegrationGateway RenderAttempt 纵向切片
   产出：forward-only `V7001`、Repository/Service/Binding Query、Raw Receipt、Outbox、UNKNOWN/reconcile。
   验证：真实 PostgreSQL migration/no-op、RLS/ACL、稳定键 replay/hash conflict、timeout UNKNOWN、terminal immutability、事务回滚。
3. Artifact Representation 组合
   产出：通过公开 Binding Query Port 调用既有 Representation Handler。
   验证：exact binding 成功；revision/input/format/renderer/checksum/scope/receipt/FAILED/UNKNOWN 负例全部 fail closed；不跨 Schema Repository。
4. 审查与交付准备
   产出：同步后的 HL/Module Spec/Test 与 GitHub Issue/PR 验收证据草稿。
   验证：focused tests、`pnpm verify`、`git diff --check`；真实 Ceph/OpenBao、第三方 Renderer、公开 HTTP、生产、负载/HA、真实客户版式验收保持 `NOT RUN`。

## 4. Git 边界

本计划本身不授权 Commit。代码、文档和测试完成后先向用户报告精确差异与验证结果；用户已于 2026-08-30 另行明确确认本地提交。后续 Push/PR/exact-head CI/merge/Issue 与 branch 收尾按届时授权及远端实际状态执行。

## 5. 当前验证结果

- `pnpm verify` 全部通过：普通 Vitest `38 passed / 29 skipped` 个文件、`420 passed / 293 skipped` 个测试；Architecture、201 项 Public API/TypeScript/Catalog Registry、200 项 Compatibility Baseline 全部通过。
- Disposable PostgreSQL 18.6/Flyway 11.20.3 Gate 通过：`33` 个文件、`308` 个测试；空库应用 `V7001` 成功，第二次迁移为 `No migration necessary`，容器已删除。
- 真实 Renderer `SUCCEEDED` Binding 已通过公开 Port 输入既有 Artifact Representation Handler，并完成 immutable Representation/Validation/Reference Edge/Outbox 的实际 PostgreSQL 登记与负向回归。
- 脱敏 DOCX/XLSX 分别通过 ZIP 完整性及 Microsoft Word/Excel 本地打开检查；临时输出已删除。此结果不升级真实客户 pixel-perfect 版式、独立人工业务验收或生产状态。
- 用户已于 2026-08-30 明确授权本地提交及完整 GitHub 交付；远端 Push、PR review/CI、Merge、Issue 关闭和 Branch 清理的实际状态统一从 PR #135 与 Issue #125 读回。
