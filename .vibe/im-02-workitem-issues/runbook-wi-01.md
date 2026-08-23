# IM-02 WI-01 本地 Runbook：真实 PostgreSQL 与 Migration 测试入口

对应 Issue #29。一条版本锁定命令完成：启动 PostgreSQL 18.6（镜像 digest 锁定）→ 等待健康 → 执行 Flyway migration → 运行 Persistence 测试 → 清理容器。

## 前置条件

- Node.js 24.19.0、pnpm 11.19.0（`package.json` engines 锁定）。
- 可用的 Docker daemon（Testcontainers 需要；CI 的 ubuntu-24.04 runner 自带）。

## 单一命令

```bash
pnpm install
pnpm persistence:gate
```

`pnpm verify`（CI Gate）末尾同样会执行 `persistence:gate`，即 `pnpm clean && pnpm verify` 覆盖全部门禁。

## 预期输出

命令会依次打印，可用于人工核对基线：

1. `[persistence-gate] postgres image: docker.io/library/postgres:18.6@sha256:06cad38a…` — 镜像 tag + manifest digest；启动后 Gate 双重校验：`docker image inspect` 的 RepoDigests 必须包含该 digest，且用 `docker buildx imagetools inspect` 独立解析 tag 当前指向的 manifest digest 并与锁定 digest 比对（tag 与 digest 不绑定即失败）。
2. `[persistence-gate] server_version: 180006` — 来自容器内 `SHOW server_version_num`（MMmmpp 编码，18.6 → 180006）；主/次版本不符合 18.6 即失败。
3. `[persistence-gate] flyway version: Flyway OSS Edition 11.20.3 by Redgate` — 来自 `flyway -v`；与锁定版本不符即失败。
4. `flyway migrate (empty database) completed` — 空库首次 Migration。
5. Persistence 测试结果（vitest），包括：
   - flyway history 记录 `V0001 platform bootstrap` 且 checksum 存在；
   - 七个 owning Schema + `projection` 已创建；
   - **Extension availability**：`pg_available_extensions` 中 `btree_gist` 与 `pg_stat_statements` 均可用（Technology-Baseline 已批准清单）；`uuidv7()` 可用（PG18 特性）；
   - **重复执行 Migration 为 no-op 且 `flyway_schema_history` 前后完全一致（无 checksum 漂移）**；
   - migrations/ 目录契约（目录、版本区间、`Vdddd__snake_case.sql` 命名）零违规；
   - 应用/模块源码不引用 Flyway 或 migration 工具（应用启动与 Runtime Role 不会执行 Migration）。
6. `[persistence-gate] second migrate: Schema "public" is up to date. No migration necessary.`（或等价 no-pending 行）— 第二次 migrate 的 no-op 证据，直接供人工核对。
7. `applied migrations:` 清单（来自 `flyway info`）。
8. `[persistence-gate] postgres container removed` — 无论成败都会清理容器（含镜像校验失败路径），不留残留容器/临时 SQL/测试数据库；失败时先打印容器日志尾部作为安全诊断。

## 锁定的物理参数

| 组件 | 版本/digest |
|---|---|
| PostgreSQL 镜像 | `docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941` |
| Flyway CLI 镜像 | `docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1` |
| `pg` | 8.23.0 |
| Kysely | 0.29.5 |
| testcontainers / `@testcontainers/postgresql` | 12.1.0 |

权威定义在 `tools/persistence/baseline.mjs`；npm 依赖锁定在根 `package.json` + `pnpm-lock.yaml`。

## NOT RUN 声明

本 Gate 只证明测试容器中的真实 PostgreSQL 行为。生产 PostgreSQL 部署、Keycloak、OpenBao 及其余 IM-02 Work Item（Schema 角色、RLS、业务表等）均为 `NOT RUN`。
