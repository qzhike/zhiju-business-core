# PR #275 独立实现审查

- PR：<https://github.com/qzhike/zhiju-business-core/pull/275>
- Issue：[#270](https://github.com/qzhike/zhiju-business-core/issues/270)，T2 闭口 Markdown canonicalization / round-trip 技术管线。
- 审查日期：2026-10-11。
- 角色与结论：`Reviewer / REQUEST_CHANGES`。
- 已审 SHA：`6195c76ef00ce6933fba48eb99fda6553ec175e6`。
- Base SHA：`ec3bd6db7dec7294519ead17ad4a9cf69fb7b8af`。
- 已发表：[COMMENT review 5483294839](https://github.com/qzhike/zhiju-business-core/pull/275#pullrequestreview-5483294839)，2026-10-11 12:28:22 UTC；已读回 outcome、精确 commit_id 和全部 8 条 comments。
- 本记录由 Reviewer 在上述提交之后新增，不属于该 SHA 或其 CI；未 commit、push 或 merge。仅有此正式记录的工作区变更，临时探针已移出仓库。

## 独立判断依据与范围

本轮读取 `.vibe/project.yaml`、`vibe-development` Reviewer / Contract Review、HL-Spec 第 1–6、8–11 节、最新 Issue #270、ART §13.2/13.6、IG Markdown owning 章节与相关 Module-Test。先从验收及已批准设计建立预期，再检查实际 base-to-head diff、源代码、测试及精确修订 CI。

设计权威为 `d5ff5f0be1a492233f7ff3f0fac51b68a740a9de` 的 #259 Delta §3 和 ART §13.2，及 [PR #269 的精确修订人类设计批准](https://github.com/qzhike/zhiju-business-core/pull/269#issuecomment-6093748821)。直接比较该设计快照与被审修订：相关规范段落未被本实现重定义，新增了 #270 实现状态；已存在于当前 base 的 #260 增量不当作本 PR 的实现扩展。

独立预期：

1. 支持语法的初次解析保留标题、原编号、空格、硬换行、格式和表格结构；round-trip 相等不能掩盖初次解析已经丢失的语义。
2. 受信 sidecar 与精确 Artifact/Project、document、base/mapping、candidate output 和 raw bytes 绑定；每个 node / column 必须完整对应实际解析结果，不能凭节点数量或文本相似度认定身份。
3. 注册 selector/version、封闭字段和 graph 规则在公开 validator / renderer 边界生效；危险内容和未知扩展拒绝，inline code 内按 literal text 处理。
4. 文件、Unit、深度、表规模、文本和资源预算必须实际限制输入；raw hash 与 cv1 canonical content hash 保持分域。
5. 只评审本 Issue 的技术库、schema 和导入的必要设计，不要求非目标中的 TE 业务链、持久化 Handler、公开下载或 Browser 流程。

## Contract 字段对账

以下按实际新增 named definitions 对账，含 required/optional、枚举和集合语义。`U` 表示各 Unit 必填的 `unitId/unitType/ordinal/childUnitIds/semanticMetadata`；`O` 表示可选 `parentUnitId/evidenceRefs`。`childUnitIds` 按原 Canonical 身份关系唯一，`evidenceRefs` 保持既有 Set 语义；其余普通数组没有新增通用去重限制。

| Named Contract                   | Required 字段 / 接受集                                                                  | Optional / 条件 / 对账结果                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `markdownInlineSpan`             | `start/end/kind`；STRONG/EMPHASIS/CODE/HARD_BREAK                                       | code-point 半开区间及 HARD_BREAK 的 LF 检查存在；不嵌套，STRONG/EMPHASIS 可同区间组合。                      |
| `markdownInlineSpans`            | `markdownInlineSpan[]`，允许空数组                                                      | 普通有序数组，未加 `uniqueItems`。                                                                           |
| `markdownSectionMetadata`        | `markdown:{headingLevel,inlineSpans}`                                                   | headingLevel=1..6；对象闭合。                                                                                |
| `markdownParagraphTextMetadata`  | `markdown:{blockKind:TEXT,inlineSpans}`                                                 | 对象闭合。                                                                                                   |
| `markdownListItemMetadata`       | `markdown:{blockKind:LIST_ITEM,inlineSpans,listId,listKind,listOrdinal,listDepth}`      | `orderedMarker?` 保持 owning 表中的可选声明；ORDERED/UNORDERED、depth=1..6。未将可选字段提升为必填审查要求。 |
| `markdownThematicBreakMetadata`  | `markdown:{blockKind:THEMATIC_BREAK}`                                                   | 无 inlineSpans；对象闭合。                                                                                   |
| `markdownTableColumn`            | `columnId/ordinal/alignment`                                                            | NONE/LEFT/CENTER/RIGHT；顺序/重复由跨单元 validator 检查。                                                   |
| `markdownTableMetadata`          | `markdown:{columns,headerRowUnitId}`；columns 非空                                      | `captionUnitId?`；header 的真实首行约束缺失，见 R6。                                                         |
| `markdownTableRowMetadata`       | `markdown:{rowRole}`                                                                    | HEADER/DATA；对象闭合。                                                                                      |
| `markdownBlankTableCellMetadata` | `markdown:{columnId,valueState:BLANK,inlineSpans:[]}`                                   | 空 cell 禁 text；对象闭合。                                                                                  |
| `markdownTextTableCellMetadata`  | `markdown:{columnId,valueState:TEXT,inlineSpans}`                                       | TEXT cell 必填非空 text；对象闭合。                                                                          |
| `markdownDocumentMetadata`       | `fileKind/fileCode`                                                                     | `templateVersionText?`；五种 fileKind 与文档闭集匹配。                                                       |
| `markdownSectionUnit`            | U + `text`，unitType=SECTION                                                            | O；使用对应封闭 metadata。                                                                                   |
| `markdownParagraphTextUnit`      | U + `text`，unitType=PARAGRAPH                                                          | O；TEXT metadata。                                                                                           |
| `markdownListItemUnit`           | U + `text`，unitType=PARAGRAPH                                                          | O；LIST_ITEM metadata。                                                                                      |
| `markdownThematicBreakUnit`      | U，unitType=PARAGRAPH                                                                   | O；禁止 text，THEMATIC_BREAK metadata。                                                                      |
| `markdownParagraphUnit`          | TEXT/LIST_ITEM/THEMATIC_BREAK 的 oneOf                                                  | 无额外字段，按 blockKind 分支。                                                                              |
| `markdownTableUnit`              | U，unitType=TABLE                                                                       | O；禁止 text，TABLE metadata。                                                                               |
| `markdownTableRowUnit`           | U，unitType=TABLE_ROW                                                                   | O；parent 必须是 TABLE 的约束在 validator。                                                                  |
| `markdownBlankTableCellUnit`     | U，unitType=TABLE_CELL                                                                  | O；禁止 text，BLANK metadata。                                                                               |
| `markdownTextTableCellUnit`      | U + `text`，unitType=TABLE_CELL                                                         | O；TEXT metadata；parent 必须是 TABLE_ROW。                                                                  |
| `markdownTableCellUnit`          | BLANK/TEXT 的 oneOf                                                                     | 无额外字段。                                                                                                 |
| `markdownDocumentUnit`           | SECTION/PARAGRAPH/TABLE/TABLE_ROW/TABLE_CELL 的 oneOf                                   | 封闭形状及一般 graph 检查存在；本 profile 首行条件见 R6。                                                    |
| `markdownDocument`               | `documentId/title/units/metadata`；units 非空                                           | 无额外字段；Unit 上限的 parser enforcement 缺失，见 R4。                                                     |
| `markdownDocumentContent`        | `schemaRef/contentType:STRUCTURED_DOCUMENT/canonicalizationVersion:1/body`              | schemaRef 仅 generic VersionedRef，未核 registered selector，见 R5。                                         |
| `markdownIdentityMapNode`        | `sourceNodePath/unitId/type/ordinal`                                                    | `parentUnitId?`；五类 type 闭合，但 parent/ordinal/path 的实际对应缺失，见 R2。                              |
| `markdownIdentityMapColumn`      | `tableUnitId/columnId/ordinal`                                                          | 实际覆盖和对应检查缺失，见 R2。                                                                              |
| `markdownIdentityMap`            | `profileRef/artifactRef/documentId/candidateOutputId/markdownBytesSha256/nodes/columns` | `baseRevisionRef?/baselineMappingRef?`；形状及重复 node 检查存在；绑定和完整性见 R1/R2。                     |

新注册 JSON 与生成镜像一致；旧 Canonical schema / contentType / request_render@1.0 语义未在 diff 中变更。本轮没有把注册文件的静态封闭等同于运行时 selector 检查。

## 阻塞发现

### R1 / P1：sidecar 未绑定精确 Artifact、Project、base/mapping 和 output

位置：`modules/artifact/src/business/markdown-document-service.ts:1063`。

`assertIdentityBinding` 只比较 profile、documentId、Enterprise 和 raw digest。公开 parse 请求没有本次预期 Artifact/base/mapping 参数，`candidateOutputId` 也未与本次 derivation 对比。合法 fixture 中替换 Artifact objectId、同 Enterprise 的 projectId、candidateOutputId，或添加另一份形状合法的 baseRevisionRef/baselineMappingRef，仍继承原身份并得到相同 contentHash。

Issue Acceptance 第三项及 ART §13.2 要求错 Artifact/base/mapping 绑定拒绝、现有身份仅来自精确受信来源。应提供并核验 owning caller 的预期绑定和受信身份来源；保留受控技术 fixture provenance，不要求本切片伪造 TE Receipt。

### R2 / P1：数量相同不证明 sidecar 完整对应，parent/ordinal/columns 被忽略

位置：`modules/artifact/src/business/markdown-document-service.ts:1103`。

完整性仅比较 `units.length === map.nodes.length`。将每个 sidecar node 的 parentUnitId 改为不存在的父节点、ordinal 改为 999，parse 和 round-trip 仍成功，因为 materializer 重新计算关系而不比较声明。将一个真实 path 替换成唯一但不存在的 path，或将所有 column facts 换成不存在表的 column，仍成功；缺失项由 derivation 补出。

应将 materialized sourceNodes/sourceColumns 与 sidecar 逐项完整对账：精确 path、kind、身份、parent、ordinal、每张表 column 覆盖，无缺项、额外项或歧义；错误返回 IDENTITY_INVALID。不能以同长度或结构校验通过代替 correspondence。

### R3 / P2：列表续行吞掉硬换行和后续 ATX 标题，round-trip 无法发现初次丢失

位置：`modules/artifact/src/business/markdown-document-service.ts:564`。

输入 `- first  \n  second\n` 的两个行尾空格应形成 HARD_BREAK，当前变为 `text='first   second'`、spans=[]。输入 `- item\n# Heading\nbody\n` 得到一个 LIST_ITEM 的 `text='item # Heading body'`，没有 SECTION。这两份已丢失语义的 tree 都通过 round-trip 和 hash 比较。

应保留 marker 行与续行之间的原硬/软换行语义，并在列表扫描中识别结束列表的块边界；加入这些相邻结构的正向断言，直接检查初次 canonical tree，不能只依赖 parser 与 renderer 相互一致。

### R4 / P1：表格路径没有计算 Unit，绕过 100000 上限

位置：`modules/artifact/src/business/markdown-document-service.ts:438`。

普通段落调用 `#countUnit`，列表调用 `#countAstUnits`，table 分支只 scan/attach，不调用任何 Unit 计数。`'| h |\n|---|\n| v |\n\n'.repeat(20001)` 仅 380019 bytes，每张表均合法且远低于单表规模限制，却成功 materialize 100005 Units。更大同类输入还会进入 graph validation 和多次 canonicalization，注册的 Unit/资源边界失效。

应在 materialization 前计入 TABLE、全部 TABLE_ROW/TABLE_CELL，并及时执行统一预算与 deadline；越界整文件返回 LIMIT。增加低于字节上限、但超过 Unit 上限的有效表格负例。

### R5 / P2：公开 Markdown validator / renderer 接受未知 selector 和 version

位置：`contracts/src/registry.ts:193`。

对合法解析结果仅将 schemaRef.objectId/versionId 换为未注册 UUID，`validateMarkdownDocumentContent(...).valid` 仍为 true，`renderMarkdownDocument` 也成功。机器 schema 只引用 generic VersionedRef，invariant 没有调用已有 `isMarkdownDocumentSchema` 或等价的精确检查。固定注册 JSON loader 只约束部署注册文件，不能约束实际 caller payload。

应在这一唯一公开 validator 中校验 registered objectType/objectId/versionId、Enterprise Scope 及无 projectId 的完整接受集，使 renderer 的前置验证也生效；保留旧 profile 接受集。对应 Issue Acceptance 第一项和 ART §13.2/13.6。

### R6 / P2：TABLE.headerRowUnitId 可指最后一行，validator 仍成功

位置：`contracts/src/markdown-document.validation.ts:160`。

合法两行表中把第一行 role 改为 DATA，第二行改为 HEADER，并令 headerRowUnitId 指向第二行，graph 与 schema validator 均通过。renderer 把 D 行移到输出 header，把原 H 行放到数据区，实际顺序由坏 metadata 改写。当前检查仅要求同表/HEADER，没有 owning 规定的“真实首行”。

应核对 headerRowUnitId 与实际首个 row identity/ordinal 一致，并验证真实 header row 的唯一性及其 graph 关系；在公开 validator 加入合法 graph 的定向反例。ART §13.2 TABLE 明确要求真实首行，这不是新的规划决定。

### R7 / P2：不支持的 inline extension 被接纳为成功 literal 替代

位置：`modules/artifact/src/business/markdown-document-service.ts:724`。

输入 `~~removed~~` 被接纳为 TEXT、spans=[]；renderer 转义 tilde 后的结果仍通过 round-trip。profile 没有 strikethrough 类型，ART §13.2 与 Delta §3 要求识别未知 syntax / 不支持扩展后整文件 UNSUPPORTED，不能作为成功纯文本替代。

应对未转义的、不在允许集中的扩展作明确拒绝，并保留 contract 已允许的无法配对 star/backtick literal 规则；加入独立 negative fixture 及 escaped literal 对照。不能通过扩展 grammar 或静默降级来关闭此项。

### R8 / P2：全串危险语法预检查错误拒绝 inline code 的 literal 内容

位置：`modules/artifact/src/business/markdown-document-service.ts:636`。

`parseInline` 在解析 code span 之前对整个 source 执行 link/footnote/script regex。合法 `` `[label](https://example.com)` `` 返回 UNSAFE，而 `` `ordinary code` `` 正常接纳。这里没有外链执行或 DOM 解析，内容都在已批准 CODE span 内。ART §13.2 明确规定 inline code 内只按文字处理。

应按解析上下文识别危险语法和转义，CODE span 的内容保留 literal；同时保留 span 外真实链接、图片、HTML 等拒绝对照。避免把保留 code 文字误解为扩大外链接受集。

## 验证与证据边界

| 证据                        | 核对结果                                                                                                                                                                                                               | 边界                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository / exact revision | `vibe repo --json` 为 qzhike/zhiju-business-core、上述 head；远端 PR head/base 一致，发表前再次读取未变                                                                                                                | 初始工作区干净；本正式记录在之后新增。                                                                                                                                 |
| 当前配置门禁 CI             | [run 38133987026](https://github.com/qzhike/zhiju-business-core/actions/runs/38133987026) 的 headSha 为上述 SHA；select/checks/persistence/verify 全部 SUCCESS                                                         | 已核对 workflow 与实际步骤：clean + verify:code、clean build、Docker/PostgreSQL persistence gate 均执行，覆盖 ready PR 所需 full；复用当前 CI，没有重复本地 full。     |
| 独立定向反例                | `node node_modules/vitest/vitest.mjs run tests/business/pr275-review-probe.test.ts --reporter=default --reporter=json --outputFile=/private/tmp/pr275-review-probe-results.json`；最终 1 file / 15 tests PASS，2.59 秒 | 探针断言当前实现的具体错误行为；PASS 表示反例成功复现，不是产品满足契约。包括合法 parse/round-trip、错 raw hash 拒绝、普通 CODE 对照；只采用修正后形状合法的引用反例。 |
| 临时材料                    | 最终 probe 源保存在 `/private/tmp/pr275-review-probe.test.ts`；结果在 `/private/tmp/pr275-review-probe-results.json`                                                                                                   | 探针已从仓库删除；没有修改产品、registry、原测试或 owning 规格。不是并行任务计划或普通验证日志。                                                                       |
| Diff whitespace             | base-to-head `git diff --check` 的两处 trailing whitespace 是既有新增 fixture 中用于 HARD_BREAK 的两空格                                                                                                               | byte-exact 语义输入，不作为格式缺陷；未删除这些空格。                                                                                                                  |

本轮未把 optional orderedMarker 或实际 renderer parse 失败的错误码提升为新契约要求。所有报告缺陷均来自已有 Issue / 已批准 owning 语义，修复不需要新规划或范围扩展。

## 交付边界

- GitHub 已发表并读回 COMMENT review，包含上述 outcome、精确 SHA、证据和全部 8 条行内发现；发表后再次读取 PR，head 未变，review 状态为 COMMENTED。它不是 GitHub APPROVED / CHANGES_REQUESTED 事件。
- Issue #270 的新 T2 实现人类技术批准尚未提供；#269 的设计批准不替代本实现的精确修订批准。应先修复阻塞项，再独立复审修复 head 和其所需 CI，最后完成适用人类技术门禁。
- TE 准备/确认/执行与恢复、真实候选封存及 Head、公开 Diff/下载、Attempt/Binding/Representation、真实 Host/Runner/object store/OIDC/HTTP、Browser/平台及独立人工内容验收保持本切片的 `NOT IMPLEMENTED / NOT RUN`；本轮没有执行或要求扩展到这些非目标。
- 本轮不修复实现、不 commit/push、不合并。正式记录的 Git 交付独立待授权，不能声称本页已包含在 reviewed SHA 或其 CI。

## 已发表行内意见

| 发现    | GitHub 读回链接                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| R1 / P1 | [精确 identity 来源绑定](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564644)      |
| R2 / P1 | [完整 sidecar correspondence](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564647) |
| R3 / P2 | [列表硬换行与标题边界](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564649)        |
| R4 / P1 | [表格 Unit 预算](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564651)              |
| R5 / P2 | [未知 selector/version](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564657)       |
| R6 / P2 | [真实首行 HEADER](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564660)             |
| R7 / P2 | [未知 inline extension](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564664)       |
| R8 / P2 | [CODE literal 内容](https://github.com/qzhike/zhiju-business-core/pull/275#discussion_r4241564669)           |

正式记录的 focused Markdown fence/conflict 检查与单文件 Prettier 检查通过；这些只覆盖新 Review.md，不声称该页已经取得 reviewed SHA 的 CI 或新的配置 full 证据。
