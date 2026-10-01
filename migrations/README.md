# Migration 布局（IM-02 WI-01）

本目录是 Flyway 的 SQL migration 根目录，由部署 Job（`tools/persistence` Gate）以 Migration Owner 执行；应用启动和 Runtime Role 永远不执行 migration（见 `Technology-Baseline-v0.1.md` §3）。

## 目录与版本区间

Forward-only Expand/Contract；一个业务 migration 只允许改一个 owning Schema，不允许跨 Schema FK。

| 目录                   | 版本区间        | 内容                                                                                                                                                                                              |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`           | `V0000`–`V0999` | 平台 bootstrap：Schema 拓扑、扩展、角色与最小权限基线（角色见 `V0002`，Issue #30）；RLS 事务上下文与 Scope 防伪机制（`V0003`，Issue #31，设计见 `../.vibe/decisions/rls-transaction-context.md`） |
| `identity_policy/`     | `V1000`–`V1999` | identity_policy owning Schema                                                                                                                                                                     |
| `enterprise_project/`  | `V2000`–`V2999` | enterprise_project owning Schema                                                                                                                                                                  |
| `task_execution/`      | `V3000`–`V3999` | task_execution owning Schema                                                                                                                                                                      |
| `artifact/`            | `V4000`–`V4999` | artifact owning Schema                                                                                                                                                                            |
| `quality_governance/`  | `V5000`–`V5999` | quality_governance owning Schema                                                                                                                                                                  |
| `release_publication/` | `V6000`–`V6999` | release_publication owning Schema                                                                                                                                                                 |
| `integration_gateway/` | `V7000`–`V7999` | integration_gateway owning Schema                                                                                                                                                                 |

Issue #231 reserves exactly `V7005`–`V7007` for the three TaskExecution recovery migrations. These files remain under `task_execution/` and change only that owning Schema. The IntegrationGateway range excludes these three reserved versions. This bounded allocation keeps the shared Flyway history forward-only after `V7004`; it does not enable out-of-order execution or renumber applied migrations.

Issue #235 reserves exactly `V7008` for the Artifact execution-revision facts and `V7009` for TaskExecution formal completion, as explicitly approved by the user on 2026-09-30. Each migration remains in its owning directory and Schema. IntegrationGateway must not reuse either version. Other ranges remain unchanged; applied migrations are immutable and out-of-order execution remains disabled.

命名规则：`V<4位版本>__<snake_case_description>.sql`。projection 的可重建对象随各模块区间发布，不单独拥有版本区间。

`V0003` 的 Context 写入口只授予 NOLOGIN 的 `platform_context_establisher`；七模块
`<module>_app` 与 `projection_app` 只能执行只读 RLS helper。生产事务协调器的 Login、
Credential 与连接池接入由后续实现配置，本地 Gate 使用 NOINHERIT probe 显式切换角色验证
该权限边界。

Flyway history 表为 `public.flyway_schema_history`。已应用的 migration 不允许修改（checksum drift 会让 Gate 失败）。
