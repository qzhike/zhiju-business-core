# Zhiju Business Core Feishu Channel Contract v0.1

版本：v0.1
日期：2026-08-13
状态：`CURRENT FEISHU CHANNEL DRAFT / DESIGN VERIFIED / USER REVIEW PENDING / IMPLEMENTATION NOT STARTED`

文档角色：飞书原始事件、消息/文件/卡片 API 与 Zhiju Core 之间 Anti-Corruption 映射的唯一权威。IntegrationGateway 的业务所有权和公开 Command/Query/Event 仍由 [`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md) 与 API v0.1 基准维护；本文不得创建第二套 Task、Approval、Release 或业务完成语义。

## 1. 目标与权威边界

本文冻结：

- 飞书应用、事件接收方式与安全校验顺序；
- 允许的事件/API Surface、关键原始字段和版本策略；
- 飞书用户、租户、群、消息、话题、文件和卡片的 ExternalRef 规则；
- 私聊/群聊/话题到 Enterprise、Project、Task、WorkOrder、InformationRequest、ApprovalRequest 和 Release 的 Binding；
- 入站消息、附件、卡片动作到现有 Core API 的映射；
- 出站消息、回复、文件、交互卡片、普通通知和正式 Release 的回执链；
- 重复、乱序、撤回、转发、用户离群、Bot 被移除、群解散、Timeout 和部分失败语义；
- 最小权限、敏感标识、Credential、日志、保留和 Quarantine 边界。

本文不定义：

- 飞书应用真实 App ID、Secret、Verification Token、Encrypt Key 或 Callback URL；
- HTTP Handler、SDK、数据库、Outbox Worker、对象存储、病毒扫描器或部署配置；
- Runtime Adapter、Renderer Adapter 或 Workspace UI；
- 飞书审批产品本身；正式业务 Approval 仍由 QualityGovernance 拥有；
- 复杂文档 Diff、Evidence 审核或表格编辑；这些使用 Workspace Deep Link；
- 保留年限、内部 Payload Guard 数值、重试次数或告警阈值等物理参数。

## 2. 官方 Provider Surface 与证据

本稿以 2026-08-13 获取的飞书开放平台官方文档和本地 `lark-cli event schema` 为协议事实来源。实现时必须把实际应用版本、权限和事件配置重新导出为 Fixture；本文中的 URL 不能替代上线前兼容验证。

| 能力 | 官方事实 | v0.1 采用 |
|---|---|---|
| 事件接收与安全 | [接收事件](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/encrypt-key-encryption-configuration-case?lang=zh-CN)：Webhook 可用 `X-Lark-Request-Timestamp`、`X-Lark-Request-Nonce`、原始 body 和 Encrypt Key 校验 `X-Lark-Signature`；加密事件需解密 | 生产基准使用 v2.0 Webhook + Encrypt Key；先验签、再解密、再解析 |
| 接收消息 | [接收消息](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive?lang=zh-CN)：事件 `im.message.receive_v1`；特殊情况可能重复；明确要求按 `message_id` 去重，不依赖 `event_id` | 消息幂等键使用 app/tenant/message_id；event_id 只保留为投递观察 |
| 消息内容 | [接收消息内容结构](https://open.feishu.cn/document/server-docs/im-v1/message-content-description/message_content) | v0.1 规范化 text/post/image/file/audio/media；其他类型显式拒绝或 Quarantine |
| 撤回消息 | [撤回消息](https://open.feishu.cn/document/server-docs/im-v1/message/events/recalled) 提供 `message_id/chat_id/recall_time/recall_type` | 记录来源撤回事实，不物理删除已接收业务记录 |
| 发送消息 | [发送消息](https://open.feishu.cn/document/server-docs/im-v1/message/create?lang=zh-CN) 返回 message/chat/root/parent/thread/type/time 等字段 | `code=0` 且关键响应字段一致才产生 Raw Delivery Receipt；不等于已读/业务完成 |
| 回复消息 | [回复消息](https://open.feishu.cn/document/server-docs/im-v1/message/reply?lang=zh-CN) 支持 `reply_in_thread` 和最长 50 字符 `uuid`，相同 uuid 在 1 小时内去重 | 内部 stable key 派生最长 50 字符 providerUuid；REPLY/REPLY_IN_THREAD 精确绑定源消息 |
| 获取消息 | [获取指定消息](https://open.feishu.cn/document/server-docs/im-v1/message/get?lang=zh-CN) | 只用于允许的补充读取/回执核对，不抓取整个聊天历史作为 Business Memory |
| 获取资源 | [获取消息中的资源文件](https://open.feishu.cn/document/server-docs/im-v1/message/get-2?lang=zh-CN) 要求 message_id/file_key 匹配，单资源不超过 100 MB | 资源进入受控 Staging 后计算 Hash/大小/MIME；不保存临时 URL |
| 上传文件 | [上传文件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/file/create) 返回 file_key，单文件不超过 30 MB | 上传成功只产生资源 Raw Receipt；随后成功发送消息才表示目标会话已接收投递 |
| 卡片交互 | [处理卡片回调](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/handle-card-callbacks?lang=zh-CN) 建议使用 `card.action.trigger` | 只接受新版 callback；旧 `card.action.trigger_v1` 不进入 v0.1 |

### 2.1 允许的入站事件

| Event Type | 关键 Provider 字段 | 业务用途 | 外部幂等键 |
|---|---|---|---|
| `im.message.receive_v1` | header app/tenant/event；sender；message_id/chat_id/chat_type/msg_type/content/root_id/parent_id/thread_id/create_time/mentions | 私聊、群聊、话题消息和附件入口 | `feishu:message:{app}:{tenant}:{message_id}` |
| `im.message.recalled_v1` | header；message_id/chat_id/recall_time/recall_type | 来源撤回与影响标记 | `feishu:event:{app}:{tenant}:{event_id}` |
| `card.action.trigger` | header；operator；action tag/value/form；context open_message_id/open_chat_id；callback token | 显式交互动作 | `feishu:card:{app}:{tenant}:{event_id}` |
| `im.chat.updated_v1` | header；chat_id；before/after change；operator | Binding 重新验证候选 | `feishu:event:{app}:{tenant}:{event_id}` |
| `im.chat.disbanded_v1` | header；chat_id；operator | 撤销/挂起 Channel Binding | `feishu:event:{app}:{tenant}:{event_id}` |
| `im.chat.member.bot.deleted_v1` | header；chat_id；operator | Adapter 不再可投递，Binding 挂起 | `feishu:event:{app}:{tenant}:{event_id}` |
| `im.chat.member.user.added_v1` | header；chat_id；users/operator | 可观测成员变化，不自动授权 | `feishu:event:{app}:{tenant}:{event_id}` |
| `im.chat.member.user.deleted_v1` | header；chat_id；users/operator | 后续动作重新授权；历史不改写 | `feishu:event:{app}:{tenant}:{event_id}` |

未列事件、旧事件版本或缺少 required provider field 的 Payload 进入 `INTEGRATION_INBOUND_CONTRACT_UNSUPPORTED`/Quarantine，不按“结构差不多”猜测。

### 2.2 允许的核心 API 操作

| 操作 | Provider Endpoint | 作用 | 成功的最小外部证据 |
|---|---|---|---|
| 发送消息 | `POST /open-apis/im/v1/messages` | 向 chat/open_id 发送 text/post/interactive/file | code、message_id、chat_id、msg_type、create_time |
| 回复消息 | `POST /open-apis/im/v1/messages/{message_id}/reply` | 回复或以话题回复 | 上述字段 + parent/root/thread（Provider 返回时） |
| 获取指定消息 | `GET /open-apis/im/v1/messages/{message_id}` | 安全补充读取/核对 | message_id、sender、chat_id、body hash、状态/时间 |
| 获取消息资源 | `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}` | 下载 image/file/audio/media 字节 | HTTP/Content-Type/Disposition、bytes hash、size |
| 上传文件 | `POST /open-apis/im/v1/files` | 为出站 file 消息准备 file_key | file_key、source checksum、upload time |
| 延迟更新卡片 | `POST /open-apis/interactive/v1/card/update` | 使用短期 callback token 更新交互反馈 | Provider response、message/card correlation、updatedAt |

所有 Provider API 都由 IntegrationGateway Adapter 调用。业务模块不得引入飞书 SDK、Provider DTO 或 Token。

## 3. 传输与认证 Contract

### 3.1 生产接收路径

```text
HTTPS Webhook raw request
    ↓ reject oversized/stale transport request
