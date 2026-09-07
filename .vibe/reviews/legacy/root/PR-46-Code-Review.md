> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/root/PR-46-Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/root/PR-46-Code-Review.md).

# PR #46 Code Review

## 审查范围

- PR：`#46 feat(identity-policy): command atomic transaction, idempotency, CAS and audit (IM-02 WI-06 / #34)`
- 审查 head：`7c8ea1a36b222e3c3407a86f81fe023a7bb7bce1`
- 目标分支：`galendai/33-im-02-wi-05-identity-policy-model`
- 原始 Issue：`#34 [IM-02][WI-06] 实现 Command 原子事务、幂等、CAS 与 Audit`
- 权威文档：`HL-Spec.md`、IdentityPolicy Module Spec/Test、PostgreSQL 逻辑模型、WI-06 Issue/Runbook

## 成功标准

1. 对 PR 最新 head 的实际 diff、权威约束和失败场景进行独立语义审查。
2. 用针对性负向与并发反例复现发现的问题，不能仅依据现有 CI。
3. 修复前先同步对应 Spec、测试文档和回归用例；代码改动保持最小范围。
4. 聚焦测试、全量 `pnpm verify`、`git diff --check` 与 exact-head CI 均通过。
5. 修复记录发布到原 PR comment；本审查文档纳入修复提交。
6. 最新 head 复审无阻塞问题后合并 PR，并显式关闭 Issue #34；最终状态重新查询确认。

## 审查进度

- [x] 确认本地工作树、PR head、base、CI 和关联 Issue。
- [ ] 读取权威 Spec、Issue 验收条件和全部变更。
- [ ] 运行基线验证及针对性反例。
- [ ] 记录并修复发现。
- [ ] 发布 PR comment、提交、推送并等待 exact-head CI。
- [ ] 复审、合并 PR、关闭 Issue 并复核。

## Findings

### F-01（P1）：并发幂等 Claim 不是原子操作

`executeIdentityCommand` 先在独立事务读取 Receipt，再在新事务插入 Claim。两个同 key/hash 请求可同时读到不存在；loser 最终得到 PostgreSQL `23505`，违反第 17.2 节和 PG-U-009 的“返回原结果”。

### F-02（P1）：改写已应用 Migration

PR 直接修改 `V1000__identity_policy_technical_tables.sql`。已有数据库的 Flyway history 会发生 checksum 漂移，且不会自动获得新增列。必须恢复 V1000，并用 forward-only V1002 增加列。

### F-03（P1）：受信事务上下文未绑定持久化 Envelope

Receipt/Audit 使用 Envelope 的 Principal、ActorSnapshot、AuthorizationDecision、Enterprise/Project 与 Correlation，但 runner 未验证它们和 `IdentityTransactionContext` 一致。调用方可在合法 RLS Context 内写入错误或伪造的审计归因。

### F-04（P1）：CAS 与 REJECTED 结果未满足 Envelope/版本契约

`casPrincipalStatus` 接受任意 target/expectedVersion，未绑定 Envelope，且通过 `Number(expectedVersion) + 1` 更新 PostgreSQL `bigint`，在大版本下丢失精度。REJECTED receipt 的 result payload 也没有保存 Issue #34 要求的 `currentAggregateVersion`。

### F-05（P1）：事务类型与回滚用例未覆盖 Reference Edge

Issue #34 要求 Aggregate、Receipt、Audit、Reference Edge 与 Outbox 的成功/回滚边界可断言，但 `IdentityPolicyDb` 没有暴露本模块 `reference_edge`，现有故障注入测试也未插入或检查 Reference Edge；PR 正文的覆盖声明缺少运行证据。

## 修复与验证记录

- F-01：把先查后插改为数据库唯一约束上的 `INSERT ... ON CONFLICT DO NOTHING`；并发 loser 在同一事务读取 winner 的已提交 Receipt 并返回 `DUPLICATE`。反例确认 body 仅执行一次、Receipt 仅一行。
- F-02：恢复 V1000 原内容；新增 forward-only `V1002__platform_command_receipt_expected_version.sql`。相对 PR base 的 V1000 无内容差异，V1002 在 Flyway history 中成功。
- F-03：在任何数据库访问前绑定 Envelope 与受信事务上下文；6 类归因/Scope/Correlation 错配均稳定拒绝且不产生 Receipt/Audit。
- F-04：CAS 强制匹配 Envelope target/expected version，使用 `BigInt` 精确递增；REJECTED canonical result、首次返回与重放均保留 current version。
- F-05：把 `reference_edge` 纳入 IdentityPolicy transaction 类型，并在 Outbox 后故障用例中断言 Reference Edge 同步回滚。

验证：

- `pnpm typecheck`：`PASS`。
- `pnpm persistence:gate`：PostgreSQL 18.6 / Flyway 11.20.3，8 files / 133 tests `PASS`；第二次 migrate no-op。
- `pnpm clean && pnpm verify`：format、lint、typecheck、19 files / 339 tests、architecture、public API/types、Catalog/Registry 200/200、compatibility、Persistence 8 files / 133 tests 全部 `PASS`。
- `git diff --check`：`PASS`；PR base 与当前修复后的 V1000 内容相同。

边界：Outbox 发布、Inbox 消费、外部 Provider、HTTP/E2E 与人工验收仍为 `NOT RUN`，不在 Issue #34 范围内。

## 最新 Base 集成

修复 push 后，PR base 从 `a47b742` 前进到 `848c1e0`，包含 WI-03、WI-04 与 WI-05 的 review 修复及其 `main` 集成。只读 `git merge-tree --write-tree` 确认实现可以自动合并，仅 IdentityPolicy Module Spec/Test 存在内容冲突。集成必须保留 base 的 Scope/Snapshot/RLS 权限修复与验证证据，同时保留本 PR 的 WI-06 原子 Claim、Context 绑定、精确 CAS、REJECTED current version、forward-only V1002 和回归记录；合并后重新执行 `pnpm clean && pnpm verify`，并等待新 exact-head CI。

首次组合树验证复现兼容回归：Unit/Contract 339 tests `PASS`，Persistence 141 tests 中 WI-06 runner 有 9 项因 probe 登录缺少 `platform_context_establisher` membership 返回 `42501`，并发用例因首请求未进入 body 随之超时。base 的双角色事务模型是安全修复，不能回退；WI-06 fixture/runbook 必须同步为 NOINHERIT 双角色 membership，再重跑全量 Gate。

已将 WI-06 probe 修订为同时持有 `platform_context_establisher` 与 `identity_policy_app` membership；未扩大 app role 权限。修复后 `pnpm clean && pnpm verify` 完整 `PASS`：Unit/Contract 339 tests、Persistence 8 files / 141 tests、architecture、public API/types、Catalog/Registry 200/200 与 compatibility 全部通过；V1002 成功且第二次 migrate no-op。Docker Hub 首次 pull 曾返回一次 `EOF`，自动重试后成功，不降低最终 Gate 结论。
