REQUEST_CHANGES

PR: https://github.com/qzhike/zhiju-business-core/pull/184

Reviewed SHA: `6928c29be1bfd246513d3ba4fa65dbf6413a4cb3`

审查日期：2026-09-13。关联 Issue：#183。角色：独立 Reviewer。

## 阻塞发现

### R1 — P2：补齐已批准静态验收的反例与边界对照，不能以替代样本宣告全部 PASS

位置：`contracts/src/operations/identity-policy.schema.test.ts:504`、`:554`、`:564`；`.vibe/module-tests/Module-Test-001-IdentityPolicy.md:163`、`:166`、`:168`。

Issue #183 要求执行 Module-Test #181 适用于静态边界的正反例。`IP-181-C-002` 明确要求同一个合法写入版本在等值结果预算 262144 下读回被拒，并在 266240 下通过。当前测试中，真正通过写入的 262144 字节版本读回为 261205 字节，因此不能构成等值预算的反例；另一个 262144+1024 结果样本复制回请求后，测试明确断言请求被拒绝。后者只能证明两个预算独立，不能证明“合法写入在等值预算下读不回”。Module-Test 仍将该行标记 PASS，同时承认没有复现要求的反例。

同一交付中还有两个明确的静态边界缺口：`IP-181-C-009` 要求对 resolve 请求 Envelope 做 B/B−1 单变量核对，但计量测试仅覆盖 `{}`、40/16384 字符样本和 record result，未对 resolve 请求执行这对断言；`IP-181-C-004` 要求对象 256/257 的正反向边界，测试只有 257 拒绝，没有 256 通过。

修复要求：补充一个结构合法且确实被写入预算接受的请求，逐字段保留其共享 payload 生成结果，对同一结果分别使用 262144/266240 预算，断言前者只因 `maxResultBytes` 拒绝、后者通过；补上 resolve 请求的 B/B−1 和对象 256/257 对照。计量样本取值可以明确说明，但不能用一个写不进去的文档替代合法写入反例。未执行的验收部分在补齐前保持 NOT RUN；如已批准反例与当前权威形状存在冲突，应呈现冲突而不是把不等价样本标记为完成。

### R2 — P2：同步 owning Spec 中仍把已交付静态契约描述为待实现的当前状态

位置：`.vibe/module-specs/Module-Spec-001-IdentityPolicy.md:321`，以及同节第 365 行、§13 第 262 行。

第 321 行在新增 `PARAMETERS REGISTERED` 状态后仍声明“参数值与 SD-181-1 已批准但尚未实现”及“Registry 登记随后续……交付”；第 365 行仍声明技术参数“尚未注册”；第 262 行仍把可执行 Schema/Registry 与 Handler/migration 一并列为后续交付。当前 PR 已实现前两者及 SD-181-1，因此 owning authority 对同一能力给出了相反的执行边界。这会使后续 Handler 任务无法可靠区分已交付契约与剩余实现，也未完成 Issue #183 要求的同次文档对账。

修复要求：将这些当前状态统一为 Schema/Registry/Guard/SD-181-1 已静态实现；Handler、真实授权、scoped 事实表和业务链仍未实现/NOT RUN。保留设计历史时明确标识其历史范围。

## 字段与边界核对

| Contract | 必填字段逐项核对 | 可选字段与其他约束 | 结论 |
| --- | --- | --- | --- |
| record payload | policyRef、policySetVersion、policySchemaRefs、policyDocument、effectiveFrom | supersedesRef 可选；policySchemaRefs 非空且唯一；CanonicalJson 未加入消费 profile 语义 | 与 §13.3 一致 |
| record result.data | policyVersionRef | 直接返回闭合对象；显式 resultSchemaRef；结果挂 Guard | 与 §13.3 一致 |
| resolve payload | policyRef | AUTHORITATIVE；VERSIONED/zhiju.identity.policy | 与 §13.3 一致 |
| PolicyVersionResolutionView | policyRef、policyVersionRef、policySetVersion、policySchemaRefs、policyDocument、contentHash、scopeRef、effectiveFrom、useStatus、checkedAt | supersededAt 可选；policySchemaRefs 为普通 TypedReference[]；useStatus 四值闭集 | 字段与 required/optional 一致 |
| PolicyRef / PolicyVersionRef | 共享 Ref 必填字段与固定 objectType；Scope.enterpriseId | projectId 可选，Scope 闭合；snapshot 身份、目标、Scope、查询回显和两个 Hash 的相等关系由独立 binding helper 检查 | 已检查形状与静态绑定，不证明事实存在或内容真实性 |
| PayloadGuard / SD-181-1 | 262144 / 266240 / 16384 / 1024 / 256 / 32 / 64 | 共享技术条目；结果减请求为 4096；两个操作中的三个时刻字段至多 24 code point；旧共享 UtcInstant 不变 | 参数与实现一致；验收覆盖缺口见 R1 |

## 验证证据与限制

- 本地定向复验：`node_modules/.bin/vitest run contracts/src/operations/identity-policy.schema.test.ts`，1 file / 38 tests PASS。最初的 `pnpm exec vitest ...` 无输出等待，已停止；没有将该次等待视为通过。
- 已独立读取当前 SHA 的 GitHub CI run 34724946912 元数据与日志：SUCCESS；静态测试 854 passed / 321 skipped；Catalog/Registry 211/211；compatibility baseline 200，minor/findings 64；PostgreSQL 18.6 / Flyway 11.20.3 persistence gate 的 35 files / 336 tests PASS，迁移与二次 no-op PASS。
- PR 交付评论记录同一 SHA 的 `vibe verify full --json` PASS；本轮复用当前修订的 CI 与该完整目标记录，没有重复运行本地完整目标。CI 实际命令为 `pnpm verify`，与评论中的本地 clean/full 证据区分。
- 新增 Handler、真实 Purpose 授权、scoped PolicyVersion 表/FORCE RLS、版本唯一性/并发裁决、IP-181-E-001、业务 E2E、外部与人工验收保持 NOT RUN。

本次只新增项目要求的正式审查记录，不修改产品实现，不执行 commit、push 或 merge。结论通过 PR comment 发布；它不是 GitHub 的正式 REQUEST_CHANGES review。
