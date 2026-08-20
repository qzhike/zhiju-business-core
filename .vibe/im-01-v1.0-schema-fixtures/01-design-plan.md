# IM-01 v1.0 Schema 兼容性基线设计计划

版本：v0.1
日期：2026-08-20
状态：`APPROVED FOR IMPLEMENTATION`
权威依据：`API-Contract-v0.1.md §9`、`06-typed-references-contract-catalog-v0.1.md §9`、Issue #8

## 1. 目标

把当前已字段级稳定的可执行 Schema 冻结为仓库内可复现的 v1.0 兼容性基线，并在构建期证明：相对该基线的不兼容变更会被拒绝；兼容的 optional Minor 不破坏历史 fixture；无法自动判定的语义/授权变化不得默认 PASS。

## 2. 目录与产物

```text
contracts/baselines/v1.0/
  manifest.json
  operations.index.json
  fixtures.index.json
  schemas/common.schema.json
  schemas/core/*.schema.json          # 6
  schemas/modules/*.schema.json       # 7

tests/fixtures/contracts/compatibility/v1.0/
  positive/**                         # 历史正向（含 core×6）
  negative/**                         # 历史负向 + 未知 Major
  breaking-schema/**                  # checker 规则矩阵夹具
```

## 3. 检查模型

1. **Schema structural diff**：对 common / 6 core / 7 module 文档递归比较；另对 200 条 operation 元数据（type/version/kind/owner/schemaStatus/payload&result ref/manualReviewFingerprint）比较。
2. **判定**：
   - `BREAKING`：required 增删、字段删除、closed enum 变化、类型/约束收窄、additionalProperties 不兼容翻转、union variant 变化、`$ref` 变化、operation 元数据变化等；
   - `COMPATIBLE_MINOR`：新增非 required 可选字段、约束放宽；
   - `MANUAL_REVIEW_REQUIRED`：`manualReviewFingerprint` 变化且 manifest.approvals 无匹配 `APPROVED` 记录（默认 FAIL）。
3. **结构性 BREAKING 不能被 approval 抹掉**；approval 只覆盖人工闸门类。

## 4. Fixture 策略

- 从既有 `tests/fixtures/contracts/**` **复制**历史 payload，并在 `fixtures.index.json` 记录 `source` + `sha256`，防止无感知改写。
- 每个 owner module ≥1 正向 + ≥1 负向；Core 六类均有正向历史 fixture。
- Canonical JSON / Hash：对选定 Core/Event payload 计算并冻结期望 digest；不得改 `shared-kernel` 算法来迁就。

## 5. 工具链

| 脚本 | 作用 |
|---|---|
| `tools/contracts/lib/schema-compatibility.ts` | 纯函数 diff |
| `tools/contracts/generate-baseline.mts` | 首次冻结；已存在时需 `FORCE_BASELINE_REWRITE=1` |
| `tools/contracts/check-compatibility.mts` | 只读检查，接入 `pnpm contracts:check` |

## 6. 已知限制

- `allOf` / `if`+`then`+`else` / `dependentRequired` 不做完整语义子集证明；结构差异按 BREAKING 处理。
- Registry 尚无完整 `authorizationPurpose`/`dataClassification` 字段；人工闸门以 `manualReviewFingerprint` + `approvals[]` 落地。
- 本切片不实现跨 Major 迁移工具；v1.0 基线文件的任何改写都是高风险审查项。
