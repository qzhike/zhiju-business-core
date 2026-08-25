# Zhiju Business Core 验证基准

版本：v0.1
日期：2026-08-17
状态：`CURRENT VERIFICATION BASELINE / IM-00 COMPLETE / IM-01 COMPLETE / IM-02 TECHNICAL BASELINE COMPLETE / IM-03 WI-01 DESIGN DECISION RECORDED / USER REVIEW REQUIRED`

文档角色：统一定义设计、实现、集成和人工验收的验证口径，并集中保存跨模块验收场景。领域专属基准场景继续靠近其唯一权威设计；从字段级 API 阶段起，每个逻辑模块维护独立 `Module-Test-[ID]-[ModuleName].md`，记录模块 Unit/Contract/E2E/Manual 用例和真实结果，本文负责总索引、跨模块覆盖和结果真实性。

---

## 1. 验证结果的含义

| 标签 | 含义 |
|---|---|
| `DESIGN VERIFIED` | 文档结构、术语、引用和设计不变量静态一致；不代表实现存在 |
| `NOT RUN` | 用例已定义，但尚未执行 |
| `PASS` | 本次确实执行，实际输出与预期一致，并有命令/日志/人工记录证据 |
| `FAIL` | 本次确实执行，实际输出与预期不一致 |
| `BLOCKED` | 外部权限、环境或未决产品选择阻止执行，且已说明阻塞条件 |
| `NOT APPLICABLE` | 经明确理由确认不适用于当前范围，不得用来掩盖未执行 |

禁止：

- 把文档中存在测试表写成“测试通过”；
- 把静态检索写成运行时权限、事务或 RLS 验证；
- 把 Mock Adapter 通过写成真实飞书/Runtime/Renderer 通过；
- 把某个 Run 成功写成 WorkOrder、Task、DeliveryItem 或 Release 完成；
- 把未执行的 macOS/生产数据库/外部 Provider/人工业务验收省略不报。

---

## 2. 验证层级

### 2.1 文档与 Contract 静态 Gate

检查：文档入口、唯一权威、术语、编号、链接、模块所有权、Catalog 唯一性、Contract 兼容、Hash 自引用、状态和测试清单。结果只能是 `DESIGN VERIFIED`。

### 2.2 Unit

针对 Aggregate、Value Object、状态机、Invariant、Evaluator、Canonicalization、Reference Validation、Authorization 和纯映射逻辑。应覆盖成功与拒绝路径。

### 2.3 Contract

针对：

- Command/Query/Event Schema 与 Major/Minor 兼容；
- Canonical Payload 和跨语言 Hash Fixture；
- Typed Reference 强度、Scope、Hash、Lifecycle、Authorization、Purpose；
- Project Context、WorkOrder、AgentResult、RAS/ABS/RRS；
- 飞书/Runtime/Renderer Adapter 与 Core Contract 的 Anti-Corruption 映射。

### 2.4 Persistence/Integration

使用真实 PostgreSQL 行为验证：Migration、Constraint、RLS、Role、CAS、Lease/Fencing、Outbox/Inbox、JSONB/Hash、对象存储 Link、Replay 和并发。仅用内存 Repository 不能完成该 Gate。

### 2.5 E2E

从公开 Application Capability 驱动完整流程，不能直接写数据库制造中间状态。必须验证 Human/Agent 权限、真实状态层级和最终 Traceability。

### 2.6 External/Manual

真实飞书双向消息/文件/卡片、真实 Runtime 调度、Renderer 文件可用性、对象存储权限、人工质量审查、备份恢复和运营故障处理分别记录。它们不能被离线测试代替。

---

## 3. 设计场景总索引

