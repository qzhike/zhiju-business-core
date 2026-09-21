# PR #217 独立审查

## 第 1 轮：`PLANNING_REQUIRED`

- 结论：`PLANNING_REQUIRED`
- Reviewed SHA：`bce56af9007e70ee79e46bcc90d49dd0fc5b35f5`
- Base：`main`
- PR：[#217](https://github.com/qzhike/zhiju-business-core/pull/217)
- Work item：[#216](https://github.com/qzhike/zhiju-business-core/issues/216)（T2 implementation）
- 审查日期：2026-09-19
- GitHub handoff：[#issuecomment-5740692752](https://github.com/qzhike/zhiju-business-core/pull/217#issuecomment-5740692752)（同账号无法审查自己的 PR，因此使用 comment，不是 GitHub formal review）

本轮独立读取了 Issue #216、PR 最新 head 与实际 diff、已批准设计 revision
`d0d060fbacb98a6e9fdac1d098792a6222de4cff` 的正式审查记录、TaskExecution §19、
IdentityPolicy §15.8、相关实现/测试、注册 Event Schema 与 exact-head CI 证据。没有把 PR
描述中的实现者总结或“已知后续项”判断当作正确性证据。

当前存在三项需要先回到 durable design/readiness 决定的阻断，以及一项可由 Implementer
直接修正的确定性偏差。由于前三项不能在不改变当前权威边界或已声明 Scope 的情况下安全修复，
本轮按角色路由为 `PLANNING_REQUIRED`，尚未进入 Issue #216 要求的人类技术批准 Gate。

## 阻断发现

### 1. Legacy Context Snapshot 被契约接受，但 Handler 无条件拒绝

Issue #216 Goal/Acceptance 和 Spec 003 §19.2 明确要求
`execution.get_context_snapshot@1.0` 对 canonical
`zhiju.execution.context_snapshot` 与 legacy `zhiju.project.context_snapshot` 提供两个互不
alias 的已接受身份，并对已经提交的历史事实做 exact read-back。

实际实现却在任何查询前把非 canonical objectType 一律返回 `REFERENCE_INVALID`：

- `modules/task-execution/src/business/context-snapshot-read.ts:97-106`；
- `modules/task-execution/src/business/context-snapshot-read.test.ts:438-442` 把 legacy 拒绝写成正向预期；
- `tests/persistence/initial-context.test.ts:4530-4555` 即使为 legacy target 单独签发有效 Grant，
  也只断言 `REFERENCE_INVALID`。

这不是“两个身份不 alias”的实现；它使第二个已接受身份永远无法读回任何事实。V3004 的
`context_snapshot` 又没有 object-type 判别列，仓库中也不存在另一个 legacy owning store 或
route，因此当前实现没有能力区分“legacy 历史事实存在”与“未提交身份”。

要求 Planner 明确 legacy 历史事实的 owning 存储/导入/路由与 exact identity 绑定：保留现行
Query 接受集时，必须增加能成功读回真实 legacy committed fact 的正向 fixture，并继续证明
canonical/legacy 不互换；若项目实际决定永远不支持 legacy fact，则必须正式修改与重新批准
Issue/Spec 的接受语义，不能由 Handler 静默收窄。

### 2. 构建跳过了要求的独立 WorkOrder DRAFT-read 当前授权

Issue #216 Acceptance、Spec 003 §19.3 与 Spec 001 §15.8 第 5 条都要求精确 DRAFT、每片
Source Slice、Builder Policy 分别通过 owning read 当前授权；build Decision 不隐含其中任一能力。

实际组成层只为 Slice 和 Policy 现签 Decision。`apps/api/src/composition/initial-context-entry.ts`
没有调用 `workOrderDraftReadV11` Port；DRAFT 由
`modules/task-execution/src/business/initial-context-build.ts:331-350` 在 build Decision 下直接读
TaskExecution repository。文件头注释和 `initial-context-entry.test.ts:1189-1204` 明确把要求改成：
“调用方过去通过 `get_work_order_draft` 得到过 ref 即可”。该测试还断言 DRAFT miss 之前只有 build
Decision，没有独立 dependency Decision。

因此持有 build/Slice/Policy 能力的调用方，即使当前没有 DRAFT-read capability，或先前的
DRAFT-read Grant 已撤销，仍能消费该不可变 DRAFT。这直接违反“current authorization
revalidation”和“builder authorization implies none of them”。过去曾获授权读取 ref 也不是本次构建
时的当前资格证明。

当前 build payload 只给出 `draftSnapshotRef`，而现有 `workOrderDraftReadV11` selector 需要
WorkOrder target；实现者已经指出组成层无法在读取事实前从 snapshot id 命名该 target。这是待决的
授权/寻址设计缺口，不应由实现层把独立授权义务删除。要求 Planner 决定可在事实读取前闭合的
target/Port（或经批准的 request/authorization 增量），并增加“build Grant 有效但 DRAFT-read
Grant 缺失/撤销/过期”均在 DRAFT fact 读取前 fail closed 的验收。

### 3. 成功路径写出的注册 Event payload 不能通过自己的 Schema

`initial-context-build.ts:760-776` 写入的 `execution.ContextSnapshotBuilt@1.0` payload 包含：

- 大写 Core enum：`projectionType='COORDINATOR'`、
  `coverageStatus='COMPLETE_FOR_PURPOSE'`；
- 注册 payload 未声明的额外成员 `enterpriseId`、`projectId`。

注册 Schema `contracts/src/operations/task-execution.schema.ts:1183-1189` 是
`additionalProperties:false`，并把前两个字段定义为只接受小写 pattern 的 `namespaceCode`。
Reviewer 使用当前 `ContractRegistry.validateOperation` 对生产代码的 exact payload 形状做 focused
probe，结果为 `valid:false`，四个错误分别是：

- `/payload` 的 `enterpriseId`、`projectId`：`additionalProperties`；
- `/payload/projectionType`、`/payload/coverageStatus`：`namespaceCode` pattern。

删除额外字段并改为小写的控制样本为 `valid:true`。现有 persistence test 只比对 Outbox JSON，
没有把 emitted event 交给 ContractRegistry，所以绿色门禁没有覆盖这条公开边界。

PR 在 Spec 003 §19.10 与描述中已经承认 enum mismatch，却把它降级为 follow-up；它还没有记录
两个额外字段的闭集违例。Issue 同时要求“恰写一条 registered event”且限定本切片不修改既有
Schema/Compatibility metadata，因此现状不能被批准。要求 Planner 决定是修正既有事件 Contract、
增加 additive event version，还是采用与现有 Schema 一致且仍满足业务语义的映射；相应扩大 Scope
并加入生产 Event envelope 的 ContractRegistry 正向/负向测试。运行时不校验 Outbox payload 不能
把无效公开事件变成有效。

### 4. Source Slice 排序实现没有遵守批准的 tuple 顺序

Spec 003 §19.4 第 1 条固定 Source Slice 按
`(objectType, objectId, snapshotId)` 字典序排序。`initial-context-assembly.ts:329-365` 的注释声称
使用该 tuple，但 comparator 实际只比较整个 ref 的 `canonical_cv1` 字符串。对于
ContentAddressedRef，canonical JSON 首个可变字段是 `contentHash.digest`，所以 hash 会先于
`objectId` 决定顺序。

Reviewer focused probe 构造 `objectId ...0001/hash ffff...` 与
`objectId ...0002/hash 0000...` 两个合法 ref：批准的 tuple 顺序为 `0001,0002`，当前 comparator
得到 `0002,0001`。这会改变 `contextItems`、`sliceRefs`、Edge 路径和 payload/metadata hash，
不是等价实现。

要求 Implementer 按批准 tuple 显式比较 `objectType`、`objectId`、`snapshotId`，只在 tuple 全等时
使用经批准的 exact-ref tiebreak/重复判定；补充 objectId 与 contentHash 排序方向相反的 fixture。
如果 ContentAddressedRef 没有 `snapshotId` 使批准规则本身不完备，应与前三项一起回到 Planner
补齐规则，不得继续用全 ref canonical order 替换权威 tuple。

## 验证证据

- 发布前回读：PR `OPEN`、非 Draft、`MERGEABLE`；exact head
  `bce56af9007e70ee79e46bcc90d49dd0fc5b35f5`。
- exact-head GitHub Actions run
  [35433383049](https://github.com/qzhike/zhiju-business-core/actions/runs/35433383049) / job
  `105871813900`：`SUCCESS`；fresh checkout 后 `pnpm verify` 成功。
- `git diff --check origin/main...HEAD`：PASS；审查开始时工作树 clean。
- focused ContractRegistry probe：生产 Event payload `valid:false`（两个额外字段 + 两个
  namespace pattern 失败）；闭集小写控制样本 `valid:true`。
- focused canonical comparator probe：批准 tuple 与当前 full-ref canonical comparator 对同一对合法
  Slice ref 得出相反顺序。

绿色 CI 证明现有测试集合通过，不会推翻上述由权威契约和直接反例建立的阻断。Reviewer 没有重复
运行本地 full target，因为 exact-head CI 已成功，且额外全量绿灯不能消除这些契约反例。

## 未运行边界与后续门禁

- 本轮未运行外部 Provider/Runtime/飞书、部署、生产、负载/性能或独立人工业务验收；PR 已声明这些
  保持 `NOT RUN`。
- Issue #216 要求的人类技术 review 尚未开始：当前仍有 agent/Planner 必须先解决的阻断，不能让
  人类批准已知不符合契约的 exact head。
- 本轮未修改产品代码、未提交、未推送、未合并；只新增本地正式审查记录并发布 PR comment。
  该记录在未获得提交/推送授权前保持本地未提交状态。

## Planner 修正响应（2026-09-19）

用户授权修正上述四项所涉及的文档，但未授权产品代码、migration、提交、推送或合并。Planner 已把候选修正写入以下 durable authority / verification 文档：

- [TaskExecution Spec §20](../../module-specs/Module-Spec-003-TaskExecution.md#20-pr-217-首次-context-实现审查修正-delta提案)：legacy 精确路由、独立 DRAFT 读取授权、Event `@1.1` 与可执行排序全序；
- [IdentityPolicy Spec §15.9](../../module-specs/Module-Spec-001-IdentityPolicy.md#159-im06-ctxbuild-02-draft-snapshot-依赖读取授权修正提案217)：专用 dependency-read Port 与 fail-closed 顺序；
- [设计决定 §19](../../decisions/task-execution-human-operated.md#19-pr-217-首次-context-审查阻断修正提案)：四项候选决策及被否方案；
- [Contract Catalog #217](../../high-level-docs/06-typed-references-contract-catalog-v0.1.md#217-contextsnapshotbuilt-additive-event-修正提案)、[PostgreSQL §35](../../high-level-docs/07-postgresql-logical-model-v0.1.md#35-pr-217-context-snapshot-存储修正提案) 与 [TE-217-D-*](../../module-tests/Module-Test-003-TaskExecution.md#pr-217-修正设计矩阵提案)：注册、持久化和证据门禁。

这些内容不改变本记录对 reviewed SHA 的 `PLANNING_REQUIRED` 结论，也不声称 PR #217 当前实现已经修复。用户已于 2026-09-19 显式批准该文档设计，并授权本轮订正文档单独 commit/push；状态因此更新为 `EXPLICIT HUMAN DESIGN APPROVAL RECORDED / PENDING INDEPENDENT DESIGN REVIEW`。下一门禁是对推送后的 exact revision 做独立设计复审；复审通过后，才能把修正交给 Implementer。

## 第 2 轮：`PLANNING_REQUIRED`

- 结论：`PLANNING_REQUIRED`
- Reviewed SHA：`9e87b0bdcb263f1f53441d87ef143792ae609e2a`
- 文档修正 commit：`9e87b0b`（八份 `.vibe` 文档，无产品代码或 migration 变化）
- 审查日期：2026-09-19

### 本轮阻断

人类已批准的新 durable design 本身给出了四项可执行修正，但 GitHub Issue #216 仍固定旧的、与新设计冲突的 Acceptance / Scope：

- Issue 要求成功路径继续发布且只发布 `execution.ContextSnapshotBuilt@1.0`，并明确“Do not add another ... event operation version”；新 Catalog #217 与 Spec 003 §20.3 则要求冻结 `@1.0`、新增并发布 `@1.1`，Catalog 215→216、TaskExecution 45→46。
- Issue 要求不改变 `V3004` 所声明的两表范围和原 §15.8 授权组成；新 PostgreSQL §35 与 Spec 001 §15.9 分别增加 legacy compatibility store 和专用 DRAFT-snapshot dependency-read Port。

项目规则禁止 Reviewer 静默决定 Issue 还是 durable contract 胜出。Planner 必须先把 Issue #216 的执行范围、Acceptance、Verify 和非目标与已批准的 `9e87b0b` 文档 Delta 对账，或创建一项明确承接修正的 NOW + READY work item；在这一步完成前，Implementer 没有无冲突的执行契约。

### exact-head 实现核对

`bce56af...9e87b0b` 仅包含八份文档，产品代码未变化，因此第 1 轮四项实现不符合仍全部存在：

1. `context-snapshot-read.ts:97-106` 仍在任何查库前拒绝 legacy objectType，且无 §35 compatibility store/route。
2. `initial-context-entry.ts` 仍只为 Policy/Slice 现签 dependency Decision；`initial-context-build.ts:340-347` 仍在 build Decision 下直接读取 DRAFT repository，没有 Spec 001 §15.9 Port。
3. `initial-context-build.ts:72-73,758-775` 仍发 `ContextSnapshotBuilt@1.0`，携带两个额外 Scope 字段和不满足 `NamespaceCode` 的 Core enum；`contracts/src/operations/task-execution.schema.ts:1183-1189` 未新增 `@1.1`。
4. `initial-context-assembly.ts:329-367` 仍按完整 canonical ref 排序，未实现 §20.4 的 objectType/objectId-first total order。

这些项在 Issue 对账完成后属于可由 Implementer 修复的 `REQUEST_CHANGES`，不是当前 Reviewer 可以自行改写 Scope 后批准的实现。

### 验证证据与未运行边界

- `vibe repo --json`：repository `qzhike/zhiju-business-core`，branch `galendai/im-06-taskexecution-implement-initial-context-co`，exact head `9e87b0bdcb263f1f53441d87ef143792ae609e2a`。
- 当前文档树在 commit 前执行 `vibe verify full --json`：PASS；68 passed / 40 skipped test files，1205 passed / 474 skipped tests；persistence gate 44/44 files、489/489 tests，PostgreSQL 18.6，二次 migrate no-op。
- GitHub Actions 对新 head 的 run `35436134740` 在本轮结论形成时仍为 `IN_PROGRESS`；由于已经存在权威执行契约冲突和四项直接实现反例，不等待绿灯也不会改变本轮路由。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收继续 `NOT RUN`。

本轮 Reviewer 未修改产品代码、migration 或测试；只追加项目要求的正式审查记录。该第 2 轮记录尚未获得单独 commit/push 授权，保持本地未提交。

## 第 3 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`9e87b0bdcb263f1f53441d87ef143792ae609e2a`
- Issue 对账：[Issue #216 Planner reconciliation](https://github.com/qzhike/zhiju-business-core/issues/216#issuecomment-5740930731)
- 审查日期：2026-09-19

### 设计复审与执行契约

Reviewer 独立对照了 Issue #216 的新 Goal/Acceptance/Scope/Verify/Non-goals、文档 commit `9e87b0b` 的 Spec 003 §20、Spec 001 §15.9、Catalog #217、PostgreSQL §35 与 `TE-217-D-*`。四项修正已形成互相闭合、可执行且有确定性验证路径的 T2 契约，显式人类设计批准已记录；第 2 轮的 Issue/Contract 冲突已经解除，不再需要新的产品、架构或契约决定。独立设计复审门禁因此通过，后续阻断属于已定义范围内的实现修复。

### Blocking findings

1. **Legacy Snapshot 路由与存储尚未实现。** Spec 003 §20.1 和 Issue #216 要求 canonical/legacy 分别路由到两个 owning store，并由真实 PostgreSQL legacy fact 证明成功读回。`modules/task-execution/src/business/context-snapshot-read.ts:97-106` 仍在任何查询前把 legacy objectType 固定拒绝；仓库没有 `task_execution.context_snapshot_legacy`、受控 import provenance、只读 ACL 或 `TE-217-D-001` 正向证据。请实现 PostgreSQL §35 的 compatibility store/route，并补完整正负 fixture。
2. **独立 DRAFT dependency authorization 尚未实现。** Spec 001 §15.9 和 Issue #216 要求在任何 DRAFT repository 读取前签发并重验 target 为完整 `draftSnapshotRef` 的独立 Decision。代码中不存在 `contextSnapshotDraftReadV11` 或 `execution.work_order.draft_snapshot.read.for_context_build.v1_1`；`modules/task-execution/src/business/initial-context-build.ts:340-347` 仍在 build Decision 下直接调用 `readWorkOrderDraftSnapshotByIdentity`。请增加 owning internal Port、组成层接线及缺失/撤销/过期/漂移/替换时 repository 调用数为 0 的 `TE-217-D-002` 证据。
3. **additive Event `@1.1` 尚未注册或发出。** `modules/task-execution/src/business/initial-context-build.ts:72-73,758-775` 仍固定 `eventVersion='1.0'`，payload 仍含额外 `enterpriseId`/`projectId`；`contracts/src/operations/task-execution.schema.ts:1183-1189` 仍只有把两个业务 enum 当 `NamespaceCode` 的 `@1.0` Schema。请冻结 `@1.0`，新增 closed `@1.1` 四字段 Schema/metadata/generated artifacts，改成功路径为只发 `@1.1`，用完整实际 envelope 通过 ContractRegistry，并固定 216/46/200 计数与 `TE-217-D-003` 负例。
4. **Source Slice 全序尚未实现。** `modules/task-execution/src/business/initial-context-assembly.ts:329-367` 仍只比较完整 canonical ref，使 contentHash 可以先于 objectId 决定顺序；同时仍保留旧的 `snapshotId` 说明。请实现 Spec 003 §20.4 的显式 tuple、collision/duplicate fail-closed 语义与 UUIDv7 输入，增加 objectId/hash 反向 fixture 和全排列不变性的 `TE-217-D-004` 证据。

以上四项都可在已对账 Issue 的声明范围内修复，不需要 Planner 再作语义决定。修复后的新 head 必须重新独立审查；在 agent-fixable findings 清零前不得进入人类技术批准。

### 验证证据与未运行边界

- `vibe repo --json` 与 PR 回读一致：exact head `9e87b0bdcb263f1f53441d87ef143792ae609e2a`，PR `OPEN`、非 Draft、`MERGEABLE`。
- exact-head GitHub Actions run [35436134740](https://github.com/qzhike/zhiju-business-core/actions/runs/35436134740) / job `105878986373`：`SUCCESS`。
- `git diff --check`：PASS；`bce56af...9e87b0b` 仅含八份 `.vibe` 文档，证明四处产品实现未被该 revision 修复。
- 现有 green CI 只证明旧测试集合通过；`TE-217-D-001`–`004` 在权威矩阵中仍全部为 `NOT RUN`，且仓库搜索不到对应实现标识或测试证据，因此不能替代新 Acceptance。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收继续 `NOT RUN`。

本轮 Reviewer 未修改产品代码、migration 或测试；只追加项目要求的正式审查记录并发布 PR comment。同一账号不能对自己的 PR 提交 GitHub formal `REQUEST_CHANGES` review，因此以 comment 交接，不声称其为 formal review。第 2/3 轮记录在未获得新的 commit/push 授权前保持本地未提交。

## 第 4 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`00ab982298c04a6a192290cff2588a1de34a55c2`
- 审查日期：2026-09-20

### 已关闭的上一轮 finding

Reviewer 独立核对了 `9e87b0b...00ab982` 的实现与批准后的 Issue #216 / Spec 003 §20 / Spec 001 §15.9：

1. `V3004` 新增 legacy compatibility store，read Handler 按 objectType 精确路由，canonical/legacy 不 fallback；
2. 组成层新增独立 `contextSnapshotDraftReadV11` 授权，在 Handler 与 DRAFT repository 之前签发并重验；
3. `execution.ContextSnapshotBuilt@1.1` 以版本化 payload Schema 注册，修正路径只发布闭合的四字段 payload，并在写入前调用真实 `ContractRegistry`；
4. Source Slice comparator 显式实现批准的七元 tuple，objectType/objectId 先于 hash，tuple 碰撞 fail closed，UUIDv7 摘要输入使用 `sliceRef.objectId`。

因此第 3 轮的四项原始实现 finding 已由新 head 实质处理；本轮阻断是复审时新发现的内容寻址完整性缺口与精确 head 门禁失败。

### Blocking findings

1. **Legacy read 可返回不与 `contractRef` 内容地址闭合的 `projectContextContract`。** Spec 003 §19.2 第 3 条规定 read result 的 `contractRef` 是内容寻址的 Core ProjectContextContract ref；Catalog §3.4/§7 又把 digest 定义为 immutable Contract Payload 的完整性地址；§20.1 仍要求 legacy 路径按完整 contentHash 与 cv1 payload 闭合。当前 `V3004` 只对 `canonical_payload` 重算 `payload_hash`，却只对 `project_context_contract` / `contract_ref` 做 object shape CHECK；`readLegacyContextSnapshot()` 也只校验前者能过 Core Schema，没有重算 `project_context_contract` 的 cv1 digest 或把 `contract_ref` 的 objectType/objectId/Scope/hash triple 与返回 body 闭合。`context-snapshot-read.test.ts:427-463,630-646` 明确构造了与 hashed `canonical_payload` 不同的 contract body，并给 `contractRef` 一个不可能由该 body 得到的固定 `99…99` digest，Handler 仍返回 `FOUND`。这使受控 import 可以把任意 Core-valid body 与任意形状合法的内容地址配对后从权威 Query 返回。请在 import guard 或 read boundary（最好两层）逐字段闭合 `contractRef` 与实际返回的 `projectContextContract`，至少覆盖 objectType、Scope、hash algorithm/canonicalizationVersion/digest 及 cv1 重算，并增加真实 PostgreSQL tamper 负例。若历史数据确实允许二者不闭合，则这不是实现解释项，必须回到 Planner/人类重新批准对已发布 ContentAddressedRef 语义的改变。

2. **精确 head 的必需 full verification 失败。** GitHub Actions run `35504610010` 在 PR head `00ab982...` 的 `Verify full repository` 步骤失败：`TE-214-D-017 executes the DRAFT inputRefs matrix` 超过 Vitest 默认 5000ms；随后 `TE-217-D-002` 观察到额外 `+1 command_receipt / +2 audit_record`。从测试顺序和增量形状看，第二项是超时后未取消的 `TE-214-D-017` 异步构建继续写共享数据库所造成的级联污染；无论如何，当前 44-file PostgreSQL gate 是 491/493 而非 PASS。新增 DRAFT dependency authorization 已增加该大矩阵每次 build 的开销，测试必须拆成有界 case 或给这个真实 PostgreSQL 集成矩阵设置合理的显式 timeout，并保证超时不会让后台工作跨测试写库；修复后须在新的 exact head 重跑 `vibe verify full --json` / GitHub full gate。不能以提交描述中的本地 PASS 摘要替代失败的远端精确 revision 证据。

### 验证证据与边界

- PR 回读：`OPEN`、非 Draft、`MERGEABLE`；reviewed head `00ab982298c04a6a192290cff2588a1de34a55c2`。
- GitHub Actions [run 35504610010](https://github.com/qzhike/zhiju-business-core/actions/runs/35504610010) / job `106062195917`：`FAILURE`；单元/契约阶段通过，PostgreSQL persistence gate 失败 2/493。
- Reviewer focused unit/contract run（直接使用仓内 Vitest，绕过本机 pnpm registry-signature fetch 边界）：6 files、194/194 tests PASS，覆盖 legacy read、Slice order、initial build、DRAFT dependency authorization、composition 与 Event contract。
- `git diff --check 9e87b0b...00ab982`：除 `.vibe/module-specs/Module-Spec-001-IdentityPolicy.md` 新增 EOF 空行提示外无 whitespace error；该提示不是本轮阻断。
- 本机 `pnpm` 启动层因无法从 registry 验证 `pnpm@11.19.0` 签名而拒绝运行，因此 Reviewer 没有把本地 full target 标为已执行；这不覆盖远端精确 head 已失败的正式证据。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收继续 `NOT RUN`。agent 可修复 finding 与 required verifier 未关闭前，不进入 Issue #216 要求的人类技术批准。

本轮 Reviewer 未修改产品代码、migration 或测试，未提交、推送或合并；只追加本地正式审查记录并发布 PR comment。同一账号不能对自己的 PR 提交 GitHub formal `REQUEST_CHANGES` review，因此以 comment 交接，不声称其为 formal review。本轮记录未获 commit/push 授权，保持本地未提交。

## 第 5 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`d9dd2eb798ade80abd50e1d07e18fb60b501f476`
- 审查日期：2026-09-21

### 上一轮 finding 关闭情况

第 4 轮两项 finding 已被本 head 实质处理：

1. `V3004` import guard 现在要求 `project_context_contract` 等于 hashed `canonical_payload`，并把 `contract_ref` 的 kind、objectType、objectId、Scope 与 hash triple 绑定到 cv1 重算结果；legacy read Handler 在返回前独立重算 body digest 并复核同一组字段。原先任意 Core-valid body + 假 digest 仍返回 `FOUND` 的直接反例已关闭。
2. persistence suite 为每个真实 PostgreSQL integration test 使用显式 60 秒 timeout，并跟踪 command driver 的 in-flight promise、在 `afterEach` drain；精确 head GitHub full gate 已恢复为 SUCCESS，`TE-214-D-017` 与后续 `TE-217-D-002` 不再失败。

### Blocking finding

1. **Legacy `contract_ref` 仍不是注册 Result Contract 要求的闭合 `ContentAddressedRef`。** `contracts/src/common.schema.ts:123-135` 对 `contentAddressedRef` 使用 `additionalProperties:false`，其 `scopeRef` 与 `contentHash` 也分别是闭合对象；`execution.get_context_snapshot@1.0` 的 Result 在 `task-execution.schema.ts:1114-1118` 直接引用该类型。当前 `V3004` guard（`V3004__context_snapshot.sql:948-967`）只提取并比较已知字段，没有拒绝 `contract_ref` 根对象、`scope` 或 `contentHash` 的未知成员；read Handler（`context-snapshot-read.ts:155-166`）同样只比较已知字段，没有成员闭集检查。组成层在 `initial-context-entry.ts:1022-1026` 直接返回该 result，也没有调用 `ContractRegistry.validateOperationResult`。因此受控 import 只需在一个完全合法、hash 已闭合的 `contract_ref` 上增加 `unexpected:true`（根对象、scope 或 contentHash 任一层），即可通过 migration guard，并被原样返回，但该公开 Query result 不能通过自己的注册 Schema。

Reviewer 使用精确 head 的 `ContractRegistry.validateOperationResult('execution.get_context_snapshot','1.0', result)` 做正/负控制：完整 baseline 为 `valid:true`；上述三种单成员增量分别在 `/contractRef`、`/contractRef/scope`、`/contractRef/contentHash` 得到 `additionalProperties`。现有 unit/persistence negatives 覆盖值替换，却没有覆盖未知成员，因此 green CI 未捕获该接受集放宽。

请在写入 guard 和 read boundary 两层将存储 ref 限定为注册的闭合形状（包括根对象、Scope、contentHash；并明确 canonical 路径不产生的可选 `immutableVersionId` 是否必须 absent），增加真实 PostgreSQL import tamper 与 Handler focused negatives；或让 read boundary 在返回前通过注册 Result Schema，同时仍保留数据库层的不可写保证。该修复不需要新的产品/架构决定，属于已批准“exact ref / field-by-field closure”的现有范围。

### 验证证据与边界

- PR 回读：`OPEN`、非 Draft、`MERGEABLE`；reviewed head `d9dd2eb798ade80abd50e1d07e18fb60b501f476`。
- exact-head GitHub Actions [run 35543595557](https://github.com/qzhike/zhiju-business-core/actions/runs/35543595557) / job `106165505445`：`SUCCESS`，覆盖配置的 full target 与 PostgreSQL persistence gate 493/493。
- Reviewer focused unit run：`context-snapshot-read.test.ts` 33/33 PASS；这证明当前测试集合通过，不推翻上面的未覆盖直接反例。
- Reviewer focused ContractRegistry probe：合法 Result `valid:true`；root/scope/contentHash 三个未知成员控制样本均 `valid:false`，精确 keyword 为 `additionalProperties`。
- `git diff --check 00ab982...d9dd2eb`：PASS；修正增量限于第 4 轮 finding 涉及的 migration/read/tests 与对应 durable current-state 文档。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收继续 `NOT RUN`。本 finding 关闭且新 exact head 复审通过前，不进入 Issue #216 要求的人类技术批准。

本轮 Reviewer 未修改产品代码、migration 或测试，未提交、推送或合并；只追加本地正式审查记录并发布 PR comment。同一账号不能对自己的 PR 提交 GitHub formal `REQUEST_CHANGES` review，因此以 comment 交接，不声称其为 formal review。本轮记录未获 commit/push 授权，保持本地未提交。

## 第 6 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`81c42c7b6eacf609b2f5120ca400cdd141aea9e4`
- 审查日期：2026-09-21

### 上一轮 finding 关闭情况

第 5 轮的 `contract_ref` 闭合性 finding 已由本 head 处理：`V3004` mirror guard 比较 root、scope、contentHash 的精确 key set，拒绝未知成员及 `immutableVersionId`；legacy read boundary 以真实注册 `contentAddressedRef` Schema 校验原样存储的 ref，并显式禁止 `immutableVersionId`。四条 focused unit negatives 和四条真实 PostgreSQL import tamper negatives 分别覆盖三个额外成员层级与可选版本成员；Reviewer 独立运行 `context-snapshot-read.test.ts`，37/37 PASS。精确 head CI full gate SUCCESS。

### Blocking finding

1. **`TE-214-D-010` 的同 Envelope 并发验收被回退为“失败后重放成功”，不能再证明并发单赢家。** Spec 003 §19.8 第 3 条把同键并发的 in-flight 结果固定为 `COMMAND_IN_PROGRESS`，历史 Receipt 则为 `DUPLICATE`；Module-Test 003 的 `TE-214-D-010` 要求双 Builder 同 DRAFT 同/异键并发恰一成功、无部分事实。`tests/persistence/initial-context.test.ts:4367-4412` 原先断言同 Envelope 的两次并发结果恰好一 `COMMITTED` 与一 `DUPLICATE`/`COMMAND_IN_PROGRESS`；本 head 改为只在这个断言不满足时检查非预期结果是 `rejected`，随后用一次**串行** `attemptBuild(sameEnvelope)` 重放并检查最终行数为 1。没有对异常类型、原因或可恢复性建立闭集，也没有要求并发调用本身至少一次成功。直接反例：两次并发均因任何原因抛出异常、之后串行重放 `COMMITTED` 且只写一行，测试仍 PASS。另一反例：一 `COMMITTED`、一非协议异常、之后 `DUPLICATE`，测试同样 PASS。它将所需的并发协议回归证据偷换成串行恢复证据，CI 绿色不能补足这个缺口。

请保留对两次并发结果的契约断言，并单独诊断/处理原始 CI 中的异常。若确属瞬时基础设施故障，应显式识别并报告该次并发验证未成立，再以新的并发尝试取得有效证据；不要以其后单次重放成功把异常路径记为 `TE-214-D-010 PASS`。若要把任意异常正式纳入同键并发允许结果，则需先更改并批准权威语义，不应由测试单方面放宽。

### 验证证据与边界

- 远端 PR：`OPEN`、非 Draft；exact head `81c42c7b6eacf609b2f5120ca400cdd141aea9e4`。
- exact-head GitHub Actions [run 35566510812](https://github.com/qzhike/zhiju-business-core/actions/runs/35566510812) / job `106229306327`：`SUCCESS`，Verify full repository step 成功，覆盖配置的 full target；上一轮闭合性 negatives 已进入该 head。
- Reviewer focused unit：`context-snapshot-read.test.ts` 37/37 PASS。
- `git diff --check d9dd2eb..81c42c7`：PASS。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收继续 `NOT RUN`。人类技术批准仍是后续独立门禁，本轮不代行。

本轮 Reviewer 未修改产品代码、migration 或测试，未提交、推送或合并；仅追加本地正式审查记录并发布 PR comment。同一账号不能对自己的 PR 提交 GitHub formal `REQUEST_CHANGES` review，因此以 comment 交接，不声称其为 formal review。本轮记录未获 commit/push 授权，保持本地未提交。

## 第 7 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`759b6b62772e2367583ca0773447940cd1f8c217`
- 审查日期：2026-09-21

### 上一轮 finding 关闭情况

本 head 移除了“失败后串行重放成功即算并发 PASS”的路径；有效证据现在必须是同一 Envelope 的两次并发调用本身恰好得到一个 `COMMITTED` 与一个 `DUPLICATE`/`COMMAND_IN_PROGRESS`，且对每次尝试检查目标 Snapshot 行数不超过 1。第 6 轮的直接反例（两次都抛异常、随后串行重放提交）不再能通过。本次增量只改 `tests/persistence/initial-context.test.ts`，未改产品代码或已批准契约。

### Blocking finding

1. **`TE-214-D-010` 仍把任意非协议异常默认为基础设施瞬时故障，最多两次可被后续成功的并发尝试掩盖。** `tests/persistence/initial-context.test.ts:4379-4417` 只从异常提取 `code`/`message`；在 `4392-4395`，仅对非协议的 *fulfilled* 结果失败。若非协议结果为 *rejected*，无论它是原始 pg 驱动错误、稳定业务错误 `IDEMPOTENCY_PAYLOAD_CONFLICT`、授权错误还是代码抛出的普通异常，均仅标为无效尝试并在新 Envelope 上重试。测试既没有识别/限定“瞬时基础设施故障”的错误种类，也没有对该分类提供证据。直接反例：首次并发对返回 `COMMITTED` + thrown `IDEMPOTENCY_PAYLOAD_CONFLICT`（同 Envelope 不允许这种结果），第二次新 Envelope 对得到允许的两种结果；最终行数分别 ≤1/1，整项测试 PASS。此时测试已观察到一次真实协议违约，却将其归类为可忽略的环境抖动。Spec 003 §19.8(3) 与 Module-Test 003 `TE-214-D-010` 不允许这种同键同输入结果。绿色 CI 不能证明被跳过的尝试属于基础设施故障；本 finding 仍是必需验收证据的假阳性窗口，不主张当前生产代码已经复现该错误。

请只对可明确识别、可证明发生在基础设施层的短暂错误撤销本次尝试并重新运行；非协议的稳定模块错误、授权错误与未分类异常应直接令测试失败，并在诊断中保留两次调用的外部结果。若无法可靠区分，应 fail closed 而非默认重试。有效并发对的一 `COMMITTED` + 一 `DUPLICATE`/`COMMAND_IN_PROGRESS` 断言应保留。

### 验证证据与边界

- PR 回读：`OPEN`、非 Draft；exact head `759b6b62772e2367583ca0773447940cd1f8c217`。
- exact-head GitHub Actions [run 35568864491](https://github.com/qzhike/zhiju-business-core/actions/runs/35568864491) / job `106236051348`：`SUCCESS`，Verify full repository step 成功，覆盖配置的 full target。Reviewer 不重复运行本地 full target。
- `git diff --check 81c42c7..759b6b6`：PASS；增量只有上述 persistence test，故前轮 contract/schema/migration 检查结论保持适用。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收继续 `NOT RUN`；Issue #216 要求的显式人类技术审查仍待后续完成，本轮不代行。

本轮 Reviewer 未修改产品代码、migration 或测试，未提交、推送或合并；仅追加本地正式审查记录并发布 PR comment。同一账号不能对自己的 PR 提交 GitHub formal `REQUEST_CHANGES` review，因此以 comment 交接，不声称其为 formal review。本轮记录未获 commit/push 授权，保持本地未提交。

## 第 8 轮：`HUMAN_REVIEW_REQUIRED`

- 结论：`HUMAN_REVIEW_REQUIRED`（agent 复审未发现剩余可修复阻断；Issue #216 的显式人类技术审查仍是合并前门禁）
- Reviewed SHA：`0cd7e06eac3ab715196265d15946fc5191858ab1`
- 审查日期：2026-09-21

### 第 7 轮 finding 关闭情况

本 head 只改 `tests/persistence/initial-context.test.ts`。新增 `isInfrastructureFailure` 以闭集识别 Node 网络 errno、PostgreSQL 连接异常 SQLSTATE、运维干预/资源容量 SQLSTATE 与无 code 的 pg 驱动连接生命周期消息；同 Envelope 并发尝试里，非协议 rejected 结果只有通过此识别才能作废重试。稳定模块/授权码和未分类异常立即失败，并附带两次调用的 code/message。第 7 轮的 `COMMITTED` + thrown `IDEMPOTENCY_PAYLOAD_CONFLICT` 反例现在不能进入重试分支。有效证据仍必须是同一 Envelope 并发对自身的一 `COMMITTED` 加一 `DUPLICATE`/`COMMAND_IN_PROGRESS`；每次尝试检查 Snapshot 行数 ≤1，三次未产生有效并发对会失败。无需更改已批准业务语义。Reviewer 在此增量未发现其他可修复的正确性、范围或文档真值偏差。

### 验证与后续门禁

- PR REST 回读：`OPEN`、非 Draft；远端 head 与本地一致，为 `0cd7e06eac3ab715196265d15946fc5191858ab1`。
- exact-head GitHub Actions [run 35572186100](https://github.com/qzhike/zhiju-business-core/actions/runs/35572186100) / job `106245949471`：`SUCCESS`；`Verify full repository` step 成功，覆盖项目配置的 clean build/full target 与 Docker/PostgreSQL persistence gate。Reviewer 未重复运行本地 full target。
- `git diff --check 759b6b6..0cd7e06`：PASS；本次增量仅该 persistence test。此前闭合的契约、migration、授权与组装结论未被本次增量修改。
- Issue #216 明确要求合并前对授权、不可变持久化、RLS、契约兼容、跨模块最小化、并发与重放进行**显式人类技术审查**；当前 PR 评论与 formal reviews 中未见针对该 exact implementation head 的人类技术批准。此剩余权限/判断门禁不能由 agent 复审、绿色 CI 或本条 comment 替代。下一步交由人类技术审查，之后若 head 再变须重核。
- 外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收保持 `NOT RUN`；这些超出本次初始 Context 切片的证明范围，不据此声称 IM-06 完成或可部署。

本轮 Reviewer 未修改产品代码、migration 或测试，未提交、推送或合并；仅追加本地正式审查记录并发布 PR comment。同一账号不能对自己的 PR 提交 GitHub formal review，因此本结论以 PR comment 交接，不声称 formal `APPROVE`；Review.md 本地增量仍未获 commit/push 授权。

## 人类技术批准（PR #217，2026-09-21）

- 批准来源：用户在第 8 轮 `HUMAN_REVIEW_REQUIRED` 结论及其剩余门禁说明之后，明确回复“批准”。本记录按该直接上下文将其限定为 Issue #216 要求的人类技术审查批准，不扩大解释为 merge、部署、破坏性迁移、commit 或 push 授权。
- 批准所对应的精确实现 head：`0cd7e06eac3ab715196265d15946fc5191858ab1`。记录前以 `vibe repo --json` 及 GitHub PR REST 回读确认本地和远端 head 相同，PR 为 OPEN、非 Draft。
- 批准的技术范围：Issue #216 指定的授权组成、不可变持久化、RLS、契约兼容、跨模块最小化、并发与重放。第 8 轮独立 agent 复审及 exact-head CI 是供人类判断的现有证据；本记录只忠实转录用户的明确批准，不替用户编造未陈述的独立分析过程。
- 仍需遵守的边界：若 PR head 再变，须对新 head 重新核对独立审查、验证与人类技术批准；合并仍需用户另行明确授权。外部 Provider/Runtime/飞书、部署、生产、负载/性能与独立人工业务验收维持 `NOT RUN`，不据本批准宣称 IM-06 完成或可部署。
- 本节为本地正式 Review 文档增量，未获得 commit/push 授权；PR comment 是可回读的远端批准记录，不能冒称 GitHub formal review。
