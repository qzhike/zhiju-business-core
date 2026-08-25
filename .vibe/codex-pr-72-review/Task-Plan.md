# PR #72 代码审查与交付计划

## 目标

审查 `qzhike/zhiju-business-core` PR #72 的当前精确 head，依据项目高层规范、EnterpriseProject 模块规范、模块测试契约和实际差异识别可复现的合并阻断问题；在确认问题后进行最小修正，补齐回归测试和权威文档，发布到原始 PR 的 GitHub comments，并在精确 head 的检查通过后合并 PR、关闭其原始 Issue。

## 当前边界与假设

- 当前工作树对应 PR #72 的分支；正式审查前必须重新读取 GitHub 的 `headRefOid`、base、mergeability、检查状态和 closing association。
- 代码、测试和项目文档的修改必须保持在本 Work Item 的范围内；不改动无关工作树变更。
- 只将自动化可复现结果标记为 `PASS`；生产 Handler、真实外部服务、人工验收和未执行的运行时边界保持 `NOT RUN`。
- 本次用户请求明确授权评论、修正、提交、推送、合并和关闭原始 PR/Issue；每个动作仍以最新精确 head 和远端回读为前置条件。

## 执行步骤与验收证据

1. 读取 PR 元数据、实际 diff、HL-Spec、相关 Module Spec/Module Test、IM-03 WI-03 设计与验证文档。
   - 验证：记录 PR head/base、关联 Issue、变更文件和关键契约。
2. 在不改代码的基线阶段运行现有验证，并针对每个关键不变量构造最小反例。
   - 验证：区分基线自动化结果与独立语义发现。
3. 先更新对应 Spec/Module-Test/验证文档和本审查记录，再实施最小代码与回归测试修正。
   - 验证：每个修正有失败前置、成功后置和明确输入/预期/实际输出。
4. 运行聚焦测试、完整 `pnpm verify`、差异检查，并核对未运行边界。
   - 验证：保留命令、版本、结果和任何环境限制。
5. 在用户可检查的修正结果稳定后，按授权提交、非强制推送并发布 PR comment。
   - 验证：comment 返回 ID/URL，内容绑定修正后的精确 head，并记录修正与验证结论。
6. 等待精确 head 的远端检查，重新核对 PR 状态和 closing association，使用精确 head 合并。
   - 验证：`origin/main` 包含合并后的修正提交，PR 为 `MERGED`，原始 Issue 为 `CLOSED/COMPLETED`，工作树干净。

## 状态

- [x] 精确 head、base、Issue 和远端检查已核对
- [x] 权威规范、模块测试和实际 diff 已读取
- [x] 语义反例与基线验证已完成
- [x] 修正、回归测试和文档已完成
- [x] 本地验证和差异检查已完成
- [ ] PR comment 已发布并回读
- [ ] PR 合并、Issue 关闭和主线 ancestry 已回读

当前工作区已完成代码与文档修正，并通过本地验证；提交、推送、PR comment、合并、Issue 关闭及主线回读均等待用户检查后授权。
