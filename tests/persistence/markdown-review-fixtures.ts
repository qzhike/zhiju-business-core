// #279: lawful owning Human ART setup, real IP grants and actual stored bytes.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { Artifact, Common, IntegrationGateway } from '@zhiju/contracts';
import {
  canonicalizeCanonicalContentPayload,
  newUuidV7,
  type CanonicalContentPayload,
  type CanonicalJsonObject,
} from '@zhiju/shared-kernel';
import {
  createArtifactDatabase,
  InMemoryObjectStorage,
  stageCanonicalContent,
  linkCanonicalContent,
  freezeCanonicalContent,
  handleCreateArtifact,
  handleCreateAndSealRevision,
  MarkdownReviewService,
  MarkdownRepresentationService,
  markdownHash,
  markdownBytesHash,
  exactMarkdownRevision,
  parseMarkdownDocument,
  type ArtifactTransactionContext,
  type CommandEnvelope,
} from '@zhiju/artifact';
import {
  createIntegrationRendererDatabase,
  MarkdownRenderService,
  MARKDOWN_RENDERER_PROFILE,
  renderMarkdownDocument,
} from '@zhiju/integration-gateway';
import {
  createIdentityPolicyDatabase,
  IdentityPolicyRepository,
  withIdentityTransaction,
  MARKDOWN_REVIEW_PURPOSES,
  MARKDOWN_SERVICE_PURPOSES,
} from '@zhiju/identity-policy';
import { createMarkdownRenderSource } from '../../apps/api/src/composition/markdown-render-source.js';
import { createMarkdownServiceAuthority } from '../../apps/api/src/composition/markdown-service-authority.js';
import { markdownReviewLink } from '../../apps/api/src/composition/markdown-review-link.js';
import { createFixtureCrypto, type ProvisionedWorkspace } from './trusted-http-fixtures.js';

export const MARKDOWN_CAPABILITIES = Object.fromEntries(
  [...Object.keys(MARKDOWN_REVIEW_PURPOSES), ...Object.keys(MARKDOWN_SERVICE_PURPOSES)].map(
    (operation) => [operation, `${operation}.v1`],
  ),
);
export function markdownQuery(type: string, scopeRef: Common.ScopeRef, payload: unknown) {
  return {
    queryId: newUuidV7(),
    type,
    version: '1.0',
    scopeRef,
    consistencyRequirement: 'AUTHORITATIVE',
    correlationId: newUuidV7(),
    requestedAt: new Date().toISOString(),
    payload,
  };
}
export function owningEnvelope<T>(
  context: ArtifactTransactionContext,
  operation: string,
  targetType: string,
  targetId: string,
  payload: T,
): CommandEnvelope & { payload: T } {
  return {
    commandId: newUuidV7(),
    commandType: operation,
    commandVersion: '1.0',
    idempotencyScope: `markdown-${context.enterpriseId}`,
    idempotencyKey: newUuidV7(),
    requestPayload: payload as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    projectId: requiredValue(context.allowedProjectIds[0]),
    targetType,
    targetId,
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
    payload,
  };
}
function committed(result: {
  status: string;
  resultPayload?: CanonicalJsonObject | null;
}): CanonicalJsonObject {
  if (result.status !== 'COMMITTED' || !result.resultPayload)
    throw new Error(`Owning setup rejected: ${JSON.stringify(result)}`);
  return result.resultPayload;
}

