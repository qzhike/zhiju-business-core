# PostgreSQL 验证指南

本指南用于日常完整验证。历史 WI-01 原文与当时结果见 [原始 Runbook](../archive/im-02-workitem-issues/runbook-wi-01.md)，其中旧 digest 和未实现状态不适用于当前环境。

工作台页面与本机人工联调目标，见 [macOS E2E 环境配置](workspace-mvp-e2e-macos.md)。环境 A 检查页面样例；环境 B 面向人类用户，连接 Docker 持久化数据库并调用可配置的本机 Runner，尚缺接入如实列出。本文的自动化临时库不作为环境 B 使用。

## 前置条件

- 使用 [package.json](../../package.json)、[.nvmrc](../../.nvmrc) 和 lockfile 锁定的 Node.js/pnpm/依赖。
- Docker daemon 可用；镜像仓库可访问，或满足当前 gate 的受控缓存回退条件。不要绕过 digest/版本检查。
- 在仓库根目录安装依赖：`pnpm install --frozen-lockfile`。

## 执行

```shell
vibe verify full --json
```

`full` 由 [project.yaml](../project.yaml) 定义，包含 clean、静态检查、普通测试、契约与真实 PostgreSQL persistence gate。Vibe 不可用时才按配置执行手工等价命令；Vibe 失败不是切换命令绕过失败的理由。

## 结果与清理

当前 [gate.mjs](../../tools/persistence/gate.mjs) 校验 PostgreSQL/Flyway 基线，只从 `modules/document-delivery/migrations` 迁移独立 MVP schema，不准备旧七模块或历史 Provider Result；运行五个 MVP persistence 入口（含真实受控 Keycloak），执行第二次无待应用迁移检查，并在清理路径删除测试容器。

版本与镜像 tag/digest 只以 [baseline.mjs](../../tools/persistence/baseline.mjs) 为执行权威，不在此复制易过期摘要。检查最终 gate 结果和 `postgres container removed`；失败时保留原始错误与清理结果，不把一轮成功或历史测试数量当作下一轮通过证明。

本轮 `full` 不再包含已退出 MVP 的旧平台专用数据库回归；旧模块重新接入前须恢复适用测试。该流程只证明 disposable PostgreSQL 和受控本地 HTTP/Browser/Keycloak 技术行为。生产、真实 Provider/Feishu、公开 HTTP、独立业务/人工验收另行取证，未执行则为 `NOT RUN`。旧专题手工探测尚未逐份重验，见 [文档索引](../README.md)。
