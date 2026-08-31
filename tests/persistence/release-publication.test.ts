// IM-05 WI-06/WI-07 (issues #126/#127): real PostgreSQL persistence evidence
// for Release drafts, publication facts, exact authority references, frozen
// Package hashes, CAS/idempotency, RLS/ACL, immutable history and rollback.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type {
  Artifact,
  Common,
  Core,
  QualityGovernance,
  ReleasePublication,
} from '@zhiju/contracts';
import {
  buildPackageHashMaterial,
  createReleasePublicationDatabase,
  digestCanonicalPayload,
  executeReleasePublicationCommand,
  handleAuthorizeRelease,
  handleCompleteRelease,
  handleCreateReleaseDraft,
  handleGetFrozenPackage,
  handleGetPublicationAttempts,
  handleGetRelease,
  handleGetReleaseImpact,
  handleGetReleaseReceipts,
  handlePrepareRelease,
  handleRecordPublicationFailure,
  handleRecordPublicationReceipt,
  handleRecallRelease,
  handleSelectRepresentations,
  handleSetDestinations,
  handleStartPublicationAttempt,
  handleValidateReleaseReadiness,
  InMemoryRawExternalReceiptRepository,
  RELEASE_ACTOR_NOT_HUMAN,
  RELEASE_AUTHORIZATION_DECISION_MISMATCH,
  RELEASE_AUTHORIZATION_EXPIRED,
  RELEASE_AUTHORIZATION_INVALID,
  RELEASE_AUTHORIZATION_PURPOSE_MISMATCH,
  RELEASE_AUTHORIZATION_REVOKED,
  ReleasePublicationBusinessError,
  type CommandResult,
  type ReleaseActorSnapshotFact,
  type ReleaseAuthorizationDecisionFact,
  type ReleaseAuthorityQueryPorts,
  type ReleaseCommandEnvelope,
  type ReleaseTransactionContext,
  type RawExternalReceiptFact,
} from '@zhiju/release-publication';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);

const ENTERPRISE = '0190a1b2-c3d4-7e81-8f90-123456789101';
const PROJECT = '0190a1b2-c3d4-7e81-8f90-123456789102';
const OTHER_PROJECT = '0190a1b2-c3d4-7e81-8f90-123456789103';
const PRINCIPAL = '0190a1b2-c3d4-7e81-8f90-123456789104';
const ACTOR = '0190a1b2-c3d4-7e81-8f90-123456789105';
const DECISION = '0190a1b2-c3d4-7e81-8f90-123456789106';
const POLICY = '0190a1b2-c3d4-7e81-8f90-123456789107';
const CORRELATION = '0190a1b2-c3d4-7e81-8f90-123456789108';
const ARTIFACT = '0190a1b2-c3d4-7e81-8f90-123456789109';
const REVISION = '0190a1b2-c3d4-7e81-8f90-12345678910a';
const PROFILE = '0190a1b2-c3d4-7e81-8f90-12345678910b';
const PROFILE_VERSION = '0190a1b2-c3d4-7e81-8f90-12345678910c';
const RAS = '0190a1b2-c3d4-7e81-8f90-12345678910d';
const ABS = '0190a1b2-c3d4-7e81-8f90-12345678910e';
const RECIPIENT = '0190a1b2-c3d4-7e81-8f90-12345678910f';
const REPRESENTATION_A = '0190a1b2-c3d4-7e81-8f90-123456789110';
const REPRESENTATION_B = '0190a1b2-c3d4-7e81-8f90-123456789111';
const DESTINATION_A = '0190a1b2-c3d4-7e81-8f90-123456789112';
const DESTINATION_B = '0190a1b2-c3d4-7e81-8f90-123456789113';
const RECALL_PRINCIPAL = '0190a1b2-c3d4-7e81-8f90-123456789117';
const RECALL_ACTOR = '0190a1b2-c3d4-7e81-8f90-123456789118';
const RECALL_DECISION = '0190a1b2-c3d4-7e81-8f90-123456789119';
const PROBE_ROLE = 'im05_wi06_release_probe';
const PROBE_PASSWORD = 'im05-wi06-release-probe';

function contentHashFromBytes(value: Buffer): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: value.toString('hex'),
    canonicalizationVersion: '1',
  };
}

function context(
  projectIds: readonly string[] = [PROJECT],
  overrides: Partial<ReleaseTransactionContext> = {},
): ReleaseTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x51),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: projectIds,
    correlationId: CORRELATION,
    ...overrides,
  };
}

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function scope(projectId = PROJECT): Common.ScopeRef {
  return { enterpriseId: ENTERPRISE, projectId };
}

function objectRef(objectType: string, objectId: string, projectId = PROJECT): Common.ObjectRef {
  return { kind: 'OBJECT', objectType, objectId, scope: scope(projectId) };
}

function revisionRef(): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'artifact.artifact_revision',
    objectId: REVISION,
    scope: scope(),
    contentHash: hash(0x11),
  };
}

function snapshotRef(objectType: string, objectId: string, byte: number): Common.SnapshotRef {
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId: objectId,
    scope: scope(),
    contentHash: hash(byte),
  };
}

function profileRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'quality.quality_profile',
    objectId: PROFILE,
    versionId: PROFILE_VERSION,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function draftDefinition(): ReleasePublication.ReleaseDraftDefinition {
  return {
    artifactRef: objectRef('artifact.artifact', ARTIFACT),
    revisionRef: revisionRef(),
    releaseNumber: 'REL-801-PG',
    purpose: 'CUSTOMER_DELIVERY',
    requestedEffectiveAt: '2026-09-01T00:00:00Z',
    qualityProfileRef: profileRef(),
    revisionAcceptanceSnapshotRef: snapshotRef('quality.revision_acceptance_snapshot', RAS, 0x21),
    approvalBundleSnapshotRef: snapshotRef('quality.approval_bundle_snapshot', ABS, 0x22),
  };
}

