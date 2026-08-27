# IM-04 规格复审报告

日期：2026-08-27
状态：`PASS AFTER DOCUMENT REPAIR / IM-04 IMPLEMENTATION NOT STARTED`

## 1. 审核范围

- `HL-Spec.md`；
- Artifact 架构、逻辑模型、Module Spec 与 Module Test；
- IM-DG-005 启动评审记录；
- 现有 Artifact 与 IntegrationGateway 公共 Contract；
- Issue #56 的 IM-03 关闭条件与已提交合成验证边界。

本次只允许修订规格、测试计划、验收记录和 GitHub 任务。禁止创建 IM-04 开发分支、Worktree、可执行 Schema、迁移、Repository、Handler、Fixture 或 Renderer。

## 2. 首轮发现

| ID | 严重度 | 发现 | 风险 | 处置 |
|---|---|---|---|---|
| IM04-SR-001 | High | Canonical Content 的 Hash 定义同时出现“ContentBytes”“Canonical body”，且对象结构把 `contentHash` 与 `objectLocator` 放在被哈希对象旁，未明确排除自引用字段。 | 不同实现可能产生不兼容 Hash，Revision 引用无法稳定复验。 | 明确 `CanonicalContentPayload={schemaRef, contentType, canonicalizationVersion, body}`，Hash 只覆盖其 Canonical JSON bytes；Manifest、locator、Hash 自身不进入 Hash 域。 |
| IM04-SR-002 | High | 逻辑模型把 `STAGING -> LINKED/FROZEN` storage state 放在 SEALED 后不可变的 `artifact_revision` 上。 | 对象校验生命周期与 Revision 不可变约束冲突，可能迫使修改已封存 Revision。 | 增设 Artifact-owned content object manifest；先冻结对象 Manifest，再由 Revision 只引用精确 FROZEN 对象。 |
| IM04-SR-003 | Medium | 规格写“实现基础 Diff”，但既有公共 Query 只返回 Diff Inputs，并明确不计算或保存 Diff；Catalog 没有公共 Diff Result Operation。 | 实现时可能未经设计决策擅自扩大 26 个公开 Contract。 | 将 IM-04 基础 Diff 限定为 Workspace/Application 内部可重建能力；继续使用公开 `get_revision_diff_inputs`，新增公共 Operation 必须单独决策。 |
| IM04-SR-004 | Medium | RepresentationRegistration 只携带 `renderAttemptRef`，规格未说明 Artifact 如何验证 IntegrationGateway RenderAttempt 的 input Hash。 | 可能只凭调用方声明登记 Representation，丢失精确输入绑定。 | 要求 Artifact 按 Attempt Ref 权威读取成功 Attempt，并核验 Revision、canonical content ref/input hash、Renderer 与输出 checksum 后登记。 |
| IM04-SR-005 | High | 交叉核对发现现有 `integration.get_render_attempt@1.0` 只返回通用 `AdapterAttemptView`，不返回原始 RenderRequest 或成功结果；现有公共边界实际不足以执行 IM04-SR-004。 | 规格若直接宣称“现有 Contract 可以承载”，实现只能越过模块边界读库或信任调用方。 | 将 additive `integration.get_render_attempt_binding@1.0` 列为 IM-04 首个 Contract Gate；先冻结并实现可审计 Binding View，再允许 Representation Handler 开发。本轮不修改 Registry。 |

## 3. 验收准则

修订完成后必须满足：

1. Hash 域唯一、非自引用且可由相同 Payload 确定性复算；
2. Object Manifest 生命周期与 SEALED Revision 不可变性不冲突；
3. 本轮不修改 Registry；所需 additive 公共 Contract 必须显式列为独立 Gate，不能伪装成现有 Query 已满足；
4. RenderAttempt 的权威读取与精确输入绑定明确，且现有通用 Attempt Query 的能力不足被显式记录；
5. Module Test 为每个设计不变量给出输入、预期输出、当前实际输出和 `NOT RUN` 边界；
6. 文档格式、链接、全量仓库 Gate 通过；
7. 不产生任何 IM-04 实现代码或运行时产物。

## 4. 最终结论

结论：`PASS AFTER DOCUMENT REPAIR`。

复审已完成以下收口：

- Canonical Content Hash 唯一覆盖 `{schemaRef, contentType, canonicalizationVersion, body}` 的 Canonical JSON bytes，Manifest 元数据和 Hash 自身不进入 Hash 域；
- Artifact-owned Content Object Manifest 管理 `STAGING -> LINKED -> FROZEN`，SEALED Revision 只引用并快照 FROZEN Manifest；
- 基础 Diff 保持 Workspace/Application 内部可重建能力，现有公共 `get_revision_diff_inputs` 不被误写成公开 Diff Result；
- 当前 `get_render_attempt` 的 `AdapterAttemptView` 能力不足已由生成类型和 Schema 交叉确认，additive RenderAttempt Binding Query 被列为首个 Contract Gate，当前 Registry 未变更；
- Issue #56 的关闭口径明确为用户授权的 scoped technical acceptance，统一跨 Aggregate E2E、人工 Reference Project、真实业务适用性和外部环境仍为 `NOT RUN`。

实际验证：

| Gate | 实际输出 | 结果 |
|---|---|---|
| Prettier / Diff | 所有变更 Markdown 格式匹配；`git diff --check` 无输出 | `PASS` |
| Lint / TypeScript | ESLint 与 `tsc -b --pretty false` 退出码 0 | `PASS` |
| 普通测试 | `24 passed / 17 skipped`；`356 passed / 241 skipped` | `PASS` |
| Architecture / Contract | `source_roots=10`；Public API、Catalog、Registry、Compatibility 均为 `200` 且 `FULL` | `PASS` |
| PostgreSQL / Flyway | PostgreSQL 18.6、Flyway 11.20.3；空库 migrate、`21 files / 256 tests`、二次 no-op、容器移除 | `PASS` |
| 实现边界 | Git diff 仅含 `.vibe` 文档；无 Contract Registry、Schema、Migration、Repository、Handler、Fixture、Renderer 或 Worktree 变化 | `PASS / IM-04 NOT STARTED` |

该结论确认规格已经具备建立开发 Work Item 的条件，不代表任何 IM-04 代码、数据库、Renderer、E2E 或人工验收已运行。
