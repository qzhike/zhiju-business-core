# Module-Test-006-ReleasePublication

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IMPLEMENTATION NOT STARTED`

对应规格：[`Module-Spec-006-ReleasePublication.md`](../module-specs/Module-Spec-006-ReleasePublication.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| RP-API-D-001 | Design | ReleasePublication Module Spec 与 Catalog | 12 Command、5 Query、8 Event 名称/Owner/字段完整且无重复 | `commands=12 queries=5 events=8`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| RP-API-U-001 | Unit | 未 fully approved Revision 请求 Authorize | 拒绝 `RELEASE_REVISION_NOT_APPROVED`/not ready | 无实现 | `NOT RUN` |
| RP-API-U-002 | Unit | PREPARED 后替换 Representation/Recipient/Destination | 拒绝 `RELEASE_PACKAGE_FROZEN`，要求新 Release | 无实现 | `NOT RUN` |
| RP-API-U-003 | Unit | same stable key 不同 packageHash Receipt | 拒绝 attempt/receipt conflict，原事实不覆盖 | 无实现 | `NOT RUN` |
| RP-API-C-001 | Contract | Agent ActorSnapshot 带 actingFor Human Authorize | Human-only Contract 拒绝，不调用外部 Publisher | 无 Schema/Handler | `NOT RUN` |
| RP-API-C-002 | Contract | Raw Receipt 与 release/destination/package 不匹配 | 不形成 Formal Receipt；记录 target mismatch | 无 Fixture | `NOT RUN` |
| RP-API-E-001 | E2E | 两个 Destination 一成功一失败 | 状态 PARTIALLY_RELEASED；成功 Receipt 保留；失败项同 Package 幂等重试 | 无 Publisher | `NOT RUN` |
| RP-API-E-002 | E2E | 普通飞书文件发送成功与正式 REL 路径对比 | 只有正式授权 Release 产生 Formal Receipt/Completion Event | 无飞书/Release 实现 | `NOT RUN` |
| RP-API-M-001 | Manual | REL-801 冻结 Package Fixture | 审核者能核对 Revision、ABS、RRS、Package、Destination、Attempt 和 Receipt Hash 链 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Unit/Contract/E2E/Manual：`NOT RUN`，原因是实现、Schema 与 Fixture 尚不存在。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。
