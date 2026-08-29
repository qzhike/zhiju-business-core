# Issue #96 合成 WorkbookSpec 检查材料

状态：`SYNTHETIC / TECHNICAL ONLY`

本材料是 WI-07 自动回归产生的可人工检查输出，不是客户 Workbook，也不表示独立 Human acceptance 已执行。Excel 计算、宏、外部链接、透视表、XLSX 版式、Renderer、Quality/Approval/Release、Provider、公开 HTTP、生产和真实业务适用性均为 `NOT RUN`。

## 1. Fixture 与精确 Hash

基础输入：`tests/fixtures/contracts/canonical-content/workbook-golden.json`

| 版本 | Cell 变化 | SHA-256 |
|---|---|---|
| Base | `supplier-row-2-amount.value = 3` | `e3e0f7357a3fcd6c18063081128913b0cd8983e75d6455d4aa6664284f30a818` |
| Candidate | `supplier-row-2-amount.value = 4` | `7a842edeee6c69a0388f78dec266f4aab42b5de9ee4d32b830926de498ceacb5` |

Candidate 的精确 canonical bytes 为：

```json
{"body":{"metadata":{"locale":"en-US","revisionLabel":"golden-1"},"sheets":[{"columns":[{"columnId":"supplier","name":"Supplier","ordinal":0,"valueType":"text"},{"columnId":"amount","name":"Amount","ordinal":1,"valueType":"number"},{"columnId":"total","name":"Total","ordinal":2,"valueType":"number"}],"crossRecordRules":[{"columnId":"supplier","rule":"unique"}],"name":"Suppliers","ordinal":0,"rows":[{"cells":[{"cellId":"supplier-row-1-name","columnId":"supplier","value":"Acme","valueType":"text"},{"cellId":"supplier-row-1-amount","columnId":"amount","value":2,"valueType":"number"},{"cellId":"supplier-row-1-total","columnId":"total","formula":"=SUM(amount)","value":2,"valueType":"number"}],"ordinal":0,"rowId":"supplier-row-1"},{"cells":[{"cellId":"supplier-row-2-name","columnId":"supplier","value":"Beta","valueType":"text"},{"cellId":"supplier-row-2-amount","columnId":"amount","value":4,"valueType":"number"},{"cellId":"supplier-row-2-total","columnId":"total","formula":"=SUM(amount)","value":3,"valueType":"number"}],"ordinal":1,"rowId":"supplier-row-2"}],"sheetId":"supplier-sheet","validationRules":[{"columnId":"supplier","rule":"required"}]}],"workbookId":"018f22e2-7c15-7b2e-8d86-2de956a9d261"},"canonicalizationVersion":"1","contentType":"WORKBOOK_SPEC","schemaRef":{"kind":"VERSIONED","objectId":"018f22e2-7c15-7b2e-8d86-2de956a9d241","objectType":"artifact.workbook_spec_schema","scope":{"enterpriseId":"018f22e2-7c15-7b2e-8d86-2de956a9d201","projectId":"018f22e2-7c15-7b2e-8d86-2de956a9d202"},"versionId":"018f22e2-7c15-7b2e-8d86-2de956a9d251"}}
```

数组物理顺序反转但 ordinal/stable IDs/内容不变时，canonical bytes 与 Hash 均保持不变；该断言由 `workbook-service.test.ts` 直接覆盖。

## 2. Stable ID Map

| 层级 | Stable ID | 父级 | ordinal / Column |
|---|---|---|---|
| Workbook | `018f22e2-7c15-7b2e-8d86-2de956a9d261` | — | — |
| Sheet | `supplier-sheet` | Workbook | `0` |
| Column | `supplier` | `supplier-sheet` | `0` |
| Column | `amount` | `supplier-sheet` | `1` |
| Column | `total` | `supplier-sheet` | `2` |
| Row | `supplier-row-1` | `supplier-sheet` | `0` |
| Row | `supplier-row-2` | `supplier-sheet` | `1` |
| Cell | `supplier-row-2-amount` | `supplier-sheet / supplier-row-2` | `amount` |

`A1`、`B2` 等 Excel 坐标被测试为非法 stable business ID；公式中的坐标、`Sheet!A1` 和 `[book]A1` 同样稳定拒绝。

## 3. 允许的 Human Cell Edit

显式 allowed ref：

```json
{
  "kind": "CELL",
  "sheetId": "supplier-sheet",
  "rowId": "supplier-row-2",
  "cellId": "supplier-row-2-amount"
}
```

输入变化：`value: 3 -> 4`；Column 声明和 Cell 声明均为 `valueType=number`。真实 PostgreSQL 回归的实际输出为：

- 新 Content Object 完成 `STAGING -> LINKED -> FROZEN`；
- 新 Revision 的 `revisionNumber=2`，唯一 Parent 是 base exact RevisionRef；
- base Revision Snapshot 再次读取与变更前完全一致；
- 同一外层 command replay 返回相同对象、Revision、Hash 和 Diff，Artifact 的 Revision 行数保持 2；
- 相同 idempotency key 配不同 payload 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT`，Revision 行数仍保持 2。

Human Edit 创建不可变候选 Revision，不隐式推进 Branch Head；调用方须使用既有 `artifact.move_working_head@1.0` 以 exact expected head/version 单独执行 CAS。

## 4. 拒绝的跨 Sheet 引用

负向输入把 `supplier-row-2-amount.columnId` 改为当前 Sheet 不存在的 `other-sheet-column`。实际结果：

```text
ARTIFACT_WORKBOOK_SCHEMA_INVALID
```

拒绝发生在新 Content Object/Revision 创建之前，Revision 行数不变。相同 Gate 还覆盖 Agent、wrong hash、错误/重复/未知 allowed ref、未授权 Cell、canonical no-op、stale Branch Head 和 authoritative bytes tamper。

## 5. Before / After 与确定性 Diff

| 字段 | Base | Candidate |
|---|---|---|
| content hash | `e3e0f735...30a818` | `7a842ede...eacb5` |
| Revision | persistence fixture runtime UUIDv7 / revision 1 | persistence fixture runtime UUIDv7 / revision 2 |
| Parent | `[]` | `[base exact RevisionRef]` |
| Branch Head | base exact RevisionRef | 仍为 base，候选可由显式 CAS 前进 |

精确 Diff 输出：

| kind | entityType | stableId | stablePath | from / to |
|---|---|---|---|---|
| `CHANGED` | `CELL` | `supplier-row-2-amount` | `sheet/supplier-sheet/row/supplier-row-2/cell/supplier-row-2-amount` | `supplier-sheet / supplier-row-2 / amount` 均保持不变 |

同一 before/after exact refs 连续读取两次，Diff 深比较相等；Diff 未写入业务表、未新增公开 Operation/Event，也未形成 Quality/Approval 事实。

## 6. Cleanup

- `pnpm persistence:gate` 使用 disposable PostgreSQL 容器；最终输出为 `postgres container removed`。
- 第二次 Flyway migrate 输出 `Schema "public" is up to date. No migration necessary.`。
- 未创建临时 SQL、测试脚本、测试数据库文件或持久化测试容器。
- 独立人工复核本材料：`NOT RUN`。
