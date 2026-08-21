# IM-01 Exit Gate Verification Report（Issue #9）

日期：2026-08-21
环境：macOS/zsh，Node.js v24.19.0，pnpm 11.19.0，TypeScript 6.0.3
对应 Issue：[#9](https://github.com/qzhike/zhiju-business-core/issues/9)
状态：`IM-01 EXIT GATE READY / AWAITING USER REVIEW`

## 1. 范围与非目标

本报告汇总 IM-01 `Repository + Executable Contracts` 退出 Gate。它证明：

- Catalog / Module Spec / Registry / 生成类型 / v1.0 compatibility baseline 对账一致；
- 200 个操作全部 `FULL`；Command=95、Query=44、Event=61；
- 干净 checkout 下 `pnpm install --frozen-lockfile`、`pnpm clean`、`pnpm verify` 全过；
- 架构边界负向自测与 compatibility breaking 负向测试实际拒绝非法变更。

本报告**不证明**：PostgreSQL、对象存储、Keycloak、OpenBao、飞书、CLI Runtime、Renderer、业务 Handler 或人工验收。这些项保持 `NOT RUN`，不得用静态/单元证据冒充外部 E2E。

## 2. 前置工作项

| Issue | 状态 | 定位证据 |
|---|---|---|
| #1 Core Contract 嵌套字段级 Schema | CLOSED | PR #11 |
| #2 TaskExecution 37 | CLOSED | PR #10 |
| #3 Artifact 26 | CLOSED | PR #12 |
| #4 QualityGovernance 37 | CLOSED | PR #13 |
| #5 ReleasePublication 25 | OPEN（Schema 已合入） | Schema：PR #14；Runtime 追踪：#15 |
| #6 IntegrationGateway 23 | CLOSED | PR #16；Runtime 追踪：#17 |
| #7 Schema-derived TypeScript 类型 | CLOSED | PR #18 |
| #8 v1.0 Schema 兼容性基线 | CLOSED | PR #19 |

### #5 例外说明

Issue #9 硬依赖写明 #1–#8 全部关闭。#5 的字段级 Schema 已由 PR #14 合入默认分支；Issue 因 Runtime 验收拆分（#15）按既有决策保持 OPEN。IM-01 Schema 退出 Gate **不阻塞于 #5/#15 Runtime**，也**不得宣称 #5 已关闭**。该模式与 #6 CLOSED + #17 Runtime 追踪一致。

## 3. 数量对账

| 项 | 预期 | 实际 | 结果 |
|---|---|---|---|
| Catalog | 200 | 200 | `PASS` |
| Module Spec 操作集合 | 200 | 200；与 Catalog diff=0 | `PASS` |
| Registry | 200 | 200 | `PASS` |
| schemaStatus | FULL=200 / ENVELOPE_ONLY=0 | `{"FULL":200}` | `PASS` |
| kind 分类 | Command=95 Query=44 Event=61 | 95 / 44 / 61 | `PASS` |
| Owner 分布 | 20+32+37+26+37+25+23 | 一致 | `PASS` |
| Query Result Schema | 44 | `typescript_types ... query_results=44` | `PASS` |
| Payload Schema | 200 | `payloads=200` | `PASS` |
| Core Contract Schema | 6 | `core_contracts=6` | `PASS` |
| v1.0 baseline ops/core | 200 / 6 | manifest 一致 | `PASS` |
| Runtime additive proposal | 隔离，不入 Catalog | 6 个 proposal 仍隔离 | `PASS` |

## 4. Gate 结果

| Gate | 命令 / 输入 | 实际输出 | 结果 |
|---|---|---|---|
| IM01-INSTALL-001 | `pnpm install --frozen-lockfile` | Already up to date；exit 0 | `PASS` |
| IM01-CLEAN-001 | `pnpm clean` | `tsc -b --clean` exit 0 | `PASS` |
| IM01-STYLE-001 | `pnpm format:check` + `pnpm lint` | prettier/eslint exit 0 | `PASS` |
| IM01-TYPE-001 | `pnpm typecheck` / build | `tsc -b` exit 0 | `PASS` |
| IM01-TEST-001 | `pnpm test` | `Test Files 13 passed`；`Tests 287 passed` | `PASS` |
| IM01-ARCH-001 | `pnpm architecture` | `architecture_boundaries=PASS source_roots=10` | `PASS` |
| IM01-ARCH-NEG-001 | 禁止依赖探针 | 跨模块 / contracts→module / shared-kernel→nestjs / src 内路径均 `rejected=true` | `PASS` |
| IM01-CAT-001 | `contracts:check` catalog | `catalog_registry=PASS ... schema_status={"FULL":200}` | `PASS` |
| IM01-GEN-001 | public_api + typescript_types check | `operations=200`；`payloads=200 query_results=44 core_contracts=6` | `PASS` |
| IM01-COMPAT-001 | compatibility check | `compatibility=PASS ... operations=200 ... findings=0` | `PASS` |
| IM01-COMPAT-NEG-001 | breaking fixtures / 单测 | required 增删、字段删除、closed enum、类型收窄等标记 `BREAKING`；`24/24` focused tests PASS | `PASS` |
| IM01-HTTP-001 | `GET /health` | `{"status":"ok"}` | `PASS` |
| IM01-VERIFY-001 | `pnpm verify`（干净后全套） | 全链路 exit 0 | `PASS` |

## 5. 关键命令摘录

```text
$ pnpm install --frozen-lockfile
Already up to date
Done in 161ms using pnpm v11.19.0

$ pnpm clean && pnpm verify
public_api_generation=PASS operations=200
typescript_types=PASS payloads=200 query_results=44 core_contracts=6
catalog_registry=PASS catalog=200 registry=200 schema_status={"FULL":200}
compatibility=PASS baseline=v1.0 operations=200 schemas=14 envelopes=200 minor=0 findings=0
Test Files  13 passed (13)
Tests  287 passed (287)

$ node tools/architecture/check-boundaries.mjs
architecture_boundaries=PASS source_roots=10

Architecture negative probes:
module:task-execution -> @zhiju/artifact : rejected (business modules cannot import another business module)
contracts -> @zhiju/identity-policy : rejected (contracts may depend only on shared-kernel)
shared-kernel -> @nestjs/common : rejected (NestJS/Fastify are restricted to the composition/transport layer)
app:api -> @zhiju/artifact/src/internal : rejected (imports must use package public exports)

$ curl -s http://127.0.0.1:3000/health
{"status":"ok"}
```

## 6. 未执行项（必须保持 NOT RUN）

- PostgreSQL DDL / Migration / Repository / RLS / 真实库测试；
- 业务 Handler 与 Application Service；
- MicroCeph/Ceph RGW、OpenBao、Keycloak；
- 飞书 Adapter、CLI Runtime、Renderer；
- 人工业务验收、备份恢复、负载与 HA；
- IM-DG-005（Canonical Document/Workbook + Renderer 路线）与 IM-DG-006（Runtime Command/Policy）；
- #15 ReleasePublication Runtime duplicate/late receipt；
- #17 IntegrationGateway Runtime / acceptance gaps。

## 7. 剩余风险

1. 当前 API 仅有 health skeleton；HTTP smoke 不代表业务 E2E。
2. 单机 Ubuntu / 单节点 MicroCeph/OpenBao/Keycloak 主机故障容忍度为 0。
3. Ceph RGW ↔ OpenBao Transit 兼容性必须在后续里程碑实测。
4. Canonical Document/Workbook 与 Renderer 未决（IM-DG-005）。
5. Runtime 6 个 additive Command 与默认 Policy 未审核（IM-DG-006）；不得通过私有 API 或直写库绕过。
6. #5 仍 OPEN 仅因 Runtime(#15)；若审阅方要求字面满足“#1–#8 全部关闭”，需先按 #6/#17 模式关闭 #5 Schema 验收并保留 #15。

## 8. 退出判定

- 自动化 Gate：`PASS`
- 文档收口：随本 PR 同步为 `IM-01 EXIT GATE READY / AWAITING USER REVIEW`
- 正式 `IM-01 COMPLETE`：**仅在用户审核本报告后**更新；随后才允许进入 IM-02。
