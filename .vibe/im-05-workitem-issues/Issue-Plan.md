# IM-05 Quality + Release + Renderer GitHub Issue 拆解

日期：2026-08-30
状态：`PUBLISHED / REMOTE READBACK VERIFIED / WI-06 #126 LOCAL IMPLEMENTATION AND PERSISTENCE VERIFIED / GIT DELIVERY PENDING USER REVIEW`

## 1. 启动判定

结论：`IM-05 CAN START — SCOPED ENGINEERING DELIVERY`。

判定依据：

1. `origin/main@ad1822a3656ed1af7e8471bd83d32f3637868779` 已合并 IM-04 父 Gate PR #119。
2. IM-04 Parent #89 与 Work Item #90–#98 均为 `CLOSED`；有效实现 PR #100、#102、#104、#106、#110、#113、#114、#116、#117、权威同步 PR #118 与父 Gate PR #119 均为 `MERGED`，有效 head 均为 `origin/main` 祖先。
3. PR #119 exact head `28e3c51e569c414f6bbe29a2a501f8abcf91b16a` 的 `verify` 为 `SUCCESS`。
4. IM-DG-003 与 IM-DG-005 已获用户批准；Canonical Document/Workbook、RenderAttempt Binding 与 Artifact Representation 边界已冻结。
5. QualityGovernance 37 项、ReleasePublication 25 项和 IntegrationGateway 24 项公开 Contract 已有字段级 Schema；Runtime/Persistence 未实现项正是 IM-05 工作范围，不是启动前缺失的设计权威。

启动范围只接受本地、受控 Adapter、disposable PostgreSQL、生成文件可打开性和合成 Reference Fixture 的工程证据。真实 Ceph RGW/OpenBao、真实外部 Publisher、Feishu、公开 HTTP、生产、真实客户适用性和独立人工业务验收在直接证据前保持 `NOT RUN`。

## 2. Issue 拓扑

| 节点 | 范围 | 直接依赖 |
|---|---|---|
| Parent #120 | IM-05 scoped exit gate | IM-04 #89 |
| WI-01 #121 | QualityGovernance Application/Persistence foundation | #120、#89 |
| WI-02 #122 | Evidence、EvidenceLink、QualityProfile | #121 |
| WI-03 #123 | GateResult、ChangeImpact、RAS/RRS | #122、IM-04 exact Artifact/Representation Query |
| WI-04 #124 | ReviewIssue、Human Approval、ABS | #123、IdentityPolicy Human-only/SoD |
| WI-05 #125 | DOCX/XLSX Renderer 与 Representation 闭环 | #89、IM-DG-003/005；协调 #27 的 Renderer slice |
| WI-06 #126 | ReleasePublication Persistence、Release/Destination/Frozen Package | #124、#125 |
| WI-07 #127 | Release Readiness、Authorization、Publication、Receipt、Partial、Recall | #123、#124、#126、既有 #22/#23/#24 |
| WI-08 #128 | QMS-REV/REL-801 合成闭环、人工产出与父 Gate 证据 | #121～#127、#22/#23/#24 |

## 3. 既有 Issue 的处理

- #22 Release Authorization actor provenance：作为 WI-07 必需依赖，不重复创建。
- #23 Formal Receipt providerResult PII 最小化：作为 WI-07 必需依赖，不重复创建。
- #24 普通飞书发送与 Formal Release 来源链：作为 WI-07 必需依赖；受控 Runtime E2E 在 IM-05 完成，真实 Feishu Provider 仍可保持 `NOT RUN`。
- #27 IntegrationGateway Handler/Adapter/Persistence umbrella：WI-05 只交付 IM-05 所需 Renderer slice，不代表 #27 的 Feishu/CLI/全部 Handler 范围完成，也不以关闭 #27 为 IM-05 前置。

## 4. 创建边界

- 所有新 Issue 初始状态为 `PLANNED / NOT STARTED`。
- Issue 创建不授权实现、分支、PR、Commit、Push、关闭或修改 #22/#23/#24/#27。
- 每个 Work Item 都必须保留自动验收、用户可手动检查的产出、非目标和明确 `NOT RUN`。

## 5. 远端建档结果

- Parent：[#120](https://github.com/qzhike/zhiju-business-core/issues/120)
- QualityGovernance Foundation：[#121](https://github.com/qzhike/zhiju-business-core/issues/121)
- Evidence/Profile：[#122](https://github.com/qzhike/zhiju-business-core/issues/122)
- Gate/Readiness：[#123](https://github.com/qzhike/zhiju-business-core/issues/123)
- ReviewIssue/Approval：[#124](https://github.com/qzhike/zhiju-business-core/issues/124)
- Renderer/Representation：[#125](https://github.com/qzhike/zhiju-business-core/issues/125)
- Release Persistence/Package：[#126](https://github.com/qzhike/zhiju-business-core/issues/126)
- Release Runtime/Receipt/Recall：[#127](https://github.com/qzhike/zhiju-business-core/issues/127)
- Synthetic Exit Evidence：[#128](https://github.com/qzhike/zhiju-business-core/issues/128)

建档时各 Issue 已逐项 API 回读为 `OPEN / PLANNED / NOT STARTED`。截至 2026-08-31，WI-06 #126 已在本地完成实现与真实 PostgreSQL 验证，但尚未创建 Commit、Push 或 PR；#124/#125 的既有交付不在本工作树重复修改，#127/#128 仍按计划承接后续范围。本次未修改既有 #22、#23、#24、#27。
