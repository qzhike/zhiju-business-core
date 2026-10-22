# Zhiju Business Core Technology Baseline v0.1

版本：v0.1
日期：2026-08-28（初版 2026-08-17；IM-UI-01 决策路由增量）
状态：`BASELINE / USER APPROVED / IM-01 TOOLCHAIN VERIFIED / IM-02 PERSISTENCE VERIFIED / UI-DG-001-003 USER APPROVED 2026-10-08 / UI IMPLEMENTATION NOT STARTED`

文档角色：Implementation Milestone Plan 的技术选型记录，冻结 IM-DG-001 与 IM-DG-002。它只约束实现技术，不改变 Domain、API、Module、PostgreSQL Logical Model、Feishu 或 Runtime Contract 语义。

---

## 1. 用户决定

用户于 2026-08-17 确认团队熟悉 Node.js，并明确同意本技术建议。IM-01 已锁定并验证 Node.js 24.19.0、pnpm 11.19.0、TypeScript 6.0.3、NestJS 11.2.1、Fastify 5.12.0、Ajv 8.20.0、Vitest 4.1.10。PostgreSQL/Kysely/Flyway/Testcontainers 在当时尚未安装或运行，随后已由 IM-02 完成精确版本锁定和受控 Persistence Gate；当前物理参数见第 7 节。

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
5. 用户已于 2026-08-17 授权 IM-01 依赖联网安装；当前精确版本由 manifest 与 `pnpm-lock.yaml` 锁定。后续新增依赖或 major 升级仍需独立审核。

---

## 6. 后续决策路由

- IM-DG-003/004 已于 2026-08-17 冻结，见 [`Deployment-Security-Baseline-v0.1.md`](Deployment-Security-Baseline-v0.1.md)；
- IM-DG-005：Canonical Document/Workbook Schema 与 Renderer；
- IM-DG-006：6 个 Runtime Command 与默认 Policy；
- UI-DG-001：前端框架、构建模式、SSR/SPA 边界和版本策略；
- UI-DG-002：设计系统、浏览器/视口支持矩阵、可访问性、国际化与视觉验收；
- UI-DG-003：BFF 部署、OIDC Session、CSRF/CSP、API Proxy 与可观测性具体设计。

### 6.1 IM-UI-01 技术选型边界

用户已批准 React + TypeScript + Tailwind CSS + Vite / Monorepo，2026-10-08 明确“按这份提案收口，然后准备正式开工”，进一步批准[UI 首版工程基线](../decisions/workspace-ui-engineering-baseline.md)的 UI-DG-001～003 技术选择：SPA、React Router/TanStack Query、首装精确版本及升级策略、基础组件/Chrome-Edge/可访问性目标、独立同源 BFF 和 Session/安全协议。本文第 2～5 节继续约束 Core 工具链；该决定不是版本已安装、Browser/BFF 已实现或测试 PASS。

正式实现前：

1. 完成适用独立设计审查并使用当前 Core 基线工作区；不在旧 frontend Core 快照上直接开发。精确首装版本按工程基线与 lockfile 落地，兼容性在安装后验证。
2. BFF 拓扑按本次批准的独立进程/同源方案实施，不再重复选择；业务授权、事务、状态和 Completion 继续由 Core owning 能力强制执行。
3. 工程外壳与真实业务接入的前置条件分开：外壳不要求全部后续业务接口先完成，真实 OIDC/启动/Runner 接入仍需各自依赖 READY。
4. UI Unit、Contract、Browser E2E、Security、Accessibility 与 Manual 场景以 [UI01 Test](../module-tests/Module-Test-UI01-WorkspaceUI.md) 为权威，实际执行前保持 NOT RUN。批准技术方案不批准字段草案注册或 Git 交付。

---

## 7. WI-01 已锁定的物理参数（源自 Issue #29）

IM-DG-002 的物理版本与 digest 已落地，权威定义在 `tools/persistence/baseline.mjs` 与根 `package.json`：

| 组件 | 锁定值 |
|---|---|
| PostgreSQL 镜像 | `docker.io/library/postgres:18.6@sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6` |
| Flyway CLI 镜像 | `docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1` |
| `pg` | 8.23.0 |
| Kysely | 0.29.5 |
| testcontainers / `@testcontainers/postgresql` | 12.1.0 |

PostgreSQL 摘要于 2026-10-21 同步官方同版本重建及后续多架构索引更新，2026-10-22 再次更新索引摘要；amd64/arm64 的 PostgreSQL 版本仍为 18.6、Dockerfile 源码修订仍为 `e00e1bd34ec5c8a8e7ad89b273b3d42efaf6d5bc`。首次重建更新了基础系统镜像；后续索引更新保留这两个执行平台的镜像摘要（amd64 `sha256:977087…`、arm64 `sha256:a8be76…`），仅更新其他架构。仍使用 `tag@digest`、实时标签与摘要绑定、实际服务端版本及完整持久化门禁校验。

Migration 目录布局、版本区间与命名规则见 `migrations/README.md`。单一 Gate 命令为 `pnpm persistence:gate`（已并入 `pnpm verify`），本地操作说明见 [`../im-02-workitem-issues/runbook-wi-01.md`](../archive/im-02-workitem-issues/runbook-wi-01.md)。Testcontainers 通过只证明测试容器行为；生产 PostgreSQL 仍为 `NOT RUN`。
