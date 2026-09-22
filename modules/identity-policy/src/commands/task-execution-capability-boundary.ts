// IM-06 (#210): IdentityPolicy-owned Human-only classification boundary for the
// capabilities a WorkOrder DRAFT declares.
//
// Design authority: Module-Spec-001 §15.7 and Spec 003 §18.5. This is an
// internal read-only Port, not a registered operation: it adds nothing to the
// catalog, changes no registered acceptance set, adds no capability code and
// needs no migration.
//
// 1. The classification unit is exactly the declared capability code — Core
//    §4.7 `CapabilityGrant.capabilityType`. `actions[]`, `resourceSelectors[]`,
//    `constraints[]`, `expiresAt` and `grantPolicyRef` take no part in the
//    classification, and this Port neither judges Grant coverage nor signs a
//    capability nor evaluates action-level availability: a DRAFT declares what a
//    future Run would be allowed to do, and its drafter normally holds no Grant
//    for it. That is precisely why `identity.check_human_only_capability@1.0`
//    cannot stand in for this classification — it answers "does this principal
//    hold a covering Grant", so its DENY cannot separate "no Grant" from
//    "Human-only" — and why the owning static set is never read through a public
//    query.
// 2. The owning versioned static set `HUMAN_ONLY_CAPABILITIES` decides membership
//    by exact string only: case-sensitive, no normalization, no prefix, no alias.
//    The registry version actually used is returned, so the consumer attributes
//    the decision to the exact classification set it was made under instead of
//    hard-coding it or reading this module's constant across the boundary. The
//    internal classification of a refusal is written to this module's own
//    permission-controlled audit and never returned.
// 3. The declared list is de-duplicated and canonically byte-ordered before it is
//    classified, so the decision depends on the declared set and never on the
//    caller's order or repetitions.
// 4. A HUMAN principal is always `VALID`: this Port classifies a declaration, it
//    does not authorize an action. Any non-HUMAN principal that declares at least
//    one Human-only code is `INVALID`; the consumer converges that onto the
//    shared `HUMAN_ONLY_CAPABILITY`.
// 5. Everything else fails closed with a stable error. Because `INVALID` carries
//    exactly one meaning, a supported `(commandType, commandVersion)` key is
//    required and a `principalRef`/`scopeRef` that is not the trusted
//    authenticated principal and Project Scope raises instead of being reported
//    as a classification result. An unavailable dependency throws too and is
//    never read as an empty or accepting answer.

