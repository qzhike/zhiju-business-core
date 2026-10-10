// IM-UI-01 (#266/#258): the trusted Core composition adapters that let the
// workspace transport invoke the two R-row boards with the *current* trusted
// Human and their own unchanged business contracts (Session Delta §4/§5).
//
//   * `project.get_project_board_slice@1.0` — the Human Decision is minted with
//     the `projectBoardSliceReadHumanV1` binding of
//     `PROJECT_BOARD_SLICE_READ_BINDINGS` for the exact Project target and the
//     request payload hash, the EnterpriseProject owning handler runs inside the
//     Enterprise+Project context derived from that Decision, and the owning
//     result is validated against the registry and reauthorized before return.
//
//   * `execution.get_task_board_slice@1.0` — the owning `createTaskBoardEntry`
//     is reused unchanged. The transport mints the Human Decision with the
//     existing `TASK_BOARD_BINDINGS.taskBoardReadHumanV1` mapping and an
//     explicit *transport technical SERVICE session* for the same Project,
//     because the owning entry additionally requires a SERVICE bootstrap
//     (`taskBoardSourceReadV1`). The SERVICE principal is the deployment's
//     `boardService.principalId`, its authentication context hash is derived
//     canonically from the verified trust-config hash and a fixed purpose (so it
//     is stable for the process/config), and it is never derived from the
//     Browser.
//
// Neither adapter widens a business contract, invents a payload default or
// rewrites the owning handler's error codes.

import type { Kysely } from 'kysely';
import { getContractRegistry, type Common } from '@zhiju/contracts';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  API_VALUE_INVALID,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  PROJECT_BOARD_SLICE_READ_BINDINGS,
  SCOPE_MISMATCH,
  TASK_BOARD_BINDINGS,
  createActorSnapshot,
  createTaskBoardAuthorizationPort,
  createWorkspaceProjectDiscoveryPort,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
  type TaskBoardCapabilityCodes,
  type VerifiedOidcContextInput,
} from '@zhiju/identity-policy';
import {
  handleGetProjectBoardSlice,
  type EnterpriseProjectDb,
  type GetProjectBoardSliceQueryPayload,
} from '@zhiju/enterprise-project';
import type { TaskExecutionDb } from '@zhiju/task-execution';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  createDecisionBoundary,
  entryError,
  payloadHashOf,
  record,
  type DecisionBoundary,
  type IdentityBoundaryConfig,
  type RequestScope,
} from './decision-boundary.js';
import { createTaskBoardEntry, type TaskBoardEntryConfig } from './task-board-entry.js';

export const PROJECT_BOARD_SLICE_QUERY = 'project.get_project_board_slice';
export const PROJECT_BOARD_SLICE_QUERY_VERSION = '1.0';
export const TASK_BOARD_SLICE_QUERY = 'execution.get_task_board_slice';
export const TASK_BOARD_SLICE_QUERY_VERSION = '1.0';

/** Canonical purpose of the transport's own technical SERVICE session. */
export const WORKSPACE_BOARD_SERVICE_PURPOSE = 'workspace.board.service';

/**
 * The configured capability codes of this slice. The frozen trust config only
 * carries the four task-board read keys; the three management keys the owning
 * `TaskBoardCapabilityCodes` record also declares are never read on this path
 * and are filled with an inert sentinel so a future management operation fails
 * closed instead of inheriting a read code.
 */
export interface WorkspaceBoardCapabilityCodes {
  readonly workspaceProjectDiscoveryHumanV1: string;
  readonly projectBoardSliceReadHumanV1: string;
  readonly taskBoardReadHumanV1: string;
  readonly taskBoardSourceReadV1: string;
  readonly taskBoardHealthReadV1: string;
  readonly taskBoardPolicyReadV1: string;
}

const INERT_MANAGEMENT_CAPABILITY_CODE = 'workspace.board.unused';

