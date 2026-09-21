# IM-06 Human-operated 执行边界与设计提案

日期：2026-09-09
状态：`TD-01–04 APPROVED 2026-09-08 / TD-01 EXPIRY ADDENDUM APPROVED 2026-09-09 / #165 DRAFT VERSION PINS @1.1 CONTRACT IMPLEMENTED 2026-09-11 / #176 POLICY/EVALUATOR RESOLUTION DESIGN APPROVED 2026-09-12 DESIGN VERIFIED / TD-05–07 PROPOSED / #202 TASK DRAFT CREATION REFERENCE AND PERSISTENCE BOUNDARY APPROVED 2026-09-15 DESIGN VERIFIED / #210 WORKORDER DRAFT AND PRINCIPAL-KIND PLATFORM DELTA APPROVED 2026-09-17, DESIGN VERIFIED / HANDLER IMPLEMENTATION NOT STARTED / #214 TD-01 INITIAL CONTEXT BUILD AND EXACT SNAPSHOT-READ DESIGN DELTA APPROVED 2026-09-18 (d0d060f, PR #215) AND IMPLEMENTED 2026-09-19 BY ISSUE #216, LOCAL/PERSISTENCE EVIDENCE COMPLETE, VERIFY FULL PASS 2026-09-19; PR #217 CORRECTIONS IMPLEMENTED 2026-09-20 (TE-217-D-001–004 AND TE-214-D REGRESSION PASS), NEW VERIFY FULL PASS 2026-09-20; ROUND-4 FINDINGS IMPLEMENTED 2026-09-21, NEW VERIFY FULL PASS 2026-09-21; RE-REVIEW/HUMAN TECHNICAL REVIEW PENDING`。用户已于 2026-09-08 批准 #151–#154 已呈现的方向与约束，并授权技术设计。用户随后明确“批准你的设计，提交更新”，批准本修订 TD-01–04 的具体 API、字段、持久化与首版范围。§1–10 为已批准的未来技术设计，其中 §8.4 的期限补充于 2026-09-09 单独获批；#165 已把其中的 DRAFT/initial Context 兼容契约同步到 Schema、Registry、生成类型和 fixtures，但不代表业务 Handler 或业务持久化链已经存在；§11 是剩余设计提案，尚未批准，不宣称实现存在。§12 是 [#176](https://github.com/qzhike/zhiju-business-core/issues/176) 的 Policy/Evaluator 解析与授权依赖设计，已于 2026-09-12 获批、尚未实现。#202 的 Task DRAFT 创建引用与持久化边界已于 2026-09-15 通过独立审查并获用户明确设计批准，精确批准记录见 §15.8；这不表示 Handler 或业务持久化已实现；#210 的 WorkOrder DRAFT 创建、精确 Draft 读取与 platform transaction-context PrincipalKind 增量已在 revision `67e5df57db637953009ba21b2193114aec401ce6` 完成独立审查，并于 2026-09-17 获用户明确设计批准；其 Contract、migration 与 Handler 仍未注册、未实现。推进顺序见 [roadmap](../product/roadmap.md)。

## 1. 分类与既有边界

IM-06 按 T2 规划：涉及安全绑定、不可变 Contract、数据库并发 Claim、跨 Aggregate 恢复和 Completion。既有设计仍以 [HL-Spec §5](../high-level-docs/HL-Spec.md)、[架构 §20.7](../high-level-docs/02-zhiju-core-architecture.md)、[Core Contracts §3–5](../high-level-docs/03-core-contracts.md)、[Domain §18–22](../high-level-docs/04-domain-model-v0.1.md)、[Module Spec/Test 003](../module-specs/Module-Spec-003-TaskExecution.md) 为准。

目标是由 Human 发起并审阅、由 owning Service 执行的可重复 Core 流程。Human 不直接拼写可信 AgentResult，不通过布尔值完成 Task/WorkOrder；确定性测试 Driver 的结果只提供合成技术证据。真实 CLI、Provider、飞书收答与 Workspace UI 分别保留在既有后续里程碑。

TaskExecution 当前业务入口仍为 `SKELETON`；已有 43 个版本化字段级操作（20 Command、8 Query、11 Event 的已审核基线，其中三个为 #165 的 @1.1 兼容版本，#175 另加 `execution.create_task@2.0`）与 V3000 技术表，不等于业务 Handler、业务表或完成闭环已经存在。EnterpriseProject 的 TaskCompleted 消费能力可作为后续衔接点，不能以其合成事件测试替代真实 TaskExecution Producer。

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

