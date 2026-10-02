import type { InitialContextEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import { createEnterpriseProjectDatabase } from '@zhiju/enterprise-project';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  createIdentityPolicyDatabase,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
} from '@zhiju/identity-policy';
import { canonicalize, type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  AGGREGATE_STATE_NOT_ALLOWED,
  API_VALUE_INVALID,
  assembleInitialContext,
  createTaskExecutionDatabase,
  DEPENDENCY_UNAVAILABLE,
  digestCanonicalPayload,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
  POLICY_EXPIRED,
  POLICY_NOT_EFFECTIVE,
  REFERENCE_INVALID,
} from '@zhiju/task-execution';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { expect } from 'vitest';
import {
  BUILD_COMMAND,
  BUILDER_POLICY,
  type BuildInput,
  contentHash,
  CONTEXT_SNAPSHOT_OBJECT,
  dependencyCapabilities,
  OPERATOR,
  OTHER_PRINCIPAL,
  POLICY_OBJECT,
  policyKey,
  PURPOSE_DOCUMENT,
  PURPOSE_FORM,
  record,
  WORK_ORDER_V11,
} from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerContextBuild(suite: InitialContextSuite): void {
  suite.itIntegration('TE-214-D-001 pairs the build version with the DRAFT major', async () => {
    // @1.1 build × @1.1 DRAFT of a v2 Task: the one initial build pair.
    const taskV2 = await suite.createExecutableTask('2.0');
    const workOrderV2 = await suite.createWorkOrder({ taskId: taskV2, taskMajor: '2.0' });
    const committedV2 = await suite.attemptBuild(
      await suite.preparedBuild({ idempotencyKey: 'wi216-001-v2', workOrderId: workOrderV2 }),
    );
    expect(committedV2, JSON.stringify(committedV2)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // @1.1 build × @1.1 DRAFT of a v1 Task: the Task major stays free (§19.1).
    const taskV1 = await suite.createExecutableTask('1.0');
    const workOrderV1 = await suite.createWorkOrder({ taskId: taskV1, taskMajor: '1.0' });
    const committedV1 = await suite.attemptBuild(
      await suite.preparedBuild({ idempotencyKey: 'wi216-001-v1', workOrderId: workOrderV1 }),
    );
    expect(committedV1, JSON.stringify(committedV1)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // The registered @1.0 build has no approved authorization binding: it is
    // refused before any Decision read, Registry payload validation or Receipt
    // claim, against either DRAFT major. The presented Decision stays the
    // minted @1.1 one on purpose — it must never be read.
    const legacyDraftWorkOrder = await suite.createWorkOrder({
      taskId: taskV1,
      taskMajor: '1.0',
      commandVersion: '1.0',
    });
    for (const [tag, workOrderId] of [
      ['draft-1-0', legacyDraftWorkOrder],
      ['draft-1-1', workOrderV1],
    ] as const) {
      const envelope = await suite.preparedBuild({
        idempotencyKey: `wi216-001-${tag}`,
        workOrderId,
      });
      envelope.commandVersion = '1.0';
      const attempt = await suite.attemptBuild(envelope);
      expect(attempt).toMatchObject({ code: API_CONTRACT_TYPE_UNKNOWN, thrown: true });
      await suite.expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-001-${tag}`,
        'ABSENT',
      );
    }

    // @1.1 build × @1.0 DRAFT: the other creation major's pin set is never an
    // alias of the @1.1 shape (owning handler).
    const mismatchEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-001-mismatch',
      workOrderId: legacyDraftWorkOrder,
    });
    const mismatch = await suite.attemptBuild(mismatchEnvelope);
    expect(mismatch).toMatchObject({
      code: EXECUTION_DRAFT_SCHEMA_VERSION_MISMATCH,
      thrown: false,
    });
    await suite.expectNoContextSnapshot(
      record(mismatchEnvelope.targetRef).objectId as string,
      'wi216-001-mismatch',
    );
  });

  suite.itIntegration('TE-214-D-002 closes the exact draft snapshot reference', async () => {
    const task = await suite.createExecutableTask('2.0');
    const workOrderId = await suite.createWorkOrder({ taskId: task, taskMajor: '2.0' });
    const draftRef = await suite.draftSnapshotRefOf(workOrderId);
    const rejectCase = async (
      tag: string,
      draftSnapshotRef: unknown,
      code: string,
      thrown: boolean,
      receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
    ): Promise<void> => {
      const envelope = await suite.preparedBuild({
        idempotencyKey: `wi216-002-${tag}`,
        draftRef: draftSnapshotRef,
      });
      const attempt = await suite.attemptBuild(envelope);
      expect(attempt, tag).toMatchObject({ code, thrown });
      await suite.expectNoContextSnapshot(
        record(envelope.targetRef).objectId as string,
        `wi216-002-${tag}`,
        receipt,
      );
    };

    // A wrong object id and a wrong content hash both miss the by-identity
    // read; a foreign Scope is refused one layer earlier, by the §15.9 DRAFT
    // dependency-read Port's Scope check, before any DRAFT fact is read or
    // locked — thrown, with the Receipt ABSENT (header note).
    await rejectCase('wrong-id', { ...draftRef, objectId: newUuidV7() }, REFERENCE_INVALID, false);
    await rejectCase(
      'wrong-hash',
      { ...draftRef, contentHash: contentHash('0'.repeat(64)) },
      REFERENCE_INVALID,
      false,
    );
    await rejectCase(
      'wrong-scope',
      { ...draftRef, scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() } },
      IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
      true,
      'ABSENT',
    );
    // The legacy spelling is pinned out by the registered Envelope Schema.
    await rejectCase(
      'legacy-spelling',
      { ...draftRef, objectType: 'execution.work_order_draft_snapshot' },
      API_VALUE_INVALID,
      true,
      'ABSENT',
    );

    // "指针已前进" is unreachable by legal facts: V3003 closes a pointer move in
    // both directions (no version advance; a target that does not resolve to a
    // snapshot of this WorkOrder), and the snapshot creation guard requires the
    // pointer to already name the inserted row — the two guards close each
    // other, so the pointer can never leave the creation snapshot.
    const noAdvance = await suite.appStatement(
      'UPDATE task_execution.work_order SET current_draft_snapshot_id = $2 WHERE work_order_id = $1',
      [workOrderId, newUuidV7()],
    );
    expect(noAdvance?.code).toBe('23514');
    expect(noAdvance?.message).toContain('must advance the aggregate version');
    const toUnknown = await suite.appStatement(
      `UPDATE task_execution.work_order
          SET current_draft_snapshot_id = $2, aggregate_version = aggregate_version + 1
        WHERE work_order_id = $1`,
      [workOrderId, newUuidV7()],
    );
    expect(toUnknown?.code).toBe('23514');
    expect(toUnknown?.message).toContain('must reference a snapshot of this work order');

    // V3005 rejects the old SQL shortcut that fabricated READY without a
    // Contract. The non-DRAFT build rejection now follows a real owning
    // Freeze in TE-VAL-S-008 below.
    await expect(
      suite.track(
        suite.admin.query(
          'UPDATE task_execution.work_order SET status = $2 WHERE work_order_id = $1',
          [workOrderId, 'READY'],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514', constraint: 'work_order_frozen_pointer_state' });

    // "Expired DRAFT": the binding-layer rejection fires one step before the
    // unreachable commit-point WorkOrder re-check (header note), and the
    // `expires_at` column itself is immutable.
    const expiringWorkOrder = await suite.createWorkOrder({
      taskId: task,
      taskMajor: '2.0',
      expiresAt: new Date(suite.clock + 1_000).toISOString(),
    });
    const moved = new Date(suite.clock + 2_000);
    const expiredEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-002-expired',
      workOrderId: expiringWorkOrder,
      decisionNow: moved,
    });
    const expired = await suite.attemptBuild(expiredEnvelope, suite.entryFor({ now: () => moved }));
    expect(expired).toMatchObject({ code: AGGREGATE_STATE_NOT_ALLOWED, thrown: false });
    expect(expired.result?.status === 'REJECTED' ? expired.result.safeSummary : '').toContain(
      'the initial Context expiry binding does not close',
    );
    await suite.expectNoContextSnapshot(
      record(expiredEnvelope.targetRef).objectId as string,
      'wi216-002-expired',
    );
    const expiryRewrite = await suite.appStatement(
      'UPDATE task_execution.work_order SET expires_at = $2 WHERE work_order_id = $1',
      [expiringWorkOrder, new Date(suite.clock + 7_200_000)],
    );
    expect(expiryRewrite?.code).toBe('23514');
  });

  suite.itIntegration('TE-214-D-003 assembles the deterministic golden payload', async () => {
    const commandId = newUuidV7();
    const key = 'wi216-003-golden';
    // Deliberately unsorted: §19.4 item 1 owns the deterministic slice order.
    const envelope = await suite.preparedBuild({
      idempotencyKey: key,
      commandId,
      sourceSlices: [suite.sliceBRef, suite.sliceARef],
    });
    const targetId = record(envelope.targetRef).objectId as string;
    const attempt = await suite.attemptBuild(envelope);
    expect(attempt, JSON.stringify(attempt)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (attempt.result === undefined) throw new Error('golden build did not commit');
    const snapshotRef = suite.contextSnapshotRefOf(attempt.result);
    const snapshotId = snapshotRef.snapshotId;
    const row = await suite.contextSnapshotRow(targetId);
    if (row === undefined) throw new Error('golden Context Snapshot row missing');
    const payload = row.canonical_payload;
    const header = record(payload.header);
    const projection = record(payload.projection);
    const coverage = record(payload.coverage);
    const manifest = record(payload.sourceManifest);

    // The promoted mirrors, field by field (V3004 re-derives every one).
    expect(row.snapshot_id).toBe(snapshotId);
    expect(row.builder_version).toBe('1.1');
    expect(row.purpose).toBe(PURPOSE_DOCUMENT);
    expect(row.audience).toBe(OPERATOR);
    expect(row.enterprise_id).toBe(suite.fixture.enterpriseId);
    expect(row.project_id).toBe(suite.fixture.projectId);
    expect(row.policy_snapshot_id).toBe(BUILDER_POLICY.main[1]);
    expect(row.canonicalization_version).toBe('1');
    expect(row.payload_hash_algorithm).toBe('SHA-256');
    expect(row.source_command_id).toBe(commandId);
    expect(row.created_by_principal_id).toBe(OPERATOR);
    expect(
      row.payload_hash.equals(digestCanonicalPayload(payload as CanonicalJsonObject).hash),
    ).toBe(true);
    expect(
      row.request_payload_hash.equals(
        digestCanonicalPayload(envelope.payload as CanonicalJsonObject).hash,
      ),
    ).toBe(true);
    expect(snapshotRef.contentHash.digest).toBe(row.payload_hash.toString('hex'));
    const manifestCount =
      [
        'enterpriseProfileSnapshotRef',
        'qmsConfigurationRef',
        'customerBaselineRef',
        'templateBaselineRef',
        'regulatoryProfileRef',
        'gapAnalysisRef',
        'deliveryPlanRef',
      ].filter((member) => manifest[member] !== undefined).length +
      (manifest.policyRefs as unknown[]).length +
      (manifest.schemaRefs as unknown[]).length +
      (manifest.externalAuthoritySnapshotRefs as unknown[]).length;
    expect(row.source_manifest_count).toBe(manifestCount);
    // Two confirmed Facts from slice A; one ACTIVE_BASELINES omission per
    // slice; the redaction mirror is derived from the committed Slices below.
    expect(row.context_item_count).toBe(2);
    expect(row.context_item_count).toBe((payload.contextItems as unknown[]).length);
    expect(row.omission_count).toBe(2);
    expect(row.omission_count).toBe((payload.omissions as unknown[]).length);
    expect(row.redaction_count).toBe((payload.redactions as unknown[]).length);
    expect(row.coverage_state).toBe('COMPLETE_FOR_PURPOSE');

    // The golden payload itself.
    expect(header.contractId).toBe(snapshotId);
    expect(header.contractType).toBe('zhiju.contract.project_context');
    expect(header.contractVersion).toBe('1.0');
    expect(header.dataClassification).toBe('INTERNAL');
    expect(header.payloadHash).toEqual({
      algorithm: 'SHA-256',
      digest: '0'.repeat(64),
      canonicalizationVersion: '1',
    });
    expect(payload.contextSnapshotId).toBe(snapshotId);
    expect(record(payload.enterpriseRef).objectId).toBe(suite.fixture.enterpriseId);
    expect(record(payload.projectRef).objectId).toBe(suite.fixture.projectId);
    expect(projection).toMatchObject({
      projectionType: 'COORDINATOR',
      purpose: PURPOSE_DOCUMENT,
      audience: OPERATOR,
    });
    expect(record(projection.builderPolicyRef).versionId).toBe(BUILDER_POLICY.main[1]);
    expect(coverage).toEqual({
      requestedScopes: [PURPOSE_DOCUMENT],
      includedScopes: [PURPOSE_DOCUMENT],
      excludedScopes: ['ACTIVE_BASELINES'],
      completeness: 'COMPLETE_FOR_PURPOSE',
    });
    // The effective expiry is the earliest slice validity bound (the DRAFT
    // creation expiry sits 24h out, the Policy has no successor).
    const sliceA = await suite.slicePayloadOf(suite.sliceARef.objectId);
    const sliceB = await suite.slicePayloadOf(suite.sliceBRef.objectId);
    // Every redaction the two Slices carry is promoted verbatim (#188): B has
    // the 2 unconditional ones, A adds 2 per confirmed Fact (verified: 2+6=8).
    const sliceRedactions = (slice: Record<string, unknown>): unknown[] =>
      (record(slice.source).redactions ?? []) as unknown[];
    expect(row.redaction_count).toBe(
      sliceRedactions(sliceA).length + sliceRedactions(sliceB).length,
    );
    const expectedExpiry = [sliceA.validUntil, sliceB.validUntil].sort()[0] as string;
    expect(payload.expiresAt).toBe(expectedExpiry);
    expect(row.expires_at?.toISOString()).toBe(expectedExpiry);
    expect(row.effective_expires_at?.toISOString()).toBe(expectedExpiry);

    // The INITIAL build metadata row.
    const buildRow = await suite.contextSnapshotBuildRow(snapshotId);
    if (buildRow === undefined) throw new Error('golden build metadata row missing');
    const metadata = buildRow.canonical_payload;
    const mainPolicy = await suite.policyVersionRow(BUILDER_POLICY.main);
    expect(buildRow.build_kind).toBe('INITIAL');
    expect(buildRow.frozen_contract_ref).toBeNull();
    expect(buildRow.draft_snapshot_ref).toEqual(suite.goldenDraftRef);
    expect(buildRow.slice_refs).toEqual(metadata.sliceRefs);
    const sliceRefs = buildRow.slice_refs;
    expect(sliceRefs).toHaveLength(2);
    // §20.4: the stored order is the seven-member total order (object identity
    // before any hash member), superseding the §19.4 item 1 tuple.
    expect(
      suite.compareOrderTuples(
        suite.sliceOrderTuple(sliceRefs[0] as unknown as Common.ContentAddressedRef),
        suite.sliceOrderTuple(sliceRefs[1] as unknown as Common.ContentAddressedRef),
      ),
    ).toBeLessThan(0);
    expect(new Set(sliceRefs.map((ref) => ref.objectId))).toEqual(
      new Set([suite.sliceARef.objectId, suite.sliceBRef.objectId]),
    );
    expect(buildRow.purpose).toBe(PURPOSE_DOCUMENT);
    expect(buildRow.audience).toEqual({ principalId: OPERATOR, principalKind: 'HUMAN' });
    expect(buildRow.builder_policy_ref).toEqual(policyKey(BUILDER_POLICY.main, suite.fixture));
    expect(buildRow.policy_content_hash.equals(mainPolicy.payload_hash)).toBe(true);
    expect(buildRow.policy_effective_from.toISOString()).toBe(
      mainPolicy.effective_from.toISOString(),
    );
    expect(buildRow.policy_superseded_at).toBeNull();
    expect(buildRow.request_expires_at).toBeNull();
    expect(buildRow.effective_expires_at?.toISOString()).toBe(expectedExpiry);
    expect(buildRow.source_command_id).toBe(commandId);
    expect(
      buildRow.payload_hash.equals(digestCanonicalPayload(metadata as CanonicalJsonObject).hash),
    ).toBe(true);
    expect(buildRow.request_payload_hash.equals(row.request_payload_hash)).toBe(true);
    // The manifest carries the deduplicated Capture Policy, the Builder Policy,
    // the builder profile Schema and the WorkOrder Schema.
    expect(manifest.policyRefs).toHaveLength(2);
    expect(manifest.schemaRefs).toHaveLength(2);
    expect(manifest.externalAuthoritySnapshotRefs).toEqual([]);

    // Receipt COMMITTED with the exact identity; the audit trail records the
    // one COMMITTED command and no rejection.
    const receipts = await suite.receiptRows(key);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      command_id: commandId,
      command_type: BUILD_COMMAND,
      command_version: '1.1',
      outcome: 'COMMITTED',
      target_type: CONTEXT_SNAPSHOT_OBJECT,
      target_id: targetId,
    });
    expect(await suite.auditRows(commandId)).toEqual([
      { outcome: 'COMMITTED', error_code: null, safe_summary: null },
    ]);

    // Exactly the proved references become Edges: DRAFT, Policy, sorted Slices.
    const edges = await suite.edgeRows(targetId);
    expect(
      edges.map((edge) => ({
        path: edge.reference_path,
        module: edge.target_module,
        type: edge.target_object_type,
      })),
    ).toEqual([
      {
        path: '/draftSnapshotRef',
        module: 'TaskExecution',
        type: 'zhiju.execution.work_order_draft_snapshot',
      },
      {
        path: '/projection/builderPolicyRef',
        module: 'IdentityPolicy',
        type: 'zhiju.identity.policy',
      },
      {
        path: '/sourceSlices/0',
        module: 'EnterpriseProject',
        type: 'zhiju.project.context_source_slice',
      },
      {
        path: '/sourceSlices/1',
        module: 'EnterpriseProject',
        type: 'zhiju.project.context_source_slice',
      },
    ]);
    for (const edge of edges) expect(edge.owner_version_id).toBe(snapshotId);
    expect(edges[2]?.target_object_id).toBe(record(sliceRefs[0]).objectId);
    expect(edges[3]?.target_object_id).toBe(record(sliceRefs[1]).objectId);

    // The single registered Outbox row (§19.7/§20.3): the event is now
    // `ContextSnapshotBuilt@1.1`, and the stored payload is exactly the closed
    // four public members plus the runner's two Scope mirrors.
    const outbox = await suite.outboxRows(targetId);
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

    // The source watermarks are the deduplicated union in sorted slice order.
    const payloadBySliceId = new Map([
      [suite.sliceARef.objectId, sliceA],
      [suite.sliceBRef.objectId, sliceB],
    ]);
    const expectedWatermarks: unknown[] = [];
    const seenWatermarks = new Set<string>();
    for (const ref of sliceRefs) {
      const storedSlice = payloadBySliceId.get(record(ref).objectId as string);
      const watermark = record(record(storedSlice).source).sourceWatermark;
      const canonical = canonicalize(watermark as Parameters<typeof canonicalize>[0]);
      if (seenWatermarks.has(canonical)) continue;
      seenWatermarks.add(canonical);
      expectedWatermarks.push(watermark);
    }
    expect(payload.sourceWatermarks).toEqual(expectedWatermarks);

    // The owning assembly re-run on the committed facts reproduces payload and
    // metadata byte-for-byte (unit layer of the golden row).
    const unitInput = await suite.unitAssemblyInput({ asOf: payload.asOf as string });
    const rerun = assembleInitialContext({
      ...unitInput,
      snapshotId,
      correlationId: header.correlationId as string,
    });
    if (rerun.outcome !== 'ASSEMBLED') {
      throw new Error(`golden re-run rejected: ${rerun.errorCode} ${rerun.safeSummary}`);
    }
    expect(rerun.payload).toEqual(payload);
    expect(rerun.metadata).toEqual(metadata);

    // ① The deterministic contextItemId recomputes from the stored slice
    // payload alone and its first 48 bits are the trusted assembly instant.
    const items = payload.contextItems as Record<string, unknown>[];
    const factItems = record(sliceA.source).factItems as unknown[];
    const asOfMilliseconds = new Date(payload.asOf as string).getTime();
    for (const item of items) {
      const subjectRef = record(item.subjectRef);
      const inSliceIndex = factItems.findIndex(
        (fact) => record(record(fact).factRef).objectId === subjectRef.objectId,
      );
      expect(inSliceIndex).toBeGreaterThanOrEqual(0);
      expect(item.contextItemId).toBe(
        suite.recomputeContextItemId(
          asOfMilliseconds,
          factItems[inSliceIndex],
          suite.sliceARef.objectId,
          inSliceIndex,
        ),
      );
      const hex = (item.contextItemId as string).replaceAll('-', '');
      expect(BigInt(`0x${hex.slice(0, 12)}`)).toBe(BigInt(asOfMilliseconds));
    }
    // ② Two Facts stay two distinguishable items.
    expect(new Set(items.map((item) => record(item.subjectRef).objectId))).toEqual(
      new Set([suite.factA1.objectId, suite.factA2.objectId]),
    );
    expect(new Set(items.map((item) => item.contextItemId)).size).toBe(2);
    const itemByFact = new Map(
      items.map((item) => [record(item.subjectRef).objectId as string, item]),
    );
    // The fixed status→epistemicState and riskLevel→sensitivity maps.
    expect(itemByFact.get(suite.factA1.objectId)).toMatchObject({
      kind: 'FACT',
      epistemicState: 'CONFIRMED',
      sensitivity: 'INTERNAL',
      permittedUses: [PURPOSE_DOCUMENT],
      recordedTime: sliceA.capturedAt,
    });
    expect(itemByFact.get(suite.factA2.objectId)).toMatchObject({
      kind: 'FACT',
      epistemicState: 'CONFIRMED',
      sensitivity: 'CUSTOMER_CONFIDENTIAL',
      permittedUses: [PURPOSE_DOCUMENT],
    });
    expect(itemByFact.get(suite.factA1.objectId)?.provenanceRefs).toEqual([
      suite.sliceARef,
      suite.goldenDraftRef,
    ]);

    // ③ The same facts in another input order produce the identical payload
    // and metadata (slice order and DRAFT inputRef order are both owned sorts).
    const externalInput = (role: string, externalId: string): Record<string, unknown> => ({
      inputRole: role,
      ref: {
        system: 'wi216.external',
        resourceType: 'document',
        externalId,
        observedAt: new Date(suite.clock).toISOString(),
      },
      required: false,
      permittedUse: PURPOSE_DOCUMENT,
      contentAccessMode: 'REFERENCE_ONLY',
      integrityRequired: false,
    });
    const baseInput = await suite.unitAssemblyInput({
      draftMutate: (draft) => {
        draft.inputRefs = [
          externalInput('wi216.alpha', 'doc-1'),
          externalInput('wi216.beta', 'doc-2'),
        ];
      },
    });
    const permutedInput = await suite.unitAssemblyInput({
      draftMutate: (draft) => {
        draft.inputRefs = [
          externalInput('wi216.beta', 'doc-2'),
          externalInput('wi216.alpha', 'doc-1'),
        ];
      },
      slices: [
        { ref: suite.sliceARef, slice: sliceA },
        { ref: suite.sliceBRef, slice: sliceB },
      ],
    });
    const identityFields = {
      snapshotId: baseInput.snapshotId,
      asOf: baseInput.asOf,
      correlationId: baseInput.correlationId,
    };
    const base = assembleInitialContext(baseInput);
    const permuted = assembleInitialContext({ ...permutedInput, ...identityFields });
    if (base.outcome !== 'ASSEMBLED' || permuted.outcome !== 'ASSEMBLED') {
      throw new Error('permutation fixture did not assemble');
    }
    expect(permuted.payload).toEqual(base.payload);
    expect(permuted.metadata).toEqual(base.metadata);

    // PARTIAL coverage: a record.form.read slice forbids the Fact metadata.
    const partialEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-003-partial',
      purpose: PURPOSE_FORM,
      sourceSlices: [suite.sliceCRef],
    });
    const partial = await suite.attemptBuild(partialEnvelope);
    expect(partial, JSON.stringify(partial)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const partialRow = await suite.contextSnapshotRow(
      record(partialEnvelope.targetRef).objectId as string,
    );
    const partialCoverage = record(partialRow?.canonical_payload.coverage);
    expect(partialCoverage.completeness).toBe('PARTIAL');
    expect(partialCoverage.excludedScopes).toEqual(expect.arrayContaining(['ENTERPRISE_FACTS']));
    expect(partialRow?.coverage_state).toBe('PARTIAL');

    // The watermark union is a set union: one shared watermark stays one entry.
    const cloneId = newUuidV7();
    const cloneRef = {
      ...suite.sliceBRef,
      objectId: cloneId,
      contentHash: contentHash(createHash('sha256').update('wi216-003-clone').digest('hex')),
    };
    const cloneSlice = structuredClone(sliceB);
    cloneSlice.sliceId = cloneId;
    const dedup = assembleInitialContext(
      await suite.unitAssemblyInput({
        slices: [
          { ref: suite.sliceBRef, slice: sliceB },
          { ref: cloneRef, slice: cloneSlice },
        ],
      }),
    );
    if (dedup.outcome !== 'ASSEMBLED') throw new Error('watermark dedup fixture did not assemble');
    expect((dedup.payload.sourceWatermarks as unknown[]).length).toBe(1);

    // The ref-closure negatives of §19.3 item 2.
    const negativeCase = async (
      tag: string,
      sourceSlices: unknown[],
      code: string,
      thrown: boolean,
      receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
    ): Promise<void> => {
      const negativeEnvelope = await suite.preparedBuild({
        idempotencyKey: `wi216-003-${tag}`,
        sourceSlices,
      });
      const negative = await suite.attemptBuild(negativeEnvelope);
      expect(negative, tag).toMatchObject({ code, thrown });
      await suite.expectNoContextSnapshot(
        record(negativeEnvelope.targetRef).objectId as string,
        `wi216-003-${tag}`,
        receipt,
      );
    };
    // A duplicate entry and an empty set are closed by the registered Schema.
    await negativeCase(
      'duplicate',
      [suite.sliceARef, suite.sliceARef],
      API_VALUE_INVALID,
      true,
      'ABSENT',
    );
    await negativeCase('empty', [], API_VALUE_INVALID, true, 'ABSENT');
    // A well-formed ref that names no committed Slice rejects in the handler.
    await negativeCase(
      'unknown-id',
      [{ ...suite.sliceARef, objectId: newUuidV7() }],
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    // OBSERVED DISAGREEMENT (header note): the owning EP read reports a hash
    // mismatch as PROJECT_QUERY_REF_INVALID, which the entry rethrows and the
    // handler maps onto a thrown DEPENDENCY_UNAVAILABLE — not the matrix's
    // rejected EXECUTION_CONTEXT_SOURCE_INVALID.
    await negativeCase(
      'wrong-hash',
      [{ ...suite.sliceARef, contentHash: contentHash('0'.repeat(64)) }],
      DEPENDENCY_UNAVAILABLE,
      true,
      'ABSENT',
    );
    await negativeCase(
      'wrong-scope',
      [{ ...suite.sliceARef, scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() } }],
      EXECUTION_CONTEXT_SOURCE_INVALID,
      false,
    );
    await negativeCase(
      'wrong-kind',
      [{ ...suite.sliceARef, kind: 'OBJECT' }],
      API_VALUE_INVALID,
      true,
      'ABSENT',
    );
    // The unit-layer half of the duplicate closure.
    const duplicateUnit = assembleInitialContext(
      await suite.unitAssemblyInput({
        slices: [
          { ref: suite.sliceARef, slice: sliceA },
          { ref: suite.sliceARef, slice: sliceA },
        ],
      }),
    );
    expect(duplicateUnit).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
  });

  suite.itIntegration(
    'TE-214-D-004 fails closed on every source/policy counter-example',
    async () => {
      const rejectBuild = async (
        tag: string,
        input: Partial<BuildInput>,
        code: string,
        thrown: boolean,
        entry: InitialContextEntry = suite.initialContextEntry,
        receipt: 'REJECTED_OR_ABSENT' | 'ABSENT' = 'REJECTED_OR_ABSENT',
      ): Promise<void> => {
        const envelope = await suite.preparedBuild({
          idempotencyKey: `wi216-004-${tag}`,
          ...input,
        });
        const attempt = await suite.attemptBuild(envelope, entry);
        expect(attempt, tag).toMatchObject({ code, thrown });
        await suite.expectNoContextSnapshot(
          record(envelope.targetRef).objectId as string,
          `wi216-004-${tag}`,
          receipt,
        );
      };

      // The audience must be the Slice audience exactly: another principal id and
      // another principal kind both fail the assembly closure.
      await rejectBuild(
        'audience-other',
        { audience: { principalId: OTHER_PRINCIPAL, principalKind: 'HUMAN' } },
        EXECUTION_CONTEXT_SOURCE_INVALID,
        false,
      );
      await rejectBuild(
        'audience-kind',
        { audience: { principalId: OPERATOR, principalKind: 'AGENT' } },
        EXECUTION_CONTEXT_SOURCE_INVALID,
        false,
      );
      // EXPIRED and REVOKED slices are owning-read lifecycle states.
      const moved = new Date(suite.clock + 300_000);
      await rejectBuild(
        'slice-expired',
        { sourceSlices: [suite.sliceTTLRef], decisionNow: moved },
        EXECUTION_CONTEXT_SOURCE_INVALID,
        false,
        suite.entryFor({ now: () => moved }),
      );
      await rejectBuild(
        'slice-revoked',
        { sourceSlices: [suite.sliceRevokedRef] },
        EXECUTION_CONTEXT_SOURCE_INVALID,
        false,
      );
      // A Slice captured for another purpose never closes against the request.
      await rejectBuild(
        'slice-purpose',
        { sourceSlices: [suite.sliceCRef] },
        EXECUTION_CONTEXT_SOURCE_INVALID,
        false,
      );

      // Builder Policy lifecycle and binding counter-examples (§11.2.5.1-2).
      const supersededCommandId = newUuidV7();
      await rejectBuild(
        'policy-superseded',
        {
          builderPolicyRef: policyKey(BUILDER_POLICY.supersededFirst, suite.fixture),
          commandId: supersededCommandId,
        },
        POLICY_EXPIRED,
        false,
      );
      // The rejected command leaves its safe Audit record (§19.6 item 3).
      expect(await suite.auditRows(supersededCommandId)).toEqual([
        {
          outcome: 'REJECTED',
          error_code: POLICY_EXPIRED,
          safe_summary: expect.any(String) as unknown,
        },
      ]);
      await rejectBuild(
        'policy-future',
        { builderPolicyRef: policyKey(BUILDER_POLICY.future, suite.fixture) },
        POLICY_NOT_EFFECTIVE,
        false,
      );
      await rejectBuild(
        'policy-no-projection',
        { builderPolicyRef: policyKey(BUILDER_POLICY.noProjection, suite.fixture) },
        'INVALID_POLICY_BINDING',
        false,
      );
      await rejectBuild(
        'policy-wrong-profile',
        { builderPolicyRef: policyKey(BUILDER_POLICY.wrongProfile, suite.fixture) },
        'INVALID_POLICY_BINDING',
        false,
      );
      // The DRAFT pins another Builder Policy version: the four-point binding
      // refuses the request's ref (§11.2.5.1 row 2).
      const altTask = await suite.createExecutableTask('2.0');
      const altWorkOrder = await suite.createWorkOrder({
        taskId: altTask,
        taskMajor: '2.0',
        builderPolicyPair: BUILDER_POLICY.alt,
      });
      await rejectBuild(
        'policy-pin-mismatch',
        { workOrderId: altWorkOrder },
        'POLICY_REF_MISMATCH',
        false,
      );
      // A non-Policy ref spelling is pinned out by the registered Schema.
      await rejectBuild(
        'policy-wrong-type',
        {
          builderPolicyRef: {
            kind: 'VERSIONED',
            objectType: WORK_ORDER_V11,
            objectId: newUuidV7(),
            versionId: newUuidV7(),
            scope: suite.scope(),
          },
        },
        API_VALUE_INVALID,
        true,
        suite.initialContextEntry,
        'ABSENT',
      );
      // An ENTERPRISE-scoped Policy ref passes the handler gate, but the owning
      // resolution cannot authorize it under the Project-scoped actor: the
      // boundary fails closed as unavailable (header note; no Policy exists
      // there either way).
      await rejectBuild(
        'policy-enterprise-scope',
        {
          builderPolicyRef: {
            kind: 'VERSIONED',
            objectType: POLICY_OBJECT,
            objectId: BUILDER_POLICY.main[0],
            versionId: BUILDER_POLICY.main[1],
            scope: { enterpriseId: suite.fixture.enterpriseId },
          },
        },
        DEPENDENCY_UNAVAILABLE,
        true,
        suite.initialContextEntry,
        'ABSENT',
      );

      // The unit-layer counter-examples the registered Schemas close before a
      // DRAFT exists (header note): each runs the owning assembly on the real
      // committed slice payloads with exactly one dimension broken.
      const sliceA = await suite.slicePayloadOf(suite.sliceARef.objectId);
      const unitReject = async (
        tag: string,
        mutate: (slice: Record<string, unknown>) => void,
        code: string = EXECUTION_CONTEXT_SOURCE_INVALID,
      ): Promise<void> => {
        const mutated = structuredClone(sliceA);
        mutate(mutated);
        const outcome = assembleInitialContext(
          await suite.unitAssemblyInput({ slices: [{ ref: suite.sliceARef, slice: mutated }] }),
        );
        expect(outcome, tag).toMatchObject({ outcome: 'REJECTED', errorCode: code });
      };
      // A fact item missing a member / with an off-table status / riskLevel.
      await unitReject('fact-missing-member', (slice) => {
        delete record((record(slice.source).factItems as unknown[])[0]).riskLevel;
      });
      await unitReject('fact-off-table-status', (slice) => {
        record((record(slice.source).factItems as unknown[])[0]).status = 'ARCHIVED';
      });
      await unitReject('fact-off-table-risk', (slice) => {
        record((record(slice.source).factItems as unknown[])[0]).riskLevel = 'SEVERE';
      });
      // The slices must agree on the manifest singletons and the Project.
      const sliceB = await suite.slicePayloadOf(suite.sliceBRef.objectId);
      const manifestConflict = structuredClone(sliceB);
      record(manifestConflict.source).enterpriseProfileSnapshotRef = {
        ...record(record(sliceB.source).enterpriseProfileSnapshotRef),
        objectId: newUuidV7(),
      };
      const conflict = assembleInitialContext(
        await suite.unitAssemblyInput({
          slices: [
            { ref: suite.sliceARef, slice: sliceA },
            { ref: suite.sliceBRef, slice: manifestConflict },
          ],
        }),
      );
      expect(conflict).toMatchObject({
        outcome: 'REJECTED',
        errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
      });
      await unitReject('project-ref', (slice) => {
        record(record(slice.source).projectRef).objectId = newUuidV7();
      });
      // An omission with an off-table reasonCode fails closed.
      await unitReject('omission-reason', (slice) => {
        ((record(slice.source).omissions as unknown[])[0] as Record<string, unknown>).reasonCode =
          'MADE_UP';
      });
      // A null validUntil is not a string member.
      await unitReject('valid-until-null', (slice) => {
        slice.validUntil = null;
      });
      // Two slices may not carry the same Fact subject identity.
      const twinId = newUuidV7();
      const twin = structuredClone(sliceA);
      twin.sliceId = twinId;
      const twinRef = {
        ...suite.sliceARef,
        objectId: twinId,
        contentHash: contentHash(createHash('sha256').update('wi216-004-twin').digest('hex')),
      };
      const duplicateSubject = assembleInitialContext(
        await suite.unitAssemblyInput({
          slices: [
            { ref: suite.sliceARef, slice: sliceA },
            { ref: twinRef, slice: twin },
          ],
        }),
      );
      expect(duplicateSubject).toMatchObject({
        outcome: 'REJECTED',
        errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
      });
    },
  );

  suite.itIntegration('TE-214-D-005 fails closed on unavailable dependencies', async () => {
    // A dead EnterpriseProject pool: the owning Slice read never answers; the
    // claim rolls back and the same key succeeds once the boundary is back.
    const deadEpPool = new pg.Pool({ connectionString: suite.probeUrl, max: 1 });
    await deadEpPool.end();
    const sliceDownEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-005-ep' });
    const sliceDown = await suite.attemptBuild(
      sliceDownEnvelope,
      suite.entryFor({ enterpriseProjectDb: createEnterpriseProjectDatabase(deadEpPool) }),
    );
    expect(sliceDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await suite.expectNoContextSnapshot(
      record(sliceDownEnvelope.targetRef).objectId as string,
      'wi216-005-ep',
      'ABSENT',
    );
    const sliceBack = await suite.attemptBuild(sliceDownEnvelope);
    expect(sliceBack, JSON.stringify(sliceBack)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // A dead IdentityPolicy pool: the Decision read itself is unavailable.
    const deadIpPool = new pg.Pool({ connectionString: suite.probeUrl, max: 1 });
    await deadIpPool.end();
    const policyDownEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-005-ip' });
    const policyDown = await suite.attemptBuild(
      policyDownEnvelope,
      suite.entryFor({ identityDb: createIdentityPolicyDatabase(deadIpPool) }),
    );
    expect(policyDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await suite.expectNoContextSnapshot(
      record(policyDownEnvelope.targetRef).objectId as string,
      'wi216-005-ip',
      'ABSENT',
    );

    // A dead TaskExecution pool surfaces the raw pg driver error from the
    // composition boundary — no stable module code exists at that layer
    // (header note); the closure is "thrown, no claim, no row".
    const deadTePool = new pg.Pool({ connectionString: suite.probeUrl, max: 1 });
    await deadTePool.end();
    const storeDownEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-005-te' });
    const storeDown = await suite.attemptBuild(
      storeDownEnvelope,
      suite.entryFor({ taskExecutionDb: createTaskExecutionDatabase(deadTePool) }),
    );
    expect(storeDown.thrown).toBe(true);
    await suite.expectNoContextSnapshot(
      record(storeDownEnvelope.targetRef).objectId as string,
      'wi216-005-te',
      'ABSENT',
    );

    // A revoked dependency Grant fails the internal reads fail-closed; the
    // re-grant restores the path (wi212 convention).
    const revokedSliceRead = await suite.revokeCapabilityTracked(
      suite.identityDeps([suite.fixture.projectId]),
      {
        targetId: suite.grantSliceRead,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
        },
        reasonCode: 'WI216_SLICE_READ_REVOKE',
        effectiveAt: new Date(suite.clock),
        idempotencyKey: `wi216:revoke:${suite.grantSliceRead}`,
      },
    );
    expect(revokedSliceRead.status).toBe('COMMITTED');
    const grantDownEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-005-grant' });
    const grantDown = await suite.attemptBuild(grantDownEnvelope);
    expect(grantDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await suite.expectNoContextSnapshot(
      record(grantDownEnvelope.targetRef).objectId as string,
      'wi216-005-grant',
      'ABSENT',
    );
    suite.grantSliceRead = await suite.grantGeneric(dependencyCapabilities.readContextSourceSlice);
    const grantBack = await suite.attemptBuild(grantDownEnvelope);
    expect(grantBack, JSON.stringify(grantBack)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });

    // The Policy resolution read is its own dependency with its own Grant.
    const revokedResolve = await suite.revokeCapabilityTracked(
      suite.identityDeps([suite.fixture.projectId]),
      {
        targetId: suite.grantResolve,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
        },
        reasonCode: 'WI216_RESOLVE_REVOKE',
        effectiveAt: new Date(suite.clock),
        idempotencyKey: `wi216:revoke:${suite.grantResolve}`,
      },
    );
    expect(revokedResolve.status).toBe('COMMITTED');
    const resolveDownEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-005-resolve' });
    const resolveDown = await suite.attemptBuild(resolveDownEnvelope);
    expect(resolveDown).toMatchObject({ code: DEPENDENCY_UNAVAILABLE, thrown: true });
    await suite.expectNoContextSnapshot(
      record(resolveDownEnvelope.targetRef).objectId as string,
      'wi216-005-resolve',
      'ABSENT',
    );
    suite.grantResolve = await suite.grantGeneric(dependencyCapabilities.resolvePolicy);
    expect(await suite.attemptBuild(resolveDownEnvelope)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
  });
}
