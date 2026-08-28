# Zhiju Business Core Deployment and Security Baseline v0.1

版本：v0.1
日期：2026-08-17
状态：`BASELINE / IM-DG-003-004 USER APPROVED / IM-UI-01 MILESTONE USER APPROVED 2026-08-28 / UI IMPLEMENTATION NOT STARTED`

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
7. Orphan Cleanup 必须有宽限期、Lease、审计和 Legal Hold/Retention 检查；精确时长在 IM-04 冻结。

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
- Workspace UI 的具体技术栈与实现结果；IM-UI-01 只完成里程碑建档，Browser/BFF/Security/Accessibility/Manual 均为 `NOT RUN`。

下一里程碑是 IM-01 Repository + Executable Contracts。依赖联网安装与精确 lockfile 仍需在开始 IM-01 时单独授权。
