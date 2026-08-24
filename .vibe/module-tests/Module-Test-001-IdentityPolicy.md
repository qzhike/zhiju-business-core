# Module-Test-001-IdentityPolicy

版本：v0.2
日期：2026-08-24
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / IM-02 WI-06 AUTOMATED PASS`

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
| IP-PG-U-009A | PostgreSQL Unit | 两个并发 Command 使用同 idempotency scope/key 与相同 payload hash | body 只执行一次；winner 为 `COMMITTED`，loser 为保存结果的 `DUPLICATE`；无 `23505` | body 1 次；结果为 `COMMITTED` + `DUPLICATE`；Receipt 1 行 | `PASS` |
| IP-PG-U-009B | PostgreSQL Unit | Envelope Principal/Actor/Decision/Enterprise/Project/Correlation 任一值与事务上下文不一致 | 首次数据库写入前稳定拒绝；Receipt/Audit/Outbox 均为 0 | 6 类不一致均返回 `COMMAND_CONTEXT_MISMATCH`；Receipt/Audit 0 行 | `PASS` |
| IP-PG-U-004A | PostgreSQL Unit | CAS helper 的 target/expectedVersion 与 Envelope 不同，或 expectedVersion 超过 JS 安全整数 | 不一致稳定拒绝；合法 `bigint` 精确加一 | target/version 不一致返回 `COMMAND_TARGET_MISMATCH`；`9007199254740993 → 9007199254740994` | `PASS` |
| IP-PG-U-010A | PostgreSQL Unit | 业务拒绝包含 current aggregate version 后重放 | REJECTED receipt canonical result 和 DUPLICATE result 均保留相同 current version | 首次、Receipt 与重放均返回 `currentAggregateVersion=1` | `PASS` |
| IP-PG-M-001 | Migration | 已应用 V1000/V1001 的数据库升级到 WI-06 | V1000 checksum 不变；forward-only V1002 增加平台 Receipt expected version 列 | PR 相对 base 的 V1000 内容无差异；V1002 history `Success` 且列为 `bigint` | `PASS` |

## 本阶段结果

- 本轮修复前基线：重建 workspace 产物后 `pnpm persistence:gate` 为 8 files / 129 tests `PASS`；该基线未覆盖上表新增竞态、上下文绑定、精确 CAS 与升级路径。
- 修复后 `pnpm verify`：Unit/Contract 19 files / 339 tests `PASS`；Persistence 8 files / 133 tests `PASS`；format、lint、typecheck、architecture、Catalog/Registry 200/200 与 compatibility 全部 `PASS`。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 外部 Provider、HTTP/E2E、Outbox 发布/Inbox 消费与人工验收：`NOT RUN`。
