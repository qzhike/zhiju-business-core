import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

// IM-02 WI-04 (issue #32): the seven per-module standard technical tables
// are reconciled against the PostgreSQL Logical Model §7 by an automated
// catalog test (missing or unexpected tables fail), and the key database
// guarantees are exercised on real PostgreSQL: idempotency / consumer-event /
// active-process uniqueness adjudicated by constraints, append-only audit and
// immutable event payloads enforced by privileges, the outbox scope mirror
// guard, and the column-level dispatcher surface.

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

const TECHNICAL_TABLES = [
  'command_receipt',
  'outbox_event',
  'inbox_message',
  'process_instance',
  'process_step',
  'audit_record',
  'reference_edge',
  'contract_violation',
] as const;

const PLATFORM_TABLES = [
  'platform_command_receipt',
  'platform_outbox_event',
  'platform_audit_record',
] as const;

// Probe fixtures created by other gate test files (roles-baseline,
// rls-context). They are tolerated so this catalog stays robust against test
// execution order; anything beyond expected+fixtures fails as an unexpected
// (e.g. accidentally shared) table.
const FIXTURE_TABLES: Record<string, string[]> = {
  identity_policy: [
    'business_probe',
    'outbox_probe',
    'business_probe_masked',
    'migration_owner_probe',
    // WI-05 (issue #33) core model + WI-07 (issue #35) bootstrap claim.
    'bootstrap_claim',
    // WI-05 (issue #33) core model tables, owned by the same schema.
    'principal',
    'principal_state_transition',
    'external_identity_link',
    'role_assignment',
    'role_revocation',
    'capability_grant',
    'capability_revocation',
    'policy_snapshot',
    'actor_snapshot',
    'authorization_decision',
  ],
  enterprise_project: [
    'business_probe',
    'outbox_probe',
    'wi03_enterprise_probe',
    'wi03_project_probe',
    'wi04_project_probe',
    // IM-03 WI-03 (issue #59) business aggregates landed by V2001; they live
    // under the same owning schema as the WI-02 technical tables but the
    // technical-tables catalog test only enumerates the WI-02 set.
    'enterprise',
    'enterprise_fact',
    'enterprise_fact_version',
    'enterprise_profile_snapshot',
    'product',
    'product_version',
    'product_scope_snapshot',
    'qms_configuration',
    'qms_configuration_revision',
    // IM-03 WI-04 (issue #60): Project Aggregate, ProjectScopeClaim and
    // ProjectSnapshotBinding tables. They are Project-owned business tables
    // and must be listed here so the technical-tables catalog does not flag
    // them as unexpected shared tables.
    'project',
    'project_scope_claim',
    'project_snapshot_binding',
    // IM-03 WI-05 (issue #61): Project-owned SourceMaterial custody tables.
    'source_material',
    'source_material_origin',
    'source_material_validation',
    // IM-03 WI-06 (issue #62): Project-owned CustomerMaterial tables.
    'customer_material',
    'customer_material_version',
    'customer_material_decision',
    // IM-03 WI-07 (issue #63): Project-owned CustomerBaseline lifecycle and
    // append-only impact review tables.
    'customer_baseline',
    'customer_baseline_version',
    'customer_baseline_item',
    'customer_baseline_impact_review',
    // IM-03 WI-08 (issue #64): Platform Reference and Project-owned
    // TemplateBaseline/RegulatoryProfile business tables.
    'reference_template',
    'reference_template_version',
    'regulatory_reference',
    'regulatory_reference_version',
    'template_baseline',
    'template_baseline_version',
    'template_selection',
    'regulatory_profile',
    'regulatory_profile_version',
    'regulatory_profile_item',
    // IM-03 WI-09 (issue #65): Project-owned GapAnalysis input, version,
    // finding and Human decision facts.
    'gap_analysis',
    'gap_analysis_input_snapshot',
    'gap_analysis_version',
    'gap_finding',
    'gap_analysis_decision',
    // IM-03 WI-10 (issue #66): Project-owned DeliveryPlan/DeliveryItem facts.
    'delivery_plan',
    'delivery_plan_version',
    'delivery_item',
    // IM-03 WI-12 (issue #68): formal completion facts, derived evaluations
    // and append-only impact history.
    'delivery_item_completion_fact',
    'delivery_item_completion_evaluation',
    'delivery_item_impact_review',
    'delivery_item_artifact_requirement',
    'delivery_item_dependency',
    'delivery_plan_decision',
  ],
  task_execution: ['business_probe', 'outbox_probe'],
  artifact: [
    'business_probe',
    'outbox_probe',
    // IM-04 WI-03 (issue #92): Artifact Root and default Branch.
    'artifact',
    'artifact_branch',
    // IM-04 WI-04 (issue #93): Canonical Content Object lifecycle facts.
    'artifact_content_object',
    'artifact_content_object_link',
    'artifact_content_object_quarantine',
    'artifact_content_object_orphan',
    // IM-04 WI-05 (issue #94): immutable Revision, lineage, conflict and
    // append-only governance facts.
    'artifact_revision',
    'revision_parent',
    'revision_conflict',
    'revision_withdrawal',
    'revision_invalidation',
    // IM-04 WI-08 (issue #97): immutable Representation and its verified
    // public RenderAttempt binding fact.
    'representation',
    'representation_validation',
  ],
  quality_governance: [
    'business_probe',
    'outbox_probe',
    // IM-05 WI-02 (issue #122): immutable Evidence custody and versioned
    // QualityProfile business tables are owned by this schema.
    'evidence',
    'evidence_validation',
    'evidence_revocation',
    'evidence_link',
    'quality_profile',
    'quality_profile_version',
    'quality_profile_gate_spec',
    'quality_profile_gate_dependency',
    'quality_profile_approval_requirement',
    'quality_profile_release_requirement',
    // IM-05 WI-03 (issue #123): immutable ChangeImpact/GateResult facts,
    // invalidation history, reuse facts, and readiness snapshots.
    'change_impact',
    'gate_result',
    'gate_result_reuse',
    'gate_invalidation',
    'revision_acceptance_snapshot',
    'release_readiness_snapshot',
    // IM-05 WI-04 (issue #124): immutable ReviewIssue remediation, Human
    // Approval, revocation, and ApprovalBundleSnapshot facts.
    'review_issue',
    'issue_observation',
    'resolution_proposal',
    'verification_record',
    'issue_state_transition',
    'approval_request',
    'approval',
    'approval_decision',
    'approval_revocation',
    'approval_bundle_snapshot',
  ],
  release_publication: ['business_probe', 'outbox_probe'],
  integration_gateway: [
    'business_probe',
    'outbox_probe',
    // IM-05 WI-05 (issue #125): owning Renderer business facts.
    'render_attempt',
    'raw_external_receipt',
  ],
};

