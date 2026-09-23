# Zhiju Business Core Runtime Adapter Contract v0.1

版本：v0.1
日期：2026-08-17
状态：`BASELINE / DESIGN VERIFIED / USER PROGRESSION CONFIRMED / IMPLEMENTATION NOT STARTED`

文档角色：Runtime/Harness 原始协议与 Zhiju Core WorkOrder、Run、AgentResult 之间 Anti-Corruption 映射的唯一权威。业务对象、公开 API 名称和数据库所有权仍分别由高层基准、API v0.1/Module Spec 和 PostgreSQL Logical Model 维护；本文不得创建第二套 Task、Run、Completion、Approval 或 Release 语义。

---

## 1. 目标与非目标

本 Contract 回答：

1. 如何把冻结 WorkOrder 与 ContextSnapshot 安全投递给不同 Harness；
2. 如何把已安装 CLI 的 stdio/退出状态规范化为 Run 控制事实；
3. 如何处理 Lease、Fencing、幂等、Timeout、Cancel、Suspend、Resume、Retry 和 late result；
4. 如何形成可验证 AgentResult、权威 Usage 与 Provenance；
5. 如何在不泄露 Secret、Prompt 或 Chain of Thought 的情况下提供可审计进度；
6. 如何更换 Runtime 而不改变 Core 业务语义。

本阶段不定义：

- Runtime Adapter 代码、容器编排或数据库表；
- Provider Credential、账号采购、模型价格或生产限额；
- 通用 Agent Harness、通用 Workflow DSL 或模型路由平台；
- Canonical Document/Workbook Schema、Renderer 或飞书协议；
- Agent 的 Human Approval、Release Authorization 或高风险事实确认能力；
- SDK、App Server、Provider API 直连或内嵌 Runtime；
- 三个 CLI 的安装程序、升级器或账号凭据管理。

---

## 2. 冻结边界

```text
TaskExecution
  ├── WorkOrder / ContextSnapshot / Run / AgentResult / Usage
  └── business lifecycle and completion
             │ committed intent / public API
             ▼
IntegrationGateway
  ├── RuntimeAttempt / RawExternalReceipt / Quarantine
  └── AdapterHealthObservation
             │ provider-neutral adapter port
             ▼
CLI Runtime Adapter Host
  ├── ClaudeCodeCliDriver ──> installed `claude`
  ├── CodexCliDriver       ──> installed `codex`
  ├── OpenClawCliDriver    ──> installed `openclaw`
  └── future runtime
```

必须保持：

```text
Zhiju Project        != Runtime workspace/session/thread
Zhiju Task           != provider task/turn
Zhiju Run            != process ID alone
ArtifactRevision     != workspace file
Business Memory      != runtime transcript/memory
AgentResult accepted != WorkOrder completed
```

Runtime Adapter 是不可信外部执行边界。它可以观察并报告，但不能自行决定业务完成、事实确认、质量通过、批准、发布或生效。

---

## 3. 已安装 CLI 前提与证据边界

v0.1 的部署前提是目标用户或服务器已经安装三种客户端；Zhiju不下载、不升级、不嵌入它们，也不直连 Provider API。安装前提不等于运行可用：Adapter Host 启动和路由前仍须探测可执行文件、版本、非交互模式与认证状态，失败时报告 `UNAVAILABLE`，不得静默改用 SDK、API 或另一 CLI。