| 场景集 | 唯一位置 | 数量 | 当前实际状态 |
|---|---|---:|---|
| Domain Aggregate 场景 | [`04-domain-model-v0.1.md`](./04-domain-model-v0.1.md) | 105 | `NOT RUN` |
| Cross-Aggregate 场景 | [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](./05-cross-aggregate-consistency-module-boundary-v0.1.md) | 17 | `NOT RUN` |
| Core Contract 场景 | [`03-core-contracts.md`](./03-core-contracts.md) | 20 | `NOT RUN` |
| Typed Reference/Envelope 场景 | [`06-typed-references-contract-catalog-v0.1.md`](./06-typed-references-contract-catalog-v0.1.md) | 12 | `NOT RUN` |
| PostgreSQL Logical Model 场景 | [`07-postgresql-logical-model-v0.1.md`](./07-postgresql-logical-model-v0.1.md) | 24 | `NOT RUN` |
| 跨模块验收场景 | 本文第 5 节 | 57 | `NOT RUN` |
| API Module Test 场景 | [七份 Module Test](../module-tests/) | 63 | 7 个 Design Gate `DESIGN VERIFIED`；其余 56 个 `NOT RUN` |
| Feishu Channel 专项场景 | [`Feishu-Channel-Test-v0.1.md`](../feishu-channel-contract-v0.1/Feishu-Channel-Test-v0.1.md) | 32 | 4 个 Design Gate `DESIGN VERIFIED`；其余 28 个 `NOT RUN`；用户已指示进入下一阶段 |
| Runtime Adapter 专项场景 | [`Runtime-Adapter-Test-v0.1.md`](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md) | 32 | 4 个 Design Gate `DESIGN VERIFIED`；其余 28 个 `NOT RUN`；用户已指示进入实施计划阶段 |
| 合计 |  | 362 | 尚未实现；静态设计检查不代表运行测试 |

数量用于发现遗漏，不代表覆盖率或通过率。后续实现可以拆分出更多测试，但不得删除业务语义等价的失败路径。

---

## 4. 基准完整性 Gate

