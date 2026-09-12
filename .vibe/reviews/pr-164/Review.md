APPROVE

# PR #164 独立审查（2026-09-10）

- Reviewed SHA：`1f9b28ca69da25aaf43436b73d6311149dcc5a41`
- 关联 Issue：#159
- PR：https://github.com/qzhike/zhiju-business-core/pull/164
- 结论：`APPROVE`
- 审查角色：Reviewer；本次未修改产品代码，未提交、推送或合并。

本次独立核对了最新 PR head、Issue #159 的 Goal/Acceptance/Scope/Verify、
TaskExecution Module Spec/Test、共享 API Contract、实际 PR diff、当前 Registry
测试和 exact-head CI 状态。未发现阻塞性契约、范围或验证问题。

## 契约与范围核对

### ContextBuildRequest 字段矩阵

| 字段 | Module Spec 语义 | PR 当前 Schema | 结论 |
|---|---|---|---|
| `workOrderRef` | `ObjectRef<WorkOrder>`，必填 | `objectReference`，必填 | PASS |
| `workOrderContractRef` | `ContentAddressedRef<WorkOrderContract>`，必填 | `contentAddressedReference`，必填 | PASS |
| `projectionType` / `purpose` | `NamespaceCode`，必填 | `namespace`，必填 | PASS |
| `audience` | `TypedReference`/Principal 语义，必填 | `typedReference`，必填 | PASS |
| `sourceSlices` | `NonEmptySet<ContentAddressedRef<ContextSourceSlice>>` | `minItems: 1` + `uniqueItems: true`，必填 | PASS |
| `answeredInformationRefs` | 普通有序 `TypedReference[]`，必填，可为空、允许重复 | `array(typedReference)`，无 `uniqueItems`，必填 | PASS |
| `builderPolicyRef` | `VersionedRef<Policy>`，必填 | `versionedReference`，必填 | PASS |
| `expiresAt` | 可选 `UtcInstant` | `instant`，可选 | PASS |

PR 只移除了 `answeredInformationRefs` 的 `uniqueItems`，没有放宽元素
`TypedReference` 的形状，也没有改变其他字段的 required/optional 语义。
`sourceSlices` 的非空唯一集合约束和 `workOrderContractRef` 的必填约束仍在。

### Acceptance 逐项核对

1. **普通数组接受集合**：新增完整 frozen-build fixture 覆盖空数组、单项和相同
   合法 Ref 的重复项；公共 `ContractRegistry.validateOperation` 均返回
   `{ valid: true, errors: [] }`。测试同时断言重复数组长度仍为 2、两项仍完全相等，
   validator 不改写输入；三个 fixture 去掉 `answeredInformationRefs` 后其余 request
   内容一致，`integrity` 保持一致。
2. **元素与其他边界未放宽**：从合法 fixture 独立构造非数组和 `{}` 畸形 Ref，
   分别在 `/payload/request/answeredInformationRefs` 和
   `/payload/request/answeredInformationRefs/0` 拒绝；缺少
   `workOrderContractRef` 在 `/payload/request` 以 `required` 拒绝。
3. **`NonEmptySet` 独立控制**：`sourceSlices=[]` 在字段路径报 `minItems`；复制同一
   Slice 后报 `uniqueItems`。这两个负向控制与 answered-ref 的正向控制相互独立。
4. **历史和类型边界**：当前生成类型仍是
   `readonly Common.TypedReference[]`；初始化 Context 分支仍拒绝误带
   `workOrderContractRef` 或 `answeredInformationRefs` 的额外字段。PR 未修改历史
   `contracts/baselines/v1.0` Schema、历史 fixture、公开 operation/version 或
   Payload Hash/Canonicalization 规则。
5. **权威文档同步**：Module Test 新增 `TE-API-S-020` 并保持 Handler/E2E/外部/人工
   验收为 `NOT RUN`；共享 API Contract 记录了这是恢复已声明普通数组契约的
   `COMPATIBLE_MINOR` 放宽，不把业务消费语义标记为已实现。

## 验证证据

- GitHub PR 的 `verify` Check Run 在 exact head
  `1f9b28ca69da25aaf43436b73d6311149dcc5a41` 上为 `SUCCESS`：
  [CI verify](https://github.com/qzhike/zhiju-business-core/actions/runs/34458540922/job/102810594848)。
- Reviewer 本地通过公共入口执行定向回归：
  `node node_modules/vitest/vitest.mjs run contracts/src/operations/task-execution.schema.test.ts contracts/src/registry.test.ts`，
  2 个 Test Files、57/57 tests 通过。
- 对 PR 基线 `4203ff196f8b47b7dcf4cbaf4f0b199fd7256825` 与 Reviewed SHA 的实际 diff
  执行 `git diff --check`，通过；diff 仅包含 Issue 声明范围内的 7 个文件。
- 本次未在本地重复执行 `vibe verify full --json`，因为 exact-head GitHub `verify`
  已提供当前完整验证门禁的通过证据；定向测试不替代该 Gate。

以下仍按 Issue/Module Test 保持 `NOT RUN`，不影响本次 Schema 审查结论：真实
Context Builder/Retry Handler、引用存在性与 Hash/Scope/Purpose/授权/期限业务语义、
事务与持久化业务链、Runtime/外部集成及人工验收。

## 审查结论

`APPROVE`。本 PR 的实现与 Issue #159、Module-Spec-003 和共享 API Contract 一致，
只恢复 `answeredInformationRefs` 已声明的普通数组接受集合；没有发现需要
`REQUEST_CHANGES`、`PLANNING_REQUIRED` 或范围扩张的条件。本结论是独立 Agent review
结论，按用户要求发布为 PR comment，不是 GitHub formal APPROVE review，也不授权合并。

发布前已确认 PR head 仍为上述 Reviewed SHA；审核评论发布后的即时回读确认当时
远端仍为该 SHA、PR 仍为 `OPEN`、`verify` 为 `SUCCESS`，且评论正文与本结论一致：
[PR #164 审查评论](https://github.com/qzhike/zhiju-business-core/pull/164#issuecomment-5616545711)。

## 交付后回读（2026-09-10）

- PR #164 已以 merge commit
  `e529005d00cbf61a2369773dabe3f299e7e2e275` 合入 `main`；远端 `main` 当前指向该
  revision。
- 原始 Issue #159 已因 PR 关联自动关闭。
- 原始远端分支 `feat/159-answered-information-refs-array` 查询返回 `404 Not Found`，
  已删除。
- 本次合并未改变 IM-06 的前向路线；roadmap 中已有的未提交改动保持原样，未作额外
  规划推进或无关修改。
