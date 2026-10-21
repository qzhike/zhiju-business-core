import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  HISTORICAL_PROVIDER_RESULT_OBSERVATION_ID,
  HISTORICAL_PROVIDER_RESULT_RECEIPT_ID,
} from '../../tools/persistence/provider-result-upgrade-fixture.mjs';
import { digestCanonicalPayload } from '@zhiju/release-publication';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
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

  it('remediated V6002 historical Receipt and Observation provider results', async () => {
    const receipt = await pool.query<{
      provider_result: CanonicalJsonObject;
      formal_receipt_ref: CanonicalJsonObject;
    }>(
      `SELECT provider_result, formal_receipt_ref
         FROM release_publication.publication_receipt
        WHERE receipt_id = $1`,
      [HISTORICAL_PROVIDER_RESULT_RECEIPT_ID],
    );
    expect(receipt.rows).toHaveLength(1);
    expect(receipt.rows[0]?.provider_result).toEqual({
      providerStatus: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      reasonCode: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
      status: { redacted: true, reasonCode: 'PROVIDER_RESULT_FIELD_REDACTED' },
    });
    expect(receipt.rows[0]?.formal_receipt_ref).toMatchObject({
      objectId: HISTORICAL_PROVIDER_RESULT_RECEIPT_ID,
      contentHash: { digest: 'b'.repeat(64) },
    });

    const observation = await pool.query<{
      observation_payload: CanonicalJsonObject;
      observation_payload_hash: Buffer;
    }>(
      `SELECT observation_payload, observation_payload_hash
         FROM release_publication.publication_observation
        WHERE observation_id = $1`,
      [HISTORICAL_PROVIDER_RESULT_OBSERVATION_ID],
    );
    expect(observation.rows).toHaveLength(1);
    const row = observation.rows[0];
    if (row === undefined) throw new Error('historical Provider Result observation is missing');
    expect(row.observation_payload.providerResult).toEqual(receipt.rows[0]?.provider_result);
    expect(row.observation_payload.formalReceiptRef).toEqual(receipt.rows[0]?.formal_receipt_ref);
    const serialized = JSON.stringify({ receipt: receipt.rows[0], observation: row });
    expect(serialized).not.toContain('LegacyAliceCustomer');
    expect(serialized).not.toContain('LegacyBobBuyer');
    expect(serialized).not.toContain('LegacyCustomerName');
    expect(serialized).not.toContain('legacy.customer@example.com');
    expect(serialized).not.toContain('legacy document body');
    expect(row.observation_payload_hash).toEqual(
      digestCanonicalPayload(row.observation_payload).hash,
    );

    const safety = await pool.query<{ receipt_safe: boolean; observation_safe: boolean }>(
      `SELECT release_publication.provider_result_is_safe($1::jsonb) AS receipt_safe,
              release_publication.provider_result_is_safe($2::jsonb) AS observation_safe`,
      [receipt.rows[0]?.provider_result, row.observation_payload.providerResult],
    );
    expect(safety.rows[0]).toEqual({ receipt_safe: true, observation_safe: true });
  });

  it('created the seven owning schemas plus projection', async () => {
    const result = await pool.query<{ schema_name: string }>(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY ($1::text[]) ORDER BY schema_name',
      [EXPECTED_SCHEMAS],
    );
    expect(result.rows.map((row) => row.schema_name)).toEqual(EXPECTED_SCHEMAS);
  });

  it('has the Technology-Baseline-approved extensions available in the locked image', async () => {
    // Technology-Baseline §2/§3: `btree_gist` and `pg_stat_statements` are the
    // approved extensions; `pgcrypto` is deferred (IM-DG-003) and must not be
    // required. Availability is asserted against pg_available_extensions on
    // the real locked PostgreSQL 18.6 image.
    const result = await pool.query<{ name: string }>(
      'SELECT name FROM pg_available_extensions WHERE name = ANY ($1::text[]) ORDER BY name',
      [['btree_gist', 'pg_stat_statements']],
    );
    expect(result.rows.map((row) => row.name)).toEqual(['btree_gist', 'pg_stat_statements']);
  });

  it('provides the PG18 uuidv7() function used for availability checks', async () => {
    const result = await pool.query<{ id: string }>('SELECT uuidv7()::text AS id');
    expect(result.rows[0]?.id ?? '').toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
