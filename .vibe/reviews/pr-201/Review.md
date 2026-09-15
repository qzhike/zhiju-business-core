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

## 当前结论（第 2 轮：代码更新复审）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`fc4457e11cad4a72179ddf3fbed202c18b9ad2dd`
- Fix implementation SHA：`bb5a7155b9c4021504717b3aa48a77342d7e6233`
- Previous reviewed SHA：`c4712f8d4664b465436e397479037b2967aff721`
- Base SHA：`d3953a7136faf104e4c7dd050b67155af839dd81`
- 审查日期：2026-09-15

本轮针对新的 final head 独立重读了 Issue #200、PR diff、修复提交、Spec 001 §15.2–15.3、Port/Repository/迁移/真实 PostgreSQL测试，以及 exact-head required check。最终 head 相比实现修复提交只增加本正式 Review 文件；产品代码修复位于 `bb5a715`。

### 上轮发现复核

- R1 已关闭：`authorizeCreation` 现在要求输入 ActorSnapshot id 等于受信 context 的 `actorSnapshotId`，读回后要求真实 principal 等于 context principal；`revalidateCreation` 同时比较 Decision 的 actor/principal 与当前 context。`IP-TAUTH-007` 增加另一 Human、Agent、actingFor 的拒绝场景，并为合法第二 Human 使用其自身受信 context。
- R2 的已报告复现场景已关闭：重验在信任 Decision 字段前，从 canonical payload 重算 hash/algorithm/canonicalization version/size，并比较 target/promoted facts；新增真实 PostgreSQL 回归证明“target mirror + canonical target、保留旧 hash”的配对修改返回 `DECISION_INTEGRITY_MISMATCH`。
- R3 已关闭：签发与重验查找 covering Grant 时都调用 `policySnapshotIntegrityHolds`，从 canonical Policy Snapshot 重算完整性元数据并比较现有镜像；新增 `policyDocument` 保留旧 hash 的真实 PostgreSQL负例，分别返回 `GRANT_POLICY_SNAPSHOT_INVALID` / `POLICY_INTEGRITY_MISMATCH`。

### 新阻断发现

#### R4 / P1：Decision 读侧“完整 promoted mirror”遗漏 Decision 主键、reason codes 与 target kind

`insertAuthorizationDecision` 在 `modules/identity-policy/src/persistence/identity-policy-repository.ts:1130–1183` 同时把 `authorizationDecisionId` / `reasonCodes` 写入 canonical payload，并把同一事实写入 `authorization_decision_id` / `reason_codes` 列；target canonical payload 还包含 `kind: OBJECT`。但新增的 `validateAuthorizationDecisionMirror`（`:362–436`）和调用参数（`:464–484`）没有比较：

1. `canonical_payload.authorizationDecisionId` 与 `authorization_decision_id`；
2. `canonical_payload.reasonCodes` 与 `reason_codes`；
3. `canonical_payload.targetRef.kind` 与该 Port 要求的 `OBJECT`。

因此，只要 canonical payload 自身与新写入的 hash/algorithm/version/size 一致，即使它声明了另一个 Decision id、不同 reason codes 或非 Object target kind，`authorizationDecisionIntegrityHolds` 仍返回 true；`revalidateCreation` 随后使用未与 canonical 身份一致的行主键和 promoted authorization facts 继续授权。这里不是“旧 hash 未更新”的上轮 R2 复现，而是新的 canonical/权威列不一致边界。

这违反 Spec 001 §15.3 已明确落地的“读取端从 canonical payload 重算完整性元数据并校验提升列镜像”，也未完整证明 Issue #200 的 exact Decision id/hash 与 complete targetRef。函数注释称 promoted columns 必须 mirror canonical payload，但当前实现并未覆盖全部相关列。

请把上述 canonical 字段纳入读侧 mirror 校验，并增加 focused/真实 PostgreSQL回归：至少构造 canonical `authorizationDecisionId` 与行主键不一致、重新计算并同步 payload hash/size 元数据的 Decision，证明重验返回 `DECISION_INTEGRITY_MISMATCH`；同时覆盖 `reasonCodes` 列镜像和 `targetRef.kind` 的闭集约束。合法未修改 Decision 应保留正向对照。

### 第 2 轮验证证据

