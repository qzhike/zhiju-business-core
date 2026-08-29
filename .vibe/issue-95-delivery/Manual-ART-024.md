# Manual-ART-024：Structured Document Human Edit 与内部 Diff

## 目的与边界

这是 Issue-95 的 synthetic procurement-procedure 审核夹具。它用于复核 Canonical Document 的精确 bytes/hash、Unit identity/tree、Human Edit allow-list、exact Revision base、before/after Diff、历史重放和清理边界；它不是现实采购政策或业务审批的验收结论。

- Enterprise：`018f22e2-7c15-7b2e-8d86-2de956a9d201`
- Project：`018f22e2-7c15-7b2e-8d86-2de956a9d202`
- Document：`018f22e2-7c15-7b2e-8d86-2de956a9d221`
- Schema：`artifact.canonical_document_schema@018f22e2-7c15-7b2e-8d86-2de956a9d211`
- Content Hash domain：`{schemaRef, contentType, canonicalizationVersion, body}`
- 本夹具没有 UI、公开 HTTP、Renderer、Provider、生产数据库、跨模块业务调用或真实人工政策判断。

## 1. Unit tree 与身份

Canonicalization 后的 deterministic Unit 顺序为：

```text
document-root [SECTION, ordinal=0]
├── introduction [PARAGRAPH, ordinal=0]
├── control-table [TABLE, ordinal=1]
│   └── control-row [TABLE_ROW, ordinal=0]
│       └── control-cell [TABLE_CELL, ordinal=0]
```

| Unit ID | Type | Parent | Ordinal | Canonical role |
|---|---|---|---:|---|
| `document-root` | `SECTION` | — | 0 | supplier review procedure root |
| `introduction` | `PARAGRAPH` | `document-root` | 0 | supplier evidence review requirement |
| `control-table` | `TABLE` | `document-root` | 1 | supplier-control table |
| `control-row` | `TABLE_ROW` | `control-table` | 0 | control row |
| `control-cell` | `TABLE_CELL` | `control-row` | 0 | traceability statement |

输入 Unit 数组可以乱序；输出 Unit 数组、每个 `childUnitIds` 和同级遍历顺序必须保持以上结果。`unitId` 在本 Document lineage 内唯一，Unit type 只允许 `SECTION`、`PARAGRAPH`、`TABLE`、`TABLE_ROW`、`TABLE_CELL`。

## 2. Exact base Revision 与 Canonical bytes

以下 ref 是本夹具使用的合成 exact Revision identity；实际服务读取时必须以数据库可见 Revision、FROZEN Content Object、权威存储 readback 和相同 hash 逐项核对，不能使用 `latest`、`current` 或对象路径替代。

```json
{
  "kind": "CONTENT_ADDRESSED",
  "objectType": "ArtifactRevision",
  "objectId": "018f22e2-7c15-7b2e-8d86-2de956a9d281",
  "scope": {
    "enterpriseId": "018f22e2-7c15-7b2e-8d86-2de956a9d201",
    "projectId": "018f22e2-7c15-7b2e-8d86-2de956a9d202"
  },
  "contentHash": {
    "algorithm": "SHA-256",
    "canonicalizationVersion": "1",
    "digest": "902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7"
  }
}
```

Base Content Object 的合成 locator 为 `artifact/canonical/document-001`，状态必须为 `FROZEN`，media type 为 `application/json`。Canonical bytes（UTF-8，无换行）为：

