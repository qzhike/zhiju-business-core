import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Artifact, Common } from '@zhiju/contracts';
import {
  ARTIFACT_HUMAN_ONLY_DENIED,
  ARTIFACT_CONTENT_READBACK_MISMATCH,
  ARTIFACT_WORKBOOK_BASE_INVALID,
  ARTIFACT_WORKBOOK_BASE_STALE,
  ARTIFACT_WORKBOOK_EDIT_SCOPE,
  ARTIFACT_WORKBOOK_NOOP,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  createArtifactDatabase,
  freezeCanonicalContent,
  handleCreateAndSealRevision,
  handleCreateArtifact,
  handleGetWorkbookDiff,
  handleGetRevisionSnapshot,
  handleHumanWorkbookEdit,
  handleMoveWorkingHead,
  InMemoryObjectStorage,
  linkCanonicalContent,
  stageCanonicalContent,
  type ArtifactTransactionContext,
  type CommandEnvelope,
  type WorkbookEditCommandEnvelope,
} from '@zhiju/artifact';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

// IM-04 WI-07 (issue #96): real PostgreSQL coverage for scoped Human Edit,
// exact historical replay and rebuildable WorkbookSpec Diff.

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9d201';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9d202';
const PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9d302';
const ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9d303';
const DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9d304';
const POLICY = '018f22e2-7c15-7b2e-8d86-2de956a9d305';
const DELIVERY_ITEM = '018f22e2-7c15-7b2e-8d86-2de956a9d241';
const DELIVERY_VERSION = '018f22e2-7c15-7b2e-8d86-2de956a9d242';

interface CanonicalFixture {
  readonly payload: Artifact.CanonicalWorkbookContent;
  readonly manifest: { readonly contentHash: Common.ContentHash };
}

interface ArtifactFacts {
  readonly artifactId: string;
  readonly branchId: string;
  readonly artifactRef: Common.ObjectRef;
}

type TestEnvelope<TPayload> = CommandEnvelope & { readonly payload: TPayload };

function loadFixture(): CanonicalFixture {
  const fixtureUrl = new URL(
    '../../tests/fixtures/contracts/canonical-content/workbook-golden.json',
    import.meta.url,
  );
  return JSON.parse(readFileSync(fixtureUrl, 'utf8')) as CanonicalFixture;
}

function contextFor(
  overrides: Partial<ArtifactTransactionContext> = {},
): ArtifactTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: Buffer.alloc(32, 0x96),
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId: ENTERPRISE,
    allowedProjectIds: [PROJECT],
    correlationId: newUuidV7(),
    ...overrides,
  };
}

function enterpriseRef(): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Enterprise',
    objectId: ENTERPRISE,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function projectRef(): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'Project',
    objectId: PROJECT,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function deliveryItemRef(): Common.VersionedRef {
  return {
    kind: 'VERSIONED',
    objectType: 'DeliveryItem',
    objectId: DELIVERY_ITEM,
    versionId: DELIVERY_VERSION,
    scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
  };
}

function commandEnvelope<TPayload>(
  context: ArtifactTransactionContext,
  payload: TPayload,
  options: {
    readonly commandType?: string;
    readonly idempotencyScope?: string;
    readonly idempotencyKey?: string;
    readonly targetType?: string;
    readonly targetId?: string;
    readonly projectId?: string;
    readonly expectedAggregateVersion?: string;
  } = {},
): TestEnvelope<TPayload> {
  return {
    commandId: newUuidV7(),
    commandType: options.commandType ?? 'artifact.issue-96.test',
    commandVersion: '1.0',
    idempotencyScope: options.idempotencyScope ?? 'im04-wi07-test',
    idempotencyKey: options.idempotencyKey ?? `wi07-${newUuidV7()}`,
    requestPayload: payload as unknown as CanonicalJsonObject,
    enterpriseId: context.enterpriseId,
    ...(options.projectId === undefined ? {} : { projectId: options.projectId }),
    targetType: options.targetType ?? 'Artifact',
    targetId: options.targetId ?? newUuidV7(),
    ...(options.expectedAggregateVersion === undefined
      ? {}
      : { expectedAggregateVersion: options.expectedAggregateVersion }),
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
    payload,
  };
}

