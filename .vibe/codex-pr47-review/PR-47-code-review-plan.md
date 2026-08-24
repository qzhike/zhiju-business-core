# PR #47 Code Review 与修复记录

## 目标

对 GitHub PR #47 的最新提交执行独立的契约审查；记录可复现的问题；在确认问题后进行最小修复，补齐回归测试与项目规格/测试文档；通过精确 head 验证后，将审查与修复结果评论到原始 PR，并在满足交付条件后关闭原始 PR 及其关联 Issue。

## 当前状态

- 审查状态：已完成第一轮独立语义审查，确认 6 项合并阻塞项
- 修复状态：已完成最小代码、测试、规格和模块测试文档修复
- 验证状态：`pnpm verify`、ContractRegistry 直接探针和真实 PostgreSQL gate 均 `PASS`
- GitHub 交付状态：等待用户检查工作区差异；尚未 commit/push/comment/merge/close

## 第一轮审查发现

1. `modules/identity-policy/src/commands/events.ts` 生成的 Event payload 使用了不完整的 `ObjectRef`，并把 HMAC lookup hash 伪装成不符合 `ContentAddressedRef` 的字段；现有 `ContractRegistry` 直接拒绝两个 WI-07 Event。
2. `resolvePrincipal` 返回的 `principalRef` 与 `displayName` 不是公开 Query Result 要求的完整 Typed Reference/ValueEnvelope。
3. `linkExternalIdentity` 的 idempotency request hash 只包含 provider/account hash，遗漏 subject、evidence 和其他语义输入；相同 key 下不同 subject 可能被错误当成 DUPLICATE，事件也无法唯一标识 account+subject。
4. bootstrap claim 先读后更新且无行锁/条件裁决，同一 claim 的并发消费可能双成功，违反一次性和确定性争用要求。
5. ExternalIdentity 唯一约束的并发 23505 直接在已失败事务中捕获，不能稳定落 receipt/audit；需要改成无异常的 `ON CONFLICT DO NOTHING` 裁决。
6. `principalKind` 以及前置业务拒绝没有经过统一 Command receipt/audit 边界；非法输入可绕过可审计拒绝记录。

## 修复结果

- Event payload 已使用完整 `ObjectRef`；ExternalIdentity lookup 已使用包含 account/subject 两部分的 `ContentAddressedRef`。
- `resolvePrincipal` 已对齐公开 `PrincipalLookup` 输入和 `PrincipalResolutionView` Result，返回完整 refs 与 `ValueEnvelope`。
- 幂等 request payload 已包含 account/subject hash、算法/版本及其他请求语义；相同 key + 不同 subject 现在返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`。
- bootstrap claim 已使用 `FOR UPDATE`、条件更新和 `RETURNING`，真实 PostgreSQL 并发仅一个成功者。
- ExternalIdentity 唯一冲突已使用 `ON CONFLICT DO NOTHING`，竞争失败仍能在活事务内写拒绝 receipt/audit。
- 闭集值和前置拒绝已移入 command runner，新增 `IDENTITY_PRINCIPAL_INVALID_KIND` 并验证拒绝证据。

## 验证结果

- `pnpm verify`：`PASS`。
- Vitest：全项目 `20 passed | 7 skipped`，`341 passed | 125 skipped`；Persistence gate `9 files / 138 passed`。
- ContractRegistry 直接探针：PrincipalRegistered Event、ExternalIdentityLinked Event、resolve_principal Result 均 `valid: true, errors: []`。
- Flyway 二次迁移：`Schema "public" is up to date. No migration necessary.`；临时 PostgreSQL 容器已由 gate 清理。
- 真实 Keycloak/OIDC、飞书 Provider、OpenBao 生产密钥、跨系统 E2E 和人工验收保持 `NOT RUN`。

## 约束

- 以 PR 的实际最新 head、源代码、规格文档和可执行检查为准。
- 保留工作区中与本任务无关的已有修改。
- 代码、测试和规格变更保持最小范围；项目文档使用中文。
- 在提交、推送、合并和关闭 Issue 前分别核对授权边界及最终状态。

## 计划

1. 读取项目规格、模块测试文档、仓库状态和 PR/Issue 元数据。
2. 建立 PR head 的契约与实现差异，形成带位置和复现证据的 review 结论。
3. 若存在问题，先更新相关规格及测试文档，再实现最小修复和回归测试。`PASS`
4. 执行分层验证，明确 `PASS`、`NOT RUN` 和人工验收边界。`PASS`
5. 用户检查差异并确认后，提交 review/修复记录，推送新 head；重新审查精确 head 后评论 PR，使用精确 head 合并 PR 并核对/关闭关联 Issue。`PENDING USER CONFIRMATION`
