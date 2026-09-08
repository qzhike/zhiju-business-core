> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-94-delivery/Verification-Report.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-94-delivery/Verification-Report.md).

# Issue #94 交付验证报告

日期：2026-08-29
范围：IM-04 WI-05 Immutable Revision、Lineage DAG、Branch Head CAS、显式 Merge、Withdrawal/Invalidation
状态：`IMPLEMENTATION VERIFIED / PERSISTENCE VERIFIED / GIT DELIVERY COMPLETE / AUTHORITY DOCS SYNC IN PROGRESS`

## 1. 交付结论

Issue #94 的代码、forward-only 数据库迁移、规格/测试文档和本地自动验证已完成。实现覆盖以下边界：

- Revision 只保存已 `FROZEN` Canonical Content Object Manifest 的精确不可变身份快照，不保存 Canonical body；Initial/ordinary/merge Parent 数量分别为 `0/1/至少 2`。
- Parent 只允许同一 Artifact 的 exact RevisionRef；ID、Scope、Hash、重复关系和递归 DAG 由 Handler 与 owner function 共同校验。
- Branch Head 使用既有 `head_version` 作为 CAS token，同时匹配 expected exact head ref；失败写者不覆盖 Head，候选 Revision 和冲突事实保留。
- Merge 必须由 Human trusted principal 提交显式 conflict set/resolution refs；Conflict 与 resolution 作为不可变事实记录，不能通过覆盖旧 Revision 消解。
- Withdrawal/Invalidation 是 append-only governance facts；Snapshot/Lineage 通过治理事实派生 disposition，但不修改 Revision identity、Hash、Parent、Provenance 或 Manifest 快照。
- Revision Snapshot、Lineage、Diff Inputs、Validation 只接受精确 ID/Scope/Hash；禁止 `latest`、`current` 或宽 Project Scope 替代历史定位。
- Reference Edge 的 Branch owner version 使用 Branch UUID；Branch 数值 head token 只出现在结果和事件的 aggregate version 中。

本报告不把本地/临时 PostgreSQL 结果扩展为 Provider、生产、公开 HTTP、跨模块或独立人工业务验收。用户已检查并确认本工作区改动；PR #110、Issue #94 及原 feature branch 的 Git 生命周期已完成，本次状态同步通过不关联 Issue #94 的 docs-only follow-up 继续完成。

## 2. 变更范围

