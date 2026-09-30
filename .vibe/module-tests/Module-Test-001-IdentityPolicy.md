# Module-Test-001-IdentityPolicy

版本：v0.3
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / WI-07 REVIEW REPAIR VERIFIED 2026-08-24 / WI-08 REGRESSION VERIFIED 2026-08-24 / WI-09 SCOPE+DENY-AUDIT REGRESSION VERIFIED 2026-08-24 / WI-10 TYPED-ORDER+SCOPE REGRESSION VERIFIED 2026-08-24 / PR #51+#52+#53+#54+#55 MERGED / FINAL MAIN VERIFY PASS / IM-02 COMPLETE / ISSUE #28 CLOSED / #176 POLICY VERSION RESOLUTION SCENARIOS APPROVED 2026-09-12 DESIGN VERIFIED / #179 STATIC PROFILE REGISTRY + PURE VALIDATION IMPLEMENTED / #181 PAYLOADGUARD SCENARIOS APPROVED 2026-09-13 / #186 POLICY VERSION HANDLER + AUTHORIZATION + SCOPED PERSISTENCE IMPLEMENTED 2026-09-13 REAL POSTGRESQL 18.6 GATE PASS / POLICY VERSION DOWNSTREAM CONSUMERS, EP/TE BUSINESS CHAIN AND EXTERNAL NOT RUN`

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
| IP-WI07-M-001 | Manual Probe | 本地脱敏 AES-256-GCM Port 执行 Human/Agent/Service 注册、External Identity Link、Principal Resolve，并检查 Event 不泄漏原始标识 | Probe 输出 `COMMITTED`、ExternalIdentityLink Resolve 成功，原始 account/subject 不出现在 Event payload | disposable PostgreSQL Probe 输出三类 Principal 均 `COMMITTED`、Link `COMMITTED`、Resolve 返回 `identity.external_identity_link`，事件数 `4`，原始标识泄漏 `false` | `PASS (LOCAL PROBE)` |
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
| IP-WI09-U-001 | PostgreSQL Unit | ActorSnapshot 使用 Enterprise/Project 非法 shape、或 Project 不在 Context allow-list | 在任何事实写入前返回 `IDENTITY_ACTOR_SNAPSHOT_INVALID`；不得产生半成品行 | 真实 PostgreSQL gate 覆盖 Enterprise 带 Project、Project 缺 Project、以及不在 allow-list 的 Project；均稳定拒绝，11 files / 166 tests 全部通过 | `PASS` |
| IP-WI09-U-002 | PostgreSQL Unit | 已有 Project ActorSnapshot 搭配 Enterprise Intent，或搭配另一个 Project Intent；Enterprise Grant 作为反例 | Scope 不精确时稳定拒绝，不得因 Enterprise Grant 或同 Enterprise 而 ALLOW；使用匹配 Scope 的新 Snapshot 请求无 Grant Project 时产生安全 DENY | Enterprise Actor→Project Intent 与 Enterprise Scope 带 Project 均拒绝；匹配 Project A/B Snapshot 分别得到 ALLOW/DENY，Enterprise Grant 不绕过 Project Scope | `PASS` |
| IP-WI09-U-005 | Real PostgreSQL Regression | Human 仅拥有同 Enterprise 的 CapabilityGrant（scope_kind=ENTERPRISE），请求同 Enterprise 的 Project Intent | 必须产生 `DENY/NO_ACTIVE_GRANT`；Enterprise Grant 不能覆盖任意 Project，且 Decision 的 project scope 保持精确 | PostgreSQL 18.6 gate 断言 Project A2 Actor/Intent 不被 Enterprise Grant 覆盖，结果为 `DENY` 且包含 `NO_ACTIVE_GRANT` | `PASS` |
| IP-WI09-U-003 | PostgreSQL Unit | Actor/Policy/Decision 的 id、payload hash、认证上下文、Purpose、Command type/version 或 Command payload 任一篡改 | 精确引用/绑定失败；不得保存伪造 Decision | 错误 Actor/Policy/Decision 引用元数据、hash、认证上下文、Scope、Command version、invalid time、TTL 与 Decision 绑定均被拒绝；失败路径不新增 Decision | `PASS` |
| IP-WI09-U-004 | PostgreSQL Unit | ActorSnapshot/AuthorizationDecision 正文包含 note、Scope、认证上下文和 Intent 事实 | canonical payload 保留这些字段，payload hash 覆盖实际保存正文；返回引用与数据库 hash 一致 | PostgreSQL 断言 note、principal、scope、认证 hash、actor/policy/command hash、purpose 与返回 ContentAddressed/SnapshotRef 均和保存事实一致 | `PASS` |
| IP-WI09-U-006 | Real PostgreSQL Regression | Project Intent 无匹配 Grant，Decision 结果为 `DENY` | AuthorizationDecision 与同 Scope 的安全 `AuditRecord` 同事务提交；Audit 保存 reason/hash，不包含原始 Payload | PostgreSQL 18.6 gate 断言 Decision 的 `DENY` 与同 Scope `DENIED` Audit 同事务落地；Audit 为 `NO_ACTIVE_GRANT`、32-byte request hash 和脱敏摘要 | `PASS` |
| IP-WI09-C-001 | Contract | 四个访问 Query、`authorize_command` 和 `get_policy_snapshot` 的公开输入/结果 | `ContractRegistry` 接受完整 ScopeRef、ObjectRef、SnapshotRef、ContentAddressedRef；扁平或缺字段引用被拒绝 | `authorize_command`、Project Access、Policy Snapshot 结果均为 `valid: true, errors: []`；公开 authorize envelope 正例通过，旧扁平 ActorSnapshot 引用负例拒绝 | `PASS` |
| IP-WI09-E-001 | Real PostgreSQL E2E | Human Project A ALLOW、Project B DENY、Agent actingFor Human-only DENY、撤销后新 DENY | 六个 Query/Decision Port 可追踪且历史 Decision 不可变 | PostgreSQL 18.6 gate 11 files / 166 tests：Project A ALLOW、Project B DENY、Agent actingFor Human-only 与 Project DENY、撤销后新 DENY、历史 ALLOW 可读、app role 不可更新/删除 | `PASS` |
| IP-WI09-E-002 | Real PostgreSQL Setup | WI-09 probe 登录执行 `withIdentityTransaction` | 登录同时拥有 `platform_context_establisher` 与 `identity_policy_app` membership；先建立 Context 再执行业务 SQL | 修复 fixture 后 NOINHERIT probe 同时以 `INHERIT FALSE, SET TRUE` 持有两个 membership；Gate 通过且容器已清理 | `PASS` |

## 本阶段结果

