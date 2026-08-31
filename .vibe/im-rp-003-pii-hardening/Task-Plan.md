# IM-RP-003 Provider Result PII 语义收紧修复计划

## 目标

根据 GitHub Issue #23 最新评论，修复 `providerResult` 仅依赖通用字符串正则判断安全性的缺陷，确保允许持久化的结果来自 Provider Adapter 的封闭、可验证映射，而不是由调用方自声明任意字符串。

## Issue #23 最新反馈摘要

- 当前 root-key allowlist 已移除未知、嵌套和数组中的未知字段，但允许字段的值仍可通过通用 token 正则进入持久化结果。
- 反例 `messageId=AliceCustomer`、`providerStatus=AliceCustomer`、`reasonCode=BobBuyer`、`status=CustomerName` 在当前 exact main 上仍全部保留。
- 必须使用 Adapter 边界的封闭内部结果、闭集枚举或注册映射，并验证 Receipt、公开 Event、ApiError 和日志路径不回显原始敏感值。

## 执行步骤与验收

1. 读取 HL-Spec、ReleasePublication Module-Spec/Module-Test、实际实现和当前测试，确定权威边界。
2. 以失败回归覆盖 allowlisted key 携带类姓名/客户标识、未知/嵌套/数组字段及合法 Provider 映射，再做最小实现修复。
3. 同步 `.vibe` 中受影响的规范、测试与验证记录；不改变真实 Provider/生产/独立人工验收的 `NOT RUN` 边界。
4. 运行 focused tests，并运行 `pnpm clean && pnpm verify`；记录实际输出和未运行项。
5. 由用户检查工作区变更并明确确认后，才提交 commit、push 和创建 PR。

## 当前边界

- 本次只处理 Formal Receipt provider result 的安全语义与其自动化回归，不扩展到真实 Feishu/Provider、生产、公共 HTTP、外部收件人确认或独立人工验收。
- Provider Adapter 的真实注册/提取能力若尚未存在，必须在代码中 fail closed，而不能把通用字符串当作安全 Provider 标识。

## 已确定的实现策略

- `FormalReceiptSubmission.providerResult` 的公开字段类型暂不扩展，避免把开放 JSON Schema 误当成安全边界；安全边界位于 ReleasePublication Runtime/Handler 的入库前归一化。
- 生产代码只维护显式注册的 Adapter Result Mapping。当前仅登记 `feishu.channel` 的受控映射，真实 Feishu Provider 仍为 `NOT RUN`，该登记不等价于外部 Provider 已接入。
- `status`、`providerStatus`、`outcome`、`errorCode`、`reasonCode` 只能通过闭集/注册映射进入内部结果；未映射值被替换，不把原始值放进错误或诊断。
- `messageId`、`deliveryId`、`providerAttemptId`、`providerMessageId`、`providerRequestId`、`requestId`、`traceId` 等原始标识不再直接持久化。只有 Adapter 提取器产生的标识才可转为带字段域分离的 SHA-256 opaque digest；普通 Command 自带的标识一律删除/替换。
- 普通 Command 自带的 `messageIdHash` 等看似合法的摘要也不可信；摘要只允许在 Adapter 工厂生成并保留内部信任标记时进入结果，序列化后再次从不受信输入进入时必须移除。
- Adapter 映射失败只返回固定字段路径和稳定错误码，不把额外字段名或 raw value 拼进诊断文本。
- Handler、Runtime Validator、Receipt readback 和公开 Event 共用同一归一化结果；公开 Event 不携带 Provider Result，错误/日志只使用稳定安全信息。本地测试会对 Receipt、Event、ApiError 和捕获日志统一搜索敏感反例。
- PostgreSQL 继续遵守 forward-only migration：新增 V6003 owner/table 安全形状防线，不改写已应用的 V6002；Persistence Gate 需验证归一化结果可写入并可 readback，未归一化 Issue #23 反例不能由 owner boundary 写入。
- 直接 owner probe 必须按既有 Persistence Contract 传入 32-byte SHA-256 `bytea`，避免把 ContentHash JSON 外形误当作数据库二进制参数。

## 已完成验证

- 直接反例 `messageId=AliceCustomer`、`providerStatus=AliceCustomer`、`reasonCode=BobBuyer`、`status=CustomerName` 现在只产生固定 redacted marker；原始值不进入归一化结果。
- focused 命令通过 `4 files / 40 tests`，覆盖闭集 mapping、未信任原始标识和自声明摘要、Receipt readback、Publication Event、ApiError/日志边界及失败诊断；`git diff --check` 和 `pnpm format:check` 通过。
- 最新 `pnpm clean && pnpm verify` 通过：普通 Vitest `42 files passed / 30 skipped`、`444 passed / 299 skipped`；Architecture、201 项 Catalog/API、compatibility baseline 200 项通过；PostgreSQL/Flyway `34 files / 314 tests` 通过，V6003 已应用，二次 migrate 为 `Schema "public" is up to date. No migration necessary.`，容器已清理。
- 真实 Provider/Feishu、生产、公开 HTTP、统一跨模块业务 E2E、外部收件人和独立人工验收仍为 `NOT RUN`；#24 未登记 Adapter Attempt 直接反例仍保持 `FAIL`。当前工作树未提交，等待用户检查并明确确认后再进入 commit/push/PR 边界。
