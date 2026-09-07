> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-01-executable-schema-typescript/Round4-Remediation.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-01-executable-schema-typescript/Round4-Remediation.md).

# PR #18 第四轮修复记录

日期：2026-08-20
审查 head：`ac3854e`
修复提交：`18e6c41`（已推送到 PR #18）
目标：修复第四轮审查中 dependentRequired emitter 与 Ajv 接受集合不一致的问题。

## 审查意见

| ID | 严重度 | 路径 | 处理 |
|---|---|---|---|
| R4-1 | P1 | `tools/contracts/lib/json-schema-emitter.ts` | 每个 subset 变体禁止未选中且非传递依赖的其他 trigger（`triggerKeys - subset - closure(subset)`）。 |
| R4-2 | P1 | `tests/types/generator-dependent-required.test.ts` | 对每个样例用 TypeScript compiler API 比较 emitter 与 Ajv 的接受结果。 |
| R4-3 | P2 | `tests/types/generator-dependent-required.test.ts` | `requiredSet` 与 schema 顶层 `required` 对齐（当时合成 fixture 传空集）。 |
| R4-4 | P2 | `tests/types/generator-dependent-required.test.ts` | ScopeRef 确定性 smoke test 改为真实连续两次调用 emitter。 |

## 当时的反例

独立规则 `{ A:[B], C:[D] }`：值 `{ A:'a', B:'b', C:'c' }`

- Ajv：拒绝（C 存在但缺 D）
- 修复前 emitter：接受（单-A 分支把 C 留成可选字符串）
- 修复后 emitter：拒绝（单-A 分支为 `C?: undefined`）

## 验证（第四轮提交时）

1. `pnpm test`：dependentRequired 套件 24 项通过。
2. `pnpm verify`：format / lint / typecheck / test / architecture / contracts:check 全绿（240 tests）。
3. 已更新 `Verification-Report.md` 的 IM01-EXE-010 说明。

## 状态

`ROUND 4 REMEDIATED / COMMITTED / PUSHED` — 提交 `18e6c41` 已推送到 PR #18。第五轮审查指出 `required × dependentRequired` 仍有语义漂移，见 `Round5-Remediation.md`。