| ID | 检查 | 通过条件 |
|---|---|---|
| V-DOC-001 | 文档集合 | `.vibe/high-level-docs/` 仍只包含一个入口 `HL-Spec` 和 `01`—`08` 八份专题高层基准，共九份；阶段文档位于明确的 API、Feishu、Runtime、Module Spec/Test 目录 |
| V-DOC-002 | Agent 入口 | `HL-Spec` 明确阅读路由、冻结规则、状态口径、变更纪律和下一阶段 |
| V-DOC-003 | 唯一权威 | 每份基准声明权威范围；同一模块职责不由第二份文档维护 |
| V-DOC-004 | 模块边界 | 七模块在架构基准中都有职责、所有权、非职责、端口类别、依赖、持久化边界和验收锚点 |
| V-DOC-005 | 无循环写依赖 | 每个公开写 Command 只有一个 Owner；无共享 Repository、跨 Schema 写或跨模块业务外键 |
| V-DOC-006 | Domain 完整性 | Aggregate、Entity、状态、Command、Event、Invariant、权限和失败场景可定位 |
| V-DOC-007 | Contract 完整性 | 四个 Core Contract、Typed Reference、Envelope、兼容性和 Canonical Hash 规则可定位且无自引用 Hash |
| V-DOC-008 | Catalog 唯一性 | 200 个公开 Contract 名称全局唯一，namespace 与模块 Owner 一致 |
| V-DOC-009 | 持久化边界 | 七个权威 Schema + Projection；关系/JSONB/对象存储；RLS/Role；Outbox/Inbox 均只有一个权威定义 |
| V-DOC-010 | Human/Agent 边界 | Agent/actingFor 不可 Approval 或 Release Authorization；Human 不能绕过 Mandatory Gate |
| V-DOC-011 | 状态层级 | Run、WorkOrder、Task、DeliveryItem、Revision、Approval、Release、Effective 不相互冒充 |
| V-DOC-012 | 飞书边界 | MVP 完整双向；消息/附件/卡片不直接成为业务完成、Approval 或 Formal Release |
| V-DOC-013 | QM 弃用 | QM 只可作为明确弃用说明出现，不得成为 Runtime、Adapter、Scope、Task 或依赖 |
| V-DOC-014 | 链接与格式 | Markdown 链接可达、代码块闭合、编号唯一、无冲突标记或过期状态 |
| V-DOC-015 | 状态真实性 | 所有未执行实现/外部/人工用例保持 `NOT RUN`，不得因静态审计改为 PASS |
| V-DOC-016 | Module 文档集合 | 七个逻辑模块各有且只有一份 `Module-Spec` 和一份 `Module-Test`，ID/ModuleName 一致；测试文档含 Unit、Contract、E2E、Manual 的输入、预期、实际和结果 |
| V-DOC-017 | API Catalog 覆盖 | `06` 的 200 个公开 `name@1.0` 在七份 Module Spec 中各出现一次，集合差异为零，namespace 与 Owner 一致 |
| V-DOC-018 | API 字段完整性 | 每个 Command 有 target/mode、payload、authorization/拒绝语义；每个 Query 有 payload/result/consistency；每个 Event 有最小已发生事实 payload |
| V-DOC-019 | API 安全边界 | Agent/actingFor 不能 Approval/Release Authorization；Sensitive External ID 不进入 Event/普通错误；latest/workspace/session/message 不冒充强引用 |
| V-DOC-020 | API 文档链接 | HL、共享 API、七份 Module Spec 与七份 Module Test 的相对链接可达，无冲突标记或未闭合代码块 |
| V-DOC-021 | Feishu Channel 文档集合 | 专项 Contract、Test、Task Plan、Verification Report 各一份，均位于 `feishu-channel-contract-v0.1/` 并由 HL 与 IntegrationGateway Spec/Test 路由 |
| V-DOC-022 | 飞书协议映射 | 允许的飞书事件/API、外部幂等键、原始字段、Core API 目标和未知协议处置均明确，且不新增业务 Owner |
| V-DOC-023 | 飞书安全边界 | Webhook/长连接认证边界、身份映射、最小权限、敏感标识、卡片 nonce、附件 Staging 和 Credential 禁存规则明确 |
| V-DOC-024 | 飞书业务边界 | 普通消息/附件/卡片/发送回执不冒充 Fact、Answer、Approval、Release、Task Completion 或 EffectiveBinding |
| V-DOC-025 | Runtime Adapter 文档集合 | 专项 Contract、Test、Task Plan、Verification Report 各一份，位于 `runtime-adapter-contract-v0.1/` 并由 HL、TaskExecution/IntegrationGateway Spec/Test 路由 |
| V-DOC-026 | Runtime 映射 | Execution Package、Dispatch、Event、Result、Usage、Cancel、Resume/Retry 与现有 Core API 目标明确，不新增业务 Owner |
| V-DOC-027 | Runtime 安全边界 | 单 Run Capability、Workspace/Sandbox、Secret、Network/Tool、Lease/Fencing、late result、Chain of Thought 禁存规则明确 |
| V-DOC-028 | Runtime API proposal 隔离 | 6 个 additive Command 在审核前不进入 200 项 Catalog/Module 基准，也不允许实现绕过 public port 直写 Repository |
| V-DOC-029 | Implementation Plan 文档集合 | Milestone Plan、Technology Baseline、Deployment/Security Baseline、Task Plan、Verification Report 各一份，位于 `implementation-milestone-plan-v0.1/` 并由 HL 路由 |
| V-DOC-030 | Implementation 决策隔离 | 10 个里程碑与 6 个决策 Gate 可定位；未选技术栈、物理参数和 Runtime proposal 不得在代码中被静默事实化 |
| V-DOC-031 | 私有化部署与认证边界 | Ubuntu 单机明确非 HA；MicroCeph/OpenBao/Keycloak 责任分离；Authentication 不冒充 IdentityPolicy Authorization；Fake 不完成 Conformance Gate |

---

## 5. 跨模块验收场景

这些场景用于保证模块实现不会只满足局部 happy path。实际实现时可以拆成多个测试，但场景 ID 和业务预期应保持可追溯。

### 5.1 IdentityPolicy

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| IP-U-001 | Unit | Agent actingFor 质量负责人请求 Approval Capability | 拒绝 Human-only Capability | NOT RUN |
| IP-U-002 | Unit | Project A 用户读取 Project B | 拒绝跨 Project/Enterprise 访问 | NOT RUN |
| IP-U-003 | Unit | 相同外部身份映射到冲突 Principal | 进入冲突处理，不按最后写入覆盖 | NOT RUN |
| IP-U-004 | Unit | Agent ActorSnapshot 携带 actingFor Human 并请求 Human-only Capability | 保留 AGENT 身份并拒绝，不按 actingFor 提权 | NOT RUN |
| IP-U-005 | Unit | 同 Provider/Account/ExternalId 的加密值重复登记 | Lookup Hash 唯一约束阻止第二个有效映射 | NOT RUN |
| IP-E-001 | E2E | 已绑定飞书用户发起 Task 后执行授权检查 | 映射真实 HumanPrincipal，Command 保存 Authorization Context | NOT RUN |
| IP-E-002 | E2E | Human 角色被撤销后查看历史 Approval | 新命令被拒绝，历史角色快照和 Approval 保留 | NOT RUN |
| IP-E-003 | E2E | Enterprise A 数据库上下文读取 Enterprise B AuthorizationDecision | RLS/Scope 拒绝，不泄漏跨企业数据 | NOT RUN |

