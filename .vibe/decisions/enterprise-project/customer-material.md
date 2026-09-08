> Design provenance: [62](https://github.com/qzhike/zhiju-business-core/issues/62). Preserved implementation design supplement; repository-wide authority still follows HL-Spec. Historical Catalog counts, readiness, temporary technical stand-ins and delivery authorization describe the original slice, not current execution instructions. Moving this document does not approve new behavior.

# IM-03 WI-06 CustomerMaterial 设计决策

## 1. 适用范围

本切片只实现 EnterpriseProject 内 CustomerMaterial 的最小闭环：从已接受的 SourceMaterial 提议业务分类，使用 Human 命令确认一个不可变版本，并把确认事实写入同一事务的 Receipt、Audit、Reference Edge 和 Outbox。它不实现 OCR、LLM/Provider、Evidence 验证、CustomerBaseline、公开 HTTP 或真实 Feishu/Ceph/OpenBao。

公共 Contract 已存在，因此不扩展 200 项 Catalog，也不修改 `contracts/src/operations/enterprise-project.schema.ts` 的字段。

## 2. 版本与状态决策

1. `project.propose_customer_material@1.0` 为每次分类提议创建一个新的 CustomerMaterial Root 和 v1 `PROPOSED` Version。多个提议可以引用同一个 SourceMaterial，以保留不同解析/分类候选。
2. `project.confirm_customer_material@1.0` 不把候选 v1 原地改成 CONFIRMED，而是追加 v2 `CONFIRMED` Version，保留候选 v1 的完整历史；Root 使用 CAS 从 aggregate version 1 推进到 2，并指向 v2。
3. CustomerMaterial Root 的 `classification_status` 只允许数据库闭集状态；本切片只产生 `PROPOSED` 和 `CONFIRMED`。`declared_status` 保留 Contract 传入的非空业务状态字符串，不能替代分类状态或完整性状态。
4. 当前没有低风险自动确认 Policy 输入，所以全部确认命令执行 Human-only 检查。Agent 可提议，不能确认；`actingFor` 不会改变可信 `principalKind`。

## 3. Source 与 Evidence 边界

- 每个 `MaterialSourceSelection` 必须是同一 Enterprise/Project 下精确的 `CONTENT_ADDRESSED SourceMaterial` 引用，ContentHash 必须与数据库 Root 一致，且 Root 必须处于 `ACCEPTED`；SourceMaterial 当前不发布业务 `immutableVersionId`，携带该字段必须拒绝。
- `locator` 只表示源材料内部的页码/章节等定位信息；SourceMaterial 的 accepted object locator 仍留在 SourceMaterial 受控记录中，不复制到 CustomerMaterial Event，也不把两种 locator 混为同一校验字段。
- `evidenceRefs` 与 `justification.evidenceRefs` 必须带当前 Enterprise/Project Scope 和合法 SHA-256/1 ContentHash；确认决定和所有来源/证据通过不可变 `customer_material_decision` 与 Reference Edge 追溯。

## 4. 冲突决策

确认前读取当前 Project 中所有 CustomerMaterial Proposal。若另一项 `PROPOSED` 当前版本与本候选共享 SourceMaterial，且业务分类指纹（类型、标题、客户文档号/版本号、生效日期、完整性、语言及规范化 Source Selection）不同，则返回 `PROJECT_MATERIAL_CONFLICT_UNRESOLVED`。不修改另一 Aggregate、不选择最后写入者、不产生确认 Event；后续解决流程留给后续 Work Item/受控命令。

## 5. 数据表

`V2007__customer_material_proposal_confirmation.sql` 新增三张 Project-owned 表：

- `customer_material`：Scope、分类镜像、Root 状态、当前 Version 指针和 aggregate version；仅开放受控 Root 状态/指针更新。
- `customer_material_version`：每个提议/确认的不可变业务 Version，保存分类字段、完整性、来源选择、理由和 payload hash。
- `customer_material_decision`：不可变提议/确认决定，保存 actor、authorization decision、evidence、justification 和 payload hash；不保存客户原文。

三表均 FORCE RLS；Version/Decision 撤销 app role 的 UPDATE/DELETE；Root 的 Scope/创建字段由 trigger 保护。所有 Project-owned 行使用 `context_allows_project(enterprise_id, project_id)`。

## 6. 事务顺序

提议：

```text
validate project + accepted source refs
  → claim receipt
  → insert customer_material root + v1 + source edges
  → audit/result receipt
  → commit
```

确认：

```text
Human-only + exact candidate/current pointer + source/evidence validation
  → claim receipt
  → reject unresolved classification conflict, or insert v2 + decision
  → CAS root + append source/evidence/decision edges
  → append minimal CustomerMaterialConfirmed outbox event
  → audit/result receipt
  → commit
```

任何业务拒绝都由统一 Command Runner 保存 `REJECTED` Receipt 和安全 Audit；CAS 冲突不使用 last-write-wins。Event 只包含精确 CustomerMaterial Version Ref、Project Ref、materialType、completeness 和 confirmation decision Ref，并带技术存储所需的 promoted Scope，不复制标题、客户版本号、原文、Source locator 或 Evidence 内容。
