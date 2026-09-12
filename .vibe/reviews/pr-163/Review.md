APPROVE

# PR #163 独立复审（2026-09-10）

- Reviewed SHA：`ae6242ecefb4f6e8a273ec7ff04849ab48873b64`
- 关联 Issue：#158。
- 本次独立检查最新 PR head、修订差异、当前契约与 fixture，以及对应 SHA 的 CI 实际日志。上次 R1/R2/R3 均已修复；本次审查范围内未发现新的阻塞问题。

## 上次发现的复核

| 发现 | 结论 | 独立验证 |
|---|---|---|
| R1：Draft Query 分页契约 | 已修复，关闭 | 新 Query 使用共享 PageRequest。省略分页、pageSize=1、16/512 字符合法 cursor 通过；空对象在 `/pagination` 报 required；0/1.5 在 `/pagination/pageSize` 报 minimum/type；非法或513字符 cursor 在 `/pagination/cursor` 报 pattern；未知字段报 additionalProperties。旧 `execution.get_work_order_contract` 的开放 pagination 接受集合保留。 |
| R2：CAS 可无损整数边界 | 已修复，关闭 | 新 Result 独立增加 maximum=9007199254740991，共享 nonNegativeInteger 未改。0 和最大安全整数通过；9007199254740992、1e100 在 `/rootAggregateVersion` 报 maximum；负数/小数仍报 minimum/type。 |
| R3：负向 fixture 单一边界与错误路径 | 已修复，关闭 | 两个旧分支字段已拆为独立输入；六个 initial 必填字段逐项缺省/null；request 内 expectedAggregateVersion、Ref/Hash、期限、空/重复 Slice、嵌套 Draft、Result 必填与 CAS 均检查对应 keyword/path，required/additionalProperties 同时检查字段参数。Reviewer 另确认 payload 顶层及 Envelope 顶层 CAS 错字段分别在 `/payload` 和 `/expectedAggregateVersion` 拒绝。 |

完整合法 initial request、Draft Query/Result、旧 frozen build fixture 保持通过。Reviewer 补测 initial expiresAt 省略合法；旧 frozen build 省略 workOrderContractRef 仍在 `/payload/request` 返回 required/missingProperty=workOrderContractRef。

## 契约与范围核对

上次完整字段矩阵仍适用，本轮只收紧新 Query 的分页和新 Result 的整数边界并增强测试：

- WorkOrderDraftSnapshot：snapshotId/workOrderRef/taskRef/scopeRef/draft/capturedAt/createdBy 必填；expiresAt 可选非 null；draft 复用既有类型。
- InitialContextBuildRequest：draftSnapshotRef/projectionType/purpose/audience/sourceSlices/builderPolicyRef 必填；expiresAt 可选；精确 Ref、Core projectionType、NonEmptySet Slice 约束保留。
- Draft Query：workOrderRef 必填；Result draftSnapshotRef/draft/rootAggregateVersion/status 必填，expiresAt 可选，复用 WorkOrderStatus。
- 新操作的 Owner、AUTHORITATIVE/CREATE、target objectType、Purpose 和引用元数据保持一致；当前 Catalog/Registry 205 项、全部 FULL；历史 200 项 Compatibility Baseline 未改写。
- 原 create/freeze_work_order、frozen build、Core ProjectContext、ContextSnapshotBuilt 和 answeredInformationRefs 既存边界保持不变；未扩展 Handler、授权策略、TTL 或模块所有权。

## 当前版本验证证据

