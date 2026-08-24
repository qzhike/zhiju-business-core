# PR #50 WI-10 Review 与修正计划

状态：`IN PROGRESS / INITIAL REVIEW COMMENTED / BASE-INTEGRATION ACL+SCOPE REPAIR VERIFIED / INTEGRATED FULL VERIFY PASS / EXACT-HEAD DELIVERY PENDING`

## 1. 范围与权威

本计划针对 PR #50（IM-02 WI-10）中 IdentityPolicy owning schema 的 Outbox Dispatcher、Inbox Consumer、真实 PostgreSQL replay/quarantine 证明和手动 ACK-loss runbook。高层约束以 [`../high-level-docs/HL-Spec.md`](../high-level-docs/HL-Spec.md)、PostgreSQL 逻辑模型 [`../high-level-docs/07-postgresql-logical-model-v0.1.md`](../high-level-docs/07-postgresql-logical-model-v0.1.md)、IdentityPolicy Module Spec 与 Module Test 为准。

本次修正保留以下边界：不接入生产 message broker、飞书或邮件 Provider；不宣称 exactly-once；真实外部副作用、生产运行和人工业务验收继续记录为 `NOT RUN`。真实 PostgreSQL 只证明本地持久化、lease/fencing、Inbox 幂等和 Quarantine 约束。

## 2. 必须先固定的失败场景

1. 入站 payload 使用 canonical JSON + SHA-256 重新计算；带任意 32-byte hash 的事件不得执行 target。
2. Enterprise 与 Project 必须 exact mirror；Project 必须属于 transaction context 的 `allowedProjectIds`，越权事件不得执行 target。
3. 同 consumer/eventId/hash 并发消费只能产生一个业务提交；败者读取已提交结果并返回 `DUPLICATE`，不得泄漏数据库唯一键异常。
4. `LEASED` 且 `lease_until` 已过期的 Outbox 事件必须可由新 owner 回收；旧 token 仍不能 ACK 或写入失败状态。
5. retry/dead-letter 判断必须使用数据库 `attempt_count`，不能由调用方伪造 attempt；第一次 claim 不能直接进入 `DEAD`。
6. DEAD 恢复成功操作必须有不可变 Audit；operator reason 必须被记录，Audit 失败不能留下未审计的已恢复状态。
7. Scope conflict 的 Event `projectId` 未经 Context allow-list 验证前，不得进入 Command Envelope 或 RLS 写入 Scope；不允许的 Project 必须以当前 Enterprise、`project_id=NULL` 的安全 Quarantine 记录落库。

## 3. 修正顺序

1. 先同步 HL-Spec、Module Spec、Module Test 和本计划。
2. 先补真实 PostgreSQL 回归场景，再修改 Dispatcher/Inbox 实现。
3. 执行 focused messaging gate、全量 `pnpm verify`、`git diff --check`，区分自动化 `PASS` 与外部/人工 `NOT RUN`。
4. 发布修正后的 exact-head review comment；只有新 head 通过语义复审、CI 和交付文档检查后才进入合并/Issue close。

## 4. 当前证据

- PR #50 initial review：`COMMENTED`，review ID `5006783981`，绑定 head `f2e24f6b467f586e6a438fa0a6dd1eb1cc5e6831`。
- 初始修正提交在未集成最新 base 时的 `pnpm typecheck && pnpm persistence:gate`：真实 PostgreSQL 18.6 + Flyway 11.20.3 下 12 个测试文件、161 个测试通过，二次 migrate 为 no-op；测试已改用 canonicalization v1 + SHA-256，并覆盖 canonical hash、Project Scope、并发 replay、过期 lease、服务端 attempt_count 和 Audit failure 反例。
- 真实 PostgreSQL 反例已确认：非法 hash 被 `PROCESSED`、foreign Project 被 `PROCESSED`、并发 replay 一方泄漏 `23505 command_receipt_idem_unique`、过期 lease 无法重新 claim。
- 最新 base `0fc8e464…` 已通过正常 merge 集成到本地 HEAD `fa0ef010…`；首次完整 verify 的静态阶段通过，但真实 PostgreSQL gate 因 `wi10_probe_ip` 缺少 `platform_context_establisher` membership 失败 9 个 messaging 用例，错误为 `42501 permission denied to set role`。该失败属于 WI-03 角色 fixture 与实现路径不一致。
- 修复 fixture 后，第二次 gate 暴露并修复了未经验证 Event `projectId` 进入 WI-09 Command Envelope 的问题；当前已用安全 Quarantine Scope（不允许的 Project 以 `NULL` 落库）覆盖。
- 重新执行 `pnpm typecheck` 后，`pnpm persistence:gate` 已通过：PostgreSQL 18.6 / Flyway 11.20.3、`12 files / 176 tests PASS`、空库迁移、二次 migrate no-op、容器清理均通过。exact-head CI、最终 review comment、PR 合并和 Issue close 仍待完成。
- 随后执行 `pnpm clean && pnpm verify` 已通过：Prettier、ESLint、TypeScript、Vitest `20 passed | 10 skipped` / `341 passed | 163 skipped`、architecture `source_roots=10`、public API/generated types/Catalog `200/200`、compatibility `findings=0`，以及 PostgreSQL 18.6 / Flyway 11.20.3 persistence `12 files / 176 tests PASS`；二次 migrate no-op，容器已清理。
