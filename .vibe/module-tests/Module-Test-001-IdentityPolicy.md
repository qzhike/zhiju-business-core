# Module-Test-001-IdentityPolicy

版本：v0.2
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / WI-07 REVIEW REPAIR VERIFIED 2026-08-24 / WI-08 REGRESSION VERIFIED 2026-08-24 / EXTERNAL NOT RUN`

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
| IP-WI08-U-004 | Persistence | 同一 idempotencyKey 重放但改变 Assignment/Grant/Revocation/Policy/Bootstrap 的任一业务字段 | 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不改变原事实 | `tests/persistence/identity-policy-roles.test.ts` 覆盖 Role/Grant/Revocation/Policy/Bootstrap；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-005 | Persistence | 两连接并发创建同 Principal/Role/Scope 或 Capability/Scope | 一个提交，另一个稳定返回 active 冲突；不泄漏 `23505` | Role 与 Capability 两组并发回归均为一提交、一稳定业务拒绝；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-006 | Persistence | Project A1 事实在仅允许 A2 的 Context 下被按 ID 撤销 | scope 拒绝；A1 状态、事实、Event、Audit 不改变 | A2 Context 对 A1 行不可见；跨 Project revoke 稳定拒绝；Project scope 同步保留在 receipt/audit/event；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-007 | Persistence | 同一 FIRST_ADMIN_ROLE claim 被两连接并发消费 | 仅一个 Assignment、一个 RoleAssigned Event，另一个稳定拒绝 | 同一 claim 并发回归为一提交、一 `IDENTITY_BOOTSTRAP_ROLE_INVALID`，且仅一条 RoleAssigned Event；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-U-008 | Persistence | `validTo <= now`、空 justification、伪造 revokedByPrincipalId | 稳定拒绝；撤销事实主体等于事务 Context Principal | 已过期周期被拒绝；撤销事实 `project_id` 与 `revoked_by_principal_id=Context Principal`；输入不再暴露可伪造主体字段；`pnpm persistence:gate` 实际通过 | `PASS` |
| IP-WI08-P-009 | Migration | 已有 Project Assignment/Grant 的 Revocation 在升级/补强至 V1004 时保留 Project scope | 历史 Revocation 保留目标 Project；RLS 重建后仍按 Project 隔离 | PostgreSQL 18.6 旧库形状探针中，V1003 bootstrap claim 先落地，再执行 V1004；结果 `scope_kind=PROJECT`、`project_id` 保留，第二次 migrate no-op | `PASS` |

## 本阶段结果

- Unit/Contract/E2E/Manual：除 WI-08 persistence/contract 回归外，真实 Provider、跨业务模块和人工场景仍为 `NOT RUN`。
- WI-08 Persistence：`PASS`；`pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上执行 10 个测试文件、156 个测试，空库迁移、V1003 bootstrap claim、V1004 Project RLS、第二次 no-op 与新增失败场景全部通过。
- V1004 Project scope/RLS 补强：`PASS`；当前 base 已在 V1001 保留 revocation scope 镜像，V1004 对事务技术记录的 Project RLS 与业务 Handler 回归已通过。
| IP-PG-U-001 | Persistence | Enterprise A 上下文仅允许 Project A，读取/写入未允许 Project 的 Role/Capability/Actor/Decision | 未允许 Project 行不可见，写入返回 `42501`；Enterprise Scope 不得携带 Project，Project Scope 不得缺少 Project | 一次性 PostgreSQL 18.6：未允许 Project 四类查询均为空；非法 Scope 返回 `23514` | `PASS` |
| IP-PG-U-002 | Persistence | 撤销事实声明的 Scope 与父 Assignment/Grant 不同 | 数据库拒绝，父记录和历史事实不被跨 Scope 关联 | 一次性 PostgreSQL 18.6：跨 Scope Role 撤销返回 `23514`；Role/Capability composite FK 与 trigger 均已对账 | `PASS` |
| IP-PG-U-003 | Persistence | CapabilityGrant 使用正确 PolicySnapshot id + 错误 hash；AuthorizationDecision 使用错误 Actor/Policy hash 或与 Actor 不同的 Principal/Kind/认证上下文/Scope | 数据库拒绝，不保存非精确安全引用 | 一次性 PostgreSQL 18.6：错误 Policy/Actor 引用返回 `23514`；精确引用正路径通过 | `PASS` |
| IP-PG-U-004 | Persistence | ActorSnapshot/AuthorizationDecision 的调用者正文含非 promoted 字段（如 `note`） | `canonical_payload` 保留正文且 payload hash 覆盖该正文，不得静默丢弃 | 一次性 PostgreSQL 18.6：两类正文 `note` 均保存并由共享 canonical JSON v1 计算 hash | `PASS` |
| IP-PG-U-005 | Persistence | External Identity 的 `displayHint`、`verificationMethod` 或 `evidenceRefs` 含原始 account/subject；已撤销 Link 再次解析 | 写入以前以不含原值的稳定错误拒绝；撤销映射不再解析为 active Principal | 三类敏感元数据均返回 `IDENTITY_SENSITIVE_EXTERNAL_IDENTIFIER_FORBIDDEN`；撤销后 lookup 为 `undefined` | `PASS` |
| IP-PG-U-006 | Persistence | NOINHERIT 登录同时持有 `platform_context_establisher` 与 `identity_policy_app`，执行 WI-05 Repository 事务 | 同一事务先以 establisher 建 Context，再切到 app；app 单独不能伪造 Context，Repository 可受 RLS 读写 | 首次集成复现 `42501`；修复后一次性 PostgreSQL 18.6 全部 130 项通过 | `PASS` |
| IP-PG-U-009A | PostgreSQL Unit | 两个并发 Command 使用同 idempotency scope/key 与相同 payload hash | body 只执行一次；winner 为 `COMMITTED`，loser 为保存结果的 `DUPLICATE`；无 `23505` | body 1 次；结果为 `COMMITTED` + `DUPLICATE`；Receipt 1 行 | `PASS` |
| IP-PG-U-009B | PostgreSQL Unit | Envelope Principal/Actor/Decision/Enterprise/Project/Correlation 任一值与事务上下文不一致 | 首次数据库写入前稳定拒绝；Receipt/Audit/Outbox 均为 0 | 6 类不一致均返回 `COMMAND_CONTEXT_MISMATCH`；Receipt/Audit 0 行 | `PASS` |
| IP-PG-U-004A | PostgreSQL Unit | CAS helper 及 WI-08 Role/Capability revoke 的 target/expectedVersion 与 Envelope 不同，或 expectedVersion 超过 JS 安全整数 | 不一致稳定拒绝；Role/Capability 状态与 Event aggregate version 均按 PostgreSQL `bigint` 精确加一 | target/version 不一致返回 `COMMAND_TARGET_MISMATCH`；scoped revoke `9007199254740993 → 9007199254740994`，数据库行与 Event 一致 | `PASS` |
| IP-PG-U-010A | PostgreSQL Unit | 业务拒绝包含 current aggregate version 后重放 | REJECTED receipt canonical result 和 DUPLICATE result 均保留相同 current version | 首次、Receipt 与重放均返回 `currentAggregateVersion=1` | `PASS` |
| IP-PG-M-001 | Migration | 已应用 V1000/V1001 的数据库升级到 WI-06 | V1000 checksum 不变；forward-only V1002 增加平台 Receipt expected version 列 | PR 相对 base 的 V1000 内容无差异；V1002 history `Success` 且列为 `bigint` | `PASS` |
| IP-PG-M-002 | Migration | 在已应用 WI-06 V1002 的数据库上集成 WI-07 bootstrap claim | 通过后续 forward-only V1003 创建 `bootstrap_claim`，V1002 不重复执行且二次迁移 no-op | 空库应用 V1002、V1003 均为 `Success`；二次迁移返回 `Schema \"public\" is up to date. No migration necessary.` | `PASS` |
| IP-PG-U-011 | Persistence Integration | WI-06/WI-07 probe 登录在最新 WI-03 权限模型下执行 Command transaction | NOINHERIT 登录同时拥有 `platform_context_establisher` 与 `identity_policy_app` membership；事务内先建立 Context 再执行 app SQL | 双角色 fixture 下 10 files / 156 tests 全部通过 | `PASS` |

