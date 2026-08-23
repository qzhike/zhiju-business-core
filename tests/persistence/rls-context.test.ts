import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

    it('records the RLS context migration in flyway history', async () => {
      const result = await admin.query<{ description: string; success: boolean }>(
        `SELECT description, success FROM public.flyway_schema_history WHERE version = '0003'`,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.description).toBe('platform rls context');
      expect(result.rows[0]?.success).toBe(true);
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
