> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-05-wi-06/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-05-wi-06/Task-Plan.md).

# IM-05 WI-06 ReleasePublication 持久化交付计划

## 目标

在当前工作树核对 IM-05 WI-06 的权威规格、现有实现和远端交付状态，完成 ReleasePublication 持久化切片的审查、必要修复、验证与 GitHub 原生交付。

## 当前假设

- 当前工作树对应 IM-05 WI-06，基线为 `c6c20b3`；先以实际仓库、Issue、PR 和远端状态为准。
- “交付”包含本工作项范围内的实现/文档/测试审查、必要代码修复、提交、推送、精确 HEAD CI、PR 合并、关联 Issue 状态回读以及交付分支清理；不包含无关分支或工作树的 Git 写入。
- 技术持久化、应用运行时、外部 Provider、生产环境和人工业务验收必须分别记录，未被直接验证的边界保持 `NOT RUN`。
- 在提交前保留用户检查点；用户确认后才执行本轮 commit。若当前分支已经存在可交付提交，则先确认其实际内容、PR/Issue 状态和是否需要补充。

## 验收标准

1. `HL-Spec.md`、ReleasePublication Module-Spec、Module-Test 与实际代码/迁移/测试保持一致。
2. 关键 Release/Package/RenderAttempt/RawExternalReceipt/PublicationReceipt 身份、范围、哈希、时间、状态、幂等和失败语义有直接回归证据。
3. 通过适用的 focused tests、完整 `pnpm verify` 及持久化/迁移门禁；无法执行的 Provider、生产、公共 HTTP/E2E 和人工验收边界明确标为 `NOT RUN`。
4. 提交只包含本工作项审核后的路径，且 staged whitespace、HEAD、CI 和远端状态均可复核。
5. GitHub PR/Issue 承载验收证据；不新增重复的 `.vibe` 验收/交付日志。

## 执行步骤

1. 读取权威文档、Issue/PR、实际 diff、ReleasePublication 源码/迁移/测试和当前 Git 状态。
2. 形成缺口清单；先更新受影响的规格/测试文档和回归测试，再修改实现。
3. 运行 focused/full/persistence 验证，记录精确命令、结果和未运行边界。
4. 汇总用户可检查的改动；收到确认后执行 scoped commit，并重新验证。
5. 非强制推送、精确 HEAD CI、PR/Issue 远端回读、合并和交付分支/工作树清理。

## 当前结果（2026-08-31）

- 已完成 HL-Spec、Module-Spec、Module-Test、PostgreSQL logical model 的 WI-06 authority sync，并落地 V6001、Release/Package handler、repository、transaction runner、canonical Package Hash 和真实 PostgreSQL regression tests。
- `pnpm verify` 已通过：Format、Lint、TypeScript、全仓测试 `40 files passed / 30 skipped`、`425 passed / 298 skipped`、Architecture、Contract `catalog=201 registry=201 schema_status=FULL`，以及 PostgreSQL gate `34 files / 313 tests PASS`；空库迁移、二次 no-op 和容器清理通过。
- 独立人工客户验收、真实 Provider/生产/公开 HTTP、跨模块业务 E2E 尚未执行，继续记录为 `NOT RUN`。
- 当前仍处于用户检查点：尚未执行 commit、push、PR、Issue close 或 branch/worktree cleanup。
