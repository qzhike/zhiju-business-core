import type { Common } from '@zhiju/contracts';
import {
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
  createTaskExecutionContextSnapshotAuthorizationPort,
} from '@zhiju/identity-policy';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  API_VALUE_INVALID,
  assembleInitialContext,
  type CommandResult,
  digestCanonicalPayload,
  EXECUTION_CONTEXT_INPUT_REQUIRED,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  EXECUTION_CONTEXT_TARGET_INVALID,
  EXECUTION_WORK_ORDER_SCOPE_INVALID,
  REFERENCE_INVALID,
} from '@zhiju/task-execution';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  ACTIONS,
  AUTH_HASH,
  BUILD_COMMAND,
  BUILDER_POLICY,
  COMPATIBILITY_BASELINE,
  contentHash,
  CONTEXT_SNAPSHOT_LEGACY_OBJECT,
  CONTEXT_SNAPSHOT_OBJECT,
  contextSnapshotCapabilityCodes,
  objectRef,
  policyKey,
  type Principal,
  PUBLIC_API_CATALOG,
  PURPOSE_DOCUMENT,
  PURPOSE_REVIEW,
  READ_QUERY,
  READ_VERSION,
  record,
  TASK_V2,
} from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerContextRead(suite: InitialContextSuite): void {
  suite.itIntegration('TE-214-D-014 returns the exact committed snapshot', async () => {
    const buildEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-014-build' });
    const built = await suite.attemptBuild(buildEnvelope);
    expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (built.result === undefined) throw new Error('the 014 build did not commit');
    const targetId = record(buildEnvelope.targetRef).objectId as string;
    const snapshotRef = suite.contextSnapshotRefOf(built.result);
    const row = await suite.contextSnapshotRow(targetId);
    if (row === undefined) throw new Error('the 014 snapshot row is missing');

    // The read writes nothing: every fact table keeps its row counts.
    const countsBefore = {
      receipts: await suite.countRows('task_execution.command_receipt'),
      audits: await suite.countRows('task_execution.audit_record'),
      outbox: await suite.countRows('task_execution.outbox_event'),
      snapshots: await suite.countRows('task_execution.context_snapshot'),
    };
    const read = await suite.attemptRead(await suite.preparedRead({ snapshotRef }));
    expect(read, JSON.stringify(read)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (read.result?.status !== 'COMMITTED') throw new Error('the 014 read did not close');
    const resultPayload = record(read.result.resultPayload);
    // The requested ref is echoed verbatim; the stored payload byte-equal.
    expect(resultPayload.contextSnapshotRef).toEqual(snapshotRef);
    expect(resultPayload.projectContextContract).toEqual(row.canonical_payload);
    expect(resultPayload.contractRef).toEqual({
      kind: 'CONTENT_ADDRESSED',
      objectType: 'zhiju.contract.project_context',
      objectId: row.snapshot_id,
      scope: { enterpriseId: suite.fixture.enterpriseId, projectId: suite.fixture.projectId },
      contentHash: {
        algorithm: 'SHA-256',
        digest: row.payload_hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    });
    expect(await suite.countRows('task_execution.command_receipt')).toBe(countsBefore.receipts);
    expect(await suite.countRows('task_execution.audit_record')).toBe(countsBefore.audits);
    expect(await suite.countRows('task_execution.outbox_event')).toBe(countsBefore.outbox);
    expect(await suite.countRows('task_execution.context_snapshot')).toBe(countsBefore.snapshots);

    // §20.1 route 2: the legacy spelling passes the registered Envelope (a
    // generic SnapshotRef) and gets its own Grant and Decision under the
    // second principal, then reads the import-only `context_snapshot_legacy`
    // store. TE-214-D-015 relies on this Grant staying active for its legacy
    // selector probe. (The operator already holds the canonical read Grant: a
    // second ACTIVE Grant for the same principal, capability and Scope is
    // refused as IDENTITY_CAPABILITY_ALREADY_ACTIVE regardless of the
    // selector, so the legacy Grant belongs to other().)
    await suite.grant({
      principal: suite.other(),
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotRead,
      action: ACTIONS.ctxRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
    });
    // The controlled import of one historical Snapshot under its original
    // legacy identity (the full negative import matrix is TE-217-D-001).
    const legacyObjectId = newUuidV7();
    const legacySnapshotId = newUuidV7();
    const legacy = suite.legacyFixtureOf(row.canonical_payload, legacySnapshotId);
    const importFailure = await suite.importLegacySnapshot({
      snapshotId: legacySnapshotId,
      objectId: legacyObjectId,
      enterpriseId: suite.fixture.enterpriseId,
      projectId: suite.fixture.projectId,
      payloadHash: Buffer.from(legacy.digest, 'hex'),
      canonicalPayload: legacy.payload,
      projectContextContract: legacy.payload,
      contractRef: suite.closedContractRef(legacySnapshotId, legacy.digest),
    });
    expect(importFailure).toBeNull();
    const legacyRef = suite.legacySnapshotRefOf(legacyObjectId, legacySnapshotId, legacy.digest);
    const legacyRow = await suite.legacySnapshotRow(legacyObjectId);
    if (legacyRow === undefined) throw new Error('the imported legacy row is missing');
    // The exact read-back: the requested ref is echoed verbatim and the
    // historical contract body and its reference come from their own stored
    // columns — never rebuilt, extended or re-spelled.
    const legacyRead = await suite.attemptRead(
      await suite.preparedRead({
        snapshotRef: legacyRef,
        principal: suite.other(),
        targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
      }),
      suite.initialContextEntry,
      suite.other(),
    );
    expect(legacyRead, JSON.stringify(legacyRead)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    if (legacyRead.result?.status !== 'COMMITTED') {
      throw new Error('the 014 legacy read did not close');
    }
    const legacyResult = record(legacyRead.result.resultPayload);
    expect(legacyResult.contextSnapshotRef).toEqual(legacyRef);
    expect(legacyResult.projectContextContract).toEqual(legacyRow.project_context_contract);
    expect(legacyResult.contractRef).toEqual(legacyRow.contract_ref);

    // A miss in the legacy store — here the *canonical* Snapshot's identity
    // under the legacy spelling — is the same REFERENCE_INVALID, and never
    // falls through to the canonical table.
    const legacyMiss = await suite.attemptRead(
      await suite.preparedRead({
        snapshotRef,
        principal: suite.other(),
        refOverride: { ...snapshotRef, objectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT },
        targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
      }),
      suite.initialContextEntry,
      suite.other(),
    );
    expect(legacyMiss).toMatchObject({ code: REFERENCE_INVALID, thrown: false });

    // An uncommitted identity and a foreign hash are the same refusal.
    const ghostRef = {
      kind: 'SNAPSHOT',
      objectType: CONTEXT_SNAPSHOT_OBJECT,
      objectId: newUuidV7(),
      snapshotId: newUuidV7(),
      scope: suite.scope(),
      contentHash: contentHash('0'.repeat(64)),
    };
    const ghost = await suite.attemptRead(
      await suite.preparedRead({ snapshotRef: ghostRef as unknown as Common.SnapshotRef }),
    );
    expect(ghost).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
    const foreignHash = await suite.attemptRead(
      await suite.preparedRead({
        snapshotRef,
        refOverride: { ...snapshotRef, contentHash: contentHash('0'.repeat(64)) },
      }),
    );
    expect(foreignHash).toMatchObject({ code: REFERENCE_INVALID, thrown: false });

    // A ref outside the requested Project Scope fails at the entry, before any
    // Decision read (the composition's exact-scope gate).
    const crossScope = await suite.attemptRead(
      await suite.preparedRead({
        snapshotRef,
        refOverride: {
          ...snapshotRef,
          scope: { enterpriseId: suite.fixture.enterpriseId, projectId: newUuidV7() },
        },
      }),
    );
    expect(crossScope).toMatchObject({ code: REFERENCE_INVALID, thrown: true });
  });

  suite.itIntegration('TE-214-D-015 authorizes the snapshot read separately', async () => {
    const buildEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-015-build' });
    const built = await suite.attemptBuild(buildEnvelope);
    expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (built.result === undefined) throw new Error('the 015 build did not commit');
    const targetId = record(buildEnvelope.targetRef).objectId as string;
    const snapshotRef = suite.contextSnapshotRefOf(built.result);
    const readDigest = digestCanonicalPayload({
      contextSnapshotRef: snapshotRef,
    } as unknown as CanonicalJsonObject).hash;

    // A build Decision never covers the read (COMMAND_MISMATCH).
    const mismatched = await suite.attemptRead(
      suite.readEnvelope({
        snapshotRef,
        decisionRef: await suite.issueBuildDecision({ targetId, payloadHash: readDigest }),
      }),
    );
    expect(mismatched).toMatchObject({ code: AUTHORIZATION_DECISION_INVALID, thrown: true });

    // A generic-purpose Decision carries no target binding: minted through the
    // generic authorization command, it fails the read revalidation as
    // TARGET_UNBOUND, surfaced as the stable invalid-Decision code.
    await suite.grantGeneric('wi216.cap.readgeneric');
    const genericDecision = await suite.authorizeCommandTracked(
      suite.identityDeps([suite.fixture.projectId]),
      {
        actorSnapshotRef: suite.operatorActorRef,
        intent: {
          commandType: READ_QUERY,
          commandVersion: READ_VERSION,
          scopeKind: 'PROJECT',
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
          purpose: 'execution.context.snapshot.read',
          requestedCapability: 'wi216.cap.readgeneric',
          commandPayloadHash: readDigest,
          requestedAt: new Date(),
          highRiskAction: false,
        },
        authenticationContextHash: AUTH_HASH,
        policySnapshotRef: suite.grantPolicySnapshotReference(),
        ttlSeconds: 900,
      },
    );
    expect(genericDecision.outcome).toBe('ALLOW');
    const genericRead = await suite.attemptRead(
      suite.readEnvelope({
        snapshotRef,
        decisionRef: genericDecision.authorizationDecisionRef,
      }),
    );
    expect(genericRead).toMatchObject({ code: AUTHORIZATION_DECISION_INVALID, thrown: true });

    // Selector separation at the owning Port itself: with the operator's
    // canonical Grant revoked, the canonical spelling has no covering Grant
    // while the legacy spelling stays covered by the second principal's own
    // Grant (granted in TE-214-D-014). The read Decision below was minted
    // while covered, so the revocation refuses the historical read Decision
    // and the re-grant lets it close again.
    const preRevokeRead = await suite.preparedRead({ snapshotRef });
    const readPort = createTaskExecutionContextSnapshotAuthorizationPort({
      capabilityCodes: contextSnapshotCapabilityCodes,
      now: (): Date => new Date(suite.clock),
    });
    const revoked = await suite.revokeCapabilityTracked(
      suite.identityDeps([suite.fixture.projectId]),
      {
        targetId: suite.grantCtxRead,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
        },
        reasonCode: 'WI216_REVOKE_READ',
        effectiveAt: new Date(suite.clock),
        idempotencyKey: `wi216:revoke:${suite.grantCtxRead}`,
      },
    );
    expect(revoked.status).toBe('COMMITTED');
    const portInput = (targetObjectType: string, principal: Principal = suite.operator()) => ({
      actorSnapshotRef: principal.actorRef,
      commandType: READ_QUERY,
      commandVersion: READ_VERSION,
      targetRef: objectRef(
        targetObjectType,
        targetId,
        suite.scope(),
      ) as unknown as Common.ObjectRef,
      commandPayloadHash: readDigest,
      authenticationContextHash: principal.authHash,
    });
    const denied = await readPort.authorizeContextSnapshot(
      suite.identityDeps([suite.fixture.projectId]),
      portInput(CONTEXT_SNAPSHOT_OBJECT),
    );
    expect(denied.outcome).toBe('DENY');
    expect(denied.reasons).toContain('NO_ACTIVE_GRANT');
    const legacyCovered = await readPort.authorizeContextSnapshot(
      suite.identityDeps([suite.fixture.projectId], suite.other()),
      portInput(CONTEXT_SNAPSHOT_LEGACY_OBJECT, suite.other()),
    );
    expect(legacyCovered.outcome).toBe('ALLOW');
    const revokedRead = await suite.attemptRead(preRevokeRead);
    expect(revokedRead).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    suite.grantCtxRead = await suite.grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotRead,
      action: ACTIONS.ctxRead,
      selectorType: 'TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    const reGranted = await suite.attemptRead(preRevokeRead);
    expect(reGranted, JSON.stringify(reGranted)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // An expired read Decision: minted under the real clock with the Port's
    // 300-second TTL; the entry's trusted instant sits past that window (the
    // TE-214-D-008 expired case above explains the layering).
    const expiredRead = await suite.attemptRead(
      await suite.preparedRead({ snapshotRef, now: new Date() }),
      suite.entryFor({ now: () => new Date(Date.now() + 600_000) }),
    );
    expect(expiredRead).toMatchObject({ code: AUTHORIZATION_EXPIRED, thrown: true });

    // A drifted trusted read capability code fails closed as revoked (a
    // well-formed NamespaceCode the covering Grant was never issued under).
    const driftedRead = await suite.attemptRead(
      await suite.preparedRead({ snapshotRef }),
      suite.entryFor({
        capabilityCodes: {
          ...contextSnapshotCapabilityCodes,
          contextSnapshotRead: 'wi216.cap.readdrifted',
        },
      }),
    );
    expect(driftedRead).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
  });

  suite.itIntegration('TE-214-D-016 keeps the published surface unchanged', async () => {
    const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
      operations: { type: string; version: string; kind: string; owner: string }[];
    };
    expect(catalog.operations).toHaveLength(239);
    expect(
      catalog.operations.filter((operation) => operation.owner === 'task-execution'),
    ).toHaveLength(63);
    expect(
      catalog.operations.filter(
        (operation) => operation.kind === 'EVENT' && operation.type.startsWith('execution.'),
      ),
    ).toHaveLength(12);

    // The two registered build versions keep their published metadata; the
    // @1.0 entry stays registered (and unbuildable, TE-214-D-001).
    for (const version of ['1.0', '1.1'] as const) {
      expect(suite.registry.getOperation(BUILD_COMMAND, version)).toMatchObject({
        targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
        concurrencyMode: 'CREATE',
        authorizationPurpose: 'execution.context.build.initial',
        dataClassification: 'INTERNAL',
      });
    }
    const buildV1 = suite.registry.getOperation(BUILD_COMMAND, '1.0') as {
      resultSchemaRef?: string;
    };
    const buildV11 = suite.registry.getOperation(BUILD_COMMAND, '1.1') as {
      resultSchemaRef?: string;
    };
    expect(
      buildV1.resultSchemaRef?.endsWith('execution_build_initial_context_snapshot_result'),
    ).toBe(true);
    expect(
      buildV11.resultSchemaRef?.endsWith('execution_build_initial_context_snapshot_v1_1_result'),
    ).toBe(true);
    // The read entry carries no authorizationPurpose in the Catalog: the
    // purpose lives only in the IdentityPolicy binding (Spec 001 §15.8).
    const readOperation = suite.registry.getOperation(
      READ_QUERY,
      READ_VERSION,
    ) as unknown as Record<string, unknown>;
    expect(Object.keys(readOperation).sort()).toEqual([
      'kind',
      'owner',
      'schemaStatus',
      'type',
      'version',
    ]);
    expect(readOperation).toMatchObject({ kind: 'QUERY', owner: 'task-execution' });
    // The build event is registered in both versions — @1.0 frozen (never
    // emitted by the corrected build, TE-217-D-003) and @1.1 the strict
    // correction; a @2.0 build is not registered.
    for (const eventVersion of ['1.0', '1.1']) {
      expect(
        catalog.operations.some(
          (operation) =>
            operation.type === 'execution.ContextSnapshotBuilt' &&
            operation.version === eventVersion,
        ),
      ).toBe(true);
    }
    const unregistered = suite.registry.validateOperation(BUILD_COMMAND, '2.0', {});
    expect(unregistered.valid).toBe(false);
    expect(unregistered.errors.some((error) => error.keyword === 'operationRegistry')).toBe(true);
    expect(suite.registry.getOperation(BUILD_COMMAND, '2.0')).toBeUndefined();

    // The historical 200-entry Baseline is untouched: the snapshot read (and
    // the legacy build spelling) were already published at v1.0; only the
    // initial build operation is new.
    const baseline = JSON.parse(readFileSync(COMPATIBILITY_BASELINE, 'utf8')) as
      { type: string }[] | { operations: { type: string }[] };
    const baselineOperations = Array.isArray(baseline) ? baseline : baseline.operations;
    expect(baselineOperations).toHaveLength(200);
    expect(
      baselineOperations.some((operation) => operation.type === 'execution.create_work_order'),
    ).toBe(true);
    expect(baselineOperations.some((operation) => operation.type === BUILD_COMMAND)).toBe(false);
    expect(baselineOperations.some((operation) => operation.type === READ_QUERY)).toBe(true);

    // One committed build emits exactly one registered Outbox event — the
    // strict @1.1 with the six-key stored payload; a rejected build and a
    // replay emit none.
    const outboxEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-016-outbox' });
    const built = await suite.attemptBuild(outboxEnvelope);
    expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (built.result === undefined) throw new Error('the 016 build did not commit');
    const outboxTarget = record(outboxEnvelope.targetRef).objectId as string;
    const snapshotRef = suite.contextSnapshotRefOf(built.result);
    const outbox = await suite.outboxRows(outboxTarget);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      event_type: 'execution.ContextSnapshotBuilt',
      event_version: '1.1',
      aggregate_version: '1',
    });
    expect(Object.keys(record(outbox[0]?.payload)).sort()).toEqual([
      'contextSnapshotRef',
      'coverageStatus',
      'enterpriseId',
      'projectId',
      'projectionType',
      'workOrderRef',
    ]);
    expect(outbox[0]?.payload).toMatchObject({
      projectionType: 'COORDINATOR',
      coverageStatus: 'COMPLETE_FOR_PURPOSE',
      enterpriseId: suite.fixture.enterpriseId,
      projectId: suite.fixture.projectId,
    });
    expect(record(outbox[0]?.payload).contextSnapshotRef).toEqual(snapshotRef);
    expect(record(outbox[0]?.payload).workOrderRef).toEqual(
      (await suite.draftPayloadOf(suite.goldenWorkOrderId)).workOrderRef,
    );

    const rejectedEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-016-rejected',
      sourceSlices: [{ ...suite.sliceARef, objectId: newUuidV7() }],
    });
    const rejectedBuild = await suite.attemptBuild(rejectedEnvelope);
    expect(rejectedBuild).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });
    expect(await suite.outboxRows(record(rejectedEnvelope.targetRef).objectId as string)).toEqual(
      [],
    );
    const replay = await suite.attemptBuild(outboxEnvelope);
    expect(replay).toMatchObject({ code: 'DUPLICATE', thrown: false });
    expect(await suite.outboxRows(outboxTarget)).toHaveLength(1);
  });

  suite.itIntegration('TE-214-D-017 executes the DRAFT inputRefs matrix', async () => {
    const inputRefEntry = (overrides: {
      inputRole?: string;
      ref?: unknown;
      required?: boolean;
      permittedUse?: string;
      contentAccessMode?: string;
      integrityRequired?: boolean;
      epistemicExpectation?: string;
    }): Record<string, unknown> => ({
      inputRole: overrides.inputRole ?? 'wi216.source',
      ref: overrides.ref ?? suite.sliceARef,
      required: overrides.required ?? false,
      permittedUse: overrides.permittedUse ?? PURPOSE_DOCUMENT,
      contentAccessMode: overrides.contentAccessMode ?? 'REFERENCE_ONLY',
      integrityRequired: overrides.integrityRequired ?? true,
      ...(overrides.epistemicExpectation === undefined
        ? {}
        : { epistemicExpectation: overrides.epistemicExpectation }),
    });
    const externalRef = (externalId: string): Record<string, unknown> => ({
      system: 'wi216.external',
      resourceType: 'document',
      externalId,
      observedAt: new Date(suite.clock).toISOString(),
    });

    /** One WorkOrder carrying `inputRefs`, then its initial build. */
    const buildWithInputRefs = async (
      tag: string,
      inputRefs: Record<string, unknown>[],
      sourceSlices: unknown[] = [suite.sliceARef],
    ): Promise<{
      envelope: Record<string, unknown>;
      attempt: { code: string; thrown: boolean; result?: CommandResult };
    }> => {
      const workOrderId = await suite.createWorkOrder({
        taskId: await suite.createExecutableTask('2.0'),
        taskMajor: '2.0',
        inputRefs,
      });
      const envelope = await suite.preparedBuild({
        idempotencyKey: `wi216-017-${tag}`,
        workOrderId,
        sourceSlices,
      });
      return { envelope, attempt: await suite.attemptBuild(envelope) };
    };
    const buildRowOf = async (
      attempt: { result?: CommandResult },
      envelope: Record<string, unknown>,
    ) => {
      if (attempt.result === undefined) throw new Error('the build did not commit');
      const snapshotId = suite.contextSnapshotRefOf(attempt.result).snapshotId;
      const buildRow = await suite.contextSnapshotBuildRow(snapshotId);
      if (buildRow === undefined) throw new Error('the build metadata row is missing');
      const row = await suite.contextSnapshotRow(record(envelope.targetRef).objectId as string);
      if (row === undefined) throw new Error('the snapshot row is missing');
      return { buildRow, row };
    };
    const observationsOf = (buildRow: { canonical_payload: Record<string, unknown> }) =>
      buildRow.canonical_payload.inputRefObservations as Record<string, unknown>[];
    const draftInputOmissionsOf = (row: { canonical_payload: Record<string, unknown> }) =>
      (row.canonical_payload.omissions as Record<string, unknown>[]).filter(
        (omission) => omission.category === 'DRAFT_INPUT_REF',
      );

    // ① Adoption: the slice ref named by the DRAFT and consumed by the build.
    const adopted = await buildWithInputRefs('adopted', [inputRefEntry({})]);
    expect(adopted.attempt, JSON.stringify(adopted.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const adoptedRows = await buildRowOf(adopted.attempt, adopted.envelope);
    expect(observationsOf(adoptedRows.buildRow)).toHaveLength(1);
    expect(observationsOf(adoptedRows.buildRow)[0]).toMatchObject({
      inputRole: 'wi216.source',
      required: false,
      permittedUse: PURPOSE_DOCUMENT,
      contentAccessMode: 'REFERENCE_ONLY',
      integrityRequired: true,
      resolution: 'ADOPTED',
    });
    expect(observationsOf(adoptedRows.buildRow)[0]?.ref).toEqual(suite.sliceARef);
    expect(draftInputOmissionsOf(adoptedRows.row)).toEqual([]);

    // ① variants closing against the request purpose / access mode / state.
    for (const [tag, overrides] of [
      ['use-review', { permittedUse: PURPOSE_REVIEW }],
      ['mode-inline', { contentAccessMode: 'INLINE_FRAGMENT' }],
      ['expectation-disputed', { epistemicExpectation: 'DISPUTED' }],
    ] as const) {
      const variant = await buildWithInputRefs(tag, [inputRefEntry(overrides)]);
      expect(variant.attempt, tag).toMatchObject({
        code: EXECUTION_CONTEXT_SOURCE_INVALID,
        thrown: false,
      });
      await suite.expectNoContextSnapshot(
        record(variant.envelope.targetRef).objectId as string,
        `wi216-017-${tag}`,
      );
    }
    const confirmed = await buildWithInputRefs('expectation-confirmed', [
      inputRefEntry({ epistemicExpectation: 'CONFIRMED' }),
    ]);
    expect(confirmed.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });

    // ② A required inputRef nothing captured rejects INPUT_REQUIRED, whether
    // the ref is slice-typed or another kind.
    const unknownSliceRef = {
      ...suite.sliceARef,
      objectId: newUuidV7(),
      contentHash: contentHash(createHash('sha256').update('wi216-017-unknown').digest('hex')),
    };
    const requiredMissing = await buildWithInputRefs('required-missing', [
      inputRefEntry({ ref: unknownSliceRef, required: true }),
    ]);
    expect(requiredMissing.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_INPUT_REQUIRED,
      thrown: false,
    });
    await suite.expectNoContextSnapshot(
      record(requiredMissing.envelope.targetRef).objectId as string,
      'wi216-017-required-missing',
    );
    const requiredOtherKind = await buildWithInputRefs('required-other-kind', [
      inputRefEntry({ ref: policyKey(BUILDER_POLICY.main, suite.fixture), required: true }),
    ]);
    expect(requiredOtherKind.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_INPUT_REQUIRED,
      thrown: false,
    });

    // ③ An optional unmatched inputRef is an Omission: NOT_CAPTURED for a
    // slice-typed ref, KIND_NOT_SUPPORTED for any other kind.
    const notCaptured = await buildWithInputRefs('not-captured', [
      inputRefEntry({ ref: suite.sliceBRef }),
    ]);
    expect(notCaptured.attempt, JSON.stringify(notCaptured.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const notCapturedRows = await buildRowOf(notCaptured.attempt, notCaptured.envelope);
    expect(observationsOf(notCapturedRows.buildRow)).toHaveLength(1);
    expect(observationsOf(notCapturedRows.buildRow)[0]).toMatchObject({
      inputRole: 'wi216.source',
      resolution: 'OMITTED',
    });
    expect(draftInputOmissionsOf(notCapturedRows.row)).toHaveLength(1);
    expect(draftInputOmissionsOf(notCapturedRows.row)[0]).toMatchObject({
      category: 'DRAFT_INPUT_REF',
      reasonCode: 'NOT_CAPTURED_IN_SOURCE_SLICES',
    });
    const otherKind = await buildWithInputRefs('other-kind', [
      inputRefEntry({ ref: policyKey(BUILDER_POLICY.main, suite.fixture) }),
    ]);
    expect(otherKind.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });
    const otherKindRows = await buildRowOf(otherKind.attempt, otherKind.envelope);
    expect(draftInputOmissionsOf(otherKindRows.row)).toHaveLength(1);
    expect(draftInputOmissionsOf(otherKindRows.row)[0]).toMatchObject({
      category: 'DRAFT_INPUT_REF',
      reasonCode: 'KIND_NOT_SUPPORTED_IN_INITIAL_BUILD',
    });

    // ④ No inputRefs: no observations, no DRAFT_INPUT_REF omissions.
    const empty = await buildWithInputRefs('empty', []);
    expect(empty.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });
    const emptyRows = await buildRowOf(empty.attempt, empty.envelope);
    expect(observationsOf(emptyRows.buildRow)).toEqual([]);
    expect(draftInputOmissionsOf(emptyRows.row)).toEqual([]);

    // ⑤ The observation order is the §19.4 item 9 canonical sort, not the
    // DRAFT's member order.
    const sortedCase = await buildWithInputRefs('sorted', [
      inputRefEntry({ inputRole: 'wi216.zeta', ref: suite.sliceBRef }),
      inputRefEntry({
        inputRole: 'wi216.alpha',
        ref: externalRef('doc-1'),
        integrityRequired: false,
      }),
    ]);
    expect(sortedCase.attempt).toMatchObject({ code: 'COMMITTED', thrown: false });
    const sortedRows = await buildRowOf(sortedCase.attempt, sortedCase.envelope);
    expect(observationsOf(sortedRows.buildRow)).toHaveLength(2);
    expect(observationsOf(sortedRows.buildRow)[0]?.inputRole).toBe('wi216.alpha');
    // The fully-identical duplicate pair is closed by the registered WorkOrder
    // creation Schema (uniqueItems); the owning assembly collapses it (unit
    // layer, header note).
    const duplicateEntry = inputRefEntry({ inputRole: 'wi216.dup' });
    await expect(
      suite.createWorkOrder({
        taskId: await suite.createExecutableTask('2.0'),
        taskMajor: '2.0',
        inputRefs: [duplicateEntry, duplicateEntry],
      }),
    ).rejects.toMatchObject({ code: API_VALUE_INVALID });
    const collapsed = assembleInitialContext(
      await suite.unitAssemblyInput({
        draftMutate: (draft) => {
          draft.inputRefs = [duplicateEntry, duplicateEntry];
        },
      }),
    );
    if (collapsed.outcome !== 'ASSEMBLED') {
      throw new Error(`identical inputRefs did not collapse: ${collapsed.errorCode}`);
    }
    expect(collapsed.metadata.inputRefObservations as unknown[]).toHaveLength(1);

    // ⑥ Same (inputRole, ref) but different metadata: never one input.
    const inconsistent = await buildWithInputRefs('inconsistent', [
      inputRefEntry({ inputRole: 'wi216.same', integrityRequired: true }),
      inputRefEntry({ inputRole: 'wi216.same', integrityRequired: false }),
    ]);
    expect(inconsistent.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });
    await suite.expectNoContextSnapshot(
      record(inconsistent.envelope.targetRef).objectId as string,
      'wi216-017-inconsistent',
    );

    // ⑦ A fact-free slice cannot prove an epistemic expectation.
    const factFree = await buildWithInputRefs(
      'fact-free',
      [inputRefEntry({ ref: suite.sliceBRef })],
      [suite.sliceBRef],
    );
    expect(factFree.attempt, JSON.stringify(factFree.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const factFreeRows = await buildRowOf(factFree.attempt, factFree.envelope);
    expect(observationsOf(factFreeRows.buildRow)[0]).toMatchObject({ resolution: 'ADOPTED' });
    const factFreeExpectation = await buildWithInputRefs(
      'fact-free-expectation',
      [inputRefEntry({ ref: suite.sliceBRef, epistemicExpectation: 'CONFIRMED' })],
      [suite.sliceBRef],
    );
    expect(factFreeExpectation.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });

    // ⑧ The least-trusted fact state of the slice is what the expectation
    // closes against (sliceMix carries one DISPUTED Fact).
    const disputed = await buildWithInputRefs(
      'disputed',
      [inputRefEntry({ ref: suite.sliceMixRef, epistemicExpectation: 'DISPUTED' })],
      [suite.sliceMixRef],
    );
    expect(disputed.attempt, JSON.stringify(disputed.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const disputedMismatch = await buildWithInputRefs(
      'disputed-mismatch',
      [inputRefEntry({ ref: suite.sliceMixRef, epistemicExpectation: 'CONFIRMED' })],
      [suite.sliceMixRef],
    );
    expect(disputedMismatch.attempt).toMatchObject({
      code: EXECUTION_CONTEXT_SOURCE_INVALID,
      thrown: false,
    });

    // ⑨ External refs are never adopted by the initial build: one Omission
    // per entry, all KIND_NOT_SUPPORTED.
    const externals = await buildWithInputRefs('externals', [
      inputRefEntry({
        inputRole: 'wi216.ext.a',
        ref: externalRef('doc-1'),
        integrityRequired: false,
      }),
      inputRefEntry({
        inputRole: 'wi216.ext.b',
        ref: externalRef('doc-2'),
        integrityRequired: false,
      }),
    ]);
    expect(externals.attempt, JSON.stringify(externals.attempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const externalRows = await buildRowOf(externals.attempt, externals.envelope);
    expect(observationsOf(externalRows.buildRow)).toHaveLength(2);
    expect(
      observationsOf(externalRows.buildRow).every(
        (observation) => observation.resolution === 'OMITTED',
      ),
    ).toBe(true);
    expect(draftInputOmissionsOf(externalRows.row)).toHaveLength(2);
    for (const omission of draftInputOmissionsOf(externalRows.row)) {
      expect(omission).toMatchObject({
        category: 'DRAFT_INPUT_REF',
        reasonCode: 'KIND_NOT_SUPPORTED_IN_INITIAL_BUILD',
      });
    }
  });

  suite.itIntegration('TE-214-D-018 closes targetScope.targetObjectRefs to ∅', async () => {
    // The golden default build carries the empty support set.
    const goldenEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-018-empty' });
    const golden = await suite.attemptBuild(goldenEnvelope);
    expect(golden, JSON.stringify(golden)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const goldenRow = await suite.contextSnapshotRow(
      record(goldenEnvelope.targetRef).objectId as string,
    );
    expect(record(goldenRow?.canonical_payload.workContext).deliveryItemRefs).toEqual([]);

    // The assembly checks the member's length only (§19.4 item 9): one ref,
    // two refs, a non-delivery-item spelling and a foreign scope all land on
    // the same closed rejection.
    const targetRefCase = async (
      tag: string,
      targetObjectRefs: Record<string, unknown>[],
    ): Promise<void> => {
      const workOrderId = await suite.createWorkOrder({
        taskId: await suite.createExecutableTask('2.0'),
        taskMajor: '2.0',
        targetObjectRefs,
      });
      const envelope = await suite.preparedBuild({
        idempotencyKey: `wi216-018-${tag}`,
        workOrderId,
      });
      const attempt = await suite.attemptBuild(envelope);
      expect(attempt, tag).toMatchObject({
        code: EXECUTION_CONTEXT_TARGET_INVALID,
        thrown: false,
      });
      await suite.expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-018-${tag}`,
      );
    };
    const deliveryItemRef = (id: string, refScope: Record<string, string> = suite.scope()) =>
      objectRef('zhiju.project.delivery_item', id, refScope);
    await targetRefCase('one', [deliveryItemRef(newUuidV7())]);
    await targetRefCase('two', [deliveryItemRef(newUuidV7()), deliveryItemRef(newUuidV7())]);
    await targetRefCase('other-type', [objectRef(TASK_V2, newUuidV7(), suite.scope())]);
    // A foreign-Scope ref never reaches the build through legal facts: the
    // owning WorkOrder creation's own scope closure rejects the draft one
    // layer earlier (the same convention as the schema-closed branches of
    // TE-214-D-017; header note). The assembly's branch is asserted at the
    // unit layer below.
    const crossScope = await suite.createWorkOrderResult({
      taskId: await suite.createExecutableTask('2.0'),
      taskMajor: '2.0',
      targetObjectRefs: [
        deliveryItemRef(newUuidV7(), {
          enterpriseId: suite.fixture.enterpriseId,
          projectId: newUuidV7(),
        }),
      ],
    });
    expect(crossScope.result).toMatchObject({
      status: 'REJECTED',
      errorCode: EXECUTION_WORK_ORDER_SCOPE_INVALID,
    });
    const unitForeign = assembleInitialContext(
      await suite.unitAssemblyInput({
        draftMutate: (draft) => {
          record(draft.targetScope).targetObjectRefs = [
            deliveryItemRef(newUuidV7(), {
              enterpriseId: suite.fixture.enterpriseId,
              projectId: newUuidV7(),
            }),
          ];
        },
      }),
    );
    expect(unitForeign).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_TARGET_INVALID,
    });
  });
}
