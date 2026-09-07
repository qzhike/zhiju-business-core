> Relocated decision record. Technical constraints retain their original authority; old implementation/acceptance statuses are historical and do not describe current delivery.
> Source: [.vibe/issue-57-enterpriseproject/Contract-Decision-Matrix.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-57-enterpriseproject/Contract-Decision-Matrix.md).

# IM-03 WI-01 EnterpriseProject 公共能力与实施决策

版本：v0.1
日期：2026-08-25
状态：`DESIGN DECIDED / USER REVIEWED BASELINE / IM-03 WI-08 IMPLEMENTATION VERIFIED / ISSUE #64 CLOSEOUT PENDING`

## 1. 目标与结论

本文件是 Issue #57 的设计决策记录，补齐 IM-03 业务切片开始前的前置对象产生路径、版本语义、授权目的、失败码和验证边界。

本轮结论：

1. 现有 32 个 EnterpriseProject `@1.0` Contract 保持不变，继续作为跨模块公开 Contract Catalog 的边界。
2. Product、QMSConfiguration、EnterpriseProfileSnapshot、ProductScopeSnapshot 和平台 Template/Regulatory Reference 使用 EnterpriseProject Owner 提供的受控 Application Capability。它们不是测试、Migration 或跨 Schema Join 的写入口，也暂不进入 200 项公开 Catalog。
3. 受控 Capability 的逻辑输入、输出、授权目的和错误码在本文冻结；后续若需要跨模块公开，必须另行把它们提升为 `@1.0` Command/Query/Event，并同步 Schema、生成类型、Catalog、兼容性 baseline 和负向 Fixture。
4. 业务 DDL、Repository、Handler、Evaluator 和真实 PostgreSQL 业务链不在本 Work Item 实现；IM-02 已交付的技术表只作为后续事务基础，不能作为业务对象已实现的证据。

## 2. 权威关系与范围

本文只拥有 Issue #57 的“前置对象入口与未冻结参数决策”范围。字段级公开 Contract 仍以 [`../api-contract-v0.1/API-Contract-v0.1.md`](../api-contract-v0.1/API-Contract-v0.1.md) 和 [`../module-specs/Module-Spec-002-EnterpriseProject.md`](../module-specs/Module-Spec-002-EnterpriseProject.md) 为准；现有公开名称仍以 [`../high-level-docs/06-typed-references-contract-catalog-v0.1.md`](../high-level-docs/06-typed-references-contract-catalog-v0.1.md) 为准。

本文冻结的是后续 WI-02/WI-03/WI-04/WI-08/WI-09 实现必须遵守的业务边界，不代表这些实现已经落地。

## 3. Capability 决策矩阵

