# Issue #93 WI-04 验证报告

日期：2026-08-28

Issue：[#93](https://github.com/qzhike/zhiju-business-core/issues/93)

工作区：`im-04-wi-04-implement-canonical-content-object-s`

验证基线父提交：`dd1b852`

## 1. 交付范围

本次交付实现 Artifact-owned Canonical Content Object 的最小生命周期和对象存储边界：

- forward-only `V4002` migration，以及 Manifest、精确 future `ArtifactRevision` owner link、quarantine、orphan cleanup 表和 owner function；
- `ObjectStoragePort` 与 deterministic local/CI in-memory adapter；
- executable Canonical Schema、Canonical JSON bytes、media type、size、SHA-256 和 authoritative readback 校验；
- `STAGING -> LINKED -> FROZEN`、`STAGING/LINKED -> QUARANTINED`、finalization unknown/retry 和 frozen immutable guard；
- DB link commit 与 external finalize 的分离、DB rollback 后 Orphan 记录、24 小时 grace、5 分钟 lease、fencing、指数退避、retention/legal-hold/reverse-link 保护和幂等删除结果；
- Artifact repository、业务 service、测试、技术表目录和对应 HL-Spec/Module-Spec/Module-Test 文档同步。

本次没有创建 `artifact_revision`，没有扩展公开 Artifact Catalog，也没有实现 Renderer、Representation、Quality、Approval、Release、公开 HTTP 或跨模块业务流程。

## 2. Issue Acceptance 对照

| Acceptance | 预期 | 实际结果 | 状态 |
|---|---|---|---|
| Manifest 生命周期 | 只允许 `STAGING -> LINKED -> FROZEN`；quarantine/orphan 可审计 | 真实 PostgreSQL 验证 Stage、Link、Finalize、Freeze、Quarantine；`FROZEN` 直接身份更新被 `artifact_app` ACL `42501` 拒绝；Orphan 和 Audit 行保留 | `PASS (PERSISTENCE)` |
| Hash 与内容身份 | Hash 从 canonical payload bytes 重算；caller hash、locator、filename、storage metadata 不能替代 | canonical document fixture 为 1238 bytes，预期/实际 SHA-256 均为 `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7`；错误 caller hash 在上传前拒绝；readback bytes/metadata 篡改进入 quarantine | `PASS (PERSISTENCE)` |
| 上传后 DB 失败 | 不产生业务 Link，只留下可回收 Orphan | 撤销 `create_content_object` execute 权限注入 DB 失败；Manifest/Link 均不存在，独立 Orphan 记录为 `PENDING`，宽限期后可清理 | `PASS (PERSISTENCE)` |
| Sealed consumer | 仅同 Scope 的 `FROZEN` Manifest 可被 sealed consumer 引用；冻结身份不可更新 | 当前 WI 未创建 Revision/Sealed consumer；Manifest 冻结门禁、Scope/RLS/ACL 和 future owner link 形状已验证 | `PASS (Manifest boundary) / NOT RUN (Sealed consumer)` |
| Orphan cleanup | grace、lease/fencing、并发 worker、retry、retention、legal hold、unknown 和幂等 | 验证 24 小时 grace、5 分钟 lease、并发 `SKIP LOCKED`、错误 token `FENCED`、`UNKNOWN` 退避、retention `RETRY`、legal hold `HELD`、`DELETED/NOT_FOUND` 幂等和对象保留 | `PASS (PERSISTENCE)` |
| Gate 与迁移 | 真实 PostgreSQL rollback/RLS/race、空库/no-op migration、full gates | pinned PostgreSQL/Flyway disposable gate 全部通过；V4002 成功应用，第二次 migrate 为 `No migration necessary` | `PASS (PERSISTENCE)` |

## 3. 自动化执行记录

| Test/Scenario ID | 环境与输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| WI04-BUILD | workspace；Artifact package | TypeScript build 成功 | `pnpm --filter @zhiju/artifact build`：`tsc -b` exit 0 | `PASS` |
| WI04-TYPECHECK | workspace 全项目 | 类型检查成功 | `pnpm typecheck`：`tsc -b --pretty false` exit 0 | `PASS` |
| WI04-LINT | workspace 全项目 | 静态检查无错误 | `pnpm lint`：`eslint .` exit 0 | `PASS` |
| WI04-UNIT | local；Object Storage、Artifact handler、write guard | 新增 adapter 与既有 Artifact 回归通过 | `pnpm exec vitest run modules/artifact/src/storage/in-memory-object-storage.test.ts modules/artifact/src/business/artifact-handlers.test.ts modules/artifact/src/persistence/write-guards.test.ts --no-file-parallelism`：3 files、10 tests passed | `PASS (LOCAL)` |
| WI04-P-001/P-004 | PostgreSQL 18.6；Document fixture；Stage/Link/Finalize/Freeze | readback 校验后写 Manifest；只有 finalize 成功才可 Freeze；STAGING direct finalize 拒绝；unknown 可重试 | `artifact-content-object.test.ts` lifecycle、direct owner-function、finalize failure/retry 场景通过；full gate 24 files、277 tests passed | `PASS (PERSISTENCE)` |
| WI04-P-002 | PostgreSQL 18.6；撤销 create function execute 权限后的 rollback probe | 无 Manifest/Link；写 Orphan 并可审计清理 | `artifact-content-object.test.ts`：数据库返回 `42501`，Manifest/Link 不存在，Orphan 存在并可删除 | `PASS (PERSISTENCE)` |
| WI04-P-003 | PostgreSQL 18.6；tamper、Scope、RLS/ACL | readback/hash/Scope 拒绝；frozen identity 不可由 app 更新 | caller hash 返回 `ARTIFACT_CONTENT_HASH_MISMATCH`；readback 返回 `ARTIFACT_CONTENT_READBACK_MISMATCH` 并 quarantine；跨 Project schema 返回 `ARTIFACT_CONTENT_SCHEMA_INVALID`；direct UPDATE 返回 `42501` | `PASS (PERSISTENCE)` |
| WI04-P-005 | PostgreSQL 18.6；多个 worker；retention/legal hold/unknown/not-found | 保护条件不删除；fencing 和退避生效；删除结果幂等 | `DELETED`、`UNKNOWN`、`NOT_FOUND`、`RETRY`、`HELD`、`FENCED` 和并发第二 worker 无 claim 均通过 | `PASS (PERSISTENCE)` |
| WI04-MIGRATION | pinned PostgreSQL 18.6 (`server_version=180006`)；Flyway 11.20.3 | 空库应用成功；二次迁移 no-op；容器清理 | V4002 成功；第二次输出 `Schema "public" is up to date. No migration necessary.`；测试容器已移除 | `PASS (PERSISTENCE)` |
| WI04-DIFF | workspace | 无 whitespace 错误 | `git diff --check` exit 0 | `PASS` |

完整 `pnpm verify` 也已通过：`format:check`、`lint`、`typecheck`、全量 Vitest（28 个文件通过、20 个受控跳过；373 passed、262 skipped）、Architecture、Contract（201 operations、201 schema FULL；compatibility baseline 200）和 persistence gate 全部通过。

Persistence gate 使用的镜像 pin：

- PostgreSQL：`docker.io/library/postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`；
- Flyway：`docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1`。

## 4. 合成对象生命周期 walkthrough

以下是供人工复核的合成 walkthrough，不是生产业务验收。原始 Canonical JSON 不复制到日志或报告；只记录可复核的 byte length、Hash 和脱敏 locator。

| 阶段 | 合成输入/证据 | Manifest 或 Orphan 结果 |
|---|---|---|
| Stage | Canonical Document；canonical bytes `1238`；expected/actual SHA-256 `902a88d2...a985b7`；locator 仅显示为 `staging/canonical/<redacted-content-object-id>`；provider/version 以 `memory/<opaque-version>` 表示 | `STAGING / STAGED / aggregate_version=1` |
| Link | exact owner shape `ArtifactRevision/<redacted-owner-id>/<redacted-owner-version>`；同 Scope；DB link commit 与状态迁移同一事务 | `LINKED / STAGED / aggregate_version=2` |
| Finalize | 外部 adapter 明确成功；DB finalization state 单独更新 | `LINKED / FINALIZED / aggregate_version=3` |
| Freeze | 仅接受 `LINKED + FINALIZED`；重放或 stale expected version 不得改写身份 | `FROZEN / FINALIZED / aggregate_version=4` |
| Forced rollback | 对象已上传；create owner function 被临时撤销，DB 返回 `42501`；示例 transaction marker 为 `tx-stage-rollback-example`（仅 walkthrough 标记，非运行时 txid） | 无 Manifest、无业务 Link；Orphan=`PENDING` |
| Cleanup | `eligible_at` 经过测试夹具推进到 grace 之后；worker lease 5 分钟；错误 token 被 fencing；unknown 按 5 分钟起退避；legal hold/retention 不删除 | `PENDING -> DELETED`；unknown=`UNKNOWN -> NOT_FOUND`；hold=`HELD`；retention=`RETRY` |

实际测试产生的 PostgreSQL `txid_current()` 没有作为长期业务证据保存；表中 transaction marker 明确标注为示例，不能冒充真实 txid。人工逐项 Reference Project、生产对象安全和业务用户验收仍为 `NOT RUN`。

## 5. GitHub 交付回读

- 实现提交：`bd414cec464192c2946cff501041e8c8a8b7039d`；非 force push 后远端 feature head 与本地一致，分歧为 `0/0`。
- PR：[#106](https://github.com/qzhike/zhiju-business-core/pull/106)；base `main` 为 `dd1b85262b96b2ef28c25d4f4ca5b0d1f7306d45`，exact head 为实现提交；GitHub Actions `verify` 成功后以 `--match-head-commit bd414cec464192c2946cff501041e8c8a8b7039d` 合并。
- Merge commit：`599e59ddee353bbd90e1be47ff3a3dc862ab7cc0`；实现 head 已验证为 `origin/main` ancestor。
- Issue #93 已为 `CLOSED`，reason=`COMPLETED`；远端 feature branch 已删除，当前本地 worktree 已 detach 到 `origin/main` merge commit，本地 feature branch 已删除。

本节是 GitHub 状态的最终回读；docs-only closeout PR [#107](https://github.com/qzhike/zhiju-business-core/pull/107) 已将本报告与权威 Spec 的已发布状态同步到 `main`，不改变实现提交或已合并 PR。

## 6. 安全与边界结论

- Audit、Outbox 和 Command receipt 不写入原始 Canonical body；Orphan/Quarantine 业务记录只保存清理所需的受控对象身份，Audit 使用安全摘要和 Hash；报告对 locator 做脱敏。
- `artifact_app` 对四张新表只有 Scope-filtered SELECT；业务写入、生命周期转移、Orphan claim/complete 经过 Artifact-owned security-definer function。
- `V4000`、`V4001` 未修改；新建 migration 为 forward-only `V4002`。
- Local/CI in-memory adapter 与 disposable PostgreSQL 是本次自动验证范围，不代表真实 Ceph RGW、OpenBao、生产 SSE/Object Lock、备份恢复或 scheduler conformance。

## 7. 保持 NOT RUN 的项目

- 真实 Ceph RGW/OpenBao、生产加密、Object Lock、对象存储权限/轮换与生产 cleanup scheduler；
- `artifact_revision`、SEALED consumer、Revision/Representation/Renderer、Diff、Quality、Approval、Release；
- 公开 HTTP、跨模块 Event Bus/Process Manager、生产数据库和独立人工业务验收；
- Issue #93 Manual acceptance 的逐项用户操作确认。本文提供 synthetic walkthrough 供后续人工检查，但不将其标记为 `PASS`。
