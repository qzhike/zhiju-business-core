# IM-01 Executable Schema → TypeScript 类型生成 验证报告

日期：2026-08-20（初版），2026-08-20（第二轮 review 修订），2026-08-20（第三轮 review 修订：真实 emitter 与 Ajv 一致性测试），2026-08-20（第四轮 review 修订：subset 互斥 trigger + tsc compiler API oracle），2026-08-20（第五轮 review 修订：required × dependentRequired）
环境：macOS/zsh，Node.js v24.19.0，pnpm 11.19.0
状态：`SLICE IMPLEMENTED / DESIGN VERIFIED / STATIC GATE PASS / PR #18 ROUND 5 REVIEW REMEDIATED / USER REVIEW PENDING`

## 1. 验证范围

本报告验证 Issue #7 切片：

- 选定并锁定确定性 JSON Schema → TypeScript 生成方案；
- 从已注册 JSON Schema 派生 200 个 operation payload、44 个 query result、6 个 Core Contract 与共享 enum/Value/Reference 类型；
- 生成器与现有 `contracts:generate`/`contracts:check` Gate 合并；
- 增加编译级 fixture；
- 记录无法无损表达的规则，并保证这些规则仍由运行时 Schema/Domain 校验承担。

报告不验证：业务 Handler、数据库、对象存储、飞书/Runtime、Renderer、人工业务验收。

## 2. 静态 Gate 结果

| Gate | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| IM01-EXE-001 | contracts/src 生成入口 + 10 个 module 文件 | TypeScript 严格模式编译通过 | `tsc --project tests/types/tsconfig.json` exit 0 | `PASS` |
| IM01-EXE-002 | 200 个 FULL operation payload | 生成器输出 200 payload、44 query result、6 Core Contract | `typescript_types=PASS payloads=200 query_results=44 core_contracts=6` | `PASS` |
| IM01-EXE-003 | 两次连续 `pnpm contracts:generate` | 字节级相同输出 | `diff` 输出为空 | `PASS` |
| IM01-EXE-004 | `contracts:check` 包含三道 Gate | public_api + typescript_types + catalog_registry 全部 PASS | `public_api_generation=PASS operations=200` `typescript_types=PASS ...` `catalog_registry=PASS catalog=200 registry=200 schema_status={"FULL":200}` | `PASS` |
| IM01-EXE-005 | fixture 正负向 | `@ts-expect-error` 全部触发，正向无错 | `pnpm typecheck` exit 0，错误数 0 | `PASS` |
| IM01-EXE-006 | HL-Spec 第 7 节当前阶段状态 | 同步说明 IM-01-executable-schema 子切片已完成 | `README.md`、`HL-Spec` 第 7 节已更新 | `PASS` |
| IM01-EXE-007 | 模块内部路径不外泄 | 业务模块只能从 `contracts/src/generated/types/index.js` 入口消费 | generator 不输出 cross-module `import`；消费侧 fixture 只通过 `@zhiju/contracts` 入口断言（`import type { ... } from '@zhiju/contracts'`），未直接读取 `generated/types/*.ts` 内部路径 | `PASS` |
| IM01-EXE-008 | 整 Core Contract 引用不被折叠为 `ContractHeader` | `ExecutionFreezeWorkOrderPayload.workOrderContract` 等字段映射到 `Core.WorkOrderContract` 等顶层类型 | `task-execution.ts` 中 `workOrderContract: Core.WorkOrderContract`；`quality-governance.ts` 中 `RevisionAcceptanceResult = Core.RevisionAcceptanceSnapshot`、`ApprovalBundleResult = Core.ApprovalBundleSnapshot`、`ReleaseReadinessResult = Core.ReleaseReadinessSnapshot`；fixture 包含正负向探针 | `PASS` |
| IM01-EXE-009 | `dependentRequired` 不静默丢失 | `Common.ScopeRef` 在 `projectId` 存在时强制 `enterpriseId` 同时存在 | fixture 中 `{ projectId: uuid }` 触发 `@ts-expect-error` | `PASS` |
| IM01-EXE-010 | `dependentRequired` 传递闭包、独立 trigger，以及 `required × dependentRequired`（**真正调用 emitter + tsc oracle**） | 链式 `{ A: [B], B: [C] }`、独立 `{ A: [B], C: [D] }`、`required:['A']` + `A -> B`、独立规则下 required trigger 的 closure，emitter 接受集合均与 Ajv 一致 | `tests/types/generator-dependent-required.test.ts` 对每个样例同时断言 Ajv 与 TypeScript compiler API（`exactOptionalPropertyTypes`）结果相等。覆盖 33 个 schema × value 用例（chain 8 + independent 13 + required-trigger 4 + required-independent 8）+ 4 个 shape smoke + 1 个 live ScopeRef 确定性调用，共 38 tests。含反例 `{A,B,C}`（缺 D）和 `required:['A']` 下的 `{}` / `{A}` / `{A,C,D}` | `PASS` |
| IM01-EXE-011 | `dependentRequired` 中无意义条目（指向未声明属性） | 静默忽略，不产生死代码变体 | `expandDependentRequired` 过滤 `knownProperties` 之外的 key；vitest 跑合成 schema 验证仅声明的属性参与闭包 | `PASS` |
| IM01-EXE-012 | emitter 与主生成器共用同一份代码 | generator 主程序与 vitest fixture 都 import `tools/contracts/lib/json-schema-emitter.ts`，无第二份实现 | fixture 通过 `--experimental-strip-types` 加载同一 emitter 模块；Ajv 真实运行确认其语义 | `PASS` |

