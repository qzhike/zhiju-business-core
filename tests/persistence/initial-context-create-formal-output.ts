import type { createBlockedInputRecoveryEntry } from '@zhiju/api/composition';
import {
  createFormalCompletionEntry,
  type FormalCompletionEntryConfig,
} from '@zhiju/api/composition';
import type { ArtifactDb, InMemoryObjectStorage } from '@zhiju/artifact';
import {
  freezeCanonicalContent,
  handleCreateArtifact,
  linkCanonicalContent,
  stageCanonicalContent,
  withArtifactTransaction,
} from '@zhiju/artifact';
import { type Common, executionDocumentSchemaReference } from '@zhiju/contracts';
import type { createFormalCompletionAuthorizationPort } from '@zhiju/identity-policy';
import { formalCompletionBindings } from '@zhiju/identity-policy';
import type { InMemoryRenderObjectStorage } from '@zhiju/integration-gateway';
import { LocalSyntheticRuntimeDriver } from '@zhiju/integration-gateway';
import type { UuidV7 } from '@zhiju/shared-kernel';
import { type CanonicalJsonObject, newUuidV7, sha256CanonicalJson } from '@zhiju/shared-kernel';
import { digestCanonicalPayload, type TaskExecutionDb } from '@zhiju/task-execution';
import { type Kysely, type KyselyPlugin, sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  AUTH_HASH,
  contentHash,
  CORRELATION,
  definedValue,
  objectRef,
  OPERATOR,
  OPERATOR_ACTOR,
  POLICY_SNAPSHOT_ID,
  type Principal,
  record,
  REQUEST_DECISION,
} from './initial-context-fixtures.js';
import type {
  ScenarioFormalEnvelope,
  ScenarioQuality,
  ScenarioRecoveryEnvelope,
  ScenarioTerminalScenario,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface CreateFormalOutputContext {
  clock: InitialContextSuite['clock'];
  readonly terminalScenario: ScenarioTerminalScenario;
  readonly recoveryEntryRaw: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly workOrderRef: Common.ObjectRef;
  service: Principal;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly revokeCapabilityTracked: InitialContextSuite['revokeCapabilityTracked'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  fixture: InitialContextSuite['fixture'];
  readonly formalGrants: Map<string, string>;
  readonly formalEnvelope: ScenarioFormalEnvelope;
  readonly formalEntry: ReturnType<typeof createFormalCompletionEntry>;
  readonly grant: InitialContextSuite['grant'];
  readonly formalCodes: Record<string, string>;
  readonly runnerContext: InitialContextSuite['runnerContext'];
  readonly artifactDb: Kysely<ArtifactDb>;
  readonly scope: InitialContextSuite['scope'];
  readonly committedPayload: InitialContextSuite['committedPayload'];
  readonly artifactStorage: InMemoryObjectStorage;
  readonly operator: InitialContextSuite['operator'];
  readonly formalConfig: FormalCompletionEntryConfig;
  readonly queryProbe: KyselyPlugin;
  readonly guardedTeDb: Kysely<TaskExecutionDb>;
  readonly borrowedActors: Principal[];
  readonly queryReads: string[];
  readonly formalAuth: ReturnType<typeof createFormalCompletionAuthorizationPort>;
  readonly protectedReads: () => string[];
  readonly runtimeDriver: LocalSyntheticRuntimeDriver;
  admin: InitialContextSuite['admin'];
  replayFormalCreation: (() => Promise<unknown>) | undefined;
  actualFormalOutput: CanonicalJsonObject | undefined;
  actualFormalArtifact: Common.ObjectRef | undefined;
  readonly qualityProfile:
    { profileRef: Common.VersionedRef; gateId: UuidV7; approvalRequirementId: string } | undefined;
  readonly quality: ScenarioQuality;
  readonly other: InitialContextSuite['other'];
  actualQuality:
    { gateRef: Common.ContentAddressedRef; acceptanceRef: Common.SnapshotRef } | undefined;
  readonly runtimeJournal: InMemoryRenderObjectStorage;
  outputProof: (() => Promise<void>) | undefined;
}

export async function createFormalOutput(
  scenarioState: CreateFormalOutputContext,
  actualRun: Common.ObjectRef,
  actualAttempt: Common.ObjectRef,
): Promise<CanonicalJsonObject> {
  scenarioState.clock = Math.max(scenarioState.clock, Date.now());
  if (scenarioState.terminalScenario === 'FORMAL_RECOVERED') {
    const beforeCreation = await scenarioState.recoveryEntryRaw.read(
      await scenarioState.recoveryEnvelope(
        'workOrderExecutionStateReadV1',
        scenarioState.workOrderRef,
        { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
        scenarioState.service,
        undefined,
        true,
      ),
      scenarioState.sessionFor(scenarioState.service),
    );
    expect(record(beforeCreation).blockerRefs).toHaveLength(1);
    const key = 'outputCreationBundleReadV1';
    expect(
      await scenarioState.revokeCapabilityTracked(
        scenarioState.identityDeps([scenarioState.fixture.projectId]),
        {
          targetId: definedValue(scenarioState.formalGrants.get(key)),
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          reasonCode: 'FORMAL_BINDING_DEPENDENCY_REVOKED',
          effectiveAt: new Date(scenarioState.clock),
          idempotencyKey: newUuidV7(),
        },
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const proof = await scenarioState.formalEnvelope(
      'outputCreationBindingReadV1',
      actualRun,
      { runRef: actualRun } as unknown as CanonicalJsonObject,
      scenarioState.service,
      undefined,
      true,
    );
    await expect(
      scenarioState.formalEntry.readBinding(proof, scenarioState.sessionFor(scenarioState.service)),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DECISION_INVALID',
    });
    const mapping = definedValue(
      formalCompletionBindings().find((b) => b.capabilityConfigKey === key),
    );
    await scenarioState.grant({
      principal: scenarioState.service,
      capabilityCode: definedValue(scenarioState.formalCodes[key]),
      action: mapping.requiredGrantAction,
      selectorType: mapping.selectorType,
      targetObjectType: definedValue(mapping.targetObjectTypes[0]),
    });
    expect(
      await scenarioState.formalEntry.readBinding(
        await scenarioState.formalEnvelope(
          'outputCreationBindingReadV1',
          actualRun,
          { runRef: actualRun } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).toMatchObject({ runRef: actualRun });
    expect(
      record(
        await scenarioState.recoveryEntryRaw.read(
          await scenarioState.recoveryEnvelope(
            'workOrderExecutionStateReadV1',
            scenarioState.workOrderRef,
            { workOrderRef: scenarioState.workOrderRef } as unknown as CanonicalJsonObject,
            scenarioState.service,
            undefined,
            true,
          ),
          scenarioState.sessionFor(scenarioState.service),
        ),
      ).blockerRefs,
    ).toHaveLength(1);
  }
  const ctx = scenarioState.runnerContext();
  let artifactId: string = newUuidV7();
  const revisionId = newUuidV7(),
    contentId = newUuidV7();
  const artifactCommand = (
    type: string,
    targetType: string,
    targetId: string,
    payload: CanonicalJsonObject,
  ) => ({
    commandId: newUuidV7(),
    commandType: type,
    commandVersion: '1.0',
    idempotencyScope: type,
    idempotencyKey: newUuidV7(),
    requestPayload: payload,
    payload,
    enterpriseId: scenarioState.fixture.enterpriseId,
    projectId: scenarioState.fixture.projectId,
    targetType,
    targetId,
    correlationId: CORRELATION,
    principalId: OPERATOR,
    principalKind: 'HUMAN' as const,
    actorSnapshotId: OPERATOR_ACTOR,
    authorizationDecisionId: REQUEST_DECISION,
    policySnapshotId: POLICY_SNAPSHOT_ID,
  });
  const createdRoot = await handleCreateArtifact(
    scenarioState.artifactDb,
    ctx,
    artifactCommand('artifact.create_artifact', 'Artifact', artifactId, {
      enterpriseRef: objectRef('Enterprise', scenarioState.fixture.enterpriseId, {
        enterpriseId: scenarioState.fixture.enterpriseId,
      }),
      definition: {
        businessScope: 'PROJECT_DELIVERABLE',
        originProjectRef: objectRef(
          'Project',
          scenarioState.fixture.projectId,
          scenarioState.scope(),
        ),
        artifactType: 'CONTROL_PROCEDURE',
        title: `Formal completion output ${actualRun.objectId}`,
        classification: 'CUSTOMER_DELIVERY',
        deliveryItemRefs: [],
        metadata: {},
      },
    }) as unknown as Parameters<typeof handleCreateArtifact>[2],
  );
  expect(createdRoot, JSON.stringify(createdRoot)).toMatchObject({ status: 'COMMITTED' });
  const createdArtifact = scenarioState.committedPayload(createdRoot);
  artifactId = String(record(createdArtifact.artifactRef).objectId);
  const branch = String(
    record((createdArtifact.workingHeads as CanonicalJsonObject[])[0]).branchId,
  );
  const canonical = record(
    JSON.parse(
      readFileSync(
        new URL('../fixtures/contracts/canonical-content/document-golden.json', import.meta.url),
        'utf8',
      ),
    ),
  ).payload as Record<string, unknown>;
  canonical.schemaRef = executionDocumentSchemaReference(scenarioState.fixture.enterpriseId);
  record(canonical.body).documentId = newUuidV7();
  const contentDigest = contentHash(sha256CanonicalJson(canonical as CanonicalJsonObject));
  expect(
    await stageCanonicalContent(
      scenarioState.artifactDb,
      ctx,
      artifactCommand('artifact.stage_canonical_content', 'CanonicalContentObject', contentId, {
        content: canonical,
        declaredContentHash: contentDigest,
      } as unknown as CanonicalJsonObject) as unknown as Parameters<
        typeof stageCanonicalContent
      >[2],
      scenarioState.artifactStorage,
    ),
  ).toMatchObject({ status: 'COMMITTED' });
  expect(
    await linkCanonicalContent(
      scenarioState.artifactDb,
      ctx,
      artifactCommand('artifact.link_canonical_content', 'CanonicalContentObject', contentId, {
        ownerObjectType: 'ArtifactRevision',
        ownerObjectId: revisionId,
        ownerVersionId: revisionId,
      }) as unknown as Parameters<typeof linkCanonicalContent>[2],
      scenarioState.artifactStorage,
    ),
  ).toMatchObject({ commandResult: { status: 'COMMITTED' }, finalizationState: 'FINALIZED' });
  const frozen = await freezeCanonicalContent(
    scenarioState.artifactDb,
    ctx,
    artifactCommand('artifact.freeze_canonical_content', 'CanonicalContentObject', contentId, {}),
  );
  const payload = {
    runRef: actualRun,
    revision: {
      artifactRef: objectRef('artifact.artifact', artifactId, scenarioState.scope()),
      branchId: branch,
      parentRevisionRefs: [],
      contentType: 'STRUCTURED_DOCUMENT',
      contentRef: record(scenarioState.committedPayload(frozen)).objectRef,
      contentHash: contentDigest,
      structureSchemaRef: canonical.schemaRef,
      semanticMetadata: {},
      changedUnits: ['document-root'],
      changeSummary: 'Human created formal output',
    },
  } as unknown as CanonicalJsonObject;
  const create = await scenarioState.formalEnvelope(
    'executionRevisionCreateV1',
    objectRef('artifact.artifact_revision', revisionId, scenarioState.scope()) as Common.ObjectRef,
    payload,
    scenarioState.operator(),
  );
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    if (!('commandId' in create)) throw new Error('Expected creation Command');
    await expect(
      scenarioState.formalEntry.createRevision(
        { ...create, actor: scenarioState.service.actorRef },
        scenarioState.sessionFor(scenarioState.service),
      ),
    ).rejects.toBeDefined();
    const deniedEntry = createFormalCompletionEntry({
      ...scenarioState.formalConfig,
      artifactDb: scenarioState.artifactDb.withPlugin(scenarioState.queryProbe),
      taskExecutionDb: scenarioState.guardedTeDb,
    });
    for (const borrower of [scenarioState.service, ...scenarioState.borrowedActors]) {
      for (const key of ['executionRevisionCreateV1', 'formalOutputReleaseV1']) {
        const mapping = definedValue(
          formalCompletionBindings().find((b) => b.capabilityConfigKey === key),
        );
        if (borrower.principalKind !== 'HUMAN')
          await scenarioState.grant({
            principal: borrower,
            capabilityCode: definedValue(scenarioState.formalCodes[key]),
            action: mapping.requiredGrantAction,
            selectorType: mapping.selectorType,
            targetObjectType: definedValue(mapping.targetObjectTypes[0]),
          });
        const target = key === 'executionRevisionCreateV1' ? create.targetRef : actualAttempt;
        const body =
          key === 'executionRevisionCreateV1' ? payload : { attemptRef: actualAttempt, output: {} };
        scenarioState.queryReads.length = 0;
        const issued = await scenarioState.formalAuth.authorize(
          scenarioState.identityDeps([scenarioState.fixture.projectId], borrower),
          key,
          {
            actorSnapshotRef: borrower.actorRef,
            commandType: mapping.commandType,
            commandVersion: mapping.commandVersion,
            commandPayloadHash: digestCanonicalPayload(body as CanonicalJsonObject).hash,
            authenticationContextHash: AUTH_HASH,
            targetRef: target,
          },
        );
        expect(issued.outcome).toBe('DENY');
        if (key === 'executionRevisionCreateV1')
          await expect(
            deniedEntry.createRevision(
              { ...create, actor: borrower.actorRef },
              scenarioState.sessionFor(borrower),
            ),
          ).rejects.toBeDefined();
        else
          await expect(
            deniedEntry.releaseFormalOutput(
              body as CanonicalJsonObject,
              create.authorizationDecisionRef,
              scenarioState.sessionFor(borrower),
            ),
          ).rejects.toBeDefined();
        expect(scenarioState.protectedReads()).toEqual([]);
      }
    }
    const premature = {
      attemptRef: actualAttempt,
      output: {
        outputSlot: 'revision',
        objectType: 'artifact.artifact_revision',
        ref: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'artifact.artifact_revision',
          objectId: revisionId,
          scope: scenarioState.scope(),
          contentHash: contentDigest,
        },
        relationToTarget: 'created_for_work_order',
        declaredPurpose: 'Formal work order output',
        createdByRunRef: actualRun,
        creationCommandRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.artifact.command_receipt',
          objectId: newUuidV7(),
          scope: scenarioState.scope(),
          contentHash: contentHash('0'.repeat(64)),
        },
      },
    } as unknown as CanonicalJsonObject;
    const prematureProof = await scenarioState.formalEnvelope(
      'formalOutputReleaseV1',
      actualAttempt,
      premature,
      scenarioState.operator(),
    );
    await expect(
      scenarioState.formalEntry.releaseFormalOutput(
        premature,
        prematureProof.authorizationDecisionRef,
        scenarioState.sessionFor(),
      ),
    ).rejects.toBeDefined();
    expect(await scenarioState.runtimeDriver.readFinal(actualAttempt)).toBeUndefined();
    if (!('commandId' in create)) throw new Error('Expected creation Command');
    for (const [table, event, condition] of [
      ['artifact_revision', 'INSERT', `NEW.revision_id='${revisionId}'::uuid`],
      [
        'execution_revision_command_receipt',
        'INSERT',
        `NEW.command_id='${create.commandId}'::uuid`,
      ],
      [
        'execution_revision_creation_binding',
        'INSERT',
        `NEW.command_id='${create.commandId}'::uuid`,
      ],
      ['outbox_event', 'INSERT', `NEW.source_command_id='${create.commandId}'::uuid`],
      [
        'command_receipt',
        'UPDATE',
        `NEW.command_id='${create.commandId}'::uuid AND NEW.outcome='COMMITTED'`,
      ],
    ]) {
      await scenarioState.admin.query(
        "CREATE FUNCTION artifact.wi235_fault() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RAISE EXCEPTION 'wi235 creation fault' USING ERRCODE='P0001'; END $f$",
      );
      await scenarioState.admin.query(
        `CREATE TRIGGER zz_wi235_fault AFTER ${event} ON artifact.${table} FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION artifact.wi235_fault()`,
      );
      try {
        await expect(
          scenarioState.formalEntry.createRevision(create, scenarioState.sessionFor()),
        ).rejects.toMatchObject({
          code: 'P0001',
        });
      } finally {
        await scenarioState.admin.query(`DROP TRIGGER zz_wi235_fault ON artifact.${table}`);
        await scenarioState.admin.query('DROP FUNCTION artifact.wi235_fault()');
      }
      expect(
        (
          await scenarioState.admin.query(
            'SELECT revision_id FROM artifact.artifact_revision WHERE revision_id=$1',
            [revisionId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await scenarioState.admin.query(
            'SELECT command_id FROM artifact.command_receipt WHERE command_id=$1',
            [create.commandId],
          )
        ).rows,
      ).toEqual([]);
    }
  }
  const result = await scenarioState.formalEntry.createRevision(create, scenarioState.sessionFor());
  expect(result, JSON.stringify(result)).toMatchObject({ status: 'COMMITTED' });
  const refs = scenarioState.committedPayload(result);
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    for (const table of [
      'execution_revision_creation_binding',
      'execution_revision_command_receipt',
    ] as const) {
      const rows = (allowedProjectIds: readonly string[]) =>
        withArtifactTransaction(scenarioState.artifactDb, { ...ctx, allowedProjectIds }, (trx) =>
          sql`SELECT revision_id FROM ${sql.table(`artifact.${table}`)} WHERE revision_id=${revisionId}::uuid`.execute(
            trx,
          ),
        );
      expect((await rows([scenarioState.fixture.projectId])).rows).toEqual([
        { revision_id: revisionId },
      ]);
      expect((await rows([newUuidV7()])).rows).toEqual([]);
      expect((await rows([scenarioState.fixture.projectId])).rows).toEqual([
        { revision_id: revisionId },
      ]);
      for (const action of ['UPDATE', 'DELETE']) {
        const statement =
          action === 'UPDATE'
            ? `UPDATE artifact.${table} SET canonical_payload=canonical_payload WHERE revision_id=$1`
            : `DELETE FROM artifact.${table} WHERE revision_id=$1`;
        await expect(
          withArtifactTransaction(scenarioState.artifactDb, ctx, (trx) =>
            sql.raw(statement.replace('$1', `'${revisionId}'::uuid`)).execute(trx),
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(scenarioState.admin.query(statement, [revisionId])).rejects.toMatchObject({
          code: '55000',
        });
      }
    }
  }
  scenarioState.replayFormalCreation = () =>
    scenarioState.formalEntry.createRevision(create, scenarioState.sessionFor());
  const output = {
    outputSlot: 'revision',
    objectType: 'artifact.artifact_revision',
    ref: refs.revisionRef,
    relationToTarget: 'created_for_work_order',
    declaredPurpose: 'Formal work order output',
    createdByRunRef: actualRun,
    creationCommandRef: refs.creationCommandRef,
  } as unknown as CanonicalJsonObject;
  scenarioState.actualFormalOutput = output;
  scenarioState.actualFormalArtifact = objectRef(
    'artifact.artifact',
    artifactId,
    scenarioState.scope(),
  ) as Common.ObjectRef;
  if (scenarioState.qualityProfile) {
    const otherProfile = await scenarioState.quality.createProfile();
    const otherAcceptance = await scenarioState.quality.accept(
      otherProfile,
      scenarioState.actualFormalArtifact,
      refs.revisionRef as unknown as Common.ContentAddressedRef,
    );
    await scenarioState.quality.approve(
      otherProfile,
      scenarioState.actualFormalArtifact,
      refs.revisionRef as unknown as Common.ContentAddressedRef,
      otherAcceptance.acceptanceRef,
      scenarioState.runnerContext(scenarioState.other()),
    );
    scenarioState.actualQuality = await scenarioState.quality.accept(
      scenarioState.qualityProfile,
      scenarioState.actualFormalArtifact,
      refs.revisionRef as unknown as Common.ContentAddressedRef,
    );
    await scenarioState.quality.approve(
      scenarioState.qualityProfile,
      scenarioState.actualFormalArtifact,
      refs.revisionRef as unknown as Common.ContentAddressedRef,
      scenarioState.actualQuality.acceptanceRef,
      scenarioState.runnerContext(scenarioState.other()),
    );
  }
  const release = { attemptRef: actualAttempt, output } as unknown as CanonicalJsonObject;
  const proof = await scenarioState.formalEnvelope(
    'formalOutputReleaseV1',
    actualAttempt,
    release,
    scenarioState.operator(),
  );
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    const denied = createFormalCompletionEntry({
      ...scenarioState.formalConfig,
      artifactDb: scenarioState.artifactDb.withPlugin(scenarioState.queryProbe),
      taskExecutionDb: scenarioState.guardedTeDb,
    });
    for (const borrower of [scenarioState.service, ...scenarioState.borrowedActors]) {
      scenarioState.queryReads.length = 0;
      await expect(
        denied.releaseFormalOutput(
          release,
          proof.authorizationDecisionRef,
          scenarioState.sessionFor(borrower),
        ),
      ).rejects.toBeDefined();
      expect(scenarioState.protectedReads()).toEqual([]);
    }
  }
  await scenarioState.formalEntry.releaseFormalOutput(
    release,
    proof.authorizationDecisionRef,
    scenarioState.sessionFor(),
  );
  if (scenarioState.terminalScenario === 'FORMAL_NORMAL') {
    const otherOutput = { ...output, declaredPurpose: 'Conflicting second final' };
    const conflictRelease = {
      attemptRef: actualAttempt,
      output: otherOutput,
    } as unknown as CanonicalJsonObject;
    const conflictProof = await scenarioState.formalEnvelope(
      'formalOutputReleaseV1',
      actualAttempt,
      conflictRelease,
      scenarioState.operator(),
    );
    await expect(
      scenarioState.formalEntry.releaseFormalOutput(
        conflictRelease,
        conflictProof.authorizationDecisionRef,
        scenarioState.sessionFor(),
      ),
    ).rejects.toMatchObject({ code: 'INTEGRATION_RUNTIME_FINAL_CONFLICT' });
  }
  const restartedDriver = new LocalSyntheticRuntimeDriver(
    undefined,
    scenarioState.runtimeJournal,
    () => new Date(scenarioState.clock),
  );
  const savedFinal = await scenarioState.runtimeDriver.readFinal(actualAttempt);
  expect(savedFinal).toBeDefined();
  expect(await restartedDriver.readFinal(actualAttempt)).toEqual(savedFinal);
  await restartedDriver.releaseFormalOutput(actualAttempt, output, {
    revalidateAuthorization: async () => {
      if (!scenarioState.outputProof) throw new Error('Missing current output proof');
      await scenarioState.outputProof();
    },
    readExecutionOutput: async (revisionRef) =>
      (await scenarioState.formalEntry.readOutput(
        await scenarioState.formalEnvelope(
          'executionOutputReadV1',
          revisionRef,
          { revisionRef } as unknown as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      )) as unknown as CanonicalJsonObject,
  });
  expect(await restartedDriver.readFinal(actualAttempt)).toEqual(savedFinal);
  expect(restartedDriver.invokedAttemptIds).toEqual([]);
  expect(
    await scenarioState.formalEntry.createRevision(create, scenarioState.sessionFor()),
  ).toMatchObject({
    status: 'DUPLICATE',
    resultPayload: refs,
  });
  return output;
}
