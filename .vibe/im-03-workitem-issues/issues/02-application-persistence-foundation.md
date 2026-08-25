## 目标

建立 EnterpriseProject 模块内最小 Application/Persistence 基础，使后续业务切片可复用 IM-02 已交付的技术表、RLS Context、Command Receipt、Audit、Reference Edge 与 Outbox，同时保持一个 Aggregate Root 一个事务。

父追踪：#56

硬依赖：#57

## 范围

- 模块内数据库 Port、连接/事务边界、Command Envelope 到可信 Authorization/Actor/Policy Snapshot 的绑定。
- Command Receipt 幂等仲裁、payload hash 冲突拒绝、expectedVersion CAS、Audit/Outbox/Reference Edge 同事务提交。
- Canonical JSONB ↔ Hash、提升 Scope/Ref 列一致性、稳定错误映射和回滚语义。
- 真实 PostgreSQL 测试入口与 Enterprise/Project 两类 RLS Context Fixture；不得复制 IdentityPolicy 业务模型或共享 Repository。

## 验收条件

- [x] 相同幂等键/相同 Hash 返回稳定结果；不同 Hash 拒绝且不改写首个 Receipt。
- [x] CAS 竞争只有一个成功；失败事务不遗留业务行、Audit 或 Outbox。
- [x] 无/伪造/过期 Context、跨 Project Scope 与连接池 Context 泄漏安全拒绝。
- [x] Canonical payload/hash 与提升列不一致被写入边界拒绝。
- [x] Outbox Aggregate identity/version、Reference Edge owner 与 Command target 绑定；禁止写入不相干对象或任意版本。
- [x] Technical process 的 `created_by_principal_id` 与受信 Context Principal 绑定。
- [x] 空库 Migration、重复 Migration 和真实 PostgreSQL focused tests 通过。
- [ ] 用户可运行一个 probe，看到成功、replay、hash conflict、CAS conflict 和 rollback 的逐项输出。

## 非目标与 `NOT RUN` 边界

- 不创建 EnterpriseProject 业务表或业务 Handler。
- 不把 IdentityPolicy 内部 Repository 复制为跨模块共享层；授权只走其公开 Decision/Query Port 或可信决定快照。
