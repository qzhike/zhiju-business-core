## 背景

IdentityPolicy 已有 20 个字段级 Contract Schema，但缺少真实 PostgreSQL 关系模型和 Repository。IM-02 需要为 Principal、ExternalIdentityLink、Role/Capability、Policy/Actor/Authorization Snapshot 建立唯一 owning persistence boundary，同时保持跨模块 Typed Reference 不使用跨 Schema FK/Join。

父追踪 Issue：#28（WI-05）。硬依赖：WI-01 至 WI-04。

## 工作范围

- 为 `principal`、`principal_state_transition`、`external_identity_link`、`role_assignment`、`role_revocation`、`capability_grant`、`capability_revocation`、`policy_snapshot`、`actor_snapshot`、`authorization_decision` 编写手写 SQL Migration。
- 落实 immutable snapshot/fact、aggregate version、Scope、closed state、有效期、唯一性、hash 与必要访问索引。
- 使用 Node.js `pg` + Kysely 实现 IdentityPolicy 低层 Repository/transaction boundary；Kysely 不拥有 Schema/Migration/Domain。
- Repository transaction boundary 必须兼容 WI-03 最终权限模型：同一 NOINHERIT 登录在事务内先显式切换 `platform_context_establisher` 建立 Context，再切换 `identity_policy_app` 执行业务 SQL；普通 app 角色本身不得获得 Context 写权限。
- External Identity 仅持久化密钥化 lookup hash、envelope ciphertext 和 key version；原始 open_id/email/phone 不进入普通日志、错误、Event 或测试快照。
- 为 HMAC/字段加密定义明确 Port 和测试实现；真实 OpenBao 未接入时保持 Integration `NOT RUN`，不得以测试实现冒充生产加密验收。

## 验收条件

- [x] 数据库 catalog 与 PostgreSQL Logical Model §9 表清单和关键约束一致。
- [x] Principal kind 不可互换；撤销/状态转换追加事实，不删除或改写历史 Snapshot/Decision。
- [x] provider/account/external identity lookup 唯一冲突不覆盖原映射；原始敏感标识不会出现在 SQL 参数日志、ApiError、Event 或测试报告。
- [x] Repository 在加密前拒绝 `displayHint`、`verificationMethod`、`evidenceRefs` 等可持久化元数据携带原始 account/subject；active lookup 不返回已撤销 Link。
- [x] Role/Capability/Actor/Authorization 行保存精确 Enterprise/Project Scope，并受 RLS；跨模块引用只保存 Typed Reference 列组。
- [x] Enterprise Scope 不携带 Project；Project Scope 必须携带 Project，且 RLS 使用事务上下文允许的 Project 集合，不能只验证 Enterprise。
- [x] 撤销事实与父 Assignment/Grant 的完整 Scope 一致；CapabilityGrant/AuthorizationDecision 对 PolicySnapshot/ActorSnapshot 使用精确 id + payload hash，并校验 Actor 的 Principal/Kind/认证上下文/Scope 镜像。
- [x] immutable Contract 的 UPDATE/DELETE 被权限拒绝；Repository 在真实 PostgreSQL 事务写入前以共享 canonical JSON v1 重算 payload/hash，数据库拒绝 promoted Scope、Actor/Policy 精确引用不一致。`pgcrypto` 未启用时不得宣称数据库自行重算 canonical hash。
- [x] focused persistence tests、Migration replay 与 `pnpm clean && pnpm verify` 通过。

## 手动验收产出

提供脱敏 catalog/Repository probe：创建测试 Principal 与加密 ExternalIdentityLink 后，仅显示 lookup hash、ciphertext metadata 和安全 display hint；数据库与日志中搜索不到输入原值。

## 非目标

- 不实现真实 OpenBao、Keycloak/OIDC 或飞书身份 Adapter。
- 不实现 20 个公开 Handler 的业务行为；它们由 WI-07 至 WI-09 完成。
