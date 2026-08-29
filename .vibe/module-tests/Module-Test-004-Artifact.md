# Module-Test-004-Artifact

版本：v0.1
日期：2026-08-27
状态：`API CONTRACT TEST BASELINE / WI-01 CONTRACT REGRESSION PASS / PR #12 REMEDIATION VERIFIED / IM-DG-005 APPROVED / WI-02 APPLICATION-PERSISTENCE TESTS VERIFIED 2026-08-28 / WI-02 GIT DELIVERY VERIFIED PR #102 MERGED 2026-08-28 / ISSUE #91 CLOSED 2026-08-28 / WI-03 TEST PLAN FROZEN 2026-08-28 / WI-03 IMPLEMENTATION COMPLETE 2026-08-28 / WI-03 PERSISTENCE VERIFIED 2026-08-28 / WI-03 GIT DELIVERY VERIFIED PR #104 MERGED 2026-08-28 / ISSUE #92 CLOSED 2026-08-28 / WI-03 FEATURE BRANCH DELETED / WI-04 TEST PLAN FROZEN 2026-08-28 / WI-04 IMPLEMENTATION COMPLETE 2026-08-28 / WI-04 PERSISTENCE VERIFIED 2026-08-28 / WI-04 GIT DELIVERY VERIFIED PR #106 MERGED 2026-08-28 / ISSUE #93 CLOSED 2026-08-28 / WI-04 FEATURE BRANCH DELETED / WI-05 TEST PLAN FROZEN 2026-08-28 / WI-05 IMPLEMENTATION COMPLETE 2026-08-29 / WI-05 PERSISTENCE VERIFIED 2026-08-29 / WI-05 GIT DELIVERY COMPLETE PR #110 MERGED 2026-08-29 / ISSUE #94 CLOSED 2026-08-29 / WI-05 FEATURE BRANCH DELETED / WI-06 TEST PLAN FROZEN 2026-08-29 / WI-06 IMPLEMENTATION COMPLETE 2026-08-29 / WI-06 PERSISTENCE VERIFIED 2026-08-29 / WI-06 RE-VERIFICATION PASS 2026-08-29 / WI-06 GIT DELIVERY COMPLETE PR #113 MERGED 2026-08-29 / ISSUE #95 CLOSED 2026-08-29 / WI-07 TEST PLAN FROZEN 2026-08-29 / WI-07 IMPLEMENTATION COMPLETE 2026-08-29 / WI-07 PERSISTENCE VERIFIED 2026-08-29 / WI-07 GIT DELIVERY COMPLETE PR #114 MERGED 2026-08-29 / ISSUE #96 CLOSED 2026-08-29 / WI-07 FEATURE BRANCH DELETED / WI-08 TEST PLAN FROZEN 2026-08-29 / WI-08 IMPLEMENTATION COMPLETE 2026-08-29 / WI-08 PERSISTENCE VERIFIED 2026-08-29 / ISSUE #98 PLANNED`

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
| AF-API-C-002 | Contract | Representation Fixture 与 Revision/renderer/checksum 不匹配 | 登记拒绝；Representation 不替代 Canonical Content | `representation-service.test.ts` 逐项替换 Revision/input/renderer/output/receipt 后稳定拒绝；真实 PostgreSQL 无 Representation 或成功 Event 遗留 | `PASS` |
| AF-API-C-003 | Contract | 普通 Revision 带 2 个 parent，或 Merge Revision 仅带 1 个 parent | 两者都因 parent 数量不符合 Command 语义而拒绝 | 修复前两者均 `valid=true`；修复后分别以 `maxItems` / `minItems` 拒绝 | `PASS` |
| AF-API-C-004 | Contract | Merge `conflictSet` 非空且 `conflictResolutionRefs=[]` | 拒绝未显式解决的冲突 | 修复前 `valid=true`；修复后以 `minItems` 拒绝 | `PASS` |
| AF-API-E-001 | E2E | 两 Agent 从同 Head 创建并行 Revision 后 Merge | Branch 全保留；Merge 有多 Parent 与显式冲突解决记录 | 无 Artifact 实现 | `NOT RUN` |
| AF-API-E-002 | E2E | 已发布 REV-003 后创建 REV-004 Draft | 原 Approval/Release/EffectiveBinding 不变 | 无跨模块实现 | `NOT RUN` |
| AF-API-M-001 | Manual | ART-023 Revision DAG Fixture | 审核者能定位内容 Hash、Parent、Branch、Representation 与 Binding 差异 | 未准备可执行 Fixture | `NOT RUN` |

## IM-04 WI-08 Representation 权威 Binding 用例