追加覆盖：角色并发、授权过期、Capability Secret 泄漏防护、break-glass 审计和 Enterprise 隔离。

### 5.2 EnterpriseProject

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| EP-U-001 | Unit | 未收到培训程序，Agent 请求 `MISSING_CONFIRMED` | 拒绝，保持 UNKNOWN/NOT_PROVIDED | NOT RUN |
| EP-U-002 | Unit | 未批准 DeliveryPlan 请求激活 | 拒绝 Human Approval Requirement | NOT RUN |
| EP-U-003 | Unit | 直接设置 DeliveryItem COMPLETED | 拒绝，Completion 必须派生 | NOT RUN |
| EP-U-004 | Unit | Context Builder 收到 `latest` Baseline 或 aggregateVersion 作为业务版本 | 拒绝并要求精确 VersionedRef | NOT RUN |
| EP-U-005 | Unit | Project enterprise_id 与 BaselineVersion Scope 不一致 | 组合约束/写入验证拒绝 | NOT RUN |
| EP-E-001 | E2E | 采购程序材料进入系统直到 DeliveryItemActivated | 每一步保留版本、Human 决定与输入快照 | NOT RUN |
| EP-E-002 | E2E | DeliveryItem 所需 ReleaseCompleted 到达 | 精确 Criteria 满足才产生 CompletionSatisfied | NOT RUN |
| EP-E-003 | E2E | 已激活 CB-003 后创建 CB-004 | 新版本和当前指针更新；旧 Context 仍解析 CB-003 | NOT RUN |

追加覆盖：Baseline 并发激活、Impact Replay、跨项目引用、消息撤回与材料保留 Policy。

### 5.3 TaskExecution

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| TE-U-001 | Unit | READY WorkOrder 请求扩 Scope | 拒绝并要求新 WorkOrder | NOT RUN |
| TE-U-002 | Unit | 两个 Dispatcher 竞争 active Run | 仅一个 Lease/fencing token 有效 | NOT RUN |
| TE-U-003 | Unit | Terminal Run 接收不同的第二个 final Result | 拒绝并隔离 Replay | NOT RUN |
| TE-U-004 | Unit | READY WorkOrder 的 specificationHash 不匹配 | 拒绝执行，不物化 Runtime Prompt | NOT RUN |
| TE-U-005 | Unit | 两事务同时创建同 WorkOrder active Run Claim | 唯一 Claim 只允许一个成功 | NOT RUN |
| TE-E-001 | E2E | final BLOCKED_INPUT 经飞书回答 | 新 ContextSnapshot、新 Run；旧 Run 不恢复 | NOT RUN |
| TE-E-002 | E2E | Runtime timeout 后执行 Policy fallback | 新 Run/Adapter；旧 Run 和 Usage 不变 | NOT RUN |
| TE-E-003 | E2E | 同 Run 重放相同 Hash 后再提交不同 Hash AgentResult | 相同 Hash 返回原记录；不同 Hash 进入冲突审计 | NOT RUN |

追加覆盖：取消竞态、late result、Budget、Lease 过期、Capability handle 过期和 Provider Usage 缺失。

### 5.4 Artifact

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| AF-U-001 | Unit | 修改 SEALED Revision | 拒绝 Revision Immutable | NOT RUN |
| AF-U-002 | Unit | 不同 Artifact Revision 作为 Parent | 拒绝 Cross-Artifact Parent | NOT RUN |
| AF-U-003 | Unit | 两个 Release 竞争同 Purpose EffectiveBinding | 仅 expectedVersion 成功者建立 Binding | NOT RUN |
| AF-U-004 | Unit | ContentAddressed RevisionRef ID 正确但 Hash 错 | 拒绝，不能读取当前内容替代 | NOT RUN |
| AF-U-005 | Unit | SEALED Revision 对象 Key 不变但请求修改 Content Hash | 不可变保护拒绝，必须创建新 Revision | NOT RUN |
| AF-E-001 | E2E | 两个 Agent 从同 Head 并行修订 | 形成 Branch，不 last-write-wins | NOT RUN |
| AF-E-002 | E2E | 已 Release 旧版本后创建新 Draft | 旧 Approval、Release、EffectiveBinding 均不变 | NOT RUN |
| AF-E-003 | E2E | 两事务以同 expected Head 移动 Branch | 一个 CAS 成功，另一个形成可解释冲突 | NOT RUN |

