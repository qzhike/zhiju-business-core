## 背景

IM-02 的最小纵向切片必须由 IdentityPolicy 唯一生成不可变 AuthorizationDecision，并让其他模块通过 Decision/Query Port 获取结果，而不是读取 `identity_policy` Schema 或自行解释 Role/Capability。ActorSnapshot 中的 `actingFor` 不得改变真实 actor kind。

父追踪 Issue：#28（WI-09）。硬依赖：WI-03、WI-08。

## 工作范围

- 实现 ActorSnapshot 的受控创建/校验边界，以及 `identity.authorize_command@1.0` 唯一 Decision Port。
- 实现 `check_enterprise_access`、`check_project_access`、`check_human_only_capability`、`get_policy_snapshot` 四个 Query；连同 WI-07 的 resolve query 覆盖全部 6 个公开 Query。
- Decision 绑定 exact actor snapshot、authentication context、command intent、Scope/Purpose、payload hash、PolicySnapshot、outcome/reasons 与 expiresAt。
- 非 ACTIVE Principal、过期/撤销 Role/Grant、Scope/Purpose 不匹配和 Agent `actingFor` Human 的 Human-only 请求都产生不可变 DENY Decision 与安全审计。
- ALLOW 也不能变成长期 token；业务 Handler 后续必须校验 Decision hash、时效、scope 与 intent。

## 验收条件

- [ ] IP-API-U-001：Agent `actingFor` Human 请求 Human-only Capability 固定 DENY，并保留 Agent kind。
- [ ] 同一 Human 在 Project A 得到 ALLOW，在 Project B 得到安全 DENY；Enterprise A 不能探测 Enterprise B 对象存在性。
- [ ] Decision/ActorSnapshot payload 或 hash、Scope、Purpose、command type/version、authentication context 任一不匹配均拒绝。
- [ ] Decision 与 Snapshot 不可更新/删除；Role/Capability 撤销后历史 Decision 可解释，但新 Decision 为 DENY。
- [ ] 其他业务模块无法直接导入 IdentityPolicy internal Repository，Database Role 也无法直接读取其权威表进行授权判断。
- [ ] 6 Query 的 Handler/Contract/persistence tests 和真实 PostgreSQL 受控 E2E 通过。

## 手动验收产出

提供 Principal → Role/Capability → PolicySnapshot → ActorSnapshot → AuthorizationDecision 的脱敏追踪视图；用户可比较 Project A ALLOW、Project B DENY 与 Agent `actingFor` DENY 三条链。

## 非目标

- 不实现 Keycloak token/JWKS 验证或真实飞书身份解析。
- 不自动完成 #22–#24；这些 Issue 仍需在各自 Runtime Handler 验证 Decision provenance。
