// IM-02 WI-07 (issue #35): identity.link_external_identity@1.0 and
// identity.resolve_principal@1.0 application services. Raw external
// identifiers (open_id / email / phone) only ever flow through the crypto
// ports: events, audits and errors carry keyed lookup hashes and ciphertext
// metadata exclusively (IP-API-C-001); there is no directory enumeration.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  withIdentityTransaction,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import { executeIdentityCommand, type CommandResult } from '../persistence/command-runner.js';
import {
  IDENTITY_EXTERNAL_LINK_CONFLICT,
  IdentityPersistenceError,
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
  if (!input.verificationMethod.trim() || input.verifiedAt.getTime() > Date.now() + 60_000) {
    return {
      status: 'REJECTED',
      errorCode: IDENTITY_EXTERNAL_IDENTITY_NOT_VERIFIED,
      safeSummary:
        'external identity must carry a verification method and a past verification time',
    };
  }

  const commandId = newUuidV7();
  const linkId = input.linkId ?? newUuidV7();
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
        providerCode: input.providerCode,
        verifiedAt: input.verifiedAt.toISOString(),
        verificationMethod: input.verificationMethod,
        // requestPayload carries hashes only; raw identifiers are never
        // persisted anywhere, including receipts.
        accountLookupHash: deps.crypto.lookupHash
          .computeKeyedLookupHash(
            `${input.providerCode.trim().toLowerCase()}:${input.accountExternalId.trim().toLowerCase()}`,
          )
          .hash.toString('hex'),
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
      try {
        await deps.repo.insertExternalIdentityLink(execution.trx, {
          id: linkId,
          providerCode: input.providerCode,
          accountExternalId: input.accountExternalId,
          subjectExternalId: input.subjectExternalId,
          displayHint: input.displayHint,
          principalId: input.principalId,
          verifiedAt: input.verifiedAt,
          verificationMethod: input.verificationMethod,
          evidenceRefs: input.evidenceRefs,
          createdByPrincipalId: deps.context.principalId,
          createdByActorSnapshotId: deps.context.actorSnapshotId,
        });
      } catch (error) {
        if (
          error instanceof IdentityPersistenceError &&
          error.code === IDENTITY_EXTERNAL_LINK_CONFLICT
        ) {
          // Provider/account/subject already mapped: keep the first mapping.
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_EXTERNAL_LINK_CONFLICT,
            safeSummary: 'external identity already linked; the first mapping is kept',
          };
        }
        throw error;
      }
      const lookupHash = deps.crypto.lookupHash.computeKeyedLookupHash(
        `${input.providerCode.trim().toLowerCase()}:${input.accountExternalId.trim().toLowerCase()}`,
      );
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.ExternalIdentityLinked',
        eventVersion: '1.0',
        aggregateType: 'ExternalIdentityLink',
        aggregateId: linkId,
        aggregateVersion: '1',
        payload: externalIdentityLinkedPayload({
          linkId,
          principalId: input.principalId,
          providerCode: input.providerCode.trim().toLowerCase(),
          lookupHash: lookupHash.hash,
          lookupHashAlgorithm: lookupHash.algorithm,
          canonicalizationVersion: '1',
        }),
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          externalIdentityLinkRef: {
            objectType: 'ExternalIdentityLink',
            objectId: linkId,
          },
        },
      };
    },
  );
}

export interface ResolvePrincipalInput {
  lookup:
    | { kind: 'PRINCIPAL_REF'; principalId: string }
    | {
        kind: 'EXTERNAL_IDENTITY';
        providerCode: string;
        /** Sensitive: only hashed for lookup, never persisted or logged. */
        accountExternalId: string;
        subjectExternalId: string;
      };
  /** When set, a mismatching scope folds the result to NOT_RESOLVED. */
  requiredEnterpriseId?: string | undefined;
  purpose: string;
}

export interface PrincipalResolutionView {
  principalRef: { objectType: 'Principal'; objectId: string };
  principalKind: string;
  status: string;
  displayName: string;
  resolvedByLinkRef?: { objectType: 'ExternalIdentityLink'; objectId: string };
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
  if (
    input.requiredEnterpriseId !== undefined &&
    input.requiredEnterpriseId !== deps.context.enterpriseId
  ) {
    return undefined;
  }
  return withIdentityTransaction(deps.db, deps.context, async (trx) => {
    if (input.lookup.kind === 'PRINCIPAL_REF') {
      const principal = await deps.repo.getPrincipalById(trx, input.lookup.principalId);
      return principal
        ? {
            principalRef: { objectType: 'Principal', objectId: principal.id },
            principalKind: principal.principal_kind,
            status: principal.status,
            displayName: principal.display_name,
          }
        : undefined;
    }
    const link: ExternalIdentityLinkView | undefined =
      await deps.repo.findExternalIdentityLinkByLookup(
        trx,
        input.lookup.providerCode,
        input.lookup.accountExternalId,
        input.lookup.subjectExternalId,
      );
    if (link?.status !== 'ACTIVE') {
      return undefined;
    }
    const principal = await deps.repo.getPrincipalById(trx, link.principalId);
    if (principal?.status !== 'ACTIVE') {
      return undefined;
    }
    return {
      principalRef: { objectType: 'Principal', objectId: principal.id },
      principalKind: principal.principal_kind,
      status: principal.status,
      displayName: principal.display_name,
      resolvedByLinkRef: { objectType: 'ExternalIdentityLink', objectId: link.id },
    };
  });
}
