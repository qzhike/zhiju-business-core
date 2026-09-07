> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue64-delivery/00-execution-log.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue64-delivery/00-execution-log.md).

# Issue 64 执行记录

## 目标

完成 Issue 64；完成后关闭 Issue 64，并关闭对应分支。提交、推送、Issue 关闭和分支关闭分别核验，不以意图或本地状态代替远端证据。

## 执行约束

- 以当前 worktree、实际代码、规格、测试输出和 GitHub 当前状态为准。
- 任何代码改动前，先同步 HL-Spec、相关 Module-Spec 和模块测试文档。
- 项目文档使用中文；代码注释、Commit Message 和外部文档使用英文。
- 保留与本任务无关的既有改动，不做无关重构。
- 每次测试后清理本次产生的临时测试脚本和测试文件。

## 证据记录

本文件将在审计、实现、验证及远端交付阶段持续补充，记录命令、结果、范围和未运行边界。

## 当前本地实现与验证结果（2026-08-26）

### 初始状态

- Worktree：`galendai/im-03-wi-08-templatebaseline-regulatoryprofile`，初始 HEAD 与 `main`/`origin/main` 均为 `4715f7f`；Issue #64 为 OPEN，未关联 PR，远端没有同名 Work Item branch。
- 依赖 Issue #57、#59、#60 均已 CLOSED；本次不把 Issue 依赖状态当作实现证据。

### 实现范围

- 新增 `V2009__template_baseline_regulatory_profile.sql`：Platform Template/Regulatory Reference、Project TemplateBaseline/RegulatoryProfile 六张业务表、组合外键、DRAFT→PUBLISHED/FROZEN 生命周期、FORCE RLS、ACL、不可变触发器、active/current deferred pointer guard，以及平台 writer 的技术事实授权。
- 新增 `TemplateRegulatoryRepository` 与 TemplateBaseline/RegulatoryProfile Handler；Platform 写入口只接受受信 capability，Project freeze/activation 只接受 Human、精确 published ContentAddressedRef、ProductScope/Review Snapshot 和独立 Evidence。
- 既有 `project.get_active_baseline_refs@1.0` 在同一 Project transaction 读取 CustomerBaseline、TemplateBaseline、RegulatoryProfile active exact refs；未新增公共 Catalog operation，Contract 保持 `200 operations`。
- 平台每个版本均写入内容 Reference Edge；首次 Project Root 使用冲突安全的占位 insert，避免首次并发留下孤儿 Version 或原始唯一键异常。

### 静态验证

以下命令均为 PASS：

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm architecture`：`architecture_boundaries=PASS source_roots=10`
- `pnpm contracts:check`：`public_api_generation=PASS operations=200`、`typescript_types=PASS`、`catalog_registry=PASS`、`compatibility=PASS`
- `git diff --check`

### Disposable PostgreSQL 验证

- 命令：`pnpm persistence:gate`
- 环境：PostgreSQL `18.6`，Flyway `11.20.3`；镜像按 gate 输出的 digest 使用。
- 结果：`18 test files passed`，`234 tests passed`，`0 failed`；空库迁移成功，V2009 成功应用；第二次 migrate 输出 `Schema "public" is up to date. No migration necessary.`；PostgreSQL 容器已移除。
- 覆盖：Platform DRAFT/PUBLISHED 与 app 隔离、同一 Root v1/v2 exact hash、Project freeze/activation、active refs convergence、latest/未发布/hash mismatch/模板冒充 Evidence、Human-only、CAS/首次 Root race、PUBLISHED/FROZEN immutable ACL、Receipt/Audit/Outbox/Reference Edge 和旧 Project ref 在 Platform v2 后不漂移。

### Final verify 编排

- 命令：`pnpm verify`
- 结果：PASS；Prettier、ESLint、TypeScript、Unit Test、Architecture、Contract 和 Persistence Gate 全部完成。非数据库阶段为 `22 test files passed / 15 skipped`、`351 tests passed / 220 skipped`；Persistence Gate 为 `18 test files passed / 234 tests passed`。
- 该编排未改变 `NOT RUN` 边界；跳过的数据库测试由同一命令内的 disposable PostgreSQL Gate 单独执行并已清理容器。

### 明确未运行边界

- Provider、真实外部法规抓取/真实性校验、公开 HTTP、跨模块 Process Manager、生产环境和独立人工 Reference Project 验收均为 `NOT RUN`。
- 以上本地 PASS 只证明当前 worktree 的 Contract、Handler/Repository、Migration、真实 disposable PostgreSQL 和静态门禁；尚未代表 Git commit、push、PR、Issue close、远端 branch 删除或 main ancestry。

### 下一交付边界

实现和文档现已完成本地验证，等待用户检查当前 worktree 变更。用户确认后，才执行 staged diff、commit、non-force push、exact-head PR/CI/readback、merge、main ancestry、显式关闭 Issue #64 及删除本地/远端 branch；每个远端状态单独核验。
