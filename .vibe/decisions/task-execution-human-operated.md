# IM-06 Human-operated 执行边界与设计提案

日期：2026-09-07
状态：`PROPOSED / HUMAN DESIGN REVIEW REQUIRED`。本文记录待决设计及理由，不批准 API 变更，不宣称实现存在。推进顺序见 [roadmap](../product/roadmap.md)。

## 1. 分类与既有边界

IM-06 按 T2 规划：涉及安全绑定、不可变 Contract、数据库并发 Claim、跨 Aggregate 恢复和 Completion。既有设计仍以 [HL-Spec §5](../high-level-docs/HL-Spec.md)、[架构 §20.7](../high-level-docs/02-zhiju-core-architecture.md)、[Core Contracts §3–5](../high-level-docs/03-core-contracts.md)、[Domain §18–22](../high-level-docs/04-domain-model-v0.1.md)、[Module Spec/Test 003](../module-specs/Module-Spec-003-TaskExecution.md) 为准。

目标是由 Human 发起并审阅、由 owning Service 执行的可重复 Core 流程。Human 不直接拼写可信 AgentResult，不通过布尔值完成 Task/WorkOrder；确定性测试 Driver 的结果只提供合成技术证据。真实 CLI、Provider、飞书收答与 Workspace UI 分别保留在既有后续里程碑。

TaskExecution 当前业务入口仍为 `SKELETON`；已有 37 项字段级操作（19 Command、7 Query、11 Event）与 V3000 技术表，不等于业务 Handler、业务表或完成闭环已经存在。EnterpriseProject 的 TaskCompleted 消费能力可作为后续衔接点，不能以其合成事件测试替代真实 TaskExecution Producer。

## 2. 首次 Context 与冻结 Contract 的构建顺序

**缺口。** Module Spec §2 的 `ContextBuildRequest.workOrderContractRef` 必填且为 Content-addressed Ref；Core WorkOrder §4.3 又要求 `contextSnapshotRef`，§4.13 要求引用有效。当前材料没有定义首个 Context/Contract 如何在无历史 Snapshot 时建立，也没有定义“预分配 ID”如何满足内容 Hash 与存在性校验。Retry 另有明确约束：新 Context/Run 不能改写旧冻结 Contract。

**建议。** 将首次构建与冻结后构建分开建模：首次从已持久化 DRAFT WorkOrder 的精确版本/Hash、裁剪 Source Slice 与 Builder Policy 构建 Context；冻结命令再绑定该 Context。冻结后构建继续要求原精确 Contract，新的 Run 独立绑定新 Context。首次请求必须在发布 Snapshot 前校验 DRAFT 版本未变化，禁止 dangling ref、占位 Hash 和 latest。

**Spec Delta。** 审核时给出 `ContextBuildRequest` 的版本化首次构建分支及 DRAFT 输入引用类型，保留现有 `@1.0` 的合法调用；同步 Core §3/4、Module Spec/Test 003、API 兼容规则、可执行 Schema 与 §07 持久化绑定。具体字段和版本尚未批准；不直接把必填字段改为可选。不新增业务模块或跨 Schema 外键。

**替代方案与代价。** 仅允许调用者提供预先存在的 Context，无法证明空业务库的首个流程可操作；一次事务创建两个独立 Aggregate 违背单 Aggregate 事务边界；预写不完整冻结 Contract 违背不可变性。建议方案需要明确 API 兼容和 DRAFT CAS，但能独立审计首次构建与后续 Retry。

**验收。** 空业务库经正常 owning 入口完成首个 Context→冻结；DRAFT 竞态、错 Hash/Scope/Purpose 或不存在输入均拒绝且不留下可执行 Snapshot；回答后 Context-2 与 Run-2 引用新输入，WorkOrder Contract、Context-1 和 Run-1 的 Hash 不变。

## 3. Human-operated Driver 与 Runtime 控制缺口

**既有约束。** Domain §20.9 把 Run 创建、Result 接收和验证分配给 Dispatcher/Ingestion/Validator Service；`start_run` 要求 RuntimeAttempt、lease 与 fencing，不能用 Human 身份或内存伪造引用代替。Runtime 专项 §15.1 的六个新增 Command 仍是 IM-DG-006 的待审提案，不因 IM-06 启动自动进入 Catalog。

**建议。** 使用受控、确定性的测试 Driver，经 IntegrationGateway Port 产生可验证的 Attempt，再由受信 Service 调用已有 owning Command。Human 只发起授权操作和回答/采纳资料。Identity、Attempt、Run、Result 的 Scope/Hash/来源链均需读回；测试替身必须明示 `SYNTHETIC / TECHNICAL ONLY`，不声称真实 Provider Usage。

**本阶段限制。** Cancel request 只证明进入 CANCELLING 及竞态隔离，不声称收到 Cancel ACK；同 Run Resume、Heartbeat、独立 Runtime Usage 写入与真实 Runtime fallback 不提前进入本阶段。Usage 缺失用 UNKNOWN/UNAVAILABLE，Agent 声明独立保留。final BLOCKED_INPUT 可走已有 Result Acceptance 后的新 Run Retry。

**仍须在实现前补齐的设计。** owning Process 如何从已提交 Acceptance 事实推进 Run terminal 状态、释放 active claim；哪些已批准入口驱动 timeout/late-result 测试；可信 RuntimeAttempt 的持久化读取边界。不得直接写表构造集成成功，也不得用私有跨模块写入口绕开缺失 API。若这些目标必须依赖新增公开操作，应单独提交 Spec Delta 和用户决策，再评估 IM-DG-006 的适用范围。

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

第 2–4 节为待审方案；获决定后先在 owning 规格与失败场景落定，再发布依赖它们的实现 Issue。第 5 节可独立作为首批 NOW + READY 候选，不把未决业务设计传给 Implementer。

最终可审阅产出应同时展示正常完成与 final BLOCKED_INPUT 恢复链，保留精确 Ref/Hash、Actor/Decision、Context、Attempt、Result Acceptance、分层 Completion、Usage 来源、命令输入和预期/实际结果。适用既有 TE-U-001–005、TE-E-003、TE-API-U-001–003、TE-API-C-001/002 与 TE-API-M-001，并增加上面首次构建及伪造判断引用的失败场景。

受控答案恢复证据单独列示；含真实飞书的 TE-E-001/TE-API-E-001、真实 Runtime 的 TE-E-002/TE-API-E-002、公开 HTTP、生产和独立人工业务验收，未执行时继续 `NOT RUN`。不把本规划中的预期输出写成测试 PASS。
