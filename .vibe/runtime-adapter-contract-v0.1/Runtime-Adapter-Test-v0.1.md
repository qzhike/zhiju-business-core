# Runtime Adapter Contract v0.1 测试规格

版本：v0.1
日期：2026-08-17
状态：`BASELINE TEST SPEC / DESIGN VERIFIED / USER PROGRESSION CONFIRMED / IMPLEMENTATION NOT STARTED`

对应规格：[`Runtime-Adapter-Contract-v0.1.md`](Runtime-Adapter-Contract-v0.1.md)。对应模块：[`Module-Spec-003-TaskExecution.md`](../module-specs/Module-Spec-003-TaskExecution.md) 与 [`Module-Spec-007-IntegrationGateway.md`](../module-specs/Module-Spec-007-IntegrationGateway.md)。

`DESIGN VERIFIED` 只表示文档静态一致；Unit/Contract/E2E/Manual 在没有实现和真实 Provider 时保持 `NOT RUN`。

## 1. Design Gate

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-D-001 | HL/02/03/04/05/06/07/08、API、Module Spec/Test、Runtime 专项文档 | 路由完整；没有第八模块或第二套 Run/Completion | `high_level=9 api=3 module_specs=7 module_tests=7 feishu=4 runtime=4`；Markdown 结构问题 0 | `DESIGN VERIFIED` |
| RA-D-002 | Runtime Contract Core API mapping 与 200 项 Catalog | 已批准引用全部存在；未覆盖项只出现在 proposal | `baseline_refs=16 missing=0 proposals=6`；Catalog/Specs 均 200 unique、集合差 0 | `DESIGN VERIFIED` |
| RA-D-003 | 三个 Installed CLI Profile | 每项只有 CLI 官方来源；能力事实与本地验证状态分开 | `cli_profiles=3 official_urls=3`；全部标记 local `NOT RUN` | `DESIGN VERIFIED` |
| RA-D-004 | 安全、Lease/Fencing、Result、Usage、Resume/Retry 章节 | 关键负向锚点齐全、无 Human-only 越权 | `security_anchors=10 security_issues=0`；错误码与禁止边界可定位 | `DESIGN VERIFIED` |

## 2. Unit

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-U-001 | 相同 dispatch stable key + 相同 invocationHash 三次 | 返回同一 Attempt，不重复启动 Provider | 无实现 | `NOT RUN` |
| RA-U-002 | 相同 stable key + 不同 invocationHash | 冲突并 Quarantine，不启动第二次 | 无实现 | `NOT RUN` |
| RA-U-003 | 旧 fencingToken 提交 final Result | `LATE_RESULT_QUARANTINED`，不改变 Run | 无实现 | `NOT RUN` |
| RA-U-004 | Usage 缺少 reasoning/cost | 对应字段 UNKNOWN，不填 0 | 无实现 | `NOT RUN` |
| RA-U-005 | Runtime PROGRESS 含隐藏推理/Secret | 丢弃敏感内容并记录安全违规 | 无实现 | `NOT RUN` |
| RA-U-006 | final BLOCKED_INPUT 请求 Resume 原 Run | 拒绝，必须创建新 Run Retry | 无实现 | `NOT RUN` |
| RA-U-007 | Provider cancel 请求 timeout | Attempt/Run 保持 UNKNOWN/CANCELLING，不标 CANCELLED | 无实现 | `NOT RUN` |
| RA-U-008 | WorkspaceOutput 路径与 Artifact 同名 | 不满足 ExpectedOutput，不创建 Revision | 无实现 | `NOT RUN` |

## 3. Contract

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-C-001 | Execution Package 缺 workOrder/context/capability Hash Ref | Schema/Reference Validation 拒绝 | 无 Schema | `NOT RUN` |
| RA-C-002 | Dispatch Invocation 试图覆盖 executable path、把 Prompt 塞入 argv、注入 shell command 或额外 argv | Payload Guard 拒绝且不启动进程 | 无 Schema/Process Driver | `NOT RUN` |
| RA-C-003 | 未知 Runtime Event Major | Quarantine，不猜测转换 | 无 Mapper | `NOT RUN` |
| RA-C-004 | Provider event ID 相同、payloadHash 不同 | Replay conflict，首个事实不改写 | 无 Mapper | `NOT RUN` |
| RA-C-005 | AgentResult 只有自然语言 final message | Schema invalid；Run 不进入 SUCCEEDED | 无 Mapper | `NOT RUN` |
| RA-C-006 | RuntimeBinding 与 RunCreation 不一致 | 拒绝 dispatch/result binding | 无 Validator | `NOT RUN` |
| RA-C-007 | required CLI 缺失、版本不兼容或认证不可用，但 fallback 可用 | 不静默替换；返回明确 policy/availability 结果 | 无 Probe/Router | `NOT RUN` |
| RA-C-008 | Agent capability 包含 approval/release | Package 构建拒绝 `HUMAN_ONLY_CAPABILITY` | 无 Validator | `NOT RUN` |