本节是 Issue #97 的实现前测试合同。Binding、Registration、Revision 和对象 locator 均为 synthetic technical fixture；真实 Renderer、Provider 和生成文件不在本切片内。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-WI08-U-001 | Unit/Contract | Public Port 返回 `SUCCEEDED` Binding；Registration 与 attempt/revision/canonical locator/input hash/format/media/renderer/output/receipt 全一致 | 公开 Revision Ref 使用 `artifact.artifact_revision` NamespaceCode；通过 Registry result 校验和逐字段业务校验，形成规范化 registration facts | 聚焦 Vitest 4 files/17 tests passed；公开 Binding Result 与 Revision Snapshot Registry 校验均为 `valid=true` | `PASS` |
| AF-IM04-WI08-U-002 | Unit/Contract | 逐项修改 revision ID/hash/scope、canonical locator、input hash、format/media、renderer ID/version、output locator/checksum、raw receipt 或 attempt ref | 返回稳定 `ARTIFACT_REPRESENTATION_BINDING_MISMATCH`/更具体错误；不写 success facts | Unit substitution matrix 全部稳定拒绝；Persistence 对 revision/input/renderer/checksum 替换均 `REJECTED`，目标业务行数为 0 | `PASS` |
| AF-IM04-WI08-U-003 | Unit/Contract | Binding status 为 FAILED/UNKNOWN/CANCELLED/QUARANTINED，缺失 success/raw receipt，错误 receipt object type，或 Result 不符合公开 Contract | fail-closed；不得使用通用 Attempt Query 或调用方字段降级 | 四种非成功状态、缺失 receipt、错误 receipt type、Contract-invalid 与 cross-project 全部 fail-closed；Handler 只注入 Binding Query Port | `PASS` |
| AF-IM04-WI08-U-004 | Unit/Hash Domain | 以 output checksum 替代 input/content hash，或以 content hash 替代 output checksum | 稳定拒绝；三个 Hash 域不能互换 | input hash 与 output checksum 独立逐字段比较；任一替换返回 `ARTIFACT_REPRESENTATION_BINDING_MISMATCH` | `PASS` |
| AF-IM04-WI08-P-001 | Persistence | exact ACTIVE Revision + successful Binding + Registration | 同事务插入 1 Representation、1 Validation、必要 Reference Edges、1 `RepresentationRegistered` Event；精确 Query 返回完整 View | V4004 gate 实测 `Representation=1`、`Validation=1`、Reference Edge=3、成功 Event=1；精确 Query 与 Command View 相等 | `PASS` |
| AF-IM04-WI08-P-002 | Persistence/Replay/Race | 同 Command replay；顺序或并发的不同 key 但同 RenderAttempt/相同 immutable fields；同 Attempt 不同字段 | exact replay 均复用首个 Representation 且不重复 Validation/Event；替换返回 conflict 且不改首个事实 | 同 key 返回 `DUPLICATE`；不同 key exact replay 返回首个 ID，行/Event 仍为 1；同 Attempt 替换字段返回 `ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT`；并发首写由 Attempt advisory lock 裁决 | `PASS` |
| AF-IM04-WI08-P-003 | Persistence/Distinct Identity | input hash、renderer version、output checksum/object 或 format 变化，并由不同权威 Attempt 提供 | 使用不同 Representation ID 创建独立 immutable path；旧 Representation 不变 | 第二个权威 Attempt 使用新 renderer/checksum/object 创建第二 Representation；同 Revision 行数为 2，首个结果保持不变 | `PASS` |
| AF-IM04-WI08-P-004 | Persistence/Security | cross-project/cross-enterprise、归档 Artifact、withdrawn/invalidated Revision、无 Context、直接 INSERT/UPDATE/DELETE | 不可枚举拒绝或 ACL/RLS 拒绝；既有行不变 | Unit/Persistence 覆盖 cross-project 不可见；owner function 重验 active Artifact/Revision/Context；wrong-project SELECT=0，直接 UPDATE/DELETE 为 SQLSTATE `42501` | `PASS` |
| AF-IM04-WI08-P-005 | Persistence/Rollback | Representation/Validation/Outbox/Reference 写入后注入故障 | Receipt success 与所有本次业务/技术事实整体回滚 | Outbox 后注入故障，Representation/Validation/Command Receipt 均为 0；事务无半提交 | `PASS` |
| AF-IM04-WI08-P-006 | Persistence/Migration | 空库应用 V4004、第二次 migrate、owner function 授权签名、immutable trigger 与 RLS policy | Migration 成功、second migrate no-op；`artifact_app` 仅 SELECT/EXECUTE，owner function 重验 Scope/attribution | pinned PostgreSQL 18.6/Flyway 11.20.3：V4004 成功，28 files/284 tests passed，second migrate `No migration necessary`，容器清理；`can_insert=false/can_execute=true` | `PASS` |
| AF-IM04-WI08-M-001 | Manual | synthetic successful Binding/Registration 对照及 wrong revision/input/renderer/checksum/UNKNOWN/cross-project 矩阵 | 可复核预期/实际 error code、Representation/Validation/Event 行数和 cleanup；标注技术 Fixture | [`Manual-Representation-Binding.md`](../codex-issue-97/Manual-Representation-Binding.md) 已准备自动 fixture 实际结果；独立人工业务验收尚未执行 | `NOT RUN` |

WI-08 完整 `pnpm verify` 实际结果：format、lint、typecheck、test、architecture、contracts、persistence 全部通过；全量 Vitest 为 `32 passed / 24 skipped` 文件、`390 passed / 269 skipped` tests；公开 Registry 为 `FULL=201`，冻结兼容基线仍为 200 operations；Persistence 为 `28 files / 284 tests passed`，V4004 空库迁移、二次 no-op 与容器清理通过。受控 skipped、真实 IntegrationGateway/Renderer/Provider/object store、公开 HTTP、生产和独立人工验收不得升级为 PASS。

## IM-04 WI-05 Revision/Lineage/Branch CAS 用例

