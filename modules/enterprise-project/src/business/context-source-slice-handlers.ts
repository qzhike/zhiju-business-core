// IM-06 (#188): ContextSourceSlice capture and authorized read.
//
// `project.capture_context_source_slice@1.0` persists one immutable,
// content-addressed capture of the Project's committed owning facts, bound to
// the exact IdentityPolicy-committed capture Policy version and to a validity
// window derived from the trusted clock and the pinned authorization decision.
// `project.get_context_source_slice@1.0` dereferences that exact capture and
// reports the current `useStatus`, re-verifying the exact reference, Scope,
// purpose, audience and Policy lifecycle at read time.
//
// Authorization never degrades to "the caller is a Service": both entries
// require the trusted transaction context to pin the registered
// authorization purpose of the operation, and the capture Policy is only
// consumed through the IdentityPolicy resolution Port.

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { getContractRegistry, type Common, type EnterpriseProject } from '@zhiju/contracts';
import { isUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  digestCanonicalPayload,
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransaction,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import {
  CommandExecutionError,
  COMMAND_TARGET_MISMATCH,
  executeEnterpriseProjectCommand,
  type CommandBodyResult,
  type CommandEnvelope,
  type CommandResult,
} from '../persistence/command-runner.js';
import {
  ContextSourceSliceRepository,
  type ContextSourceSliceInsert,
} from '../persistence/context-source-slice-repository.js';
import {
  assembleProjectContextSourceSlice,
  validateRequestedKinds,
  validateSourceSlicePurpose,
  type SourceKind,
} from './source-slice-assembly.js';
import {
  DEPENDENCY_UNAVAILABLE,
  resolveCapturePolicy,
  type CapturePolicyResolutionPort,
  type ResolvedCapturePolicy,
} from './context-source-slice-policy.js';
import {
  EnterpriseBusinessError,
  PROJECT_CAPTURE_POLICY_NOT_USABLE,
  PROJECT_CAPTURE_POLICY_UNSUPPORTED,
  PROJECT_CAPTURE_PURPOSE_FORBIDDEN,
  PROJECT_CAPTURE_RESULT_INVALID,
  PROJECT_CAPTURE_SLICE_ALREADY_EXISTS,
  PROJECT_CAPTURE_VALIDITY_INVALID,
  PROJECT_QUERY_AUDIENCE_INVALID,
  PROJECT_QUERY_CONTEXT_EXPIRED,
  PROJECT_QUERY_NOT_FOUND,
  PROJECT_QUERY_REF_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH,
} from './enterprise-business-errors.js';

const repo = new ContextSourceSliceRepository();
const CONTRACT_REGISTRY = getContractRegistry();

/**
 * Canonical public object names of the Project source references. The captured
 * Slice is published under the registered `ContextSourceSlice` contract, whose
 * `namespaceCode` object types use the `zhiju.project.*` spellings established
 * by the Core Project Context contract; the frozen dynamic
 * `get_project_context_source@1.0` view keeps its legacy spellings unchanged.
 */
const CANONICAL_SOURCE_OBJECT_TYPES: Readonly<Record<string, string>> = {
  Project: 'zhiju.project.project',
  EnterpriseProfileSnapshot: 'zhiju.project.enterprise_profile',
  QMSConfiguration: 'zhiju.project.qms_configuration',
  ProductScopeSnapshot: 'zhiju.project.product_scope',
  CustomerBaseline: 'zhiju.project.customer_baseline',
  TemplateBaseline: 'zhiju.project.template_baseline',
  RegulatoryProfile: 'zhiju.project.regulatory_profile',
  GapAnalysis: 'zhiju.project.gap_analysis',
  DeliveryPlan: 'zhiju.project.delivery_plan',
};

function canonicalSourceReference<TReference extends Common.TypedReference>(
  reference: TReference,
): TReference {
  if (!('objectType' in reference)) return reference;
  const canonical = CANONICAL_SOURCE_OBJECT_TYPES[reference.objectType];
  return canonical === undefined ? reference : { ...reference, objectType: canonical };
}

/**
 * Renames the schema-constrained references of the assembled source slice to
 * their canonical public object names. The facts, trimming and hashes are
 * exactly the owning assembly's; only the published object spelling changes.
 */
function canonicalSourceSlice(
  source: EnterpriseProject.ProjectContextSourceSlice,
): EnterpriseProject.ProjectContextSourceSlice {
  return {
    ...source,
    projectRef: canonicalSourceReference(source.projectRef),
    enterpriseProfileSnapshotRef: canonicalSourceReference(source.enterpriseProfileSnapshotRef),
    qmsConfigurationRef: canonicalSourceReference(source.qmsConfigurationRef),
    productScopeSnapshotRef: canonicalSourceReference(source.productScopeSnapshotRef),
    activeBaselineRefs: source.activeBaselineRefs.map((reference) =>
      canonicalSourceReference(reference),
    ),
  };
}

export const CAPTURE_CONTEXT_SOURCE_SLICE_COMMAND = 'project.capture_context_source_slice';
export const GET_CONTEXT_SOURCE_SLICE_QUERY = 'project.get_context_source_slice';
export const CAPTURE_CONTEXT_SOURCE_SLICE_PURPOSE = 'project.context_source.capture';
export const GET_CONTEXT_SOURCE_SLICE_PURPOSE = 'project.context_source.read';
export const CAPTURE_CONTEXT_SOURCE_SLICE_IDEMPOTENCY_SCOPE =
  'enterprise_project:capture_context_source_slice';
/** Shared API reason code for a pinned Decision that does not cover the entry. */
export const AUTHORIZATION_DECISION_INVALID = 'AUTHORIZATION_DECISION_INVALID';
export const CONTEXT_SOURCE_SLICE_OBJECT_TYPE = 'zhiju.project.context_source_slice';
/** Internal command target type of the Slice CREATE identity. */
export const CONTEXT_SOURCE_SLICE_TARGET = 'ContextSourceSlice';
export const PROJECT_OBJECT_TYPE = 'zhiju.project.project';
const POLICY_OBJECT_TYPE = 'zhiju.identity.policy';

export interface ContextSourceSliceHandlerDeps {
  /** IdentityPolicy-backed resolution Port; the capture Policy is never guessed. */
  readonly policyResolution: CapturePolicyResolutionPort;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
}

export type CaptureContextSourceSliceCommandPayload =
  EnterpriseProject.ProjectCaptureContextSourceSlicePayload;
export type GetContextSourceSliceQueryPayload =
  EnterpriseProject.ProjectGetContextSourceSlicePayload;

function sliceError(code: string, message: string): never {
  throw new EnterpriseBusinessError(code, message);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function hasUuidV7(value: unknown): value is string {
  return typeof value === 'string' && isUuidV7(value);
}

function contentHashFromDigest(digest: string): Common.ContentHash {
  return { algorithm: 'SHA-256', digest, canonicalizationVersion: '1' };
}

/**
 * Registered purpose gate: the pinned Decision must have been issued for the
 * registered authorization purpose of this entry. A Service principal without
 * that purpose is rejected exactly like any other unauthorized caller.
 */
function requireRegisteredPurpose(
  context: EnterpriseProjectTransactionContext,
  purpose: string,
): void {
  if (context.authorizationPurposes?.includes(purpose) !== true) {
    sliceError(
      AUTHORIZATION_DECISION_INVALID,
      'the pinned authorization decision does not cover this operation',
    );
  }
}

function captureProjectScope(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope,
): string {
  const ref = record(value);
  const scope = record(ref.scope);
  const projectId = ref.objectId;
  if (ref.kind !== 'OBJECT' || ref.objectType !== PROJECT_OBJECT_TYPE || !hasUuidV7(projectId)) {
    sliceError(
      PROJECT_QUERY_REF_INVALID,
      `projectRef must be an exact ${PROJECT_OBJECT_TYPE} ObjectRef`,
    );
  }
  if (
    scope.enterpriseId !== context.enterpriseId ||
    scope.projectId !== projectId ||
    !context.allowedProjectIds.includes(projectId) ||
    (envelope.projectId !== undefined && envelope.projectId !== projectId)
  ) {
    sliceError(PROJECT_QUERY_SCOPE_MISMATCH, 'projectRef is outside the trusted Project scope');
  }
  return projectId;
}

/**
 * The slice audience is the exact trusted Principal of the capture, in the
 * shared PrincipalRef shape: a capture can never mint a Slice for another
 * principal, and the read path re-checks the same binding.
 */
function captureAudience(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
): Common.PrincipalRef {
  const audience = record(value);
  if (
    !hasUuidV7(audience.principalId) ||
    audience.principalKind !== context.principalKind ||
    audience.principalId !== context.principalId
  ) {
    sliceError(
      PROJECT_QUERY_AUDIENCE_INVALID,
      'audience must identify the trusted Principal of this capture exactly',
    );
  }
  return {
    principalKind: context.principalKind,
    principalId: context.principalId,
  };
}

/**
 * Exact `VersionedRef<Policy>` version key inside the capture scope. The key is
 * never normalized, never resolved as latest/current and never narrowed to the
 * Project: an Enterprise-scoped policy may bound a Project capture only when
 * its Scope is the capture Enterprise.
 */
function capturePolicyKey(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
  projectId: string,
): Common.VersionedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  if (
    ref.kind !== 'VERSIONED' ||
    ref.objectType !== POLICY_OBJECT_TYPE ||
    !hasUuidV7(ref.objectId) ||
    !hasUuidV7(ref.versionId)
  ) {
    sliceError(
      PROJECT_CAPTURE_POLICY_UNSUPPORTED,
      `capturePolicyRef must be an exact ${POLICY_OBJECT_TYPE} version key`,
    );
  }
  if (
    scope.enterpriseId !== context.enterpriseId ||
    (scope.projectId !== undefined && scope.projectId !== projectId)
  ) {
    sliceError(PROJECT_QUERY_SCOPE_MISMATCH, 'capturePolicyRef is outside the capture scope');
  }
  return {
    kind: 'VERSIONED',
    objectType: POLICY_OBJECT_TYPE,
    objectId: ref.objectId,
    versionId: ref.versionId,
    scope:
      scope.projectId === undefined
        ? { enterpriseId: context.enterpriseId }
        : { enterpriseId: context.enterpriseId, projectId: scope.projectId },
  };
}

function sliceRef(
  value: unknown,
  context: EnterpriseProjectTransactionContext,
): Common.ContentAddressedRef {
  const ref = record(value);
  const scope = record(ref.scope);
  const scopeProjectId = scope.projectId;
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== CONTEXT_SOURCE_SLICE_OBJECT_TYPE ||
    !hasUuidV7(ref.objectId) ||
    (scopeProjectId !== undefined && !hasUuidV7(scopeProjectId))
  ) {
    sliceError(PROJECT_QUERY_REF_INVALID, 'sourceSliceRef must be an exact Slice content address');
  }
  if (
    scope.enterpriseId !== context.enterpriseId ||
    (scopeProjectId !== undefined && !context.allowedProjectIds.includes(scopeProjectId))
  ) {
    sliceError(PROJECT_QUERY_SCOPE_MISMATCH, 'sourceSliceRef is outside the trusted scope');
  }
  const contentHash = record(ref.contentHash);
  if (
    contentHash.algorithm !== 'SHA-256' ||
    contentHash.canonicalizationVersion !== '1' ||
    typeof contentHash.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(contentHash.digest)
  ) {
    sliceError(PROJECT_QUERY_REF_INVALID, 'sourceSliceRef must carry an exact content hash');
  }
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
    objectId: ref.objectId,
    scope:
      scopeProjectId === undefined
        ? { enterpriseId: context.enterpriseId }
        : { enterpriseId: context.enterpriseId, projectId: scopeProjectId },
    contentHash: contentHashFromDigest(contentHash.digest),
  };
}

