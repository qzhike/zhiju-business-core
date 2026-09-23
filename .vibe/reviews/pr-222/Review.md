# PR #222 独立实现审查

- 结论：`REQUEST_CHANGES`
- PR：[#222](https://github.com/qzhike/zhiju-business-core/pull/222)，关联 Issue：[#221](https://github.com/qzhike/zhiju-business-core/issues/221)
- Reviewed SHA：`30cc50144ecfbebd911dad96639d90cdbcc838c3`
- 日期：2026-09-23
- GitHub handoff：[已发布并读回的 PR comment](https://github.com/qzhike/zhiju-business-core/pull/222#issuecomment-5790444865)；认证用户即 PR 作者，GitHub 不允许 formal review，故以 comment 发布；本记录不代表 GitHub formal review 或人类技术批准。

## 审查依据与范围

独立读取 Issue #221、当前 PR head/diff（52 个文件）、HL-Spec、决定 §21（含 §21.4 人类设计批准记录）、Spec 001 §15.12、Spec 003 §22、Spec 007 IM-06 READY Run 启动增量、Catalog 注册增量、PostgreSQL §37、Runtime Adapter 首个受控 Run 映射、Module-Test 001/003/007 的 Run 启动矩阵，以及实现代码（`execution-capability-bundle.ts`、`controlled-first-run.ts`、`first-run-repository.ts`、`controlled-runtime-dispatch.ts`、`controlled-first-run-entry.ts`、V1007/V3006/V7002 与相关测试），并核对既有 V3003/V3005 守卫与 V7001 renderer 先例的相容性。未读取 Implementer 过程材料；PR #218/#220 的既有审查不替代本次实现审查。

成功标准是：READY WorkOrder 经独立当前授权 queue、内容寻址 Bundle、唯一 ACTIVE Claim 的 Run 创建、真实 synthetic ack、Attempt 证明下的 start 与独立 reconcile，同时保持既有 Schema、迁移与 200 项 Baseline 不变。当前发现 F1/F2 阻断，停止于 `REQUEST_CHANGES`，不宣称其余未执行组合已通过。

### 已通过的核对（非穷尽）

- 契约注册：四个新 operation 与 `zhiju.identity.execution_capability_bundle` objectType 为 additive；Catalog/Registry 217→221（IP 22→23、TE 47→49、IG 24→25）与设计 §21/Catalog 增量一致；200 项历史 Baseline 与既有 operation Schema/metadata 零改动；`get_run_dispatch_binding`/`get_runtime_attempt_binding` 结果闭集与 §22.3 及已批准 `RuntimeAttemptBindingView` 逐字段一致，`RuntimeDispatchSucceeded` 事件 payload 与注册闭集一致。
- 迁移：仅新增 V1007/V3006/V7002，已应用文件未改写；V1007 Bundle 守卫闭合来源 Receipt、Scope/Ref/Hash/有效期镜像并重算 canonical hash，app 角色 INSERT/SELECT-only + FORCE RLS；V3006 将 READY→QUEUED、QUEUED→RUNNING 收敛为来源 Receipt 绑定，Run/Claim 唯一性（单 ACTIVE、`(work_order_id,attempt_number)`）、固定 synthetic RuntimeBinding 与 `execution_deadline = lease_expires_at` 在 DB 闭合；V7002 稳定键唯一、binding 不可变、SUCCEEDED 必须有真实 ack+Receipt+Observation，Renderer 历史行的 FK 与值保留。
- 处理程序：Bundle 签发逐项校验 allow/deny/Human-only/单 Grant 覆盖/有限 `validUntil` 并稳定排序观察；queue/create_run/start 在锁内重验 Contract/Context/Controls Policy/Bundle/Claim/期限，CAS 与重放语义正确；`startedAt` 固定于受信入口时刻；reconcile 独立 WorkOrder 事务且不跨 Root 写 Run。

## F1 — P2：Policy-read 依赖 Decision 在提交/返回前未被重验

位置：`apps/api/src/composition/controlled-first-run-entry.ts:230-232`（`revalidateAll` 仅遍历 `checks`）、`:266` 与 `:362`（`revalidateAuthorization: revalidateAll`）、`:287-290`（`resolveControls` 经 `readers.resolvePolicy` 铸出 Policy-read Decision）。

`createWorkOrderDependencyReads` 的 `authorizedRead` 将每次 Policy 解析的重验闭包存入其内部 `currentReads`，仅 `readers.revalidate()` 会执行；本 entry 从未调用它。queue/create_run/start/dispatch-binding 每条链路都经 `dependencies()` 铸出 Policy-read Decision，但该 Decision 对应的 Grant 在铸出后被撤销时，提交点与历史 Receipt/Query 返回点都不会再次拒绝。对照 #219 已交付的兄弟入口 `work-order-validation-entry.ts:288-292`，其 `revalidate` 明确包含 `readers.revalidate()`。

这违反 Spec 001 §15.12（本 PR 新增的已批准设计）："自身与依赖 Decision 均绑定…；在目标 protected read/Claim 前重验，在持锁提交及历史 Receipt/Query 返回前再次重验"，该规则覆盖 Policy/Grant 依赖读取且无例外条款。修复要求：把 `readers.revalidate()` 纳入本入口的 `revalidateAll`（与 #219 入口一致），并补一个 Policy-read Grant 在铸出后、提交前被撤销的负例（对应 IP-RUN-D-003/004 已列而未执行的撤销组合）。

## F2 — P2：IG dispatch 未交付已批准设计要求的事务内 Receipt/Audit/Reference Edges 与 `source command_id`

位置：`migrations/integration_gateway/V7002__runtime_attempt_binding.sql:5-27`（`runtime_attempt` 无 `source_command_id`）；`modules/integration-gateway/src/runtime/controlled-runtime-dispatch.ts:223-256`（Attempt 提交事务只写 `runtime_attempt` 一行）。

Spec 007 IM-06 READY Run 启动增量（本 PR 新增、2026-09-22 人类设计批准）明确："原 request/hash、invocationBinding/hash、Project Scope 与稳定键先同事务提交，Receipt/Audit/Reference Edges 同事务"；PostgreSQL §37 把 `source command_id` 列为 `runtime_attempt_binding` 的最小字段。当前实现两者均未交付：IG 侧无 command Receipt、无 Audit、无 Reference Edge，Attempt 行在 DB 层也无法回溯来源命令。模块内 renderer 既有模式同样从简（仅 Outbox）属实，但本增量的已批准文本显式承诺了更高标准，且本 PR 文档状态行已把该增量标记为已实现。修复路径二选一：按已批准设计补齐同事务 Receipt/Audit/Reference Edges 与 `source_command_id`，或按变更纪律正式修订设计文本并依 §21.4 重新确认人类批准适用性；不允许静默分叉。

## F3 — P3：Spec 001 §15.12 的 Contract objectType 拼写违反唯一拼写规则

位置：`.vibe/module-specs/Module-Spec-001-IdentityPolicy.md:755`：`workOrderContractRef:ContentAddressedRef<zhiju.execution.work_order_contract>`。Catalog（06，名称唯一权威）在 #219 已冻结 `zhiju.contract.work_order` 为 frozen Contract 的唯一拼写；本 PR 注册的 Schema/Registry 与实现均正确使用该拼写。请将 §15.12 该处订正为 `zhiju.contract.work_order`，消除权威文档之间的静默分叉。

## 验证证据与剩余门禁

- 已从 GitHub run 元数据与日志核实 [CI run 35820743319](https://github.com/qzhike/zhiju-business-core/actions/runs/35820743319)：`headSha=30cc50144ecfbebd911dad96639d90cdbcc838c3`，状态 `success`，执行完整 `full`：代码阶段 75 文件/1379 测试通过；Catalog/Registry 221/221 FULL、兼容性 Baseline 200（minor findings 98）；PostgreSQL 18.6 + Flyway 11.20.3 持久化阶段 45 文件/496 测试通过，含空库迁移、V6003/V6004 历史升级路径、第二次 migrate no-op。实现提交 `8b4dfc0` 的同门禁证据为 [run 35819742527](https://github.com/qzhike/zhiju-business-core/actions/runs/35819742527)。按证据复用规则未重复运行本地 full。
- CI 绿色不覆盖 F1/F2 的语义缺口：现有测试无 Policy-read 撤销重验负例，也无 IG Receipt/Audit 断言。本次未执行独立 PostgreSQL 反例；F1/F2/F3 均由直接代码/文档核对建立。
- 未执行边界保持：`IP-RUN-D-*`、除 `TE-RUN-D-001` 外的 `TE-RUN-D-*`、`IG-RUN-D-*` 均 `NOT RUN`；外部 Provider/CLI/飞书、Result/Usage/Completion、生产部署与独立人工业务验收 `NOT RUN`，不属于本切片验收。
- Issue #221 未声明额外人类技术审查门禁；本结论不授权合并，合并授权按既有策略保留。
- 本轮只新增正式审查记录并发布 PR comment，不修改产品实现或冻结设计，不 commit、push 或 merge。记录进入 PR 分支仍需相应 Git 交付授权；评论发布与文件入库是两项不同事实。
