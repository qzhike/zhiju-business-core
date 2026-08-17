# Feishu Channel Contract v0.1 测试规格

版本：v0.1
日期：2026-08-13
状态：`CURRENT TEST SPEC / DESIGN VERIFIED / USER PROGRESSION CONFIRMED 2026-08-16 / IMPLEMENTATION NOT STARTED`

对应规格：[`Feishu-Channel-Contract-v0.1.md`](./Feishu-Channel-Contract-v0.1.md)。对应模块：[`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

## 1. 结果口径

- `DESIGN VERIFIED`：文档、官方协议证据、映射和失败边界静态一致；不代表 Adapter 存在。
- `NOT RUN`：实现、Fixture、飞书环境或人工步骤尚未执行。
- `PASS/FAIL/BLOCKED`：只有实际运行并保存命令、日志或人工记录时才能使用。

## 2. Design Gate

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| FC-D-001 | Design | HL、02/03/05/06/07/08、API v0.1、IntegrationGateway Spec/Test 与专项文档 | 文档路由完整；没有第八模块或第二套业务状态 | `high_level=9 api=3 module_specs=7 module_tests=7 feishu=4`；链接/结构无异常 | `DESIGN VERIFIED` |
| FC-D-002 | Design | 官方事件/API 证据与 Provider Surface | 8 个入站事件、6 个核心 API 操作、关键字段/限制/幂等均可追溯 | `events=8 api_operations=6 official_urls=10` | `DESIGN VERIFIED` |
| FC-D-003 | Design | 11 条 Channel Intent/Core 映射与 200 项 Catalog | 每个业务写入映射现有唯一 Owner；公开名称集合不变 | `intent_mappings=11 public_refs=28 missing_catalog_refs=0`；Catalog/Specs 均 200 unique | `DESIGN VERIFIED` |
| FC-D-004 | Design | 身份、Binding、卡片 nonce、附件、回执、保留和 Credential 规则 | 安全边界完整；普通消息/附件/回执不冒充业务事实 | 四个 optional 字段两侧一致；安全边界章节完整；静态问题 0 | `DESIGN VERIFIED` |

## 3. Unit

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| FC-U-001 | Unit | 同 tenant/app/message_id、相同 Hash 的 `im.message.receive_v1` 三次 | 返回同一 InboundEnvelope/处理结果；只发出一个等价业务 Command | 无实现 | `NOT RUN` |
| FC-U-002 | Unit | 同消息幂等键、不同 Payload Hash | 保留首个 Envelope；冲突进入 Quarantine | 无实现 | `NOT RUN` |
| FC-U-003 | Unit | 已绑定 Project A 的群成员请求 Project B 状态 | Binding 不授予权限；IdentityPolicy DENY 且不泄露 Project B | 无实现 | `NOT RUN` |
| FC-U-004 | Unit | 已接收附件的消息随后被撤回 | Origin 标记 WITHDRAWN；不删除已接收字节/SourceMaterial；触发 Policy/Impact | 无实现 | `NOT RUN` |
| FC-U-005 | Unit | folder/sticker/system/未知 msg_type | 不下载或猜测；安全拒绝或 Quarantine，不写业务对象 | 无实现 | `NOT RUN` |
| FC-U-006 | Unit | 重放已消费卡片 interactionId/nonce | 返回原结果或明确过期；不重复 Approval/Cancel/Answer | 无实现 | `NOT RUN` |
| FC-U-007 | Unit | 外部发送 timeout 且无真实响应 | Attempt 保持 UNKNOWN；不报告 SUCCEEDED/FAILED | 无实现 | `NOT RUN` |
| FC-U-008 | Unit | 内部 stable key 超过飞书 uuid 50 字符限制 | 派生稳定、不可逆、最长 50 字符的 providerUuid；内部 key/hash 保留 | 无实现 | `NOT RUN` |

## 4. Contract

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| FC-C-001 | Contract | Webhook v2.0 加密事件、签名头和原始 body | 先验签、再解密、再校验 app/tenant/token/schema；顺序不可交换 | 无 Webhook/Fixture | `NOT RUN` |
| FC-C-002 | Contract | `im.message.receive_v1` text/post/file Fixture | raw 字段规范化为 FeishuInboundEnvelope；消息按 message_id 去重 | 无 Schema/Fixture | `NOT RUN` |
| FC-C-003 | Contract | `card.action.trigger` Fixture | action 仅解析 interactionId/nonce/actionCode；不信任回传 Scope/Role/Outcome | 无 Schema/Fixture | `NOT RUN` |
| FC-C-004 | Contract | message_id/file_key 与二进制资源 | 两者匹配后进入 Staging；计算 Hash/大小/MIME，临时 URL 不持久化 | 无文件 Adapter | `NOT RUN` |
| FC-C-005 | Contract | send/reply 成功响应 | Raw Receipt 保存 message/chat/root/parent/thread/type/time 与 request correlation；不表示已读 | 无发送 Fixture | `NOT RUN` |
| FC-C-006 | Contract | REL-801 的 Raw Receipt、Package、Destination 和 checksum | ReleasePublication 重新验证后才创建 Formal PublicationReceipt | 无 Release/Feishu Fixture | `NOT RUN` |
| FC-C-007 | Contract | 未知 schema、event_type 或 required provider field | Quarantine 并标记版本不支持；不做宽松猜测 | 无 Adapter | `NOT RUN` |
| FC-C-008 | Contract | 最小权限清单与实际事件/API Surface | 无未声明敏感 scope；缺 scope 产生安全错误且不降级为共享用户身份 | 无飞书应用 | `NOT RUN` |

## 5. E2E

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| FC-E-001 | E2E | 授权 Human 在已绑定项目话题确认创建任务 | Inbound→Principal/Auth→`execution.create_task`；消息不是 Task ID | 无业务/飞书实现 | `NOT RUN` |
| FC-E-002 | E2E | 用户在已绑定项目话题上传 DOCX | 下载/Staging/Hash/安全检查后注册 SourceMaterial Candidate；不自动确认 CustomerMaterial | 无对象存储/飞书实现 | `NOT RUN` |
| FC-E-003 | E2E | InformationRequest 卡片由授权 Human 回答并重复回调 | 一个 AnswerSubmission；Resolution 后创建新 Context/Run；terminal Run 不恢复 | 无业务/飞书实现 | `NOT RUN` |
| FC-E-004 | E2E | 普通回复“可以”与精确 Approval 卡片各一次 | 普通文本不创建 Approval；有效 Human/nonce/hash 卡片才调用 `quality.submit_approval_decision` | 无 Approval/飞书实现 | `NOT RUN` |
| FC-E-005 | E2E | 用户查询状态后取消 active Run | Query 仅返回授权裁剪视图；Cancel 创建 Core intent，卡片不虚构 Runtime 已取消 | 无 Task/Runtime/飞书实现 | `NOT RUN` |
| FC-E-006 | E2E | 用户离群、bot 被移除、群解散和消息跨项目转发 | Binding 按事件挂起/撤销；历史保留；新目的地重新授权，不继承源 Project | 无群事件实现 | `NOT RUN` |
| FC-E-007 | E2E | 普通文件发送与授权 REL-801 正式发布相同文件 | 普通发送仅 Raw Receipt；REL-801 经 Package/Receipt 验证产生 Formal Receipt | 无 Release/飞书实现 | `NOT RUN` |
| FC-E-008 | E2E | Attempt 提交后崩溃、timeout、同 key 重试和部分成功 | 同 providerUuid 防重；UNKNOWN 不盲发；成功 Receipt 保留；失败目标独立重试 | 无 Outbox/飞书实现 | `NOT RUN` |

## 6. Manual

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| FC-M-001 | Manual | 真实私聊、群聊、话题消息/回复 | 双向消息定位正确；未绑定/未授权上下文不泄露项目数据 | 未运行真实飞书 | `NOT RUN` |
| FC-M-002 | Manual | 真实文件上传、下载、撤回、超限和安全失败 | 字节、Hash、来源、撤回/拒绝状态可审计；无临时 URL/Token 泄漏 | 未运行真实飞书 | `NOT RUN` |
| FC-M-003 | Manual | 真实 InformationRequest、Review、Approval、Cancel 卡片 | 单次 nonce、到期、重复、越权和 Deep Link 行为符合 Contract | 未运行真实飞书/浏览器 | `NOT RUN` |
| FC-M-004 | Manual | 真实正式 Release 到群/话题 | Package/checksum/recipient/destination/Raw/Formal Receipt 链可追溯，普通发送不成立 | 未运行真实飞书/Release | `NOT RUN` |

## 7. 当前结果

- 场景总数：32；Design 4、Unit 8、Contract 8、E2E 8、Manual 4。
- 4 个 Design 场景已有当前静态证据并标记 `DESIGN VERIFIED`。
- 其余 28 个实现、真实飞书、E2E 和人工场景均为 `NOT RUN`。
- 本阶段不得出现运行时 `PASS`。
- 测试遗留：未创建临时脚本、Fixture 或飞书资源。
