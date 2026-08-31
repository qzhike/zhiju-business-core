# Issue #22 修复工作记录

## 当前范围

根据 Issue #22 的最新评论，修复已合并 PR #141 遗留的 Recall 授权主体绑定缺陷：Recall Runtime Handler 必须使用当前 Recall AuthorizationDecision 所引用的 ActorSnapshot，不能用 Release 原始授权时保留的 ActorSnapshot 代替当前 Recall 主体来源。

## 当前基线

- Issue：#22，状态为 OPEN。
- 已合并提交：`4954b89`，合并后的当前基线为 `737eaf3`。
- 当前工作树：`im-rp-002-enforce-release-authorization-actor-pr`，初始状态干净。
- 最新评论要求：补充不同授权 Human 的有效 Recall、主体/范围/用途/载荷哈希不匹配、过期/撤销、Agent 与 `actingFor` 负向回归，并证明拒绝路径没有 Recall、ImpactReview、Event 或 Release 状态副作用。

## 验收边界

本次仅处理 Issue #22 指定的 Release Publication 授权主体运行时不变量，并同步权威 HL-Spec、Module-Spec、Module-Test 与本次验证记录。真实 Identity Provider、生产环境、公共 HTTP、统一跨模块业务 E2E 与独立人工验收仍需以 `NOT RUN` 明确记录，除非本次有直接证据。

## 已完成与验证

1. 已对照权威 Spec、Handler、Persistence Port 和现有测试，确认缺陷是 Handler 把 Release 原始 `authorization_actor_snapshot_ref` 误用为当前 Recall 主体。
2. 已先更新 HL-Spec、Module-Spec、Module-Test 和验证报告，再实施最小代码修复：Recall 先解析当前 AuthorizationDecision，再使用该 Decision 的 exact ActorSnapshot；未新增 Migration 或公共 Contract 字段。
3. 已补充不同 Human、主体/范围/用途/command/payload hash、过期/撤销、Agent/`actingFor` 和无业务副作用回归。聚焦测试为 `4 files / 35 tests PASS`；Persistence Gate 为 PostgreSQL 18.6/Flyway 11.20.3、`34 files / 314 tests PASS`，二次迁移为 `No migration necessary`；`pnpm clean && pnpm verify` 为 `42 files passed / 30 skipped`、`439 passed / 299 skipped`。

## 当前 GitHub 交付状态

1. 修复 commit `14598cc63ad935337b61c386336537a60c38959e` 已推送，follow-up PR #142 已创建；该 exact head 的 GitHub `verify` 已通过。Issue #22 在 PR 实际合并和重新验收前保持 OPEN。
2. PR #142 code review 确认核心 Recall 修复方向正确，同时要求先订正 #23/#24 的失败状态、未执行测试边界和过期 Git 状态。本轮只修复文档对齐，尚未生成新的修复 commit。
3. 请用户检查本记录和权威文档差异；收到明确确认后，才执行 scoped staging audit 和新的 Git commit。真实 Identity Provider、Provider/Feishu、公开 HTTP、生产、统一跨模块业务 E2E、外部收件人和独立人工验收仍保持 `NOT RUN`。
