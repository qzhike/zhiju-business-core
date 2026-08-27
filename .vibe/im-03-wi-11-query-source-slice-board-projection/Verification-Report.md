# IM-03 WI-11 验证报告

日期：2026-08-27
工作目录：`im-03-wi-11-query-source-slice-board-projection`
实现 commit：`c8f1a2cc6291ff65824a04e437a99b660fd926aa`
合并 commit：`43a2f4fcf074e565c10f3db54bd1be9134ef471d`
远端状态：PR #85 已合并；Issue #67 已关闭；实现远端和本地 feature branch 均已删除

## 验证命令与结果

| 命令 | 实际结果 | 证据边界 |
|---|---|---|
| `pnpm typecheck` | `PASS` | TypeScript project build 完成，退出码 0 |
| `pnpm lint` | `PASS` | ESLint 完成，退出码 0 |
| `pnpm format:check` | `PASS` | 全仓库 Prettier 检查通过 |
| `pnpm contracts:check` | `PASS` | public API generation 200、TypeScript payload/result 200、Catalog/Registry 200、compatibility baseline v1.0 通过 |
| `pnpm architecture` | `PASS` | `architecture_boundaries=PASS source_roots=10` |
| `pnpm test` | `PASS` | 23 个测试文件通过；352 个测试通过；17 个文件/237 个测试因未设置 PostgreSQL gate 环境而跳过 |
| `pnpm persistence:gate` | `PASS` | PostgreSQL 18.6、Flyway 11.20.3；空库迁移完成；21 个测试文件、252 个测试全部通过；二次 migrate 输出 `Schema "public" is up to date. No migration necessary.`；V2012 成功应用；容器已清理 |
| `git diff --check` | `PASS` | 当前工作树无 whitespace error |

## WI-11 语义证据

- `project.get_project_context_source` 在真实 PostgreSQL 中验证了 Project/`PROJECT_START` binding 缺失的 fail-closed、Principal audience、purpose/kind 闭集、binding Ref 额外字段不回显，以及权威 Fact `value/sourceRefs` 不进入结果。
- `get_active_baseline_refs` 复用了精确 Project Root active/accepted pointer 读取器；CustomerBaseline、TemplateBaseline、RegulatoryProfile 的现有 PostgreSQL 场景与 WI-11 gate 通过，新增运行时状态校验不使用 `latest/current` 回退。
- Projection rebuild 覆盖 Snapshot Export、严格递增 Event Delta、UPSERT/REMOVE、row count、domain checksum、checkpoint、source state、旧版本保留和 alias 原子切换。
- Board Query 覆盖固定 UTF-8 字节序、非自然数字序 `itemKey`、HMAC cursor、Scope/Filter/Version/expiry 绑定、跨 Project 拒绝和无下一页时省略 `nextCursor`。
- Projection 负向探针覆盖同一 Event 重放返回 `DUPLICATE`、低于 checkpoint 的消费冲突、sequence 0、错误 source module、跨 Scope 输入、immutable Board/failure row、RLS 隔离、partition/watermark guard、较高 target 被较低消费覆盖时保留 lag，以及暂停后 alias 不变。
- Projection 使用独立事务并切换到 `projection_app`，不读取或 Join EnterpriseProject owning Schema；Projection 延迟只形成 `projectionLag/projectionStatus` 诊断，不改变 authoritative criteria/Command 语义。

## 未执行范围

以下不由本地静态检查或 disposable PostgreSQL 结果代替，保持 `NOT RUN`：真实 Provider、生产数据库、公开 HTTP/E2E adapter、跨模块 Process Manager、真实外部系统、独立人工 Reference Project 和独立人工页面验收。自动化验证可以观察 authority watermark 与 projection watermark 的差异，但人工确认“不会把 projection 延迟误判为业务完成”仍未执行。

## Git 交付状态

本报告记录的本地验证已绑定实现 commit `c8f1a2cc6291ff65824a04e437a99b660fd926aa`，并与 PR #85 的 exact-head CI、verification comment、merge commit、Issue closeout comment 和 `origin/main` ancestry 共同构成远端交付证明。远端和本地实现 branch 已删除，执行 worktree 已安全 detach 到 `origin/main`。
