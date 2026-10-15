# PR #299 独立代码审查

## 最新复审：#291 完整修订

- 日期：2026-10-15。
- PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)，Draft；Issue：[#291](https://github.com/qzhike/zhiju-business-core/issues/291)，T2。
- Reviewed product SHA：`e4b435979d5b659a9859b8c3a86a80e32a5fc9ce`；由 Reviewer 在最终复核时独立执行 `vibe repo --json` 确认。复核时无未提交产品差异，仅本正式记录尚未跟踪。
- Reviewer outcome：`HUMAN_REVIEW_REQUIRED`。本轮未发现剩余可证实的阻塞实现缺陷；原 R1 所指的“仅有 ticket helper、完整旅程未接线”范围缺口已补齐。新增准入、授权、RLS 与对象托管涉及的适用人类技术审核仍须完成，本结论不授权合并。
- 验证状态：该产品修订的本地 configured `full` 已通过；远端新 head 的 CI 在本记录形成时为 `PENDING`，不得沿用旧 helper head 的 CI。正式记录后续文档提交不包含在上述产品 SHA 中。

### 独立预期与范围

依据最新 #291、原 R1 评论、批准的 [#277 Delta](../../decisions/preparation-entry-bootstrap.md)、IP/EP/IG/UI owning Spec/Test、TE D14 selectors、共享 API/Catalog/persistence 边界建立预期，再核对实际源码、迁移、正负 fixtures 与证据。完整结果应是当前获权 Human 的 NEW/EXISTING 准备创建、一次 ZIP 与说明提交、真实源托管及原请求恢复；缺 TE/Runner 能力可以诚实等待，不能制造 Task、Run、报告或启动事实。

复核覆盖有限 React/BFF/Core routes、显式生产配置与 owning 组装、独立准入与 scoped provisioning、原命令及原绑定恢复、ZIP/DOCX 安全、对象读回、EP source receipts、IG manifest/Receipt/Outbox 与 EP Inbox/handoff、一次 CAS 重传及旧流 fencing。未将 fixtures 的结构有效或受控外部 ports 当作 native TE/Runner 或生产部署成功。

### R1 与本轮发现的复核

| 边界 | 最终产品核对结果 |
| --- | --- |
| R1：完整旅程缺少实现 | IP/EP/IG owning 服务、迁移、公共闭集 contracts 和真实 React/BFF/Core 接线均已交付；生产启用依赖显式配置与实际 publication/enrollment，未配置时安全不可用。受控实际 PostgreSQL 与 built-browser 证据覆盖创建、提交、刷新/重登录及恢复，不再是独立 helper。 |
| 当前权限与恢复 | 原作者、完整 Scope、稳定 target/key/raw payload/hash 由 owning 事实固定；独立 SERVICE authority 与 Human 原 ANALYZE 资格分别检查。UI 分别查询 EP/IG，写入资格失效不再截断仍获权的 custody 读取。另一个 Human、跨 Scope 或身份覆写仍拒绝。 |
| 历史绑定与依赖撤回 | 原 request 与 captured source 保留 immutable payload；模板撤回后返回原 tuple/已提交步骤与 STALE，禁止新 intake。历史读取放宽仅用于封闭读取，仍保留当前 SERVICE exact authority、原 Human/enrollment 与 Scope 检查；source 依赖未知的 UNKNOWN 结果已同步 schema。 |
| 安全失败与一次重传 | 安全、限额、全包损坏或零可分析源失败带不可重传标记；普通中断仍须 stream closed、无 durable object/EP link/manifest 的 owner proof，并通过独立 aggregateVersion/generation CAS。保存原 restart command，重放不续票据期限，不开第三代。 |
| ZIP/DOCX 安全反例 | 已修正注释伪造 MIME、分离关系 Type/Target 和外部 officeDocument 关系被误认作 DOCX 的反例；核验精确 Override 与同一内部关系。deflate 必须完整消费声明压缩段，末尾垃圾不能稀释展开比。普通 DOCX/Markdown 与 unsupported/corrupt 限制路径保留。 |
| 公共闭集与引用 | IG 命名 results/原 command 的类型及 Scope 已收紧；首个 ACCEPTED 需 upload，合法过期 replay 可省略。共享 Registry/Catalog 增加 11 项至 258；旧 frozen 200 与 TE 63 项接受集保留。正负 fixtures 覆盖 weak/wrong refs、额外字段、hash/Scope、状态与第二次重传。 |
| 公司源对象边界 | 使用部署显式 keys 的独立只读 S3 reader，核验实际 bytes/hash 后交由 EP 检查当前 publication、固定来源及唯一 slice；未扩大 intake put/inspect 的窄 key 接受集。协议测试不等同真实 Ceph 验收。 |
| TE 能力与映射 | Task/analysis request 使用 canonical `zhiju.execution.*` 目标；真实 Registry 的两项 selector 未 FULL 注册时，SOURCE 保留且 TE create/request/read 零调用，返回 WAITING_CAPABILITY。回调存在不构成能力已安装。未来 owning 返回须通过注册 schema、目标/Scope/hash/aggregate 与原命令 readback 检查后才持久化；结构 fixtures 不构成真实 TE Receipt。 |
| 完整验证中的资源与共享 fixture | runtime pools 有受信注入并由测试显式回收；仅关闭 idle HTTP 连接，不强杀 active 请求，不放宽 30 秒 hook，不吞清理失败。共享公司源只精确复用实际 published bytes/hash/version/provenance；默认 OIDC subject 独立，实际 Human 解析有断言。目录四表及总数更新没有放宽原 owning/TE 断言。 |

### 精确修订验证证据

- 最终本地 `vibe verify full --json`：原主会话执行单元 `92259`，工具退出码 **0**，最终实际结果为 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`。Reviewer 独立读取主会话实际工具返回文本的临时导出 `/tmp/pr-299-full-92259-tool-output.txt`，核对退出状态、汇总、migration、清理及最终 JSON；该文件明确保留工具截断声明，不是完整未截断日志。没有重复执行 full，临时文件不作为仓库交付物。
- 该 full 的普通测试 **139 files / 2885 tests PASS**；production browser **5 PASS**；fixture browser **36 PASS**；Catalog/Registry/FULL 均 **258**，frozen **200 PASS**。持久化 **64 files / 735 tests PASS，零 skip**；第二次 migration 无待应用变更，gate passed，临时 PostgreSQL 容器移除。
- 清理证据包含 browser context、Chromium、artifact process、BFF、Core、runtime pools、owning pools、OIDC 和 stack 各阶段正常结束；BFF active requests=0、Core active requests=0，所有 pool.end 完成。Core 关闭回调时尚待 close 事件的两个 idle 连接不被当作未完成的 ZIP 请求。
- 新旅程实际 owning PostgreSQL 与 BFF/Core/生产 SPA browser 用例包含 NEW/EXISTING、响应恢复/真实重登录、ZIP 与说明、能力不可用及中断后的同 intake generation 2。history 用例通过真实组合验证依赖撤回后的原请求/source 历史保留。它们属于受控本地验收；其具体 fixture 边界以 [journey](../../../tests/persistence/preparation-journey.test.ts)、[history](../../../tests/persistence/preparation-history-recovery.test.ts)、[browser](../../../tests/persistence/preparation-built-browser.test.ts) 及相应 owning tests 为准。
- Reviewer 在上述最终产品 SHA 独立执行 focused Vitest：ZIP safety、S3 object store、preparation task port、preparation fixtures、intake contracts、workspace transport，**6 files / 102 tests PASS**。这用于复核具体负例、闭集与 guard，不替代 full。
- 先前 full `2727`、`5320` 为 FAIL；`42009` 暴露 clean build 类型错误后修正；被中止的运行不记 PASS。最终通过仅指 `92259` 对应的冻结产品修订，不能用单独断言通过掩盖 suite/hook 失败。

### 保留门禁与未运行层

真实外部 OIDC Provider、Ceph/RGW、native TE preparation engine、Runner/真实 execution ack、报告和客户/人工验收均为 `NOT RUN`；没有生产发布或部署证据。受控 OIDC provider、本地 object port、SigV4 协议测试、结构 fixtures 与 built-browser 各自只证明其实际覆盖的层。

新远端 head CI 仍须取得精确 SHA 的 required checks；本地 full 与 CI 是独立证据。#291 涉及的新授权/隔离与持久化实现仍须适用人类技术审核。#277 的既有设计批准不被提升为本次实现的生产验收或合并授权。本记录未提交 GitHub 原生 APPROVE/REQUEST_CHANGES review，未 commit、push、merge 或改动产品代码；由原主会话完成已授权的 PR 交付及 CI 等待。

---

<details>
<summary>历史审查：12a1cb2 / REQUEST_CHANGES / 原 R1（完整原文保留，不代表当前结论）</summary>

# PR #299 独立代码审查

- 日期：2026-10-15。
- PR：[PR #299](https://github.com/qzhike/zhiju-business-core/pull/299)，Draft。
- Issue：[#291](https://github.com/qzhike/zhiju-business-core/issues/291)，T2。
- Reviewed SHA：`12a1cb243f311a83d99e661e97ce559791005e43`；发布前再次确认远端 head 相同。
- Reviewer outcome：`REQUEST_CHANGES`，针对 #291 整体交付尚未完成。未发现当前票据加密组件内可证实的新增阻塞缺陷。

## 范围与独立预期

读取最新 Issue/PR 与评论、项目配置、HL-Spec 入口及验证基线、IG owning Spec/Test 的 #277 票据/恢复要求、相关 API transport、完整三文件 diff、当前 dispatcher 与调用点。先依据批准规格建立预期，再核对实现：票据绑定 intake、原作者、Enterprise/Project、原 payload hash、ZIP hash/长度及 generation；随机 token 至少 256 bits；固定五分钟，原票据重放不续期；错误绑定、篡改、过期及缺失历史密钥拒绝。授权、持久化及旧流 fencing 必须由 owning 服务另行保证。

完整 Issue 的出口是可使用的 NEW/EXISTING 创建 → ZIP 托管 → 原请求恢复旅程；TE/Runner 不可用可以是诚实的最终状态，但不能因此省略准备创建、来源接纳和生产接线。本次未变更公共 schema/registry，未将局部 TypeScript 类型当作完整公共契约注册证据。

## R1：完整用户旅程尚未接入生产（P1，已声明的 WIP 缺口）

当前 diff 只有 `upload-ticket.ts`、其单元测试和一段 owning Spec 实现边界说明。检索 `apps/`、`modules/`、`packages/` 的源码，codec 仅由自身测试调用。

[dispatcher L115–120](https://github.com/qzhike/zhiju-business-core/blob/12a1cb243f311a83d99e661e97ce559791005e43/apps/api/src/workspace/dispatch.ts#L115) 仍将 preparation 创建/恢复和 ZIP intake 创建/查询列为 `ALLOWLISTED_UNIMPLEMENTED`；[L363–368](https://github.com/qzhike/zhiju-business-core/blob/12a1cb243f311a83d99e661e97ce559791005e43/apps/api/src/workspace/dispatch.ts#L363) 对它们返回 `DEPENDENCY_UNAVAILABLE`。因此合法客户端请求也无法完成 #291 的第一个实际创建动作，更不能完成首次 ZIP 托管或恢复。加密函数通过测试不会改变该路径。

这是 PR 已如实披露的未完成范围，不是本次新增的回归或隐藏缺陷；但按当前 Issue 验收不能 APPROVE 完整交付。请 Implementer 继续交付 Issue 已约定的 IP/EP/IG owning 操作、封闭契约、持久化与权限、真实来源/manifest/outbox/inbox、能力感知 handoff 和 React/BFF/Core 接线，并补齐 owning acceptance 的正负及故障证据。保持 Draft；后续完整 head 需重新独立审查。不能仅把本 PR 标题改为局部组件就视为 #291 已验收。

## 组件核对结果

未发现需要修复的组件级阻塞问题；以下结论只来自当前静态实现与测试检查，不代表独立密码学安全认证或真实上传服务已完成。

| 契约字段或边界 | 当前实现 |
| --- | --- |
| intakeId、creatorId、enterpriseId、projectId | UUIDv7 校验；四字段全部进入固定顺序 AAD |
| submissionPayloadHash、zipBytesSha256 | 64 位小写 hex；全部进入 AAD |
| declaredByteLength、generation | 整数 1–100 MiB、代次 1/2；全部进入 AAD |
| keyId、issuedAt、expiresAt | AAD 绑定；精确五分钟，签发前及到期瞬间拒绝 |
| upload.generation/token/expiresAt | 原代次、32 随机 bytes 的 base64url token、原期限；replay 不修改记录 |
| upload.method/path | 固定 PUT 与 `/api/customer-intakes/<intakeId>/zip` |
| upload.expectedByteLength/expectedZipBytesSha256 | 精确来自已验证 binding；七个公开字段与 owning 闭集一致 |
| 密文及历史密钥 | AES-256-GCM，12-byte nonce、16-byte tag；缺 key 安全失败；显式轮换可读取原记录 |
| 使用边界 | 没有伪造授权、持久化、restart 或流处理成功；Spec 明确仍待集成 |

## 验证与门禁

- [CI run 38689711858 / attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/38689711858) 的 headSha 与 reviewed SHA 一致。读取时 select、checks 成功，persistence 仍 IN_PROGRESS；完整 full/汇总成功尚未取得。这是待完成证据，不记为 CI FAIL，也不单独作为实现缺陷。
- 当前 CI workflow 的 checks 包含普通代码 Gate，persistence 为 full 所选的独立数据库 Gate。没有重复运行本地 full。
- `gh run view ... --job 116272615802 --log` 因整条 run 尚在进行而不可取；宿主最小只读 GitHub 探测成功，不属于认证或网络故障。不把 PR 自报的本地 full/environment 结果当作本轮独立执行证据。
- 独立 focused 单测：`./node_modules/.bin/vitest run modules/integration-gateway/src/customer-zip/upload-ticket.test.ts`，1 file / 26 tests PASS（Vitest 4.1.10）。最初 `pnpm exec vitest run ...` 启动后持续无输出，主动中止（exit 130）；直接调用仓库已安装 Vitest 成功，未改变依赖或配置。既有测试覆盖全部八个绑定替换、token/密文篡改、期限、进程重建、显式 key 轮换和输入边界；这不替代 IG-277-001–006 的 owning integration。
- #291 新用户旅程的 PostgreSQL、公开 HTTP、built-browser、实际 ZIP/source/manifest/recovery 验收尚无交付证据；生产、外部 TE/Runner 和独立人工/客户验收保持 NOT RUN。已有其他功能的 CI 测试不能提升本旅程的状态。
- 完整交付仍须 final-head full 通过、正式审查及适用人类技术批准；本次不推断批准已满足。

## 交付状态

本记录为项目要求的正式审查文档，不属于 reviewed SHA；产品代码未修改，未 commit、push 或 merge。已按用户授权发布 [PR comment 6185763516](https://github.com/qzhike/zhiju-business-core/pull/299#issuecomment-6185763516)，通过 GitHub API 回读确认正文、reviewed SHA 和结论。Reviewer outcome 不等同 GitHub 原生 REQUEST_CHANGES review。本地仅新增本审查记录，尚未提交到 Git；`git diff --check` 通过。

</details>
