# Module-Test-001-IdentityPolicy

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-08 REGRESSION SCENARIOS ADDED 2026-08-24`

对应规格：[`Module-Spec-001-IdentityPolicy.md`](../module-specs/Module-Spec-001-IdentityPolicy.md)。本文件记录 IdentityPolicy 的 API 层 Unit、Contract、E2E 与人工验收用例和真实结果；高层跨模块场景仍见 `08-verification-baseline.md`。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IP-API-D-001 | Design | IdentityPolicy Module Spec 与 Catalog | 7 Command、6 Query、7 Event 名称/Owner/字段完整且无重复 | `commands=7 queries=6 events=7`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| IP-API-U-001 | Unit | `AGENT` Actor 带 actingFor Human 请求 Human-only Approval Capability | `DENY`，错误 `IDENTITY_ACTING_FOR_ESCALATION_FORBIDDEN`，保留 Agent kind | 无实现 | `NOT RUN` |
| IP-API-U-002 | Unit | 同 provider/account/external subject 绑定第二个 Principal | 首个映射不变，返回 `IDENTITY_EXTERNAL_LINK_CONFLICT` | 无实现 | `NOT RUN` |
| IP-API-U-003 | Unit | 已撤销 Role/Capability 的 Authorization 请求 | 新 Decision 为 DENY；历史 Decision/Snapshot 可读且不改写 | 无实现 | `NOT RUN` |
| IP-API-C-001 | Contract | External Identity Event Fixture | Event 只含 lookup hash ref，不含原始 open_id/email/手机号 | 无 Schema/Fixture | `NOT RUN` |
| IP-API-C-002 | Contract | 同 idempotencyKey、不同 payloadHash 的 Grant Command | Envelope 层拒绝 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不创建 Grant | 无 Handler | `NOT RUN` |
| IP-API-E-001 | E2E | 已绑定飞书 Human 访问 Project A，再访问无权限 Project B | A 返回 ALLOW；B 返回安全折叠的 DENY/FORBIDDEN；无跨企业泄漏 | 无飞书/Identity 实现 | `NOT RUN` |
| IP-API-E-002 | E2E | Human 撤销角色后查看其历史 Approval | 新 Command 被拒绝；历史 Actor/Role/Authorization Snapshot 保留 | 无业务实现 | `NOT RUN` |
| IP-API-M-001 | Manual | 脱敏身份/授权 Fixture | 审核者能追踪 Principal→Role/Capability→Policy→Decision，并确认 Agent 无 Human-only 提权 | 未准备可执行 Fixture | `NOT RUN` |
| IP-WI08-U-004 | Persistence | 同一 idempotencyKey 重放但改变 Assignment/Grant/Revocation/Policy/Bootstrap 的任一业务字段 | 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不改变原事实 | `tests/persistence/identity-policy-roles.test.ts` 覆盖 Role/Grant/Revocation/Policy/Bootstrap；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-005 | Persistence | 两连接并发创建同 Principal/Role/Scope 或 Capability/Scope | 一个提交，另一个稳定返回 active 冲突；不泄漏 `23505` | Role 与 Capability 两组并发回归均为一提交、一稳定业务拒绝；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-006 | Persistence | Project A1 事实在仅允许 A2 的 Context 下被按 ID 撤销 | scope 拒绝；A1 状态、事实、Event、Audit 不改变 | A2 Context 对 A1 行不可见；跨 Project revoke 稳定拒绝；Project scope 同步保留在 receipt/audit/event；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-007 | Persistence | 同一 FIRST_ADMIN_ROLE claim 被两连接并发消费 | 仅一个 Assignment、一个 RoleAssigned Event，另一个稳定拒绝 | 同一 claim 并发回归为一提交、一 `IDENTITY_BOOTSTRAP_ROLE_INVALID`，且仅一条 RoleAssigned Event；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-008 | Persistence | `validTo <= now`、空 justification、伪造 revokedByPrincipalId | 稳定拒绝；撤销事实主体等于事务 Context Principal | 已过期周期被拒绝；撤销事实 `project_id` 与 `revoked_by_principal_id=Context Principal`；输入不再暴露可伪造主体字段；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-P-009 | Migration | 已有 Project Assignment/Grant 的 Revocation 在升级至 V1003 时回填 Project scope | 历史 Revocation 保留目标 Project；RLS 重建后仍按 Project 隔离 | 受控旧库探针先迁移至 V1002、写入 Project RoleAssignment/Revocation，再执行 V1003；回填 `project_id` 与目标 Project 一致 | `PASS` |

## 本阶段结果

- Unit/Contract/E2E/Manual：除 WI-08 persistence/contract 回归外，真实 Provider、跨业务模块和人工场景仍为 `NOT RUN`。
- WI-08 Persistence：`PASS`；`pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上执行 10 个测试文件、142 个测试，空库迁移、V1003、第二次 no-op 与新增失败场景全部通过。
- V1003 非空既有数据升级探针：`PASS`；旧版本数据回填与 V1003 后的 Project scope 保留已在一次性 PostgreSQL 容器中验证，临时探针已清理。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。
