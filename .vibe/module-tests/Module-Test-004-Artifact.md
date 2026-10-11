# Module-Test-004-Artifact

版本：v0.1
日期：2026-08-30
状态：`API CONTRACT TEST BASELINE / IM-04 WI-01–WI-09 AUTOMATED AND PERSISTENCE EVIDENCE PASS / ISSUE #90–#98 CLOSED / PARENT SCOPED TECHNICAL ACCEPTANCE PASS 2026-08-30 / IM-05 WI-05 CONTROLLED RENDERER COMPOSITION AND GIT DELIVERY PASS / PR #135 MERGED / ISSUE #125 CLOSED / INDEPENDENT BUSINESS MANUAL AND EXTERNAL BOUNDARIES NOT RUN`

对应规格：[`Module-Spec-004-Artifact.md`](../module-specs/Module-Spec-004-Artifact.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-API-D-001 | Design | Artifact Module Spec 与 Catalog | 12 Command、7 Query、7 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=7 events=7`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| AF-API-D-002 | Design/Contract | IM-DG-005 Structured Document 最小 Schema | Document 使用闭合 unitType、稳定 unitId、无环父子关系、同级 ordinal 与未知 Required Extension 拒绝 | `canonical-content.test.ts` 正向与 duplicate/hierarchy/cycle/ordinal 负向断言通过 | `PASS` |
| AF-API-D-003 | Design/Contract | IM-DG-005 WorkbookSpec 最小 Schema | Workbook 使用稳定 Sheet/Column/Row/Cell 身份、同 Sheet 引用一致性，并保留 valueType、formula、validation 语义 | `canonical-content.test.ts` 正向与引用/重复 ID/公式/类型负向断言通过 | `PASS` |
| AF-API-D-004 | Design/Contract | IM-DG-005 Renderer 路线与现有 IntegrationGateway Contract | 精确 Revision/input Hash 经 RenderAttempt/Adapter/Receipt 后才能登记 Representation；现有 Query 不足时先 additive 增加只读 Binding Query，不新增重复 Render 执行 API | Binding Query 已注册为唯一新增 Query；既有通用 Attempt Query 回归保持通过 | `PASS` |
| AF-API-D-005 | Design/Contract | IM-DG-005 Hash 域与 Content Object Manifest 生命周期 | Hash 唯一覆盖 Canonical Payload；Manifest 独立管理对象状态；SEALED Revision 只引用 FROZEN Manifest | 两个 golden fixture 的 canonical bytes/digest、Manifest metadata/self-hash exclusion 均通过 | `PASS` |
| AF-API-U-001 | Unit | 对 SEALED Revision 修改内容/Hash/Parent | 拒绝 `ARTIFACT_REVISION_IMMUTABLE` | Revision/Parent direct UPDATE/DELETE 由 ACL `42501` 拒绝；历史 Snapshot identity 保持 | `PASS (PERSISTENCE)` |
| AF-API-U-002 | Unit | 两个写者用同 expected head 移动 Branch | 一个 CAS 成功；另一个冲突，不 last-write-wins | 真实 PostgreSQL race 为 `COMMITTED/REJECTED`；loser=`ARTIFACT_BRANCH_HEAD_CONFLICT`，保留候选并可在重读后推进 | `PASS (PERSISTENCE)` |
| AF-API-U-003 | Unit | 同 Artifact/purpose 建立重叠 EffectiveBinding | 拒绝 `ARTIFACT_EFFECTIVE_BINDING_OVERLAP` | 无实现 | `NOT RUN` |
| AF-API-C-001 | Contract | RevisionRef ID 正确但 contentHash 错 | Query/Command 都拒绝 Hash mismatch，不读取 current 替代 | Query 直接返回 `ARTIFACT_CONTENT_HASH_MISMATCH`；`objectId=latest` 返回 `ARTIFACT_SCOPE_INVALID`；无 current fallback | `PASS` |
| AF-API-C-002 | Contract | Representation Fixture 与 Revision/renderer/checksum 不匹配 | 登记拒绝；Representation 不替代 Canonical Content | `representation-service.test.ts` 逐项替换 Revision/input/renderer/output/receipt 后稳定拒绝；真实 PostgreSQL 无 Representation 或成功 Event 遗留 | `PASS` |
| AF-API-C-003 | Contract | 普通 Revision 带 2 个 parent，或 Merge Revision 仅带 1 个 parent | 两者都因 parent 数量不符合 Command 语义而拒绝 | 修复前两者均 `valid=true`；修复后分别以 `maxItems` / `minItems` 拒绝 | `PASS` |
| AF-API-C-004 | Contract | Merge `conflictSet` 非空且 `conflictResolutionRefs=[]` | 拒绝未显式解决的冲突 | 修复前 `valid=true`；修复后以 `minItems` 拒绝 | `PASS` |
| AF-API-E-001 | E2E | 两 Agent 从同 Head 创建并行 Revision 后 Merge | Branch 全保留；Merge 有多 Parent 与显式冲突解决记录 | scoped local PostgreSQL fixture：并行候选保留、CAS loser 形成 conflict、Human Merge 有 2 Parent 与 resolution fact | `PASS (SCOPED LOCAL)` |
| AF-API-E-002 | E2E | 已发布 REV-003 后创建 REV-004 Draft | 原 Approval/Release/EffectiveBinding 不变 | 无跨模块实现 | `NOT RUN` |
| AF-API-M-001 | Manual | ART-023 Revision DAG Fixture | 审核者能定位内容 Hash、Parent、Branch、Representation 与 Binding 差异 | [`Manual-ART-023.md`](../archive/issue-98-delivery/Manual-ART-023.md) 已汇总 exact automated output；独立人工复核尚未执行 | `NOT RUN (INDEPENDENT MANUAL)` |

## IM-04 父退出门槛用例

以下用例是 Issue #89 的父 Gate 测试合同。本轮执行前先冻结输入与预期；实际输出必须由当前交付分支重新执行后填写，不能直接复制 WI-09 历史结果。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-EXIT-G-001 | Git/Remote | GitHub #90–#98、有效实现/权威同步 PR、当前 `origin/main` | 子 Issue 全部 `CLOSED / COMPLETED`；PR 为 `MERGED` 且 exact head 为 `origin/main` ancestor；无未解释的替代实现 | #90–#98 已回读为关闭；PR #100/#102/#104/#106/#110/#113/#114/#116/#117/#118 已合并，对应 head ancestry 已通过 | `PASS` |
| AF-IM04-EXIT-G-002 | Full Gate | `pnpm clean && pnpm verify` | Format/Lint/Typecheck/Unit/Architecture、201-operation Contract、200-operation frozen compatibility、真实 PostgreSQL Persistence 全部通过 | Format/Lint/Typecheck 通过；32 passed/24 skipped files、390 passed/269 skipped tests；Architecture PASS；Catalog/Registry 201/201 FULL；baseline 200；Persistence 28 files/284 passed | `PASS` |
| AF-IM04-EXIT-P-001 | PostgreSQL/Migration | pinned PostgreSQL 18.6/Flyway 11.20.3 空库 migrate、second migrate、Artifact 负向矩阵与 cleanup | `V4000`–`V4004` 前向迁移成功；第二次 `No migration necessary`；RLS/ACL/Scope/Hash/CAS/rollback/orphan/immutable/binding 负例通过；容器删除 | 完整 Gate 远端验证 tag↔digest 后执行 server `180006`、空库 31 migrations、28/284；second migrate=`No migration necessary`；container removed | `PASS` |
| AF-IM04-EXIT-E-001 | Synthetic E2E | `ZJU_ART023_REPORT=1 pnpm persistence:gate` | 输出无 Secret 的 exact Root/Branch/Manifest/Revision/DAG/CAS/Diff/Binding/Representation 与预期拒绝；28 个 Persistence 文件全部通过并清理 | 报告 Gate 的远端 manifest 复核因 Docker Hub 鉴权连续三次 `EOF` 且均未启动 DB；随后复用同轮完整 Gate 已验证的 digest-pinned 本地镜像，独立输出 exact ART023 Query/Representation evidence，28/284、second no-op、container removed | `PASS (COMBINED DIRECT EVIDENCE)` |
| AF-IM04-EXIT-B-001 | Boundary | Renderer/Provider、Ceph RGW/OpenBao、公开 HTTP、生产、后续模块业务 E2E、真实客户和独立人工验收 | 不由本地自动技术 Gate 推导为通过 | 未执行，保持父 Gate 明示边界 | `NOT RUN` |

## IM-04 WI-09 权威 Query 与退出证据用例

以下用例记录 Issue #98 的输入、预期与实际输出。所有对象、Hash 与 Binding 均为 synthetic technical fixture；自动技术 PASS 不替代独立人工或真实业务验收。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-WI09-Q-001 | Contract/Persistence | exact Artifact/Revision/Representation Ref；随后分别替换 Scope、Revision hash、Representation checksum/renderer/locator，或把 Revision ID 改为 `latest/current` | 仅 exact Ref 返回权威 View；所有替换 fail-closed，不读取 Head/current，不枚举跨 Scope 行 | exact read 通过；wrong hash=`ARTIFACT_CONTENT_HASH_MISMATCH`，`latest`=`ARTIFACT_SCOPE_INVALID`，宽 Scope=`ARTIFACT_QUERY_SCOPE_MISMATCH`，错误 Representation Ref=`ARTIFACT_QUERY_NOT_FOUND` | `PASS` |
| AF-IM04-WI09-Q-002 | Persistence/History | ART-023 REV-001、两个并行 Revision、显式 Merge；随后追加 Withdrawal/Invalidation 与 Representation | 旧 Revision identity/Parent/content 保持；Lineage node/edge identity 与 Diff Inputs 的左右 Ref、共同祖先、Schema input 保持；仅 disposition 按治理事实变化 | 4 nodes/4 edges/root exact；治理后 node/edge identity 与 Diff Inputs 深比较相等，REV-001 disposition=`INVALIDATED`；Representation 前后 Lineage/Diff Inputs 深比较相等 | `PASS` |
| AF-IM04-WI09-Q-003 | Persistence/Security | STAGING/LINKED/QUARANTINED Manifest、错误 authoritative readback、跨 Project Context、直接写业务表 | 非 FROZEN 对象不能创建 Revision；公共 Query 无可用 Revision locator；RLS/ACL/owner guard 拒绝且无半成品 | 非 FROZEN=`ARTIFACT_CONTENT_STATE_INVALID`；readback tamper 被隔离；wrong Project 行数 0；直接 mutation=`42501`；拒绝后目标业务行 0 | `PASS` |
| AF-IM04-WI09-Q-004 | Unit/Persistence | 两个 exact Revision 的 Document/Workbook Diff Inputs 与 authoritative bytes | 只返回精确 Snapshot/common ancestor/schema；内部 stable Diff 可重复且不持久化为 Quality/Approval/Release 事实 | Document `902a... -> 3bee...` 为 `CHANGED introduction`；Workbook `e3e0... -> 7a84...` 为 stable Cell `CHANGED`；共同祖先/Schema exact，无 Diff 业务事实 | `PASS` |
| AF-IM04-WI09-Q-005 | Contract/Persistence | successful RenderAttempt Binding 后登记 Representation；替换 attempt/revision/input/renderer/output/receipt/status | 仅完整权威 Binding 可登记和 exact Query；失败矩阵无 Representation/Validation/Event 遗留；新增 Representation 不改变 Revision Query | success 为 Representation/Validation/Event=`1/1/1`、Edge=3；替换/UNKNOWN/conflict 精确拒绝；wrong Query Ref not found；Lineage/Diff Inputs 不变 | `PASS` |
| AF-IM04-WI09-G-001 | Full Gate | `pnpm clean && pnpm verify` 与 pinned PostgreSQL/Flyway | Format/Lint/Typecheck/Unit/Architecture/201-operation Contract、空库 Migration、second no-op、Persistence 与 cleanup 全部通过 | 32 passed/24 skipped files、390 passed/269 skipped tests；Architecture PASS；FULL=201；baseline=200；Persistence 28 files/284 passed；no-op；container removed | `PASS` |
| AF-IM04-WI09-M-001 | Manual/Review | 合成 ART-023 Document/Workbook/Manifest/DAG/Branch/Diff/Binding/Representation/negative 输出 | 单一报告记录 exact IDs、hashes、checksums、输入、预期、实际、命令、环境、时间与 cleanup；标注 `SYNTHETIC / TECHNICAL ONLY` | [`Manual-ART-023.md`](../archive/issue-98-delivery/Manual-ART-023.md) 已记录本次 automated exact output；独立人工业务复核未运行 | `PASS (AUTOMATED SYNTHETIC) / NOT RUN (INDEPENDENT MANUAL)` |
| AF-IM04-WI09-X-001 | Deferred | `artifact.get_effective_binding@1.0`、真实 Provider/Renderer/object store、公开 HTTP、生产、跨模块与独立业务验收 | 不以 IM-04 本地技术 Gate 冒充实现或通过 | 无正式 Release/EffectiveBinding 事实；保留边界 | `NOT RUN` |

Git 交付回读：实现 head `8e58fa18ee50726252ca38542b6de1afdfbb4310` 的 PR #117 `ci/verify` 为 `SUCCESS`；merge commit 为 `f4b8704ba766d49c12c4433884d94bce91d50792`；Issue #98 为 `CLOSED / COMPLETED`；实现 head 是 `origin/main` ancestor。父 Issue #89 由上方独立父 Gate 复核后关闭。

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
| AF-IM04-WI08-M-001 | Manual | synthetic successful Binding/Registration 对照及 wrong revision/input/renderer/checksum/UNKNOWN/cross-project 矩阵 | 可复核预期/实际 error code、Representation/Validation/Event 行数和 cleanup；标注技术 Fixture | [`Manual-Representation-Binding.md`](../archive/codex-issue-97/Manual-Representation-Binding.md) 已准备自动 fixture 实际结果；独立人工业务验收尚未执行 | `NOT RUN` |

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
| AF-IM04-WI05-M-001 | Manual | ART-023：REV-001、两个分支候选、stale-head reject、显式 Conflict/Resolution、Merge、精确 Parent/Hash 表、immutable reject | 审核者能复核 DAG、CAS 冲突、Merge 事实和历史查询；清理结果明确 | [`Manual-ART-023.md`](../archive/issue-94-delivery/Manual-ART-023.md) 已准备可执行检查表；独立人工业务验收尚未运行，自动 synthetic fixture 证据已列入 Verification Report | `NOT RUN` |

## IM-04 Canonical Content 与对象验收用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM04-U-001 | Unit | 修改 SEALED Revision 的 Canonical body、Hash 或 SchemaRef | 拒绝不可变修改，必须创建新 Revision | `revision-service.test.ts` 覆盖 Revision 输入校验；真实 PostgreSQL 对 Revision direct UPDATE 返回 `42501`，历史 Snapshot 保持不变 | `PASS (UNIT/PERSISTENCE)` |
| AF-IM04-U-002 | Unit | 跨 Artifact/Project 的 Parent 或 Content Ref | 拒绝 Scope/Lineage 不一致 | Cross-Artifact Parent、wrong hash 和 Project 宽 Scope Lineage/Validation 均被拒绝；exact Scope/Hash 才能继续 | `PASS (UNIT/PERSISTENCE)` |
| AF-IM04-U-003 | Unit | 两个精确 Revision 的稳定 Unit/Sheet/Row/Cell 差异 | 只产生可重建 Added/Removed/Changed/Moved 结果，不写入业务事实 | Structured Document 与 Workbook focused tests 覆盖 stable Added/Removed/Changed/Moved、物理重排 no-op 与重复执行 | `PASS` |
| AF-IM04-C-001 | Contract | Canonical body 与声明 contentHash 不一致 | 拒绝 Link；不能以 Revision ID 或对象路径替代 Hash | WI-04 persistence probe 在上传前返回 `ARTIFACT_CONTENT_HASH_MISMATCH`；authoritative readback 篡改返回 `ARTIFACT_CONTENT_READBACK_MISMATCH`，不产生 Manifest | `PASS (PERSISTENCE)` |
| AF-IM04-C-002 | Contract | 仅修改 Payload 的 schemaRef、contentType 或 canonicalizationVersion，body 不变 | 重算 Hash 必须改变；Manifest locator、storageState 或 Hash 自身不得进入 Hash 输入 | 两个 golden fixture 对 schemaRef/contentType/canonicalizationVersion/body 变体均改变 digest；Manifest/self-hash 变体保持 digest | `PASS` |
| AF-IM04-P-001 | Persistence | Staging object 经 Schema/大小/媒体类型/Hash 校验后 Link | DB 保存精确 manifest；仅允许 `LINKED/FROZEN` 业务引用 | `artifact-content-object.test.ts` lifecycle 场景：STAGING manifest、精确 Link、authoritative readback、finalize 后 freeze 均通过；full gate 24 files/277 tests | `PASS (PERSISTENCE)` |
| AF-IM04-P-002 | Persistence | 对象上传成功、DB 事务失败 | 不产生业务 Link；对象进入可审计 Orphan Cleanup | 撤销 create owner function 后对象上传仍进入独立 Orphan 记录；Manifest/Link 不存在；24 小时 grace 后可回收 | `PASS (PERSISTENCE)` |
| AF-IM04-P-003 | Persistence | STAGING/LINKED Manifest 的冻结门禁，或冻结后改写 Manifest 内容身份 | 前者拒绝封存；后者拒绝更新；必须新建 FROZEN Manifest 和 Revision | STAGING 直接 finalization 被 owner function 拒绝；finalize 前 freeze 返回 `ARTIFACT_CONTENT_NOT_FINALIZED`；FROZEN 内容身份的 `artifact_app` 直接 UPDATE 返回 ACL `42501`；V4003 Revision 只接受 FROZEN Manifest，并保存不可变快照 | `PASS (PERSISTENCE)` |
| AF-IM04-P-004 | Persistence | 直接在 `STAGING` 调用 finalization owner function；DB Link 成功后 external finalize 成功、失败或 unknown；尝试在 finalize 前 freeze | `STAGING` 直接 finalize 拒绝；成功 finalize 才可 freeze；失败/unknown 保持 `LINKED` 且可重试；freeze 前拒绝 | `artifact-content-object.test.ts` 覆盖 STAGING direct finalize `INVALID_STATE`、success `FINALIZED`、failure `UNKNOWN`、freeze rejection 与 retry success；Manifest 由 `LINKED` 到 `FROZEN` | `PASS (PERSISTENCE)` |
| AF-IM04-P-005 | Persistence/Rollback | 对象上传后 DB Link 事务失败；宽限期后由多个 worker cleanup，包含错误 token、retry、NOT_FOUND、legal hold 和 retention | 无业务 Link；Orphan 可审计；lease/fencing 生效；unknown 可重试；`DELETED/NOT_FOUND` 幂等终态；hold/retention 禁止删除 | full gate 覆盖 24 小时 grace、5 分钟 lease、并发 worker `SKIP LOCKED`、错误 token `FENCED`、`UNKNOWN` 退避、`NOT_FOUND`/`DELETED` 幂等、retention `RETRY`、legal hold `HELD` 与对象保留 | `PASS (PERSISTENCE)` |
| AF-IM04-C-003 | Contract | 请求公开 Diff Result Operation，或 Diff 输入使用 `latest/current` | Catalog 不提供未批准 Operation；既有 Query 只接受两个精确 RevisionRef 并返回 Diff Inputs | Catalog 仍为 201，无公共 Diff Result；`latest` 直接拒绝；exact Diff Inputs 与内部 Document/Workbook Diff 均通过 | `PASS` |
| AF-IM04-C-004 | Contract | Registration 声明与权威 RenderAttempt 的 Revision/input Hash/Renderer/checksum 任一不一致 | Artifact 拒绝登记，不能只信任调用方 Registration | Unit/Persistence substitution matrix 全部稳定拒绝，目标 Representation/Validation/Event 无遗留 | `PASS` |
| AF-IM04-C-005 | Contract | 仅调用现有 `integration.get_render_attempt@1.0` 后尝试登记 Representation | 因缺少原始 Request/成功 Result Binding 而禁止 Handler 实现；必须先通过 additive Binding Query | Handler 仅注入并校验 `integration.get_render_attempt_binding@1.0` Port；通用 Attempt Query 无降级路径 | `PASS` |
| AF-IM04-E-001 | E2E | 同一 Head 的两个 Branch 创建 Revision 并显式 Merge | Branch 全保留；Merge 多 Parent；冲突有显式解决记录 | scoped local PostgreSQL fixture 实际完成 DAG/CAS/Conflict/Human Merge/Query/readback/cleanup | `PASS (SCOPED LOCAL)` |
| AF-IM04-E-002 | E2E | 已批准/已生效 Revision 后创建新 Draft | 旧 Approval/EffectiveBinding 不变化 | 尚无跨模块 E2E | `NOT RUN` |
| AF-IM04-M-001 | Manual | 合成 ART-023 Document/Workbook Fixture | 可检查 Revision Hash、稳定 Unit Diff、Branch、Representation 与 Binding | [`Manual-ART-023.md`](../archive/issue-98-delivery/Manual-ART-023.md) 已汇总 exact automated output；独立人工验收尚未运行 | `NOT RUN (INDEPENDENT MANUAL)` |
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
| AF-IM04-WI07-M-001 | Manual | 合成 Workbook 的 exact bytes/hash、stable ID map、合法 Cell Edit、跨 Sheet 拒绝、before/after refs、Diff、replay、cleanup | 审核者可逐项复核；明确标注 `SYNTHETIC / TECHNICAL ONLY` | [`Manual-Workbook-Fixture.md`](../archive/issue-96-delivery/Manual-Workbook-Fixture.md) 已准备自动证据；独立人工复核尚未运行 | `NOT RUN` |

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
| AF-IM04-WI06-M-001 | Manual | synthetic procurement-procedure：exact bytes/hash、Unit tree、allowed edit、out-of-scope deny、before/after refs、Diff table、replay、cleanup | 审核者可独立复核 Human Edit 与 Diff 的输入/输出和清理边界；不代表真实业务政策验收 | [`Manual-ART-024.md`](../archive/issue-95-delivery/Manual-ART-024.md) 已生成，包含 base/after bytes、Hash、tree、拒绝矩阵、Diff 和 cleanup；独立人工验收未运行 | `NOT RUN` |

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
- IM-DG-005 的 Canonical Document/Workbook 与 Renderer 路线已获用户批准；WI-01 的 Schema、Hash、Binding Query Contract 回归已通过，WI-02 Application/Persistence 用例已在真实 PostgreSQL Gate 中完成，WI-03 Artifact Root/Branch 业务 Repository/Handler、RLS、CAS、Archive 和回滚已在本文件上方的独立 Gate 中完成，WI-04 Canonical Content Object 已完成并通过真实 PostgreSQL Gate；WI-05 Revision/Lineage/Branch CAS/显式 Merge 已完成实现与本地验证，具体命令、计数和未运行边界见 [`Verification-Report.md`](../archive/issue-94-delivery/Verification-Report.md)；PR #110 已合并、Issue #94 已关闭、原 feature branch 已删除。
- WI-02 的历史 Gate 记录为 PostgreSQL 18.6 / Flyway 11.20.3、22 个文件、268 个测试；WI-03 最终独立 Gate 记录为 23 个文件、272 个测试。最新完整 `pnpm verify` 的静态阶段通过，但 Persistence 子阶段因 Docker Hub token `EOF` 未启动，详见本次 Issue #92 [`Verification-Report.md`](../archive/codex-issue-92/Verification-Report.md)。
- 静态设计 Gate：`DESIGN VERIFIED`；本次 WI-03 的实现与验证摘要见 [`Verification-Report.md`](../archive/codex-issue-92/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| AF-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| AF-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

Revision/Content Object、对象存储、Renderer、跨模块业务 E2E、人工验收与 payload↔hash 业务 Link Gate 仍为 `NOT RUN`。

## IM-05 WI-05 Renderer/Representation 组合用例（Issue #125）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-IM05-WI05-I-001 | Integration/Persistence | IntegrationGateway owning Repository 返回真实 `SUCCEEDED` Binding，Registration 精确匹配 | 既有 Handler 登记一个 immutable Representation；Query readback 与 output checksum/renderer/locator 一致 | `artifact-representation.test.ts` 使用本轮真实 Renderer/Repository Binding 调用既有 `handleRegisterRepresentation`，并读回 Representation、Validation、3 条 Reference Edge 与成功 Outbox | `PASS` |
| AF-IM05-WI05-I-002 | Integration/Negative | 替换 revision/content/input/format/renderer/output checksum/scope/Raw Receipt，或 Binding 为 FAILED/UNKNOWN/contract-invalid | 返回既有稳定 Representation binding 错误；无 Representation/validation/outbox/edge 半成品 | 本轮 live Binding 正例与既有 revision/input/format/renderer/checksum/scope/receipt/非成功状态 fail-closed 矩阵共同通过；故障回滚无半成品 | `PASS` |
| AF-IM05-WI05-I-003 | Architecture | Artifact 组合只注入 `RenderAttemptBindingQueryPort` | Artifact 不导入 IntegrationGateway Repository，不跨 Schema SQL；Architecture Gate 通过 | `architecture_boundaries=PASS source_roots=10`；IntegrationGateway app 直接读取 Artifact Schema 返回 `42501` | `PASS` |
| AF-IM05-WI05-M-001 | Manual | 脱敏 DOCX/XLSX 的 exact Revision、Attempt、Binding、Representation、input/output hash 清单 | 审核者可独立复核身份与 checksum；不把文件可打开性写成 Quality/Approval/Release PASS | input hashes 为 Document `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7`、Workbook `e3e0f7357a3fcd6c18063081128913b0cd8983e75d6455d4aa6664284f30a818`；Office 打开与输出 checksum 本地复核通过，临时文件已删除；未产生 Quality/Approval/Release/EffectiveBinding | `PASS (LOCAL TECHNICAL OPENABILITY) / INDEPENDENT BUSINESS MANUAL NOT RUN` |


## #233 正式执行输出设计用例

authority为Spec 004 §12；#235当前有限owning/PG证据如下，历史已交付用例不改。

| ID | 层级 / 输入 | 预期 | 实际 / 结果 |
|---|---|---|---|---|
| ART-COMP-D-001 | Contract + Application + PostgreSQL / 授权Human实际root/content创建及新execution revision | 自身/TE独立授权，provenance只用owning Run来源且无未来Result；Revision/binding/真实Receipt同事务，可exact重读canonical内容与current状态 | OWNING/PG PASS：normal/recovered Human真实root/content/stage/link/freeze→execution Revision、creation binding与Receipt；canonical content Hash域保留，exact owning output读回与创建来源镜像独立复验。 |
| ART-COMP-D-002 | Application + PostgreSQL / 旧normal Revision/复用input/伪造Run/Receipt/actor/hash/Scope/schema、binding过期/锁后撤权 | 不提供execution output资格；masked NOT_FOUND/绑定错误；SEALED不可补ResultRef，不跨Schema查询/写表 | CONTRACT/APPLICATION/PG PASS（已执行）：Human-only实际AGENT/SERVICE/actingFor有Grant仍DENY，借Human Decision protected SQL为0；premature未提交Ref/Receipt拒绝；错误source/Scope/Hash/schema拒绝。逐一锁后撤权与全部旧normal Revision消费子项NOT RUN。 |
| ART-COMP-D-003 | PostgreSQL / 创建Receipt/binding/Event故障、同键重放、Direct SQL镜像/Hash欺骗、内容withdraw/invalidate | 原子rollback/replay、Hash域分开、RLS/immutable guard；current失效不覆写原snapshot/provenance/receipt | PG/CONTROLLED PASS（已执行）：五个创建原子点故障全rollback，原键replay；actual owning withdraw后Completion REVOKED而历史Revision/Receipt不变；新增有限forward migration。两张新Artifact fact表对真实已存在Revision实际app UPDATE/DELETE 42501、owner immutable 55000、RLS pool跨Scope隐藏/恢复均PASS；全部Direct SQL欺骗置换子项未穷举，NOT RUN；full gate状态见PR。 |

## D12 / Q11 Markdown 表示与bytes读取设计场景（#260）

状态：`PROPOSED / FUTURE DESIGN / NOT REGISTERED / NOT IMPLEMENTED`。对应 [Artifact D12](../module-specs/Module-Spec-004-Artifact.md#d12--q11-精确-markdown-表示与导出读取提案260)。

| ID | 输入 | 预期 | 当前实际输出 / 结果 |
|---|---|---|---|
| AF-D12-001 | exact Canonical Document→登记Markdown Renderer→成功Binding→Representation；跨R1/R2集合 | format/media/UTF-8/input/checksum/renderer/Scope全部权威相等；包使用同一表示bytes，既有contentHash域不变 | 现行Renderer/映射未支持Markdown / NOT RUN |
| AF-D12-002 | caller自报.md、错Revision/renderer/checksum/对象version、篡改bytes、unsupported Workbook/opaque/required结构 | 不登记/不供stream、不生成AVAILABLE；已登记旧Revision/Representation历史保留 | 无新Markdown/bytes Port / NOT RUN |
| AF-D12-003 | bytes读取无权/错purpose/Agent、withdrawn/invalidated/archived、metadata locator直接改URL | owning当前授权拒绝；无额外正文泄漏；元数据Query不是下载许可；本系统无法撤回已复制bytes | 无真实stream/安全验收 / NOT RUN |
| AF-D12-004 | shared Artifact映射多个Item、多个批准版本、Human-only来源无Run/报告，新候选到达 | 文件只一entry，Profile/Scope兼容；显式选一个exact批准版本；来源原样、不伪造执行；新候选不改旧Batch | 无新项目关联消费 / NOT RUN |
| AF-D12-005 | Contract；TR-260-09，仅ProjectRef/Page、零已知文件refs；跨轮次/shared/Human文件、内部获批但无Release、未登记Markdown、无权/跨Project/Enterprise-owned成果 | ART owning发现真实ArtifactView/批准指针/精确登记View，共享文件只一次；无Release仍返回，无表示为空且不造Ref；按当前Human及Reader权限裁剪，无名称/数量泄漏，不读取EP/REL Repository | 无新发现Port / NOT RUN |
| AF-D12-006 | Pagination/Race；多页/空中间页、多个批准版本与表示、伪造/过期cursor、获批绑定或表示登记水位变化、发现索引过时、Guard超限 | 共享Page元数据及稳定身份顺序，有cursor继续；实际owning读回后再由REL逐项重验；读切面变化拒绝旧cursor，不能遗漏版本/复制shared成果或静默截断，不新增批准/发布事实 | 无新发现分页/重验实现 / NOT RUN |

## Markdown 内容、候选与定位设计场景（#259）

字段权威为 [ART §13](../module-specs/Module-Spec-004-Artifact.md#13-markdown-候选定位与表示提案259)，完整步骤及fixture来源见 [MF traces](../decisions/markdown-file-feedback.md#8-设计-trace-与真实来源)。以下是SYNTHETIC / DESIGN TRACE，未写实现测试；历史ART证据不变，实际/结果全部NOT RUN。

| ID / 层次 | 输入 / 故障 | 可核验预期 | 实际 / 结果 |
|---|---|---|---|
| ART-MF-001 / Contract + Integration | MF-01无Root/Revision/constraints→TE prepare/ART mapping→Human公开get完整map→new range prepare/完整proposal→confirm→IG/TE真实来源→ART first candidate | request/Scope/file/plan/Ref/cv1 Hash及当前读权逐项核；prepare/get不创建Root/Revision或盲确认，过期/失权/错hash不能confirm；exactFile/source/template/protection/Result Acceptance逐项核；Parent=[]、完整Canonical、独立sealed Revision/acceptance/Receipt，没有Quality或Completion事实 | 未执行 / NOT RUN |
| ART-MF-002 / Unit + Golden | blank、0、□/☑/√、两个H1、标题编号、alignment、br/硬换行、转义pipe、长中文、CRLF/BOM | raw bytes hash与canonical Hash分域；全部语义/身份render→parse相同；空cell text省略，0为TEXT，无Unicode/空格/字段默认替换 | 未执行 / NOT RUN |
| ART-MF-003 / Negative + Integration | MF-02合法数量改12对照MF-05添金额审批/删总经理栏/改人员/跨file/改KEEP | C2 Parent=C1、完整Diff含metadata/移动/新删Unit且只授权范围；保护关系/原文不变；非法zero content staging/Revision | 未执行 / NOT RUN |
| ART-MF-004 / Contract + Template | 采购程序A/5表1三列表头/五列行、未知HTML/合并单元格/footnote/extension | 原template/source preserved，整文件UNSUPPORTED，不补列/裁表/删历史；独立申请单/评价记录不阻 | 未执行 / NOT RUN |
| ART-MF-005 / Template + Manual | 评价记录五维度、审批“Ⅰ类准入”与编制说明#4、filled record/空签名 | 全部文字/列/适用差异可检查；不可静默专业裁定/模板示例变客户活动或已签批 | 未执行 / NOT RUN |
| ART-MF-006 / Security + Round-trip | 脚本/HTML属性/外链/伪注释ID/重复ID/超限；renderer改blank/0/换行/编号 | UNSAFE/UNSUPPORTED/IDENTITY_INVALID/LOSSY，拒整个candidate；raw保存与受权原因，零accepted部分删减版本 | 未执行 / NOT RUN |
| ART-MF-007 / Diff + Browser | MF-06 36变化/9章，ADDED/REMOVED/CHANGED+MOVED、new/delete/context、宽表 | exact inputs/算法/full diffHash与稳定changeId；total entry与distinctUnit计数分开、跨页/章可定位、不裁列、不当批准证据 | 未执行 / NOT RUN |
| ART-MF-008 / Locator + Security | 删除旧row、同名header、moved unit、错claimHash/Scope/游标/filter或current授权变化 | originalLocation保留；REMOVED/AMBIGUOUS不自动迁移；安全拒绝错绑定、cursor不得续错输入/权限 | 未执行 / NOT RUN |
| ART-MF-009 / Old-base + History | MF-07 B/M/S，S无关变化、同row冲突、current已S2 | 新Parent=S，完整S→C范围校验；冲突待判断无直接merge；若S2到达新candidate仅历史、不覆盖Head | 未执行 / NOT RUN |
| ART-MF-010 / Evidence + Provenance | MF-11真Evidence但source/locator/capturedHash/claim关系错配、旧Run新session | 独立owner读权、精确源/claim核验拒绝；不能用只匹配Evidence ID或Runner自报补齐 | 未执行 / NOT RUN |
| ART-MF-011 / PostgreSQL + Fault | source/bytes readback、link/finalize UNKNOWN；seal事务各点故障、同键/异hash、Head CAS竞争 | FROZEN前不seal；seal/acceptance/Receipt原子；原键不重复；Head失败保留不可变历史、零覆盖winner | 未执行 / NOT RUN |
| ART-MF-012 / Representation + HTTP | MF-12 request_markdown_render@1.0 exactrender→registration→download；wrong originalOperation/Revision/profile/renderer/checksum、UNKNOWN、撤权/stream中断 | 只核真实新operation的successful Binding登记，旧request_render来源或自报operation拒绝，raw非Representation；当前权限+ticket+实际bytes完整；safe attachment/no-store、下载不Approval/Release | 未执行 / NOT RUN |

ART-MF-001/003补充：首次scope校验使用完整sourceMapping→candidate而非EMPTY diff；template-derived空白表无内容变化但有完整CREATE计划可建立首Revision。C1→C2/C3复用同Artifact合法lineage的稳定约束，不因原NEW起点再创建Root；current已S2时旧S请求STALE，锚/范围/保护改变需显式新constraints确认。此补充仍NOT RUN。

## 已实现的 Markdown 技术子用例（#270）

实现权威为 [ART §13.6](../module-specs/Module-Spec-004-Artifact.md#136-已实现的技术管线与证据270)。下表只把 #270 实际执行的技术子用例标为 PASS；上表 ART-MF-001～012 的整行仍为 `NOT RUN`，不因本节升级。

| ID / 归属 | 输入 | 可核验预期 | 实际 / 结果 |
|---|---|---|---|
| ART-MF-002-T1 / Unit + Golden | 已检入 `application.md`（`7aa43be…e42b`）、`evaluation.md`（`72c9a6a…c21f`）原 bytes | 原 bytes SHA-256 与解析分离；空白 cell 省略 text 且 `valueState=BLANK`，文本 `0` 保持 `TEXT`；两份文件 `parse→render→parse` 得到同一 tree、身份与 cv1 contentHash | 已执行 / PASS（Draft 前的配置目标 `code`；`full` 结果见本修订 PR） |
| ART-MF-002-T2 / Unit | 聚焦 fixture `wide-table.md`、`repeated-labels.md`、`ordered-markers.md`、`blank-versus-zero.md`、`hard-breaks.md`、`unicode-placeholders.md`、`escaped-pipes.md` | 宽表 12 列含 LEFT/CENTER/RIGHT/NONE alignment；重复标签/重复行不合并；原编号 `5.`/`1)` 保留；`<br>`/两空格/反斜线硬换行映射 LF+HARD_BREAK；`□`/`Ⅰ`/`[日期]` 原样保留；`\|` 保留为 cell 文本 | 已执行 / PASS |
| ART-MF-004-T1 / Template + Round-trip | 采购程序 `procedure.md`（`3bd0ce1…01ba`）原 bytes | 表 1 表头 3 列、数据行 5 列的 ragged table 使整份文件显式拒绝（`ARTIFACT_MARKDOWN_UNSUPPORTED`），原件保留、不补列/裁列 | 已执行 / PASS |
| ART-MF-006-T1 / Security + Round-trip | `ragged-table.md`、`unsafe-html.md`、`unsafe-link.md`、`front-matter.md`、`code-fence.md`、`blockquote.md`、`nested-formatting.md`、`footnote.md`、`malformed-utf8.md` 及 indented code/setext 输入 | 分别返回 `ARTIFACT_MARKDOWN_UNSUPPORTED` / `ARTIFACT_MARKDOWN_UNSAFE`，不产生部分 tree 或候选 | 已执行 / PASS |
| ART-MF-006-T2 / Limits + Identity | 129 列表格、65537 code point 文本、7 层列表、10 MiB+1 byte 文件；错 raw hash/documentId/profile/enterprise、缺项、错 declared type 的 sidecar | limits 返回 `ARTIFACT_MARKDOWN_LIMIT`；身份问题返回 `ARTIFACT_MARKDOWN_IDENTITY_INVALID`；合法 sidecar 完全继承既有 Unit/row/cell/column 身份 | 已执行 / PASS |
| ART-MF-005 / Template + Manual | `evaluation.md` 五评价维度、审批栏、编制说明与 `更新记录` 已填记录 | 全部文字/表格/空签名区与已填记录完整可读（本技术层仅证明无损解析与 round-trip） | 技术子用例已执行 / PASS；独立人工内容验收 `NOT RUN` |

未执行：ART-MF-001/003/007/008/009/010/011/012 的公开 prepare/confirm 读回、候选接纳、Diff/目录/游标、Evidence 错配、PostgreSQL/故障、Representation/download，以及任何 TE/IG 真实 Attempt、OIDC/HTTP、Browser、人工内容验收。