追加覆盖：Canonical Hash、Merge DAG、Representation 校验、有效期排他约束、归档和对象保留。

### 5.5 QualityGovernance

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| QG-U-001 | Unit | FAIL GateResult 请求改 PASS | 拒绝，要求新 Result | NOT RUN |
| QG-U-002 | Unit | 作者验证自己的修复且 Policy 要求分离 | 拒绝职责分离冲突 | NOT RUN |
| QG-U-003 | Unit | Agent actingFor Approver 提交 Approval | 永久拒绝 | NOT RUN |
| QG-U-004 | Unit | RevisionAcceptanceSnapshot 混入 Release Readiness Render Gate | 拒绝 evaluationStage 不匹配 | NOT RUN |
| QG-U-005 | Unit | 更新既有 GateResult outcome 或 targetHash | 不可变保护拒绝；重跑插入新 Result | NOT RUN |
| QG-E-001 | E2E | REV-002 FAIL 后 REV-003 修复 | Issue 历史保留，新 Gate/Verification 绑定 REV-003 | NOT RUN |
| QG-E-002 | E2E | 已批准 Revision 的 Evidence 撤销 | Approval Readiness 丢失并触发 Release Impact | NOT RUN |
| QG-E-003 | E2E | Agent Snapshot 伪带 Human Ref 写 Approval Decision | Identity/Auth/Human-only 组合校验拒绝并审计 | NOT RUN |

追加覆盖：Gate DAG、ChangeImpact 复用、多角色/多级 Approval、Request 过期、Profile 版本迁移和上游失效传播。

### 5.6 ReleasePublication

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| RPUB-U-001 | Unit | 未 fully approved Revision 请求 Authorize | 拒绝 Release Not Ready | NOT RUN |
| RPUB-U-002 | Unit | PREPARED 后替换收件人或文件 | 拒绝 Package Frozen | NOT RUN |
| RPUB-U-003 | Unit | 相同幂等键返回不同 packageHash Receipt | 拒绝并记录冲突 | NOT RUN |
| RPUB-U-004 | Unit | Revision 已批准但冻结 Package 无精确 Render Gate PASS | Release 不能 Authorize | NOT RUN |
| RPUB-U-005 | Unit | RRS packageHash 与冻结 Package 不同 | 拒绝 Authorize，Readiness 视为 STALE | NOT RUN |
| RPUB-U-006 | Unit | PREPARED Package 更新 Destination 或 packageHash | 不可变保护拒绝，要求新 Release | NOT RUN |
| RPUB-E-001 | E2E | 两个 Destination 一成功一失败 | PARTIALLY_RELEASED，逐项记录，失败项可重试 | NOT RUN |
| RPUB-E-002 | E2E | 发布后 Approval 撤销 | Receipt 保留，触发 Impact/Recall Review | NOT RUN |
| RPUB-E-003 | E2E | 相同 Destination/Package/Receipt Hash 回调重放 | 只形成一个 Formal PublicationReceipt | NOT RUN |

追加覆盖：Timeout UNKNOWN、Receipt 补记、Recall 通知、Destination 权限、有效日期和部分成功人工介入。

### 5.7 IntegrationGateway

| ID | 类型 | 输入 | 预期输出 | 当前实际输出 |
|---|---|---|---|---|
| IG-U-001 | Unit | 相同 external eventId/相同 Hash 重复入站 | 幂等返回原处理结果 | NOT RUN |
| IG-U-002 | Unit | 相同 eventId/不同 Hash | 隔离并记录安全异常 | NOT RUN |
| IG-U-003 | Unit | 未绑定飞书用户提交 Approval 卡片 | 拒绝，不调用 Approval Command | NOT RUN |
| IG-U-004 | Unit | 外部事件携带未知 Contract Major | Quarantine，不猜测字段或写业务状态 | NOT RUN |
| IG-U-005 | Unit | 同 externalEventId/不同 Hash 并发写入 | 首个 Envelope 保留，冲突进 Quarantine | NOT RUN |
| IG-E-001 | E2E | InformationRequest 发出、回答、重复回调 | 双向闭环且只形成一个 AnswerSubmission | NOT RUN |
| IG-E-002 | E2E | 正式 REL-801 发布与普通文件发送对比 | 只有正式路径生成 PublicationReceipt | NOT RUN |
| IG-E-003 | E2E | Outbound Attempt 提交后进程崩溃并重放 | 复用稳定幂等键，不重复不可控副作用 | NOT RUN |

