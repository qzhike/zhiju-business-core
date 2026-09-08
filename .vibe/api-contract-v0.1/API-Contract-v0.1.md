# Zhiju Business Core Command / Query / Event API Contract v0.1

版本：v0.1
日期：2026-08-13
状态：`CURRENT API CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / IM-03 WI-01 CONTROLLED CAPABILITY DECISION RECORDED / IMPLEMENTATION NOT STARTED`

文档角色：公开 Command、Query、Event 的共享字段规则、执行语义、错误、兼容性、安全与验证要求的唯一权威。具体操作名称及唯一 Owner 以 [`../high-level-docs/06-typed-references-contract-catalog-v0.1.md`](../high-level-docs/06-typed-references-contract-catalog-v0.1.md) 为准；每个操作的 payload/result/event 字段由对应 `Module-Spec` 唯一维护。

## 1. 目标与非目标

本文把高层业务 Contract 落到可生成 Schema、Fixture、SDK 和 Handler 骨架的字段级 API，但不绑定传输协议。

本阶段冻结：

- 统一字段类型与 required/optional 语义；
- Command Target、并发、授权、幂等和提交结果语义；
- Query 一致性、分页、脱敏和结果语义；
- Domain Event 最小事实 Payload 与 Replay 语义；
- 公开错误结构、兼容规则和 Schema Registry 要求；
- 七模块 200 个公开 Contract 的字段级路由。

本阶段不定义：

- HTTP Method、URL、Header 或状态码；
- gRPC/Protobuf field number；
- MCP Tool 名称；
- Message Broker Topic；
- 飞书事件 JSON；
- Runtime、Renderer 或数据库 DTO；
- 编程语言类名、包名或 ORM Model。

任何传输映射都必须保持本文和模块规格的字段语义，不得另建第二套业务 API。

## 2. 文档路由与唯一权威

| 范围 | 唯一权威 |
|---|---|
| 产品、架构冻结规则 | [`HL-Spec.md`](../high-level-docs/HL-Spec.md)、[`02-zhiju-core-architecture.md`](../high-level-docs/02-zhiju-core-architecture.md) |
| 四个 Core Contract | [`03-core-contracts.md`](../high-level-docs/03-core-contracts.md) |
| Aggregate、状态机、不变量 | [`04-domain-model-v0.1.md`](../high-level-docs/04-domain-model-v0.1.md) |
| Saga、事务、并发、幂等 | [`05-cross-aggregate-consistency-module-boundary-v0.1.md`](../high-level-docs/05-cross-aggregate-consistency-module-boundary-v0.1.md) |
| Typed Reference、Envelope、名称和 Owner | [`06-typed-references-contract-catalog-v0.1.md`](../high-level-docs/06-typed-references-contract-catalog-v0.1.md) |
| 持久化边界 | [`07-postgresql-logical-model-v0.1.md`](../high-level-docs/07-postgresql-logical-model-v0.1.md) |
| API 共享字段规则 | 本文 |
| 操作字段 | 对应 `Module-Spec` |
| 模块测试用例与实际结果 | 对应 `Module-Test` |

模块路由：

| ID | Module Spec | Module Test |
|---:|---|---|
| 001 | [`Module-Spec-001-IdentityPolicy.md`](../module-specs/Module-Spec-001-IdentityPolicy.md) | [`Module-Test-001-IdentityPolicy.md`](../module-tests/Module-Test-001-IdentityPolicy.md) |
| 002 | [`Module-Spec-002-EnterpriseProject.md`](../module-specs/Module-Spec-002-EnterpriseProject.md) | [`Module-Test-002-EnterpriseProject.md`](../module-tests/Module-Test-002-EnterpriseProject.md) |
| 003 | [`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md) | [`Module-Test-003-TaskExecution.md`](../module-tests/Module-Test-003-TaskExecution.md) |
| 004 | [`Module-Spec-004-Artifact.md`](../module-specs/Module-Spec-004-Artifact.md) | [`Module-Test-004-Artifact.md`](../module-tests/Module-Test-004-Artifact.md) |
| 005 | [`Module-Spec-005-QualityGovernance.md`](../module-specs/Module-Spec-005-QualityGovernance.md) | [`Module-Test-005-QualityGovernance.md`](../module-tests/Module-Test-005-QualityGovernance.md) |
| 006 | [`Module-Spec-006-ReleasePublication.md`](../module-specs/Module-Spec-006-ReleasePublication.md) | [`Module-Test-006-ReleasePublication.md`](../module-tests/Module-Test-006-ReleasePublication.md) |
| 007 | [`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md) | [`Module-Test-007-IntegrationGateway.md`](../module-tests/Module-Test-007-IntegrationGateway.md) |