function committedPayload(result: {
  readonly status: string;
  readonly resultPayload?: CanonicalJsonObject | null;
}): CanonicalJsonObject {
  if (
    result.status !== 'COMMITTED' ||
    result.resultPayload === undefined ||
    result.resultPayload === null
  ) {
    throw new Error(`expected COMMITTED result, received ${result.status}`);
  }
  return result.resultPayload;
}

function artifactFactsFrom(result: {
  readonly status: string;
  readonly resultPayload?: CanonicalJsonObject | null;
}): ArtifactFacts {
  const payload = committedPayload(result);
  const artifactRef = payload.artifactRef as unknown as Common.ObjectRef;
  const workingHeads = payload.workingHeads as unknown as readonly Record<string, unknown>[];
  const branchId = workingHeads[0]?.branchId;
  if (typeof branchId !== 'string') throw new Error('Artifact did not return its main Branch');
  return { artifactId: artifactRef.objectId, branchId, artifactRef };
}

function principalRef(): Common.ObjectRef {
  return {
    kind: 'OBJECT',
    objectType: 'identity.principal',
    objectId: PRINCIPAL,
    scope: { enterpriseId: ENTERPRISE },
  };
}

function revisionContent(
  artifact: ArtifactFacts,
  fixture: CanonicalFixture,
  contentRef: string,
  contentHash: Common.ContentHash,
): Artifact.RevisionContent {
  return {
    artifactRef: artifact.artifactRef,
    branchId: artifact.branchId,
    parentRevisionRefs: [],
    contentType: 'WORKBOOK_SPEC',
    contentRef,
    contentHash,
    structureSchemaRef: fixture.payload.schemaRef,
    semanticMetadata: { issue: 96, fixture: 'synthetic-procurement' },
    changedUnits: ['sheet/supplier-sheet'],
    changeSummary: 'initial WorkbookSpec fixture',
    provenance: {
      principal: principalRef(),
      sourceMaterialRefs: [],
      toolchainVersions: [{ name: 'issue-96-test', version: '1' }],
    },
  };
}

function editEnvelope(
  context: ArtifactTransactionContext,
  artifactId: string,
  payload: WorkbookEditCommandEnvelope['payload'],
): WorkbookEditCommandEnvelope {
  return commandEnvelope(context, payload, {
    targetType: 'Artifact',
    targetId: artifactId,
    projectId: PROJECT,
    commandType: 'artifact.workbook.human_edit.issue-96',
  });
}

