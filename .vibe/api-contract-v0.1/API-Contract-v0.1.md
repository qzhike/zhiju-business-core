# Zhiju Business Core Command / Query / Event API Contract v0.1

版本：v0.1
日期：2026-08-13
状态：`CURRENT API CONTRACT BASELINE / DESIGN VERIFIED / USER REVIEWED 2026-08-13 / IM-03 WI-01 CONTROLLED CAPABILITY DECISION RECORDED / IM-06 #157/#158 CONTRACT SCHEMA AND REGISTRY DELIVERED 2026-09-10 / #159 ANSWEREDINFORMATIONREFS ARRAY COMPATIBILITY FIXED 2026-09-10 / #165 DRAFT VERSION PINS @1.1 CONTRACT DELIVERED 2026-09-11 / #181 POLICYVERSION PAYLOADGUARD PARAMETERS + SD-181-1 APPROVED 2026-09-13 / BUSINESS IMPLEMENTATION NOT STARTED`

文档角色：公开 Command、Query、Event 的共享字段规则、执行语义、错误、兼容性、安全与验证要求的唯一权威。具体操作名称及唯一 Owner 以 [`../high-level-docs/06-typed-references-contract-catalog-v0.1.md`](../high-level-docs/06-typed-references-contract-catalog-v0.1.md) 为准；每个操作的 payload/result/event 字段由对应 `Module-Spec` 唯一维护。

## 1. 目标与非目标

本文把高层业务 Contract 落到可生成 Schema、Fixture、SDK 和 Handler 骨架的字段级 API，但不绑定传输协议。

本阶段冻结：

- 统一字段类型与 required/optional 语义；
- Command Target、并发、授权、幂等和提交结果语义；
- Query 一致性、分页、脱敏和结果语义；
- Domain Event 最小事实 Payload 与 Replay 语义；
- 公开错误结构、兼容规则和 Schema Registry 要求；
- 七模块当前 211 个公开 Contract 的字段级路由（历史兼容基线为 200 项）。

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

