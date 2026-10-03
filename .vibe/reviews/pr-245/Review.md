# PR #245 独立实现审查

## 结论与修订绑定

**REQUEST_CHANGES**。三个阻断项均在已批准范围内修复，不需要改变取消设计或扩大 Issue 范围。修复后需对新 head 独立复审；Issue 要求的授权/RLS/persistence 人类技术审查仍待完成。

- PR：[PR #245](https://github.com/qzhike/zhiju-business-core/pull/245)。
- Work item：[Issue #244](https://github.com/qzhike/zhiju-business-core/issues/244)。
- Reviewed head：`0e6fe5b819f6d9de331401cad3262e031204707f`。
- Base：`1fb64357660f2fbceaf60344c544e6ac3558dd21`。
- 审查日期：2026-10-03。
- 角色：独立 Reviewer；未修复产品代码，未提交、推送或合并。

## 判据与审查范围

从 Issue Acceptance 与 owning 设计建立判据后，对照实际 base-to-head diff、当前实现、测试及同 revision CI。重点是实际 RUNNING Run 的 Human 取消、原 lease 到期后的 ABANDONED、原 final 的来源保留和拒绝审计，以及权限/事务/预算/兼容边界。

权威依据：TaskExecution Spec §27、IdentityPolicy Spec §15.17、IntegrationGateway 的 IM06-CANCEL 增量、PostgreSQL Logical Model §42、共享 API/Catalog 的 IM06-CANCEL 增量，以及对应 CANCEL-D/IP-CANCEL-D/IG-CANCEL-D 验收。取消设计决定 §5–§7 保留设计批准与复审绑定；该设计批准不代替实际实现的人类技术审查。

预期：取消只建立 CANCELLING 与唯一 Intent，保留 ACTIVE Claim 和原 reservation，不制造 endedAt/Runtime ACK；到期终结与 Claim/consumption/Receipt/Audit/Event 原子提交；late-isolation 只处理已批准两次执行 profile 的真实来源，依赖权限与自身权限均保持当前，不恢复执行资格、不建立可用 Result/Acceptance/Completion。

## 阻断项

### F1 / P1：隔离提交未复验依赖 Decision

位置：`apps/api/src/composition/controlled-first-run-entry.ts:880–958`、`modules/task-execution/src/business/late-final-isolation.ts:130–166`。

`dependency()` 创建的 proof 只在各 owning Query 前后使用，没有加入提交时的批量复验。传给 TE Handler 的 `revalidateIsolation` 只校验 `runLateFinalIsolateV1`；因此已读取来源的依赖权限随后被撤销，仍可以提交 LATE_RESULT Audit。

真实 PostgreSQL 反例：通过正常 owning 创建/Driver/start/cancel 到达 CANCELLING，封存原 final；在隔离的 final Query 已读取后、Bundle inspect 和 Audit 提交前，通过真实 IdentityPolicy Command 撤销 `lateFinalBindingReadV1` Grant。独立授权负对照确认该 boundary 随后不再 ALLOW，但隔离仍成功，新增一份 LATE_RESULT Audit。

违反 Issue Acceptance 6、IP Spec §15.17 的锁后/提交/历史返回前 current authorization 要求。修复：保留本次使用的各依赖 Decision，在隔离写入/提交与成功返回前连同自身权限复验；补读取后撤销的确定性负例，证明无新 Audit、来源仍保留。cleanup 不需要恢复过期 execution Bundle 的当前资格，这一边界应继续保留。

### F2 / P2：Intent 的内容没有绑定 Receipt 请求 Hash

位置：`migrations/task_execution/V7013__run_cancellation_isolation.sql:339–366`。

guard 只比较 `c.request_payload_hash = NEW.request_payload_hash`，再检查 Intent 自身 canonical Hash 和少数列镜像；没有从保存的 `reason/requestedAt/cancellationPolicyRef` 重建原 command payload 并比较 Receipt Hash。复制真实 Receipt Hash、改变 reason 并重算 Intent Hash，仍满足当前 guard。

真实 PostgreSQL 负例：真实 Human 请求的 reasonCode 为 `HUMAN_REQUEST`；一次性数据库中的临时 BEFORE INSERT 诊断把待插入 Intent 的 reasonCode 改为 `REVIEW_FORGED_REASON`，同步 canonical reason 并重算 Intent Hash，保留原 Receipt/request Hash。产品 guard 未变，真实 Handler 返回 COMMITTED、Run 进入 CANCELLING，保存的 Intent 原请求 Hash与其三个请求字段重新计算的 Hash不同。临时诊断使用 SECURITY DEFINER 仅为生成待验证的 malformed candidate；不是证明普通请求能创建数据库函数，也没有用直接业务表写入构造成功链。

违反 Issue Acceptance 7、TE Spec §27.1 与 PostgreSQL §42.1 的真实来源/完整请求 Hash/归因镜像要求。修复：guard 从完整请求字段计算 canonical request Hash 并比较 Receipt，绑定其余声明的 canonical Scope/Run/source/Actor/Decision/提交时间镜像；加入 app-context 的 malformed candidate 负例，确保整个取消事务回滚。按前向迁移规则交付，保留 applied migration。

### F3 / P2：late-isolation 越过已批准 profile 支持范围

位置：`modules/task-execution/src/business/late-final-isolation.ts:85–96`。

Handler 校验状态与启动来源后即进入 IG/Bundle 读取，没有读取冻结 Contract 的支持 profile，也没有证明原 creation-time reservation。Bundle integrity read 只检查 Bundle/Run/Hash，不能替代预算 profile 检查。

真实 PostgreSQL 正反对照：两个 Run 均由实际 owning 创建/Driver/ack/start 到 RUNNING，经真实时间到期后合法 `expire_run@1.0` 到 TIMED_OUT，再释放原 final、封存 IG Observation 并使用独立当前权限调用隔离。两次执行且有 reservation 的正对照成功；`maxAttempts=1`、reservation 数量为 0 的负对照也成功，写入一份 LATE_RESULT Audit。两者均未新增 AgentResult。

违反 Issue Acceptance 5、TE Spec §27.1、共享 API 的 IM06-CANCEL 支持集。安全保留原 Observation 不等于允许将未支持来源标记为本切片成功隔离。修复：在自身授权之后验证完整冻结 profile 与原 reservation 的 Scope/Run/WorkOrder/attempt/source 镜像，单次 profile 拒绝 `EXECUTION_CRITERION_UNSUPPORTED`，缺失/不一致预算事实安全拒绝且不补建；保留旧 @1.0 expiry 的合法正对照。

## 契约字段核对

| 契约/边界 | 字段与 required/optional 检查 | 判断 |
| --- | --- | --- |
| expire_run@2.0 Envelope/target | COMMAND/MUTATE、OBJECT execution.run、expectedAggregateVersion 必填；Purpose execution.run.expire；/targetRef 与 /data/runRef 元数据 | 与 owning Spec/Catalog 一致 |
| expire_run@2.0 request | closed；仅必填 reason，LEASE_EXPIRED/DEADLINE_EXCEEDED；无 caller status/endedAt/now | Schema 与批准字段一致 |
| expire_run@2.0 result.data | closed；runRef、status、endedAt 全必填；OBJECT execution.run、TIMED_OUT/ABANDONED、UtcInstant | Schema 与批准字段一致 |
| expire_run@1.0 | 原 closed request 与 TIMED_OUT 常量 result 保留 | 新 Major 未放宽旧 Schema |
| request_run_cancel@1.0 | closed；reason/requestedAt/cancellationPolicyRef 必填；Justification 的 reasonCode/summary/NonEmptySet evidenceRefs 必填、policyRef 可选；UtcInstant、VersionedRef；通用 CommandResult；Purpose task.execution.request_run_cancel | 原定义与 metadata 保留；Intent 来源实现存在 F2 |
| get_run_state@1.0 | request.runRef 必填；RunStateView 的 runRef/aggregateVersion/workOrderRef/attemptNumber/status/runtimeBinding/contextSnapshotRef/currentFencingToken 必填，leaseExpiresAt/resultRef/terminationReason 可选；原类型和 enum 保留；独立 Human mapping 不改原 SERVICE mapping | 公共定义未修改 |
| RunTerminated@1.0 | 原 runRef/workOrderRef/terminalStatus/terminationReason/endedAt 必填，agentResultRef 可选；ABANDONED 已在 terminal enum | 公共定义未修改 |

新 @2.0 注册、generated API/types、兼容 metadata 与 standalone 正负 fixtures 同修订交付；Registry 239 / TE 63 / historical baseline 200。独立比较确认旧 registry/metadata entries 全部保留，唯一新增 entry 为 expire_run@2.0；实际 diff 未改变原 @1.0 Schema 或 applied migration。本审查没有把 Schema 接受集与 Handler 支持集混为一谈，F3 是 owning 语义违反。

## 验证证据与限制

1. 复用同 reviewed SHA 的 [CI run 37120429685](https://github.com/qzhike/zhiju-business-core/actions/runs/37120429685)：select/checks/persistence/verify 均 SUCCESS。实际 workflow 的 clean + code checks、build + PostgreSQL persistence 覆盖 configured full；未为重复取证重跑 full。
2. `vibe verify environment --json` PASS：当前 Docker endpoint、固定 PostgreSQL 18.6/Flyway 11.20.3 的 registry tag-to-digest 均匹配。首次 sandbox 工具链 registry fetch 失败，不是产品测试失败；允许访问后恢复。
3. 临时独立诊断通过原 persistence gate 的 focused file 入口执行，复用实际 owning 场景，只替换验收回调；没有替换产品 Handler、授权、来源 Query 或产品 guard。正链不直接写 Root/Receipt/Observation、不改时钟，使用真实 wait 和原 Driver final。
4. 首轮两个 profile 正反对照各通过；Intent 诊断因诊断函数自身 canonical helper 权限失败。修正临时 malformed-candidate 生成方式后，聚焦重跑 Intent 与权限撤销两例：2 passed / 2 explicitly filtered skipped；两例均确认阻断行为。中间一次 registry timeout 发生在测试前，重新 environment PASS 后有限重试成功。未把这些局部结果写为新 full PASS。
5. 成功诊断还完成 V7013 前向迁移及 second migrate no-op，一次性容器已清理。临时诊断文件已移出仓库至 `/private/tmp/pr-review-245-counterexamples.test.ts`，实际诊断源 SHA-256 为 `dad014552894d856127f828a413e629e96dd5ae705dd9bff7e195e960a16ed1b`。
6. 外部 Provider/CLI/飞书、公开 HTTP/UI、生产/负载、独立人工业务验收仍 NOT RUN；实际实现的人类授权/RLS/persistence 技术审查未见完成证据。

本记录只保存审查事实，不修改 owning Contract、不关闭 Issue/IM-06、不授权合并。[审阅评论已发布](https://github.com/qzhike/zhiju-business-core/pull/245#issuecomment-5970172478)，正文已读回逐字核对，PR head 未变化；这是普通 PR comment，未提交 GitHub REQUEST_CHANGES Review。本记录未提交/推送，Git 交付需要独立 commit/push 授权。