describe.skipIf(databaseUrl === undefined)(
  'Artifact WI-07 WorkbookSpec Human Edit (real PostgreSQL)',
  () => {
    const fixture = loadFixture();
    let admin: pg.Client;
    let pool: pg.Pool;
    let db: ReturnType<typeof createArtifactDatabase>;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `CREATE ROLE im04_wi07_probe LOGIN PASSWORD 'im04-wi07-probe' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
      );
      await admin.query('GRANT platform_context_establisher, artifact_app TO im04_wi07_probe');
      const probeUrl = new URL(databaseUrl ?? '');
      probeUrl.username = 'im04_wi07_probe';
      probeUrl.password = 'im04-wi07-probe';
      pool = new pg.Pool({ connectionString: probeUrl.toString(), max: 6 });
      db = createArtifactDatabase(pool);
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    async function revisionCount(artifactId: string): Promise<number> {
      const result = await admin.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM artifact.artifact_revision WHERE artifact_id = $1',
        [artifactId],
      );
      return Number(result.rows[0]?.count ?? '-1');
    }

    async function createArtifact(context: ArtifactTransactionContext): Promise<ArtifactFacts> {
      const result = await handleCreateArtifact(
        db,
        context,
        commandEnvelope(
          context,
          {
            enterpriseRef: enterpriseRef(),
            definition: {
              businessScope: 'PROJECT_DELIVERABLE',
              originProjectRef: projectRef(),
              artifactType: 'CONTROL_PROCEDURE',
              title: `WI-07 synthetic procurement ${newUuidV7()}`,
              classification: 'CUSTOMER_DELIVERY',
              deliveryItemRefs: [deliveryItemRef()],
              metadata: { issue: 96 },
            },
          },
          { commandType: 'artifact.create_artifact.issue-96' },
        ),
      );
      return artifactFactsFrom(result);
    }

    async function createInitialRevision(
      context: ArtifactTransactionContext,
      artifact: ArtifactFacts,
      storage: InMemoryObjectStorage,
    ): Promise<Artifact.RevisionSnapshot> {
      const revisionId = newUuidV7();
      const contentObjectId = newUuidV7();
      const staged = await stageCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            content: structuredClone(fixture.payload),
            declaredContentHash: fixture.manifest.contentHash,
          },
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            projectId: PROJECT,
            commandType: 'artifact.content-object.stage.issue-96',
          },
        ),
        storage,
      );
      expect(staged.status).toBe('COMMITTED');
      const linked = await linkCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {
            ownerObjectType: 'ArtifactRevision',
            ownerObjectId: revisionId,
            ownerVersionId: revisionId,
          },
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            projectId: PROJECT,
            commandType: 'artifact.content-object.link.issue-96',
          },
        ),
        storage,
      );
      expect(linked.commandResult.status).toBe('COMMITTED');
      expect(linked.finalizationState).toBe('FINALIZED');
      const frozen = await freezeCanonicalContent(
        db,
        context,
        commandEnvelope(
          context,
          {},
          {
            targetType: 'CanonicalContentObject',
            targetId: contentObjectId,
            projectId: PROJECT,
            commandType: 'artifact.content-object.freeze.issue-96',
          },
        ),
      );
      const manifest = committedPayload(frozen);
      const contentRef = manifest.objectRef;
      if (typeof contentRef !== 'string') throw new Error('FROZEN Manifest lacks objectRef');
      const revision = await handleCreateAndSealRevision(
        db,
        context,
        commandEnvelope(
          context,
          {
            revision: revisionContent(artifact, fixture, contentRef, fixture.manifest.contentHash),
          },
          {
            targetType: 'ArtifactRevision',
            targetId: revisionId,
            projectId: PROJECT,
            commandType: 'artifact.create_and_seal_revision.issue-96',
          },
        ),
      );
      const snapshot = committedPayload(revision) as unknown as Artifact.RevisionSnapshot;
      const moved = await handleMoveWorkingHead(
        db,
        context,
        commandEnvelope(
          context,
          {
            branchId: artifact.branchId,
            newHeadRef: snapshot.revisionRef,
            moveReason: {
              reasonCode: 'INITIAL_WORKBOOK',
              summary: 'set the exact initial WorkbookSpec head',
              evidenceRefs: [],
            },
          },
          {
            targetType: 'Artifact',
            targetId: artifact.artifactId,
            projectId: PROJECT,
            expectedAggregateVersion: '0',
            commandType: 'artifact.move_working_head.initial-workbook.issue-96',
          },
        ),
      );
      expect(moved.status).toBe('COMMITTED');
      return snapshot;
    }

    function changedAmount(value: number): Artifact.CanonicalWorkbookSpec {
      return {
        ...structuredClone(fixture.payload.body),
        sheets: fixture.payload.body.sheets.map((sheet) => ({
          ...sheet,
          rows: sheet.rows.map((row) => ({
            ...row,
            cells: row.cells.map((cell) =>
              cell.cellId === 'supplier-row-2-amount' ? { ...cell, value } : cell,
            ),
          })),
        })),
      };
    }

    const amountCellRef = {
      kind: 'CELL' as const,
      sheetId: 'supplier-sheet',
      rowId: 'supplier-row-2',
      cellId: 'supplier-row-2-amount',
    };

    it('creates one immutable candidate, replays it and rebuilds exact Diff', async () => {
      const context = contextFor();
      const artifact = await createArtifact(context);
      const storage = new InMemoryObjectStorage();
      const baseSnapshot = await createInitialRevision(context, artifact, storage);
      const baseRef = baseSnapshot.revisionRef;
      const payload: WorkbookEditCommandEnvelope['payload'] = {
        baseRevisionRef: baseRef,
        allowedRefs: [amountCellRef],
        workbook: changedAmount(4),
        changeSummary: 'human corrected the declared supplier amount',
      };
      const envelope = editEnvelope(context, artifact.artifactId, payload);
      const edit = await handleHumanWorkbookEdit(db, context, envelope, storage);
      const replay = await handleHumanWorkbookEdit(db, context, envelope, storage);

      expect(replay).toEqual(edit);
      expect(edit.revision.parentRevisionRefs).toEqual([baseRef]);
      expect(edit.revision.revisionNumber).toBe(2);
      expect(edit.diff.entries).toEqual([
        expect.objectContaining({
          kind: 'CHANGED',
          entityType: 'CELL',
          stableId: 'supplier-row-2-amount',
        }),
      ]);
      expect(edit.contentHash).not.toEqual(fixture.manifest.contentHash);
      expect(edit.canonicalBytes).toContain('"value":4');
      expect(await handleGetRevisionSnapshot(db, context, { revisionRef: baseRef })).toEqual(
        baseSnapshot,
      );

      const rebuilt = await handleGetWorkbookDiff(
        db,
        context,
        { leftRef: baseRef, rightRef: edit.revision.revisionRef },
        storage,
      );
      expect(rebuilt.diff).toEqual(edit.diff);
      expect(rebuilt.diff).toEqual(
        await handleGetWorkbookDiff(
          db,
          context,
          { leftRef: baseRef, rightRef: edit.revision.revisionRef },
          storage,
        ).then((result) => result.diff),
      );
      expect(await revisionCount(artifact.artifactId)).toBe(2);

      const conflictingPayload: WorkbookEditCommandEnvelope['payload'] = {
        ...payload,
        workbook: changedAmount(5),
      };
      const conflictingEnvelope: WorkbookEditCommandEnvelope = {
        ...envelope,
        commandId: newUuidV7(),
        requestPayload: conflictingPayload as unknown as CanonicalJsonObject,
        payload: conflictingPayload,
      };
      await expect(
        handleHumanWorkbookEdit(db, context, conflictingEnvelope, storage),
      ).rejects.toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT });
      expect(await revisionCount(artifact.artifactId)).toBe(2);
    });

    it('rejects actor, invalid exact base, stale head and out-of-scope edits before Revision creation', async () => {
      const context = contextFor();
      const artifact = await createArtifact(context);
      const storage = new InMemoryObjectStorage();
      const baseSnapshot = await createInitialRevision(context, artifact, storage);
      const baseRef = baseSnapshot.revisionRef;
      const candidate = changedAmount(4);
      const before = await revisionCount(artifact.artifactId);

      await expect(
        handleHumanWorkbookEdit(
          db,
          context,
          editEnvelope(context, artifact.artifactId, {
            baseRevisionRef: baseRef,
            allowedRefs: [
              {
                kind: 'CELL',
                sheetId: 'supplier-sheet',
                rowId: 'supplier-row-1',
                cellId: 'supplier-row-1-amount',
              },
            ],
            workbook: candidate,
            changeSummary: 'unauthorized Cell edit',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_WORKBOOK_EDIT_SCOPE });
      expect(await revisionCount(artifact.artifactId)).toBe(before);

      const invalidAllowedRefs: readonly (readonly unknown[])[] = [
        [],
        [amountCellRef, amountCellRef],
        [{ kind: 'CELL', sheetId: 'supplier-sheet', rowId: 'missing-row', cellId: 'missing-cell' }],
      ];
      for (const allowedRefs of invalidAllowedRefs) {
        await expect(
          handleHumanWorkbookEdit(
            db,
            context,
            editEnvelope(context, artifact.artifactId, {
              baseRevisionRef: baseRef,
              allowedRefs: allowedRefs as WorkbookEditCommandEnvelope['payload']['allowedRefs'],
              workbook: candidate,
              changeSummary: 'invalid allow-list',
            }),
            storage,
          ),
        ).rejects.toMatchObject({ code: ARTIFACT_WORKBOOK_EDIT_SCOPE });
        expect(await revisionCount(artifact.artifactId)).toBe(before);
      }

      await expect(
        handleHumanWorkbookEdit(
          db,
          context,
          editEnvelope(context, artifact.artifactId, {
            baseRevisionRef: baseRef,
            allowedRefs: [amountCellRef],
            workbook: fixture.payload.body,
            changeSummary: 'canonical no-op',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_WORKBOOK_NOOP });
      expect(await revisionCount(artifact.artifactId)).toBe(before);

      const crossSheet = changedAmount(4);
      const firstSheet = crossSheet.sheets[0];
      if (firstSheet === undefined) throw new Error('missing fixture Sheet');
      const invalidCrossSheet: Artifact.CanonicalWorkbookSpec = {
        ...crossSheet,
        sheets: [
          {
            ...firstSheet,
            rows: firstSheet.rows.map((row) => ({
              ...row,
              cells: row.cells.map((cell) =>
                cell.cellId === 'supplier-row-2-amount'
                  ? { ...cell, columnId: 'other-sheet-column' }
                  : cell,
              ),
            })),
          },
        ],
      };
      await expect(
        handleHumanWorkbookEdit(
          db,
          context,
          editEnvelope(context, artifact.artifactId, {
            baseRevisionRef: baseRef,
            allowedRefs: [amountCellRef],
            workbook: invalidCrossSheet,
            changeSummary: 'cross-Sheet Column reference',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: 'ARTIFACT_WORKBOOK_SCHEMA_INVALID' });
      expect(await revisionCount(artifact.artifactId)).toBe(before);

      const wrongHash = {
        ...baseRef,
        contentHash: { ...baseRef.contentHash, digest: 'f'.repeat(64) },
      };
      await expect(
        handleHumanWorkbookEdit(
          db,
          context,
          editEnvelope(context, artifact.artifactId, {
            baseRevisionRef: wrongHash,
            allowedRefs: [amountCellRef],
            workbook: candidate,
            changeSummary: 'wrong base hash',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_WORKBOOK_BASE_INVALID });
      expect(await revisionCount(artifact.artifactId)).toBe(before);

      const agentContext = contextFor({ principalKind: 'AGENT' });
      await expect(
        handleHumanWorkbookEdit(
          db,
          agentContext,
          editEnvelope(agentContext, artifact.artifactId, {
            baseRevisionRef: baseRef,
            allowedRefs: [amountCellRef],
            workbook: candidate,
            changeSummary: 'agent edit denied',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_HUMAN_ONLY_DENIED });
      expect(await revisionCount(artifact.artifactId)).toBe(before);

      const divergent = await handleHumanWorkbookEdit(
        db,
        context,
        editEnvelope(context, artifact.artifactId, {
          baseRevisionRef: baseRef,
          allowedRefs: [amountCellRef],
          workbook: candidate,
          changeSummary: 'prepare a divergent head for stale-base probe',
        }),
        storage,
      );
      expect(divergent.revision.revisionNumber).toBe(2);
      const move = await handleMoveWorkingHead(
        db,
        context,
        commandEnvelope(
          context,
          {
            branchId: artifact.branchId,
            expectedHeadRef: baseRef,
            newHeadRef: divergent.revision.revisionRef,
            moveReason: {
              reasonCode: 'TEST',
              summary: 'advance exact Workbook head',
              evidenceRefs: [],
            },
          },
          {
            targetType: 'Artifact',
            targetId: artifact.artifactId,
            projectId: PROJECT,
            expectedAggregateVersion: '1',
            commandType: 'artifact.move_working_head.issue-96',
          },
        ),
      );
      expect(move.status).toBe('COMMITTED');
      const beforeStale = await revisionCount(artifact.artifactId);
      await expect(
        handleHumanWorkbookEdit(
          db,
          context,
          editEnvelope(context, artifact.artifactId, {
            baseRevisionRef: baseRef,
            allowedRefs: [amountCellRef],
            workbook: changedAmount(5),
            changeSummary: 'stale base edit',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_WORKBOOK_BASE_STALE });
      expect(await revisionCount(artifact.artifactId)).toBe(beforeStale);
    });

    it('fails closed when authoritative Workbook bytes are tampered', async () => {
      const context = contextFor();
      const artifact = await createArtifact(context);
      const storage = new InMemoryObjectStorage();
      const baseSnapshot = await createInitialRevision(context, artifact, storage);
      storage.tamper(baseSnapshot.contentRef, {
        bytes: Buffer.from('{"tampered":true}', 'utf8'),
      });

      await expect(
        handleHumanWorkbookEdit(
          db,
          context,
          editEnvelope(context, artifact.artifactId, {
            baseRevisionRef: baseSnapshot.revisionRef,
            allowedRefs: [amountCellRef],
            workbook: changedAmount(4),
            changeSummary: 'must reject non-authoritative bytes',
          }),
          storage,
        ),
      ).rejects.toMatchObject({ code: ARTIFACT_CONTENT_READBACK_MISMATCH });
      expect(await revisionCount(artifact.artifactId)).toBe(1);
    });
  },
);
