# Module-Test-001-IdentityPolicy

版本：v0.3
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / WI-07 REVIEW REPAIR VERIFIED 2026-08-24 / WI-08 REGRESSION VERIFIED 2026-08-24 / WI-09 SCOPE+DENY-AUDIT REGRESSION VERIFIED 2026-08-24 / WI-10 TYPED-ORDER+SCOPE REGRESSION VERIFIED 2026-08-24 / PR #51+#52+#53+#54+#55 MERGED / FINAL MAIN VERIFY PASS / IM-02 COMPLETE / ISSUE #28 CLOSED / #176 POLICY VERSION RESOLUTION SCENARIOS APPROVED 2026-09-12 DESIGN VERIFIED / #179 STATIC PROFILE REGISTRY + PURE VALIDATION IMPLEMENTED / #181 PAYLOADGUARD SCENARIOS PROPOSED PENDING APPROVAL / POLICY VERSION HANDLER, AUTHORIZATION, LIFECYCLE AND EXTERNAL NOT RUN`

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

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED`。行为来源为 [Spec 001 §13](../module-specs/Module-Spec-001-IdentityPolicy.md#13-176-policy-版本身份与解析-port-设计) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)。下表定义批准并实现后的可执行验收输入与预期；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 只交付静态 registry/Schema 与纯校验，故仅 `IP-176-D-007` 的注册性与纯校验部分取得 `PASS`，其余各行与 D-007 的写入/授权/生命周期部分保持 `NOT RUN`，不得因设计评审或现有 full 通过改为 PASS。

| ID | 层级 | 输入 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| IP-176-D-001 | Design/Contract | `identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0` 的名称、版本、Owner、Purpose、Ref 声明、Envelope 元数据与 `zhiju.identity.policy_version` objectType 注册 | 两个操作按共享 API §9.2 完整注册；Purpose `identity.policy.record_policy_version` 与 `identity.policy.resolve_policy` 在两个 registry 中一致；Catalog 净增 2 项、历史 baseline 与旧 `record_policy_snapshot@1.0` 均不重写 | `NOT RUN` |
| IP-176-D-002 | Contract/Persistence | 同一版本键 `(objectType, objectId, versionId, enterpriseId, projectId)` 提交两次不同 `policyDocument`，分别覆盖 Project 行与 `project_id IS NULL` 的 Enterprise 行（`NULLS NOT DISTINCT` 生效）；另附相同幂等键/相同 payload 的重放 | 第二次绑定稳定返回 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`（不穿透 `23505`），首个版本事实/Hash/绑定不变；Enterprise 行的重复绑定同样被唯一约束裁决；相同键同 payload 走既有 `DUPLICATE` 重放 | `NOT RUN` |
| IP-176-D-003 | Contract/Persistence | `supersedesRef` 分别指向不存在、跨 Scope、`effectiveFrom` 不更早或自身的版本（正向为同 identity/Scope 的早期版本）；另用顺序提交与双连接并发让 B、C 都取代同一前驱 A（分别覆盖 Project 行与 Enterprise 行 `project_id IS NULL` 的唯一约束），并覆盖后继 `effectiveFrom` 在未来、以及 `now` 恰等于/晚于 A 的派生 `supersededAt` 时继续消费 A 的变体 | 非法输入 `IDENTITY_POLICY_SUPERSEDE_INVALID` 且不产生取代边；仅第一个后继建立唯一取代边，另一个稳定 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`；A 的 `supersededAt` 唯一等于胜出后继的 `effectiveFrom`（未来生效则在此之前仍为 `USABLE`），不被改写或延长，原不可变行不被 UPDATE，不形成分叉；到达截止点后新消费按 `POLICY_EXPIRED` 拒绝 | `NOT RUN` |
| IP-176-D-004 | Query/Security | `resolve_policy` 输入未知 identity、未知 version、未绑定版本、Scope 不在调用者授权集合；对照合法精确 ref | 前三者统一返回 `IDENTITY_POLICY_VERSION_UNKNOWN`，不泄露跨 Scope 存在性；合法输入返回 exact `policyVersionRef`+`contentHash`+`policyDocument`，不解析 latest、不回退同 objectId 其他版本 | `NOT RUN` |
| IP-176-D-005 | Query/Contract | Builder 在候选组装、Validator 与 Freeze 各自消费前重新解析：对照 caller 自报 Hash/有效期、复用上一次解析结果、Policy 在两次消费之间被取代、存储暂时不可用 | 自报/复用/不一致分别按 #166 与 #168 的既有错误 fail closed；被取代后新消费拒绝而历史保留；依赖不可用返回 `DEPENDENCY_UNAVAILABLE`，不得当作无限制继续 | `NOT RUN` |
| IP-176-D-006 | Persistence/Security | 版本事实表的隔离矩阵：同 Enterprise（或同 Project）合法读取、另一 Enterprise Context、同 Enterprise 的另一 Project、旧 Platform `policy_snapshot` 兼容读回；外加直接 SQL 写入 scoped 行、修改不可变行、无 Context 查询 | 新表 FORCE RLS 按 `context_allows_enterprise`/`context_allows_project` 分支放行或拒绝（跨行零行/`42501`）；授权 Query 对越界 Scope 统一不可用；旧 Platform 行与其 `context_is_valid()` RLS、`get_policy_snapshot@1.0` 读回语义不变；`REVOKE UPDATE/DELETE` 与镜像校验拒绝写入，不靠隐藏 Ref 代替授权 | `NOT RUN` |
| IP-176-D-007 | Contract/Registry | 写入端提交 `policySchemaRefs` 为四个 profile 的 canonical typed ref（以及未注册 key、旧 `im02-static-v1` 条目、非 canonical 形状）；随后消费端校验必需 profile key | 四个 registry key 与 typed ref 的映射固定且可加载；未注册/非 canonical 条目在写入前 `IDENTITY_POLICY_VERSION_UNKNOWN`；旧命令 `record_policy_snapshot@1.0` 的接受集合不变；消费端能据 `policySchemaRefs` 判定所需 key 存在并校验 closed 字段 | 注册与纯校验部分 `PASS`（#179，仅静态 registry/Schema/纯校验）：`contracts/src/policy-profiles.test.ts` 证明七个条目映射固定且可加载、重复 key/重复身份/缺失映射被确定性拒绝、非 canonical 形状与未知版本解析为 `undefined`；`modules/identity-policy/src/commands/static-registry.test.ts` 证明 `im02-static-v1` 接受集合与 typed ref 不变、四个 profile 只在 `im06-static-v1` 下注册、旧条目不能代替 profile；EP/TE 侧必需 key 与 closed 字段由各自模块测试覆盖。对外 `IDENTITY_POLICY_VERSION_UNKNOWN` 映射、`record_policy_version@1.0` 写入与消费端 Handler 仍 `NOT RUN` |
| IP-176-D-008 | Persistence/Contract | 正向对照：同一 Scope 下两个不同 Policy 各自创建首版；同一 identity 先后创建两个**未互相取代**的版本。反向：同一真实前驱的顺序与并发第二个后继。Enterprise 与 Project Scope 各覆盖一次 | 三个正向输入全部成功——无前驱版本的后继索引谓词为假，不参与后继唯一性，不得因 `(NULL, NULL, E, [P])` 折叠被判为重复后继；同一真实前驱的第二个后继仍稳定 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`；`NULLS NOT DISTINCT` 保证 Enterprise 行的 NULL `project_id` 仍能裁决重复后继 | `NOT RUN` |

