import type { Kysely } from 'kysely';
import { ContractRegistry } from '@zhiju/contracts';
import {
  canonicalize,
  hashContractPayload,
  sha256CanonicalJson,
  type CanonicalJsonObject,
  type CanonicalJsonValue,
} from '@zhiju/shared-kernel';
import { executeIdentityCommand, type CommandEnvelope } from '../persistence/command-runner.js';
import {
  withIdentityTransaction,
  type IdentityPolicyDb,
  type IdentityTransaction,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import { policySnapshotIntegrityHolds } from '../persistence/identity-policy-repository.js';
import { isHumanOnlyCapability } from './static-registry.js';

const registry = new ContractRegistry();
const BUNDLE = 'zhiju.identity.execution_capability_bundle';

export interface ExecutionCapabilityBundlePorts {
  readonly now: () => Date;
  readonly revalidateAuthorization: () => Promise<void>;
  readonly readContract: (ref: CanonicalJsonObject) => Promise<{
    contractRef: CanonicalJsonObject;
    workOrderContract: CanonicalJsonObject;
  }>;
  readonly readContext: (ref: CanonicalJsonObject) => Promise<{
    contextSnapshotRef: CanonicalJsonObject;
    projectContextContract: CanonicalJsonObject;
  }>;
  readonly resolveControls: (ref: CanonicalJsonObject) => Promise<{
    policyRef: CanonicalJsonObject;
    useStatus: string;
    supersededAt?: string;
  }>;
  readonly additionalExpiries?: () => readonly string[];
}

function record(value: unknown): CanonicalJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as CanonicalJsonObject;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw invalid();
  return value;
}
function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value);
}
function same(a: unknown, b: unknown) {
  return canonicalize(a as CanonicalJsonValue) === canonicalize(b as CanonicalJsonValue);
}
function invalid(): Error {
  return new Error('execution capability bundle input is invalid');
}
function exactRef(
  value: CanonicalJsonObject,
  kind: string,
  type: string,
  scope: CanonicalJsonObject,
) {
  if (value.kind !== kind || value.objectType !== type || !same(value.scope, scope))
    throw invalid();
  const def =
    kind === 'CONTENT_ADDRESSED'
      ? 'contentAddressedRef'
      : kind === 'SNAPSHOT'
        ? 'snapshotRef'
        : 'objectRef';
  if (
    !registry.validateCoreContract(`https://schemas.zhiju.local/common/1.0#/$defs/${def}`, value)
      .valid
  )
    throw invalid();
}
function digest(value: unknown): string {
  const result = text(record(value).digest);
  if (!/^[0-9a-f]{64}$/u.test(result)) throw invalid();
  return result;
}
function expiry(now: Date, values: readonly (string | Date | null | undefined)[]) {
  const times = values
    .filter((value) => value !== null && value !== undefined)
    .map((value) => (value instanceof Date ? value.getTime() : Date.parse(value)));
  if (times.length === 0 || times.some((value) => !Number.isFinite(value))) throw invalid();
  const result = Math.min(...times);
  if (result <= now.getTime()) throw invalid();
  return new Date(result);
}
function scopeOf(envelope: CommandEnvelope) {
  if (envelope.projectId === undefined) throw invalid();
  return { enterpriseId: envelope.enterpriseId, projectId: envelope.projectId };
}
function grantRef(id: string, scope: CanonicalJsonObject) {
  return { kind: 'OBJECT', objectType: 'identity.capability_grant', objectId: id, scope };
}
function policyRef(id: string, hash: Buffer) {
  return {
    kind: 'SNAPSHOT',
    objectType: 'identity.policy_snapshot',
    objectId: id,
    snapshotId: id,
    scope: {},
    contentHash: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: hash.toString('hex'),
    },
  };
}

