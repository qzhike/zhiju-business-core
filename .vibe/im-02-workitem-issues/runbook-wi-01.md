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

1. `[persistence-gate] postgres image: docker.io/library/postgres:18.6@sha256:06cad38a…` — 镜像 tag + manifest digest；启动后 Gate 会用 `docker image inspect` 验证 RepoDigests 必须包含该 digest，不匹配即失败。
2. `[persistence-gate] server_version: 18.6.x` — 来自容器内 `SHOW server_version`；主/次版本不符合 18.6 即失败。
3. `[persistence-gate] flyway version: …11.20.3…` — 来自 `flyway -v`；与锁定版本不符即失败。
4. `flyway migrate (empty database) completed` — 空库首次 Migration。
5. Persistence 测试结果（vitest），包括：
   - flyway history 记录 `V0001 platform bootstrap` 且 checksum 存在；
   - 七个 owning Schema + `projection` 已创建；
   - `uuidv7()` 可用（PG18 特性可用性检查）；
   - **重复执行 Migration 为 no-op 且 `flyway_schema_history` 前后完全一致（无 checksum 漂移）**；
   - 应用/模块源码不引用 Flyway 或 migration 工具（应用启动与 Runtime Role 不会执行 Migration）。
6. `applied migrations:` 清单（来自 `flyway info`）。
7. `[persistence-gate] postgres container removed` — 无论成败都会清理容器，不留残留容器/临时 SQL/测试数据库；失败时先打印容器日志尾部作为安全诊断。

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
