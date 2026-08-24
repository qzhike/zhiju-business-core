# IM-02 Issue #28 验收报告

## 1. 结论

截至 2026-08-24，PR #51 已合并到 `main`，但合并后干净默认分支的独立 Persistence Gate 暴露了测试隔离竞态。当前不能把 Issue #28 标记 COMPLETE，也不能关闭，结论为：

> 本地核心实现：修复分支自动化 Gate/Probe PASS；默认分支复验已发现并修复测试隔离缺陷，待跟进 PR 合并后复验；IM-02 Issue #28：PARTIAL，保持 OPEN。

仍未满足的退出条件不是本地代码门禁，而是交付与验收边界：

1. PR #46–#51 已显示 MERGED，PR #51 的合并提交为 `8f5c0701ace93ce88ec55acde753e5abcd07fa2c`；当前需要为 Gate 隔离修复创建新的跟进 PR，不能修改已合并历史。
2. 合并后的干净 `main` 首次完整验证中，内嵌 Gate 通过，但随后独立 Gate 在 WI-09 DENY Audit 写入处失败；失败记录见 [Main-Closeout-Failure-2026-08-24.md](./Main-Closeout-Failure-2026-08-24.md)。
3. 真实 Keycloak/OIDC、OpenBao、飞书、生产 Broker/Provider、跨模块 HTTP/业务 E2E、生产负载和用户最终人工业务验收没有执行，继续保持 NOT RUN。
4. 本地脚本 Probe 是可重复的自动化/脱敏 Fixture 证据，不等同于用户亲自按 Runbook 完成最终人工验收。

因此，本报告证明“当前本地集成代码已解决已发现的阻塞缺陷并通过可复现门禁”，不把本地结果冒充为默认分支已完成或 Issue 可直接关闭。

## 2. 验收对象与 Git 边界

| 项目 | 实际值 |
|---|---|
| 工作树 | galendai/28-im-02-postgresql-foundation-identitypolicy |
| HEAD | `47a2a9d` (`fix: repair IM-02 PostgreSQL and IdentityPolicy acceptance gates`) |
| origin/main | 505a7020b171739a88830b55cb84a94f7afb6fb3 |
| 远端跟踪分支 | `origin/galendai/28-im-02-postgresql-foundation-identitypolicy` → `47a2a9d` |
| 本地集成方式 | 保留 WI-06–WI-10 stacked history，并以 `47a2a9d` 作为验收修复提交 |
| 顶层 PR 栈 | PR #46–#50；跟进交付 PR [#51](https://github.com/qzhike/zhiju-business-core/pull/51) |
| Git commit/push/merge | commit `47a2a9d` 已 commit/push；PR #51 尚未 merge |
| Issue #28 | OPEN；本报告不关闭 Issue |
| Node.js / pnpm | v24.19.0 / 11.19.0 |
| Docker | 29.4.0 |
| 数据库 | 每次 Gate/Probe 均为 disposable local database；未连接生产环境 |

`origin/main` 仍停留在 `505a702`，而远端跟踪分支已包含 `47a2a9d`；这正是 PR #51 尚未合并前的预期状态。当前文档同步完成后，工作树应保持干净；不得把 PR #51 创建或本地验证 PASS 解释为默认分支已完成。

## 3. Issue #28 前置 Work Item 与默认分支

GitHub 核对结果：#29–#38 均为 CLOSED；PR #39/#41/#43/#44/#45 已合入 main。PR #46–#50 的代码已在各自前序 feature branch 合并；PR #51 是把当前集成结果带入 main 的跟进交付入口。

| Work Item | Issue | PR | PR base | GitHub 状态 | 当前 origin/main 结论 |
|---|---:|---:|---|---|---|
| WI-01 | #29 | #39 | main | CLOSED / MERGED | PASS |
| WI-02 | #30 | #41 | main | CLOSED / MERGED | PASS |
| WI-03 | #31 | #43 | main | CLOSED / MERGED | PASS |
| WI-04 | #32 | #44 | main | CLOSED / MERGED | PASS |
| WI-05 | #33 | #45 | main | CLOSED / MERGED | PASS |
| WI-06 | #34 | #46 | WI-05 branch | CLOSED / MERGED | FAIL：未进入 main |
| WI-07 | #35 | #47 | WI-06 branch | CLOSED / MERGED | FAIL：未进入 main |
| WI-08 | #36 | #48 | WI-07 branch | CLOSED / MERGED | FAIL：未进入 main |
| WI-09 | #37 | #49 | WI-08 branch | CLOSED / MERGED | FAIL：未进入 main |
| WI-10 | #38 | #50 | WI-09 branch | CLOSED / MERGED | FAIL：未进入 main |
| 集成交付 | #28 | [#51](https://github.com/qzhike/zhiju-business-core/pull/51) | main | OPEN | CI PASS；复审无新增语义发现；等待 merge |

