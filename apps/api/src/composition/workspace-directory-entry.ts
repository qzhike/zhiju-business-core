// IM-UI-01 (#266/#258): the trusted Core composition entry of the workspace
// project directory `project.find_workspace_projects@1.0` (Session Delta §2/§4,
// Spec 002 §258, Spec 001 §258).
//
// This is the only entry that accepts the declared `scopeRef={}` self-discovery
// exception, and it never turns that empty scope into a business authorization:
//
//   1. the validated registered Envelope is accepted only with `scopeRef`
//      exactly `{}` (any other scope is `SCOPE_MISMATCH`) and must match
//      `project.find_workspace_projects@1.0`;
//   2. the verified Human is resolved through the owning IdentityPolicy Port
//      (`resolveVerifiedHuman`), which owns the only accepted requester; the
//      requester/actor/decision of the payload are never read;
//   3. the IP self-discovery scan returns only this principal's current exact
//      PROJECT Scope candidates, the bound `authorizationFingerprint` and the
//      IP source watermark — never another Principal, a name or an EP row;
//   4. every candidate mints its own PROJECT-scoped ActorSnapshot and a
//      `project.workspace.discover` Decision through the owning discovery Port;
//      a DENY candidate is skipped without any EnterpriseProject read;
//   5. each ALLOWed candidate is read through the EnterpriseProject owning read
//      in the exact Enterprise+Project context of its Decision, and a summary
//      that is `undefined` is skipped;
//   6. every used candidate Decision is revalidated before the result leaves;
//      one failed revalidation fails the whole page (never a partial page);
//   7. the cursor is an opaque HMAC value keyed by the request session binding
//      and binding the principal, session, filter, authorization fingerprint,
//      source watermarks and last sort key with a 5-minute expiry.
//
// A legal page is always `OK + Page<WorkspaceProjectSummary>` — including an
// empty intermediate page (`items=[] + nextCursor`) when the filter or the scan
// budget left candidates unread. No global total, no foreign count and no
// unauthorized existence signal is ever produced.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import { getContractRegistry, type Common } from '@zhiju/contracts';
import {
  API_CONTRACT_TYPE_UNKNOWN,
  API_VALUE_INVALID,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID,
  SCOPE_MISMATCH,
  SnapshotBoundaryError,
  WORKSPACE_PROJECT_DISCOVERY_BINDINGS,
  createActorSnapshot,
  createWorkspaceProjectDiscoveryPort,
  discoverWorkspaceProjectScopes,
  resolveVerifiedHuman,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
  type VerifiedHumanResolution,
  type VerifiedOidcContextInput,
  type WorkspaceProjectDiscoveryAuthorizationPort,
  type WorkspaceProjectDiscoveryScanResult,
} from '@zhiju/identity-policy';
import {
  readWorkspaceProjectSummary,
  type EnterpriseProjectDb,
  type WorkspaceProjectSummaryView,
} from '@zhiju/enterprise-project';
import { newUuidV7, sha256CanonicalJson, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  assertIntegrity,
  createDecisionBoundary,
  entryError,
  payloadHashOf,
  record,
  type DecisionRow,
  type IdentityBoundaryConfig,
  type RequestScope,
} from './decision-boundary.js';

/** The registered directory operation this entry owns. */
export const WORKSPACE_DIRECTORY_QUERY = 'project.find_workspace_projects';
export const WORKSPACE_DIRECTORY_QUERY_VERSION = '1.0';

/** Cursor failure codes; they match the frozen Core public table verbatim. */
const QUERY_CURSOR_SCOPE_MISMATCH = 'QUERY_CURSOR_SCOPE_MISMATCH';
const QUERY_CURSOR_EXPIRED = 'QUERY_CURSOR_EXPIRED';
const QUERY_CURSOR_INVALID = 'QUERY_CURSOR_INVALID';

const CURSOR_VERSION = '1';
const CURSOR_TTL_MS = 5 * 60 * 1000;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,512}$/u;
const MAC_BYTES = 32;

const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;

