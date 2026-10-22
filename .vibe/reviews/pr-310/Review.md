APPROVE。PR #310 的已发布设计修订 `3e69c04973f3eb6b10f8486a1f23d9e9d4961aac` 保持经独立复审的 B1 技术语义，R1/R2 已关闭，用户已批准对应 SD-B1-01–07，当前内容的本地配置 docs 验证通过。本结论只评定设计文档，不代表真实实现或运行验收，也不授予合并权限。

# PR #310 独立设计审查

- 审查日期：2026-10-22。
- 对象：[PR #310](https://github.com/qzhike/zhiju-business-core/pull/310)，B1 项目与资料托管前置设计。
- Reviewed SHA：`3e69c04973f3eb6b10f8486a1f23d9e9d4961aac`；base：`ed876d8614878a94a261062853859709f7b4a926`。
- 已批准技术内容提交：`cbdbbfe80f61735c6682117c51f9647c28b96b2f`，对应 20 文件 manifest SHA-256 `c0fb9824aea4c68e977c12c956658525b8fa8eafda07b3f26e27bc649e176921`。
- 分类：T2，新应用数据与安全边界；本 PR 只交付 `.vibe/` Markdown 设计，不包含业务代码、DDL、初始化执行或旧环境清理。
- 远端只读回读确认 PR 为 OPEN、base 为 main，head 与 Reviewed SHA 一致。本轮未查询或等待远端 CI；远端 CI 状态未核验。

## 独立预期与范围

先从已确认的 [MVP 可用闭环](../../mvp/usable-loop.md)、[交付计划](../../mvp/delivery-plan.md)、HL-Spec 及相关 authority 建立预期，再审查实际设计增量：登录与项目归属校验先于资料访问；原 ZIP、条目、批次与 manifest 保持精确不可变身份；重复请求和响应丢失沿原意图恢复；数据库和文件的非原子边界不能产生不可读的成功事实；ZIP/OOXML/XLSX 限制必须可见；新初始化与旧数据隔离；资料接纳不得冒充分析或内容验收。

审查范围为 20 份设计文档及必要的既有认证、ZIP 安全和文件存储实现边界。覆盖新 Owner/composition、有限 API/receipt/分页、身份与授权 epoch、项目/批次/尝试、文件与数据库一致性、失败恢复、三格式安全、初始化及 UI 接线。未以实施者摘要代替差异和权威定义。

## 修订身份与人类批准

1. 首轮独立审查在 manifest `ac67904424dd47f0e37b8b734112cf8c0278bf4cfd68da62d594d79f5d246629` 上提出 R1/R2。
2. 修订 2 在 manifest `c0fb9824aea4c68e977c12c956658525b8fa8eafda07b3f26e27bc649e176921` 上关闭两项，无剩余阻断性设计问题；当时结论为 HUMAN_REVIEW_REQUIRED，因为人类技术批准尚未取得。
3. 主会话用户随后对 SD-B1-01–07 及设计文档提交、推送、创建 PR 的明确问题回复“批准”。本审查沿用该原始会话授权；不从静态检查、PR 创建或批准状态标签推导人类决定。该批准不涵盖合并、真实初始化、业务实现或 B2–B5。
4. 本轮逐文件读取设计提交 `cbdbbfe80f61735c6682117c51f9647c28b96b2f` 的内容并计算 SHA-256，20 个结果全部与修订 2 manifest 一致。实际 base→设计提交文件集也恰为这 20 个 Markdown 文件。
5. 完整审查 `cbdbbfe8`→`3e69c049` 的 19 文件增量：仅批准状态、标题与对应 fragment 链接、批准对象记录和 forward intent 同步，未改变 API、授权、状态转换、持久化、ZIP policy 或恢复语义。[B1 设计 §2](../../mvp/b1-design.md#2-已批准的-spec-delta)记录精确批准对象。

## R1/R2 处置

| 项目 | 结论 | 关闭依据 |
|---|---|---|
| R1：原包已 durable、首个 EXTRACT 尚不存在时无合法继续路径 | CLOSED | [MVP01 §4.1](../../module-specs/Module-Spec-MVP01-DocumentDelivery.md#41-批次状态)明确 CONTINUE_EXTRACTION 包括尚无 EXTRACT 的分支；恢复 Request/当前 authorization/receipt、新 PREPARED attempt、generation/fence 与 batch 状态同事务提交。正常首次安排和安排前崩溃分开处理；RECONCILE 只收敛 STAGED，随后显式继续；已存在 PREPARED attempt 先核验，禁止重复创建。原 ZIP 无需重传，原 batch 不改，恢复同键重放不再分配 attempt。 |
| R2：原授权 epoch 没有持久化落点 | CLOSED | [MVP01 §2](../../module-specs/Module-Spec-MVP01-DocumentDelivery.md#2-持久事实与不变量)定义 Request 的不可变 authorization 及 attempt 的授权引用/owner/epoch 镜像；[07 的 B1 映射](../../high-level-docs/07-postgresql-logical-model-v0.1.md#b1-独立数据库与逻辑表已批准设计)同步字段与精确引用约束。worker 开始副作用及接纳时比较当前 binding；旧 epoch 不自动执行或接纳，RECONCILE 不重新授权。只有显式恢复的新 Request 可授权新 attempt，旧授权、receipt 和历史保留。 |

[MVP01 Test](../../module-tests/Module-Test-MVP01-DocumentDelivery.md) 的 B1-01 已加入 epoch 变化、重启、拒绝自动接纳及显式恢复；B1-09/10 覆盖原包已 durable 但首次 EXTRACT 安排未提交。场景均保留 NOT RUN，不能把设计覆盖写成运行通过。

修订 2 同时把 projectId 纳入幂等逻辑 hash、receipt 和 get_request；同 key 换 project 的反例已列入 B1-02。UI 恢复标记保留原 expectedVersion，不以当前 CAS 值改写原意图。已核对其跨文档一致性，发布修订未回退这些规则。未发现新的阻断性设计缺陷，也没有把可选排版或组织偏好列为阻断。

## 验证与交付边界

- 复用绑定 Reviewed SHA 的本地配置验证：`vibe verify docs --json`，PASS，20 个 Markdown 文件，exit code 0；文档检查与 Prettier 均通过。执行环境使用基线锁定的工具链与隔离依赖，本轮未重复相同内容的配置检查。
- 本轮独立核对 repository/head、设计提交的 20 文件 hash、实际文件集、完整批准状态增量和远端 PR head。哈希一致只证明内容身份，不证明业务能力。
- 远端 CI 未查询、未等待，不把本地 PASS 写成远端 PASS；未来包含本 Review 的新 head 仍需按精确修订取得适用检查与范围确认。
- NOT RUN：新 Core/BFF/OIDC 运行链、新数据库迁移/RLS/持久化、文件故障与服务重启恢复、真实 DOCX/Markdown/XLSX 混合样本、Browser 接线及用户 B1 验收、Runner/业务内容与完整 MVP 验收。
- 本轮只写入本正式 Review；未修改设计或产品代码，未提交/推送，未发布 GitHub comment/review，未合并或初始化环境。独立审查结论不等于 GitHub 平台上的 APPROVED 状态。

## 下一步

主任务将本 Review 纳入已授权的设计交付，随后对包含该文档的最终 head 核对范围并取得所需验证证据。合并仍需用户明确授权；进入主干并回读后，才按已批准设计、最新基线和依赖判断 B1 implementation Issue 的 NOW + READY。设计批准不代替实现授权或运行验收。
