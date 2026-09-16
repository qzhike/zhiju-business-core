# PR #207 独立审查

## 第 1 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`fbca61828e2e5791d8b0ac8282ee0c39eeac7e0d`
- Base SHA：`75553dec7afd87f25dc38230db9f884921b7e899`
- PR：[#207](https://github.com/qzhike/zhiju-business-core/pull/207)
- Work item：[#206](https://github.com/qzhike/zhiju-business-core/issues/206)（T2 design）
- 审查日期：2026-09-16

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #206、PR 最新 head 与实际 diff、受影响 Module Spec/Test、TaskExecution 决定、Typed Reference/Catalog、Domain、PostgreSQL 和 IdentityPolicy 授权边界，以及精确 revision 的 CI 与本地完整验证证据；未把实现者的 PR 描述或评论当作正确性依据。

## 阻断发现

### 1. Readiness 生产者缺少可执行的 owning 授权映射

`Module-Spec-003-TaskExecution.md` §17.4 为 `execution.build_task_readiness@1.0` 固定了 Purpose `execution.task.readiness.build`、CREATE target `zhiju.execution.task_readiness`，并要求调用者持有对应 Decision；§17.5 第 1 步又明确要求通过 `Module-Spec-001-IdentityPolicy.md` §15.5 的 Port 在幂等 Claim 和历史 Receipt 返回前完成签发/重验。

但 Spec 001 §15.5 的 `TaskExecutionReadinessAuthorizationPort` 只有一条精确 `(type, version)` 映射：

- operation：`execution.mark_task_ready@1.0`
- Purpose：`task.execution.mark_task_ready`
- target：`OBJECT`，且 objectType 只能是 `execution.task` 或 `zhiju.execution.task`
- Grant selector：`TARGET_TYPE`

它没有 `execution.build_task_readiness@1.0` 的条目，也不能用现有 mark 条目代替：生产者的 operation/version、Purpose、target identity 和 CREATE selector 语义都不同。Spec 001 §15.5 还明确称该节只为 `mark_task_ready@1.0` 的消费边界提供 owning 授权边界。

因此，按当前权威文本，一个完全合法的 build 命令及 `execution.task.readiness.build` Decision 没有可路由、可签发和可重验的 owning Port；实现者只能自行决定是扩展既有 creation Port、扩展 Readiness Port，还是另建映射。这违反 Issue #206 “后续实现不得发明授权语义”的 Goal，也使 TE-P206-001/002/013 的合规生产者基线不可执行。

要求：在 IdentityPolicy owning 规格与 TaskExecution 调用顺序中补齐并统一生产者的精确授权条目，至少固定 `(type, version)`、Purpose、required Grant action、CREATE target kind/objectType、selector 类型、trusted capability config key，以及签发/重验与当前 Decision 的顺序；同步更新决定、验收矩阵及受影响的持久化/组成边界。消费者 `mark_task_ready@1.0` 的独立授权条目必须保持独立，不得复用或隐式继承生产者资格。

## 其余独立核对

- 两个 public reference identity、R-206-1 的版本绑定 Task 拼写、`mark_task_ready@1.0` 的冻结接受集、Catalog 213 → 214 / TaskExecution 43 → 44 / Baseline 200、生产者无事件与消费者唯一 `execution.TaskReady@1.0` 的边界在已读文档中一致。
- `TE-P206-D-001`–`D-004` 与 `TE-P206-001`–`018` 明确区分设计/static evidence 和未来 runtime evidence；Handler、判断持久化、RLS/ACL、重放、并发和实际事件发布仍标为 `NOT RUN`。
- `git diff --check 75553dec7afd87f25dc38230db9f884921b7e899..fbca61828e2e5791d8b0ac8282ee0c39eeac7e0d` 通过，工作树在评审记录创建前干净。

上述授权缺口已经足以阻断批准；本轮没有把绿色 verifier 当作契约正确性的替代，也没有在 Reviewer 角色内修复设计。

## 验证证据

- 精确 reviewed SHA 的 GitHub Actions [run 35065077179](https://github.com/qzhike/zhiju-business-core/actions/runs/35065077179) / verify job [104693459932](https://github.com/qzhike/zhiju-business-core/actions/runs/35065077179/job/104693459932) 已回读为 `COMPLETED / SUCCESS`，head 为 `fbca61828e2e5791d8b0ac8282ee0c39eeac7e0d`。
- 本地在同一 SHA 运行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`，结果为 `PASS`，resolved command 为 `pnpm clean && pnpm verify`，exit code 0。
- regular suite：59 files / 969 tests passed（37 files / 406 tests skipped）。
- public API generation：213 operations；policy profiles 7；evaluator profiles 2；creation purposes 4。
- catalog/registry：213/213；Compatibility Baseline：200 operations。
- PostgreSQL 18.6 / Flyway 11.20.3 persistence gate：41 files / 421 tests passed；空库迁移、V6003/V6004 历史升级和第二次 migrate no-op 全部通过，容器已清理。

## 未运行边界与后续门禁

本 PR 是设计交付，不包含 `execution.build_task_readiness@1.0`/两个 objectType/错误码的注册、Handler、`execution_judgment` migration、IdentityPolicy Port 接线、真实 READY 转换或业务验收。`TE-P206-001`–`018` 的 runtime 行保持 `NOT RUN`；依赖 COMPLETED 可用性与 blocking InformationRequest 分支仍因依赖未交付而不可达。

`REQUEST_CHANGES` 针对精确 SHA `fbca61828e2e5791d8b0ac8282ee0c39eeac7e0d`。修复后须重新审查新的 PR head，并在新的 exact-head 证据上判断；当前结论不授权 merge、实现、创建依赖 Issue、commit 或 push。Issue #206 要求的显式人类设计批准也仍未完成。

## 第 2 轮：`APPROVE`

- 结论：`APPROVE`（本轮无阻断发现）
- Reviewed SHA：`2155d4dd89437694632c0e35ca65b7d6d46d720f`
- Base SHA：`75553dec7afd87f25dc38230db9f884921b7e899`
- 第 1 轮 reviewed SHA（本次修复的起点）：`fbca61828e2e5791d8b0ac8282ee0c39eeac7e0d`
- PR：[#207](https://github.com/qzhike/zhiju-business-core/pull/207)（`OPEN`，head `2155d4dd…`、base `75553de…`，远端读回）
- Work item：[#206](https://github.com/qzhike/zhiju-business-core/issues/206)（T2 design）
- 审查日期：2026-09-16

本轮独立读取了 Issue #206、两个 diff（`75553de..2155d4d` 全量、`fbca618..2155d4d` 修复增量）、Spec 001 §13.7/§14/§15、Spec 003 §16.9/§16.10/§17、决定 §12.5/§14/§16、Module-Test-003 的 `TE-P206-*`、Catalog `#206` 节、PostgreSQL §33、Domain §18.5/§18.8 尾部与 roadmap，并直接对照当前 Registry、V1006 migration 与既有授权实现；未把实现者的 PR 描述或评论当作正确性依据。

### Finding 1（第 1 轮唯一阻断项）：已关闭

第 1 轮的阻断项是“Readiness 生产者 `execution.build_task_readiness@1.0` 没有可路由、可签发、可重验的 owning 授权映射”。在本 revision 已按要求闭合：

- `Module-Spec-001-IdentityPolicy.md:623` 的 §15.5 标题已改为 “IM06-READY-01 Task Readiness 生产与 READY 转换授权组成提案（#206）”；`:633` 新增**生产者行**：`execution.build_task_readiness@1.0` / 角色 `生产者 / CREATE` / Purpose `execution.task.readiness.build` / required Grant action `execution.task.readiness.build` / target `OBJECT` + `zhiju.execution.task_readiness`（单值）/ selector `CREATE_TARGET_TYPE` / config key `taskReadinessBuildV1`；`:634` 保留**消费者行**：`execution.mark_task_ready@1.0` / `消费者 / MUTATE` / Purpose `task.execution.mark_task_ready` / action `execution.task.mark_ready` / target `OBJECT` + 两个已发布 Task 拼写（闭集）/ selector `TARGET_TYPE` / config key `taskReadyV1`。
- 两条映射显式独立：`:637` 固定“不同 Purpose/action/selector 类型/config key/Decision，无共同 entry、无继承、无别名、无 Purpose 近似匹配”，并要求两个 target objectType 集合不重叠（生产者是被创建的 `zhiju.execution.task_readiness`，消费者是既有 Task 的两个拼写），组成层不得交叉复用。`:638` 固定 producer 用 `CREATE_TARGET_TYPE`（沿用 §15.2 第 3 条）、consumer 用 `TARGET_TYPE`。`:639` 明确两个 Task 拼写不是别名，期望拼写由 owning 创建事实决定。`:640` 固定物理表复用 V1006 的 target 列、不需要新的 IdentityPolicy migration。
- 顺序与 fail-closed 不变：`:636`（§15.5 第 1 条）要求签发/重验并重读当前 covering Grant/Policy，且**在幂等 Claim 与历史 Receipt 读取之前**；`Module-Spec-003-TaskExecution.md:1110`（§17.5 第 1 步）绑定**生产者条目**（Purpose `execution.task.readiness.build`、`CREATE_TARGET_TYPE`、`taskReadinessBuildV1`）；`Module-Spec-003-TaskExecution.md:1163`（§17.8 第 1 步）绑定**消费者条目**（Purpose `task.execution.mark_task_ready`、`TARGET_TYPE`、`taskReadyV1`，与生产者条目互相独立，生产者 Decision/Grant/配置不能替代）；`Module-Spec-003-TaskExecution.md:1099`（§17.4 Actor 边界）把生产者 Decision 指向生产者条目，并声明消费者条目是另一条独立映射。
- 两个条目在本 revision 保持 `NOT RUN`：`Module-Spec-003-TaskExecution.md:1206`（§17.10）把“Spec 001 §15.5 的两个授权条目（签发/重验与组成层接线）”明确列在未运行边界。
- 验收矩阵覆盖该映射：`Module-Test-003-TaskExecution.md:259`（`TE-P206-D-005`，Design，`DESIGN VERIFIED`）对账两条映射 vs §17.4/§17.5/§17.8、compat metadata 两个 Purpose 与 V1006 target 列；`Module-Test-003-TaskExecution.md:272`（`TE-P206-013`）含跨 entry 的 Decision、Grant/capability 配置与 `CREATE_TARGET_TYPE` selector 负例（含反向），并固定“重验严格先于幂等 Claim 与历史 Receipt 返回”。

Purpose 值与既有权威一致（本项为新增行的直接核验）：生产者的 `execution.task.readiness.build` 与既有设计值一致（`Module-Spec-003-TaskExecution.md:370`（§11.1）、`:748`（§11.9）、`decisions/task-execution-human-operated.md:443`（§12.5 表））；消费者的 `task.execution.mark_task_ready` 与已发布值一致（`contracts/registry/operation-compatibility-metadata.v1.json:402`），且 `Module-Spec-003-TaskExecution.md:161`（§3）已按 §15.1 同一规则把该行设计期文字修正为已发布值。

结论：合法的 build 命令现在有完整、唯一、可实现的授权路由，消费者资格没有被生产者资格替代或继承；第 1 轮 finding 1 关闭。

### 修复增量回归扫描（`fbca618..2155d4d`，8 个 `.vibe` 文档，30 +/-26）

- 变更只落在文档：新增/改写授权条目与其交叉引用，**没有**改动 `contracts/`、`migrations/`、代码、生成物或 fixture（`git diff --name-only` 仅 `.vibe/**/*.md`）。
- 没有收窄或放宽任何已发布接受集：`execution.mark_task_ready@1.0` 的注册条目仍为 `schemaStatus=FULL`、无 `targetObjectType`、无 `authorizationPurpose`（`contracts/registry/public-api.v1.json` 读回）；`reference_edge`/`execute_task` 等既有条目未触及。
- §15.5 标题改名后，全仓 12 处锚点全部使用同一新锚点 `#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206`（`grep` 计数，分布于 Spec 003、决定、Module-Test-003、Domain、Catalog、roadmap），旧锚点 `…-task-ready-授权组成提案206` 已无残留；新锚点与标题正文（lowercase、空格→`-`、`（）`/`#` 剥离）自洽。
- 新条目与 §15.1/§15.2/§15.3 不矛盾：`CREATE_TARGET_TYPE` 闭集沿用 §15.2 第 3 条（`Module-Spec-001-IdentityPolicy.md:607` 与其实现 `modules/identity-policy/src/commands/task-execution-creation-authorization.ts:78-79`、`:895-899`）；`TARGET_TYPE` 是同一 Port 家族内新增的 selector 解释类型，不要求改动已注册 Schema——Grant 的 `resourceSelectors` 在契约层本就是开放形状（`contracts/src/core.schema.ts:348`、`contracts/src/operations/identity-policy.schema.ts:167`）。
- PostgreSQL §33 的表述与 migration 现实一致：`migrations/identity_policy/V1006__identity_policy_creation_decision_target.sql` 只增加可空 `target_object_type`/`target_object_id` 与成对 CHECK、并由 mirror guard 强制 canonical payload `targetRef`（objectType/objectId/scope）与镜像列一致；迁移对 objectType 取值**没有**枚举或 CHECK 限制，因此 `zhiju.execution.task_readiness` 与两个 Task 拼写都能复用同一列，`07-postgresql-logical-model-v0.1.md:2167` 的“不新增 IdentityPolicy 存储、两条目复用 V1006 列”成立。
- 生产者行的 target 形态有既有先例：`contracts/registry/public-api.v1.json:55-94`（`identity.record_policy_version@1.0`）同样是 `targetObjectType=zhiju.identity.policy_version` + `/targetRef` 声明 `OBJECT` + 结果 `resultReferences` 声明 `SNAPSHOT`，与 Spec 003 §17.4 `:1096`/`:1097` 的 OBJECT target / SNAPSHOT result 形态一致。
- `TE-P206-013` 由“用消费者 Purpose 的 Decision”收紧为“用消费者**条目**的 Decision”并加入 Grant/config 与 selector 负例：是覆盖增强，不是接受集收窄。
- `git diff --check fbca618..2155d4d` 与 `git diff --check 75553de..2155d4d` 均通过（无空白/冲突残留）。

### 其余 Issue #206 验收维度（新 head 仍成立）

- 受限引用身份：`17.2`（`:1046-1057`）两个 objectType（`zhiju.execution.task_readiness` SNAPSHOT、`zhiju.execution.task_definition_snapshot` CONTENT_ADDRESSED）、`objectId==snapshotId`、Project Scope、不可作 BusinessOutput、按 exact id+Hash 解引用，与 Catalog `#206` 节（`06-…catalog…:1254-1263`）逐项一致。
- R-206-1（`:1059-1081`）：拼写由不可变创建事实 `task_definition_snapshot.schema_version` 派生（v1→`execution.task`、v2→`zhiju.execution.task`），无别名/规范化/latest 回退，唯一拒绝码 `EXECUTION_TASK_REF_INVALID`；未改 v1 冻结 fixture 与两个 `create_task` Major 的接受集。
- `mark_task_ready@1.0` 零改动：注册条目存在且未加 `targetObjectType`/Purpose 字段（Registry 读回），Catalog 与 compat metadata 的 Purpose 仍为 `task.execution.mark_task_ready`。
- 计数：当前 `public-api.v1.json` 213 条、`operation-compatibility-metadata.v1.json` 213 条、`v1.0-baseline` 200 条、task-execution 43 条（23 COMMAND / 9 QUERY / 11 EVENT，与 §17.4 `:1102` 的“实现后 44：24/9/11”目标态相加自洽）；`build_task_readiness` 在 Registry 中 0 条（`jq` 读回），与 §17.10 `:1204` 的“未注册、未实现、未分配 migration”一致。
- 事件边界：`execution.*` Event 恰 11 条且含 `execution.TaskReady@1.0`，无 `TaskCreated`/`TaskReadinessBuilt`；与 §17.7（生产者 Outbox 0 行）与 §17.8 第 8 步（消费者恰一条 `execution.TaskReady@1.0`）一致。
- 消费侧依赖的既有边界仍存在：`policy-profiles.v1.json` 7 个 profile、`evaluator-profiles.v1.json` 2 个 profile（§17.6 只消费、不新增注册），四个创建 capability config key 仍在实现中（`taskV1`/`taskV2`/`workOrderV1`/`workOrderV11`）。
- 未运行边界：§17.10 `:1204-1206` 与 Module-Test-003 `:247-251`、`:260-275` 一致地把 Handler、`execution_judgment` 持久化、两个授权条目接线、真实 PostgreSQL/RLS/重放/并发、真实 READY 转换与业务验收标为 `NOT RUN`；依赖未交付的 COMPLETED 可用性分支（`TE-P206-005`）与 blocker 分支（`TE-P206-010`）单独标注。

### 本轮实际读取的证据

- 远端：`gh pr view 207` → `state=OPEN`、`headRefOid=2155d4dd89437694632c0e35ca65b7d6d46d720f`、`baseRefOid=75553dec7afd87f25dc38230db9f884921b7e899`；PR 评论已发布该 SHA 的本地 `vibe verify full --json` PASS 记录，与本轮回读的 CI 一致。
- CI 回读（本轮自行执行，未重跑任何门禁）：`gh run view 35067179960` → `status=completed`、`conclusion=success`、`headSha=2155d4dd89437694632c0e35ca65b7d6d46d720f`；`gh run view --job 104700009988` → `status=completed`、`conclusion=success`、`name=ci`、同一 headSha。该 SHA 的本地 `vibe verify full --json` 结果（`PASS`；regular 59 files/969 tests；persistence 41 files/421 tests；Catalog 213；Baseline 200）为已发布的 exact-head 证据，本轮按约束未重跑。
- 仓库现实：Registry/compat/profile 计数与条目字段（`jq`）、`V1006` migration 全文、`task-execution-creation-authorization.ts` 的闭集 selector 实现、Grant selector 在契约层的开放形状、`record_policy_version@1.0` 的 target/result 形态、git 工作树状态（除本记录外无改动）。
- 未运行边界（本轮自身）：按要求未执行 `vibe verify`、`pnpm`、formatter、linter 或任何构建/测试命令；结论基于上述已发布 exact-head 证据与逐节文本对账。

### 非阻断观察（不要求本 revision 修改）

- `Module-Spec-001-IdentityPolicy.md:636` 末尾的“（§14.5 同一决定）”是指向决定文档 §14.5（`decisions/task-execution-human-operated.md:614` 起，该节自身在 `:612`/`:636` 也以“§14.5”自称）的裸引用；Spec 001 自身的 §14 没有子节，读者可能误解析为 Spec 001 §14.5。属文档可读性问题，不改变任何规则或接受集，且在第 1 轮 revision 中已存在，本轮不作为阻断项。

### 未运行边界与后续门禁

本 PR 仍是设计交付：`execution.build_task_readiness@1.0`、两个 objectType、`EXECUTION_TASK_REF_INVALID`、`V3002` 与 `execution_judgment` 均未注册、未实现、未分配编号；两条授权条目的签发/重验与组成层接线、Handler、RLS/ACL、直 SQL 篡改、回滚、并发、重放、真实 READY 转换与业务验收保持 `NOT RUN`。

`APPROVE` 是对精确 SHA `2155d4dd89437694632c0e35ca65b7d6d46d720f` 的独立 agent design review 结论，只解除独立审查门禁；Issue #206 要求的显式人类设计批准仍未完成。本结论不授权 merge、实现、创建依赖 Issue、commit 或 push。
