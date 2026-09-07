> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-wi-11-query-source-slice-board-projection/Review-Record.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-wi-11-query-source-slice-board-projection/Review-Record.md).

# IM-03 WI-11 语义审查记录

- 日期：2026-08-27
- 目标：GitHub Issue #67「实现权威 Query、Source Slice 与 Board Projection」

## 审查结论

当前实现已完成本地审查、真实 PostgreSQL 语义验证和 exact-head 远端交付，未发现尚未处理的 P0/P1 级问题。结论绑定实现 commit `c8f1a2cc6291ff65824a04e437a99b660fd926aa`、PR #85 和 merge commit `43a2f4fcf074e565c10f3db54bd1be9134ef471d`。

## 审查范围

- 对照 `HL-Spec.md`、`Module-Spec-002-EnterpriseProject.md`、`Module-Test-002-EnterpriseProject.md`、WI-11 设计记录和 Issue #67 acceptance criteria 检查 Query、Source Slice、active refs、Projection、cursor、错误边界和 NOT RUN 边界。
- 检查 Contract 生成类型与 Registry/Catalog compatibility；检查模块导出、Kysely table types、Migration、RLS、权限、不可变事实和 watermark guard。
- 检查 Source Slice 是否只从权威 owning Schema 读取，是否先验证 Scope/binding，再重建精确引用；检查 Fact 原文、source refs、binding JSON 额外字段是否可能回显。
- 检查 Projection 是否只接收 Snapshot Export/Event Delta，是否保持 source target 与 consumer last 的差异，是否在暂停/失败/延迟时只暴露诊断而不改写 authoritative criteria/Command。
- 检查 Board 写入、读取和 cursor 的排序规则是否一致，并检查 HMAC cursor 的 Enterprise/Project/filter/version/last-row/expiry 绑定。

## 已修复的审查问题

1. active TemplateBaseline/RegulatoryProfile 的运行时版本状态校验从静态闭合类型中收紧为 `FROZEN`；CustomerBaseline、GapAnalysis、DeliveryPlan 分别校验 `CONFIRMED`、`ACCEPTED`、`ACTIVE`。
2. 绑定 Snapshot/Versioned Ref 和 Projection Typed Ref 均按 allow-list 重建；异常额外字段、敏感字段不会进入输出或存储。
3. SourceWatermark 固定为合法公共 namespace `enterprise_project`；Event Delta sequence 0 在事务前拒绝，正常 Delta 从 1 开始。
4. Board 使用固定 UTF-8 字节比较器统一写入排序、读取排序、cursor 排序和分页边界，避免运行时 locale/数据库 collation 差异。
5. 高 source target 已记录时，较低序消费只推进 checkpoint last 和当前 Projection Version，不覆盖 source state/checkpoint target，并在 Query 中暴露 lag。
6. Projection Board/failure rows 为 INSERT-only，Scope/partition/checkpoint/source watermark 由 RLS、权限、FK、CHECK 和 trigger 共同保护。

## 验证依据

详见同目录 `Verification-Report.md`。关键结果为：静态门禁全部 PASS；普通测试 `23 passed / 17 skipped`、`352 passed / 237 skipped`；独立 PostgreSQL gate `21 files / 252 passed / 0 failed`；空库 Flyway migration、V2012 和二次 migrate no-op 通过，容器已清理。

## 交付边界

commit、push、PR、exact-head CI/comment readback、merge、Issue close、main ancestry 和远端/本地 branch cleanup 已完成并独立读回。Issue #67 已关闭，远端和本地实现 branch 已删除；Provider、公开 HTTP、跨模块 Process Manager、生产和独立人工 Reference Project 验收仍为 `NOT RUN`。
