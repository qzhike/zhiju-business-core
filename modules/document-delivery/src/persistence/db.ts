/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- node-postgres types every row as any; this adapter immediately narrows each field with the helpers below. */
import { Pool, type PoolClient } from 'pg';

import { errorCodeOf, errorConstraintOf, fail, MvpError } from '../domain/errors.js';
import type { InstallationRecord, OperatorBinding } from '../domain/types.js';

export interface MvpDatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
}

export type Queryable = Pick<PoolClient, 'query'>;

/** A database/connection failure is a dependency outage, never an empty result. */
export function isDependencyFailure(error: unknown): boolean {
  if (error instanceof MvpError) return false;
  const code = errorCodeOf(error);
  return (
    code !== undefined &&
    [
      '57P01',
      '57P02',
      '57P03',
      '08000',
      '08003',
      '08006',
      '53300',
      'ECONNREFUSED',
      'ENOTFOUND',
    ].includes(code)
  );
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  return (
    errorCodeOf(error) === '23505' &&
    (constraint === undefined || errorConstraintOf(error) === constraint)
  );
}

export function isCheckViolation(error: unknown): boolean {
  return errorCodeOf(error) === '23514';
}

export function isSerializationFailure(error: unknown): boolean {
  const code = errorCodeOf(error);
  return code === '40001' || code === '40P01';
}

/**
 * One dedicated MVP runtime pool. Every business transaction pins the runtime
 * role and the owner on the transaction itself; a missing context fails closed
 * through RLS, so a connection returned to the pool cannot leak an owner.
 */
export class MvpDatabase {
  readonly #pool: Pool;

  constructor(options: MvpDatabaseOptions) {
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  /** Cancellation retires the connection, so a timed-out transaction cannot commit later. */
  async #acquire(signal?: AbortSignal) {
    signal?.throwIfAborted();
    const client = await new Promise<PoolClient>((resolve, reject) => {
      const cancel = () => {
        reject(new DOMException('Database operation cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      void this.#pool.connect().then(
        (connection) => {
          signal?.removeEventListener('abort', cancel);
          if (signal?.aborted) {
            connection.release();
            cancel();
          } else resolve(connection);
        },
        (error: unknown) => {
          signal?.removeEventListener('abort', cancel);
          reject(error instanceof Error ? error : new MvpError('DEPENDENCY_UNAVAILABLE'));
        },
      );
    });
    let released = false;
    const cancel = () => {
      signal?.removeEventListener('abort', cancel);
      if (!released) {
        released = true;
        client.release(true);
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    return {
      client,
      release: () => {
        signal?.removeEventListener('abort', cancel);
        if (!released) {
          released = true;
          client.release();
        }
      },
    };
  }

  /**
   * Run a read that does not yet have an owner context under the runtime role.
   * The login role never inherits table or function privileges directly.
   */

  async #readRuntime<T>(
    operation: (client: PoolClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let connection: { client: PoolClient; release: () => void };
    try {
      connection = await this.#acquire(signal);
    } catch (error) {
      if (isDependencyFailure(error)) fail('DEPENDENCY_UNAVAILABLE');
      throw error;
    }
    const { client } = connection;
    try {
      signal?.throwIfAborted();
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE mvp_runtime');
      const result = await operation(client);
      signal?.throwIfAborted();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (isDependencyFailure(error)) fail('DEPENDENCY_UNAVAILABLE');
      throw error;
    } finally {
      connection.release();
    }
  }

  /** Read the one installation identity row, or `undefined` when not installed. */
  async installation(): Promise<InstallationRecord | undefined> {
    return this.#readRuntime(async (client) => {
      const result = await client.query(
        'SELECT instance_id, schema_version, store_id, store_identity FROM document_delivery.installation WHERE singleton',
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      return {
        instanceId: String(row.instance_id),
        schemaVersion: String(row.schema_version),
        storeId: String(row.store_id),
        storeIdentity: String(row.store_identity),
      };
    });
  }

  async resolveBinding(issuer: string, subject: string): Promise<OperatorBinding | undefined> {
    return this.#readRuntime(async (client) => {
      const result = await client.query(
        'SELECT owner_id, display_name, auth_epoch, enabled FROM document_delivery.resolve_operator_binding($1, $2)',
        [issuer, subject],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      return {
        ownerId: String(row.owner_id),
        displayName: String(row.display_name),
        authEpoch: Number(row.auth_epoch),
        enabled: row.enabled === true,
      };
    });
  }

  async currentBinding(
    ownerId: string,
    signal?: AbortSignal,
  ): Promise<{ enabled: boolean; authEpoch: number } | undefined> {
    return this.#readRuntime(async (client) => {
      const result = await client.query(
        'SELECT enabled, auth_epoch FROM document_delivery.current_binding($1)',
        [ownerId],
      );
      const row = result.rows[0];
      if (row === undefined) return undefined;
      return { enabled: row.enabled === true, authEpoch: Number(row.auth_epoch) };
    }, signal);
  }

