# Issue #128 代码审查记录

版本：v1.1

日期：2026-08-31

审查范围：IM-05 WI-08 合成 QMS/REL-801 退出证据所涉及的权威 Spec/Test 文档、QMS Gate fixture、ReleasePublication Handler persistence report、deterministic OOXML renderer report、既有 Representation/Binding 证据及本地验证结果。

审查结论：`PASS — COMPONENT / SYNTHETIC / DISPOSABLE POSTGRESQL TECHNICAL SCOPE / EXACT-HEAD CI PASS`；PR #139 已创建，Issue #128 尚待合并 closeout；统一跨模块业务 E2E、真实 Provider/生产和独立人工业务验收仍未执行。

## 1. 审查发现与处置

### 1.1 QMS origin failure 必须是实际业务事实

原测试 helper 只生成 `PASS` Gate，无法证明 Issue #128 要求的 `REV-002 FAIL → remediation → REV-003 PASS` 时间线。当前修复让 helper 接受显式 Gate outcome，并在 `FAIL` 时写入 `SYNTHETIC_REVISION_DEFECT` finding；主回放以 `FAIL` 创建 origin gate，再以不同 revision/hash 创建 remediated gate。报告模式输出两条 Gate result 的 exact Ref、hash 和 outcome。

### 1.2 报告必须从权威结果读取引用

ReleasePublication 的 `record_publication_failure` 命令返回的是更新后的 Release view，不保证顶层携带 `failureRef`。当前报告从 `handleGetPublicationAttempts` 的失败 Attempt Query view 读回 `failureRef`，并在缺失时使测试失败；没有通过 attempt number、caller hash 或 `latest/current` 推断事实。

### 1.3 报告输出不能扩大 Secret/PII 边界

三个报告模式都由 `ZJU_IM05_WI08_REPORT=1` 显式开启，直接写标准输出，仅包含合成 Ref、固定 hash、状态和计数；默认测试没有额外输出。Release 报告不打印 `providerResult`、数据库连接字符串或外部凭据，也没有把真实 Provider 验收写成 PASS。

## 2. 代码与文档范围

- QMS persistence test：显式 `FAIL/PASS` gate fixture、QMS report output。
- ReleasePublication persistence test：failure Ref Query readback、completion payload 命名、REL-801 report output。
- deterministic OOXML renderer test：DOCX/XLSX golden input/output hash、profile、bytes 和 checksum report output。
- HL-Spec、PostgreSQL logical model、verification baseline、Module-Spec-005/006、Module-Test-005/006：先于实现变化同步 WI-08 设计、测试用例和 `NOT RUN` 边界。
- `.vibe/codex-issue-128-delivery/`：Task Plan、Synthetic Exit Report 和本 Code Review。
- 没有新增公共 Contract、Schema、Migration、生产 Handler 或外部 Provider 适配器。

## 3. 直接验证

- `pnpm format:check`：`PASS`。
- `pnpm typecheck`：`PASS`。
- deterministic renderer focused：`1 file / 4 tests PASS`。
- `ZJU_IM05_WI08_REPORT=1 pnpm persistence:gate`：`34 files / 314 tests PASS`。
- PostgreSQL `18.6` (`server_version=180006`) 与 Flyway `11.20.3` 均使用 digest-pinned image；空库迁移通过，第二次迁移输出 `No migration necessary`，容器已清理。
- QMS report：原始 gate `FAIL`、修复后 gate `PASS`、独立 verification、双 approval、revocation/stale bundle 和历史 readback 均有直接输出。
- REL-801 report：3 Attempt、6 Observation、2 Formal Receipt、1 Failure、1 Recall、1 ImpactReview；Observation payload hash 逐条重算并与数据库 32-byte 值一致。
- `pnpm clean && pnpm verify`：`PASS`；普通 Vitest 为 `42 files passed / 30 skipped`、`432 passed / 299 skipped`，Architecture `source_roots=10`，Public API/Catalog `201` 且全部 `FULL`，compatibility baseline v1.0 为 `200` operations，Persistence Gate 为 `34 files / 314 tests`；空库迁移、二次 no-op、tag→digest 与容器清理均通过。
- PR #139 exact-head CI：实现 head `290d28758d04d6be225d8587e8314ed2f46830de` 的 GitHub Actions `verify` run `33355081899` 第二次执行 `PASS`；初次执行的单个非 WI-08 `TemplateBaseline` 并发 fixture 竞态经有界重跑通过，未改变 WI-08 代码和报告证据。

## 4. 风险与未覆盖范围

本次证据只证明组件级 Handler/Query Port、固定 synthetic fixture、disposable PostgreSQL 和既有 WI-05 Representation 依赖。以下仍为 `NOT RUN`：

- QMS → Artifact → IntegrationGateway → ReleasePublication 的统一跨模块业务 E2E。
- Ceph、OpenBao、Feishu、Email、第三方 renderer、真实 Provider callback、外部收件人和生产凭据。
- 生产数据库、公开 HTTP、部署后验证、负载/HA/备份/灾备。
- Workspace UI、Feishu 产品审批/消息流、CLI runtime、IM-09 integrated E2E。
- 独立人工对内容语义、Office fidelity、收件结果和客户适用性的验收。
- #22 actor provenance、#23 providerResult PII、#24 ordinary Feishu source provenance 的独立 Issue 交付。

Issue #120 不能因本 Issue 的合成技术证据自动关闭；父级仍需根据自身 Gate、依赖状态和人工/Provider 边界单独判断。

## 5. Git 交付边界

初始交付已执行限定路径 staging、`git diff --cached --check`、commit 和 non-force push：提交为 `290d28758d04d6be225d8587e8314ed2f46830de`，PR 为 [#139](https://github.com/qzhike/zhiju-business-core/pull/139)，其 exact-head CI 已通过。当前 follow-up 仅同步本记录和权威文档的 Git 状态；PR #139 合并、Issue #128 closeout、`origin/main` ancestry readback 和该命名交付分支清理仍需在最终精确 head 上完成，不修改或关闭父级 Issue #120。