verify X-Lark-Signature over timestamp + nonce + encryptKey + raw body
    ↓
decrypt encrypted body when configured
    ↓
validate schema=2.0 / app_id / tenant_key / event_type / Verification Token
    ↓
canonicalize provider payload and calculate payloadHash
    ↓
claim external idempotency key
    ↓
integration.accept_inbound_envelope@1.0
```

规则：

1. 验签必须使用原始 body；不得先 JSON parse/重排后验签。
2. Timestamp 允许偏差、Nonce 重放缓存和 Request 最大值是实施前安全参数，必须有失败测试，不在本文写死数值。
3. Encrypt Key、Verification Token 和 App Secret 只来自受控 Secret Store/KMS，不进入数据库 Contract、日志、Event、Metric Label 或错误响应。
4. `header.app_id + header.tenant_key` 必须命中启用的 Adapter Account；未知组合拒绝。
5. URL Verification challenge 只在独立配置 Handler 中处理；不得进入业务 InboundEnvelope。
6. 长连接可以作为开发或未来生产 Adapter Variant，但必须生成完全相同的规范化 Envelope、幂等键和审计字段；不能绕过 account/event/schema 校验。

### 3.2 飞书账户与外部身份

```text
FeishuAccountKey
├── providerCode: FEISHU
├── appIdLookupHash
├── tenantKeyLookupHash
└── adapterAccountVersion

