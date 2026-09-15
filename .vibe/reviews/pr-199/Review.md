# PR #199 独立审查

## 当前结论（第 2 轮：round-1 阻断修复复审）

- 结论：`APPROVE`
- Reviewed SHA：`f9311e18e453d701e15c9d10c47c867718ccd25b`
- Base SHA：`8964ce1f603c8653781281454cb3f3bb8f501e4b`（= 复审时远端 `main`，含 #195 合并 `a00d5ac`）
- PR：[#199](https://github.com/qzhike/zhiju-business-core/pull/199)
- Work item：[#196](https://github.com/qzhike/zhiju-business-core/issues/196)（T2，P-190-1 方案 A）
- 复审日期：2026-09-15

本轮独立读取了 Issue #196 正文与 Acceptance、批准权威（[决定 §13](../decisions/task-execution-human-operated.md#13-190-taskworkorder-创建-purpose-兼容性提案)、[Spec 003 §15/§15.1/§15.3](../module-specs/Module-Spec-003-TaskExecution.md#15-创建-purpose-兼容性-spec-delta190)、[Spec 001 §14](../module-specs/Module-Spec-001-IdentityPolicy.md#14-taskexecution-创建授权190-approved)、Module-Test-001 `IP-P190-001`–`006`、Module-Test-003 `TE-P190-001`–`011`）、`8964ce1..f9311e1` 完整 diff、round-1 修复增量 `edb29f9..f9311e1`、受影响实现与新增测试，以及精确 revision 的 GitHub Actions 证据与本地一次性探针。未采用实现者摘要作为正确性依据，未修改产品代码、契约、Registry 或既有测试。

第 1 轮阻断已由 `f9311e1` 关闭：省略豁免现在只挂在两个历史 `@1.0` 行上，`@2.0`/`@1.1` 省略 `authorizationPurpose` 会在该断言中以 `missing creation operation Purpose` 失败。本轮未发现新的实现、契约、范围或验证阻断。

## 第 1 轮（保留记录）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`edb29f935cde321eb17d46753cdcfffef121fbf2`
- 阻断发现：`assertTaskExecutionCreationPurposeRegistrations` 把 `authorizationPurpose === undefined` 对四个版本一律视为合法，而 Spec 003 §15.1 只允许两个历史 `@1.0` 基线条目省略该字段；请求把豁免限制到两个历史键，并补分别删除 `@2.0`/`@1.1` Purpose 的负向回归。

## 修复核对（R1）

`contracts/src/operation-registration.ts:599–607` 为检查表增加 `readonly publicApiPurposeOmitted?: true`，仅 `execution.create_task@1.0`、`execution.create_work_order@1.0` 两行置位（`:614–617`、`:629–632`）；断言 `:663–673` 先取 `declared = operation.authorizationPurpose`，`declared === undefined` 时只有 `expected.publicApiPurposeOmitted === true` 才放行，否则抛 `missing creation operation Purpose: <type>@<version>`，已声明值仍须与该行批准值全等（否则 `invalid creation operation Purpose`）。

一次性探针（工作区已恢复，Registry 无残留改动）对 `edb29f9` 与 `f9311e1` 的断言实现施加同一变异，四版本 + 两个合法对照结果如下：

| 输入 | `edb29f9` 断言 | `f9311e1` 断言 |
|---|---|---|
| `execution.create_task@2.0` 省略 Purpose | 不抛（round-1 缺口） | 抛 `missing creation operation Purpose: execution.create_task@2.0` |
| `execution.create_work_order@1.1` 省略 Purpose | 不抛 | 抛 `missing creation operation Purpose: execution.create_work_order@1.1` |
| `execution.create_task@1.0` 省略 Purpose | 不抛 | 不抛（历史形态保持合法） |
| `execution.create_work_order@1.0` 省略 Purpose | 不抛 | 不抛（历史形态保持合法） |
| 未改动 Registry（合法对照） | 不抛 | 不抛 |
| 两个 `@1.0` 显式声明批准值（合法对照） | 不抛 | 不抛 |

因此豁免范围对四个版本都正确：两个历史 `@1.0` 的省略继续通过、显式声明批准值也通过；两个当前版本必须显式声明批准值。新增回归 `contracts/src/task-execution-creation-purpose.test.ts:214–228` 对 `@2.0` 与 `@1.1` 各删一次字段，断言上述错误文本、断言另一来源仍持有该值，并以未改动 Registry 作为合法对照；该测试在 `edb29f9` 实现下必然失败（上表第一列）、在 `f9311e1` 下通过，非空转。

Registry 级复核：把 `contracts/registry/public-api.v1.json` 的 `execution.create_task@2.0` 或 `execution.create_work_order@1.1` 的 `authorizationPurpose` 删除后，`node tools/contracts/generate-public-api.mjs --check` 以 exit 1 失败（工作区随后恢复，`git diff --exit-code` 对 Registry 通过）。需要区分两件事：这两个 FULL-schema 版本先由既有 `assertTaskExecutionOperationRegistrations`（`operation-registration.ts:541`）拦下，而该表不包含两个 legacy `@1.0` 创建键，因此新的检查表是唯一在 Registry 级覆盖那两个键的断言，`publicApiPurposeOmitted` 语义也正是为它们存在。第 1 轮注释中“contracts:check 无法发现该漂移”的表述在 Registry 级只对两个 `@1.0` 键成立；对 `@2.0`/`@1.1` 而言，构建链在断言层面已有其他拦截，修复的实质价值在于断言自身语义与回归覆盖，本次按该语义判定已闭合。

## 本轮核对结果

- **四条精确映射**：`taskExecutionCreationPurposes`、生成副本 `contracts/src/generated/task-execution-creation-purposes.json` 与 Spec 003 §15.1 表逐行一致——`execution.create_task@1.0 → task.execution.create_task`、`@2.0 → execution.task.create`、`execution.create_work_order@1.0/@1.1 → task.execution.create_work_order`；WorkOrder 两版本同 Purpose 但保留各自精确版本键，未按 Purpose 合并。
- **无别名与无回退**：解析入口 `modules/identity-policy/src/commands/task-execution-creation-purpose.ts:58–76` 只做 `commandType` 全等过滤 + `commandVersion` 全等查找；未命中操作返回 `UNSUPPORTED_OPERATION`，未命中版本/非字符串版本返回 `UNSUPPORTED_VERSION`。不存在最新版本、默认 `@1.0`、前缀、大小写、`*` 或拼接回退，`execution.work_order.create` 不解析（测试覆盖别名、大小写、前缀/后缀、`*`、`latest`、`1.0.0`、非字符串与对象输入）。
- **生成链与可再生成**：`tools/contracts/generate-public-api.mjs` 在生成前执行两个新断言，并把键取自检查表、Purpose 取自 compatibility metadata、owner/kind 取自 public-api；`--check` 同时比对新副本，摘要输出 `creation_purposes=4`。HEAD 上 `node tools/contracts/generate-public-api.mjs --check` 实测 PASS。未新增手工维护的第三份业务 Registry：检查表是既有风格的构建期期望表，运行时可消费副本始终由两份已发布 Registry 投影。
- **历史形态**：两个 `@1.0` 的 public-api 省略继续合法，其 Purpose 只来自 compatibility metadata，未被新版本值反向填充；契约测试同时断言 `taskExecutionCreationPurposeMappings` 等于四行批准值。
- **纯解析事实**：IdentityPolicy 入口只读取 `@zhiju/contracts` 导出的常量数组，无文件、数据库、Repository 或跨模块状态访问；输出是 `RESOLVED`/`UNSUPPORTED_OPERATION`/`UNSUPPORTED_VERSION` 的解析事实，不是 ALLOW、CapabilityGrant、Decision 或当前资格。`authorizeCommand` 的 `commandVersion !== '1.0'` 硬性拒绝未改动（`modules/identity-policy/src/commands/actor-snapshot.ts:275`），新入口未被接入任何授权路径。
- **既有事实不变**：`8964ce1..f9311e1` 未触及 `contracts/registry/**`、`contracts/baselines/**`、`contracts/src/generated/public-api.ts`、`contracts/src/generated/types/**`；Catalog 计数 213、历史 200 项 Compatibility Baseline 与旧授权路径保持原值。新增导出仅 `contracts/src/index.ts` 一行与 `modules/identity-policy/src/index.ts` 两条，无调用方需要迁移。
- **durable 文档**：Spec 001 §14、Spec 003 §15/§15.1 与决定 §13 的状态行把“精确映射与纯解析已实现（#196）”和“版本化 Capability/Policy、Decision 签发、当前 grant 重验、TE 入口接线仍未实现”分开表述，并保留 `authorizeCommand` 的 `1.0` 限制与人类批准来源；Module-Test-001 `IP-P190-001`、Module-Test-003 `TE-P190-002/003` 的“当前实际/结果”列只声明已实现的静态分量，四张 P190 表的其余行与整节结论仍为 `NOT RUN`，未把静态通过写成整套运行验收。

## 验证证据

精确 reviewed SHA 的 GitHub Actions [run 34927041480](https://github.com/qzhike/zhiju-business-core/actions/runs/34927041480) 为 `completed / success`，`head_sha=f9311e18e453d701e15c9d10c47c867718ccd25b`；job [104247178037](https://github.com/qzhike/zhiju-business-core/actions/runs/34927041480/job/104247178037) 的 `pnpm verify` 步骤成功，该命令即项目配置目标 `full` 的内容（`format:check && lint && typecheck && test && architecture && contracts:check && persistence:gate`）。日志记录：`Test Files 58 passed | 35 skipped (93)`、`Tests 940 passed | 373 skipped (1313)`、`architecture_boundaries=PASS source_roots=10`、`public_api_generation=PASS operations=213 policy_profiles=7 evaluator_profiles=2 creation_purposes=4`、`typescript_types=PASS payloads=213 results=54 core_contracts=6`、`catalog_registry=PASS catalog=213 registry=213`、`compatibility=PASS baseline=v1.0 operations=200`、Docker/PostgreSQL 18.6 + Flyway 11.20.3 persistence gate `Test Files 39 passed (39)` 与 `[persistence-gate] gate passed`。

本地绑定同一 SHA 的补充证据：`pnpm exec vitest run contracts/src/task-execution-creation-purpose.test.ts modules/identity-policy/src/commands/task-execution-creation-purpose.test.ts` → 2 files / 18 tests passed；`node tools/contracts/generate-public-api.mjs --check` → `public_api_generation=PASS ... creation_purposes=4`、exit 0；`git diff --check 8964ce1..f9311e1` 与 `git diff --check edb29f9..f9311e1` 均 PASS；进入复审时本地 HEAD 与 PR head 同为 `f9311e18e453d701e15c9d10c47c867718ccd25b`、工作树干净；一次性探针后工作区再次核对为干净。

## 未运行边界与交接

以下边界本轮未验证、仍为 `NOT RUN`，不因本结论改变：版本化 Capability/Policy 对应与授权组合层、Decision 签发与当前 grant 重验、TaskExecution 幂等创建入口接线与真实 Task/WorkOrder Handler/持久化业务链、Module-Test-001 `IP-P190-001`–`006` 与 Module-Test-003 `TE-P190-001`–`011` 的运行验收、外部 Provider/HTTP 与独立人工业务验收。

Issue #196 将“安全相关人类技术审查”列为独立项目门禁；本结论仅是独立 agent 复审结果，不构成该人类审查，也不授权 merge、mark ready、deploy 或关闭 Issue #196。本记录是在被审 SHA 之后产生的 review evidence；提交本文件会在 PR 上形成仅含审查文档的新 head，该 head 仍须通过 required CI，且不得包含产品代码变化。
