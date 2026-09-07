> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/im-03-workitem-issues/issues/07-customer-baseline.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/im-03-workitem-issues/issues/07-customer-baseline.md).
> Published Issue: [#63](https://github.com/qzhike/zhiju-business-core/issues/63); this file is a historical draft, not its current body.

## 目标

实现 CustomerBaseline 草案、激活、三态缺失语义与 Baseline Impact Review，确保新基线不会改写旧 Context、Gap、Plan 或下游历史。

父追踪：#56

硬依赖：#62

## 范围

- `customer_baseline`、version/item、impact review Migration、Repository、Handler 与事件。
- `project.create_customer_baseline_draft`、`project.activate_customer_baseline_version`、`project.CustomerBaselineVersionActivated`。
- `NOT_PROVIDED`、`UNKNOWN`、`MISSING_CONFIRMED` 的显式模型与数据库约束；Human-only 激活。
- 同项目/用途唯一 active pointer、精确 previous ref 与 impact policy；旧版本重放。

## 验收条件

- [x] 没有培训程序时，Agent 请求 `MISSING_CONFIRMED` 返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`，只允许 `NOT_PROVIDED/UNKNOWN`。
- [x] `KNOWN`/未知类 presence 与 value/evidence 组合由 Contract 和数据库约束共同验证。
- [x] 只有授权 Human 可激活；并发激活只有一个成功，旧 active ref 保留在事件中。
- [x] CB-004 激活后，引用 CB-003 的旧 Context/Gap/Plan 仍解析原版本，仅产生 stale/impact 事实。
- [x] EP-API-U-001、EP-API-C-002、EP-API-E-002 有实际自动化证据。
- [x] 用户可运行缺资料与新旧 Baseline probe，清楚看到三态区别和旧版本未改写。

Issue 63 实现与 exact-head 交付（2026-08-26）已完成：Agent 缺失确认、Contract/Handler/DB 三态约束、Human 激活 CAS、CB-003/CB-004 旧引用与 Impact Review 均有自动化证据；disposable probe 实际输出三态、旧引用保留 5 条、`STALE/3` Impact Review。PR #77 已合并，Issue #63 已关闭，PR review comment 与 Issue closeout comment 已读回，远端和本地目标 branch 已删除。

## 非目标与 `NOT RUN` 边界

- 不自动创建 Gap、DeliveryItem、Artifact 或 InformationRequest。
- 下游真实 Impact E2E 在对应模块实现前保持 `NOT RUN`。

实现口径：Issue 验收文字中的 `KNOWN` 沿用领域规范映射为 `PRESENT/PARTIAL`；不向公共 Contract 添加未经审核的 `KNOWN` 闭集值。`UNKNOWN`、`NOT_PROVIDED` 和 `MISSING_CONFIRMED` 保持互不推导，并由 Contract、Handler 和 PostgreSQL CHECK 共同约束。