FeishuSubjectKey
├── accountKey
├── subjectKind: OPEN_ID
├── subjectLookupHash
├── encryptedOpenId?
└── observedTenantKeyLookupHash
```

- v0.1 以 `open_id` 作为应用内 Subject External ID；同一用户在不同应用可能有不同 open_id，因此必须和 Adapter Account 一起归一化。
- `user_id/union_id` 只能作为受保护的补充 Provider Identifier，不替代唯一映射策略，不进入普通 Event/日志。
- `identity.resolve_principal@1.0` 找不到有效映射时，事件可以保存为安全 InboundEnvelope，但不能执行项目 Query/Command。
- Bot/Service 发出的消息默认不转为 Human Intent，避免回声循环；需要接收其他 Bot 时必须进入独立 Policy 和 allowlist。

## 4. 规范化 Inbound Contract

```text
FeishuInboundEnvelope
├── providerSchema: "2.0"
├── eventType
├── adapterAccountRef: ExternalRef
├── providerEventRef: ExternalRef
├── semanticIdempotencyKey
├── occurredAt?
├── receivedAt
├── actorExternalRef?
├── conversation: FeishuConversationRef?
├── message: FeishuMessageRef?
├── normalizedContentRef?: ContentAddressedRef<ChannelContent>
├── attachmentDescriptors: FeishuAttachmentDescriptor[]
├── authenticationMetadataRef
├── rawPayloadRef: ObjectLocator
├── payloadHash
└── dataClassification

FeishuConversationRef
├── accountExternalRef
├── chatExternalRef
├── chatType: P2P | GROUP
├── threadExternalRef?
└── rootMessageExternalRef?

FeishuMessageRef
├── messageExternalRef
├── replyToExternalRef?
├── rootMessageExternalRef?
├── senderExternalRef
├── messageType
├── providerCreateTime
└── providerUpdateTime?
```

`rawPayloadRef` 是受控 ObjectLocator，不是公开 URL。Raw Payload 的保留、加密和访问由数据分类/Retention Policy 决定；系统不得无业务必要保存完整聊天历史。

### 4.1 Message 幂等修正

飞书官方文档明确要求 `im.message.receive_v1` 按 `message_id` 去重，不能依赖 `event_id`。因此：

- `header.event_id` 仍作为 Provider Delivery Observation 保存；
- `externalEventRef` 的 `externalId` 对消息接收使用规范化 `message_id`；
- 同 message_id/same canonical hash 返回原 Inbound 结果；
- 同 message_id/different canonical hash 进入 Quarantine；
- 同一字节文件出现在不同 message_id 时仍保留两个 Source Origin，不按文件 Hash 吞掉保管链。

## 5. Channel Binding Contract

### 5.1 Binding 层级

```text
ACCOUNT
└── P2P or CHAT Binding
    └── THREAD Binding?
        └── businessContextRefs?
