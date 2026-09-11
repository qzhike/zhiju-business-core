# IM-06 Human-operated 执行边界与设计提案

日期：2026-09-09
状态：`TD-01–04 APPROVED 2026-09-08 / TD-01 EXPIRY ADDENDUM APPROVED 2026-09-09 / #165 DRAFT VERSION PINS @1.1 CONTRACT IMPLEMENTED 2026-09-11 / TD-05–07 PROPOSED / HANDLER IMPLEMENTATION NOT STARTED`。用户已于 2026-09-08 批准 #151–#154 已呈现的方向与约束，并授权技术设计。用户随后明确“批准你的设计，提交更新”，批准本修订 TD-01–04 的具体 API、字段、持久化与首版范围。§1–10 为已批准的未来技术设计，其中 §8.4 的期限补充于 2026-09-09 单独获批；#165 已把其中的 DRAFT/initial Context 兼容契约同步到 Schema、Registry、生成类型和 fixtures，但不代表业务 Handler 或业务持久化链已经存在；§11 是剩余设计提案，尚未批准，不宣称实现存在。推进顺序见 [roadmap](../product/roadmap.md)。

## 1. 分类与既有边界

IM-06 按 T2 规划：涉及安全绑定、不可变 Contract、数据库并发 Claim、跨 Aggregate 恢复和 Completion。既有设计仍以 [HL-Spec §5](../high-level-docs/HL-Spec.md)、[架构 §20.7](../high-level-docs/02-zhiju-core-architecture.md)、[Core Contracts §3–5](../high-level-docs/03-core-contracts.md)、[Domain §18–22](../high-level-docs/04-domain-model-v0.1.md)、[Module Spec/Test 003](../module-specs/Module-Spec-003-TaskExecution.md) 为准。

目标是由 Human 发起并审阅、由 owning Service 执行的可重复 Core 流程。Human 不直接拼写可信 AgentResult，不通过布尔值完成 Task/WorkOrder；确定性测试 Driver 的结果只提供合成技术证据。真实 CLI、Provider、飞书收答与 Workspace UI 分别保留在既有后续里程碑。

TaskExecution 当前业务入口仍为 `SKELETON`；已有 42 个版本化字段级操作（20 Command、8 Query、11 Event，其中三个为 #165 的 @1.1 兼容版本）与 V3000 技术表，不等于业务 Handler、业务表或完成闭环已经存在。EnterpriseProject 的 TaskCompleted 消费能力可作为后续衔接点，不能以其合成事件测试替代真实 TaskExecution Producer。

## 2. 首次 Context 与冻结 Contract 的构建顺序

**缺口。** Module Spec §2 的 `ContextBuildRequest.workOrderContractRef` 必填且为 Content-addressed Ref；Core WorkOrder §4.3 又要求 `contextSnapshotRef`，§4.13 要求引用有效。当前材料没有定义首个 Context/Contract 如何在无历史 Snapshot 时建立，也没有定义“预分配 ID”如何满足内容 Hash 与存在性校验。Retry 另有明确约束：新 Context/Run 不能改写旧冻结 Contract。

**建议。** 将首次构建与冻结后构建分开建模：首次从已持久化 DRAFT WorkOrder 的精确版本/Hash、裁剪 Source Slice 与 Builder Policy 构建 Context；冻结命令再绑定该 Context。冻结后构建继续要求原精确 Contract，新的 Run 独立绑定新 Context。首次请求必须在发布 Snapshot 前校验 DRAFT 版本未变化，禁止 dangling ref、占位 Hash 和 latest。

**Spec Delta。** 技术设计明确 `ContextBuildRequest` 的版本化首次构建分支及 DRAFT 输入引用类型，保留现有 `@1.0` 的合法调用；同步 Core §3/4、Module Spec/Test 003、API 兼容规则、可执行 Schema 与 §07 持久化绑定。具体字段和版本已按 §7–10 及 owning 规格批准；不直接把必填字段改为可选。不新增业务模块或跨 Schema 外键。

**替代方案与代价。** 仅允许调用者提供预先存在的 Context，无法证明空业务库的首个流程可操作；一次事务创建两个独立 Aggregate 违背单 Aggregate 事务边界；预写不完整冻结 Contract 违背不可变性。建议方案需要明确 API 兼容和 DRAFT CAS，但能独立审计首次构建与后续 Retry。

**验收。** 空业务库经正常 owning 入口完成首个 Context→冻结；DRAFT 竞态、错 Hash/Scope/Purpose 或不存在输入均拒绝且不留下可执行 Snapshot；回答后 Context-2 与 Run-2 引用新输入，WorkOrder Contract、Context-1 和 Run-1 的 Hash 不变。

## 3. Human-operated Driver 与 Runtime 控制缺口

**既有约束。** Domain §20.9 把 Run 创建、Result 接收和验证分配给 Dispatcher/Ingestion/Validator Service；`start_run` 要求 RuntimeAttempt、lease 与 fencing，不能用 Human 身份或内存伪造引用代替。Runtime 专项 §15.1 的六个新增 Command 仍是 IM-DG-006 的待审提案，不因 IM-06 启动自动进入 Catalog。

**建议。** 使用受控、确定性的测试 Driver，经 IntegrationGateway Port 产生可验证的 Attempt，再由受信 Service 调用已有 owning Command。Human 只发起授权操作和回答/采纳资料。Identity、Attempt、Run、Result 的 Scope/Hash/来源链均需读回；测试替身必须明示 `SYNTHETIC / TECHNICAL ONLY`，不声称真实 Provider Usage。