所有文本、集合、Payload 和分页大小上限由构建期 `PayloadGuardPolicy@1.0` 注册并进入生成 Schema；Handler 必须在解析大对象或执行授权查询前应用 Guard。具体数值属于实现前部署参数，本 Contract 不允许实现以“无限制”作为默认值。已批准并实现的数值见 [§157 补充方案](#157-payloadguard-注册补充方案)；#176 两个 PolicyVersion 操作的有限参数提案与实测依据见 [§#181 PolicyVersion PayloadGuard 注册方案](#181-policyversion-payloadguard-注册方案)，已于 2026-09-13 获批并由 #183 静态注册；Handler 与业务运行仍未实现。

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

### 5.5.1 Operation-specific CommandResult data

只有需要返回精确新对象的 Command 才声明 operation-specific data；其余 Command 只通过 `targetRef`、`resultingAggregateVersion` 和 `emittedEventRefs` 表达成功。

- Command 以显式注册的 `resultSchemaRef` 声明该 data 的形状；未注册的命令不接受 data，Registry 的 Result 校验以 `operationResultRegistry` 拒绝，不能以 `resultReferences` 元数据代替可执行 Schema；
- 声明了 Result Schema 的命令，其 `data` 必须通过该 Schema 校验，并与 envelope `targetRef` 一致：创建类命令返回的对象身份必须等于 `targetRef` 的 objectType/objectId/Scope，不能只比较 objectId；
- Query 的 Result Schema 继续由 operation 身份派生；Command 的 Result Schema 是显式增量，不改变任何未声明命令的既有返回形状；
- Result Schema 只证明形状与跨字段一致，不证明对象已提交、当前授权有效或副作用完成。

`execution.build_initial_context_snapshot@1.0` 与 `@1.1` 是首个使用该扩展的 Command；`identity.record_policy_version@1.0`（#183）是第二个：`data.contextSnapshotRef` 必须是已注册的 canonical `zhiju.execution.context_snapshot` `SnapshotRef`；`zhiju.project.context_snapshot` 仅作为 Core v1.0 历史读回身份。权威 `execution.get_context_snapshot@1.0` 的输入 Ref 与结果 Ref 必须逐字段相等。字段与失败语义见 [Spec 003 §11.2.5.3](../module-specs/Module-Spec-003-TaskExecution.md#11253-initial-context-commandresult-与-canonical-snapshotref)；Handler、幂等与持久化验收仍为 `NOT RUN`。

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

Issue #159 对 `execution.build_context_snapshot@1.0` 的
`ContextBuildRequest.answeredInformationRefs` 执行兼容性对账：该字段按 §3
的 `TypedReference[]` 保持普通有序数组语义，当前 Schema 不再施加
`uniqueItems`；空数组、单项和重复合法 Ref 均由公共 `ContractRegistry` 接受。
数组元素仍逐项执行 `TypedReference` 形状校验，非数组或畸形 Ref 继续拒绝；
同一请求的 `sourceSlices` 仍为非空唯一集合，`workOrderContractRef` 仍为必填。
这是恢复已声明契约的 `COMPATIBLE_MINOR` 放宽，不新增 operation/version、
不改变 Payload Hash/Canonicalization 规则，也不排序、截断或静默去重输入。
历史 v1.0 Compatibility Baseline 的 Schema 与 Fixture 保持冻结，不重写。

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

1. Catalog 中当前 211 个已注册 `name@version` 在七个 Module Spec 中各出现且只出现一次；
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
- 历史 200 项公开 Operation 已有机器可执行 JSON Schema、Schema-derived Type、Registry 和 v1.0 Compatibility Baseline；当前 #157/#158 增量后 Catalog/Registry 为 205 项，#165 再增加三个 @1.1 兼容操作至 208 项，#175 再增加一个 @2.0 操作至 209 项，#183 再注册 `identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0` 至 211 项，#159 仅放宽既有字段的数组接受集合，`pnpm contracts:check` 对当前集合执行一致性检查并通过；
- 业务 Handler、业务 Fixture、Persistence 业务链和 E2E Runtime 仍未实现；
- #157/#158/#165/#175/#183 的 Schema/Registry、PayloadGuard 条目与生成检查、以及既有 WI-01 Persistence gate 已通过；#181 提供两个 PolicyVersion 操作的 PayloadGuard 有限参数与实测依据，#183 按该已批准参数完成静态注册（Schema/Registry/Catalog/生成类型/fixture）；业务 Handler、E2E、外部和人工运行验证仍为 `NOT RUN`；
- 本阶段静态检查最多可标记 `DESIGN VERIFIED`，不得报告实现通过。

## 14. Issue #57 受控 Capability 边界

Issue #57 的 [`Contract-Decision-Matrix.md`](../decisions/enterprise-project-capabilities.md) 冻结了 Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot 和 Platform Reference 的受控 Application Capability 输入/输出、授权目的、版本语义和失败码，但本轮不把它们加入公开 `@1.0` Catalog。该历史阶段 API baseline 为 200 项；因此这些 Capability 未生成新的 Registry Envelope、Type 或 Compatibility baseline，也不允许业务测试/Migration 以直写代替受控入口。

若未来用户决定将任一 Capability 公开为 Command/Query/Event，必须先更新对应 Module Spec 和本文的字段路由，再通过 Schema、生成类型、Catalog、operation metadata、兼容性审批和正/负 Fixture Gate。受控 Capability 的设计示例不属于当前可执行 API Fixture，不能把它们的设计检查写成 Runtime `PASS`。

## IM-06 兼容性增量

状态：TECHNICAL DESIGN APPROVED 2026-09-08；#157 的两项 Source Slice 操作、#158 的两项 @1.0 WorkOrder Draft/initial Context 操作与 #165 的三个 @1.1 兼容操作已交付 Schema/Registry，其中 #157 另有已批准 Guard；#175 的 `execution.create_task@2.0` 与 #183 的两个 PolicyVersion 操作也已注册；其余增量尚未注册。#152–#154具体输入/输出在owning Spec 002/003/005/007设计附录；[TD-01–04](../decisions/task-execution-human-operated.md#7-技术增量与决定边界152154)已获批准，按依赖实施。首次构建采用版本化新操作，避免改变build_context_snapshot@1.0必填ContractRef语义；Task typed definition采用create_task@2.0，避免以Minor或Handler默认值收窄旧CanonicalJson。

保留既有 @1.0 操作与历史 200 项 Compatibility Baseline 的兼容性；#157 与 #158 各新增两项后 Registry 为 205 项，#165 再新增三个 @1.1 兼容操作至 208 项，#175 再新增 `execution.create_task@2.0` 至 209 项，#183 再注册 #176 的两个 PolicyVersion 操作至 211 项（静态契约；Handler、授权与持久化仍 `NOT RUN`）。旧 Envelope/Event/Query Result 的接受集合不收窄。新操作/版本必须按完整Envelope注册，新增Purpose由IdentityPolicy显式策略承载；新Ref objectType、PayloadGuard上限、错误码和discriminated union必须同步生成Schema/IDL与正负向fixture。不得让candidate名字进入当前operationCount，也不能以Schema仍accept旧payload宣称新旧Handler语义兼容已经验证。

新增Query只读且受Scope/Purpose裁剪；Slice捕获使用CREATE Command，避免Query产生不可审计写入。CAS expectedAggregateVersion只在Envelope，历史snapshotId/hash不充当CAS token；runtime bigint不能有损转Number。公开整数范围在实现前须与共享Envelope Schema一致，超界明确拒绝，不能借本设计暗改共享类型。

2026-09-09 已批准的 TD-01 期限补充由 [Spec 003 §11.2.4](../module-specs/Module-Spec-003-TaskExecution.md#1124-创建期限与冻结期限) 拥有：待注册的 WorkOrderDraftSnapshot 和 get_work_order_draft Result 增加可选 expiresAt，缺省与显式 null 不等价；既有 create_work_order/freeze_work_order payload、Core WorkOrder 和 WorkOrderBecameReady 字段不变。原样继承期限与消费时未到期属于 Handler/持久化跨字段语义，Schema 接受合法字段形状不证明该语义已验证。历史 Compatibility Baseline 不重写，新增运行测试保持 NOT RUN。#165 已将该 DRAFT/initial Context 分支以 @1.1 形式注册，旧 @1.0 合法调用保持兼容。

`execution.get_work_order_draft@1.0` 与 `execution.build_initial_context_snapshot@1.0` 已按 TD-01 注册为 TaskExecution 的 AUTHORITATIVE Query 与 ContextSnapshot CREATE Command。两项新增操作的 WorkOrderDraftSnapshot、InitialContextBuildRequest、精确 Source Slice/Policy Ref 与 ProjectContext Snapshot Ref 由 Module Spec 003 及其生成 Schema 拥有；本次不新增 PayloadGuard Policy，业务期限继承、引用存在性和授权运行语义继续保持 NOT RUN。

### #165 DRAFT VersionPins 与首次 Context 的 @1.1 兼容增量

`create_work_order@1.1`、`get_work_order_draft@1.1` 与 `build_initial_context_snapshot@1.1` 与旧 @1.0 操作并存。@1.1 DRAFT 使用 `InitialWorkOrderDraft` 和不含 `projectContextContractRef` 的 `DraftVersionPins`；该完整 Context Ref 只在 CTX-1 成功提交后进入 Frozen WorkOrder Contract。候选顶层 `contextSnapshotRef` 与嵌套 `versionPins.projectContextContractRef` 必须逐字段相等，比较 canonical object type、objectId、snapshotId、Scope 以及 contentHash 全部字段。Schema、Registry、生成类型、fixture 与纯契约跨字段校验已同步；Handler、migration、真实 PostgreSQL 业务链和运行验收保持 `NOT RUN`。

### #166 Builder Policy ref 绑定

本次不新增公开 operation、Purpose、Catalog 数量或 migration。`execution.build_initial_context_snapshot@1.0` 的 `builderPolicyRef` 继续由 Schema 精确限定为 `zhiju.identity.policy`；候选生成的 ProjectContext projection 与冻结 WorkOrder VersionPins 必须复制同一 `VersionedRef`。通用 `VersionedRef` 仍不携带 `contentHash`，避免改变既有 @1.0 Typed Reference 家族；TaskExecution 的 Context Builder Policy metadata 另存 IdentityPolicy exact snapshot 的 `contentHash/effectiveFrom/supersededAt`，并在 candidate assembly、Validator、Freeze 逐次重验。

历史 Core v1.0 fixture 中的 `zhiju.context.policy` 通过兼容读回保持可解析，不能作为新 WI-02 entry 的输出；`identity.policy` 等未注册 namespace 不能出现在新 entry。Ref 的 objectType、objectId、versionId、Scope、解析 Hash 或有效期任一缺失/不一致都 fail closed。此跨字段语义不由标准 Schema 单独证明，也不宣称业务 Handler、授权运行或真实 PostgreSQL 验收已执行。

### #167 Initial Context Result 与 canonical SnapshotRef

`execution.build_initial_context_snapshot@1.0` 与 `@1.1` 注册显式 `resultSchemaRef`，通过 §5.5.1 的扩展返回 `data.contextSnapshotRef`，不再只以 `resultReferences` 描述返回引用。Result Schema 固定 `kind=SNAPSHOT`、`objectType=zhiju.execution.context_snapshot`，并完整要求 `objectId`、`snapshotId`、`contentHash` 与 Project Scope（`enterpriseId` 与 `projectId` 均必填）；CommandResult `targetRef` 必须与返回 Ref 的 canonical objectType、objectId 和 Scope 一致，双方同时缺少 `projectId` 不构成合法结果。该 Project Scope 要求只属于新增的 Initial Context Result Ref Schema 与 canonical 绑定，通用 `ScopeRef` 与既有 Query 的接受集合不变。

`zhiju.project.context_snapshot` 只是 Core v1.0 历史读回身份，不由新入口产生，也不能仅凭 `objectId` 与 canonical 名称互换。authoritative `execution.get_context_snapshot@1.0` 的既有 Schema、接受集合与历史 namespace 读回语义不变，其请求 Ref 与结果 Ref 必须逐字段相等。旧 `execution.build_context_snapshot@1.0` 保持必填 `workOrderContractRef` 语义且不注册 operation-specific Result Schema。本次不新增公开 operation、Purpose、Catalog 数量或 PayloadGuard Policy；Schema、Registry、生成类型与纯契约正反例已同步，对象存在性、幂等、Handler、migration 与真实 PostgreSQL 业务验收保持 `NOT RUN`。

### #168 Initial Context 期限上界

`InitialContextBuildRequest.expiresAt`（两个入口版本已有可选字段）只表示该 Context 的有效期上界，不改写 WorkOrder Root/Contract 的创建期限，也不改变 `WorkOrderBecameReady` 的字段形状。显式期限超过 WorkOrder 期限、任一被消费 Source Slice 的 `validUntil` 或当前 Builder Policy 的有限上界时一律拒绝，不静默截断为最小值；请求缺省时 effective expiresAt 取有限上界最小值，无有限上界时保持缺省并明确不等于无限授权。effective expiresAt 写入 ProjectContext Snapshot 的可选 `expiresAt` 与 INITIAL `context_snapshot_build` metadata，并随完整 payload Hash 固定；Builder 发布、Validator 判断、Freeze 提交与 Run 消费前均以受信服务端时间重验。

本次不新增公开 operation、Purpose、Catalog 数量、PayloadGuard Policy 或 Core 本体字段；旧 @1.0 合法调用与历史 Compatibility Baseline 保持可接受，期限组合属于跨字段语义，Schema 接受字段形状不证明该语义已验证。Schema、Registry、生成类型、fixture 与纯契约正反例已同步；期限 Handler、migration、真实 PostgreSQL 业务链与人工验收保持 `NOT RUN`。

### #176 Policy 版本解析与授权依赖（提案）

状态：`TECHNICAL DESIGN APPROVED 2026-09-12 / DESIGN VERIFIED / CONTRACT REGISTERED 2026-09-13 (#183) / HANDLER, AUTHORIZATION AND SCOPED PERSISTENCE IMPLEMENTED 2026-09-13 (#186) / DOWNSTREAM CONSUMERS NOT RUN`，设计见 [决定 §12](../decisions/task-execution-human-operated.md#12-176-首批-policyevaluator-解析与授权依赖) 与 [Spec 001 §13](../module-specs/Module-Spec-001-IdentityPolicy.md#13-176-policy-版本身份与解析-port-设计)。本项提出 IdentityPolicy 的两个新入口：`identity.record_policy_version@1.0`（payload `policyRef`、`policySetVersion`、`policySchemaRefs`、`policyDocument`、`effectiveFrom`、可选 `supersedesRef`；注册 operation-specific Result Schema 返回精确 `SnapshotRef<zhiju.identity.policy_version>`）与 AUTHORITATIVE Query `identity.resolve_policy@1.0`（payload 固定 canonical `zhiju.identity.policy`，Purpose `identity.policy.resolve_policy`）。二者已由 #183 按 §9.2 完整静态注册，Catalog 由 209 增至 211；Handler、授权与持久化仍未实现，历史 200 项 Compatibility Baseline、旧 `record_policy_snapshot@1.0` 条目与其 Platform 读取路径都不改写。

新增 Purpose `identity.policy.record_policy_version` 与 `identity.policy.resolve_policy` 必须在 public-api 与 compatibility metadata 两个来源中一致登记，并注册到版本化 capability/policy；`dataClassification=INTERNAL`，若某 profile 将来允许承载客户材料必须重新分类；两个新操作的有限额构建期 PayloadGuard 技术 Policy 已按 #181 的已批准参数注册为共享条目 `identity.policy_version@1.0`（`maxEnvelopeBytes=262144`、`maxResultBytes=266240`、`maxStringCodePoints=16384`、`maxArrayItems=1024`、`maxObjectProperties=256`、`maxDepth=32`、`maxRequestedKinds=64` 且显式非适用；数值不得在实现中另行替换或取等值），SD-181-1 由这两个操作自己的字段 Schema 执行。首版四个 profile 的 schema 身份由新的构建期 registry 版本承载（见 [Spec 001 §13.5](../module-specs/Module-Spec-001-IdentityPolicy.md#135-授权profile-schema-注册与失败审计)），既有 registry 条目与旧命令接受集合不变。企业级版本事实与其正文不得写入 Platform `policy_snapshot`（该表 RLS 无 enterprise/project 条件），必须落在带 Scope 的 FORCE RLS 新表并经受授权 Query 读取；RLS 不替代授权。解析结果内联返回 `policyDocument`，通用 `VersionedRef` 继续不携带 `contentHash`。对象存在性、授权、幂等、Handler、migration 与真实 PostgreSQL 业务链仍为 `NOT RUN`；后续实现须按已批准设计与明确的实现 Issue Scope 交付。

### #181 PolicyVersion PayloadGuard 注册方案

状态：`TECHNICAL DESIGN APPROVED 2026-09-13 / DESIGN VERIFIED / PARAMETERS REGISTERED 2026-09-13 (#183) / HANDLER IMPLEMENTED 2026-09-13 (#186)`。本方案与 SD-181-1 已于 2026-09-13 完成独立技术审查并获人类设计验收批准（[人类批准记录](https://github.com/qzhike/zhiju-business-core/pull/182#issuecomment-5647186487)），对应设计 revision `0f596d1f74d9d306bf8a7884ca8adf1f5203d26d`；这是已批准设计基准；操作与参数已由 #183 静态注册，Handler 与真实 PostgreSQL 读回已由 #186 交付（下游消费位置仍 `NOT RUN`）。仅适用于 #176 提出、#183 已注册的 `identity.record_policy_version@1.0` 与 `identity.resolve_policy@1.0`。参数、适用边界、实测依据与验证矩阵的权威文本在 [Spec 001 §13.3.1/§13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1331-payloadguard-技术-policy参数与适用边界181-提案) 与 [Module-Test 001](../module-tests/Module-Test-001-IdentityPolicy.md#181-policyversion-api-payloadguard-验证矩阵提案待批准)；本节只固定共享 API 层的集成边界，不重复参数表。本项不改变 `ep.context_source_slice@1.0` 的既有参数、不新增全局默认上限，也不改变任何已注册操作的接受集合。

```json
{ "type": "identity.policy_version", "version": "1.0" }
```

两个操作都以该 `{type, version}` 作为自己的 `payloadGuardPolicyRef`，共享同一个构建期技术条目（登记后位于 `contracts/registry/payload-guard-policies.v1.json`）：两个操作唯一的可变规模载体是同一份 `policyDocument`，共享条目把"写入端放行则读取端必须放行"变成单点不变量。该引用是 §9.2 `ContractRegistration` 的技术字段，不是业务 `TypedReference`，不进入 `references`/`resultReferences`，不需要数据库行或 `contentHash`。

规则要点：

- **计量对象**：`validateOperation` 以完整请求 Envelope 计量（Command/Query 一致，含全部 Envelope 字段、payload 与内联 `policyDocument`）；`validateOperationResult` 以 `CommandResult.data` / `QueryResult.data` 计量。两者都是紧凑 JSON 的 UTF-8 字节数，inclusive 边界，与 §157 口径相同。
- **执行位置**：复用 `ContractRegistry` 的 Guard 执行点与 `payloadGuard` keyword，先于结构 Schema，也先于 Handler 的授权、幂等与 CAS；构建期与运行期加载同一实现，未知 Policy 或未加载 Guard 的校验器拒绝编译，禁止仅作 annotation 忽略。
- **写入/读回关系（定式）**：结果预算**以"请求预算 + 固定余量"声明**，不是两个独立数值：`maxResultBytes = maxEnvelopeBytes + 4096 = 266240`。证明只需结果侧增量有上界：设 `C_req`/`C_res` 为去掉 `policyDocument` 后的请求与结果字节，两侧共有且逐字节相同的字段（`policyRef`、`policySetVersion`、`policySchemaRefs`、`effectiveFrom`）相消，故 `C_res − C_req ≤ R_only`（结果专有字段总量，请求专有部分恒 ≥ 0）。`R_only` 的每个成员都是有界形状（`scopeRef`、canonical `SnapshotRef`、`contentHash`、闭集 `useStatus`，以及 SD-181-1 限定的两个时刻），实测上界 **820**。于是任意合法写入都满足：读取帧 `= (C_req + |D|) + (C_res − C_req) ≤ 262144 + 820 = 262964 ≤ 266240`。**该推导不使用请求侧最小值**，因此不受请求侧字段编码变化影响。当前契约下，满足逐字段回显与绑定约束的合法写入在等值预算对照中也能通过；此前记录的"按写入边界合法提交的 Project 版本读回 262153 字节并被拒绝"不适用于当前契约（2026-09-13 事实更正，见 [Spec 001 §13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1332-样本计量与尺寸依据181) 与 [Issue #183 对账记录](https://github.com/qzhike/zhiju-business-core/issues/183#issuecomment-5649915272)），4096 作为已批准的固定余量保留，本项不改变公开接受集合或参数。该推导与逐字段上界见 [Spec 001 §13.3.1/§13.3.2](../module-specs/Module-Spec-001-IdentityPolicy.md#1331-payloadguard-技术-policy参数与适用边界181-提案)；§13.3.2 的 2098/1398 等数值是代表性样本，不参与该推导。除下一项的字段约束外，本项不需要分页、截断或额外 Result 通道等结构变更，也不得让读取路径返回部分结果。
- **SD-181-1（2026-09-13 随本方案一并获批的字段约束）**：两个操作的 payload 与结果中每个 `UtcInstant`（`effectiveFrom`、`supersededAt`、`checkedAt`）序列化为至多毫秒精度的 canonical UTC 时刻（≤ 24 code point），由这两个操作自己的 Schema 以长度上界执行，亚毫秒输入在写入边界拒绝、不截断。共享 `UtcInstant` 定义、既有操作接受集合与 `compareUtcInstants` 的变长小数能力**不变**。缺少该约束时 `R_only` 的上界不成立：`supersededAt`（= 后继 `effectiveFrom`）与 `checkedAt` 只受 `maxStringCodePoints` 约束，各可达 16384 code point，`R_only` 变为约 **33540**（约 33 KiB），远超 4096 余量；实测反例是（在当时的等值结果预算下）一个 260046 字节正文的合法前驱被 90 字节后继取代后读回 262441 字节；在现行 266240 下该规模的拒绝依据是时刻长度约束本身。已评估但不采纳的替代方案是把余量提到约 33 KiB（读取预算约 296 KiB）——它让单个时刻字段可占约 16 KiB，且任何新增变长结果字段都会再次打破保证。SD-181-1 把 `R_only` 压到 820，使余量与字段级细节解耦；余量 4096 与 SD-181-1 解决不同项，缺一不可。
- **结果侧变长字段必须逐个有界**：`policyRef.objectType` 与 `policyVersionRef.objectType` 由 §13.2 的 canonical 名称以 `const` 编码固定（不能只靠 `maxStringCodePoints`）；`policySetVersion`、`policySchemaRefs`、`policyDocument`、`effectiveFrom`、`scopeRef` 必须是请求侧的逐字段相等回显；`contentHash` 形状固定。任何新增结果字段或放宽 SD-181-1 都必须重算并重跑 §13.3.2 的边界复核。
- **错误**：沿用 `ContractValidationResult`、`keyword=payloadGuard`、`params.rule/limit` 与 JSON Pointer；不新增业务错误码，不改写既有错误语义，错误不携带原始内容。
- **单值上限独立于字节预算**：`maxStringCodePoints` 按 code point 限制单个字符串值与对象键，实测可在总字节数远低于 262144 时先触发（16384 通过、16385 拒绝）；该值复用 #157 已批准的同名技术值，不得由字节预算推导，也不得在实现中绕过。
- **非适用维度**：`maxRequestedKinds` 是 #157 的字段专属上限，对这两个操作不构成裁决；它不在本文档被声明为"可省略"，也不表示无限额。

上述参数与 SD-181-1 已取得独立设计审查结论与人类批准，随后续明确 Scope 的两个操作 Schema/Registry 一并实现；本 PR 不注册操作、不写入参数文件。批准与审查证据保留在对应 Issue/PR。

### #175 Task v2 create 注册

`execution.create_task@2.0` 与 `execution.create_task@1.0` 并存。@2.0 的 Envelope 固定 `targetRef` 为 `zhiju.execution.task` 且为 CREATE（不接受 `expectedAggregateVersion`），Payload 为 `projectRef: ObjectRef<zhiju.project.project>; definition: TaskDefinitionV2; initialAssignee?`，Purpose 按 Spec 003 §11.1 与 §3 的字段设计取 `execution.task.create`。@1.0 在 Registry/metadata 中登记的 Purpose 仍是历史 `task.execution.create_task`，本次不修改该既有条目；同一操作族的两个 Major 因此暂时持有不同 Purpose 字符串（`task.execution.create_task` / `execution.task.create`），待 IdentityPolicy 实际承载 Purpose 时需按 owning Spec 收敛——本项不生成该决定。`TaskDefinitionV2` 的字段集合与 `TaskDefinition` 相同，其中 `expectedOutputSpec`（`ExpectedOutput[]`，复用 Core `ExpectedOutput`）与 `completionCriteria`（非空 `TaskCriterionV1` 集合）替换为注册的 closed shape；`inputRefs` 按 §2 的已批准 `TypedReference[]` 注册为普通数组，不复用 @1.0 payload 的 `uniqueItems` 历史实现偏差，`dependencyTaskRefs` 仍为 Set。

五类 `TaskCriterionV1` 的 closed Schema、criterionType 与三个 bindings 分支的唯一对应、未知字段与任意 `expectedCondition` 表达式由注册 Schema 拒绝；重复 criterionId、重复 outputSlot 与未解析的 output-slot 绑定由纯契约校验拒绝。`evaluatorRef` 保持通用 `VersionedRef`，不新增 objectType 或 PayloadGuard Policy：本次不新增 Catalog objectType，只新增一个公开 operation（Catalog 208 → 209）。`create_task@1.0` 的 Schema、接受集合与历史 200 项 Compatibility Baseline 均不改变；Evaluator 存在性/支持版本、Policy 有效性、真实授权、Handler、migration、业务持久化与人工验收保持 `NOT RUN`。

### #157 PayloadGuard 注册补充方案

状态：`APPROVED 2026-09-09 / SCHEMA AND GUARD IMPLEMENTED`；设计决定见 [TD-01 §8.5](../decisions/task-execution-human-operated.md#85-157-payloadguard-补充方案)。仅适用于已注册的 project.capture_context_source_slice@1.0 与 project.get_context_source_slice@1.0；不改变旧 Schema 或全局默认上限。

#### 技术 Policy 与参数

技术参数唯一维护在 `contracts/registry/payload-guard-policies.v1.json`，静态注册 `ep.context_source_slice@1.0`；operation 的 payloadGuardPolicyRef 使用 `{type, version}` 精确匹配该构建期条目。这是技术 Registry 引用，不是业务 TypedReference，不需要数据库 Policy 行或虚构 Hash。参数全部必填、为有限正整数，未知字段、重复身份和缺失引用使构建失败。

| 参数 | 已批准值 | 适用范围与依据 |
|---|---:|---|
| maxEnvelopeBytes | 262144（256 KiB） | 两项完整请求 Envelope；采用 PostgreSQL §5.5 的 Command 建议预算并覆盖 Envelope 开销，Query 采用相同预算 |
| maxResultBytes | 4194304（4 MiB） | read 完整 Result.data，即 `{slice,useStatus,checkedAt}`；采用 Snapshot 建议预算，不含尚未实现的传输 QueryResult wrapper |
| maxStringCodePoints | 16384 | 所有字符串值和对象键，包括 CanonicalJson 叶节点；为引用/元数据提供有限技术预算 |
| maxArrayItems | 1024 | 每一个数组；不改变普通数组的顺序或重复语义 |
| maxObjectProperties | 256 | 每一个 JSON object，含 CanonicalJson；限制宽对象 |
| maxDepth | 32 | 根容器深度为 1；每进入一个 object/array 加 1，scalar 不增加容器深度 |
| maxRequestedKinds | 64 | capture.payload.requestedKinds 的专属上限；允许空集且 uniqueItems=true，不把 Schema 的 NamespaceCode 改为业务 kind 闭集 |

结构预算与文本/集合数值为本次批准的技术选择，尚无负载测量背书；它们不表示业务最大事实数、来源种类数或可用期限。超限一律拒绝，不截断、分页、自动对象化或返回部分 Slice；未来业务 capture 无法装配合法结果时必须失败，不能改写已捕获的不可变内容。

#### Guard 算法与 Schema 集成

- 在公共 ContractRegistry.validateOperation 与 validateOperationResult 中执行。新操作先按显式静态 Policy 对输入做有界 JSON 树检查，再执行结构 Schema；Guard 不读取授权、数据库或对象存储。失败不进入结构递归或后续业务调用。
- 深度检查使用有界/迭代遍历，检查对象键、每个字符串、数组长度和对象成员数；拒绝循环、undefined、非有限数字、bigint、函数和其他非 JSON 值，不用 JSON.stringify 的忽略/转换行为接受非法输入。公共输入要求 JSON tree，不支持自定义类或带 accessor 的对象。
- 字节数为合法 JSON tree 的紧凑 JSON 序列化 UTF-8 字节数（无额外空白、无 Unicode 正规化），包括引号、转义、键名和标点；不使用 JS UTF-16 length。它是资源计量，不改变既有 Canonicalization/ContentHash 算法。遍历/编码可提前停止在超限处，不能先对任意深度对象完整递归序列化。
- 上限为 inclusive：等于上限通过 Guard，超过 1 拒绝。字符串按 Unicode code point 计数，与 JSON Schema maxLength 口径一致。JSON number 使用现行序列化形式；不新增数字业务语义。
- 标准 JSON Schema 能表达的 requestedKinds.maxItems/uniqueItems 由技术 Policy 生成。递归通用 Guard 以项目自定义断言 keyword `payloadGuard` 挂在两项新 Envelope 与 read Result 根，值为精确 Policy Ref；运行时与构建期 Ajv loader 共同注册相同实现。该 keyword 必须执行，禁止仅作为 annotation 忽略；未知 Policy 或未加载 Guard 的校验器必须拒绝编译。
- keyword 覆盖通用字符串/数组/对象/深度和字节数，复用原 Source View `$ref`，不递归改写共享旧 Schema。生成器识别该资源断言，TypeScript 继续生成既有命名类型；类型本身不声称静态证明资源限制。对外 Schema 使用方需加载该 keyword，不能只依赖标准 Ajv 证明完整验证。
- Guard 错误沿用 ContractValidationResult，keyword=`payloadGuard`，instancePath 为 JSON Pointer（正确转义 `~`、`/`），params 包含 rule/limit；总字节超限定位根 `''`，其他超限定位对应值。错误不携带原始内容。非法 JSON 的 rule=`jsonValue`。不新增业务错误码或改变旧 API 错误语义。

#### 最小 Registry 扩展与兼容

现有 `public-api.v1.json` 为新操作增加 targetObjectType/concurrencyMode（Command）、allowedConsistency（Query）、authorizationPurpose、dataClassification、payloadGuardPolicyRef 和引用声明；生成 public-api.ts 并通过 getOperation 可检查。Purpose/Classification 与现有 operation-compatibility-metadata 声明必须一致，禁止两个来源静默分叉。共享元数据类型对旧操作保持可选，新操作构建检查为必填，不能为缺值注入 Service 通配授权或无限额 Policy。

为两项新操作增加静态 Ref 声明，记录 path、kind、objectType；Schema 必须逐项执行对应约束。复用已有 objectType 名称，并登记唯一新增 ContextSourceSlice 的 Owner=enterprise-project；只校验声明涉及的类型，不扩大为重建全部历史 TypedReference Catalog。构建检查重复 type/version、namespace/Owner、Schema 完整性、Query Result、元数据和 Guard/Ref 引用，保留原数量断言并净增 2。

CREATE Envelope 必须省略 expectedAggregateVersion，targetRef 为 ObjectRef<ContextSourceSlice>；Query 仅接受 AUTHORITATIVE。具体字段 Ref 由 [Spec 002 注册绑定](../module-specs/Module-Spec-002-EnterpriseProject.md#157-注册元数据绑定) 拥有。上述新操作约束不应用于旧 201 项 Envelope，也不改旧动态 get_project_context_source 的接受集合。
