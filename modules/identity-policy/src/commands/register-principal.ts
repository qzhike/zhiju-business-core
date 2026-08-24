// IM-02 WI-07 (issue #35): identity.register_principal@1.0 application
// service and the one-time audited bootstrap claim. The first business
// principal requires an explicit, expiring, single-use claim; the claim is
// consumed atomically in the same transaction as the principal, and the
// bootstrap admin identity itself never becomes a business Role/Capability.

import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import type { IdentityPolicyDb, IdentityTransactionContext } from '../persistence/identity-db.js';
import { executeIdentityCommand, type CommandResult } from '../persistence/command-runner.js';
import { withIdentityTransaction } from '../persistence/identity-db.js';
import { IdentityPolicyRepository } from '../persistence/identity-policy-repository.js';
import type { IdentityCryptoPorts } from '../persistence/ports.js';
import { principalRegisteredPayload } from './events.js';

export const IDENTITY_BOOTSTRAP_REQUIRED = 'IDENTITY_BOOTSTRAP_REQUIRED';
export const IDENTITY_BOOTSTRAP_CLAIM_INVALID = 'IDENTITY_BOOTSTRAP_CLAIM_INVALID';
export const IDENTITY_BOOTSTRAP_CLAIM_CONSUMED = 'IDENTITY_BOOTSTRAP_CLAIM_CONSUMED';
export const IDENTITY_BOOTSTRAP_CLAIM_EXPIRED = 'IDENTITY_BOOTSTRAP_CLAIM_EXPIRED';
export const IDENTITY_BOOTSTRAP_CLAIM_CLOSED = 'IDENTITY_BOOTSTRAP_CLAIM_CLOSED';
export const IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS =
  'IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS';
export const IDENTITY_PRINCIPAL_INVALID_KIND = 'IDENTITY_PRINCIPAL_INVALID_KIND';

export type PrincipalKind = 'HUMAN' | 'AGENT' | 'SERVICE' | 'RUNTIME' | 'EXTERNAL_PARTY';

const PRINCIPAL_KINDS: ReadonlySet<string> = new Set([
  'HUMAN',
  'AGENT',
  'SERVICE',
  'RUNTIME',
  'EXTERNAL_PARTY',
]);

export interface RegisterPrincipalInput {
  /** Pre-allocated PrincipalRef id (UUIDv7). */
  principalId: string;
  principalKind: PrincipalKind;
  displayName: string;
  /** Contract fixes the initial status to ACTIVE; validated at runtime. */
  initialStatus: string;
  /** Required when the platform has no business principal yet. */
  bootstrapClaimId?: string | undefined;
  idempotencyKey: string;
}

export interface RegisterPrincipalDeps {
  readonly db: Kysely<IdentityPolicyDb>;
  readonly repo: IdentityPolicyRepository;
  readonly crypto: IdentityCryptoPorts;
  readonly context: IdentityTransactionContext;
}

/**
 * Creates a one-time audited bootstrap claim. Operators must state who they
 * are, why the claim is needed, the evidence, and when it expires. The claim
 * grants no Role/Capability by itself.
 */
export async function createBootstrapClaim(
  deps: RegisterPrincipalDeps,
  input: {
    purpose: string;
    operatorDescription: string;
    operatorActorSnapshotId: string;
    operatorAuthorizationDecisionId: string;
    reason: string;
    evidenceRefs: CanonicalJsonObject;
    expiresAt: Date;
    claimId?: string | undefined;
  },
): Promise<{ claimId: string }> {
  const claimId = input.claimId ?? newUuidV7();
  await withIdentityTransaction(deps.db, deps.context, async (trx) => {
    await trx
      .insertInto('identity_policy.bootstrap_claim')
      .values({
        claim_id: claimId,
        purpose: input.purpose,
        operator_description: input.operatorDescription,
        operator_actor_snapshot_id: input.operatorActorSnapshotId,
        operator_authorization_decision_id: input.operatorAuthorizationDecisionId,
        reason: input.reason,
        evidence_refs: JSON.stringify(input.evidenceRefs),
        expires_at: input.expiresAt,
      })
      .execute();
  });
  return { claimId };
}

