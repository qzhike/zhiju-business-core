# Zhiju Business Core

Zhiju Business Core 是面向企业交付、质量治理与发布控制的模块化单体。当前处于 `IM-01 Repository + Executable Contracts` 实施阶段。

## 当前实现范围

- Node.js 24.19.0、TypeScript 6.0.3、pnpm 11.19.0 workspace；
- NestJS 11 + Fastify 5 API composition skeleton；
- 七个业务模块的独立 package/project-reference 边界；
- Canonical JSON/Hash、UUIDv7、Typed Reference、ApiError 共享内核；
- 四类 Core Contract Family 的顶层 JSON Schema；
- 200 个已批准公开 API 的严格 Envelope Registry；
- IdentityPolicy 20 个、EnterpriseProject 32 个、TaskExecution 37 个、Artifact 26 个、QualityGovernance 37 个操作的字段级 Payload/Event Schema 与 Query Result Schema；
- format、lint、typecheck、Vitest、架构依赖和 Catalog 对账 Gate。

Registry 当前为 `FULL:152 / ENVELOPE_ONLY:48`。ReleasePublication 与 IntegrationGateway 仍需补齐字段级 Payload/Query Result/Event Payload 和 Schema-derived Type，因此 IM-01 尚未完成。

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
