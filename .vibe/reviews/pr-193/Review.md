# PR #193 最终审查状态

- 结论：`APPROVE`
- Reviewed SHA：`cf48abcef58200df5b8c1521885497732810ffe1`
- 人类安全/迁移技术审查：用户在当前会话明确确认“人工审核通过”（2026-09-14），对应第三轮审查后的上述提交。
- 已重新核对远端 head 未变化，CI `verify` 仍为 SUCCESS。
- 独立代码审查：R1–R4 均已修复，第三轮未发现新的阻塞问题；此前 HUMAN_REVIEW_REQUIRED 门禁现已满足。
- 验证依据：[CI run 34801154565](https://github.com/qzhike/zhiju-business-core/actions/runs/34801154565)，855 单元/契约测试、369 持久化测试通过，其中本 PR 19 例通过。
- 该人工确认只解除本 PR 人类技术审查门禁，不改变 TE 消费、跨模块完整业务链、真实 Provider、公开 HTTP、生产和独立人工业务验收的 NOT RUN 状态。
- 正式 Review.md 随交付提交保留；各轮代码审查及人工确认的精确 revision 与证据见下方历史。

下方保留各轮审查历史，其 HUMAN_REVIEW_REQUIRED/REQUEST_CHANGES 为当轮历史结论，当前状态以上述 APPROVE 为准。

---

# PR #193 独立复审（第 3 轮）

- 角色结论：`HUMAN_REVIEW_REQUIRED`
- 代码复审：本轮未发现新的阻塞问题；此前 R1–R4 均已修复。
- Reviewed SHA：`cf48abcef58200df5b8c1521885497732810ffe1`
- PR：<https://github.com/qzhike/zhiju-business-core/pull/193>
- Work item：#188；审查日期：2026-09-14。

## 修复复核

| 发现 | 当前结论 | 证据 |
| --- | --- | --- |
| R1 真实授权接线 | 已修复 | 保留上一轮已核对的 Envelope/Guard、真实 Decision/Actor/payload、当前 capability 与 Policy Port 接线；本轮 R4 修复补齐 read 的可信会话绑定。 |
| R2 写入不可读取 Slice | 已修复 | 写入前注册 read Result Guard 及 511/512 Fact 正负边界保持不变，当前 CI 回归通过。 |
| R3 CREATE 目标身份 | 已修复 | 使用预分配目标身份，同目标冲突及并发只提交一次的测试保持不变，当前 CI 回归通过。 |
| R4 read 会话绑定 | 已修复 | `sessionAuthenticationContext` 验证受信 Hash 为 32 字节 Buffer；read 先比较 Envelope Hash 与 Session Hash，再以 Session Hash 调用 owning Decision validator；独立 Policy 授权与解析也使用同一 Session Hash。 |

本轮独立读取 `e8a9c9b..cf48abc` 的全部变动，范围为组成层、持久化测试和对应 Spec/Test。没有扩展公开 Contract、修改 migration 或重写 R2/R3 的实现。

新增 `binds a read to the trusted session authentication context` 用例使用真实 capture、真实 read Decision 和同一合法 Envelope 为基线：三方一致返回 USABLE；仅换 Session Hash、仅换 Envelope Hash、Session Hash 改为 16 字节分别返回 AUTHORIZATION_DECISION_INVALID。负例仅改变目标维度，没有复用错误 Ref 或无效基线掩盖会话校验。代码也确认非法 Session Hash 在调用 Decision 读取前被拒绝。Spec 002 与 EP-WI188-A-004 已同步该行为。

## 验证证据

- `vibe repo --json` 的本地 SHA 与 PR 最新 head 一致。
- CI [run 34801154565](https://github.com/qzhike/zhiju-business-core/actions/runs/34801154565) 的 `headSha` 为上述 SHA，`verify=success`；已独立读取实际日志。
- 单元/契约：855 passed。普通测试阶段跳过的持久化用例随后由 PostgreSQL Gate 执行。
- 持久化：369 passed，其中 `context-source-slice.test.ts` 19 例通过；Flyway 空库、升级流程及重复迁移 no-op 检查通过。
- 复用当前 revision 的 CI 证据，未重复运行本地 full，也不将实现者的本地 PASS 自述当成本次独立执行结果。

## 剩余门禁与边界

[Issue #188](https://github.com/qzhike/zhiju-business-core/issues/188) Scope 明确要求：“独立审查、安全/迁移的人类技术审查及正式 `.vibe/reviews/pr-<number>/Review.md` 按项目门禁执行”。当前 PR/Issue 中尚未发现针对该实现的独立人类安全/迁移技术审查记录。因此代码问题已关闭，但角色结论为 HUMAN_REVIEW_REQUIRED，不宣称该人类门禁已经通过；这不是新增代码缺陷，也不是新的实现范围。

此前 #176/TD-01 的设计批准不替代本 PR 实现层的人类安全/迁移技术审查。后续应由人类技术审查者核对本实现的授权组成层、RLS/不可变迁移和相应证据并留存结论；合并仍需单独授权。

TE 消费、跨模块完整业务链、真实 Provider、公开 HTTP、生产及独立人工业务验收保持 NOT RUN。本轮只更新正式 Review.md，保留前两轮历史；未修改业务代码/测试，未 Git commit、push 或 merge。

---

# PR #193 独立复审（第 2 轮）

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`e8a9c9b00f878406e7c32d227567b8da22e4a7d1`
- PR：<https://github.com/qzhike/zhiju-business-core/pull/193>
- Work item：#188；审查日期：2026-09-14。
- 本轮复核上一轮修复、新增组成层与当前 SHA 的验证证据；下方保留第 1 轮历史，不将旧发现全部视为仍未修复。

## 上轮问题复核

| 发现 | 本轮状态 | 独立核对结果 |
| --- | --- | --- |
| R1 / P1 真实授权接线 | 部分修复，仍阻塞 | 已增加完整 Envelope/Guard、Decision/Actor/payload 绑定、当前 capability 检查及真实 Policy 解析适配；capture 绑定了受信 Session。read 的认证 Hash 仍取自请求而非 Session，见 R4。 |
| R2 / P1 提交不可读取 Slice | 已修复 | capture 在 INSERT 前调用注册 read Result 校验；真实来源 511 Fact/1024 redactions 正向与 512 Fact/1026 redactions 拒绝已覆盖，CI 通过。 |
| R3 / P2 CREATE 身份被覆盖 | 已修复 | 使用预分配 target ID，结果/行/请求相等；同目标异键冲突及两连接竞争只有一个 COMMITTED 的用例已覆盖，CI 通过。 |

## R4 / P1：读取入口必须绑定受信 Session 的认证 Hash

位置：`apps/api/src/composition/context-source-slice-entry.ts:763–775`；后续 Policy 授权使用该文件的 `row.authentication_context_hash`。

read 从请求 `query.authenticationContextRef.contentHash` 取值，再把这个同样由请求提供的 Hash 作为 `validatedDecision.expectedAuthenticationContextHash` 的来源。它没有读取或比较 `session.authenticationContextHash`。因此 Decision 与原请求相互一致即可通过，不代表当前受信 Session 与该 Decision 的会话一致。后续 Policy Port 也用 Decision 行的认证 Hash 签发独立 Decision，而不是当前 Session 的 Hash，无法补上缺失的检查。

直接反例：以合法 read Envelope、仍有效的 Decision、匹配的 requester、可用 Policy 和正确的 `policyResolutionActorSnapshotRef` 为基线，仅把传入 Session 的 `authenticationContextHash` 改成另一会话的 32 字节 Hash。当前 read 的完整数据流不观察这个变化，会沿用原 Decision 的身份与认证上下文读取 Slice。即便仍是同一 Principal，跨会话重用 Decision 也违反声明的精确 authentication context 绑定；Envelope 的认证 Hash 不能充当可信会话证明。

依据：Issue #188 的真实授权及当前调用者复验；Spec 002 #188 的可信组成层；新增 `ContextSourceSliceSession.authenticationContextHash` 声明要求 Decision 必须属于当前 Session；owning `validateAuthorizationDecision` 仅将其收到的 expected Hash 与 Decision 行比较，不另行识别 Session。

修复要求：先校验受信 Session Hash 的形状，并使 Envelope authenticationContextRef 的 Hash、受信 Session Hash、Decision authentication context 三者一致；传给 owning validator 的 expected Hash 应来自 Session。Policy 解析继续使用已验证的同一会话绑定。增加 read 正负对照：只变 Session Hash 必须拒绝；只变 Envelope Hash 必须拒绝；三者相符必须成功。现有 `OTHER_SESSION_HASH` 负例只调用 capture，不能证明 read 分支。

证据类型：独立静态数据流核对，已阅读 owning validator 与后续 Policy 授权路径；本轮未运行新的 PostgreSQL 会话反例，不将其标为运行时 PASS。

## 当前验证与交接

- `vibe repo --json` 与远端 PR 的 reviewed SHA 一致。
- 独立读取最新 Issue/comments、修复 diff、新增组成层、受影响 Spec/Test 和 owning authorization validator。
- CI [run 34798766424](https://github.com/qzhike/zhiju-business-core/actions/runs/34798766424) 对上述 SHA `verify=success`；已读取实际日志：855 单元/契约测试、368 持久化测试通过，本 PR 文件 18 例通过；Flyway 空库、升级流程和二次 no-op 检查通过。
- 复用当前 SHA 的 CI 证据，未重复运行本地 full。CI 通过不覆盖缺失的 read 会话负例。
- 本轮仅更新正式审查记录，没有修改产品实现/测试，没有 Git commit、push 或 merge。
- 人类安全/迁移技术审查、TE 消费、跨模块完整业务链、Provider、公开 HTTP、生产及人工业务验收仍未由本次审查证明，保持 NOT RUN。
- 返回 Implementer 修复 R4，然后审查新 head；R2/R3 不重复要求修复。

---

# PR #193 第 1 轮审查历史

- 结论：`REQUEST_CHANGES`
- Reviewed SHA：`5d365ef6733590835f7d96eb3dc0fae17f154099`
- PR：<https://github.com/qzhike/zhiju-business-core/pull/193>
- Work item：#188（T2；已批准 #176/TD-01 的实现）
- 审查日期：2026-09-14
- 本记录按项目 AGENTS.md 与 Issue #188 的正式审查文档要求保留；不代表人类安全/迁移技术审查或合并批准。

## 阻塞发现

### R1 / P1：补齐真实授权与注册 Envelope 到 Handler 的接线

位置：`modules/enterprise-project/src/business/context-source-slice-handlers.ts:154–164`；相关测试 `tests/persistence/context-source-slice.test.ts:290–310,333–368,1014–1027`。

`requireRegisteredPurpose` 仅检查传入 Context 的字符串数组。仓库中没有把 capture/read 的真实 Decision 完整性、操作、payload、Actor、Scope 与当前授权校验结果转换为该 Context 的运行期适配；Policy resolution 的真实适配也只存在于测试。现有 runner 只比较 Context 与内部 Envelope 的 ID，`establish_transaction_context` 只检查参数形状与期限，均不补上真实 Decision 校验。

现有成功测试本身就是反例：`captureDecision` 把 Decision 的 payload hash 固定为 `{projectRef: projectId}` 的 Hash，而实际 capture payload 还含 purpose/audience/requestedKinds/capturePolicyRef；read 同样使用 `commandType=project.capture_context_source_slice` 的 Decision。`serviceContext` 无条件声明 capture/read 两个 Purpose，因此这些不匹配仍被接受。缺 Purpose 数组的负例不能证明已撤销授权或错操作 Decision 被拒绝。

依据：Issue #188 Acceptance 的完整注册 Envelope、真实授权与当前授权复验；共享 API §5.3；Spec 002 IM-06 的 Action/Scope/audience/purpose 绑定。

修复要求：通过 owning IdentityPolicy 能力及可信组成层交付实际的授权、Envelope/Guard 与 Policy Port 接线；EP 不跨 Schema 读取。正向测试从该入口进入，Decision 绑定实际操作、payload 与 Actor；增加错操作/错 payload/错 Actor 和实际撤销后读取拒绝的负例。同步修正 Spec/Test 中“授权接线已实现”的事实声明。

### R2 / P1：写入前验证 Slice 能通过已注册读取结果 Guard

位置：`modules/enterprise-project/src/business/context-source-slice-handlers.ts:427–444`。

capture 装配 `slicePayload` 后直接计算 Hash 并 INSERT；只有 read 在返回时调用 `validateOperationResult`。来源装配会读取全部允许的 Fact，并为每项追加两条 redaction，因此合法来源增长可以产生超过 `maxArrayItems=1024` 的结果。此时 capture 返回 COMMITTED 和不可变 Ref，随后 exact read 却返回 `PROJECT_QUERY_REF_INVALID`，且原 Slice 无法修复。

独立 Registry 探针使用原本合法的 `tests/fixtures/contracts/context-source-slice/result.json`：baseline PASS；仅将 `source.factItems` 替换为 1024 个合法 CanonicalJson 对象时 PASS，1025 个时在 `/slice/source/factItems` 以 `payloadGuard/maxArrayItems/1024` 拒绝。实际装配的 redactions 数量为 `2*n+2`，512 个 Fact 即可越过该数组预算。此探针证明 Guard 边界；完整超限 capture 的 PostgreSQL 重现本次 NOT RUN。

依据：共享 API #157 明确要求业务 capture 无法装配合法结果时失败，不截断或改写已捕获内容；Issue #188 要求成功 capture 的 Ref 可精确解引用。

修复要求：在任何 Slice 业务写入前，用已注册 read Result Schema/Guard 验证完整候选结果，失败则拒绝 capture。增加 owning 来源产生超限结果的持久化负例，并确认不提交 Slice/成功 Receipt；保留合法边界对照。

### R3 / P2：保留 CREATE Envelope 预分配的 Slice 身份

位置：`modules/enterprise-project/src/business/context-source-slice-handlers.ts:349–355`。

Handler 无条件生成新的 `sliceId`，并覆盖 Envelope 的 `targetType/targetId`。即使完整注册 Envelope 已为 Slice A 分配 targetRef，实际提交和结果仍指向新 Slice B。不同幂等键、相同 target ID 也会生成不同 Slice，绕开 CREATE 对同一身份的冲突语义；授权/审计目标与请求目标无法保持一致。

依据：共享 API §5.2 的 CREATE targetRef 是预分配的新 Aggregate ObjectRef；Spec 002 #157 将 capture 注册为 ContextSourceSlice/CREATE。

修复要求：由完整 Envelope 的已校验 targetRef 映射到内部 targetId，并以它作为 Slice identity；拒绝错误类型/Scope/expectedAggregateVersion，不能静默重写。验证 result.objectId、存储 slice_id 与请求 targetRef.objectId 相等，并覆盖同目标异输入/异幂等键及并发重放。

## 验证证据与边界

- 通过 `vibe repo --json` 确认本地 reviewed SHA 与 PR 最新 head 一致；初始工作区干净。
- 独立读取 Issue、PR diff、相关 Spec/Test、共享 API、PostgreSQL §33、实现与测试。
- CI run [34793318389](https://github.com/qzhike/zhiju-business-core/actions/runs/34793318389) 的 head 为上述 SHA，`verify=success`。已读取实际日志：855 个单元/契约测试通过；367 个持久化测试通过，其中本 PR 17 个通过；Flyway 空库、升级流程及重复迁移 no-op 检查通过。
- CI 实际执行 `pnpm verify`，基于新 checkout/install 完成构建及 Docker/PostgreSQL Gate。未重复执行本地 full；本次没有将实现者的本地 Docker Hub 限流失败视为产品失败。
- 独立 Registry 正负对照已执行，结果见 R2。没有修改业务代码或现有测试。
- 本机现有 PostgreSQL 18.6 容器没有本 PR 的表，故未在该容器上执行写入或迁移；新增 SQL/超限 capture 运行反例保持 NOT RUN。
- 当前 17 项测试不覆盖真实 capture/read 授权撤销、超限 capture 或并发 capture 重放，不能从 CI 绿色推断这些验收已满足。
- TE 消费、跨模块完整业务链、公开 HTTP、真实 Provider、生产、独立人工业务验收及本 PR 人类安全/迁移技术审查保持 NOT RUN。
- 交接：Implementer 修复后重新审查新 head；本次未提交 Git commit、push 或 merge。
