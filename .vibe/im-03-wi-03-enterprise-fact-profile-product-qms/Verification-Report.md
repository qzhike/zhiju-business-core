# IM-03 WI-03 Verification Report

日期：2026-08-25
对应 Issue: #59

## 自动验证

| Gate | 结果 |
|---|---|
| `pnpm format:check` | PASS |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS（V2001 + 业务 Repository + 11 个 Handler + 11 个 focused PG 测试） |
| `pnpm test` | 21 文件 / 348 测试 PASS；12 文件 / 189 skipped（persistence gate 跳过） |
| `pnpm architecture` | `architecture_boundaries=PASS`；`@zhiju/enterprise-project` 未引用 `@zhihu/identity-policy` |
| `pnpm contracts:check` | `operations=200` 不变；受控 Capability 不进入 Catalog |
| `pnpm persistence:gate` | 14 文件 / 199+ 测试 PASS（含新 WI-03 11 个 focused 用例）；二次 migrate no-op |

## Focused PostgreSQL 用例（IM-03 WI-03 贡献）

| ID | 覆盖 | 期望 | 实际 |
|---|---|---|---|
| `EP-WI03-P-001` | 跨 Enterprise 重复 `displayCode` | `PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT` | PASS |
| `EP-WI03-P-002` | propose + confirm，2 个 version 行追加 | 历史可追溯 | PASS |
| `EP-WI03-P-003` | Agent actingFor Human 调 confirm | `PROJECT_HUMAN_ONLY_DENIED` | PASS |
| `EP-WI03-P-004` | Product 重复激活同 version | `PROJECT_PRODUCT_ACTIVATION_NOOP` | PASS |
| `EP-WI03-P-005` | QMS activate → activate → rollback | 旧 revision 仍在 | PASS |
| `EP-WI03-P-006` | Profile Snapshot 跨 Enterprise factRef | `PROJECT_PROFILE_SOURCE_MISMATCH` | PASS |
| `EP-WI03-P-007` | get_enterprise_profile_snapshot 重放旧 snapshot | payloadHash 一致 | PASS |
| `EP-WI03-P-008` | snapshot id = `latest` | `PROJECT_PROFILE_SOURCE_MISMATCH` | PASS |
| `EP-WI03-P-009` | snapshot id 不存在 | `PROJECT_PROFILE_SNAPSHOT_IMMUTABLE` | PASS |
| `EP-WI03-P-010` | 空 productVersionRefs | `EnterpriseBusinessError` | PASS |
| `EP-WI03-P-011` | canonical JSON hash order-independent | 一致 | PASS |

## NOT RUN

- 用户手动跑 Probe（`tests/manual/im03-wi03-probe.mts`）：脚本在 WI-04/WI-05 时补齐。
- 真实 PostgreSQL 容器由 CI 触发；当前工作树复跑受 Docker Hub manifest 查询 EOF 阻塞。
- IM-04+ Projection、Inbox、真实 Provider、飞书。

## 关键决策回顾

- 业务 Aggregate Root 拥有自己的 `aggregate_version`，不与 `process_instance` 共享 CAS；
- 受控 Capability 维持 WI-01 决策，不进入公开 Catalog；
- Human-only 边界在 Handler 入口实现 `ensureHumanPrincipal`，与 IdentityPolicy 公开 Decision Port 留出 composition 层接线位；
- V2001 用 `REVOKE UPDATE` + BEFORE UPDATE trigger 双层保护不可变 version/snapshot 行。