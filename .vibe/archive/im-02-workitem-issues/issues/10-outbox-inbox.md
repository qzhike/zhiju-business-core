> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-02-workitem-issues/issues/10-outbox-inbox.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-02-workitem-issues/issues/10-outbox-inbox.md).
> Published Issue: [#38](https://github.com/qzhike/zhiju-business-core/issues/38); this file is a historical draft, not its current body.

## 背景

Domain Event 采用至少一次投递。IM-02 必须在真实 PostgreSQL 证明 Outbox/Inbox replay 不会产生第二业务事实：同 EventId/Hash 重放返回原结果，同 EventId/不同 Hash 必须 Quarantine；不能用“exactly-once”或 In-Memory Ledger 代替。

父追踪 Issue：#28（WI-10）。硬依赖：WI-04、WI-06、WI-09。

## 工作范围

- 实现受限 Dispatcher 对已提交 Outbox 的 claim/lease/fencing、同 Aggregate 顺序、重试、UNKNOWN 与 delivery metadata 更新；同 Aggregate 的顺序键是 typed identity（`aggregate_type + aggregate_id`），不同 Aggregate Type 即使 UUID 相同也独立排序。
- 实现目标模块 Inbox transaction：claim → hash/major/Scope 校验 → idempotent target command → target state/outbox/audit → `PROCESSED` 原子提交。
- 相同 consumer/event id + 相同 hash 重放读取原结果；不同 hash 或 Scope 冲突进入 Quarantine/Violation，不执行目标 Command。Scope Quarantine 只能保存受信 Context Enterprise；只有 Event Enterprise 一致且 Project 属于 allow-list 时才保留 Project，否则使用 `project_id=NULL`。
- 使用 IdentityPolicy 的受控 Event/consumer fixture 证明 transport ACK 丢失后的 replay；不调用真实 broker/飞书/邮件。
- 明确归档、retry threshold 和 dead-letter/resume 参数的 IM-02 默认值；人工 replay/resume 写不可变 Audit。

## 验收条件

- [ ] PG-U-011 与 PG-E-004 在真实 PostgreSQL 通过，重放后 Aggregate、Command Receipt、Outbox 和外部副作用计数不增加。
- [ ] 两个 Dispatcher 并发 claim 同 Event 时只有当前 lease/fencing owner 可推进状态；过期 owner 的确认被拒绝。
- [ ] payload hash、event major/required extension 或 Scope 冲突进入 Quarantine，且不会错误标记为 Duplicate Success。
- [ ] 目标状态、目标 Outbox、Audit 与 Inbox `PROCESSED` 同事务提交；故障注入后全部回滚并可安全重放。
- [ ] Dispatcher Role 无法修改业务表或 Event payload/hash；发布超时保留同 EventId 并进入 UNKNOWN/retry。
- [ ] focused concurrency/persistence tests、Migration replay 与 `pnpm clean && pnpm verify` 通过。

## 手动验收产出

提供一个可重复的 ACK-loss 演示：首次消费已提交但模拟未确认，第二次重放返回原结果；随后以同 EventId/不同 Hash 重放，用户可看到 Quarantine 与 Audit，业务事实仍只有一份。

## 非目标

- 不接入生产 message broker、飞书或邮件 Provider，不宣称 exactly-once。
- 不实现 #27 的 IntegrationGateway 业务 Handler/Adapter；其模块可在后续复用本项基础设施。
