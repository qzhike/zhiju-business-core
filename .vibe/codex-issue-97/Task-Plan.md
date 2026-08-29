# Issue #97 Representation 权威绑定交付计划

日期：2026-08-29
状态：`IMPLEMENTATION COMPLETE / LOCAL VERIFICATION COMPLETE`

## 目标与范围

交付 IM-04 WI-08：Artifact 只在公开 `integration.get_render_attempt_binding@1.0` 返回可验证的成功绑定后，登记不可变 Representation，并提供精确查询。实现不读取 IntegrationGateway 数据库，不执行 Renderer，不接触真实对象存储或生产环境。

## 已确认前提

- Issue #90、#93、#94 已关闭；Binding Query、FROZEN Canonical Content Manifest 和 immutable Revision 已在 `main`。
- 当前工作分支 `galendai/deliver-issue-97` 从 `origin/main` 创建且初始工作树干净。
- 公开 Contract 已固定为 201 项，本任务不新增或修改公开 Operation/Event，也不改写历史 200-operation compatibility baseline。
- `RenderAttemptBindingView` 不携带独立 media type；Artifact 以 NamespaceCode 的最后一段做闭合 format-family 映射：`*.pdf -> application/pdf`、`*.docx -> application/vnd.openxmlformats-officedocument.wordprocessingml.document`、`*.xlsx -> application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，并保留原始完整 format 做 Binding 相等比较。未知格式 fail-closed，后续格式扩展必须先订正规格与回归。

## 实施步骤与验证

1. 先冻结规格与失败场景：更新 HL-Spec、Artifact Module-Spec、Artifact Module-Test。
   - 验证：三份文档明确 Migration、Port、Binding 全字段比较、Hash 分域、幂等、RLS、回滚和 `NOT RUN` 边界。
2. 新增 forward-only V4004、类型与 Repository。
   - 验证：Representation/Validation Fact append-only；`artifact_app` 仅 Scope-filtered SELECT 和 owner function EXECUTE；直接写、跨 Scope 与不可变改写均拒绝。
3. 实现 `artifact.register_representation@1.0` Handler 与 `artifact.get_representation@1.0` Query。
   - 验证：只通过注入的公共 Binding Query Port 获取事实；验证 Registry result、attempt/revision/content/input/format/media/renderer/output/receipt 全绑定；失败路径不写 Representation/成功事件。
4. 添加 Unit 与真实 PostgreSQL 回归以及合成人工输出。
   - 验证：成功、逐字段 mismatch、FAILED/UNKNOWN/missing/QUARANTINED、cross-project、同 attempt replay、不同 render identity、Hash 域替换、RLS、rollback、event minimality、空库 migrate、second-migrate no-op 与容器清理。
5. 执行聚焦测试和完整 `pnpm verify`，审查 staged scope 后提交。
   - 验证：format/lint/typecheck/test/architecture/contracts/persistence 全通过；生产、Provider、Renderer、公开 HTTP、跨模块部署 E2E 与独立人工验收明确 `NOT RUN`。
6. 推送并创建关闭 Issue #97 的 PR，等待精确 HEAD CI 后合并。
   - 验证：PR/Issue 写入可复现证据；`--match-head-commit` 合并；`origin/main` ancestry、PR/Issue 状态与交付分支清理均远端回读。

## 手工可复核产出

生成 synthetic successful Binding View / Registration 对照表，逐项列出正确值以及 wrong revision、wrong canonical locator、wrong input hash、wrong format/media type、wrong renderer、wrong output locator/checksum、wrong raw receipt、UNKNOWN 和 cross-project 的预期/实际错误码、Representation/Validation/Event 行数与清理结果。该产出只证明技术 Fixture，不代表真实 Renderer 文件可打开性、版式或业务验收。

## 完成标准

- 规格、实现、测试和 GitHub Issue/PR 验收描述一致。
- 同一精确 RenderAttempt 只产生一个 Representation 和一个公开 success event；重放返回原结果。
- 任一 Binding 不一致均 fail-closed，且不留下业务成功事实。
- 精确 HEAD CI 通过、PR 合并、Issue #97 关闭、`origin/main` 包含实现、交付分支安全清理。
