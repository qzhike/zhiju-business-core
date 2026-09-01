# IM-05 RRS 当前有效性修复验证记录

## 验证基线

- 基线：`origin/main@5da4a84a42020c048b7ec7e31c5ac1f24a2d38f2`
- 本地分支：`galendai/im-05-rrs-current-validity`
- 验证日期：2026-09-01
- 数据：`SYNTHETIC / TECHNICAL ONLY`

## 变更结果

1. `quality.get_release_readiness_snapshot@1.0` 新增可选 `requireCurrentForAuthorization`；省略时继续读取不可变历史，`true` 时执行授权用途当前性校验。
2. QualityGovernance 在一个只读事务内验证：指定 RRS 是同 Release 的最新 snapshot、状态 READY、所有 Release GateResult 未失效、ABS 是同 Revision/Profile 最新 FULLY_APPROVED snapshot、ABS 内 Approval 仍 EFFECTIVE、RAS 是同 Revision/Profile 最新 READY snapshot。
3. ReleasePublication 的 readiness validation 与 Human authorization 共同经过 `revalidateReleaseForAuthorization`，并强制发送 `requireCurrentForAuthorization=true`；Query 缺失、异常、非对象结果或 stale 结果统一 fail-closed。
4. 历史 RRS 保持可审计；当前授权判断不会改写旧 snapshot。

## 输入、预期与实际输出

| ID | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| IM05-RRS-C-001 | `quality.get_release_readiness_snapshot` Payload 增加可选 boolean | Schema 接受旧 Payload 和带 `true` 的新 Payload；Catalog 数量不变 | Schema focused 通过；Catalog/Registry 保持 `201/201 FULL`；compatibility 记录 additive minor | `PASS` |
| IM05-RRS-PG-001 | 两个 Release 的 READY RRS、有效 Gate/RAS/ABS/Approval | `requireCurrentForAuthorization=true` 返回 READY snapshot | 两条 current Query 均返回 `READY_FOR_AUTHORIZATION` | `PASS` |
| IM05-RRS-PG-002 | 旧 READY RRS 引用的 Package Gate 后续 invalidated | 历史 Query 仍返回旧 READY；current Query 拒绝 | 历史 Query 返回 READY；current Query 抛出 `QUALITY_RELEASE_READINESS_NOT_READY`；另一 Release 不受影响 | `PASS` |
| IM05-RRS-PG-003 | 同一 Release/Package 追加更新 READY RRS | 旧 ref current 拒绝；最新 ref current 通过 | 旧 ref 返回 `QUALITY_RELEASE_READINESS_NOT_READY`；最新 ref 返回 READY | `PASS` |
| IM05-RRS-PG-004 | RRS 引用的 FULLY_APPROVED ABS 中一个 Approval 被 revoke，并追加 STALE ABS | 历史 RRS 仍可审计；current Query 拒绝 | 历史 Query 返回 READY；current Query 返回 `QUALITY_RELEASE_READINESS_NOT_READY` | `PASS` |
| IM05-RRS-RUNTIME-001 | Release Authority 对历史 READY RRS 返回 stale rejection | 授权失败；Release/Outbox/Attempt 无变化；错误不泄漏任意 Port 文本 | `RELEASE_READINESS_INVALID`；Release 保持 PREPARED；Outbox=0、Attempt=0；safe error 不含 Port 文本 | `PASS` |
| IM05-RRS-HANDLER-001 | PostgreSQL Release Handler 的 current RRS Authority 拒绝 validate command | aggregate version、Authorization、Attempt、业务 Event 不增加 | Handler 返回 `RELEASE_READINESS_INVALID`；status/version/Attempt/Event readback 与拒绝前一致 | `PASS` |

## 执行记录

### 聚焦验证

```text
pnpm exec vitest run \
  contracts/src/operations/quality-governance.schema.test.ts \
  modules/release-publication/src/release-publication-authorization.test.ts \
  modules/release-publication/src/release-publication-runtime.e2e.test.ts \
  --no-file-parallelism --reporter=dot
```

实际：`3 files / 50 tests passed`。

### 最终完整验证

```text
pnpm clean && pnpm verify
```

实际：

- Format、ESLint、TypeScript：`PASS`
- 普通 Vitest：`42 passed / 30 skipped files`，`451 passed / 300 skipped tests`
- Architecture：`PASS`
- Public API generation：`PASS / operations=201`
- TypeScript generated types：`PASS / payloads=201 / query_results=45 / core_contracts=6`
- Catalog/Registry：`201/201 FULL`
- Compatibility：baseline 200 operations，`minor=22 / findings=22`
- PostgreSQL 18.6 / Flyway 11.20.3：`34 files / 315 tests passed`
- V6002 seed → V6003/V6004 upgrade：`PASS`
- 第二次迁移：`Schema "public" is up to date. No migration necessary.`
- PostgreSQL 容器：已清理

完整门禁的第一次重跑曾因新增 latest-RRS 测试在创建第二张 RRS 后仍把第一张旧 RRS 写成正向预期而失败；实现按设计拒绝旧 ref。测试随后改为以第二张最新 RRS作为正向样本，最终完整门禁通过。没有放宽实现逻辑。

## 保留边界

- 真实 Provider/Feishu：`NOT RUN`
- 公开 HTTP：`NOT RUN`
- 生产：`NOT RUN`
- 统一 Quality→Release 跨模块业务编排器：`NOT RUN`
- 外部收件人确认与独立业务验收：`NOT RUN`
- Git commit/push、PR、exact-head CI、合并与 Issue #120 关闭：等待用户检查确认
