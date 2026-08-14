# Feishu Channel Contract v0.1 工作计划

状态：`DESIGN VERIFIED / AWAITING USER REVIEW / IMPLEMENTATION NOT STARTED`
日期：2026-08-13
执行者：Codex（主 Agent）

## 1. 前提与范围

- 高层基准和 API Contract v0.1 已由用户审核通过；当前提交基线为 `e2af2c4`。
- 本阶段只设计飞书原始事件/API 与现有 Core Contract 的 Anti-Corruption 映射，不创建业务代码、飞书应用、Webhook、数据库、凭证或部署配置。
- IntegrationGateway 仍是唯一 Channel Adapter Owner；不得创建第八个业务模块或第二套 Task、Approval、Release 状态。
- 现有 200 个公开 Command/Query/Event 名称保持不变。本阶段发现的字段缺口只能以明确的向后兼容 optional minor 提案进入用户审核。
- 真实飞书权限、事件订阅、消息/文件、卡片、撤回和回执验证全部保持 `NOT RUN`。

## 2. 权威输入

必读：

1. `HL-Spec.md`；
2. `01-customer-field-findings.md`；
3. `02-zhiju-core-architecture.md`；
4. `03-core-contracts.md`；
5. `06-typed-references-contract-catalog-v0.1.md`；
6. `08-verification-baseline.md`；
7. `API-Contract-v0.1.md`；
8. `Module-Spec/Test-007-IntegrationGateway.md`。

补充：`04` 的飞书双向 Channel/InformationRequest/Approval/Release 语义、`05` 的跨 Aggregate 幂等与外部副作用、`07` 的 IntegrationGateway 持久化和敏感数据边界。

飞书协议事实只采用飞书开放平台官方文档与本地 `lark-cli event schema`；不以博客、示例仓库或模型记忆作为字段权威。

## 3. 交付物

1. `Feishu-Channel-Contract-v0.1.md`：Transport、事件、身份、Binding、消息、文件、卡片、出站、回执、安全和业务 API 映射；
2. `Feishu-Channel-Test-v0.1.md`：32 个 Design/Unit/Contract/E2E/Manual 场景；
3. `Verification-Report.md`：官方协议证据、静态 Gate、未执行项和剩余风险；
4. 同步 `HL-Spec`、`08-verification-baseline`、IntegrationGateway Module Spec/Test；
5. 修正飞书消息接收的幂等键：`im.message.receive_v1` 使用 `message_id`，不使用 `event_id` 作为消息去重键。

## 4. 执行步骤与验证

1. 核对工作树、提交基线和阶段入口。
   - 验证：工作树起点干净；API v0.1 已提交；Feishu 阶段未提前存在。
2. 从官方协议冻结 v0.1 Provider Surface。
   - 验证：每个允许事件/API 有类型、关键字段、权限/限制、幂等与未知版本处置。
3. 冻结身份、Binding 和 Core API 映射。
   - 验证：外部 ID 不变成 Principal；群成员不继承项目权限；所有业务写入回到现有公开 Command。
4. 冻结消息、附件、卡片和出站回执链。
   - 验证：普通消息/文件/卡片不冒充 Approval/Release；Timeout 为 UNKNOWN；Formal Receipt 重新验证精确 Package。
5. 定义 32 个专项测试并执行静态 Gate。
   - 验证：4 个 Design Gate 可有当前静态证据；其余 28 个运行/外部/人工场景保持 `NOT RUN`。
6. 交由用户审核。
   - 验证：用户确认前状态保持 `DRAFT / USER REVIEW PENDING`，不进入 Runtime Adapter Contract，不 Git Commit。

## 5. 阶段里程碑

| 里程碑 | 产出物 | 可供用户手动审核的内容 | 状态 |
|---|---|---|---|
| FC-M1 官方协议面 | Provider Surface 与证据矩阵 | 核对事件/API、关键原始字段、官方限制和幂等键 | `DESIGN VERIFIED` |
| FC-M2 入站与 Binding | 身份、会话、话题、附件、卡片映射 | 用脱敏 Fixture 判断消息是否能越权改变 Core | `DESIGN VERIFIED` |
| FC-M3 出站与回执 | 通知、回复、正式 Release、重试/UNKNOWN | 区分普通发送回执与 Formal PublicationReceipt | `DESIGN VERIFIED` |
| FC-M4 测试与静态 Gate | 32 个测试、验证报告 | 检查输入/预期/实际/结果与静态证据 | `DESIGN VERIFIED` |
| FC-M5 用户审核 | 审核结论和修订意见 | 确认第 16 节设计选择及 optional minor 字段 | 待审核 |

## 6. 人工审核产出

本阶段提供四组脱敏 Fixture 供用户审核：

1. 私聊、群聊、话题的显式 Binding 与越权拒绝；
2. 消息、附件、撤回、重复和跨项目转发；
3. InformationRequest、Review、Approval、Cancel/Status 的卡片交互；
4. 普通文件发送与正式 Release Publication 的 Receipt 对比。

这些 Fixture 只证明设计可审阅，不证明真实飞书调用、权限、Webhook、文件内容或浏览器交互通过。

## 7. 提交 Gate

用户确认 Feishu Channel v0.1 文档更改前：

- 不执行 `git add`；
- 不执行 Git Commit；
- 不进入 Runtime Adapter Contract；
- 不创建任何实现或临时测试脚本。
