# PR #70 审核与修正记录

日期：2026-08-25

## 审核基准

- 原始 PR：[#70](https://github.com/qzhike/zhiju-business-core/pull/70)
- 原始 head：`0b0307eb524ee80eef20c7bc88d841ed1a8e25a0`
- PR base：`galendai/57-im-03-wi-01-enterpriseproject`，当时为 `45d3d58c0823e9054dc1a9ca7e4c449d356c8680`
- 关联 Work Item：[#58](https://github.com/qzhike/zhiju-business-core/issues/58)
- 硬依赖：[#57](https://github.com/qzhike/zhiju-business-core/issues/57)，已关闭；base 分支来自已合并 PR #69
- 原始 head 的本地基线：`pnpm verify` 全部通过；21 个测试文件中 21 个通过、11 个跳过；348 个测试通过、175 个测试跳过；persistence gate 为 PostgreSQL 18.6 / Flyway 11.20.3，13 文件 / 188 测试通过，空库迁移成功且二次 migrate no-op。
- 远端查询：PR open、未合并、无 comments/reviews/check-runs；GitHub `mergeable=dirty`。本地 `git merge-tree` 复现 `Module-Spec-002-EnterpriseProject.md` 与当前 base 的冲突。

## 原始审核发现

### F-001：Outbox Event 的 Aggregate identity/version 未绑定 Command target

位置：`modules/enterprise-project/src/persistence/command-runner.ts` 的 `appendOutbox`。

当前实现只校验 payload 的 Enterprise/Project mirror 和声明 Hash，直接持久化调用者提供的 `aggregateType`、`aggregateId`、`aggregateVersion`。因此一个 target 为 `ProcessInstance/A`、expected version 为 `1` 的 Command 可以在同一事务中 CAS A 后写入 B 或任意版本的 Outbox Event；消费者会把它当成 B/错误版本的已提交事实，破坏同 Aggregate 顺序和事件来源链。原测试只使用匹配的 happy path，未覆盖该反例。

规格依据：API Contract 的 target/reference 校验步骤、PostgreSQL Logical Model 的 Aggregate version 规则、WI-02 的一 Aggregate 一事务约束。

修正要求：在写入前绑定 `aggregateType + aggregateId` 到 Envelope target，并按 CREATE=`1`、CAS=`expected+1` 校验版本；失败使用 `COMMAND_TARGET_MISMATCH`，事务不得留下 Receipt/Outbox。

### F-002：Reference Edge owner 未绑定 Command target

位置：`modules/enterprise-project/src/persistence/command-runner.ts` 的 `appendReferenceEdge`。

当前实现只校验可选 Hash 长度，允许同一 Command 为另一个 owner object 建立派生 Reference Edge。该索引随后会参与 Impact/Traceability 查询，可能把不存在于当前 Aggregate 事实中的引用当成已提交关系。原测试没有 owner 漂移反例。

修正要求：要求 Edge owner type/id 与 Envelope target 完全一致；失败使用 `COMMAND_TARGET_MISMATCH`，事务回滚。

### F-003：技术 Process 的创建主体可被调用者伪造

位置：`modules/enterprise-project/src/persistence/enterprise-project-repository.ts` 的 `insertProcessInstance`。

当前 `createdByPrincipalId` 直接由 Repository 调用者写入，RLS 只保护 Enterprise/Project Scope，不保护该审计主体镜像。受信 Context 为 Principal A 时，Command body 可以写入 Principal B，造成 Receipt/Audit 的授权主体与技术 Process 创建主体不一致。原测试只传入与 fixture Context 相同的主体。

修正要求：Repository 在当前事务中读取 `platform_security.context_principal_id()`，并拒绝与调用者主体不一致的写入；错误不提交任何行。

## 修正状态

上述文档与回归场景已先于实现修正登记。

## 修正完成与验证

- F-001：`appendOutbox` 现在要求 Aggregate type/id 等于 Envelope target，并以 CREATE=`1`、CAS=`expected+1` 校验 Aggregate version；不一致返回 `COMMAND_TARGET_MISMATCH`。
- F-002：`appendReferenceEdge` 现在要求 owner type/id 等于 Envelope target；不一致返回 `COMMAND_TARGET_MISMATCH`。
- F-003：`EnterpriseProjectRepository.insertProcessInstance` 现在读取 `platform_security.context_principal_id()`，拒绝伪造 `createdByPrincipalId`，错误码为 `ENTERPRISE_CONTEXT_PRINCIPAL_MISMATCH`。
- 回归：`pnpm persistence:gate` 为 PostgreSQL 18.6 / Flyway 11.20.3、13 files / 190 tests PASS；新增错误 Aggregate、错误 CAS version、错误 Edge owner 和伪造 principal 的失败事务均无 Receipt/Process/Outbox/Edge 残留；空库迁移成功，二次 migrate no-op，容器已清理。
- 仍未执行：用户亲自运行 manual probe、业务 DDL/Handler、公开 HTTP、真实 IdentityPolicy 组成层、Outbox 发布/Inbox 消费、Provider、生产和人工 Reference Project，均为 `NOT RUN`。

待完成：集成当前 base 后重新执行完整 Gate，提交并推送修正与本审核文档，向 PR #70 发布可复现修正评论，等待精确 head checks，然后使用 `--match-head-commit` 合并并回读 Issue #58。
