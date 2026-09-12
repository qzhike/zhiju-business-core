# PR #180 独立审查

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`7e94c571bd772fb2dc68cf9cf298cb31df3379a1`
- 日期：2026-09-12
- 范围：Issue #179，首版 Policy profile Schema、静态 Registry、IdentityPolicy 注册性与 EP/TE 纯校验。

## 阻塞发现

### P2：同步设计决定中的实际能力清单

`.vibe/decisions/task-execution-human-operated.md` §12.9，第 508–511 行仍把 `im06-static-v1`、四个 profile 的固定 typed ref、生成物与构建检查明确列为“仍缺少（实际能力，均 NOT IMPLEMENTED / NOT RUN）”。这与本 PR 的实现以及更新后的 owning Spec/Test 冲突。Issue #179 直接引用该节，且第 518 行要求后续业务实现根据此清单确认实际依赖，过期状态会误导后续 readiness 判断。

最小修正：在该节区分 #179 已实现的静态 registry/schema/纯校验与仍未实现的 PolicyVersion API、Handler、授权、生命周期、Evaluator 和业务链；保留设计批准的历史含义，不将业务链标为 PASS。该问题属于已确定事实的文档同步，无需新增产品决策。

## 字段核对矩阵

| Profile | 字段 | 契约与实现核对 |
| --- | --- | --- |
| capture | maxSliceValiditySeconds | 必填 PositiveInt，无默认值，一致 |
| capture | allowedPurposeCodes | 必填 NonEmptySet<NamespaceCode>，非空且唯一，一致 |
| Builder | allowedProjectionTypes | 必填 NonEmptySet，限 Core §3.4 六类投影，一致 |
| Readiness | maxReadinessValiditySeconds | 必填 PositiveInt，无默认值，一致 |
| Validation | maxValidationValiditySeconds | 必填 PositiveInt，无默认值，一致 |
| Validation | mandatoryCriterionTypes | 可选 Set，缺省与空集接受，去重约束且限 Core §4.9 七类，一致 |

四个文档均拒绝未知字段。核对了七项固定 canonical VersionedRef、未知版本拒绝、重复 key/身份与缺失映射拒绝、生成副本一致性、旧 registry 接受集合保持、owning profile 必需性，以及合法 fixture 的单维度负例。未发现需报告的功能性缺陷。

## 验证证据与边界

- 独立执行 `DOCKER_HOST=unix:///Users/galendai/.orbstack/run/docker.sock vibe verify full --json`：`status=PASS, target=full, command=pnpm clean && pnpm verify, exit_code=0`。
- 常规测试：53 files / 816 tests PASS；31 files / 321 tests skipped，不能视作已执行。
- 独立 PostgreSQL gate：35 files / 336 tests PASS；migration、二次 migrate 与 gate PASS，容器已移除。
- architecture PASS；public API 209 / profiles 7；Compatibility Baseline v1.0 200 operations PASS。
- 同 SHA 的 GitHub CI verify SUCCESS：https://github.com/qzhike/zhiju-business-core/actions/runs/34689347465/job/103541763268。
- PolicyVersion 存在性、授权、生命周期、解析与真实业务链、外部集成及人工验收仍 NOT RUN；既有 persistence 回归不能替代这些验收。

本次仅新增正式审查记录，不修复实现、不提交或推送 Git commit、不合并 PR。按用户授权向 PR 发布 Comment；角色结论不等于 GitHub 的正式 Request changes review。
