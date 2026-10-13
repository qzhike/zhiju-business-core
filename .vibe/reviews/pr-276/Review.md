# PR #276 独立实现审查

本文件保留五轮独立审查。前四轮分别绑定 `bb4808a`、`705991c`、`8f57ca2`、`aa91a2a`；最新结论见文末第五轮：`APPROVE`，绑定 `23d297d`。R1–R6 全部闭合；历史与 canonical ProjectContext 来源均已要求完整同批 Scope，本轮未发现新增阻塞问题。

第一轮 Reviewer outcome：`REQUEST_CHANGES`。当时范围内确认 6 个阻塞问题（3 个 P1、3 个 P2）。

## 审查对象与独立依据

- PR：[#276](https://github.com/qzhike/zhiju-business-core/pull/276)，OPEN / ready；Issue：[#272](https://github.com/qzhike/zhiju-business-core/issues/272)，T2 implementation。
- Reviewed SHA：`bb4808a89f3db111dae271a07300d590f1305727`。
- Base SHA：`436f357fb921b593da2c4dfc57a8bbfdb112830d`。
- 日期：2026-10-12；审查入口 `vibe-development` / Reviewer；开始时本地 HEAD 等于 PR head，工作区干净。
- 设计依据：[REL §14.2 / §14.4](../../module-specs/Module-Spec-006-ReleasePublication.md#142-拟闭合类型与完整引用)、[D12 Spec Delta](../../decisions/project-delivery-controlled-export.md)、[Module-Test D12](../../module-tests/Module-Test-006-ReleasePublication.md#d12--q11-批次与受控下载设计场景260)、[Catalog D12](../../high-level-docs/06-typed-references-contract-catalog-v0.1.md#d12--q11-批次类型与操作候选路由260)、[共享 IDL/引用](../../api-contract-v0.1/API-Contract-v0.1.md#3-schema-表示法)、ART D12 Markdown 定义。
- 已批准设计定义绑定 `e87e9610a2524ff7317f59d0f76f68a27388dc84`；本实现 diff 不改变 §14.2/§14.4 的规范字段。本次没有更改冻结规则或模块所有权。

先从 Issue/approved owning 定义建立预期，再比较实际 diff、实现、fixtures 与 revision-bound 验证证据。Implementer 的总结不作为独立批准依据。预期为完整 closed named contracts、同 Enterprise/Project 的 declared refs、exact Revision/Markdown 绑定、Manifest/Validation/Descriptor 的无环 Hash 域、给定材料的完整 Hash/checksum/大小一致性，以及旧 Package 接受集/Hash 和未注册 8 个操作的边界。当前批准、Policy 适用性、配套完整性、对象存在性与真实下载链路属于后续 owning readers/handlers，不提升为本切片新增要求。

## 完整字段矩阵

下表逐字段比较 owning IDL 与实际 properties/required、可选字段、引用和集合；10 个新 closed object 定义的 required/properties 精确比较均通过。两种 CONTENT_ADDRESSED Ref 另沿 Common required 五字段及合法 Project Scope 核对；复合 Ref 与固定标量亦逐项核对。Schema 形状通过不代表所有跨字段约束满足。

| Named contract                                                      | 全部字段                                                                                                                                                                                                                                                                                       | 独立核对                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProjectDeliveryEntry (15 required)                                  | artifactRef, revisionRef, representationRef; deliveryItemIds, associationProofHash, chapterBindings; provenance; qualityProfileRef, revisionAcceptanceSnapshotRef, approvalBundleSnapshotRef; releaseRef, releasePackageRef, releaseReadinessSnapshotRef, releaseAuthorizationRef; archivePath | 顶层 required/properties 闭合；deliveryItemIds/chapterBindings 非空且唯一；完整 Revision/Scope/Markdown 跨字段绑定受 R1/R3/R4 阻断。                                                                                                                                                     |
| ProjectDeliveryManifest (9 required)                                | manifestVersion, batchRef, projectRef, deliveryPlanRef, recipientScopeSnapshotRef, destinations, exportPolicyRef, dependencyProof, entries                                                                                                                                                     | 固定版本；OBJECT batchRef；非空 destinations/entries；Project/Plan/ref 形状已收窄，RecipientScope 与 Policy rule schema 受 R6 阻断。                                                                                                                                                     |
| ProjectDeliveryBatchRef                                             | kind, objectType, objectId, scope, contentHash；Common 可选 immutableVersionId                                                                                                                                                                                                                 | CONTENT_ADDRESSED / release.project_delivery_batch；enterpriseId/projectId 必填；归档消费中的 Hash 绑定受 R2 阻断。                                                                                                                                                                      |
| ProjectDeliveryBatchView (10 required)                              | batchRef, manifest, status, confirmedAt, confirmingActorSnapshotRef, confirmingAuthorizationDecisionRef, confirmationReceiptRef, generationRequestRefs, currentUse                                                                                                                             | CONFIRMED；归因 Ref 使用完整共享形状；generationRequestRefs 是可空普通数组，不新增 uniqueItems；各顶层 required 完整。                                                                                                                                                                   |
| ProjectDeliveryArchiveRef                                           | kind, objectType, objectId, scope, contentHash；Common 可选 immutableVersionId                                                                                                                                                                                                                 | CONTENT_ADDRESSED / release.project_delivery_archive；enterpriseId/projectId 必填；与 OBJECT archive identity/Descriptor Hash 的已有绑定通过正例与反例控制。                                                                                                                             |
| ProjectDeliveryArchiveDescriptor (15 required)                      | descriptorVersion, archiveRef, batchRef, batchManifestHash, manifestMarkdownChecksum, zipChecksum, entryChecksums, zipByteSize, mediaType, objectRef, storageVersion, archiveProfileVersion, validationFactRef, linkedAt, availableAt                                                          | 固定版本/media type；OBJECT archiveRef；entryChecksums 非空集合；非负 size；不含自身 CONTENT_ADDRESSED identity；完整 Batch Hash/实际 bytes 大小受 R2/R5 阻断。                                                                                                                          |
| ProjectDeliveryArchiveValidation (12 required)                      | attemptRef, batchRef, objectRef, storageVersion, archiveProfileVersion, entryChecksums, manifestMarkdownChecksum, zipChecksum, zipByteSize, outcome, validatorVersion, validatedAt                                                                                                             | OBJECT attemptRef；VERIFIED；不含 final Descriptor/self-ref；非空 checksum 集合；完整 Batch Hash/实际 bytes 大小受 R2/R5 阻断。                                                                                                                                                          |
| ProjectDeliveryChapterBinding (2 required)                          | chapterCode, ordinal                                                                                                                                                                                                                                                                           | NamespaceCode / NonNegativeInt；非空集合由 Entry 定义；按完整 canonical identity 排序，重复拒绝。                                                                                                                                                                                        |
| ProjectDeliveryEntryChecksum (2 required)                           | archivePath, checksum                                                                                                                                                                                                                                                                          | NonEmptyString / ContentHash；schema 闭合；结构校验拒绝重复/不安全/manifest.md 路径。                                                                                                                                                                                                    |
| ProjectDeliveryProvenance (2 required)                              | revisionProvenance, sourceReportRefs                                                                                                                                                                                                                                                           | 复用 ART 的 3 个 required 字段 principal/sourceMaterialRefs/toolchainVersions 及 8 个 optional 字段 actingForRef/taskRef/workOrderRef/runRef/agentResultRef/contextSnapshotRef/templateBaselineRef/regulatoryProfileRef；不复制 owning 定义；报告允许空。来源 Project Scope 受 R3 阻断。 |
| ProjectDeliveryDependencyProof (5 required)                         | ruleRefs, requiredItemIds, coveredItemIds, associationSetHash, requirementSetHash                                                                                                                                                                                                              | ruleRefs 非空集合；required/covered IDs 可空集合；重复拒绝、覆盖关系检查存在；Policy 类型 schema 与 Enterprise 一致性受 R6/R3 阻断。                                                                                                                                                     |
| ProjectDeliveryCurrentUse (4 required)                              | status, reasonCodes, checkedAt, sourceWatermarks                                                                                                                                                                                                                                               | USABLE/BLOCKED/UNKNOWN；reasonCodes/sourceWatermarks 普通数组；SourceWatermark 复用 named Common 定义，没有降为任意 JSON。                                                                                                                                                               |
| ProjectDeliveryRepresentationRef / ProjectDeliveryReleasePackageRef | Common 完整复合结构；嵌套 revision / releaseRef / packageSnapshotRef 的 owning objectType 与 Project Scope 收窄                                                                                                                                                                                | 旧 Common 定义不改；新 D12 Representation 接受集受 R4 阻断。                                                                                                                                                                                                                             |
| 7 个固定标量/闭集与 ObjectLocator                                   | manifestVersion, descriptorVersion, archiveProfileVersion, mediaType, batchStatus, currentUseStatus, validationOutcome；ObjectLocator                                                                                                                                                          | 固定 1.0 域、application/zip、CONFIRMED/USABLE/BLOCKED/UNKNOWN/VERIFIED；locator 沿既有 opaque 字符串模式，不公开 URL。                                                                                                                                                                  |

report refs 的稳定排序/重复拒绝按 REL §14.4 的专门规则核对；generationRequestRefs、reasonCodes、sourceWatermarks 保持普通数组语义。未注册的报告 objectType/RecipientScope 竞争拼写保留 owning resolution，不在本审查中猜测新 selector。

## 阻塞发现与复现

### P1 / R1：Representation 与 Revision 的绑定遗漏 contentHash

定位：`modules/release-publication/src/project-delivery-validation.ts:265`，reviewed SHA 的 RIGHT 行。

REL §14.2 和 Issue #272 要求同一个 exact Revision。这里的 `sameObjectIdentity` 只比较 kind/type/id/Scope，不比较 CONTENT_ADDRESSED 引用的 `contentHash`。从 `manifest-valid.json` 的合法 Manifest 出发，只把 `entries[0].representationRef.revision.contentHash.digest` 改成 `'ab'.repeat(32)`，保留 entry.revisionRef 不变，`ContractRegistry.validateCoreContract(...projectDeliveryManifest, m)` 仍返回 `valid=true`，`validateProjectDeliveryManifest(m)` 也不抛错（已独立复现）。因此同一 Revision identity 下两份不同内容声明被当成一致，Markdown bytes/checksum 可以绑定到与被选 Revision hash 不同的内容。

请在这个跨字段绑定中比较完整 exact Revision Ref，包括 contentHash 的全部成员及出现的 immutableVersionId；不要仅靠对象身份。补入已签入的单项 negative fixture 和公开校验入口回归，并同步 scoped 证据。这是纯材料一致性检查，无须读取 Artifact Repository。

### P1 / R2：归档校验没有绑定两处 BatchRef.contentHash

定位：`modules/release-publication/src/project-delivery-validation.ts:485`，reviewed SHA 的 RIGHT 行。

这里只验证独立的 `descriptor.batchManifestHash`；前面的 `sameTypedIdentity` 不包含 Hash，所以 `descriptor.batchRef.contentHash` 和 `validation.batchRef.contentHash` 都没有与实际 `batchManifestHash(manifest)` 比较。以合法 archive materials 为基线，分别将其中一处 BatchRef.contentHash 改为 `ab…ab`，再按新 payload 重算 `descriptor.validationFactRef.contentHash = archiveValidationHash(validation)`、`archiveRef.contentHash = archiveDescriptorHash(descriptor)`，所有 closed schemas 与 `validateProjectDeliveryArchiveMaterials` 都通过（两个独立反例已复现）。这会接受同一 Batch identity 对应不同 Manifest Hash 的 Descriptor/Validation，违反 REL §14.2 的内容寻址身份和 #272 的 exact-material 绑定要求。

请校验两处 BatchRef 均绑定本次 Manifest 的完整 contentHash（可分别复用已有 `assertProjectDeliveryBatchIdentity`），并覆盖仅 Descriptor 错 Hash、仅 Validation 错 Hash及两者互不一致的反例。测试需重算外层 Hash，以确保失败发生在 Batch 绑定，而非陈旧 Descriptor Hash。

### P1 / R3：Scope 校验遗漏来源引用及 Enterprise-owned 引用的一致性

定位：`modules/release-publication/src/project-delivery-validation.ts:276`，reviewed SHA 的 RIGHT 行。

`entryProjectReferences` 没有纳入 provenance 的 Project-owned 引用；`qualityProfileRef`/dependency rule Policy 又只检查 Scope 形状，没有比较所属 Enterprise。三个独立反例均从合法 fixture 仅修改一处字段，且同时通过 Manifest Schema 和 `validateProjectDeliveryManifest`：① `entries[1].provenance.revisionProvenance.workOrderRef.scope.projectId` 改为另一合法 UUID；② `entries[0].qualityProfileRef.scope.enterpriseId` 改为另一 Enterprise；③ `dependencyProof.ruleRefs[1].scope.enterpriseId` 改为另一 Enterprise。这违反 REL §14.2 的同 Enterprise/Project 引用要求及 #272 明确的 mixed-Scope 拒绝验收。当前批准/Policy 适用性留给 owning readers，不妨碍检查这些已声明 Scope 的矛盾。

请按实际 Owner 分别校验 Project-owned provenance/报告 refs 的完整 Project Scope，以及 Enterprise-owned Profile/Policy 的 enterpriseId；Policy 携带 projectId 时还须与本 Project 一致。保留合法 Enterprise-only/Platform 形式及 Human-only 空集合，不要给所有来源强塞 projectId。加入上述单项已签入反例，并同步 owning Test 的证据边界。

### P2 / R4：Markdown-only Entry 仍接受 DOCX Representation

定位：`contracts/src/operations/release-publication.schema.ts:463`，reviewed SHA 的 RIGHT 行。

这个 D12-specific narrowing 只限制嵌套 Revision，没有限制表示格式；纯 `assertEntryStructure` 也没有格式检查。把合法 Manifest 的 `entries[0].representationRef` 改为 `format='document.docx'`、`mediaType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'`，其余字段保留，则 Manifest Schema 与 `validateProjectDeliveryManifest` 均通过（已独立复现），archivePath 仍是派生 `.md` 路径。REL §14.2/#272 明确规定每个 Artifact 一个 Markdown Representation，首版也排除了 DOCX/XLSX 转换，不能把非 Markdown 的表示声明成该基础契约的合法文件。

请在 D12 专用 schema/纯结构校验中落实已批准的 Markdown 格式和 media type 边界（ART D12 为 `document.markdown` / `text/markdown`），保持 Common 和旧 ReleasePackage 的接受集不变。补入 DOCX/XLSX/PDF 及 Markdown/mediaType 错配的单项 fixture；无需实现 Renderer 或真实字节读取。

### P2 / R5：已提供 ZIP bytes 时没有复验 zipByteSize

定位：`modules/release-publication/src/project-delivery-validation.ts:544`，reviewed SHA 的 RIGHT 行。

这里只比较 checksum；上面只保证 Descriptor 和 Validation 自报的 size 相等，没有与实际 supplied bytes 长度绑定。合法 archive fixture 的 UTF-8 ZIP bytes 长度为 46。把 `descriptor.zipByteSize` 与 `validation.zipByteSize` 同时改成 47，并重算 Validation/Descriptor Hash，保持原 46-byte zipBytes 与其正确 checksum 后，所有 schemas 与 `validateProjectDeliveryArchiveMaterials` 仍通过（已独立复现）。因此 VERIFIED 材料可声明错误的精确大小，违反 REL §14.4 的大小复验与 #272 的材料一致性要求。

请在 `zipBytes` 存在时，将实际 UTF-8 byte length（string）或 byteLength（Uint8Array）同时绑定两个 size 字段，并加上 checksum 正确但 size 错误的已签入反例。未提供 bytes 的结构检查边界可以保留；这不要求实现 ZIP producer/CRC 或对象存储。

### P2 / R6：已知 Policy 类型与 RecipientScope 的 Project Scope 未在 Schema 闭合

定位：`contracts/src/operations/release-publication.schema.ts:448`，reviewed SHA 的 RIGHT 行。

REL §14.2 把 `dependencyProof.ruleRefs` 定义为 `NonEmptySet<VersionedRef<Policy>>`，但此处沿用开放 objectType 的 Common.versionedRef。将合法 Manifest 的 `ruleRefs[1]` 替换成同 Enterprise 的 `qualityProfileRef`，`validateCoreContract(...projectDeliveryManifest, m).valid` 仍为 true。另外第 558 行的 `recipientScopeSnapshotRef: snapshotReference` 也没有实现注释所说的 Project Scope；将其 scope 改成 `{}` 同样得到 `valid=true`。这两个单项反例随后被纯校验拒绝，已独立确认，因此问题明确位于 machine-schema 接受集。

Issue #272 第一项验收要求封闭 Schema 的 full Ref kind/type/Scope 与 approved definitions 一致；不能用另一入口的后置拒绝补足 Schema 契约。请为 ruleRefs 收窄已注册的 `zhiju.identity.policy` 与合法 Scope，并为 D12 RecipientScope 收窄必填 enterpriseId/projectId（其未定 objectType 可以继续留给 owning resolution）。保持旧 shared/operation schemas 不变，并添加直接经 `ContractRegistry.validateCoreContract` 拒绝的已签入 fixture。

## 验证证据与限制

- `vibe repo --json`：PASS，repository/root/head 与审查对象匹配。
- [CI run 38210432664](https://github.com/qzhike/zhiju-business-core/actions/runs/38210432664)：完成且 SUCCESS；run.headSha 为 reviewed SHA，select/checks/persistence/verify 全部 SUCCESS。select 日志 `target=full reason=ready-or-main-non-document-change changed_path_count=20`。CI 实际 checkout 的 PR merge revision 是 `bb8bca5a988b49ba29fe03151a44dcedbcc6e035`（reviewed head + 本次 base），与纯 head 的本地诊断分开记录。复用当前 CI，不重复本地配置 full。
- PR [已有本地 full 证据](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6118663603) 报告先一次 controlled Keycloak board 30 s 断言失败、同实现 head 的重跑通过。该记录是 Implementer 发布的本地证据；独立 full 判断以已完成 CI 为主要来源。
- 独立聚焦运行：`node node_modules/vitest/vitest.mjs run .tmp-pr-276-review.test.ts modules/release-publication/src/project-delivery-hash.test.ts modules/release-publication/src/project-delivery-validation.test.ts contracts/src/operations/release-publication.schema.test.ts --no-file-parallelism --reporter=verbose` → `4 files / 124 tests`，exit 0，1.46 s。原有 103 tests PASS；新诊断为 10 个字段矩阵、1 个正例控制、10 个错误接受反例。反例断言漏洞现状，不把 exit 0 记为验收通过；8 个坏材料同时通过 Schema/纯校验，2 个只通过 Schema 后被纯校验拒绝。
- 所有反例以已签入合法 fixture 为 baseline，单项修改；Archive 反例重算外层 Validation/Descriptor Hash，隔离 Batch/size 绑定问题。使用真实新 source entry points，没有另写产品实现。临时诊断文件在发布前删除。
- 旧 package golden、set permutation/hash vectors 与 8 个 D12 operation unregistered 的既有测试通过；当前 diff 未修改旧 package-hash 域、旧 operation schemas、业务 persistence/HTTP 路由。
- `git diff --check <base> <head>`：PASS。
- 工具启动事实：默认 `pnpm exec vitest ...` 和固定 11.19.0 入口都未启动测试，主动中止 exit 130；固定入口中止时报告其自动 `pnpm install` 被 SIGINT。只读 `vibe_preflight.py --require-pnpm` PASS（Node 24.19.0/pnpm 11.19.0），随后通过已安装 Vitest 直接执行聚焦诊断。没有改 lockfile、项目配置、signature 检查或 configured verifier；聚焦诊断不替代 full。

8 个 D12 public operations/handlers、ART/EP/QG current readers 与完整 VERIFY 闭包、有限 export Policy/Renderer profiles、Batch/Attempt/archive 业务 persistence/migrations、真实 ZIP/manifest Markdown producer、object storage/controlled stream、OIDC/public HTTP/UI/BFF、客户发送、部署和独立人工验收均为 `NOT RUN`。full 的既有 PostgreSQL Gate 成功不升级这些范围。

## 交付与后续 Gate

R1–R6 均可在 #272 已批准范围内修复，不需要 Reviewer 修改产品代码、放宽 Contract 或另做产品决定。由 Implementer 修复并签入必要 negative fixtures/回归、同步 owning Module-Test 的准确证据后，对新 head 独立复审；Issue Verify 的适用 Human technical approval 仍按原 Gate 处理。

本文件为 reviewed SHA 后新增的正式本地审查交付，不属于该 SHA/CI。当前授权为审核并提交 comments；本地不执行 commit/push，不修复业务实现，不 merge/部署/关闭 Issue。GitHub 评论发布结果将在下节读回后记录。

## GitHub comments 发布与读回

- [Review 总评](https://github.com/qzhike/zhiju-business-core/pull/276#pullrequestreview-5487299109)：review ID=`5487299109`，GitHub state=`COMMENTED`，submittedAt=`2026-10-12T06:49:17Z`；commit_id 与 reviewed SHA 相同。
- [R1 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245321656)：comment ID=`4245321656`，`modules/release-publication/src/project-delivery-validation.ts:265`，RIGHT；commit_id/original_commit_id 均为 reviewed SHA。
- [R2 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245321668)：comment ID=`4245321668`，`modules/release-publication/src/project-delivery-validation.ts:485`，RIGHT；commit_id/original_commit_id 均为 reviewed SHA。
- [R3 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245321672)：comment ID=`4245321672`，`modules/release-publication/src/project-delivery-validation.ts:276`，RIGHT；commit_id/original_commit_id 均为 reviewed SHA。
- [R4 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245321675)：comment ID=`4245321675`，`contracts/src/operations/release-publication.schema.ts:463`，RIGHT；commit_id/original_commit_id 均为 reviewed SHA。
- [R5 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245321684)：comment ID=`4245321684`，`modules/release-publication/src/project-delivery-validation.ts:544`，RIGHT；commit_id/original_commit_id 均为 reviewed SHA。
- [R6 行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245321690)：comment ID=`4245321690`，`contracts/src/operations/release-publication.schema.ts:448`，RIGHT；commit_id/original_commit_id 均为 reviewed SHA。
- 独立读取已发布总评的完整正文，并逐条从 comment endpoint 读取正文、path、line、side 与 commit_id；六条 comment 的正文/定位/修订均与准备的审查意见一致。
- 发布后回读 PR：head/base 未变，仍 OPEN / ready。Reviewer 流程结论为 `REQUEST_CHANGES`，本次实际提交的是 `COMMENTED` review，不是 GitHub 原生 REQUEST_CHANGES review。
- 本地正式记录保持未跟踪、未 commit/push；临时诊断文件已删除，没有产品代码改动。完整配置目标复用受审修订 CI；新增正式记录另外经 Prettier Markdown API 格式校验，不冒充原 SHA/CI 的一部分。

## 第二轮独立复审（705991c）

Reviewer outcome：`REQUEST_CHANGES`。上一轮 R1/R2/R4/R5/R6 已闭合；R3 部分修复，仍有一个 Project-owned 来源 Scope 完整性阻塞问题。

- Reviewed SHA：`705991c71c67b28aa2804314d647a4cf752cad8e`。
- Base SHA：`436f357fb921b593da2c4dfc57a8bbfdb112830d`。
- 日期：2026-10-12；PR OPEN / ready；本轮入口 `vibe-development` / Reviewer；最新 Issue #272 无验收/范围变更。
- 独立对象是完整 PR 当前 head，增量比较为首轮 `bb4808a89f3db111dae271a07300d590f1305727` → 当前 head；首轮记录与当时 comments 保留，不作为当前完成状态。

### 验收与字段矩阵复核

复用前文 approved IDL 的完整字段清单，逐项比较所有 named contracts。本轮仍独立运行 10 个新 closed object 的 properties/required 精确比较；全部匹配且 additionalProperties=false。两种 Ref、复合引用、固定标量与 shared SourceWatermark/RevisionProvenance 的 owning 定义按实际 schema/diff 核对。approved §14.2/§14.4 规范字段未变化；本轮仅收紧 D12 专用 Markdown const、Policy/RecipientScope 边界及纯绑定检查，没有放宽旧业务 Contract。

| Contract / 改动边界                                                              | 全部字段矩阵本轮结论                                                                                                                                                               |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProjectDeliveryEntry（15 required）/ RepresentationRef                           | 顶层/集合/Ref 字段与首轮清单一致；新增 document.markdown/text/markdown const；Revision exact Hash/immutableVersionId 比较正确；来源 Scope 完整性仍受 R3 阻断。                     |
| ProjectDeliveryManifest（9 required）/ DependencyProof（5 required）             | 顶层字段不变；Policy rule objectType 固定 zhiju.identity.policy 与 Enterprise Scope，RecipientScope 必填 enterpriseId/projectId；可空 required/covered ID 集合与非空集合语义不变。 |
| ProjectDeliveryBatchRef / BatchView（10 required）                               | 完整 CONTENT_ADDRESSED identity/Project Scope 与 CONFIRMED、归因/普通数组/currentUse 字段不变；新的归档消费 Hash 绑定正确。                                                        |
| ProjectDeliveryArchiveRef / Descriptor（15 required）/ Validation（12 required） | 字段、非空 checksum 集合、OBJECT/CONTENT_ADDRESSED 分离和无环 Hash 不变；两处 BatchRef 与实际 Manifest Hash 对齐；给定 string/Uint8Array ZIP bytes 复验 checksum 与两个 size。     |
| ChapterBinding（2）/ EntryChecksum（2）/ Provenance（2）/ CurrentUse（4）        | 完整 properties/required、可选 owning RevisionProvenance 字段和 SourceWatermark 元素类型保持原样；currentUse.reasonCodes/sourceWatermarks、generationRequestRefs 保持普通数组。    |
| 固定标量/闭集与生成类型                                                          | 原 7 项固定值加 2 项 Representation format/mediaType const；生成类型同步；ObjectLocator/历史 Hash 域不变。                                                                         |

### R1–R6 修复闭合判断

| Finding | 本轮状态               | 独立证据与边界                                                                                                                                                                  |
| ------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 / P1 | CLOSED                 | sameContentAddressedIdentity 检查 kind/type/id/Scope、contentHash 的完整 canonical identity 及 immutableVersionId；原 Hash 反例被拒；两项 signed-in 单例存在。                  |
| R2 / P1 | CLOSED                 | 两处 BatchRef 均与本次 Manifest 身份和 Hash 绑定；重算外层 Hash 后原两个反例仍拒绝。显式内联保持材料错误码的实现可接受，复用身份 helper 不是新的约束。                          |
| R3 / P1 | PARTIALLY FIXED / OPEN | 已拒 foreign Scope/Profile/Policy 企业矛盾，report Scope 检查有效；Project-owned WorkOrder/Run/AgentResult 的空 Scope 或缺 projectId 仍被接受。下节记录单项反例和 owning 依据。 |
| R4 / P2 | CLOSED                 | 新 schema 与纯校验都限制 Markdown；DOCX/XLSX/PDF/mediaType negatives 已签入；独立 DOCX 双入口反例拒绝；Common/旧 Package 仍保留历史接受集。                                     |
| R5 / P2 | CLOSED                 | 校验 supplied ZIP bytes 实际长度；原错误 size 材料拒绝，新增独立 Uint8Array 和非 ASCII UTF-8 分支正负对照通过。                                                                 |
| R6 / P2 | CLOSED                 | 原 Policy-type / RecipientScope 缺 Scope 的两个反例直接在 schema 入口拒绝；36 schema negatives 对 keyword/path 作断言。                                                         |

### R3 剩余阻塞项

定位：`modules/release-publication/src/project-delivery-validation.ts:209`，RIGHT，reviewed SHA；`assertDeclaredScopeConsistency` 与调用它的 provenance 遍历。

已确认此前的 foreign-Project / foreign-Enterprise 反例现在被拒绝，但本函数只比较非空的已声明成员，因而允许通过删字段绕过完整 Scope 要求。以当前 `manifest-valid.json` 的合法 Manifest 为基线，仅删除 `entries[1].provenance.revisionProvenance.workOrderRef.scope.projectId`，`ContractRegistry.validateCoreContract(...#/$defs/projectDeliveryManifest, m).valid` 仍为 `true`，`validateProjectDeliveryManifest(m)` 也不抛错。把同一 WorkOrder 的 scope 改成 `{}` 也通过；对 `runRef` 和 `agentResultRef` 分别作这两种单项修改，结果相同（6 个独立反例已复现）。

REL §14.2 要求所有 Project-owned Ref 保留同一 `enterpriseId + projectId`，有执行来源时保存完整 Ref；Domain §19.2 / §20.2 / §21.2 将 WorkOrder、Run、AgentResult 明确定义为带 Enterprise/Project 的 owning 对象，fixture 也使用已注册的 `zhiju.execution.work_order/run/agent_result`。这几种来源不是可合法省略 Project 的平台配置。缺少字段与合法 Enterprise-only/Platform 形式必须按实际 owning 类型区分，不能一律按“未声明成员无需校验”处理。

请至少对已有 Project-owned 的 Task/WorkOrder/Run/AgentResult/ContextSnapshot 来源要求完整 Project Scope 并与 Manifest 一致；保持 Principal、合法 Enterprise/Platform 配置和 Human-only 缺省来源的合法形状。复用 ART provenance 定义不妨碍在 D12 消费边界补足 owning Scope 约束，也不需要读取他方 Repository、证明当前授权/对象存在性或新增业务操作。补签入分别删 projectId / 空 scope 的干净单项 fixtures，并修正 REL §14.8 的“所有 Project-owned 引用”及 Module-Test 完成声明后再复审。

另一个测试材料问题建议随本项修正：`structural-negative-cases.json` 中 `accepted report snapshot omits the Project Scope` 的 value.scope 实际携带了另一个 projectId，覆盖的是 wrong-Project，不能作为 missing-Project 证据。本轮用真正删 projectId 的对照已确认 report 校验会拒绝；请保留两种不同反例，避免验收标签与实际输入不符。

最小复现（从 fixture 的合法 Manifest 仅修改一个字段）：

```typescript
const m = structuredClone(manifestFixture.manifest);
delete m.entries[1].provenance.revisionProvenance.workOrderRef.scope.projectId;
registry.validateCoreContract(manifestSchemaRef, m).valid; // true
validateProjectDeliveryManifest(m); // no error
```

WorkOrder/Run/AgentResult 各自的空 `{}` 或 `{enterpriseId}` 两种形状，总计 6 个单项反例都同时通过 Schema/纯校验。基线的 Human-only entry 和 Enterprise-only Principal 保持有效；真正删 report.projectId 的对照会被拒绝，区分了合法可选来源、必填 Project Scope 与错误 scope 值。

Owning 依据：REL §14.2 的完整 Project-owned Ref 规则、[Domain WorkOrder §19.2](../../high-level-docs/04-domain-model-v0.1.md#192-类型与-aggregate-边界)、[Run §20.2](../../high-level-docs/04-domain-model-v0.1.md#202-类型与-aggregate-边界)、[AgentResult §21.2](../../high-level-docs/04-domain-model-v0.1.md#212-类型与-aggregate-边界) 的 enterpriseId/projectId 归属，以及 [TaskExecution §11.2.1](../../module-specs/Module-Spec-003-TaskExecution.md#1121-字段映射与引用校验) 的完整 Enterprise/Project 输入绑定。本问题不要求调用 owning Repository 或认证运行期资格。

### 本轮验证证据

- 新一轮 `gh api user --jq .login` 只读探针 PASS；`vibe repo --json` PASS，本地 HEAD/仓库与 PR 一致。开始时仅保留首轮未跟踪正式记录。
- [CI run 38217499971](https://github.com/qzhike/zhiju-business-core/actions/runs/38217499971)：headSha=`705991c71c67b28aa2804314d647a4cf752cad8e`，completed/success，select/checks/persistence/verify 全 SUCCESS；select 日志 `target=full reason=ready-or-main-non-document-change changed_path_count=20`。这是当前 PR 集成修订的 CI 证据；本地聚焦诊断直接读取 pure head 的 source。未重复本地 full。
- PR 的 [fix-head 本地证据](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6120100469) 记录相同 head 的 `vibe verify full --json` PASS（1837 s），另有 [CI 读回](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6120139617)。Implementer 总结用于定位声明，不作为 R1–R6 闭合的独立依据。
- 本轮聚焦命令：`node node_modules/vitest/vitest.mjs run .tmp-pr-276-rereview.test.ts modules/release-publication/src/project-delivery-hash.test.ts modules/release-publication/src/project-delivery-validation.test.ts contracts/src/operations/release-publication.schema.test.ts --no-file-parallelism --reporter=verbose` → `4 files / 166 tests`，exit 0，1.48 s。
- 既有 136 tests PASS（36 schema / 32 structural / 21 archive fixtures），新增 Reviewer 诊断 30 项：10 字段矩阵、1 正例、10 首轮反例重放、2 bytes 类型/UTF-8 分支、6 错误接受反例、1 report-missing-Project 对照。首轮 10 个反例全部得到预期拒绝；R3 缺 Scope 成员的 6 个新反例断言漏洞现状，不能把诊断 exit 0 表述为验收通过。
- Archive 对照重算外层 Hash，独立失败落在预期 Batch/size 绑定；legacy golden 的业务 payload/Hash 不变，本轮该 fixture 仅更新 synthetic provenance 说明；8 个 operation 保持未注册。
- `git diff --check <base> <head>` PASS；临时诊断在发布前移除，本轮产品代码未改。正式记录按实际内容做 Prettier Markdown 格式检查；不将该本地记录冒充 reviewed SHA/CI 的组成部分。

### 本轮未运行边界与交付

8 个 D12 public operations/handlers、当前 ART/EP/QG readers 与 VERIFY 闭包、实际 Policy/Renderer profiles、Batch/Attempt/archive 业务 persistence/migrations、真实 ZIP/manifest Markdown producer、object storage/controlled stream、OIDC/public HTTP/UI/BFF、客户发送、部署与独立人工验收仍为 `NOT RUN`。既有 PostgreSQL gate PASS 不升级这些边界。

请 Implementer 在 #272 已批准范围内补齐 R3 必填来源 Scope、干净单项 fixtures 与 owning 文档，再按新 head 独立复审。适用 Human technical approval 保留为后续 delivery Gate，不制造批准证据。

本轮仅追加/更新正式审查记录，未 commit/push，未修复业务实现、merge、部署或关闭 Issue。

### 本轮 GitHub comment 发布与读回

- [第二轮复审总评](https://github.com/qzhike/zhiju-business-core/pull/276#pullrequestreview-5488046662)：review ID=`5488046662`，state=`COMMENTED`，submittedAt=`2026-10-12T08:13:26Z`，commit_id=`705991c71c67b28aa2804314d647a4cf752cad8e`。
- [R3 剩余问题行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4245900204)：comment ID=`4245900204`，`modules/release-publication/src/project-delivery-validation.ts:209`，RIGHT；commit_id/original_commit_id 均为本轮 reviewed SHA。
- 独立读回总评完整正文、评论列表及单条 comment endpoint；正文、path、line、side、commit_id 与准备的意见逐项一致。发布后 PR 的 head/base 未变，仍 OPEN / ready。
- 实际提交为 `COMMENTED` review，Reviewer 流程结论为 `REQUEST_CHANGES`。本轮没有 GitHub 原生 Request changes/Approve review，没有修复、commit、push、merge、部署或 Issue 关闭。
- 正式记录保留首轮历史并追加本轮结论，仍为本地未跟踪文件；Markdown 格式检查 PASS。临时诊断已删除，工作区无产品实现改动。

## 第三轮独立复审（8f57ca2）

Reviewer outcome：`REQUEST_CHANGES`。R1/R2/R4/R5/R6 保持 CLOSED；R3 上一轮 canonical 缺 Scope 反例已修复，但新的 owning objectType 表遗漏当前公开 Contract 的实际 Run/AgentResult 拼写。

- Reviewed SHA：`8f57ca2707ca525fc817acd065dfdc450412f66f`。
- Base SHA：`436f357fb921b593da2c4dfc57a8bbfdb112830d`。
- 日期：2026-10-12；PR OPEN / ready；本地 HEAD 与远端 head 相同；Issue #272 的 Goal/Acceptance/Scope/Verify 未变化。
- 阅读并比较实际增量 `705991c` → `8f57ca2`，只有 pure validation、结构反例与 REL owning Spec/Test 四个文件。前两轮结论和当时 comments 全部保留。

### 字段矩阵与修复核对

沿用前文已逐字段核对的完整 named-contract 清单；本轮没有 closed schema、generated types 或 Hash 输入变更，不重复运行同一个静态字段比较。实际增量只影响 ProjectDeliveryEntry.provenance 的 Scope 判定及两种报告反例，其他 named contract/required/optional/集合/枚举仍按原矩阵。

| 受影响边界                                                                                  | 本轮核对                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry 全部 15 字段 / Provenance 两字段及 ART 三 required、八 optional 来源字段              | 属性与 shared 类型定义不变。按 owning objectType 分流 Scope 的思路与原要求一致，canonical 反例已拒；但已发布 execution.run/agent_result 不在表内，详见 R3。 |
| WorkOrder/Run/AgentResult 既有 canonical 来源                                               | 空 Scope 与缺 projectId 的上一轮六种单项反例全部按 PROJECT_DELIVERY_MANIFEST_INVALID 拒绝，首版 Human-only 与 Enterprise-only Principal 原正例保持有效。    |
| sourceReportRefs                                                                            | wrong-Project 与 missing-Project 的两个已签入 fixture 现已正确区分；两者独立通过真实入口得到拒绝。未注册报告类型仍保留 owning-resolution/合法空集合边界。   |
| Manifest/DependencyProof、BatchRef/View、ArchiveRef/Descriptor/Validation、辅助值与固定常量 | schemas/generated/hash functions 无增量变化；前两轮完整字段与 R1/R2/R4/R5/R6 闭合证据仍适用，当前 144 项聚焦既有测试全部通过。                              |

### R3 剩余问题：Scope 表未覆盖实际 owning 公开拼写

定位：`modules/release-publication/src/project-delivery-validation.ts:231`，RIGHT，本轮 reviewed SHA。

上一轮 canonical WorkOrder/Run/AgentResult 的 6 个缺 Scope 反例现在都被拒绝，但这个表只列了 `zhiju.execution.run` / `zhiju.execution.agent_result`。TaskExecution 的当前 FULL 公开 Contract `execution.record_run_result@1.0` 的 target/result 明确使用 `execution.run`，payload/result 明确使用 `execution.agent_result`：见 `contracts/src/operations/task-execution.schema.ts:1944–1949` 与 `contracts/src/generated/public-api.ts:730–750`。这两种已发布引用在这里不命中 PROJECT，落入只比较已声明成员的分支。

独立正例先把 `manifest-valid.json` 的第二个 entry 来源 ref 设为上述真实 owning 拼写，保留完整 Scope：它同时通过 `ContractRegistry.validateOperationResult('execution.record_run_result', '1.0', {runRef,status:'RESULT_RECORDED',agentResultRef})`、D12 Manifest Schema 和纯校验，确认 baseline 使用的是 Owner 实际声明的完整 Ref，而非猜测 selector。随后每次只把一个 ref 的 Scope 改成 `{}` 或 `{enterpriseId}`；`runRef` 和 `agentResultRef` 的 4 个单项反例均仍通过 D12 Schema 与 `validateProjectDeliveryManifest`。

REL §14.2 要求 Project-owned 来源保留完整同一 Enterprise/Project Scope，并原样保存 owning Ref；Run/AgentResult 的 Domain 归属不会因公开拼写不带 `zhiju.` 而变成 Platform。请按 Owner 实际公开的字面拼写补齐 Scope 判定，至少覆盖 `execution.run` / `execution.agent_result`，并核对本表其他已消费类型与其 owning 接受集。不要把原 Ref 改写为另一拼写来满足检查，也不要把已有 owning 拼写登记成新的业务类型。

补签入这两种实际公开拼写的完整 Scope 正例及各自的空 Scope / 缺 projectId 反例，保留当前 canonical 与合法 Enterprise/Platform 来源的验收，再同步 REL §14.8 / Module-Test 的完成声明。这仍是 R3 原有的纯 Scope/完整引用要求，不增加运行链路、Repository 读取或对象存在性认证范围。

直接 owning 证据：

- `contracts/src/operations/task-execution.schema.ts:1944–1949` 的 `execution.record_run_result` 完整 payload/result，及同文件 validate_agent_result 的 refs，固定 Run=`execution.run`、AgentResult=`execution.agent_result`。
- `contracts/src/generated/public-api.ts:730–750` 声明该 operation 为 `task-execution / FULL`，targetObjectType/result references 与上项一致。
- REL §14.2 的完整同 Scope Project-owned Ref 规则及 Domain Run/AgentResult 的 Enterprise/Project 归属不因字面拼写改变；不将 TaskExecution 的历史/现行拼写规范化为另一 Ref。

独立正例使用原 fixture 的精确字段，仅将第二个 entry 的 Run/AgentResult 改为当前 owning 公开 Contract 的真实拼写，并保留完整 Scope。除 D12 Schema/pure validation 外，它还通过 `ContractRegistry.validateOperationResult('execution.record_run_result', '1.0', {runRef,status:'RESULT_RECORDED',agentResultRef})`；该结果仅证明 synthetic 值满足 owning named schema，不宣称真实 Result/Receipt 已存在。四个负例各仅修改一个 Ref 的 Scope：

| 来源 objectType        | Scope 单项修改       | 当前实际结果                             | 预期                      |
| ---------------------- | -------------------- | ---------------------------------------- | ------------------------- |
| execution.run          | scope={}             | Manifest Schema valid=true；纯校验无错误 | 拒绝缺 Enterprise/Project |
| execution.run          | scope={enterpriseId} | Manifest Schema valid=true；纯校验无错误 | 拒绝缺 projectId          |
| execution.agent_result | scope={}             | Manifest Schema valid=true；纯校验无错误 | 拒绝缺 Enterprise/Project |
| execution.agent_result | scope={enterpriseId} | Manifest Schema valid=true；纯校验无错误 | 拒绝缺 projectId          |

这是 R3 原有的 Project-owned 来源 Scope 完整性缺口，不是新 Runtime 支持要求；请在实际 owning 接受集内补齐判定与 fixtures，保留 Scope 合法形式和原字面引用，不改写上游 Contract。

### 本轮验证证据

- 新一轮只读 `gh api user --jq .login` PASS；`vibe repo --json` PASS；本地 HEAD 与 reviewed SHA 一致，初始仅存在前两轮未跟踪正式记录。
- [CI run 38224703604](https://github.com/qzhike/zhiju-business-core/actions/runs/38224703604) metadata.headSha 精确匹配 reviewed SHA，select/checks/persistence/verify 全 SUCCESS；select `target=full`。CI 的 PR merge revision 为 `d25cf353b5675185d1a1af8b0d69c93e5e58b525`（本轮 head + 当前 base），与本地 pure-head source 诊断分开。复用当前 CI，没有重复本地 full。
- [Implementer 本地证据](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6121168361) 报告相同 head 的 `vibe verify full --json` PASS（1822 s）；[CI 读回](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6121377731) 已提供。其“R3 closed”总结不作为独立闭合依据。
- 独立聚焦：`node node_modules/vitest/vitest.mjs run .tmp-pr-276-third-review.test.ts modules/release-publication/src/project-delivery-hash.test.ts modules/release-publication/src/project-delivery-validation.test.ts contracts/src/operations/release-publication.schema.test.ts --no-file-parallelism --reporter=verbose` → `4 files / 157 tests`，exit 0，1.43 s。既有 144 tests PASS（36 schema / 40 structural / 21 archive），Reviewer 13 项：原正例、6 个上轮反例拒绝、1 个 actual-owning 类型正例、4 个漏洞现状反例、1 个报告 fixture 区分对照。4 个 accepted-incomplete-ref 断言不能记为验收通过。
- `git diff --check <base> <head>` PASS；旧 Package golden、set/hash vectors、兼容边界和八个 operation 未注册的既有测试保持通过。
- 本轮临时诊断在发布前删除，仅更新正式记录；记录按实际内容做 Prettier Markdown 格式检查，不作为 reviewed SHA/CI 内的文件。

### 未运行边界与交付

8 个 D12 public operations/handlers、当前 ART/EP/QG readers 与 VERIFY 闭包、实际 Policy/Renderer profiles、Batch/Attempt/archive 业务 persistence/migrations、真实 ZIP/manifest Markdown producer、object storage/controlled stream、OIDC/public HTTP/UI/BFF、客户发送、部署与独立人工验收仍为 `NOT RUN`。full 的既有 PostgreSQL PASS 不升级这些范围。

继续由 Implementer 在 #272 原范围内补齐实际 owning 拼写的完整 Scope 与干净正负 fixtures、同步 owning 文档，再按新 head 独立复审。适用 Human technical approval 保留为 Issue Verify 的 delivery Gate。

本轮未修改产品实现、commit、push、merge、部署或关闭 Issue；正式记录仍为本地未跟踪文件。

### 本轮 GitHub comment 发布与读回

- [第三轮复审总评](https://github.com/qzhike/zhiju-business-core/pull/276#pullrequestreview-5488900632)：review ID=`5488900632`，state=`COMMENTED`，submittedAt=`2026-10-12T09:35:06Z`，commit_id=`8f57ca2707ca525fc817acd065dfdc450412f66f`。
- [R3 actual-owning 拼写缺口行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4246545475)：comment ID=`4246545475`，`modules/release-publication/src/project-delivery-validation.ts:231`，RIGHT；commit_id/original_commit_id 均为本轮 reviewed SHA。
- 已独立读回总评、评论列表和单条 comment endpoint；完整正文、定位、side 与 SHA 均与提交材料一致。发布后回读 PR head/base 未变，仍 OPEN / ready。
- 本轮实际提交为 COMMENTED review，流程结论为 REQUEST_CHANGES；未提交 GitHub 原生 Request changes/Approve review，未执行产品修复、commit、push、merge、部署或 Issue 关闭。
- 正式记录保留三轮历史与当前结论，保持本地未跟踪；Markdown 格式检查 PASS。临时诊断已删除，工作区无产品实现修改。

## 第四轮独立复审（aa91a2a）

Reviewer outcome：`REQUEST_CHANGES`。R1/R2/R4/R5/R6 保持 CLOSED；R3 的公开 Run/AgentResult 拼写问题已修复，但历史 ProjectContext 来源尚未获得完整 Scope 检查。

- Reviewed SHA：`aa91a2a65f9c373e8ffc79d90dfd0b6676bbff4e`。
- Base SHA：`436f357fb921b593da2c4dfc57a8bbfdb112830d`。
- 日期：2026-10-12；PR OPEN / ready；本地 HEAD 等于远端 head；Issue #272 的 Goal/Acceptance/Scope/Verify 未变化。
- 本轮检查实际增量 `8f57ca2` → `aa91a2a` 的六个相关文件（纯校验、聚焦测试、正负 fixture、REL Spec/Test），没有修复产品实现。前三轮结论保留为历史。

### 完整字段矩阵与本轮闭合状态

closed schema/generated/Hash functions 本轮未改，前文全部 named-contract 的 properties/required、可选字段、集合/枚举、复合 Ref 与 Hash 输入矩阵继续适用；本轮沿 ART RevisionProvenance 的全部来源字段复核 owning 语义及字面接受集。

| provenance 字段                           | owning 语义 / 本轮核对                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| principal、actingForRef                   | PrincipalRef；合法 Enterprise/Platform 形态不强塞 projectId。原始 Manifest 的 Enterprise-only Principal 与 Human-only 空执行来源保持通过。                                            |
| taskRef                                   | ObjectRef<Task>；当前及公开 execution.task/zhiju.execution.task 同属 Project；新增拼写完整 Scope 正例与缺 projectId 负例通过。                                                        |
| workOrderRef                              | ObjectRef<WorkOrder>；execution.work_order/zhiju.execution.work_order 已入表；新增公开拼写的完整 Scope 正例与缺字段负例通过。                                                         |
| runRef、agentResultRef                    | 对应 Run/AgentResult，现行公开 execution.* 与 registry namespace zhiju.execution.* 全部纳入；上轮四项公开拼写 Scope 反例拒绝，新增 standalone positive 与 owning Result Schema 匹配。 |
| contextSnapshotRef                        | SnapshotRef<ProjectContext>；canonical zhiju.execution.context_snapshot 已保护，共享 API #167 保留的历史 zhiju.project.context_snapshot 未保护，见本轮 R3。                           |
| templateBaselineRef、regulatoryProfileRef | VersionedRef<TemplateBaseline/RegulatoryProfile>；Enterprise/Platform 配置 owning 形式继续按已声明 Scope 成员处理，不扩大为业务配置解析/授权证明。                                    |
| sourceMaterialRefs、toolchainVersions     | SourceMaterial ContentAddressedRef 集合与 CanonicalJson 工具链记录；现有 Project source material Scope / set 规则及字段形状未改变。                                                   |

R1/R2/R4/R5/R6 的闭合代码与 owning Contract 未变化；149 个既有聚焦测试验证了当前修订的原 Hash、Scope、Markdown、材料大小与旧兼容边界。R3 上轮 Run/AgentResult 部分正式闭合，整体仍 OPEN。

### R3 剩余问题：历史 ProjectContext 来源

定位：`modules/release-publication/src/project-delivery-validation.ts:236`，RIGHT，本轮 reviewed SHA。

本轮已经正确拒绝 `execution.run` / `execution.agent_result` 的上一轮四个反例，但 ContextSnapshot 只列了 `zhiju.execution.context_snapshot`。ART §2 的 `RevisionProvenance.contextSnapshotRef` 是 `SnapshotRef<ProjectContext>`；共享 API 的「#167 Initial Context Result 与 canonical SnapshotRef」明确保留 `zhiju.project.context_snapshot` 为 Core v1.0 的历史读回身份，既有 `execution.get_context_snapshot@1.0` 的接受集/读回语义不变，禁止把历史 Ref 仅凭 objectId 改写成 canonical 名称。它仍是 ProjectContext 来源，不是 Platform 配置。

独立正例在合法 Manifest 第二个 entry 的 provenance 中加入一个完整 Project Scope 的 `SNAPSHOT/zhiju.project.context_snapshot`：它通过已注册 FULL `execution.get_context_snapshot@1.0` 的 Payload Schema，也通过 D12 Schema 与 `validateProjectDeliveryManifest`。以这个正例为 baseline，仅把该 Ref.scope 改成 `{}`，或只删除 `projectId`，两个单项反例仍同时通过 D12 Schema/纯校验；相同操作对 canonical `zhiju.execution.context_snapshot` 则正确拒绝。原因就是历史拼写不在本表，落回 declared-member 分支。

REL §14.2 仍要求所有 Project-owned 来源完整绑定同一 Enterprise/Project；新增入口只产生 canonical 身份不等于历史读回来源可以省略 Project Scope。请在 D12 消费边界按 `SnapshotRef<ProjectContext>` 的 owning 语义检查完整 Scope，或完整覆盖其已批准的现行/历史接受集，至少纳入 `zhiju.project.context_snapshot`。保留原 Ref 拼写，保持旧 Query/shared schema 接受集不变，不新增历史 producer、不注册新类型，也不读他方 Repository。

补签入历史 Context 来源的完整 Scope 正例、空 Scope / 缺 projectId 的干净反例，并同步 REL §14.8 / Module-Test 的完成声明。这仍是 R3 的原有 Scope 完整性要求；仅按当前生产入口拼写列举不能证明该 provenance 字段的全部合法来源都受保护。

Owning 依据：[ART §2 RevisionProvenance](../../module-specs/Module-Spec-004-Artifact.md#2-模块类型) 的 `contextSnapshotRef?: SnapshotRef<ProjectContext>`、[共享 API #167](../../api-contract-v0.1/API-Contract-v0.1.md#167-initial-context-result-与-canonical-snapshotref) 的明确历史 namespace 读回边界、`contracts/src/operations/task-execution.schema.ts` 的 initialContextCommandResult 注释和既有 get_context_snapshot payload/result、`contracts/src/core.schema.test.ts` 保留的历史 Ref 实例。历史与 canonical 身份不能仅凭 objectId 互换；本修复只应在 D12 新消费边界落实既定完整 Scope，不改变旧 Query/shared 接受集。

独立最小对照：从合法 Manifest 加入一个形状完整且带本 Project Scope 的历史 Context Ref，经过 owning registered Payload Schema / D12 Schema / 纯校验正例。随后分别仅修改该 Ref 的 Scope：

| contextSnapshotRef.objectType    | Scope                   | D12 Schema / 纯校验当前输出 | 本边界预期               |
| -------------------------------- | ----------------------- | --------------------------- | ------------------------ |
| zhiju.execution.context_snapshot | 完整 Enterprise/Project | 接受                        | 接受                     |
| zhiju.execution.context_snapshot | 删除 projectId          | Schema 接受，纯校验拒绝     | 纯 Scope 拒绝            |
| zhiju.project.context_snapshot   | 完整 Enterprise/Project | 接受                        | 保留历史完整 Ref         |
| zhiju.project.context_snapshot   | {}                      | 都接受                      | 拒绝缺完整 Project Scope |
| zhiju.project.context_snapshot   | {enterpriseId}          | 都接受                      | 拒绝缺 projectId         |

历史身份的合法性由明确 owning 文档和保留 fixture 建立；Query Payload Schema 对照只证明形状兼容，不作为任意 objectType 的真实性证明。上述 synthetic Ref 不声称真实 Snapshot/Receipt 存在，检查不读取其他模块 Repository。

### 本轮验证证据

- 新一轮只读 `gh api user --jq .login` PASS；`vibe repo --json` PASS；本地/远端 SHA 匹配，初始仅有前三轮未跟踪的正式记录。
- [CI run 38231673140](https://github.com/qzhike/zhiju-business-core/actions/runs/38231673140)：headSha 精确匹配本轮 SHA，select/checks/persistence/verify 全 SUCCESS；select `target=full reason=ready-or-main-non-document-change changed_path_count=21`。实际 CI checkout 为 `ffe916624b94eb7658e44bbe2aae8be7217fabe2`（head + 当前 base），与本地 pure-head source 诊断区分。复用当前 CI，没有重复本地 full。
- PR [本地 fix-head 证据](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6122191803) 报告相同 head 的 `vibe verify full --json` PASS（1797 s），另有 [CI 回读](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6122387356)。其中“所有来源已覆盖”的声明经上述 owning 字段核对仍不成立，不用作者总结作为批准依据。
- 独立聚焦命令：`node node_modules/vitest/vitest.mjs run .tmp-pr-276-fourth-review.test.ts modules/release-publication/src/project-delivery-hash.test.ts modules/release-publication/src/project-delivery-validation.test.ts contracts/src/operations/release-publication.schema.test.ts --no-file-parallelism --reporter=verbose` → `4 files / 160 tests`，exit 0，1.95 s。既有 149 tests PASS（36 schema / 44 structural / 21 archive fixtures + owning-spelling positive）；11 项 Reviewer 诊断为原始正例、4 项上一轮反例拒绝、2 项 Task/WorkOrder 对照、canonical Context 对照、historical Context 完整 Ref 正例、2 项错误接受反例。后两项断言漏洞现状，不能记为验收通过。
- 149 项测试中的 new published-spelling positive 经过 owning Result Schema；本轮额外核对 fixture 的两个 source Ref 与该 Result 实例一致，D12 注入结果通过。四个公开拼写缺 Scope 单项反例均按正确稳定码拒绝。
- `git diff --check <base> <head>` PASS；旧 golden/hash/compatibility、Shared/旧 operation 接受集与八个 D12 operation 未注册边界保持通过。
- 临时诊断在发布前删除；本轮只追加正式记录并做 Prettier Markdown 格式检查，该本地记录不是 reviewed SHA/CI 的组成部分。

### 未运行边界与交付

8 个 D12 public operations/handlers、当前 ART/EP/QG readers 与 VERIFY 闭包、实际 Policy/Renderer profiles、Batch/Attempt/archive 业务 persistence/migrations、真实 ZIP/manifest Markdown producer、object storage/controlled stream、OIDC/public HTTP/UI/BFF、客户发送、部署与独立人工验收仍为 `NOT RUN`。既有 full PostgreSQL PASS 不升级这些范围。

由 Implementer 在 #272 原范围内闭合 ProjectContext 来源的现行/历史身份 Scope 与干净 fixtures、同步 owning 文档后，再对新 head 独立复审；不新增历史 producer，不规范化 Ref，不注册新业务类型。适用 Human technical approval 继续按 Issue Verify 的 delivery Gate。

本轮未修复产品实现、commit、push、merge、部署或关闭 Issue；正式记录仍保持本地未跟踪。

### 本轮 GitHub comment 发布与读回

- [第四轮复审总评](https://github.com/qzhike/zhiju-business-core/pull/276#pullrequestreview-5490762810)：review ID=`5490762810`，state=`COMMENTED`，submittedAt=`2026-10-12T12:28:04Z`，commit_id=`aa91a2a65f9c373e8ffc79d90dfd0b6676bbff4e`。
- [R3 历史 ProjectContext 来源行内 comment](https://github.com/qzhike/zhiju-business-core/pull/276#discussion_r4247993185)：comment ID=`4247993185`，`modules/release-publication/src/project-delivery-validation.ts:236`，RIGHT；commit_id/original_commit_id 均为本轮 reviewed SHA。
- 已独立读取总评、评论列表和单条 comment endpoint；完整正文、path、line、side、SHA 与提交材料一致。发布后 PR head/base 未变，仍 OPEN / ready。
- 本轮实际提交为 COMMENTED review，流程结论为 REQUEST_CHANGES；没有 GitHub 原生 Request changes/Approve review，没有执行产品修复、commit、push、merge、部署或 Issue 关闭。
- 正式记录保留四轮历史与当前结论，仍为本地未跟踪；Markdown 格式检查 PASS。临时诊断已删除，工作区无产品实现修改。

## 第五轮独立复审（23d297d）

Reviewer outcome：`APPROVE`。R1–R6 全部 `CLOSED`；R3 的历史 ProjectContext 来源完整 Scope 缺口已闭合，本轮未发现新增阻塞问题。

- PR：[#276](https://github.com/qzhike/zhiju-business-core/pull/276)，OPEN / ready；Issue [#272](https://github.com/qzhike/zhiju-business-core/issues/272)，T2 implementation。
- Reviewed SHA：`23d297d84f5a7e6a5b8cca963ebc720924b326ad`。
- Base SHA：`436f357fb921b593da2c4dfc57a8bbfdb112830d`。
- 日期：2026-10-13。入口为 `vibe-development` / Reviewer；`vibe repo --json` 确认本地 HEAD 等于最新 PR head。新一轮 standalone `gh api user --jq .login` PASS，身份为 `galendai`。
- Issue 的 Goal/Acceptance/Scope/Verify 未变化；未改变批准设计、冻结规则、模块所有权或首版范围。

本轮以 REL §14.2 的所有 Project-owned Ref 必须同 Enterprise/Project、ART 的 `RevisionProvenance.contextSnapshotRef: SnapshotRef<ProjectContext>`、共享 API #167 的历史读回身份规则建立预期。完整历史与 canonical 来源均须通过；空 Scope、缺 enterpriseId/projectId、foreign Enterprise/Project 须拒绝；原字面 Ref、既有 Query 接受集、Human-only 与合法 Enterprise/Platform 来源须保持。不把作者“R3 closed”声明作为独立批准依据。

### 实际增量与完整字段矩阵复核

相对第四轮 `aa91a2a`，实际增量为六个文件，151 additions / 5 deletions：纯校验 Scope 表、聚焦测试、来源拼写正例 fixture、结构反例 fixture、REL Spec 与 Module-Test。生产校验只增加 `zhiju.project.context_snapshot` 的 Project-owned 判定及 owning 理由；canonical 项保留，不改写名称或身份，不新增 objectType 注册，不读取他方 Repository。

完整逐字段矩阵保留在前文；下表为本轮逐项复核与状态更新。当前增量未改变 schemas、generated types、Hash functions 或类型生成 tooling；所有 required/optional、properties、引用与集合定义继续与上一轮矩阵一致。

| Named contract / 全部字段范围                                                          | 本轮复核                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ProjectDeliveryEntry 全部 15 required 字段                                             | 字段/集合/Markdown 与 complete Ref 定义未变；Revision exact Hash/immutableVersionId、Release/Package、path 与 Scope 回归通过；来源 Scope 缺口闭合。                                                                        |
| ProjectDeliveryManifest 全部 9 required 字段                                           | 版本、OBJECT batch 目标、Project/Plan、recipient、destinations、Policy、dependencyProof、entries 定义未变；必填与内部绑定保持通过。                                                                                        |
| ProjectDeliveryBatchRef / ProjectDeliveryArchiveRef                                    | Common 五 required 与可选 immutableVersionId、CONTENT_ADDRESSED kind/objectType 与完整 Project Scope 未变；Hash 域与 OBJECT target 绑定保持通过。                                                                          |
| ProjectDeliveryBatchView 全部 10 required 字段                                         | CONFIRMED、确认归因完整 Ref、generationRequestRefs 普通数组、currentUse 定义未变；前文字段矩阵继续适用。                                                                                                                   |
| ProjectDeliveryArchiveDescriptor 全部 15 required 字段                                 | OBJECT archiveRef、完整 Batch Hash、bytes checksum/size、checksum/path 集合与无自身 identity 域不变；材料回归通过。                                                                                                        |
| ProjectDeliveryArchiveValidation 全部 12 required 字段                                 | OBJECT attemptRef、完整 BatchRef、VERIFIED、无 Descriptor/self-ref 域与全部材料绑定不变；材料回归通过。                                                                                                                    |
| ProjectDeliveryChapterBinding 两字段 / ProjectDeliveryEntryChecksum 两字段             | required/closed properties、非空集合与稳定语义排序不变；重复与安全路径拒绝通过。                                                                                                                                           |
| ProjectDeliveryProvenance 两字段 / ART RevisionProvenance 全部三 required、八 optional | 未复制或收紧 ART Schema；task/workOrder/run/agentResult/context/sourceMaterial 的已知 owning 接受身份均要求完整同批 Project Scope。canonical 与历史 Context 都已保护；principal/actingForRef/config 仍按合法声明成员检查。 |
| ProjectDeliveryDependencyProof 全部五字段                                              | Policy typed refs、required/covered Set、hash 字段未变；Enterprise/Project 一致性与覆盖关系回归通过。                                                                                                                      |
| ProjectDeliveryCurrentUse 全部四字段                                                   | USABLE/BLOCKED/UNKNOWN、reasonCodes/sourceWatermarks 普通数组、named SourceWatermark 元素未变。                                                                                                                            |
| ProjectDeliveryRepresentationRef / ProjectDeliveryReleasePackageRef 与七个固定标量     | 完整共享复合引用及 D12 限定未变；固定版本/media/enums、legacy Package Hash/接受集保持通过。                                                                                                                                |

### R1–R6 闭合状态

| Finding | 状态   | 本轮依据                                                                                                                                                                                                                    |
| ------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1 / P1 | CLOSED | 完整 CONTENT_ADDRESSED Revision Hash/immutableVersionId 比较未改，既有反例保持拒绝。                                                                                                                                        |
| R2 / P1 | CLOSED | Descriptor/Validation BatchRef.contentHash 与完整 Manifest Hash 绑定未改，重算外层 Hash 的反例保持拒绝。                                                                                                                    |
| R3 / P1 | CLOSED | 历史 `zhiju.project.context_snapshot` 已加入完整 Scope 判定，和 canonical 身份共同通过正例及缺字段/跨 Scope 拒绝对照。先前 canonical/公开 Run、AgentResult 与其他来源反例保持拒绝；Enterprise-only Principal/配置保持有效。 |
| R4 / P2 | CLOSED | D12 `document.markdown` / `text/markdown` 定义不变，DOCX/XLSX/PDF 及错误 mediaType 回归保持拒绝；旧单 Revision Package 仍保留合法历史 DOCX。                                                                                |
| R5 / P2 | CLOSED | 提供 ZIP bytes 时实际字节长度与两处声明 size 的绑定不变，既有反例保持拒绝。                                                                                                                                                 |
| R6 / P2 | CLOSED | Policy rule 与 RecipientScope 必填 Project Scope 的 D12 Schema 限定不变，既有 Schema 反例保持拒绝。                                                                                                                         |

四个新增 Context 负例为两种字面身份 × 空 Scope / 缺 projectId。独立诊断确认每项原负例均由目标 Scope 约束拒绝；只恢复同批完整 Scope 后 Schema 与纯校验都通过，未被 unrelated defect 污染。历史来源完整引用也通过 owning `execution.get_context_snapshot@1.0` 的注册 Payload Schema；合法身份依据来自共享 API #167，不以开放 Schema 为凭据猜测 objectType。不同 literal Context Ref 仍产生不同 Manifest Hash，纯校验不改写输入。

REL §14.8 与 Module-Test-006 已同步历史接受身份、36/48/21 三类反例与 RP-D12-272-U-007；相应 PASS 只覆盖纯契约/结构子用例。八个候选操作、运行生产/下载链与更广 D12 验收继续 NOT RUN。PR body 的旧计数/首轮修复总结是历史证据，当前 owning 文档、最新 comments 和本次 exact-head 复审明确更新现状。

### 本轮验证证据

- [CI run 38261498502](https://github.com/qzhike/zhiju-business-core/actions/runs/38261498502) 的 headSha 为 `23d297d84f5a7e6a5b8cca963ebc720924b326ad`。select 日志明确 `target=full reason=ready-or-main-non-document-change changed_path_count=21`；实际 checkout 为 PR merge revision `3ac4f5be2cc6d83b71c09d828ed7c30fa3f927fa`（本轮 head + 当前 base）。当前 select/checks/persistence/verify 全 SUCCESS；workflow 的 clean code checks/build 与 Docker/PostgreSQL gate 覆盖项目 full 要求。复用当前证据，未重复本地 full，也没有将聚焦诊断当作 configured target。
- CI 当前为 run attempt 2。已独立读取 attempt 1 jobs：select/checks SUCCESS，persistence/verify FAILURE；同 head 的当前 attempt 2 全 SUCCESS。[作者 CI 说明](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6127527313) 报告首轮既有 `IP-257-005` 超时。base→head 对 `tests/persistence`、`apps`、`modules/identity-policy` 的 diff 为空；复审未独立复现该超时或证明根因，不将重试通过表述为稳定性问题已修复。
- [作者本地证据](https://github.com/qzhike/zhiju-business-core/pull/276#issuecomment-6126577974) 报告相同 head 的 `vibe verify full --json` PASS（1808 s）。当前 CI 和独立诊断为本轮主要验证依据。
- 独立聚焦：`node node_modules/vitest/vitest.mjs run .tmp-pr-276-fifth-review.test.ts modules/release-publication/src/project-delivery-hash.test.ts modules/release-publication/src/project-delivery-validation.test.ts contracts/src/operations/release-publication.schema.test.ts --no-file-parallelism --reporter=verbose` → `4 files / 174 tests PASS`，exit 0，2.23 s。既有 154 tests PASS（36 schema / 48 structural / 21 archive fixtures）；20 项 Reviewer 诊断 PASS：两种 Context 完整正例、各五种错误 Scope、四个 checked-in Context 负例的干净正例控制、旧 Query 接受集、Human-only/Enterprise 来源、不同字面 Ref 的 Manifest Hash 区分。
- `git diff --check <base> <head>` PASS。八个 D12 operations 未注册、旧操作 Schema/Package golden/hash 与域互异回归保持通过；Catalog/Registry 未变。
- 临时诊断已删除。开始及发布前 `git status --short` 仅显示本地未跟踪 `.vibe/reviews/pr-276/`，没有产品实现修改。

### 未运行边界与交付

八个 D12 public operations/handlers、当前 ART/EP/QG readers 与 VERIFY 闭包、实际 Policy/Renderer profiles、Batch/Attempt/archive 业务 persistence/migrations、真实 ZIP/manifest Markdown producer、object storage/controlled stream、OIDC/public HTTP/UI/BFF、客户发送、部署与独立人工验收仍为 `NOT RUN`。既有 full PostgreSQL PASS 不提升这些范围。

本轮为独立 agent 技术复审 `APPROVE`；适用 Human technical approval 和合并授权继续按 Issue Verify / 项目交付 Gate 执行。未修复产品实现、commit、push、merge、部署或关闭 Issue。正式记录保留五轮历史并保持本地未跟踪，Git 交付未授权。

### 本轮 GitHub comment 发布与读回

- [第五轮复审总评](https://github.com/qzhike/zhiju-business-core/pull/276#pullrequestreview-5498338461)：review ID=`5498338461`，state=`COMMENTED`，submittedAt=`2026-10-13T03:13:41Z`，commit_id=`23d297d84f5a7e6a5b8cca963ebc720924b326ad`。
- 已独立读取 review、review comments 列表和最新 PR 状态；完整正文与提交材料逐字符一致，绑定本轮 SHA，行内 comments 列表为空。发布后 head/base 未变，仍 OPEN / ready。
- 本轮实际提交为 COMMENTED review，流程结论为 APPROVE；没有提交 GitHub 原生 Approve review，没有执行产品修复、commit、push、merge、部署或 Issue 关闭。
- 正式记录保留五轮历史与当前结论，仍为本地未跟踪；临时诊断已删除，工作区无产品实现修改。Markdown 格式检查 PASS。