| CLI Profile | 官方事实 | v0.1 固定映射 | 当前证据状态 |
|---|---|---|---|
| Codex CLI | [Non-interactive mode](https://developers.openai.com/codex/noninteractive) 支持 `codex exec`、JSONL 事件、结构化输出与 resume，并默认复用 CLI 已保存的认证 | `codex exec --json`；需要结构化最终结果时附加 `--output-schema`；continuation 使用 `codex exec resume` | `OFFICIAL DOC VERIFIED / LOCAL NOT RUN` |
| Claude Code CLI | [Headless mode](https://code.claude.com/docs/en/headless) 支持 `claude -p`、text/json/stream-json、session metadata 与 JSON Schema structured output | `claude -p --output-format stream-json`；需要结构化最终结果时使用 `--json-schema`；continuation 只通过已验证的 CLI session 参数 | `OFFICIAL DOC VERIFIED / LOCAL NOT RUN` |
| OpenClaw CLI | [Agent CLI](https://docs.openclaw.ai/cli/agent) 提供 headless `openclaw agent exec`、JSON 输出和 session selector | `openclaw agent exec ... --json`；continuation 只通过已验证的 session selector | `OFFICIAL DOC VERIFIED / LOCAL NOT RUN` |

CLI Profile 必须记录精确 `adapterCode/adapterVersion/harnessId/harnessVersion`，不得只写产品名。Provider 文档或 CLI minor 变化不能自动改变已冻结的 Zhiju Contract。

---

## 4. Canonical Runtime Contract Family

```text
zhiju.runtime.execution_package@1.0
zhiju.runtime.dispatch_invocation@1.0
zhiju.runtime.normalized_event@1.0
zhiju.runtime.usage_record@1.0
zhiju.runtime.adapter_receipt@1.0
```

共同规则：

- Canonical JSON、SHA-256、明确 schema version 和 payloadHash；
- required/optional、null/unknown 语义沿用 API v0.1；
- 所有 Typed Reference 先做 type/scope/purpose/hash 验证；
- 未知 Major、未知 required extension 或 Hash 冲突必须拒绝/Quarantine；
- 原始 Provider payload 使用受控 ObjectLocator 保存，Event 只带最小安全摘要和 Hash；
- Contract、Secret、Continuation 和 Raw payload 分层存储，不能打包成一个日志对象。

---

## 5. Execution Package

Execution Package 是一次 Run 的只读、内容寻址执行输入，不是可变 workspace 文件夹。

```text
RuntimeExecutionPackage
├── header
├── packageId
├── enterpriseRef
├── projectRef
├── taskRef
├── workOrderRef
├── runRef
├── workOrderContractRef
├── contextSnapshotRef
├── capabilityGrantRef
├── executionPolicyRef
├── adapterPolicyRef
├── resultSchemaRef
├── materializationManifest
├── secretBindingRefs[]
├── issuedAt
├── expiresAt
└── packageHash
```

`materializationManifest`：

```text
MaterializationManifest
├── workOrderObject: ObjectLocator
├── contextObject: ObjectLocator
├── policyObjects[]: ContentAddressedObjectLocator
├── skillObjects[]: ContentAddressedObjectLocator
├── templateObjects[]: ContentAddressedObjectLocator
├── evidenceIndexObject?: ContentAddressedObjectLocator
├── workspaceInputObjects[]: ContentAddressedObjectLocator
├── allowedOutputRoots[]: WorkspacePathPolicy
└── manifestHash
```

规则：

1. `workOrderContractRef/contextSnapshotRef/capabilityGrantRef` 必须与 RunCreation 完全一致。
2. Package 中不得使用 `latest`、任意 URL、任意宿主绝对路径或可执行 Secret。
3. ObjectLocator 必须由 Adapter Host 通过已授权 resolver 获取；Agent 不直接选择对象存储 Key。
4. `secretBindingRefs` 只引用短期注入策略，不包含 Secret 值；Secret 不进入 Prompt、文件、Event、Result 或 transcript。
5. Materialization 后的 AGENTS.md/CLAUDE.md/Skill/Prompt 只是派生输入，不能扩大 WorkOrder。
6. Package 过期、Hash 不匹配或 Reference Validation 失败时不得启动 Runtime。

---

## 6. Adapter Port

```text
RuntimeAdapterPort
├── probe(profile) -> AdapterCapabilityObservation
├── dispatch(invocation) -> AdapterDispatchReceipt
├── cancel(control) -> AdapterControlReceipt
├── resume(control) -> AdapterControlReceipt
├── query(attemptRef) -> AdapterObservation
└── stream(attemptRef) -> RuntimeNormalizedEvent*
```

`query` 只用于 reconciliation/health，不得用 CLI 当前状态覆盖 Core 已提交历史。v0.1 的 `dispatch/stream/cancel/resume` 只能由 Adapter Host 直接启动和管理本地 CLI 子进程实现；Transport 差异不能泄漏到 Domain。

### 6.1 CLI Process Driver

```text
InstalledCliProfile
├── adapterCode
├── executableCode                 # codex | claude | openclaw
├── resolvedExecutablePath         # 部署配置解析后的受信绝对路径
├── observedCliVersion
├── versionConstraint
├── nonInteractiveArgvTemplate[]
├── inputTransport                  # STDIN | CONTROLLED_FILE
├── structuredOutputMode
├── continuationArgvTemplate[]
├── environmentAllowlist[]
├── terminationStrategy
└── profileHash
```

进程规则：

1. 直接启动已解析的可执行文件并传入由 Adapter 生成的 argv 数组；禁止经 `cmd /c`、PowerShell、shell 字符串或用户提供的命令模板二次解释。WorkOrder/Prompt 内容通过 stdin 或受控临时文件传入，不进入 argv。
2. 可执行文件路径只来自部署配置和启动探测，WorkOrder、Prompt、Provider payload 均不得覆盖它。
3. Adapter Host 设置受控 `cwd`、环境变量白名单、超时与输出大小上限；Secret 不进入 argv，CLI 自有认证由目标环境预先配置。
4. stdout 只进入版本化解析器，stderr 只进入脱敏诊断；未知行、混合协议、超限输出或结构化结果不合法时拒绝或 Quarantine，不从自然语言猜测成功。
5. Cancel/timeout 必须终止受管进程树并等待确认；“已发送终止信号”不等于 Run 已取消。
6. CLI session/thread 标识只作为加密 `ExternalRef` 保存；不得把本地认证文件、完整 transcript 或进程 ID 当成业务状态。

Adapter 不能接受：

- 任意 shell command 作为公开 API 字段；
- 未注册 model/provider/harness；
- 不受约束的 host path、network target 或 callback URL；
- 长期 Human credential 或可产生 Human-only 行为的 token；
- 不带 Run、Attempt、Lease/Fencing 与 Hash 的执行请求。

---

## 7. Dispatch Invocation

```text
RuntimeDispatchInvocation
├── runtimeAttemptRef
├── runRef
├── executionPackageRef
├── executionPackageHash
├── runtimeBinding
├── workspaceLeaseRef
├── executionLease
│   ├── leaseId
│   ├── fencingToken
│   ├── issuedAt
│   └── expiresAt
├── deadline?
├── stableIdempotencyKey
├── eventSinkBindingRef
├── requestedAt
└── invocationHash
```

稳定键：`runtime:{workOrderId}:{attemptNumber}`。

Dispatch 顺序：

```text
1. TaskExecution creates Run and lease/fencing
2. IntegrationGateway commits RuntimeAttempt + Outbox
3. Worker claims Attempt
4. Adapter validates package/profile/workspace/deadline
5. Adapter starts provider turn/session
6. Raw dispatch receipt is recorded
7. execution.start_run commits only after valid provider acknowledgement
```

同一稳定键与相同 Hash 返回原 Attempt；同一键不同 Hash 进入 `INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT`。进程超时只得到 `UNKNOWN`，必须 query/reconcile，不能立即创建第二个并行 active Run。

---

## 8. Workspace 与 Sandbox

每个 Run 使用独立 Workspace Lease：

```text
WorkspaceLease
├── workspaceRef: ExternalRef
├── runRef
├── rootPolicyRef
├── readOnlyInputRoots[]
├── writableOutputRoots[]
├── networkPolicyRef
├── toolPolicyRef
├── issuedAt
├── expiresAt
└── cleanupPolicyRef
```

规则：

1. 默认最小权限；只读任务不得获得写权限。
2. 其他 Enterprise/Project/Run workspace 不可见。
3. symlink/junction/reparse point 不能突破允许根。
4. 网络、MCP、Browser、Package install、Git push、外部消息等能力必须分别授权。
5. Provider 自身的 approval/sandbox 设置只能进一步收窄，不能扩大 Core grant。
6. Runtime 写出的文件始终是 WorkspaceOutput；只有通过 Core Command 创建并验证的对象才是 BusinessOutput。
7. Cleanup 失败保留隔离记录，不能递归扩大删除范围。

---

## 9. Normalized Runtime Event

```text
RuntimeNormalizedEvent
├── header
├── runtimeEventId
├── runtimeAttemptRef
├── runRef
├── sequence?: NonNegativeInt
├── kind
├── providerEventRef?: ExternalRef
├── runtimeSessionRef?: ExternalRef
├── continuationRef?: ExternalRef
├── leaseId
├── fencingToken
├── occurredAt?
├── receivedAt
├── safePayload
├── rawPayloadRef?
├── rawPayloadHash?
└── payloadHash
```

`kind`：

```text
DISPATCH_ACKNOWLEDGED
RUN_STARTED
HEARTBEAT
PROGRESS
INPUT_REQUIRED
USAGE_OBSERVED
RESULT_SUBMITTED
SUSPENDED
RESUMED
CANCEL_ACKNOWLEDGED
TERMINAL_OBSERVED
ERROR_OBSERVED
```

Event 规则：

- `runtimeEventId + payloadHash` Replay 幂等；同 ID 不同 Hash Quarantine。
- sequence 只在 Provider 保证同一 session 单调时使用；无 sequence 时用 Event ID 去重，不猜测全序。
- occurredAt 缺失保持 UNKNOWN；Core `receivedAt` 不冒充 Provider 时间。
- PROGRESS 只允许阶段、计数、安全摘要和 Ref；禁止隐藏推理、系统 Prompt、Secret、全文上下文和任意工具 stdout。
- INPUT_REQUIRED 必须映射成 `RuntimeInputRequired`，再由 Core 创建正式 InformationRequest。
- RESULT_SUBMITTED 只触发 AgentResult ingestion；不直接把 Run 标成 SUCCEEDED。
- Provider terminal/exit code 只是观察；TaskExecution 根据 result、cancel、timeout 和 policy 决定 Run transition。

---

## 10. Result Ingestion

Adapter 必须输出 `zhiju.contract.agent_result@1.0`，或输出可被确定性 mapper 转换的 Provider structured result。自然语言 final message 不能单独满足 AgentResult Schema。

```text
Provider output
  -> schema/size/hash guard
  -> runtime/run/lease/fencing binding
  -> deterministic provider mapper
  -> execution.submit_agent_result@1.0
  -> execution.accept_agent_result@1.0
  -> Run RESULT_RECORDED -> SUCCEEDED | INVALID_RESULT
  -> WorkOrder completion evaluation (separate)
```

必须满足：

1. 一个 Run 只接受一个 final AgentResult identity。
2. Result ID/Hash 相同重复提交幂等；同 ID 不同 Hash 是 replay conflict。
3. terminal、过期 lease 或旧 fencingToken 的 late result 进入 Quarantine。
4. Adapter 不能替 AgentResult 补造不存在的 BusinessOutput、Evidence 或 Usage。
5. Provider 输出截断、无法解析或 Schema 不匹配形成 `INVALID_RESULT/FAILED_EXECUTION`，不能包装成 COMPLETED。
6. Workspace diff 可以作为诊断/候选输入，但不是 ArtifactRevision。

---

## 11. Usage 与 Provenance

```text
RuntimeUsageRecord
├── runRef
├── runtimeAttemptRef
├── providerRequestRefs[]
├── inputTokens: ValueEnvelope<NonNegativeInt>
├── cachedInputTokens: ValueEnvelope<NonNegativeInt>
├── cacheWriteTokens: ValueEnvelope<NonNegativeInt>
├── outputTokens: ValueEnvelope<NonNegativeInt>
├── reasoningTokens: ValueEnvelope<NonNegativeInt>
├── toolCalls: ValueEnvelope<NonNegativeInt>
├── estimatedCost: ValueEnvelope<Money>
├── measurementSource
├── providerMeteringObservedAt?
├── reconciliationStatus
└── payloadHash
```

权威优先级沿用高层基准：Provider > Adapter > Harness > Agent self-report。缺失为 `UNKNOWN/UNAVAILABLE`，不是 0。估算费用必须带 currency、price schedule ref 和 `ESTIMATED` 标签，不能冒充账单。

Provenance 至少固定：Adapter/Harness/Provider/Model 版本、modelConfigHash、Execution Package Hash、WorkOrder/Context/Capability refs、skills/policies/templates、execution node 和 Runtime Session ExternalRef。Runtime Session 仅供诊断/continuation，不是业务恢复的唯一依据。

---

## 12. Suspend、Resume 与 Retry

```text
Resume = same Run + valid continuation + unchanged context/capability/binding
Retry  = new Run + new attemptNumber + new lease/fencing
```

同 Run Resume 的必要条件：

- Run 为 SUSPENDED，尚无 final AgentResult；
- blocking InformationRequest 已 RESOLVED；
- continuationRef 可用且不含 bearer secret；
- Execution Package、ContextSnapshot、Capability Token、RuntimeBinding 与 Model Binding 未变化；
- Token、Lease、Budget、Deadline 仍有效；
- Adapter Profile 明确声明安全 resume 能力。

以下情况必须 Retry：final `BLOCKED_INPUT`、Provider/Model/Harness fallback、Context 或授权变化、continuation 丢失、terminal Run、过期 Token/Lease、需要扩大 scope。

Resume/Retry 都不能改写旧事件、旧 Usage 或旧 Result。

---

## 13. Cancel、Timeout 与 Failure

Cancel 是两阶段事实：

```text
Core cancellation intent committed
  -> adapter cancel request
  -> provider acknowledgement or observation
  -> TaskExecution transition
```

- 请求发送成功不等于 Runtime 已停止。
- Provider 明确确认且执行停止后才可 `CANCELLED`。
- Timeout/连接断开/未知进程状态为 `UNKNOWN`；Lease 到期后可 `ABANDONED/TIMED_OUT`，不得虚假确认取消。
- Cancel 后收到的 final result 默认 Quarantine；显式 Recovery 不能无痕提升。
- Provider 错误分 `TRANSIENT/PERMANENT/POLICY/AUTHENTICATION/RESOURCE/UNKNOWN`，安全错误只返回稳定 code 和 diagnosticRef。
- Runtime 失败不回滚 WorkOrder；ExecutionPolicy 决定 same-provider Retry、cross-provider Fallback 或 Human Intervention。

---

## 14. CLI Capability Profile 与路由

```text
AdapterCapabilityProfile
├── adapterCode
├── adapterVersion
├── harnessId
├── harnessVersion
├── executableCode
├── observedCliVersion
├── invocationMode                 # LOCAL_PROCESS only in v0.1
├── supportedContractMajors[]
├── dispatchModes[]
├── eventModes[]
├── structuredResultModes[]
├── continuationModes[]
├── cancellationModes[]
├── usageFields[]
├── sandboxCapabilities[]
├── toolCapabilities[]
├── modelCapabilities[]
├── dataResidencyClass?
├── observationSource
└── profileHash
```

Router 固定顺序：

1. requiredHarness/allowedProvider/allowedModel 与 allowedCliProfile；
2. data class、network/tool/sandbox 与 compliance policy；
3. minimum capabilities、structured result 和 resume requirements；
4. adapter health、capacity、budget/deadline；
5. preferred order和 selection policy；
6. 保存 SelectionDecision 与拒绝原因。

不得静默 fallback。requiredHarness 不可替换；用户明确选择只能由 Project/Compliance Policy 拒绝。Health 只表示 Adapter 观察，不表示 Run 或业务成功。

---

## 15. Core API 映射

现有公开 API 映射：

| Runtime intent | IntegrationGateway | TaskExecution | 说明 |
|---|---|---|---|
| dispatch | `integration.request_runtime_dispatch@1.0` | `execution.create_run@1.0`、`execution.start_run@1.0` | Attempt 与 Run 分开 |
| dispatch receipt | `integration.record_external_receipt@1.0` | `execution.start_run@1.0` | Raw Receipt 不直接改变 Run |
| cancel | `integration.request_runtime_cancel@1.0` | `execution.request_run_cancel@1.0` | 请求不等于确认 |
| resume | `integration.request_runtime_resume@1.0` | 现有公开 API 只覆盖请求侧 | 同 Run transition 存在公开缺口 |
| input required | `integration.accept_inbound_envelope@1.0` | `execution.record_runtime_input_required@1.0`、`execution.open_information_request@1.0` | 控制事件不等于 final Result |
| final result | `integration.accept_inbound_envelope@1.0` | `execution.submit_agent_result@1.0`、`execution.accept_agent_result@1.0` | accepted != completed |
| retry/fallback | 新 RuntimeAttempt | `execution.schedule_work_order_retry@1.0`、`execution.create_run@1.0` | 必须新 Run |
| query/reconcile | `integration.get_runtime_attempt@1.0` | `execution.get_run_state@1.0` | 读取不写状态 |
| health | `integration.get_adapter_health@1.0` | 无 | 只读 Projection |

### 15.1 Additive API proposal（待用户审核）

Domain Model 已冻结但 API v0.1 未公开以下 TaskExecution 写操作：

```text
execution.record_run_heartbeat@1.0
execution.record_runtime_progress@1.0
execution.record_run_suspension@1.0
execution.resume_suspended_run@1.0
execution.record_run_usage@1.0
execution.acknowledge_run_cancellation@1.0
```

提案性质：新增操作，不修改现有 200 项操作的 payload、Owner 或语义；审核通过后 Catalog 从 200 增至 206，并同步 Module Spec/Test。审核前这些名字不是 API 基准，Adapter 实现也不得通过私有数据库写入绕过缺口。

---

## 16. 安全与数据最小化

1. Adapter 使用独立 RuntimePrincipal/ServicePrincipal；CLI 安装与登录态由用户或服务器预配置，智举不读取、复制、刷新或持久化 CLI Credential。
2. Capability Token 短期、单 Run、单 Project、单 Harness、单 scope；永不包含 Human-only capability。
3. Prompt injection、workspace 指令和 Runtime memory 都是不可信输入，不能改变 Core 授权。
4. 业务 Secret 只通过受控 secret binding 注入；禁止进入 argv、Prompt、stdout、Result、Event、metrics label 或 git diff。CLI 自有认证不属于 Execution Package。
5. Raw transcript 默认不进入 Business Core；如因审计保留，必须独立加密、受控、有限期且不用于业务真相。
6. Chain of Thought、系统 Prompt、内部策略全文不持久化；只保存安全摘要、结构化进度和必要 Provenance。
7. ExternalRef 原值加密/密钥化查找；Hash 不是加密。
8. Adapter 不能直接访问业务 Repository；所有业务写入回到 owning module public port。
9. Runtime 网络访问、MCP/tool、Browser、package install 和外部消息必须显式 allowlist。
10. 未知 Provider schema、超大 payload、反序列化异常、路径逃逸或同 ID 不同 Hash 一律拒绝/Quarantine。

---

## 17. Observability 与保留

允许指标：Attempt/Run 状态计数、延迟、heartbeat age、usage availability、error code、adapter version、model code、queue age。禁止把 Enterprise 名称、Project 标题、Prompt、External ID、文件名或正文作为 metric label。

日志必须关联 `correlationId/attemptRef/runRef/diagnosticRef`，不得依赖 Provider session ID 作为唯一键。Raw provider payload、transcript、workspace 和 continuation 的保留期分别配置；删除只影响外部诊断材料，不改写 Core 业务历史。

---

## 18. Adapter Conformance

一个 Adapter 只有在以下全部满足时才可标记 `CONFORMANT`：

1. 通过 Execution Package/Dispatch/Event/Result JSON Schema；
2. 相同 stable key/Hash 幂等，不同 Hash Quarantine；
3. Lease/Fencing/late result 负向场景通过；
4. Cancel/Timeout/UNKNOWN 不虚报；
5. Resume/Retry 边界通过；
6. Usage 缺失不伪造为 0；
7. Sandbox/Scope/Secret/Path/Network 负向测试通过；
8. AgentResult 与 BusinessOutput 验证通过；
9. 不保存 Chain of Thought 或长期 Human Credential；
10. 真实 Provider 的最小 E2E 和人工审计通过。

当前三个 CLI Driver Profile 均为 `NOT RUN`，不得标记 `CONFORMANT`。

---

## 19. 错误映射

Adapter 只返回安全、稳定、可分类的错误；Provider 原始错误进入受控 diagnostic payload，不直接暴露给业务调用者。

```text
HUMAN_ONLY_CAPABILITY
EXECUTION_RUN_LEASE_INVALID
EXECUTION_RUN_FENCING_TOKEN_STALE
EXECUTION_TERMINAL_RUN_IMMUTABLE
EXECUTION_AGENT_RESULT_REPLAY_CONFLICT
EXECUTION_LATE_RESULT_QUARANTINED
INTEGRATION_ATTEMPT_IDEMPOTENCY_CONFLICT
INTEGRATION_ATTEMPT_LEASE_INVALID
INTEGRATION_RUNTIME_RESUME_NOT_ALLOWED
INTEGRATION_RUNTIME_RESULT_LATE
INTEGRATION_EXTERNAL_OUTCOME_UNKNOWN
INTEGRATION_QUARANTINE_REQUIRED
```

Provider authentication/resource/policy 错误映射到共享 `ApiError` 的 `AUTHENTICATION/POLICY/EXTERNAL` category，并给出 `DO_NOT_RETRY/RETRY_SAME_REQUEST/HUMAN_INTERVENTION_REQUIRED`；不得把未知错误默认标为可重试。

---

## 20. 用户审核决策

1. v0.1 已确认采用 CLI-first：实现一个公共本地进程 Adapter Host，以及 Codex CLI、Claude Code CLI、OpenClaw CLI 三个 Driver Profile；SDK、App Server 与 Provider API 直连不进入本阶段。实现顺序为公共 Process Driver → 三个 Profile → 跨 Profile 路由/回退，顺序不表示产品优先级。
2. 是否接受第 15.1 节 6 个 additive TaskExecution Command，并把 Catalog 从 200 扩为 206。
3. Run Lease、Heartbeat、续期宽限、Cancel acknowledgement 和 Attempt reconciliation 的默认时长。
4. v0.1 是否允许同 Run Resume；若不允许，可统一降级为新 Run Retry，但不能复用旧 Run 身份。
5. Raw transcript 是否完全不落库，还是按高风险审计 Policy 受控短期保留。
6. 三种 CLI 在个人设备与服务器环境中分别采用何种预配置身份；智举只探测可用性，不拥有凭据生命周期。

---

## 21. 当前结论

- Harness-neutral Execution Package、Adapter Port、标准事件、Result/Usage/Provenance 和失败语义已形成草稿。
- 三个已安装 CLI Profile 只有官方文档事实，均未做本地版本、认证或真实调用验证。
- 现有 API 覆盖核心闭环，但缺少 6 个已由 Domain Model 预示的运行控制写操作；已隔离为待审核 additive proposal。
- Runtime Adapter、CLI Process Driver、Persistence、Credential、Sandbox、CLI E2E、负载与人工验收均未实现、未运行。


## IM-06 Human-operated 技术设计映射

关联#153/TD-02，状态TECHNICAL DESIGN APPROVED 2026-09-08。当前§15.1六项命令仍待独立决定；本轮不把它们纳入Catalog。设计Run record/finalize/expire与WO/Task reconcile由[Spec 003 §11](../module-specs/Module-Spec-003-TaskExecution.md#11-im-06-技术设计)定义；完整Runtime Attempt binding由[Spec 007](../module-specs/Module-Spec-007-IntegrationGateway.md#im-06-runtime-binding-query-设计)拥有。

受控Driver通过真实合成调用/ack建立SYNTHETIC_DRIVER Observation，Input/Output是可重复技术Fixture，不宣称Provider/CLI/Feishu验收。先提交Attempt再调用，UNKNOWN只调和原Attempt；start_run必须exact绑定且lease有效。result提交、record、validation、acceptance、finalize为独立owning事务，late/cancel/expiry在Run锁上裁决；lease到期的无ACK取消为ABANDONED，不是CANCELLED。未知Usage继续ValueEnvelope UNKNOWN/UNAVAILABLE，独立权威Usage写入本轮不实现。

### 受控 Driver 输入输出与调度

本 profile 细化 TD-02 已批准的 `SYNTHETIC / TECHNICAL ONLY` 替身，只用于受控技术 Fixture。它不是 §6.1 三个 CLI Profile 的 conformance 实现；不要求先实现完整 Execution Package/workspace/secret materialization，也不得填造这些尚未产生的 Ref/Hash。它不增加公开 Schema 或调用方可传入的控制字段。

| 边界 | 完整输入/输出及来源 | 校验与消费 |
|---|---|---|
| Driver 调用输入 | 已提交 RuntimeAttempt 的 attemptRef、原 RuntimeDispatchRequest 和 requestPayloadHash、不可变 invocationBinding 及 bindingHash；字段唯一来源为 Spec 007 RuntimeAttemptBindingView | IG Worker 从自有已提交事实读取，按 Spec 003 get_run_dispatch_binding 校验 Run/Contract/Context/Capability/RuntimeBinding/lease；传给 Driver 的是最小投影，不包括可变 status/ack、凭据、任意命令、路径或 callback URL |
| Fixture 本地配置 | 场景选择为“正常 ack + final”“延迟 ack”“ack 后延迟 final”；版本化的合成 RuntimeBinding、完整 AgentResultContract 样本及样本 Hash；释放屏障指定在 start/cancel/record/expiry 哪个实际提交或服务端期限之后 | 只属于受控测试配置，不进入公开 request，也不授予权限。Result 样本使用本次真实 Run 和 owning 输出引用；配置与 Hash 在调用前固定并随技术证据保存，不能同一次 invocation 中换样本 |
| Dispatch ack 输出 | 实际调用后 Driver 产生的 synthetic session ExternalRef、receipt ExternalRef、acknowledgedAt；安全原始 ack 内容绑定 attemptRef、runRef、leaseId、fencingToken、bindingHash 和 session | 这些 ExternalRef 标识本次实际发生的合成调用，不冒充 Provider 对象。IG 保存原始内容/Hash，通过既有 RawReceiptSubmission 建立 Receipt，之后在 Attempt 事务保存 Observation/成功状态/Outbox；跨 Aggregate 先提交 Receipt，再引用它，不跨 Root 原子写 |
| Final 输出 | 完整既有 AgentResultContract（Core §5.3–5.9）与 runtimeSubmissionRef: ExternalRef、原 invocation 的 fencingToken | Driver 实际释放样本时形成 submission 观察；Ingestion 通过 submit_agent_result 的既有三个 payload 字段接收。AgentResult 自身身份可新建，但指向 Run/Contract/Context/Capability/BusinessOutput 的 Ref 必须已存在；封存前不伪造自身 ContentAddressedRef |
| 无观察/超时输出 | 屏障未释放或回执丢失时没有 ack/Result 成功输出；IG 记录 UNKNOWN 与实际错误/时间 | UNKNOWN 不生成成功 Receipt、session 或 SUCCEEDED；不把测试“预期应成功”写成观察。只有读回原调用已发生的 ack 才能追加 reconciliation Observation，无法读回则等待 Run expiry |

AgentResult 的 header/schema/hash、FINAL、executionOutcome、provenance 和 submittedByRuntime 必须满足原 Core 契约；Driver 不能自行提供 Validation、Acceptance 或 Completion 的可信结论。正常控制链可使用合法 BLOCKED_INPUT/空业务输出样本，证明 Run 的执行边界，WorkOrder/Task 保持未完成；声称存在 BusinessOutput 的样本必须先由 owning Command 创建该对象，并由 Validator 重验。agentDeclaredUsage 仅保留 AGENT_DECLARED；无真实计量时省略 runtimeUsageRef，查询按既有 ValueEnvelope 显示 UNKNOWN/UNAVAILABLE，不以合成调用次数填造 token/cost。

三种调度只改变观察到达时机：正常场景在 ack 持久化且 start_run 提交后释放 final；延迟 ack 场景先让 dispatch 观察超时为 UNKNOWN，重放同键不得再次调用 Driver，之后只读回原调用（若已超出 Run lease，ack 即使存在也不能 start）；延迟 final 场景在 start_run 后保留原 payload，待 cancel 或 expire_run 实际提交后交给同一 Ingestion 边界。record 先到的取消反例由测试在 record 提交后发起 cancel；不通过 Driver 修改 Run 状态。

受控时序使用测试屏障和真实服务端时间。测试可以选取被显式批准/授权的有限期限 Policy，不能直接改表、改系统时钟、接受 caller now 或添加公开“强制到期”入口。需要并发竞争时用两个真实 owning 调用，记录各自成功/冲突结果；可重复性指同样输入和已记录提交顺序得到同样判定，不要求每次运行的 UUID/时间戳相同。

技术证据必须同时保留 Fixture 版本/Hash、实际输入 Hash、Driver 调用次数、ack/submission 原始内容 Hash 与 synthetic ExternalRef、屏障释放对应的已提交 Command Receipt，以及 owning Query 读回的 Attempt/Run/Result/Acceptance/Claim 结果。Claim 释放由 TE 的受控持久化验收在 owning 边界证明，不新增跨模块 Claim Query。缺少任何实际执行的项目保持 NOT RUN，静态样本不能充当 Driver 调用证据。ID/Hash 重复重放只复用原观察；同 ID 异 Hash、错 Scope/绑定、过期 lease 或旧 fencing 必须拒绝/隔离，禁止“修正”原 payload 后伪装同一次成功。

输入/预期矩阵见 [TE WI-03](../module-tests/Module-Test-003-TaskExecution.md#wi-03-控制入口与拒绝反例)、[IG WI-03](../module-tests/Module-Test-007-IntegrationGateway.md#wi-03-driver-证据来源细化)。API/Gate 的完整适用性判断见 [设计决定 §9.2](../decisions/task-execution-human-operated.md#92-控制入口与-im-dg-006-适用性)。以上不批准 §15.1 六项操作、Runtime 默认 Policy、真实 CLI/Provider/Feishu、同 Run Resume 或 fallback，也不批准 TD-05–07。


### #219 READY 静态协议 selector 补充（待审）

状态：`HUMAN DESIGN APPROVED 2026-09-22 / STATIC SELECTOR REGISTERED 2026-09-22 / INDEPENDENT REVIEW PENDING / RUNTIME NOT RUN`。已将本节既有 Human-operated synthetic 技术协议登记为 `te.human_operated.synthetic@1.0` 的构建期 VersionedRef selector；完整身份及 closed descriptor 见 [Spec 003 §21.6](../module-specs/Module-Spec-003-TaskExecution.md#issue-219-ready-selectors)，objectType/Owner 见 Contract Catalog 的 #219 补充。Owner 仍为 IntegrationGateway；contracts 承载静态描述，不接管 RuntimeAttempt 或 Driver。

该 selector 只允许 Validator 证明冻结计划采用已知技术协议和显式 synthetic Harness/Model 控制值。它不表示三种 CLI 的 conformance、已安装可执行程序、认证、Provider 可用、RuntimeBinding、Attempt 或真实调用；这些必须在后续 owning Run/Dispatch 边界证明。READY profile 不启用 fallback、同 Run resume 或租约默认值，也不修改本协议已批准的控制时序。

### 首个受控 Run 的 RuntimeBinding 映射（提案，2026-09-22）

状态：`T2 / PROPOSED / INDEPENDENT DESIGN REVIEW APPROVE 2026-09-22 / HUMAN DESIGN APPROVED 2026-09-22 / NOT IMPLEMENTED`。为了让已发布 `RunCreation.runtimeBinding` 与 `RuntimeDispatchRequest.runtimeBinding` 绑定同一可执行技术配置，首版仅接受：`adapterCode='te.human_operated.synthetic'`、`adapterVersion='1.0'`、`harnessId='zhiju.runtime.synthetic'`、`harnessVersion='1.0'`、`provider='synthetic'`、`modelId='synthetic'`、`modelConfigHash=SHA-256(canonicalization-v1({}))`，且不含 `executionNodeRef`。配置 `{}` 是闭合集，没有 Provider 参数；版本字段表示此受控 Driver 协议映射，不表示 CLI 或模型部署版本。TE、IG 和 Driver 输入逐字段保持一致，变更任何成员须引入新受控 profile，不得沿用同一 version/hash 偷换。

本映射与上面的 `te.human_operated.synthetic@1.0` 静态 selector 同时成立才可选择 Driver；selector 证明协议描述，实际调用与 ack 仍按本节已有流程由 IG owning Attempt/Observation/Raw Receipt 证明。运行阶段只证明首个 synthetic Run START，Result、真实 Provider/CLI、Usage 与业务完成继续 `NOT RUN`。
