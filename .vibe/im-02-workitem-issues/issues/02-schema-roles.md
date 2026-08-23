## 背景

PostgreSQL Logical Model 要求一个 Core Database、七个 owning Schema、一个可重建 `projection` Schema，并使用独立 Migration Owner、Runtime Role 和 Dispatcher Role 在数据库层阻止跨模块写入。当前这些对象和权限矩阵都没有可执行 DDL。

父追踪 Issue：#28（WI-02）。硬依赖：WI-01。

## 工作范围

- 创建 `identity_policy`、`enterprise_project`、`task_execution`、`artifact`、`quality_governance`、`release_publication`、`integration_gateway` 与 `projection` Schema。
- 为每个 owning Schema 创建 NOLOGIN Owner、受限 App Role 和受限 Dispatcher Role；创建 `projection_app`、`audit_reader`、`migration_runner`。
- 固定 `btree_gist` 与运维用 `pg_stat_statements` 的安装/权限边界，保持 `pgcrypto` 不启用。
- 配置默认权限，确保未来表/序列不会因遗漏 Grant 自动暴露；Runtime Role 不是 Owner、无 `BYPASSRLS`、默认无 DELETE/DDL/跨 Schema 权限。
- Migration runner 只能在受控 Migration 流程中切换到指定 Owner，应用进程不能获得 Owner credential。

## 验收条件

- [ ] 空库 Migration 后 Schema/Role/extension 集合与权威清单精确一致，且不存在公共 Schema 上的意外 CREATE 权限。
- [ ] 每个 App Role 只能访问本 Schema 明确授权对象；跨 Schema INSERT/UPDATE、DROP/ALTER、普通 DELETE 和 `SET ROLE <module>_owner` 均被拒绝。
- [ ] Dispatcher Role 只能 claim/update 本模块 Outbox delivery metadata，不能修改业务表或 Event payload。
- [ ] `audit_reader` 只能读取后续提供的脱敏 View，不能读取 Canonical Payload 或敏感 External ID 列。
- [ ] 权限负向测试在真实 PostgreSQL 执行，并能证明拒绝来自数据库而非应用层 mock。
- [ ] 重复 Migration、focused tests 与 `pnpm clean && pnpm verify` 通过。

## 手动验收产出

提供权限矩阵探测命令，以各类 Role 依次执行允许/禁止 SQL，并输出实际 `ALLOW`/`DENY` 与 SQLSTATE；用户无需接触生产 Secret。

## 非目标

- 不创建业务 Domain 表或七模块标准事务技术表（WI-04）。
- 不把模块化单体拆成多个数据库，也不建立跨 Schema 业务 FK/共享 Repository。
