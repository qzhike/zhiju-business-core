# IM-01 Executable Schema → TypeScript 类型生成 验证报告

日期：2026-08-20
环境：macOS/zsh，Node.js v24.19.0，pnpm 11.19.0
状态：`SLICE IMPLEMENTED / DESIGN VERIFIED / STATIC GATE PASS / USER REVIEW PENDING`

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
| IM01-EXE-007 | 模块内部路径不外泄 | 业务模块只能从 `contracts/src/generated/types/index.js` 入口消费 | generator 不输出 cross-module `import`；消费侧 fixture 只引用 `index.js`/`common.js`/`core.js` | `PASS` |

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

- `tools/contracts/generate-typescript-types.mts`：生成器（手写、无第三方依赖）
- `contracts/src/generated/types/common.ts`：53 个共享 enum/Value/Reference 类型 + `CanonicalJson`
- `contracts/src/generated/types/core.ts`：6 个 Core Contract 顶层 + 50+ 内部结构
- `contracts/src/generated/types/{artifact,enterprise-project,identity-policy,integration-gateway,quality-governance,release-publication,task-execution}.ts`：每个 module 的共享类型 + 200 payload + 44 result
- `contracts/src/generated/types/index.ts`：公开入口
- `tests/types/generated-types.test-d.ts`：正负向 fixture
- `tests/types/tsconfig.json`：独立 typecheck 项目

## 4. 生成规则与限制

### 4.1 已正确表达

- `additionalProperties: false` → 精确属性 interface，无索引签名；
- `required` → 必填；非 required → optional `?`，满足 `exactOptionalPropertyTypes`；
- `enum` → string literal union；
- `const` → 字面量类型；
- `oneOf` 中同一字段有 `const` 的不同值 → discriminated union；
- `array` + `uniqueItems` → `ReadonlyArray<T>`（保留 Set 语义）；
- `array` → `readonly T[]`；
- 开放 JSON 通过 `{ description: ... }` 或 `{}` 表达 → 受控递归 `CanonicalJson`；
- `$ref` 跨 `common`/`core`/module 命名空间正确解析；
- 6 个 Core Contract 顶层类型作为 `Core.ProjectContextContract` 等命名空间导出。

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
4. fixture 仅覆盖代表性 5 个 operation 类型（Command/Query/Event 各 1）、1 个 Core Contract 与 `CanonicalJson`；其余 195 个 operation 类型未单独测试，但都被相同生成规则覆盖，且每个 module 的 namespace 在 fixture 中至少被引用一次以保证不会因命名漂移被静默删除。

## 7. Git 状态

当前分支 `galendai/im-01-executable-schema-typescript` 已包含：

- 新增 `tools/contracts/generate-typescript-types.mts`
- 新增 `contracts/src/generated/types/{common,core,artifact,enterprise-project,identity-policy,integration-gateway,quality-governance,release-publication,task-execution,index}.ts`
- 新增 `tests/types/{generated-types.test-d.ts,tsconfig.json}`
- 修改 `package.json` (`contracts:generate`/`contracts:check`)
- 修改 `tsconfig.json` (新增 tests/types project reference)
- 新增 `.vibe/im-01-executable-schema-typescript/{Task-Plan.md,Verification-Report.md}`

未提交，等待用户确认后由 Claude Code 执行 `git commit` 与 `gh pr create`。