# PR #21 代码审查记录

## 审查范围

- PR：`qzhike/zhiju-business-core#21`
- 审查 head：`519209d26b915098214bec26de79148701ccd333`
- 目标：核对 IM-RP-001 重复/迟到回执检测是否符合高层规格、ReleasePublication 模块规格、测试规格及关联 Issue 的验收条件。
- 权限边界：只审查和验证；发现问题时仅向原 PR 发布评论，不修改实现。若无问题，则仅在精确 head CI 通过后合并，并核验/关闭相关 Issue。

## 成功标准

1. PR diff、实现、测试及文档与权威规格一致。
2. 重复回执、稳定幂等键冲突、迟到回执、目标不匹配和事实保留均有可复现验证。
3. 聚焦测试和完整验证通过，未执行的数据库、Handler、外部适配器及人工验收仍准确标记为 `NOT RUN`。
4. 审查结论绑定最新 PR head；若 head 变化则重新审查。

## 审查结果

结论：`NOT APPROVED`。审查 head `519209d26b915098214bec26de79148701ccd333` 存在以下阻塞问题：

1. `startPublicationAttempt` 未校验 `definition.packageRef.releaseRef` 等于当前 `releaseRef`。直接探测把 package 改为另一 Release 后，attempt 与 receipt 仍均被接受，当前 Release 被推进为 `PARTIALLY_RELEASED`。
2. Validator 不加载 `RawExternalReceipt` 事实，只按调用方提供的 `rawReceiptRef.contentHash.digest` 查重。把 `rawReceiptRef.objectType` 改为 `artifact.revision` 且不提供任何 Raw Receipt 事实，提交仍被接受，未达到 RP-API-C-002 的跨聚合 target/provenance 校验。
3. 查重与 `saveReceipt` 分离，Ledger 接口没有原子条件写入/唯一冲突返回。对同一 submission 连续执行两次校验而不先保存，两次均返回成功；真实 Repository 并发时可形成重复正式回执，且本 PR 仅有 In-Memory 实现，未达到 Issue #15 的持久化稳定键索引要求。
4. Issue #15 要求 Integration 层飞书/邮件 Provider 注入 late receipt 的可控 runtime fixture；当前 E2E 直接调用 `ReleasePublicationRuntime.recordPublicationReceipt`，未经过 IntegrationGateway/RawExternalReceipt 路径。验证报告将该未执行项称为“等价覆盖”并宣告 Issue 可关闭，验收结论不成立。
5. Issue #5 当前仍明确保留 ActorSnapshot/actingFor、providerResult PII 最小化及 Formal Release 来源链三个未完成 Runtime 验收项；本 PR 的 HL-Spec/Verification Report 不应声称 #15 合并后即可关闭 #5。

验证证据：

- 聚焦测试：2 个文件 / 10 个测试 `PASS`；
- 全量：15 个文件 / 297 个测试 `PASS`，architecture/contracts/compatibility 全部 `PASS`；
- 直接负例：foreign release package 被接受；非 Raw Receipt 类型引用被接受；两次 pre-save validation 均成功。
