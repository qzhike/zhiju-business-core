批准后状态补充（2026-09-12）：用户已批准 reviewed SHA `5975da3f52f83cf5b9c24dfe5e046f5d4996521b` 的 P-176-1–5，原 HUMAN_REVIEW_REQUIRED 所指门槛已满足。[批准记录](https://github.com/qzhike/zhiju-business-core/pull/178#issuecomment-5644716219)。下列复审记录保留其发生时的结论；批准状态同步与本正式审查记录随 PR #178 交付；最终 head 的检查与合并证据以 PR comments 为准。

---

HUMAN_REVIEW_REQUIRED

复审版本：`5975da3f52f83cf5b9c24dfe5e046f5d4996521b`。

独立技术复审未发现新的阻塞问题，R1–R4 在设计层均已解决。最终角色结果为 `HUMAN_REVIEW_REQUIRED`：Issue #176 和提案 §12 明确要求新增实质决定经人类批准；当前 P-176-1–5 仍为 PROPOSED，最新 Issue/comments 未提供该批准。本结论不把技术复审通过视为人类批准或实现验收。

本轮独立检查了 `280e15e` → 当前 head 的完整四文件 diff、最新 PR/Issue comments、Spec 001 §13.4/§13.6、PostgreSQL §33、决定 §12.3/§12.7、Module-Test 001 和当前 SHA 的 CI。改动仍为 T2 设计修订，没有新增业务代码、Schema 或 migration。

| 发现 | 当前复核结果 |
|---|---|
| R1：scoped 事实复用 Platform RLS | 设计修复保持有效：独立 `policy_version` scoped 表、FORCE RLS 与 Purpose/Scope 授权，旧 Platform 表及读取路径独立 |
| R2：profile 无合法注册路径 | 设计修复保持有效：新 registry 版本、四个 profile 的 canonical typed-ref 映射规则与 owning 校验分工 |
| R3：同一前驱多个后继 | 设计修复保持有效：一前驱至多一后继、稳定竞争错误、唯一派生截止时间与未来生效规则 |
| R4：无前驱版本发生唯一冲突 | 本轮已修复：后继部分唯一索引仅包含 supersedes 两列均非空的行；无前驱版本被排除；Enterprise 行的 NULL project_id 仍按 NULLS NOT DISTINCT 比较；版本键唯一约束继续覆盖全部行 |

R4 的正反向对照已同步到 `IP-176-D-008` 与决定 §12.7：同 Scope 不同 Policy 首版可共存、同 identity 未互相取代的版本可共存、同一真实前驱的顺序/并发第二个后继仍拒绝，均要求覆盖 Enterprise 与 Project Scope。Spec、持久化设计与场景之间一致；本次没有把这些尚未执行的场景标记为运行 PASS。

验证证据：[CI run 34681714165](https://github.com/qzhike/zhiju-business-core/actions/runs/34681714165/job/103521425724) 的 headSha 与 reviewed SHA 完全一致，verify job 与 pnpm verify 步骤 SUCCESS。该脚本包含 PostgreSQL persistence gate；本轮采用该 revision 的远端证据，未重复运行本地 full。现有回归通过不证明新设计行为已实现；新增 resolver/Handler、Registry、migration、新 PostgreSQL 业务链、外部集成与独立人工验收仍为 NOT RUN。

待人类审核的是当前 §12 所呈现的 P-176-1–5，包括 scoped PolicyVersion 事实及两个新入口、生命周期与取代规则、首版 profile/Evaluator 注册、Purpose/授权与消费时重验边界。获批前不能据此启动依赖实现或关闭 #176，也不能把完整业务链标为 READY。

已更新本地 `.vibe/reviews/pr-178/Review.md` 并保留前两轮历史。未修改产品实现或 owning 设计，未 commit/push/merge。本条是 PR comment，不是 GitHub 正式 APPROVE review。

---

以下为旧 SHA 的历史审查，不代表当前结论。

REQUEST_CHANGES

复审版本：`280e15ea8824985f7a3581ceba6871bbc88bc30f`。本次仍是 T2 设计文档修订，没有新增运行时代码。已独立核对最新 Issue/comments、实际修订、owning Spec/Test、API/Catalog 与持久化设计。

**新增阻塞发现 R4 — P1：后继唯一约束错误地限制每个 Scope 只能有一个无前驱版本。**

位置：[`Module-Spec-001-IdentityPolicy.md:349`](https://github.com/qzhike/zhiju-business-core/blob/280e15ea8824985f7a3581ceba6871bbc88bc30f/.vibe/module-specs/Module-Spec-001-IdentityPolicy.md#L349)，PostgreSQL §33 同样规定了该约束。

设计要求对 `(supersedes_object_id, supersedes_version_id, enterprise_id, project_id)` 施加无条件的 `UNIQUE ... NULLS NOT DISTINCT`。但 `supersedesRef` 是可选字段，初始版本的两列 supersedes 均为 NULL。于是同一企业 E 的两个不同 Policy（例如 capture Policy A 和 Builder Policy B）分别创建初始版本时，即使 policy objectId、versionId、policySetVersion 和幂等键完全不同，该后继索引中的键也都等于 `(NULL, NULL, E, NULL)`，第二个合法初始版本必定发生唯一冲突。Project Scope 同理，冲突键为 `(NULL, NULL, E, P)`。把 NULL 改成 COALESCE 哨兵并不能消除这一冲突。

这不仅阻止不同 Policy 在同一 Scope 下分别建立首版，也与 §13.4(5) 明确允许未声明取代的独立版本冲突。现有 IP-176-D-002/003 只覆盖重复版本键和已有前驱的竞争，缺少多个无前驱版本共存的正向对照。

请将后继唯一性限定在真实取代边上，例如使用带 `WHERE supersedes_object_id IS NOT NULL AND supersedes_version_id IS NOT NULL` 的部分唯一索引，同时保留对 Enterprise 行 `project_id IS NULL` 的 null-safe 比较；版本键唯一约束继续覆盖全部行。同步 Spec 001、PostgreSQL §33 和 Module-Test 001，并加入以下设计验收：同 Scope 不同 Policy 的首版均成功、同 identity 不取代的不同版本可共存、同一真实前驱的顺序/并发第二个后继仍被拒绝，分别覆盖 Enterprise 与 Project Scope。

**上轮发现复核：**

- R1：设计层已修复。新增 scoped `policy_version` 表、FORCE RLS 与 Purpose/Scope 授权隔离新事实；旧 Platform 表及读取路径保持独立。运行验收仍 NOT RUN。
- R2：设计层已修复原先无法建立合法输入的问题。新增 `im06-static-v1` 注册扩展和四个 profile 的 canonical typed-ref 映射规则，写入/解析/消费路径已明确。Registry 实现仍 NOT RUN。
- R3：已明确“一前驱至多一后继”、稳定竞争错误与未来生效边界；但实现该决定的设计约束引入上述 R4，因此不能认定整体修复完成。

**验证证据：** [CI run 34679258044](https://github.com/qzhike/zhiju-business-core/actions/runs/34679258044/job/103514672654) 的 `headSha` 与本次 reviewed SHA 一致，`verify` job / `pnpm verify` 步骤 SUCCESS；该脚本包含持久化 gate。此次复审采用该 head 的 CI 证据，未重复运行本地 full。R4 是尚未实现的 DDL 设计的直接反例，未声称已在新业务表上运行复现；现有 CI 不验证该新增约束。新 resolver/Handler、真实新增 PostgreSQL 业务链、外部集成及独立人工验收仍为 NOT RUN。

P-176-1–5 仍为 PROPOSED，新增实质决定仍需人类批准。已按 Issue #176 要求更新本地正式审查记录，保留上轮历史；未修改产品代码或 owning 设计，未 commit/push/merge。

---

以下为上一轮审查记录，仅适用于旧 SHA。

# PR #178 独立设计审查

结论：`REQUEST_CHANGES`

- 审查日期：2026-09-12
- PR：https://github.com/qzhike/zhiju-business-core/pull/178
- Issue：#176（T2 设计交付）
- Reviewed SHA：`be21d5e0aa88d905a3ba0bb1a75191d990cd469f`
- 范围：实际文档 diff、Issue/评论、受影响 Spec/Test、共享 Contract、现有 IdentityPolicy Registry/写入/读取/RLS 与验证证据。未修改产品实现。

## 阻塞发现

### R1 — P1：企业/项目版本绑定不能直接复用 Platform Snapshot 的现有 RLS

位置：`.vibe/module-specs/Module-Spec-001-IdentityPolicy.md:320–323`。

§13.6 把带 enterprise/project Scope 的版本键及 canonical payload 放入 `policy_snapshot`，随后要求复用既有 RLS。现有 V1001 的 `policy_snapshot_select` / `policy_snapshot_insert` 只检查 `platform_security.context_is_valid()`，没有 enterprise/project 条件；`getPolicySnapshot` 也仅校验空 Scope 的 exact id/hash，然后读取该表。因而持有有效企业 B Context 的应用角色仍能读取企业 A 新增的版本绑定及正文；只在新 resolver 校验 Scope 无法封闭直接 SQL 或既有 Snapshot 读取路径。Module-Test 的 IP-176-D-006 所要求的跨 Enterprise SQL 拒绝无法由此设计成立，也不满足 HL-Spec §5.6 的企业行 RLS 约束。

请明确新增绑定与正文的隔离归属、旧 Platform 行与新 scoped 行的 RLS 分支，以及旧 exact Snapshot 入口读取新行的授权规则；同步 Spec 001、PostgreSQL 设计与测试。必须覆盖合法同 Scope、另一 Enterprise、同 Enterprise 的另一 Project 和旧 Platform Snapshot 兼容读回。不得仅靠隐藏 SnapshotRef 代替授权。

### R2 — P1：首版四个 profile 没有可通过写入与消费两端的注册路径

位置：`.vibe/decisions/task-execution-human-operated.md:369`、`:397–402`；Spec 001 §13.4(5)。

§12.2(5) 明确要求所有 `policySchemaRefs` 可由现有 Registry 解析，并称 @2.0 不新增或放宽 Registry 内容；§12.4 又要求 refs 包含对应新 profile schema。现有 `POLICY_SCHEMA_REGISTRY` 只有 `identity.PolicySnapshot@1.0`、`identity.RolePolicy@1.0`、`identity.CapabilityPolicy@1.0`，对应 typed-ref 映射也只有三项。四个 EP/TE profile 均不在其中。以 capture 为例，提供新 capture schema 会在写入端被拒绝；只提供旧 schema 则不满足消费端的必需 profile 引用。当前没有同时满足两端的合法基线。

请在设计中明确四个 profile 的 schema 身份、typed reference 与 registry key 映射、构建期注册扩展及 owning 校验边界，修正“不新增 Registry 内容”的矛盾，并给出经 record → resolve → get → consume 的完整正向输入。这里要求补齐设计，不要求本 PR 提前实现 Registry。

### R3 — P2：同一前驱允许多个后继，supersededAt 无法唯一派生

位置：`.vibe/module-specs/Module-Spec-001-IdentityPolicy.md:304`、`:321`。

当前只约束后继与前驱同 identity/Scope，且后继 `effectiveFrom` 更晚。设 A 在 t0 生效，B 在 t1 生效并 supersedes A，C 在 t2 生效也 supersedes A（t0 < t1 < t2）；B/C 使用不同版本键与 policySetVersion，顺序提交或并发提交都满足现有全部条件。于是 A 的 `supersededAt` 按定义同时等于 t1 和 t2。现有版本键唯一约束与 supersedes 普通索引不能裁决该情况，后续解析、Context 上界和是否允许新消费均无法确定。

请在 owning 设计中固定取代关系的基数与并发裁决：若只允许一个后继，应明确唯一约束和第二个竞争提交的稳定错误；若允许多个后继，则必须明确确定性的截止时间派生规则及不得重新延长旧版本可用性的约束。补充顺序/双连接竞争、未来生效及在截止点消费的反例。

## 验证证据与边界

- GitHub CI run `34678052638` 的 `headSha` 与 reviewed SHA 一致，`verify` job 为 SUCCESS；步骤执行 `pnpm verify`，该脚本包含 persistence gate。链接：https://github.com/qzhike/zhiju-business-core/actions/runs/34678052638/job/103511371042 。
- 本地独立执行 `vibe verify full --json`：返回 `VERIFY_FAIL`，底层 exit_code=1。clean、format、lint、typecheck、49 个测试文件/760 个测试、architecture、contracts 检查通过；Docker/PostgreSQL gate 报 `Could not find a working container runtime strategy`。这是本地容器运行环境阻塞，未据此认定产品实现失败，也不宣称本地 full PASS。
- 以上现有回归不验证拟议 resolver、profile、Handler 或新增数据库业务链；这些运行验收以及真实 Provider/Feishu/Runtime、独立人工业务验收均为 NOT RUN。
- 三项发现基于设计文本与现有代码/DDL 的直接对账，未执行尚未实现的新行为复现。
- P-176-1–5 仍为 PROPOSED。独立审查不替代人类对新增实质决定的批准；本审查不授权实现、关闭 #176 或合并。

## 交付

按 Issue #176 与项目指令保存本正式审查文件；审查结果通过 PR comment 发布。此文件未 commit/push，未修改其他文件。