/**
 * The registered Command is a `ContextSourceSlice / CREATE`: the Envelope's
 * `targetRef` is the pre-allocated Slice identity. The owning entry keeps that
 * identity (request target = committed Slice = returned Ref) and refuses a
 * mismatched target type, a missing id or a CREATE command that carries an
 * expected aggregate version instead of silently rewriting it.
 */
function captureTargetIdentity(envelope: CommandEnvelope): string {
  if (
    envelope.targetType !== CONTEXT_SOURCE_SLICE_TARGET ||
    !hasUuidV7(envelope.targetId) ||
    envelope.expectedAggregateVersion !== undefined
  ) {
    throw new CommandExecutionError(
      COMMAND_TARGET_MISMATCH,
      'capture must target the pre-allocated ContextSourceSlice identity without an expected aggregate version',
    );
  }
  return envelope.targetId;
}

interface CaptureValidity {
  readonly capturedAt: Date;
  readonly validUntil: Date;
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: unknown; constraint?: unknown } | null;
  return candidate?.code === '23505' && candidate.constraint === constraint;
}

/**
 * Appends the Slice behind a savepoint: a PostgreSQL unique violation aborts the
 * enclosing transaction, so a repeated CREATE target identity is rolled back to
 * the savepoint and reported as a stable conflict instead of leaking `23505`,
 * leaving the transaction usable for the rejection receipt and audit.
 */
