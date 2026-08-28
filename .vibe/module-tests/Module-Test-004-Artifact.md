# Module-Test-004-Artifact

版本：v0.1
日期：2026-08-27
状态：`API CONTRACT TEST BASELINE / WI-01 CONTRACT REGRESSION PASS / PR #12 REMEDIATION VERIFIED / IM-DG-005 APPROVED / WI-02 APPLICATION-PERSISTENCE TESTS VERIFIED 2026-08-28 / WI-02 GIT DELIVERY VERIFIED PR #102 MERGED 2026-08-28 / ISSUE #91 CLOSED 2026-08-28 / ISSUES #89–#98 PLANNED / ARTIFACT BUSINESS IMPLEMENTATION NOT STARTED`

对应规格：[`Module-Spec-004-Artifact.md`](../module-specs/Module-Spec-004-Artifact.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-API-D-001 | Design | Artifact Module Spec 与 Catalog | 12 Command、7 Query、7 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=7 events=7`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| AF-API-D-002 | Design/Contract | IM-DG-005 Structured Document 最小 Schema | Document 使用闭合 unitType、稳定 unitId、无环父子关系、同级 ordinal 与未知 Required Extension 拒绝 | `canonical-content.test.ts` 正向与 duplicate/hierarchy/cycle/ordinal 负向断言通过 | `PASS` |
| AF-API-D-003 | Design/Contract | IM-DG-005 WorkbookSpec 最小 Schema | Workbook 使用稳定 Sheet/Column/Row/Cell 身份、同 Sheet 引用一致性，并保留 valueType、formula、validation 语义 | `canonical-content.test.ts` 正向与引用/重复 ID/公式/类型负向断言通过 | `PASS` |
| AF-API-D-004 | Design/Contract | IM-DG-005 Renderer 路线与现有 IntegrationGateway Contract | 精确 Revision/input Hash 经 RenderAttempt/Adapter/Receipt 后才能登记 Representation；现有 Query 不足时先 additive 增加只读 Binding Query，不新增重复 Render 执行 API | Binding Query 已注册为唯一新增 Query；既有通用 Attempt Query 回归保持通过 | `PASS` |
| AF-API-D-005 | Design/Contract | IM-DG-005 Hash 域与 Content Object Manifest 生命周期 | Hash 唯一覆盖 Canonical Payload；Manifest 独立管理对象状态；SEALED Revision 只引用 FROZEN Manifest | 两个 golden fixture 的 canonical bytes/digest、Manifest metadata/self-hash exclusion 均通过 | `PASS` |
| AF-API-U-001 | Unit | 对 SEALED Revision 修改内容/Hash/Parent | 拒绝 `ARTIFACT_REVISION_IMMUTABLE` | 无实现 | `NOT RUN` |
| AF-API-U-002 | Unit | 两个写者用同 expected head 移动 Branch | 一个 CAS 成功；另一个冲突，不 last-write-wins | 无并发实现 | `NOT RUN` |
| AF-API-U-003 | Unit | 同 Artifact/purpose 建立重叠 EffectiveBinding | 拒绝 `ARTIFACT_EFFECTIVE_BINDING_OVERLAP` | 无实现 | `NOT RUN` |
| AF-API-C-001 | Contract | RevisionRef ID 正确但 contentHash 错 | Query/Command 都拒绝 Hash mismatch，不读取 current 替代 | 无 Schema/Handler | `NOT RUN` |
| AF-API-C-002 | Contract | Representation Fixture 与 Revision/renderer/checksum 不匹配 | 登记拒绝；Representation 不替代 Canonical Content | 无 Fixture | `NOT RUN` |
| AF-API-C-003 | Contract | 普通 Revision 带 2 个 parent，或 Merge Revision 仅带 1 个 parent | 两者都因 parent 数量不符合 Command 语义而拒绝 | 修复前两者均 `valid=true`；修复后分别以 `maxItems` / `minItems` 拒绝 | `PASS` |
| AF-API-C-004 | Contract | Merge `conflictSet` 非空且 `conflictResolutionRefs=[]` | 拒绝未显式解决的冲突 | 修复前 `valid=true`；修复后以 `minItems` 拒绝 | `PASS` |
| AF-API-E-001 | E2E | 两 Agent 从同 Head 创建并行 Revision 后 Merge | Branch 全保留；Merge 有多 Parent 与显式冲突解决记录 | 无 Artifact 实现 | `NOT RUN` |
| AF-API-E-002 | E2E | 已发布 REV-003 后创建 REV-004 Draft | 原 Approval/Release/EffectiveBinding 不变 | 无跨模块实现 | `NOT RUN` |
| AF-API-M-001 | Manual | ART-023 Revision DAG Fixture | 审核者能定位内容 Hash、Parent、Branch、Representation 与 Binding 差异 | 未准备可执行 Fixture | `NOT RUN` |

## IM-04 Canonical Content 与对象验收用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-U-001 | Unit | 修改 SEALED Revision 的 Canonical body、Hash 或 SchemaRef | 拒绝不可变修改，必须创建新 Revision | 尚无业务实现 | `NOT RUN` |
| AF-IM04-U-002 | Unit | 跨 Artifact/Project 的 Parent 或 Content Ref | 拒绝 Scope/Lineage 不一致 | 尚无业务实现 | `NOT RUN` |
| AF-IM04-U-003 | Unit | 两个精确 Revision 的稳定 Unit/Sheet/Row/Cell 差异 | 只产生可重建 Added/Removed/Changed/Moved 结果，不写入业务事实 | 尚无 Diff 实现 | `NOT RUN` |
| AF-IM04-C-001 | Contract | Canonical body 与声明 contentHash 不一致 | 拒绝 Link；不能以 Revision ID 或对象路径替代 Hash | 业务 Link 尚未实现；独立 Hash helper 与 payload fixture 已由 AF-IM04-C-002 覆盖 | `NOT RUN` |
| AF-IM04-C-002 | Contract | 仅修改 Payload 的 schemaRef、contentType 或 canonicalizationVersion，body 不变 | 重算 Hash 必须改变；Manifest locator、storageState 或 Hash 自身不得进入 Hash 输入 | 两个 golden fixture 对 schemaRef/contentType/canonicalizationVersion/body 变体均改变 digest；Manifest/self-hash 变体保持 digest | `PASS` |
| AF-IM04-P-001 | Persistence | Staging object 经 Schema/大小/媒体类型/Hash 校验后 Link | DB 保存精确 manifest；仅允许 `LINKED/FROZEN` 业务引用 | 尚无对象适配器 | `NOT RUN` |
| AF-IM04-P-002 | Persistence | 对象上传成功、DB 事务失败 | 不产生业务 Link；对象进入可审计 Orphan Cleanup | 尚无业务 Repository | `NOT RUN` |
| AF-IM04-P-003 | Persistence | SEALED Revision 指向 STAGING/LINKED Manifest，或冻结后改写 Manifest 内容身份 | 前者拒绝封存；后者拒绝更新；必须新建 FROZEN Manifest 和 Revision | 尚无 Artifact Repository | `NOT RUN` |
| AF-IM04-C-003 | Contract | 请求公开 Diff Result Operation，或 Diff 输入使用 `latest/current` | Catalog 不提供未批准 Operation；既有 Query 只接受两个精确 RevisionRef 并返回 Diff Inputs | 公共 Contract 保持不变；内部 Diff 尚未实现 | `NOT RUN` |
| AF-IM04-C-004 | Contract | Registration 声明与权威 RenderAttempt 的 Revision/input Hash/Renderer/checksum 任一不一致 | Artifact 拒绝登记，不能只信任调用方 Registration | 规格已明确权威读取；跨模块实现尚未开始 | `NOT RUN` |
| AF-IM04-C-005 | Contract | 仅调用现有 `integration.get_render_attempt@1.0` 后尝试登记 Representation | 因缺少原始 Request/成功 Result Binding 而禁止 Handler 实现；必须先通过 additive Binding Query | `integration.get_render_attempt_binding@1.0` 已提供完整 Binding Result；Handler 仍未实现 | `PASS` |
| AF-IM04-E-001 | E2E | 同一 Head 的两个 Branch 创建 Revision 并显式 Merge | Branch 全保留；Merge 多 Parent；冲突有显式解决记录 | 尚无 Artifact E2E | `NOT RUN` |
| AF-IM04-E-002 | E2E | 已批准/已生效 Revision 后创建新 Draft | 旧 Approval/EffectiveBinding 不变化 | 尚无跨模块 E2E | `NOT RUN` |
| AF-IM04-M-001 | Manual | 合成 ART-023 Document/Workbook Fixture | 可检查 Revision Hash、稳定 Unit Diff、Branch、Representation 与 Binding | 尚未准备可执行 Fixture | `NOT RUN` |
| AF-IM05-R-001 | Renderer/Manual | 精确 Revision 请求 DOCX/XLSX Render | Attempt、input Hash、Renderer 版本、输出 checksum 全链一致；可打开性与版式另行验收 | Renderer 尚未实现 | `DEFERRED TO IM-05` |

## IM-04 WI-02 Application/Persistence 用例

以下用例只覆盖 V4000 已存在的标准事务技术表和 Artifact 事务边界，不创建 Artifact 业务表；实现和本地 Persistence Gate 已执行，静态总门禁已在修复测试 ESLint 规则后复跑通过。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-TX-001 | Persistence | 可信 Request Context、Command Envelope、技术 Process、Reference Edge、Outbox 和 committed result | 单连接内 Receipt、Process、Audit、Reference Edge、Outbox 原子提交；同 key/hash Replay 返回首个结果且不重复执行 | `pnpm persistence:gate`：commit/replay 与技术行计数通过 | `PASS` |
| AF-IM04-TX-002 | Persistence | 同一幂等 key 携带不同 canonical payload hash | 返回稳定 `IDEMPOTENCY_PAYLOAD_CONFLICT`；原 Receipt 不变；追加脱敏 DENIED Audit；不泄漏原始 Payload | `pnpm persistence:gate`：hash conflict、原 Receipt 保持和 DENIED Audit 通过 | `PASS` |
| AF-IM04-TX-003 | Persistence/Race | 两个事务同时 Claim 同 key/hash；两个写者使用同一 expected Process version | 幂等竞态只有一个 body 执行并返回 Replay；CAS 竞态一个成功、一个稳定 `CONCURRENCY_CONFLICT`，失败事务不遗留 Receipt/Outbox | `pnpm persistence:gate`：same-key body once、CAS winner/loser 和 rollback 通过 | `PASS` |
| AF-IM04-TX-004 | Persistence | `aggregate_version=9007199254740993` 的技术 Process CAS | 使用字符串/BigInt 精确推进到 `9007199254740994`，不经过 JavaScript Number 截断 | `pnpm persistence:gate`：`9007199254740993` 精确推进到 `9007199254740994` | `PASS` |
| AF-IM04-TX-005 | Persistence/Rollback | Outbox、Reference Edge 和技术 Process 已写入后注入故障 | Receipt、Process、Audit、Reference Edge、Outbox 全部回滚，数据库无半成品 | `pnpm persistence:gate`：fault injection 后五类技术行均为 0 | `PASS` |
| AF-IM04-TX-006 | Security/Persistence | Envelope 的 Actor、Decision、Policy、Enterprise、Project、Correlation 或技术 Row creator 与可信 Context 不一致 | 在提交前稳定拒绝；不产生伪造主体、跨 Scope 或孤立 Receipt | `pnpm persistence:gate`：attribution/context mismatch、cross-project 和 forged creator 通过 | `PASS` |
| AF-IM04-TX-007 | Security/PostgreSQL | 无 Context、伪造 GUC、过期 Context、跨 Enterprise/Project 的直接 App Role SQL；尝试 DDL、跨 Schema 读取、owner SET ROLE | RLS 返回零行或拒绝；写入/DDL/owner role/跨 Schema 操作使用预期权限错误；连接池不泄漏 Context | `pnpm persistence:gate`：RLS zero-row、`42501` ACL/DDL/cross-schema、expired Context 通过 | `PASS` |
| AF-IM04-TX-008 | Persistence/PostgreSQL | Project `process_instance` 与不同 Project 的 `process_step`；不同 owner version 与精确相同 Reference Edge | Process Step Scope mirror 拒绝跨 Project；不同 owner version 可共存；精确 owner/path/target 重复由 `23505` 拒绝 | `pnpm persistence:gate`：`23514` scope mirror、不同 owner version 成功、精确重复 `23505` 通过 | `PASS` |
| AF-IM04-TX-009 | Persistence | Canonical Outbox payload 缺失/伪造 Enterprise/Project mirror 或声明 hash 不一致；事件/Edge owner 偏离 Envelope target | 在技术行提交前以稳定错误拒绝，V4000 trigger 同时保持数据库防线 | `pnpm persistence:gate`：hash/scope/target/owner mismatch 均无 Receipt/技术行残留 | `PASS` |
| AF-IM04-TX-010 | Migration | 空库执行全量 Flyway，随后再次 migrate | V4000 成功应用；第二次 migrate 明确 no-op；测试容器清理 | `pnpm persistence:gate`：空库 migrate 成功，second migrate 为 `No migration necessary`，容器已清理 | `PASS` |

## 本阶段结果

- PR #12 Review 已用当前 `ContractRegistry` 运行确认 AF-API-C-003/004 修复前失败；修复后 focused regression 27/27、独立切片 35/35、合入最新 `main` 后全量测试 98/98 通过。
- IM-DG-005 的 Canonical Document/Workbook 与 Renderer 路线已获用户批准；WI-01 的 Schema、Hash、Binding Query Contract 回归已通过，WI-02 Application/Persistence 用例已在真实 PostgreSQL Gate 中完成，Artifact 业务 Repository/Handler、对象存储、E2E、Renderer 和 Manual 用例仍保持 `NOT RUN`。
- 2026-08-28 本地 `pnpm clean && pnpm verify`：Format、Lint、Typecheck、全量 Unit Test、Architecture、Contracts 和 PostgreSQL Persistence Gate 全部通过；Persistence 为 PostgreSQL 18.6 / Flyway 11.20.3、22 个文件、268 个测试，空库 Migration、二次 no-op 和临时容器清理均通过。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| AF-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| AF-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

对象存储、Renderer、业务 Repository 与 payload↔hash Gate 仍为 `NOT RUN`。
