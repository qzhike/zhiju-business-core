## 背景

IM-02 的退出 Gate 必须在真实 PostgreSQL 上验证；SQLite、In-Memory Repository 或只检查 SQL 文本都不能作为 Persistence 证据。当前技术基线已冻结 PostgreSQL 18.6、Node.js `pg` + Kysely、Flyway CLI + 手写 SQL、Testcontainers，但依赖、镜像、Migration 布局和 CI 命令尚未落地。

父追踪 Issue：#28（WI-01）。

## 工作范围

- 锁定 `pg`、Kysely、Testcontainers PostgreSQL module 与 Flyway CLI 的精确版本；PostgreSQL 18.6 开发/CI 镜像同时锁定 digest。
- 固定 Migration 目录、版本命名、bootstrap 与各 owning Schema 的执行顺序；坚持 Forward-only Expand/Contract。
- 建立本地和 CI 共用的真实 PostgreSQL 启动、Migration、清理与诊断入口。
- 提供空库 Migration 和已迁移数据库重复执行的基线测试，并验证实际 server version、extension availability 和 Flyway history。
- 更新技术/测试文档，记录确定后的物理参数；不把 Testcontainers 成功描述为生产部署通过。

## 验收条件

- [ ] 干净 checkout 可用一条受版本锁定的命令启动 PostgreSQL 18.6、等待健康、执行 Flyway 并运行 Persistence 测试。
- [ ] 镜像 tag 与 digest 不匹配时 Gate 失败；实际数据库主版本/小版本不符合基线时 Gate 失败。
- [ ] 空库 Migration 成功；对同一数据库重复执行结果为 no-op 且 Schema history 无 checksum 漂移。
- [ ] 应用启动和 Runtime Role 不会自动执行 Migration。
- [ ] 测试无残留容器、临时 SQL 或测试数据库；失败时仍能完成清理并保留安全诊断。
- [ ] focused tests、CI Gate 与 `pnpm clean && pnpm verify` 通过；未运行的生产 PostgreSQL 仍标为 `NOT RUN`。

## 手动验收产出

提供本地 Runbook：用户运行单一命令后可看到 PostgreSQL 实际版本、镜像 digest、Flyway 版本、已应用 Migration 清单和第二次执行的 `no pending migration` 结果。

## 依赖与非目标

- 依赖 IM-01 已完成的工程/CI 骨架；无其他 IM-02 Work Item 硬依赖。
- 阻塞 WI-02 至 WI-10。
- 不创建业务表、不实现 Repository/RLS/IdentityPolicy，也不安装生产 PostgreSQL、Keycloak 或 OpenBao。
