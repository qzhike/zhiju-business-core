> Historical record. Related Issue: [89](https://github.com/qzhike/zhiju-business-core/issues/89). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-04 启动任务计划

- 日期：2026-08-27
- 目标：在 IM-03 文档验证提交完成后，启动 IM-04 开发前置核对。
- 当前状态：`SPEC REVIEW COMPLETE / IM-DG-005 APPROVED 2026-08-27 / USER CONFIRMED DOCUMENT DELIVERY / NO CODE CHANGE`
- 当前工作树：`galendai/im-03-enterpriseproject-reference-foundation`

## 启动范围

1. 读取 IM-04 相关 HL-Spec、Implementation Milestone Plan、Domain Model、Cross-Aggregate Boundary、Artifact Module Spec/Test 和当前公共 Contract。
2. 定位 `IM-DG-005` 的冻结内容、依赖关系、可选方案和用户决策点。
3. 区分可在决策前推进的内部设计/测试准备，与必须等待 Canonical Document/Workbook Schema 和 Renderer route 冻结的代码/Contract 变更。
4. 为每个可执行任务定义用户可手动检查的产出、Unit/Persistence/Contract/E2E 边界和 `NOT RUN` 记录方式。

## 当前边界

- 本任务不修改 IM-03 或 IM-04 业务代码；Issue #56 的 scoped technical closeout 已由后续用户指令单独授权。
- `IM-DG-005` 已冻结；本轮不修改 Registry、可执行公共 Operation/Event/Query 或跨模块 Canonical Document/Workbook payload。规格复审发现的 additive RenderAttempt Binding Query 只作为 IM-04 首个 Contract Gate 建档。
- 真实 Provider、公开 HTTP、生产环境、跨模块 Event Bus/Process Manager 和真实人工业务验收继续保持 `NOT RUN`。
- 所有后续代码变更前，必须先同步 HL-Spec、相关 Module-Spec 和 Module-Test；代码或文档变更完成后等待用户检查，未经再次确认不执行 commit。

## 预期产出

- IM-04 当前规格与依赖审阅记录。
- `IM-DG-005` 的用户决策摘要和推荐选项。
- 可在决策前执行的安全任务清单，以及依赖决策后才能执行的实现任务清单。
- IM-04 任务级测试验收矩阵，包含输入、预期输出、实际输出和清理边界。

## 审阅结论

- `Implementation-Milestone-Plan-v0.1` 已将 IM-DG-005 更新为 `USER APPROVED 2026-08-27`，并明确 IM-04 的前置是 IM-DG-003 与 IM-DG-005 的本里程碑范围冻结。
- IM-04 的退出 Gate 是 Revision 不可变、跨 Project 引用/Hash 冲突/路径或对象替换拒绝，以及对象成功但数据库失败不产生业务对象。
- `Module-Spec-004-Artifact` 当前是 26 个公开 Contract 的字段级基线；Canonical Content Schema、业务 Repository、Diff、Object Storage Link、Renderer 和业务 Handler 均未实现。
- `Module-Test-004-Artifact` 的不可变 Revision、CAS、Hash/Representation 校验、并行 Branch/Merge 和人工 Fixture 仍为 `NOT RUN`；只能把已有 Contract 维度回归标记为 `PASS`。
- `modules/artifact/src/index.ts` 仍是 Skeleton，`migrations/artifact/V4000__artifact_technical_tables.sql` 只提供 IM-02 标准技术表，不能视为 IM-04 业务持久化已完成。
- IntegrationGateway 已有 `RenderRequest`、`integration.request_render@1.0`、`integration.RenderSucceeded@1.0` 和 `integration.RenderFailed@1.0`；Renderer 应作为适配层事实源，不应由 Artifact 直接调用外部 Renderer。现有通用 Attempt Query 不足，必须先 additive 冻结只读 Binding Query，但不能新增重复 Render 执行 API。

详细决策材料、批准记录与下一步任务见同目录的 `Review-Record.md`。用户已确认本轮文档交付并要求只建立 GitHub Work Item；本轮不进入 Canonical payload、Revision Repository、Renderer 或任何其他 IM-04 实现。
