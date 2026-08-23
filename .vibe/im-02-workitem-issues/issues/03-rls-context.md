## 背景

IM-02 必须证明无/伪造 RLS Context 和跨 Enterprise/Project 访问在数据库层被拒绝。PostgreSQL 自定义 setting 本身不是可信凭证，因此必须先固定真实的事务 Context 机制和信任边界，再写 Policy；不能把调用方可任意 `SET` 的值当成防伪授权。

父追踪 Issue：#28（WI-03）。硬依赖：WI-02。

## 工作范围

- 在权威文档中固定 transaction-scoped Context 的传递、校验、清理和连接池复用机制，包含 `principal_id`、Actor/Authorization Decision、Enterprise、允许 Project Scope 与 correlation id。
- 设计仅受信 Application 路径可建立的 Context，明确 Database Role、函数/表权限及 AuthorizationDecision 完整性检查边界。
- 为 Enterprise-owned、Project-owned 与 Projection 行建立可复用但不共享业务所有权的 RLS Policy 模式，并启用 `FORCE ROW LEVEL SECURITY`。
- 无 Context 默认零行/拒绝；Background Consumer 只能从已验证 Event Scope 建立受限 Context；break-glass 不走普通 Runtime Role。
- 覆盖伪造值、跨 Scope、事务回滚/异常、连接归还后 Context 泄漏和并发连接隔离。

## 验收条件

- [ ] 物理机制与威胁模型先于实现写入 PostgreSQL/测试文档，并明确 RLS 不替代 IdentityPolicy Authorization。
- [ ] Enterprise A Context 无法读写 Enterprise B；Project A Context 无法读写同 Enterprise 的 Project B；错误结果不泄漏对象是否存在。
- [ ] 无 Context、过期/不匹配 AuthorizationDecision、普通 App Role 直接伪造 Context 均安全失败。
- [ ] 事务 commit、rollback、异常和连接池复用后 Context 不残留到下一请求。
- [ ] Runtime Role 不是 Owner、无 `BYPASSRLS`，Owner 之外的业务访问受 `FORCE ROW LEVEL SECURITY` 约束。
- [ ] PG-U-001、PG-U-002 和 PG-E-005 的适用子场景在真实 PostgreSQL 通过。

## 手动验收产出

提供 A/B Enterprise 与 A1/A2 Project 的脱敏数据探测：用户切换受控 Context 后可直接观察允许行集合，且无 Context/伪造 Context 探测明确失败。

## 非目标

- 不使用 RLS 判断 Human-only、职责分离、Contract Hash 或业务状态。
- 不实现生产 break-glass、Keycloak token 验证或完整 IdentityPolicy Decision Port。
