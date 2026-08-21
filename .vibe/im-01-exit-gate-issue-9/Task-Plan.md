# IM-01 Exit Gate Task Plan（Issue #9）

日期：2026-08-21
状态：`EXIT GATE READY / AWAITING USER REVIEW`
对应 Issue：[#9](https://github.com/qzhike/zhiju-business-core/issues/9)

## 目标

汇总验收并关闭 IM-01 `Repository + Executable Contracts`。本切片不承载新业务语义；在可复现验证证据齐全后，将 IM-01 标记为 `EXIT GATE READY`，待用户审核后更新为 `COMPLETE`，再进入 IM-02。

## 范围

1. 干净 checkout：锁定 Node.js/pnpm 版本下恢复依赖并执行全套验证。
2. 对账 Catalog、Module Spec、Registry、operation map、JSON Schema、生成 TypeScript 类型与 v1.0 compatibility baseline。
3. 确认 `FULL=200`、`ENVELOPE_ONLY=0`；Command=95、Query=44、Event=61。
4. 更新 README、HL-Spec、Verification Baseline、Implementation Milestone Plan 与 Verification Report。
5. 明确 PostgreSQL / 对象存储 / Keycloak / OpenBao / 飞书 / CLI / Renderer / 人工验收仍为 `NOT RUN`。

## 非目标

- 不实现 DDL、Migration、Repository、Handler、RLS。
- 不批准 Runtime proposal，不决定 IM-DG-005/006。
- 不关闭 #15 / #17 Runtime 追踪 Issue。

## #5 例外

Issue #5 Schema 由 PR #14 合入；Issue 因 Runtime(#15) 保持 OPEN。IM-01 Schema 退出不阻塞于该 Runtime 追踪项，但不得宣称 #5 已关闭。

## 阶段

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 权威输入与前置 Issue 盘点 | `DONE` |
| 2 | 数量/集合对账 | `DONE` |
| 3 | 干净 verify + 负向自测 | `DONE` |
| 4 | 文档收口 | `DONE` |
| 5 | 用户确认后 PR | `DONE` (PR #20) |
