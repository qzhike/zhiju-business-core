> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/Agent-PR19-Code-Review/PR-19-Code-Review-Round-3.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/Agent-PR19-Code-Review/PR-19-Code-Review-Round-3.md).

# PR #19 第三轮代码审查记录

## 审查范围

- 复核 PR #19 最新 head，验证第二轮两个阻塞问题及其回归。
- 检查 Schema compatibility 的接受集合判断、冻结 envelope、历史版本选择、人工审批 Gate、文档和完整验证。
- 有问题时向 PR 发布可复现评论；无问题时在最新 head 的必需检查通过后精确合并，并核验 PR 与原始 Issue #8 均关闭。

## 成功标准

1. `multipleOf`、`patternProperties`、`prefixItems` 等上下文相关变化不能把历史有效实例误判为兼容。
2. 历史 Command、Query、Event envelope 与 payload/result Schema 均来自冻结 v1.0 基线，不依赖当前 envelope builder。
3. 第一、二轮全部反例有永久回归，人工批准不能覆盖结构性破坏。
4. 聚焦测试、`pnpm clean && pnpm verify` 和最新 head CI 全部通过。
5. 合并时 PR head 未漂移，合并后可验证 head 已进入 `origin/main`，PR 与 Issue #8 均为 `CLOSED`。

## 审查结果

- 审查 head：`f6cd227ed10787592e6db644da298267c93d97e7`。
- 第二轮反例：`multipleOf`、`patternProperties`、`prefixItems` 均产生结构性 `BREAKING`；第一轮四个反例继续失败；冻结 Event envelope 与 payload 验证通过。
- 自动化：GitHub `verify` 通过；本地 `pnpm clean && pnpm verify` 通过，12 个测试文件、283 个测试全部通过；Gate 报告 14 个 Schema 文档、200 个 envelope、200 个 operation，`findings=0`。
- 阻塞问题：compatibility Gate 的当前 envelope 来源是手工复制的 `tools/contracts/lib/live-envelopes.ts`，生产 Registry 使用 `contracts/src/envelopes.schema.ts`。两份当前仅 import 后缀不同，但没有生成关系或一致性 Gate；单独修改生产 envelope 时，Gate 会继续比较旧副本与冻结基线并错误 PASS。
- 现有 `historical-baseline.test.ts` 只禁止历史 Registry 导入 live builder，没有验证工具副本与生产 envelope builder 的语义同源。
- 结论：`NOT APPROVED`。向 PR 发布该 P1；不合并 PR，不关闭 Issue #8。
