# PR #197 独立审查

## 当前结论（第 3 轮：已交付修复复审）

- 结论：`APPROVE`
- Reviewed SHA：`59ab6f605f073dcd755b23bb5394256a03ba146b`
- Base SHA：`a00d5ac5a1b0a448aa15d99c6024977df3300e0d`
- PR：[#197](https://github.com/qzhike/zhiju-business-core/pull/197)
- Work item：[#191](https://github.com/qzhike/zhiju-business-core/issues/191)（T2）
- 复审日期：2026-09-14

本轮重新读取了 Issue #191、精确 PR head、`bcd54ad..59ab6f6` 修复 diff、受影响的 EnterpriseProject Spec/Test 与 PostgreSQL §33、迁移/业务/读取实现、正式 Review 记录和 revision-bound GitHub Actions 证据。复核时本地 `HEAD`、远端分支与 PR head 均为上述 SHA，工作树干净。

第 1 轮 R1 已关闭。实时 Receipt 构造、Query 从 confirmed version 重建来源及 V2015 backfill 现在采用同一稳定的 exact `SourceMaterialRef` 去重规则，保留首次出现顺序且不收紧既有 `sourceSelections` 接受集合；数据库 mirror guard 同时拒绝重复 exact refs。`EP-WI191-P-005` 经真实 proposal → Human confirm → composition read → backfill 覆盖同一 source ref、不同 role/locator，验证 confirmed version 保留两项 selection、Receipt/attestation 只发布一个 exact ref、注册 Result Schema 通过且 backfill 精确复现 payload/hash；`EP-WI191-RLS-002` 验证自洽但重复的持久化材料以 `22023` 被拒绝。

第 1 轮 R2 已关闭。V2015 显式从 `enterprise_project_app` 撤销 `canonical_jsonb_text(jsonb)` 与 `backfill_resolution_receipt_material()` 的 `EXECUTE`。mirror trigger guard 以 `SECURITY DEFINER` 调用 owner-only canonicalizer，固定 `search_path=pg_catalog`、使用全限定函数名且只检查 `NEW` 行；trigger function 不能作为普通 SQL 函数调用，因此没有新增 app 可调用的维护入口。扩展后的 `EP-WI191-RLS-001` 验证 app 的 `has_function_privilege=false`、直接调用返回 `42501`、owner 正向权限保留，同时正常 app confirmation 写入仍成功。

本轮没有发现新的代码、契约、迁移或测试阻断。精确 reviewed SHA 的 GitHub Actions [run 34826052902](https://github.com/qzhike/zhiju-business-core/actions/runs/34826052902) 为 `completed / success`，`headSha=59ab6f605f073dcd755b23bb5394256a03ba146b`；verify job [103918363903](https://github.com/qzhike/zhiju-business-core/actions/runs/34826052902/job/103918363903) 的 `pnpm verify` 成功。交付记录与本地同内容完整门禁给出普通测试 897 passed / 367 skipped、persistence 382/382、PostgreSQL 18.6 / Flyway 11.20.3 空库迁移和二次 no-op 通过；`git diff --check` 对修复 commit 通过。

TE InformationRequest/answer/resolver 消费、跨模块链、真实 Provider/Feishu、公开 HTTP、生产和独立人工 Reference Project 验收继续为 `NOT RUN`，与本 Work item 的已验证设计/本地/持久化证据保持分层。

2026-09-14，人类审查者在本轮会话中明确确认“审核通过”，据此记录 Issue #191 要求的独立人类安全/迁移技术审查已满足。精确 SHA 的代码复审无阻断、required CI 成功，结论更新为 `APPROVE`。此结论不等于 merge 授权；合并仍须由用户另行明确授权。此第 3 轮记录是在被审 SHA 之后生成的 review evidence；进入分支时只能作为后续文档提交，不得声称已包含在 `59ab6f6` 中。

## 第 2 轮：本地候选复核

- 结论：`REQUEST_CHANGES`
- 远端 Reviewed SHA：`bcd54ad56c5504aac34079077171a322f58c9b89`
- 远端 Base SHA：`a00d5ac5a1b0a448aa15d99c6024977df3300e0d`
- 复核日期：2026-09-14

远端 PR head 自第 1 轮审查后没有变化，因此第 1 轮的两个阻断在远端仍然成立，不能关闭。当前工作区存在尚未提交、尚未推送的候选修复；它不属于任何可审查的 PR SHA，本节只记录对该候选的预检结果，不能替代新 head 的独立复审。

候选修复在 live Receipt 投影、Query 对 confirmed version 的来源重建以及 V2015 backfill 中统一采用按 exact `SourceMaterialRef` 稳定去重、保留首次出现顺序的规则；同时在数据库 guard 中拒绝重复 exact ref。新增真实 proposal → Human confirm → composition read → backfill 回归，保留两项不同 role/locator 的 selection，并验证 Receipt/attestation 只发布一个 exact ref、Result Schema 通过且 backfill 精确复现 payload/hash。该候选在本地关闭了 R1。

候选修复还显式从 `enterprise_project_app` 撤销 `canonical_jsonb_text(jsonb)` 与 `backfill_resolution_receipt_material()` 的 `EXECUTE`，通过受限 `SECURITY DEFINER` trigger guard 保留正常 app 写入时的数据库重算，并增加 `has_function_privilege`、app 直接调用权限错误和 owner 正向调用的真实 PostgreSQL 回归。该候选在本地关闭了 R2；未发现由这组修复引入的新阻断。

本地候选的项目完整门禁 `vibe verify full --json` 通过：`status=PASS`，普通测试 56 files / 897 passed / 367 skipped，contracts/catalog/compatibility/architecture 均通过；PostgreSQL 18.6 + Flyway 11.20.3 空库迁移通过，persistence 38 files / 382 tests passed，第二次 migrate 为 no-op，容器已清理。第一次在受限沙箱中执行未找到容器运行时；通过项目现有 OrbStack Docker socket 重跑同一门禁后取得上述完整结果。

下一步必须把候选修复与本 Review 记录交付到 PR，等待新 head 的 required CI，再按该精确 SHA 重新读取 Issue、diff、契约、迁移、测试和证据。Issue #191 要求的人类安全/迁移技术审查仍是独立合并前门槛。

## 第 1 轮

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`bcd54ad56c5504aac34079077171a322f58c9b89`
- Base SHA：`a00d5ac5a1b0a448aa15d99c6024977df3300e0d`
- PR：[#197](https://github.com/qzhike/zhiju-business-core/pull/197)
- Work item：[#191](https://github.com/qzhike/zhiju-business-core/issues/191)（T2）
- 审查日期：2026-09-14

本轮独立读取了最新 Issue 正文与评论、PR head/diff、受影响的 EnterpriseProject Module Spec/Test、共享 Query/Registry/Typed Reference 契约、PostgreSQL §33、TaskExecution §11.7 下游消费边界、迁移与实现源码，以及精确 revision 的 GitHub Actions 证据。未采用实现者摘要作为正确性依据，未修改业务代码或测试。

本文件按项目正式 pre-close review 要求保存，记录实际被审 SHA。它没有预填包含本文件的未来提交；修复与本文件进入 PR 后，应对新的 final head 重新复审。

## 阻断发现

### R1 / P2：合法的重复来源选择会生成无法通过公开 Result Contract 的 Receipt

`project.propose_customer_material@1.0` 的既有 `sourceSelections` 是 `NonEmptySet<MaterialSourceSelection>`；集合唯一性作用于完整 selection。当前业务校验也只按完整 selection 的 canonical hash 去重（`customer-material-handlers.ts:623–639`）。因此，同一 exact `SourceMaterialRef` 以不同 `role` 或 `locator` 出现时，两项 selection 不相等，属于当前公开契约和 Handler 接受的合法输入；`validateAcceptedSources` 会逐项验证而不会按 source ref 拒绝重复。

新 Receipt 构造在 `customer-material-handlers.ts:1207–1209` 将每项 selection 投影为裸 `SourceMaterialRef`，丢弃使两项不同的 `role`/`locator`，从而可生成两个逐字段相同的 `sourceMaterialRefs`。但新增 `ResolutionReceiptAttestation` Schema 在 `enterprise-project.schema.ts:488` 明确要求该数组 `nonEmpty + uniqueItems`。确认事务没有在写入前验证新 attestation Result，SQL mirror 也不检查数组唯一性，因此该确认会正常 `COMMITTED` 并保存材料；随后 `handleGetResolutionReceipt` 在 `resolution-receipt-handlers.ts:365–374` 执行注册 Result 校验并以 `PROJECT_QUERY_REF_INVALID` 拒绝读取。

这使一个既有合法 CustomerMaterial proposal/confirm 无法获得 Issue #191 要求的可解引用 attestation，破坏“新确认与 Receipt material 同事务提交并可按 exact Ref 核验”的核心验收。修复不能通过收紧旧 `sourceSelections` 的接受集合完成；应在 live material 构造、读取时的真实来源重建及 SQL backfill 三处使用同一稳定的 exact SourceMaterialRef 集合投影，并增加真实 proposal → Human confirm → composition read 回归，输入包含同一 source ref、不同 selection metadata，同时断言最终 Result 通过注册 Schema。

### R2 / P2：owner-only maintenance functions 实际仍授予 `enterprise_project_app` EXECUTE

bootstrap `V0002__schema_roles_baseline.sql:122–125` 为 `enterprise_project_owner` 在该 Schema 中新建的所有函数默认向 `enterprise_project_app` 授予 `EXECUTE`。V2015 在 `:162` 和 `:446` 只对 `PUBLIC` 执行 REVOKE，因此 app role 仍保留对以下函数的显式执行权限：

- `enterprise_project.canonical_jsonb_text(jsonb)`；
- `enterprise_project.backfill_resolution_receipt_material()`。

这与 Issue #191 的“不开放通用 Receipt/SQL/Repository Port”、PostgreSQL §33 的“`canonical_jsonb_text`/backfill 函数不对 app 角色开放”以及迁移自身“maintenance helper only”的声明直接冲突。尤其 backfill 是一个写函数；应用角色在合法 Project RLS 上下文中可直接触发维护写入，绕过了仅由迁移/schema owner 执行的边界。现有 `EP-WI191-RLS-001` 只验证表 UPDATE/DELETE、越界 INSERT、mirror 和无上下文 SELECT，没有检查函数 ACL；backfill 用例又以 admin 连接调用，因此绿色 gate 未覆盖该缺口。

请在 V2015 中显式从 `enterprise_project_app` 撤销这两个 maintenance function 的 `EXECUTE`，并增加真实 PostgreSQL ACL 回归：`has_function_privilege` 为 false，且 app role 的直接调用以权限错误失败；schema owner/admin 的迁移期 backfill 正向对照仍应保留。PR 尚未合并，V2015 可在落地前直接修正，无需新增迁移。

## 其余核对结果

- Query 注册为 `AUTHORITATIVE`、Owner `enterprise-project`、Purpose `project.resolution_receipt.read`、`CUSTOMER_CONFIDENTIAL`，payload/result 字段与批准的 ResolutionReceiptAttestation 形状一致；Catalog/Registry 从 211 增至 212，历史 200 项 compatibility baseline 保留。
- composition entry 先验证注册 Envelope，再绑定 exact Receipt Scope、受信 session authentication context、Decision 的 operation/version/payload hash/Scope/Purpose/Actor，并在读取前重验当前 capability grant；该结构符合 #191 的独立当前授权要求。
- 正常单来源路径将 owning command receipt 的 `completed_at`、request hash、确认版本、Decision、Human actor 与 material 放在同一 EP 事务中；material 写失败会回滚确认、Decision、版本和 command receipt。
- V2015 没有修改已应用 migration，使用 `command_id` 主键、FORCE RLS、INSERT-only app table grants、mirror/immutable trigger，并在正常生成路径中重算 canonical payload hash。R1、R2 之外，本轮没有发现需要新规划或 scope 扩展的阻断项。
- TE InformationRequest/answer/resolver 消费、跨模块链、真实 Provider/Feishu、公开 HTTP、生产和独立人工 Reference Project 验收继续为 `NOT RUN`，本审查不把本地数据库覆盖解释为这些层级已通过。

## 验证证据

精确 reviewed SHA 的 GitHub Actions [run 34820980212](https://github.com/qzhike/zhiju-business-core/actions/runs/34820980212) 为 `completed / success`，`headSha=bcd54ad56c5504aac34079077171a322f58c9b89`；verify job [103902255085](https://github.com/qzhike/zhiju-business-core/actions/runs/34820980212/job/103902255085) 执行 `pnpm verify` 成功。

- 普通测试：56 files passed / 34 skipped，897 passed / 365 skipped；format、lint、typecheck、architecture、生成与 contract checks 通过。
- Catalog/Registry：212/212；历史 compatibility baseline：200 operations。
- persistence gate：PostgreSQL 18.6、Flyway 11.20.3，V2015 空库迁移成功，38 files / 380 tests passed，第二次 migrate no-op，容器已清理。
- `git diff --check` 对 PR diff 通过。

绿色 gate 不关闭 R1/R2：现有测试未覆盖“同一 SourceMaterialRef、不同 selection metadata”的合法确认链，也未断言 V2015 maintenance function 对 app role 不可执行。

## 交接

修复 R1、R2 并在新 PR head 上取得 required verification 后，需要重新读取新 SHA、diff、CI 和新增回归再给出 Reviewer 结论。Issue 明确要求的人类安全/迁移技术审查仍是独立合并前门槛；本次 agent review 不替代该门槛，也不授权 merge。
