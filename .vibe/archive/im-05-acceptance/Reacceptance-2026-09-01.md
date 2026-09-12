# IM-05 重新验收记录（2026-09-01）

## 结论

`NOT APPROVED / PARENT EXIT GATE BLOCKED`

Issue #22、#23、#24 的独立修复已经关闭、合入当前 `origin/main`，对应聚焦回归和全仓门禁均通过；但 IM-05 父级要求的“ReleasePublication 在发布副作用前重新验证最新 Release Readiness”仍未实现。当前实现可以接受一张已被后续失效事实取代、但历史内容仍为 `READY_FOR_AUTHORIZATION` 的旧 RRS，因此不能关闭 Issue #120。

## 验收基线

- 仓库：`qzhike/zhiju-business-core`
- 审核基线：`origin/main@5da4a84a42020c048b7ec7e31c5ac1f24a2d38f2`
- 审核工作树：detached exact head，开始和结束时无业务代码改动
- 父级 Issue：#120，当前 `OPEN`
- 子项：#121–#128 均为 `CLOSED`
- 携带修复：#22、#23、#24 均为 `CLOSED`
- 修复 Head 祖先检查：
  - #22 `87704a35838f2db529cc2b992eb3f5e33675fe05`：是 `origin/main` 祖先
  - #23 `2a066c493458778df2ba883e433d482e41dd02be`：是 `origin/main` 祖先
  - #24 `9c9a4fc74c291d92e144d5dcb2e7c10609c9e928`：是 `origin/main` 祖先

## 已通过证据

| ID | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| IM05-REACC-GH-001 | 查询 #121–#128、#22–#24 当前状态并检查三个修复 Head 的 ancestry | 所有携带项关闭，修复进入当前主分支 | #121–#128、#22–#24 均关闭；三个修复 Head 均为 `origin/main` 祖先 | `PASS` |
| IM05-REACC-FOCUSED-001 | 运行 Release Authorization、Provider Result、Formal Receipt、Release Runtime 和 Integration formal Adapter Attempt 聚焦测试 | #22/#23/#24 回归全部通过 | `5 files passed / 59 tests passed` | `PASS` |
| IM05-REACC-VERIFY-001 | 在 exact head 执行 `pnpm clean && pnpm verify` | 无构建缓存掩盖；所有静态、普通测试、架构、Contract 与持久化门禁通过 | Format、Lint、Typecheck 通过；Vitest `42 passed / 30 skipped files`、`450 passed / 300 skipped tests`；Architecture 通过；Catalog/Registry `201/201 FULL`；compatibility baseline 200 operations；PostgreSQL/Flyway `34 files / 315 tests`；第二次迁移 `No migration necessary`；容器已清理 | `PASS` |
| IM05-REACC-RENDER-001 | 读取 Renderer 手工打开记录 | DOCX/XLSX 可独立打开、checksum 可复核且临时文件清理 | Module-Test-007 记录 Word/Excel 本地打开、checksum、大小、显示内容和清理；完整公式计算、真实客户验收仍有明确边界 | `PASS (LOCAL MANUAL OPENABILITY)` |

## 阻断发现

### P0：旧 READY RRS 在上游失效后仍可被 Release 授权路径接受

父级 #120 和 Module-Spec-006 要求 `validate_release_readiness`、`authorize_release` 在事务内检查最新 RRS 及上游有效性，任何 stale、withdrawn、revoked 或 upstream impact 不一致都必须在 Publisher/Attempt 副作用前失败关闭。

当前事实链如下：

1. QualityGovernance 的 readiness snapshot 是不可变历史事实；失效后会追加新的 `STALE`/`NOT_READY` snapshot，不改写旧 READY snapshot。
2. Quality 的 exact snapshot Query 只按调用方给出的 `snapshotId`、Scope 和 payload hash 返回历史 snapshot；它不返回“这是否仍是当前有效 RRS”。
3. ReleasePublication 也只调用 `getReleaseReadinessSnapshot({ snapshotRef: input.releaseReadinessSnapshotRef })`，随后比较旧 snapshot 自身的 Release、Package、purpose、recipient/destination 和内部 `readiness.status`。
4. 因此，当 `RRS-A` 曾经是 READY、上游 Gate/ABS/Representation/Recipient/Destination 后续失效并形成 `RRS-B=STALE/NOT_READY` 时，调用方仍可提交 `RRS-A`；Quality exact Query 仍返回历史 `RRS-A=READY_FOR_AUTHORIZATION`，Release 端没有当前性/失效事实可比较。
5. 这违反“latest readiness revalidation”退出条件。全量门禁为绿色，是因为该跨模块反例没有被测试覆盖；Module-Test-006 也准确将 stale/withdrawn RRS 负例标为 `NOT RUN`。

