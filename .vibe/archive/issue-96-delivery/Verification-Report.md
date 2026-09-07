> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/issue-96-delivery/Verification-Report.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/issue-96-delivery/Verification-Report.md).

# Issue #96 验证报告

日期：2026-08-29

状态：`DELIVERED / PR #114 MERGED / ISSUE #96 CLOSED / FEATURE BRANCH DELETED`

## 1. 交付范围

本次实现 WorkbookSpec application validation/canonicalization、分层 stable ref Human Edit、authoritative Object readback、不可变候选 Revision 创建和两个 exact Revision 间的确定性内部 Diff。复用 V4000-V4003、Object Storage Port、Content Object lifecycle、Revision DAG 和 Branch CAS；不新增 Migration，不扩展 201 项公开 Catalog。

## 2. 变更面

- 权威文档：HL-Spec、Artifact Module Spec、Artifact Module Test、WI-07 状态与本交付记录。
- 业务实现：`workbook-service.ts` 与 Artifact module exports/error codes。
- Unit/Hash/Diff：`workbook-service.test.ts`。
- 真实 PostgreSQL：`artifact-workbook.test.ts`。
- 合成可检查输出：`Manual-Workbook-Fixture.md`。

## 3. 自动验证结果

| Gate | 命令 / 输入 | 实际输出 | 结果 |
|---|---|---|---|
| Focused Unit/Hash/Diff | `pnpm exec vitest run modules/artifact/src/business/workbook-service.test.ts` | `1 file / 6 passed` | `PASS` |
| Format | `pnpm format:check` | All matched files use Prettier code style | `PASS` |
| Lint | `pnpm lint` | 0 errors | `PASS` |
| TypeScript | `pnpm typecheck` | `tsc -b --pretty false` exit 0 | `PASS` |
| 普通全量 Vitest | `pnpm test` | `31 passed / 23 skipped files; 386 passed / 268 skipped tests` | `PASS` |
| Architecture | `pnpm architecture` | `architecture_boundaries=PASS source_roots=10` | `PASS` |
| Contract/Catalog | `pnpm contracts:check` | public API 201；types 201 payloads/45 query results；Catalog/Registry 201 FULL | `PASS` |
| Compatibility | `pnpm contracts:check` | frozen v1.0 200 operations / 14 schemas / 200 envelopes；21 minor findings | `PASS` |
| PostgreSQL/Flyway | `pnpm persistence:gate` | PostgreSQL 18.6 / Flyway 11.20.3；27 files / 283 passed | `PASS` |
| Migration | 同上 | 空库应用 30 条现有 migration 至 V4003；无 WI-07 migration | `PASS` |
| Second migrate | 同上 | `Schema "public" is up to date. No migration necessary.` | `PASS` |
| Cleanup | 同上 | `postgres container removed` | `PASS` |
| Whitespace | `git diff --check` | 无输出 | `PASS` |

## 4. 关键语义证据

| 验收边界 | 实际证据 | 结果 |
|---|---|---|
| Stable ID / ordinal | Sheet/Column/Row/Cell 重复 ID、各父级重复 ordinal、Excel coordinate ID 直接负向 | `PASS` |
| Same-Sheet / type | unknown/cross-Sheet Column、Cell/Column valueType 不一致、错误 JSON value shape | `PASS` |
| Formula | `A1`、`Other!amount`、`[book]amount`、未知 Column、括号/引号不平衡拒绝；不执行计算 | `PASS` |
| Rules/extensions | required/range/pattern/unique/compare 闭合；malformed 拒绝；unknown required fail-closed；known required 与 unknown optional 可规范化 | `PASS` |
| Canonical/hash | 物理数组反转但 ordinal/内容不变时 bytes/hash 不变；Cell value 变化时 hash 改变 | `PASS` |
| Human scope | Human-only；exact hierarchical Sheet/Row/Cell allowed refs；unknown/duplicate/out-of-scope ref 拒绝；Column/metadata 改写拒绝 | `PASS` |
| Exact base | Artifact/Scope/hash/content type/FROZEN/schema/current Branch Head/ACTIVE disposition 校验；stale 拒绝无新 Revision | `PASS` |
| Authoritative bytes | Object readback bytes/metadata/hash 与 Revision/Manifest 三方核对；tamper 返回 `ARTIFACT_CONTENT_READBACK_MISMATCH` | `PASS` |
| Immutable creation | 合法 Cell Edit 创建 FROZEN Object 与 revision 2；唯一 Parent 为 base；base Snapshot 不变 | `PASS` |
| Replay/conflict | same command 返回同一结果且 Revision 数 2；same key/different payload 返回 `IDEMPOTENCY_PAYLOAD_CONFLICT` | `PASS` |
| Deterministic Diff | exact left/right refs；stable path；Added/Removed/Changed/Moved；两次 rebuild 深比较相等 | `PASS` |
| Public boundary | Catalog 仍为 201 FULL；无 public Diff Result Operation/Event | `PASS` |

