# IM-01 v1.0 Schema 兼容性基线 Verification Report

日期：2026-08-21
对应 Issue：[#8](https://github.com/qzhike/zhiju-business-core/issues/8)
状态：`AUTOMATED PASS / PR #19 ROUND-3 REMEDIATED / USER REVIEW PENDING`

## 1. 覆盖范围

| 项 | 数量 / 路径 | 结果 |
|---|---|---|
| 冻结操作 | 200（`contracts/baselines/v1.0/operations.index.json`） | `PASS` |
| Core Contract 快照 | 6（`schemas/core/*.schema.json`） | `PASS` |
| Schema 文档快照 | 14（common + 6 core + 7 modules） | `PASS` |
| Structural compatibility Gate | `tools/contracts/check-compatibility.mts` | `compatibility=PASS ... findings=0` |
| 规则矩阵单测 | `tools/contracts/lib/schema-compatibility.test.ts`（18） | `PASS` |
| 历史 fixture 回归 | `contracts/src/compatibility.fixture.test.ts`（6） | `PASS` |
| 冻结 Event Schema+envelope | `tools/contracts/lib/historical-baseline.test.ts`（5）；`schemas/envelopes`×200 | `PASS` |
| 人工审查元数据 | `contracts/registry/operation-compatibility-metadata.v1.json`（200 非空 fingerprint） | `PASS` |
| 生产 envelope 同源 | `production-envelope-source.test.ts`（4）；无 live-envelopes 副本 | `PASS` |
| 全量 Vitest | 13 files / 287 tests | `PASS` |
| `pnpm clean && pnpm verify` | format/lint/typecheck/test/architecture/contracts:check | `PASS` |

## 2. 验收对照（Issue #8）

| 验收目标 | 证据 | 结果 |
|---|---|---|
| 200 ops + 6 Core 进入可复现 baseline/manifest | `manifest.json` operationCount=200、coreContractCount=6 | `PASS` |
| required 增删、字段删除、closed enum、类型/引用收窄失败 | breaking-schema 夹具 + schema-compatibility 单测 | `PASS` |
| optional additive Minor 不破坏旧 fixture | optional-field-added-compatible + WorkOrder 历史正向 | `PASS` |
| 每 owner 与每类 Core 有历史正向；关键 breaking 有负向 | fixtures.index 覆盖 7 owner + core×6 + 负向 + unknown Major | `PASS` |
| 未知 Major、历史 Event、Canonical/Hash 稳定 | unknownMajor fixture；RunTerminated/EvidenceVerified；canonicalHashes[] | `PASS` |
| 语义/授权变化需人工确认，默认不兼容 | fingerprint 变化 → MANUAL_REVIEW_REQUIRED；无 APPROVED 则 FAIL | `PASS` |
| 接入 verify/CI，错误可定位 | `contracts:check` 含 compatibility；格式含 operation/path/keyword | `PASS` |
| clean 后 verify 全过；报告同步限制 | 本报告 §3 | `PASS` |

## 3. 已知限制

1. `allOf` / `if`+`then`+`else` / `dependentRequired` **不做**完整语义子集证明；一旦结构稳定相等比较失败即按 `BREAKING`。
2. Registry 尚无完整 `authorizationPurpose` / `dataClassification` 字段；人工闸门以 `manualReviewFingerprint` + `manifest.approvals[]` 落地。
3. `contracts/baselines/v1.0/**` 一经冻结不得静默重写；`pnpm contracts:baseline:generate` 在已存在时拒绝，除非 `FORCE_BASELINE_REWRITE=1`。
4. Handler / Persistence / Runtime / Feishu / Renderer / 人工验收仍为 `NOT RUN`（超出 Issue #8）。

## 4. 关键命令摘录

```text
compatibility=PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=0 findings=0
catalog_registry=PASS catalog=200 registry=200 schema_status={"FULL":200}
Test Files  13 passed (13)
Tests  287 passed (287)
```

PR #19 round-1/2/3 修复见 [`Round1-Remediation.md`](./Round1-Remediation.md)、[`Round2-Remediation.md`](./Round2-Remediation.md)、[`Round3-Remediation.md`](./Round3-Remediation.md)。
