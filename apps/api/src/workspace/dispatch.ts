// IM-UI-01 (#266/#258): the closed operation dispatch of the Core workspace
// transport (Session Delta §5).
//
// The transport mounts exactly three read operations and nothing else. There is
// no generic registry dispatch, no private repository proxy, no management or
// worker operation and no command: a request for any other operation is a safe
// 404, and an operation the approved route set lists but does not yet implement
// is a safe 503. The URL operation/version is compared verbatim with the body
// `type`/`version` (one canonical parse; a mismatch is `API_VALUE_INVALID`), and
// any Browser business override field (`actor`, `actingFor`, `requester`,
// `authorizationDecisionRef`, `authenticationContextRef`, `roles`,
// `policySnapshot`) is refused before anything else runs.
//
// For the three implemented reads the dispatch resolves the verified Human
// through the owning IdentityPolicy Port and completes the shared Query
// Envelope (requester / authenticationContextRef from the trusted identity, not
// from the payload) before handing it to the matching entry. Every failure is
// projected onto the frozen `errors.ts` table via `WorkspaceCoreError`, so a
// dependency failure is a 503 and never an empty successful page.

import type { Kysely } from 'kysely';
import type { Common } from '@zhiju/contracts';
import {
  IDENTITY_WORKSPACE_HUMAN_NOT_LINKED,
  resolveVerifiedHuman,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
  type IdentityTransactionContext,
  type VerifiedHumanResolution,
  type VerifiedOidcContextInput,
} from '@zhiju/identity-policy';
import type { EnterpriseProjectDb } from '@zhiju/enterprise-project';
import type { TaskExecutionDb } from '@zhiju/task-execution';
import { newUuidV7, sha256CanonicalJson } from '@zhiju/shared-kernel';
import {
  createWorkspaceDirectoryEntry,
  WORKSPACE_DIRECTORY_QUERY,
  WORKSPACE_DIRECTORY_QUERY_VERSION,
  type WorkspaceDirectoryCapabilityCodes,
} from '../composition/workspace-directory-entry.js';
import {
  createWorkspaceProjectBoardEntry,
  createWorkspaceTaskBoardEntry,
  PROJECT_BOARD_SLICE_QUERY,
  PROJECT_BOARD_SLICE_QUERY_VERSION,
  TASK_BOARD_SLICE_QUERY,
  TASK_BOARD_SLICE_QUERY_VERSION,
  type WorkspaceBoardCapabilityCodes,
  type WorkspaceBoardSession,
} from '../composition/workspace-board-entries.js';
import { payloadHashOf, record } from '../composition/decision-boundary.js';
import {
  CORE_ERROR_CODE,
  WorkspaceCoreError,
  statusOfError,
  toSafeBody,
  type CoreErrorCode,
} from './errors.js';
import type { WorkspaceDispatchRequest, WorkspaceDispatchResponse } from './controller.js';
import type { WorkspaceMarkdownStreamRequest } from './controller.js';
import {
  createMarkdownReviewEntry,
  type MarkdownReviewEntryConfig,
} from '../composition/markdown-review-entry.js';
import { MARKDOWN_REVIEW_PURPOSES, type MarkdownReviewOperation } from '@zhiju/identity-policy';

/** The six trusted capability codes the three reads resolve. */
export type WorkspaceDispatchCapabilityCodes = WorkspaceDirectoryCapabilityCodes &
  WorkspaceBoardCapabilityCodes;

export interface WorkspaceDispatchConfig {
  readonly markdown?: Pick<
    MarkdownReviewEntryConfig,
    'review' | 'representations' | 'capabilityCodes'
  >;
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly capabilityCodes: WorkspaceDispatchCapabilityCodes;
  /** The fixed SERVICE principal of the transport's technical Board session. */
  readonly boardService: { readonly principalId: string };
  /** Trusted fixed Project-scoped Board Policy selector (owning TE entry). */
  readonly boardPolicyRef: (projectId: string) => Common.VersionedRef | undefined;
  /** Trusted server cursor secret of the owning Task Board read; never a hash. */
  readonly cursorKey: { readonly keyId: number; readonly secret: Buffer };
  readonly now?: (() => Date) | undefined;
}

