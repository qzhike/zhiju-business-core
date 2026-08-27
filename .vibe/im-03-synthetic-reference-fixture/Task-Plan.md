# IM-03 合成 Reference Project Fixture 任务计划

- 日期：2026-08-27
- 任务：为 IM-03 建立 `SYNTHETIC / TECHNICAL ONLY` Reference Project，用于补齐受控技术验证场景。
- 当前状态：`USER CONFIRMED / COMPOSED CONTROLLED PERSISTENCE PASS / SCOPED CLOSEOUT AUTHORIZED / INTEGRATED E2E NOT RUN / NO CODE CHANGE`

## 范围

1. 使用不含真实客户信息的合成 Enterprise、Project、Material、Baseline、Gap、DeliveryPlan 和 DeliveryItem。
2. 通过 EnterpriseProject 的 Application/Command 边界创建业务对象；测试 SQL 只用于观察结果或验证数据库拒绝，不用于伪造业务前置状态。
3. 记录精确 Object ID、Version、Hash、Scope、Command Receipt、Human/Agent 决定、拒绝错误码和历史重放结果。
4. 将现有 WI focused PostgreSQL fixtures 组合映射到 `EP-API-U-*`、`EP-API-C-*`、`EP-API-E-*` 的受控技术输出，并为 `EP-API-M-001` 形成可供用户审阅的合成材料；不得把组合证据写成单一跨 Aggregate E2E。

## 明确边界

- 本 Fixture 不代表任何真实客户业务规则、采购制度、法规或组织审批流程。
- 本 Fixture 的通过结果只能写为 `PASS (COMPOSED CONTROLLED PERSISTENCE)` 或 `PASS (CONTROLLED PERSISTENCE)`；组合结果必须明确标注，不得写成已完成的真实业务验收。
- 真实 Provider、生产数据库、公开 HTTP、真实跨模块 Event Bus/Process Manager 和真实业务人工验收继续保持 `NOT RUN`。
- 本 Fixture 形成时用户只确认场景口径，未授权 commit、push 或 Issue #56 closeout。2026-08-27 后续指令已明确授权提交文档、合并并以 scoped technical acceptance 关闭 Issue #56；该后续授权不改变集成跨 Aggregate E2E 和人工验收的 `NOT RUN`。

## 交付物

- `Synthetic-Reference-Project-Fixture.md`：合成数据、流程步骤、禁止事项和预期结果。
- `Test-Matrix.md`：Issue #56 父级场景与合成 Fixture 的映射，含输入、预期输出、实际输出栏和状态。
- `Verification-Record.md`：本次 composed controlled persistence Gate 的命令、环境、测试计数、映射证据和清理结果。

## 执行结果

- `pnpm persistence:gate`：通过，`21` 个 persistence 测试文件、`256` 个测试通过。
- 空库 Migration、V2013、二次 migrate no-op 和 PostgreSQL 容器清理：通过。
- 结果范围：现有 WI focused fixtures 的 composed technical evidence；没有生成一个贯穿所有 Aggregate 的统一 Reference Project runtime identity。
- `EP-API-E-001`、`EP-API-E-002` 的 integrated cross-aggregate execution 和 `EP-API-M-001` 的人工审阅：`NOT RUN`。
