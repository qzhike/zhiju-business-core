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
