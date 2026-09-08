# Module-Test-005-QualityGovernance

版本：v0.9
日期：2026-08-31
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / FIELD-LEVEL SCHEMA IMPLEMENTED / IM-05 WI-01–WI-04 IMPLEMENTATION AND GITHUB DELIVERY COMPLETE / ISSUE #121–#124 CLOSED / IM-05 WI-08 SYNTHETIC QMS EXIT REVIEW DELIVERED PR #139 / EXACT-HEAD CI PASS 2026-08-31 / ISSUE #128 CLOSED / QMS COMPONENT UNIT-CONTRACT-PERSISTENCE EVIDENCE PASS / UNIFIED CROSS-MODULE E2E AND INDEPENDENT MANUAL BUSINESS ACCEPTANCE NOT RUN`

对应规格：[`Module-Spec-005-QualityGovernance.md`](../module-specs/Module-Spec-005-QualityGovernance.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-API-D-001 | Design | QualityGovernance Module Spec 与 Catalog | 18 Command、8 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=18 queries=8 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| QG-API-S-001 | Schema | 37 个 FULL 操作 Payload/Result Schema 注册到 `ContractRegistry` | Registry `operationCount=200`，本模块 37 项 `FULL`，已覆盖的 Payload/Result 正反向 Fixture 通过 `validateOperation`/`validateOperationResult` | `quality-governance.schema.test.ts` 共 31 个用例（QG-API-S-001 ~ S-031）全部 `PASS`；Registry operationCount=200，quality-governance FULL=37 | `PASSED` |
| QG-API-S-002 | Schema | `quality.submit_approval_decision` Payload 的 `approverHumanPrincipalRef.principalKind` 为 `AGENT` | Registry 拒绝，错误指向 `principalKind` | `const` keyword 触发 `/payload/submission/approverHumanPrincipalRef/principalKind` 错误 | `PASSED` |
| QG-API-S-003 | Schema | `quality.record_gate_result` 的 `gateTarget.revisionRef.contentHash.digest` 不是 64 位 hex | Registry 拒绝对应路径 | `pattern` keyword 触发 `revisionRef/contentHash/digest` 错误 | `PASSED` |
| QG-API-S-004 | Schema | `quality.GateResultRecorded` Event 的 `evaluationStage` 为 `APPROVAL` | Registry 拒绝，错误指向 `evaluationStage` | `enum` keyword 触发 `/payload/evaluationStage` 错误 | `PASSED` |
| QG-API-S-005 | Schema | `quality.EvidenceVerified` Event 嵌套 `capturedEvidenceBody` 完整正文 | Registry 拒绝 `/payload` | `additionalProperties` keyword 触发错误 | `PASSED` |
| QG-API-S-006 | Schema | `quality.get_evidence` Result 携带 `capturedEvidenceBody` | Registry 拒绝 Result `additionalProperties` | `additionalProperties` keyword 触发错误 | `PASSED` |
| QG-API-S-007 | Schema | Gate/Approval 字段集合差异 | 两条 Submission 字段集合不可互为子集 | `gateTarget` 仅在 Gate Submission；`approverHumanPrincipalRef` 仅在 Approval Submission | `PASSED` |
| QG-API-S-008 | Schema | `quality.get_evidence` Future 使用 `latest` 修订引用 | `contentAddressedRef` 强制 CONTENT_ADDRESSED kind + 内容 hash，latest 风格被拒绝 | schema `const` kind 校验 + contentHash pattern 双重拒绝 | `PASSED` |
| QG-API-S-009 | Schema | 任一 Quality 操作的 37 个 catalog 名字与实施 Schema 类型一致 | Registry 解析 37/37；Common / Core 引用全部命中 | `contracts/src/operations/quality-governance.schema.ts` 中 `qualityGovernanceOperationContracts` 37 个名字与 `publicApiOperations` 排序集合相等 | `PASSED` |
| QG-API-S-010 | Schema | Quality Command/Query 携带公开 `commandType`/`queryType` 之外的 envelope 字段 | Registry 拒绝 envelope `additionalProperties` | envelope schema `additionalProperties: false` 拒绝 | `PASSED` |
| QG-API-S-011 | Schema | Quality 事件 producerModule 与 owner 不一致 | Event envelope `producerModule: { const: 'quality-governance' }` 拒绝 | `const` keyword 触发 `/producerModule` 错误 | `PASSED` |
| QG-API-S-012 | Schema | REPRESENTATION GateTarget 携带完整 Common `representationRef`（含 checksum/renderer/createdAt） | Registry 接受 | `record_gate_result` Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-013 | Schema | REPRESENTATION GateTarget 缺少 `checksum` / `renderer` / `createdAt` | Registry 拒绝 `representationRef` 子树 | `required` keyword 触发 `representationRef/*` 错误 | `PASSED` |
| QG-API-S-014 | Schema | `quality.verify_evidence.verifier` 使用 Common `principalRef`（`principalKind`+`principalId`） | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-015 | Schema | `quality.verify_evidence.verifier` 使用 ObjectRef 风格 | Registry 拒绝 `verifier` 子树 | `required` keyword 触发 `verifier/*` 错误 | `PASSED` |
| QG-API-S-016 | Schema | `quality.revoke_evidence` Payload 顶层携带 `revocationReason`/`impactAssessmentRef`/`revokedAt` | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-017 | Schema | `quality.invalidate_gate_result` Payload 顶层携带 `invalidationReason`/`impactAssessmentRef`/`invalidatedAt` | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-018 | Schema | `quality.revoke_approval` Payload 顶层携带 `revocationReason`/`impactAssessmentRef`/`revokedAt` | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-019 | Schema | `quality.create_quality_profile_draft` 缺 `releaseRequirements` | Registry 拒绝 | `required` keyword 触发 `definition/releaseRequirements` 错误 | `PASSED` |
| QG-API-S-020 | Schema | `quality.get_gate_results.page.cursor` 长度 16+ 字符符合 `opaqueCursor` 正则 | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-021 | Schema | `quality.get_gate_results.page.cursor` 长度 1 字符 | Registry 拒绝 | `pattern` keyword 触发 `page/cursor` 错误 | `PASSED` |
| QG-API-S-022 | Schema | `quality.get_revision_acceptance_snapshot` Result 接受完整 Core `RevisionAcceptanceSnapshot` | Registry 接受 golden fixture | Core fixture 通过 `validateOperationResult` 返回 `valid=true` | `PASSED` |
| QG-API-S-023 | Schema | `quality.get_approval_bundle_snapshot` Result 接受完整 Core `ApprovalBundleSnapshot` | Registry 接受 golden fixture | Core fixture 通过 `validateOperationResult` 返回 `valid=true` | `PASSED` |
| QG-API-S-024 | Schema | `quality.get_release_readiness_snapshot` Result 接受完整 Core `ReleaseReadinessSnapshot` | Registry 接受 golden fixture | Core fixture 通过 `validateOperationResult` 返回 `valid=true` | `PASSED` |
| QG-API-S-025 | Schema | `quality.get_revision_acceptance_snapshot` Result 仅含 `*SnapshotRef` + `revisionRef` 截断字段 | Registry 拒绝 | `required` keyword 触发 `header`/`snapshotId` 等 Core Contract required 字段 | `PASSED` |
| QG-API-S-026 | Schema | `quality.record_gate_result` 携带 `executionMode=REUSED_BY_IMPACT_ANALYSIS` | Registry 拒绝，`GateResultSubmission` 不允许调用方声明 executionMode | `additionalProperties` keyword 触发 `submission/executionMode` 错误 | `PASSED` |
| QG-API-S-027 | Schema | `quality.record_reused_gate_result` 携带完整 `GateReuseSubmission`（含 `sourceGateResultRef` + `changeImpactRef`） | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-028 | Schema | `quality.record_reused_gate_result` 缺 `sourceGateResultRef` | Registry 拒绝 `reuse` 子树 | `required` keyword 触发 `reuse/sourceGateResultRef` 错误 | `PASSED` |
| QG-API-S-029 | Schema | `quality.record_reused_gate_result` 缺 `changeImpactRef` | Registry 拒绝 `reuse` 子树 | `required` keyword 触发 `reuse/changeImpactRef` 错误 | `PASSED` |
| QG-API-S-030 | Schema | `quality.get_gate_results` 使用空 `gateSpecIds=[]` 与 `outcomes=[]` 过滤集合（Set 而非 NonEmptySet） | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-S-031 | Schema | `quality.propose_issue_resolution` 的 `changedClaimRefs` 为空数组（无内容变更治理处理） | Registry 接受 | Payload 通过 `validateOperation` 返回 `valid=true` | `PASSED` |
| QG-API-U-001 | Unit | FAIL GateResult 请求原地改 PASS | 拒绝 `QUALITY_GATE_RESULT_IMMUTABLE`；重跑产生新 Result | 无 Handler 实现 | `NOT RUN` |
| QG-API-U-002 | Unit | 作者在职责分离要求下验证自己的整改 | 拒绝 `QUALITY_SEPARATION_OF_DUTIES_VIOLATION` | 无 Handler 实现 | `NOT RUN` |
| QG-API-U-003 | Unit | AGENT/actingFor Human 提交 APPROVED | 永久拒绝 `QUALITY_APPROVAL_AGENT_FORBIDDEN` | Schema 已在 S-002 拒绝 AGENT principalKind；Handler 仍 `NOT RUN` | `NOT RUN` |
| QG-API-C-001 | Contract | RAS 混入 RELEASE_READINESS Render Gate | stage mismatch；RAS 不 Ready | 无 Schema/Evaluator | `NOT RUN` |
| QG-API-C-002 | Contract | RRS 的 packageHash/checksum 与冻结 Package 不同 | target mismatch；不得用于 Release Authorization | 无 Fixture | `NOT RUN` |
| QG-API-E-001 | E2E | REV-002 FAIL/Issue，REV-003 修复并独立验证 | 旧历史保留；新 Result/Verification/RAS/ABS 全绑定 REV-003 | 无业务实现 | `NOT RUN` |
| QG-API-E-002 | E2E | 已批准 Revision 的 Evidence 撤销 | 新 Snapshot STALE/NOT_READY，触发 Release Impact；历史不删除 | 无跨模块实现 | `NOT RUN` |
| QG-API-M-001 | Manual | REV-002→REV-003 质量链 Fixture | 审核者能区分 Gate、Issue、Verification、Approval、RAS/ABS/RRS | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 层 Contract（QG-API-S-001 ~ QG-API-S-031）均为 `PASSED`；合并 PR #13 第二轮 review 修复后全项目 150/150；Registry operationCount=200、FULL=152、ENVELOPE_ONLY=48、quality-governance FULL=37。
- 31 个 Quality Schema 用例覆盖：Human Approval 接受、Agent 冒充拒绝、Target hash 校验、Evaluation Stage 枚举、Gate Result Event 校验、敏感字段泄漏、Result `additionalProperties` 拒绝、Gate/Approval 形态差异、owner/producerModule 一致性、envelope 字段约束、Common `representationRef` 正反例、Common `principalRef` 正反例、三个 revoke/invalidate Command 直接字段、required `releaseRequirements`、Common `pageRequest`/`opaqueCursor` 正反例、三个 Snapshot Query Result 复用 Core Contract golden fixture、截断 Snapshot 拒绝、unauthorized `executionMode` 拒绝、`record_reused_gate_result` 正向 + source/impact 缺失双侧反向、空 Set 过滤集合、无内容变更 `IssueResolution`。
- 第二轮 PR #13 review 修复（P1.1 `executionMode` 删除、P1.2 `record_reused_gate_result` 正反例、P2.1 数组 NonEmpty/unique 审计、P2.2 空过滤/无变更正向、P3 doc 计数）均已在 Schema、Fixture、Registry 与本测试文档中同步。
- Unit/Contract/E2E/Manual：`NOT RUN`，原因是 Gate Evaluator、Profile Registry、Readiness Evaluator、Persistence 与 Handler 实现均不存在；本阶段未声明 CLI 或 DB E2E 已运行。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../archive/api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或临时测试文件；永久 Fixture 位于 `tests/fixtures/contracts/quality-*.json` 与 `tests/fixtures/contracts/core/*.json`，与生产代码同源管理。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| QG-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| QG-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

Gate Evaluator、业务 Repository 与 payload↔hash Gate 仍为 `NOT RUN`。

## IM-05 WI-01 Application/Persistence 用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-APP-U-001 | Unit | Canonical Payload、promoted mirror、caller-declared hash、伪造 Envelope attribution | Hash 可重算且镜像精确；错误 hash/mirror/attribution 以稳定错误拒绝 | write guards 与 Context 回归通过；新增 Unit 合计 2 files/5 tests | `PASS` |
| QG-APP-U-002 | Unit | IdentityPolicy/EnterpriseProject/Artifact 精确 Ref Query Port 的匹配与不匹配结果 | 只接受 exact object/scope/version/hash/purpose；失败 fail-closed | 四个公开 operation 名称、exact Ref、过期 Decision 与 cross-project 反例通过 | `PASS` |
| QG-APP-PG-001 | Persistence | same key/same hash 与 same key/different hash | 首次结果重放；不同 hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` 且不泄漏唯一键异常 | committed result 精确 replay；different hash 返回稳定 code；Receipt 保持一行 | `PASS` |
| QG-APP-PG-002 | Persistence | 两个 concurrent writer 使用相同 expected BigInt version | 一个提交并精确递增，一个稳定 `CONCURRENCY_CONFLICT`；无丢失更新 | 1 committed/1 conflict；`9007199254740993 → 9007199254740994` 精确 | `PASS` |
| QG-APP-PG-003 | Persistence | Receipt、callback、Inbox、Process/Step、Audit、Outbox、Reference Edge 后置故障注入 | 正常路径同事务提交；故障路径所有行与 Receipt 全部回滚 | 正常链全部一行且 Inbox=`PROCESSED`；注入故障后七类技术事实与 Receipt 均为 0 | `PASS` |
| QG-APP-PG-004 | Persistence | 缺失/伪造/过期 Context，跨 Enterprise/Project，直接 app SQL、DDL、guard function、owner SET ROLE、跨 Schema SELECT | PostgreSQL RLS/ACL/Role 拒绝，返回可复核 SQLSTATE；guard direct EXECUTE 为 `42501`；不产生越权事实 | 首轮 guard direct call 为 `0A000`；forward-only V5001 后全部负向复验为预期 `42501`，过期 Context 映射为稳定错误 | `PASS AFTER REMEDIATION` |
| QG-APP-PG-005 | Persistence | 空数据库迁移、第二次迁移与测试容器清理 | V5000 与 owning roles 成功应用；第二次 `No migration necessary`；容器删除 | PostgreSQL 18.6/Flyway 11.20.3；32 migrations；29 files/293 tests；second no-op；容器删除 | `PASS` |

本阶段不会运行 Evidence、QualityProfile、GateResult、ReviewIssue、Approval、RAS/ABS/RRS 业务 Handler，也不会运行 Renderer、ReleasePublication、Provider、公开 HTTP、生产或独立人工业务验收。

完整 `pnpm clean && pnpm verify`：Format、Lint、Typecheck、普通 Vitest（34 passed/25 skipped files，395 passed/278 skipped tests）、Architecture、201/201 FULL Contract、冻结 200-operation compatibility baseline 与上述 Persistence Gate 全部通过。

## IM-05 WI-02 Evidence/Profile 测试用例

以下用例冻结了输入、预期输出和证据位置；`当前实际输出` 已按本地代码与 disposable PostgreSQL 验证更新。所有业务事实使用合成技术数据，不代表真实客户 QMS 验收。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-WI02-U-001 | Unit | 缺少 source snapshot、locator、captured content ref 或 captured content hash 的 Evidence Candidate | 拒绝 `QUALITY_EVIDENCE_SOURCE_INCOMPLETE`，不生成 root | `quality-business-validation.test.ts`：空 `capturedContentRef` 被拒绝 | `PASS` |
| QG-WI02-U-002 | Unit | Candidate source Scope、Envelope Scope 或 source hash 不一致 | 拒绝 `QUALITY_EVIDENCE_SCOPE_INVALID` 或稳定 hash mismatch，不泄漏其他 Scope 行 | `quality-business-validation.test.ts`：source object/snapshot Scope 不一致被拒绝；candidate payload hash 计算稳定 | `PASS` |
| QG-WI02-U-003 | Unit | Agent 或非 `deterministic.` Service verifier 提交 VERIFIED | 拒绝 `QUALITY_EVIDENCE_VERIFIER_UNAUTHORIZED` | `quality-business-validation.test.ts`：Agent 与 `manual.*` Service 均被拒绝；trusted Human 通过 | `PASS` |
| QG-WI02-U-004 | Unit | claim hash 改变、Evidence ref hash 替换或缺失 target 的 EvidenceLink | 拒绝 `QUALITY_EVIDENCE_LINK_TARGET_MISMATCH`，旧 link 不改写 | 主要由 persistence exact-hash probe 覆盖；Unit 未单独覆盖 claim hash 变体 | `PARTIAL` |
| QG-WI02-U-005 | Persistence | CONTEXT_ONLY、DISPUTED 或 REVOKED Evidence 用作 SUPPORTS | 拒绝 `QUALITY_EVIDENCE_NOT_VERIFIED` | PG gate：DISPUTED/REVOKED `SUPPORTS` 拒绝；REVOKED `CONTEXT_ONLY` 保留 | `PASS` |
| QG-WI02-U-006 | Unit | Profile gate dependency 存在闭环、未知 gate ID 或无 mandatory gate | 拒绝 `QUALITY_PROFILE_DEPENDENCY_CYCLE` 或 `QUALITY_PROFILE_REQUIREMENT_INCOMPLETE` | `quality-business-validation.test.ts`：闭环与不完整 Gate shape 被拒绝；未知 ID 未单独运行 | `PARTIAL` |
| QG-WI02-U-007 | Unit | 高风险 Profile 缺 Human approval、职责分离策略开放 self-review 或 release requirement 不完整 | 拒绝 `QUALITY_PROFILE_REQUIREMENT_INCOMPLETE` | `quality-business-validation.test.ts`：open separation 与不完整 release requirement 被拒绝；高风险 profile 保留 Human approval | `PASS` |
| QG-WI02-U-008 | Persistence | ACTIVE Profile 的 definition/gate/dependency/approval/release shape 被原地编辑 | 拒绝 `QUALITY_PROFILE_IMMUTABLE` | PG gate：owner root/version update、GateSpec delete 均为 `55000` | `PASS` |
| QG-WI02-U-009 | Unit | activation 事务重新读取的已持久化 definition 缺少 release requirement | 拒绝 `QUALITY_PROFILE_REQUIREMENT_INCOMPLETE`，不调用激活写入口 | Handler 已实现存储 definition 重校验；因 immutable guard 不允许篡改存储行，专门篡改后的运行时分支未运行 | `NOT RUN` |
| QG-WI02-U-010 | Static | WI-02 source/test files and updated authority docs | Prettier, ESLint and TypeScript build/typecheck all pass | `format:check`、`lint`、QualityGovernance build、full typecheck 均通过 | `PASS` |
| QG-WI02-U-011 | Persistence | owner 直接 DELETE Evidence/Profile root 或 append-only history | 由 immutable guard 稳定拒绝，不产生删除 | PG gate：Evidence/Profile root 与 Evidence validation history owner DELETE 均为 `55000` | `PASS` |
| QG-WI02-U-012 | Unit | activation 携带 Project-scoped profileVersionRef 或交换 review/validation snapshot objectType | 拒绝 `QUALITY_PROFILE_SCOPE_INVALID` 或 `QUALITY_PROFILE_REQUIREMENT_INCOMPLETE` | `quality-business-validation.test.ts`：两类输入均被拒绝 | `PASS` |
| QG-WI02-C-001 | Contract | `get_evidence` 使用 exact ContentAddressedRef；错误 objectId、contentHash、Scope 和 `latest/current` 变体 | 只接受 exact ref；所有不匹配 fail-closed，不提供 enumeration signal | PG gate：exact get 成功、错误 hash 统一 `QUALITY_EVIDENCE_QUERY_NOT_FOUND`；Schema gate 拒绝 `latest` 形态 | `PASS` |
| QG-WI02-C-002 | Contract | `get_quality_profile` 使用 exact VersionedRef；ACTIVE 旧版与新 draft version 分别查询 | 返回指定版本；不得把 active pointer 当作 version fallback | PG gate：旧 version 返回 `SUPERSEDED`、新 version 返回 `ACTIVE`，均使用 exact ref | `PASS` |
| QG-WI02-PG-001 | Persistence | capture → exact get → verify VERIFIED → append second verification DISPUTED → revoke | root identity/hash 不变；validation/revocation history 全保留；当前 status 按事实推进 | PG gate：Evidence root hash 与 capturedContentHash 分离，2 validation/1 revocation/2 links，最终 `REVOKED` | `PASS` |
| QG-WI02-PG-002 | Persistence | 正确 Scope/hash 与错误 Scope/hash、source substitution、跨 Project link | 正确请求提交；错误请求稳定拒绝且无越权行/枚举泄漏 | PG gate：错误 exact Evidence hash/query 与 EvidenceLink hash 被拒绝；RLS cross-enterprise count 为 0 | `PASS` |
| QG-WI02-PG-003 | Persistence | CONTEXT_ONLY link、SUPPORTS candidate/disputed/revoked link | CONTEXT_ONLY 可保留；非 VERIFIED supporting link 拒绝 | PG gate：DISPUTED/REVOKED `SUPPORTS` 拒绝，REVOKED `CONTEXT_ONLY` 成功 | `PASS` |
| QG-WI02-PG-004 | Persistence | create draft → activate exact version → attempt edit → create new draft version → activate | ACTIVE 旧版不可变；新策略产生新 version 并绑定自己的 review/validation snapshots | PG gate：旧 version hash/status 保留，新 version 独立激活；activation 校验 version scope mirror；root/version/GateSpec owner 改写均为 `55000` | `PASS` |
| QG-WI02-PG-005 | Persistence | concurrent verify/revoke/activate 使用相同 expected aggregate version | 一个请求提交，其他请求稳定 `CONCURRENCY_CONFLICT` 并回报锁等待后当前 aggregate version；无丢失更新 | PG gate：concurrent Evidence verify 为 1 committed/1 `CONCURRENCY_CONFLICT`，输方回报当前 version `2`；Profile activation race 未单独运行 | `PARTIAL` |
| QG-WI02-PG-006 | Persistence | app role 直接 INSERT/UPDATE/DELETE、guard helper、跨 Scope SELECT；migration second-run | 直接写入/guard helper 调用拒绝；RLS 隔离；业务 mutation function 只经受控执行面；Flyway second run `No migration necessary` | PG gate：app direct DML/helper 为 `42501`，RLS count=0，second migrate 为 `No migration necessary` | `PASS` |
| QG-WI02-PG-007 | Persistence | business write 后注入 callback/audit/outbox 后置故障 | Evidence/Profile business rows 与 Receipt/技术事实整体回滚 | PG gate：business Evidence write 后 `INJECTED_FAULT`，Evidence 与 command receipt 均为 0 | `PASS` |
| QG-WI02-PG-008 | Persistence | `tests/persistence/quality-governance-business.test.ts`：空库迁移后的 Evidence/Profile handler、owner function、RLS、immutable guard、CAS 与 exact query，包括 scope mirror、`RETURNS TABLE` 输出列与内部列名冲突探针 | 真实 PostgreSQL 返回逐项预期结果；无 `ZJU_PERSISTENCE_DATABASE_URL` 时为 `NOT RUN`，不得升级为 PASS | Pinned PostgreSQL 18.6/Flyway 11.20.3：30 files/298 tests PASS，V5002 已应用，容器已清理 | `PASS` |
| QG-WI02-E-001 | E2E | synthetic `QMS_PROCEDURE_HIGH@3` profile、Evidence source/hash、verification、claim links、activation cases | 输出可复核 source/hash/status/history/link/profile version/error/cleanup 表 | 未运行跨模块业务 E2E；本地 PG 仅为 synthetic technical evidence | `NOT RUN` |
| QG-WI02-M-001 | Manual | 审阅 synthetic Evidence/Profile table 与 exact rejection matrix | 审阅者能区分 immutable source、verification history、support/context、active/new version 和 NOT RUN 边界 | 未执行独立人工客户 QMS 审阅 | `NOT RUN` |

## IM-05 WI-03 GateResult/Impact/Readiness 测试用例

以下用例冻结 WI-03 的输入、预期输出和业务边界；在实现与运行前不得把 `NOT RUN` 改为 `PASS`。所有业务数据必须标记为 `SYNTHETIC / TECHNICAL ONLY`。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-WI03-U-001 | Unit | 对已记录 FAIL Result 提交原地 PASS/改 target/outcome/input hash | 拒绝 `QUALITY_GATE_RESULT_IMMUTABLE`；重跑必须产生新 Result | validation Unit 校验 canonical input/hash；PG 场景验证旧 Result 不可变且 rerun 产生新 id/attempt | `PASS` |
| QG-WI03-U-002 | Unit | REUSED gate 声明未经允许的 stage/profile/gate/source result | 拒绝 `QUALITY_GATE_REUSE_NOT_ALLOWED` 或 `QUALITY_GATE_INPUT_MISMATCH` | `quality-gate-validation.test.ts` 覆盖 executionMode 注入、stage mixing、source/impact exact mismatch 和非法 outcome | `PASS` |
| QG-WI03-U-003 | Unit | ChangeImpact coverage 小于 Profile 要求，或 changed section 命中 Gate 输入 | 拒绝 `QUALITY_INCREMENTAL_COVERAGE_INSUFFICIENT`，不产生 reused Result | validation Unit 覆盖 distinct exact revisions；PG 场景覆盖 incomplete coverage 无新 Result | `PASS` |
| QG-WI03-U-004 | Unit | RAS 输入混入 RELEASE_READINESS Gate、FAIL/ERROR、无效 Result 或阻断 Evidence | 输出 `NOT_READY`，包含稳定原因，不写 Artifact 状态 | stage mismatch Unit；PG 场景覆盖 FAIL/invalid Result 的 `NOT_READY` 和 invalidation 后 `STALE`；ReviewIssue/Evidence 跨模块阻断分支保持 `PARTIAL/NOT RUN` | `PARTIAL` |
| QG-WI03-U-005 | Unit | RRS 的 packageHash、Representation checksum/renderer、recipient/destination 与冻结输入不一致 | 拒绝 `QUALITY_RELEASE_PACKAGE_TARGET_MISMATCH` 或输出 `NOT_READY` | validation Unit 覆盖非空 destination；PG 场景覆盖 exact Representation/Package 和 package hash drift；Approval 状态与实际 Renderer 未运行 | `PARTIAL` |
| QG-WI03-C-001 | Contract | exact GateResult/ChangeImpact/RAS/RRS refs 与错误 objectId/hash/scope/latest 变体，以及合法/非法 namespace code | 精确引用通过；错误引用统一 fail-closed，不泄漏 Scope；Contract 失败保留字段级 AJV path | RAS/RRS 输出经 `ContractRegistry` Core contract 验证；非法 namespace 的字段级 AJV path 曾由回归定位并已修正 | `PASS` |
| QG-WI03-C-002 | Contract | `record_gate_result` 的 REVISION_ACCEPTANCE target 携带 Representation/Package 或 RELEASE_READINESS target 缺 Package | 阶段/target 约束拒绝 | validation Unit stage mixing 与 PG stage-specific target checks 通过 | `PASS` |
| QG-WI03-PG-001 | Persistence | record FAIL → exact query → rerun PASS；尝试 update/delete 旧 Result | 旧 Result 保留且不可变；新 Result 独立记录并绑定新 attempt | `quality-governance-gate-results.test.ts` 通过；5 tests，old Result UPDATE/DELETE=`55000` | `PASS` |
| QG-WI03-PG-002 | Persistence | exact ChangeImpact + source PASS + 足够 unchanged coverage 的复用；错误 hash/coverage/source 的复用 | 合法复用创建新 Result/reuse fact；错误输入稳定拒绝且不产生新业务行 | exact reuse 与 incomplete coverage rejection 通过，target 仅保留 1 个 reused Result | `PASS` |
| QG-WI03-PG-003 | Persistence | Invalidate Result，随后重新评估 RAS/RRS；Evidence/Representation/Package/destination 变化 | 旧 Result/RAS/RRS 不改写；新增 invalidation/impact fact 和 `STALE`/`NOT_READY` snapshot | RAS READY→invalidation→新 STALE，旧 READY 保留；FAIL 产生 NOT_READY；RRS package drift 产生 NOT_READY，旧 READY 保留 | `PASS` |
| QG-WI03-PG-004 | Persistence | RLS/ACL、跨 Enterprise/Project、direct app DML/owner append-only update-delete、故障注入 | 直接写入/越权访问拒绝；业务事实与 Receipt/Audit/Outbox/Reference Edge 整体回滚 | direct app insert=`42501`、cross Enterprise zero rows、owner update/delete=`55000`；故障注入后 GateResult/Receipt 均为 0 | `PASS` |
| QG-WI03-PG-005 | Persistence | clean V5003 migration 与 second migrate | 首次成功、第二次显示 `No migration necessary`，容器清理 | formal `pnpm persistence:gate`：34 migrations（含 V5003）成功、second no-op、container removed | `PASS` |
| QG-WI03-PG-006 | Persistence | 空库 V5003 迁移后经 owner function 首次写入 ChangeImpact/GateResult | 六张事实表及函数沿用 `created_authorization_decision_id`；不出现列名不一致或首写失败 | 首轮发现并修复 V5003 列名与既有通用 trigger 不一致；修复后空库首次写入通过 | `PASS AFTER REMEDIATION` |
| QG-WI03-PG-007 | Persistence | 多个独立场景在同一 Enterprise 创建 QualityProfile | 每个 fixture 使用唯一 profile identity/name；既有唯一约束不放宽，场景不互相污染 | 5 个场景均独立创建唯一 profile name，正式 gate 通过 | `PASS` |
| QG-WI03-PG-008 | Persistence/Authority Query | 两条 READY RRS 先通过 current Query；随后分别 invalidates Package Gate、为同 Release 追加更新 RRS、revoke ABS 中的 Approval；以旧 ref 调用 `requireCurrentForAuthorization=true` | 历史查询仍返回旧 READY；授权用途 Query 稳定拒绝；未受影响及最新 READY 正向通过；Gate/ABS/RAS/Approval exact refs 由同一 Quality 事务重验 | disposable PostgreSQL 回归通过：Gate invalidation 后旧 RRS 历史可读但 current 拒绝；同 Release 新 RRS 使旧 ref 拒绝且新 ref 通过；Approval revocation 后最新旧 READY current 拒绝 | `PASS — DISPOSABLE POSTGRESQL AUTHORITY` |
| QG-WI03-E-001 | E2E | synthetic REV-002 FAIL/Issue → REV-003 exact rerun/reuse → RAS | REV-002 历史保留，REV-003 形成 exact `READY` 或预期 `NOT_READY` RAS | 受控 synthetic E2E 待运行 | `NOT RUN` |
| QG-WI03-E-002 | E2E | RRS 绑定 exact DOCX/XLSX Representation 和 frozen package 后变更 checksum/destination | 旧 RRS 保留，新 `STALE/NOT_READY` RRS 与 impact fact 追加 | 受控 synthetic E2E 待运行 | `NOT RUN` |
| QG-WI03-M-001 | Manual | REV-002/REV-003 Gate、Impact、RAS/RRS 表及命令输出 | 审阅者能区分执行、复用、失效、Revision Acceptance、Release Readiness 和 `NOT RUN` | 未执行独立人工客户验收 | `NOT RUN` |

## IM-05 WI-04 ReviewIssue/Approval 测试用例

以下用例冻结 WI-04 的输入、预期输出和业务边界；未取得对应层级的可复核运行证据前不得把 `NOT RUN` 改为 `PASS`。所有业务数据必须标记为 `SYNTHETIC / TECHNICAL ONLY`。当前 validator Unit 为 1 file/7 tests `PASS`；正式 mutable tag→digest PostgreSQL gate 为 32 files/305 tests `PASS`，空库 35 migrations、二次迁移 no-op 和容器清理均完成。普通全量 Vitest 为 37 passed/28 skipped files、416 passed/290 skipped tests。

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-WI04-U-001 | Unit | Blocking Issue、修复 Proposal、作者尝试自验证 | Proposal 可追加；作者自验拒绝 `QUALITY_SEPARATION_OF_DUTIES_VIOLATION`；Issue 不自动关闭 | validator Unit 通过 exact Issue/Resolution/Verification shape；Persistence 通过作者自验拒绝、独立验证和关闭前状态保持 | `PASS` |
| QG-WI04-U-002 | Unit | 未 VERIFIED verification 请求关闭 Issue | 拒绝 `QUALITY_ISSUE_VERIFICATION_REQUIRED`；失败验证历史保留 | Handler/owner function 只接受 exact VERIFIED verification；Persistence 覆盖未验证状态阻断和合法关闭 | `PASS` |
| QG-WI04-U-003 | Unit | Agent 或 actingFor Agent 提交 APPROVED；错误 Revision/RAS/role/hash | 拒绝 `QUALITY_APPROVAL_AGENT_FORBIDDEN` 或 `QUALITY_APPROVAL_REVISION_MISMATCH` | validator Unit 覆盖 Agent principal 拒绝；Persistence Handler 逐一覆盖 AGENT、Service、Runtime trusted Context，即使 payload 声明 Human 也拒绝；exact Human 两次决策和错误 identity/ref 通过 | `PASS` |
| QG-WI04-U-004 | Unit | Open Blocking Issue、FAIL RAS、过期/撤销 Request 或错误 SeparationCheck | Approval 不生效，返回稳定的 Gate/Issue/Requirement/Separation 错误 | Persistence 覆盖 Open Blocking Issue、exact READY RAS、撤销后的 stale ABS 和 Separation；过期 Request/上游失效未单独运行 | `PARTIAL` |
| QG-WI04-C-001 | Contract | exact ReviewIssue/Resolution/Verification/Approval/ABS refs 与 latest/current/hash/scope 变体 | 精确引用通过；错误引用 fail-closed；ABS 输出保留字段级 AJV path | 201/201 FULL Registry、Core ABS Contract validation、Unit exact scope/hash/namespace negative checks 均通过 | `PASS` |
| QG-WI04-PG-001 | Persistence | raise → propose → denied self-verify → independent verify → close | 原始 Issue、Proposal、Verification、状态迁移均保留；新 Revision 不自动关闭 | PostgreSQL gate 覆盖 root/observation/proposal/verification/transition history、作者自验拒绝、独立验证、exact close 和 open-blocking query | `PASS` |
| QG-WI04-PG-002 | Persistence | exact RAS/Requirement 请求 Approval；Agent/actingFor Agent 与错误 refs 决策 | 仅 exact Human 决策可追加；非法决策无 Approval/ABS 生效事实 | PostgreSQL gate 覆盖 exact RAS/Profile/Requirement、AGENT/Service/Runtime trusted-context 拒绝、两名独立 Human、duplicate Human identity conflict、ABS Contract 和错误 ref fail-closed | `PASS` |
| QG-WI04-PG-003 | Persistence | Human APPROVED → ABS → revoke/上游失效 | 原 Decision 与旧 ABS 不变；追加 Revocation/Impact；后续有效性阻断 | PostgreSQL gate 覆盖 partial/full ABS、Revocation、stale ABS/impact、旧 Decision/ABS 保留；独立 upstream invalidation consumer 未运行 | `PARTIAL` |
| QG-WI04-PG-004 | Persistence | app direct DML、owner immutable UPDATE/DELETE、跨 Scope、CAS/race、post-write fault | RLS/ACL/append-only/并发/整体回滚均 fail-closed | PostgreSQL gate 覆盖 app INSERT=`42501`、cross-Enterprise SELECT=0、owner immutable=`55000`、CAS winner/loser、事件和 post-write rollback | `PASS` |
| QG-WI04-PG-005 | Persistence | clean V5004 migration 与 second migrate | 首次成功，第二次显示 `No migration necessary`，容器清理 | 正式 PostgreSQL 18.6/Flyway 11.20.3 完成 mutable tag→digest 校验、`server_version=180006`、空库 35 migrations、second no-op 和容器清理 | `PASS` |
| QG-WI04-E-001 | E2E | synthetic REV-002 FAIL → REV-003 fix/independent verify → Human Approval/ABS | 输出可复核 exact refs/hashes、职责分离、Approval bundle 与边界 | 真实跨模块业务 E2E 未运行 | `NOT RUN` |
| QG-WI04-M-001 | Manual | 审阅 ReviewIssue/Approval/ABS history 与 denied attempts | 审阅者能区分 Agent proposal、Human decision、旧 ABS 保留和未运行边界 | 未执行独立人工客户验收 | `NOT RUN` |

首轮 WI-04 persistence gate 结果：空库迁移成功、`server_version=180006`，随后 `technical-tables` allowlist 发现 V5004 新表未登记，ReviewIssue rollback probe 发现 owner function attribution 参数名错误（`42703`），RAS synthetic fixture 的 Core Contract 断言失败。以上失败均已定位，不能记录为 `PASS`；修复后必须重新运行完整 gate。该历史失败不代表最终结果。

第二轮 WI-04 persistence gate 结果：V5004 参数名和技术表 allowlist 修复后，32 个测试文件中 31 个通过；唯一失败为 synthetic GateResult 夹具的 `evaluatorId=synthetic-gate` 不符合 Common 命名空间正则（禁止连字符）。该轮仍未形成业务 PASS，修正夹具后必须重新运行完整 gate。

随后使用已缓存的 digest-pinned 镜像做本地复现时，RAS 夹具又定位到 `evaluatorVersions[0].evaluatorId=synthetic-readiness` 同样违反该正则；该复现没有通过 gate 的 mutable tag-to-digest 校验，且自定义数据库用户名导致既有 role baseline 出现额外登录角色，不能替代正式门禁结果。以上仅作为失败诊断，不计入 PASS。

修正两个 evaluator 标识后，digest-pinned 本地复现继续到 ReviewIssue 关闭步骤，发现实现把 Common `Justification.reasonCode` 按 namespace code（小写）校验；权威 Common 合同要求其为注册的 upper-snake reason code。该历史实现缺陷已修复；本段记录的是修复前状态。

修正 `reasonCode` 校验后，同一复现又暴露 V5004 `close_review_issue` 内部 `outcome` 输出参数与 `verification_record.outcome` 未限定表别名造成的 PostgreSQL `42702` 歧义。该历史数据库实现缺陷已修复；之后的 pinned-image WI-04 业务 2/2 复现和正式 mutable tag→digest gate 均已通过。

差异审计补充发现 Common namespace 校验仍允许连字符、Approval `requiredCount` 尚未阻止同一 Human 重复计数、Persistence 用例尚未执行 PostgreSQL CAS race；以上是历史待补充测试/修复状态，不计入当时 PASS，后续已补齐并复验。

补充边界首轮已执行：CAS race 已证明一个 committed winner 与一个 `CONCURRENCY_CONFLICT` loser；同一 Human 重复 Approval 已由数据库唯一约束拦截，但应用层暂时把该唯一冲突映射成了错误的 `CONCURRENCY_CONFLICT`，需修正为 `QUALITY_APPROVAL_IDENTITY_CONFLICT` 后再复验。该错误码已修正，最终正式 Gate 已复验通过。

错误码映射修正后，重复身份拒绝的安全摘要已改为描述同一 Request 下已存在的 Human Decision，不再使用 stale aggregate 语义；正式 Gate 已通过。

## IM-05 WI-04 最终验证结果

2026-08-30 最终结果：`node_modules/.bin/prettier --check .`、`node_modules/.bin/eslint .`、`node_modules/.bin/tsc -b --pretty false`、`node tools/architecture/check-boundaries.mjs`、`pnpm contracts:check` 和普通 `node_modules/.bin/vitest run` 均为 `PASS`。普通 Vitest 为 37 passed/28 skipped files、416 passed/290 skipped tests；正式 `node tools/persistence/gate.mjs` 使用 PostgreSQL 18.6/Flyway 11.20.3 完成 tag→digest 校验、`server_version=180006`、空库 35 migrations（含 V5004）、32 passed files/305 passed tests、二次 `No migration necessary` 和容器清理。所有 Persistence 数据为 `SYNTHETIC / TECHNICAL ONLY`。Provider、公开 HTTP、跨模块业务 E2E、生产、Workspace UI、Feishu、真实组织审批和独立人工客户验收为 `NOT RUN` 或表格中的 `PARTIAL`；实现 exact head `e409849443626f91e9bd0064ba3df0b0a7e38897` 已通过 PR #133 exact-head CI run `33313267439`，并以 merge commit `698f9482bd95843df03e01e630545a34564d6bc0` 合入 `main`；Issue #124 已关闭，验收证据见 [Issue #124 comment](https://github.com/qzhike/zhiju-business-core/issues/124#issuecomment-5468884714)。

PR #133 首轮 exact-head CI 结果：静态检查、普通全量 Vitest 和 persistence gate 的前 31 个文件通过；`quality-governance-review-approval.test.ts` 的主流程业务断言未失败，但在 GitHub runner 上运行 `5211ms`，超过 Vitest 默认 `5000ms`，导致该文件 1 failed、其 rollback 测试通过，整个 `verify` 失败。该结果归类为测试时限配置问题，不计为业务语义失败；为该长 PostgreSQL 场景增加显式测试时限后必须重新运行 exact-head CI。

## IM-05 WI-03 本地验证结果

WI-03 本地验证结果（2026-08-30）：`quality-gate-validation.test.ts` 为 1 file/6 tests `PASS`；`quality-governance-gate-results.test.ts` 为 1 file/5 tests `PASS`。正式 `pnpm persistence:gate` 使用 pinned PostgreSQL 18.6/Flyway 11.20.3，完成 tag→digest 校验、`server_version=180006`、空库 34 migrations（含 V5003）、31 files/303 tests、second migrate `Schema "public" is up to date. No migration necessary.` 和容器清理；WI-03 业务场景覆盖 immutable/rerun、exact reuse、coverage rejection、invalidation、RAS/RRS readiness、RLS/ACL、append-only 和 rollback。全量本地检查 `format:check`、`lint`、`typecheck`、`build`、`pnpm test`（36 passed/27 skipped files，409 passed/288 skipped tests）、`architecture`、`contracts:check` 均 `PASS`。所有数据为 `SYNTHETIC / TECHNICAL ONLY`；真实 ReviewIssue/Approval/Renderer/ReleasePublication/Provider、公开 HTTP、跨模块业务 E2E、生产和独立人工客户验收保持 `NOT RUN` 或表格中的 `PARTIAL`。当前尚未 commit/push/创建 PR，等待用户检查确认。

## IM-05 WI-02 本地验证结果

- `modules/quality-governance/src/business/quality-business-validation.test.ts`：1 file / 8 tests `PASS`；覆盖 source custody、scope、candidate hash、Human/Agent/deterministic Service verifier、EvidenceLink scope、Gate DAG、separation、approval/release shape、Enterprise profile ref 与 snapshot objectType。
- `tests/persistence/quality-governance-business.test.ts`：5 个业务场景纳入 persistence gate；覆盖 Evidence capture/replay、exact query/hash、verify/dispute/revoke/history、support/context、QualityProfile activation/new version、CAS、RLS/ACL、owner immutable guard 和 post-write rollback。
- Pinned PostgreSQL 18.6（server `180006`）与 Flyway 11.20.3：空库 V5002 migration、第二次 `Schema "public" is up to date. No migration necessary.`、30 persistence files / 298 tests `PASS`，容器已清理。
- 全量本地检查：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test`（35 passed/26 skipped files，403 passed/283 skipped tests）、`pnpm architecture`、`pnpm contracts:check` 均 `PASS`；Contract Registry 保持 201 operation FULL 与 v1.0 frozen 200-operation compatibility baseline。
- 本地测试数据均为 synthetic technical fixtures；Provider、公开 HTTP、跨模块业务 E2E、生产数据库、真实客户 QMS 和独立人工验收保持 `NOT RUN`。`QG-WI02-U-004`、`QG-WI02-U-006`、`QG-WI02-U-009` 与 `QG-WI02-PG-005` 的未单独覆盖分支已在表格中标记 `PARTIAL`/`NOT RUN`，不将实现存在推断为运行证据。

WI-02 非目标：GateResult evaluation、ReviewIssue、Human Approval decision、Renderer、ReleasePackage、Provider、公开 HTTP、生产、真实客户 QMS 和独立人工业务验收均保持 `NOT RUN`。

## IM-05 WI-08 合成 QMS 退出复核用例

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-WI08-U-001 | Unit/Contract | Evidence/Profile/Gate/Issue/Approval/RAS/ABS/RRS 的 exact Typed Reference、Scope、Hash 和状态边界 | 只接受精确 ref；`latest/current`、caller hash、跨 Scope 和阶段混用 fail-closed | 既有 Quality validation 与 Contract suite 已通过；公开 Query Port 只暴露 exact handler；报告模式不改变业务输入 | `PASS — LOCAL CONTRACT/VALIDATION` |
| QG-WI08-P-001 | Persistence | V5002–V5004 事实历史、作者自验、独立验证、Approval/ABS、revocation/stale、RLS/ACL、CAS、append-only 和 rollback | 历史追加保留；错误 Scope/直接 DML/immutable UPDATE/DELETE/技术故障拒绝并整体回滚 | `pnpm verify` 的 PostgreSQL Gate 为 34 files/314 tests；Quality 业务场景与 WI-04 主流程通过；容器和二次迁移清理通过 | `PASS — DISPOSABLE POSTGRESQL` |
| QG-WI08-E-001 | E2E | `REV-002 / FAIL` → Blocking ReviewIssue → Resolution → 作者自验拒绝 → 独立 Human Verification → `REV-003` exact RAS → 两个 Human Approval → ABS → revocation/stale replay | 新旧 Revision/Issue/Gate/Verification/Approval/ABS 均可按 exact ref 重放；撤销只追加 stale/impact | WI-04 PostgreSQL 主流程覆盖 ReviewIssue、独立验证、Approval/ABS、重复 Human、revocation/stale 和历史 readback；本 WI 增加报告输出，不把各模块测试误报为统一跨模块业务 E2E | `PASS — QMS COMPONENT EVIDENCE / CROSS-MODULE ORCHESTRATION NOT RUN` |
| QG-WI08-E-002 | E2E | Quality RAS/ABS 经公开 Port 交给 Renderer/Release，并在同一业务流程中完成 | 只消费 exact ref；任一上游失效在副作用前拒绝 | 当前没有统一跨模块业务 orchestrator；Artifact/Renderer/Release 以各自公开 Port/受控 fixture 独立验证 | `NOT RUN — UNIFIED CROSS-MODULE E2E` |
| QG-WI08-M-001 | Manual | Reviewer-readable QMS/REL-801 report with exact refs, hashes, expected/actual and cleanup | 审核者可重放历史并清楚区分技术 PASS 与未运行边界 | [`Synthetic-QMS-REL-801-Exit-Report.md`](../archive/codex-issue-128-delivery/Synthetic-QMS-REL-801-Exit-Report.md)；独立业务/客户验收不在本地执行 | `PARTIAL — REPORT READY / INDEPENDENT BUSINESS ACCEPTANCE NOT RUN` |

2026-08-31 GitHub exact-head 验证：WI-08 最终审阅 head `306cdbc3b8c8201994a57097038c4c3f784b0412` 已随 [PR #139](https://github.com/qzhike/zhiju-business-core/pull/139) 合入 `main`，GitHub Actions `verify` run `33355948473` 通过，merge commit 为 `07fc6a083897c01924f842d12dffe06fd6068261`，Issue #128 已关闭。该结果覆盖仓库 Gate，不扩大 QG-WI08-E-002 的统一跨模块业务 E2E 或 QG-WI08-M-001 的独立人工验收范围。

## IM-06 Revision Eligibility 设计用例

| ID | 输入 | 预期 | 结果 |
|---|---|---|---|
| QG-TD-001 | 同Revision精确RAS/ABS及当前有效Gate/Approval | 返回当前资格与精确watermark，历史Snapshot不变 | NOT RUN |
| QG-TD-002 | 历史READY/FULLY_APPROVED但Gate/Approval失效或被撤销 | eligibility=false，不能支持新的TE Completion | NOT RUN |
| QG-TD-003 | 错Hash/Scope/Profile或不请求ABS | 错绑定拒绝；未请求ABS为NOT_APPLICABLE而非true | NOT RUN |