独立设计审查须覆盖版本键语义、取代基数与并发裁决（含无前驱版本共存）、企业级隔离归属（新 scoped 表与旧 Platform 表的分支）、profile registry 注册路径、统一不可用与内部审计边界；本节设计批准不改变 `identity.*` 既有 20 项公开 Contract 的接受集合与历史验收记录。

## #181 PolicyVersion API PayloadGuard 验证矩阵（提案，待批准）

状态：`TECHNICAL PARAMETER PROPOSAL / PENDING INDEPENDENT DESIGN REVIEW AND HUMAN APPROVAL`。行为来源为 [Spec 001 §13.3.1/§13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1331-payloadguard-技术-policy参数与适用边界181-提案)。两个操作与其技术 Policy 尚未注册，因此下列各行**全部为** `NOT RUN`；本设计只固定输入、预期与禁止效果，不把设计评审或现有 full PASS 当作已执行证据。参数获批准后，随两个操作注册与实现一同执行。

| ID | 层级 | 输入 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| IP-181-D-001 | Design | 对账两个操作的完整请求 Envelope、`CommandResult.data` 与 `QueryResult.data`，以及 §13.3.1 的共享技术 Policy 与 `payloadGuardPolicyRef` 映射 | Envelope 字段与 §5.3 固定顺序一致；`record_policy_version` 结果 Schema 只返回 `{policyVersionRef}`；`resolve_policy` 结果含内联 `policyDocument`；两个操作引用同一 `identity.policy_version@1.0`；`maxRequestedKinds` 显式标注为非适用维度而非缺省无限额 | `NOT RUN` |
| IP-181-C-001 | Contract | `record_policy_version` 的合法请求 Envelope，其紧凑 JSON 字节数恰等于 262144；同一 Envelope 改为 262145 | 等于上限通过 Guard 并继续结构校验；超过 1 字节即拒绝，`keyword=payloadGuard`、`rule=maxEnvelopeBytes`、`limit=262144`、`instancePath=''`，错误不回显原文 | `NOT RUN` |
| IP-181-C-002 | Contract | **读回不变量（结果预算 = 请求预算 + 4096 余量）**：逐项计量结果专有字段（`scopeRef`/`policyVersionRef`/`contentHash`/`useStatus`/`checkedAt`/`supersededAt`）在其合法最大编码下的合计 `R_only`；并以该合计为参数构造"写入恰好 262144 通过"的版本，读回其结果；另附结果恰等于 266240 与 266241 两个独立反例；同时对同一输入在等值预算（262144）下跑一次作为反例对照 | `R_only ≈ 820 < 4096`，且 `R_only` 的每个成员都是有界形状；由此任意合法写入的读取帧 ≤ `262144 + R_only < 266240`，与请求侧字段编码无关。结果恰等于 266240 通过、266241 以 `maxResultBytes` 拒绝；等值预算下同一个 Project 版本读回 262153 被拒绝，证明余量不可省略。不得用请求侧样本或最小值参与该论证，也不得用 `≥` 代替"请求预算 + 余量"的定式 | `NOT RUN` |
| IP-181-C-010 | Contract | **时刻精度边界（SD-181-1）**：构造"大正文前驱 + 小正文后继"——前驱正文按最小请求包装写满（请求 262144 通过），后继正文极小但其 `effectiveFrom` 为 `2026-09-13T00:00:00.` + 1000 个 `0` + `Z`（1021 code point，共享 `utcInstant` 校验为 true）；随后读回前驱（`supersededAt` 等于该后继 `effectiveFrom`，`useStatus=NOT_YET_EFFECTIVE`）；正向对照改用毫秒精度的后继（`2026-09-13T00:00:00.000Z`，24 code point）重跑同一链路 | 后继的长精度 `effectiveFrom` 在写入边界被拒绝（超 24 code point 的时刻），不截断、不静默降精度，因此不可能进入任何前驱的 `supersededAt`；正向链路的读回结果在 266240 内通过并保留余量。不得把该约束当作可选：放宽后结果侧两个时刻各可达 16384，`R_only` 变为约 33540、远超 4096 余量（另有 262441 字节的实测反例被拒绝）；无小数（20 code point）与毫秒精度（24 code point）的 `effectiveFrom` 均通过，共享 `UtcInstant` 的既有操作接受集合与 `compareUtcInstants` 的变长小数比较不受影响 | `NOT RUN` |
| IP-181-C-003 | Contract | `policyDocument` 内含多字节 Unicode、需要转义的字符（引号、反斜杠、控制字符）与同样 code point 数的纯 ASCII 对照；外加单串 16384/16385 code point 的单变量对照 | 计量按紧凑 JSON 的 UTF-8 字节而非 UTF-16 长度或 code point 数；Unicode/转义样本先于同长度 ASCII 触顶；字符串按 code point 计数，`maxStringCodePoints` 与 JSON Schema `maxLength` 口径一致；**16384 通过、16385 在 `/payload/policyDocument/text` 以 `maxStringCodePoints` 拒绝，且该拒绝发生在总字节数（16427）远低于 262144 时**——该维度独立于字节预算，不得用字节预算推导其边界 | `NOT RUN` |
| IP-181-C-004 | Contract | 数组 1024/1025 项、对象 256/257 个成员、容器深度 32/33，以及 `policySchemaRefs` 的 `NonEmptySet` 正例与重复项反例 | 各维度等于上限通过、超过 1 拒绝；Guard 不改写数组顺序或重复语义；集合契约仍由结构 Schema 的 `uniqueItems`/`minItems` 裁决并拒绝重复项，不由资源限制放宽 | `NOT RUN` |
| IP-181-C-005 | Contract | 循环引用、`undefined`、非有限数字、`bigint`、函数、带 accessor 或非 JSON 原型的对象 | 一律以 `rule=jsonValue` 拒绝，不进入结构递归；不使用 `JSON.stringify` 的忽略/转换行为接受非法输入，也不先对任意深度对象完整递归序列化 | `NOT RUN` |
| IP-181-C-009 | Contract | 计量方法与 inclusive 边界的单变量核对：`{}`（2 字节）、`{"payload":{"policyDocument":{"text":"a"×40}}}`（82 字节）、`{policyVersionRef}` 结果（446 字节）、`resolve_policy` 请求 Envelope（1373 字节）、单串 16384 场景（16426 字节） | 每个样本的最小通过上限 `B` 等于其紧凑 JSON UTF-8 字节数（`Buffer.byteLength(JSON.stringify(sample),'utf8')`）；`B` 通过、`B − 1` 以对应字节规则拒绝，且其他维度未触发。不得把 `B − 1` 记作字节总数，也不得用"唯一序列化器"代替实测 | `NOT RUN` |
| IP-181-C-006 | Contract | 两个操作分别指向未注册技术 Policy（错误 `type`/`version`）与未知操作身份；以及在未注册 `payloadGuard` keyword 的校验器上编译这两个 Schema | 未注册操作返回 `operationRegistry` 拒绝；未知 Policy 引用与未加载 Guard 的校验器拒绝编译/校验，不得降级为无限制或忽略该 keyword 后宣告有效 | `NOT RUN` |
| IP-181-C-007 | Contract | 两个操作分别在输入超限、结果超限，以及输入合法但结果独立超限三种组合下校验 | 超限方各自拒绝且互不掩盖；输入超限在任何业务写入或授权查询前短路；结果超限不返回部分成功事实、不截断 `policyDocument`、不产生成功 Receipt/Outbox | `NOT RUN` |
| IP-181-C-008 | Contract | 四个已注册 profile 的合法 `policyDocument` 样本（§13.3.2 表），配合各自的 canonical typed ref | 四个样本均通过 Guard 且通过结构 Schema；Guard 不改变 profile 的 closed 规则字段、不施加或放宽 TTL 与 `validUntil` 语义，也不把 `policyDocument` 的对象形状要求变成资源限制 | `NOT RUN` |
| IP-181-E-001 | E2E | 按本参数合法写入的最大合法版本，经 `resolve_policy@1.0` 读回后逐字段比对 | 读回的 `policyDocument`/`contentHash`/生命周期观察与写入时同一 canonical payload 一致；不得因包装开销返回不可用、截断或部分结果 | `NOT RUN` |

独立设计审查须覆盖：计量口径（紧凑 JSON UTF-8 字节、code point 与字节的区分、inclusive 边界）、写入/读回预算关系与结果侧**每个变长字段的上界**（含 SD-181-1 的时刻精度约束与 canonical `objectType` 的 `const` 编码）、共享而非分别注册的理由、`maxRequestedKinds` 的非适用性声明、执行位置与固定顺序、错误不泄漏与"禁止部分成功"约束，以及是否改变了既有 Profile/Slice/Platform 接受集合与共享 `UtcInstant` 的既有操作接受集合。本节提案不改变 `identity.*` 既有 20 项公开 Contract、`ep.context_source_slice@1.0` 参数与旧命令的接受集合；SD-181-1 只作用于这两个未注册操作，不改变共享标量定义。