**本阶段限制。** Cancel request 只证明进入 CANCELLING 及竞态隔离，不声称收到 Cancel ACK；同 Run Resume、Heartbeat、独立 Runtime Usage 写入与真实 Runtime fallback 不提前进入本阶段。Usage 缺失用 UNKNOWN/UNAVAILABLE，Agent 声明独立保留。final BLOCKED_INPUT 可走已有 Result Acceptance 后的新 Run Retry。

**初始缺口（已由 §9 与 Spec 003 §11 的批准设计收敛）。** owning Process 如何从已提交 Acceptance 事实推进 Run terminal 状态、释放 active claim；哪些已批准入口驱动 timeout/late-result 测试；可信 RuntimeAttempt 的持久化读取边界。不得直接写表构造集成成功，也不得用私有跨模块写入口绕开缺失 API。若这些目标必须依赖新增公开操作，应单独提交 Spec Delta 和用户决策，再评估 IM-DG-006 的适用范围。

**影响与验收。** Module Spec/Test 003、Runtime 专项映射、Module Spec/Test 007 的最小 Attempt 边界及 §07 Claim 设计按决定同步。伪造 Attempt、过期 lease、旧 fencing、跨 Run 回调全部拒绝；取消未确认不显示 CANCELLED；late result 不产生业务输出或 Completion。Issue #27 的剩余 Runtime/Feishu 总体范围不自动纳入此切片。

## 4. Readiness、Validation 与 Completion 的权威来源

**缺口。** 现有公开入口接收 TaskReadiness、WorkOrderValidation、五类 Result Validation 引用，以及 `CompletionEvaluationInput`；字段级引用已存在，但首批业务实现仍需固定这些事实的生产者、精确查询、生命周期和校验矩阵。WorkOrder 的七类 Criterion 名称已在 Core §4.9 冻结，不能让任意 `CanonicalJson` 或未知 Evaluator 自动满足 Task Completion。

**建议。** owning deterministic Builder/Validator/Evaluator 生成不可变判断事实；调用者传入的 Ref 只是定位信息。消费端验证 id、Hash、Owner、Scope、Purpose、输入版本、适用 Policy 及当前有效性；找不到或不支持的 Criterion/Policy 拒绝，不信任传入的 `valid`、`executionOutcome` 或无阻塞声明。

Task Criterion 的首版字段、支持的质量/审批条件，以及 InformationRequest Resolution 所要求的 owning Domain Command Receipt，应先在对应 Module Spec/Test 固定；不引入通用表达式语言。跨 Aggregate 推进用已提交事件、Inbox 和幂等 owning Command；同一事务不直接完成 Run、WorkOrder、Task、DeliveryItem 四个 Aggregate。

**验收。** 伪造/过期/错作用域判断 Ref、未知 Criterion、未解决 blocking 请求、scratch DOCX、错误输出 provenance 都不能完成业务工作；Run SUCCEEDED、WorkOrder COMPLETED、Task COMPLETED 分别有独立可解释事实。TaskCompleted 通过真实 Producer→EnterpriseProject Consumer 验证重复、乱序和错 Scope，DeliveryItem 仍按自身条件判定。

## 5. 可独立先行的技术基础切片

此切片只落实已批准 [PostgreSQL §17](../high-level-docs/07-postgresql-logical-model-v0.1.md) 与 [RLS 事务上下文](rls-transaction-context.md) 的模块内机制，不依赖上面待定业务语义。

- 范围：TaskExecution 自有 DB/Repository/Command runner/write guard，使用现有 V3000 技术表；以 `process_instance` 技术 Aggregate 验证事务，不新建 Task/WorkOrder/Run 业务表，不引入新 API 或 Policy。
- 同 Scope、相同幂等键/Hash 重放返回持久化原结果，不重复成功事务的 Process/Audit/Outbox 效果；不同 Hash 返回稳定冲突并保留必要安全审计，不产生第二次业务状态推进。
- 并发 expectedVersion 只允许一个更新成功；CAS 使用精确 bigint，不经过有损 Number 转换。
- Receipt、目标技术 Aggregate、Audit、Reference Edge、Outbox 一起提交；技术写入后的注入异常必须全部回滚，重试可恢复。
- 跨 Enterprise、同 Enterprise 错 Project、无 Context、过期/不匹配 Decision、错 Actor/Target、payload↔Hash/Scope mirror 不一致全部失败；连接池复用不继承旧事务 Context。
- Repository 只使用本模块角色与 Schema，不复制 IdentityPolicy 的授权判定，不共享他方 Repository。

验证：focused Unit + disposable PostgreSQL 负向/并发/重放用例，之后 `vibe verify full --json`。本切片遵循已批准技术设计；若实现需要新增表、改变安全机制或公开 Contract，重新做 T2 Spec Delta/readiness 判断。它不把受控事务上下文测试扩大为生产认证接入证明。

## 6. 设计审核与分阶段验收

第 2–4 节的方向与约束已获批准；本轮已批准技术增量见 §7–10 及 owning 规格的设计附录。具体增量现已批准；可执行 Schema/Catalog 注册与业务实现仍须按依赖交付，再发布满足 NOW + READY 的实现 Issue。第 5 节可独立作为首批 NOW + READY 候选，不把未决业务设计传给 Implementer。

最终可审阅产出应同时展示正常完成与 final BLOCKED_INPUT 恢复链，保留精确 Ref/Hash、Actor/Decision、Context、Attempt、Result Acceptance、分层 Completion、Usage 来源、命令输入和预期/实际结果。适用既有 TE-U-001–005、TE-E-003、TE-API-U-001–003、TE-API-C-001/002 与 TE-API-M-001，并增加上面首次构建及伪造判断引用的失败场景。

