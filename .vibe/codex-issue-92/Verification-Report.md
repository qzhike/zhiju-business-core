# Issue #92 验证报告

## 结论

Issue #92 的 Artifact Root、默认 Branch、Metadata CAS、精确 Query 和 Archive 业务切片已在当前工作树实现。最终独立 Persistence Gate 已真实通过，并包含 Enterprise Controlled 双 Scope 与 Project Root 空 Origin owner-boundary 回归。完整 `pnpm verify` 的静态、类型、单元、架构和 Contract 阶段已通过，但其末尾 Persistence 子阶段因 Docker Hub token 请求 `EOF` 未启动，因此不把该次编排记为完整 PASS。

当前没有执行 Commit、Push、PR、Issue Close、Branch 删除或 `main` ancestry 交付动作。

## 基线与范围

- Issue：#92 `[IM-04][WI-03] Implement Artifact root, metadata, branch identity, and archive lifecycle`
- 工作树：`galendai/im-04-wi-03-implement-artifact-root-metadata-bra`
- 实现前 HEAD：`734aa24d2d3cfbc875af27011a8dc80148c7035d`
- Parent：#89；依赖 #91 已合入并关闭
- 范围：Artifact 长期身份、Project/Enterprise Scope、默认 `main` Branch、元数据 JSON Merge Patch、聚合版本 CAS、精确 Query、Human-only Archive
- 非目标：Revision、Canonical Content、Representation、Diff、Approval、Release、Renderer、对象存储、Provider、公开 HTTP、生产数据库、跨模块 E2E 和独立人工验收

## 实现证据

- `migrations/artifact/V4001__artifact_root_metadata_branch.sql`：新增 Root/Branch 表、默认 Branch 外键、不可变字段 Trigger、Owner security-definer 创建/Metadata CAS/Archive 函数、Root/Branch FORCE RLS 和 `artifact_app` 最小读取权限。
- `modules/artifact/src/business/artifact-handlers.ts`：exact Enterprise/Project/DeliveryItem/Policy Ref 校验、Scoped identity digest、公开创建事件、Metadata CAS、Archive 和精确读模型。
- `modules/artifact/src/persistence/artifact-repository.ts`：Root/Branch 读取及三个 owner function 写边界。
- `tests/persistence/artifact-business-aggregates.test.ts`：真实 PostgreSQL 的 ART-023、幂等 Replay/Hash Conflict、identity conflict、Metadata CAS/stale、Archive/post-archive、RLS/ACL 和事务 rollback。
- `modules/artifact/src/business/artifact-handlers.test.ts`：Scope、受保护 Metadata 字段和 JSON Merge Patch 单元回归。
- `/.vibe`：HL-Spec、Module-Spec、Module-Test、逻辑模型、Work Item 和本 Issue 执行记录同步更新。

## 验证结果

| 命令/检查 | 实际结果 | 边界 |
|---|---|---|
| `pnpm exec vitest run modules/artifact/src/business/artifact-handlers.test.ts` | 1 file / 3 tests PASS | 纯业务单元 |
| `pnpm format:check` | PASS | 本地格式 |
| `pnpm lint` | PASS | ESLint |
| `pnpm build` / `pnpm typecheck` | PASS | TypeScript project build |
| `pnpm test`（完整 verify 前半段） | 27 files / 371 passed / 257 skipped | 无真实外部系统 |
| `pnpm architecture` | PASS | source boundary |
| `pnpm contracts:check` | 201 operations / 201 FULL | Catalog、生成类型、兼容性 |
| 最终独立 `pnpm persistence:gate` | 23 files / 272 passed / 0 failed | PostgreSQL 18.6、Flyway 11.20.3；V4001、二次 no-op、Project/Enterprise Controlled Root/Branch、Origin owner-boundary、RLS/ACL、幂等、CAS、Archive、Rollback、容器清理均通过 |
| 完整 `pnpm verify` 末尾 Persistence | NOT RUN in that orchestration | Docker Hub token 请求 `EOF`，数据库容器未启动；不是业务测试失败 |

## 关键持久化输出

- Root 创建：Project 与 Enterprise Controlled 两种输入均已在最终真实 Gate 通过；两条路径均为 `aggregateVersion=1`、`metadataVersion=1`，默认 `main` Branch 的 `workingHeadRef=null`、`headVersion=0`，Approved/Effective 指针为空；Enterprise 缺省 Origin 为 SQL `NULL`，Project 缺省 Origin 由 owner function/数据库约束拒绝并无 Root/Branch 残留。
- 重放：同 key/hash 返回 `DUPLICATE` 并复用首个结果；同 key/different payload 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`。
- Scoped identity：同 Enterprise、Project、Artifact type、初始 title 使用新 key 返回 `ARTIFACT_IDENTITY_CONFLICT`，不创建第二 Root/Branch。
- Metadata：version 1 CAS 到 version 2/metadataVersion 2；stale version 1 返回 `CONCURRENCY_CONFLICT` 和 current version 2。
- Archive：version 2 到 version 3；Root/Branch 保留并转 `ARCHIVED`，3 个 Outbox 与 4 个 Reference Edge 保留；后续 Metadata Update 返回 `ARTIFACT_NOT_ACTIVE`。
- 安全：无 Context/错误 Project 不返回跨 Scope 行；Root UPDATE、Branch DELETE 使用 `42501` ACL 拒绝。
- Rollback：注入故障后 Receipt、Root、Branch、Audit、Reference Edge、Outbox 均为 0。

## 未运行边界

- 生产数据库、真实 EnterpriseProject/IdentityPolicy/Provider、对象存储、公开 HTTP、跨模块 Event Bus/Process Manager、Browser E2E、独立人工 ART-023 walkthrough：`NOT RUN`。
- `artifact.ArtifactMetadataUpdated` 与 `artifact.ArtifactArchived` 当前是 Artifact owning outbox 内部事件；公开 Catalog 未扩展，未来跨模块消费需单独 additive Contract Gate。
- Git commit/push/PR comment/merge/Issue close/branch cleanup：等待用户检查确认后按独立 exact-head 流程执行。
