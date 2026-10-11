// IM-02 WI-07 (issue #35): identity.link_external_identity@1.0 and
// identity.resolve_principal@1.0 application services. Raw external
// identifiers (open_id / email / phone) only ever flow through the crypto
// ports: events, audits and errors carry keyed lookup hashes and ciphertext
// metadata exclusively (IP-API-C-001); there is no directory enumeration.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Common, IdentityPolicy } from '@zhiju/contracts';
import type { Kysely } from 'kysely';
import {
  withIdentityTransaction,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import { executeIdentityCommand, type CommandResult } from '../persistence/command-runner.js';
import {
  IDENTITY_EXTERNAL_LINK_CONFLICT,
  type ExternalIdentityLinkView,
  type IdentityPolicyRepository,
} from '../persistence/identity-policy-repository.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';
import { externalIdentityLinkedPayload } from './events.js';

export const IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED = 'IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED';
export const IDENTITY_PRINCIPAL_NOT_FOUND = 'IDENTITY_PRINCIPAL_NOT_FOUND';

export interface LinkExternalIdentityInput {
  principalId: string;
  providerCode: string;
  /** Sensitive: never persisted in clear, never logged, never in events. */
  accountExternalId: string;
  /** Sensitive subject external id. */
  subjectExternalId: string;
  verifiedAt: Date;
  verificationMethod: string;
  evidenceRefs: CanonicalJsonObject;
  displayHint?: string | undefined;
  linkId?: string | undefined;
  idempotencyKey: string;
}

export interface IdentityCommandDeps {
  readonly db: Kysely<IdentityPolicyDb>;
  readonly repo: IdentityPolicyRepository;
  readonly crypto: IdentityCryptoPorts;
  readonly context: IdentityTransactionContext;
}

export async function linkExternalIdentity(
  deps: IdentityCommandDeps,
  input: LinkExternalIdentityInput,
): Promise<CommandResult> {
  const commandId = newUuidV7();
  const linkId = input.linkId ?? newUuidV7();
  const providerCode = input.providerCode.trim().toLowerCase();
  const accountExternalId = input.accountExternalId.trim().toLowerCase();
  const subjectExternalId = input.subjectExternalId.trim().toLowerCase();
  const accountLookup = deps.crypto.lookupHash.computeKeyedLookupHash(
    `${providerCode}:${accountExternalId}`,
  );
  const subjectLookup = deps.crypto.lookupHash.computeKeyedLookupHash(
    `${providerCode}:${subjectExternalId}`,
  );
  const verifiedAtMs = input.verifiedAt.getTime();
  const verifiedAt = Number.isFinite(verifiedAtMs)
    ? input.verifiedAt.toISOString()
    : 'INVALID_DATE';
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.link_external_identity',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:link_external_identity',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        principalRef: { objectType: 'Principal', objectId: input.principalId },
        providerCode,
        verifiedAt,
        verificationMethod: input.verificationMethod.trim(),
        // requestPayload carries hashes only; raw identifiers are never
        // persisted anywhere, including receipts.
        accountLookupHash: accountLookup.hash.toString('hex'),
        accountLookupHashAlgorithm: accountLookup.algorithm,
        accountLookupKeyVersion: accountLookup.keyVersion,
        subjectLookupHash: subjectLookup.hash.toString('hex'),
        subjectLookupHashAlgorithm: subjectLookup.algorithm,
        subjectLookupKeyVersion: subjectLookup.keyVersion,
        evidenceRefs: input.evidenceRefs,
        ...(input.displayHint !== undefined ? { displayHint: input.displayHint } : {}),
        ...(input.linkId !== undefined ? { linkId: input.linkId } : {}),
      },
      platform: true,
      enterpriseId: deps.context.enterpriseId,
      targetType: 'ExternalIdentityLink',
      targetId: linkId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      // Validation stays inside the command runner so the rejection receives
      // a durable receipt and audit record.
      if (
        !input.verificationMethod.trim() ||
        !Number.isFinite(verifiedAtMs) ||
        verifiedAtMs > Date.now() + 60_000
      ) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED,
          safeSummary:
            'external identity must carry a verification method and a past verification time',
        };
      }
      const principal = await deps.repo.getPrincipalById(execution.trx, input.principalId);
      if (!principal) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_PRINCIPAL_NOT_FOUND,
          safeSummary: 'principal ref does not resolve',
        };
      }
      // Pre-check the keyed lookup so the business rejection stays inside a
      // live transaction (a raw 23505 would abort it); the database unique
      // constraint remains the adjudicator for concurrent races.
      const existing = await deps.repo.findExternalIdentityLinkByLookup(
        execution.trx,
        input.providerCode,
        input.accountExternalId,
        input.subjectExternalId,
      );
      if (existing) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_EXTERNAL_LINK_CONFLICT,
          safeSummary: 'external identity already linked; the first mapping is kept',
        };
      }
      const inserted = await deps.repo.insertExternalIdentityLink(execution.trx, {
        id: linkId,
        providerCode,
        accountExternalId: input.accountExternalId,
        subjectExternalId: input.subjectExternalId,
        displayHint: input.displayHint,
        principalId: input.principalId,
        verifiedAt: input.verifiedAt,
        verificationMethod: input.verificationMethod.trim(),
        evidenceRefs: input.evidenceRefs,
        createdByPrincipalId: deps.context.principalId,
        createdByActorSnapshotId: deps.context.actorSnapshotId,
      });
      if (!inserted) {
        // ON CONFLICT DO NOTHING keeps the transaction usable for the
        // durable business rejection and its receipt/audit rows.
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_EXTERNAL_LINK_CONFLICT,
          safeSummary: 'external identity already linked; the first mapping is kept',
        };
      }
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.ExternalIdentityLinked',
        eventVersion: '1.0',
        aggregateType: 'identity.external_identity_link',
        aggregateId: linkId,
        aggregateVersion: '1',
        payload: externalIdentityLinkedPayload({
          linkId,
          principalId: input.principalId,
          providerCode,
          accountLookupHash: accountLookup.hash,
          accountLookupHashAlgorithm: accountLookup.algorithm,
          accountLookupKeyVersion: accountLookup.keyVersion,
          subjectLookupHash: subjectLookup.hash,
          subjectLookupHashAlgorithm: subjectLookup.algorithm,
          subjectLookupKeyVersion: subjectLookup.keyVersion,
          scope: { enterpriseId: deps.context.enterpriseId },
        }),
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          externalIdentityLinkRef: {
            kind: 'OBJECT',
            objectType: 'identity.external_identity_link',
            objectId: linkId,
            scope: { enterpriseId: deps.context.enterpriseId },
          },
        },
      };
    },
  );
}

