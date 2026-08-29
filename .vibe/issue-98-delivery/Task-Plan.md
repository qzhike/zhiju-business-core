# Issue #98 交付任务计划

日期：2026-08-29
状态：`GIT DELIVERY COMPLETE / PR #117 MERGED / ISSUE #98 CLOSED`

## 目标

在不新增公共 Operation、不修改已应用 Migration、不启动 IM-05 或后续业务模块的前提下，交付 IM-04 WI-09：复核并补强 Artifact 权威 Query，汇总可重复的合成 ART-023 技术验收输出，并给出不自动关闭父 Issue #89 的退出 Gate 建议。

## 权威边界

- `artifact.get_artifact@1.0`、`artifact.get_revision_snapshot@1.0`、`artifact.get_revision_lineage@1.0`、`artifact.get_revision_diff_inputs@1.0`、`artifact.validate_revision_ref@1.0` 与 `artifact.get_representation@1.0` 是 IM-04 已具备业务事实的适用 Query。
- `integration.get_render_attempt_binding@1.0` 只通过公开 Query Port 为 Representation 注册提供权威 Binding；Artifact 不读取 IntegrationGateway Repository。
- `artifact.get_effective_binding@1.0` 依赖后续 Release/EffectiveBinding 写入事实，本工作项不伪造其 Handler 或数据；保持 `NOT RUN`。
- 公共 Catalog 保持 201 项；内部 Diff 继续由两个精确 Revision Snapshot 重建，不新增公共 Diff Result Operation。
- 不修改 `V4000`–`V4004`；使用 pinned PostgreSQL 18.6 与 Flyway 11.20.3 验证空库迁移和第二次 no-op。

## 执行与验证

1. 同步 HL-Spec、Artifact Module Spec/Test 与本任务计划。验证：文档明确 Query 集合、失败边界、测试矩阵与 `NOT RUN`。
2. 补强 Query 回归。验证：错误 Hash、非 UUID `latest/current`、宽 Scope、错误 Representation Ref、治理事实与新增 Representation 后的历史 Lineage/Diff Input 稳定性均有直接断言。
3. 运行 focused Unit/Contract/Persistence 与完整 `pnpm clean && pnpm verify`。验证：格式、Lint、Typecheck、Unit、Architecture、201-operation Contract、pinned PostgreSQL migration/no-op、RLS 与 cleanup 全部通过。
4. 生成合成 ART-023 报告。验证：Document/Workbook、Manifest、Revision DAG、Branch CAS、Diff、RenderAttempt Binding、Representation、稳定错误码、命令、环境、时间和 cleanup 均可复核，并标注 `SYNTHETIC / TECHNICAL ONLY`。
5. 审查任务相关 diff 与残余边界。验证：`git diff --check` 通过，无临时脚本、临时文件或遗留容器；真实 Provider、生产、公开 HTTP、跨模块和独立业务验收继续为 `NOT RUN`。

## 交付边界

- Issue #98 完成后仅给出父 Issue #89 的关闭建议，不在本工作项内自动关闭 #89。
- 用户已确认变更；实现 head `8e58fa18ee50726252ca38542b6de1afdfbb4310` 通过 PR #117 exact-head CI，以 merge commit `f4b8704ba766d49c12c4433884d94bce91d50792` 合入 `main`，Issue #98 已关闭。父 Issue #89 保持开放；任务分支在文档回读后执行清理。
