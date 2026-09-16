# PR #205 独立审查

## 当前结论（第 4 轮）

- 结论：`APPROVE`
- Reviewed SHA：`794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`
- Base SHA：`7ce4b7da99ab227f70ee447b4d0f4d17e2ca3851`
- PR：[#205](https://github.com/qzhike/zhiju-business-core/pull/205)
- Work item：[#204](https://github.com/qzhike/zhiju-business-core/issues/204)（T2 implementation）
- 审查日期：2026-09-16

本记录按项目 pre-close review 要求保存。审查独立读取了 Issue #204、已批准的 #202 设计及 PR #203 审查记录、PR 最新 head 与实际 diff、受影响 Module Spec/Test、共享 Canonical JSON/Typed Reference Contract、EnterpriseProject 边界、TaskExecution 持久化约束，以及精确 revision 的 CI 证据；未把实现者提交说明或评论当作正确性依据。

## 第 1 轮：`REQUEST_CHANGES`

- Reviewed SHA：`6aa75fbc12bdaf422a8480629f16be43ec4a37db`
- [PR 总结](https://github.com/qzhike/zhiju-business-core/pull/205#issuecomment-5691131142)

### 阻断发现

### 1. `schema_version` 未受 payload mirror guard 约束

`Module-Spec-003` §16.4、PostgreSQL logical model §33 与 `TE-P202-009` 都要求 `schema_version` 作为提升列与 `canonical_payload` 逐项一致；`1.0` 必须表示 v1 `TaskDefinition`，`2.0` 必须表示 v2 `TaskDefinitionV2`。但 `V3001__task_draft_creation.sql` 的 `guard_task_definition_snapshot_mirror` 只核对 Project Scope、DeliveryItem 镜像和 payload hash，没有比较 `NEW.schema_version` 与 payload 的版本身份。当前 CHECK 只约束 `schema_version IN ('1.0','2.0')`，并且仅在声明 `2.0` 时检查部分 v2 shape，因此把合法 v2 payload 以 `schema_version='1.0'` 直写仍可通过。

现有 `TE-P202-009` helper 又把插入值硬编码为 `'1.0'`，没有提供 `schemaVersion` override，也没有执行 v2 payload/v1 提升列（或反向）的单变量反例；Module-Test 将这一维标为 `PASS` 缺少对应证据。

要求：在数据库 guard/constraint 中闭合 CREATE major 与 payload 身份的双向关系，并新增干净的直接 SQL 回归，证明错误的 `schema_version` 被 mirror guard 拒绝；同步修正验证记录。

### 2. SQL canonicalizer 未拒绝 NFC 后冲突的对象键

共享内核 `canonicalize` 会先将对象键归一化为 NFC，并在两个原始键归一化为同一键时抛错（例如 `"é"` 与 `"e\u0301"`）。`task_execution.canonical_jsonb_text` 则只在 `ORDER BY` 和输出时归一化键，没有检测归一化后的重复键。由于 v1 open Canonical JSON 与 `initialAssignee` 可以携带任意对象键，直接写入的 JSONB 可以包含这两个不同原始键；SQL helper 会为它们拼出重复的规范化键并计算 hash，而共享内核拒绝该值，破坏应用与数据库 canonicalization v1/hash 一致性。

要求：让 SQL canonicalizer 与共享内核对 NFC key collision 使用相同的拒绝语义，并增加共享正/负向 parity 回归，证明冲突输入在写入前被拒绝且普通 Unicode 输入仍产生相同 hash。

## 第 2 轮：`REQUEST_CHANGES`

- Reviewed SHA：`9552809ec12d74f572d567e4cb1c93af11252216`
- 修订范围：`6aa75fbc12bdaf422a8480629f16be43ec4a37db..9552809ec12d74f572d567e4cb1c93af11252216`

### 前序 finding 关闭确认

1. `schema_version` finding 已关闭：新 `SECURITY INVOKER` creation-identity guard 把 Snapshot 的 `source_command_id` 绑定到 `execution.create_task` Receipt 的 command version、target identity 与 Scope；NULL-safe v2 shape CHECK 同时补齐 `completionCriteria.schemaVersion`。新增回归覆盖 v2 payload→v1 label、v1 payload→v2 label、missing Receipt 与 foreign-target Receipt。
2. NFC key-collision finding 已关闭：SQL canonicalizer 对按 normalized bytes 相邻的相同 NFC 键抛出 `22023`，与共享内核拒绝语义一致；新增正向 parity 集和应用/SQL 双侧 collision 负例。

### 新阻断：Snapshot 内容未绑定到 producing Receipt 的 request hash

`task_definition_snapshot.canonical_payload` 的权威定义是“本次命令 payload”，`source_command_id` 指向产生它的命令，且 Receipt 已保存完整 `request_payload_hash`。但新的 creation-identity guard 只读取并比较 Receipt 的 command type/version、target 与 Scope，没有读取或比较 `request_payload_hash` 与 `NEW.payload_hash`。

因此，持有同 Project app 上下文的直接 SQL 可以复用某个真实 `execution.create_task` Receipt：保持同 `task_id`/`schema_version`/Scope/`source_command_id`，只修改定义内容并为修改后的 payload 提供正确的新 hash，即可插入第二条自洽 Snapshot。mirror guard 会接受内容与新 hash，creation-identity guard 会接受 Receipt identity，现有组合 FK 也允许 Root 指针指向该 Snapshot；而 app 角色保留 Root UPDATE 权限，`guard_task_scope_immutable` 不限制 definition pointer。这样可以在不对应任何创建请求、甚至不增加 aggregate version 的情况下替换当前 TaskDefinition。

这违反 Spec 003 §16.4 的“canonical payload 是本次命令 payload”、完整 hash/source-command 绑定和数据库直接篡改防线。当前新增测试覆盖 version/target/Scope Receipt identity，但没有覆盖“同 Receipt、同 identity、不同 request payload + 自洽 hash”的单变量反例。

要求：creation-identity guard 至少读取 Receipt 的 `request_payload_hash` 并要求它与 `NEW.payload_hash` 完全一致，增加上述直接 SQL 负例；同时确认是否需以唯一约束保证一个 producing command 只能生成一条 definition Snapshot，并保持 Root pointer/CAS 的后续更新边界不被本修复削弱。

## 第 3 轮：`HUMAN_REVIEW_REQUIRED`

- Reviewed SHA：`794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`
- 修订范围：`9552809ec12d74f572d567e4cb1c93af11252216..794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`

### 前序 finding 关闭确认

第 2 轮的 Receipt 内容绑定 finding 已关闭：creation-identity guard 现在读取 `command_receipt.request_payload_hash` 并要求其与 Snapshot `payload_hash` 完全相等，同时要求 Receipt 仍为 `PENDING`。mirror guard 继续从 `canonical_payload` 重算完整 hash，因此“同一合法在途 Receipt、相同 command identity/target/Scope、替换 payload 并提供与新 payload 自洽的 hash”会因 Receipt hash 不一致被拒绝。`TE-P202-009` 已增加该直接反例，也分别覆盖 Receipt 未请求的 hash、stored payload 与请求 hash 不一致、schema version 重标和 Root pointer 未推进 aggregate version 的改写。

Root UPDATE guard 还要求 definition pointer 变化时 `aggregate_version` 前进；组合 FK 继续保证 pointer 只能指向同 Task 且 hash 完全匹配的 Snapshot。本修订没有改变公开契约、Catalog、兼容 fixture 或 Issue 的功能范围。

### 剩余人工技术审查门禁

代码复审未发现新的确定性实现 blocker，但 Issue #204 明确把 authorization、RLS、immutable persistence 与跨模块边界列为必须由 human technical review 判断的安全敏感门禁，因此 agent Reviewer 不能给出最终 `APPROVE`。

人工审查应重点确认 Receipt 的信任边界：`task_execution_app` 依据 V0002 默认权限对 `command_receipt` 具有 `INSERT`/`UPDATE`，当前数据库 guard 证明的是 Snapshot 与一条可见、字段匹配且处于 `PENDING` 的 Receipt 一致；它不能独立证明该 Receipt 必由 runner 的授权路径产生。实现者已在 PR 修订说明中把 synthetic Receipt 列为 schema 无法证明的边界。是否接受“runner/应用代码受信，数据库只防止 committed-fact 的不一致直写”，或要求进一步收紧 Receipt 写能力/状态转换，是本 PR 合并前的人类安全判断，不应由 agent 静默裁决。

另请人工关注新增 `PENDING` 分支的测试隔离度：当前“finalized Receipt”用例同时使用另一 command identity，因而不是 outcome 的单变量反例；这不推翻静态可见的 guard 条件或 exact-head full PASS，但如将 `PENDING` 限制视为关键数据库安全边界，建议补一条其余 type/version/target/Scope/hash 全部相同、仅 Receipt outcome 已 finalize 的直接 SQL 回归。

## 第 4 轮：`APPROVE`

- Reviewed SHA：`794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`
- 人工技术审批：2026-09-16，用户在收到第 3 轮完整审查结论、Receipt 信任边界与 `PENDING` 单变量测试提示后明确回复“审批通过”。

最终回读确认远端 PR head 未变化，仍为 `794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`，exact-head `verify` 仍为 `COMPLETED / SUCCESS`。第 1、2 轮的实现 blockers 均已在该 revision 关闭；第 3 轮要求的 human technical review gate 已由上述明确审批满足，因此独立 Reviewer 结论更新为 `APPROVE`。

该批准接受已披露的 trusted-application boundary：数据库 guard 证明 Snapshot 与匹配的在途 Receipt 一致，Receipt 必由授权 runner 产生仍属于受信应用边界。`PENDING` outcome 的完全隔离负例仍是建议性增强，不再作为本 PR 的阻塞条件。

`APPROVE` 不授权 merge、deploy、破坏性迁移、commit 或 push；后续动作仍遵循各自授权门禁。

## 最终验证证据

- 精确 reviewed SHA 的 GitHub Actions run `35056590645` / `verify` 已回读为 `COMPLETED / SUCCESS`；PR head 为 `794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`。
- PR 记录的同 SHA `vibe verify full --json` 结果为 `PASS`，resolved command 为 `pnpm clean && pnpm verify`，包含 clean build 与 Docker/PostgreSQL persistence gate。
- 本轮执行 `git diff --check 9552809e..794ec7df`，通过。
- 未重复运行 full gate：精确 head 的 current CI 已覆盖项目配置的完整目标，且本轮没有本地实现修改。

## 未运行边界与授权边界

- 本轮未执行真实外部 Provider、Runtime、Feishu、公开 HTTP 或人工业务验收；它们不属于 Issue #204 的完成声明。
- `TE-P202-004` 的 `CANCELLED`/`REPLACED` DeliveryItem 子项仍为 `NOT RUN`，原因与 PR 记录一致。
- Issue #204 声明的 authorization、RLS、immutable persistence 与跨模块边界 human technical review 已由第 4 轮记录的明确人工审批满足。
- `APPROVE` 仅针对精确 SHA `794ec7dfe84e1c61ad7fcd17c10ffa8deeacf3f1`，不授权 merge、commit、push、deploy 或产品代码修复。
