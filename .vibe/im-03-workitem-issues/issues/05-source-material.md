## 目标

实现 SourceMaterial 的登记、来源、验证与接受链，确保原始 bytes/hash 不可变，普通附件不会自动成为 CustomerMaterial、Baseline、Fact 或 Evidence。

父追踪：#56

硬依赖：#58、#60

## 范围

- `source_material`、`source_material_origin`、`source_material_validation` Migration、Repository 与 Handler。
- `project.register_source_material`、`project.accept_source_material`、`project.SourceMaterialAccepted`。
- descriptor 敏感字段最小化、ExternalRef/ContentHash/ObjectLocator 精确绑定、同 Hash 不同来源保留。
- 只有完整性与安全验证满足策略时可 ACCEPTED；撤回来源不删除历史材料。

## 验收条件

- [ ] 登记后 bytes/hash/origin 不可原地修改；不同来源同 Hash 仍是可追溯的不同 SourceMaterial。
- [ ] 缺失、失败或 scope 不一致的 validation ref 拒绝接受；失败事务不发事件。
- [ ] SourceMaterialAccepted 只含最小引用与已发生事实，不泄漏 originalName 或客户原文。
- [ ] 跨 Project Ref、hash mismatch、重复接受与幂等冲突有真实 PostgreSQL 证据。
- [ ] 用户可登记两份同 Hash 不同来源的脱敏材料，接受其中一份，并确认另一来源未被删除或合并。

## 非目标与 `NOT RUN` 边界

- 不实现真实飞书下载、恶意文件扫描、Ceph/OpenBao 或对象 Staging/Orphan Cleanup 外部联调；仅验证受控 validation/object ref 的业务绑定。
- 不把 SourceMaterial 自动解析为 CustomerMaterial。
