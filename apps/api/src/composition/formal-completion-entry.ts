import { getContractRegistry, type Common } from '@zhiju/contracts';
import { canonicalize, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createFormalCompletionAuthorizationPort,
  formalCompletionBindings,
  readExecutionCapabilityBundle,
  readIntegrityForExpiry,
  type FormalCompletionAuthorizationConfig,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import {
  handleGetWorkOrderContract,
  handleGetContextSnapshot,
  createDependencyCompletionPort,
  handleEvaluateFormalCompletion,
  handleGetFormalCompletionJudgment,
  handleGetFormalWorkOrderState,
  handleGetOutputCreationBinding,
  type FormalCompletionPorts,
  type CommandEnvelope,
  type TaskExecutionTransactionContext,
  type OutputCreationBindingPorts,
} from '@zhiju/task-execution';
import {
  handleCreateExecutionRevision,
  handleGetExecutionOutputFact,
  type ArtifactDb,
  type ObjectStoragePort,
  type RevisionCommandEnvelope,
} from '@zhiju/artifact';
import {
  handleCompletionQualitySelection,
  handleGetRevisionAcceptanceSnapshot,
  handleGetApprovalBundleSnapshot,
  handleGetRevisionExecutionEligibility,
  type QualityGovernanceDb,
} from '@zhiju/quality-governance';
import type { Kysely } from 'kysely';
import type { SyntheticRuntimeDriver, FormalOutputReleasePorts } from '@zhiju/integration-gateway';
import {
  assertActorBinding,
  assertIntegrity,
  createDecisionBoundary,
  decisionReference,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  type DecisionRow,
} from './decision-boundary.js';
import { createWorkOrderDependencyReads } from './work-order-dependency-reads.js';
import {
  readFrozenEligibilityForConsumer,
  type BlockedInputRecoveryEntryConfig,
} from './blocked-input-recovery-entry.js';
import type { InitialContextEntryConfig, InitialContextSession } from './initial-context-entry.js';

type Ref = CanonicalJsonObject;
export interface FormalCompletionEntryConfig extends Omit<
  InitialContextEntryConfig,
  'capabilityCodes'
> {
  readonly driver?: {
    readonly runtime: SyntheticRuntimeDriver;
    readonly ports: FormalOutputReleasePorts;
  };
  readonly revalidateOutputCreationBinding: () => Promise<void>;
  readonly recoveryConfig?: () => BlockedInputRecoveryEntryConfig;
  readonly formalAuthorization: FormalCompletionAuthorizationConfig;
  readonly artifactDb: Kysely<ArtifactDb>;
  readonly artifactStorage: ObjectStoragePort;
  readonly qualityDb: Kysely<QualityGovernanceDb>;
  /** Artifact Service calls the separately authorized TE binding entry. */
  readonly readOutputCreationBinding: (runRef: Common.ObjectRef) => Promise<Ref>;
  readonly outputCreationBindingPorts?: (
    context: TaskExecutionTransactionContext,
    revalidate: () => Promise<void>,
  ) => OutputCreationBindingPorts;
}
function identityContext(row: DecisionRow): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: row.principal_id,
    actorSnapshotId: row.actor_snapshot_id,
    authorizationDecisionId: row.authorization_decision_id,
    authorizationDecisionHash: row.payload_hash,
    authorizationDecisionExpiresAt: row.expires_at,
    enterpriseId: row.enterprise_id,
    allowedProjectIds: row.project_id ? [row.project_id] : [],
    correlationId: row.authorization_decision_id,
  };
}
export function createFormalCompletionDependencyPorts(
  config: FormalCompletionEntryConfig,
  row: DecisionRow,
  session: InitialContextSession,
  consumer: string,
  revalidateOwn: () => Promise<void>,
) {
  const now = config.now ?? (() => new Date()),
    boundary = createDecisionBoundary(config),
    auth = createFormalCompletionAuthorizationPort(config.formalAuthorization);
  const deps = boundary.identityDeps(identityContext(row)),
    sessionHash = sessionAuthenticationContextHash(session);
  const decisionRef = {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'identity.authorization_decision',
    objectId: row.authorization_decision_id,
    scope: { enterpriseId: row.enterprise_id, projectId: String(row.project_id) },
    contentHash: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: row.payload_hash.toString('hex'),
    },
  } as Common.ContentAddressedRef;
  const common = {
    actorSnapshotRef: session.resolutionActorSnapshotRef,
    commandType: 'internal',
    commandVersion: '1.0',
    commandPayloadHash: row.payload_hash,
    authenticationContextHash: sessionHash,
  };
  const revalidation = {
    decisionRef,
    expectedCommandType: 'internal',
    expectedCommandVersion: '1.0',
    expectedCommandPayloadHash: row.payload_hash,
    expectedAuthenticationContextHash: sessionHash,
    expectedTargetRef: {} as Common.ObjectRef,
  };
  const context: TaskExecutionTransactionContext = {
    ...identityContext(row),
    principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
    policySnapshotId: row.policy_snapshot_id,
    correlationId: row.authorization_decision_id,
  };
  const dependencyProofs = new Map<string, Awaited<ReturnType<typeof issueDependency>>>();
  const expiries = [row.expires_at.toISOString()],
    checks: Parameters<typeof auth.revalidateBatch>[1][number][] = [];
  async function mint(dependencyKey: string, ref: Ref, payload: Ref) {
    const key = canonicalize({ dependencyKey, ref, payload });
    let proof = dependencyProofs.get(key);
    if (!proof) {
      proof = await issueDependency(dependencyKey, ref, payload);
      dependencyProofs.set(key, proof);
    }
    await proof.proof();
    return proof;
  }
  async function issueDependency(dependencyKey: string, ref: Ref, payload: Ref) {
    const mapping = formalCompletionBindings().find((b) => b.capabilityConfigKey === dependencyKey);
    if (!mapping) entryError('AUTHORIZATION_DECISION_INVALID', 'Unknown formal dependency');
    const digest = payloadHashOf(payload);
    const targetRef =
      mapping.targetKind === 'OBJECT'
        ? { kind: 'OBJECT', objectType: ref.objectType, objectId: ref.objectId, scope: ref.scope }
        : ref;
    const input = {
      ...common,
      commandType: mapping.commandType,
      commandVersion: mapping.commandVersion,
      commandPayloadHash: digest,
      targetRef: targetRef as unknown as Common.ObjectRef,
    };
    const allowed = await auth.authorize(deps, dependencyKey, input);
    if (allowed.outcome !== 'ALLOW')
      entryError('AUTHORIZATION_DECISION_INVALID', 'Formal dependency authorization denied');
    const checkInput = {
      ...revalidation,
      decisionRef: allowed.authorizationDecisionRef,
      expectedCommandType: mapping.commandType,
      expectedCommandVersion: mapping.commandVersion,
      expectedCommandPayloadHash: digest,
      expectedTargetRef: targetRef as unknown as Common.ObjectRef,
    };
    const proof = async () => {
      const current = await auth.revalidate(deps, dependencyKey, checkInput);
      if (!current.valid)
        entryError('AUTHORIZATION_DECISION_INVALID', 'Formal dependency authorization revoked');
    };
    await proof();
    checks.push({ key: dependencyKey, input: checkInput });
    expiries.push(allowed.expiresAt);
    return {
      proof,
      context: {
        ...context,
        authorizationDecisionId: allowed.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          allowed.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(allowed.expiresAt),
      },
      purpose: mapping.authorizationPurpose,
    };
  }
  const readers = createWorkOrderDependencyReads(config, row, session);
  const revalidateAll = async () => {
    await revalidateOwn();
    const result = await auth.revalidateBatch(deps, checks);
    if (!result.valid)
      entryError('AUTHORIZATION_DECISION_INVALID', 'Formal dependency authorization revoked');
    await readers.revalidate();
  };
  const stem = (
    {
      output_creation: 'outputCreation',
      work_order_validation: 'workOrderValidation',
      work_order_freeze: 'workOrderFreeze',
      work_order_completion: 'workOrderCompletion',
      task_completion: 'taskCompletion',
      work_order_state: 'workOrderState',
      judgment_read: 'judgmentRead',
      result_validate: 'resultValidate',
      result_accept: 'resultAccept',
      run_finalize: 'runFinalize',
      driver_release: 'driverRelease',
      readiness_build: 'readinessBuild',
      readiness_consume: 'readinessConsume',
      task_state: 'taskState',
    } as Record<string, string>
  )[consumer];
  async function output(ref: Ref) {
    const proof = await mint(`${stem}ExecutionOutputReadV1`, ref, { revisionRef: ref });
    return handleGetExecutionOutputFact(
      config.artifactDb,
      proof.context,
      ref as unknown as Common.ContentAddressedRef,
      { now, storage: config.artifactStorage, revalidateAuthorization: proof.proof },
    ) as unknown as Promise<Ref>;
  }
  const ports: FormalCompletionPorts = {
    now,
    revalidateAuthorization: revalidateAll,
    authorizationValidUntil: () =>
      new Date(
        Math.min(...expiries.map(Date.parse), ...readers.decisionExpiries().map(Date.parse)),
      ),
    actorSnapshotRef: session.resolutionActorSnapshotRef as unknown as Ref,
    authorizationDecisionRef: decisionRef as unknown as Ref,
    authorizeSources: async (ref) => {
      await mint(`${stem}CompletionSourcesReadV1`, ref, { targetRef: ref });
    },
    resolvePolicy: async (ref) => {
      const proof = await mint(`${stem}CompletionPolicyReadV1`, ref, { policyRef: ref });
      const result = await readers.resolvePolicy(ref);
      await proof.proof();
      return result as unknown as Awaited<ReturnType<FormalCompletionPorts['resolvePolicy']>>;
    },
    readExecutionOutput: output,
    inspectBundle: async (ref, runRef) => {
      const proof = await mint(`${stem}CompletionBundleInspectV1`, ref, { bundleRef: ref, runRef });
      await readIntegrityForExpiry(config.identity.db, proof.context, ref, runRef, proof.proof);
    },
    readQuality: async (input) => {
      const facts: { ref: Ref; payload: Ref }[] = [],
        snapshots: Ref[] = [];
      let usable = true,
        revoked = false;
      for (const revisionRef of input.revisionRefs) {
        let selected: Ref;
        if (input.selection) {
          const members = input.selection.outputSnapshots as Ref[];
          const old = members.find(
            (s) => canonicalize(record(s.revisionRef) as Ref) === canonicalize(revisionRef),
          );
          if (!old)
            entryError('EXECUTION_JUDGMENT_INVALID', 'Frozen Quality selection is unavailable');
          selected = old;
        } else {
          const payload = {
            revisionRef,
            qualityProfileRef: input.qualityProfileRef,
            requireApproval: input.requireApproval,
          };
          const proof = await mint(
            'taskCompletionCompletionQualitySelectionReadV1',
            revisionRef,
            payload,
          );
          selected = await handleCompletionQualitySelection(
            config.qualityDb,
            {
              ...proof.context,
              authorizationPurposes: [proof.purpose],
            },
            payload as unknown as Parameters<typeof handleCompletionQualitySelection>[2],
            proof.proof,
            now,
          );
          usable &&= selected.profileUsable === true;
        }
        const ras = selected.revisionAcceptanceRef
            ? (record(selected.revisionAcceptanceRef) as Ref)
            : undefined,
          abs = selected.approvalBundleRef
            ? (record(selected.approvalBundleRef) as Ref)
            : undefined;
        snapshots.push({
          revisionRef,
          ...(ras ? { revisionAcceptanceRef: ras } : {}),
          ...(abs ? { approvalBundleRef: abs } : {}),
        });
        if (!ras || (input.requireApproval && !abs)) {
          usable = false;
          continue;
        }
        const rasProof = await mint(`${stem}RevisionAcceptanceReadV1`, ras, { snapshotRef: ras });
        const rasPayload = await handleGetRevisionAcceptanceSnapshot(
          config.qualityDb,
          rasProof.context,
          { snapshotRef: ras as unknown as Common.SnapshotRef },
        );
        await rasProof.proof();
        const acceptanceFact: Record<string, Ref> = { snapshot: rasPayload as unknown as Ref };
        facts.push({ ref: ras, payload: acceptanceFact });
        if (abs) {
          const absProof = await mint(`${stem}ApprovalBundleReadV1`, abs, { snapshotRef: abs });
          const absPayload = await handleGetApprovalBundleSnapshot(
            config.qualityDb,
            absProof.context,
            { snapshotRef: abs as unknown as Common.SnapshotRef },
          );
          await absProof.proof();
          facts.push({ ref: abs, payload: absPayload as unknown as Ref });
        }
        const payload = {
            revisionRef,
            revisionAcceptanceRef: ras,
            ...(abs ? { approvalBundleRef: abs } : {}),
          },
          proof = await mint(`${stem}RevisionEligibilityReadV1`, revisionRef, payload);
        let approvalRevoked = false;
        const eligibility = await handleGetRevisionExecutionEligibility(
          config.qualityDb,
          { ...proof.context, authorizationPurposes: [proof.purpose] },
          payload as unknown as Parameters<typeof handleGetRevisionExecutionEligibility>[2],
          input.qualityProfileRef as unknown as Common.VersionedRef,
          (revoked) => {
            approvalRevoked = revoked;
          },
        );
        await proof.proof();
        const current = eligibility as unknown as Ref;
        usable &&=
          current.revisionAcceptanceUsable === true &&
          (!input.requireApproval ||
            (record(current.approvalBundleUsable).presence === 'PRESENT' &&
              record(current.approvalBundleUsable).value === true));
        revoked ||= approvalRevoked;
        revoked ||= (current.reasonCodes as string[]).some((c) => /REVOK|INVALIDAT/u.test(c));
        acceptanceFact.currentEligibility = { ...current, approvalRevoked };
      }
      const body = { qualityProfileRef: input.qualityProfileRef, outputSnapshots: snapshots };
      return {
        selection: {
          ...body,
          selectionHash: {
            algorithm: 'SHA-256',
            canonicalizationVersion: '1',
            digest: sha256CanonicalJson(body),
          },
        },
        facts,
        usable,
        revoked,
      };
    },
  };
  const recoveryConfig = config.recoveryConfig;
  const bindingPorts: OutputCreationBindingPorts = {
    now,
    decisionExpiresAt: row.expires_at.toISOString(),
    additionalExpiries: () => expiries,
    revalidateAuthorization: revalidateAll,
    authorizeSources: revalidateOwn,
    ...(recoveryConfig
      ? {
          readFrozenEligibility: (contextRef: Ref, contractRef: Ref) =>
            readFrozenEligibilityForConsumer(
              recoveryConfig(),
              row,
              { ...session, serviceEntryAt: now() },
              'output_creation',
              revalidateAll,
              contextRef,
              contractRef,
            ),
        }
      : {}),
    readContract: (ref) =>
      handleGetWorkOrderContract(config.taskExecutionDb, context, ref, revalidateOwn),
    readContext: async (ref) => {
      await revalidateOwn();
      const view = await handleGetContextSnapshot(config.taskExecutionDb, context, {
        commandVersion: '1.0',
        payload: { contextSnapshotRef: ref },
      });
      await revalidateOwn();
      if (view.status !== 'FOUND') entryError('NOT_FOUND', 'Context unavailable');
      return view.resultPayload as unknown as {
        contextSnapshotRef: Ref;
        projectContextContract: Ref;
      };
    },
    resolveControls: async (ref) => {
      const proof = await mint('outputCreationControlsReadV1', ref, { policyRef: ref });
      const view = await readers.resolvePolicy(ref);
      await proof.proof();
      return view as unknown as Awaited<ReturnType<OutputCreationBindingPorts['resolveControls']>>;
    },
    readBundle: async (ref, runRef) => {
      const proof = await mint('outputCreationBundleReadV1', ref, { bundleRef: ref, runRef });
      return readExecutionCapabilityBundle(
        config.identity.db,
        proof.context,
        ref,
        runRef,
        proof.proof,
        now,
      );
    },
  };
  return {
    ports,
    revalidateAll,
    output,
    bindingPorts,
    mint,
    completion: createDependencyCompletionPort(config.taskExecutionDb, context, ports),
  };
}

