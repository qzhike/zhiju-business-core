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
