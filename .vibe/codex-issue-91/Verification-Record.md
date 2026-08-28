# Issue #91 Verification Record

日期：2026-08-28

状态：`LOCAL IMPLEMENTATION AND PERSISTENCE VERIFIED / PR #102 MERGED / ISSUE #91 CLOSED`

## 1. 实现结果

Issue #91 的 WI-02 范围已在 Artifact 模块完成：

- 增加 Artifact owning schema 的 Kysely 技术表类型和 canonical JSON/SHA-256 digest；
- 增加单连接事务封装，固定先建立 trusted PostgreSQL Context，再切换 `artifact_app`；
- 增加 Receipt Claim、同 hash Replay、不同 hash Conflict、Rejected result 和稳定错误；
- 增加技术 `process_instance` CAS，使用字符串/BigInt 保持 PostgreSQL `bigint` 精度；
- 增加 Audit、Outbox、Reference Edge 的事务内写入及 target/scope/hash 防线；
- 增加技术 Process Repository 的 trusted principal/scope 校验；
- 不修改已应用的 `V4000__artifact_technical_tables.sql`，不创建 Artifact 业务表或新增业务 Migration。

## 2. 验证命令与结果

| 命令 | 实际结果 |
|---|---|
| `pnpm install --lockfile-only` | PASS；lockfile 与 11 个 workspace project 同步 |
| `pnpm exec vitest run modules/artifact/src/persistence/write-guards.test.ts` | PASS；1 file / 5 tests |
| `pnpm typecheck` | PASS |
| `pnpm persistence:gate` | PASS；PostgreSQL 18.6 / Flyway 11.20.3；22 files / 268 tests；空库 Migration、二次 no-op、容器清理通过 |
| `pnpm clean && pnpm verify` | PASS；Format、Lint、Typecheck、全量 Vitest、Architecture、Contracts 和 Persistence Gate 全部通过 |

### 2.1 全量普通测试

`pnpm clean && pnpm verify` 的普通 Vitest 输出为：

```text
Test Files  26 passed | 18 skipped (44)
Tests       368 passed | 253 skipped (621)
```

### 2.2 Architecture 与 Contract

```text
architecture_boundaries=PASS source_roots=10
public_api_generation=PASS operations=201
typescript_types=PASS payloads=201 query_results=45 core_contracts=6
catalog_registry=PASS catalog=201 registry=201 schema_status={"FULL":201}
compatibility=PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=21 findings=21
```

本 WI 没有新增公共 Operation；`201` 是现有 WI-01 additive Binding Query 后的 Catalog 数量，历史 v1.0 baseline 仍为 200 operations。

### 2.3 Persistence Gate

```text
server_version: 180006
flyway version: Flyway OSS Edition 11.20.3
Test Files  22 passed (22)
Tests       268 passed (268)
second migrate: Schema "public" is up to date. No migration necessary.
gate passed
postgres container removed
```

应用 Migration 包含 `4000 | artifact technical tables | Success`；本 WI 没有修改 V4000，也没有增加新的 Artifact Migration。

## 3. 结果真实性边界

上述 `PASS` 是当前工作区的静态、Unit 和 disposable PostgreSQL 技术证据。以下保持 `NOT RUN`：Artifact 业务 Aggregate/Revision/Content Object/Representation/Binding、公开 HTTP/Handler、对象存储、Renderer、真实 Provider、跨模块业务 Process Manager/Event Bus、生产数据库、负载/恢复和独立人工 Reference Project 验收。

## 4. Git 交付结果

| 项目 | 实际结果 |
|---|---|
| Implementation commit | `76c48f01e1a7c53ca9d2485be34290b4436310fa` |
| PR | [#102](https://github.com/qzhike/zhiju-business-core/pull/102)，base `main`，head 与 implementation commit 一致 |
| Exact-head CI | GitHub Actions run `33136348440` / `verify`：PASS |
| Merge commit | `92ed04c24b8df8c6db9a8836d69106876a0645e5` |
| Issue | [#91](https://github.com/qzhike/zhiju-business-core/issues/91)：CLOSED |
| Main ancestry | `76c48f01e1a7c53ca9d2485be34290b4436310fa` 已验证为 `origin/main` ancestor |
| Feature branch | 远端 branch 保留；本地原实现 branch 仍保留，未执行删除 |

本记录随后由独立文档收口 PR 同步到最新 `main`；该文档 PR 不关联或关闭任何 Issue。
