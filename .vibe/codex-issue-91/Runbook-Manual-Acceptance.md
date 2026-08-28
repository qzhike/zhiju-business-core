# Issue #91 Disposable PostgreSQL Runbook

日期：2026-08-28

状态：`LOCAL AUTOMATED ACCEPTANCE PASS / GIT DELIVERY PENDING USER CONFIRMATION`

## 1. 范围

本 Runbook 验证 IM-04 WI-02 在 Artifact owning schema 上的 Application/Persistence 事务基础。验证对象是既有 V4000 技术表、PostgreSQL RLS/ACL 和事务边界，不创建 Artifact、Branch、Revision、Content Object、Representation 或 Binding 业务表。

## 2. 前置条件

- macOS/Linux、Node.js、pnpm 和 Docker 可用；
- 当前工作区是 Issue #91 实现分支；
- 不使用生产数据库、生产凭据、外部 Provider 或真实对象存储；
- `tools/persistence/gate.mjs` 会启动固定镜像的 disposable PostgreSQL/Flyway 容器，并在结束时移除容器。

## 3. 标准执行

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm clean && pnpm verify
```

`pnpm verify` 的最后一段自动执行 `pnpm persistence:gate`。Gate 会依次完成：

1. 校验 PostgreSQL 18.6 与 Flyway 11.20.3 的 tag/digest；
2. 在空数据库执行全量 Flyway Migration；
3. 运行 `tests/persistence`，包括 `artifact-command-runner.test.ts`；
4. 再次执行 Migration，要求输出 `No migration necessary`；
5. 输出应用 Migration，并删除本次 disposable PostgreSQL 容器。

## 4. 预期可观察结果

| 检查项 | 预期输出 |
|---|---|
| Format/Lint/Typecheck | 全部通过 |
| 全量 Vitest | `26 passed | 18 skipped`；`368 passed | 253 skipped` |
| Architecture | `architecture_boundaries=PASS source_roots=10` |
| Public API/Generated Types | `operations=201`、`payloads=201`、`query_results=45` |
| Catalog/Registry | `catalog=201 registry=201 schema_status={"FULL":201}` |
| Compatibility | v1.0 baseline 200 operations 保持不变，新增项按 minor 兼容处理 |
| Artifact Persistence | 22 个 Persistence 文件、268 个测试全部通过 |
| 空库 Migration | V0001–V7000 全部 `Success`，包含 V4000 Artifact technical tables |
| 二次 Migration | `Schema "public" is up to date. No migration necessary.` |
| 容器清理 | Gate 日志输出 `postgres container removed` |

## 5. WI-02 手动检查矩阵

自动化测试使用合成 UUID 和 disposable PostgreSQL，但每项都可从 Gate 输出和测试结果复核：

| 场景 | 观察结果 |
|---|---|
| 同 key、同 hash | 首次命令提交；重放返回 `DUPLICATE`，callback 不再次执行 |
| 同 key、不同 hash | 返回稳定 `IDEMPOTENCY_PAYLOAD_CONFLICT`；首条 Receipt 不变，并记录脱敏 DENIED Audit |
| 同 key 并发 Claim | 只有一个 callback 执行，另一方读取已提交结果 |
| 同 expected version 并发 CAS | 一个事务成功，另一个返回稳定 `CONCURRENCY_CONFLICT`，失败事务不遗留 Receipt/Outbox |
| 大整数版本 | `9007199254740993` 精确推进到 `9007199254740994` |
| 故障回滚 | Receipt、Process、Audit、Reference Edge、Outbox 同时回滚 |
| Scope/主体绑定 | Actor、Decision、Policy、Enterprise、Project、Correlation 和 creator 漂移均在提交前拒绝 |
| PostgreSQL 安全边界 | 无 Context、伪造 GUC、过期 Context、跨 Enterprise/Project、DDL、跨 Schema、owner `SET ROLE` 按预期返回零行或 `42501` |
| 技术表约束 | Process Step Scope mirror 返回 `23514`；不同 owner version 可共存；精确重复 Edge 返回 `23505` |

## 6. 失败处理与清理

- Gate 失败时应保留 Gate 输出中的原始错误和容器 tail 日志，不把环境失败记作业务 PASS；
- Gate 自己负责移除 disposable PostgreSQL 容器；执行后可用 `docker ps` 检查，不触碰工作区已有的非本任务容器；
- 测试只在容器内创建 `im04_wi02_probe` 登录角色和合成数据，容器删除后全部消失；
- 本 WI 不创建临时测试脚本、生成式测试文件或生产数据。

## 7. 未覆盖边界

以下保持 `NOT RUN`，不能由本 Runbook 推断通过：Artifact 业务表和业务 Repository、公开 HTTP/Handler、对象存储、Renderer、Provider、跨模块 Process Manager、公共 Event Bus、生产数据库、真实外部副作用、负载/恢复以及独立人工 Reference Project 验收。
