# PR #203 独立审查

## 当前结论（第 4 轮）

- 结论：`APPROVE`
- Reviewed SHA：`7075741aa643479749591f631713a88640d9991e`
- Base SHA：`53f0715fc994a65977a355557e0f9f5043ed55e4`
- PR：[#203](https://github.com/qzhike/zhiju-business-core/pull/203)
- Work item：[#202](https://github.com/qzhike/zhiju-business-core/issues/202)（T2 design）
- 审查日期：2026-09-15

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #202、PR 最新 head 与实际 diff、受影响 Module Spec/Test、共享 Typed Reference Contract、EnterpriseProject 边界、Task Domain 不变量和精确 revision 的验证证据；未把实现者提交说明或评论当作正确性依据。前三轮失败结论保留如下，后续批准不抹除历史 finding。

## 第 1 轮：`REQUEST_CHANGES`

- Reviewed SHA：`3eb90708a0cfa43841a5ef8bee171d6181e9f1de`
- [PR 总结](https://github.com/qzhike/zhiju-business-core/pull/203#issuecomment-5679157731)

阻断发现：

1. TaskDefinition 全部引用统一要求 Project Scope，会拒绝注册的 Platform-scope Evaluator，也无依据排除 Enterprise/Platform `inputRefs`。
2. EnterpriseProject Port 未明确 `projectRef.objectId == projectRef.scope.projectId == trusted projectId`，Schema 无法替代该跨字段相等约束。
3. `parentTaskRef` / `dependencyTaskRefs` 未按 create-task v1/v2 闭合 Task objectType。

行内记录：

- [blanket Project-Scope finding](https://github.com/qzhike/zhiju-business-core/pull/203#discussion_r4014864690)
- [Project identity equality finding](https://github.com/qzhike/zhiju-business-core/pull/203#discussion_r4014864964)
- [version-bound Task objectType finding](https://github.com/qzhike/zhiju-business-core/pull/203#discussion_r4014865222)

## 第 2 轮：`REQUEST_CHANGES`

- Reviewed SHA：`4c0a54bbdc33ba2273cdd593952d14d82804229f`
- [PR 总结](https://github.com/qzhike/zhiju-business-core/pull/203#issuecomment-5679560159)

第 1 轮三项 finding 均已关闭；新阻断是逐字段 Scope 规则只比较 Project 维度，未要求 Enterprise Scope 与 Envelope 属于同一 Enterprise，且 v2 policy/evaluator 也可能接受跨 Enterprise/Project Ref。这些引用会进入不可变 TaskDefinitionSnapshot，不能把创建期可确定的 tenant containment 推迟到后续解析。

- [Enterprise containment finding](https://github.com/qzhike/zhiju-business-core/pull/203#discussion_r4015135907)

## 第 3 轮：`REQUEST_CHANGES`

- Reviewed SHA：`03bad34ad1a254dd9b090a8c64ab32b456c88035`
- [PR 总结](https://github.com/qzhike/zhiju-business-core/pull/203#issuecomment-5680004128)

第 2 轮 Enterprise containment finding 已关闭；新阻断是 `inputRefs: TypedReference[]` 的 `ExternalRef` 分支没有顶层 `scope`，而设计把全部输入都归入顶层 Platform/Enterprise/Project Scope。按字面实现会拒绝 Schema 合法的 ExternalRef；跳过该分支又会允许跨 Enterprise 的 `tenantOrAccountRef` 或无绑定 ExternalRef 绕过规则。

- [ExternalRef branch finding](https://github.com/qzhike/zhiju-business-core/pull/203#discussion_r4015437503)

## 第 4 轮复核

### 前序 finding 关闭确认

- 第 1 轮三项 finding 在 `4c0a54b` 后保持关闭：逐字段 Scope、Project identity equality、v1/v2 Task 引用 objectType 均已进入 owning Spec 和验收矩阵。
- 第 2 轮 finding 在 `03bad34` 后保持关闭：有顶层 `ScopeRef` 的引用按 Platform `{}`、Enterprise `{enterpriseId}`、Project `{enterpriseId, projectId}` 闭合；Enterprise/Project containment 在 DRAFT、快照写入前执行。
- 第 3 轮 finding 已在本轮关闭：`ExternalRef` 明确按有无 `tenantOrAccountRef` 分支处理。存在时校验 `tenantOrAccountRef.scope` 落在 Envelope 内；缺省时允许作为无租户绑定的来源意图进入 DRAFT，但不得直接作为输入存在性、Readiness、blocker 或完成条件事实，必须先经 owning 授权 Adapter/Domain Command 形成正式对象。

### 契约与测试矩阵核对

- `contracts/src/common.schema.ts` 的 `TypedReference` 五个分支均有确定的 DRAFT 处理规则；没有把 `ExternalRef` 错当成具有顶层 `scope` 的 Ref。
- `ScopeRef` 的 `dependentRequired` 与设计的三种闭集形态一致；只带 `projectId` 的形状仍由 Schema 拒绝。
- `TE-P202-006` 为 v1/v2 输入定义了同 Enterprise、跨 Enterprise、跨 Project和无 tenant/account 绑定的 ExternalRef 分支；预期错误为 `EXECUTION_DEFINITION_REF_INVALID`，无绑定正例只保留来源意图。
- `TE-P202-007` 增加 `ExternalRef.tenantOrAccountRef.scope` 的跨 Enterprise/Project 单变量隔离探针。
- `TE-P202-D-003`、决定 §15.4 和 Spec §16.8 与上述规则一致，没有把未来 Handler、Readiness 或外部 Adapter 行为误标为已实现。
- v1 `inputRefs` 历史 `uniqueItems` 与 v2 普通数组语义保持不变；Catalog 213、Compatibility Baseline 200、公开 Query 接受集和冻结 fixture 均未修改。

本轮未发现新的 correctness、contract、scope、security、compatibility 或不必要扩展问题。

## 验证证据

精确 reviewed SHA 的 GitHub Actions [run 34968508825](https://github.com/qzhike/zhiju-business-core/actions/runs/34968508825) / verify job [104378703397](https://github.com/qzhike/zhiju-business-core/actions/runs/34968508825/job/104378703397) 已回读为 `COMPLETED / SUCCESS`，head 为 `7075741aa643479749591f631713a88640d9991e`。

本地在同一 SHA 运行：

```text
DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json
```

最终结果：`PASS`，resolved command 为 `pnpm clean && pnpm verify`，exit code 0。包括：

- format、lint、TypeScript、architecture 全部通过；
- regular suite：59 files / 969 tests passed；
- public API generation：213 operations；policy profiles 7；evaluator profiles 2；creation purposes 4；
- catalog/registry：213/213；compatibility baseline：200 operations；
- PostgreSQL 18.6 / Flyway 11.20.3 persistence gate：40 files / 406 tests passed；
- 空库迁移、V6003/V6004 历史升级、第二次 migrate no-op 均通过，容器已清理。

第一次本地执行在 Docker Hub anonymous token 请求处返回 `EOF`，regular/contract checks 已通过但 persistence gate 未启动，因此该次结果保留为环境失败而非 PASS。只读宿主 Docker 探针恢复后，对相同 SHA 重跑完整目标并获得上述 PASS；没有绕过、拆分或弱化 persistence gate。

`git diff --check 53f0715f..7075741a` 通过；开始审查时工作树干净。

## 未运行边界与后续门禁

本 PR 是设计交付，不包含 Task DRAFT Handler、EnterpriseProject 创建校验 Port、Task 业务表/migration、授权消费接线或生产能力配置。`TE-P202-001`–`015` 的 Handler、真实业务表、RLS/ACL、直 SQL 篡改、回滚、并发和跨版本重放仍为 `NOT RUN`；现有 full gate 只证明仓库基线与本设计修订未破坏已有可执行行为。

`APPROVE` 是对精确 SHA `7075741aa643479749591f631713a88640d9991e` 的独立 agent review 结论，不授权 merge、实现或创建后续 Issue。

## 人类设计批准记录

- 批准日期：2026-09-15
- 批准对象：PR #203 revision `7075741aa643479749591f631713a88640d9991e`
- 批准内容：Issue #202 的 Task DRAFT 创建引用身份、Project/DeliveryItem owning Port、DRAFT/READY 校验时机、Task Root 与不可变 TaskDefinitionSnapshot 创建事实、公开事件边界、授权顺序和 `TE-P202-*` 验收设计
- 批准来源：用户在当前会话明确表示“审核批准”

该批准完成 Issue #202 要求的显式人类设计 Gate，但不追溯覆盖其他 SHA、TD-05–07 或未呈现的实现选择，也不授权 merge、commit、push、migration、业务实现或创建依赖 Issue。Task DRAFT Handler 只成为可由 Planner 重新执行 `NOW + READY` 复核的候选；实际 Issue 发布需要单独授权。
