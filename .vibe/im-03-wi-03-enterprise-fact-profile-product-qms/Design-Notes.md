# IM-03 WI-03 Design Notes

对应 Issue: #59

## 目标与边界

本切片把 WI-01 决策矩阵冻结的受控 Application Capability 与 4 个公开 Contract 落到 V2001 业务表 + Application/Persistence Handler，复用 WI-02 的事务基础。

## 实现要点

1. **事务基础复用**：`executeEnterpriseProjectCommand` + `withEnterpriseProjectTransaction` + RLS Context 绑定保持 WI-02 不变；业务 Aggregate Root 拥有自己的 `aggregate_version` 列，CAS 直接作用在 Root，不再借道 `process_instance`。

2. **业务表 schema 选择**：根表 (`enterprise` / `enterprise_fact` / `product` / `qms_configuration`) + 不可变 version/snapshot 表 (`enterprise_fact_version` / `enterprise_profile_snapshot` / `product_version` / `product_scope_snapshot` / `qms_configuration_revision`)。所有 version/snapshot 行通过 REVOKE UPDATE + BEFORE UPDATE trigger 保证不可变。

3. **active/current 指针模型**：Product 用 `product_version.lifecycle ∈ {CURRENT, HISTORICAL}` + partial unique index `(product_id) WHERE lifecycle='CURRENT'`；QMS 同上。Profile Snapshot 与 Product Scope Snapshot 没有 active 指针，它们由 Project 启动引用精确 ID。

4. **Human-only 边界**：`project.confirm_enterprise_fact`、`enterprise_product.activate_version`、`enterprise_qms.activate_revision` 通过受信 transaction context 与 Command Envelope 中一致且必填的 `principalKind` 判定；缺失或非 HUMAN 均抛出 `PROJECT_HUMAN_ONLY_DENIED`。高风险 Fact 的真实 Evidence 来源仍由调用方在 payload 中声明，Agent 不能单方面跳过 Human 决定。

5. **跨 Enterprise Ref 拒绝**：Profile Snapshot Handler 在冻结前逐一解析 fact / product / qms Ref，并校验它们所属 enterprise 与目标 enterprise 一致；任何不一致以 `PROJECT_PROFILE_SOURCE_MISMATCH` 拒绝。

6. **重复激活**：`enterprise_product.activate_version` 与 `enterprise_qms.activate_revision` 在 Application 层判定 "current pointer 已经指向目标" 时分别返回 `PROJECT_PRODUCT_ACTIVATION_NOOP` / `PROJECT_QMS_ACTIVATION_NOOP`，再叠加 V2001 partial unique index 的 DB 防御。

7. **精确引用与版本连续性**：所有业务 Handler 必须校验强引用的 objectType、objectId、version/snapshotId、Scope 和 contentHash；新增版本或状态转换必须推进 Root `aggregate_version`，并使用与 Receipt/Outbox 相同的连续事件版本。首次创建以 Root version 1 和合法 NULL current pointer 开始，不得使用伪造占位 UUID。

8. **公开契约边界**：4 个公开 Handler 的输入输出直接复用生成的 EnterpriseProject Contract 类型；内部业务 payload 可以扩展，但不得以扁平引用、自由值对象或额外 query result 字段替代公开 Schema。

7. **公开 Catalog 不变**：受控 Capability 不进入 `contracts/registry/public-api.v1.json`；Module Spec 在 §8.1 已声明。

## 不变量

- Enterprise ID 不从名称派生；`enterprise.display_code` `UNIQUE`。
- Scope 不可迁移；触发器在 `enterprise_fact_version` / `product_version` / `qms_configuration_revision` 上拒绝 `enterprise_id` / `product_id` / `qms_configuration_id` 变更。
- `enterprise_fact_version.value` / `source_refs` / `payload_hash` 不可 UPDATE；只能通过新 versionNo 追加。
- `enterprise_profile_snapshot` / `product_scope_snapshot` 不可 UPDATE / DELETE（应用层 revoke + trigger 双重保险）。
- `project.confirm_enterprise_fact` 必须 Human 主体；Agent/actingFor 路径以 `PROJECT_HUMAN_ONLY_DENIED` 拒绝。
- 跨 Enterprise fact/product/qms Ref 在 Profile 冻结时拒绝。

## 与 WI-02 的边界

- WI-02 仍负责：RLS Context、`withEnterpriseProjectTransaction`、Receipt/Audit/Outbox/Reference Edge、`process_instance` 技术 CAS、`ENTERPRISE_*` / `COMMAND_*` / `PAYLOAD_HASH_MISMATCH` 失败码。
- 本切片只新增：业务 DDL（V2001）、业务 Repository、业务 Handler 与 19 个 WI-03 业务失败码；审查修正继续保持受控 Capability 不进入公开 Catalog。

## 失败码

```
PROJECT_ENTERPRISE_NOT_ACTIVE
PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT    # NEW
PROJECT_PRODUCT_DISPLAY_CODE_CONFLICT       # NEW
PROJECT_FACT_SOURCE_REQUIRED
PROJECT_FACT_CONFIRMATION_FORBIDDEN
PROJECT_FACT_CONFLICT_UNRESOLVED
PROJECT_PROFILE_SOURCE_MISMATCH             # NEW
PROJECT_PROFILE_SNAPSHOT_IMMUTABLE          # NEW
PROJECT_PRODUCT_VERSION_NOT_FOUND           # NEW
PROJECT_PRODUCT_VERSION_IMMUTABLE           # NEW
PROJECT_PRODUCT_ACTIVATION_HUMAN_REQUIRED   # NEW
PROJECT_PRODUCT_ACTIVATION_NOOP             # NEW
PROJECT_PRODUCT_SCOPE_SNAPSHOT_INVALID      # NEW
PROJECT_QMS_DECISION_SOURCE_REQUIRED        # NEW
PROJECT_QMS_REVISION_IMMUTABLE              # NEW
PROJECT_QMS_ACTIVATION_HUMAN_REQUIRED       # NEW
PROJECT_QMS_VERSION_NOT_FOUND               # NEW
PROJECT_QMS_ACTIVATION_NOOP                 # NEW
PROJECT_HUMAN_ONLY_DENIED                   # NEW
```

WI-02 失败码继续保留：IDEMPOTENCY_PAYLOAD_CONFLICT、CONCURRENCY_CONFLICT、COMMAND_*、PAYLOAD_HASH_MISMATCH。