## 3. Schema 表示法

模块规格使用以下语言无关 IDL：

```text
field: T          required exactly once
field?: T         optional; absent and null are different
field: T[]        required ordered list; may be empty only when field rule permits
field: Set<T>     canonicalized unique set with stable semantic ordering
field: NonEmptySet<T>
field: A | B      tagged union; discriminator is required
Closed<A|B>       closed enum; unknown value is invalid for this Major
Open<A|B>         open enum; consumer needs UNKNOWN branch
Sensitive<T>      allowed in payload, prohibited in ordinary logs/errors
CanonicalJson     JSON value governed by Canonicalization v1
```

Rules：

1. Required 字段缺失是 `API_REQUIRED_FIELD_MISSING`。
2. Optional 字段无值时省略；不使用空字符串、空对象或 `null` 代替 UNKNOWN。
3. 不确定性使用 `ValueEnvelope<T>`。
4. 时间均为 UTC RFC 3339；业务日期使用独立 `LocalDate`，不得伪造时区。
5. Decimal/Money 使用十进制定点字符串。
6. ID 是 opaque UUIDv7 字符串；Consumer 不解析位或前缀获得业务语义。
7. 所有 Set 在 Hash 前按 Schema 声明的稳定键排序并去重。
8. 未在字段定义中声明的字段必须拒绝，除非位于已注册 `extensions`。

## 4. 共享标量与 Value Object

```text
UuidV7              opaque RFC 9562 UUID version 7 string
NonEmptyString      Unicode NFC; trimmed; at least one non-whitespace code point
SafeSummary         NonEmptyString safe for authorized user display; no secret or hidden reasoning
ReasonCode          registered upper snake case code
NamespaceCode       registered lower dotted namespace
UtcInstant          UTC RFC 3339 timestamp with explicit precision
LocalDate           YYYY-MM-DD without timezone inference
Duration            ISO 8601 duration
PositiveInt         integer > 0
NonNegativeInt      integer >= 0
DecimalString       canonical base-10 fixed-point string
MediaType           registered IANA-style media type
LocaleTag           BCP 47 language tag
ContentHash         { algorithm: "SHA-256"; digest: lowercase hex; canonicalizationVersion: "1" }
PayloadHash         ContentHash
ObjectLocator       opaque controlled-object-storage locator; never a public URL
```

共享业务结构：

```text
Justification
├── reasonCode: ReasonCode
├── summary: SafeSummary
├── evidenceRefs: EvidenceRef[]
└── policyRef?: VersionedRef<Policy>

EffectivePeriod
├── validFrom?: UtcInstant
└── validTo?: UtcInstant

SourceWatermark
├── sourceModule: NamespaceCode
├── partition?: NonEmptyString
├── sequence: NonNegativeInt
└── observedAt: UtcInstant

PageRequest
├── pageSize: PositiveInt
└── cursor?: OpaqueCursor

Page<T>
├── items: T[]
├── nextCursor?: OpaqueCursor
├── snapshotAt: UtcInstant
└── sourceWatermarks: SourceWatermark[]

FieldViolation
├── code: ReasonCode
├── fieldPath?: NonEmptyString
├── violatedRule: NonEmptyString
├── safeDetail?: SafeSummary
└── targetRef?: TypedReference
```