function representation(
  representationId: string,
  ordinal: number,
  checksumByte: number,
): ReleasePublication.ReleaseRepresentationSelection {
  return {
    representationRef: {
      representationId,
      revision: revisionRef(),
      format: ordinal === 1 ? 'DOCX' : 'PDF',
      mediaType: ordinal === 1 ? 'application/vnd.test.docx' : 'application/pdf',
      objectStorageRef: `objects/${representationId}`,
      checksum: hash(checksumByte),
      renderer: { rendererId: 'renderer.test', rendererVersion: '1.0.0' },
      createdAt: '2026-08-31T00:00:00Z',
    },
    ordinal,
    displayName: `Representation ${ordinal}`,
    required: true,
    releaseRole: ordinal === 1 ? 'PRIMARY' : 'SECONDARY',
  };
}

function destination(destinationId: string): ReleasePublication.ReleaseDestinationDefinition {
  return {
    destinationId,
    destinationType: 'FEISHU_DOC',
    destinationRef: {
      system: 'feishu',
      resourceType: 'document',
      externalId: destinationId,
      observedAt: '2026-08-31T00:00:00Z',
    },
    recipientScopeRef: snapshotRef('release.recipient_scope_snapshot', RECIPIENT, 0x31),
    purpose: 'CUSTOMER_DELIVERY',
    required: true,
    requiredReceiptKind: 'PROVIDER_ACK',
    deliveryPolicyRef: {
      kind: 'VERSIONED',
      objectType: 'policy.delivery_policy',
      objectId: '0190a1b2-c3d4-7e81-8f90-123456789114',
      versionId: '0190a1b2-c3d4-7e81-8f90-123456789115',
      scope: scope(),
    },
  };
}

function authorityPorts(): ReleaseAuthorityQueryPorts {
  const definition = draftDefinition();
  const acceptance = {
    header: { scopeRef: definition.revisionAcceptanceSnapshotRef.scope },
    snapshotId: RAS,
    artifactRef: definition.artifactRef,
    revisionRef: definition.revisionRef,
    qualityProfileRef: definition.qualityProfileRef,
    evaluationStage: 'REVISION_ACCEPTANCE',
    readiness: { status: 'READY', reasons: [] },
  } as unknown as Core.RevisionAcceptanceSnapshot;
  const approval = {
    header: { scopeRef: definition.approvalBundleSnapshotRef.scope },
    snapshotId: ABS,
    artifactRef: definition.artifactRef,
    revisionRef: definition.revisionRef,
    revisionAcceptanceSnapshotRef: definition.revisionAcceptanceSnapshotRef,
    qualityProfileRef: definition.qualityProfileRef,
    completeness: { status: 'FULLY_APPROVED', reasons: [] },
    separationOfDutiesResult: { outcome: 'SATISFIED', checkedAt: '2026-08-31T00:00:00Z' },
  } as unknown as Core.ApprovalBundleSnapshot;
  return {
    artifact: {
      validateRevisionRef: (
        input: Artifact.ArtifactValidateRevisionRefPayload,
      ): Promise<Artifact.ArtifactValidateRevisionRefResult> =>
        Promise.resolve({
          valid: true,
          exactRef: input.revisionRef,
          authoritativeScopeRef: input.revisionRef.scope,
          disposition: 'ACTIVE',
          contentAvailable: true,
          reasons: [],
        }),
      getRepresentation: (
        input: Artifact.ArtifactGetRepresentationPayload,
      ): Promise<Artifact.ArtifactGetRepresentationResult> =>
        Promise.resolve({
          representationRef: input.representationRef,
          status: 'registered',
          registrationRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'artifact.representation_registration',
            objectId: input.representationRef.representationId,
            scope: input.representationRef.revision.scope,
            contentHash: hash(0x41),
          },
        }),
    },
    quality: {
      getRevisionAcceptanceSnapshot: (
        _input: QualityGovernance.QualityGetRevisionAcceptanceSnapshotPayload,
      ): Promise<QualityGovernance.QualityGetRevisionAcceptanceSnapshotResult> => {
        void _input;
        return Promise.resolve(acceptance);
      },
      getApprovalBundleSnapshot: (
        _input: QualityGovernance.QualityGetApprovalBundleSnapshotPayload,
      ): Promise<QualityGovernance.QualityGetApprovalBundleSnapshotResult> => {
        void _input;
        return Promise.resolve(approval);
      },
    },
  };
}

function envelope<TPayload extends object>(
  current: ReleaseTransactionContext,
  commandType: string,
  targetId: string,
  payload: TPayload,
  expectedAggregateVersion?: string,
  idempotencyKey = `${commandType}:${targetId}:${newUuidV7()}`,
): ReleaseCommandEnvelope<TPayload> {
  return {
    commandId: newUuidV7(),
    commandType,
    commandVersion: '1.0',
    idempotencyScope: 'im05.wi06',
    idempotencyKey,
    requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
    enterpriseId: current.enterpriseId,
    projectId: PROJECT,
    targetType: 'release.release',
    targetId,
    ...(expectedAggregateVersion === undefined ? {} : { expectedAggregateVersion }),
    correlationId: current.correlationId,
    principalId: current.principalId,
    principalKind: current.principalKind,
    actorSnapshotId: current.actorSnapshotId,
    authorizationDecisionId: current.authorizationDecisionId,
    policySnapshotId: current.policySnapshotId,
    payload,
  };
}

function committed(result: CommandResult): CanonicalJsonObject {
  expect(result.status).toBe('COMMITTED');
  if (result.status !== 'COMMITTED') throw new Error(`expected COMMITTED, got ${result.status}`);
  return result.resultPayload;
}

