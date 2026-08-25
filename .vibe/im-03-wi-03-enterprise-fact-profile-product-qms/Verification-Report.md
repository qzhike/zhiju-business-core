# IM-03 WI-03 验证报告（PR #72 审查修正版）

日期：2026-08-25
对应 Issue：#59
审查对象：PR #72 原始精确 head `9037185967329c7e024bdef9b75f99f1653c8554`
审查 base：`a34c72503c842f0d81d7bded28a3fa344dd886ca`

## 审查结论

PR #72 原始 head 存在多处合并阻断问题，已经在当前工作区完成修正并补齐回归测试。修正后的本地 `pnpm verify` 全部通过；真实 Provider、HTTP、跨模块 E2E、生产 PostgreSQL 和人工业务验收仍未执行，不能从本地自动化结果推导为 `PASS`。

当前工作区的修正尚未 Commit。按照项目流程，需由用户检查并确认变更后，才进入 Commit、Push、PR comment、精确 head 合并和 Issue 关闭流程。

## 原始基线

第一次执行 `pnpm persistence:gate` 时，PostgreSQL 18.6 / Flyway 11.20.3 空库迁移成功，但门禁未先 build workspace 包，Vitest 在 8 个 Persistence 文件中产生 `Failed to resolve entry for package`；其余 6 个文件的 115 个测试通过。该结果只记录为基线失败，不作为业务 PASS。

随后一次重试曾遇到 Docker Hub manifest 查询 `EOF`；重新执行后镜像成功启动，最终门禁结果以修正后的完整执行为准。

## 主要发现与修正

| 编号 | 原始问题 | 修正与回归证据 |
|---|---|---|
| R1 | 公开 `propose/confirm/get` Handler 使用扁平引用、自由值和额外 Query Result 字段，与生成的 `EnterpriseProject` Contract 不一致。 | 直接复用生成的 Payload/Result 类型，保留 Typed Reference、ValueEnvelope、Evidence、SnapshotRef 和 contentHash；`typecheck`、Contract Gate 与真实 PostgreSQL 用例通过。 |
| R2 | Human-only Handler 在缺少 `principalKind` 时默认按 HUMAN 继续，且未同时绑定可信 Context。 | Context 与 Command Envelope 均要求 `principalKind`，两者必须同时为 HUMAN；显式 Agent 和缺失字段回归用例均返回 `PROJECT_HUMAN_ONLY_DENIED`。 |
| R3 | Fact 首次写入先创建 Root version 1，再 CAS 到 version 2，却发出 aggregate version 1 的 Outbox Event。 | 首次 Fact Root 直接绑定 version 1/current version，确认时 CAS 到 version 2；测试读取 Root 和 Outbox，断言版本序列 `1,2`。业务表增加复合 current-pointer FK。 |
| R4 | 多处强引用只校验 versionId，未校验 objectId、Enterprise Scope 或 Snapshot contentHash。 | 增加 objectType/objectId、Scope、project-scope 排除和 contentHash 校验；Product、QMS、Profile、Snapshot hash/objectId 负向用例通过。 |
| R5 | Product 重复 displayCode 通过捕获唯一键异常处理；事务已经 aborted 后仍可能继续 Receipt/Audit 收尾。 | Repository 改为 `ON CONFLICT DO NOTHING` 并返回布尔结果，业务层返回稳定的 `PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT`；重复拒绝后同一连接继续创建另一个 Product 的测试通过。 |
| R6 | QMS 首次创建使用全零占位 current revision，且在 Enterprise 状态校验前可能写根；后续 revision 没有推进 Root/Event version；QMS 重复激活复用 Product NOOP 码。 | 首次 Root 使用合法 NULL pointer，先验证 Enterprise ACTIVE；创建 revision 和激活/回滚均推进 Root/Event version；使用 `PROJECT_QMS_ACTIVATION_NOOP`。QMS 版本序列测试通过。 |
| R7 | Profile Snapshot 只部分校验 enterprise_id，未冻结完整 Fact/Product/QMS 精确版本内容，Query Result 也超出公开 Contract。 | Snapshot payload 保存完整精确引用、值/决策和 hash；Profile 逐项校验对象归属、当前 QMS revision 和 lifecycle，Query 只返回 Contract 定义的 `snapshotRef + payload`。 |
| R8 | 业务 Handler 没有为 source/evidence/decision 生成 Reference Edge，无法证明同事务可追溯引用。 | 各业务写入路径追加与 Command target 相同 owner 的 Reference Edge；Fact、Product、QMS、Profile 相关持久化测试覆盖 owner/target 绑定。 |
| R9 | 业务 Root current pointer 缺少 Enterprise + aggregate + version 的数据库复合 FK 防线。 | V2001 增加 Fact/Product/QMS 复合唯一键与 `DEFERRABLE INITIALLY DEFERRED` current-pointer FK，并撤销 Fact version DELETE 权限；空库迁移和二次 no-op 通过。 |

## 修正后自动验证

| Gate | 结果与证据 |
|---|---|
| `pnpm format:check` | `PASS`，所有文件符合 Prettier。 |
| `pnpm lint` | `PASS`。 |
| `pnpm typecheck` | `PASS`。 |
| `pnpm test` | `PASS`，`Test Files 21 passed / 12 skipped`；`Tests 348 passed / 189 skipped`。 |
| `pnpm architecture` | `PASS`，`source_roots=10`。 |
| `pnpm contracts:check` | `PASS`，Public API 200 operations、generated types 200 payloads、Catalog/Registry 200、compatibility findings 0。 |
| `pnpm persistence:gate` | `PASS`，PostgreSQL 18.6 / Flyway 11.20.3；空库迁移成功，14 个 Persistence 文件的 202 个测试通过，二次 migrate 为 no-op，容器已清理。 |
| `pnpm verify` | `PASS`，以上全部 Gate 在同一工作区串行完成。 |

## 持久化用例边界

本次真实 Disposable PostgreSQL focused suite 覆盖：Enterprise 跨边界重复码、Fact Root/Outbox 连续版本、Human-only Agent/缺失主体类型、Product 重复码后继续提交、Product/QMS objectId 精确性、QMS NULL 初始指针与连续版本、Profile 跨 Enterprise/错误 objectId、完整 Contract 输入输出、Snapshot hash/latest/not-found、Reference Edge、空 ProductScope refs 和 canonical hash。

上述测试只证明当前本地代码、Migration、Disposable PostgreSQL 和测试 Fixture 的边界。真实 Provider、HTTP Handler、跨模块 ProjectStartSnapshot、生产数据库、飞书/外部系统和人工业务验收均为 `NOT RUN`。

## GitHub 交付边界

- 原始 PR #72 在本次工作区修正前仍以原始 head 为审查基准；GitHub comment、远端 exact-head CI、合并提交和 Issue #59 关闭尚未执行。
- PR body 中的 `Closes #59` 不视为可靠的 closing association；合并后必须单独关闭并回读 Issue #59 状态。
- 用户确认工作区变更后，才允许创建 Commit；之后必须以新的精确 head 发布审查修正 comment，使用 exact-head 检查和 `--match-head-commit` 合并，并回读 PR、Issue、远端 ancestry 和默认分支状态。
