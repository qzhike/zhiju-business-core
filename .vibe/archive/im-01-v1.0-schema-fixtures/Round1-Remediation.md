> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-01-v1.0-schema-fixtures/Round1-Remediation.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-01-v1.0-schema-fixtures/Round1-Remediation.md).

# PR #19 Round 1 Remediation

日期：2026-08-21
对照：`.vibe/reviews/legacy/Agent-PR19-Code-Review/PR-19-Code-Review.md` 与 PR comment `5358549228`
结论：审查三点均接受，已修订代码（无异议留言）。

## 修复摘要

1. **Structural diff 静默忽略约束**
   - `compareSchemaNodes` 现比较 `uniqueItems` / `format` / `propertyNames` / `not` 等断言，并对未建模关键字 fail-closed（`unknown-keyword-changed`）。
   - 新增 breaking-schema 夹具与单测覆盖审查给出的四个反例。

2. **manualReviewFingerprint 全 null**
   - 新增受版本控制的 `contracts/registry/operation-compatibility-metadata.v1.json`（200 条：authorizationPurpose / dataClassification / semanticDeclaration）。
   - `loadCurrentOperationRecords` 计算非空 SHA-256 fingerprint；基线已重写操作索引。
   - 单测覆盖：生产加载路径 200 非空；修改真实 metadata 后默认 `MANUAL_REVIEW_REQUIRED`；APPROVED 仅放行人工项。

3. **历史 Event 未用冻结 Schema**
   - 新增 `HistoricalBaselineRegistry`，从 `contracts/baselines/v1.0/**` 装载冻结 Schema/操作索引并校验 Event。
   - 回归证明：冻结路径 PASS；对同文档 payload def 注入 required 后的 throwaway 图 FAIL；再次走冻结路径仍 PASS。

## 验证

```text
pnpm clean && pnpm verify → PASS
Tests  279 passed (279)
compatibility=PASS baseline=v1.0 operations=200 schemas=14
```
