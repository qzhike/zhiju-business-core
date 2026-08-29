# Issue #89 交付计划

## 目标

在当前 `origin/main` 上核验 IM-04 Artifact + Canonical Content 父退出门槛，修正仍与实际实现或验证证据不一致的权威文档，并在 exact-head 自动化与真实 PostgreSQL 证据通过后完成 Pull Request 合并、Issue #89 关闭和交付分支清理。

## 权威依据

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/module-specs/Module-Spec-004-Artifact.md`
- `.vibe/module-tests/Module-Test-004-Artifact.md`
- GitHub Issue #89 及子 Issue #90–#98
- 已合入 `main` 的对应实现、迁移、测试与手动 ART-023 产物

## 执行阶段与成功标准

1. 基线审计：确认 #90–#98 均已关闭、有效 PR head 均为 `origin/main` 祖先，且当前 worktree 无无关改动。
2. 权威同步：先修订 HL-Spec、Artifact Module Spec 与 Module Test；只修改能由当前实现和证据支持的状态，不把未执行边界写成通过。
3. 验证：执行聚焦 Artifact/Contract 检查、完整 `pnpm verify`、真实 disposable PostgreSQL clean migration 与 second-migrate no-op；记录输入、预期、实际和清理边界。
4. 交付：仅暂存本 Issue 相关路径，检查 staged diff 与 whitespace，使用英文 Commit Message，非强制推送并等待 exact-head CI。
5. 关闭：回读 PR 和 Issue 证据，精确 head 合并，确认交付 head 为 `origin/main` 祖先，关闭 #89。
6. 清理：仅清理本次交付分支与对应 worktree；保留其他 worktree、分支和用户改动。

## 明确保留的 NOT RUN

- 真实 Ceph RGW/OpenBao 与生产部署
- 真实 Provider、公开 HTTP E2E、后续模块集成业务 E2E
- 真实客户适用性与独立业务人工验收
- DOCX/XLSX/PDF renderer 与版式/可打开性验收（属于 IM-05）