  async pendingReadChecks(signal?: AbortSignal): Promise<
    readonly {
      ownerId: string;
      projectId: string;
      batchId: string;
      checkId: string;
      status: string;
      authEpoch: number;
    }[]
  > {
    return this.#readRuntime(
      async (client) =>
        (await client.query('SELECT * FROM document_delivery.pending_read_checks()')).rows.map(
          (row) => ({
            ownerId: String(row.owner_id),
            projectId: String(row.project_id),
            batchId: String(row.batch_id),
            checkId: String(row.check_id),
            status: String(row.status),
            authEpoch: Number(row.authorized_auth_epoch),
          }),
        ),
      signal,
    );
  }

  async pendingExtractions(): Promise<
    readonly {
      ownerId: string;
      projectId: string;
      batchId: string;
      attemptId: string;
      generation: number;
      authorizedAuthEpoch: number;
      status: string;
    }[]
  > {
    return this.#readRuntime(async (client) => {
      const result = await client.query(
        'SELECT owner_id, project_id, batch_id, attempt_id, generation, authorized_auth_epoch, status FROM document_delivery.pending_extractions()',
      );
      return result.rows.map((row) => ({
        ownerId: String(row.owner_id),
        projectId: String(row.project_id),
        batchId: String(row.batch_id),
        attemptId: String(row.attempt_id),
        generation: Number(row.generation),
        authorizedAuthEpoch: Number(row.authorized_auth_epoch),
        status: String(row.status),
      }));
    });
  }

  /**
   * Run one owner-pinned transaction. `projectId` additionally pins the
   * project context when the operation reads inside one project.
   */
  async transaction<T>(
    ownerId: string,
    projectId: string | undefined,
    operation: (client: PoolClient) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let connection: { client: PoolClient; release: () => void };
    try {
      connection = await this.#acquire(signal);
    } catch (error) {
      if (isDependencyFailure(error)) fail('DEPENDENCY_UNAVAILABLE');
      throw error;
    }
    const { client } = connection;
    try {
      signal?.throwIfAborted();
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE mvp_runtime');
      await client.query("SELECT set_config('mvp.owner_id', $1, true)", [ownerId]);
      await client.query("SELECT set_config('mvp.project_id', $1, true)", [projectId ?? '']);
      await client.query("SET LOCAL statement_timeout = '20000ms'");
      const result = await operation(client);
      signal?.throwIfAborted();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (isSerializationFailure(error)) fail('DEPENDENCY_UNAVAILABLE');
      if (isDependencyFailure(error)) fail('DEPENDENCY_UNAVAILABLE');
      throw error;
    } finally {
      connection.release();
    }
  }
}

export function stringColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') fail('DEPENDENCY_UNAVAILABLE');
  return value;
}

export function nullableStringColumn(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') fail('DEPENDENCY_UNAVAILABLE');
  return value;
}

export function numberColumn(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) fail('DEPENDENCY_UNAVAILABLE');
  return parsed;
}

export function booleanColumn(row: Record<string, unknown>, key: string): boolean {
  const value = row[key];
  if (typeof value !== 'boolean') fail('DEPENDENCY_UNAVAILABLE');
  return value;
}

export function timestampColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  fail('DEPENDENCY_UNAVAILABLE');
}

export function hexColumn(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (Buffer.isBuffer(value) && value.length === 32) return value.toString('hex');
  if (typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value)) return value;
  fail('DEPENDENCY_UNAVAILABLE');
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller supplies the closed JSON shape.
export function jsonColumn<T>(row: Record<string, unknown>, key: string): T {
  const value = row[key];
  if (value === null || typeof value !== 'object') fail('DEPENDENCY_UNAVAILABLE');
  return value as T;
}

export function reasonCodesColumn(row: Record<string, unknown>, key: string): readonly string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    fail('DEPENDENCY_UNAVAILABLE');
  return value as readonly string[];
}
