# Zhiju Business Core Deployment and Security Baseline v0.1

版本：v0.1
日期：2026-08-17
状态：`BASELINE / IM-DG-003-004 USER APPROVED / IM-UI-01 MILESTONE USER APPROVED 2026-08-28 / UI-DG-003 USER APPROVED 2026-10-08 / UI IMPLEMENTATION NOT STARTED`

文档角色：Implementation Milestone Plan 的私有化部署、对象存储、Secret/KMS、认证入口与 Workspace UI 边界的唯一技术决策记录，冻结 IM-DG-003/004。本文不改变 Domain、API、Module、PostgreSQL、Feishu 或 Runtime Contract 语义。

---

## 1. 用户决定与部署假设

用户于 2026-08-17 确认：

1. 目标生产环境是客户私有本地 Ubuntu 服务器；
2. 接受 API-first，首期不以 Workspace UI 作为开始编码前提；
3. 接受 S3-compatible 对象存储、外部 Secret/KMS 与 OIDC 认证的总体边界。

用户于 2026-08-28 进一步确认：在 IM-06 Human-operated Core 完成后新增独立 `IM-UI-01 Workspace UI MVP`；该里程碑可与 IM-07/IM-08 的交付时间窗并行，并作为 IM-09 完整 Reference Project E2E 的前置。该确认只批准里程碑、依赖和边界，不批准尚未选择的前端框架、Design System、浏览器矩阵或具体部署实现。

当前只确认单台服务器这一初始部署约束，未确认磁盘数量、容量、独立备份设备或第二故障域。因此本文不把单机写成 HA；正式 Release 前必须补齐磁盘布局、独立备份目标、恢复演练与容量证据。

---

## 2. 被否决的 MinIO 初始建议

此前建议本地/CI 使用 MinIO。复核官方仓库后发现，`minio/minio` 已于 2026-04-25 归档为只读，最新 Community Server Release 停在 `RELEASE.2025-10-15T17-29-55Z`。新项目继续把它作为生产或 Conformance 基线会引入无持续安全修复承诺的风险，因此本基准明确否决 MinIO；不得因为 S3 API 兼容而在实现中静默换回。

证据：

