# Issue #90 验证记录

版本：v0.1
日期：2026-08-28
Issue：[#90 Freeze executable canonical schemas](https://github.com/qzhike/zhiju-business-core/issues/90)
工作区：`im-04-wi-01-freeze-executable-canonical-schemas`
分支：`galendai/im-04-wi-01-freeze-executable-canonical-schemas`
初始 HEAD：`89073ab`
状态：`IMPLEMENTATION COMPLETE / CONTRACT REGRESSION PASS / GIT DELIVERY PENDING USER REVIEW`

本记录是 Issue #90 的本地实现、契约回归和边界验证记录。当前尚未执行 commit、push、创建或合并 PR、关闭 Issue 或删除 branch；这些 Git 交付动作等待用户检查工作区变更并确认。

## 1. 范围与冻结边界

本次实现覆盖以下已由 IM-DG-005 和相关 Module Spec 冻结的内容：

- `STRUCTURED_DOCUMENT` 与 `WORKBOOK_SPEC` 的 executable Canonical Content Payload Schema；
- Canonical Document 的稳定 Unit 身份、闭合 Unit Type、父子层级、无环关系和同级 ordinal 约束；
- WorkbookSpec 的稳定 Sheet/Column/Row/Cell 身份、Sheet 内 Column 引用、valueType 和 formula 约束；
- 固定四字段 Hash Domain：`{schemaRef, contentType, canonicalizationVersion, body}`，使用 Canonical JSON 与 SHA-256；
- Manifest 的独立对象生命周期字段，以及 Manifest locator、storageState、byteSize、mediaType 和 contentHash 不进入 Payload Hash；
- additive `integration.get_render_attempt_binding@1.0` Query，返回原始 RenderRequest、request payload hash、成功结果和 raw receipt ref，但不返回凭证或 Presigned URL；
- Registry、Catalog、兼容性元数据、生成 TypeScript 类型、fixture 和负向回归同步。

本次没有新增 Artifact 业务 Command/Query、Repository、Database Migration、对象存储适配器、Renderer、公开 HTTP、Provider 集成或公共 Diff API，也没有把这些未执行范围标记为 PASS。

## 2. 实现交付物

| 交付物 | 位置 | 验证结果 |
|---|---|---|
| Canonical Document/Workbook/Manifest Schema | `contracts/src/operations/artifact.schema.ts` | Ajv 结构校验通过；未知 major、未知 required extension、开放 content type 被拒绝 |
| Document/Workbook 语义不变量 | `contracts/src/canonical-content.validation.ts`、`contracts/src/registry.ts` | 重复 ID、断裂或成环层级、ordinal 冲突、无效 Column 引用、非法 formula/type 被拒绝 |
| Canonical JSON 与 SHA-256 helper | `packages/shared-kernel/src/canonical-content.ts` | 两个 golden fixture 的 canonical bytes 与 digest 精确匹配；Hash Domain 排除 Manifest 元数据和自身 Hash |
| RenderAttempt Binding Query | `contracts/src/operations/integration-gateway.schema.ts` | Registry 新增唯一 `integration.get_render_attempt_binding@1.0`；成功状态要求 succeeded result/raw receipt |
| Catalog、兼容性与生成类型 | `contracts/registry/`、`contracts/src/generated/`、`tools/contracts/` | 当前 Registry `FULL:201`；历史 v1.0 baseline 保持 200；compatibility Gate 通过 |
| 测试与可复核 fixture | `contracts/src/canonical-content.test.ts`、`tests/fixtures/contracts/canonical-content/`、`tests/fixtures/contracts/integration-render-attempt-binding-result-valid.json` | 聚焦 4 文件 95 tests PASS；全量普通测试 363 PASS |

## 3. Golden fixture 可复核输出

以下输出由本地测试直接读取 fixture 并通过 `ContractRegistry`、`canonicalizeCanonicalContentPayload` 和 `hashCanonicalContentPayload` 得到。fixture 中的 Payload JSON 是输入；`expectedCanonicalBytes` 和 `expectedDigest` 是可审查的固定期望值，测试同时断言实际值与其完全相等。

### 3.1 Structured Document

输入 fixture：[`document-golden.json`](../../tests/fixtures/contracts/canonical-content/document-golden.json)

| 检查 | 期望输出 | 实际输出 | 结果 |
|---|---|---|---|
| Payload Schema 与 Document 语义校验 | `valid=true`, `errors=[]` | `valid=true`, `errors=[]` | `PASS` |
| Manifest Schema 校验 | `valid=true`, `errors=[]` | `valid=true`, `errors=[]` | `PASS` |
| Canonical bytes | 与 fixture 的 `expectedCanonicalBytes` 完全相等 | 与 fixture 的 `expectedCanonicalBytes` 完全相等 | `PASS` |
| SHA-256 digest | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` | `PASS` |

实际 canonical bytes：

```text
{"body":{"documentId":"018f22e2-7c15-7b2e-8d86-2de956a9d221","metadata":{"locale":"en-US","revisionLabel":"golden-1"},"title":"Supplier review procedure","units":[{"childUnitIds":["introduction","control-table"],"ordinal":0,"unitId":"document-root","unitType":"SECTION"},{"childUnitIds":[],"ordinal":0,"parentUnitId":"document-root","text":"Review supplier evidence before approval.","unitId":"introduction","unitType":"PARAGRAPH"},{"childUnitIds":["control-row"],"ordinal":1,"parentUnitId":"document-root","semanticMetadata":{"tablePurpose":"supplier-control"},"unitId":"control-table","unitType":"TABLE"},{"childUnitIds":["control-cell"],"ordinal":0,"parentUnitId":"control-table","unitId":"control-row","unitType":"TABLE_ROW"},{"childUnitIds":[],"ordinal":0,"parentUnitId":"control-row","text":"Evidence is traceable.","unitId":"control-cell","unitType":"TABLE_CELL"}]},"canonicalizationVersion":"1","contentType":"STRUCTURED_DOCUMENT","schemaRef":{"kind":"VERSIONED","objectId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","objectType":"artifact.canonical_document_schema","scope":{"enterpriseId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","projectId":"018f22e2-7c15-7b2e-8d86-2de956a9d202"},"versionId":"018f22e2-7c15-7b2e-8d86-2de956a9d211"}}
```

### 3.2 WorkbookSpec

输入 fixture：[`workbook-golden.json`](../../tests/fixtures/contracts/canonical-content/workbook-golden.json)

| 检查 | 期望输出 | 实际输出 | 结果 |
|---|---|---|---|
| Payload Schema 与 Workbook 语义校验 | `valid=true`, `errors=[]` | `valid=true`, `errors=[]` | `PASS` |
| Manifest Schema 校验 | `valid=true`, `errors=[]` | `valid=true`, `errors=[]` | `PASS` |
| Canonical bytes | 与 fixture 的 `expectedCanonicalBytes` 完全相等 | 与 fixture 的 `expectedCanonicalBytes` 完全相等 | `PASS` |
| SHA-256 digest | `e3e0f7357a3fcd6c18063081128913b0cd8983e75d6455d4aa6664284f30a818` | `e3e0f7357a3fcd6c18063081128913b0cd8983e75d6455d4aa6664284f30a818` | `PASS` |

实际 canonical bytes：

```text
{"body":{"metadata":{"locale":"en-US","revisionLabel":"golden-1"},"sheets":[{"columns":[{"columnId":"supplier","name":"Supplier","ordinal":0,"valueType":"text"},{"columnId":"amount","name":"Amount","ordinal":1,"valueType":"number"},{"columnId":"total","name":"Total","ordinal":2,"valueType":"number"}],"crossRecordRules":[{"columnId":"supplier","rule":"unique"}],"name":"Suppliers","ordinal":0,"rows":[{"cells":[{"cellId":"supplier-row-1-name","columnId":"supplier","value":"Acme","valueType":"text"},{"cellId":"supplier-row-1-amount","columnId":"amount","value":2,"valueType":"number"},{"cellId":"supplier-row-1-total","columnId":"total","formula":"=SUM(amount)","value":2,"valueType":"number"}],"ordinal":0,"rowId":"supplier-row-1"},{"cells":[{"cellId":"supplier-row-2-name","columnId":"supplier","value":"Beta","valueType":"text"},{"cellId":"supplier-row-2-amount","columnId":"amount","value":3,"valueType":"number"},{"cellId":"supplier-row-2-total","columnId":"total","formula":"=SUM(amount)","value":3,"valueType":"number"}],"ordinal":1,"rowId":"supplier-row-2"}],"sheetId":"supplier-sheet","validationRules":[{"columnId":"supplier","rule":"required"}]}],"workbookId":"018f22e2-7c15-7b2e-8d86-2de956a9d261"},"canonicalizationVersion":"1","contentType":"WORKBOOK_SPEC","schemaRef":{"kind":"VERSIONED","objectId":"018f22e2-7c15-7b2e-8d86-2de956a9d241","objectType":"artifact.workbook_spec_schema","scope":{"enterpriseId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","projectId":"018f22e2-7c15-7b2e-8d86-2de956a9d202"},"versionId":"018f22e2-7c15-7b2e-8d86-2de956a9d251"}}
```

### 3.3 Hash Domain 变更矩阵

| 变更项 | 期望 | 实际 | 结果 |
|---|---|---|---|
| `schemaRef.versionId` | digest 改变 | digest 改变 | `PASS` |
| `contentType` | digest 改变 | digest 改变 | `PASS` |
| `canonicalizationVersion` | digest 改变 | digest 改变 | `PASS` |
| `body` | digest 改变 | digest 改变 | `PASS` |
| Manifest `objectRef`、`storageState`、`byteSize`、`mediaType` | digest 不改变 | digest 不改变 | `PASS` |
| Manifest `contentHash` 或 Payload 上的 self-hash 字段 | 不形成递归 Hash 输入 | digest 不改变 | `PASS` |

## 4. 负向与 Binding 输出

### 4.1 Canonical Content 负向矩阵

| 输入变体 | 期望输出 | 实际输出 | 结果 |
|---|---|---|---|
| `canonicalizationVersion=2` | 拒绝未知 canonicalization major | Ajv `const` 错误，`valid=false` | `PASS` |
| `contentType=STRUCTURED_REPORT` | 拒绝未纳入 WI-01 的开放类型 | Ajv `const` 错误，`valid=false` | `PASS` |
| 顶层 `requiredExtension` | 拒绝未知 required extension | Ajv `additionalProperties` 错误，`valid=false` | `PASS` |
| `integration.get_render_attempt_binding@2.0` | Registry 拒绝未知 operation major | `operationRegistry` 错误，`valid=false` | `PASS` |
| Document 重复 `unitId` | 拒绝重复稳定身份 | `canonicalContentInvariant` 错误，`valid=false` | `PASS` |
| Document 缺失 child/parent 对应关系 | 拒绝断裂 hierarchy | `canonicalContentInvariant` 错误，`valid=false` | `PASS` |
| Document parent cycle | 拒绝有环层级 | 错误消息包含 `cycle`，`valid=false` | `PASS` |
| Document 同级 ordinal 冲突 | 拒绝重复 ordinal | 错误消息包含 `ordinal`，`valid=false` | `PASS` |
| Workbook Cell 引用不存在的 Column | 拒绝跨 Sheet/未知 Column 引用 | 错误消息包含 `does not reference`，`valid=false` | `PASS` |
| Workbook 重复 `cellId` | 拒绝 Sheet 内重复 Cell 身份 | 错误消息包含 `duplicate cellId`，`valid=false` | `PASS` |
| Workbook 不平衡 formula | 拒绝括号或引号不闭合 formula | 错误消息包含 `formula`，`valid=false` | `PASS` |
| Workbook 非法 `valueType` | 拒绝不符合 NamespaceCode 的类型 | Ajv `pattern` 错误，`valid=false` | `PASS` |

### 4.2 RenderAttempt Binding Query

输入 fixture：[`integration-render-attempt-binding-result-valid.json`](../../tests/fixtures/contracts/integration-render-attempt-binding-result-valid.json)

| 输入 | 期望输出 | 实际输出 | 结果 |
|---|---|---|---|
| Query Envelope 携带 `attemptRef` | 接受 `integration.get_render_attempt_binding@1.0` | `valid=true`, `errors=[]` | `PASS` |
| `SUCCEEDED` Result 携带原始 `request`、`requestPayloadHash`、`succeededResult`、`rawReceiptRef` | Binding Result 可接受 | `valid=true`, `errors=[]` | `PASS` |
| 顶层加入 `credentials` 和 Presigned URL | 不得泄露敏感信息 | `additionalProperties` 错误，`valid=false` | `PASS` |
| `SUCCEEDED` 缺少 `succeededResult` | 成功状态必须有成功结果 | `required` 错误，`valid=false` | `PASS` |
| `FAILED` 携带 `succeededResult` | 非成功状态不得携带成功结果 | `false schema` 错误，`valid=false` | `PASS` |

Binding fixture 中仅保留引用、Hash、renderer 标识、输出对象引用和 raw receipt 引用；没有 credentials、access token、app secret、workspace path 或 Presigned URL。该结果是 Schema/Contract fixture 验证，不是 Provider 或 Renderer 的真实调用结果。

## 5. 命令与实际结果

| 命令 | 预期 | 实际结果 |
|---|---|---|
| `pnpm contracts:generate` | 生成物与源 Schema 同步 | `UPDATED operations=201; payloads=201; query_results=45; core_contracts=6` |
| `pnpm --filter @zhiju/shared-kernel build` | Shared Kernel 构建成功 | `PASS` |
| `pnpm --filter @zhiju/contracts build` | Contracts 构建成功 | `PASS` |
| 聚焦 Vitest：Canonical、Integration Schema、Registry、Canonical JSON | 相关断言全部通过 | `4 files passed; 95 tests passed` |
| `pnpm format:check` | 格式检查通过 | `PASS` |
| `pnpm lint` | Lint 通过 | `PASS` |
| `pnpm architecture` | 架构边界通过 | `PASS; source_roots=10` |
| `pnpm contracts:check` | 生成物、Catalog、Registry、兼容性一致 | `PASS; FULL:201; Command=95, Query=45, Event=61; baseline=200; minor=21` |
| `pnpm build` | 全仓库构建成功 | `PASS` |
| `pnpm typecheck` | 全仓库类型检查成功 | `PASS` |
| `pnpm test` | 普通全量测试完成 | `25 files passed / 17 skipped; 363 passed / 241 skipped` |
| `pnpm verify` | 全部验证 Gate 完成 | format、lint、typecheck、test、architecture、contracts:check 均 `PASS`；PostgreSQL/Flyway persistence 为 `21 files passed / 256 passed`，空库迁移、二次 no-op 和容器清理均完成，整体 `PASS` |
| `git diff --check` | 无空白错误 | `PASS` |

## 6. 已执行与未执行边界

本次 `pnpm verify` 的 PostgreSQL/Flyway 技术 persistence gate 已实际执行并通过：固定 PostgreSQL 18.6 与 Flyway 11.20.3 镜像成功启动，`21` 个 persistence 测试文件、`256` 个测试全部通过，空库迁移成功，二次 migrate 输出 `Schema "public" is up to date. No migration necessary.`，最终容器已移除。该结果只证明现有技术表、Migration 和受控 persistence fixture，不等同于 Artifact 业务 Repository/Handler 或对象 Link 已实现。

以下范围仍明确保持 `NOT RUN`，不因本地 Schema/Contract 或技术 persistence 通过而提升状态：

- Artifact 业务 Handler、Repository、Object Storage Link、Manifest 生命周期事务、payload-to-hash 持久化 Gate；
- Renderer 进程、真实 RenderAttempt、真实 Provider、原始外部 Receipt 和生产对象存储；
- 公开 HTTP、跨模块 Application Port、真实 Event Bus/Process Manager 和集成 E2E；
- 生产数据库、负载、备份恢复、外部系统安全审查；
- 独立人工 Reference Project 和业务质量验收。

## 7. Git 交付状态

当前工作区保留实现、生成物、fixture、测试和 `.vibe` 文档变更；尚未创建提交。用户检查并确认后，后续交付将按以下独立边界执行：

1. 仅提交 Issue #90 范围内的文件，并核验 staged diff；
2. 非强制 push 当前 branch，创建/更新关联 PR；
3. 以 PR 当前精确 HEAD 等待并回读 CI；
4. 使用精确 HEAD 约束合并到 `main`；
5. 回读 PR、`origin/main` 祖先关系和 Issue #90 状态后关闭 Issue；
6. 删除远端和本地 branch，清理 worktree/prune，并再次回读权威状态。