```

规则：

1. 默认不把任意私聊、群聊或话题自动绑定 Project。
2. P2P 只提供已映射 Principal 的个人 Channel；Project 上下文必须由显式选择或可验证 Deep Link/Interaction Contract 提供。
3. CHAT Binding 可以绑定一个 Enterprise/Project 和 Purpose；不得因为用户在群中就授予该 Project 权限。
4. THREAD Binding 可以继承同一 active CHAT Binding 的 Enterprise/Project，但 Task、WorkOrder、InformationRequest、ApprovalRequest 或 Release 必须通过 `businessContextRefs` 显式绑定。
5. 一个 Binding 内所有业务引用必须属于同一 Enterprise/Project；跨项目引用拒绝。
6. `runtimeContextExternalRef` 只帮助追踪 Adapter/Runtime 对话，不是授权、Task/Run 身份或业务引用。
7. Binding 创建或变更调用 `integration.bind_channel_context@1.0`，要求 Human-only 或精确 Human BusinessDecision；撤销/挂起保留历史。

### 5.2 Binding 不授予权限

每次入站业务动作都必须重新执行：

```text
resolve Feishu open_id → HumanPrincipal
resolve active ChannelBinding → candidate Scope/context
load authoritative target ownership
identity.authorize_command / project access query
validate interaction nonce + exact target/hash/version
issue Core Command or Query
```

群成员、群管理员、消息发送者、被 @ 用户和卡片可见者都不自动获得 Core Role/Capability。

### 5.3 生命周期

| Provider 变化 | Binding 行为 | 历史行为 |
|---|---|---|
| 用户加入群 | 只记录观察，不新增授权 | 无历史变化 |
| 用户离开/被移除 | 该用户后续动作重新授权并通常拒绝；Binding 本身不必删除 | 既有 Command/Approval/Receipt 保留 |
| Bot 被移除 | Binding 进入 SUSPENDED；待发 Attempt 失败或 UNKNOWN | Core Task/InformationRequest/Release 不回滚 |
| 群更新 | 重新验证 chat/thread/policy；高风险变化触发 SUSPENDED 候选 | 原 ExternalRef/Receipt 保留 |
| 群解散 | Binding REVOKED；不再发送 | 业务对象、Origin 和审计保留 |
| 跨项目转发 | 新消息在目标 Binding 下重新认证、授权和分类 | 保留源 ExternalRef；不继承源 Project 权限 |

## 6. 入站消息与 Intent 映射

### 6.1 支持的消息类型

| msg_type | 规范化行为 | 业务边界 |
|---|---|---|
| `text` | 解析文本、mentions 和 reply/thread context | 普通自然语言是 Intent Candidate，不自动成为 Approval/Release |
| `post` | 规范化文本块、mentions、受控链接和资源描述 | 不把富文本 HTML/JSON 当可信命令 |
| `image` | 提取 image_key，按资源流程 Staging | 只形成 SourceMaterial Candidate/附件 |
| `file` | 提取 file_key/file_name，下载并校验 | 文件名不是身份，file_key 不是 Core ObjectRef |
| `audio` | 下载原始资源；转写属于未来受控服务 | 不从未验证转写直接产生高风险命令 |
| `media` | 下载视频/封面资源描述 | 不自动分析或接受为 Evidence |
| `interactive` | 只通过 `card.action.trigger` 处理交互 | 不从卡片正文猜测动作 |

`folder/sticker/system/location/share/todo/vote/merge_forward` 和未知类型在 v0.1 不映射业务写入。若 Provider 允许安全保留元数据，则记录 SafeSummary；否则拒绝/Quarantine。尤其 folder 无可下载字节时不得伪造 SourceMaterial。

### 6.2 Intent 到现有 Core API

| Channel Intent | 前置验证 | Core API/结果 | 禁止快捷方式 |
|---|---|---|---|
| 创建任务 | Principal、Project Binding、TaskDefinition confirmation、授权 | `execution.create_task@1.0` | 文本消息 ID 不能成为 Task ID；模糊文本不直接 READY |
| 上传客户资料 | Principal、Project、资源 Staging/Hash/安全、分类 Purpose | `project.register_source_material@1.0`，安全通过后另行 `accept_source_material` | 收到文件不等于 CustomerMaterial/Baseline |
| 回答 InformationRequest | 精确 requestRef、AnswerSpec、responder、nonce、期限、Scope | `execution.submit_information_answer@1.0`；是否 resolve 由 TaskExecution | ANSWERED 不等于 RESOLVED；terminal Run 不 Resume |
| 查询任务/运行/请求 | Principal、Scope、最小字段、允许 consistency | `execution.get_task_board_slice@1.0`、`execution.get_run_state@1.0`、`execution.get_information_request@1.0` | Projection 不用于 Approval/Completion |
| 请求取消 | 精确 active Run、nonce、授权、expected version | `execution.request_run_cancel@1.0` | 卡片成功不表示 Runtime 已取消 |
| 继续工作 | 根据权威 Run/InformationRequest 状态选择 Process | Answer resolve 后新 Context/Run；仅非 terminal 安全状态可经 Core 触发 `integration.request_runtime_resume` | final BLOCKED_INPUT 绝不恢复旧 Run |
| 提交 Review 操作 | 精确 issue/revision/hash、角色、nonce | `quality.propose_issue_resolution@1.0`、`quality.verify_issue_resolution@1.0`、`quality.close_review_issue@1.0` | 卡片不关闭未验证 Issue |
| 提交 Approval | HumanPrincipal、ApprovalRequest、Revision/Bundle Hash、Human-only Capability、single-use nonce | `quality.submit_approval_decision@1.0` | 普通“可以”或 Agent actingFor 永远无效 |
| Release Authorization | HumanPrincipal、Release/RRS/Package Hash、Human-only Capability、single-use nonce、Policy | `release.authorize_release@1.0` | 卡片可见/点击不绕过事务内 authoritative recheck |
| 查询项目状态 | Principal、Project access、Purpose、Redaction | `project.get_project_context_source@1.0`、`project.get_project_board_slice@1.0`、`execution.get_task_board_slice@1.0`、`quality.get_open_blocking_issues@1.0`、`release.get_release@1.0` | 不在群里返回未授权受限正文 |
| 无法确定 Intent | 保存 Inbound + Safe Candidate，回复澄清/确认卡片 | 不发业务 Command | 不按模型置信度静默写业务状态 |

## 7. 附件 Intake Contract

### 7.1 入站流程

```text
message_id + file_key/image_key
    ↓ provider ownership/match check
