# PR #160 合并前审查（2026-09-10）

- 结论：`APPROVE`（代码与契约审查）；实际合并须等待最终 head 的远端 verify 通过。
- Reviewed implementation SHA：`a265e6c3566585e521a5ed136d6fdd856647cdc6`。
- Scope：Issue #157 的 ContextSourceSlice 契约注册；已同步 main 的 PR #162 / Issue #161 修复。
- 最终仅文档提交的 SHA、CI 与审查回读证据写入 PR comments，避免文档自身 SHA 循环；本记录不将旧 SHA 的证据冒充后续 head 的 CI。

## R1 / R2 结论

R1 已关闭。新 Query 通过共享 PageRequest 执行必填正整数 pageSize、可选 OpaqueCursor 与未知字段拒绝；旧 201 项接受集合保持不变。Query 字节边界使用合法 Reference 文本和 PageRequest，未恢复开放分页填充。原字段矩阵继续适用，Read Envelope 项改为 PASS。

R2 已关闭其实现缺陷。#161 已经 #162 独立修复、审核并合入 main；本次无冲突同步完整保留 savepoint 恢复、精确 SQLSTATE/schema/table/constraint 与同 Scope Root identity 判断，以及真实 PostgreSQL 的同/异 identity 并发回归。未把无关数据库错误转为成功或冲突，未重写其他 Aggregate。#162 的独立审查见 https://github.com/qzhike/zhiju-business-core/pull/162#issuecomment-5613880443 。此前失败 CI 与复审记录保留在下方，最终远端检查仍作为合并 Gate。

独立复核了实际合并差异、当前 owning Spec/Test、完整新增契约字段及注册元数据：capture 五字段、Slice 九字段、read result 三字段、exact Ref/hash、Set/数组区别、SourceWatermark 与命名 Source View、Guard 参数、当前203项和历史200项兼容边界均保持符合 #157。相对最新 main 不新增 TemplateBaseline 修复代码；它已属于 base。

## 当前验证

隔离工作区在上述精确 SHA 执行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：PASS / exit_code=0。

- clean、格式、Lint、类型、architecture、生成检查通过。
- 43 个常规测试文件 / 637 项测试通过。
- 35 个 PostgreSQL 测试文件 / 336 项测试通过，包括修复后的受控首次 Root race。
- PostgreSQL 18.6 / Flyway 11.20.3 空库迁移、历史升级和二次迁移 no-op 通过；临时容器已删除。
- Catalog/Registry=203；冻结200项兼容检查通过。
- 当前同步提交 CI：https://github.com/qzhike/zhiju-business-core/actions/runs/34444460036/job/102766116467 。本记录落盘时仍在运行，不提前记 PASS；最终提交需另取得通过证据并回读。

本记录提交前未修改产品实现；原工作区的未提交内容完整保留。用户已明确授权本次同步、交付和通过 Gate 后的合并。

真实 capture/replay、当前授权/Scope/Purpose/时效、持久 Slice、首次 Context 业务闭环、外部与人工验收仍为 NOT RUN。Schema/Guard 交付不代表 IM-06 完成。

---

## 历史审查

