# IM-RP-003 Provider Result PII 语义收紧修复计划

## 目标

根据 GitHub Issue #23 与 PR #144 最新 review comment，修复 `providerResult` 仅依赖通用字符串正则判断安全性的缺陷，并补齐历史数据升级、真实 Runtime Adapter 边界和数据库 provenance 防线。

## Issue #23 最新反馈摘要

- 当前 root-key allowlist 已移除未知、嵌套和数组中的未知字段，但允许字段的值仍可通过通用 token 正则进入持久化结果。
- 反例 `messageId=AliceCustomer`、`providerStatus=AliceCustomer`、`reasonCode=BobBuyer`、`status=CustomerName` 在当前 exact main 上仍全部保留。
- 必须使用 Adapter 边界的封闭内部结果、闭集枚举或注册映射，并验证 Receipt、公开 Event、ApiError 和日志路径不回显原始敏感值。

PR #144 最新 review 的阻断项：

- V6003 只保护未来写入，没有扫描或修复 V6002 已落库的 `publication_receipt.provider_result` 和不可变 `publication_observation.observation_payload`。
- 当前 Adapter-owned factory 只在测试中使用，并依赖不可跨 JSON round trip 的 `WeakSet` 对象身份；缺少真实 Runtime Adapter/Port 正向路径。
- 原始确定性 SHA-256 标识摘要可被低熵值猜测和关联，数据库还接受任意看似合法的调用方 `*Hash`。
- `redactedPaths` 会回显未知 key；key 本身可能包含姓名或 email。

## 执行步骤与验收

1. 读取 HL-Spec、ReleasePublication Module-Spec/Module-Test、实际实现和当前测试，确定权威边界。
2. 以失败回归覆盖 allowlisted key 携带类姓名/客户标识、未知/嵌套/数组字段及合法 Provider 映射，再做最小实现修复。
3. 同步 `.vibe` 中受影响的规范、测试与验证记录；不改变真实 Provider/生产/独立人工验收的 `NOT RUN` 边界。
4. 运行 focused tests，并运行 `pnpm clean && pnpm verify`；记录实际输出和未运行项，特别验证 `V6002 -> seed -> V6003/V6004` 升级链。
5. 用户已于 2026-09-01 明确授权完成修复、提交、合并与交付清理；精确 head 验证与远端 CI 通过后，不再增加额外提交确认门。

## 当前边界

- 本次只处理 Formal Receipt provider result 的安全语义与其自动化回归，不扩展到真实 Feishu/Provider、生产、公共 HTTP、外部收件人确认或独立人工验收。
- Provider Adapter 的真实注册/提取能力若尚未存在，必须在代码中 fail closed，而不能把通用字符串当作安全 Provider 标识。

## 已确定的实现策略

- `FormalReceiptSubmission.providerResult` 的公开字段类型暂不扩展，避免把开放 JSON Schema 误当成安全边界；安全边界位于 ReleasePublication Runtime/Handler 的入库前归一化。
- 生产代码只维护显式注册的 Adapter Result Mapping。当前仅登记 `feishu.channel` 的受控映射，真实 Feishu Provider 仍为 `NOT RUN`，该登记不等价于外部 Provider 已接入。
- `status`、`providerStatus`、`outcome`、`errorCode`、`reasonCode` 只能通过闭集/注册映射进入内部结果；未映射值被替换，不把原始值放进错误或诊断。
- `messageId`、`deliveryId`、`providerAttemptId`、`providerMessageId`、`providerRequestId`、`requestId`、`traceId` 等原始标识一律省略，不生成可猜测或可关联的摘要；普通 Command 自带的标识及 `*Hash` 一律删除。
- Adapter 输出只保留可跨序列化边界的 `providerCode`、闭集状态/结果/错误/原因和受控 attempt/retry 字段；不依赖 `WeakSet`、对象身份或运行时隐藏信任标记。
- Runtime 的 `PublicationAdapterResult` 必须接收 `ProviderResultAdapterExtraction`，在 `dispatchPublicationAttempt`/reconcile 入口调用登记 mapping；JSON round trip 后仍走同一 mapping，映射失败使用稳定错误和固定路径。
- Adapter 映射失败只返回固定字段路径和稳定错误码，不把额外字段名或 raw value 拼进诊断文本。
- Handler、Runtime Validator、Receipt readback 和公开 Event 共用同一归一化结果；公开 Event 不携带 Provider Result，错误/日志只使用稳定安全信息。本地测试会对 Receipt、Event、ApiError 和捕获日志统一搜索敏感反例。
- PostgreSQL 继续遵守 forward-only migration：V6003 负责未来写入安全形状，新增 V6004 扫描并修复 V6002 已存 Receipt 与 Observation；升级过程只在迁移事务内使用 owner 维护窗口，完成后恢复 append-only 与 provider-result guard。V6004 只重写 `provider_result` 安全投影和 Observation 中的重复投影，保留原始 Receipt/Attempt/Raw Receipt 的历史身份引用；Observation payload 实际变化，因此必须重算其 canonical hash。Persistence Gate 必须先只迁移到 V6002、注入历史 unsafe data、再迁移到最新版本，验证两张表都无原始值、`formalReceiptRef` 未被改写且 Observation hash 重新匹配 canonical payload。
- 直接 owner probe 必须按既有 Persistence Contract 传入 32-byte SHA-256 `bytea`，避免把 ContentHash JSON 外形误当作数据库二进制参数。

