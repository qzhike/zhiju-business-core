# B1 前置设计：项目与资料托管

日期：2026-10-22

分类：`T2 / NEW APPLICATION DATA AND SECURITY BOUNDARY`

状态：`DESIGN APPROVED 2026-10-22 / IMPLEMENTATION CANDIDATE / REAL INSTANCE AND USER ACCEPTANCE NOT RUN`。

本设计承接用户“完成前置设计任务”的授权，只闭合 [交付计划 B1](delivery-plan.md#5-第三阶段逐段接通真实业务能力)；不实施业务、迁移数据库或更改运行中的环境。主干基线为 `ed876d8614878a94a261062853859709f7b4a926`。字段、状态及失败场景分别进入 [MVP01 Spec](../module-specs/Module-Spec-MVP01-DocumentDelivery.md) / [MVP01 Test](../module-tests/Module-Test-MVP01-DocumentDelivery.md)，本文拥有设计取舍与批准范围，不复制操作字段。

## 1. 输入与前序证据

- 产品范围由 [可用闭环](usable-loop.md)拥有：真实项目、首次/补充 ZIP、DOCX/Markdown/XLSX、不可变来源、必要保护与恢复。B1 完成资料托管，不执行分析。
- U3 经 [PR #309](https://github.com/qzhike/zhiju-business-core/pull/309) 合并为 `91df1702b2cfb2630910d86348dd6554787456bf`。其 [最终 review](https://github.com/qzhike/zhiju-business-core/pull/309#pullrequestreview-5610648880)及[正式记录](../reviews/pr-309/Review.md)保存用户“手动验证已完成通过”的 U3/UI-01–08 模拟流程确认，绑定实现 `5af8c3599339f15e45c0f2ca29c1f2ad3d14db5f`。后续 `f2d732a` 只追加审查文档。
- #308 收口评论及部分文档仍把总体确认写为 NOT RUN，与上述已记录决定不一致。这里保留两份历史的来源，不据收口摘要推断用户撤回确认；本轮明确授权进入 B1 前置设计。私有原文逐字内容、真实 Core/Runner、持久恢复及业务验收没有因此通过。
- 现有 `#291` 受控准备入口、ZIP 原意图/恢复、OIDC/BFF、PostgreSQL 和 macOS 文件存储是可复用工程资产；现有 first-intake 绑定旧预设及唯一准备请求，格式主要为 DOCX/Markdown，不能直接当作新的多批次模型。

## 2. 已批准的 Spec Delta

| 决定 | B1 具体选择 | 理由与影响 |
|---|---|---|
| SD-B1-01：唯一业务 Owner | 新精简应用服务 `DocumentDelivery`，模块标识 `MVP01`；B1 只拥有项目、输入批次、原包/条目引用、请求/尝试及恢复 | 不把新项目伪装成旧 Enterprise/Preparation/Task；后续 B2–B5 可在同一应用边界增加能力，但本次不预建其对象 |
| SD-B1-02：独立运行与数据 | 同仓库、同技术栈，独立 `MVP` composition；专用 PostgreSQL database、`document_delivery` schema、文件根和 instanceId，旧环境原样保留 | 新模型无跨旧 schema 读写、无旧数据迁移；新入口不隐式切换现有环境 B |
| SD-B1-03：最小身份保护 | 复用 OIDC Code + PKCE、BFF 内存会话、Core 独立 token 验证；部署绑定一个明确 issuer + subject 的员工，项目 owner 由服务端确定 | 不开发密码系统或多租户策略；旧 IP 的授权决策不被复用为新模型的权限事实，复用的是认证/会话技术机制 |
| SD-B1-04：有限新 API | `/bff/mvp/v1` → `/api/mvp/v1`，命名在 06 单列，MVP01 拥有字段；不经旧 generic Registry/Envelope 分派 | 旧公开接口和兼容基线保持原样；新接口仍具严格 schema、归属、幂等、有限结果和验证，不以“薄接口”取消检查 |
| SD-B1-05：本机存储首版 | B1 实际联调采用受控本地文件 store + Docker PostgreSQL 持久卷，保留已有 immutable put/read/inspect 安全语义 | 与已批准 macOS 手测能力一致；S3/生产部署不在 B1 出口，不宣称本机文件 store 具生产 S3 conformance |
| SD-B1-06：一个批次一次接纳 | 每项目串行处理一个接收/提取批次；首次及补充批次同模型，原件和 manifest 不可变；成功可含受限条目 | 简化首版并发，成功不等于分析；上传/解包异常恢复随 B1 交付，不推迟到 B2 |
| SD-B1-07：安全接收三格式 | 保留现有 ZIP 累计预算；增加 XLSX 包结构与安全验证，不计算公式、不执行宏、不访问外部关系 | 当前预算可能限制复杂/大样本，必须显示限制；300+ 真实规模另验，不在设计时无依据放宽 |

用户于 2026-10-22 对 SD-B1-01–07 明确回复“批准”，同时授权本批设计文档提交、推送及创建 PR。批准绑定设计提交 `cbdbbfe80f61735c6682117c51f9647c28b96b2f`（对应经独立复审的 20 文件内容清单 SHA-256 `c0fb9824aea4c68e977c12c956658525b8fa8eafda07b3f26e27bc649e176921`）；后续本轮状态同步仅记录该批准，不改变技术语义。R1 首次提取恢复与 R2 原授权 epoch 持久化已复审关闭，无剩余阻断性设计缺陷。该批准不代表新链已实现或运行验收通过，也不扩展到 B2–B5。

## 3. 权威与影响范围

| 文档 | 本次拥有的增量 |
|---|---|
| HL-Spec、02 | 新应用边界与旧七模块的关系、MVP01 所有权与依赖 |
| 03、04、05 | 旧核心 Contract 不作为 B1 前置；新概念、不变量、事务与恢复的定向路由 |
| 06、共享 API Contract | 有限 operation 名称、HTTP 命名空间、基础请求/错误与兼容规则 |
| 07 | 专用数据库/schema、表、归属、约束与运行角色 |
| MVP01 Spec/Test | B1 精确 payload/result、状态转换、接纳/重试、ZIP/XLSX 安全规则与可验证场景 |
| UI01 Spec/Test | 已确认页面切换到真实资料来源时的真实性、恢复及下一能力不可用行为 |
| 部署安全基线、macOS runbook | 新初始化、身份/数据配置、只启动本实例、重启和可逆切换 |
| roadmap / MVP 导航与交付计划 | 当前进入 B1 设计准备，已确认 UI 与未运行真实验收分开 |

不复制旧七模块到新服务，不将 UI fixture 类型提升为 wire contract，不注册真实 Runner、报告/计划、阶段或交付操作。

## 4. 复用与替代

| 现有位置 | 处理方式 |
|---|---|
| `apps/workspace-bff/src/{oidc,verify,jwt,sessions,csrf,peers,zip-body}.ts` | 复用认证、会话、Origin/CSRF、对端和流限制；MVP composition 的 bootstrap/route 接线单独验证，不继续依赖旧 IP bootstrap |
| `apps/api/src/workspace/access-token.ts` | 复用独立 token 校验算法与信任配置；必要时提取无业务 Owner 的技术包，旧行为保持回归 |
| `modules/integration-gateway/src/customer-zip/{zip-safety,file-object-store}.ts` | 复用纯安全/存储机制；MVP policy 使用独立 profile，XLSX 增量不偷偷扩展旧 D14 允许集；跨模块不导入旧业务 Repository/Service |
| `apps/workspace-web` | 复用 U1 页面与导航，增加真实 adapter；Environment A 保留隔离；旧真实入口保持原契约 |
| 旧 preparation/intake/EP/IG 表及服务 | 不迁移、删除或解除原唯一性；新的补充批次只存在 MVP01 |

优先提取小的共享技术函数/端口，不为此次复用建立通用存储/工作流框架。具体文件拆分由实施者按批准边界决定，影响架构/构建的变更必须进入 full 检查。

## 5. 独立结果与验收

B1 的用户结果：登录 → 创建真实项目 → 上传含三格式的 ZIP → 核对全部条目与限制 → 上传补充批次 → 查询原请求并恢复必要失败 → 停启服务后找回相同项目、清单及字节。没有 Runner 时显示分析未接入，不创建假的运行或报告。

核心可判定条件为 [MVP01 Test](../module-tests/Module-Test-MVP01-DocumentDelivery.md) 的 B1-01–14；实现验证使用 `vibe verify full --json`，持久化和受控 Browser 场景均包含在内。真实本机试走与用户反馈单独取证。现有客户样本只证明已选 DOCX 输入，真实 MD/XLSX 样本须按正式模板/合法客户材料准备，不以结构测试代替内容证据。

本次纯 Markdown 设计使用 `vibe verify docs --json`。设计 review 应重点检查：认证与 owner 不可伪造、同键恢复与并发封闭、存储/数据库异常不晋升接纳、批次/manifest 历史、XLSX 安全处理及精确来源引用。新设计未实现，所有 runtime/持久化/业务验收保持 NOT RUN。

## 6. 实施与批准出口

1. 本设计及 owning 增量已完成独立技术复审；发布修订继续按精确 head 核对文档与批准对象一致性。
2. SD-B1-01–07 的人类技术批准已取得，精确对象见 §2。后续改变已批准的新数据/身份/存储或恢复边界须重新评估受影响设计。
3. 设计进入主干并回读后，更新已准备的 B1 implementation Issue 的设计链接和基线，再判断 NOW + READY。不重写本设计成为执行日志。
4. B1 作为一个完整结果实施；身份/数据、协议、托管、UI 与必要恢复不拆成只能单独验证组件的用户交付。内部可按依赖安排实现步骤。
5. B2 的 Harness 选择、Runner 协议、三格式语义读取和分析设计在对应批次闭合，不阻塞 B1，但不得由 B1 PASS 推断就绪。

本轮设计 Git 提交、推送和 PR 发布已获授权；合并、实际新实例初始化及旧环境清理仍按各自授权边界处理。