本节是 Issue #94 的实现测试合同与结果索引。Revision ID 在测试夹具中使用 UUIDv7；公开 `ContentAddressedRef.objectId` 对应 Revision ID，`contentHash` 必须与数据库快照精确一致。所有 PostgreSQL 用例使用 pinned PostgreSQL/Flyway disposable gate；所有 Provider、生产、公开 HTTP、跨模块和独立人工验收仍单独记录为 `NOT RUN`。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-WI05-U-001 | Unit | Initial/ordinary/merge Revision 分别提交 0/1/2 个 Parent | Initial 仅 0；ordinary 恰 1；merge 至少 2；非法数量拒绝 | `revision-service.test.ts`：3 tests passed；initial/ordinary/merge 的 `0/1/2` 正向结果由同一 Persistence 回归确认；initial/ordinary 非法数量、merge 少于 2 和 duplicate 被 Unit 拒绝 | `PASS` |
| AF-IM04-WI05-U-002 | Unit | sealed Revision 内容、Hash、Parent、SchemaRef、Provenance 或 Canonical locator 更新/删除 | 拒绝 `ARTIFACT_REVISION_IMMUTABLE`；必须创建新 Revision | `artifact-revisions.test.ts`：Revision UPDATE、Parent DELETE、Conflict DELETE、Withdrawal UPDATE、Invalidation DELETE 均返回 ACL `42501`；历史 Snapshot 的 Hash/Parent 未改变 | `PASS (PERSISTENCE)` |
| AF-IM04-WI05-C-001 | Contract | Parent ID 正确但 Hash 错、RevisionRef 使用 `latest/current` 或 Scope 不一致 | 拒绝 Hash/Scope/精确引用错误，不读取当前版本替代 | Unit 拒绝 `latest` 非 UUIDv7 exact ref；Persistence 拒绝 wrong hash；Lineage/Validation 对 Project 宽 Scope 返回 `ARTIFACT_QUERY_SCOPE_MISMATCH`，未走 current/latest fallback | `PASS` |
| AF-IM04-WI05-C-002 | Contract | FROZEN Manifest 以外的 STAGING/LINKED 内容、跨 Artifact/Project Parent、重复 Parent | 拒绝 `ARTIFACT_CONTENT_STATE_INVALID`、`ARTIFACT_CROSS_ARTIFACT_PARENT` 或稳定重复错误 | Persistence 拒绝 STAGING 内容并返回 `ARTIFACT_CONTENT_STATE_INVALID`；同 Artifact 之外 Parent 返回 `ARTIFACT_CROSS_ARTIFACT_PARENT`；Unit 拒绝 duplicate；owner function 保留递归 cycle guard | `PASS` |
| AF-IM04-WI05-P-001 | Persistence | 空库迁移、二次 migrate、V4003 owner function 完整授权签名、FROZEN Manifest 创建 Revision | V4003 成功；二次 no-op；所有函数授权签名与定义逐项一致；Revision 只保存 Manifest 快照和精确关系 | `pnpm persistence:gate`：pinned PostgreSQL 18.6/Flyway 11.20.3；30 条迁移成功（含 V4003），25 files/278 tests passed，second migrate 为 `No migration necessary`，容器已清理 | `PASS` |
| AF-IM04-WI05-P-002 | Persistence/Security | `artifact_app` 直接 UPDATE/DELETE Revision、Parent、Conflict、Governance Fact | ACL/Trigger 拒绝；已有 Snapshot/Parent 不变 | `artifact-revisions.test.ts`：五类 direct UPDATE/DELETE 均返回 `42501`；Snapshot、Parent、Governance 历史仍可读取 | `PASS` |
| AF-IM04-WI05-P-003 | Persistence | Parent 递归包含 self/cycle、跨 Artifact、cross Project、wrong hash | 整个事务拒绝；不留下 Revision、Parent、Link、Outbox、Reference Edge 半成品 | owner function 以 recursive CTE 拒绝 self/ancestor cycle；Persistence 实测 cross Artifact/wrong hash 候选均无 Revision；Project Scope 由 trusted context/RLS 收窄；rollback 断言本次新增事实无残留，既有 future-owner Link 按 WI-04 预留合同保留 | `PASS (OWNER GUARD + PERSISTENCE NEGATIVE)` |
| AF-IM04-WI05-R-001 | Persistence/Race | 两个写者对同 Branch 提交同 expected head/version 和不同候选 Revision | 一个 CAS 成功；另一个稳定 `ARTIFACT_BRANCH_HEAD_CONFLICT`，候选和冲突事实保留，Branch history 不丢失 | `artifact-revisions.test.ts`：并发结果恰为 `COMMITTED/REJECTED`；失败方返回冲突且 `currentAggregateVersion=1`；冲突事实 1 条，重读后 loser 以 version 1→2 成功；Head Event aggregate versions 为 `1,2`，Edge owner version 为 Branch UUID | `PASS` |
| AF-IM04-WI05-R-002 | Persistence/Idempotency | 同 Idempotency Key 同/不同 payload hash 重放 Revision/Create/Merge/Head Command | 同 hash 返回首个结果且不重复事实；不同 hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` | 同一 Create envelope 返回 `DUPLICATE` 并复用 `COMMITTED`；同 key 改变 immutable payload 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` | `PASS` |
| AF-IM04-WI05-P-004 | Persistence | Merge 带 unresolved conflict、非 Human resolvedBy、少于 2 Parent | 稳定拒绝；旧 Revision、Branch Head 和 Conflict 历史不被覆盖 | Unit 拒绝 merge 少于 2 Parent 与 unresolved conflict；Persistence 拒绝 unresolved merge、非 Human Merge，均无新 Revision；合法 Human Merge 产生 2 Parent 与 1 条 MERGE conflict fact | `PASS` |
| AF-IM04-WI05-P-005 | Persistence/History | 创建后读取 Snapshot/Lineage/Diff Inputs，再创建后续 Draft、Withdrawal、Invalidation | 原始 Hash/Parent/Provenance/Lineage 可重放；Disposition 只由追加治理事实变化；Withdrawal/Invalidation Reference Edge 使用互不冲突的治理路径 | `artifact-revisions.test.ts`：REV-001/002/003/004 DAG、root/edge/lineageHash、common ancestor 和 Diff Inputs 均精确回放；Withdrawal/Invalidation 后原 Snapshot identity/Parent/content 保持；两条治理 Edge path 不冲突 | `PASS` |
| AF-IM04-WI05-P-006 | Persistence/Rollback | Revision/Parent/Conflict/Outbox/Reference 写入后注入故障 | 本次事务新增的业务事实和技术记录整体回滚；既有 WI-04 future-owner Link 不被错误删除 | 注入 Outbox 后失败：新 Revision/Outbox/Receipt/Audit/Reference Edge 均为 0；预先建立的 future-owner Content Link 保持 1，符合 WI-04 owner reservation 边界 | `PASS` |
| AF-IM04-WI05-C-003 | Contract | Envelope 携带 Branch CAS expected version，payload 尝试重复声明或伪造版本 | 只接受 Envelope 版本；缺失或不一致稳定拒绝，不以 payload 提权 | Persistence 以 payload `expectedAggregateVersion=999`、Envelope version `0` 发起请求，稳定返回 `COMMAND_TARGET_MISMATCH`；正常 CAS 只由 Envelope version 推进 | `PASS` |
| AF-IM04-WI05-P-007 | Persistence | Project Artifact 引用同 Enterprise Scope 的结构 Schema Version，并写入 Branch/Revision Reference Edge | 合法提交；Edge owner version 保持 UUID；数值 head token 只出现在结果/事件 aggregate version | Project Artifact 使用 Enterprise-scoped schema 成功创建 Revision；Head Reference Edge `owner_version_id` 全为 Branch UUID；Outbox aggregate version 为 `1,2` | `PASS` |
| AF-IM04-WI05-P-008 | Persistence/Rollback | Merge conflict set、resolution refs 或 Human resolvedBy 在持久化前非法 | 在 Revision/Parent/Conflict/Outbox/Edge 写入前拒绝，数据库无孤立业务或技术事实 | unresolved conflict 与 non-Human Merge 均在持久化前拒绝；目标 Revision 行数为 0；Unit 覆盖 resolution refs 不能为空 | `PASS` |
| AF-IM04-WI05-C-004 | Contract/Query | Project Revision Lineage/Validation 使用仅含 Enterprise 的宽 Scope | 拒绝宽 Scope；`expectedScopeRef` 必须与 Project Artifact 的事实 Scope 完全一致 | Lineage 宽 Scope 返回 `ARTIFACT_QUERY_SCOPE_MISMATCH`；Validation 返回 `valid=false` 与同一 reason；精确 Project Scope 返回 `valid=true` | `PASS` |
| AF-IM04-WI05-P-009 | Persistence/History | Withdrawal 追加治理事实并产生 Outbox | Governance fact 的 `withdrawn_at` 与 Outbox `occurred_at` 使用同一已记录时刻 | Admin readback 对同一 command join 后两列 `::text` 完全相等；Snapshot disposition 为 `WITHDRAWN` 且 Revision identity 未改写 | `PASS` |
| AF-IM04-WI05-M-001 | Manual | ART-023：REV-001、两个分支候选、stale-head reject、显式 Conflict/Resolution、Merge、精确 Parent/Hash 表、immutable reject | 审核者能复核 DAG、CAS 冲突、Merge 事实和历史查询；清理结果明确 | [`Manual-ART-023.md`](../issue-94-delivery/Manual-ART-023.md) 已准备可执行检查表；独立人工业务验收尚未运行，自动 synthetic fixture 证据已列入 Verification Report | `NOT RUN` |

