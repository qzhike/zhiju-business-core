import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  COMPANY_RULE_OPERATIONS,
  CompanyStartupError,
  assertCompanyClosed,
  assertCompanyHash,
  assertCompanyReference,
  canonicalCompanyInstant,
  companyHash,
  sameCompanyValue,
  type Common,
  type CompanyRuleAuthorizationPort,
  type CompanyRuleAuthorizationProof,
  type CompanyRuleOperation,
  type CompanyRuleSession,
} from '@zhiju/contracts';
import type { Kysely, Transaction } from 'kysely';
import { withCompanyRuleTransaction, type CompanyRuleDb } from '../persistence/company-rule-db.js';

export interface CompanyRuleAuthorityConfig {
  db: Kysely<CompanyRuleDb>;
  grantAdministrators: readonly string[];
  /** Must validate a server-established authentication context; never a Browser assertion. */
  verifySession(session: CompanyRuleSession): Promise<void>;
  clock?: () => Date;
}
interface GrantPayload {
  kind: 'GRANT';
  principalId: string;
  operation: CompanyRuleOperation;
  version: string;
  purpose: CompanyRuleOperation;
  action: CompanyRuleOperation;
  target: Common.ObjectRef;
  policySnapshotRef: Common.SnapshotRef;
  validFrom: string;
  validUntil: string;
  issuedByPrincipalId: string;
  authenticationContextHash: Common.ContentHash;
}
interface ActorPayload {
  kind: 'ACTOR';
  principalId: string;
  principalKind: 'HUMAN' | 'SERVICE';
  scope: Record<string, never>;
  authenticationContextHash: Common.ContentHash;
  expiresAt: string;
}
interface DecisionPayload {
  kind: 'DECISION';
  principalId: string;
  principalKind: 'HUMAN' | 'SERVICE';
  actorSnapshotRef: Common.SnapshotRef;
  grantRef: Common.ContentAddressedRef;
  operation: CompanyRuleOperation;
  version: string;
  purpose: CompanyRuleOperation;
  action: CompanyRuleOperation;
  target: Common.ObjectRef;
  requestHash: Common.ContentHash;
  outcome: string;
  issuedAt: string;
  expiresAt: string;
  humanIntent?: CompanyRuleAuthorizationProof;
}
function denied(): never {
  throw new CompanyStartupError('AUTHORIZATION_DECISION_INVALID');
}
const writes = new Set<CompanyRuleOperation>([
  'identity.company_rule.snapshot.record',
  'identity.company_rule.publish',
  'identity.company_rule.withdraw',
  'project.company_startup.requirement.import',
  'project.company_startup.requirement.publish',
]);
function authorityRef(id: string, type: string, payload: unknown): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: type,
    objectId: id,
    scope: {},
    contentHash: companyHash(payload),
  };
}
async function insertAuthority(
  trx: Transaction<CompanyRuleDb>,
  id: string,
  kind: 'ACTOR' | 'GRANT' | 'REVOCATION' | 'DECISION',
  principalId: string,
  payload: unknown,
  parentId: string | null = null,
): Promise<void> {
  await trx
    .insertInto('identity_policy.company_rule_authority')
    .values({
      id,
      kind,
      principal_id: principalId,
      parent_id: parentId,
      payload: JSON.stringify(payload),
      payload_hash: Buffer.from(companyHash(payload).digest, 'hex'),
    })
    .execute();
}

