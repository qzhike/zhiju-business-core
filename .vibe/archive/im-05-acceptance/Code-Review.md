# IM-05 父里程碑代码审查与验收结论

版本：v1.1

日期：2026-08-31

审查对象：GitHub Issue #120，修复后 `origin/main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d`（PR #141 merge commit）。

结论：`NOT APPROVED — PARENT EXIT GATE BLOCKED`。PR #141 已合入并曾自动关闭 #22/#23/#24；修复后 exact main 的聚焦测试、冷工作区全量门禁与可丢弃 PostgreSQL 门禁全部通过，但三个 Issue 的关键语义仍未满足。对 #23/#24 已在修复后 exact main 重新取得可重复的失败反例，Recall Handler 问题也保持不变。三个 Issue 已根据本审查重新打开并记录各自证据；本次不关闭 #120。

## 1. 阻断发现

### B-001 — 普通发送的 Adapter Attempt 可被接受为 Formal Release 回执

严重级别：`P1 / BLOCKER`

权威要求：

- HL-Spec §2.18 要求 RawExternalReceipt 绑定 exact Release/Package/Destination/PublicationAttempt/AdapterAttempt，普通 Feishu/file send 不得产生 Formal Receipt、`PublicationSucceeded` 或 Completion。
- Issue #24 要求普通发送和 Formal Release 的 Adapter Attempt/来源链不可混淆，并要求可重复的 Runtime E2E 证据。

实现问题：

- PR #141 新增了 `adapterAttemptRef.objectType=integration.adapter_attempt` 和 exact `externalDeliveryRequestRef` 检查，但仍只把 Adapter Attempt 当成调用方提供的 Ref。
- 实现没有从 IntegrationGateway 权威读取 Adapter Attempt，也没有校验 `adapterAttemptRef.objectId` 与 Publication Attempt、External Delivery Request、Release、Package、Destination 的正式绑定。
- 因此，只要调用方把任意未登记 ID 标成 `integration.adapter_attempt` 并保持其他字段自洽，伪造的 Adapter Attempt 仍会被晋升为 Formal Receipt。

直接反例：

- 先注册合法 `release.publication_attempt`，其外部请求为 `integration.external_delivery_request`。
- RawExternalReceipt 使用合法类型 `adapterAttemptRef.objectType=integration.adapter_attempt`，但 `objectId=018f22e2-7c15-7b2e-8d86-2de956a9d899` 是未登记的伪造 ID；合法 Publication Attempt ID 为 `018f22e2-7c15-7b2e-8d86-2de956a9d820`，其他 Release/Package/Destination/external request/payload/time 字段保持自洽。
- 修复后当前 `recordFormalReceipt(...)` 仍实际返回 `ok: true`，Formal Receipt 被记录。
- 新增测试只覆盖 wrong adapter `objectType`、wrong Scope 和 wrong External Delivery Request，没有覆盖 Issue #24 明确要求的 wrong Adapter Attempt `objectId`。

影响：不具备正式 Release Authorization 来源的普通消息/文件发送可被冒充为正式发布回执，直接破坏 #24 与父 Gate 的 provenance 条件。

最小修复准则：

- 由 IntegrationGateway 的权威公开 Query 返回完整的 Formal Delivery Attempt Binding，而不是由调用方提供自洽的内存事实。
- 检查 Adapter Attempt 的完整强引用 identity（objectType、objectId、Scope），并与当前 `externalDeliveryRequestRef`、Publication Attempt、Release、Package 和 Destination 精确绑定。
- 新增 ordinary-send、wrong adapter objectType、wrong adapter objectId、missing adapter attempt 与 valid formal path 的 Runtime/Handler 正负回归；失败路径不得写 Receipt/Event/Completion。

### B-002 — `providerResult` 的字段 allowlist 仍可被允许字段中的等价 PII 绕过

严重级别：`P1 / BLOCKER`

权威要求：

- Issue #23 要求每个 Provider 的允许字段白名单，或统一且确定性的安全映射；要求覆盖自定义字段、嵌套对象和数组。
- HL-Spec §2.18 要求 `providerResult` 先经 allowlist/redaction，不允许 PII 进入 Formal Receipt/Event/Error/Log。

实现问题：

- PR #141 已将根对象改成字段 allowlist，并移除未知、嵌套和自定义字段；该部分修复有效。
- 但允许字段的值仅用通用 token 正则判断。`messageId`、`providerStatus`、`reasonCode`、`status` 等字段可以承载任意姓名式或客户标识式字符串，没有 Provider-specific 映射、闭合状态枚举或不可逆标识转换。
- 因而字段名白名单不能证明值本身是经过审核的非敏感 Provider 标识，也未满足 #23 的“Provider 自定义字段携带等价敏感值”安全目标。

