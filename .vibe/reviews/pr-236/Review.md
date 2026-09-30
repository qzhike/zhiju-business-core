# PR #236 独立实施审查

- Issue：[#235](https://github.com/qzhike/zhiju-business-core/issues/235)；PR：[#236](https://github.com/qzhike/zhiju-business-core/pull/236)。
- 审查日期：2026-09-30。
- Reviewed SHA：`3b88120cf6ca505c33e3bfb40089fc3ae566b203`。
- Base SHA：`04d0d7e84bb1327730553dfb4b575d178ac1fa14`。
- 角色：独立 Reviewer `/root/formal_completion_review`。Reviewer 只读检查，未修改产品代码、提交、推送或发布 GitHub 评论；本文件由交付方依据其实际返回落地。
- 当前独立角色结论：`REQUEST_CHANGES`。本轮没有新的、有代码证据的安全或正确性阻塞；尚缺修正后最终 revision 的配置 `full` 通过证据。
- 适用人类技术批准：`PENDING`。会话中的设计限定修正及提交 PR 批准不替代人类实施技术审查。

## 范围与独立预期

按最新 Issue 正文与 owning 契约检查 Artifact 执行 Revision 创建/绑定/Receipt、原 invocation 的正式 final、独立 Result 验证和 Acceptance、两个单 Root Completion、历史及 current 读取、Quality 精确选择和 Readiness 消费。实现需保留 237 / 62 / 200 注册及兼容边界、冻结 Hash、完整 source 集合、真实 owning 授权与 Task → WorkOrder → Run → Request 锁协议。仅到达 COMPLETION_PENDING 或定义 fixture 不构成正常与恢复链验收。

审查覆盖 production composition、owning business/persistence、forward migrations、生成契约、standalone fixtures 及对应 Module Spec/Test；独立上下文先前提出的实现修正已由 Implementer 处理并逐轮读回。本轮重点复核最终 Request producer 边界、Hash 域批准范围、当前授权/读取语义和分层证据，不把 Implementer 的诊断当作 Reviewer 自行运行。

## 当前技术判断

1. **Request 负边界没有冒充正向 phantom race。** 新测试先由 owning reconcile 将真实 BLOCKED_INPUT 来源的 Task 置为 WAITING_INPUT，再以两种顺序执行独立授权的 Completion 与真实 Request Open。Completion 拒绝 `EXECUTION_COMPLETION_STATE_CONFLICT`，Request/Origin 实际提交，Completion 无 Receipt/Evaluation，Task status/version 不变且完成事件为零。测试在此 `return`，避免错误进入 recovered 正链的后续 Process replay。
2. **不可达正向 Request 子项保持 NOT RUN。** COMPLETION_PENDING 父 Task 下新建的 DRAFT child 无法通过现有 validate/freeze producer；已处理来源再次 Open 仅返回 Origin replay。Module-Test D013 和适用边界说明准确保留这一限制，没有扩大生命周期来制造测试正例。
3. **Hash 限定修正与 owning 实现一致。** Artifact §12 沿用 CanonicalContentPayload 的 RevisionRef Hash，独立重算 CreationBinding / CreationReceipt Hash 并复验完整 Snapshot 来源镜像。应用 canonical 重算及 SQL source/commit guards 一致，没有把包含自身 Ref 的完整 Snapshot 改为 RevisionRef Hash 域，没有重写已发布历史。
4. **当前消费状态与权限边界保持。** Readiness build 对最初已观察到的不可用 Completion 可合法产生 ready=false；复验要求观察状态未变，并独立复验 own/dependency 授权。最初 USABLE 后变为 STALE/REVOKED 仍拒绝，不因支持 ready=false 绕过当前授权或 mark 屏障。
5. **未逐项执行的场景仍可定位。** Request/Run/Resolution 不可达正向竞态、中间状态 Completion 的部分独立调用、部分 Artifact archive/invalidate/置换、Quality 新消费层部分负例、首次过期 release、自动 Completion Process 及外部/人工验收均保留 NOT RUN。D018 空库、升级及第二次 no-op 依赖最终 full，没有提前升级整行 PASS。

Reviewer 同时读回工作树唯一未提交修正：`initial-context.test.ts` 将旧 `query LIKE '%work_order%'` 锁识别改为 `blocker.processID` / `pg_blocking_pids` 实际阻塞关系。新增父级锁后的 SQL 别名使文本匹配失效；该修正保留跨越判断有效期后必须拒绝 Freeze 的原断言，未改变产品语义。

## 验证证据与门禁

交付方旧快照 full：82 unit files / 1,611 tests、格式/lint/type/build/architecture/contracts PASS；持久化 540 PASS / 3 FAIL。两个 Request harness 后续已修正；实际锁诊断修正与两种 Request 顺序的 focused PostgreSQL 回归为 3 PASS / 86 SKIPPED。上述是交付方执行证据，focused diagnostics 不替代最终配置 full。

最终修正需纳入提交，取得最终代码 revision 的 full PASS，再由独立 Reviewer 读回最终 head、证据与差异。最终 CI、验收与独立复审结果保存在 PR；本正式记录保留本次实际 reviewed SHA 与当时结论，不伪造提前批准。

人类技术批准仍待取得；无合并授权。真实 Provider/CLI/Feishu、public HTTP/UI、部署、生产/负载、独立人工验收及 TE-COMP-D-020 继续 NOT RUN。本实施交付不关闭 IM-06，不升级旧 #224/#231 的有限证据，不证明 EnterpriseProject Inbox dispatch 或 DeliveryItem COMPLETED。