### 2.1 规格与交付文档

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/high-level-docs/07-postgresql-logical-model-v0.1.md`
- `.vibe/high-level-docs/08-verification-baseline.md`
- `.vibe/module-specs/Module-Spec-004-Artifact.md`
- `.vibe/module-tests/Module-Test-004-Artifact.md`
- `.vibe/archive/issue-94-delivery/Task-Plan.md`
- `.vibe/archive/issue-94-delivery/Manual-ART-023.md`
- 本报告

### 2.2 实现与测试

- `migrations/artifact/V4003__artifact_revision_lineage_branch_cas.sql`
- `modules/artifact/src/business/revision-service.ts`
- `modules/artifact/src/business/revision-service.test.ts`
- `modules/artifact/src/business/artifact-business-errors.ts`
- `modules/artifact/src/persistence/artifact-business-types.ts`
- `modules/artifact/src/persistence/artifact-db.ts`
- `modules/artifact/src/persistence/artifact-repository.ts`
- `modules/artifact/src/persistence/command-runner.ts`
- `modules/artifact/src/index.ts`
- `tests/persistence/artifact-revisions.test.ts`
- `tests/persistence/technical-tables.test.ts`

## 3. 自动验证证据

### 3.1 全量工作区 Gate

命令：

```text
pnpm verify
```

结果：`PASS`。

| 阶段 | 实际输出 |
|---|---|
| Format | `prettier --check .`：All matched files use Prettier code style |
| Lint | `eslint .`：exit 0 |
| Typecheck | `tsc -b --pretty false`：exit 0 |
| Vitest | `29 passed / 21 skipped` files；`376 passed / 263 skipped` tests，共 `639` tests |
| Architecture | `architecture_boundaries=PASS source_roots=10` |
| Public API | `public_api_generation=PASS operations=201` |
| Type generation | `typescript_types=PASS payloads=201 query_results=45 core_contracts=6` |
| Catalog/Registry | `catalog_registry=PASS catalog=201 registry=201 schema_status={"FULL":201}` |
| Compatibility | `compatibility=PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=21 findings=21` |
| Persistence | 见 3.2；Gate 成功并清理 PostgreSQL 容器 |

补充构建命令：

```text
pnpm build
```

结果：`tsc -b` exit 0，`PASS`。

### 3.2 Pinned PostgreSQL/Flyway Gate

命令：`pnpm persistence:gate`（本次由 `pnpm verify` 的最后阶段执行）。

固定运行时：

- PostgreSQL：`18.6`，server version `180006`
- Flyway：`11.20.3`
- PostgreSQL image：`docker.io/library/postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`
- Flyway image：`docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1`

结果：`PASS`。

- 空库全量迁移成功，30 条 Versioned migration 均为 `Success`，其中 `V4003 artifact revision lineage branch cas` 成功应用。
- 第二次 migrate 输出：`Schema "public" is up to date. No migration necessary.`
- Persistence Vitest：`25 passed` files，`278 passed` tests。
- 测试后的 PostgreSQL 容器已由 Gate 删除；没有保留测试脚本、临时 SQL 或本地数据库文件。

### 3.3 WI-05 关键用例结果

| 用例 | 证据 | 结果 |
|---|---|---|
| Initial/ordinary/merge Parent cardinality | `revision-service.test.ts` 3 tests；真实 PostgreSQL 创建 `0/1/2` Parent Revision | `PASS` |
| Exact FROZEN Manifest | STAGING direct create 被拒绝；FROZEN locator/hash/schema/size/media snapshot 成功保存 | `PASS` |
| Immutable boundary | `artifact_app` 对 Revision、Parent、Conflict、Withdrawal、Invalidation 的直接 UPDATE/DELETE 全返回 ACL `42501` | `PASS` |
| Cross Artifact/wrong hash | Cross-Artifact Parent 返回 `ARTIFACT_CROSS_ARTIFACT_PARENT`；wrong hash 返回 `ARTIFACT_CONTENT_HASH_MISMATCH`；候选 Revision 不落库 | `PASS` |
| Exact historical reference | `latest` 非 UUIDv7 exact ref 被 Unit 拒绝；Project 宽 Scope 的 Lineage/Validation 被拒绝 | `PASS` |
| Branch CAS race | 同 expected version 两个并发 Head move 得到一个 `COMMITTED`、一个 `REJECTED`；失败方返回 `ARTIFACT_BRANCH_HEAD_CONFLICT`；Head version `0→1→2` | `PASS` |
| Branch history shape | Head Reference Edge 的 owner version 全为 Branch UUID；Outbox aggregate versions 为 `1,2` | `PASS` |
| Merge | 合法 Human Merge 形成至少 2 Parent 和 1 条 `MERGE` Conflict fact；unresolved 与 non-Human 均拒绝 | `PASS` |
| Idempotency | 同 hash replay 返回 `DUPLICATE` 并复用首个结果；不同 payload hash 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` | `PASS` |
| Snapshot/Lineage/Diff Inputs | REV-001/002/003/004 的 Parent、root、edge、lineageHash、common ancestor 和 Diff Inputs 精确回放 | `PASS` |
| Governance history | Withdrawal/Invalidation 只追加事实；原 Revision identity/Hash/Parent/contentRef 保持；两类治理 Edge path 不冲突 | `PASS` |
| Timestamp provenance | Withdrawal fact 的 `withdrawn_at::text` 与同 command Outbox `occurred_at::text` 完全相等 | `PASS` |
| RLS | PROJECT_B context 读取 PROJECT_A Revision 返回零行/NOT_FOUND；direct app-role probes 无越权读取 | `PASS` |
| Rollback | 注入 Outbox 后失败：新 Revision/Outbox/Receipt/Audit/Reference Edge 全为 0；预先建立的 WI-04 future-owner Link 保持 1 | `PASS` |

## 4. 测试遗留与边界

本轮没有创建需要保留的临时测试脚本或测试文件。`artifact-revisions.test.ts` 使用 `InMemoryObjectStorage` 和 disposable PostgreSQL；其中用于证明 WI-04 owner reservation 边界的 STAGING/future-owner Link 只存在于被 Gate 删除的临时数据库中。

下列能力没有本轮直接运行证据，继续保持 `NOT RUN`：

- 真实 Ceph RGW、OpenBao、生产加密/Object Lock 和真实外部 Provider；
- 生产 PostgreSQL、生产 scheduler 和部署环境；
- 公开 HTTP、Browser、跨模块 Process Manager/Event Bus、集成 E2E；
- Renderer、Diff 计算、Quality、Approval、Release 和后续业务 Handler；
- 独立人工 ART-023 业务验收。人工复核步骤和记录表见 [`Manual-ART-023.md`](Manual-ART-023.md)，自动 synthetic fixture 不能替代人工签字。

## 5. Git 收口状态

截至 PR #110 合并后的本地回读：

- 实现 head：`a0835a8d85adc14e227b978ef3cd7464a2775998`
- PR #110：`MERGED`，merge commit `92f490c0fc5fb8cf9d6d49c1ee1ac2e695ae3dfa`
- Issue #94：`CLOSED`，由 PR #110 关闭
- `origin/main`：已包含实现 head，`git merge-base --is-ancestor a0835a8d... origin/main` 通过
- 原 feature branch：本地和远端均已删除，`git ls-remote --heads origin <branch>` 与 `git branch --list <branch>` 均无输出
- 当前工作区：位于 `92f490c` 的 detached `origin/main`；`main` 和其他 worktree 保留

PR #110 的 exact-head CI、`--match-head-commit` 合并、Issue #94 状态、`origin/main` ancestry 和原 feature branch 删除均已完成。当前仅需把本报告和权威文档的最终状态通过不关联 Issue #94 的 docs-only follow-up 合入 `main`，不改变已合并历史。