直接反例：

- 输入：`{ messageId: "AliceCustomer", providerStatus: "AliceCustomer", reasonCode: "BobBuyer", status: "CustomerName" }`。
- 修复后实际输出与输入完全相同，`redactedPaths=[]`。

影响：外部结果可把姓名或其他未命中正则的 PII 放入允许字段并持久化到 Formal Receipt，随后进入事件或诊断边界。`Module-Test-006` 对本地 sanitizer 的 `PASS` 不能满足 #23 的等价敏感值验收。

最小修复准则：

- 将每个受支持 Provider 的原始结果映射为封闭的内部安全结构：状态/错误码使用闭合集，标识符只能来自权威 Adapter 字段并按合同校验，必要时不可逆散列；不要让调用方用任意字符串自行声明其为 `messageId/status/reasonCode`。
- 增加 allowlisted-key/name-like-value、标识字段错位、未知键、嵌套数组、自定义 Provider 字段和安全映射正例，并验证 Receipt/Event/Error/Log 全链路不含原始值。

### B-003 — Recall 复用原 Authorize ActorSnapshot，缺失本次 Recall 的独立 ActorSnapshot 绑定

严重级别：`P2 / IMPORTANT`

实现问题：

- PR #141 未修改 `release-publication-handlers.ts` 中的 Persistence Recall 路径；`handleRecallRelease` 仍把 `actorSnapshotRefForRecall(row)` 传入 Human authorization validator。
- `actorSnapshotRefForRecall` 从 Release 行的 `authorization_actor_snapshot_ref` 读取首次 Authorize 的快照，而不是本次 Recall AuthorizationDecision 引用的 ActorSnapshot。
- validator 还要求当前 Envelope/Context 的 actorSnapshotId 与传入快照相同，因此另一位已获得 Recall Capability 的 Human 可能因不是原始 Authorize ActorSnapshot 而被错误拒绝。

风险：原始授权人离职、撤销或不可用时，合法的紧急 Recall 可被绑死。当前回归只覆盖使用同一 fixture ActorSnapshot 的 Recall，没有“另一合法 Human + 独立 Recall Decision”正例。

建议修复：由本次 Recall 的权威 AuthorizationDecision 解析并加载其 exact ActorSnapshot，再与当前 Envelope/Context、Human principal、Scope、Purpose、payload hash、expiry/revocation 比对；保留原 Authorize ActorSnapshot 作为历史事实，不得用它替代 Recall 主体快照。

## 2. 权威与 GitHub 状态复核

| 范围 | 实际状态 | 验收判定 |
|---|---|---|
| Issue #121–#128 | 全部 `CLOSED / COMPLETED` | 子 Work Item 交付完成 |
| PR #129–#141 | 全部 `MERGED`，各自 `verify=SUCCESS` | exact-head GitHub 交付记录存在 |
| WI-01–WI-08 有效实现 head | 全部是当前 `origin/main` 祖先 | main ancestry `PASS` |
| Issue #22 | `OPEN`（曾由 PR #141 自动关闭，已重新打开） | B-003 未修复；[复验评论](https://github.com/qzhike/zhiju-business-core/issues/22#issuecomment-5475982070) 已回读 |
| Issue #23 | `OPEN`（曾由 PR #141 自动关闭，已重新打开） | B-002 修复后直接反例；[复验评论](https://github.com/qzhike/zhiju-business-core/issues/23#issuecomment-5475984900) 已回读 |
| Issue #24 | `OPEN`（曾由 PR #141 自动关闭，已重新打开） | B-001 修复后直接反例；[复验评论](https://github.com/qzhike/zhiju-business-core/issues/24#issuecomment-5475987654) 已回读 |
| Issue #120 | `OPEN` | 正确；当前不允许关闭 |

Issue #120 正文仍只勾选 WI-01；#121–#128 和 #22–#24 均未同步勾选。修复文档多处写着 #22/#23/#24 `OPEN`；三个 Issue 重新打开后，当前 GitHub 状态与这一未完成边界重新一致，但报告中宣称的 controlled PASS 仍被本轮反例推翻，必须在真正修复时订正。

## 3. 当前 exact main 直接验证

### 3.1 冷工作区全量门禁

执行：`pnpm clean && pnpm verify`

结果：`PASS`

