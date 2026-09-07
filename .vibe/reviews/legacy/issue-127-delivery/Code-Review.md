> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-127-delivery/Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-127-delivery/Code-Review.md).

# Issue #127 代码审查记录

版本：v1.0
日期：2026-08-31
审查范围：当前工作树中 IM-05 WI-07 Release Authorization、Publication、Receipt、Completion、Recall 的实现、V6002 Migration、测试和权威文档同步。
审查结论：`PASS — LOCAL / SYNTHETIC / DISPOSABLE POSTGRESQL TECHNICAL SCOPE`；Git commit、push、PR 和 Issue closeout 尚未执行。

## 审查重点

1. 权威链：Readiness 和 Authorization 在 Application 层通过窄 Authority Query Port 重新校验冻结 Package、上游批准事实、Recipient/Destination 和 Human ActorSnapshot；Envelope actor、authorizing principal、Decision、purpose、scope、expiry、revocation、actingFor 和 payload/version 必须 exact match。Agent、Service、Runtime 或不完整 actingFor 链 fail-closed。
2. 副作用边界：Attempt identity 先由 Release/Package/Destination/stable key 绑定，Attempt、Observation、Outbox 和审计事实先落账；Adapter callback 之前再次校验 `objectType`、`objectId` 和完整 Scope。错误引用不产生 Adapter side effect，timeout 只进入 `UNKNOWN`，reconciliation 不盲目重发。
3. Receipt provenance：只有 exact Release/Package/Destination/PublicationAttempt/AdapterAttempt、成功状态、payload hash 和权威时间一致的 RawExternalReceipt 才能晋升 Formal Receipt。`providerResult` 在持久化前递归脱敏敏感字段，普通发送或伪造 Receipt 不满足来源链。
4. 状态与历史：每个 Attempt、Receipt、Failure/UNKNOWN 都追加 Observation；成功目标不会被其他 Destination 的失败删除，失败目标可以稳定重试，Completion 支持 partial/final，Recall 追加 Recall/ImpactReview 而不删除历史。RELEASED/RECALLED 等终态的后续非法写入和重复 Recall 均 fail-closed。
5. 持久化边界：V6002 为 forward-only Migration，不修改 V6000/V6001；六张 WI-07 业务事实表具备 Scope mirror、RLS、owner SECURITY DEFINER function、append-only trigger、CAS/唯一约束、rollback 语义和直接 app DML 拒绝。Observation hash 由应用层 canonical payload 计算，数据库校验 32-byte 长度并由测试 readback 逐条复算。
6. 错误传播：已知业务拒绝转换为稳定业务错误；数据库约束、连接和其他技术异常继续冒泡，使事务整体回滚，不在 aborted transaction 中继续写入 Receipt/Audit。

## 直接验证证据

- `pnpm clean`：`PASS`，完成 TypeScript project-reference clean build。
- `pnpm verify`：`PASS`。Format、Lint、Typecheck、普通 Vitest（42 个文件通过、30 个受控跳过；432 passed、299 skipped）、Architecture（`source_roots=10`）、Public API/Catalog（201 operations、201 registry、全部 `FULL`）、compatibility baseline（v1.0 为 200 operations）均通过。
- PostgreSQL Persistence Gate：`PASS`。PostgreSQL 18.6（`server_version=180006`）、Flyway 11.20.3、V6002 空库迁移、34 个测试文件/314 个测试、二次 `No migration necessary`、tag→digest 和容器清理均通过。
- ReleasePublication focused suite：`PASS`，6 个测试文件/33 个测试；覆盖 Human authorization、sanitizer、Failure/UNKNOWN/retry/partial、Recall terminal guard 和 dispatch exact-reference guard。
- WI-07 Handler readback：3 个 Attempt、6 条 Observation、2 个 Formal Receipt、1 个 Failure、1 个 Recall、1 个 ImpactReview；每条 Observation 的 canonical payload 重算 SHA-256 后均与持久化 32-byte hash 相等；RLS/ACL、append-only、CAS、rollback、跨 Scope 和 owner identity guard 均通过。
- 测试环境：临时 PostgreSQL 容器已由 Gate 清理；未保留临时测试脚本、测试文件或外部对象。

## 未覆盖边界

本记录不把受控 Runtime、合成 REL-801 或 disposable PostgreSQL 证据升级为真实 Provider 验收。真实 Feishu/email/file Provider、公开 HTTP、跨模块业务 E2E、生产数据库和凭据、外部收件人确认、部署后验证、独立人工业务验收以及 #22/#23/#24 的独立 Issue 交付均保持 `NOT RUN` 或独立维护。

## Git 交付边界

当前未执行 `git commit`、`git push`、PR 创建/合并或 Issue #127 关闭。用户检查当前文档、实现、Migration、测试和验证结果并明确回复“确认提交”后，才进入审查范围 staging、`git diff --cached --check`、commit、push、精确 HEAD CI/远端读回及后续 GitHub closeout。
