# IM-01 v1.0 Schema 兼容性基线 Task Plan

状态：`SLICE IMPLEMENTED / AUTOMATED PASS / USER REVIEW PENDING`
日期：2026-08-20
执行者：Grok 主 Agent
对应 Issue：[#8](https://github.com/qzhike/zhiju-business-core/issues/8)

## 1. 范围

建立不可静默重写的 v1.0 Schema 兼容性基线与 fixture manifest，覆盖 200 个公开操作与 6 个 Core Contract；实现构建期 structural compatibility 检查；无法自动判定的授权/数据分类/语义变化必须显式人工批准，禁止静默 PASS；接入 `pnpm verify`/CI。

## 2. 已确认设计选择

- 方案 A：冻结 Schema 快照（`contracts/baselines/v1.0/`）+ 结构化 diff 检查器。
- 不做「仅 fixture 回归」替代 structural diff。
- 不新增第三方依赖；复用 Node 24 `--experimental-strip-types` 直接加载现有 Schema 源。

## 3. 里程碑

| ID | 产出 | 验证 | 状态 |
|---|---|---|---|
| M1 | `.vibe` 设计/任务文档 + Module Spec/Test 增补 | 文档可读、验收表齐全 | `DONE` |
| M2 | `schema-compatibility` 纯函数库 + 规则矩阵单测 | breaking/compatible/manual 用例 PASS | `DONE` |
| M3 | `generate-baseline.mts` 冻结 200+6 快照与 manifest | operationCount=200；默认拒绝覆写 | `DONE` |
| M4 | `check-compatibility.mts` 接入 `contracts:check` | 故意 breaking FAIL；恢复 PASS | `DONE` |
| M5 | 历史正/负向 fixtures + Ajv/Hash/未知 Major 测试 | 每 owner ≥1 正+1 负；Core×6 | `DONE` |
| M6 | `pnpm clean && pnpm verify` + Verification-Report | 全绿；报告含覆盖与限制 | `DONE` |

## 4. 人工审核 Gate

提交前用户需检查：

1. `contracts/baselines/v1.0/**` 是否完整且不应在后续 PR 被静默重写；
2. compatibility 错误信息是否能定位 operation/version/schema path；
3. 人工批准闸门是否默认 FAIL；
4. Verification-Report 是否诚实记录 `allOf`/`if-then`/`dependentRequired` 等限制。

未经用户确认不得 `git commit`。