# PR #160 复审（2026-09-10）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`55bf0ce0792205d8c1ff92008d08f385e1d44031`
- 结束前回读远端：head 未变化，verify 仍为 FAILURE。
- R1：已修复，关闭。本次修订范围内未发现新的契约缺陷。
- 已发布并回读核对：[复审评论](https://github.com/qzhike/zhiju-business-core/pull/160#issuecomment-5613468578)。

## R1 复核

新 Query 在 `contracts/src/envelopes.schema.ts:106` 仅针对 project.get_context_source_slice 引用共享 pageRequest；其他操作保留原 Schema。共享定义要求 pageSize 为必填正整数、cursor 使用 16–512 字符的 OpaqueCursor，并关闭未知字段。

独立通过公共 ContractRegistry 探测：省略 pagination、pageSize=1、合法 cursor 长度16/512通过；空对象在 /pagination 报 required；pageSize=0/1.5 在 /pagination/pageSize 报 minimum/type；cursor 为 !、长度15/513在 /pagination/cursor 报 pattern；未知字段报 additionalProperties。原 R1 的反例已正确拒绝。

已检查修订后的正负 fixture、旧 Query 兼容对照和 Query 字节边界测试。新字节 fixture 使用既有 TypedReference 的合法文本字段及合法 PageRequest，262144字节通过、262145字节在根路径报 maxEnvelopeBytes；不再依赖 pagination.padding/text。共享 required/optional、Source View、Set/数组、Slice 九字段及注册元数据未被本次修订改变，前次字段矩阵除 R1 修正外继续适用。

## R2 / P2：当前 SHA 的远端验证失败尚未处置

证据：[CI verify](https://github.com/qzhike/zhiju-business-core/actions/runs/34432915885/job/102731999835)，run headSha 与 Reviewed SHA 一致。

637项常规测试、203项 Catalog、200项历史兼容检查通过；PostgreSQL 为334通过、1失败。失败用例为 `tests/persistence/template-regulatory.test.ts:1258` 的 `EP-WI08-P-004: first Project root creation race is conflict-safe`，错误为 `duplicate key value violates unique constraint "template_baseline_pkey"`，调用栈指向 TemplateRegulatoryRepository.insertTemplateBaseline 和 handleFreezeTemplateBaseline。

定向代码核对：测试以相同 baselineId 并发提交两次首次创建，预期一次 COMMITTED、一次 REJECTED/CONCURRENCY_CONFLICT。`modules/enterprise-project/src/persistence/template-regulatory-repository.ts:481` 的 ON CONFLICT 仅指定 enterprise_id/project_id；此次 CI 实际抛出主键冲突，没有返回预期的受控拒绝。这些业务代码与测试不在本 PR 的修改范围，不能据此断言是分页修复引入，但也没有证据允许将该失败忽略。

处置要求：由 owning Implementer 调查并处理该并发失败；涉及本任务之外的产品代码修改时应明确单独范围。保留这次失败证据，取得解释和当前 head 的通过检查，再复审。不要删除、跳过该测试或用旧 SHA/一次本地成功覆盖失败。本审查未修复相关产品代码，也未扩展 #157 的实现范围。

## 验证结果与边界

- Reviewer 本地运行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：PASS，exit_code=0。Socket 来自当前 docker context。
- 本地 clean、format、lint、typecheck、637项常规测试、architecture、生成一致性、203项 Catalog 和200项历史兼容检查通过。
- 本地 PostgreSQL 18.6 / Flyway 11.20.3：35文件/335测试通过；空库迁移、历史升级、二次迁移 no-op 通过；临时容器已移除。本地成功与远端并发失败分别记录。
- 单独发起的 pnpm exec vitest 定向命令持续无输出，在 full 已完成后中止，不记 PASS；相关用例已有本次 full 的实际通过证据。独立 ContractRegistry 分页探测完成。
- 本次审查记录更新前 git diff --check 通过，工作区干净。
- 真实 capture/replay、当前授权/Scope/Purpose/时效、持久 Slice、首次 Context 业务闭环、外部与人工验收仍为 NOT RUN。

本次仅更新正式审查记录；未修改产品代码，未提交、推送或合并。沿用用户已明确给出的 comments 发布授权，本复审结果发布为 PR comment，不作为 GitHub formal review。

---

## 历史审查（保留原 SHA 与结论）

# PR #160 独立审查

- 结论：`REQUEST_CHANGES`
- 审查日期：2026-09-10
- PR：https://github.com/qzhike/zhiju-business-core/pull/160
- Issue：#157
- Reviewed SHA：`7193627d86b8e803ba37a6a029e3a7db850e77b0`
- 结束前远端回读：相同 SHA，OPEN / Draft。
- 范围：Reviewer；未修改产品实现，未提交、推送或合并。

## 阻塞发现

### R1 / P2：新 Query 未执行共享 PageRequest 契约

位置：`contracts/src/envelopes.schema.ts:108` 的 `pagination: { type: 'object' }`，通过本次新增的 `project.get_context_source_slice@1.0` 注册成为新操作的公开 Envelope。

共享 API Contract §4 定义 `PageRequest.pageSize: PositiveInt` 必填、`cursor?: OpaqueCursor`；§6.1 使用共享 QueryEnvelope。#157 要求新操作完整注册 Envelope，并不授权新接口继承旧 Schema 的契约缺口。

从完整合法 query.json 出发，仅增加下表 pagination，通过公共 `ContractRegistry.validateOperation('project.get_context_source_slice', '1.0', input)` 独立探测：

| pagination | 预期 | 实际 |
|---|---|---|
| 省略 | 通过 | valid=true |
| `{pageSize:1}` | 通过 | valid=true |
| `{pageSize:1,cursor:"aaaaaaaaaaaaaaaa"}` | 通过 | valid=true |
| `{}` | required 拒绝，缺 pageSize | valid=true |
| `{pageSize:0}` | 拒绝非正整数 | valid=true |
| `{pageSize:1.5}` | 拒绝非整数 | valid=true |
| `{pageSize:1,cursor:"!"}` | 拒绝非法 OpaqueCursor | valid=true |
| `{padding:[]}` | required 拒绝，缺 pageSize | valid=true |

影响：消费者可以把契约非法分页请求验证为合法。技术资源 Guard 只限制体积，不能替代 PageRequest 的结构和标量约束。现有测试在 `enterprise-project.schema.test.ts` 的 `padToBytes` 和独立 Ajv 测试中使用 `pagination.padding/text` 作为填充容器，不能证明符合共享契约的 Query 正向边界。

修复要求：只对新 Query 绑定正确的 PageRequest 结构、必填正整数 pageSize 和共享 OpaqueCursor 约束，保留旧 201 项接受集合。补充上述独立正负 fixture，断言 `/pagination` 的 required、`/pagination/pageSize` 的类型/下限、`/pagination/cursor` 的约束。重新构造 otherwise-valid Query 字节边界 fixture，不能用缺 pageSize 的开放分页对象作为合法基线。随后执行配置目标 full 并对修复后的最新 SHA 复审。

## 字段核对矩阵

下列为静态契约核对；PASS 不代表 Handler 或对象存在性验证。

| 契约 | 全部字段与形状核对 | 结论 |
|---|---|---|
| Capture payload | projectRef、purpose、audience、requestedKinds、capturePolicyRef 全必填；OBJECT/Project、NamespaceCode、共享 PrincipalRef、可空且唯一的 Set（最多64项）、VERSIONED/Policy | PASS |
| Read payload | sourceSliceRef 必填；CONTENT_ADDRESSED/ContextSourceSlice；contentHash 必填，沿用共享 hash 结构 | PASS |
| Read result | slice、useStatus、checkedAt 全必填；状态 USABLE/EXPIRED/REVOKED 闭集，checkedAt 为 UtcInstant | PASS |
| ContextSourceSlice | sliceId、scopeRef、projectRef、purpose、audience、capturePolicyRef、capturedAt、validUntil、source 全必填；对应 UUID/共享 Scope/精确 Project/Namespace/共享 Principal/精确 Policy/两个 UtcInstant/命名 Source View | PASS |
| ProjectContextSourceSlice | projectRef、enterpriseProfileSnapshotRef、qmsConfigurationRef、productScopeSnapshotRef、activeBaselineRefs、factItems、omissions、redactions、sourceWatermark 全必填；直接复用既有定义，四个普通数组保留重复语义 | PASS |
| SourceWatermark | sourceModule、sequence、observedAt 必填；partition 可选；NamespaceCode、非负整数、UtcInstant、文本，与既有定义一致 | PASS |
| Capture Envelope | 13 个共享必填字段保留；targetRef 精确 OBJECT/ContextSourceSlice；CREATE 禁止 expectedAggregateVersion；causationId/deadline 可选 | PASS |
| Read Envelope | 10 个共享必填字段保留；仅 AUTHORITATIVE；authorizationDecisionRef/minimumWatermark/asOf/pagination 可选，但 pagination 子结构不完整 | FAIL，R1 |
| 注册元数据 | 两个 Owner、Purpose、Classification、Guard Ref、引用声明及 Query Result 登记；203 项计数；冻结 200 项 baseline 未改写 | PASS |

## 验证证据

- 当前 SHA 的 CI：https://github.com/qzhike/zhiju-business-core/actions/runs/34429886781/job/102722940310 。已读取实际日志：630 项常规测试通过；35 个 PostgreSQL 测试文件 / 335 项测试通过；生成一致性、203 项 Catalog、200 项历史兼容检查通过。CI 使用新 checkout 后的 pnpm verify。
- 本地执行 `vibe verify full --json`：clean、format、lint、typecheck、630 项常规测试、architecture、contracts 检查通过；最终 `VERIFY_FAIL`，原因是 PostgreSQL gate 报 `Could not find a working container runtime strategy`。本地持久化不能记 PASS；远端同 SHA 的持久化 PASS 单独保留。
- R1 定向探测：使用当前编译产物，通过公共 ContractRegistry；完整基线、合法分页对照通过，五组非法分页同样被接受。
- 93 项结构负向 fixture 静态核对；测试逐项先验证完整基线，再验证具体 keyword/path/params。上述分页遗漏未被现有 suite 覆盖。
- `git diff --check`（审查记录创建前）：PASS。

## 非阻塞边界观察

直接向 Ajv 注册导出的 payloadGuardKeyword、使用 allErrors=true 验证带 payload getter 的 Query 时，校验会继续触发 getter 并抛异常；单独 keyword 不是安全前置短路的替代品。同一输入通过公共 ContractRegistry 时，返回 `/payload` 的 payloadGuard/jsonValue 错误，getter 调用次数为 0。批准方案将前置短路明确放在 ContractRegistry，因此该观察不作为本次独立阻塞项；后续直接集成 Schema 的调用方应保留同等前置检查。

## 未运行与交接

真实 capture/replay、当前授权/Scope/Purpose/时效、持久 Source Slice、首次 Context 业务闭环、外部集成与人工验收仍为 NOT RUN；EP-TD-001/002 不标业务 PASS。本次未改变冻结决定。

正式记录依项目 AGENTS.md 保存于本路径。用户随后授权写入 comments，已发布并回读核对[PR 评论](https://github.com/qzhike/zhiju-business-core/pull/160#issuecomment-5612067875)，内容一致。这是 PR 评论，不是 GitHub formal review。下一步由 Implementer 修复 R1 后重新提交独立审查。
