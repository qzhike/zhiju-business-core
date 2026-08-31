# Issue 22、23、24 运行时修复验证报告

日期：2026-08-31

## 结论

受控 ReleasePublication Runtime、Authority Port、Raw Receipt provenance 和 Provider Result 最小化边界已实现并通过本地技术验证。GitHub Issue #22、#23、#24 仍保持 OPEN；本报告不替代真实 Provider、Feishu、生产、公开 HTTP、统一跨模块业务 E2E 或独立人工验收。

## 聚焦验证

命令：

```text
pnpm exec vitest run provider-result.test.ts receipt-validator.test.ts release-publication-authorization.test.ts release-publication-runtime.e2e.test.ts --no-file-parallelism --reporter=dot
```

结果：`4 files passed / 34 tests passed`。

| 用例 | 输入与断言 | 实际结果 |
|---|---|---|
| RP-ISSUE22-U-001 | Agent principal、Agent `actingFor` Human、合法 REQUEST 的 allowed Project/Context kind/expiry 失配，以及声明的 `authorizationRef` 与验证链不一致；断言授权稳定拒绝且无副作用 | PASS；Authority validator 与 Runtime E2E 均通过，派生授权引用在 Runtime 状态写入前校验 |
| RP-ISSUE22-E-001 | 同一 Release 的 Agent 负例和完整 Human → ActorSnapshot → Decision 正例 | PASS；Agent 负例无授权 Outbox/Attempt，合法 Human 链可继续正式 Attempt |
| RP-ISSUE23-U-001 | 顶层/嵌套/custom 字段、PII/Secret-like 值、允许 key 的不安全值、非对象根值和安全 ID/status | PASS；仅白名单安全字段保留，其他值删除或替换 |
| RP-ISSUE24-U-001 | 错误 Adapter Attempt type、错误 External Delivery Request、错误 Scope/Attempt/Package 和缺失 Raw Receipt | PASS；Formal Receipt 被拒绝，原状态和历史不被伪造成功结果改写 |
| RP-ISSUE24-E-001 | Human authorization → frozen Package → Publication Attempt → External Delivery Request → Adapter Attempt → Raw Receipt；ordinary provider success 负例 | PASS；缺正式 Raw binding 的 provider success 被拒绝，Attempt 保持 PENDING 且无 `PublicationSucceeded` |

## 仓库级验证

命令：

```text
pnpm clean && pnpm verify
```

结果：PASS。

- Prettier、ESLint、Typecheck：PASS。
- 全量 Vitest：42 个测试文件通过、30 个受控跳过；438 passed、299 skipped。
- Architecture：`source_roots=10`，PASS。
- Contract/Catalog：Public API 201、TypeScript payloads 201、Query Results 45、Catalog/Registry 201/201，`schema_status=FULL`，PASS。
- Compatibility：v1.0 baseline 200 operations，PASS。
- PostgreSQL/Flyway Persistence Gate：34 个测试文件、314 个测试通过；PostgreSQL 18.6 / Flyway 11.20.3，V6002 应用成功，二次迁移返回 `Schema "public" is up to date. No migration necessary.`，PASS。
- 清理：Persistence Gate 已移除临时 PostgreSQL 容器；仓库未新增临时测试脚本或测试文件。

## 未运行边界

- 真实 Identity Provider、真实 Feishu/Provider、公开 HTTP、生产数据库和外部收件人验收：`NOT RUN`。
- 统一跨模块业务 E2E、部署后验证和独立人工验收：`NOT RUN`。
- 本地 synthetic/controlled Runtime、Authority Port 和 disposable PostgreSQL 证据不升级上述边界。