| 前置对象 | 唯一 Owner | 受控 Application Capability | 写入角色/授权目的 | 版本语义 | 关键失败码 |
|---|---|---|---|---|---|
| Product 根与首个版本 | EnterpriseProject | `enterprise_product.create` | 企业业务角色；`project.product.create` | Root 与不可变 `ProductVersion` 在一个 Aggregate 事务中创建 | `PROJECT_PRODUCT_SOURCE_REQUIRED`、`PROJECT_PRODUCT_SCOPE_INVALID` |
| Product 后续版本 | EnterpriseProject | `enterprise_product.create_version` | 企业业务角色；`project.product.version.create` | 只追加新版本，不覆盖旧版本；输入必须引用上一个精确版本（首版本除外） | `PROJECT_PRODUCT_VERSION_IMMUTABLE`、`PROJECT_PRODUCT_SCOPE_MISMATCH` |
| Product 当前版本/回滚 | EnterpriseProject | `enterprise_product.activate_version` | Human-only；`project.product.version.activate` | `ACTIVATE` 和 `ROLLBACK` 都只把当前指针移动到已存在的精确版本；不复制、不改写版本 | `PROJECT_PRODUCT_ACTIVATION_HUMAN_REQUIRED`、`PROJECT_PRODUCT_VERSION_NOT_FOUND` |
| Product Scope Snapshot | EnterpriseProject | `enterprise_product.create_scope_snapshot` | 企业业务角色；`project.product_scope.snapshot.create` | 由精确 ProductVersion 集合生成不可变 Snapshot；Project 只保存 SnapshotRef | `PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID`、`PROJECT_PRODUCT_VERSION_NOT_FOUND` |
| QMSConfiguration Revision | EnterpriseProject | `enterprise_qms.create_revision` | 企业业务角色；`project.qms.revision.create` | Revision 不可变；包含适用性、管理选择和专业决定三类结构化条目 | `PROJECT_QMS_DECISION_SOURCE_REQUIRED`、`PROJECT_QMS_REVISION_IMMUTABLE` |
| QMSConfiguration 当前版本/回滚 | EnterpriseProject | `enterprise_qms.activate_revision` | Human-only；`project.qms.revision.activate` | `activationMode=ACTIVATE|ROLLBACK`；只能指向同一 Enterprise 已存在的精确 Revision | `PROJECT_QMS_ACTIVATION_HUMAN_REQUIRED`、`PROJECT_QMS_VERSION_NOT_FOUND` |
| EnterpriseProfileSnapshot | EnterpriseProject | `enterprise_profile.create_snapshot` | 企业业务角色；`project.enterprise_profile.snapshot.create` | 应用层从精确 Fact、ProductVersion、QMSConfigurationVersion 生成；调用者不能提交自由 Profile Payload | `PROJECT_PROFILE_SOURCE_MISMATCH`、`PROJECT_PROFILE_SNAPSHOT_IMMUTABLE` |
| Platform Template Reference | EnterpriseProject 的 Platform Reference Owner | `platform_template.import_version` / `platform_template.publish_version` | 仅平台 Reference Admin/Publisher；`project.platform_template.import` / `project.platform_template.publish` | Import 形成草稿版本；Publish 后版本不可变，Current 指针变化不影响已冻结 Project | `PROJECT_PLATFORM_REFERENCE_UNPUBLISHED`、`PROJECT_PLATFORM_REFERENCE_HASH_MISMATCH` |
| Platform Regulatory Reference | EnterpriseProject 的 Platform Reference Owner | `platform_regulatory.import_version` / `platform_regulatory.publish_version` | 仅平台 Reference Admin/Publisher；`project.platform_regulatory.import` / `project.platform_regulatory.publish` | 保留 authority、jurisdiction、effective period 和验证记录；发布后只追加版本 | `PROJECT_PLATFORM_REGULATORY_SOURCE_REQUIRED`、`PROJECT_PLATFORM_REFERENCE_UNPUBLISHED` |

平台 Capability 没有 Enterprise Scope；Enterprise Runtime Role 不能调用平台写入口。平台参考只允许以精确 `ContentAddressedRef` 进入 Project TemplateBaseline/RegulatoryProfile，不能被解释为客户 Evidence。

## 4. Product v0.1 最小结构

Product 不是一个自由文本字段。Root 只保存稳定身份和当前版本指针；业务内容进入不可变 ProductVersion：

```text
Product
├── productId
├── enterpriseId
├── displayCode
├── status: ACTIVE | SUSPENDED | ARCHIVED
├── currentVersionId?
└── aggregateVersion

ProductVersion
├── productId
├── versionId
├── productType: NamespaceCode
├── displayName: NonEmptyString
├── intendedUse: NonEmptyString
├── productScope
│   ├── productFamily: NonEmptyString
│   ├── variants: NonEmptySet<NonEmptyString>
│   └── markets: NonEmptySet<NamespaceCode>
├── sourceRefs: NonEmptySet<TypedReference>
├── payloadHash
└── createdAt
```

`productScope` 是 Project 启动时生成 `ProductScopeSnapshot` 的唯一业务输入。任何版本被引用后不得更新；产品名称、用途或范围变化必须创建新版本并经过当前指针激活/回滚决策。

## 5. QMSConfiguration 版本与回滚

每个 QMSConfiguration Revision 至少包含以下三组结构化决定：

- `applicabilityDecisions`：`requirementRef`、`outcome`、`rationale`、`evidenceRefs`；`outcome` 为 `APPLICABLE`、`NOT_APPLICABLE` 或 `PENDING_DETERMINATION`。
- `managementChoices`：`choiceKey`、`selectedOption`、`rationale`、`decisionRef`。
- `professionalDecisions`：`decisionType`、`outcome`、`rationale`、`evidenceRefs`。