import type { Kysely } from 'kysely';
import { newUuidV7 } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import {
  withIdentityTransaction,
  type IdentityPolicyDb,
  type IdentityTransaction,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import { SnapshotBoundaryError, type PrincipalKind } from './actor-snapshot.js';
import {
  HUMAN_ONLY_CAPABILITIES,
  HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
} from './static-registry.js';

export const IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED = 'IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED';
export const IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID =
  'IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID';
export const IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID =
  'IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID';
export const IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID =
  'IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID';

/**
 * Internal audit classification of a refusal (Spec 001 §15.7). It is this
 * module's own Audit reason vocabulary — not a public error code and not the
 * `IDENTITY_CAPABILITY_HUMAN_ONLY` module code of `identity.grant_capability`
 * — and it is written to the permission-controlled audit trail only.
 */
export const TASK_CREATION_CAPABILITY_HUMAN_ONLY = 'CAPABILITY_HUMAN_ONLY';

/**
 * The Port's own input key table. It selects which `(commandType, commandVersion)`
 * pairs this boundary serves — the two published WorkOrder creation versions —
 * and nothing else does: no alias, no prefix, no case variant and no implicit
 * version.
 */
const SUPPORTED_CREATION_KEYS: Readonly<Record<string, true>> = Object.freeze({
  'execution.create_work_order@1.0': true,
  'execution.create_work_order@1.1': true,
});

/** The NamespaceCode shape of the shared contract (`Common.NamespaceCode`). */
const namespaceCodePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
/** UuidV7, the identity shape every reference of this module uses. */
const uuidV7Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
/**
 * The shared `common.utcInstant` shape. The trusted action instant is not used
 * to derive any eligibility here; it is checked so a malformed trusted time
 * cannot be recorded as one and is attributed in the audit.
 */
const utcInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
/** The closed `PrincipalKind` set of the shared contract. */
const principalKinds: Readonly<Record<string, true>> = Object.freeze({
  HUMAN: true,
  AGENT: true,
  SERVICE: true,
  RUNTIME: true,
  EXTERNAL_PARTY: true,
});

export interface TaskExecutionCreationCapabilityBoundaryRequest {
  readonly commandType: string;
  readonly commandVersion: string;
  /** The authenticated principal of the trusted session, never a payload fact. */
  readonly principalRef: Common.PrincipalRef;
  /** The declared `CapabilityGrant.capabilityType` codes, in any order. */
  readonly declaredCapabilityTypes: readonly string[];
  /** The trusted Project Scope this creation runs in. */
  readonly scopeRef: Common.ScopeRef;
  /** The trusted current instant of this classification. */
  readonly actionAt: Common.UtcInstant;
}

/**
 * Closed result of the classification. The internal classification of a refusal
 * and the contents of the owning set stay inside IdentityPolicy's audit; an
 * unavailable dependency throws instead of answering.
 */
export type TaskExecutionCreationCapabilityBoundaryOutcome = 'VALID' | 'INVALID';

export interface TaskExecutionCreationCapabilityBoundaryResult {
  readonly outcome: TaskExecutionCreationCapabilityBoundaryOutcome;
  /** The classification registry version this result was actually made under. */
  readonly classificationRegistryVersion: string;
}

export interface TaskExecutionCreationCapabilityBoundaryPort {
  classifyDeclaredCapabilities(
    request: TaskExecutionCreationCapabilityBoundaryRequest,
  ): Promise<TaskExecutionCreationCapabilityBoundaryResult>;
}

export interface TaskExecutionCreationCapabilityBoundaryConfig {
  /** Owning IdentityPolicy database handle over an application-owned pool. */
  readonly db: Kysely<IdentityPolicyDb>;
  /** Trusted context derived by the composition layer from the Decision row. */
  readonly context: IdentityTransactionContext;
  /** Command identity recorded in the internal audit trail. */
  readonly commandId: string;
}

interface TrustedProjectScope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * The declared capability codes, de-duplicated and in canonical byte order. The
 * set is what this boundary classifies; the caller's order and repetitions are
 * not.
 */
function readDeclaredCapabilityTypes(declared: unknown): string[] {
  if (!Array.isArray(declared)) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
      'declared capability types must be an array of capability codes',
    );
  }
  for (const code of declared) {
    if (typeof code !== 'string' || !namespaceCodePattern.test(code)) {
      throw new SnapshotBoundaryError(
        IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
        'every declared capability type must be an exact capability code',
      );
    }
  }
  // A NamespaceCode is ASCII, so the runtime's code-unit order is the canonical
  // byte order of the de-duplicated set.
  return [...new Set<string>(declared)].sort();
}

/**
 * The trusted Project Scope of this call: the context must carry exactly one
 * allowed Project, and the declared ref must be exactly it. No other Scope can
 * be classified, and the declared ref is never a source of expected identity.
 */
function readTrustedScope(
  scopeRef: unknown,
  context: IdentityTransactionContext,
): TrustedProjectScope {
  const enterpriseId = context.enterpriseId;
  const projectIds = context.allowedProjectIds;
  const projectId = projectIds.length === 1 ? projectIds[0] : undefined;
  if (
    typeof enterpriseId !== 'string' ||
    enterpriseId === '' ||
    projectId === undefined ||
    !uuidV7Pattern.test(projectId)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID,
      'the trusted context does not carry exactly one Project scope',
    );
  }
  const candidate = record(scopeRef);
  const keys = Object.keys(candidate);
  if (
    keys.length !== 2 ||
    !keys.every((key) => key === 'enterpriseId' || key === 'projectId') ||
    candidate.enterpriseId !== enterpriseId ||
    candidate.projectId !== projectId
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_SCOPE_INVALID,
      'the declared scope must be the trusted Project Scope',
    );
  }
  return { enterpriseId, projectId };
}

