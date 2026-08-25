# Module-Test-002-EnterpriseProject

版本：v0.1
日期：2026-08-25
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IM-03 WI-01 DECISION RECORDED / IM-03 WI-02 APPLICATION PERSISTENCE FOUNDATION / USER REVIEW REQUIRED / BUSINESS IMPLEMENTATION NOT STARTED`

对应规格：[`Module-Spec-002-EnterpriseProject.md`](../module-specs/Module-Spec-002-EnterpriseProject.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| EP-API-D-001 | Design | EnterpriseProject Module Spec 与 Catalog | 18 Command、6 Query、8 Event 名称/Owner/字段完整且无重复 | `commands=18 queries=6 events=8`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| EP-API-U-001 | Unit | 没有培训程序文件，Agent 请求 MISSING_CONFIRMED | 拒绝 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；只允许 NOT_PROVIDED/UNKNOWN | 无实现 | `NOT RUN` |
| EP-API-U-002 | Unit | Formal Gap 输入缺 TemplateBaseline 或使用 `latest` | 拒绝 `PROJECT_GAP_INPUT_INCOMPLETE`/Reference latest 错误 | 无实现 | `NOT RUN` |
| EP-API-U-003 | Unit | TaskCompleted 存在但 Item 要求的 Release 不存在 | Completion Evaluation 为 unsatisfied，不能发 CompletionSatisfied | 无 Evaluator | `NOT RUN` |
| EP-API-C-001 | Contract | Project A Command 引用 Project B CustomerMaterial | Scope/Reference 验证拒绝，不跨项目搜索替代材料 | 无 Schema/Handler | `NOT RUN` |
| EP-API-C-002 | Contract | BaselineActivated Event Fixture | 精确 VersionedRef、previous ref 与 impact policy 存在，不携带材料正文 | 无 Fixture | `NOT RUN` |
| EP-API-E-001 | E2E | 不完整采购程序→材料确认→Baseline→Gap→Human 批准 Plan | 不确定性真实保留；Agent 不接受 Gap/批准 Plan；版本链可追溯 | 无业务实现 | `NOT RUN` |
| EP-API-E-002 | E2E | 激活 CB-004 后重放引用 CB-003 的旧 Context | 旧 Context 仍解析 CB-003；旧 Gap/Plan 不改写，产生 Impact Review | 无业务实现 | `NOT RUN` |
| EP-API-M-001 | Manual | 脱敏采购控制程序 Fixture | 审核者能区分 Source/Customer/Baseline/Gap/Plan/Item 和各 Human Gate | 未准备可执行 Fixture | `NOT RUN` |

| EP-WI01-D-001 | Design | Issue #57 决策矩阵与 `HL-Spec`、Architecture、Domain、Module Spec、Implementation Plan、Verification Baseline 的路由 | Product/QMS/Profile/ProductScope/Platform Reference 均有唯一 Owner、受控入口、授权 purpose、版本语义和失败码；文档没有把业务实现写成 PASS | 决策矩阵已建立；`markdown_links=PASS files=142 relative_links=195`；`git diff --check` 通过 | `DESIGN VERIFIED` |
| EP-WI01-D-002 | Design | ProjectStartSnapshot 缺 Profile/QMS/ProductScope、Scope 不一致或使用 `latest` | 拒绝 `PROJECT_START_SNAPSHOT_INCOMPLETE` 或 Scope/Reference 错误；不得从数据库隐式补齐 | 已在决策矩阵冻结负向场景；无 Handler/Schema | `DESIGN VERIFIED` |
| EP-WI01-D-003 | Design | Product/QMS/Profile/Platform Reference 版本变化后重放旧 Gap/Context/Plan | 旧精确 Ref 和 Hash 保留，Gap 进入 `STALE` 并追加 Impact Review；不原地覆盖 | 已在决策矩阵冻结；无 Process Manager | `DESIGN VERIFIED` |
| EP-WI01-M-001 | Manual | 用户审阅受控入口、拒绝的公共 Catalog 扩展方案和 ProjectStartSnapshot 示例 | 用户确认入口、授权、版本/Hash、失败码和 `NOT RUN` 边界 | 尚未完成用户审阅 | `NOT RUN` |

| EP-WI01-V-001 | Static | `.vibe` Markdown 相对链接与工作树差异 | 文档链接均指向存在路径；无空白错误 | `markdown_links=PASS files=142 relative_links=195`；`git diff --check` 无输出 | `PASS` |
| EP-WI01-V-002 | Repository | `pnpm verify` 全量仓库 Gate | Format、Lint、Typecheck、Unit Test、Architecture、Contract、Persistence 均通过 | `format:check=PASS`；`lint=PASS`；`typecheck=PASS`；`Test Files 20 passed / 10 skipped`、`Tests 341 passed / 164 skipped`；`architecture_boundaries=PASS`；`contracts=PASS operations=200`；`persistence-gate=PASS`，第二次 migrate 无需迁移且 PostgreSQL 容器已清理 | `PASS` |

## 本阶段结果

- Unit/Contract/E2E/Manual：业务场景保持 `NOT RUN`，原因是业务实现与 Fixture 尚不存在；EP-WI01 的决策矩阵/路由场景为 `DESIGN VERIFIED`，用户审核仍未完成；EP-WI02 技术事务基础已有 focused Unit/Persistence 覆盖，人工 probe 仍为 `NOT RUN`。
- 现有公开 Contract 的静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 本轮仓库验证：`pnpm verify` 通过；它验证了现有技术基础和 200 项公开 Contract 的静态/技术 Gate，不改变上面业务 Handler、业务 DDL 和人工验收的 `NOT RUN` 状态。
- 测试遗留：未创建临时脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 层级 | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| EP-PG-001 | Integration | Context 仅允许 Project A1，写/读同 Enterprise 的 Project A2 技术行 | 写入 `42501`；读取零行 | 写入 `42501`；读取计数为 0 | `PASS` |
| EP-PG-002 | Integration | A1 Process + A2 Process Step，Context 同时允许 A1/A2 | Scope mirror 拒绝 `23514` | 返回 `23514 process step scope mismatch` | `PASS` |
| EP-PG-003 | Integration | 已提交 Audit 行后以 audit_reader 查询 masked view | 返回目标 audit_id；底表整体/敏感列仍拒绝 | masked view 返回目标行；底表 count/敏感列为 `42501` | `PASS` |
| EP-PG-004 | Integration | 不同 owner version 写同路径/同 target Reference Edge | 两行成功；同精确版本重复为 `23505` | 两版本成功；精确重复为 `23505` | `PASS` |

业务 Handler、Projection、受控 Capability 和真实业务 PostgreSQL 仍为 `NOT RUN`；IM-02 技术表与 IM-03 WI-02 事务基础的既有 `PASS` 不提升本模块业务状态。

## IM-03 WI-02 Application/Persistence 用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| EP-WI02-U-001 | Unit | Canonical payload 与提升列/声明 Hash 不一致 | 稳定拒绝 `ENTERPRISE_PROMOTED_MIRROR_MISMATCH` / `ENTERPRISE_PAYLOAD_HASH_MISMATCH`，无 payload 泄漏 | write-guards.test.ts 覆盖匹配、缺失字段和错误 Hash | `PASS` |
| EP-WI02-U-002 | Unit | Envelope 的 Actor/Decision/Policy/Project 与可信 Context 不一致 | `COMMAND_CONTEXT_MISMATCH` | assertEnvelopeMatchesContext 负向用例 | `PASS` |
| EP-WI02-P-001 | Persistence | 相同幂等键/相同 Hash 重放；不同 Hash | 重放返回原结果；冲突拒绝且首个 Receipt 不变 | command-runner 真实 PostgreSQL 覆盖 | `PASS` |
| EP-WI02-P-002 | Persistence | 并发 CAS；故障发生在 Outbox 之后 | 只有一个成功；失败者与故障事务不留 Process/Audit/Outbox/Receipt | 并发 CAS + failAfterOutbox 回滚 | `PASS` |
| EP-WI02-P-003 | Persistence | 无 Context、伪造 GUC、过期 Decision、跨 Project、连接池复用 | 写入拒绝或零行；过期映射 `COMMAND_CONTEXT_EXPIRED`；下一连接无残留 Context | Enterprise/Project fixture 与 pool leak 用例 | `PASS` |
| EP-WI02-M-001 | Manual | `tests/manual/im03-wi02-probe.mts` 五步输出 | 用户看到 success / replay / hash-conflict / cas-conflict / rollback | Runbook：`.vibe/im-03-workitem-issues/runbook-wi-02.md` | `NOT RUN` |

空库 Migration 与二次 no-op 仍由 `pnpm persistence:gate` 证明，不因本切片重复宣布业务链 `PASS`。