async function insertContextSourceSliceGuarded(
  trx: EnterpriseProjectTransaction,
  insert: ContextSourceSliceInsert,
): Promise<CommandBodyResult | null> {
  await sql.raw('SAVEPOINT context_source_slice_insert').execute(trx);
  try {
    await repo.insertContextSourceSlice(trx, insert);
    await sql.raw('RELEASE SAVEPOINT context_source_slice_insert').execute(trx);
    return null;
  } catch (error) {
    const conflict =
      isUniqueViolation(error, 'context_source_slice_pkey') ||
      isUniqueViolation(error, 'context_source_slice_scope_unique')
        ? ({
            kind: 'REJECTED',
            errorCode: PROJECT_CAPTURE_SLICE_ALREADY_EXISTS,
            safeSummary: 'the pre-allocated Slice identity already has a committed capture',
          } as const)
        : null;
    if (conflict === null) throw error;
    await sql.raw('ROLLBACK TO SAVEPOINT context_source_slice_insert').execute(trx);
    await sql.raw('RELEASE SAVEPOINT context_source_slice_insert').execute(trx);
    return conflict;
  }
}

/**
 * `validUntil = min(capturedAt + maxSliceValiditySeconds,
 * authorizationDecision.expiresAt)`. There is no default TTL and no
 * caller-provided bound: a window that is not strictly positive at capture or
 * at commit refuses the capture instead of publishing an unusable Slice.
 */
