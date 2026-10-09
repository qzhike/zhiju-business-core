import type { Pool } from 'pg';
import { Kysely, PostgresDialect, sql, type ColumnType, type Transaction } from 'kysely';
import { newUuidV7 } from '@zhiju/shared-kernel';
import { CompanyStartupError, type CompanyRuleAuthorizationProof } from '@zhiju/contracts';
import type { EnterpriseProjectDb } from './enterprise-db.js';
interface CompanyRequirementFactTable {
  id: string;
  code: string;
  version: string;
  payload: ColumnType<unknown, string, never>;
  payload_hash: Buffer;
  actor_ref: ColumnType<unknown, string, never>;
  decision_ref: ColumnType<unknown, string, never>;
  source_command_id: string;
}
interface CompanyRequirementPublicationTable {
  id: string;
  requirement_id: string;
  payload: ColumnType<unknown, string, never>;
  payload_hash: Buffer;
  actor_ref: ColumnType<unknown, string, never>;
  decision_ref: ColumnType<unknown, string, never>;
  source_command_id: string;
}
interface CompanyRequirementReceiptTable {
  id: string;
  operation: string;
  idempotency_key: string;
  request_hash: Buffer;
  result: ColumnType<unknown, string, never>;
  result_hash: Buffer;
  actor_ref: ColumnType<unknown, string, never>;
  decision_ref: ColumnType<unknown, string, never>;
}
export interface CompanyStartupDb extends EnterpriseProjectDb {
  'enterprise_project.company_startup_requirement': CompanyRequirementFactTable;
  'enterprise_project.company_startup_requirement_publication': CompanyRequirementPublicationTable;
  'enterprise_project.company_startup_receipt': CompanyRequirementReceiptTable;
}
export function createCompanyStartupDatabase(pool: Pool): Kysely<CompanyStartupDb> {
  return new Kysely<CompanyStartupDb>({ dialect: new PostgresDialect({ pool }) });
}
export async function withCompanyStartupTransaction<T>(
  db: Kysely<CompanyStartupDb>,
  proof: CompanyRuleAuthorizationProof,
  fn: (trx: Transaction<CompanyStartupDb>) => Promise<T>,
): Promise<T> {
  try {
    return await db.connection().execute((connection) =>
      connection
        .transaction()
        .setIsolationLevel('read committed')
        .execute(async (trx) => {
          await sql.raw('SET LOCAL ROLE platform_context_establisher').execute(trx);
          await sql`SELECT platform_security.establish_transaction_context('REQUEST',${proof.session.principalId},${proof.actorSnapshotRef.objectId},${proof.authorizationDecisionRef.objectId},${Buffer.from(proof.authorizationDecisionRef.contentHash.digest, 'hex')},${new Date(proof.session.expiresAt)},${'00000000-0000-7000-8000-000000000000'},${[]},${newUuidV7()},${null})`.execute(
            trx,
          );
          await sql.raw('SET LOCAL ROLE enterprise_project_company_rule_writer').execute(trx);
          return fn(trx);
        }),
    );
  } catch (error) {
    if (error instanceof CompanyStartupError) throw error;
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      throw new CompanyStartupError('COMPANY_RULE_IDENTITY_CONFLICT');
    throw new CompanyStartupError('DEPENDENCY_UNAVAILABLE');
  }
}