/**
 * The kind of the declared authenticated principal: the ref must be an exact
 * `PrincipalRef` and name the trusted transaction principal. Its kind is only
 * *declared* here — the owning principal row decides the kind this boundary
 * classifies against.
 */
function readDeclaredPrincipalKind(
  principalRef: unknown,
  context: IdentityTransactionContext,
): PrincipalKind {
  const candidate = record(principalRef);
  const keys = Object.keys(candidate);
  const principalKind = candidate.principalKind;
  if (
    keys.length !== 2 ||
    !keys.every((key) => key === 'principalId' || key === 'principalKind') ||
    typeof candidate.principalId !== 'string' ||
    !uuidV7Pattern.test(candidate.principalId) ||
    typeof principalKind !== 'string' ||
    !Object.hasOwn(principalKinds, principalKind)
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
      'the authenticated principal must be an exact PrincipalRef',
    );
  }
  if (candidate.principalId !== context.principalId) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
      'the authenticated principal must be the trusted transaction principal',
    );
  }
  return principalKind as PrincipalKind;
}

/** Exact resolution of one supported creation key; anything else has no entry. */
function assertSupportedCreationKey(commandType: unknown, commandVersion: unknown): void {
  if (typeof commandType !== 'string' || typeof commandVersion !== 'string') {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
      'the creation version must be an exact operation and version',
    );
  }
  if (!Object.hasOwn(SUPPORTED_CREATION_KEYS, `${commandType}@${commandVersion}`)) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
      'the creation version has no approved capability boundary entry',
    );
  }
}

/**
 * The authoritative principal kind, read from this module's own principal row
 * inside the trusted transaction. The caller's declaration is never the source
 * of the kind this boundary classifies against.
 */
async function readAuthoritativePrincipalKind(
  trx: IdentityTransaction,
  principalId: string,
): Promise<PrincipalKind> {
  const row = await trx
    .selectFrom('identity_policy.principal')
    .select(['principal_kind'])
    .where('id', '=', principalId)
    .executeTakeFirst();
  if (row === undefined) {
    throw new SnapshotBoundaryError(
      IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
      'the authenticated principal does not resolve',
    );
  }
  return row.principal_kind;
}

/**
 * Whether the declared, de-duplicated set contains a Human-only code, decided by
 * exact membership in the canonical-order walk of that set. The classification
 * never leaves this module, and a HUMAN principal is always outside the owning
 * set: the set binds the kinds that can never receive a capability, not the kind
 * that may always declare one.
 */
function declaresHumanOnlyCapability(
  principalKind: PrincipalKind,
  declared: readonly string[],
): boolean {
  if (principalKind === 'HUMAN') return false;
  return declared.some((code) => HUMAN_ONLY_CAPABILITIES.has(code));
}

/**
 * The classification record of this call. It carries the outcome, the exact
 * classification registry version actually used and the trusted action instant;
 * the refused classification goes to `error_code`, and the declared payload
 * codes stay out of the record.
 */
async function insertClassificationAudit(
  trx: IdentityTransaction,
  config: TaskExecutionCreationCapabilityBoundaryConfig,
  request: TaskExecutionCreationCapabilityBoundaryRequest,
  scope: TrustedProjectScope,
  outcome: TaskExecutionCreationCapabilityBoundaryOutcome,
  actionAt: string,
): Promise<void> {
  const context = config.context;
  await trx
    .insertInto('identity_policy.audit_record')
    .values({
      audit_id: newUuidV7(),
      enterprise_id: scope.enterpriseId,
      project_id: scope.projectId,
      principal_id: context.principalId,
      actor_snapshot_id: context.actorSnapshotId,
      authorization_decision_id: context.authorizationDecisionId,
      command_id: config.commandId,
      command_type: request.commandType,
      outcome: outcome === 'VALID' ? 'ALLOWED' : 'DENIED',
      error_code: outcome === 'VALID' ? null : TASK_CREATION_CAPABILITY_HUMAN_ONLY,
      request_payload_hash: null,
      result_payload_hash: null,
      correlation_id: context.correlationId,
      safe_summary: `declared capability classification ${outcome.toLowerCase()} at ${actionAt} (registry ${HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION})`,
      retention_class: 'REGULATED_AUDIT',
    })
    .execute();
}

