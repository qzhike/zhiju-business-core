# Zhiju Business Core Technology Baseline v0.1

版本：v0.1
日期：2026-08-17
状态：`BASELINE / USER APPROVED / IMPLEMENTATION NOT STARTED`

文档角色：Implementation Milestone Plan 的技术选型记录，冻结 IM-DG-001 与 IM-DG-002。它只约束实现技术，不改变 Domain、API、Module、PostgreSQL Logical Model、Feishu 或 Runtime Contract 语义。

---

## 1. 用户决定

用户于 2026-08-17 确认团队熟悉 Node.js，并明确同意本技术建议。以下选择进入实现基线；依赖尚未安装，兼容性测试尚未运行。

---

## 2. IM-DG-001 后端与工程工具

| 项目 | 冻结选择 | 实施约束 |
|---|---|---|
| Runtime | Node.js `24.19.0` LTS | `.nvmrc`/toolchain file 与 CI image 锁定；不采用 Current/EOL major |
| Language | TypeScript `6.0.x` | 首次脚手架锁定精确 patch；`strict`、显式 `types`、显式 `rootDir`，不采用 TypeScript 7 preview/native 迁移路径 |
| Module format | ESM + `NodeNext` | 不混用隐式 CommonJS；具体 Nest/Fastify 兼容由 IM-01 spike 验证 |
| Application framework | NestJS `11.x` | 只用于 Composition Root、DI、Controller、Guard、Adapter；Domain 不依赖 NestJS |
| HTTP provider | Fastify `5.x` | 不引入 Express-only middleware；API Transport 选择已冻结，认证入口仍属于 IM-DG-004 |
| Package manager | pnpm workspace | `packageManager` 与 lockfile 锁定精确版本；单一 deployable app，模块为受控 workspace package |
| Build boundary | TypeScript Project References + `tsc -b` | 每模块独立 `tsconfig`；构建必须阻止非法反向依赖 |
| Runtime Contract | JSON Schema Draft 2020-12 + Ajv 8 | JSON Schema 是运行时权威；TypeScript 类型由 Schema 派生，不复制为 Nest DTO Schema |
| Unit/Contract Test | Vitest | Domain/Application 测试不启动 Nest 容器；Composition 测试可使用 `@nestjs/testing` |
| Persistence Test | Testcontainers for Node.js | 使用真实 PostgreSQL；SQLite/内存 Repository 不能完成 Persistence Gate |
| Logging/Tracing | Pino + OpenTelemetry | 结构化日志；Secret、Prompt、原始 Credential 和 Chain of Thought 禁止写入日志 |
| CLI Process | `node:child_process.spawn` | `shell: false`、argv allowlist、AbortSignal、stdout/stderr 分离与平台进程树策略 |

官方版本依据：

- [Node.js v24 LTS](https://nodejs.org/en/about/previous-releases)；
- [TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/)；
- [NestJS 11 migration guide](https://docs.nestjs.com/migration-guide)；
- [Fastify v5 LTS](https://fastify.dev/docs/v5.7.x/Reference/LTS/)；
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references)；
- [Ajv JSON Schema](https://ajv.js.org/json-schema.html)；
- [Node.js child_process](https://nodejs.org/api/child_process.html)。

### 2.1 Framework 隔离

```text
Domain          -> TypeScript only
Application     -> Domain + public Port
Infrastructure  -> Port implementation + pg/Kysely/Adapter
NestJS          -> Composition Root + Transport
```

禁止：Nest DTO/ORM Model 冒充 Domain Entity；跨模块直接注入内部 Repository；全局可变 Provider；Controller 直接写数据库。

---

## 3. IM-DG-002 PostgreSQL 与 Migration

| 项目 | 冻结选择 | 实施约束 |
|---|---|---|
| PostgreSQL | `18.6` | 开发/CI 镜像锁定版本与 digest；生产保持 18.x 当前安全 minor |
| Driver | `pg` | 每个 owning module 使用受控 Role/Pool；事务 Context 显式传递 |
| Query layer | Kysely | 只作为类型安全 SQL builder；不生成 Domain Model 或拥有 Migration |
| Migration | Flyway CLI + 手写 SQL | 由部署 Job 使用 Migration Owner 执行；应用启动和 Runtime Role 不执行 Migration |
| Migration policy | Forward-only Expand/Contract | 先 Add/Backfill/Dual-read-or-write/切换，兼容窗口后再 Remove；生产不依赖自动 down migration |
| Extension: `btree_gist` | 允许 | 仅用于需要标量维度 + range 的 exclusion constraint |
| Extension: `pg_stat_statements` | 允许 | 仅作运维观测；不形成业务依赖 |
| Extension: `pgcrypto` | 暂不启用 | 是否需要数据库端密码学操作由 IM-DG-003/KMS 决策后再审 |
| UUIDv7 | 应用生成，数据库验证 | Aggregate ID 由应用生成并有跨语言 Fixture；PG18 `uuidv7()` 不作为隐式业务默认值 |

官方依据：

- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)；
- [PostgreSQL 18 UUIDv7](https://www.postgresql.org/docs/18/release-18.html)；
- [Kysely](https://www.kysely.dev/)；
- [Flyway SQL migrations](https://documentation.red-gate.com/flyway/flyway-concepts/migrations)；
- [Testcontainers PostgreSQL](https://node.testcontainers.org/modules/postgresql/)。

Migration 文件按 owning Schema 分目录；平台 Role/Schema bootstrap 与业务 Migration 分开。一个业务 Migration 不得同时重写多个 owning Schema，也不得创建跨 Schema 业务 FK。

---

## 4. 明确不采用

- Prisma/TypeORM 作为 Schema、Migration 或 Domain 的权威；
- ORM schema sync、应用启动自动 Migration；
- Express-only 应用边界；
- Nx/Turborepo 作为 IM-01 前置条件；出现真实构建瓶颈后再评估；
- 微服务、Kafka、Redis Queue 或 GraphQL-first；
- TypeScript 7.0 在 IM-01 直接首发；待 Nest、lint、test、codegen 工具链兼容验证后作为独立升级处理。

---

## 5. 版本与升级策略

1. 本文冻结 major/minor 基线；实际安装版本必须由 lockfile、toolchain file 和 container digest 精确锁定。
2. Node/PostgreSQL 安全 minor 可通过兼容测试升级，不改变业务 Contract。
3. NestJS/Fastify/Kysely/Flyway/Ajv/Vitest 的 major 升级是独立技术变更，必须运行全量 Gate。
4. TypeScript 7 采用新原生工具链，作为单独 Migration Milestone，不在 IM-01 静默升级。
5. 依赖选择不授权联网安装；IM-01 开始时按用户授权创建并锁定依赖。

---

## 6. 尚未冻结

- IM-DG-003：对象存储、Secret/KMS、字段加密和开发替身；
- IM-DG-004：认证入口、Workspace UI；HTTP Transport 已确定为 NestJS/Fastify；
- IM-DG-005：Canonical Document/Workbook Schema 与 Renderer；
- IM-DG-006：6 个 Runtime Command 与默认 Policy。