```text
{"body":{"documentId":"018f22e2-7c15-7b2e-8d86-2de956a9d221","metadata":{"locale":"en-US","revisionLabel":"golden-1"},"title":"Supplier review procedure","units":[{"childUnitIds":["introduction","control-table"],"ordinal":0,"unitId":"document-root","unitType":"SECTION"},{"childUnitIds":[],"ordinal":0,"parentUnitId":"document-root","text":"Review supplier evidence before approval.","unitId":"introduction","unitType":"PARAGRAPH"},{"childUnitIds":["control-row"],"ordinal":1,"parentUnitId":"document-root","semanticMetadata":{"tablePurpose":"supplier-control"},"unitId":"control-table","unitType":"TABLE"},{"childUnitIds":["control-cell"],"ordinal":0,"parentUnitId":"control-table","unitId":"control-row","unitType":"TABLE_ROW"},{"childUnitIds":[],"ordinal":0,"parentUnitId":"control-row","text":"Evidence is traceable.","unitId":"control-cell","unitType":"TABLE_CELL"}]},"canonicalizationVersion":"1","contentType":"STRUCTURED_DOCUMENT","schemaRef":{"kind":"VERSIONED","objectId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","objectType":"artifact.canonical_document_schema","scope":{"enterpriseId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","projectId":"018f22e2-7c15-7b2e-8d86-2de956a9d202"},"versionId":"018f22e2-7c15-7b2e-8d86-2de956a9d211"}}
```

校验值：

