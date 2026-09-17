import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

// IM-02 WI-03 (issue #31): the transaction-scoped RLS context and its scope
// anti-forgery properties are only proven against the real PostgreSQL
// provisioned by the persistence gate. Design authority:
// .vibe/im-02-workitem-issues/rls-context-design-wi-03.md.
//
// The probe tables follow the RLS policy pattern fixed by that document:
// policies are scoped TO the module runtime role, use the shared
// platform_security helpers, and the tables are ENABLE + FORCE ROW LEVEL
// SECURITY, so even the schema owner is bound without a context.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE_A = '11111111-1111-7111-8111-1111111111a1';
const ENTERPRISE_B = '22222222-2222-7222-8222-2222222222b2';
const PROJECT_A1 = '33333333-3333-7333-8333-3333333333c1';
const PROJECT_A2 = '33333333-3333-7333-8333-3333333333c2';
const PROJECT_A_OTHER = '33333333-3333-7333-8333-3333333333c3';
const PROJECT_B1 = '44444444-4444-7444-8444-4444444444d1';

const PRINCIPAL = '55555555-5555-7555-8555-5555555555e1';
const ACTOR_SNAPSHOT = '66666666-6666-7666-8666-6666666666f1';
const DECISION_A = '77777777-7777-7777-8777-7777777777a1';
const DECISION_B = '77777777-7777-7777-8777-7777777777b2';
const DECISION_HASH = Buffer.alloc(32, 0xab);
const CORRELATION = '88888888-8888-7888-8888-8888888888a1';
const SOURCE_EVENT = '99999999-9999-7999-8999-9999999999b1';

interface StatementOutcome {
  allowed: boolean;
  code?: string | undefined;
  message: string;
}

// IM-06 / issue #212 (V0004): the kind-carrying entry point and the scalar
// PrincipalKind read helper, spelled as regprocedure input text.
const ESTABLISH_LEGACY_SIGNATURE =
  'platform_security.establish_transaction_context(text,uuid,uuid,uuid,bytea,timestamptz,uuid,uuid[],uuid,uuid)';
const ESTABLISH_KIND_SIGNATURE =
  'platform_security.establish_transaction_context(text,uuid,text,uuid,uuid,bytea,timestamptz,uuid,uuid[],uuid,uuid)';
const PRINCIPAL_KIND_SIGNATURE = 'platform_security.context_principal_kind()';

