# IM-03 WI-07 CustomerBaseline 执行记录

## 目标

完成 Issue 63：实现 CustomerBaseline 草案、激活、三态缺失语义与 Baseline Impact Review；更新 GitHub comments；在所有实现和交付证据核验完成后关闭 Issue 63，并删除本工作项 branch。

## 初始状态（2026-08-26）

- 工作树：`galendai/im-03-wi-07-customerbaseline`。
- HEAD：`a087441`，与 `origin/main` 相同；当前没有关联 PR。
- GitHub Issue 63：OPEN，当前无 comments。
- 依赖：Issue 62；父追踪 Issue 56。

## 交付边界

1. 以 HL-Spec、EnterpriseProject Module Spec、Module Test 和 Issue 63 验收条件为依据，核对实际代码、Schema、Migration、Repository、Handler、事件和手动 probe。
2. 代码变更前同步规格文档和模块测试文档；每次测试记录输入、预期输出、实际输出，并清理临时测试脚本/文件。
3. 保留 `DESIGN VERIFIED`、自动化测试、真实 PostgreSQL、Provider/生产/人工验收和下游真实 Impact E2E 的边界；未执行项明确标记 `NOT RUN`。
4. 仅在本地验证完成后提交；提交后精确核对远端 head、CI、comments、Issue 关联和 ancestry，再关闭 Issue 与 branch。

## 验收清单

- [x] 无培训程序时，Agent 请求 `MISSING_CONFIRMED` 被拒绝为 `PROJECT_MISSING_CONFIRMATION_REQUIRED`，只允许 `NOT_PROVIDED/UNKNOWN`。
- [x] `KNOWN`/未知类 presence 与 value/evidence 组合由 Contract 和数据库约束共同验证。
- [x] 仅授权 Human 可激活；并发激活只有一个成功，事件保留精确 previous active ref。
- [x] CB-004 激活后，引用 CB-003 的旧 Context/Gap/Plan 仍解析原版本，仅产生 stale/impact 事实。
- [x] EP-API-U-001、EP-API-C-002、EP-API-E-002 有实际自动化证据。
- [x] 缺资料与新旧 Baseline probe 能清晰展示三态区别和旧版本未改写。
- [ ] Issue comment 已更新；Issue 63 已关闭；目标 branch 已删除并完成远端回读。

## 工作日志

- 2026-08-26：完成初始工作树、远端、Issue 63、Memory 和交付技能核对；确认当前 branch 只是 `origin/main` 同步快照，不是已落地的 WI-07 实现分支。
- 2026-08-26：完成 CustomerBaseline Root/Version/Item/Impact Review、V2008、Repository、Handler、Contract Registry 回归和 PostgreSQL 门禁；`pnpm test` 为 `351 passed / 215 skipped`，Persistence gate 为 `17 files / 229 passed`。
- 2026-08-26：disposable local probe 通过：Agent `MISSING_CONFIRMED` → `PROJECT_MISSING_CONFIRMATION_REQUIRED`；CB-003 输出 `PRESENT/UNKNOWN/NOT_PROVIDED`；CB-004 后旧 refs `5` 条保留，Impact `STALE/3`，active 指向 CB-004。真实下游 Process Manager、Provider、HTTP、生产和独立人工验收保持 `NOT RUN`。
