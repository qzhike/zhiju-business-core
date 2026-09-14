# Module-Test-002-EnterpriseProject

版本：v1.1
日期：2026-08-27
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IM-03 COMPLETE (SCOPED TECHNICAL ACCEPTANCE) / LOCAL AUTOMATION VERIFIED / SYNTHETIC COMPOSED CONTROLLED PERSISTENCE PASS / ISSUE #56–#68 CLOSED / INTEGRATED CROSS-AGGREGATE E2E NOT RUN / MANUAL REFERENCE PROJECT NOT RUN / EXTERNAL NOT RUN`

对应规格：[`Module-Spec-002-EnterpriseProject.md`](../module-specs/Module-Spec-002-EnterpriseProject.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| EP-API-D-001 | Design | EnterpriseProject Module Spec 与 Catalog | 18 Command、6 Query、8 Event 名称/Owner/字段完整且无重复 | `commands=18 queries=6 events=8`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| EP-API-U-001 | Unit | 没有培训程序文件，Agent 请求 MISSING_CONFIRMED | 拒绝 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；只允许 NOT_PROVIDED/UNKNOWN | 合成 CustomerBaseline focused fixture 在 `pnpm persistence:gate` 中拒绝 Agent 缺失确认 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| EP-API-U-002 | Unit | Formal Gap 输入缺 TemplateBaseline 或使用 `latest` | 拒绝 `PROJECT_GAP_INPUT_INCOMPLETE`/Reference latest 错误 | 合成 Gap/Template/Regulatory focused fixtures 的缺失、latest、hash 和 Scope 负向断言通过 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| EP-API-U-003 | Unit | TaskCompleted 存在但 Item 要求的 Release 不存在 | Completion Evaluation 为 unsatisfied，不能发 CompletionSatisfied | 合成 WI-12 Task-only evaluation=`UNSATISFIED`，Item=`NOT_READY`，无 Completion Event | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| EP-API-C-001 | Contract | Project A Command 引用 Project B CustomerMaterial | Scope/Reference 验证拒绝，不跨项目搜索替代材料 | Project/Source/CustomerMaterial/Plan/Completion cross-scope 与 RLS focused fixtures 通过 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| EP-API-C-002 | Contract | BaselineActivated Event Fixture | 精确 VersionedRef、previous ref 与 impact policy 存在，不携带材料正文 | CustomerBaseline activated Event 的 exact refs、previous ref、impact policy 和 payload minimality 断言通过 | `PASS (COMPOSED CONTROLLED PERSISTENCE)` |
| EP-API-E-001 | E2E | 不完整采购程序→材料确认→Baseline→Gap→Human 批准 Plan | 不确定性真实保留；Agent 不接受 Gap/批准 Plan；版本链可追溯 | WI focused fixtures 均通过，但没有统一 runtime runner 串起全部 Aggregate | `PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN` |
| EP-API-E-002 | E2E | 激活 CB-004 后重放引用 CB-003 的旧 Context | 旧 Context 仍解析 CB-003；旧 Gap/Plan 不改写，产生 Impact Review | CustomerBaseline/Gap stale focused fixtures 通过；统一旧 Context→Gap→Plan replay 未执行 | `PASS (COMPOSED CONTROLLED PERSISTENCE); INTEGRATED E2E NOT RUN` |
| EP-API-M-001 | Manual | 脱敏采购控制程序 Fixture | 审核者能区分 Source/Customer/Baseline/Gap/Plan/Item 和各 Human Gate | 用户确认技术-only口径；实际人工逐项浏览和输出审阅尚未执行 | `NOT RUN` |

| EP-WI01-D-001 | Design | Issue #57 决策矩阵与 `HL-Spec`、Architecture、Domain、Module Spec、Implementation Plan、Verification Baseline 的路由 | Product/QMS/Profile/ProductScope/Platform Reference 均有唯一 Owner、受控入口、授权 purpose、版本语义和失败码；文档没有把业务实现写成 PASS | 决策矩阵已建立；`markdown_links=PASS files=142 relative_links=195`；`git diff --check` 通过 | `DESIGN VERIFIED` |
| EP-WI01-D-002 | Design | ProjectStartSnapshot 缺 Profile/QMS/ProductScope、Scope 不一致或使用 `latest` | 拒绝 `PROJECT_START_SNAPSHOT_INCOMPLETE` 或 Scope/Reference 错误；不得从数据库隐式补齐 | 已在决策矩阵冻结负向场景；无 Handler/Schema | `DESIGN VERIFIED` |
| EP-WI01-D-003 | Design | Product/QMS/Profile/Platform Reference 版本变化后重放旧 Gap/Context/Plan | 旧精确 Ref 和 Hash 保留，Gap 进入 `STALE` 并追加 Impact Review；不原地覆盖 | 已在决策矩阵冻结；无 Process Manager | `DESIGN VERIFIED` |
| EP-WI01-M-001 | Manual | 用户审阅受控入口、拒绝的公共 Catalog 扩展方案和 ProjectStartSnapshot 示例 | 用户确认入口、授权、版本/Hash、失败码和 `NOT RUN` 边界 | 尚未完成用户审阅 | `NOT RUN` |

| EP-WI01-V-001 | Static | `.vibe` Markdown 相对链接与工作树差异 | 文档链接均指向存在路径；无空白错误 | `markdown_links=PASS files=142 relative_links=195`；`git diff --check` 无输出 | `PASS` |
| EP-WI01-V-002 | Repository | `pnpm verify` 全量仓库 Gate | Format、Lint、Typecheck、Unit Test、Architecture、Contract、Persistence 均通过 | 修正后 `format:check=PASS`；`lint=PASS`；`typecheck=PASS`；`Test Files 21 passed / 12 skipped`、`Tests 348 passed / 189 skipped`；`architecture_boundaries=PASS`；`contracts=PASS operations=200`；`persistence-gate=PASS`，第二次 migrate 无需迁移且 PostgreSQL 容器已清理 | `PASS` |
| EP-WI01-V-003 | Delivery | PR #69 精确 head 与远端 CI | head 必须为 `9c02ac80491b3d60c59685c2ea1ac33ce875981c`；该 head 的 `verify` 必须成功 | GitHub Actions run `32795729365` 对应该 head，`verify=success` | `PASS` |
| EP-WI01-V-004 | Repository | 当前工作区复跑 `pnpm verify` | 全量 Gate 完成；若外部镜像服务不可达，必须保留阻塞证据 | 修正后 format/lint/typecheck/test/architecture/contracts/persistence 均通过；PostgreSQL 18.6 / Flyway 11.20.3，二次 migrate no-op，容器已清理 | `PASS` |

## 本阶段结果

- Unit/Contract/E2E/Manual 的历史基线记录了当时业务 Fixture 尚不存在；当前状态由本文后续的 IM-03 合成 Fixture 技术验收章节覆盖。统一跨 Aggregate E2E 和独立人工业务验收仍为 `NOT RUN`。
- 现有公开 Contract 的静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)。
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
| EP-WI02-M-001 | Manual | `tests/manual/im03-wi02-probe.mts` 五步输出 | 用户看到 success / replay / hash-conflict / cas-conflict / rollback | Runbook：`.vibe/archive/im-03-workitem-issues/runbook-wi-02.md` | `NOT RUN` |

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

## IM-03 WI-07 CustomerBaseline 三态缺失与影响评审用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-API-U-001` | Unit/Persistence | 无培训程序时，Agent 在 CustomerBaseline 草稿中请求 `MISSING_CONFIRMED` | 返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`；不创建 Root/Version/Item；Agent 仍可提交 `NOT_PROVIDED/UNKNOWN` | `pnpm persistence:gate`：Agent 拒绝且 Root 计数为 `0`；合法 `NOT_PROVIDED/UNKNOWN` 进入 Human baseline 回归 | `PASS` |
| `EP-API-U-002` | Contract/Persistence | `PRESENT/PARTIAL` 携带已确认 CustomerMaterial refs；`UNKNOWN/NOT_PROVIDED` 携带 refs 或 Decision；`MISSING_CONFIRMED` 缺 Decision | 冻结 v1.0 Contract 拒绝非法字段/引用形状；Handler 和 DB CHECK 拒绝跨字段非法组合；合法三态可持久化 | Registry 49 tests + PostgreSQL runtime CHECK/Handler negative cases；`PRESENT/UNKNOWN/NOT_PROVIDED/MISSING_CONFIRMED` 组合通过边界验证 | `PASS` |
| `EP-API-C-002` | Contract/Persistence | `CustomerBaselineVersionActivated` Event Fixture，带精确新/旧 VersionedRef、ProjectRef、ImpactPolicyRef，并尝试放入材料正文 | 合法 Event 通过；Event 不接受客户材料正文；旧 active ref 精确保留 | Registry Event fixture 合法/正文泄漏均验证；PostgreSQL Outbox event 带精确 `previousActiveRef` 且不含正文 | `PASS` |
| `EP-API-P-001` | Persistence | Human 创建 CB-003 草稿并激活；再创建 CB-004，使用错误 previous ref 或错误 expected version | 错误 previous ref/Scope 被拒绝；精确 previous ref 可创建新 DRAFT，旧版本不变 | `pnpm persistence:gate`：CB-003→CB-004、stale previous/expected version rejection、旧版本 confirmed | `PASS` |
| `EP-API-P-002` | Persistence | 两个 Human 以同一 Root expected version 并发激活同一 DRAFT | 只有一个 `COMMITTED`；另一个 `REJECTED CONCURRENCY_CONFLICT`；只有一个 Event/Impact Review | PostgreSQL CAS concurrency：`1 COMMITTED / 1 REJECTED CONCURRENCY_CONFLICT`，单一 event/impact row | `PASS` |
| `EP-API-E-002` | E2E/Persistence | CB-004 激活后，旧 Reference Edge 仍指向 CB-003 的 Context/Gap/Plan 版本 | 旧引用解析不变；新增 Impact Review 记录 `STALE`/影响事实；不更新旧下游对象 | PostgreSQL old-edge probe：旧引用 `5` 条保留，Impact Review `STALE` 且受影响下游 refs `3`；真实 Process Manager 未运行 | `PASS (PERSISTENCE)` |
| `EP-API-P-003` | Persistence | 直接 UPDATE/DELETE CustomerBaseline Version、Item、Impact Review；或重放旧 Version 激活 | app role/不可变触发器拒绝；旧版本、条目、Impact Review 和 active pointer 不被覆盖 | PostgreSQL app-role ACL、immutable triggers、active-pointer deferred guard、stale activation checks 均通过 | `PASS` |
| `EP-API-M-001` | Manual | 脱敏采购控制程序：材料确认→Baseline 草稿→Human 激活→补资料→新版本→旧 Context/Gap/Plan probe | 用户可区分 `PRESENT/PARTIAL/NOT_PROVIDED/UNKNOWN/MISSING_CONFIRMED`，并看到旧版本未被改写 | disposable local probe 实际输出 Agent rejection、`PRESENT/UNKNOWN/NOT_PROVIDED`、旧 refs `5`、`STALE/3`；真实下游 Process Manager/独立人工验收未运行 | `PASS (LOCAL PROBE); HUMAN NOT RUN` |

本切片的自动化和 disposable local probe 已实际通过，只证明 Contract、当前 Handler/Repository、迁移和 Disposable PostgreSQL；不会把不存在的 Gap/Plan/Context Process Manager、Provider、公开 HTTP、跨模块业务 E2E、生产环境或独立人工 Reference Project 验收写成 `PASS`。每次执行 gate 后必须清理容器、临时数据库、临时脚本和测试数据。

## 2026-08-26 WI-07 exact-head closeout

