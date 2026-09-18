# PR #213 独立审查

## 第 1 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`296a20b898726270a2a86664b4e6705189ddd757`
- Base SHA：`f950317d61d2a73f14f3bb0e76c1cb451e0f3fed`
- PR：[#213](https://github.com/qzhike/zhiju-business-core/pull/213)
- Work item：[#212](https://github.com/qzhike/zhiju-business-core/issues/212)（T2 implementation）
- 审查日期：2026-09-18
- Inline comment：[#discussion_r4043230587](https://github.com/qzhike/zhiju-business-core/pull/213#discussion_r4043230587)
- 汇总 comment：[#issuecomment-5724118700](https://github.com/qzhike/zhiju-business-core/pull/213#issuecomment-5724118700)

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #212、PR 最新 head 与实际 diff、已批准的 Issue #210 设计、人类设计批准、受影响的 TaskExecution/IdentityPolicy Module Spec/Test、platform transaction-context 决定、PostgreSQL 持久化权威、Contract/Registry 变更、当前实现与真实 PostgreSQL 验证证据；未把实现者的 PR 描述或 Issue 评论当作正确性依据。

## 阻断发现

### 1. WorkOrder UPDATE RLS 把创建归属错误地变成对象所有权

`migrations/task_execution/V3003__work_order_draft_creation.sql` 的 `work_order_update` policy 在 Project Scope 检查之外，还要求：

```sql
created_by_principal_id = platform_security.context_principal_id()
AND requested_by_principal_id = platform_security.context_principal_id()
```

同一 migration 的 `guard_work_order_root_update()` 又把这两列定义为创建后不可变。因此，只有原创建者才能满足 UPDATE policy；任何与创建者不同、但已通过当次授权的后续主体都会在 RLS 层被拒绝，owning lifecycle/CAS 逻辑没有执行机会。例如 Human A 创建 DRAFT 后，获准的 Validator 或 Process Manager B 无法执行后续 `DRAFT -> READY` transition。

这与 TaskExecution Spec §18.7 的边界不一致：创建时的两表 INSERT policy 与 creation-identity guard 必须把 creator/requester 绑定到创建事务 Context；后续 Root 更新则由当次授权、Project Scope 和 owning transition/CAS 控制，创建归属列只需保持不可变。当前 policy 额外引入了文档未定义的 creator ownership 规则，并会阻断后续已规划的 WorkOrder 生命周期。

要求：移除 UPDATE policy 中 creator/requester 等于当前 principal 的条件，仅保留 `context_allows_project(enterprise_id, project_id)`，由 immutable trigger 继续禁止归属改写；或者在真正的受控 transition path 落地前撤销 app role 的通用 UPDATE。增加真实 PostgreSQL 回归：由 principal A 创建 WorkOrder，再以 principal B 的合法 Project Context 执行允许的 owning transition，确认 RLS 不把创建归属误作更新所有权，同时仍不能改写 creator/requester 列。

## 验证证据

- 远端发布前回读：PR head 仍为 `296a20b898726270a2a86664b4e6705189ddd757`，PR `OPEN`、非 Draft、`MERGEABLE`；exact-head GitHub Actions `verify` 为 `SUCCESS`。
- `git diff --check f950317d61d2a73f14f3bb0e76c1cb451e0f3fed...296a20b898726270a2a86664b4e6705189ddd757`：PASS。
- exact-head `vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。
- 普通测试：101 files（62 passed / 39 skipped）、1526 tests（1071 passed / 455 skipped）。
- 真实 PostgreSQL 18.6 persistence gate：43/43 files、470/470 tests；V0004/V3003 应用成功，历史升级成功，第二次 migrate 为 no-op。
- Contract/Catalog：operations 215、catalog 215、registry 215、TaskExecution 45；Compatibility Baseline 200 保持通过。

绿色 verifier 没有覆盖“非创建者执行后续 WorkOrder owning transition”这一权限反例，因此不能消除上述静态契约与 RLS 不一致。

## 未运行边界与后续门禁

外部 Provider/Runtime/飞书、生产、负载/性能与独立人工业务验收仍为 `NOT RUN`。本轮因存在 agent 可修复的阻断，尚未进入最终人类技术 review gate；修复后的新 exact head 必须重新独立审查，并继续保留 Issue #212 要求的人类技术 review before merge。

本轮未修改业务代码，未提交、推送或合并任何变更。新增的本地正式审查记录尚未提交。

## 第 2 轮：`HUMAN_REVIEW_REQUIRED`

- 结论：`HUMAN_REVIEW_REQUIRED`
- Reviewed SHA：`4deffa472bfb5f96f85224d3ec930b43a0e61ba8`
- Base SHA：`f950317d61d2a73f14f3bb0e76c1cb451e0f3fed`
- 前一轮 Reviewed SHA：`296a20b898726270a2a86664b4e6705189ddd757`
- 审查日期：2026-09-18
- 汇总 comment：[#issuecomment-5724529749](https://github.com/qzhike/zhiju-business-core/pull/213#issuecomment-5724529749)
- 范围：第 1 轮 finding 修复、修复引入的测试与权威文档增量，并对最新 head 的门禁与远端状态重新取证

第 1 轮阻断已经关闭。`V3003` 的 `work_order_update` policy 现仅以
`context_allows_project(enterprise_id, project_id)` 校验 Project Scope，不再把
`created_by_principal_id` / `requested_by_principal_id` 等于当前 Context principal
作为更新条件；两列仍在 INSERT 时锚定到受信 Context，并由
`guard_work_order_root_update()` 保持不可变。这与 Spec 003 §18.7 的归属、当前授权、
Project Scope 和后续 owning transition/CAS 分工一致。

新增 `TE-P210-017b` 在真实 PostgreSQL 上覆盖该反例：principal A 经真实组成入口创建
DRAFT，principal B 通过自己的合法 11 参数 Project Context 以 app role 执行 root guard
接受的状态/版本更新，恰更新 1 行且创建归属仍为 A；不包含目标 Project 的 Context
更新 0 行；B 改写任一归属列仍被 `23514` 拒绝。测试及 Module Test 明确记录本切片
没有交付 WorkOrder owning lifecycle Handler，该转换只是数据库策略/guard 层探针，
没有把未来业务操作冒充为已交付能力。受影响的 TaskExecution Spec、PostgreSQL 权威与
Module Test 表述已同步，没有发现新的 agent 可修复缺陷。

## 第 2 轮验证证据

- 发布前远端回读：PR `OPEN`、非 Draft、`MERGEABLE`，head 仍为
  `4deffa472bfb5f96f85224d3ec930b43a0e61ba8`；该 exact head 的 GitHub Actions
  `verify` 为 `SUCCESS`。
- `git diff --check f950317d61d2a73f14f3bb0e76c1cb451e0f3fed...4deffa472bfb5f96f85224d3ec930b43a0e61ba8`：PASS。
- exact-head `vibe verify full --json`：`PASS`，resolved command
  `pnpm clean && pnpm verify`，exit 0。
- 普通测试：101 files（62 passed / 39 skipped）、1527 tests（1071 passed / 456 skipped）。
- 真实 PostgreSQL 18.6 persistence gate：43/43 files、471/471 tests；`V0004` / `V3003`
  应用成功，历史升级成功，第二次 migrate 为 no-op。
- Contract/Catalog：operations 215、catalog 215、registry 215、TaskExecution 45；
  Compatibility Baseline 200 保持通过。

## 第 2 轮剩余门禁

Issue #212 明确要求：由于本切片涉及授权、受信 PrincipalKind、RLS、不可变持久化、
数据库 guard 与并发行为，合并前必须保留独立人工技术 review。自动/agent 复审不能代替
该门禁，因此在未发现新的 agent 可修复缺陷后，角色结果是 `HUMAN_REVIEW_REQUIRED`，
不是 `APPROVE`。外部 Provider/Runtime/飞书、生产、负载/性能和独立人工业务验收仍为
`NOT RUN`；WorkOrder Validation/Freeze/READY 等后续业务能力仍不在本切片内。

本轮未修改业务代码，未提交、推送或合并任何变更；只追加本地正式复审记录并发布
PR comment。

## 人类技术复审批准

- 结论：`APPROVE`
- Approved SHA：`4deffa472bfb5f96f85224d3ec930b43a0e61ba8`
- 批准日期：2026-09-18
- 批准来源：用户在当前会话中明确指令“批准复审”
- 批准记录：[#issuecomment-5724627247](https://github.com/qzhike/zhiju-business-core/pull/213#issuecomment-5724627247)

批准时 PR head 与第 2 轮独立复审的 exact SHA 一致，exact-head GitHub Actions
`verify` 仍为 `SUCCESS`；第 2 轮独立执行的 `vibe verify full --json` 证据仍适用，
且没有未解决的 agent 可修复缺陷。因此，Issue #212 对授权、受信 PrincipalKind、RLS、
不可变持久化、数据库 guard 与并发行为要求的人类技术 review gate 已获得明确批准。

GitHub 拒绝 PR 作者以同一认证身份提交原生 `APPROVE` review，返回
`Review Can not approve your own pull request`。按项目 reviewer fallback 规则，批准改以
PR comment 发布；该 comment 是人类技术批准的持久证据，但不虚称 GitHub
`reviewDecision=APPROVED`。

本批准不授权 merge 或 deployment。外部 Provider/Runtime/飞书、生产、负载/性能与独立
人工业务验收仍为 `NOT RUN`。本地正式复审记录仍未提交。
