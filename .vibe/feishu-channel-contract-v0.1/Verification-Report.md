# Feishu Channel Contract v0.1 验证报告

日期：2026-08-13
环境：`/Users/galendai/repo/zhiju-business-core`，macOS/zsh，本地工作树
状态：`DESIGN VERIFIED / USER PROGRESSION CONFIRMED 2026-08-16 / IMPLEMENTATION NOT STARTED`

## 1. 验证范围

本报告只验证 Feishu Channel 文档集合、官方协议 Surface、Core API/Catalog 映射、optional minor 字段、安全边界、测试规格、Markdown 和 Git diff 的静态一致性。它不证明飞书应用、权限、Webhook、长连接、消息/文件/卡片 API、数据库、对象存储、业务 Handler 或真实用户流程存在或通过。

## 2. 官方协议取证

### 2.1 本地只读探索

执行：

```text
lark-cli im --help
lark-cli event list
lark-cli event schema im.message.receive_v1
lark-cli event schema card.action.trigger
lark-cli event schema im.chat.updated_v1
lark-cli event schema im.chat.disbanded_v1
lark-cli event schema im.chat.member.bot.deleted_v1
lark-cli event schema im.chat.member.user.added_v1
lark-cli event schema im.chat.member.user.deleted_v1
lark-cli im +messages-send --help
lark-cli im +messages-reply --help
lark-cli im +messages-resources-download --help
```

只读取 CLI 能力/Schema，没有认证、监听、发送、下载或修改飞书资源。

本地 event registry 未注册 `im.message.recalled_v1`，`event schema` 返回 unknown EventKey；该事件改由飞书官方“撤回消息”文档取证，没有猜测字段，也没有把 CLI registry 缺口包装成产品失败。

### 2.2 官方文档事实

使用 [`Feishu-Channel-Contract-v0.1.md`](./Feishu-Channel-Contract-v0.1.md) 第 2 节列出的飞书开放平台官方页面，核对：

- Webhook v2.0、签名头、Encrypt Key、Verification Token 与解密顺序；
- `im.message.receive_v1` 明确要求按 `message_id` 去重，不依赖 `event_id`；
- 撤回事件的 message/chat/recall 字段；
- send/reply/get/resource/upload/card callback 的关键请求、响应和限制；
- reply uuid 最长 50 字符且 Provider 去重窗口为 1 小时；
- 消息资源下载 100 MB 外部上限、文件上传 30 MB 外部上限。

## 3. Gate 结果

| Gate | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| FC-DOC-001 文档集合 | HL/08、IntegrationGateway Spec/Test、专项目录 | 专项 Contract/Test/Plan/Report 各一；路由可达 | `high_level=9 api=3 module_specs=7 module_tests=7 feishu=4`；`markdown_issues=0` | `DESIGN VERIFIED` |
| FC-PROV-001 Provider Surface | 官方文档、CLI Schema、Contract 第 2 节 | 8 个事件、6 个核心 API 操作、官方 URL 可追溯 | 最终检查：`events=8 api_operations=6 official_urls=10` | `DESIGN VERIFIED` |
| FC-MAP-001 Core 映射 | 11 类 Intent、Contract public refs、200 Catalog | 业务写入均命中现有 Owner；Catalog 不增减 | 最终检查：`intent_mappings=11 public_refs=28 missing_catalog_refs=0`；Catalog/Specs 均 200 unique | `DESIGN VERIFIED` |
| FC-MIN-001 Optional minor | IntegrationGateway Spec 与 Feishu Contract | 四字段两侧一致、明确待审核且向后兼容 | `optional_minor_fields=4 field_issues=0` | `DESIGN VERIFIED` |
| FC-TST-001 测试规格 | Feishu Channel Test | 32 个唯一 ID；4/8/8/8/4 分布 | `cases=32 unique=32 distribution={D:4,U:8,C:8,E:8,M:4}` | `DESIGN VERIFIED` |
| FC-SEC-001 安全边界 | Contract 身份/Binding/卡片/附件/Receipt/保留章节 | 不隐式授权，不保存 Credential，不冒充 Approval/Release | `security_checks=12 security_issues=0` | `DESIGN VERIFIED` |
| FC-MD-001 Markdown | `.vibe/**/*.md` | 链接可达、代码块闭合、表格列一致、无冲突标记 | 草稿检查：`markdown_issues=0` | `DESIGN VERIFIED` |
| FC-DIFF-001 文本质量 | tracked/untracked 当前差异 | 无 whitespace error | `git diff --check` 无输出；`untracked_markdown=4 new_file_whitespace_issues=0` | `DESIGN VERIFIED` |