- Format / Lint / Typecheck：`PASS`。
- PR #141 聚焦 Vitest：`4 files / 34 tests PASS`。
- 普通 Vitest：`42 passed / 30 skipped files`，`438 passed / 299 skipped tests`。
- Architecture：`PASS`，`source_roots=10`。
- Public API/Catalog/Registry：`201 operations / 201 registry / FULL=201`。
- 冻结兼容基线：`v1.0 / 200 operations`。
- PostgreSQL/Flyway Gate：PostgreSQL `18.6` (`server_version=180006`)，Flyway `11.20.3`，`34 files / 314 tests PASS`。
- 空库 Migration：`PASS`；第二次 Migration：`No migration necessary`。
- 临时 PostgreSQL 容器：已删除。

### 3.2 Renderer / Representation 边界

- PR #135 exact-head CI 通过，最终实现 head 已在 `main`。
- 已有 Microsoft Word/Excel openability、ZIP integrity、DOCX/XLSX checksum 与临时输出清理证据。
- 真实第三方 Renderer、Ceph/OpenBao、生产、完整 Office 公式引擎、客户像素级版式和独立业务验收仍为 `NOT RUN`。

### 3.3 绿色 Gate 的边界

全量门禁证明当前已有测试集和迁移通过，不证明未编码的 provenance/PII/Recall 反例。B-001 与 B-002 都在 PR #141 修复后、4 文件 34 个聚焦测试和全量 Gate 全绿的同一个 exact main 上直接复现，所以不能用 CI 结果覆盖语义失败。

## 4. 已验证与未执行边界

已验证：

- 当前 exact main 的冷构建、全量静态/单元/Contract 门禁。
- 可丢弃 PostgreSQL 的空库迁移、二次 no-op、RLS/ACL/CAS/append-only/rollback 现有测试。
- #121–#128 的 GitHub PR/Issue 状态、exact-head CI 与 main ancestry。
- 受控 DOCX/XLSX 确定性、checksum、Representation Binding 与已记录 Office openability。
- B-001 伪造 Adapter Attempt 来源链绕过和 B-002 允许字段等价 PII 绕过。

`NOT RUN` / 不得声称通过：

- Issue #22/#23/#24 的独立完整语义验收；它们当前虽被 PR 自动关闭，但不具备关闭证据。
- 统一 QMS → Artifact → Renderer → ReleasePublication 跨模块业务 E2E。
- 真实 Feishu/email/file Provider、对象存储、OpenBao、公开 HTTP、生产凭据和外部收件人确认。
- 生产数据库、部署后验证、负载/HA/备份/灾备。
- Workspace UI、Feishu 产品审批/消息流、CLI runtime、IM-09 integrated E2E。
- 独立客户/业务人工验收。

## 5. 父 Gate 重新验收条件

Issue #120 只能在以下条件同时满足后关闭：

1. 已完成：重新打开 #22/#23/#24，并在对应 Issue 留下本轮反例与错误关闭原因。
2. 修复 B-001/B-002，并为 B-003 形成明确的合同决定与正负回归。
3. 根据 Issue #22/#23/#24 的每条验收场景补全 Unit/Contract/Handler/Persistence/controlled E2E 实际输出，并纠正 `Module-Test-006` 中被反例推翻的 `PASS/PARTIAL/NOT RUN` 状态。
4. 补齐父 Gate 尚未执行的 stale/withdrawn RRS 独立负例；当前 RP-API-U-001 与 RP-API-WI07-U-002 仍明确标记 `RRS stale/withdrawn negative NOT RUN`，不满足“latest readiness revalidation”退出项。
5. 为 #22/#23/#24 分别写入可重现的 GitHub 验收证据，并在各自 exact-head CI/main ancestry 通过后关闭它们。
6. 从当时最新 `origin/main` 重新执行 `pnpm clean && pnpm verify`、直接 provenance/PII/Recall/RRS 反例和必要的 PostgreSQL 门禁。
7. 更新修复文档中的 Issue 状态及 Issue #120 的 Work Item/Exit Acceptance checkbox，并保留 Provider/生产/独立人工等 `NOT RUN` 边界。
8. 读回 #120 为 `CLOSED / COMPLETED`，并证明所有有效修复 head 是最新 `origin/main` 的祖先。

## 6. Git 边界

本轮先将当前分支 fast-forward 到修复后的 `origin/main@737eaf3fed70cb84677fdfbaa0d9d68d9cdc208d`，保留本地验收文档；随后更新 `/.vibe/im-05-acceptance/` 下的任务计划、代码审查和 GitHub 复验评论记录，没有修改生产代码、Migration、Contract 或现有权威 Spec/Test。已按用户授权重新打开 #22/#23/#24、分别发布并回读复验评论；未执行 Git commit、push、Issue closure 或 branch/worktree cleanup。用户检查文档后，只有在明确回复“确认提交”时才进入本次审查文档的 Git commit 边界。
