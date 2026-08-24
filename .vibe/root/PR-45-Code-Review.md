# PR #45 Code Review

## 审查目标

审查 PR #45 在精确提交上的 IdentityPolicy 关系模型、低层 Repository、RLS、敏感标识保护和真实 PostgreSQL 验证是否满足 Issue #33、HL-Spec、IdentityPolicy Module Spec/Test 与 PostgreSQL Logical Model §9；发现问题时先补规格与失败回归，再实施最小修复。

## 执行计划与成功标准

1. 固定 PR head、base、依赖链、Issue 与 CI 状态；确认实际 diff 可安全进入 `main`。
2. 对每项验收条件检查 SQL、Repository、测试与手动 runbook，并用直接反例验证唯一性、不可变性、RLS、引用/Hash 精确绑定及敏感数据边界。
3. 如发现缺陷，先更新 HL-Spec、Module Spec/Test 或 WI-05 权威记录与失败测试，再修复实现；只修改与缺陷直接相关的文件。
4. 运行 focused tests、真实 PostgreSQL persistence gate、`pnpm clean && pnpm verify` 与 `git diff --check`；生产 OpenBao、Keycloak、飞书 Adapter 和公开 Handler 保持 `NOT RUN`。
5. 将本审查记录提交至 PR 分支并写入 PR comments；在最新精确 head 复审与 CI 成功后，以 head SHA 保护合并，并核验 PR #45 与 Issue #33 最终状态。

## 初始状态

- 初始 PR head：`a47b742d8f914f752ae1c3dca65a42aede0245ab`
- 初始 base：`galendai/32-im-02-wi-04-technical-tables`
- 依赖 PR #43、#44：均已合并到 `main`
- 初始 CI：`verify` 成功，但仅作为基线证据
- Issue #33：`OPEN`；PR body 含 `Closes #33`，但当前非默认 base 导致 GitHub `closingIssuesReferences` 为空

## 审查记录

初始 head 存在以下合并阻塞问题：

1. Project Scope 的四类表仅调用 `context_allows_enterprise`，且缺少 Enterprise/Project 列形状约束。Enterprise A 上下文即使 `allowedProjectIds` 不含 Project B，仍可读取 Project B 的 Role/Capability/Actor/Decision；也可写入 `scope_kind=PROJECT, project_id=NULL` 或 Enterprise 行携带 Project。
2. `role_revocation`/`capability_revocation` 的 `enterprise_id` 由调用者自由提供，未与父 Assignment/Grant Scope 绑定；外键只验证目标 id，允许构造跨 Scope 的撤销事实。
3. `capability_grant` 只对 PolicySnapshot id 建外键，不校验随附 hash；`actor_snapshot` 的 Principal/Kind 与 actingFor Principal/Kind 未精确绑定；`authorization_decision` 同样未校验 Policy hash，且未保存/校验 ActorSnapshot hash，也未校验 Decision 的 Principal、Kind、认证上下文和 Scope 是否与 ActorSnapshot 一致。这会让非精确安全引用进入不可变历史。
4. Repository 的 `insertActorSnapshot` 与 `insertAuthorizationDecision` 忽略调用者提供的 `snapshotPayload`/`decisionPayload`，只保存重新拼出的 promoted 字段，导致不可变 Contract 正文（例如测试中的 `note`）被静默丢弃，payload hash 也没有覆盖原始正文。
5. External Identity 的负面测试只使用安全 `displayHint/evidenceRefs`；调用者把原始 account/subject 放进 `displayHint`、`verificationMethod` 或 `evidenceRefs` 时，Repository 会原样写入数据库，违反“原始标识不落库”。此外名为“active lookup”的查询未过滤 `status='ACTIVE'`，会解析已撤销映射。
6. PR base 仍是已合并的 PR #44 功能分支，`closingIssuesReferences` 为空；必须在修复后改基 `main`、重新验证最新 head 与 CI，才能完成默认分支交付及 Issue #33 关闭。

## 验证记录

- `pnpm typecheck`：`PASS`。
- focused Unit：`1 file / 5 tests PASS`。
- 一次性 PostgreSQL 18.6（缓存的精确 digest）+ Flyway 11.20.3：11 个 Migration 成功；`7 files / 125 tests PASS`；容器已清除。该证据不包含 registry 侧 tag↔digest 在线解析。
- `pnpm clean && pnpm verify`：format、ESLint、TypeScript、`19 files passed / 5 skipped`、`339 passed / 112 skipped`、architecture、200-operation public API/类型/Catalog 与 compatibility 全部通过；最终 persistence gate 在项目测试开始前被 Docker Hub HTTP 429 限流，因此本次本地全命令结果为 `NOT PASS`，不得冒充完整 PASS。
- 真实 OpenBao Transit、Keycloak/OIDC、飞书 Adapter、20 个公开 Handler、外部 E2E 与用户手动 probe：`NOT RUN`。

## 最终结论

六项初始阻塞问题已完成文档先行的回归与最小修复；待提交、推送、将 PR base 更新为 `main`，并以最新精确 head 的 GitHub CI 复审后给出最终 `PASS` 或继续修复。
