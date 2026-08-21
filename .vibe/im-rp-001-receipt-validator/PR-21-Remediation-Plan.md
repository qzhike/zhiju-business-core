# PR #21 Review Remediation Plan（IM-RP-001）

日期：2026-08-21
对应 PR：[#21](https://github.com/qzhike/zhiju-business-core/pull/21)
审查 head：`519209d`
用户决策：Integration 层飞书/邮件 Provider 注入 late-receipt fixture **文档重定范围**，该项归属 `#17` / `NOT RUN`，不再以「等价覆盖」声称关闭。

## 阻塞项与处置

| ID | 审查问题 | 处置 |
|---|---|---|
| P1-1 | `startPublicationAttempt` 未校验 `packageRef.releaseRef`，也未冻结 package 身份 | 校验完整 `ReleasePackageRef.releaseRef`；在 `ReleaseState` 冻结首个 package，后续 attempt/receipt 必须一致；加负例回归 |
| P1-2 | Validator 只按 digest 查重，不加载 RawExternalReceipt 事实 | 增加 `RawExternalReceiptRepository` 边界；校验 `objectType`、存在性与 release/destination/packageHash/attempt 溯源；加负例 |
| P1-3 | validate 与 save 非原子，并发可双写 | Ledger 增加 `compareAndSaveReceipt`；Runtime 只走原子落账；测试连续/竞争提交 |
| P1-4 | E2E 直接调 Runtime，未过 IntegrationGateway | **重定范围**：该项移出 #15 验收，归属 #17；文档删除「等价覆盖」表述；E2E 仍标注为 Runtime 受控 fixture |
| P1-5 | 声称合并 #15 即可关闭 #5 | 修正 Verification-Report / HL-Spec / PR 描述；#5 保留 ActorSnapshot、providerResult PII、普通飞书发送来源链三项 Runtime TODO |
| P1-6 | Raw Receipt outcome / payload hash / 权威时间未参与判定，可把 FAILED 或迟到观测改写为早到成功 | Raw fact 增加 `receiptPayloadHash` / `recordedAt`；仅 `SUCCEEDED` 可升级；Formal hash/time 必须匹配 Raw fact；迟到判定使用权威时间；加负例 |
| P1-7 | Attempt stable-key 检查仍为非原子 find-then-save | Ledger 增加 `compareAndSaveAttempt`；注册只走原子条件写；加冲突回归 |
| P1-8 | Release/Attempt 状态仅按 objectId 命中，完整 scope/objectType 未比较 | Release state 使用完整强引用 key；Attempt/Receipt/Raw ref 比较完整 identity；加跨 Project scope 负例 |

## 成功标准

1. 上述三个 Runtime 契约缺口有实现与负例测试。
2. 文档诚实：Integration Provider / DDL / Handler / 当时由 #5 保留的 Runtime TODO 均为 `NOT RUN`；后续 Owner 迁移至 #22–#24 不改变测试结果。
3. `pnpm verify` 全绿。
4. 推送后对最新 head 重新提交 review。
