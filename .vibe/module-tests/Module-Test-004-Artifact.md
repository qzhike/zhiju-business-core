# Module-Test-004-Artifact

版本：v0.1
日期：2026-08-17
状态：`API CONTRACT TEST BASELINE / PR #12 REMEDIATION VERIFIED / PR MERGE AUTHORIZED`

对应规格：[`Module-Spec-004-Artifact.md`](../module-specs/Module-Spec-004-Artifact.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| AF-API-D-001 | Design | Artifact Module Spec 与 Catalog | 12 Command、7 Query、7 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=7 events=7`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| AF-API-U-001 | Unit | 对 SEALED Revision 修改内容/Hash/Parent | 拒绝 `ARTIFACT_REVISION_IMMUTABLE` | 无实现 | `NOT RUN` |
| AF-API-U-002 | Unit | 两个写者用同 expected head 移动 Branch | 一个 CAS 成功；另一个冲突，不 last-write-wins | 无并发实现 | `NOT RUN` |
| AF-API-U-003 | Unit | 同 Artifact/purpose 建立重叠 EffectiveBinding | 拒绝 `ARTIFACT_EFFECTIVE_BINDING_OVERLAP` | 无实现 | `NOT RUN` |
| AF-API-C-001 | Contract | RevisionRef ID 正确但 contentHash 错 | Query/Command 都拒绝 Hash mismatch，不读取 current 替代 | 无 Schema/Handler | `NOT RUN` |
| AF-API-C-002 | Contract | Representation Fixture 与 Revision/renderer/checksum 不匹配 | 登记拒绝；Representation 不替代 Canonical Content | 无 Fixture | `NOT RUN` |
| AF-API-C-003 | Contract | 普通 Revision 带 2 个 parent，或 Merge Revision 仅带 1 个 parent | 两者都因 parent 数量不符合 Command 语义而拒绝 | 修复前两者均 `valid=true`；修复后分别以 `maxItems` / `minItems` 拒绝 | `PASS` |
| AF-API-C-004 | Contract | Merge `conflictSet` 非空且 `conflictResolutionRefs=[]` | 拒绝未显式解决的冲突 | 修复前 `valid=true`；修复后以 `minItems` 拒绝 | `PASS` |
| AF-API-E-001 | E2E | 两 Agent 从同 Head 创建并行 Revision 后 Merge | Branch 全保留；Merge 有多 Parent 与显式冲突解决记录 | 无 Artifact 实现 | `NOT RUN` |
| AF-API-E-002 | E2E | 已发布 REV-003 后创建 REV-004 Draft | 原 Approval/Release/EffectiveBinding 不变 | 无跨模块实现 | `NOT RUN` |
| AF-API-M-001 | Manual | ART-023 Revision DAG Fixture | 审核者能定位内容 Hash、Parent、Branch、Representation 与 Binding 差异 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- PR #12 Review 已用当前 `ContractRegistry` 运行确认 AF-API-C-003/004 修复前失败；修复后 focused regression 27/27、独立切片 35/35、合入最新 `main` 后全量测试 98/98 通过。
- 其他 Unit/Contract/E2E/Manual 仍按表中证据保持 `NOT RUN`。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。

## IM-02 WI-04 PostgreSQL 用例

| ID | 输入 | 预期输出 | 修复前实际输出 | 当前结果 |
|---|---|---|---|---|
| AF-PG-001 | 七模块 catalog policy + EnterpriseProject 真实 Project 越权探针 | 非空 Project 行使用 Project helper，越权写入 `42501` | 七模块 policy 对账通过，代表写入 `42501` | `PASS` |
| AF-PG-002 | Process Scope、masked audit、Reference owner version 矩阵 | 跨 Scope 拒绝、masked row 可读、多 owner version 可共存 | 分别为 `23514`、目标 row、两版本成功/精确重复 `23505` | `PASS` |

对象存储、Renderer、业务 Repository 与 payload↔hash Gate 仍为 `NOT RUN`。
