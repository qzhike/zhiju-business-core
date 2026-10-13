import { getContractRegistry, type Artifact, type Common } from '@zhiju/contracts';
import {
  createActorSnapshot,
  createMarkdownReviewAuthorizationPort,
  MARKDOWN_REVIEW_PURPOSES,
  type MarkdownReviewOperation,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import type { MarkdownReviewService, MarkdownRepresentationService } from '@zhiju/artifact';
import {
  markdownHash,
  type MarkdownReadAuthority,
  type ArtifactTransactionContext,
} from '@zhiju/artifact';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  createDecisionBoundary,
  entryError,
  record,
  type IdentityBoundaryConfig,
} from './decision-boundary.js';
import type { WorkspaceBoardSession } from './workspace-board-entries.js';

export interface MarkdownReviewEntryConfig extends IdentityBoundaryConfig {
  capabilityCodes: Readonly<Record<string, string>>;
  review: MarkdownReviewService;
  representations: MarkdownRepresentationService;
}

export function createMarkdownReviewEntry(config: MarkdownReviewEntryConfig) {
  const registry = getContractRegistry();
  const port = createMarkdownReviewAuthorizationPort(config);
  const boundary = createDecisionBoundary(config);
  const now = config.now ?? (() => new Date());
  function authority(
    session: WorkspaceBoardSession,
    payload: unknown,
    expectedScope?: Common.ScopeRef,
  ): MarkdownReadAuthority {
    const decisions = new Map<
      string,
      {
        context: ArtifactTransactionContext;
        decisionRef: Common.ContentAddressedRef;
        deps: ReturnType<typeof boundary.identityDeps>;
        watermark: string;
      }
    >();
    return {
      async authorize(rawOperation, revisionRef) {
        const operation = rawOperation as MarkdownReviewOperation;
        const { enterpriseId, projectId } = revisionRef.scope;
        if (
          !Object.hasOwn(MARKDOWN_REVIEW_PURPOSES, operation) ||
          !enterpriseId ||
          !projectId ||
          (expectedScope &&
            (expectedScope.enterpriseId !== enterpriseId || expectedScope.projectId !== projectId))
        )
          return entryError('ARTIFACT_QUERY_NOT_FOUND', 'Content unavailable');
        const scope = { scopeKind: 'PROJECT' as const, enterpriseId, projectId };
        const payloadHash = Buffer.from(markdownHash(payload).digest, 'hex');
        const key = `${operation}:${markdownHash(revisionRef).digest}`;
        let cached = decisions.get(key);
        if (!cached) {
          const actorSnapshotId = newUuidV7();
          const technical: IdentityTransactionContext = {
            kind: 'REQUEST',
            principalId: session.principalRef.objectId,
            actorSnapshotId,
            authorizationDecisionId: newUuidV7(),
            authorizationDecisionHash: Buffer.from(
              markdownHash({
                operation,
                authenticationContextHash: session.authenticationContextHash.toString('hex'),
              }).digest,
              'hex',
            ),
            authorizationDecisionExpiresAt: new Date(now().getTime() + 300_000),
            enterpriseId,
            allowedProjectIds: [projectId],
            correlationId: newUuidV7(),
          };
          const deps = boundary.identityDeps(technical);
          const actorSnapshotRef = await createActorSnapshot(deps, {
            actorSnapshotId,
            principalId: session.principalRef.objectId,
            declaredPrincipalKind: 'HUMAN',
            authenticationContextHash: session.authenticationContextHash,
            scopeKind: 'PROJECT',
            enterpriseId,
            projectId,
          });
          const issued = await port.authorize(deps, operation, {
            actorSnapshotRef,
            commandType: operation,
            commandVersion: '1.0',
            commandPayloadHash: payloadHash,
            authenticationContextHash: session.authenticationContextHash,
            targetRef: revisionRef,
          });
          if (issued.outcome !== 'ALLOW')
            return entryError('AUTHORIZATION_REVOKED', 'Content unavailable');
          const row = await boundary.readDecisionRow(issued.authorizationDecisionRef, scope);
          const context: ArtifactTransactionContext = {
            kind: 'REQUEST',
            principalId: row.principal_id,
            principalKind: 'HUMAN',
            actorSnapshotId: row.actor_snapshot_id,
            authorizationDecisionId: row.authorization_decision_id,
            authorizationDecisionHash: row.payload_hash,
            authorizationDecisionExpiresAt: row.expires_at,
            policySnapshotId: row.policy_snapshot_id,
            enterpriseId,
            allowedProjectIds: [projectId],
            correlationId: technical.correlationId,
          };
          cached = { context, decisionRef: issued.authorizationDecisionRef, deps, watermark: '' };
          decisions.set(key, cached);
        }
        const current = await port.revalidate(cached.deps, operation, {
          decisionRef: cached.decisionRef,
          expectedCommandType: operation,
          expectedCommandVersion: '1.0',
          expectedCommandPayloadHash: payloadHash,
          expectedAuthenticationContextHash: session.authenticationContextHash,
          expectedTargetRef: revisionRef,
        });
        if (!current.valid || !current.selectedGrant)
          return entryError('AUTHORIZATION_REVOKED', 'Content unavailable');
        // The current request's authentication hash includes validatedAt. Revalidate
        // it above, but bind cross-request cursors/tickets to the stable Session
        // and current grant instead of that per-request timestamp.
        const watermark = markdownHash({
          operation,
          principalId: session.principalRef.objectId,
          scope,
          grant: current.selectedGrant,
          sessionBinding: session.sessionBinding.toString('hex'),
        }).digest;
        if (cached.watermark && cached.watermark !== watermark)
          return entryError('AUTHORIZATION_REVOKED', 'Content unavailable');
        cached.watermark = watermark;
        return { context: cached.context, watermark };
      },
    };
  }
  return {
    async query(
      operation: MarkdownReviewOperation,
      value: unknown,
      session: WorkspaceBoardSession,
    ) {
      if (!registry.validateOperation(operation, '1.0', value).valid)
        return entryError('API_VALUE_INVALID', 'Invalid Markdown read');
      const envelope = record(value);
      if (envelope.consistencyRequirement !== 'AUTHORITATIVE')
        return entryError('API_VALUE_INVALID', 'Authoritative read required');
      const auth = authority(session, envelope.payload, envelope.scopeRef as Common.ScopeRef);
      let data: unknown;
      switch (operation) {
        case 'artifact.get_file_review_content':
          data = await config.review.getContent(
            auth,
            envelope.payload as Artifact.ArtifactGetFileReviewContentPayload,
          );
          break;
        case 'artifact.get_file_change_directory':
          data = await config.review.getChanges(
            auth,
            envelope.payload as Artifact.ArtifactGetFileChangeDirectoryPayload,
          );
          break;
        case 'artifact.resolve_file_review_locations':
          data = await config.review.resolveLocations(
            auth,
            envelope.payload as Artifact.ArtifactResolveFileReviewLocationsPayload,
          );
          break;
        case 'artifact.get_markdown_download':
          data = await config.representations.getDownload(
            auth,
            envelope.payload as Artifact.ArtifactGetMarkdownDownloadPayload,
          );
          break;
      }
      if (!registry.validateOperationResult(operation, '1.0', data).valid)
        return entryError('DEPENDENCY_UNAVAILABLE', 'Invalid owning result');
      const result = {
        queryId: envelope.queryId,
        status: 'OK',
        data,
        snapshotAt: now().toISOString(),
        sourceWatermarks: record(data).sourceWatermarks ?? [],
        stalenessStatus: 'FRESH',
        redactions: [],
      };
      return { ...result, resultHash: markdownHash(result) };
    },
    stream(
      session: WorkspaceBoardSession,
      representationId: string,
      ticket: string,
      signal: AbortSignal,
    ) {
      return config.representations.openStream(
        authority(session, { representationId, purpose: 'markdown-bytes-read' }),
        representationId,
        ticket,
        signal,
      );
    },
  };
}
