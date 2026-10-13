# PR #292 独立实现审查

- 日期：2026-10-13。
- PR：[#292](https://github.com/qzhike/zhiju-business-core/pull/292)，Draft；Issue：[#282](https://github.com/qzhike/zhiju-business-core/issues/282)。
- Reviewed SHA：`edcd282a85d38f9db48b8ee66014931b818b57a2`。
- Reviewer outcome：`APPROVE`，适用于当前 T1 页面工程与 Draft 交付范围。
- 阻塞发现：无。本记录不属于上述 reviewed SHA，不代表 Ready、合并或真实业务验收通过。

## 范围与独立判断

独立读取最新 Issue/评论、PR/head/diff、UI01 Spec/Test、已批准交互与工程基线、项目验证规则，先按验收确定身份、回执、项目隔离、不可变输入和真实状态边界，再检查实现及测试。未将 Implementer 的总结作为通过依据。

本次差异限于 UI01 页面、隔离开发适配器、已有可信会话下的授权目录读取、页面路由、聚焦测试/构建检查及相关文档。没有新增业务端点、公共 wire Contract、Core 所有权、持久化或权限政策。

| 验收边界 | 审查结果 |
|---|---|
| 已有客户独立 ID 与明确 NEW | 输入同名不会选中客户；键盘选择绑定 ID；NEW 显式切换；pending/错误保留输入。 |
| 匹配创建回执与精确项目 | 校验原意图、标题与客户身份后才导航；创建本身不提交资料、不启动分析；跨项目入口初始无选择。 |
| ZIP 与输入保留 | 单文件选择，非法后缀保留旧选择；按项目重新挂载并丢弃卸载后的 picker 回调；提交与重试有同步意图锁。 |
| 状态与恢复 | adapter 提供各阶段，UNKNOWN 不重发；无后台自动导航；准备失败可替换，分析失败仅在明确许可时重试；原输入与失败历史可检查。 |
| 开发/生产隔离 | 同一页面组件复用；生产没有创建/上传动作，明确不可用；只有显式固定 ZIP 与对应固定项目能产生固定报告，任意 ZIP 和新建演示项目不借用报告。 |
| 文档与范围 | UI01 Spec/Test 与 README 说明已交付页面及未接入能力；未将 #277 的后续真实服务合同提前实现。 |

## 验证证据

复用 [CI run 38370413734](https://github.com/qzhike/zhiju-business-core/actions/runs/38370413734)，已独立读回 `headSha` 等于 reviewed SHA，整体 `success`；`select`、`checks`（含 `Verify code`）、`verify` 均成功，`persistence` 按 Draft 非持久化范围预期 `skipped`。未重复运行同一配置门禁。

Reviewer 另使用锁定 pnpm 11.19.0，将该提交构建到临时目录，并在宿主受控 Chromium `156.0.8078.4` 上执行以下聚焦检查：

- 明确 NEW 成功，双击创建后进入返回的新项目，未产生分析回执。
- 新项目带入固定 ZIP 后双击提交，仅停在等待安排，不借用固定项目报告。
- SPA 离页再返回，原说明仍显示且不可编辑。
- 固定项目分析失败后双击允许的重试，历史恰有原失败与一次重试两条记录；失败可检查，报告只能显式打开。
- 查看 1440×900 客户选择页及 360×800 重试成功/失败历史截图，未见内容遮挡或水平溢出。

上述聚焦检查均 PASS；是匿名页面/适配器证据，不是实际上传、Runner 或生产服务证据。沙箱预览监听 `127.0.0.1:4292` 返回 `EPERM`，通过宿主临时预览完成检查，没有修改产品实现或放宽验证规则。

## 剩余门禁

当前为 Draft，要求的 `code` 已通过；转为 Ready 前仍需当前修订的 `full`，本轮未执行。真实创建/ZIP 接收、Runner、持久化验收、Windows/macOS Chrome/Edge 最近两版矩阵、跨设备恢复与独立人工验收均为 `NOT RUN`。这些是 #282 明确区分的后续层，不作为当前页面工程的额外阻塞项。

Reviewer 仅新增此正式审查记录；未修复业务代码，未 commit、push、merge 或部署。按用户要求另行发布 PR comment，评论发布事实以 GitHub 读回为准。