追加覆盖：消息撤回、群解散、用户离职、Channel Timeout UNKNOWN、Runtime late result、Renderer Hash 和 Adapter Credential 泄漏防护。

---

## 6. Reference Project E2E Gate

采购控制程序是 MVP 的纵向验收主线：

```text
Feishu SourceMaterial
    → CustomerMaterial / CustomerBaseline
    → GapAnalysis / Human-approved DeliveryItem
    → Task / frozen WorkOrder / Run
    → InformationRequest / authorized Feishu Answer / new Context / new Run
    → immutable ArtifactRevision
    → Gate FAIL / ReviewIssue / fixed Revision / independent Verification
    → Human Approval
    → Frozen Release Package / Release Readiness
    → Feishu PublicationAttempt / Raw Receipt / Formal Receipt
    → DeliveryItem Completion Evaluation
    → INTERNAL_EFFECTIVE_USE remains unchanged by default
```

E2E 通过必须同时证明：

- 每一步通过公开 Capability/Command，不直接写库；
- 每个对象 Enterprise/Project Scope 一致；
- CTX → WO → Run → AgentResult → Revision → RAS → ABS → Package → RRS → Receipt Hash 链完整；
- 重放、超时、部分失败和上游撤销不会破坏历史；
- Agent 没有完成 Human Approval/Release Authorization；
- 飞书消息和文件没有成为第二套业务 Source of Truth；
- Projection 延迟时权威 Query 仍返回正确结果。

---

## 7. 实施阶段强制 Gate

### 7.1 每次变更

1. 受影响基准文档已同步；
2. 新/变更失败场景先被记录；
3. Focused Unit/Contract/Persistence Test 通过；
4. 相关 E2E 回归通过；
5. 全项目格式、静态分析、类型检查和测试通过；
6. `git diff --check` 通过；
7. 未运行的外部/人工项明确报告；
8. 只修改请求范围内文件；
9. 用户确认后才提交。

### 7.2 Database/Migration

除第 7.1 节外，还必须验证：

- 空库迁移、已存在数据升级和回滚/前滚策略；
- 每个 Schema Role 的最小权限与跨 Schema 拒绝；
- RLS 正向、横向越权、无 Context、伪造 Context 和 Background Consumer；
- immutable table UPDATE/DELETE 拒绝；
- expectedVersion、active Claim、排他有效期和幂等并发；
- Outbox/Inbox crash/replay；
- JSONB 提升列与 Canonical Payload/Hash 一致；
- 对象 Staging/Link/Orphan Cleanup 和 Legal Hold；
- 真实 Query Plan 和数据量基准后再决定索引/分区。

### 7.3 Channel/Runtime/Renderer

必须分别验证：

- 真实飞书身份映射、项目群/话题绑定、消息/文件、卡片回调、撤回、重复和权限失败；
- Runtime Dispatch、Cancel/Resume、BLOCKED_INPUT、late result、Usage/Provenance 和 Adapter fallback；
- Renderer 输入 Hash、Renderer Version、输出 Checksum、可打开性、版式人工检查和 Release Package 绑定；
- 外部 Timeout 维持 UNKNOWN；
- 普通附件发送不产生 Formal Release Receipt。

---

## 8. 结果记录格式

每次真实执行后，在任务报告或未来测试报告中记录：

```text
Test/Scenario ID
scope and environment
input / fixture / exact version
expected output
actual output
PASS / FAIL / BLOCKED / NOT RUN
command or manual evidence
timestamp
remaining risk
```

不要把运行日志永久复制进架构基准。长期自动验证应落入代码仓库测试和 CI；人工验收应形成明确、精简、可重复的验收记录。

---

## 9. 当前状态

截至 2026-08-21（Issue #9 退出 Gate）：

