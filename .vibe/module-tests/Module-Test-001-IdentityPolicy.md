# Module-Test-001-IdentityPolicy

版本：v0.2
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-05 + WI-06 PERSISTENCE AUTOMATED PASS / EXTERNAL NOT RUN`

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
| IP-PG-U-006 | Persistence | NOINHERIT 登录同时持有 `platform_context_establisher` 与 `identity_policy_app`，执行 WI-05 Repository 事务 | 同一事务先以 establisher 建 Context，再切到 app；app 单独不能伪造 Context，Repository 可受 RLS 读写 | 首次集成复现 `42501`；修复后一次性 PostgreSQL 18.6 全部 130 项通过 | `PASS` |
| IP-PG-U-009A | PostgreSQL Unit | 两个并发 Command 使用同 idempotency scope/key 与相同 payload hash | body 只执行一次；winner 为 `COMMITTED`，loser 为保存结果的 `DUPLICATE`；无 `23505` | body 1 次；结果为 `COMMITTED` + `DUPLICATE`；Receipt 1 行 | `PASS` |
| IP-PG-U-009B | PostgreSQL Unit | Envelope Principal/Actor/Decision/Enterprise/Project/Correlation 任一值与事务上下文不一致 | 首次数据库写入前稳定拒绝；Receipt/Audit/Outbox 均为 0 | 6 类不一致均返回 `COMMAND_CONTEXT_MISMATCH`；Receipt/Audit 0 行 | `PASS` |
| IP-PG-U-004A | PostgreSQL Unit | CAS helper 的 target/expectedVersion 与 Envelope 不同，或 expectedVersion 超过 JS 安全整数 | 不一致稳定拒绝；合法 `bigint` 精确加一 | target/version 不一致返回 `COMMAND_TARGET_MISMATCH`；`9007199254740993 → 9007199254740994` | `PASS` |
| IP-PG-U-010A | PostgreSQL Unit | 业务拒绝包含 current aggregate version 后重放 | REJECTED receipt canonical result 和 DUPLICATE result 均保留相同 current version | 首次、Receipt 与重放均返回 `currentAggregateVersion=1` | `PASS` |
| IP-PG-M-001 | Migration | 已应用 V1000/V1001 的数据库升级到 WI-06 | V1000 checksum 不变；forward-only V1002 增加平台 Receipt expected version 列 | PR 相对 base 的 V1000 内容无差异；V1002 history `Success` 且列为 `bigint` | `PASS` |
| IP-PG-U-011 | Persistence Integration | WI-06 probe 登录在最新 WI-03 权限模型下执行 Command transaction | NOINHERIT 登录同时拥有 `platform_context_establisher` 与 `identity_policy_app` membership；事务内先建立 Context 再执行 app SQL | base 集成后首次运行仅授予 app role，9 项返回 `42501`；双角色 fixture 修复后 8 files / 141 tests 全部通过 | `PASS` |

## 本阶段结果

- API Handler Unit/Contract/E2E/Manual：`NOT RUN`；WI-05/WI-06 只交付低层 Persistence 与 Command transaction primitive，不冒充公开业务行为。
- WI-05 Persistence：集成此前 `origin/main` 后，`pnpm clean && pnpm verify` 完整通过；PostgreSQL 18.6 下 7 files / 130 tests `PASS`。
- WI-06 修复前基线：8 files / 129 tests `PASS`，但未覆盖并发 Claim、Context 绑定、精确 CAS 与升级路径；修复后 8 files / 133 tests `PASS`。本次最新 base 集成后的最终数字以重新执行结果为准。
- 最新 base 首次集成：Unit/Contract 339 tests `PASS`，Persistence 8 files / 141 tests 中 9 项因 WI-06 probe 缺少 `platform_context_establisher` membership 而 `NOT PASS`；同步双角色 fixture 后 `pnpm clean && pnpm verify` 完整 `PASS`：Unit/Contract 339 tests、Persistence 8 files / 141 tests、architecture、Catalog/Registry 200/200 与 compatibility 全部通过。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 外部 Provider、HTTP/E2E、Outbox 发布/Inbox 消费与人工验收：`NOT RUN`。

## IM-02 WI-04 PostgreSQL 用例

| ID | 层级 | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| IP-PG-001 | Integration | Context 仅允许 Project A1，写同 Enterprise 的 Project A2 技术行 | RLS 拒绝 `42501` | 七模块 policy catalog 含 Project helper；代表性真实写入返回 `42501` | `PASS` |
| IP-PG-002 | Integration | 已提交 Audit 行后以 audit_reader 查询 masked view | 返回目标 audit_id；底表整体/敏感列仍拒绝 | masked view 返回目标行；底表 count/敏感列为 `42501` | `PASS` |
| IP-PG-003 | Integration | 不同 owner version 写同路径/同 target Reference Edge | 两行成功；同精确版本重复为 `23505` | 两版本成功；精确重复为 `23505` | `PASS` |

业务 Handler、真实身份 Provider、HTTP/E2E 与人工验收仍为 `NOT RUN`；WI-05/WI-06 的 payload↔hash Repository/Command transaction 子 Gate 已自动通过。