此前的 ancestor 核对对 WI-06–WI-10 均返回 NOT_IN_MAIN。所以“所有前置 Issue 已关闭”不能单独满足 Issue #28 的“对应 PR 已合入默认分支”条件。

## 4. 本轮发现并修复的代码/Probe 缺陷

### 4.1 WI-09 授权 Scope 精确匹配

原实现允许同 Enterprise 的 Enterprise-scope Grant 覆盖 Project Intent，造成 Project A/B 隔离被越权绕过。修复内容：

- authorizeCommand 的 Grant 覆盖判断现在同时匹配 scope_kind、enterprise_id 和 project_id；Enterprise Grant 只能覆盖 Enterprise Intent，Project Grant 只能覆盖同一 Project Intent。
- Access effective roles/grants 查询使用同样的精确 Scope 条件，不再把 Enterprise Grant 列为 Project Intent 的有效事实。
- 新增真实 PostgreSQL 回归：Human 只拥有 Enterprise Grant，创建 Project A2 Actor/Intent 后得到 DENY，理由包含 NO_ACTIVE_GRANT。

### 4.2 WI-10 Outbox typed Aggregate ordering

原实现的 earliest-unpublished 子查询只比较 aggregate_id。不同 Aggregate Type 复用同一 UUID 时，一个 Type 的旧版本会错误阻塞另一个 Type。修复后顺序键为：

    aggregate_type + aggregate_id + aggregate_version

新增真实 PostgreSQL 回归：DemoTypeA 与 DemoTypeB 使用同一 aggregate_id，两个事件均能独立 claim 并确认发布。

### 4.3 WI-10 Foreign Enterprise Quarantine Scope

原实现只检查 Event Project 是否在当前 allow-list，未同时检查 Event Enterprise。Foreign Enterprise 恰好携带本地 allow-list Project UUID 时，可能把未经验证的 Project mirror 写入 Quarantine/Violation。修复后只有以下条件同时成立才保留 Project：

- Event Enterprise 等于受信 transaction Context Enterprise；
- Event Project 存在；
- Event Project 属于当前 Context 的 allowedProjectIds。

否则 Quarantine/Violation 使用受信 Context Enterprise，project_id=NULL。新增真实 PostgreSQL 回归已断言 SCOPE_CONFLICT 以及 Inbox/Violation 的 project_id=NULL。

### 4.4 Local Probe Fixture 修复

- WI-07 AES-256-GCM 测试 Port 先执行 cipher.update()/cipher.final()，再读取 getAuthTag()；修复了 Probe 自身的 ERR_CRYPTO_INVALID_STATE。
- WI-10 Principal Fixture 显式设置 status='ACTIVE'，不依赖不存在的数据库默认值。
- WI-02–WI-04 Runbook 修订了 pg_ 预定义角色过滤、32 字节 hash fixture、COMMIT 后重新切换 app role、容器内 migration walker，以及 privileged audit seed 的 masked-view 验收。

### 4.5 WI-09 DENY Audit 同事务修复

规格要求业务性授权拒绝同时产生不可变 Decision 和安全 Audit；原实现只写 AuthorizationDecision。现在 Decision Port 在同一 IdentityPolicy 事务中写入同 Scope 的 DENIED Audit：

- Audit 的 command_id 与 Decision 的 source command 绑定；
- error_code 只保存稳定 reason code，例如 NO_ACTIVE_GRANT；
- request_payload_hash 只保存已验证的 32-byte hash；
- safe_summary 只包含 reason code，不回显原始 Payload 或 External Identity；
- Audit 写入失败时整个 Decision 事务回滚。

新增真实 PostgreSQL 回归已经验证 Project B DENY、同 Scope Audit 和脱敏字段。

## 5. 自动化验证

### 5.1 最终全量验证

执行：

    pnpm clean && pnpm verify

结果：

- Prettier：PASS。
- ESLint：PASS。
- TypeScript：PASS。
- 常规 Vitest：20 passed | 10 skipped (30)；341 passed | 164 skipped (505)。
  - skipped 是需要真实 PostgreSQL Gate 的测试文件/用例，不被记入常规内存测试的 PASS，后续由独立 Gate 执行。
