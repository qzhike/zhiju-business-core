# PR #187 独立审查（final head 复审）

- 日期：2026-09-13
- 角色结论：`APPROVE`
- Reviewed SHA：`d6712563320776fd4d318578c39c78569d62af9c`
  （`git rev-parse HEAD` 与 `git ls-remote origin refs/heads/galendai/im-06-186` 一致；本轮在本地 worktree 为该 revision 上执行验证）
- PR：https://github.com/qzhike/zhiju-business-core/pull/187 （base `main`）
- 工作项：[Issue #186](https://github.com/qzhike/zhiju-business-core/issues/186) — IdentityPolicy owning 的 `identity.record_policy_version@1.0` / `identity.resolve_policy@1.0` 实现切片（T2）
- 权威：共享 API §5.3–§5.4；Module-Spec 001 §13.3–§13.7；Module-Test 001 `IP-176-D-002`–`D-011`、`IP-181-C-007`、`IP-181-E-001`；Issue #186 Acceptance / Verify
- 本文件为覆盖当前 head 的最终记录，替换上一轮本地记录（未跟踪、未提交）；各轮 review 结论与实现者回复保留在 PR review threads / comments，未创建平行报告。

## 一、本轮 delta 复审结论：上一轮阻塞项 N1、N2 均已关闭

上一轮（`61bef17`）对 R1–R7 的实现结论为「全部已解决」，并留下两项证据缺陷（N1 阻塞 P2、N2 非阻塞 P3）。本轮增量仅 3 个文件（`+15/−3`）：测试 2 处、Module-Test 001 的 D-003 结果列、roadmap 一行；**产品代码与迁移未改动**（`git diff 61bef17..d671256 --stat`）。

- **N1 已关闭**：`tests/persistence/identity-policy-policy-version.test.ts:1449-1455` 的 `self` 变体现在呈现 `scopedKey(POLICY_ONE, V8, {enterpriseId: ENTERPRISE_A, projectId: PROJECT_A1})`，与循环内实际创建的版本键（`:1489-1492` 恒为 `POLICY_ONE`/`V8`）完全一致 —— 即请求确实把自身版本键作为 `supersedesRef`。该输入经注册 schema 与入口结构校验后由 Handler 的自引用守卫（`modules/identity-policy/src/commands/policy-version.ts:777`）拒绝，返回 `IDENTITY_POLICY_SUPERSEDE_INVALID` 且不产生事实/取代边（循环末尾断言 `versionBindingCount(POLICY_ONE, V8) === 0`）。我核对了拒绝发生在 INSERT 之前，因此不存在“自我取代”行。
- **N2 已关闭**：新增 `expect(await resolveAs(futureSuccessorKey)).toMatchObject({ useStatus: 'NOT_YET_EFFECTIVE', effectiveFrom: FUTURE.toISOString() })`（`:1440-1445`）；`futureSuccessorKey` 为 `:1410` 定义的 `POLICY_ONE/V7`（`effectiveFrom = FUTURE`）、已提交且无后继，`resolveAs` 走真实 Query Envelope + Decision + grant + PostgreSQL 读回，因此验收条目点名的第三个观察由 owning 入口真实产生。原先的 `USABLE`（前驱，未来后继未生效）与到达边界时刻（inclusive）`SUPERSEDED` 断言保留未变，两个方向现在都有执行证据。
- 我确认本轮没有引入新的产品行为：两个新断言与既有 fixture 复用同一批提交事实，未放宽或收紧任何入口校验；`self` 变体的错误码断言仍为 `SUPERSEDE_INVALID`（未因输入改变而落到其他分支）。

## 二、逐项 R1–R7（当前 head 结论）

产品代码自 `61bef17` 起未变，故上一轮基于源码逐段核对得到的结论在本 head 继续成立；本轮我重新读了两个入口与共享调用点，并对每一项给出当前结论与证据来源：

- **R1 注册请求/结果校验接入真实入口 — 已解决。** 两个入口接收完整 `{ envelope }` 并首段执行 `ContractRegistry.validateOperation`（早于任何 DB/授权/幂等动作），错误分类与 `contracts/src/registry.ts:126-146`/`:221-243` 的 keyword 一致；写入结果在 owning 事务内、`finalizeReceipt` 之前校验，失败抛 `INTERNAL_CONTRACT_VIOLATION` 使事实/取代边/Receipt 一并回滚；解析结果在同一事务内校验、失败写 Audit（`safe_summary=result-contract`）不截断。证据：本轮 gate 中「rejects requests outside the registered contract before any database access」「rolls back the fact, edge and receipt when the registered write result fails validation」两用例实跑通过。
- **R2 幂等结果返回前重验当前授权 — 已解决。** 授权/Scope 重验位于 `executeIdentityCommand` 之前的独立事务，失败直接 `rejected(...)`、不进入 Claim/读取路径；`currentAuthorizationError` 覆盖 Decision id+hash、ALLOW/Intent/Purpose/Scope/principal+actor/payload hash、过期与当前 ACTIVE grant（`identity-policy-repository.ts:625-640`、`:650-656`）。证据：「revalidates current authorization before returning an existing receipt」实跑通过（撤销后重放 `AUTHORIZATION_REVOKED`、Purpose 不匹配拒绝、有效重放仍 `DUPLICATE`）。
- **R3 两种 Scope 的最大合法 Envelope 读回 — 已解决。** 完整 Envelope 恰 262144 字节（Project/Enterprise 各一次）、Decision 绑定该 payload、经真实入口提交并 `resolve_policy@1.0` 逐字段读回、读回结果通过注册 schema、262145 字节拒绝且无事实。证据：「commits a maximum-size Envelope in both scopes and rejects one byte more」实跑通过。
- **R4 完整授权引用校验 — 已解决。** `presentedReferenceError` 校验 Decision 的 kind/objectType 允许集合/id/hash/Scope 与 actor 的 ObjectRef（允许类型 + 受信 principal id）或 ActorSnapshot SnapshotRef（允许类型、objectId/snapshotId 等于受信 Context、Scope、经 `getActorSnapshotByIdAndHash` 精确读回的 payload hash）。共享 Envelope 对这三个字段只给通用 `typedReference`（`contracts/src/envelopes.schema.ts:67-68`、`:103-105`），故这些比较是唯一执行点，非空洞比较。证据：「validates the complete presented authorization references on both entries」实跑通过（含精确 ActorSnapshot 正向对照）。
- **R5 绑定失败走脱敏 Audit — 已解决。** 绑定校验在两个入口的 owning 事务内执行，失败写受信 Context Scope 的 `safe_summary='reference-binding'` Audit 并返回授权失败；写入端在 Claim 前短路，不写 Receipt、不记录未验证 Scope/正文。证据：同一用例断言 reference-binding Audit、`wi186:binding:1` 无 Receipt、版本键绑定计数为 0；「Registration permission does not grant resolution permission」用例断言 `authorization` Audit。
- **R6 写入结果失败回滚回归 — 已解决。** 注入的 Registry 只覆写 `validateOperationResult` 且只拒绝写入结果，失败码 `INTERNAL_CONTRACT_VIOLATION` 只可能由结果校验产生（请求侧分类不产出该码），因此可判定失败发生在 INSERT 之后、提交之前；断言事实/取代边/Receipt 无残留、前驱 Hash 不变，并有正常契约下的成功控制组（恰好 1 条 `COMMITTED` Receipt）。证据：该用例实跑通过。
- **R7 单字段隔离负例 — 已解决。** 两个入口各 5 个 actor 侧 + 4 个 Decision 侧负例，均取自该入口自身 Envelope 的 `actor`/`requester` 与 `authorizationDecisionRef`（snapshot 变体取自共同正向 ActorSnapshot），一次只改一个成员；我扫过测试文件的全部引用变更点，无跨入口污染残留。证据：同一用例实跑通过。**本轮 N1 修复后，D-003 的“自引用”与“NOT_YET_EFFECTIVE”两项也由真实输入覆盖。**

## 三、D-003 结果列与 roadmap 对账

- `IP-176-D-003` 结果列现写明「自引用（请求把自身版本键作为 `supersedesRef`）……全部返回 `IDENTITY_POLICY_SUPERSEDE_INVALID` 且不产生边与事实」与「未来生效且未被取代的版本经解析入口返回 `NOT_YET_EFFECTIVE`」，与 `:1440-1445`（NOT_YET_EFFECTIVE 断言）、`:1449-1455`（自引用输入）、`:1494-1506`（拒绝与无残留断言）的实际输入/断言逐项一致；下游 `POLICY_EXPIRED` 仍如实标注为 `NOT RUN`。
- roadmap 第 28 行把 #186（Handler、精确 Purpose 授权、scoped 持久化 `V1005`）列入已交付，并把“下一步”改为 PolicyVersion 消费位置（EP capture 解析、TE Context Builder/ReadinessBuilder/Validator/Freeze 的重验与 `POLICY_EXPIRED` 拒绝）与 EP/TE owning 业务切片，同时保留「EP/TE 业务 Handler、消费侧重验与完整业务链仍未实现」「TD-05–07 仍为待批准提案」——与我核对的交付事实（本 PR 的 Scope/Non-goals）相符，未把本项通过扩大为 IM-06 READY。
- 非阻塞备注：①roadmap 该行在此次编辑处出现一个标点冗余「，、」（`…/issues/179)，、[#183…`），不影响语义；②新增自引用输入经 Handler 守卫在 INSERT 前拒绝，因此迁移的 `policy_version_supersede_not_self` CHECK 仍属纵深防御（direct SQL 路径），本项不含对它的新执行证据，属预期而非缺口。

## 四、独立执行记录（本轮实际运行的命令与结果）

1. `git rev-parse HEAD` / `git ls-remote origin refs/heads/galendai/im-06-186` → 均为 `d6712563320776fd4d318578c39c78569d62af9c`；`git diff 61bef17..d671256 --stat` → 3 files changed, 15 insertions(+), 3 deletions(-)（测试 + 两份文档，产品代码/迁移零改动）。
2. `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`（= `pnpm clean && pnpm verify`）
   - 结果：`{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。
   - 静态阶段：`Test Files 54 passed | 32 skipped (86)`、`Tests 855 passed | 335 skipped (1190)`。
   - persistence gate：PostgreSQL `server_version 180006`（18.6）/ Flyway OSS 11.20.3；`Test Files 36 passed (36)`、`Tests 350 passed (350)`；`flyway info` 含 `1005 | identity policy policy version | Success`；`second migrate: Schema "public" is up to date. No migration necessary.`；`gate passed`、`postgres container removed`。
3. 定向探针（一次性脚本 `/tmp/probe-pv.mjs`，复用仓库 `tools/persistence/*.mjs` 启停同一 pinned 容器，全量迁移后仅跑本项测试文件；未修改仓库文件）
   - 结果：容器 `49ea3380ba27`；`Migrating schema "public" to version "1005 - identity policy policy version"`；14 个用例**全部通过**（含 `keeps the supersede edge unique and derives supersededAt from the successor`，即本轮两条新断言所在用例），`Test Files 1 passed (1)`、`Tests 14 passed (14)`，vitest exit 0，容器已删除。
4. 只读核对：`git diff -U12 61bef17..d671256`、测试文件 `:1420-1500` 实读、`git show d671256:.vibe/product/roadmap.md` 全文行级 diff、Module-Test 001 D-003 行全文。
   - 说明：本轮未运行任何修改性命令；除本记录外未改动任何文件，未 commit/push/merge（记录文件由工作项负责人在获得授权后提交）。

## 五、未执行边界（保持 NOT RUN）

- 下游消费：EP Source Slice、TE Context Builder/ReadinessBuilder/Validator/Freeze 的消费侧重验、`POLICY_EXPIRED` 拒绝与 D-007 消费端（本项 non-goal）——`NOT RUN`。
- 外部：真实 Provider/Feishu/Runtime、公开 HTTP 入口、生产部署——`NOT RUN`。
- 跨模块业务 E2E 与真实业务 Policy 内容评审——`NOT RUN`。
- 人工业务验收（含 runbook 人工步骤）——未执行。
- 人类安全/迁移技术审查（Issue #186 Scope 明确要求）——**未完成**，当前 PR 无该项完成证据；本次 agent 复审不替代该门槛，也不授权 merge。

## 六、后续门槛

1. 完成人类安全/迁移技术审查并留可核验证据（本项为合并前唯一未完成的流程门槛）。
2. 按项目授权边界取得 merge 授权；Issue 创建不授权 commit/push/merge/deploy。
3. 修复记录已提交后回读远端 state，并在 `.vibe/reviews/pr-187/Review.md` 之外仅更新真值发生变化的 durable 文档（本 head 的 Spec/Module-Test/roadmap 已对账，无待改项）。

## 附：上一轮（`61bef17`）结论摘要（保留历史）

上一轮结论为 `REQUEST_CHANGES`：R1–R7 实现层面全部已解决，唯一阻塞项为 N1（`self` 负例未呈现自引用输入，Module-Test D-003 的 `PASS` 自引用主张因此无执行支撑），另附非阻塞 N2（`NOT_YET_EFFECTIVE` 观察缺少 owning 入口证据）。两项均已在本 head 按上述方式修复并经我独立复跑确认，历史结论不再适用；该轮的执行记录（`vibe verify full --json` PASS、定向探针 14/14）在本轮以同一方式重跑复现。
