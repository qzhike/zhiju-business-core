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

- [ ] 没有培训程序时，Agent 请求 `MISSING_CONFIRMED` 返回 `PROJECT_MISSING_CONFIRMATION_REQUIRED`，只允许 `NOT_PROVIDED/UNKNOWN`。
- [ ] `KNOWN`/未知类 presence 与 value/evidence 组合由 Contract 和数据库约束共同验证。
- [ ] 只有授权 Human 可激活；并发激活只有一个成功，旧 active ref 保留在事件中。
- [ ] CB-004 激活后，引用 CB-003 的旧 Context/Gap/Plan 仍解析原版本，仅产生 stale/impact 事实。
- [ ] EP-API-U-001、EP-API-C-002、EP-API-E-002 有实际自动化证据。
- [ ] 用户可运行缺资料与新旧 Baseline probe，清楚看到三态区别和旧版本未改写。

## 非目标与 `NOT RUN` 边界

- 不自动创建 Gap、DeliveryItem、Artifact 或 InformationRequest。
- 下游真实 Impact E2E 在对应模块实现前保持 `NOT RUN`。