export interface WorkspaceBoardEntryConfig extends IdentityBoundaryConfig {
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly capabilityCodes: WorkspaceBoardCapabilityCodes;
  /** The fixed SERVICE principal of the transport's technical Board session. */
  readonly boardService: { readonly principalId: string };
  /** Trusted fixed Project-scoped Board Policy selector (owning TE entry). */
  readonly boardPolicyRef: (projectId: string) => Common.VersionedRef | undefined;
  /** Trusted server cursor secret of the owning Task Board read; never a hash. */
  readonly cursorKey: { readonly keyId: number; readonly secret: Buffer };
}

/** The trusted Human summary the transport established for this session. */
export interface WorkspaceBoardSession {
  readonly context: VerifiedOidcContextInput;
  readonly sessionBinding: Buffer;
  readonly authenticationContextHash: Buffer;
  readonly principalRef: Common.ObjectRef;
}

export interface WorkspaceProjectBoardEntry {
  getProjectBoardSlice(
    envelope: unknown,
    session: WorkspaceBoardSession,
  ): Promise<Record<string, unknown>>;
}

export interface WorkspaceTaskBoardEntry {
  getTaskBoardSlice(
    envelope: unknown,
    session: WorkspaceBoardSession,
  ): Promise<Record<string, unknown>>;
}

/** The exact Project scope both boards require; an empty scope is refused. */
function projectScope(payload: Record<string, unknown>): {
  readonly projectRef: Common.ObjectRef;
  readonly scope: RequestScope;
} {
  const projectRef = record(payload.projectRef);
  const scope = record(projectRef.scope);
  const objectType = projectRef.objectType;
  const objectId = projectRef.objectId;
  const enterpriseId = scope.enterpriseId;
  const projectId = scope.projectId;
  if (
    projectRef.kind !== 'OBJECT' ||
    typeof objectType !== 'string' ||
    typeof objectId !== 'string' ||
    typeof enterpriseId !== 'string' ||
    typeof projectId !== 'string' ||
    objectId !== projectId
  ) {
    entryError(SCOPE_MISMATCH, 'the board request does not carry an exact Project reference');
  }
  return {
    projectRef: {
      kind: 'OBJECT',
      objectType,
      objectId,
      scope: { enterpriseId, projectId },
    },
    scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
  };
}

/** The board scopeRef must be an explicit Project scope equal to the payload. */
function assertEnvelopeScope(envelope: Record<string, unknown>, scope: RequestScope): void {
  const queryScope = record(envelope.scopeRef);
  if (Object.keys(queryScope).length === 0) {
    entryError(SCOPE_MISMATCH, 'a board read requires an explicit Project scope');
  }
  if (queryScope.enterpriseId !== scope.enterpriseId || queryScope.projectId !== scope.projectId) {
    entryError(SCOPE_MISMATCH, 'the board Project reference is outside the query scope');
  }
}

function authenticationContextRef(
  objectId: string,
  scope: Record<string, unknown>,
  digestHex: string,
): Record<string, unknown> {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.identity.authentication_context',
    objectId,
    scope,
    contentHash: { algorithm: 'SHA-256', digest: digestHex, canonicalizationVersion: '1' },
  };
}

function withResultHash(envelopeObject: Record<string, unknown>): Record<string, unknown> {
  // One documented widening: the composed envelope is JSON-safe, but the
  // compiler cannot see the canonical index signature through `record()`.
  const canonicalEnvelope = envelopeObject as unknown as CanonicalJsonObject;
  return {
    ...envelopeObject,
    resultHash: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: sha256CanonicalJson(canonicalEnvelope),
    },
  };
}

function resultStaleness(projectionStatus: unknown): string {
  return projectionStatus === 'STALE' ||
    projectionStatus === 'REBUILDING' ||
    projectionStatus === 'FAILED'
    ? projectionStatus
    : 'FRESH';
}

