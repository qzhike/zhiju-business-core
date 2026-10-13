import { isDeepStrictEqual } from 'node:util';
import type { Kysely } from 'kysely';
import {
  getContractRegistry,
  type Artifact,
  type Common,
  type IntegrationGateway,
} from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import { withArtifactTransaction, type ArtifactDb } from '../persistence/artifact-db.js';
import { ArtifactRepository } from '../persistence/artifact-repository.js';
import {
  executeArtifactCommand,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import { representationViewForRow } from './representation-service.js';
import type { MarkdownReviewService } from './markdown-review-service.js';
import {
  MarkdownBoundTokens,
  markdownBytesHash,
  markdownHash,
  markdownNotFound,
  exactMarkdownRevision,
  type MarkdownReadAuthority,
} from './markdown-review-service.js';

const repo = new ArtifactRepository();
const registry = getContractRegistry();
const REGISTER = 'artifact.register_markdown_representation';
const DOWNLOAD = 'artifact.get_markdown_download';
const MEDIA = 'text/markdown; charset=utf-8';
export interface MarkdownRepresentationBindingPort {
  read(attemptRef: Common.ObjectRef): Promise<{
    binding: IntegrationGateway.MarkdownRenderBinding;
    bytes: Buffer;
    observedAt: string;
  }>;
}
export interface MarkdownRepresentationConfig {
  db: Kysely<ArtifactDb>;
  review: MarkdownReviewService;
  binding: MarkdownRepresentationBindingPort;
  rendererDigest: Common.ContentHash;
  tokenKey: Buffer;
  now?: () => number;
}

export class MarkdownRepresentationService {
  private readonly now: () => number;
  private readonly tokens: MarkdownBoundTokens;
  constructor(private readonly config: MarkdownRepresentationConfig) {
    this.now = config.now ?? Date.now;
    this.tokens = new MarkdownBoundTokens(config.tokenKey, this.now);
  }
  async register(
    authority: MarkdownReadAuthority,
    envelope: CommandEnvelope & { payload: Artifact.ArtifactRegisterMarkdownRepresentationPayload },
  ): Promise<CommandResult> {
    const { revisionRef, renderAttemptRef } = envelope.payload;
    const authorized = await authority.authorize(REGISTER, revisionRef);
    if (
      authorized.context.principalKind !== 'SERVICE' ||
      envelope.commandType !== REGISTER ||
      envelope.commandVersion !== '1.0' ||
      envelope.targetType !== 'artifact.representation' ||
      !isDeepStrictEqual(envelope.requestPayload, envelope.payload)
    )
      return markdownNotFound();
    const read = await this.config.review.read(authority, REGISTER, revisionRef);
    const actual = await this.config.binding.read(renderAttemptRef);
    const binding = actual.binding;
    const request = binding.originalRequest;
    const validation = binding.markdownValidation;
    const result = binding.succeededResult;
    if (
      !registry.validateOperationResult('integration.get_markdown_render_binding', '1.0', binding)
        .valid ||
      binding.status !== 'SUCCEEDED' ||
      !validation ||
      !result ||
      !binding.rawReceiptRef ||
      !isDeepStrictEqual(binding.attemptRef, renderAttemptRef) ||
      !isDeepStrictEqual(result.attemptRef, renderAttemptRef) ||
      !isDeepStrictEqual(request.revisionRef, revisionRef) ||
      !isDeepStrictEqual(result.revisionRef, revisionRef) ||
      !isDeepStrictEqual(renderAttemptRef.scope, revisionRef.scope) ||
      !isDeepStrictEqual(binding.rawReceiptRef, result.rawReceiptRef) ||
      !isDeepStrictEqual(binding.rawReceiptRef.scope, revisionRef.scope) ||
      !isDeepStrictEqual(binding.requestPayloadHash, markdownHash(request)) ||
      request.canonicalContentRef !== read.facts.revision.object_locator ||
      !isDeepStrictEqual(request.inputHash, revisionRef.contentHash) ||
      !isDeepStrictEqual(request.markdownProfileRef, read.payload.schemaRef) ||
      !isDeepStrictEqual(request.structureSchemaRef, read.payload.schemaRef) ||
      !isDeepStrictEqual(request.rendererDigest, this.config.rendererDigest) ||
      !isDeepStrictEqual(request.identityMapHash, markdownHash(read.identityMap)) ||
      request.rendererId !== result.rendererId ||
      request.rendererVersion !== result.rendererVersion ||
      !isDeepStrictEqual(validation.profileRef, request.markdownProfileRef) ||
      !isDeepStrictEqual(validation.structureSchemaRef, request.structureSchemaRef) ||
      !isDeepStrictEqual(validation.rendererDigest, request.rendererDigest) ||
      !isDeepStrictEqual(validation.identityMapHash, request.identityMapHash) ||
      !isDeepStrictEqual(validation.inputContentHash, request.inputHash) ||
      !isDeepStrictEqual(validation.roundTripContentHash, revisionRef.contentHash) ||
      !isDeepStrictEqual(validation.outputBytesSha256, result.outputChecksum) ||
      !isDeepStrictEqual(markdownBytesHash(actual.bytes), result.outputChecksum) ||
      actual.bytes.length !== validation.outputByteLength ||
      !actual.bytes.equals(read.renderedBytes) ||
      !Number.isFinite(Date.parse(actual.observedAt)) ||
      Date.parse(actual.observedAt) > this.now() ||
      read.facts.disposition !== 'ACTIVE'
    )
      return markdownNotFound();
    return executeArtifactCommand(
      this.config.db,
      authorized.context,
      envelope,
      async (execution) => {
        const created = await repo.registerMarkdownRepresentation(execution.trx, {
          representationId: envelope.targetId,
          artifactId: read.artifactRef.objectId,
          revisionId: revisionRef.objectId,
          revisionRef,
          enterpriseId: authorized.context.enterpriseId,
          projectId: revisionRef.scope.projectId,
          format: 'zhiju.markdown',
          mediaType: MEDIA,
          objectLocator: result.outputObjectRef,
          checksum: Buffer.from(result.outputChecksum.digest, 'hex'),
          rendererId: result.rendererId,
          rendererVersion: result.rendererVersion,
          renderAttemptRef,
          canonicalContentRef: request.canonicalContentRef,
          requestPayloadHash: Buffer.from(binding.requestPayloadHash.digest, 'hex'),
          inputHash: Buffer.from(request.inputHash.digest, 'hex'),
          rawReceiptRef: requiredValue(binding.rawReceiptRef),
          registeredAt: new Date(actual.observedAt),
          validationId: newUuidV7(),
          validatorId: 'artifact.markdown_round_trip',
          validatorVersion: '1.0',
          createdByPrincipalId: envelope.principalId,
          createdByActorSnapshotId: envelope.actorSnapshotId,
          createdAuthorizationDecisionId: envelope.authorizationDecisionId,
          sourceCommandId: envelope.commandId,
        });
        if (created.outcome !== 'OK' && created.outcome !== 'ALREADY')
          return {
            kind: 'REJECTED',
            errorCode: 'ARTIFACT_REPRESENTATION_BINDING_INVALID',
            safeSummary: 'Markdown representation could not be registered',
          };
        const row = await repo.getRepresentationById(
          execution.trx,
          created.representationId ?? envelope.targetId,
        );
        if (!row) return markdownNotFound();
        const view = representationViewForRow(row);
        const payload: Artifact.ArtifactRegisterMarkdownRepresentationResult = {
          representationRef: view.representationRef,
          registrationRef: view.registrationRef,
          receiptRef: {
            kind: 'OBJECT',
            objectType: 'artifact.command_receipt',
            objectId: row.source_command_id,
            scope: revisionRef.scope,
          },
        };
        if (created.outcome === 'OK') {
          await execution.appendOutbox({
            eventId: newUuidV7(),
            eventType: 'artifact.RepresentationRegistered',
            eventVersion: '1.0',
            aggregateType: envelope.targetType,
            aggregateId: row.representation_id,
            aggregateVersion: '1',
            payload: {
              enterpriseId: row.enterprise_id,
              projectId: row.project_id,
              artifactRef: read.artifactRef,
              revisionRef,
              representationRef: view.representationRef,
              renderAttemptRef,
            } as unknown as CanonicalJsonObject,
            occurredAt: row.registered_at,
          });
          for (const [path, target, module] of [
            ['/revisionRef', revisionRef, 'artifact'],
            ['/renderAttemptRef', renderAttemptRef, 'integration-gateway'],
            ['/rawReceiptRef', requiredValue(binding.rawReceiptRef), 'integration-gateway'],
          ] as const) {
            await execution.appendReferenceEdge({
              ownerObjectType: envelope.targetType,
              ownerObjectId: row.representation_id,
              ownerPayloadHash: row.checksum,
              referencePath: path,
              targetModule: module,
              targetObjectType: target.objectType,
              targetObjectId: target.objectId,
              ...('contentHash' in target
                ? { targetPayloadHash: Buffer.from(target.contentHash.digest, 'hex') }
                : {}),
              referencePurpose: 'MARKDOWN_REPRESENTATION_BINDING',
            });
          }
        }
        return { kind: 'COMMITTED', resultPayload: payload as unknown as CanonicalJsonObject };
      },
      async () => {
        await authority.authorize(REGISTER, revisionRef);
      },
    );
  }
  private async read(
    authority: MarkdownReadAuthority,
    representationRef: Artifact.RepresentationRef,
  ) {
    const authorized = await authority.authorize(DOWNLOAD, representationRef.revision);
    if (authorized.context.principalKind !== 'HUMAN') return markdownNotFound();
    const row = await withArtifactTransaction(this.config.db, authorized.context, (trx) =>
      repo.getRepresentationById(trx, representationRef.representationId),
    );
    if (
      row?.format !== 'zhiju.markdown' ||
      row.media_type !== MEDIA ||
      !isDeepStrictEqual(representationViewForRow(row).representationRef, representationRef)
    )
      return markdownNotFound();
    const read = await this.config.review.read(authority, DOWNLOAD, representationRef.revision);
    if (read.facts.disposition !== 'ACTIVE' || read.facts.root.lifecycle_status !== 'ACTIVE')
      return markdownNotFound();
    const actual = await this.config.binding.read(
      row.render_attempt_ref as unknown as Common.ObjectRef,
    );
    if (
      !registry.validateOperationResult(
        'integration.get_markdown_render_binding',
        '1.0',
        actual.binding,
      ).valid ||
      actual.binding.status !== 'SUCCEEDED' ||
      !actual.binding.succeededResult ||
      !isDeepStrictEqual(actual.binding.succeededResult.revisionRef, representationRef.revision) ||
      actual.binding.succeededResult.outputObjectRef !== row.object_locator ||
      !isDeepStrictEqual(
        actual.binding.succeededResult.outputChecksum,
        representationRef.checksum,
      ) ||
      !isDeepStrictEqual(markdownBytesHash(actual.bytes), representationRef.checksum) ||
      !actual.bytes.equals(read.renderedBytes) ||
      actual.bytes.length > 10_485_760
    )
      return markdownNotFound();
    await authority.authorize(DOWNLOAD, representationRef.revision);
    return { authorized, actual };
  }
  async getDownload(
    authority: MarkdownReadAuthority,
    input: Artifact.ArtifactGetMarkdownDownloadPayload,
  ): Promise<Artifact.MarkdownDownload> {
    const { authorized, actual } = await this.read(authority, input.representationRef);
    const value = {
      representationRef: input.representationRef,
      principalId: authorized.context.principalId,
      authorizationWatermark: authorized.watermark,
    };
    return {
      representationRef: input.representationRef,
      revisionRef: exactMarkdownRevision(input.representationRef.revision),
      checksum: input.representationRef.checksum,
      byteLength: actual.bytes.length,
      mediaType: MEDIA,
      safeFilename: `document-${input.representationRef.representationId}.md`,
      downloadTicket: this.tokens.issue('markdown-bytes-read', value, value, 60_000),
      expiresAt: new Date(this.now() + 60_000).toISOString(),
    };
  }
  async openStream(
    authority: MarkdownReadAuthority,
    representationId: string,
    ticket: string,
    signal: AbortSignal,
  ) {
    const claims = this.tokens.open('markdown-bytes-read', ticket);
    const value = claims.value as {
      representationRef: Artifact.RepresentationRef;
      principalId: string;
      authorizationWatermark: string;
    };
    this.tokens.read('markdown-bytes-read', value, ticket);
    if (value.representationRef.representationId !== representationId || signal.aborted)
      return markdownNotFound();
    const { authorized, actual } = await this.read(authority, value.representationRef);
    if (
      authorized.context.principalId !== value.principalId ||
      authorized.watermark !== value.authorizationWatermark
    )
      return markdownNotFound();
    const tokens = this.tokens;
    async function* chunks() {
      for (let offset = 0; offset < actual.bytes.length; offset += 65536) {
        if (signal.aborted) return markdownNotFound();
        tokens.read('markdown-bytes-read', value, ticket);
        const current = await authority.authorize(DOWNLOAD, value.representationRef.revision);
        if (
          current.context.principalId !== value.principalId ||
          current.watermark !== value.authorizationWatermark
        )
          return markdownNotFound();
        yield actual.bytes.subarray(offset, offset + 65536);
      }
    }
    return {
      bytes: chunks(),
      byteLength: actual.bytes.length,
      mediaType: MEDIA,
      safeFilename: `document-${representationId}.md`,
    };
  }
}

function requiredValue<T>(value: T | null | undefined): T {
  if (value === undefined || value === null)
    throw new Error('Required Markdown binding is unavailable');
  return value;
}