/** Hard per-request candidate read budget (Session Delta §4: 200 items/5s). */
export const WORKSPACE_DIRECTORY_MAX_CANDIDATES = 200;
export const WORKSPACE_DIRECTORY_WALL_BUDGET_MS = 5000;

/**
 * The technical bootstrap Enterprise/Principal used only to establish a valid
 * RLS context while the verified Human is resolved; never a business scope.
 */
const BOOTSTRAP_ENTERPRISE_ID = '00000000-0000-7000-8000-000000000000';
const BOOTSTRAP_PRINCIPAL_ID = '00000000-0000-7000-8000-000000000001';

/** The two trusted capability codes this entry resolves. */
export interface WorkspaceDirectoryCapabilityCodes {
  readonly workspaceProjectDiscoveryHumanV1: string;
  readonly projectBoardSliceReadHumanV1: string;
}

export interface WorkspaceDirectoryEntryConfig extends IdentityBoundaryConfig {
  /** Owning EnterpriseProject database handle over an application-owned pool. */
  readonly enterpriseProjectDb: Kysely<EnterpriseProjectDb>;
  /** Trusted capability codes of the two discovery-slice authorization entries. */
  readonly capabilityCodes: WorkspaceDirectoryCapabilityCodes;
  /** Hard caps; a deployment may only tighten them. */
  readonly budgets?:
    | {
        readonly maxCandidates?: number | undefined;
        readonly wallBudgetMs?: number | undefined;
      }
    | undefined;
}

/**
 * The trusted directory session. `context` is the verifier-produced OIDC
 * context (only the trusted Core verifier can construct it) and `sessionBinding`
 * is the BFF's random per-login binding. Neither is caller-chosen.
 */
export interface WorkspaceDirectorySession {
  readonly context: VerifiedOidcContextInput;
  readonly sessionBinding: Buffer;
}

export interface WorkspaceDirectoryEntry {
  findWorkspaceProjects(
    envelope: unknown,
    session: WorkspaceDirectorySession,
  ): Promise<Record<string, unknown>>;
}

/**
 * The decoded cursor. Digests are hex internally; the wire form stores each as
 * the base64url of its 32 raw bytes and the sort key as the base64url of the two
 * packed UUIDs, so one cursor stays well under the shared 512-character bound.
 */
interface DirectoryCursorBody {
  readonly o: string;
  readonly ver: string;
  /** Composite binding over principal/session/filter/authorization fingerprint. */
  readonly b: string;
  /** Authorization fingerprint of the page chain (verbatim IP scan binding). */
  readonly af: string;
  /** IP source watermark sequence (partition derives from the principal). */
  readonly n: number;
  /** EP source watermark sequence (authorized summaries read on the chain's first page). */
  readonly q: number;
  readonly lastSortKey: { readonly enterpriseId: string; readonly projectId: string };
  /** First-page snapshot instant, in epoch milliseconds. */
  readonly t: number;
  readonly x: number;
}

interface NormalizedFilter {
  readonly enterpriseId: string | null;
  readonly searchText: string | null;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * A technical RLS context. It is not a business Decision, ActorSnapshot or
 * Audit fact: it exists only so the owning transaction can be established while
 * the verified Human is resolved or one candidate is authorized.
 */
function bootstrapContext(params: {
  readonly principalId: string;
  readonly enterpriseId: string;
  readonly allowedProjectIds: readonly string[];
  readonly now: Date;
  /**
   * ActorSnapshot the trusted technical context is bound to. The owning
   * Decision Ports require `context.actorSnapshotId` to equal the presented
   * ActorSnapshot id, so a caller that mints a snapshot must pass its id here
   * instead of letting the context generate an unrelated one.
   */
  readonly actorSnapshotId?: string;
}): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: params.principalId,
    actorSnapshotId: params.actorSnapshotId ?? newUuidV7(),
    authorizationDecisionId: newUuidV7(),
    authorizationDecisionHash: Buffer.from(
      sha256CanonicalJson({ purpose: 'project.find_workspace_projects.bootstrap' }),
      'hex',
    ),
    authorizationDecisionExpiresAt: new Date(params.now.getTime() + 300_000),
    enterpriseId: params.enterpriseId,
    allowedProjectIds: [...params.allowedProjectIds],
    correlationId: newUuidV7(),
  };
}

