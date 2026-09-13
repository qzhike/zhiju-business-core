PLANNING_REQUIRED

Reviewed SHA: `93cbe44ae13825738210fab6878b6abd3536e098`

PR #184 / Issue #183，2026-09-13 独立复审。本轮已核对上一轮 head 之后全部四个文件的 diff、最新 Issue/comments、相关 Envelope/TypedReference Schema、owning Spec/Test 与当前 CI 日志。

上一轮 R2 已修复；R1 中 resolve 请求 B/B−1 和对象 256/257 的缺口已补齐。剩余的 `IP-181-C-002` 已批准等值预算反例仍未满足。将它从 PASS 改为 NOT RUN 是正确的证据纠正，但不构成验收条件已完成，也不自动授权豁免该条件。当前需要先对齐设计与验收口径，不能 APPROVE。

## 剩余阻塞：已批准验收与新实测结论尚未正式对账

Spec 001 §13.3.2 与 Module-Test `IP-181-C-002` 仍要求“同一个合法 Project 写入，在等值结果预算 262144 下读回 262153 并被拒”；新测试得到同一写入的读回为 262049，两个预算均通过，并据此声称反例不存在。Issue #183 的验收未调整，当前没有授权的设计修订或验收替换。因此不能把这项 NOT RUN 当作本次静态切片之外的运行期限制而关闭。

建议由 Planner 对齐 Spec §13.3.1/§13.3.2、Module-Test C-002 与 Issue #183：核查旧反例是否使用了不符合当前 Envelope 的样本；如旧反例确实无效，明确更正其事实与验收要求，保留现有 262144/266240、4096 余量和 SD-181-1。仅修正反例不意味着可以把结果预算改为等值。若仍保留原验收，则需交付可经当前 Schema 和绑定校验的原反例。Reviewer 不替代设计授权作此选择。

## 新证据问题：当前“最小请求”证明遗漏 ExternalRef 分支

位置：`contracts/src/operations/identity-policy.schema.test.ts:155`、`:665`；`.vibe/module-tests/Module-Test-001-IdentityPolicy.md:157`、`:163`。

`actor` 与 `authorizationDecisionRef` 在当前 Envelope 中均为 `TypedReference`，其 `oneOf` 包含 `externalRef`。新 helper 选取的最短 ObjectRef 为 95 字节，但下列合法 ExternalRef 只有 86 字节：

```json
{"system":"a","resourceType":"a","externalId":"a","observedAt":"2026-09-12T00:00:00Z"}
```

独立探针先复现新测试的 ObjectRef 正向基线（`C_req=1476`、`C_res=1381`），然后只把这两个请求专有引用替换为上述 ExternalRef：

| 样本 | C_req | C_res | 请求专有成员字节 | 写满 262144 后的结果字节 |
| --- | ---: | ---: | ---: | ---: |
| 新测试 ObjectRef 样本 | 1476 | 1381 | 903 | 262049 |
| ExternalRef 对照 | 1458 | 1381 | 885 | 262067 |

ExternalRef 对照的请求 Schema、结果 Schema、查询结果绑定和写入结果绑定均返回 `{valid:true, errors:[]}`。因此“903 是请求专有最小编码”及“任意合法写入的读取帧 ≤262049”的声明有直接反例。这是当前静态 Schema 的接受集合探针，不声称该 actor 或 authorizationDecisionRef 能通过真实业务授权。

这个对照仍小于 262144，**它没有复现旧等值预算拒绝反例，也没有证明反例存在**。它证明的是新修复的全称结论所用极值依据不完整。设计对账前应遍历/推导全部 TypedReference 分支，并区分 Enterprise/Project Scope，或者把现有数字明确限定为样本值；不要继续把 903/262049 当成已证明的全局界，也不要为保住该结论收窄旧 Envelope 的接受集合。

## 已关闭问题与验证

- R2：Spec §13、§13.3.1 的三处过期状态已更新为静态契约/参数已交付，Handler/migration/运行期授权仍未实现。
- R1 边界补项：resolve 请求 1311 通过 / 1310 以 maxEnvelopeBytes 拒绝；对象 256 通过 / 257 以 maxObjectProperties 拒绝，已读测试并独立执行。
- 本地定向：`node_modules/.bin/vitest run contracts/src/operations/identity-policy.schema.test.ts`，38/38 PASS。
- 独立只读探针：使用当前本地构建的 `ContractRegistry`，复现上述 ObjectRef 与 ExternalRef 对照，未修改测试或产品实现。相关产品 Schema/Registry 在本轮 diff 中没有变化。
- 当前 head CI [34725936436](https://github.com/qzhike/zhiju-business-core/actions/runs/34725936436) 的 headSha 与本次审查一致，SUCCESS；已读取日志：静态测试 854 passed / 321 skipped，Catalog/Registry 211/211，compatibility baseline 200 / minor 64，PostgreSQL 18.6 persistence gate 336/336 PASS，二次迁移 no-op PASS。PR 修复评论另有本地 `vibe verify full --json` PASS 记录；本轮复用当前修订证据，未重复执行完整目标。
- 新 Handler、真实授权、scoped PolicyVersion 表/FORCE RLS、版本唯一性/并发、IP-181-E-001、业务 E2E、外部与人工验收仍 NOT RUN。

项目要求的 `.vibe/reviews/pr-184/Review.md` 已追加本轮结论并保留首轮记录。本轮不修改产品代码，不执行 commit/push/merge。此结论以 PR comment 发布，不是 GitHub 正式 review。

---

## 首轮审查历史（6928c29）

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