function grantCovers(
  capability: CanonicalJsonObject,
  row: {
    readonly capability_code: string;
    readonly actions: readonly string[];
    readonly resource_selectors: unknown;
    readonly constraints: unknown;
    readonly max_uses: number | null;
  },
): boolean {
  const actions = capability.actions;
  const selectors = capability.resourceSelectors;
  const grantSelectors = row.resource_selectors;
  if (
    !Array.isArray(actions) ||
    !Array.isArray(selectors) ||
    actions.length === 0 ||
    selectors.length === 0 ||
    !Array.isArray(grantSelectors) ||
    row.capability_code !== capability.capabilityType ||
    !same(row.constraints, {}) ||
    row.max_uses !== null
  )
    return false;
  return actions.every(
    (action) =>
      (action === 'read' || action === 'create') &&
      row.actions.includes(action as string) &&
      selectors.every(
        (selector) =>
          typeof selector === 'string' &&
          grantSelectors.some((candidate) => {
            const value = record(candidate);
            return (
              Object.keys(value).length === 2 &&
              value.selectorType === (action === 'create' ? 'CREATE_TARGET_TYPE' : 'TARGET_TYPE') &&
              value.objectType === selector
            );
          }),
      ),
  );
}

async function currentGrant(
  trx: IdentityTransaction,
  context: IdentityTransactionContext,
  capability: CanonicalJsonObject,
  at: Date,
) {
  const rows = await trx
    .selectFrom('identity_policy.capability_grant')
    .selectAll()
    .where('principal_id', '=', context.principalId)
    .where('enterprise_id', '=', context.enterpriseId)
    .where('project_id', '=', context.allowedProjectIds[0] ?? '')
    .where('scope_kind', '=', 'PROJECT')
    .where('capability_code', '=', text(capability.capabilityType))
    .where('status', '=', 'ACTIVE')
    .where('valid_from', '<=', at)
    .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', at)]))
    .orderBy('id')
    .execute();
  const actions = capability.actions;
  const selectors = capability.resourceSelectors;
  if (
    !Array.isArray(actions) ||
    actions.length === 0 ||
    !Array.isArray(selectors) ||
    selectors.length === 0 ||
    !Array.isArray(capability.constraints) ||
    capability.constraints.length !== 0 ||
    capability.maxUses !== undefined ||
    isHumanOnlyCapability(text(capability.capabilityType))
  )
    throw invalid();
  for (const row of rows) {
    if (!grantCovers(capability, row)) continue;
    const policy = await trx
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', row.grant_policy_snapshot_id)
      .executeTakeFirst();
    if (
      policy === undefined ||
      !policySnapshotIntegrityHolds(policy) ||
      !policy.payload_hash.equals(row.grant_policy_snapshot_hash) ||
      policy.effective_from.getTime() > at.getTime() ||
      (policy.superseded_at != null && policy.superseded_at.getTime() <= at.getTime())
    )
      continue;
    return { grant: row, policy };
  }
  throw invalid();
}

function denied(capability: CanonicalJsonObject, denies: readonly unknown[]) {
  const actions = capability.actions;
  const selectors = capability.resourceSelectors;
  if (!Array.isArray(actions) || !Array.isArray(selectors)) throw invalid();
  return denies.some((value) => {
    const candidate = record(value);
    const deniedActions = candidate.actions;
    const deniedSelectors = candidate.resourceSelectors;
    return (
      candidate.capabilityType === capability.capabilityType &&
      Array.isArray(deniedActions) &&
      deniedActions.some((action) => actions.some((allowed) => allowed === action)) &&
      Array.isArray(deniedSelectors) &&
      deniedSelectors.some((selector) => selectors.some((allowed) => allowed === selector))
    );
  });
}