/** Trusted composition proves own and every finite consumer-specific dependency Decision. */
export function createFormalCompletionEntry(config: FormalCompletionEntryConfig) {
  const registry = getContractRegistry(),
    boundary = createDecisionBoundary(config),
    auth = createFormalCompletionAuthorizationPort(config.formalAuthorization),
    now = config.now ?? (() => new Date());
  async function prepare(
    value: unknown,
    session: InitialContextSession,
    type: string,
    version: string,
    key: string,
    consumer: string,
  ) {
    const envelope = record(structuredClone(value)),
      query = registry.getOperation(type, version)?.kind === 'QUERY';
    if (
      (query ? envelope.queryType : envelope.commandType) !== type ||
      (query ? envelope.queryVersion : envelope.commandVersion) !== version ||
      !registry.validateOperation(type, version, envelope).valid
    )
      entryError('API_VALUE_INVALID', 'Invalid formal completion envelope');
    const payload = record(envelope.payload) as Ref,
      scope = record(envelope.scopeRef),
      payloadHash = payloadHashOf(payload),
      sessionHash = sessionAuthenticationContextHash(session);
    if (typeof scope.enterpriseId !== 'string' || typeof scope.projectId !== 'string')
      entryError('SCOPE_MISMATCH', 'Project Scope required');
    if (query) {
      if (
        envelope.consistencyRequirement !== 'AUTHORITATIVE' ||
        record(record(envelope.authenticationContextRef).contentHash).digest !==
          sessionHash.toString('hex')
      )
        entryError('AUTHORIZATION_DECISION_INVALID', 'Query authentication mismatch');
    } else assertIntegrity(envelope.integrity, payloadHash);
    const decisionRef = decisionReference(envelope.authorizationDecisionRef),
      row = await boundary.readDecisionRow(decisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
    assertActorBinding(query ? envelope.requester : envelope.actor, row);
    assertActorBinding(session.resolutionActorSnapshotRef, row);
    const target = (
      query
        ? (payload.workOrderRef ?? payload.judgmentRef ?? payload.runRef ?? payload.revisionRef)
        : envelope.targetRef
    ) as Common.ObjectRef;
    const deps = boundary.identityDeps(identityContext(row));
    const revalidation = {
      decisionRef,
      expectedCommandType: type,
      expectedCommandVersion: version,
      expectedCommandPayloadHash: payloadHash,
      expectedAuthenticationContextHash: sessionHash,
      expectedTargetRef: target,
    };
    const revalidateOwn = async () => {
      const result = await auth.revalidate(deps, key, revalidation);
      if (!result.valid)
        entryError(
          'AUTHORIZATION_DECISION_INVALID',
          'Formal completion authorization is not current',
        );
    };
    await revalidateOwn();
    const context: TaskExecutionTransactionContext = {
      ...identityContext(row),
      principalKind: row.principal_kind as TaskExecutionTransactionContext['principalKind'],
      policySnapshotId: row.policy_snapshot_id,
      correlationId: String(envelope.correlationId),
    };
    const { ports, revalidateAll, output, bindingPorts } = createFormalCompletionDependencyPorts(
      config,
      row,
      session,
      consumer,
      revalidateOwn,
    );
    const internal: CommandEnvelope = {
      commandId: String(envelope.commandId),
      commandType: type,
      commandVersion: version,
      idempotencyScope: `${type}@${version}:${scope.enterpriseId}:${scope.projectId}`,
      idempotencyKey: String(envelope.idempotencyKey),
      requestPayload: payload,
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
      targetType: target.objectType,
      targetId: target.objectId,
      ...(envelope.expectedAggregateVersion === undefined
        ? {}
        : {
            expectedAggregateVersion: String(
              typeof envelope.expectedAggregateVersion === 'number'
                ? envelope.expectedAggregateVersion
                : typeof envelope.expectedAggregateVersion === 'string'
                  ? envelope.expectedAggregateVersion
                  : '',
            ),
          }),
      correlationId: String(envelope.correlationId),
      ...(typeof envelope.causationId === 'string' ? { causationId: envelope.causationId } : {}),
      principalId: row.principal_id,
      principalKind: context.principalKind,
      actorSnapshotId: row.actor_snapshot_id,
      authorizationDecisionId: row.authorization_decision_id,
      policySnapshotId: row.policy_snapshot_id,
    };
    return {
      payload,
      target,
      context,
      internal,
      ports,
      bindingPorts,
      revalidateAll,
      output,
      row,
      decisionRef,
    };
  }
  return {
    async releaseFormalOutput(
      payload: Ref,
      decisionRef: Common.ContentAddressedRef,
      session: InitialContextSession,
    ) {
      if (!config.driver?.runtime.releaseFormalOutput || Object.keys(payload).length !== 2)
        entryError('API_VALUE_INVALID', 'Formal release unavailable');
      const attemptRef = record(payload.attemptRef) as unknown as Common.ObjectRef;
      const scope = record(attemptRef.scope);
      if (
        record(payload.attemptRef).kind !== 'OBJECT' ||
        attemptRef.objectType !== 'integration.runtime_attempt' ||
        typeof scope.enterpriseId !== 'string' ||
        typeof scope.projectId !== 'string'
      )
        entryError('NOT_FOUND', 'Runtime attempt unavailable');
      const row = await boundary.readDecisionRow(decisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
      assertActorBinding(session.resolutionActorSnapshotRef, row);
      const proof = async () => {
        const current = await auth.revalidate(
          boundary.identityDeps(identityContext(row)),
          'formalOutputReleaseV1',
          {
            decisionRef,
            expectedCommandType: 'integration.runtime.formal_output.release',
            expectedCommandVersion: '1.0',
            expectedCommandPayloadHash: payloadHashOf(payload),
            expectedAuthenticationContextHash: sessionAuthenticationContextHash(session),
            expectedTargetRef: attemptRef,
          },
        );
        if (!current.valid)
          entryError(
            'AUTHORIZATION_DECISION_INVALID',
            'Human output release authorization revoked',
          );
      };
      await proof();
      await config.driver.runtime.releaseFormalOutput(attemptRef, record(payload.output) as Ref, {
        revalidateAuthorization: async () => {
          await proof();
          await config.driver?.ports.revalidateAuthorization();
        },
        readExecutionOutput: config.driver.ports.readExecutionOutput,
      });
      await proof();
    },
    async evaluateWorkOrder(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'execution.evaluate_work_order_completion',
        '2.0',
        'workOrderCompletionEvaluateV2',
        'work_order_completion',
      );
      return handleEvaluateFormalCompletion(config.taskExecutionDb, p.context, p.internal, p.ports);
    },
    async evaluateTask(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'execution.evaluate_task_completion',
        '2.0',
        'taskCompletionEvaluateV2',
        'task_completion',
      );
      return handleEvaluateFormalCompletion(config.taskExecutionDb, p.context, p.internal, p.ports);
    },
    async readWorkOrder(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'execution.get_work_order_state',
        '1.0',
        'workOrderStateReadV1',
        'work_order_state',
      );
      return handleGetFormalWorkOrderState(
        config.taskExecutionDb,
        p.context,
        p.target as unknown as Ref,
        p.ports,
      );
    },
    async readJudgment(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'execution.get_execution_judgment',
        '1.0',
        'completionJudgmentReadV1',
        'judgment_read',
      );
      return handleGetFormalCompletionJudgment(
        config.taskExecutionDb,
        p.context,
        p.target as unknown as Ref,
        p.ports,
      );
    },
    async readBinding(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'execution.get_output_creation_binding',
        '1.0',
        'outputCreationBindingReadV1',
        'output_creation',
      );
      return handleGetOutputCreationBinding(
        config.taskExecutionDb,
        p.context,
        p.target as unknown as Ref,
        config.outputCreationBindingPorts?.(p.context, p.revalidateAll) ?? p.bindingPorts,
      );
    },
    async createRevision(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'artifact.create_execution_revision',
        '1.0',
        'executionRevisionCreateV1',
        'output_creation',
      );
      const internal = { ...p.internal, payload: p.payload } as unknown as RevisionCommandEnvelope<
        Parameters<typeof handleCreateExecutionRevision>[2]['payload']
      >;
      return handleCreateExecutionRevision(config.artifactDb, p.context, internal, {
        now,
        storage: config.artifactStorage,
        revalidateAuthorization: p.revalidateAll,
        actorSnapshotRef: session.resolutionActorSnapshotRef,
        authorizationDecisionRef: p.decisionRef,
        readOutputCreationBinding: config.readOutputCreationBinding,
        revalidateBindingAuthorization: config.revalidateOutputCreationBinding,
      });
    },
    async readOutput(value: unknown, session: InitialContextSession) {
      const p = await prepare(
        value,
        session,
        'artifact.get_execution_output_fact',
        '1.0',
        'executionOutputReadV1',
        'driver_release',
      );
      return handleGetExecutionOutputFact(
        config.artifactDb,
        p.context,
        p.target as unknown as Common.ContentAddressedRef,
        { now, storage: config.artifactStorage, revalidateAuthorization: p.revalidateAll },
      );
    },
  };
}