所有文本、集合、Payload 和分页大小上限由构建期 `PayloadGuardPolicy@1.0` 注册并进入生成 Schema；Handler 必须在解析大对象或执行授权查询前应用 Guard。具体数值属于实现前部署参数，本 Contract 不允许实现以“无限制”作为默认值。

## 5. Command API

### 5.1 Envelope

所有公开 Command 使用 `06` 定义的 `CommandEnvelope<P>`。模块字段表只定义 `payload: P`，不得重复以下字段：

```text
commandId
commandType
commandVersion
scopeRef
targetRef
expectedAggregateVersion?
actor
authorizationDecisionRef
idempotencyKey
correlationId
causationId?
requestedAt
deadline?
payload
integrity
```

### 5.2 Target 与并发模式

每个 Command 在模块规格中声明一种模式：

| 模式 | targetRef | expectedAggregateVersion | 语义 |
|---|---|---|---|
| `CREATE` | 预分配的新 Aggregate ObjectRef | 必须省略 | 创建失败不得把同一 ID 绑定到不同 Payload |
| `MUTATE` | 已存在可变 Aggregate ObjectRef | 必填 | CAS 成功后版本严格加一 |
| `APPEND` | 已存在 Root 或预分配不可变 Fact Ref，按规格声明 | Root 写入时必填 | 追加事实不可被后续 Command 原地改写 |
| `EVALUATE` | owning Aggregate 或预分配 Evaluation Ref | 按模块规格 | 产生不可变 Evaluation/Snapshot，不接受调用者布尔结论 |

`expectedAggregateVersion` 不得出现在 payload 中。不可变 `versionId/revisionId/snapshotId` 不得放进该字段。

### 5.3 Handler 固定顺序

```text
1. Envelope/schema/payload guard
2. command type/version registry
3. actor and authorization decision integrity
4. idempotency claim: key + payloadHash
5. target/reference/scope/purpose validation
6. expectedAggregateVersion compare-and-set
7. aggregate lifecycle and business invariants
8. state/fact + command receipt + outbox atomic commit
9. return CommandResult
```

同一 `idempotencyKey + payloadHash` 返回原 `CommandResult`，状态为 `DUPLICATE`；同一 key 不同 Hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，不得执行 Handler。

### 5.4 Authorization

- 所有写 Command 必须携带精确 `authorizationDecisionRef`；Handler 在事务时重新验证 Decision 的 actor、commandType、scope、target purpose、Policy Snapshot、expiry 和 revocation。
- `actor.principalKind=AGENT` 即使存在 `actingForRef`，仍不得执行 Human-only Command。
- Human-only Command 的模块字段表使用 `HUMAN_ONLY` 标记；缺少标记不代表公开匿名调用。
- Channel、Runtime 或 Service 的预检查不替代 owning module 的授权。

### 5.5 CommandResult

使用 `06` 定义的 `CommandResult`。其中：

- `COMMITTED` 只证明目标 Aggregate 与 Outbox 已提交；
- `DUPLICATE` 返回第一次提交的 target/version/event refs；
- `REJECTED` 必须携带本文第 8 节 `ApiError`；
- 异步外部投递、Process Manager、Projection 或通知状态不进入 `COMMITTED` 判据；
- 创建命令成功后的新对象身份来自 envelope `targetRef`，不得由传输层临时生成另一个 ID。

## 6. Query API

### 6.1 Envelope 与一致性

所有公开 Query 使用 `06` 定义的 `QueryEnvelope<P>`。模块规格对每个 Query 声明允许的一致性：

```text
A = AUTHORITATIVE only
S = AUTHORITATIVE or SNAPSHOT_AT_LEAST
P = AUTHORITATIVE, SNAPSHOT_AT_LEAST or PROJECTION_OK
```

调用者请求比允许级别更弱的一致性时拒绝 `QUERY_CONSISTENCY_TOO_WEAK`，不静默升级后假装使用了 Projection。高风险 Authorization、Approval、Release、Completion 和 Reference Validation 一律为 `A`。

