# IM-04 GitHub Work Item 建档计划

日期：2026-08-27
状态：`PARENT #89 + WORK ITEMS #90–#98 CREATED AND READ BACK / IMPLEMENTATION NOT STARTED`

## 目标

在 Issue #56 关闭后，为 IM-04 `Artifact + Canonical Content` 建立一个 Parent Exit Gate 和九个可独立审阅的开发 Work Item。每个 Issue 必须包含权威输入、依赖、交付物、自动与人工验收产出、非目标及 `NOT RUN` 边界。

## 任务分解

1. WI-01：冻结并实现 Canonical Schema/Hash Fixture 与 additive RenderAttempt Binding Query Contract Gate；
2. WI-02：建立 Artifact Application/Persistence 事务基础；
3. WI-03：实现 Artifact Root、Metadata、Branch 身份与 Archive；
4. WI-04：实现 Content Object Manifest、Staging/Link/Freeze 与 Orphan Cleanup；
5. WI-05：实现不可变 Revision、Lineage、Branch Head CAS 与 Merge；
6. WI-06：实现 Structured Document、Human Edit 与内部确定性 Diff；
7. WI-07：实现 WorkbookSpec、Human Edit 与内部确定性 Diff；
8. WI-08：实现 Representation 登记与权威 RenderAttempt Binding 校验；
9. WI-09：实现权威 Query、合成 ART-023 验收 Fixture 与里程碑退出证据。

## 禁止范围

- 本轮只创建和回读 GitHub Issues；
- 不创建 IM-04 开发分支、Worktree、PR、Commit 或代码；
- 不修改 Registry、Schema、Migration、Repository、Handler、Fixture 或 Renderer；
- 不把 Issue 创建解释为开发已开始；
- 真实 Provider、生产对象存储、公开 HTTP、跨模块业务 E2E、真实业务适用性和独立人工验收保持 `NOT RUN`。
