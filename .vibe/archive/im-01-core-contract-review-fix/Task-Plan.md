> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-01-core-contract-review-fix/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-01-core-contract-review-fix/Task-Plan.md).

# PR #11 Core Contract Schema Review 修复计划

版本：v0.1
日期：2026-08-17
状态：`IMPLEMENTED / AUTOMATED GATES PASS / USER REVIEW PENDING`

## 1. 目标与边界

本轮只修复 PR #11 中能够由现有权威 Contract 直接证明的 Schema 偏差，不新增业务能力，不改变六个 Core Contract 的 Major 版本，不引入 Persistence、Handler、Renderer 或外部集成。

权威输入：

- `.vibe/high-level-docs/03-core-contracts.md`
- `.vibe/high-level-docs/06-typed-references-contract-catalog-v0.1.md`
- `.vibe/api-contract-v0.1/API-Contract-v0.1.md`
- `.vibe/module-specs/Module-Spec-IM01-CoreContracts.md`
- `.vibe/module-tests/Module-Test-IM01-CoreContracts.md`

## 2. 已确认偏差

| ID | 偏差 | 规范依据 | 预期修复 |
|---|---|---|---|
| PR11-RF-001 | `nonEmptySet` 实际没有 `minItems: 1`，同时多个允许“已知为空”的 Set 也错误复用该名称 | API Contract §3；06 §6.1 | 区分 `Set<T>` 与 `NonEmptySet<T>`；只对明确非空的集合设置 `minItems: 1` |
| PR11-RF-002 | `ValueEnvelope` 把 `PRESENT ⇒ value` 与其他 Presence 禁止 `value` 推迟到未来 Validator | 06 §6.2；Issue #1 required 验收目标 | 在 JSON Schema 2020-12 中直接表达条件约束并保持 Ajv strict 可编译 |
| PR11-RF-003 | `ContractHeader.extensions[].payload`、`SourceManifest.externalAuthoritySnapshotRefs`、`ContextItem.value`、`Objective.relatedIssueRefs/deliveryItemRefs` 未按非 optional 定义加入 `required`；Header 的 `schemaRef`/`issuedBy` 引用强度过宽 | 03 §2.2、§3.5、§3.6、§4.4；06 §3.9、§3.11、§7 | 恢复必填字段，并分别收紧为 `VersionedRef<ContractSchema>` 与 `PrincipalRef` |
| PR11-RF-004 | `GateResultRef` 被实现为自定义普通对象，而非规范要求的 `ContentAddressedRef<GateResult>` | 03 §6.3；Module-Spec-005 §3 | Revision/Release Gate Result 集合直接使用 `ContentAddressedRef`；revision hash 绑定仍由引用解析后的跨字段 Validator 校验 |
| PR11-RF-005 | 测试包含预期失败路径上的 `console.error` 调试输出，且没有覆盖以上偏差 | 测试遗留清理约束；08 §7.1 | 删除调试输出，增加必填、条件、引用强度和集合基数回归 |

## 3. 里程碑与人工产出

1. **M1 规格与测试基准订正**：用户可检查本计划、Module Spec 与 Module Test 中的逐项映射。
2. **M2 Schema 最小修复**：用户可检查 `common.schema.ts`、`core.schema.ts` 与 fixture diff。
3. **M3 自动验证**：用户可复跑 focused Vitest 与 `pnpm clean && pnpm verify`，并检查验证报告中的实际输出。

## 4. 完成条件

- PR11-RF-001 至 PR11-RF-005 都有负向或正向回归证据；
- 六个 Core Contract 仍可由 Ajv 2020 strict mode 编译；
- 6 个 golden fixture 与 builder 一致；
- `pnpm clean && pnpm verify` 通过；
- 未执行的 Persistence、E2E、外部和人工验证继续标记 `NOT RUN`；
- 变更保持未提交，等待用户审核。

## 5. 当前验证结果

- Focused：`pnpm exec vitest run contracts/src/core.schema.test.ts` → `1 file / 63 tests PASS`；
- Full：`pnpm clean && pnpm verify` → format、lint、typecheck、`5 files / 86 tests`、architecture、200-operation Catalog/Registry 全部 `PASS`；
- 环境提示：项目要求 Node `24.19.0`，当前执行环境为 `24.13.0`；命令全部通过，但精确版本重跑仍属于用户可选复核；
- Persistence、E2E、外部服务与人工验收：`NOT RUN`；
- Git Commit/Push：未执行，等待用户审核。
