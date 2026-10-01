# PR #240 — TaskCompleted / DeliveryItem Completion 实现审查

状态：`DRAFT / INDEPENDENT IMPLEMENTATION REVIEW PENDING / HUMAN TECHNICAL REVIEW PENDING / NOT APPROVED FOR MERGE`。

本文为项目要求的正式审查记录入口。由 Implementer 在取得实际 PR 编号后建立；不是独立审查结论，不把作者验证作为 Reviewer APPROVE，也不构成人类技术批准。

## 1. 工作项与修订

- 工作项：[Issue #239](https://github.com/qzhike/zhiju-business-core/issues/239)。交付：[PR #240](https://github.com/qzhike/zhiju-business-core/pull/240)，Draft，base `main@caa9bd6525bfd577369efe3ae84acc2e8dbdc2df`。
- 首次提交实现的代码修订：`845e531ef5bee12af50e06c527bfde168802f0a9`。本记录加入后 PR head 会前进；正式 Reviewer 必须独立读回最新 head，绑定当时实际完整 SHA，并审查包括本记录在内的最终 diff。
- 已独立审查的实现 SHA：`NOT RUN`。独立实现 Reviewer 与其结果：`PENDING`。

## 2. 已有设计权威与本次边界

#237 设计由 PR #238 交付，其独立设计结论、人类设计批准和最终设计 head 绑定保留于 [PR #238 Review](../pr-238/Review.md)，不转写为本 PR 的实现审查。

既有详细设计批准绑定 `a38e66f2df60d45079a093f08fed4e4f12732ef1` 与 manifest SHA256 `fdc8dac48d6f993599203fcdb054b388ec8e301c588d33d068c89bed741b67a7`；最终设计独立 APPROVE 绑定 `60a5e00d764e3990ae8356959e4a13029be05dd5`。2026-10-01 用户在 #239 实现会话明确批准 V7011 / V7012 两个有限迁移编号例外，已同步 migration 布局契约及 PostgreSQL §41；这不替代实现或人类技术审查。

声明模块为 TaskExecution、EnterpriseProject、IdentityPolicy；共享 contracts/generated、owning migrations、application composition、fixtures、Spec/Test 和 authority 为必要配套。新增公开 Major 仅 EP `project.evaluate_delivery_item_completion@2.0`，没有新增公开 Query/Event/HTTP/UI。IM-06 的其余退出义务保持原范围。

## 3. 必需审查与证据入口

独立 Reviewer 应从最新 Issue/PR、head diff、TE Spec003 §26、EP Spec002 §23、IP Spec001 §15.16 与 PostgreSQL §41进入，独立确认：

- TE COMMITTED source / original definition / Receipt causation、stored/public/envelope/binding Hash 与 private material/ACK 句柄边界；
- Project-partition allocation、cursor→Outbox 锁序、lease fencing、五次窗口与 Human resume Audit 原子性；
- EP exact Plan Version / Item / Task、Inbox conflict/幂等、ledger→Item 锁序、独立 v2 CAS、immutable full Evaluation/fingerprint 及 revocation/history/current readback；
- 九个当前授权映射、真实 Service/Actor/session/Grant/Decision、各 protected read/lock/commit/历史返回复验与依赖不可达；
- 两个 forward migrations 的最小 ACL / FORCE RLS / owner guards / same-owner FK，以及空库、合法历史升级和第二次 no-op；
- Module-Test 001/002/003 #237 矩阵的实际覆盖与 PARTIAL / NOT RUN，尤其 controlled Driver 与 LOCAL SYNTHETIC revocation 不被提升为 external/manual/真实撤销生产者证据。

执行和 CI 证据以 [PR #240](https://github.com/qzhike/zhiju-business-core/pull/240) 的正文与 checks 为准；本记录不复制执行日志。外部 Runtime/Provider/CLI/飞书、生产/负载、独立人工业务验收及实际 Grant PolicySnapshot 生命周期仍不由本次 controlled 验证证明。

## 4. 当前门禁

| 门禁 | 当前事实 |
|---|---|
| 既有详细设计人类批准 | 已有，精确绑定见 §2 / PR #238 Review |
| V7011 / V7012 有限编号决定 | 用户明确批准 2026-10-01，已同步契约 |
| 最新 head configured full / exact-revision CI | 查看 PR checks；独立 Reviewer 需绑定实际 head，不接受旧 SHA 替代 |
| 独立实现审查 | PENDING / NOT RUN，无 Reviewer APPROVE |
| 授权 / RLS / persistence 人类技术审查 | PENDING / NOT RUN，无人类技术批准 |
| 合并授权 | NOT GRANTED；用户本次仅授权实现和提交 PR |

在所有项目门禁及独立审查满足、且得到明确合并授权之前，本 PR 保持未合并。正式审查产生 findings 或结论后应追加其精确 reviewed SHA、分类、证据与处置，保留本准备记录的历史事实。
