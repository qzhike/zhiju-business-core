# IM-05 WI-08 合成 QMS/REL-801 退出证据与父级复核报告

日期：2026-08-31

状态：`DELIVERED PR #139 / ISSUE #128 CLOSED / SYNTHETIC / TECHNICAL ONLY / LOCAL VERIFY PASS / EXACT-HEAD CI PASS`

Git 状态：最终审阅 head `306cdbc3b8c8201994a57097038c4c3f784b0412` 已 push 到 PR #139，并由 GitHub Actions `verify` run `33355948473` 通过；PR #139 以 merge commit `07fc6a083897c01924f842d12dffe06fd6068261` 合入 `main`，Issue #128 已关闭。本报告不关闭父级 Issue #120。

## 1. 目标、范围与结论

本报告把 Issue #128 要求的 IM-05 合成质量、渲染、表示绑定和发布回放组织成一个可复核入口，重点验证以下链路：

```text
REV-002 FAIL
  -> ReviewIssue
  -> Resolution Proposal
  -> self-verification rejection
  -> independent Human Verification
  -> REV-003 PASS / Readiness
  -> two Human approvals
  -> stale historical bundle after revocation
  -> deterministic DOCX/XLSX evidence
  -> frozen Package / Attempt / Receipt / Recall
```

当前技术结论为：

- QMS 组件、Renderer 组件、Representation/Binding 既有证据和 ReleasePublication 组件均有直接自动化证据。
- 合成 QMS 与 REL-801 的持久化回放通过版本锁定的 disposable PostgreSQL、Handler/Query Port、RLS/ACL、append-only、CAS 和历史读回验证。
- 本轮没有新增公共 Contract、Schema 或 Migration；继续使用 V5002–V5004、V4004、V6001–V6002 和 V7001。
- 真实 Provider、生产数据库、公开 HTTP、跨模块统一业务 E2E、外部收件人确认、独立客户/业务人工验收、#22/#23/#24 的独立运行时交付保持 `NOT RUN` 或独立边界。
- 父级 Issue #120 不应因本报告自动关闭；其余依赖和人工/Provider 边界仍需父级 Gate 单独判断。

## 2. 权威文档与交付基线

本轮先同步了以下权威文档，再修改测试报告通道：

- [`HL-Spec.md`](../high-level-docs/HL-Spec.md)
- [`07-postgresql-logical-model-v0.1.md`](../high-level-docs/07-postgresql-logical-model-v0.1.md)
- [`08-verification-baseline.md`](../high-level-docs/08-verification-baseline.md)
- [`Module-Spec-005-QualityGovernance.md`](../module-specs/Module-Spec-005-QualityGovernance.md)
- [`Module-Spec-006-ReleasePublication.md`](../module-specs/Module-Spec-006-ReleasePublication.md)
- [`Module-Test-005-QualityGovernance.md`](../module-tests/Module-Test-005-QualityGovernance.md)
- [`Module-Test-006-ReleasePublication.md`](../module-tests/Module-Test-006-ReleasePublication.md)
- [`Task-Plan.md`](./Task-Plan.md)

当前基线：

