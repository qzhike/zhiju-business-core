# PR #10 Code Review 记录

## 审查目标

审查 `qzhike/zhiju-business-core` PR #10 是否把 TaskExecution 已批准的 37 个公共操作契约准确实现为可执行 JSON Schema，并将可复现、影响合并的意见发布到 GitHub。

## 权威依据

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/module-specs/Module-Spec-003-TaskExecution.md`
- `.vibe/module-tests/Module-Test-003-TaskExecution.md`
- `.vibe/api-contract-v0.1/API-Contract-v0.1.md`
- `.vibe/high-level-docs/03-core-contracts.md`
- `.vibe/high-level-docs/06-typed-references-contract-catalog-v0.1.md`

## 执行计划

1. 对照 Base 与 Head，核对 37 个操作、7 个 Query Result 以及命名结构的覆盖和字段语义。
2. 检查严格性、引用强度、状态枚举、敏感字段边界以及 Catalog/生成文件一致性。
3. 独立执行仓库验证，并为发现的问题增加最小只读复现，不修改 PR 实现。
4. 复核 GitHub 行号与评论内容后发布 review。

## 成功标准

- 每条发布意见都有明确 Spec/契约依据、可复现输入和实际影响。
- 不把风格偏好、范围外实现或未运行的集成测试误报为阻塞问题。
- GitHub review 成功发布并可查询到链接。

## 当前状态

审查完成；用户已授权的 8 条意见均已修复，自动回归为 `PASS`；用户已确认修改并于 2026-08-17 明确授权执行 Commit、Push 和合并 PR #10。修复提交已推送，当前处理最新 `main` 的集成 Gate。

## 主要结论

1. Core Contract 被开放的 `CanonicalJson` 降级，任意字符串也可作为 `workOrderContract` 通过验证。
2. `WorkOrderDraft` 的局部类型定义与 `03-core-contracts.md` 的唯一权威结构不兼容。
3. `CompletionEvaluationInput.sourceWatermarks` 错接为 `TypedReference[]`。
4. `Page<TaskBoardItem>` 缺少必填的 `snapshotAt` 与 `sourceWatermarks`。
5. Usage 的 `ValueEnvelope` 未执行 presence/value 互斥不变量。
6. `RunStarted.runtimeBindingSummary` 为开放 JSON，嵌套敏感 Runtime 数据仍可通过。
7. `RunTerminated.terminalStatus` 接受非终态 Run 状态。
8. `TaskDefinition.deliveryItemRef` 在规格中可选，但实现错误设为必填。

## 验证证据

- 修复前审查基线的 `pnpm verify`：通过；4 个 Test Files、35 个 Tests 全部通过，但未覆盖 8 个反例。
- `git diff --check origin/main...HEAD`：通过。
- 最小注册器反例：可复现上述字段级契约偏差；现有绿色测试未覆盖这些边界。
- 环境提示：仓库要求 Node.js `24.19.0`，当前执行环境为 `24.13.0`；本次命令仅产生 engine warning，未导致验证失败。

## GitHub 发布

- Review：<https://github.com/qzhike/zhiju-business-core/pull/10#pullrequestreview-4952354216>
- Review head：`6b70b00f04ac319a6a9ca92ba84bd416929964c0`
- GitHub 状态：`COMMENTED`；PR 作者不能对自己的 PR 提交正式 `REQUEST_CHANGES`，正文已明确记录阻塞结论。

## 修复结果

- Core Contract 入口改为已注册 Schema 引用；WorkOrder 子类型抽取为 Core 共享 `$defs`。
- SourceWatermark、Page、ValueEnvelope、RuntimeBindingSummary、TerminalRunStatus 和 optional 字段均已修正。
- `registry.test.ts` 新增 8 个正反向回归，focused 35/35；全项目 `pnpm verify` 为 43/43。
- Handler、数据库、Runtime、外部集成和人工验收仍为 `NOT RUN`；Commit、Push 和合并 PR #10 已获用户授权。

## Main 集成

- Push 后 PR #10 Head 为 `a7bc30844d60511f19c41af1495806c54f76a145`；同期 PR #11 已合入 `main`，GitHub 因此报告两个共同修改文件存在冲突。
- 集成策略：完整保留 PR #11 的权威 Core 字段级 Schema；TaskExecution 的 WorkOrderDraft 直接复用 `core/work-order/1.0#/$defs/*`，不恢复本分支的平行 WorkOrder 子结构。
- 初次集成 Gate：5 个 Test Files 中 104/106 通过；2 个失败均来自本分支旧合法数据 builder 不满足 PR #11 已收紧的 Principal、Reference 与 NonEmptySet 约束。Schema 不放宽，测试改为复用 PR #11 的合法 Core WorkOrder fixture。
- 最终集成 Gate：TaskExecution focused 35/35、全仓 5 个 Test Files 共 106/106；Architecture、Public API generation 与 Catalog Registry 均为 `PASS`。Handler、数据库、Runtime、外部集成和人工验收仍为 `NOT RUN`。
- `50b3b5d` 的 GitHub `verify` 通过后，PR #12 同期合入 `main@9acfd9d`，GitHub 在最终合并前正确阻止了过期 Head；第二次集成同时保留 TaskExecution 37 个与 Artifact 26 个 FULL 操作，预期聚合状态为 FULL=115、ENVELOPE_ONLY=85。
- 第二次最终集成 Gate：5 个 Test Files 共 118/118；Architecture、Public API generation 与 Catalog Registry 均为 `PASS`，聚合状态 FULL=115、ENVELOPE_ONLY=85。
