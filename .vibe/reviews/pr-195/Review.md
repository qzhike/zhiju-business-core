# PR #195 正式关闭前审查

结论：`APPROVE`。Issue #190 的 design-only 验收已满足，无未解决阻断发现。人类已明确批准 P-190-1 方案 A；本审查不把设计批准或仓库回归通过解释为真实创建授权已实现。

## 审查对象与独立性

- 审查日期：2026-09-14。
- Repository：`qzhike/zhiju-business-core`，经 `vibe repo --json` 确认。
- Issue：[#190](https://github.com/qzhike/zhiju-business-core/issues/190)。
- PR：[#195](https://github.com/qzhike/zhiju-business-core/pull/195)。
- Reviewed SHA：`378ecb2b1d6461ad014cbe3b5426ef15a1b11868`。
- Base SHA：`928b0c3cd9983c58b08714d8dc8d43166bcea828`。
- 实际差异：六份决定、owning Spec/Test 与共享 API 文档；无产品代码、Registry、Schema、migration、授权数据或历史 Compatibility Baseline 改动。

审查者独立读取最新 Issue 正文与评论、PR head/diff、当前 CI 状态与日志，并核对受影响契约和相关实现。前次提案审查只作为历史证据，本次已重新审核批准记录、Spec §3 两处 Purpose 修正、共享 API 与决定旧未决说明的同步，以及所有新增批准状态和链接。

本文件按项目 `AGENTS.md` 的正式 pre-close review 要求保存。它记录上述实际被审 SHA，不预填尚不存在的包含本文件的提交；本文件提交后，最终新 head 的差异与 CI 复核应另在 PR 留证，避免通过不断改写本文件制造自引用提交循环。

## 验收矩阵

| Issue #190 验收 | 独立证据与结论 | 结果 |
|---|---|---|
| 四版本实际声明、fixtures 与运行入口对账 | 决定 §13.1 对应 public-api/compatibility metadata、Spec 003 §3/§11.1/§11.6、共享 API、Task v1/v2 fixtures 与 WorkOrder v1/v1.1 Schema 测试；准确区分静态契约与真实 Handler | DESIGN VERIFIED |
| 逐版本唯一 Purpose、推荐与备选、旧客户端和历史兼容 | Spec 003 §15.1 保留四条已发布值；决定 §13.2 比较 A/B/C/D，解释旧 Decision/Capability、registry/baseline 与客户端影响；不注册别名或通配授权 | DESIGN VERIFIED |
| Human、Coordinator Agent、Service 与 DRAFT 边界 | Spec 003 §15.2 与 Domain §18.8/§19.9 一致；调用者使用自己的 ActorSnapshot/Decision，禁止借 actingFor/requestedBy 提升为 Human-only，业务 Scope 与精确授权 Scope 分离 | DESIGN VERIFIED |
| 当前 grant、精确版本与幂等回放 | Spec 001 §14 与 Spec 003 §15.3 要求当前有效资格、精确 Intent/Scope/Purpose/version、返回 DUPLICATE 前重验；原 Receipt 不授予新动作资格，不改写历史事实 | DESIGN VERIFIED |
| 最小 owning Delta 与可执行失败场景 | Spec 001 §14、Spec 003 §15、IP-P190-001–006、TE-P190-001–011 覆盖跨 Purpose/版本、身份/Intent/Scope、撤销、旧合法请求、提权与回放；运行状态保持 NOT RUN | DESIGN VERIFIED |
| 批准前 PROPOSED、独立审查与真实人类决定 | 批准前提案基线与 diff 身份在决定 §13.3 保留；明确批准原文为“批准推荐方案A”，日期 2026-09-14；批准后文档同步与批准范围一致 | PASS |
| 配置验证与分层证据 | 本地最终 full 的既有原始 PASS 证据，加本次独立读取的精确 head CI SUCCESS 和 PostgreSQL gate 日志；未执行的新增业务验收未冒充 PASS | PASS |

## 关键契约核对

| 操作版本 | 已批准唯一 Purpose | 兼容边界 |
|---|---|---|
| `execution.create_task@1.0` | `task.execution.create_task` | 修正旧 Spec 文字，保留历史 metadata 与 Schema |
| `execution.create_task@2.0` | `execution.task.create` | 保留现行注册，不自动继承 v1 能力或 Decision |
| `execution.create_work_order@1.0` | `task.execution.create_work_order` | 修正旧 Spec 文字，保留历史 metadata 与 Schema |
| `execution.create_work_order@1.1` | `task.execution.create_work_order` | 同 Purpose 仍必须绑定自己的精确版本 Decision |

IdentityPolicy 继续拥有授权解释与当前有效性检查，TaskExecution 不直接访问他方 Repository。具体 capabilityCode/Policy 实例配置未在本次设计中凭空发明；已批准规则要求明确覆盖版本、动作、资源及 Scope，缺失或无法解释则 DENY，后续实现仍需单独 NOW + READY 复核。

实际实现缺口已准确留在文档中：`authorizeCommand` 当前仅支持 `commandVersion === '1.0'`，Task v2/WorkOrder v1.1 尚不能真实签发 Decision；通用 Decision 校验不等于当前 grant 重验；TE runner 可在比较 requestPayload Hash 后返回 DUPLICATE，未独立核对 Receipt 的 command type/version，且跳过业务 body。因此，未来授权和版本防串用检查必须覆盖幂等返回路径，不能仅置于 body。这些是后续实现边界，不是本 design-only 交付的遗漏。

## 人类批准与范围

决定 §13.3 记录 2026-09-14 用户明确批准“批准推荐方案A”，批准对象为 P-190-1 A，包括 Spec 003 §15 与 Spec 001 §14 的逐版本映射、Actor/Scope、当前 grant 重验及回放边界。[Issue 批准留证](https://github.com/qzhike/zhiju-business-core/issues/190#issuecomment-5659674750)与 PR 正文一致。

提案审查材料基于 `928b0c3cd9983c58b08714d8dc8d43166bcea828`，工作区 diff SHA-256 为 `8bacb8f553ca8a0950e1e244f2ac6793f1b31fe2d64ba84ee094bc0df58dec2d`。本次 reviewed SHA 在该方案上记录真实批准并同步冲突文字，没有扩大批准语义。TD-01–04 未重开，TD-05–07 与 PolicySnapshot objectType 分歧未获本次追认。

## 验证证据

精确 reviewed SHA 的 [CI run 34811568195](https://github.com/qzhike/zhiju-business-core/actions/runs/34811568195) 与 [verify job 103873800290](https://github.com/qzhike/zhiju-business-core/actions/runs/34811568195/job/103873800290) 均为 `completed / success`；run 的 `headSha` 为 `378ecb2b1d6461ad014cbe3b5426ef15a1b11868`，完成时间为 `2026-09-14T06:04:48Z`。本次直接通过 GitHub CLI 读取状态与 job 日志，没有重跑 full。

- CI 在 checkout 后安装锁定依赖并执行 `pnpm verify`，对应完整验证编排；格式、lint、类型、架构、生成契约检查通过。
- 一般测试：56 files passed，33 files skipped；既有本地最终 full 为 870 tests passed、354 skipped，跳过项不计为通过。
- Catalog/Registry：`catalog_registry=PASS catalog=211 registry=211 schema_status={"FULL":211}`。
- 历史兼容：`compatibility=PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=64 findings=64`；该输出中的 findings 计数不改变工具给出的 PASS 结论。
- 真实 PostgreSQL：`server_version: 180006`（18.6），Flyway OSS 11.20.3；37 persistence test files passed；既有本地最终 full 为 369 persistence tests passed。
- 空库迁移至 V6002、V6003/V6004 历史 Provider Result 升级、第二次 migrate no-op 通过；CI 日志明确 `gate passed`。
- 提交内容对应的既有配置验证原始结果为 `{"status":"PASS","target":"full","command":"pnpm clean && pnpm verify","exit_code":0}`，本次精确 head CI 提供提交后的独立远端佐证。

## 发现与关闭边界

阻断发现：无。非阻断发现：无新增；已知未实现边界已在 owning 文档准确记录。

本次结论支持 Issue #190 按 design-only 范围关闭。实际关闭仍应由 Delivery 在本文件进入 PR、最终新 head 复核及其 required checks 通过后执行，并读回远端状态。本审查没有执行 merge、关闭 Issue、提交、推送或分支删除。

新增 Task/WorkOrder 创建授权 Handler、实际四版本 Capability/Policy 接线、Task/WorkOrder 业务持久化链、外部 Provider/集成与人工业务验收均为 `NOT IMPLEMENTED / NOT RUN`。已有仓库回归和 PostgreSQL gate 的成功不证明这些新场景运行通过；后续实现 Issue 必须分别验收。