### 6.2 分页 Cursor

Cursor 是不透明、防篡改、有限期结构的编码结果，逻辑上绑定：

```text
CursorClaims
├── queryType
├── queryMajorVersion
├── scopeHash
├── requesterPurposeHash
├── normalizedFilterHash
├── sortDefinition
├── lastStableSortKey
├── sourceWatermarks[]
├── issuedAt
└── expiresAt
```

规则：

- Consumer 不解析或修改 Cursor；
- Cursor 不包含可读 Secret/敏感 External ID；
- Scope、Query、Filter 或 Purpose 不一致返回 `QUERY_CURSOR_SCOPE_MISMATCH`；
- 过期返回 `QUERY_CURSOR_EXPIRED`；
- `asOf` 与分页 Snapshot 必须保持一致，不允许翻页时漂移到新的权威版本；
- page size 受 `PayloadGuardPolicy` 限制，超限拒绝，不静默截断。

### 6.3 QueryResult

使用 `06` 定义的 `QueryResult<T>`。模块规格唯一维护 `T`：

- `NOT_FOUND` 和 `FORBIDDEN` 的对外折叠由安全 Policy 决定，响应时间和错误细节不得泄露对象存在性；
- `PROJECTION_OK` 必须返回 `sourceWatermarks` 和 `stalenessStatus`；
- `redactions` 使用字段路径、PolicyRef 和安全原因，不泄露原值；
- Query 不产生写入、状态推进、Attempt 或外部副作用；
- Query 数据中的可变对象必须带 `aggregateVersion`，不可变内容必须带精确 Version/Hash Ref。

## 7. Domain Event API

所有公开 Event 使用 `06` 定义的 `DomainEventEnvelope<P>`。模块规格只定义已发生事实 `P`。

Event Payload 必须遵守：

1. 包含 Consumer 决定是否读取精确对象所需的最小 Ref、旧/新状态或结果摘要；
2. 不复制 Aggregate 全量、文档正文、Token、Credential、隐藏推理或不必要个人信息；
3. 高风险事实使用 VersionedRef、ContentAddressedRef 或 SnapshotRef，不使用标题或 `latest`；
4. 相同 `eventId + payloadHash` Replay 幂等；相同 ID 不同 Hash Quarantine；
5. 同 Aggregate 发现 aggregateVersion 间隙时暂停该流并修复，不猜测事实；
6. Event 只能表达 Producer 已提交事实，不能表达“将成功”或把通知结果冒充业务完成；
7. Human Decision 事件必须引用已保存的 ActorSnapshot/AuthorizationDecision，不在 Event 中复制敏感授权材料；
8. External Attempt 事件的 `UNKNOWN` 与 `FAILED` 不得合并。

## 8. 错误 Contract

```text
ApiError
├── code: ReasonCode
├── category: Closed<VALIDATION | AUTHENTICATION | AUTHORIZATION | NOT_FOUND | CONFLICT | LIFECYCLE | POLICY | INTEGRITY | DEPENDENCY | EXTERNAL | INTERNAL>
├── safeMessage: SafeSummary
├── fieldViolations: FieldViolation[]
├── targetRef?: TypedReference
├── retryDisposition: Closed<DO_NOT_RETRY | RETRY_SAME_REQUEST | RELOAD_AND_REEVALUATE | NEW_COMMAND_REQUIRED | HUMAN_INTERVENTION_REQUIRED>
├── requiredAction?: SafeSummary
├── correlationId: UuidV7
└── diagnosticRef?: ExternalRef
```

共享错误码：

