# Issue #95 / IM-04 WI-06 重新交付记录

状态：重新交付完成，PR #113 已合并，Issue #95 已关闭

## 1. 重新验证基线

- 实现提交：`a62332061856eb4457501d4efe93f4fd8241420f`
- `origin/main`（合并后）：`435b3b438122de7e8f053708c5cc1bcb49e7494f`
- 首轮 PR：[#112](https://github.com/qzhike/zhiju-business-core/pull/112)，已关闭且未合并；首轮远端和本地分支已删除。
- 本次分支：`galendai/im-04-wi-06-redelivery`（合并后本地和远端均已删除）

## 2. 接受条件判断

当前实现覆盖：

- executable Canonical Document Schema、闭合 Unit 类型、稳定 `unitId`、双向父子关系、无环、同级 ordinal 和确定性 Canonical bytes/Hash；
- 精确 sealed base Revision、可信 Human principal、Envelope/Context 一致性、wrong hash、stale head、跨 Scope 和 allow-list 越权拒绝；
- 新 Canonical Content Object、Link、Finalize、Freeze 和单 Parent Revision 创建；base Revision、Content Object、Canonical bytes、Hash 和治理事实不可变；
- 两个 exact Revision Ref 驱动的内存 Diff，稳定产生 `ADDED`、`REMOVED`、`CHANGED`、`MOVED`，并支持 history replay；
- 不新增公共 Diff Result Operation，不持久化 Diff 结果，不改变 Approval、Quality 或 Release 事实。

据 Issue #95 的实现边界和当前 Module Spec，WI-06 的 Artifact 内部实现关闭条件满足。

## 3. 自动验证证据

- 聚焦 Unit：`pnpm exec vitest run modules/artifact/src/business/structured-document-service.test.ts`，1 文件、4 passed。
- 完整门禁：`pnpm verify` 通过；format、lint、typecheck、architecture、contracts 均通过。
- 全量 Unit：30 文件、380 passed、265 skipped，共 645 项。
- Contract：201 operations、201 `FULL`；compatibility baseline 为 200 operations。
- PostgreSQL：pinned PostgreSQL 18.6、Flyway 11.20.3；空库迁移成功，Persistence 为 26 文件、280 passed，第二次 migrate 返回 `No migration necessary`，容器已清理。
- 真实 PostgreSQL 覆盖成功 Human Edit、base immutable、exact Diff replay，以及 Human-only、wrong/stale hash、allow-list 和 no-op 负例。

## 4. 未运行边界

- `AF-IM04-WI06-P-003` 组合流程中途故障注入仍为 `PARTIAL PASS / INJECTION NOT RUN`；已有 WI-04/WI-05 单步骤门禁不等同于本编排的完整 rollback 证明。
- 独立人工业务验收、Provider、生产数据库、公开 HTTP、跨模块 E2E、Renderer、Quality、Approval 和 Release 均保持 `NOT RUN`。
- `Manual-ART-024.md` 是可复核的 synthetic procurement-procedure 技术夹具，不代表真实业务政策验收。

## 5. Git 交付结果

文档经用户检查确认后，状态同步已提交为 `3128e120167ee3b85fccdab5b2254bcb855988fb` 并非强制推送。PR #113 已按 exact head 通过 CI 并合并，merge commit 为 `435b3b438122de7e8f053708c5cc1bcb49e7494f`；Issue #95 已关闭；重新交付分支的本地和远端引用均已删除。实现 worktree 仍以 detached 方式保留，WI-07 dirty worktree 未修改。
