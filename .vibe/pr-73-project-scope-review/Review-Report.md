# PR #73 Project Scope 修复审查记录

日期：2026-08-26

## 审查基准

- PR：[#73](https://github.com/qzhike/zhiju-business-core/pull/73)
- Issue：[#60](https://github.com/qzhike/zhiju-business-core/issues/60)
- 原始 head：`412b14af1213b481e8229d9f671ee1fe57522373`
- base：`main@fd3a429588c7300eb72bb3d387bb70f060cc1a70`
- 本地分支：`galendai/60-im-03-wi-04-project-scope`

## 修复前发现

1. 远端 exact-head CI 的 `pnpm verify` 因 `enterprise-business-handlers.ts` 与 `enterprise-project-scope.test.ts` 未通过 Prettier 失败。
2. `insertProject` 使用 `(enterprise_id, display_code) ON CONFLICT DO NOTHING RETURNING project_id`。新 Project 尚未进入 allowed project 集合，PostgreSQL RLS 的 arbiter/RETURNING 读取路径会返回 `42501`。
3. `project.validate_object_scope` 忽略 `objectType`，对 Project、Binding、Enterprise Fact、Product、QMS 等表统一查询不存在的 `object_id` 列。
4. V2003 三张 Project-owned 表的 INSERT policy 没有绑定 `context_allows_enterprise(enterprise_id)`；ProjectSnapshotBinding 的 scope mirror trigger 使用了非法的 `jsonb->>'scope'->>'enterpriseId'` 路径。
5. `VersionedRef` 合约没有 `contentHash`，原 Handler 在缺失 digest 时写入全零 hash；P-005/P-009/P-010 测试还分别存在 Command Result 误判和 Enterprise scope fixture 错传。

## 修复内容

- `insertProject` 改为固定保存点 + 直接 INSERT；只捕获约束 `project_display_code_unique` 的 `23505`，不使用 `ON CONFLICT` 或 `RETURNING`，其他异常原样回滚抛出。
- 新增 V2004：三张 Project-owned 表的 INSERT policy 同时校验受信 Principal 与 `context_allows_enterprise(enterprise_id)`；member policy payload hash 改为允许 NULL，并保留 32-byte hash 校验。
- 新增 V2005：以 `jsonb->'scope'->>'enterpriseId'` 重建 ProjectSnapshotBinding scope mirror trigger。
- `project.create_project` 将 Handler 生成的 Project UUID 同时绑定到 Command Envelope 和本次 trusted transaction allowed-project 集合，使 Project、Receipt、Outbox、Reference Edge 的 Scope 一致。
- `validate_object_scope` 使用代码内闭集表/列映射，按 `objectType` 精确匹配 objectId 与 versionId/snapshotId/contentHash，并以 RLS 可见性作为最终边界；不存在或不可见对象统一返回 `PROJECT_OBJECT_SCOPE_MISMATCH`。
- canonical binding payload 省略未提供的可选 ref；member policy 缺 hash 时持久化 NULL；修正 P-005、P-003/P-009 fixture 和 P-010 缺 versionId 负向测试。

## 验证结果

- `pnpm verify`：PASS。
- Unit：21 个文件通过、13 个 skipped；348 passed、201 skipped。
- Contract：200 operations、`FULL=200`、compatibility baseline v1.0 PASS。
- Persistence：15 个测试文件、214 passed；PostgreSQL 18.6 / Flyway 11.20.3；V2004/V2005 applied；second migrate no-op；Disposable 容器已清理。
- Provider、公开 HTTP、跨模块 E2E、生产环境和人工 Reference Project 验收：`NOT RUN`。

本记录只描述当前工作区的修复和验证；PR comment、commit、push、merge、Issue close、远端 branch 删除和 main ancestry 需要后续 exact-head 交付步骤分别验证。
