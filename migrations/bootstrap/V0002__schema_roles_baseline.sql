-- IM-02 WI-02: schema, role and least-privilege baseline (issue #30).
-- Runs as the migration superuser from the deployment job only. Creates the
-- NOLOGIN owner / app / dispatcher roles for the seven owning schemas plus
-- projection_app, audit_reader and migration_runner, pins the approved
-- extension set, and configures default privileges so future tables and
-- sequences are never implicitly exposed to PUBLIC or to other modules.
-- pgcrypto stays disabled (IM-DG-002 / IM-DG-003 pending).
-- Business tables, outbox tables and column-level dispatcher grants are WI-04.

-- ---------------------------------------------------------------------------
-- Extensions (Technology-Baseline §3): btree_gist for exclusion constraints,
-- pg_stat_statements for ops observation only. pg_stat_statements lives in
-- public but its views are restricted to superuser/pg_read_all_stats members
-- by default; no app/dispatcher role is added there, which is the intended
-- ops boundary. No other extension may be installed here.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ---------------------------------------------------------------------------
-- Roles. All roles are NOLOGIN: credentials are issued out-of-band (WI-03)
-- and application processes can never obtain an owner credential, because
-- owners cannot log in at all. No role created here is SUPERUSER, CREATEDB,
-- CREATEROLE, REPLICATION or BYPASSRLS.
-- ---------------------------------------------------------------------------

DO $roles$
DECLARE
    module TEXT;
    modules TEXT[] := ARRAY[
        'identity_policy',
        'enterprise_project',
        'task_execution',
        'artifact',
        'quality_governance',
        'release_publication',
        'integration_gateway'
    ];
BEGIN
    FOREACH module IN ARRAY modules LOOP
        -- Owning role: the only role allowed to create/alter/drop objects in
        -- its schema. NOINHERIT so members must SET ROLE explicitly.
        EXECUTE format(
            'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
            module || '_owner'
        );
        -- Runtime role: SELECT/INSERT/UPDATE on granted objects in its own
        -- schema only. Never an owner, never DELETE, never DDL.
        EXECUTE format(
            'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
            module || '_app'
        );
        -- Dispatcher role: claims/updates only its module's outbox delivery
        -- metadata. Table grants are column-level and land with the outbox
        -- tables (WI-04); the bootstrap only grants schema USAGE.
        EXECUTE format(
            'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS',
            module || '_dispatcher'
        );

        EXECUTE format('ALTER SCHEMA %I OWNER TO %I', module, module || '_owner');

        EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I, %I',
            module, module || '_app', module || '_dispatcher');

        -- Future objects created by the owner are private by default: PUBLIC
        -- gets nothing; the module's app role gets CRUD-without-DELETE plus
        -- sequence usage. Cross-schema access never appears, because default
        -- privileges are scoped to this schema only.
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC',
            module || '_owner', module);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT SELECT, INSERT, UPDATE ON TABLES TO %I',
            module || '_owner', module, module || '_app');
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM PUBLIC',
            module || '_owner', module);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO %I',
            module || '_owner', module, module || '_app');
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
            module || '_owner', module);
        EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO %I',
            module || '_owner', module, module || '_app');
    END LOOP;
END
$roles$;

-- Rebuildable projection schema: read model consumers get USAGE only; the
-- schema itself stays owned by the migration owner (no projection_owner role
-- by design, the schema is rebuilt, not migrated).
CREATE ROLE projection_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
GRANT USAGE ON SCHEMA projection TO projection_app;

-- Audit access: no schema USAGE and no table grants here. It may only ever
-- read masked views explicitly granted to it in later work items.
CREATE ROLE audit_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;

-- Migration runner: the single role allowed to act as any module owner, and
-- only inside the controlled migration flow. Application roles are never
-- members of any owner role, so SET ROLE <module>_owner is impossible for them.
CREATE ROLE migration_runner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOREPLICATION NOBYPASSRLS;
DO $membership$
DECLARE
    module TEXT;
    modules TEXT[] := ARRAY[
        'identity_policy',
        'enterprise_project',
        'task_execution',
        'artifact',
        'quality_governance',
        'release_publication',
        'integration_gateway'
    ];
BEGIN
    FOREACH module IN ARRAY modules LOOP
        EXECUTE format('GRANT %I TO migration_runner', module || '_owner');
    END LOOP;
END
$membership$;

-- ---------------------------------------------------------------------------
-- Public surface: PG 15+ already revokes CREATE on public from PUBLIC and on
-- the database from PUBLIC; it is restated here so the invariant is held by
-- the baseline itself, not by the image default.
-- ---------------------------------------------------------------------------

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $dbrevoke$
BEGIN
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', current_database());
END
$dbrevoke$;
