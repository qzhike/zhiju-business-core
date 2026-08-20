# IM-01 Executable Schema → TypeScript 类型生成 Task Plan

状态：`SLICE IMPLEMENTED / DESIGN VERIFIED / USER REVIEW PENDING`
日期：2026-08-20
执行者：Claude Code 主 Agent

## 1. 范围

Issue #7「IM-01 从 executable Schema 生成稳定 TypeScript 类型」的实现切片。本切片在不动高层基准、模块所有权、PostgreSQL 逻辑边界或飞书/Runtime 专项的前提下，向 contracts 工作流新增确定性 JSON Schema → TypeScript 类型生成器，并把 200 个 operation payload、44 个 query result、6 个 Core Contract 类型和共享 Value/Reference 类型发布到 `contracts/src/generated/types/`。

最终范围：

- 选定并锁定确定性 JSON Schema → TypeScript 生成方案；
- 从已注册 JSON Schema 派生 200 个 operation payload 类型、44 个 query result 类型、6 个 Core Contract 类型以及共享 enum、Value Object、Typed Reference 类型；
- 生成代码按 owner module 分组，提供稳定导出入口，禁止业务模块跨过 `@zhiju/contracts` 公开入口消费内部路径；
- required/optional、closed enum、discriminated union、readonly array/Set 语义和 `exactOptionalPropertyTypes` 都正确表达；
- 对规范明确的 `CanonicalJson` 使用受控 JSON value 类型，不退化成无边界 `any`；
- 把生成器与现有 `contracts:generate`/`contracts:check` Gate 合并；Schema 改动后未重新生成必须让 CI 失败；
- 增加编译级 fixture，证明代表性 Command、Query Result、Event 和 Core Contract 类型可用，非法字段/枚举产生 TypeScript 失败 fixture；
- 记录生成限制，并由运行时 Schema/Domain 校验承担无法表达的部分。

## 2. 交付物

1. `tools/contracts/generate-typescript-types.mts`：纯手写、零第三方依赖的 JSON Schema → TypeScript 生成器；通过 Node 24 内置 `--experimental-strip-types` 直接加载 `contracts/src` 现有 Schema 源文件，避免维护第二份 Schema 副本。
2. `contracts/src/generated/types/{common,core,identity-policy,enterprise-project,task-execution,artifact,quality-governance,release-publication,integration-gateway,index}.ts`：10 个生成文件，构成稳定类型入口。
3. `tests/types/generated-types.test-d.ts`：代表性 Command/Query/Event/Core Contract 的正向 fixture + 关闭 enum/ValueEnvelope/CanonicalJson/required 字段的负向 fixture，全部通过 `pnpm typecheck` 验证。
4. `tests/types/tsconfig.json`：独立的 `.test-d` 类型测试项目，已并入根 `tsconfig.json` 的 Project References。
5. `package.json`：把生成器并入 `contracts:generate`（写盘）和 `contracts:check`（diff Gate）。
6. `.vibe/im-01-executable-schema-typescript/Verification-Report.md`：本切片静态 Gate 证据、生成限制与运行时补足清单。

## 3. 执行步骤与验证

1. 阅读 HL-Spec、Module Spec 与现有 contracts 工作流，确认生成器与既有 Registry/Ajv 体系并行不冲突。
   - 验证：现有 `pnpm contracts:check` 全部通过；新增生成器以独立步骤接入，不修改既有 generator。
2. 选定生成方案：手写 + Node 24 `--experimental-strip-types`。
   - 验证：连续执行两次 `pnpm contracts:generate` 输出字节相同；`pnpm contracts:check` 报告 `typescript_types=PASS`。
3. 编写生成器，处理 Schema → TS 映射规则：additionalProperties:false → 精确属性、required → 必填、enum → string literal union、const → literal、oneOf → discriminated union、uniqueItems → `ReadonlyArray<T>`、`{}` 或带 description 的开 JSON → `CanonicalJson`、allOf 条件约束被运行时承担、TypeScript 顶层导出 `import type` 以满足 `verbatimModuleSyntax`。
   - 验证：`node_modules/.bin/tsc --project tests/types/tsconfig.json` 全部 0 error。
4. 把生成器并入 `contracts:generate`/`contracts:check`。
   - 验证：`pnpm contracts:check` 包含 `public_api_generation`、`typescript_types`、`catalog_registry` 三个 Gate。
5. 编写 fixture：覆盖 IdentityPolicy COMMAND/QUERY/EVENT、EnterpriseProject QUERY、TaskExecution COMMAND（用 closed-enum outcome）、ReleasePublication COMMAND、Core ProjectContextContract、CanonicalJson 受控递归。
   - 验证：`pnpm typecheck` 通过，且每个 `@ts-expect-error` 都触发（TypeScript 编译错误 0 条）。
6. 更新 HL-Spec / README / Verification-Report。
   - 验证：文档引用新的生成器与生成文件，并记录已知生成限制（运行时补足）。

## 4. 任务分配与里程碑

| 里程碑 | 负责 | 产出 | 状态 |
|---|---|---|---|
| IM-EXE-T1 生成器骨架 | 主 Agent | `tools/contracts/generate-typescript-types.mts` 初版 | `DONE` |
| IM-EXE-T2 共享类型 + Core Contract | 主 Agent | `common.ts`、`core.ts` | `DONE` |
| IM-EXE-T3 Module 类型 + 入口 | 主 Agent | 7 个 module 文件 + `index.ts` | `DONE` |
| IM-EXE-T4 与 Gate 合并 | 主 Agent | `package.json` `contracts:generate`/`contracts:check` | `DONE` |
| IM-EXE-T5 编译级 fixture | 主 Agent | `tests/types/generated-types.test-d.ts` | `DONE` |
| IM-EXE-T6 文档与验证 | 主 Agent | `.vibe/im-01-executable-schema-typescript/Verification-Report.md` | `DONE` |

## 5. 人工审核 Gate

用户尚未审核。提交前需提示用户检查：

- `contracts/src/generated/types/` 中 200 payload + 44 result + 6 core contract 的命名空间分组；
- fixture 中的正/负向样例覆盖度；
- `package.json` 中 `contracts:check` 是否同时跑三个 Gate。