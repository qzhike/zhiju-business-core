> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-127-delivery/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-127-delivery/Task-Plan.md).

# IM-05 WI-07 Release Authorization 与 Publication 交付计划

## 目标

在当前工作树和 `origin/main` 精确基线之上，交付 Issue #127 已定义的 Release Readiness 重验、Human Authorization、Publication Attempt/Outbox、UNKNOWN/Failure、Raw Receipt 到 Formal Receipt 晋升、部分/最终完成和 append-only Recall。实现必须复用已经落地的 WI-04 Approval Bundle、WI-05 Representation、WI-06 Frozen ReleasePackage 和既有 Receipt Validator，不扩展已经存在的 201 项公共 Contract。

## 当前基线与边界

- 当前实现基线为 `3879d907fd54beebdd50fe300a3511dbd5cbcc6f`，工作树初始干净，`origin/main` 与本地 `main` 同步。
- #123、#124、#125、#126 已合入并关闭；#120 以及 #22、#23、#24 当前仍为 OPEN。
- #22、#23、#24 是本 Issue 的运行时依赖和验收来源，但 #127 的非目标明确禁止在没有各自独立证据时替它们关单。本轮会在 ReleasePublication 的权威端口和回归测试中落实相应的 actor/provenance/PII 约束，并在最终报告中分别保留它们的 Issue 状态与未覆盖边界。
- 真实 Feishu、Email、对象存储、生产凭据、公开 HTTP、外部收件人确认和独立人工客户验收不因受控 Fake/Adapter 或本地 PostgreSQL 通过而升级为 PASS。

## 成功标准

1. HL-Spec、Module-Spec-006、Module-Test-006、PostgreSQL logical model 和实际实现保持一致；不改变已有 Contract Schema/compatibility baseline。
2. Authorize 在事务内重验精确 Frozen Package、最新有效 RRS/ABS/RAS、Representation/Recipient/Destination 及上游撤销/失效；可信 Human、ActorSnapshot、AuthorizationDecision、Envelope 和 purpose/scope 必须全链一致，Agent/Service/Runtime/actingFor Agent fail-closed。
3. 每个 Destination 的 Attempt 使用稳定幂等键和原子 CAS；Outbox/Worker 在业务提交后调用 Adapter，超时只记录 UNKNOWN，reconciliation 不盲目重发。
4. 只有绑定 Release/Package/Destination/PublicationAttempt、成功且 payload/time 一致的 IntegrationGateway RawExternalReceipt 才能形成 Formal Receipt；普通 Feishu send、伪造 Raw Receipt、PII providerResult 和不完整授权链均不能推进完成。
5. 两个 Destination 的成功、失败、UNKNOWN、独立重试、部分完成、最终完成和 Recall 都保留不可变历史；Recall 不删除外部事实、不创建替代 EffectiveBinding。
6. 通过适用的 Unit/Contract/Persistence/受控 E2E/安全测试、`pnpm clean && pnpm verify` 和空库/二次 no-op/容器清理门禁；无法执行的边界明确标注 `NOT RUN`。

## 执行阶段

1. **Authority sync（已完成）**：先更新本文件、HL-Spec、Module-Spec-006、Module-Test-006、07 logical model 和 08 verification baseline，写明设计和未运行边界。
2. **Application/runtime（已完成）**：补齐窄 Authority Query Port、Human Authorization/Readiness validator、Attempt/Failure/Receipt/Completion/Recall handler、受控 Adapter/Outbox worker 和 PII 最小化。
3. **Persistence（已完成）**：新增 forward-only `V6002__release_publication_authorization_publication_receipt_recall.sql`，由 ReleasePublication owner function、immutable guards、RLS、CAS/unique constraints 保存业务事实、Attempt、Receipt、Failure、Recall 和 Event。
4. **Regression（已完成）**：先 focused Unit/Contract，再真实 disposable PostgreSQL；回放 REL-801 两 Destination timeline，并记录普通发送、PII、stale approval/readiness、late receipt、RLS/rollback 和并发负例。
5. **Review checkpoint（当前）**：展示未提交的文档、代码、迁移、测试和验证结果，等待用户检查确认；未获得确认不执行本轮 `git commit`。
6. **GitHub delivery（待用户确认）**：仅在用户确认后 stage 审核范围，执行 `git diff --cached --check`、commit、push、精确 HEAD CI/远端读回和后续 Issue/PR 操作。#22/#23/#24 不因本计划自动关闭。

