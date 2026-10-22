APPROVE。PR #309 当前实现修订 `5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f` 的 R1–R4 已关闭，full 范围 CI 全部通过；用户于 2026-10-22 明确确认“手动验证已完成通过”，据此接受当前 U3 模拟 UI 切片的手动流程验收。

# 用户手动验收确认（2026-10-22）

- 来源：当前对话中用户明确表示“手动验证已完成通过”。本确认承接上一轮对 U3/UI-01–08 完整流程试走与总体确认的请求，关联当前 PR 实现修订 `5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f`。
- 再次读取远端，PR head 与已复审修订一致，select、checks、三个 persistence gate、persistence 汇总及 verify 全部成功。[CI run 39737759265 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39737759265/attempts/1) 继续为当前修订证据，不重复运行本地 full。
- 用户手动流程验收记为 `PASS (USER CONFIRMED)`，上一轮等待用户总体确认的门禁已解除。用户未提供逐项操作日志或额外观察，本记录不补造具体执行细节。
- 私有客户/模板原文逐字内容演练未收到单独执行结果，仍保留 `NOT RUN`，不把流程验收扩写为私有内容逐字检查。当前按用户明确确认接受 U3 模拟 UI 切片；真实 Core/BFF/Runner、服务端保存/定稿/打包、重启与跨设备、真实客户交付及完整规模验收保持各自未运行边界。
- 本次仅收口审查与用户验收证据。用户未授权 commit/push/merge 或关闭 Issue；PR 保持 OPEN，正式审查记录仍仅在本地，原有 package/lockfile 改动保留。
- 用户验收及 APPROVE 结论已通过 [COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/309#pullrequestreview-5610648880) 发布并回读，绑定上述实现修订；GitHub 状态为 `COMMENTED`，不是正式 `APPROVED` 审批。

---

# 用户确认前的复审记录（历史）

以下为用户手动确认前的门禁快照；最新结论以上文为准。

HUMAN_REVIEW_REQUIRED。修订 `5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f` 的 R1–R4 均已关闭，未发现剩余代码阻断，当前修订的 full 范围 CI 全部通过；当时 #308 明确要求的用户 U3/UI-01–08 完整试走、脱敏反馈和总体确认仍为 NOT RUN。

# PR #309 复审（5af8c35，2026-10-22）

- 对象：[PR #309](https://github.com/qzhike/zhiju-business-core/pull/309)，关联 [Issue #308](https://github.com/qzhike/zhiju-business-core/issues/308)。
- Reviewed SHA：`5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f`；上一轮为 `f9b2387e5093c4d49328616948c62771a0d892b3`。
- PR base：`da8c6d7e3bc115d32cfb478b98d66766ad288932`。
- 已审上一轮至本轮全部八文件增量：共享活动 context、U2/U3 adapter、UI Spec/Test、双向活动锁浏览器回归、PostgreSQL 固定摘要及 owning Technology Baseline 说明。仍以 #308 和 UI01 U3 owning 约束判断，作者摘要不替代代码或执行证据。

## R4 已关闭

`fixtures/activity.ts` 提供只用于演练的共享活动 context；U3 根据恢复 PENDING/UNKNOWN/MISMATCH 提供 `recoveryActivity`，U2 的阶段页读取该状态，在按钮和 `submitRevision` 同时阻止第二批次。反方向，U3 的 `retryCanRun` 和 `requestRetry` 同时检查 U2 项目范围的活动 submission。

独立 Chromium focused 诊断使用当前未修改源码和 fixture 开发服务，五条路径均通过：

| 先发起的原请求 | 第二入口阻断、导航与收敛结果 |
|---|---|
| 恢复 PENDING | 阶段提交禁用，没有第二个 U2 请求；导航保留下一轮草稿和原恢复 ID；同一恢复请求收敛后阶段提交启用并可创建新请求。 |
| 恢复 UNKNOWN | 同上；原 UNKNOWN 不被导航或编辑当作结束。 |
| 恢复错绑 / MISMATCH | 同上；原请求保持锁定，同一请求得到匹配回执后才解锁阶段提交。 |
| 阶段 PENDING | 恢复重试禁用，没有第二个 U3 请求；恢复页仍可保存下一轮意见；原阶段请求 ID 保留，收敛后恢复重试启用。 |
| 阶段 UNKNOWN | 同上；意见草稿、保存历史与原阶段请求均保留，收敛后才创建恢复请求。 |

新增永久浏览器用例也覆盖两个操作顺序及原请求收敛后的释放。原 R1–R3 的请求保留、错绑锁和交付阻断守卫未被本轮削弱，当前修订的回归检查通过；R1–R4 不再要求按旧反例继续修复。未发现新的代码阻断。

## PostgreSQL 镜像基线与验证门禁

基线修改仍保留 PostgreSQL 18.6、`tag@digest` 引用、实时 tag/digest 绑定、RepoDigests 和实际 server version 检查，只把索引固定值从 `1267c7e…` 更新为 `edb0c08…`，并同步 Technology Baseline。没有删除验证门禁或降低范围。

独立执行两份固定摘要的只读 `docker buildx imagetools inspect … --raw`，对比得到以下平台摘要完全相同（未拉取运行镜像、未启动容器）：

| 平台 | 旧/新索引共同引用的平台摘要 |
|---|---|
| linux/amd64 | `sha256:9770878138a2e83abcb10856d30cc3f24dae0d317bb956db6ab9159de6c3c80d` |
| linux/arm64/v8 | `sha256:a8be76d23699a6c366437e9f80ead007975f24c35e01c9ee0533c6930ab57ac1` |

这支持本次在两个执行平台上为索引刷新，不能据此声明所有其他架构的镜像内容相同。

[CI run 39737759265 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39737759265/attempts/1) 的 `headSha` 为本轮 Reviewed SHA，completed/success；select、checks、三个 persistence gate、persistence 汇总及 verify 全部成功。代码日志确认 154 个单测文件、3,191 单测及 86 个工作区 Chromium 场景通过。三分区全部成功并经汇总确认，已提供当前修订 full 所需代码与持久化证据；上一轮镜像阻断已解除，旧失败历史保留在下方。

复用当前 CI，不重复执行本地 full。独立五条 UI 诊断及镜像索引比对只分别证明其具体检查内容，不替代配置验证或用户验收。

## 人工验收及交接

当前 #308 无新增用户总体确认。Issue Acceptance 的 “Obtain overall UI feedback” 及 Verify 第 3 项要求用户完成同项目 U1–U3 完整桌面试走，包含上游返工、部分结果恢复、未知请求核对、打包失败重试，并记录 tested SHA、脱敏观察和明确总体确认；此前 U1/U2 的接受与本轮自动化不替代这一门禁。私有来源内容演练也没有独立完成证据，保持 NOT RUN。

因此本轮角色结论为 HUMAN_REVIEW_REQUIRED：技术审查和当前修订自动验证通过，剩余动作属于明确要求的用户验收，不是新的代码修复要求。由用户完成/提供上述试走与总体确认，并分别记录私有内容证据；在此之前不关闭 #308，不把代码通过写为整体 UI/MVP 验收通过。

真实 Core/BFF/Runner 业务链路、服务端保存/定稿/打包、重启与跨设备恢复、真实交付/客户接收和完整规模验收仍在各自未运行边界内；当前持久化工程 Gate 的 PASS 不将这些行为升级为已实现。

本轮只更新正式审查记录，保留工作区已有 package/lockfile 改动，不修改产品代码或永久测试，不 commit/push/merge。正式审查记录当前仅在本地，Git 交付尚需相应授权。

已提交并回读绑定本轮 Reviewed SHA 的 [COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/309#pullrequestreview-5610621883)，GitHub 状态为 `COMMENTED`，角色结论 `HUMAN_REVIEW_REQUIRED`。本记录的 focused Prettier 检查及 `git diff --check` 通过，不称为配置 docs/full Gate。

---

# 上一轮复审历史（f9b2387，2026-10-22）

以下结论只适用于旧修订；R4 与 CI 的当前状态以上方复审为准。

REQUEST_CHANGES。修订 `f9b2387e5093c4d49328616948c62771a0d892b3` 已修复原 R1–R3 的直接反例，但仍可同时创建阶段修改和恢复两个未决批次（R4）；当时 full 所需的持久化 CI 未通过。

# PR #309 复审（2026-10-22）

- 对象：[PR #309](https://github.com/qzhike/zhiju-business-core/pull/309)，关联 [Issue #308](https://github.com/qzhike/zhiju-business-core/issues/308)。
- Reviewed SHA：`f9b2387e5093c4d49328616948c62771a0d892b3`；上一轮为 `4e75a401580dc79d0845fc531db1d0c8c7deae8e`。
- PR base：`da8c6d7e3bc115d32cfb478b98d66766ad288932`。
- 已检查上一轮至当前 head 的全部八文件修复增量：UI Spec/Test、U3 adapter、交付和恢复页面、U3 模型及单测、浏览器回归。任务、范围和验收未发生改变；不以作者修复摘要作为通过证据。
- 独立预期：未决请求在改选和导航中保留；错绑不能解锁重复执行；恢复与阶段修改共同遵守同项目最多一个活动修改批次；所有进入交付冻结的路径检查当前阻断。

## R1–R3 的直接反例已关闭

| 原问题 | 当前实现与独立检查 |
|---|---|
| R1：清单操作丢弃未决确认 | `selection.onToggle/onRecheck` 和交付控件都锁定 PENDING/UNKNOWN/MISMATCH。独立浏览器分别验证三种状态，改选/重核按钮禁用，概览往返保留同一个 `U3-FINAL-*`；原匹配回执查询后才能冻结。三条路径通过。 |
| R2：恢复 UNKNOWN 仍可冻结 | `unresolvedRecovery` 纳入 `deliveryBlockers`；`queryConfirmation` 在接纳回执前再次检查当前 blockers。独立验证：确认 PENDING → 恢复 UNKNOWN → 原确认回执到达并查询，保持未冻结和原确认 ID；收敛同一恢复请求后，再查询原确认才成功。该交付反例已关闭。 |
| R3：错绑恢复回执解锁重试 | `retryCanRun/requestRetry` 均阻止 MISMATCH；匹配的新回执可以收敛原请求。独立验证错绑 → 查询 → 禁止重试 → 概览往返原 ID 不变 → 同一请求匹配回执 → 追加恢复尝试。该反例已关闭。 |

修复同时补充失败请求历史，并调整了原先将错绑后新建请求当成成功路径的测试。显式“已结束”动作属于标明模拟的演练控制，不是实际服务端取消或结束证据。

## R4 · P2：阶段修改与执行恢复仍能并行创建未决批次

位置：[u3.tsx:523–528](https://github.com/qzhike/zhiju-business-core/blob/f9b2387e5093c4d49328616948c62771a0d892b3/apps/workspace-web/src/fixtures/u3.tsx#L523)、`requestRetry`；对应阶段修改的 [submitRevision](https://github.com/qzhike/zhiju-business-core/blob/f9b2387e5093c4d49328616948c62771a0d892b3/apps/workspace-web/src/fixtures/u2.tsx#L1107)。

当前修复只把 `unresolvedRecovery` 接入最终交付。恢复发送端仍只检查自己的 `retryStatus`，没有检查已经取得的阶段 `active`；阶段发送端只从 U2 sessions 查找活动 submission，也看不到 U3 恢复状态。两个方向均通过实际 Chromium 页面独立复现：

1. 完成三阶段候选和复核 → 恢复页以 UNKNOWN 发起 `U3-RETRY-23b71b64` → 返回记录表单输入意见并设 UNKNOWN → “提交并修改”仍启用，实际创建 `U2-REV-e69f0f08`；回到恢复页，原 `U3-RETRY-23b71b64` 仍 UNKNOWN。
2. 先在记录表单创建 UNKNOWN 修改 `U2-REV-abe84ebc` → 打开恢复页，“仅重试失败文件”仍启用 → 实际创建 UNKNOWN 恢复 `U3-RETRY-182bb54a`；返回记录表单，原修改仍显示“提交结果待核验”。

影响：同项目同时存在两个未决修改意图；交付被阻断并不能补偿执行侧的并发修改。违反 #308 Acceptance 的单活动修改批次要求，以及 UI01 U3 展示增量第 3 项和 UI-MVP-U3-003。此要求是当前范围内已有约束，不需要新增产品决定或后端能力。

要求：恢复和阶段修改共用项目级活动状态检查，在按钮和发送端同时阻止第二个批次；覆盖 PENDING/UNKNOWN/未收敛错绑状态，同时保留查看结果、保存下轮意见与查询原请求的能力。补充上述两个操作顺序的连续回归，断言第二个请求未创建；原请求明确收敛后才允许后续修改。

## 当前验证证据与剩余门禁

- [CI run 39701836705 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39701836705/attempts/1) 绑定 Reviewed SHA，已完成且失败。`select` 选择 full，`checks` 成功；日志确认 154 个单测文件、3,191 个单测和 84 个工作区 Chromium 场景通过。不是 full PASS。
- 三个持久化分区均在 PostgreSQL 启动与镜像校验阶段失败，随后 persistence/verify 汇总失败。[partition 1 日志](https://github.com/qzhike/zhiju-business-core/actions/runs/39701836705/job/119572714155) 明确记录：`postgres:18.6` 当前解析为 `sha256:edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`，仓库固定值为 `sha256:1267c7e692de235fda2a50dbcdbcbca4672ea6a0298576a6bd9d07cafc319b32`。这是镜像基线阻断，不是已观察到的 U3 数据库断言失败；持久化测试没有运行。不得沿用旧 SHA 的 full PASS 或跳过该门禁。
- 本轮未重复执行已确定受同一镜像条件阻断的本地 full，也未改变镜像固定值、验证配置、依赖或产品代码。需按项目流程解决基线问题，并为最终 SHA 取得当前通过证据；不在 Reviewer 角色中扩大实现范围修复它。
- 独立 focused 浏览器使用 Reviewed SHA 的未修改源码和 fixture 开发服务。五条修复路径完成检查，另两条跨页面路径复现 R4；它们不替代构建或完整配置验证。临时诊断曾因选择器写为 `.stage-review` 超时，改用实际 `.stage-review-page` 后完成两条 R4 检查；该诊断驱动错误不计为产品失败。
- **NOT RUN**：私有来源逐字内容演练、用户 U3/UI-01–08 完整试走和明确总体确认、真实 Core/BFF/Runner 业务链路、持久化运行、重启/跨设备恢复、真实交付与客户接收。自动化和模拟结果均不代替这些证据。
- 只更新本正式审查记录；工作区原有 `package.json`、`pnpm-lock.yaml` 改动保留，不 commit/push/merge 或关闭 Issue。

## 本轮交接

已提交并回读绑定本轮 Reviewed SHA 的 [COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/309#pullrequestreview-5608047545) 和 [R4 行级 comment](https://github.com/qzhike/zhiju-business-core/pull/309#discussion_r4343529203)，GitHub 状态为 `COMMENTED`，角色结论为 `REQUEST_CHANGES`。本正式记录的 focused Prettier 检查及 `git diff --check` 通过，不称为配置 docs/full Gate；记录仍仅在本地，未 commit/push。

Implementer 应修复 R4 并补充两个方向的单活动批次回归；最终实现需取得通过的 full 范围证据并再次独立复审。原 R1–R3 的直接问题无需按旧反例重复修复。#308 的人工总体试走仍需用户完成并记录 tested SHA 与脱敏反馈。

---

# 首轮审查历史（4e75a40，2026-10-22）

以下结论只适用于旧修订；R1–R3 的当前状态以上方复审为准。

REQUEST_CHANGES。PR #309 的环境 A 演练在未决请求保护及跨页面交付阻断上存在三个已独立复现的缺陷；当时 CI 全绿不能证明这些交叉路径满足 #308 验收。

# PR #309 独立审查

- 审查日期：2026-10-22。
- 对象：[PR #309](https://github.com/qzhike/zhiju-business-core/pull/309)，关联 [Issue #308](https://github.com/qzhike/zhiju-business-core/issues/308)。
- Reviewed SHA：`4e75a401580dc79d0845fc531db1d0c8c7deae8e`。
- Base SHA：`da8c6d7e3bc115d32cfb478b98d66766ad288932`。
- 分类与边界：T1，Workspace UI 的隔离环境 A 展示切片；不评定真实 Core、Runner、持久化或生产打包能力。
- 权威：Issue #308 Acceptance/Verify、[可用闭环 §5–6](../../mvp/usable-loop.md#5-人工决定讨论和版本)、[UI01 U3 展示增量](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpu3-返工恢复与交付2026-10-21)及 [UI01 U3 验收](../../module-tests/Module-Test-UI01-WorkspaceUI.md#缩编-mvpu3-返工恢复与交付验收2026-10-21)。

## 独立预期与审查范围

从任务和契约建立的预期：草稿不替代已定稿依据；重新定稿保存历史并要求下游复核；修改批次、确认和打包在结果未知或回执错绑时保留原请求；未解决的相关修改阻止最终交付；最终确认冻结精确内容，后续修改不改变历史包。公开演练始终标明内存与合成内容边界。

检查了 PR 变更清单、owning Spec/Test 增量、U3 展示模型及 adapter 的请求/回执/清单/打包逻辑、U2 阶段状态与重新定稿接点、交付和恢复页面、导航接入及相关浏览器覆盖。随后针对未决请求、错绑回执与跨页面交付进行了独立 Chromium 诊断。以下三个反例均走实际页面操作，没有修改产品代码或永久测试。

## R1 · P2：重新核对清单会丢弃未决交付确认

位置：[u3.tsx:748–756](https://github.com/qzhike/zhiju-business-core/blob/4e75a401580dc79d0845fc531db1d0c8c7deae8e/apps/workspace-web/src/fixtures/u3.tsx#L748)，同类重置也存在于 `selection.onToggle`。

复现：完成三阶段审阅和记录复核 → 重新核对交付清单 → 选择 UNKNOWN 确认回执并显式确认 → 点击仍可用的“重新核对当前清单（模拟）” → 再次确认。

实际：第一个 `U3-FINAL-289307c4` 未收敛就从状态中消失；第二次得到 `U3-FINAL-f09b5786`。`onRecheck` 无条件将 `confirmStatus` 设回 NONE，并删除 `confirmRequest`；重新选择文件也可以清掉原请求。页面因此失去查询原请求的入口，并允许创建第二个确认意图。

要求：PENDING/UNKNOWN（以及尚未查明原请求结果的错绑状态）期间保留原确认意图；选择/重新核对不能代替原请求收敛。允许编辑下一轮选择时，也须与当前未决请求分别保留。新增 UNKNOWN/PENDING → 重新核对或改选 → 导航往返 → 原回执恢复的回归。

违反：Issue #308 的未知请求核对及显式精确交付确认要求，UI-MVP-U3-004/005。

## R2 · P2：执行恢复 UNKNOWN 未阻止最终交付

位置：[u3.tsx:329–342](https://github.com/qzhike/zhiju-business-core/blob/4e75a401580dc79d0845fc531db1d0c8c7deae8e/apps/workspace-web/src/fixtures/u3.tsx#L329)。

复现：完成三阶段和交付清单核对 → 导航到“执行与恢复” → 选择 UNKNOWN 并“仅重试失败文件” → 未查询或收敛原请求就导航回最终交付 → 确认并冻结。

实际：恢复请求 `U3-RETRY-f90648a2` 仍 UNKNOWN，交付确认按钮却启用，实际产生“清单已冻结（模拟）”。交付阻断只收集 `u2.sessions[*].submissions`，没有纳入 `execution.retryRequest/retryStatus`；两页没有共享同一活动修改状态。

要求：将当前项目中未决恢复请求纳入交付和修改批次的活动状态判断；原请求未解决前禁止最终确认，保留选择和返回原请求的动作。确认回执查询等所有进入冻结的路径也须检查当前阻断。新增恢复 PENDING/UNKNOWN → 导航交付 → 确认阻断 → 收敛原请求的连续回归。

违反：Issue #308 要求同项目连续旅程、单活动修改批次，以及“未解决相关修改阻止交付”；UI-MVP-U3-001/003/005。

## R3 · P2：错绑重试回执被当作可重新执行的状态

位置：[u3.tsx:1018–1022](https://github.com/qzhike/zhiju-business-core/blob/4e75a401580dc79d0845fc531db1d0c8c7deae8e/apps/workspace-web/src/fixtures/u3.tsx#L1018)，关联 `retryCanRun` 和 `requestRetry`。

复现：恢复页选择“错尝试/错项目回执” → 仅重试失败文件 → 查询原重试请求 → 改选 pending → 再次点击仅重试失败文件。

实际：查询错绑回执后状态为 MISMATCH，按钮重新启用。原请求 `U3-RETRY-270ad87f` 未证明结束就被 `U3-RETRY-16fd6abe` 替换。`retryCanRun` 和发送端仅阻止 PENDING/UNKNOWN，没有将未收敛的 MISMATCH 保持为同一请求；现有浏览器测试还把错绑后创建新请求写成成功路径。

要求：错绑只能说明收到的响应无效，不能证明原尝试结束。保持原请求可核对且不可重发，直至同一请求获得匹配的确定结果；仅已知失败/结束允许创建新的恢复意图，并保留旧请求历史。修正现有错绑测试并补充原 ID 不变的断言。

违反：Issue #308 明确规定缺少或不匹配响应不能证明结束或允许第二次执行；UI-MVP-U3-004。

## 验证证据与边界

- [CI run 39624367029](https://github.com/qzhike/zhiju-business-core/actions/runs/39624367029) 的 `headSha` 与 Reviewed SHA 一致，completed/success；checks、三份 persistence gate、persistence 汇总及 verify 全部通过。路由运行了 full 所需的代码与持久化检查。复用该证据，没有重复本地 full。
- 本轮临时 Playwright 诊断使用 reviewed SHA 的未修改源码及 fixture 开发服务，无头 Chromium 操作实际页面；三个反例均复现。上述随机请求 ID 是本轮观察值，不是固定验收输入。诊断只证明三个具体状态反例，不替代完整配置验证或构建证据。
- 正式审查记录的 focused Prettier 检查及 `git diff --check` 均通过；未把这两项检查称为配置 docs/full Gate。
- 本轮不读取/输出私有客户原文、原件路径或截图；公开反例仅含匿名演练状态。
- **NOT RUN**：私有来源内容逐字演练、用户 U3/UI-01–08 完整试走与明确总体确认、真实 Core/BFF/Runner 业务链路、持久化/重启/跨设备恢复、真实交付或客户接收。既有自动化不替代这些证据。
- 保留工作区已有 `package.json` 和 `pnpm-lock.yaml` 改动；本轮只新增本正式审查记录，不修改产品代码，不 commit/push/merge，不关闭 Issue。

## 交接

已发布并回读绑定 Reviewed SHA 的 [COMMENT review](https://github.com/qzhike/zhiju-business-core/pull/309#pullrequestreview-5607884325) 及三个行级 comments：[R1](https://github.com/qzhike/zhiju-business-core/pull/309#discussion_r4343388394)、[R2](https://github.com/qzhike/zhiju-business-core/pull/309#discussion_r4343388401)、[R3](https://github.com/qzhike/zhiju-business-core/pull/309#discussion_r4343388405)。GitHub 状态为 `COMMENTED`，角色结论为 `REQUEST_CHANGES`，不声称已提交正式 Request changes 审批。发布后再次读取 PR head，仍为 Reviewed SHA。本文件本地保存，尚未 commit/push。

Implementer 应在 #309 修复 R1–R3 并增加跨页面反例覆盖，再对新的最终 SHA 取得所需验证和独立复审。#308 的人工总体确认仍需用户完成并记录 tested SHA 与脱敏观察；本审查不将其记为已通过，也不授权合并。

---

# 最终独立复审（reviewer role，5af8c35，2026-10-22）

APPROVE。Reviewed SHA：`5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f`；base：`da8c6d7e3bc115d32cfb478b98d66766ad288932`。本结论只覆盖该修订的实现增量、exact-head CI 与本地 focused 只读检查；不把用户试走/总体确认、私有内容、真实 Core/BFF/Runner、持久化重启/跨设备或真实交付记为已通过。此前各轮记录全部保留。

## 范围与权威

- 对象：[PR #309](https://github.com/qzhike/zhiju-business-core/pull/309)，关联 [Issue #308](https://github.com/qzhike/zhiju-business-core/issues/308)。
- 增量：`8685eac`（阶段修改与执行恢复共享项目级活动检查、两个操作顺序的浏览器回归、UI01 Spec/Test）与 `5af8c35`（PostgreSQL 索引固定值 `1267c7e…` → `edb0c08…` 及 Technology Baseline 说明）。上一轮 Reviewed SHA 为 `f9b2387e5093c4d49328616948c62771a0d892b3`。
- 权威：Issue #308 的 Acceptance/Verify、[UI01 U3 展示增量](https://github.com/qzhike/zhiju-business-core/blob/5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f/.vibe/module-specs/Module-Spec-UI01-WorkspaceUI.md#缩编-mvpu3-返工恢复与交付2026-10-21)、[UI01 U3 验收](https://github.com/qzhike/zhiju-business-core/blob/5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f/.vibe/module-tests/Module-Test-UI01-WorkspaceUI.md#缩编-mvpu3-返工恢复与交付验收2026-10-21) 及 PR #309 的 R1–R4 讨论。owning Test 当前仍把用户 U3 整体试走与总体确认记为 `NOT RUN`；本复审不引用此前记录中的用户口头确认作为证据，也不将其升级为已验收。

## R1–R4 处置

| 项 | 状态 | 依据 |
|---|---|---|
| R1 未决交付确认被清单操作清除 | CLOSED（沿用上一轮） | 原确认请求在改选、重核与导航后保留；本轮未回退该逻辑。 |
| R2 UNKNOWN 恢复未阻止最终交付 | CLOSED（沿用上一轮） | `unresolvedRecovery` 仍在 `deliveryBlockers`；CI 场景 78 通过。 |
| R3 错绑恢复回执解锁重试 | CLOSED（沿用上一轮） | `retryCanRun`/`requestRetry` 保持 MISMATCH 锁定；CI 场景 75 通过。 |
| R4 阶段修改与执行恢复并行创建未决批次 | CLOSED（本轮独立复核） | 见下。 |

### R4 共享项目活动检查

- `apps/workspace-web/src/fixtures/activity.ts` 定义项目级恢复活动；U3 provider 在 `u3.tsx:342` 将 PENDING/UNKNOWN/MISMATCH 的 `U3-RETRY-*` 作为 `recoveryActivity`，并在 `u3.tsx:1008` 通过 context 提供给路由内页面。
- 恢复优先：U2 阶段页读取 `useMvpActivity().recovery`（`u2.tsx:590`），`submitBlocked`（`u2.tsx:1600`）禁用“提交并修改”，发送端 `submitRevision` 在 `u2.tsx:1117` 同时拒绝。未决恢复期间 U2 不创建 `U2-REV-*`；下一轮草稿保存仍只受草稿状态约束，恢复查询仍只受恢复状态约束，均未被该守卫关闭。
- 阶段优先：U3 通过同一 `u2.sessions[*].submissions` 计算 `active`（`u3.tsx:339`），`retryCanRun` 在 `u3.tsx:528` 增加 `!active`，`requestRetry` 在 `u3.tsx:1015` 再次拒绝；恢复按钮禁用且不创建 `U3-RETRY-*`，恢复页仍可保存意见草稿并查询原请求。
- 释放：恢复匹配回执经查询后 `retryStatus='RECEIVED'`（`u3.tsx:1162`），活动消失；阶段匹配回执查询后 submission 为 `RECEIVED`（`u2.tsx:1288`），`activeSubmission` 不再返回该批次（`review-model.ts:371`）。错绑阶段回执保持 `UNKNOWN`，不会误释放。
- 导航：U3 provider 位于 `App.tsx:279-283` 的 Routes 之外，两个方向的临时状态在页面往返后保留；owning Test 的新场景 `u3-journey.spec.ts:471` 与 `:500` 分别断言第二入口被禁用/未创建请求、原请求 ID 保留以及收敛后释放。
- 未发现仍可通过按钮或发送端并行创建未决批次的路径：`U2-REV-*` 仅由 `submitRevision` 创建，恢复重试仅由 `requestRetry` 创建。R1–R3 的守卫未被本轮削弱。

## PostgreSQL 固定值变更

- `tools/persistence/baseline.mjs` 仅将 `POSTGRES_IMAGE_DIGEST` 从 `1267c7e…` 改为 `edb0c08…`；仍使用 `postgres:18.6@sha256:…`、RepoDigests 与实时 tag 绑定以及 `server_version_num` 校验，未移除门禁。
- 独立只读比对：两份 raw index 的字节 SHA-256 分别为 `1267c7e692de235fda2a50dbcdbcbca4672ea6a0298576a6bd9d07cafc319b32` 和 `edb0c08dc33befd0262ab3b5cf1c4f3f8cfd8b09e88c05b45adee29d6761ddb6`，与仓库固定值及当前 `postgres:18.6` tag 的解析值一致。逐 descriptor 比较只有 `linux/riscv64` 及其 attestation 变化（`2337683c…` → `b651307c…`）；`linux/amd64`（`977087…`）、`linux/arm64/v8`（`a8be76…`）及其他平台与旧固定值完全相同。riscv64 manifest 的 `org.opencontainers.image.revision` 仍为 `e00e1bd34ec5c8a8e7ad89b273b3d42efaf6d5bc`，base 仍为 `debian:trixie-slim`。
- CI 三个 persistence 分区均记录 `postgres image: …@sha256:edb0c08…` 与 `server_version: 180006`，持久化汇总与 verify 成功。这是索引刷新与 amd64 执行验证，不是生产镜像验收；生产 PostgreSQL 仍为 `NOT RUN`。

## CI 与本地 focused 证据

- [CI run 39737759265 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39737759265/attempts/1)：`headSha` 为本轮 Reviewed SHA，completed/success；`select`、`checks`、`persistence-1/2/3`、`persistence`、`verify` 全部成功。
- `checks`：154 个测试文件、3,191 个单测通过；86 个 workspace Chromium 场景通过，其中包含新增的“恢复阻止第二批次”（日志序号 79）与“阶段修改阻止恢复”（序号 80），以及 R1–R3 回归场景。
- 复用 exact-head CI，未重复本地 full，未构建或运行完整应用。仅执行 `git diff --check f9b2387..5af8c35`（通过）与变更文件的 focused Prettier 检查（通过）；不把这两项称为配置 docs/full Gate。

## 未运行边界

- **NOT RUN**：用户 U3/UI-01–08 完整桌面试走与明确总体确认（owning Test 仍记为 `NOT RUN`）、私有来源逐字内容演练、真实 Core/BFF/Runner、服务端保存/定稿/打包、重启与跨设备恢复、真实客户交付/接收、生产 PostgreSQL 镜像验收及完整规模验收。自动化与模拟通过不代替上述证据。

## 交接

本轮只追加本正式审查段并保留此前全部内容；工作区原有 `package.json`、`pnpm-lock.yaml` 改动未触碰；未修改产品代码或永久测试，未 commit/push/merge，未关闭 Issue 或删除分支。本 `APPROVE` 以实现增量与 exact-head 自动化证据为范围，不把 #308 的用户验收门禁标记为完成；合并与关闭仍受该 Issue 的验收记录约束。