## IM-04 Canonical Content 与对象验收用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-U-001 | Unit | 修改 SEALED Revision 的 Canonical body、Hash 或 SchemaRef | 拒绝不可变修改，必须创建新 Revision | `revision-service.test.ts` 覆盖 Revision 输入校验；真实 PostgreSQL 对 Revision direct UPDATE 返回 `42501`，历史 Snapshot 保持不变 | `PASS (UNIT/PERSISTENCE)` |
| AF-IM04-U-002 | Unit | 跨 Artifact/Project 的 Parent 或 Content Ref | 拒绝 Scope/Lineage 不一致 | Cross-Artifact Parent、wrong hash 和 Project 宽 Scope Lineage/Validation 均被拒绝；exact Scope/Hash 才能继续 | `PASS (UNIT/PERSISTENCE)` |
| AF-IM04-U-003 | Unit | 两个精确 Revision 的稳定 Unit/Sheet/Row/Cell 差异 | 只产生可重建 Added/Removed/Changed/Moved 结果，不写入业务事实 | 尚无 Diff 实现 | `NOT RUN` |
| AF-IM04-C-001 | Contract | Canonical body 与声明 contentHash 不一致 | 拒绝 Link；不能以 Revision ID 或对象路径替代 Hash | WI-04 persistence probe 在上传前返回 `ARTIFACT_CONTENT_HASH_MISMATCH`；authoritative readback 篡改返回 `ARTIFACT_CONTENT_READBACK_MISMATCH`，不产生 Manifest | `PASS (PERSISTENCE)` |
| AF-IM04-C-002 | Contract | 仅修改 Payload 的 schemaRef、contentType 或 canonicalizationVersion，body 不变 | 重算 Hash 必须改变；Manifest locator、storageState 或 Hash 自身不得进入 Hash 输入 | 两个 golden fixture 对 schemaRef/contentType/canonicalizationVersion/body 变体均改变 digest；Manifest/self-hash 变体保持 digest | `PASS` |
| AF-IM04-P-001 | Persistence | Staging object 经 Schema/大小/媒体类型/Hash 校验后 Link | DB 保存精确 manifest；仅允许 `LINKED/FROZEN` 业务引用 | `artifact-content-object.test.ts` lifecycle 场景：STAGING manifest、精确 Link、authoritative readback、finalize 后 freeze 均通过；full gate 24 files/277 tests | `PASS (PERSISTENCE)` |
| AF-IM04-P-002 | Persistence | 对象上传成功、DB 事务失败 | 不产生业务 Link；对象进入可审计 Orphan Cleanup | 撤销 create owner function 后对象上传仍进入独立 Orphan 记录；Manifest/Link 不存在；24 小时 grace 后可回收 | `PASS (PERSISTENCE)` |
| AF-IM04-P-003 | Persistence | STAGING/LINKED Manifest 的冻结门禁，或冻结后改写 Manifest 内容身份 | 前者拒绝封存；后者拒绝更新；必须新建 FROZEN Manifest 和 Revision | STAGING 直接 finalization 被 owner function 拒绝；finalize 前 freeze 返回 `ARTIFACT_CONTENT_NOT_FINALIZED`；FROZEN 内容身份的 `artifact_app` 直接 UPDATE 返回 ACL `42501`；V4003 Revision 只接受 FROZEN Manifest，并保存不可变快照 | `PASS (PERSISTENCE)` |
| AF-IM04-P-004 | Persistence | 直接在 `STAGING` 调用 finalization owner function；DB Link 成功后 external finalize 成功、失败或 unknown；尝试在 finalize 前 freeze | `STAGING` 直接 finalize 拒绝；成功 finalize 才可 freeze；失败/unknown 保持 `LINKED` 且可重试；freeze 前拒绝 | `artifact-content-object.test.ts` 覆盖 STAGING direct finalize `INVALID_STATE`、success `FINALIZED`、failure `UNKNOWN`、freeze rejection 与 retry success；Manifest 由 `LINKED` 到 `FROZEN` | `PASS (PERSISTENCE)` |
| AF-IM04-P-005 | Persistence/Rollback | 对象上传后 DB Link 事务失败；宽限期后由多个 worker cleanup，包含错误 token、retry、NOT_FOUND、legal hold 和 retention | 无业务 Link；Orphan 可审计；lease/fencing 生效；unknown 可重试；`DELETED/NOT_FOUND` 幂等终态；hold/retention 禁止删除 | full gate 覆盖 24 小时 grace、5 分钟 lease、并发 worker `SKIP LOCKED`、错误 token `FENCED`、`UNKNOWN` 退避、`NOT_FOUND`/`DELETED` 幂等、retention `RETRY`、legal hold `HELD` 与对象保留 | `PASS (PERSISTENCE)` |
| AF-IM04-C-003 | Contract | 请求公开 Diff Result Operation，或 Diff 输入使用 `latest/current` | Catalog 不提供未批准 Operation；既有 Query 只接受两个精确 RevisionRef 并返回 Diff Inputs | 公共 Contract 保持不变；内部 Diff 尚未实现 | `NOT RUN` |
| AF-IM04-C-004 | Contract | Registration 声明与权威 RenderAttempt 的 Revision/input Hash/Renderer/checksum 任一不一致 | Artifact 拒绝登记，不能只信任调用方 Registration | 规格已明确权威读取；跨模块实现尚未开始 | `NOT RUN` |
| AF-IM04-C-005 | Contract | 仅调用现有 `integration.get_render_attempt@1.0` 后尝试登记 Representation | 因缺少原始 Request/成功 Result Binding 而禁止 Handler 实现；必须先通过 additive Binding Query | `integration.get_render_attempt_binding@1.0` 已提供完整 Binding Result；Handler 仍未实现 | `PASS` |
| AF-IM04-E-001 | E2E | 同一 Head 的两个 Branch 创建 Revision 并显式 Merge | Branch 全保留；Merge 多 Parent；冲突有显式解决记录 | 尚无 Artifact E2E | `NOT RUN` |
| AF-IM04-E-002 | E2E | 已批准/已生效 Revision 后创建新 Draft | 旧 Approval/EffectiveBinding 不变化 | 尚无跨模块 E2E | `NOT RUN` |
| AF-IM04-M-001 | Manual | 合成 ART-023 Document/Workbook Fixture | 可检查 Revision Hash、稳定 Unit Diff、Branch、Representation 与 Binding | [`Manual-ART-023.md`](../issue-94-delivery/Manual-ART-023.md) 已准备 Revision/CAS/Lineage/immutable 检查表；独立人工验收尚未运行 | `NOT RUN` |
| AF-IM05-R-001 | Renderer/Manual | 精确 Revision 请求 DOCX/XLSX Render | Attempt、input Hash、Renderer 版本、输出 checksum 全链一致；可打开性与版式另行验收 | Renderer 尚未实现 | `DEFERRED TO IM-05` |

