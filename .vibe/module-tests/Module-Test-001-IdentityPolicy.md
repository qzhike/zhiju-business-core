# Module-Test-001-IdentityPolicy

版本：v0.1
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-07 REVIEW REPAIR VERIFIED 2026-08-24`

对应规格：[`Module-Spec-001-IdentityPolicy.md`](../module-specs/Module-Spec-001-IdentityPolicy.md)。本文件记录 IdentityPolicy 的 API 层 Unit、Contract、E2E 与人工验收用例和真实结果；高层跨模块场景仍见 `08-verification-baseline.md`。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IP-API-D-001 | Design | IdentityPolicy Module Spec 与 Catalog | 7 Command、6 Query、7 Event 名称/Owner/字段完整且无重复 | `commands=7 queries=6 events=7`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| IP-API-U-001 | Unit | `AGENT` Actor 带 actingFor Human 请求 Human-only Approval Capability | `DENY`，错误 `IDENTITY_ACTING_FOR_ESCALATION_FORBIDDEN`，保留 Agent kind | 无实现 | `NOT RUN` |
| IP-API-U-002 | Unit | 同 provider/account/external subject 绑定第二个 Principal | 首个映射不变，返回 `IDENTITY_EXTERNAL_LINK_CONFLICT` | 真实 PostgreSQL 顺序冲突与并发冲突均保留首个映射并稳定拒绝 | `PASS` |
| IP-API-U-003 | Unit | 已撤销 Role/Capability 的 Authorization 请求 | 新 Decision 为 DENY；历史 Decision/Snapshot 可读且不改写 | 无实现 | `NOT RUN` |
| IP-API-C-001 | Contract | External Identity Event Fixture | Event 只含 lookup hash ref，不含原始 open_id/email/手机号 | Event payload 通过 `ContractRegistry`；PostgreSQL outbox、拒绝摘要与结果未发现原始标识 | `PASS` |
| IP-API-C-002 | Contract | 同 idempotencyKey、不同 payloadHash 的 Grant Command | Envelope 层拒绝 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不创建 Grant | 无 Handler | `NOT RUN` |
| IP-API-U-004 | Unit | 非闭集 `principalKind`、非法 `initialStatus` 或未通过验证的 ExternalIdentity | 稳定拒绝；Command receipt/audit 与拒绝结果一起提交 | 真实 PostgreSQL 验证拒绝结果、receipt `REJECTED`、result error code 与 audit error code 一致 | `PASS` |
| IP-API-U-005 | Unit | 同 idempotencyKey、相同 account 但不同 subject 的 ExternalIdentity | 拒绝 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不返回错误 DUPLICATE | 真实 PostgreSQL 返回 `CommandExecutionError(IDEMPOTENCY_PAYLOAD_CONFLICT)` 并写安全审计 | `PASS` |
| IP-API-C-003 | Contract | WI-07 生成的 Principal/ExternalIdentity Event 与 Principal Resolution Result | `ContractRegistry` 接受完整 ObjectRef、ContentAddressedRef 和 ValueEnvelope；不得出现原始标识 | Principal/ExternalIdentity Event 与 Query Result 均通过 Registry；直接负例已复现并修复 | `PASS` |
| IP-API-E-003 | E2E | 两个事务并发消费同一个 bootstrap claim | 仅一个 Principal `COMMITTED`；另一方稳定返回 `IDENTITY_BOOTSTRAP_CLAIM_CONSUMED` | 真实 PostgreSQL 两事务仅一方成功，另一方稳定返回 `IDENTITY_BOOTSTRAP_CLAIM_CONSUMED` | `PASS` |
| IP-API-E-001 | E2E | 已绑定飞书 Human 访问 Project A，再访问无权限 Project B | A 返回 ALLOW；B 返回安全折叠的 DENY/FORBIDDEN；无跨企业泄漏 | 无飞书/Identity 实现 | `NOT RUN` |
| IP-API-E-002 | E2E | Human 撤销角色后查看其历史 Approval | 新 Command 被拒绝；历史 Actor/Role/Authorization Snapshot 保留 | 无业务实现 | `NOT RUN` |
| IP-API-M-001 | Manual | 脱敏身份/授权 Fixture | 审核者能追踪 Principal→Role/Capability→Policy→Decision，并确认 Agent 无 Human-only 提权 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- WI-07 已实现的 U-002、C-001、U-004、U-005、C-003、E-003 均已在真实 PostgreSQL、ContractRegistry 或完整 gate 中执行并取得 `PASS`；U-001、U-003、E-001、E-002、M-001 仍未属于本 PR 的运行范围，保持 `NOT RUN`。
- 新增 IP-API-U-004、IP-API-U-005、IP-API-C-003、IP-API-E-003 已覆盖拒绝 receipt、完整幂等身份、可执行 Schema 对齐和 bootstrap claim 并发裁决，修复后的回归结果均为 `PASS`。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 完整验证：`pnpm verify` 为 `PASS`；Vitest `20 passed | 7 skipped / 341 passed | 125 skipped`；Persistence gate `9 files / 138 passed`、二次迁移 no-op、容器已清理。
- 直接 Registry 探针：PrincipalRegistered Event、ExternalIdentityLinked Event、resolve_principal Result 均为 `valid: true, errors: []`。
- 未运行边界：真实 Keycloak/OIDC、飞书 Provider、OpenBao 生产密钥、跨系统 E2E、人工验收保持 `NOT RUN`；测试遗留未创建临时脚本或测试文件。