TD-01–04 已于 2026-09-08 获用户明确批准，包含新操作、Task v2 与首版类型限制。完整已批准字段、授权与错误在 [Module Spec 003 技术设计附录](../module-specs/Module-Spec-003-TaskExecution.md#11-im-06-技术设计)；IG/EP 的字段分别由 [Spec 007](../module-specs/Module-Spec-007-IntegrationGateway.md#im-06-runtime-binding-query-设计)、[Spec 002](../module-specs/Module-Spec-002-EnterpriseProject.md#im-06-source-slice-与-resolution-receipt-设计) 拥有。#165 已将 DRAFT/initial Context 的三个 @1.1 兼容操作纳入当前 Catalog，#175 已纳入 `execution.create_task@2.0`（当前 209 项），并保持历史 Compatibility Baseline 不变；其余仅设计操作仍不自动进入 Registry。

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

### 8.8 #167 Initial Context Result 与 canonical SnapshotRef

状态：`APPROVED 2026-09-10 / RESULT SCHEMA AND REGISTRY IMPLEMENTED 2026-09-12 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。用户已批准 operation-specific CommandResult data 扩展方案：`execution.build_initial_context_snapshot@1.0` 与 `@1.1` 通过已注册 Result Schema 返回 `data.contextSnapshotRef`，不再只依赖 `resultReferences` 元数据描述返回引用。新入口固定使用 canonical `zhiju.execution.context_snapshot`；exact Snapshot Ref 必须来自已提交事实，并由 authoritative `get_context_snapshot` Query 重新校验。本决定不批准 Context Handler、migration、公开 HTTP、Provider/Feishu/Runtime 或业务验收。

Result Schema 的 `data.contextSnapshotRef` 是完整 `SnapshotRef`：`kind` 固定 `SNAPSHOT`，`objectType` 固定 `zhiju.execution.context_snapshot`，`objectId`/`snapshotId` 为 UuidV7，`scope` 必须是 **Project Scope**（`enterpriseId` 与 `projectId` 均必填），`contentHash` 必须为 `SHA-256`、64 位小写十六进制、`canonicalizationVersion=1`。CommandResult 的 `targetRef` 必须是同一 canonical objectType 且 `objectId` 与返回 Ref 相等，Scope 也必须逐字段一致；`targetRef.objectId` 一致不能替代 canonical objectType 比较，双方同时缺少 projectId 也不能判为一致。该 Project Scope 收紧只作用于新增的 Initial Context Result Ref Schema 与 canonical 绑定：通用 `ScopeRef` 与既有 `get_context_snapshot@1.0` 的接受集合（含历史 enterprise-only Scope 读回）不变。

`zhiju.project.context_snapshot` 只是 Core v1.0 历史读回身份，不能由 WI-02 新入口产生，也不能与 canonical 名称仅按 `objectId` 互换：跨字段校验比较 canonical objectType、objectId、Scope，读取绑定的比较还包含 `snapshotId` 与完整 `contentHash` 三元组。authoritative `get_context_snapshot@1.0` 的输入 Ref 与结果 Ref 必须逐字段相等，避免返回与请求不同的 Snapshot；该 Query 的既有 Schema 与接受集合不变，因此历史 namespace 的读回仍然合法。旧 `execution.build_context_snapshot@1.0` 的必填 `workOrderContractRef` 语义、返回形状与「无 operation-specific Result Schema」状态保持不变。

Schema 通过、`targetRef`/Query 绑定通过都只证明契约形状与跨字段一致，不证明 Snapshot 已提交、当前授权有效或 Handler 已实现；存在性、幂等与同键异 Hash 冲突仍由 owning Handler 与持久化验收拥有，保持 `NOT RUN`。

### 8.9 #168 Initial Context 期限上界与 effective expiresAt

状态：`APPROVED 2026-09-10 / SCHEMA AND PURE CONTRACT BINDING IMPLEMENTED 2026-09-12 / HANDLER AND BUSINESS PERSISTENCE NOT IMPLEMENTED`。用户已批准本 Issue 的 Initial Context expiry 设计：`InitialContextBuildRequest.expiresAt` 是 Context 有效期上界，不改写 WorkOrder Root 的创建期限；显式期限不得晚于 WorkOrder、Source Slice 或 Builder Policy 的有限上界；缺省时取有限上界最小值；effective expiresAt 进入 Snapshot、build metadata 和 Hash，并在后续消费前以受信服务端时间重验。此批准只补齐期限组合与失败语义，不批准期限 Handler、migration、Provider/Feishu/Runtime 或业务验收。

请求有期限时，该期限就是本次 Context 的 effective expiresAt，并且必须不晚于每一个有限上界——WorkOrder Root/Draft Snapshot 期限、每个被消费 Source Slice 的 `validUntil`、当前 Builder Policy 解析出的有限终止时刻。超过任一上界即拒绝并保留被违反的上界路径，不静默截断到最小值，也不以「取小」掩盖非法输入。请求无期限时，effective expiresAt 是这些有限上界的最小值；没有任何有限上界时保持缺省。缺省只表示本次构建没有组合出有限期限，不代表无限授权：版本化 Policy/Decision/Context/Capability 与 Run lease/deadline 检查继续独立生效。

effective expiresAt 写入本次已提交 ProjectContext Snapshot 的可选 `expiresAt`（Core v1.0 已有字段，本体与必填集合不变，存在性和值进入完整 payload Hash），并写入 INITIAL `context_snapshot_build` metadata 的 `requestExpiresAt`/`effectiveExpiresAt` 观察。请求期限原样记录，不得省略、改写或以签发元数据为由替换；effective 值不得被截断、放宽或事后重写。Builder 发布前、Validator 产出可用判断前、Freeze 提交前以及后续 Run 创建/启动前，都读取已提交事实并以受信服务端当前时间重新判断，不能使用 caller 时间或事务开始时间绕过。

期限冲突、构建前已过期、长事务跨过期限、同键幂等重放、Context 已提交但 Validation/Freeze 失败等情形按 [Spec 003 §11.2.5.4](../module-specs/Module-Spec-003-TaskExecution.md#11254-首次-context-的期限上界与-effective-expiresat) 的失败矩阵裁决。已提交 Snapshot/判断/Receipt 保留为不可变历史，重放返回原结果但不重新获得执行资格；不再新增到期强杀，也不把其他 Root 的状态改成 EXPIRED。冻结后 Retry 重新组合一份新的 Context 期限，原 Contract、Context-1 和 Run-1 的 Ref/Hash/期限保持不变。WorkOrder 自身期限继续按 §8.4 原样继承，本决定不改变其存在性与值。

本次交付范围是 Schema、Envelope/Registry、生成类型、fixtures 与纯契约跨字段校验，对应 TE-WI02-D-016。跨字段校验通过只证明组合规则和镜像一致，不证明 Snapshot 已提交、当前授权有效或 Handler 已实现；这些仍由 owning Handler 与持久化验收拥有，保持 `NOT RUN`。

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

### 9.1 受控 Driver 的可审阅输入与证据

本节细化已批准 TD-02 的确定性 Driver 和验收方式，不新增公开 Contract、控制入口或 Runtime 默认 Policy。输入/输出的唯一详细映射在 [Runtime 专项受控 Driver profile](../runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md#受控-driver-输入输出与调度)。它复用已提交的 RuntimeDispatchRequest、Attempt invocationBinding、既有 AgentResultContract 和 RawReceiptSubmission；Fixture 只决定何时返回合成 ack/Result，不决定授权、Acceptance 或业务完成。

Human 经既有 queue/cancel 等入口提交授权 Intent；Dispatcher 使用自己的 ActorSnapshot/AuthorizationDecision 调用 create_run 和 request_runtime_dispatch。Ingestion/Validator/LeaseMonitor/Process 各自按 Spec 003 的 Purpose 调用 owning 入口，不能把 Human 凭据转交 Driver，也不能以 Driver 的合成身份代替 Core Service 授权。正常链、取消先到、record 先到、expiry 先到均使用独立合法基线；每个负例只改变被检验的字段或提交次序，避免用不存在对象、错误 Scope 等无关缺陷掩盖预期拒绝。

设计验收按 [TE WI-03 矩阵](../module-tests/Module-Test-003-TaskExecution.md#wi-03-控制入口与拒绝反例)和 [IG WI-03 矩阵](../module-tests/Module-Test-007-IntegrationGateway.md#wi-03-driver-证据来源细化)逐项检查输入、预期状态、禁止效果及 owning 读回。运行时测试保留 NOT RUN；固定 Fixture 设计不等于 Fixture 实现或执行通过。

### 9.2 控制入口与 IM-DG-006 适用性

以下对账消费 §7 已批准的 TD-02，不再提交或追认 Runtime 专项六项提案。表中“已注册”仅指公开 Catalog 有该操作，不证明业务 Handler 可调用；“设计已批准”仍需后续 Schema/Registry/Handler/持久化交付。公共 Envelope、精确 Ref、Purpose、Actor、结果与错误约束由 [Spec 003 §3/§11](../module-specs/Module-Spec-003-TaskExecution.md#11-im-06-技术设计)及 [Spec 007](../module-specs/Module-Spec-007-IntegrationGateway.md#im-06-runtime-binding-query-设计)拥有。

| 入口（均 @1.0） | Owner / 本项用途与批准依据 | IM-DG-006 适用性及尚缺入口 |
|---|---|---|
| execution.create_run / execution.start_run | TE，既有已注册 Command；建立 Run/Claim，按 exact Attempt ack 启动 | 不新增六项控制能力；租约必须来自显式 leasePolicyRef，不选择 Runtime 默认租约 |
| integration.request_runtime_dispatch | IG，既有已注册 Command；先持久化 Attempt 再调用合成 Driver | 使用已批准 Human-operated 限定，不批准真实 CLI/Provider dispatch 或 fallback Policy |
| execution.get_run_dispatch_binding | TE，TD-02 设计已批准；IG 获取完整 Capability/lease/fencing/Scope | 新增只读 Query，不修改 lease、默认 Policy 或 Runtime 控制状态；不依赖六项提案 |
| integration.get_runtime_attempt_binding | IG，TD-02 设计已批准；TE 校验原 request、不可变 binding 和真实 ack | 新增只读 Query，保留旧 get_runtime_attempt 结果；不依赖六项提案 |
| execution.submit_agent_result | TE，既有已注册 Command；Ingestion 录入完整 Result 与 final reservation | 不以 progress/usage/heartbeat 代替 final Result；late payload 可到达接收边界，但只能隔离 |
| execution.record_run_result | TE，TD-02 设计已批准；由已提交唯一 Result 推进 RESULT_RECORDED | Core 已存事实到 Run 状态的协调；不是 Runtime progress 写入，不依赖六项提案 |
| execution.validate_agent_result / execution.accept_agent_result | TE，前者为 TD-03 批准设计，后者既有已注册；#154 拥有判断内容 | 消费 #154 接口，不把 Driver 断言当验证；其实现可用性是后续实现依赖，不是批准六项命令 |
| execution.finalize_run_from_acceptance | TE，TD-02 设计已批准；从 exact Acceptance 终结 Run 并原子释放 Claim | Core owning 状态协调，不代替 cancel acknowledgement 或 Runtime terminal 自报 |
| execution.expire_run | TE，TD-02 设计已批准；服务端时间重验已存 lease/deadline，终结并释放 Claim | 不延长租约、不新增 timeout 默认值；受控测试等待已选 Policy 的有限期限，不批准 IM-DG-006 默认 Policy |
| execution.request_run_cancel | TE，既有已注册 Command；Human/已授权 Service 请求 CANCELLING | 只覆盖取消 Intent 与竞态；没有获批的 Core Cancel ACK 入口，CANCELLED 路径继续阻断 |
| execution.reconcile_work_order_execution | TE，TD-02 设计已批准；独立 WorkOrder 事务重读已提交事实 | 不控制 Runtime，不依赖六项提案；不顺带写 Run/Task |
| execution.reconcile_task_execution | TE，TD-02 设计已批准；独立 Task 事务协调，不能设置 COMPLETED | 不控制 Runtime，不依赖六项提案；Completion 仍由 #154 owning Evaluator 判断 |

IM-DG-006 拥有“六个 Runtime Command 与 Runtime 默认 Policy”。本项仅解释已经批准的受控范围为何不要求先关闭整个 Gate；**Gate 仍为 USER DECISION REQUIRED**。不预设租约时长、heartbeat 间隔、cancel grace、默认 budget 或跨 Provider 路由参数。测试必须明确绑定有效的已有版本化 Policy 和有限期限；Policy 未提供/不支持时拒绝，不为通过测试提供隐式默认值。

无合法正向路径的步骤逐项保留：`record_run_heartbeat` 不可用于续租；`record_runtime_progress` 不可用于推进 Run；`record_run_suspension` / `resume_suspended_run` 不可用于同 Run 恢复；`record_run_usage` 不可制造独立权威 Usage；`acknowledge_run_cancellation` 不可产生 CANCELLED。以上六个 @1.0 名称仍只在 Runtime §15.1 提案中。既有 integration.request_runtime_cancel / request_runtime_resume 只是 Adapter 控制请求，不能补足缺失的 TE 控制入口；本 Fixture 不调用它们来伪造正向完成。真实 Runtime fallback 仍属于后续 IM-DG-006/IM-08，final BLOCKED_INPUT 只走新 Context/新 Run Retry。

兼容与代价：TD-02 采用增量 @1.0 Command/Query，不改旧 payload/result 或历史 Compatibility Baseline；公开名字、Purpose、Ref 注册及新表需后续独立交付，物理约束见 PostgreSQL §33。拒绝以私有跨模块写入代替 API、以旧 AdapterAttemptView 推断完整绑定、或把六项提案全部纳入 Catalog。#153 关闭只解除设计缺口，不免除这些实现依赖和各次调用的授权。

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

## 12. #176 首批 Policy/Evaluator 解析与授权依赖

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / HANDLER, AUTHORIZATION AND SCOPED PERSISTENCE IMPLEMENTED 2026-09-13 (#186) / DOWNSTREAM CONSUMERS NOT RUN`；[Issue #179](https://github.com/qzhike/zhiju-business-core/issues/179) 已交付构建期 profile registry `im06-static-v1`、四个 profile 的固定 canonical typed ref 与 closed 字段 Schema、生成检查，以及各 owning 模块的纯注册性/closed 字段校验（见 §12.9）；[Issue #189](https://github.com/qzhike/zhiju-business-core/issues/189) 已交付两个首版 Evaluator profile 选择器的构建期静态注册与纯解析（见 §12.9）；[Issue #183](https://github.com/qzhike/zhiju-business-core/issues/183) 已交付 `record_policy_version`/`resolve_policy` 的静态 Schema、Registry、Purpose 元数据、生成类型、fixture 与共享 PayloadGuard；Handler、migration、PolicyVersion 事实存在性、真实授权、生命周期和业务链仍 `NOT IMPLEMENTED / NOT RUN`（2026-09-12 按 [PR #178](https://github.com/qzhike/zhiju-business-core/pull/178) 两轮独立设计审查修订：企业级隔离归属、profile registry 注册路径、取代关系基数与并发裁决，以及后继唯一性只作用于真实取代边）。两个操作的 PayloadGuard 有限参数不在本次批准范围内，由 [Issue #181](https://github.com/qzhike/zhiju-business-core/issues/181) 单独呈现，并于 2026-09-13 完成独立技术审查与人类批准（见 §12.4 第 3 条与 §12.9）。本节回应 [Issue #176](https://github.com/qzhike/zhiju-business-core/issues/176)，只收敛首批 Task/WorkOrder/Context 业务链真实需要的 Policy/Evaluator 解析与授权前置。TD-01–04 及其补充（§7–§10）继续有效且被本节引用为已批准边界；TD-05–07（§11）保持 `PROPOSED`，不被本节追认。**本节 P-176-1 至 P-176-5 已于 2026-09-12 获人类批准**。批准对应 PR #178 的 `5975da3f52f83cf5b9c24dfe5e046f5d4996521b` 所呈现设计；用户在独立技术复审确认 R1–R4 已修复后明确表示“我批准新增的实质决定”。已批准内容可作为后续 readiness 复核的设计前提，业务实现仍须有明确 Scope 与实际依赖；本次批准不使 Schema、Registry、Handler 或 migration 自动成为已交付事实。既有 `zhiju.identity.policy`、`execution.*`、`project.*` 的已批准字段与历史 Compatibility Baseline 不因本节改变。

### 12.1 对账结论：既有事实与真实缺口

以下保留设计提出时的事实与缺口；当前静态交付状态见 §12.9。

| 位置 | 当前已提交事实（可核验） | 对账结论 |
|---|---|---|
| Policy 版本身份 | Catalog 注册 `zhiju.identity.policy`（Owner identity-policy，VERSIONED）；#165/#166 已把 `InitialContextBuildRequest.builderPolicyRef`、ProjectContext `projection.builderPolicyRef`、Context build metadata 与冻结 WorkOrder `versionPins.contextBuilderPolicyRef` 绑定到同一 canonical ref；`exactObjectType(versionedReference,'zhiju.identity.policy')` 已在契约 Schema 中固定该 objectType | 身份字符串与四个消费位置已批准；**版本键（objectId/versionId/Scope）与已提交 PolicySnapshot 之间的对应关系没有权威定义** |
| 唯一 Policy 读取 Port | `identity.get_policy_snapshot@1.0` 输入 `SnapshotRef<PolicySnapshot>`，精确 id+hash、禁止 latest；实现额外要求 `objectType=identity.policy_snapshot` 且 Scope 为空 | 输入本身要求 `contentHash`；**调用者无法从 `VersionedRef<Policy>` 得到该 Ref**。本项不改变该 Query 的 Schema、接受集合与历史读回语义 |
| PolicySnapshot 写入 | `identity.record_policy_snapshot@1.0` 载荷为 `policySetVersion/policySchemaRefs/policyDocument/effectiveFrom/sourceRefs`；行不可变（`REVOKE UPDATE`）、`policy_set_version` 唯一 | **载荷与物理列都不记录 Policy 的 objectId/versionId/Scope**，因此不存在"按 Policy 版本反查已提交事实"的数据；本项不改写该表及其 RLS |
| 解析能力 | 全仓不存在 policy resolver（无 `resolvePolicy`/`PolicyResolver` 实现或声明） | **不存在 owning 解析入口**，Core §4 与 #166 所述的 "IdentityPolicy exact snapshot 解析" 无对应 Port |
| 纯绑定 helper | `validateContextBuilderPolicyBinding`（#166）与 `validateInitialContextExpiryBinding`（#168）接受调用者传入的 `resolvedPolicy` / `builderPolicy.supersededAt` 后做跨字段比较 | 二者只验证跨字段一致；**不是解析器**，不提供存在性、授权或生命周期证明，不能作为 `resolvedPolicy` 的权威来源 |
| Evaluator | `VersionedRef<Evaluator>` 未固定 objectType；首版 profile 规则在 Spec 003 §11.6 已批准 | 版本注册机制与支持边界未固定，调用者可传任意 objectType/版本 |
| Purpose | capture/read/Builder 三个 Purpose 已注册；ReadinessBuilder/Validator 仅有设计值；仓库无 Purpose 枚举注册表，`authorizationPurpose` 由两个 registry 声明并交叉校验 | 消费者授权路径未固定；任何未注册 Purpose 不得通过 Service 通配放行 |

**缺口是真实的且不能靠既有机制填补**：`VersionedRef<Policy>` 无法定位任何已提交事实，而 #166 要求消费端在四个位置逐次重验 "IdentityPolicy 当前解析" 的 `contentHash`/`effectiveFrom`/`supersededAt`。以下四点既排除"不新增写入路径"，也排除"复用既有 Platform 事实"：

1. 解析结果必须携带精确 `contentHash`，而通用 `VersionedRef` 明确不携带 Hash（#166 已批准边界）；调用者无法自行构造 `SnapshotRef`。
2. 已提交 `policy_snapshot` 事实没有任何 Policy 版本身份列或 mirror，无法按 `(objectId, versionId, Scope)` 反查。
3. 任何"给动态 View 加自算 Hash"、"由 `objectId` 猜 `snapshotId`"或以 `sourceRefs` 冒充版本身份的转换都属于 §8 已禁止的拼造 Ref / 改 objectType 路线。
4. **既有 Platform 事实不能承载企业级版本**：`identity_policy.policy_snapshot` 的 `policy_snapshot_select`/`policy_snapshot_insert` 只校验 `platform_security.context_is_valid()`，不含 enterprise/project 条件；把带 Enterprise/Project Scope 的版本绑定或 `policyDocument` 写入该表，会让任何有效 Context 经直接 SQL（无需猜到 Ref）读到其他企业的策略正文。仅在新 resolver 里校验 Scope 或隐藏 Ref 不能替代授权，新版本事实必须落在带 Scope 与 FORCE RLS 的新表中（§12.2）。

同时记录两处既有命名分歧，本节只**记录**、不静默统一：

- PolicySnapshot 的 objectType 拼写不一致：IdentityPolicy 运行时接受 `identity.policy_snapshot`，而 Core fixture/测试中出现 `zhiju.identity.policy_snapshot`。本节的 WI-02 新链不再依赖任一 PolicySnapshot 拼写（版本事实使用新的 canonical `zhiju.identity.policy_version`），既有读取路径的接受集合与读回语义不变；统一命名仍属 owning 模块的独立兼容决定，不得在解析实现中静默改写。
- Purpose 字符串分歧：`execution.create_task@1.0` 为 `task.execution.create_task`、`@2.0` 为 `execution.task.create`（共享 API 已记录为待 IdentityPolicy 实际承载 Purpose 时收敛），`create_work_order` 的 Registry 值与 Spec 003 §3 设计值也不一致。这是 §12 的历史调查结论；创建 Purpose 已于 2026-09-14 按 §13 的 P-190-1 方案 A 获批收敛，逐版本保留已发布值，真实接线仍待实现。

### 12.2 P-176-1 Policy 版本事实、解析 Port 与隔离归属（提案）

已批准事实（Core §4、#166/#167/#168、§8.6）要求消费端能取得"某个 exact Policy 版本的已提交观察"。提案给出该观察的唯一 owning 来源：一个新增的**本模块 scoped 版本事实**、一个新增写入操作与一个新增只读 Query。**不改变** `zhiju.identity.policy` objectType、通用 `VersionedRef` 形状、既有 Platform `policy_snapshot` 表与其 RLS、`get_policy_snapshot@1.0` 的接受集合与任何历史 baseline。

**为什么不复用 Platform Snapshot（隔离归属）**：既有 `identity_policy.policy_snapshot` 是 Platform 事实，其 `policy_snapshot_select`/`policy_snapshot_insert` 只校验 `context_is_valid()`，不含 enterprise/project 条件；把版本绑定与 `policyDocument` 写进该表等于让任何有效 Context 直接读到其他企业的策略正文，新增 resolver 的 Scope 校验无法封闭该路径。既有 exact Snapshot 入口又固定要求空 Scope 与 id+hash，若新行落在该表就必须为它单独分支授权。因此新版本事实落在**带 Enterprise/Project Scope 与 FORCE RLS 的模块新表**上，读取走有 Purpose 的授权 Query，RLS 只作纵深防御。

| 概念 | 固定取值 | 约束 |
|---|---|---|
| Policy 版本键 | `VersionedRef<Policy>`：`kind=VERSIONED`、`objectType=zhiju.identity.policy`、`objectId`/`versionId` 为 UuidV7、`scope.enterpriseId` 必填（`projectId` 可选） | 首版不接受空 Scope/Platform Scope 的 Policy 版本；该收紧只作用于新增入口与 WI-02 新链，不改变既有 Schema 与 helper 的接受集合 |
| 已提交事实 | PolicyVersion 快照：`SnapshotRef<PolicyVersion>`，canonical `objectType=zhiju.identity.policy_version`，`objectId==snapshotId`，Scope 与版本键 Scope 逐字段相等（`enterpriseId` 必填、`projectId` 按版本键有无），`contentHash` = 该事实 canonical payload 的 SHA-256/规范化版本 1 | 事实只存在于新的 scoped 表；**不写入 Platform `policy_snapshot`**，也不得被伪装成 Platform Snapshot；既有 AuthorizationDecision 的 `policySnapshotRef` 仍指向 Platform Snapshot，语义不变 |
| 版本 → 事实 | 一次提交在**同一 IdentityPolicy 事务**内写入版本事实、`(objectType, objectId, versionId, enterpriseId, project_id)` 唯一版本绑定、Receipt/Audit/Outbox | 一个版本键只能绑定一个已提交事实；不存在"第二次绑定覆盖"路径 |
| 生命周期 | `effectiveFrom` 必填；`supersededAt` 由**唯一后继版本**的取代边派生（§12.3） | 调用者不能直接指定某版本的 `supersededAt`；不引入默认 TTL |
| 与旧入口的关系 | 旧表、旧 RLS、`get_policy_snapshot@1.0` 与其授权链完全不变；新入口不产出 Platform Snapshot | 新事实不在旧表中，因此**不存在"旧 exact Snapshot 入口读取新行"的情形**；也不得把新版本包装成 Platform Snapshot 绕过授权 |

**Spec Delta（#183 已静态注册，Handler 未实现）**

| 设计操作 | Target / 模式 | Payload | Result.data / Purpose |
|---|---|---|---|
| `identity.record_policy_version@1.0` | PolicyVersion / CREATE（省略 `expectedAggregateVersion`） | `policyRef: VersionedRef<Policy>; policySetVersion: NonEmptyString; policySchemaRefs: NonEmptySet<TypedReference>; policyDocument: CanonicalJson; effectiveFrom: UtcInstant; supersedesRef?: VersionedRef<Policy>` | `{policyVersionRef: SnapshotRef<PolicyVersion>}`；Purpose `identity.policy.record_policy_version`（新增） |
| `identity.resolve_policy@1.0` | A（AUTHORITATIVE） | `policyRef: VersionedRef<Policy>`（objectType 固定） | `PolicyVersionResolutionView`；Purpose `identity.policy.resolve_policy`（新增） |

```text
PolicyVersionResolutionView
├── policyRef: VersionedRef<Policy>                    // 与输入逐字段相等的已核验回显
├── policyVersionRef: SnapshotRef<PolicyVersion>       // canonical zhiju.identity.policy_version；objectId==snapshotId
├── policySetVersion: NonEmptyString
├── policySchemaRefs: TypedReference[]
├── policyDocument: CanonicalJson                      // 与 contentHash 同一 canonical payload
├── contentHash: ContentHash                           // == policyVersionRef.contentHash
├── scopeRef: ScopeRef                                 // 与 policyRef.scope 逐字段相等
├── effectiveFrom: UtcInstant
├── supersededAt?: UtcInstant
├── useStatus: Closed<USABLE | NOT_YET_EFFECTIVE | SUPERSEDED | REVOKED>
└── checkedAt: UtcInstant                              // 受信服务端当前时间，不接受 caller 时间
```

1. 新入口与 `identity.record_policy_snapshot@1.0` 并存：@1.0 的 payload、Platform 行、RLS、授权链与读回语义完全不变，也不获得版本绑定或解析能力；本项**不发布新的 Major**、不重写历史 Compatibility Baseline 与 fixture。
2. `policyRef` 的 objectType/kind/Scope 形状先于任何写入拒绝非法值（沿用 `REFERENCE_INVALID`；objectType 非 canonical 时不得改写）；Scope 为空或缺 `enterpriseId` 一律拒绝。
3. `policySchemaRefs` 必须是构建期 profile Registry 中已注册的 canonical typed refs（§12.4），逐项按 objectType/objectId/versionId/Scope 相等比较；未注册 schema 仍为 `IDENTITY_POLICY_VERSION_UNKNOWN`。
4. 同一版本键的第二次提交返回稳定 `IDENTITY_POLICY_VERSION_ALREADY_BOUND`（唯一约束裁决后转换为模块错误，不穿透 `23505`）；相同幂等键且相同 payload 走既有 `DUPLICATE` 重放，不覆盖、不新增成功 Outbox。
5. `supersedesRef` 的合法性、单位基数与并发裁决见 §12.3：非法前驱为 `IDENTITY_POLICY_SUPERSEDE_INVALID`，前驱已有后继为 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`；被取代版本的 `supersededAt` 由唯一取代边派生，**不 UPDATE 任何不可变行**。
6. `resolve_policy` 只做 exact 解析：不解析 latest/current、不回退同 objectId 的其他版本、不做写操作；结果内联返回当次已提交的 `policyDocument`（与 `contentHash` 同一 canonical payload），因此 WI-02 新链不再依赖 `get_policy_snapshot@1.0` 读取正文。
7. 解析成功不是授权：Scope 授权、profile 字段校验与业务条件由各消费边界独立执行；同一 `policyRef` 在事实未变时返回同一 `policyVersionRef`/`contentHash`，被取代后返回同一已提交事实加上最新 `supersededAt`/`useStatus`，不产生第二份事实。

**Catalog、Ref 与 Purpose 影响（静态注册已交付 #183；运行时仍待实现）**：Catalog 209 → 211（净增 2 条目），IdentityPolicy 公开条目 20 → 22（8 Command / 7 Query / 7 Event）；新增 objectType `zhiju.identity.policy_version`（OBJECT（CREATE target）/SNAPSHOT；Enterprise/Project Scope），复用已注册的 `zhiju.identity.policy` 作为版本键；Purpose `identity.policy.resolve_policy` 与 `identity.policy.record_policy_version` 已按共享 API §9.2 在 public-api 与 compatibility metadata 一致登记（禁止 Service 通配，运行期授权映射仍待 Handler）；两个新操作已按 #157 的规则注册共享有限额构建期 PayloadGuard 技术 Policy `identity.policy_version@1.0`（数值取 #181 已批准值，见 Spec 001 §13.3.1；不得另行替换或用无限额 Policy 占位）；`dataClassification` 取 `INTERNAL`，若将来某个 profile 允许承载客户材料，必须重新分类并单独决定；历史 200 项 Compatibility Baseline 不重写。

**未采用方案与代价**：(a) 扩展 Platform `policy_snapshot`（新增 Major 写入 `policyRef` 与版本键镜像）——该表的 RLS 无 enterprise/project 条件，会形成跨企业可读的企业策略正文，必须同时改写旧表 RLS 与旧 exact Snapshot 入口的授权规则，代价高于新增 scoped 事实；(b) 只新增企业级绑定表、正文仍留在 Platform 表——正文仍平台可读，不满足隔离要求；(c) 把版本键塞进既有 `sourceRefs` 或给动态 View 自算 Hash——语义冒充且无唯一性；(d) 让 `get_policy_snapshot@1.0` 接受 `VersionedRef` 或改写其 objectType——§8 与 #167 已明确禁止。代价是新增一个本模块 scoped 表与两个操作，实现时需同步两个 registry、生成类型、fixture、RLS 与 owning 迁移。

### 12.3 P-176-2 取代关系的基数、并发裁决与消费时有效性（提案）

**取代关系是线性的，一个版本至多有一个后继。** 一条取代边为 `前驱版本 ←─ 后继版本`，由后继的 `supersedesRef` 声明：

1. 前驱与后继必须同 objectType/objectId/Scope；前驱必须已提交，且其 `effectiveFrom` 严格早于后继的 `effectiveFrom`；自引用、倒序、跨 Scope、不存在均为 `IDENTITY_POLICY_SUPERSEDE_INVALID`。
2. **一个版本至多有一个后继**：唯一性只建在**真实取代边**上——部分唯一索引 `(supersedes_object_id, supersedes_version_id, enterprise_id, project_id) NULLS NOT DISTINCT WHERE supersedes 两列均非空`，由数据库裁决并发。`supersedesRef` 可选，无前驱的初始版本两列均为 NULL；若把后继唯一性无条件施加于全部行，同一 Scope 下不同 Policy 的首版会折叠为同一个键 `(NULL, NULL, E, [P])` 而互相冲突，因此必须是部分索引；同时唯一对象必须 `NULLS NOT DISTINCT`，否则 Enterprise 行的 `projectId IS NULL` 会让比较失效。第二个竞争提交（不同幂等键）稳定返回 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED`，不覆盖首个后继，也不改变被取代版本的派生截止时间。
3. 被取代版本的 `supersededAt` **等于其唯一后继的 `effectiveFrom`**，只由已提交取代边派生：不写入、不更新被取代的不可变行，任何重放、重试或后续提交都不得重新延长它。
4. 首版不支持分叉（同一前驱的多个后继）、不允许取代边跨 policy identity 或指向 Platform Snapshot；连锁（A←B←C）逐条独立校验，每条边各自满足 1–2。
5. 首版**不强制"同一 identity 同时只有一个可用版本"**：未声明取代的版本保持无有限终止，与其并存的更新版本不会自动使其失效。该性质在本版是显式的、必须可见；只有 `now >= supersededAt` 才由消费端拒绝。若将来要求"至多一个可用版本"，须另行决定。

| 观察 | 唯一来源 | 消费规则 |
|---|---|---|
| `effectiveFrom` | 提交时由受信服务端校验的已提交字段 | 未来时刻可提交并返回 `NOT_YET_EFFECTIVE`；`now < effectiveFrom` 时消费端 fail closed（#166 `POLICY_NOT_EFFECTIVE`），不得提前生效 |
| `supersededAt` | 唯一后继取代边的派生观察（等于后继 `effectiveFrom`） | `now >= supersededAt` 即不可用于新消费（#166 `POLICY_EXPIRED`）；历史事实保留可读 |
| `REVOKED` | **首版无版本级撤销入口** | 任何来源报告 `REVOKED` 时一律 fail closed；授权侧（Role/Capability/AuthorizationDecision）撤销独立生效，不受本项影响 |

6. 首版**不引入任何默认期限**：Policy 版本没有默认 TTL，新登记入口的 `effectiveFrom` 必填，缺失拒绝；`supersededAt` 缺席表示"尚无有限终止"，不表示无限授权；其他版本化 Policy/Decision/Context/Capability/Run lease 检查继续独立生效（§8.4、§8.9 已批准语义）。
7. 可表达的生命周期只有"尚未生效"与"被唯一后继取代"。因此**版本级撤销在首版不可表达**；不得把"无法撤销"当作"永久有效"，也不得用 `supersededAt` 冒充安全撤销。
8. 跨消费边界失效：Context/判断/Contract 一旦提交即保持不可变历史；Policy 版本在其后被取代或授权被撤销时，**新消费**（Freeze、queue、create_run、start_run、Validator 产出可用判断）必须重新解析并拒绝，历史成功 Receipt 的重放不重新赋予执行资格（与 §11.2.5.2、§11.2.5.4 一致）。
9. `checkedAt` 与所有到期比较使用受信服务端当前时间；长事务必须在提交点重验，不用事务开始时间绕过。

### 12.4 P-176-3 首版 Policy/Evaluator profile、版本注册与支持边界（提案）

每个消费者只解释**已注册 profile** 的 closed 规则字段；未知字段、未知 profile 版本、未知 Evaluator 版本一律 fail closed，不回落默认值、不静默忽略。规则语义由各 owning 模块解释，IdentityPolicy 只提供不可变事实、Hash、生命周期与解析（不解释他方规则）。

| 消费者 | Policy 绑定位置 | 首版 policy profile 与规则字段 | Evaluator 注册与支持边界 |
|---|---|---|---|
| EP Source Slice capture | `capturePolicyRef`（已注册 `zhiju.identity.policy`） | `ep.context_source_slice_capture.policy@1.0`（EP owning）：`maxSliceValiditySeconds: PositiveInt`（必填，无默认）、`allowedPurposeCodes: NonEmptySet<NamespaceCode>`（必填）。`validUntil = min(capturedAt + maxSliceValiditySeconds, authorizationDecision.expiresAt)`，不接受 caller 期限 | 不需要独立 Evaluator；裁剪与 kind 闭集仍由 EP 既有 Source Query 规则拥有 |
| Initial Context Builder | `builderPolicyRef`（#165/#166 已固定） | `execution.context_builder.policy@1.0`（TE owning）：`allowedProjectionTypes: NonEmptySet<NamespaceCode>`（必填，且必须落在 Core §3.4 已注册投影类型内）。**不新增 Context TTL 字段**：Builder Policy 的有限上界仍是其 `supersededAt`（#168 已批准组合） | 不需要独立 Evaluator；裁剪规则由 Draft `targetScope`/`inputRefs.permittedUse`/`contentAccessMode` 与既有 §11.2.1 拥有 |
| TaskReadinessBuilder | `build_task_readiness@1.0.policyRef`（设计） | `execution.task_readiness.policy@1.0`（TE owning）：`maxReadinessValiditySeconds: PositiveInt`（必填）。`validUntil = min(evaluatedAt + T, authorizationDecision.expiresAt)`；依赖集合、输入与阻塞条件仍由 Spec 003 §11.3/§11.6 拥有 | Evaluator profile `te.task_readiness.evaluator@1.0`；未支持的 profile/版本返回 `EXECUTION_CRITERION_UNSUPPORTED`，不产生可用判断 |
| WorkOrderValidator | `validate_work_order_draft@1.0.policyRef`（设计） | `execution.work_order_validation.policy@1.0`（TE owning）：`maxValidationValiditySeconds: PositiveInt`（必填）、可选 `mandatoryCriterionTypes: Set<CriterionType>`（取值限 Core §4.9 七类，未注册值即不支持）。`validUntil` 同时不得晚于 §11.2.4 的 WorkOrder 期限 | Evaluator profile `te.work_order_validation.evaluator@1.0`，按 Spec 003 §11.6 的绑定字符串 profile 解释七类 Criterion；其他类型 `UNSUPPORTED` |

1. **policy profile 由消费模块拥有**：`policyDocument` 的 profile 字段校验发生在消费模块（EP/TE）内，不在 IdentityPolicy；IdentityPolicy 只校验 `policySchemaRefs` 是否为构建期 Registry 的已注册 canonical 条目，并保证事实不可变、Hash 与生命周期正确。消费模块还必须校验 `policySchemaRefs` 含其支持的 profile schema 引用。
2. **Evaluator 版本注册**：首版 Evaluator 是确定性实现代码，其版本以**构建期静态注册表**登记（沿用 `POLICY_SCHEMA_REGISTRY`/`payload-guard-policies.v1.json` 的既有机制：静态条目、固定标识、无数据库行、无虚构 Hash），并以 `VersionedRef<Evaluator>` 暴露；objectType 由 owning 模块注册（提案 `zhiju.execution.evaluator_profile`），Scope 为 Platform。Evaluator ref 是**profile 选择器**，不携带 `contentHash`、不参与 Policy 版本的解析与生命周期，也不得被当作已提交业务事实。
3. **写入前的资源边界**：两个 PolicyVersion 操作使用共享的有限技术 Policy `identity.policy_version@1.0`；参数、计量对象、执行位置与写入/读回关系见 [Spec 001 §13.3.1/§13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1331-payloadguard-技术-policy参数与适用边界181-提案)（#181 已批准 2026-09-13，#183 已静态注册）。该 Guard 只限制资源规模，不解释 profile 规则字段、不改变 `validUntil` 推导；它声明仍不支持的内容不作为放行理由。同一提案还要求 **`maxResultBytes` 以"`maxEnvelopeBytes` + 4096 余量"的形式声明**（266240），并附带 **SD-181-1**：这两个操作的 `UtcInstant` 字段（`effectiveFrom`/`supersededAt`/`checkedAt`）限定为至多毫秒精度（≤ 24 code point）。前者覆盖结果侧拥有请求侧没有的完整 `SnapshotRef` 所造成的增量（`R_only` 实测上界 820；当前合法绑定在等值预算对照中也可读回，4096 仍是已批准的固定余量）；后者覆盖结果侧两个派生时刻的长度（放宽后 `R_only` 约 33540）。该约束**只作用于这两个新增操作**，不改变共享 `UtcInstant` 定义、既有操作接受集合或 `compareUtcInstants` 的变长小数比较，也不改变 `supersededAt = 唯一后继 effectiveFrom` 的相等语义；它与参数已一并获批并由 #183 静态注册，Handler 与业务读取仍未实现。
4. **支持边界**：首版只支持 §12.4 表内列出的 profile 与 Evaluator 版本。capability/Policy 未提供、版本未知、字段未注册、语义未支持都必须在创建判断前拒绝（TE 侧 `EXECUTION_CRITERION_UNSUPPORTED`，EP 侧由 owning 模块 §6 的错误码拥有），不得"跳过判据"通过链路。
5. 本节的 profile 字段是**首版最小闭合集合**；扩展任何字段或类型都需要新的 profile 版本与独立决定，不得就地扩展既有 profile 版本。

**profile schema 身份、Registry 注册与 owning 校验边界**

| registry key | Owner | 首版 profile 规则字段 | 消费位置 |
|---|---|---|---|
| `ep.context_source_slice_capture.policy@1.0` | enterprise-project | `maxSliceValiditySeconds`、`allowedPurposeCodes` | EP Source Slice capture |
| `execution.context_builder.policy@1.0` | task-execution | `allowedProjectionTypes` | TE Initial Context Builder |
| `execution.task_readiness.policy@1.0` | task-execution | `maxReadinessValiditySeconds` | TE TaskReadinessBuilder |
| `execution.work_order_validation.policy@1.0` | task-execution | `maxValidationValiditySeconds`、可选 `mandatoryCriterionTypes` | TE WorkOrderValidator |

1. **schema 身份与 typed reference**：每个 profile 是一个**构建期注册的 policy schema**，公开身份为 `VersionedRef`（`objectType=identity.contract_schema`、固定 UuidV7 `objectId`/`versionId`、`scope={}`），与既有 `POLICY_SCHEMA_TYPED_REFS` 的既有三项同形；registry key 与 typed ref 一一对应，运行期不解析 latest，不创建数据库行或虚构 Hash。
2. **注册扩展方式**：新增 registry 版本（提案 `im06-static-v1`）= 既有 `im02-static-v1` 三项 ∪ 上表四项，作为构建期制品与生成检查覆盖（提案置于 `contracts/registry/`，由 IdentityPolicy 与 owning 模块共同加载，避免任一模块内置他方语义）。`identity.record_policy_snapshot@1.0` 保持历史 `im02-static-v1` 接受集合不变；`identity.record_policy_version@1.0` 只接受新版本集合，且 `policySchemaRefs` 必须与上表的 canonical typed ref 逐字段相等。**本项修正先前"不新增 Registry 内容"的表述**：新增的是 registry 版本与四条 profile 条目，既有条目与旧命令的接受集合都不放宽、不收窄。
3. **owning 校验边界**：IdentityPolicy 只判断"是否为已注册的 canonical schema 条目"；EP/TE 判断"文档是否符合本模块 profile 的 closed 字段与语义、所需 profile key 是否在集合内"。任一方未通过都在创建可用判断或可执行冻结前拒绝。
4. **完整正向链（合法基线）**：① 授权后经 `identity.record_policy_version@1.0` 提交 `policyRef` + `policySchemaRefs=[该 profile 的 canonical ref]` + 符合 profile 的 `policyDocument` + `effectiveFrom`，同事务写入版本事实/绑定/Receipt/Audit/Outbox；② 消费方经 `identity.resolve_policy@1.0` 取回观察与文档；③ 消费方校验 profile 字段与所需 key，据此推导 Slice `validUntil` 或判断 `validUntil` 上界并写入自己的 metadata；④ 每次高风险消费重新解析并重跑绑定校验。该链不需要 `get_policy_snapshot@1.0`，也不需要改动旧 registry 版本。
5. **首版不注册通用规则表达式**：profile 未列出的字段、未知 key、未知版本一律拒绝；扩展或新增 profile 必须发布新的 registry 版本并单独决定。

### 12.5 P-176-4 Purpose 与授权验证路径（提案）

| 消费者 / 操作 | Purpose | 注册状态与授权路径 |
|---|---|---|
| `project.capture_context_source_slice@1.0` | `project.context_source.capture` | 已注册；调用方持自己的 ActorSnapshot/AuthorizationDecision；解析 `capturePolicyRef` 时另需 `identity.policy.resolve_policy` 的独立 Decision |
| `project.get_context_source_slice@1.0` | `project.context_source.read` | 已注册；Slice 的 capture policy 失效由 EP 在读取时重验并反映为 `EXPIRED`/`REVOKED` |
| `execution.build_initial_context_snapshot@1.0` / `@1.1` | `execution.context.build.initial` | 已注册；Builder 自己解析 `builderPolicyRef`，不消费 capture/build 之外的他人授权 |
| `execution.build_task_readiness@1.0`（设计） | `execution.task.readiness.build` | 未注册；实现前必须注册到版本化 capability/policy |
| `execution.validate_work_order_draft@1.0`（设计） | `execution.work_order.draft.validate` | 未注册；同上 |
| `identity.record_policy_version@1.0`（提案） | `identity.policy.record_policy_version` | #183 已在两个 registry 注册 Purpose 元数据，真实授权映射仍待实现；写入者（授权 Human 或受约束 Service）持自己的 Decision，不得与旧 `identity.policy.record_policy_snapshot` 混用同一条目 |
| `identity.resolve_policy@1.0`（提案） | `identity.policy.resolve_policy` | #183 已在两个 registry 注册 Purpose 元数据；版本化 capability/policy 的真实授权路径仍待实现 |

两个操作的 Purpose 字符串本身不受 #181 的参数提案影响；#181 只固定二者共享的 PayloadGuard 技术条目与参数（见 §12.4 第 3 条），不注册 Purpose、不改变本节任何行的授权路径。

1. **不使用 Service 通配放行**：Purpose 必须按 owning Spec 注册为精确字符串；`*`/前缀通配/未注册 Purpose 一律拒绝（既有测试已覆盖通配拒绝）。
2. **Human Intent 与 Service 自身授权分别保留**：Human 经既有 owning Command（`create_work_order`、Task CREATE、答案提交等）保留自己的 ActorSnapshot/AuthorizationDecision；Service（ContextBuilder、ReadinessBuilder、WorkOrderValidator、EP capture）使用各自的 Decision，不能以 Human 凭据或 Driver 身份代理。
3. **producer 的授权不转让给 consumer**：capture 的 Decision 不授权 build/freeze；Builder 的 Decision 不授权 Validator/Freeze/Run；ReadinessBuilder 的 Decision 不授权 `mark_task_ready`。每次消费在自己的边界重新授权并重新解析（§12.6）。
4. 解析本身是受授权读取：`resolve_policy` 必须校验请求 `policyRef.scope` 落在调用者当前授权 Scope 内，`DENY` 与 Scope 不符按 WI-09 既有规则写同事务安全 Audit，不泄露跨 Scope 对象是否存在。

### 12.6 P-176-5 消费时重验、统一外部错误与内部审计边界（提案）

消费端可用 `resolvedPolicy` 的唯一合法来源是 `identity.resolve_policy@1.0` 的当次返回；把 caller 自报、`objectId/versionId` 推导、fixture 值或历史 Receipt 当作解析结果的输入一律拒绝。

| 情形 | 统一外部结果 | 内部原因与禁止效果 |
|---|---|---|
| objectType/kind 非 canonical、缺字段、latest/占位值 | `REFERENCE_INVALID` / 绑定校验 `POLICY_OBJECT_TYPE_INVALID` | 不把非 canonical 名称改写为 canonical；新入口不得生成 legacy/任意 namespace |
| 版本键无对应已提交版本事实 | `IDENTITY_POLICY_VERSION_UNKNOWN`（统一不可用） | Audit 区分 unknown-identity / unknown-version / not-bound；不泄露其他 Scope 是否存在该版本 |
| Scope 不在调用者授权集合、或与绑定 Scope 不等 | 统一不可用（同上） | Audit 记录 scope-mismatch；不得返回跨 Scope 的 Hash、版本或存在性 |
| 同一版本键第二次绑定 | `IDENTITY_POLICY_VERSION_ALREADY_BOUND` | 不覆盖、不返回原结果、不新增成功 Outbox；原绑定与 Hash 不变 |
| 取代边非法（自引用、倒序、跨 identity/Scope、前驱不存在） | `IDENTITY_POLICY_SUPERSEDE_INVALID` | 不产生取代边、不写版本事实，不改动任何前驱 |
| 前驱已有唯一后继后的第二个竞争提交 | `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED` | 不覆盖首个后继、不改写前驱的派生 `supersededAt`、不新增第二条取代边 |
| 同 Key 异 Hash（metadata/Draft 与当次解析不等） | 绑定校验 `POLICY_CONTENT_HASH_MISMATCH` | 不采用 caller Hash，不覆盖已提交 metadata，不签发候选 Contract |
| 尚未生效 / 已过期或被取代 | 解析成功 + `useStatus=NOT_YET_EFFECTIVE`/`SUPERSEDED`；消费端 `POLICY_NOT_EFFECTIVE`/`POLICY_EXPIRED` | fail closed；历史保留，重放不重新授权 |
| 生命周期观察与 metadata 不一致（`effectiveFrom`/`supersededAt`） | 绑定校验 `POLICY_VALIDITY_MISMATCH`；期限组合冲突 `EXPIRY_UPPER_BOUND_EXCEEDED` | 不发布部分成功 Snapshot/判断；不静默截断到最小值 |
| 版本级撤销（首版不可表达）/ 消费时发现曾被撤销 | 一律不可用（不得作为有效 Policy 放行） | 不得把不可撤销当永久有效；授权侧撤销另行生效 |
| 伪造解析结果：caller 自报 Hash/有效期、复用他人解析、用历史 Receipt 冒充当前有效 | 上述绑定校验错误或统一不可用 | 纯绑定 helper 不得替代解析；不接受"Ref 存在即 valid" |
| 消费时已跨过 Policy 的 `supersededAt`、Decision 期限或 Context 期限 | `POLICY_EXPIRED` / `EXECUTION_JUDGMENT_STALE` / `AGGREGATE_STATE_NOT_ALLOWED`（按 Spec 003 §11.2.4/§11.2.5.4 归属） | 新消费拒绝，已提交历史保留；`now >= bound` 即不可用 |
| 用另一 Enterprise/Project 的有效 Context 直接 SQL 读取版本事实或正文，或以旧 exact Snapshot 入口读取新事实 | 数据库 RLS 返回 `42501`/零行；授权 Query 返回统一不可用 | RLS 是纵深防御、不替代授权：新事实只存在于带 Scope 的 FORCE RLS 表；旧入口不服务新事实；不得靠隐藏 Ref 代替授权 |
| IdentityPolicy 存储/依赖暂时不可用 | `DEPENDENCY_UNAVAILABLE` | fail closed；不得当作空内容、默认 Policy 或"无 Policy 限制"继续 |
| 消费端 profile/Evaluator 版本不支持 | TE `EXECUTION_CRITERION_UNSUPPORTED`；EP 使用 owning 模块 §6 错误码（提案 `PROJECT_CAPTURE_POLICY_UNSUPPORTED`） | 不产生可用判断/可执行冻结；不忽略未识别字段 |

1. **统一不可用**（`IDENTITY_POLICY_VERSION_UNKNOWN`）覆盖"不存在/未绑定/错 Scope"，其内部分类只进受权限控制的 Audit；不同 Scope 的外观不可区分。
2. **重验位置固定**：candidate 组装、Validator 产出判断、Freeze 提交、Context 构建、Run 创建/启动各自在提交点重新解析并重跑同一绑定校验（#166/#168 的纯 helper 保持不变，输入必须来自当次解析）。
3. EP Source Slice 在提交事务内保存 capture policy 的解析观察（`contentHash`/`effectiveFrom`/`supersededAt`）作为附属不可变 metadata，读取时以受信时间重验；不改变 Slice 公开 payload 字段。
4. 所有未实现路径保持 `NOT RUN`：纯 helper、Schema 与静态 Registry 通过都不证明对象存在、当前授权有效或 Handler 已实现。

### 12.7 合法基线与拒绝反例

合法基线（可审阅、无需新增业务判断）：IdentityPolicy 经 `identity.record_policy_version@1.0` 在带 Scope 的事务中提交版本事实、唯一版本绑定与取代边（同一事务 Receipt/Audit/Outbox）→ 各消费者用 `identity.resolve_policy@1.0` 取回精确观察与正文 → 消费方在 candidate/context/judgment 中逐项保存并重验 → 与 §8.1 的 Draft→Slice→Context→Validation→Freeze 链对接。反例逐项对应 §12.2–§12.6 的失败矩阵：未知 identity/version、错 Scope、未生效、已取代、同 Key 异 Hash、版本/后继重绑定、caller 伪造观察、跨消费边界失效、profile/Evaluator 不支持、依赖不可用。**每项反例只改变被检验的维度**，其余输入合法。

| 反例 | 预期结果 | 禁止效果 |
|---|---|---|
| 用 `VersionedRef` 直接构造 `SnapshotRef` 或给 `get_project_context_source` 结果加 Hash | 统一不可用/`REFERENCE_INVALID` | 不生成可读回的伪造 Snapshot；解析只走 owning Port |
| `policyRef` 为 legacy/任意 namespace、缺 objectId/versionId、latest | `REFERENCE_INVALID`/`POLICY_OBJECT_TYPE_INVALID` | 不改写 objectType、不回退默认 Policy |
| 同一版本键第二次提交不同 `policyDocument` | `IDENTITY_POLICY_VERSION_ALREADY_BOUND` | 不覆盖首个绑定与 Hash，不产生第二个版本事实 |
| `supersedesRef` 指向不存在/跨 Scope/`effectiveFrom` 不更早的版本 | `IDENTITY_POLICY_SUPERSEDE_INVALID` | 不产生"自我取代"或倒序生命周期 |
| 顺序或双连接并发提交 B、C 两个都取代同一前驱 A（含前驱未来才生效、在两后继截止点消费的变体） | 仅第一个提交建立唯一取代边，另一个稳定 `IDENTITY_POLICY_VERSION_ALREADY_SUPERSEDED` | A 的 `supersededAt` 唯一（= 胜出后继的 `effectiveFrom`），不被第二次提交改写或延长；B/C 使用各自版本键时也不得形成分叉 |
| 同一 Scope 下两个不同 Policy 各自的首版，或同一 identity 的多个未互相取代版本（Enterprise 与 Project Scope 各覆盖） | 正向对照：全部提交成功，各自获得独立版本事实与 `useStatus` | 无前驱版本不参与后继唯一性（部分唯一索引谓词为假）；不得因 `(NULL, NULL, E, [P])` 折叠被判为重复后继 |
| 另一 Enterprise/Project 的有效 Context 直接 SQL 读版本事实/正文，或以旧 exact Snapshot 入口读取新事实 | RLS `42501`/零行；Query 统一不可用 | 不靠隐藏 Ref 代替授权；旧入口不服务新 scoped 事实，两套 RLS 分支互不放大 |
| metadata 中的 Hash/有效期与当次解析不等 | `POLICY_CONTENT_HASH_MISMATCH`/`POLICY_VALIDITY_MISMATCH` | 不进入 Validator/Freeze，不发布 Snapshot |
| 已取代/未生效的 Policy 用于新 Freeze 或 create_run | `POLICY_EXPIRED`/`POLICY_NOT_EFFECTIVE`/`EXECUTION_JUDGMENT_STALE` | 历史保留可读，但不赋予新执行资格 |
| 未注册 profile 字段、未知 Evaluator 版本、七类之外的 Criterion | `EXECUTION_CRITERION_UNSUPPORTED`（EP 用 owning 错误码） | 不"跳过判据"冻结/判断，不解释自由文本规则 |
| 依赖不可用（存储/IdentityPolicy 暂时不可查询） | `DEPENDENCY_UNAVAILABLE` | 不当作空 Policy 或无限授权继续 |

### 12.8 经 owning 入口建立输入、解析并供消费方重验的路径

1. 授权：调用方经 `identity.authorize_command@1.0` 取得自己的精确 Decision（Human Intent 与各 Service 各自持有，§12.5）。
2. 提交：经 `identity.record_policy_version@1.0` 在同一事务写入 scoped 版本事实（canonical payload/Hash）、唯一版本绑定、取代边与 Receipt/Audit/Outbox；失败不留下部分绑定，旧 `record_policy_snapshot@1.0` 路径不变。
3. 解析：消费方以 `identity.resolve_policy@1.0` 取回精确 `PolicyVersionResolutionView`（含 `policyVersionRef`、`contentHash`、生命周期与 `policyDocument`），不依赖 `get_policy_snapshot@1.0`。
4. 保存观察：消费方在自己的 owning 事务中保存产物（Context build metadata、Slice 附属 metadata、Judgment header 等）与该次观察的 `contentHash`/`effectiveFrom`/`supersededAt`。
5. 重验：每次高风险消费在自己的提交点重新解析，并用既有纯 helper（#166/#168）比较请求/投影/metadata/VersionPins 四个位置与当次观察。
6. 禁止：不直接写 IdentityPolicy 表、不共享他方 Repository、不把纯 helper 或 Schema 校验当作解析、不用历史 Receipt/fixture 值充当当前有效事实、不把 Platform `policy_snapshot` 当作 scoped Policy 版本事实、不靠隐藏 Ref 代替授权。

### 12.9 已解除的依赖与仍缺少的实际能力

**本设计解除（设计层）**：Policy 版本如何定位已提交事实；解析 Port 的输入/输出/授权/失败/重验契约；四个消费者的 profile 与支持边界；capture/read/Builder/ReadinessBuilder/Validator 的 Purpose 与授权路径；统一不可用与内部审计边界；合法基线与反例集合。

**已交付（#179，仅构建期静态注册与纯校验）**：构建期 profile schema registry 新版本 `im06-static-v1`（既有 `im02-static-v1` 三项 ∪ 四个首版 profile）、四个 profile 条目的固定 canonical typed ref 与 closed 字段 Schema、生成副本与构建漂移检查，以及各 owning 模块的纯注册性/closed 字段校验；旧 `im02-static-v1`、旧命令接受集合与 200 项历史 Compatibility Baseline 不变。该交付只证明静态注册与规则字段闭合：PolicyVersion 事实是否存在、当前授权是否有效、Handler 与业务链是否可用均未因此成立。

**已交付（#189，仅构建期静态注册与纯解析）**：构建期 Evaluator profile registry 新版本 `im06-evaluator-static-v1` 与 `zhiju.execution.evaluator_profile` 身份、两个首版选择器 `te.task_readiness.evaluator@1.0`/`te.work_order_validation.evaluator@1.0` 的固定 canonical typed ref、生成副本与构建漂移检查，以及只按全字段精确匹配的纯解析（含 TaskExecution 各自的消费者支持边界）。该交付只证明"批准的 profile 选择器可被确定性识别、其余一律不解析"：Evaluator 确定性实现、解析调用点、`validUntil` 推导、判断产出与 `EXECUTION_CRITERION_UNSUPPORTED` 映射均未因此成立，本项不新增公开 operation。

**本次设计层新解除（#181 已批准 2026-09-13，#183 已静态注册）**：两个 PolicyVersion 操作的完整请求 Envelope、`CommandResult.data` 与 `QueryResult.data` 计量对象，共享技术 Policy `identity.policy_version@1.0` 与其有限参数、执行位置与错误形状，以及"按该参数合法写入的版本必然可读回"的**定式**——结果预算以"请求预算 + 固定余量"声明（`maxResultBytes = maxEnvelopeBytes + 4096 = 266240`），证明只需结果侧增量 `R_only` 有上界（实测 820，全部由有界形状构成），**不使用请求侧最小值**，因此不受请求侧字段编码变化影响。此前“合法 Project 版本读回 262153 字节在等值预算下被拒”的反例已按 #183 事实更正撤回：当前合法绑定在正式预算与等值预算对照中均通过；固定余量与充分条件不变。该关系**同时依赖 SD-181-1**（两个操作的时刻字段至多毫秒精度）：缺少它时 `R_only` 变为约 33540，远超 4096 余量。余量与 SD-181-1 解决不同项，缺一不可。权威文本见 [Spec 001 §13.3.1/§13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1331-payloadguard-技术-policy参数与适用边界181-提案) 与 [共享 API §#181 方案](../api-contract-v0.1/API-Contract-v0.1.md#181-policyversion-payloadguard-注册方案)。本方案与 SD-181-1 已于 2026-09-13 完成独立技术审查并获人类设计验收批准（[人类批准记录](https://github.com/qzhike/zhiju-business-core/pull/182#issuecomment-5647186487)），对应设计 revision `0f596d1f74d9d306bf8a7884ca8adf1f5203d26d`；参数与 SD-181-1 已由 #183 随两个操作静态注册；Schema、Registry、生成类型与 fixture 已交付，业务能力仍未实现。

**仍缺少（实际能力，均 `NOT IMPLEMENTED / NOT RUN`）**：

- IdentityPolicy：`record_policy_version@1.0` 与 `resolve_policy@1.0` 的 Handler、真实 Purpose 授权与生命周期、scoped FORCE RLS 新表（版本事实 + 唯一版本绑定 + 取代边唯一约束与查询路径）已由 #186 交付并在真实 PostgreSQL 18.6 上验证；消费端（EP Slice 解析、TE Builder/Readiness/Validator/Freeze）仍 `NOT RUN`；
- ~~EnterpriseProject：`capture_context_source_slice`/`get_context_source_slice` Handler、Slice 表与 capture policy 解析观察、`validUntil` 推导~~ 已由 #188 交付（Handler、`V2014` Slice 表与 Policy 观察、`validUntil` 推导、exact read 与 fail-closed 语义；TE 消费仍 `NOT RUN`）；
- TaskExecution：`create_work_order@1.1`、`get_work_order_draft@1.1`、`build_initial_context_snapshot@1.0/@1.1`、`build_task_readiness@1.0`、`validate_work_order_draft@1.0`、`freeze_work_order` 的 Handler 与业务持久化；Evaluator 确定性实现；
- 真实业务 Policy 文档内容与其审批（本项不发明 Policy 内容）；
- 创建 Purpose 已由 §13 的 P-190-1 方案 A 于 2026-09-14 获批；PolicySnapshot objectType 拼写分歧（§12.1）仍未决定；TD-05–07 仍为待批准提案。

因此：本项完成只解除**设计前置**；`im06-static-v1` 静态注册与纯校验已由 #179 交付，首版 Evaluator profile 选择器的静态注册与纯解析已由 #189 交付，两个 PolicyVersion 操作与 Guard 静态契约已由 #183 交付；首个 Task/WorkOrder/Context 业务实现 Issue 仍须先确认上述实际能力可用，或在单独 Scope 内完整交付；不得据此宣布完整 IM-06 业务链 `READY`，也不得把本节其余未交付能力写成已实现事实。

## 13. #190 Task/WorkOrder 创建 Purpose 兼容性提案

状态：`T2 / DESIGN APPROVED 2026-09-14 / EXACT MAPPING AND PURE RESOLUTION IMPLEMENTED 2026-09-14（#196）/ HANDLER AUTHORIZATION NOT RUN`。本节回应 [Issue #190](https://github.com/qzhike/zhiju-business-core/issues/190)，§12.1/§12.9 保留的创建 Purpose 分歧已按 P-190-1 方案 A 获得人类批准。TD-01–04 及 P-176-1–5 不重开，TD-05–07 不被追认。本次不改可执行 Registry、业务代码、migration 或授权数据，不创建依赖实现 Issue。

### 13.1 逐版本事实与证据边界

对账 revision 为 `928b0c3cd9983c58b08714d8dc8d43166bcea828`（本地 HEAD 与读取的远端 main 一致）。下表保留批准前的设计调查事实，不沿用 Issue 创建时的旧 main；批准后 Spec §3 的两个冲突文字已按方案 A 修正，不能把表中历史差异视作当前未决状态。以下两份 JSON 路径均在 `contracts/registry/` 下；public-api 未写字段不是“无须授权”。

| operation/version | public-api 原始 authorizationPurpose | compatibility metadata | owning Spec 003 / 共享 API | 现有 fixture 与运行证据 |
|---|---|---|---|---|
| `execution.create_task@1.0` | 未显式声明 | `task.execution.create_task`，`v1.0-baseline` | §3 写 `execution.task.create`；共享 API 的 Task v2 增量已记录分歧 | `tests/fixtures/contracts/execution-create-task-command-valid.json` 及历史 compatibility positive；Schema 测试有，真实创建 Handler/授权无 |
| `execution.create_task@2.0` | `execution.task.create` | 同值，`im-06-task-v2-registration` | §3/§11.1/§11.6 与共享 API 一致 | `tests/fixtures/contracts/task-v2/create-task-v2-command-valid.json`、task-execution.schema.test.ts Task v2 正负例；真实创建 Handler/授权无 |
| `execution.create_work_order@1.0` | 未显式声明 | `task.execution.create_work_order`，`v1.0-baseline` | §3 写 `execution.work_order.create`；共享 API 保留旧契约 | `contracts/src/registry.test.ts` 的 `validTaskExecutionWorkOrderDraft` 及 task-execution.schema.test.ts `createWorkOrderCommand('1.0')`；真实创建 Handler/授权无 |
| `execution.create_work_order@1.1` | `task.execution.create_work_order` | 同值，`im-06-work-order-draft-initial-context-v1.1` | §3 与当前 Registry 一致；共享 API 描述 DraftVersionPins 兼容增量 | 同测试文件 `createWorkOrderCommand('1.1')`、注册与 DRAFT 正负例；真实创建 Handler/授权无 |

Schema fixture 中的 Actor/Decision Ref 只是字段输入，不是已存在授权证据。TaskExecution `src/index.ts` 仅导出技术 Foundation、纯 Policy/Evaluator helper 与 persistence runner，`src/business/` 没有四版本创建 Handler。IdentityPolicy `src/commands/actor-snapshot.ts` 的 `authorizeCommand` 与 `validateAuthorizationDecision` 已有通用授权与精确 type/version/Purpose/hash/Scope/认证/期限校验，但 `authorizeCommand` 当前硬性要求 `commandVersion === '1.0'`：Task v2 与 WorkOrder v1.1 连真实 Decision 签发也尚不支持。四版本映射与下游创建入口未组成；后者不重查当前 grant。`src/commands/policy-version.ts` 已有其自身操作的当前 grant 重验，是可参考的运行边界，不是 TE 授权已实现的证据。TE `persistence/command-runner.ts` 当前按 idempotency_scope/key 读取 Receipt、比较 requestPayload Hash 后可直接返回 DUPLICATE，未独立比较所存 command_type/version，也不调用业务 body；因此版本防串用和返回前当前授权检查必须在未来 owning 组成入口覆盖，不能仅放在 body 内。

静态复核方法：按 `type` 和 `version` 精确筛选四条 public-api 与 operation-compatibility-metadata 条目，比较字段是否存在及原值；对照 Spec 003 §3/§11.1/§11.6、共享 API「IM-06 Task typed definition @2.0」与上述四组 fixture/test，再检查 TE 导出和 IP 两个授权文件。`contracts/baselines/v1.0/operations.index.json`、`manifest.json` 及其 Schema/fixture 只保留历史 v1.0；不补写 v2/@1.1、不重算基线来让变更通过。复核输出与 full 结果放 Issue/PR 或本次交付会话，不另建执行报告。

### 13.2 P-190-1 推荐决定与备选

**已批准 A：逐 operation/version 保留已发布 Purpose，修正 owning 文档的旧设计命名。** 四条映射和最小 Delta 由 [Spec 003 §15](../module-specs/Module-Spec-003-TaskExecution.md#15-创建-purpose-兼容性-spec-delta190)拥有，授权边界由 [Spec 001 §14](../module-specs/Module-Spec-001-IdentityPolicy.md#14-taskexecution-创建授权190-approved)拥有。Task 两个 Major 保留不同 Purpose；WorkOrder 两个 Minor 保留相同 Purpose但逐版本授权。代价是命名不整齐与四条精确映射；收益是零已发布 Registry 值变化、无别名授权、无历史数据改写，并能清楚拒绝跨版本 Decision。新旧客户端继续发送原版本 Envelope；旧客户端无须改 payload 或了解新的别名。

| 备选 | 具体行为与兼容代价 | 本次建议 |
|---|---|---|
| B：原地统一为 Spec 风格 | 把 Task v1 改为 `execution.task.create`，WorkOrder v1/v1.1 改为 `execution.work_order.create`；旧 Decision/Purpose 与 registry metadata 不再匹配，旧 Capability 映射须重授/迁移，改写 baseline 会掩盖破坏 | 拒绝；不能以文档修复或 Minor 名义实施 |
| C：新 Major 使用统一命名 | 保留四条旧操作，另外设计新的 Task/WorkOrder Major，配独立 Purpose/Schema/映射与明确迁移窗口；旧授权不自动转入新版本 | 可未来单独提案；本次无业务字段升级需求，不新增 Catalog/客户端迁移负担 |
| D：双名/前缀兼容 | 同一版本接受两种 Purpose，或 `execution.*`/Service 通配，隐式扩展旧 grant/Decision 覆盖 | 拒绝；Purpose 是权限边界，不能通过别名绕过原始 Intent |

推荐 A 不断言历史授权已运行成功；“旧合法请求兼容”指保留原契约接受集合，并在原版本且当前资格真实有效时允许创建 DRAFT。过期、撤销、错误 Scope 或只有 Schema 合法的请求不属于必须放行的旧合法请求。历史 Receipt 与新动作资格、重放与幂等的区别由 Spec 003 §15.3 定义。

### 13.3 决定与交付边界

**批准记录：2026-09-14，用户在本任务会话明确回复“批准推荐方案A”。** 批准对象是此前提交且完成独立设计审查的 P-190-1 推荐 A，包括 Spec 003 §15 与 Spec 001 §14 的逐版本映射、Actor/Scope、当前 grant 重验及回放边界；批准前审查材料基于 HEAD `928b0c3cd9983c58b08714d8dc8d43166bcea828`，工作区 diff SHA-256 为 `8bacb8f553ca8a0950e1e244f2ac6793f1b31fe2d64ba84ee094bc0df58dec2d`。这条明确回复是批准依据，不能以此前“完成设计文档”或 Issue 创建替代。

已将 §3 的两个冲突 Purpose 文字及共享 API 待收敛说明同步为已批准规则；四条 Registry/metadata 不变。后续按实际依赖另做 NOW + READY 复核，确认精确版本化授权映射、owning Port 与真实 Handler/持久化的独立实现范围，不能凭设计任务交付自动开启实现。设计审查和实际批准证据保留在 Issue/PR 或明确用户会话中；本节仅维护提案的长期语义与批准状态，不充当审查报告。

成功标准：四版本事实可复核；推荐与备选可比较；旧请求与拒绝矩阵无权限扩大；独立设计审查无未解决阻断；人类明确决定有真实记录。修改文档后运行 `vibe verify full --json`，其通过仅代表当前仓库回归。新增创建授权运行、真实业务持久化链、外部与人工业务验收均为 `NOT RUN`，不能由静态检查或既有测试替代。

## 14. IM06-AUTH-01 Task/WorkOrder 创建授权组成补充提案

状态：`T2 / APPROVED 2026-09-15 / PORT AND MIGRATION IMPLEMENTED 2026-09-15（#200）/ TASKEXECUTION HANDLER NOT RUN`。本节是对已批准 P-190-1 的实现前缺口收敛，不重开四个 Purpose 值，不追认 TD-05–07，也不开始 TaskExecution 业务 Handler。用户于 2026-09-15 明确批准本节推荐 Delta；权威 Spec Delta 见 [Spec 001 §15](../module-specs/Module-Spec-001-IdentityPolicy.md#15-im06-auth-01-taskworkorder-创建授权组成提案)，验证矩阵见 [Module Test 001](../module-tests/Module-Test-001-IdentityPolicy.md#im06-auth-01-创建授权组成回归提案)。

### 14.1 Readiness 结论

四个 operation/version/Purpose 已可精确解析；实现 Issue 发布前确认了以下缺口：

1. 通用 `authorizeCommand` 硬性拒绝非 `1.0` 的业务 commandVersion，Task v2 与 WorkOrder v1.1 没有真实 Decision 签发路径。
2. 当前授权只用 caller 提供的 `requestedCapability` 和精确 Scope 查找 Grant，没有解释已持久的 `actions` / `resourceSelectors` / `constraints` / `maxUses`，也没有比较 Grant 与 Decision 的精确 Policy Snapshot。
3. 公开 `CommandIntent` 定义有 `targetRef`，但当前内部签发输入和 `authorization_decision` 事实未保存目标类型/ID。CREATE 请求因此可在相同 payload Hash 下替换预分配 target ID，不满足已批准的精确 Intent 绑定。
4. v1 历史 objectType 与新版 canonical objectType 不同，不能在实现中默认归一；WorkOrder 两个版本又共用 Purpose，不能只用 Purpose 判定版本覆盖。

下述最小安全 Delta 已经独立的人类设计审查并于 2026-09-15 获得明确批准，解除了上述实质语义阻断。IdentityPolicy owning 前置切片现为 `NOW + READY`；TaskExecution DRAFT Handler 仍不属于该切片。

### 14.2 推荐 Delta

新增 IdentityPolicy owning 内部 Port `TaskExecutionCreationAuthorizationPort`，分为“签发精确创建 Decision”与“提交/重放前重验当前资格”两个能力。该 Port 不是新的公开 Command/Query，不进 Catalog；现有 `identity.authorize_command@1.0` 公开 Schema、只接受 commandVersion `1.0` 的历史路径及既有 Decision 读回保持不变。内部 Port 复用同一 IdentityPolicy 事实与 Audit 边界，TaskExecution 不直读本模块 Repository。

受信组成配置按以下四个键分别提供一个既有 `capabilityCode`；值可相同，但不能由 caller 或 Envelope 指定。映射缺失、空值或非 NamespaceCode 一律 fail closed。

| operation/version | 已批准 Purpose | Grant 必须包含的精确 action | 必须匹配的 CREATE target objectType | 受信配置键 |
|---|---|---|---|---|
| `execution.create_task@1.0` | `task.execution.create_task` | `execution.task.create.v1` | `execution.task` | `taskV1` |
| `execution.create_task@2.0` | `execution.task.create` | `execution.task.create.v2` | `zhiju.execution.task` | `taskV2` |
| `execution.create_work_order@1.0` | `task.execution.create_work_order` | `execution.work_order.create.v1` | `execution.work_order` | `workOrderV1` |
| `execution.create_work_order@1.1` | `task.execution.create_work_order` | `execution.work_order.create.v1_1` | `zhiju.execution.work_order` | `workOrderV11` |

action 使用既有 `NamespaceCode` 可表示的值，不使用含 `@` 的非法字符串。它是 Grant 内的精确版本覆盖，不是新 capabilityCode。WorkOrder 两个版本共用 Purpose 时，Grant 必须在 `actions` 中分别列出两个 token 才能覆盖两版；Task v1 与 v2 同样不自动继承。

`resourceSelectors` 在该 Port 首版只解释闭集形状 `{selectorType: "CREATE_TARGET_TYPE", objectType: NamespaceCode}`。数组中每个元素都必须是该闭集形状，且至少一项与上表当前版本 objectType 全等；未知字段、通配符、前缀或别名均不解释。Project 边界由 Grant 的精确 Project Scope 与 targetRef.scope 双重绑定。为避免默认忽略尚无执行语义的限制，首版只接受 `constraints={}` 且 `maxUses` 缺省的 Grant；其他形状拒绝，不当作无限制。

Grant 必须同时满足：principal 与当前 Actor 一致，capabilityCode 等于受信配置，Scope 为当前精确 Project，状态/有效期可用，action 与 selector 覆盖当前版本/target，Grant 的 `grant_policy_snapshot_id/hash` 与签发 Decision 时使用的精确 Policy Snapshot 一致，且该 Snapshot 在受信当前时间已生效且未被取代。任一条不满足都不得签发或接受 ALLOW。

### 14.3 Decision target 绑定与历史兼容

新的受约束 Port 必须把完整 targetRef（objectType/objectId/Project Scope）纳入 AuthorizationDecision canonical payload 和内部完整性 Hash。`authorization_decision` 通过 forward-only 迁移增加可空 `target_object_type` / `target_object_id`：历史行保持 NULL 且可读，新 Port 产生的事实必须非空并与 canonical payload 镜像一致。旧 Decision 、通用 Decision 或无 target 绑定的事实不能用于新的 Task/WorkOrder 创建，但不改写其历史读回语义。

重验 Port 必须比较 Decision 的精确 id/hash、Actor/实际 Principal、认证上下文、type/version/Purpose、payload Hash、targetRef、Project Scope、ALLOW 和未过期，再以当次受信时间重读当前 covering Grant/Policy。TaskExecution 组成入口必须在幂等 Claim/读取历史 Receipt **之前**调用该 Port；撤销、到期、target 改变、版本串用或 IdentityPolicy 不可用时 fail closed，不能从旧成功 Receipt 取得新资格。

### 14.4 交付边界

本 Delta 已获批准；第一个 NOW + READY 实现切片只交付 IdentityPolicy owning Port、target 绑定事实/迁移、当前 Grant/Policy 重验与对应回归。不交付 Task/WorkOrder 业务表或 Handler，不创建/迁移 Capability Grant 或真实业务 Policy，不新增公开 API/Catalog，不改动通用 `authorize_command@1.0` 的历史接受集。该前置实现在真实 PostgreSQL 与 `full` 门禁通过后，再对 Task/WorkOrder DRAFT 创建入口做下一轮 readiness 复核。

本 Delta 批准不等于实现；migration 编号已由 [#200](https://github.com/qzhike/zhiju-business-core/issues/200) 在实现分支分配为 V1006（见 §14.5）。本 Delta 与 TD-05–07 分开批准；后者不是本前置的实现范围。

### 14.5 #200 实现事实（2026-09-15）

状态：`PORT AND MIGRATION IMPLEMENTED / TASKEXECUTION CONSUMER NOT RUN`。[Issue #200](https://github.com/qzhike/zhiju-business-core/issues/200) 已交付 IdentityPolicy owning 内部 Port `TaskExecutionCreationAuthorizationPort`（`modules/identity-policy/src/commands/task-execution-creation-authorization.ts`）：四个精确版本的 closed 映射、受信 capability 配置解析、single covering Grant 判定（精确 action、闭集 `CREATE_TARGET_TYPE` selector、空 `constraints`、无 `maxUses`、Grant Policy Snapshot 一致且当前有效）、target 绑定 Decision 签发与当前资格重验；forward-only `V1006__identity_policy_creation_decision_target.sql` 增加可空 `target_object_type` / `target_object_id` 镜像、成对约束与更新后的镜像 guard。

Port 级验收：`IP-TAUTH-001`–`008` 已在 persistence gate 的真实 PostgreSQL 上执行（含 `V1005 → 历史行 → V1006` 升级、二次 migrate no-op、owner 直写 SQL 篡改与事务回滚）；TaskExecution DRAFT Handler 消费、业务表/Receipt 链、外部与人工验收仍 `NOT RUN`。

实现选择（设计未要求 DENY Decision 行）：拒绝路径只写同事务的脱敏 `DENIED` Audit，不签发 Decision。原因是本 Port 的 Decision 必须绑定其 covering Grant 的精确 Policy Snapshot，而请求没有 covering Grant 时不存在可写入该列的 Snapshot；公开 `authorize_command@1.0` 的 DENY 行为不受影响。

## 15. Task DRAFT 创建引用与持久化边界提案（#202）

状态：`T2 / APPROVED 2026-09-15 / INDEPENDENT DESIGN REVIEW APPROVE / HUMAN DESIGN APPROVAL RECORDED / DEPENDENT HANDLER, ENTERPRISE-PROJECT PORT AND SCOPED PERSISTENCE IMPLEMENTED BY #204 2026-09-15 / TASK READY AND OTHER IM-06 BEHAVIOR NOT RUN`。本节回应 [Issue #202](https://github.com/qzhike/zhiju-business-core/issues/202)：把 `execution.create_task@1.0` / `@2.0` 剩余未决的跨模块引用、校验时机、持久化身份与事件边界收敛为可实现语义，使后续 Task DRAFT Handler Issue 不必自行发明安全或兼容语义。字段级权威在 [Spec 003 §16](../module-specs/Module-Spec-003-TaskExecution.md#16-task-draft-创建引用与持久化边界202-设计) 与 [Spec 002 §13.1](../module-specs/Module-Spec-002-EnterpriseProject.md#131-task-创建期的-projectdeliveryitem-校验-port202-提案)，验证矩阵在 [Module Test 003](../module-tests/Module-Test-003-TaskExecution.md#task-draft-创建引用与持久化边界202-approved-design)。本节不重开 TD-01–04、P-176-1–5、P-190-1、IM06-AUTH-01 或 TD-05–07，也不宣布 Task/WorkOrder 创建或 IM-06 已完成。

### 15.1 对账事实与缺口

对账 revision：`53f0715fc994a65977a355557e0f9f5043ed55e4`（本分支起点，与远端 main 一致）。

| 事实 | 证据 |
|---|---|
| 两个版本各自只有一套已发布身份：v1 目标 `execution.task`、`projectRef.objectType=project.project`；v2 目标 `zhiju.execution.task`、`projectRef.objectType=zhiju.project.project` | v1 冻结 fixture `tests/fixtures/contracts/execution-create-task-command-valid.json`；`contracts/registry/public-api.v1.json` 的 v2 `references`；#200 `TASK_EXECUTION_CREATION_BINDINGS` |
| `project.validate_object_scope@1.0` 只接受 13 个裸本地名（`Project` 等），canonical `zhiju.project.project` 与 `DeliveryItem` 均被 `PROJECT_OBJECT_SCOPE_MISMATCH` 拒绝；不存在 `@2.0` | `modules/enterprise-project/src/business/enterprise-business-handlers.ts` 的闭集映射与 Handler；Spec 002 §13 |
| v2 的 `execution.task.create` Purpose 与 CREATE 语义已交付，但 Task 业务表、Handler、Repository 均不存在 | `modules/task-execution` 仅有技术表与 runner；`migrations/task_execution/V3000` 无业务表 |
| DRAFT 阶段没有任何已注册的公开创建事件 | `public-api.v1.json` 的 `execution.*` Event 恰 11 项，含 `TaskReady`/`TaskCompleted`，无 `TaskCreated` |
| #200 的 Port 只覆盖授权，不覆盖 Project/DeliveryItem 业务范围证明；其顺序要求已固定 | 决定 §14.3、§14.5；Module Test 001 `IP-TAUTH-001`–`008` |

**缺口**：Project 身份如何在这些输入下被证明、由谁拥有该边界、哪些 TaskDefinition 引用必须在 DRAFT 被证明、创建事实与跨版本幂等如何闭合、DRAFT 是否发布公开事件。这些在本节收敛，不在实现时即兴决定。

### 15.2 P-202-1 Project/DeliveryItem 校验归属

**建议批准 A：新增 EnterpriseProject owning 内部 Port `TaskExecutionCreationProjectScopePort`。** 与 #200 的授权 Port 同构：不是公开 Command/Query、不进 Catalog、不改变任何公开接受集；Port 内部按 `commandType@commandVersion` 固定期望拼写，证明已提交 Project（`ACTIVE`）与可选 DeliveryItem 版本（未被 CANCELLED/REPLACED），只读执行、fail closed，业务拒绝收敛为 TaskExecution 的稳定码。

**未采用 B：扩展 `project.validate_object_scope@1.0` 的公开接受集。** 理由：(1) 该操作已发布并冻结于 200 项 Compatibility Baseline，接受集变更属公开行为变更，需单独批准；(2) 它的结果与错误面无法区分创建所需的身份失败，且接受 Enterprise-only 期望；(3) 让 legacy 与 canonical 拼写同时合法，会为所有消费者制造可互换别名，与逐版本精确身份要求冲突；(4) #200 已确立“新增 owning 内部 Port、不扩大公开接受集”的先例。

**未采用 C：TaskExecution 直接解析拼写并读取 EP 表。** 违反“一个 owning 模块只读写自己 Schema”、禁止跨 Schema Repository/Join 与单写方边界。

代价：EP 需要维护第二个键表（canonical/version 维度）与一处只读 Port；收益是公开接受集与历史行为零变化，且创建边界可精确拒绝而非依赖模糊匹配。若未来确有公开消费 canonical 拼写的需求，应作为独立 additive 契约提案处理，不并入本设计。

### 15.3 P-202-2 逐版本引用身份

两个版本各自只接受一套拼写，逐字符相等、大小写敏感，不做前缀补全、剥除、别名或 latest 回退：`targetRef`/`parentTaskRef`/`dependencyTaskRefs[]` 用 Task 身份（v1 `execution.task`、v2 `zhiju.execution.task`），`projectRef` 用 `project.project` / `zhiju.project.project`，`deliveryItemRef` 用 `project.delivery_item` / `zhiju.project.delivery_item`。Task 引用在两个版本的 Schema 中都是通用 `ObjectRef`，Schema 不约束 objectType，因此其逐版本身份与 `projectRef`/`deliveryItemRef` 一样必须由 owning Handler 与 EP Port 闭合；否则错误模块类型或另一版本拼写会进入 parent 查询或被原样固化为 dependency 事实。这是模块层收窄，不修改 v1/v2 Schema、fixture、Registry 元数据或历史 Baseline，也不统一两个版本的拼写。完整表与闭合规则由 [Spec 003 §16.1](../module-specs/Module-Spec-003-TaskExecution.md#161-逐版本引用身份与封闭接受集) 拥有。

### 15.4 P-202-3 DRAFT 与 READY 的校验时机

DRAFT 创建**必须**证明：`projectRef`（完整身份相等 `objectId == scope.projectId == 受信 projectId`、已提交、`ACTIVE`）、可选 `deliveryItemRef`（完整 `VersionedRef` 与行逐字段相等、未取消/未替换）、可选 `parentTaskRef`（同 Scope、非 CANCELLED、非自引用）；并对定义内其余引用只做形状与此处声明的 Scope 规则校验。**Scope 规则按引用形态闭合，并包含 tenant 包含关系**：共享 `ScopeRef` 只有 Platform `{}`、Enterprise `{enterpriseId}`、Project `{enterpriseId, projectId}` 三种合法形态。Project 锚定字段（`projectRef`/`deliveryItemRef`/`parentTaskRef`/`dependencyTaskRefs[]`）只接受与 Envelope 逐字段相等的 Project 形态；`inputRefs` 与 v2 closed shape 的 `acceptancePolicyRef`/`evaluatorRef` 必须落在 Envelope Scope 内——Platform 形态允许，Enterprise 形态要求 `enterpriseId == Envelope.enterpriseId`，Project 形态要求 `enterpriseId` 与 `projectId` 都相等，跨 Enterprise 或跨 Project 的引用在 DRAFT 直接拒绝。已批准 Evaluator selector 的 Platform Scope（`scope: {}`）与注册 v2 正例的同企业 Enterprise-scope `evaluatorRef` 都必须在 DRAFT 通过。`inputRefs` 的权威类型是 `TypedReference[]`，其中 `ExternalRef` 没有顶层 `scope`、只有可选 `tenantOrAccountRef`：携带时其 `scope` 必须落在 Envelope Scope 内，未携带时按无租户绑定的来源意图接受，但**不得**作为输入存在性、Readiness、blocker 或完成条件的事实依据——按 HL-06 §3.10 与 Domain §19.7 第 3 条，它必须先经 owning 授权 Adapter/Domain Command 形成 SourceMaterial/AnswerSubmission/Receipt 等正式对象（§11.6 `OUTPUT_REF_VALID` 同样不接受 ExternalRef/Workspace path）。创建期即可判定的 tenant 包含关系不推迟，避免把跨租户引用固化进不可变 TaskDefinitionSnapshot；引用的存在性、支持版本与当前有效性才属于 Readiness/Validation/Completion 边界。**推迟到 READY/消费边界**：依赖 Task 的存在性、环检测与当前有效性；`inputRefs` 的存在性、版本与生命周期；v2 closed shape 中 `acceptancePolicyRef`/`evaluatorRef` 的存在性、支持版本与当前有效性。理由：语法有效 Ref 不是已提交事实；Domain 第 4 条不变量与 Spec §11.6/§11.8/§11.9 已把依赖、输入与判据支持边界放在 READINESS；`initialAssignee` 不构成指派或能力签发。完整时机表由 [Spec 003 §16.3](../module-specs/Module-Spec-003-TaskExecution.md#163-draft-创建时的引用校验时机) 拥有。

### 15.5 P-202-4 创建事实、快照身份与跨版本幂等

DRAFT 创建在同一 owning 事务提交：`task` Root（`DRAFT`、`aggregate_version=1`、可空 `project_id` 之外的 Scope 镜像、可选 DeliveryItem 镜像、definition 指针）、不可变 `task_definition_snapshot`（独立 `snapshot_id`、`schema_version` 1.0/2.0、规范 payload 与 32 字节 Hash、Scope 镜像）、Receipt、Audit、以及仅指向已证明引用的 Reference Edge；**不写 Outbox**。快照 identity 独立于 CAS 版本；Root 指针必须同时绑定 id 与 hash。

跨版本幂等是本节的显式补强：`(idempotency_scope, idempotency_key)` 的唯一性与 `request_payload_hash` 判定不足以区分版本（v1 通用 `objectRef` 允许与 v2 逐字节相同的 payload），因此返回历史 Receipt 前必须比较持久化 `command_type`/`command_version` 与 target 镜像，不一致即拒绝且不返回对方版本 Receipt；`idempotency_scope` 由服务端组合。`TaskDefinitionSnapshot` 的公开引用身份在本次不注册：未来若需返回或消费该 Ref，须先取得 additive 契约批准并注册 `zhiju.execution.task_definition_snapshot`（CONTENT_ADDRESSED、Project Scope、不可变），不静默发明、不改写 v1 payload。

### 15.6 P-202-5 公开事件边界

DRAFT 创建有意不产生公开业务 Event（Outbox 0 行）。Domain §18.7 的 `TaskCreated` 是 Domain 词汇，不是已注册公开事件；Handler 不得发布未注册事件。若未来需要 `TaskCreated`，须作为独立 additive 契约提案批准，并同步 Registry/兼容元数据、Catalog 计数（213 → 214）、reference 声明、Envelope/Result 与正负 fixture；本次不预先注册。

### 15.7 P-202-6 授权与校验顺序

单一顺序：Registry 精确 `(type, version)` 校验 → 组合层从已验证 Decision 派生受信上下文 → **幂等 Claim 与历史 Receipt 返回之前**重验授权（精确 Decision id/hash、Actor/实际 principal、认证上下文、operation/version/Purpose、payload hash、target/Scope、ALLOW、未过期，并重读当前 Grant/Policy）→ 取得 Claim 后、首个业务写入前证明 Project/DeliveryItem → 同一事务写入创建事实并 finalize Receipt/Audit。撤销、到期、配置漂移、target 或版本替换、依赖不可用一律 fail closed；重放仍重新授权但不重跑业务证明，历史 Receipt 不恢复资格。该顺序继承 §14.3 与 #200，取代任何“先返回历史 Receipt 再校验”的实现顺序。

### 15.8 批准与交付边界

- 独立设计审查经四轮完成，最终结论为 `APPROVE`，批准对象是 PR [#203](https://github.com/qzhike/zhiju-business-core/pull/203) revision `7075741aa643479749591f631713a88640d9991e`；正式记录见 [`reviews/pr-203/Review.md`](../reviews/pr-203/Review.md)，PR 结论见 [第 4 轮评论](https://github.com/qzhike/zhiju-business-core/pull/203#issuecomment-5680277352)。前三轮 `REQUEST_CHANGES` 与 finding 保留，不被最终结论抹除。
- 用户于 2026-09-15 在当前会话明确表示“审核批准”，批准上述精确 revision 的 #202 Task DRAFT 创建引用、校验时机、持久化身份、事件边界、授权顺序及 `TE-P202-*` 验收设计。该记录是人类设计批准，不追溯批准其他 revision、TD-05–07 或未呈现的实现选择。
- 本批准只解除“设计待审/待人类批准”门禁。依赖的 Task DRAFT Handler 可由 Planner 按当前依赖重新执行 `NOW + READY` 复核；本次批准本身不创建 Issue，也不授权业务实现、migration、commit、push 或 PR 合并。
- 后续 Handler Issue 只能覆盖 `TE-P202-001`–`015` 中已批准范围，不得顺带扩大公开接受集、注册新 objectType/Event、改写历史 fixture 或实现 TD-05–07。

## 16. Task Readiness 生产与 READY 转换边界提案（#206）

状态：`T2 / DESIGN MERGED 2026-09-16（PR #207，merge commit 47966816e9ba96dc89b21d502176dfc413cfd7bc）/ INDEPENDENT DESIGN REVIEW APPROVE 2026-09-16（reviewed revision 2155d4dd89437694632c0e35ca65b7d6d46d720f）/ EXPLICIT HUMAN DESIGN APPROVAL RECORDED 2026-09-16（Issue #206）/ IMPLEMENTED 2026-09-16 BY Issue #208 / MERGED 2026-09-16（PR [#209](https://github.com/qzhike/zhiju-business-core/pull/209)，merge commit `0dc1bcef9a9f1e21219a015ac0f8b5d6768fe250`，Issue #208 已关闭）/ INDEPENDENT REVIEW APPROVE ON `c09dd80f5bd81f19dadb31d2c31868863e9f6c94` / HUMAN TECHNICAL REVIEW RECORDED（正式记录见 [`reviews/pr-209/Review.md`](../reviews/pr-209/Review.md)）`。本节回应 [Issue #206](https://github.com/qzhike/zhiju-business-core/issues/206)：在 #154 已批准的权威判断原则、#176 已批准并部分交付的 Policy/Evaluator 边界，与 #202/#204 已交付的版本绑定 DRAFT 事实之间，收敛“让 #204 创建的 Task 到达 `READY`”所需的剩余语义。字段级权威在 [Spec 003 §17](../module-specs/Module-Spec-003-TaskExecution.md#17-task-readiness-生产与-ready-转换边界206-设计)，READY 动作的授权组成在 [Spec 001 §15.5](../module-specs/Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206)，验证矩阵在 [Module Test 003](../module-tests/Module-Test-003-TaskExecution.md#task-readiness-生产与-ready-转换边界206-设计)。本节不重开 Issue #154/#176/#202/#204 的任何决定，TD-05–07 不被追认。

### 16.1 P-206-1 对账结论与真实缺口

对账 revision：`75553dec7afd87f25dc38230db9f884921b7e899`（本分支起点，与远端 `main` 一致）。

| 事实 | 证据 | 结论 |
|---|---|---|
| 两个 `create_task` Major 都只创建 DRAFT，创建事实/幂等/EP Port 已交付 | Spec 003 §16.9、`V3001`、`TE-P202-001`–`015`（真实 PostgreSQL 通过） | READY 没有任何入口；本切片是它的第一个入口 |
| `mark_task_ready@1.0` 已发布并冻结 | `public-api.v1.json`（`COMMAND`/`task-execution`/`schemaStatus=FULL`，通用 `snapshotRef` payload）、compat metadata `task.execution.mark_task_ready` | 只能由 owning Handler 与内部 Port 闭合接受集与授权；不得改写注册 Schema/metadata；[Spec 003 §3](../module-specs/Module-Spec-003-TaskExecution.md#3-command-payload-contract) 的设计期 Purpose 文字按 §15.1 同一规则修正为已发布值 |
| `build_task_readiness@1.0` 只有设计行 | Spec 003 §11.1/§11.3/§11.6/§11.9；Registry 无条目 | 本切片唯一新增 operation |
| Policy 解析已交付，profile/Evaluator selector 只有静态注册 | #183/#186（`identity.resolve_policy@1.0` Handler + V1005）、#179/#189（静态注册与纯解析） | 消费既有边界，不新增 policy schema、不新增 registry 版本 |
| Evaluator 确定性实现、`information_request`、Completion Evaluation 均不存在 | Spec 003 §11.9、§33 | 依赖 COMPLETED 的可用性分支与 blocker 分支必须定义且标 `NOT RUN` |
| Task 公开事件只有 `TaskReady@1.0`/`TaskCompleted@1.0` | `public-api.v1.json` 的 `execution.*` Event 恰 11 项 | 生产者不得发布事件；消费者恰好发布一条 `TaskReady@1.0` |

**缺口是真实的**：Task 的 READY 转换由谁执行、以什么独立授权、消费什么判断事实、如何用一套规则寻址两个 Major 创建的 Task、判断与转换各自提交哪些不可变事实，当前都没有权威定义。若不先固定，后续实现必然自行选择兼容或授权语义。

### 16.2 P-206-2 Task 寻址规则

**诉求**：同一套 Readiness API 必须能处理两个已发布 `create_task` Major 创建的 Task，同时不制造别名、不改写 v1 冻结 fixture、不新增公开字段。

**事实**：`task_execution.task` 不保存拼写；Task 的创建 Major 只由 `task_definition_snapshot.schema_version`（`'1.0'`/`'2.0'`）表达，而 `V3001` 的 creation-identity guard 已强制该快照所属 Receipt 是 `execution.create_task`、其 `command_version` 等于该列、其 target/Scope 等于本 Task、且 Receipt 仍为 `PENDING`。因此“Task 由哪个 Major 创建”是由 owning 事实精确、不可变证明的事实，且每个 Task 恰好一个创建快照。

| 备选 | 评估 | 结论 |
|---|---|---|
| A 闭集接受两种拼写 | 同一 Task 得到两个可互换的公开拼写；`mark_task_ready@1.0` 没有版本字段可把它绑定到创建路径，两种拼写同时合法即把 §16.1 的逐版本精确身份退化为别名 | 不采用 |
| B 版本绑定判别：拼写由 Task 自己的不可变创建事实派生 | 每个 Task 恰好一个被接受的拼写；判别值不来自调用者、不来自 payload 新字段、不来自 `aggregate_version` 或当前指针；两个 Major 各自可达 | **采用**（R-206-1） |
| C 新增 operation major（`execution.mark_task_ready@2.0`） | 不解决问题：@1.0 已发布且必须继续服务它可服务的 Task，其 `targetRef` 仍需闭合，判别规则仍是 B；新增第二消费者会增加公开面（Catalog 214 → 215）而语义不变 | 不采用；未来若确需新 major，须独立 additive 提案 |

**为什么 B 不是别名**：别名是同一对象在**业务接受集**中有第二个可用名字。B 让每个 Task 恰好一个拼写被接受，另一个拼写在生产者 Handler、消费者 Handler 与授权 Port 三处都不能取得业务成功；两个拼写并非「同一操作的两个名字」，而是「两个已发布创建路径各自的唯一名字」。v1 的 payload/fixture、v2 的 `const`、两个注册 Schema 与 200 项 Baseline 全部不变。

**为什么 B 不需要新的公开字段**：`mark_task_ready@1.0` 的 payload 已冻结，任何新增字段都是对已发布 FULL 操作的破坏性变更；把判别做成 payload 字段还会让调用者可以选择拼写，正是 §16.2 拒绝的 caller-controlled aliasing。判别只能来自 owning 事实。

**授权层的两层精确**：READY 动作需要一个绑定精确 Task target 的 Decision（`identity.authorize_command@1.0` 产生的历史 Decision 无 target 镜像，V1006 只允许新 Port 写入 target 列，因此公开路径无法表达该绑定）。授权 Port 的闭集键表按 `(commandType@commandVersion)` 列出该动作可接受的 target objectType **闭集**（两个已发布 Task 拼写），并要求 covering Grant 的 `TARGET_TYPE` selector 与请求声明的 target 逐字符相等；**业务**上哪个拼写正确只由 §17.3 的 owning Handler 判定。两层各自精确、大小写敏感、不做规范化，因此调用者无法通过声明另一拼写取得任何业务成功，也无法用另一个 target 的 Grant 提权。

### 16.3 P-206-3 公共引用身份注册面

- **`zhiju.execution.task_readiness`（新增）**：Owner `task-execution`、kind `SNAPSHOT`、Project Scope（两成员必填）、不可变判断事实、无可变 Root/无 CAS 版本/无 current pointer、不可作 BusinessOutput；Ref 的 `objectId == snapshotId`，`contentHash` 为完整判断 payload 的 SHA-256（canonicalization v1）。选择 `objectId == snapshotId` 而非 `context_snapshot` 的 Root+Snapshot 形态，是因为判断没有可变 Aggregate Root；这与已注册的 `zhiju.identity.policy_version`（§13.2）同形，属既有先例而非新机制。
- **`zhiju.execution.task_definition_snapshot`（已决定、本切片注册）**：沿用 §16.7 的全部决定（CONTENT_ADDRESSED、Project Scope、不可变、不可作 BusinessOutput、按 exact `objectId` + 完整 payload Hash 解引用）；**不改** `execution.create_task` 两个版本的 Schema/Result/接受集，v1 冻结 fixture 逐字节不变，该 Ref 由 Readiness 生产者以自己的 payload 携带。§17.4 的 Catalog 路由记录**不**保留「PROPOSED / NO CATALOG CHANGE」的历史状态描述，改为与 #204 实现事实一致。
- 两个身份都不由 TypeScript 名称、表名或 Handler 约定推断；未注册名称不得被发出、返回或消费。

### 16.4 P-206-4 生产者 Contract/Registry Delta

- 新增 `execution.build_task_readiness@1.0`：Owner `task-execution`、`COMMAND`、`Target=zhiju.execution.task_readiness`、mode `CREATE`、Purpose `execution.task.readiness.build`（新增）、`dataClassification=INTERNAL`、operation-specific Result Schema、四条 `references` 与一条 `resultReferences` 声明；`/payload/taskRef` 有意不声明，因为其合法取值随 Task 创建 Major 而定（与 `create_task@2.0` 不声明两版本 Task 引用的先例一致）。
- **生产者也有自己的 owning 授权条目**：Purpose、required Grant action、`CREATE_TARGET_TYPE` selector、trusted capability config key `taskReadinessBuildV1` 与签发/重验顺序由 [Spec 001 §15.5](../module-specs/Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 的生产者行拥有；它与消费者行互相独立（§16.6），不共用 entry、不继承资格。缺少该条目会让一个合法的 build 命令没有可路由、可签发、可重验的 owning Port，因此它是本 Delta 的必要组成部分，而不是实现期选择。
- **不新增专用 PayloadGuard 技术 Policy**：payload/result 是有界小对象，适用 PostgreSQL §5.5 的默认 Command Guard（同 #158/#167/#175/#192）。
- **Catalog 213 → 214**（TaskExecution 43 → 44：24 Command / 9 Query / 11 Event），历史 200 项 Compatibility Baseline 不变（additive 追加，不改写任何既有条目）。
- **`mark_task_ready@1.0` 零改动**：Schema/Catalog/metadata 逐字节不变；不接受把 `snapshotRef` 收窄为固定 objectType、不补 `targetObjectType`、不补 Purpose 字段的"顺带修正"。

### 16.5 P-206-5 判断持久化、事务边界与事件

- **单一事实行** `task_execution.execution_judgment`（§33 的设计表，本切片只实现 kind `TASK_READINESS`；`result_validation_fact`/`judgment_invalidation` 留待各自切片）：Project Scope 镜像、subject 镜像（Task + definition id/hash）、Policy 观察镜像、evaluator、`input_hash`、`evaluated_at`/`valid_until`、`ready`、canonical payload/hash、`source_command_id`。
- **不可变 + RLS + 双 guard**：app 角色无 UPDATE/DELETE；`FORCE RLS` + `context_allows_project`；mirror guard 由 payload 重算 Scope/subject/policy 镜像与 Hash；creation-identity guard 要求 `source_command_id` 指向仍在途（`PENDING`）的 `execution.build_task_readiness` Receipt 且其 target/Scope/请求 Hash 与本行一致。与 [Spec 003 §16.4](../module-specs/Module-Spec-003-TaskExecution.md#164-创建事实快照身份与幂等) 的差异在于判断 payload 是命令产出的**结论**而非请求 payload，因此绑定请求 Hash 与 target/Scope，而不要求 payload 逐字节等于请求。
- **生产者不发布事件**：Catalog 没有 `TaskReadinessBuilt@1.0`，Handler 不得发布未注册事件；若未来需要，须独立 additive 提案并同步计数。
- **不改写 Task Root**：READY 转换只改既有 `status`/`aggregate_version`，不新增 Root 列；转换的正当性由不可变判断 + Receipt + Reference Edge + 恰一条 `execution.TaskReady@1.0` 解释。若未来消费方需要 Root 侧的判断指针，须另立 additive 决定（forward migration），不在本切片顺带加入。
- **并发**：同一 Task 允许多个判断共存（无 current pointer、无取代路径）；转换由 `DRAFT`-only CAS 单赢家裁决。

### 16.6 P-206-6 消费者边界与授权组成

- **两个入口各自的独立授权**：生产者与消费者各有自己的 Decision，且由 [Spec 001 §15.5](../module-specs/Module-Spec-001-IdentityPolicy.md#155-im06-ready-01-task-readiness-生产与-ready-转换授权组成提案206) 的**两条独立映射**签发与重验——生产者条目（Purpose `execution.task.readiness.build`、action `execution.task.readiness.build`、`CREATE_TARGET_TYPE`、config key `taskReadinessBuildV1`，target 是被创建的 readiness identity）与消费者条目（Purpose `task.execution.mark_task_ready`、action `execution.task.mark_ready`、`TARGET_TYPE`、config key `taskReadyV1`，target 是既有 Task）。两者不共用 entry、不继承、不互为别名：生产者的 Decision 与已提交判断不授权 READY 转换，消费者的 Decision 也不授权 build，且 target objectType 集合不重叠。两条映射的重验都在各自的幂等 Claim 与历史 Receipt 返回之前完成，并重读当前 covering Grant/Policy。
- **提交点重验**：判断完整性/可用性、Task/Scope/definition 绑定、完整依赖/输入/blocker 观测逐项相等（不一致即 `EXECUTION_JUDGMENT_STALE`，要求重建判断）、`ready=true`、`now < validUntil`；任何 `UNSUPPORTED` 检查优先映射 `EXECUTION_CRITERION_UNSUPPORTED`。
- **调用者非权威**：`ready`、检查清单、`requestedAt` 与历史 Receipt 都不是判定依据；`requestedAt` 只作为声明的请求时刻记录，不参与期限、CAS 或授权。
- **错误面**：本切片只新增 `EXECUTION_TASK_REF_INVALID`；`EXECUTION_JUDGMENT_INVALID`/`EXECUTION_JUDGMENT_STALE`/`EXECUTION_CRITERION_UNSUPPORTED` 沿用 §11.7 已批准语义并带入实现范围；`EXECUTION_TASK_DEPENDENCY_CYCLE`/`EXECUTION_TASK_READINESS_UNSATISFIED`/`EXECUTION_TASK_NOT_EXECUTABLE` 沿用 §6 既有码。跨 Scope 不可见、不支持类型、依赖暂时不可用都不泄露 owning 模块细节，也不收敛为成功。

### 16.7 批准与交付边界

- 本设计已由 PR [#207](https://github.com/qzhike/zhiju-business-core/pull/207) 以 merge commit `47966816e9ba96dc89b21d502176dfc413cfd7bc` 合入 `main`（2026-09-16T07:37:01Z），Issue [#206](https://github.com/qzhike/zhiju-business-core/issues/206) 已关闭（`COMPLETED`）。独立设计审查经两轮完成：第 1 轮 `REQUEST_CHANGES`（reviewed revision `fbca61828e2e5791d8b0ac8282ee0c39eeac7e0d`，唯一阻断项为生产者缺少可执行的 owning 授权映射）→ 第 2 轮 `APPROVE`（reviewed revision `2155d4dd89437694632c0e35ca65b7d6d46d720f`）；正式记录见 [`reviews/pr-207/Review.md`](../reviews/pr-207/Review.md)。final head 为 `dcdada2b77ed36db99810159278b6ac1c0b5e918`（reviewed revision + review 记录 + 该轮非阻断引用澄清，未改变任何规则、接受集、计数或边界）。
- **人类设计批准已记录（2026-09-16，Issue #206 评论）**：用户明确批准 PR #207 final head `dcdada2b77ed36db99810159278b6ac1c0b5e918` 交付的 Task Readiness 设计，该批准解除了“创建依赖实现 Issue 之前须取得该确切 revision 的显式人类设计批准”这一门禁。
- **实现事实（2026-09-16，#208）**：`execution.build_task_readiness@1.0`、`zhiju.execution.task_readiness`、`zhiju.execution.task_definition_snapshot` 与 `EXECUTION_TASK_REF_INVALID` 已注册，Catalog 213 → 214；`V3002__task_readiness_judgment.sql` 建立 `task_execution.execution_judgment`；生产者与 `mark_task_ready@1.0` 消费者 Handler、Spec 001 §15.5 的两条授权条目与组成层接线已交付并在真实 PostgreSQL 上执行 `TE-P206-001`–`018`。历史 200 项 Baseline、两个 `create_task` Major 的接受集与 `mark_task_ready@1.0` 的注册 Schema/metadata 逐字节不变；字段级实现事实见 [Spec 003 §17.11](../module-specs/Module-Spec-003-TaskExecution.md#1711-实现事实与验证边界2082026-09-16)。
- 依赖的实现 Issue 只能覆盖 `TE-P206-D-*` 与 `TE-P206-001`–`018` 已批准范围，不得顺带扩展输入支持集、注册 Event、改写历史 fixture、修改两个 `create_task` Major 或 `mark_task_ready@1.0` 的接受集，也不得实现 TD-05–07。

## 17. WorkOrder DRAFT 创建与精确 Draft 读取边界提案（#210）

状态：`T2 / DESIGN APPROVED 2026-09-17（Issue #210）/ INDEPENDENT REVIEW COMPLETED ON 67e5df57 / EXPLICIT HUMAN DESIGN APPROVAL RECORDED / IMPLEMENTATION REQUIRES A SEPARATE NOW + READY ISSUE`。本节回应 [Issue #210](https://github.com/qzhike/zhiju-business-core/issues/210)：把 `execution.create_work_order@1.0`/`@1.1` 的创建身份、生命周期、归属、校验时机与持久化边界，以及 `execution.get_work_order_draft@1.0`/`@1.1` 的精确读取与读取授权收敛为可实现语义，使后续实现 Issue 不必自行发明安全或兼容语义。字段级权威在 [Spec 003 §18](../module-specs/Module-Spec-003-TaskExecution.md#18-workorder-draft-创建与精确-draft-读取边界210-设计)，验证矩阵在 [Module Test 003](../module-tests/Module-Test-003-TaskExecution.md#workorder-draft-创建与精确-draft-读取210-设计)，读取授权组成在 [Spec 001 §15.6](../module-specs/Module-Spec-001-IdentityPolicy.md#156-im06-wodraft-01-workorder-draft-读取授权组成提案210)。本节不注册 operation/objectType/Event、不分配 migration、不改写任何已发布接受集或历史 200 项 Compatibility Baseline；批准与交付边界见 §17.10。

### 17.1 对账结论与真实缺口

对账 revision：`bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`（本分支起点）。逐项已提交事实、来源与结论的完整表见 [Spec 003 §18.1](../module-specs/Module-Spec-003-TaskExecution.md#181-对账事实revision-bbfd2ceaab21d0d346d6f405be7f216bc6cdd276)；三处必须对账而不是任选一边的事实是：

1. #200 已交付的创建授权绑定把 `create_work_order@1.0` 的 CREATE target 拼写固定为 legacy `execution.work_order`、`@1.1` 固定为 canonical `zhiju.execution.work_order`。
2. 两个已注册的 `execution.get_work_order_draft` 版本与两个已声明的 Draft Snapshot def 都只接受 canonical `zhiju.execution.work_order`（而这两个 def 没有任何注册引用调用点，也不在 200 项 Baseline 中）。
3. 两个 `create_work_order` Major 的 `draft.taskRef` 都是通用 `ObjectRef`，因此 payload 可以承载任一 Task 拼写，但已声明的 Draft Snapshot 只接受 `zhiju.execution.task`，无法忠实表示由 `execution.create_task@1.0` 创建为 `execution.task` 的 Task。

**缺口是真实的**：WorkOrder 的公开拼写与读取版本绑定、Task 跨 Major 绑定、创建期 Task 生命周期集合与竞态裁决、requester/actor 归属、DRAFT 与后续 Context/Validation/Freeze 的校验分工、`work_order` 与 `work_order_draft_snapshot` 的持久化与 guard、幂等/回放/并发/恢复、以及非 `1.0` 版本读取的授权路径，当前都没有权威定义。

### 17.2 P-210-1 WorkOrder 寻址与读取版本绑定

**诉求**：同一套已注册契约必须能服务两个已发布 WorkOrder 创建 Major，同时不制造别名、不改写已发布接受集、不注册 legacy 公开对象名。

**事实**：WorkOrder 的创建 Major 由不可变创建事实精确证明（创建 `command_receipt` 的 `command_type`/`command_version` 与 target/Scope）；行本身不存拼写。

| 备选 | 评估 | 结论 |
|---|---|---|
| A 两个读取版本都接受两种拼写（或把 payload 的 `const` 放宽为通用 `ObjectRef`） | 改写已发布 FULL 操作的接受集：共享 API §9.1 第 3 条与 Catalog §9.2 第 5/6 行把“扩展 closed 接受集/收窄允许值”列为必须新 Major 或新操作；同时让同一对象出现两个可互换名字，与 §16.1/§17.3 的逐版本精确身份冲突 | 不采用 |
| B 拼写由创建事实派生，并用一个**新增读取版本**服务 legacy 创建 Major | 每个 WorkOrder 恰好一个被接受的拼写，且该拼写决定唯一可用的读取版本；已发布接受集逐字节不变，旧 200 项 Baseline 不受影响；代价是 Catalog 214 → 215 与一个新的读取版本 | **采用**（R-210-1） |
| C 把 legacy 名注册为 Canonical objectType 并改写读取 payload | 扩大公开命名面并需要 namespace/owner 归属决定；结论不依赖它，且与 R-206-1 对 Task 的处理不一致 | 不采用 |

**决定（R-210-1）**：`command_version='1.0'` → 唯一拼写 `execution.work_order`、唯一读取版本 `execution.get_work_order_draft@2.0`（新增）；`'1.1'` → 唯一拼写 `zhiju.execution.work_order`、唯一读取版本 `execution.get_work_order_draft@1.1`（已注册，零改动）。kind/objectId/Scope 精确闭合，大小写敏感，无规范化、无别名、无 latest、无跨版本 Receipt 复用；请求另一拼写、另一读取版本或错 Scope 统一 `EXECUTION_WORK_ORDER_REF_INVALID`。

**为什么不是别名**：别名要求同一对象在业务接受集里有第二个可用名字。这里每个 WorkOrder 恰好一个拼写能取得业务成功，且该拼写同时排除另一读取版本；授权 Port 的 target 闭集与 owning Handler 的业务闭合两层各自精确，调用者既不能靠声明另一拼写成功，也不能用另一 target 的 Grant 提权。

**`get_work_order_draft@1.0` 保留不改**：它已注册（不在 200 项 Baseline 中），payload 固定 canonical、result 形状是 `WorkOrderDraft`（Core `VersionPins`）。在本规则下没有任何创建 Major 产生该组合，因此它没有可满足的 IM-06 输入。本 revision 逐字节保留、不改写、不为它实现 Handler；将来若要让其可用，必须独立 additive 提案。

**不注册 legacy objectType**：`execution.work_order`/`execution.task` 都不是 Registry objectType，本 revision 不改变这一点；`get_work_order_draft@2.0` 的 `/payload/workOrderRef` 有意不声明（与 §17.4 对 `/payload/taskRef` 的不声明同理）。

**创建 target 的发生层（评审修复）**：`EXECUTION_WORK_ORDER_REF_INVALID` 只属于读取路径。创建路径的真实可达顺序为：① 注册 Envelope——`create_work_order@1.1` 带 `targetObjectType` 元数据，`targetRef.objectType` 被 `const` 固定，错拼写/裸名/大小写/错 kind 即 `API_VALUE_INVALID`；@1.0 是 Baseline 条目、无该元数据，不由 Schema 固定。② `TaskExecutionCreationAuthorizationPort`——`expectedTargetRef.objectType` 与该版本 binding 不符即 `IDENTITY_CREATION_TARGET_INVALID`，且发生在幂等 Claim 与历史 Receipt 返回之前。③ owning Handler 与 §18.7 的持久化 guard——强制 `work_order_object_type` 等于 Receipt `command_version` 派生拼写，不再重复判定 target。因此创建与读取两侧都不会出现“同一情形两个稳定码”。

### 17.3 P-210-2 WorkOrder 与 Task 的绑定

**决定（R-210-2）**：`draft.taskRef` 的拼写必须等于**该 Task 自身创建事实**对应的拼写（R-206-1：`schema_version='1.0'` → `execution.task`、`'2.0'` → `zhiju.execution.task`），不得由 WorkOrder 版本、payload 其他字段、Task 的 `aggregate_version` 或 objectId 推断；两个 WorkOrder Major 都接受两个 Task Major（四种组合合法）。拼写/kind/id/Scope 不闭合 → `EXECUTION_TASK_REF_INVALID`（复用 #208 已注册码）；同 Scope 内不存在该 Task → `NOT_FOUND`；创建事实缺失、不可读或与拼写判定不一致 → `EXECUTION_DEFINITION_REF_INVALID`（沿用 §17.9）。

**不记录 Task 版本**：DRAFT 快照不保存被绑定 Task 的 `aggregate_version`，DRAFT 创建不写 Task Root、不建立 Task 版本 CAS，也不据此产生 staleness；Task 的后续状态由 §17.4 的创建期检查与后续 READY/Freeze/Queue/Run 各自的消费边界解释。两个 Task 拼写仍不是别名。

**Task 身份的持久层闭合（第 2 轮评审修复）**：只有 `draft.taskRef` 由创建请求投影证明其来自该命令；Snapshot 顶层 `taskRef` 与 Root 的 `task_id`/`task_object_type`/Scope 是派生写入，直 SQL 可以把它们改成同 Scope 内另一创建事实自洽的 Task B，而完整 payload Hash、请求投影 Hash、Task B 的创建事实与来源 Receipt 仍分别通过。因此 §18.7 的创建 guard 必须把 `draft.taskRef`、Snapshot 顶层 `taskRef`、Root mirrors 与被查验 `task` 行（含其创建定义快照 `schema_version` 派生的拼写）在 `kind`/`objectType`/`objectId`/Project Scope 上判为**同一事实**，且在同一事务内读取 Root 行；这与 §11.2.1 已有的“`draft.taskRef` 与 Snapshot `taskRef` 一致”规则一致，只是把该一致性落到数据库层，不依赖 Handler 先验校验。

### 17.4 P-210-3 创建期生命周期、锁序与竞态

**决定**：仅当绑定 Task 的 `status` ∈ `{READY, IN_PROGRESS, WAITING_INPUT, BLOCKED, IN_REVIEW, CHANGES_REQUIRED, COMPLETION_PENDING}` 才可创建 DRAFT WorkOrder；`{DRAFT, BACKLOG, COMPLETED, CANCELLED}` 一律 `EXECUTION_TASK_NOT_EXECUTABLE`。这一集合来自 §8.1“按 #154 的 Readiness 规则满足创建 WorkOrder 的生命周期要求”与 Domain §19.7 第 1 条，不新增中间态，也不把 Task 置为可执行：DRAFT 创建只写本模块 WorkOrder 事实，不改 Task、不签发 Capability、不 READY、不 queue、不创建 Run、不发布事件。

**锁与竞态**：创建事务只对绑定 Task 取只读依赖行锁（`SELECT … FOR SHARE`），并在持锁时校验 Scope/创建事实/status，锁顺序沿用 PostgreSQL §33 的 `Task → WorkOrder → Run → Claim`。并发 Task 转换先提交则创建读到新 status（离开集合即拒绝，无部分事实）；创建先提交则转换照常推进，已提交 DRAFT 不因 Task 变化获得或失去执行资格。同一 Task 上的两个并发创建（不同 target）都合法（Domain §19.4 `Task 1 — * WorkOrder`）；同一 target 由 Root 主键裁决为单一成功，另一侧 `EXECUTION_WORK_ORDER_ALREADY_EXISTS`。

### 17.5 P-210-4 Actor、requester 与 Human-only 归属

**决定**：

1. 唯一 Actor 来源是受信会话与已验证 Decision 行；`actingFor`、payload 的 `requestedBy`、`initialAssignee`、PrincipalKind 声明与转交的他人 Decision 都不是授权来源。
2. `draft.requestedBy` 必须恰好等于认证 principal（Human/Coordinator Agent/受约束 Process Manager 一体适用），否则共享 `AUTHORIZATION_DECISION_INVALID` 且内部分类只进 Audit。**未采用**“payload 指定 Human requester + Service 执行”：它需要额外的 identity 证明边界，且正是 Issue 禁止的 caller-supplied `requestedBy` 旁路；Human 归属只作为 owning ActorSnapshot 的 `actingFor` metadata 存在。
3. 服务发起请求只允许持自己的 `task.execution.create_work_order` Decision 与覆盖 Grant；`actingFor` 不替代 principal、不豁免 Service 的 capability/Purpose/Scope。
4. 判定单元是 Core §4.7 `CapabilityGrant.capabilityType`（`actions[]`/`resourceSelectors[]`/`constraints[]`/`expiresAt`/`grantPolicyRef` 不参与 Human-only 分类）。认证 principal 不是 Human 时，对 `allowedCapabilities[]` 与 `deniedCapabilities[]` 的每个 `capabilityType` 经 owning 内部分类边界（Spec 001 §15.7，版本化静态集合 `HUMAN_ONLY_CAPABILITIES`@`im02-static-v1`）分类，任一项属于该集合即拒绝共享码 `HUMAN_ONLY_CAPABILITY`（[共享 API §8](../api-contract-v0.1/API-Contract-v0.1.md) 的共享错误码列表第 `HUMAN_ONLY_CAPABILITY` 条；Domain §19.10 的 `WO-U-002` 同码），内部分类只进 owning Audit。**版本归因（第 2 轮评审修复）**：Port 的外部结果必须是可归因的 `{outcome, classificationRegistryVersion}`（实际使用的分类集合版本），否则只有 outcome 时 TaskExecution 只能硬编码或跨边界读取 owning 常量；TE 把该返回值原样记入自己的 Audit，版本事实不进入不可变 DRAFT payload。**不采用** `identity.check_human_only_capability@1.0` 作为分类器：它是 Grant 覆盖判定（`evaluateAccess` → `authorizeCommand(requestedCapability=capabilityCode)`），起草者通常不持有其声明的执行能力，其 DENY 无法区分“未持有 Grant”与“Human-only”，会把合法草案误拒。`IDENTITY_CAPABILITY_HUMAN_ONLY`（`identity.grant_capability` 模块码）与 `CAPABILITY_HUMAN_ONLY`（IdentityPolicy Decision/Audit reason）都不是本操作的公开错误码。
**归属的持久层闭合（第 3–5 轮评审与 scope 决定）**：创建请求投影只证明 `draft.requestedBy` 来自原请求，Snapshot `createdBy` 与 Root 两个 principal id 是派生写入；Receipt creator 又是 app-role 可写列，因此这些副本彼此相等都不是受信 Context 的证明。第 4 轮已把 principal id 锚改为 `platform_security.context_principal_id()`；第 5 轮进一步确认 Core `PrincipalRef` 还包含 `principalKind`，当前 Context 无对应数据库事实。用户于 2026-09-17 选择扩展 scope，而非接受 application-only kind 残余。决定为：按 [RLS 事务上下文 §3.5](rls-transaction-context.md#35-210-principalkind-的向后兼容增量设计提案) 新增可空 `principal_kind`、11 参数 establish 重载与 `context_principal_kind()`，保留旧 10 参数 legacy 入口；TaskExecution WorkOrder 路径必须使用新入口，creation guard 把两份 payload 的 `principalId + principalKind` 分别绑定到两个 Context helper，同时把 Root/Receipt principal id 绑定到 Context id。legacy kind=NULL、两份 kind 同值伪造、P2 Context 伪造 P1 Receipt 或任一副本不等都 fail closed。`TE-P210-009` 的 Handler/Decision 替换不能替代数据库 Gate（`TE-P210-017`）。

### 17.6 P-210-5 DRAFT 与后续 Context/Validation/Freeze 的校验分工

**决定**：DRAFT 只证明它必须固化的事实——WorkOrder 身份/Scope/创建 version、绑定 Task（存在性、Scope、创建事实拼写、status）、`targetScope` 与各引用字段的 Scope 包含关系（沿用 §16.3 的 Scope 形态规则）、能力集合良构与非 Human 的 Human-only 拒绝、`expiresAt` 的存在性与 `now < expiresAt`（违反用共享 `API_VALUE_INVALID`，§11.2.4 第 1 条）。其余引用（`inputRefs` 存在性/版本/生命周期、Evaluator/Policy/Profile 支持与有效性、budget/risk/quality/harness/model 语义）只结构保留在不可变 draft，必须由 Builder/Validator/Freeze 各自重新读取。**明确否定**：Schema 通过、Hash 正确或 Ref 形状合法都不证明引用存在、当前授权有效或可执行；Human-only 能力、跨 Project 引用、缺失/过期引用、未支持的外部引用与依赖不可用都不得因 payload 通过 Schema 校验而被当作有效。

### 17.7 P-210-6 持久化、幂等与事件边界

**决定**：同一 owning 事务提交 `task_execution.work_order`（Root：身份、Scope、拼写与 Task 拼写镜像、status/aggregate_version、当前 Draft 指针 id + hash、`draft_schema_version`、可空且不可变的 `expires_at`、归属列）与不可变 `task_execution.work_order_draft_snapshot`（独立 `snapshot_id`、`WorkOrderDraftSnapshot` 规范 payload/hash、提升镜像、`request_payload_hash` 与 `source_command_id`），加 Receipt、Audit 与仅指向已证明引用的 Edge；**Outbox 0 行**。双 guard 强制 payload↔镜像、来源 Receipt 的 `command_version` 与拼写/形状版本一致、`task_object_type` 与被绑定 Task 的创建事实一致；app 角色无快照 UPDATE/DELETE 与 Root DELETE；两表 FORCE RLS + `context_allows_project`，无跨 Schema FK/Join。未来 forward-only migration 编号由实现 Issue 分配，**不改** `V3000`/`V3001`/`V3002`。

幂等沿用 #151 runner 与 #204 规则：`idempotency_scope` 由服务端按 `execution.create_work_order@<version>` + Project Scope 组合；返回历史 Receipt 前比较持久化 `command_type`/`command_version`/`target_type`/`target_id`，不一致 `IDEMPOTENCY_PAYLOAD_CONFLICT` + DENIED Audit；重放仍重新授权但不重跑 Task 业务证明；同 target 冲突 `EXECUTION_WORK_ORDER_ALREADY_EXISTS`；注入故障或任一拒绝整体回滚，不留 `PENDING` Receipt 或孤立事实。

**创建请求投影（评审修复）**：快照 payload 是创建请求的超集（多出 `snapshotId`/`workOrderRef`/`taskRef`/`scopeRef`/`capturedAt`/`createdBy` 与 `draft` 的包装），因此把 Receipt 的 `request_payload_hash` 复制到同名列**不能**证明“这份 draft 就是该命令提交的内容”。creation-identity guard 必须由 `canonical_payload` 重建请求投影 `{draft}` ∪（当且仅当 payload 含 `expiresAt`）`{expiresAt}`，用 owner-only canonicalization v1 规范化后 `sha256`，并要求恰好等于来源 Receipt 的 `request_payload_hash`；成员存在性与值都参与。投影成员集合闭合为这两种，header 不得计入，`payload_hash` 与请求投影 Hash 不能互相替代。这样“同一在途 Receipt + 另一份自洽 draft”“增删或改写 `expiresAt`”“掺入额外成员”都会被拒绝。

**事件边界**：DRAFT 创建不发布任何公开 Event；Catalog 无 `WorkOrderDrafted`，Domain §19.8 的 `WorkOrderDrafted` 只是 Domain 词汇。需要该事件时须独立 additive 提案并同步 Registry/兼容元数据/reference/计数/fixture。

### 17.8 P-210-7 精确读取与读取授权组成

**读取决定**：读取按 exact identity 返回已提交事实（Root + 当前快照指针 + 由 `canonical_payload` 重算的 Hash），不重建、不推断；只接受 `status='DRAFT'` 的 Root（否则 `AGGREGATE_STATE_NOT_ALLOWED`）；Root↔快照或指针↔payload 不一致 `REFERENCE_INVALID`；已过期但仍为 DRAFT 的 Root 仍返回历史事实但不赋予任何构建/校验/冻结/排队/执行资格；读取版本与 `draft_schema_version` 必须由同一创建事实派生。

**读取授权（本 revision 必须补齐的 owning 前置）**：`identity.authorize_command@1.0` 的签发路径硬性拒绝非 `1.0` 的 `commandVersion`，因此 `get_work_order_draft@1.1` 与新增 `@2.0` 当前没有任何可路由、可签发、可重验的授权路径；仅有 Registry 的 Purpose 字符串不足以实现权威读取。本 revision 因此固定一个 IdentityPolicy owning 内部 Port 的读取条目（[Spec 001 §15.6](../module-specs/Module-Spec-001-IdentityPolicy.md#156-im06-wodraft-01-workorder-draft-读取授权组成提案210)）：按 `(type@version)` 逐条声明 Purpose、Grant action、`TARGET_TYPE` selector 闭集与受信 capability config key；在任何历史结果或读取事实返回**之前**重验精确 Decision 与当前 covering Grant/Policy，撤销、到期、配置漂移、target 或版本替换、依赖不可用一律 fail closed。该 Port 不是公开 Command/Query、不进 Catalog、不新增 capability code、不改 `authorize_command@1.0`、不新增 IdentityPolicy 迁移（复用 V1006 的 target 列）。

**超出 Issue 预期 scope 的一处，须显式批准**：IdentityPolicy Spec 001 不在 #210 声明的“预期受影响 durable scope”列表内，但缺少该条目时 @1.1/@2.0 读取不存在合法授权路径，依赖实现切片无法交付“权威读取”。本 revision 因此把该条目作为**必需 owning 前置**写入 Spec 001 §15.6，并在交付边界中单独列出；若人类批准时排除该条目，Spec 003 §18 的读取版本设计随之不可实现，须回到 readiness 复核。同一版本缺口也存在于 `execution.build_initial_context_snapshot@1.1`，它由 TD-01 的 Context 切片拥有，本 revision 有意不顺带关闭。

### 17.9 Delta 分类结论

| 已注册产物 | 判定 |
|---|---|
| `create_work_order@1.0`/`@1.1`、`get_work_order_draft@1.0`/`@1.1` | **零改动**（payload、Schema、Catalog 条目、兼容元数据逐字节不变）；`1.0` 读取版本保留但不实现 |
| `execution.get_work_order_draft@2.0` | **新增 operation 版本**（additive；实现时 Catalog/Registry 214 → 215、TaskExecution 44 → 45） |
| `$defs.workOrderDraftSnapshot`/`initialWorkOrderDraftSnapshot` | 拼写固定改为创建 Major 派生、`taskRef` 通用化；两个 def 无注册引用调用点且不在 Baseline，因此不改变任何已注册接受集、计数或元数据 |
| 历史 200 项 Compatibility Baseline | **不变**（新版本按 `COMPATIBLE_MINOR operation-added-as-minor` 归类） |
| IdentityPolicy | 一个内部读取授权 Port 条目（Spec 001 §15.6）；无公开 API、无 capability code、无迁移 |
| Platform transaction context | 向后兼容增量：可空 `principal_kind`、保留 10 参数 legacy establish、新增 11 参数 establish 与 `context_principal_kind()`；未来 forward-only bootstrap migration，不改 V0003；WorkOrder 只接受新入口建立的 Context |
| TaskExecution migration | 未来 forward-only `V3003`，编号在实现 Issue 分配 |

### 17.10 批准与交付边界

- 本设计已在 revision `67e5df57db637953009ba21b2193114aec401ce6` 完成第 6 轮独立审查；该轮未发现新的 agent-fixable 阻断，并按安全敏感门禁给出 `HUMAN_REVIEW_REQUIRED`。用户随后于 2026-09-17 对该 exact design 明确作出人类技术批准，记录见 [Issue #210 评论](https://github.com/qzhike/zhiju-business-core/issues/210#issuecomment-5715698129) 与 [Review.md](../reviews/pr-211/Review.md)。
- 独立审查与人类批准门禁已满足，但这只允许 Planner 进行新的 `NOW + READY` 复核；在另行创建并授权实现 Issue 前，仍不得注册 `execution.get_work_order_draft@2.0`、新增 objectType/错误码、分配 migration 编号、实现 Handler/Port/组成层，或把本节的任何运行时行为记为 `PASS`。
- 批准后，依赖的实现 Issue 只能覆盖 `TE-P210-D-*` 与 `TE-P210-001`–`023` 的已批准范围：不得顺带改写 `get_work_order_draft@1.0`/`@1.1` 与两个 `create_work_order` Major 的接受集、不得注册 legacy objectType、不得发布未注册 Event、不得改写历史 fixture 或 200 项 Baseline、不得实现首次 Context/校验/冻结或 TD-05–07。
- WorkOrder、首次 Context、Validation/Freeze 与 IM-06 均**不**因本节完成。
- **审查轮次（2026-09-17）**：PR [#211](https://github.com/qzhike/zhiju-business-core/pull/211) 的独立设计审查在 revision `b8354cfeb562197630596fdf528510df90d7617d` 给出 `REQUEST_CHANGES`，三个阻断项为：① Draft Snapshot 的双 guard 未从快照内容重建创建请求投影 Hash，同一在途 Receipt 可绑定另一份自洽 draft；② Human-only 检查缺少 Core `CapabilityGrant` → 分类输入的字段映射，且混用了模块码与 Decision reason；③ WorkOrder 创建身份与并发占用的稳定错误码在 Spec/Test 内互相矛盾，创建 target 的发生层未闭合。三项均已在本 revision 修正：Spec 003 §18.2 第 5 条、§18.5 第 4/6 条、§18.6 与 §18.7 的创建请求投影、§18.11 及其后的发生层序；Spec 001 §15.7（能力分类 Port）；Module Test `TE-P210-004`/`010`/`015`/`017` 与状态段的发生层原则。
- 审查同时主张“仓库没有共享错误码 `HUMAN_ONLY_CAPABILITY`”。该主张与 [共享 API §8](../api-contract-v0.1/API-Contract-v0.1.md) 的共享错误码列表不符（Domain §19.10 的 `WO-U-002` 同码），因此本 revision 保留该共享码，并补充它与 `IDENTITY_CAPABILITY_HUMAN_ONLY`（`identity.grant_capability` 模块码）和 `CAPABILITY_HUMAN_ONLY`（IdentityPolicy Decision/Audit reason）的关系，见 §17.5 第 4 条。
- 修复后仍须对新的 exact head 重新独立审查；本节的显式人类设计批准仍未完成，`TE-P210-*` 全部保持 `NOT RUN`。
- **审查轮次 2（2026-09-17）**：PR [#211](https://github.com/qzhike/zhiju-business-core/pull/211) 的第 2 轮复审在 revision `c1b7eeec0cfc31322b16beebc00772c89c633b90` 仍给出 `REQUEST_CHANGES`，两个阻断项为：① 双 guard 未把 `draft.taskRef`、Snapshot 顶层 `taskRef` 与 Root 的 Task identity/Scope 闭为同一事实，直 SQL 可保留原 draft（投影 Hash 仍匹配）而把 header/Root 指向同 Scope 内另一创建事实自洽的 Task B；② Human-only 分类 Port 只返回 `VALID`/`INVALID`，却要求 TaskExecution 审计本次实际使用的 registry version，返回契约无法提供该事实。两项均已在本 revision 修正：Spec 003 §18.3 第 6 条与 §18.7 的 **Task 身份闭合**、§18.6/§18.5 的对应行；Spec 001 §15.7 的**可归因返回值** `{outcome, classificationRegistryVersion}`；PostgreSQL §33 的 guard 描述；`TE-P210-010`（版本归因三分支）与 `TE-P210-017`（Task 身份单变量直 SQL 反例）。
- 第 2 轮同时**更正**第 1 轮关于共享码 `HUMAN_ONLY_CAPABILITY` 的错误表述：共享 API §8 的既有列表确实包含该码，本轮沿用被确认为正确；第 1 轮成立的部分仅是缺少完整 `CapabilityGrant` 到分类输入的映射。审查记录原文保持不改，更正见 [`.vibe/reviews/pr-211/Review.md`](../reviews/pr-211/Review.md) 的第 2 轮。修复后仍需对新的 exact head 重新独立审查；人类设计批准仍未完成。
- **审查轮次 3（2026-09-17）**：第 3 轮复审在 revision `5ca6934597e5a78774882ab31195b66a47bb34e4` 确认前两轮的创建请求投影、`CapabilityGrant.capabilityType` 映射、创建错误码分层、Task 身份闭合与分类版本归因均已实质关闭，仍给出 `REQUEST_CHANGES`，唯一阻断为**创建归属未由 guard 绑定到来源 Receipt/受信 Context**：保留 P1 的合法请求与全部业务身份/Hash、仅把 Snapshot `createdBy` 与 Root 两个 principal id 写成 P2 并重算完整 `payload_hash` 时，mirror、投影、Task 身份与 Receipt 检查仍分别通过。当轮修正为字段间等值闭合与 P1→P2 反例；其把 Receipt creator 当作受信锚的部分在第 4 轮被否决并已重做（见下一条）。
- **审查轮次 4（2026-09-17）**：第 4 轮复审在 revision `a85d74a40f004b2664b0701c323d9563180ccf24` 确认第 3 轮的字段间等值关系与 P1→P2 反例已补齐，但指出该修复把**可由 app 角色伪造的 Receipt creator 列**误当作受信 Context 的数据库证明：`V0002__schema_roles_baseline.sql` 默认给模块 app 角色 `SELECT/INSERT/UPDATE`，`V3000` 的 `command_receipt_insert` policy 只检查 Scope 且该表无 creator guard，所以原表述只证明“多份 caller-writable 数据彼此相等”。本 revision 已修正：受信锚改为 `platform_security.context_principal_id()`（两表 INSERT policy 的 `WITH CHECK` 与 creation guard 直接比较，沿用 EnterpriseProject `V2001`/`V2003` 先例；Receipt 的 creator 被要求等于该 Context 而不是被信任）；`principalKind` 明确声明**当前无数据库可验证来源**，记为依赖实现切片的显式 scope/规划门禁（Spec 003 §18.13），不在本节声称已闭合；`TE-P210-017` 增加“P2 Context 内伪造同 Scope、creator=P1、请求 Hash 自洽的 `PENDING` Receipt”反例与 kind 子项。修复后仍需对新的 exact head 重新独立审查；人类设计批准仍未完成。
- **审查轮次 5 与 scope 决定（2026-09-17）**：第 5 轮在 revision `9b34f07790deffd2df2e32b2b8762a6be62932c4` 确认 principal-id Context 锚已闭合，但因 `principalKind` 仍无数据库可验证来源给出 `SCOPE_EXPANSION`。用户随后明确同意按该意见扩展 scope；本 revision 因此把 RLS 事务上下文决定 §3.5、PostgreSQL §19.2 的平台增量及对应兼容/隔离验收纳入 #210。该决定只解除 scope 门禁，不构成对本次新增 exact design 的独立审查或最终人类设计批准；新的 exact revision 仍须依次经过两项 Gate。
- **审查轮次 6 与人类批准（2026-09-17）**：第 6 轮在 revision `67e5df57db637953009ba21b2193114aec401ce6` 复核 scope-expanded delta，确认 10/11 参数入口兼容、kind 幂等/混用冲突、helper ACL/期限、WorkOrder 完整 PrincipalRef 绑定及迁移/伪造/并发/池复用矩阵闭合，未发现新的 agent-fixable 阻断；因 Issue 要求安全敏感设计的人类判断而给出 `HUMAN_REVIEW_REQUIRED`。用户随后明确“批准更改，合并PR并关闭Issue及local/remote branches”，人类技术门禁据此满足；批准记录见 [Issue #210 评论](https://github.com/qzhike/zhiju-business-core/issues/210#issuecomment-5715698129)。该批准不把未来实现或 `TE-P210-*` 运行时场景改标为已完成。

## 18. TD-01 首次 Context 构建与精确快照读取边界闭合提案（#214）

状态：`T2 / DESIGN APPROVED 2026-09-18（Issue #214；exact design revision `d0d060fbacb98a6e9fdac1d098792a6222de4cff` 经七轮独立审查并获显式人类设计批准，PR #215 已合并，merge commit `a9421ada90408219a83bba2570ee2c00f920b894`；正式记录见 [reviews/pr-215/Review.md](../reviews/pr-215/Review.md)）/ IMPLEMENTED 2026-09-19 BY Issue #216（`V3004`、Spec 001 §15.8 授权 Port、确定性组装、build/read Handler 与组成层；本地/单元/真实 PostgreSQL 证据完成）/ vibe verify full PASS 2026-09-19 / PR #217 CORRECTIONS IMPLEMENTED 2026-09-20（§19 四项修正落地，TE-217-D-001–004 与 TE-214-D 回归 PASS；新 verify full PASS 2026-09-20；第 4 轮两项 finding 亦于 2026-09-21 实现，新 verify full PASS 2026-09-21）/ 新 head 独立复审与 HUMAN TECHNICAL REVIEW PENDING（不声称审查结论或合并）`。本节保留 #214 的历史决策；PR #217 揭示的四项阻断已由 §19 修正实现。权威细节见 [Spec 003 §19](../module-specs/Module-Spec-003-TaskExecution.md#19-首次-context-构建与精确快照读取边界闭合214-设计)、[Spec 001 §15.8](../module-specs/Module-Spec-001-IdentityPolicy.md#158-im06-ctxbuild-01-首次-context-构建与权威快照读取授权组成提案214)、[PostgreSQL §33](../high-level-docs/07-postgresql-logical-model-v0.1.md) 的 #214 增量与 Module-Test 003 `TE-214-D-*` 设计矩阵；这些历史事实不再单独证明当前实现可验收。

### 18.1 对账基线与增量定位

- #212 已交付两个 WorkOrder 创建 Major、不可变 `work_order_draft_snapshot`（`draft_schema_version` CHECK `'1.0'`/`'1.1'`）、版本派生 WorkOrder/Task 拼写、`get_work_order_draft@1.1`/`@2.0` 精确读取、受信 transaction-context PrincipalKind 与 `V3003` guards（PR #213 已合并）。
- `execution.build_initial_context_snapshot@1.0/@1.1` 与 `zhiju.execution.context_snapshot` 已注册（FULL），`execution.get_context_snapshot@1.0` 仍是 `v1.0-baseline` 通用 SnapshotRef Query；#188 交付 Source Slice capture/read、#186 交付 PolicyVersion 精确解析、#179 交付 Context Builder profile 静态校验。
- TaskExecution 仍无初始 Context Handler、权威 Context 读取 Handler、`context_snapshot` 持久化、build metadata、组成入口与运行时测试；§15.6 第 6 条显式留给 TD-01 Context 切片的 `build_initial_context_snapshot@1.1` 授权缺口未关闭。

### 18.2 决定摘要（R-214-1 – R-214-8）

1. **版本绑定（R-214-1）**：`build_initial_context_snapshot@1.1` 是唯一可满足入口，只接受 `create_work_order@1.1` 创建的不可变 DRAFT（`'1.1'` + canonical 拼写 + `DraftVersionPins`）；`@1.0` 无满足输入（Core `VersionPins.contextBuilderPolicyRef` 未钉 namespace 无法满足四点绑定、必带 `projectContextContractRef` 与 #165 方向互斥、legacy 拼写不在初始链），注册保留、逐字节不变、不实现、不建授权路径；禁止别名/`latest`/调用方规范化/借用他版 Receipt 使其变相可用。
2. **身份与读取（R-214-2）**：初始构建只产生 canonical `zhiju.execution.context_snapshot` Project Scope SnapshotRef（六字段全绑定）；`get_context_snapshot@1.0` 分类为**足够、零改动**——通用请求形状覆盖 canonical 新事实与 legacy `zhiju.project.context_snapshot` 历史读回，结果 ref 逐字段相等，不需要 additive 版本，不重写 200 Baseline；Core 03/共享 API 不要求改动；Catalog 06 的唯一变化是 #214 段一行 EP-owned objectType 设计注册（`zhiju.project.enterprise_fact`，计数不变）。
3. **授权组成（R-214-3）**：Spec 001 §15.8 两条互不替代的条目——build @1.1（`execution.context.build.initial.v1_1`、`CREATE_TARGET_TYPE {zhiju.execution.context_snapshot}`、`contextSnapshotBuildV11`）与权威 Snapshot 读（Purpose 复用已发布值 `task.execution.get_context_snapshot`、Grant action `execution.context.snapshot.read` 仅为内部 token、`TARGET_TYPE` 双 objectType 闭集、`contextSnapshotRead`）；@1.0 不建路径、同 Purpose 不跨版本。依赖读取（精确 Draft 读、每片 Slice 读、PolicyVersion 解析、Snapshot 读）各自独立现签；构建能力不隐含依赖读取能力；重验先于幂等 Claim 与历史 Receipt 返回。
4. **确定性组装（R-214-4）**：精确 DRAFT + 非空精确 Slice 集 + 精确 Policy 观测 → ProjectContext v1.0；输入权威为 #188 已发布 Slice 真实形状（`{factRef,factType,riskLevel,status,value}` fact、`{kind,reasonCode}` omission、`{path,reasonCode}` redaction），每个 Slice 成员有确定性去向（Core 槽内映射或 payload provenance + 同事务 metadata/edge 绑定，不静默丢弃）；`slice.purpose == request.purpose` 硬规则（§11.2.1）与 `permittedUses := {request.purpose}` 闭合 Purpose/数据最小化；status/riskLevel 固定映射表进 `epistemicState`/`sensitivity`；`contextItemId` 为确定性 **RFC 9562 UUIDv7**（首 48 bit = 构建 `asOf` 受信 Unix 毫秒，hash 只填 rand 位）；`subjectRef` 为 `factRef` 的规范化 VERSIONED ref（`zhiju.project.enterprise_fact`，objectId/versionId/scope 原样；Slice ref 只留在 provenance）；DRAFT `inputRefs` total canonical comparator 以 `(inputRole, canonical_cv1(ref))` 为键（canonical_cv1 覆盖全部五种 TypedReference variant 身份字段，含 ExternalRef；同键异 metadata → fail closed）、epistemic 按全片 fact 最不可信聚合（零 fact 片带期望 → fail closed）；manifest 公共值相等性、有序并集、coverage 按 `PURPOSE_FORBIDDEN → PARTIAL` 且 required 输入缺失不进入 coverage；`targetScope.targetObjectRefs`（本切片支持集 ∅，非空 fail closed）显式封闭；Schema 有效或内容寻址不等于已授权/可用/适用。
5. **期限（R-214-5）**：§11.2.4/§11.2.5.4 原样沿用；增量为 Builder 持锁提交点以受信当前时间重验 WorkOrder 期限与 effective 期限。
6. **持久化（R-214-6）**：`context_snapshot` 不可变 Contract Record + `context_snapshot_build` INITIAL-only metadata；forward-only migration 编号实现时分配（预期 V3004 之后），不改 `V3000`–`V3003`；mirror/creation-identity/immutable guards、RLS/ACL、`reference_edge` 与回滚边界闭合。
7. **事件（R-214-7）**：已注册 `execution.ContextSnapshotBuilt@1.0` 足够，不新增版本；成功提交恰好一条 Outbox，payload 绑定已提交 canonical ref 与 DRAFT workOrderRef，重放不重复。
8. **并发/幂等/恢复（R-214-8）**：WorkOrder 只读依赖行锁（既定锁序）内重验 DRAFT 状态与当前指针；跨模块观测只经 owning 边界，无分布式事务；幂等/冲突/注入故障整事务回滚沿用 #212 runner 模式。

### 18.3 分类与交付边界

| 产物 | 判定 |
|---|---|
| `build_initial_context_snapshot@1.0/@1.1`、`get_context_snapshot@1.0`、`ContextSnapshotBuilt@1.0` 的注册 Schema/Catalog/兼容元数据 | **零改动**（@1.0 判定无满足输入，冻结不实现；@1.1 走既有注册） |
| 历史 200 项 Compatibility Baseline、Catalog 215、TaskExecution 45 | **不变** |
| Core 03 §3、共享 API | **不要求改动**（Query 分类为足够） |
| Catalog 06 | 一个 **EP-owned objectType 设计注册行**（`zhiju.project.enterprise_fact`，#214 段）；不新增公开 operation，Catalog/Baseline 计数不变；executable 注册随实现 Issue 交付 |
| IdentityPolicy | 一个 owning 内部 Port 的两条条目（Spec 001 §15.8）；无公开 API、无 capability code、无迁移（复用 V1006 target 列） |
| TaskExecution migration | 未来 forward-only，编号实现时分配；不改 `V3000`–`V3003` |

- 本 Delta 只记录 #214 的 durable 设计与历史批准；[Issue #216](https://github.com/qzhike/zhiju-business-core/issues/216) 已于 2026-09-19 按该范围交付实现，其 `vibe verify full --json` 已 PASS（2026-09-19）。PR #217 的独立实现审查在 `bce56af9007e70ee79e46bcc90d49dd0fc5b35f5` 得出 `PLANNING_REQUIRED`；四项修正（§19）已获显式人类设计批准、独立设计复审确认一致性（第 3 轮），并已于 2026-09-20 全部实现（TE-217-D-001–004 与 TE-214-D 回归在真实 PostgreSQL 18.6 PASS）；新 `vibe verify full --json` 已 PASS（2026-09-20）；第 4 轮两项 finding（legacy contract 读/写双侧闭合、测试超时/收束硬化）已于 2026-09-21 实现（TaskExecution 单测 115/115、TE-217-D-001 扩展 9 条篡改负例、套件 22/22 ×3），新 head 的 `vibe verify full --json` 已 PASS（2026-09-21，persistence gate 44/44 files、493/493 tests）；第 5 轮 finding（contract_ref 键集三层闭合 + immutableVersionId 禁止，读/写双侧）已于 2026-09-21 实现（TaskExecution 单测 119/119、TE-217-D-001 再扩展 4 条成员集负例、套件 22/22 ×2 全新库），新 head 的 `vibe verify full --json` 已 PASS（2026-09-21，persistence gate 44/44 files、493/493 tests）；PR #217 新 head 的独立复审与人类技术批准待完成，不声称审查结论或合并。
- #152/#165–#168 与 #188/#212 的历史证据保留不改；`TE-214-D-001`–`018` 已由 #216 在真实 PostgreSQL 18.6 执行（五个无合法事实生产者/写入者/算子的 `NOT RUN` 子分支与四处分层/表面码偏差见 [Module-Test 003](../module-tests/Module-Test-003-TaskExecution.md) 与 [Spec 003 §19.10](../module-specs/Module-Spec-003-TaskExecution.md)）；本节不把 Validation/Freeze、执行、Completion 或 IM-06 报告为已实现。

## 19. PR #217 首次 Context 审查阻断修正提案

状态：`T2 / PROPOSED 2026-09-19 / INDEPENDENT IMPLEMENTATION REVIEW PLANNING_REQUIRED ON bce56af9007e70ee79e46bcc90d49dd0fc5b35f5 / EXPLICIT HUMAN DESIGN APPROVAL RECORDED 2026-09-19 / INDEPENDENT DESIGN REVIEW CONFIRMED CONSISTENCY（PR #217 第 3 轮）/ CORRECTIONS IMPLEMENTED 2026-09-20（TE-217-D-001–004 与 TE-214-D 回归 PASS ON REAL PostgreSQL 18.6）/ vibe verify full PASS 2026-09-20 / ROUND-4 FINDINGS IMPLEMENTED 2026-09-21（legacy contract 双侧闭合 + 测试超时/收束硬化）/ NEW vibe verify full PASS 2026-09-21（persistence gate 44/44 files、493/493 tests）/ ROUND-5 FINDING IMPLEMENTED 2026-09-21（contract_ref 键集闭合 + immutableVersionId 禁止）/ NEW vibe verify full PASS 2026-09-21（persistence gate 44/44 files、493/493 tests）/ PR #217 新 head 独立复审与人类技术审查 PENDING（不声称审查结论或合并）`。正式 finding 见 [`reviews/pr-217/Review.md`](../reviews/pr-217/Review.md)，字段级权威增量见 [Spec 003 §20](../module-specs/Module-Spec-003-TaskExecution.md#20-pr-217-首次-context-实现审查修正-delta提案)、授权见 [Spec 001 §15.9](../module-specs/Module-Spec-001-IdentityPolicy.md#159-im06-ctxbuild-02-draft-snapshot-依赖读取授权修正提案217)、存储见 PostgreSQL §35、验收见 Module-Test 003 `TE-217-D-*`。

### 19.1 决定摘要

1. **Legacy 读回不降级为“永远不存在”**：保留 `get_context_snapshot@1.0` 的双 identity 接受集；canonical 与 legacy 分别路由到独立 owning store，逐字段 exact read，不 alias。legacy store 只接受受控 migration/import 的历史 ProjectContext v1.0 事实，应用无写权限。
2. **DRAFT 当前授权不由“过去拿到过 ref”替代**：不再声称复用 target 为 WorkOrder 的 `workOrderDraftReadV11`；新增 target 为完整 `draftSnapshotRef` 的 owning internal dependency Port，先授权后读事实，build capability 不隐含它。
3. **公开 Event 不写无效 payload**：冻结 `ContextSnapshotBuilt@1.0`，additive 新增 `@1.1`，字段改用已注册的 `ProjectionType`/`CoverageCompleteness`，payload 不复制 Enterprise/Project；修正路径只发布 `@1.1`。
4. **Slice 顺序必须可执行**：ContentAddressedRef 使用 objectType/objectId 优先、完整内容地址与 Scope 收尾的显式 tuple；full-ref canonicalization 只能用于 exact 比较/tiebreak 断言，不能让 contentHash 抢在 objectId 前排序。UUIDv7 摘要使用实际存在的 `sliceRef.objectId`。

### 19.2 分类与边界

- additive Event 使 Catalog 215→216、TaskExecution 45→46；历史 200 项 Compatibility Baseline 与 `ContextSnapshotBuilt@1.0` 接受集不变。
- 不新增公开 build/query 版本，不改变 Core ProjectContext v1.0，不修改 `V3000`–`V3003`；PR #217 的未合并 `V3004` 可在获批后按 PostgreSQL §35 收敛。
- 本提案不授权 merge。独立设计复审已确认一致性（PR #217 第 3 轮），四项修正已于 2026-09-20 实现并在真实 PostgreSQL 18.6 取证（TE-217-D-001–004 与 TE-214-D 回归 PASS）；第 4 轮两项 finding 亦于 2026-09-21 实现（legacy contract 读/写双侧闭合、测试超时/收束硬化；TaskExecution 单测 115/115、套件 22/22 ×3），新 head 的 `vibe verify full --json` 已 PASS（2026-09-21）；修复后的新 head 必须重新独立审查和人类技术审查，`vibe verify full --json` 已 PASS（2026-09-20）。

### 19.3 批准记录

**批准记录：2026-09-19，用户在本任务会话明确回复“批准文档的更改，单独将本轮订正的文档commit and push，完成后复审PR217”。** 批准对象是 §19 与其链接的 Spec 003 §20、Spec 001 §15.9、Contract Catalog #217、PostgreSQL §35、`TE-217-D-*` 及路线图状态修正；授权范围仅包含这些文档的单独 commit/push 与随后对 PR #217 的复审，不包含产品代码或 migration 修复，也不授权 merge。
