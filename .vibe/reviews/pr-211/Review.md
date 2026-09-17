# PR #211 独立审查

## 第 1 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`b8354cfeb562197630596fdf528510df90d7617d`
- Base SHA：`bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`
- PR：[#211](https://github.com/qzhike/zhiju-business-core/pull/211)
- Work item：[#210](https://github.com/qzhike/zhiju-business-core/issues/210)（T2 design）
- 审查日期：2026-09-17

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #210、PR 最新 head 与实际 diff、受影响的 TaskExecution/IdentityPolicy Module Spec/Test、IM-06 决定、Domain、Typed Reference/Catalog、PostgreSQL、共享 API 与 Core WorkOrder Contract、当前注册 Schema/Registry/兼容元数据、#200 创建授权实现和 V3001 创建事实 guard 先例，并在 exact head 上运行完整验证。未把实现者的 PR 描述或评论当作正确性依据。

## 阻断发现

### 1. Draft Snapshot 没有把存储内容绑定到创建请求的 `request_payload_hash`

Spec 003 §18.7 把 `work_order_draft_snapshot.canonical_payload` 定义为带 `snapshotId`、WorkOrder/Task Ref、Scope、`draft`、期限、捕获时间和创建人的 `WorkOrderDraftSnapshot`，其 `payload_hash` 因而覆盖这份快照；Receipt 的 `request_payload_hash` 则覆盖 `create_work_order` 请求 payload `{draft, expiresAt?}`，两者按定义不是同一个 Hash。

当前双 guard 只要求：mirror guard 重算整个 Snapshot 的 `payload_hash`；creation-identity guard 比较 Receipt `request_payload_hash` 与快照行的同名列。它没有从 `canonical_payload.draft` 与 `expiresAt` 重建规范创建请求并重算其 Hash，也没有其他约束把这两份内容逐字段绑定。因此，在一条合法 `PENDING` Receipt 的事务内，写入者可以保存另一份自洽的 `draft`，同时把 Receipt 的原请求 Hash 原样复制到 `request_payload_hash` 列；两个 guard 都会通过，但存储的 DRAFT 从未由该命令提交。

这也使 §18.7 “复用 Receipt 换内容不能成立”的结论和 `TE-P210-017` 不成立。V3001 已把同类风险作为阻断修复：Task Definition Snapshot 的规范 payload 与命令请求逐字节相同，guard 强制 Receipt `request_payload_hash = snapshot.payload_hash`。WorkOrder Snapshot 增加了派生元数据，不能直接复用该等式，必须明确定义并由数据库 guard 重建/验证创建请求投影，至少覆盖 `draft` 与 `expiresAt` 的字段存在性和值；同时加入“同一在途 Receipt 换另一份 draft 内容”的单变量反例。

### 2. Human-only 检查没有从 `CapabilityGrant` 定义出可执行映射，且指定了不存在的共享错误码

`WorkOrderDraft.allowedCapabilities[]`/`deniedCapabilities[]` 的元素是 Core `CapabilityGrant`，字段为 `capabilityType`、`actions[]`、`resourceSelectors[]`、`constraints[]`、`expiresAt`、`grantPolicyRef`；其中没有 `capabilityCode`。Spec 003 §18.5 和 `TE-P210-010` 却只说检查“任一 capability code”，没有固定 Human-only Registry 应检查 `capabilityType`、每个 `actions[]`，还是两者的组合，也没有定义两侧集合“同一 capability”的精确相等键。实现者仍需自行发明安全语义。

同时，设计要求拒绝码为“共享 `HUMAN_ONLY_CAPABILITY`”，但当前权威和实现中没有该错误码：IdentityPolicy 模块稳定码是 `IDENTITY_CAPABILITY_HUMAN_ONLY`，授权 Decision reason 是 `CAPABILITY_HUMAN_ONLY`，`identity.check_human_only_capability@1.0` 返回 `AccessDecision`。§18.11 又声明本切片只新增两个 WorkOrder 错误码，不能在未登记第三个码的情况下复用不存在的共享码。

要求：在 owning 契约中固定从完整 `CapabilityGrant` 到 Human-only 检查输入的逐字段算法、`allowed`/`denied` 冲突判定键、检查顺序与依赖失败语义；选择一个现有且权威的外部错误映射，或把确需的新码明确列入 Delta/注册与测试范围。更新 `TE-P210-D-005`/`TE-P210-010`，使正负基线使用完整合法 `CapabilityGrant`，而不是未定义的“capability code”。

### 3. WorkOrder 创建身份与并发占用的错误码在同一设计内互相矛盾

- Spec 003 §18.2/§18.11 与 `TE-P210-004` 要求 WorkOrder 拼写、kind、id、Scope 不闭合统一为 `EXECUTION_WORK_ORDER_REF_INVALID`；但 #200 已交付的 `TaskExecutionCreationAuthorizationPort` 会在 Handler 和幂等 Claim 之前按 `(type@version)` 拒绝错误 target，稳定外观是 `IDENTITY_CREATION_TARGET_INVALID`，而 @1.1 的 legacy target 还会先被注册 Schema 拒绝。当前测试矩阵只给裸名/大小写变体保留了发生层例外，无法执行它声称的统一结果。
- §18.4、§18.9、§18.11 和 `TE-P210-015` 都把已占用或并发同 target 映射为新增 `EXECUTION_WORK_ORDER_ALREADY_EXISTS`，但 §18.11 的共享码行又把“目标已被占用”映射为 `CONCURRENCY_CONFLICT`。

要求：按真实层次分别固定 Schema、IdentityPolicy 创建授权 Port 与 owning Handler 的错误外观，并让每个反例从可到达的合法基线开始；同一 target 的已存在/并发语义只保留一个稳定码。否则实现与验收可各自选择不同分支，Issue #210 要求的 stable error behavior 尚未闭合。

## 验证证据

- 远端 PR head 回读：`b8354cfeb562197630596fdf528510df90d7617d`，base `bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`，PR `OPEN`、`MERGEABLE`；GitHub Actions `verify` 对该 head 为 `SUCCESS`。
- 本地首次执行 `vibe verify full --json` 时，格式、lint、typecheck、普通测试、架构与契约检查通过，但当前 shell 无容器 runtime strategy，persistence gate 未启动；该结果只记录为环境失败。
- 按环境恢复规则做只读预检：OrbStack Docker 29.4.0 可用，PostgreSQL 18.6 与 Flyway 11.20.3 的 digest 固定镜像均在本地缓存。
- 在同一 reviewed SHA、未修改 verifier 的情况下以可访问的 OrbStack socket 重新执行 `vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。
- 普通 suite：98 files（60 passed / 38 skipped）、1434 tests（1010 passed / 424 skipped）；真实 PostgreSQL 18.6 persistence gate：42 files / 439 tests 全部通过；空库迁移、V6002 历史数据升级到 V6004、全部迁移至 V7001、二次 migrate no-op 均通过；Catalog/Registry 214、Compatibility Baseline 200。
- `git diff --check bbfd2ceaab21d0d346d6f405be7f216bc6cdd276..b8354cfeb562197630596fdf528510df90d7617d` 通过。

绿色 verifier 证明既有实现与静态契约未回归，但本 PR 是尚未实现的设计 Delta；它不能证明上述未来 guard、Capability 映射或错误路由正确。

## 未运行边界与后续门禁

WorkOrder DRAFT Handler、`work_order`/`work_order_draft_snapshot` migration、读取 Handler/组成层、IdentityPolicy 读取授权条目、`TE-P210-001`–`023`、WorkOrder 校验/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、外部 Provider/Runtime/飞书与人工业务验收均保持 `NOT RUN`。

Issue #210 还要求在修复上述设计阻断后，对新的 exact final revision 重新独立设计审查，并取得明确的人类设计批准；这两个门禁都不能由当前绿色 CI 或本轮 `REQUEST_CHANGES` 替代。本轮没有在 Reviewer 角色内修复设计正文或业务代码，也不授权 commit、push、merge 或 deploy。

## 第 2 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`c1b7eeec0cfc31322b16beebc00772c89c633b90`
- Base SHA：`bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`
- PR：[#211](https://github.com/qzhike/zhiju-business-core/pull/211)
- Work item：[#210](https://github.com/qzhike/zhiju-business-core/issues/210)（T2 design）
- 审查日期：2026-09-17

本轮重新读取了远端最新 head、Issue #210、完整 PR diff、`b8354cf` 之后的修复增量、受影响契约与当前实现先例，并在 exact head 上重新运行项目配置的完整验证。上一轮三项阻断中，创建请求投影 Hash、`CapabilityGrant.capabilityType` 映射与创建错误码分层均有实质修复，但修复后的设计仍有下列两个可执行性/完整性阻断。

### 阻断 1：双 guard 没有把请求内 `draft.taskRef`、Snapshot header `taskRef` 与 Root Task 绑定为同一身份

§18.7 新增的创建请求投影能证明 `canonical_payload.draft` 与来源 Receipt 的请求 payload 相同，但 Snapshot 另外还有顶层 `canonical_payload.taskRef`，Root 又保存独立的 `task_id`/`task_object_type`。当前双 guard 只明确校验顶层拼写/Scope 镜像、`task_object_type` 对被绑定 Task 的创建事实，以及请求投影 Hash；没有要求以下三者逐字段相等：

1. `canonical_payload.draft.taskRef`；
2. `canonical_payload.taskRef`；
3. Root 的 `task_id`/`task_object_type`/Project Scope。

直接反例：合法在途 Receipt 的原请求 draft 指向 Task A；直 SQL 写入时保留这份原始 `draft`（所以创建请求投影 Hash 仍匹配 Receipt），但令 Snapshot 顶层 `taskRef` 与 Root 的 Task 镜像都指向同 Scope、创建事实自洽的 Task B。按当前文字，payload Hash、请求投影 Hash、顶层 mirror、Task B 创建事实和 WorkOrder Receipt 都可以分别通过，但持久化 Root 被绑定到从未出现在创建请求中的 Task B。这违反 R-210-2，也与 §11.2.1 已有的“`draft.taskRef` 与 Snapshot `taskRef` 一致”规则冲突。

要求：在 §18.7/PostgreSQL §33 的数据库 guard 中明确把 inner draft、Snapshot header、Root mirrors 与被查验 Task 的 kind/objectType/objectId/Scope 全等闭合，并在 `TE-P210-017` 加入上述单变量直 SQL 反例。不能只依赖 Handler 先验校验，因为该场景正是数据库直写完整性 Gate。

### 阻断 2：Human-only 分类 Port 的返回契约无法提供它要求 TaskExecution 审计的 registry version

Spec 001 §15.7 把 Port 的外部结果闭合为单一 `'VALID' | 'INVALID'`，同时要求 IdentityPolicy 记录分类集合版本，并要求 TaskExecution 把“本次分类实际使用的 registry version”写入自己的 Audit。只有 outcome 时，TaskExecution 无法知道 owning Port 实际使用的版本；若在 TaskExecution 内硬编码或直接读取 `HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION`，又会绕过本节明确建立的 owning Port/模块边界，并在 IdentityPolicy 升级版本时产生不可验证的错误归因。

要求：让 Port 返回可归因的 owning 结果（至少 outcome + 实际 registry version），或把审计所有权改为一个无需跨边界复制版本事实的自洽方案；同时在 `TE-P210-010` 覆盖正向、Human-only 拒绝与依赖失败分支的版本归因。当前 `TE-P210-010` 只断言结果码和副作用，没有证明这项新审计要求可实现。

### 对第 1 轮错误码表述的更正

第 1 轮 Finding 2 中“当前权威没有共享码 `HUMAN_ONLY_CAPABILITY`”的表述不正确：共享 API §8 的既有错误码列表确实包含该码，Domain `WO-U-002` 也使用它。当前 revision 沿用该共享码是正确的；需要保留的原问题仅是旧 revision 缺少从完整 `CapabilityGrant` 到 Human-only 分类输入的映射。历史第 1 轮记录保持原文，本节明确更正，不把 Reviewer 的错误归因继续当作修复要求。

## 第 2 轮验证证据

- 远端与本地 exact head：`c1b7eeec0cfc31322b16beebc00772c89c633b90`；base `bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`；PR `OPEN`、`MERGEABLE`，GitHub Actions `verify` 为 `SUCCESS`。
- `git diff --check bbfd2ceaab21d0d346d6f405be7f216bc6cdd276..c1b7eeec0cfc31322b16beebc00772c89c633b90`：PASS。
- exact-head `vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。
- 普通 suite：98 files（60 passed / 38 skipped）、1434 tests（1010 passed / 424 skipped）；真实 PostgreSQL 18.6 persistence gate：42 files / 439 tests 全部通过；空库迁移、历史升级至 V7001、二次 migrate no-op 均通过；Catalog/Registry 214、Compatibility Baseline 200。
- `tests/persistence/task-readiness.test.ts` 的已授权卫生修复只把既有 `TE-P206-012` 场景预算从默认 5s 改为显式 30s，断言与业务场景未改变，本轮不把它列为阻断。

绿色 verifier 证明当前已实现行为未回归，但 WorkOrder 表、guard、Human-only 分类 Port 与 `TE-P210-001`–`023` 都尚未实现，因此不能覆盖上述设计反例。

## 第 2 轮未运行边界与门禁

WorkOrder DRAFT Handler、`work_order`/`work_order_draft_snapshot` migration、读取 Handler/组成层、IdentityPolicy 读取/分类 Port、`TE-P210-001`–`023`、WorkOrder 校验/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、外部 Provider/Runtime/飞书与人工业务验收继续保持 `NOT RUN`。

本轮仍未发现 exact head 的显式人类设计批准。由于存在上述两个 agent-fixable 阻断，当前结论先保持 `REQUEST_CHANGES`；修复后的新 head 仍需重新独立审查，随后才进入 Issue #210 明确要求的人类设计批准门禁。本轮未修改设计正文或业务代码，也不授权 commit、push、merge 或 deploy。

## 第 3 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`5ca6934597e5a78774882ab31195b66a47bb34e4`
- Base SHA：`bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`
- PR：[#211](https://github.com/qzhike/zhiju-business-core/pull/211)
- Work item：[#210](https://github.com/qzhike/zhiju-business-core/issues/210)（T2 design）
- 审查日期：2026-09-17

本轮重新读取了远端最新 head、Issue #210、完整 PR diff、`c1b7ee` 之后的修复增量、受影响权威与当前持久化先例，并在 exact head 上重新运行项目配置的完整验证。第 2 轮的两个阻断已经实质关闭：四处 Task 身份由数据库 guard 全等绑定，Human-only owning Port 也改为返回并审计 `{outcome, classificationRegistryVersion}`。复审仍发现一项新的持久化归属完整性阻断。

### 阻断：双 guard 没有把请求主体、快照创建者、Root 归属与来源 Receipt 主体绑定为同一 Principal

§18.5 第 2 条要求 `draft.requestedBy` 恰好等于认证 principal；§18.7 又把 Root 的 `created_by_principal_id`/`requested_by_principal_id` 定义为受信归属，并把 Snapshot `canonical_payload.createdBy` 作为不可变事实保存。PostgreSQL §4.1 第 8 条进一步规定 `created_by_principal_id` 必须来自当前受信事务 Context，调用者不能写入另一主体。

当前创建请求投影只覆盖 `{draft, expiresAt?}`，所以它能证明 `draft.requestedBy` 来自 Receipt 所绑定的原请求；但 §18.7 的双 guard 明确闭合的是 Receipt/WorkOrder 版本与身份、请求投影 Hash、期限以及 Task 身份，没有要求下列归属逐项相等：

1. `canonical_payload.draft.requestedBy`；
2. Snapshot header `canonical_payload.createdBy`；
3. Root `created_by_principal_id` 与 `requested_by_principal_id`；
4. 来源 `command_receipt.created_by_principal_id`（以及已建立的受信事务 Context Principal）。

因此存在直 SQL 反例：先取得主体 P1 的合法 `PENDING` Receipt，并保持原始 `draft.requestedBy=P1` 与全部 WorkOrder/Task/Scope/Hash 字段不变；写入时把 Snapshot `createdBy` 和 Root 两个 principal id 都改为 P2，并据此重算完整 Snapshot `payload_hash`。创建请求投影 Hash 仍与 Receipt 相等，mirror guard 内部自洽，现有 creation-identity 与 Task guard 也都可以通过，但权威 Root/Snapshot 会把 P2 记为从未发起该命令的创建者/请求者。这违反 Issue #210 的 creator/requester attribution 与 direct-SQL integrity guard 验收边界，也违反 PostgreSQL §4.1 的通用来源规则。

要求：在 creation-identity guard 中把请求、Snapshot、Root、Receipt 与受信事务 Context 的 Principal 归属闭合为同一事实；至少强制 `draft.requestedBy`/`createdBy` 的 Principal 身份与 Root 两个 principal id、Receipt `created_by_principal_id` 一致，并保持 Scope 闭合。将上述 P1→P2 单变量反例及 created/requested 分别不一致的反例加入 `TE-P210-017`；`TE-P210-009` 的 Handler/Decision 替换场景不能替代数据库直写完整性测试。

## 第 3 轮验证证据

- 远端与本地 exact head：`5ca6934597e5a78774882ab31195b66a47bb34e4`；base `bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`；PR `OPEN`、`MERGEABLE`，GitHub Actions `verify` 为 `SUCCESS`。
- `git diff --check bbfd2ceaab21d0d346d6f405be7f216bc6cdd276..5ca6934597e5a78774882ab31195b66a47bb34e4`：PASS。
- exact-head `vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。
- 普通 suite：98 files（60 passed / 38 skipped）、1434 tests（1010 passed / 424 skipped）；真实 PostgreSQL 18.6 persistence gate：42 files / 439 tests 全部通过；空库迁移、历史升级至 V7001、二次 migrate no-op 均通过；Catalog/Registry 214、Compatibility Baseline 200。

绿色 verifier 证明当前已实现行为未回归，但 WorkOrder 表、归属 guard 与 `TE-P210-001`–`023` 尚未实现，因此不会执行或发现上述设计中的 P1→P2 直写反例。

## 第 3 轮未运行边界与门禁

WorkOrder DRAFT Handler、`work_order`/`work_order_draft_snapshot` migration、读取 Handler/组成层、IdentityPolicy 读取/分类 Port、`TE-P210-001`–`023`、WorkOrder 校验/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、外部 Provider/Runtime/飞书与人工业务验收继续保持 `NOT RUN`。

本轮仍未发现 exact head 的显式人类设计批准。当前先以新的 agent-fixable 归属完整性阻断给出 `REQUEST_CHANGES`；修复后的新 head 必须重新独立审查，通过后才进入 Issue #210 明确要求的人类设计批准门禁。本轮未修改设计正文或业务代码，也不授权 commit、push、merge 或 deploy。

## 第 4 轮：`REQUEST_CHANGES`

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`a85d74a40f004b2664b0701c323d9563180ccf24`
- Base SHA：`bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`
- PR：[#211](https://github.com/qzhike/zhiju-business-core/pull/211)
- Work item：[#210](https://github.com/qzhike/zhiju-business-core/issues/210)（T2 design）
- 审查日期：2026-09-17

本轮重新读取了远端最新 head、Issue #210、`5ca6934` 之后的修复增量、受影响权威、现有 transaction context/角色默认权限与 `V3000` Receipt 事实，并在 exact head 上重新运行项目配置的完整验证。第 3 轮要求的 `draft.requestedBy`、Snapshot `createdBy`、Root 两个 principal id 与 Receipt `created_by_principal_id` 的字段间等值关系已经补齐，相关 P1→P2 与字段间不一致场景也加入 `TE-P210-017`；但修复把一个当前可由 app 角色伪造的 Receipt 列误当作受信 Context 的数据库证明，因此第 3 轮的“闭合到受信事务 Context”仍未成立。

### 阻断：Receipt `created_by_principal_id` 不是数据库受信锚，guard 没有直接绑定当前 transaction Context

当前修复声称 Receipt `created_by_principal_id` “由受信事务 Context 产生，调用者不能改写”，并据此让 Root/Snapshot/requester 全部与该列相等。但是现有数据库事实相反：

1. `V0002__schema_roles_baseline.sql` 默认向 `task_execution_app` 授予新表的 `SELECT, INSERT, UPDATE`；
2. `V3000__task_execution_technical_tables.sql` 的 `command_receipt_insert` policy 只检查 `context_allows_enterprise/project`，没有检查 `created_by_principal_id = platform_security.context_principal_id()`；
3. `command_receipt` 没有 creator mirror trigger/guard，仓库层 `assertEnvelopeMatchesContext` 只保护正常 runner 路径，不能作为 direct-SQL Gate；
4. 当前 transaction context 只在数据库保存 `principal_id`，不保存 `principalKind`。`context_kind()` 是 `REQUEST`/`EVENT_CONSUMER`，不是 PrincipalKind。

因此存在仍可达的直 SQL 反例：在受信 P2 transaction Context 下，以 `task_execution_app` 在同一允许 Project 插入一条 `PENDING` Receipt，把其 `created_by_principal_id` 写为 P1，并令请求 Hash 对应 `draft.requestedBy=P1`；随后让 Snapshot `createdBy=P1`、Root 两个 principal id=P1，其他 WorkOrder/Task/Scope/Hash 全部自洽。新增的所有等值检查与 RLS 都会通过，因为它们只证明多份 caller-writable 数据彼此相等，没有任何一项直接比较 `platform_security.context_principal_id()`。同理，把两个 JSON PrincipalRef 都写成同一错误 `principalKind` 时，当前 guard 只会确认两个不受信副本相等，不能证明该 kind 来自认证主体。

要求：不能把现有 Receipt creator 列描述成不可伪造的 Context 来源。WorkOrder creation guard 至少必须直接要求 Receipt/Root/requester 的 principal id 等于 `platform_security.context_principal_id()`，并在 `TE-P210-017` 增加“P2 Context 内伪造 created_by=P1 的同 Scope PENDING Receipt，随后所有归属副本一致为 P1”的 app-role 反例。对于 `principalKind`，设计还必须指定一个数据库可验证的受信来源并覆盖“id 与 Context 相同、两个 JSON kind 同时伪造成另一 kind”的反例；若当前 transaction-context 合同不足以提供该事实，应明确进入相应的 scope/规划门禁，而不是把两个不受信 JSON 副本互相比对后称为已闭合到 Context。

## 第 4 轮验证证据

- 远端与本地 exact head：`a85d74a40f004b2664b0701c323d9563180ccf24`；base `bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`；PR `OPEN`、`MERGEABLE`，GitHub Actions `verify` 为 `SUCCESS`。
- `git diff --check bbfd2ceaab21d0d346d6f405be7f216bc6cdd276..a85d74a40f004b2664b0701c323d9563180ccf24`：PASS。
- exact-head `vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。PostgreSQL 镜像首次 pull 出现一次 Docker Hub TLS handshake timeout，已按 gate 内置重试恢复，未修改 verifier。
- 普通 suite：98 files（60 passed / 38 skipped）、1434 tests（1010 passed / 424 skipped）；真实 PostgreSQL 18.6 persistence gate：42 files / 439 tests 全部通过；空库迁移、历史升级至 V7001、二次 migrate no-op 均通过；Catalog/Registry 214、Compatibility Baseline 200。

绿色 verifier 证明当前已实现行为未回归，但 WorkOrder migration/guard 与 `TE-P210-001`–`023` 尚未实现；现有测试不会执行上述“同 Scope forged Receipt + 一致伪造归属”的未来设计反例。

## 第 4 轮未运行边界与门禁

WorkOrder DRAFT Handler、`work_order`/`work_order_draft_snapshot` migration、读取 Handler/组成层、IdentityPolicy 读取/分类 Port、`TE-P210-001`–`023`、WorkOrder 校验/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、外部 Provider/Runtime/飞书与人工业务验收继续保持 `NOT RUN`。

本轮仍未发现 exact head 的显式人类设计批准。当前存在可由 agent 修复的数据库信任锚阻断，因此结论为 `REQUEST_CHANGES`；若修复 PrincipalKind 需要改变现有 platform transaction-context 合同，则须先进入相应的 scope/规划门禁。新 head 仍需重新独立审查，通过后才进入 Issue #210 明确要求的人类设计批准。本轮未修改设计正文或业务代码，也不授权 commit、push、merge 或 deploy。

## 第 5 轮：`SCOPE_EXPANSION`

- 结论：`SCOPE_EXPANSION`
- Reviewed SHA：`9b34f07790deffd2df2e32b2b8762a6be62932c4`
- Base SHA：`bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`
- PR：[#211](https://github.com/qzhike/zhiju-business-core/pull/211)
- Work item：[#210](https://github.com/qzhike/zhiju-business-core/issues/210)（T2 design）
- 审查日期：2026-09-17

本轮重新读取了远端最新 head、Issue #210、`a85d74a` 之后的修复增量、受影响权威、现有 platform transaction-context 合同、测试矩阵与当前 revision 的验证证据。第 4 轮的 principal-id 信任锚阻断已经实质关闭：WorkOrder 两表的 INSERT policy 与 creation guard 都直接比较 `platform_security.context_principal_id()`，Receipt creator 只被要求等于 Context 而不再被当作证明；`TE-P210-017` 也加入了 P2 Context 内 forged P1 Receipt 的 app-role 反例。

但修复同时确认：`PrincipalRef.principalKind` 在当前 platform transaction-context 合同中没有数据库可验证来源。当前提案把该事实留作“依赖实现的 scope/规划门禁”，并允许人类批准时选择接受“id 层 Context 锚定 + kind 仅应用层证明”的残余。该处理说明正确交付已物质依赖 Issue #210 未声明的平台契约范围，因此本轮不再是可由 TaskExecution 文档内修补的 `REQUEST_CHANGES`，而是 `SCOPE_EXPANSION`。

### 必需的范围扩展

- **当前声明范围**：IM-06 决定、TaskExecution Module Spec/Test，以及相关 Domain、Typed Reference/Catalog、API compatibility、PostgreSQL logical model、roadmap；不包含 platform transaction-context 合同或其 bootstrap migration。
- **必需新增范围**：为受信事务上下文提供数据库可验证的 PrincipalKind（例如等价的 `principal_kind` 事实和只读 helper），同步其建立/读取权限、跨模块兼容性、迁移与真实 PostgreSQL 隔离/池复用/伪造负例；随后让 WorkOrder guard 把两份 payload 的完整 `PrincipalRef`（id + kind）绑定到该受信事实。
- **为什么必需**：Core `PrincipalRef` 恰由 `principalId` + `principalKind` 组成。Issue #210 要求精确绑定认证 principal、ActorSnapshot/Decision、`draft.requestedBy`、creator/requester attribution，并要求 direct-SQL integrity guards；一个 Agent/Service Context 仍可通过 direct SQL 把两份 JSON kind 同时写成 `HUMAN`，当前 guard 只证明两个不受信副本相等。即使后续动作按 principal id 重新授权，这份不可变 DRAFT 的 creator/requester attribution 已不真实，且本 Issue 的“闭合”验收未满足。

“由人类批准接受残余”不是当前 Issue 下的完成路径：人类技术批准评审的是闭合设计，不能在未修改 work item/权威语义的情况下隐式放宽精确归属与 direct-SQL integrity 验收。若产品/架构确实选择 application-only kind 证明，Planner 必须先把这一降级作为明确、耐久的语义决定和风险接受写入适当 authority，并重新分类/定界；否则应扩展 platform transaction-context 范围后再提交新的 exact revision。

## 第 5 轮验证证据

- 远端与本地 exact head：`9b34f07790deffd2df2e32b2b8762a6be62932c4`；base `bbfd2ceaab21d0d346d6f405be7f216bc6cdd276`；PR `OPEN`、`MERGEABLE`，GitHub Actions `verify` 为 `SUCCESS`。
- `git diff --check bbfd2ceaab21d0d346d6f405be7f216bc6cdd276..9b34f07790deffd2df2e32b2b8762a6be62932c4`：PASS。
- exact-head `vibe verify full --json`：`PASS`，resolved command `pnpm clean && pnpm verify`，exit 0。
- 普通 suite：98 files（60 passed / 38 skipped）、1434 tests（1010 passed / 424 skipped）；真实 PostgreSQL 18.6 persistence gate：42 files / 439 tests 全部通过；空库迁移、历史升级至 V7001、二次 migrate no-op 均通过；Catalog/Registry 214、Compatibility Baseline 200。

绿色 verifier 证明当前已实现行为未回归，但 WorkOrder migration/guard 与 `TE-P210-001`–`023` 尚未实现，也不验证尚不存在的 PrincipalKind transaction-context 事实。

## 第 5 轮未运行边界与路由

WorkOrder DRAFT Handler、`work_order`/`work_order_draft_snapshot` migration、读取 Handler/组成层、IdentityPolicy 读取/分类 Port、`TE-P210-001`–`023`、WorkOrder 校验/冻结、首次 Context、Run/Attempt/Result、InformationRequest、Completion、Query/Projection、外部 Provider/Runtime/飞书与人工业务验收继续保持 `NOT RUN`。

当前 revision 不应直接进入 Issue #210 的普通人类设计批准或依赖实现 Issue。应先由 Planner/架构 authority 处理 scope/classification：选择并批准 platform transaction-context 扩展，或明确修改 authoritative acceptance 以接受 application-only kind 证明及其不可变归属残余。完成该决定并形成新的闭合 exact revision 后，必须重新独立审查；安全敏感设计的人类技术批准随后仍然必需。本轮未修改设计正文或业务代码，也不授权 commit、push、merge 或 deploy。
