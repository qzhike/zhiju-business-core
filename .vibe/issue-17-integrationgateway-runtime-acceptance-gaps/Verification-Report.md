# Issue #17 IntegrationGateway 运行时验收验证报告

日期：2026-08-22
状态：`LOCAL RUNTIME SLICE PASS / REAL PROVIDER AND DATABASE NOT RUN`

## 1. 交付范围

本次在 `modules/integration-gateway` 落地一个不依赖真实 Provider、HTTP 或数据库的运行时边界切片：

- InboundEnvelope 按 adapter/account/event identity 与 Payload Hash 幂等；同 identity 不同 Hash 保留首个事实并 Quarantine；
- 外部 Attempt 以稳定键和请求 Hash 绑定；timeout 记录为 `UNKNOWN`，同键重放复用已记录状态；
- 未知 Provider Major/required extension Quarantine；Render 结果 inputHash、Revision、Renderer 与 Request 不匹配时拒绝登记；
- 撤回保留 receive/recall Envelope 并将 Origin 置为 `WITHDRAWN`；Binding scope 解析后仍需显式 Authorization Port；
- Audit 入口拒绝 access token、app secret、raw webhook body，并只保存安全诊断字段。

没有新增公开 Command/Query/Event，没有修改生成 Contract、Catalog、模块所有权或其他模块代码。

## 2. 测试证据

| 用例 | 实际结果 |
|---|---|
| IG-API-U-001 | `PASS`：同一外部事件相同 Hash 三次只执行一次 dispatch，复用首个 Envelope |
| IG-API-U-002 | `PASS`：不同 Hash 生成 Quarantine，首个 Envelope 不被覆盖 |
| IG-API-U-003 | `PASS`：timeout 为 `UNKNOWN`，稳定键重放不再次调用且不变为成功/失败 |
| IG-API-C-001 | `PASS`：未知 Provider Major 和 required extension 均在 mapping 前 Quarantine |
| IG-API-C-002 | `PASS`：Render inputHash、Revision 的 `contentHash`/`immutableVersionId` 或 renderer mismatch 均拒绝，Representation registration 保持 0 |
| IG-API-U-004 | `PASS`：撤回置 `WITHDRAWN`，receive/recall Envelope 均保留，乱序 receive 不恢复 |
| IG-API-U-005 | `PASS`：显式 Authz DENY 拒绝；跨 Project 先返回 scope mismatch，不调用 Authz Port |
| IG-API-U-006 | `PASS`：access token、app secret、raw webhook body 均返回 `INTEGRATION_SENSITIVE_DATA_REJECTED`，原值不进入记录 |

执行文件：`modules/integration-gateway/src/integration-gateway-runtime.test.ts`。该文件含 9 个测试（C-001 为两个参数化场景），全部通过。

## 3. 自动化 Gate

实际执行命令：

```text
pnpm clean && pnpm verify
```

实际结果：

- Prettier：`PASS`；
- ESLint：`PASS`；
- TypeScript project build：`PASS`；
- Vitest：16 个测试文件、317 个测试 `PASS`；
- Architecture：`architecture_boundaries=PASS source_roots=10`；
- Public API generation：`operations=200`；
- TypeScript generated types：`payloads=200 query_results=44 core_contracts=6`；
- Catalog/Registry：`catalog=200 registry=200 schema_status={"FULL":200}`；
- Compatibility：`operations=200 schemas=14 envelopes=200 minor=0 findings=0`；
- `git diff --check`：`PASS`。

## 4. 未运行边界

以下不能由本次内存切片或 Vitest 通过替代，继续保持 `NOT RUN`：

- PostgreSQL Migration/Repository/RLS/CAS、跨进程幂等和真实 Outbox/Inbox；
- Feishu Webhook/URL Verification/真实消息、卡片、文件、撤回和 Provider 权限；
- Runtime CLI Process Driver、真实 Lease/Fencing、Renderer/Object Storage、OpenBao；
- HTTP Handler、真实 Adapter Conformance、跨模块 Application Port、E2E 和 Manual 审查。

因此本报告证明的是 Issue #17 候选验收中的本地 Unit/Contract 子集，不把本地内存结果扩张为真实外部业务完成。

## 5. 关闭前语义复核

复核发现并修正了一个 Render Revision 比较缺口：比较逻辑此前只检查 `objectType`、`objectId` 和 Scope，可能把不同内容寻址版本误判为同一 Revision。当前实现同时比较 `immutableVersionId` 与 `contentHash`，并由 C-002 回归覆盖两种错配；该修复没有改变公开 Contract、Catalog 或模块所有权。