GET message resource
    ↓ bounded streaming to controlled Staging
calculate content hash + byte size + detected MIME
    ↓ malware/content safety/integrity interface
create immutable origin descriptor
    ↓ authorized project command
project.register_source_material@1.0
    ↓ later validation
project.accept_source_material@1.0
```

规则：

1. Provider 的 100 MB 下载上限是外部能力上限，不是 Zhiju 默认允许值；内部上限由后续 PayloadGuard/Security Policy 冻结，可以更严格。
2. 下载必须流式计算 Hash 和限制大小；不得先完整加载到无界内存。
3. `message_id + file_key + account` 必须匹配；不同消息的相同字节保留不同 Origin。
4. `file_name` 是 Sensitive Display Metadata，不参与对象身份或完整性。
5. Provider 临时 URL、Access Token 和 Cookie 不持久化。
6. Staging 成功但业务 Link 失败时按对象存储 Orphan Policy 清理并审计。
7. 消息撤回只改变 Origin 状态；已进入 CustomerMaterial/Evidence/Artifact 的内容由 owning module 执行 Impact/Retention Policy。

## 8. 交互卡片 Contract

```text
InteractionContract
├── interactionId: UuidV7
├── interactionVersion
├── actionCode
├── targetRef
├── exactVersionOrHashRef?
├── expectedAggregateVersion?
├── allowedPrincipalRefsOrRolePolicyRef
├── expiresAt
├── singleUseNonceHash
├── scopeRef
├── purpose
└── contentHash
```

Provider `action.value/form_value` 只携带最小 opaque `interactionId`、`nonce` 和 `actionCode`。以下字段即使出现在回调中也不可信：Project ID、Role、批准结果、expected version、Revision Hash、Release Package Hash、redirect URL。

处理顺序：

1. 验证 callback 传输、app/tenant/event；
2. 按 operator open_id 解析 HumanPrincipal；
3. 原子 Claim `interactionId + nonceHash`；
4. AUTHORITATIVE 读取 InteractionContract 和 target；
5. 检查 expiry、single-use、Scope、exact hash/version、Human-only Capability；
6. 发出目标 Core Command；
7. 保存 CommandReceiptRef；
8. 使用 Provider 的短期 callback token 更新卡片结果；token 不持久化为长期 Credential。

Approval/Release 卡片必须展示目标标题、安全摘要、精确版本/Hash 的可读短标识、角色、到期时间和 Workspace Deep Link。复杂 Diff/Evidence 不复制进卡片。

## 9. 出站消息与投递 Contract

### 9.1 Delivery Purpose

```text
TASK_ACK
TASK_STATUS
RUN_STATUS
INFORMATION_REQUEST
REVIEW_REQUEST
APPROVAL_REQUEST
RELEASE_AUTHORIZATION_REQUEST
GENERAL_NOTIFICATION
FORMAL_RELEASE_PUBLICATION
RECALL_NOTIFICATION
```

每次出站必须由已提交业务 Event/Command 驱动：

```text
business fact/intention committed
    ↓ IntegrationGateway Inbox
integration.request_feishu_delivery@1.0
    ↓ ChannelDeliveryAttempt + Outbox committed
Adapter claims attempt with fencing token
    ↓ upload file if required
send NEW_MESSAGE / REPLY / REPLY_IN_THREAD with providerUuid
    ↓ record RawExternalReceipt or UNKNOWN/FAILED
integration.ChannelDeliverySucceeded/Failed
    ↓ owning module records its own delivery/publication fact
