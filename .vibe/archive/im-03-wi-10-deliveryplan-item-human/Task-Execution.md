> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-wi-10-deliveryplan-item-human/Task-Execution.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-wi-10-deliveryplan-item-human/Task-Execution.md).

# Issue #66 执行记录

## 当前范围

- Issue：[qzhike/zhiju-business-core#66](https://github.com/qzhike/zhiju-business-core/issues/66)
- 目标：实现 DeliveryPlan/DeliveryItem 草案、Human 批准、激活、依赖与 criteria 冻结，并完成原始 Issue 与 branch 的可审计收尾。
- 当前 worktree：`im-03-wi-10-deliveryplan-item-human`
- 原始执行分支：`galendai/im-03-wi-10-deliveryplan-item-human`（已完成合并并删除）

## 初始证据（2026-08-27）

- Issue #66 当前为 `OPEN`，硬依赖为已完成的 Issue #65。
- 当前 HEAD 为 `2c8e85e`，与 `origin/main` 相同；当前分支没有未提交改动。
- 当前仓库已有 DeliveryPlan 公共 Contract/Registry 及生成类型，但尚未发现对应的 EnterpriseProject 持久化、Repository、Handler 和真实 PostgreSQL 验收实现。
- 远端尚未发现与 Issue #66 关联的实现 PR。

## 执行边界

- 先读取并对齐 HL-Spec、EnterpriseProject Module Spec、Module Test、Issue #66 及相邻 WI-09 实现，再修改代码。
- 每个模块的 Unit Test、集成/真实 PostgreSQL 验收及实际结果在本记录或对应测试文档中明确记录。
- 设计/静态检查、自动化测试、Disposable PostgreSQL、Provider/生产/公共 HTTP/独立人工验收分别记录；未执行项标记为 `NOT RUN`。
- 不自动创建 Task、Artifact 或 Release；不实现 DeliveryItem Completion 或跨模块执行链。
- Git 提交、推送、合并、Issue 关闭和 branch 删除分别核对精确状态；最终交付前保留完整 `.vibe` 记录。

## 里程碑

| 里程碑 | 目标产出 | 状态 |
| --- | --- | --- |
| M1 契约与设计对齐 | 规格、数据库边界、命令/事件、测试矩阵和实现缺口 | 已完成（等待用户最终检查） |
| M2 垂直切片实现 | Migration、类型、Repository、Handler、Registry/生成物和回归测试 | 已完成（本地代码与测试） |
| M3 验收 | 静态门禁、普通测试、真实 PostgreSQL 负向/并发/幂等/E2E 及边界记录 | 已完成（rollback 专用注入 NOT RUN） |
| M4 精确交付 | 用户确认后提交、推送、PR exact-head CI、目标分支 ancestry | 已完成（PR #83 exact-head CI、合并、ancestry 已回读） |
| M5 Issue/branch 收尾 | API 回读 Issue/PR、关闭 Issue、删除远端与本地 branch、最终 clean 状态 | 已完成（Issue #66 closed；原始远端/本地 branch 已删除） |

## 变更与验证记录

> 实现前先更新受影响的规格与测试文档；以下章节随着执行补充证据、实际输出和 `NOT RUN` 边界。

## M1 设计冻结摘要（2026-08-27）

- 复用现有公共 Contract，不新增命令、查询或事件；实现范围为 DeliveryPlan/Version、DeliveryItem、ArtifactRequirement、Dependency、Human Decision 及真实 PostgreSQL 持久化。
- Draft 可由 Agent/Human/Service 创建；Approve 仅可信 Human；Activate 仅可信 Human 或执行精确已持久化 Human APPROVE Decision 的受控 Service。`actingFor` 不得提权。
- 所有 accepted Gap、baseline、Policy、QualityProfile、Review Snapshot 和 Impact Policy 使用 exact typed ref；禁止 latest/current/label-only、跨 Scope、未接受 Gap 与未冻结 baseline。
- Plan/Item criteria、依赖、artifact requirement 和 payload hash 在版本创建时冻结；Approved/Active 内容不可变；变更创建新 Plan Version/identity，旧事实保留。
- 激活采用 Root CAS 和单 Project active 约束，写入最小 Plan/Item Activated events；Completion/Task/Artifact/Release、Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工验收不在本切片。

## M2 垂直切片结果（2026-08-27）

- 新增 `V2011__delivery_plan_human_approval.sql`、DeliveryPlan Repository/Handler、业务表类型和六个表的 Kysely mapping；公共 Contract/Registry/生成物未扩展。
- `tests/persistence/delivery-plan.test.ts` 覆盖 accepted Gap baseline 集合、Item DAG/duplicate/cycle、Human-only 三态 Decision、精确 approval/activation、single-active CAS、幂等、RLS、immutable facts、minimal events 和 criteria 查询。
- 规格在代码前更新，并在最终实现前补强为 baselineRefs 必须恰好覆盖 Accepted Gap InputSnapshot 五个 normalized baseline refs。

## M3 验收结果（2026-08-27）

- 静态：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm architecture`、`pnpm contracts:check` 全部 `PASS`；Contract `operations=200`。
- 普通测试：`pnpm test` 为 `22 test files passed / 17 skipped`、`351 passed / 230 skipped`。
- Disposable PostgreSQL：`pnpm persistence:gate` 使用 PostgreSQL `18.6` pinned digest 与 Flyway `11.20.3` pinned digest；空库迁移通过，`20 files / 244 passed / 0 failed`，V2011 已应用，二次 migrate 为 no-op，容器已清理。
- `pnpm verify` 整体编排 `PASS`，上述阶段均在同一次最终验证中通过。
- 真实 gate 实际覆盖六个 WI-10 测试用例以及既有 persistence 回归；rollback 专用 fault injection、Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收为 `NOT RUN`。

## 2026-08-27 规格补强记录

- 复核发现 baselineRefs 不能只做“逐项属于”校验；DeliveryPlan 必须恰好保存 Accepted Gap InputSnapshot 的 CustomerBaseline、TemplateBaseline、RegulatoryProfile、QMSConfiguration 和 ProductScopeSnapshot 五个 normalized refs。
- 已先更新 HL-Spec、逻辑模型、EnterpriseProject Module Spec 和 Module Test，随后增加缺失 baseline 的回归输入与对应集合相等校验。
- Gap/Policy/QualityProfile 的公共 `VersionedRef` 不携带 target ContentHash；实现不伪造跨模块事实，只校验 ref shape、scope、exact identity 和可选 hash 格式。

## 2026-08-27 静态检查修复记录

- `pnpm architecture` 与 `pnpm contracts:check` 已通过，公共 Contract 保持 `operations=200`。
- 初次静态检查曾报告两个新文件格式不一致和 12 个 Lint 问题；已完成最小修复并复核通过，未保留临时修复文件。

## M4/M5 精确交付与收尾记录（2026-08-27）

- 实现提交：`9491604f2b1133bac718bba6c659fb097fd98029`，提交消息为 `Implement DeliveryPlan Human approval slice`。
- `pnpm verify` 在该提交上整体 `PASS`；真实 PostgreSQL/Flyway gate 通过，V2011 已应用，二次 migrate 为 no-op。
- 原始 branch 已推送到 `origin/galendai/im-03-wi-10-deliveryplan-item-human`，随后在 PR 合并和 ancestry 验证后删除；本地同名 branch 也已安全删除。
- PR：[qzhike/zhiju-business-core#83](https://github.com/qzhike/zhiju-business-core/pull/83)，base 为 `main@2c8e85ecdd2f7cd55daa355d7117abba7f6ded4c`，最终 PR head 为上述实现提交；PR verification comment 已写入并读回：[issuecomment-5433162589](https://github.com/qzhike/zhiju-business-core/pull/83#issuecomment-5433162589)。
- GitHub Actions [verify run 33029833203](https://github.com/qzhike/zhiju-business-core/actions/runs/33029833203) 在最终 head 上为 `PASS`；PR 已以 merge commit `71e527b110b7c65d6a73ba16aca4ed1b334bf89d` 合入 `main`，`054480eb...` 已验证为 `origin/main` ancestor。
- Issue [#66](https://github.com/qzhike/zhiju-business-core/issues/66) 已通过 GitHub API 读回为 `CLOSED`（由合并关联自动关闭）；远端和本地原始 branch 均已删除，`origin/main` 已更新并包含实现 head。
- Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收继续为 `NOT RUN`；这些边界不因 PR 合并而改变。
