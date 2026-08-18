# PR #14 Code Review 记录

日期：2026-08-18
状态：`REVIEW SUBMITTED / NOT APPROVED`

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