```text
API_REQUIRED_FIELD_MISSING
API_UNKNOWN_FIELD
API_VALUE_INVALID
API_PAYLOAD_LIMIT_EXCEEDED
API_CONTRACT_TYPE_UNKNOWN
API_CONTRACT_MAJOR_UNSUPPORTED
API_REQUIRED_EXTENSION_UNKNOWN
API_PAYLOAD_HASH_MISMATCH
AUTHENTICATION_REQUIRED
AUTHORIZATION_DECISION_REQUIRED
AUTHORIZATION_DECISION_INVALID
AUTHORIZATION_EXPIRED
AUTHORIZATION_REVOKED
HUMAN_ONLY_CAPABILITY
SCOPE_MISMATCH
PROJECT_SCOPE_MISMATCH
REFERENCE_INVALID
AGGREGATE_VERSION_REQUIRED
AGGREGATE_VERSION_CONFLICT
AGGREGATE_STATE_NOT_ALLOWED
IDEMPOTENCY_PAYLOAD_CONFLICT
QUERY_CONSISTENCY_TOO_WEAK
QUERY_CURSOR_INVALID
QUERY_CURSOR_EXPIRED
QUERY_CURSOR_SCOPE_MISMATCH
DEPENDENCY_UNAVAILABLE
EXTERNAL_OUTCOME_UNKNOWN
INTERNAL_CONTRACT_VIOLATION
```

模块特定错误在对应 `Module-Spec` 注册。错误码语义一旦发布不可复用；安全响应可以折叠 safeMessage，但审计记录必须保留原始内部分类和 correlationId。

## 9. Contract Version 与 Registry

### 9.1 Version

- 所有本阶段公开操作使用 `1.0`；
- Envelope 中 type 与 version 分字段保存；
- Required 字段新增、字段删除/重命名、closed enum 扩展、权限收窄或语义改变必须发布新 Major 或新操作；
- 新 Optional 字段只有在默认 absent 不改变旧 Consumer 语义时才允许 Minor；
- 历史 Event、Contract 和 Fixture 不重写。

### 9.2 构建期 Registry

实现必须从静态 Registry 生成或校验：

```text
ContractRegistration
├── contractKind: COMMAND | QUERY | EVENT
├── type
├── version
├── ownerModule
├── payloadSchemaRef
├── resultSchemaRef?
├── targetObjectType?
├── concurrencyMode?
├── allowedConsistency[]
├── authorizationPurpose
├── dataClassification
├── payloadGuardPolicyRef
├── deprecatedAt?
└── replacementType?
```

构建必须拒绝：重复 type/version、Owner 与 namespace 不一致、缺 Schema、未注册 objectType、Query 无一致性声明、Command 无授权 Purpose 或 Event 使用未来式语义。

## 10. 安全与数据最小化

- 所有 Envelope 必须有 Scope；Scope Hint 不替代权威对象归属解析。
- `Sensitive<T>` 只允许在加密传输和受控内存中出现；日志、普通错误、metrics label 和 Event 禁止记录原值。
- External Identity、Channel ID、Recipient 和 Provider ID 的原值按 Purpose 最小化，并使用加密/密钥化 Lookup Hash 持久化。
- Query 默认最小字段集；包含敏感字段的 projection 必须声明 Purpose 和授权。
- Payload Hash 不是加密；敏感 Contract 仍需要访问控制、存储加密和传输保护。
- AgentResult、Event、错误和审计均不保存 Chain of Thought、系统 Prompt、Credential 或长期 Capability Token。
- API Handler 不接受调用者提交的数据库列名、Schema、SQL、对象存储任意 Key、任意 URL 回调或任意命令字符串。

## 11. 设计 Gate

API Contract 进入用户审核前必须证明：

1. Catalog 中 200 个 `name@1.0` 在七个 Module Spec 中各出现且只出现一次；
2. namespace 与唯一 Owner 一致；
3. 每个 Command 有 target/concurrency、payload、authorization 和主要拒绝语义；
4. 每个 Query 有 payload、result 和允许一致性；
5. 每个 Event 有最小 payload，且不拥有其他模块的完成语义；
6. Human-only Approval、Release Authorization、关键 Fact/Baseline/Plan/Profile 激活不向 Agent 开放；
7. 不存在 `latest`、workspace file、飞书 message 或 Runtime Session 冒充强业务引用；
8. 每个 Module 有独立 Unit/Contract/E2E/Manual 测试文档，未执行项保持 `NOT RUN`；
9. Markdown 链接、代码块、重复名称和冲突标记检查通过；
10. 高层文档的当前阶段、阅读路由和验证基准已同步。

