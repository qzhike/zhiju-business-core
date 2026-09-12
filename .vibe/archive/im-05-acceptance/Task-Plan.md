# IM-05 验收任务计划

## 目标

审核当前 `origin/main` 上 IM-05（GitHub Issue #120）的权威文档、实现、测试与 GitHub 交付状态，根据可复现证据给出父里程碑验收结论。

## 权威范围

- GitHub Issue #120 及其 Work Item #121–#128。
- `.vibe/high-level-docs/HL-Spec.md`、相关 Module Spec 与 Module Test。
- QualityGovernance、IntegrationGateway Renderer、Artifact Representation 与 ReleasePublication 的当前实现。
- 当前 `origin/main` 精确头、相关 PR/Issue 状态、CI 与合并祖先关系。

## 执行步骤与成功标准

1. 建立权威基线 → 核对 Issue #120、HL-Spec、Module Spec/Test 与子 Issue 验收条件一致。
2. 审查实现 → 从迁移、Repository/Handler、公开 Query/Command Port 到跨模块绑定检查关键不变式，记录可定位发现。
3. 执行技术验证 → 先执行冷工作区全量门禁，再执行与 IM-05 直接相关的真实 PostgreSQL/负例/并发或合成报告验证；对未执行范围明确标记 `NOT RUN`。
4. 形成审查结论 → 将阻断项、证据、已验证边界与父 Gate 结论写入代码审查文档。
5. GitHub 验收与交付 → 仅在无阻断项、权威文档已同步、exact-head CI/远程回读通过后，向 Issue #120 写入验收证据并关闭；若存在阻断项则保持开放。

## 验收边界

- 本地、CI、可丢弃 PostgreSQL 与受控合成报告属于技术验收证据。
- 真实 Renderer Provider、Ceph RGW/OpenBao、生产环境、公网 HTTP/E2E、负载/HA、客户像素级布局与独立人工业务验收，除非本次取得直接证据，否则保持 `NOT RUN`。
- 本次不修改与 IM-05 无关的代码或文档，不在用户确认前执行 Git commit。
