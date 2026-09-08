> Historical record. Related Issue: [98](https://github.com/qzhike/zhiju-business-core/issues/98). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-04 ART-023 合成技术验收报告

日期：2026-08-29
状态：`SYNTHETIC / TECHNICAL ONLY / AUTOMATED PASS / INDEPENDENT MANUAL ACCEPTANCE NOT RUN`

## 1. 范围与执行方式

本报告把 IM-04 各纵向切片的自动证据汇总为一个审核入口。Query/DAG 与 Representation 使用同一次 disposable PostgreSQL Gate 中彼此隔离的 fixture shard，避免跨测试文件共享可变数据库状态；两者都使用同一 Enterprise/Project Scope、同一 Canonical Document golden hash 和相同权威 Query 规则。

可重复命令：

```bash
pnpm typecheck
ZJU_ART023_REPORT=1 pnpm persistence:gate
pnpm clean && pnpm verify
```

`ZJU_ART023_REPORT=1` 只输出合成 UUID、opaque locator、Hash、稳定错误码和行数，不输出数据库凭据或外部 Secret。普通 Gate 不设置该变量时没有额外报告输出。

环境：

| 项目 | 实际值 |
|---|---|
| PostgreSQL | `18.6` / server version `180006` |
| PostgreSQL image | `sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` |
| Flyway | `11.20.3` |
| Flyway image | `sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1` |
| Scope | Enterprise `018f22e2-7c15-7b2e-8d86-2de956a9d201` / Project `018f22e2-7c15-7b2e-8d86-2de956a9d202` |
| Query evidence time | `2026-08-29T13:43:29.061Z` |
| Representation evidence time | `2026-08-29T13:43:30.331Z` |

## 2. Root、Branch、Manifest 与 Revision DAG

本次 Query/DAG shard：

| 对象 | 精确实际值 |
|---|---|
| Artifact | `01a04dc2-d2ea-7599-9107-5c8dfe5e68d7` |
| 默认 Branch | `01a04dc2-d2ea-7599-9107-62d38ab258f4` |
| Scope | 上述 exact Enterprise/Project |
| Canonical Document hash | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` |
| media type / bytes | `application/json` / `1238` |

| Revision | Revision UUID | Content Object UUID | Parent |
|---|---|---|---|
| REV-001 | `01a04dc2-d300-7129-9513-314e7aa80ce1` | `01a04dc2-d300-7129-9513-367aaec8a072` | `[]` |
| REV-002 | `01a04dc2-d32e-7519-ac57-c52077f4a36c` | `01a04dc2-d32e-7519-ac57-cbc079d7a84c` | REV-001 |
| REV-003 | `01a04dc2-d34d-751c-bc2e-8ee6ad570623` | `01a04dc2-d34d-751c-bc2e-9169d02109a9` | REV-001 |
| MERGE-REV | `01a04dc2-d3bc-762b-9882-f46a487e4702` | `01a04dc2-d3bc-762b-9882-faab4deda00c` | REV-002、REV-003，顺序 `0/1` |

四个 Manifest 的 locator 均由 Application 按 `staging/canonical/<contentObjectId>` 生成，并由 authoritative readback 验证后进入 `FROZEN`。本 DAG shard 故意复用同一 Canonical Document bytes/hash，以单独隔离并证明 Revision identity、Parent DAG、Branch CAS、Merge 与治理 Query；实际内容变化与 stable Diff 由第 4 节的 Document/Workbook shard 证明，不能把 DAG 中不同 Revision UUID 误报为不同内容 hash。

## 3. Branch CAS、Lineage 与 Query 稳定性

两个写者均以 `headVersion=0` 并发移动 Branch：

| 项目 | 实际输出 |
|---|---|
| winner | REV-002 `01a04dc2-d32e-7519-ac57-c52077f4a36c` |
| loser candidate | REV-003 `01a04dc2-d34d-751c-bc2e-8ee6ad570623` |
| loser error | `ARTIFACT_BRANCH_HEAD_CONFLICT` |
| retry | 重新读取后从 version `1` 推进到 `2` |
| Head Event aggregate versions | `1, 2` |
| Head Reference Edge owner version | exact Branch UUID，不使用数值 head token |

Lineage 的四条边为 `REV-002 -> REV-001`、`REV-003 -> REV-001`、`MERGE-REV -> REV-002` 和 `MERGE-REV -> REV-003`；root 只有 REV-001。治理前 `lineageHash` 为 `57cfd415da8dd412eafd4a1d573944b2ab4f7bd8057e4ae53062c6b48af8fb7b`，REV-001 追加 Withdrawal/Invalidation 后为 `e891a29721d43d64007598e68617d81bafe7465a49059f87d9871a2947a77ed6`。

Hash 变化是现行 Contract 的预期：`lineageHash` 覆盖包含派生 `disposition` 的 Snapshot；治理后 disposition 由 ACTIVE 变为 INVALIDATED。以下历史身份保持深比较相等：Revision Ref/hash、revision number、content type/locator、Parent、changed units、semantic metadata、Provenance、root refs 与四条 edge identity/order。

Diff Inputs 的实际值：

| 字段 | 实际输出 |
|---|---|
| left | REV-002 exact Ref |
| right | REV-003 exact Ref |
| common ancestor | REV-001 exact Ref |
| comparison schema | `artifact.canonical_document_schema` / object `018f22e2-7c15-7b2e-8d86-2de956a9d201` / version `018f22e2-7c15-7b2e-8d86-2de956a9d211` |
| governance 后重读 | left/right/common ancestor/schema 深比较相等 |

## 4. Document 与 Workbook stable Diff

Document shard 使用固定 Document `018f22e2-7c15-7b2e-8d86-2de956a9d221`：

| 版本 | 精确 SHA-256 | bytes | Diff |
|---|---|---:|---|
| base | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` | `1238` | — |
| Human edit | `3beefae4fe0624d7fa723d86cbbece0fb9bdabb76b5ab0a298db14ce28e565d1` | `1252` | `CHANGED introduction` |

Workbook shard 使用固定 Workbook `018f22e2-7c15-7b2e-8d86-2de956a9d261`：

| 版本 | 精确 SHA-256 | Diff |
|---|---|---|
| base，`supplier-row-2-amount=3` | `e3e0f7357a3fcd6c18063081128913b0cd8983e75d6455d4aa6664284f30a818` | — |
| Human edit，值为 `4` | `7a842edeee6c69a0388f78dec266f4aab42b5de9ee4d32b830926de498ceacb5` | `CHANGED CELL supplier-row-2-amount` |

两类 Diff 都由 `artifact.get_revision_diff_inputs@1.0` 的两个 exact Snapshot 与双方 FROZEN authoritative bytes 驱动。Diff 结果可重复、不持久化、不产生公共 Diff Result、Outbox、Quality、Approval、Release 或 EffectiveBinding 事实。

## 5. RenderAttempt Binding 与 Representation

同一次 Gate 的 Representation shard 精确输出：

| 对象/字段 | 实际值 |
|---|---|
| Artifact | `01a04dc2-d7b1-70cf-a494-8a1aebb6a47f` |
| Revision | `01a04dc2-d7cc-738d-a40c-e200784403f3@902a88d2...a985b7` |
| RenderAttempt | `01a04dc2-d8be-70ca-9d1d-11f6361bf253` |
| Raw Receipt | `01a04dc2-d8be-70ca-9d1d-18889fdd7a0e@5555...5555` |
| Representation | `01a04dc2-d8be-70ca-9d1d-14137fc45042` |
| canonical locator | `staging/canonical/01a04dc2-d7cc-738d-a40c-e6733606b182` |
| output locator | `artifact/rendered/art-025.pdf` |
| format/media | `document.pdf` / `application/pdf` |
| renderer | `renderer.pdf@1.0.0` |
| input hash | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` |
| output checksum | `4444444444444444444444444444444444444444444444444444444444444444` |
| registration content hash | `edbb2311022877692468edbc45842158a2303dcb712394719caa604c0a0c58ef` |

Binding status 为 `SUCCEEDED`；Request/Success/Registration 的 attempt、Revision、Scope、input、format、renderer、output 与 Receipt 逐项一致。提交后实际行数为 Representation `1`、Validation `1`、Reference Edge `3`、成功 Event `1`。Representation 登记前后的 Revision Lineage 与同 Ref Diff Inputs 深比较相等。

## 6. 负向输出

| 输入 | 实际错误/结果 | 副作用 |
|---|---|---|
| Revision content hash 替换 | `ARTIFACT_CONTENT_HASH_MISMATCH` | 不读取 current |
| Revision object ID=`latest` | `ARTIFACT_SCOPE_INVALID` | 不降级解析 |
| Project Revision 使用 Enterprise-only 宽 Scope | `ARTIFACT_QUERY_SCOPE_MISMATCH` | 不枚举其他 Scope |
| 非 FROZEN Manifest 创建 Revision | `ARTIFACT_CONTENT_STATE_INVALID` | Revision `0` |
| wrong Binding revision/input/renderer/checksum | `ARTIFACT_REPRESENTATION_BINDING_MISMATCH` | 新 Representation `0` |
| Binding status=`UNKNOWN` | `ARTIFACT_REPRESENTATION_BINDING_INVALID` | 新 Representation `0` |
| 同 Attempt 替换 immutable output | `ARTIFACT_REPRESENTATION_IDENTITY_CONFLICT` | 首个事实不变 |
| Representation checksum/locator/renderer Ref 替换 | `ARTIFACT_QUERY_NOT_FOUND` | 不返回近似匹配 |
| wrong Project SQL read | 可见行数 `0` | RLS fail-closed |
| Revision/Parent/Representation direct mutation | SQLSTATE `42501` | immutable facts 不变 |
| Outbox 后注入故障 | controlled rollback | Representation/Validation/Receipt `0` |

## 7. Gate、清理与未运行边界

实际 `pnpm clean && pnpm verify`：Format、Lint、Typecheck、Unit、Architecture、Contract、Compatibility 与 Persistence 全部通过；普通 Vitest 为 `32 passed / 24 skipped` files、`390 passed / 269 skipped` tests；Catalog/Registry 为 `201/201 FULL`，冻结 v1.0 baseline 为 200 operations；Persistence 为 `28 files / 284 tests passed`。

空库 Flyway migration 成功，第二次输出 `Schema "public" is up to date. No migration necessary.`；每次 Gate 最终输出 `postgres container removed`。没有新增或修改 Migration，没有遗留临时脚本、临时数据库文件或测试容器。

以下仍为 `NOT RUN`：`artifact.get_effective_binding@1.0` 的业务 Handler/正式事实、真实 IntegrationGateway 部署读回、Ceph RGW/OpenBao、Renderer/Provider、DOCX/XLSX/PDF 可打开性与版式、公开 HTTP、生产部署、Quality/Approval/Release/Feishu/CLI、跨模块业务 E2E、真实客户适用性和独立人工业务验收。