function captureValidity(
  policy: ResolvedCapturePolicy,
  capturedAt: Date,
  decisionExpiresAt: Date,
): CaptureValidity | undefined {
  const validUntil = new Date(
    Math.min(
      capturedAt.getTime() + policy.rules.maxSliceValiditySeconds * 1000,
      decisionExpiresAt.getTime(),
    ),
  );
  return validUntil.getTime() <= capturedAt.getTime() ? undefined : { capturedAt, validUntil };
}

/**
 * `project.capture_context_source_slice@1.0`: capture the Project's committed
 * owning facts into one immutable Slice. The Policy observation, the Slice
 * payload and the technical Receipt/Audit/Reference facts commit in one
 * EnterpriseProject transaction; a Policy that is unresolved, not usable,
 * unsupported by the owning profile, or that does not allow the requested
 * purpose refuses the capture.
 */
export async function handleCaptureContextSourceSlice(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  envelope: CommandEnvelope & { payload: CaptureContextSourceSliceCommandPayload },
  deps: ContextSourceSliceHandlerDeps,
): Promise<CommandResult> {
  const now = deps.now ?? ((): Date => new Date());
  requireRegisteredPurpose(context, CAPTURE_CONTEXT_SOURCE_SLICE_PURPOSE);
  const projectId = captureProjectScope(envelope.payload.projectRef, context, envelope);
  const audience = captureAudience(envelope.payload.audience, context);
  validateSourceSlicePurpose(envelope.payload.purpose);
  const requestedKinds: ReadonlySet<SourceKind> = validateRequestedKinds(
    envelope.payload.requestedKinds,
  );
  const policyKey = capturePolicyKey(envelope.payload.capturePolicyRef, context, projectId);
  const sliceId = captureTargetIdentity(envelope);
  const normalizedEnvelope: CommandEnvelope = {
    ...envelope,
    projectId,
    targetType: 'ContextSourceSlice',
    targetId: sliceId,
  };

  return executeEnterpriseProjectCommand(db, context, normalizedEnvelope, async (execution) => {
    const resolution = await resolveCapturePolicy(deps.policyResolution, {
      policyRef: policyKey,
      asOf: now(),
      correlationId: envelope.correlationId,
    });
    if (resolution.kind === 'UNAVAILABLE') {
      throw new CommandExecutionError(
        DEPENDENCY_UNAVAILABLE,
        'capture policy resolution is unavailable',
      );
    }
    if (resolution.kind === 'UNSUPPORTED') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_CAPTURE_POLICY_UNSUPPORTED,
        safeSummary: 'the capture policy version is not a supported resolved capture policy',
      };
    }
    if (resolution.kind === 'NOT_USABLE') {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_CAPTURE_POLICY_NOT_USABLE,
        safeSummary: 'the capture policy version is not usable at capture time',
      };
    }
    if (!resolution.policy.rules.allowedPurposeCodes.includes(envelope.payload.purpose)) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_CAPTURE_PURPOSE_FORBIDDEN,
        safeSummary: 'the capture policy does not allow the requested purpose',
      };
    }
    const validity = captureValidity(
      resolution.policy,
      now(),
      context.authorizationDecisionExpiresAt,
    );
    if (validity === undefined) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_CAPTURE_VALIDITY_INVALID,
        safeSummary: 'the derived Slice validity window is not positive',
      };
    }
    const { capturedAt, validUntil } = validity;
    let source: EnterpriseProject.ProjectContextSourceSlice;
    try {
      source = canonicalSourceSlice(
        await assembleProjectContextSourceSlice(
          execution.trx,
          { enterpriseId: context.enterpriseId, projectId },
          { purpose: envelope.payload.purpose, requestedKinds, asOf: capturedAt },
        ),
      );
    } catch (error) {
      if (!(error instanceof EnterpriseBusinessError)) throw error;
      return {
        kind: 'REJECTED',
        errorCode: error.code,
        safeSummary: 'the Project source slice could not be assembled from committed facts',
      };
    }
    if (validUntil.getTime() <= now().getTime()) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_CAPTURE_VALIDITY_INVALID,
        safeSummary: 'the Slice validity window closed before the capture could commit',
      };
    }
    const slicePayload = {
      sliceId,
      scopeRef: { enterpriseId: context.enterpriseId, projectId },
      projectRef: {
        kind: 'OBJECT',
        objectType: PROJECT_OBJECT_TYPE,
        objectId: projectId,
        scope: { enterpriseId: context.enterpriseId, projectId },
      },
      purpose: envelope.payload.purpose,
      audience,
      capturePolicyRef: policyKey,
      capturedAt: capturedAt.toISOString(),
      validUntil: validUntil.toISOString(),
      source,
    } as unknown as CanonicalJsonObject;
    // The captured Slice must already be returnable as the registered read
    // Result: the owning assembly can exceed the registered Guard budgets (for
    // example one redaction pair per Enterprise Fact), and a Slice that cannot
    // be dereferenced must never be committed.
    const candidate = CONTRACT_REGISTRY.validateOperationResult(
      GET_CONTEXT_SOURCE_SLICE_QUERY,
      '1.0',
      { slice: slicePayload, useStatus: 'USABLE', checkedAt: capturedAt.toISOString() },
    );
    if (!candidate.valid) {
      return {
        kind: 'REJECTED',
        errorCode: PROJECT_CAPTURE_RESULT_INVALID,
        safeSummary:
          'the assembled Slice cannot be returned as a registered ContextSourceSlice result',
      };
    }
    const sliceHash = digestCanonicalPayload(slicePayload).hash;
    const rejectedInsert = await insertContextSourceSliceGuarded(execution.trx, {
      sliceId,
      enterpriseId: context.enterpriseId,
      projectId,
      purpose: envelope.payload.purpose,
      audienceRef: audience,
      capturePolicyRef: policyKey,
      capturedAt,
      validUntil,
      slicePayload,
      slicePayloadHash: sliceHash,
      policyVersionRef: resolution.policy.policyVersionRef,
      policySetVersion: resolution.policy.observation.policySetVersion,
      policyContentHash: resolution.policy.contentHash,
      policyEffectiveFrom: new Date(resolution.policy.observation.effectiveFrom),
      ...(resolution.policy.observation.supersededAt === undefined
        ? {}
        : { policySupersededAt: new Date(resolution.policy.observation.supersededAt) }),
      policyCheckedAt: new Date(resolution.policy.observation.checkedAt),
      createdByPrincipalId: envelope.principalId,
      createdByActorSnapshotId: envelope.actorSnapshotId,
      authorizationDecisionId: envelope.authorizationDecisionId,
      sourceCommandId: envelope.commandId,
    });
    if (rejectedInsert !== null) return rejectedInsert;
    await execution.appendReferenceEdge({
      ownerObjectType: 'ContextSourceSlice',
      ownerObjectId: sliceId,
      ownerPayloadHash: sliceHash,
      referencePath: '/capturePolicyRef',
      targetModule: 'IdentityPolicy',
      targetObjectType: 'Policy',
      targetObjectId: policyKey.objectId,
      targetVersionId: policyKey.versionId,
      referencePurpose: 'CONTEXT_SOURCE_SLICE_CAPTURE_POLICY',
    });
    await execution.appendReferenceEdge({
      ownerObjectType: 'ContextSourceSlice',
      ownerObjectId: sliceId,
      ownerPayloadHash: sliceHash,
      referencePath: '/policyVersionRef',
      targetModule: 'IdentityPolicy',
      targetObjectType: 'PolicyVersion',
      targetObjectId: resolution.policy.policyVersionRef.objectId,
      targetPayloadHash: resolution.policy.contentHash,
      referencePurpose: 'CONTEXT_SOURCE_SLICE_POLICY_VERSION',
    });
    return {
      kind: 'COMMITTED',
      resultPayload: {
        sourceSliceRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
          objectId: sliceId,
          scope: { enterpriseId: context.enterpriseId, projectId },
          contentHash: contentHashFromDigest(sliceHash.toString('hex')),
        },
      } as unknown as CanonicalJsonObject,
    };
  });
}

