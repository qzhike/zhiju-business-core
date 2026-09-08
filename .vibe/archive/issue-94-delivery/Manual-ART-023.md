> Historical record. Related Issue: [94](https://github.com/qzhike/zhiju-business-core/issues/94). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# ART-023 Revision/Lineage/CAS 人工验收记录

日期：2026-08-29
状态：`CHECKLIST PREPARED / INDEPENDENT MANUAL ACCEPTANCE NOT RUN`
关联：Issue [#94](https://github.com/qzhike/zhiju-business-core/issues/94)

## 1. 验收边界

该记录是可供审核者执行的 synthetic technical fixture 检查表，不代表真实客户业务验收。审核应在 disposable PostgreSQL 或明确的测试环境中进行，不得使用生产数据库、真实客户文档或未授权 Provider。

本次实现不提供公开 HTTP 页面或公共 Branch 创建 Operation，因此手工步骤通过既有 Artifact/Branch Command 与精确 RevisionRef 观察结果。两个“分支候选”表示同一 Artifact 共同祖先上的两个并行候选 Revision；它们不通过 last-write-wins 自动覆盖 Head。

## 2. Fixture 约定

| 对象 | 约定 | 需要记录的实际值 |
|---|---|---|
| Artifact | Project-scoped synthetic Artifact，业务标识 `ART-023` | exact Artifact UUID、Project UUID |
| Branch | Artifact 默认 `main` Branch | Branch UUID、初始 `head_version=0` |
| REV-001 | FROZEN Manifest 创建的 Initial Revision | Revision UUID、Revision number、contentHash、Parent=`[]` |
| REV-002 | 以 REV-001 为唯一 Parent 的普通 Revision候选 A | Revision UUID、Revision number、contentHash、Parent |
| REV-003 | 以 REV-001 为唯一 Parent 的普通 Revision候选 B | Revision UUID、Revision number、contentHash、Parent |
| MERGE-REV | 以 REV-002/REV-003 为 Parent 的显式 Merge Revision | Revision UUID、Parent 顺序、merge conflict/resolution refs |

每个 RevisionRef 必须同时记录 object type、UUID、Scope 和 32-byte SHA-256 contentHash。不能用 `latest`、`current`、文件名或路径替代历史 RevisionRef。

## 3. 执行步骤

### 3.1 Initial 与分叉候选

1. 在同一 Project Scope 建立或读取 `ART-023` 与默认 Branch。
2. 生成并确认一个 `FROZEN` Canonical Content Object Manifest，执行 Initial Revision Command。
3. 记录 `REV-001` 的 exact RevisionRef、Hash、Manifest locator、SchemaRef、Provenance 和空 Parent 列表。
4. 从 REV-001 分别生成 REV-002、REV-003；两者应是同一 Artifact 的 ordinary Revision，各自恰有一个 Parent，且 contentHash 不同。
5. 读取三条 Snapshot，确认后续候选没有改变 REV-001 的 Hash、Parent、Provenance 或 Manifest identity。

### 3.2 Branch Head CAS

1. 为 REV-002 和 REV-003 准备两个不同的 `move_working_head` Command。
2. 两个 Command 都使用同一个 expected exact head（初始为空）和 Envelope `expectedAggregateVersion=0` 并发执行。
3. 记录结果：一个必须成功，另一个必须返回 `ARTIFACT_BRANCH_HEAD_CONFLICT`；失败候选和 `revision_conflict` 事实必须保留。
4. 重新读取 Branch，确认 Head version 为 `1`，并使用成功者的 Head 作为 expected head 将失败候选重试到 version `2`。
5. 检查 Branch Head Reference Edge：`owner_version_id` 应为 Branch UUID，而不是把数值 `head_version` 转换成 UUID；检查 Outbox 的 aggregate version 应为 `1` 和 `2`。

### 3.3 显式 Merge 与 Conflict Resolution

1. 用 REV-002 与 REV-003 作为至少两个 Parent 创建 Merge Revision。
2. 提交非空 conflict set、非空 resolution refs 和当前 trusted Human 的 `resolvedBy`。
3. 读取 Merge Snapshot/Conflict fact，确认 Parent 数量、顺序、冲突内容摘要、resolution refs 和 Human 归因均可追溯。
4. 重复执行以下负向步骤，并确认目标 Revision 不产生任何新行：
   - conflict set 非空但 resolution refs 为空；
   - 少于两个 Parent；
   - resolvedBy 不是 trusted Human；
   - Parent 跨 Artifact、Hash 错误、Scope 不一致或使用 `latest/current`。

### 3.4 历史 Query 与不可变性

1. 对 REV-001、REV-002、REV-003 和 Merge Revision 分别读取 Snapshot 与 Lineage。
2. 检查 Lineage nodes、edges、root refs、Parent Hash 和确定性 `lineageHash`；对 REV-002/REV-003 的 Diff Inputs 检查共同祖先为 REV-001。
3. 在 REV-001 上追加 Withdrawal，再追加 Invalidation；确认 Snapshot 的内容身份、Hash、Parent、Provenance、Canonical locator 未变化，只派生 disposition 变化。
4. 检查 Withdrawal 与 Invalidation Reference Edge 的路径分别为：

   ```text
   /governance/withdrawal/artifactRef
   /governance/invalidation/artifactRef
   ```

5. 使用 `artifact_app` 直接 UPDATE/DELETE Revision、Parent、Conflict、Withdrawal、Invalidation；预期均以 ACL `42501` 拒绝。
6. 使用仅含 Enterprise 的宽 Scope 读取 Project Artifact Lineage/Validation；预期拒绝，精确 Project Scope 才能成功。

## 4. 结果记录表

以下是审核者执行时应填写的表；当前仅记录自动 synthetic regression 的可复核形状，UUID 和实际时间需由独立人工执行时填写。

| 检查项 | 预期 | 自动回归形状 | 人工实际输出 | 结果 |
|---|---|---|---|---|
| REV-001 | revision number=1，Parent 数=0 | 已通过 | 待填写 | `NOT RUN` |
| REV-002/003 | 各自恰有一个 REV-001 Parent，Hash 不同 | 已通过 | 待填写 | `NOT RUN` |
| CAS race | 一成功一冲突；冲突事实保留 | `COMMITTED/REJECTED`，version `0→1→2` | 待填写 | `NOT RUN` |
| Merge | 至少两个 Parent，Conflict/Resolution/Human fact 可查询 | Merge fact=1，Parent=2 | 待填写 | `NOT RUN` |
| Lineage | root/edge/ancestor/hash 精确 | REV-001→REV-002/003→Merge 可回放 | 待填写 | `NOT RUN` |
| Governance | Withdrawal/Invalidation 不改写旧 Snapshot | disposition 追加派生，identity 保持 | 待填写 | `NOT RUN` |
| Immutable SQL | direct UPDATE/DELETE 被拒绝 | 全部 `42501` | 待填写 | `NOT RUN` |
| Cleanup | disposable DB/container 清理，无生产副作用 | Gate 已清理临时容器 | 待填写 | `NOT RUN` |

## 5. 人工验收边界

独立人工验收仍为 `NOT RUN`。以下证据不应在人工记录中被冒充为已完成：真实 Provider、生产 Object Storage、生产数据库、公开 HTTP、Browser、跨模块 E2E、Renderer、Quality/Approval/Release 以及真实客户业务意义上的 ART-023 验收。
