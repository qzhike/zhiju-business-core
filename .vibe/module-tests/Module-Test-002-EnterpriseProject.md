# Module-Test-002-EnterpriseProject

版本：v0.6
日期：2026-08-26
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IM-03 WI-01 DECISION RECORDED / IM-03 WI-02 APPLICATION PERSISTENCE FOUNDATION / IM-03 WI-03 PR #72 REVIEW REPAIRED / IM-03 WI-04 PR #73 REPAIR VERIFIED / IM-03 WI-05 SOURCE MATERIAL IMPLEMENTATION LANDED / IM-03 WI-06 CUSTOMER MATERIAL PERSISTENCE VERIFIED / PR #75 MERGED / ISSUE #62 CLOSED / EXACT-HEAD DELIVERY COMPLETE`

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
| EP-WI01-V-002 | Repository | `pnpm verify` 全量仓库 Gate | Format、Lint、Typecheck、Unit Test、Architecture、Contract、Persistence 均通过 | 修正后 `format:check=PASS`；`lint=PASS`；`typecheck=PASS`；`Test Files 21 passed / 12 skipped`、`Tests 348 passed / 189 skipped`；`architecture_boundaries=PASS`；`contracts=PASS operations=200`；`persistence-gate=PASS`，第二次 migrate 无需迁移且 PostgreSQL 容器已清理 | `PASS` |
| EP-WI01-V-003 | Delivery | PR #69 精确 head 与远端 CI | head 必须为 `9c02ac80491b3d60c59685c2ea1ac33ce875981c`；该 head 的 `verify` 必须成功 | GitHub Actions run `32795729365` 对应该 head，`verify=success` | `PASS` |
| EP-WI01-V-004 | Repository | 当前工作区复跑 `pnpm verify` | 全量 Gate 完成；若外部镜像服务不可达，必须保留阻塞证据 | 修正后 format/lint/typecheck/test/architecture/contracts/persistence 均通过；PostgreSQL 18.6 / Flyway 11.20.3，二次 migrate no-op，容器已清理 | `PASS` |

## 本阶段结果

- Unit/Contract/E2E/Manual：业务场景保持 `NOT RUN`，原因是业务实现与 Fixture 尚不存在；EP-WI01 的决策矩阵/路由场景为 `DESIGN VERIFIED`，用户审核仍未完成；EP-WI02 技术事务基础已有 focused Unit/Persistence 覆盖，人工 probe 仍为 `NOT RUN`。
- 现有公开 Contract 的静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- PR #72 修正后的本地 `pnpm verify` 已通过：Persistence 为 14 文件 / 202 测试 PASS；全量 Unit 为 21 文件 PASS、12 文件 skipped，348 个测试 PASS、189 个 skipped。它只证明当前工作区和 Disposable PostgreSQL 边界，不改变真实 Provider、HTTP、跨模块 E2E 和人工验收的 `NOT RUN` 状态。
- 本次 PR #73 复核发现工作树已有未跟踪 `tmp/` 测试脚本和 Node compile cache；它们不属于交付内容，修复验证完成后必须清理并重新确认工作树。

## IM-02 WI-04 PostgreSQL 用例

| ID | 层级 | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| EP-PG-001 | Integration | Context 仅允许 Project A1，写/读同 Enterprise 的 Project A2 技术行 | 写入 `42501`；读取零行 | 写入 `42501`；读取计数为 0 | `PASS` |
| EP-PG-002 | Integration | A1 Process + A2 Process Step，Context 同时允许 A1/A2 | Scope mirror 拒绝 `23514` | 返回 `23514 process step scope mismatch` | `PASS` |
| EP-PG-003 | Integration | 已提交 Audit 行后以 audit_reader 查询 masked view | 返回目标 audit_id；底表整体/敏感列仍拒绝 | masked view 返回目标行；底表 count/敏感列为 `42501` | `PASS` |
| EP-PG-004 | Integration | 不同 owner version 写同路径/同 target Reference Edge | 两行成功；同精确版本重复为 `23505` | 两版本成功；精确重复为 `23505` | `PASS` |

