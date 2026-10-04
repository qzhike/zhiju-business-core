# IM-06 按 Run 读取 Usage 与执行来源的增量提案

日期：2026-10-04。状态：`T2 DETAILED DESIGN APPROVED 2026-10-04 / DESIGN TECHNICAL REVIEW PASSED 2026-10-04 / HUMAN DESIGN APPROVED 2026-10-04 / IMPLEMENTED 2026-10-04 (Issue #246) / RUNTIME EVIDENCE: USAGE-D-001 PASS, 其余 PARTIAL`。

本文件收敛 [Human-operated 决定 §11 的 TD-06](task-execution-human-operated.md#11-剩余设计增量-td-05–07)，设计技术审查已完成，并于 2026-10-04 获得明确人类设计批准。它不批准 TD-05/TD-07，不改变当前 Handler 支持集；字段、授权映射、存储边界和失败场景已同步为 owning 文档中的已批准详细设计；批准绑定与实现 `NOW + READY` 复核见 §6。历史批准与 PASS/PARTIAL/NOT RUN 保留。

## 1. 当前事实与下一目标

对账基线为 `main@e1b201ef85f0e75d3f816d94600f9810116b22ab`，本地与远端一致，工作区在本次文档修改前干净。[PR #245](https://github.com/qzhike/zhiju-business-core/pull/245) 已合并，[Issue #244](https://github.com/qzhike/zhiju-business-core/issues/244) 已关闭；[该 main revision 的 CI](https://github.com/qzhike/zhiju-business-core/actions/runs/37164844469) 成功。本轮只读取这些证据，没有重跑业务验收。

| IM-06 要求 | 当前可用事实及剩余边界 |
|---|---|
| 正常与一次 BLOCKED_INPUT 恢复、冻结 Hash 与分层完成 | #231/#235/#239 已交付 owning-entry/PostgreSQL 链和权威读回；原 Module-Test 的 PARTIAL/NOT RUN 不变，不声称统一退出 Fixture 已执行 |
| Human Cancel request、无 ACK 到期与 late final | #244 已交付有限两次执行 profile 的 CANCELLING→ABANDONED、原 IG Observation 与 TE LATE_RESULT 审计；不等于 Runtime ACK、任意 profile 取消或 WorkOrder/Task 取消 |
| Usage 未知与声明来源、可追溯执行来源 | `execution.get_usage_and_provenance@1.0` 已注册 payload/result，但没有对应业务 Handler/组成入口；Run、原 Attempt/ack、Adapter 实例、final Observation、Result/Acceptance 已有真实 owning 事实 |
| 权威 Query 与 Projection freshness 分离 | Run/Result/Completion/取消权威读回已有切片证据；Task Board 的 TD-05 export/generation/cursor/freshness 仍为未批准提案，不能以现有 Query 成功认定 Board 已交付 |
| 整体退出与外部/人工 | IM-06 保持 Current；后续仍需按现行退出标准复核统一链与故障恢复证据。Provider/CLI/Feishu、公开 HTTP/UI、生产/负载及独立人工业务验收保留 NOT RUN |

下一独立交付目标：**已授权 Human 按一个 Run 读取真实执行来源，看到计量缺失或结构化 Agent 自报，并能分辨自报、实际 synthetic invocation 和迟到隔离事实。** 必要层包括 TE Handler、IP 独立读取授权、IG owning 依赖读取、API composition、安全响应解释与受控 PostgreSQL 验收，不拆成注册-only任务。

分类为 T2：涉及跨模块历史来源读取、敏感信息边界和新的安全响应解释。owning 详细设计已同步；设计技术审查无阻断 finding，明确人类设计批准已取得，实现候选已按当前 main 复核为 NOW + READY（§6）。

## 2. 本轮设计决定与代价

本轮只完成详细设计及实现任务准备。以下选择已写入 owning 规格并获明确人类设计批准；不是对 TD-05/TD-07 的整体审批。

| 决定 | 拟议首版行为 | 代价 / 边界 |
|---|---|---|
| U-01 兼容与有限入口 | Human 通过现有 get_usage_and_provenance@1.0 按 exact Run 读取；支持已交付 synthetic/formal 首次与一次恢复、合法历史和有限取消来源；239/63/200 不变 | 不支持其他 Runtime/profile，不实现 Board、Provider 计量、跨 Run 汇总或新业务存储 |
| U-02 结构化自报的展示条件 | 直接采用 Core 已有 agentDeclaredUsage；至少一个计量字段存在、Result 已 ACCEPTED 且原 IG 来源一致才 PRESENT；缺失/measurementSource-only UNKNOWN | 原 §13 中“没有统一计量字段”的旧文字已纠正；未接纳阶段不展示声明，AGENT_DECLARED 永不冒充 Provider；后来的拒绝重交不能抹去原已接纳历史 |
| U-03 来源与安全解释 | 闭合 response profile 给出 Run version/status/snapshotAt、冻结 Ref、RuntimeBindingSummary、原 invocation evidence 与 accepted result evidence；分别重算 Observation Hash 与 Result Header Hash | 不返回 body/session/Prompt/token/stdout/客户内容；IG usage read 需补齐现有 helper 尚未完成的 canonical integrity 校验；跨 Owner 不承诺全局原子快照 |
| U-04 当前读权与历史资格分离 | 六项独立 Human/source/Contract/Binding/Adapter identity/final Decision；TE 专用 REPEATABLE READ 业务快照，IP 独立当前 READ COMMITTED 检查点 | 合法历史不要求旧执行 Bundle/lease 重新有效；撤权与依赖故障整 Query 失败，不能以 UNKNOWN 掩盖。现有平台 tx_context 有技术 INSERT/DELETE，因此不用 SQL READ ONLY，不改变原命令事务隔离 |

确定不存在的 final 与服务故障分开：仅在有效当前读取权限下的 owning final-not-found 可解释为尚未产生；TE 已有 Result/Acceptance/late Audit 时其原 source 缺失为冲突。本地存储损坏 no data，来源冲突输出安全 unavailable evidence，不能回退信任 Result 自述。

## 3. 唯一权威与验收位置

本决定只保存目标、取舍和审批边界，不重复维护字段或 action 表。

| 设计范围 | 唯一维护位置 |
|---|---|
| TE payload/result 兼容、支持集、Usage 映射、安全 profile、快照/关联算法、失败语义 | [Spec 003 §13](../module-specs/Module-Spec-003-TaskExecution.md#13-td-06-usage--provenance-补充设计) |
| 六项 operation/version/Purpose/action/config key/target、主体与当前重验 | [Spec 001 §15.18](../module-specs/Module-Spec-001-IdentityPolicy.md#1518-im06-usage-历史读取的独立授权组成提案) |
| 原 Binding/ack/Adapter identity/final owning integrity 与历史读取 | [Spec 007 IM06-USAGE](../module-specs/Module-Spec-007-IntegrationGateway.md#im06-usage-原调用来源的只读消费提案) |
| 无新表/migration/权限、现有 Context/RLS、TE/IP 快照分离 | [PostgreSQL §43](../high-level-docs/07-postgresql-logical-model-v0.1.md#43-usageprovenance-的查询快照与存储复用提案) |
| 既有 Query/Schema/metadata/Envelope 的兼容与安全语义 | [API Contract IM06-USAGE](../api-contract-v0.1/API-Contract-v0.1.md#im06-usage-既有-query-的安全返回解释提案) |
| TE 七项完整可观察验收 USAGE-D-001–007 | [Module-Test-003](../module-tests/Module-Test-003-TaskExecution.md#usageprovenance-按-run-读取设计验收) |
| IP 三项独立权限验收 IP-USAGE-D-001–003 | [Module-Test-001](../module-tests/Module-Test-001-IdentityPolicy.md#im06-usage-独立历史读取授权设计验收) |
| IG 三项来源验收 IG-USAGE-D-001–003 | [Module-Test-007](../module-tests/Module-Test-007-IntegrationGateway.md#im06-usage-历史原调用来源设计验收) |

所有新运行验收仍为 NOT RUN。正链经真实 owning Command/Query、原 Driver invocation 与 PostgreSQL产生，恶意 DTO 仅作负例；不可达 SQL 篡改分支的 guard 拒绝不冒充应用层通过。正常/恢复/取消来源、未知/自报、撤权/期限/依赖失败、快照竞争与保密反例均在上述 owning 矩阵中，不把整个模块 backlog 纳入此次目标。

## 4. 审查、批准与实施边界

详细设计按这八个 owning Spec/Test/Contract 文档连同本决定一起审查；设计技术审查无阻断 finding，用户于 2026-10-04 明确“批准设计”。此前“执行设计审查，通过后创建issue”已授权在门禁满足后发布实现 Issue；设计批准及 Issue 发布不授权 Git 交付。

本轮只修改 .vibe 下 Markdown，required target 为 `vibe verify docs --json`。未来完整实现将同时交付 Handler、独立授权、受信 composition、source read integrity、安全响应 profile 与七项 owning 验收，不拆成注册-only任务；required target 为 `vibe verify full --json`，新/变化容器运行时先 environment。发现新 Schema/ACL 需求时回到 owning 设计审查，不直接追加权限或修改已应用迁移。

设计技术审查与明确人类设计批准完成后，Planner 已基于当前 main 复核实现候选 NOW + READY。批准记录见 §6；docs PASS 不认定运行通过；IM-06 保持 Current，TD-05/TD-07 与外部/人工、真实 Grant PolicySnapshot lifecycle 的原延后/NOT RUN 不变。

## 5. 本地设计技术审查绑定（2026-10-04）

Reviewer 技术核对结论：**无阻断 finding；角色结果 HUMAN_REVIEW_REQUIRED，剩余门禁为明确人类设计批准**。未批准前不得把此结果写成实现 READY。本次在已有设计上下文的会话中按 Reviewer 规则从冻结契约重新建立预期并核对 actual diff/code，不宣称盲审或另一个审查者已执行。

审查基线 `e1b201ef85f0e75d3f816d94600f9810116b22ab`，对象为本地未提交的 11 份文档；逐文件 SHA-256 清单以 UTF-8 的 `digest + 两个空格 + 仓库相对路径 + LF`、按路径排序形成 manifest，Hash 为 `cbfdcef0bb8c24e41cc49bb55f4b5aa79de878048b5633a5ae2cbee5aa24d4cf`。该 manifest 绑定添加本审查记录前的设计字节，不冒称基线 commit 已含设计。审查记录和后续批准/推进状态不改变已审设计语义；实质修改必须重新审查。

审查覆盖公开 UsageAndProvenanceView 的所有 required/optional 字段、既有 Core agentDeclaredUsage 字段、两类 ValueEnvelope 的 presence/value/evidenceRefs 组合、closed profile 与 optional observation/hash 成对约束；核对六项 operation/version/Purpose/action/target/主体独立绑定、原调用事实与两类 Hash、TE/IP 隔离与平台 Context 技术写入、已接纳历史和迟到重交，以及三 Owner 场景对应关系。公开 Schema/metadata 不修改，Runtime、Board、传输包装和外部/人工的有限边界保持。

技术审查时的设计 required `vibe verify docs --json` PASS（files=11、全仓格式检查通过），git diff --check PASS；这是设计文档证据，USAGE-D/IP-USAGE-D/IG-USAGE-D 的运行结果仍 NOT RUN。远端 main 仍等于上述基线，当前开放 Issue 无同目标任务。已准备 Goal/Acceptance/Scope/Non-goals/References/Verify 完整的实现 Issue 正文，发布已获用户授权；当时人类设计批准仍 PENDING，因此未发布；后续批准见 §6。

## 6. 人类设计批准与实现任务准备（2026-10-04）

用户在上述具体设计与技术审查结果呈现后明确回复“批准设计”。该批准绑定 §5 的基线与 11 文件 technical-review manifest，以及 owning 文档中的 U-01–U-04：既有 Query 兼容、结构化自报资格、精确来源与安全解释、六项当前读取授权和 TE/IP 快照分离。后续修改只同步审批/推进状态，没有改变已审设计语义；不追认 TD-05/TD-07，不把设计批准当作运行证据，也不授权 commit、push、PR、merge 或部署。

Planner 重新读取远端 main，仍为 `e1b201ef85f0e75d3f816d94600f9810116b22ab`；发布前的开放 Issue 列表无同目标任务，标题 Usage 搜索亦无已有实现任务。已交付的正常/恢复、形式输出、取消/late-result 与原 IG 来源提供前置条件；当前 Handler/组成入口缺口仍存在。有限支持集、owning 字段/授权/失败语义、USAGE-D/IP-USAGE-D/IG-USAGE-D 可观察验收与 required full 已闭合，没有要求 Implementer 发明未决持久语义，候选为 NOW + READY。

用户此前已授权设计审查通过后创建 Issue；[Issue #246](https://github.com/qzhike/zhiju-business-core/issues/246) 已按该授权创建并读回，状态 OPEN、标题与 Goal/Acceptance/Scope/Non-goals/References/Verify 正文与批准后的任务合同一致；它承接一个完整实现目标，不拆成仅注册、仅授权或仅存储任务。设计文档仍位于本地未提交工作区，基线 commit 不包含它们；后续实现必须从已批准本地来源读取，并在其获授权的交付中保留 owning authority 更新。所有新运行验收保持 NOT RUN，IM-06 保持 Current。

## 7. 实现与运行证据对账（2026-10-04，Issue #246）

设计已实现：TE `handleGetUsageAndProvenance` 与 `withTaskExecutionSnapshotTransaction`（REPEATABLE READ + `transaction_timestamp()`），IP `createUsageProvenanceAuthorizationPort` / `USAGE_PROVENANCE_BINDINGS` 六项独立 mapping，IG `getUsageRuntimeBinding` / `getUsageRuntimeAdapterIdentity` / `getUsageFinalObservation` 严格 canonical integrity 读，以及 API composition `createUsageProvenanceEntry`。无新 schema/table/migration/GRANT；公开 operation/objectType/Schema 与 239/63/200 基线不变。

运行证据：`vibe verify full --json` PASS；真实 PostgreSQL 用例 `tests/persistence/usage-provenance.test.ts` 覆盖 USAGE-D-001（PASS）与 USAGE-D-002..007 / IP-USAGE-D / IG-USAGE-D 的可执行部分（PARTIAL），逐行结果与未执行变体见 Module-Test-003/001/007。本文 §3–§6 中“所有新运行验收仍为 NOT RUN”的表述已被本节取代；设计技术语义未变，§5 的 11 文件 manifest 仍绑定添加审查记录前的设计字节。未执行的验收（Run-2 独立来源、ABANDONED/submit-only 对照、Decision 到期、两连接确定性快照竞争、PG 直接注入库内损坏等）保持 NOT RUN；Provider/CLI/Feishu、public HTTP/UI、生产/负载、独立人工与 transport wrapper 边界不变。

评审修订（2026-10-04，PR #247 首轮 REQUEST_CHANGES 后）：TE Handler 在构造 evidence/声明前把原 IG final 与已提交 Result/Claim/Contract 逐项关联（`finalBindsCommittedFacts`），关联失败按跨 Owner SOURCE_CONFLICT 返回、不产生 PRESENT；IG 严格读把 canonical payload 字段与返回 mirror 列逐项比对；验收补齐 BOUNDED_RECOVERY Run-1/Context-2 Run-2 独立读回、CANCELLING/ABANDONED 迟到隔离、Decision 到期与读取屏障后撤权、以及 owning Acceptance 与 late-audit 的确定性双连接快照调度。逐行结果见 Module-Test-003/007。

第二轮评审修订（2026-10-04，PR #247 复核后）：IG ack 校验改为把 canonical `bindingHash` 绑定到已验证 attempt 的 binding hash、把完整 canonical `rawReceiptRef` 绑定到独立验证的 receipt Ref（self-consistent 但错误来源也拒绝）；双连接快照调度增加「已到达首个 Run SELECT」handshake，writer 在旧快照建立后才提交；验收补已接纳历史在执行资格到期后仍可读、finalize 后 conflicting resubmission 被 owning Handler 拒绝且不抹除已接纳历史、以及读取屏障后 Decision 到期的返回检查点拒绝；同步修正 IP/IG/TE 矩阵中已执行与仍 NOT RUN 的描述。

第三轮评审修订（2026-10-04，PR #247 复核后）：IG 严格读的 canonical 引用改为完整 TypedRef 绑定——canonical ack 的完整 `attemptRef` 必须等于已授权 exact Attempt，canonical final 的完整 `runtimeAdapterIdentityRef` 必须等于已验证 owning identity Ref（含 kind/objectType/id/scope），不再只比 id/scope；新增只改 objectType 并重算自身 hash 的负例。