三组条目必须有来源或明确 Human Decision；Agent 可以提议，不能代替 Human 激活高风险适用性或管理决定。回滚不是修改旧 Revision，也不是复制一个“当前版本”，而是以 `activationMode=ROLLBACK` 将同一 Enterprise 的 current pointer 指向已经存在的精确 Revision，并保留新的激活审计事实。

## 6. Profile 与 ProjectStartSnapshot

`enterprise_profile.create_snapshot` 只接收并校验以下精确输入：

- Enterprise ObjectRef；
- EnterpriseFact 的精确 VersionedRef 集合；
- Product 的精确 ProductVersionRef 集合；
- 已激活的 QMSConfigurationVersionRef；
- purpose 和 source watermark。

Profile Payload 由 EnterpriseProject Application 层根据上述输入生成并计算 Hash，不能由调用者传入任意 CanonicalJson。Snapshot 创建后不可变，后续事实、Product 或 QMS 变化只允许产生新 Snapshot。

`project.create_project@1.0` 的 `startSnapshot` 必须包含以下三个字段，且三者的 Enterprise Scope 一致：

```text
enterpriseProfileSnapshotRef: SnapshotRef<EnterpriseProfile>
qmsConfigurationRef: VersionedRef<QMSConfiguration>
productScopeSnapshotRef: SnapshotRef<ProductScope>
```

初始 CustomerBaseline、TemplateBaseline 和 RegulatoryProfile 仍可缺省，但缺省不等于使用 `latest` 或由数据库自动填充。Project 创建后不允许迁移上述 Scope 或替换启动 Snapshot。

## 7. Platform Reference 导入与发布

Template Reference 的导入输入至少包括 `referenceCode`、`templateType`、`versionLabel`、精确内容 Hash、来源和 applicability；Regulatory Reference 还必须包括 `authority`、`jurisdiction`、`citation`、`effectivePeriod` 和 verification refs。

导入只创建未发布草稿；发布必须引用同一对象的精确版本、发布决定和理由。发布后的版本不可变，平台 Current 指针变化不会重写已有 Project 的 TemplateBaseline 或 RegulatoryProfile。以下路径均被拒绝：

- Project/Enterprise Runtime Role 直接写 Platform Reference 表；
- 选择未发布版本、`latest` 或只带 display label 的引用；
- objectId 相同但 contentHash 不同；
- 用 Template Reference 替代 Regulatory EvidenceRef；
- 在 Enterprise Scope 下伪造一个 Platform Reference。

## 8. Gap stale / impact 最小 Policy

GapAnalysis 的 InputSnapshot 已保存 CustomerBaseline、TemplateBaseline、RegulatoryProfile、EnterpriseProfileSnapshot、QMSConfiguration、ProductScopeSnapshot 和 AnalysisPolicy 的精确引用。以下任一事实发生变化时，旧 Gap 必须进入 `STALE` 或建立等价的 Impact Review 待处理状态：

1. 输入版本被替换、撤回、失效或 Hash 校验失败；
2. 其来源的有效期/适用范围变化；
3. 已确认的企业事实、Product Scope 或 QMS 决定产生新版本。

处理规则：

- 旧 GapVersion、InputSnapshot、旧 Context 和已批准 DeliveryPlan 不原地改写；
- Process Manager 追加带 `oldRef`、`newRef`、reason code 和影响对象的 Impact Review；
- Gap 可以标记 `STALE`，但不会自动变成 `MISSING`、自动接受、自动撤销 DeliveryPlan 或自动完成重算；
- 只有 Human 对影响复核作出明确决定后，才允许创建新的 Gap/Plan 输入；
- `NOT_PROVIDED`、`UNKNOWN`、`MISSING_CONFIRMED` 三种认知状态保持区分。

## 9. IM-05 Reference 边界

IM-03 只保存和验证 `QualityProfile`、`EvidenceRef` 等跨模块强引用的形状、强度、Scope、Version/Hash、生命周期和 purpose：

- DeliveryItem 的 `qualityProfileRef` 仍是 `VersionedRef<QualityProfile>`；高风险 Item 缺失时拒绝批准或激活；
- `EvidenceRef` 必须指向精确的 ContentAddressedRef，并保留 relation、claim locator/hash 和适用 Scope；
- EnterpriseProject 不复制 QualityProfile/Evidence 正文，不跨 Schema Join，也不通过测试或 Migration 造假目标行；
- IM-05 未实现时，引用可在 Contract/Reference Validation 层保持 `NOT RUN`，不得报告业务 `PASS`。

