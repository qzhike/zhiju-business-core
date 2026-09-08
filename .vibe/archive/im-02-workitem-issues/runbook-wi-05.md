> Historical record. Related Issue: [33](https://github.com/qzhike/zhiju-business-core/issues/33). Original statuses, commands and results are dated evidence; unresolved constraints and NOT RUN boundaries remain in force. Consult current Module Spec/Test and the roadmap before reuse.

# IM-02 WI-05 本地 Runbook：IdentityPolicy 模型/Repository 脱敏 Probe

对应 Issue #33。自动验收入口 `pnpm persistence:gate`（新增 `tests/persistence/identity-policy-model.test.ts`：§9 catalog 对账、Repository 正/负路径、跨 Enterprise RLS、不可变/镜像/冲突拒绝、敏感值不落库）。

## 手动验收（脱敏 Repository probe）

启动一次性容器并应用全部 migration（与 runbook-wi-04 相同流程，容器名 `zju-wi05-probe`）。然后在仓库根目录：

```bash
ZJU_DATABASE_URL='postgres://postgres:zhiju-gate-test@127.0.0.1:5432/zhiju_core' \
  node --experimental-strip-types tests/manual/wi05-probe.mts
```

（先 `docker port zju-wi05-probe 5432` 确认端口并修正 URL。）

脚本输出（全部为脱敏视图）：

1. `createPrincipal` — 创建测试 Human Principal；
2. `linkExternalIdentity` — 以测试实现 Port（本地 HMAC/AES-GCM key）登记 ExternalIdentityLink；
3. `resolvePrincipal` — 按 provider/account/subject 解析回 Principal，输出仅含
   `lookupHash(hex 前 8 位…)、ciphertext 长度/keyVersion、displayHint、principalId`；
4. `databaseScan` — 对 `external_identity_link` 全行 `::text` 检索原始
   `open_id/email/phone` 字符串 → `NOT FOUND`；
5. `logScan` — 断言脚本过程未向 stdout/stderr 输出任何原始标识。

psql 侧直接观察：

```sql
SELECT provider_code, encode(account_lookup_hash, 'hex')      AS account_lookup_hash,
       octet_length(account_ciphertext)                        AS account_ct_len,
       account_ciphertext_algorithm, account_ciphertext_key_version,
       display_hint, status
FROM identity_policy.external_identity_link;
-- 无任何原始标识列;payload 不可见
```

## NOT RUN 声明

- 真实 OpenBao Transit HMAC/加密：`NOT RUN`（Port 已定义,当前仅测试实现,不得冒充生产加密验收）；
- Keycloak/OIDC、飞书身份 Adapter：`NOT RUN`；
- 20 个公开 Handler 的业务行为：`NOT RUN`（WI-07 至 WI-09）。
