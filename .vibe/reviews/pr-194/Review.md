# PR #194 最新提交复审（第 3 轮）

- 结论：`APPROVE`
- Reviewed SHA：`afda3b19a897045b721badd2c5ba1dd0fca970ef`
- 审查日期：2026-09-14；Work item：#189（T1）。
- 已读取最新 PR/Issue/comments、完整修复 diff，并对照此前已审阅的 Spec 003 §11.9、TE-WI02-D-020、Ref Catalog 和原始 PR 范围；本轮未发现新的阻塞问题。

## R1 修复核对

R1 / P2 已修复。`registeredEvaluatorProfileKey` 先校验完整 own-key 字段集合，再由 `isPlatformScope` 检查 Scope 的原型和空 own-key 集合，最后逐字段比较身份；不再序列化候选 Scope。加载器使用同一 Scope 结构校验。`Reflect.ownKeys` 将额外的不可枚举字段和 symbol 字段纳入拒绝边界。

本轮独立 Node 源码探针确认：合法 canonical ref 与空 null-prototype Scope 正向通过；含 undefined 字段、非空 Map、BigInt 字段、不可枚举字段以及抛异常 toJSON 的 Scope 均返回 undefined，不抛异常。新增回归数据以合法引用为基线，仅改变目标 Scope；contracts 测试覆盖加载及解析，两个 owning resolver 的测试均覆盖此前三个反例。原有消费者隔离和合法引用正向对照保留。

本次修复仅修改 evaluator helper 和两个测试文件，未改注册身份、公开契约、Catalog、通用 VersionedRef 或业务状态。已声明的精确解析语义得到落实，不需要新的产品或架构决定。

## 当前验证证据

