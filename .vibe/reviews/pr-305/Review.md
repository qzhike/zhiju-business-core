# PR #305 独立代码审查

APPROVE。独立审查未发现阻断问题；连接关闭顺序修复通过针对性反例、本机完整验证及精确 head 的远端完整 CI。本结论仅绑定下述实现修订，文档入库后的新 head 仍须单独完成增量审查和适用验证。

## 审查对象与依据

- PR：[#305 — fix(test): await PostgreSQL connections before container shutdown](https://github.com/qzhike/zhiju-business-core/pull/305)。
- Reviewed SHA：[`ee61acca3affdbb346042f5c35140d3231f1f513`](https://github.com/qzhike/zhiju-business-core/commit/ee61acca3affdbb346042f5c35140d3231f1f513)，分支 `codex/persistence-probe-cleanup`；base 为 `main@8e6fca61316e9cd95baa0708a20f3300d95e159e`。审查时 PR head、`vibe repo --json` 和本地 HEAD 一致。
- 审查完整七文件差异：initial Context suite 的资源登记、新增连接池关闭跟踪器及类型、新增普通回归、PostgreSQL 锁定摘要，以及验证基准和技术基准更新。未修改生产业务、业务断言、真实期限、分片分配或关键用例清单。
- 依据根 `AGENTS.md`、`.vibe/project.yaml`、`vibe-development` Reviewer 规则、[验证基准 §2.1.1](../../high-level-docs/08-verification-baseline.md#211-配置化验证目标与-ci-路由)和[技术基准 §7](../../implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md#7-wi-01-已锁定的物理参数源自-issue-29)。此为 T1 测试基础设施修复，适用验证目标为 `full`。

## 独立预期与实际审查

预期是消除正常清理时容器先于连接关闭的竞争，同时保留真实数据库错误、资源关闭失败、有限等待和兜底清理，不能通过吞掉 `57P01`、减少业务覆盖或放宽门禁使 CI 变绿。Reviewer 在检查实际差异前按上述范围建立预期；本记录是同一 Reviewer 已完成审查的正式入库，不声明重新盲审。

1. **关闭顺序。** 已独立读取 [原失败 run 39535840974](https://github.com/qzhike/zhiju-business-core/actions/runs/39535840974) 的完整分片 2 日志：94 个用例通过但存在未处理的 `57P01`，相关连接仍为 `_ending=true`、`_ended=false`。锁定版本的真实 `pg-pool` 源码显示，移除空闲连接后其池计数可以先归零、`pool.end()` 可以先完成，而底层连接尚未发出 `end`。
2. **修复与独立反例。** 新跟踪器在池第一次连接前登记 `connect` 监听，记录每条已建立连接的 `end` Promise；清理等待 `pool.end()` 和剩余连接全部结束。Reviewer 使用真实锁定版本 `pg.Pool` 配合可控传输结束事件，分别对照空闲连接和清理前已淘汰连接：旧的 pool-only 关闭在结束事件前已完成；当前跟踪器在第一条连接结束后仍等待，直到全部连接结束才完成。该诊断不需要数据库，不替代完整持久化验证。
3. **失败传播和资源生命周期。** 跟踪器只监听连接建立/结束，没有添加吞掉数据库错误的监听器；池关闭拒绝继续传播。suite 的 `Promise.allSettled` 仍关闭全部已登记资源并聚合错误，隔离层原有 10 秒资源关闭上限、失败退出和容器兜底清理保持不变。未改变禁止复用、测试体收敛、drain 或迟到 setup 的资源回收规则。
4. **测试有效性。** 六项新增普通回归使用真实锁定版本的连接池，仅控制客户端结束事件，覆盖空闲/已淘汰连接顺序、关闭期间 fatal 错误、关闭拒绝、空池和已结束连接；断言不以池计数或 `pool.end()` 单独充当实际关闭证据。既有隔离、超时和失败探针保持不变，747 个持久化用例及 96 个关键用例没有删减。
5. **镜像更新边界。** 已独立读取旧、新官方 manifest 原始字节，其 SHA-256 分别与旧、新锁定摘要完全一致。amd64/arm64 均保持 PostgreSQL 18.6 和 Dockerfile 修订 `e00e1bd34ec5c8a8e7ad89b273b3d42efaf6d5bc`，基础系统镜像摘要变化。新摘要为 `sha256:5486e8fb206952552c7e2eaf2e36e4c7be3cd36b2b396eb41de618aa5664a781`；tag/digest 绑定和服务端版本校验没有放宽。此同版本重建同步是独立的环境基线更新，连接时序修复由上述对照证明。

## 验证证据

执行明细保留在 [PR #305](https://github.com/qzhike/zhiju-business-core/pull/305)。Reviewer 已读回本机 `vibe verify full --json` 的完整最终汇总：退出 0、PASS，普通 151 文件 / 3,150 例、浏览器 60 例、持久化 65 文件 / 747 例、96 个关键用例、文件清单、迁移 no-op 和容器清理通过。本机原始输出中部被工具截断；当前 head 的远端完整日志补齐最终运行证据，没有重复运行本机 full。

Reviewer 直接读取已保存的最终 run 元数据和完整日志 ZIP，确认 [run 39555813853, attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/attempts/1) 为 reviewed SHA、completed/success，七个 jobs 全部 success。各 checkout 日志明确关联相同实现 head 与 base；select 选择 `full`，完整变更数为七文件。

| 远端验证 | 独立核验结果 |
| --- | --- |
| [普通检查](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/job/119075270500) | 151 文件 / 3,150 例，浏览器 7 + 53 例通过；Workspace 独立构建和生产拒绝检查通过。 |
| [分片 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/job/119075270610) | 1 文件 / 64 例，64 个关键用例通过。 |
| [分片 2](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/job/119075270720) | 6 文件 / 94 例，32 个关键用例通过，成功完成收尾。 |
| [分片 3](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/job/119075270574) | 58 文件 / 589 例，预期关键清单为零，文件清单通过。 |
| [持久化汇总](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/job/119081127841)及[最终 verify](https://github.com/qzhike/zhiju-business-core/actions/runs/39555813853/job/119081206491) | 所需依赖全部 success，`WORKFLOW_CANCELLED=false`，两层均返回 `PASS`、`failures=[]`。 |

Reviewer 从三个完整日志的 file-end 和叶级结束记录重新核对：65 个文件恰好执行一次，与仓库预期集合完全一致，无缺失、额外或重复；747 条叶级结束状态全部为 passed，关键清单合计 96。每个分片均完成历史 seed、后续迁移、第二次迁移 no-op/history 检查和 PostgreSQL 容器清理。没有将预期业务用例名称中的失败状态词当作执行失败，也未输出序列化错误中的连接凭据。

## 最终结论与交付边界

阻断发现为零，`APPROVE` 绑定实现 SHA `ee61acca3affdbb346042f5c35140d3231f1f513`。修复符合授权范围，未削弱测试语义或门禁强度，未发现新增的未决人类技术审查事项。真实客户 Runner、外部 Provider、生产环境和独立人工业务验收不由本次工程验证覆盖，保持各自 NOT RUN 边界。

本文件作为普通后续文档提交加入 PR。新 head 须独立复核该文档增量并取得适用 CI；完整 PR 仍含持久化工具和镜像基线变更，应按 full 路由。旧 head 的成功不预先证明新 head 通过。最终 head、增量审查和 CI 证据保留在 PR，无需为追逐本文件自身提交 SHA 再改写记录。Reviewer 本轮只补齐正式文档，不执行 commit、push、merge 或清理；合并、清理和 main CI 跟进由交付协调方按用户授权及最终门禁执行。

## 2026-10-21 镜像索引漂移增量审查

Reviewer 独立读取 [run 39562052765, attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39562052765/attempts/1) 完整日志。checkout 为 `d3eb6e24d2c667c69b1bbb575151d5c2fcadc5c3` 与当时 main `48d08d8a3a395f7b891105edae38136dfaeb7ad4` 的合成修订；三分片均在 PostgreSQL startup/image verification 阶段因实时 tag 摘要与 pin 不同而退出，测试文件开始及叶级结束记录均为零。普通检查通过，但持久化及最终汇总正确失败；本轮不能记为 full PASS，也没有证据表明连接清理缺陷再次发生。

已独立读取官方 registry 的旧、新 raw manifest，字节 SHA-256 分别为 `5486e8fb206952552c7e2eaf2e36e4c7be3cd36b2b396eb41de618aa5664a781` 和 `1267c7e692de235fda2a50dbcdbcbca4672ea6a0298576a6bd9d07cafc319b32`，与失败日志及拟更新值一致。amd64、arm64 的完整 descriptor 均逐字段相同，仍为 PostgreSQL 18.6、同一源码修订和同一平台镜像摘要；索引元数据未变，变化仅涉及 arm/v7、386、ppc64le、s390x 及其 attestation descriptor。这次索引同步不来自对 main 更新的推定。

当前增量仅将 `tools/persistence/baseline.mjs` 的固定摘要更新为上述 `1267…`，并同步技术基准事实；连接关闭实现、业务用例、分片、tag/digest 拒绝和服务端版本校验未改变。独立静态复核未发现新增阻断。交付方另提供 `environment` PASS 和 pinned-baseline 六例 PASS 的窄验证结果；前者不启动容器，二者均不能替代 full。

前述对 `ee61acca…` 的实现 APPROVE 及成功 CI 保留为历史证据，不扩展为此次基线同步后的新 head 已通过。摘要更新与本段入库后，仍须以当前 main `48d08d8a3a395f7b891105edae38136dfaeb7ad4` 为基准复核整合增量，确认摘要冲突处理保留已核对的新 pin 且没有改动 main 的其他内容，并取得最终 head 的适用 full CI。当前远端验证待验，最终证据继续维护在 PR，不为记录自身 SHA 再次修改本文件。

## 2026-10-21 合成令牌泄漏探针增量审查

Reviewer 独立读取 [run 39564156344, attempt 1](https://github.com/qzhike/zhiju-business-core/actions/runs/39564156344/attempts/1) 的分片 3 完整日志：head `9e56e21a1c5e8c7cd8f640d4667ae868ab3a65d6` 的该分片为 588 例通过、1 例失败。唯一失败来自 `workspace-trusted-http.test.ts` 原 `not.toContain('eyJ')` 断言；实际触发值是 43 字符、无点号分段的合法 PKCE challenge，其中偶然包含该三字符子串。此失败不构成令牌泄漏证据，也不能记为 full PASS。

依据 [UI01 Spec §6](../../module-specs/Module-Spec-UI01-WorkspaceUI.md#6-bffsession-与认证) 和 [UI-258-011](../../module-tests/Module-Test-UI01-WorkspaceUI.md#可信-session-与公开接入验收场景258)，独立审查本轮四文件增量：测试专用探针、16 项普通回归、原 HTTP 用例与 owning Test 说明。探针按现有替身签发格式识别三段 compact JWT，包含空签名且没有全局或 sticky 状态；真实 RSA access/ID token 的 URL、JSON、Cookie、嵌入字符串泄漏与合法随机值均有对照。原 observed 数组经逐字比较保持不变，secret、subject、Bearer 和 subject hash 断言均保留；新增 opaque refresh token 检查要求本次新签发、非空且不同于旧值，并在全部原观测面拒绝其实际值。没有改动生产认证、provider 签发行为、持久化用例名称、分片或关键清单。

Reviewer 直接导入实际探针，以独立生成并验签的 RSA token、空签名形式及原失败 PKCE 完成 20 个配对观测面检查，全部通过，并确认重复调用稳定。交付方提供新增普通回归 16/16 PASS；Reviewer 另读回真实 PostgreSQL 与 HTTP 的整文件聚焦诊断：退出 0、11/11 PASS、服务端版本 180006、第二次迁移 no-op 和容器清理完成。该输出中部迁移表被工具截断，最终测试与清理汇总完整，且明确标注关键清单未检查；这些窄证据均不替代 full。

本轮静态及反例审查未发现新增阻断，原误报已在当前未提交增量中纠正。此前实现 APPROVE 和后续失败历史各自保留；本段不批准尚未产生的最终 head，也不将聚焦通过等同于合并门禁通过。正式提交后仍须独立复核精确 head，并取得适用完整 CI，确认全部持久化用例、96 个关键用例、文件清单、迁移与清理通过。最终修订和执行证据继续保留在 PR，不为追逐本文件自身 SHA 再改写记录。
