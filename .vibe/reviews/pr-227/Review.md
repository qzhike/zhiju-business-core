# PR #227 独立实现审查记录（第 1 轮）

- PR：[#227](https://github.com/qzhike/zhiju-business-core/pull/227)（Draft，无独立 Issue）
- Base SHA：`aa6784062949424668b88b7a4eefab0da0aa447d`（origin/main）
- 被审 Head SHA：`cdded755ca8145ab42fd207b253f952d72f0f2cd`
- 日期：2026-09-25
- 角色结论：`APPROVE`

## 审查范围与依据

本 PR 是 [08-verification-baseline.md](../../high-level-docs/08-verification-baseline.md) 镜像 pin 漂移程序（「若远端 registry 重新解析固定 tag，先更新经核对的 immutable pin，再重新执行本地和 exact-head Gate」）规定的验证基线维护：把 `tools/persistence/baseline.mjs` 中 `postgres:18.6` 的固定 manifest digest 从 `sha256:86c951e0…` 更新为该 tag 当前发布的 index digest `sha256:5a5a84b1…`。与 Issue #224 / Draft PR #226 的隔离有依据：PR #226 复审第 2/3 轮已确认该漂移阻断其持久化门禁，且 pin 更新被显式划出该业务 PR 范围。

独立对照的权威来源：漂移程序条款、`tools/persistence/baseline.mjs` 现状与 gate 语义、实际 diff（1 文件、+1/-1）、CI 与 registry 事实。

## 独立核实

- 经 Docker Hub Registry API（匿名 token、Accept index/manifest-list）独立查询，`library/postgres:18.6` 当前 `docker-content-digest` 为 `sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722`，与本 PR 新 pin 逐字符一致。
- diff 仅改 `POSTGRES_IMAGE_DIGEST` 一行；tag `18.6`、Flyway `11.20.3` pin、`tag@digest` 结构及 `assertTagMatchesDigest`/`assertRepoDigestMatches`/`expectedServerVersionNum`（180006）语义均不变，tag↔digest 绑定检查继续 fail-closed。
- 仓内旧 digest 仅余两处：本 PR 更新的 `baseline.mjs`，以及 Module-Spec-003 §20.5 中 2026-09-19 的**历史**漂移记录（历史事实，不应改写）；无任何当前态文档单独登记 pin，不存在文档过时问题。

## 验证证据（绑定被审修订）

- 必需目标：`full`（persistence tooling 变更；项目策略与 CI 选择器一致，日志 `[verification] target=full reason=persistence-or-verification-sensitive changed_path_count=1`）。
- CI [run 36097481119](https://github.com/qzhike/zhiju-business-core/actions/runs/36097481119)：`head_sha=cdded755ca8145ab42fd207b253f952d72f0f2cd`、`conclusion=success`；覆盖 clean build、代码测试、catalog_registry=PASS（catalog=221），真实 Docker/PostgreSQL 持久化门禁实际执行（迁移成功应用，即新 pin 镜像实际拉起运行）。
- PR body 声明同修订本地 `vibe verify environment --json` 与 `vibe verify full --json` PASS；按证据复用规则以 exact-head CI `full` 证据为准，未本地复跑。

## 未执行边界（保持 NOT RUN）

- 本 PR 不改动任何业务行为；既有 NOT RUN 边界（外部 Provider、公开 HTTP、跨模块业务 E2E、生产、独立人工业务验收）不受影响。
- PR #226 的 `full` 证据缺口不在本 PR 范围：本 PR 合并后，#226 需对其届时 head 重跑 `full` 补齐证据。

## 交接

`APPROVE` 为独立 agent 审查结论，不授权 merge/deploy；本 PR 仍为 Draft，ready/merge 人类门禁不变。本记录入库不授权 commit/push；GitHub 侧以 PR 评论发布同一结论（认证用户 galendai 即 PR 作者，GitHub 不允许对自有 PR 提交 formal review，不声称已形成 formal review）。
