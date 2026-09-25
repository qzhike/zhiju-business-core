# PR #226 独立实现审查记录（第 1 轮）

- PR：[#226](https://github.com/qzhike/zhiju-business-core/pull/226)（Draft，Refs #224）
- Base SHA：`aa6784062949424668b88b7a4eefab0da0aa447d`（origin/main）
- 被审 Head SHA：`dbe2eb4800eeb19e5af5f89b9880bcaeb2a1cf31`
- 日期：2026-09-25
- 角色结论：`REQUEST_CHANGES`

## 审查范围与依据

工作项 Issue #224（Goal/Acceptance/Scope/Non-goals/Verify）。独立对照的权威来源：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md` §23（含 §23.1 操作表、§23.2 接收/判断/Acceptance、§23.3 terminal/到期/恢复、§23.4 边界）与 §11.1；
- `.vibe/module-specs/Module-Spec-001-IdentityPolicy.md` §15.13（含依赖 action 表）；
- `.vibe/module-specs/Module-Spec-007-IntegrationGateway.md` final 观察增量；
- `.vibe/high-level-docs/06-typed-references-contract-catalog-v0.1.md` final 注册增量、`.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md` §38；
- `.vibe/decisions/task-execution-human-operated.md` §22；
- 实际 diff（53 文件，+7101/-116）、CI 与 Module-Test 矩阵。

## 验证证据（绑定被审修订）

- 必需目标：Issue Verify 声明 `full`；PR 含 migration/SQL/持久化代码，CI 目标选择器亦判定 `target=full`（reason=persistence-or-verification-sensitive，changed_path_count=53）。
- CI [run 35989912496](https://github.com/qzhike/zhiju-business-core/actions/runs/35989912496)：`head_sha=dbe2eb4800eeb19e5af5f89b9880bcaeb2a1cf31`、`conclusion=success`、耗时 18m41s，覆盖 clean build、代码测试与真实 Docker/PostgreSQL 持久化门禁（空库、历史升级、二次 no-op）。
- PR body 另行声明同修订本地 `vibe verify full --json` PASS（1,380 代码测试 + 501 真实 PostgreSQL 持久化测试）；本审查以 CI 精确修订证据为准，未本地复跑。
- 契约/注册事实经直接检查确认：Catalog/Registry 221→226（TE 49→53、IG 25→26）、四个新 objectType、静态 Evaluator `te.agent_result_validation.evaluator@1.0`（固定 objectId/versionId 与 Catalog 一致）、历史 200 项 Baseline 文件未改、既有操作 Schema/metadata diff 为纯追加。

## 阻断发现（REQUEST_CHANGES）

1. **`execution.validate_agent_result@1.0` 注册 payload 字段名偏离已批准设计。** 权威字段为 `runtimeAttemptRef`（Module-Spec-003 §23.1 操作表与 §11.1 均固定 `payload {agentResultRef, runRef, runtimeAttemptRef, policyRef, evaluatorRef}`；Catalog 增量声明「唯一字段与行为权威是 Spec 003 §23」），但注册为 `attemptRef`：`contracts/src/operations/task-execution.schema.ts`（payload 键）、`contracts/registry/public-api.v1.json`（`/payload/attemptRef`）、`contracts/src/generated/types/task-execution.ts`（`ExecutionValidateAgentResultPayload.attemptRef`）、构造/消费处 `modules/task-execution/src/business/controlled-final-result.ts:582,920,949,981`。该 Schema 为 FULL closed，合并后即成为已发布契约；兼容门禁无法发现（新操作无 Baseline 条目）。应在 Draft 阶段把注册字段改回 `runtimeAttemptRef`（改动权威设计文本则需重新设计批准）。
2. **finalize 四条依赖 action token 与 §15.13 权威表不符。** §15.13 依赖表（`.vibe/module-specs/Module-Spec-001-IdentityPolicy.md:820`）固定 `integration.runtime.binding.read.for_run_finalize.v1`、`integration.runtime.final.read.for_run_finalize.v1`、`identity.execution_bundle.read.for_run_finalize.v1`、`identity.policy.resolve.for_run_finalize.v1`；实现写作 `*.for_result_finalize.v1`（`modules/identity-policy/src/commands/work-order-validation-authorization.ts:2381,2390,2399,2410`）。方向 fail-closed、无越权，但按规范文本配发 Grant 的部署将使 finalize 依赖读全部 DENY；现有测试从同一绑定表取 action 配发 Grant，结构性掩盖该漂移。submit/record/validate/accept 四行 16 条 token 与规范一致，仅 finalize 行偏离。
3. **Module-Test-007 IG-FINAL-D-005 标记了无证据的执行。** 该行声称「部分 RLS/不可变负例 PASS」（`.vibe/module-tests/Module-Test-007-IntegrationGateway.md:157`），但 `tests/` 中不存在任何针对 `integration_gateway.runtime_adapter_identity` / `runtime_final_observation` 的 SQL 负例（仅 `tests/persistence/technical-tables.test.ts:252-253` 清表列表与 query type 字符串）。按「未执行的验收保持 NOT RUN」规则，应补真实 SQL 负例（app-role 直写/无 Context/跨 Project/UPDATE/DELETE）或把该子句改回 NOT RUN。

## 非阻断修正项

4. §38 状态行写「当前实现分配 `V3007` 与 `V7003`」，未计入本 PR 实际新增的 `V3008__controlled_final_process_progress.sql`（Module-Spec-003 §23.4 与 Module-Test-003 TE-FINAL-D-010 均已提 V3008）。请在同一修订内使 §38 与事实一致。

## 需人类门禁确认的事项

5. 本 PR 在实现同时扩充了 2026-09-23 已批准设计：§23.3 新增周期 worker 与 `controlled-final@1` ProcessInstance 段落、§15.13 新增 `runFinalProcessProgressV1` 行、新增 V3008。人类设计批准与独立设计复审绑定 `.vibe` diff SHA `c57c1e1f80c15b11947f2bb8d114d7ab5f1225c32a617438cf1baca12772a1d2`（决定 §22.5/§22.6，pr-223 记录）。按 §22.5 自身条款，转为 ready/合并前应由人类设计权威确认批准覆盖该设计增量。实现内容与 PR 更新后的文档一致，此项非代码缺陷。

## 已核对无阻断问题的要点

- 接收链语义与 §23 一致：submit 只插不可变 Result + `run_final_submission_claim`（Run Root 不动），同/异键同事实重放返回原事实、冲突拒绝；record CAS `RUNNING→RESULT_RECORDED`；validate 只接受静态 Evaluator selector、Bundle+五子事实同事务、`validUntil=min(lease, deadline, Decision 有效期, Policy supersededAt)`；accept 逐字段重核同 Bundle 五项 SATISFIED 且 `disposition=ACCEPTED/reasons=[]`；finalize 与 expire 经同一 Run 锁/CAS 序列化，`SUCCEEDED+RELEASED` / `TIMED_OUT+EXPIRED` 配对，终态不可覆盖。
- V3007/V7003 守卫与 §38 镜像/唯一性/不可变/RLS 要求一致；历史 RUNNING 行无前向身份列被排除在 final 正链之外；V3008 进度列与稳定键唯一索引符合 §23.3。
- IG 侧 `observeFinal`/`getFinal` 不二次调用 Driver；身份行只在真实 ack 后提交；`planned_runtime_instance_id` 预分配不构成有效身份。
- 恢复路径只以候选扫描发现未预占 Run，凭 Run 已存 Attempt Ref 经独立授权 Query 取回唯一 final，五步按 `controlled-final:sourceFactId:sourceFactHash:step` 稳定键重放 owning Command Receipt；进度授权不联查业务事实（测试证明交叉使用拒绝）。
- 周期 worker tick 不重叠、停止等待当前 tick；PR 不声称已部署 worker 引导。

## 未执行边界（保持 NOT RUN）

- Module-Test 矩阵 23 行中 4 行整体 NOT RUN（IP-FINAL-D-004、TE-FINAL-D-005、TE-FINAL-D-006、IG-FINAL-D-002），19 行 PARTIAL 且各自列明剩余 NOT RUN 子项；上述发现 3 修正前 IG-FINAL-D-005 的 RLS/不可变子项亦属未执行。
- 外部 Provider/CLI/Feishu 与独立人工业务验收 NOT RUN；Composition worker 无业务进程引导配置。

## 交接

结论 REQUEST_CHANGES，执行交回 Implementer：修正发现 1–3（及第 4 项文档事实）后在同一 PR 更新，Reviewer 将复审新 head。发现 5 留给 ready/合并前的人类门禁。本记录入库不授权 commit/push/merge；GitHub 侧以 PR 评论发布同一结论（认证用户即 PR 作者，未形成 formal review）。
