# Runtime Adapter Contract v0.1 验证报告

日期：2026-08-17
环境：`C:\Users\galen\Repo\zhiju-business-core`，Windows/PowerShell，本地工作树
状态：`DESIGN VERIFIED / USER REVIEW PENDING / IMPLEMENTATION NOT STARTED`

## 1. 验证范围

本报告记录 Runtime Adapter 文档集合、官方 CLI 资料、Core API/Catalog 映射、additive proposal、安全边界、测试规格、Markdown 和 Git diff 的静态一致性。它不证明任何 Runtime、Credential、模型调用、Sandbox、数据库或真实用户流程存在或通过。

## 2. Provider 资料

当前采用官方来源：

- OpenAI Codex Non-interactive mode；
- Anthropic Claude Code Headless mode；
- OpenClaw Agent CLI。

只读取公开文档，未登录 Provider、未执行模型调用、未创建 Session、未写外部资源。

## 3. Gate 结果

| Gate | 输入 | 预期输出 | 当前实际输出 | 结果 |
|---|---|---|---|---|
| RA-DOC-001 | HL/08、Module Spec/Test、Runtime 专项目录 | Contract/Test/Plan/Report 各一，路由可达 | `high_level=9 api=3 module_specs=7 module_tests=7 feishu=4 runtime=4` | `DESIGN VERIFIED` |
| RA-PROV-001 | 三个 Installed CLI Profile 的官方文档 | 能力事实有来源且不冒充本地验证 | `cli_profiles=3 official_urls=3`；Codex/Claude Code/OpenClaw 均为 official docs only、local `NOT RUN` | `DESIGN VERIFIED` |
| RA-MAP-001 | Runtime API mapping、200 Catalog、proposal | 基准引用存在；6 个 proposal 明确隔离 | `public_refs=22 baseline_refs=16 missing=0 proposals=6`；Catalog/Specs 均 200 unique、集合差 0 | `DESIGN VERIFIED` |
| RA-TST-001 | Runtime Adapter Test | 32 个唯一 ID；4/8/8/8/4 分布 | `cases=32 unique=32 distribution={D:4,U:8,C:8,E:8,M:4}` | `DESIGN VERIFIED` |
| RA-SEC-001 | Contract 安全/Lease/Result/Usage 章节 | 安全锚点齐全 | `security_anchors=10 security_issues=0` | `DESIGN VERIFIED` |
| RA-MD-001 | `.vibe/**/*.md` | 链接、代码块、表格、冲突标记无异常 | `markdown_files=34 markdown_issues=0` | `DESIGN VERIFIED` |
| RA-DIFF-001 | 当前 Git diff | whitespace 无异常 | `git diff --check` exit 0；4 个新 Markdown 尾随空白检查 0 | `DESIGN VERIFIED` |

## 4. 关键静态检查

```text
high_level=9 api=3 module_specs=7 module_tests=7 feishu=4 runtime=4
catalog_occurrences=200 catalog_unique=200
module_spec_occurrences=200 module_spec_unique=200 catalog_diff=0
runtime_tests=32 distribution={D:4,U:8,C:8,E:8,M:4}
public_refs=22 baseline_refs=16 missing_baseline_refs=0 proposals=6
cli_profiles=3 provider_official_urls=3
security_anchors=10 security_issues=0
markdown_files=34 markdown_issues=0
```

检查覆盖相对链接、代码围栏、忽略转义 `\|` 后的 Markdown 表格列、冲突标记、Catalog/Module Spec 集合、专项测试 ID、Provider URL、proposal 隔离、安全锚点和 whitespace。

首次辅助检查把 Markdown 单元格内的转义 `\|` 当成表格分隔符，并把 `zhiju.runtime.*` 私有 Contract Type 当成公开 API，产生误报；修正检查器的语法和命名空间范围后完整重跑，最终问题为 0。proposal 曾以完整版本名出现在 Module Spec 摘要中，虽已标注待审核，仍会被 Catalog 计数器识别；现已把完整候选名集中到 Runtime 专项唯一权威，Module Spec 只保留未版本化语义摘要。

## 5. API 缺口

当前草稿识别 6 个 additive TaskExecution Command proposal。用户审核前：

- 不写入 200 项 Catalog；
- 不改变 Module Spec 的已审核 Command 数；
- 不允许实现通过直接 Repository/表写入绕过缺口；
- 静态检查必须把 proposal 与 baseline 分开计数。

## 6. 未执行项

- 所有 Unit/Contract/E2E/Manual；
- 三个 CLI 的本地路径、版本、认证、账号能力和真实调用；
- Runtime Adapter、CLI Process Driver、Schema、Mapper、Router、Dispatcher、Lease、Fencing、Persistence；
- Workspace/Sandbox/Secret/Network/Tool Policy；
- Usage reconciliation、Cancel/Timeout/Resume/Retry；
- 负载、故障恢复、安全渗透和人工业务验收。

## 7. Git 状态

草稿与同步修改位于工作树，未暂存、未 Commit。用户审核 Runtime Adapter v0.1、CLI 调用边界和 6 个 additive proposal 前不提交，也不进入实现阶段。