## 12. 已审核的基准选择

以下设计选择已由用户于 2026-08-13 审核通过，并构成 API Contract v0.1 `BASELINE`：

1. API Contract 保持 transport-neutral，不先承诺 REST、gRPC 或 MCP；
2. 创建对象使用 envelope 预分配 UUIDv7 `targetRef`，payload 不重复对象 ID；
3. 可变 Aggregate 的公开写命令默认强制 `expectedAggregateVersion`；
4. Query Cursor 的逻辑字段与防篡改/过期语义冻结，具体编码和密钥实现留到安全实施设计；
5. Payload 大小使用构建期 `PayloadGuardPolicy`，具体数值在实现前物理参数 Gate 冻结；
6. 模块规格可以用复用 DTO 定义一组相关操作，但每个公开名称必须有独立 Registry 条目；
7. API 只公开跨模块/外部稳定能力，Aggregate 内部辅助命令不自动升级为公开 API。

## 13. 当前状态

- 字段级 API 文档已完成本轮静态 `DESIGN VERIFIED`，并由用户于 2026-08-13 审核通过；验证证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)；
- 现有 200 项公开 Operation 已有机器可执行 JSON Schema、Schema-derived Type、Registry 和 v1.0 Compatibility Baseline；`pnpm contracts:check` 对其执行一致性检查并通过；
- 业务 Handler、业务 Fixture、Persistence 业务链和 E2E Runtime 仍未实现；
- 所有 Unit、Contract、Persistence、E2E、外部和人工运行验证均为 `NOT RUN`；
- 本阶段静态检查最多可标记 `DESIGN VERIFIED`，不得报告实现通过。

## 14. Issue #57 受控 Capability 边界

Issue #57 的 [`Contract-Decision-Matrix.md`](../decisions/enterprise-project-capabilities.md) 冻结了 Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot 和 Platform Reference 的受控 Application Capability 输入/输出、授权目的、版本语义和失败码，但本轮不把它们加入公开 `@1.0` Catalog。当前 API baseline 仍为 200 项；因此不生成新的 Registry Envelope、Type 或 Compatibility baseline，也不允许业务测试/Migration 以直写代替受控入口。

若未来用户决定将任一 Capability 公开为 Command/Query/Event，必须先更新对应 Module Spec 和本文的字段路由，再通过 Schema、生成类型、Catalog、operation metadata、兼容性审批和正/负 Fixture Gate。受控 Capability 的设计示例不属于当前可执行 API Fixture，不能把它们的设计检查写成 Runtime `PASS`。

## IM-06 兼容性增量

状态：TECHNICAL DESIGN APPROVED 2026-09-08，尚未进入Registry。#152–#154具体输入/输出在owning Spec 002/003/005/007设计附录；[TD-01–04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)已获批准，按依赖实施。首次构建采用新操作，避免改变build_context_snapshot@1.0必填ContractRef语义；Task typed definition采用create_task@2.0，避免以Minor或Handler默认值收窄旧CanonicalJson。

旧201项Registry、历史200项Compatibility Baseline、旧Envelope/Event/Query result Schema均不修改。新操作/版本必须按完整Envelope注册，新增Purpose由IdentityPolicy显式策略承载；新Ref objectType、PayloadGuard上限、错误码和discriminated union必须同步生成Schema/IDL与正负向fixture。不得让candidate名字进入当前operationCount，也不能以Schema仍accept旧payload宣称新旧Handler语义兼容已经验证。

新增Query只读且受Scope/Purpose裁剪；Slice捕获使用CREATE Command，避免Query产生不可审计写入。CAS expectedAggregateVersion只在Envelope，历史snapshotId/hash不充当CAS token；runtime bigint不能有损转Number。公开整数范围在实现前须与共享Envelope Schema一致，超界明确拒绝，不能借本设计暗改共享类型。