export function createCompanyRuleAuthorizationPort(
  config: CompanyRuleAuthorityConfig,
): CompanyRuleAuthorizationPort & {
  grant(
    session: CompanyRuleSession,
    input: {
      principalId: string;
      operation: CompanyRuleOperation;
      target: Common.ObjectRef;
      policySnapshotRef: Common.SnapshotRef;
      validFrom: string;
      validUntil: string;
    },
  ): Promise<Common.ContentAddressedRef>;
  revoke(session: CompanyRuleSession, grantRef: Common.ContentAddressedRef): Promise<void>;
} {
  const now = config.clock ?? (() => new Date());
  async function sessionValid(session: CompanyRuleSession): Promise<void> {
    assertCompanyClosed(session, ['principalId', 'authenticationContextHash', 'expiresAt']);
    assertCompanyHash(session.authenticationContextHash);
    if (!canonicalCompanyInstant(session.expiresAt) || new Date(session.expiresAt) <= now())
      denied();
    try {
      await config.verifySession(session);
    } catch (error) {
      if (error instanceof CompanyStartupError) throw error;
      throw new CompanyStartupError('DEPENDENCY_UNAVAILABLE');
    }
  }
  async function principalKind(
    trx: Transaction<CompanyRuleDb>,
    principalId: string,
  ): Promise<'HUMAN' | 'SERVICE'> {
    const row = await trx
      .selectFrom('identity_policy.principal')
      .select(['principal_kind', 'status'])
      .where('id', '=', principalId)
      .executeTakeFirst();
    if (
      row?.status !== 'ACTIVE' ||
      (row.principal_kind !== 'HUMAN' && row.principal_kind !== 'SERVICE')
    )
      denied();
    return row.principal_kind;
  }
  async function policyValid(
    trx: Transaction<CompanyRuleDb>,
    ref: Common.SnapshotRef,
  ): Promise<void> {
    assertCompanyReference(ref, 'SNAPSHOT', 'identity.policy_snapshot');
    if (ref.objectId !== ref.snapshotId) denied();
    const row = await trx
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', ref.snapshotId)
      .executeTakeFirst();
    if (
      row?.schema_registry_version !== 'im02-static-v1' ||
      row.effective_from > now() ||
      (row.superseded_at != null && row.superseded_at <= now()) ||
      row.payload_hash.toString('hex') !== ref.contentHash.digest ||
      !sameCompanyValue(companyHash(row.canonical_payload), ref.contentHash)
    )
      denied();
  }
  async function grantValid(
    trx: Transaction<CompanyRuleDb>,
    ref: Common.ContentAddressedRef,
    principalId: string,
    operation: CompanyRuleOperation,
    target: Common.ObjectRef,
  ): Promise<GrantPayload> {
    assertCompanyReference(ref, 'CONTENT_ADDRESSED', 'identity.company_rule_grant');
    const row = await trx
      .selectFrom('identity_policy.company_rule_authority')
      .selectAll()
      .where('id', '=', ref.objectId)
      .where('kind', '=', 'GRANT')
      .executeTakeFirst();
    if (
      row?.principal_id !== principalId ||
      row.payload_hash.toString('hex') !== ref.contentHash.digest ||
      !sameCompanyValue(companyHash(row.payload), ref.contentHash)
    )
      denied();
    const p = row.payload as GrantPayload;
    if (
      p.operation !== operation ||
      p.version !== '1.0' ||
      p.action !== operation ||
      p.purpose !== operation ||
      !sameCompanyValue(p.target, target) ||
      new Date(p.validFrom) > now() ||
      new Date(p.validUntil) <= now()
    )
      denied();
    if (
      await trx
        .selectFrom('identity_policy.company_rule_authority')
        .select('id')
        .where('parent_id', '=', row.id)
        .where('kind', '=', 'REVOCATION')
        .executeTakeFirst()
    )
      denied();
    await policyValid(trx, p.policySnapshotRef);
    return p;
  }
  function intentValid(operation: CompanyRuleOperation, target: Common.ObjectRef): void {
    if (!COMPANY_RULE_OPERATIONS.includes(operation)) denied();
    assertCompanyReference(target, 'OBJECT', target.objectType);
    const type =
      operation.startsWith('identity.company_rule.snapshot.') ||
      operation === 'project.company_startup.definition.validate'
        ? 'identity.policy_snapshot'
        : operation.startsWith('project.')
          ? 'zhiju.project.company_startup_requirement'
          : 'zhiju.identity.company_rule_publication';
    if (target.objectType !== type) denied();
  }
  async function check(
    proof: CompanyRuleAuthorizationProof,
    operation: CompanyRuleOperation,
    target: Common.ObjectRef,
    request: unknown,
  ): Promise<void> {
    assertCompanyClosed(proof, ['session', 'actorSnapshotRef', 'authorizationDecisionRef']);
    intentValid(operation, target);
    await sessionValid(proof.session);
    assertCompanyReference(proof.actorSnapshotRef, 'SNAPSHOT', 'identity.actor_snapshot');
    assertCompanyReference(
      proof.authorizationDecisionRef,
      'CONTENT_ADDRESSED',
      'identity.authorization_decision',
    );
    await withCompanyRuleTransaction(config.db, proof.session, proof, async (trx) => {
      const kind = await principalKind(trx, proof.session.principalId);
      const actor = await trx
        .selectFrom('identity_policy.company_rule_authority')
        .selectAll()
        .where('id', '=', proof.actorSnapshotRef.objectId)
        .where('kind', '=', 'ACTOR')
        .executeTakeFirst();
      const decision = await trx
        .selectFrom('identity_policy.company_rule_authority')
        .selectAll()
        .where('id', '=', proof.authorizationDecisionRef.objectId)
        .where('kind', '=', 'DECISION')
        .executeTakeFirst();
      if (
        !actor ||
        !decision ||
        actor.principal_id !== proof.session.principalId ||
        decision.principal_id !== proof.session.principalId ||
        proof.actorSnapshotRef.objectId !== proof.actorSnapshotRef.snapshotId ||
        !sameCompanyValue(companyHash(actor.payload), proof.actorSnapshotRef.contentHash) ||
        !sameCompanyValue(companyHash(decision.payload), proof.authorizationDecisionRef.contentHash)
      )
        denied();
      const a = actor.payload as ActorPayload,
        d = decision.payload as DecisionPayload;
      if (
        a.principalKind !== kind ||
        d.principalKind !== kind ||
        !sameCompanyValue(a.authenticationContextHash, proof.session.authenticationContextHash) ||
        a.expiresAt !== proof.session.expiresAt ||
        d.outcome !== 'ALLOW' ||
        d.version !== '1.0' ||
        d.operation !== operation ||
        d.action !== operation ||
        d.purpose !== operation ||
        !sameCompanyValue(d.target, target) ||
        !sameCompanyValue(d.requestHash, companyHash(request)) ||
        !sameCompanyValue(d.actorSnapshotRef, proof.actorSnapshotRef) ||
        new Date(d.expiresAt) <= now() ||
        new Date(d.issuedAt) > now()
      )
        denied();
      await grantValid(trx, d.grantRef, proof.session.principalId, operation, target);
      if (kind === 'SERVICE' && writes.has(operation)) {
        if (!d.humanIntent) denied();
        // The stored original intent is exact, independently current, and genuinely Human.
        await humanApproval(d.humanIntent, operation, target, request);
      }
    });
    await sessionValid(proof.session);
  }
  async function humanApproval(
    proof: CompanyRuleAuthorizationProof,
    operation: CompanyRuleOperation,
    target: Common.ObjectRef,
    request: unknown,
  ): Promise<CompanyRuleAuthorizationProof> {
    await check(proof, operation, target, request);
    return withCompanyRuleTransaction(config.db, proof.session, proof, async (trx) => {
      const row = await trx
        .selectFrom('identity_policy.company_rule_authority')
        .select('payload')
        .where('id', '=', proof.authorizationDecisionRef.objectId)
        .executeTakeFirstOrThrow();
      const p = row.payload as DecisionPayload;
      if (p.principalKind === 'HUMAN') return proof;
      if (!p.humanIntent) denied();
      return humanApproval(p.humanIntent, operation, target, request);
    });
  }
  return {
    check,
    humanApproval,
    async grant(session, input) {
      assertCompanyClosed(input, [
        'principalId',
        'operation',
        'target',
        'policySnapshotRef',
        'validFrom',
        'validUntil',
      ]);
      await sessionValid(session);
      intentValid(input.operation, input.target);
      if (
        !config.grantAdministrators.includes(session.principalId) ||
        !canonicalCompanyInstant(input.validFrom) ||
        !canonicalCompanyInstant(input.validUntil) ||
        new Date(input.validUntil) <= now() ||
        new Date(input.validUntil) <= new Date(input.validFrom)
      )
        denied();
      return withCompanyRuleTransaction(config.db, session, undefined, async (trx) => {
        if ((await principalKind(trx, session.principalId)) !== 'HUMAN') denied();
        await principalKind(trx, input.principalId);
        await policyValid(trx, input.policySnapshotRef);
        const id = newUuidV7();
        const p: GrantPayload = {
          kind: 'GRANT',
          ...input,
          version: '1.0',
          purpose: input.operation,
          action: input.operation,
          issuedByPrincipalId: session.principalId,
          authenticationContextHash: session.authenticationContextHash,
        };
        await insertAuthority(trx, id, 'GRANT', input.principalId, p);
        await sessionValid(session);
        if ((await principalKind(trx, session.principalId)) !== 'HUMAN') denied();
        await principalKind(trx, input.principalId);
        await policyValid(trx, input.policySnapshotRef);
        return authorityRef(id, 'identity.company_rule_grant', p);
      });
    },
    async revoke(session, ref) {
      await sessionValid(session);
      if (!config.grantAdministrators.includes(session.principalId)) denied();
      await withCompanyRuleTransaction(config.db, session, undefined, async (trx) => {
        if ((await principalKind(trx, session.principalId)) !== 'HUMAN') denied();
        assertCompanyReference(ref, 'CONTENT_ADDRESSED', 'identity.company_rule_grant');
        const grant = await trx
          .selectFrom('identity_policy.company_rule_authority')
          .selectAll()
          .where('id', '=', ref.objectId)
          .where('kind', '=', 'GRANT')
          .executeTakeFirst();
        if (!grant || !sameCompanyValue(companyHash(grant.payload), ref.contentHash)) denied();
        await insertAuthority(
          trx,
          newUuidV7(),
          'REVOCATION',
          grant.principal_id,
          {
            kind: 'REVOCATION',
            principalId: grant.principal_id,
            grantRef: ref,
            revokedByPrincipalId: session.principalId,
            authenticationContextHash: session.authenticationContextHash,
            effectiveAt: now().toISOString(),
          },
          grant.id,
        );
        await sessionValid(session);
        if ((await principalKind(trx, session.principalId)) !== 'HUMAN') denied();
      });
    },
    async authorize(session, operation, target, request, humanIntent) {
      intentValid(operation, target);
      await sessionValid(session);
      return withCompanyRuleTransaction(config.db, session, undefined, async (trx) => {
        const kind = await principalKind(trx, session.principalId);
        let approval: CompanyRuleAuthorizationProof | undefined;
        if (kind === 'SERVICE' && writes.has(operation)) {
          if (!humanIntent) denied();
          approval = await humanApproval(humanIntent, operation, target, request);
        } else if (humanIntent !== undefined) denied();
        const grants = await trx
          .selectFrom('identity_policy.company_rule_authority')
          .selectAll()
          .where('kind', '=', 'GRANT')
          .where('principal_id', '=', session.principalId)
          .execute();
        let selected: { ref: Common.ContentAddressedRef; grant: GrantPayload } | undefined;
        for (const row of grants) {
          const p = row.payload as GrantPayload;
          if (p.operation !== operation || !sameCompanyValue(p.target, target)) continue;
          const ref = authorityRef(row.id, 'identity.company_rule_grant', p);
          try {
            selected = {
              ref,
              grant: await grantValid(trx, ref, session.principalId, operation, target),
            };
            break;
          } catch (error) {
            if (!(error instanceof CompanyStartupError)) throw error;
          }
        }
        if (!selected) denied();
        const actorId = newUuidV7(),
          decisionId = newUuidV7();
        const a: ActorPayload = {
          kind: 'ACTOR',
          principalId: session.principalId,
          principalKind: kind,
          scope: {},
          authenticationContextHash: session.authenticationContextHash,
          expiresAt: session.expiresAt,
        };
        const actorSnapshotRef: Common.SnapshotRef = {
          kind: 'SNAPSHOT',
          objectType: 'identity.actor_snapshot',
          objectId: actorId,
          snapshotId: actorId,
          scope: {},
          contentHash: companyHash(a),
        };
        const d: DecisionPayload = {
          kind: 'DECISION',
          principalId: session.principalId,
          principalKind: kind,
          actorSnapshotRef,
          grantRef: selected.ref,
          operation,
          version: '1.0',
          purpose: operation,
          action: operation,
          target,
          requestHash: companyHash(request),
          outcome: 'ALLOW',
          issuedAt: now().toISOString(),
          expiresAt: new Date(
            Math.min(
              now().getTime() + 300_000,
              new Date(session.expiresAt).getTime(),
              new Date(selected.grant.validUntil).getTime(),
            ),
          ).toISOString(),
          ...(approval ? { humanIntent: approval } : {}),
        };
        await insertAuthority(trx, actorId, 'ACTOR', session.principalId, a);
        await insertAuthority(
          trx,
          decisionId,
          'DECISION',
          session.principalId,
          d,
          selected.ref.objectId,
        );
        const proof: CompanyRuleAuthorizationProof = {
          session,
          actorSnapshotRef,
          authorizationDecisionRef: authorityRef(decisionId, 'identity.authorization_decision', d),
        };
        await sessionValid(session);
        if ((await principalKind(trx, session.principalId)) !== kind) denied();
        await grantValid(trx, selected.ref, session.principalId, operation, target);
        if (approval) await humanApproval(approval, operation, target, request);
        return proof;
      });
    },
  };
}
