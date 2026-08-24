# Module-Test-001-IdentityPolicy

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / WI-10 PERSISTENCE CASES PASS IN WORKTREE / EXACT-HEAD DELIVERY REVIEW PENDING`

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
| IP-WI10-U-001 | Persistence/Unit | canonical payload 与入站 payloadHash 不一致 | 写入 Quarantine + `HASH_MISMATCH` Violation，不执行 target | 工作区 real-PG gate 返回 `QUARANTINED/HASH_MISMATCH`，target 未执行 | `PASS (WORKTREE)` |
| IP-WI10-U-002 | Persistence/Unit | Enterprise A Context 只允许 Project A，事件带 Project B 或 mirror 不一致 | 写入 Quarantine + `SCOPE_CONFLICT` Violation，不执行 target | 工作区 real-PG gate 覆盖 foreign Enterprise、foreign Project 和 mirror mismatch；均为 Quarantine，target 未执行 | `PASS (WORKTREE)` |
| IP-WI10-U-003 | Persistence/Concurrency | 两个消费者并发处理同 consumer/eventId/同 hash | 一个 `PROCESSED`，另一个读取原 Receipt 返回 `DUPLICATE`，target 只执行一次 | 工作区 real-PG gate 返回 `PROCESSED + DUPLICATE`，target 执行 1 次且无 23505 泄漏 | `PASS (WORKTREE)` |
| IP-WI10-U-004 | Persistence/Concurrency | Dispatcher A lease 过期后 Dispatcher B claim 同一 Outbox | B 获得新 fencing token；A 的 ACK/失败回写被拒绝 | 工作区 real-PG gate：B 获得新 token；A 的过期 ACK 与失败回写均被 `DISPATCHER_STALE_LEASE` 拒绝 | `PASS (WORKTREE)` |
| IP-WI10-U-005 | Persistence/Unit | 第一次 claim 后调用失败路径伪造 `attempt=5` | 状态仍由数据库 attempt_count 决定，不能直接 `DEAD` | 工作区 real-PG gate 不接受 caller attempt；首次失败 `attempt_count=1` 且状态为 `UNKNOWN`，五次服务端计数后才为 `DEAD` | `PASS (WORKTREE)` |
| IP-WI10-U-006 | Persistence/Failure boundary | DEAD resume 的 Audit insert 失败 | 不得留下已恢复但无 Audit 的事件；reason 不得丢失 | 工作区 real-PG gate 撤销 Audit INSERT 后 resume 失败，事件保持 `DEAD`；成功路径保存 operator reason | `PASS (WORKTREE)` |
| IP-WI10-E-001 | E2E/Persistence | 首次消费提交后模拟 ACK 丢失，再用同 id/hash replay | 原 Result 返回，Aggregate/Receipt/Outbox/副作用计数不增加 | Disposable PostgreSQL 18.6 + Flyway 11.20.3：12 files/161 tests `PASS`；二次 migrate no-op，含 ACK-loss replay 计数断言 | `PASS (WORKTREE)` |
| IP-WI10-M-001 | Manual | ACK-loss + same id/different hash 演示 | 输出 `PROCESSED → DUPLICATE → QUARANTINED`，业务事实只有一份 | `tests/manual/wi10-probe.mts`；人工尚未执行 | `NOT RUN` |

## 本阶段结果

- 原有 API Unit/Contract/E2E/Manual：仍按各自实现边界记录；当前工作区 WI-10 Persistence/Concurrency 自动化用例为 `PASS`，但 PR exact-head 交付复审仍待完成。
- `pnpm typecheck && pnpm persistence:gate` 已通过：真实 PostgreSQL 18.6 + Flyway 11.20.3，12 个测试文件、161 个测试通过，二次 migrate 为 no-op。
- `pnpm clean && pnpm verify` 已通过：格式、Lint、TypeScript、341 个自动测试、架构边界、200 条公开契约/兼容性检查和上述 persistence gate 均通过。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 生产 Broker/Provider、跨模块业务 E2E 与人工验收不得由静态文档或本地 PostgreSQL gate 代替；生产与人工边界继续保持 `NOT RUN`。
