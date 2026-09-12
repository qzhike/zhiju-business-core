# PR #142 代码审查结论

版本：v1.0

日期：2026-08-31

审查对象：GitHub PR #142，精确 head `14598cc63ad935337b61c386336537a60c38959e`，base `main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d`。

结论：`NOT APPROVED — CHANGES REQUIRED`。Issue #22 的核心 Recall 修复方向正确，Handler 现在从当前 AuthorizationDecision 解析其 ActorSnapshot，distinct Human、授权拒绝与 PostgreSQL 无副作用回归均通过；但 PR 同时修改了 #22/#23/#24 的权威记录，并把仍有直接失败反例的 #23/#24 重新声明为 PASS。另有测试覆盖声明和 Git 交付状态与当前事实不一致。修正这些权威/测试记录前不应合并或自动关闭 #22。

## 1. 审查发现

### F-001 — 权威文档把仍失败且保持 OPEN 的 #23/#24 重新写成 PASS

严重级别：`P1 / BLOCKER`

PR #142 的实现范围只修 Issue #22；变更文件没有包含 `provider-result.ts`、`receipt-validator.ts` 或其针对 #23/#24 反例的修复。但本 PR 修改的组合权威记录仍声明：

- `Task-Plan.md`：#23 的 allowlist 会删除/替换不安全值，#24 只接受完整 Adapter 来源链，并汇总为 Authorize/Receipt/Provider/Recall 受控证据已通过。
- `Verification-Report.md`：声称 PR #141 的 Provider Result 和 Raw Receipt provenance 证据仍有效，并将 #23/#24 用例列为 PASS。
- `Module-Spec-006`：声称 Authorize、Provider Result、Formal Receipt 和 Recall 均已有实现与本地技术证据。
- `Module-Test-006`：把 RP-ISSUE23-U-001、RP-ISSUE24-U-001/E-001 继续标为 PASS，并声称 #22–#24 Runtime 延伸已经补齐。

这些声明被 PR #142 exact head 上的直接反例推翻：

1. #23：输入 `{ messageId: "AliceCustomer", providerStatus: "AliceCustomer", reasonCode: "BobBuyer", status: "CustomerName" }` 后，实际输出原样保留全部值且 `redactedPaths=[]`。
2. #24：合法 Publication Attempt ID 为 `018f22e2-7c15-7b2e-8d86-2de956a9d820`，Raw Receipt 使用未登记的伪造 `integration.adapter_attempt` ID `018f22e2-7c15-7b2e-8d86-2de956a9d899`；实际 `recordFormalReceipt(...)` 仍返回 `ok: true`。
3. GitHub API 当前读回 #23/#24 均为 `OPEN`，对应失败评论仍是最新验收记录。

影响：若 PR 合并，HL/Module Spec/Test 会在 `main` 上把已知失败条件写成 PASS，破坏 #23/#24 和父 Issue #120 的权威验收边界，也让 #22 的窄修复错误背书另外两个未完成 Issue。

修复要求：

- PR #142 的权威修改必须收敛到 #22 Recall。
- #23/#24 必须明确保持 `OPEN / FAILED COUNTEREXAMPLE / NOT ACCEPTED` 或与当前证据等价的状态。
- 删除或订正“PR #141 Provider/Raw provenance 证据仍有效”“#22–#24 Runtime 延伸已补齐”等被反例推翻的陈述。
- 保留 #23/#24 的复验评论链接和直接反例，不能用本 PR 的 35 个聚焦测试覆盖它们。

### F-002 — 文档声称覆盖 commandVersion、authentication context 和安全 Port 异常，但测试没有执行

严重级别：`P2 / IMPORTANT`

当前实现确实保留了以下检查：

- Decision `commandVersion` 必须等于当前 Recall command version。
- Decision 与 ActorSnapshot 的 `authenticationContextHash` 必须一致。
- Identity Authority Port 抛出异常时转换为稳定、安全的业务错误，不回显任意异常文本。

但是新增测试实际只变异了 command type、payload hash、Scope、Purpose、expiry/revocation、principal 和 Agent/actingFor：

- `tests/persistence/release-publication.test.ts` 没有错误 `commandVersion` 输入。
- Unit/Persistence 测试都没有错误 `authenticationContextHash` 输入。
- Unit/Persistence 测试都没有让 `getAuthorizationDecision` 或 `getActorSnapshot` 抛出带敏感文本的异常并断言安全错误。

权威文档却把 command type/version、payload/authentication hash 和安全 Port 错误边界写成已自动化 PASS。当前 suite 即使未来误删这三项检查，也可能保持绿色。