业务 Handler、Projection、受控 Capability 和真实业务 PostgreSQL 仍为 `NOT RUN`；IM-02 技术表与 IM-03 WI-02 事务基础的既有 `PASS` 不提升本模块业务状态。

## IM-03 WI-05 SourceMaterial 登记、验证与接受用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI05-P-001` | Persistence | 同一 Project 登记两份相同 bytes/hash、不同 ExternalRef 的材料 | 两个不同 SourceMaterial Root 与 Origin 均保留；第二个可带 `duplicate_of`，不合并/删除第一份 | PostgreSQL 18.6：2 个 Root、2 个 Origin，第二个 duplicate 指向第一个 | `PASS` |
| `EP-WI05-P-002` | Persistence | 为一份 RECEIVED SourceMaterial 写入通过的 Security/Integrity Validation，再以精确 Ref/Hash/Locator 接受 | Root CAS 到 `ACCEPTED`、aggregate version 连续；Receipt/Audit/Reference Edge/最小 `SourceMaterialAccepted` Outbox 同事务提交 | PostgreSQL 18.6：Root `RECEIVED/1 -> ACCEPTED/2`；1 Receipt、1 Audit、3 Edge、1 最小 Outbox | `PASS` |
| `EP-WI05-P-003` | Persistence | 缺失、FAILED、跨 Project、错误 validation id/hash、被检 Hash/长度/Locator 不匹配 | 返回稳定拒绝；SourceMaterial 不变；事务不产生 `SourceMaterialAccepted` Event | PostgreSQL 18.6：缺失/FAILED/Locator/Ref Hash 均 `PROJECT_SOURCE_NOT_TRUSTED`；Root 保持 `RECEIVED/1`；Event `0` | `PASS` |
| `EP-WI05-P-004` | Persistence | 登记后直接 UPDATE Root 的原始字段、Origin 或 Validation；尝试 DELETE 历史 | PostgreSQL/触发器/ACL 拒绝；原始 bytes/hash/origin 与历史行保持不变 | PostgreSQL 18.6：原始列无 UPDATE 权限；Root DELETE、Origin/Validation UPDATE/DELETE 均 `42501` | `PASS` |
| `EP-WI05-P-005` | Persistence | 同一 accept 幂等键相同 payload 重放；同 key 改变 accepted locator 或 validation ref | 相同 hash 返回 `DUPLICATE` 且不产生第二 Event；不同 hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` 且首个 Receipt 不变 | PostgreSQL 18.6：首个 `COMMITTED`，重放 `DUPLICATE`，改 payload `IDEMPOTENCY_PAYLOAD_CONFLICT`，Event 仍 `1` | `PASS` |
| `EP-WI05-P-006` | Persistence | Project A Context 使用 Project B 的 `projectRef`/SourceMaterial/Validation Ref，或未被 allowed Project 授权 | Command/Repository/RLS 拒绝，不跨 Project 搜索替代对象，不泄漏 B 的原始字段 | PostgreSQL 18.6：跨 Project Command `PROJECT_SOURCE_NOT_TRUSTED`；A Context 查询 B 返回 `0` 行；Event `0` | `PASS` |
| `EP-WI05-U-001` | Unit | Descriptor 的 submittedBy、ExternalRef、ContentHash、ObjectLocator 或 acceptedAt 形状非法 | 在写入前以安全错误拒绝，不打开部分写入事务 | `pnpm exec vitest run tests/persistence/enterprise-project-scope.test.ts --no-file-parallelism`：Unit 用例 PASS；非法 byteLength 返回 `PROJECT_MATERIAL_SOURCE_INVALID` | `PASS` |
| `EP-WI05-M-001` | Manual | 脱敏 Project 中登记两份相同 Hash 的不同来源材料，分别查看 Root/Origin/Validation/Outbox | 用户能确认两份来源均存在，仅一份变为 ACCEPTED；Event 不含 `originalName`/客户原文；真实 Feishu/Ceph/OpenBao 仍标记 `NOT RUN` | 尚未执行 | `NOT RUN` |

本切片的自动化只能证明当前代码、迁移和 Disposable PostgreSQL 的范围；上述 EP-WI05 Unit/Persistence 已在 PostgreSQL 18.6 / Flyway 11.20.3 gate 中通过。真实飞书下载、恶意文件扫描、Ceph/OpenBao、对象 Staging/Link/Orphan Cleanup、公开 HTTP、跨模块 CustomerMaterial 流程和人工 Reference Project 验收继续保持 `NOT RUN`。测试运行后不得保留临时脚本、临时数据或 gate 容器。

## IM-03 WI-02 Application/Persistence 用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 当前结果 |
|---|---|---|---|---|---|
| EP-WI02-U-001 | Unit | Canonical payload 与提升列/声明 Hash 不一致 | 稳定拒绝 `ENTERPRISE_PROMOTED_MIRROR_MISMATCH` / `ENTERPRISE_PAYLOAD_HASH_MISMATCH`，无 payload 泄漏 | write-guards.test.ts 覆盖匹配、缺失字段和错误 Hash | `PASS` |
| EP-WI02-U-002 | Unit | Envelope 的 Actor/Decision/Policy/Project 与可信 Context 不一致 | `COMMAND_CONTEXT_MISMATCH` | assertEnvelopeMatchesContext 负向用例 | `PASS` |
| EP-WI02-P-001 | Persistence | 相同幂等键/相同 Hash 重放；不同 Hash | 重放返回原结果；冲突拒绝且首个 Receipt 不变 | command-runner 真实 PostgreSQL 覆盖 | `PASS` |
| EP-WI02-P-002 | Persistence | 并发 CAS；故障发生在 Outbox 之后 | 只有一个成功；失败者与故障事务不留 Process/Audit/Outbox/Receipt | 并发 CAS + failAfterOutbox 回滚 | `PASS` |
| EP-WI02-P-003 | Persistence | 无 Context、伪造 GUC、过期 Decision、跨 Project、连接池复用 | 写入拒绝或零行；过期映射 `COMMAND_CONTEXT_EXPIRED`；下一连接无残留 Context | Enterprise/Project fixture 与 pool leak 用例 | `PASS` |
| EP-WI02-P-004 | Persistence | Outbox Event 使用不同 Aggregate、错误初始/CAS 版本；Reference Edge 使用不同 owner | 在写入边界拒绝 `COMMAND_TARGET_MISMATCH`；不留 Receipt、Outbox 或 Edge | PostgreSQL 18.6 负向回归通过；CAS 回滚至版本 `1`，Receipt/Outbox/Edge 均为 `0` | `PASS` |
| EP-WI02-P-005 | Persistence | Repository 传入与受信 Context 不同的 `createdByPrincipalId` | 以稳定主体绑定错误拒绝；不留 Process 或 Receipt | PostgreSQL 18.6 返回 `ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH`；Process/Receipt 均为 `0` | `PASS` |
| EP-WI02-M-001 | Manual | `tests/manual/im03-wi02-probe.mts` 五步输出 | 用户看到 success / replay / hash-conflict / cas-conflict / rollback | Runbook：`.vibe/im-03-workitem-issues/runbook-wi-02.md` | `NOT RUN` |

空库 Migration 与二次 no-op 仍由 `pnpm persistence:gate` 证明，不因本切片重复宣布业务链 `PASS`。

## IM-03 WI-03 业务纵向切片用例

| ID | 层级 | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI03-P-001` | Persistence | 跨 Enterprise 重复 `displayCode` | `PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT`，拒绝 Receipt 且不跨 Scope | Enterprise displayCode 负向用例返回稳定冲突码 | `PASS` |
| `EP-WI03-P-002` | Persistence | propose + confirm 同一 Fact | Root/version/event 聚合版本依次为 1、2，无版本间隙；Reference Edge 同事务提交 | PostgreSQL 读取 Root/Outbox 为 `1,2`；2 个 version 行、2 条 Fact Edge | `PASS` |
| `EP-WI03-P-003` | Persistence | Agent、缺失 principalKind 调 Human-only confirm | 均为 `PROJECT_HUMAN_ONLY_DENIED` | 显式 Agent 与删除 Envelope `principalKind` 均拒绝 | `PASS` |
| `EP-WI03-P-004` | Persistence | Product 重复 displayCode；随后创建不同码 | 稳定冲突码，拒绝事务后同一连接仍可提交 | 返回 `PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT`；后续 Product COMMITTED | `PASS` |
| `EP-WI03-P-005` | Persistence | Product/QMS 精确 ref 的 objectId 与 versionId 不一致 | 稳定拒绝，不移动 current pointer | Product activation 与 QMS previous revision 错误 objectId 均拒绝 | `PASS` |
| `EP-WI03-P-006` | Persistence | QMS 新建、后续 Revision、激活、回滚 | 初始 current 为 NULL；Root/Event version 连续 | Root 最终 version `5`、事件序列 `1,2,3,4,5`、revision 行数 2 | `PASS` |
| `EP-WI03-P-007` | Persistence | Profile Snapshot 引用其他 Enterprise 或错误 objectId 的 Fact/Product Ref | `PROJECT_PROFILE_SOURCE_MISMATCH`，无错误 snapshot 写入 | 跨 Enterprise Fact 与错误 Product objectId 均拒绝；Profile Edge 3 条 | `PASS` |
| `EP-WI03-P-008` | Contract/Persistence | Public propose/confirm/get 使用生成 Contract refs/value/snapshot result | 输入输出保留完整 Typed Reference、ValueEnvelope、SnapshotRef 和 hash | generated types/typecheck、Contract Gate 和真实 PostgreSQL 用例通过 | `PASS` |
| `EP-WI03-P-009` | Persistence | `get_enterprise_profile_snapshot` 使用错误 hash 或 `latest` | `PROJECT_PROFILE_SOURCE_MISMATCH` | 错误 hash、`latest/current` 均拒绝；正确 Snapshot 可重放 | `PASS` |
| `EP-WI03-P-010` | Persistence | Product/QMS/Profile source refs | Reference Edge owner/target 精确且与同一事务提交 | Fact/Product/QMS/Profile owner Edge 断言通过 | `PASS` |
| `EP-WI03-P-011` | Persistence | `productScope` snapshot 空 refs | `PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID` | 空 `productVersionRefs` 返回业务拒绝 | `PASS` |
| `EP-WI03-P-012` | Unit | canonical JSON hash 顺序无关 | `digest.equals` 为 `true` | `digestCanonicalPayload` 顺序无关断言通过 | `PASS` |

