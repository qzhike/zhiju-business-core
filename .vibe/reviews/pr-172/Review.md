# PR #172 独立审查

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`0980cdf74440ec062a252c13d64d617981737b61`
- 关联任务：Issue #168
- 审查日期：2026-09-12
- 正式交接：[PR comment](https://github.com/qzhike/zhiju-business-core/pull/172#issuecomment-5642250608)。这是评论，不是 GitHub formal review。

## 范围与权威

独立核对 Issue 及批准评论、最新 PR diff、Module Spec/Test 003、受影响的 Decision、Core、Domain、一致性、PostgreSQL 与 API 契约。此次范围为 Schema/Registry/生成类型/fixtures/纯期限校验与存储设计同步；业务 Handler 和 migration 不在已批准实现范围。

`InitialContextExpiryBinding` 的 `requestExpiresAt`、`effectiveExpiresAt` 均为可选 UtcInstant，Schema 与生成类型一致。显式期限拒绝超过任一有限上界、缺省时取最小值、metadata/Snapshot 精确镜像以及无有限上界不等于无限授权均有对应实现。下述畸形输入反例阻塞批准。

## R1 — P2：拒绝被 Date.parse 归一化的非法日期

位置：`contracts/src/utc-instant.ts:13–18`，由新增 `validateInitialContextExpiryBinding` 消费。

解析器仅检查正则和 Date.parse 是否返回 NaN。`2026-02-30T00:00:00Z` 会被归一化为三月日期，新纯校验因此接受不存在的日期，并使用归一化后的时刻比较上界，同时在 metadata/ProjectContext 保留原始非法字符串。Schema 只检查格式，不能提前拒绝该输入。这违反 API 契约的 UTC RFC 3339 要求和 Spec 003 §11.2.5.4、TE-WI02-D-016 对畸形期限 fail closed 的要求。

通过当前构建的公开 ContractRegistry 复现：请求、metadata 两字段和 ProjectContext expiry 均为 `2026-02-30T00:00:00Z`，Source Slice validUntil 为 `2026-04-01T00:00:00Z`，WorkOrder/Policy 无期限，now 为 `2026-02-01T00:00:00Z`，实际返回 `{ valid: true, errors: [] }`。同样结构的 2 月 28 日通过，2 月 32 日正确拒绝。

隔离反例：保持请求/metadata/ProjectContext 为合法的 2 月 28 日，仅改变 `/sourceSlices/0/validUntil`。2 月 28 日通过；2 月 30 日错误通过；2 月 32 日仅在该路径产生 `INVALID_EXPIRY_INPUT`。不存在其他字段缺陷污染结果。

修复要求：严格验证真实日历与时间分量，禁止自动归一化无效值；保留亚秒精度比较。增加非法月日组合、非闰年 2 月 29 日等正反例，并确保新纯校验独立拒绝这些值，避免不必要地改变历史兼容 Schema。

## 验证与边界

完整执行证据与复现见上述 GitHub comment。Reviewer 两次执行 `vibe verify full --json`（含沙箱外重试），均返回 `VERIFY_FAIL`：静态检查、干净构建、720 项测试、架构与契约检查通过，但 Docker/PostgreSQL gate 报 `Could not find a working container runtime strategy`；初始测试阶段 321 项跳过。不能据此宣称全量或持久化验证通过，也不能将环境限制归因于产品缺陷。发布前复核 head 未变，CI 当时仍为 `IN_PROGRESS`。

期限 Handler、migration、长事务提交前重验、到期 replay、真实首次 PostgreSQL 业务链、Provider/Feishu/Runtime、公开 HTTP 与独立人工验收保持 `NOT RUN`。修复后须针对新 head 重新审查并取得完整验证通过证据。

本次未修改产品代码，未执行 commit、push 或 merge。