定位证据：

- `modules/release-publication/src/release-publication-authorization.ts:119`：只检查已返回 snapshot 的内部字段与 READY 状态。
- `modules/release-publication/src/release-publication-authorization.ts:211`：Authority Port 只接受 exact `snapshotRef`，没有 current/latest validity 输入或结果。
- `modules/quality-governance/src/business/quality-gate-handlers.ts:2072`：RRS Query 按历史 `snapshotId` 读取并原样返回。
- `tests/persistence/quality-governance-gate-results.test.ts:701`：现有持久化语义证明失效后新增 STALE snapshot，而旧 READY snapshot 仍可按原 ref 读取为 READY（当前直接断言覆盖 RAS；RRS 使用相同不可变 snapshot/read-by-id 模型）。
- `.vibe/module-tests/Module-Test-006-ReleasePublication.md:36`：`RRS stale/withdrawn negative NOT RUN`。
- `.vibe/module-tests/Module-Test-005-QualityGovernance.md:134`：旧 RAS/RRS 保留并追加新的 STALE/NOT_READY snapshot。

### P2：父级状态与权威文档尚未对齐当前交付状态

- Issue #120 的 Work items 仍只勾选 #121；#122–#128、#22–#24 和全部 Exit acceptance 均未勾选，最后更新时间仍是 2026-08-31，且没有基于当前 `origin/main` 的重新验收结论。
- `Module-Spec-006-ReleasePublication.md` §12.4 标题仍写 `ISSUE #24 OPEN`，正文却写 #24 已关闭。
- 同一章节仍写 #23 “等待用户检查、提交后的 exact-head CI 与 GitHub readback”，与 PR #144 已交付、Issue #23 已关闭的当前事实不一致。

该文档问题本身可以窄化修复，但在 P0 业务阻断消除前，不能只同步复选框并关闭父级。

## 完成 IM-05 还需要的工作

1. 在 QualityGovernance 的公开 Authority Query 边界提供可验证的“当前有效 RRS”语义。可以新增按 Release + frozen Package identity 查询当前有效 readiness 的窄化 Query，或新增对指定 RRS 进行 current-validity 校验的 Query；结果必须能识别后续 invalidation、replacement、withdrawal/revocation 和 upstream impact，而不是仅回放历史 snapshot。
2. 在 `validate_release_readiness` 和 `authorize_release` 的事务内、任何 Authorization/Attempt/Publisher 副作用前调用该权威边界，并比较 exact Release、Package hash、Revision、Representation、ABS、recipient scope、destinations、purpose、version/hash 和当前有效性。
3. 增加直接回归：
   - 先生成 `RRS-A=READY_FOR_AUTHORIZATION`；
   - 再失效其 Gate/ABS/Representation/Recipient/Destination 中至少一项并生成/观察 `RRS-B=STALE/NOT_READY`；
   - 使用旧 `RRS-A` 调用 validate 和 authorize；
   - 断言稳定拒绝，Release 状态/aggregate version、Authorization、Attempt、Receipt、Event、Outbox 和外部 Adapter 调用均无新增；
   - 保留正向 current RRS、错误 Scope/hash、Authority unavailable/exception 和并发失效场景。
4. 按变更同步 HL-Spec、Module-Spec-005/006、Module-Test-005/006；修正 #23/#24 的过期交付状态，不得把真实 Provider、公开 HTTP、生产、统一跨模块业务 E2E 或独立业务验收误标为 PASS。
5. 在修复 exact head 重新执行聚焦测试、`pnpm clean && pnpm verify`、PostgreSQL 第二次 no-op 与清理，提交 PR 并等待 exact-head CI；确认实现 Head 是 `main` 祖先后，再更新 Issue #120 checklist 和验收 comment，最后关闭 #120。

## 验收边界

本轮没有修改业务代码、没有向 GitHub 写 comment、没有关闭 Issue #120、没有创建提交或推送。真实 Provider/Feishu、公开 HTTP、生产、统一跨模块业务 E2E、外部收件人确认和独立业务验收仍为 `NOT RUN`；这些非目标不覆盖本次 P0 当前性缺陷，也不被本地技术门禁升级为 PASS。