```

### 9.2 Delivery Mode

- `NEW_MESSAGE`：目标由 active ChannelBinding 决定；不得用用户回传的任意 chat/open_id。
- `REPLY`：`replyToExternalRef` 必须属于同一 account/chat Binding。
- `REPLY_IN_THREAD`：除上述约束外，Provider 返回的 root/parent/thread 必须与预期会话一致；不一致进入 Quarantine。
- `deliveryMode/replyToExternalRef` 是本阶段提出的 optional minor 字段，用户审核前不视为 API 基准既成变更。

### 9.3 Provider 幂等

内部稳定键不直接暴露业务 ID。Adapter 派生：

```text
providerUuid = base32(HMAC(adapterKeyVersion, stableIdempotencyKey))[0..49]
```

- 同内部 stable key 必须得到同 providerUuid；不同 Payload Hash 使用同 key 时先由 Core 拒绝，不能换 uuid 继续发送。
- 飞书文档说明相同 uuid 的去重窗口为 1 小时；窗口内 UNKNOWN 重试复用原 uuid。
- 超过 Provider 去重窗口且无法确定是否送达时，不盲目重发；进入 reconciliation/Human Intervention，或通过允许的消息查询核对。
- providerUuid 可以保存；HMAC Key 只在 Secret Store，内部保存 key version 和 stable key hash。

### 9.4 Raw Delivery Receipt

```text
FeishuRawDeliveryReceipt
├── attemptRef
├── providerUuid
├── accountExternalRef
├── destinationExternalRef
├── messageExternalRef
├── chatExternalRef
├── rootMessageExternalRef?
├── parentMessageExternalRef?
├── threadExternalRef?
├── messageType
├── providerCreateTime
├── providerUpdateTime?
├── uploadedResourceRefs[]
├── providerRequestDiagnosticRef?
├── observedOutcome
├── rawPayloadRef
├── payloadHash
└── recordedAt
```

`code=0` 但缺少预期关键标识、响应 chat 与 Destination 不匹配或 providerUuid/attempt 关联不成立时，不得报告 SUCCEEDED。消息发送成功只证明 Provider 接受并创建消息；不证明用户已读、客户接受、Task 完成或 Release 完成。

## 10. 正式 Release Publication

普通飞书文件发送和 `FORMAL_RELEASE_PUBLICATION` 使用相同底层 API，但拥有不同的上游业务链。

### 10.1 Destination v0.1

```text
FeishuReleaseDestination
├── accountExternalRef
├── chatExternalRef
├── threadExternalRef?
├── replyRootExternalRef?
├── recipientScopeSnapshotRef
├── requiredReceiptKind: FEISHU_MESSAGE_WITH_FILE
└── destinationHash
```

v0.1 正式 Destination 是 `CHAT` 或 `CHAT + THREAD` 组合。飞书云文档/文件夹可以作为受控 Workspace Link 或未来独立 Destination，但不与消息投递混成一个 ExternalRef。

### 10.2 出站文件

1. Release Package 必须冻结精确 Representation checksum、display name、recipient scope 和 Destination。
2. 飞书单文件上传外部限制为 30 MB；超限不拆分冻结 Representation，也不降质替换。应失败、使用已批准的受控 Workspace Link Destination，或创建新的 Release Package。
3. 上传 file_key 的 Raw Receipt 必须绑定本地 Representation checksum；上传成功不等于投递成功。
4. 随后发送 file message，保存 message/chat/thread/time 回执。

### 10.3 Formal Receipt 最小字段

```text
releaseRef
packageRef + packageHash
destinationId + destinationHash
recipientScopeSnapshotRef
publicationAttemptRef
integrationRawReceiptRef
messageExternalRef + chatExternalRef + threadExternalRef?
representationRef + checksum + providerFileRef for each required item
providerCreateTime
recordedAt
formalReceiptPayloadHash
```

ReleasePublication 必须重新验证 release/destination/package/representation/attempt/raw receipt；验证成功后才调用 `release.record_publication_receipt@1.0`。飞书 Raw Receipt 不能自行产生 `ReleaseCompleted`。

## 11. 失败、重试、乱序与生命周期

| 场景 | 结果 |
|---|---|
| 同 key/same hash 重放 | 返回原 Envelope/Attempt/CommandResult |
| 同 key/different hash | Quarantine；保留首个事实 |
| 未知 schema/event/msg_type | 安全拒绝或 Quarantine，不猜测 |
| Webhook 验签/解密/token/app/tenant 失败 | 认证拒绝；不创建业务 Command |
| 消息先撤回后收到原 receive | 允许乱序保存两个外部事实；按 Provider 时间与接收时间重算 Origin 状态，不删除历史 |
| 先收到卡片回调后卡片查询失败 | 保存安全 callback Envelope；不执行高风险 Command；可重试补充读取 |
| 外部明确 4xx 权限/参数失败 | FAILED；是否可重试由分类 Policy 决定 |
| 429/5xx/网络中断且没有确定响应 | UNKNOWN 或 retryable failure；遵守 Retry-After/Policy；保持 stable uuid |
| Worker 在外部成功后、保存 Receipt 前崩溃 | 通过同 uuid 重试/查询 reconciliation；不换 key 盲发 |
| Bot 被移除/群解散 | Binding SUSPENDED/REVOKED；待发 Attempt 失败；Core 事实不回滚 |
| 用户离职/身份撤销 | 新动作重新授权并拒绝；历史 ActorSnapshot/Decision 保留 |
| 部分 Destination 成功 | 成功 Raw/Formal Receipt 保留；失败目标独立幂等重试；Release 真实呈现 PARTIAL |

## 12. 安全、权限、日志与保留

### 12.1 最小权限原则

v0.1 默认只申请实现所需能力：

- 单聊接收；
- 群聊中 @ Bot/回复 Bot 的消息接收；
- 以 Bot 身份发送/回复消息；
- 获取指定消息及其资源；
- 上传消息文件；
- 读取必要群信息/成员变化；
- 接收新版卡片动作。

不默认申请“读取群内所有消息”敏感权限。若真实业务必须处理未 @ Bot 的所有群消息，必须形成单独数据最小化与客户授权决定，不通过实现便利静默扩权。

### 12.2 数据保护

- open_id、tenant_key、chat_id、thread_id、message_id、file_key 使用 HMAC Lookup Hash；只有回传 Provider 必需时保存字段级加密原值。
- 完整消息正文、卡片 form、文件名和 Provider Raw Payload 按客户数据分类进入受控对象存储；普通日志只记录 hash、类型、安全错误码和 correlationId。
- 不记录 App Secret、Access Token、Verification Token、Encrypt Key、callback token、临时下载 URL、Cookie 或 Authorization Header。
- Callback token 只在短期受控内存用于卡片更新；不得作为长期 Capability。
- Deep Link 必须是 Zhiju Workspace 受鉴权链接；不得把对象存储签名 URL 嵌入长期卡片。
- 错误响应不得反射飞书原始正文、External ID、文件名或客户内容。

### 12.3 保留和撤回

- Channel Raw Envelope：按 `OPERATIONAL/QUARANTINE/CUSTOMER_RECORD` 分类；期限由正式 Policy 决定。
- 已转成 SourceMaterial/Answer/Approval/Receipt 的最小来源引用和 Hash 随业务记录保留。
- 消息撤回产生 `WITHDRAWN` 外部来源事实，不自动硬删；尚未采纳的候选可按 Policy 失效，已采纳对象进入 Impact Assessment。
- 客户删除请求走受控 Disposal Case；不得直接按 message_id 级联删除业务链。
- 系统不持续镜像整个聊天历史；只获取当前事件、显式目标消息和业务必要资源。

## 13. 兼容、运维与可观测性

1. v0.1 只接受 Provider event schema `2.0` 和允许列表中的 event type。
2. Provider 可选字段缺失必须按 Presence 处理；required 字段缺失拒绝，不填空字符串。
3. `adapterVersion`、Provider schema/event type、normalized contract version 和 mapping version 全部记录。
4. 官方字段/限制变化先更新本文与 Contract Fixture，再改 Adapter。
5. 每个事件/调用至少保存 correlationId、attempt/envelope ref、safe error code、provider request diagnostic hash、latency 和发生/接收时间。
6. 健康检查只能表示 Adapter/Provider 可用性，不表示某个业务动作完成。
7. Quarantine 必须可按 account/event/hash/reason 查询，并限制平台安全角色访问。

## 14. 与现有公开 Contract 的映射完整性

本阶段不新增公开名称。必须覆盖的 IntegrationGateway API：

| 现有 API | Feishu Channel 使用 |
|---|---|
| `integration.accept_inbound_envelope@1.0` | 所有已认证、规范化和 Claim 后的事件入口 |
| `integration.bind_channel_context@1.0` | 显式创建/更新 Channel Binding；optional context 字段待审核 |
| `integration.request_feishu_delivery@1.0` | 所有消息、回复、卡片、文件和正式发布的 Adapter Attempt |
| `integration.record_external_receipt@1.0` | 消息、文件上传、卡片更新的 Raw Receipt/UNKNOWN/FAILED |
| `integration.quarantine_external_event@1.0` | 身份冲突、Hash 冲突、未知版本/类型、响应关联异常 |
| `integration.get_channel_binding@1.0` | AUTHORITATIVE 解析当前会话/话题 Binding |
| `integration.get_delivery_attempt@1.0` | 查询真实 Attempt/Raw Receipt 状态 |
| `integration.get_adapter_health@1.0` | 只读健康/能力观察 |
| `integration.InboundEnvelopeAccepted/Rejected@1.0` | 报告入站外部事实，不报告业务完成 |
| `integration.ChannelAnswerReceived@1.0` | 规范化 Answer Candidate，TaskExecution 仍拥有 AnswerSubmission/Resolution |
| `integration.ChannelDeliverySucceeded/Failed@1.0` | 报告 Adapter 结果，owning module 继续处理 |

Runtime/Render 的 Integration API 不在本专项展开；仍由后续 Adapter Contract 负责。

## 15. 设计 Gate

进入用户审核前必须证明：

1. 8 个允许入站事件和 6 个核心 API 操作均有关键字段、幂等、失败和权限边界；
2. 消息接收按 message_id 去重，其他事件按 header event_id 去重，Hash 冲突全部 Quarantine；
3. 私聊/群聊/话题 Binding、用户映射和每次 authoritative authorization 无隐式授权；
4. 支持的消息类型、附件 Staging、撤回、转发和 Provider 大小限制明确；
5. 11 类 Channel Intent 全部映射到现有 Core Owner；公开 Catalog 不增不减；
6. 卡片 nonce、expiry、single-use、exact target/hash/version 和 Human-only 边界完整；
7. Outbound Attempt、providerUuid、UNKNOWN、Raw Receipt 和 Formal Receipt 责任分离；
8. 普通文本/附件/发送成功不能形成 Approval、Release、Task Completion 或 EffectiveBinding；
9. Credential、外部 ID、正文、文件、日志、保留和 Disposal 规则与高层基准一致；
10. 32 个专项测试有输入、预期、实际和结果；未执行项保持 `NOT RUN`；
11. Markdown 链接、代码围栏、表格、冲突标记和 tracked/untracked whitespace 检查通过；
12. HL、08、IntegrationGateway Spec/Test 的路由与状态同步。

## 16. 当前待用户审核的选择

以下选择在用户审核通过前保持可逆：

1. v0.1 使用企业自建飞书应用和 Bot，不使用共享 Human Credential；
2. 生产事件接收基准为 Webhook v2.0 + Encrypt Key，长连接仅作为同 Contract Adapter Variant；
3. 默认只接收单聊和群内 @/回复 Bot，不默认申请群内所有消息敏感权限；
4. Channel 默认无 Project Binding；Chat 可显式绑定 Project，Thread 才显式绑定 Task/WorkOrder/InformationRequest 等上下文；
5. 接受四个向后兼容 optional minor 字段：`businessContextRefs`、`runtimeContextExternalRef`、`deliveryMode`、`replyToExternalRef`；
6. 飞书可以承载精确、单次、Human-only Approval/Release Authorization 卡片，但复杂审查内容留在 Workspace，普通文本永远不成立；
7. 正式 Release Destination 冻结为 `CHAT` 或 `CHAT + THREAD`，Formal Receipt 使用第 10.3 节最小字段；
8. 消息撤回不自动删除已接收业务记录，按未采纳候选/已采纳事实分别执行失效或 Impact/Retention；
9. Provider 100 MB 下载和 30 MB 上传仅作为外部上限，内部限制可以更严格并在实施前冻结；
10. Provider uuid 只有 1 小时去重窗口；超窗 UNKNOWN 不盲发，进入 reconciliation/Human Intervention。

## 17. 当前状态

- 官方协议 Surface、身份/Binding、消息/文件/卡片、出站和正式 Release 映射已形成草稿；
- 现有 200 项公开 Catalog 名称未变；IntegrationGateway 仍是唯一 Channel Owner；
- 提出四个 optional minor API 字段，尚未通过用户审核；
- 32 个专项测试已定义；4 个 Design Gate 已完成静态 `DESIGN VERIFIED`，其余 28 个运行场景保持 `NOT RUN`；
- Webhook、飞书应用、权限、Schema、Fixture、Adapter、Persistence、对象存储和业务实现均不存在；
- 所有 Unit、Contract、E2E、真实飞书和 Manual 验证均为 `NOT RUN`。
