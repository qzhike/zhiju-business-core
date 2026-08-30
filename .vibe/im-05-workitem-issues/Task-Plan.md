# IM-05 前置交付检查与 GitHub Work Item 建档计划

日期：2026-08-30
状态：`COMPLETE 2026-08-30`

## 目标

根据当前权威项目文档和 GitHub 远端事实，判断 `IM-05 Quality + Release + Renderer` 是否具备启动条件；仅在 IM-04 Exit Gate、适用决策 Gate、默认分支交付和剩余边界均可核验时，拆解并创建 IM-05 Parent Exit Gate 与独立可审核 Work Item。

## 成功条件

1. 以 `origin/main` 最新提交、HL-Spec、Artifact/QualityGovernance/ReleasePublication/IntegrationGateway Module Spec/Test、IM-04 Exit Gate 和 GitHub 远端状态为权威输入。
2. 明确区分本地/受控 PostgreSQL `PASS` 与真实 Renderer、对象存储、Provider、公开 HTTP、生产和独立人工验收 `NOT RUN`。
3. 若可启动，则每个 Issue 包含依赖、范围、非目标、自动验收、可供用户手动测试的产出和 `NOT RUN` 边界；创建后逐一远端回读。
4. 若不可启动，则不创建 Issue，只记录阻塞条件和所需前置交付。
5. 不实现 IM-05 代码，不创建分支或 PR，不关闭既有 Issue，不执行 Commit 或 Push。

## 执行步骤

1. 核对 worktree、分支、`origin/main` 和未提交变更。
2. 读取 IM-04/IM-05 里程碑、决策 Gate、Module Spec/Test 与 IM-04 验收文档。
3. 回读 GitHub IM-04 Parent/Work Item、关联 PR、默认分支 ancestry 和远端分支状态。
4. 形成 IM-05 启动判定；若通过，先在本目录生成 Issue 计划和 Issue Body。
5. 创建 GitHub Issue，逐一回读编号、标题、正文、状态和依赖。
6. 更新本计划与验证记录，执行 Markdown、链接、`git diff --check` 和 Git 状态检查。

## 非目标

- 不把 IM-04 的 synthetic/local/disposable PostgreSQL 结果扩张为真实外部或人工验收。
- 不静默补充或改变 Quality、Approval、Release、Renderer 的业务 Contract。
- 不在本次创建的 Issue 中声明实现已开始或测试已运行。

## 执行结果

- IM-05 启动判定：`CAN START — SCOPED ENGINEERING DELIVERY`。
- Parent #120 与 Work Item #121–#128 已创建并逐项远端回读。
- 既有 #22/#23/#24 被复用为 Release Runtime 依赖；#27 保持 IntegrationGateway umbrella coordination，均未修改。
- 所有新 Issue 为 `OPEN / PLANNED / NOT STARTED`，包含依赖、验收、Manual output、Non-goals 和 `NOT RUN`。
- 未创建实现分支、PR、Commit 或 Push；未关闭任何 Issue。