export async function provisionMarkdownReview(input: {
  databaseUrl: string;
  workspace: ProvisionedWorkspace;
  lookupKey: Buffer;
  fieldKey: Buffer;
}) {
  const { workspace } = input;
  const pool = new pg.Pool({ connectionString: input.databaseUrl, max: 12 });
  const db = createArtifactDatabase(pool);
  const identityDb = createIdentityPolicyDatabase(pool);
  const integrationDb = createIntegrationRendererDatabase(pool);
  const crypto = createFixtureCrypto(input.lookupKey, input.fieldKey);
  const repo = new IdentityPolicyRepository(crypto);
  const identity = { db: identityDb, repo, crypto };
  const scope = { enterpriseId: workspace.enterpriseId, projectId: workspace.projectId };
  const context: ArtifactTransactionContext = {
    kind: 'REQUEST',
    principalId: workspace.principalId,
    principalKind: 'HUMAN',
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: Buffer.alloc(32, 0x79),
    authorizationDecisionExpiresAt: new Date(Date.now() + 3600_000),
    policySnapshotId: newUuidV7(),
    enterpriseId: scope.enterpriseId,
    allowedProjectIds: [scope.projectId],
    correlationId: newUuidV7(),
  };
  const grantIds = new Map<string, string>();
  await withIdentityTransaction(identityDb, context, async (trx) => {
    const prior = (
      await repo.listActiveCapabilityGrants(
        trx,
        workspace.principalId,
        scope.enterpriseId,
        new Date(),
      )
    )[0];
    if (!prior?.grant_policy_snapshot_id) throw new Error('Trusted workspace policy missing');
    for (const [operation, purpose] of Object.entries({
      ...MARKDOWN_REVIEW_PURPOSES,
      ...MARKDOWN_SERVICE_PURPOSES,
    })) {
      const id = newUuidV7();
      grantIds.set(operation, id);
      await repo.insertCapabilityGrant(trx, {
        id,
        principalId:
          operation in MARKDOWN_REVIEW_PURPOSES
            ? workspace.principalId
            : workspace.servicePrincipalId,
        code: requiredValue(MARKDOWN_CAPABILITIES[operation]),
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        validFrom: new Date(Date.now() - 60_000),
        justification: 'Controlled Markdown review acceptance',
        createdByPrincipalId: context.principalId,
        createdByActorSnapshotId: context.actorSnapshotId,
        resourceSelectors: [
          { selectorType: 'TARGET_TYPE', objectType: 'artifact.artifact_revision' },
          ...(operation === 'integration.get_markdown_render_binding'
            ? [{ selectorType: 'TARGET_TYPE', objectType: 'integration.render_attempt' }]
            : []),
        ],
        actions: [`${purpose}.v1`],
        grantPolicySnapshotId: prior.grant_policy_snapshot_id,
        grantPolicySnapshotHash: prior.grant_policy_snapshot_hash,
      });
    }
  });
  const storage = new InMemoryObjectStorage();
  const rendererDigest = markdownBytesHash(
    readFileSync(
      new URL(
        '../../modules/integration-gateway/src/renderer/deterministic-markdown-renderer.ts',
        import.meta.url,
      ),
    ),
  );
  const review = new MarkdownReviewService({
    db,
    storage,
    render: (content) => renderMarkdownDocument(content).bytes,
    tokenKey: Buffer.alloc(32, 0x79),
  });
  const service = (payloadFor: (operation: string) => unknown) =>
    createMarkdownServiceAuthority({
      identity,
      capabilityCodes: MARKDOWN_CAPABILITIES,
      allowedServicePrincipalIds: [workspace.servicePrincipalId],
      principalId: workspace.servicePrincipalId,
      authenticationContextHash: Buffer.alloc(32, 0x80),
      payloadFor,
    });
  const artifactId = newUuidV7();
  const artifact = committed(
    await handleCreateArtifact(
      db,
      context,
      owningEnvelope(context, 'artifact.create_artifact', 'Artifact', artifactId, {
        enterpriseRef: {
          kind: 'OBJECT',
          objectType: 'Enterprise',
          objectId: scope.enterpriseId,
          scope: { enterpriseId: scope.enterpriseId },
        },
        definition: {
          businessScope: 'PROJECT_DELIVERABLE',
          originProjectRef: {
            kind: 'OBJECT',
            objectType: 'Project',
            objectId: scope.projectId,
            scope,
          },
          artifactType: 'CONTROL_PROCEDURE',
          title: '采购控制程序',
          classification: 'CUSTOMER_DELIVERY',
          deliveryItemRefs: [
            {
              kind: 'VERSIONED',
              objectType: 'DeliveryItem',
              objectId: newUuidV7(),
              versionId: newUuidV7(),
              scope,
            },
          ],
          metadata: { issue: 279 },
        },
      }),
    ),
  );
  const artifactRef: Common.ObjectRef = {
    ...(artifact.artifactRef as unknown as Common.ObjectRef),
    objectType: 'artifact.artifact',
  };
  const branchId = requiredValue(
    (artifact.workingHeads as unknown as { branchId: string }[])[0],
  ).branchId;
  const text =
    Array.from(
      { length: 9 },
      (_, chapter) =>
        `# ${chapter + 1} 采购控制章节\n\n${Array.from({ length: 4 }, (_, n) => `原有要求 ${chapter + 1}.${n + 1}：保留原始采购记录。`).join('\n\n')}`,
    ).join('\n\n') +
    '\n\n| C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n| 0 |  | 三 | 四 | 五 | 六 | 七 | 八 | 九 | 十 | 十一 | 最后一列完整 |\n';
  const parsed = parseMarkdownDocument({
    bytes: Buffer.from(text),
    enterpriseId: scope.enterpriseId,
    documentId: newUuidV7(),
    title: '采购控制程序',
    documentMetadata: { fileKind: 'PROCEDURE', fileCode: 'QP-07' },
    identityDerivation: {
      originalIntentRef: 'ISSUE_279_CONTROLLED_HUMAN_SETUP',
      candidateOutputId: artifactId,
    },
  });
  const before = parsed.content;
  const after: Artifact.MarkdownDocumentContent = {
    ...before,
    body: {
      ...before.body,
      units: before.body.units.map((unit) =>
        unit.unitType === 'PARAGRAPH' && 'text' in unit
          ? {
              ...unit,
              text: unit.text
                .replace('原有要求', '更新要求')
                .replace('保留原始采购记录', '核对供应商并保留完整采购记录'),
            }
          : unit,
      ),
    },
  };
  async function seal(
    content: Artifact.MarkdownDocumentContent,
    parents: Common.ContentAddressedRef[] = [],
  ) {
    const revisionId = newUuidV7();
    const objectId = newUuidV7();
    const canonical = canonicalizeCanonicalContentPayload(
      content as unknown as CanonicalContentPayload,
    );
    const contentHash = markdownBytesHash(Buffer.from(canonical));
    const staged = committed(
      await stageCanonicalContent(
        db,
        context,
        owningEnvelope(context, 'artifact.content.stage', 'CanonicalContentObject', objectId, {
          content,
          declaredContentHash: contentHash,
        }),
        storage,
      ),
    );
    const linked = await linkCanonicalContent(
      db,
      context,
      owningEnvelope(context, 'artifact.content.link', 'CanonicalContentObject', objectId, {
        ownerObjectType: 'ArtifactRevision',
        ownerObjectId: revisionId,
        ownerVersionId: revisionId,
      }),
      storage,
    );
    committed(linked.commandResult);
    if (linked.finalizationState !== 'FINALIZED')
      throw new Error('Canonical object was not finalized');
    committed(
      await freezeCanonicalContent(
        db,
        context,
        owningEnvelope(context, 'artifact.content.freeze', 'CanonicalContentObject', objectId, {}),
      ),
    );
    const revision: Artifact.RevisionContent = {
      artifactRef,
      branchId,
      parentRevisionRefs: parents,
      contentType: 'STRUCTURED_DOCUMENT',
      contentRef: staged.objectRef as string,
      contentHash,
      structureSchemaRef: content.schemaRef,
      semanticMetadata: { issue: 279 },
      changedUnits: content.body.units.map((unit) => unit.unitId),
      changeSummary: 'Controlled exact Markdown revision',
      provenance: {
        principal: {
          kind: 'OBJECT',
          objectType: 'identity.principal',
          objectId: context.principalId,
          scope: { enterpriseId: scope.enterpriseId },
        },
        sourceMaterialRefs: [],
        toolchainVersions: [{ name: 'controlled-human-setup', version: '1.0' }],
      },
    };
    return committed(
      await handleCreateAndSealRevision(
        db,
        context,
        owningEnvelope(
          context,
          'artifact.create_and_seal_revision',
          'ArtifactRevision',
          revisionId,
          { revision },
        ),
      ),
    ) as unknown as Artifact.RevisionSnapshot;
  }
  const from = await seal(before);
  const to = await seal(after, [from.revisionRef]);
  const canonical = createMarkdownRenderSource({
    review,
    authorityFor: (revisionRef) => service(() => ({ revisionRef })).artifact,
  });
  const renderer = new MarkdownRenderService({
    db: integrationDb,
    storage,
    canonical,
    rendererDigest,
  });
  const requests = new Map<string, IntegrationGateway.MarkdownRenderRequest>();
  const renderAuthority = (attemptRef: Common.ObjectRef) =>
    service((operation) =>
      operation === 'integration.request_markdown_render'
        ? requests.get(attemptRef.objectId)
        : { attemptRef },
    ).integration;
  const representations = new MarkdownRepresentationService({
    db,
    review,
    rendererDigest,
    tokenKey: Buffer.alloc(32, 0x81),
    binding: { read: (ref) => renderer.readOutput(renderAuthority(ref), ref) },
  });
  async function prepareRenderCommand(revisionRef = to.revisionRef) {
    const source = await canonical.read(revisionRef);
    const attemptRef: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: 'integration.render_attempt',
      objectId: newUuidV7(),
      scope,
    };
    const payload: IntegrationGateway.MarkdownRenderRequest = {
      revisionRef: exactMarkdownRevision(revisionRef),
      canonicalContentRef: source.canonicalContentRef,
      inputHash: revisionRef.contentHash,
      outputFormat: 'zhiju.markdown',
      rendererId: MARKDOWN_RENDERER_PROFILE.rendererId,
      rendererVersion: MARKDOWN_RENDERER_PROFILE.rendererVersion,
      markdownProfileRef: source.content.schemaRef,
      structureSchemaRef: source.content.schemaRef,
      rendererDigest,
      identityMapHash: markdownHash(source.identityMap),
    };
    requests.set(attemptRef.objectId, payload);
    const command = {
      commandId: newUuidV7(),
      attemptRef,
      idempotencyScope: `markdown-${scope.projectId}`,
      idempotencyKey: newUuidV7(),
      payload,
    };
    return { attemptRef, command, authority: renderAuthority(attemptRef) };
  }
  async function renderRequest(revisionRef = to.revisionRef, rendererInstance = renderer) {
    const prepared = await prepareRenderCommand(revisionRef);
    const { attemptRef, command, authority } = prepared;
    const receipt = await rendererInstance.request(authority, command);
    return { attemptRef, command, receipt, authority };
  }
  async function grant(operation: string) {
    const purposes: Record<string, string> = {
      ...MARKDOWN_REVIEW_PURPOSES,
      ...MARKDOWN_SERVICE_PURPOSES,
    };
    const purpose = purposes[operation];
    if (!purpose) throw new Error(`Unsupported controlled Markdown grant: ${operation}`);
    const id = newUuidV7();
    await withIdentityTransaction(identityDb, context, async (trx) => {
      const prior = (
        await repo.listActiveCapabilityGrants(
          trx,
          workspace.principalId,
          scope.enterpriseId,
          new Date(),
        )
      )[0];
      if (!prior?.grant_policy_snapshot_id) throw new Error('Trusted workspace policy missing');
      await repo.insertCapabilityGrant(trx, {
        id,
        principalId:
          operation in MARKDOWN_REVIEW_PURPOSES
            ? workspace.principalId
            : workspace.servicePrincipalId,
        code: requiredValue(MARKDOWN_CAPABILITIES[operation]),
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        validFrom: new Date(Date.now() - 60_000),
        justification: 'Controlled Markdown authorization-boundary recovery',
        createdByPrincipalId: context.principalId,
        createdByActorSnapshotId: context.actorSnapshotId,
        resourceSelectors: [
          { selectorType: 'TARGET_TYPE', objectType: 'artifact.artifact_revision' },
          ...(operation === 'integration.get_markdown_render_binding'
            ? [{ selectorType: 'TARGET_TYPE', objectType: 'integration.render_attempt' }]
            : []),
        ],
        actions: [`${purpose}.v1`],
        grantPolicySnapshotId: prior.grant_policy_snapshot_id,
        grantPolicySnapshotHash: prior.grant_policy_snapshot_hash,
      });
    });
    grantIds.set(operation, id);
    return id;
  }
  async function register(attemptRef: Common.ObjectRef) {
    const payload = {
      revisionRef: exactMarkdownRevision(to.revisionRef),
      renderAttemptRef: attemptRef,
    };
    const auth = service(() => payload).artifact;
    const authorized = await auth.authorize(
      'artifact.register_markdown_representation',
      to.revisionRef,
    );
    const envelope = owningEnvelope(
      authorized.context,
      'artifact.register_markdown_representation',
      'artifact.representation',
      newUuidV7(),
      payload,
    );
    const result = committed(
      await representations.register(auth, envelope),
    ) as unknown as Artifact.ArtifactRegisterMarkdownRepresentationResult;
    return { ...result, envelope, authority: auth };
  }
  const requested = await renderRequest();
  const binding = await renderer.work(requested.authority, requested.attemptRef);
  if (binding.status !== 'SUCCEEDED')
    throw new Error(`Markdown rendering failed: ${JSON.stringify(binding)}`);
  const registered = await register(requested.attemptRef);
  const representationRef = registered.representationRef;
  return {
    workspace,
    scope,
    identity,
    context,
    storage,
    db,
    integrationDb,
    canonical,
    rendererDigest,
    renderer,
    grant,
    prepareRenderCommand,
    review,
    representations,
    service,
    renderRequest,
    register,
    requested,
    registered,
    representationRef,
    before,
    after,
    from,
    to,
    artifactRef,
    capabilityCodes: MARKDOWN_CAPABILITIES,
    link: markdownReviewLink({
      artifactRef,
      revisionRef: to.revisionRef,
      fromRevisionRef: from.revisionRef,
      representationRef,
    }),
    revoke: async (operation: string) =>
      withIdentityTransaction(identityDb, context, (trx) =>
        repo.markCapabilityGrantRevoked(trx, requiredValue(grantIds.get(operation)), newUuidV7()),
      ),
    close: () => pool.end(),
  };
}
export type MarkdownFixture = Awaited<ReturnType<typeof provisionMarkdownReview>>;

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
