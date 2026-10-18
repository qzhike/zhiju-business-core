# PR #301 独立审查

审查日期：2026-10-18。审查角色：独立 Reviewer。

## 结论与修订绑定

**APPROVE**：本次审查未发现阻止“macOS 环境 B 常驻设施与模板准备分析基础”交付的未解决问题。该结论只覆盖下列代码修订及其明确交付范围；不表示真实 Runner 分析链路或人工 E2E 已完成，也不替代最终 PR head 的远端检查。

- PR：[qzhike/zhiju-business-core#301](https://github.com/qzhike/zhiju-business-core/pull/301)。
- Reviewed head：`8aa56fc81397bf10984c79449a6dce3adbf3ecaa`。
- Reviewed base：`922165690dd01fb6e8b0ca7896b3c349cfe42d53`。
- 本次差异：100 个文件。Reviewer 独立重算全部差异文件原始字节的 SHA-256 清单，与已验证候选一致；清单 fingerprint 为 `24cea252140be16ac3dd1059c80a6111912557df8fdf8af05524efb5a8ddcb27`。
- 本记录新增后形成的提交必须单独复核；本节不预先批准未来 SHA。本记录写入时尚未取得最终 head 远端 CI 结果，不声称 CI 已通过。

## 范围与判断依据

按用户已批准的本机常驻环境、macOS 文件托管适配及模板分析方向，交付范围是独立 init/start/status/stop、持久数据库与测试身份初始化、不可变本机对象、实际公司模板和指令初始化，以及 analysis basis、preset@1.1、source@2.0 的契约与 owning 能力。旧准备入口、历史引用、环境 A 和生产 Ubuntu/S3 接受集保留。

Reviewer 从 PR、[模板分析决定](../../decisions/template-driven-preparation.md)、[EP 规格](../../module-specs/Module-Spec-002-EnterpriseProject.md#模板驱动准备分析2026-10-18)、[IP 规格](../../module-specs/Module-Spec-001-IdentityPolicy.md#模板驱动准备分析授权2026-10-18)及[本机适配批准](../../implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md#环境-b-首轮分析执行适配已批准)重建预期，再核对实际差异、实现与测试。本轮可见前次审查结论，因此不声称盲审；批准依据为当前代码与独立复核，不是 Implementer 的完成摘要。

重点不变量：模板资格不等于客户事实或项目权限；新 profile 不放宽旧版本；字节、版本、原请求及 Receipt 精确绑定；源损坏、未知调用和失权不得变成成功；存储丢失不得重新初始化为“从未存在”；服务运行不等于初始化完成或真实分析完成。

## 契约字段矩阵

下表列出本次新增/改变的命名边界。除明确可选字段外，所列字段均为必填；对象保持封闭。共享 TypedReference、ContentHash 和 UTC 类型沿原合同校验，没有改成开放 JSON。

| 命名边界                            | 字段与必要限制                                                                                                                                                                                                                                                                                                                  | 核对结果                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ep.preparation_analysis_basis@1.0` | `profile,basisCode,basisVersion,purpose,supportedRange,templateBindings,instructionBindings,vocabulary,requirementBindings,reportProfile,reportSchemaSha256`；精确 profile/purpose/reportProfile、SemVer、非空适用范围及实际 Schema SHA                                                                                         | 结构 validator 与 EP owning 校验分开；无规范发布占位字段                                                                                                                                                                                                 |
| `templateBindings[]`                | `templateCode,templateRef,sourceBytesSha256`；1–4096 项，code 稳定排序且 code/ref 唯一；TemplateVersion 为 Platform CONTENT_ADDRESSED，必含原生 `immutableVersionId`                                                                                                                                                            | 实际模板为 ACTIVE/PUBLISHED，独立核验源字节与精确 Ref                                                                                                                                                                                                    |
| `instructionBindings[]`             | `sourceId,bytesSha256,byteLength`；非空、sourceId 唯一、正安全整数长度、原字节 SHA；不接受 path                                                                                                                                                                                                                                 | 公司受控 reader 与部署 allowlist；客户路径不能替换指令                                                                                                                                                                                                   |
| `vocabulary`                        | `factType,riskLevel,productType,markets,choiceOptions,decisionOutcomes`；前四项及 mapping 值为非空唯一代码集合，mapping key 为公司代码                                                                                                                                                                                          | 初始化与固定公司定义逐项对应；不是模型输出配置                                                                                                                                                                                                           |
| `requirementBindings[]`             | `requirementCode,templateCode,locator`；非空，模板 code 必须存在，template+locator 唯一；同一 requirement 可对应多个不同位置                                                                                                                                                                                                    | owning reader 验实际、唯一 UTF-8 字节定位；不增加 requirementCode 全局唯一限制                                                                                                                                                                           |
| `PreparationAnalysisBasisSelection` | `basisRef,basisHash,publicationRef`；VERSIONED basis、独立 payload Hash、CONTENT_ADDRESSED basis publication，Platform scope                                                                                                                                                                                                    | 拒绝旧 company-rule publication 类型及不匹配身份/Hash                                                                                                                                                                                                    |
| basis publish / resolve / withdraw  | publish：`basisId,versionId,payload,effectiveFrom`，可选 `supersedesPublicationRef`；resolve：`payload,publicationRef,useStatus,checkedAt,sourceWatermarks`；withdraw：`publicationRef,effectiveFrom,reasonCode`                                                                                                                | HUMAN 发布/撤回、实际 Actor/Decision/Receipt；明确单后继与生效时间；resolve 是只读观察，后续步骤须重验                                                                                                                                                   |
| `ep.preparation_entry@1.1`          | `profile,presetCode,presetVersion,creation,memberPolicyTemplate,intakePolicy,analysisBasis,analysisHandoff`；creation：`mode,status,enterpriseInitialStatus,objective,enterpriseCodePrefix,projectCodePrefix`；policy：`ref,payloadHash`；handoff：`intent,analysisProfileRef,expectedReportProfileRef`                         | 精确匹配 @1.1，以 basis 替代 companyRules；旧 @1.0 validator 及公开准备请求线协议保持                                                                                                                                                                    |
| capture source @2.0 payload         | `projectRef,intakeManifestRef,templateRefs,analysisBasisRef,analysisBasisHash,analysisBasisPublicationRef,trustedDecisionRefs,purpose,audience`                                                                                                                                                                                 | templateRefs 为非空唯一集合；trustedDecisionRefs 固定空；拒绝 previousReportRef 与旧规则字段                                                                                                                                                             |
| capture source @2.0 result          | `preparationSourceRef,inputRefs,receiptRef,validUntil`                                                                                                                                                                                                                                                                          | 原来源/原 Receipt；inputRefs 仍为数组，不额外施加集合唯一性                                                                                                                                                                                              |
| get source @2.0 payload             | `preparationSourceRef,purpose,audience`                                                                                                                                                                                                                                                                                         | 精确 SNAPSHOT、目的与接收主体；授权 purpose/action/operation version 与 @1.0 分离                                                                                                                                                                        |
| `ep.preparation_source@2.0`         | `profile,projectRef,intakeManifestRef,templateRefs,analysisBasisRef,analysisBasisHash,analysisBasisPublicationRef,purpose,audience,sources,trustedDecisionRefs,coverage,omissions,redactions,validUntil`；source 元素：`sourceRef,bytesSha256,byteLength,objectRef,classification`，仅 `role` 可选；coverage：`acceptedSources` | 新旧 profile 不交叉读取；来源来自真实 intake/handoff 与已接纳 custody；空 decisions/omissions/redactions 的首轮语义保留                                                                                                                                  |
| get source @2.0 result              | `payload,currentUsability,reasons,validUntil`；状态为 USABLE/EXPIRED/STALE/UNKNOWN，reasons 为数组                                                                                                                                                                                                                              | 当前读权与当前可执行资格分开；历史读取不产生新来源                                                                                                                                                                                                       |
| Runner v0.2 原始 Schema             | report 根 18 项必填、36 个 `$defs`；validation 根 7 项必填；嵌套字段、可选项及条件分支保持上游原文件                                                                                                                                                                                                                            | 两文件逐字节与用户 Runner 目录一致；report SHA 为 `8b930eddd7df7caa0cc7a32c0316c95238f605b53dfac9be80bbb47bf43d944e`，validation SHA 为 `7ad84991e233ceaa4c5e2bd92e7a431c5cbc29a16ff6a85b009351fa0d8a1058`；注册结构 Schema 不等于完成语义证据或报告接纳 |

Reviewer 通过实际 ContractRegistry 与断言入口执行 73 项正向、必填删除及未知字段对照，另核验 6 项版本/集合边界：首轮 previousReportRef、非空 decisions、空或重复 templateRefs、新字段送入旧 source 均拒绝；result 的普通 inputRefs 数组允许重复。全部通过。公开 Registry 仅新增 source 的两个 @2.0 操作，当前 260 项；历史 200-operation baseline 不改。

## 关键实现与前次发现闭合

| 检查点                         | 当前实现与证据                                                                                                                                                                                                         | 结论                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 文件存储初始化中断恢复         | 先保存私有 intent/storeId，再排他建根；只有原 intent 指向的完整标记可恢复外部 binding。无 intent、缺失或外来标记、替换目录均拒绝。`environment-b.test.ts` 与 `file-object-store.test.ts` 覆盖原字节/身份保留及拒绝反例 | 前次 P2 已闭合                                                                      |
| source_v2 历史读取             | IP 明确将 `source_v2.read` 纳入历史读取分支，仍校验当前 Human/Service 会话、Grant、Scope；新的 capture 不因历史读权获准。实际 PostgreSQL 用例覆盖依赖撤回、错 Scope、过期和撤 Grant                                    | 前次 P2 已闭合；该 fixture 仅证明授权边界                                           |
| 源读取期间基准资格变化         | EP 在异步源校验后重新读取 withdrawal/successor，用同一时刻计算 status 与 checkedAt，返回前保留最终 authorization guard。PG 用例覆盖预定时间越界、另一事务提交撤回及最终失权                                            | 前次 P2 已闭合                                                                      |
| 首次 source capture 的项目状态 | 同一 owning 事务以完整 Scope 查询 Project 并 `FOR SHARE`；只允许 PREPARING。原成功 Receipt 重放位于新写入检查前，项目后来 ACTIVE 不生成第二份 Source                                                                   | 前次 P2 已闭合；新增测试为实际 service + 离线 SQL transport，不冒充 PG/RLS 并发验收 |
| 部署与持久性                   | 资源标签、实例/配置绑定、私有目录排除、稳定凭据、真实 owning 初始化、loopback 独立端口、生产 Web 构建门禁；停止不删数据，不杀不属于本实例的服务                                                                        | 符合本机设施范围                                                                    |
| 模块与旧版本                   | V7023 只扩展 EP-owned 不可变事实和唯一索引；原 migration checksum 不改；新 profile 显式分派，原请求回读保存的 selection；未安装能力明确不可用                                                                          | 未发现跨 owner 写入或版本暗替换                                                     |

## 验证证据与复用

当前 100 文件的内容清单与先前 `vibe verify full --json` 执行候选完全一致，因此依项目规则复用该完整结果，未重复启动昂贵 full/PostgreSQL gate。

- `full` 终态：`PASS`，`pnpm clean && pnpm verify`，退出码 0。
- 单元测试：149 文件、3,011 项通过。
- 浏览器：production 7 项与 fixture 53 项通过；后续工作区检查恢复正式 Web 构建。
- PostgreSQL：65 文件、748 项通过，包含 5 文件 / 96 项关键清单；二次迁移无待应用 migration，临时容器清理完成。
- 兼容基线：200 operations、14 schemas、200 envelopes，`compatibility=PASS`。
- Reviewer 当前执行：文件内容 fingerprint 对照、上述契约正负对照、上游两 Schema 原字节核对和 `git diff --check`，均通过。

本机接收的验证输出位于 `/private/tmp/zhiju-env-b-full-captured-20261018.log`，候选清单位于 `/private/tmp/zhiju-env-b-reviewed-candidate-20261018.json`。前者中段有明确的工具输出截断标记，保存了真实终态、计数及清理信息，不是完整 raw log；这些临时文件不作为仓库永久附件。最终远端检查由原会话唯一等待和回读，Reviewer 没有启动另一 CI waiter 或查询循环。

## 保留边界与后续门禁

1. 环境 B Core 登录的 `identity_policy_preparation_writer`、`identity_preparation_self_reader` 显式切换权限仍待单独批准；本 PR 未给 Core 增加这两项 membership。合并授权不等于实际数据库授权或部署授权。
2. TE preparation Task/WorkOrder/Context/Run、IG 真实 OMP dispatch 与恢复、EP 报告接纳/查询及 Web 展示尚未实现。基础分支可以交付，但“登录 → ZIP → 本机 OMP → 报告”手动闭环仍未完成。
3. 实际 Provider 调用、客户材料出网、真实 Runner 结果接纳、完整 source@2.0 PG/RLS 旅程、Windows/macOS Chrome/Edge 全矩阵及独立顾问人工 E2E 均为 `NOT RUN`；未执行生产 Ubuntu/S3 部署验收。
4. 本轮审查没有修改产品代码、数据库、环境 A/B 进程、Runner 项目或 Git 远端，也没有提交 GitHub review/comment。仅新增本项目要求的正式审查文档。
5. 父会话保存本记录后的最终 head 须做文档验证、独立差异复核与适用远端检查，再按用户已授予的合并及指定分支删除权限执行。不能用本记录预先覆盖未来代码变更。
