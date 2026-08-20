# PR #19 Round 2 Remediation

日期：2026-08-21
对照：`.vibe/Agent-PR19-Code-Review/PR-19-Code-Review-Round-2.md` 与 PR comment `5358716012`
结论：审查两点均接受，已修订代码（无异议留言）。

## 修复摘要

1. **false COMPATIBLE_MINOR**
   - `multipleOf` 不再按数值大小推断宽窄；任意除数变化 → `BREAKING`（2→1.5 已回归）。
   - `patternProperties` / `prefixItems` / `contains` / `dependentSchemas` / `unevaluatedItems` 改为上下文敏感 fail-closed：任何变化 → `BREAKING`（patternProperties 删除已回归）。
   - `not` / `propertyNames` 仍允许“仅移除约束”的 `COMPATIBLE_MINOR`。

2. **冻结完整 Event envelope**
   - `generate-baseline` 现写入 200 个 `schemas/envelopes/*.schema.json`，并记入 `manifest.envelopeDocuments`。
   - `HistoricalBaselineRegistry` 只加载冻结 schema/envelope，不再导入 live `operationEnvelopeSchema`。
   - 回归：mutated frozen envelope 拒绝历史 Event，而冻结路径仍 PASS；并断言源文件不 import live envelope builder。

## 验证

```text
pnpm clean && pnpm verify → PASS
Tests  283 passed (283)
compatibility=PASS ... envelopes=200 findings=0
```
