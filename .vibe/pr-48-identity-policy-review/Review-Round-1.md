# PR #48 IdentityPolicy 首轮 Code Review

日期：2026-08-24
评审提交：`7bf9f62ef6e4c369bb7c32437aa63a32dab6e496`
评审范围：PR #48 相对 base `553431c26ea0b5d08b6a602f7ed17b987c205d4d` 的 7 个文件变更

## 基线验证

- `pnpm format:check`：PASS
- `pnpm lint`：PASS
- `pnpm typecheck`：PASS
- `pnpm test`：341 PASS，129 个依赖数据库环境的测试保持 SKIP
- `pnpm architecture`：PASS
- `pnpm contracts:check`：PASS，Catalog/Registry 为 200/200
- `pnpm persistence:gate`：142/142 PASS；空库迁移、第二次迁移 no-op、PostgreSQL 18.6 和 Flyway 版本检查 PASS
- 以上只证明当前自动化路径通过，不替代下列失败场景的语义复核

## 发现

### R1：命令幂等请求 Hash 没有覆盖全部业务输入（高）

位置：`modules/identity-policy/src/commands/role-capability-handlers.ts` 的 assign/grant/revoke/record/bootstrap 请求 Envelope。

`executeIdentityCommand` 只根据 `requestPayload` 计算 Hash，但当前各 Handler 分别漏掉了有效期、`resourceSelectors`、`actions`、`maxUses`、`justification`、`effectiveAt` 或 `policyDocument` 等会改变持久化结果的字段。同一 `idempotencyKey` 携带不同业务内容时会被错误返回为 `DUPLICATE`，不会产生 `IDEMPOTENCY_PAYLOAD_CONFLICT`，也不会暴露请求篡改。

复现方式：先用同一个 key 提交成功的 Grant/PolicySnapshot/Bootstrap，再只改变上述任一字段重放；预期是稳定的幂等冲突，当前实现会返回原结果。

### R2：Project scope 的撤销路径可跨 Project 操作，并丢失事件/审计 scope（高）

位置：`revokeRole` 与 `revokeCapability` 构造 Envelope、读取目标和写入 Outbox 的路径；`migrations/identity_policy/V1001__identity_policy_core_model.sql` 的 role/capability RLS policy。

撤销输入没有携带或验证目标 Assignment/Grant 的 Project scope，`get...ById` 和 CAS 只按 ID/aggregate version 操作；现有 RLS policy 只检查 `context_allows_enterprise`，没有检查 `allowedProjectIds`。因此同一 Enterprise 下只允许 Project A2 的 Context 可以按 ID 撤销 Project A1 的授权。与此同时，撤销的 command receipt、audit 和 event row 使用 `project_id = NULL`，事件 payload 也没有 `projectId`，无法保持精确 scope。

复现方式：在 Project A1 创建 Grant，切换到同 Enterprise、仅允许 A2 的事务 Context，按 A1 的 Grant ID 执行 revoke；预期是 scope 拒绝且 A1 行/事实不变，当前实现会提交撤销。

### R3：并发重复授予没有把数据库唯一裁决转成稳定业务拒绝（高）

位置：`assignRole`/`grantCapability` 的 pre-check 后直接调用 Repository insert；数据库部分唯一索引位于 `V1001` 的 `role_assignment_active_unique` 和 `capability_grant_active_unique`。

两个事务可同时通过 pre-check；后到事务命中 PostgreSQL `23505` 后没有 savepoint/catch 转换，异常会以原始数据库错误冒出，且事务已进入 aborted 状态。PR 摘要声称“预检 + 数据库部分唯一索引裁决并发”，但当前代码只实现了预检。

复现方式：使用两个独立连接并发提交同 Principal/Role/Scope（或 Capability/Scope）的不同 ID；预期一个 `COMMITTED`、另一个稳定返回 `IDENTITY_ROLE_ALREADY_ACTIVE`/`IDENTITY_CAPABILITY_ALREADY_ACTIVE`，当前实现会抛出 `23505`。

### R4：首角色 bootstrap claim 不是并发一次性消费，且没有产生 RoleAssigned Event（高）

位置：`bootstrapMinimalAdminRole` 读取 claim、插入 Assignment、更新 claim 的路径。

两个事务都可以在未加锁的读取中看到 claim 未消费，随后各自插入 RoleAssignment；更新 claim 没有 `consumed_at/closed_at IS NULL` 条件，也没有检查影响行数，无法保证只有一个 RoleAssignment 成功。另外，该路径只写 Audit，没有追加与普通 `assignRole` 等价的 `identity.RoleAssigned` Outbox Event，事件消费者会看不到这次正式授权。

复现方式：两个独立连接并发使用同一未过期 `FIRST_ADMIN_ROLE` claim；预期只有一条 Assignment、一条 RoleAssigned Event，另一请求稳定拒绝，当前实现没有这个保证。

### R5：有效期已过期时仍可创建 ACTIVE Assignment/Grant（中）

位置：`validatePeriod`。

当前只检查 `validTo > validFrom`，不拒绝 `validTo <= now` 的已过期有效期。数据库约束也只检查两个时间的相对顺序；这会留下状态为 ACTIVE 但从创建时已经失效的授权，违反 WI-08 的“过期 effective period 被拒绝”验收条件。

### R6：撤销事实的 `revoked_by_principal_id` 可由调用参数伪造（中）

位置：`RevokeScopedInput.revokedByPrincipalId` 以及两处 `insert...Revocation` 调用。

事务 Context 已有受信的 `principalId`，但实现把调用者提供的任意 UUID 写入不可变撤销事实。调用者可以让审计记录显示另一 Principal 执行了撤销；该列当前没有 FK 约束，数据库不会阻止。撤销事实应绑定 `deps.context.principalId`，而不是可篡改的输入字段。

## 修复计划

1. 将每个命令所有改变持久化结果的字段纳入 canonical request Hash；撤销的 expected version 保持 Envelope 字段，同时补齐其余 payload 字段。
2. 为 Project-owned Assignment/Grant 及相关技术表补齐 Project RLS；撤销要求精确 scope，事件、receipt 和 audit 保留同一 Project mirror。
3. 用数据库唯一索引作为并发最终裁决，并在 savepoint 内将唯一冲突转换为稳定业务结果。
4. 让 bootstrap claim 通过条件 CAS 原子消费，校验目标 Principal/justification，并追加 RoleAssigned Event。
5. 拒绝已过期有效期，撤销事实使用 Context Principal。
6. 为以上每个失败场景补充真实 PostgreSQL 回归测试，并在修复后更新本文件和 Verification Report。

## 初步结论

当前 head：`NOT APPROVED / COMMENTED`。CI 与 persistence gate 虽通过，但 R1-R6 属于影响幂等、租户隔离、审计真实性和一次性 bootstrap 语义的可复现问题；修复后必须对新的精确 head 重新 review，才能进入 merge/Issue close 阶段。
