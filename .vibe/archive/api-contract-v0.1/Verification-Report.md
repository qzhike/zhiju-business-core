> Historical record; statuses and commands describe the original context. Use the current Issue/PR and project verification configuration for execution. Preserve any unique constraints until reconciled with their owning specification.
> Source: [.vibe/api-contract-v0.1/Verification-Report.md](https://github.com/qzhike/zhiju-business-core/blob/7ecdeb92368792fdea0863dc0ad84ee988d92212/.vibe/api-contract-v0.1/Verification-Report.md).

# Command / Query / Event API Contract v0.1 验证报告

日期：2026-08-13（IntegrationGateway 字段级 Schema 落地增补于 2026-08-18）
环境：`/Users/galendai/repo/zhiju-business-core`，macOS/zsh，本地工作树
状态：`DESIGN VERIFIED / USER REVIEWED 2026-08-13 / FIELD-LEVEL PAYLOAD/EVENT/RESULT SCHEMAS LANDED FOR ALL 7 MODULES 2026-08-18 / HANDLER + DB + EXTERNAL GATES REMAINING`

## 1. 验证范围

本报告只证明字段级 API 文档的结构、Catalog 覆盖、Owner/namespace、字段表、测试文档、Markdown 和 Git diff 静态一致。它不证明 JSON Schema、Handler、数据库、权限、并发、飞书、Runtime、Renderer、对象存储或人工业务流程存在或通过。

## 2. Gate 结果

| Gate | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| API-DOC-001 文档集合 | `.vibe/high-level-docs`、`module-specs`、`module-tests` | 高层 9 份；Module Spec/Test 各 7 份；ID/名称成对 | `high_level_docs=9`；`module_specs=7`；`module_tests=7`；`pair_diff=0` | `DESIGN VERIFIED` |
| API-IG-SCHEMA-001 IntegrationGateway 字段级 Schema | `contracts/src/operations/integration-gateway.schema.ts` + 6 个负向 Fixture | 23 个 operation 全部 `FULL`；9 Command + 5 Query + 9 Event + 5 Result Schema；Registry 总数 200；`pnpm verify` 6 项 Gate 全过 | `registry=200 FULL=200`；Vitest 204/204；Catalog 对账 PASS | `PASS 2026-08-18` |
| API-CAT-001 Catalog 唯一性 | `06` 与七份 Module Spec 中的 `namespace.name@1.0` | 两侧各 200 个唯一名称、无重复、集合差 0 | Catalog `occurrences=200 unique=200 duplicates=0`；Specs 同值；`set_diff=0` | `DESIGN VERIFIED` |
| API-FLD-001 字段表完整性 | Module Spec 第 3—5 节 | Command 有 target/mode/payload/auth；Query 有 consistency/payload/result；Event 有 payload | `commands=95 queries=44 events=61 issues=0` | `DESIGN VERIFIED` |
| API-TST-001 测试文档 | 七份 Module Test | 每份 1 Design、3 Unit、2 Contract、2 E2E、1 Manual；ID 唯一 | `files=7 cases=63 unique=63 duplicates=0 issues=0` | `DESIGN VERIFIED` |
| API-MD-001 Markdown | `.vibe/**/*.md` | 链接可达、代码块闭合、表格列数一致 | `markdown_issues=0` | `DESIGN VERIFIED` |
| API-OWN-001 Owner/namespace | 七份 Module Spec | 每份文档只出现本模块 namespace；分布为 20/32/37/26/37/25/23 | Identity/Project/Execution/Artifact/Quality/Release/Integration 均与 Catalog 一致，无异常输出 | `DESIGN VERIFIED` |
| API-SEC-001 安全边界 | Identity、Quality、Release、Integration 字段与拒绝语义 | Agent/actingFor 不可 Human Approval/Release Authorization；External ID 不进入公开 Event；Raw Receipt 不冒充正式 Receipt | 逐项源文档审阅符合；相关失败路径已进入 Module Test | `DESIGN VERIFIED` |
| API-DIFF-001 工作树文本质量 | 当前未提交差异 | 无冲突标记、无 whitespace error | 冲突标记检索无输出；`git diff --check` 无输出；新增文件 `new_file_whitespace_issues=0` | `DESIGN VERIFIED` |

## 3. 用户审核 Gate

| Gate | 输入 | 预期输出 | 实际输出 | 结果 |
|---|---|---|---|---|
| API-REV-001 API v0.1 用户审核 | API Contract、七份 Module Spec、七份 Module Test 与第 12 节七项设计选择 | 用户明确批准，或给出需修订项 | 用户于 2026-08-13 明确回复“API v0.1审核通过” | `USER REVIEWED` |

该结论只批准当前字段级设计基准，不改变实现、运行测试、外部集成和人工业务验收的 `NOT RUN` 状态。

## 4. 关键执行命令

Catalog 与名称集合：

```text
rg --no-filename -o '(identity|project|execution|artifact|quality|release|integration)\.[A-Za-z0-9_]+@1\.0' <catalog-or-module-specs> | sort | uniq -c
comm -3 <(catalog names sorted unique) <(module spec names sorted unique)
```

文档与测试集合：

```text
find .vibe/high-level-docs -maxdepth 1 -type f -name '*.md'
find .vibe/module-specs -maxdepth 1 -type f -name 'Module-Spec-*.md'
find .vibe/module-tests -maxdepth 1 -type f -name 'Module-Test-*.md'
```

字段、测试和 Markdown 检查使用只读 `ruby -e` 检查器，分别解析：

- Module Spec 第 3/4/5 节的 95/44/61 条表格行；
- 63 个 API Test ID、层级分布和重复项；
- 全部 Markdown 的相对链接、代码围栏和未转义表格分隔符。

文本质量：

```text
rg -n '^(<<<<<<<|=======|>>>>>>>)' .vibe
git diff --check
git diff --no-index --check /dev/null <each-untracked-markdown-file>
```

## 5. 检查器修正记录

验证过程中有三次辅助检查器兼容问题，均未代表产品文档失败：

1. 首个 Owner 检查使用 zsh 默认不启用的字符串拆分，产生错误文件路径；改为显式文件映射后 `exit=0`。
2. 首个 Test ID 检查使用本机 Ruby 不支持的 `Array#tally`；改为 `group_by` 后得到 `files=7 cases=63 unique=63 duplicates=0 issues=0`。
3. 用户审核后的首轮完整回归使用本机 Ruby 不支持的 `filter_map`，在最终状态标记检查前退出；改为 `map.compact` 后完整重跑得到 `pending_status_markers=0 overall_issues=0 exit=0`，只采用重跑结果。

静态检查还发现并已修正：

- 9 处 Markdown 表格中需要转义的 closed-enum `|`；
- 泛型 `ObjectRef/VersionedRef/ContentAddressedRef/SnapshotRef` 的若干未明确类型位置。

修正后重新执行 Markdown、Catalog、字段与 `git diff --check` Gate 均无问题。

## 6. 未执行项与剩余风险

以下全部为 `NOT RUN`：

- 21 个 API Unit 用例；
- 14 个机器 Contract/Fixture 用例；
- 14 个 E2E 用例；
- 7 个人工验收用例；
- 原高层基准中的 235 个实现前场景；
- JSON Schema/Registry/Canonical Hash 跨语言 Fixture；
- PostgreSQL Constraint/RLS/CAS/Inbox/Outbox；
- 真实飞书双向 Channel、Runtime、Renderer、对象存储和发布回执；
- 负载、备份恢复、安全渗透和人工质量验收。

静态 `DESIGN VERIFIED` 不得在后续报告中简写为自动测试 `PASS`。

## 7. Git 状态

本阶段文档均在工作树中，尚未 Commit。API v0.1 已通过用户审核；本轮状态同步变更仍须由用户检查并明确确认提交，提交前不进入 Feishu Channel Contract v0.1。
