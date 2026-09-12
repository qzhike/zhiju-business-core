# PR #174 设计审查

- Work Item：[Issue #153](https://github.com/qzhike/zhiju-business-core/issues/153)
- PR：[PR #174](https://github.com/qzhike/zhiju-business-core/pull/174)
- 审查日期：2026-09-12
- 结论：`APPROVE`，无阻断 findings。
- 设计交付 SHA：`c824dfb2b1b932ce2470b75665060066b723462e`。
- 审查对象：基线 `7e7f00f5b2966163e34c80f5e2e0d593b527f49d` 加 7 份文档、92 行新增；`git diff --binary` SHA-256 为 `0d6c3c91c1c7aa29d6847f4d8de6e030ac46899d36664b5af7a5980ac9b3dbb0`。提交前后已核对为同一精确修订。

## 独立性与权威依据

独立 Reviewer 读取最新 Issue/评论、实际 diff、HL-Spec、决定 §7/§9、Spec 003 §11、Spec 007 Runtime Binding、Core AgentResult/RawReceipt、Runtime 专项、PostgreSQL §33 与 IM-DG-006，未复用作者推理，没有修改实现。以下记录归档该独立审查结论，不冒充 GitHub formal review。

## Acceptance 核对

| 验收点 | 审阅结果 |
|---|---|
| 身份、Attempt 创建与可信读回 | Human Intent、各 Service 自身授权与 IG owning Attempt 分离；完整 binding 取自已提交事实及 owning Query，禁止内存 Ref、私有跨模块写入和 caller 成功断言。 |
| Driver 输入、输出与来源 | profile 明确输入、固定 Fixture、实际 synthetic ack、完整 final Result、UNKNOWN 和读回证据；保持 SYNTHETIC / TECHNICAL ONLY。 |
| Acceptance 到 terminal/Claim | submit/record/validation/accept/finalize 分别拥有事务，terminal 与 Claim 释放原子；固定 Process 的扫描、稳定键与中断/重复/乱序恢复明确。 |
| 控制入口与 Gate | 决定 §9.2 区分既有注册、批准的未来设计及不可用控制能力；expire 只消费显式 Policy，不选择 Runtime 默认值；Cancel ACK/CANCELLED 正向路径仍阻断。 |
| 拒绝矩阵 | 12 个 TE、5 个 IG 场景覆盖错 Attempt/绑定、过期 lease、旧 fencing、跨 Run、重复与异 Hash、cancel/expiry 竞态及 Receipt/Attempt 恢复，反例其余维度合法。 |
| 延后能力与 Usage | 不提前实现同 Run Resume、Heartbeat、独立 Runtime Usage 和真实 fallback；缺失计量不填零，Agent 声明不提升为 Provider 权威。 |
| 人类决定与 owning 同步 | TD-01–04 既有批准记录明确；本轮仅细化 TD-02，无新增公开字段/操作、默认 Policy 或实质性新决定，Spec/Test 003/007、Runtime 和 PostgreSQL 已同步。 |

## 验证证据

作者在同一修订执行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`，实际结构化结果为 `status=PASS, target=full, command="pnpm clean && pnpm verify", exit_code=0`。Reviewer 核对该证据绑定的 revision，并独立执行 diff 检查、重算 diff Hash。

- 常规测试：49 files / 752 passed；常规阶段 31 files / 321 skipped 不计作通过。
- PostgreSQL gate：35 files / 336 passed；PostgreSQL 18.6、Flyway 11.20.3，空库迁移、历史升级、二次 no-op 通过，临时容器清理。
- format/lint/typecheck、architecture、208 项 Catalog/Schema、历史 200 项兼容检查通过。
- 本轮 14 个本地链接/锚点与 `git diff --check` 通过。
- 首轮 full 未发现容器 runtime 而失败；按实际 Docker context 指定 OrbStack socket 后重跑完整目标成功，未更改项目 verifier。

## 交付边界

本文件保存已审查的设计修订。加入本审查记录后的最终 PR head 仍须复核并通过所需检查；该最终结论与 CI、merge、Issue 状态在 GitHub PR/Issue 留证，不以本文件推断已完成远端交付。

新增业务 Handler、Driver Fixture 实现、业务 PostgreSQL 场景、真实 Provider/Feishu/Runtime、公开 HTTP、生产、跨模块业务 E2E 和独立人工业务验收仍为 NOT RUN。APPROVE 不扩大 TD-02 批准范围，不关闭 #154/#27，不代表 IM-06 整体完成。
