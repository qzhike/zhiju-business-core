## 背景

PostgreSQL Logical Model 要求七个 owning Schema 各自拥有 Command Receipt、Outbox、Inbox、Process、Audit、Reference Index 与 Contract Violation 技术表；不得建立所有模块共享写入的超级技术 Schema。当前只有逻辑字段和约束，没有可执行 DDL。

父追踪 Issue：#28（WI-04）。硬依赖：WI-02、WI-03。

## 工作范围

- 在七个 owning Schema 中分别创建 `command_receipt`、`outbox_event`、`inbox_message`、`process_instance`、`process_step`、`audit_record`、`reference_edge`、`contract_violation`。
- 落实幂等唯一键、consumer/event 唯一键、Process correlation active 唯一性、事件/审计不可变、Scope 镜像、Canonical payload/hash、lease/fencing 与查询索引。
- 技术表继承对应 Enterprise/Project RLS；Platform 数据与企业数据不通过 nullable Scope 混表绕过隔离。
- Dispatcher 只能更新 lease/attempt/delivery metadata，不能修改 event id/type/payload/hash/aggregate version。
- Audit 为 append-only；普通 App/Dispatcher 不能 UPDATE/DELETE。Reference Edge 只保存本模块派生索引，不创建跨 Schema FK。

## 验收条件

- [ ] 七个 Schema 的技术表集合、列、约束、RLS 和权限可由自动化 catalog test 对账，漏表或意外共享表会失败。
- [ ] 相同 idempotency scope/key、相同 consumer/event id 和相同 active process correlation 的并发插入由数据库唯一约束裁决。
- [ ] Event payload/hash、Audit row 和 Process step 的非法 UPDATE/DELETE 被权限或不可变保护拒绝。
- [ ] Canonical payload 与 promoted Scope/hash 镜像不一致时写入拒绝；敏感拒绝只保存 hash/path/安全摘要。
- [ ] Migration 重放、真实 PostgreSQL constraint tests 与最小权限负向测试通过。

## 手动验收产出

提供 Schema catalog 报告，按 owning module 展示技术表、主键/唯一约束、RLS/`FORCE RLS`、Owner 与实际 Grant；用户可一眼识别漏项或越权。

## 非目标

- 不把技术表抽成共享业务 Schema，不实现各模块业务 Handler。
- IntegrationGateway 业务 Migration/Repository 仍由 #27 拥有；本项仅提供其标准技术表。