/**
 * Re-derives the stored Slice from its own canonical payload and checks it
 * against the promoted columns. A stored Slice that disagrees with its content
 * address is refused instead of being returned.
 */
function storedSlice(
  row: {
    slice_id: string;
    enterprise_id: string;
    project_id: string;
    purpose: string;
    captured_at: Date;
    valid_until: Date;
    slice_payload: unknown;
    slice_payload_hash: Buffer;
  },
  ref: Common.ContentAddressedRef,
): EnterpriseProject.ContextSourceSlice {
  const payload = row.slice_payload as CanonicalJsonObject;
  const digest = digestCanonicalPayload(payload).hash;
  const scope = record((payload as Record<string, unknown>).scopeRef);
  const projectRef = record((payload as Record<string, unknown>).projectRef);
  if (
    !digest.equals(Buffer.from(ref.contentHash.digest, 'hex')) ||
    !digest.equals(row.slice_payload_hash) ||
    (payload as Record<string, unknown>).sliceId !== row.slice_id ||
    (payload as Record<string, unknown>).purpose !== row.purpose ||
    (payload as Record<string, unknown>).capturedAt !== row.captured_at.toISOString() ||
    (payload as Record<string, unknown>).validUntil !== row.valid_until.toISOString() ||
    scope.enterpriseId !== row.enterprise_id ||
    scope.projectId !== row.project_id ||
    projectRef.objectId !== row.project_id
  ) {
    sliceError(
      PROJECT_QUERY_REF_INVALID,
      'the stored Slice does not match its content address and scope',
    );
  }
  return payload as unknown as EnterpriseProject.ContextSourceSlice;
}

