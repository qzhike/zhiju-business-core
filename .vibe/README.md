# 文档索引

日常从下面三个入口开始，不需要遍历历史任务目录。

| 你要做什么                       | 阅读入口                                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 了解当前进度、下一阶段与待决事项 | [roadmap](product/roadmap.md)；[里程碑计划](implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)        |
| 规划或实现具体功能               | [HL-Spec](high-level-docs/HL-Spec.md) 定位权威章节，然后读取相关 [Module Spec](module-specs/) / [Module Test](module-tests/) |
| 查某项任务的执行、验收或交付     | GitHub Issue/PR；旧材料按 [归档与 Issue 对照](archive/issue-index.md) 查找                                                   |

## 必须保留的长期文档

| 类别             | 位置与用途                                                                                                                                                                                          |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 工作流配置       | [project.yaml](project.yaml)：Vibe 工作流及配置的验证入口                                                                                                                                           |
| 产品与依赖       | [product](product/roadmap.md)、[里程碑计划](implementation-milestone-plan-v0.1/Implementation-Milestone-Plan-v0.1.md)：当前方向、依赖与退出条件                                                     |
| 权威设计         | [high-level-docs](high-level-docs/)：HL、架构、Core Contracts、领域模型、跨模块边界、公开目录、数据库逻辑模型、验证基线                                                                             |
| 模块规格与测试   | [module-specs](module-specs/)、[module-tests](module-tests/)：行为、Owner、失败语义和验证边界                                                                                                       |
| 专项契约         | [API](api-contract-v0.1/API-Contract-v0.1.md)、[Feishu](feishu-channel-contract-v0.1/)、[Runtime](runtime-adapter-contract-v0.1/)                                                                   |
| 技术与安全基线   | [Technology](implementation-milestone-plan-v0.1/Technology-Baseline-v0.1.md)、[Deployment/Security](implementation-milestone-plan-v0.1/Deployment-Security-Baseline-v0.1.md)：已批准选择与未决 Gate |
| 已批准与待决设计 | [decisions](decisions/README.md)：按主题找决策；PROPOSED 不代表批准                                                                                                                                 |
| 可复用操作说明   | [PostgreSQL 验证指南](runbooks/postgresql-verification.md)：当前操作入口                                                                                                                            |
| 正式审查记录     | [reviews](reviews/README.md)：保留 PR 关闭前的正式审查证据                                                                                                                                          |

历史 Runbook、手动探测、合成 Fixture 和交付计划完整保存在 [archive](archive/README.md)。它们的旧状态和命令不作为当前指令；归档不表示撤销有效约束，也不把未执行的人工作业或外部系统验证视为完成。

新任务不再建立 issue-_、im-_-wi-_、codex-_ 根目录。执行证据写入 GitHub Issue/PR；持久规则进入 owning 规格或主题决策；正式审查继续写入 reviews/pr-<number>/Review.md。