export async function issueExecutionCapabilityBundle(
  db: Kysely<IdentityPolicyDb>,
  context: IdentityTransactionContext,
  envelope: CommandEnvelope,
  ports: ExecutionCapabilityBundlePorts,
) {
  if (
    envelope.commandType !== 'identity.issue_execution_capability_bundle' ||
    envelope.commandVersion !== '1.0' ||
    envelope.targetType !== BUNDLE ||
    envelope.platform ||
    context.allowedProjectIds.length !== 1 ||
    !registry.validateOperation(envelope.commandType, '1.0', {
      commandId: envelope.commandId,
      commandType: envelope.commandType,
      commandVersion: envelope.commandVersion,
      scopeRef: scopeOf(envelope),
      targetRef: {
        kind: 'OBJECT',
        objectType: BUNDLE,
        objectId: envelope.targetId,
        scope: scopeOf(envelope),
      },
      actor: {
        kind: 'OBJECT',
        objectType: 'identity.principal',
        objectId: envelope.principalId,
        scope: { enterpriseId: envelope.enterpriseId },
      },
      authorizationDecisionRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'identity.authorization_decision',
        objectId: envelope.authorizationDecisionId,
        scope: scopeOf(envelope),
        contentHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: context.authorizationDecisionHash.toString('hex'),
        },
      },
      idempotencyKey: envelope.idempotencyKey,
      correlationId: envelope.correlationId,
      ...(envelope.causationId === undefined ? {} : { causationId: envelope.causationId }),
      requestedAt: ports.now().toISOString(),
      payload: envelope.requestPayload,
      integrity: {
        canonicalizationVersion: '1',
        payloadHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: sha256CanonicalJson(envelope.requestPayload),
        },
      },
    }).valid
  )
    throw invalid();
  const request = envelope.requestPayload,
    subjectScope = scopeOf(envelope);
  const runRef = record(request.runRef),
    workOrderRef = record(request.workOrderRef);
  const contractRef = record(request.workOrderContractRef),
    contextRef = record(request.contextSnapshotRef);
  const serviceRef = record(request.servicePrincipalRef);
  exactRef(runRef, 'OBJECT', 'execution.run', subjectScope);
  exactRef(workOrderRef, 'OBJECT', 'zhiju.execution.work_order', subjectScope);
  exactRef(contractRef, 'CONTENT_ADDRESSED', 'zhiju.contract.work_order', subjectScope);
  exactRef(contextRef, 'SNAPSHOT', 'zhiju.execution.context_snapshot', subjectScope);
  if (
    serviceRef.principalKind !== 'SERVICE' ||
    serviceRef.principalId !== context.principalId ||
    envelope.principalId !== context.principalId
  )
    throw invalid();
  const guard = ports.revalidateAuthorization;
  await guard();
  return executeIdentityCommand(
    db,
    context,
    envelope,
    async (execution) => {
      const principal = await execution.trx
        .selectFrom('identity_policy.principal')
        .selectAll()
        .where('id', '=', context.principalId)
        .executeTakeFirst();
      if (principal?.principal_kind !== 'SERVICE' || principal.status !== 'ACTIVE') throw invalid();
      const contractView = await ports.readContract(workOrderRef);
      const contract = contractView.workOrderContract;
      if (
        !same(contractView.contractRef, contractRef) ||
        !same(contract.workOrderRef, workOrderRef) ||
        !same(contract.contextSnapshotRef, contextRef) ||
        hashContractPayload(contract) !== digest(contractRef.contentHash)
      )
        throw invalid();
      const contextView = await ports.readContext(contextRef);
      if (!same(contextView.contextSnapshotRef, contextRef)) throw invalid();
      const controlsRef = record(record(contract.versionPins).capabilityPolicyRef);
      const controls = await ports.resolveControls(controlsRef);
      if (controls.useStatus !== 'USABLE' || !same(controls.policyRef, controlsRef))
        throw invalid();
      const requested = request.requestedCapabilities;
      const allowed = contract.allowedCapabilities,
        denies = contract.deniedCapabilities;
      if (
        !Array.isArray(requested) ||
        requested.length === 0 ||
        !Array.isArray(allowed) ||
        !Array.isArray(denies)
      )
        throw invalid();
      const at = ports.now(),
        observations: CanonicalJsonObject[] = [];
      const expiries: (string | Date | undefined | null)[] = [
        context.authorizationDecisionExpiresAt,
        optionalText(contract.expiresAt),
        optionalText(record(contextView.projectContextContract).expiresAt),
        controls.supersededAt,
        ...(ports.additionalExpiries?.() ?? []),
      ];
      for (const value of requested) {
        const capability = record(value);
        if (
          !allowed.some((candidate) => same(candidate, capability)) ||
          denied(capability, denies) ||
          !same(capability.grantPolicyRef, controlsRef)
        )
          throw invalid();
        const found = await currentGrant(execution.trx, context, capability, at);
        expiries.push(
          optionalText(capability.expiresAt),
          found.grant.valid_to,
          found.policy.superseded_at,
        );
        observations.push({
          capability,
          grantRef: grantRef(found.grant.id, subjectScope),
          policySnapshotRef: policyRef(found.policy.policy_snapshot_id, found.policy.payload_hash),
          grantValidFrom: found.grant.valid_from.toISOString(),
          ...(found.grant.valid_to === null
            ? {}
            : { grantValidTo: found.grant.valid_to.toISOString() }),
          policyEffectiveFrom: found.policy.effective_from.toISOString(),
          ...(found.policy.superseded_at == null
            ? {}
            : {
                policySupersededAt: found.policy.superseded_at.toISOString(),
              }),
        });
      }
      observations.sort((a, b) =>
        Buffer.compare(Buffer.from(canonicalize(a)), Buffer.from(canonicalize(b))),
      );
      const validUntil = expiry(at, expiries);
      await guard();
      const payload: CanonicalJsonObject = {
        runRef,
        workOrderRef,
        workOrderContractRef: contractRef,
        contextSnapshotRef: contextRef,
        servicePrincipalRef: serviceRef,
        capabilities: requested as CanonicalJsonValue,
        grantObservations: observations,
        issuedDecisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'identity.authorization_decision',
          objectId: context.authorizationDecisionId,
          scope: subjectScope,
          contentHash: {
            algorithm: 'SHA-256',
            canonicalizationVersion: '1',
            digest: context.authorizationDecisionHash.toString('hex'),
          },
        },
        issuedAt: at.toISOString(),
        validUntil: validUntil.toISOString(),
      };
      const payloadHash = sha256CanonicalJson(payload);
      await execution.trx
        .insertInto('identity_policy.execution_capability_bundle')
        .values({
          bundle_id: envelope.targetId,
          enterprise_id: envelope.enterpriseId,
          project_id: subjectScope.projectId,
          run_id: text(runRef.objectId),
          work_order_id: text(workOrderRef.objectId),
          contract_id: text(contractRef.objectId),
          contract_hash: Buffer.from(digest(contractRef.contentHash), 'hex'),
          context_snapshot_id: text(contextRef.snapshotId),
          context_hash: Buffer.from(digest(contextRef.contentHash), 'hex'),
          service_principal_id: context.principalId,
          canonical_payload: canonicalize(payload),
          payload_hash: Buffer.from(payloadHash, 'hex'),
          issued_at: at,
          valid_until: validUntil,
          source_command_id: envelope.commandId,
          created_by_principal_id: context.principalId,
        })
        .execute();
      const targets = [
        runRef,
        workOrderRef,
        contractRef,
        contextRef,
        ...observations.flatMap((o) => [record(o.grantRef), record(o.policySnapshotRef)]),
      ];
      for (const [index, target] of targets.entries()) {
        await execution.trx
          .insertInto('identity_policy.reference_edge')
          .values({
            owner_object_type: BUNDLE,
            owner_object_id: envelope.targetId,
            owner_payload_hash: Buffer.from(payloadHash, 'hex'),
            reference_path: `/bundle/${index}`,
            target_module:
              target.objectType === 'execution.run' ||
              target.objectType === 'zhiju.execution.work_order' ||
              target.objectType === 'zhiju.contract.work_order' ||
              target.objectType === 'zhiju.execution.context_snapshot'
                ? 'task-execution'
                : 'identity-policy',
            target_object_type: text(target.objectType),
            target_object_id: text(target.objectId),
            target_payload_hash:
              target.contentHash === undefined
                ? null
                : Buffer.from(digest(target.contentHash), 'hex'),
            reference_purpose: 'EXECUTION_CAPABILITY_BUNDLE',
            enterprise_id: envelope.enterpriseId,
            project_id: subjectScope.projectId,
            source_command_id: envelope.commandId,
          })
          .execute();
      }
      const bundleRef = {
        kind: 'CONTENT_ADDRESSED',
        objectType: BUNDLE,
        objectId: envelope.targetId,
        scope: subjectScope,
        contentHash: { algorithm: 'SHA-256', canonicalizationVersion: '1', digest: payloadHash },
      };
      const result = { bundleRef };
      if (!registry.validateOperationResult(envelope.commandType, '1.0', result).valid)
        throw invalid();
      return { kind: 'COMMITTED', resultPayload: result };
    },
    guard,
  );
}

