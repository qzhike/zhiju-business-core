# PR #215 独立审查

## 第 1 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`318c7f0d817d5e9278ac38a3fae0919f7fbaebfc`
- Base SHA：`0be76e0c62b722393d1c500772dab7dfa2a34db9`
- PR：[#215](https://github.com/qzhike/zhiju-business-core/pull/215)
- Work item：[#214](https://github.com/qzhike/zhiju-business-core/issues/214)（T2 design）
- 审查日期：2026-09-18
- GitHub handoff：[#issuecomment-5725284981](https://github.com/qzhike/zhiju-business-core/pull/215#issuecomment-5725284981)（同账号无法审查自己的 PR，因此是 comment，不是 GitHub formal review）

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #214、PR 最新 head
与实际 diff、受影响的 TaskExecution/IdentityPolicy Module Spec/Test、Core
ProjectContext Contract、PostgreSQL 持久化设计、已注册 operation Schema/Registry/
Compatibility metadata、现行 Source Slice 契约与 exact-head 验证证据；未把 PR 描述
或实现者总结当作正确性依据。

## 阻断发现

### 1. `get_context_snapshot@1.0` 的拟议授权 Purpose 与已发布 metadata 不一致

Spec 001 §15.8 把 `execution.get_context_snapshot@1.0` 的 Purpose 定义为
`execution.context.snapshot.read`，并以同名 Grant action 建立读取条目；但当前
Compatibility metadata 对该 exact operation/version 发布的 Purpose 是
`task.execution.get_context_snapshot`。同一 Delta 又明确分类为 Query/Registry/
Compatibility metadata “零改动”。

这不是字符串风格问题：条目声称按 `type@version` 签发并在返回事实前重验
Decision 的 operation/version/Purpose，使用未注册 Purpose 会使读取 Decision 无法与
现行 operation metadata 闭合；若实现通过修改 metadata 迁就新 Purpose，又违反本 PR
的零改动兼容结论并改写 `v1.0-baseline`。

要求：在保持“零 Contract/Registry 改动”结论时，读取授权条目必须使用已发布的
`task.execution.get_context_snapshot`，并在 Spec 001、Spec 003、决定摘要与
`TE-214-D-015/016` 中保持一致，增加 exact operation/version/Purpose 对账及错 Purpose
替换负例。若确实要采用新 Purpose，则必须把它作为公开兼容性变化重新分类，而不能继续
声称 metadata 不变。

证据位置：

- `.vibe/module-specs/Module-Spec-001-IdentityPolicy.md:689`
- `contracts/registry/operation-compatibility-metadata.v1.json:582`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1576`

### 2. “确定性组装”规则不能生成符合 ProjectContext v1.0 的 payload

Spec 003 §19.4 要求 `purpose/audience` “原样进 projection”，并要求
`sourceManifest` “列出 DRAFT ref + 每片 exact ref + Policy 观测”。这与当前已注册的
Core Contract 直接冲突：

| 边界 | 现行字段契约 | PR 的映射 | 结果 |
|---|---|---|---|
| `InitialContextBuildRequest.audience` | `PrincipalRef` 对象 | 原样写入 `projection.audience` | 目标字段是 `NonEmptyString`，结构校验失败 |
| `ProjectContext.sourceManifest` | `additionalProperties: false`；固定字段为 enterprise profile、QMS、可选 baseline refs、`policyRefs`、`schemaRefs`、`externalAuthoritySnapshotRefs` | 直接列 DRAFT、Slice、Policy observation | Contract 没有 DRAFT/Slice 通用槽位，无法按文字实现 |
| `ContextSourceSlice.source.factItems` | `CanonicalJson[]` | 只说按 profile/输入生成内容 | 目标 `contextItems[]` 是 closed `ContextItem`，缺少逐字段、排序、ID、epistemic/evidence/provenance 映射 |

因此，同一组合法输入不存在由 §19.4 唯一确定、且能通过 ProjectContext v1.0 Schema 的
输出。实现者必须自行发明 audience 的字符串编码、DRAFT/Slice provenance 放置位置、
Source Slice 的 `enterpriseProfileSnapshotRef`/`qmsConfigurationRef`/
`productScopeSnapshotRef`/`activeBaselineRefs` 到 SourceManifest 的合并/冲突规则，以及
`factItems` 到 closed `ContextItem` 的转换；这正是 Issue #214 要求在实现前关闭的语义。

要求：给出 ProjectContext v1.0 每个必填顶层和嵌套字段的确定性来源矩阵，包括多 Slice
相同/冲突 ref 的裁决、typed baseline 分类、policy/schema/external-authority manifest
生成、fact/item ID 与顺序、omission/redaction/coverage/sourceWatermark 合并，以及
PrincipalRef audience 到现行字符串字段的明确表示；或者先走 additive Core Contract
版本。同步补齐干净的正向 fixture 和每项映射的单变量负例，不能只依赖现有通用 Schema
绿灯。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1589`
- `contracts/src/operations/task-execution.schema.ts:580`
- `contracts/src/core.schema.ts:104`
- `contracts/src/operations/enterprise-project.schema.ts:354`
- `.vibe/high-level-docs/03-core-contracts.md:138`

### 3. 当前 owning Spec 同时把 build @1.0 写成“合法调用”和“无满足输入”

Spec 003 §11.2 与已批准的 §11.2.6 仍声明“既有 @1.0 合法调用”不变，并把
`build_initial_context_snapshot@1.0` 列为合法字段/Envelope 语义保持不变；新增 §19.1
则声明该版本没有任何可满足输入、不实现 Handler、不创建授权路径，所有调用在授权层
fail closed。后两种运行语义不能同时作为当前实现权威。

Issue #214 确实授权本 Delta 判断某个已注册路径不可满足；问题在于本 revision 没有在
原 owning 段落中标明被 §19.1 取代的具体语义，导致后续 Implementer 无法判断应实现
“合法 @1.0”还是“永久无路由 @1.0”。仅保留 Schema/Envelope 字节不变，也不能证明
“合法调用”与“无可授权输入”是一回事。

要求：对 §11.2/§11.2.6 做最小、显式的现状协调，区分“Schema 仍接受原字段形状”与
“IM-06 当前不存在可成功业务输入”，并指出 §19.1 对旧设计语义的精确 supersession；
同步决定摘要和测试矩阵，避免把历史兼容接受集误写成可执行业务路径。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:405`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:594`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:598`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1563`

## 验证证据

- 发布前核对的 PR head：`318c7f0d817d5e9278ac38a3fae0919f7fbaebfc`；base：
  `0be76e0c62b722393d1c500772dab7dfa2a34db9`；PR 为 OPEN、非 Draft、MERGEABLE。
- exact-head GitHub Actions run `35306685018` / job `105480214505`：`SUCCESS`；执行
  `pnpm verify`，普通测试 101 files（62 passed / 39 skipped）、1527 tests
  （1071 passed / 456 skipped），真实 PostgreSQL gate 43/43 files、471/471 tests，
  second migrate no-op，`gate passed` 且容器已清理。
- Reviewer 执行 `vibe verify full --json`：首次受沙箱容器可见性限制返回
  `VERIFY_FAIL`（静态/契约/普通测试均已通过，容器策略不可用）；按既有 OrbStack
  recovery 使用同一 target 重跑后 `PASS`，resolved command `pnpm clean && pnpm verify`，
  exit 0。Catalog/Registry 215、Compatibility Baseline 200、普通测试 1071、真实
  PostgreSQL 18.6 persistence tests 471，二次迁移 no-op，容器清理成功。
- `git diff --check 0be76e0c...318c7f0d`：PASS；发布前工作树原本 clean。

绿色 verifier 证明现有仓库没有回归，但本 PR 是 design-only Delta，`TE-214-D-*` 全部
仍为 `NOT RUN`；现有测试不会自动证明新文档中的授权 Purpose 或 ProjectContext 组装
语义可实现，因此不能消除上述直接契约反例。

## 未运行边界与后续门禁

Initial Context Handler、authorization Port、`context_snapshot`/
`context_snapshot_build` migration、权威 Context Query、真实 RLS/并发/重放、完整
Context→Validation→Freeze 链、外部 Provider/Runtime/飞书、公开 HTTP、生产、负载/
性能与独立人工业务验收均为 `NOT RUN`。

本轮存在 agent 可修复的设计阻断，因此尚未进入 Issue #214 要求的最终人类设计/技术
review gate。修复后的新 exact head 必须重新独立审查；人类批准不能回填到当前已知有
缺陷的 revision。

本轮未修改产品代码，未提交、推送或合并任何变更；只新增本地正式审查记录并发布 PR
comment。该记录在未获得提交/推送授权前保持本地未提交状态。

---

## 第 2 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`7382ece94f45239b45d875e0313a04735ee0aa25`
- Base SHA：`0be76e0c62b722393d1c500772dab7dfa2a34db9`
- PR：[#215](https://github.com/qzhike/zhiju-business-core/pull/215)
- Work item：[#214](https://github.com/qzhike/zhiju-business-core/issues/214)（T2 design）
- 审查日期：2026-09-18
- GitHub handoff：[#issuecomment-5725494771](https://github.com/qzhike/zhiju-business-core/pull/215#issuecomment-5725494771)（同账号无法审查自己的 PR，因此使用 comment，不是 GitHub formal review）

本轮独立复核了 `318c7f0d...7382ece9` 的修订、Issue #214、#188 已交付的
Source Slice Schema/owning Spec/实际 assembly、ProjectContext v1.0 Contract、DRAFT
Contract 与 exact-head 验证证据。上一轮 Finding 1 的 Purpose 对账，以及 Finding 3 的
@1.0 supersession 已关闭；Finding 2 虽补充了目标字段矩阵，但矩阵没有与 #188 的真实
Source Slice payload 对账，仍留下阻断性的输入/输出契约断裂。

## 阻断发现

### 1. 新 fact/omission/redaction 映射不接受 #188 实际产出的任何 Source Slice

Spec 003 §19.4 第 6 条把 `slice.source.factItems[i]` 规定为必须含
`kind, subjectRef, epistemicState, value, permittedUses, sensitivity` 的对象；第 7 条把
omission 规定为必须含 `category, reasonCode, effectOnTask`，把 redaction 规定为必须含
`fieldPath, policyRef, reasonCode`。缺任一成员就拒绝
`EXECUTION_CONTEXT_SOURCE_INVALID`。

但 #188 已交付且本 Issue 明确要求对账的 owning implementation 产生的是：

- Fact 元数据：`{factRef, factType, riskLevel, status, value}`；它没有 `kind`、
  `subjectRef`、`epistemicState`、`permittedUses` 或 `sensitivity`。
- Omission：`{kind, reasonCode}`；它没有 `category` 或 `effectOnTask`。
- Redaction：`{path, reasonCode}`；它没有 `fieldPath` 或 `policyRef`。

这不是只影响边缘 fixture：若 `ENTERPRISE_FACTS` 未请求或 Purpose 禁止，#188 会产生
上述 omission；若允许且请求 Facts，#188 即使没有任何 Fact，也会固定加入两条通配
redaction。未请求其他已知 kind 也会产生同形 omission。因此当前 §19.4 的规则无法接受
#188 正常捕获的 Source Slice，`@1.1` 仍没有文档所声称的可满足输入。

同一问题也使 `coverage.includedScopes :=` 全部 Slice purpose 的结论不成立：设计在拒绝
现行 omission/redaction 的同时，又没有定义如何把 #188 的 `productScopeSnapshotRef`、
`activeBaselineRefs` 和安全 Fact 元数据实际纳入 ProjectContext，却宣称全部请求面已纳入。
现有测试矩阵只构造了 PR 新设想的 fact/omission/redaction 形状，没有要求使用 #188
真实 Query/capture 输出做正向 fixture，因此无法发现这条断链。

要求：以 #188 已交付的 payload 为输入权威，明确其 Fact 元数据到 closed `ContextItem`
的可实现映射（或明确哪些输入被有理由省略并正确反映 coverage），以及
`{kind,reasonCode}` / `{path,reasonCode}` 到 Core omission/redaction 的确定性转换。若现有
Source Slice 缺少 Core 必填语义，必须回到 readiness 决定 additive owning Contract/
operation 版本或其他获批来源，不能要求 TaskExecution 假定未发布字段。正向 golden
fixture 必须直接使用 #188 的真实输出形状，并覆盖 Facts requested/forbidden、空 Fact、
未请求 kind 与通配 redaction；负例再从该合法基线做单变量变异。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1622`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1623`
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md:664`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:225`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:269`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:369`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:386`
- `contracts/src/operations/enterprise-project.schema.ts:354`

### 2. DRAFT 的 target/input 映射仍不是封闭、确定的组装规则

§19.4 把 `artifactContext` 固定为空，并称“DRAFT `inputRefs` 已经 Source Slice 携带”；
但 #188 Source Slice 的固定 payload 没有 DRAFT `inputRefs` 字段，只有 Project/Profile/
QMS/ProductScope/baseline/Fact 等 owning 数据。`InitialWorkOrderDraft.inputRefs` 则仍接受
通用 `InputRef.ref: TypedReference`，§18.6 明确把其存在性、生命周期、Purpose 裁剪留给
Context Builder，§11.2.1 也要求 Builder 按 `inputRefs.permittedUse/contentAccessMode`
裁剪。当前固定空数组会静默丢弃合法 DRAFT 输入，也没有生成 omission/unresolved/拒绝。

同时，`targetScope.targetObjectRefs` 是可含零个或多个 TypedReference 的 Set，§19.4
却只说“可派生 DeliveryItem 身份时取单元素集合，否则空集”，没有定义多 DeliveryItem、
混合 objectType、重复业务身份或没有可解析 owning 事实时的选择/拒绝规则。实现者仍需
发明如何得到唯一的 `workContext.deliveryItemRefs`。

要求：给出 DRAFT `inputRefs` 与 `targetScope` 的支持集、owning read/授权/裁剪、排序、
多值及不支持值处理，并将采纳、omission/unresolved 或 fail-closed 结果逐项绑定到
ProjectContext。若本实现切片只支持 Source Slice 类型输入或至多一个 DeliveryItem，必须
在 Builder 边界显式规定并以合法基线正反 fixture 证明；不能依赖 Source Slice 携带它
实际没有的字段。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:435`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1350`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1351`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1609`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1611`
- `contracts/src/core.schema.ts:294`
- `contracts/src/core.schema.ts:356`
- `contracts/src/operations/enterprise-project.schema.ts:378`

## 已关闭的上一轮发现

1. Snapshot Query Purpose 已改为逐字符复用已发布的
   `task.execution.get_context_snapshot`；Grant action 被明确为内部 token，
   `TE-214-D-015` 增加了错 Purpose 负例。
2. §11.2/§11.2.6 已显式区分 Schema/Envelope 字段形状合法与 @1.0 业务路径不可满足，
   并由 §19.1 精确 supersede 原“合法调用”表述。
3. audience 编码、固定 Core 字段矩阵、manifest 公共值冲突、DRAFT provenance 与
   fixture 要求已补充；但如上两项所述，Source/DRAFT 的真实输入形状仍未闭合，所以上一轮
   Finding 2 不能判定为完全关闭。

## 验证证据

- 发布前回读：PR 为 OPEN、非 Draft、MERGEABLE，merge state `CLEAN`；head 仍为
  `7382ece94f45239b45d875e0313a04735ee0aa25`。
- exact-head GitHub Actions run
  [35309148054](https://github.com/qzhike/zhiju-business-core/actions/runs/35309148054) /
  job `105487373130`：`SUCCESS`。
- Reviewer 执行 `vibe verify full --json`：首次只因沙箱不可见容器 runtime 返回
  `VERIFY_FAIL`；使用同一 target 与 OrbStack socket 重跑后 `PASS`，resolved command
  `pnpm clean && pnpm verify`，exit 0。普通测试 1071 passed / 456 skipped；Catalog/
  Registry 215，Compatibility Baseline 200；真实 PostgreSQL 18.6 gate 43/43 files、
  471/471 tests，second migrate no-op，容器清理成功。
- `git diff --check 0be76e0c...7382ece9`：PASS；开始复审时工作树 clean。

绿色 verifier 证明现有仓库与 design-only 文档没有触发现有回归检查；它没有执行
`TE-214-D-*`，也没有把 #188 的真实 Source Slice 喂给尚未实现的 Builder，所以不能
消除上述输入契约反例。

## 未运行边界与后续门禁

Initial Context Handler、authorization Port、`context_snapshot`/
`context_snapshot_build` migration、权威 Context Query、真实 RLS/并发/重放、完整
Context→Validation→Freeze 链、外部 Provider/Runtime/飞书、公开 HTTP、生产、负载/
性能与独立人工业务验收均为 `NOT RUN`。

本轮仍存在 agent 可修复的设计阻断，不能进入 Issue #214 的最终人类设计/技术批准；
修复后的新 exact head 必须再次独立审查。本轮未修改产品代码，未提交、推送或合并；
只更新本地正式审查记录并发布 PR comment，记录在未获得提交/推送授权前保持本地未提交。
