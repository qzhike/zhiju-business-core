# PostgreSQL 验证指南

本指南用于日常完整验证。历史 WI-01 原文与当时结果见 [原始 Runbook](../archive/im-02-workitem-issues/runbook-wi-01.md)，其中旧 digest 和未实现状态不适用于当前环境。

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

当前 [gate.mjs](../../tools/persistence/gate.mjs) 校验 PostgreSQL/Flyway 基线，迁移到 V6002、注入脱敏历史 Provider Result 测试行，再验证 V6003/V6004 升级；运行 persistence tests，执行第二次无待应用迁移检查，并在清理路径删除测试容器。

版本与镜像 tag/digest 只以 [baseline.mjs](../../tools/persistence/baseline.mjs) 为执行权威，不在此复制易过期摘要。检查最终 gate 结果和 `postgres container removed`；失败时保留原始错误与清理结果，不把一轮成功或历史测试数量当作下一轮通过证明。

该流程只证明 disposable PostgreSQL 和本地技术行为。生产、真实 Provider/Feishu、公开 HTTP、独立业务/人工验收另行取证，未执行则为 `NOT RUN`。旧专题手工探测尚未逐份重验，见 [文档索引](../README.md)。