async function revalidateObservations(
  trx: IdentityTransaction,
  payload: CanonicalJsonObject,
  at: Date,
) {
  const observations = payload.grantObservations;
  if (!Array.isArray(observations) || observations.length === 0) throw invalid();
  for (const value of observations) {
    const observation = record(value),
      grant = record(observation.grantRef);
    const policyRefValue = record(observation.policySnapshotRef);
    const row = await trx
      .selectFrom('identity_policy.capability_grant')
      .selectAll()
      .where('id', '=', text(grant.objectId))
      .executeTakeFirst();
    if (
      row?.status !== 'ACTIVE' ||
      row.valid_from.getTime() > at.getTime() ||
      (row.valid_to !== null && row.valid_to.getTime() <= at.getTime()) ||
      row.principal_id !== text(record(payload.servicePrincipalRef).principalId) ||
      row.enterprise_id !== record(record(payload.runRef).scope).enterpriseId ||
      row.project_id !== record(record(payload.runRef).scope).projectId ||
      !same(grant, grantRef(row.id, record(record(payload.runRef).scope))) ||
      !grantCovers(record(observation.capability), row)
    )
      throw invalid();
    const policy = await trx
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', text(policyRefValue.snapshotId))
      .executeTakeFirst();
    if (
      policy === undefined ||
      !policySnapshotIntegrityHolds(policy) ||
      !policy.payload_hash.equals(row.grant_policy_snapshot_hash) ||
      policy.effective_from.getTime() > at.getTime() ||
      !same(policyRefValue, policyRef(policy.policy_snapshot_id, policy.payload_hash)) ||
      (policy.superseded_at != null && policy.superseded_at.getTime() <= at.getTime())
    )
      throw invalid();
  }
}

