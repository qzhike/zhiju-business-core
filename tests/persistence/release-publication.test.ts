// IM-05 WI-06 (issue #126): real PostgreSQL persistence evidence for Release
// drafts, exact authority references, frozen Package hashes, CAS/idempotency,
// RLS/ACL, immutable history and transaction rollback.

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
  executeReleasePublicationCommand,
  handleCreateReleaseDraft,
  handleGetFrozenPackage,
  handleGetRelease,
  handlePrepareRelease,
  handleSelectRepresentations,
  handleSetDestinations,
  ReleasePublicationBusinessError,
  type CommandResult,
  type ReleaseAuthorityQueryPorts,
  type ReleaseCommandEnvelope,
  type ReleaseTransactionContext,
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
const PROBE_ROLE = 'im05_wi06_release_probe';
const PROBE_PASSWORD = 'im05-wi06-release-probe';

function context(projectIds: readonly string[] = [PROJECT]): ReleaseTransactionContext {
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
});