WI-03 业务 Handler、业务 DDL 和 Disposable PostgreSQL 的修正结果已由本次 exact-head 工作区复验；真实 Provider、HTTP、跨模块 E2E 和人工业务验收仍为 `NOT RUN`。原始 PR 的自报测试结果不作为本次修正后的 PASS 证据。

## IM-03 WI-04 Project 启动快照、Scope 与对象验证用例（PR #73 修复前基线）

| ID | 层级 | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI04-P-001` | Persistence | 同 Enterprise 内 Project A happy path | 提交 Project + ScopeClaim + SnapshotBinding 三张表；aggregate_version=1；Outbox/Reference Edge 同步 | Project 新建在 `project` INSERT 处复现 `42501 new row violates row-level security policy` | `FAIL` |
| `EP-WI04-P-002` | Persistence | 同 Enterprise 内重复 displayCode | 拒绝 `PROJECT_PROJECT_DISPLAY_CODE_CONFLICT`；事务不留下 Project / ScopeClaim / Binding | 尚未进入重复冲突分支；首次 Project 即因 `ON CONFLICT` + RLS 失败 | `FAIL` |
| `EP-WI04-P-003` | Persistence | StartSnapshot 引用跨 Enterprise 的 Profile 或错误 enterprise_id | 拒绝 `PROJECT_START_SNAPSHOT_SCOPE_MISMATCH`；Scope mirror trigger 与 handler 二次校验均触发 | 断言结果虽为 Scope Mismatch，但 QMS fixture 把 revision hash 错传为 enterprise_id，无法证明目标路径 | `FAIL` |
| `EP-WI04-P-004` | Persistence | StartSnapshot 任意 ref 使用 `latest` / `current` | 拒绝 `PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN` | snapshotId=latest 直接短路拒绝 | `PASS` |
| `EP-WI04-P-005` | Persistence | StartSnapshot Profile ref 指向不存在 / 错误 hash 的 snapshot | 拒绝 `PROJECT_START_SNAPSHOT_SCOPE_MISMATCH`；事务回滚 | Handler 返回 REJECTED Command Result；测试错误等待抛出异常，捕获值为 null | `FAIL` |
| `EP-WI04-P-006` | Persistence | memberPolicyRef 不是 VERSIONED 或缺 versionId/scope | 拒绝 `PROJECT_MEMBER_POLICY_REF_INVALID` | OBJECT 形态负向路径通过；原测试把不存在的 contentHash 当作 VersionedRef 必填字段 | `NOT ACCEPTED` |
| `EP-WI04-P-007` | Persistence | ProjectScopeClaim 在创建后可被权威 SQL 查询 | `(enterprise_id, project_id, status)` 与事务 Context Enterprise 相同；status=ACTIVE | Project 新建在 RLS 处失败，未产生可查询 ScopeClaim | `FAIL` |
| `EP-WI04-P-008` | Persistence | `project.validate_object_scope` 同 Project / 跨 Project probe | 同 Project 返回 `valid=true` 与正确 Scope；跨 Project 抛 `PROJECT_OBJECT_SCOPE_MISMATCH`；不返回替代对象 | Project 新建在 RLS 处失败，尚未到对象验证；静态复核另发现查询使用不存在的通用 `object_id` | `FAIL` |
| `EP-WI04-P-009` | Persistence | 两个 Enterprise 同 displayCode | 两个 Project 均 COMMITTED；`(enterprise_id, display_code)` UNIQUE 不冲突 | A/B fixture 均在 Project 新建前被 RLS 或错误 QMS enterprise scope 阻断 | `FAIL` |
| `EP-WI04-P-010` | Persistence | memberPolicyRef 缺 versionId/scope | 拒绝 `PROJECT_MEMBER_POLICY_REF_INVALID` | 当前实现接受该形态并继续写入，随后以 Project RLS 错误失败；没有稳定的 member policy 错误 | `FAIL` |
| `EP-WI04-DB-011` | Persistence | `enterprise_project_app` 对 `project_snapshot_binding` UPDATE 权限 | `has_table_privilege(... 'UPDATE') = false` | V2003 `REVOKE UPDATE, DELETE` 生效 | `PASS` |

修复前基线：`pnpm typecheck` 为 `PASS`；`pnpm format:check` 因两个 PR 文件失败；`pnpm persistence:gate` 在 PostgreSQL 18.6 / Flyway 11.20.3 上为 `206 passed / 7 failed`（总计 213）。对象验证、Provider、HTTP、跨模块 E2E 和人工业务验收仍为 `NOT RUN`，原始 PR 的自报结果不作为修复后的 PASS 证据。

## PR #73 修复后复验（2026-08-26）

| ID | 层级 | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-PR73-P-001` | Persistence | 同 Enterprise 内 Project happy path，memberPolicy 使用无 contentHash 的 VersionedRef | Project/ScopeClaim/Binding/Outbox/Edge 同事务提交；无伪造 hash | Project、ScopeClaim、Binding 各 1 行；aggregate_version=1；member_policy_payload_hash 为 NULL | `PASS` |
| `EP-PR73-P-002` | Persistence | 重复 `(enterprise_id, display_code)`，随后使用不同 displayCode | 返回 `PROJECT_PROJECT_DISPLAY_CODE_CONFLICT`；重复命令事务可正常结束，后续不同 displayCode 命令可提交 | duplicate REJECTED；后续不同 displayCode COMMITTED | `PASS` |
| `EP-PR73-P-003` | Persistence | Enterprise A Command 引用 Enterprise B Profile Snapshot | 稳定拒绝 `PROJECT_START_SNAPSHOT_SCOPE_MISMATCH` | Handler 在事务前拒绝跨 Enterprise scope | `PASS` |
| `EP-PR73-P-004` | Persistence | StartSnapshot 使用 `latest` | 拒绝 `PROJECT_START_SNAPSHOT_LATEST_FORBIDDEN` | 短路返回稳定失败码 | `PASS` |
| `EP-PR73-P-005` | Persistence | Profile ref 形状正确但 persisted row 不存在/Hash 不匹配 | Command 返回 REJECTED，而不是把业务拒绝当作异常抛出 | `status=REJECTED`，`errorCode=PROJECT_START_SNAPSHOT_SCOPE_MISMATCH` | `PASS` |
| `EP-PR73-P-006` | Persistence | memberPolicy 使用 OBJECT 或缺失 versionId/scope | 拒绝 `PROJECT_MEMBER_POLICY_REF_INVALID`；VersionedRef 不要求 contentHash | OBJECT 与缺 versionId 的负向用例均返回稳定错误 | `PASS` |
| `EP-PR73-P-007` | Persistence | 创建后查询 ProjectScopeClaim | 返回精确 `(enterprise_id, project_id, ACTIVE)` | admin 查询匹配 A 的 Project/Enterprise | `PASS` |
| `EP-PR73-P-008` | Persistence | 同 Project 与跨 Project 的 `validate_object_scope` | 同 Project `valid=true`；跨 Project 抛 `PROJECT_OBJECT_SCOPE_MISMATCH` | 精确 Project 主键映射通过；跨 Project 无替代对象泄漏 | `PASS` |
| `EP-PR73-P-009` | Persistence | Enterprise A/B 使用相同 displayCode | 两个 Project 均 COMMITTED | A/B 均提交成功，fixture scope 与 envelope 一致 | `PASS` |
| `EP-PR73-P-010` | Persistence | VersionedRef 无 contentHash | 不写全零 hash；缺 versionId 才拒绝 | valid VersionedRef 持久化 NULL，invalid versionId 稳定拒绝 | `PASS` |
| `EP-PR73-DB-011` | Persistence | app role UPDATE `project_snapshot_binding` | `has_table_privilege(..., 'UPDATE') = false` | 查询返回 `false` | `PASS` |
| `EP-PR73-DB-012` | Persistence | 受信 Enterprise A context 直接 INSERT Enterprise B Project | PostgreSQL 返回 `42501` | V2004 policy 拒绝 rogue Enterprise INSERT | `PASS` |
| `EP-PR73-V-001` | Repository | `pnpm verify` | 所有静态、Unit、Architecture、Contract、Persistence Gate 通过 | Format/Lint/Typecheck 通过；Unit `348 passed / 201 skipped`；Contract `200`；Persistence `214 passed`；V2004/V2005 成功且二次 migrate no-op | `PASS` |