export async function readExecutionCapabilityBundle(
  db: Kysely<IdentityPolicyDb>,
  context: IdentityTransactionContext,
  bundleRef: CanonicalJsonObject,
  runRef: CanonicalJsonObject,
  revalidateAuthorization: () => Promise<void>,
  now: () => Date,
) {
  await revalidateAuthorization();
  const subjectScope = record(bundleRef.scope);
  exactRef(bundleRef, 'CONTENT_ADDRESSED', BUNDLE, subjectScope);
  exactRef(runRef, 'OBJECT', 'execution.run', subjectScope);
  return withIdentityTransaction(db, context, async (trx) => {
    const row = await trx
      .selectFrom('identity_policy.execution_capability_bundle')
      .selectAll()
      .where('bundle_id', '=', text(bundleRef.objectId))
      .executeTakeFirst();
    if (
      row === undefined ||
      row.enterprise_id !== subjectScope.enterpriseId ||
      row.project_id !== subjectScope.projectId ||
      row.run_id !== runRef.objectId ||
      row.payload_hash.toString('hex') !== digest(bundleRef.contentHash) ||
      row.payload_hash.toString('hex') !== sha256CanonicalJson(record(row.canonical_payload)) ||
      now().getTime() >= row.valid_until.getTime()
    )
      throw invalid();
    const payload = record(row.canonical_payload);
    if (
      !same(payload.runRef, runRef) ||
      record(payload.servicePrincipalRef).principalId !== row.service_principal_id
    )
      throw invalid();
    await revalidateObservations(trx, payload, now());
    await revalidateAuthorization();
    return { bundleRef, payload, useStatus: 'USABLE' as const };
  });
}