受控答案恢复证据单独列示；含真实飞书的 TE-E-001/TE-API-E-001、真实 Runtime 的 TE-E-002/TE-API-E-002、公开 HTTP、生产和独立人工业务验收，未执行时继续 `NOT RUN`。不把本规划中的预期输出写成测试 PASS。


## 7. 技术增量与决定边界（#152–#154）

设计范围批准记录：[WI-02](https://github.com/qzhike/zhiju-business-core/issues/152#issuecomment-5578835623)、[WI-03](https://github.com/qzhike/zhiju-business-core/issues/153#issuecomment-5578835926)、[WI-04](https://github.com/qzhike/zhiju-business-core/issues/154#issuecomment-5578836373)。本轮以 `cfa2f9006289e8a36debe9fcf66ea5f3ca6c6cb4` 为现行实现/契约对照点；技术设计不是已实施事实。

| 决定项 | 已批准方案 | 兼容及代价 | 未采用方案 |
|---|---|---|---|
| TD-01 首次 Context | 新操作 `execution.build_initial_context_snapshot@1.0`，输入精确不可变 Draft Snapshot；保留原 `build_context_snapshot@1.0` 冻结后语义 | 新增 Draft Snapshot 与 Source Slice 捕获/读取；Core Context 与 WorkOrder v1.0 本体不变 | 把旧必填 ContractRef 改为可选会改变语义；用占位 Hash/交叉预分配 ID 无法证明内容和存在性 |
| TD-02 Runtime 控制 | 新增明确的 record-result、finalize-from-acceptance、expire-run 与 WO/Task reconcile 命令；TE/IG 提供完整 Dispatch/Attempt Binding Query | 增量公开端口、模块内 Claim 与恢复过程；不批准 Runtime 专项六项命令 | 私有跨模块 Repository 写入、仅凭 AdapterAttemptView 状态或自报布尔值推进 Run |
| TD-03 判断事实 | 显式 Builder/Validator 创建不可变事实；一项只读 tagged-union Query；Task typed definition 用新 Major | `create_task@2.0` 与 v1.0 并存，旧 Schema/历史数据不收窄；新增判断事实存储 | 直接收窄 v1.0 的 CanonicalJson、通用规则表达式或允许调用者决定 valid/completed |
| TD-04 首版答案和质量范围 | 首版答案闭环采用已确认 CustomerMaterial；通过 EP Receipt attestation 证明领域写入。Task 支持正式输出与精确 RAS/ABS 质量条件；其他类型 fail closed | 新增 EP 窄 Query；首版不支持任意 Fact/Policy Exception/Release Criterion。后续扩展需独立决定 | 把收到文本、关联 correlationId 或 caller Receipt 当作采纳事实；让 Task 复制 Release/DeliveryItem 判据 |

TD-01–04 已于 2026-09-08 获用户明确批准，包含新操作、Task v2 与首版类型限制。完整已批准字段、授权与错误在 [Module Spec 003 技术设计附录](../module-specs/Module-Spec-003-TaskExecution.md#11-im-06-技术设计)；IG/EP 的字段分别由 [Spec 007](../module-specs/Module-Spec-007-IntegrationGateway.md#im-06-runtime-binding-query-设计)、[Spec 002](../module-specs/Module-Spec-002-EnterpriseProject.md#im-06-source-slice-与-resolution-receipt-设计) 拥有。#165 已将 DRAFT/initial Context 的三个 @1.1 兼容操作纳入当前 208 项 Catalog，并保持历史 Compatibility Baseline 不变；其余仅设计操作仍不自动进入 Registry。

## 8. WI-02 首次构建、冻结与 Retry

1. Human 经 `create_work_order@1.0` 创建 DRAFT。该 WorkOrder 事务保存不可变 Draft Snapshot（独立 snapshotId、规范 payload/hash、WorkOrder/Task/Scope），Root 指向它。snapshotId 不是 aggregateVersion，Snapshot 不含自身 Hash。当前没有编辑 DRAFT 的公开操作；将来若新增编辑，必须追加 Snapshot 并 CAS 移动 pointer。
2. 经候选 `get_work_order_draft` 读取精确 Draft Ref；EP 候选 `capture_context_source_slice` 从受权限裁剪的 owning 事实形成不可变 Source Slice，再经 exact Query 读回。现有 `get_project_context_source` 只返回动态 View，没有可供解引用的 ContentAddressedRef；禁止给它任意添加一个 Hash 后冒充已持久化 Source Slice。
3. `build_initial_context_snapshot` 只接受该 Draft Ref 与 Source Slice refs。Builder 从 owning Query 读取来源，按 purpose/audience/policy 剪裁；成功发布前，在 ContextSnapshot 事务中以同模块只读行锁重验 WorkOrder 仍 DRAFT、Root pointer/Scope 相同。事务只写 ContextSnapshot/build metadata/技术事实，不同时修改 WorkOrder。来源过期/错 Scope、Draft 已变化均拒绝且不发布成功 Snapshot。
4. ProjectContext v1.0 的 `workContext.workOrderRef` 只指向已存在 Root；Context 不嵌入将来的 frozen Contract Hash。Build metadata 绑定 Draft Ref、slice refs、purpose/audience/policy，排除 Hash 自引用。Snapshot 创建并不授权执行；即便之后 Draft 变化，旧 Snapshot 仍可审计，但不能通过 Freeze guard 取得执行资格。
5. 拟冻结 WorkOrderContract 由 Draft 的全部字段与新 Context Ref 机械组装；`issuedAt` 等签发元数据单独生成，按现有规范计算 payloadHash/specificationHash。先生成 WorkOrderValidation，再由 `freeze_work_order@1.0` 在 WorkOrder CAS 事务内重验 Draft pointer、candidate Hash、Context 来源和判断有效性，设置唯一 frozen Contract Ref。不得同时改 Context 或 Task。
6. 冻结后 `build_context_snapshot@1.0` 保留原必填 ContractRef；回答后 Context-2 的 build metadata 绑定原 Contract、新 Source Slice/已 RESOLVED Answer/Receipt。Run-2 显式绑定 Context-2，既有 Contract 中 Context-1 保留。新 Context 必须满足原 targetScope/purpose/capability；范围或 Objective 改变必须新建 WorkOrder。

同键同输入重放返回原 Snapshot/判断；输入改变需新命令键和新 immutable identity。同键异 Hash 冲突，不能重建原 ID。时间来自受信服务；所有时效查询重验服务器时间，而非信任 caller 的 evaluatedAt/requestedAt。来源对象后续变化不改写旧 Source Slice；当前授权或生命周期失效影响新消费资格，并记录拒绝/失效事实。

### 8.1 空业务库的依赖与提交顺序

“首次”不要求预先存在 Context 或 frozen WorkOrder，也不豁免基础业务事实。先经 IdentityPolicy 和 EnterpriseProject 正常 owning 入口建立授权主体、Enterprise/Project、Core §3.5 必需的 EnterpriseProfileSnapshot/QmsConfiguration 及适用的版本化 Policy；缺少必需来源应拒绝，不生成空壳引用。再经 Task owning 入口创建 Task，并按 #154 的 Readiness 规则满足创建 WorkOrder 的生命周期要求。首版来源仅限 EP owning Source Slice；本项不发明 Policy 内容、Task 判据或其他模块 Source 捕获 API。

| 提交步骤 | 唯一写 Owner / Root | 已提交输入与输出 | 在此停止后的合法状态 |
|---|---|---|---|
| 创建 DRAFT | TE / WorkOrder | 已存在 Task/Scope → WorkOrder + 附属 Draft Snapshot + Root pointer | 无 Context/Contract；Draft 可精确读取 |
| 捕获来源 | EP / ContextSourceSlice | 已存在 EP 权威事实及授权 → immutable Slice Ref | 不写 TE；已提交 Slice 不因后续失败回滚 |
| 首次构建 | TE / ContextSnapshot | exact Draft + Slice + Policy → Context + INITIAL metadata | WorkOrder 不变；Snapshot 存在本身不赋予执行资格 |
| 验证候选 | TE / WorkOrderValidation | Draft + Context + 完整 candidate → exact Validation Snapshot | 不修改 WorkOrder 或 Context；判断可因时效/输入变化不可用 |
| 冻结 | TE / WorkOrder | 当前 Draft、candidate、Context、Validation + expected version → frozen Contract + READY | 只写 WorkOrder 及附属事实；失败不留下部分 frozen binding |

每步 Receipt/Audit/Reference Edge/适用 Outbox 与目标事实同事务；跨步骤不存在原子总事务。引用 ID 只有在 owning 提交成功并能校验内容 Hash 后才可作为下一步输入；CREATE 的目标 ID 可由 Envelope 指定，但不能提前作为已存在输入。字段映射、失败分类、响应丢失恢复与 Retry 约束唯一维护于 [Spec 003 §11.2](../module-specs/Module-Spec-003-TaskExecution.md#112-首次-context-的精确输入)，避免在此复制字段定义。

### 8.2 TD-01 权威增量与兼容交付边界

下表是已批准 TD-01 的设计路由与后续交付约束，不是执行日志或新的 API 批准；本 Issue 不修改可执行 Schema、Registry 或 migration。

| 权威 / 精确位置 | 本项增量与保持项 | 后续实现的可审阅反例 |
|---|---|---|
| Core §3.3/3.8/3.10、§4.3/4.13，IM-06 附录 | Context 只引用已存在 WorkOrder Root；首次绑定在本体外，Freeze 引入已存在 Context；v1.0 本体/Hash 范围不变 | Context 嵌未来 Contract Hash、Retry 改旧 Contract 或以 payloadHash 代替 specificationHash 均拒绝 |
| Module Spec 003 §2/3、§11.1–11.3；Module Test 003 TE-TD-001–008、TE-WI02-D-001–008 | 新 initial 入口/精确 Draft 读取与旧 frozen 入口并存；字段/版本/授权、并发与恢复矩阵 | 旧请求缺 ContractRef、新请求带旧字段、Draft 竞态、同键异输入不得成功 |
| Module Spec 002「IM-06 Source Slice 与 Resolution Receipt 设计」；Module Test 002 EP-TD-001/002 | capture 新 Slice 与 exact Query；保留 get_project_context_source 动态 View | 动态 View 加自算 Hash 不成为已存在 Slice；错 Purpose/Audience 拒绝 |
| 共享 API「IM-06 兼容性增量」；Catalog 06 owning operation/Ref 注册 | 新操作独立 @1.0；不改变旧必填字段、Envelope、Result/Event；新 Purpose 需要显式策略 | Service 通配授权、未知 objectType、旧 Schema 被收窄均不合格 |
| `contracts/src/operations/task-execution.schema.ts`、`enterprise-project.schema.ts`、`contracts/src/core.schema.ts`、`contracts/registry/public-api.v1.json` 及生成类型/fixture | 后续注册 Draft/Initial 请求、Source Slice capture/read、Draft Query 和 Validation 衔接所需 Schema；Core 仅被引用，不改变本体；保持旧 201 项与历史 Compatibility Baseline | 只加操作名字却无 Envelope/Ref/错误/PayloadGuard/正负 fixture，或改写历史 baseline，不能算交付 |
| PostgreSQL §11.2、§18、§33 | Draft immutable payload/Root pointer、Context build 输入闭集、唯一冻结 binding；EP Slice 独立提交 | 只验证 Hash 长度、Snapshot 与 metadata 分开提交、跨 Schema FK/写事务均拒绝 |

### 8.3 已解决边界与后续 readiness

本项已明确首次构建的循环引用、必填输入/兼容方式、精确 Hash/Scope/Purpose 绑定、单 Root 提交、并发失败/恢复及冻结后 Retry 引用不变性；创建期限与冻结 Contract 的衔接已按 §8.4 批准决定同步，相关实现仍须按实际前置交付复核 READY。对应验收以 Spec 003 §11.2 的合法链和拒绝矩阵、Module Test 的输入/预期对账；新增行为的运行结果保持 NOT RUN。

#154 继续拥有 TaskReadiness、WorkOrderValidation 的检查内容、Policy/Evaluator 支持与时效以及答案/Receipt 采纳事实；#153 继续拥有 Run/Attempt、状态协调、active claim、取消/超时裁决。这里要求消费它们的精确事实和当前资格，不重复定义结论或把 Ref 存在视为 valid。TD-05–07 的待批准 Query/Usage/退出设计不成为首次 Context 引用方案的隐含前提，也不被本项追认批准。

#151 技术基础已经交付（当前事实见 roadmap）；下一候选是 TD-01–04 的必要 Schema/Catalog 与 owning 持久化交付。设计批准只解除设计依赖，不使不存在的 API/表成为可调用事实。发布 Task/WorkOrder/首次 Context 实现任务前，须核对这些前置交付与 #154 判断接口均可用，或在单独、明确的实现 Scope 中完整交付；本项不自动生成后续 Issue，不宣称完整 IM-06 NOW + READY。独立设计审查与人类批准、仓库回归、未来业务验收分别留证。

### 8.4 TD-01 创建期限与冻结期限补充

状态：`APPROVED 2026-09-09 / NOT IMPLEMENTED`。用户在本次协作会话明确“确认本次修改”，批准已呈现的期限补充：**冻结 Contract 原样继承创建期限，包括是否提供期限**；变更期限须新建 WorkOrder。此批准补充 TD-01，不追溯声称 2026-09-08 已决定该关系，也不批准 TD-05–07。

采用原样继承，避免 Freeze 再承担变更授权期限的职责；不采用冻结时自行收紧或独立指定期限的方案。创建没有期限不等于无限授权，其他 Policy/Decision/Context/Capability/Run 时限独立生效。

字段、Hash、读取、到期错误与重放规则由 [Spec 003 §11.2.4](../module-specs/Module-Spec-003-TaskExecution.md#1124-创建期限与冻结期限) 拥有；Domain §19.7.1 拥有生命周期约束，Core 的 IM-06 附录保留 payloadHash/specificationHash 范围，PostgreSQL §33 拥有存储镜像，Module Test 003 的 TE-WI02-D-009–012 覆盖拒绝反例。现有 @1.0 payload/Core 本体/历史 Compatibility Baseline 不变，新 Draft Snapshot/Query 字段随后续契约交付注册。本决定不代表 Schema、业务 Handler 或期限运行测试已经实现。

### 8.5 #157 PayloadGuard 补充方案

状态：`APPROVED 2026-09-09 / SCHEMA AND GUARD IMPLEMENTED`。分类 T2；用户在审阅本节与 owning 补充后明确“批准”，批准本次 PayloadGuard 参数、注册机制及限定范围。TD-01 已批准的接口字段和业务语义继续有效。

当前缺口：共享 API §4/§9.2 要求构建期 Guard，但当前 Registry 只有基础操作元数据，兼容元数据仅声明 Purpose/Classification/Semantics；没有可引用的 Guard 注册表。PostgreSQL §5.5 给出建议字节数，§24 仍将最终参数列为待冻结。#157 不能通过任意选择数值或只填不可解析的 Policy 名称交付。

已批准以下最小增量：

1. 仅为 #157 的 capture/read 两项操作注册有限额的构建期技术 Policy。具体参数与验证算法唯一维护于[共享 API 的补充](../api-contract-v0.1/API-Contract-v0.1.md#157-payloadguard-注册补充方案)。该 Policy 不等于 payload 中的业务 capturePolicyRef，不决定 validUntil，不授予任何主体权限。
2. 扩展现有 public-api Registry、生成器和 ContractRegistry，检查目标/模式、一致性、Purpose、Ref objectType 和 Guard 引用，并只对这两项新操作强制执行。既有 201 项保持原样，历史 200 项 Compatibility Baseline 不重写；不以修复全部历史注册欠账作为本项前置。
3. 复用现有 ProjectContextSourceSlice 命名 Schema；在新操作的 Envelope/Result 根上附加递归资源 Guard，不复制 Source View、不修改共享旧定义。既有 CanonicalJson 叶节点保持 JSON 内容能力，但在新操作内也受大小与深度约束。
4. 参数属于受版本控制的构建输入；部署不得静默修改相同 Policy 版本或绕过 Guard。更改数值须更新技术 Policy 版本、生成物、fixture 并审查 API 兼容性；收窄既有公开操作可接受输入时按共享 API Major/新操作规则处理。

范围：contracts、现有 Catalog/生成器、必要 fixture 和 owning 文档；新增静态技术 Policy 文件及纯验证 helper 属于该范围。无业务 Handler、数据库表、migration、运行主体授权或 HTTP parser。公开传输的解析前字节限制由后续接入任务落实，本次 parsed-object Guard 不替代它。

验收入口为[Module Test 002 的验证矩阵](../module-tests/Module-Test-002-EnterpriseProject.md#157-注册与-guard-验证矩阵)。本次修订同步 owning 状态并实现新操作和 Guard；交付须通过 Contract fixture、配置目标 full，随后交由独立 Reviewer 复核。只有 Schema/Guard 的实际验证可记 PASS，EP-TD-001/002 业务用例仍为 NOT RUN。本次批准解除该设计缺口；实际实现与验收仍须独立完成，不新增或修改远端 Issue。

### 8.6 #166 Context Builder Policy ref 端到端绑定

状态：`APPROVED 2026-09-10 / CONTRACT BINDING IMPLEMENTED 2026-09-11 / HANDLER NOT IMPLEMENTED`。用户已批准本 Issue 的绑定方案：首次 Context 请求、ProjectContext projection、Context build metadata 与冻结 WorkOrder `versionPins` 的 Builder Policy 必须是同一个 canonical `zhiju.identity.policy` PolicyRef。此决定只补齐引用校验契约，不批准 Policy Handler、Context Handler、migration、Provider/Feishu/Runtime 或业务验收。

`PolicyRef` 继续遵守 Catalog 的 `VersionedRef<Policy>` 形状，通用 `VersionedRef` 不增加 `contentHash`。IdentityPolicy 解析返回的不可变观察记录由 Context build metadata 保存：`builderPolicyRef`、`contentHash`、`effectiveFrom`、可选 `supersededAt`。因此四个消费位置比较同一对象类型、对象 ID、版本 ID、Scope；同时比较 metadata 与当前 IdentityPolicy 解析的 contentHash 和有效期。不能用仅相同的 objectId/versionId 代替 Hash 或有效性检查。

新 `execution.build_initial_context_snapshot@1.0` 入口只接受 `zhiju.identity.policy`，不能产生 `zhiju.context.policy`、`identity.policy` 或其他任意 namespace。旧 Core v1.0 历史 fixture 的 `zhiju.context.policy` 只通过兼容读回保持可解析；它不是新的 WI-02 binding 的合法输入。旧 `execution.build_context_snapshot@1.0` 的必填字段和通用 Ref 形状不因本决定改变。

候选组装、WorkOrderValidator 和 Freeze 必须在各自消费边界重新读取并调用同一绑定校验：缺失 ref、错误 objectType/objectId/versionId/Scope、同 Key 异 Hash、metadata 与解析结果有效期不一致、尚未生效或已过期都 fail closed。校验通过只证明跨字段绑定完整，不证明 IdentityPolicy 对象存在、当前授权允许或业务 Handler 已实现；这些仍由 owning Query/Handler 和未来真实验收拥有。

### 8.7 #165 DRAFT VersionPins 与首次 Context 的 @1.1 契约同步

状态：`APPROVED DESIGN / CONTRACT IMPLEMENTED 2026-09-11 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。#165 在旧 @1.0 合法调用保持不变的前提下，新增 `create_work_order@1.1`、`get_work_order_draft@1.1` 和 `build_initial_context_snapshot@1.1`。@1.1 DRAFT 使用 `InitialWorkOrderDraft` 与不含 `projectContextContractRef` 的 `DraftVersionPins`；该完整 Context Ref 只在 CTX-1 成功提交后进入 Frozen WorkOrder Contract。

候选 Frozen Contract 的顶层 `contextSnapshotRef` 与嵌套 `versionPins.projectContextContractRef` 必须逐字段完全相等，比较 canonical object type、objectId、snapshotId、Scope 中 enterpriseId/projectId 的有无和值，以及 contentHash 的 algorithm/digest/canonicalizationVersion。缺失、错误 Hash/Scope、Draft stale 或输入改变都必须 fail closed；不创建部分成功 Context/Contract。此次交付范围是 Schema、Envelope/Registry、兼容元数据、生成类型、fixtures 和纯契约校验。Context Handler、migration、真实 PostgreSQL 业务链、Provider/Feishu/Runtime 与人工业务验收仍为 `NOT RUN`。

## 9. WI-03 事务序列与竞态裁决

```text
TaskExecution create_run (Run + ACTIVE Claim + lease/fencing)
  -> IntegrationGateway request_runtime_dispatch (Attempt committed)
  -> controlled Driver invocation outside transaction
  -> IG acknowledgement observation + SUCCEEDED + Outbox committed
  -> execution.start_run (exact Binding Query + lease + CAS)
  -> execution.submit_agent_result (immutable Result + final submission reservation)
  -> execution.record_run_result (Run -> RESULT_RECORDED)
  -> execution.validate_agent_result (five immutable validations in one bundle Aggregate)
  -> execution.accept_agent_result (independent Acceptance Aggregate)
  -> execution.finalize_run_from_acceptance (Run terminal + release Claim + Outbox)
  -> owning WorkOrder/Task evaluation commands in separate transactions
```

受控 Driver 必须有可重复脚本输入与真实调用记录；`synthetic` 的 Provider/Model/Adapter namespace 明示合成身份，拒绝伪装成实际 Provider。只有调用发生并收到该 Driver 的 acknowledgement，IG 才能写 synthetic Raw Receipt/SUCCEEDED；fixture 不能直接插入成功 Attempt。UNKNOWN dispatch 不允许再次调用同键，须读回/调和原 Attempt；本阶段无法确认时等待 Run expiry，不编造 acknowledgement。

Process Manager 只在本模块读取已提交 Result/Acceptance/Run 状态并调用上述 owning Command。成功事件可唤醒处理；为覆盖崩溃和 REJECTED/QUARANTINED 无 Accepted Event 的情形，周期扫描未关联的 final reservation、RESULT_RECORDED Run 及对应 Acceptance，恢复固定步骤。扫描不直接写业务表。每次调用的稳定键为 `processType:sourceFactId:sourceFactHash:step`；Process 进度与源事件 Inbox 在其自己的技术 Aggregate 事务更新。崩溃在目标提交、进度更新之前时重放同一 Command Receipt。不是新增通用 Workflow Engine，也不要求给每步新增公开 Event。

| 相遇操作 | 串行化点与结果 |
|---|---|
| 两个 create_run | WorkOrder 维度 ACTIVE Claim 条件唯一 + `(workOrderId,attemptNumber)` 唯一；仅一个成功，失败事务无孤立 Run |
| 两个不同 final result | Result 提交锁同一 Run 行后 claim；唯一 Run FINAL reservation；相同 id/hash 重放，其他 identity/hash 隔离 |
| cancel vs record_run_result | 两命令锁/CAS 同一 Run。cancel 先到则 CANCELLING，Result 后续仅隔离；record 先到则 RESULT_RECORDED，cancel 拒绝，无事后改写 Acceptance |
| submit 后、record 前崩溃 | Result 已持久化不等于可执行输出；恢复扫描调用 record，期间若 cancel/expiry 胜出则隔离，不进入 Completion |
| validate/accept vs expiry | RESULT_RECORDED 也受 lease/deadline 限制；Validator 与 finalize 都重验。expiry 先提交则不可变 terminal；旧 Acceptance 可审计但不赋予业务资格 |
| finalize vs expiry | Run 行锁 + expected version 决胜；一个 terminal transition 与 Claim release 原子提交，另一个不得改变结论 |
| lease 到期但 Claim 仍 ACTIVE | 新 Run 不得绕过旧 Claim；先调用 expire_run 终结旧 Run并把 Claim 标记 EXPIRED/RELEASED，再创建新 Claim。新 fencing 严格更大 |
| final BLOCKED_INPUT | 合法 Acceptance 可使 Run SUCCEEDED（执行边界）；WorkOrder WAITING_INPUT；授权答案解决后新 Context/Run，不 Resume |

WorkOrder 的 WAITING_INPUT、RETRY_PENDING、COMPLETION_PENDING 等推进是另一个 Aggregate 的动作；本轮提出 reconcile_work_order_execution 与 reconcile_task_execution 两个明确 owning 命令，状态规则见 Spec 003 §11.5。它们重新读取已提交事实，不能通过 caller desiredStatus或Run Command顺带写另一Root。设计批准不代表实现完成；所需能力交付前不宣称完整业务链READY。

## 10. WI-04 判断事实、完成与安全边界

### 10.1 判断顺序与时效

TaskReadiness 从精确 Task definition、依赖 Task 权威状态、输入事实与 IdentityPolicy 决定导出；WorkOrderValidation 从精确 Draft/Context/candidate Contract 导出；Result Validation Bundle 从精确 Run/Attempt/Result 和 owning output Query 导出。所有判断自有不可变 payload/hash、issuer、subject refs、Policy/Evaluator version、检查结果和期限，消费者重新解析事实，不接受调用者提交的结论。

跨模块 mutable 当前状态不能靠复制 Hash 或一次查询获得分布式原子性。每次高风险消费立即重新查询 owning 权威，保存观测版本/watermark，再在本模块事务内 CAS 所有本地输入。跨模块查询后发生撤销时，通过 owning 已提交失效事件触发重评估/Impact，历史 Evaluation 不重写。本设计只承诺记录的观测时点一致性，不承诺与多个数据库 Aggregate 同一瞬时提交；若业务要求后一语义，必须另立授权 reservation 协议，不扩展本轮事务。

### 10.2 完成与输出资格

Completion 不只看 `AgentResultAccepted` Event：必须读回 exact Result/Acceptance，确认 Run 已由匹配 Acceptance finalize 为 SUCCEEDED，且没有 terminal race/隔离/当前失效事实。`businessOutputRefs` 是查询入口；不得把事件内附带的 Ref 当作已核验输出。Proposal处理与其他业务副作用同样须等Run由匹配Acceptance终结为SUCCEEDED；单独Accepted事件不能越过取消/expiry裁决。Run 完成、WorkOrder 完成、Task 完成与 DeliveryItem 完成分别建立不可变 Evaluation/transition。

七类 WorkOrder Criterion 保持 Core §4.9 的集合，首版机械输入绑定和 Task v2 criteria 见 Spec 003。所有 required Criterion 必须 SATISFIED；缺事实、未支持 Policy、被撤销的质量/批准、未解决阻塞均不能完成。可解释的 UNSATISFIED/UNSUPPORTED/STALE 与当前错误码分别保存，不把错误当 false 后继续成功。

首版 InformationRequest 使用已确认 CustomerMaterial 作为答案采纳目标。Human 先通过 EP owning Command 提议并确认材料，再调用 resolve_information_request，TE 经 EP Receipt attestation 比对 accepted Answer 中的精确 proposed/confirmed material 关联、Source refs、Scope、Human/Decision 与实际 committed result。相同 correlationId 不是关联证明。此边界不支持凭文本直接确认 Fact、批准或豁免 Policy；扩展类型需各 owning Command/Query 的明确映射。

### 10.3 TaskCompleted 到 EnterpriseProject

TE 在 Task CAS 到 COMPLETED 的同一事务保存 Task Evaluation、Audit、Reference Edge 与现有 `execution.TaskCompleted@1.0` Outbox；字段保持 `taskRef/evaluationRef/satisfiedFactRefs/completedAt`。Producer `task-execution`、Scope、Aggregate/version、payload integrity、correlation/causation 均来自 owning 事务。只含正式非空 satisfiedFactRefs；空输出不能伪造占位 Ref 通过当前 EP Consumer。

Dispatcher 将已提交 Event Envelope 与真实 outbox 游标映射为 `sourceModule=task_execution`、分区、单调 sequence、observedAt 的 SourceWatermark，调用既有 EP `DeliveryCompletionEventInput` 边界。sequence 由持久化派发游标分配/复用，不从调用者时间戳或随机测试数生成。EP 的 Inbox/Completion Fact/Process 在 EP 事务落库；至少一次重复返回原结果，同 eventId 异 Hash 隔离，低 watermark 保留历史但不覆盖较新事实，错 Producer/Scope 拒绝。EP 继续按自己的冻结 DeliveryItem Criteria 判断，TaskCompleted 单独不保证交付完成，不同步回查 TE 形成依赖环。

### 10.4 本轮完成度与后续设计输入

本轮明确上述设计操作的输入/结果/授权、单 Aggregate 写边界、竞态裁决、持久化约束和失败用例；不声称全部 IM-06 业务已可实现。WorkOrder/Task状态协调与依赖Task当前有效性已纳入本轮候选。首版 Source Slice限定EP owning来源，答案限定CustomerMaterial，Task质量条件限定精确Revision RAS/ABS；多Owner Slice、其他AnswerSpec/Receipt和其他Task Criterion是明确延后范围，不能在实现时通过默认放行补齐。跨模块失效以既有Gate/Approval/Release事件触发重评估，并以消费时owning当前Query作兜底；因未订阅而延迟的Projection不能授权新的动作。

执行次序：先独立实现 #151；TD-01–04 已批准，接下来交付必要 API/Schema 与 owning 持久化契约，再评估首批 Task/WorkOrder/Context 实现。Run/Result/答案/Completion 的后续 Issue 需基于前批实际能力再次 readiness 检查。#152–#154 当前交付为已批准技术设计；独立审查记录与业务验收分别保留，不因本次批准自动关闭。


## 11. 剩余设计增量 TD-05–07

状态：`PROPOSED / REVIEW PENDING / IMPLEMENTATION NOT STARTED`。本节属于 T2，不追溯扩张 TD-01–04 的批准。限定于 IM-06 已有 Query/Projection、Usage/Provenance 与受控退出链；不新增其他 Source Owner、答案类型、Task Criterion 或真实 Runtime 控制命令。

| 决策 | Spec Delta | 主要代价与验收 |
|---|---|---|
| TD-05 查询与看板快照 | Spec 003 §12：权威查询逐次授权；现有 TaskBoard v1 使用不可变 generation、绑定 cursor、共享 QueryResult freshness；内部快照独立保存精确 DeliveryItem 筛选 Ref 并纳入 Hash，公开行仍为 TaskBoardItem；TE owning Snapshot Export 为内部只读 Port，Projection 不跨 Schema 读表 | 全项目导出成本与旧 generation 保留空间；暂停、并发翻页、重建失败、授权撤销与提交乱序必须有反例 |
| TD-06 Usage 与安全来源 | Spec 003 §13：首版不产生 RuntimeUsageRecord；区分 Agent 自报、缺失及合成执行；Provenance 的可用性与可信度分别表达 | Result 声明不能冒充 Driver Observation；新解释 profile 仅限返回值中既有 CanonicalJson，不收紧旧请求 Schema |
| TD-07 受控退出与恢复 | Spec 003 §14 / Module Test：正常正式输出、BLOCKED_INPUT 后 Human 答案两条真实 owning 链；每步失败可重放、四层完成独立 | 需要前序业务能力和持久化故障注入；现有全仓 PASS 不等于这些链已运行 |

TD-05 选择从 owning 模块一致性快照重建，不假设所有字段变化都有完整公共事件。Domain Event 只唤醒刷新；提交事务中的内部 dirty marker 保证无公开 Event 的字段变化也可发现。首版不依赖字段级 Event Delta 重建；每次发布完整不可变 generation。它牺牲刷新成本换取可重复快照与严格分页，后续增量优化须证明同等一致性。Snapshot Export 不成为公共 Catalog 操作，也不允许任意 SQL、跨模块事务或调用者提供可信 Board 行。

TD-06 不增加 `record_run_usage`，受控 Driver 固定可辨认的合成 Adapter/Harness/Provider/Model 身份；不存在的 Provider 计量与会话不能填造。查询仍可解释 Run/Attempt/Result 来源，Usage 缺失不阻断已满足的业务 Completion，也不免除冻结 Budget/Policy 的执行前检查。

TD-07 的可执行 Fixture 使用生产 Application Command/Query、同一授权与事务路径、真实 PostgreSQL 和实际被调用的确定性 Driver。只有外部 Runtime 被受控 Driver 替换；不能替代 Policy、Receipt、Validation、Acceptance、Completion 或 TE→EP Producer。人工审核 Fixture 输出与真正独立人工业务验收分开记录。

实施顺序仍从 #151 开始；TD-01–04 的 Schema/API 和 owning 存储先行。TD-05–07 批准与独立审查后，在所需基础能力实际交付时再生成 Query/Projection、受控退出的 NOW + READY 实现 Issue。现有 #152–#154 不扩写成包含所有后续实现的总任务。本次设计不会将 IM-06 或其退出 Gate 标为完成。
