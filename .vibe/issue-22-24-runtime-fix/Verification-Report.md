# Issue 22、23、24 运行时修复验证报告

日期：2026-08-31

## 结论

PR #141 的 Authorize、Authority Port、Raw Receipt provenance 和 Provider Result 受控证据仍然有效；合并后发现的 Recall ActorSnapshot 绑定缺陷已修复并完成新鲜验证。当前报告结论为 `LOCAL CONTROLLED TECHNICAL PASS / GITHUB RE-CLOSEOUT PENDING`：Persistence Recall Handler 现在从当前 Recall AuthorizationDecision 解析其 ActorSnapshot，原始 Release ActorSnapshot 只保留为历史。该报告不替代真实 Provider、Feishu、生产、公开 HTTP、统一跨模块业务 E2E 或独立人工验收。

## 合并后复核缺陷

- 发现位置：`modules/release-publication/src/release-publication-handlers.ts` 的 `handleRecallRelease` 及 `actorSnapshotRefForRecall`。
- 错误行为：Recall 使用 `release_record.authorization_actor_snapshot_ref`，即原始 Release Authorization 的历史 ActorSnapshot。
- 正确行为：先通过 Identity Authority 精确读取当前 Recall `AuthorizationDecision`，再加载该 Decision 引用的 exact ActorSnapshot，并与当前 Envelope/Transaction Context 的 actor、主体、Scope、Purpose、command identity、payload/authentication hash、expiry 和 revocation 逐项校验。
- 影响：不同但有效的 Human 可能无法执行紧急 Recall；原始 ActorSnapshot 只能作为历史证据，不能作为当前 Recall 主体来源。
- 当前状态：修复已完成；Recall Handler/Persistence 回归与新鲜仓库验证已通过。旧的 `4 files / 34 tests` 和 `438 passed` 仅作为历史基线，当前结果为 `4 files / 35 tests` 和 `439 passed`。

## 聚焦验证

命令：

```text
pnpm exec vitest run provider-result.test.ts receipt-validator.test.ts release-publication-authorization.test.ts release-publication-runtime.e2e.test.ts --no-file-parallelism --reporter=dot
```

结果：当前为 `4 files passed / 35 tests passed`，包含当前 Recall 主体切换回归。

| 用例 | 输入与断言 | 实际结果 |
|---|---|---|
| RP-ISSUE22-U-001 | Agent principal、Agent `actingFor` Human、合法 REQUEST 的 allowed Project/Context kind/expiry 失配，以及声明的 `authorizationRef` 与验证链不一致；断言授权稳定拒绝且无副作用 | PASS；Authority validator 与 Runtime E2E 均通过，派生授权引用在 Runtime 状态写入前校验 |
| RP-ISSUE22-E-001 | 同一 Release 的 Agent 负例和完整 Human → ActorSnapshot → Decision 正例 | PASS；Agent 负例无授权 Outbox/Attempt，合法 Human 链可继续正式 Attempt |
| RP-ISSUE23-U-001 | 顶层/嵌套/custom 字段、PII/Secret-like 值、允许 key 的不安全值、非对象根值和安全 ID/status | PASS；仅白名单安全字段保留，其他值删除或替换 |
| RP-ISSUE24-U-001 | 错误 Adapter Attempt type、错误 External Delivery Request、错误 Scope/Attempt/Package 和缺失 Raw Receipt | PASS；Formal Receipt 被拒绝，原状态和历史不被伪造成功结果改写 |
| RP-ISSUE24-E-001 | Human authorization → frozen Package → Publication Attempt → External Delivery Request → Adapter Attempt → Raw Receipt；ordinary provider success 负例 | PASS；缺正式 Raw binding 的 provider success 被拒绝，Attempt 保持 PENDING 且无 `PublicationSucceeded` |

## Recall 修复后的 Handler/Persistence 验证

| 用例 | 输入 | 预期输出 | 当前结果 |
|---|---|---|---|
| RP-ISSUE22-R-001 | 原始授权 Human A/ActorSnapshot A；当前 Recall 使用不同 Human B 和 Decision B，Decision B 精确引用 ActorSnapshot B | 有效 Recall 成功；只追加一个 Recall、ImpactReview、Event 并推进 Release；不复用 A | `PASS — PostgreSQL Handler；Decision B → ActorSnapshot B，Release 为 RECALLED@14，A 保留为历史` |
| RP-ISSUE22-R-002 | ActorSnapshot/Decision principal 不一致 | 稳定拒绝，无 Recall、ImpactReview、Event 或 Release 状态副作用 | `PASS — RELEASE_AUTHORIZATION_INVALID；Release 保持 RELEASED@13，无业务事实新增` |
| RP-ISSUE22-R-003 | Scope、Purpose、command type/version 或 payload hash 不匹配 | 稳定拒绝，无业务副作用 | `PASS — foreign Scope、Purpose、command、payload hash 矩阵均拒绝且无副作用` |
| RP-ISSUE22-R-004 | Decision 过期或撤销 | 稳定拒绝，无业务副作用 | `PASS — expired/revoked 均拒绝且无 Recall/ImpactReview/Event` |
| RP-ISSUE22-R-005 | Agent 或 Agent `actingFor` Human | 稳定拒绝，不得提权，无业务副作用 | `PASS — Agent Context 与 Agent actingFor Human 均 fail-closed` |
| RP-ISSUE22-R-006 | 任一 Recall 授权拒绝场景 | 不产生 Recall、ImpactReview、ReleaseRecalled Event 或 Release 状态/版本变化 | `PASS — 每个拒绝路径均读回 release_recall=0、impact_review=0、无 ReleaseRecalled outbox event；Release 保持 RELEASED@13` |

## 仓库级验证

命令：

```text
pnpm clean && pnpm verify
```

结果：PASS。

- Prettier、ESLint、Typecheck：PASS。
- 全量 Vitest：42 个测试文件通过、30 个受控跳过；439 passed、299 skipped。
- Architecture：`source_roots=10`，PASS。
- Contract/Catalog：Public API 201、TypeScript payloads 201、Query Results 45、Catalog/Registry 201/201，`schema_status=FULL`，PASS。
- Compatibility：v1.0 baseline 200 operations，PASS。
- PostgreSQL/Flyway Persistence Gate：34 个测试文件、314 个测试通过；PostgreSQL 18.6 / Flyway 11.20.3，V6002 应用成功，二次迁移返回 `Schema "public" is up to date. No migration necessary.`，PASS。
- 清理：Persistence Gate 已移除临时 PostgreSQL 容器；仓库未新增临时测试脚本或测试文件。

## 未运行边界

- 真实 Identity Provider、真实 Feishu/Provider、公开 HTTP、生产数据库和外部收件人验收：`NOT RUN`。
- 统一跨模块业务 E2E、部署后验证和独立人工验收：`NOT RUN`。
- 本地 synthetic/controlled Runtime、Authority Port 和 disposable PostgreSQL 证据不升级上述边界。