| 项目 | 值 |
|---|---|
| byte length | `1238` |
| algorithm | `SHA-256` |
| digest | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` |

## 3. Allowed Human Edit 与 after Revision

Human Context 必须为同一 Enterprise/Project 的 `HUMAN` principal；候选只改变 `introduction` 的 text，allow-list 为 `[`introduction`]`，Document identity、title、metadata、schemaRef 和其他 Units 保持不变。

```json
{
  "baseRevisionRef": "018f22e2-7c15-7b2e-8d86-2de956a9d281@902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7",
  "allowedUnitRefs": ["introduction"],
  "changeSummary": "human added sanctions review requirement",
  "candidateChange": {
    "unitId": "introduction",
    "oldText": "Review supplier evidence before approval.",
    "newText": "Review supplier evidence and sanctions before approval."
  }
}
```

Canonical bytes（UTF-8，无换行）与 after hash 为：

```text
{"body":{"documentId":"018f22e2-7c15-7b2e-8d86-2de956a9d221","metadata":{"locale":"en-US","revisionLabel":"golden-1"},"title":"Supplier review procedure","units":[{"childUnitIds":["introduction","control-table"],"ordinal":0,"unitId":"document-root","unitType":"SECTION"},{"childUnitIds":[],"ordinal":0,"parentUnitId":"document-root","text":"Review supplier evidence and sanctions before approval.","unitId":"introduction","unitType":"PARAGRAPH"},{"childUnitIds":["control-row"],"ordinal":1,"parentUnitId":"document-root","semanticMetadata":{"tablePurpose":"supplier-control"},"unitId":"control-table","unitType":"TABLE"},{"childUnitIds":["control-cell"],"ordinal":0,"parentUnitId":"control-table","unitId":"control-row","unitType":"TABLE_ROW"},{"childUnitIds":[],"ordinal":0,"parentUnitId":"control-row","text":"Evidence is traceable.","unitId":"control-cell","unitType":"TABLE_CELL"}]},"canonicalizationVersion":"1","contentType":"STRUCTURED_DOCUMENT","schemaRef":{"kind":"VERSIONED","objectId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","objectType":"artifact.canonical_document_schema","scope":{"enterpriseId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","projectId":"018f22e2-7c15-7b2e-8d86-2de956a9d202"},"versionId":"018f22e2-7c15-7b2e-8d86-2de956a9d211"}}
```

| 项目 | 值 |
|---|---|
| new Content Object | 由 outer commandId 确定性派生；必须先经历 `STAGING -> LINKED -> FROZEN` |
| new Content Object locator | `staging/canonical/018f22e2-7c15-7b2e-8d86-2de956a9d291`（合成命名；实际服务以 storage readback 为权威） |
| new Revision ref | `ArtifactRevision/018f22e2-7c15-7b2e-8d86-2de956a9d282`，content hash 为 `3beefae4fe0624d7fa723d86cbbece0fb9bdabb76b5ab0a298db14ce28e565d1` |
| new Revision | 单 Parent，parent 为上述 exact base Revision |
| byte length | `1252` |
| algorithm | `SHA-256` |
| digest | `3beefae4fe0624d7fa723d86cbbece0fb9bdabb76b5ab0a298db14ce28e565d1` |
| changedUnits | `[`introduction`]` |

Base Revision 的 bytes/hash/Parent 和治理事实不可改写；after Revision 的 object locator、FROZEN manifest 和 Revision snapshot 必须互相匹配。

## 4. Before/after Diff

内部 Diff 的输入只能是两个 exact Revision Ref，并由各自 FROZEN Content Object 的 authoritative readback 重建。该结果不保存为 Diff Result、Outbox、Receipt 或其他业务事实。

```json
{
  "documentId": "018f22e2-7c15-7b2e-8d86-2de956a9d221",
  "documentChanged": false,
  "entries": [
    {
      "kind": "CHANGED",
      "unitId": "introduction"
    }
  ]
}
```

重复使用相同两个 exact Revision Ref，必须得到相同的 bytes、hash 和 Diff entries；不允许按当前 head、时间、随机数或存储路径产生不同结果。只调整 sibling ordinal/parent 的场景应产生 `MOVED`，不应把未修改 Unit 提升为 whole-document replacement；同一 Unit 同时改内容和位置时允许同时产生 `CHANGED` 与 `MOVED`。

## 5. 必须拒绝的输入

| 输入 | 预期错误/结果 | 副作用边界 |
|---|---|---|
| `principalKind=AGENT` | `ARTIFACT_HUMAN_ONLY_DENIED` | 不 Stage、Link、Freeze、不创建 Revision |
| Envelope principal 与 trusted Context 不一致 | `COMMAND_CONTEXT_MISMATCH` | 不创建业务事实 |
| base hash 改为全 `f` | `ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID` | Revision 行数不增加 |
| base ref 使用 `latest`/`current` 或跨 Project | `ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID` 或 Scope 拒绝 | 不回退读取当前 Revision |
| 修改 `introduction` 但 allow-list 只有 `control-table` | `ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE` | Stage 前拒绝 |
| allow-list 为空、重复或含未知 Unit | `ARTIFACT_STRUCTURED_DOCUMENT_EDIT_SCOPE` | 不创建 Content Object/Revision |
| Branch head 已指向另一 exact Revision | `ARTIFACT_STRUCTURED_DOCUMENT_BASE_STALE` | base 与历史不变 |
| 候选与 base Canonical Document 无任何变化 | `ARTIFACT_STRUCTURED_DOCUMENT_NOOP` | 不创建新 Revision |
| Document ID/title/metadata/schemaRef 被修改 | identity/scope/edit scope 拒绝 | 不创建新 Revision |

## 6. 自动证据与人工边界

| 检查 | 结果 |
|---|---|
| Unit/Hash canonicalization 与乱序输入等价 | `PASS`：`structured-document-service.test.ts` |
| hierarchy、closed Unit type、duplicate ID、cross-Scope evidence | `PASS`：`structured-document-service.test.ts` |
| Added/Removed/Changed/Moved deterministic Diff | `PASS`：`structured-document-service.test.ts` |
| Real PostgreSQL Human Edit、base immutability、exact Diff replay、negative cases | `PASS`：`tests/persistence/artifact-structured-document.test.ts`，包含 pinned PostgreSQL 18.6/Flyway 11.20.3 gate |
| Format/Lint/Typecheck/全量 Unit/Architecture/Contract | `PASS`：全量静态门禁与 30 files / 380 passed |
| Disposable PostgreSQL 全量 persistence | `PASS`：26 files / 280 passed；空库迁移与第二次 migrate no-op；容器已清理 |
| 独立人工业务验收 | `NOT RUN`：本夹具仅供用户复核，不能代替真实业务政策验收 |
| Provider、生产数据库、公开 HTTP、跨模块 E2E、Renderer、Quality/Approval/Release | `NOT RUN` |

## 7. 清理

本次自动验证使用的 PostgreSQL 容器已由 gate 自动移除；未创建临时测试脚本或测试文件。该 Markdown 夹具属于 `/.vibe` 的 Git 交付审计材料，应随 Issue-95 变更保留，不能作为运行时业务事实。
