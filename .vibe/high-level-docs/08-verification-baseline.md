# Zhiju Business Core 验证基准

版本：v0.1
日期：2026-08-17
状态：`CURRENT VERIFICATION BASELINE / IM-00 COMPLETE / IM-01 COMPLETE / IM-02 TECHNICAL BASELINE COMPLETE / IM-03 SCOPED TECHNICAL ACCEPTANCE COMPLETE / IM-04 WI-01 CONTRACT VERIFIED 2026-08-28 / IM-04 WI-01 PERSISTENCE VERIFIED 2026-08-28 / IM-04 WI-01 GIT DELIVERY VERIFIED PR #100 MERGED 2026-08-28 / ISSUE #90 CLOSED 2026-08-28 / WI-01 FEATURE BRANCH DELETED / IM-04 WI-02 IMPLEMENTATION VERIFIED 2026-08-28 / IM-04 WI-02 PERSISTENCE VERIFIED 2026-08-28 / IM-04 WI-02 GIT DELIVERY PENDING USER CONFIRMATION / SYNTHETIC COMPOSED CONTROLLED PERSISTENCE PASS / ISSUE #56–#68 CLOSED / IM-UI-01 DESIGN VERIFIED / UI IMPLEMENTATION AND BROWSER TESTS NOT RUN / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / EXTERNAL NOT RUN`

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

### 2.7 Browser UI

