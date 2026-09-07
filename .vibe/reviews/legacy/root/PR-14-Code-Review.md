> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/root/PR-14-Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/root/PR-14-Code-Review.md).

# PR #14 Code Review 记录

日期：2026-08-18
状态：`SECOND REVIEW SUBMITTED / NOT APPROVED`

## 审查目标

审查 `qzhike/zhiju-business-core` PR #14 是否把 ReleasePublication 已批准的 25 个公共操作契约准确实现为可执行 JSON Schema；若存在影响合并的问题，将可复现、可执行的意见发布到原始 PR。

## 权威依据

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/module-specs/Module-Spec-006-ReleasePublication.md`
- `.vibe/module-tests/Module-Test-006-ReleasePublication.md`
- `.vibe/high-level-docs/03-core-contracts.md`
- `.vibe/high-level-docs/06-typed-references-contract-catalog-v0.1.md`
- `.vibe/api-contract-v0.1/API-Contract-v0.1.md`

## 执行计划

1. 获取 PR Base、Head、提交与检查状态，确认审查切片和 GitHub 行号。
2. 对照权威契约检查 25 个操作、公共类型、严格性、引用强度、状态枚举和安全边界。
3. 执行仓库验证，并以最小只读反例检查现有测试未覆盖的边界。
4. 仅在发现阻断问题时向原始 PR 发布精确的行级 review comments，并复核发布结果。

## 成功标准

- 每条问题均有明确的 Spec 依据、可复现输入、实际影响和建议修复方向。
- 不把风格偏好、范围外实现或未运行的集成验证误报为阻断问题。
- 审查通过时不产生 GitHub 评论；未通过时评论可在原始 PR 查询。

## 验证边界

- 自动化、静态检查与最小反例按实际执行结果记录。
- Handler、数据库、Runtime、外部集成和人工验收若未执行，保持 `NOT RUN`。

## 第二轮复审计划

1. 以 GitHub 最新 Head 为准，逐条验证第一轮 5 条意见的修复和回归覆盖。
2. 对修复 diff 执行契约、数组类型、授权边界、数据最小化和验证状态复审。
3. 重跑 focused tests、全量 `pnpm verify`、`git diff --check` 和最小注册器反例。
4. 未通过则向原始 PR 追加行级评论；通过则绑定已验证 Head 合并 PR，并关闭其原始 Issue #5。

## 审查结论

PR #14 当前未通过审查，共发布 5 条行级意见：

1. `PublicationFailureSubmission.occurredAt` 未加入 `required`，缺失时间的失败提交会被错误接受。
2. 7 个普通 `T[]` 字段被错误增加 `uniqueItems`，与已批准的数组/Set 类型规则不一致。
3. RP-API-C-001 仅验证 `authorizingHumanRef.principalKind`，没有构造或验证 Agent ActorSnapshot/`actingFor`，不能标记完整用例为 `PASS`。
4. `providerResult: CanonicalJson` 是开放子树，敏感接收方字段移入其中即可绕过 RP-API-C-005。
5. “普通飞书发送”负向测试仅拒绝额外标记字段，没有验证正式 Release 的授权与来源链。

## 验证证据

- PR Head：`409886ad4178fd09d787648c9bea48fd371ce1ab`；Base：`b7b72030fe1a7286aea7da30917e41074840271f`。
- GitHub CI `verify`：`PASS`。
- focused Schema tests：1 个测试文件，29/29 通过。
- 本地 `pnpm verify`：7 个测试文件，179/179 通过；format、lint、typecheck、architecture、public API generation 与 Catalog Registry 均通过。
- 本地 Node.js 为 `v24.13.0`，低于仓库声明的 `24.19.0`；pnpm 为 `11.19.0`，执行仅产生 engine warning。
- 最小注册器反例：缺失 `failure.occurredAt` 返回 `valid: true`；普通数组出现重复项返回 `uniqueItems` 错误；Agent actor + Human authorizer 声明返回 `valid: true`；敏感接收方字段嵌套于 `providerResult` 返回 `valid: true`。
- `git diff --check Base...Head`：通过。
- Handler、数据库、Publisher、Receipt Validator、Runtime、外部集成、E2E 与人工验收：`NOT RUN`。

## GitHub 发布

- Review：<https://github.com/qzhike/zhiju-business-core/pull/14#pullrequestreview-4959906147>
- Review 状态：`COMMENTED`；PR 作者不能对自己的 PR 提交正式 `REQUEST_CHANGES`，正文已明确记录 `NOT APPROVED`。
- 缺失 `occurredAt`：<https://github.com/qzhike/zhiju-business-core/pull/14#discussion_r3803142520>
- 普通数组被误设为 Set：<https://github.com/qzhike/zhiju-business-core/pull/14#discussion_r3803142531>
- Human-only 验证状态失真：<https://github.com/qzhike/zhiju-business-core/pull/14#discussion_r3803142535>
- `providerResult` 敏感数据绕过：<https://github.com/qzhike/zhiju-business-core/pull/14#discussion_r3803142539>
- 普通飞书发送用例未验证来源链：<https://github.com/qzhike/zhiju-business-core/pull/14#discussion_r3803142547>

## 第二轮复审结论

最新 Head `9833cea44417e6a4f1fc6d92c07f3f9259421b11` 已正确修复第一轮 5 条意见中的代码、Schema 和验证状态问题：

1. `PublicationFailureSubmission.occurredAt` 已加入 `required`，并新增缺失字段负向回归。
2. 7 个普通 `T[]` 已移除 `uniqueItems`，Set / NonEmptySet 约束保持不变。
3. Human-only 用例已限定为 `authorizingHumanRef.principalKind` 的 Schema Guard；ActorSnapshot / actingFor 明确保持 Runtime TODO。
4. Receipt 顶层闭合与 `providerResult` PII 最小化已区分，后者明确保持 Runtime TODO。
5. `PublicationSucceeded` 未知字段闭合与普通飞书发送来源链已区分，后者明确保持 E2E `NOT RUN`。

自动验证结果：

- focused ReleasePublication tests：30/30 通过。
- 全量 `pnpm verify`：7 个测试文件、180/180 通过；format、lint、typecheck、architecture、public API generation 和 Catalog Registry 通过。
- `git diff --check Base...Head`：通过。
- Node.js 仍为 `v24.13.0`，低于声明的 `24.19.0`；仅产生 engine warning。

第二轮仍未通过合并/关闭 Gate，原因是 PR 与原始 Issue #5 的验收状态不一致：

- Issue #5 明确要求 fixtures 覆盖 duplicate/late receipt；Module Test 中相同 stable key / 不同 packageHash 场景仍为 `NOT RUN`，PR 中没有对应 fixture 或回归。
- PR 描述仍声明 Agent/actingFor 已在 Schema 层拒绝、敏感/来源链保证均已完成，并把全部验收项标为完成；这与修复后的 Module Test `PARTIAL / RUNTIME TODO / NOT RUN` 冲突。
- PR 描述仍记录 179 个测试，而最新实际结果为 180 个。
- PR 使用 `Closes #5`；在上述验收未完成或未拆分到明确关联的后续 Issue 前，合并会错误关闭未完成的 Issue。

第二轮 GitHub 发布：

- Review：<https://github.com/qzhike/zhiju-business-core/pull/14#pullrequestreview-4960006116>
- Duplicate/late receipt 验收缺口：<https://github.com/qzhike/zhiju-business-core/pull/14#discussion_r3803226796>
- Review 状态：`COMMENTED`，正文明确 `NOT APPROVED for merge/Issue closure`。
- PR #14：保持 `OPEN`，未合并。
- Issue #5：保持 `OPEN`，未关闭。
