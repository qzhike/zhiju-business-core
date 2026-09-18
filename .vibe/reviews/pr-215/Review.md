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

---

## 第 3 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`11576c8144ed39df23dfca3f917d2939c047e674`
- Base SHA：`0be76e0c62b722393d1c500772dab7dfa2a34db9`
- PR：[#215](https://github.com/qzhike/zhiju-business-core/pull/215)
- Work item：[#214](https://github.com/qzhike/zhiju-business-core/issues/214)（T2 design）
- 审查日期：2026-09-18
- GitHub handoff：[#issuecomment-5725679927](https://github.com/qzhike/zhiju-business-core/pull/215#issuecomment-5725679927)（同账号无法审查自己的 PR，因此使用 comment，不是 GitHub formal review）

本轮独立复核了 `7382ece9...11576c8` 的修订、Issue #214、#188 已交付的 Source
Slice Schema/owning implementation、Core ProjectContext v1.0、DRAFT InputRef、#202 已交付
EnterpriseProject Port 以及 exact-head 验证证据。上一轮指出的 #188 顶层 payload 名称和
omission/redaction 形状已被对齐，DRAFT `inputRefs`/`targetScope` 也增加了表面支持集；但新规则
仍会生成不通过 Core ContractRegistry 的 payload，并在 Purpose、InputRef 语义和跨模块读取
边界上留下必须由实现者猜测的规则，因此仍不能批准。

## 阻断发现

### 1. 规定生成的 `ContextItem` 仍无法通过已发布 Core v1.0

§19.4 第 7 条规定 `contextItemId` 为确定性 UUIDv8；已发布 Core `ContextItem` 却把该字段
绑定到 Common `uuidV7`，正则明确要求 version nibble 为 `7`。同一条还规定
`subjectRef := factRef` 并声称会通过 Core 形状校验；但 #188 实际 assembly 产生的嵌套
`factRef.objectType` 是大写 `EnterpriseFact`，而 Core TypedReference 的 objectType 使用
只接受小写 namespace 的 `namespaceCode`。#188 发布边界只规范化顶层 Project/Profile/QMS/
ProductScope/baseline refs，不递归规范化 `factItems[].factRef`，所以合法 Source Slice 确实会
携带这个值。

Reviewer 用现有 ContractRegistry 对合法 ProjectContext fixture 做单变量探针：把
`contextItems[0].contextItemId` 改为符合本设计算法外观的 UUIDv8 后，在该字段按 uuidV7
正则失败；把 `subjectRef.objectType` 改为 `EnterpriseFact` 后，在该字段按 namespaceCode
正则失败。因此这不是命名建议，而是当前规则必然产出无效 ProjectContext 的直接反例。

要求：`contextItemId` 必须生成满足已发布 UUIDv7 合同的确定性/持久身份，或先获得并发布
additive Core 合同变更；`subjectRef` 必须来自已发布、可验证的 canonical typed reference
映射/owning contract，不能直接复制不符合 Core NamespaceCode 的嵌套 ref。正向 golden
fixture 必须把完整生成 payload 交给真实 ContractRegistry 验证，而不只是逐字段比对。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1638`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1640`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1646`
- `contracts/src/core.schema.ts:46`
- `contracts/src/core.schema.ts:157`
- `contracts/src/common.schema.ts:13`
- `contracts/src/common.schema.ts:14`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:269`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:272`
- `modules/enterprise-project/src/business/context-source-slice-handlers.ts:76`
- `modules/enterprise-project/src/business/context-source-slice-handlers.ts:101`

### 2. Source Slice 的 Purpose 未绑定请求 Purpose，允许跨用途数据进入投影

既有 §11.2.1 要求每个 Slice 与请求具有相同 Scope、purpose、audience，Issue #214 也要求
Purpose matching 与 data minimization。新 §19.4 第 2 条却只检查每片 `slice.purpose` 属于
其 capture policy 的允许集合，没有检查它等于本次 `request.purpose`；第 10 条甚至要求正例
使用不同 purpose 的两片 Slice。之后设计把 `projection.purpose` 写成请求 purpose，却把每条
`ContextItem.permittedUses` 写成各自的 slice purpose。这会允许例如为一个用途捕获的数据被
装入另一个用途的投影，同时 payload 自己还声明该条目只允许原用途，直接破坏 Purpose 匹配、
最小化与 permitted-use 自洽性。

要求：至少规定每片 `slice.purpose == request.purpose` 并加入 purpose substitution 负例；若
确实需要跨 Purpose 兼容关系，必须先由 owning policy/contract 明确批准闭集和授权语义，不能
由 Builder 因两边分别“被某策略允许”就自行推导。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:435`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1592`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1594`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1628`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1643`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1654`

### 3. `inputRefs` 只比较 `.ref`，会把 required/usage/integrity 缺口标成完整 Context

Core `InputRef` 的 `required`、`permittedUse`、`contentAccessMode`、`integrityRequired` 是必填
字段，`epistemicExpectation` 也承载消费语义；既有 §11.2.1 明确要求 Builder 按
`inputRefs.permittedUse/contentAccessMode` 裁剪，§18.6 把存在性、版本、生命周期、可用性与
Purpose 裁剪留给 Readiness/Context Builder。新第 9 条却只按 `.ref` 是否等于某个
sourceSlices ref 判为采纳，完全忽略这些字段；同一个 ref 的多个、元数据不同的 InputRef
如何排序/去重也未定义。

更严重的是，未 capture 或不支持的 `required:true` 输入只产生 omission；`unresolvedItems`
固定为空，coverage 只吸收 Slice omission，并且 completeness 只有出现 Slice
`PURPOSE_FORBIDDEN` 才变成 `PARTIAL`。结果可以在必需输入未解析时仍声明
`COMPLETE_FOR_PURPOSE`。这与 Core 规则“影响 WorkOrder Completion 的缺失不得静默省略，
必须阻止 READY 或创建 InformationRequest”不相容。

要求：逐字段定义 InputRef 的采纳/裁剪/冲突/排序语义；对 required input 的缺失明确规定
fail、`PARTIAL`/`BLOCKED`、unresolved/InformationRequest 以及后续 READY 门禁，并让 coverage
真实反映 DRAFT omission。为相同 ref 不同 metadata、required unsupported、permittedUse 与
request purpose 不匹配、contentAccessMode/integrity/epistemicExpectation 各提供干净正反
fixture。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:435`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1351`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1613`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1615`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1618`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1651`
- `contracts/src/core.schema.ts:356`
- `.vibe/high-level-docs/03-core-contracts.md:288`

### 4. DeliveryItem target 新读取没有可消费的 Port 键或独立授权

新第 9 条要求用 EnterpriseProject owning 只读 Port 核验同 Scope DeliveryItem OBJECT ref，
并称其为“#202 同族”。但 #202 已交付 Port 的输入与闭集键只覆盖
`execution.create_task@1.0/@2.0`，且 DeliveryItem 输入是 VERSIONED ref；当前请求是
`execution.build_initial_context_snapshot@1.1` 的 OBJECT ref，不能复用现有键。设计没有定义
新 Port/新键、canonical objectType、生命周期谓词、失败映射及消费接口。§19.3 又明确要求每个
独立动作各自授权，却只列 DRAFT、Slice、Policy 和 Snapshot 读取，没有 DeliveryItem target
读取授权。实现者若继续，只能自行扩大 #202 Port 或绕过授权边界。

要求：明确由 EnterpriseProject 拥有的 additive Port/键表与 OBJECT→已提交 DeliveryItem
身份、Scope、生命周期证明，定义 TaskExecution 的稳定失败映射，并在 IdentityPolicy 中加入
该独立 read 的 Purpose/Grant/Decision 组成；或移除本切片的该支持路径并 fail closed，等待
单独 readiness。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:890`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:893`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1584`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1652`
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md:373`
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md:377`
- `.vibe/module-specs/Module-Spec-002-EnterpriseProject.md:381`

## 上一轮发现状态

1. 上一轮 Source Slice 字段形状问题已部分关闭：新 revision 改为使用 #188 的真实
   fact/omission/redaction 字段；但生成的 subjectRef/UUID 仍无法通过 Core，故端到端契约断裂
   未关闭。
2. 上一轮 DRAFT support-set 问题已部分关闭：新 revision 列出了 ref-level 矩阵；但没有处理
   InputRef 必填语义、coverage/READY 影响，也没有为 DeliveryItem 读取闭合 Port 与授权，故
   不能判定关闭。
3. 第 1 轮的 Query Purpose、@1.0 supersession 等问题维持关闭。

## 验证证据

- 发布前回读：PR 为 OPEN、非 Draft、MERGEABLE，merge state `CLEAN`；head 为
  `11576c8144ed39df23dfca3f917d2939c047e674`，base 为
  `0be76e0c62b722393d1c500772dab7dfa2a34db9`。
- exact-head GitHub Actions run
  [35310649423](https://github.com/qzhike/zhiju-business-core/actions/runs/35310649423) /
  job `105491804143`：`SUCCESS`。
- Reviewer 使用配置的完整 target 执行
  `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：
  `PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。Catalog/Registry 215、
  Compatibility Baseline 200；普通测试 62/62 files、1071/1071 tests passed（39 files、
  456 tests skipped）；真实 PostgreSQL 18.6 gate 43/43 files、471/471 tests，second
  migrate no-op，容器清理成功。
- `git diff --check 0be76e0c...11576c8`：PASS；开始本轮复审时工作树 clean。
- Reviewer ContractRegistry 单变量探针：UUIDv8 `contextItemId` 在 Core uuidV7 字段失败；
  `EnterpriseFact` subject objectType 在 Common namespaceCode 字段失败。

绿色 verifier 证明现有实现没有回归；本 PR 仍是 design-only Delta，`TE-214-D-*` 未由现有
测试执行，尚未实现的 Builder 也不会在该 target 中生成并校验新 ProjectContext，因此不消除
上述直接反例。

## 未运行边界与后续门禁

Initial Context Handler、增量授权/owning Port、`context_snapshot`/
`context_snapshot_build` migration、权威 Context Query、真实 RLS/并发/重放、完整
Context→Validation→Freeze 链、外部 Provider/Runtime/飞书、公开 HTTP、生产、负载/性能与
独立人工业务验收均为 `NOT RUN`。

本轮仍存在 agent 可修复的设计阻断，不能进入 Issue #214 的最终人类设计/技术批准；修复后的
新 exact head 必须再次独立审查。本轮未修改产品代码，未提交、推送或合并；只更新本地正式
审查记录并发布 PR comment，记录在未获得提交/推送授权前保持本地未提交。

---

## 第 4 轮：`REQUEST_CHANGES`（同一 revision 状态复核）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`11576c8144ed39df23dfca3f917d2939c047e674`
- Base SHA：`0be76e0c62b722393d1c500772dab7dfa2a34db9`
- PR：[#215](https://github.com/qzhike/zhiju-business-core/pull/215)
- Work item：[#214](https://github.com/qzhike/zhiju-business-core/issues/214)（T2 design）
- 审查日期：2026-09-18
- GitHub handoff：[#issuecomment-5725837276](https://github.com/qzhike/zhiju-business-core/pull/215#issuecomment-5725837276)（同账号无法审查自己的 PR，因此使用 comment，不是 GitHub formal review）

本轮发布前通过 `vibe repo --json`、PR head/commit 列表和完整 comment 时间线重新核对：远端
head 仍是第 3 轮已审查的 `11576c8`，第 3 轮 comment 后没有新增 commit 或修复说明，因此
不存在可供“修复后复审”的新 diff。第 3 轮的四个直接合同/授权阻断在该 exact revision 上
维持有效：

1. `contextItemId` 规定为 UUIDv8，但 Core v1.0 要求 UUIDv7；#188 的嵌套
   `factRef.objectType='EnterpriseFact'` 直接复制为 subjectRef 也不满足 Core NamespaceCode。
2. Slice purpose 未要求等于 request purpose，跨用途 Slice 可以进入另一用途的 projection，
   且与 `ContextItem.permittedUses` 自相矛盾。
3. `inputRefs` 仅比较 `.ref`，忽略 required/permittedUse/contentAccessMode/integrityRequired/
   epistemicExpectation，并可能在 required 输入缺失时仍产出 `COMPLETE_FOR_PURPOSE`。
4. DeliveryItem OBJECT target 读取没有适用于
   `execution.build_initial_context_snapshot@1.1` 的 EnterpriseProject Port 闭集键，也没有
   §19.3 所要求的独立授权组成；#202 已交付的 create_task/VERSIONED Port 不能直接复用。

完整反例、证据位置和修复要求见第 3 轮记录与
[#issuecomment-5725679927](https://github.com/qzhike/zhiju-business-core/pull/215#issuecomment-5725679927)。
没有新 revision 时重复执行同一未变 target 不会产生新的实现证据；按 Reviewer evidence-reuse
规则复用该 exact head 的当前证据：GitHub Actions run `35310649423` / job `105491804143`
`SUCCESS`；Reviewer `vibe verify full --json` `PASS`（普通测试 1071、Catalog/Registry 215、
Baseline 200、PostgreSQL 43/43 files / 471/471 tests、second migrate no-op）；本轮
`git diff --check` 继续 PASS。

上述绿色证据仍不执行 design-only 的 `TE-214-D-*`，也不生成拟议 ProjectContext，因而不能
关闭直接合同反例。Initial Context Handler、增量授权/owning Port、migration、权威 Query、
RLS/并发/重放、完整 Context→Validation→Freeze、外部与人工验收继续为 `NOT RUN`。

需要先推送包含修复的新 commit，再对新 exact head 做独立复审。本轮未修改产品代码，未提交、
推送或合并；仅追加正式状态复核记录并发布 PR comment。

---

## 第 5 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`2553de827fff2a71fe1ce617e4a65855bab20a89`
- Base SHA：`0be76e0c62b722393d1c500772dab7dfa2a34db9`
- PR：[#215](https://github.com/qzhike/zhiju-business-core/pull/215)
- Work item：[#214](https://github.com/qzhike/zhiju-business-core/issues/214)（T2 design）
- 审查日期：2026-09-18
- GitHub handoff：[#issuecomment-5726277588](https://github.com/qzhike/zhiju-business-core/pull/215#issuecomment-5726277588)（同账号无法审查自己的 PR，因此使用 comment，不是 GitHub formal review）

本轮独立复核了 `11576c8...2553de8` 的实际 diff、Issue #214、Core ProjectContext/
InputRef、#188 owning Source Slice 输出、仓库 UUIDv7 实现与 exact-head 验证证据。第 3 轮的
Purpose 绑定与 DeliveryItem target Port 缺口已关闭；required input 缺失也已改为 fail closed。
但 ContextItem 身份算法只满足当前正则外观、不满足仓库声明的 RFC 9562 UUIDv7，Source Slice
被错误复用为 Fact 的 subject，同时 InputRef 对空/混合 fact 和同键不同 metadata 仍未闭合，
因此尚不能批准。

## 阻断发现

### 1. 新“确定性 UUIDv7”只是改了 version nibble，不是 RFC 9562 UUIDv7

§19.4 第 7 条仍取 SHA-256 的前 16 字节，只把 version/variant 位改成 `7`/`[89ab]`。仓库
Common Schema 注释与 shared-kernel `parseUuidV7` 都把该类型声明为 RFC 9562 UUIDv7；RFC
9562 §5.7 要求最前 48 位是 Unix Epoch 毫秒时间戳，而不是任意 hash 位。当前
ContractRegistry/`isUuidV7` 只检查结构位，所以 fixture 的“Registry 全过”不能证明这个语义。

Reviewer 用 §19.4 的精确算法对一条 #188 形状 Fact 做探针，得到
`a68c537a-2eda-7ac1-9813-632473a71b13`：当前 `isUuidV7` 返回 true，但前 48 位
`a68c537a2eda` 按 UUIDv7 解读为 Unix 毫秒 `183121626148570`，即
`7772-11-22T06:22:28.570Z`，与 2026 年事实/切片时间完全无关。这是“通过正则但违反命名
合同”的直接反例。

要求：使用真实、稳定的 Unix 毫秒来源填充前 48 位（并仅在 UUIDv7 允许的余下位中使用
hash/计数器来保证确定性与唯一性），或重新选择并批准符合 Core 的身份方案；新增不仅检查
version nibble，还解码并断言 timestamp 来源/重放稳定性的 fixture。

证据位置：

- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1646`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1656`
- `contracts/src/common.schema.ts:7`
- `contracts/src/common.schema.ts:13`
- `packages/shared-kernel/src/identifiers.ts:7`
- `packages/shared-kernel/src/identifiers.ts:11`
- [RFC 9562 §5.7](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.7)

### 2. `subjectRef := Source Slice ref` 把 provenance 当成 Fact subject

新规则让每个 Fact ContextItem 的 `subjectRef` 等于整片 Source Slice 的
ContentAddressedRef，同时 `provenanceRefs` 又包含同一 Slice ref。Core 把 `subjectRef` 与
`provenanceRefs` 定义为两个独立字段；这里把来源容器同时冒充事实 subject，导致同一 Slice
中的所有 Fact 具有同一 subject，Fact 的 `factRef`/`factType` 在 ProjectContext payload 中
都不可识别，只能再次读取 owning Slice 才能猜回。结构通过 ContractRegistry 不等于这个
FACT 的 subject 语义正确，也不满足 Issue 要求的确定性 Fact→ContextItem 内容映射。

要求：为 Fact 选择已发布且语义正确的 subject reference，并把 Slice 仅保留在 provenance；
如果 #188 没有提供 Core 可接受的 canonical subject，则必须在 readiness 中选择 additive
owning Contract/object registration、明确的其他权威 subject，或不物化该 Fact 并正确反映
omission/coverage，不能用 schema-valid 的来源 ref 填充不同语义的字段。正向 fixture 应断言
两个不同 Fact 的 subject/identity 可从 ProjectContext 本身被区分，而不是只断言 Registry
接受。

证据位置：

- `.vibe/high-level-docs/03-core-contracts.md:202`
- `.vibe/high-level-docs/03-core-contracts.md:216`
- `.vibe/high-level-docs/03-core-contracts.md:220`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1634`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1640`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1645`
- `contracts/src/core.schema.ts:159`
- `contracts/src/core.schema.ts:167`

### 3. InputRef 的 epistemic 与同键 metadata 规则仍不是全域确定的

§19.4 第 9 条规定：`epistemicExpectation` 与该片 Fact 推导值一致；多 Fact 混合时只取
“确定性次序首个”状态。但 #188 合法 Slice 可以有零个 Fact，此时没有可比较值，规则未定义；
有多个不同状态时只看第一个，则 `CONFIRMED` expectation 可以在第一条为 CONFIRMED、后续为
DISPUTED/INFERRED 的同一输入上通过，没有验证“每个 Input 声明的信任级别”。必须明确空片
行为以及多 Fact 的全量/聚合偏序规则，不能以数组第一项代表整片信任状态。

同一段又只按 `(inputRole, ref)` 排序去重，却没有为其余 metadata 提供 tie-break 或冲突拒绝。
Reviewer 用现有 ContractRegistry 验证 `get_work_order_draft@2.0`：同一 `inputRole` + exact
`ref`，仅 `required` 分别为 true/false 的两条 InputRef 同时合法，因为 `uniqueItems` 比较完整
对象。这两条在文档排序键上完全相等；“排序去重”和测试中的“逐项确定性处理”没有决定是保留
两条、拒绝冲突、合并哪条或以何种全字段顺序进入 metadata/hash。排列不同仍可能产生不同结果。

要求：给出覆盖全部合法 InputRef 的 total canonical comparator，或对同
`(inputRole,ref)` 不同 metadata 明确 fail closed；为零 Fact + expectation、混合 epistemic
states、同键 required/permittedUse/access/integrity/expectation 冲突及输入排列置换增加干净
fixture，并断言相同集合得到相同结果/hash。

证据位置：

- `.vibe/high-level-docs/03-core-contracts.md:398`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1650`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1651`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md:1656`
- `.vibe/module-tests/Module-Test-003-TaskExecution.md:347`
- `contracts/src/core.schema.ts:356`
- `contracts/src/operations/task-execution.schema.ts:532`
- `modules/enterprise-project/src/business/source-slice-assembly.ts:371`

## 上一轮发现状态

1. UUID version nibble 与 subjectRef 的结构错误被改写，但 UUIDv7 的 RFC 时间字段仍错误，
   subjectRef 又被来源 Slice 取代，故 ContextItem 身份/语义问题未关闭。
2. `slice.purpose == request.purpose` 与 `permittedUses := {request.purpose}` 已关闭 Purpose/数据
   最小化发现。
3. required 未采纳已 fail closed，optional omission 也保留；但 epistemic 空/多值和同键不同
   metadata 仍未闭合，故 InputRef 发现仅部分关闭。
4. `targetObjectRefs` 支持集改为 ∅，非空统一 fail closed，不再引用未交付 Port/授权；该发现
   已关闭。

## 验证证据

- PR 发布前状态：OPEN、非 Draft、MERGEABLE，merge state `CLEAN`；exact head
  `2553de827fff2a71fe1ce617e4a65855bab20a89`，base
  `0be76e0c62b722393d1c500772dab7dfa2a34db9`。
- exact-head GitHub Actions run
  [35313743184](https://github.com/qzhike/zhiju-business-core/actions/runs/35313743184) /
  job `105500884890`：`SUCCESS`，fresh checkout 上执行 `pnpm verify`。
- Reviewer 执行配置的
  `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：首次
  静态/合同/普通测试全部通过，但 Docker Hub manifest 请求三次 `EOF`，exit 1；只读 preflight
  随后证明 pnpm 11.19.0、Vibe、Docker 29.4.0、daemon 与两个 digest-pinned 缓存镜像均正常；
  一次有界重试 `PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。普通测试
  1071 passed / 456 skipped；Catalog/Registry 215，Compatibility Baseline 200；真实
  PostgreSQL 18.6 gate 43/43 files、471/471 tests，second migrate no-op，容器清理成功。
- `git diff --check 0be76e0c...2553de8`：PASS；开始复审时工作树 clean。
- focused probes：hash-derived 值被当前 `isUuidV7` 接受但时间字段解读为 7772 年；
  ContractRegistry 接受同 `(inputRole,ref)`、不同 `required` 的两条 DRAFT InputRef。

绿色 verifier 证明现有实现没有回归；本 PR 是 design-only，`TE-214-D-*` 仍为 `NOT RUN`，
不会执行拟议 UUID/subject/InputRef 规则，因此不能消除上述直接反例。

## 未运行边界与后续门禁

Initial Context Handler、增量授权/owning Port、`context_snapshot`/
`context_snapshot_build` migration、权威 Context Query、真实新路径 RLS/并发/重放、完整
Context→Validation→Freeze 链、外部 Provider/Runtime/飞书、公开 HTTP、生产、负载/性能与
独立人工业务验收均为 `NOT RUN`。

本轮仍存在 agent 可修复的设计阻断，不能进入 Issue #214 的最终人类设计/技术批准；修复后的
新 exact head 必须再次独立审查。本轮未修改产品代码，未提交、推送或合并；只更新本地正式
审查记录并发布 PR comment，记录在未获得提交/推送授权前保持本地未提交。