- 高层设计基准已由用户审核通过；字段级 API Contract、七份 Module Spec 与七份 Module Test 已完成本轮静态 `DESIGN VERIFIED`，并由用户于 2026-08-13 审核通过；
- 本文中的 235 个实现前业务/外部场景仍主要为 `NOT RUN`（不得用 IM-01 静态证据冒充）；
- API Module Test、Feishu Channel、Runtime Adapter 的 Design Gate 仍为 `DESIGN VERIFIED`，其 Unit/Contract/E2E/Manual 运行时项保持 `NOT RUN`；
- IM-00 已完成；IM-DG-001 至 IM-DG-004 已冻结；IM-DG-005/006 仍为 `USER DECISION REQUIRED`；
- IM-01 已 `COMPLETE`：干净 checkout 下 `pnpm install --frozen-lockfile`、`pnpm clean`、`pnpm verify` 全过；
- 当前仓库自动验证为 `pnpm test` 的 `Test Files 20 passed / 10 skipped`、`Tests 341 passed / 164 skipped`；`pnpm verify` 的 persistence gate 为 `12` 个测试文件、`177` 个测试通过；架构边界 `source_roots=10`；
- Registry 精确为 `FULL:200 / ENVELOPE_ONLY:0`，分类为 Command=95、Query=44、Event=61；Catalog/Module Spec/Registry 集合 diff=0；
- 200 payload + 44 query result + 6 Core Contract 的 Schema-derived Type 与 v1.0 compatibility baseline 已接入 `contracts:check`；
- 架构禁止依赖负向探针与 compatibility breaking 负向 fixtures 均实际失败（拒绝非法变更）；
- #1–#4、#6–#8 已关闭并合入；#5 字段 Schema 由 PR #14 完成，duplicate/late Runtime 由已关闭的 #15 完成，其余 Runtime 分别由 #22–#24 追踪；#17 的本地 IntegrationGateway Runtime 切片已落地，Handler/Adapter/DB/外部验收改由 #27 追踪；
- 2026-08-21 用户先批准修订 Issue #9 的 Schema 退出硬依赖，随后批准将 #5 收敛为字段 Schema 边界；关闭 #5 不会把 #22–#24 或 #27 的 Runtime/外部验收改写为 `PASS`；
- 尚无 IM-03 EnterpriseProject 业务 DDL、Repository、业务 Handler、飞书 Adapter、Runtime Adapter 或 Renderer 实现；IM-02 标准事务技术表已落地并有独立验证，但不能写成 IM-03 业务实现 `PASS`；
- 尚无 IM-03 业务 PostgreSQL 事务链、飞书、Runtime、Renderer、对象存储、负载、备份恢复或人工质量验收结果；IM-02 技术表的 PostgreSQL/Flyway persistence gate 已通过，但不等于业务链完成；
- 正式 `IM-01 COMPLETE` 已由 PR #20 原子更新（证据见 [Issue #9 Verification Report](../im-01-exit-gate-issue-9/Verification-Report.md)）；IM-02 已完成技术基础和文档收口，PR #51–#55 已合入，Issue #28 已关闭；真实业务 Handler、外部系统和人工验收仍未完成。IM-03 当前处于 WI-01 设计决策审阅阶段。

## 10. IM-03 WI-01 设计验证边界

Issue #57 的决策矩阵提供了 Product/QMS/Profile/Platform Reference 的唯一 Owner、受控入口、授权目的、精确版本/Hash 语义、失败码和手测示例。该矩阵可标记为 `DESIGN VERIFIED`，但以下项目仍为 `NOT RUN`：

- 受控 Application Capability 的 Handler、Repository、业务 DDL、真实 PostgreSQL 事务、RLS、CAS、幂等和 Audit/Outbox；
- 从空库创建 Enterprise、Product、QMS、Profile、ProductScope、Project 并重放旧 Snapshot 的业务 E2E；
- Platform Reference 导入/发布、TemplateBaseline/RegulatoryProfile 精确引用、Gap stale/Impact Process 的运行验证；
- IM-05 QualityProfile/Evidence 真实来源与跨模块验证、对象存储、外部 Provider 和人工“采购控制程序”验收。

本轮唯一可验证的自动范围是现有 200 项公开 Contract、文档链接/格式和 Catalog/Registry 一致性；这些 Gate 通过也不能提升上述业务项状态。