- PR [#77](https://github.com/qzhike/zhiju-business-core/pull/77) 的 exact head `e71300055fdd40051dc24d1e8d76003c3f32ccc1` 已通过 GitHub `verify` CI，并以 merge commit `f63ae2a373c312790c550957ac3aa51c0cf603dd` 合并到 `main`。
- PR review comment [#5420888555](https://github.com/qzhike/zhiju-business-core/pull/77#issuecomment-5420888555) 和 Issue comment [#5420896539](https://github.com/qzhike/zhiju-business-core/issues/63#issuecomment-5420896539) 已发布并读回；Issue [#63](https://github.com/qzhike/zhiju-business-core/issues/63) 状态为 `CLOSED`。
- `origin/main=f63ae2a...` 已确认包含实现 head；`galendai/im-03-wi-07-customerbaseline` 远端和本地 branch 已删除。真实 Provider、公开 HTTP、下游 Process Manager、跨模块 E2E、生产和独立人工验收仍为 `NOT RUN`。

## IM-03 WI-08 TemplateBaseline 与 RegulatoryProfile 用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI08-U-001` | Unit/Contract | Platform Template/Regulatory import 缺 source、hash、verificationRefs 或平台 capability | 写入前返回稳定错误，不创建业务版本 | `pnpm persistence:gate`：缺 source=`PROJECT_PLATFORM_REFERENCE_INVALID`，hash=`PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH`，缺 capability=`PROJECT_PLATFORM_REFERENCE_ROLE_REQUIRED`，空 verification=`PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED` | `PASS` |
| `EP-WI08-P-001` | Persistence | Reference Admin 导入同一 Platform Template/Regulatory version，再由 Publisher 发布 | 产生 DRAFT；只有精确版本可 PUBLISHED；发布后正文/hash/version 不可更新；普通 app 只能读已发布事实 | PostgreSQL 用例：DRAFT/app 隔离、Template v1/v2 精确发布、PUBLISHED UPDATE 返回 `42501`；V2009 空库迁移通过 | `PASS` |
| `EP-WI08-P-002` | Persistence | Project Human 冻结 TemplateBaseline，selection 使用 exact published template ref；尝试 latest、未发布、hash mismatch | 合法请求创建 FROZEN version；非法引用拒绝且无 Root/Version/Item/Event 部分写入 | PostgreSQL 用例：exact TemplateBaseline/FROZEN Selection 通过；`latest`、未发布和 hash mismatch 均拒绝 | `PASS` |
| `EP-WI08-P-003` | Persistence | Project Human 激活 RegulatoryProfile，包含 exact product scope、applicability、independent evidence refs | 合法请求创建 active FROZEN profile；缺 evidence、模板冒充 evidence、product snapshot 不匹配被拒绝 | PostgreSQL 用例：法规 version/hash、applicability、independent Evidence、ProductScope Snapshot 及模板冒充 Evidence 拒绝均通过 | `PASS` |
| `EP-WI08-P-004` | Persistence | 已有 Root 的 expected version CAS；首次 Root 使用相同及不同候选 baselineId、不同 versionId/idempotencyKey，以真实数据库锁等待控制交错 | 恰好一次 COMMITTED、一次 REJECTED / CONCURRENCY_CONFLICT；Root/pointer、FROZEN Version、Selection、Reference Edge、成功 Event 仅属于赢家；输家仅保留拒绝 Receipt/Audit；重放不重复写入；无关约束不映射为冲突 | 真实 PostgreSQL 锁屏障覆盖两种 identity 竞争、赢家完整事实、拒绝 Receipt/Audit、双方重放、跨 Scope 主键碰撞及无关 CHECK 失败回滚；保留已有 Root CAS/不可变历史用例 | `PASS` |
| `EP-WI08-P-005` | Persistence | 直接 UPDATE/DELETE 已发布 Platform Version、FROZEN Project Version、Selection、Profile Item | DB ACL/immutable trigger 拒绝；旧精确 refs、hash、edges 和 active pointer 保持不变 | PostgreSQL 用例：Platform PUBLISHED、TemplateBaseline Version UPDATE 被 `42501` 拒绝；不可变 DDL/ACL 与 active pointer gate 通过 | `PASS` |
| `EP-WI08-C-001` | Contract/Persistence | 回放同一 command idempotency key 与并发 CAS；检查 receipt、audit、outbox、edges | 同 hash 返回 duplicate；并发只保留一个提交；事实同事务且无正文泄漏 | PostgreSQL 用例：replay=`DUPLICATE`、CAS 单赢家、Receipt/Audit/Outbox/Reference Edge 同事务；Contract baseline 200 operations | `PASS` |
| `EP-WI08-RLS-001` | Persistence | Platform writer、普通 app、Project Context 读取和写入平台/项目表 | writer 只写平台受控表；普通 app 只读 published；Project context 只能看允许 Project；无 scope 不泄漏 | PostgreSQL 用例：普通 app 读不到 DRAFT、不能 UPDATE PUBLISHED；Project active refs 由受信 Context 返回；FORCE RLS/角色权限通过 | `PASS` |
| `EP-WI08-E-001` | E2E/Persistence | Platform current pointer 改到新版本后读取旧 Project baseline/profile | 旧 Project 的 exact refs/hash 不变；新版本需显式新 command；不存在 latest 隐式漂移 | PostgreSQL 用例：Platform v2 发布后 active refs 仍为 v1，Selection/Profile Item 的 version/hash 与旧记录一致；v1/v2 内容 Edge 均存在 | `PASS (PERSISTENCE)` |
| `EP-WI08-M-001` | Manual | 脱敏采购程序：导入→发布→Human 冻结模板→Human 激活法规→读取旧版本 | 用户能看到版本/hash/scope/evidence/审计链；Provider、真实法规来源、公开 HTTP、生产和独立人工验收仍标 `NOT RUN` | 本地 PostgreSQL 自动化已输出 exact version/hash/scope/evidence/Edge；真实 Provider、法规来源、公开 HTTP、生产和独立人工验收未运行 | `PASS (LOCAL); HUMAN NOT RUN` |

### WI-08 active refs convergence

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI08-C-002` | Persistence/Contract | Project 已有 CustomerBaseline、TemplateBaseline、RegulatoryProfile active pointer，调用既有 `project.get_active_baseline_refs@1.0` | 同一 Project Context 返回三个精确 VersionedRef 与各自 aggregate version；未激活 root 不返回；不推导 latest | PostgreSQL 用例返回 TemplateBaseline/RegulatoryProfile exact refs 与 aggregate versions；CustomerBaseline 缺失时省略，仅返回已激活 roots | `PASS` |

CustomerBaseline 既有并发激活用例若先观察到目标 Version 已确认，仍需二次读取 Root；当 Root 已由并发事务从 `1` 推进到 `2` 时，实际结果必须归类为 `CONCURRENCY_CONFLICT`，而不是 `PROJECT_BASELINE_VERSION_IMMUTABLE`。

测试 fixture 的 Platform `referenceCode` 按 root UUID 唯一化；同一 root 的后续版本保持同一 code，以分别覆盖跨用例隔离和 root 内版本唯一性。

TemplateBaseline 的 ProjectRef 与 review SnapshotRef 不携带 target ContentHash 时，Reference Edge 仍应正常提交，且 target payload hash 保持 NULL。

latest/hash/evidence 负向命令仍使用与 payload exact ref 一致的 target identity，确保断言命中业务引用校验而非先被 Command target mismatch 截断。

当前静态检查复核全部通过：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm architecture`、`pnpm contracts:check` 和 `pnpm build` 均为 `PASS`；`pnpm test` 为 `22 test files passed / 16 skipped`、`351 passed / 224 skipped`；Contract 保持 `operations=200`。

最终 PostgreSQL Gate：PostgreSQL `18.6` / Flyway `11.20.3`，`19 files / 238 passed / 0 failed`；空库迁移成功，V2010 成功应用，二次 migrate 为 no-op，容器已清理。WI-09 的 exact input、UNKNOWN/epistemic、immutable、Human-only、Accepted/Reject/Changes、replay、CAS、CustomerBaseline handler stale/Impact 链路均已包含在上述数字中。

最终 `pnpm verify` 编排为 `PASS`：非数据库阶段 `22 test files passed / 16 skipped`、`351 passed / 224 skipped`，随后静态门禁和 PostgreSQL `19 files / 238 passed` Gate 均通过；V2010 二次 migrate 为 no-op，容器已清理。

Provider、真实法规来源、公开 HTTP、跨模块 Process Manager、生产环境和独立人工 Reference Project 验收继续保持 `NOT RUN`。

## IM-03 WI-09 GapAnalysis 冻结输入、Human 接受与 stale 用例

以下结果来自当前工作树的受控实现与测试执行；结果只覆盖本地代码和 Disposable PostgreSQL 边界，不替代 Provider、生产或人工验收证据。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI09-U-001` | Unit/Contract | FORMAL 输入缺一个必需 ref、携带 `latest`、Project/Enterprise Scope 错配、Snapshot hash/identity 错误或非法 mode | 写入前拒绝 `PROJECT_GAP_INPUT_INCOMPLETE`/Scope/Hash/Status 稳定错误；无 Root、Version、Finding、Receipt 副作用 | `pnpm persistence:gate` 覆盖 missing/latest/scope/profile identity/hash/mode；4 个 WI-09 测试文件组内断言通过，拒绝路径无 Root 副作用 | `PASS (PERSISTENCE)` |
| `EP-WI09-U-002` | Unit | Finding 使用 `UNKNOWN`，或以 `MISSING` 代替未确认事实；高风险 Finding 缺 Evidence/信息请求 | `UNKNOWN` 原样保存；错误 epistemic 组合返回 `PROJECT_GAP_EPISTEMIC_CONFLICT` | `UNKNOWN` 保存并派生 summary；`UNKNOWN→MISSING` 与 CRITICAL 无证据均返回 `PROJECT_GAP_EPISTEMIC_CONFLICT` | `PASS (PERSISTENCE)` |
| `EP-WI09-P-001` | Persistence | 创建含 finding 的完成版本后直接 UPDATE/DELETE Version、InputSnapshot、Finding | 数据库 ACL/immutable trigger 拒绝；旧 payload/hash/finding 仍可读 | 真实 PostgreSQL 直接 UPDATE InputSnapshot、Version、Finding 均被 immutable trigger 拒绝；旧 input/finding 读取保持一致 | `PASS (PERSISTENCE)` |
| `EP-WI09-P-002` | Persistence | Agent、Service、`actingFor` 与可信 Human 分别执行 accept；Human 分别提交 ACCEPT、REJECT、CHANGES_REQUIRED | 非 Human 返回 `PROJECT_GAP_HUMAN_ACCEPTANCE_REQUIRED`；仅 ACCEPT 设置 accepted pointer 和 Accepted Event；其余状态不设置 pointer | Agent/Service/actingFor 均拒绝；Human ACCEPT、REJECT、CHANGES_REQUIRED 的 Root/Version/Decision 状态通过 | `PASS (PERSISTENCE)` |
| `EP-WI09-C-001` | Contract/Persistence | Human ACCEPT 精确 Versioned Gap ref、Review Snapshot、Justification | `GapAnalysisAccepted` 只含 exact Gap/Project/InputSnapshot/Decision refs，不复制 finding/客户正文；Decision、Receipt、Audit、Outbox 同事务提交 | Accepted Event、Decision、Receipt、Audit、Outbox 与 Reference Edge 的 exact refs/同事务事实通过；公共 Contract 仍为 200 operations | `PASS (PERSISTENCE)` |
| `EP-WI09-P-003` | Persistence | 同一 accept command 重放；两个 Human 以同一 expected aggregate version 并发接受；中途故障 | 同 hash 返回 `DUPLICATE`；CAS 只有一个赢家；失败事务无 Decision/Event/pointer 部分写入 | accept replay 返回 `DUPLICATE`；并发结果为单一提交者和 `CONCURRENCY_CONFLICT`；共享 Command Runner fault-rollback 用例通过，WI-09 未注入独立故障 | `PASS (PERSISTENCE; SHARED ROLLBACK)` |
| `EP-WI09-E-001` | E2E/Persistence | 接受旧 Gap 后通过 CustomerBaseline 激活 handler 提交新版本，并验证 stale/Impact；Template/Regulatory 复用同一依赖传播边界 | 旧 Gap 与 Finding 保留，旧精确输入和 Decision 不变；旧 Version/Root 变为 `STALE`，Impact/trigger ref 可解释；不自动撤销 Plan/Artifact | 通过真实 `handleCreateCustomerBaselineDraft` + `handleActivateCustomerBaselineVersion` 链路验证：旧 Root/Version=`STALE`，Finding/Input/Decision 保留，Impact Review 含 Gap trigger ref；Template/Regulatory 专项场景未独立执行 | `PASS (CUSTOMER PATH); TEMPLATE/REGULATORY NOT RUN` |
| `EP-WI09-M-001` | Manual | 脱敏采购程序：七个冻结输入→受控 finding→Human review→接受→新 Baseline→旧 Gap 查询 | 用户能区分 UNKNOWN/MISSING、看到 exact refs/hash/Decision/stale Impact；Provider、公开 HTTP、生产和独立人工验收仍为 `NOT RUN` | 本地自动化已证明 exact refs/hash、UNKNOWN、Human decision、stale/Impact；Provider、公开 HTTP、生产和独立人工验收未执行 | `PASS (LOCAL AUTOMATION); HUMAN NOT RUN` |

WI-09 的结果已补写本表；真实 Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收不能由这些结果推断为 `PASS`。本轮 PostgreSQL 容器已清理，未保留临时数据库、临时脚本或临时测试文件。

## 2026-08-27 PostgreSQL 镜像 pin 漂移与修复记录

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI09-V-002` | Delivery/Persistence | GitHub `pull_request` exact-head run `33021401819`、`33021517085`；PostgreSQL `18.6` tag 与仓库 pinned manifest digest | 静态、Unit、Contract 阶段通过后，Gate 应验证当前 tag 解析结果与 immutable pin 相同；若不同必须拒绝；修复后本地与新的 exact-head CI 均需完整通过 | 两次旧 head run 的静态、Unit、Architecture、Contract 均通过，Gate 拒绝旧 pin `sha256:1957b2ff3137e4ef7f3bc813e74fff50b1e1ffddc85c8b9d6f14ade972be8687`；更新为当前 `postgres:18.6` digest `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` 后，本地 `pnpm verify` 完整通过，corrected exact head 的远端 run `33022900309` 也完整通过，Flyway `11.20.3` pin 未变 | `PASS (LOCAL AND REMOTE EXACT HEAD)` |

两次旧 head 的失败属于远端 registry tag 与仓库 pin 的物理 baseline 漂移，不是 WI-09 业务实现或测试断言失败。修复后第一次完整本地编排另遇 Docker Hub manifest 查询 `EOF`，随后重试成功；corrected exact head 的远端 run `33022900309` 已完整通过。Provider、生产和人工边界仍保持 `NOT RUN`。

同一 exact head 的第二条远端 run `33022308826` 还暴露了并发接受返回码的竞争窗口：一个事务返回 `COMMITTED` 后，另一个事务曾观察到旧 Root aggregate version `1` 但已更新的 Version 状态，返回了 `PROJECT_GAP_DECISION_CONFLICT`，而预期必须是 `CONCURRENCY_CONFLICT`。接受命令已改为以 Root 行锁和最新 Root 读取作为并发判定依据；修复后本地 `pnpm persistence:gate` 连续两次通过，均为 `19 files / 238 passed`，并保持单一提交、单一 Decision/Event 与无部分写入；corrected exact head 的远端 run `33022900309` 已再次通过该用例。

2026-08-27 exact-head closeout：实现 head `6de5c96c4ba4fe0938b422606d4632048ac19932` 已通过 [GitHub Actions run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309)，并以 merge commit `2d6afd0cc2889cf0fa6350c0599d514d5917b071` 合入 `main`；Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已 `CLOSED`，closeout comment 为 [issuecomment-5432258964](https://github.com/qzhike/zhiju-business-core/issues/65#issuecomment-5432258964)，远端和本地 WI-09 feature branch 均已删除，`origin/main` 已确认包含 implementation head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。
## IM-03 WI-10 DeliveryPlan/DeliveryItem 测试基线（2026-08-27）

以下用例在实现前登记；`NOT RUN` 表示尚未执行，不是通过。所有实际输出必须写入本表并区分静态、Unit/Contract、Disposable PostgreSQL、受控本地 E2E、Provider、公开 HTTP、生产和人工验收。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI10-U-001` | Unit/Contract | 缺少 accepted Gap、使用 latest/current、跨 Scope/hash 错误、与 Accepted Gap InputSnapshot 不一致或不完整的 active baseline、未 ACCEPTED Gap、未知 GapItem 或缺 QualityProfile 的 draft | 在任何 DeliveryPlan/Item 业务事实写入前拒绝稳定错误；拒绝 receipt 可由共享 Command Runner 记录，但不创建 DeliveryPlan/Item/Outbox 业务事实 | PostgreSQL fixture 覆盖 alternate active ProductScopeSnapshot、缺失 baseline、非 Accepted Gap、Accepted Gap InputSnapshot 五项完整集合和成功 fixture | `PASS (PERSISTENCE)` |
| `EP-WI10-U-002` | Unit | 重复 item id/key、空 item 字段、self dependency、unknown dependency 或同一 Plan Version 内的有向环 | 拒绝 `PROJECT_DELIVERY_ITEM_INVALID`、`PROJECT_DELIVERY_ITEM_KEY_CONFLICT` 或 `PROJECT_DELIVERY_DEPENDENCY_CYCLE`；不写入部分 Item | PostgreSQL fixture 的 duplicate key、cyclic dependency 和成功 DAG 断言通过 | `PASS (PERSISTENCE)` |
| `EP-WI10-P-001` | Persistence | Agent 创建 draft；Agent/Service/actingFor/伪造 actor 批准或激活；可信 Human 批准 | Agent 可起草；非 Human/actingFor 不能产生 Decision 或 pointer；Human 才能追加 Decision | WI-10 gate 中 Agent draft 成功，Agent/Service/actingFor approval 与 Agent activation 均返回 Human-only；伪造 envelope actor 由共享 context guard 覆盖 | `PASS (PERSISTENCE)` |
| `EP-WI10-P-002` | Persistence | Human 对同一 Plan 分别提交 APPROVE、CHANGES_REQUIRED、REJECT；使用 foreign/mismatched/replayed approval Decision 激活 | 只有 APPROVE 设置 approved pointer；其他决定 pointer 为 NULL；激活必须匹配精确 Plan Version、Human Decision hash 和 Impact Policy | 三态 Decision、非 APPROVE pointer、错误 approval hash 和精确 Human APPROVE activation 均通过 | `PASS (PERSISTENCE)` |
| `EP-WI10-P-003` | Persistence | 直接 UPDATE Approved/Active Plan Version、Item、criteria、Dependency、Requirement 或 Decision；创建变更后的新 Plan | 旧事实 UPDATE/DELETE 被拒绝；新 scope/criteria/依赖通过新 Plan Version/identity 保存，旧 hash/ref 不变 | Version payload、Item 和 Decision 的真实 PostgreSQL immutable trigger/ACL 断言通过；新的 Plan Version command 不在本切片范围 | `PASS (IMMUTABILITY); NEW VERSION COMMAND NOT RUN` |
| `EP-WI10-P-004` | Persistence | 两个 Human 以同一 expected aggregate version 激活；同一 command 重放；激活事务中注入故障 | 仅一个激活成功，输家为 `CONCURRENCY_CONFLICT`；重放返回 `DUPLICATE`；失败无 pointer/status/Event 半写入 | 同一 Plan activation race 为 `1 COMMITTED / 1 CONCURRENCY_CONFLICT`，winner replay 为 `DUPLICATE`；WI-10 专用 rollback injection 未接入 | `PASS (CONCURRENCY/IDEMPOTENCY); ROLLBACK NOT RUN` |
| `EP-WI10-P-005` | Persistence | 已有 Active Plan 后激活新 Plan；读取两组 Plan/Item/Dependency/Requirement/Decision | 同一 Project 只保留一个 ACTIVE；旧 Plan/Version 为 `SUPERSEDED` 且所有历史事实与 hash 保留 | 两组真实 Plan/Item/Dependency/Requirement/Decision 读取通过；partial unique index 保证单 ACTIVE，旧 Root/Version 为 `SUPERSEDED` | `PASS (PERSISTENCE)` |
| `EP-WI10-RLS-001` | Persistence/RLS | Project A context 读取/写入 Project B Plan；无 context 读取；跨 Enterprise 请求 | FORCE RLS 阻断跨 Scope/无 context；Handler 和组合 FK 同时拒绝 | WI-10 六表 FORCE RLS、Scope mirror、组合 FK 已迁移；cross-project exact Plan query 被稳定拒绝 | `PASS (RLS/MIGRATION)` |
| `EP-WI10-E-001` | E2E/Persistence | Accepted Gap→含依赖 Item 的 draft→先提交环→Human APPROVE→精确 Decision 激活→查询 Item criteria | 环先被拒绝；修正后 Plan/Item 激活；查询返回精确 refs、criteriaHash 和 `NOT_READY`，不返回伪造 completion | 受控 PostgreSQL E2E 依次通过 cycle rejection、DAG draft、Human approval、Service exact-decision activation 和 criteria query | `PASS (PERSISTENCE E2E)` |
| `EP-WI10-C-001` | Contract/Event | 激活含 2 个 Item 的 Plan，读取 Outbox 事件 payload | 1 个 `DeliveryPlanActivated` + 2 个 `DeliveryItemActivated`；只含精确 refs/hash/previous ref/quality ref，不含 criteria JSON、Gap finding 或客户正文 | 真实 Outbox 返回 1 个 Plan Event + 2 个 Item Events；payload minimality 与现有公共 Event Contract 断言通过 | `PASS (CONTRACT/PERSISTENCE)` |
| `EP-WI10-M-001` | Manual | 脱敏采购控制程序，从 accepted Gap 到 Human approve/activate 后查看精确 Item refs | 人工能确认 Agent 只能起草、Human gate、依赖环拒绝、criteria/hash 冻结和旧版本保留；Provider、公开 HTTP、生产和独立人工 Reference Project 仍为 `NOT RUN` | 本地自动化已覆盖同一控制链；独立人工验收未执行 | `PASS (LOCAL AUTOMATION); HUMAN NOT RUN` |

WI-10 的本地结果已记录空库迁移、二次 migrate no-op、静态门禁、Unit/Contract、真实 PostgreSQL、受控 E2E 和 cleanup 证据。WI-10 专用 rollback fault injection、Provider、公开 HTTP、跨模块 Process Manager、生产和人工测试仍为 `NOT RUN`，不得被 `pnpm verify` 或 disposable PostgreSQL 结果覆盖。

WI-10 exact-head closeout（2026-08-27）：实现 head `054480ebac29cd820e7893df5844ad23a6940f3b` 已通过 [PR #83](https://github.com/qzhike/zhiju-business-core/pull/83) 的 [GitHub Actions verify run 33029833203](https://github.com/qzhike/zhiju-business-core/actions/runs/33029833203)，并以 merge commit `71e527b110b7c65d6a73ba16aca4ed1b334bf89d` 合入 `main`；Issue [#66](https://github.com/qzhike/zhiju-business-core/issues/66) 已读回为 `closed`，原始远端和本地 feature branch 均已删除。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。

## IM-03 WI-11 权威 Query、Source Slice 与 Board Projection 测试基线（2026-08-27）

以下用例在实现前登记为 `NOT RUN`。真实 PostgreSQL 用例必须使用空库、固定版本 Migration 和唯一 Scope；每次 Gate 结束清理容器、临时数据库、临时脚本和测试文件。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI11-U-001` | Unit/Contract | 合法 ProjectRef、Principal Audience、`context.snapshot.read` 与 requestedKinds；权威 Fact 含敏感 value/sourceRefs；绑定 Ref 含额外 JSON 字段；未请求或 purpose 禁止 Fact；未知 purpose/kind、跨 Scope Audience、过期 Context | 合法请求只返回 allow-list Ref、安全 Fact 元数据和 REDACTED 标记；允许 Fact 时记录对应 redaction，未请求/禁止时只记录 omission；非法输入在读取前以稳定错误拒绝且不泄露原文 | WI-11 real PostgreSQL Source Slice fixture 验证 binding 额外字段剥离、Fact value/sourceRefs 脱敏、`record.form.read` omission，以及未知 kind/purpose、跨 Scope Audience、过期 Context 拒绝 | `PASS (PERSISTENCE QUERY; UNIT-ONLY PATH NOT SEPARATELY SEEDED)` |
| `EP-WI11-P-001` | Persistence | Project Root 含 Customer/Template/Regulatory active pointer、Gap accepted pointer、DeliveryPlan active pointer；另有更高但未激活版本；active pointer 指向错误生命周期版本 | 只返回 Root 精确 pointer 对应的 VersionedRef；不查询 latest/current，不把未激活版本混入结果；Handler 对数据库读回状态执行防御性校验，非 `CONFIRMED/FROZEN/ACCEPTED/ACTIVE` pointer 稳定拒绝 | WI-10 real PostgreSQL fixture 在 Plan 激活后读取五类精确 active/accepted refs；Customer/Template/Regulatory/Gap/DeliveryPlan pointer 与 version 断言通过，未激活版本未混入 | `PASS (PERSISTENCE; INVALID-STATUS NEGATIVE PATH NOT SEPARATELY SEEDED)` |
| `EP-WI11-P-002` | Persistence | 精确 DeliveryPlan Version/Item criteria；Projection alias 暂停并推进 target watermark | criteria definition/hash 和 `NOT_READY` execution projection 保持不变；Projection 状态不能成为 authoritative 判据 | DeliveryPlan real PostgreSQL criteria fixture 返回持久化 definition/hash 与 `NOT_READY`；独立 WI-11 pause fixture 暴露 projection lag/status，未把 projection 状态代替 criteria 判据 | `PASS (PERSISTENCE; CRITERIA/PROJECTION SEPARATE FIXTURES)` |
| `EP-WI11-P-003` | Persistence | 两页 Board rows（包含非自然数字序 itemKey）、固定过滤器、有效 cursor；篡改 cursor、跨 Project cursor、过期 cursor；无下一页时的 optional cursor | 写入、读取和 cursor 使用同一固定 UTF-8 字节序，按 `itemKey ASC, deliveryItemId ASC` 稳定分页；Scope/Filter/Version/expiry 不匹配统一返回 cursor 错误；没有下一页时省略 cursor 字段 | WI-11 real PostgreSQL fixture 以 `item-10`/`item-2` 验证固定排序、两页 cursor、篡改/过滤/跨 Project/过期 cursor 拒绝及末页省略 `nextCursor` | `PASS (PERSISTENCE)` |
| `EP-WI11-P-004` | Persistence | authoritative Snapshot Export + 有序 Event Delta（upsert/remove）；可选 event id 缺失时省略字段 | 新 Projection Version READY；checkpoint、row count、domain checksum 与预期一致；alias 原子切换且旧版本保留；不写入显式 `null/undefined` | WI-11 real PostgreSQL rebuild fixture 验证 Snapshot + UPSERT/REMOVE、READY、checkpoint/source watermark、row count/domain checksum、alias 原子切换和旧版本保留 | `PASS (PERSISTENCE)` |
| `EP-WI11-P-005` | Persistence | Projection 暂停；记录新的 source event；读取 Board；恢复或 rebuild；在已有 target 较高时消费较低事件 | target-last 形成明确 lag，status 为 `STALE/PAUSED`；暂停期间 alias 不变；恢复后 last watermark 单调推进且不覆盖更高 target | WI-11 real PostgreSQL fixtures 验证较高 target 保留、较低事件消费后的 lag、pause 期间 alias 不变、rebuild 恢复及最终 `READY`/lag=0 | `PASS (PERSISTENCE)` |
| `EP-WI11-P-006` | Persistence | 重复 event、sequence 为 0 或乱序、非 `enterprise_project` source module、跨 Project event、错误 partition、错误 item ref、缺失 ProjectSnapshotBinding；低序 watermark 直接写入 | 同一已提交 event 重放返回 `DUPLICATE`；低于 checkpoint 的消费返回 `PROJECT_PROJECTION_CHECKPOINT_CONFLICT`；其他输入返回 `PROJECT_PROJECTION_EVENT_INVALID` 或稳定 Query not-found/ref error；不得静默跳过、空值解引用或回退 source/checkpoint watermark | WI-11 real PostgreSQL 用例覆盖同一 event `DUPLICATE`、低于 checkpoint 的 consume conflict、sequence 0、错误 source module、跨 Project rebuild/Query、缺失 binding、partition/Scope guard | `PASS (PERSISTENCE)` |
| `EP-WI11-RLS-001` | Persistence/RLS | Project A、Project B、无 Context 使用 projection_app 读取/写入；直接 UPDATE/DELETE Board/failure row；写入错误 partition | FORCE RLS 阻断越权；Board row 与 failure fact 不可变；partition 与 Project 一致；只有受控 alias/checkpoint/source state 可更新 | WI-11 real PostgreSQL fixture 验证 cross-project 隔离、FORCE RLS、Board/failure UPDATE/DELETE 拒绝、partition/checkpoint/source watermark guard | `PASS (PERSISTENCE/RLS)` |
| `EP-WI11-M-001` | Manual/Local | 对同一 Project 读取 authoritative Source/criteria 与人为暂停 Projection 的 Board | 页面或 CLI 同时显示 source watermark、projection watermark、lag/status；用户不会把 Board 延迟误判为业务完成/未完成 | 自动化输出验证 source/projection watermark、lag/status 与 criteria 独立；独立人工页面操作尚未执行 | `PASS (LOCAL AUTOMATION); HUMAN NOT RUN` |

Provider、公开 HTTP、跨模块 Process Manager、生产数据库和独立人工 Reference Project 验收不由本地 Gate 代替，保持 `NOT RUN`。

WI-11 exact-head closeout（2026-08-27）：实现 head `c8f1a2cc6291ff65824a04e437a99b660fd926aa` 已通过 [PR #85](https://github.com/qzhike/zhiju-business-core/pull/85) 的 [GitHub Actions run 33039239177](https://github.com/qzhike/zhiju-business-core/actions/runs/33039239177)，并以 merge commit `43a2f4fcf074e565c10f3db54bd1be9134ef471d` 合入 `main`；PR verification comment 已读回：[issuecomment-5434378070](https://github.com/qzhike/zhiju-business-core/pull/85#issuecomment-5434378070)。Issue [#67](https://github.com/qzhike/zhiju-business-core/issues/67) 已读回为 `closed`，Issue closeout comment 已读回：[issuecomment-5434387709](https://github.com/qzhike/zhiju-business-core/issues/67#issuecomment-5434387709)；远端和本地 WI-11 feature branch 均已删除，`origin/main` 已确认包含 implementation head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。
## IM-03 WI-12 DeliveryItem Completion 与 Impact Process 用例基线（2026-08-27）

以下用例在实现前登记为 `NOT RUN`。真实 PostgreSQL 用例必须使用空库、V2013 固定迁移、唯一 Enterprise/Project/Plan/Item Scope；每次 Gate 结束清理容器、临时数据库、临时脚本和测试文件。

WI-12 的三张 EnterpriseProject owning 表（`delivery_item_completion_fact`、`delivery_item_completion_evaluation`、`delivery_item_impact_review`）已纳入既有技术表目录回归；主消费/评估链与 Unit/Contract、revoke/new-version、ACL/RLS、故障回滚、晚到事实和状态转移断言已由最终 `pnpm verify` 通过。Persistence Gate 使用 PostgreSQL 18.6（`server_version=180006`）和 Flyway 11.20.3，21 个 persistence 测试文件、256 个测试全部通过，空库迁移和二次 no-op 通过并清理容器。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI12-U-001` | Unit/Contract | `allOf` criteria、错误 criteriaHash、未知 eventType、重复/跨 Scope factRef、caller 提交 outcome 或 `submittedCompletion`、缺失 `sourceEventId` | 只接受已注册 criteria 与 exact refs；hash/grammar/scope/lifecycle 错误在写入前稳定拒绝；不接受 caller completion；Event Consumer 必须绑定精确 source event | `pnpm verify` 的 Unit/Contract 路径通过；独立 Unit 文件 4/4，完整 Vitest 24 文件通过；TypeScript project service、Buffer/ContentHash 夹具和 sourceEventId 断言均通过 | `PASS (UNIT/CONTRACT)` |
| `EP-WI12-P-001` | Persistence | 注入合法 `execution.TaskCompleted@1.0`，criteria 同时要求 TaskCompleted 与 ReleaseCompleted | Inbox/Fact/Process Step 成功；Evaluation 为 `UNSATISFIED`；不产生 `DeliveryItemCompletionSatisfied`；Item 不被直接写成 `COMPLETED` | `pnpm persistence:gate`：Task fact、Inbox/Process Step、Task-only Evaluation=`UNSATISFIED`、无 Completion Event、Item=`NOT_READY` 通过 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-002` | Persistence | 在 P-001 后注入同一 Project 的精确 `release.ReleaseCompleted@1.0`，再评估 | 两个 ACTIVE formal facts 可被精确选择；Evaluation 为 `SATISFIED`；只产生一个最小 Completion Event，Root current pointer 从独立版本 `1` CAS 到该 Evaluation | `pnpm persistence:gate`：Release fact 后 Evaluation=`SATISFIED`，Completion/Impact Event、current pointer 和独立版本 `1→3` 通过 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-003` | Persistence | 同一 event/command 相同 payload hash/watermark replay；同 event id 改 payload hash 或 watermark | 相同输入返回 `DUPLICATE` 且无第二 Fact/Event；不同 hash/watermark 写 contract violation、Inbox `QUARANTINED`，首条事实不变 | `pnpm persistence:gate`：event replay=`DUPLICATE`，同 event id 改 payload 返回 `QUARANTINED`，Fact count=`1`、`INBOX_HASH_CONFLICT` violation count=`1`；command replay=`DUPLICATE` | `PASS (PERSISTENCE)` |
| `EP-WI12-P-004` | Persistence | late fact、同一上游对象新 Version/Hash、`quality.RevisionApprovalLost` 或 `release.ReleaseRecalled` | 只追加新 Fact/Evaluation/Impact Review；revoked fact 不再满足 ACTIVE criterion；旧 Evaluation、Plan Version、Approval、Fact 和 hash 保留；发布 Impact Event 时 payload 仅含精确 refs/reason；已满足状态下的 late fact 不重复发 Completion Event | `pnpm persistence:gate`：revoke 后为 `UNSATISFIED`，同一上游新 PackageSnapshot 后为 `SATISFIED`，晚到 Task 后新增第 4 个 Evaluation 和第 3 个 Impact；5 个 Fact、2 个 Completion Event，旧 Plan Version/Approval/hash 不变 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-005` | Persistence/RLS | 直接 UPDATE `delivery_item.execution_status='COMPLETED'`、UPDATE/DELETE Fact/Evaluation/Impact；Project A Context 读写 Project B | ACL/trigger/RLS 拒绝；无 Completion/Impact 半写入；旧 immutable history 保持可读 | `pnpm persistence:gate`：直接完成写入及历史表 UPDATE/DELETE 均返回 `42501`；跨 Project SELECT 返回 `0`；Item 仍为 `NOT_READY`、Completion version=`2` 且 pointer 不变 | `PASS (PERSISTENCE/RLS)` |
| `EP-WI12-P-006` | Persistence | 两个评估命令竞争同一 Item current pointer；一个在 Outbox/Impact 写入后故障 | 只有一个 CAS 成功，输家 `CONCURRENCY_CONFLICT`；故障事务回滚 Inbox/Fact/Evaluation/Impact/Root/Event；历史不重写 | `pnpm persistence:gate`：CAS 为 `1 COMMITTED / 1 REJECTED CONCURRENCY_CONFLICT`；Impact outbox `P0001` 注入后 facts=`3`、evaluations=`2`、impacts=`1`、Completion events=`1`、Root version=`3`，失败评估无半写入且故障事件 Inbox=`PROCESSED` | `PASS (PERSISTENCE)` |
| `EP-WI12-E-001` | E2E/Persistence | 受控 Fixture 依次注入 TaskCompleted、评估；再注入 ReleaseCompleted、评估；读取 criteria/Root/Outbox/Inbox | 用户可看到缺 Release 时未完成，补齐精确 Release 后才完成；所有 Event/Fact/Evaluation/Impact ref/hash 可追溯；Projection 不参与判定 | `pnpm persistence:gate` 已完成受控 Task→评估→Release→评估链；Projection/真实跨模块链路未运行 | `PASS (CONTROLLED PERSISTENCE); CROSS-MODULE NOT RUN` |
| `EP-WI12-RLS-001` | Persistence/RLS | 无 Context、缺失或不匹配 `sourceEventId`、跨 Enterprise/Project Event、伪造 scopeRef/producerModule/payloadHash/sourceWatermark | 在业务写入前拒绝或 Quarantine；不泄漏 payload，不产生第二事实，不推进其他 Project Process | `pnpm verify`：无 Context、缺失 `sourceEventId`、精确 Event Consumer 合同的 Unit 断言通过；跨 Project SELECT/ACL 由 P-005 的真实 PostgreSQL 断言覆盖 | `PASS (UNIT + PERSISTENCE/RLS)` |
| `EP-WI12-M-001` | Manual/Local | 脱敏采购控制程序查看 Task-only、Release-complete、revoke/new-version 的 Evaluation 与 Impact 历史 | 人工能区分 formal fact、派生 Evaluation、current pointer、Impact Review 和未运行的真实上游 Provider/跨模块 Process Manager | 尚未准备人工界面；真实外部链路 `NOT RUN` | `NOT RUN` |

WI-12 测试运行后的真实命令、PostgreSQL/Flyway 版本、测试计数和精确证据已写入 [`Verification-Record.md`](../archive/im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md)；没有运行的 Provider、公开 HTTP、跨模块 Event Bus/Process Manager、生产数据库和独立人工 Reference Project 继续标记 `NOT RUN`。

## IM-03 合成 Reference Project 技术验收（2026-08-27）

用户已确认采用 `SYNTHETIC / TECHNICAL ONLY` 方案。合成数据、流程和矩阵见 [`Synthetic-Reference-Project-Fixture.md`](../archive/im-03-synthetic-reference-fixture/Synthetic-Reference-Project-Fixture.md)、[`Test-Matrix.md`](../archive/im-03-synthetic-reference-fixture/Test-Matrix.md) 和 [`Verification-Record.md`](../archive/im-03-synthetic-reference-fixture/Verification-Record.md)。

本次执行：

```text
pnpm persistence:gate
```

实际结果：

- PostgreSQL `18.6`（`server_version=180006`）和 Flyway `11.20.3`：通过；
- 空库 Migration、V2013、二次 migrate no-op：通过；
- `21` 个 persistence 测试文件、`256` 个测试：全部通过；
- PostgreSQL 容器：已移除；测试后执行 `pnpm clean` 清理构建缓存；
- 该结果是现有 WI focused fixtures 的 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不是一个统一跨 Aggregate runtime chain。

因此，`EP-API-U-001/U-002/U-003`、`EP-API-C-001/C-002` 和各 `SYN-WI03-001` 至 `SYN-WI12-001` 可以记录受控本地技术证据；`EP-API-E-001/E-002` 的 integrated cross-aggregate execution 和 `EP-API-M-001` 的实际人工逐项审阅继续为 `NOT RUN`。真实 Provider、公开 HTTP、生产环境、真实跨模块 Event Bus/Process Manager 以及真实业务适用性也继续为 `NOT RUN`。

## IM-06 Source Slice 与 Receipt 设计用例

| ID | 输入 | 预期 | 结果 |
|---|---|---|---|
| EP-TD-001 | capture同键重放、不同Hash冲突、exact Slice Query | 原id/hash；冲突拒绝；动态View不能冒充Slice | `PASS (PERSISTENCE)`：#188 `context-source-slice.test.ts` 证明同键同输入返回原 `sourceSliceRef` 且 Slice 行与 `valid_until` 不变、同键异 purpose 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`、exact Query 以 id+Hash 读回原 payload；错 Hash 为 `PROJECT_QUERY_REF_INVALID`，未知/跨 Project 为 `PROJECT_QUERY_NOT_FOUND`；动态 View 未被补算 Hash 或写入 Slice 表 |
| EP-TD-002 | 错Scope/Purpose/Audience或已撤销授权读取Slice | fail closed；旧payload不改写 | `PASS (PERSISTENCE)`：错 Enterprise Scope → `PROJECT_QUERY_SCOPE_MISMATCH`；非本 Principal audience → `PROJECT_QUERY_AUDIENCE_INVALID`；未注册 purpose → `PROJECT_QUERY_PURPOSE_FORBIDDEN`；被取代后的历史读取按 `useStatus=REVOKED` 返回且 payload/Hash/`validUntil` 与取代前逐字段一致 |
| EP-TD-003 | 真实confirm_customer_material Receipt及candidate/result/Source/Decision | 窄Attestation精确匹配实际提交，TE可核验；不泄露客户正文 | NOT RUN |
| EP-TD-004 | REJECTED或其他command Receipt、同correlation错材料、旧材料不足以backfill | 不可用，不用current Root猜历史确认 | NOT RUN |

### #157 注册与 Guard 验证矩阵

状态：`APPROVED 2026-09-09`；对应[共享 API 方案](../api-contract-v0.1/API-Contract-v0.1.md#157-payloadguard-注册补充方案)，Schema/Guard fixture 通过公共 ContractRegistry 执行，结果为 `PASS (CONTRACT)`；Guard helper 测试仅补充算法诊断。对应自动测试位于 `contracts/src/operations/enterprise-project.schema.test.ts`，完整合法 fixture 与逐字段反例位于 `tests/fixtures/contracts/context-source-slice/`。

| ID | 输入 / 反例 | 预期 | 结果 |
|---|---|---|---|
| EP-REG-157-001 | 两个完整合法 Envelope，read 完整 Result；依次删除 capture 五字段、Slice 九字段、Result 三字段 | 基线通过；每个独立反例的 required 路径/属性精确匹配删除项 | PASS (CONTRACT) |
| EP-REG-157-002 | 替换逐项声明的 Ref kind/objectType，删除 exact Hash；CREATE 带 expectedAggregateVersion；Query 请求 PROJECTION_OK/SNAPSHOT_AT_LEAST | 拒绝并定位被变更字段；不靠其他非法字段造成假阳性 | PASS (CONTRACT) |
| EP-REG-157-003 | requestedKinds 为 0、64、65 项及独立重复反例；普通 source 数组重复；未知顶层字段、非法 useStatus、畸形 source/SourceWatermark | 0/64 项与合法普通数组重复通过；65 项/Set 重复及非法形状拒绝 | PASS (CONTRACT) |
| EP-REG-157-004 | Guard 文本、每数组、每对象、容器深度分别等于上限和超 1；包括 CanonicalJson 内层和对象键 | 等于上限通过，超 1 精确定位；其余结构保持合法、其他预算不超限 | PASS (CONTRACT) |
| EP-REG-157-005 | Envelope 262144/262145 字节、Result 4194304/4194305 字节；ASCII、中文、补充平面字符和转义字符 | 按紧凑 JSON UTF-8 字节计量，根路径拒绝超限；fixture 用独立字节计量构造并核验，字符串/集合/深度均在预算内 | PASS (CONTRACT) |
| EP-REG-157-006 | 循环、undefined、NaN/Infinity、bigint、函数、非普通 JSON 对象或 accessor；超深输入 | 安全失败，无栈溢出或原始内容泄露；错误 rule/path 可判定，不因序列化丢字段而通过 | PASS (CONTRACT) |
| EP-REG-157-007 | Policy 缺失/未知/重复、零/负数/非整数/无限值、未知属性；元数据缺字段/Owner 不匹配/Ref 未注册/Purpose 分叉；未安装 keyword | 构建或 Registry 初始化失败；保留重复名、数量与 Schema 完整性检查 | PASS (CONTRACT) |
| EP-REG-157-008 | 旧 201 项 Schema/fixture、历史 200 项 baseline；旧 source 数组超新 Guard 预算但符合旧 Schema | 兼容检查通过，旧接口不被新 Guard 收窄；当前操作净增 2，生成类型仍引用唯一 Source View | PASS (CONTRACT) |
| EP-REG-157-009 | 新 Query 省略 pagination、合法 pageSize/cursor，以及空对象、缺 pageSize、零/小数、非法 cursor 和未知字段 | 合法输入通过；反例逐项定位 /pagination 的 required/additionalProperties、/pagination/pageSize 的 type/minimum、/pagination/cursor 的 pattern；旧 Query 保持兼容 | PASS (CONTRACT) |

source 内允许的 CanonicalJson 可用于独立构造资源预算反例，不把空缺的 required 字段或错误 Ref 当作 Guard 失败证据。精确失败路径与字段矩阵保存在后续授权的 PR/Issue 验证证据中，不创建平行执行报告。#157 的 Handler 运行期验收已由 #188 在真实 PostgreSQL 上补齐：捕获 Envelope 的 canonical Project/Policy 引用与 Scope/Purpose/Audience 校验、Policy 解析观察绑定与时效、exact Query 读回与 fail-closed 拒绝；外部与人工验收保持 `NOT RUN`。


Query 字节边界使用既有 Envelope Reference 的合法文本字段构造，分页固定为合法 PageRequest，不使用 pagination.padding/text；仅证明 Schema 和 Guard 资源边界，不证明引用实际存在或授权有效。


## #176 Capture Policy 解析与消费验收矩阵

以下场景细化 [Spec 002 的 capture Policy 设计](../module-specs/Module-Spec-002-EnterpriseProject.md#176-capture-policy-解析与-validuntil-推导提案)，不新增 profile 字段、来源要求或 Policy 撤销入口。合法基线为 owning 入口已提交的同 Scope 来源、当前授权 audience、capture 自身 Decision 与 `identity.policy.resolve_policy` 的独立 Decision，以及 `ep.context_source_slice_capture.policy@1.0` 的已注册 canonical ref 和 closed 文档。每个负例仅改变所列维度；#179 静态校验不替代以下 Handler/持久化验收。以下结果由 #188 在真实 PostgreSQL 18.6 / Flyway 11.20.3 上取得，只覆盖本地 Handler、迁移与 Disposable PostgreSQL；TE 消费、跨模块链、外部与人工验收仍为 `NOT RUN`。

| ID | 输入 / 故障 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|
| EP-176-001 | 经 `identity.resolve_policy@1.0` 取得当前可用 capture Policy；合法 `maxSliceValiditySeconds`、`allowedPurposeCodes` 与请求 purpose；依次让 TTL 或 capture Decision 成为较早截止 | `validUntil = min(capturedAt + maxSliceValiditySeconds, authorizationDecision.expiresAt)`；Slice 与 Policy 解析观察 metadata、Receipt/Audit/Outbox 同事务提交；不接收 caller 自报 Hash/截止，不改变公开 Slice payload | `PASS (PERSISTENCE)`：同一真实 Policy 版本下，900s Decision 与 3600s Policy TTL 的窗口在 Decision 截止；120s Policy TTL 与 3600s Decision 的窗口为 `captured_at + 120s`。存储行含 `policy_version_ref`（指向 `identity_policy.policy_version` 的同一 fact、payload Hash 与解析观察相等）、`policy_set_version`、`effective_from`、空 `superseded_at`、`checked_at <= captured_at`；Slice 行、1 Receipt、1 Audit 与 2 条 Reference Edge 同一事务提交 |
| EP-176-002 | 正向为 owning Source 规则允许的来源；分别使用 `record.form.read` 请求不允许披露的 Fact metadata、超出 audience 权限的来源、不在 allowedPurposeCodes 的 purpose、未知 kind、缺少既有 mandatory source | 沿用 Source 的 omission/redaction 与拒绝规则，不扩大披露；Policy 不授权额外来源，mandatory 缺失不产生伪造成功 Slice；不增加 allowedKinds 或额外必填来源 | `PASS (PERSISTENCE)`：captured `source` 与同参数 owning `get_project_context_source` 在去 objectType 后逐项相等（同一装配实现）；`record.form.read` 请求 `ENTERPRISE_FACTS` 时 `factItems=[]` 且记录 `PURPOSE_FORBIDDEN` omission，`context.snapshot.read` 才返回脱敏 Fact 元数据；非本 Principal audience 为 `PROJECT_QUERY_AUDIENCE_INVALID`；不在 `allowedPurposeCodes` 的 purpose 为 `PROJECT_CAPTURE_PURPOSE_FORBIDDEN`；未注册 kind 为 `PROJECT_QUERY_REF_INVALID`；缺少 Project/`PROJECT_START` binding 时以 `PROJECT_QUERY_NOT_FOUND` 拒绝且不写 Slice |
| EP-176-003 | Slice 提交后分别使 capture Policy 被后继取代、当前调用者/audience 授权失效、Slice 到期；另以仅 Source 后续改变作对照 | 新消费重验 Policy、Slice 时效与当前授权；无权读取拒绝，有权历史读取按 owning 规则解释 EXPIRED/REVOKED；仅 Source 改变不改写旧 Slice 内容/Hash/validUntil，需新内容时重新 capture；不调用版本级 INVALIDATION | `PASS (PERSISTENCE)`：后继版本提交后同一 Slice 读取为 `REVOKED`；`validUntil` 之后按受信时间读取为 `EXPIRED`（payload 不变）；非本 Principal/缺 read purpose 读取被拒；新增 Enterprise Fact 后旧 Slice 逐字段不变，新键 capture 才返回含新 Fact 的新 Slice id/Hash；未调用任何版本级 INVALIDATION |
| EP-176-004 | 提交前跨过 validUntil、解析 metadata Hash 不一致、事务提交前故障；另在成功后重放同幂等键/原输入及同键异输入 | 非法或未提交事务不发布半成品 Slice；成功重放返回原结果且不延长期限，同键异输入按共享幂等冲突拒绝；历史回执不重新授予新消费资格 | `PASS (PERSISTENCE)`：受信时钟在组装后跨过 120s 窗口时返回 `PROJECT_CAPTURE_VALIDITY_INVALID` 且无 Slice 行；解析观察 contentHash 被篡改时 capture 返回 `PROJECT_CAPTURE_POLICY_UNSUPPORTED`、无 Slice 行，read 对该不一致返回 `REVOKED`；解析依赖抛错时整事务回滚（无 Receipt、无 Slice）且同键可重试成功；成功重放返回原结果且 `valid_until` 不变，同键异输入为 `IDEMPOTENCY_PAYLOAD_CONFLICT`；被取代后重放历史 Receipt 不恢复 `USABLE` |

## IM-06 (#188) ContextSourceSlice capture/read 用例

以下结果来自 `tests/persistence/context-source-slice.test.ts` 与真实 PostgreSQL 18.6 / Flyway 11.20.3 的 Disposable Gate。正向路径**经组成层入口** `@zhiju/api/composition` 的 `createContextSourceSliceEntry` 进入：完整注册 Envelope 由公共 `ContractRegistry` 校验，被呈现的 AuthorizationDecision 由 owning IdentityPolicy Port 按实际操作、payload hash、Actor、Scope、Session 与期限复验，当前 capability grant 用 `checkProjectAccess` 在请求时刻重新求值，capture Policy 经 `identity.resolve_policy@1.0`（每次解析签发独立 `identity.policy.resolve_policy` Decision）解析。Project/`PROJECT_START` 来源由 owning EnterpriseProject Handler 建立，Policy 版本事实由 `identity.record_policy_version@1.0` 登记；不替换待测授权/存在性/解析路径。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI188-P-001` | Persistence（组成层入口） | 受授权 Service 持绑定实际操作/payload/Actor/Scope/Session 的 capture Decision、canonical Project/Policy 引用、预分配 `targetRef`，Policy 经 `identity.resolve_policy@1.0` 解析 | 提交不可变 Slice 与当次解析观察；请求目标 = 存储行 = 返回 `objectId`；Receipt/Audit/Reference Edge 同事务 | 真实 PostgreSQL：注册 Envelope 通过 `validateOperation`；`COMMITTED` 且 `sourceSliceRef.objectId` = Envelope `targetRef.objectId` = 存储 `slice_id`；`validUntil` 落在 Decision 窗口内且早于 3600s Policy 上限；`policy_version_ref` 指向同一 `identity_policy.policy_version` fact；1 Receipt / 1 Audit / 2 Edge 同事务；经入口 read 返回 `USABLE` 且 payload 与存储逐字段相等 | `PASS (PERSISTENCE)` |
| `EP-WI188-P-002` | Persistence | TTL 或 Decision 成为较早截止；受信时钟跨过 `validUntil` | 窗口取二者最小值；跨过后 `EXPIRED`，payload 不变 | 120s TTL 与 900s Decision 取 `captured_at + 120s`；注入受信时钟（同一边界）跨过后读取 `EXPIRED` 且 Slice 逐字段不变 | `PASS (PERSISTENCE)` |
| `EP-WI188-A-001` | Persistence（授权） | 错操作 Decision、错 payload hash Decision、他人 ActorSnapshot、他人 Session authentication context | 共享 `AUTHORIZATION_DECISION_INVALID`；不写 Slice | 四类呈现均被入口拒绝且 Slice 计数不变 | `PASS (PERSISTENCE)` |
| `EP-WI188-A-002` | Persistence（授权） | 已签发 ALLOW Decision 之后经 owning 入口撤销覆盖 capture/read capability grant | 新 capture 与已提交 Slice 的 read 均被当前授权复验拒绝（`AUTHORIZATION_REVOKED`）；历史 Receipt 不恢复资格 | 撤销后同一 Decision 的 read 与 capture 均 `AUTHORIZATION_REVOKED`；无关 capability 的入口读取仍 `USABLE` | `PASS (PERSISTENCE)` |
| `EP-WI188-A-004` | Persistence（授权/会话） | read：仅变更受信 Session authentication context、仅变更 Envelope `authenticationContextRef`、或 Session Hash 形状非法 | 三者任一不符即 `AUTHORIZATION_DECISION_INVALID`；三者一致才 `USABLE` | 真实 PostgreSQL：一致时 `USABLE`；换 Session Hash 与换 Envelope Hash 均 `AUTHORIZATION_DECISION_INVALID`；16 字节 Session Hash 在任何 Decision 校验前被拒 | `PASS (PERSISTENCE)` |
| `EP-WI188-A-003` | Persistence（Envelope） | target 类型不符、携带 `expectedAggregateVersion`、未声明注册 Purpose 的 Context | `API_VALUE_INVALID` / `AUTHORIZATION_DECISION_INVALID`；不写 Slice | canonical CREATE target 校验与 Purpose 绑定拒绝均命中 | `PASS (PERSISTENCE)` |
| `EP-WI188-P-003` | Persistence | 同键同输入重放、同键异输入、同 identity 异键、未注册引用 | 重放原结果不延期；冲突拒绝；同一 CREATE identity 只提交一次；错引用安全拒绝 | `DUPLICATE` 且 Slice/`valid_until` 不变；`IDEMPOTENCY_PAYLOAD_CONFLICT`；同 identity 异键 `PROJECT_CAPTURE_SLICE_ALREADY_EXISTS`；错 Hash `PROJECT_QUERY_REF_INVALID`；未知 `PROJECT_QUERY_NOT_FOUND` | `PASS (PERSISTENCE)` |
| `EP-WI188-P-004` | Persistence（并发） | 两个 capture 竞争同一 CREATE identity（不同幂等键） | 恰好一个 `COMMITTED`；另一个稳定拒绝；只留一行 | 真实 PostgreSQL 并发：`COMMITTED` + `PROJECT_CAPTURE_SLICE_ALREADY_EXISTS`，`slice_id` 唯一一行 | `PASS (PERSISTENCE)` |
| `EP-WI188-C-001` | Contract/Persistence | 与 owning Source Query 同参数的 capture；`record.form.read` + `enterprise_facts`/`active_baselines` | 同一装配实现，Policy 不扩大披露；canonical 拼写与 kind 词表满足注册 Schema | captured `source` 与 owning Query 结果在去 objectType 后逐项相等；`factItems=[]` + `PURPOSE_FORBIDDEN`；注册 Result Schema 校验 `errors=[]` | `PASS (PERSISTENCE)` |
| `EP-WI188-U-001` | Unit/Persistence | 非本 Principal audience、越界 Project、未注册 purpose、legacy Project objectType、跨 Scope Policy key | `PROJECT_QUERY_AUDIENCE_INVALID` / `PROJECT_QUERY_SCOPE_MISMATCH` / `PROJECT_QUERY_PURPOSE_FORBIDDEN` / `PROJECT_QUERY_REF_INVALID`；不写 Slice | 五类拒绝均命中且 Slice 计数不变 | `PASS (PERSISTENCE)` |
| `EP-WI188-U-002` | Unit/Persistence | 未知版本键、未声明 capture profile、closed 字段缺失、尚未生效、purpose 不在 `allowedPurposeCodes` | `PROJECT_CAPTURE_POLICY_UNSUPPORTED` / `PROJECT_CAPTURE_POLICY_NOT_USABLE` / `PROJECT_CAPTURE_PURPOSE_FORBIDDEN` | 五类 Policy 拒绝均命中且 Slice 计数不变 | `PASS (PERSISTENCE)` |
| `EP-WI188-R-001` | Persistence（Result 预算） | owning 来源产生 511（redactions 1024，边界）与 512（1026，超限）个 Enterprise Fact 的候选结果 | 边界通过；超限在写入前以 `PROJECT_CAPTURE_RESULT_INVALID` 拒绝，不提交 Slice/成功 Receipt；边界 Slice 仍可精确读回 | 真实 PostgreSQL：511 Fact `COMMITTED` 且读回 `factItems=511`；再加 1 Fact 后 capture `REJECTED PROJECT_CAPTURE_RESULT_INVALID`，Slice 计数不变、无 `COMMITTED` Receipt | `PASS (PERSISTENCE)` |
| `EP-WI188-P-005` | Persistence | Policy 后继取代、源事实新增、篡改解析观察、提交前跨过窗口、解析依赖不可用 | 历史读取 `REVOKED`；旧 Slice 不改写；非法/未提交事务不发布半成品；依赖不可用不得用旧观察回退 | 取代后 `REVOKED`；新 Fact 不改变旧 Slice 且新键产生新 Slice；篡改观察 capture `PROJECT_CAPTURE_POLICY_UNSUPPORTED`、read `REVOKED`；跨窗口 `PROJECT_CAPTURE_VALIDITY_INVALID` 且无 Slice；身份依赖不可用时 `DEPENDENCY_UNAVAILABLE` 且无 Receipt/Slice、同键事后可重试成功 | `PASS (PERSISTENCE)` |
| `EP-WI188-U-003` | Persistence | 非本 Principal 读取、跨 Project 读取 | 拒绝；不泄漏其他 Project 的 Slice | 非 audience `PROJECT_QUERY_AUDIENCE_INVALID`；另一 Project 上下文读取 `PROJECT_QUERY_NOT_FOUND`（FORCE RLS 隐藏） | `PASS (PERSISTENCE)` |
| `EP-WI188-RLS-001` | Persistence/RLS | app 角色直接 UPDATE/DELETE/跨 Scope INSERT、mirror 不一致 INSERT、无 Context 读取 | `42501`/`22023`；无 Context 零行 | 真实 PostgreSQL：UPDATE/DELETE `42501`，跨 Enterprise/Project INSERT `42501`，payload↔列不一致 `22023`，无 Context 计数 `0` | `PASS (PERSISTENCE/RLS)` |
| `EP-WI188-M-001` | Manual | 脱敏 Project 上 Service capture 后按 exact Ref 读取，并观察取代/到期/撤权 | 人工可区分 USABLE/EXPIRED/REVOKED 与 exact Ref/Hash；TE 消费、真实 Provider 与人工业务验收仍 `NOT RUN` | 未执行 | `NOT RUN` |

本轮 PostgreSQL 容器已清理，未保留临时数据库、临时脚本或临时测试文件。

## 2026-08-27 PostgreSQL 镜像 pin 漂移与修复记录

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI09-V-002` | Delivery/Persistence | GitHub `pull_request` exact-head run `33021401819`、`33021517085`；PostgreSQL `18.6` tag 与仓库 pinned manifest digest | 静态、Unit、Contract 阶段通过后，Gate 应验证当前 tag 解析结果与 immutable pin 相同；若不同必须拒绝；修复后本地与新的 exact-head CI 均需完整通过 | 两次旧 head run 的静态、Unit、Architecture、Contract 均通过，Gate 拒绝旧 pin `sha256:1957b2ff3137e4ef7f3bc813e74fff50b1e1ffddc85c8b9d6f14ade972be8687`；更新为当前 `postgres:18.6` digest `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` 后，本地 `pnpm verify` 完整通过，corrected exact head 的远端 run `33022900309` 也完整通过，Flyway `11.20.3` pin 未变 | `PASS (LOCAL AND REMOTE EXACT HEAD)` |

两次旧 head 的失败属于远端 registry tag 与仓库 pin 的物理 baseline 漂移，不是 WI-09 业务实现或测试断言失败。修复后第一次完整本地编排另遇 Docker Hub manifest 查询 `EOF`，随后重试成功；corrected exact head 的远端 run `33022900309` 已完整通过。Provider、生产和人工边界仍保持 `NOT RUN`。

同一 exact head 的第二条远端 run `33022308826` 还暴露了并发接受返回码的竞争窗口：一个事务返回 `COMMITTED` 后，另一个事务曾观察到旧 Root aggregate version `1` 但已更新的 Version 状态，返回了 `PROJECT_GAP_DECISION_CONFLICT`，而预期必须是 `CONCURRENCY_CONFLICT`。接受命令已改为以 Root 行锁和最新 Root 读取作为并发判定依据；修复后本地 `pnpm persistence:gate` 连续两次通过，均为 `19 files / 238 passed`，并保持单一提交、单一 Decision/Event 与无部分写入；corrected exact head 的远端 run `33022900309` 已再次通过该用例。

2026-08-27 exact-head closeout：实现 head `6de5c96c4ba4fe0938b422606d4632048ac19932` 已通过 [GitHub Actions run 33022900309](https://github.com/qzhike/zhiju-business-core/actions/runs/33022900309)，并以 merge commit `2d6afd0cc2889cf0fa6350c0599d514d5917b071` 合入 `main`；Issue [#65](https://github.com/qzhike/zhiju-business-core/issues/65) 已 `CLOSED`，closeout comment 为 [issuecomment-5432258964](https://github.com/qzhike/zhiju-business-core/issues/65#issuecomment-5432258964)，远端和本地 WI-09 feature branch 均已删除，`origin/main` 已确认包含 implementation head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。
## IM-03 WI-10 DeliveryPlan/DeliveryItem 测试基线（2026-08-27）

以下用例在实现前登记；`NOT RUN` 表示尚未执行，不是通过。所有实际输出必须写入本表并区分静态、Unit/Contract、Disposable PostgreSQL、受控本地 E2E、Provider、公开 HTTP、生产和人工验收。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI10-U-001` | Unit/Contract | 缺少 accepted Gap、使用 latest/current、跨 Scope/hash 错误、与 Accepted Gap InputSnapshot 不一致或不完整的 active baseline、未 ACCEPTED Gap、未知 GapItem 或缺 QualityProfile 的 draft | 在任何 DeliveryPlan/Item 业务事实写入前拒绝稳定错误；拒绝 receipt 可由共享 Command Runner 记录，但不创建 DeliveryPlan/Item/Outbox 业务事实 | PostgreSQL fixture 覆盖 alternate active ProductScopeSnapshot、缺失 baseline、非 Accepted Gap、Accepted Gap InputSnapshot 五项完整集合和成功 fixture | `PASS (PERSISTENCE)` |
| `EP-WI10-U-002` | Unit | 重复 item id/key、空 item 字段、self dependency、unknown dependency 或同一 Plan Version 内的有向环 | 拒绝 `PROJECT_DELIVERY_ITEM_INVALID`、`PROJECT_DELIVERY_ITEM_KEY_CONFLICT` 或 `PROJECT_DELIVERY_DEPENDENCY_CYCLE`；不写入部分 Item | PostgreSQL fixture 的 duplicate key、cyclic dependency 和成功 DAG 断言通过 | `PASS (PERSISTENCE)` |
| `EP-WI10-P-001` | Persistence | Agent 创建 draft；Agent/Service/actingFor/伪造 actor 批准或激活；可信 Human 批准 | Agent 可起草；非 Human/actingFor 不能产生 Decision 或 pointer；Human 才能追加 Decision | WI-10 gate 中 Agent draft 成功，Agent/Service/actingFor approval 与 Agent activation 均返回 Human-only；伪造 envelope actor 由共享 context guard 覆盖 | `PASS (PERSISTENCE)` |
| `EP-WI10-P-002` | Persistence | Human 对同一 Plan 分别提交 APPROVE、CHANGES_REQUIRED、REJECT；使用 foreign/mismatched/replayed approval Decision 激活 | 只有 APPROVE 设置 approved pointer；其他决定 pointer 为 NULL；激活必须匹配精确 Plan Version、Human Decision hash 和 Impact Policy | 三态 Decision、非 APPROVE pointer、错误 approval hash 和精确 Human APPROVE activation 均通过 | `PASS (PERSISTENCE)` |
| `EP-WI10-P-003` | Persistence | 直接 UPDATE Approved/Active Plan Version、Item、criteria、Dependency、Requirement 或 Decision；创建变更后的新 Plan | 旧事实 UPDATE/DELETE 被拒绝；新 scope/criteria/依赖通过新 Plan Version/identity 保存，旧 hash/ref 不变 | Version payload、Item 和 Decision 的真实 PostgreSQL immutable trigger/ACL 断言通过；新的 Plan Version command 不在本切片范围 | `PASS (IMMUTABILITY); NEW VERSION COMMAND NOT RUN` |
| `EP-WI10-P-004` | Persistence | 两个 Human 以同一 expected aggregate version 激活；同一 command 重放；激活事务中注入故障 | 仅一个激活成功，输家为 `CONCURRENCY_CONFLICT`；重放返回 `DUPLICATE`；失败无 pointer/status/Event 半写入 | 同一 Plan activation race 为 `1 COMMITTED / 1 CONCURRENCY_CONFLICT`，winner replay 为 `DUPLICATE`；WI-10 专用 rollback injection 未接入 | `PASS (CONCURRENCY/IDEMPOTENCY); ROLLBACK NOT RUN` |
| `EP-WI10-P-005` | Persistence | 已有 Active Plan 后激活新 Plan；读取两组 Plan/Item/Dependency/Requirement/Decision | 同一 Project 只保留一个 ACTIVE；旧 Plan/Version 为 `SUPERSEDED` 且所有历史事实与 hash 保留 | 两组真实 Plan/Item/Dependency/Requirement/Decision 读取通过；partial unique index 保证单 ACTIVE，旧 Root/Version 为 `SUPERSEDED` | `PASS (PERSISTENCE)` |
| `EP-WI10-RLS-001` | Persistence/RLS | Project A context 读取/写入 Project B Plan；无 context 读取；跨 Enterprise 请求 | FORCE RLS 阻断跨 Scope/无 context；Handler 和组合 FK 同时拒绝 | WI-10 六表 FORCE RLS、Scope mirror、组合 FK 已迁移；cross-project exact Plan query 被稳定拒绝 | `PASS (RLS/MIGRATION)` |
| `EP-WI10-E-001` | E2E/Persistence | Accepted Gap→含依赖 Item 的 draft→先提交环→Human APPROVE→精确 Decision 激活→查询 Item criteria | 环先被拒绝；修正后 Plan/Item 激活；查询返回精确 refs、criteriaHash 和 `NOT_READY`，不返回伪造 completion | 受控 PostgreSQL E2E 依次通过 cycle rejection、DAG draft、Human approval、Service exact-decision activation 和 criteria query | `PASS (PERSISTENCE E2E)` |
| `EP-WI10-C-001` | Contract/Event | 激活含 2 个 Item 的 Plan，读取 Outbox 事件 payload | 1 个 `DeliveryPlanActivated` + 2 个 `DeliveryItemActivated`；只含精确 refs/hash/previous ref/quality ref，不含 criteria JSON、Gap finding 或客户正文 | 真实 Outbox 返回 1 个 Plan Event + 2 个 Item Events；payload minimality 与现有公共 Event Contract 断言通过 | `PASS (CONTRACT/PERSISTENCE)` |
| `EP-WI10-M-001` | Manual | 脱敏采购控制程序，从 accepted Gap 到 Human approve/activate 后查看精确 Item refs | 人工能确认 Agent 只能起草、Human gate、依赖环拒绝、criteria/hash 冻结和旧版本保留；Provider、公开 HTTP、生产和独立人工 Reference Project 仍为 `NOT RUN` | 本地自动化已覆盖同一控制链；独立人工验收未执行 | `PASS (LOCAL AUTOMATION); HUMAN NOT RUN` |

WI-10 的本地结果已记录空库迁移、二次 migrate no-op、静态门禁、Unit/Contract、真实 PostgreSQL、受控 E2E 和 cleanup 证据。WI-10 专用 rollback fault injection、Provider、公开 HTTP、跨模块 Process Manager、生产和人工测试仍为 `NOT RUN`，不得被 `pnpm verify` 或 disposable PostgreSQL 结果覆盖。

WI-10 exact-head closeout（2026-08-27）：实现 head `054480ebac29cd820e7893df5844ad23a6940f3b` 已通过 [PR #83](https://github.com/qzhike/zhiju-business-core/pull/83) 的 [GitHub Actions verify run 33029833203](https://github.com/qzhike/zhiju-business-core/actions/runs/33029833203)，并以 merge commit `71e527b110b7c65d6a73ba16aca4ed1b334bf89d` 合入 `main`；Issue [#66](https://github.com/qzhike/zhiju-business-core/issues/66) 已读回为 `closed`，原始远端和本地 feature branch 均已删除。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。

## IM-03 WI-11 权威 Query、Source Slice 与 Board Projection 测试基线（2026-08-27）

以下用例在实现前登记为 `NOT RUN`。真实 PostgreSQL 用例必须使用空库、固定版本 Migration 和唯一 Scope；每次 Gate 结束清理容器、临时数据库、临时脚本和测试文件。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI11-U-001` | Unit/Contract | 合法 ProjectRef、Principal Audience、`context.snapshot.read` 与 requestedKinds；权威 Fact 含敏感 value/sourceRefs；绑定 Ref 含额外 JSON 字段；未请求或 purpose 禁止 Fact；未知 purpose/kind、跨 Scope Audience、过期 Context | 合法请求只返回 allow-list Ref、安全 Fact 元数据和 REDACTED 标记；允许 Fact 时记录对应 redaction，未请求/禁止时只记录 omission；非法输入在读取前以稳定错误拒绝且不泄露原文 | WI-11 real PostgreSQL Source Slice fixture 验证 binding 额外字段剥离、Fact value/sourceRefs 脱敏、`record.form.read` omission，以及未知 kind/purpose、跨 Scope Audience、过期 Context 拒绝 | `PASS (PERSISTENCE QUERY; UNIT-ONLY PATH NOT SEPARATELY SEEDED)` |
| `EP-WI11-P-001` | Persistence | Project Root 含 Customer/Template/Regulatory active pointer、Gap accepted pointer、DeliveryPlan active pointer；另有更高但未激活版本；active pointer 指向错误生命周期版本 | 只返回 Root 精确 pointer 对应的 VersionedRef；不查询 latest/current，不把未激活版本混入结果；Handler 对数据库读回状态执行防御性校验，非 `CONFIRMED/FROZEN/ACCEPTED/ACTIVE` pointer 稳定拒绝 | WI-10 real PostgreSQL fixture 在 Plan 激活后读取五类精确 active/accepted refs；Customer/Template/Regulatory/Gap/DeliveryPlan pointer 与 version 断言通过，未激活版本未混入 | `PASS (PERSISTENCE; INVALID-STATUS NEGATIVE PATH NOT SEPARATELY SEEDED)` |
| `EP-WI11-P-002` | Persistence | 精确 DeliveryPlan Version/Item criteria；Projection alias 暂停并推进 target watermark | criteria definition/hash 和 `NOT_READY` execution projection 保持不变；Projection 状态不能成为 authoritative 判据 | DeliveryPlan real PostgreSQL criteria fixture 返回持久化 definition/hash 与 `NOT_READY`；独立 WI-11 pause fixture 暴露 projection lag/status，未把 projection 状态代替 criteria 判据 | `PASS (PERSISTENCE; CRITERIA/PROJECTION SEPARATE FIXTURES)` |
| `EP-WI11-P-003` | Persistence | 两页 Board rows（包含非自然数字序 itemKey）、固定过滤器、有效 cursor；篡改 cursor、跨 Project cursor、过期 cursor；无下一页时的 optional cursor | 写入、读取和 cursor 使用同一固定 UTF-8 字节序，按 `itemKey ASC, deliveryItemId ASC` 稳定分页；Scope/Filter/Version/expiry 不匹配统一返回 cursor 错误；没有下一页时省略 cursor 字段 | WI-11 real PostgreSQL fixture 以 `item-10`/`item-2` 验证固定排序、两页 cursor、篡改/过滤/跨 Project/过期 cursor 拒绝及末页省略 `nextCursor` | `PASS (PERSISTENCE)` |
| `EP-WI11-P-004` | Persistence | authoritative Snapshot Export + 有序 Event Delta（upsert/remove）；可选 event id 缺失时省略字段 | 新 Projection Version READY；checkpoint、row count、domain checksum 与预期一致；alias 原子切换且旧版本保留；不写入显式 `null/undefined` | WI-11 real PostgreSQL rebuild fixture 验证 Snapshot + UPSERT/REMOVE、READY、checkpoint/source watermark、row count/domain checksum、alias 原子切换和旧版本保留 | `PASS (PERSISTENCE)` |
| `EP-WI11-P-005` | Persistence | Projection 暂停；记录新的 source event；读取 Board；恢复或 rebuild；在已有 target 较高时消费较低事件 | target-last 形成明确 lag，status 为 `STALE/PAUSED`；暂停期间 alias 不变；恢复后 last watermark 单调推进且不覆盖更高 target | WI-11 real PostgreSQL fixtures 验证较高 target 保留、较低事件消费后的 lag、pause 期间 alias 不变、rebuild 恢复及最终 `READY`/lag=0 | `PASS (PERSISTENCE)` |
| `EP-WI11-P-006` | Persistence | 重复 event、sequence 为 0 或乱序、非 `enterprise_project` source module、跨 Project event、错误 partition、错误 item ref、缺失 ProjectSnapshotBinding；低序 watermark 直接写入 | 同一已提交 event 重放返回 `DUPLICATE`；低于 checkpoint 的消费返回 `PROJECT_PROJECTION_CHECKPOINT_CONFLICT`；其他输入返回 `PROJECT_PROJECTION_EVENT_INVALID` 或稳定 Query not-found/ref error；不得静默跳过、空值解引用或回退 source/checkpoint watermark | WI-11 real PostgreSQL 用例覆盖同一 event `DUPLICATE`、低于 checkpoint 的 consume conflict、sequence 0、错误 source module、跨 Project rebuild/Query、缺失 binding、partition/Scope guard | `PASS (PERSISTENCE)` |
| `EP-WI11-RLS-001` | Persistence/RLS | Project A、Project B、无 Context 使用 projection_app 读取/写入；直接 UPDATE/DELETE Board/failure row；写入错误 partition | FORCE RLS 阻断越权；Board row 与 failure fact 不可变；partition 与 Project 一致；只有受控 alias/checkpoint/source state 可更新 | WI-11 real PostgreSQL fixture 验证 cross-project 隔离、FORCE RLS、Board/failure UPDATE/DELETE 拒绝、partition/checkpoint/source watermark guard | `PASS (PERSISTENCE/RLS)` |
| `EP-WI11-M-001` | Manual/Local | 对同一 Project 读取 authoritative Source/criteria 与人为暂停 Projection 的 Board | 页面或 CLI 同时显示 source watermark、projection watermark、lag/status；用户不会把 Board 延迟误判为业务完成/未完成 | 自动化输出验证 source/projection watermark、lag/status 与 criteria 独立；独立人工页面操作尚未执行 | `PASS (LOCAL AUTOMATION); HUMAN NOT RUN` |

Provider、公开 HTTP、跨模块 Process Manager、生产数据库和独立人工 Reference Project 验收不由本地 Gate 代替，保持 `NOT RUN`。

WI-11 exact-head closeout（2026-08-27）：实现 head `c8f1a2cc6291ff65824a04e437a99b660fd926aa` 已通过 [PR #85](https://github.com/qzhike/zhiju-business-core/pull/85) 的 [GitHub Actions run 33039239177](https://github.com/qzhike/zhiju-business-core/actions/runs/33039239177)，并以 merge commit `43a2f4fcf074e565c10f3db54bd1be9134ef471d` 合入 `main`；PR verification comment 已读回：[issuecomment-5434378070](https://github.com/qzhike/zhiju-business-core/pull/85#issuecomment-5434378070)。Issue [#67](https://github.com/qzhike/zhiju-business-core/issues/67) 已读回为 `closed`，Issue closeout comment 已读回：[issuecomment-5434387709](https://github.com/qzhike/zhiju-business-core/issues/67#issuecomment-5434387709)；远端和本地 WI-11 feature branch 均已删除，`origin/main` 已确认包含 implementation head。Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`。
## IM-03 WI-12 DeliveryItem Completion 与 Impact Process 用例基线（2026-08-27）

以下用例在实现前登记为 `NOT RUN`。真实 PostgreSQL 用例必须使用空库、V2013 固定迁移、唯一 Enterprise/Project/Plan/Item Scope；每次 Gate 结束清理容器、临时数据库、临时脚本和测试文件。

WI-12 的三张 EnterpriseProject owning 表（`delivery_item_completion_fact`、`delivery_item_completion_evaluation`、`delivery_item_impact_review`）已纳入既有技术表目录回归；主消费/评估链与 Unit/Contract、revoke/new-version、ACL/RLS、故障回滚、晚到事实和状态转移断言已由最终 `pnpm verify` 通过。Persistence Gate 使用 PostgreSQL 18.6（`server_version=180006`）和 Flyway 11.20.3，21 个 persistence 测试文件、256 个测试全部通过，空库迁移和二次 no-op 通过并清理容器。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI12-U-001` | Unit/Contract | `allOf` criteria、错误 criteriaHash、未知 eventType、重复/跨 Scope factRef、caller 提交 outcome 或 `submittedCompletion`、缺失 `sourceEventId` | 只接受已注册 criteria 与 exact refs；hash/grammar/scope/lifecycle 错误在写入前稳定拒绝；不接受 caller completion；Event Consumer 必须绑定精确 source event | `pnpm verify` 的 Unit/Contract 路径通过；独立 Unit 文件 4/4，完整 Vitest 24 文件通过；TypeScript project service、Buffer/ContentHash 夹具和 sourceEventId 断言均通过 | `PASS (UNIT/CONTRACT)` |
| `EP-WI12-P-001` | Persistence | 注入合法 `execution.TaskCompleted@1.0`，criteria 同时要求 TaskCompleted 与 ReleaseCompleted | Inbox/Fact/Process Step 成功；Evaluation 为 `UNSATISFIED`；不产生 `DeliveryItemCompletionSatisfied`；Item 不被直接写成 `COMPLETED` | `pnpm persistence:gate`：Task fact、Inbox/Process Step、Task-only Evaluation=`UNSATISFIED`、无 Completion Event、Item=`NOT_READY` 通过 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-002` | Persistence | 在 P-001 后注入同一 Project 的精确 `release.ReleaseCompleted@1.0`，再评估 | 两个 ACTIVE formal facts 可被精确选择；Evaluation 为 `SATISFIED`；只产生一个最小 Completion Event，Root current pointer 从独立版本 `1` CAS 到该 Evaluation | `pnpm persistence:gate`：Release fact 后 Evaluation=`SATISFIED`，Completion/Impact Event、current pointer 和独立版本 `1→3` 通过 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-003` | Persistence | 同一 event/command 相同 payload hash/watermark replay；同 event id 改 payload hash 或 watermark | 相同输入返回 `DUPLICATE` 且无第二 Fact/Event；不同 hash/watermark 写 contract violation、Inbox `QUARANTINED`，首条事实不变 | `pnpm persistence:gate`：event replay=`DUPLICATE`，同 event id 改 payload 返回 `QUARANTINED`，Fact count=`1`、`INBOX_HASH_CONFLICT` violation count=`1`；command replay=`DUPLICATE` | `PASS (PERSISTENCE)` |
| `EP-WI12-P-004` | Persistence | late fact、同一上游对象新 Version/Hash、`quality.RevisionApprovalLost` 或 `release.ReleaseRecalled` | 只追加新 Fact/Evaluation/Impact Review；revoked fact 不再满足 ACTIVE criterion；旧 Evaluation、Plan Version、Approval、Fact 和 hash 保留；发布 Impact Event 时 payload 仅含精确 refs/reason；已满足状态下的 late fact 不重复发 Completion Event | `pnpm persistence:gate`：revoke 后为 `UNSATISFIED`，同一上游新 PackageSnapshot 后为 `SATISFIED`，晚到 Task 后新增第 4 个 Evaluation 和第 3 个 Impact；5 个 Fact、2 个 Completion Event，旧 Plan Version/Approval/hash 不变 | `PASS (PERSISTENCE)` |
| `EP-WI12-P-005` | Persistence/RLS | 直接 UPDATE `delivery_item.execution_status='COMPLETED'`、UPDATE/DELETE Fact/Evaluation/Impact；Project A Context 读写 Project B | ACL/trigger/RLS 拒绝；无 Completion/Impact 半写入；旧 immutable history 保持可读 | `pnpm persistence:gate`：直接完成写入及历史表 UPDATE/DELETE 均返回 `42501`；跨 Project SELECT 返回 `0`；Item 仍为 `NOT_READY`、Completion version=`2` 且 pointer 不变 | `PASS (PERSISTENCE/RLS)` |
| `EP-WI12-P-006` | Persistence | 两个评估命令竞争同一 Item current pointer；一个在 Outbox/Impact 写入后故障 | 只有一个 CAS 成功，输家 `CONCURRENCY_CONFLICT`；故障事务回滚 Inbox/Fact/Evaluation/Impact/Root/Event；历史不重写 | `pnpm persistence:gate`：CAS 为 `1 COMMITTED / 1 REJECTED CONCURRENCY_CONFLICT`；Impact outbox `P0001` 注入后 facts=`3`、evaluations=`2`、impacts=`1`、Completion events=`1`、Root version=`3`，失败评估无半写入且故障事件 Inbox=`PROCESSED` | `PASS (PERSISTENCE)` |
| `EP-WI12-E-001` | E2E/Persistence | 受控 Fixture 依次注入 TaskCompleted、评估；再注入 ReleaseCompleted、评估；读取 criteria/Root/Outbox/Inbox | 用户可看到缺 Release 时未完成，补齐精确 Release 后才完成；所有 Event/Fact/Evaluation/Impact ref/hash 可追溯；Projection 不参与判定 | `pnpm persistence:gate` 已完成受控 Task→评估→Release→评估链；Projection/真实跨模块链路未运行 | `PASS (CONTROLLED PERSISTENCE); CROSS-MODULE NOT RUN` |
| `EP-WI12-RLS-001` | Persistence/RLS | 无 Context、缺失或不匹配 `sourceEventId`、跨 Enterprise/Project Event、伪造 scopeRef/producerModule/payloadHash/sourceWatermark | 在业务写入前拒绝或 Quarantine；不泄漏 payload，不产生第二事实，不推进其他 Project Process | `pnpm verify`：无 Context、缺失 `sourceEventId`、精确 Event Consumer 合同的 Unit 断言通过；跨 Project SELECT/ACL 由 P-005 的真实 PostgreSQL 断言覆盖 | `PASS (UNIT + PERSISTENCE/RLS)` |
| `EP-WI12-M-001` | Manual/Local | 脱敏采购控制程序查看 Task-only、Release-complete、revoke/new-version 的 Evaluation 与 Impact 历史 | 人工能区分 formal fact、派生 Evaluation、current pointer、Impact Review 和未运行的真实上游 Provider/跨模块 Process Manager | 尚未准备人工界面；真实外部链路 `NOT RUN` | `NOT RUN` |

WI-12 测试运行后的真实命令、PostgreSQL/Flyway 版本、测试计数和精确证据已写入 [`Verification-Record.md`](../archive/im-03-wi-12-deliveryitem-completion-impact-process/Verification-Record.md)；没有运行的 Provider、公开 HTTP、跨模块 Event Bus/Process Manager、生产数据库和独立人工 Reference Project 继续标记 `NOT RUN`。

## IM-03 合成 Reference Project 技术验收（2026-08-27）

用户已确认采用 `SYNTHETIC / TECHNICAL ONLY` 方案。合成数据、流程和矩阵见 [`Synthetic-Reference-Project-Fixture.md`](../archive/im-03-synthetic-reference-fixture/Synthetic-Reference-Project-Fixture.md)、[`Test-Matrix.md`](../archive/im-03-synthetic-reference-fixture/Test-Matrix.md) 和 [`Verification-Record.md`](../archive/im-03-synthetic-reference-fixture/Verification-Record.md)。

本次执行：

```text
pnpm persistence:gate
```

实际结果：

- PostgreSQL `18.6`（`server_version=180006`）和 Flyway `11.20.3`：通过；
- 空库 Migration、V2013、二次 migrate no-op：通过；
- `21` 个 persistence 测试文件、`256` 个测试：全部通过；
- PostgreSQL 容器：已移除；测试后执行 `pnpm clean` 清理构建缓存；
- 该结果是现有 WI focused fixtures 的 `PASS (COMPOSED CONTROLLED PERSISTENCE)`，不是一个统一跨 Aggregate runtime chain。

因此，`EP-API-U-001/U-002/U-003`、`EP-API-C-001/C-002` 和各 `SYN-WI03-001` 至 `SYN-WI12-001` 可以记录受控本地技术证据；`EP-API-E-001/E-002` 的 integrated cross-aggregate execution 和 `EP-API-M-001` 的实际人工逐项审阅继续为 `NOT RUN`。真实 Provider、公开 HTTP、生产环境、真实跨模块 Event Bus/Process Manager 以及真实业务适用性也继续为 `NOT RUN`。

## IM-06 Source Slice 与 Receipt 设计用例

| ID | 输入 | 预期 | 结果 |
|---|---|---|---|
| EP-TD-001 | capture同键重放、不同Hash冲突、exact Slice Query | 原id/hash；冲突拒绝；动态View不能冒充Slice | `PASS (PERSISTENCE)`：#188 `context-source-slice.test.ts` 证明同键同输入返回原 `sourceSliceRef` 且 Slice 行与 `valid_until` 不变、同键异 purpose 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`、exact Query 以 id+Hash 读回原 payload；错 Hash 为 `PROJECT_QUERY_REF_INVALID`，未知/跨 Project 为 `PROJECT_QUERY_NOT_FOUND`；动态 View 未被补算 Hash 或写入 Slice 表 |
| EP-TD-002 | 错Scope/Purpose/Audience或已撤销授权读取Slice | fail closed；旧payload不改写 | `PASS (PERSISTENCE)`：错 Enterprise Scope → `PROJECT_QUERY_SCOPE_MISMATCH`；非本 Principal audience → `PROJECT_QUERY_AUDIENCE_INVALID`；未注册 purpose → `PROJECT_QUERY_PURPOSE_FORBIDDEN`；被取代后的历史读取按 `useStatus=REVOKED` 返回且 payload/Hash/`validUntil` 与取代前逐字段一致 |
| EP-TD-003 | 真实confirm_customer_material Receipt及candidate/result/Source/Decision | 窄Attestation精确匹配实际提交，TE可核验；不泄露客户正文 | NOT RUN |
| EP-TD-004 | REJECTED或其他command Receipt、同correlation错材料、旧材料不足以backfill | 不可用，不用current Root猜历史确认 | NOT RUN |

### #157 注册与 Guard 验证矩阵

状态：`APPROVED 2026-09-09`；对应[共享 API 方案](../api-contract-v0.1/API-Contract-v0.1.md#157-payloadguard-注册补充方案)，Schema/Guard fixture 通过公共 ContractRegistry 执行，结果为 `PASS (CONTRACT)`；Guard helper 测试仅补充算法诊断。对应自动测试位于 `contracts/src/operations/enterprise-project.schema.test.ts`，完整合法 fixture 与逐字段反例位于 `tests/fixtures/contracts/context-source-slice/`。

| ID | 输入 / 反例 | 预期 | 结果 |
|---|---|---|---|
| EP-REG-157-001 | 两个完整合法 Envelope，read 完整 Result；依次删除 capture 五字段、Slice 九字段、Result 三字段 | 基线通过；每个独立反例的 required 路径/属性精确匹配删除项 | PASS (CONTRACT) |
| EP-REG-157-002 | 替换逐项声明的 Ref kind/objectType，删除 exact Hash；CREATE 带 expectedAggregateVersion；Query 请求 PROJECTION_OK/SNAPSHOT_AT_LEAST | 拒绝并定位被变更字段；不靠其他非法字段造成假阳性 | PASS (CONTRACT) |
| EP-REG-157-003 | requestedKinds 为 0、64、65 项及独立重复反例；普通 source 数组重复；未知顶层字段、非法 useStatus、畸形 source/SourceWatermark | 0/64 项与合法普通数组重复通过；65 项/Set 重复及非法形状拒绝 | PASS (CONTRACT) |
| EP-REG-157-004 | Guard 文本、每数组、每对象、容器深度分别等于上限和超 1；包括 CanonicalJson 内层和对象键 | 等于上限通过，超 1 精确定位；其余结构保持合法、其他预算不超限 | PASS (CONTRACT) |
| EP-REG-157-005 | Envelope 262144/262145 字节、Result 4194304/4194305 字节；ASCII、中文、补充平面字符和转义字符 | 按紧凑 JSON UTF-8 字节计量，根路径拒绝超限；fixture 用独立字节计量构造并核验，字符串/集合/深度均在预算内 | PASS (CONTRACT) |
| EP-REG-157-006 | 循环、undefined、NaN/Infinity、bigint、函数、非普通 JSON 对象或 accessor；超深输入 | 安全失败，无栈溢出或原始内容泄露；错误 rule/path 可判定，不因序列化丢字段而通过 | PASS (CONTRACT) |
| EP-REG-157-007 | Policy 缺失/未知/重复、零/负数/非整数/无限值、未知属性；元数据缺字段/Owner 不匹配/Ref 未注册/Purpose 分叉；未安装 keyword | 构建或 Registry 初始化失败；保留重复名、数量与 Schema 完整性检查 | PASS (CONTRACT) |
| EP-REG-157-008 | 旧 201 项 Schema/fixture、历史 200 项 baseline；旧 source 数组超新 Guard 预算但符合旧 Schema | 兼容检查通过，旧接口不被新 Guard 收窄；当前操作净增 2，生成类型仍引用唯一 Source View | PASS (CONTRACT) |
| EP-REG-157-009 | 新 Query 省略 pagination、合法 pageSize/cursor，以及空对象、缺 pageSize、零/小数、非法 cursor 和未知字段 | 合法输入通过；反例逐项定位 /pagination 的 required/additionalProperties、/pagination/pageSize 的 type/minimum、/pagination/cursor 的 pattern；旧 Query 保持兼容 | PASS (CONTRACT) |

source 内允许的 CanonicalJson 可用于独立构造资源预算反例，不把空缺的 required 字段或错误 Ref 当作 Guard 失败证据。精确失败路径与字段矩阵保存在后续授权的 PR/Issue 验证证据中，不创建平行执行报告。#157 的 Handler 运行期验收已由 #188 在真实 PostgreSQL 上补齐：捕获 Envelope 的 canonical Project/Policy 引用与 Scope/Purpose/Audience 校验、Policy 解析观察绑定与时效、exact Query 读回与 fail-closed 拒绝；外部与人工验收保持 `NOT RUN`。


Query 字节边界使用既有 Envelope Reference 的合法文本字段构造，分页固定为合法 PageRequest，不使用 pagination.padding/text；仅证明 Schema 和 Guard 资源边界，不证明引用实际存在或授权有效。


## #176 Capture Policy 解析与消费验收矩阵

以下场景细化 [Spec 002 的 capture Policy 设计](../module-specs/Module-Spec-002-EnterpriseProject.md#176-capture-policy-解析与-validuntil-推导提案)，不新增 profile 字段、来源要求或 Policy 撤销入口。合法基线为 owning 入口已提交的同 Scope 来源、当前授权 audience、capture 自身 Decision 与 `identity.policy.resolve_policy` 的独立 Decision，以及 `ep.context_source_slice_capture.policy@1.0` 的已注册 canonical ref 和 closed 文档。每个负例仅改变所列维度；#179 静态校验不替代以下 Handler/持久化验收。以下结果由 #188 在真实 PostgreSQL 18.6 / Flyway 11.20.3 上取得，只覆盖本地 Handler、迁移与 Disposable PostgreSQL；TE 消费、跨模块链、外部与人工验收仍为 `NOT RUN`。

| ID | 输入 / 故障 | 预期输出与禁止效果 | 当前结果 |
|---|---|---|---|
| EP-176-001 | 经 `identity.resolve_policy@1.0` 取得当前可用 capture Policy；合法 `maxSliceValiditySeconds`、`allowedPurposeCodes` 与请求 purpose；依次让 TTL 或 capture Decision 成为较早截止 | `validUntil = min(capturedAt + maxSliceValiditySeconds, authorizationDecision.expiresAt)`；Slice 与 Policy 解析观察 metadata、Receipt/Audit/Outbox 同事务提交；不接收 caller 自报 Hash/截止，不改变公开 Slice payload | `PASS (PERSISTENCE)`：同一真实 Policy 版本下，900s Decision 与 3600s Policy TTL 的窗口在 Decision 截止；120s Policy TTL 与 3600s Decision 的窗口为 `captured_at + 120s`。存储行含 `policy_version_ref`（指向 `identity_policy.policy_version` 的同一 fact、payload Hash 与解析观察相等）、`policy_set_version`、`effective_from`、空 `superseded_at`、`checked_at <= captured_at`；Slice 行、1 Receipt、1 Audit 与 2 条 Reference Edge 同一事务提交 |
| EP-176-002 | 正向为 owning Source 规则允许的来源；分别使用 `record.form.read` 请求不允许披露的 Fact metadata、超出 audience 权限的来源、不在 allowedPurposeCodes 的 purpose、未知 kind、缺少既有 mandatory source | 沿用 Source 的 omission/redaction 与拒绝规则，不扩大披露；Policy 不授权额外来源，mandatory 缺失不产生伪造成功 Slice；不增加 allowedKinds 或额外必填来源 | `PASS (PERSISTENCE)`：captured `source` 与同参数 owning `get_project_context_source` 在去 objectType 后逐项相等（同一装配实现）；`record.form.read` 请求 `ENTERPRISE_FACTS` 时 `factItems=[]` 且记录 `PURPOSE_FORBIDDEN` omission，`context.snapshot.read` 才返回脱敏 Fact 元数据；非本 Principal audience 为 `PROJECT_QUERY_AUDIENCE_INVALID`；不在 `allowedPurposeCodes` 的 purpose 为 `PROJECT_CAPTURE_PURPOSE_FORBIDDEN`；未注册 kind 为 `PROJECT_QUERY_REF_INVALID`；缺少 Project/`PROJECT_START` binding 时以 `PROJECT_QUERY_NOT_FOUND` 拒绝且不写 Slice |
| EP-176-003 | Slice 提交后分别使 capture Policy 被后继取代、当前调用者/audience 授权失效、Slice 到期；另以仅 Source 后续改变作对照 | 新消费重验 Policy、Slice 时效与当前授权；无权读取拒绝，有权历史读取按 owning 规则解释 EXPIRED/REVOKED；仅 Source 改变不改写旧 Slice 内容/Hash/validUntil，需新内容时重新 capture；不调用版本级 INVALIDATION | `PASS (PERSISTENCE)`：后继版本提交后同一 Slice 读取为 `REVOKED`；`validUntil` 之后按受信时间读取为 `EXPIRED`（payload 不变）；非本 Principal/缺 read purpose 读取被拒；新增 Enterprise Fact 后旧 Slice 逐字段不变，新键 capture 才返回含新 Fact 的新 Slice id/Hash；未调用任何版本级 INVALIDATION |
| EP-176-004 | 提交前跨过 validUntil、解析 metadata Hash 不一致、事务提交前故障；另在成功后重放同幂等键/原输入及同键异输入 | 非法或未提交事务不发布半成品 Slice；成功重放返回原结果且不延长期限，同键异输入按共享幂等冲突拒绝；历史回执不重新授予新消费资格 | `PASS (PERSISTENCE)`：受信时钟在组装后跨过 120s 窗口时返回 `PROJECT_CAPTURE_VALIDITY_INVALID` 且无 Slice 行；解析观察 contentHash 被篡改时 capture 返回 `PROJECT_CAPTURE_POLICY_UNSUPPORTED`、无 Slice 行，read 对该不一致返回 `REVOKED`；解析依赖抛错时整事务回滚（无 Receipt、无 Slice）且同键可重试成功；成功重放返回原结果且 `valid_until` 不变，同键异输入为 `IDEMPOTENCY_PAYLOAD_CONFLICT`；被取代后重放历史 Receipt 不恢复 `USABLE` |

## IM-06 (#188) ContextSourceSlice capture/read 用例

以下结果来自 `tests/persistence/context-source-slice.test.ts` 与真实 PostgreSQL 18.6 / Flyway 11.20.3 的 Disposable Gate。正向路径**经组成层入口** `@zhiju/api/composition` 的 `createContextSourceSliceEntry` 进入：完整注册 Envelope 由公共 `ContractRegistry` 校验，被呈现的 AuthorizationDecision 由 owning IdentityPolicy Port 按实际操作、payload hash、Actor、Scope、Session 与期限复验，当前 capability grant 用 `checkProjectAccess` 在请求时刻重新求值，capture Policy 经 `identity.resolve_policy@1.0`（每次解析签发独立 `identity.policy.resolve_policy` Decision）解析。Project/`PROJECT_START` 来源由 owning EnterpriseProject Handler 建立，Policy 版本事实由 `identity.record_policy_version@1.0` 登记；不替换待测授权/存在性/解析路径。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| `EP-WI188-P-001` | Persistence | 受授权 Service 持 capture Purpose 的 Decision、同 Scope Project、canonical Project/Policy 引用、登记并通过 `identity.resolve_policy@1.0` 解析的 capture Policy | 提交不可变 Slice 与当次解析观察；返回可精确解引用的 CONTENT_ADDRESSED Ref；Receipt/Audit/Reference Edge 同事务 | 真实 PostgreSQL：`COMMITTED` 且 `sourceSliceRef` 指向存储 payload 的 SHA-256；Slice 行、1 Receipt、1 Audit、2 Edge 同事务；`policy_version_ref` 指向同一 `identity_policy.policy_version` fact 且 Hash 与解析观察相等 | `PASS (PERSISTENCE)` |
| `EP-WI188-P-002` | Persistence | TTL 或 Decision 成为较早截止；读取跨过 `validUntil` | 窗口取二者最小值；跨过后 `EXPIRED`，payload 不变 | 900s Decision 与 3600s TTL 取 Decision；120s TTL 取 `captured_at + 120s`；跨过后读取 `EXPIRED` 且 Slice 逐字段不变 | `PASS (PERSISTENCE)` |
| `EP-WI188-U-001` | Unit/Persistence | 未声明注册 Purpose 的 Service Context、错误 audience、越界 Project、未注册 purpose | `AUTHORIZATION_DECISION_INVALID`/`PROJECT_QUERY_AUDIENCE_INVALID`/`PROJECT_QUERY_SCOPE_MISMATCH`/`PROJECT_QUERY_PURPOSE_FORBIDDEN`；不因 `principalKind=SERVICE` 放行 | 四类拒绝均命中，且 Slice 计数不增加 | `PASS (PERSISTENCE)` |
| `EP-WI188-U-002` | Unit/Persistence | 未知版本键、未声明 capture profile、closed 字段缺失、尚未生效、purpose 不在 `allowedPurposeCodes`、legacy Project objectType | 稳定 `PROJECT_CAPTURE_POLICY_UNSUPPORTED`/`PROJECT_CAPTURE_POLICY_NOT_USABLE`/`PROJECT_CAPTURE_PURPOSE_FORBIDDEN`/`PROJECT_QUERY_REF_INVALID`；不写 Slice | 五类 Policy 拒绝与 canonical objectType 拒绝均命中，Slice 计数不变 | `PASS (PERSISTENCE)` |
| `EP-WI188-C-001` | Contract/Persistence | 与 owning Source Query 同参数的 capture；`record.form.read` + `ENTERPRISE_FACTS`/`ACTIVE_BASELINES` | 同一装配实现，Policy 不扩大披露；canonical `zhiju.project.*` 拼写满足注册 Result Schema | captured `source` 与 owning Query 结果在去 objectType 后逐项相等；`factItems=[]` + `PURPOSE_FORBIDDEN`；去 objectType 前后均通过注册 Result Schema 校验 | `PASS (PERSISTENCE)` |
| `EP-WI188-P-003` | Persistence | 同键同输入重放、同键异输入、exact read、错 Hash、未知引用、跨 Scope | 重放原结果不延期；冲突拒绝；错引用安全拒绝 | `DUPLICATE` 且 Slice/`valid_until` 不变；`IDEMPOTENCY_PAYLOAD_CONFLICT`；错 Hash `PROJECT_QUERY_REF_INVALID`；未知/跨 Project `PROJECT_QUERY_NOT_FOUND`；错 Enterprise `PROJECT_QUERY_SCOPE_MISMATCH` | `PASS (PERSISTENCE)` |
| `EP-WI188-P-004` | Persistence | Policy 后继取代、源事实新增、读取篡改观察、解析依赖抛错 | 历史读取 `REVOKED`；旧 Slice 不改写；依赖不可用 fail closed 且无半成品 | 取代后 `REVOKED`；新 Fact 不改变旧 Slice，新键返回新 Slice；篡改观察 capture 拒绝/read `REVOKED`；依赖抛错整事务回滚且同键可重试 | `PASS (PERSISTENCE)` |
| `EP-WI188-RLS-001` | Persistence/RLS | app 角色直接 UPDATE/DELETE/跨 Scope INSERT、mirror 不一致 INSERT、无 Context 读取 | `42501`/`22023`；无 Context 零行 | 真实 PostgreSQL：UPDATE/DELETE `42501`，跨 Enterprise/Project INSERT `42501`，payload↔列不一致 `22023`，无 Context 计数 `0` | `PASS (PERSISTENCE/RLS)` |
| `EP-WI188-M-001` | Manual | 脱敏 Project 上 Service capture 后按 exact Ref 读取，并观察取代/到期 | 人工可区分 USABLE/EXPIRED/REVOKED 与 exact Ref/Hash；TE 消费、真实 Provider 与人工业务验收仍 `NOT RUN` | 未执行 | `NOT RUN` |

本轮 PostgreSQL 容器已清理，未保留临时数据库、临时脚本或临时测试文件。TE Context 消费、`get_resolution_receipt@1.0`、跨模块完整业务链、真实 Provider、公开 HTTP、生产与独立人工 Reference Project 验收保持 `NOT RUN`，不能由本表推断为 `PASS`。