## 3. 关键命令与输出

```text
$ pnpm contracts:check
public_api_generation=PASS operations=200
typescript_types=PASS payloads=200 query_results=44 core_contracts=6
catalog_registry=PASS catalog=200 registry=200 schema_status={"FULL":200}

$ pnpm typecheck
（无输出，exit 0）

$ node --experimental-strip-types tools/contracts/generate-typescript-types.mts
typescript_types=UPDATED payloads=200 query_results=44 core_contracts=6
```

文件清单：

- `tools/contracts/generate-typescript-types.mts`：生成器主程序（schema 加载 + 写盘）
- `tools/contracts/lib/json-schema-emitter.ts`：纯函数 emitter 库，与生成器主程序和 vitest fixture 共享同一份代码
- `contracts/src/generated/types/common.ts`：53 个共享 enum/Value/Reference 类型 + `CanonicalJson`
- `contracts/src/generated/types/core.ts`：6 个 Core Contract 顶层 + 50+ 内部结构
- `contracts/src/generated/types/{artifact,enterprise-project,identity-policy,integration-gateway,quality-governance,release-publication,task-execution}.ts`：每个 module 的共享类型 + 200 payload + 44 result
- `contracts/src/generated/types/index.ts`：公开入口
- `contracts/src/index.ts`：根包入口，重导出 `CanonicalJson` 与 8 个 namespace
- `tests/types/generated-types.test-d.ts`：代表性正负向 fixture（Command/Query/Event/Core Contract/ScopeRef）
- `tests/types/generator-dependent-required.test.ts`：vitest fixture，调用真实 emitter，并以 Ajv + TypeScript compiler API 双 oracle 对照接受集合；覆盖链式、独立 trigger、以及 `required × dependentRequired`（含 `required:['A']` 下 `{}` / `{A}` 被双方拒绝、`{A,B}` 被双方接受，以及独立规则 `{A,C,D}` 漏算 closure 反例）；live `common.scopeRef` 连续两次 emit 确定性断言
- `tests/types/tsconfig.json`：独立 typecheck 项目

## 4. 生成规则与限制

### 4.1 已正确表达

