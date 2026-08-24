# Module-Test-001-IdentityPolicy

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-05 PERSISTENCE IN REVIEW`

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
| IP-PG-U-001 | Persistence | Enterprise A 上下文仅允许 Project A，读取/写入未允许 Project 的 Role/Capability/Actor/Decision | 未允许 Project 行不可见，写入返回 `42501`；Enterprise Scope 不得携带 Project，Project Scope 不得缺少 Project | 一次性 PostgreSQL 18.6：未允许 Project 四类查询均为空；非法 Scope 返回 `23514` | `PASS` |
| IP-PG-U-002 | Persistence | 撤销事实声明的 Scope 与父 Assignment/Grant 不同 | 数据库拒绝，父记录和历史事实不被跨 Scope 关联 | 一次性 PostgreSQL 18.6：跨 Scope Role 撤销返回 `23514`；Role/Capability composite FK 与 trigger 均已对账 | `PASS` |
| IP-PG-U-003 | Persistence | CapabilityGrant 使用正确 PolicySnapshot id + 错误 hash；AuthorizationDecision 使用错误 Actor/Policy hash 或与 Actor 不同的 Principal/Kind/认证上下文/Scope | 数据库拒绝，不保存非精确安全引用 | 一次性 PostgreSQL 18.6：错误 Policy/Actor 引用返回 `23514`；精确引用正路径通过 | `PASS` |
| IP-PG-U-004 | Persistence | ActorSnapshot/AuthorizationDecision 的调用者正文含非 promoted 字段（如 `note`） | `canonical_payload` 保留正文且 payload hash 覆盖该正文，不得静默丢弃 | 一次性 PostgreSQL 18.6：两类正文 `note` 均保存并由共享 canonical JSON v1 计算 hash | `PASS` |
| IP-PG-U-005 | Persistence | External Identity 的 `displayHint`、`verificationMethod` 或 `evidenceRefs` 含原始 account/subject；已撤销 Link 再次解析 | 写入以前以不含原值的稳定错误拒绝；撤销映射不再解析为 active Principal | 三类敏感元数据均返回 `IDENTITY_SENSITIVE_EXTERNAL_IDENTIFIER_FORBIDDEN`；撤销后 lookup 为 `undefined` | `PASS` |

## 本阶段结果

- API Handler Unit/Contract/E2E/Manual：`NOT RUN`；WI-05 仅交付低层 Persistence，不冒充公开业务行为。
- WI-05 Persistence：一次性 PostgreSQL 18.6 精确 digest 缓存镜像上 7 个文件、125 个用例通过；Project RLS、撤销 Scope 镜像、Actor/Policy 精确引用、正文完整性和敏感元数据反例均 `PASS`。完整 gate 的 registry tag 解析因 Docker Hub HTTP 429 为 `NOT RUN`，待 exact-head CI 复核。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。