function resultObject(result: CommandResult, key: string): Record<string, unknown> {
  const value = result.status === 'COMMITTED' ? result.resultPayload[key] : undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} is not an object result`);
  }
  return value as Record<string, unknown>;
}

describe.skipIf(!gateEnabled)('ReleasePublication WI-06 persistence (real PostgreSQL)', () => {
  let admin: pg.Client;
  let probe: pg.Client;
  let pool: pg.Pool;
  let db: ReturnType<typeof createReleasePublicationDatabase>;
  let releaseId: string;
  let prepareEnvelope: ReleaseCommandEnvelope<ReleasePublication.ReleasePrepareReleasePayload>;
  let currentContext: ReleaseTransactionContext;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: databaseUrl ?? '' });
    await admin.connect();
    await admin.query(
      `CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
    );
    await admin.query(
      `GRANT platform_context_establisher, release_publication_app TO ${PROBE_ROLE}`,
    );
    const probeUrl = new URL(databaseUrl ?? '');
    probeUrl.username = PROBE_ROLE;
    probeUrl.password = PROBE_PASSWORD;
    probe = new pg.Client({ connectionString: probeUrl.toString() });
    await probe.connect();
    pool = new pg.Pool({ connectionString: probeUrl.toString(), max: 4 });
    db = createReleasePublicationDatabase(pool);
  });

  afterAll(async () => {
    await probe.end();
    await pool.end();
    await admin.query('RESET ROLE');
    await admin.query(`DROP ROLE ${PROBE_ROLE}`);
    await admin.end();
  });

  it('persists a draft, CAS updates selections/destinations, freezes one exact Package, and supports exact queries', async () => {
    currentContext = context();
    releaseId = newUuidV7();
    const definition = draftDefinition();
    const ports = authorityPorts();
    const createEnvelope = envelope(currentContext, 'release.create_release_draft', releaseId, {
      definition,
    });

    const created = await handleCreateReleaseDraft(db, currentContext, createEnvelope, ports);
    expect(committed(created).status).toBe('DRAFT');
    expect(resultObject(created, 'releaseRef').objectType).toBe('release.release');

    const selections = [
      representation(REPRESENTATION_B, 2, 0x52),
      representation(REPRESENTATION_A, 1, 0x51),
    ];
    const selected = await handleSelectRepresentations(
      db,
      currentContext,
      envelope(
        currentContext,
        'release.select_representations',
        releaseId,
        {
          selections,
          selectionReason: {
            reasonCode: 'RELEASE_SELECTION_SCOPE',
            summary: 'The selected representations are the approved delivery outputs.',
            evidenceRefs: [],
          },
        },
        '1',
      ),
      ports,
    );
    expect(committed(selected).aggregateVersion).toBe(2);

    const destinations = [destination(DESTINATION_B), destination(DESTINATION_A)];
    const recipientScopeSnapshotRef = snapshotRef(
      'release.recipient_scope_snapshot',
      RECIPIENT,
      0x31,
    );
    const destinationResult = await handleSetDestinations(
      db,
      currentContext,
      envelope(
        currentContext,
        'release.set_destinations',
        releaseId,
        { destinations, recipientScopeSnapshotRef },
        '2',
      ),
    );
    expect(committed(destinationResult).aggregateVersion).toBe(3);

    const packageWithoutHash: ReleasePublication.ReleasePackageDefinition = {
      releaseRef: objectRef('release.release', releaseId),
      canonicalRevisionRef: definition.revisionRef,
      representations: selections,
      destinations,
      recipientScopeSnapshotRef,
      approvalBundleSnapshotRef: definition.approvalBundleSnapshotRef,
      preparedAt: '2026-08-31T00:10:00Z',
      packageHash: hash(0x00),
    };
    const packageHash = buildPackageHashMaterial(packageWithoutHash).expectedPackageHash;
    const packageDefinition = { ...packageWithoutHash, packageHash };
    prepareEnvelope = envelope(
      currentContext,
      'release.prepare_release',
      releaseId,
      {
        package: packageDefinition,
        preparationValidationRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'release.preparation_validation',
          objectId: '0190a1b2-c3d4-7e81-8f90-123456789116',
          scope: scope(),
          contentHash: hash(0x61),
        },
      },
      '3',
    );
    const prepared = await handlePrepareRelease(db, currentContext, prepareEnvelope, ports);
    const preparedPayload = committed(prepared);
    expect(preparedPayload.status).toBe('PREPARED');
    expect(preparedPayload.aggregateVersion).toBe(4);
    const packageRef = resultObject(prepared, 'packageRef') as unknown as Common.ReleasePackageRef;

    const queriedRelease = await handleGetRelease(db, currentContext, {
      releaseRef: packageRef.releaseRef,
    });
    expect(queriedRelease.status).toBe('PREPARED');
    expect(queriedRelease.packageRef).toEqual(packageRef);
    expect(queriedRelease.definition.revisionRef).toEqual(definition.revisionRef);

    const queriedPackage = await handleGetFrozenPackage(db, currentContext, { packageRef });
    expect(queriedPackage.packageRef).toEqual(packageRef);
    expect(queriedPackage.definition.packageHash).toEqual(packageHash);
    expect(queriedPackage.packagePayloadHash).toEqual(
      buildPackageHashMaterial(packageDefinition).packagePayloadHash,
    );

    const duplicate = await handlePrepareRelease(db, currentContext, prepareEnvelope, ports);
    expect(duplicate.status).toBe('DUPLICATE');
    if (duplicate.status === 'DUPLICATE') {
      expect(duplicate.originalOutcome).toBe('COMMITTED');
    }
  });

  it('rejects a wrong package hash without creating another frozen Package', async () => {
    const wrongPackage = {
      ...prepareEnvelope.payload.package,
      packageHash: hash(0x7f),
    };
    const rejected = await handlePrepareRelease(
      db,
      currentContext,
      envelope(
        currentContext,
        'release.prepare_release',
        releaseId,
        {
          package: wrongPackage,
          preparationValidationRef: prepareEnvelope.payload.preparationValidationRef,
        },
        '4',
      ),
      authorityPorts(),
    );
    expect(rejected.status).toBe('REJECTED');
    if (rejected.status === 'REJECTED') {
      expect(rejected.errorCode).toBe('RELEASE_PACKAGE_HASH_MISMATCH');
    }
    const count = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM release_publication.release_package WHERE release_id = $1',
      [releaseId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('keeps an app role read-only for business tables and rejects direct owner mutation of frozen facts', async () => {
    await probe.query('BEGIN');
    await probe.query('SET LOCAL ROLE platform_context_establisher');
    await probe.query(
      `SELECT platform_security.establish_transaction_context(
       'REQUEST', $1, $2, $3, $4, now() + interval '1 hour', $5, $6, $7, NULL)`,
      [
        currentContext.principalId,
        currentContext.actorSnapshotId,
        currentContext.authorizationDecisionId,
        currentContext.authorizationDecisionHash,
        currentContext.enterpriseId,
        [...currentContext.allowedProjectIds],
        currentContext.correlationId,
      ],
    );
    await probe.query('SET LOCAL ROLE release_publication_app');
    await expect(
      probe.query(
        `UPDATE release_publication.release_package SET package_definition = package_definition WHERE package_id = $1`,
        [
          (
            await admin.query<{ package_id: string }>(
              'SELECT package_id::text FROM release_publication.release_package WHERE release_id = $1',
              [releaseId],
            )
          ).rows[0]?.package_id,
        ],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await probe.query('ROLLBACK');

    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE release_publication_owner');
    const packageRow = await admin.query<{ package_id: string }>(
      'SELECT package_id::text FROM release_publication.release_package WHERE release_id = $1',
      [releaseId],
    );
    await expect(
      admin.query(
        `UPDATE release_publication.release_package SET package_definition = package_definition WHERE package_id = $1`,
        [packageRow.rows[0]?.package_id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await admin.query('ROLLBACK');
  });

  it('rolls back a controlled fault after technical writes', async () => {
    const faultEnvelope = envelope(
      currentContext,
      'release.wi06_fault_probe',
      releaseId,
      { fault: 'after-technical-writes' },
      '4',
      `fault:${newUuidV7()}`,
    );
    await expect(
      executeReleasePublicationCommand(db, currentContext, faultEnvelope, async (execution) => {
        await execution.appendAudit({
          outcome: 'INFO',
          safeSummary: 'WI-06 controlled rollback probe',
        });
        return execution.failAfterTechnicalWrites();
      }),
    ).rejects.toMatchObject({ code: 'INJECTED_FAULT' });
    const receipt = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM release_publication.command_receipt WHERE command_id = $1',
      [faultEnvelope.commandId],
    );
    const audit = await admin.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM release_publication.audit_record WHERE command_id = $1',
      [faultEnvelope.commandId],
    );
    expect(receipt.rows[0]?.count).toBe('0');
    expect(audit.rows[0]?.count).toBe('0');
  });

  it('fails closed for a Release ref outside the trusted Project scope', async () => {
    await expect(
      handleGetRelease(db, context([OTHER_PROJECT]), {
        releaseRef: objectRef('release.release', releaseId),
      }),
    ).rejects.toBeInstanceOf(ReleasePublicationBusinessError);
  });

  it('delivers WI-07 through the Handler, owner functions, RLS and append-only facts', async () => {
    const preparedRelease = await handleGetRelease(db, currentContext, {
      releaseRef: objectRef('release.release', releaseId),
    });
    if (preparedRelease.packageRef === undefined) {
      throw new Error('WI-07 probe requires the exact frozen Package from WI-06');
    }
    const packageRef = preparedRelease.packageRef;
    const packageView = await handleGetFrozenPackage(db, currentContext, { packageRef });
    const packageDefinition = packageView.definition;
    const readinessRef = snapshotRef('quality.release_readiness_snapshot', newUuidV7(), 0x71);
    const actorSnapshotRef = snapshotRef('identity.actor_snapshot', ACTOR, 0x72);
    const authorizationDecisionRef: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.authorization_decision',
      objectId: DECISION,
      scope: scope(),
      contentHash: hash(0x51),
    };
    const principalRef = {
      principalKind: 'HUMAN',
      principalId: PRINCIPAL,
    } as const satisfies Common.PrincipalRef;
    const authenticationContextHash = hash(0x73);
    const readinessSnapshot = {
      header: { scopeRef: readinessRef.scope },
      snapshotId: readinessRef.snapshotId,
      releaseRef: preparedRelease.releaseRef,
      artifactRef: preparedRelease.definition.artifactRef,
      revisionRef: packageDefinition.canonicalRevisionRef,
      approvalBundleSnapshotRef: packageDefinition.approvalBundleSnapshotRef,
      releasePackageRef: packageRef,
      purpose: preparedRelease.definition.purpose,
      recipientScopeSnapshotRef: packageDefinition.recipientScopeSnapshotRef,
      destinationRefs: packageDefinition.destinations.map((item) => item.destinationRef),
      releaseRequirements: [],
      requiredReleaseGateSpecs: [],
      releaseGateResultRefs: [],
      readiness: { status: 'READY_FOR_AUTHORIZATION', reasons: [] },
      evaluatedAt: new Date(Date.now() - 1000).toISOString(),
    } as unknown as Core.ReleaseReadinessSnapshot;
    const rawReceipts = new InMemoryRawExternalReceiptRepository();
    const basePorts = authorityPorts();
    let decisionCommandType = 'release.authorize_release';
    let decisionPurpose = 'release.publication.authorize_release';
    let decisionPayloadHash = hash(0x74);
    const recallActorSnapshotRef = snapshotRef('identity.actor_snapshot', RECALL_ACTOR, 0x78);
    const recallAuthorizationDecisionRef: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'identity.authorization_decision',
      objectId: RECALL_DECISION,
      scope: scope(),
      contentHash: hash(0x79),
    };
    const recallPrincipalRef = {
      principalKind: 'HUMAN',
      principalId: RECALL_PRINCIPAL,
    } as const satisfies Common.PrincipalRef;
    const recallAuthenticationContextHash = hash(0x7a);
    const baseRecallActor: ReleaseActorSnapshotFact = {
      actorSnapshotRef: recallActorSnapshotRef,
      principalRef: recallPrincipalRef,
      authenticationContextHash: recallAuthenticationContextHash,
    };
    const baseRecallDecision: ReleaseAuthorizationDecisionFact = {
      authorizationDecisionRef: recallAuthorizationDecisionRef,
      actorSnapshotRef: recallActorSnapshotRef,
      principalRef: recallPrincipalRef,
      commandType: 'release.recall_release',
      commandVersion: '1.0',
      scope: scope(),
      purpose: 'release.publication.recall_release',
      commandPayloadHash: hash(0x7b),
      authenticationContextHash: recallAuthenticationContextHash,
      outcome: 'ALLOW',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    let recallActor = baseRecallActor;
    let recallDecision = baseRecallDecision;
    const ports: ReleaseAuthorityQueryPorts = {
      ...basePorts,
      quality: {
        ...basePorts.quality,
        getReleaseReadinessSnapshot: () => Promise.resolve(readinessSnapshot),
      },
      identity: {
        getActorSnapshot: (ref) =>
          Promise.resolve(
            ref.snapshotId === actorSnapshotRef.snapshotId
              ? {
                  actorSnapshotRef,
                  principalRef,
                  authenticationContextHash,
                }
              : ref.snapshotId === recallActorSnapshotRef.snapshotId
                ? recallActor
                : undefined,
          ),
        getAuthorizationDecision: (ref) =>
          Promise.resolve(
            ref.objectId === authorizationDecisionRef.objectId
              ? {
                  authorizationDecisionRef,
                  actorSnapshotRef,
                  principalRef,
                  commandType: decisionCommandType,
                  commandVersion: '1.0',
                  scope: scope(),
                  purpose: decisionPurpose,
                  commandPayloadHash: decisionPayloadHash,
                  authenticationContextHash,
                  outcome: 'ALLOW' as const,
                  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
                }
              : ref.objectId === recallAuthorizationDecisionRef.objectId
                ? recallDecision
                : undefined,
          ),
      },
      rawExternalReceipts: rawReceipts,
    };

    const readinessEnvelope = envelope(
      currentContext,
      'release.validate_release_readiness',
      releaseId,
      {
        releaseReadinessSnapshotRef: readinessRef,
        validatedPackageRef: packageRef,
        validatedAt: new Date().toISOString(),
      },
      '4',
    );
    const readinessResult = await handleValidateReleaseReadiness(
      db,
      currentContext,
      readinessEnvelope,
      ports,
    );
    expect(committed(readinessResult).status).toBe('VALIDATING');
    expect(committed(readinessResult).aggregateVersion).toBe(5);

    const authorizationPayload: ReleasePublication.ReleaseAuthorizeReleasePayload = {
      releaseReadinessSnapshotRef: readinessRef,
      authorizingHumanRef: principalRef,
      actorSnapshotRef,
      authorizationDecisionRef,
      authorizedAt: new Date().toISOString(),
    };
    const authorizationEnvelope = envelope(
      currentContext,
      'release.authorize_release',
      releaseId,
      authorizationPayload,
      '5',
    );
    decisionCommandType = authorizationEnvelope.commandType;
    decisionPurpose = 'release.publication.authorize_release';
    decisionPayloadHash = contentHashFromBytes(
      digestCanonicalPayload(authorizationEnvelope.requestPayload).hash,
    );
    const authorizationResult = await handleAuthorizeRelease(
      db,
      currentContext,
      authorizationEnvelope,
      ports,
    );
    const authorizedPayload = committed(authorizationResult);
    expect(authorizedPayload.status).toBe('AUTHORIZED');
    expect(authorizedPayload.aggregateVersion).toBe(6);
    const authorizationRef =
      authorizedPayload.authorizationRef as unknown as Common.ContentAddressedRef;
    expect(authorizationRef.objectType).toBe('release.release_authorization');

    const attemptDefinition = (
      destinationId: string,
      attemptNumber: number,
      externalRequestId: string,
      externalHashByte: number,
    ): ReleasePublication.PublicationAttemptDefinition => ({
      destinationId,
      packageRef,
      attemptNumber,
      stableIdempotencyKey: `wi07-${destinationId}`,
      requestedAt: new Date().toISOString(),
      externalDeliveryRequestRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'integration.external_delivery_request',
        objectId: externalRequestId,
        scope: scope(),
        contentHash: hash(externalHashByte),
      },
    });
    const attemptRefFor = (attemptEnvelope: ReleaseCommandEnvelope<object>): Common.ObjectRef =>
      objectRef('release.publication_attempt', attemptEnvelope.commandId);
    const attemptA = attemptDefinition(DESTINATION_A, 1, newUuidV7(), 0x75);
    const attemptAEnvelope = envelope(
      currentContext,
      'release.start_publication_attempt',
      releaseId,
      { attempt: attemptA },
      '6',
    );
    const attemptAResult = await handleStartPublicationAttempt(
      db,
      currentContext,
      attemptAEnvelope,
    );
    expect(committed(attemptAResult).status).toBe('PUBLISHING');
    expect(committed(attemptAResult).aggregateVersion).toBe(7);

    const attemptB = attemptDefinition(DESTINATION_B, 1, newUuidV7(), 0x76);
    const attemptBEnvelope = envelope(
      currentContext,
      'release.start_publication_attempt',
      releaseId,
      { attempt: attemptB },
      '7',
    );
    const attemptBResult = await handleStartPublicationAttempt(
      db,
      currentContext,
      attemptBEnvelope,
    );
    expect(committed(attemptBResult).aggregateVersion).toBe(8);

    const failurePayload = {
      failure: {
        attemptRef: attemptRefFor(attemptBEnvelope),
        destinationId: DESTINATION_B,
        packageRef,
        classification: 'INTEGRATION_DELIVERY_FAILED',
        retryable: true,
        outcome: 'FAILED' as const,
        occurredAt: new Date().toISOString(),
      },
    };
    const failureEnvelope = envelope(
      currentContext,
      'release.record_publication_failure',
      releaseId,
      failurePayload,
      '8',
    );
    const failureResult = await handleRecordPublicationFailure(db, currentContext, failureEnvelope);
    const failureRecord = committed(failureResult);
    expect(failureRecord.aggregateVersion).toBe(9);

    const retryB = attemptDefinition(DESTINATION_B, 2, newUuidV7(), 0x77);
    const retryBEnvelope = envelope(
      currentContext,
      'release.start_publication_attempt',
      releaseId,
      { attempt: retryB },
      '9',
    );
    const retryBResult = await handleStartPublicationAttempt(db, currentContext, retryBEnvelope);
    expect(committed(retryBResult).aggregateVersion).toBe(10);

    const receiptPayloadHashA = hash(0x81);
    const rawReceiptRefA: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'integration.raw_external_receipt',
      objectId: newUuidV7(),
      scope: scope(),
      contentHash: hash(0x82),
    };
    const receiptOccurredAtA = new Date().toISOString();
    const rawFactA: RawExternalReceiptFact = {
      rawReceiptRef: rawReceiptRefA,
      releaseId,
      destinationId: DESTINATION_A,
      packageHashDigest: packageRef.packageHash.digest,
      publicationAttemptId: attemptAEnvelope.commandId,
      externalDeliveryRequestRef: attemptA.externalDeliveryRequestRef,
      adapterAttemptRef: objectRef('integration.adapter_attempt', newUuidV7()),
      receiptPayloadHash: receiptPayloadHashA,
      observedOutcome: 'SUCCEEDED',
      occurredAt: receiptOccurredAtA,
      recordedAt: receiptOccurredAtA,
    };
    rawReceipts.save(rawFactA);
    const receiptAEnvelope = envelope(
      currentContext,
      'release.record_publication_receipt',
      releaseId,
      {
        receipt: {
          attemptRef: attemptRefFor(attemptAEnvelope),
          destinationId: DESTINATION_A,
          packageRef,
          rawReceiptRef: rawReceiptRefA,
          providerResult: { messageId: 'provider-a', status: 'SUCCEEDED' },
          occurredAt: receiptOccurredAtA,
          receiptPayloadHash: receiptPayloadHashA,
        },
      },
      '10',
    );
    const receiptAResult = await handleRecordPublicationReceipt(
      db,
      currentContext,
      receiptAEnvelope,
      ports,
      { deliveryTimeoutMsByDestination: { [DESTINATION_A]: 60 * 60 * 1000 } },
    );
    const receiptAPayload = committed(receiptAResult);
    expect(receiptAPayload.status).toBe('PARTIALLY_RELEASED');
    expect(receiptAPayload.aggregateVersion).toBe(11);
    const receiptARefs =
      receiptAPayload.receiptRefs as unknown as readonly Common.ContentAddressedRef[];
    const receiptARef = receiptARefs[0];
    if (receiptARef === undefined) throw new Error('Receipt A was not persisted');
    expect(receiptARef.objectType).toBe('release.publication_receipt');

    const receiptPayloadHashB = hash(0x83);
    const rawReceiptRefB: Common.ContentAddressedRef = {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'integration.raw_external_receipt',
      objectId: newUuidV7(),
      scope: scope(),
      contentHash: hash(0x84),
    };
    const receiptOccurredAtB = new Date().toISOString();
    rawReceipts.save({
      rawReceiptRef: rawReceiptRefB,
      releaseId,
      destinationId: DESTINATION_B,
      packageHashDigest: packageRef.packageHash.digest,
      publicationAttemptId: retryBEnvelope.commandId,
      externalDeliveryRequestRef: retryB.externalDeliveryRequestRef,
      adapterAttemptRef: objectRef('integration.adapter_attempt', newUuidV7()),
      receiptPayloadHash: receiptPayloadHashB,
      observedOutcome: 'SUCCEEDED',
      occurredAt: receiptOccurredAtB,
      recordedAt: receiptOccurredAtB,
    });
    const receiptBEnvelope = envelope(
      currentContext,
      'release.record_publication_receipt',
      releaseId,
      {
        receipt: {
          attemptRef: attemptRefFor(retryBEnvelope),
          destinationId: DESTINATION_B,
          packageRef,
          rawReceiptRef: rawReceiptRefB,
          providerResult: { messageId: 'provider-b', status: 'SUCCEEDED' },
          occurredAt: receiptOccurredAtB,
          receiptPayloadHash: receiptPayloadHashB,
        },
      },
      '11',
    );
    const receiptBResult = await handleRecordPublicationReceipt(
      db,
      currentContext,
      receiptBEnvelope,
      ports,
      {
        deliveryTimeoutMsByDestination: {
          [DESTINATION_A]: 60 * 60 * 1000,
          [DESTINATION_B]: 60 * 60 * 1000,
        },
      },
    );
    const receiptBPayload = committed(receiptBResult);
    expect(receiptBPayload.status).toBe('RELEASED');
    expect(receiptBPayload.aggregateVersion).toBe(12);
    const receiptBRefs =
      receiptBPayload.receiptRefs as unknown as readonly Common.ContentAddressedRef[];
    const receiptBRef = receiptBRefs.find((value) => value.objectId !== receiptARef.objectId);
    if (receiptBRef === undefined) throw new Error('Receipt B was not persisted');
    expect(receiptBRef.objectType).toBe('release.publication_receipt');

    const completionPolicyRef: Common.VersionedRef = {
      kind: 'VERSIONED',
      objectType: 'policy.release_completion',
      objectId: newUuidV7(),
      versionId: newUuidV7(),
      scope: { enterpriseId: ENTERPRISE },
    };
    const completeEnvelope = envelope(
      currentContext,
      'release.complete_release',
      releaseId,
      {
        completionPolicyRef,
        destinationOutcomeRefs: [receiptARef, receiptBRef],
        evaluatedAt: new Date().toISOString(),
      },
      '12',
    );
    const completeResult = await handleCompleteRelease(db, currentContext, completeEnvelope);
    const completedRelease = committed(completeResult);
    expect(completedRelease.status).toBe('RELEASED');
    expect(completedRelease.aggregateVersion).toBe(13);

    const notificationPolicyRef = packageDefinition.destinations[0]?.deliveryPolicyRef;
    if (notificationPolicyRef === undefined) {
      throw new Error('WI-07 probe requires a notification policy');
    }
    const recallContext = context([PROJECT], {
      principalId: RECALL_PRINCIPAL,
      principalKind: 'HUMAN',
      actorSnapshotId: RECALL_ACTOR,
      authorizationDecisionId: RECALL_DECISION,
      authorizationDecisionHash: Buffer.from(
        recallAuthorizationDecisionRef.contentHash.digest,
        'hex',
      ),
      correlationId: newUuidV7(),
    });
    const recallPayload: ReleasePublication.ReleaseRecallReleasePayload = {
      recallScope: {
        affectedDestinationIds: [DESTINATION_A, DESTINATION_B],
      },
      recallReason: {
        reasonCode: 'RELEASE_RECALL_REQUESTED',
        summary: 'The synthetic release requires destination recall review.',
        evidenceRefs: [],
      },
      authorizingHumanRef: recallPrincipalRef,
      authorizationDecisionRef: recallAuthorizationDecisionRef,
      notificationPolicyRef,
      recalledAt: '2026-08-31T00:20:00.000Z',
    };
    const recallEnvelope = envelope(
      recallContext,
      'release.recall_release',
      releaseId,
      recallPayload,
      '13',
    );
    const validRecallDecision: ReleaseAuthorizationDecisionFact = {
      ...baseRecallDecision,
      commandPayloadHash: contentHashFromBytes(
        digestCanonicalPayload(recallEnvelope.requestPayload).hash,
      ),
    };
    recallDecision = validRecallDecision;

    const assertNoRecallSideEffects = async (): Promise<void> => {
      const state = await admin.query<{
        status: string;
        aggregate_version: string;
        recalls: string;
        impacts: string;
        recalled_events: string;
      }>(
        `SELECT r.status, r.aggregate_version::text,
                (SELECT count(*)::text FROM release_publication.release_recall
                  WHERE release_id = r.release_id) AS recalls,
                (SELECT count(*)::text FROM release_publication.release_impact_review
                  WHERE release_id = r.release_id) AS impacts,
                (SELECT count(*)::text FROM release_publication.outbox_event
                  WHERE aggregate_id = r.release_id
                    AND event_type = 'release.ReleaseRecalled') AS recalled_events
           FROM release_publication.release_record r
          WHERE r.release_id = $1`,
        [releaseId],
      );
      expect(state.rows[0]).toEqual({
        status: 'RELEASED',
        aggregate_version: '13',
        recalls: '0',
        impacts: '0',
        recalled_events: '0',
      });
    };

    const rejectRecall = async (
      recallContextForCommand: ReleaseTransactionContext,
      payload: ReleasePublication.ReleaseRecallReleasePayload,
      expectedCode: string,
    ): Promise<void> => {
      const result = await handleRecallRelease(
        db,
        recallContextForCommand,
        envelope(recallContextForCommand, 'release.recall_release', releaseId, payload, '13'),
        ports,
      );
      expect(result.status).toBe('REJECTED');
      if (result.status === 'REJECTED') expect(result.errorCode).toBe(expectedCode);
      await assertNoRecallSideEffects();
    };

    recallDecision = { ...validRecallDecision, principalRef };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_INVALID);

    recallDecision = {
      ...validRecallDecision,
      scope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
    };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_DECISION_MISMATCH);

    recallDecision = {
      ...validRecallDecision,
      purpose: 'release.publication.authorize_release',
    };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_PURPOSE_MISMATCH);

    recallDecision = { ...validRecallDecision, commandPayloadHash: hash(0x99) };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_DECISION_MISMATCH);

    recallDecision = { ...validRecallDecision, commandType: 'release.authorize_release' };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_DECISION_MISMATCH);

    recallDecision = { ...validRecallDecision, expiresAt: '2026-08-30T00:00:00.000Z' };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_EXPIRED);

    recallDecision = {
      ...validRecallDecision,
      revokedAt: '2026-08-30T00:00:00.000Z',
    };
    await rejectRecall(recallContext, recallPayload, RELEASE_AUTHORIZATION_REVOKED);

    recallDecision = validRecallDecision;
    await rejectRecall(
      context(recallContext.allowedProjectIds, {
        ...recallContext,
        principalKind: 'AGENT',
        correlationId: newUuidV7(),
      }),
      recallPayload,
      RELEASE_ACTOR_NOT_HUMAN,
    );

    recallActor = {
      ...baseRecallActor,
      principalRef: { principalKind: 'AGENT', principalId: RECALL_PRINCIPAL },
      actingForRef: recallPrincipalRef,
    };
    await rejectRecall(recallContext, recallPayload, RELEASE_ACTOR_NOT_HUMAN);

    recallActor = baseRecallActor;
    recallDecision = validRecallDecision;
    const recallResult = await handleRecallRelease(db, recallContext, recallEnvelope, ports);
    const recalledPayload = committed(recallResult);
    expect(recalledPayload.status).toBe('RECALLED');
    expect(recalledPayload.aggregateVersion).toBe(14);

    const recallProvenance = await admin.query<{
      created_by_principal_id: string;
      created_by_actor_snapshot_id: string;
      created_authorization_decision_id: string;
      authorization_decision_ref: Common.ContentAddressedRef;
    }>(
      `SELECT created_by_principal_id::text, created_by_actor_snapshot_id::text,
              created_authorization_decision_id::text, authorization_decision_ref
         FROM release_publication.release_recall
        WHERE release_id = $1`,
      [releaseId],
    );
    expect(recallProvenance.rows).toHaveLength(1);
    expect(recallProvenance.rows[0]).toMatchObject({
      created_by_principal_id: RECALL_PRINCIPAL,
      created_by_actor_snapshot_id: RECALL_ACTOR,
      created_authorization_decision_id: RECALL_DECISION,
    });
    expect(recallProvenance.rows[0]?.authorization_decision_ref.objectId).toBe(RECALL_DECISION);

    const releaseAuthorizationHistory = await admin.query<{
      authorization_actor_snapshot_ref: Common.SnapshotRef;
      status: string;
      aggregate_version: string;
    }>(
      `SELECT authorization_actor_snapshot_ref, status, aggregate_version::text
         FROM release_publication.release_record
        WHERE release_id = $1`,
      [releaseId],
    );
    expect(releaseAuthorizationHistory.rows[0]).toMatchObject({
      status: 'RECALLED',
      aggregate_version: '14',
    });
    expect(releaseAuthorizationHistory.rows[0]?.authorization_actor_snapshot_ref.snapshotId).toBe(
      ACTOR,
    );

    const attemptsPage = await handleGetPublicationAttempts(db, currentContext, {
      releaseRef: preparedRelease.releaseRef,
      destinationIds: [],
      outcomes: [],
      page: { pageSize: 20 },
    });
    expect(attemptsPage.items).toHaveLength(3);
    expect(attemptsPage.items.map((item) => item.outcome)).toEqual([
      'SUCCEEDED',
      'FAILED',
      'SUCCEEDED',
    ]);
    const failedAttempt = attemptsPage.items.find((item) => item.outcome === 'FAILED');
    if (failedAttempt?.failureRef === undefined) throw new Error('Failure ref was not read back');
    const failureRef = failedAttempt.failureRef;
    const receiptsPage = await handleGetReleaseReceipts(db, currentContext, {
      releaseRef: preparedRelease.releaseRef,
      packageRef,
      destinationIds: [],
      page: { pageSize: 20 },
    });
    expect(receiptsPage.items).toHaveLength(2);
    const impact = await handleGetReleaseImpact(db, currentContext, {
      releaseRef: preparedRelease.releaseRef,
    });
    expect(impact.affectedDestinations).toEqual([DESTINATION_A, DESTINATION_B]);
    expect(impact.humanInterventionRequired).toBe(true);

    const factCounts = await admin.query<{
      attempts: string;
      observations: string;
      receipts: string;
      failures: string;
      recalls: string;
      impacts: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM release_publication.publication_attempt WHERE release_id = $1) AS attempts,
         (SELECT count(*)::text FROM release_publication.publication_observation WHERE release_id = $1) AS observations,
         (SELECT count(*)::text FROM release_publication.publication_receipt WHERE release_id = $1) AS receipts,
         (SELECT count(*)::text FROM release_publication.publication_failure WHERE release_id = $1) AS failures,
         (SELECT count(*)::text FROM release_publication.release_recall WHERE release_id = $1) AS recalls,
         (SELECT count(*)::text FROM release_publication.release_impact_review WHERE release_id = $1) AS impacts`,
      [releaseId],
    );
    expect(factCounts.rows[0]).toEqual({
      attempts: '3',
      observations: '6',
      receipts: '2',
      failures: '1',
      recalls: '1',
      impacts: '1',
    });

    const observationRows = await admin.query<{
      observation_kind: string;
      observation_payload: CanonicalJsonObject;
      observation_payload_hash: Buffer;
    }>(
      `SELECT observation_kind, observation_payload, observation_payload_hash
         FROM release_publication.publication_observation
        WHERE release_id = $1
        ORDER BY created_at, observation_id`,
      [releaseId],
    );
    expect(observationRows.rows).toHaveLength(6);
    for (const observation of observationRows.rows) {
      expect(observation.observation_payload_hash).toHaveLength(32);
      expect(observation.observation_payload_hash).toEqual(
        digestCanonicalPayload(observation.observation_payload).hash,
      );
    }

    await probe.query('BEGIN');
    await probe.query('SET LOCAL ROLE platform_context_establisher');
    await probe.query(
      `SELECT platform_security.establish_transaction_context(
       'REQUEST', $1, $2, $3, $4, now() + interval '1 hour', $5, $6, $7, NULL)`,
      [
        currentContext.principalId,
        currentContext.actorSnapshotId,
        currentContext.authorizationDecisionId,
        currentContext.authorizationDecisionHash,
        currentContext.enterpriseId,
        [...currentContext.allowedProjectIds],
        currentContext.correlationId,
      ],
    );
    await probe.query('SET LOCAL ROLE release_publication_app');
    await expect(
      probe.query(
        `UPDATE release_publication.publication_attempt
            SET stable_idempotency_key = stable_idempotency_key
          WHERE release_id = $1`,
        [releaseId],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await probe.query('ROLLBACK');

    await expect(
      handleGetPublicationAttempts(db, context([OTHER_PROJECT]), {
        releaseRef: preparedRelease.releaseRef,
        destinationIds: [],
        outcomes: [],
        page: { pageSize: 20 },
      }),
    ).rejects.toBeInstanceOf(ReleasePublicationBusinessError);

    const immutableAttempt = await admin.query<{ stable_idempotency_key: string }>(
      `SELECT stable_idempotency_key
         FROM release_publication.publication_attempt
        WHERE attempt_id = $1`,
      [attemptAEnvelope.commandId],
    );
    await admin.query('BEGIN');
    await admin.query('SET LOCAL ROLE release_publication_owner');
    await expect(
      admin.query(
        `UPDATE release_publication.publication_attempt
            SET stable_idempotency_key = $2
          WHERE attempt_id = $1`,
        [attemptAEnvelope.commandId, 'tampered-stable-key'],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await admin.query('ROLLBACK');
    expect(immutableAttempt.rows[0]?.stable_idempotency_key).toBe(`wi07-${DESTINATION_A}`);

    // Emit only synthetic references, hashes, and outcomes for the WI-08 report.
    if (process.env.ZJU_IM05_WI08_REPORT === '1') {
      process.stdout.write(
        `[wi-08-release-report] ${JSON.stringify(
          {
            fixtureId: 'REL-801',
            scope: scope(),
            releaseRef: preparedRelease.releaseRef,
            packageRef,
            packagePayloadHash: packageView.packagePayloadHash,
            readinessRef,
            actorSnapshotRef,
            authorizationDecisionRef,
            authorizationRef,
            attempts: [
              attemptRefFor(attemptAEnvelope),
              attemptRefFor(attemptBEnvelope),
              attemptRefFor(retryBEnvelope),
            ],
            rawReceiptRefs: [rawReceiptRefA, rawReceiptRefB],
            receiptRefs: [receiptARef, receiptBRef],
            failureRef,
            completion: {
              status: completedRelease.status,
              aggregateVersion: completedRelease.aggregateVersion,
            },
            recallRef: recalledPayload.recallRef,
            outcomes: {
              afterReceiptA: 'PARTIALLY_RELEASED',
              afterReceiptB: 'RELEASED',
              afterCompletion: 'RELEASED',
              afterRecall: recalledPayload.status,
            },
            factCounts: factCounts.rows[0],
            observationHashReadback: 'PASS',
          },
          null,
          2,
        )}\n`,
      );
    }
  });
});