function principalBindingHash(resolution: VerifiedHumanResolution): string {
  return sha256CanonicalJson({
    principalId: resolution.principalRef.objectId,
    principalKind: resolution.principalKind,
  });
}

function bindingDigest(input: {
  readonly operation: string;
  readonly version: string;
  readonly principalBindingHash: string;
  readonly sessionBindingHash: string;
  readonly filterHash: string;
  readonly authorizationFingerprint: string;
}): string {
  return sha256CanonicalJson({
    operation: input.operation,
    version: input.version,
    principalBindingHash: input.principalBindingHash,
    sessionBindingHash: input.sessionBindingHash,
    filterHash: input.filterHash,
    authorizationFingerprint: input.authorizationFingerprint,
  });
}

/** Compact a 32-byte digest for the wire cursor. */
function toWireDigest(hex: string): string {
  return Buffer.from(hex, 'hex').toString('base64url');
}

function fromWireDigest(value: string): string | undefined {
  const buffer = Buffer.from(value, 'base64url');
  return buffer.length === 32 ? buffer.toString('hex') : undefined;
}

function formatUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20)}`;
}

function packSortKey(enterpriseId: string, projectId: string): string {
  return Buffer.concat([
    Buffer.from(enterpriseId.replaceAll('-', ''), 'hex'),
    Buffer.from(projectId.replaceAll('-', ''), 'hex'),
  ]).toString('base64url');
}

function unpackSortKey(
  packed: string,
): { readonly enterpriseId: string; readonly projectId: string } | undefined {
  const buffer = Buffer.from(packed, 'base64url');
  if (buffer.length !== 32) return undefined;
  const hex = buffer.toString('hex');
  return { enterpriseId: formatUuid(hex.slice(0, 32)), projectId: formatUuid(hex.slice(32)) };
}

function encodeCursor(body: DirectoryCursorBody, macKey: Buffer): string {
  const wire = {
    v: CURSOR_VERSION,
    o: body.o,
    ver: body.ver,
    b: toWireDigest(body.b),
    af: toWireDigest(body.af),
    n: body.n,
    q: body.q,
    k: packSortKey(body.lastSortKey.enterpriseId, body.lastSortKey.projectId),
    t: body.t,
    x: body.x,
  };
  const payload = Buffer.from(JSON.stringify(wire), 'utf8');
  const mac = createHmac('sha256', macKey).update(payload).digest();
  return Buffer.concat([payload, mac]).toString('base64url');
}

function decodeCursor(token: string, macKey: Buffer): DirectoryCursorBody {
  if (!CURSOR_PATTERN.test(token)) {
    entryError(QUERY_CURSOR_INVALID, 'cursor is not an opaque token');
  }
  const raw = Buffer.from(token, 'base64url');
  if (raw.length <= MAC_BYTES) {
    entryError(QUERY_CURSOR_INVALID, 'cursor body is too short');
  }
  const payload = raw.subarray(0, raw.length - MAC_BYTES);
  const mac = raw.subarray(raw.length - MAC_BYTES);
  const expected = createHmac('sha256', macKey).update(payload).digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    entryError(QUERY_CURSOR_INVALID, 'cursor MAC does not verify');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.toString('utf8'));
  } catch {
    entryError(QUERY_CURSOR_INVALID, 'cursor body is malformed');
  }
  const body = record(parsed);
  const binding = typeof body.b === 'string' ? fromWireDigest(body.b) : undefined;
  const fingerprint = typeof body.af === 'string' ? fromWireDigest(body.af) : undefined;
  const sortKey = typeof body.k === 'string' ? unpackSortKey(body.k) : undefined;
  if (
    body.v !== CURSOR_VERSION ||
    typeof body.o !== 'string' ||
    typeof body.ver !== 'string' ||
    binding === undefined ||
    fingerprint === undefined ||
    typeof body.n !== 'number' ||
    !Number.isSafeInteger(body.n) ||
    typeof body.q !== 'number' ||
    !Number.isSafeInteger(body.q) ||
    sortKey === undefined ||
    typeof body.t !== 'number' ||
    !Number.isSafeInteger(body.t) ||
    typeof body.x !== 'number' ||
    !Number.isSafeInteger(body.x)
  ) {
    entryError(QUERY_CURSOR_INVALID, 'cursor shape is invalid');
  }
  return {
    o: body.o,
    ver: body.ver,
    b: binding,
    af: fingerprint,
    n: body.n,
    q: body.q,
    lastSortKey: sortKey,
    t: body.t,
    x: body.x,
  };
}

function normalizeFilter(payload: Record<string, unknown>): NormalizedFilter {
  const enterpriseRef = isRecordValue(payload.enterpriseRef) ? payload.enterpriseRef : undefined;
  const enterpriseId = enterpriseRef === undefined ? undefined : asString(enterpriseRef.objectId);
  const searchText = asString(payload.searchText)?.trim().toLowerCase();
  return {
    enterpriseId: enterpriseId ?? null,
    searchText: searchText === undefined || searchText.length === 0 ? null : searchText,
  };
}

function matchesFilter(summary: WorkspaceProjectSummaryView, filter: NormalizedFilter): boolean {
  if (filter.enterpriseId !== null && summary.enterpriseId !== filter.enterpriseId) return false;
  if (filter.searchText === null) return true;
  return (
    summary.title.toLowerCase().includes(filter.searchText) ||
    summary.displayCode.toLowerCase().includes(filter.searchText)
  );
}

/** The owning EP read must observe exactly the candidate's Project scope. */
function candidateScope(candidate: Common.ObjectRef): RequestScope {
  const scope = record(candidate.scope);
  const enterpriseId = asString(scope.enterpriseId);
  const projectId = asString(scope.projectId);
  if (enterpriseId === undefined || projectId === undefined) {
    entryError(SCOPE_MISMATCH, 'the discovery candidate is not an exact Project scope');
  }
  return { scopeKind: 'PROJECT', enterpriseId, projectId };
}

export function createWorkspaceDirectoryEntry(
  config: WorkspaceDirectoryEntryConfig,
): WorkspaceDirectoryEntry {
  const registry = getContractRegistry();
  const boundary = createDecisionBoundary(config);
  const now = config.now ?? ((): Date => new Date());
  const maxCandidates = config.budgets?.maxCandidates ?? WORKSPACE_DIRECTORY_MAX_CANDIDATES;
  const wallBudgetMs = config.budgets?.wallBudgetMs ?? WORKSPACE_DIRECTORY_WALL_BUDGET_MS;
  const discoveryPort: WorkspaceProjectDiscoveryAuthorizationPort =
    createWorkspaceProjectDiscoveryPort({
      capabilityCodes: {
        workspaceProjectDiscoveryHumanV1: config.capabilityCodes.workspaceProjectDiscoveryHumanV1,
        projectBoardSliceReadHumanV1: config.capabilityCodes.projectBoardSliceReadHumanV1,
      },
      ...(config.now === undefined ? {} : { now: config.now }),
    });
  const binding = WORKSPACE_PROJECT_DISCOVERY_BINDINGS.workspaceProjectDiscoveryHumanV1;

  function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
    return {
      db: config.identity.db,
      repo: config.identity.repo,
      crypto: config.identity.crypto,
      context,
    };
  }

  function resolveHuman(session: WorkspaceDirectorySession): Promise<VerifiedHumanResolution> {
    return resolveVerifiedHuman(
      identityDeps(
        bootstrapContext({
          principalId: BOOTSTRAP_PRINCIPAL_ID,
          enterpriseId: BOOTSTRAP_ENTERPRISE_ID,
          allowedProjectIds: [],
          now: now(),
        }),
      ),
      session.context,
    );
  }

  async function runScan(input: {
    readonly session: WorkspaceDirectorySession;
    readonly resolution: VerifiedHumanResolution;
    readonly pageSize: number;
    readonly cursor: DirectoryCursorBody | undefined;
  }): Promise<WorkspaceProjectDiscoveryScanResult> {
    const deps = identityDeps(
      bootstrapContext({
        principalId: input.resolution.principalRef.objectId,
        enterpriseId: BOOTSTRAP_ENTERPRISE_ID,
        allowedProjectIds: [],
        now: now(),
      }),
    );
    let scanCursor: string | undefined;
    if (input.cursor !== undefined) {
      const after = input.cursor.lastSortKey;
      scanCursor = Buffer.from(
        JSON.stringify({
          v: '1',
          fingerprint: input.cursor.af,
          principalId: input.resolution.principalRef.objectId,
          capabilityCode: config.capabilityCodes.workspaceProjectDiscoveryHumanV1,
          after,
        }),
        'utf8',
      ).toString('base64url');
    }
    try {
      return await discoverWorkspaceProjectScopes(
        deps,
        {
          capabilityCode: config.capabilityCodes.workspaceProjectDiscoveryHumanV1,
          requiredGrantAction: binding.requiredGrantAction,
          ...(config.now === undefined ? {} : { now: config.now }),
        },
        {
          authenticationContextHash: input.resolution.authenticationContextHash,
          sessionBindingHash: input.session.sessionBinding,
          principalId: input.resolution.principalRef.objectId,
          principalKind: input.resolution.principalKind,
          pageSize: input.pageSize,
          ...(scanCursor === undefined ? {} : { cursor: scanCursor }),
        },
      );
    } catch (error) {
      if (
        error instanceof SnapshotBoundaryError &&
        error.code === IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID &&
        input.cursor !== undefined
      ) {
        // A valid-MAC cursor whose discovery authorization set changed: the
        // client must restart from page one.
        entryError(QUERY_CURSOR_SCOPE_MISMATCH, 'the discovery authorization set changed');
      }
      throw error;
    }
  }

  /**
   * Mints the PROJECT-scoped ActorSnapshot and the `project.workspace.discover`
   * Decision of one candidate, or returns `undefined` when the candidate is
   * DENY (skipped without any EP read).
   */
  async function authorizeCandidate(input: {
    readonly resolution: VerifiedHumanResolution;
    readonly candidate: Common.ObjectRef;
    readonly directoryQueryId: string;
    readonly normalizedFilter: NormalizedFilter;
    readonly pageBindingHash: string;
  }): Promise<
    | {
        readonly decisionRef: Common.ContentAddressedRef;
        readonly row: DecisionRow;
        readonly scope: RequestScope;
      }
    | undefined
  > {
    const scope = candidateScope(input.candidate);
    const actorSnapshotId = newUuidV7();
    const contextFor = (): IdentityTransactionContext =>
      bootstrapContext({
        principalId: input.resolution.principalRef.objectId,
        enterpriseId: scope.enterpriseId,
        allowedProjectIds: [scope.projectId],
        now: now(),
        actorSnapshotId,
      });
    const actorSnapshotRef = await createActorSnapshot(identityDeps(contextFor()), {
      actorSnapshotId,
      principalId: input.resolution.principalRef.objectId,
      declaredPrincipalKind: input.resolution.principalKind,
      authenticationContextHash: input.resolution.authenticationContextHash,
      scopeKind: 'PROJECT',
      enterpriseId: scope.enterpriseId,
      projectId: scope.projectId,
    });
    const deps = identityDeps(contextFor());
    const issued = await discoveryPort.authorizeCandidate(deps, {
      actorSnapshotRef,
      commandType: binding.commandType,
      commandVersion: binding.commandVersion,
      commandPayloadHash: payloadHashOf({
        directoryQueryId: input.directoryQueryId,
        projectRef: input.candidate,
        normalizedFilter: { ...input.normalizedFilter },
        pageBindingHash: input.pageBindingHash,
      }),
      authenticationContextHash: input.resolution.authenticationContextHash,
      targetRef: input.candidate,
    });
    if (issued.outcome !== 'ALLOW') return undefined;
    const row = await boundary.readDecisionRow(issued.authorizationDecisionRef, scope);
    return { decisionRef: issued.authorizationDecisionRef, row, scope };
  }

  /** Revalidate one used candidate Decision; a failure fails the whole page. */
  async function revalidateCandidate(input: {
    readonly resolution: VerifiedHumanResolution;
    readonly decisionRef: Common.ContentAddressedRef;
    readonly scope: RequestScope;
    readonly candidate: Common.ObjectRef;
    readonly directoryQueryId: string;
    readonly normalizedFilter: NormalizedFilter;
    readonly pageBindingHash: string;
    /** The Decision's own ActorSnapshot: the owning revalidation compares it. */
    readonly actorSnapshotId: string;
  }): Promise<void> {
    const deps = identityDeps(
      bootstrapContext({
        principalId: input.resolution.principalRef.objectId,
        enterpriseId: input.scope.enterpriseId,
        allowedProjectIds: [input.scope.projectId],
        now: now(),
        actorSnapshotId: input.actorSnapshotId,
      }),
    );
    const result = await discoveryPort.revalidateCandidate(deps, {
      decisionRef: input.decisionRef,
      expectedCommandType: binding.commandType,
      expectedCommandVersion: binding.commandVersion,
      expectedCommandPayloadHash: payloadHashOf({
        directoryQueryId: input.directoryQueryId,
        projectRef: input.candidate,
        normalizedFilter: { ...input.normalizedFilter },
        pageBindingHash: input.pageBindingHash,
      }),
      expectedAuthenticationContextHash: input.resolution.authenticationContextHash,
      expectedTargetRef: input.candidate,
    });
    if (!result.valid) {
      entryError(AUTHORIZATION_REVOKED, 'directory authorization is no longer current');
    }
  }

  return {
    async findWorkspaceProjects(value, session) {
      const envelope = record(value);
      if (
        envelope.queryType !== WORKSPACE_DIRECTORY_QUERY ||
        envelope.queryVersion !== WORKSPACE_DIRECTORY_QUERY_VERSION
      ) {
        entryError(API_CONTRACT_TYPE_UNKNOWN, 'unsupported workspace directory query');
      }
      if (
        !registry.validateOperation(
          WORKSPACE_DIRECTORY_QUERY,
          WORKSPACE_DIRECTORY_QUERY_VERSION,
          envelope,
        ).valid
      ) {
        entryError(API_VALUE_INVALID, 'invalid workspace directory envelope');
      }
      // The declared self-discovery exception: only an exactly empty scope is
      // accepted, and any other scope is refused rather than treated as access.
      if (Object.keys(record(envelope.scopeRef)).length !== 0) {
        entryError(
          SCOPE_MISMATCH,
          'the workspace directory only accepts an empty self-discovery scope',
        );
      }

      const queryId = String(envelope.queryId);
      const correlationId = String(envelope.correlationId);
      const payload = record(envelope.payload);
      const page = record(payload.page);
      const pageSize = page.pageSize;
      if (
        typeof pageSize !== 'number' ||
        !Number.isSafeInteger(pageSize) ||
        pageSize < MIN_PAGE_SIZE ||
        pageSize > MAX_PAGE_SIZE
      ) {
        entryError(API_VALUE_INVALID, 'payload.page.pageSize must be an integer in [1, 50]');
      }
      if (envelope.integrity !== undefined) {
        assertIntegrity(envelope.integrity, payloadHashOf(payload));
      }
      const incomingCursor = asString(page.cursor);

      const resolution = await resolveHuman(session);
      const sessionBindingHash = session.sessionBinding.toString('hex');
      const normalizedFilter = normalizeFilter(payload);
      const filterHash = sha256CanonicalJson({ ...normalizedFilter });
      const pageBindingHash = sha256CanonicalJson({
        operation: WORKSPACE_DIRECTORY_QUERY,
        version: WORKSPACE_DIRECTORY_QUERY_VERSION,
        pageSize,
        cursor: incomingCursor ?? null,
      });

      let cursor: DirectoryCursorBody | undefined;
      if (incomingCursor !== undefined) {
        cursor = decodeCursor(incomingCursor, session.sessionBinding);
        if (
          cursor.o !== WORKSPACE_DIRECTORY_QUERY ||
          cursor.ver !== WORKSPACE_DIRECTORY_QUERY_VERSION
        ) {
          entryError(QUERY_CURSOR_INVALID, 'cursor belongs to another operation or version');
        }
        if (cursor.x <= now().getTime()) {
          entryError(QUERY_CURSOR_EXPIRED, 'cursor has expired');
        }
      }

      const scan = await runScan({ session, resolution, pageSize, cursor });
      const snapshotAt = cursor === undefined ? now() : new Date(cursor.t);
      if (cursor !== undefined) {
        const observedSequence = scan.sourceWatermarks[0]?.sequence;
        if (observedSequence !== cursor.n) {
          entryError(QUERY_CURSOR_INVALID, 'the IP source watermark advanced');
        }
        const expectedBinding = bindingDigest({
          operation: WORKSPACE_DIRECTORY_QUERY,
          version: WORKSPACE_DIRECTORY_QUERY_VERSION,
          principalBindingHash: principalBindingHash(resolution),
          sessionBindingHash,
          filterHash,
          authorizationFingerprint: cursor.af,
        });
        if (scan.authorizationFingerprint !== cursor.af || cursor.b !== expectedBinding) {
          entryError(QUERY_CURSOR_SCOPE_MISMATCH, 'the cursor binding is no longer current');
        }
      }

      const startedAt = now().getTime();
      const items: WorkspaceProjectSummaryView[] = [];
      const used: {
        readonly candidate: Common.ObjectRef;
        readonly decisionRef: Common.ContentAddressedRef;
        readonly scope: RequestScope;
        readonly row: DecisionRow;
        readonly observed: WorkspaceProjectSummaryView;
      }[] = [];
      let examined = 0;
      let hasMore = scan.nextCursor !== undefined;
      let lastKey = cursor === undefined ? undefined : cursor.lastSortKey;

      for (const candidate of scan.items) {
        const budgetExhausted =
          examined >= maxCandidates || now().getTime() - startedAt > wallBudgetMs;
        if (budgetExhausted) {
          // The budget is exhausted with candidates remaining: the page is
          // legally empty and the bound cursor lets the client continue.
          items.length = 0;
          used.length = 0;
          hasMore = true;
          break;
        }
        examined += 1;
        const scope = candidateScope(candidate.projectRef);
        lastKey = { enterpriseId: scope.enterpriseId, projectId: scope.projectId };
        const authorized = await authorizeCandidate({
          resolution,
          candidate: candidate.projectRef,
          directoryQueryId: queryId,
          normalizedFilter,
          pageBindingHash,
        });
        if (authorized === undefined) continue;
        const view = await readWorkspaceProjectSummary(
          config.enterpriseProjectDb,
          boundary.enterpriseProjectContext(authorized.row, authorized.scope, correlationId),
          { enterpriseId: authorized.scope.enterpriseId, projectId: authorized.scope.projectId },
        );
        if (view === undefined) continue;
        used.push({
          candidate: candidate.projectRef,
          decisionRef: authorized.decisionRef,
          scope: authorized.scope,
          row: authorized.row,
          observed: view,
        });
        if (!matchesFilter(view, normalizedFilter)) continue;
        items.push(view);
      }

      // Revalidate every Decision that contributed to the page before it leaves;
      // one failure fails the whole page, never a partial page. The owning read
      // is repeated in the same context so a changed EnterpriseProject
      // observation rejects the page instead of returning a value no current
      // read can reproduce.
      for (const usedEntry of used) {
        await revalidateCandidate({
          resolution,
          decisionRef: usedEntry.decisionRef,
          scope: usedEntry.scope,
          candidate: usedEntry.candidate,
          directoryQueryId: queryId,
          normalizedFilter,
          pageBindingHash,
          actorSnapshotId: usedEntry.row.actor_snapshot_id,
        });
        const observed = await readWorkspaceProjectSummary(
          config.enterpriseProjectDb,
          boundary.enterpriseProjectContext(usedEntry.row, usedEntry.scope, correlationId),
          { enterpriseId: usedEntry.scope.enterpriseId, projectId: usedEntry.scope.projectId },
        );
        const observationChanged =
          observed?.aggregateVersion !== usedEntry.observed.aggregateVersion ||
          observed.status !== usedEntry.observed.status;
        if (observationChanged) {
          entryError(
            QUERY_CURSOR_INVALID,
            'the EnterpriseProject observation changed before the page returned',
          );
        }
      }

      const summaries = items.map((view) => ({
        enterpriseRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.project.enterprise',
          objectId: view.enterpriseId,
          scope: { enterpriseId: view.enterpriseId },
        },
        projectRef: {
          kind: 'OBJECT',
          objectType: objectTypeOfProject(scan, view.projectId),
          objectId: view.projectId,
          scope: { enterpriseId: view.enterpriseId, projectId: view.projectId },
        },
        enterpriseDisplayName: view.enterpriseDisplayName,
        displayCode: view.displayCode,
        title: view.title,
        status: view.status,
        aggregateVersion: view.aggregateVersion,
      }));

      const sequence = scan.sourceWatermarks[0]?.sequence ?? 0;
      // The EP owning read exposes no per-read watermark, so the page records
      // the count of authorized summaries it actually observed; the first-page
      // value is carried across the chain so later pages never drift it.
      const epSequence = cursor === undefined ? used.length : cursor.q;
      const sourceWatermarks: Common.SourceWatermark[] = [
        {
          sourceModule: 'identity_policy',
          partition: `workspace_project_discovery:${resolution.principalRef.objectId}`,
          sequence,
          observedAt: snapshotAt.toISOString(),
        },
        {
          sourceModule: 'enterprise_project',
          partition: `workspace_directory:${resolution.principalRef.objectId}`,
          sequence: epSequence,
          observedAt: snapshotAt.toISOString(),
        },
      ];

      let nextCursor: string | undefined;
      if (hasMore && lastKey !== undefined) {
        nextCursor = encodeCursor(
          {
            o: WORKSPACE_DIRECTORY_QUERY,
            ver: WORKSPACE_DIRECTORY_QUERY_VERSION,
            b: bindingDigest({
              operation: WORKSPACE_DIRECTORY_QUERY,
              version: WORKSPACE_DIRECTORY_QUERY_VERSION,
              principalBindingHash: principalBindingHash(resolution),
              sessionBindingHash,
              filterHash,
              authorizationFingerprint: scan.authorizationFingerprint,
            }),
            af: scan.authorizationFingerprint,
            n: sequence,
            q: epSequence,
            lastSortKey: lastKey,
            t: snapshotAt.getTime(),
            x: now().getTime() + CURSOR_TTL_MS,
          },
          session.sessionBinding,
        );
      }

      const pageObject: Record<string, unknown> = { items: summaries };
      if (nextCursor !== undefined) pageObject.nextCursor = nextCursor;
      pageObject.snapshotAt = snapshotAt.toISOString();
      pageObject.sourceWatermarks = sourceWatermarks;
      if (
        !registry.validateOperationResult(
          WORKSPACE_DIRECTORY_QUERY,
          WORKSPACE_DIRECTORY_QUERY_VERSION,
          pageObject,
        ).valid
      ) {
        entryError(
          DEPENDENCY_UNAVAILABLE,
          'the directory page does not satisfy its registered schema',
        );
      }

      const envelopeObject: Record<string, unknown> = {
        queryId,
        status: 'OK',
        data: pageObject,
        snapshotAt: snapshotAt.toISOString(),
        sourceWatermarks,
        stalenessStatus: 'FRESH',
        redactions: [],
      };
      if (nextCursor !== undefined) envelopeObject.nextCursor = nextCursor;
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
    },
  };
}

/**
 * The owning Project object type the scan reported for one served project.
 */
function objectTypeOfProject(scan: WorkspaceProjectDiscoveryScanResult, projectId: string): string {
  const match = scan.items.find((item) => item.projectRef.objectId === projectId);
  return match?.projectRef.objectType ?? 'zhiju.project.project';
}