## IM-04 WI-07 WorkbookSpec Human Edit 与内部 Diff 用例

以下用例是 Issue #96 的实现前测试合同。所有 Workbook/Revision/Object ID 和内容均为 synthetic technical fixture；真实客户 Workbook、Excel 计算与版式不在本切片验收范围。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-WI07-U-001 | Unit | Sheet/Column/Row/Cell 重复 stable ID，或各父级内重复 ordinal | 返回 `ARTIFACT_WORKBOOK_SCHEMA_INVALID`；不产生 canonical payload | `workbook-service.test.ts` 对四层身份、Sheet/Column/Row ordinal 与 `A1` identity 直接负向；6 tests passed | `PASS` |
| AF-IM04-WI07-U-002 | Unit | Cell 引用其他 Sheet Column、cell/column valueType 不一致、value 类型错误、公式使用 `A1`/外部 Sheet/未知 Column/括号不平衡 | 稳定拒绝；公式只保存声明语义且不执行计算 | focused suite 覆盖 unknown Column、type/value mismatch、`A1`、`Other!amount`、`[book]amount`、unknown identifier 与 malformed formula | `PASS` |
| AF-IM04-WI07-U-003 | Unit | malformed required/range/pattern/unique/compare；未知 required/optional extension | malformed 与未知 required 拒绝；未知 optional 被 canonical 保留但不执行 | 闭合规则、range、known/unknown required extension、unknown optional 及 options 贯穿 validation/Diff/Edit 均通过 | `PASS` |
| AF-IM04-WI07-U-004 | Unit/Hash | 同一 Workbook 的数组物理顺序不同但 ordinal/stable IDs 相同；metadata/body 语义变化 | 前者 canonical bytes/hash 相同；后者 hash 改变 | Sheet/Column/Row/Cell/rules 数组反转后 bytes/hash 不变；Cell `3 -> 4` digest 由 `e3e0...a818` 变为 `7a84...acb5` | `PASS` |
| AF-IM04-WI07-U-005 | Unit/Diff | Sheet/Column/Row/Cell 的 add/remove/change/move 与仅物理重排 | 按固定 stable path/kind 顺序返回确定性 Diff；仅物理重排不产生差异 | row add/move、Cell change、重复执行与物理重排直接断言；hierarchical allowed ref 与 Column/metadata 禁止直接断言 | `PASS` |
| AF-IM04-WI07-P-001 | Persistence | Human 以当前精确 base Revision 编辑显式允许 Cell | 新 Canonical Content Object 依次 FROZEN；创建唯一 Parent 新 Revision；base bytes/hash 不变 | PostgreSQL fixture 创建 revision 2、唯一 base parent、新 hash/bytes；base Snapshot 深比较不变；合并最新 `main` 后 27 files/283 tests | `PASS` |
| AF-IM04-WI07-P-002 | Unit/Persistence/Authorization | Agent、错误 hash、stale Branch Head、未知/重复 allowed ref、越权 Sheet/Row/Cell、修改 metadata/Column、cross-Sheet 引用、canonical no-op | 在新 Object/Revision 创建前稳定拒绝；原 Revision/Head 保持不变 | Unit + PostgreSQL 逐项稳定错误；每个拒绝后 revision count 不变；显式 Head CAS 后旧 base 返回 `ARTIFACT_WORKBOOK_BASE_STALE` | `PASS` |
| AF-IM04-WI07-P-003 | Persistence/Replay | 同一外层 command/key/hash 重放；相同 key 不同 payload | 首者复用同一对象/Revision/结果且不重复事实；后者返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` | replay 深比较相等且 Revision 数为 2；conflict 返回预期 code 后仍为 2 | `PASS` |
| AF-IM04-WI07-P-004 | Persistence/Readback | authoritative bytes 被篡改；Diff 输入不是两个精确 Workbook Revision | fail-closed，不信任调用方 bytes/locator；不返回伪造 Diff | tampered base bytes 返回 `ARTIFACT_CONTENT_READBACK_MISMATCH` 且 Revision 数为 1；Diff 经既有 exact Diff Inputs Query 与双方 FROZEN readback | `PASS` |
| AF-IM04-WI07-P-005 | PostgreSQL/Security | 空库 migrate、第二次 migrate、RLS/ACL 与拒绝路径行计数 | 不新增 migration；现有 V4000-V4003 完整应用且第二次 no-op；越权不可枚举，拒绝无新 Revision | PostgreSQL 18.6/Flyway 11.20.3：30 条现有 migration、27 files/283 passed、second migrate no-op、非特权 probe、container removed | `PASS` |
| AF-IM04-WI07-M-001 | Manual | 合成 Workbook 的 exact bytes/hash、stable ID map、合法 Cell Edit、跨 Sheet 拒绝、before/after refs、Diff、replay、cleanup | 审核者可逐项复核；明确标注 `SYNTHETIC / TECHNICAL ONLY` | [`Manual-Workbook-Fixture.md`](../issue-96-delivery/Manual-Workbook-Fixture.md) 已准备自动证据；独立人工复核尚未运行 | `NOT RUN` |

## IM-04 WI-06 Structured Document Human Edit 与内部 Diff 用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-WI06-U-001 | Unit/Hash | 同一采购流程 Document 的 Units 以不同数组顺序输入；父子关系、ordinal、SchemaRef 和 body 不变 | Canonical Document 的层级顺序、`childUnitIds`、Canonical JSON bytes 与 SHA-256 完全一致 | `structured-document-service.test.ts` 乱序 Unit 输入与 canonical bytes/hash 对比通过 | `PASS` |
| AF-IM04-WI06-U-002 | Unit/Contract | 重复 `unitId`、未知 unitType、未知 parent/child、父子方向不一致、同父级重复 ordinal、parent cycle | 在生成 bytes/Hash 前稳定拒绝 `ARTIFACT_STRUCTURE_SCHEMA_INVALID` 或对应结构错误；不产生对象/Revision | `structured-document-service.test.ts` duplicate ID、broken parent 通过；既有 executable canonical schema suite 覆盖 closed unitType、child/ordinal/cycle 回归 | `PASS` |
| AF-IM04-WI06-U-003 | Unit/Contract | evidence reference 缺失精确 Scope、使用跨 Project/Enterprise、非允许 Reference 形状 | 拒绝 Scope/evidence 校验；不把未经验证的 evidence 写入 Canonical payload | `structured-document-service.test.ts` cross-Project evidence 在 trusted Context 下返回 `ARTIFACT_QUERY_SCOPE_MISMATCH` | `PASS` |
| AF-IM04-WI06-U-004 | Unit/Diff | 两个相同 Document 的精确内容包含新增、删除、文本变化和 sibling ordinal 重排 | 只返回确定性 `ADDED`/`REMOVED`/`CHANGED`/`MOVED` Unit entries；重排未修改 Unit 不变成 whole-document replacement | `structured-document-service.test.ts` 对四类 Unit entry 和未变化 Document metadata 断言通过 | `PASS` |
| AF-IM04-WI06-U-005 | Unit/Diff | 相同 Unit 同时改变 text 与 ordinal/parent；重复执行 Diff | 结果可重建、排序稳定；同一 Unit 可分别产生 `CHANGED` 与 `MOVED`，无时间/随机字段 | `structured-document-service.test.ts` 重复 Diff 结果一致；`alpha` 同时产生 `CHANGED`/`MOVED` | `PASS` |
| AF-IM04-WI06-C-001 | Contract/Command | 非 Human principal、Envelope principal 与 trusted Context 不一致 | 返回 `ARTIFACT_HUMAN_ONLY_DENIED`；不上传、不 Link、不 Freeze、不创建 Revision | PostgreSQL 负向夹具使用 `AGENT` Context；Stage 前拒绝且 Revision 行数不增加 | `PASS (PERSISTENCE)` |
| AF-IM04-WI06-C-002 | Contract/Command | Human Edit 使用错误 contentHash、非 exact Revision ref、跨 Scope base 或已不是 Branch exact head 的 stale base | 返回 `ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID`/`ARTIFACT_STRUCTURED_DOCUMENT_BASE_STALE`；base 和新 Revision 历史不变 | PostgreSQL 夹具先创建合法 divergent Revision，再将 Branch head 移到该 Revision；wrong hash 与 stale base 均按稳定错误拒绝 | `PASS (PERSISTENCE)` |
| AF-IM04-WI06-C-003 | Contract/Command | 候选变化包含未列入 `allowedUnitRefs` 的 Unit、空 allow-list、重复 allow-list 或未知 Unit ref | 返回 `ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE`；Stage 前拒绝，不产生 Content Object/Revision | PostgreSQL 负向请求逐项覆盖越权、空、重复和未知 allow-list；每次前后 Revision 行数不变 | `PASS (PERSISTENCE)` |
| AF-IM04-WI06-P-001 | Persistence | exact sealed base 上执行合法 Human Edit，候选只修改允许 Paragraph 并新增 Revision | 创建新 Canonical Content Object/Link/Frozen Manifest 与单 Parent Revision；base content/hash/Parent 不变；`changedUnits` 确定 | PostgreSQL 正向夹具创建新 FROZEN Content Object 与 ordinary Revision；base Snapshot 精确保持，`changedUnits=[introduction]` | `PASS (PERSISTENCE)` |
| AF-IM04-WI06-P-002 | Persistence/History | 对 Human Edit 结果读取两个 exact Revision 的 Diff Inputs，再次 readback/rebuild Diff；重放同一输入 | left/right Snapshot、Canonical bytes、Hash、Diff entries 每次一致；不写 Diff Result 或治理事实 | PostgreSQL 夹具两次调用 exact Diff handler，bytes/hash/entries 均相等；Contract gate 保持无公共 Diff Result Operation | `PASS (PERSISTENCE/CONTRACT)` |
| AF-IM04-WI06-P-003 | Persistence/Rollback | Stage/Link/Freeze/Create Revision 任一步骤注入失败，或候选无变化 | 失败不改写 base；在失败边界保留既有 WI-04 orphan/retry 记录，不产生半成品 Revision；no-op 返回稳定错误 | PostgreSQL 夹具验证越权、空/重复/未知 allow-list、wrong hash、非 Human、stale 和 no-op 在 Stage 前拒绝；故障注入未在本 WI 新增 | `PARTIAL PASS / INJECTION NOT RUN` |
| AF-IM04-WI06-E-001 | E2E | 合成采购流程从 exact base 到允许编辑、拒绝越权编辑、读取 before/after Diff | UI/HTTP 之外的 Artifact 内部链路可复核；跨模块/公开 HTTP 不在本 WI 证明 | Unit + PostgreSQL 已覆盖 Artifact 内部链路；公开 HTTP、跨模块 E2E 与独立人工业务流程未运行 | `PASS (INTERNAL) / EXTERNAL NOT RUN` |
| AF-IM04-WI06-M-001 | Manual | synthetic procurement-procedure：exact bytes/hash、Unit tree、allowed edit、out-of-scope deny、before/after refs、Diff table、replay、cleanup | 审核者可独立复核 Human Edit 与 Diff 的输入/输出和清理边界；不代表真实业务政策验收 | [`Manual-ART-024.md`](../issue-95-delivery/Manual-ART-024.md) 已生成，包含 base/after bytes、Hash、tree、拒绝矩阵、Diff 和 cleanup；独立人工验收未运行 | `NOT RUN` |

## IM-04 WI-03 Artifact Root/Metadata/Archive 用例

本节是 Issue #92 的实现前测试合同。所有 PostgreSQL 用例必须使用 pinned PostgreSQL/Flyway disposable gate；所有输入中的 UUID 均为合成 UUIDv7。真实 EnterpriseProject 表不作为 Artifact 测试夹具，Scope 只通过可信 transaction Context 和 Artifact 本地镜像校验。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-WI03-U-001 | Unit | `PROJECT_DELIVERABLE` 缺失 `originProjectRef`、Enterprise/Project Scope 不一致、delivery ref 跨 Project | 统一拒绝 `ARTIFACT_SCOPE_INVALID`，不产生副作用 | `artifact-handlers.test.ts` 覆盖 exact Project、缺失 Origin、跨 Project ref；3 tests passed | `PASS` |
| AF-IM04-WI03-U-002 | Unit | Metadata Patch 含 `businessScope`、`originProjectRef`、`artifactType`、`deliveryItemRefs`、生命周期或 pointer 字段 | 拒绝 `ARTIFACT_METADATA_FIELD_FORBIDDEN`；原 Metadata 不变 | `artifact-handlers.test.ts` 覆盖 protected metadata key；3 tests passed | `PASS` |
| AF-IM04-WI03-U-003 | Unit | RFC 7396 风格 object Metadata Patch，含嵌套覆盖与 null 删除 | 只改变允许的 Metadata 字段，保留未覆盖字段；产生新的 Metadata Version | `artifact-handlers.test.ts` 覆盖嵌套覆盖、null 删除和保留字段；3 tests passed | `PASS` |
| AF-IM04-WI03-C-001 | Contract | `artifact.create_artifact@1.0` 现有 payload 与生成类型 | 不新增公共字段；创建契约仍拒绝正文、bytes 和额外 identity 字段 | `pnpm contracts:check`：201 operations、201/201 FULL；create payload 保持闭合，无正文/bytes/额外 identity 字段 | `PASS` |
| AF-IM04-WI03-P-001 | Persistence | 空库执行 `V4001`，再执行第二次 migrate | Root/Branch/约束/函数应用成功；第二次明确 no-op | pinned PostgreSQL 18.6/Flyway 11.20.3：V4001 成功，第二次 `No migration necessary` | `PASS` |
| AF-IM04-WI03-P-002 | Persistence | 创建 ART-023 Project Deliverable，带 exact Enterprise/Project/DeliveryItem refs | Root 与 `main` Branch 同事务提交；Root version=1、metadataVersion=1、headVersion=0、approved/effective 为空；Artifact 不含正文 | `artifact-business-aggregates.test.ts`：Root/Branch=1，exact Query 返回 main/null/0 与空 pointer；23 文件 Gate 通过 | `PASS` |
| AF-IM04-WI03-P-002B | Persistence | 创建 Enterprise Controlled Artifact，DeliveryItem 使用 Enterprise Scope，不携带 Project Origin | Root `project_id=NULL`，Enterprise Scope exact Query 可读；默认 `main` Branch、version=1、headVersion=0、pointer 为空；缺省 Origin 持久化为 SQL `NULL` | 最终 pinned PostgreSQL/Flyway Gate：Enterprise Scope exact Query、`main`/null/0、空 pointer 和 SQL `NULL` Origin 均通过 | `PASS` |
| AF-IM04-WI03-P-003 | Persistence | 同一 Scope、同一 artifactType、同一 initial title 使用不同幂等 key 创建 | 返回稳定 `ARTIFACT_IDENTITY_CONFLICT`；不产生第二 Root/Branch，原历史不变 | 返回 `ARTIFACT_IDENTITY_CONFLICT`，Root 数量保持 1 | `PASS` |
| AF-IM04-WI03-P-004 | Persistence | 同一 idempotency key/hash 重放创建；同 key/different payload 重放 | Replay 返回首个结果且 body 只执行一次；不同 hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，原 Receipt 不变 | Replay 返回 `DUPLICATE` 首个结果；不同 hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`；Root/Branch 未重复写入 | `PASS` |
| AF-IM04-WI03-P-005 | Persistence/CAS | 以 version=1 更新 title/classification/metadata；两个写者均以 version=1 更新 | 一个成功到 version=2/metadataVersion=2；另一个返回 `CONCURRENCY_CONFLICT` 和 current version=2，不 last-write-wins | 成功更新到 version 2/metadataVersion 2；stale writer 返回 `CONCURRENCY_CONFLICT` current=2 | `PASS` |
| AF-IM04-WI03-P-006 | Persistence | Update 使用未提供 expected version，或目标为 ARCHIVED/CANCELLED | 分别拒绝 `ARTIFACT_EXPECTED_VERSION_REQUIRED` / `ARTIFACT_NOT_ACTIVE`；Root、Branch、历史引用不变 | 缺失 expected version 返回 `ARTIFACT_EXPECTED_VERSION_REQUIRED`；Archive 后 Update 返回 `ARTIFACT_NOT_ACTIVE`；状态不变 | `PASS` |
| AF-IM04-WI03-P-007 | Security/RLS | 无 Context、Enterprise-only Context 读取 Project Artifact、错误 Project Context 读取/写入另一个 Project；尝试直接 UPDATE/DELETE Root/Branch | 查询返回零行或统一 `ARTIFACT_QUERY_NOT_FOUND`；直接写使用预期 ACL 错误；不枚举跨 Scope 行 | 无 Context/错误 Project SELECT 为 0；Query 为 `ARTIFACT_QUERY_NOT_FOUND`；Root UPDATE/Branch DELETE 为 ACL `42501` | `PASS` |
| AF-IM04-WI03-P-008 | Persistence | 以 version=2 Archive，随后查询 Root/Branch、尝试 Metadata Update/创建后续 mutable work | Archive 成功到 version=3，Root/Branch/Receipt/Audit/Reference Edge/Outbox 保留；后续变更返回 `ARTIFACT_NOT_ACTIVE` | version 3 Archive 成功；Root/Branch 与 3 Outbox/4 Reference Edge 保留；post-archive Update 返回 `ARTIFACT_NOT_ACTIVE` | `PASS` |
| AF-IM04-WI03-P-009 | Persistence/Rollback | 在 Root/Branch、Reference Edge、Outbox、Audit 写入后注入故障 | Receipt、Root、Branch、Reference Edge、Outbox、Audit 全部回滚，无半成品 | `INJECTED_FAULT` 后六类行均为 0 | `PASS` |
| AF-IM04-WI03-P-010 | Persistence | 直接 SQL 尝试改 Scope、identity_hash、delivery refs、pointer 或 aggregate version | Root Trigger/ACL 拒绝；历史和当前 exact read model 不变 | `artifact_app` 直接 Root UPDATE/Branch DELETE 均为 ACL `42501`；业务根写入只经 owner function | `PASS` |
| AF-IM04-WI03-P-011 | Persistence/Security | `artifact_app` 通过 owner function 提交 Project Scope 但省略 `origin_project_ref` | 数据库 Scope/Origin CHECK 拒绝 `23514`；Root/Branch 不产生 | 最终 pinned PostgreSQL/Flyway Gate：owner function 返回 `23514`，Root/Branch 均为 0 | `PASS` |
| AF-IM04-WI03-M-001 | Manual | 合成 ART-023 walkthrough：create、exact read、CAS update、stale CAS、cross-project reject、archive、post-archive reject | 展示 Artifact ID、main Branch ID、Root version 1/2/3、metadataVersion/headVersion、稳定错误码和清理结果 | 实现前未运行 | `NOT RUN` |

