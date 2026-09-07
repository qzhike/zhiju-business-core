> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-22-24-runtime-fix/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-22-24-runtime-fix/Task-Plan.md).

# Issue 22、23、24 运行时修复计划

## 目标

在不扩大到真实 Provider、真实 Feishu、生产环境或跨模块部署验收的前提下，修复并验证以下三个运行时边界：

1. Issue #22：Release Authorization 必须在 Runtime 中验证 Envelope actor、ActorSnapshot、AuthorizationDecision、Scope、Purpose、有效期和撤销状态；Agent 及 Agent actingFor Human 不得产生授权或后续副作用。
2. Issue #23：Formal Receipt 的 `providerResult` 采用明确的安全字段白名单和递归安全值规则；未知字段、PII、秘密和不安全值不得越过 Receipt/Event/Error/Log 边界。
3. Issue #24：Formal Receipt 必须由完整的 Release Authorization、冻结 Package、Publication Attempt、External Delivery Request、Adapter Attempt 和 Raw External Receipt 链路产生；普通 Feishu 发送成功、`messageId` 或伪造/不完整 Raw Receipt 不得形成正式 Release 事实。

## 当前假设与边界

- 本次修复针对 `modules/release-publication` 的受控 Runtime、Handler、验证器和对应测试；不把本地合成测试宣称为真实 Provider、真实 Feishu、生产或统一跨模块 E2E。
- 保留历史 `.vibe/issue-5-runtime-scope-transfer` 文档的历史语义，不将其改写为本次完成证明。
- 不修改已应用的 Flyway migration；如果当前持久化代码已经具备数据库授权门禁，本次只补应用层缺口和可复现的最小回归证据。
- 不创建测试遗留脚本或测试数据文件；如需临时探针，执行后立即删除。

## 实施步骤与可手测产出物

### 里程碑 1：权威契约同步

- 更新 `HL-Spec.md`、`Module-Spec-006-ReleasePublication.md` 和 `Module-Test-006-ReleasePublication.md`，记录本次三个 Issue 的运行时规则、测试场景和未运行边界。
- 可手测产出物：用户可从三份文档定位 #22、#23、#24 的规则与验证入口。
- 状态：已完成。三份权威文档已先于实现同步，并保留真实 Provider/Feishu、生产、公开 HTTP、统一跨模块 E2E 和人工验收的 `NOT RUN` 边界。

### 里程碑 2：最小实现修复

- Runtime 不再将未授权 Release 作为可发布 Release；所有 Attempt、Receipt、Failure、Completion、Dispatch/Reconcile 路径均要求可信 `authorizationRef`。
- 授权链补齐 Command Envelope 类型、Release Scope/Project、Context expiry，以及 Agent principal 与 `actingFor` 的 fail-closed 检查；错误对外保持安全且稳定。
- Provider Result 改为安全字段白名单，递归处理对象和数组，并对允许字段的值执行安全格式校验。
- Raw Receipt 增加并验证精确的 `externalDeliveryRequestRef` 和 Adapter Attempt 类型/绑定。
- 可手测产出物：受控 Runtime 的正向正式链路和三个 Issue 的负向 counterexample 测试。
- 状态：部分完成。本次已修复 Persistence Recall Handler：从当前 Recall AuthorizationDecision 解析其 exact ActorSnapshot，不再把 Release 原始授权 ActorSnapshot 当作当前主体；未修改已应用 Migration 或公共 Contract Schema。#23 Provider Result 与 #24 Adapter Attempt provenance 在 PR #141 合并后的直接复验中仍存在失败反例，继续独立保持 OPEN。

### 里程碑 3：回归与边界报告

- 顺序执行聚焦测试、类型检查和仓库验证；必要时先清理 `dist`，避免旧构建产物掩盖错误。
- 记录每个测试的输入、预期输出、实际输出和 Provider/生产/人工未运行边界。
- 可手测产出物：`Module-Test-006-ReleasePublication.md` 中的可复现实验命令和结果。
- 状态：已完成。聚焦套件为 `4 files / 35 tests PASS`；Persistence Gate 为 PostgreSQL 18.6/Flyway 11.20.3、`34 files / 314 tests PASS`，二次迁移为 `No migration necessary`；新鲜 `pnpm clean && pnpm verify` 为 `42 files passed / 30 skipped`、`439 passed / 299 skipped`。不同 Human、主体/范围/用途/载荷 hash、过期/撤销、Agent/`actingFor` 及无业务副作用均已写回 Module-Test 和 Verification-Report。

## Git 边界

- 本任务不自动执行 `git commit`。完成修改和验证后先请用户检查 diff；只有收到明确确认后才进入提交范围审计和 commit。
- 只触及本任务相关的 `.vibe`、ReleasePublication 源码、测试和必要 fixture；保留其他 worktree 与无关变更。

## 当前交付结论

- #22：受控 Runtime/Authority Port 已拒绝非 Human principal、Agent `actingFor` Human、错误 Context kind/scope/expiry 和不一致的 ActorSnapshot/AuthorizationDecision 链；授权失败不产生授权、Attempt 或 Outbox 副作用。
- #22 Recall：已在当前工作树修复并通过受控 PostgreSQL 验证。当前 Recall 从当次 AuthorizationDecision 解析并使用其 exact ActorSnapshot；Release 原始授权 ActorSnapshot 只保留为历史。不同 Human 的有效 Recall、主体/范围/用途/command/payload hash、过期/撤销、Agent/`actingFor` 负例及所有拒绝路径的 Persistence readback 均通过。
- #23：`providerResult` 的根对象字段 allowlist 已实现，但允许字段仍可原样携带姓名式或客户标识式值；修复后直接反例返回 `redactedPaths=[]`。Issue #23 保持 OPEN，本计划不将该边界标记为通过。
- #24：External Delivery Request、Adapter Attempt 类型和 Scope 检查已实现，但未登记的伪造 `integration.adapter_attempt.objectId` 仍可铸造 Formal Receipt。Issue #24 保持 OPEN，本计划不将该边界标记为通过。
- #22 Recall 的受控本地技术证据已通过；文档对齐 head `87704a35838f2db529cc2b992eb3f5e33675fe05` 的 GitHub `verify` run `33391359556` 成功，PR #142 已以 merge commit `e9590a9ec9dbc706b42233ed76068c0fdd6fd729` 合入 `main`，Issue #22 已自动关闭。commandVersion mismatch、authentication-context mismatch 和 Identity Authority Port 异常不泄漏回归尚未单独执行，不升级为 PASS。Issue #23/#24 继续保持 OPEN；真实 Identity Provider、Provider/Feishu、生产、公开 HTTP、统一跨模块业务 E2E 和独立人工验收仍需分别验证。
