> Historical record. Related Issue: [56](https://github.com/qzhike/zhiju-business-core/issues/56). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-03 合成 Reference Project Fixture

- 版本：v0.1
- 日期：2026-08-27
- 状态：`USER CONFIRMED / COMPOSED CONTROLLED PERSISTENCE PASS / SCOPED CLOSEOUT AUTHORIZED / INTEGRATED E2E NOT RUN / MANUAL NOT RUN`
- Fixture Key：`IM03-SYNTHETIC-RP-001`
- 适用范围：EnterpriseProject 的受控技术验证、测试矩阵和用户审阅

## 1. 文档定位

本 Fixture 将高层设计中的“采购控制程序”Reference Project 转换为不含真实客户信息的合成测试数据。它只验证对象边界、精确引用、版本历史、Human/Agent 权限、Scope、幂等、CAS、RLS、事件和 Completion 派生语义，不表达任何真实客户的采购制度、法规判断、审批组织或交付承诺。

本 Fixture 的结果只能使用以下状态：

- `PASS (SYNTHETIC CONTROLLED FIXTURE)`
- `PASS (COMPOSED CONTROLLED PERSISTENCE)`
- `PASS (CONTROLLED PERSISTENCE)`
- `NOT RUN`
- `FAIL`

不得使用本 Fixture 的结果宣称真实业务适用性、真实 Provider 联调或独立人工业务验收通过。

## 2. 权威输入与边界

- [HL-Spec](../../high-level-docs/HL-Spec.md)：Agent 入口、状态真实性和文档路由。
- [Domain Model](../../high-level-docs/04-domain-model-v0.1.md)：EnterpriseProject 对象、状态和不变量。
- [Cross-Aggregate Consistency](../../high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md)：Reference Project 的规范流程和跨 Aggregate 边界。
- [Module-Spec-002-EnterpriseProject](../../module-specs/Module-Spec-002-EnterpriseProject.md)：Command、Query、Event、错误码和持久化边界。
- [Module-Test-002-EnterpriseProject](../../module-tests/Module-Test-002-EnterpriseProject.md)：场景 ID、输入、预期输出和实际结果口径。
- [Issue #56](https://github.com/qzhike/zhiju-business-core/issues/56)：IM-03 汇总退出 Gate。

本 Fixture 复用高层文档中的流程形状，但不复用其中的 `ENT-001`、`PRJ-2026-014`、`SM-001` 等示例 ID。文档中的 `ENT-SYN-001` 等只是稳定的可读别名；实际执行时必须由合法 UUIDv7/ContentHash/VersionedRef 生成器产生真实值，并把实际值写入验证记录。

## 3. 合成数据集

### 3.1 参与者与 Scope

| 别名 | 类型 | 用途 | 备注 |
|---|---|---|---|
| `HUMAN-SYN-OWNER` | Human Principal | 执行允许的确认、接受、批准和激活 | 仅作为受信测试 Context，不代表真实用户 |
| `AGENT-SYN-WRITER` | Agent Principal | 提议材料、创建草稿、请求评估 | 不得执行 Human-only 决定 |
| `HUMAN-SYN-REVIEWER` | Human Principal | 查看和审阅结果 | 不改变已冻结历史 |
| `ENT-SYN-001` | Enterprise | 主测试 Enterprise | 实际运行时使用 UUIDv7 |
| `PRJ-SYN-001` | Project | 主测试 Project | 属于 `ENT-SYN-001` |
| `PRJ-SYN-002` | Project | 跨 Project 负向测试 Project | 与主 Project 同 Enterprise，用于隔离验证 |
| `ENT-SYN-002` | Enterprise | 跨 Enterprise 负向测试边界 | 只在需要时创建最小对象 |

Human/Agent Context 必须分别建立，不能通过 `actingFor` 把 Agent 转换成 Human。所有 Command 必须携带精确 `enterpriseId`、可选 `projectId`、Actor、Authorization Decision、Policy Snapshot、Correlation ID 和 Idempotency Key。

### 3.2 主对象别名

| 别名 | 类型 | 初始用途 | 版本/状态要求 |
|---|---|---|---|
| `EPS-SYN-001` | EnterpriseProfileSnapshot | Project 启动和 Gap 输入 | 精确 Snapshot Ref，不能使用 `latest` |
| `PROD-SYN-001` | ProductVersion | Project ProductScope | 同 Enterprise、不可变、精确 Version/Hash |
| `QMS-SYN-001` | QMSConfigurationVersion | Project QMS 输入 | 精确 Version/Hash、Human 激活 |
| `POL-SYN-PROJECT-001` | Policy Version | Project member policy | 精确 VersionedRef |
| `SM-SYN-001` | SourceMaterial | 合成原始材料 | 两个不同 origin 可共享同一 bytes/hash |
| `SM-SYN-002` | SourceMaterial | 相同 Hash 的第二来源 | 不合并、不删除 `SM-SYN-001` |
| `CM-SYN-001` | CustomerMaterial | 由 accepted SourceMaterial 提议 | 先 PROPOSED，再由 Human 确认 |
| `CB-SYN-001` | CustomerBaselineVersion | 客户现状基线 | 记录 UNKNOWN/NOT_PROVIDED/MISSING_CONFIRMED 的区别 |
| `TB-SYN-001` | TemplateBaselineVersion | 项目模板精确冻结版本 | FROZEN、不可原地修改 |
| `RP-SYN-001` | RegulatoryProfileVersion | 项目法规适用性精确版本 | FROZEN、EvidenceRef 独立 |
| `GA-SYN-001` | GapAnalysisVersion | 固定输入的 Gap | 先创建，再由 Human ACCEPT |
| `DP-SYN-001` | DeliveryPlanVersion | 固定 Baseline/Gap 的交付计划 | 先 Draft，再 Human APPROVE/ACTIVE |
| `DI-SYN-001` | DeliveryItem | 计划中的单项承诺 | Completion 只能由 Evaluator 派生 |
| `EVAL-SYN-*` | CompletionEvaluation | Completion 历史结果 | 追加写入、精确 criteria/fact refs |
| `IMPACT-SYN-*` | ImpactReview | 上游变化和晚到事实的影响 | 追加事实，不覆盖旧 Evaluation |

### 3.3 合成内容与 Hash

- SourceMaterial bytes：固定 UTF-8 字符串 `synthetic-im03-source-material-v1`，不包含客户正文。
- CustomerMaterial payload：只包含合成字段名、枚举值和最小安全摘要，不包含姓名、邮箱、合同、金额或真实法规文本。
- Gap finding key：`supplier-risk-classification`、`re-evaluation-frequency`。这两个 key 仅用于覆盖状态机，不代表任何真实业务判断。
- Product/QMS/Profile/Policy/Template/Regulatory 的内容 Hash 必须由实际 Canonical JSON 计算，禁止手填零 Hash 或从显示名称推导 Hash。
- 实际输出必须保留 `objectId`、`versionId`、`contentHash`、`enterpriseId`、`projectId`、lifecycle 和 source watermark；正文仅在授权的本地断言中观察，普通 Event/Result 不复制正文。

## 4. 主流程

主流程通过 EnterpriseProject 的 Application/Command 边界执行。直接 SQL 仅允许用于观察、计数和验证数据库拒绝，不允许用于创建或修补业务前置对象。

### 4.1 建立 Enterprise、参考版本和 Project

1. 使用 `HUMAN-SYN-OWNER` 创建 `ENT-SYN-001`，确认 ID 不由名称派生，状态为 `ACTIVE`。
2. 通过受控 Application Capability 创建 `PROD-SYN-001`、`QMS-SYN-001` 和 `EPS-SYN-001`；Product/QMS 的激活使用 Human Context。
3. 创建 `POL-SYN-PROJECT-001` 的精确 VersionedRef。
4. 使用 `project.create_project@1.0` 创建 `PRJ-SYN-001`，StartSnapshot 同时绑定 `EPS-SYN-001`、`QMS-SYN-001`、`PROD-SYN-001` 和 member policy 精确引用。
5. 创建 `PRJ-SYN-002` 作为同 Enterprise 的 Scope 负向对象；必要时创建 `ENT-SYN-002` 的最小边界对象。

必须同时验证：

- 缺失 Profile/QMS/ProductScope 时返回 `PROJECT_START_SNAPSHOT_INCOMPLETE`；
- 任意 Ref 使用 `latest` 或 `current` 时返回稳定拒绝；
- 跨 Enterprise 或错误 Project Scope 返回稳定拒绝；
- Project Scope Claim 和 Snapshot Binding 创建后不可迁移；
- 一个 Project 的 Context 不得读取或写入另一个 Project 的业务对象。

### 4.2 SourceMaterial 与 CustomerMaterial 分层

1. 以两个不同的合成 `ExternalRef` 登记 `SM-SYN-001` 和 `SM-SYN-002`，两者 bytes/hash 相同。
2. 为 `SM-SYN-001` 写入受控 Security/Integrity Validation，并通过精确 Ref/Hash/Locator 接受。
3. 保留 `SM-SYN-002` 的来源和历史，不把它合并成第一个 Root。
4. 使用 accepted `SM-SYN-001` 提议 `CM-SYN-001`，状态只能为 `PROPOSED`。
5. 使用 Agent Context 和 `actingFor` 伪装 Human 的 Context 尝试确认 CustomerMaterial，均应返回 `PROJECT_HUMAN_ONLY_DENIED`。
6. 使用 `HUMAN-SYN-OWNER` 确认 `CM-SYN-001`，保存精确 candidate Version、Decision Ref 和 Source Ref。

需要观察的结果：SourceMaterial 原始 bytes/hash/origin 不可原地修改；普通附件不会自动成为 CustomerMaterial、Baseline、Fact 或 Evidence；Event 不包含合成材料正文。

### 4.3 三态 CustomerBaseline

创建 `CB-SYN-001` 草稿，最少包含以下三类状态：

| 合成字段 | 初始状态 | 允许的确认方式 | 验证目标 |
|---|---|---|---|
| `supplier-risk-classification` | `UNKNOWN` | 草稿可以保留，Agent 不得直接确认缺失 | UNKNOWN 不变成 MISSING_CONFIRMED |
| `re-evaluation-frequency` | `NOT_PROVIDED` | 草稿可以保留，不能隐式升级 | NOT_PROVIDED 不等于已确认缺失 |
| `approval-authority` | 受控缺失候选 | 只有 Human Decision 才能成为 `MISSING_CONFIRMED` | 缺失确认必须有精确 Decision Ref |

先执行 Agent 请求 `MISSING_CONFIRMED` 的负向路径，预期为 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；再由 Human 提交带精确 Decision Ref 的确认路径。激活只移动 CustomerBaseline Root 的 active pointer，旧版本和旧 Item 保留。

### 4.4 TemplateBaseline、RegulatoryProfile 和 Gap 输入

1. 通过受控 Platform Reference Capability 导入并发布合成 Template/Regulatory Reference；发布后只读取精确已发布版本。
2. 使用 `HUMAN-SYN-OWNER` 冻结 `TB-SYN-001`，所有 TemplateSelection 携带精确 object/version/hash。
3. 使用独立的合成 EvidenceRef 激活 `RP-SYN-001`；Template/Regulatory Reference 不得冒充 Evidence。
4. 使用以下精确输入启动 `GA-SYN-001`：

   ```text
   EPS-SYN-001
   QMS-SYN-001
   CB-SYN-001
   TB-SYN-001
   RP-SYN-001
   GAP-POLICY-SYN-001
   ```

5. 先执行缺少 TemplateBaseline 和携带 `latest` 的负向 Gap 输入，再执行完整输入。
6. 完整输入只包含合成 finding，不复制 SourceMaterial 或 CustomerMaterial 正文。

任何上游版本变化都不能修改 `GA-SYN-001` 的 InputSnapshot、Finding 或 Decision；只能追加新的 stale/impact 事实。

### 4.5 Human 接受 Gap 并激活 DeliveryPlan

1. Agent/Service/`actingFor` Context 尝试 ACCEPT `GA-SYN-001`，预期均被 Human-only 边界拒绝。
2. Human 提交 `ACCEPT` Decision，形成 `GapAnalysisAccepted` 的精确 Gap/InputSnapshot/Decision refs。
3. 创建 `DP-SYN-001` Draft，引用 accepted `GA-SYN-001`、`CB-SYN-001`、`TB-SYN-001`、`RP-SYN-001`、`QMS-SYN-001` 和 `PROD-SYN-001` 的精确版本。
4. 同时构造一个含环依赖和一个重复 `itemKey` 的负向计划，分别验证 `PROJECT_DELIVERY_DEPENDENCY_CYCLE` 和重复键拒绝。
5. 将 `DI-SYN-001` 的受控 CompletionCriteria 设置为：

   ```text
   allOf:
   - execution.TaskCompleted@1.0
   - release.ReleaseCompleted@1.0
   ```

   该 criteria 只用于 WI-12 的受控 Completion 验证，不宣称 Artifact、Quality 或 Release 的真实业务 Handler 已完成。

6. Agent 和未批准 Human Context 尝试激活计划，预期返回 Human Approval 拒绝；Human 批准后才激活 `DP-SYN-001` 和 `DI-SYN-001`。

### 4.6 Query、Projection 和 Completion 受控链

1. 使用 `project.get_project_context_source` 读取 `PRJ-SYN-001`，检查 purpose/audience/requestedKinds、omissions、redactions 和 source watermark。
2. 使用 `project.get_active_baseline_refs` 读取 active/accepted exact refs，不解析 `latest/current`。
3. 使用 `project.get_delivery_item_criteria` 读取 `DI-SYN-001` 的冻结 criteria 和 criteriaHash。
4. 使用 `project.get_project_board_slice` 对比权威 Query 和可暂停 Projection；Projection lag 不能改变 Command 或 Completion 结果。
5. 注入合法 `execution.TaskCompleted@1.0`：评估应为 `UNSATISFIED`，不产生 CompletionSatisfied，Item 不得直接变为 `COMPLETED`。
6. 注入同 Project 的精确 `release.ReleaseCompleted@1.0`：评估应为 `SATISFIED`，产生一个最小 Completion Event，Root current pointer 通过 CAS 指向新 Evaluation。
7. 重放相同 Event/Command：返回 `DUPLICATE`；同 ID 不同 payload hash/watermark：进入 Quarantine/contract violation，不产生第二事实。
8. 注入 revoked/late/new-version 事实：只追加新的 Fact/Evaluation/Impact Review，旧 Evaluation、Plan Version、Decision 和 Fact 不改写。
9. 直接 SQL 设置 `execution_status='COMPLETED'` 或修改/删除 Completion 历史，必须被 ACL/RLS/immutable guard 拒绝。

## 5. 每步必须记录的输出

每次执行必须为每个步骤记录：

```text
scenarioId
fixtureKey
environment
input and exact refs
expected output
actual output
command receipt / event id / source watermark
object id / version id / hash / scope
PASS / FAIL / BLOCKED / NOT RUN
command or observation evidence
timestamp
cleanup result
remaining risk
```

正常输出只能暴露最小精确 Ref、状态、错误码和安全摘要。不得把合成材料正文、原始 ObjectLocator、内部密钥、完整 Authorization Decision 或不必要的 payload 复制到普通 Event/Result。

## 6. 验收边界

### 本 Fixture 可证明

- Enterprise/Project Scope 和精确 Ref 校验；
- SourceMaterial 与 CustomerMaterial 分层；
- CustomerBaseline 三态和 Human-only 缺失确认；
- TemplateBaseline/RegulatoryProfile 精确冻结与 Evidence 分离；
- Gap 输入冻结、Human ACCEPT、stale/impact 追加事实；
- DeliveryPlan DAG、Human APPROVE/ACTIVE 和 DeliveryItem criteria 冻结；
- Query 脱敏、active exact refs、Projection lag 不影响权威状态；
- Completion 的 Task-only UNSATISFIED、Release-complete SATISFIED、replay、Quarantine、CAS、RLS 和 immutable guard。

### 本 Fixture 不可证明

- 真实客户业务规则、法规适用性和审批组织是否正确；
- 真实飞书身份、消息、文件、卡片或外部 Provider；
- 真实 Ceph RGW/OpenBao、生产数据库、公开 HTTP 或跨模块 Event Bus；
- Artifact、QualityGovernance、ReleasePublication 的真实业务 Handler；
- 真实 TaskExecution/Runtime/Renderer 链路；
- 独立真实业务用户对 Reference Project 的业务适用性确认。

以上项目继续保持 `NOT RUN`，除非另有独立证据和明确授权。

## 7. 当前状态

- Fixture 数据、流程和预期结果：已提出并经用户确认。
- 实际受控技术执行：现有 WI focused PostgreSQL fixtures 已组合执行并通过；结果只能标记为 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不是单一跨 Aggregate E2E 的通过。
- 实际 PostgreSQL 输出：`pnpm persistence:gate` 为 `21` 个测试文件、`256` 个测试通过；空库迁移、二次 no-op 和容器清理通过。
- 本 Fixture 没有新增统一的 runtime runner，因此 `IM03-SYNTHETIC-RP-001` 仍是稳定的人类可读 Fixture Key，而不是可以跨测试文件回读的单一对象链 ID。
- `EP-API-E-001`、`EP-API-E-002` 的 integrated cross-aggregate execution：`NOT RUN`。
- 用户人工检查：`NOT RUN`。
- Issue #56：本 Fixture 单独不证明原始人工验收条件通过；用户在完整知悉边界后已明确授权将其与既有 WI 证据作为 scoped technical closeout 材料。关闭时必须保留 `SYNTHETIC / TECHNICAL ONLY` 与所有 `NOT RUN` 标识。

## 8. 执行记录

本次命令、环境、WI focused 场景映射、实际输出和 cleanup 记录见 [`Verification-Record.md`](Verification-Record.md)。
