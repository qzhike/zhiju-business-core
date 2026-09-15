# PR #201 独立审查

## 当前结论（第 1 轮）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`c4712f8d4664b465436e397479037b2967aff721`
- Base SHA：`d3953a7136faf104e4c7dd050b67155af839dd81`
- PR：[#201](https://github.com/qzhike/zhiju-business-core/pull/201)
- Work item：[#200](https://github.com/qzhike/zhiju-business-core/issues/200)（T2）
- 审查日期：2026-09-15

本轮独立读取了 Issue #200 正文与 Acceptance、PR 最新 head/diff、Spec 001 §14–15、Module-Test-001 `IP-P190-001`–`006` 与 `IP-TAUTH-001`–`008`、批准决定 §14、PostgreSQL 逻辑模型 §33、迁移/Repository/Port/测试源码，以及精确 revision 的 GitHub Actions 检查状态。未采用实现者摘要作为正确性依据，未修改产品代码、契约、迁移或测试。

本文件按项目正式 pre-close review 要求保存，记录实际被审 SHA。它没有预填包含本文件的未来提交；修复与本文件进入 PR 后，应针对新的 final head 重新复审。

## 阻断发现

### R1 / P1：Port 未把 Actor 和 Decision 绑定到受信事务上下文，允许同 Project 跨 Principal 签发与重放

`authorizeCreation` 在 `modules/identity-policy/src/commands/task-execution-creation-authorization.ts:289–346` 只校验调用者提供的 ActorSnapshot id/hash、Project Scope 与调用者同时提供的 authentication-context hash，然后按该 snapshot 的 `principal_id` 查 Grant；它从未要求 snapshot id 等于 `deps.context.actorSnapshotId`，也未要求 snapshot 的真实 principal 等于 `deps.context.principalId`。`revalidateCreation` 在 `:489–565` 同样只从被提交的 Decision 反查其 Actor/Principal，没有把 Decision 的 `actor_snapshot_id` / `principal_id` 与当前受信 context 比较，也没有要求 `decisionRef` 对应 context 中的授权事实。

这不是抽象风险：persistence fixture 的 context 在 `tests/persistence/identity-policy-creation-authorization.test.ts:256–267` 固定为 `OPERATOR` / `OPERATOR_ACTOR`，但 `:710–736` 用 `SECOND_HUMAN` 的 snapshot/grant 在该 context 中签发并成功重验，`:879–920` 又用 AGENT 与 actingFor snapshot 在同一 OPERATOR context 中取得 `ALLOW`。Project RLS 允许读取同 Project 的 ActorSnapshot/Decision；Actor payload hash 和 authentication-context hash 也不是替代当前 caller 绑定的秘密凭据。因此持有任一同 Project snapshot/grant 的引用即可让当前请求冒用另一个 Principal 的资格，违反 Issue 的“actual Actor principal”与 Spec 001 §15.3 的精确 Actor/实际 Principal 重验要求。

请在签发与重验两个入口都把 ActorSnapshot/Decision 的 exact actor id、principal id 与受信 `IdentityTransactionContext` 绑定；至少增加真实 PostgreSQL 负例，分别证明同 Project 的另一 Human、Agent 与 actingFor snapshot 在 OPERATOR context 下不能签发或重验。合法 AGENT/SERVICE 对照应使用与其自身 principal/actor 一致的受信 context，而不是继续依赖当前跨身份 fixture。

### R2 / P1：配对修改 target mirror 与 canonical payload 可保留旧 hash 并把旧 Decision 转用于新 target

V1006 的 `guard_authorization_decision_mirror` 在 `migrations/identity_policy/V1006__identity_policy_creation_decision_target.sql:73–92` 只比较 promoted target columns 与 `canonical_payload.targetRef` 是否相等；它不校验 canonical bytes 与 `payload_hash` / `payload_size_bytes`。读取侧 `getAuthorizationDecisionByIdAndHash`（`identity-policy-repository.ts:1017–1030`）又只比较数据库中的 `row.payload_hash` 与提交的引用 hash，`revalidateCreation` 随后只使用 promoted target/Scope/intent columns，没有重算 `canonical_payload` 的 SHA-256。

因此 owner 直 SQL 可在一条 UPDATE 中同时把 `target_object_id` 与 `canonical_payload.targetRef.objectId` 改成同一个新 UuidV7，而保留旧 `payload_hash`。trigger 会通过；旧 `decisionRef.contentHash` 仍与未改的 hash column 相等；若调用方提交新 target，Grant 的 selector 又只约束 object type，重验会返回有效。完整 target 实际没有被 Decision hash 绑定，直接违反 Issue #200 的 target-bound Decision、direct-SQL tampering 与 exact id/hash 重验验收。

现有 `IP-TAUTH-008` tamper 回归（`tests/persistence/identity-policy-creation-authorization.test.ts:1038–1071`）只分别修改单侧 mirror 或单侧 payload，恰好避开了这个配对反例。请增加 read-side canonical/hash/algorithm/version/size 与 promoted mirror 的完整性校验（或等价、可证明的数据库约束），并增加“同一语句配对修改 target column + payload、保留旧 hash”的负向 fixture；合法未篡改 Decision 应作为正向对照。

### R3 / P1：当前 Grant/Policy 重验没有证明 Policy Snapshot 的内容完整性

`coveringCreationGrant` 在 `task-execution-creation-authorization.ts:790–804` 只确认 `policy_snapshot.payload_hash` 等于 Grant 存储的 hash，并检查 `effective_from` / `superseded_at`。它没有从 `canonical_payload` 重算 hash，也没有复核 canonicalization/hash algorithm、payload size 或完整 promoted mirrors。既有 `policy_snapshot` trigger 只镜像 `policySetVersion`、`effectiveFrom` 与 `policySchemaRefs`；schema owner 可直接修改未提升的 `policyDocument` 并保留旧 `payload_hash`，而签发和重验仍把该 Snapshot 判为当前且完整。

这不满足 Issue #200 与 Spec 001 §15.2 对“Snapshot integrity-valid / Hash/镜像完整”的明确要求。仓库已有 `policyVersionIntegrityHolds` 的 read-side 完整性模式可参考。请为本 Port 使用的 Policy Snapshot 增加等价完整性验证，并增加只修改 canonical `policyDocument`、不更新 hash 的真实 PostgreSQL 负例；签发与重验都应 fail closed。

## 其余核对结果

- 四条 `(operation, version)` 映射、Purpose、action、target objectType 与 capability config key 和 Spec 001 §15.1 逐字段一致；解析没有 alias、大小写、前缀、`*`、`latest` 或跨版本回退。
- single covering Grant 的 capability、Project Scope、ACTIVE/时间窗、精确 action、闭集 selector、空 constraints、无 maxUses 与 Policy Snapshot id/hash 条件没有从多条 Grant 拼接。
- V1006 是 additive forward migration，历史 NULL target pair 保留；列类型、pair CHECK、target mirror 与历史读回方向符合批准设计。R2 之外未发现需要新表、跨 Schema FK、RLS 扩权或 migration 重编号的问题。
- 公开 `identity.authorize_command@1.0`、四个公开创建操作 Schema/Purpose、Catalog/Registry 与 compatibility baseline 未被本 diff 改写；TaskExecution Handler、业务表与跨模块业务链仍保持 `NOT RUN`。

## 验证证据

精确 reviewed SHA 的 GitHub Actions [run 34938712720](https://github.com/qzhike/zhiju-business-core/actions/runs/34938712720) 为 `completed / success`，`headSha=c4712f8d4664b465436e397479037b2967aff721`；verify job [104282225332](https://github.com/qzhike/zhiju-business-core/actions/runs/34938712720/job/104282225332) 的 `pnpm verify` 步骤成功。仓库 CI 明确执行 `pnpm verify`，项目配置目标 `full` 为 `pnpm clean && pnpm verify`；PR 检查覆盖 format、lint、typecheck、unit、architecture、contracts 与 Docker/PostgreSQL persistence gate。`git diff --check d3953a7..c4712f8` 本地通过。

GitHub 日志正文在本轮两次读取时遇到临时 API 连接失败，因此本记录不把 PR 描述中的详细测试计数作为独立读取结果；revision-bound required check 的成功状态、job/step 与执行命令已独立回读。一次本地 focused vitest 在 Reviewer 运行环境中未在有界等待内产生结果，已停止且不作为 PASS/FAIL 证据。绿色 required check 不能关闭 R1–R3，因为现有测试把 R1 的跨身份路径当作正例，并且没有覆盖 R2/R3 的 coordinated/integrity 反例。

## 未运行边界与交接

TaskExecution DRAFT Handler 消费、幂等 Claim/历史 Receipt 前真实调用顺序、业务表/Receipt/Outbox 链、跨模块 E2E、真实 Provider/Runtime、生产 migration 与人工业务验收仍为 `NOT RUN`。

请由 Implementer 修复 R1–R3、补针对性负例并在新 PR head 上取得 required verification，再重新执行独立审查。Issue #200 明确要求的人类安全/迁移技术审查仍是后续独立门禁；应先关闭已知实现缺陷，再进入该人类 Gate。本结论不授权 merge、deploy 或 destructive migration。
