## 背景

IM-02 的 IdentityPolicy 最小切片首先需要可创建 Human/Agent/Service Principal，并安全解析 ExternalIdentityLink。基础设施 Bootstrap Admin 不能自动成为 Zhiju HumanPrincipal；首个业务 Principal 必须通过显式、一次性、可审计流程建立。

父追踪 Issue：#28（WI-07）。硬依赖：WI-05、WI-06。

## 工作范围

- 实现 `identity.register_principal@1.0` 与 `identity.link_external_identity@1.0` Command Handler/Application Service。
- 实现 `identity.resolve_principal@1.0` Query，不提供目录枚举；required Scope/purpose 不满足时返回安全折叠结果。
- Principal kind 创建后不可互换；External Identity 必须经验证且 provider/account/subject 冲突不覆盖。
- 建立一次性受审计 bootstrap claim：明确操作者、理由、证据、失效条件与重复执行行为；Bootstrap Admin 身份本身不直接映射为业务 Role/Capability。
- 生成严格符合现有 Schema 的公开 Event；`ExternalIdentityLinked` 只含 lookup hash ref，不含原始标识。

## 验收条件

- [ ] Human、Agent、Service Principal 正向创建；非法 initial status/kind 变化被拒绝。
- [ ] IP-API-U-002：同 external identity 绑定第二 Principal 返回 `IDENTITY_EXTERNAL_LINK_CONFLICT`，首个映射保持不变。
- [ ] IP-API-C-001：Event、日志、ApiError、Audit 安全摘要均不含原始 open_id/email/phone。
- [ ] Bootstrap 首次成功、相同请求幂等重放、不同主体争用与完成后再次执行均有确定性结果和审计证据。
- [ ] 无目录枚举路径；按未知 External Identity 查询不泄漏已存在 Principal 的其他 Scope。
- [ ] Unit/Contract/真实 PostgreSQL persistence tests 与 `pnpm clean && pnpm verify` 通过。

## 手动验收产出

使用脱敏身份 Fixture 注册 Human/Agent/Service，并将一个测试 external identity 解析回 Human；用户可查看安全 Event/Audit 且无法从输出恢复原始标识。

## 非目标

- 不接入真实 Keycloak、飞书或 OpenBao；相应 Integration/Manual 状态保持 `NOT RUN`。
- 不授予 Role/Capability；首个业务 Role 的 bootstrap 收口由 WI-08 完成。