## 4. E2E

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-E-001 | READY WO→Run→受控 argv 启动已安装 CLI→解析 structured final Result | Attempt/Process/Receipt/Run/Result 链可追溯；Completion 另行计算 | 无 Adapter/Core 实现 | `NOT RUN` |
| RA-E-002 | Provider dispatch timeout 后查询发现已启动 | 复用同 Attempt 补记 Receipt，不重复启动 Run | 无 Adapter | `NOT RUN` |
| RA-E-003 | RuntimeInputRequired→Feishu Answer→same Run Resume | 仅在 continuation/context/token 均有效时恢复；历史不改写 | 无 Runtime/飞书 | `NOT RUN` |
| RA-E-004 | final BLOCKED_INPUT→Human Answer | 新 ContextSnapshot、新 Run；旧 Run terminal | 无 Runtime/飞书 | `NOT RUN` |
| RA-E-005 | Codex Run timeout，Policy 允许 Claude Code fallback | 新 Run/Attempt/Token/Binding；旧 Usage/Provenance 保留 | 无两个 Adapter | `NOT RUN` |
| RA-E-006 | Human cancel，Provider未确认且 Lease 到期 | CANCELLING→ABANDONED；late result Quarantine | 无 Adapter/Timeout Service | `NOT RUN` |
| RA-E-007 | Provider structured result 引用跨 Project Revision | AgentResult REJECTED/QUARANTINED，不处理 Proposal | 无 Validator | `NOT RUN` |
| RA-E-008 | Adapter 进程在 Provider 成功后、Receipt 提交前崩溃 | 相同 key reconciliation 补记，不盲目重发 | 无 Persistence/Adapter | `NOT RUN` |

## 5. Manual

| ID | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-M-001 | 已安装 `codex`、`claude`、`openclaw` 的最小 hello/structured result Fixture | Reviewer 可比较探测、argv、stdout/stderr、Result、Usage 与 continuation 差异 | 未连接三个 CLI | `NOT RUN` |
| RA-M-002 | 恶意 workspace 指令请求 approve/release/越权读取 | Runtime 可执行层与 Core 均拒绝，审计不泄密 | 未准备 Fixture | `NOT RUN` |
| RA-M-003 | Cancel/timeout/network partition 演练 | UI/审计准确区分 UNKNOWN、FAILED、CANCELLED、ABANDONED | 未实现 | `NOT RUN` |
| RA-M-004 | WorkOrder→Run→AgentResult→Completion 审核 | Reviewer 能区分四层完成与 Workspace/Business Output | 未准备 Fixture | `NOT RUN` |

## 6. 当前结果

- 32 个用例：4 Design、8 Unit、8 Contract、8 E2E、4 Manual。
- 4 个 Design Gate 已完成静态 `DESIGN VERIFIED`；其余 28 个 Unit/Contract/E2E/Manual 保持 `NOT RUN`。
- 不存在 Runtime Adapter、Process Driver、Schema、Fixture 或真实 CLI 执行；CLI 安装和认证是部署前提，不由本项目实现。

## Workspace MVP D14：项目资料准备与正式启动

状态：`D14 / INITIALIZATION DIRECTION USER APPROVED 2026-10-08 / FIELD CONTRACT CLOSURE PENDING / NOT REGISTERED / NOT IMPLEMENTED`。用户批准的范围、主工作区依据及兼容规则见[正式提案 §4.7.1](../decisions/workspace-mvp-human-agent.md#471-项目资料准备与正式启动的-spec-delta-提案d14)。本节同步新增设计约束，不宣称本分支较早正文的实施状态等于当前 main，也不改变已发布接口。

| ID | 输入 | 预期 | 结果 |
|---|---|---|---|
| RT-D14-001 | 一个已批准真实 CLI 的准备分析 Package | 读客户/模板、受限写报告；实际原 Invocation、来源清单/JSON/Markdown bytes 与 Hash 可核验 | `NOT RUN` |
| RT-D14-002 | 错 Context/profile/Scope、过期 lease/fencing、超限或混合输出 | 拒绝/隔离；无伪造成功或文件修改权限 | `NOT RUN` |
| RT-D14-003 | timeout、原调用回读与新材料新分析 | 稳定键不重复 invoke；旧输入不偷换；四 Runtime 各自 conformance 不混填 | `NOT RUN` |