- [CI verify / run 34452464388](https://github.com/qzhike/zhiju-business-core/actions/runs/34452464388/job/102791087505)：SUCCESS；check-run head_sha 与本次 Reviewed SHA 一致，已读取实际日志。
- CI 新 checkout 的完整 pnpm verify：44 个普通测试文件、643 项通过；31 文件/321 项受控 skipped。生成 205 operations、历史兼容 baseline 200 operations 通过。
- Docker/PostgreSQL gate：35 个文件、336 项通过；二次迁移 No migration necessary；gate passed；PostgreSQL 容器已移除。
- Reviewer 本地定向 `node node_modules/vitest/vitest.mjs run contracts/src/operations/task-execution.schema.test.ts contracts/src/registry.test.ts`：2 文件、55/55 通过。
- Reviewer 公共 ContractRegistry 独立边界探测通过，具体输入和实际 keyword/path 见上表。
- 复用当前 SHA 的完整 CI 证据，本轮未重复执行本地 `vibe verify full --json`；实现者已在修复评论记录该配置目标通过，本复审通过判断不依赖其自报。

Schema/注册通过仅覆盖本 Issue 的契约切片。真实 Handler、引用存在性/Hash/Scope/Purpose、期限继承/当前时间、授权、业务事务/CAS/重放、首次 Context 业务闭环、外部和人工验收仍为 `NOT RUN`。

本结论为独立 agent review 的 APPROVE，按用户要求发布为 PR comment，不是 GitHub formal APPROVE review，也不授权合并。正式复审记录更新于 `.vibe/reviews/pr-163/Review.md`，保留上次审查历史。本轮未修改产品代码、未提交/推送/合并，保留已有 PR #160 文档改动。

已发布并回读确认 [本次复审评论](https://github.com/qzhike/zhiju-business-core/pull/163#issuecomment-5615246806)，正文一致；发布前远端 head 仍为本次 Reviewed SHA。

---

## 历史审查记录

# PR #163 独立审查

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`1dc3b780c8009588268e33f10c8e3ac172e5d279`
- 日期：2026-09-10
- PR：https://github.com/qzhike/zhiju-business-core/pull/163
- Issue：#158；范围为两项 WorkOrder Draft / initial Context 契约注册。

## 阻塞发现

### R1 / P2：新 Draft Query 接受违反共享 PageRequest 的分页参数

位置：`contracts/src/envelopes.schema.ts:106`；新操作登记于 `contracts/src/operations/task-execution.schema.ts:715`。

共享 API §4 的 PageRequest 要求 pageSize 为必填 PositiveInt，cursor 为可选 OpaqueCursor。当前 Envelope 仅对 project.get_context_source_slice 绑定共享 pageRequest；execution.get_work_order_draft 落入 `{type:'object'}` 分支。Issue #158 要求完整 Envelope 注册，不能把旧操作的开放结构作为新接口的契约。

Reviewer 从当前完整合法 Draft Query 出发，通过公共 `ContractRegistry.validateOperation` 逐个增加 pagination，得到：

| pagination | 预期 | 实际 |
|---|---|---|
| 省略 | 通过 | valid=true |
| `{pageSize:1}` | 通过 | valid=true |
| `{pageSize:1,cursor:"aaaaaaaaaaaaaaaa"}` | 通过 | valid=true |
| `{}` | 缺 pageSize，拒绝 | valid=true |
| `{pageSize:0}` | 拒绝 | valid=true |
| `{pageSize:1.5}` | 拒绝 | valid=true |
| `{pageSize:1,cursor:"!"}` | 非法 cursor，拒绝 | valid=true |
| `{padding:[]}` | 缺 pageSize/未知字段，拒绝 | valid=true |

修复要求：为本次新 Query 绑定共享 PageRequest，保留旧操作接受集合；补充合法省略/分页与缺字段、非正数、非整数、非法 cursor、未知字段的单变量 fixture，并断言实际 keyword/path。

### R2 / P2：Draft Result 的 CAS 数值没有可无损编码上界

位置：`contracts/src/operations/task-execution.schema.ts:723`。

Issue #158 Acceptance 要求 CAS 沿用共享可无损编码范围；Spec 003 §11.1 明确超出可无损公开编码范围应拒绝而非截断。新 rootAggregateVersion 直接引用只有 `type:integer, minimum:0` 的共享定义，生成类型为 number，没有上界约束。

Reviewer 对同一个 otherwise-valid Result 仅修改 rootAggregateVersion，通过公共 `validateOperationResult` 得到：9007199254740991、9007199254740992 和 1e100 均返回 `valid=true, errors=[]`。后两者越过 Number.MAX_SAFE_INTEGER；不同数据库 bigint 值在 JSON/number 路径可能失去区分，不能成为可靠的后续 CAS token。

修复要求：仅在新增 Result 边界组合可无损整数范围约束，保留共享类型和旧操作兼容基线；补充最大合法值及越界值拒绝的正负对照，断言 `/rootAggregateVersion` 的实际错误。不要通过降低精度、截断值或改写共享旧契约使其通过。

### R3 / P2：必需负向 fixture 不完整，且错误分支测试不能证明各自的拒绝边界

位置：`contracts/src/operations/task-execution.schema.test.ts:246–259,263–355`。

Issue #158 Acceptance 明确要求新字段缺失/null、错误分支及 payload 内 expectedAggregateVersion 等负向 fixture；每个拒绝 fixture 只针对声明边界，并保存公共 validator 的实际错误路径。

当前 wrongBranch 同时加入 workOrderContractRef 和 answeredInformationRefs，只断言 valid=false：即使 Schema 错误接受其中一个字段，测试仍会因另一个字段失败而保持绿色。expectedAggregateVersion fixture 修改的是 Envelope 顶层，没有覆盖 Issue 指定的 payload 内错误字段。六个必填 initial 字段只有缺省循环，未覆盖逐字段 null；多数 Ref、期限、嵌套 Draft、Result/CAS 拒绝也只检查布尔值，未保存或断言其实际错误路径。

修复要求：每个独立错误从已通过的完整基线开始；拆分两个旧分支字段，补充 payload/request 中 expectedAggregateVersion 和必填新字段 null；对错误验证 keyword、instancePath 及必要的 missingProperty/additionalProperty。此项是明确的验收交付缺口，不能由现有绿色 suite 或通用 Schema 行为代替。

## 字段与范围核对

| 边界 | 字段核对 | 结果 |
|---|---|---|
| WorkOrderDraftSnapshot | snapshotId/workOrderRef/taskRef/scopeRef/draft/capturedAt/createdBy 全必填；expiresAt 可选非 null；精确 OBJECT 类型和共享 Scope/Principal；复用既有 WorkOrderDraft | 静态符合；不代表对象存在性或期限继承运行通过 |
| InitialContextBuildRequest | draftSnapshotRef/projectionType/purpose/audience/sourceSlices/builderPolicyRef 六项必填；expiresAt 可选非 null；精确 CONTENT_ADDRESSED Draft/Slice、VERSIONED Policy；Slice 非空且唯一；projectionType 使用 Core 注册集合 | 静态符合；负向 fixture 见 R3 |
| Draft Query payload/result | workOrderRef 必填；Result draftSnapshotRef/draft/rootAggregateVersion/status 必填；expiresAt 可选；WorkOrderStatus 复用 owning enum | CAS 数值上界不符，见 R2 |
| 新 Query Envelope | AUTHORITATIVE，既有共享必填字段和可选字段 | pagination 不符，见 R1 |
| 新 Command Envelope | ContextSnapshot OBJECT target，CREATE 禁止顶层 expectedAggregateVersion；完整 request | 静态符合；payload 错字段测试缺口见 R3 |
| 注册与兼容 | 两项新增操作、Owner/Purpose/引用元数据、生成类型；205 项 Catalog/Registry、全部 FULL；历史 200 项 baseline 未改写 | 符合；不增加 Service 通配授权或新 TTL/Guard Policy |
| 既有契约 | create/freeze_work_order、旧 frozen build 的必填 ContractRef/answeredInformationRefs、Core ProjectContext 与 ContextSnapshotBuilt 未修改 | 保留；CommandResult 仍沿用现行通用机制，resultReferences 元数据不冒充业务输出已运行 |

## 验证证据与边界

- 当前 SHA 的 [CI verify](https://github.com/qzhike/zhiju-business-core/actions/runs/34450237098/job/102784085638) 为 SUCCESS；已读取实际日志。新 checkout 上执行 pnpm verify，包含类型构建、静态检查、测试、架构、生成/兼容和 Docker/PostgreSQL gate。
- CI：44 个普通测试文件、643 项通过；31 文件/321 项为该阶段受控 skipped。PostgreSQL：35 文件、336 项通过；二次迁移 no-op，gate passed，容器已移除。生成 205 operations、历史兼容 baseline 200 operations 通过。
- Reviewer 本地定向：`node node_modules/vitest/vitest.mjs run contracts/src/operations/task-execution.schema.test.ts contracts/src/registry.test.ts`，2 文件、55/55 通过。先前 pnpm exec 入口持续无输出，已中止，不计通过；直接 Vitest 入口是定向诊断。
- Reviewer 公共 ContractRegistry 分页与 CAS 探测：合法对照通过，R1/R2 的非法输入同样通过，构成直接反例。
- 复用当前 SHA 的完整 CI 证据，本轮未重复执行本地 `vibe verify full --json`。修复后需执行配置 full，并对新 head 重新审查。
- Schema/注册验证不等于 Handler。引用存在性/Hash/Scope/Purpose、真实授权、期限继承/当前时刻、事务/CAS/重放、首次 Context 业务链、外部和人工验收继续 `NOT RUN`。

本轮未修复产品代码，未改变冻结决定，未提交、推送或合并。仅新增本正式审查记录；保留原有 `.vibe/reviews/pr-160/Review.md` 未提交改动。按用户明确授权将本结论发布为原 PR comment，不作为 GitHub formal review。

## 发布回读

已发布并回读核对 [PR #163 审查评论](https://github.com/qzhike/zhiju-business-core/pull/163#issuecomment-5614950107)，正文一致。发布前再次确认远端 head 仍为 `1dc3b780c8009588268e33f10c8e3ac172e5d279`。
