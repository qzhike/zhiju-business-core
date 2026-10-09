import type { Pool } from 'pg';
import { Kysely, PostgresDialect, sql, type ColumnType, type Transaction } from 'kysely';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  CompanyStartupError,
  type CompanyRuleAuthorizationProof,
  type CompanyRuleSession,
} from '@zhiju/contracts';
import type { IdentityPolicyDb } from './identity-db.js';

type Json = ColumnType<unknown, string, never>;
export interface CompanyAuthorityTable {
  id: string;
  kind: 'ACTOR' | 'GRANT' | 'REVOCATION' | 'DECISION';
  principal_id: string;
  parent_id: string | null;
  payload: Json;
  payload_hash: Buffer;
}
interface CompanyFactTable {
  id: string;
  payload: Json;
  payload_hash: Buffer;
  actor_id: string;
  decision_id: string;
  source_command_id: string;
}
interface CompanySnapshotTable extends CompanyFactTable {
  registry_version: string;
  profile_key: string;
  document_code: string;
  document_version: string;
}
interface CompanyPublicationTable extends CompanyFactTable {
  bundle_code: string;
  bundle_version: string;
  bundle_id: string;
  predecessor_id: string | null;
  effective_from: Date;
}
interface CompanyWithdrawalTable extends CompanyFactTable {
  publication_id: string;
  effective_from: Date;
}
interface CompanyReceiptTable {
  id: string;
  operation: string;
  idempotency_key: string;
  request_hash: Buffer;
  result: Json;
  result_hash: Buffer;
  actor_id: string;
  decision_id: string;
}
interface CompanyAuditTable {
  id: string;
  operation: string;
  principal_id: string;
  actor_id: string;
  decision_id: string;
  request_hash: Buffer;
  target_id: string;
  recorded_at: Date;
}
export interface CompanyRuleDb extends IdentityPolicyDb {
  'identity_policy.company_rule_authority': CompanyAuthorityTable;
  'identity_policy.company_rule_snapshot': CompanySnapshotTable;
  'identity_policy.company_rule_publication': CompanyPublicationTable;
  'identity_policy.company_rule_withdrawal': CompanyWithdrawalTable;
  'identity_policy.company_rule_receipt': CompanyReceiptTable;
  'identity_policy.company_rule_audit': CompanyAuditTable;
}
export function createCompanyRuleDatabase(pool: Pool): Kysely<CompanyRuleDb> {
  return new Kysely<CompanyRuleDb>({ dialect: new PostgresDialect({ pool }) });
}
export async function withCompanyRuleTransaction<T>(
  db: Kysely<CompanyRuleDb>,
  session: CompanyRuleSession,
  proof: CompanyRuleAuthorizationProof | undefined,
  fn: (trx: Transaction<CompanyRuleDb>) => Promise<T>,
): Promise<T> {
  try {
    return await db.connection().execute((connection) =>
      connection
        .transaction()
        .setIsolationLevel('read committed')
        .execute(async (trx) => {
          await sql.raw('SET LOCAL ROLE platform_context_establisher').execute(trx);
          await sql`SELECT platform_security.establish_transaction_context('REQUEST', ${session.principalId}, ${proof?.actorSnapshotRef.objectId ?? newUuidV7()}, ${proof?.authorizationDecisionRef.objectId ?? newUuidV7()}, ${Buffer.from(proof?.authorizationDecisionRef.contentHash.digest ?? session.authenticationContextHash.digest, 'hex')}, ${new Date(session.expiresAt)}, ${'00000000-0000-7000-8000-000000000000'}, ${[]}, ${newUuidV7()}, ${null})`.execute(
            trx,
          );
          await sql.raw('SET LOCAL ROLE identity_policy_company_rule_writer').execute(trx);
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
