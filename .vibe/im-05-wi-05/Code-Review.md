# IM-05 WI-05 PR #135 代码审查

日期：2026-08-30
初审 PR Head：`e668c5ba18c3bf46be7bc5125ffb9570de475452`
审查状态：`FINAL PASS / CR-001–CR-005 REMEDIATED / PR #135 MERGED / ISSUE #125 CLOSED`

## 1. 审查范围

- GitHub PR #135 相对 `main@a613705cbc336789aa6c6047a6e14bb87766c7f1` 的完整差异；
- Issue #125、HL-Spec、Module-Spec/Test-004、Module-Spec/Test-007；
- `V7001`、RenderAttempt Repository/Service、确定性 OOXML Renderer、Object Storage Port；
- 真实 PostgreSQL RLS/ACL/幂等/UNKNOWN/reconciliation/rollback 和 Artifact 公共 Port 组合；
- DOCX/XLSX openability、输出清理和 GitHub 交付边界。

## 2. 初审发现

| ID | 严重度 | 发现 | 风险 | 要求的订正与回归 |
|---|---|---|---|---|
| CR-001 | P1 | 正常成功路径直接调用 `recordSuccess`，未调用 Provider `verifySucceeded` | 错误 Adapter 可返回未经过权威 output/Receipt readback 的成功结果并推进 `SUCCEEDED` | 所有成功结果在落库前必须执行权威验证；验证拒绝或异常时进入 `FAILED`，不得创建 Raw Receipt 或成功 Outbox |
| CR-002 | P1 | Local Provider 的 `verifySucceeded` 只检查声明 checksum 与对象是否存在，未绑定 exact locator、media type 和 canonical Receipt payload | 可用另一个自洽对象/Receipt 替换本 Attempt 的权威结果 | 固定 attempt-derived output/receipt locator；检查媒体类型；重建 canonical Receipt bytes，并与 readback 逐字节比较 |
| CR-003 | P2 | Provider 提前完成时 `Promise.race` 的 timeout timer 未清理 | 成功请求仍保留无用 timer，延长进程存活并积累资源 | 在所有完成分支清理 timer；保留 timeout 后迟到 Promise 的 rejection observation |
| CR-004 | P2 | ART-023 Representation 报告未输出 Binding 的 `requestPayloadHash` | Issue #125 的人工输出无法独立核对 request identity | 在脱敏报告中输出 authoritative `requestPayloadHash`，不增加 Secret 或原始 Provider payload |
| CR-005 | P1 | PR #135 首轮 CI 在冷工作区 lint 失败；`tests/persistence` 导入 IntegrationGateway 却未声明对应 TypeScript project reference | 本地既有 `dist` 缓存掩盖类型无法解析，精确 head CI 不可交付 | 在 persistence test project 增加 `modules/integration-gateway` reference，并以 `pnpm clean && pnpm verify` 从零构建产物复验 |

## 3. 初审已确认通过的边界

- forward-only `V7001`，未修改既有 `V7000`；
- Attempt 先提交 `CREATED`，same key/same hash replay，same key/different hash fail closed；
- timeout 保持 `UNKNOWN`，稳定键重放不重复 Provider；
- RLS、表 ACL、直接 UPDATE/DELETE、跨 Schema读取和事务回滚负例；
- Artifact 仅通过公开 Binding Query Port 组合，不导入 IntegrationGateway Repository；
- 确定性 DOCX/XLSX、Office 本地可打开性和临时输出清理；
- 真实 Ceph RGW/OpenBao、第三方 Renderer、公开 HTTP、生产、负载/HA、完整公式引擎、客户 pixel-perfect 版式与独立人工业务验收保持 `NOT RUN`。

## 4. 后续门禁

完成 CR-001–CR-005 后，必须重新运行 focused regression、完整 `pnpm clean && pnpm verify`、mutable tag→digest 对照、`git diff --check`，并复审 GitHub PR 的最新精确 head。只有复审无阻断发现且该精确 head 的 GitHub `verify` Check Run 为 `SUCCESS`，才允许合并和关闭 Issue #125。

## 5. 订正与本地复验结果

- CR-001：所有 Provider `SUCCEEDED` outcome 在落库前调用 `verifySucceeded`；返回 `false` 或抛错时 Attempt 进入 `FAILED`，Raw Receipt=0、成功 Outbox=0。
- CR-002：Local Provider 固定 attempt-derived output/receipt locator，校验 Profile media type、完整 ContentHash、Provider Receipt identity/time/payload hash，并重建 canonical Receipt bytes 做逐字节 readback 比较；替换 Receipt 直接负例返回 `INTEGRATION_RENDER_OUTPUT_MISMATCH`。
- CR-003：`Promise.race` 的 timeout handle 在 success/failure 分支清理；timeout 后迟到 Promise 仍由 rejection observer 消费。
- CR-004：脱敏 `ART023_REPRESENTATION_EVIDENCE` 已增加 authoritative `requestPayloadHash`。
- CR-005：首轮 GitHub `verify` run `33320335089` 在 lint 阶段以 41 个 unresolved-type unsafe-call 错误失败；根因是 persistence test project 缺失 IntegrationGateway reference，不是业务测试失败。增加 project reference 后，`pnpm clean && pnpm verify` 已从无 `dist`/`.tsbuildinfo` 状态完整通过；GitHub `verify` run `33320566486` 随后在 exact head `d3a1394663d3f953e4c686385b0ef9d8d280aefb` 上成功。
- focused Renderer：`1 file / 4 tests` 通过。
- 完整 `pnpm verify`：普通测试 `38 passed / 29 skipped` 个文件、`420 passed / 293 skipped` 个测试；Architecture、201/201 FULL Contract 与 200-operation compatibility baseline 通过；PostgreSQL 18.6/Flyway 11.20.3 为 `33 files / 308 tests`，空库 `V7001`、second no-op 和容器清理通过。
- 报告 Gate：`ZJU_ART023_REPORT=1 pnpm persistence:gate` 为 `33 files / 308 tests`，输出 exact Attempt/Request Hash/Binding/Representation 后完成 second no-op 与容器清理。
- mutable tag 对照：PostgreSQL `18.6` 与 Flyway `11.20.3` 的远端 manifest digest 分别匹配 Gate 固定的 `sha256:4ef4dbc9...c2280` 与 `sha256:01605f44...c1cbc3c1`。

最终 review `#5061241831` 已绑定 exact head `d3a1394663d3f953e4c686385b0ef9d8d280aefb` 并明确记录 PASS；验收 comment `#5469697944` 已写入 Issue #125 并读回。PR #135 以 merge commit `1ef1303be233901c73a0bcc8f97bce8edf7e93a7` 合入 `main`，Issue #125 为 `CLOSED / COMPLETED`，原本地/远端 feature branch 均已删除。本文件不复制完整 GitHub closeout 日志。