- exact final head 的 GitHub Actions [run 34944745666](https://github.com/qzhike/zhiju-business-core/actions/runs/34944745666) 已独立回读为 `completed / success`，`headSha=fc4457e11cad4a72179ddf3fbed202c18b9ad2dd`；verify job [104301363687](https://github.com/qzhike/zhiju-business-core/actions/runs/34944745666/job/104301363687) 的 `pnpm verify` 步骤成功。
- `git diff --check d3953a7..fc4457e` 通过，复审前工作树干净。
- GitHub job 日志正文再次因临时 API 连接失败未能读取；本轮不把 PR 描述中的详细计数当作独立证据。
- 本地 focused Vitest 在有界等待内没有输出，已终止，不记为 PASS/FAIL。绿色 CI 不关闭 R4，因为新增的 integrity 回归只覆盖保留旧 hash 的 target/policy tamper，未覆盖 canonical Decision identity/reasons/kind 与 promoted facts 分叉且完整性元数据同步的边界。

### 未运行边界与交接

TaskExecution DRAFT Handler 消费、幂等 Claim/历史 Receipt 前真实调用顺序、业务表/Receipt/Outbox 链、跨模块 E2E、真实 Provider/Runtime、生产 migration 与人工业务验收仍为 `NOT RUN`。

请修复 R4、补回归并对新的 final head 重跑 required verification 后再次复审。即使代码缺陷全部关闭，Issue #200 明确要求的人类安全/迁移技术审查仍是独立 merge gate；在该门禁有可回读证据前不能得出 `APPROVE`。本结论不授权 merge、deploy 或 destructive migration。

## 当前结论（第 3 轮：R4 修复复审）

- 结论：`HUMAN_REVIEW_REQUIRED`
- Reviewed SHA：`e61383700f3ac7b21688b95b193d5d6b50ae2467`
- Fix implementation SHA：`11b6f41`
- Previous reviewed SHA：`fc4457e11cad4a72179ddf3fbed202c18b9ad2dd`
- Base SHA：`d3953a7136faf104e4c7dd050b67155af839dd81`
- 审查日期：2026-09-15

本轮按新的 final head 独立重读了 Issue #200、R4 修复 diff、Spec 001 §15.3、Decision Repository、focused guard tests、真实 PostgreSQL回归、正式审查记录和 revision-bound CI。最终 head 相比产品修复提交只增加第 2 轮 Review 记录；工作树在复审开始时干净。

### R4 关闭确认

`validateAuthorizationDecisionMirror` 现已接收行 `authorization_decision_id` 与 `reason_codes`，分别比较 canonical `authorizationDecisionId` 和 `reasonCodes`；target 分支在 objectType/objectId/Project Scope 之外固定要求 `kind === 'OBJECT'`。逐字段核对该 Port 写入的 canonical Decision 后，Decision id、Actor snapshot id/hash、principal id/kind、outcome、reason codes、command type/version、Scope kind/enterprise/project、Purpose、configured capability、command payload hash、Policy snapshot id/hash、authentication context hash、expiry，以及 targetRef kind/objectType/objectId/Project Scope 均进入 hash 与 mirror/闭集验证。未发现遗漏的授权关键 canonical 字段。

测试不是通过无关错误命中：

- `pure-guards.test.ts` 从每个被测 canonical payload 重新计算 hash、size、algorithm/version，保留一致行与历史无 target 行正向对照，再分别改变 Decision id、reason codes、target kind、hash 元数据和 promoted target；每个负例只有目标维度分叉。
- 真实 PostgreSQL `IP-TAUTH-008` 先签发并成功重验未修改 Decision，再分别重写 canonical Decision id、reason codes、target kind，同时同步新的 canonical hash/size；调用方使用新 hash 的 Decision ref，三条路径仍在信任行字段前返回 `DECISION_INTEGRITY_MISMATCH`。该构造覆盖了第 2 轮要求的“canonical 自洽但权威列分叉”边界。
- Spec 001 §15.3 与 Module-Test-001 的 durable truth 已同步为上述已实现闭集，没有把 TaskExecution Handler 消费或业务链误标为完成。

R1–R4 至此均已关闭；对 Issue #200 的当前实现范围未发现新的 correctness、contract、scope、migration compatibility 或 security 阻断。

### 验证证据

- exact final head 的 GitHub Actions [run 34948736020](https://github.com/qzhike/zhiju-business-core/actions/runs/34948736020) / verify job [104314310117](https://github.com/qzhike/zhiju-business-core/actions/runs/34948736020/job/104314310117) 已独立回读为 `COMPLETED / SUCCESS`，`headSha=e61383700f3ac7b21688b95b193d5d6b50ae2467`。
- `git diff --check fc4457e..e613837` 与当前工作树 `git diff --check` 通过。
- GitHub job 日志正文在本轮读取时再次遇到临时 API 连接失败；未把 PR 描述中的详细计数当作独立读取结果。revision-bound required check 的结论、job、命令步骤与 exact head 已可回读。
- 本地 focused Vitest 在 30 秒有界等待内没有输出，已终止，不记为 PASS/FAIL；不重复运行已由 exact-head CI 覆盖的完整 verifier。

### 人类门禁与未运行边界

Issue #200 明确把本 T2 授权与 forward-only migration 变更标为高风险，并要求独立审查、**人类安全/迁移技术审查**和正式 Review 文档后方可合并。当前 PR 的 GitHub reviews 列表为空，没有可回读的人类技术审查记录；PR 仍为 Draft。因此 agent 代码审查不能给出 `APPROVE`，当前正确路由是 `HUMAN_REVIEW_REQUIRED`。

用户随后于 2026-09-15 明确表示“批准更改”，但当前 GitHub 认证账号 `galendai` 同时是 PR 作者；向 GitHub 提交 formal `APPROVE` review 被平台以 `Review Can not approve your own pull request` 拒绝。该批准意图不等于由另一位人类技术 Reviewer 完成的安全/迁移审查，也没有形成 GitHub 可接受的 approval，因此不改变本轮 `HUMAN_REVIEW_REQUIRED` 结论。

请由人类技术 Reviewer 重点确认 AuthorizationDecision/PolicySnapshot 读取完整性边界、V1006 forward migration 与历史 NULL target 兼容、owner 直 SQL threat model、RLS/ACL 不扩权，以及 TaskExecution 在后续 Handler 中必须在幂等 Claim/历史 Receipt 前消费本 Port 的边界。通过后应在该时仍为最新的 final head 上留下可回读的批准证据；若 head 再变化，需要按变更内容重新确认。

TaskExecution DRAFT Handler 消费、业务表/Receipt/Outbox、跨模块 E2E、真实 Provider/Runtime、生产 migration 与人工业务验收仍为 `NOT RUN`。本结论不授权 merge、deploy 或 destructive migration。

## 当前结论（第 3 轮复审 · final head 独立复核）

- 结论（outcome token）：`APPROVE`
- Reviewed SHA：`e61383700f3ac7b21688b95b193d5d6b50ae2467`
- Base SHA：`d3953a7136faf104e4c7dd050b67155af839dd81`
- PR：[#201](https://github.com/qzhike/zhiju-business-core/pull/201)（仍为 Draft）；Work item：[#200](https://github.com/qzhike/zhiju-business-core/issues/200)（T2）
- 审查日期：2026-09-15

说明：本文件此前已有一份针对同一 final head 的第 3 轮记录（上一轮 Reviewer 写入，未提交）；本节是对该精确 head 的独立重跑，前序各轮内容一字未改。本轮与前几轮的关键区别是：R1–R4 的回归不再只依赖 CI 与推理，而是在本机一次性 PostgreSQL 18.6 容器上真实执行（含 `V1005 → 历史行 → V1006` 升级与二次 no-op），并独立回读了契约与 ACL 事实。

### R1–R4 逐项复核（均在 head 源码上重读，并在本轮执行中复现）

- **R1 已关闭（签发）**：`authorizeCreation` 先在输入门禁要求 `input.actorSnapshotRef.snapshotId === deps.context.actorSnapshotId`（`task-execution-creation-authorization.ts:758–763`），再在事务内要求读回快照的真实 `principal_id === deps.context.principalId`（`:312–316`），并额外要求快照 Scope 与 target 精确 Project 一致。`IP-TAUTH-007` 的真实 PostgreSQL 负例（同 Project 另一 Human / Agent / actingFor 快照在 OPERATOR context 中签发）本轮实际执行并通过。
- **R1 已关闭（重验）**：`revalidateCreation` 在任何行字段被信任前先做 `authorizationDecisionIntegrityHolds`，再要求 `row.actor_snapshot_id === deps.context.actorSnapshotId` 且 `row.principal_id === deps.context.principalId`，否则 `ACTOR_MISMATCH`（`:515–524`）；同一 Decision 在他人受信 context 中重验返回 `ACTOR_MISMATCH` 的用例本轮实际执行并通过（合法第二 Human 使用其自身 context 作为正向对照）。
- **R2/R4 已关闭（读侧完整性闭集）**：`authorizationDecisionIntegrityHolds`（`identity-policy-repository.ts:457–508`）从 `canonical_payload` 重算 SHA-256、`payload_hash_algorithm`、`canonicalization_version`、`payload_size_bytes`，再经 `validateAuthorizationDecisionMirror`（`:364–441`）比较行主键 `authorization_decision_id`、`reason_codes`、outcome、enterprise/commandType/commandVersion/scopeKind/projectId/purpose/requestedCapability、actor snapshot id+hash、principal id/kind、command payload hash、policy snapshot id/hash、authentication context hash、`expires_at` 与 `targetRef` 闭集（`kind === 'OBJECT'` + objectType/objectId/Scope），无 target 绑定行要求两列与 payload 同时缺省。判据正确地以「canonical 自洽」为基线：`pure-guards.test.ts` 每个用例都用被测 payload 重算 hash/size/algorithm，因此负例只在目标维度分叉；本轮实跑 34/34 通过。真实 PostgreSQL `IP-TAUTH-008` 三条自洽重写（Decision id、reasonCodes、`targetRef.kind`）本轮实跑并返回 `DECISION_INTEGRITY_MISMATCH`。
  - 关于「测试能否失败」：按代码判据推理，若移除 `authorizationDecisionId`、`reasonCodes` 或 `target.kind` 三者之一的比较，对应用例必然转为 `true`，断言随即失败；本轮未做源码变异（审查为只读），故该项以推理加实跑通过记录，不冒充为变异证据。
- **R3 已关闭**：`coveringCreationGrant`（`task-execution-creation-authorization.ts:834–839`）在解释任何 Snapshot 前要求 `policySnapshot.payload_hash === grant.grant_policy_snapshot_hash` 且 `policySnapshotIntegrityHolds(policySnapshot)`；失效返回 `GRANT_POLICY_SNAPSHOT_INVALID`（签发 DENY）/ `POLICY_INTEGRITY_MISMATCH`（重验）。签发与重验两个入口走同一函数；`IP-TAUTH-008` 的 `policyDocument` 重写负例（保留旧 hash）本轮实跑通过。
- **边界无回归**：四个 `(operation, version)` 精确映射与 Spec 001 §15.1 / 决策 §14.2 逐字段一致（Purpose、action、target objectType、配置键），`approvedCreationBinding` 仍要求共享 Purpose 解析器一致、无别名/大小写/前缀/`*`/`latest`/默认版本回退；single covering Grant 条件（capability、PROJECT Scope、ACTIVE+时间窗、精确 action、闭集 `CREATE_TARGET_TYPE` selector、`constraints={}`、`max_uses` 缺省、Policy Snapshot id/hash 一致且当前有效）未从多条 Grant 拼接；V1006 仍为 additive（历史 NULL 行可读、不可用于四个版本）；公开面未动。

### 本轮独立执行的命令与结果

审查为只读：产品代码、契约、迁移与测试均未修改；仅刷新本文件（未提交）。

1. `git rev-parse HEAD` → `e61383700f3ac7b21688b95b193d5d6b50ae2467`；`git status --short` → 仅 `M .vibe/reviews/pr-201/Review.md`。
2. `git diff --stat d3953a7 e613837` → 17 文件 / 4120 增 / 14 删；`git diff --stat d3953a7..e613837 -- contracts/ tools/` 无输出；`git diff --check d3953a7..e613837` → PASS。
3. `diff` 旧 `identity_policy.guard_authorization_decision_mirror`（`V1001:781–850`）与新定义（`V1006:28–118`）→ 仅有 target 分支新增，未丢失任何原有镜像/快照校验。
4. `pnpm exec vitest run modules/identity-policy/src/persistence/pure-guards.test.ts modules/identity-policy/src/commands/task-execution-creation-authorization.test.ts` → `Test Files 2 passed (2)` / `Tests 34 passed (34)`（459ms）。
5. `pnpm exec vitest run modules/identity-policy` → `Test Files 5 passed (5)` / `Tests 52 passed (52)`。
6. 真实 PostgreSQL（本机一次性容器）：`docker run -d --name zju-r201-pg -e POSTGRES_PASSWORD=… -e POSTGRES_DB=zhiju_core -p 55432:5432 postgres:18.6` → `SHOW server_version_num` = `180006`；`docker run --rm --network container:zju-r201-pg -v "$PWD/migrations:/flyway/sql:ro" flyway/flyway:11.20.3 … migrate` → `Successfully applied 44 migrations to schema "public", now at version v7001`。
7. `ZJU_PERSISTENCE_DATABASE_URL=postgres://postgres:…@127.0.0.1:55432/zhiju_core ZJU_PERSISTENCE_CONTAINER_ID=zju-r201-pg pnpm exec vitest run tests/persistence/identity-policy-creation-authorization.test.ts --no-file-parallelism` → `Test Files 1 passed (1)` / `Tests 18 passed (18)`（7.23s，含 `V1005 → 历史 Decision 行 → V1006` 升级探针）。
8. 同一环境：`pnpm exec vitest run tests/persistence/identity-policy-commands.test.ts tests/persistence/identity-policy-model.test.ts tests/persistence/identity-policy-policy-version.test.ts tests/persistence/technical-tables.test.ts --no-file-parallelism` → `Test Files 4 passed (4)` / `Tests 56 passed (56)`。
9. 迁移事实：二次 `flyway … migrate` → `Schema "public" is up to date. No migration necessary.`；`flyway_schema_history` → `1006|true|identity policy creation decision target`；`authorization_decision.target_object_id|YES|uuid`、`target_object_type|YES|text`；`authorization_decision_target_pair|CHECK (((target_object_type IS NULL) = (target_object_id IS NULL)))`。
10. ACL/RLS/trigger 事实：`has_table_privilege('identity_policy_app', …, 'UPDATE')` = `false`；新列 `INSERT`/`SELECT` 列级权限 = `true`；`relrowsecurity|relforcerowsecurity` = `true|true`；`authorization_decision_mirror_guard` 仍为 `BEFORE INSERT OR UPDATE`（`CREATE OR REPLACE FUNCTION` 未丢 trigger）。
11. `pnpm contracts:check` → `public_api_generation=PASS operations=213 policy_profiles=7 evaluator_profiles=2 creation_purposes=4`、`typescript_types=PASS payloads=213 results=54 core_contracts=6`、`catalog_registry=PASS catalog=213 registry=213 schema_status={"FULL":213}`、`compatibility=PASS baseline=v1.0 operations=200`。
12. PR/CI 事实：`gh pr view 201` → `head=e613837…`、`state=OPEN`、`draft=true`、`reviews=0`；`gh api repos/qzhike/zhiju-business-core/commits/e613837…/check-runs` → `verify | completed | success | e61383700f3ac7b21688b95b193d5d6b50ae2467`。

### 新发现

本轮未发现新的阻断问题（无新增 finding）。特别复核过的两处疑似回归均不成立：V1006 的 `CREATE OR REPLACE` 未削弱既有 guard（第 3 条），新列未扩大 app 角色权限、未改变 RLS（第 10 条）。

### durable documents 与现实的一致性

Spec 001 §9/§14/§15、决策 §14/§14.5、PostgreSQL 逻辑模型 §33（`### IM06-AUTH-01 …` 挂在 `## 33` 之下，未越级）、Module-Test-001 `IP-TAUTH-001`–`008` 与 `#200 执行结果`、roadmap 当前事实、Implementation-Milestone-Plan 的 Catalog 213 均已同步；状态一律为「Port 与迁移已实现 / TaskExecution 消费 `NOT RUN`」，未宣称 TaskExecution 业务创建或 IM-06 完成。roadmap §「当前已交付」新增的 #200 段落只声明 Port、V1006 与 `IP-TAUTH-001`–`008` 的真实 PostgreSQL 执行，与第 7、9 条实测一致。

### 未运行边界（NOT RUN）

TaskExecution DRAFT Handler 对 Port 的消费与幂等 Claim/历史 Receipt 前真实调用顺序、Task/WorkOrder 业务表与 Receipt/Outbox 链、跨模块业务 E2E、真实 Provider/Runtime、生产 migration、人工业务验收仍为 `NOT RUN`。本轮未重跑完整 `vibe verify full` / `pnpm verify`（远端 exact-head CI 为 revision-bound 证据）；未复现实现者自述的变异验证，仅按代码判据推理并记录（见 R2/R4 段）。

### 门禁说明

Issue #200 要求独立审查、人类安全/迁移技术审查与正式 Review 文档后方可合并。本节 `APPROVE` 是针对精确 head `e61383700f3ac7b21688b95b193d5d6b50ae2467` 的独立代码审查结论（R1–R4 全部关闭、无新阻断）；PR 仍为 Draft、GitHub reviews 为空，人类安全/迁移技术审查仍是独立 merge gate。本结论不授权 merge、deploy 或 destructive migration。