- WI-07 已实现的 U-002、C-001、U-004、U-005、C-003、E-003 均已在真实 PostgreSQL、ContractRegistry 或完整 gate 中执行并取得 `PASS`；U-001、U-003、E-001、E-002 仍未属于本 PR 的运行范围，保持 `NOT RUN`；WI-06/WI-07 migration 用例另见 IP-PG-M-001/IP-PG-M-002。
- 新增 IP-API-U-004、IP-API-U-005、IP-API-C-003、IP-API-E-003 已覆盖拒绝 receipt、完整幂等身份、可执行 Schema 对齐和 bootstrap claim 并发裁决，修复后的回归结果均为 `PASS`。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)。
- 完整验证：合并最新 WI-07 base 后 `pnpm verify` 为 `PASS`；Vitest `20 passed | 8 skipped / 341 passed | 143 skipped`；Persistence gate `10 files / 156 passed`；V1002/V1003/V1004 成功、二次迁移 no-op、旧库形状 V1004 升级探针通过、容器已清理。
- 直接 Registry 探针：PrincipalRegistered Event、ExternalIdentityLinked Event、resolve_principal Result 均为 `valid: true, errors: []`。
- 未运行边界：真实 Keycloak/OIDC、飞书 Provider、OpenBao 生产密钥、跨系统 E2E、人工验收保持 `NOT RUN`；测试遗留未创建临时脚本或测试文件。
- API Handler Unit/Contract/E2E/Manual：`NOT RUN`；WI-05/WI-06 只交付低层 Persistence 与 Command transaction primitive，不冒充公开业务行为。
- WI-05 Persistence：集成此前 `origin/main` 后，`pnpm clean && pnpm verify` 完整通过；PostgreSQL 18.6 下 7 files / 130 tests `PASS`。
- WI-06 修复前基线：8 files / 129 tests `PASS`，但未覆盖并发 Claim、Context 绑定、精确 CAS 与升级路径；修复后 8 files / 133 tests `PASS`。本次最新 base 集成后的最终数字以重新执行结果为准。
- 首次 WI-08 base 集成曾因 WI-08 probe 缺少 `platform_context_establisher` membership 导致 suite setup 失败；补齐 `INHERIT FALSE, SET TRUE` 双角色 fixture、顺延 WI-07 migration 后，该历史回归基线通过。WI-09 最终验证以本文件下方的审查修复结果为准。
- 外部 Provider、HTTP/E2E、跨模块业务 E2E 与人工验收保持 `NOT RUN`；WI-10 初始本地 Outbox/Inbox persistence gate 已通过，最新 base 集成后的 ACL/Scope 修正也已在提交 `47a2a9d` 通过完整 Gate，并由 [PR #51](https://github.com/qzhike/zhiju-business-core/pull/51) 推送到远端；exact-head recheck 与 CI 已通过，复审无新增语义发现，用户人工验收仍待完成。
- 最新 base `0fc8e464…` 集成后的首次 `pnpm clean && pnpm verify`：格式、Lint、TypeScript、Vitest、architecture、Catalog/Registry/compatibility 均通过；真实 PostgreSQL gate 曾因 `wi10_probe_ip` 缺少 `platform_context_establisher` 导致 9 个 messaging 用例出现 `42501`。该 fixture、Enterprise Grant 覆盖 Project Intent、typed Aggregate ordering 与未经验证 Event Scope 问题以及 WI-07/WI-10 manual Probe Fixture 问题均已修复；最终 `pnpm clean && pnpm verify` 为 `PASS`，Vitest `20 passed | 10 skipped`、`341 passed | 164 skipped`，architecture、Public API、generated types、Catalog/Registry、compatibility 均通过；独立 PostgreSQL gate 为 PostgreSQL 18.6 / Flyway 11.20.3 的 `12 files / 177 tests PASS`，二次 migrate no-op，容器已清理；WI-06/WI-07/WI-10 disposable local Probe 全部通过。外部 Provider、HTTP/E2E、跨模块业务 E2E 与用户人工验收保持 `NOT RUN`。
- Scope conflict 回归要求：未经验证的 Event `projectId` 不得进入 Command Envelope 或 RLS 写入 Scope；不在 Context allow-list 的 Project 必须以 `NULL` 记录在当前 Enterprise 的 Quarantine Inbox/Violation 中，结果仍为 `SCOPE_CONFLICT`。
- WI-09 的新增用例已在下方审查修复 Gate 中取得对应结果；不以旧 PR head 的绿色 CI 或数据库层约束代替公开 Handler、外部运行时和人工验收。

## WI-09 审查修复最终结果（2026-08-24）

- 范围基准：最新 WI-08 base `0a3349eed0e4bb943a7a39b86f58a69888d8201a` 已集成；审查对象为原 PR #49 head `31c9c1061029b57722cae80c7b4b8da45496d522`。
- 静态与契约检查：`prettier`、ESLint、TypeScript、Vitest、architecture、public API、generated Type、Catalog/Registry、v1.0 compatibility 均通过；Vitest 为 `20 passed | 9 skipped`、`341 passed | 153 skipped`，architecture `source_roots=10`，Catalog/Registry `200/200`，compatibility `findings=0`。
- 真实 PostgreSQL：独立 `pnpm persistence:gate` 使用 PostgreSQL 18.6 / Flyway 11.20.3，`11 files / 166 tests PASS`；空库迁移、V1001/V1004、NOINHERIT 双角色 Context、第二次 migrate no-op 均通过，容器已清理。
- 编排边界：最新两次 `pnpm verify` 的静态阶段均通过，但 Docker Hub 未认证 manifest/pull 分别遇到 `EOF`/`429 too many requests`，因此该编排没有取得最后 Gate 的完整 PASS；同一最终代码已由上面的独立 persistence gate 完成真实 Gate 验证。
- Contract 边界：直接 `ContractRegistry` 正例覆盖公开 authorize envelope、Decision/Access/Policy Result；旧扁平引用、错误引用元数据被拒绝。公开 HTTP/Handler adapter 尚未接入本模块，真实 Provider、跨模块 Runtime、外部 E2E、Outbox/Inbox 和人工脱敏追踪保持 `NOT RUN`，不把 Registry 或低层 Port 结果冒充这些运行时验收。
- 测试遗留：本轮未创建需保留的临时脚本/测试文件；Gate 创建的数据库容器已由工具清理。

## IM-02 WI-04 PostgreSQL 用例

| ID | 层级 | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| IP-PG-001 | Integration | Context 仅允许 Project A1，写同 Enterprise 的 Project A2 技术行 | RLS 拒绝 `42501` | 七模块 policy catalog 含 Project helper；代表性真实写入返回 `42501` | `PASS` |
| IP-PG-002 | Integration | 已提交 Audit 行后以 audit_reader 查询 masked view | 返回目标 audit_id；底表整体/敏感列仍拒绝 | masked view 返回目标行；底表 count/敏感列为 `42501` | `PASS` |
| IP-PG-003 | Integration | 不同 owner version 写同路径/同 target Reference Edge | 两行成功；同精确版本重复为 `23505` | 两版本成功；精确重复为 `23505` | `PASS` |
| IP-PG-M-004 | Manual Runbook | 按 WI-02/WI-03/WI-04 Runbook 原命令执行角色、hash、迁移 walker 和 masked audit view 探测 | 命令可复现，输出不因预定义 `pg_` 角色、错误 hash 长度、角色切换或宿主 shell 展开而误失败 | 已修订对应 Runbook；此前实际数据库反例保持不变，新增命令边界与 privileged seed 说明 | `PASS (RUNBOOK REPAIR)` |

业务 Handler、真实身份 Provider、HTTP/E2E 与人工验收仍为 `NOT RUN`；WI-05/WI-06 的 payload↔hash Repository/Command transaction 子 Gate 已自动通过。

## IM-02 WI-10 Outbox/Inbox 用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IP-WI10-U-001 | Persistence/Unit | canonical payload 与入站 payloadHash 不一致 | 写入 Quarantine + `HASH_MISMATCH` Violation，不执行 target | 已在 PostgreSQL 18.6 gate 验证 `QUARANTINED/HASH_MISMATCH`，target 未执行 | `PASS` |
| IP-WI10-U-002 | Persistence/Unit | Enterprise A Context 只允许 Project A，事件带 Project B 或 mirror 不一致 | 写入 Quarantine + `SCOPE_CONFLICT` Violation，不执行 target | 已覆盖 foreign Enterprise、foreign Project 和 Project mirror mismatch；均为 Quarantine，target 未执行 | `PASS` |
| IP-WI10-U-003 | Persistence/Concurrency | 两个消费者并发处理同 consumer/eventId/同 hash | 一个 `PROCESSED`，另一个读取原 Receipt 返回 `DUPLICATE`，target 只执行一次 | PostgreSQL gate 返回 `PROCESSED + DUPLICATE`，target 执行 1 次且无 23505 泄漏 | `PASS` |
| IP-WI10-U-004 | Persistence/Concurrency | Dispatcher A lease 过期后 Dispatcher B claim 同一 Outbox | B 获得新 fencing token；A 的 ACK/失败回写被拒绝 | B 获得新 token；A 的过期 ACK 与失败回写均被 `DISPATCHER_STALE_LEASE` 拒绝 | `PASS` |
| IP-WI10-U-005 | Persistence/Unit | 第一次 claim 后调用失败路径伪造 `attempt=5` | 状态仍由数据库 attempt_count 决定，不能直接 `DEAD` | 不接受 caller attempt；首次失败 `attempt_count=1` 且状态为 `UNKNOWN`，五次服务端计数后才为 `DEAD` | `PASS` |
| IP-WI10-U-006 | Persistence/Failure boundary | DEAD resume 的 Audit insert 失败 | 不得留下已恢复但无 Audit 的事件；reason 不得丢失 | 撤销 Audit INSERT 后 resume 失败，事件保持 `DEAD`；成功路径保存 operator reason | `PASS` |
| IP-WI10-U-007 | Persistence/Ordering | 两个不同 `aggregate_type` 复用同一 `aggregate_id`，其中一个 Type 的较早版本仍未发布 | 顺序约束只在 typed Aggregate identity 内生效；另一 Type 的事件可独立 claim | PostgreSQL 18.6 gate 以 `DemoTypeA`/`DemoTypeB` 复用 UUID 回归，两个事件均可独立 claim 并确认发布 | `PASS` |
| IP-WI10-U-008 | Persistence/Scope Quarantine | 外部 Enterprise 的 Event 带有恰好属于当前 allow-list 的 Project UUID | Quarantine/Violation 使用当前 Context Enterprise 且 `project_id=NULL`，不得把未经验证的外部 Enterprise Project 镜像写入 | PostgreSQL 18.6 gate 断言 foreign Enterprise 事件为 `SCOPE_CONFLICT`，Inbox/Violation 的 `project_id` 均为 `NULL` | `PASS` |
| IP-WI10-E-001 | E2E/Persistence | 首次消费提交后模拟 ACK 丢失，再用同 id/hash replay | 原 Result 返回，Aggregate/Receipt/Outbox/副作用计数不增加 | PostgreSQL 18.6 + Flyway 11.20.3：当前 gate 12 files/177 tests 通过，二次 migrate no-op，含 ACK-loss replay 计数断言 | `PASS` |
| IP-WI10-M-001 | Manual Probe | ACK-loss + same id/different hash 演示 | 输出 `PROCESSED → DUPLICATE → QUARANTINED`，业务事实只有一份 | disposable PostgreSQL Probe 输出 `PROCESSED → DUPLICATE → QUARANTINED`；target outbox `1`、command receipt `1`、contract violation `1`，targetEffects `1` | `PASS (LOCAL PROBE)` |

WI-10 的生产 Broker/Provider、跨模块业务 E2E 和人工验收保持 `NOT RUN`；本地 PostgreSQL gate 只证明持久化、幂等、lease/fencing 与 Quarantine 边界。

## WI-10 最新 base 集成回归

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IP-WI10-R-001 | Persistence Integration | 在当前本地集成工作树执行 `pnpm typecheck` 后运行 `pnpm persistence:gate`，WI-10 使用真实 PostgreSQL 事务 fixture | `withIdentityTransaction` 能以 `platform_context_establisher → identity_policy_app` 建立 Context 并使 12 个 persistence 文件全部通过 | PostgreSQL 18.6 / Flyway 11.20.3：12 files / 177 tests PASS；空库迁移、二次 migrate no-op 和容器清理均通过 | `PASS` |

WI-10 fixture 修复要求：测试登录使用 `NOINHERIT`，并以 `INHERIT FALSE, SET TRUE` 同时授予 `platform_context_establisher` 与 `identity_policy_app`；该配置只修复测试对当前 WI-03 权限契约的建模，不扩大生产角色权限。

| IP-WI10-R-002 | Persistence Integration | Project B 不在 Context allow-list 的 Event 进入 Enterprise A consumer | 结果为 `SCOPE_CONFLICT`；未经验证的 Project 不进入 Command Envelope 或 RLS Scope，Inbox/Violation 以当前 Enterprise 的 `project_id=NULL` 安全记录 | PostgreSQL gate 断言结果为 `SCOPE_CONFLICT`；Inbox 与 Violation 均保存 `project_id=NULL`，target 未执行 | `PASS` |

## 合并后默认分支复验（2026-08-24）

| ID | 层级 | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|---|
| IP-PG-RACE-001 | Persistence Gate | 从合并后的干净 `main` 先运行 `pnpm clean && pnpm verify`，再独立运行 `pnpm typecheck && pnpm persistence:gate` | WI-09 DENY Audit 与 WI-10 Audit INSERT 失败场景互不干扰；Gate 为 `12 files / 177 tests PASS` | 合并后首轮独立 Gate 的历史 `42501` 竞态已由 PR #52 的 `--no-file-parallelism` 修复；PR #53 合并后的最终 main 完整 verify 为 `12 files / 177 tests PASS`，Migration/no-op、容器清理和 exact-head CI 均通过 | `PASS / IM-02 COMPLETE / ISSUE #28 CLOSED` |

修复要求：Gate 必须隔离文件级 Persistence 测试执行，保留 `IP-WI10-U-006` 的真实权限失败反例；PR #52 已满足连续独立 Gate、直接 digest main Gate 和 exact-head CI 条件。Runbook 文档口径修订不改变本项运行时结论。

最终默认分支的 Agent-executed local Runbook 结果（WI-02/03/04/09）以及 WI-06/07/10 Probe 输出见 [`Runbook-Manual-Acceptance-2026-08-24.md`](../archive/im-02-acceptance-issue-28/Runbook-Manual-Acceptance-2026-08-24.md)。该记录不替代外部 Provider 或生产人工验收。

## #176 Policy 版本身份与解析 Port 验证矩阵（提案）

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / STATIC CONTRACT REGISTERED 2026-09-13 (#183) / HANDLER, AUTHORIZATION AND SCOPED PERSISTENCE IMPLEMENTED 2026-09-13 (#186) / DOWNSTREAM CONSUMERS NOT RUN`。行为来源为 [Spec 001 §13](../module-specs/Module-Spec-001-IdentityPolicy.md#13-176-policy-版本身份与解析-port-设计) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)。下表定义批准并实现后的可执行验收输入与预期；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 交付静态 registry/Schema 与纯校验（`IP-176-D-007` 的注册性与纯校验部分），[Issue #183](https://github.com/qzhike/zhiju-business-core/issues/183) 追加两个操作的完整静态契约注册（`IP-176-D-001`），其余各行与 D-007 的写入/授权/生命周期部分已由 #186 在真实 PostgreSQL 18.6 gate 上执行（见下方结果列）；`D-005` 的下游 Builder/Validator/Freeze 消费重验与 `D-007` 的消费端必需 key 校验仍保持 `NOT RUN`，不得因设计评审或现有 full 通过改为 PASS。

| ID | 层级 | 输入 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| IP-176-D-001 | Design/Contract | `identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0` 的名称、版本、Owner、Purpose、Ref 声明、Envelope 元数据与 `zhiju.identity.policy_version` objectType 注册 | 两个操作按共享 API §9.2 完整注册；Purpose `identity.policy.record_policy_version` 与 `identity.policy.resolve_policy` 在两个 registry 中一致；Catalog 净增 2 项、历史 baseline 与旧 `record_policy_snapshot@1.0` 均不重写 | `PASS`（#183 静态注册切片）：Catalog/Registry 209 → 211（本模块 20 → 22）；`contracts/src/operation-registration.ts` 的 `assertPolicyVersionOperationRegistrations`/`assertPolicyVersionCompatibilityMetadata` 在构建期对 Owner、kind、Purpose、INTERNAL、目标/CREATE、AUTHORITATIVE、共享 `payloadGuardPolicyRef` 与引用声明 fail closed；`contracts/src/operations/identity-policy.schema.test.ts` 对账 Registry 与 Schema（含 `resultSchemaRef` 与 `$defs` 名一致）；`pnpm contracts:check` 为 catalog_registry=211/211、compatibility `baseline=v1.0 operations=200 minor=64 findings=64`（全部为新增操作/新增 `$defs` 的 `COMPATIBLE_MINOR`，无 BREAKING），历史 200 项 baseline 未重写。Handler、授权与持久化仍 `NOT RUN` |
| IP-176-D-002 | Contract/Persistence | 同一版本键 `(objectType, objectId, versionId, enterpriseId, projectId)` 提交两次不同 `policyDocument`，分别覆盖 Project 行与 `project_id IS NULL` 的 Enterprise 行（`NULLS NOT DISTINCT` 生效）；另附相同幂等键/相同 payload 的重放 | 第二次绑定稳定返回 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`（不穿透 `23505`），首个版本事实/Hash/绑定不变；Enterprise 行的重复绑定同样被唯一约束裁决；相同键同 payload 走既有 `DUPLICATE` 重放 | `PASS`（#186 真实 PostgreSQL 18.6 gate，`tests/persistence/identity-policy-policy-version.test.ts`）：同一 Project 版本键第二次绑定返回 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`，首事实 id/Hash 不变且该键仍只有一行；Enterprise 行（`project_id IS NULL`）同样被唯一约束裁决；同 key + 同 payload 重放返回原 `DUPLICATE` 结果，同 key 异 payload 抛 `IDEMPOTENCY_PAYLOAD_CONFLICT`；双连接并发同一版本键为一提交、一稳定业务拒绝，`23505` 不外泄 |
| IP-176-D-003 | Contract/Persistence | `supersedesRef` 分别指向不存在、跨 Scope、`effectiveFrom` 不更早或自身的版本（正向为同 identity/Scope 的早期版本）；另用顺序提交与双连接并发让 B、C 都取代同一前驱 A（分别覆盖 Project 行与 Enterprise 行 `project_id IS NULL` 的唯一约束），并覆盖后继 `effectiveFrom` 在未来、以及 `now` 恰等于/晚于 A 的派生 `supersededAt` 时继续消费 A 的变体 | 非法输入 `IDENTITY_POLICY_SUPERSEDE_INVALID` 且不产生取代边；仅第一个后继建立唯一取代边，另一个稳定 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`；A 的 `supersededAt` 唯一等于胜出后继的 `effectiveFrom`（未来生效则在此之前仍为 `USABLE`），不被改写或延长，原不可变行不被 UPDATE，不形成分叉；到达截止点后新消费按 `POLICY_EXPIRED` 拒绝 | `PASS`（#186 gate）：自引用（请求把自身版本键作为 `supersedesRef`）、不存在、跨 identity、跨 Scope、`effectiveFrom` 不更早与倒序取代全部返回 `IDENTITY_POLICY_SUPERSEDE_INVALID` 且不产生边与事实；顺序与双连接并发争夺同一前驱时仅一个后继提交，另一个返回 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`；前驱 `supersededAt` 唯一等于胜出后继的 `effectiveFrom`，原行不被 UPDATE；后继在未来生效时前驱在此之前 `USABLE`、到达该时刻（inclusive）为 `SUPERSEDED`；未来生效且未被取代的版本经解析入口返回 `NOT_YET_EFFECTIVE`。下游消费端 `POLICY_EXPIRED` 拒绝仍属后续切片，保持 `NOT RUN` |
| IP-176-D-004 | Query/Security | `resolve_policy` 输入未知 identity、未知 version、未绑定版本、Scope 不在调用者授权集合；对照合法精确 ref | 前三者统一返回 `IDENTITY_POLICY_VERSION_UNKNOWN`，不泄露跨 Scope 存在性；合法输入返回 exact `policyVersionRef`+`contentHash`+`policyDocument`，不解析 latest、不回退同 objectId 其他版本 | `PASS`（#186 gate）：未知 identity、未知 version、未绑定版本与不在调用者授权集合的 Scope 统一返回 `IDENTITY_POLICY_VERSION_UNKNOWN`（另一 Enterprise Context 亦同），Audit 内部分类为 unknown-or-unbound-version / scope-mismatch 且不泄露跨 Scope 存在性；合法输入返回逐字段相等的 `policyRef`、exact `policyVersionRef`+`contentHash`+`policyDocument`、`scopeRef`、`effectiveFrom`、`checkedAt` 与 `useStatus`，同 identity 的兄弟版本不参与回退 |
| IP-176-D-005 | Query/Contract | Builder 在候选组装、Validator 与 Freeze 各自消费前重新解析：对照 caller 自报 Hash/有效期、复用上一次解析结果、Policy 在两次消费之间被取代、存储暂时不可用 | 自报/复用/不一致分别按 #166 与 #168 的既有错误 fail closed；被取代后新消费拒绝而历史保留；依赖不可用返回 `DEPENDENCY_UNAVAILABLE`，不得当作无限制继续 | `NOT RUN` |
| IP-176-D-006 | Persistence/Security | 版本事实表的隔离矩阵：同 Enterprise（或同 Project）合法读取、另一 Enterprise Context、同 Enterprise 的另一 Project、旧 Platform `policy_snapshot` 兼容读回；外加直接 SQL 写入 scoped 行、修改不可变行、无 Context 查询 | 新表 FORCE RLS 按 `context_allows_enterprise`/`context_allows_project` 分支放行或拒绝（跨行零行/`42501`）；授权 Query 对越界 Scope 统一不可用；旧 Platform 行与其 `context_is_valid()` RLS、`get_policy_snapshot@1.0` 读回语义不变；`REVOKE UPDATE/DELETE` 与镜像校验拒绝写入，不靠隐藏 Ref 代替授权 | `PASS`（#186 gate）：新表 FORCE RLS 使用 `context_allows_enterprise`/`context_allows_project` 分支——同 Enterprise（或同允许 Project）合法读取；另一 Enterprise Context 零行；同 Enterprise 未允许 Project 的 PROJECT 行零行（Enterprise 行按设计仍对同 Enterprise 可见）；无 Context 的 app 角色 SELECT 零行、直接 INSERT 与 UPDATE/DELETE 均 `42501`；superuser 直接 SQL 改写 promoted 列为 `22023`、改写正文由读取完整性边界拒绝；旧 Platform `policy_snapshot` 表、RLS 与 `get_policy_snapshot@1.0` 读回语义未改写 |
| IP-176-D-007 | Contract/Registry | 写入端提交 `policySchemaRefs` 为四个 profile 的 canonical typed ref（以及未注册 key、旧 `im02-static-v1` 条目、非 canonical 形状）；随后消费端校验必需 profile key | 四个 registry key 与 typed ref 的映射固定且可加载；未注册/非 canonical 条目在写入前 `IDENTITY_POLICY_VERSION_UNKNOWN`；旧命令 `record_policy_snapshot@1.0` 的接受集合不变；消费端能据 `policySchemaRefs` 判定所需 key 存在并校验 closed 字段 | 注册与纯校验部分 `PASS`（#179，仅静态 registry/Schema/纯校验）：`contracts/src/policy-profiles.test.ts` 证明七个条目映射固定且可加载、重复 key/重复身份/缺失映射被确定性拒绝、非 canonical 形状与未知版本解析为 `undefined`；`modules/identity-policy/src/commands/static-registry.test.ts` 证明 `im02-static-v1` 接受集合与 typed ref 不变、四个 profile 只在 `im06-static-v1` 下注册、旧条目不能代替 profile；EP/TE 侧必需 key 与 closed 字段由各自模块测试覆盖。#183 追加静态部分：注册 Envelope 接受四个 profile 的 canonical typed ref 与非空去重集合，空集由 `minItems`、重复项由 `uniqueItems` 拒绝，结果侧同一集合保持普通数组语义；对外 `IDENTITY_POLICY_VERSION_UNKNOWN` 映射、`record_policy_version@1.0` 写入与消费端 Handler 仍 `NOT RUN`；#186 追加写入侧：经真实 Handler 提交四个 profile 的 canonical typed ref 成功，未注册条目与非 canonical 形状在写入前稳定返回 `IDENTITY_POLICY_VERSION_UNKNOWN` 且不产生事实；消费端必需 key 与 closed 字段校验仍 `NOT RUN` |
| IP-176-D-008 | Persistence/Contract | 正向对照：同一 Scope 下两个不同 Policy 各自创建首版；同一 identity 先后创建两个**未互相取代**的版本。反向：同一真实前驱的顺序与并发第二个后继。Enterprise 与 Project Scope 各覆盖一次 | 三个正向输入全部成功——无前驱版本的后继索引谓词为假，不参与后继唯一性，不得因 `(NULL, NULL, E, [P])` 折叠被判为重复后继；同一真实前驱的第二个后继仍稳定 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`；`NULLS NOT DISTINCT` 保证 Enterprise 行的 NULL `project_id` 仍能裁决重复后继 | `PASS`（#186 gate）：同一 Scope 下两个不同 Policy 各自首版、同一 identity 两个未互相取代版本均提交成功（部分索引谓词为假，`(NULL, NULL, E, [P])` 不折叠）；Enterprise 与 Project Scope 均覆盖；同一真实前驱的第二个后继（顺序与并发）稳定 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`，`NULLS NOT DISTINCT` 使 Enterprise 行同样被裁决 |
| IP-176-D-009 | Persistence/Recovery | 合法 PolicyVersion 经 owning 登记入口提交，在版本事实、取代边与 Receipt/Audit/Outbox 提交前注入故障；另在提交成功但响应丢失后，以原幂等键/原 payload 重试，并以同键异 payload 作反例 | 提交前故障无部分版本绑定/取代边/成功技术事实；已提交请求返回原重放结果，原 Ref/Hash 与唯一后继不变；同键异 payload 按共享幂等冲突拒绝 | `PASS`（#186 gate）：提交成功但响应丢失后，原 idempotency key + 原 payload 在**有效授权**下返回原 `DUPLICATE` 结果且 `resultPayloadHash` 不变，同 key 异 payload 抛 `IDEMPOTENCY_PAYLOAD_CONFLICT`；提交前冲突（事实 id 已被占用）在 owning 事务内回滚并返回 `API_VALUE_INVALID`，只留下该次尝试的 `REJECTED` Receipt，无新版本事实/取代边且原事实 Hash 不变；授权失败的请求在幂等 Claim 前短路，不产生 Receipt。本项不新增 Event 契约（Catalog 保持 211），该操作不产生 Outbox 行 |
| IP-176-D-010 | Security | 正向为同 Scope 的授权 Human 或受约束 Service，各自持有登记/解析所需 Decision；逐项改为未过期 ALLOW 对应 grant 已撤销、Decision 与当前 Intent 不匹配、只有登记权限却调用解析 Query | 当前授权在各自入口独立校验，非法请求拒绝且不泄露跨 Scope 正文；不能因 Service 身份通配放行，也不能将所有 Service 一律拒绝；历史 Receipt 不恢复当前执行资格 | `PASS`（#186 gate）：同 Scope 的授权 Human 与受约束 Service（各自持有本操作 Purpose 的 ALLOW Decision 与精确 Scope 的 ACTIVE grant）均可登记；登记 Decision 调解析、解析 Decision 调写入、覆盖 grant 已撤销、Decision 已过期时分别在 owning 入口稳定返回 `AUTHORIZATION_DECISION_INVALID` / `AUTHORIZATION_REVOKED` / `AUTHORIZATION_EXPIRED`；**授权与 Scope 重验先于幂等 Claim/读取**，覆盖 grant 撤销后原样重放成功请求返回 `AUTHORIZATION_REVOKED` 而非历史 `DUPLICATE`，Purpose/Intent 不匹配的重放同样拒绝，二者均写脱敏 Audit 且不新增 Receipt；有效授权重放仍返回原 Ref/Hash；**完整授权引用**按入口分别从该入口自身的精确引用派生**单字段**反例——actor 侧 `objectType`、principal `objectId`、ActorSnapshot 的 `objectId`、`snapshotId`、`contentHash` 五个变体，Decision 侧 `objectType`、`objectId`、`contentHash`、`scope` 四个变体——在写入与解析两个入口全部被拒绝并写 `safe_summary=reference-binding` Audit，精确 principal 与 ActorSnapshot 两种形态正向通过；请求 Scope 不在授权集合时统一 `IDENTITY_POLICY_VERSION_UNKNOWN` 且不把未验证 Project 写入 Envelope/RLS Scope |
| IP-176-D-011 | Persistence/Integrity | 合法已提交版本作基线，direct SQL 分别制造 Scope/effective_from/policy_schema_refs 镜像与 canonical payload 不一致、payload Hash 不一致；连接池复用时移除或更换授权 Context | 镜像/Hash 不一致在 owning 写入或读取完整性边界拒绝；无有效 Context 或跨 Scope 不能继承前一事务权限；旧版本事实不被修复性覆盖，隔离拒绝仍遵守 D-006 | `PASS`（#186 gate）：以已提交版本为基线——promoted 列（Scope/`effective_from`/`policy_schema_refs` 镜像）改写被数据库 guard 拒绝（`22023`）；只改 canonical payload 正文（镜像仍一致）由读取完整性边界以 `IDENTITY_POLICY_SNAPSHOT_INVALID` 拒绝并写 Audit，旧事实不被修复性覆盖；连接池复用时同一后端不继承前一事务 Context（登录角色无 schema 访问，切换 app 角色后无 Context 读得零行） |



### #186 执行结果（2026-09-13）

- 实现 revision：本分支 `galendai/im-06-186`；新迁移 `V1005__identity_policy_policy_version.sql`；Handler 在 `modules/identity-policy/src/commands/policy-version.ts`，测试在 `tests/persistence/identity-policy-policy-version.test.ts`。
- 入口形态：两个 Handler 接收完整注册 Envelope，先执行注册契约（结构 + PayloadGuard）与请求绑定，再在幂等 Claim 前完成授权/Scope 重验，写入结果在提交前校验、解析结果在同一事务内校验。
- 配置验证：`vibe verify full --json`（`pnpm clean && pnpm verify`）。静态阶段（prettier / eslint / tsc / Vitest / architecture / contracts:check）与 persistence gate 全部通过；gate 在 PostgreSQL 18.6 / Flyway 11.20.3 上执行空库迁移、二次 migrate no-op、容器清理与 36 个 persistence 测试文件（350 tests）`PASS`，其中本项 14 个用例覆盖 §13.4 不变量、§13.5 授权/失败（含重放重验与完整授权引用绑定）、§13.6 持久化边界、并发裁决、入口与结果契约（含写入结果失败回滚）、两种 Scope 的最大合法 Envelope 读回与边界加一拒绝。
- 覆盖边界：证据来自真实 owning Handler + PostgreSQL；下游 Builder/Validator/Freeze、EP/TE 业务链、外部 Provider 与人工验收保持 `NOT RUN`。

独立设计审查须覆盖版本键语义、取代基数与并发裁决（含无前驱版本共存）、企业级隔离归属（新 scoped 表与旧 Platform 表的分支）、profile registry 注册路径、统一不可用与内部审计边界；本节设计批准不改变 `identity.*` 既有 20 项公开 Contract 的接受集合与历史验收记录。

<a id="181-policyversion-api-payloadguard-验证矩阵提案待批准"></a>

## #181 PolicyVersion API PayloadGuard 验证矩阵（已批准，运行未执行）

状态：`TECHNICAL DESIGN APPROVED 2026-09-13 / DESIGN VERIFIED / PARAMETERS AND CONTRACT REGISTERED 2026-09-13 (#183) / RUNTIME NOT RUN`。本方案与 SD-181-1 已于 2026-09-13 完成独立技术审查并获人类设计验收批准（[人类批准记录](https://github.com/qzhike/zhiju-business-core/pull/182#issuecomment-5647186487)），对应设计 revision `0f596d1f74d9d306bf8a7884ca8adf1f5203d26d`；这是已批准设计基准；操作与参数已由 #183 静态注册，Handler、授权与持久化已由 #186 交付，下游业务链仍未实现。行为来源为 [Spec 001 §13.3.1/§13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1331-payloadguard-技术-policy参数与适用边界181-提案)。两个操作与其共享技术 Policy 已由 #183 静态注册，因此下列适用于静态边界的行（`IP-181-D-001`、`C-001`–`C-010`）已取得 `PASS` 并附实际计量；`IP-181-C-002` 的“等值预算下合法写入读回被拒”预期已按 2026-09-13 事实更正（全分支推导与两种 Scope 实测：请求专有最小编码 885 > 结果专有最大编码 820，等值预算对照同样通过），该行按更正后的预期为 `PASS`；`IP-181-E-001` 与需要 Handler/授权/持久化的部分已由 #186 在真实 PostgreSQL 18.6 gate 上执行（见下表结果列）；不得把静态计量或现有 full PASS 当作 Handler、授权或下游消费能力的证明。

| ID | 层级 | 输入 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| IP-181-D-001 | Design | 对账两个操作的完整请求 Envelope、`CommandResult.data` 与 `QueryResult.data`，以及 §13.3.1 的共享技术 Policy 与 `payloadGuardPolicyRef` 映射 | Envelope 字段与 §5.3 固定顺序一致；`record_policy_version` 结果 Schema 只返回 `{policyVersionRef}`；`resolve_policy` 结果含内联 `policyDocument`；两个操作引用同一 `identity.policy_version@1.0`；`maxRequestedKinds` 显式标注为非适用维度而非缺省无限额 | `PASS`（静态契约对账，`contracts/src/operations/identity-policy.schema.test.ts`）：Envelope 字段与 §5.3 固定顺序一致；`record_policy_version` 结果 Schema 只返回 `{policyVersionRef}`（显式 `resultSchemaRef`），`resolve_policy` 结果含内联 `policyDocument` 与完整 `PolicyVersionResolutionView`；两个操作引用同一 `identity.policy_version@1.0`；`maxRequestedKinds` 在 Spec §13.3.1 与共享 API 标注为非适用维度并保留有限值。Handler 链路仍 `NOT RUN` |
| IP-181-C-001 | Contract | `record_policy_version` 的合法请求 Envelope，其紧凑 JSON 字节数恰等于 262144；同一 Envelope 改为 262145 | 等于上限通过 Guard 并继续结构校验；超过 1 字节即拒绝，`keyword=payloadGuard`、`rule=maxEnvelopeBytes`、`limit=262144`、`instancePath=''`，错误不回显原文 | `PASS`：注册 fixture（Project Scope、UUIDv7 引用、64 位 hex Hash、毫秒时刻）填满至紧凑 JSON 恰 262144 字节并通过 `ContractRegistry.validateOperation`；262145 以 `keyword=payloadGuard`、`rule=maxEnvelopeBytes`、`limit=262144`、`instancePath=''` 拒绝；另以 20×16000 字符的合法形状超限证明 Guard 先于结构校验短路，且错误串不含被拒字段名 |
| IP-181-C-002 | Contract | **读回不变量（结果预算 = 请求预算 + 4096 余量，2026-09-13 事实更正）**：逐项计量结果专有字段（`scopeRef`/`policyVersionRef`/`contentHash`/`useStatus`/`checkedAt`/`supersededAt`）在其合法最大编码下的合计 `R_only`；以最小合法请求包装 × 最大合法结果包装构造“写入恰好 262144 通过”的同一版本读回，并分别用正式预算 266240 与等值预算 262144 对照；另附结果恰等于 266240 与 266241 两个独立反例 | `R_only ≤ 820 < 4096`，且 `R_only` 的每个成员都是有界形状；由此任意合法写入的读取帧 ≤ `262144 + R_only < 266240`，与请求侧字段编码无关。结果恰等于 266240 通过、266241 以 `maxResultBytes` 拒绝；等值预算对照同样通过（此前“等值预算下读回 262153 被拒”的记录不适用于当前契约，已撤回，不再作为验收要求）。不得用请求侧样本或最小值参与该论证，也不得用 `≥` 代替“请求预算 + 余量”的定式 | `PASS`：结果专有成员合法最大编码实测 `R_only=820`；最小合法请求包装按 `TypedReference` 全部分支推导（ObjectRef 95 / VersionedRef 149 / ContentAddressedRef 250 / SnapshotRef 293 / ExternalRef 86 字节，五分支均经注册 Envelope 通过），Project 配对实测 `C_req=1458`、`C_res=1381`、请求专有最小 885 > 结果专有最大 820（增量 −77），Enterprise-only 为 834 / 718；写入恰好 262144 后按最大生命周期读回实测 262067，在 266240 与等值 262144 两个预算下均通过；结果恰 266240 通过、266241 以 `maxResultBytes` 拒绝。事实更正与推导记录见 [Issue #183 对账 comment](https://github.com/qzhike/zhiju-business-core/issues/183#issuecomment-5649915272) |
| IP-181-C-010 | Contract | **时刻精度边界（SD-181-1）**：构造"大正文前驱 + 小正文后继"——前驱正文按最小请求包装写满（请求 262144 通过），后继正文极小但其 `effectiveFrom` 为 `2026-09-13T00:00:00.` + 1000 个 `0` + `Z`（1021 code point，共享 `utcInstant` 校验为 true）；随后读回前驱（`supersededAt` 等于该后继 `effectiveFrom`，`useStatus=NOT_YET_EFFECTIVE`）；正向对照改用毫秒精度的后继（`2026-09-13T00:00:00.000Z`，24 code point）重跑同一链路 | 后继的长精度 `effectiveFrom` 在写入边界被拒绝（超 24 code point 的时刻），不截断、不静默降精度，因此不可能进入任何前驱的 `supersededAt`；正向链路的读回结果在 266240 内通过并保留余量。不得把该约束当作可选：在其缺失时结果侧两个时刻各可达 16384，`R_only` 变为约 33540、远超 4096 余量；SD-181-1 的拒绝发生在**写入边界**（后继的 `effectiveFrom` 超 24 code point），而不是靠结果预算兜底——历史记录中"262441 字节读回被拒绝"使用的是**当时等值的结果预算 262144**，在现行 266240 之下该大小本身不会触发 `maxResultBytes`，其拒绝依据是时刻长度约束；无小数（20 code point）与毫秒精度（24 code point）的 `effectiveFrom` 均通过，共享 `UtcInstant` 的既有操作接受集合与 `compareUtcInstants` 的变长小数比较不受影响 | `PASS`（静态写入边界）：`effectiveFrom` 取 1021 code point（1000 个 `0` 小数）在 `/payload/effectiveFrom` 以 `maxLength=24` 拒绝；四位与九位小数精度同样拒绝；无小数（20 code point）与毫秒精度（24 code point）通过；结果侧 `supersededAt`/`checkedAt` 受同一 24 上限。放宽该约束时两个时刻各可达 16384 code point，实测 Guard 仍接受该帧而字段上界拒绝，`R_only` 变为 33540 > 4096；共享 `UtcInstant` 的定义与既有操作接受集合未改变。后继读取与 Handler 链路仍 `NOT RUN` |
| IP-181-C-003 | Contract | `policyDocument` 内含多字节 Unicode、需要转义的字符（引号、反斜杠、控制字符）与同样 code point 数的纯 ASCII 对照；外加单串 16384/16385 code point 的单变量对照 | 计量按紧凑 JSON 的 UTF-8 字节而非 UTF-16 长度或 code point 数；Unicode/转义样本先于同长度 ASCII 触顶；字符串按 code point 计数，`maxStringCodePoints` 与 JSON Schema `maxLength` 口径一致；**16384 通过、16385 在 `/payload/policyDocument/text` 以 `maxStringCodePoints` 拒绝，且该拒绝发生在总字节数（16427）远低于 262144 时**——该维度独立于字节预算，不得用字节预算推导其边界 | `PASS`：单串 16384 code point 通过（样本总字节 16426）；16385 在 `/payload/policyDocument/text` 以 `rule=maxStringCodePoints`、`limit=16384` 拒绝（总字节 16427，远低于 262144），并经注册 Envelope 路径复核；转义字符（引号/反斜杠/换行 ×400）与多字节 `한`×4096 样本按紧凑 JSON UTF-8 字节计量（`B===Buffer.byteLength(JSON.stringify(sample),'utf8')`，`B−1` 以字节规则拒绝），未使用 UTF-16 长度或 code point 数 |
| IP-181-C-004 | Contract | 数组 1024/1025 项、对象 256/257 个成员、容器深度 32/33，以及 `policySchemaRefs` 的 `NonEmptySet` 正例与重复项反例 | 各维度等于上限通过、超过 1 拒绝；Guard 不改写数组顺序或重复语义；集合契约仍由结构 Schema 的 `uniqueItems`/`minItems` 裁决并拒绝重复项，不由资源限制放宽 | `PASS`：数组 1024 通过 / 1025 以 `maxArrayItems=1024` 拒绝（经注册 Envelope 路径）；对象 256 通过 / 257 以 `maxObjectProperties=256` 拒绝；容器深度 32 通过 / 33 以 `maxDepth=32` 拒绝；`policySchemaRefs` 空数组由 `minItems`、重复项由 `uniqueItems` 拒绝，而结果侧同一重复项通过——集合契约仍由结构 Schema 裁决，未被资源限制放宽 |
| IP-181-C-005 | Contract | 循环引用、`undefined`、非有限数字、`bigint`、函数、带 accessor 或非 JSON 原型的对象 | 一律以 `rule=jsonValue` 拒绝，不进入结构递归；不使用 `JSON.stringify` 的忽略/转换行为接受非法输入，也不先对任意深度对象完整递归序列化 | `PASS`：循环引用、`undefined` 成员、非有限数字、`bigint`、函数、带 accessor 的对象与类实例一律以 `rule=jsonValue` 拒绝，不进入结构递归；经注册 Envelope 路径的循环样例定位在 `/payload/policyDocument/self` |
| IP-181-C-009 | Contract | 计量方法与 inclusive 边界的单变量核对：`{}`（2 字节）、`{"payload":{"policyDocument":{"text":"a"×40}}}`（82 字节）、`{policyVersionRef}` 结果（446 字节）、`resolve_policy` 请求 Envelope（1373 字节）、单串 16384 场景（16426 字节） | 每个样本的最小通过上限 `B` 等于其紧凑 JSON UTF-8 字节数（`Buffer.byteLength(JSON.stringify(sample),'utf8')`）；`B` 通过、`B − 1` 以对应字节规则拒绝，且其他维度未触发。不得把 `B − 1` 记作字节总数，也不得用"唯一序列化器"代替实测 | `PASS`：`{}`=2、含 40 字符单串的 `policyDocument` 样本=82、单串 16384 场景=16426、注册 `{policyVersionRef}` 结果=446 逐项按 `B===紧凑 JSON UTF-8 字节` 核对（`B` 通过、`B−1` 以字节规则拒绝）；`resolve_policy` 请求 fixture 同样执行该对断言（`B=1311` 通过、1310 以 `maxEnvelopeBytes` 拒绝）；请求侧 fixture 实测 `record_policy_version`=2454/2164（含/不含 `supersedesRef`），与 §13.3.2 的 2098/1373 设计样本因引用与键取值组合不同而不等，方法一致 |
| IP-181-C-006 | Contract | 两个操作分别指向未注册技术 Policy（错误 `type`/`version`）与未知操作身份；以及在未注册 `payloadGuard` keyword 的校验器上编译这两个 Schema | 未注册操作返回 `operationRegistry` 拒绝；未知 Policy 引用与未加载 Guard 的校验器拒绝编译/校验，不得降级为无限制或忽略该 keyword 后宣告有效 | `PASS`：`resolve_policy@2.0` 返回 `operationRegistry` 拒绝；`{type:'identity.policy_version',version:'2.0'}` 由 `resolvePayloadGuardPolicy` 抛 `unknown payload guard policy`；未加载 `payloadGuard` keyword 的独立 Ajv 编译注册 Envelope 时抛错，加载同一实现后通过——不存在忽略 keyword 后宣告有效的降级路径 |
| IP-181-C-007 | Contract | 两个操作分别在输入超限、结果超限，以及输入合法但结果独立超限三种组合下校验 | 超限方各自拒绝且互不掩盖；输入超限在任何业务写入或授权查询前短路；结果超限不返回部分成功事实、不截断 `policyDocument`、不产生成功 Receipt/Outbox | `PASS`（#183 静态边界 + #186 真实入口）：静态部分证明输入超限只返回 Guard 错误，结果超限独立以 `maxResultBytes` 拒绝；#186 追加真实入口证据：两个 Handler 接收完整注册 Envelope 并先执行 `ContractRegistry.validateOperation`，262145 字节请求以 `API_PAYLOAD_LIMIT_EXCEEDED` 在授权、幂等与写入前短路且不产生 Receipt；缺字段与重复 canonical schema ref 以 `API_VALUE_INVALID` 拒绝、`integrity.payloadHash` 不符以 `API_PAYLOAD_HASH_MISMATCH` 拒绝；**写入结果在提交前经 `validateOperationResult` 校验**——受控回归注入只拒绝写入结果的注册契约实现，证明校验失败时新版本事实、取代边与成功 Receipt 一同回滚（原事实不变，同一命令在正常契约下提交成功），错误为 `INTERNAL_CONTRACT_VIOLATION`；解析结果的注册契约校验在 owning 事务内执行，越界结果按失败路径返回并写 Audit（`safe_summary=result-contract`）而不截断 |
| IP-181-C-008 | Contract | 四个已注册 profile 的合法 `policyDocument` 样本（§13.3.2 表），配合各自的 canonical typed ref | 四个样本均通过 Guard 且通过结构 Schema；Guard 不改变 profile 的 closed 规则字段、不施加或放宽 TTL 与 `validUntil` 语义，也不把 `policyDocument` 的对象形状要求变成资源限制 | `PASS`：四个已注册消费 profile 的 closed 文档 fixture 配合各自 canonical typed ref 通过注册 Envelope 与结构 Schema，并经 `validatePolicyProfileDocument` 复核 `valid=true`；同一命令加入 profile 规则外字段仍通过通用 Schema（IdentityPolicy 不解释他方 profile 字段）而 profile 校验器拒绝——Guard 未收紧或放宽 profile 规则 |
| IP-181-E-001 | E2E | 按本参数合法写入的最大合法版本，经 `resolve_policy@1.0` 读回后逐字段比对 | 读回的 `policyDocument`/`contentHash`/生命周期观察与写入时同一 canonical payload 一致；不得因包装开销返回不可用、截断或部分结果 | `PASS`（#186 真实 PostgreSQL 18.6 gate）：**Project 与 Enterprise 两种 Scope** 各构造经注册校验、紧凑 JSON 恰为 262144 字节的完整请求 Envelope，经真实授权（Decision 绑定该 payload hash）、Handler 与 PostgreSQL 提交，并由 `resolve_policy@1.0` 读回：`policyDocument` 与写入时逐字段相等，`contentHash` 等于提交返回的 `policyVersionRef.contentHash`，`useStatus=USABLE`，读回结果通过注册结果 schema（≤ 266240）；同一构造下 262145 字节请求以 `maxEnvelopeBytes` 拒绝且不产生事实 |

独立设计审查须覆盖：计量口径（紧凑 JSON UTF-8 字节、code point 与字节的区分、inclusive 边界）、写入/读回预算关系与结果侧**每个变长字段的上界**（含 SD-181-1 的时刻精度约束与 canonical `objectType` 的 `const` 编码）、共享而非分别注册的理由、`maxRequestedKinds` 的非适用性声明、执行位置与固定顺序、错误不泄漏与"禁止部分成功"约束，以及是否改变了既有 Profile/Slice/Platform 接受集合与共享 `UtcInstant` 的既有操作接受集合。本节参数与 SD-181-1 已由 #183 注册；不改变 `identity.*` 既有公开 Contract 的接受集合、`ep.context_source_slice@1.0` 参数与旧命令行为，SD-181-1 只作用于这两个新操作，共享标量定义不变。`IP-181-E-001` 的读回逐字段比对依赖 Handler，保持 `NOT RUN`。

## TaskExecution 创建授权（#190 APPROVED）

对应 [Spec 001 §14](../module-specs/Module-Spec-001-IdentityPolicy.md#14-taskexecution-创建授权190-approved)。本节场景已于 2026-09-14 随 P-190-1 方案 A 获批，运行结果保持 `NOT RUN`。四版本端到端矩阵由 [Module Test 003](Module-Test-003-TaskExecution.md#创建-purpose-兼容性190-approved)拥有；本表聚焦 owning 授权组成层。使用真实合法 Actor/Policy/grant/Decision 独立基线，负例每次仅改变一个维度，拒绝 Audit 与 Decision 同事务，禁止以不存在对象等无关错误代替预期拒绝。

| ID | 层级 | 输入/单一变化 | 预期输出 | 当前实际 / 结果 |
|---|---|---|---|---|
| IP-P190-001 | Authorization | 四个精确 `(type, version, purpose)` 配对应当前 Capability/动作/资源映射；逐项替换为未知版本、另一 Purpose、通配、别名或缺失映射 | 合法请求各获自身 ALLOW；错误映射 DENY，不能由 caller requestedCapability 或任意同 Scope grant 放行 | 精确映射与纯解析已实现（#196）；当前 Capability 组成层未实现 / `NOT RUN` |
| IP-P190-002 | Security | Project A Intent 分别只持 Enterprise Grant、Project B Grant；另测资源 selector 不覆盖 target | 全部 DENY；业务 Scope 包含关系不替代授权事实精确 Scope 与目标约束 | TE 组成层未实现 / `NOT RUN` |
| IP-P190-003 | Persistence | 先签发 ALLOW，再撤销唯一 covering grant；Decision 未过期；分别提交新请求及原 key 重试 | 当前资格拒绝；旧 Decision/Receipt 不改写；不因通用精确校验通过而放行 | TE 组成层未实现 / `NOT RUN` |
| IP-P190-004 | Security | 四版本各使用他人 Decision、不同认证上下文、错 id/hash、错 payloadHash、DENY Decision | 全部拒绝；映射正确不替代精确身份/内容绑定与 ALLOW 判定 | TE 组成层未实现 / `NOT RUN` |
| IP-P190-005 | Compatibility | 原有创建能力仅覆盖旧版本；另设明确覆盖 WorkOrder 两版本的能力 | 原版本可重新授权；不自动扩大 Task v2；WorkOrder 分别签发版本绑定 Decision，历史授权不迁移 | TE 映射未实现 / `NOT RUN` |
| IP-P190-006 | Security | AGENT/SERVICE 通过 actingFor 或转交 Human Decision 请求 Human-only 能力 | 固定拒绝，不改变真实 PrincipalKind，不签发 Human-only grant | TE 组成层未实现 / `NOT RUN` |

## IM06-AUTH-01 创建授权组成回归提案

状态：`APPROVED 2026-09-15 / PORT-LEVEL CASES EXECUTED ON REAL POSTGRESQL 2026-09-15（#200）/ TASKEXECUTION CONSUMPTION NOT RUN`。本矩阵对应 [Spec 001 §15](../module-specs/Module-Spec-001-IdentityPolicy.md#15-im06-auth-01-taskworkorder-创建授权组成提案)，定义已批准 IdentityPolicy 前置切片的可观测验收边界；`IP-TAUTH-001`–`008` 已随 #200 在 persistence gate 内执行，TaskExecution 消费与业务链未运行。

| ID | 层级 | 输入/单一变量 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| IP-TAUTH-001 | Authorization | 四个精确 operation/version 分别使用受信 capability 配置、已批准 Purpose、对应 action 与版本 target type；反例替换版本/Purpose/配置键 | 四组合法请求可分别签发 ALLOW；错配、别名、前缀、通配和缺配置 fail closed，WorkOrder 共用 Purpose 不合并版本 | `PASS`（#200） |
| IP-TAUTH-002 | Authorization/Persistence | 同 capabilityCode 的 Grant 分别只含 v1 action、只含新版 action、或同时含两个 action | 只覆盖显式列出的版本；不从 capabilityCode 或 Purpose 推导另一版本 | `PASS`（#200） |
| IP-TAUTH-003 | Security | selector 精确匹配；反例为旧/新 objectType 串用、错 target type、未知字段、通配/前缀/别名、非空 constraints 或 maxUses | 只有闭集 CREATE_TARGET_TYPE selector 覆盖当前版本；未实现约束不被默认忽略 | `PASS`（#200） |
| IP-TAUTH-004 | Security/Persistence | 已签发 Decision 后只替换 target objectId、objectType 或 Project Scope；对照原 target 重验 | 替换全部拒绝；新 Decision canonical payload/hash 与 promoted target 镜像一致，原 target 通过 | `PASS`（#200） |
| IP-TAUTH-005 | Authorization | Grant 的 Policy Snapshot id/hash 与 Decision 不同，或 Policy 未生效/已取代/完整性失败 | 拒绝 ALLOW；不拼接另一 Grant 的 Policy 或使用默认 Policy | `PASS`（#200） |
| IP-TAUTH-006 | Authorization/Replay | ALLOW 后撤销唯一 covering Grant、Grant 到期、受信配置变更或 IdentityPolicy 不可用；分别尝试新请求与原幂等键重放 | 提交/历史 Receipt 读取前重验并拒绝；历史 Decision/Receipt 不改写，不产生新成功事实 | `PASS`（#200） |
| IP-TAUTH-007 | Security | AGENT/SERVICE 持受信配置的合法非 Human-only Grant；反例为普通 Agent 无该 Grant、使用 actingFor/Human Decision，或获授 Human-only capability | 真实 PrincipalKind 不改变；只有完整 covering Grant 可用，无 Grant/提权均拒绝 | `PASS`（#200） |
| IP-TAUTH-008 | Compatibility/Migration | 历史 AuthorizationDecision target 镜像为 NULL；新 Port Decision 非空；空库与已有历史行升级后二次 migrate | 历史 Decision 保持精确读回但不可用于四个创建版本；新行 target 镜像/Hash 强一致；迁移幂等 | `PASS`（#200） |

### #200 执行结果（2026-09-15）

- 实现：Port 在 `modules/identity-policy/src/commands/task-execution-creation-authorization.ts`，迁移为 `V1006__identity_policy_creation_decision_target.sql`；纯函数回归在 `modules/identity-policy/src/commands/task-execution-creation-authorization.test.ts`，真实 PostgreSQL 回归在 `tests/persistence/identity-policy-creation-authorization.test.ts`。
- `PASS` 的来源是 persistence gate 内的真实 PostgreSQL 执行，其中 `IP-TAUTH-008` 在独立 pinned 容器内完成 `V1005 → 历史 Decision 行 → V1006` 升级、历史行精确读回与新行镜像断言。完整 `vibe verify full --json` 结果与 revision 记录在 Issue/PR。
- 拒绝路径不写 AuthorizationDecision：本 Port 的 Decision 必须绑定其 covering Grant 的精确 Policy Snapshot，无 covering Grant 时不存在可写入的 Snapshot；因此拒绝只产生同事务的脱敏 `DENIED` Audit（设计未要求 DENY Decision 行）。
- 审查修复（PR #201 R1–R3，`2026-09-15`）：签发与重验绑定受信事务 context 的 ActorSnapshot + principal；读取端新增 Decision 与 Policy Snapshot 的 canonical/hash/algorithm/version/size 与提升列镜像完整性校验。新增回归：同 Project 另一 Human / Agent / actingFor 快照在同一 context 中拒绝且跨 context 重验返回 `ACTOR_MISMATCH`；target 列与 payload `targetRef` 配对改写并保留旧 hash 返回 `DECISION_INTEGRITY_MISMATCH`；Policy Snapshot 文档改写保留旧 hash 时签发 `DENY`/`GRANT_POLICY_SNAPSHOT_INVALID`、重验 `POLICY_INTEGRITY_MISMATCH`。
- 审查修复（PR #201 第 2 轮 R4，`2026-09-15`）：Decision 读取端镜像闭集补齐 Decision id、reason codes 与 `targetRef.kind: OBJECT`。新增回归：owner 重写单一 canonical 维度并同步重算 payload hash/size/algorithm 的自洽行（Decision id 与行主键分叉、reason codes 与列分叉、targetRef.kind 非 OBJECT）在重验时均返回 `DECISION_INTEGRITY_MISMATCH`，未修改 Decision 的正向对照保持有效；仓库级 focused 单测（`pure-guards.test.ts`）覆盖同一维度集合，并经变异验证（移除对应比较时用例失败）。
- 未运行边界：TaskExecution DRAFT Handler 的 Port 消费、业务表/Receipt/Outbox 链、真实 Provider/Runtime 与人工业务验收仍 `NOT RUN`，本表不将其计为已验收。

独立设计审查须重点检查：内部 Port 是否保留公开 `authorize_command@1.0` 兼容边界；action/selector 是否真正区分 WorkOrder 同 Purpose 的两个版本；target 是否进入 Decision Hash；Grant/Policy 是否在每次高风险消费前完整重验；历史无 target Decision 是否只保留读回而不获得新资格。


## #219 Controls Policy 与执行分类设计场景（待审）

状态：`HUMAN DESIGN APPROVED 2026-09-22 / IMPLEMENTED 2026-09-22 / INDEPENDENT REVIEW PENDING`。依据 Spec 001 §15.11 和 Spec 003 §21.5–§21.9；既有创建授权及 §15.10 七条独立映射仍须回归。

| ID | 输入 / 边界 | 预期 | 实际 |
|---|---|---|---|
| IP-WOV-S-001 | 通过真实 record_policy_version 登记 Controls profile，再由 Validation/Freeze 各自授权 resolve；缺 Grant、错 profile/ref、取代、跨 Project | 精确 PolicyVersion SnapshotRef/hash/生命周期由 owning 读取；缺权限时 Policy repository 0 次；无伪造 fallback 或跨动作缓存 | NOT RUN |
| IP-WOV-S-002 | SERVICE 的 validate/freeze 分类调用；Human 创建 Draft 含 Human-only capability；改成 Human principal/actingFor 或 unsupported operation | 非 Human-only 正例 VALID；Human-only 声明 INVALID 且归因 owning 分类版本；身份伪造拒绝，不修改 creation 方法的 HUMAN 允许集 | NOT RUN |
| IP-WOV-S-003 | 同 Service 分别持有七条 Grant；移除一个 dependency Grant；完整 Context Ref 的独立 objectId/snapshotId 及单字段置换 | 每项独立重验，不能借相同 principal/Purpose/旧 Receipt；合法独立身份通过，任何 Ref 置换拒绝 | NOT RUN |
| IP-WOV-S-004 | 初次授权后在锁等待或历史结果返回前撤销 Grant/取代授权 Policy | 提交/返回前当前重验拒绝；无业务成功事实，不返回历史结果恢复资格 | NOT RUN |

#219 实现分层：七条授权映射由 `work-order-validation-authorization.test.ts` 覆盖当前 Decision、Grant、Policy、ref/hash/Scope 与零 repository 读取拒绝；执行能力分类由 `task-execution-capability-boundary.test.ts` 覆盖 Service、Human-only 和未知消费操作。Controls 的真实登记/解析、同一 Service 独立动作和冻结后撤销 Draft 读取 Grant 由 TE-VAL-S-008 覆盖。IP-WOV-S 表中未逐项执行的 owning Policy 取代、另一 Service audience 与提交瞬间撤权组合仍 NOT RUN，不能由授权单测升级为持久化通过。

### IM06-RUN-START 授权与 Bundle 设计矩阵（提案）

| ID | 层级与输入 | 预期 | 当前结果 |
|---|---|---|---|
| IP-RUN-D-001 | 真实同 Project covering Grant/Policy 与 canonical frozen Contract，Dispatcher SERVICE 为预分配 Run 签发非 Human-only 能力 Bundle | 不可变 CONTENT_ADDRESSED Ref、完整 Grant/Policy/Decision/Scope/Run/Contract 观察、有限 validUntil；Receipt/Audit/Bundle 原子提交 | NOT RUN |
| IP-RUN-D-002 | 部分未授权能力、deny 冲突、Human-only、空集合、错主体/Scope/Run、actingFor、伪造 Grant/Hash | 签发拒绝且无 Bundle；WorkOrder 的声明与单个 Grant 均不构成执行权 | NOT RUN |
| IP-RUN-D-003 | 已签发 Bundle 后撤销 Grant、Policy 取代、Decision/能力期限到达，再分别 create_run、IG dispatch、start | 各消费独立当前重验拒绝；历史 Bundle 仍可审计；无 protected read/Claim/业务成功事实 | NOT RUN |
| IP-RUN-D-004 | Queue/Run/IG/Start/两个 Binding Query/reconcile 的独立映射：逐一移除 Grant、置换完整 target/ref/hash、配置漂移 | 每条只能授权对应 operation/version/Purpose/target/Scope；缺权限时目标 repository 读数为 0；不借相同 SERVICE principal 或 Freeze Decision | NOT RUN |
| IP-RUN-D-005 | app-role 直 SQL、无事务 Context、异 Project、Bundle payload/hash/source Receipt 篡改与签发事务回滚 | FORCE RLS/ACL/guard 拒绝；无残留成功 Bundle；原有 PolicyVersion/Grant/Decision 行不改写 | NOT RUN |

这些是设计预期；实现后按 Unit、Contract、真实 PostgreSQL 和外部/人工层级分别填写实际结果，不以本提案记录 PASS。

### IM06-FINAL 独立授权设计矩阵

状态：`DESIGN APPROVED 2026-09-23 / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-23 / HUMAN DESIGN APPROVED 2026-09-23 / PR #226 MERGED / ADDITIONAL LOCAL FULL PASS 2026-09-26 / APPLICABLE EXECUTABLE CASES PASS / RESIDUAL PREREQUISITES PARTIAL / CLOSURE SCOPE APPROVED 2026-09-26`；依据 Spec 001 §15.13。下表保留完整设计预期；`PARTIAL` 只表示所列子场景已执行，其余仍 `NOT RUN`。#222 的 Bundle/start 授权执行证据不覆盖 Result/terminal 新消费动作。

关闭适用性按[决定 §22.8](../decisions/task-execution-human-operated.md#228-issue-224-关闭验收边界确认2026-09-26)执行：真实 PolicySnapshot 取代保留 `NOT RUN`，随 owning 写入能力后续验收；首 Run 的 lease/deadline 同界；独立 Usage/Completion 与外部/人工维持非目标。该人类批准不把 `PARTIAL` 改成完整 `PASS`，当前可达路径仍须通过独立审查。

| ID | 层级与输入 | 必须观测的结果 | 实际 |
|---|---|---|---|
| IP-FINAL-D-001 | 同 Project SERVICE 分别取得 Run start→IG Adapter 身份 Port、TE final 候选扫描、IG final observe/read、submit、record、validate、accept、finalize、expire 与两个旧 Query 的独立 Grant；逐一去掉任一项或用另一操作的 Decision | 公开项绑定精确 operation/version/Purpose/action/target/ActorSnapshot/Scope，内部动作绑定自身 action/target/ActorSnapshot/Scope 且不伪称公开 Purpose；相同主体或旧 Receipt 不共享权；缺授权时相应 protected repository 调用 0 次 | PASS（UNIT + OWNING/PG）：独立成功链及 start、五个 final Command、expire、scan/progress、历史 Query 的授权撤销拒绝；五个 final Command 的十项完整 Envelope/session 置换在 TE/IG protected SELECT 前拒绝且无 Receipt；另一真实 SERVICE 和真实 HUMAN actingFor Snapshot 不能借用原 Decision。42 个授权边界的完整 target/hash/version/Scope、配置漂移和 HUMAN/AGENT audience 单测共 84 项通过。依赖 Grant 拒绝与零读取另见 D-002。 |
| IP-FINAL-D-002 | Run start 读原 IG 身份、Process 仅按 Project Scope 扫描 TE 自有 RUNNING/ACTIVE 无 reservation 候选，再按 Run 已存 Attempt Ref 读 IG final；每个 TE Result 步骤的 IG binding/final、IP Bundle/Controls Policy 与 TE 上游事实依赖读取；替换完整身份/Attempt Ref、Content Hash、Run/Project 或用 start 阶段 Bundle Decision | start 的原 Binding Query 与实例身份 Port 均独立当前授权，扫描权限不能当 final Query 权限；消费专用 Decision 与当前 owning 事实均须成立；自身命令 ALLOW 不覆盖依赖读；任一失败不读目标 repository，不提交 Result/判断/Acceptance/terminal | PASS（分层）：start 的原 Attempt 读和实例身份读独立撤销均在对应 IG 表 SELECT 前拒绝；五个 final Command 的 24 个独立依赖 Grant 撤销场景中，自身 Decision 仍有效、目标 repository SELECT 为零、无 Receipt。完整 Ref 的 ID/Hash/version/Scope 与跨操作 Decision 拒绝另由 UNIT 和真实 owning Envelope 负例证明；scan、progress 与 IG final 不互授权限。 |
| IP-FINAL-D-003 | 签发后撤销 Grant、取代 Policy、到期 Decision/Bundle/lease；分别在首次读前、持 Run 锁等待后、历史 Receipt/Query 返回前发生 | 各消费点当前重验拒绝；旧 Result/Bundle 可审计但不能恢复资格；旧公开 Purpose/Schema 与 V1006 target 镜像不变 | PARTIAL：五个 final 阶段分别执行真实执行 Grant 撤销和 owning Controls Policy 后继取代；submit 持锁时 own Grant 撤销、Controls Policy 取代及真实 deadline 跨期，accept 持锁时原执行 Grant 撤销均拒绝，原事实不变并可独立 expiry。历史 Receipt/Query 撤权重放在 protected SELECT 前拒绝；九个历史消费在不改 Decision 行的受信时钟到期模拟下拒绝且 protected SELECT 为零。UNIT 已覆盖 PolicySnapshot 取代、Principal SUSPENDED 和精确 Decision 到期；真实 PolicySnapshot 取代仍 NOT RUN（没有 owning 写入者）。首 Run 的 lease 与 execution deadline 同界，独立 lease 跨期不是可由当前 owning 创建入口产生的状态。 |
| IP-FINAL-D-004 | 到期 Run 且原执行 Bundle 自然过期；LeaseMonitor 有/无独立 expiry 授权；伪造旧 Bundle hash/Run 绑定 | 有授权及完整历史绑定可 TIMED_OUT/EXPIRED 清理，无权限不得读取或释放；不要求过期 Bundle 重新获得执行能力，也不能让任何 SERVICE 通配清理 | PASS（OWNING/PG，墙钟自然到期）：等待原执行 Bundle 的真实 valid_until，PostgreSQL clock_timestamp 证明已过期；独立 expiry Grant 撤销时拒绝且 TE/IG protected SELECT 为零，另一真实 SERVICE 无 Grant 时 DENY；原 Bundle Hash/Run 绑定伪造在 owning inspect 入口拒绝，不释放 Claim。重授新 Decision 后 Run/Claim 原子 TIMED_OUT/EXPIRED，重放不增终态事实。 |
| IP-FINAL-D-005 | app-role 直 SQL、无受信 transaction context、跨 Project、另一 SERVICE/actingFor/PrincipalKind/target 替换 | RLS/ACL 与拥有者 guard 拒绝本 Schema 越权；授权来源不由 caller payload 或 SQL 自写 Decision 伪造；无残留成功业务事实 | PASS（分层）：final 表的 app-role RLS/ACL、无 Context、跨 Project、UPDATE/DELETE 与 owner 不可变负例；五个 final Command 的完整 Actor/session/Enterprise/Project/target 置换、另一真实 SERVICE、真实 HUMAN actingFor 借权均拒绝、protected SELECT 为零且无业务事实。HUMAN/AGENT audience、Principal SUSPENDED 与配置漂移另有 UNIT 证据，不声称完整身份生命周期已经交付。 |
| IP-FINAL-D-006 | 保持 `runFinalCandidateScanV1` 原候选集，另对同 Project `controlled-final@1` ProcessInstance/Step 使用 `runFinalProcessProgressV1`；分别撤销两项 Grant、替换 Project/Process/source Ref/Hash/step 或拿任一 Decision 读另一边界 | scan 无 reservation 后停止且不返回 Result；progress 只读写精确进度、不联查业务 Result/Bundle/Acceptance/CommandReceipt；目标 Command 在自身授权下按原键读取 Receipt；任何越权在 protected read/write 前拒绝，进度 CAS 与 Step 原子，目标 Receipt 不受失败进度事务改写 | PASS（OWNING/PG + UNIT）：scan 只返回 RUNNING/ACTIVE 无 reservation 候选；scan Grant 撤销时 protected SELECT 为零。独立 progress Grant 撤销时 list/create/advance 的 protected read/write 为零，无新 Process；source ID/Hash/Project、Process、step/version 与跨 Decision 使用拒绝。目标先提交而进度未记的五步恢复读回原 Receipt；进度 CAS/Step 原子，目标事务不被失败进度改写。两个真实 Process 在每 tick 至多一条 Command 下均完成。 |

## #229 有限恢复授权设计矩阵

状态：`DESIGN APPROVED / HUMAN DESIGN APPROVED 2026-09-27 / IMPLEMENTATION PRESENT (#231) / OWNING RECOVERY DIAGNOSTICS EXECUTED / EXACT REVISION FULL AND REVIEW EVIDENCE IN PR #232`；[Spec001 §15.14](../module-specs/Module-Spec-001-IdentityPolicy.md#1514-im06-recovery-有限恢复授权组成实现契约229)。复用现有IP-RUN/IP-FINAL基础，不扩大#224已执行/延后口径。

单 capability covering-Grant 路径可按调用方已明确要求的精确 code 在 SQL 层缩窄候选；后续主体、Scope、action、selector、Hash、Grant/Policy 当前有效性及拒绝优先级保持原规则。通用命令授权同样下推其精确 requestedCapability；Human 查询按全部受信 required binding 的 code 集合下推候选，每个 binding 的完整覆盖与逐 Grant Policy 校验不变，不缓存当前资格。省略筛选参数的默认全量查询不变，空 code 集合返回空集合。`identity-policy-roles.test.ts` 用真实 owning Grant 校验单 code、多 code（含重复 code）与默认查询的集合等价及空集合、同 code 的 Enterprise/Project 事实并存、错主体/Enterprise 及时间边界，避免候选缩窄扩大权限或遗漏合法 Scope。

| ID | 输入 / 必需证据层级 | 预期 / 结果 |
|---|---|---|
| IP-REC-D-001 | Unit/entry+PostgreSQL；合法同Human confirmation/responder/resolver/currentRole，对照Agent、actingFor、他人session、role缺失/撤销、旧Decision替代当前依赖Decision | OWNING/PG PASS：同 Human、实际 AGENT 与 HUMAN actingFor SERVICE、wrong responder/session、逐 consumer 当前依赖映射/缺 Grant 0 protected reads、Role 撤销；Service proof 读取不授予业务 resolver 资格。 |
| IP-REC-D-002 | Owning历史Decision/ActorSnapshot与EPReceipt；真实confirm旧Decision已到期，但当时有效；对照错confirm operation/payloadHash/target/Scope、历史不可查及当前Role/Grant撤销 | OWNING/PG PASS：真实 EP committedAt 与原 IP Decision/Actor，历史 Decision 已到期仍有效；错 target/hash/Actor/Decision/time 及实际 propose operation/purpose 拒绝；当前 Role/Grant 撤销仍禁止恢复；同 code 的不同 action/target 必须逐项完整覆盖，真实 Grant 正例与缺 action、错 TARGET_TYPE/objectType、owning revoke 后重新授予仅答复 action 的反例通过 owning Port 验证。 |
| IP-REC-D-003 | PostgreSQL/current Ports；Run-2Bundle新Context/原Contract/Resolution/Service target合法，对照旧Bundle、Context-1/错Resolution、Controls/Builder取代、锁后期限/撤权、重放 | OWNING/PG PASS（可达恢复子项）：新 Context/Bundle/有限上界与历史 bytes；Controls/Builder owning supersession、失效 Context/Request、实际 row lock 后撤权/受信时钟跨期，坏绑定无新 Bundle/Run。PARTIAL 仅保留真实 Grant PolicySnapshot lifecycle NOT RUN（无 owning writer，UNIT 不替代）。 |


## #233 Completion 授权设计用例

authority为Spec 001 §15.15，以下当前全部NOT RUN；#224实际Grant PolicySnapshot lifecycle延后继续保留。

| ID | 层级 / 输入 | 预期 | 实际 / 结果 |
|---|---|---|---|---|
| IP-COMP-D-001 | Contract + Application + PostgreSQL / Human或固定TE SERVICE自身及每项dependency Decision | operation/version/purpose/action/target/payloadHash/Scope完整匹配；Human-onlyArtifact/Driver入口不可代理 | 未执行 / NOT RUN |
| IP-COMP-D-002 | Application + PostgreSQL / AGENT/RUNTIME/未知SERVICE、actingFor、借producer Decision、错purpose/hash/Scope、历史receipt | protected读前拒绝为0，current授权不可用时masked拒绝；旧事实存在不授予新Completion/read权 | 未执行 / NOT RUN |
| IP-COMP-D-003 | Application + PostgreSQL / Grant真实撤销、PolicyVersion真实后继、Decision到期及持锁后撤权 | 提交/原Receipt返回前拒绝，无半事实；terminal历史Bundle inspect不要求ACTIVE/过期执行权重新签发 | 未执行 / NOT RUN |