export function createWorkspaceProjectBoardEntry(
  config: WorkspaceBoardEntryConfig,
): WorkspaceProjectBoardEntry {
  const registry = getContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);
  const now = config.now ?? ((): Date => new Date());
  const discoveryPort = createWorkspaceProjectDiscoveryPort({
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: config.capabilityCodes.workspaceProjectDiscoveryHumanV1,
      projectBoardSliceReadHumanV1: config.capabilityCodes.projectBoardSliceReadHumanV1,
    },
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const binding = PROJECT_BOARD_SLICE_READ_BINDINGS.projectBoardSliceReadHumanV1;

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return {
      db: config.identity.db,
      repo: config.identity.repo,
      crypto: config.identity.crypto,
      context,
    };
  }

  function bootstrapContext(
    scope: RequestScope,
    principalId: string,
    actorSnapshotId: string = newUuidV7(),
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId,
      actorSnapshotId,
      authorizationDecisionId: newUuidV7(),
      authorizationDecisionHash: Buffer.from(
        sha256CanonicalJson({ purpose: binding.commandType }),
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(now().getTime() + 300_000),
      enterpriseId: scope.enterpriseId,
      allowedProjectIds: [scope.projectId],
      correlationId: newUuidV7(),
    };
  }

  return {
    async getProjectBoardSlice(value, session) {
      const envelope = record(value);
      if (
        envelope.queryType !== PROJECT_BOARD_SLICE_QUERY ||
        envelope.queryVersion !== PROJECT_BOARD_SLICE_QUERY_VERSION
      ) {
        entryError(API_CONTRACT_TYPE_UNKNOWN, 'unsupported Project Board query');
      }
      if (
        !registry.validateOperation(
          PROJECT_BOARD_SLICE_QUERY,
          PROJECT_BOARD_SLICE_QUERY_VERSION,
          envelope,
        ).valid
      ) {
        entryError(API_VALUE_INVALID, 'invalid Project Board envelope');
      }
      const payload = record(envelope.payload);
      const { projectRef, scope } = projectScope(payload);
      assertEnvelopeScope(envelope, scope);
      const correlationId = String(envelope.correlationId);
      const payloadHash = payloadHashOf(payload);

      // The owning Decision Ports require the technical context's actor snapshot
      // to be the exact presented snapshot, so one id serves both.
      const actorSnapshotId = newUuidV7();
      const deps = identityDeps(
        bootstrapContext(scope, session.principalRef.objectId, actorSnapshotId),
      );
      const actorSnapshotRef = await createActorSnapshot(deps, {
        actorSnapshotId,
        principalId: session.principalRef.objectId,
        declaredPrincipalKind: 'HUMAN',
        authenticationContextHash: session.authenticationContextHash,
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
      const issued = await discoveryPort.authorize(deps, 'projectBoardSliceReadHumanV1', {
        actorSnapshotRef,
        commandType: binding.commandType,
        commandVersion: binding.commandVersion,
        commandPayloadHash: payloadHash,
        authenticationContextHash: session.authenticationContextHash,
        targetRef: projectRef,
      });
      if (issued.outcome !== 'ALLOW') {
        entryError(AUTHORIZATION_REVOKED, 'the Project Board read was denied');
      }
      const row = await boundary.readDecisionRow(issued.authorizationDecisionRef, scope);
      const boardPayload = payload as unknown as GetProjectBoardSliceQueryPayload;
      const result = await handleGetProjectBoardSlice(
        config.enterpriseProjectDb,
        boundary.enterpriseProjectContext(row, scope, correlationId),
        boardPayload,
      );
      if (
        !registry.validateOperationResult(
          PROJECT_BOARD_SLICE_QUERY,
          PROJECT_BOARD_SLICE_QUERY_VERSION,
          result,
        ).valid
      ) {
        entryError(
          DEPENDENCY_UNAVAILABLE,
          'the Project Board page does not satisfy its registered schema',
        );
      }
      const revalidationDeps = identityDeps(
        bootstrapContext(scope, session.principalRef.objectId, row.actor_snapshot_id),
      );
      const revalidation = await discoveryPort.revalidate(
        revalidationDeps,
        'projectBoardSliceReadHumanV1',
        {
          decisionRef: issued.authorizationDecisionRef,
          expectedCommandType: binding.commandType,
          expectedCommandVersion: binding.commandVersion,
          expectedCommandPayloadHash: payloadHash,
          expectedAuthenticationContextHash: session.authenticationContextHash,
          expectedTargetRef: projectRef,
        },
      );
      if (!revalidation.valid) {
        entryError(AUTHORIZATION_REVOKED, 'Project Board authorization is no longer current');
      }

      const envelopeObject: Record<string, unknown> = {
        queryId: String(envelope.queryId),
        status: 'OK',
        data: result,
        snapshotAt: result.snapshotAt,
        sourceWatermarks: result.sourceWatermarks,
        stalenessStatus: resultStaleness(result.projectionStatus),
        redactions: [],
      };
      if (result.nextCursor !== undefined) envelopeObject.nextCursor = result.nextCursor;
      return withResultHash(envelopeObject);
    },
  };
}

export function createWorkspaceTaskBoardEntry(
  config: WorkspaceBoardEntryConfig,
): WorkspaceTaskBoardEntry {
  const now = config.now ?? ((): Date => new Date());
  const taskBoardCapabilityCodes: TaskBoardCapabilityCodes = {
    taskBoardReadHumanV1: config.capabilityCodes.taskBoardReadHumanV1,
    taskBoardSourceReadV1: config.capabilityCodes.taskBoardSourceReadV1,
    taskBoardHealthReadV1: config.capabilityCodes.taskBoardHealthReadV1,
    taskBoardPolicyReadV1: config.capabilityCodes.taskBoardPolicyReadV1,
    taskBoardDispatchManageV1: INERT_MANAGEMENT_CAPABILITY_CODE,
    taskBoardProjectionPublishV1: INERT_MANAGEMENT_CAPABILITY_CODE,
    taskBoardProjectionMaintainV1: INERT_MANAGEMENT_CAPABILITY_CODE,
  };
  const authorization = createTaskBoardAuthorizationPort({
    capabilityCodes: taskBoardCapabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const owningEntryConfig: TaskBoardEntryConfig = {
    identity: config.identity,
    taskExecutionDb: config.taskExecutionDb,
    capabilityCodes: taskBoardCapabilityCodes,
    cursorKey: config.cursorKey,
    boardPolicyRef: config.boardPolicyRef,
    ...(config.now === undefined ? {} : { now: config.now }),
  };
  const owningEntry = createTaskBoardEntry(owningEntryConfig);

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return {
      db: config.identity.db,
      repo: config.identity.repo,
      crypto: config.identity.crypto,
      context,
    };
  }

  function projectContext(
    scope: RequestScope,
    principalId: string,
    actorSnapshotId: string = newUuidV7(),
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId,
      actorSnapshotId,
      authorizationDecisionId: newUuidV7(),
      authorizationDecisionHash: Buffer.from(
        sha256CanonicalJson({ purpose: TASK_BOARD_SLICE_QUERY }),
        'hex',
      ),
      authorizationDecisionExpiresAt: new Date(now().getTime() + 300_000),
      enterpriseId: scope.enterpriseId,
      allowedProjectIds: [scope.projectId],
      correlationId: newUuidV7(),
    };
  }

  return {
    async getTaskBoardSlice(value, session) {
      const registry = getContractRegistry();
      const envelope = record(value);
      if (
        envelope.queryType !== TASK_BOARD_SLICE_QUERY ||
        envelope.queryVersion !== TASK_BOARD_SLICE_QUERY_VERSION
      ) {
        entryError(API_CONTRACT_TYPE_UNKNOWN, 'unsupported Task Board query');
      }
      if (
        !registry.validateOperation(
          TASK_BOARD_SLICE_QUERY,
          TASK_BOARD_SLICE_QUERY_VERSION,
          envelope,
        ).valid
      ) {
        entryError(API_VALUE_INVALID, 'invalid Task Board envelope');
      }
      const payload = record(envelope.payload);
      const { projectRef, scope } = projectScope(payload);
      assertEnvelopeScope(envelope, scope);
      const correlationId = String(envelope.correlationId);
      const payloadHash = payloadHashOf(payload);

      const humanActorSnapshotId = newUuidV7();
      const humanDeps = identityDeps(
        projectContext(scope, session.principalRef.objectId, humanActorSnapshotId),
      );
      const humanActorSnapshotRef = await createActorSnapshot(humanDeps, {
        actorSnapshotId: humanActorSnapshotId,
        principalId: session.principalRef.objectId,
        declaredPrincipalKind: 'HUMAN',
        authenticationContextHash: session.authenticationContextHash,
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
      const humanBinding = TASK_BOARD_BINDINGS.find(
        (candidate) => candidate.capabilityConfigKey === 'taskBoardReadHumanV1',
      );
      if (humanBinding === undefined) {
        entryError(DEPENDENCY_UNAVAILABLE, 'the Task Board Human mapping is unavailable');
      }
      const humanDecision = await authorization.authorize(humanDeps, 'taskBoardReadHumanV1', {
        actorSnapshotRef: humanActorSnapshotRef,
        commandType: humanBinding.commandType,
        commandVersion: humanBinding.commandVersion,
        commandPayloadHash: payloadHash,
        authenticationContextHash: session.authenticationContextHash,
        targetRef: projectRef,
      });
      if (humanDecision.outcome !== 'ALLOW') {
        entryError(AUTHORIZATION_REVOKED, 'the Task Board read was denied');
      }

      // The transport's own technical SERVICE session: stable for the
      // process/config, never derived from the Browser.
      const serviceAuthenticationContextHash = Buffer.from(
        sha256CanonicalJson({
          trustConfigHash: session.context.trustConfigHash,
          servicePrincipalId: config.boardService.principalId,
          purpose: WORKSPACE_BOARD_SERVICE_PURPOSE,
        }),
        'hex',
      );
      const serviceActorSnapshotId = newUuidV7();
      const serviceDeps = identityDeps(
        projectContext(scope, config.boardService.principalId, serviceActorSnapshotId),
      );
      const serviceActorSnapshotRef = await createActorSnapshot(serviceDeps, {
        actorSnapshotId: serviceActorSnapshotId,
        principalId: config.boardService.principalId,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: serviceAuthenticationContextHash,
        scopeKind: 'PROJECT',
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
      });
      const sourceBinding = TASK_BOARD_BINDINGS.find(
        (candidate) => candidate.capabilityConfigKey === 'taskBoardSourceReadV1',
      );
      if (sourceBinding === undefined) {
        entryError(DEPENDENCY_UNAVAILABLE, 'the Task Board source mapping is unavailable');
      }
      const sourceDecision = await authorization.authorize(serviceDeps, 'taskBoardSourceReadV1', {
        actorSnapshotRef: serviceActorSnapshotRef,
        commandType: sourceBinding.commandType,
        commandVersion: sourceBinding.commandVersion,
        commandPayloadHash: payloadHashOf({ projectRef }),
        authenticationContextHash: serviceAuthenticationContextHash,
        targetRef: projectRef,
      });
      if (sourceDecision.outcome !== 'ALLOW') {
        entryError(AUTHORIZATION_REVOKED, 'the Task Board source read was denied');
      }

      const fullEnvelope: Record<string, unknown> = {
        ...envelope,
        queryType: TASK_BOARD_SLICE_QUERY,
        queryVersion: TASK_BOARD_SLICE_QUERY_VERSION,
        requester: session.principalRef,
        authenticationContextRef: authenticationContextRef(
          humanActorSnapshotRef.snapshotId,
          { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
          session.authenticationContextHash.toString('hex'),
        ),
        authorizationDecisionRef: humanDecision.authorizationDecisionRef,
        correlationId,
      };
      return owningEntry.getTaskBoardSlice(fullEnvelope, {
        authenticationContextHash: session.authenticationContextHash,
        resolutionActorSnapshotRef: humanActorSnapshotRef,
        serviceSession: {
          authenticationContextHash: serviceAuthenticationContextHash,
          resolutionActorSnapshotRef: serviceActorSnapshotRef,
          sourceDecisionRef: sourceDecision.authorizationDecisionRef,
        },
      });
    },
  };
}
