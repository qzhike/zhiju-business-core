# PR #48 IdentityPolicy 角色、能力与策略 Review 计划

## 目标

审查 `qzhike/zhiju-business-core` PR #48 的实际最新提交，识别可复现的契约、权限、持久化和测试缺陷；在不扩大范围的前提下修复确认的问题，补充验证证据，将 review 结果记录到原 PR comments，并在最新提交通过复核后合并 PR、关闭原始 Issue。

## 当前边界

- 当前工作区：`48-feat-identity-policy-role-capability-and-policy`
- 目标分支：以 PR 元数据和 GitHub API 返回的实际 base 为准
- 评审对象：以 PR #48 的最新 `headRefOid` 为准，不以本地分支名或 README 描述代替
- Issue 关闭：仅关闭 PR #48 明确关联且已由本次交付完成的原始 Issue

## 执行阶段

1. [x] 读取项目规范、HL-Spec、相关 Module Spec、测试文档和 PR 元数据。
2. [x] 对 PR 精确 head 做逐文件 review，使用失败场景和直接探针验证关键权限/策略语义。
3. [x] 在代码改动前更新相关 Spec 与测试文档；随后实施最小修复并记录测试输入、预期输出、实际输出。
4. [ ] 将有依据的 review 结论发布到原 PR comments，并对修复后的新 head 重新 review。
5. [ ] 通过精确 head 校验后合并，核验 PR 与原始 Issue 的最终状态。

## 状态定义

- `DESIGN VERIFIED`：文档、代码路径和静态契约一致。
- `PASS`：本地或 CI 自动化检查实际通过。
- `NOT RUN`：依赖真实 Provider、数据库、HTTP/E2E 或人工操作，当前未执行。
- `USER REVIEW`：需要用户确认的变更边界；确认前不执行 commit。
