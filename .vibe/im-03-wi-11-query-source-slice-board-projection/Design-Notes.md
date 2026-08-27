# IM-03 WI-11 设计记录

## 目的

本记录把 Issue #67 的验收条件落到当前 EnterpriseProject Contract、事务 Context、owning Schema 和可执行的 PostgreSQL 验证路径上。实现保持四个既有 Query 名称，不新增公共 Operation，不把 Projection 的延迟当作 authoritative Command 或 Completion 的判据。

## 关键决定

1. `project.get_project_context_source` 只从 EnterpriseProject 权威表读取 ProjectSnapshotBinding、active baseline pointer 和安全 Fact 元数据。Query 结果明确携带 `omissions`、`redactions` 和 source watermark；Fact 原始 value、source refs、CustomerMaterial 正文不出现在结果中。
2. `project.get_active_baseline_refs` 从 CustomerBaseline、TemplateBaseline、RegulatoryProfile、GapAnalysis 和 DeliveryPlan 的 Project Root 读取精确 active/accepted pointer。没有 pointer 就省略，绝不以 latest/current 或排序后的最高版本替代。
3. `project.get_delivery_item_criteria` 继续复用现有精确 Plan Version/Item Handler。它读取冻结 criteria/hash，execution projection 保持 `NOT_READY`，因此可以与人为暂停的 Board Projection 并列验证。
4. Board Projection 使用独立 V2012 表：带版本的行、read alias、source state、consumer checkpoint 和安全 failure。Projection writer 只接受调用方已经规范化的 Snapshot Export 与 Event Delta，不直接读取 EnterpriseProject Schema，避免跨 Schema Join 和权限绕过。
5. Projection rebuild 在同一事务中构建新版本、应用严格递增的 delta、计算 canonical row count/domain checksum、更新 checkpoint/source state，最后切换 alias。旧版本保留；校验或写入失败不得切换 alias。
6. Board cursor 使用 HMAC 保护的最小 JSON，绑定 Enterprise、Project、过滤器 hash、Projection Version、最后一行、授权决策 hash 和 expiry。所有 scope/filter/version/expiry 不匹配统一拒绝。
7. 为让用户能观察“权威状态”和“读模型状态”的差异，在现有 `ProjectBoardPage` 中以可选字段追加 `consistency`、`asOfEventId`、`asOfRecordedAt`、`projectionLag`、`projectionStatus`。这是兼容性新增：旧 fixture 仍可验证，实际 Handler 始终填充诊断。Board 写入、读取和 cursor 统一使用固定 UTF-8 字节序；SourceWatermark 的 source module 固定为 `enterprise_project`，Event Delta sequence 从 1 开始。

## Purpose 与字段裁剪

本轮只接受以下 purpose：

| purpose | 允许的安全数据 |
|---|---|
| `context.snapshot.read` | Project、EnterpriseProfile、QMS、Product、active baseline、Fact 安全元数据 |
| `document.write` | Project、EnterpriseProfile、QMS、Product、active baseline、Fact 安全元数据 |
| `review.read` | Project、EnterpriseProfile、QMS、Product、active baseline、Fact 安全元数据 |
| `record.form.read` | Project、EnterpriseProfile、QMS、Product、active baseline；Fact 记录 omission |

`requestedKinds` 的闭集为 `PROJECT`、`ENTERPRISE_PROFILE`、`QMS_CONFIGURATION`、`PRODUCT_SCOPE`、`ACTIVE_BASELINES`、`ENTERPRISE_FACTS`。未请求的已知 kind 进入 omission；未知 kind、未知 purpose、跨 Scope Audience、过期 Context 和错误 ProjectRef 在任何业务读取前拒绝，过期 Context 使用 `PROJECT_QUERY_CONTEXT_EXPIRED`。

## Projection 行输入

Projection 行只保存 Board 所需的非敏感字段：DeliveryItem id/key/title、item type、commitment status、execution status、可选 completion evaluation ref、blocker refs 以及 source event watermark。Snapshot Export 和 Delta 的 item、event、partition、sequence、Scope 必须由上游调用方验证；Projection 层只做闭集格式、Scope、顺序、重复和 cursor 相关的第二道校验。Projection 表不保存 criteria JSON、Gap finding 正文、CustomerMaterial 正文或任意原始 event payload。

## 验证边界

- 自动 Gate：Contract/Registry、TypeScript/static、空库 Flyway migration、真实 PostgreSQL RLS/CHECK/immutable、Source Slice 脱敏、active exact refs、cursor、pause/lag、rebuild checksum、alias 和 checkpoint conflict。
- 明确不宣称：Provider、公开 HTTP、跨模块 Process Manager、生产数据库、真实外部系统和独立人工 Reference Project 验收。
- 本地自动化可证明暂停 Projection 时 authoritative criteria 不变；“用户在界面上比较两个 watermark 并避免业务误判”仍须人工验收。

## 未授权动作

本阶段只允许在用户检查变更后执行 Git commit；push、创建/更新 PR、merge、关闭 Issue 和删除远端/本地 branch 均须在对应阶段独立读取当前状态并记录证据。