- [MinIO 官方 GitHub Releases](https://github.com/minio/minio/releases)；
- [MinIO 官方仓库许可证](https://github.com/minio/minio/blob/master/LICENSE)。

---

## 3. IM-DG-003 对象存储与 Secret/KMS

### 3.1 冻结选择

| 项目 | 冻结选择 | 实施约束 |
|---|---|---|
| 对象协议 | S3-compatible application port | 业务代码只依赖受控 Object Storage Port；Provider DTO、Bucket Policy 和 SDK 类型不得进入 Domain |
| 生产 Provider | MicroCeph 管理的 Ceph Tentacle `20.2.x` + RADOS Gateway | Ubuntu 私有化部署；首次安装锁定精确 Ceph patch、MicroCeph snap revision/channel 与制品校验信息 |
| 初始拓扑 | 单节点，非 HA | 可以完成初始部署与功能验证，但主机故障容忍度为 0；不得标记 HA 或灾备 PASS |
| Secret Manager/KMS | OpenBao `2.6.x` | KV v2 保存受控 Secret；Transit 提供字段加密、HMAC、Key rotation/rewrap；精确 patch 与制品校验在安装时锁定 |
| 应用机器认证 | OpenBao AppRole + Auto-Auth/短期 Token | SecretID 使用有限期、有限次数和 response wrapping；bootstrap material 仅通过 root-owned systemd credential/file 注入 |
| 字段加密 | OpenBao Transit randomized encryption | External ID 等敏感原值只保存密文；不使用 convergent encryption；Ciphertext 保留 key version 以支持 rewrap |
| Lookup Hash | 独立 Transit HMAC Key | Lookup Key 与 Encryption Key 分离、不可导出；Hash 不是加密，原值仍必须加密 |
| 对象加密 | Ceph RGW SSE-KMS/Vault-compatible Transit 接口 | Ceph 官方只声明 Vault 接口；OpenBao 兼容性必须在 IM-04 spike 实测，失败时重开 Gate，不允许降级明文 |
| 本地 Unit 替身 | 进程内 Fake Object Store / Fake Secret Port | 只用于 Domain/Application 单元测试，不得完成 Integration/Persistence/Release Gate |
| Conformance 环境 | Ubuntu 上一次性 MicroCeph + OpenBao 测试部署 | 必须运行真实 S3 versioning/object-lock、TLS、SSE、rotation、staging/link/orphan 和恢复场景 |

官方能力依据：

- [MicroCeph S3-compatible RGW 单节点入门](https://documentation.ubuntu.com/microcloud/latest/microceph/tutorial/get-started/)；
- [Ceph Active Releases](https://docs.ceph.com/en/latest/releases/)；
- [Ceph RGW S3 API 支持表](https://docs.ceph.com/en/tentacle/radosgw/s3/)；
- [Ceph Object Lock API](https://docs.ceph.com/en/tentacle/radosgw/s3/bucketops)；
- [Ceph RGW Vault/Transit 集成](https://docs.ceph.com/en/tentacle/radosgw/vault/)；
- [OpenBao KV v2](https://openbao.org/docs/secrets/kv/kv-v2/) 与 [Transit](https://openbao.org/docs/secrets/transit/)；
- [OpenBao AppRole](https://openbao.org/docs/auth/approle/) 与 [Integrated Storage](https://openbao.org/docs/concepts/integrated-storage/)。

### 3.2 Bucket 与对象规则

至少隔离以下用途，精确 Bucket 名称在 IM-04 固定：

```text
staging       temporary upload before validation and DB link commit
content       immutable source/canonical content/representation
diagnostic    controlled large adapter or renderer diagnostics
backup        prohibited on the same host as the only recovery copy
```

规则：

1. 所有 Bucket 默认 private，禁用匿名访问；应用使用独立最小权限 RGW User，不使用管理 Key。
2. `content` 开启 versioning；启用 Object Lock 的 Bucket 创建后不可退回未锁定状态。
3. Governance/Compliance retention 与 Legal Hold 只能由 Policy 决定，不由上传者或 Adapter 自行设置。
4. 数据库保存 opaque locator、精确 object version、content hash、size、media type、encryption key ref 和 retention class；禁止保存公开 URL。
5. 下载 URL 短期签发并在签发前重新授权；URL 不进入业务事件、日志或长期记录。
6. 对象写入继续遵守 Staging → type/size/hash/security validation → DB Link Commit → finalize；PostgreSQL 与对象存储不建立分布式事务。
7. Orphan Cleanup 必须有 24 小时宽限期、5 分钟 Lease、fencing token、masked Audit 和 Legal Hold/Retention/reverse-link 检查；失败重试从 5 分钟指数退避，最长 24 小时，`DELETED/NOT_FOUND` 为幂等终态，unknown deletion outcome 必须保留为可重试状态。

### 3.3 OpenBao 生产边界

1. 生产使用 TLS 与 Integrated Storage；`dev` mode 仅限本地/测试。
2. 应用、RGW 和运维使用不同 Policy/Auth Role；应用不能创建、导出或删除 KMS Root Key。
3. OpenBao Token、S3 Secret Key、OIDC Client Credential 不进入 git、argv、普通环境转储、日志、Prompt、Event 或数据库业务列。
4. Root/Unseal material 与 Raft Snapshot 必须有独立受控备份；同机副本不是灾备。
5. 当前单节点 OpenBao 容忍 0 个节点故障；扩展到多节点时重新审核 quorum、auto-unseal 与故障域。

---

## 4. IM-DG-004 API 认证与 Workspace UI

### 4.1 冻结选择

| 项目 | 冻结选择 | 实施约束 |
|---|---|---|
| 首个 Transport | NestJS 11 + Fastify 5 HTTP API | 已由 IM-DG-001 与用户确认；不引入第二套业务 API |
| Identity Provider | Keycloak `26.7.x` | Ubuntu 私有化部署，首次安装锁定精确 patch 与容器 digest；使用 production mode、TLS、固定 hostname |
| Human Browser | OIDC Authorization Code + PKCE `S256` | 禁用 Implicit Flow；Bearer token 不进入浏览器 localStorage |
| Operator CLI | OIDC Device Authorization Grant | 只给显式注册的 first-party client；不得共享 Human Password 或长期 Token |
| Service | OIDC Client Credentials + asymmetric client authentication | 每服务独立 client/service account；优先 `private_key_jwt`，禁止多个服务共享 client secret |
| API Session | Stateless access token validation | 校验 issuer、audience、signature、exp、nbf、token type/client；短期缓存 JWKS，key rotation 后可刷新 |
| 业务身份映射 | `(issuer, subject)` → ExternalIdentityLink → PrincipalRef | email、display name、Keycloak role 不能直接成为业务 Principal/Role/Capability |
| Workspace UI | `IM-UI-01`（IM-06 后） | 仅作公开 API client/BFF；不拥有授权、状态机、Approval、Release、Completion 或 Repository |

官方能力依据：

- [Keycloak 26.7.0 Release](https://www.keycloak.org/2026/07/keycloak-2670-released)；
- [Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/)；
- [Keycloak Production Configuration](https://www.keycloak.org/server/configuration-production)；
- [Keycloak PostgreSQL Configuration](https://www.keycloak.org/server/db)；
- [Keycloak Supported Configurations](https://www.keycloak.org/server/supported-configurations)。

### 4.2 Authentication 与 Authorization 分离

```text
Keycloak authentication
    ↓ verified issuer + subject + token context
AuthenticationContext
    ↓ resolve ExternalIdentityLink
IdentityPolicy Principal + ActorSnapshot
    ↓ authorize exact command/query intent
AuthorizationDecision
    ↓ owning module re-validates decision and invariant
Business result
```

Keycloak 只证明认证主体与 token context，不拥有 Enterprise/Project Role、Capability、Human-only、职责分离或业务状态判断。Keycloak Realm Role 不得映射成可绕过 IdentityPolicy 的内部管理员权限。

### 4.3 私有化部署边界

1. Keycloak 使用独立 PostgreSQL Database/Role；可与 Core PostgreSQL 18 实例同机，但不进入七个 owning Schema，Core 禁止查询 Keycloak 表。
2. Keycloak 生产模式经受控反向代理暴露必要 OIDC endpoint；Admin/Management endpoint 仅管理网可达。
3. 初始 Bootstrap Admin 是基础设施身份，不自动成为 Zhiju HumanPrincipal；首个业务 Principal/Role 的受审计 bootstrap 流程在 IM-02 固定。
4. 单实例 Keycloak 同样不是 HA；正式验收必须记录 IdP 不可用、JWKS rotation、token expiry/revocation 和恢复行为。
5. 本地/CI 可以使用 Keycloak `start-dev` 与 realm fixture，但任何 dev credential、realm key 和 bootstrap admin 不得进入生产。
6. IM-UI-01 优先 BFF + Secure/HttpOnly/SameSite Cookie；UI 只消费公开 API，不直接连接 PostgreSQL、OpenBao、Ceph 或模块 Repository。

### 4.4 IM-UI-01 浏览器与 BFF 安全边界

已批准工程方案见[UI 首版工程提案 §5](../decisions/workspace-ui-engineering-baseline.md#5-bff-与安全方案ui-dg-003-提案)：独立同源 BFF、单进程内存技术 Session（重启后重登、业务记录从 Core 恢复）、OIDC 交易与 Cookie、CSRF/Origin/Host、CSP/Markdown、公开操作 allowlist、下载及遥测。用户于 2026-10-08 批准该技术方案，独立审查/实现/验证尚未完成；不改变现行 API stateless、业务身份映射或禁止 BFF 直连基础设施的冻结规则。

字段级补充提案见 [#258 Session Delta](../decisions/workspace-trusted-session-public-access.md)：固定issuer/client/API audience/callback/endpoint与technical peer配置、JWKS轮换、有界交易/Session、Core可信身份bootstrap、当前IP授权、有限public routes和原intent恢复。状态仍 `HUMAN DESIGN APPROVED 2026-10-09 / INDEPENDENT DESIGN REVIEW APPROVE / NOT IMPLEMENTED`；未提供实际部署值、patch/digest或凭据。本补充不改变Keycloak/React/Vite/同源BFF/单进程选择，不赋予stateless API全局即时撤销能力，也不把未注册目录/D14/原件下载宣布可用。

1. Browser 只与同源 BFF 或经明确 CORS allowlist 的公开 API 通信；不得访问模块 internal route、数据库或 Provider 管理端点。
2. Authorization Code + PKCE 的 token exchange、refresh 和 revocation 由 BFF/受信服务边界处理；浏览器不得把 access/refresh token 持久化到 `localStorage`、`sessionStorage`、IndexedDB 或可读 Cookie。
3. Session Cookie 必须使用 `Secure`、`HttpOnly`、适用的 `SameSite`、明确 Path/Domain 和短生命周期；状态改变请求同时执行 CSRF 与 Origin/Host 校验。
4. BFF 只做认证上下文、公开 API 组合、ViewModel 映射和安全缓存，不创建第二套业务 Command、授权规则、状态机或 Repository。
5. CSP、输出编码、Trusted Types 可行性、上传/下载安全、敏感字段最小化和前端错误遥测必须在 UI-DG-003 中具体化并自动验证。
6. 页面缓存、Service Worker、乐观更新和断线重试不得把未确认 Command 显示为已提交业务事实；必须回读权威 Result 或明确显示 PENDING/UNKNOWN。
7. 前端日志、analytics、trace、error report 和 screenshot 不得包含 token、External ID 原值、客户正文、短期下载 URL 或未脱敏 Canonical Payload。

---

## 5. IM-00 退出与后续 Gate

IM-DG-001 至 IM-DG-004 已完成用户确认，IM-00 的最小决策基线完成。IM-DG-005 已由独立决策记录于 2026-08-27 获用户批准。IM-UI-01 的里程碑、依赖和边界已于 2026-08-28 获用户批准。以下内容仍不被本决定批准或尚未取得运行证据：

- IM-DG-006 6 个 Runtime Command 与默认 Runtime Policy；
- MicroCeph/OpenBao/Keycloak 的安装、配置或运行结果；
- 单机 HA、备份恢复、KMS 兼容、Object Lock、OIDC 或安全测试 PASS；
- Workspace UI 的工程技术选择已于 2026-10-08 批准；实际 Browser/BFF/Security/Accessibility/Manual 仍为 `NOT RUN`，本次不宣称部署或运行可用。

下一里程碑是 IM-01 Repository + Executable Contracts。依赖联网安装与精确 lockfile 仍需在开始 IM-01 时单独授权。

## macOS 人工联调环境 B

2026-10-17 用户批准先实现独立常驻启动和初始化，再接通 ZIP 到本机 Runner。环境 B 是本机手工测试设施，使用独立端口、带实例归属标识的 Docker PostgreSQL/Keycloak 与私有数据目录；不沿用自动化测试的临时数据库、短期账号或退出清理。默认仅监听 loopback，不修改环境 A（3100/3101）、Tailscale 或宿主 Docker context。

初始化只通过现有迁移和 owning IdentityPolicy 命令建立专用测试账号与外部身份映射；应用数据库身份不具有 superuser/BYPASSRLS。重复初始化不得轮换密钥或复制身份，停止不得删除数据卷；资源归属不符、端口占用或配置与已初始化实例不符时拒绝操作。常驻指终端退出后继续运行，不承诺开机自启、生产 HA 或灾难恢复。

Runner 项目目录由私有配置指定，按用户现有 OMP 和目录内 AGENTS.md 使用方式准备。CLI 可启动、配置可读、Provider 调用、报告校验与 Core 报告接纳分别取证；本地联调不等于下节 Ubuntu 隔离证明，不得借未注册的 BFF 接口绕过 D14。未实现的业务能力保持明确不可用，不注入合成分析或执行结果。

### 环境 B 首轮分析执行适配（已批准）

状态：`T2 / PROPOSED / USER SELECTED V0.2 2026-10-18 / LOCAL RUNNER TOOL IMPLEMENTED / MACOS EXECUTION DESIGN APPROVED 2026-10-18 / IMPLEMENTATION IN PROGRESS / DISPATCH NOT IMPLEMENTED / PROVIDER NOT RUN`。

用户已选正式 v0.2 方向并批准本机 OMP、可配置 Runner 项目目录及 Docker 数据库的人工测试目标。这里补齐原方案仅覆盖 Ubuntu 的技术差异；它不是再次选择协议。用户于 2026-10-18 明确选择“批准本机适配，继续实现”；批准对象为以下本机测试适配，不改 #256 的生产接受集或冻结模块所有权。

| 项目 | 拟采用的本机测试行为 | 必须保留的边界 |
|---|---|---|
| 适用范围 | 仅环境 B 的显式 `MACOS_MANUAL_TEST` 组合；首轮限 ANALYSIS，使用新内部执行 profile `workspace.macos_manual_omp@1`，输出仍为 `d14.analysis@1` / v0.2 | production 配置拒绝本 profile；不能构造假的 Ubuntu installation/lock、Provider 固定版本或隔离证明。首轮只处理调用方明确允许交给当前模型通道的测试资料 |
| 文件托管 | B 私有数据目录内的持久化文件适配器，实现现有 `CustomerZipObjectStore.put/read/inspect`；保存实际 ZIP、受控解包来源和报告字节，重启保留 | 服务端生成 key，临时写入、fsync、不可覆盖发布；同 key 同字节幂等，不同字节冲突，崩溃不确定返回 UNKNOWN。目录 0700、文件 0600，拒绝穿越/符号链接/设备文件；不伪称 S3 versioning、Object Lock、SSE/KMS 或备份 conformance |
| 业务事实 | 仍通过 IP/EP/TE/IG owning 操作、真实 PostgreSQL 和公开 Workspace 查询 | 文件存储不代替 RLS/授权/Receipt；不直接写他方表、不注入合成报告、不开放绕过 Registry 的 BFF 私有快捷接口；公司模板/规则仍按真实来源校验并发布 |
| Runtime | 使用 `runner.projectRoot` 指向的专用项目，`runner.profileFile` 指向外层只读部署配置；外层固定 OMP 可执行路径、实际版本/Hash、明确模型 selector 与非交互参数 | 不更改用户全局 OMP 配置；配置不是任意 shell/argv。每轮保存非秘密配置摘要及 Hash，模型/工具/AGENTS 改变须重新生成配置绑定，旧 Run 不无声切换；缺模型/凭据明确失败，不 fallback |
| 资料与规则 | 每 Run 独立物化目录；将项目 AGENTS.md 及确需的固定协议/证据工具按 Hash 带入本轮；客户文件只以来源 ID 读取 | 不把整个 Runner 历史 output/work 或其他客户材料带入；关闭其他规则/Skill/扩展/MCP/sub-agent 自动发现；只启用 read/grep/glob/write 等分析必需工具，无 shell、web 或额外模型调用。固定提取/校验由外层执行 |
| 凭据与本机信任 | 由已有 OMP 认证机制或专用 profile 提供当前模型通道，平台仅保存配置位置和身份元数据 | 密钥不进 argv/prompt/数据库/日志，不复制整个个人 home/认证目录。macOS 同一登录用户与本机可信 OMP 是测试信任边界；CLI 工具名单、独立目录、前后 Hash 不冒充 Linux 内核隔离或网络封锁，不能证明恶意 Runtime 无越界能力 |
| 调度与恢复 | IG 保留 invoke-once journal 和实际进程/输出观察；TE 保留 Run/Attempt/lease/fencing、幂等与最终结果接纳 | 进程启动或结果是否产生不明时维持 UNKNOWN，先查原调用，不盲目重启；超时后停止本轮进程树，未证实停止不得重试；本机进程停止不等于 Provider cancel ACK。初版每实例最多一个 OMP 分析进程 |
| 报告 | 固定 v0.2 Schema、校验上下文、词表映射、同源 MD/提取件、JSON/MD 原始字节 Hash | Runner 自报成功不等于 TE/EP 接纳；UNKNOWN/CONFLICT 可展示，不能变成启动批准。外层独立重验，再由 TE 接纳和 EP 保存不可变 report/candidateSet/plan |
| 人工入口 | 登录 → 建准备项目 → 上传一个 ZIP → 查看真实运行状态 → 查看已接纳分析报告 | 沿用已批准 UI；页面显示本机测试身份和执行状态，不假造百分比。生成、文件审批、发布和完整 MVP E2E 不计入首轮分析通过范围 |

运行参数首版复用 #256 的有界执行意图：一次分析最多 60 分钟，事件流/报告输出上限 32 MiB，上传与解包继续使用现有 CustomerZipPolicy。OMP 的 token/cost、模型底层版本和 Provider 取消能力按实际可观测字段记录；没有可靠硬限额机制时不得宣称已强制费用上限。资源阈值的到达/拒绝必须成为真实运行诊断，不能把失败转换成成功报告。

批准后按依赖顺序实现：先接实际文件托管、公司模板/规则与准备项目授权；再落实 TE preparation context/run 与 IG OMP 调用及恢复；最后接同源报告校验、TE/EP 接纳与公开页面查询。公开合同、持久化与失败场景按各 owning 规格同步注册，不把本表当作省略合同实现的许可。实现改动使用 `full`，独立审查通过后用小型脱敏 ZIP 验证真实 OMP 链；用户人工浏览器验收另记。

外部 Runner 的 v0.2 固定工具位于其 `contracts/runner-analysis-report-v0.2.md` 和 `runner_evidence/analysis_v02.py`；只提供原始报告形状、候选语义/证据约束与同源输出。调用方校验上下文是内部参数文件，不是 Core 授权，词表/规则发布和必需项 readiness 仍归 owning 服务。其本地自动化 PASS 不证明本节待实现能力。

## D14 Runner 首发进程隔离提案（#256）

状态：`T2 / PROPOSED / HUMAN SELECTED 2026-10-09 / TECHNICAL APPROVAL PENDING / NOT IMPLEMENTED / NOT RUN`。承接Ubuntu私有化基准；首个Runtime/provider/model/数据选择、完整lock及资源上限见 [首发提案](../decisions/d14-rd01-runner-profile-lock.md)。本节只拥有Host进程执行边界，不用CLI权限flag代替隔离，不改Browser/BFF或Core所有权。

| 边界 | 必需强制措施 / 拒绝条件 |
|---|---|
| 受信launcher | 每Run独立非root UID、mount/PID/network namespace、drop capabilities/no-new-privileges、只读rootfs、强制MAC/seccomp/cgroup；Host OCI/CLI/build/OS/kernel/arch exact pins。禁止privileged、宿主PID/网络、Docker socket、ptrace/mount/任意exec；缺机制不dispatch |
| 输入与配置 | source/template/rule/prompt/manifest/evidence工具与依赖只读mount，前后逐件hash；空cwd/个人配置视图，无客户可自动发现路径。OMP实际工具仅read/grep/glob/write，前三项仅受控根内普通文件，禁URL/内部URI；Skill/MCP/hooks/plugins/extensions/subagents/memory/advisor/辅助模型禁用。no-extensions不禁止显式加载，tools名单不证明额外发现面已关闭；设置被忽略或能力无法验证不回落默认 |
| 输出与隔离 | 只允许本Run输出根写；scratch在该根非发布子目录，另一Enterprise/Project/Run不可见。受控根句柄解析与普通文件验证，拒绝穿越/link/device/FIFO/碰撞；结束停止写入后重新hash、不可变封存，不按客户名/ZIP原路径落宿主 |
| 网络与数据 | 仅公司批准Provider TLS inference allowlist，经受控egress与DNS/目的地校验；无自动遥测/升级/反馈、任意代理、公网搜索/下载、MCP、loopback管理面/metadata。Runner不接Core/DB/OpenBao/Ceph；对象物化与封存由另有授权的Host服务完成，不把存储凭据给CLI |
| 凭据与证据 | 仅部署方预配置CLI公司身份；私有最小CLI环境、禁proc/env读取/调试/core dump/secret fd继承，无Bash/插件执行工具；外层证据工具不继承凭据。无个人home或认证文件拷贝；秘密不进argv/prompt/报告/日志，Host只核可用性证据与绑定ref |
| 生命周期 | invoke-once journal受Host保护且不在Runner可写根；stop观察覆盖整个cgroup和egress封闭，不能只杀父PID。TERM/KILL和LOCAL_PROCESS_STOPPED与ProviderACK分开；不确定继续UNKNOWN，TE独立到期，旧树未证停不允许retry |

客户AGENTS.md/CLAUDE.md、Skill/MCP/Agent配置按entryId只作为资料读取，不能触发配置加载。company配置也必须来自锁定发布源，模板/规则/旧报告的发送许可逐件核验；真实客户原文未获明确数据批准时零Provider调用。脱敏的质量/产品/职责秘密同样要批准，不能只删人名。

Ubuntu release/kernel/architecture、镜像/二进制digest、MAC策略、Provider组织与驻留/保留、credential provisioning及retention policy本次没有部署证明，不填默认或虚构值。未来在真实Host按 [Runtime验收](../runtime-adapter-contract-v0.1/Runtime-Adapter-Test-v0.1.md#d14-runner-首发锁与控制验收256)执行越界、跨Scope、输入不可变、secret/网络和全树停止反例；容器声明、CLI help和当前Darwin观察不充当生产PASS。

### 模板分析依据的产品校正（2026-10-18）

用户重申以客户资料、项目模板和 AGENTS.md 进行阅读比对，并批准先接通分析。按 [校正决定](../decisions/template-driven-preparation.md)，正常业务分析依据与 macOS Runtime 技术适配分开；不新增仅 B 可用的模板业务模式，也不要求为本轮准备项目虚构完整规范发布。此前“公司模板/规则按真实来源发布”落实为精确模板及分析基准的真实授权使用，旧 startup bundle 保持其旧接受集。当前新增分支仍在设计审查，未安装生产 Runtime、未执行 Provider 或未接纳报告的状态不得提升。

## MVP B1 独立本机实例（已批准设计）

状态：`DESIGN APPROVED 2026-10-22 / NOT IMPLEMENTED`。本节只拥有 [B1 设计](../mvp/b1-design.md)的新本机初始化与安全边界，不改变旧环境 B 或 Ubuntu 生产 Provider/Secret/KMS 决定。认证/归属语义由 [MVP01 Spec](../module-specs/Module-Spec-MVP01-DocumentDelivery.md)拥有。

- 独立 composition 只实例化 MVP01 业务服务；复用 OIDC Code + PKCE、BFF 内存 Session、Core 独立 access-token 验证与明确 peer/trust binding。缺少本实例 operator binding 时拒绝准入，不回退旧 IP、不自动按 email 建账号。B1 只绑定一个员工，不提供注册/管理用户 API。
- 本机 OIDC 使用专用 Keycloak 实例、realm/client 与持久卷，版本/digest 复用仓库已固定基线；启动器检查专用配置的 issuer、audience、redirect/logout URI、算法及 JWKS。受信 bootstrap 由操作者核对精确 issuer/subject 后写唯一绑定，不将首次登录者自动设为 owner。此选择不迁移或修改旧 B 的 realm/用户/客户端。
- PostgreSQL 使用独立 database、runtime/migration role、`document_delivery` schema 和专用持久卷；文件存储使用独占的新根。安装固定 instanceId/storeId/root device+inode，在数据库 installation 与文件根标记中交叉核对；不允许用旧根、旧库、可写共享目录或符号链接代替。运行角色非 owner、无 BYPASSRLS，无 DDL/旧 schema 权限；具体约束见 07。
- 初始化为显式管理操作：先只读检查端口、Docker context、目录/卷身份及权限，再创建专用资源；在新空库迁移/安装记录/绑定、写入新根身份标记后读回。中断须按同一 installation 意图核对已有资源；相同输入可续，任一身份/配置摘要不符停止，不能清库重试。重启不执行 seed、替换绑定或隐式迁移；schema 未准备好即拒绝启动。
- 秘密从受限配置文件/secret reference 加载，不入仓库、业务表、普通日志或 HTTP 返回；配置文件0600、配置目录/文件根0700、对象0600且无symlink。Keycloak 密码/客户端 secret、数据库密码及服务信任密钥不打印；配置摘要只包含非秘密投影和引用版本，不作为秘密低熵 hash 输出。数据库与文件卷同属受控本机测试资料边界，不能宣称生产加密/备份符合性。
- Web/BFF/Core/Keycloak/数据库只绑定明确 loopback 地址与无冲突的独立端口；不创建 Tailscale/公网映射、后台系统服务或修改全局 Docker 配置。复用安全 loader 的限制，不通过关闭 Cookie、Origin/CSRF、token 或 peer 检查接通页面；单实例进程锁与 attempt 锁须在真实本机文件系统上验证。
- 启动需专用实例标识及封闭配置；`status` 必须区分初始化状态、数据持久性、存储完整性、身份可用和分析未接入。停止只终止有身份记录的本实例进程/容器，保留卷、文件和绑定；回退切换到原入口即可，不对旧实例执行迁移/重置/删除。升级失败保留新资源及诊断；仅兼容的旧二进制可读取原 schema，不将代码回退误称数据库回滚。

B1 实施时交付配置 schema/example（仅非秘密占位）、初始化/启停/状态入口和操作者文档；实际名称在代码存在后更新 runbook，不把本节描述冒充可运行命令。本设计不执行安装或常驻映射；真实本机初始化授权、重启读回及资源隔离证据进入对应 Issue/PR。生产 S3/OpenBao/Ubuntu、备份恢复和多用户均未在本节通过。
