# PR #296 正式代码审查

结论：`APPROVE`。独立审查确认下述代码修订满足第一阶段 CI 风险分级要求，唯一 P2 已修复关闭，未发现剩余阻断问题。

## 审查对象

- PR：[CI 风险分级与同 PR 旧运行取消](https://github.com/qzhike/zhiju-business-core/pull/296)。
- 已审查代码提交：[`ecf90489b58d9177c81e5a4b8d93c9bbc73b6cc0`](https://github.com/qzhike/zhiju-business-core/commit/ecf90489b58d9177c81e5a4b8d93c9bbc73b6cc0)。
- 本地验证基线：`8afaa30a89e61f9028ccea0031bdc820c6aab3ec`。
- 七文件内容 SHA-256：`ff86d74044aa88c3e13ba5b0e2356d4e3898f8cd5035b240bbb98a60fd8d2c3d`。按相对路径字典序，将各路径、NUL、文件内容、NUL 依次输入同一 SHA-256；提交对象、交付副本和验证副本已独立核对一致。
- 范围：`.github/workflows/ci.yml`、`.vibe/high-level-docs/08-verification-baseline.md`、`AGENTS.md`、`tools/verification/select-target.mts`、`tools/verification/select-target.test.ts`、`tools/verification/check-ci-results.test.ts`、`tools/verification/ci-workflow.test.ts`。

## 审查结果

- Draft 与 ready PR 使用相同风险边界：只有精确低风险 UI 允许路径及可选严格文档路径走 `code`；Core、授权/Session/Scope、真实操作、Contract、持久化、依赖/构建/验证策略，以及未知或混合范围保留 `full`。main 非文档变更仍为 `full`。
- 分类读取完整 base-to-head diff。重命名保留旧、新路径，删除与文件类型变化纳入判断；空集合或无法比较时回退 `full`，末次文档提交不会隐藏此前高风险变更。
- 同一工作流的同 PR 运行共享取消组，不同 PR 隔离；main 按 run id 独立分组且不取消旧运行。汇总继续拒绝失败、取消、缺失和非预期 skipped，不将旧修订取消视为当前修订通过。
- 允许列表与当前展示/开发 fixture 职责相符，真实生产入口及 adapter 未放行；验证基准与 Agent 规则同步，未修改业务实现或数据库测试语义。

## 已关闭发现

`[P2] 路径有损归一化绕过精确允许列表`：原 `trim()`、反斜杠替换及空输入过滤会改变 Git 路径身份，使未知路径误归入 `code` 或 `docs`。修复后直接匹配 Git NUL 分隔输出的原始路径，未知路径与合法路径混合时仍为 `full`。

回归覆盖首尾空格、字面反斜杠、`./`、空白/空字符串，以及真实 Git 文件名的混合 diff。修复前新增反例有 30 例失败；修复后聚焦回归全部通过。Reviewer 独立执行原始路径及合法路径对照的 66 项断言，全部通过。该发现关闭。

## 验证证据

| 证据 | 结果与范围 |
| --- | --- |
| 路由、并发与汇总聚焦回归 | 3 文件、219 项通过。 |
| Reviewer 独立窄范围断言 | 66 项通过；未修改实现。 |
| 配置化本地验证 | `vibe verify full --json` PASS、退出码 0；普通测试 124 文件/2695 项，PostgreSQL 58 文件/709 项；Workspace 独立构建与浏览器检查通过，容器清理完成。复用已通过且环境未变化的 `environment` 证据。 |
| 提交等价性 | 代码提交与上述已审查、已验证的七文件补丁一致，提交范围一致，工作树干净，diff whitespace 检查通过。 |
| 远端完整 CI | [run 38553054225 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38553054225/attempts/1) SUCCESS；`select`、`checks`、`persistence`、`verify` 全部 SUCCESS。主任务已按精确 run/attempt 回读，并核对 PR head 为 `ecf90489b58d9177c81e5a4b8d93c9bbc73b6cc0`、base 为 `7fe1ee77760114c06ef6d0ecc3b67586320733ba`，PR 为 CLEAN/MERGEABLE。 |

远端事实来源为主任务已完成的 GitHub 回读。编写本文时，Reviewer 子代理的沙箱及宿主独立查询均连接超时，因此不声称本次子代理再次查询成功。已验证结果按精确提交复用，没有重复执行本地 full。

## 未运行边界与后续文档提交

真实 GitHub 同 PR 新提交取消旧运行的行为尚未专门演练，仍为 `NOT RUN`；本地并发表达式与取消汇总回归不能替代该远端场景。外部 Provider/飞书、生产部署及人工业务验收不属于本次 CI 策略验证，保持 `NOT RUN`。

本文将由后续单独文档提交交付，不改写已发布代码提交。上述 APPROVE 与 full 证据绑定已审查代码提交，不预先声明尚未产生的文档提交 SHA 或其 CI 结果。合并前须在 PR 中独立回读最终 head，确认增量仅为本审查文档、七文件内容及代码版本保持等价，并确认最终 head 的所选 CI 检查通过；该最终回读结果记录在 PR 中。