修复后自动化只证明当前工作区、受控代码路径和 Disposable PostgreSQL；真实 Provider、公开 HTTP、跨模块业务 E2E、生产环境和人工 Reference Project 验收继续为 `NOT RUN`。测试脚本、临时文件和 gate 容器已清理。

## IM-03 WI-06 CustomerMaterial 提议、确认与不可变版本用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI06-P-001` | Persistence | 同一 Project 的 `ACCEPTED` SourceMaterial + 合法 CustomerMaterialProposal；Agent/`actingFor` 确认尝试 | 创建 CustomerMaterial Root/v1，状态 `PROPOSED`、aggregate version `1`；Source Ref 精确落 Edge；不自动确认；非 Human 不得确认 | Disposable PostgreSQL：Root/v1 为 `PROPOSED`/`1`；Agent 与 Human `actingFor` 均返回 `PROJECT_HUMAN_ONLY_DENIED`；同一测试继续完成 Human 确认 | `PASS` |
| `EP-WI06-P-002` | Persistence | Human 确认当前 `PROPOSED` candidateVersionRef，并以旧 aggregate version 直接验证 CAS | 追加 v2 `CONFIRMED`，v1 不变；Root CAS `1 -> 2`；Decision、Receipt、Audit、Reference Edge 与 `CustomerMaterialConfirmed` Outbox 同事务提交；stale CAS 不更新 Root | Disposable PostgreSQL：v1/v2 均存在且 payload hash 不同；Root 为 `CONFIRMED`/`2` 并指向 v2；Decision 为 `PROPOSED`+`CONFIRMED`；旧 CAS 返回 `{ok:false,current:'2'}` | `PASS` |
| `EP-WI06-P-003` | Persistence | 未接受、跨 Project、错误 objectId、错误 ContentHash 或带错误 `immutableVersionId` 的 SourceMaterialRef | 稳定拒绝 `PROJECT_MATERIAL_SOURCE_INVALID`；不创建 CustomerMaterial、Version 或确认 Event，不泄漏原始字段 | Disposable PostgreSQL：未接受/错误 Hash 返回 `REJECTED`；跨 Project 与错误 `immutableVersionId` 在写入前抛出 `PROJECT_MATERIAL_SOURCE_INVALID`；CustomerMaterial 行数为 `0` | `PASS` |
| `EP-WI06-P-004` | Persistence | Agent/`actingFor` 调用 `confirm_customer_material` | 返回 `PROJECT_HUMAN_ONLY_DENIED`；确认 Version、Decision、Event 均为 0 | Disposable PostgreSQL：Agent 和带 `actingFor` 的 Human 调用均被 `PROJECT_HUMAN_ONLY_DENIED` 拒绝，随后仅合法 Human 调用产生确认 Version/Event | `PASS` |
| `EP-WI06-P-005` | Persistence | 同一 Source 的两个 `PROPOSED` 候选具有不同分类指纹，确认其中一个 | 返回 `PROJECT_MATERIAL_CONFLICT_UNRESOLVED`；两个候选保持原状态，不采用 last-write-wins，不产生 Event | Disposable PostgreSQL：确认返回 `PROJECT_MATERIAL_CONFLICT_UNRESOLVED`；两个候选保持 `PROPOSED`，`CustomerMaterialConfirmed` Event 数量为 `0` | `PASS` |
| `EP-WI06-P-006` | Persistence | 直接 UPDATE/DELETE 已确认 Version/Decision，或用已确认旧 candidateVersionRef 再次确认 | DB 权限/不可变约束拒绝；旧 v1/v2 与 Root current pointer 保持不变，Receipt/Audit 记录安全拒绝 | Disposable PostgreSQL：Version/Decision 的 UPDATE/DELETE 均返回 PostgreSQL `42501`；旧 candidate 返回 `PROJECT_MATERIAL_CONFIRMATION_CONFLICT`，Root/版本链保持不变 | `PASS` |
| `EP-WI06-P-007` | Persistence | 同一提议/确认 idempotency key 同 Hash Replay，再改请求 Hash | Replay 返回原 Result 且不新增 Version/Event；改 Hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，首个 Receipt 不变 | Disposable PostgreSQL：提议与确认同 Hash 均返回 `DUPLICATE`；改 Hash 均返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，没有新增业务 Version/Event | `PASS` |
| `EP-WI06-U-001` | Unit | Source Selection 缺 Scope/Hash、proposal 字段为空、Evidence Scope 越界 | 写入前拒绝稳定错误，不打开部分业务写入 | 尚未执行 | `NOT RUN` |
| `EP-WI06-RLS-001` | Persistence | 已建立 Project Context、空 allowedProjectIds、以及跨 Project Source Ref 的 app-role 查询/写入 | 只可见并可写当前允许 Project；跨 Project/无 Project Context 被拒绝或不可见，不泄漏 CustomerMaterial | Disposable PostgreSQL：允许 Project Context 可读 CustomerMaterial；空 `allowedProjectIds` Context 读不到 Root，按 Project 查询返回 `0` 行 | `PASS` |
| `EP-WI06-M-001` | Manual | 脱敏采购控制程序：Source → Proposal → Human Confirm → 尝试改写确认版本 | 用户可看到精确 Ref/Decision/Completeness 与版本链，改写被拒绝；真实 Feishu/OCR/LLM/Ceph/OpenBao/生产验收仍为 `NOT RUN` | 尚未执行 | `NOT RUN` |