## 本阶段结果

- WI-07 已实现的 U-002、C-001、U-004、U-005、C-003、E-003 均已在真实 PostgreSQL、ContractRegistry 或完整 gate 中执行并取得 `PASS`；U-001、U-003、E-001、E-002 仍未属于本 PR 的运行范围，保持 `NOT RUN`；WI-06/WI-07 migration 用例另见 IP-PG-M-001/IP-PG-M-002。
- 新增 IP-API-U-004、IP-API-U-005、IP-API-C-003、IP-API-E-003 已覆盖拒绝 receipt、完整幂等身份、可执行 Schema 对齐和 bootstrap claim 并发裁决，修复后的回归结果均为 `PASS`。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 完整验证：合并最新 WI-07 base 后 `pnpm verify` 为 `PASS`；Vitest `20 passed | 8 skipped / 341 passed | 143 skipped`；Persistence gate `10 files / 156 passed`；V1002/V1003/V1004 成功、二次迁移 no-op、旧库形状 V1004 升级探针通过、容器已清理。
- 直接 Registry 探针：PrincipalRegistered Event、ExternalIdentityLinked Event、resolve_principal Result 均为 `valid: true, errors: []`。
- 未运行边界：真实 Keycloak/OIDC、飞书 Provider、OpenBao 生产密钥、跨系统 E2E、人工验收保持 `NOT RUN`；测试遗留未创建临时脚本或测试文件。
- API Handler Unit/Contract/E2E/Manual：`NOT RUN`；WI-05/WI-06 只交付低层 Persistence 与 Command transaction primitive，不冒充公开业务行为。
- WI-05 Persistence：集成此前 `origin/main` 后，`pnpm clean && pnpm verify` 完整通过；PostgreSQL 18.6 下 7 files / 130 tests `PASS`。
- WI-06 修复前基线：8 files / 129 tests `PASS`，但未覆盖并发 Claim、Context 绑定、精确 CAS 与升级路径；修复后 8 files / 133 tests `PASS`。本次最新 base 集成后的最终数字以重新执行结果为准。
- 最新 base 首次集成曾因 WI-08 probe 缺少 `platform_context_establisher` membership 导致 suite setup 失败；补齐 `INHERIT FALSE, SET TRUE` 双角色 fixture、顺延 WI-07 migration 后，最终 `pnpm verify` 完整 `PASS`：Unit/Contract 341 tests、Persistence 10 files / 156 tests、architecture、Catalog/Registry 200/200 与 compatibility 全部通过。
- 外部 Provider、HTTP/E2E、Outbox 发布/Inbox 消费与人工验收：`NOT RUN`。

## IM-02 WI-04 PostgreSQL 用例

| ID | 层级 | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| IP-PG-001 | Integration | Context 仅允许 Project A1，写同 Enterprise 的 Project A2 技术行 | RLS 拒绝 `42501` | 七模块 policy catalog 含 Project helper；代表性真实写入返回 `42501` | `PASS` |
| IP-PG-002 | Integration | 已提交 Audit 行后以 audit_reader 查询 masked view | 返回目标 audit_id；底表整体/敏感列仍拒绝 | masked view 返回目标行；底表 count/敏感列为 `42501` | `PASS` |
| IP-PG-003 | Integration | 不同 owner version 写同路径/同 target Reference Edge | 两行成功；同精确版本重复为 `23505` | 两版本成功；精确重复为 `23505` | `PASS` |

业务 Handler、真实身份 Provider、HTTP/E2E 与人工验收仍为 `NOT RUN`；WI-05/WI-06 的 payload↔hash Repository/Command transaction 子 Gate 已自动通过。
