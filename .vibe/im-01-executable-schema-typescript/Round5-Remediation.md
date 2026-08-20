# PR #18 第五轮修复记录

日期：2026-08-20
审查 head：`18e6c41`
目标：修复 `required × dependentRequired` 语义漂移，并让对照测试真正覆盖顶层 `required`。

## 审查意见

| ID | 严重度 | 路径 | 处理 |
|---|---|---|---|
| R5-1 | P1 | `tools/contracts/lib/json-schema-emitter.ts` | 顶层 `required` 中的 trigger 在每个合法分支都视为已激活；只枚举可选 trigger 的子集；仅当不存在 required trigger 时才保留「全部 trigger 缺席」的 base 变体。 |
| R5-2 | P1 | `tests/types/generator-dependent-required.test.ts` | 增加 `required:['A']` + `A -> B`，以及独立规则下 required trigger 漏算 closure 的反例 `{A,C,D}`。 |
| R5-3 | P2 | `Verification-Report.md` | 修正用例计数，并把 `required × dependentRequired` 纳入 IM01-EXE-010 后再保持 PASS。 |
| R5-4 | P2 | `Round4-Remediation.md` | 改为中文，记录已提交 `18e6c41`、已推送、等待第五轮复审的真实状态。 |

## 最小反例

Schema：`{ properties:{A,B}, required:['A'], dependentRequired:{A:['B']} }`

| 值 | Ajv（修复前） | Emitter（修复前） | Emitter（修复后） |
|---|---|---|---|
| `{}` | 拒绝 | 接受（base 把 `A` 写成 `A?: undefined`） | 拒绝 |
| `{A}` | 拒绝 | 拒绝 | 拒绝 |
| `{A,B}` | 接受 | 接受 | 接受 |

独立规则 `{required:['A'], A:[B], C:[D]}` 的 `{A,C,D}`：Ajv 因 A 缺 B 拒绝；若 subset `{C}` 未把 required trigger A 的 closure 算进去，TypeScript 会误接受。

## 验证

1. `pnpm exec vitest run tests/types/generator-dependent-required.test.ts`：38 tests PASS。
2. `pnpm verify`：format / lint / typecheck / test / architecture / contracts:check 全绿（254 tests）。
3. 修复后 `{required:['A'], A:[B]}` 只生成 `{ A: string; B: string }`，不再有 `A?: undefined` 的 base。

## 状态

`REMEDIATED` — 本文件与代码改动在同一提交中推送到 PR #18，等待下一轮复审。