WI-03 单元夹具还必须通过 TypeScript 的 exact-optional-property 与 Scope 类型收窄边界；读模型夹具必须验证 JSONB 经过 canonical JSON 转换后再映射为公开 Typed Reference。

Persistence 夹具对 `CommandResult` 的 `COMMITTED` 分支和回滚注入回调使用显式类型收窄/不可达返回，避免测试编译成功掩盖结果联合或事务回滚边界错误。

引用夹具还验证：经 Scope 校验的公开 Typed Reference 进入 canonical identity/事件输入时必须显式转换为 JSON 值，不能依赖不安全的结构兼容。

存储 JSON 解析的单元边界还要求 `JSON.parse` 动态结果先经过 `unknown` 再映射为 canonical JSON，避免测试与实现共享不受控的 `any`。

首轮 `pnpm persistence:gate` 已实际完成 V4001 空库迁移；既有 22 个 Persistence 文件/269 个测试通过。新增业务文件首轮为 1 passed、2 failed，失败定位为测试夹具：Command 创建结果的扩展字段不能与 Query View 直接深比较，回滚 Outbox Envelope 必须携带 Project scope mirror；修正后重新执行 Gate。

第二轮 Gate 的新增业务文件为 2 passed、1 failed；失败定位为幂等重放结果辅助函数只接受 `COMMITTED`，实际业务返回预期的 `DUPLICATE` 并带回首个结果。修正辅助函数后重新执行 Gate。