function createCapabilityBoundaryPort(
  config: TaskExecutionCreationCapabilityBoundaryConfig,
  execution: boolean,
): TaskExecutionCreationCapabilityBoundaryPort {
  return {
    async classifyDeclaredCapabilities(request) {
      // The trusted input contract is proven before the transaction opens: an
      // unsupported key, a foreign principal and a foreign Scope are caller
      // mistakes, not classification results, so they never reach the owning
      // tables and are never reported as `INVALID`.
      if (execution) {
        if (
          request.commandVersion !== '1.0' ||
          !['execution.validate_work_order_draft', 'execution.freeze_work_order'].includes(
            request.commandType,
          )
        ) {
          throw new SnapshotBoundaryError(
            IDENTITY_CAPABILITY_BOUNDARY_UNSUPPORTED,
            'unsupported WorkOrder execution classification key',
          );
        }
      } else {
        assertSupportedCreationKey(request.commandType, request.commandVersion);
      }
      const declared = readDeclaredCapabilityTypes(request.declaredCapabilityTypes);
      const scope = readTrustedScope(request.scopeRef, config.context);
      const declaredKind = readDeclaredPrincipalKind(request.principalRef, config.context);
      const actionAt = request.actionAt;
      if (typeof actionAt !== 'string' || !utcInstantPattern.test(actionAt)) {
        throw new SnapshotBoundaryError(
          IDENTITY_CAPABILITY_BOUNDARY_INPUT_INVALID,
          'the trusted action instant must be an exact UtcInstant',
        );
      }

      return withIdentityTransaction(config.db, config.context, async (trx) => {
        const authoritativeKind = await readAuthoritativePrincipalKind(
          trx,
          config.context.principalId,
        );
        if (authoritativeKind !== declaredKind || (execution && authoritativeKind !== 'SERVICE')) {
          throw new SnapshotBoundaryError(
            IDENTITY_CAPABILITY_BOUNDARY_PRINCIPAL_INVALID,
            'the declared principal does not match the owning principal row',
          );
        }
        const outcome: TaskExecutionCreationCapabilityBoundaryOutcome = declaresHumanOnlyCapability(
          authoritativeKind,
          declared,
        )
          ? 'INVALID'
          : 'VALID';
        await insertClassificationAudit(trx, config, request, scope, outcome, actionAt);
        return {
          outcome,
          classificationRegistryVersion: HUMAN_ONLY_CAPABILITY_REGISTRY_VERSION,
        };
      });
    },
  };
}

export interface TaskExecutionExecutionCapabilityBoundaryPort {
  classifyWorkOrderExecutionCapabilities(
    request: TaskExecutionCreationCapabilityBoundaryRequest,
  ): Promise<TaskExecutionCreationCapabilityBoundaryResult>;
}

export function createTaskExecutionExecutionCapabilityBoundaryPort(
  config: TaskExecutionCreationCapabilityBoundaryConfig,
): TaskExecutionExecutionCapabilityBoundaryPort {
  const port = createCapabilityBoundaryPort(config, true);
  return {
    classifyWorkOrderExecutionCapabilities: (request) => port.classifyDeclaredCapabilities(request),
  };
}

export function createTaskExecutionCreationCapabilityBoundaryPort(
  config: TaskExecutionCreationCapabilityBoundaryConfig,
): TaskExecutionCreationCapabilityBoundaryPort {
  return createCapabilityBoundaryPort(config, false);
}
