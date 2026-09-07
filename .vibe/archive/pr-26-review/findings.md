> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/pr-26-review/findings.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/pr-26-review/findings.md).

# 发现与决策

## 需求
- 审查 https://github.com/qzhike/zhiju-business-core/pull/26
- 修复审查发现的错误
- 合并 PR 并关闭原始 Issue #17

## 研究发现

### PR #26
- 标题：`feat(integration-gateway): add runtime acceptance slice`
- 状态：OPEN，mergeable=MERGEABLE，mergeStateStatus=CLEAN
- 分支：`galendai/17-im-01-integrationgateway-runtime-acceptance-gaps` → `main`
- Head SHA：`d2090030a3080415fb276e495898100131921989`
- Base SHA：`d79749098eba4354109998cc281117a6aaae3184`
- CI：`verify` SUCCESS（GitHub Actions run 32533978812）
- 无 labels、无 reviews、无 comments
- `closingIssuesReferences` 为空（PR body 用 `Refs #17`，不会自动关闭 Issue）

### 变更文件（8）
- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/archive/issue-17-integrationgateway-runtime-acceptance-gaps/Task-Plan.md`（新增）
- `.vibe/archive/issue-17-integrationgateway-runtime-acceptance-gaps/Verification-Report.md`（新增）
- `.vibe/module-specs/Module-Spec-007-IntegrationGateway.md`
- `.vibe/module-tests/Module-Test-007-IntegrationGateway.md`
- `modules/integration-gateway/src/index.ts`
- `modules/integration-gateway/src/integration-gateway-runtime.test.ts`（新增）
- `modules/integration-gateway/src/integration-gateway-runtime.ts`（新增 855 行）

### Issue #17
- 标题：`[IM-01] IntegrationGateway runtime / acceptance gaps remaining after PR #16 schema slice`
- 状态：OPEN
- 验收目标候选：
  - IG-API-U-001 / U-002 / U-003 / C-001 / C-002 / E-001 / E-002 / M-001 中至少 Unit 4 项 PASS
  - recall / permission failure 在 IntegrationGateway 入口 PASS
  - Audit / Masking 对 access token / app secret / webhook body 三类 runtime 拒绝
  - 不修改冻结 Catalog / 模块所有权 / Contract 语义
  - `pnpm clean` 后 `pnpm verify` 通过
- 明确不属于本 Issue：真实飞书 / Runtime / Renderer / 数据库运行
- PR 验证报告称 Unit 子集 PASS，E-001/E-002/M-001 及真实外部仍 `NOT RUN`

## 技术决策
| 决策 | 理由 |
|------|------|
| 审查走 reviewer persona + subagent | 遵循 review skill |
| 只修 bug 级正确性问题 | 不因 nit 阻塞合并；用户要求修错误 |
| 合并时显式 Closes #17 | PR 当前不会自动关 Issue |

## 审查发现（PR #26 reviewer）

| 级别 | 问题 | 处理 |
|------|------|------|
| bug | timeout 后丢掉 `call`，迟到 rejection 可成为 unhandled rejection | 已修复：abort + observe late settlement，状态保持 UNKNOWN |
| bug | Origin 未含 adapter/account，跨租户可互相撤回 | 已修复：Origin key = adapter + account + message |
| suggestion | dispatch 先于 identity claim | 已修复：先 Claim 再 dispatch |
| suggestion | recall 缺 `recalledMessageRef` 被 ACCEPTED | 已修复：Quarantine |
| suggestion | C-002 未测 renderer mismatch | 已补回归 |
| suggestion | 类 JSDoc 写设计历史 | 已缩短 |
| suggestion | 剩余 Handler/Adapter/DB 仍挂 #17 | 已开 #27 并改文档追踪 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| PR 未关联自动关闭 Issue | 合并时把 PR body 改为 `Closes #17`，并在合并后确认 Issue 关闭 |
| 关闭 #17 会让真实 Adapter/DB 失去 Owner | 创建 Issue #27 承接剩余 Handler/Adapter/Persistence/E2E |

## 资源
- PR: https://github.com/qzhike/zhiju-business-core/pull/26
- Issue: https://github.com/qzhike/zhiju-business-core/issues/17
- Diff: `/var/folders/n0/_dxq_y8s67l71czvnn98c7l40000gn/T/grok-galendai/grok-review-diff-a366d209.diff`（80264 bytes）
