import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { runFlyway } from '../../tools/persistence/flyway.mjs';
import {
  assertServerVersion,
  FLYWAY_IMAGE_TAG,
  POSTGRES_IMAGE_DIGEST,
  POSTGRES_IMAGE_TAG,
} from '../../tools/persistence/baseline.mjs';

// These tests only run inside the persistence gate (`pnpm persistence:gate`),
// which provisions the pinned PostgreSQL container, runs Flyway and exports
// the connection coordinates. A bare `pnpm test` skips them instead of
// reporting a false pass: the gate itself is the authoritative evidence.
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const containerId = process.env.ZJU_PERSISTENCE_CONTAINER_ID;
const gateEnabled = Boolean(databaseUrl && containerId);

interface HistoryRow {
  installed_rank: string;
  version: string;
  description: string;
  success: string;
  checksum: string;
}

const EXPECTED_SCHEMAS = [
  'artifact',
  'enterprise_project',
  'identity_policy',
  'integration_gateway',
  'projection',
  'quality_governance',
  'release_publication',
  'task_execution',
];

describe.skipIf(!gateEnabled)('persistence migration baseline (real PostgreSQL)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function historyRows(): Promise<HistoryRow[]> {
    const result = await pool.query<HistoryRow>(
      'SELECT installed_rank::text, version, description, success::text, checksum::text FROM public.flyway_schema_history ORDER BY installed_rank',
    );
    return result.rows;
  }

  it('runs on the pinned PostgreSQL major.minor and pinned image digest', async () => {
    const result = await pool.query<{ server_version_num: string }>('SHOW server_version_num');
    assertServerVersion(result.rows[0]?.server_version_num ?? '');
    expect(process.env.ZJU_PERSISTENCE_IMAGE_TAG).toBe(POSTGRES_IMAGE_TAG);
    expect(process.env.ZJU_PERSISTENCE_IMAGE_DIGEST).toBe(POSTGRES_IMAGE_DIGEST);
  });

  it('runs against the pinned Flyway CLI version', () => {
    expect(process.env.ZJU_PERSISTENCE_FLYWAY_TAG).toBe(FLYWAY_IMAGE_TAG);
  });

  it('migrated the empty database: flyway history records the bootstrap migration', async () => {
    const rows = await historyRows();
    expect(rows.length).toBeGreaterThan(0);
    const bootstrap = rows.find((row) => row.version === '0001');
    expect(bootstrap?.description).toBe('platform bootstrap');
    expect(bootstrap?.success).toBe('true');
    expect(bootstrap?.checksum).toMatch(/^\d+$/);
  });

  it('created the seven owning schemas plus projection', async () => {
    const result = await pool.query<{ schema_name: string }>(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY ($1::text[]) ORDER BY schema_name',
      [EXPECTED_SCHEMAS],
    );
    expect(result.rows.map((row) => row.schema_name)).toEqual(EXPECTED_SCHEMAS);
  });

  it('provides the PG18 uuidv7() function used for availability checks', async () => {
    const result = await pool.query<{ id: string }>('SELECT uuidv7()::text AS id');
    expect(result.rows[0]?.id ?? '').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('re-running migrations is a no-op without checksum drift', async () => {
    const before = await historyRows();

    const output = await runFlyway(containerId ?? '', {
      command: 'migrate',
      database: 'zhiju_core',
      username: 'postgres',
      password: 'zhiju-gate-test',
    });
    expect(output).toMatch(/up to date|no pending migrations|No migration necessary/i);

    const after = await historyRows();
    expect(after).toEqual(before);
  });
});
