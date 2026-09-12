# Module-Test-001-IdentityPolicy

版本：v0.3
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / WI-07 REVIEW REPAIR VERIFIED 2026-08-24 / WI-08 REGRESSION VERIFIED 2026-08-24 / WI-09 SCOPE+DENY-AUDIT REGRESSION VERIFIED 2026-08-24 / WI-10 TYPED-ORDER+SCOPE REGRESSION VERIFIED 2026-08-24 / PR #51+#52+#53+#54+#55 MERGED / FINAL MAIN VERIFY PASS / IM-02 COMPLETE / ISSUE #28 CLOSED / EXTERNAL NOT RUN`

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

状态：`PROPOSED 2026-09-12 / REVIEW PENDING / NOT IMPLEMENTED`。行为来源为 [Spec 001 §13](../module-specs/Module-Spec-001-IdentityPolicy.md#13-176-policy-版本身份与解析-port-设计) 与[设计决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖)。下表定义批准并实现后的可执行验收输入与预期；当前全部 `NOT RUN`，不得因设计评审或现有 full 通过改为 PASS。

| ID | 层级 | 输入 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|---|
| IP-176-D-001 | Design/Contract | `identity.record_policy_snapshot@2.0` 与 `identity.resolve_policy@1.0` 的名称、版本、Owner、Purpose、Ref 声明与 Envelope 元数据 | 两个操作按共享 API §9.2 完整注册；Purpose `identity.policy.resolve_policy` 与 `identity.policy.record_policy_snapshot` 在两个 registry 中一致；Catalog 净增 2 项且历史 baseline 不重写 | `NOT RUN` |
| IP-176-D-002 | Contract/Persistence | 同一版本键 `(objectType, objectId, versionId, enterpriseId, projectId)` 提交两次不同 `policyDocument`；另附相同幂等键/相同 payload 的重放 | 第二次绑定稳定返回 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`（不穿透 `23505`），首个 Snapshot/Hash/绑定不变；相同键同 payload 走既有 `DUPLICATE` 重放 | `NOT RUN` |
| IP-176-D-003 | Contract/Persistence | `supersedesRef` 分别指向不存在、跨 Scope、`effectiveFrom` 不更早或自身的版本；正向为同 identity/Scope 的早期版本 | 非法输入 `IDENTITY_POLICY_SNAPSHOT_INVALID` 且不产生取代关系；正向提交后被取代版本返回 `supersededAt = 新版本 effectiveFrom` 与 `useStatus=SUPERSEDED`，原不可变行不被 UPDATE | `NOT RUN` |
| IP-176-D-004 | Query/Security | `resolve_policy` 输入未知 identity、未知 version、未绑定 Snapshot、Scope 不在调用者授权集合；对照合法精确 ref | 前三者统一返回 `IDENTITY_POLICY_VERSION_UNKNOWN`，不泄露跨 Scope 存在性；合法输入返回 exact `policySnapshotRef`+`contentHash`，且不返回 `policyDocument`、不解析 latest | `NOT RUN` |
| IP-176-D-005 | Query/Contract | Builder 在候选组装、Validator 与 Freeze 各自消费前重新解析：对照 caller 自报 Hash/有效期、复用上一次解析结果、Policy 在两次消费之间被取代、存储暂时不可用 | 自报/复用/不一致分别按 #166 与 #168 的既有错误 fail closed；被取代后新消费拒绝而历史保留；依赖不可用返回 `DEPENDENCY_UNAVAILABLE`，不得当作无限制继续 | `NOT RUN` |
| IP-176-D-006 | Persistence/Security | 直接 SQL 写入版本绑定、修改不可变 Snapshot 行、无 Context 查询、跨 Enterprise 行读取 | ACL/RLS/`REVOKE UPDATE` 全部拒绝；绑定镜像与 canonical payload 不一致时写入前拒绝；技术事实与 Snapshot 同事务原子提交 | `NOT RUN` |

独立设计审查须覆盖版本键语义、生命周期派生规则、统一不可用与内部审计边界以及 Major 兼容代价；本节批准与实现前不改变 `identity.*` 既有 20 项公开 Contract 的接受集合与历史验收记录。