export interface WorkspaceDispatch {
  execute(request: WorkspaceDispatchRequest): Promise<WorkspaceDispatchResponse>;
  stream(
    request: WorkspaceMarkdownStreamRequest,
  ): ReturnType<ReturnType<typeof createMarkdownReviewEntry>['stream']>;
}

/** The closed implemented read table; no command and no wildcard is present. */
const IMPLEMENTED_QUERIES: ReadonlySet<string> = new Set([
  ...Object.keys(MARKDOWN_REVIEW_PURPOSES).map((operation) => `${operation}@1.0`),
  `${WORKSPACE_DIRECTORY_QUERY}@${WORKSPACE_DIRECTORY_QUERY_VERSION}`,
  `${PROJECT_BOARD_SLICE_QUERY}@${PROJECT_BOARD_SLICE_QUERY_VERSION}`,
  `${TASK_BOARD_SLICE_QUERY}@${TASK_BOARD_SLICE_QUERY_VERSION}`,
]);

/**
 * The approved route set (Session Delta §5) that has no owning handler in the
 * first version. Every one of them is a safe 503, never a 404 that would deny
 * the route's existence.
 */
const ALLOWLISTED_UNIMPLEMENTED: ReadonlySet<string> = new Set([
  'project.find_preparation_enterprises@1.0',
  'project.request_project_preparation@1.0',
  'project.get_project_preparation_request@1.0',
  'integration.request_customer_zip_intake@1.0',
  'integration.get_customer_zip_intake@1.0',
  'project.get_startup_review@1.0',
  'project.request_startup_confirmation@1.0',
  'project.get_startup_request@1.0',
  'project.resume_startup_request@1.0',
  'project.request_initial_scope_confirmation@1.0',
  'project.get_initial_scope_request@1.0',
  'project.resume_initial_scope_request@1.0',
  'execution.get_initial_work_scope_state@1.0',
  'execution.get_work_scope_progress@1.0',
  'quality.get_evidence@1.0',
]);

/** Browser business override fields that must never reach an owning entry. */
const FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  'actor',
  'actingFor',
  'requester',
  'authorizationDecisionRef',
  'authenticationContextRef',
  'roles',
  'policySnapshot',
]);

const BOOTSTRAP_ENTERPRISE_ID = '00000000-0000-7000-8000-000000000000';
const BOOTSTRAP_PRINCIPAL_ID = '00000000-0000-7000-8000-000000000001';

/** Internal owning codes projected onto the frozen public table. */
const PUBLIC_CODE_BY_INTERNAL: Readonly<Record<string, CoreErrorCode>> = Object.freeze({
  ARTIFACT_QUERY_NOT_FOUND: CORE_ERROR_CODE.NOT_FOUND,
  ARTIFACT_STRUCTURED_DOCUMENT_BASE_INVALID: CORE_ERROR_CODE.NOT_FOUND,
  ARTIFACT_CONTENT_READBACK_MISMATCH: CORE_ERROR_CODE.NOT_FOUND,
  API_VALUE_INVALID: CORE_ERROR_CODE.API_VALUE_INVALID,
  API_CONTRACT_TYPE_UNKNOWN: CORE_ERROR_CODE.NOT_FOUND,
  API_PAYLOAD_HASH_MISMATCH: CORE_ERROR_CODE.API_VALUE_INVALID,
  API_PAYLOAD_LIMIT_EXCEEDED: CORE_ERROR_CODE.API_VALUE_INVALID,
  SCOPE_MISMATCH: CORE_ERROR_CODE.API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID: CORE_ERROR_CODE.AUTHORIZATION_REVOKED,
  AUTHORIZATION_EXPIRED: CORE_ERROR_CODE.AUTHORIZATION_REVOKED,
  AUTHORIZATION_REVOKED: CORE_ERROR_CODE.AUTHORIZATION_REVOKED,
  [IDENTITY_WORKSPACE_HUMAN_NOT_LINKED]: CORE_ERROR_CODE.ACCESS_DENIED,
  DEPENDENCY_UNAVAILABLE: CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE,
  QUERY_CURSOR_SCOPE_MISMATCH: CORE_ERROR_CODE.QUERY_CURSOR_SCOPE_MISMATCH,
  QUERY_CURSOR_EXPIRED: CORE_ERROR_CODE.QUERY_CURSOR_EXPIRED,
  QUERY_CURSOR_INVALID: CORE_ERROR_CODE.QUERY_CURSOR_INVALID,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID: CORE_ERROR_CODE.API_VALUE_INVALID,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID: CORE_ERROR_CODE.QUERY_CURSOR_INVALID,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED: CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID:
    CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE,
  PROJECT_QUERY_REF_INVALID: CORE_ERROR_CODE.API_VALUE_INVALID,
  PROJECT_QUERY_SCOPE_MISMATCH: CORE_ERROR_CODE.NOT_FOUND,
  PROJECT_QUERY_NOT_FOUND: CORE_ERROR_CODE.NOT_FOUND,
  PROJECT_QUERY_CONTEXT_EXPIRED: CORE_ERROR_CODE.AUTHORIZATION_REVOKED,
  PROJECT_QUERY_AUDIENCE_INVALID: CORE_ERROR_CODE.AUTHORIZATION_REVOKED,
  PROJECT_QUERY_CURSOR_INVALID: CORE_ERROR_CODE.QUERY_CURSOR_INVALID,
});

