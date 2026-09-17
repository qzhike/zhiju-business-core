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