针对真实构建制品与批准浏览器验证：OIDC/BFF Session、CSRF/Origin/Cookie、公开 API mapping、ViewModel 状态真实性、跨 Scope、重复提交、断网/UNKNOWN/reconciliation、XSS/CSP、敏感信息、键盘/焦点/语义和完整 Human 操作路径。组件 Unit/Story 或 Mock API 不能完成 Browser E2E、安全、可访问性或人工 Gate。

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
| Workspace UI Experience 场景 | [`Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md) | 15 | 1 个 Design Gate `DESIGN VERIFIED`；其余 14 个 `NOT RUN` |
| 合计 |  | 377 | Workspace UI 新增里程碑仍未实现；静态设计检查不代表运行测试 |

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
| V-DOC-008 | Catalog 唯一性 | 当前 201 个公开 Contract 名称全局唯一，namespace 与模块 Owner 一致；冻结 v1.0 历史基线仍为 200 |
| V-DOC-009 | 持久化边界 | 七个权威 Schema + Projection；关系/JSONB/对象存储；RLS/Role；Outbox/Inbox 均只有一个权威定义 |
| V-DOC-010 | Human/Agent 边界 | Agent/actingFor 不可 Approval 或 Release Authorization；Human 不能绕过 Mandatory Gate |
| V-DOC-011 | 状态层级 | Run、WorkOrder、Task、DeliveryItem、Revision、Approval、Release、Effective 不相互冒充 |
| V-DOC-012 | 飞书边界 | MVP 完整双向；消息/附件/卡片不直接成为业务完成、Approval 或 Formal Release |
| V-DOC-013 | QM 弃用 | QM 只可作为明确弃用说明出现，不得成为 Runtime、Adapter、Scope、Task 或依赖 |
| V-DOC-014 | 链接与格式 | Markdown 链接可达、代码块闭合、编号唯一、无冲突标记或过期状态 |
| V-DOC-015 | 状态真实性 | 所有未执行实现/外部/人工用例保持 `NOT RUN`，不得因静态审计改为 PASS |
| V-DOC-016 | Module 文档集合 | 七个 Business Core 模块各有且只有一份 `Module-Spec` 和一份 `Module-Test`；Workspace UI 另有一份 Experience Module Spec/Test，不混入 Business Core Owner/Schema/Catalog；ID/ModuleName 一致，测试含输入、预期、实际和结果 |
| V-DOC-017 | API Catalog 覆盖 | `06` 的当前 201 个公开 `name@1.0` 在七份 Module Spec 中各出现一次，集合差异为零，namespace 与 Owner 一致 |
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
| V-DOC-030 | Implementation 决策隔离 | IM-00 至 IM-09 的 10 个 Core/Adapter/Operations 里程碑与独立 IM-UI-01 共 11 个计划节点可定位；6 个 IM 决策 Gate 与 3 个 UI 决策 Gate 状态分开；未选技术栈、物理参数和 proposal 不得被静默事实化 |
| V-DOC-031 | 私有化部署与认证边界 | Ubuntu 单机明确非 HA；MicroCeph/OpenBao/Keycloak 责任分离；Authentication 不冒充 IdentityPolicy Authorization；Fake 不完成 Conformance Gate |
| V-DOC-032 | Workspace UI 非所有权边界 | UI/BFF 只消费公开 API/Projection；不拥有 Business Core Contract、Schema、Repository、Authorization、Approval、Release 或 Completion |
| V-DOC-033 | Workspace UI 状态与安全真实性 | UNKNOWN/STALE/epistemic state 不被折叠；Human-only 由服务器重验；Session/CSRF/XSS/Scope/敏感信息/Accessibility/Manual Gate 可定位且未运行项为 NOT RUN |

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
Feishu / Workspace UI SourceMaterial
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
- Workspace UI 只显示/提交公开 API 结果，Session、页面缓存、乐观更新和 BFF 组合不形成第二套业务事实。

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

### 7.4 Workspace UI/BFF

除第 7.1 节外，还必须验证：

- UI-DG-001 至 UI-DG-003 已审核，前端框架、Design System、浏览器/视口、可访问性和 BFF 部署没有被脚手架静默选择；
- Browser/BFF 只调用公开 API/Projection，无 Business Core internal import、Repository、跨 Schema SQL 或私有业务 Command；
- OIDC Authorization Code + PKCE、Session Cookie、CSRF、Origin/Host、logout、expiry、revocation 与 reauth；
- Access/refresh token、External ID、客户正文、短期下载 URL 不进入浏览器持久存储、DOM attribute、日志、analytics、trace 或 screenshot；
- Human-only、跨 Enterprise/Project Scope、Deep Link、缓存切换和多 Tab 负向路径由服务器拒绝且不泄漏对象存在性；
- expectedVersion、idempotency、double-click、网络中断、UNKNOWN/reconciliation 和 `CONCURRENCY_CONFLICT` 不制造第二业务事实；
- Projection freshness、epistemic state、部分成功、Provider UNKNOWN、Run/WorkOrder/Task/DeliveryItem 四层状态真实显示；
- XSS/CSP、恶意文件名/预览、错误 redaction 和依赖/制品安全；
- 批准浏览器/视口矩阵、键盘/焦点/name-role-value/错误恢复和用户手动 Reference Project 验收。

组件 Unit Test、Story、静态截图或 Mock API 不能完成 Browser E2E、安全、可访问性或人工 Gate。

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

状态条目按实际发生日期累计；2026-08-28 最新增量为 IM-UI-01 里程碑与验证基线：

- 用户已批准 IM-UI-01 的依赖、范围和 Exit Gate；它在 IM-06 后启动，可与 IM-07/IM-08 时间窗并行，并成为 IM-09 前置。
- Workspace UI Spec/Test 的 15 个场景已定义；仅 `UI-D-001` 为 `DESIGN VERIFIED`，其余 14 个 Unit/Contract/Browser/Security/Accessibility/Manual 场景全部为 `NOT RUN`。
- UI-DG-001/002 为 `USER DECISION REQUIRED`；UI-DG-003 为 `BOUNDARY FROZEN / CONCRETE DESIGN REQUIRED`。不存在 UI 工程、BFF、Browser build 或运行证据。

既有状态记录：

- 高层设计基准已由用户审核通过；字段级 API Contract、七份 Module Spec 与七份 Module Test 已完成本轮静态 `DESIGN VERIFIED`，并由用户于 2026-08-13 审核通过；
- 本文中的 235 个实现前业务/外部场景仍主要为 `NOT RUN`（不得用 IM-01 静态证据冒充）；
- API Module Test、Feishu Channel、Runtime Adapter 的 Design Gate 仍为 `DESIGN VERIFIED`，其 Unit/Contract/E2E/Manual 运行时项保持 `NOT RUN`；
- IM-00 已完成；IM-DG-001 至 IM-DG-005 已批准；IM-DG-006 仍为 `USER DECISION REQUIRED`；
- IM-01 已 `COMPLETE`：干净 checkout 下 `pnpm install --frozen-lockfile`、`pnpm clean`、`pnpm verify` 全过；
- 当前仓库自动验证为 `pnpm test` 的 `Test Files 20 passed / 10 skipped`、`Tests 341 passed / 164 skipped`；`pnpm verify` 的 persistence gate 为 `12` 个测试文件、`177` 个测试通过；架构边界 `source_roots=10`；
- Registry 精确为 `FULL:200 / ENVELOPE_ONLY:0`，分类为 Command=95、Query=44、Event=61；Catalog/Module Spec/Registry 集合 diff=0；
- 200 payload + 44 query result + 6 Core Contract 的 Schema-derived Type 与 v1.0 compatibility baseline 已接入 `contracts:check`；
- 架构禁止依赖负向探针与 compatibility breaking 负向 fixtures 均实际失败（拒绝非法变更）；
- #1–#4、#6–#8 已关闭并合入；#5 字段 Schema 由 PR #14 完成，duplicate/late Runtime 由已关闭的 #15 完成，其余 Runtime 分别由 #22–#24 追踪；#17 的本地 IntegrationGateway Runtime 切片已落地，Handler/Adapter/DB/外部验收改由 #27 追踪；
- 2026-08-21 用户先批准修订 Issue #9 的 Schema 退出硬依赖，随后批准将 #5 收敛为字段 Schema 边界；关闭 #5 不会把 #22–#24 或 #27 的 Runtime/外部验收改写为 `PASS`；
- 尚无 IM-03 EnterpriseProject 业务 DDL、Repository、业务 Handler、飞书 Adapter、Runtime Adapter 或 Renderer 实现；IM-02 标准事务技术表已落地并有独立验证，但不能写成 IM-03 业务实现 `PASS`；
- 尚无 IM-03 业务 PostgreSQL 事务链、飞书、Runtime、Renderer、对象存储、负载、备份恢复或人工质量验收结果；IM-02 技术表的 PostgreSQL/Flyway persistence gate 已通过，但不等于业务链完成；
- 正式 `IM-01 COMPLETE` 已由 PR #20 原子更新（证据见 [Issue #9 Verification Report](../im-01-exit-gate-issue-9/Verification-Report.md)）；IM-02 已完成技术基础和文档收口，PR #51–#55 已合入，Issue #28 已关闭；真实业务 Handler、外部系统和人工验收仍未完成。IM-03 WI-01 设计决策已记录；WI-02 正在落地 EnterpriseProject Application/Persistence 事务基础，业务 DDL/Handler 仍为 `NOT RUN`。

## 10. IM-03 WI-01 设计验证边界

Issue #57 的决策矩阵提供了 Product/QMS/Profile/Platform Reference 的唯一 Owner、受控入口、授权目的、精确版本/Hash 语义、失败码和手测示例。该矩阵可标记为 `DESIGN VERIFIED`，但以下项目仍为 `NOT RUN`：

- 受控 Application Capability 的 Handler、Repository、业务 DDL、真实 PostgreSQL 事务、RLS、CAS、幂等和 Audit/Outbox；
- 从空库创建 Enterprise、Product、QMS、Profile、ProductScope、Project 并重放旧 Snapshot 的业务 E2E；
- Platform Reference 导入/发布、TemplateBaseline/RegulatoryProfile 精确引用、Gap stale/Impact Process 的运行验证；
- IM-05 QualityProfile/Evidence 真实来源与跨模块验证、对象存储、外部 Provider 和人工“采购控制程序”验收。

截至 2026-08-21，本轮唯一可验证的自动范围是当时的 200 项公开 Contract、文档链接/格式和 Catalog/Registry 一致性；这些 Gate 通过也不能提升上述业务项状态。

### 9.1 IM-04 WI-01 当前验证边界（2026-08-28）

- 当前公开 Registry 为 `FULL:201 / ENVELOPE_ONLY:0`，其中新增的唯一 Operation 是 `integration.get_render_attempt_binding@1.0`；`contracts/baselines/v1.0/` 的历史 200-operation 快照不可改写。
- 本 WI 的自动 Gate 已覆盖并通过 Canonical Document/Workbook Schema、结构不变量、Canonical JSON/SHA-256 Fixture、Manifest hash-domain 排除、Binding Query payload/result、生成类型、Catalog 对账与兼容性增量；`pnpm test` 为 `25 个测试文件 PASS / 17 个 skipped`、`363 passed / 241 skipped`。
- `pnpm verify` 的 format、lint、typecheck、test、architecture、contracts:check 和 PostgreSQL persistence gate 均通过；Persistence 使用锁定的 PostgreSQL 18.6 / Flyway 11.20.3，完成 `21` 个测试文件、`256` 个测试、空库迁移、二次 migrate no-op 和容器清理。
- PR [#100](https://github.com/qzhike/zhiju-business-core/pull/100) 的最终 head `2fb49e243f6aac3e604190c5f655c0b1980fef69` 上 GitHub Actions `ci/verify` 已成功；PR 已合入 `main`，Issue [#90](https://github.com/qzhike/zhiju-business-core/issues/90) 已关闭，远端和本地 feature branch 已删除，`origin/main` ancestry 已验证。
- 对象存储、Renderer 进程、Artifact 业务 Repository/Handler、真实 Provider/数据库、公开 HTTP、跨模块 E2E、生产和独立人工业务验收继续保持 `NOT RUN`。

### 9.2 IM-04 WI-02 Application/Persistence 验证边界（2026-08-28）

Issue #91 只实现 Artifact owning Schema 在既有 V4000 技术表上的事务基础。适用 Gate 为：可信 Actor/Scope/Correlation Context 传播；同 key/hash 幂等 Replay 与不同 hash Quarantine/Conflict；技术 Process `bigint` CAS；Receipt、Audit、Outbox、Reference Edge 和技术 Process 的原子提交/回滚；Project 双重 RLS、Process Step Scope mirror、Reference Edge owner-version 唯一性，以及直接 App Role 权限拒绝。

该 WI 不新增 Artifact/Branch/Revision/Content Object/Representation/Binding 业务表，不修改已应用的 V4000，不读取 IdentityPolicy 或 EnterpriseProject Schema，也不实现业务 Handler、对象存储、Renderer、Provider、公开 HTTP 或跨模块业务 E2E。2026-08-28 的 `pnpm clean && pnpm verify` 已通过：静态、类型、全量测试、架构、Contract 和 pinned PostgreSQL/Flyway Persistence Gate 均通过；Persistence 为 22 个文件、268 个测试，空库 Migration、二次 no-op 和容器清理均通过。业务 Artifact、生产数据库和独立人工验收仍为 `NOT RUN`，直到有对应实现和独立证据。

## 11. IM-03 WI-02 Application/Persistence 验证边界

Issue #58 验证 EnterpriseProject 模块内技术表写入路径，而不是业务 Aggregate：

- 相同幂等键/相同 Hash 重放、不同 Hash 冲突、并发 CAS、故障回滚必须在真实 PostgreSQL 证明；
- 无 Context、伪造 GUC、过期 AuthorizationDecision、跨 Project Scope 与连接池 Context 泄漏必须安全拒绝；
- Canonical payload/hash 与提升 Scope 列不一致必须在写入边界拒绝；
- 授权只允许绑定 IdentityPolicy 公开 Decision/Query Port 给出的可信快照，禁止模块 import `@zhiju/identity-policy` 或共享其 Repository；
- 空库 Migration / 二次 no-op 继续由 persistence gate 证明。业务 Handler、业务 DDL、公开 HTTP 和人工“采购控制程序”仍为 `NOT RUN`。

## 12. IM-03 WI-08 验证边界

WI-08 的最小自动验证包括 Platform Reference 的 DRAFT→PUBLISHED lifecycle、published immutability、writer/app role boundary、TemplateBaseline/RegulatoryProfile 的 Project Scope/RLS、精确 Ref/Hash/CAS、Evidence separation、idempotency、Audit/Outbox/Reference Edge 原子提交和失败回滚。测试文档必须同时记录输入、预期输出和实际输出；在测试未执行前所有 WI-08 场景保持 `NOT RUN`。

Disposable PostgreSQL 与本地 Unit/Contract 通过只证明当前代码、迁移和受控入口。Platform Provider、真实外部法规来源、公开 HTTP、跨模块 Process Manager、生产环境和独立人工 Reference Project 验收必须独立取证，不得由本地 Gate 推断为 `PASS`。

## 13. IM-03 WI-09 验证边界

WI-09 的最小自动验证必须同时覆盖：七个 Gap InputSnapshot ref 的 exact object/version/snapshot id、Scope、生命周期和 hash；受控 evaluator 的 `UNKNOWN` 保留与 summary 派生；InputSnapshot/Version/Finding/Decision 的 INSERT-only 与完成版本不可变；Human-only ACCEPT 以及 Agent/Service/`actingFor` 拒绝；ACCEPTED pointer、REJECT/CHANGES_REQUIRED 分支和 `GapAnalysisAccepted` 的 exact refs；Command Receipt 幂等、Root CAS 并发和故障回滚；以及旧 Gap 被新 Customer/Template/Regulatory Baseline/Profile 激活标记 `STALE` 后旧 finding/Decision/input 和 Impact trigger 仍可解释。

测试结果必须写回 [`Module-Test-002-EnterpriseProject.md`](../module-tests/Module-Test-002-EnterpriseProject.md)，并区分 `PASS (PERSISTENCE)`、`PASS (LOCAL)`、`DESIGN VERIFIED` 和 `NOT RUN`。Disposable PostgreSQL 不代表 Provider、公开 HTTP、跨模块 Process Manager、生产或独立人工 Reference Project 已运行；这些边界继续保持 `NOT RUN`，直到有独立证据。

Persistence Gate 的外部镜像证据还必须记录 tag 与当前 manifest digest 的一致性。若远端 registry 重新解析固定 tag，先更新经核对的 immutable pin，再重新执行本地和 exact-head Gate；tag-digest 检查失败时，不能把此前的静态或 Unit PASS 记作完整验证 PASS。

2026-08-27 的 WI-09 corrected exact head `6de5c96c4ba4fe0938b422606d4632048ac19932` 已通过 GitHub Actions [run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309)，并以 merge commit `2d6afd0cc2889cf0fa6350c0599d514d5917b071` 合入 `main`。Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已显式 `CLOSED`；远端和本地 WI-09 feature branch 已删除，`origin/main` 已确认包含实现 head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。
## 14. IM-03 WI-12 Completion/Impact 验证边界

WI-12 的验证必须证明一条完整的本地受控链：精确 DeliveryPlan/Item criteria → 正式 Event Envelope 校验 → Inbox 幂等/冲突隔离 → ProcessInstance/Step → immutable Completion Fact → Evaluator → Evaluation/Root CAS → 最小 Completion 或 Impact Event。结果记录必须保留测试输入、期望输出、实际输出、精确 migration/head、环境和清理证据。

最小自动矩阵包括：TaskCompleted 存在但 ReleaseCompleted 缺失时 UNSATISFIED 且无 Completion Event；补入精确 ReleaseCompleted 后才 SATISFIED；同一 event/command 相同 hash replay 为 DUPLICATE；相同 id 不同 hash/watermark 进入 Quarantine 且不产生第二业务事实；late/revoked/upstream new Version 只追加新的 Evaluation/Impact Review；旧 Evaluation/Plan Version/Approval/Fact 保留；直接 SQL `delivery_item.execution_status='COMPLETED'`、跨 Project/无 Context/伪造 Scope 和 immutable UPDATE/DELETE 被拒绝；故障回滚不留下 Inbox/Fact/Evaluation/Impact/Event 半提交。

Disposable PostgreSQL、Unit/Contract 和 controlled fixture 只能标记 `PASS (PERSISTENCE)` 或 `PASS (LOCAL)`；真实 TaskExecution/QualityGovernance/ReleasePublication Provider、跨模块 Event Bus/Process Manager、公开 HTTP、生产和独立人工 Reference Project 继续 `NOT RUN`，不得由本地事实账本模拟成已完成外部链路。

截至 2026-08-27，WI-12 的本地验证记录为 [`Verification-Record.md`](../im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md)：`pnpm verify` 全部通过；完整 Vitest 为 24 个文件通过、17 个受控跳过，356 个测试通过、241 个受控跳过；Persistence Gate 为 21 个文件、256 个测试全部通过。Gate 使用 PostgreSQL 18.6（`server_version=180006`）与 Flyway 11.20.3 的固定镜像 digest，V2013 空库迁移和二次 no-op 均通过，测试容器已清理。Provider、真实跨模块 Event Bus/Process Manager、公开 HTTP、生产数据库和独立人工 Reference Project 仍为 `NOT RUN`。

## 15. IM-03 合成 Reference Project 验证补充

用户已确认 `SYNTHETIC / TECHNICAL ONLY` 方案。现有 WI focused fixtures 已组成一次受控技术 Gate：`pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上通过 `21` 个 persistence 测试文件、`256` 个测试，空库迁移、V2013、二次 no-op 和容器清理均通过。该结果标记为 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不标记为统一跨 Aggregate E2E。

`EP-API-E-001/E-002` 的 integrated runtime chain、`EP-API-M-001` 的实际人工逐项审阅、真实业务适用性、Provider、公开 HTTP、生产和真实跨模块 Event Bus/Process Manager 继续为 `NOT RUN`。完整矩阵和证据见 [`Verification-Record.md`](../im-03-synthetic-reference-fixture/Verification-Record.md)。

## 16. IM-UI-01 Workspace UI 验证边界

IM-UI-01 只在 IM-06 Human-operated Core 完成、UI-DG-001 至 UI-DG-003 获得适用审核、公开 API/Projection 语义稳定后进入实现。UI 是 Experience Module，不增加第八个 Business Core Owner，也不修改现有 200 项 Catalog。

最小自动与人工矩阵由 [`Module-Test-UI01-WorkspaceUI.md`](../module-tests/Module-Test-UI01-WorkspaceUI.md) 唯一维护，必须覆盖：

- Projection freshness 与 PRESENT/UNKNOWN/NOT_PROVIDED/MISSING_CONFIRMED 的 ViewModel 真值映射；
- BFF 只调用公开 API，无 internal import/Repository/SQL/私有 Command；
- OIDC/Session/CSRF/Origin/Cookie/reauth/logout；
- Human-only、跨 Scope、Deep Link、缓存、多 Tab 和敏感信息负向场景；
- expectedVersion/idempotency/double-click/UNKNOWN/reconciliation；
- Project/Baseline/Gap/Delivery、Artifact/Revision/Diff/Edit、Evidence/Review/Approval/Release、Task/Run/InformationRequest/Audit 的真实浏览器链；
- XSS/CSP、文件/URL、telemetry redaction、批准浏览器/视口、键盘/焦点/语义和独立用户手动验收。

当前只完成文档结构、依赖和不变量的静态一致性检查，可标记 `UI-D-001 DESIGN VERIFIED`。前端框架、BFF、OIDC 环境、页面、组件、Browser E2E、Security、Accessibility 和 Manual 均不存在或未执行，必须保持 `NOT RUN`。IM-03 的受控 PostgreSQL、IM-07 的飞书卡片或 IM-09 文档中的“Workspace 输入”都不能替代 UI 运行证据。
