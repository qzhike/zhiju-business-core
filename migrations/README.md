# Migration 布局（IM-02 WI-01）

本目录是 Flyway 的 SQL migration 根目录，由部署 Job（`tools/persistence` Gate）以 Migration Owner 执行；应用启动和 Runtime Role 永远不执行 migration（见 `Technology-Baseline-v0.1.md` §3）。

## 目录与版本区间

Forward-only Expand/Contract；一个业务 migration 只允许改一个 owning Schema，不允许跨 Schema FK。

| 目录                   | 版本区间        | 内容                                                                                                                                                                                              |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/`           | `V0000`–`V0999` | 平台 bootstrap：Schema 拓扑、扩展、角色与最小权限基线（角色见 `V0002`，Issue #30）；RLS 事务上下文与 Scope 防伪机制（`V0003`，Issue #31，设计见 `../.vibe/decisions/rls-transaction-context.md`） |
| `identity_policy/`     | `V1000`–`V1999` | identity_policy owning Schema；`V1008` adds the self-only workspace discovery reader (Issue #266)                                                                                                 |
| `enterprise_project/`  | `V2000`–`V2999` | enterprise_project owning Schema                                                                                                                                                                  |
| `task_execution/`      | `V3000`–`V3999` | task_execution owning Schema                                                                                                                                                                      |
| `artifact/`            | `V4000`–`V4999` | artifact owning Schema                                                                                                                                                                            |
| `quality_governance/`  | `V5000`–`V5999` | quality_governance owning Schema                                                                                                                                                                  |
| `release_publication/` | `V6000`–`V6999` | release_publication owning Schema                                                                                                                                                                 |
| `integration_gateway/` | `V7000`–`V7999` | integration_gateway owning Schema                                                                                                                                                                 |

Issue #231 reserves exactly `V7005`–`V7007` for the three TaskExecution recovery migrations. These files remain under `task_execution/` and change only that owning Schema. The IntegrationGateway range excludes these three reserved versions. This bounded allocation keeps the shared Flyway history forward-only after `V7004`; it does not enable out-of-order execution or renumber applied migrations.

Issue #235 reserves exactly `V7008` for the Artifact execution-revision facts and `V7009` for TaskExecution formal completion, as explicitly approved by the user on 2026-09-30. Each migration remains in its owning directory and Schema. IntegrationGateway must not reuse either version. Other ranges remain unchanged; applied migrations are immutable and out-of-order execution remains disabled.

Issue #239 reserves exactly `V7011` for the TaskExecution TaskCompleted dispatcher and `V7012` for EnterpriseProject exact DeliveryItem completion, as explicitly approved by the user on 2026-10-01. Each file remains in its owning directory and modifies only its owning Schema. No other directory, including IntegrationGateway, may reuse either version. This bounded allocation continues the shared history after `V7010`; applied migrations and other ranges remain unchanged, and out-of-order execution remains disabled.

Issue #244 reserves exactly `V7013` for the TaskExecution Run cancellation, lease-expiry abandonment and late-final isolation slice, as authorized by the user on 2026-10-03 through the implementation Issue. The file remains in `task_execution/` and modifies only that owning Schema. No other directory, including IntegrationGateway, may reuse the version. This bounded allocation continues the shared history after `V7012`; applied migrations and other ranges remain unchanged, and out-of-order execution remains disabled.

Issue #248 reserves exactly `V7014` for the TaskExecution Task Board dirty-marker capture and export/dispatch slice, as authorized by the user on 2026-10-05 through the implementation Issue. The file remains in `task_execution/` and modifies only that owning Schema. No other directory, including IntegrationGateway, may reuse the version. This bounded allocation continues the shared history after `V7013`; applied migrations and other ranges remain unchanged, and out-of-order execution remains disabled.

This implementation Issue reserves exactly `V7015` for the TaskExecution Task Board projection slice (generation / row / alias / checkpoint / fence / publication outcome / failure), as authorized by the user on 2026-10-05 through the implementation Issue. The file remains in `task_execution/` and modifies only that owning Schema; it publishes its objects into the shared `projection` Schema, which by design owns no version range of its own, and grants no cross-schema or other-module access. No other directory, including IntegrationGateway, may reuse the version. This bounded allocation continues the shared history after `V7013`; applied migrations and other ranges remain unchanged, and out-of-order execution remains disabled.

Issue #267 reserves exactly `V7016` for the IdentityPolicy company Platform authority/snapshot/publication storage and `V7017` for the EnterpriseProject company requirement definition/publication storage, within its authorized forward-only persistence scope. Each file remains in its owning directory and modifies only that owning Schema. No other directory, including IntegrationGateway, may reuse either version. This bounded allocation continues the shared Flyway history after `V7015`; applied migrations, other ranges and disabled out-of-order execution are preserved.

Issue #279 reserves exactly `V7018` for IntegrationGateway Markdown render bindings and `V7019` for Artifact Markdown representation registration, within its authorized forward-only persistence scope. Each file remains in its owning directory and modifies only its owning Schema. No other directory may reuse either version. This bounded allocation continues the shared Flyway history after `V7017`; applied migrations, other ranges and disabled out-of-order execution are preserved.

Issue #266 adds `V1008__workspace_self_discovery_reader.sql` inside the `identity_policy` range for the self-only workspace project-discovery read boundary. It creates the NOLOGIN/NOINHERIT/NOBYPASSRLS role `identity_workspace_discovery_reader` with SELECT-only access to `identity_policy.capability_grant`, guarded by a dedicated self-only, Project-scope-only RLS policy that exposes only rows whose owning principal equals `platform_security.context_principal_id()` and whose `scope_kind` is `PROJECT` under a valid technical context. The role receives no write, BYPASSRLS, EnterpriseProject or other-schema access, and no existing `*_app`, `*_dispatcher`, `audit_reader` or `projection_app` grant changes. The version stays inside its own owning range, so no shared-history reservation and no out-of-order execution is involved.

命名规则：`V<4位版本>__<snake_case_description>.sql`。projection 的可重建对象随各模块区间发布，不单独拥有版本区间。

`V0003` 的 Context 写入口只授予 NOLOGIN 的 `platform_context_establisher`；七模块
`<module>_app` 与 `projection_app` 只能执行只读 RLS helper。生产事务协调器的 Login、
Credential 与连接池接入由后续实现配置，本地 Gate 使用 NOINHERIT probe 显式切换角色验证
该权限边界。

Flyway history 表为 `public.flyway_schema_history`。已应用的 migration 不允许修改（checksum drift 会让 Gate 失败）。

Issue #291 reserves exactly `V7020` for IdentityPolicy preparation authority/admission, `V7021` for EnterpriseProject preparation requests/source/handoff and the additive PREPARING lifecycle, and `V7022` for IntegrationGateway customer ZIP intake/manifest. Each forward-only file stays in its owning schema with no cross-owner foreign keys or SQL. Existing migration checksums, version ranges and disabled out-of-order execution are preserved. Deployment logins must explicitly receive SET membership of the owning roles used by these entry ports; migrations do not grant a universal application login or bypass RLS.

The approved 2026-10-18 template-driven preparation delta reserves exactly `V7023` for EnterpriseProject analysis-basis facts. It remains under `enterprise_project/`, changes only that owning schema, and cannot be reused by IntegrationGateway or any other owner. The allocation continues the shared forward-only history after `V7022`; applied checksums, other ranges, and disabled out-of-order execution remain unchanged.