- `additionalProperties: false` → 精确属性 interface，无索引签名；
- `required` → 必填；非 required → optional `?`，满足 `exactOptionalPropertyTypes`；
- `enum` → string literal union；
- `const` → 字面量类型；
- `oneOf` 中同一字段有 `const` 的不同值 → discriminated union；
- `array` + `uniqueItems` → `readonly T[]`（Set 语义由运行时 Ajv 维持）；
- `array` → `readonly T[]`；
- 开放 JSON 通过 `{ description: ... }` 或 `{}` 表达 → 受控递归 `CanonicalJson`；
- `$ref` 跨 `common`/`core`/module 命名空间正确解析；
- 6 个 Core Contract 顶层类型作为 `Core.ProjectContextContract` 等命名空间导出；
- 整 Core Contract 引用（如 `ExecutionFreezeWorkOrderPayload.workOrderContract`）映射到 `Core.WorkOrderContract` 等顶层类型而非折叠为 `Common.ContractHeader`；
- `dependentRequired` 通过 discriminated union 变体表达：`Common.ScopeRef` 在 `projectId` 存在时强制 `enterpriseId` 同时存在；
- `dependentRequired` 计算传递闭包：链式 `{ A: [B], B: [C] }` 生成 `base | withA(A,B,C) | withB(A?,B,C) | withAB(A,B,C)`；独立 `{ A: [B], C: [D] }` 生成 `base | withA(A,B,C?:undefined,D?) | withC(A?:undefined,B?,C,D) | withAC(A,B,C,D)`，单-trigger 分支禁止未选中的 sibling trigger，避免 `{A,B,C}` 这类 Ajv 非法组合被 TypeScript 接受；
- `required × dependentRequired`：顶层 `required` 中的 trigger 在每个变体上视为已激活并展开其 closure。`{required:['A'], A:[B]}` 只生成 `{A,B}`，不再有把 `A` 写成 `A?: undefined` 的 base，因此 `{}` 被 TypeScript 与 Ajv 同时拒绝；独立规则 `{required:['A'], A:[B], C:[D]}` 生成 `withA(A,B,C?:undefined,D?) | withAC(A,B,C,D)`，`{A,C,D}` 因漏 B 被拒绝；
- `dependentRequired` 中指向未声明属性的条目被静默忽略（不生成死代码变体）。

### 4.2 已知生成限制（由运行时承担）

- JSON Schema 的 `pattern`、`format`、`minimum`、`maximum`、`minLength`、`uniqueItems` 等值域约束不会出现在 TypeScript 类型中。生成器忠实输出结构，但运行时验证（Ajv 2020 strict）仍然是唯一权威。
- JSON Schema 的 `allOf` 条件约束（如 `ValueEnvelope` 的 `presence=PRESENT ⇒ value required`）不会成为 TypeScript 类型的一部分；生成器保留 `properties`/`required` 作为静态形状，运行时 Ajv 仍然强制 if/then/else 规则。
- `Page<T>` 的泛型 `T` 在 JSON Schema 中无表达；`Page.items` 当前是 `CanonicalJson[]`，应用层需要按上下文解析为具体 View。
- `extensions.payload` 等明确开放 JSON 的字段，按 `CanonicalJson` 处理；Extension Type schema 在注册时由业务层强制。
- `additionalProperties: false` 的子结构如果包含 schema-level 条件（`if/then/else`），条件只影响运行时验证，不在类型中出现。

### 4.3 不替换的运行时职责

- Ajv 2020 strict 仍然是 Schema 验证入口：`ContractRegistry.validateOperation/validateOperationResult/validateCoreContract`。
- `Module-Spec-IM01-CoreContracts §7` 列出的 5 处开放 JSON 节点（`common.valueEnvelope.value`、`common.page.items`、`common.extension.payload`、`workOrder.constraints[] items`、`agentResult.inputRequestProposals[].expectedAnswerSpec`）由运行时 validator 兜底，本切片不试图用 TS 类型替代。

## 5. 未执行项

- 6 个 Runtime additive Command 的 Catalog/Schema/Module 变更（IM-DG-006 仍未决）；
- IM-02 至 IM-09 实施里程碑；
- 真实 PostgreSQL/对象存储/飞书/三个 CLI/Renderer/备份恢复/负载/人工验收；
- IM-DG-005/006 用户决策。

## 6. 剩余风险

