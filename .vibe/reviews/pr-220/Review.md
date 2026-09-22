# PR #220 独立实现审查

- 结论：`REQUEST_CHANGES`
- PR：[#220](https://github.com/qzhike/zhiju-business-core/pull/220)，关联 Issue：[#219](https://github.com/qzhike/zhiju-business-core/issues/219)
- Reviewed SHA：`a181543f0907d44b593f9c6a49a858c85113830c`
- 日期：2026-09-22
- GitHub handoff：[已发布并读回的 PR comment](https://github.com/qzhike/zhiju-business-core/pull/220#issuecomment-5772722068)；本记录不代表 GitHub formal review 或人类技术批准。

## 审查依据与范围

独立读取 Issue 与评论、当前 PR head/diff、HL-Spec、Spec 003 §21、Spec 001 §15.10–15.11、PostgreSQL §36、Module-Test-003 的 TE-VAL-D/TE-VAL-S，以及对应 Registry、组成层、授权重验、计划校验、Validation/Freeze/Query、事务和迁移实现。PR #218 的设计审查没有替代本次实现审查。

成功标准是 canonical DRAFT/INITIAL Context 在独立当前授权下产生精确判断、原子 Freeze/READY 与权威 Contract 读回，同时保存规定的数据库引用、Scope、不可变性及兼容约束。当前发现数据库约束不满足，停止于 `REQUEST_CHANGES`，不宣称其余未执行组合已全部通过。

### 受影响契约字段核对

| 契约 | 核对字段 / 边界 | 结果 |
| --- | --- | --- |
| `validate_work_order_draft@1.0` payload | closed 必填 `draftSnapshotRef`、`candidateContract`、`policyRef`、`evaluatorRef`；分别引用既有 ContentAddressedRef、完整 Core WorkOrder、Policy VersionedRef、Evaluator VersionedRef | Schema 与 §21.1 对应 |
| 新 CommandResult | closed `data.validationSnapshotRef`；Project Scope、kind/type、target objectId、snapshotId 与 objectId 相等 | Schema + binding helper 覆盖 |
| Controls Policy | closed `controls`；九个必填组 `targetScope`、`allowedCapabilities`、`deniedCapabilities`、`expectedOutputs`、`riskAndQuality`、`executionPolicy`、`budget`、`harnessPolicy`、`modelPolicy`；复用 Core 子结构 | 已核对 Schema 与 evaluator 的来源及比较 |
| Policy observation | closed `kind`、`role`、`reference`、`policyVersionRef`、`contentHash`、`effectiveFrom`、`supersededAt`；嵌套 VERSIONED/SNAPSHOT 身份 | **SQL 接受缺失的 versionId / snapshotId，见 F1** |
| Static observation | closed `kind`、`role`、`reference`、`registryVersion`、`registryKey`、`descriptorHash`；四个固定角色 | 应用使用 exact registry；SQL 嵌套引用检查须随 F1 补齐 |
| 新 judgment | §21.2/21.8 顶层闭集、七结论/checks、subjectRefs 三个精确引用、有序 dependencyObservations、两类 Hash、inputHash、来源、Scope 与有效期 | 外层闭集及部分镜像已有检查；**精确 subjectRefs / Context Scope 不闭合，见 F1** |
| 既有 Freeze / Contract Query / Ready Event | PR 不改对应已注册 Schema；检查候选消费、Root pointer 读回和真实 Event envelope 校验路径 | 未发现公开字段改写；完整门禁证据见下文 |

## F1 — P2：补齐新判断 SQL guard 的嵌套引用与 Scope 闭合

位置：`migrations/task_execution/V3005__work_order_validation_freeze.sql:93–104`、`:358–384`；相关 payload shape 在 `:274–288`。

`work_order_validation_payload_valid` 只检查 Policy observation 引用的 kind/type/scope，没有要求 `reference.objectId/versionId`、`policyVersionRef.objectId/snapshotId/contentHash` 等完整引用成员。subjectRefs 只有 array 类型检查，既不要求恰好三个精确引用，也不要求与顶层对应。mirror guard 对 Context 只比较 snapshotId/hash，没有闭合其 Scope/kind/type/objectId。重算 hash 并不能证明这些引用有效。

这违反 Spec 003 §21.2/21.8 的精确引用和 subjectRefs 规则，以及 PostgreSQL §36/36.1 的新 kind 结构、Scope/mirror 与 observation 类型闭合要求。问题属于数据库 INSERT 防线：应用角色可以保存无法按规定重建的不可变判断，且引用的 Project 与行的 Project 不一致。此反例未声称公开 API 已能绕过应用授权获得 READY。

### 独立反例

在全新、仅用于本次审查的 PostgreSQL 18.6 容器中加载仓库原始迁移至 V3005，使用现有 READY fixture 与真实纯 evaluator 输出构建合成正向判断。对每个样本重算 `inputHash` 和 canonical `payload_hash`，保持其他 promoted mirrors 与匹配的 PENDING Validation Receipt。建立同 Project 的受信 SERVICE context，切换到 `task_execution_app`，执行真实 `execution_judgment` INSERT；每次随后 ROLLBACK。未关闭 trigger、CHECK 或 RLS，也未改迁移。

| 单变量样本 | 应有结果 | 实际结果 |
| --- | --- | --- |
| 正向结构对照 | 接受 | helper=true；app INSERT 1 行 |
| 删除 CONTEXT_BUILDER observation 的 `reference.versionId` | 拒绝 | helper=true；app INSERT 1 行 |
| 删除同一 observation 的 `policyVersionRef.snapshotId` | 拒绝 | helper=true；app INSERT 1 行 |
| `subjectRefs=[]` | 拒绝 | helper=true；app INSERT 1 行 |
| 只把 `contextSnapshotRef.scope.projectId` 换成另一 Project | 拒绝 | helper=true；app INSERT 1 行 |
| 在 observation 外层增加 `extra` 字段 | 拒绝 | helper=false，证明现有外层闭集检查实际生效 |

该诊断只证明数据库结构/镜像约束漏洞；合成 INSERT 不充当 owning 业务正链验收。探针没有提交业务事实；临时容器在审查结束时清理。

修复要求：为 WORK_ORDER_VALIDATION 新分支补齐完整嵌套引用的 required/closed/type/hash 校验、同 Project Scope 绑定及 subjectRefs 的精确成员/顺序/唯一性；保留 TASK_READINESS 历史规则。增加上述单变量的真实 app-role INSERT 反例，连同 source Receipt 和相关镜像负例执行，再提交修正 head 的 full 证据并独立复审。不要求数据库解析外部 Policy 业务状态或模拟静态 registry。

## 验证证据与剩余门禁

- 已从 GitHub run 元数据与日志核实 [CI run 35697155367](https://github.com/qzhike/zhiju-business-core/actions/runs/35697155367) 对应 reviewed SHA，选择并通过完整 `full`：普通测试 75 个文件 / 1379 项通过；持久化 44 个文件 / 494 项通过；Catalog/Registry 217。按证据复用规则未重复运行本地 full。
- Reviewer 独立 PostgreSQL 反例暴露 F1。CI 的绿色结果不覆盖该语义漏洞；现有新增 guard 测试主要验证外层 extra、观察顺序、inputHash 与结论篡改，没有拒绝本次完整引用/Scope 反例。
- 文档已列出的迟到撤权、Policy 取代、逐列 INSERT/source Receipt 等未执行组合仍为 `NOT RUN`；本次未将这些组合改记 PASS。
- 人类技术审查仍待完成。外部 Provider/Runtime/飞书、生产部署、Run/Completion 与独立人工业务验收均为 `NOT RUN`，且不属于本次 READY 交付。
- 本轮只新增正式审查记录，不修改产品实现或冻结设计，不 commit、push 或 merge。记录进入 PR 分支仍需相应 Git 交付授权；评论发布与文件入库是两项不同事实。