- CI [run 34808290196](https://github.com/qzhike/zhiju-business-core/actions/runs/34808290196) 的 headSha 为上述 SHA，verify=SUCCESS；已独立读取实际日志。
- 870 个单元/契约测试通过；普通阶段跳过 354 个测试，后续 PostgreSQL Gate 的 369 个测试通过。
- 生成检查：operations=211、policy_profiles=7、evaluator_profiles=2；历史兼容检查 baseline=v1.0、operations=200 通过。
- 本地 `node node_modules/vitest/vitest.mjs run contracts/src/evaluator-profiles.test.ts modules/task-execution/src/business/evaluator-profiles.test.ts`：2 个文件、15 个测试通过；独立 R1 正负对照探针 PASS。
- 本轮复用当前 SHA 的 CI 全量验证证据，未重复运行本地 full。

## 交付边界

本结论仅批准 #189 的静态注册与纯解析范围，不代表 Evaluator 算法、Policy 解析消费、validUntil 推导、EXECUTION_CRITERION_UNSUPPORTED 映射、Readiness/Validation Handler、外部集成或人工业务验收通过；这些边界仍为 NOT RUN。

本轮只更新正式 Review.md，保留以下历史；未修改实现或测试，未 commit、push 或 merge。APPROVE 为独立 agent 审查结论，发布方式为用户要求的 PR comment，不冒充 GitHub 正式 approval review，也不授权合并。

---

# PR #194 最新提交复核（第 2 轮）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`8da193ffd8ff6e3e0fc965f29102793bc27eeb4f`
- 2026-09-14 再次读取 PR 最新 head、comments、Issue #189 comments 和该 SHA 的远端源文件；远端 head 与第 1 轮相同，尚无新提交。
- R1 / P2 仍存在：远端 `contracts/src/evaluator-profiles.ts:191` 仍以 `JSON.stringify(scope)` 与 `{}` 的序列化结果比较，未包含结构校验修复。第 1 轮反例和修复要求继续适用。
- 当前 CI `verify=SUCCESS`，仍为 run 34805949554，未产生新 revision 的验证证据。本轮没有重复运行测试。
- 本地三个实现/测试文件存在未提交改动，不属于远端 PR，不作为 R1 已修复或最新 PR 验证通过的证据；本轮未修改这些文件。
- 第 1 轮完整审查及证据保留如下。当前仍需将修复交付到 PR，并在新 head 上验证、复审；本次不执行 commit、push 或 merge。

---

# PR #194 独立审查（第 1 轮）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`8da193ffd8ff6e3e0fc965f29102793bc27eeb4f`
- PR：<https://github.com/qzhike/zhiju-business-core/pull/194>
- Work item：#189（T1）；审查日期：2026-09-14。
- 已独立读取最新 Issue/comments、PR diff、Spec 003 §11.9、TE-WI02-D-020、设计决定 §12.4、Ref Catalog、实际实现和测试，并核对当前 SHA 的 CI 日志。

## R1 / P2：以结构校验拒绝畸形 Scope，不能用 JSON 序列化结果代替精确匹配

位置：`contracts/src/evaluator-profiles.ts:183–191`，尤其第 191 行；两个 TaskExecution owning resolver 均调用该函数。

`registeredEvaluatorProfileKey` 接受 `reference: unknown`，但仅比较 `JSON.stringify(reference.scope)` 与 `"{}"`，没有先验证 Scope 的形状和字段集合。序列化会丢弃 `undefined` 字段和 Map 内容，也可能抛异常，因此不等于契约要求的空 Platform Scope。

独立 Node 探针以注册的 readiness ref 为合法基线，仅替换 `scope`，实测结果：

| Scope | 预期 | 实际 |
| --- | --- | --- |
| `{}` | readiness key | readiness key |
| `{ enterpriseId: "018f22e2-7c15-7b2e-8d86-2de956a9d4a1" }` | `undefined` | `undefined` |
| `{ enterpriseId: undefined }` | `undefined` | readiness key |
| `new Map([["enterpriseId", "018f22e2-7c15-7b2e-8d86-2de956a9d4a1"]])` | `undefined` | readiness key |
| `{ enterpriseId: 1n }` | `undefined` | 抛出 `TypeError: Do not know how to serialize a BigInt` |

最小复现（从仓库根目录执行 Node ESM，直接导入当前 TypeScript 源文件）：

```js
import {
  EVALUATOR_PROFILE_REGISTRY_VERSION as version,
  registeredEvaluatorProfileReference,
  registeredEvaluatorProfileKey,
} from './contracts/src/evaluator-profiles.ts';

const ref = registeredEvaluatorProfileReference(version, 'te.task_readiness.evaluator@1.0');
console.log(registeredEvaluatorProfileKey(version, {
  ...ref,
  scope: { enterpriseId: undefined },
}));
// Actual: te.task_readiness.evaluator@1.0; expected: undefined.
```

依据：Issue #189 Acceptance 明确要求非空 Scope fail closed；Spec 003 §11.9 第 1 条要求完整字段精确匹配及形近伪造不解析。当前纯函数是本 PR 的交付边界，不能假设未来 Handler 已先把任意 JavaScript 输入转换为合法 JSON。这些反例发生在直接调用 helper 时；本次不将其描述为已证实的 HTTP 或业务授权绕过。

修复要求：先校验候选 ref 的明确字段集合及 Scope 为受支持的空对象形状，再比较身份字段；不要通过调用输入的 JSON 序列化行为决定 Scope 是否为空。畸形 Scope 应稳定返回 `undefined`。在 contracts 与 owning resolver 测试中增加上述拒绝路径，保留 canonical ref 正向对照；不需要改动通用 VersionedRef 或扩展本 Issue 的业务范围。

## 其余核对结果

- Registry 恰有两个批准的选择器，固定 UUIDv7 身份、TaskExecution owner、Platform Scope，无 contentHash、数据库事实或 Policy 生命周期。
- 加载器覆盖重复 key/身份、缺条目、未知版本、错误 owner 和非法注册引用；生成器接入源文件与生成副本的字节漂移检查。
- 两个消费者分别限制自己的选择器；未新增 operation，Catalog 为 211 项，历史 200 项兼容基线保留。
- Spec/Test/Catalog 已区分静态注册交付与业务 Evaluator、Handler、判断产出的 NOT RUN 状态。

## 验证证据

- CI [run 34805949554](https://github.com/qzhike/zhiju-business-core/actions/runs/34805949554) 的 `headSha` 与 reviewed SHA 一致，`verify=success`；已读取实际日志。
- CI：870 个单元/契约测试通过；普通阶段跳过 354 个测试，随后 PostgreSQL Gate 的 369 个测试通过。生成检查 `operations=211 policy_profiles=7 evaluator_profiles=2`；历史兼容检查 `baseline=v1.0 operations=200` 通过。
- 本地独立执行 `node node_modules/vitest/vitest.mjs run contracts/src/evaluator-profiles.test.ts modules/task-execution/src/business/evaluator-profiles.test.ts`：2 个文件、15 个测试通过。上述新增反例另经直接 Node 源码探针复现；现有测试未覆盖这些输入。
- `pnpm exec vitest ...` 在本机无输出等待后已中止，随后直接调用已安装的同一 Vitest 完成聚焦诊断；未把被中止的命令记为通过。
- 本轮复用当前 SHA 的 CI 全量证据，未重复运行本地 `vibe verify full --json`；PR 所述本地 full PASS 属于实现者提供的证据，不冒充本次独立运行。

## 边界与交接

Evaluator 算法、Policy 解析消费、validUntil 推导、EXECUTION_CRITERION_UNSUPPORTED 映射、Readiness/Validation Handler、真实外部集成和人工业务验收仍为 NOT RUN。本轮仅新增项目要求的正式 Review.md，未修改实现或测试，未 commit、push 或 merge。返回 Implementer 修复 R1 后审查新 head。