const ENTERPRISE_A = '11111111-1111-7111-8111-1111111111a1';
const PROJECT_A1 = '33333333-3333-7333-8333-3333333333c1';
const PROJECT_A2 = '44444444-4444-7444-8444-4444444444d2';
const PRINCIPAL = '55555555-5555-7555-8555-5555555555e1';
const ACTOR_SNAPSHOT = '66666666-6666-7666-8666-6666666666f1';
const DECISION = '77777777-7777-7777-8777-7777777777a1';
const DECISION_HASH = Buffer.alloc(32, 0xcd);
const CORRELATION = '88888888-8888-7888-8888-8888888888a1';
const COMMITTED_EVENT = 'eeeeeee1-0000-7000-8000-000000000001';
const HASH32 = Buffer.alloc(32, 0xef);

interface StatementOutcome {
  allowed: boolean;
  code?: string | undefined;
  message: string;
}

describe.skipIf(!gateEnabled)(
  'standard technical tables catalog and constraints (real PostgreSQL)',
  () => {
    let admin: pg.Client;
    let epApp: pg.Client;
    let ipApp: pg.Client;
    let epDispatcher: pg.Client;
    let auditReader: pg.Client;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();

      await admin.query(
        `CREATE ROLE wi04_probe_ep LOGIN PASSWORD 'wi04-probe-ep' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(
        `GRANT platform_context_establisher, enterprise_project_app TO wi04_probe_ep`,
      );
      await admin.query(
        `CREATE ROLE wi04_probe_ip LOGIN PASSWORD 'wi04-probe-ip' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(`GRANT platform_context_establisher, identity_policy_app TO wi04_probe_ip`);
      await admin.query(
        `CREATE ROLE wi04_probe_disp LOGIN PASSWORD 'wi04-probe-disp' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(`GRANT enterprise_project_dispatcher TO wi04_probe_disp`);
      await admin.query(
        `CREATE ROLE wi04_probe_reader LOGIN PASSWORD 'wi04-probe-reader' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query(`GRANT audit_reader TO wi04_probe_reader`);

      epApp = await connectAs('wi04_probe_ep', 'wi04-probe-ep');
      ipApp = await connectAs('wi04_probe_ip', 'wi04-probe-ip');
      epDispatcher = await connectAs('wi04_probe_disp', 'wi04-probe-disp');
      auditReader = await connectAs('wi04_probe_reader', 'wi04-probe-reader');
    });

    afterAll(async () => {
      await epApp.end();
      await ipApp.end();
      await epDispatcher.end();
      await auditReader.end();
      await admin.end();
    });

    async function connectAs(user: string, password: string): Promise<pg.Client> {
      const url = new URL(databaseUrl ?? '');
      url.username = user;
      url.password = password;
      const connection = new pg.Client({ connectionString: url.toString() });
      await connection.connect();
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

    async function establishContext(
      connection: pg.Client,
      allowedProjectIds: string[] = [PROJECT_A1],
      runtimeRole: 'enterprise_project_app' | 'identity_policy_app' = 'enterprise_project_app',
    ): Promise<void> {
      await connection.query('SET LOCAL ROLE platform_context_establisher');
      const outcome = await tryQuery(
        connection,
        `SELECT platform_security.establish_transaction_context(
         'REQUEST', $1, $2, $3, $4, now() + interval '1 hour', $5, $6, $7, NULL)`,
        [
          PRINCIPAL,
          ACTOR_SNAPSHOT,
          DECISION,
          DECISION_HASH,
          ENTERPRISE_A,
          allowedProjectIds,
          CORRELATION,
        ],
      );
      expect(outcome).toMatchObject({ allowed: true });
      await connection.query(`SET LOCAL ROLE ${runtimeRole}`);
    }

    // -------------------------------------------------------------------------
    // Catalog reconciliation
    // -------------------------------------------------------------------------

    it('migrations V1000..V7000 are recorded and successful', async () => {
      const result = await admin.query<{ version: string; success: boolean }>(
        `SELECT version, success FROM public.flyway_schema_history
       WHERE version IN ('1000','2000','3000','4000','5000','6000','7000') ORDER BY version`,
      );
      expect(result.rows.map((row) => row.version)).toEqual([
        '1000',
        '2000',
        '3000',
        '4000',
        '5000',
        '6000',
        '7000',
      ]);
      expect(result.rows.every((row) => row.success)).toBe(true);
    });

    it('owns exactly the expected technical tables per module (no missing, no shared extras)', async () => {
      for (const module of MODULES) {
        const expected: string[] = [...TECHNICAL_TABLES];
        if (module === 'identity_policy') {
          expected.push(...PLATFORM_TABLES);
        }
        const allowed = new Set([...expected, ...(FIXTURE_TABLES[module] ?? [])]);
        const result = await admin.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
          [module],
        );
        const found = result.rows.map((row) => row.table_name);
        for (const table of expected) {
          expect(found, `${module}.${table} exists`).toContain(table);
        }
        for (const table of found) {
          expect(allowed.has(table), `${module}.${table} is expected or a known fixture`).toBe(
            true,
          );
        }
      }
    });

    it('creates every technical table owned by the module owner with ENABLE + FORCE RLS', async () => {
      for (const module of MODULES) {
        const tables: string[] = [...TECHNICAL_TABLES];
        if (module === 'identity_policy') {
          tables.push(...PLATFORM_TABLES);
        }
        for (const table of tables) {
          const result = await admin.query<{ owner: string; rls: boolean; force: boolean }>(
            `SELECT pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls,
                    c.relforcerowsecurity AS force
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`,
            [module, table],
          );
          expect(result.rows, `${module}.${table}`).toHaveLength(1);
          expect(result.rows[0]?.owner, `${module}.${table} owner`).toBe(`${module}_owner`);
          expect(result.rows[0]?.rls, `${module}.${table} RLS`).toBe(true);
          expect(result.rows[0]?.force, `${module}.${table} FORCE RLS`).toBe(true);
        }
      }
    });

    it('uses project-aware RLS for every nullable-scope technical table', async () => {
      for (const module of MODULES) {
        const app = `${module}_app`;
        for (const table of TECHNICAL_TABLES) {
          const policies = await admin.query<{ qual: string | null; with_check: string | null }>(
            `SELECT qual, with_check
               FROM pg_policies
              WHERE schemaname = $1 AND tablename = $2 AND $3 = ANY (roles)`,
            [module, table, app],
          );
          expect(policies.rows.length, `${module}.${table} app policies`).toBeGreaterThan(0);
          for (const expression of policies.rows.flatMap((row) => [row.qual, row.with_check])) {
            if (expression === null) continue;
            expect(expression, `${module}.${table} nullable project branch`).toContain(
              'project_id IS NULL',
            );
            expect(expression, `${module}.${table} project helper`).toContain(
              'context_allows_project',
            );
          }
        }
      }
    });

    it('carries the unique constraints adjudicated by the database', async () => {
      for (const module of MODULES) {
        const expectIndex = async (indexName: string, tableName: string) => {
          const result = await admin.query<{ found: boolean }>(
            `SELECT EXISTS (
             SELECT 1 FROM pg_index i
             JOIN pg_class c ON c.oid = i.indexrelid
             JOIN pg_class t ON t.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             WHERE n.nspname = $1 AND t.relname = $2 AND c.relname = $3) AS found`,
            [module, tableName, indexName],
          );
          expect(result.rows[0]?.found, `${module}: ${indexName} on ${tableName}`).toBe(true);
        };
        await expectIndex('command_receipt_idem_unique', 'command_receipt');
        await expectIndex('inbox_message_pkey', 'inbox_message');
        await expectIndex('process_instance_active_unique', 'process_instance');
        await expectIndex('process_step_unique', 'process_step');
        await expectIndex('reference_edge_unique', 'reference_edge');
        if (module === 'identity_policy') {
          await expectIndex('platform_receipt_idem_unique', 'platform_command_receipt');
        }
      }

      // The active-process uniqueness is a partial index over ACTIVE only.
      const partial = await admin.query<{ predicate: string | null }>(
        `SELECT pg_get_expr(i.indpred, i.indrelid) AS predicate
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'process_instance_active_unique'`,
      );
      expect(partial.rows[0]?.predicate).toMatch(/ACTIVE/);
    });

    it('grants the app role CRUD-without-DELETE and immutability on append-only tables', async () => {
      for (const module of MODULES) {
        const app = `${module}_app`;
        const tables: string[] = [...TECHNICAL_TABLES];
        if (module === 'identity_policy') {
          tables.push(...PLATFORM_TABLES);
        }
        const updateAllowed = new Set(
          module === 'identity_policy'
            ? ['command_receipt', 'inbox_message', 'process_instance', 'platform_command_receipt']
            : ['command_receipt', 'inbox_message', 'process_instance'],
        );
        for (const table of tables) {
          expect(
            await admin.query<{ can: boolean }>(
              `SELECT has_table_privilege($1, $2, 'SELECT') AS can`,
              [app, `${module}.${table}`],
            ),
          ).toMatchObject({ rows: [{ can: true }] });
          expect(
            await admin.query<{ can: boolean }>(
              `SELECT has_table_privilege($1, $2, 'INSERT') AS can`,
              [app, `${module}.${table}`],
            ),
          ).toMatchObject({ rows: [{ can: true }] });
          const update = await admin.query<{ can: boolean }>(
            `SELECT has_table_privilege($1, $2, 'UPDATE') AS can`,
            [app, `${module}.${table}`],
          );
          expect(update.rows[0]?.can, `${app} UPDATE on ${module}.${table}`).toBe(
            updateAllowed.has(table),
          );
          const del = await admin.query<{ can: boolean }>(
            `SELECT has_table_privilege($1, $2, 'DELETE') AS can`,
            [app, `${module}.${table}`],
          );
          expect(del.rows[0]?.can, `${app} DELETE on ${module}.${table}`).toBe(false);
        }
      }
    });

    it('restricts the dispatcher to outbox delivery metadata columns only', async () => {
      for (const module of MODULES) {
        const dispatcher = `${module}_dispatcher`;
        const outbox = module === 'identity_policy' ? 'platform_outbox_event' : 'outbox_event';

        const select = await admin.query<{ can: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS can`,
          [dispatcher, `${module}.${outbox}`],
        );
        expect(select.rows[0]?.can).toBe(true);

        const insert = await admin.query<{ can: boolean }>(
          `SELECT has_table_privilege($1, $2, 'INSERT') AS can`,
          [dispatcher, `${module}.${outbox}`],
        );
        expect(insert.rows[0]?.can).toBe(false);

        for (const column of [
          'payload',
          'payload_hash',
          'event_id',
          'event_type',
          'aggregate_version',
        ]) {
          const col = await admin.query<{ can: boolean }>(
            `SELECT has_column_privilege($1, $2, $3, 'UPDATE') AS can`,
            [dispatcher, `${module}.${outbox}`, column],
          );
          expect(col.rows[0]?.can, `${dispatcher} UPDATE ${column}`).toBe(false);
        }
        for (const column of ['delivery_state', 'attempt_count', 'lease_owner', 'published_at']) {
          const col = await admin.query<{ can: boolean }>(
            `SELECT has_column_privilege($1, $2, $3, 'UPDATE') AS can`,
            [dispatcher, `${module}.${outbox}`, column],
          );
          expect(col.rows[0]?.can, `${dispatcher} UPDATE ${column}`).toBe(true);
        }

        for (const table of TECHNICAL_TABLES.filter((t) => t !== 'outbox_event')) {
          const read = await admin.query<{ can: boolean }>(
            `SELECT has_table_privilege($1, $2, 'SELECT') AS can`,
            [dispatcher, `${module}.${table}`],
          );
          expect(read.rows[0]?.can, `${dispatcher} SELECT ${module}.${table}`).toBe(false);
        }
      }
    });

    it('exposes audit rows to audit_reader only through masked views', async () => {
      for (const module of MODULES) {
        const masked = await admin.query<{ can: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS can`,
          ['audit_reader', `${module}.audit_record_masked`],
        );
        expect(masked.rows[0]?.can, `audit_reader SELECT ${module}.audit_record_masked`).toBe(true);
        const direct = await admin.query<{ can: boolean }>(
          `SELECT has_table_privilege($1, $2, 'SELECT') AS can`,
          ['audit_reader', `${module}.audit_record`],
        );
        expect(direct.rows[0]?.can).toBe(false);
      }
      const platformMasked = await admin.query<{ can: boolean }>(
        `SELECT has_table_privilege($1, 'identity_policy.platform_audit_record_masked', 'SELECT') AS can`,
        ['audit_reader'],
      );
      expect(platformMasked.rows[0]?.can).toBe(true);

      const auditId = '12345678-1234-7123-8123-444444444441';
      const platformAuditId = '12345678-1234-7123-8123-444444444442';
      await admin.query(
        `INSERT INTO enterprise_project.audit_record (
           audit_id, enterprise_id, project_id, principal_id, actor_snapshot_id,
           authorization_decision_id, command_type, outcome, correlation_id, retention_class)
         VALUES ($1, $2, $3, $4, $4, $4, 'demo.audit', 'COMMITTED', $5, 'REGULATED_AUDIT')`,
        [auditId, ENTERPRISE_A, PROJECT_A1, PRINCIPAL, CORRELATION],
      );
      await admin.query(
        `INSERT INTO identity_policy.platform_audit_record (
           audit_id, principal_id, actor_snapshot_id, authorization_decision_id,
           command_type, outcome, correlation_id, retention_class)
         VALUES ($1, $2, $2, $2, 'demo.platform.audit', 'COMMITTED', $3, 'REGULATED_AUDIT')`,
        [platformAuditId, PRINCIPAL, CORRELATION],
      );

      // Live: committed rows are visible through the masked surfaces.
      const maskedRow = await auditReader.query<{ audit_id: string }>(
        `SELECT audit_id FROM enterprise_project.audit_record_masked WHERE audit_id = $1`,
        [auditId],
      );
      expect(maskedRow.rows).toEqual([{ audit_id: auditId }]);
      const platformRow = await auditReader.query<{ audit_id: string }>(
        `SELECT audit_id FROM identity_policy.platform_audit_record_masked WHERE audit_id = $1`,
        [platformAuditId],
      );
      expect(platformRow.rows).toEqual([{ audit_id: platformAuditId }]);

      // The reader still has no table-level or sensitive-column access.
      const direct = await tryQuery(
        auditReader,
        `SELECT count(*) FROM enterprise_project.audit_record`,
      );
      expect(direct.allowed).toBe(false);
      expect(direct.code).toBe('42501');
      const sensitive = await tryQuery(
        auditReader,
        `SELECT safe_summary FROM enterprise_project.audit_record WHERE audit_id = $1`,
        [auditId],
      );
      expect(sensitive.allowed).toBe(false);
      expect(sensitive.code).toBe('42501');
    });

    // -------------------------------------------------------------------------
    // Behavior on real PostgreSQL (enterprise_project + identity_policy probes)
    // -------------------------------------------------------------------------

    it('rejects technical writes without an RLS context', async () => {
      const outcome = await tryQuery(
        epApp,
        `INSERT INTO enterprise_project.command_receipt (
         command_id, command_type, command_version, idempotency_scope, idempotency_key,
         request_payload_hash, enterprise_id, target_type, target_id, outcome,
         correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
       VALUES (uuidv7(), 'demo.command', '1.0', 'scope', $1, $2, $3, 'Demo', uuidv7(),
               'PENDING', $4, $5, $5, $5)`,
        ['key-1', HASH32, ENTERPRISE_A, CORRELATION, PRINCIPAL],
      );
      expect(outcome.allowed).toBe(false);
      expect(outcome.code).toBe('42501');
      expect(outcome.message).toMatch(/row-level security/);
    });

    it('rejects same-enterprise rows outside the allowed project scope', async () => {
      const hiddenCommandId = '12345678-1234-7123-8123-444444444443';
      await admin.query(
        `INSERT INTO enterprise_project.command_receipt (
           command_id, command_type, command_version, idempotency_scope, idempotency_key,
           request_payload_hash, enterprise_id, project_id, target_type, target_id, outcome,
           correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
         VALUES ($1, 'demo.command', '1.0', 'scope-probe', 'hidden-a2', $2, $3, $4,
                 'Demo', uuidv7(), 'PENDING', $5, $6, $6, $6)`,
        [hiddenCommandId, HASH32, ENTERPRISE_A, PROJECT_A2, CORRELATION, PRINCIPAL],
      );

      await epApp.query('BEGIN');
      try {
        await establishContext(epApp, [PROJECT_A1]);
        const hidden = await epApp.query<{ count: string }>(
          `SELECT count(*) AS count FROM enterprise_project.command_receipt WHERE command_id = $1`,
          [hiddenCommandId],
        );
        expect(hidden.rows[0]?.count).toBe('0');

        const denied = await tryQuery(
          epApp,
          `INSERT INTO enterprise_project.command_receipt (
             command_id, command_type, command_version, idempotency_scope, idempotency_key,
             request_payload_hash, enterprise_id, project_id, target_type, target_id, outcome,
             correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
           VALUES (uuidv7(), 'demo.command', '1.0', 'scope-probe', 'write-a2', $1, $2, $3,
                   'Demo', uuidv7(), 'PENDING', $4, $5, $5, $5)`,
          [HASH32, ENTERPRISE_A, PROJECT_A2, CORRELATION, PRINCIPAL],
        );
        expect(denied.allowed).toBe(false);
        expect(denied.code).toBe('42501');
      } finally {
        await epApp.query('ROLLBACK');
      }
    });

    it('adjudicates duplicate idempotency keys with the unique constraint', async () => {
      const insertReceipt = (connection: pg.Client, key: string) =>
        tryQuery(
          connection,
          `INSERT INTO enterprise_project.command_receipt (
           command_id, command_type, command_version, idempotency_scope, idempotency_key,
           request_payload_hash, enterprise_id, target_type, target_id, outcome,
           correlation_id, created_by_principal_id, actor_snapshot_id, authorization_decision_id)
         VALUES (uuidv7(), 'demo.command', '1.0', 'wi04-scope', $1, $2, $3, 'Demo', uuidv7(),
                 'PENDING', $4, $5, $5, $5)`,
          [key, HASH32, ENTERPRISE_A, CORRELATION, PRINCIPAL],
        );

      // Concurrent claim: both transactions establish a context and insert the
      // same idempotency key; the database admits exactly one.
      const second = await connectAs('wi04_probe_ep', 'wi04-probe-ep');
      try {
        const run = async (connection: pg.Client) => {
          await connection.query('BEGIN');
          await establishContext(connection);
          const outcome = await insertReceipt(connection, 'concurrent-key');
          if (outcome.allowed) {
            await connection.query('COMMIT');
          } else {
            await connection.query('ROLLBACK');
          }
          return outcome;
        };
        const [first, other] = await Promise.all([run(epApp), run(second)]);
        const successes = [first, other].filter((o) => o.allowed).length;
        expect(successes).toBe(1);
        const loser = [first, other].find((o) => !o.allowed);
        expect(loser?.code).toBe('23505');

        // Sequential replay of the same scope/key is also rejected by the
        // constraint (the application reads the saved result instead).
        await epApp.query('BEGIN');
        await establishContext(epApp);
        const duplicate = await insertReceipt(epApp, 'concurrent-key');
        expect(duplicate.code).toBe('23505');
        await epApp.query('ROLLBACK');
      } finally {
        await second.end();
      }
    });

    /** Run one scenario inside a fresh transaction with an established context. */
    async function inContextTx(connection: pg.Client, body: () => Promise<void>): Promise<void> {
      await connection.query('BEGIN');
      try {
        await establishContext(connection);
        await body();
      } finally {
        await connection.query('ROLLBACK');
      }
    }

    it('enforces consumer+event uniqueness and the active process correlation rule', async () => {
      const insertInbox = (connection: pg.Client, consumer: string, eventId: string) =>
        tryQuery(
          connection,
          `INSERT INTO enterprise_project.inbox_message (
           consumer_name, event_id, event_type, event_version, payload_hash, source_module,
           enterprise_id, status, correlation_id, created_by_principal_id)
         VALUES ($1, $2, 'demo.event', '1.0', $3, 'identity_policy', $4, 'PENDING', $5, $6)`,
          [consumer, eventId, HASH32, ENTERPRISE_A, CORRELATION, PRINCIPAL],
        );
      await inContextTx(epApp, async () => {
        await expect(
          insertInbox(epApp, 'demo-consumer', '12345678-1234-7123-8123-111111111111'),
        ).resolves.toMatchObject({ allowed: true });
        // Replaying the same consumer+event id inside the transaction is
        // adjudicated by the primary key; the aborted statement ends the
        // scenario (nothing may follow it in this transaction).
        const duplicateEvent = await insertInbox(
          epApp,
          'demo-consumer',
          '12345678-1234-7123-8123-111111111111',
        );
        expect(duplicateEvent.code).toBe('23505');
      });

      const insertProcess = (id: string, state: string) =>
        tryQuery(
          epApp,
          `INSERT INTO enterprise_project.process_instance (
           process_id, process_type, process_version, correlation_key, enterprise_id, state,
           created_by_principal_id)
         VALUES ($1, 'demo.process', '1.0', 'corr-1', $2, $3, $4)`,
          [id, ENTERPRISE_A, state, PRINCIPAL],
        );
      await inContextTx(epApp, async () => {
        await expect(
          insertProcess('12345678-1234-7123-8123-222222222221', 'ACTIVE'),
        ).resolves.toMatchObject({ allowed: true });
        // A non-active instance with the same correlation is fine.
        await expect(
          insertProcess('12345678-1234-7123-8123-222222222223', 'COMPLETED'),
        ).resolves.toMatchObject({ allowed: true });
        // Second ACTIVE instance with the same correlation is rejected by the
        // partial unique index; the aborted statement ends the scenario.
        const secondActive = await insertProcess('12345678-1234-7123-8123-222222222222', 'ACTIVE');
        expect(secondActive.code).toBe('23505');
      });
      await inContextTx(epApp, async () => {
        // Completing the active instance releases the correlation for a new one.
        await expect(
          insertProcess('12345678-1234-7123-8123-222222222225', 'ACTIVE'),
        ).resolves.toMatchObject({ allowed: true });
        await epApp.query(
          `UPDATE enterprise_project.process_instance SET state = 'COMPLETED', updated_at = now()
           WHERE process_id = '12345678-1234-7123-8123-222222222225'`,
        );
        await expect(
          insertProcess('12345678-1234-7123-8123-222222222224', 'ACTIVE'),
        ).resolves.toMatchObject({ allowed: true });
      });
    });

    it('requires process steps to mirror the parent process scope', async () => {
      await epApp.query('BEGIN');
      try {
        await establishContext(epApp, [PROJECT_A1, PROJECT_A2]);
        const processId = '12345678-1234-7123-8123-444444444444';
        await epApp.query(
          `INSERT INTO enterprise_project.process_instance (
             process_id, process_type, process_version, correlation_key,
             enterprise_id, project_id, state, created_by_principal_id)
           VALUES ($1, 'demo.process', '1.0', 'scope-mirror', $2, $3, 'ACTIVE', $4)`,
          [processId, ENTERPRISE_A, PROJECT_A1, PRINCIPAL],
        );
        const mismatched = await tryQuery(
          epApp,
          `INSERT INTO enterprise_project.process_step (
             process_step_id, process_id, step_no, enterprise_id, project_id,
             outcome, created_by_principal_id)
           VALUES (uuidv7(), $1, 1, $2, $3, 'STARTED', $4)`,
          [processId, ENTERPRISE_A, PROJECT_A2, PRINCIPAL],
        );
        expect(mismatched.allowed).toBe(false);
        expect(mismatched.code).toBe('23514');
        expect(mismatched.message).toMatch(/process step scope mismatch/);
      } finally {
        await epApp.query('ROLLBACK');
      }
    });

    it('distinguishes reference edges from different owner versions', async () => {
      await epApp.query('BEGIN');
      try {
        await establishContext(epApp);
        const insertEdge = (ownerVersionId: string) =>
          tryQuery(
            epApp,
            `INSERT INTO enterprise_project.reference_edge (
               owner_object_type, owner_object_id, owner_version_id, reference_path,
               target_module, target_object_type, target_object_id, target_version_id,
               reference_purpose, enterprise_id, source_command_id)
             VALUES ('Demo', $1, $2, '/target', 'artifact', 'Artifact', $3, $4,
                     'TRACE', $5, $6)`,
            [
              '12345678-1234-7123-8123-444444444445',
              ownerVersionId,
              '12345678-1234-7123-8123-444444444446',
              '12345678-1234-7123-8123-444444444447',
              ENTERPRISE_A,
              '12345678-1234-7123-8123-444444444448',
            ],
          );
        const versionA = '12345678-1234-7123-8123-444444444449';
        const versionB = '12345678-1234-7123-8123-444444444450';
        await expect(insertEdge(versionA)).resolves.toMatchObject({ allowed: true });
        await expect(insertEdge(versionB)).resolves.toMatchObject({ allowed: true });
        const exactDuplicate = await insertEdge(versionA);
        expect(exactDuplicate.allowed).toBe(false);
        expect(exactDuplicate.code).toBe('23505');
      } finally {
        await epApp.query('ROLLBACK');
      }
    });

    it('rejects outbox writes whose payload scope mirror does not match', async () => {
      await epApp.query('BEGIN');
      await establishContext(epApp);

      const insertOutbox = (payload: string, enterpriseId: string) =>
        tryQuery(
          epApp,
          `INSERT INTO enterprise_project.outbox_event (
           event_id, event_type, event_version, aggregate_type, aggregate_id, aggregate_version,
           enterprise_id, correlation_id, payload, payload_hash, canonicalization_version,
           occurred_at, created_by_principal_id, source_command_id)
         VALUES (uuidv7(), 'demo.event', '1.0', 'Demo', uuidv7(), 1, $1, $2, $3::jsonb, $4,
                 'canonical-v1', now(), $5, uuidv7())`,
          [enterpriseId, CORRELATION, payload, HASH32, PRINCIPAL],
        );

      const mismatched = await insertOutbox('{"enterpriseId": "other"}', ENTERPRISE_A);
      expect(mismatched.allowed).toBe(false);
      expect(mismatched.code).toBe('22023');
      expect(mismatched.message).toMatch(/scope mirror mismatch/);

      // Failed statement aborted the transaction; restart it for the next case.
      await epApp.query('ROLLBACK');
      await epApp.query('BEGIN');
      await establishContext(epApp);
      const strayProject = await insertOutbox(
        `{"enterpriseId": "${ENTERPRISE_A}", "projectId": "${PROJECT_A1}"}`,
        ENTERPRISE_A,
      );
      expect(strayProject.code).toBe('22023');

      await epApp.query('ROLLBACK');
      await epApp.query('BEGIN');
      await establishContext(epApp);
      await expect(
        insertOutbox(`{"enterpriseId": "${ENTERPRISE_A}"}`, ENTERPRISE_A),
      ).resolves.toMatchObject({ allowed: true });
      await epApp.query('ROLLBACK');
    });

    it('keeps events, audit rows, steps and reference edges append-only for the app role', async () => {
      // Commit one of each to have update/delete targets.
      await epApp.query('BEGIN');
      await establishContext(epApp);
      await epApp.query(
        `INSERT INTO enterprise_project.outbox_event (
         event_id, event_type, event_version, aggregate_type, aggregate_id, aggregate_version,
         enterprise_id, correlation_id, payload, payload_hash, canonicalization_version,
         occurred_at, created_by_principal_id, source_command_id)
       VALUES ($1, 'demo.event', '1.0', 'Demo', uuidv7(), 1, $2, $3, $6::jsonb, $4, 'canonical-v1',
               now(), $5, uuidv7())`,
        [
          COMMITTED_EVENT,
          ENTERPRISE_A,
          CORRELATION,
          HASH32,
          PRINCIPAL,
          JSON.stringify({ enterpriseId: ENTERPRISE_A }),
        ],
      );
      await epApp.query(
        `INSERT INTO enterprise_project.process_instance (
         process_id, process_type, process_version, correlation_key, enterprise_id, state,
         created_by_principal_id)
       VALUES ('12345678-1234-7123-8123-333333333331', 'demo.process', '1.0', 'wi04-audit', $1,
               'ACTIVE', $2)`,
        [ENTERPRISE_A, PRINCIPAL],
      );
      await epApp.query(
        `INSERT INTO enterprise_project.process_step (
         process_step_id, process_id, step_no, enterprise_id, outcome, created_by_principal_id)
       VALUES ('12345678-1234-7123-8123-333333333332', '12345678-1234-7123-8123-333333333331', 1,
               $1, 'STARTED', $2)`,
        [ENTERPRISE_A, PRINCIPAL],
      );
      await epApp.query(
        `INSERT INTO enterprise_project.audit_record (
         audit_id, enterprise_id, principal_id, actor_snapshot_id, authorization_decision_id,
         command_type, outcome, correlation_id, retention_class)
       VALUES ('12345678-1234-7123-8123-333333333333', $1, $2, $2, $2, 'demo.command', 'COMMITTED',
               $3, 'REGULATED_AUDIT')`,
        [ENTERPRISE_A, PRINCIPAL, CORRELATION],
      );
      await epApp.query(
        `INSERT INTO enterprise_project.reference_edge (
         owner_object_type, owner_object_id, reference_path, target_module, target_object_type,
         target_object_id, reference_purpose, enterprise_id, source_command_id)
       VALUES ('Demo', '12345678-1234-7123-8123-444444444441', 'demo.path', 'identity_policy',
               'Principal', '12345678-1234-7123-8123-444444444442', 'demo.purpose', $1, uuidv7())`,
        [ENTERPRISE_A],
      );
      await epApp.query('COMMIT');

      // Same mirror, second edge with NULL target version again: NULLS NOT
      // DISTINCT makes the uniqueness cover it.
      await epApp.query('BEGIN');
      await establishContext(epApp);
      const duplicateEdge = await tryQuery(
        epApp,
        `INSERT INTO enterprise_project.reference_edge (
         owner_object_type, owner_object_id, reference_path, target_module, target_object_type,
         target_object_id, reference_purpose, enterprise_id, source_command_id)
       VALUES ('Demo', '12345678-1234-7123-8123-444444444441', 'demo.path', 'identity_policy',
               'Principal', '12345678-1234-7123-8123-444444444442', 'demo.purpose', $1, uuidv7())`,
        [ENTERPRISE_A],
      );
      expect(duplicateEdge.code).toBe('23505');
      await epApp.query('ROLLBACK');

      // Immutability: each denied statement aborts its own fresh transaction,
      // so every attempt runs with its own context.
      const updates: { sql: string; values?: unknown[] }[] = [
        {
          sql: `UPDATE enterprise_project.outbox_event SET payload = '{"tampered": true}'`,
        },
        {
          sql: `UPDATE enterprise_project.outbox_event SET payload_hash = $1 WHERE event_id = $2`,
          values: [Buffer.alloc(32, 0x00), COMMITTED_EVENT],
        },
        {
          sql: `UPDATE enterprise_project.audit_record SET outcome = 'DENIED'`,
        },
        {
          sql: `DELETE FROM enterprise_project.audit_record`,
        },
        {
          sql: `UPDATE enterprise_project.process_step SET outcome = 'SKIPPED'`,
        },
        {
          sql: `UPDATE enterprise_project.reference_edge SET reference_purpose = 'edited'`,
        },
      ];
      for (const { sql, values } of updates) {
        await epApp.query('BEGIN');
        await establishContext(epApp);
        const outcome = await tryQuery(epApp, sql, values);
        expect(outcome.allowed, sql).toBe(false);
        expect(outcome.code).toBe('42501');
        await epApp.query('ROLLBACK');
      }
    });

    it('lets the dispatcher advance only delivery metadata of committed events', async () => {
      const seen = await epDispatcher.query<{ count: string }>(
        `SELECT count(*) AS count FROM enterprise_project.outbox_event WHERE event_id = $1`,
        [COMMITTED_EVENT],
      );
      expect(seen.rows[0]?.count).toBe('1');

      await epDispatcher.query('BEGIN');
      await epDispatcher.query(
        `UPDATE enterprise_project.outbox_event
       SET delivery_state = 'LEASED', lease_owner = 'wi04-dispatcher', lease_until = now() + interval '1 minute',
           lease_token = 1, attempt_count = attempt_count + 1
       WHERE event_id = $1 AND delivery_state = 'PENDING'`,
        [COMMITTED_EVENT],
      );
      await epDispatcher.query(
        `UPDATE enterprise_project.outbox_event
       SET delivery_state = 'PUBLISHED', published_at = now()
       WHERE event_id = $1`,
        [COMMITTED_EVENT],
      );
      await epDispatcher.query('COMMIT');

      // Dispatcher denials run standalone (autocommit): the dispatcher needs
      // no transaction context, and a denied statement must not poison the
      // following probes.
      const tamper = await tryQuery(
        epDispatcher,
        `UPDATE enterprise_project.outbox_event SET payload = '{"tampered": true}' WHERE event_id = $1`,
        [COMMITTED_EVENT],
      );
      expect(tamper.allowed).toBe(false);
      expect(tamper.code).toBe('42501');
      const inject = await tryQuery(
        epDispatcher,
        `INSERT INTO enterprise_project.outbox_event (
         event_id, event_type, event_version, aggregate_type, aggregate_id, aggregate_version,
         enterprise_id, correlation_id, payload, payload_hash, canonicalization_version,
         occurred_at, created_by_principal_id, source_command_id)
       VALUES (uuidv7(), 'fake.event', '1.0', 'Demo', uuidv7(), 1, $1, $2, '{}', $3, 'canonical-v1',
               now(), $4, uuidv7())`,
        [ENTERPRISE_A, CORRELATION, HASH32, PRINCIPAL],
      );
      expect(inject.code).toBe('42501');
      const businessRead = await tryQuery(
        epDispatcher,
        `SELECT count(*) FROM enterprise_project.command_receipt`,
      );
      expect(businessRead.code).toBe('42501');

      const published = await admin.query<{ state: string }>(
        `SELECT delivery_state AS state FROM enterprise_project.outbox_event WHERE event_id = $1`,
        [COMMITTED_EVENT],
      );
      expect(published.rows[0]?.state).toBe('PUBLISHED');
    });

    it('keeps identity_policy platform technical tables separate from enterprise scope', async () => {
      // No context: RLS default-deny even though the row carries no enterprise.
      const denied = await tryQuery(
        ipApp,
        `INSERT INTO identity_policy.platform_command_receipt (
         command_id, command_type, command_version, idempotency_scope, idempotency_key,
         request_payload_hash, target_type, target_id, outcome, correlation_id,
         created_by_principal_id, actor_snapshot_id, authorization_decision_id)
       VALUES (uuidv7(), 'identity.register_principal', '1.0', 'wi04', 'p-1', $1, 'Principal',
               uuidv7(), 'PENDING', $2, $3, $3, $3)`,
        [HASH32, CORRELATION, PRINCIPAL],
      );
      expect(denied.code).toBe('42501');

      await ipApp.query('BEGIN');
      await establishContext(ipApp, [PROJECT_A1], 'identity_policy_app');
      await expect(
        tryQuery(
          ipApp,
          `INSERT INTO identity_policy.platform_command_receipt (
           command_id, command_type, command_version, idempotency_scope, idempotency_key,
           request_payload_hash, target_type, target_id, outcome, correlation_id,
           created_by_principal_id, actor_snapshot_id, authorization_decision_id)
         VALUES (uuidv7(), 'identity.register_principal', '1.0', 'wi04', 'p-1', $1, 'Principal',
                 uuidv7(), 'PENDING', $2, $3, $3, $3)`,
          [HASH32, CORRELATION, PRINCIPAL],
        ),
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        tryQuery(
          ipApp,
          `INSERT INTO identity_policy.platform_outbox_event (
           event_id, event_type, event_version, aggregate_type, aggregate_id, aggregate_version,
           correlation_id, payload, payload_hash, canonicalization_version, occurred_at,
           created_by_principal_id, source_command_id)
         VALUES (uuidv7(), 'identity.PrincipalRegistered', '1.0', 'Principal', uuidv7(), 1, $1,
                 $4::jsonb, $3, 'canonical-v1', now(), $2, uuidv7())`,
          [
            CORRELATION,
            PRINCIPAL,
            HASH32,
            JSON.stringify({ principalRef: { objectId: PRINCIPAL } }),
          ],
        ),
      ).resolves.toMatchObject({ allowed: true });
      await expect(
        tryQuery(
          ipApp,
          `INSERT INTO identity_policy.platform_audit_record (
           audit_id, principal_id, actor_snapshot_id, authorization_decision_id, command_type,
           outcome, correlation_id, retention_class)
         VALUES (uuidv7(), $1, $1, $1, 'identity.register_principal', 'COMMITTED', $2,
                 'REGULATED_AUDIT')`,
          [PRINCIPAL, CORRELATION],
        ),
      ).resolves.toMatchObject({ allowed: true });
      // Platform audit rows are append-only too.
      const auditUpdate = await tryQuery(
        ipApp,
        `UPDATE identity_policy.platform_audit_record SET outcome = 'DENIED'`,
      );
      expect(auditUpdate.code).toBe('42501');
      await ipApp.query('ROLLBACK');
    });
  },
);