- Architecture：PASS source_roots=10。
- Public API：PASS operations=200。
- Generated TypeScript：PASS payloads=200 query_results=44 core_contracts=6。
- Catalog/Registry：PASS catalog=200 registry=200 schema_status={"FULL":200}。
- Compatibility：PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=0 findings=0。
- 内嵌 Persistence Gate：PASS。

### 5.2 独立真实 PostgreSQL Gate

执行：

    pnpm typecheck && pnpm persistence:gate

最终 pnpm verify 中也再次执行了同一 Gate。实际结果：

- PostgreSQL 镜像：docker.io/library/postgres:18.6@sha256:06cad38a5d9f5d24b4d83d86def30795d5e4b757fedbf5281172b576dedcd941。
- Flyway 镜像：docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1。
- PostgreSQL：server_version_num=180006，即 18.6。
- Flyway：11.20.3。
- 空库 Migration：PASS。
- Persistence：12 files passed，177 tests passed。
- 二次 Migration：Schema "public" is up to date. No migration necessary.。
- 已应用 Migration：V0001、V0002、V0003、V1000、V1001、V1002、V1003、V1004、V2000、V3000、V4000、V5000、V6000、V7000，均为 Success。
- Gate 结束：postgres container removed。

覆盖的真实数据库边界包括：NOINHERIT 双角色 Context 建立、RLS/Project allow-list、Command Receipt 幂等/CAS、Role/Capability/Policy/Bootstrap、ActorSnapshot/AuthorizationDecision 精确引用与 Scope、DENY Audit、Outbox lease/fencing/retry、Inbox replay/quarantine，以及新增的四条语义反例。

## 6. Disposable Local Probe

WI-06、WI-07、WI-10 使用同一锁定 PostgreSQL 18.6 disposable 容器串行执行，Flyway 全量迁移后容器自动删除；没有接触生产 Secret、真实 Provider 或 Broker。

| Probe | 实际输出 | 结论 |
|---|---|---|
| WI-06 tests/manual/wi06-probe.mts | 首次 COMMITTED；同 key/hash DUPLICATE (originalOutcome=COMMITTED)；同 key/不同 hash IDEMPOTENCY_PAYLOAD_CONFLICT；Principal aggregate_version=1,status=ACTIVE；Receipt COMMITTED=1；Audit COMMITTED=1,DENIED=1；Outbox 1 | PASS (LOCAL PROBE) |
| WI-07 tests/manual/wi07-probe.mts | Human/Agent/Service 均 COMMITTED；Link COMMITTED；Resolve 返回 identity.external_identity_link；Event count 4；raw identifiers leaked false | PASS (LOCAL PROBE) |
| WI-10 tests/manual/wi10-probe.mts | PROCESSED → DUPLICATE → QUARANTINED；targetEffects 1；target outbox 1；command receipts 1；contract violations 1；业务事实执行一次 | PASS (LOCAL PROBE) |

WI-01–WI-05 的本地真实数据库与手工反例此前也已执行：版本锁定/迁移、Role/ACL、RLS Context/Scope、技术表/Force RLS/masked audit、IdentityPolicy 脱敏 Repository 分别取得本地 PASS。其中 WI-02–WI-04 的命令可复现性问题已写回 Runbook；真实生产 Credential/Provider 仍未执行。

## 7. Issue #28 条件映射