function hasForbiddenField(value: unknown, depth: number): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasForbiddenField(entry, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) return true;
    if (hasForbiddenField(child, depth + 1)) return true;
  }
  return false;
}

function toWorkspaceCoreError(error: unknown): WorkspaceCoreError {
  if (error instanceof WorkspaceCoreError) return error;
  const code = (error as { readonly code?: unknown } | null)?.code;
  const mapped = typeof code === 'string' ? PUBLIC_CODE_BY_INTERNAL[code] : undefined;
  return new WorkspaceCoreError(mapped ?? CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
}

function bootstrapContext(params: {
  readonly principalId: string;
  readonly now: Date;
}): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: params.principalId,
    actorSnapshotId: newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: Buffer.from(
      sha256CanonicalJson({ purpose: 'workspace.dispatch.bootstrap' }),
      'hex',
    ),
    authorizationDecisionExpiresAt: new Date(params.now.getTime() + 300_000),
    enterpriseId: BOOTSTRAP_ENTERPRISE_ID,
    allowedProjectIds: [],
    correlationId: newUuidV7(),
  };
}

export function createWorkspaceDispatch(config: WorkspaceDispatchConfig): WorkspaceDispatch {
  const markdown = config.markdown
    ? createMarkdownReviewEntry({
        ...config.markdown,
        identity: config.identity,
        ...(config.now ? { now: config.now } : {}),
      })
    : undefined;
  const now = config.now ?? ((): Date => new Date());
  const directoryEntry = createWorkspaceDirectoryEntry({
    identity: config.identity,
    enterpriseProjectDb: config.enterpriseProjectDb,
    capabilityCodes: {
      workspaceProjectDiscoveryHumanV1: config.capabilityCodes.workspaceProjectDiscoveryHumanV1,
      projectBoardSliceReadHumanV1: config.capabilityCodes.projectBoardSliceReadHumanV1,
    },
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const boardConfig = {
    identity: config.identity,
    enterpriseProjectDb: config.enterpriseProjectDb,
    taskExecutionDb: config.taskExecutionDb,
    capabilityCodes: config.capabilityCodes,
    boardService: config.boardService,
    boardPolicyRef: config.boardPolicyRef,
    cursorKey: config.cursorKey,
    ...(config.now === undefined ? {} : { now: config.now }),
  };
  const projectBoardEntry = createWorkspaceProjectBoardEntry(boardConfig);
  const taskBoardEntry = createWorkspaceTaskBoardEntry(boardConfig);

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return {
      db: config.identity.db,
      repo: config.identity.repo,
      crypto: config.identity.crypto,
      context,
    };
  }

  async function resolveHuman(context: VerifiedOidcContextInput): Promise<VerifiedHumanResolution> {
    return resolveVerifiedHuman(
      identityDeps(bootstrapContext({ principalId: BOOTSTRAP_PRINCIPAL_ID, now: now() })),
      context,
    );
  }

  /** The shared Query Envelope the three entries validate and consume. */
  function completeEnvelope(
    body: Record<string, unknown>,
    operation: string,
    version: string,
    resolution: VerifiedHumanResolution,
    correlationId: string,
  ): Record<string, unknown> {
    const envelope: Record<string, unknown> = {
      queryId: body.queryId,
      queryType: operation,
      queryVersion: version,
      scopeRef: body.scopeRef,
      requester: resolution.principalRef,
      authenticationContextRef: {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'zhiju.identity.authentication_context',
        objectId: newUuidV7(),
        scope: {},
        contentHash: {
          algorithm: 'SHA-256',
          digest: resolution.authenticationContextHash.toString('hex'),
          canonicalizationVersion: '1',
        },
      },
      consistencyRequirement: body.consistencyRequirement,
      correlationId: body.correlationId ?? correlationId,
      requestedAt: body.requestedAt,
      payload: body.payload,
    };
    if (body.pagination !== undefined) envelope.pagination = body.pagination;
    if (body.minimumWatermark !== undefined) envelope.minimumWatermark = body.minimumWatermark;
    if (body.asOf !== undefined) envelope.asOf = body.asOf;
    return envelope;
  }

  async function dispatchQuery(
    request: WorkspaceDispatchRequest,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const key = `${request.operation}@${request.version}`;
    const resolution = await resolveHuman(request.context);
    const session: WorkspaceBoardSession = {
      context: request.context,
      sessionBinding: request.sessionBinding,
      authenticationContextHash: resolution.authenticationContextHash,
      principalRef: resolution.principalRef,
    };
    const envelope = completeEnvelope(
      body,
      request.operation,
      request.version,
      resolution,
      request.correlationId,
    );
    if (Object.hasOwn(MARKDOWN_REVIEW_PURPOSES, request.operation)) {
      if (!markdown) throw new WorkspaceCoreError(CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
      return markdown.query(request.operation as MarkdownReviewOperation, envelope, session);
    }
    if (key === `${WORKSPACE_DIRECTORY_QUERY}@${WORKSPACE_DIRECTORY_QUERY_VERSION}`) {
      return directoryEntry.findWorkspaceProjects(envelope, session);
    }
    if (key === `${PROJECT_BOARD_SLICE_QUERY}@${PROJECT_BOARD_SLICE_QUERY_VERSION}`) {
      return projectBoardEntry.getProjectBoardSlice(envelope, session);
    }
    return taskBoardEntry.getTaskBoardSlice(envelope, session);
  }

  return {
    async stream(request) {
      try {
        if (!markdown) throw new WorkspaceCoreError(CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE);
        const resolution = await resolveHuman(request.context);
        return await markdown.stream(
          {
            context: request.context,
            sessionBinding: request.sessionBinding,
            authenticationContextHash: resolution.authenticationContextHash,
            principalRef: resolution.principalRef,
          },
          request.representationId,
          request.ticket,
          request.signal,
        );
      } catch (error) {
        throw toWorkspaceCoreError(error);
      }
    },
    async execute(request) {
      try {
        const body = record(request.body);
        // One canonical parse: the URL operation/version must equal the body
        // `type`/`version` verbatim.
        if (body.type !== request.operation || body.version !== request.version) {
          throw new WorkspaceCoreError(CORE_ERROR_CODE.API_VALUE_INVALID);
        }
        // A Browser business override field is refused before any owner runs.
        if (hasForbiddenField(body, 0)) {
          throw new WorkspaceCoreError(CORE_ERROR_CODE.API_VALUE_INVALID);
        }
        const key = `${request.operation}@${request.version}`;
        if (request.kind !== 'QUERY' || !IMPLEMENTED_QUERIES.has(key)) {
          throw new WorkspaceCoreError(
            ALLOWLISTED_UNIMPLEMENTED.has(key)
              ? CORE_ERROR_CODE.DEPENDENCY_UNAVAILABLE
              : CORE_ERROR_CODE.NOT_FOUND,
          );
        }
        if (body.integrity !== undefined && body.integrity !== null) {
          const integrity = record(body.integrity);
          const expected = payloadHashOf(record(body.payload));
          const declared = record(integrity.payloadHash);
          if (
            integrity.canonicalizationVersion !== '1' ||
            declared.digest !== expected.toString('hex')
          ) {
            throw new WorkspaceCoreError(CORE_ERROR_CODE.API_VALUE_INVALID);
          }
        }
        const payload = await dispatchQuery(request, body);
        return { status: 200, payload };
      } catch (error) {
        const mapped = toWorkspaceCoreError(error);
        return {
          status: statusOfError(mapped),
          payload: toSafeBody(mapped, request.correlationId),
        };
      }
    },
  };
}
