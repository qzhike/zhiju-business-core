# 任务计划：审查、修复并合并 PR #26 与 Issue #17

## 目标
完成 https://github.com/qzhike/zhiju-business-core/pull/26 的代码审查，修复发现的错误，合并 PR 并关闭原始 Issue #17。

## 当前阶段
阶段 1

## 各阶段

### 阶段 1：需求与发现
- [x] 理解用户意图：审查 PR、修复错误、合并 PR 及原始 ISSUE
- [x] 确定约束条件和需求
- [x] 将发现记录到 findings.md
- **状态：** complete

### 阶段 2：代码审查
- [x] 收集 PR diff 与元数据
- [x] 运行 reviewer subagent
- [x] 汇总审查发现
- **状态：** complete

### 阶段 3：修复错误
- [x] 按审查结果修复 bug 级问题
- [x] 同步 Spec / 测试文档
- [x] 本地验证（测试与 verify）
- **状态：** complete

### 阶段 4：合并与关闭
- [ ] 确保 CI 通过、可合并
- [ ] 合并 PR（关闭 Issue #17）
- [ ] 确认 Issue #17 已关闭
- **状态：** in_progress

### 阶段 5：交付
- [ ] 向用户报告审查结论、修复内容、合并结果
- **状态：** pending

## 关键问题
1. PR body 使用 `Refs #17` 而非 `Fixes #17` / `Closes #17`，`closingIssuesReferences` 为空，合并时需显式关闭 Issue。
2. Issue #17 验收包含 E-001 / E-002 / M-001 等外部项；PR 明确声明这些仍为 `NOT RUN`。是否仍应关闭 Issue？用户明确要求合并 PR 及原始 ISSUE，按用户指令关闭，并在合并说明中写明剩余 `NOT RUN` 边界。

## 已做决策
| 决策 | 理由 |
|------|------|
| 先审查再修复再合并 | 用户要求审查并修复错误，不能在未审查时直接合并 |
| 合并时用 `Fixes #17` 关闭 Issue | GitHub 不会因 `Refs #17` 自动关闭 Issue |
| 规划文件放在 `.vibe/pr-26-review/` | 遵循项目 Agent 文档规范，避免污染源码根目录 |

## 遇到的错误
| 错误 | 尝试次数 | 解决方案 |
|------|---------|---------|
|      | 1       |         |

## 备注
- CI `verify` 已 SUCCESS（49s），mergeable=MERGEABLE
- 无现有 reviews / comments
- 工作区即 PR 分支 `galendai/17-im-01-integrationgateway-runtime-acceptance-gaps`
