# PR #318 锁与恢复增量复审（2026-10-24）

本轮发现已在冻结工作区完成语义修复，未留下已知未处置的阻塞代码问题；当前不作最终 APPROVE。修复、必要文档及本 Review 尚待一起形成新 Git 候选，并通过其精确 head 的 full。下文 2026-10-23 记录及本节所述原始反例保留为审查历史，不能当作当前修复仍然开放，也不能把此前批准提升为新修订批准。

## 阶段、对象与独立预期

对象仍为 [PR #318](https://github.com/qzhike/zhiju-business-core/pull/318) / [Issue #311](https://github.com/qzhike/zhiju-business-core/issues/311)，阶段为修复子 PR 进入 `batch/mvp-b1-document-delivery`，不是 main 完整交付。`vibe repo --json` 确认仓库与分支，当前 HEAD 为 `7da8f7eea5c0c1af2a3fc97be8cee01e622f3f10`；本节审查该 HEAD 加未提交的锁、文件 store、Core runtime、恢复 guard、依赖、回归和必要文档增量。子 PR base 为 `89bbd41ee68257eae85ed4305f1d58519229fbef`；累计审查准备另核对 `main@fb8da30ad0cedfd3311eb3bee0b28a097ee7d120` 已是该 HEAD 的祖先。此时没有实际批次最终候选，不为其编造 Review 编号或批准。

依据 [MVP01 Spec §4.1–4.2](../../module-specs/Module-Spec-MVP01-DocumentDelivery.md#41-批次状态)、[MVP01 Test B1-08–13](../../module-tests/Module-Test-MVP01-DocumentDelivery.md)及批准的 B1 设计，独立预期是：同实例和同 attempt 排他；旧写者未证实结束不得放弃或替换；持锁检查和 Batch CAS 共同保护恢复；完整持久 staging 必须复用原固定输入；RECONCILE 只记录观察，不能借当前会话重授权旧 attempt；真实本机技术证据与正式来源人工验收分开。先按这些约束检查累计组合，再对实际代码和反例复核，没有依据 Implementer 的修复说明直接关闭发现。

## 本轮发现与处置

| ID | 原始问题与独立依据 | 当前处置 |
|---|---|---|
| R-BATCH-LOCK / P1 | stale socket 的 `probe → unlink → listen` 无原子保护。Reviewer 以真实临时 Unix socket 仅调整 unlink 调度，复现两个调用都成功且同时持锁；旧 release 的额外 unlink 也可能删除后继对象 | **CLOSED（工作区语义）**。固定 `.lock` inode 上的非阻塞 flock 覆盖整个持有期；socket 探测、残留回收和绑定均在其内；不删除 flock 文件。release 复用同一 Promise，先关闭 socket，再关闭锁 fd，无额外 unlink；未知探测错误保守拒绝 |
| R-BATCH-INSTANCE / P1 | `instanceLockPath` 原来只定义/导出，Core 恢复前没有实例锁。初次修复仍按 root 字符串生成键；Reviewer 又复现同一 store 经父目录别名通过相同身份检查，却取得两个实例锁 | **CLOSED（工作区语义）**。Core 在 startup/resume 前取得实例锁，关闭入口后等待工作结束和 DB 关闭再释放，启动失败释放。store 返回 realpath，runtime 与 service 的实例/attempt 键均使用 `store.root`。Reviewer 重跑别名反例后，两条路径的规范根和两类锁键相同，同时持有者为 1；实际 Core 别名启动拒绝有 HTTP 回归 |
| R-BATCH-RECOVERY / P1 | 服务端 ABANDON 可直接把活跃 RUNNING/UNKNOWN attempt 写成 ABANDONED，页面 permittedActions 不能阻止直接请求；其他恢复动作也未持旧 attempt 锁检查副作用 | **CLOSED（工作区语义）**。ABANDON 明确拒绝 UNKNOWN/RECEIVING/EXTRACTING；repository 在重放判断、Batch CAS 和归属检查后调用 service guard，取得全部旧 attempt 锁并 inspect，持有至事务提交或回滚后才释放。失败不写新 Request/attempt，不释放项目占用；同意图重放不重新执行 guard |
| R-BATCH-RECOVERY-STAGING / P1 | 初次 guard 和 RECONCILE 只查 original key；完整 staging 已 fsync、尚未 publish 时会被误判缺包，允许新 attempt 重传 | **CLOSED（工作区语义）**。受限 `inspectStaged` 检查原 attempt 的 staging key。完整 staging 阻止 RETRY；RECONCILE 持旧 upload 锁核对长度/hash，发布到原固定目标，回读后只收敛 STAGED，不创建 EXTRACT 或修改旧授权。目标目录先 fsync，再移除 staging 并 fsync 源目录；缺失/截断保留显式重试路径 |
| R-BATCH-DOCS / P2 | API Contract、UI01 Test 的 B1 索引及 UI01 Spec 状态仍将已执行的真实浏览器技术旅程整体写为 NOT RUN | **CLOSED**。三处改为准确引用已有受控及本机技术证据，覆盖和剩余项仍由 MVP01 Test 拥有；正式来源人工验收保持 NOT RUN |

前轮 XLSX R1 及 PR #312 已关闭问题的语义依据未被本轮改变。累计检查未发现 main 同步、有限 BFF 命名空间、旧认证复用或独立 DB/store 边界的新组合冲突；这不等于实际批次最终候选已完成 full 或人工验收。

## 回归有效性与验证证据

Reviewer 独立执行 `pnpm exec vitest run tests/business/mvp-locks.test.ts`，5/5 PASS，覆盖确定性的旧 stale 竞争窗口、同进程独立 fd、真实 SIGKILL 后跨进程争用、迟到重复释放、旧活跃 socket 和 symlink 文件拒绝。随后子进程 fixture 将持锁对象保留到外层变量，避免 GC 提前关闭 fd；该修订未改变产品锁逻辑。Reviewer 还独立执行 store 父目录别名正反诊断：修复前相同 storeIdentity/realpath 产生两个锁持有者，修复后规范根、instance 和 attempt 键一致，第二次获取被拒绝。诊断均为临时合成资源，未改变 B1/A/B 服务。

Reviewer 读取保存的原始聚焦日志，并核对对应测试源码与本次冻结输入：

- `lock-recovery-custody-canonical-focused.log`：2026-10-24 14:48:12 起，`mvp-document-delivery.test.ts` **30/30 PASS**；记录 focused passed、迁移检查及测试容器清理。覆盖真实活跃上传的 ABANDON 拒绝、旧 UPLOAD/EXTRACT 持锁拒绝、完整 staging 持锁不恢复及释放后原 attempt/字节复用、缺失/截断重试、published/staged 两种跨 epoch 恢复、原授权和 attempt 数量保留。
- 完整 staging 的 RETRY 负例已修正前提：batch 为 FAILED、permittedActions 含 RETRY、original 不存在、旧 attempt 已结束；完整 staging 拒绝且 batch/历史不变、无新 Request，截断对照允许新 attempt。它不再借 STAGED 状态或已存在 original 的无关拒绝证明 guard 正确。
- `lock-recovery-http-focused.log`：2026-10-24 14:47:03 起，`mvp-http.test.ts` **5/5 PASS**；记录 focused passed 和容器清理。实际 Core 验证同实例及父目录别名二次启动拒绝、正常关闭重开，以及数据库启动失败后同一实例仍可正常启动；原 HTTP 用例保留。
- 较早的 `lock-recovery-custody-focused.log` 同为 30/30 PASS；最终采用规范化 root 后的上述整文件重跑结果，不以旧 fixture 根路径混用证明持锁拒绝。

当前宿主实读为 Node `v24.19.0`、`darwin/arm64`；独立锁执行证明本机已实际加载原生绑定。依赖固定为 `fs-ext@2.1.1`、`@types/fs-ext@2.0.3`，pnpm 原生构建仅为该依赖明确启用；runbook 记录构建工具要求、停止旧 B1 Core 后升级、不得删除稳定锁文件及不支持同实例新旧版本并行。Implementer 另报告锁/XLSX 22/22、生产构建及受影响 lint/typecheck 成功；本记录不以这些报告替代新候选远端 full 或 Linux 原生兼容验证。

本轮冻结的关键输入 SHA-256 用于后续核对提交是否包含被审内容，不作为跨 SHA 复用 CI 的依据：

| 文件 | SHA-256 |
|---|---|
| `modules/document-delivery/src/custody/locks.ts` | `df7bb1d001773cb1a040a630ff3a6c25bc0ca670c233d6941ac227d92e103b21` |
| `modules/document-delivery/src/custody/file-store.ts` | `d3162d43c2a8210d82f739f4cabcc0730a25fff8753806eb208da756d383087e` |
| `modules/document-delivery/src/service.ts` | `7b29ecbcffa9b0d0079b173ecd8135b4239c533c3f8f11fa132027eb1f6b4da5` |
| `modules/document-delivery/src/persistence/repository.ts` | `8c2f57c8d9a2f3d592057ada84878cf8b170f0167c8d5a0919a4e098c9d03d9c` |
| `apps/api/src/mvp/runtime.ts` | `685a225b1e94dd1372ddf6163edaec99c51f243a44495f113896888e6a0f6d4b` |
| `tests/business/mvp-locks.test.ts` | `cb680b700b29901043cbe149adeaf7f7e56ce85c074976e08b301308353c44e3` |
| `tests/persistence/mvp-document-delivery.test.ts` | `f29049ee26b928d54e6df4f48dd6b5402d25b7df8286e445de741ca002b763d1` |
| `tests/persistence/mvp-http.test.ts` | `95afe198c821d426e299ad3ac5f792542780a0a406916636a84e54a20ec902b9` |

## 未完成门禁与范围边界

新候选尚未产生，当前阶段必需的 **full、三个持久化分片、精确 base/head/checkout 绑定和最终 Reviewer 确认均待完成**。此前绑定 `7da8f7e` 的任何成功 CI 不能覆盖本节源码、依赖及测试变化。最终确认通过 PR review/comment 发布，不为补记 CI 成功再次修改本记录。

本次只具备子 PR 进入 batch 的语义审查准备结果，不批准 main 合入、关闭完整 B1 Issue 或产品交付。实际批次仍须累计最终审查/full 和适用人类门禁；第一阶段合入后的 main full 保留，第二阶段证据复用未启用。

B1-14 正式来源人工试走与用户反馈仍 **NOT RUN**；DOCX 仅准备完成，真实 MD/XLSX 待补。锁层 SIGKILL 不是上传中真实 Core SIGKILL 的完整业务旅程；完整并发上传流、下载断流/CRLF、全部部分安装故障和其余 Test 明列边界均不因本轮聚焦通过而升级。B2–B5、Runner、S3/生产部署和 300+ 规模验证是既定非目标，不新增为本子 PR 阻塞。

Reviewer 本轮在仓库内只更新本正式 Review，未修改产品代码、提交、推送、写 GitHub、合并、启动 full/waiter 或改变 B1/A/B 服务。

---

# PR #318 增量复审（2026-10-23）

R1 的工作区语义修正已闭合；当前尚不作最终 APPROVE。包含修复、本正式 Review 和验收文案的新候选尚未冻结，其 full 与精确 SHA 最终确认仍待完成。下方首轮 REQUEST_CHANGES 及 OPEN 描述保留为历史，仅适用于当时的被审候选。

## 本次对象与处置

阶段和目标仍为 B1 修复/验收准备子 PR进入 `batch/mvp-b1-document-delivery`。本次独立复核对象为 `6105125e2d1b04c1f6823232b286b0d9225b05bf` 加未提交的 `formats.ts`、`mvp-custody.test.ts` 和 MVP01 Test 修订；`vibe repo --json` 确认 HEAD 仍为上述提交。源码与测试已由 Implementer 暂时冻结，正式 SHA 将在本记录完成后产生。

- **R1：CLOSED（工作区语义修正范围）**。`xlsx()` 现在从 workbook relationships 按 sharedStrings/styles 关系类型取得实际 target，解析内部路径后核对部件存在、Override/Default ContentType、相应 XML 根与安全 XML。默认路径的既有安全检查仍保留；已经验证的同一部件不重复扫描；同一累计 budget 继续传入，不新增资源预算或执行外部引用。
- **回归 fixture 已纠正**。原 sharedStrings 保留测试现在真正建立 workbook relationship 和 ContentType；四组默认/非默认 sharedStrings/styles 用例以合法基准生成缺 part、DTD、错误 namespace/root、错误 media、逃逸目标、重复关系等单项反例。合法内容、Default ContentType 与外链限制为独立正控制，避免负例因无关缺陷通过。
- **共享解析影响已核对**。ContentTypes 读取 Default 时保持按 namespace 识别直接子元素；活动内容扫描同时检查 Override 与 Default。DOCX/XLSX 原有 Override 路径和宏限制未被取消，未扩大到其他业务模块或新增公开 API。
- **文案范围正确**。B1-06 记录关系目标漏检及本轮覆盖；B1-07/08/12 继续保留此前专项浏览器结果及剩余矩阵。没有把修复与合成资料升级为 B1-14、人类验收或 main 交付。

## 独立复现与证据边界

Reviewer 在重新构建完成后，使用候选构建的公开 `scanInputPackage` 入口独立执行 24 项内存正反对照：sharedStrings/styles × 默认/非默认目标 × 合法、DTD、缺失、错误根、Default ContentType、外链。使用实际 relationship 与对应 ContentType，合法输入保留完整原 bytes；DTD、缺失和错误根均为 CORRUPT / INVALID_XLSX 且无 content；外链为 READ_LIMITED 且无 content。24 项均符合预期，原 R1 的“改变合法内部路径即可绕过”反例不再成立。诊断没有网络访问、文件实体读取、产品代码修改或运行服务变更。

上述结果只建立修复的语义证据，不代替新候选配置化 full。首轮 CI `39936148178 / attempt 1` 绑定旧 head，不能覆盖此次产品修复；不通过代码树判断或旧测试成功跨 SHA 免跑。Implementer 报告的聚焦 17/17、格式/lint 和 build 成功，与本次独立反例结果分别记录，不把其说明本身当作 Reviewer 的独立执行。

本轮复核的三个输入 SHA-256 如下，用于在尚无新提交时界定确切审查对象；最终仍须改由新 Git SHA 和当前检查确认，不作为跨修订验证复用机制：

| 文件 | SHA-256 |
|---|---|
| `modules/document-delivery/src/custody/formats.ts` | `9bc3bf924e2b747c84bf8049ff9113336a8781ca7430c67975e2e7bf5895a925` |
| `tests/business/mvp-custody.test.ts` | `3c6f69c800a6582fcfc56ab5e816183db1fd65d55bd8306a00e92f6e28d431fe` |
| `.vibe/module-tests/Module-Test-MVP01-DocumentDelivery.md` | `9d9c302dcc55df9837e3934ae944d4b482ca38f37ad9db776dd392982f590fc0` |

当前增量未发现新的阻塞语义问题。下一步由 Implementer 将修复、必要文案和本记录一起形成新候选，运行当前阶段所需 full；同一 Reviewer 在结果返回后确认真实 PR base/head、候选与证据适用性，再给出最终角色结果。最终 SHA/检查确认留在 PR review/comment，不为追加 CI 成功再提交本记录。人工验收、累计批次审查/full、main 授权及合入后 main full 的边界不变。

---

# 首轮审查历史

REQUEST_CHANGES。被审候选存在 XLSX 被引用部件的安全验证遗漏；精确候选 full 成功不能覆盖该已复现的契约反例。

# PR #318 独立审查记录

## 阶段、候选与范围

- 日期：2026-10-23。
- 对象：[PR #318](https://github.com/qzhike/zhiju-business-core/pull/318)，关联 [Issue #311](https://github.com/qzhike/zhiju-business-core/issues/311)。
- 阶段：B1 持久托管的缺陷修复与验收准备子 PR；目标仅为 `batch/mvp-b1-document-delivery`，不是 main 最终交付。
- 被审 base：`89bbd41ee68257eae85ed4305f1d58519229fbef`。
- 被审 head：`6105125e2d1b04c1f6823232b286b0d9225b05bf`。
- 本记录另核对随后工作区中 MVP01 Test 的 B1-07、B1-08、B1-12 结果更新；这些文案与新增专项回执相符，但尚未成为上述 head 的内容。本记录及后续产品修复须纳入新候选并重新确认。

Reviewer 独立读取最新 PR、Issue、项目规则、获批 B1 设计、MVP01 Spec/Test，先形成行为预期，再检查实际差异、关联实现及验证证据。本次只写本 Review，未修改产品代码、提交、推送、发布 GitHub 评论、合并或改变运行服务。

已只读核实仓库变量 `VIBE_BATCH_DELIVERY_ENABLED=true`，目标为同仓库合法批次。batch ruleset 要求 PR、当前基线的 GitHub Actions `verify`、对话解决及禁止强推/删除，无 bypass；单人正式批准数量为 0 不替代独立 Agent 审查和人的范围授权。本差异含工程与测试执行工具，因此当前阶段仍要求 full。阶段规则不豁免本次相关行为检查或已知缺陷。

## 独立预期与已核对修复

依据 [MVP01 Spec](../../module-specs/Module-Spec-MVP01-DocumentDelivery.md) §1、§3、§5、§6，以及 [MVP01 Test](../../module-tests/Module-Test-MVP01-DocumentDelivery.md)：项目摘要与详情应各自符合公开字段；列表及游标不能跨归属复用；初始化身份须被实际 BFF 接纳且重复初始化保留身份；XLSX 的被引用部件须经过同一 XML 安全检查；真实持久旅程与正式来源人工验收分开取证。

| 边界 | 实际检查及结论 |
|---|---|
| BFF 服务身份 | 初始化使用已有 `newUuidV7()`，并校验持久身份格式；已存在的错误身份显式失败且不覆盖秘密。配置回归通过真正的 BFF trust-config parser，涵盖重复初始化和身份冲突 |
| 批次目录归属 | `listBatches` 增加 owner/project 条件，同时保留 batchNo 高水位及顺序；真实 PostgreSQL 回归覆盖同 owner 两项目、分页期间新增批次、刷新和跨项目 cursor 拒绝 |
| attempt cursor | 签名 scope 新增 batchId，decode 与请求 batch 精确比较；正常后续页成功，同项目另一个 batch 拒绝；currentAttempt 仍单独查询 |
| 项目目录与会话 | `ProjectSummary` 独立解析，列表不要求 detail-only 字段；创建按钮等待 session。模型正反控制和构建浏览器的重登、项目列表、刷新读回覆盖原故障 |
| BFF 重启 | 构建浏览器单独重启 BFF，观察 session 失效并重登，再读回原批次及原包字节；不把重新登录当作新建业务意图 |
| 旧迁移与生命周期回归 | 文件系统 API 直接接收 file URL，保留 percent-encoded 路径；生命周期 probe 显式传短 hook budgets，实际持久测试默认值不变。原 11 种故障/清理模式及断言保留，未缩减完整门禁 |
| 当前状态文档 | runbook、Spec、Test、roadmap 分开记录真实本机技术旅程、合成资料及人工待验收；同步 main 带入的批次规则保留单人授权、累计 full、合入后 main full 和第二阶段未启用边界 |

## 阻断发现

### R1 / P1：XLSX 非默认路径的被引用 sharedStrings/styles 绕过 XML 安全验证

位置：`modules/document-delivery/src/custody/formats.ts:352–365`；本次新增覆盖位于 `tests/business/mvp-custody.test.ts:185–210`。

`xlsx()` 仅查找 workbook 目录下固定的 `styles.xml`、`sharedStrings.xml`，没有按 workbook relationships 解析实际被引用的部件。关系本身合法、目标位于包内其他路径时，该部件内容不会进入 `validateSpreadsheetPart`，随后文件仍可返回 `ACCEPTED` 并携带用于持久接纳的 content。

独立诊断通过被审候选的构建 `scanInputPackage` 执行，全程使用内存合成 ZIP，无网络或外部文件读取。以现有 `xlsxBytes()` 为基准，向 `xl/_rels/workbook.xml.rels` 添加 sharedStrings 类型的内部关系，向 ContentTypes 添加匹配 Override，再添加对应部件。DTD 仅声明无害内部字符串实体，用于观察准入拒绝，未执行外部实体。

| 部件目标及输入 | 实际结果 | 契约期望 |
|---|---|---|
| `sharedStrings.xml`，合法 `sst` XML | ACCEPTED，content 存在 | ACCEPTED |
| `sharedStrings.xml`，相同 `sst` 加 DTD | CORRUPT / INVALID_XLSX，content 缺省 | CORRUPT |
| `custom/strings.xml`，合法 `sst` XML | ACCEPTED，content 存在 | ACCEPTED |
| `custom/strings.xml`，同一份带 DTD 的 XML | **ACCEPTED，content 存在** | **CORRUPT / INVALID_XLSX，content 缺省** |

最小反例的关系为 `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="custom/strings.xml"`；部件为 `xl/custom/strings.xml`，ContentType 为 `application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml`。部件内容为：

```xml
<!DOCTYPE sst [<!ENTITY marker "harmless">]><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>&marker;</t></si></sst>
```

这违反 MVP01 Spec §5 对“被引用的 styles/sharedStrings（如存在）均按同一安全 XML 规则验证”的明确要求。问题是准入边界遗漏；本次未声称已发生外部实体执行、联网或信息泄漏。原实现缺口被本次 B1-06 安全验收强化涉及，不能因不是新引入的行或 full 已通过而豁免。

本次新增 sharedStrings 测试只在默认路径放置部件，未建立对应 workbook relationship；因此没有覆盖真实关系目标变化。修复应按实际关系类型及目标解析被引用部件，验证内部路径、存在性和对应安全 XML 根，保留外链 READ_LIMITED、累计预算及合法非默认路径；sharedStrings 与 styles 的相同逻辑一并处理。新增默认/非默认合法控制，以及 DTD、缺失或无效被引用部件的拒绝控制，不能仅增加文件名黑名单。

状态：**OPEN**。已立即交回 Implementer；本 Reviewer 未实施修复。

## 受影响字段与集合对照

`?` 表示可省略。本表覆盖本次改动的公开形状及内部游标范围；没有修改 JSON request schema 或将数组改为集合。

| 契约 | 必需字段 / optional 字段 | 对照结果 |
|---|---|---|
| ProjectSummary | projectId、customerName、title、createdAt、version | owning rows 显式返回全部五项；新 UI summary parser 逐项要求，不再添加 lastBatchNo |
| ProjectView | Summary 全部字段，加 lastBatchNo、analysis；activeBatchId? | owning rows 保持完整详情，analysis 为 UNAVAILABLE / ANALYSIS_NOT_CONNECTED；UI 详情保持 lastBatchNo 与 activeBatchId 读取。UI projection 不替代服务端完整 contract |
| list_projects | 输入 limit?（1..50）、cursor?；结果 items:ProjectSummary[]、nextCursor? | 请求协议未变，UI 列表按摘要解析；items 是有序数组，允许空页，不新增去重约束 |
| list_input_batches / BatchSummary | limit?（1..50）、cursor?；items 中 batchId、projectId、batchNo、kind、originalName、declaredBytes、zipSha256、status、version、createdAt、reasonCodes；manifestId?；nextCursor? | 返回字段未变；owner/project 过滤与高水位共同作用，不把其他项目行混入或吞掉目标页 |
| get_input_batch / AttemptSummary | attemptLimit?（1..50）、attemptCursor?；attemptId、kind、number、generation、status、startedAt、reasonCodes；endedAt?；nextAttemptCursor? | 公开字段未变，attempts 有序数组；cursor 绑定当前 batch，currentAttempt 独立于历史页 |
| 内部 CursorScope/State | endpoint、ownerId、authEpoch、upper、last；projectId?、batchId?、manifestId? | 新 batchId 纳入 HMAC payload 及 decode 等值检查；其余范围/高水位/安全整数检查保留，旧的不含 batchId 的 attempt cursor 会显式拒绝 |

## 验证证据与适用范围

- `vibe repo --json` 确认工作树仓库、分支和被审 head；最新 PR API 的 base/head 与本记录相同。
- [CI 39936148178 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39936148178/attempts/1) 精确绑定 head `6105125e2d1b04c1f6823232b286b0d9225b05bf`。select 为 full，checks、三个持久化分片、persistence 和 verify 均 success，汇总要求各结果来自同一 attempt。
- 候选绑定输出为 PASS：base 为本记录所列版本，checkout/测试合并 SHA 为 `94c956074fa1fbf94acc6860552ad67aed5a7c86`，tree 为 `9341f542d5767a42bd9a213fed56bb293a38d5d1`。只复用本次可信 CI，没有重复 full 或建立第二个 CI waiter。
- 已检查隔离本机自动旅程脚本和回执：真实 Keycloak 登录、合成三格式初次托管、补充、建批成功响应丢失后的原请求恢复、重复 init 身份保留、stop/init/start 后重登及原批次/manifest/原包字节读回。回执记录对应候选及源文件清单绑定；它不是正式来源或人类验收。
- 已检查后续专项脚本和回执：真实浏览器项目/上传双击各只发一个对应创建请求；0 accepted 保留两项受限条目、无条目下载、明确无可分析来源且原包字节一致；引号/分号/Unicode 文件名下载保持精确字节及 attachment/no-store/nosniff。文案仍保留完整并发流矩阵、断流和 CRLF 等未运行边界。
- 已读取 A/B 保护资源的前后身份读回记录；此证据表明该次执行观察到的容器和进程身份未变，不扩大为未执行的全部旧环境业务验收。
- R1 为独立正反对照的直接运行结果。已通过的 full 和本机正向旅程均未覆盖该关系目标反例，因此本轮仍为 REQUEST_CHANGES。

## NOT RUN 与后续门禁

正式来源三格式人工试走和用户内容验收仍为 NOT RUN。已选择的 DOCX 及准备好的私有 ZIP 不证明已上传或验收；真实 Markdown/XLSX 仍待补齐。公共合成样本不能替代 Issue #311/B1-14。真实 kill、完整认证负例组合、全部并发上传流/下载断流与部分安装故障矩阵按 owning Test 保留未运行项，不由本次成功概括为全覆盖。

本次阻断修复、相应用例和必要文档进入新 head 后，由同一独立 Reviewer 复核 R1 及受影响结论，并确认新候选的当前阶段完整证据。包含正式 Review 的最终候选 SHA/检查确认写入 PR review/comment；不为回填 CI 成功单独再提交本文件。

只有本次子 PR 的相关缺陷与验证闭合后，才可能批准进入指定 batch；它不关闭 Issue #311。累计批次审查/full、正式来源人工验收、适用人类技术判断与 main 合入授权、合入后 main full 仍分别保留。第二阶段证据复用未启用，本轮没有合并授权。
