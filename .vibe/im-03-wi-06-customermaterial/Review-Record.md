# IM-03 WI-06 CustomerMaterial 提交前审查记录

## 1. 审查范围与结论

- Issue：[#62](https://github.com/qzhike/zhiju-business-core/issues/62)
- 分支：`galendai/im-03-wi-06-customermaterial`
- 审查基线：`6f1cd4a`，与当前 `origin/main` 同步
- 审查日期：2026-08-26
- 当前远端状态：没有为本分支创建 PR；Issue #62 仍为 `OPEN`

审查结论：WI-06 的代码、数据库迁移、模块测试和设计文档在当前 Worktree 内形成一致的最小闭环，静态检查、Contract 检查、架构检查和 Disposable PostgreSQL 验证均通过。提交、推送、PR exact-head 审查、合并、Issue 关闭、远端分支删除和默认分支同步仍是独立交付步骤，等待用户检查并确认后执行。

## 2. 验收条件映射

| Issue 验收条件 | 实现与证据 | 结论 |
|---|---|---|
| 未接受、跨 Project、hash/locator 不匹配的 Source Ref 被拒绝 | Handler 校验 SourceMaterial Scope、object id、SHA-256/1 ContentHash、`ACCEPTED` 状态；当前 SourceMaterial Contract 没有业务 immutable version 或 accepted object locator 字段，Selection 的 `locator` 按源内位置保存；额外 `immutableVersionId` 明确拒绝；P-003 通过 | `PASS`（locator 语义边界已记录） |
| 同一 Source 可形成不同解析/分类版本，CONFIRMED 版本不可覆盖 | 每次提议创建独立 Root/v1；确认追加 v2，不原地更新 v1；Version/Decision 撤销 app UPDATE/DELETE；P-001/P-002/P-006 通过 | `PASS` |
| Agent/actingFor 不能确认，冲突确认不 last-write-wins | Confirmation Human-only；可信 Context 的 `principalKind` 与 envelope 一致；同 Source 不同分类指纹返回 `PROJECT_MATERIAL_CONFLICT_UNRESOLVED`；P-004/P-005 通过 | `PASS` |
| Event 只暴露精确 Material Ref、type、completeness、decision ref | 只写入 `project.CustomerMaterialConfirmed@1.0` 的五个公共字段；为 WI-02 技术表要求增加 promoted Scope，不复制标题、客户版本号、原文、ObjectLocator 或完整 Evidence；Contract 敏感字段回归通过 | `PASS` |
| 幂等、CAS、RLS、不可变约束和回滚在真实 PostgreSQL 通过 | P-002/P-006/P-007、RLS-001；V2007 空库迁移、二次 no-op、事务失败回滚和容器清理通过 | `PASS` |
| 用户可完成 Source → Proposal → Human Confirm，并看到改写拒绝 | 脱敏 Fixture 完成登记、验证、接受、提议、确认、版本链查询；已确认 Version/Decision UPDATE/DELETE 返回 PostgreSQL `42501` | `PASS`（独立人工 UI/Reference Project 验收仍未执行） |

## 3. 代码与文档变更

- `migrations/enterprise_project/V2007__customer_material_proposal_confirmation.sql`：新增 Project-owned CustomerMaterial Root、immutable Version/Decision、Scope FK、状态迁移、Root CAS 约束、FORCE RLS 和 app-role 最小写权限。
- `modules/enterprise-project/src/business/customer-material-handlers.ts`：实现 Proposal、Human-only Confirmation、精确 Source/Evidence Ref 校验、冲突拒绝、v2 版本追加、Decision、Reference Edge、Receipt/Audit 和最小确认 Event。
- `modules/enterprise-project/src/persistence/enterprise-business-repository.ts`、`enterprise-business-types.ts`、`enterprise-db.ts`：注册三张表、类型、插入/查询/CAS Repository 能力。
- `modules/enterprise-project/src/business/enterprise-business-errors.ts`、`src/index.ts`：导出 WI-06 错误码、Handler、Payload 和持久化类型。
- `tests/persistence/customer-material.test.ts`、`tests/persistence/technical-tables.test.ts`：补充真实 PostgreSQL 场景和技术表 Fixture。
- `.vibe/high-level-docs/HL-Spec.md`、`.vibe/module-specs/Module-Spec-002-EnterpriseProject.md`、`.vibe/module-tests/Module-Test-002-EnterpriseProject.md`：同步设计、字段、测试输入/预期/实际结果和 `NOT RUN` 边界。
- `.vibe/im-03-wi-06-customermaterial/Design-Notes.md`、`Task-Execution.md`、本文件：记录实现决策、执行证据和提交前审查结论。

公共 Catalog、Registry、Schema 和 Compatibility baseline 未修改；现有 `200` 项公共 Contract 保持不变。

## 4. 验证结果

| 命令 | 实际结果 |
|---|---|
| `pnpm format:check` | `PASS` |
| `pnpm lint` | `PASS` |
| `pnpm typecheck` | `PASS` |
| `pnpm test`（无 `ZJU_PERSISTENCE_DATABASE_URL`） | 22 个文件通过、13 个文件跳过；`349 passed / 211 skipped`，`PASS` |
| `pnpm architecture` | `PASS` |
| `pnpm contracts:check` | `PASS`；Catalog `200`、Registry `200`、Schema 全部 `FULL` |
| `pnpm persistence:gate` | `PASS`；PostgreSQL `18.6`、Flyway `11.20.3`；16 个 Persistence 文件、`225 passed / 0 failed`；V2007 成功应用，二次 migrate no-op，容器已清理 |
| `pnpm verify` | `PASS`；包含上述静态、测试、架构、Contract 和 PostgreSQL 门禁 |
| `git diff --check` | `PASS` |

以上结果证明当前 Worktree、受控 Handler/Repository、Migration 和 Disposable PostgreSQL 的范围。真实 Feishu/Ceph/OpenBao、Provider/OCR/LLM、公开 HTTP、跨模块 E2E、生产环境、独立人工 Reference Project 和 UI 验收均为 `NOT RUN`。

## 5. 交付状态与下一步

当前没有执行以下具有独立权限边界的操作：

1. `git commit`
2. 非强制 `git push`
3. 创建并核验本分支的 exact-head PR
4. 在 PR CI/审查通过后合并
5. 关闭 Issue #62
6. 删除远端或本地已合并分支
7. 将默认分支同步到最终合并结果

用户确认当前变更后，才进入上述 GitHub 交付流程；每一步都将读取回实际远端状态，不从 commit、PR 合并或 `Closes #62` 文案推断 Issue 已关闭。
