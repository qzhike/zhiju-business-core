import type { Common } from '@zhiju/contracts';
import {
  createActorSnapshot,
  createMarkdownServiceAuthorizationPort,
  type MarkdownServiceOperation,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import { markdownHash, type ArtifactTransactionContext } from '@zhiju/artifact';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  createDecisionBoundary,
  entryError,
  type IdentityBoundaryConfig,
} from './decision-boundary.js';

/** Trusted composition only: no browser endpoint accepts this Service identity. */
export function createMarkdownServiceAuthority(
  config: IdentityBoundaryConfig & {
    capabilityCodes: Readonly<Record<string, string>>;
    allowedServicePrincipalIds: readonly string[];
    principalId: string;
    authenticationContextHash: Buffer;
    /** The original command/query payload, obtained from its owning entry or Attempt. */
    payloadFor(operation: string): unknown;
  },
) {
  const boundary = createDecisionBoundary(config);
  const port = createMarkdownServiceAuthorizationPort(config);
  const now = config.now ?? (() => new Date());
  const decisions = new Map<
    string,
    {
      context: ArtifactTransactionContext;
      decisionRef: Common.ContentAddressedRef;
      deps: ReturnType<typeof boundary.identityDeps>;
      watermark: string;
    }
  >();
  async function read(operation: string, target: Common.ObjectRef | Common.ContentAddressedRef) {
    const { enterpriseId, projectId } = target.scope;
    if (
      !enterpriseId ||
      !projectId ||
      !config.allowedServicePrincipalIds.includes(config.principalId)
    )
      return entryError('AUTHORIZATION_REVOKED', 'Service authority unavailable');
    const payloadHash = Buffer.from(markdownHash(config.payloadFor(operation)).digest, 'hex');
    const key = markdownHash({
      operation,
      target,
      payloadHash: payloadHash.toString('hex'),
    }).digest;
    let cached = decisions.get(key);
    if (!cached) {
      const technical: IdentityTransactionContext = {
        kind: 'REQUEST',
        principalId: config.principalId,
        actorSnapshotId: newUuidV7(),
        authorizationDecisionId: newUuidV7(),
        authorizationDecisionHash: config.authenticationContextHash,
        authorizationDecisionExpiresAt: new Date(now().getTime() + 300_000),
        enterpriseId,
        allowedProjectIds: [projectId],
        correlationId: newUuidV7(),
      };
      const deps = boundary.identityDeps(technical);
      const actorSnapshotRef = await createActorSnapshot(deps, {
        actorSnapshotId: technical.actorSnapshotId,
        principalId: config.principalId,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: config.authenticationContextHash,
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      const issued = await port.authorize(deps, operation as MarkdownServiceOperation, {
        actorSnapshotRef,
        commandType: operation,
        commandVersion: '1.0',
        commandPayloadHash: payloadHash,
        authenticationContextHash: config.authenticationContextHash,
        targetRef: target,
      });
      if (issued.outcome !== 'ALLOW')
        return entryError('AUTHORIZATION_REVOKED', 'Service authority unavailable');
      const row = await boundary.readDecisionRow(issued.authorizationDecisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId,
        projectId,
      });
      cached = {
        context: {
          kind: 'REQUEST',
          principalId: row.principal_id,
          principalKind: 'SERVICE',
          actorSnapshotId: row.actor_snapshot_id,
          authorizationDecisionId: row.authorization_decision_id,
          authorizationDecisionHash: row.payload_hash,
          authorizationDecisionExpiresAt: row.expires_at,
          policySnapshotId: row.policy_snapshot_id,
          enterpriseId,
          allowedProjectIds: [projectId],
          correlationId: technical.correlationId,
        },
        decisionRef: issued.authorizationDecisionRef,
        deps,
        watermark: '',
      };
      decisions.set(key, cached);
    }
    const current = await port.revalidate(cached.deps, operation as MarkdownServiceOperation, {
      decisionRef: cached.decisionRef,
      expectedCommandType: operation,
      expectedCommandVersion: '1.0',
      expectedCommandPayloadHash: payloadHash,
      expectedAuthenticationContextHash: config.authenticationContextHash,
      expectedTargetRef: target,
    });
    if (!current.valid || !current.selectedGrant)
      return entryError('AUTHORIZATION_REVOKED', 'Service authority unavailable');
    const watermark = markdownHash({
      operation,
      target,
      principalId: config.principalId,
      grant: current.selectedGrant,
      authenticationContextHash: config.authenticationContextHash.toString('hex'),
    }).digest;
    if (cached.watermark && cached.watermark !== watermark)
      return entryError('AUTHORIZATION_REVOKED', 'Service authority unavailable');
    cached.watermark = watermark;
    return { context: cached.context, watermark };
  }
  return {
    artifact: { authorize: read },
    integration: {
      authorize: async (operation: string, target: Common.ObjectRef | Common.ContentAddressedRef) =>
        (await read(operation, target)).context,
    },
  };
}