/**
 * `project.get_context_source_slice@1.0`: dereference one exact Slice and
 * report its current use status. The reference, Scope, purpose, audience and
 * the capture Policy lifecycle are re-verified with the trusted clock; the
 * Slice payload itself is never rewritten.
 */
export async function handleGetContextSourceSlice(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  payload: GetContextSourceSliceQueryPayload,
  deps: ContextSourceSliceHandlerDeps,
): Promise<EnterpriseProject.ProjectGetContextSourceSliceResult> {
  const now = deps.now ?? ((): Date => new Date());
  requireRegisteredPurpose(context, GET_CONTEXT_SOURCE_SLICE_PURPOSE);
  if (context.authorizationDecisionExpiresAt.getTime() <= now().getTime()) {
    sliceError(PROJECT_QUERY_CONTEXT_EXPIRED, 'authorization context has expired');
  }
  const ref = sliceRef(payload.sourceSliceRef, context);
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const row = await repo.getContextSourceSliceById(trx, ref.objectId);
    if (row === undefined) {
      sliceError(PROJECT_QUERY_NOT_FOUND, 'the requested Slice is not available');
    }
    if (
      row.enterprise_id !== context.enterpriseId ||
      !context.allowedProjectIds.includes(row.project_id) ||
      (ref.scope.projectId !== undefined && ref.scope.projectId !== row.project_id)
    ) {
      sliceError(PROJECT_QUERY_SCOPE_MISMATCH, 'the requested Slice is outside the trusted scope');
    }
    const slice = storedSlice(row, ref);
    if (
      slice.audience.principalId !== context.principalId ||
      slice.audience.principalKind !== context.principalKind
    ) {
      sliceError(PROJECT_QUERY_AUDIENCE_INVALID, 'the Slice audience is not the calling Principal');
    }
    validateSourceSlicePurpose(slice.purpose);
    const checkedAt = now();
    const resolution = await resolveCapturePolicy(deps.policyResolution, {
      policyRef: slice.capturePolicyRef,
      asOf: checkedAt,
      correlationId: context.correlationId,
    });
    if (resolution.kind === 'UNAVAILABLE') {
      throw new EnterpriseBusinessError(
        DEPENDENCY_UNAVAILABLE,
        'capture policy resolution is unavailable',
      );
    }
    const policyUsable =
      resolution.kind === 'USABLE' &&
      resolution.policy.contentHash.equals(row.policy_content_hash) &&
      resolution.policy.rules.allowedPurposeCodes.includes(slice.purpose);
    const useStatus = policyUsable
      ? new Date(slice.validUntil).getTime() <= checkedAt.getTime()
        ? ('EXPIRED' as const)
        : ('USABLE' as const)
      : ('REVOKED' as const);
    const result: EnterpriseProject.ProjectGetContextSourceSliceResult = {
      slice,
      useStatus,
      checkedAt: checkedAt.toISOString(),
    };
    const contract = CONTRACT_REGISTRY.validateOperationResult(
      GET_CONTEXT_SOURCE_SLICE_QUERY,
      '1.0',
      result,
    );
    if (!contract.valid) {
      sliceError(
        PROJECT_QUERY_REF_INVALID,
        'the stored Slice cannot be returned as a registered ContextSourceSlice result',
      );
    }
    return result;
  });
}