| 项目 | 精确值 |
|---|---|
| 工作分支 | `galendai/im-05-wi-08-deliver-synthetic-qms-rel-801-exit-e` |
| PR base / `origin/main` | `c69f446a610b4fff18850f0450a0b5f4e1fd3ccf` |
| 初始实现 delivery HEAD | `290d28758d04d6be225d8587e8314ed2f46830de` |
| 最终审阅 delivery HEAD | `306cdbc3b8c8201994a57097038c4c3f784b0412` |
| Merge commit | `07fc6a083897c01924f842d12dffe06fd6068261` |
| 远端 delivery branch | `galendai/im-05-wi-08-deliver-synthetic-qms-rel-801-exit-e` → 已在合并后清理 |
| Issue | [#128](https://github.com/qzhike/zhiju-business-core/issues/128)，`CLOSED / COMPLETED` |
| 父级 Issue | [#120](https://github.com/qzhike/zhiju-business-core/issues/120)，当前 OPEN |
| 前置 WI | #121–#127 已关闭；#22/#23/#24 仍为独立 OPEN 边界 |
| Migration 变化 | 本轮无新增 Migration；现有 V6002 继续作为 ReleasePublication 持久化入口 |

本轮代码变化是报告和回归测试所需的最小变化：

- `quality-governance-review-approval.test.ts` 允许测试 fixture 明确记录 `PASS` 或 `FAIL`，并将 origin revision 的 gate 记录为 `FAIL`，同时保留失败 finding。
- QMS、ReleasePublication 和 deterministic OOXML renderer 测试增加显式环境变量报告模式；默认测试不输出报告，也不创建报告文件。
- ReleasePublication 报告从 Attempt Query Port 读回持久化的 `failureRef`，避免使用不含该字段的命令返回载荷进行推断。

## 3. 可重复执行方式

以下命令不需要真实 Provider 或外部凭据：

```bash
pnpm clean && pnpm verify
ZJU_IM05_WI08_REPORT=1 pnpm persistence:gate
ZJU_IM05_WI08_REPORT=1 pnpm exec vitest run \
  modules/integration-gateway/src/renderer/deterministic-ooxml-renderer.test.ts \
  --reporter verbose
```

`ZJU_IM05_WI08_REPORT=1` 只通过标准输出打印合成 UUID、Content-Addressed Ref、Snapshot Ref、SHA-256、状态和事实计数；不打印 PostgreSQL 凭据、外部 Secret、PII 或 `providerResult`。报告中的 QMS/REL-801 动态对象 ID 属于该次 disposable database 运行，不能当作跨运行稳定 ID；固定 Scope、Revision 输入、Golden Content hash、profile 和结果约束才是可重复部分。

## 4. 执行环境与门禁结果

### 4.1 环境

| 项目 | 实际值 |
|---|---|
| PostgreSQL | `18.6` / `server_version=180006` |
| PostgreSQL image | `docker.io/library/postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280` |
| Flyway | `11.20.3` |
| Flyway image | `docker.io/flyway/flyway:11.20.3@sha256:01605f443e1a891b3762f66e66d92403c33b6e0c29099ad550af94b6c1cbc3c1` |
| 测试数据库 | 每次使用 disposable container，Gate 结束后删除 |

### 4.2 已执行结果

| 命令/范围 | 结果 | 直接证据 |
|---|---|---|
| `pnpm format:check` | `PASS` | All matched files use Prettier code style |
| `pnpm typecheck` | `PASS` | `tsc -b --pretty false` exit 0 |
| deterministic renderer focused | `PASS` | 1 file / 4 tests；DOCX 与 XLSX 报告输出见第 6 节 |
| `ZJU_IM05_WI08_REPORT=1 pnpm persistence:gate` | `PASS` | 34 files / 314 tests；报告输出见第 5、7 节 |
| 空库 Flyway migrate | `PASS` | 已应用所有当前 versioned migrations |
| 第二次 Flyway migrate | `PASS` | `Schema "public" is up to date. No migration necessary.` |
| Gate cleanup | `PASS` | PostgreSQL container removed |
| `pnpm clean && pnpm verify` | `PASS` | Format、Lint、Typecheck、普通 Vitest、Architecture、Contracts、Persistence Gate 全部通过 |

## 5. 合成 QMS 回放证据

本次 QMS 报告输出时间为 `2026-08-31 11:13:31 +08:00` 附近，数据库 Scope 为：

| Scope 字段 | 精确值 |
|---|---|
| Enterprise | `0190a1b2-c3d4-7e81-8f90-123456789001` |
| Project | `0190a1b2-c3d4-7e81-8f90-123456789002` |

### 5.1 Revision 与 Gate

| 对象 | Ref / ID | Content hash / outcome |
|---|---|---|
| Origin revision `REV-002` | `artifact.artifact_revision/0190a1b2-c3d4-7e81-8f90-123456789016` | SHA-256 `4141414141414141414141414141414141414141414141414141414141414141` |
| Remediated revision `REV-003` | `artifact.artifact_revision/0190a1b2-c3d4-7e81-8f90-123456789017` | SHA-256 `4242424242424242424242424242424242424242424242424242424242424242` |
| Origin gate result | `quality.gate_result/01a055ce-cf5f-73e9-bc14-c0b04d0bfd2c` | SHA-256 `743f35b08c39a87af6386fab31964a7e6513a90b24137352919a109e5aa42ebc`; `FAIL` |
| Remediated gate result | `quality.gate_result/01a055ce-cf6b-728c-968a-b7a81632a3f8` | SHA-256 `c3b9e52f9e2c892f6216ceca23aa0f798e5bc876fe092bbb401ac5c0ad7b96ae`; `PASS` |
| Remediated readiness | `quality.revision_acceptance_snapshot/01a055ce-cf73-70ba-a130-8340f0c3ce80` | SHA-256 `d97cd6b60b2da7ae4dec75404f2007a5a2d1168e06567d91225b97454f2abaa3`; `READY` |

Origin gate 使用 finding code `SYNTHETIC_REVISION_DEFECT`，因此 `FAIL` 不是报告层面的标签替换，而是通过 QMS Gate Handler 持久化的业务事实。Remediated revision 以不同 Content hash 和不同 Gate result 进入后续 readiness。

### 5.2 ReviewIssue、独立复核与 Approval Bundle

| 对象 | 精确 Ref / 状态 |
|---|---|
| ReviewIssue | `quality.review_issue/01a055ce-cf7e-74b7-90d5-d21093a4fd2d`，`CLOSED` |
| Resolution | `quality.issue_resolution/01a055ce-cf93-766e-851f-19e12c8ff17b`，SHA-256 `b0d6d8b3843c7c114d8c086d930c8053f8e5ca1f92859be1934a8f4fc458d90c` |
| Independent verification | `quality.issue_verification/01a055ce-cfac-7636-9cf4-b550e0dd425d`，SHA-256 `c19f0dbf63369cc98a31d255df200e9655378d1436eee788c2ca6eb48f13c6eb` |
| Approval request | `quality.approval_request/01a055ce-cfc8-721f-ab6d-e64dfde07079` |
| First approval | `quality.approval/01a055ce-cfdf-744f-a08d-200fd6893433`，SHA-256 `8744bcd389dce2b81abdaaf736b200ebacd91abf4f0e52967229539a18026b5f` |
| Second approval | `quality.approval/01a055ce-d1ce-707f-aee6-c6f8656cdd34`，SHA-256 `9a67ba27330ed2add5c1e30597b96430dfa6795bf0659689a6bf45d98047ad63` |
| Partial bundle | `quality.approval_bundle_snapshot/01a055ce-cfe2-73dd-ae5a-f47360e3ef1a`，SHA-256 `2b3c5a3f610ae9c3381a0d920d329df447cdee490f4317b5c1a3441875b9f9c6` |
| Full bundle | `quality.approval_bundle_snapshot/01a055ce-d1d1-714d-afe9-14503e4e23e8`，SHA-256 `e2ae4f95cadbf475b9086bd44eeee27526a445a4fd16ddf962cdc8925c42727f` |
| Revocation stale bundle | `quality.approval_bundle_snapshot/01a055ce-d3af-732d-8335-07bea0b60d08`，SHA-256 `f31451f1c7580f831c0173421bf245c0f4909b6e2f9d99905f56f7808c5645cd`，`STALE` |

本次 fixture 的角色引用是固定测试上下文，不使用调用方声明覆盖权威来源：raiser principal/actor/decision 使用 `0190a1b2-c3d4-7e81-8f90-123456789004` / `0190a1b2-c3d4-7e81-8f90-123456789005` / `0190a1b2-c3d4-7e81-8f90-123456789006`，verifier 使用 `0190a1b2-c3d4-7e81-8f90-123456789009` / `0190a1b2-c3d4-7e81-8f90-12345678900a` / `0190a1b2-c3d4-7e81-8f90-12345678900b`，第一位 approver 使用 `0190a1b2-c3d4-7e81-8f90-12345678900d` / `0190a1b2-c3d4-7e81-8f90-12345678900e` / `0190a1b2-c3d4-7e81-8f90-12345678900f`，第二位 approver 使用 `0190a1b2-c3d4-7e81-8f90-123456789011` / `0190a1b2-c3d4-7e81-8f90-123456789012` / `0190a1b2-c3d4-7e81-8f90-123456789013`；每条命令仍绑定独立 correlation/policy 和 exact Scope。

### 5.3 QMS 用例输入、预期与实际输出

| 用例 | 输入/动作 | 预期 | 实际输出 |
|---|---|---|---|
| Origin gate | `REV-002`、`SYNTHETIC_REVISION_DEFECT` | 记录 `FAIL`，不得伪装成可发布 | Gate result 持久化为 `FAIL`，原始 Ref/hash 保留 |
| Concurrent resolution | 同一个 Issue 的两个 resolution proposal、expected version `1` | 一个提交、一个拒绝，拒绝为 `CONCURRENCY_CONFLICT` | `1 COMMITTED + 1 REJECTED`；winner version `2` |
| Self verification | raiser 作为 verifier 验证自己的 remediation | `QUALITY_SEPARATION_OF_DUTIES_VIOLATION` | 精确拒绝，未推进 Issue |
| Independent verification | verifier 使用 `REV-003` 与 PASS Gate | 产生 `VERIFIED` 并允许关闭 Issue | Verification 已持久化，Issue 状态变为 `CLOSED` |
| Non-Human impersonation | Agent、Service、Runtime context 携带 Human payload | `QUALITY_APPROVAL_AGENT_FORBIDDEN` | 三种 context 均 fail-closed |
| Approval progression | 第一位 Human，再第二位不同 Human | `PARTIALLY_APPROVED` → `FULLY_APPROVED` | 两个 distinct approval Ref；partial/full bundle 均可 Query |
| Duplicate identity | 第一位 Human 重复提交冲突身份 | `QUALITY_APPROVAL_IDENTITY_CONFLICT` | 精确拒绝，未产生第三个有效 Approval |
| Revocation | 撤销第二个 approval 并创建影响评估 | 新 bundle 为 `STALE`，历史 full bundle 不被改写 | `targetApprovalCount=2`、`targetBundleCount=3`；历史 full bundle 仍 `FULLY_APPROVED` |
| Persistence negatives | app direct insert、owner update/delete、跨边界读 | RLS/ACL/immutable guard 拒绝 | direct insert `42501`；owner mutable write `55000`；跨 Scope 无可见行 |

结论：QMS 组件级链路证明了失败事实、补救事实、独立复核、Approval 逐步完整、撤销后历史可重放和权限边界；它没有证明跨模块统一事务或真实业务人员验收。

## 6. Deterministic Renderer 与 Representation 证据

### 6.1 当前 renderer golden fixture 输出

以下输出来自 `deterministic-ooxml-renderer.test.ts` 的同一渲染实现和固定 golden payload：

| Fixture | 输入 SHA-256 | Profile | 输出 bytes | 输出 checksum |
|---|---|---|---:|---|
| `canonical-content/document-golden` | `902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` | `document.docx` / `zhiju.renderer.docx.minimal@1.0.0` | `3939` | `9da593bff44cc62d4e1b693af7dec80aabb884a3eaa58dd3e94854bff8a894ef` |
| `canonical-content/workbook-golden` | `e3e0f7357a3fcd6c18063081128913b0cd8983e75d6455d4aa6664284f30a818` | `workbook.xlsx` / `zhiju.renderer.xlsx.minimal@1.0.0` | `3495` | `81d7aac6eb8a9cfc55046758705587466e4e8fa1a5010347fda46c4f4ae94e86` |

两个 profile 的 media type 分别为：

- DOCX：`application/vnd.openxmlformats-officedocument.wordprocessingml.document`
- XLSX：`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

同一输入连续渲染的 bytes/checksum 深比较相等；错误 content/profile、声明 hash 替换和 credential-like locator 均有负例。当前测试只在内存中生成 bytes，不向工作树留下 Office 文件。

### 6.2 既有 Representation/Binding 证据

以下为已合入 WI-05 的 ART-023 synthetic evidence，作为本轮对 Representation/Binding 的依赖性复核，不把它误报为本次 QMS/REL-801 的同一数据库对象：

| 对象/字段 | 精确值 |
|---|---|
| Artifact | `01a04dc2-d7b1-70cf-a494-8a1aebb6a47f` |
| Revision | `01a04dc2-d7cc-738d-a40c-e200784403f3@902a88d2b1ebfd0614454d0bd6a9e6f4124adba2d94bb7b94189787484a985b7` |
| RenderAttempt | `01a04dc2-d8be-70ca-9d1d-11f6361bf253` |
| Raw receipt | `01a04dc2-d8be-70ca-9d1d-18889fdd7a0e@5555...5555` |
| Representation | `01a04dc2-d8be-70ca-9d1d-14137fc45042` |
| Canonical locator | `staging/canonical/01a04dc2-d7cc-738d-a40c-e6733606b182` |
| Output locator | `artifact/rendered/art-025.pdf` |
| Renderer | `renderer.pdf@1.0.0` |
| Output checksum | `4444444444444444444444444444444444444444444444444444444444444444` |
| Registration hash | `edbb2311022877692468edbc45842158a2303dcb712394719caa604c0a0c58ef` |

Binding 的 exact Revision、Scope、input/output、format、renderer 和 Receipt 一致性已有 Persistence/Query 证据；`[PR #135](https://github.com/qzhike/zhiju-business-core/pull/135)` 的交付记录还包含 Microsoft Word DOCX 和 Excel XLSX openability PASS。这个 WI-08 工作树没有再次启动 GUI/Office 应用，独立人工版式/业务验收仍为 `NOT RUN`。

## 7. 合成 REL-801 发布回放证据

本次 ReleasePublication 报告输出时间为 `2026-08-31 11:13:31 +08:00` 附近，Scope 为：

| Scope 字段 | 精确值 |
|---|---|
| Enterprise | `0190a1b2-c3d4-7e81-8f90-123456789101` |
| Project | `0190a1b2-c3d4-7e81-8f90-123456789102` |

### 7.1 Release、Package、Readiness 与 Authorization

| 对象 | 精确 Ref / hash |
|---|---|
| Release | `release.release/01a055cf-0a43-71af-aeb6-30957e7bc845` |
| Frozen Package snapshot | `release.release_package/01a055cf-0a89-7397-9922-b364b7b24df9`；Package SHA-256 `66320e12f3a6375ec23f9ea43f430c0bf1a1051f250c00292bf4802cd283a567` |
| Package payload hash | SHA-256 `432672a02e5c4d912cffbb4412374fbb7862136d118c602e48cacfb2669a43ec` |
| Readiness snapshot | `quality.release_readiness_snapshot/01a055cf-0acc-7457-a11e-63802f1642b7`；SHA-256 `7171717171717171717171717171717171717171717171717171717171717171` |
| Actor snapshot | `identity.actor_snapshot/0190a1b2-c3d4-7e81-8f90-123456789105`；SHA-256 `7272727272727272727272727272727272727272727272727272727272727272` |
| Authorization decision | `identity.authorization_decision/0190a1b2-c3d4-7e81-8f90-123456789106`；SHA-256 `5151515151515151515151515151515151515151515151515151515151515151` |
| Release authorization | `release.release_authorization/01a055cf-0ad9-7585-ad20-dd4ead8de16e`；SHA-256 `fc43f7d817d8ee4e2931eede7feaa8cc394402f54e5bc1bd837a392d81081720` |

### 7.2 Attempt、Receipt、Failure 与 Recall

| 类别 | 精确 Ref |
|---|---|
| Attempt A | `release.publication_attempt/01a055cf-0ae6-747f-ba86-31f8b217b1c8` |
| Attempt B initial | `release.publication_attempt/01a055cf-0af4-730d-8e26-a3f540a8af2d` |
| Attempt B retry | `release.publication_attempt/01a055cf-0b0b-7728-996c-f752fff2f358` |
| Raw receipt A | `integration.raw_external_receipt/01a055cf-0b15-7529-837d-988478229fc2`；SHA-256 `8282828282828282828282828282828282828282828282828282828282828282` |
| Raw receipt B | `integration.raw_external_receipt/01a055cf-0b22-7469-b08e-44efaf94d83a`；SHA-256 `8484848484848484848484848484848484848484848484848484848484848484` |
| Formal receipt A | `release.publication_receipt/01a055cf-0b15-7529-837d-a785c8d0da7f`；SHA-256 `17187ef5e1676c740d137c38f7333dafa215c60fe763b3fd19372a288bd97993` |
| Formal receipt B | `release.publication_receipt/01a055cf-0b22-7469-b08e-52f4f550e479`；SHA-256 `2e74cc17b0ac67d63e3a92a7ae8f3247b731fa1a22ad4ce1202a3954065f0d65` |
| Publication failure | `release.publication_failure/01a055cf-0aff-73c0-aa69-22e400cf2a42`；SHA-256 `0bac58fe7de84b3e4830692d7b07ef9f4cd69d5402780a1f3155aee0d34b6c05` |
| Recall | `release.recall/01a055cf-0b39-705f-bfd6-788bccf8faea`；SHA-256 `5dfeb529d30a31004a26fe7debf73e77f3ab6475dc223c1109ceb223a1451f6c` |

事实 readback：`3 Attempt / 6 Observation / 2 Formal Receipt / 1 Failure / 1 Recall / 1 ImpactReview`。每条 Observation 的 JSON payload 都由应用层 canonicalization 重新计算 SHA-256，并与 PostgreSQL 中的 32-byte `observation_payload_hash` 相等。

### 7.3 REL-801 状态回放

| 顺序 | 输入/动作 | 预期 | 实际 |
|---:|---|---|---|
| 1 | 冻结 Package、RRS、ActorSnapshot、AuthorizationDecision | 仅 exact Release/Package/Scope/authorization 可开始 Attempt | Authorization 与三条 Attempt 均绑定 exact Ref/Scope |
| 2 | Destination A receipt | A 成功，另一目标不能被覆盖 | `PARTIALLY_RELEASED` |
| 3 | Destination B failure | Failure 追加 Observation，不删除 A 的成功历史 | `FAILED`，生成 Publication Failure |
| 4 | Destination B retry | 使用稳定幂等键、attempt number `2` | 新 Attempt 成功，历史 failure 保留 |
| 5 | B Raw → Formal receipt | 只有 exact Attempt/Package/Destination/payload/time 可晋升 | 两条 Formal Receipt |
| 6 | Completion | 两个目标成功后进入终态 | `RELEASED`，aggregate version `13` |
| 7 | Recall | 不删除发布/receipt/failure 历史，追加 Recall/ImpactReview | `RECALLED`，Recall Ref 已读回 |

### 7.4 Release 负例与权限边界

- 使用 `OTHER_PROJECT` 查询 exact Release 被 `ReleasePublicationBusinessError` 拒绝。
- application runtime role 直接更新 `publication_attempt` 被 PostgreSQL `42501` 拒绝。
- owner 角色对 append-only Attempt 执行 update 被 immutable guard `55000` 拒绝。
- provider result 不进入本报告输出；现有 WI-07 sanitization 回归保留敏感字段最小化边界。
- 本次报告只使用 Handler、Query Port 和持久化测试 fixture；没有用跨模块 Repository、直接 SQL 修改业务 fixture、`latest/current` fallback 或 caller-supplied hash 替代 authority ref。

## 8. Acceptance 映射与父级建议

| Issue #128 acceptance | 当前结论 | 边界 |
|---|---|---|
| Exact public application/query ports | `PASS`（组件级） | QMS/Release 各自回放；统一跨模块编排未运行 |
| Historical facts replayable | `PASS`（组件级） | QMS Issue/Approval stale history 与 REL Attempt/Receipt/Failure/Recall 已读回 |
| Human separation-of-duties and stale/wrong-scope negatives | `PASS`（组件级） | Agent/Service/Runtime、self-check、duplicate、RLS/ACL/CAS 已覆盖 |
| DOCX/XLSX deterministic bytes/checksums | `PASS` | 当前 golden fixture bytes/checksum 已直接输出 |
| Word/Excel openability | `PASS`（既有 WI-05 证据） | 本轮未重新启动 GUI；独立人工版式/业务验收 `NOT RUN` |
| Clean/no-op migration and persistence gate | `PASS` | 34 files / 314 tests；second migrate no-op；容器清理 |
| `pnpm clean && pnpm verify` | `PASS` | 当前工作树最终运行：42 files passed / 30 skipped；432 passed / 299 skipped；Persistence 34 files / 314 tests |
| Exact-head CI and GitHub readback | `PASS` | 最终 head `306cdbc3`；GitHub Actions `verify` run `33355948473` 通过；PR #139 与 Issue #128 已完成 closeout |
| Parent #120 closeout | `NOT RECOMMENDED` | #22/#23/#24、Provider/production/manual/unified E2E 边界仍未满足 |

建议：本轮 PR #139、Issue #128 和精确 head closeout 已完成；父级 #120 不因本报告自动关闭，#22/#23/#24 和真实 Provider/生产/人工边界继续独立维护。

## 9. 未运行边界与清理

以下边界保持 `NOT RUN`，不因合成测试通过而升级：

- 真实 Ceph、OpenBao、Feishu、Email、第三方 Renderer、Provider callback、外部收件人收件确认。
- 生产 PostgreSQL、生产凭据、公开 HTTP、部署后验证、负载/HA/备份/灾备。
- QMS → Artifact → IntegrationGateway → ReleasePublication 的统一跨模块业务 E2E。
- Workspace UI、Feishu 产品审批/消息流、CLI runtime、IM-09 integrated E2E。
- 独立业务人员/客户对内容语义、版式 fidelity、收件结果和真实适用性的人工验收。
- Issue #22 actor provenance、#23 providerResult PII、#24 ordinary Feishu source provenance 的独立 Issue 交付。

本次 Gate 已删除 PostgreSQL 容器；报告模式没有写入临时脚本、Office 文件或外部对象。TypeScript 构建产生的 ignored `dist` 在最终 `pnpm clean` 后应清理。

## 10. Git 交付状态

用户已回复“确认提交”，最终交付状态如下：

1. 已按限定路径完成 staging、`git diff --cached --check`、commit、non-force push，并创建 PR #139。
2. `pnpm clean && pnpm verify` 本地 PASS；GitHub Actions exact-head `verify` 在重跑后 PASS；技术证据仍保持真实 `NOT RUN` 边界。
3. 已在最终精确 head 上完成 PR merge、Issue #128 closeout、远端 readback、`origin/main` ancestry 验证以及命名交付分支的本地/远端删除读回；本报告的 authority docs 状态同步随后的无 Issue closeout PR 完成。
