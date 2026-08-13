# Module-Test-005-QualityGovernance

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IMPLEMENTATION NOT STARTED`

对应规格：[`Module-Spec-005-QualityGovernance.md`](../module-specs/Module-Spec-005-QualityGovernance.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| QG-API-D-001 | Design | QualityGovernance Module Spec 与 Catalog | 18 Command、8 Query、11 Event 名称/Owner/字段完整且无重复 | `commands=18 queries=8 events=11`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| QG-API-U-001 | Unit | FAIL GateResult 请求原地改 PASS | 拒绝 `QUALITY_GATE_RESULT_IMMUTABLE`；重跑产生新 Result | 无实现 | `NOT RUN` |
| QG-API-U-002 | Unit | 作者在职责分离要求下验证自己的整改 | 拒绝 `QUALITY_SEPARATION_OF_DUTIES_VIOLATION` | 无实现 | `NOT RUN` |
| QG-API-U-003 | Unit | AGENT/actingFor Human 提交 APPROVED | 永久拒绝 `QUALITY_APPROVAL_AGENT_FORBIDDEN` | 无实现 | `NOT RUN` |
| QG-API-C-001 | Contract | RAS 混入 RELEASE_READINESS Render Gate | stage mismatch；RAS 不 Ready | 无 Schema/Evaluator | `NOT RUN` |
| QG-API-C-002 | Contract | RRS 的 packageHash/checksum 与冻结 Package 不同 | target mismatch；不得用于 Release Authorization | 无 Fixture | `NOT RUN` |
| QG-API-E-001 | E2E | REV-002 FAIL/Issue，REV-003 修复并独立验证 | 旧历史保留；新 Result/Verification/RAS/ABS 全绑定 REV-003 | 无业务实现 | `NOT RUN` |
| QG-API-E-002 | E2E | 已批准 Revision 的 Evidence 撤销 | 新 Snapshot STALE/NOT_READY，触发 Release Impact；历史不删除 | 无跨模块实现 | `NOT RUN` |
| QG-API-M-001 | Manual | REV-002→REV-003 质量链 Fixture | 审核者能区分 Gate、Issue、Verification、Approval、RAS/ABS/RRS | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Unit/Contract/E2E/Manual：`NOT RUN`，原因是实现、Schema 与 Fixture 尚不存在。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。