本切片自动化只覆盖当前实现、迁移和 Disposable PostgreSQL；真实 Source 下载/安全扫描、Evidence 外部验证、OCR/LLM Provider、公开 HTTP、跨模块 Reference Project E2E、生产环境及独立人工验收不因本测试通过而改变状态。执行测试后清理临时脚本、临时数据和 gate 容器。

## 2026-08-26 执行结果

- `pnpm format:check`：`PASS`。
- `pnpm lint`：`PASS`。
- `pnpm typecheck`：`PASS`。
- `pnpm test`（无 `ZJU_PERSISTENCE_DATABASE_URL`，真实 PostgreSQL 用例跳过）：22 个文件通过、13 个文件跳过；`349 passed / 211 skipped`，`PASS`。
- `pnpm architecture`：`PASS`。
- `pnpm contracts:check`：`PASS`，公共 Catalog `200`、Registry `200`、Schema 全部 `FULL`，未扩展公共 Contract。
- `pnpm persistence:gate`：`PASS`；pinned PostgreSQL `18.6` + Flyway `11.20.3`，空库迁移、二次 migrate no-op 和容器清理通过；16 个 Persistence 文件、`225 passed / 0 failed`。V2007 `customer material proposal confirmation` 成功应用。

以上 PASS 只证明当前 worktree、受控 Handler/Repository、迁移和 Disposable PostgreSQL；Provider、真实 Feishu/Ceph/OpenBao、公开 HTTP、跨模块 E2E、生产环境和人工 Reference Project 验收保持 `NOT RUN`。

## 2026-08-26 exact-head 交付结果

- 实现 commit `3141928df48b3be097ff554bc7b96ee933d727c1` 已通过 PR [#75](https://github.com/qzhike/zhiju-business-core/pull/75) 的 exact-head `verify` CI，并合并到 `main`，merge commit 为 `e7cfee14b699b0574abf6899a0291bc9ea706f90`。
- Issue [#62](https://github.com/qzhike/zhiju-business-core/issues/62) 已通过 GitHub API 读取为 `closed`；Issue closeout comment 已写入并读回：[issuecomment-5420158225](https://github.com/qzhike/zhiju-business-core/issues/62#issuecomment-5420158225)。
- `origin/main` 与本地默认分支已同步到 `e7cfee1`；`galendai/im-03-wi-06-customermaterial` 远端和本地 branch 均已删除，并已证明实现 commit 是 `origin/main` 的 ancestor。
