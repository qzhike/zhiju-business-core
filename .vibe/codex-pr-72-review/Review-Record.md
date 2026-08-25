# PR #72 代码审查与修正记录

日期：2026-08-25
仓库：`qzhike/zhiju-business-core`
原始 PR：#72
原始 Issue：#59
原始 head：`9037185967329c7e024bdef9b75f99f1653c8554`
base：`main@a34c72503c842f0d81d7bded28a3fa344dd886ca`
当前工作区：`galendai/59-im-03-wi-03-enterprise-fact-profile-product-qms-2`
状态：`LOCAL REPAIR VERIFIED / USER CONFIRMATION REQUIRED`

## 审查依据

本次审查先读取并对齐以下权威资料：

- `.vibe/high-level-docs/HL-Spec.md`；
- `.vibe/high-level-docs/02-zhiju-core-architecture.md`；
- `.vibe/high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md`；
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md`；
- `.vibe/module-tests/Module-Test-002-EnterpriseProject.md`；
- `.vibe/issue-57-enterpriseproject/Contract-Decision-Matrix.md`；
- `contracts/src/operations/enterprise-project.schema.ts` 与生成 TypeScript 类型；
- PR #72 的精确 head、实际 diff、Issue #59 acceptance 和原始 CI 状态。

## 原始 head 发现

以下问题在原始 head `9037185967329c7e024bdef9b75f99f1653c8554` 上构成合并阻断：

1. 公开 `project.propose_enterprise_fact`、`project.confirm_enterprise_fact` 和 `project.get_enterprise_profile_snapshot` Handler 使用简化对象，丢失 Contract 要求的 `kind/scope/contentHash`、完整 `ValueEnvelope`/`EvidenceRef`，并向 Query Result 添加额外字段。
2. Human-only 检查在 `principalKind` 缺失时按 HUMAN 处理，且 Context 没有必填主体类型，存在绕过缺失字段的路径。
3. Fact 初始 Root 先以 version 1 创建、随后 CAS 到 version 2，但 CREATE Outbox 使用 version 1，Root/Event 版本不一致。
4. Product/QMS/Profile 多处只依据 versionId 查询，未将 `objectId`、Enterprise Scope、project Scope 和 Snapshot contentHash 作为同一精确引用验证。
5. Product displayCode 冲突通过捕获唯一键异常处理；数据库事务进入 aborted 状态后仍可能执行 Receipt/Audit/结果收尾。
6. QMS 首次创建使用全零占位 current revision，Enterprise ACTIVE 校验顺序不安全；后续 revision creation 没有推进 Root/Event version；QMS 激活复用 Product NOOP 错误码。
7. Profile Snapshot 未冻结完整 Fact/Product/QMS 精确版本内容，不能证明 payload 与引用的 version/hash 一致。
8. 业务 Handler 没有写入 source/evidence/decision 的 Reference Edge。
9. 业务 Root current pointer 没有 Enterprise + aggregate + version 的数据库复合 FK 约束。

原始本地第一次 `pnpm persistence:gate` 还暴露了测试门禁顺序问题：空库 Migration 成功，但未先 build workspace 包导致 8 个 Persistence 文件出现 `Failed to resolve entry for package`；该结果被保留为基线失败，不被误记为业务通过。

## 修正位置与行为

| 位置 | 修正内容 |
|---|---|
| `modules/enterprise-project/src/persistence/enterprise-db.ts:199-213` | Trusted transaction Context 增加必填 `principalKind`。 |
| `modules/enterprise-project/src/persistence/command-runner.ts:52-71,156-177` | Command Envelope 增加必填 `principalKind`，并在 Envelope/Context 一致性校验中绑定。 |
| `modules/enterprise-project/src/business/enterprise-business-handlers.ts:67-254` | Human-only、Enterprise Scope、project Scope 排除、精确引用、canonical JSON、Reference Edge 公共辅助逻辑。 |
| `modules/enterprise-project/src/business/enterprise-business-handlers.ts:350-687` | Public Fact proposal/confirmation 复用生成 Contract；Fact Root 初始 version 1、确认 version 2、Evidence/Source Edge。 |
| `modules/enterprise-project/src/business/enterprise-business-handlers.ts:707-790` | Snapshot Query 只接受完整 SnapshotRef，拒绝 `latest/current`、错误 objectId/scope/hash，并返回 Contract Result。 |
| `modules/enterprise-project/src/business/enterprise-business-handlers.ts:808-1400` | Product duplicate conflict、Product version CAS、精确 ProductVersion、Scope Snapshot 和 Human decision Edge。 |
| `modules/enterprise-project/src/business/enterprise-business-handlers.ts:1419-1775` | QMS 三类 decision group 非空、Enterprise ACTIVE 前置校验、NULL 初始 pointer、revision/activation 连续 CAS/Event、独立 QMS NOOP。 |
| `modules/enterprise-project/src/business/enterprise-business-handlers.ts:1802-2047` | Profile 按 Enterprise/Fact/Product/QMS 精确 ID、版本、归属和 lifecycle 冻结完整 payload，并写入 Source Edge。 |
| `modules/enterprise-project/src/persistence/enterprise-business-repository.ts:431-452` | Product displayCode 使用 `ON CONFLICT DO NOTHING`，冲突返回 `false`，避免 aborted transaction。 |
| `migrations/enterprise_project/V2001__enterprise_project_business_aggregates.sql:147-148,475-503` | 撤销 Fact version DELETE；增加 Fact/Product/QMS 复合唯一键和 current-pointer deferrable FK。 |
| `tests/persistence/enterprise-project-business-aggregates.test.ts:339-1210` | 增加 Root/Event version、objectId/hash、principalKind、duplicate continuation、QMS revision、Reference Edge 和完整 Contract 回归断言。 |

## 验证结果

完整 `pnpm verify` 已在当前工作区通过：

- `format:check`：PASS；
- `lint`：PASS；
- `typecheck`：PASS；
- `test`：`21 passed / 12 skipped` 个 Test Files，`348 passed / 189 skipped` 个 Tests；
- `architecture`：`source_roots=10`，PASS；
- `contracts:check`：Public API 200 operations、generated types 200 payloads、Catalog/Registry 200、compatibility findings 0，PASS；
- `persistence:gate`：PostgreSQL 18.6 / Flyway 11.20.3，14 个 Persistence Test Files、202 个 Tests PASS，空库迁移成功，二次 migrate no-op，容器已清理。

测试没有创建需要保留的临时脚本或测试文件。

## 明确未运行边界

- GitHub 远端修正后的 exact-head CI；
- PR comment 发布和回读；
- Commit、非强制 Push、PR Merge、Issue #59 Close 和默认分支同步；
- 真实 Provider、HTTP/跨模块 E2E、生产 PostgreSQL、飞书/外部副作用；
- 人工业务验收和 WI-03 独立手工 Probe。

PR body 中的 `Closes #59` 未被当作可靠的 GitHub closing association；合并后需要单独关闭 Issue #59 并回读状态。上述 GitHub 交付动作必须在用户检查当前工作区并确认后执行。
