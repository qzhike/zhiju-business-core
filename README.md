# Zhiju Business Core

Zhiju Business Core 是面向企业交付、质量治理与发布控制的模块化单体。`IM-01 Repository + Executable Contracts` 已标记为 `COMPLETE`；下一里程碑为 IM-02 PostgreSQL Foundation。

## 当前实现范围

- Node.js 24.19.0、TypeScript 6.0.3、pnpm 11.19.0 workspace；
- NestJS 11 + Fastify 5 API composition skeleton；
- 七个业务模块的独立 package/project-reference 边界；
- Canonical JSON/Hash、UUIDv7、Typed Reference、ApiError 共享内核；
- 四类 Core Contract Family 的顶层 JSON Schema；
- 200 个已批准公开 API 的严格 Envelope Registry；
- IdentityPolicy 20 个操作的字段级 Payload/Event Schema，以及 6 个 Query Result Schema；
- EnterpriseProject 32 个操作的字段级 Payload/Event Schema，以及 6 个 Query Result Schema；
- TaskExecution 37 个操作的字段级 Payload/Event Schema，以及 7 个 Query Result Schema；
- Artifact 26 个操作的字段级 Payload/Event Schema，以及 7 个 Query Result Schema；
- QualityGovernance 37 个操作的字段级 Payload/Event Schema，以及 7 个 Query Result Schema；
- ReleasePublication 25 个操作的字段级 Payload/Event Schema，以及 5 个 Query Result Schema；
- IntegrationGateway 23 个操作的字段级 Payload/Event Schema，以及 5 个 Query Result Schema；
- 200 个 operation payload + 44 个 query result + 6 个 Core Contract 的字段级 TypeScript 类型（`contracts/src/generated/types/`），由 `tools/contracts/generate-typescript-types.mts` 从已注册 JSON Schema 确定性生成；
- v1.0 Schema 兼容性基线（`contracts/baselines/v1.0/`）与构建期 structural compatibility 检查（`tools/contracts/check-compatibility.mts`），含历史正/负向 fixtures、冻结 Event Schema 校验，以及 `operation-compatibility-metadata.v1.json` 人工审查 fingerprint；
- format、lint、typecheck、Vitest、架构依赖、Catalog 对账、生成 diff 与 compatibility Gate。

Registry 精确为 `FULL:200 / ENVELOPE_ONLY:0`（Command=95、Query=44、Event=61）。七模块字段级 Schema、Schema-derived Type 与 v1.0 兼容性基线已落地；干净 checkout 下 `pnpm install --frozen-lockfile`、`pnpm clean`、`pnpm verify` 全过。Issue #9 硬依赖已于 2026-08-21 修订为 Schema 子切片口径（#5 可因 #15 保持 OPEN）。Handler / Database / Runtime / Feishu / Renderer / 人工业务验收仍为后续里程碑 `NOT RUN`，详见 [Issue #9 退出 Gate 报告](.vibe/im-01-exit-gate-issue-9/Verification-Report.md)。

## 验证

```shell
pnpm install --frozen-lockfile
pnpm verify
```

本地启动 API：

```shell
pnpm --filter @zhiju/api start
```

健康检查：`GET http://127.0.0.1:3000/health`。

设计权威入口见 [HL-Spec](.vibe/high-level-docs/HL-Spec.md)。
