# Module-Test-IM01-CoreContracts

版本：v0.1
日期：2026-08-17
状态：`CORE CONTRACT FIELD-LEVEL TESTS BASELINE / PARTIAL PASS`

对应规格：[`Module-Spec-IM01-CoreContracts.md`](../module-specs/Module-Spec-IM01-CoreContracts.md)。本文件记录六个 Core Contract 与共享 Value Object 的字段级 Schema 测试用例和实际结果。Persistence、E2E、人工验收不在本 Issue 范围内。

## 1. 测试范围

- Schema 实现入口：`contracts/src/common.schema.ts`、`contracts/src/core.schema.ts`。
- 测试入口：`contracts/src/core.schema.test.ts`、`contracts/src/registry.test.ts`（既有）。
- 正向 fixture 落盘到 `tests/fixtures/contracts/core/<contract>-valid.json`。
- 负向 fixture 通过对正向实例做深拷贝 + 字段变异生成（用于未知字段、缺 required、非法 enum、引用强度误用、Set 重复等场景）。

## 2. 共享 Value Object 测试（Design Gate）

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-COM-D-001 | Design | `common` 与 `core.schema.ts` 拆分 | 共享 $defs 唯一依赖 common，无重复或漂移 | `shared_defs=15 contract_local_defs=46` | `DESIGN VERIFIED` |
| CC-COM-U-001 | Unit | `page.items` 接收任意 JSON | 开放 JSON 校验通过 | Ajv 接受混合类型数组 | `PASS` |
| CC-COM-U-002 | Unit | `extension.payload` 接收任意 JSON | 开放 JSON 校验通过 | Ajv 接受任意 JSON | `PASS` |
| CC-COM-U-003 | Unit | `valueEnvelope`：`presence=PRESENT` 但缺 `value` | 应用层 Validator 报错；Schema 层不强制（避免 `allOf` + `strictRequired` 冲突） | Ajv 接受；运行期 Contract Validator 拒绝 | `PARTIAL PASS`（运行期等待 Validator） |
| CC-COM-U-004 | Unit | `SourceWatermark.observedAt` 非 UTC | 拒绝 | `pattern` mismatch | `PASS` |

## 3. ProjectContextContract

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-PC-C-001 | Contract | `tests/fixtures/contracts/core/project-context-valid.json` 全部合法负载 | Ajv 通过 | `valid=true errors=[]` | `PASS` |
| CC-PC-N-001 | Negative | 在 `project-context-valid` 增加 `unknownTopLevel` | `additionalProperties: false` 拒绝 | `keyword=additionalProperties additionalProperty=unknownTopLevel` | `PASS` |
| CC-PC-N-002 | Negative | 删除 `header.correlationId` | `required` 拒绝 | `keyword=required missingProperty=correlationId` | `PASS` |
| CC-PC-N-003 | Negative | `sourceManifest` 增加 `unknownField` | 嵌套 `additionalProperties` 拒绝 | `keyword=additionalProperties instancePath=/sourceManifest` | `PASS` |
| CC-PC-N-004 | Negative | `projection.projectionType = 'NOT_A_PROJECTION'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-PC-N-005 | Negative | `contextItems[0].epistemicState = 'GUESSED'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-PC-N-006 | Negative | 删除 `contextItems[0].kind` | `required` 拒绝 | `keyword=required` | `PASS` |
| CC-PC-N-007 | Negative | `contextItems` 不存在（缺 required） | `required` 拒绝 | `keyword=required missingProperty=contextItems` | `PASS` |
| CC-PC-N-008 | Negative | 同一 `ContextItem.evidenceRefs` 重复 | `uniqueItems: true` 拒绝 | `keyword=uniqueItems` | `PASS` |

## 4. WorkOrderContract

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-WO-C-001 | Contract | `tests/fixtures/contracts/core/work-order-valid.json` 全部合法负载 | Ajv 通过 | `valid=true errors=[]` | `PASS` |
| CC-WO-N-001 | Negative | `targetScope.baseContentRefs[0]` 改为 ObjectRef | ContentAddressedRef 必须 `kind=CONTENT_ADDRESSED` 拒绝 | `keyword=const instancePath=/targetScope/baseContentRefs/0/kind` | `PASS` |
| CC-WO-N-002 | Negative | `expectedOutputs[0].requiredReferenceStrength = 'OBJECTISH'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-WO-N-003 | Negative | `expectedOutputs[0].cardinality = 'WHATEVER'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-WO-N-004 | Negative | `allowedCapabilities[0].extraCapabilityField = 'x'` | 嵌套 `additionalProperties` 拒绝 | `keyword=additionalProperties` | `PASS` |
| CC-WO-N-005 | Negative | 删除 `executionPolicy.maxAttempts` | `required` 拒绝 | `keyword=required` | `PASS` |
| CC-WO-N-006 | Negative | `budget.monetaryLimit.amountDecimal = 'NaN'` | decimalString pattern 拒绝 | `keyword=pattern` | `PASS` |
| CC-WO-N-007 | Negative | `versionPins.skillRefs` 重复 | `uniqueItems: true` 拒绝 | `keyword=uniqueItems` | `PASS` |
| CC-WO-N-008 | Negative | `completionCriteria[0].failureDisposition` 不符合 `namespaceCode` 规则（`BLOCK_UNTIL_SATISFIED`） | `pattern` 拒绝 | `keyword=pattern` | `PASS` |