describe.skipIf(!gateEnabled)(
  'RLS transaction context and scope anti-forgery (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let epProbe: pg.Client;
    let projectionProbe: pg.Client;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();

      // Dedicated NOINHERIT LOGIN sessions mirror the transaction coordinator:
      // they must explicitly select the context-establisher role and then the
      // target runtime role. A runtime role by itself cannot establish context.
      await admin.query(
        `CREATE ROLE wi03_probe_ep LOGIN PASSWORD 'wi03-ep-app' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app TO wi03_probe_ep`,
      );
      await admin.query(
        `CREATE ROLE wi03_probe_projection LOGIN PASSWORD 'wi03-projection' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(
        `GRANT platform_context_establisher, projection_app TO wi03_probe_projection`,
      );
      epProbe = await connectAs('wi03_probe_ep', 'wi03-ep-app', 'enterprise_project_app');
      projectionProbe = await connectAs(
        'wi03_probe_projection',
        'wi03-projection',
        'projection_app',
      );

      // Enterprise-owned and project-owned probe tables owned by the module
      // owner, following the WI-03 policy pattern. Default privileges from the
      // WI-02 baseline already grant SELECT/INSERT/UPDATE to the app role.
      await admin.query(`SET ROLE enterprise_project_owner`);
      await admin.query(`CREATE TABLE enterprise_project.wi03_enterprise_probe (
      id uuid PRIMARY KEY,
      enterprise_id uuid NOT NULL,
      display_code text NOT NULL
    )`);
      await admin.query(
        `CREATE POLICY wi03_ent_select ON enterprise_project.wi03_enterprise_probe
       FOR SELECT TO enterprise_project_app
       USING (platform_security.context_allows_enterprise(enterprise_id))`,
      );
      await admin.query(
        `CREATE POLICY wi03_ent_insert ON enterprise_project.wi03_enterprise_probe
       FOR INSERT TO enterprise_project_app
       WITH CHECK (platform_security.context_allows_enterprise(enterprise_id))`,
      );
      await admin.query(
        `CREATE POLICY wi03_ent_update ON enterprise_project.wi03_enterprise_probe
       FOR UPDATE TO enterprise_project_app
       USING (platform_security.context_allows_enterprise(enterprise_id))
       WITH CHECK (platform_security.context_allows_enterprise(enterprise_id))`,
      );
      await admin.query(
        `ALTER TABLE enterprise_project.wi03_enterprise_probe ENABLE ROW LEVEL SECURITY`,
      );
      await admin.query(
        `ALTER TABLE enterprise_project.wi03_enterprise_probe FORCE ROW LEVEL SECURITY`,
      );

      await admin.query(`CREATE TABLE enterprise_project.wi03_project_probe (
      id uuid PRIMARY KEY,
      enterprise_id uuid NOT NULL,
      project_id uuid NOT NULL,
      payload text NOT NULL
    )`);
      await admin.query(
        `CREATE POLICY wi03_prj_select ON enterprise_project.wi03_project_probe
       FOR SELECT TO enterprise_project_app
       USING (platform_security.context_allows_project(enterprise_id, project_id))`,
      );
      await admin.query(
        `CREATE POLICY wi03_prj_insert ON enterprise_project.wi03_project_probe
       FOR INSERT TO enterprise_project_app
       WITH CHECK (platform_security.context_allows_project(enterprise_id, project_id))`,
      );
      await admin.query(
        `ALTER TABLE enterprise_project.wi03_project_probe ENABLE ROW LEVEL SECURITY`,
      );
      await admin.query(
        `ALTER TABLE enterprise_project.wi03_project_probe FORCE ROW LEVEL SECURITY`,
      );
      await admin.query(`RESET ROLE`);

      // Projection rows use the same enterprise pattern via projection_app.
      await admin.query(`CREATE TABLE projection.wi03_probe_projection_probe (
      id uuid PRIMARY KEY,
      enterprise_id uuid NOT NULL,
      payload text NOT NULL
    )`);
      await admin.query(
        `GRANT SELECT, INSERT, UPDATE ON projection.wi03_probe_projection_probe TO projection_app`,
      );
      await admin.query(
        `CREATE POLICY wi03_proj_select ON projection.wi03_probe_projection_probe
       FOR SELECT TO projection_app
       USING (platform_security.context_allows_enterprise(enterprise_id))`,
      );
      await admin.query(
        `CREATE POLICY wi03_proj_insert ON projection.wi03_probe_projection_probe
       FOR INSERT TO projection_app
       WITH CHECK (platform_security.context_allows_enterprise(enterprise_id))`,
      );
      await admin.query(
        `ALTER TABLE projection.wi03_probe_projection_probe ENABLE ROW LEVEL SECURITY`,
      );
      await admin.query(
        `ALTER TABLE projection.wi03_probe_projection_probe FORCE ROW LEVEL SECURITY`,
      );

      // Seed as the deployment superuser (bypasses RLS). Same display code and
      // similar payload exist in both enterprises for the PG-E-005 probe.
      await admin.query(
        `INSERT INTO enterprise_project.wi03_enterprise_probe (id, enterprise_id, display_code) VALUES
        ('aaaaaaa1-0000-7000-8000-000000000001', $1, 'SHARED-CODE'),
        ('aaaaaaa2-0000-7000-8000-000000000002', $2, 'SHARED-CODE')`,
        [ENTERPRISE_A, ENTERPRISE_B],
      );
      await admin.query(
        `INSERT INTO enterprise_project.wi03_project_probe (id, enterprise_id, project_id, payload) VALUES
        ('bbbbbbb1-0000-7000-8000-000000000001', $1, $2, 'a1-row'),
        ('bbbbbbb2-0000-7000-8000-000000000002', $1, $3, 'a2-row'),
        ('bbbbbbb3-0000-7000-8000-000000000003', $1, $4, 'a-other-project-row'),
        ('bbbbbbb4-0000-7000-8000-000000000004', $5, $6, 'b1-row')`,
        [ENTERPRISE_A, PROJECT_A1, PROJECT_A2, PROJECT_A_OTHER, ENTERPRISE_B, PROJECT_B1],
      );
      await admin.query(
        `INSERT INTO projection.wi03_probe_projection_probe (id, enterprise_id, payload) VALUES
        ('ccccccc1-0000-7000-8000-000000000001', $1, 'projection-a'),
        ('ccccccc2-0000-7000-8000-000000000002', $2, 'projection-b')`,
        [ENTERPRISE_A, ENTERPRISE_B],
      );
    });

    afterAll(async () => {
      await epProbe.end();
      await projectionProbe.end();
      await admin.end();
    });

    async function connectAs(
      user: string,
      password: string,
      runtimeRole: string,
    ): Promise<pg.Client> {
      const url = new URL(databaseUrl ?? '');
      url.username = user;
      url.password = password;
      const connection = new pg.Client({ connectionString: url.toString() });
      await connection.connect();
      await connection.query(`SET ROLE ${runtimeRole}`);
      return connection;
    }

    async function tryQuery(
      connection: pg.Client,
      sql: string,
      values?: unknown[],
    ): Promise<StatementOutcome> {
      try {
        await connection.query(sql, values);
        return { allowed: true, message: 'ok' };
      } catch (error) {
        const pgError = error as pg.DatabaseError;
        return { allowed: false, code: pgError.code, message: pgError.message };
      }
    }

    async function establish(
      connection: pg.Client,
      overrides: Partial<{
        contextKind: string;
        enterpriseId: string;
        allowedProjects: (string | null)[];
        decisionId: string;
        decisionHash: Buffer;
        decisionExpiresInSeconds: number;
        correlationId: string;
        sourceEventId: string | null;
      }> = {},
      runtimeRole = 'enterprise_project_app',
    ): Promise<StatementOutcome> {
      const options = {
        contextKind: 'REQUEST',
        enterpriseId: ENTERPRISE_A,
        allowedProjects: [PROJECT_A1, PROJECT_A2],
        decisionId: DECISION_A,
        decisionHash: DECISION_HASH,
        decisionExpiresInSeconds: 3600,
        correlationId: CORRELATION,
        sourceEventId: null,
        ...overrides,
      };
      await connection.query('SET LOCAL ROLE platform_context_establisher');
      const outcome = await tryQuery(
        connection,
        `SELECT platform_security.establish_transaction_context(
         $1, $2, $3, $4, $5, now() + make_interval(secs => $6), $7, $8, $9, $10)`,
        [
          options.contextKind,
          PRINCIPAL,
          ACTOR_SNAPSHOT,
          options.decisionId,
          options.decisionHash,
          options.decisionExpiresInSeconds,
          options.enterpriseId,
          options.allowedProjects,
          options.correlationId,
          options.sourceEventId,
        ],
      );
      if (outcome.allowed) {
        await connection.query(`SET LOCAL ROLE ${runtimeRole}`);
      }
      return outcome;
    }

    it('records the RLS context and principal-kind migrations in flyway history', async () => {
      const result = await admin.query<{ version: string; description: string; success: boolean }>(
        `SELECT version, description, success FROM public.flyway_schema_history
         WHERE version IN ('0003', '0004') ORDER BY version`,
      );
      expect(result.rows).toEqual([
        { version: '0003', description: 'platform rls context', success: true },
        { version: '0004', description: 'platform principal kind', success: true },
      ]);
    });

    it('ships a least-privilege platform_security owner and a closed function surface', async () => {
      const role = await admin.query<{
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
      }>(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole
       FROM pg_roles WHERE rolname = 'platform_security'`,
      );
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toMatchObject({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
      });

      // Runtime roles can resolve read helpers but cannot establish or clear a
      // context. Only the NOLOGIN establisher owns the write entry points.
      const runtimeRoles = [
        'identity_policy_app',
        'enterprise_project_app',
        'task_execution_app',
        'artifact_app',
        'quality_governance_app',
        'release_publication_app',
        'integration_gateway_app',
        'projection_app',
      ];
      const owners = [
        'identity_policy_owner',
        'enterprise_project_owner',
        'task_execution_owner',
        'artifact_owner',
        'quality_governance_owner',
        'release_publication_owner',
        'integration_gateway_owner',
      ];
      const denied = [
        'identity_policy_dispatcher',
        'enterprise_project_dispatcher',
        'audit_reader',
        'migration_runner',
      ];
      const establishSignature =
        'platform_security.establish_transaction_context(text,uuid,uuid,uuid,bytea,timestamptz,uuid,uuid[],uuid,uuid)';
      for (const role_ of runtimeRoles) {
        const usage = await admin.query<{ usage: boolean }>(
          `SELECT has_schema_privilege($1, 'platform_security', 'USAGE') AS usage`,
          [role_],
        );
        expect(usage.rows[0]?.usage, `${role_} USAGE`).toBe(true);
        const readHelper = await admin.query<{ can: boolean }>(
          `SELECT has_function_privilege($1, 'platform_security.context_allows_enterprise(uuid)', 'EXECUTE') AS can`,
          [role_],
        );
        expect(readHelper.rows[0]?.can, `${role_} read helper EXECUTE`).toBe(true);
        const establishGrant = await admin.query<{ can: boolean }>(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS can`,
          [role_, establishSignature],
        );
        expect(establishGrant.rows[0]?.can, `${role_} establish EXECUTE`).toBe(false);
      }
      const establisher = await admin.query<{
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
      }>(
        `SELECT rolcanlogin, rolsuper, rolbypassrls, rolcreaterole
         FROM pg_roles WHERE rolname = 'platform_context_establisher'`,
      );
      expect(establisher.rows).toEqual([
        { rolcanlogin: false, rolsuper: false, rolbypassrls: false, rolcreaterole: false },
      ]);
      const establisherUsage = await admin.query<{ usage: boolean; can_establish: boolean }>(
        `SELECT has_schema_privilege('platform_context_establisher', 'platform_security', 'USAGE') AS usage,
                has_function_privilege('platform_context_establisher', $1, 'EXECUTE') AS can_establish`,
        [establishSignature],
      );
      expect(establisherUsage.rows[0]).toEqual({ usage: true, can_establish: true });
      for (const role_ of owners) {
        const usage = await admin.query<{ usage: boolean }>(
          `SELECT has_schema_privilege($1, 'platform_security', 'USAGE') AS usage`,
          [role_],
        );
        expect(usage.rows[0]?.usage, `${role_} USAGE`).toBe(true);
        const readHelper = await admin.query<{ can: boolean }>(
          `SELECT has_function_privilege($1, 'platform_security.context_allows_enterprise(uuid)', 'EXECUTE') AS can`,
          [role_],
        );
        expect(readHelper.rows[0]?.can, `${role_} read helper EXECUTE`).toBe(true);
        const establishGrant = await admin.query<{ can: boolean }>(
          `SELECT has_function_privilege($1, $2, 'EXECUTE') AS can`,
          [role_, establishSignature],
        );
        expect(establishGrant.rows[0]?.can, `${role_} establish EXECUTE`).toBe(false);
      }
      for (const role_ of denied) {
        const usage = await admin.query<{ usage: boolean }>(
          `SELECT has_schema_privilege($1, 'platform_security', 'USAGE') AS usage`,
          [role_],
        );
        expect(usage.rows[0]?.usage, `${role_} USAGE`).toBe(false);
      }
      // PUBLIC holds no ACL entry on the schema at all (aclexplode grantee 0
      // is PUBLIC); it cannot even resolve names inside the schema.
      const publicAcl = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM aclexplode(
           (SELECT nspacl FROM pg_namespace WHERE nspname = 'platform_security'))
         WHERE grantee = 0`,
      );
      expect(publicAcl.rows[0]?.count).toBe('0');

      // Every function is SECURITY DEFINER, owned by platform_security, and the
      // context table grants nothing to any role.
      const functions = await admin.query<{ proname: string; prokind: string; security: boolean }>(
        `SELECT p.proname, p.prokind, p.prosecdef AS security
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'platform_security'`,
      );
      expect(functions.rows.length).toBeGreaterThanOrEqual(12);
      for (const fn of functions.rows) {
        expect(fn.security, `${fn.proname} SECURITY DEFINER`).toBe(true);
      }
      // V0004 adds the kind-carrying overload and the scalar kind helper; the
      // generic loop above must therefore cover exactly these two functions as
      // well, with the helper keeping the STABLE shape of context_principal_id.
      const kindFunctions = await admin.query<{
        name: string;
        arg_count: number;
        args: string;
        kind: string;
        security: boolean;
        volatility: string;
      }>(
        `SELECT p.proname AS name, p.pronargs AS arg_count,
                pg_get_function_identity_arguments(p.oid) AS args,
                p.prokind AS kind, p.prosecdef AS security, p.provolatile AS volatility
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'platform_security'
           AND p.oid IN (to_regprocedure($1), to_regprocedure($2))`,
        [ESTABLISH_KIND_SIGNATURE, PRINCIPAL_KIND_SIGNATURE],
      );
      expect(kindFunctions.rows).toHaveLength(2);
      for (const fn of kindFunctions.rows) {
        expect(fn, `${fn.name} metadata`).toMatchObject({ kind: 'f', security: true });
      }
      const kindOverload = kindFunctions.rows.find(
        (row) => row.name === 'establish_transaction_context',
      );
      // The overload is the 11-argument entry with the kind immediately after
      // the principal id; the read helper takes no arguments and is STABLE.
      expect(kindOverload).toMatchObject({ arg_count: 11 });
      expect(kindOverload?.args).toMatch(
        /^p_context_kind text, p_principal_id uuid, p_principal_kind text, /,
      );
      expect(kindFunctions.rows.find((row) => row.name === 'context_principal_kind')).toMatchObject(
        {
          arg_count: 0,
          volatility: 's',
        },
      );
      const fnOwner = await admin.query<{ rolname: string }>(
        `SELECT pg_get_userbyid(p.proowner) AS rolname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'platform_security'`,
      );
      expect(new Set(fnOwner.rows.map((row) => row.rolname))).toEqual(
        new Set(['platform_security']),
      );

      const tableGrants = await admin.query<{ grantee: string }>(
        `SELECT grantee FROM information_schema.role_table_grants
       WHERE table_schema = 'platform_security' AND table_name = 'tx_context'
         AND grantee <> 'platform_security'`,
      );
      expect(tableGrants.rows).toEqual([]);
    });

    it('returns zero rows and rejects writes when no context exists', async () => {
      const count = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(count.rows[0]?.count).toBe('0');

      const insert = await tryQuery(
        epProbe,
        `INSERT INTO enterprise_project.wi03_enterprise_probe (id, enterprise_id, display_code)
       VALUES (uuidv7(), $1, 'no-context')`,
        [ENTERPRISE_A],
      );
      expect(insert.allowed).toBe(false);
      expect(insert.code).toBe('42501');
      expect(insert.message).toMatch(/row-level security/);

      const projectCount = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_project_probe`,
      );
      expect(projectCount.rows[0]?.count).toBe('0');
    });

    it('ignores forged custom GUC values (custom settings are not credentials)', async () => {
      // PG custom settings can be SET by any session; the mechanism must not
      // treat them as context input at all.
      await epProbe.query('BEGIN');
      await epProbe.query(`SELECT set_config('app.zju.enterprise_id', $1, true)`, [ENTERPRISE_B]);
      await epProbe.query(`SET LOCAL app.zju.principal_id = 'forged'`);
      const count = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(count.rows[0]?.count).toBe('0');
      await epProbe.query('ROLLBACK');
    });

    it('denies direct context-table access to runtime roles (no forged context rows)', async () => {
      const attempts: { sql: string; values?: unknown[] }[] = [
        { sql: `SELECT count(*) FROM platform_security.tx_context` },
        {
          sql: `INSERT INTO platform_security.tx_context
           (backend_pid, xact_id, context_kind, principal_id, actor_snapshot_id,
            authorization_decision_id, authorization_decision_hash,
            authorization_decision_expires_at, enterprise_id, allowed_project_ids,
            correlation_id, established_by, session_user_name)
         VALUES (1, 1, 'REQUEST', $1, $1, $1, decode(repeat('ab', 32), 'hex'),
                 now() + interval '1 hour', $2, '{}', $1, 'forged', 'forged')`,
          values: [PRINCIPAL, ENTERPRISE_B],
        },
        {
          sql: `UPDATE platform_security.tx_context SET enterprise_id = $1`,
          values: [ENTERPRISE_B],
        },
        { sql: `DELETE FROM platform_security.tx_context` },
      ];
      for (const attempt of attempts) {
        const outcome = await tryQuery(epProbe, attempt.sql, attempt.values);
        expect(outcome.allowed, attempt.sql).toBe(false);
        expect(outcome.code).toBe('42501');
        expect(outcome.message).toMatch(/permission denied/);
      }
    });

    it('denies direct context establishment from an ordinary runtime role', async () => {
      await epProbe.query('BEGIN');
      const forged = await tryQuery(
        epProbe,
        `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, now() + interval '1 hour',
         $5, ARRAY[$6]::uuid[], $7, NULL)`,
        [
          PRINCIPAL,
          ACTOR_SNAPSHOT,
          DECISION_B,
          DECISION_HASH,
          ENTERPRISE_B,
          PROJECT_B1,
          CORRELATION,
        ],
      );
      expect(forged.allowed).toBe(false);
      expect(forged.code).toBe('42501');
      expect(forged.message).toMatch(
        /permission denied for function establish_transaction_context/,
      );
      await epProbe.query('ROLLBACK');
    });

    it('rejects establishment with expired decision, bad hash or wrong consumer shape', async () => {
      // Each rejected attempt runs in its own transaction: the failure aborts
      // the transaction, and the next probe must start from a clean state.
      const rejected: { overrides: Parameters<typeof establish>[1]; message: RegExp }[] = [
        { overrides: { decisionExpiresInSeconds: -60 }, message: /expired/ },
        { overrides: { decisionHash: Buffer.alloc(31, 0x01) }, message: /32 bytes/ },
        { overrides: { contextKind: 'EVENT_CONSUMER' }, message: /source_event_id/ },
        {
          overrides: {
            contextKind: 'EVENT_CONSUMER',
            allowedProjects: [],
            sourceEventId: SOURCE_EVENT,
          },
          message: /project scope/,
        },
        {
          overrides: {
            contextKind: 'EVENT_CONSUMER',
            allowedProjects: [null],
            sourceEventId: SOURCE_EVENT,
          },
          message: /null project scope/,
        },
        { overrides: { sourceEventId: SOURCE_EVENT }, message: /source_event_id/ },
      ];
      for (const { overrides, message } of rejected) {
        await epProbe.query('BEGIN');
        const outcome = await establish(epProbe, overrides);
        expect(outcome.allowed, JSON.stringify(overrides)).toBe(false);
        expect(outcome.code, JSON.stringify(overrides)).toBe('22023');
        expect(outcome.message).toMatch(message);
        await epProbe.query('ROLLBACK');
        // None of the rejected attempts may leave a usable context behind.
        const valid = await epProbe.query<{ valid: boolean }>(
          `SELECT platform_security.context_is_valid() AS valid`,
        );
        expect(valid.rows[0]?.valid).toBe(false);
      }
    });

    it('isolates Enterprise A from Enterprise B reads and writes (PG-U-002 / PG-E-005)', async () => {
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });

      const rows = await epProbe.query<{ id: string; display_code: string }>(
        `SELECT id, display_code FROM enterprise_project.wi03_enterprise_probe ORDER BY id`,
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.id).toBe('aaaaaaa1-0000-7000-8000-000000000001');

      // PG-E-005 sub-scenario: identical display code exists in both
      // enterprises; the A-context lookup only ever sees the A row.
      const byCode = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe WHERE display_code = 'SHARED-CODE'`,
      );
      expect(byCode.rows[0]?.count).toBe('1');

      // Cross-tenant writes are rejected without leaking that B rows exist.
      const crossWrite = await tryQuery(
        epProbe,
        `INSERT INTO enterprise_project.wi03_enterprise_probe (id, enterprise_id, display_code)
       VALUES (uuidv7(), $1, 'cross-write')`,
        [ENTERPRISE_B],
      );
      expect(crossWrite.allowed).toBe(false);
      expect(crossWrite.code).toBe('42501');
      expect(crossWrite.message).toMatch(/row-level security/);

      await epProbe.query('ROLLBACK');
    });

    it('scopes project rows to the allowed project set (same enterprise)', async () => {
      // Positive path first: an in-scope write commits atomically.
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });

      const visible = await epProbe.query<{ payload: string }>(
        `SELECT payload FROM enterprise_project.wi03_project_probe ORDER BY payload`,
      );
      expect(visible.rows.map((row) => row.payload)).toEqual(['a1-row', 'a2-row']);

      const allowed = await tryQuery(
        epProbe,
        `INSERT INTO enterprise_project.wi03_project_probe (id, enterprise_id, project_id, payload)
       VALUES ('ddddddd1-0000-7000-8000-000000000001', $1, $2, 'in-scope-write')`,
        [ENTERPRISE_A, PROJECT_A1],
      );
      expect(allowed).toMatchObject({ allowed: true });
      await epProbe.query('COMMIT');

      const persisted = await admin.query<{ payload: string }>(
        `SELECT payload FROM enterprise_project.wi03_project_probe WHERE id = 'ddddddd1-0000-7000-8000-000000000001'`,
      );
      expect(persisted.rows[0]?.payload).toBe('in-scope-write');

      // PG-U-001 sub-scenario: a project-owned row whose scope does not match
      // the authorized project set cannot be written even in the right
      // enterprise. Each rejection gets its own transaction because the
      // failed statement aborts it.
      const rejectedWrites: { project: string; enterprise: string }[] = [
        { project: PROJECT_A_OTHER, enterprise: ENTERPRISE_A },
        { project: PROJECT_B1, enterprise: ENTERPRISE_B },
      ];
      for (const { project, enterprise } of rejectedWrites) {
        await epProbe.query('BEGIN');
        await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
        const outcome = await tryQuery(
          epProbe,
          `INSERT INTO enterprise_project.wi03_project_probe (id, enterprise_id, project_id, payload)
           VALUES (uuidv7(), $1, $2, 'out-of-scope-write')`,
          [enterprise, project],
        );
        expect(outcome.allowed).toBe(false);
        expect(outcome.code).toBe('42501');
        await epProbe.query('ROLLBACK');
      }
    });

    it('is idempotent for identical re-establishment and refuses a conflicting second context', async () => {
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });

      // The established context survives an identical replay untouched.
      const enterprise = await epProbe.query<{ enterprise_id: string | null }>(
        `SELECT platform_security.context_enterprise_id() AS enterprise_id`,
      );
      expect(enterprise.rows[0]?.enterprise_id).toBe(ENTERPRISE_A);

      // A conflicting second context in the same transaction is refused (the
      // statement aborts the transaction, so nothing may follow it).
      const conflict = await establish(epProbe, {
        enterpriseId: ENTERPRISE_B,
        decisionId: DECISION_B,
      });
      expect(conflict.allowed).toBe(false);
      expect(conflict.message).toMatch(/platform_context_conflict/);
      await epProbe.query('ROLLBACK');
    });

    it('clears the context after commit, rollback and mid-transaction errors', async () => {
      // Commit path
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await epProbe.query('COMMIT');
      let count = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(count.rows[0]?.count).toBe('0');

      // Rollback path
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await epProbe.query('ROLLBACK');
      count = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(count.rows[0]?.count).toBe('0');

      // Error path: the failing statement aborts the transaction; the context
      // row disappears with the rollback and pool reuse sees nothing.
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await expect(epProbe.query('SELECT 1 / 0')).rejects.toThrow(/division by zero/);
      await epProbe.query('ROLLBACK');
      count = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(count.rows[0]?.count).toBe('0');

      // Residual rows from finished transactions are physically removed by the
      // next establishment on the same backend.
      const pid = (await epProbe.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await epProbe.query('ROLLBACK');
      const residue = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM platform_security.tx_context WHERE backend_pid = $1`,
        [Number(pid)],
      );
      expect(residue.rows[0]?.count).toBe('1');

      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await epProbe.query('ROLLBACK');
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await epProbe.query('COMMIT');
      const afterHousekeeping = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM platform_security.tx_context WHERE backend_pid = $1`,
        [Number(pid)],
      );
      expect(afterHousekeeping.rows[0]?.count).toBe('1');
    });

    it('clear_transaction_context removes residual rows of finished transactions', async () => {
      const pid = (await epProbe.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0]
        ?.pid;
      await epProbe.query('BEGIN');
      await expect(establish(epProbe)).resolves.toMatchObject({ allowed: true });
      await epProbe.query('COMMIT');

      await epProbe.query('BEGIN');
      await epProbe.query('SET LOCAL ROLE platform_context_establisher');
      await epProbe.query('SELECT platform_security.clear_transaction_context()');
      await epProbe.query('COMMIT');

      const residue = await admin.query<{ count: string }>(
        `SELECT count(*) AS count FROM platform_security.tx_context WHERE backend_pid = $1`,
        [Number(pid)],
      );
      expect(residue.rows[0]?.count).toBe('0');
    });

    it('isolates concurrent connections with different contexts', async () => {
      const second = await connectAs('wi03_probe_ep', 'wi03-ep-app', 'enterprise_project_app');
      try {
        await epProbe.query('BEGIN');
        await second.query('BEGIN');
        await expect(establish(epProbe, { enterpriseId: ENTERPRISE_A })).resolves.toMatchObject({
          allowed: true,
        });
        await expect(
          establish(second, { enterpriseId: ENTERPRISE_B, allowedProjects: [PROJECT_B1] }),
        ).resolves.toMatchObject({ allowed: true });

        const seenByA = await epProbe.query<{ count: string }>(
          `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe WHERE display_code = 'SHARED-CODE'`,
        );
        const seenByB = await second.query<{ count: string }>(
          `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe WHERE display_code = 'SHARED-CODE'`,
        );
        expect(seenByA.rows[0]?.count).toBe('1');
        expect(seenByB.rows[0]?.count).toBe('1');

        const aRow = await epProbe.query<{ id: string }>(
          `SELECT id FROM enterprise_project.wi03_enterprise_probe`,
        );
        const bRow = await second.query<{ id: string }>(
          `SELECT id FROM enterprise_project.wi03_enterprise_probe`,
        );
        expect(aRow.rows[0]?.id).toBe('aaaaaaa1-0000-7000-8000-000000000001');
        expect(bRow.rows[0]?.id).toBe('aaaaaaa2-0000-7000-8000-000000000002');

        await epProbe.query('ROLLBACK');
        await second.query('ROLLBACK');
      } finally {
        await second.end();
      }
    });

    it('establishes an EVENT_CONSUMER context only from a verified event shape', async () => {
      await epProbe.query('BEGIN');
      await expect(
        establish(epProbe, {
          contextKind: 'EVENT_CONSUMER',
          allowedProjects: [PROJECT_A1],
          sourceEventId: SOURCE_EVENT,
        }),
      ).resolves.toMatchObject({ allowed: true });

      const kind = await epProbe.query<{
        kind: string;
        event_id: string | null;
        established_by: string;
      }>(
        `SELECT platform_security.context_kind() AS kind,
              (SELECT source_event_id FROM platform_security.current_context()) AS event_id,
              (SELECT established_by FROM platform_security.current_context()) AS established_by`,
      );
      expect(kind.rows[0]?.kind).toBe('EVENT_CONSUMER');
      expect(kind.rows[0]?.event_id).toBe(SOURCE_EVENT);
      expect(kind.rows[0]?.established_by).toBe('platform_context_establisher');
      await epProbe.query('ROLLBACK');
    });

    it('re-checks decision expiry on later statements in the same transaction', async () => {
      await epProbe.query('BEGIN');
      await expect(establish(epProbe, { decisionExpiresInSeconds: 0.25 })).resolves.toMatchObject({
        allowed: true,
      });

      const beforeExpiry = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(beforeExpiry.rows[0]?.count).toBe('1');

      await epProbe.query('SELECT pg_sleep(0.4)');
      const afterExpiry = await epProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
      );
      expect(afterExpiry.rows[0]?.count).toBe('0');
      await epProbe.query('ROLLBACK');
    });

    it('binds the schema owner to FORCE ROW LEVEL SECURITY', async () => {
      await admin.query('SET ROLE enterprise_project_owner');
      try {
        const ownerCount = await admin.query<{ count: string }>(
          `SELECT count(*) AS count FROM enterprise_project.wi03_enterprise_probe`,
        );
        expect(ownerCount.rows[0]?.count).toBe('0');
      } finally {
        await admin.query('RESET ROLE');
      }
    });

    it('applies the same enterprise pattern to projection rows', async () => {
      const noContext = await projectionProbe.query<{ count: string }>(
        `SELECT count(*) AS count FROM projection.wi03_probe_projection_probe`,
      );
      expect(noContext.rows[0]?.count).toBe('0');

      await projectionProbe.query('BEGIN');
      await expect(
        establish(
          projectionProbe,
          { enterpriseId: ENTERPRISE_A, allowedProjects: [] },
          'projection_app',
        ),
      ).resolves.toMatchObject({ allowed: true });
      const visible = await projectionProbe.query<{ payload: string }>(
        `SELECT payload FROM projection.wi03_probe_projection_probe`,
      );
      expect(visible.rows.map((row) => row.payload)).toEqual(['projection-a']);

      const crossWrite = await tryQuery(
        projectionProbe,
        `INSERT INTO projection.wi03_probe_projection_probe (id, enterprise_id, payload)
       VALUES (uuidv7(), $1, 'cross')`,
        [ENTERPRISE_B],
      );
      expect(crossWrite.allowed).toBe(false);
      expect(crossWrite.code).toBe('42501');
      await projectionProbe.query('ROLLBACK');
    });
  },
);

