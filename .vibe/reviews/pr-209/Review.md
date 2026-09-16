# PR #209 独立审查

## 第 1 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`de52cd2b2d6b517fce0dfa56e0f30604640dea83`
- Base SHA：`1233a730499c1a9484ac601209aaf38386373fb9`
- PR：[#209](https://github.com/qzhike/zhiju-business-core/pull/209)
- Work item：[#208](https://github.com/qzhike/zhiju-business-core/issues/208)（T2 implementation）
- 审查日期：2026-09-16

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #208、PR 最新 head 与实际 diff、Issue #206 已批准设计、受影响 Module Spec/Test、IdentityPolicy 授权边界、Domain 与 PostgreSQL 权威章节、关键实现与 persistence tests，以及当前 revision 的 CI 和本地完整验证证据；未把实现者的 PR 描述或评论当作正确性依据。

## 阻断发现

### 1. `mark_task_ready` 未在提交点重验 `validUntil`，长事务可用过期判断完成 READY 转换

权威契约要求 `now < valid_until` 使用**提交点受信时钟**，并明确规定长事务必须在提交点重验，不能凭事务开始时刻通过（`Module-Spec-003-TaskExecution.md:1136`、`:1165`；`TE-P206-012`）。

当前实现只在 `modules/task-execution/src/business/task-ready-transition.ts:219` 读取一次 `now`，并在 `:220` 做一次过期检查。此后还会执行 Policy 重新解析（`:236-260`）、Task/definition 读取、完整依赖/输入/blocker 重观察（`:328-352`）和 DRAFT-only CAS（`:370-398`），CAS 前或事务提交前都没有再次读取受信时钟。因此，判断在第一次检查时尚未过期、但在后续 owning reads 或 CAS 前跨过 `validUntil` 时，当前代码仍会把 Task 转为 `READY` 并发布事件。

现有测试没有覆盖该接受条件：`tests/persistence/task-readiness.test.ts:3327-3330` 明确把“长事务跨过 `validUntil`”标为 `NOT RUN`，但 `.vibe/module-tests/Module-Test-003-TaskExecution.md:271` 和 PR 描述却把 `TE-P206-012` 记为 `PASS`。Issue #208 只允许 COMPLETED-dependency 和 blocking InformationRequest 两个依赖不可达分支保持 `NOT RUN`，不允许省略本分支。

要求：在 READY 的不可逆 CAS/提交前重新取得受信时间并拒绝 `now >= validUntil`（同时保持授权/Policy 的既有 fail-closed 顺序），补充一个可确定推进时钟或延迟 owning read 的回归测试，证明跨界时无 Root、Receipt 成功结果、Edge 或 Outbox 副作用；把 Module-Test/PR 证据改为与实际执行一致。

### 2. `TaskReady.readyAt` 不是该转换 Receipt 的 `completed_at`

Spec 003 §17.8 第 8 步固定 `readyAt` 取受信转换时刻，即该命令 Receipt 的 `completed_at`（`Module-Spec-003-TaskExecution.md:1170`）。当前 Handler 把第 1 项中过早取得的 `now` 同时写入事件 `readyAt`/`occurredAt`（`task-ready-transition.ts:406-430`），而共享 runner 只有在 Handler 返回之后才独立调用 `new Date()` 写 Receipt `completed_at`（`modules/task-execution/src/persistence/command-runner.ts:454-458`、`:535-550`）。两值没有共同来源，也没有相等保证；只要 Handler 有任何耗时，它们就必然分离。

当前事件测试只核对 type/version/aggregate version、Task Ref 和 judgment identity，没有把 `payload.readyAt` 与 Receipt `completed_at` 比较，因此绿色 persistence gate 未覆盖该契约。

要求：让转换事件和 Receipt 使用同一个受信提交时间值，或调整 runner/command body 的受信时间接口以保证精确相等；增加真实 PostgreSQL 断言，逐值比较 `TaskReady.payload.readyAt`、Outbox `occurred_at`（若契约要求同值）和该命令 `command_receipt.completed_at`。

### 3. 当前状态权威文档仍把已交付切片写成“未实现”

Issue #208 明确要求在同一 revision 把实现已经使其为真的 design-only/`NOT IMPLEMENTED` 状态改为当前事实。PR 虽在 Spec 003 §17.11、Spec 001 §15.5、PostgreSQL §33 和 roadmap 新增了实现记录，但仍保留下列当前状态冲突：

- `Module-Spec-003-TaskExecution.md:5`：`NOT REGISTERED, NOT IMPLEMENTED / HANDLER IMPLEMENTATION NOT STARTED`；
- 同文件 `:314-316`：称业务 Handler 不存在、#206 契约/Handler/V3002/READY 转换均未实现且 `NOT RUN`；
- `Module-Spec-001-IdentityPolicy.md:5`：称 §15.5 两条授权 entry `NOT IMPLEMENTED`；
- `04-domain-model-v0.1.md:2191`、`:5727`：两处仍称 Task Readiness/READY 转换“未实现”。该权威 Domain 文件在 PR 中完全没有修改。

这些不是历史章节：它们分别是当前模块状态、当前实现状态和当前 Domain 生命周期说明，与同 revision 的“implemented”章节直接矛盾，违反当前状态文档必须随行为变为真实而更新的规则。

要求：最小范围更新上述当前状态，保留真正未交付的 WorkOrder/Context/Run/Completion/Query/Projection、外部和人工边界为 `NOT RUN`；不要抹掉历史设计记录或扩大 IM-06 完成范围。

## 验证证据

- 远端 PR head 回读：`de52cd2b2d6b517fce0dfa56e0f30604640dea83`，base `1233a730499c1a9484ac601209aaf38386373fb9`，状态 `OPEN`、`MERGEABLE`。
- GitHub Actions run [35085960284](https://github.com/qzhike/zhiju-business-core/actions/runs/35085960284) / verify job [104760715318](https://github.com/qzhike/zhiju-business-core/actions/runs/35085960284/job/104760715318)：`COMPLETED / SUCCESS`，GitHub 绑定 head SHA `de52cd2b…`；fresh checkout 下执行 `pnpm verify`，普通 suite 98 files / 1434 tests（60 files / 1010 passed，38 / 424 skipped），PostgreSQL 18.6 persistence gate 42 files / 439 tests，46 个 migration 到 V7001，第二次 migrate no-op，Catalog/Registry 214、Compatibility Baseline 200。
- 本地在 reviewed SHA 执行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0；计数与远端一致，包含 clean build 与真实 PostgreSQL gate。
- 初次沙箱内 `vibe verify full --json` 的普通/静态阶段通过，但 Docker socket 权限使 persistence gate 无法启动；只读 preflight 确认是 socket permission。随后按环境恢复规则在可访问本机 Docker 的权限边界重新执行完整未改 verifier，取得上述 PASS。该环境失败没有被记作代码失败，也没有覆盖最终 PASS。
- `git diff --check 1233a730499c1a9484ac601209aaf38386373fb9..de52cd2b2d6b517fce0dfa56e0f30604640dea83` 通过。

绿色 verifier 证明当前已覆盖路径通过，但不能替代上述直接契约反例；尤其 `TE-P206-012` 的测试源码已经明示长事务分支未执行。

## 未运行边界与后续门禁

依赖已 `COMPLETED` 且 Completion Evaluation 当前可用的分支、blocking InformationRequest 分支仍因合法上游 producer 未交付而 `NOT RUN`。WorkOrder DRAFT/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、受控退出 Fixture、外部 Provider/Runtime/飞书与人工业务验收也仍 `NOT RUN`。

本 PR 的 Issue/规格还要求人类技术审查 authorization、RLS/ACL、immutable guard、concurrency 和 migration evidence。该门禁不能替代先修复上述实现/证据缺陷；新的 final head 需要重新独立审查，之后仍须完成并记录人类技术审查。

`REQUEST_CHANGES` 针对精确 SHA `de52cd2b2d6b517fce0dfa56e0f30604640dea83`。本轮没有在 Reviewer 角色内修复产品代码，也不授权 merge、deploy、commit 或 push。

## 第 2 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`617b237be671b2505d5b059c8920f57e568072b5`
- Base SHA：`1233a730499c1a9484ac601209aaf38386373fb9`
- 审查日期：2026-09-16

本轮独立复核了 `de52cd2..617b237` 的修复 diff、最新完整 PR diff、Issue #208、Spec 003 §17.6/§17.8、受影响 Module Spec/Test、关键 Handler/runner 与真实 PostgreSQL 回归；同时回读远端 PR head、当前 CI 与本地完整 verifier。未把实现者的修复说明当作正确性依据。

### 已关闭的第 1 轮发现

1. **提交点期限重验已修复**：`task-ready-transition.ts` 在 Policy、Task/definition 与完整依赖/输入/blocker 重观察之后、DRAFT-only CAS 之前重新读取受信时钟，并以该时刻重验 judgment `valid_until`、有限 Policy `superseded_at` 与当前授权 Decision 期限。`TE-P206-012` 新增长事务只在最后一次时钟读取越界的真实 PostgreSQL 分支，并断言状态、版本、Edge、Outbox 无副作用以及拒绝 Receipt。
2. **`readyAt` 与 Receipt 时间已修复**：同一个 `commitNow` 同时写入 `TaskReady.payload.readyAt`、Outbox `occurred_at`，并由共享 runner 写入 Receipt `completed_at`；`TE-P206-008` 对三者做逐值相等断言。
3. **第 1 轮点名的当前状态冲突已修复**：Spec 003 头部及 §9、Spec 001 头部、Domain 两处生命周期说明已改为 #208 的实现事实，且真正未交付边界仍保持 `NOT RUN`。

### 阻断发现

#### 1. Spec 003 的“当前状态”仍同时声明两套 Catalog/模块计数

`.vibe/module-specs/Module-Spec-003-TaskExecution.md` §9 明确是“当前状态”，但同一段内仍存在互相矛盾的当前事实：

- 第 307 行仍写“43 个公开 Contract 已定义”，而本 revision 的头部、第 311 行、§17.4/§17.11、Registry 检查与完整 verifier 都证明 TaskExecution 当前为 **44** 项；
- 第 312 行仍写 6 个 Runtime additive Command 未进入“当前 **211** 项 Registry”，而紧邻第 311 行及本 revision 的 Registry 检查均为当前 **214** 项。

这两处不是历史验收表或历史设计基线，而是当前状态段落，因而仍使同一权威文档在当前 revision 内自相矛盾。第 1 轮的第三项要求是把当前状态文档与已交付事实完整调和；本轮虽修复了点名位置，但尚未完成该目标。

要求：最小范围把 §9 第 307 行的 TaskExecution 当前公开 Contract 数改为 44，并把第 312 行的当前 Registry 总数改为 214；不要改写 §16 等历史切片记录的 213、早期 Catalog/Registry 证据或 Compatibility Baseline 200。

### 验证证据

- 远端 PR head 回读为 `617b237be671b2505d5b059c8920f57e568072b5`，base `1233a730499c1a9484ac601209aaf38386373fb9`，PR `OPEN`、`MERGEABLE`。
- GitHub Actions run [35092257916](https://github.com/qzhike/zhiju-business-core/actions/runs/35092257916) / verify job [104781091654](https://github.com/qzhike/zhiju-business-core/actions/runs/35092257916/job/104781091654) 为 `COMPLETED / SUCCESS`，绑定 reviewed SHA；fresh checkout 执行 `pnpm verify`。
- 本地在 reviewed SHA 执行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。普通 suite 98 files / 1434 tests（60 files / 1010 passed，38 / 424 skipped）；PostgreSQL 18.6 persistence gate 42 files / 439 tests全部通过；迁移包含 V3002 并到 V7001，第二次 migrate no-op；Catalog/Registry 214、Compatibility Baseline 200。
- `git diff --check 1233a730499c1a9484ac601209aaf38386373fb9..617b237be671b2505d5b059c8920f57e568072b5` 通过。

绿色 verifier 与上述静态/动态复核足以关闭第 1 轮前两项实现缺陷，但不能把权威当前状态中的 43/44、211/214 冲突视为已调和。

### 未运行边界与后续门禁

依赖已 `COMPLETED` 且 Completion Evaluation 当前可用的分支、blocking InformationRequest 分支仍因合法上游 producer 未交付而 `NOT RUN`；WorkOrder/Context/Run/Completion/Query、外部与人工业务验收边界保持不变。

Issue #208 仍要求人类技术审查 authorization、RLS/ACL、immutable guard、concurrency 与 migration evidence。应先修正上述两处当前状态计数并对新 final head 做轻量复核；若没有新的实现或契约缺陷，下一结论应路由为 `HUMAN_REVIEW_REQUIRED`，而不是在该强制门禁未完成时给出 `APPROVE`。

`REQUEST_CHANGES` 针对精确 SHA `617b237be671b2505d5b059c8920f57e568072b5`。本轮只更新项目要求的正式 review 记录，未修改产品实现，也不授权 merge、deploy、commit 或 push。