## 前一轮验证（复审前基线）

- 直接反例 `messageId=AliceCustomer`、`providerStatus=AliceCustomer`、`reasonCode=BobBuyer`、`status=CustomerName` 现在只产生固定 redacted marker；原始值不进入归一化结果。
- focused 命令曾通过 `4 files / 40 tests`，但 PR #144 review 已指出 Adapter provenance、历史数据和固定诊断路径仍不完整；该结果不能作为本轮复审的完成证据。
- 前一轮 `pnpm clean && pnpm verify` 曾通过普通 Vitest `42 files passed / 30 skipped`、`444 passed / 299 skipped`、Architecture、201 项 Catalog/API、compatibility baseline 200 项和 PostgreSQL/Flyway `34 files / 314 tests`；本轮必须在改动后重新执行，并新增 V6002-with-data upgrade probe。
- 真实 Provider/Feishu、生产、公开 HTTP、统一跨模块业务 E2E、外部收件人和独立人工验收仍为 `NOT RUN`；#24 未登记 Adapter Attempt 直接反例仍保持 `FAIL`。本轮提交与交付只覆盖 Issue #23，不关闭 #24。

## 本轮验证结果（2026-09-01，交付中）

- focused 命令 `pnpm exec vitest run modules/release-publication/src/provider-result.test.ts modules/release-publication/src/receipt-validator.test.ts modules/release-publication/src/release-publication-runtime.e2e.test.ts --no-file-parallelism --reporter=dot` 通过：`3 files passed / 37 tests passed`。
- `pnpm clean && pnpm verify` 通过：Format、Lint、Typecheck、全量 Vitest `42 files passed / 30 skipped`（`445 passed / 300 skipped`）、Architecture、Contract/Catalog `201/201 FULL`、compatibility baseline 200 operations，以及 PostgreSQL/Flyway Persistence Gate。
- Persistence Gate 在 PostgreSQL 18.6/Flyway 11.20.3 上按 `V6002 -> seed historical unsafe data -> V6003/V6004` 顺序执行；34 个 persistence 文件、315 个测试通过。历史 Receipt/Observation provider result 已清理，Observation canonical hash readback 相等，V6003 对未归一化结果和 caller-declared `*Hash` 返回 SQLSTATE `23514`，二次迁移输出 `Schema "public" is up to date. No migration necessary.`，tag→digest、RLS/ACL、append-only、CAS、rollback、跨 Scope 和容器清理均通过。
- 本轮只证明本地实现、受控 Runtime Adapter/Port 和 disposable PostgreSQL 技术边界；真实 Provider/Feishu、生产、公开 HTTP、统一跨模块业务 E2E、外部收件人和独立人工验收仍为 `NOT RUN`；#24 伪造 Adapter Attempt provenance 仍保持 `FAIL`。未创建持久化临时测试脚本/文件，临时数据库容器已删除。
