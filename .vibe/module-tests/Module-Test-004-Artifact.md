# Module-Test-004-Artifact

版本：v0.1
日期：2026-08-27
状态：`API CONTRACT TEST BASELINE / WI-01 CONTRACT REGRESSION PASS / PR #12 REMEDIATION VERIFIED / IM-DG-005 APPROVED / WI-02 APPLICATION-PERSISTENCE TESTS VERIFIED 2026-08-28 / WI-02 GIT DELIVERY VERIFIED PR #102 MERGED 2026-08-28 / ISSUE #91 CLOSED 2026-08-28 / WI-03 TEST PLAN FROZEN 2026-08-28 / WI-03 IMPLEMENTATION COMPLETE 2026-08-28 / WI-03 PERSISTENCE VERIFIED 2026-08-28 / WI-03 GIT DELIVERY VERIFIED PR #104 MERGED 2026-08-28 / ISSUE #92 CLOSED 2026-08-28 / WI-03 FEATURE BRANCH DELETED / WI-04 TEST PLAN FROZEN 2026-08-28 / WI-04 IMPLEMENTATION COMPLETE 2026-08-28 / WI-04 PERSISTENCE VERIFIED 2026-08-28 / WI-04 GIT DELIVERY VERIFIED PR #106 MERGED 2026-08-28 / ISSUE #93 CLOSED 2026-08-28 / WI-04 FEATURE BRANCH DELETED / WI-05 TEST PLAN FROZEN 2026-08-28 / WI-05 IMPLEMENTATION COMPLETE 2026-08-29 / WI-05 PERSISTENCE VERIFIED 2026-08-29 / WI-05 GIT DELIVERY COMPLETE PR #110 MERGED 2026-08-29 / ISSUE #94 CLOSED 2026-08-29 / WI-05 FEATURE BRANCH DELETED / ISSUES #95–#98 PLANNED`

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
