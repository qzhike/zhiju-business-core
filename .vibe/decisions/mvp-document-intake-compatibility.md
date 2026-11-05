# MVP 真实文档接收兼容性与限制说明

日期：2026-11-04

状态：`PRODUCT AND TECHNICAL DESIGN APPROVED 2026-11-04 / DESIGNATED TEST INSTANCE UPGRADED / CUSTOMER CONTENT ACCEPTANCE NOT RUN`

## 1. 下一项结果与分类

用户要求继续下一项 MVP 工作。当前进入 [M2-1](../mvp/mvp-v1-release.md#m2--真实质量手册闭环) 的真实资料接收核对：用户上传普通文档 ZIP 后，能够区分已接收文档、系统附属文件与确需处理的限制，不因标准压缩选项误报文档损坏。此次仅交付托管兼容性和可解释清单；正文提取、Runner 分析、完整资料内容验收仍属于后续接入，不能据此关闭 M2-1。

分类为 **T2**：虽然压缩标志修正本身很小，但下述外部模板例外会改变安全接纳规则，且需固定新 policy 和更新数据库约束。用户于 2026-11-04 回复“批准”，批准绑定独立设计审查通过的 SHA-256 `dd2b1bc2b9f016126d30ae36ed0d7e05d817670a36bd5fbe6e33bbee5caf3288`，当时授权本地实现及验证。用户随后单独批准将已验证、已复审候选升级至指定 Tailscale 测试实例；该实例现运行 @4 / V0004。客户资料重传与 Git 交付不包含在本次升级授权中。

## 2. 现状与证据边界

本项修订前，测试实例运行 `mvp.zip-input@3` / V0003；旧数据保留，合成资料上传、超限说明及重登读回已验证。现有真实样本经只读核对，包含正常业务文档、macOS 附属元数据和外部模板引用；部分 DOCX 的 Deflate 压缩选项位被此前的 `flags & ~0x0808` 检查误拒。依据 [PKWARE APPNOTE §4.4.4](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT)，method 8 的 bit 1、2 是合法压缩选项，不是加密位。

只读反例只在内存副本中清除此两位，再用现有完整校验器检查，证明误拒之后仍会出现外部模板或嵌入对象限制；不能把解除第一个错误当成文件已可接收。外部模板关系及其 settings 引用已核对；其语义依据 [Microsoft 的 attachedTemplate 说明](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/7713efa6-b1ff-4cbd-9339-5bf9018433ac)。这些标准只证明格式含义，不替项目决定安全接纳范围。

原包和文档字节未修改，未重新上传、未访问引用的本地路径或网络位置。客户摘要、数量、文件清单与诊断结果仅保存在 Git 忽略的 `.local/mvp/readiness-98155d6/`；合成反例用于公开测试。指定测试实例已在独立升级授权后运行下述 @4 规则；旧批次保持原结果。合成资料已通过真实登录、接收说明、来源下载、拒绝、刷新及重登核对；随后只读核对确认客户新批次 @4 已实际接收 90 份文档；全文读取与人工内容验收仍待执行，接收限制保留。

## 3. 已批准并实现的 Spec Delta

### SD-IC-01：只兼容标准 Deflate 选项

- 对外层 ZIP 与 Office 容器一致处理：method 8 允许 bit 1、2 的四种组合，连同原有 bit 3（data descriptor）和 bit 11（UTF-8）；method 0 不允许这两个未定义选项位。仍只支持 method 0、8。
- 加密、强加密、保留位、未知压缩法、local/central flags 或 method 不一致仍拒绝。保持 CRC、实际长度、数据流完整性、路径、重复条目及全部 `@3` 资源预算；不能通过改变标志绕过这些检查。
- 解析原字节，不清除、重写或重新压缩原件。诊断的内存副本操作不是产品实现方案。

### SD-IC-02：系统附属条目保留但不冒充文档损坏

- 仅在文件名/路径与签名同时符合时识别 macOS 元数据：`__MACOSX/` 下以 `._` 开头的条目或其他目录中的 `._*`，且具有 AppleDouble v2 固定 magic/version；`.DS_Store` basename 且具有对应文件签名。保留逐项身份、路径、摘要和 ordinal，不删除、不合并。
- 使用既有 `UNSUPPORTED` 状态及新增原因 `SYSTEM_METADATA_NOT_DOCUMENT`，不生成 SourceRef。页面显示“系统附属文件，不参与业务文档处理”，不显示为 DOCX/Markdown 损坏。不新增“忽略所有隐藏文件”规则。
- 签名/路径不匹配仍执行原有格式规则；外层安全、资源计量与嵌套压缩检测先执行，元数据识别不能豁免这些检查。此识别只改变解释，不授予读取/分析资格。

### SD-IC-03：明确限定外部模板引用的静态接收

- 仅对非宏 DOCX 增加窄例外：完整原有结构与活动内容校验通过，所有外部关系均是受验证 settings 中的 attachedTemplate，才允许作为静态原始文档接收。
- 精确识别 `word/_rels/settings.xml.rels` 内、关系命名空间正确、`TargetMode='External'`、Type 为 Transitional 或 Strict 的完整 attachedTemplate URI 的唯一关系；`word/settings.xml` 必须通过同样的安全 XML 校验，根为相应 WordprocessingML `settings`，其直接子元素 `attachedTemplate` 使用关系命名空间的 `id` 精确引用该关系。settings 的 ContentType 及主文档到 settings 的内部关系必须一致，不能用文件名或 URI 后缀代替结构身份。重复、缺失、错误 namespace 或不一致的结构不享受例外。
- 文件为 `ACCEPTED`，保留原 bytes 与 SourceRef；`reasonCodes` 增加 `EXTERNAL_TEMPLATE_NOT_LOADED` 作为接收说明。新规则明确 ACCEPTED 可能带说明，接收说明不等同于错误或业务内容完整性承诺。结构错误仍 CORRUPT；其他有效外部引用仍 READ_LIMITED。
- 不打开、下载、执行、解析或验证模板目标，不读取目标指向的宿主路径，不调用 Office，也不修改原 DOCX 去掉引用。页面显示“已接收；外部模板未读取”，说明当前只保存包内内容，外部模板内容和效果不包含在后续静态处理承诺中；不展示外部目标地址。
- 任一其他外部图片、数据源、超链接或未知关系继续按现有 `EXTERNAL_REFERENCE_REQUIRES_REVIEW` 限制。XLSX 不适用该例外；宏、ActiveX、OLE/嵌入对象仍不接纳。含嵌入对象的文件应提示用户人工核对后另存为静态文档并以新批次上传，不能自动删除对象或直接跳过文件完成验收。
- 本条不授权 Runner 执行或宣布文档读懂。后续正文提取与 Runner 接入必须保留此限制及接收说明，证明不解析外部引用后才能使用这些来源；未接通时仍显示“分析未连接”。

### SD-IC-04：新版本、历史与页面语义

- 新批次使用 `mvp.zip-input@4`，manifest 使用 `mvp.input-extractor@4`；manifest schema 保持 `mvp.input_manifest@1`，Entry 状态、SourceRef 形状和原文 hash 规则不变。在 owning API/Spec 注册上述两个原因码及其状态含义。
- 新增 V0004 扩展 policy 允许值，并让既有嵌套拒绝路径约束及强制 `limitViolation` 约束适用于 `@4`；额度不变，V0001–V0003 不修改。不新增业务表，不回填旧 manifest、receipt 或错误。
- `@1/@2/@3` 已完成历史保留原解释。旧活动尝试沿现有 policy 不匹配恢复规则，不自动用新规则继续提取；先证明写者结束并核对，再由用户放弃旧批次、创建新批次。新规则只作用于新上传，不自动重扫历史原件。
- 沿用现有分页和全部条目计数；明确计数含附属条目，不把当前页数量或 accepted 数称为整包业务文档总数。元数据仍占一条结果并计入受限条目，批次可能仍为 PARTIAL。已接收文档的模板说明应在文件行显示，不混入“拒绝原因”或丢在只显示受限项的区域；历史旧原因不从文件名猜成新结论。
- 新原因提供中文说明及对应下一步，原技术码保留。沿用蓝色、白底与自然页面滚动；不改工作区布局、导航或 mock 流程。

## 4. 影响范围与执行顺序

本轮同步 MVP01 Spec/Test、共享 MVP API、07 持久化映射及 UI01 Spec/Test 的对应条目，再修改 `modules/document-delivery` 的 scanner/policy/迁移和 `apps/workspace-web/src/custody` 的读取校验及说明。复用现有接口、事务和 UI；不修改外部 Runner、旧 IntegrationGateway/D14 或其他模块。

先补可复现的合成格式反例，再实施、执行配置化 full、独立复审；真实样本仅在隔离本地扫描器只读复测。真实测试实例升级、客户资料重传和 Git 交付分别沿既有授权边界处理。本方案批准本身不授权它们；文档与本地实现完成后提供具体候选供确认。

## 5. 可验证出口

| 场景 | 成功条件 |
| --- | --- |
| IC-01 标准压缩选项 | method 8 的四种 bit 1/2 组合在外层与 DOCX/XLSX 均通过；与 bit 3/11 组合兼容；原始 bytes/hash 不变；method 0 非法选项、未知 method/flag、header 不一致、加密、CRC/路径/预算失败继续拒绝 |
| IC-02 元数据 | 正常 AppleDouble/DS_Store 条目保留身份与清单，明确 UNSUPPORTED；伪装路径、伪签名、同名普通文档和改名压缩包不被静默忽略；元数据照常消耗预算 |
| IC-03 模板例外 | 精确有效模板引用的 DOCX 接收并永久保留说明与原件；Strict/Transitional 与合法 namespace 前缀覆盖；错引用/namespace/重复/伪设置不放行；混合其他外链、嵌入对象、宏、XLSX 外链仍限制；测试证明扫描期间零目标网络/文件访问 |
| IC-04 持久事实与兼容 | 原子封存 accepted 来源及说明；分页、源下载、hash、当前归属保护、重启与重登读回保持一致；新旧 policy 的超限与嵌套拒绝详情均有效；V1–V3 checksum 不变，V4 升级及重入无操作，历史不重写，旧活动尝试不自动续跑 |
| IC-05 页面可解释 | 桌面与 320px 均能区分已接收/带说明/附属文件/真正限制，完整清单与分页不漏项，不误称所有业务文档可读；分析仍不可用；来源名及说明按不可信文本安全显示 |
| IC-06 真实只读复测 | 固定原包摘要并核对前后不变；逐项新旧结果差异符合上述规则，残留限制明确；不把 scanner 检查写成实际上传、全文读取、M2 闭环或人工内容验收 |

设计阶段使用 `vibe verify docs --json` 与独立设计审查。实现需要 `vibe verify full --json`，涵盖持久化与浏览器；本轮不是纯 UI，既有纯 UI 的数据库测试豁免不适用。受控证据与客户原文不进入公开测试或 Git。
