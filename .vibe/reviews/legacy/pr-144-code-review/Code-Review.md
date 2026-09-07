> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/pr-144-code-review/Code-Review.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/pr-144-code-review/Code-Review.md).

# PR #144 代码审查

日期：2026-08-31

PR：`qzhike/zhiju-business-core#144`

审查 head：`474a978317acbd4ae2dda4101ae1bea4072a3df1`

base：`main@db2cc4c24ec3de5c5f8224f498b2695880f7fac8`

## 结论

`CHANGES REQUESTED`。PR 已修复 Issue #23 的原始允许键/姓名式值直接反例，现有自动化和仓库 Gate 也全部通过；但当前实现仍存在存量 PII 未处理、Adapter 信任边界不能跨序列化且未接入实际 Adapter、数据库接受调用方自声明摘要，以及诊断路径回显不受信 key 的问题。Issue #23 不应在这些问题修复前关闭。

## Findings

### [P1] V6003 不检查或处理迁移前已经存在的敏感 Provider Result

位置：`migrations/release_publication/V6003__release_publication_provider_result_safety.sql:7`、`:112`；关联旧写入：`migrations/release_publication/V6002__release_publication_authorization_publication_receipt_recall.sql:847`。

V6003 只创建 safe-shape helper 和 `BEFORE INSERT OR UPDATE OF provider_result` trigger。迁移过程中没有扫描现有 `publication_receipt.provider_result`，也没有检查对应 immutable `publication_observation.observation_payload.providerResult`。因此，任何在 V6003 前由 V6002 合法写入的姓名、邮箱、Token 或正文会在迁移成功后继续保留并可读取；空库 Migration PASS 不能证明升级已有数据库安全。Observation 还是 append-only，普通 UPDATE 不能作为事后补救。

建议：增加真实 V6002→预置敏感 Receipt/Observation→V6003 的升级测试。迁移至少应在发现不安全存量事实时 fail-closed；若要求继续升级，需要设计保留不可变历史语义的隔离、受控替代或安全投影视图，而不是只保护未来写入。Receipt 与 Observation 两处副本必须同时覆盖。

### [P1] “Adapter-owned”安全结果依赖进程内对象身份，未接入实际 Adapter，也不能跨 JSON 边界

位置：`modules/release-publication/src/provider-result.ts:16`、`:147`、`:240`、`:302`、`:412`；公开导出：`modules/release-publication/src/index.ts:6`。

`feishu.channel` 原始值 mapping 实际定义在 ReleasePublication 内，而不是 IntegrationGateway/Provider Adapter；仓库中 `createProviderResultFromAdapter` 的调用方只有测试。所谓可信结果由模块级 `WeakSet` 记录 JavaScript 对象身份，任何 JSON 序列化、消息传递或持久化都会丢失该身份。直接探针显示，同一个合法 mapped result 经 `JSON.stringify/parse` 后再次进入 `sanitizeProviderResult`，`messageIdHash` 和 `providerRequestIdHash` 会被当作调用方自声明字段删除。反过来，任何进程内调用方都可以导入公开 factory 并获得“trusted”对象，WeakSet 证明的是调用过 factory，不是来源于权威 Adapter。

这意味着测试中的“Adapter mapping → Receipt”正向路径只能依赖同一对象引用，尚未证明真实 Adapter/Port/Command 边界。建议把 raw Provider mapping 放回 Adapter Owner，通过窄化的公开 Port 传递可验证的内部事实；ReleasePublication 应验证该事实与 Adapter Attempt/Raw Receipt 的精确绑定。测试必须至少覆盖 Adapter 输出经过真实序列化/Port 后仍能确定性进入 Receipt/Persistence 的路径。

### [P2] 摘要既不是不可逆 Token，也没有数据库侧来源证明

位置：`modules/release-publication/src/provider-result.ts:210`、`:220`、`:293`；数据库验证：`migrations/release_publication/V6003__release_publication_provider_result_safety.sql:81`；应用执行权限：`migrations/release_publication/V6002__release_publication_authorization_publication_receipt_recall.sql:1378`。

标识符只要求是长度 1–512 的任意字符串，然后使用公开、无密钥、确定性的 SHA-256。低熵姓名、客户号、邮箱或可枚举 message ID 可以离线猜测并重算，且同一字段会形成稳定的跨 Receipt 关联标识；这不等同于不可逆 Token。V6003 只检查 `*Hash` 是否为 64 位十六进制，因此持有 `release_publication_app` 的调用方可直接调用 SECURITY DEFINER owner function，提交任意自声明摘要并通过 table guard，数据库无法证明摘要来自登记 Adapter。

建议：不能证明非敏感语义的标识应直接省略，或使用版本化 HMAC/Token Vault 并绑定 Adapter Code、字段域与权威 Adapter Attempt；数据库写入口也必须验证可持久化摘要的来源，不能只验证字符串形状。增加低熵字典反例和 owner function 自声明合法形状 `*Hash` 的负向 PostgreSQL 测试。

### [P2] `redactedPaths` 会回显不受信 key，与固定诊断路径契约矛盾

位置：`modules/release-publication/src/provider-result.ts:307`、`:395`。

未知字段会先用原始 key 构造 JSON Pointer，再放入公开返回值 `redactedPaths`。直接探针输入 key `AliceCustomer/customer@example.com`，实际输出包含 `/AliceCustomer~1customer@example.com`。虽然当前 Handler 丢弃 `redactedPaths`，但 helper 将它作为公开诊断结果返回，后续日志或 ApiError 使用时会泄漏 key 中的姓名、邮箱、Token 等内容；PR 文档宣称“不回显不受信 key/value”和“固定字段路径”，与实现不一致。

建议：未知 key 统一返回固定路径，例如 `/providerResult` 或 `/unknownField`；只允许代码内已知字段使用固定的字段路径。增加 key 本身携带姓名、邮箱、Token 和长字符串的序列化断言。

## 验证证据

- PR exact head：`474a978317acbd4ae2dda4101ae1bea4072a3df1`。
- PR GitHub `verify`：SUCCESS，run `33402631164`。
- 新鲜 `pnpm clean && pnpm verify`：PASS。
  - 普通 Vitest：42 files passed / 30 skipped；444 passed / 299 skipped。
  - Architecture：`source_roots=10`，PASS。
  - Contract/Catalog：201/201 `FULL`；compatibility baseline 200，PASS。
  - Persistence：PostgreSQL 18.6 / Flyway 11.20.3；34 files / 314 tests；V6003 空库迁移、二次 no-op 和容器清理 PASS。
- 构建后聚焦套件：4 files / 40 tests PASS。
- 首次直接运行聚焦套件时，隔离工作树缺少 workspace build 产物，结果为 1 file/6 tests PASS、3 suites resolution failure；按 PR 声明先执行完整 clean verify 后重跑即通过，因此该首次结果仅记为环境准备失败。
- 直接 Node 探针：
  - 未知敏感 key 被写入 `redactedPaths`。
  - 合法 Adapter mapped result 经 JSON round-trip 后丢失两个 identifier hash。
- 临时审查测试文件已删除；Persistence Gate 容器已由脚本清理。

## 验收边界

真实 Provider/Feishu、生产、公开 HTTP、统一跨模块业务 E2E、外部收件人确认和独立人工验收仍为 `NOT RUN`。Issue #24 的伪造 Adapter Attempt provenance 缺陷继续独立保持 OPEN，不由本 PR 修复。