## 5. AgentResultContract

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-AR-C-001 | Contract | `agent-result-valid.json` 全部合法负载 | Ajv 通过 | `valid=true errors=[]` | `PASS` |
| CC-AR-N-001 | Negative | `submissionKind = 'STREAMING'` | `const 'FINAL'` 拒绝 | `keyword=const` | `PASS` |
| CC-AR-N-002 | Negative | `executionOutcome = 'SUCCEEDED_WHATEVER'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-AR-N-003 | Negative | `findings[0].phantomField = true` | 嵌套 `additionalProperties` 拒绝 | `keyword=additionalProperties` | `PASS` |
| CC-AR-N-004 | Negative | `workspaceOutputs[0].diagnosticOnly = false` | `const true` 拒绝 | `keyword=const` | `PASS` |
| CC-AR-N-005 | Negative | 删除 `provenance.harness` | `required` 拒绝 | `keyword=required missingProperty=harness` | `PASS` |
| CC-AR-N-006 | Negative | `workspaceOutputs[0].outputType` 包含 `-` 不符合 namespaceCode | `pattern` 拒绝 | `keyword=pattern` | `PASS` |

## 6. RevisionAcceptanceSnapshot

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-RA-C-001 | Contract | `revision-acceptance-valid.json` 全部合法负载 | Ajv 通过 | `valid=true errors=[]` | `PASS` |
| CC-RA-N-001 | Negative | `evaluationStage = 'RELEASE_READINESS'` | `const 'REVISION_ACCEPTANCE'` 拒绝 | `keyword=const` | `PASS` |
| CC-RA-N-002 | Negative | `reviewIssueSnapshot.phantomField = 'x'` | 嵌套 `additionalProperties` 拒绝 | `keyword=additionalProperties` | `PASS` |
| CC-RA-N-003 | Negative | `readiness.status = 'MAYBE'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-RA-N-004 | Negative | `gateResultRefs[0]` 缺 `revisionContentHash` | `required` 拒绝 | `keyword=required missingProperty=revisionContentHash` | `PASS` |

## 7. ApprovalBundleSnapshot

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-AB-C-001 | Contract | `approval-bundle-valid.json` 全部合法负载 | Ajv 通过 | `valid=true errors=[]` | `PASS` |
| CC-AB-N-001 | Negative | `approvalRefs[0]` 改为 ObjectRef | `kind=CONTENT_ADDRESSED` 拒绝 | `keyword=const instancePath=/approvalRefs/0/kind` | `PASS` |
| CC-AB-N-002 | Negative | `approvalRequirements[0].phantomField` | 嵌套 `additionalProperties` 拒绝 | `keyword=additionalProperties` | `PASS` |
| CC-AB-N-003 | Negative | `separationOfDutiesResult.outcome = 'PARTIAL'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-AB-N-004 | Negative | `completeness.status = 'APPROVED_LIGHTLY'` | `enum` 拒绝 | `keyword=enum` | `PASS` |

## 8. ReleaseReadinessSnapshot

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| CC-RR-C-001 | Contract | `release-readiness-valid.json` 全部合法负载 | Ajv 通过 | `valid=true errors=[]` | `PASS` |
| CC-RR-N-001 | Negative | `releasePackageRef = { random: 'value' }` | 缺 `kind/objectType/objectId/packageSnapshotRef/packageHash` → `required` | `keyword=required` | `PASS` |
| CC-RR-N-002 | Negative | `releaseRequirements[0].phantomField` | 嵌套 `additionalProperties` 拒绝 | `keyword=additionalProperties` | `PASS` |
| CC-RR-N-003 | Negative | `readiness.status = 'GOGOGO'` | `enum` 拒绝 | `keyword=enum` | `PASS` |
| CC-RR-N-004 | Negative | 删除 `releasePackageRef` | `required missingProperty` | `keyword=required` | `PASS` |

## 9. 静态与工具链

| ID | 输入 | 预期 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| CC-AJV-001 | `pnpm test` | 23 + 45 通过 | `tests=68 passed=68` | `PASS` |
| CC-AJV-002 | Ajv strict mode 编译六个 Core Contract | 无 `strict mode` 报警 | 无警告（`valueEnvelope.if/then` 改为 description 标注后通过） | `PASS` |
| CC-LINT-001 | `pnpm lint` | 无错误 | 通过 | `PASS` |
| CC-FMT-001 | `pnpm format:check` | 通过 | 通过 | `PASS` |
| CC-TC-001 | `pnpm typecheck` | 通过 | 通过 | `PASS` |

## 10. 未执行项

- Runtime Connection、E2E、Persistence、WebSocket/Feishu、Renderer、对象存储、备份恢复、负载与人工验收：`NOT RUN`，原因与既有 `Module-Test-001..007` 一致（IM-01 阶段业务 Handler 尚未实现）。
- `ValueEnvelope` 的运行期完整性（`presence=PRESENT ⇒ value` 强制）由 IM-04 Contract Validator 落地，本 Issue 仅在 Schema description 中明示。
- 跨版本 compatibility fixture 与 Schema-derived Type 派生仍属 IM-01 后续切片（148 个 ENVELOPE_ONLY operation）。

## 11. 测试遗留清理

测试过程中创建的临时 helper 文件已在合并前删除（`pnpm clean` 后 `pnpm verify` 全套通过验证）。无残留脚本或调试 fixture。