## 用户可手动检查产出

- REL-801 synthetic timeline：Human authorization → Destination A success → Destination B timeout/failed → partial state → reconciliation/retry → Formal Receipt promotion → final completion or preserved partial state → ordinary-send negative → PII negative → stale-readiness negative → Recall。
- 每个事实的 exact refs/hashes/timestamps、stable key、attempt/receipt/failure/recall history 和 `NOT RUN` 边界。
- 当前工作树的文档/实现/测试 diff；提交前不产生 Git commit。

## 验证口径

- `PASS` 只用于当前命令有直接输出证据的设计、静态、Unit、Contract、Persistence 或受控 Fake/Adapter 结果。
- `SYNTHETIC / TECHNICAL ONLY` 不等同于 Provider/生产/人工业务验收。
- 真实 Provider、公开 HTTP、跨模块生产流程、生产数据库、外部收件人确认和独立人工验收保持 `NOT RUN`，除非本轮取得可复核的直接证据。

## 当前执行结果（2026-08-31）

- Authority docs 已同步：[`HL-Spec.md`](../../high-level-docs/HL-Spec.md)、[`Module-Spec-006-ReleasePublication.md`](../../module-specs/Module-Spec-006-ReleasePublication.md)、[`Module-Test-006-ReleasePublication.md`](../../module-tests/Module-Test-006-ReleasePublication.md)、[`07-postgresql-logical-model-v0.1.md`](../../high-level-docs/07-postgresql-logical-model-v0.1.md) 和 [`08-verification-baseline.md`](../../high-level-docs/08-verification-baseline.md)。实现、V6002、测试和文档已由 [`Code-Review.md`](../../reviews/legacy/issue-127-delivery/Code-Review.md) 逐项审查。
- Application/runtime 已实现 Readiness、Human Authorization、Attempt/Outbox、Failure/UNKNOWN/retry、Raw→Formal Receipt、providerResult redaction、per-destination Completion、Recall 和 exact dispatch identity guard；Persistence 已实现 forward-only V6002、六张 WI-07 业务事实表、owner function、RLS/ACL、append-only、CAS 和 Observation hash readback。
- `pnpm clean` 已通过；精确 `pnpm verify` 全部通过：普通 Vitest 为 `42 files / 30 skipped`、`432 passed / 299 skipped`，Architecture 为 `source_roots=10`，Public API/Catalog 为 201 operations 且全部 `FULL`，compatibility baseline v1.0 为 200 operations，PostgreSQL/Flyway Persistence Gate 为 `34 files / 314 tests PASS`，V6002、二次 `No migration necessary`、tag→digest、容器清理均通过。ReleasePublication focused suite 为 `6 files / 33 tests PASS`。
- PostgreSQL Handler readback 覆盖 3 个 Attempt、6 条 Observation、2 个 Formal Receipt、1 个 Failure、1 个 Recall 和 1 个 ImpactReview，并逐条验证 canonical Observation payload 的 32-byte SHA-256；RLS/ACL、append-only、CAS、rollback、跨 Scope 和 dispatch exact `objectType`/`objectId`/Scope guard 均有直接回归。
- 本轮只完成当前工作树的本地、合成和 disposable PostgreSQL 技术交付；真实 Provider、公开 HTTP、跨模块业务 E2E、生产数据库、外部收件人确认、独立人工验收以及 #22/#23/#24 的独立 Issue 交付仍为 `NOT RUN`/独立边界。本工作树尚未 commit、push、创建或关闭 PR/Issue，等待用户检查。
