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
