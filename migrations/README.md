# Migration 布局（IM-02 WI-01）

本目录是 Flyway 的 SQL migration 根目录，由部署 Job（`tools/persistence` Gate）以 Migration Owner 执行；应用启动和 Runtime Role 永远不执行 migration（见 `Technology-Baseline-v0.1.md` §3）。

## 目录与版本区间

Forward-only Expand/Contract；一个业务 migration 只允许改一个 owning Schema，不允许跨 Schema FK。

| 目录                   | 版本区间        | 内容                                                                               |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------- |
| `bootstrap/`           | `V0000`–`V0999` | 平台 bootstrap：Schema 拓扑、扩展、角色与最小权限基线（角色见 `V0002`，Issue #30） |
| `identity_policy/`     | `V1000`–`V1999` | identity_policy owning Schema                                                      |
| `enterprise_project/`  | `V2000`–`V2999` | enterprise_project owning Schema                                                   |
| `task_execution/`      | `V3000`–`V3999` | task_execution owning Schema                                                       |
| `artifact/`            | `V4000`–`V4999` | artifact owning Schema                                                             |
| `quality_governance/`  | `V5000`–`V5999` | quality_governance owning Schema                                                   |
| `release_publication/` | `V6000`–`V6999` | release_publication owning Schema                                                  |
| `integration_gateway/` | `V7000`–`V7999` | integration_gateway owning Schema                                                  |

命名规则：`V<4位版本>__<snake_case_description>.sql`。projection 的可重建对象随各模块区间发布，不单独拥有版本区间。

Flyway history 表为 `public.flyway_schema_history`。已应用的 migration 不允许修改（checksum drift 会让 Gate 失败）。