## 10. 受控 Capability 的逻辑示例

以下是用户手测和后续 WI-03 Handler 的逻辑示例，不是当前 200 项 Registry Fixture，也不能直接作为数据库写入脚本：

```text
enterprise_product.create
  input: displayCode + ProductVersion(productType, displayName, intendedUse,
         productScope, sourceRefs)
  output: ProductRef + ProductVersionRef
  expected: root/version 同事务创建，version immutable

enterprise_qms.activate_revision
  input: qmsConfigurationVersionRef + activationMode=ROLLBACK + humanDecisionRef
  output: new current-pointer audit fact
  expected: pointer 指向已存在精确版本，旧 Revision 不变

enterprise_profile.create_snapshot
  input: enterpriseRef + factRefs + productVersionRefs + qmsConfigurationRef
  output: SnapshotRef<EnterpriseProfile>
  expected: payload 由 Application 层生成，Hash 可重放

project.create_project@1.0
  input.startSnapshot:
    enterpriseProfileSnapshotRef + qmsConfigurationRef + productScopeSnapshotRef
  expected: 三个 Ref 同 Enterprise；缺任一或 scope 不同即
            PROJECT_START_SNAPSHOT_INCOMPLETE / PROJECT_REFERENCE_SCOPE_MISMATCH
```

## 11. 替代方案与后续升级门

| 方案 | 结果 | 决策 |
|---|---|---|
| 现在把上述 Capability 全部加入公共 `@1.0` Catalog | 会扩大冻结 baseline，并要求一次性维护字段 Schema、类型、Catalog、兼容性审批和负向 Fixture；目前没有用户审核后的公共名称 | 暂不采用 |
| 让测试/Migration 直接插入 Product/QMS/Profile/Platform 行 | 没有 Application 授权、审计、版本和失败边界，后续 E2E 会被假数据污染 | 明确禁止 |
| EnterpriseProject 提供受控 Application Capability，后续按实际跨模块需求逐项公开 | 保持当前 200 项公共 Contract 稳定，同时为 WI-02/WI-03 提供唯一 Owner 和可审计入口 | 采用 |

若未来需要公开化，必须新建经用户批准的 Contract Decision，并至少同步：`Module-Spec-002` 字段表、可执行 Schema、Schema-derived Type、`06` Catalog、operation metadata、v1.0 additive baseline/compatibility approval、正/负 Fixture 和 Module Test。没有这些同步，不得把受控 Capability 写成公共 `@1.0` Contract。

## 12. 状态与验收边界

- 设计：`DESIGN VERIFIED / USER REVIEW REQUIRED`；本文为本 Issue 的决策记录。
- 现有 Contract Gate：继续验证既有 200 项 Catalog，不证明受控 Capability 的业务实现。
- 业务实现：Product/QMS/Profile/Platform Reference/Project Handler/Repository/业务 DDL `NOT RUN`。
- IM-02 技术基础：EnterpriseProject 标准技术表、RLS、Receipt、Outbox、Audit 和 Reference Edge 已有独立验证记录，但不能提升为本 Issue 的业务 `PASS`。
- 手工验收：用户应审阅本矩阵、拒绝的替代项和 ProjectStartSnapshot 示例；后续 WI-03/WI-04 提供真实 Handler/数据库输出。

## 13. WI-08 实现收敛记录

Issue #64 复用本矩阵的 Platform Reference 入口：Template/Regulatory 业务表不带 Enterprise Scope，导入为 DRAFT、发布为不可变 PUBLISHED，Project 只保存精确 ContentAddressedRef。实现增加独立 writer role 与保留技术 Scope；该技术 Scope 不进入平台业务行。

TemplateBaseline/RegulatoryProfile 的 Project Root 使用 expected aggregate version CAS，Version 与条目 INSERT-only；可信 Human 才能执行冻结/激活。Regulatory EvidenceRef 必须独立于 Template/Regulatory Reference，Applicability 按当前三值 Contract 闭集执行。以下仍是实现后的验证门：真实 PostgreSQL RLS/CHECK/CAS/幂等/回滚、普通 app 与 writer 权限边界、旧 Project exact ref 在 Platform current pointer 变化后的稳定性，以及受控 E2E。