## 4. 关键静态检查

Provider Surface、Intent 和 API 映射：

```text
provider_surface events=8 api_operations=6 official_urls=10
intent_mappings=11 public_refs=28 missing_catalog_refs=0
optional_minor_fields=4 field_issues=0
```

Catalog 不变：

```text
catalog occurrences=200 unique=200 duplicates=0
module_specs occurrences=200 unique=200 duplicates=0
```

专项测试：

```text
feishu_tests cases=32 unique=32
distribution={D:4,U:8,C:8,E:8,M:4}
design_verified=4 not_run=28 pass=0
security_checks=12 security_issues=0
message_idempotency_mapping=ok
stale_status_markers=0
overall_issues=0
```

Markdown/文本质量使用只读 Ruby 检查器和 Git：

```text
relative link existence
code fence closure
Markdown table column count
conflict marker scan
git diff --check
git diff --no-index --check /dev/null <each-untracked-markdown-file>
```

最终完整检查使用 `set -e`，中间任何非零退出都会终止命令。此前一次安全锚点检查把未知类型规则写死为另一同义句式，报告 1 个辅助断言问题；按本文实际冻结语义“未知类型在 v0.1 不映射业务写入”修正检查器后完整重跑，得到 `security_issues=0 overall_issues=0 exit=0`。这不是 Contract 内容失败，只采用最终重跑结果。

## 5. 已修正的设计缺口

1. 旧高层示例把所有飞书入站统一写成 `tenant + eventId`；官方消息事件要求按 `message_id` 去重。本阶段已把消息和其他事件的 Provider 语义幂等键分开，并同步 `05`、`07` 和 IntegrationGateway Spec。
2. 已审核的 `ChannelBindingDefinition` 只有 Enterprise/Project，不能表达已冻结的话题到 Task/WorkOrder/InformationRequest 上下文；提出 optional `businessContextRefs/runtimeContextExternalRef`。
3. 已审核的 `FeishuDeliveryRequest` 不能区分新消息、回复和话题回复；提出 optional `deliveryMode/replyToExternalRef`。
4. 四个字段在本报告形成时保持 `USER REVIEW PENDING`；用户于 2026-08-16 指示进入下一阶段后，已显式同步纳入 API v0.1 基准。

## 6. 未执行项与剩余风险

以下全部为 `NOT RUN`：

- 8 个 Unit、8 个机器 Contract、8 个 E2E、4 个 Manual 场景；
- 真实飞书自建应用、Bot、scope、事件订阅和应用发布；
- Webhook URL Verification、验签、解密、Nonce/Timestamp 重放防护；
- 私聊、群聊、话题、消息、回复、卡片、文件上传/下载和撤回；
- open_id/tenant/app 到 HumanPrincipal 的真实映射与权限拒绝；
- Binding、PostgreSQL Claim、Inbox/Outbox、Attempt、Lease/Fencing 和 Quarantine；
- 对象 Staging、Hash、MIME、病毒/安全扫描和 Orphan Cleanup；
- Approval/Release Human-only 卡片与 Workspace Deep Link；
- Provider uuid 一小时去重、Timeout UNKNOWN、超窗 reconciliation 和部分成功；
- 正式 Release Package/Representation/checksum/Raw/Formal Receipt 链；
- 负载、限流、备份恢复、密钥轮换、安全渗透和人工业务验收。

静态 `DESIGN VERIFIED` 不得简写为飞书集成、自动测试或人工验收 `PASS`。

## 7. Git 状态

本报告形成时文档尚未提交；随后已形成提交 `c2d7355`。用户于 2026-08-16 指示进入 Runtime Adapter Contract，阶段进入 Gate 已满足；所有真实飞书和运行验证仍保持 `NOT RUN`。
