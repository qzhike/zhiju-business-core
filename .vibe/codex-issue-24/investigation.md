# Issue #24 执行记录

## 目标

执行并交付 GitHub Issue #24，形成可审阅的代码、规范、测试与验证证据，并在用户确认后提交 commit、推送分支和创建 PR。

## 约束

- 以 Issue #24 最新正文和评论、当前分支 exact head、HL-Spec、相关 Module-Spec 与 Module-Test 为权威输入。
- 代码注释、commit message 和外部文档使用英文；项目设计/开发/测试文档使用中文。
- 仅修改与 Issue #24 直接相关的内容，保留既有无关改动。
- 代码或文档变更后先提供差异和验证结果供用户检查；收到“确认提交”后再创建 commit。

## 过程记录

| 阶段 | 状态 | 证据 |
|---|---|---|
| Issue、工作树与权威文档核对 | 已完成 | `origin/main@c4ef6817427c5c7f4fa73b3a57efc4f8ec778d9d`；Issue #24 为 OPEN；最新评论 `issuecomment-5475987654` 给出未登记 Adapter Attempt ID 仍可铸造 Formal Receipt 的反例 |
| 回归测试与实现 | 已完成 | IntegrationGateway formal Adapter Attempt Query Port、ReleasePublication fail-closed provenance 校验、Runtime/Validator/Handler 回归已完成；未增加公共 Contract Catalog operation |
| 分层验证与 exact-head 审阅 | 本地技术验证通过，等待用户检查 | focused `3 files / 49 tests`；`pnpm clean && pnpm verify` 全部通过；当前工作树仍未提交 |
| commit、push、PR 与远端回读 | 等待用户确认 | 待补充 |

## 测试结果边界

本轮已完成本地/静态/受控 Runtime/Handler/disposable PostgreSQL 验证；真实 Provider、生产、公共 HTTP/E2E 和独立人工验收仍明确为 `NOT RUN`。

## 本轮实现与验证结果

- IntegrationGateway `IntegrationGatewayRuntime` 仅为正式 `integration.adapter_attempt` 保存并公开已登记的 `externalDeliveryRequestRef`；缺少正式 External Delivery Request 的正式 Attempt 在副作用前拒绝，通用 Runtime/Renderer Attempt 保持原有入口语义。
- ReleasePublication 通过结构化 `FormalAdapterAttemptQueryPort` 查询 exact `objectType/objectId/scope`，并要求已登记、`SUCCEEDED` 的 Adapter Attempt 返回与 Raw Receipt 和 Publication Attempt 完全相同的 External Delivery Request；Query 缺失、异常、未登记、错误类型/Scope、非成功状态或绑定不一致均返回稳定 `RELEASE_RECEIPT_TARGET_MISMATCH`。
- 直接伪造 Adapter Attempt ID 的反例已覆盖：Raw Receipt 其余字段保持自洽时，Receipt Validator 不铸造 Formal Receipt；Controlled Runtime 不改变 Release 状态、不追加 Receipt 或 `PublicationSucceeded`；PostgreSQL Handler 回归验证业务行和成功事件计数不变。
- `pnpm exec vitest run modules/release-publication/src/receipt-validator.test.ts modules/release-publication/src/release-publication-runtime.e2e.test.ts modules/integration-gateway/src/integration-gateway-runtime.test.ts --no-file-parallelism --reporter=dot`：`3 files passed / 49 tests passed`。
- `pnpm clean && pnpm verify`：Format、Lint、Typecheck、全量 Vitest `42 files passed / 30 skipped`（`450 passed / 300 skipped`）、Architecture、Public API/Types/Catalog（`201/201 FULL`）和 compatibility 均通过；disposable PostgreSQL/Flyway Gate 为 PostgreSQL `18.6` (`server_version=180006`)、Flyway `11.20.3`、`34 files / 315 tests passed`，空库迁移、V6003/V6004 历史升级、二次 `Schema "public" is up to date. No migration necessary.` 和容器清理均通过。
- 测试过程未创建临时脚本或测试文件；gate 使用的 PostgreSQL 容器已移除。上述结果只覆盖本地、合成和 disposable PostgreSQL 技术边界，不代表真实 Feishu/Provider、生产、公开 HTTP、统一跨模块业务 E2E 或独立人工验收已执行。

## 修复前缺口与修复设计

修复前的 `receipt-validator.ts` 从 `RawExternalReceiptFact` 读取 `adapterAttemptRef`，只检查其 `objectType` 和 Scope，没有通过 IntegrationGateway 权威 Query 解析该 `objectId`，也没有验证已登记 Adapter Attempt 的状态或其 `externalDeliveryRequestRef`。因此调用方可以构造一个形式正确但未登记的 Adapter Attempt 引用；该反例已由本轮 exact Query 回归拒绝。

本次修复的最小边界如下：

1. IntegrationGateway 的受控 Runtime 保存 Adapter Attempt 的 `externalDeliveryRequestRef`，并提供只读 `getFormalAdapterAttempt` Query/Port；该 Query 只返回已登记、`integration.adapter_attempt` 类型且带正式 External Delivery Request 绑定的事实。
2. ReleasePublication 新增窄化的 Adapter Attempt Authority Query Port。Formal Receipt Validator 必须解析 Raw Receipt 的 Adapter Attempt，逐项比较 object type、object ID、完整 Scope、`SUCCEEDED` 状态以及 Adapter Attempt 与 Publication Attempt 的 exact External Delivery Request；Query 缺失或任何比较失败都返回 `RELEASE_RECEIPT_TARGET_MISMATCH`。
3. Controlled Runtime、Receipt Validator Unit、IntegrationGateway Runtime 和 PostgreSQL Handler 回归分别覆盖有效正式链路、伪造/缺失/普通发送 Adapter Attempt、错误 Scope、错误 External Delivery Request，以及拒绝后的零 Formal Receipt/成功 Event/Release 状态副作用。
4. 同步 HL-Spec、Module-Spec-006/007、Module-Test-006/007 的当前状态与验证边界；不新增公共 Contract Catalog 操作，不宣称真实 Provider、生产、公共 HTTP、统一跨模块业务 E2E 或独立人工验收已运行。

## 基线验证

- 读取 Issue、Spec、当前代码和 PR #141/#144 远端状态：完成。
- 冷工作树第一次执行上述 focused 命令时因缺少 workspace build entry 失败，Vitest 报 `Failed to resolve entry for package "@zhiju/shared-kernel"`；随后先执行 `pnpm typecheck` 重建 project references，基线 focused 测试通过，最终实现后的 focused 结果见上文。