第三轮 Gate 的新增业务文件为 2 passed、1 failed；失败定位为 Handler 返回 `metadataVersion` 的类型为 PostgreSQL `bigint` 字符串，而创建结果/读模型约定为数值。该轮已证明 Metadata CAS 已执行到结果构造，修正结果类型后重新执行 Gate。

最终 `pnpm persistence:gate` 已通过：`23` 个 Persistence 文件、`272 passed / 0 failed`；pinned PostgreSQL 18.6、Flyway 11.20.3、空库 V4001、第二次迁移 no-op、Project/Enterprise Controlled Root/Branch、RLS/ACL、幂等/身份冲突、Metadata CAS、Archive、Rollback、缺失 expected version 拒绝和 Project 空 Origin owner-boundary 拒绝均已覆盖，容器已清理。完整 `pnpm verify` 的 Format、Lint、Typecheck、全量 Unit（27 files / 371 passed / 257 skipped）、Architecture 和 Contract 阶段均通过，但末尾 Persistence 因 Docker Hub token `EOF` 未启动，故该次编排不记为完整 PASS。Manual `M-001`、生产/Provider/公开 HTTP/跨模块 E2E 仍为 `NOT RUN`。

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
- IM-DG-005 的 Canonical Document/Workbook 与 Renderer 路线已获用户批准；WI-01 的 Schema、Hash、Binding Query Contract 回归已通过，WI-02 Application/Persistence 用例已在真实 PostgreSQL Gate 中完成，WI-03 Artifact Root/Branch 业务 Repository/Handler、RLS、CAS、Archive 和回滚已在本文件上方的独立 Gate 中完成，WI-04 Canonical Content Object 已完成并通过真实 PostgreSQL Gate；WI-05 Revision/Lineage/Branch CAS/显式 Merge 已完成实现与本地验证，具体命令、计数和未运行边界见 [`Verification-Report.md`](../issue-94-delivery/Verification-Report.md)；PR #110 已合并、Issue #94 已关闭、原 feature branch 已删除。
- WI-02 的历史 Gate 记录为 PostgreSQL 18.6 / Flyway 11.20.3、22 个文件、268 个测试；WI-03 最终独立 Gate 记录为 23 个文件、272 个测试。最新完整 `pnpm verify` 的静态阶段通过，但 Persistence 子阶段因 Docker Hub token `EOF` 未启动，详见本次 Issue #92 [`Verification-Report.md`](../codex-issue-92/Verification-Report.md)。
- 静态设计 Gate：`DESIGN VERIFIED`；本次 WI-03 的实现与验证摘要见 [`Verification-Report.md`](../codex-issue-92/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| AF-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| AF-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

Revision/Content Object、对象存储、Renderer、跨模块业务 E2E、人工验收与 payload↔hash 业务 Link Gate 仍为 `NOT RUN`。