| Issue #28 条件 | 当前本地结论 | 证据与边界 |
|---|---|---|
| #29–#38 全部关闭且对应 PR 合入默认分支 | PARTIAL | #29–#38 已关闭；#34–#38 的 PR #46–#50 尚未进入 origin/main，跟进 PR #51 已面向 main 创建但未合并。 |
| 锁定依赖恢复、空库 Migration、重复 Migration | PASS (LOCAL INTEGRATION) | pnpm clean && pnpm verify、独立 Persistence Gate；PG 18.6/Flyway 11.20.3；二次 migrate no-op。 |
| WI-06 Command 原子事务、幂等/CAS、业务拒绝 current version | PASS (LOCAL INTEGRATION) | 真实 PostgreSQL 12 files/177 tests 与 WI-06 disposable Probe。 |
| WI-07 Principal/External Identity/Bootstrap、脱敏 Event | PASS (LOCAL INTEGRATION) | 真实 Gate 与 WI-07 disposable Probe；原始标识未泄漏。 |
| WI-08 Role/Capability/Policy、Scope/RLS、撤销/并发 | PASS (LOCAL INTEGRATION) | 真实 PostgreSQL 回归；生产 Provider/跨模块 Runtime 未包含。 |
| WI-09 ActorSnapshot/Decision、Project A/B、精确 Grant Scope、DENY Audit | PASS (LOCAL INTEGRATION) | 新增 Enterprise Grant → Project Intent DENY 与同事务 DENIED Audit 回归通过；公开 Handler/HTTP 仍未接入。 |
| WI-10 Outbox/Inbox replay、lease/fencing、Quarantine | PASS (LOCAL INTEGRATION) | typed Aggregate、foreign Enterprise Project、replay/quarantine 回归及 local Probe 通过；生产 Broker/副作用未运行。 |
| pnpm clean && pnpm verify | PASS (LOCAL INTEGRATION) | 常规与真实 PG 两段均有本轮实际输出。 |
| WI-02–WI-04 Runbook 原命令可复现 | PASS (DOCUMENT REPAIR) | 已修订预定义角色、hash、role 切换、容器内 walker 与 audit seed 说明；用户仍需最终人工执行。 |
| 用户按 Runbook 完成最小权限/RLS/幂等/CAS/Replay/脱敏授权链 | PARTIAL | 本地 Probe 和数据库反例通过，但用户最终人工操作未执行。 |
| Keycloak/OpenBao/Ceph/飞书/Renderer/Provider/生产负载 | NOT RUN | 无生产凭据/外部环境，本任务不扩大权限。 |
| 用户完成最终人工验收后标记 COMPLETE | NOT RUN | 用户尚未完成最终人工 Runbook 验收；Issue #28 继续 OPEN。 |

## 8. 清理与工作树状态

- pnpm persistence:gate 及 WI-06/WI-07/WI-10 Probe 创建的 PostgreSQL 容器均已删除。
- 未删除既有 qm-dev-postgres（postgres:16-alpine，运行约两周）或其相关数据；它不属于本次 disposable 验收环境。
- 本轮没有创建需要保留的临时测试脚本或测试文件；Probe 通过 Node inline runner 执行，测试数据库随容器删除。
- 当前远端跟踪分支保留本地集成代码、测试、Migration、规格、Runbook、Review 文档和本报告；本轮 `47a2a9d` 已 commit/push，PR #51 尚未 merge。
- 文档同步提交后应保持工作树干净；不要使用 destructive reset/checkout 覆盖当前交付历史。

## 9. 下一步

1. 创建新的跟进修复 PR，隔离 Persistence Gate 的全局 ACL 失败注入与其他测试文件。
2. 在修复 PR 上执行 exact-head review、连续两次独立 Persistence Gate、完整 `pnpm clean && pnpm verify` 和 WI-06/WI-07/WI-10 local Probe。
3. 将修复 PR 合并后，从新的干净 `main` 重跑退出 Gate，并回读 PR/Issue/祖先关系。
4. 用户按 Runbook 完成最小权限、RLS、幂等/CAS、Replay/Quarantine 和脱敏授权链的最终人工验收；外部/生产项目仍只有在具备授权和环境后执行。
5. 只有修复合并后的默认分支证据完成，并且所有 scoped 退出条件满足后，才考虑显式关闭 Issue #28。

## 10. 合并后默认分支复验（当前阻塞）

| 验证 | 实际结果 | 状态 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 干净 `origin/main` 安装通过 | `PASS` |
| 首次 `pnpm clean && pnpm verify` | 静态阶段、常规测试、Catalog/Registry、Compatibility 和内嵌 PostgreSQL Gate 通过；Gate 为 `12 files / 177 tests`，容器清理 | `PASS` |
| 独立 `pnpm typecheck && pnpm persistence:gate` | `typecheck` 通过；`IP-API-U-001` 在 `actor-snapshot.ts:418` 写入 `audit_record` 时得到 `permission denied for table audit_record`；Gate 为 `176 passed / 1 failed`，容器清理 | `BLOCKED` |

根因是 `tests/persistence/messaging.test.ts` 临时撤销共享 `identity_policy_app` 的 `audit_record` INSERT 权限，而 Vitest 默认并行运行 Persistence 文件；该失败不证明迁移缺少 INSERT 授权。跟进分支已把 Gate 改为文件级串行并连续两次通过 `12 files / 177 tests`，三个 WI local Probe 也通过；修复 PR 合并后的干净 `main` 复验完成前不得关闭 Issue #28。