1. 生成器是项目内手写实现；若未来 JSON Schema 引入新关键字（如 `prefixItems`、`$dynamicRef`），需要扩展 `schemaExpression` 才能保持兼容；提交前需在契约评审中确认。
2. `noUncheckedIndexedAccess` 启用时，TypeScript 测试 fixture 在引用 `activeBaselineResult.templateBaselineRef` 时需要显式解构或 `!`，因为 `string|undefined` 是合法索引访问结果。生成器本身不受影响。
3. 生成类型采用命名空间 `Common.*` / `Core.*` / `<Module>.*` 分组；这是公开 API 设计决策，业务侧导入 `index.ts` 后即可使用全部类型，无需深路径。如果未来需要放宽（如允许 ESM tree-shaking），需要重新审视。
4. 当前 fixture 覆盖代表性 8 个 operation 类型（7 个在 `generated-types.test-d.ts`：Command `identity.register_principal`、Query `identity.resolve_principal`、Query `project.get_active_baseline_refs`、Command `execution.create_task`、Command `execution.record_information_delivery`、Command `release.start_publication_attempt`、Event `identity.PrincipalRegistered`）+ 1 个新增 Command `execution.freeze_work_order`（整 Core Contract 引用回归）+ 2 个 Core Contract（`ProjectContextContract`、`WorkOrderContract`）+ `Common.ScopeRef`（dependentRequired）+ vitest 38 tests：33 个 schema × value 用例（chain 8 + independent 13 + required-trigger 4 + required-independent 8）以 Ajv 与 TypeScript compiler API 双 oracle 覆盖真实 emitter 的接受集合，另有 4 个 shape smoke 与 1 个 live ScopeRef 确定性调用。每个 module namespace 在 fixture 中至少被引用一次以保证不会因命名漂移被静默删除。其余 192 个 operation payload 类型未单独 fixture 覆盖，但都通过相同的生成规则派生。

## 7. Git / PR 状态

PR：`https://github.com/qzhike/zhiju-business-core/pull/18`
分支：`galendai/im-01-executable-schema-typescript`

提交历史：

1. `efb0309 feat(contracts): generate stable TypeScript types from executable schemas (issue #7)` — 初版实现。
2. `1d1e471 fix(contracts): remediate PR #18 review (whole Core Contracts, dependentRequired, public entry)` — 第一轮 review 修复。
3. `2c082da fix(contracts): remediate PR #18 round 2 (dependentRequired closure + independent triggers)` — 第二轮 review 修复。
4. `ac3854e fix(contracts): remediate PR #18 round 3 (real emitter + Ajv parity fixture, refactor to lib)` — 第三轮 review 修复：
   - 把纯函数 emitter 抽到 `tools/contracts/lib/json-schema-emitter.ts`，让生成器主程序和 vitest fixture 共用同一份代码（不再维护第二份算法）；
   - 重写 `expandDependentRequired` 真正递归计算传递闭包（修复 `{A,B}` 缺 C 被误接受的 bug）；
   - 改用 subsets 算法生成所有合法 trigger 组合（独立 trigger 可共存）；
   - 删除手写 `tests/types/generator-dependent-required.test-d.ts`，用 vitest 调用真实 emitter 并用 Ajv 作为 oracle。
5. `18e6c41 fix(contracts): remediate PR #18 round 4 (forbid sibling triggers + tsc/Ajv parity)` — 第四轮 review 修复：
   - 每个 subset 变体禁止未选中且非传递依赖的 sibling trigger（`C?: undefined`），修复独立规则下 `{A,B,C}` 被 TypeScript 误接受的问题；
   - `requiredSet` 与 schema 顶层 `required` 对齐（合成 fixture 传空集）；
   - 每个样例用 TypeScript compiler API（`exactOptionalPropertyTypes`）检查 emitter 接受性，并断言与 Ajv 结果相等；
   - live `common.scopeRef` 确定性 smoke test 改为真实连续两次调用 `renderObject`。
6. 当前提交 `fix(contracts): remediate PR #18 round 5 (required × dependentRequired)` — 第五轮 review 修复：
   - 顶层 `required` 中的 trigger 在每个变体上视为已激活并展开 closure；仅当不存在 required trigger 时才保留「全部 trigger 缺席」的 base；
   - 增加 `required:['A']` + `A -> B` 与独立规则 required trigger 对照用例（`{}` / `{A}` / `{A,C,D}` 被双方拒绝）；
   - 修正 IM01-EXE-010 用例计数（33 个 schema × value + 4 个 shape smoke + 1 个 live determinism = 38 tests）；
   - `Round4-Remediation.md` 改为中文并记录已提交 `18e6c41` 的真实状态。

合并前用户验收项：

- `pnpm verify` 全绿（format/lint/typecheck/test/architecture/contracts:check）；
- `pnpm contracts:generate` 两次输出字节相同；
- HL-Spec §7 / README 反映 IM-01-executable-schema 子切片已完成。