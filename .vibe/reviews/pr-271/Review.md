# PR #271 独立设计审查

本文件保留两轮独立审查及随后的人类技术设计批准。第一轮 `REQUEST_CHANGES` 绑定 `6be920a8`，原发现和证据作为历史记录保留；第二轮 `HUMAN_REVIEW_REQUIRED` 记录批准提供前的状态。最新结论见文末[人类技术设计批准与最终结论](#人类技术设计批准与最终结论e87e9610)：`APPROVE`，R1/R2 已闭合，当前设计未发现新的阻塞问题，用户已批准精确受审修订 `e87e9610`。

## 审查对象与结论

- Issue：[#260](https://github.com/qzhike/zhiju-business-core/issues/260)，`T2 / design only`。
- PR：[#271](https://github.com/qzhike/zhiju-business-core/pull/271)，`OPEN / Draft`。
- Reviewed SHA：`6be920a8a2e3bb10cbba6af3f99cc3e0f8c2e2fd`。
- Base SHA：`9611faff0af25a7d256e6cba7538e3fb71dabfe1`。
- 审查日期：2026-10-10。
- Reviewer outcome：`REQUEST_CHANGES`。
- 阻塞发现：R1 / P1、R2 / P2，均为当前设计的接口衔接缺口。
- 精确修订的人类技术批准：`PENDING / NOT PROVIDED`。

本次读取最新 Issue、PR head、完整差异、受影响的 owning Spec/Test、共享 IDL/Page 规则与当前 CI。先从已批准项目汇总/分批交付要求和现有单 Revision Release/Package、Human-only、模块查询边界建立预期，再核对提案。审查没有要求本任务实现下载、Renderer、持久化、Registry 或新 HTTP 路由，也没有修改提案或产品代码。

本正式记录是 reviewed SHA 之后新增的本地审查交付，不属于该 SHA 或其 CI；未 commit/push。GitHub comments 已发布并读回，具体链接与状态见文末；本地正式记录的 Git 交付仍未执行。

## 独立预期与验收对应

| Issue 验收 | 独立判断 |
| --- | --- |
| 逐文件内部批准、mandatory Gate、完整 ABS、独立角色与单份决策接续 | QG D12 与 UI D12 区分内部获批和导出资格；其他角色未满足时不能导出，REJECTED/UNKNOWN 不接续。没有发现该设计边界的新阻塞问题。 |
| 从项目汇总跨轮次文件、章节选择与一次精确确认 | Manifest/闭包/确认语义存在；正常候选入口的数据发现链和 EP 枚举接口未闭合，见 R1/R2。现有正例预先给出精确文件 refs，不能证明从仅有 Project/Plan 的准备页入口完成发现。 |
| 合法 owning 受控导出与单 Revision Package 兼容 | 新 Batch 引用独立已授权 CONTROLLED_EXPORT Release/Package；保留旧 packageHash/packagePayloadHash 与 PublicationReceipt/Completion，没有将多个 Revision 塞入旧 Schema。 |
| Staging/Link/验证、当前下载授权、expiry、原意图恢复与失效 | 描述符/校验事实分域，UNKNOWN 恢复同 Attempt，当前授权与历史归因分开；没有将请求/响应观察当保存、发送或客户收件。实际运行仍 NOT RUN。 |
| 必要成功与失败 trace、保持既有批次及独立工作 | 8 条 trace 映射 31 条未来场景，均保持 NOT RUN；还需增加从无已知 Artifact refs 开始的发现，以及真正跨页的 EP 枚举场景。 |

## 阻塞发现

### R1 / P1：项目候选查询缺少 Artifact 的发现来源

定位：[REL §14.3](../../module-specs/Module-Spec-006-ReleasePublication.md#143-选择-query-与确认判据)，reviewed SHA 第 405 行；共同核对 [EP D12](../../module-specs/Module-Spec-002-EnterpriseProject.md#d12--q11-项目交付关联只读提案260) 第 1069–1071 行、[Artifact Query](../../module-specs/Module-Spec-004-Artifact.md#4-query-payload-与-result-contract)与 [Artifact D12](../../module-specs/Module-Spec-004-Artifact.md#d12--q11-精确-markdown-表示与导出读取提案260)。

REL 候选 Query 仅接收 projectRef/deliveryPlanRef/filters/PageRequest，却规定先从 EP 的 D12 Port 获得文件映射，再读取 ART approvedRevisionRefs。EP 的 closed 结果只有 DeliveryItem refs、类型、质量 pin、依赖与章节，没有 artifactRef；该 Port 的输入关联反而要求 REL 先读取 ART.definition.deliveryItemRefs。现有 artifact.get_artifact 必须先给出 artifactRef；其他 Artifact Query 也需要已知 Artifact/Revision/Representation refs。本次 ART D12 唯一新增的内部 Port 是精确表示 bytes 读取，没有声明项目/交付项到 Artifact 的发现能力或受权发现索引。

直接反例：Human 从准备页仅带入 Project-A/当前 Plan-A；其中一个 Item 已有内部获批的 Artifact-A，但尚无 CONTROLLED_EXPORT Release。EP 可以返回该 Item，却不能给出 Artifact-A，REL 因而无法获得调用 get_artifact 所需的 identity，也不能展示规格要求的“待发布授权”行。只枚举 REL 自有 Release 会遗漏这种明确支持的等待项；让调用方提前提交 Artifact 清单、读 ART Repository 或把 EP 返回内容临时扩充，都改变当前声明的输入/结果或违反查询所有权。

修复要求：在既定 ART/REL/EP 范围内明确候选 Artifact refs 的合法发现来源。可以新增受权 ART 只读发现 Port，或明确受控索引的 owning 来源、输入/结果及逐项 authoritative 重验；无需规定某一种实现。闭合 Project/Plan → Artifact → approved Revision → Quality/Representation/Release 的链，保留 Scope 裁剪、分页/水位、共享文件合并和缺 Release 的等待原因。同步 owning 场景，包含从零已知 Artifact refs 开始、内部获批但无 Release、跨轮次、共享文件及无权文件的案例；不要通过客户端提供任意 refs 或跨模块 Repository 补洞。

这是设计交付本身缺少必要数据来源，并非要求本 PR 实现发现 API。

### R2 / P2：EP 枚举模式与必填集合、封闭结果相互冲突

定位：[EP D12](../../module-specs/Module-Spec-002-EnterpriseProject.md#d12--q11-项目交付关联只读提案260)，reviewed SHA 第 1069–1071 行；依据共享 [IDL](../../api-contract-v0.1/API-Contract-v0.1.md#3-schema-表示法)和 [PageRequest/Page](../../api-contract-v0.1/API-Contract-v0.1.md#4-共享标量与-value-object)。

输入声明 deliveryItemRefs:Set<VersionedRef<DeliveryItem>>，没有 optional 标记；同一段又要求“省略条目集合”的枚举模式使用共享分页。声明的输入没有 PageRequest/cursor，closed 结果也没有 Page/nextCursor/snapshotAt。共享 IDL 中无问号的字段必填，Set 可为空但不等于可以省略；未声明字段必须拒绝。因此严格按该输入/结果实现时，合法枚举首请求会被判缺字段，多个页面之间也没有声明的续页通道。

直接反例：Plan-A 的条目超过一页。首请求省略 deliveryItemRefs 应开始枚举，但违反当前必填声明；即使特别放行省略，closed 结果仍不能携带 nextCursor，调用方不能继续完整枚举。用空 Set 代替省略又落入“仅验证所请求集合”的 explicit 模式，不能擅自将空集合解释为全部条目。外层 REL Page 也不能弥补内部 Port 没有下一页输入/结果的问题。

修复要求：闭合两个模式的字段和接受集，例如明确 tagged union 的 ENUMERATE/VERIFY，或明确 optional 集合与合法条件；枚举分支声明共享 PageRequest 和 Page 结果/元数据，explicit 集合分支保持 exact 验证且不扩大范围。统一 associationSetHash 与页边界/完整集合证明的关系，定义 Scope/Plan/过滤/水位变化时的游标拒绝，并补充多页、空 explicit 集合、空中间页及水位变化的 owning 场景。修复可沿既有共享规则，不需要新产品决定。

## 提案字段与边界矩阵

本 PR 没有运行 Schema/Registry 改动；下表逐项核对新增 named contract 的字段声明、引用强度、集合/可选语义及消费关系，不把纯设计字段核对当成实现校验通过。

| 合同 / 边界 | 声明字段 | 独立核对 |
| --- | --- | --- |
| ProjectDeliveryEntry | artifactRef、revisionRef、representationRef；deliveryItemIds、associationProofHash、chapterBindings；provenance.revisionProvenance/sourceReportRefs；qualityProfileRef、RAS/ABS refs；releaseRef、releasePackageRef、RRS/ReleaseAuthorization refs；archivePath | 完整 Ref 强度按 §14.2 路由；非空集合、单 Artifact/Revision/Markdown、共享合并与安全路径明确。已知 entry 的精确验证链存在；如何发现 entry 的 Artifact identity 缺失，见 R1。 |
| ProjectDeliveryManifest | manifestVersion、OBJECT batchRef、projectRef、deliveryPlanRef、recipientScopeSnapshotRef、destinations、exportPolicyRef；dependencyProof.ruleRefs/requiredItemIds/coveredItemIds/associationSetHash/requirementSetHash；entries | OBJECT identity 入 Hash，自身 content-addressed Hash 排除；非空/可空集合区分，闭包和旧 packageHash 分域。 |
| ProjectDeliveryBatchRef / BatchView | CONTENT_ADDRESSED kind/type/objectId/scope/contentHash；batchRef、manifest、CONFIRMED、confirmedAt、confirmingActorSnapshotRef、confirmingAuthorizationDecisionRef、confirmationReceiptRef、generationRequestRefs、currentUse.status/reasonCodes/checkedAt/sourceWatermarks | 不可变确认事实与当前 USABLE/BLOCKED/UNKNOWN 分开；新的当前 Decision 不改写历史命令归因。 |
| ProjectDeliveryArchiveRef / Descriptor | CONTENT_ADDRESSED archive identity；descriptorVersion、OBJECT archiveRef、batchRef、batchManifestHash、manifestMarkdownChecksum、zipChecksum、entryChecksums.archivePath/checksum、zipByteSize、mediaType、objectRef、storageVersion、archiveProfileVersion、validationFactRef、linkedAt、availableAt | 自身 Ref/Hash 不入输入；locator 不是 URL。Manifest → bytes → ZIP → Validation → Descriptor 无反向 Hash 自引用，只有 AVAILABLE 才可下载。 |
| ProjectDeliveryArchiveValidation | attemptRef、batchRef、objectRef、storageVersion、archiveProfileVersion、entryChecksums、manifestMarkdownChecksum、zipChecksum、zipByteSize、VERIFIED、validatorVersion、validatedAt | Hash 不含最终 Descriptor；路径/数量/大小/CRC/源 bytes 都要求权威复验，当前没有实现。 |
| ProjectDeliveryAssociationPort | 输入 projectRef、deliveryPlanRef、deliveryItemRefs；输出 projectRef、deliveryPlanRef、planUsable、items.deliveryItemRef/criteriaHash/qualityProfileRef/targetArtifactTypes/dependencyItemIds/chapterBindings、chapterMappingRef、planQualityPolicyRef、associationSetHash、checkedAt、sourceWatermarks | 两个模式的必填/省略与分页字段未闭合，见 R2；输出没有 Artifact identity，不能独自实现 REL 声明的文件发现，见 R1。 |
| ControlledExportQualityProofPort | 输入 revisionRef、qualityProfileRef、optional RAS/ABS refs；输出 revisionRef、qualityProfileRef、optional RAS/ABS refs、revisionAcceptanceUsable、approvalBundleUsable、proofHash、reasonCodes、checkedAt、sourceWatermarks | omitted Snapshot 只发现 Owner 当前指针，传入则验证原 Ref；ABS 为导出必需，UNKNOWN/NOT_APPLICABLE/NOT_PROVIDED 不通过；不扩大旧 #192/TE 允许用途。 |
| ControlledRepresentationBytesPort | 输入 representationRef、purpose；输出 stream 与 representationRef、registrationRef、storageVersion、byteSize、mediaType、checkedAt | 独立当前授权、已登记来源和每次 bytes checksum 重验明确；该 Port 不是 Artifact 发现接口。 |
| PackageRequest / ExportAttempt | intent.batchRef/archiveProfileVersion；原 key/payloadHash/Receipt/Actor/Decision；View.requestRef/batchRef/status/attemptRefs/optional archiveRef/reasonCodes；Attempt.requestRef/batchRef/profile/stableKey/attemptNumber/lease/fence 与 observations | CREATE admission、外部 staging、Link、finalize/AVAILABLE 分离；UNKNOWN 原 Attempt reconciliation、已 Link 对象不得孤儿删除、过期 fence 不发布成功。 |
| DownloadRequest / 流许可 | intent.batchRef/archiveRef；原主体/Actor/Decision；安全 transport.requestRef/batchRef/archiveRef/opaqueToken/expiresAt；许可绑定 principal/Session/两 immutable Hash/ZIP checksum/Scope | Token 不入业务事实；期限取 Session/当次 Decision/5 分钟最早值，流前当前授权及资格复验；重放不续签 Token，新主动下载用新意图。 |
| ResponseObservation | requestRef、batchRef、archiveRef、principal、Scope、streamAttemptId；outcome、bytesWritten、expectedBytes、observedAt、reasonCodes | STARTED/RESPONSE_SENT/FAILED/UNKNOWN 分层，成功观察须持久化且 exact bytes 长度匹配，不合计 Range/部分流，不产生正式发布或业务完成。 |
| 8 个拟操作 | candidates、inspect、confirm、batch read、package request/read、download request/read 的 payload/result/purpose/CREATE target | 名称唯一且未注册；共享 Envelope/CommandResult、原 target/key/hash、当前权限与恢复约束保留。candidate 的依赖输入链仍受 R1/R2 阻断。 |

## 验证证据

- `vibe repo --json`：PASS；repository=`qzhike/zhiju-business-core`，本地 HEAD 精确等于 reviewed SHA，审查开始时工作区干净。
- GitHub PR 的 head/base 与本地审查对象一致；发布前复查仍为相同 head/base、OPEN/Draft。
- [CI run 38026396924](https://github.com/qzhike/zhiju-business-core/actions/runs/38026396924) 的 headSha 精确匹配 reviewed SHA；select/checks/verify SUCCESS，persistence 为严格 Markdown 范围的预期 SKIPPED。checks 日志包含上述 BASE_SHA、`[docs-verification] PASS files=17` 与 Prettier PASS。复用可信当前证据，没有为重复该修订的 Gate 重跑配置目标。
- `git diff --check <base> <head>`：PASS。
- 独立 focused Python 静态诊断：8 个操作候选和 8 个 trace 唯一；31 个未来场景唯一且全部保持 NOT RUN（EP=3、AF=4、QG=5、RP=10、IG=3、UI=6）。EP 声明输入的集合确为 required，分页输入/续页结果/Artifact refs 缺失；现有 7 个 Artifact Query 均不能从仅有 Project/Plan 开始发现 Artifact，ART D12 只新增 bytes Port。该诊断直接读取 reviewed SHA 文件，没有构造运行实现或声称执行 E2E。
- 新增本地正式记录的 `vibe verify docs --json`：PASS，files=18、Prettier PASS。先前默认 PATH 调用未返回结果并被主动中止，exit=130；不作为成功或设计失败证据。只读 Vibe preflight 确认已有精确 pnpm 11.19.0；通过本次命令的 PATH 直接选择 `/Users/galendai/Library/pnpm/.tools/pnpm/11.19.0/bin/pnpm` 后，未改变的 docs 配置目标通过。没有关闭签名检查、改锁文件、项目配置或门禁。该结果是审查记录的独立交付证据，不能消除 R1/R2。

## 未运行边界与交付

真实 OIDC/HTTP、PostgreSQL、Host/Runner、Markdown Renderer、对象存储/ZIP/受控下载流、Windows/macOS Chrome/Edge、安全/可访问性与独立人工客户交付验收均 `NOT RUN`。本次检查未冻结提案、注册能力、修改历史 Hash 或制造 Runtime/外部/人工 PASS。

先由 Implementer 在现有设计范围内修复 R1/R2并补充 owning 场景，再对新精确 head 独立审查；Issue #260 仍要求精确修订的人类技术批准后才能冻结语义或声明依赖实现 READY。当前用户授权提交 comments，没有授权 commit、push、merge 或部署。本地只新增正式审查记录。

## GitHub comments 发布与读回

- [Review 总评](https://github.com/qzhike/zhiju-business-core/pull/271#pullrequestreview-5477763055)：review ID=`5477763055`，GitHub state=`COMMENTED`，submittedAt=`2026-10-10T05:20:51Z`，commit_id 精确等于 reviewed SHA。Reviewer 流程结论为 `REQUEST_CHANGES`，本次没有提交 GitHub 原生 Request changes review。
- [R1 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/271#discussion_r4236537504)：comment ID=`4236537504`，REL Spec 第 405 行，RIGHT，commit_id/original_commit_id 均为 reviewed SHA。
- [R2 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/271#discussion_r4236537506)：comment ID=`4236537506`，EP Spec 第 1069–1071 行，RIGHT，commit_id/original_commit_id 均为 reviewed SHA。
- 独立读取 review 和两条 comment 的正文，并分别读取 comment endpoint 核实实际行号/Scope；再次读取 PR，head/base 未变，仍 OPEN/Draft。正文包含 R1/R2、精确 SHA、验证证据、人类门禁和 NOT RUN 边界。
- 正式记录保持本地未跟踪文件；没有业务修复、commit、push、merge、部署或 Issue 关闭。

## 第二轮复审：e87e9610

### 审查对象与结论

- 用户授权：复审 PR #271 并提交 comment；没有产品修复、commit、push 或 merge 授权。
- Reviewed SHA：`e87e9610a2524ff7317f59d0f76f68a27388dc84`。
- Base SHA：`9611faff0af25a7d256e6cba7538e3fb71dabfe1`。
- 前次 Reviewed SHA：`6be920a8a2e3bb10cbba6af3f99cc3e0f8c2e2fd`。
- 复审日期：2026-10-10。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。
- 独立代理设计语义复审：`PASS / NO NEW BLOCKING FINDING`。
- R1、R2：`RESOLVED AT REVIEWED SHA`。
- 精确修订的人类技术批准：`PENDING / NOT PROVIDED`。

重新读取最新 Issue/PR、远端 head/base、两轮之间的实际修订、当前 REL/ART/EP/QG 契约与共享 IDL/Page/Cursor 规则，并独立读回新 SHA 的 CI。完整 PR 仍为 17 份 `.vibe/` Markdown；修复提交只改 10 份已在范围内的文档，没有实现、Schema/Registry、SQL、迁移、原型或验证配置改动。旧单 Revision Release、Hash、Human-only 和正式回执基准沿用已核对的未改内容；没有以 Implementer 的修复自述代替实际契约核对。

本轮开始时本地已有第一轮未跟踪正式记录，继续在同一文件追加，不删除或覆盖失败轮次，不声称工作区初始干净。本轮记录不属于 reviewed SHA，也不属于其 CI。

### 原发现闭合

| 原发现 | 新 head 的闭合依据 | 结论 |
| --- | --- | --- |
| R1 / P1：Project/Plan 入口缺 Artifact 发现来源 | [ART 发现 Port](../../module-specs/Module-Spec-004-Artifact.md#项目候选的只读发现来源)声明输入 projectRef/PageRequest，返回 owning ArtifactView 与完整 Markdown RepresentationView，不要求预知文件/Revision/Release。独立服务读取与发起 Human 的当前读范围取交集；共享文件只出现一次，无 Release、无 Run 或未登记 Markdown 均保留真实已知字段。[REL §14.3](../../module-specs/Module-Spec-006-ReleasePublication.md#143-选择-query-与确认判据)明确 EP 枚举 Item → ART 发现 → EP exact VERIFY → ART/QG/REL 逐项权威重验，缺 Release 显示等待原因，过时索引不能消费。TR-260-09、AF-D12-005/006、RP-D12-011 与 UI-D12-001 覆盖零预知 refs、内部获批无 Release、跨轮次、共享/Human 来源和无权项。 | `RESOLVED` |
| R2 / P2：EP 必填集合、省略枚举与分页结果冲突 | [EP D12](../../module-specs/Module-Spec-002-EnterpriseProject.md#d12--q11-项目交付关联只读提案260)明确 closed ENUMERATE/VERIFY 输入与结果。枚举必填 PageRequest、禁止 deliveryItemRefs；验证必填 Set、禁止 page/cursor，合法空 Set 只证明空集。结果分别为 Page/页 Hash 和请求完整集合/集合 Hash；VERIFY 任一错 Ref/无权项拒绝整个验证。REL 确认明确只消费完整所需集合的 VERIFY.associationSetHash，不以页 Hash 或部分验证证明闭包。TR-260-10、EP-D12-004/005、RP-D12-012 覆盖多页、空中间页、分支字段拒绝、游标绑定/expiry/水位变化及完整性。 | `RESOLVED` |

以上是设计字段和消费语义的闭合；没有声称上述未来场景已经运行。

### 新增字段矩阵与相关边界

第一轮矩阵继续记录其当时的判断；本轮完整核对受修复影响的 named contracts 和新增输入/结果，未改变的其他字段与历史证据保留。

| Contract / 字段组 | 新声明与独立核对 |
| --- | --- |
| ProjectDeliveryArtifactDiscoveryRequest | projectRef: ObjectRef<Project>、page: PageRequest 均 required；没有 caller 文件清单、Plan、Revision 或 Release 入参，发现仅由 ART 拥有。 |
| ProjectDeliveryArtifactDiscoveryItem | artifact: ArtifactView required，保留 artifactRef/aggregateVersion/definition/lifecycleStatus/workingHeads/approvedRevisionRefs/effectiveBindingRefs 的既有完整字段；markdownRepresentations: Set<RepresentationView> required，可为空，登记 identity/绑定由 Owner 读回。发现不是 eligibility，REL 仍精确重验。 |
| ProjectDeliveryArtifactDiscoveryResult | projectRef required；artifacts: Page<Item> required，包含 items、optional nextCursor、snapshotAt、sourceWatermarks。按完整 ArtifactRef 稳定排序，当前权限与真实读切面绑定；空中间页必须继续，变化/不可恢复切面拒绝续页，超 Guard 不截断单个成果。 |
| ProjectDeliveryAssociationRequest | ENUMERATE required mode/projectRef/deliveryPlanRef/page，拒绝 deliveryItemRefs；VERIFY required mode/projectRef/deliveryPlanRef/deliveryItemRefs，拒绝 page/cursor。Set 的可空语义明确，两个模式不靠省略必填字段判定。 |
| ProjectDeliveryAssociationItem | required deliveryItemRef、criteriaHash、qualityProfileRef、targetArtifactTypes: NonEmptySet、dependencyItemIds: Set、chapterBindings: NonEmptySet。Item 精确 Scope/版本/Hash；只提供 Plan/章节/质量 pin/依赖，不反向查询 ART。 |
| ProjectDeliveryAssociationContext | required projectRef、deliveryPlanRef、planUsable、chapterMappingRef、planQualityPolicyRef、checkedAt、sourceWatermarks；来源只读 EP 当前已批准 ACTIVE Plan 与 Policy。缺必要映射安全不可用，不造占位 Ref。 |
| ProjectDeliveryAssociationResult | ENUMERATE required mode/context/page/pageAssociationHash；VERIFY required mode/context/items/associationSetHash。枚举 Page 与 context 水位一致；验证成功的 items 与输入完整 Ref 集合一一对应，错项不返回部分成功 Proof。页 Hash 与完整集合 Hash 都排除自身及观察时间/游标，语义域明确。 |
| REL 候选与确认消费 | 候选只必需真实 artifactRef，其他 exact 字段在可解析时提供；未就绪行不冒充完整 ProjectDeliveryEntry。外层 cursor 由 REL 拥有，绑定 Scope/主体/purpose/Plan/filter/位置和各 Owner 读切面，不能直接使用内部 cursor；共享文件/多个 Revision 不漏项或重复。每文件及完整配套证明使用 VERIFY，隐藏/失效 required 关联不能从闭包省略。 |

继续核对了单文件 Human Release 授权、mandatory Gate/独立角色、旧 Package Hash 与独立 Manifest/ZIP/Validation/Descriptor Hash、当前下载许可及 Session/Decision/5 分钟上限、UNKNOWN 原意图恢复，以及 Request/ResponseObservation 不产生 FormalReceipt/Completion。修复没有扩大 public Catalog、旧 Query 接受集或既有模块所有权，也没有把发现页或技术分页状态提升成业务 Aggregate/Snapshot。

### 验证证据与剩余门禁

- 新一轮 `gh api user --jq .login` 最小只读探测成功；`vibe repo --json` 为 PASS，本地 HEAD 与远端 PR reviewed SHA 精确一致。
- [CI run 38028474800](https://github.com/qzhike/zhiju-business-core/actions/runs/38028474800) 的 headSha 精确匹配；select/checks/verify SUCCESS，persistence 是文档路由预期 SKIPPED。Verify documentation 日志包含上述 BASE_SHA、`[docs-verification] PASS files=17` 和 Prettier PASS。复用该证据，不为重复验证新受审 SHA 再跑相同配置目标。
- `git diff --check <base> <head>`：PASS。
- 独立 focused Python 静态核对：8 个操作候选、10 条 trace 唯一；37 个未来场景唯一且全部 NOT RUN（EP=5、AF=6、QG=5、RP=12、IG=3、UI=6）；21 个相关 D12 本地链接/标题锚点通过。EP tagged 输入/结果字段、required/禁止字段、空 VERIFY、整集合匹配、页与完整 Proof 分域；ART 发现字段与无 Release/共享/Human Scope；REL 实际闭包消费均逐项核对。静态计数和字面检查只补充直接契约审查，不作为运行场景 PASS。
- 本轮正式记录追加后的本地 `vibe verify docs --json`：PASS，files=18、Prettier PASS；仅本次命令 PATH 选择已安装的精确 pnpm 11.19.0。正式记录的 11 个本地链接/标题锚点独立核对通过；没有修改配置、锁文件、签名检查或门禁。该本地交付证据与受审 SHA 的 CI 分开。
- 真实 OIDC/HTTP、PostgreSQL、Host/Runner、Markdown Renderer/对象存储/受控下载流、Windows/macOS Chrome/Edge、安全/可访问性及独立人工交付验收均 `NOT RUN`。

当前没有剩余代理设计阻塞发现。但 Issue #260 的 Verify 明确要求独立设计审查和精确修订的人类技术批准；当前尚未提供该批准，因此最终 outcome 为 `HUMAN_REVIEW_REQUIRED`。本结论不冻结新语义、不将依赖实现标为 READY、不授权 merge/部署，也不把未来运行场景改为 PASS。用户已授权提交复审 comment；本地正式记录仍未 commit/push。

### 本轮 comment 发布与读回

- [复审 comment](https://github.com/qzhike/zhiju-business-core/pull/271#issuecomment-6094379062)：ID=`6094379062`，createdAt=`2026-10-10T05:51:49Z`。这是普通 PR comment，没有提交 GitHub APPROVE review。
- 通过独立 GET 读回 comment 正文，确认包含本轮 reviewed SHA/base、R1/R2 RESOLVED、HUMAN_REVIEW_REQUIRED、精确 CI 和静态证据、正式记录本地状态及 NOT RUN 边界。
- 发布后再次读取 PR，head/base 未变，仍 OPEN/Draft。没有改写旧 review/行内 comments 或删除第一轮失败记录。
- 本地仅更新既有未跟踪 `.vibe/reviews/pr-271/Review.md`；未 commit/push，没有产品修复、merge、部署或 Issue 关闭。

## 人类技术设计批准与最终结论：e87e9610

- 批准日期：2026-10-10。
- 批准来源：用户在收到上述精确修订复审结论后，于当前会话明确回复“批准”。这是用户的人类技术设计批准；以下远端 comment 由代理记录该批准证据。
- Reviewed / approved SHA：`e87e9610a2524ff7317f59d0f76f68a27388dc84`。
- Base SHA：`9611faff0af25a7d256e6cba7538e3fb71dabfe1`。
- 批准前重新读取远端 PR：head/base 与受审修订一致，PR 仍 OPEN/Draft；select/checks/verify SUCCESS，persistence 按文档路由 SKIPPED。
- 独立设计复审：`PASS / NO NEW BLOCKING FINDING`；R1/R2：`RESOLVED AT REVIEWED SHA`。
- 精确修订的人类技术设计批准：`APPROVED`。
- Reviewer outcome：`APPROVE`。

该批准与第二轮独立设计复审共同满足 Issue #260 的精确修订设计审查及人类技术批准要求，范围仅为本 PR 的 T2 设计。沿用 [CI run 38028474800](https://github.com/qzhike/zhiju-business-core/actions/runs/38028474800) 的精确 SHA 证据；前述 37 个未来场景及真实运行/人工验收仍为 `NOT RUN`。8 个操作候选仍未注册，依赖实现的 READY 状态仍需逐项满足其任务门禁。批准不扩大为 commit、push、merge、部署或关闭 Issue 的授权。

第一轮和第二轮的结论、comments、当时的人类批准待定状态继续保留，最新结论以本节为准。本轮只追加正式审查记录与发布批准证据 comment。

### 批准证据发布与读回

- [批准证据 comment](https://github.com/qzhike/zhiju-business-core/pull/271#issuecomment-6094594569)：ID=`6094594569`，createdAt=`2026-10-10T06:20:19Z`，为普通 PR comment。
- 通过独立 GET 读回正文，确认 reviewed/approved SHA、base、用户批准来源、R1/R2 闭合、`APPROVE`、精确 CI 和本地验证证据、NOT RUN 边界及正式记录状态均已发布。
- 发布后重新读取远端 PR，head/base 未变，仍 OPEN/Draft。
- 批准记录追加后的本地 `vibe verify docs --json`：PASS，files=18、Prettier PASS；本次命令沿用已安装的精确 pnpm 11.19.0。
- 正式记录仍仅存在于本地未跟踪 `.vibe/reviews/pr-271/Review.md`；未 commit/push，未创建 GitHub 原生 APPROVE review，未 merge、部署或关闭 Issue。
