APPROVE — 当前 Draft 阶段的 T1 页面实现满足 Issue #287 的范围与接受条件，未发现阻塞问题；本结论不将仍在进行的 `full` / Ready / Delivery 门禁记为通过。

# PR #298 独立实现审查

## 审查对象与边界

- 工作项：[Issue #287](https://github.com/qzhike/zhiju-business-core/issues/287)。
- 提议修订：[PR #298](https://github.com/qzhike/zhiju-business-core/pull/298)，审查 SHA `6da87a7f718add4213dadc3d63f15187a4ce97c9`。
- 对比基线：`08b3fe57fc6cef5176295cfecc2222c6a6ad4183`。
- 角色：独立 Reviewer；不修改产品实现，不提交、推送或合并。
- 审查结论：`APPROVE`，绑定上述精确 SHA 与当前 Draft 阶段要求的 `code` 证据。`full` 仍待完成，PR 进入 Ready / Delivery 前必须另行满足。

本次先从 Issue 的 Goal / Acceptance / Scope / Verify、已批准的 [D12 交付设计](../../decisions/project-delivery-controlled-export.md)、[UI01 规格](../../module-specs/Module-Spec-UI01-WorkspaceUI.md)及[工程基线](../../decisions/workspace-ui-engineering-baseline.md)重建行为预期，再检查实际 diff、页面、局部模型、隔离 adapter 与测试。远端 head/base 与 `vibe repo --json` 所示本地 SHA 一致。

## 验收与实现检查

| 边界 | 独立检查结果 |
|---|---|
| 跨轮次清单与资格 | 共用页面按体系章节组织文件，默认无选择，提供搜索/资格筛选；行内显示 Revision、轮次、报告版本及等待原因，内部批准不等于可交付。 |
| 精确选择与单次核对 | 内存选择保留 exact Revision、资格观察 key、项目/计划/接收范围及来源；缺失、重复、替换、失权或 PARTIAL/STALE 均阻断。弹窗保留打开时的版本，其他有效选择保留；配套要求由 adapter 提供，页面不计算发布策略或传递闭包。 |
| 原意图与状态真实性 | 显式确认锁定唯一 intent；pending、CONFIRMED、GENERATING、UNKNOWN、REJECTED、FAILED 与 PACKAGE_READY 分开呈现。回读使用同一 intent，校验 intent/check/精确成员；错回执不晋升成功，迟到回执受 generation 与卸载保护。 |
| 固定包与下载观察 | 包详情使用真实路由查询参数，保留成员、版本与来源。后续候选不替换原包。下载展示可用、过期、不可用、失败及请求/响应观察，不推导本地保存、发送、收件、验收或项目完成。开发 ZIP 明确标为合成。 |
| 上下文、键盘与响应式 | 数据更新保留搜索、选择和弹窗；过期入口卸载敏感页面，恢复后从空选择开始。Radix Dialog 承担焦点圈定/Escape/回焦；桌面为有界清单/详情，窄屏支持查看和包详情，确认提示不替代服务端授权。 |
| 生产隔离与范围 | TrustedApp 接入同一共享页面的 UNAVAILABLE 边界；fixture lazy imports 置于编译常量分支。未新增业务 API、策略、权限、持久化、D12 handler 或真实下载 transport，未修改 #279 单文件下载。 |
| 持久知识 | UI01 Spec/Test 追加页面工程边界及接受集，保留真实 D12 / Runtime / 平台矩阵 / 人工接受的 NOT RUN。未改变已批准产品布局、模块所有权或 Core 契约。 |

已读取全部提议变更，包括 `src/delivery/Page.tsx`、`model.ts`、样例 adapter、CSS、App/TrustedApp 接入、focused unit/browser 用例及 UI01/README 增量。未发现需要修复的阻塞 correctness、contract、scope、安全或可靠性问题。

## 验证证据与门禁边界

- 原会话转交了本地实际工具执行结果，绑定本次 SHA：`functions.exec` session `88216` / chunk `056032`，exit `0`；最终原始 JSON 为 `{"status":"PASS","target":"code","command":"pnpm clean && pnpm verify:code","exit_code":0}`。普通 Vitest 为 127 files / 2712 tests PASS，built browser 为 6 production checks + 41 fixture journeys PASS；Web/BFF independent builds、production rejection、fixture browser、architecture boundaries（12 source roots）、public API generation 与 catalog/registry（247 operations）均 PASS。这是执行结果转交，不只引用 PR 描述。
- 原会话在 waiter monitor error 后取得的精确远端快照提供独立佐证：[run 38686826350 / attempt 1 的 checks job](https://github.com/qzhike/zhiju-business-core/actions/runs/38686826350/job/116263555238)在 `2026-10-15T05:31:48Z` 完成 Verify code，结果 success；snapshot 的 head 为 `6da87a7f718add4213dadc3d63f15187a4ce97c9`，select 为 success，persistence 仍 in_progress，整体无 conclusion。未将该快照表述为完整 CI PASS。
- 已独立检查模型与 built-browser 断言：缺配套、版本/资格变化、部分/陈旧读取、UNKNOWN 与原意图恢复、错回执、迟到回执、访问失效、固定 ZIP、下载失败/过期、200 项、键盘焦点及 production pruning 均有具体断言。未重复运行已有 configured target。
- 已目视检查本地 `test-results/delivery-1280.png` 与 `test-results/delivery-320.png`：有界章节清单、内部滚动、无横向溢出及窄屏查看/桌面确认提示符合本工作项要求。截图属于受控开发制品证据，不是完整平台或人工业务接受。
- Issue #287 明确允许当前 bounded、无持久化实现的 Draft 阶段使用 `code`，并要求 ready 前 `full`。本次 diff 含 App/TrustedApp 等默认 full 路径，完整远端 full 路由应继续执行；这不抹除 Issue 已明确的 Draft 本地交接要求。当前 `code` 执行证据足以支持本页面实现审查，未发现需要额外 persistence 语义取证才能判断的业务/数据库变更；不把后续 Ready / Delivery 门禁升级为当前审查的额外语义阻塞。
- `full`、全部必需远端检查、Ready / Delivery 仍未通过。原会话收到 waiter job `ad9ddb052c534bff686f232d` / event `5caacfe7-55e0-4195-b3b2-96b3bdf64c60` 的 `monitor_error=GitHub read timed out` 并 ACK；该事件不是 CI 完成或成功。独立 Reviewer 未注册第二个 CI waiter，也未轮询远端 CI。
- 真实 D12 服务、发布授权、受控 archive/下载 transport、Runner、持久化、跨设备恢复、Windows/macOS 最近两个 Chrome/Edge 稳定版本的完整矩阵与独立 Human 验收：**NOT RUN**。这些不是本页面工程范围已完成的事实。

## 后续交接

独立实现审查已完成，交回原会话继续现有 full / Ready / Delivery 门禁。进入 Ready 前须取得同一最终 SHA 的完整 full 与必需远端检查通过证据；本次 APPROVE 不代替该证据。任何后续修改均须重新审查新 head；本记录不授权 merge。
