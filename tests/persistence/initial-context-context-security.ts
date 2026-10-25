import {
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_EXPIRED,
  AUTHORIZATION_REVOKED,
} from '@zhiju/identity-policy';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  API_VALUE_INVALID,
  buildInitialContextIdempotencyScope,
  COMMAND_IN_PROGRESS,
  type CommandEnvelope,
  CONCURRENCY_CONFLICT,
  digestCanonicalPayload,
  executeTaskExecutionCommand,
  IDEMPOTENCY_PAYLOAD_CONFLICT,
  TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH,
} from '@zhiju/task-execution';
import { sql } from 'kysely';
import { readdirSync } from 'node:fs';
import { expect } from 'vitest';
import {
  ACTIONS,
  BUILD_COMMAND,
  BUILD_VERSION,
  BUILDER_POLICY,
  contentHash,
  CONTEXT_SNAPSHOT_OBJECT,
  contextSnapshotCapabilityCodes,
  CORRELATION,
  DRAFT_SNAPSHOT_OBJECT,
  failureOf,
  isInfrastructureFailure,
  OPERATOR,
  OPERATOR_ACTOR,
  OTHER_PRINCIPAL,
  POLICY_OBJECT,
  POLICY_SNAPSHOT_ID,
  PRINCIPAL_OBJECT,
  record,
  REQUEST_DECISION,
  resultCode,
  SLICE_OBJECT,
} from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerContextSecurity(suite: InitialContextSuite): void {
  suite.itIntegration('TE-214-D-006 executes the §11.2.5.4 expiry matrix', async () => {
    // The default build's effective expiry bound: the earliest slice
    // `validUntil` (the DRAFT creation expiry sits 24h out, the Builder Policy
    // has no successor).
    const sliceBound = (await suite.slicePayloadOf(suite.sliceARef.objectId)).validUntil as string;

    // ① No `expiresAt` member: the bound becomes the declared payload expiry.
    const omittedEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-006-omitted' });
    const omitted = await suite.attemptBuild(omittedEnvelope);
    expect(omitted, JSON.stringify(omitted)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (omitted.result === undefined) throw new Error('omitted-expiry build did not commit');
    const omittedTarget = record(omittedEnvelope.targetRef).objectId as string;
    const omittedRow = await suite.contextSnapshotRow(omittedTarget);
    expect(omittedRow?.canonical_payload.expiresAt).toBe(sliceBound);
    expect(omittedRow?.expires_at?.toISOString()).toBe(sliceBound);
    expect(omittedRow?.effective_expires_at?.toISOString()).toBe(sliceBound);
    const omittedBuild = await suite.contextSnapshotBuildRow(
      suite.contextSnapshotRefOf(omitted.result).snapshotId,
    );
    expect(omittedBuild?.request_expires_at).toBeNull();
    expect(Object.hasOwn(omittedBuild?.canonical_payload ?? {}, 'requestExpiresAt')).toBe(false);
    expect(omittedBuild?.effective_expires_at?.toISOString()).toBe(sliceBound);

    // ② A request expiry exactly at the bound closes, and the declared member
    // is recorded as `requestExpiresAt` (a different content address from ①).
    const equalEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-006-equal',
      expiry: { present: true, value: sliceBound },
    });
    const equal = await suite.attemptBuild(equalEnvelope);
    expect(equal, JSON.stringify(equal)).toMatchObject({ code: 'COMMITTED', thrown: false });
    if (equal.result === undefined) throw new Error('equal-expiry build did not commit');
    const equalTarget = record(equalEnvelope.targetRef).objectId as string;
    const equalRow = await suite.contextSnapshotRow(equalTarget);
    expect(equalRow?.canonical_payload.expiresAt).toBe(sliceBound);
    const equalBuild = await suite.contextSnapshotBuildRow(
      suite.contextSnapshotRefOf(equal.result).snapshotId,
    );
    expect(equalBuild?.request_expires_at?.toISOString()).toBe(sliceBound);
    expect(record(equalBuild?.canonical_payload).requestExpiresAt).toBe(sliceBound);
    if (omittedRow === undefined || equalRow === undefined) throw new Error('expiry rows missing');
    expect(equalRow.payload_hash.equals(omittedRow.payload_hash)).toBe(false);

    // ③ One second past the bound: the closed binding rejection.
    const overBound = new Date(new Date(sliceBound).getTime() + 1_000).toISOString();
    const overEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-006-over',
      expiry: { present: true, value: overBound },
    });
    const over = await suite.attemptBuild(overEnvelope);
    expect(over).toMatchObject({ code: 'EXPIRY_UPPER_BOUND_EXCEEDED', thrown: false });
    await suite.expectNoContextSnapshot(
      record(overEnvelope.targetRef).objectId as string,
      'wi216-006-over',
    );

    // ④ Sub-second precision survives end to end: the declared text lands in
    // the payload verbatim and the column keeps microseconds.
    const precise = new Date(Math.floor((suite.clock + 10_000) / 1_000) * 1_000)
      .toISOString()
      .replace('.000Z', '.123456Z');
    const preciseEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-006-precise',
      expiry: { present: true, value: precise },
    });
    const preciseAttempt = await suite.attemptBuild(preciseEnvelope);
    expect(preciseAttempt, JSON.stringify(preciseAttempt)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    const preciseTarget = record(preciseEnvelope.targetRef).objectId as string;
    const preciseRow = await suite.contextSnapshotRow(preciseTarget);
    expect(preciseRow?.canonical_payload.expiresAt).toBe(precise);
    const rendered = (
      await suite.admin.query<{ rendered: string }>(
        `SELECT expires_at::text AS rendered
           FROM task_execution.context_snapshot WHERE object_id = $1`,
        [preciseTarget],
      )
    ).rows.at(0);
    expect(rendered?.rendered).toContain('.123456');

    // ⑤ A calendar-invalid instant passes the registered spelling pattern and
    // is refused by the owning expiry binding (parseUtcInstant).
    const malformedEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-006-malformed',
      expiry: { present: true, value: '2026-02-30T00:00:00.000Z' },
    });
    const malformed = await suite.attemptBuild(malformedEnvelope);
    expect(malformed).toMatchObject({ code: 'INVALID_EXPIRY_INPUT', thrown: false });
    await suite.expectNoContextSnapshot(
      record(malformedEnvelope.targetRef).objectId as string,
      'wi216-006-malformed',
    );

    // ⑥ A JSON-null member is no instant spelling: the registered Schema.
    const nullEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-006-null',
      expiry: { present: true, value: null },
    });
    const nullAttempt = await suite.attemptBuild(nullEnvelope);
    expect(nullAttempt).toMatchObject({ code: API_VALUE_INVALID, thrown: true });
    await suite.expectNoContextSnapshot(
      record(nullEnvelope.targetRef).objectId as string,
      'wi216-006-null',
      'ABSENT',
    );

    // ⑦ The DRAFT-crossing branch is TE-214-D-002's expired case: the binding
    // rejects one step before the unreachable commit-point re-check (header).
  });

  suite.itIntegration('TE-214-D-007 refuses principal and Decision substitution', async () => {
    // A Decision minted for another principal never covers this actor: the
    // second Human holds the same build capability and mints its own Decision
    // for the same payload digest, presented under the operator actor.
    await suite.grant({
      principal: suite.other(),
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
      action: ACTIONS.ctxBuild,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    const substituted = await suite.preparedBuild({ idempotencyKey: 'wi216-007-other-decision' });
    substituted.authorizationDecisionRef = await suite.issueBuildDecision({
      principal: suite.other(),
      targetId: record(substituted.targetRef).objectId as string,
      payloadHash: digestCanonicalPayload(substituted.payload as CanonicalJsonObject).hash,
    });
    const substitutedAttempt = await suite.attemptBuild(substituted);
    expect(substitutedAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await suite.expectNoContextSnapshot(
      record(substituted.targetRef).objectId as string,
      'wi216-007-other-decision',
      'ABSENT',
    );

    // The Envelope actor member naming another principal under the operator's
    // own Decision fails the actor binding.
    const actorSwap = await suite.preparedBuild({ idempotencyKey: 'wi216-007-actor' });
    actorSwap.actor = {
      kind: 'OBJECT',
      objectType: PRINCIPAL_OBJECT,
      objectId: OTHER_PRINCIPAL,
      scope: suite.scope(),
    };
    const actorSwapAttempt = await suite.attemptBuild(actorSwap);
    expect(actorSwapAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await suite.expectNoContextSnapshot(
      record(actorSwap.targetRef).objectId as string,
      'wi216-007-actor',
      'ABSENT',
    );

    // A read Decision never covers the build (COMMAND_MISMATCH).
    const readDecisionEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-007-read-decision',
    });
    readDecisionEnvelope.authorizationDecisionRef = await suite.issueReadDecision({
      targetId: record(readDecisionEnvelope.targetRef).objectId as string,
      payloadHash: digestCanonicalPayload(readDecisionEnvelope.payload as CanonicalJsonObject).hash,
    });
    const readDecisionAttempt = await suite.attemptBuild(readDecisionEnvelope);
    expect(readDecisionAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await suite.expectNoContextSnapshot(
      record(readDecisionEnvelope.targetRef).objectId as string,
      'wi216-007-read-decision',
      'ABSENT',
    );

    // A build Decision never covers the read — the Snapshot need not exist,
    // the revalidation fires first.
    const readPayload = {
      contextSnapshotRef: {
        kind: 'SNAPSHOT',
        objectType: CONTEXT_SNAPSHOT_OBJECT,
        objectId: newUuidV7(),
        snapshotId: newUuidV7(),
        scope: suite.scope(),
        contentHash: contentHash('0'.repeat(64)),
      },
    };
    const buildDecisionForRead = await suite.issueBuildDecision({
      targetId: record(readPayload.contextSnapshotRef).objectId as string,
      payloadHash: digestCanonicalPayload(readPayload as unknown as CanonicalJsonObject).hash,
    });
    const mismatchedRead = await suite.attemptRead(
      suite.readEnvelope({
        snapshotRef: readPayload.contextSnapshotRef,
        decisionRef: buildDecisionForRead,
      }),
    );
    expect(mismatchedRead).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });

    // `actingFor` is not a member of the registered request shape.
    const actingFor = await suite.preparedBuild({
      idempotencyKey: 'wi216-007-acting-for',
      requestMutate: (request) => {
        request.actingFor = { principalId: OTHER_PRINCIPAL, principalKind: 'HUMAN' };
      },
    });
    const actingForAttempt = await suite.attemptBuild(actingFor);
    expect(actingForAttempt).toMatchObject({ code: API_VALUE_INVALID, thrown: true });
    await suite.expectNoContextSnapshot(
      record(actingFor.targetRef).objectId as string,
      'wi216-007-acting-for',
      'ABSENT',
    );

    // A Decision minted for another target never covers this target.
    const transferred = await suite.preparedBuild({ idempotencyKey: 'wi216-007-target' });
    transferred.authorizationDecisionRef = await suite.issueBuildDecision({
      targetId: newUuidV7(),
      payloadHash: digestCanonicalPayload(transferred.payload as CanonicalJsonObject).hash,
    });
    const transferredAttempt = await suite.attemptBuild(transferred);
    expect(transferredAttempt).toMatchObject({
      code: AUTHORIZATION_DECISION_INVALID,
      thrown: true,
    });
    await suite.expectNoContextSnapshot(
      record(transferred.targetRef).objectId as string,
      'wi216-007-target',
      'ABSENT',
    );
  });

  suite.itIntegration('TE-214-D-008 revalidates before claim and historical replay', async () => {
    const key = 'wi216-008-build';
    const envelope = await suite.preparedBuild({ idempotencyKey: key });
    const committed = await suite.attemptBuild(envelope);
    expect(committed, JSON.stringify(committed)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    if (committed.result === undefined) throw new Error('the 008 build did not commit');
    // The fresh-key envelope's Decision is minted before the revocation: the
    // mint itself legitimately requires the covering Grant.
    const freshEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-008-fresh' });

    // Revoke the one covering Grant: the revalidation runs before the claim,
    // so even the byte-identical historical replay is refused, and the
    // committed Receipt stays the only row of the key.
    const revoked = await suite.revokeCapabilityTracked(
      suite.identityDeps([suite.fixture.projectId]),
      {
        targetId: suite.grantCtxBuild,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
        },
        reasonCode: 'WI216_REVOKE_BUILD',
        effectiveAt: new Date(suite.clock),
        idempotencyKey: `wi216:revoke:${suite.grantCtxBuild}`,
      },
    );
    expect(revoked.status).toBe('COMMITTED');
    const replay = await suite.attemptBuild(envelope);
    expect(replay).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    expect(await suite.receiptRows(key)).toHaveLength(1);
    const fresh = await suite.attemptBuild(freshEnvelope);
    expect(fresh).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    await suite.expectNoContextSnapshot(
      record(freshEnvelope.targetRef).objectId as string,
      'wi216-008-fresh',
      'ABSENT',
    );

    // Re-grant: the historical replay returns the original COMMITTED result.
    suite.grantCtxBuild = await suite.grant({
      capabilityCode: contextSnapshotCapabilityCodes.contextSnapshotBuildV11,
      action: ACTIONS.ctxBuild,
      selectorType: 'CREATE_TARGET_TYPE',
      targetObjectType: CONTEXT_SNAPSHOT_OBJECT,
    });
    const duplicate = await suite.attemptBuild(envelope);
    expect(duplicate).toMatchObject({ code: 'DUPLICATE', thrown: false });
    if (duplicate.result?.status !== 'DUPLICATE') throw new Error('expected a DUPLICATE replay');
    expect(duplicate.result.originalOutcome).toBe('COMMITTED');
    expect(duplicate.result.resultPayload).toEqual(suite.committedPayload(committed.result));

    // An expired Decision: minted under the real clock with the Port's
    // 300-second TTL, so the platform context gate (which compares the
    // Decision expiry against the real wall clock) still accepts it; the
    // entry's trusted instant sits past that window, so the Port's own
    // EXPIRED check answers. A Decision already expired under the real clock
    // never reaches that check — the gate refuses it and the entry folds the
    // refusal into a thrown DEPENDENCY_UNAVAILABLE (header note).
    const expiredEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-008-expired',
      decisionNow: new Date(),
    });
    const expired = await suite.attemptBuild(
      expiredEnvelope,
      suite.entryFor({ now: () => new Date(Date.now() + 600_000) }),
    );
    expect(expired).toMatchObject({ code: AUTHORIZATION_EXPIRED, thrown: true });
    await suite.expectNoContextSnapshot(
      record(expiredEnvelope.targetRef).objectId as string,
      'wi216-008-expired',
      'ABSENT',
    );

    // A drifted trusted capability configuration: the code the composition
    // pins no longer equals the code the covering Grant was issued under.
    const driftedEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-008-drifted' });
    const drifted = await suite.attemptBuild(
      driftedEnvelope,
      suite.entryFor({
        capabilityCodes: {
          ...contextSnapshotCapabilityCodes,
          contextSnapshotBuildV11: 'wi216.cap.drifted',
        },
      }),
    );
    expect(drifted).toMatchObject({ code: AUTHORIZATION_REVOKED, thrown: true });
    await suite.expectNoContextSnapshot(
      record(driftedEnvelope.targetRef).objectId as string,
      'wi216-008-drifted',
      'ABSENT',
    );
  });

  suite.itIntegration('TE-214-D-009 scopes idempotency to one build', async () => {
    const key = 'wi216-009-seed';
    const workOrder = await suite.createWorkOrder({
      taskId: await suite.createExecutableTask('2.0'),
      taskMajor: '2.0',
    });
    const envelope = await suite.preparedBuild({ idempotencyKey: key, workOrderId: workOrder });
    const targetId = record(envelope.targetRef).objectId as string;
    const committed = await suite.attemptBuild(envelope);
    expect(committed, JSON.stringify(committed)).toMatchObject({
      code: 'COMMITTED',
      thrown: false,
    });
    if (committed.result === undefined) throw new Error('the 009 seed build did not commit');

    // The exact replay is the stored COMMITTED fact; nothing new is written.
    const snapshotCount = await suite.countRows('task_execution.context_snapshot');
    const replay = await suite.attemptBuild(envelope);
    expect(replay).toMatchObject({ code: 'DUPLICATE', thrown: false });
    if (replay.result?.status !== 'DUPLICATE') throw new Error('expected a DUPLICATE replay');
    expect(replay.result.originalOutcome).toBe('COMMITTED');
    expect(replay.result.resultPayload).toEqual(suite.committedPayload(committed.result));
    expect(await suite.receiptRows(key)).toHaveLength(1);
    expect(await suite.countRows('task_execution.context_snapshot')).toBe(snapshotCount);
    expect(await suite.outboxRows(targetId)).toHaveLength(1);

    // The same key over another payload is a conflict: audited as DENIED and
    // thrown; the committed Receipt is untouched.
    const otherWorkOrder = await suite.createWorkOrder({
      taskId: await suite.createExecutableTask('2.0'),
      taskMajor: '2.0',
    });
    const conflictCommandId = newUuidV7();
    const conflictEnvelope = await suite.preparedBuild({
      idempotencyKey: key,
      workOrderId: otherWorkOrder,
      targetId,
      commandId: conflictCommandId,
    });
    const conflict = await suite.attemptBuild(conflictEnvelope);
    expect(conflict).toMatchObject({ code: IDEMPOTENCY_PAYLOAD_CONFLICT, thrown: true });
    expect(await suite.auditRows(conflictCommandId)).toEqual([
      {
        outcome: 'DENIED',
        error_code: IDEMPOTENCY_PAYLOAD_CONFLICT,
        safe_summary: 'same idempotency key replayed with a different request hash',
      },
    ]);
    expect(await suite.receiptRows(key)).toHaveLength(1);

    // A second build of the same target under another key: the Scope-unique
    // CREATE identity is taken — the stable business rejection, not an error.
    const secondEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-009-second',
      workOrderId: otherWorkOrder,
      targetId,
    });
    const second = await suite.attemptBuild(secondEnvelope);
    expect(second).toMatchObject({ code: CONCURRENCY_CONFLICT, thrown: false });
    expect(await suite.countRows('task_execution.context_snapshot')).toBe(snapshotCount);

    // The claim Scope string carries commandType@commandVersion: the two
    // registered build versions never share a claim.
    expect(
      buildInitialContextIdempotencyScope(
        BUILD_COMMAND,
        '1.0',
        suite.fixture.enterpriseId,
        suite.fixture.projectId,
      ),
    ).not.toBe(
      buildInitialContextIdempotencyScope(
        BUILD_COMMAND,
        BUILD_VERSION,
        suite.fixture.enterpriseId,
        suite.fixture.projectId,
      ),
    );
  });

  suite.itIntegration('TE-214-D-010 resolves concurrent builds', async () => {
    // Two different-key builds of one target: exactly one wins the Scope-unique
    // CREATE identity; the loser records the stable business rejection.
    const targetId = newUuidV7();
    const [left, right] = await Promise.all([
      suite.attemptBuild(await suite.preparedBuild({ idempotencyKey: 'wi216-010-left', targetId })),
      suite.attemptBuild(
        await suite.preparedBuild({ idempotencyKey: 'wi216-010-right', targetId }),
      ),
    ]);
    const pair = [left, right];
    expect(
      pair.filter((outcome) => outcome.code === 'COMMITTED' && !outcome.thrown),
      JSON.stringify(pair),
    ).toHaveLength(1);
    expect(
      pair.filter((outcome) => outcome.code === CONCURRENCY_CONFLICT && !outcome.thrown),
    ).toHaveLength(1);
    const winnerRows = (
      await suite.admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
        [targetId],
      )
    ).rows.at(0);
    expect(winnerRows?.n).toBe(1);

    // The same Envelope claimed twice concurrently: exactly one COMMITTED, and
    // the loser either observes the committed Receipt (DUPLICATE) or the
    // in-flight claim (COMMAND_IN_PROGRESS) — the §19.8(3) claim protocol is
    // the only accepted resolution, and the concurrent pair itself must
    // produce it. A thrown error outside that protocol invalidates the attempt
    // only when it is positively identified as an infrastructure failure
    // (`isInfrastructureFailure`: a Node errno, a pg driver connection
    // lifecycle message, or a connection/operator-intervention SQLSTATE; the
    // PR #217 round-5 CI failure carried no exteriors, so its code is
    // unknowable and the identification stays strict); the pair is then
    // re-driven under a fresh Envelope identity. A fulfilled result outside
    // the protocol, a thrown stable module/authorization code or an
    // unclassified throw (both fail closed below), a double COMMITTED, or a
    // third consecutive escape is a defect, never a retry.
    const raceLog: { attempt: number; exteriors: { code: string; message?: string }[] }[] = [];
    let validTarget: string | undefined;
    for (let attempt = 1; attempt <= 3 && validTarget === undefined; attempt += 1) {
      const sameEnvelope = await suite.preparedBuild({
        idempotencyKey: `wi216-010-same-${attempt}`,
      });
      const sameTarget = record(sameEnvelope.targetRef).objectId as string;
      const settled = await Promise.allSettled([
        suite.initialContextEntry.build(sameEnvelope, suite.sessionFor()),
        suite.initialContextEntry.build(sameEnvelope, suite.sessionFor()),
      ]);
      const exteriors = settled.map((outcome): { code: string; message?: string } =>
        outcome.status === 'fulfilled'
          ? { code: resultCode(outcome.value) }
          : { code: failureOf(outcome.reason).code, message: failureOf(outcome.reason).message },
      );
      raceLog.push({ attempt, exteriors });
      const codes = exteriors.map((exterior) => exterior.code);
      const inProtocol = (index: number): boolean => {
        const code = codes[index];
        return code === 'COMMITTED' || code === 'DUPLICATE' || code === COMMAND_IN_PROGRESS;
      };
      // A fulfilled result outside the claim protocol is a business defect,
      // never a transient escape: fail instead of invalidating the attempt.
      expect(
        settled.filter((outcome, index) => outcome.status === 'fulfilled' && !inProtocol(index)),
        JSON.stringify(raceLog),
      ).toHaveLength(0);
      // A thrown escape invalidates the attempt only on positive
      // infrastructure identification; a thrown stable module or
      // authorization code (a thrown COMMAND_IN_PROGRESS is a protocol
      // result, not an escape) and every unclassified throw fail closed with
      // both exteriors attached.
      expect(
        settled.filter((outcome, index) => {
          if (outcome.status !== 'rejected') return false;
          if (codes[index] === COMMAND_IN_PROGRESS) return false;
          return !isInfrastructureFailure(outcome.reason);
        }),
        JSON.stringify(raceLog),
      ).toHaveLength(0);
      // Exactly-once effect holds even for an invalidated attempt: never more
      // than one Snapshot row for the attempted target.
      const attemptRows = (
        await suite.admin.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
          [sameTarget],
        )
      ).rows.at(0);
      expect(attemptRows?.n, JSON.stringify(raceLog)).toBeLessThanOrEqual(1);
      if (
        codes.filter((code) => code === 'COMMITTED').length === 1 &&
        codes.filter((code) => code === 'DUPLICATE' || code === COMMAND_IN_PROGRESS).length === 1
      ) {
        validTarget = sameTarget;
      }
    }
    // The race evidence is a concurrent pair resolved inside the claim
    // protocol; three consecutive escapes are a systematic defect, not a flake.
    if (validTarget === undefined) {
      throw new Error(
        `the same-Envelope race never resolved inside the claim protocol: ${JSON.stringify(raceLog)}`,
      );
    }
    const sameRows = (
      await suite.admin.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
        [validTarget],
      )
    ).rows.at(0);
    expect(sameRows?.n).toBe(1);

    // NOT RUN: the Builder × Freeze/WorkOrder-transition race — neither a
    // Freeze nor a WorkOrder status transition is delivered in this slice
    // (header note).
  });

  suite.itIntegration('TE-214-D-011 rolls back injected faults', async () => {
    // Harvest one committed build's exact stored facts.
    const seedCommandId = newUuidV7();
    const seedEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-011-seed',
      commandId: seedCommandId,
    });
    const seed = await suite.attemptBuild(seedEnvelope);
    expect(seed, JSON.stringify(seed)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const seedTarget = record(seedEnvelope.targetRef).objectId as string;
    const seedRow = await suite.contextSnapshotRow(seedTarget);
    if (seedRow === undefined) throw new Error('the 011 seed snapshot is missing');
    const seedBuild = await suite.contextSnapshotBuildRow(seedRow.snapshot_id);
    if (seedBuild === undefined) throw new Error('the 011 seed build row is missing');

    // The same writes with a fresh Snapshot identity and target, then the
    // injected fault after the Outbox write (the runner's controlled fault).
    const faultKey = 'wi216-011-fault';
    const faultTarget = newUuidV7();
    const faultSnapshotId = newUuidV7();
    const faultCommandId = newUuidV7();
    const clonedPayload = structuredClone(seedRow.canonical_payload);
    clonedPayload.contextSnapshotId = faultSnapshotId;
    const clonedHeader = record(clonedPayload.header);
    clonedHeader.contractId = faultSnapshotId;
    const clonedSchemaRef = record(clonedHeader.schemaRef);
    clonedSchemaRef.objectId = faultSnapshotId;
    clonedSchemaRef.versionId = faultSnapshotId;
    const clonedDigest = digestCanonicalPayload(clonedPayload as CanonicalJsonObject);
    const requestPayloadHash = digestCanonicalPayload(
      seedEnvelope.payload as CanonicalJsonObject,
    ).hash;
    const clonedExpiry =
      typeof clonedPayload.expiresAt === 'string' ? clonedPayload.expiresAt : undefined;
    const metadataDigest = digestCanonicalPayload(
      seedBuild.canonical_payload as CanonicalJsonObject,
    );
    const faultDrive = suite.track(
      executeTaskExecutionCommand(
        suite.teDb,
        suite.runnerContext(),
        {
          commandId: faultCommandId,
          commandType: BUILD_COMMAND,
          commandVersion: BUILD_VERSION,
          // The same claim Scope the composition entry derives: the retry below
          // enters through the entry and must find nothing claimed.
          idempotencyScope: buildInitialContextIdempotencyScope(
            BUILD_COMMAND,
            BUILD_VERSION,
            suite.fixture.enterpriseId,
            suite.fixture.projectId,
          ),
          idempotencyKey: faultKey,
          requestPayload: seedEnvelope.payload as CanonicalJsonObject,
          enterpriseId: suite.fixture.enterpriseId,
          projectId: suite.fixture.projectId,
          targetType: CONTEXT_SNAPSHOT_OBJECT,
          targetId: faultTarget,
          correlationId: CORRELATION,
          principalId: OPERATOR,
          principalKind: 'HUMAN',
          actorSnapshotId: OPERATOR_ACTOR,
          authorizationDecisionId: REQUEST_DECISION,
          policySnapshotId: POLICY_SNAPSHOT_ID,
        },
        async (execution) => {
          const inserted = await execution.insertContextSnapshot({
            snapshotId: faultSnapshotId,
            objectId: faultTarget,
            purpose: seedRow.purpose,
            audience: seedRow.audience,
            enterpriseId: suite.fixture.enterpriseId,
            projectId: suite.fixture.projectId,
            builderVersion: BUILD_VERSION,
            policySnapshotId: seedRow.policy_snapshot_id,
            sourceManifestCount: seedRow.source_manifest_count,
            contextItemCount: seedRow.context_item_count,
            omissionCount: seedRow.omission_count,
            redactionCount: seedRow.redaction_count,
            coverageState: seedRow.coverage_state,
            payloadHash: clonedDigest.hash,
            expiresAt: clonedExpiry,
            effectiveExpiresAt: clonedExpiry,
            requestPayloadHash,
            sourceCommandId: faultCommandId,
            createdByPrincipalId: OPERATOR,
            canonicalPayload: clonedPayload as CanonicalJsonObject,
          });
          if (!inserted) throw new Error('the fault-drive target already exists');
          await execution.insertContextSnapshotBuild({
            snapshotId: faultSnapshotId,
            buildKind: 'INITIAL',
            draftSnapshotRef: seedBuild.draft_snapshot_ref as unknown as CanonicalJsonObject,
            sliceRefs: seedBuild.slice_refs as unknown as CanonicalJsonObject[],
            purpose: seedBuild.purpose,
            audience: seedBuild.audience as unknown as CanonicalJsonObject,
            builderPolicyRef: seedBuild.builder_policy_ref as unknown as CanonicalJsonObject,
            policyContentHash: seedBuild.policy_content_hash,
            policyEffectiveFrom: seedBuild.policy_effective_from.toISOString(),
            ...(seedBuild.effective_expires_at === null
              ? {}
              : { effectiveExpiresAt: seedBuild.effective_expires_at.toISOString() }),
            canonicalPayload: seedBuild.canonical_payload as CanonicalJsonObject,
            payloadHash: metadataDigest.hash,
            requestPayloadHash,
            sourceCommandId: faultCommandId,
            enterpriseId: suite.fixture.enterpriseId,
            projectId: suite.fixture.projectId,
            createdByPrincipalId: OPERATOR,
          });
          const edgeBase = {
            ownerObjectType: CONTEXT_SNAPSHOT_OBJECT,
            ownerObjectId: faultTarget,
            ownerVersionId: faultSnapshotId,
            ownerPayloadHash: clonedDigest.hash,
          };
          await execution.appendReferenceEdge({
            ...edgeBase,
            referencePath: '/draftSnapshotRef',
            targetModule: 'TaskExecution',
            targetObjectType: DRAFT_SNAPSHOT_OBJECT,
            targetObjectId: suite.goldenDraftRef.objectId,
            targetPayloadHash: Buffer.from(suite.goldenDraftRef.contentHash.digest, 'hex'),
            referencePurpose: 'CONTEXT_SNAPSHOT_DRAFT',
          });
          await execution.appendReferenceEdge({
            ...edgeBase,
            referencePath: '/projection/builderPolicyRef',
            targetModule: 'IdentityPolicy',
            targetObjectType: POLICY_OBJECT,
            targetObjectId: BUILDER_POLICY.main[0],
            targetVersionId: BUILDER_POLICY.main[1],
            referencePurpose: 'CONTEXT_SNAPSHOT_POLICY',
          });
          await execution.appendReferenceEdge({
            ...edgeBase,
            referencePath: '/sourceSlices/0',
            targetModule: 'EnterpriseProject',
            targetObjectType: SLICE_OBJECT,
            targetObjectId: suite.sliceARef.objectId,
            targetPayloadHash: Buffer.from(suite.sliceARef.contentHash.digest, 'hex'),
            referencePurpose: 'CONTEXT_SNAPSHOT_SOURCE_SLICE',
          });
          await execution.appendOutbox({
            eventId: newUuidV7(),
            eventType: 'execution.ContextSnapshotBuilt',
            // The runner drive skips the registry validation the real handler
            // performs; the stored six-member payload keeps the historical
            // no-`scopeMirror` posture (the runner's own mirror check).
            eventVersion: '1.1',
            aggregateType: CONTEXT_SNAPSHOT_OBJECT,
            aggregateId: faultTarget,
            aggregateVersion: '1',
            payload: {
              contextSnapshotRef: {
                kind: 'SNAPSHOT',
                objectType: CONTEXT_SNAPSHOT_OBJECT,
                objectId: faultTarget,
                snapshotId: faultSnapshotId,
                scope: suite.scope(),
                contentHash: contentHash(clonedDigest.hash.toString('hex')),
              },
              workOrderRef: (await suite.draftPayloadOf(suite.goldenWorkOrderId)).workOrderRef,
              projectionType: 'COORDINATOR',
              coverageStatus: seedRow.coverage_state,
              enterpriseId: suite.fixture.enterpriseId,
              projectId: suite.fixture.projectId,
            } as unknown as CanonicalJsonObject,
            occurredAt: new Date(suite.clock),
          });
          return execution.failAfterOutbox();
        },
      ),
    );
    await expect(faultDrive).rejects.toMatchObject({ code: 'INJECTED_FAULT' });

    // The whole owning transaction rolled back: no Snapshot, no metadata, no
    // Edge, no Outbox row, no Receipt — under the same claim Scope the entry
    // itself derives.
    expect(await suite.contextSnapshotRow(faultTarget)).toBeUndefined();
    expect(await suite.contextSnapshotBuildRow(faultSnapshotId)).toBeUndefined();
    expect(await suite.edgeRows(faultTarget)).toEqual([]);
    expect(await suite.outboxRows(faultTarget)).toEqual([]);
    expect(await suite.receiptRows(faultKey)).toEqual([]);

    // The same idempotency key through the entry commits cleanly afterwards.
    const retryEnvelope = await suite.preparedBuild({
      idempotencyKey: faultKey,
      targetId: faultTarget,
    });
    const retry = await suite.attemptBuild(retryEnvelope);
    expect(retry, JSON.stringify(retry)).toMatchObject({ code: 'COMMITTED', thrown: false });
    expect(await suite.edgeRows(faultTarget)).toHaveLength(3);
    expect(await suite.outboxRows(faultTarget)).toHaveLength(1);
  });

  suite.itIntegration('TE-214-D-012 rejects direct forgery at the database', async () => {
    // One real build supplies the faithful baseline every forgery starts from.
    const seedCommandId = newUuidV7();
    const seedEnvelope = await suite.preparedBuild({
      idempotencyKey: 'wi216-012-seed',
      commandId: seedCommandId,
    });
    const seed = await suite.attemptBuild(seedEnvelope);
    expect(seed, JSON.stringify(seed)).toMatchObject({ code: 'COMMITTED', thrown: false });
    const seedTarget = record(seedEnvelope.targetRef).objectId as string;
    const seedRowRead = await suite.contextSnapshotRow(seedTarget);
    if (seedRowRead === undefined) throw new Error('the 012 seed snapshot is missing');
    const seedRow = seedRowRead;
    const seedBuildRead = await suite.contextSnapshotBuildRow(seedRow.snapshot_id);
    if (seedBuildRead === undefined) throw new Error('the 012 seed build row is missing');
    const seedBuild = seedBuildRead;
    const seedRequestHash = digestCanonicalPayload(
      seedEnvelope.payload as CanonicalJsonObject,
    ).hash;

    interface SnapshotForgery {
      readonly targetId?: string;
      readonly snapshotId?: string;
      readonly payloadMutate?: (payload: Record<string, unknown>) => void;
      readonly columns?: {
        readonly payloadHash?: Buffer;
        readonly coverageState?: string;
        readonly omitExpiry?: boolean;
        readonly requestPayloadHash?: Buffer;
        readonly sourceCommandId?: string;
        readonly createdByPrincipalId?: string;
      };
      readonly buildDraftRef?: unknown;
      readonly skipSnapshot?: boolean;
      readonly rawSql?: boolean;
      readonly envelopeTargetId?: string;
    }

    /**
     * Drives one forged write inside a real claimed command (same envelope
     * shape as TE-214-D-011): the Receipt is PENDING, the trusted context is
     * the operator's, and the only false dimension is the one the case names.
     * Returns the failure the database or the repository reported.
     */
    async function forgeSnapshot(
      input: SnapshotForgery = {},
    ): Promise<{ code: string; message: string } | null> {
      const targetId = input.targetId ?? newUuidV7();
      const snapshotId = input.snapshotId ?? newUuidV7();
      const commandId = newUuidV7();
      const payload = structuredClone(seedRow.canonical_payload);
      payload.contextSnapshotId = snapshotId;
      const header = record(payload.header);
      header.contractId = snapshotId;
      const schemaRef = record(header.schemaRef);
      schemaRef.objectId = snapshotId;
      schemaRef.versionId = snapshotId;
      input.payloadMutate?.(payload);
      // The NFC-collision case cannot recompute a digest client-side either
      // (the shared-kernel canonicalizer throws on the same bytes), so it pins
      // a fixed hash; every other case derives the faithful digest.
      const payloadHash =
        input.columns?.payloadHash ?? digestCanonicalPayload(payload as CanonicalJsonObject).hash;
      const requestPayloadHash = input.columns?.requestPayloadHash ?? seedRequestHash;
      const expiryText =
        input.columns?.omitExpiry === true
          ? undefined
          : typeof payload.expiresAt === 'string'
            ? payload.expiresAt
            : undefined;
      try {
        await suite.track(
          executeTaskExecutionCommand(
            suite.teDb,
            suite.runnerContext(),
            {
              commandId,
              commandType: BUILD_COMMAND,
              commandVersion: BUILD_VERSION,
              idempotencyScope: 'wi216:forgery',
              idempotencyKey: `wi216-forgery-${commandId}`,
              requestPayload: seedEnvelope.payload as CanonicalJsonObject,
              enterpriseId: suite.fixture.enterpriseId,
              projectId: suite.fixture.projectId,
              targetType: CONTEXT_SNAPSHOT_OBJECT,
              targetId: input.envelopeTargetId ?? targetId,
              correlationId: CORRELATION,
              principalId: OPERATOR,
              principalKind: 'HUMAN',
              actorSnapshotId: OPERATOR_ACTOR,
              authorizationDecisionId: REQUEST_DECISION,
              policySnapshotId: POLICY_SNAPSHOT_ID,
            } satisfies CommandEnvelope,
            async (execution) => {
              if (input.rawSql === true) {
                // The repository preempts a forged creator with its module
                // error (TASK_EXECUTION_CONTEXT_PRINCIPAL_MISMATCH), so this
                // dimension is exercised through SQL on the runner's own
                // transaction instead; V3004's BEFORE triggers fire before the
                // RLS WITH CHECK, so the identity guard is what answers.
                await sql`
                INSERT INTO task_execution.context_snapshot
                  (snapshot_id, object_id, purpose, audience, enterprise_id,
                   project_id, builder_version, policy_snapshot_id,
                   source_manifest_count, context_item_count, omission_count,
                   redaction_count, coverage_state, payload_hash,
                   payload_hash_algorithm, expires_at, effective_expires_at,
                   request_payload_hash, source_command_id,
                   created_by_principal_id, canonical_payload)
                VALUES (
                  ${snapshotId}, ${targetId}, ${seedRow.purpose},
                  ${seedRow.audience}, ${suite.fixture.enterpriseId},
                  ${suite.fixture.projectId}, ${BUILD_VERSION},
                  ${seedRow.policy_snapshot_id}, ${seedRow.source_manifest_count},
                  ${seedRow.context_item_count}, ${seedRow.omission_count},
                  ${seedRow.redaction_count}, ${seedRow.coverage_state},
                  ${payloadHash}, 'SHA-256', ${expiryText ?? null},
                  ${expiryText ?? null}, ${requestPayloadHash}, ${commandId},
                  ${input.columns?.createdByPrincipalId ?? OPERATOR},
                  ${JSON.stringify(payload)}::jsonb
                )`.execute(execution.trx);
                return { kind: 'COMMITTED', resultPayload: { forged: true } };
              }
              if (input.skipSnapshot !== true) {
                const inserted = await execution.insertContextSnapshot({
                  snapshotId,
                  objectId: targetId,
                  purpose: seedRow.purpose,
                  audience: seedRow.audience,
                  enterpriseId: suite.fixture.enterpriseId,
                  projectId: suite.fixture.projectId,
                  builderVersion: BUILD_VERSION,
                  policySnapshotId: seedRow.policy_snapshot_id,
                  sourceManifestCount: seedRow.source_manifest_count,
                  contextItemCount: seedRow.context_item_count,
                  omissionCount: seedRow.omission_count,
                  redactionCount: seedRow.redaction_count,
                  coverageState: input.columns?.coverageState ?? seedRow.coverage_state,
                  payloadHash,
                  expiresAt: expiryText,
                  effectiveExpiresAt: expiryText,
                  requestPayloadHash,
                  sourceCommandId: input.columns?.sourceCommandId ?? commandId,
                  createdByPrincipalId: OPERATOR,
                  canonicalPayload: payload as CanonicalJsonObject,
                });
                if (!inserted) throw new Error('the forged target already exists');
              }
              await execution.insertContextSnapshotBuild({
                snapshotId,
                buildKind: 'INITIAL',
                draftSnapshotRef: (input.buildDraftRef ??
                  seedBuild.draft_snapshot_ref) as CanonicalJsonObject,
                sliceRefs: seedBuild.slice_refs as unknown as CanonicalJsonObject[],
                purpose: seedBuild.purpose,
                audience: seedBuild.audience as unknown as CanonicalJsonObject,
                builderPolicyRef: seedBuild.builder_policy_ref as unknown as CanonicalJsonObject,
                policyContentHash: seedBuild.policy_content_hash,
                policyEffectiveFrom: seedBuild.policy_effective_from.toISOString(),
                ...(seedBuild.effective_expires_at === null
                  ? {}
                  : { effectiveExpiresAt: seedBuild.effective_expires_at.toISOString() }),
                canonicalPayload: seedBuild.canonical_payload as CanonicalJsonObject,
                payloadHash: digestCanonicalPayload(
                  seedBuild.canonical_payload as CanonicalJsonObject,
                ).hash,
                requestPayloadHash,
                sourceCommandId: input.columns?.sourceCommandId ?? commandId,
                enterpriseId: suite.fixture.enterpriseId,
                projectId: suite.fixture.projectId,
                createdByPrincipalId: OPERATOR,
              });
              return { kind: 'COMMITTED', resultPayload: { forged: true } };
            },
          ),
        );
        return null;
      } catch (error) {
        return failureOf(error);
      }
    }

    const mirrorMismatch = 'context snapshot promoted mirror mismatch';
    const identityMismatch = 'context snapshot creation identity mismatch';
    const buildIdentityMismatch = 'context snapshot build creation identity mismatch';
    const expectForgery = async (
      label: string,
      input: SnapshotForgery,
      code: string,
      message: string,
    ): Promise<void> => {
      const targetId = input.targetId ?? newUuidV7();
      const failure = await forgeSnapshot({ ...input, targetId });
      expect(failure?.code, label).toBe(code);
      expect(failure?.message, label).toContain(message);
      expect(await suite.contextSnapshotRow(targetId), label).toBeUndefined();
    };

    // Mirror dimensions the payload itself disproves.
    await expectForgery(
      'payload-hash',
      { columns: { payloadHash: Buffer.alloc(32, 0) } },
      '22023',
      mirrorMismatch,
    );
    await expectForgery(
      'coverage-state',
      { columns: { coverageState: 'PARTIAL' } },
      '22023',
      mirrorMismatch,
    );
    await expectForgery(
      'expiry-column',
      { columns: { omitExpiry: true } },
      '22023',
      mirrorMismatch,
    );

    // Identity dimensions: the request hash, the source command and the
    // creator must all name this in-flight command and this trusted principal.
    await expectForgery(
      'request-hash',
      { columns: { requestPayloadHash: Buffer.alloc(32, 0) } },
      '22023',
      identityMismatch,
    );
    await expectForgery(
      'creator',
      { rawSql: true, columns: { createdByPrincipalId: OTHER_PRINCIPAL } },
      '22023',
      identityMismatch,
    );
    await expectForgery(
      'unknown-command',
      { columns: { sourceCommandId: newUuidV7() } },
      '22023',
      identityMismatch,
    );
    await expectForgery(
      'finalized-command',
      { columns: { sourceCommandId: seedCommandId } },
      '22023',
      identityMismatch,
    );

    // The Envelope target and the row identity cannot disagree: the runner-bound
    // repository preempts this dimension with the module error, no SQLSTATE.
    const scopeForgeryTarget = newUuidV7();
    const scopeForgery = await forgeSnapshot({
      targetId: scopeForgeryTarget,
      envelopeTargetId: newUuidV7(),
    });
    expect(scopeForgery?.code).toBe(TASK_EXECUTION_CONTEXT_SCOPE_MISMATCH);
    expect(await suite.contextSnapshotRow(scopeForgeryTarget)).toBeUndefined();

    // The build metadata closure: a foreign DRAFT ref never resolves, and a
    // build row without its Snapshot fails the identity guard before the FK.
    await expectForgery(
      'foreign-draft',
      { buildDraftRef: { ...seedBuild.draft_snapshot_ref, objectId: newUuidV7() } },
      '22023',
      buildIdentityMismatch,
    );
    const orphanTarget = newUuidV7();
    const orphan = await forgeSnapshot({ targetId: orphanTarget, skipSnapshot: true });
    expect(orphan?.code).toBe('22023');
    expect(orphan?.message).toContain(buildIdentityMismatch);
    expect(await suite.contextSnapshotRow(orphanTarget)).toBeUndefined();

    // A payload whose member names collide after NFC normalization cannot
    // define a content address: the guard's canonicalizer raises, folded into
    // the mirror mismatch (the shared-kernel canonicalizer throws on the same
    // bytes client-side, so the hash is pinned).
    await expectForgery(
      'nfc-collision',
      {
        payloadMutate: (payload) => {
          record(payload.workContext)['café'] = 'nfc';
          record(payload.workContext)['café'] = 'nfd';
        },
        columns: { payloadHash: Buffer.alloc(32, 0x5a) },
      },
      '22023',
      mirrorMismatch,
    );

    // ACL: the app role has no UPDATE/DELETE on either fact table.
    const seedSnapshotId = seedRow.snapshot_id;
    for (const [label, statement, parameters] of [
      [
        'snapshot-update',
        'UPDATE task_execution.context_snapshot SET payload_hash = $2 WHERE object_id = $1',
        [seedTarget, Buffer.alloc(32, 0x47)],
      ],
      [
        'snapshot-delete',
        'DELETE FROM task_execution.context_snapshot WHERE object_id = $1',
        [seedTarget],
      ],
      [
        'build-update',
        'UPDATE task_execution.context_snapshot_build SET payload_hash = $2 WHERE snapshot_id = $1',
        [seedSnapshotId, Buffer.alloc(32, 0x47)],
      ],
      [
        'build-delete',
        'DELETE FROM task_execution.context_snapshot_build WHERE snapshot_id = $1',
        [seedSnapshotId],
      ],
    ] as const) {
      const failure = await suite.appStatement(statement, parameters);
      expect(failure?.code, label).toBe('42501');
    }

    // The owner role itself cannot rewrite history (immutability triggers).
    for (const [label, statement, parameters, message] of [
      [
        'owner-update',
        'UPDATE task_execution.context_snapshot SET canonical_payload = canonical_payload WHERE object_id = $1',
        [seedTarget],
        'context_snapshot history is immutable',
      ],
      [
        'owner-delete',
        'DELETE FROM task_execution.context_snapshot WHERE object_id = $1',
        [seedTarget],
        'context_snapshot history is immutable',
      ],
      [
        'owner-build-update',
        'UPDATE task_execution.context_snapshot_build SET canonical_payload = canonical_payload WHERE snapshot_id = $1',
        [seedSnapshotId],
        'context_snapshot_build history is immutable',
      ],
      [
        'owner-build-delete',
        'DELETE FROM task_execution.context_snapshot_build WHERE snapshot_id = $1',
        [seedSnapshotId],
        'context_snapshot_build history is immutable',
      ],
    ] as const) {
      let failure: { code: string; message: string } | null = null;
      try {
        await suite.admin.query(statement, [...parameters]);
      } catch (error) {
        failure = failureOf(error);
      }
      expect(failure?.code, label).toBe('23514');
      expect(failure?.message, label).toContain(message);
    }

    // The owner-only canonicalizer is not callable by the app role.
    const canonicalizerCall = await suite.appStatement(
      'SELECT task_execution.canonical_jsonb_text($1::jsonb)',
      ['{"a":1}'],
    );
    expect(canonicalizerCall?.code).toBe('42501');

    // RLS: a context that does not allow this Project sees nothing.
    const foreignCount = await suite.asAppRole(
      suite.tePool,
      'task_execution_app',
      { allowedProjectIds: [newUuidV7()] },
      async (client) =>
        (
          await client.query<{ n: number }>(
            'SELECT count(*)::int AS n FROM task_execution.context_snapshot WHERE object_id = $1',
            [seedTarget],
          )
        ).rows.at(0)?.n,
    );
    expect(foreignCount).toBe(0);

    // A direct INSERT by the app role outside any claimed command: no PENDING
    // Receipt exists, so the creation-identity guard answers.
    const directInsert = await suite.appStatement(
      `INSERT INTO task_execution.context_snapshot
         (snapshot_id, object_id, purpose, audience, enterprise_id, project_id,
          builder_version, policy_snapshot_id, source_manifest_count,
          context_item_count, omission_count, redaction_count, coverage_state,
          payload_hash, payload_hash_algorithm, expires_at, effective_expires_at,
          request_payload_hash, source_command_id, created_by_principal_id,
          canonical_payload)
       VALUES ($1, $2, $3, $4, $5, $6, '1.1', $7, $8, $9, $10, $11, $12, $13,
               'SHA-256', $14, $14, $15, $16, $17, $18::jsonb)`,
      [
        newUuidV7(),
        newUuidV7(),
        seedRow.purpose,
        seedRow.audience,
        suite.fixture.enterpriseId,
        suite.fixture.projectId,
        seedRow.policy_snapshot_id,
        seedRow.source_manifest_count,
        seedRow.context_item_count,
        seedRow.omission_count,
        seedRow.redaction_count,
        seedRow.coverage_state,
        seedRow.payload_hash,
        seedRow.expires_at?.toISOString() ?? null,
        seedRow.request_payload_hash,
        newUuidV7(),
        OPERATOR,
        JSON.stringify(seedRow.canonical_payload),
      ],
    );
    expect(directInsert?.code).toBe('22023');
    expect(directInsert?.message).toContain(identityMismatch);

    // The forgery battery changed nothing about the committed seed fact.
    const seedAfter = await suite.contextSnapshotRow(seedTarget);
    expect(seedAfter?.payload_hash.equals(seedRow.payload_hash)).toBe(true);
  });

  suite.itIntegration('TE-214-D-013 records the migration facts', async () => {
    const triggers = await suite.admin.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger
        WHERE tgrelid IN ('task_execution.context_snapshot'::regclass,
                          'task_execution.context_snapshot_build'::regclass,
                          'task_execution.context_snapshot_legacy'::regclass)
          AND NOT tgisinternal
        ORDER BY tgname`,
    );
    expect(triggers.rows.map((row) => row.tgname)).toEqual([
      'context_snapshot_build_creation_identity_guard',
      'context_snapshot_build_immutable_guard',
      'context_snapshot_build_mirror_guard',
      'context_snapshot_creation_identity_guard',
      'context_snapshot_immutable_guard',
      'context_snapshot_legacy_immutable_guard',
      'context_snapshot_legacy_mirror_guard',
      'context_snapshot_mirror_guard',
    ]);
    const policies = await suite.admin.query<{ polname: string }>(
      `SELECT polname FROM pg_policy
        WHERE polrelid IN ('task_execution.context_snapshot'::regclass,
                           'task_execution.context_snapshot_build'::regclass,
                           'task_execution.context_snapshot_legacy'::regclass)
        ORDER BY polname`,
    );
    expect(policies.rows.map((row) => row.polname)).toEqual([
      'context_snapshot_build_insert',
      'context_snapshot_build_select',
      'context_snapshot_insert',
      'context_snapshot_legacy_insert',
      'context_snapshot_legacy_select',
      'context_snapshot_select',
    ]);
    const rls = await suite.admin.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `SELECT relname, relrowsecurity AS enabled, relforcerowsecurity AS forced
         FROM pg_class
        WHERE relnamespace = 'task_execution'::regnamespace
          AND relname IN ('context_snapshot', 'context_snapshot_build',
                          'context_snapshot_legacy')
        ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: 'context_snapshot', enabled: true, forced: true },
      { relname: 'context_snapshot_build', enabled: true, forced: true },
      { relname: 'context_snapshot_legacy', enabled: true, forced: true },
    ]);

    // Every on-disk migration was applied exactly once and none failed (the
    // empty-database apply and the V6002 seed are the gate's own evidence).
    const history = await suite.admin.query<{ version: string; success: boolean }>(
      'SELECT version, success FROM public.flyway_schema_history ORDER BY installed_rank',
    );
    expect(history.rows.length).toBeGreaterThan(0);
    expect(history.rows.every((row) => row.success)).toBe(true);
    const onDisk = readdirSync(new URL('../../migrations', import.meta.url), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) =>
        readdirSync(new URL(`../../migrations/${entry.name}`, import.meta.url))
          .filter((file) => /^V\d+__.*\.sql$/u.test(file))
          .map((file) => file.slice(1, file.indexOf('__'))),
      );
    expect([...history.rows.map((row) => row.version)].sort()).toEqual([...new Set(onDisk)].sort());
    for (const version of ['3000', '3001', '3002', '3003', '3004']) {
      expect(
        history.rows.find((row) => row.version === version),
        version,
      ).toMatchObject({ success: true });
    }
  });
}
