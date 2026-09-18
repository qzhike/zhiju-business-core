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
