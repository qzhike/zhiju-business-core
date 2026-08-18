# Module-Test-005-QualityGovernance

版本：v0.3
日期：2026-08-18
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL SCHEMA IMPLEMENTED 2026-08-18 / PR #13 REVIEW REMEDIATION APPLIED 2026-08-18 / HANDLER E2E NOT RUN`

对应规格：[`Module-Spec-005-QualityGovernance.md`](../module-specs/Module-Spec-005-QualityGovernance.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-API-D-001 | Design | QualityGovernance Module Spec 与 Catalog | 18 Command、8 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=18 queries=8 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| QG-API-S-001 | Schema | 37 个 FULL 操作 Payload/Result Schema 注册到 `ContractRegistry` | Registry `operationCount=200`，本模块 37 项 `FULL`，已覆盖的 Payload/Result 正反向 Fixture 通过 `validateOperation`/`validateOperationResult` | `quality-governance.schema.test.ts` 共 11 个用例全部 `PASS`；Registry operationCount=200，quality-governance FULL=37 | `PASSED` |
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
| QG-API-U-001 | Unit | FAIL GateResult 请求原地改 PASS | 拒绝 `QUALITY_GATE_RESULT_IMMUTABLE`；重跑产生新 Result | 无 Handler 实现 | `NOT RUN` |
| QG-API-U-002 | Unit | 作者在职责分离要求下验证自己的整改 | 拒绝 `QUALITY_SEPARATION_OF_DUTIES_VIOLATION` | 无 Handler 实现 | `NOT RUN` |
| QG-API-U-003 | Unit | AGENT/actingFor Human 提交 APPROVED | 永久拒绝 `QUALITY_APPROVAL_AGENT_FORBIDDEN` | Schema 已在 S-002 拒绝 AGENT principalKind；Handler 仍 `NOT RUN` | `NOT RUN` |
| QG-API-C-001 | Contract | RAS 混入 RELEASE_READINESS Render Gate | stage mismatch；RAS 不 Ready | 无 Schema/Evaluator | `NOT RUN` |
| QG-API-C-002 | Contract | RRS 的 packageHash/checksum 与冻结 Package 不同 | target mismatch；不得用于 Release Authorization | 无 Fixture | `NOT RUN` |
| QG-API-E-001 | E2E | REV-002 FAIL/Issue，REV-003 修复并独立验证 | 旧历史保留；新 Result/Verification/RAS/ABS 全绑定 REV-003 | 无业务实现 | `NOT RUN` |
| QG-API-E-002 | E2E | 已批准 Revision 的 Evidence 撤销 | 新 Snapshot STALE/NOT_READY，触发 Release Impact；历史不删除 | 无跨模块实现 | `NOT RUN` |
| QG-API-M-001 | Manual | REV-002→REV-003 质量链 Fixture | 审核者能区分 Gate、Issue、Verification、Approval、RAS/ABS/RRS | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Schema 层 Contract（QG-API-S-001 ~ QG-API-S-025）均为 `PASSED`；合并 PR #13 review 修复后全项目 144/144；Registry operationCount=200、FULL=152、ENVELOPE_ONLY=48、quality-governance FULL=37。
- 25 个 Quality Schema 用例覆盖：Human Approval 接受、Agent 冒充拒绝、Target hash 校验、Evaluation Stage 枚举、Gate Result Event 校验、敏感字段泄漏、Result `additionalProperties` 拒绝、Gate/Approval 形态差异、owner/producerModule 一致性、envelope 字段约束、Common `representationRef` 正反例、Common `principalRef` 正反例、三个 revoke/invalidate Command 直接字段、required `releaseRequirements`、Common `pageRequest`/`opaqueCursor` 正反例、三个 Snapshot Query Result 复用 Core Contract golden fixture + 截断拒绝。
- Unit/Contract/E2E/Manual：`NOT RUN`，原因是 Gate Evaluator、Profile Registry、Readiness Evaluator、Persistence 与 Handler 实现均不存在；本阶段未声明 CLI 或 DB E2E 已运行。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- PR #13 review 修复（P1.1 `representationRef`、P1.2 Core Contract Result、P1.3 PrincipalRef、P1.4 撤销字段、P2.1 releaseRequirements、P2.2 opaqueCursor、P2.3 HL-Spec）均已在 Schema、Fixture、Registry 与本测试文档中同步。
- 测试遗留：未创建临时脚本或临时测试文件；永久 Fixture 位于 `tests/fixtures/contracts/quality-*.json` 与 `tests/fixtures/contracts/core/*.json`，与生产代码同源管理。
