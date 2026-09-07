> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-17-integrationgateway-runtime-acceptance-gaps/Task-Plan.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-17-integrationgateway-runtime-acceptance-gaps/Task-Plan.md).

# Issue #17 IntegrationGateway 运行时验收切片计划

日期：2026-08-21–2026-08-22
状态：`RUNTIME SLICE IMPLEMENTED / LOCAL GATES PASS / REAL PROVIDER AND DATABASE TRACKED BY #27`

## 1. 目标

在不改变 IntegrationGateway 公开 Catalog、模块所有权和已有 Contract 语义的前提下，把 Issue #17 中可在本地纯运行时层验证的安全与一致性边界推进为 `PASS`：

1. 同一外部事件 ID 与相同 Payload Hash 重放时只保留一个 InboundEnvelope 处理结果；
2. 同一外部事件 ID 与不同 Hash 时保留首个事实并进入 Quarantine；
3. Runtime/Channel 外部调用超时后 Attempt 保持 `UNKNOWN`，不得虚报成功或失败；
4. 未知 Provider Major 或 required extension 拒绝映射并进入 Quarantine；
5. Render 结果的 input Hash、Revision、Renderer 与 Request 不一致时拒绝登记；
6. 撤回只改变 Origin 状态并保留原 Envelope；Channel Binding 不替代显式授权；
7. Audit 入口拒绝 access token、app secret 和原始 webhook body，不把敏感值写入诊断记录。

## 2. 权威输入

- `.vibe/high-level-docs/HL-Spec.md`
- `.vibe/module-specs/Module-Spec-007-IntegrationGateway.md`
- `.vibe/module-tests/Module-Test-007-IntegrationGateway.md`
- `.vibe/feishu-channel-contract-v0.1/Feishu-Channel-Contract-v0.1.md`
- `.vibe/runtime-adapter-contract-v0.1/Runtime-Adapter-Contract-v0.1.md`
- GitHub Issue #17：IntegrationGateway runtime / acceptance gaps remaining after PR #16 schema slice

## 3. 实现纪律

- 运行时切片只位于 `modules/integration-gateway`，只依赖 `@zhiju/contracts` 和 `@zhiju/shared-kernel`。
- 使用内存 Ledger 与可注入 Port 验证纯状态机、幂等、Quarantine、授权和安全拒绝；这不冒充 PostgreSQL、真实 Adapter 或外部 E2E。
- 不新增 Command/Query/Event，不修改生成类型、冻结 baseline、Catalog 或其他模块所有权。
- 先更新 HL-Spec、Module-Spec、Module-Test 和本计划，再实现；实现后同步实际测试结果和 `NOT RUN` 边界。
- 不创建临时测试脚本；测试完成后检查不存在测试遗留文件。

## 4. 里程碑与手动检查产出

| 里程碑 | 产出 | 手动检查 |
|---|---|---|
| M0 文档基线 | 权威 Spec/Test 与本计划同步 | 检查实现范围未扩大 Catalog/Owner/Contract |
| M1 入站事实保护 | 幂等 Ledger、Hash 冲突 Quarantine、协议版本拒绝 | 重放三次并检查 command dispatch 次数、首个 Envelope 和 Quarantine |
| M2 外部尝试保护 | 超时 `UNKNOWN`、稳定键重放、Render 绑定校验 | 检查 timeout 不出现 `SUCCEEDED/FAILED`，错配不登记结果 |
| M3 来源与安全边界 | 撤回 Origin、显式授权 Port、Audit 敏感输入拒绝 | 检查原 Envelope 保留、Binding 不提权、三类敏感字段均拒绝 |
| M4 关闭前验证 | Module Test 结果、全量验证报告、工作区审计 | 检查 `pnpm clean && pnpm verify`、Catalog=200、外部项仍 `NOT RUN` |

## 5. 不在本切片内

真实飞书 Webhook/事件订阅、Runtime CLI Process Driver、Renderer/Object Storage Provider、OpenBao、PostgreSQL Migration/Repository、HTTP Handler、跨进程持久化、真实 E2E 和人工验收均不在本切片内；相应专项用例必须继续标记 `NOT RUN`。