修复要求：

- 增加错误 commandVersion 的 Handler/Persistence 负例和无副作用 readback。
- 增加 Decision/ActorSnapshot authenticationContextHash mismatch 负例。
- 增加两个 Identity Port 分别抛出包含敏感字符串的异常的负例，断言返回稳定错误且错误、Receipt/Audit/日志不回显原文。
- 或者在本 PR 中把未执行项准确降级，不得继续声明完整覆盖。

### F-003 — 必需权威文档仍记录“尚未 commit/push/创建 PR”

严重级别：`P2 / IMPORTANT`

PR head 中多份当前状态记录仍写着：

- 当前分支尚未 commit/push 或创建 follow-up PR。
- Issue #22 的提交、PR 和关闭尚未执行。
- 当前工作树等待用户确认。

但审查对象已经是已推送 commit `14598cc6`、GitHub PR #142，且 exact-head CI 已成功。如果按当前 head 合并，这些事实会作为“当前权威记录”进入 `main`，立即过期，并违反 Issue #22 要求 HL-Spec、Module Spec/Test 与实现保持一致的关闭条件。

修复要求：

- 把已提交、已推送、PR #142 已创建、exact-head CI 状态写成当前可核验事实。
- Issue #22 在合并前仍为 OPEN；不得提前写成 CLOSED。
- 合并后的最终关闭/merge commit/main ancestry 只能在实际发生后通过 GitHub 验收记录或后续授权的文档同步完成，不能预写。

## 2. 核心实现复核

已确认的正确行为：

- `handleRecallRelease` 不再调用 `actorSnapshotRefForRecall(row)`，也不再把 Release 原始授权 ActorSnapshot 当作当前 Recall 主体。
- `validateHumanAuthorizationChain` 先按请求中的 exact ContentAddressed AuthorizationDecisionRef 查询 Decision，再在 Recall 输入没有 ActorSnapshotRef 时使用 Decision 自己引用的 ActorSnapshotRef。
- 解析后的 ActorSnapshot 继续与 Context actorSnapshotId、Human principal、authorizingHumanRef、Release Scope、Decision principal、command、purpose、payload hash、authentication context、expiry/revocation 精确校验。
- Identity Port 查询异常被转换为稳定业务错误。
- PostgreSQL 回归证明 Human A 原始授权后，Human B 可以凭自己的当前 Decision/ActorSnapshot 完成 Recall；原始 ActorSnapshot A 仍保留在 Release 历史中。
- 拒绝矩阵读回 Release 仍为 `RELEASED@13`，Recall/ImpactReview/ReleaseRecalled Event 数量均为 0；有效 Human B Recall 才推进 `RECALLED@14`。

在本轮审查范围内，没有发现 #22 核心实现的新授权绕过。

## 3. exact-head 验证

审查环境：独立 detached worktree，Node `v24.19.0`，pnpm `11.19.0`。

执行：

```text
pnpm install --frozen-lockfile --offline
pnpm clean && pnpm verify
pnpm exec vitest run provider-result.test.ts receipt-validator.test.ts release-publication-authorization.test.ts release-publication-runtime.e2e.test.ts --no-file-parallelism --reporter=dot
```

结果：

- Focused Vitest：`4 files / 35 tests PASS`。
- Format、ESLint、Typecheck：PASS。
- 普通 Vitest：`42 passed / 30 skipped files`，`439 passed / 299 skipped tests`。
- Architecture：PASS，`source_roots=10`。
- Public API/Catalog/Registry：`201/201 FULL`。
- Compatibility：v1.0 baseline 200 operations，PASS。
- PostgreSQL 18.6 / Flyway 11.20.3：`34 files / 314 tests PASS`。
- 空库 migration：PASS；第二次 migration：`No migration necessary`。
- 临时 PostgreSQL 容器：已删除。
- `git diff --check origin/main...14598cc6`：PASS。

绿色 Gate 证明当前已有测试通过，不覆盖 F-001 的两个直接失败反例，也不能把 F-002 未执行的测试声明升级为 PASS。

## 4. 审查边界

- 真实 Identity Provider、真实 Feishu/Provider、公开 HTTP、生产、统一跨模块业务 E2E、外部收件人和独立人工验收继续为 `NOT RUN`。
- 本轮没有修改 PR 代码或权威文档，没有执行 commit、push、merge、Issue closure 或分支清理。
- 按当前权限，本地形成审查记录；未向 GitHub 提交 review、comment 或状态变更。