export async function registerPrincipal(
  deps: RegisterPrincipalDeps,
  input: RegisterPrincipalInput,
): Promise<CommandResult> {
  const commandId = newUuidV7();
  return executeIdentityCommand(
    deps.db,
    deps.context,
    {
      commandId,
      commandType: 'identity.register_principal',
      commandVersion: '1.0',
      idempotencyScope: 'identity_policy:register_principal',
      idempotencyKey: input.idempotencyKey,
      requestPayload: {
        principalRef: { objectType: 'Principal', objectId: input.principalId },
        principalKind: input.principalKind,
        displayName: input.displayName,
        initialStatus: input.initialStatus,
        ...(input.bootstrapClaimId !== undefined
          ? { bootstrapClaimId: input.bootstrapClaimId }
          : {}),
      },
      platform: true,
      enterpriseId: deps.context.enterpriseId,
      targetType: 'Principal',
      targetId: input.principalId,
      correlationId: deps.context.correlationId,
      principalId: deps.context.principalId,
      actorSnapshotId: deps.context.actorSnapshotId,
      authorizationDecisionId: deps.context.authorizationDecisionId,
    },
    async (execution) => {
      // Validation stays inside the command runner so invalid requests still
      // receive the same receipt and audit treatment as other rejections.
      if (!PRINCIPAL_KINDS.has(input.principalKind)) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_PRINCIPAL_INVALID_KIND,
          safeSummary: 'principalKind is not a supported closed value',
        };
      }
      if (input.initialStatus !== 'ACTIVE') {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS,
          safeSummary: 'initialStatus must be ACTIVE',
        };
      }
      if (!input.displayName.trim()) {
        return {
          kind: 'REJECTED',
          errorCode: IDENTITY_PRINCIPAL_INVALID_INITIAL_STATUS,
          safeSummary: 'displayName must not be empty',
        };
      }

      const hasPrincipals = await execution.trx
        .selectFrom('identity_policy.principal')
        .select('id')
        .limit(1)
        .execute();

      // The explicit claim is mandatory for the very first business
      // principal; whenever a claim is provided it is validated and
      // consumed regardless (single-use, expiring, closeable).
      let consumedClaim: string | null = null;
      if (input.bootstrapClaimId === undefined) {
        if (hasPrincipals.length === 0) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_BOOTSTRAP_REQUIRED,
            safeSummary: 'the first business principal requires an audited bootstrap claim',
          };
        }
      } else {
        const claim = await execution.trx
          .selectFrom('identity_policy.bootstrap_claim')
          .selectAll()
          .where('claim_id', '=', input.bootstrapClaimId)
          .forUpdate()
          .executeTakeFirst();
        if (!claim) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_BOOTSTRAP_CLAIM_INVALID,
            safeSummary: 'bootstrap claim not found',
          };
        }
        if (claim.closed_at !== null) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_BOOTSTRAP_CLAIM_CLOSED,
            safeSummary: 'bootstrap claim is permanently closed',
          };
        }
        if (claim.consumed_at !== null) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_BOOTSTRAP_CLAIM_CONSUMED,
            safeSummary: 'bootstrap claim was already used',
          };
        }
        const now = new Date();
        if (claim.expires_at <= now) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_BOOTSTRAP_CLAIM_EXPIRED,
            safeSummary: 'bootstrap claim expired',
          };
        }
        const consumed = await execution.trx
          .updateTable('identity_policy.bootstrap_claim')
          .set({
            consumed_at: now,
            consumed_by_command_id: commandId,
            consumed_result: JSON.stringify({
              principalRef: {
                kind: 'OBJECT',
                objectType: 'identity.principal',
                objectId: input.principalId,
                scope: { enterpriseId: deps.context.enterpriseId },
              },
            }),
          })
          .where('claim_id', '=', input.bootstrapClaimId)
          .where('consumed_at', 'is', null)
          .where('closed_at', 'is', null)
          .where('expires_at', '>', now)
          .returning('claim_id')
          .executeTakeFirst();
        if (!consumed) {
          return {
            kind: 'REJECTED',
            errorCode: IDENTITY_BOOTSTRAP_CLAIM_CONSUMED,
            safeSummary: 'bootstrap claim was already used',
          };
        }
        consumedClaim = consumed.claim_id;
      }

      await deps.repo.insertPrincipal(execution.trx, {
        id: input.principalId,
        principalKind: input.principalKind,
        displayName: input.displayName,
        createdByPrincipalId: deps.context.principalId,
        createdByActorSnapshotId: deps.context.actorSnapshotId,
      });
      await execution.appendOutbox({
        eventId: newUuidV7(),
        eventType: 'identity.PrincipalRegistered',
        eventVersion: '1.0',
        aggregateType: 'identity.principal',
        aggregateId: input.principalId,
        aggregateVersion: '1',
        payload: principalRegisteredPayload({
          principalId: input.principalId,
          principalKind: input.principalKind,
          status: 'ACTIVE',
          scope: { enterpriseId: deps.context.enterpriseId },
        }),
        occurredAt: new Date(),
      });
      return {
        kind: 'COMMITTED',
        resultPayload: {
          principalRef: {
            kind: 'OBJECT',
            objectType: 'identity.principal',
            objectId: input.principalId,
            scope: { enterpriseId: deps.context.enterpriseId },
          },
          status: 'ACTIVE',
          ...(consumedClaim !== null ? { bootstrapClaimConsumed: consumedClaim } : {}),
        },
      };
    },
  );
}

// The repository is constructed by the composition root; re-exporting the
// constructor keeps test/deps wiring single-sourced.
export { IdentityPolicyRepository };
