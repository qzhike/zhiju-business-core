# Module-Test-001-IdentityPolicy

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IMPLEMENTATION NOT STARTED`

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

## 本阶段结果

- Unit/Contract/E2E/Manual：`NOT RUN`，原因是实现、Schema 与 Fixture 尚不存在。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 层级 | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| IP-PG-001 | Integration | Context 仅允许 Project A1，写同 Enterprise 的 Project A2 技术行 | RLS 拒绝 `42501` | 七模块 policy catalog 含 Project helper；代表性真实写入返回 `42501` | `PASS` |
| IP-PG-002 | Integration | 已提交 Audit 行后以 audit_reader 查询 masked view | 返回目标 audit_id；底表整体/敏感列仍拒绝 | masked view 返回目标行；底表 count/敏感列为 `42501` | `PASS` |
| IP-PG-003 | Integration | 不同 owner version 写同路径/同 target Reference Edge | 两行成功；同精确版本重复为 `23505` | 两版本成功；精确重复为 `23505` | `PASS` |

业务 Handler、真实身份 Provider 与 payload↔hash Repository Gate 仍为 `NOT RUN`。
