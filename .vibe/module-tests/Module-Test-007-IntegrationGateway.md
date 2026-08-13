# Module-Test-007-IntegrationGateway

版本：v0.1
日期：2026-08-13
状态：`API CONTRACT TEST BASELINE / DESIGN GATE VERIFIED / USER REVIEWED 2026-08-13 / IMPLEMENTATION NOT STARTED`

对应规格：[`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

## 测试用例与结果

| ID | 层级 | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|---|
| IG-API-D-001 | Design | IntegrationGateway Module Spec 与 Catalog | 9 Command、5 Query、9 Event 名称/Owner/字段完整且无重复 | `commands=9 queries=5 events=9`；Catalog 集合差 0；字段检查无异常 | `DESIGN VERIFIED` |
| IG-API-U-001 | Unit | same external event ID + same Hash 三次 | 返回同一 Envelope/处理结果；只调用一次等价业务 Command | 无实现 | `NOT RUN` |
| IG-API-U-002 | Unit | same external event ID + different Hash | 首个 Envelope 不变；新事件 Quarantine | 无实现 | `NOT RUN` |
| IG-API-U-003 | Unit | Runtime/Channel external call timeout | Attempt 为 UNKNOWN，不报告 FAILED/SUCCEEDED | 无 Adapter | `NOT RUN` |
| IG-API-C-001 | Contract | Inbound 未知 Major 或未知 required extension | Quarantine，不猜测映射，不写业务状态 | 无 Schema/Adapter | `NOT RUN` |
| IG-API-C-002 | Contract | RenderSucceeded 的 inputHash/revision/renderer 不匹配 Request | Artifact 不登记 Representation，记录 mismatch | 无 Fixture | `NOT RUN` |
| IG-API-E-001 | E2E | InformationRequest 卡片发出、授权回答、重复回调 | 一个 Answer Candidate/Submission；未授权成员被拒绝；不重复恢复 WorkOrder | 无飞书实现 | `NOT RUN` |
| IG-API-E-002 | E2E | Attempt 提交后进程崩溃并重放 | 复用稳定 key；不重复不可控副作用；Receipt 可补记 | 无 Adapter/Persistence | `NOT RUN` |
| IG-API-M-001 | Manual | 飞书/Runtime/Render 脱敏协议 Fixture | 审核者能看到 ExternalRef→Envelope/Attempt→Raw Receipt→业务 Command 的边界 | 未准备可执行 Fixture | `NOT RUN` |

## 本阶段结果

- Unit/Contract/E2E/Manual：`NOT RUN`，原因是实现、Schema 与 Fixture 尚不存在。
- 静态设计 Gate：`DESIGN VERIFIED`，证据见 [`Verification-Report.md`](../api-contract-v0.1/Verification-Report.md)。
- 测试遗留：未创建临时脚本或测试文件。
