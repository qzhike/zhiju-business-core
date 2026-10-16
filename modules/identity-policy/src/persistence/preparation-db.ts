import { Kysely, PostgresDialect, sql, type ColumnType, type Transaction } from 'kysely';
import type { Pool } from 'pg';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { PreparationError, type PreparationSession } from '@zhiju/contracts';
import type { IdentityPolicyDb } from './identity-db.js';
export interface PreparationFactTable {
  id: string;
  kind: string;
  principal_id: string;
  parent_id: string | null;
  enterprise_id: string | null;
  project_id: string | null;
  payload: ColumnType<unknown, string, never>;
  payload_hash: Buffer;
}
export interface PreparationIdentityDb extends IdentityPolicyDb {
  'identity_policy.preparation_fact': PreparationFactTable;
}
export const PREPARATION_PLATFORM_ID = '00000000-0000-7000-8000-000000000000';
export function createPreparationIdentityDatabase(pool: Pool): Kysely<PreparationIdentityDb> {
  return new Kysely<PreparationIdentityDb>({ dialect: new PostgresDialect({ pool }) });
}
export async function withPreparationTransaction<T>(
  db: Kysely<PreparationIdentityDb>,
  session: PreparationSession,
  scope: { enterpriseId: string; projectId?: string } | undefined,
  fn: (trx: Transaction<PreparationIdentityDb>) => Promise<T>,
): Promise<T> {
  try {
    return await db.connection().execute((connection) =>
      connection.transaction().execute(async (trx) => {
        await sql.raw('SET LOCAL ROLE platform_context_establisher').execute(trx);
        await sql`SELECT platform_security.establish_transaction_context('REQUEST',${session.principalId},${newUuidV7()},${newUuidV7()},${Buffer.from(session.authenticationContextHash.digest, 'hex')},${new Date(session.expiresAt)},${scope?.enterpriseId ?? PREPARATION_PLATFORM_ID},${scope?.projectId ? [scope.projectId] : []},${newUuidV7()},${null})`.execute(
          trx,
        );
        await sql.raw('SET LOCAL ROLE identity_policy_preparation_writer').execute(trx);
        return fn(trx);
      }),
    );
  } catch (error) {
    if (error instanceof PreparationError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      throw new PreparationError('PREPARATION_IDENTITY_CONFLICT');
    throw error;
  }
}
