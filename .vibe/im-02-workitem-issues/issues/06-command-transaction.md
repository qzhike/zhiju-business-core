## 背景

IM-02 的 PostgreSQL Gate 要求 Command Receipt、Aggregate CAS、Audit、Reference Edge 与 Outbox 在同一 owning-module 事务内原子提交。仅有 DDL 不能证明重复请求、Hash 冲突、并发更新和中途回滚不会制造第二业务事实。

父追踪 Issue：#28（WI-06）。硬依赖：WI-04、WI-05。

## 工作范围

- 在 IdentityPolicy 纵向切片中实现明确的 Command transaction runner/repository pattern：claim receipt → load expected version → validate → write aggregate/fact → reference/audit/outbox → finalize result → commit。
- 相同 idempotency scope/key + 相同 request hash 返回已保存结果；不同 hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` 并保存安全审计。
- expected aggregate version 使用单条受 Scope 约束的 CAS；不自动读取新版本后静默重放高风险命令。
- 业务拒绝不修改 Aggregate，但保存稳定 REJECTED receipt、current version、Actor/Decision ref、request hash 与安全错误摘要。
- 提供受控故障注入，证明 Outbox insert 后失败会整体回滚；不得留下半完成 receipt、audit、reference 或 event。

## 验收条件

- [ ] PG-U-004、PG-U-006、PG-U-009、PG-U-010、PG-U-012 在真实 PostgreSQL 上通过。
- [ ] 两个并发事务使用同 expected version 时仅一个提交，另一个得到稳定 `CONCURRENCY_CONFLICT`。
- [ ] 同幂等键/同 hash 不产生第二 Aggregate 变化或第二 Event；不同 hash 不泄露原 payload。
- [ ] Aggregate、Receipt、Audit、Reference Edge 和 Outbox 的成功/回滚边界可通过事务后数据库状态断言。
- [ ] 事务 primitive 不允许跨 owning Schema 写入，也不在事务内调用网络副作用或更新 Projection。
- [ ] focused concurrency/persistence tests 可重复运行，无 flaky timing dependency；`pnpm clean && pnpm verify` 通过。

## 手动验收产出

提供同一 Command 的三次探测：首次提交、同 key/hash 重放、同 key/不同 hash 冲突；随后展示 Aggregate version、Receipt、Audit 与 Outbox 的精确行数未重复。

## 非目标

- 不实现跨模块分布式事务或 exactly-once 声明。
- 不实现 Outbox 发布和 Inbox 消费循环（WI-10）。
