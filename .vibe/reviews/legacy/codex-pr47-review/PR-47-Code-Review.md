> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/codex-pr47-review/PR-47-Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/codex-pr47-review/PR-47-Code-Review.md).

# PR #47 Code Review 与修复记录

## 1. 审查范围与状态

| 项目 | 值 |
|---|---|
| Pull Request | [#47](https://github.com/qzhike/zhiju-business-core/pull/47) |
| 关联 Issue | [#35](https://github.com/qzhike/zhiju-business-core/issues/35) |
| 审查基线 | PR #47 head `553431c26ea0b5d08b6a602f7ed17b987c205d4d` |
| Base | `galendai/34-im-02-wi-06-command-transaction-runner`，`7c8ea1a36b222e3c3407a86f81fe023a7bb7bce1` |
| 审查日期 | 2026-08-24 |
| 当前交付状态 | 用户已确认提交；最新 WI-06 base 合并冲突已解析，最终本地 gate 已通过，待完成 merge commit、push、comment、merge/close |

本轮先独立读取 PR 的精确 head、关联 Issue、HL-Spec、IdentityPolicy Module Spec/Module Test、API Contract、数据库模型、实际 diff 和当前工作区状态，再执行实现修复。PR 原始 head 的自动检查是绿色，但语义审查仍发现以下合并阻塞项。

## 2. 首轮审查发现

### Blocker 1：公开 Event payload 被内部简化引用替代

原实现的 `PrincipalRegistered` / `ExternalIdentityLinked` payload 使用 `objectType: Principal` 等不完整引用，并把 keyed HMAC digest 当作 `ContentAddressedRef` 的平面字段。直接调用 `ContractRegistry` 时，payload 被拒绝：缺少 `kind`、`scope`、完整 `contentHash`，且 namespace 不符合约定。

影响：Handler 生成的 WI-07 公开事件不能通过现有字段级 Schema，无法安全交付给跨模块 consumer。

修复位置：[`modules/identity-policy/src/commands/events.ts`](../../../../modules/identity-policy/src/commands/events.ts)；新增 payload contract 回归见 [`modules/identity-policy/src/commands/events.test.ts`](../../../../modules/identity-policy/src/commands/events.test.ts)。

### Blocker 2：`resolve_principal` Result 不符合公开 Result Schema

原实现返回简化的 `{ objectType, objectId }` 和裸 `displayName: string`。公开 Result 要求完整 `ObjectRef`、闭集 `principalKind/status` 和 `ValueEnvelope`。

影响：`registry.validateOperationResult('identity.resolve_principal', '1.0', result)` 失败；调用方无法依赖统一 Typed Reference/ValueEnvelope 语义。

修复位置：[`modules/identity-policy/src/commands/link-external-identity.ts`](../../../../modules/identity-policy/src/commands/link-external-identity.ts)，同时将 resolver 输入对齐为 `PrincipalLookup` 的 `principalRef` / `identityKey` / `requiredScopeRef` 结构。

### Blocker 3：幂等摘要遗漏 subject 和其他请求语义

原实现的 `linkExternalIdentity` request payload 只包含 provider 与 account hash。相同 idempotency key 下替换 subject 可能被错误判定为 `DUPLICATE`；`evidenceRefs`、verification method 等请求语义也未进入 request hash。

影响：不同外部身份可能共享错误的幂等结果，且 receipt 无法证明原始请求语义完整参与了冲突判定。

修复位置：[`modules/identity-policy/src/commands/link-external-identity.ts`](../../../../modules/identity-policy/src/commands/link-external-identity.ts)；回归用例固定相同 key + 不同 subject 必须抛出 `IDEMPOTENCY_PAYLOAD_CONFLICT`。

### Blocker 4：bootstrap claim 并发消费可双成功

原实现先读取 claim，再无锁、无条件地更新 `consumed_at`。两个事务可能同时看到未消费状态，分别创建 Principal 并覆盖 claim 的消费记录。

影响：一次性 bootstrap claim 的唯一成功者和审计链不再确定。

修复位置：[`modules/identity-policy/src/commands/register-principal.ts`](../../../../modules/identity-policy/src/commands/register-principal.ts)：读取时 `FOR UPDATE`，更新时增加 `consumed_at IS NULL`、`closed_at IS NULL`、`expires_at > now` 条件并检查 `RETURNING` 结果；新增真实 PostgreSQL 并发回归。

### Blocker 5：唯一冲突在已失败事务内捕获

原实现捕获 PostgreSQL `23505` 后在同一事务中返回业务拒绝，但 PostgreSQL 事务已经进入 aborted 状态，后续 receipt/audit finalize 会继续失败。

影响：并发 ExternalIdentity 冲突不能稳定写入拒绝 receipt/audit。

修复位置：[`modules/identity-policy/src/persistence/identity-policy-repository.ts`](../../../../modules/identity-policy/src/persistence/identity-policy-repository.ts) 使用 `ON CONFLICT DO NOTHING` 返回 `boolean`；Handler 在 live transaction 中将 `false` 转为 `IDENTITY_EXTERNAL_LINK_CONFLICT`，并新增真实 PostgreSQL 并发回归。

### Blocker 6：前置业务拒绝绕过 receipt/audit

原实现把 invalid initial status、空 display name、invalid verification method 等检查放在 `executeIdentityCommand` 之前，拒绝没有统一落到 command receipt/audit 边界；`principalKind` 也没有 runtime closed-value 校验。

修复位置：[`modules/identity-policy/src/commands/register-principal.ts`](../../../../modules/identity-policy/src/commands/register-principal.ts) 与 [`modules/identity-policy/src/commands/link-external-identity.ts`](../../../../modules/identity-policy/src/commands/link-external-identity.ts) 将检查移入 command body，新增 `IDENTITY_PRINCIPAL_INVALID_KIND`，并通过真实 PostgreSQL 查询 receipt result payload 与 audit error code。

## 3. 修复摘要

- 公开 Event payload 使用完整 `ObjectRef`；ExternalIdentity lookup 使用包含 account/subject 两个 keyed hash 元数据的 `ContentAddressedRef`，不保存原始外部标识。
- Principal Resolution Result 使用完整 scoped object refs 和 `ValueEnvelopeString`；输入 shape 对齐现有生成契约。
- ExternalIdentity 幂等摘要包含 provider、account/subject lookup hash、算法/版本、verifiedAt、verification method、evidence、display hint 和显式 link id（如提供）。
- Bootstrap claim 由数据库行锁和条件更新共同裁决；同一 claim 的并发请求只有一个 `COMMITTED`。
- ExternalIdentity lookup 唯一冲突使用 `ON CONFLICT DO NOTHING`，避免在 aborted transaction 中继续写 receipt/audit。
- 所有本轮检查的业务拒绝均通过 command runner 持久化 receipt/audit；原始 account/subject 不进入 receipt payload、outbox payload 或安全摘要。
- 合并最新 WI-06 base 时保留其 `V1002` 平台 Receipt migration；WI-07 bootstrap claim migration 顺延为 forward-only `V1003`，并为真实命令测试登录补齐 `platform_context_establisher` membership。
- 按项目流程先更新了 [`HL-Spec.md`](../../../high-level-docs/HL-Spec.md)、[`Module-Spec-001-IdentityPolicy.md`](../../../module-specs/Module-Spec-001-IdentityPolicy.md)、[`Module-Test-001-IdentityPolicy.md`](../../../module-tests/Module-Test-001-IdentityPolicy.md) 与 WI-07 Issue 文档，再修改实现。

## 4. 验证证据

| 验证 | 结果 |
|---|---|
| `pnpm format:check` | `PASS` |
| `pnpm lint` | `PASS` |
| `pnpm typecheck` | `PASS` |
| `pnpm test` | `20 passed / 7 skipped`；`341 passed / 137 skipped` |
| `pnpm architecture` | `PASS`，`source_roots=10` |
| `pnpm contracts:check` | `PASS`，public API `200`、Registry `FULL=200`、compatibility findings `0` |
| `pnpm persistence:gate` | `PASS`；真实 PostgreSQL `9 files / 150 passed`、V1002/V1003 均 applied、二次 migrate no-op、临时容器已清理 |
| `pnpm verify` | `PASS`，上述检查完整串联执行 |
| `ContractRegistry` 直接探针 | `PrincipalRegistered Event`、`ExternalIdentityLinked Event`、`resolve_principal Result` 均 `valid: true, errors: []` |

## 5. 验收边界

### 已验证

- WI-07 Handler 的 Principal 创建、ExternalIdentity 绑定/解析和冲突不覆盖。
- 同 key 同请求重放为 `DUPLICATE`；同 key 不同 subject 为 `IDEMPOTENCY_PAYLOAD_CONFLICT`。
- 非法闭集值、非法 initial status、未验证身份的拒绝具备稳定错误码，并落 receipt/audit。
- bootstrap claim 顺序与并发消费的唯一成功者语义。
- Event/Query Result 的字段级 Schema、Typed Reference、ContentAddressedRef、ValueEnvelope。
- PostgreSQL migration、RLS runtime role、outbox/audit/receipt 和原始外部标识不泄漏的本地证据。

### 保持 `NOT RUN`

- 真实 Keycloak/OIDC、飞书 Provider/Adapter、OpenBao Transit 生产密钥。
- 跨系统 HTTP/外部 E2E 和真实 Provider 网络失败/迟到行为。
- 人工手动业务验收；`tests/manual/wi07-probe.mts` 仅随代码更新，未宣称执行通过。

这些边界不因本地 crypto test double、Docker PostgreSQL 或绿色自动化检查而升级为生产业务 `PASS`。

## 6. 交付状态

用户已确认提交。本地修复、最新 WI-06 base 合并解析和最终验证已完成；接下来以新的精确 PR head 重新检查、发表评论修复记录，使用 `--match-head-commit` 合并 PR #47，并核对/关闭 Issue #35。