// IM-06 / issue #212 (design authority: .vibe/decisions/rls-transaction-context.md
// §3.5). V0004 adds the trusted PrincipalKind fact under the V0003 context. The
// properties below are only provable against real PostgreSQL: the closed set is
// a CHECK constraint, the legacy and kind-carrying entries are distinct
// overloads, and the ACL boundary is enforced by the database, not by handlers.
describe.skipIf(!gateEnabled)('platform principal kind (V0004, real PostgreSQL)', () => {
  const APP_ROLE = 'task_execution_app';
  // Probe role names deliberately avoid the `_(owner|app|dispatcher)$` module
  // role shape (asserted by the roles-baseline suite) and collide with no other
  // suite's probe role; both are dropped again in afterAll.
  const ESTABLISHER_PROBE_ROLE = 'wi04_probe_establisher';
  const RUNTIME_PROBE_ROLE = 'wi04_probe_runtime';
  const ESTABLISHER_PROBE_PASSWORD = 'wi04-establisher';
  const RUNTIME_PROBE_PASSWORD = 'wi04-runtime';
  const PRINCIPAL_KINDS = ['HUMAN', 'AGENT', 'SERVICE', 'RUNTIME', 'EXTERNAL_PARTY'];
  const READ_ROLES = [
    'identity_policy_app',
    'enterprise_project_app',
    'task_execution_app',
    'artifact_app',
    'quality_governance_app',
    'release_publication_app',
    'integration_gateway_app',
    'projection_app',
    'identity_policy_owner',
    'enterprise_project_owner',
    'task_execution_owner',
    'artifact_owner',
    'quality_governance_owner',
    'release_publication_owner',
    'integration_gateway_owner',
  ];
  const DENIED_READ_ROLES = [
    'identity_policy_dispatcher',
    'enterprise_project_dispatcher',
    'audit_reader',
    'migration_runner',
  ];

  let admin: pg.Client;
  let establisherProbe: pg.Client;
  let secondProbe: pg.Client;
  let appProbe: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();

    // The establisher probe mirrors the transaction coordinator: NOINHERIT
    // LOGIN plus the NOLOGIN establisher and the module runtime role, both of
    // which it must select explicitly. The runtime-only probe holds just the
    // runtime role, so the database itself must reject its write attempts.
    await admin.query(
      `CREATE ROLE ${ESTABLISHER_PROBE_ROLE} LOGIN PASSWORD '${ESTABLISHER_PROBE_PASSWORD}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher, ${APP_ROLE} TO ${ESTABLISHER_PROBE_ROLE}`,
    );
    await admin.query(
      `CREATE ROLE ${RUNTIME_PROBE_ROLE} LOGIN PASSWORD '${RUNTIME_PROBE_PASSWORD}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(`GRANT ${APP_ROLE} TO ${RUNTIME_PROBE_ROLE}`);

    establisherProbe = await connectAs(ESTABLISHER_PROBE_ROLE, ESTABLISHER_PROBE_PASSWORD);
    secondProbe = await connectAs(ESTABLISHER_PROBE_ROLE, ESTABLISHER_PROBE_PASSWORD);
    appProbe = await connectAs(RUNTIME_PROBE_ROLE, RUNTIME_PROBE_PASSWORD);
  });

  afterAll(async () => {
    await establisherProbe.end();
    await secondProbe.end();
    await appProbe.end();
    // With the probe sessions closed, the disposable LOGIN roles they used can
    // be removed: a leftover `_app`-shaped or otherwise unexpected role would
    // otherwise change the authoritative inventory a later suite reads.
    await admin.query(`DROP ROLE IF EXISTS ${ESTABLISHER_PROBE_ROLE}`);
    await admin.query(`DROP ROLE IF EXISTS ${RUNTIME_PROBE_ROLE}`);
    await admin.end();
  });

  // A probe that fails mid-transaction would otherwise stay in an open or
  // aborted transaction, turning every later statement of every later test in
  // this block into "current transaction is aborted". Rolling the probes back
  // after each test keeps one failure local.
  afterEach(async () => {
    for (const probe of [establisherProbe, secondProbe, appProbe]) {
      try {
        await probe.query('ROLLBACK');
      } catch {
        // A connection that is already gone needs no further restoration.
      }
    }
  });

  async function connectAs(user: string, password: string): Promise<pg.Client> {
    const url = new URL(databaseUrl ?? '');
    url.username = user;
    url.password = password;
    const connection = new pg.Client({ connectionString: url.toString() });
    await connection.connect();
    await connection.query(`SET ROLE ${APP_ROLE}`);
    return connection;
  }

  async function tryQuery(
    connection: pg.Client,
    sql: string,
    values?: unknown[],
  ): Promise<StatementOutcome> {
    try {
      await connection.query(sql, values);
      return { allowed: true, message: 'ok' };
    } catch (error) {
      const pgError = error as pg.DatabaseError;
      return { allowed: false, code: pgError.code, message: pgError.message };
    }
  }

  interface ContextOptions {
    decisionId?: string;
    decisionExpiresInSeconds?: number;
    enterpriseId?: string;
    allowedProjects?: (string | null)[];
    sourceEventId?: string | null;
  }

  interface KindContextOptions extends ContextOptions {
    principalKind?: string | null;
  }

  function contextArguments(overrides: ContextOptions) {
    return {
      contextKind: 'REQUEST',
      decisionId: DECISION_A,
      decisionExpiresInSeconds: 3600,
      enterpriseId: ENTERPRISE_A,
      allowedProjects: [PROJECT_A1],
      sourceEventId: null,
      ...overrides,
    };
  }

  async function establishLegacy(
    connection: pg.Client,
    overrides: ContextOptions = {},
  ): Promise<StatementOutcome> {
    const options = contextArguments(overrides);
    await connection.query('SET LOCAL ROLE platform_context_establisher');
    const outcome = await tryQuery(
      connection,
      `SELECT platform_security.establish_transaction_context(
       $1, $2, $3, $4, $5, now() + make_interval(secs => $6), $7, $8, $9, $10)`,
      [
        options.contextKind,
        PRINCIPAL,
        ACTOR_SNAPSHOT,
        options.decisionId,
        DECISION_HASH,
        options.decisionExpiresInSeconds,
        options.enterpriseId,
        options.allowedProjects,
        CORRELATION,
        options.sourceEventId,
      ],
    );
    if (outcome.allowed) {
      await connection.query(`SET LOCAL ROLE ${APP_ROLE}`);
    }
    return outcome;
  }

  async function establishWithKind(
    connection: pg.Client,
    overrides: KindContextOptions = {},
  ): Promise<StatementOutcome> {
    const { principalKind, ...rest } = overrides;
    const options = {
      principalKind: principalKind === undefined ? 'HUMAN' : principalKind,
      ...contextArguments(rest),
    };
    await connection.query('SET LOCAL ROLE platform_context_establisher');
    const outcome = await tryQuery(
      connection,
      `SELECT platform_security.establish_transaction_context(
       $1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7), $8, $9, $10, $11)`,
      [
        options.contextKind,
        PRINCIPAL,
        options.principalKind,
        ACTOR_SNAPSHOT,
        options.decisionId,
        DECISION_HASH,
        options.decisionExpiresInSeconds,
        options.enterpriseId,
        options.allowedProjects,
        CORRELATION,
        options.sourceEventId,
      ],
    );
    if (outcome.allowed) {
      await connection.query(`SET LOCAL ROLE ${APP_ROLE}`);
    }
    return outcome;
  }

  // The two trusted anchors as a runtime role observes them.
  async function anchors(
    connection: pg.Client,
  ): Promise<{ kind: string | null; principal: string | null }> {
    const result = await connection.query<{ kind: string | null; principal_id: string | null }>(
      `SELECT platform_security.context_principal_kind() AS kind,
              platform_security.context_principal_id() AS principal_id`,
    );
    return {
      kind: result.rows[0]?.kind ?? null,
      principal: result.rows[0]?.principal_id ?? null,
    };
  }

  // The persisted fact behind the helper, read as a second session (the
  // deployment superuser). A row written by the probe's still-open transaction
  // is invisible to that session under READ COMMITTED, so callers read it only
  // after committing the transaction that wrote it.
  async function storedKind(connection: pg.Client): Promise<{ principal_kind: string | null }[]> {
    const pid = (await connection.query<{ pid: string }>('SELECT pg_backend_pid() AS pid')).rows[0]
      ?.pid;
    const result = await admin.query<{ principal_kind: string | null }>(
      `SELECT principal_kind FROM platform_security.tx_context WHERE backend_pid = $1`,
      [Number(pid)],
    );
    return result.rows;
  }

  it('keeps the legacy 10-argument entry working with a NULL kind', async () => {
    await establisherProbe.query('BEGIN');
    await expect(establishLegacy(establisherProbe)).resolves.toMatchObject({ allowed: true });

    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: PRINCIPAL });

    // The persisted row is only observable to the superuser session once the
    // transaction that wrote it is committed.
    await establisherProbe.query('COMMIT');
    const rows = await storedKind(establisherProbe);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.principal_kind).toBeNull();
  });

  it('stores and reads back each value of the closed PrincipalKind set', async () => {
    for (const kind of PRINCIPAL_KINDS) {
      await establisherProbe.query('BEGIN');
      await expect(
        establishWithKind(establisherProbe, { principalKind: kind }),
      ).resolves.toMatchObject({ allowed: true });
      expect(await anchors(establisherProbe), kind).toEqual({ kind, principal: PRINCIPAL });
      await establisherProbe.query('COMMIT');
      expect((await storedKind(establisherProbe))[0]?.principal_kind, kind).toBe(kind);
    }
    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: null });
  });

  it('rejects missing, empty and out-of-set kinds with 22023', async () => {
    const rejected: (string | null)[] = [null, '', 'human', 'ROBOT'];
    for (const kind of rejected) {
      await establisherProbe.query('BEGIN');
      const outcome = await establishWithKind(establisherProbe, { principalKind: kind });
      expect(outcome.allowed, JSON.stringify(kind)).toBe(false);
      expect(outcome.code, JSON.stringify(kind)).toBe('22023');
      expect(outcome.message).toMatch(/invalid principal kind/);
      await establisherProbe.query('ROLLBACK');
      // A rejected attempt may not leave a usable context behind.
      expect(await anchors(establisherProbe), JSON.stringify(kind)).toEqual({
        kind: null,
        principal: null,
      });
    }
  });

  it('rejects an expired decision on both entries with 22023', async () => {
    await establisherProbe.query('BEGIN');
    const kindEntry = await establishWithKind(establisherProbe, { decisionExpiresInSeconds: -60 });
    expect(kindEntry).toMatchObject({ allowed: false, code: '22023' });
    expect(kindEntry.message).toMatch(/expired/);
    await establisherProbe.query('ROLLBACK');

    await establisherProbe.query('BEGIN');
    const legacyEntry = await establishLegacy(establisherProbe, {
      decisionExpiresInSeconds: -60,
    });
    expect(legacyEntry).toMatchObject({ allowed: false, code: '22023' });
    expect(legacyEntry.message).toMatch(/expired/);
    await establisherProbe.query('ROLLBACK');

    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: null });
  });

  it('is idempotent for the same kind and refuses a different or mixed context (40001)', async () => {
    await establisherProbe.query('BEGIN');
    await expect(establishWithKind(establisherProbe)).resolves.toMatchObject({ allowed: true });
    await expect(establishWithKind(establisherProbe)).resolves.toMatchObject({ allowed: true });
    // The identical replay left both anchors untouched.
    expect(await anchors(establisherProbe)).toEqual({ kind: 'HUMAN', principal: PRINCIPAL });

    const differentKind = await establishWithKind(establisherProbe, { principalKind: 'AGENT' });
    expect(differentKind.allowed).toBe(false);
    expect(differentKind.code).toBe('40001');
    expect(differentKind.message).toMatch(/platform_context_conflict/);
    await establisherProbe.query('ROLLBACK');

    // Legacy context first, then the kind-carrying entry: no kind may be
    // backfilled onto the existing row.
    await establisherProbe.query('BEGIN');
    await expect(establishLegacy(establisherProbe)).resolves.toMatchObject({ allowed: true });
    const kindOverLegacy = await establishWithKind(establisherProbe);
    expect(kindOverLegacy.allowed).toBe(false);
    expect(kindOverLegacy.code).toBe('40001');
    expect(kindOverLegacy.message).toMatch(/platform_context_conflict/);
    await establisherProbe.query('ROLLBACK');

    // Kind-carrying context first, then the legacy entry: the kind may not be
    // overwritten away either.
    await establisherProbe.query('BEGIN');
    await expect(establishWithKind(establisherProbe)).resolves.toMatchObject({ allowed: true });
    const legacyOverKind = await establishLegacy(establisherProbe);
    expect(legacyOverKind.allowed).toBe(false);
    expect(legacyOverKind.code).toBe('40001');
    expect(legacyOverKind.message).toMatch(/platform_context_conflict/);
    await establisherProbe.query('ROLLBACK');
  });

  it('returns NULL without context and after COMMIT, ROLLBACK and pool reuse', async () => {
    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: null });

    await establisherProbe.query('BEGIN');
    await expect(establishWithKind(establisherProbe)).resolves.toMatchObject({ allowed: true });
    await establisherProbe.query('COMMIT');
    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: null });

    await establisherProbe.query('BEGIN');
    await expect(
      establishWithKind(establisherProbe, { principalKind: 'SERVICE' }),
    ).resolves.toMatchObject({ allowed: true });
    await establisherProbe.query('ROLLBACK');
    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: null });

    // Pool reuse: a later transaction on the same backend never observes the
    // finished transaction's kind, and the next establishment removes the
    // residual row physically while refusing to reuse its kind.
    await establisherProbe.query('BEGIN');
    await expect(
      establishWithKind(establisherProbe, { principalKind: 'RUNTIME' }),
    ).resolves.toMatchObject({ allowed: true });
    await establisherProbe.query('ROLLBACK');
    expect(await storedKind(establisherProbe)).toHaveLength(1);

    await establisherProbe.query('BEGIN');
    expect(await anchors(establisherProbe)).toEqual({ kind: null, principal: null });
    await expect(
      establishWithKind(establisherProbe, { principalKind: 'EXTERNAL_PARTY' }),
    ).resolves.toMatchObject({ allowed: true });
    expect(await anchors(establisherProbe)).toEqual({
      kind: 'EXTERNAL_PARTY',
      principal: PRINCIPAL,
    });
    await establisherProbe.query('ROLLBACK');
  });

  it('keeps concurrent connections on their own kind', async () => {
    await establisherProbe.query('BEGIN');
    await secondProbe.query('BEGIN');
    await expect(
      establishWithKind(establisherProbe, { principalKind: 'HUMAN' }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      establishWithKind(secondProbe, { principalKind: 'RUNTIME' }),
    ).resolves.toMatchObject({
      allowed: true,
    });

    expect(await anchors(establisherProbe)).toEqual({ kind: 'HUMAN', principal: PRINCIPAL });
    expect(await anchors(secondProbe)).toEqual({ kind: 'RUNTIME', principal: PRINCIPAL });

    await establisherProbe.query('ROLLBACK');
    await secondProbe.query('ROLLBACK');
  });

  it('grants the kind helper to runtime roles and owners but neither establish entry', async () => {
    for (const role_ of READ_ROLES) {
      const privileges = await admin.query<{
        kind_helper: boolean;
        legacy_entry: boolean;
        kind_entry: boolean;
      }>(
        `SELECT has_function_privilege($1, $2, 'EXECUTE') AS kind_helper,
                has_function_privilege($1, $3, 'EXECUTE') AS legacy_entry,
                has_function_privilege($1, $4, 'EXECUTE') AS kind_entry`,
        [role_, PRINCIPAL_KIND_SIGNATURE, ESTABLISH_LEGACY_SIGNATURE, ESTABLISH_KIND_SIGNATURE],
      );
      expect(privileges.rows[0], `${role_} function ACL`).toEqual({
        kind_helper: true,
        legacy_entry: false,
        kind_entry: false,
      });
    }

    const establisher = await admin.query<{
      legacy_entry: boolean;
      kind_entry: boolean;
      kind_helper: boolean;
    }>(
      `SELECT has_function_privilege('platform_context_establisher', $1, 'EXECUTE') AS legacy_entry,
              has_function_privilege('platform_context_establisher', $2, 'EXECUTE') AS kind_entry,
              has_function_privilege('platform_context_establisher', $3, 'EXECUTE') AS kind_helper`,
      [ESTABLISH_LEGACY_SIGNATURE, ESTABLISH_KIND_SIGNATURE, PRINCIPAL_KIND_SIGNATURE],
    );
    expect(establisher.rows[0]).toEqual({
      legacy_entry: true,
      kind_entry: true,
      kind_helper: false,
    });

    for (const role_ of DENIED_READ_ROLES) {
      const privileges = await admin.query<{ kind_helper: boolean }>(
        `SELECT has_function_privilege($1, $2, 'EXECUTE') AS kind_helper`,
        [role_, PRINCIPAL_KIND_SIGNATURE],
      );
      expect(privileges.rows[0]?.kind_helper, `${role_} kind helper EXECUTE`).toBe(false);
    }

    for (const role_ of [...READ_ROLES, 'platform_context_establisher']) {
      const table = await admin.query<{
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>(
        `SELECT has_table_privilege($1, 'platform_security.tx_context', 'SELECT') AS can_select,
                has_table_privilege($1, 'platform_security.tx_context', 'INSERT') AS can_insert,
                has_table_privilege($1, 'platform_security.tx_context', 'UPDATE') AS can_update,
                has_table_privilege($1, 'platform_security.tx_context', 'DELETE') AS can_delete`,
        [role_],
      );
      expect(table.rows[0], `${role_} tx_context table ACL`).toEqual({
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      });
    }

    // The helper is executable by an ordinary runtime role without any
    // context; both write entries answer with 42501 on the wire.
    expect(await anchors(appProbe)).toEqual({ kind: null, principal: null });

    const deniedWrites: { sql: string; values: unknown[] }[] = [
      {
        sql: `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, now() + interval '1 hour', $5, ARRAY[$6]::uuid[], $7, NULL)`,
        values: [
          PRINCIPAL,
          ACTOR_SNAPSHOT,
          DECISION_A,
          DECISION_HASH,
          ENTERPRISE_A,
          PROJECT_A1,
          CORRELATION,
        ],
      },
      {
        sql: `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, 'HUMAN', $2, $3, $4, now() + interval '1 hour', $5, ARRAY[$6]::uuid[], $7, NULL)`,
        values: [
          PRINCIPAL,
          ACTOR_SNAPSHOT,
          DECISION_A,
          DECISION_HASH,
          ENTERPRISE_A,
          PROJECT_A1,
          CORRELATION,
        ],
      },
    ];
    for (const attempt of deniedWrites) {
      const outcome = await tryQuery(appProbe, attempt.sql, attempt.values);
      expect(outcome.allowed, attempt.sql).toBe(false);
      expect(outcome.code).toBe('42501');
      expect(outcome.message).toMatch(
        /permission denied for function establish_transaction_context/,
      );
      expect(await anchors(appProbe)).toEqual({ kind: null, principal: null });
    }

    // Owners are NOLOGIN, so the deployment session switches role explicitly
    // (the FORCE-RLS probe above does the same); the ACL denies both entries
    // to them on the wire as well.
    await admin.query('SET ROLE enterprise_project_owner');
    try {
      for (const attempt of deniedWrites) {
        const outcome = await tryQuery(admin, attempt.sql, attempt.values);
        expect(outcome.allowed, attempt.sql).toBe(false);
        expect(outcome.code).toBe('42501');
        expect(outcome.message).toMatch(
          /permission denied for function establish_transaction_context/,
        );
      }
    } finally {
      await admin.query('RESET ROLE');
    }
  });
});
