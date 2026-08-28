# Issue #91 Implementation Review Record

日期：2026-08-28

状态：`IMPLEMENTATION REVIEW PASS / PR #102 EXACT-HEAD DELIVERY VERIFIED / ISSUE #91 CLOSED`

## 1. 审查对象

- Issue：[#91](https://github.com/qzhike/zhiju-business-core/issues/91)
- 本地基线：`925753951c1b90f6dd81cb42d3ee3fc039ddfbe3`
- 目标模块：`modules/artifact`
- 既有数据库基线：`migrations/artifact/V4000__artifact_technical_tables.sql`
- 当前状态：实现 commit `76c48f01e1a7c53ca9d2485be34290b4436310fa` 已推送并由 PR #102 合入 `main`；Issue #91 已由 GitHub closing association 自动关闭；远端 feature branch 保留。

## 2. 变更审查

| 区域 | 审查结论 |
|---|---|
| Transaction boundary | `withArtifactTransaction` 在同一连接中按 `platform_context_establisher → establish context → artifact_app` 建立事务 Context |
| Command Receipt | `(idempotency_scope, idempotency_key)` 使用 PostgreSQL 唯一约束 Claim；同 hash Replay，不同 hash 返回稳定 Conflict 并写 DENIED Audit |
| CAS | 技术 `process_instance` 作为后续业务表落地前的 CAS stand-in；expected version 以字符串/BigInt 计算，未经过 JavaScript Number |
| Atomicity | Receipt、技术 Process、Audit、Outbox、Reference Edge 由同一事务提交；body fault 会整体 rollback |
| Target binding | Outbox aggregate type/id/version、Reference Edge owner 都必须与 Command Envelope target 一致 |
| Scope mirror | Outbox payload 的 Enterprise/Project promoted mirror 与 trusted Envelope 对齐；数据库 V4000 trigger 保留第二道防线 |
| Trusted attribution | Envelope 的 Principal、Principal Kind、Actor、Decision、Policy、Enterprise、Correlation 和 Project 必须匹配 trusted Context；技术 Process creator 由 Repository 再校验 |
| PostgreSQL security | 不新增 Migration；复用 V4000 的 FORCE RLS、Process Step parent Scope mirror、owner-version Edge uniqueness、append-only ACL 和跨 Schema 默认拒绝 |
| Module boundary | Artifact persistence 类型只描述 Artifact owning schema；实现不 import IdentityPolicy/EnterpriseProject Repository，不读取其他 owning schema |
| Business scope | 未创建 Artifact/Branch/Revision/Content Object/Representation/Binding 业务表、Repository、Handler、对象存储或 Renderer |

未发现阻塞性实现缺陷。新增代码和测试均通过 TypeScript、ESLint、Architecture、Contract 和真实 PostgreSQL Gate。

## 3. 相关文件

- `modules/artifact/src/persistence/artifact-db.ts`：Kysely 技术表类型、canonical digest、单连接事务 Context；
- `modules/artifact/src/persistence/command-runner.ts`：Receipt、Replay/Conflict、CAS、Audit、Outbox、Reference Edge 原子协调；
- `modules/artifact/src/persistence/artifact-repository.ts`：技术 Process 插入/读取和 trusted creator/scope 校验；
- `modules/artifact/src/persistence/write-guards.ts`：稳定的 hash/promoted mirror/Context 错误；
- `modules/artifact/src/persistence/write-guards.test.ts`：canonical SHA-256 和稳定错误 Unit Test；
- `tests/persistence/artifact-command-runner.test.ts`：真实 PostgreSQL 正负矩阵；
- `modules/artifact/package.json`、根 `package.json`、`pnpm-lock.yaml`、Persistence tsconfig：依赖与项目引用；
- 相关 HL-Spec、Module-Spec、Module-Test、验证基准和本目录 Runbook/Verification：范围与结果同步。

## 4. 审查后的明确边界

本记录的 `PASS` 仅表示本地代码和受控 disposable PostgreSQL 技术边界通过。真实生产数据库、外部 Provider、对象存储、公开 HTTP、跨模块业务 E2E、负载、恢复和人工业务验收仍为 `NOT RUN`。PR #102 的 exact-head CI `33136348440` 已通过，最终 merge commit 为 `92ed04c24b8df8c6db9a8836d69106876a0645e5`；`origin/main` 已验证包含实现 head，Issue #91 已关闭，远端 feature branch 保留。
