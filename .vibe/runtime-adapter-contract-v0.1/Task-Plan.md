# Runtime Adapter Contract v0.1 工作计划

状态：`DESIGN VERIFIED / USER PROGRESSION CONFIRMED / IMPLEMENTATION NOT STARTED`
日期：2026-08-17
执行者：Codex（主 Agent）

## 1. 前提与范围

- 高层基准、API Contract v0.1 与 Feishu Channel Contract v0.1 已形成提交基线；用户于 2026-08-16 指示继续下一阶段，满足进入 Runtime Adapter Contract 的阶段 Gate。
- 本阶段只冻结 Harness-neutral Runtime Adapter 协议、Installed CLI Capability Profile、测试规格和静态验证证据。
- 本阶段不创建 Adapter 代码、Runtime Credential、模型调用、数据库、Workspace、部署配置或真实 Run。
- TaskExecution 仍是 WorkOrder、Run、AgentResult、InformationRequest 与 Usage 的业务 Owner；IntegrationGateway 仍只拥有外部 Attempt、Raw Receipt、Quarantine 和 Adapter Health。
- 现有 200 个公开 Command/Query/Event 名称保持基准不变；本阶段发现的缺口只作为明确的 additive API proposal 进入用户审核。
- 用户已确认三种客户端均由目标用户或服务器预先安装；v0.1 直接调用 `codex`、`claude`、`openclaw` CLI，不引入 SDK、App Server、Provider API 直连、安装器或凭据管理。

## 2. 权威输入

必读：

1. `HL-Spec.md`；
2. `02-zhiju-core-architecture.md` 第 8、14、20 节；
3. `03-core-contracts.md` 的 WorkOrder/AgentResult；
4. `04-domain-model-v0.1.md` Part D；
5. `05-cross-aggregate-consistency-module-boundary-v0.1.md` 的 Lease、幂等和 Runtime 失败语义；
6. `06-typed-references-contract-catalog-v0.1.md`；
7. `07-postgresql-logical-model-v0.1.md` 的 Run/Attempt/Fencing 边界；
8. `08-verification-baseline.md`；
9. API v0.1、TaskExecution 与 IntegrationGateway Module Spec/Test。

Provider 事实只采用各 CLI 官方文档；CLI 参数、输出字段和 session 标识不是 Zhiju Core Contract 的权威定义。

## 3. 交付物

1. `Runtime-Adapter-Contract-v0.1.md`：Execution Package、Adapter Port、CLI Process Driver、标准化事件、Run 生命周期、Result/Usage/Provenance、Resume/Retry/Cancel、安全和 CLI Profile；
2. `Runtime-Adapter-Test-v0.1.md`：32 个 Design/Unit/Contract/E2E/Manual 场景；
3. `Verification-Report.md`：来源、映射、API 缺口、静态 Gate、未执行项和剩余风险；
4. 同步 `HL-Spec`、`08-verification-baseline`、TaskExecution/IntegrationGateway Module Spec/Test；
5. 提出但不静默批准 6 个 additive TaskExecution Command。

## 4. 执行步骤与验证

1. 核对提交基线、阶段入口和工作树。
2. 冻结 Provider-neutral Execution Package 与 Adapter Port。
3. 冻结 Dispatch、Event Ingestion、Cancel、Suspend/Resume、Result、Usage 和 Quarantine 语义。
4. 用官方资料建立 Codex CLI、Claude Code CLI、OpenClaw CLI 的 capability evidence profile。
5. 将全部业务写入映射到现有 Core API；对无法映射的能力形成显式 additive proposal。
6. 定义 32 个专项测试并执行静态 Gate。
7. 交由用户审核 CLI 调用边界、API proposal 和默认 Policy 参数。

## 5. 阶段里程碑

| 里程碑 | 产出物 | 人工审核重点 | 状态 |
|---|---|---|---|
| RA-M1 中立边界 | Execution Package、Port、责任矩阵 | Runtime 对象不冒充业务对象 | `DESIGN VERIFIED` |
| RA-M2 生命周期 | Dispatch/Event/Cancel/Resume/Result | Lease、Fencing、UNKNOWN、late result | `DESIGN VERIFIED` |
| RA-M3 CLI Profile | 三个已安装 CLI 的官方能力证据 | 命令模板、版本与认证探测边界 | `DESIGN VERIFIED` |
| RA-M4 API 映射 | 现有 API 与 6 个 additive proposal | 是否接受 Catalog 扩展 | `DESIGN VERIFIED` |
| RA-M5 测试与报告 | 32 个场景、静态验证报告 | 证据口径和剩余风险 | `USER PROGRESSION CONFIRMED` |

## 6. 阶段退出记录

- 用户于 2026-08-17 要求提交当前文档并继续 Implementation Milestone Plan；Runtime CLI-first 基线已提交为 `c3e379c`。
- 该推进确认不等于批准 6 个 additive proposal 或第 20 节其他默认 Policy；它们继续保持显式待决。
- 未实现真实 Runtime Adapter 或 CLI Process Driver；官方文档能力仍不是本地/生产验证 `PASS`。
