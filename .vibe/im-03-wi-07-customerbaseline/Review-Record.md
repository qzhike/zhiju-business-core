# IM-03 WI-07 CustomerBaseline Review Record

## Review scope

- Issue：[#63](https://github.com/qzhike/zhiju-business-core/issues/63)
- Worktree：`galendai/im-03-wi-07-customerbaseline`
- Review base：`a087441`（当时与 `origin/main` 相同）
- Review date：2026-08-26
- Associated PR：当前无；commit、push、comment、Issue close 和 branch 删除尚未执行。

## Contract and design decisions

- Issue 验收文字中的 `KNOWN` 按当前领域闭集映射为 `PRESENT/PARTIAL`；公共 `enterprise-project@1.0` Contract 不静默加入未经审批的 `KNOWN` 值。
- 冻结公共 Contract 负责闭集枚举、引用形状、字段类型和额外字段拒绝；Handler 与 PostgreSQL CHECK 共同执行跨字段状态/材料 refs/Decision 组合约束。
- CustomerBaseline 使用 Project-owned Root、不可变 Version/Item、Human-only activation 和 INSERT-only Impact Review；激活只移动 active pointer，不原地修改旧 Context/Gap/Plan 或创建下游对象。
- Provider、公开 HTTP、真实下游 Process Manager、跨模块业务 E2E、生产和独立人工 Reference Project 验收保持 `NOT RUN`。

## Acceptance findings

| 验收面 | 结论 | 证据 |
|---|---|---|
| Agent 缺失确认 | PASS | `MISSING_CONFIRMED` 返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`，Root 不创建；Agent 的 `NOT_PROVIDED/UNKNOWN` 不被误判为缺失确认 |
| 三态与 Contract/DB 组合 | PASS | Registry 49 tests；Handler 精确状态/ref 校验；V2008 CHECK 拒绝非法 refs/Decision 组合；`PRESENT/UNKNOWN/NOT_PROVIDED` 持久化 |
| Human-only、CAS 与 Event | PASS | Human 激活；PostgreSQL 并发为 `1 COMMITTED / 1 REJECTED CONCURRENCY_CONFLICT`；Outbox 保存精确 `previousActiveRef` 且不含客户正文 |
| CB-003/CB-004 历史与影响 | PASS | 旧 Reference Edge 保留 5 条；Impact Review 为 `STALE` 且受影响下游 refs 为 3；active pointer 指向 CB-004 |
| RLS/不可变/幂等/迁移 | PASS | V2008 FORCE RLS、app-role ACL、immutable guards、deferred active-pointer guard、command receipt/audit/outbox 在真实 PostgreSQL 中通过 |
| 手动 probe | PASS（local disposable） | Agent/Human、三态、旧 refs 和 `STALE/3` 输出均实际产生并清理；独立人工验收仍 `NOT RUN` |

## Verification evidence

- `pnpm verify`：PASS。
- `pnpm test`：22 test files passed、14 条件 PostgreSQL files skipped；`351 passed / 215 skipped`。
- `pnpm persistence:gate`：PostgreSQL 18.6 / Flyway 11.20.3；17 files、`229 passed / 0 failed`；empty migrate、second migrate no-op、V2008 applied、container removed。
- `pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm architecture`、`pnpm contracts:check`：均 PASS；公共 Catalog/Registry 为 200，compatibility findings 为 0。
- Manual probe 输出：Agent `MISSING_CONFIRMED -> REJECTED PROJECT_MISSING_CONFIRMATION_REQUIRED`；CB-003 `PRESENT/UNKNOWN/NOT_PROVIDED`；CB-004 后 old refs `5`、Impact `STALE/3`，active version 为 CB-004。

## Delivery gates still pending

- 用户确认当前工作树变更后，才能执行 Git commit。
- commit 后必须读取精确 head，创建/更新 PR（如适用），等待并读取 exact-head CI，并发布/读回 Issue comment。
- 只有在 comment、ancestry、Issue 状态和 branch 目标均核对后，才关闭 Issue 63 并删除目标 branch；不能把 merge 或 `Refs/Closes` 文本单独当作关闭证据。

## Review disposition

当前实现与 Issue #63 的自动化和 disposable 验收边界一致，未发现阻塞性代码审查问题。Review record 需要在精确 commit、远端 comment、Issue close 和 branch 删除后补写最终 SHA/状态回读。
