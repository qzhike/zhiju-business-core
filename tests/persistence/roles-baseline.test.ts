import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

// IM-02 WI-02 (issue #30): the schema/role least-privilege baseline is only
// proven against the real PostgreSQL provisioned by the persistence gate.
// Every denial below is asserted with the PostgreSQL error code and message
// produced by the server (42501 permission denied / must be owner), so the
// enforcement is demonstrated at the database layer, not in an app-side mock.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const MODULES = [
  'identity_policy',
  'enterprise_project',
  'task_execution',
  'artifact',
  'quality_governance',
  'release_publication',
  'integration_gateway',
] as const;

const EXPECTED_ROLES = MODULES.flatMap((module) => [
  `${module}_owner`,
  `${module}_app`,
  `${module}_dispatcher`,
]).concat(['projection_app', 'audit_reader', 'migration_runner']);

interface StatementOutcome {
  allowed: boolean;
  code?: string | undefined;
  message: string;
}

describe.skipIf(!gateEnabled)('schema and role least-privilege baseline (real PostgreSQL)', () => {
  let client: pg.Client;
  let appProbe: pg.Client;
  let migrationProbe: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();

    // Non-superuser probe sessions. SET ROLE boundaries can only be proven
    // from a session whose login user is not a superuser (superusers may
    // SET ROLE to anything). wi02_app_probe holds exactly the memberships a
    // runtime application process would get; wi02_migration_probe mirrors
    // the controlled migration flow.
    await client.query(
      `CREATE ROLE wi02_app_probe LOGIN PASSWORD 'wi02-app-probe'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await client.query(
      `CREATE ROLE wi02_migration_probe LOGIN PASSWORD 'wi02-migration-probe'
       NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    for (const module of MODULES) {
      await client.query(`GRANT ${pgIdentifier(`${module}_app`)} TO wi02_app_probe`);
    }
    await client.query('GRANT migration_runner TO wi02_migration_probe');
    appProbe = await connectAs('wi02_app_probe', 'wi02-app-probe');
    migrationProbe = await connectAs('wi02_migration_probe', 'wi02-migration-probe');

    // Probe objects created AS the module owner (SET ROLE), exactly the way
    // WI-04 module migrations will create tables. Default privileges from the
    // bootstrap therefore apply to them, which is what the matrix exercises.
    // The outbox column-level dispatcher grants mirror the contract WI-04
    // will ship: SELECT + UPDATE(delivery metadata) only.
    for (const module of MODULES) {
      await client.query(`SET ROLE ${pgIdentifier(`${module}_owner`)}`);
      await client.query(`CREATE TABLE ${pgIdentifier(module)}.business_probe (
        id uuid PRIMARY KEY,
        payload text NOT NULL,
        external_id text NOT NULL
      )`);
      await client.query(`CREATE TABLE ${pgIdentifier(module)}.outbox_probe (
        id uuid PRIMARY KEY,
        payload text NOT NULL,
        delivered_at timestamptz,
        delivery_attempts int NOT NULL DEFAULT 0
      )`);
      await client.query(
        `GRANT SELECT ON ${pgIdentifier(module)}.outbox_probe TO ${pgIdentifier(`${module}_dispatcher`)}`,
      );
      await client.query(
        `GRANT UPDATE (delivered_at, delivery_attempts) ON ${pgIdentifier(module)}.outbox_probe TO ${pgIdentifier(`${module}_dispatcher`)}`,
      );
      await client.query('RESET ROLE');
    }

    // Masked audit view probe for audit_reader: exposes the id only, never the
    // canonical payload or the sensitive external id.
    await client.query('SET ROLE identity_policy_owner');
    await client.query(
      'CREATE VIEW identity_policy.business_probe_masked AS SELECT id FROM identity_policy.business_probe',
    );
    await client.query('RESET ROLE');
    await client.query('GRANT USAGE ON SCHEMA identity_policy TO audit_reader');
    await client.query('GRANT SELECT ON identity_policy.business_probe_masked TO audit_reader');

    // Seed one row per module so UPDATE/DELETE probes have a target.
    for (const module of MODULES) {
      await client.query(
        `INSERT INTO ${pgIdentifier(module)}.business_probe (id, payload, external_id)
         VALUES (uuidv7(), 'canonical-payload', 'sensitive-external-id')`,
      );
      await client.query(
        `INSERT INTO ${pgIdentifier(module)}.outbox_probe (id, payload)
         VALUES (uuidv7(), 'event-payload')`,
      );
    }
  });

  afterAll(async () => {
    await appProbe.end();
    await migrationProbe.end();
    await client.end();
  });

  async function connectAs(user: string, password: string): Promise<pg.Client> {
    const url = new URL(databaseUrl ?? '');
    url.username = user;
    url.password = password;
    const connection = new pg.Client({ connectionString: url.toString() });
    await connection.connect();
    return connection;
  }

  /** Run one SQL statement under SET LOCAL ROLE <role> inside a transaction. */
  async function asRole(role: string, sql: string): Promise<StatementOutcome> {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL ROLE ${pgIdentifier(role)}`);
      try {
        await client.query(sql);
        return { allowed: true, message: 'ok' };
      } catch (error) {
        const pgError = error as pg.DatabaseError;
        return {
          allowed: false,
          code: pgError.code,
          message: pgError.message,
        };
      }
    } finally {
      await client.query('ROLLBACK');
    }
  }

  /** Run one SQL statement on a dedicated client, capturing the server error. */
  async function tryQuery(connection: pg.Client, sql: string): Promise<StatementOutcome> {
    try {
      await connection.query(sql);
      return { allowed: true, message: 'ok' };
    } catch (error) {
      const pgError = error as pg.DatabaseError;
      return { allowed: false, code: pgError.code, message: pgError.message };
    }
  }

  function expectDeniedByDatabase(outcome: StatementOutcome) {
    expect(outcome.allowed).toBe(false);
    expect(outcome.code).toBe('42501');
    expect(outcome.message).toMatch(/permission denied|must be owner/);
  }

  it('flyway history records the roles baseline migration', async () => {
    const result = await client.query<{ version: string; description: string; success: boolean }>(
      `SELECT version, description, success FROM public.flyway_schema_history WHERE version = '0002'`,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.description).toBe('schema roles baseline');
    expect(result.rows[0]?.success).toBe(true);
  });

  it('has exactly the authoritative role inventory, all NOLOGIN', async () => {
    const result = await client.query<{ rolname: string; rolcanlogin: boolean }>(
      'SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = ANY ($1::text[]) ORDER BY rolname',
      [EXPECTED_ROLES],
    );
    expect(result.rows.map((row) => row.rolname)).toEqual([...EXPECTED_ROLES].sort());
    expect(result.rows.every((row) => !row.rolcanlogin)).toBe(true);

    // No unexpected owner/app/dispatcher roles beyond the inventory.
    const pattern = await client.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles
       WHERE rolname ~ '_(owner|app|dispatcher)$' AND rolname !~ '^pg_' ORDER BY rolname`,
    );
    expect(pattern.rows.map((row) => row.rolname)).toEqual(
      MODULES.flatMap((module) => [`${module}_app`, `${module}_dispatcher`, `${module}_owner`])
        .concat(['projection_app'])
        .sort(),
    );
  });

  it('runtime and dispatcher roles hold no privileged attributes and no BYPASSRLS', async () => {
    const result = await client.query<{
      rolname: string;
      rolsuper: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
      rolbypassrls: boolean;
      rolreplication: boolean;
    }>(
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication
       FROM pg_roles WHERE rolname = ANY ($1::text[])`,
      [EXPECTED_ROLES],
    );
    expect(result.rows).toHaveLength(EXPECTED_ROLES.length);
    for (const role of result.rows) {
      expect(role.rolsuper, `${role.rolname} rolsuper`).toBe(false);
      expect(role.rolcreatedb, `${role.rolname} rolcreatedb`).toBe(false);
      expect(role.rolcreaterole, `${role.rolname} rolcreaterole`).toBe(false);
      expect(role.rolbypassrls, `${role.rolname} rolbypassrls`).toBe(false);
      expect(role.rolreplication, `${role.rolname} rolreplication`).toBe(false);
    }
  });

  it('only migration_runner is a member of owner roles, with SET-only membership', async () => {
    const result = await client.query<{
      member: string;
      owner: string;
      inherit_option: boolean;
      set_option: boolean;
    }>(
      `SELECT member.rolname AS member, owner_role.rolname AS owner,
              inherit_option, set_option
       FROM pg_auth_members
       JOIN pg_roles member ON member.oid = pg_auth_members.member
       JOIN pg_roles owner_role ON owner_role.oid = pg_auth_members.roleid
       WHERE owner_role.rolname LIKE '%_owner' ORDER BY member, owner`,
    );
    expect(result.rows).toHaveLength(MODULES.length);
    for (const row of result.rows) {
      expect(row.member).toBe('migration_runner');
      expect(row.inherit_option, `${row.owner} inherit_option`).toBe(false);
      expect(row.set_option, `${row.owner} set_option`).toBe(true);
    }

    // Application roles are not members of anything, so they can never become
    // an owner through group membership.
    const appMemberships = await client.query<{ member: string }>(
      `SELECT member.rolname AS member FROM pg_auth_members
       JOIN pg_roles member ON member.oid = pg_auth_members.member
       WHERE member.rolname LIKE '%_app'`,
    );
    expect(appMemberships.rows).toEqual([]);
  });

  it('installs exactly btree_gist and pg_stat_statements; pgcrypto stays disabled', async () => {
    const result = await client.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname = ANY ($1::text[]) ORDER BY extname`,
      [['btree_gist', 'pg_stat_statements', 'pgcrypto']],
    );
    expect(result.rows.map((row) => row.extname)).toEqual(['btree_gist', 'pg_stat_statements']);
  });

  it('closes the pg_stat_statements observation surface to every baseline role', async () => {
    // The extension's views/functions ship with PUBLIC ACLs; V0002 must have
    // revoked them so no runtime/dispatcher/audit/projection role can read
    // query statistics once the extension is preloaded in production.
    const roles = MODULES.flatMap((module) => [`${module}_app`, `${module}_dispatcher`]).concat([
      'projection_app',
      'audit_reader',
    ]);
    const result = await client.query<{
      rolname: string;
      view_select: boolean;
      info_select: boolean;
    }>(
      `SELECT rolname,
              has_table_privilege(rolname, 'public.pg_stat_statements', 'SELECT') AS view_select,
              has_table_privilege(rolname, 'public.pg_stat_statements_info', 'SELECT') AS info_select
       FROM pg_roles WHERE rolname = ANY ($1::text[])`,
      [roles],
    );
    expect(result.rows).toHaveLength(roles.length);
    for (const row of result.rows) {
      expect(row.view_select, `${row.rolname} SELECT on pg_stat_statements`).toBe(false);
      expect(row.info_select, `${row.rolname} SELECT on pg_stat_statements_info`).toBe(false);
    }

    expectDeniedByDatabase(
      await asRole('identity_policy_app', 'SELECT count(*) FROM public.pg_stat_statements'),
    );
    expectDeniedByDatabase(
      await asRole('audit_reader', 'SELECT * FROM public.pg_stat_statements_info'),
    );

    // The ops observation boundary: the predefined pg_read_all_stats role is
    // the only grantee besides superusers.
    const ops = await client.query<{ view_select: boolean; info_select: boolean }>(
      `SELECT has_table_privilege('pg_read_all_stats', 'public.pg_stat_statements', 'SELECT') AS view_select,
              has_table_privilege('pg_read_all_stats', 'public.pg_stat_statements_info', 'SELECT') AS info_select`,
    );
    expect(ops.rows[0]?.view_select).toBe(true);
    expect(ops.rows[0]?.info_select).toBe(true);
  });

  it('grants no CREATE on the public schema or the database to any baseline role', async () => {
    const result = await client.query<{
      rolname: string;
      schema_create: boolean;
      db_create: boolean;
    }>(
      `SELECT rolname,
              has_schema_privilege(rolname, 'public', 'CREATE') AS schema_create,
              has_database_privilege(rolname, current_database(), 'CREATE') AS db_create
       FROM pg_roles WHERE rolname = ANY ($1::text[])`,
      [EXPECTED_ROLES],
    );
    expect(result.rows).toHaveLength(EXPECTED_ROLES.length);
    for (const row of result.rows) {
      expect(row.schema_create, `${row.rolname} CREATE on public`).toBe(false);
      expect(row.db_create, `${row.rolname} CREATE on database`).toBe(false);
    }
  });

  describe.each(MODULES)('app role matrix for %s', (module) => {
    const other = module === 'identity_policy' ? 'enterprise_project' : 'identity_policy';
    const appRole = `${module}_app`;

    it('allows SELECT/INSERT/UPDATE on its own schema objects', async () => {
      await expect(
        asRole(appRole, `SELECT count(*) FROM ${module}.business_probe`),
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        asRole(
          appRole,
          `INSERT INTO ${module}.business_probe (id, payload, external_id) VALUES (uuidv7(), 'p', 'e')`,
        ),
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        asRole(appRole, `UPDATE ${module}.business_probe SET payload = 'p2' WHERE false`),
      ).resolves.toMatchObject({ allowed: true });
    });

    it('denies plain DELETE on its own schema', async () => {
      expectDeniedByDatabase(await asRole(appRole, `DELETE FROM ${module}.business_probe`));
    });

    it('denies DDL (DROP/ALTER) and CREATE TABLE even in its own schema', async () => {
      expectDeniedByDatabase(await asRole(appRole, `DROP TABLE ${module}.business_probe`));
      expectDeniedByDatabase(
        await asRole(appRole, `ALTER TABLE ${module}.business_probe ADD COLUMN x int`),
      );
      expectDeniedByDatabase(await asRole(appRole, `CREATE TABLE ${module}.app_created (id int)`));
    });

    it('denies cross-schema access to another owning schema', async () => {
      expectDeniedByDatabase(
        await asRole(
          appRole,
          `INSERT INTO ${other}.business_probe (id, payload, external_id) VALUES (uuidv7(), 'p', 'e')`,
        ),
      );
      expectDeniedByDatabase(await asRole(appRole, `SELECT count(*) FROM ${other}.business_probe`));
    });
  });

  describe.each(MODULES)('dispatcher role matrix for %s', (module) => {
    const dispatcher = `${module}_dispatcher`;

    it('allows claiming (SELECT) and updating delivery metadata of its outbox', async () => {
      await expect(
        asRole(dispatcher, `SELECT count(*) FROM ${module}.outbox_probe`),
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        asRole(
          dispatcher,
          `UPDATE ${module}.outbox_probe SET delivered_at = now(), delivery_attempts = delivery_attempts + 1 WHERE false`,
        ),
      ).resolves.toMatchObject({ allowed: true });
    });

    it('denies modifying the event payload or inserting into the outbox', async () => {
      expectDeniedByDatabase(
        await asRole(dispatcher, `UPDATE ${module}.outbox_probe SET payload = 'tampered'`),
      );
      expectDeniedByDatabase(
        await asRole(
          dispatcher,
          `INSERT INTO ${module}.outbox_probe (id, payload) VALUES (uuidv7(), 'p')`,
        ),
      );
    });

    it('denies reading or writing business tables', async () => {
      expectDeniedByDatabase(
        await asRole(dispatcher, `SELECT count(*) FROM ${module}.business_probe`),
      );
      expectDeniedByDatabase(
        await asRole(dispatcher, `UPDATE ${module}.business_probe SET payload = 'x' WHERE false`),
      );
    });
  });

  it('audit_reader reads only the masked view, never canonical payload or external id', async () => {
    await expect(
      asRole('audit_reader', 'SELECT id FROM identity_policy.business_probe_masked'),
    ).resolves.toMatchObject({ allowed: true });

    expectDeniedByDatabase(
      await asRole('audit_reader', 'SELECT payload FROM identity_policy.business_probe'),
    );
    expectDeniedByDatabase(
      await asRole('audit_reader', 'SELECT external_id FROM identity_policy.business_probe'),
    );
    expectDeniedByDatabase(
      await asRole('audit_reader', 'SELECT * FROM identity_policy.outbox_probe'),
    );

    // The masked view structurally exposes only the id.
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'identity_policy' AND table_name = 'business_probe_masked'`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(['id']);
  });

  it('runtime sessions cannot SET ROLE to any module owner; migration sessions can', async () => {
    // Proven from non-superuser sessions: the app login can assume any module
    // app role it is a member of, but never an owner role; the migration
    // login is the only baseline path to an owner identity.
    for (const module of MODULES) {
      await appProbe.query(`SET ROLE ${pgIdentifier(`${module}_app`)}`);
      await expect(
        tryQuery(appProbe, `SET ROLE ${pgIdentifier(`${module}_owner`)}`),
      ).resolves.toMatchObject({ allowed: false, code: '42501' });
      await appProbe.query('RESET ROLE');

      await migrationProbe.query(`SET ROLE ${pgIdentifier(`${module}_owner`)}`);
      await expect(tryQuery(migrationProbe, `SELECT current_user`)).resolves.toMatchObject({
        allowed: true,
      });
      await migrationProbe.query('RESET ROLE');
    }
  });

  it('migration login inherits no owner DDL; only SET ROLE produces owner-owned objects', async () => {
    // Regression for the inheritable-membership gap: with a plain grant of the
    // owner roles to migration_runner, a migration login could DDL directly as
    // itself (table owner = the login, default ACLs bypassed). The membership
    // must be SET-only, so DDL is denied until the explicit owner switch, and
    // objects created after the switch are owned by the module owner with the
    // owner's default privileges applied.
    await migrationProbe.query('SET ROLE migration_runner');
    const beforeSwitch = await tryQuery(
      migrationProbe,
      'CREATE TABLE identity_policy.migration_inherited_probe (id int)',
    );
    expect(beforeSwitch.allowed).toBe(false);
    expect(beforeSwitch.code).toBe('42501');
    await migrationProbe.query('RESET ROLE');

    await migrationProbe.query('SET ROLE identity_policy_owner');
    const created = await tryQuery(
      migrationProbe,
      'CREATE TABLE identity_policy.migration_owner_probe (id int)',
    );
    expect(created).toMatchObject({ allowed: true });
    await migrationProbe.query('RESET ROLE');

    const owner = await client.query<{ tableowner: string }>(
      `SELECT tableowner FROM pg_tables
       WHERE schemaname = 'identity_policy' AND tablename = 'migration_owner_probe'`,
    );
    expect(owner.rows[0]?.tableowner).toBe('identity_policy_owner');

    // Default privileges of the owner applied to the migrated object.
    await expect(
      asRole('identity_policy_app', 'SELECT count(*) FROM identity_policy.migration_owner_probe'),
    ).resolves.toMatchObject({ allowed: true });
    expectDeniedByDatabase(
      await asRole('identity_policy_app', 'DELETE FROM identity_policy.migration_owner_probe'),
    );
  });

  it('projection_app has USAGE on projection but no owning-schema access', async () => {
    const usage = await client.query<{ usage: boolean }>(
      `SELECT has_schema_privilege('projection_app', 'projection', 'USAGE') AS usage`,
    );
    expect(usage.rows[0]?.usage).toBe(true);

    expectDeniedByDatabase(
      await asRole('projection_app', 'SELECT count(*) FROM identity_policy.business_probe'),
    );
    expectDeniedByDatabase(
      await asRole('projection_app', 'CREATE TABLE projection.consumer_view (id int)'),
    );
  });
});

function pgIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}