export interface ResolvePrincipalInput {
  lookup:
    | { kind: 'PRINCIPAL_REF'; principalRef: Common.ObjectRef }
    | {
        kind: 'EXTERNAL_IDENTITY';
        identityKey: IdentityPolicy.ExternalIdentityKey;
      };
  /** When set, a mismatching scope folds the result to NOT_RESOLVED. */
  requiredScopeRef?: Common.ScopeRef | undefined;
  purpose: string;
}

export type PrincipalResolutionView = IdentityPolicy.PrincipalResolutionView;

function scopeMatches(
  scope: Common.ScopeRef | undefined,
  context: IdentityTransactionContext,
): boolean {
  if (scope?.enterpriseId !== undefined && scope.enterpriseId !== context.enterpriseId) {
    return false;
  }
  return scope?.projectId === undefined || context.allowedProjectIds.includes(scope.projectId);
}

export function principalReference(id: string, enterpriseId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'identity.principal',
    objectId: id,
    scope: { enterpriseId },
  };
}

export function externalIdentityLinkReference(id: string, enterpriseId: string): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'identity.external_identity_link',
    objectId: id,
    scope: { enterpriseId },
  };
}

function presentDisplayName(value: string): IdentityPolicy.ValueEnvelopeString {
  return { presence: 'PRESENT', value, evidenceRefs: [] };
}

/**
 * Resolves one principal by pre-allocated ref or by external identity.
 * No listing/enumeration path exists; unknown or scope-folded lookups
 * return undefined without revealing whether anything exists.
 */
export async function resolvePrincipal(
  deps: IdentityCommandDeps,
  input: ResolvePrincipalInput,
): Promise<PrincipalResolutionView | undefined> {
  if (!scopeMatches(input.requiredScopeRef, deps.context)) {
    return undefined;
  }
  return withIdentityTransaction(deps.db, deps.context, async (trx) => {
    if (input.lookup.kind === 'PRINCIPAL_REF') {
      if (!scopeMatches(input.lookup.principalRef.scope, deps.context)) {
        return undefined;
      }
      const principal = await deps.repo.getPrincipalById(trx, input.lookup.principalRef.objectId);
      return principal
        ? {
            principalRef: principalReference(principal.id, deps.context.enterpriseId),
            principalKind: principal.principal_kind,
            status: principal.status,
            displayName: presentDisplayName(principal.display_name),
          }
        : undefined;
    }
    const link: ExternalIdentityLinkView | undefined =
      await deps.repo.findExternalIdentityLinkByLookup(
        trx,
        input.lookup.identityKey.providerCode,
        input.lookup.identityKey.accountExternalId,
        input.lookup.identityKey.subjectExternalId,
      );
    if (link?.status !== 'ACTIVE') {
      return undefined;
    }
    const principal = await deps.repo.getPrincipalById(trx, link.principalId);
    if (principal?.status !== 'ACTIVE') {
      return undefined;
    }
    return {
      principalRef: principalReference(principal.id, deps.context.enterpriseId),
      principalKind: principal.principal_kind,
      status: principal.status,
      displayName: presentDisplayName(principal.display_name),
      resolvedByLinkRef: externalIdentityLinkReference(link.id, deps.context.enterpriseId),
    };
  });
}