## 5. 代码审查结论

- 变更只覆盖 #96 的 WorkbookSpec 语义、测试与必需文档；不重复实现 #95 Structured Document，后续仅通过最新 `main` 基线继承其已交付能力。
- Human Edit 先完成可信 Context、exact base、authoritative bytes、候选 Schema/规则、allowed refs、Diff/no-op 校验，再创建 Content Object/Revision；顺序型 stale/out-of-scope 路径无新 Revision。
- Candidate Revision 不隐式移动 Branch Head，保持 WI-05 的“Revision 创建”和“Head CAS”分离；调用方显式使用现有 move command。
- known extension options 已贯穿 validation、canonicalization、Diff 与 Human Edit，避免二次规范化误拒绝已注册 required extension。
- 未修改 applied migration、frozen compatibility baseline 或生成文件；未新增公共 Operation。

审查结论：`PASS / DELIVERED`。

## 6. NOT RUN

- 独立 Human 手工复核 `Manual-Workbook-Fixture.md`；
- 真实客户 Workbook 与业务适用性；
- Excel 计算引擎、宏、外部链接、透视表、XLSX layout fidelity；
- Renderer、Quality/Approval/Release、Provider；
- 公开 HTTP E2E、跨模块业务 E2E、生产数据库/对象存储/OpenBao/Ceph RGW；

Git commit、push、PR exact-head CI、merge、Issue closure 和 branch cleanup 不属于上述本地自动 Gate；用户已于 2026-08-29 确认进入 Git 交付，其最终状态必须分别以 GitHub、`origin/main` ancestry 和 branch readback 为准。

上述项目不能由 local adapter、disposable PostgreSQL 或 green CI 推断为通过。

## 7. Git 交付读回

| 边界 | 精确读回 | 结果 |
|---|---|---|
| Feature implementation commit | `e98a428` | `DELIVERED` |
| Integrated PR head | `dbb61d16e807ce97eec8ce70cecf17ec060dac16` | `DELIVERED` |
| Exact-head CI | [GitHub Actions run 33241741909](https://github.com/qzhike/zhiju-business-core/actions/runs/33241741909) 的 `ci/verify` 成功；[验证评论](https://github.com/qzhike/zhiju-business-core/pull/114#issuecomment-5461160688) 已读回 | `PASS` |
| Pull Request | [PR #114](https://github.com/qzhike/zhiju-business-core/pull/114) 以 `--match-head-commit` 合并；merge commit `8df7fedf60030f1a74ad8ffa3c8db3614331b820` | `MERGED` |
| Default-branch ancestry | `dbb61d16e807ce97eec8ce70cecf17ec060dac16` 是 `origin/main@8df7fedf60030f1a74ad8ffa3c8db3614331b820` 的祖先 | `PASS` |
| Issue | [Issue #96](https://github.com/qzhike/zhiju-business-core/issues/96) 已读回为 `CLOSED / COMPLETED` | `CLOSED` |
| Feature branch | `galendai/im-04-wi-07-implement-workbookspec-human-edit-an` 的远端 ref 与本地 branch 均已删除；执行工作区已 detach 到合并后的 `origin/main` | `DELETED` |

本节只记录 Git 交付事实，不改变第 6 节的人工、外部、生产与跨模块 `NOT RUN` 边界。
