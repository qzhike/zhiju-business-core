# Issue #97 Representation Binding 合成复核表

日期：2026-08-29
状态：`SYNTHETIC TECHNICAL FIXTURE PASS / INDEPENDENT MANUAL ACCEPTANCE NOT RUN`

## 复核边界

本文件把自动测试使用的成功 Binding、Registration 与负向替换结果整理为可人工复核的产出。所有 locator、Hash、Receipt、Renderer 和时间均为 synthetic technical fixture；未生成、打开或检查真实 PDF/DOCX/XLSX 文件，也未连接真实 IntegrationGateway、Renderer、Provider、对象存储、公开 HTTP 或生产环境。

## 成功输入对照

| 字段 | Binding Query 权威值 | Registration 值 | 实际结果 |
|---|---|---|---|
| Revision Ref | `artifact.artifact_revision` + exact UUIDv7/Scope/content hash | 完全相同 | `COMMITTED` |
| Canonical locator / input hash | FROZEN Revision `contentRef` / Revision content SHA-256 | Revision Ref 携带同 content hash | 精确匹配 |
| Format / media type | `document.pdf` / Binding 不携带 media type | `document.pdf` / `application/pdf` | 闭合映射通过 |
| Renderer | `renderer.pdf@1.0.0` | `renderer.pdf@1.0.0` | 精确匹配 |
| Output | `artifact/rendered/art-025.pdf` / `44` 重复 32 bytes | 完全相同 | 精确匹配 |
| RenderAttempt / Raw Receipt | exact Project-scoped UUIDv7 refs | exact RenderAttempt；Receipt 由 Binding 提供 | 权威类型与两处 Receipt equality 通过 |

首次提交后的实际行数为 Representation `1`、Validation `1`、Reference Edge `3`、`artifact.RepresentationRegistered` Event `1`。同 Command 重放返回 `DUPLICATE`；不同 Idempotency Key 但同一 exact RenderAttempt 返回首个 Representation ID，以上行数与 Event 数不增加。

## 负向矩阵

| 输入变化 | 预期错误/可见性 | 自动 fixture 实际输出 | 新 Representation / Validation / 成功 Event |
|---|---|---|---|
| wrong revision ID/hash | `ARTIFACT_REPRESENTATION_BINDING_MISMATCH` | `REJECTED`，错误码一致 | `0 / 0 / 0` |
| wrong canonical locator/input hash | `ARTIFACT_REPRESENTATION_BINDING_MISMATCH` | input hash 替换稳定拒绝；Repository 另行重验 canonical locator | `0 / 0 / 0` |
| wrong format/media | `ARTIFACT_REPRESENTATION_FORMAT_INVALID` 或 Binding mismatch | unknown family、media mismatch 与 format substitution 均拒绝 | `0 / 0 / 0` |
| wrong renderer ID/version | `ARTIFACT_REPRESENTATION_BINDING_MISMATCH` | `REJECTED`，错误码一致 | `0 / 0 / 0` |
| wrong output locator/checksum | `ARTIFACT_REPRESENTATION_BINDING_MISMATCH` | `REJECTED`，错误码一致 | `0 / 0 / 0` |
| missing/wrong Raw Receipt | `ARTIFACT_REPRESENTATION_BINDING_INVALID` 或 mismatch | 缺失、错误 object type、两处不一致均 fail-closed | `0 / 0 / 0` |
| `FAILED/UNKNOWN/CANCELLED/QUARANTINED` | `ARTIFACT_REPRESENTATION_BINDING_INVALID` | 四种状态均稳定拒绝 | `0 / 0 / 0` |
| cross-project | 不可枚举 `ARTIFACT_QUERY_NOT_FOUND`；RLS 不可见 | Unit 返回 not found；wrong-project SQL SELECT 行数 `0` | `0 / 0 / 0` |
| 同 Attempt 替换 immutable output | `ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT` | `REJECTED`，首个事实不变 | `0 / 0 / 0` |
| Outbox 后注入故障 | 整体 rollback | Representation/Validation/Command Receipt 均为 `0` | `0 / 0 / 0` |

## 环境与清理

- PostgreSQL：`18.6`，镜像 digest `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`。
- Flyway：`11.20.3`，镜像 digest `sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1`。
- 实际结果：V4004 空库迁移成功；Persistence `28 files / 284 tests passed`；第二次 migrate 为 `No migration necessary`；测试容器已删除。
- 完整门禁：`pnpm verify` 全过；Vitest `32 passed / 24 skipped` files、`390 passed / 269 skipped` tests；architecture、201 项公开 Contract 与 200 项 v1.0 兼容基线均通过。
- 独立人工业务验收、真实文件可打开性/版式、真实 Provider/Renderer/object store、公开 HTTP、部署跨模块 E2E 和生产均为 `NOT RUN`。
