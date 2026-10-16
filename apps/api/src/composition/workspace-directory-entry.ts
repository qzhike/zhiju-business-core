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
//      one failed revalidation fails the whole page (never a partial page). A
//      page that the per-request budget cut still delivers every summary it
//      accumulated: only a page with no accumulated match may be an empty
//      intermediate page, and its cursor continues after the last examined
//      candidate, so no undelivered card is skipped;
//   7. the cursor is an opaque HMAC value keyed by the request session binding
//      and binding the principal, session, filter, authorization fingerprint,
//      IP source watermark, last sort key and chain snapshot instant with a
//      5-minute expiry;
//   8. the cursor additionally carries the chain's *whole* served set — the
//      registered Project identity spelling and the Enterprise+Project ids plus
//      the observed `aggregateVersion`/`status` of every summary the chain has
//      served so far — so every continuation re-reads *every* served project in
//      its exact Enterprise+Project scope (a fresh per-candidate Decision, its
//      revalidation and the owning EnterpriseProject read) and restarts with
//      `QUERY_CURSOR_INVALID` when one of them changed, lost its Decision or
//      disappeared. The re-authorized carried entries are kept and participate in
//      the before-return checkpoint as well: after this page's new reads they are
//      revalidated and re-observed once more, so a project that changes *while*
//      the new page is being scanned cannot let a stale card leave in a chain
//      whose final page emits no further cursor. The carried set is bounded by
//      this Query's declared cursor bound (`^[A-Za-z0-9_-]{16,8192}$`, R5
//      option (a)); a chain whose served set outgrows that capacity fails closed
//      with `QUERY_CURSOR_INVALID` rather than dropping a carried observation.
//
// A legal page is always `OK + Page<WorkspaceProjectSummary>` — including an
// empty intermediate page (`items=[] + nextCursor`) when the filter or the scan
// budget left candidates unread and nothing matched. No global total, no foreign
// count and no unauthorized existence signal is ever produced.

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
  WORKSPACE_PROJECT_OBJECT_TYPES,
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

const CURSOR_TTL_MS = 5 * 60 * 1000;
/**
 * This Query's *declared* cursor bound (R5 option (a)): the same closed alphabet
 * as the shared `opaqueCursor`, with `minLength 16` and `maxLength 8192` instead
 * of the shared 512, because the cursor carries the chain's whole served set.
 * The bound applies to the request `page.cursor` and to the result page cursor
 * alike; every other Query keeps the shared `opaqueCursor` unchanged.
 */
const CURSOR_MIN_CHARS = 16;
const CURSOR_MAX_CHARS = 8192;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,8192}$/u;
const MAC_BYTES = 32;

/** Binary cursor body layout version; a foreign body is `QUERY_CURSOR_INVALID`. */
const CURSOR_FORMAT_VERSION = 2;
const CURSOR_MAX_OPERATION_BYTES = 64;
const CURSOR_MAX_VERSION_BYTES = 16;
/** 48-bit chain-stable projection of a served-observation digest. */
const CURSOR_WATERMARK_HEX_CHARS = 12;
/**
 * Structural cap on one cursor's carried served set. The declared character
 * bound already caps a legitimate cursor far below this — the shortest carried
 * observation is 42 bytes, so 8192 characters cannot carry more than ~140 of
 * them — and the cap only keeps a malformed body from driving an unbounded
 * decode loop.
 */
const CURSOR_MAX_SERVED_OBSERVATIONS = 1024;

/**
 * The one failure message of a cursor that cannot carry the chain's served set
 * within this Query's declared bound. The client restarts at page one: dropping a
 * carried observation instead would let a card stay served after it changed.
 */
const CURSOR_CAPACITY_MESSAGE = 'the chain served set exceeded the declared cursor capacity';

/** The closed EnterpriseProject status enum of one carried observation. */
const DIRECTORY_STATUS_CODES = Object.freeze([
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
  'PREPARING',
] as const);

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
 * The sort-key boundary of one candidate or one served window: the packed
 * Enterprise+Project UUIDs in the exact order the IP self-discovery scan returns.
 */
interface DirectorySortKey {
  readonly enterpriseId: string;
  readonly projectId: string;
}

/**
 * One carried served observation: the identity of a card the chain has already
 * served plus the two owning EnterpriseProject facts a continuation re-observes.
 *
 * The Project identity spelling travels with the card because a continuation
 * re-mints the fresh per-candidate Decision over the *same* candidate identity
 * the serving page authorized: the owning Grant selector must equal the
 * presented target object type exactly, so re-deriving the spelling from the
 * project id (or canonicalising it) would deny a legitimate continuation whose
 * Grant is registered under the other accepted Project spelling.
 */
interface DirectoryServedObservation {
  readonly objectType: string;
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly aggregateVersion: number;
  readonly status: WorkspaceProjectSummaryView['status'];
}

/**
 * One entry the before-return checkpoint revalidates: a candidate this page
 * newly authorized, or a carried observation the start-of-continuation check
 * re-authorized. The checkpoint keeps the Decision the entry was authorized
 * under and the EnterpriseProject summary it observed, so a second revalidation
 * and owning read can prove the card is still reproducible when the page leaves.
 */
interface DirectoryCheckpointEntry {
  readonly candidate: Common.ObjectRef;
  readonly decisionRef: Common.ContentAddressedRef;
  readonly scope: RequestScope;
  readonly row: DecisionRow;
  readonly observed: WorkspaceProjectSummaryView;
}

/**
 * The decoded cursor.
 *
 * The body is a compact, fixed-layout binary (see `encodeCursor`/`parseCursorBody`)
 * rather than JSON: a chain has to carry every served card's identity and its two
 * re-observed EnterpriseProject facts, and JSON plus a second base64url layer for
 * each 32-byte digest would waste the declared 8192-character cursor bound.
 *
 * Besides the unchanged IP watermark, grant-set and
 * principal/session/filter binding, the cursor binds two real EnterpriseProject
 * observations to the continuation:
 *
 *   * `firstDigest` — the digest of the summaries the chain's first page served,
 *     carried verbatim so the chain-stable EnterpriseProject watermark never
 *     becomes a copied page count; and
 *   * `served` — *every* summary the chain has served so far, in chain order, so
 *     a continuation re-reads all of them (not just the first page and the
 *     immediately preceding page) and rejects the whole page as soon as one of
 *     them changed, lost its Decision or disappeared.
 */
interface DirectoryCursorBody {
  readonly operation: string;
  readonly version: string;
  /** Composite binding over principal/session/filter/authorization fingerprint. */
  readonly binding: string;
  /** Authorization fingerprint of the page chain (verbatim IP scan binding). */
  readonly authorizationFingerprint: string;
  /** IP source watermark sequence (partition derives from the principal). */
  readonly ipSequence: number;
  /** Last candidate this page examined; the next page scans strictly after it. */
  readonly lastSortKey: DirectorySortKey;
  /** Digest of the summaries the chain's first page served. */
  readonly firstDigest: string;
  /** Every summary the chain has served so far, in chain order. */
  readonly served: readonly DirectoryServedObservation[];
  /** First-page snapshot instant, in epoch milliseconds. */
  readonly snapshotMs: number;
  /** Expiry instant, in epoch milliseconds. */
  readonly expiresMs: number;
}

/**
 * The canonical (cv1) digest of the summaries a page actually served, in order.
 * `aggregateVersion` and `status` are the owning EnterpriseProject facts a
 * continuation must re-observe; `enterpriseId`/`projectId` bind the digest to the
 * exact cards it covers, so a Project that disappears or a card that resolves
 * differently also changes the digest.
 */
function servedObservationDigest(summaries: readonly WorkspaceProjectSummaryView[]): string {
  return sha256CanonicalJson({
    observations: summaries.map((summary) => ({
      enterpriseId: summary.enterpriseId,
      projectId: summary.projectId,
      aggregateVersion: summary.aggregateVersion,
      status: summary.status,
    })),
  });
}

/**
 * The chain-stable EnterpriseProject watermark: a 48-bit projection of the
 * chain's first-page served-observation digest. It is derived from the EP facts
 * the chain observed (never a copied page count) and stays constant for the whole
 * chain, because every continuation carries the first-page digest verbatim.
 */
function enterpriseProjectWatermarkSequence(firstPageDigest: string): number {
  return Number.parseInt(firstPageDigest.slice(0, CURSOR_WATERMARK_HEX_CHARS), 16);
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

function formatUuid(hex32: string): string {
  return `${hex32.slice(0, 8)}-${hex32.slice(8, 12)}-${hex32.slice(12, 16)}-${hex32.slice(16, 20)}-${hex32.slice(20)}`;
}

/** Packs one dashed UUID into the 16 bytes the owning Project identity uses. */
function packUuid(value: string): Buffer {
  const bytes = Buffer.from(value.replaceAll('-', ''), 'hex');
  if (bytes.length !== 16) {
    entryError(DEPENDENCY_UNAVAILABLE, 'a directory identity is not a UUID value');
  }
  return bytes;
}

function digestBytesOf(hex: string): Buffer {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length !== 32) {
    entryError(DEPENDENCY_UNAVAILABLE, 'a directory digest is not a SHA-256 value');
  }
  return bytes;
}

function packSortKey(key: DirectorySortKey): Buffer {
  const bytes = Buffer.from(
    `${key.enterpriseId.replaceAll('-', '')}${key.projectId.replaceAll('-', '')}`,
    'hex',
  );
  if (bytes.length !== 32) {
    entryError(DEPENDENCY_UNAVAILABLE, 'a directory sort key is not a pair of UUIDs');
  }
  return bytes;
}

function unpackSortKey(bytes: Buffer): DirectorySortKey {
  const hex = bytes.toString('hex');
  return { enterpriseId: formatUuid(hex.slice(0, 32)), projectId: formatUuid(hex.slice(32)) };
}

function uint64Bytes(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    entryError(DEPENDENCY_UNAVAILABLE, 'a directory cursor number is out of range');
  }
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

/**
 * Packs one carried served observation. It is the widest part of a cursor, so it
 * uses the closed one-byte codes of the registered Project identity spellings and
 * of the EnterpriseProject status enum instead of their text.
 */
function encodeServedObservation(observation: DirectoryServedObservation): Buffer {
  const objectTypeCode = WORKSPACE_PROJECT_OBJECT_TYPES.indexOf(observation.objectType);
  if (objectTypeCode === -1) {
    entryError(DEPENDENCY_UNAVAILABLE, 'a directory card carries an unregistered Project spelling');
  }
  const statusCode = DIRECTORY_STATUS_CODES.indexOf(observation.status);
  if (statusCode === -1) {
    entryError(DEPENDENCY_UNAVAILABLE, 'a directory card carries an unregistered status');
  }
  return Buffer.concat([
    Buffer.from([objectTypeCode]),
    packUuid(observation.enterpriseId),
    packUuid(observation.projectId),
    uint64Bytes(observation.aggregateVersion),
    Buffer.from([statusCode]),
  ]);
}

function encodeCursor(body: DirectoryCursorBody, macKey: Buffer): string {
  const operation = Buffer.from(body.operation, 'utf8');
  const version = Buffer.from(body.version, 'utf8');
  if (
    operation.length === 0 ||
    operation.length > CURSOR_MAX_OPERATION_BYTES ||
    version.length === 0 ||
    version.length > CURSOR_MAX_VERSION_BYTES
  ) {
    entryError(DEPENDENCY_UNAVAILABLE, 'the directory operation tag does not fit its cursor');
  }
  if (body.served.length > CURSOR_MAX_SERVED_OBSERVATIONS) {
    // Not reachable through the declared character bound, but the two-byte count
    // must never wrap a carried served set.
    entryError(QUERY_CURSOR_INVALID, CURSOR_CAPACITY_MESSAGE);
  }
  const servedCount = Buffer.alloc(2);
  servedCount.writeUInt16BE(body.served.length);
  const parts: Buffer[] = [
    Buffer.from([CURSOR_FORMAT_VERSION, operation.length]),
    operation,
    Buffer.from([version.length]),
    version,
    digestBytesOf(body.binding),
    digestBytesOf(body.authorizationFingerprint),
    packSortKey(body.lastSortKey),
    digestBytesOf(body.firstDigest),
    servedCount,
  ];
  for (const observation of body.served) {
    parts.push(encodeServedObservation(observation));
  }
  parts.push(
    uint64Bytes(body.ipSequence),
    uint64Bytes(body.snapshotMs),
    uint64Bytes(body.expiresMs),
  );
  const payload = Buffer.concat(parts);
  const mac = createHmac('sha256', macKey).update(payload).digest();
  return Buffer.concat([payload, mac]).toString('base64url');
}

/**
 * Encodes one cursor and enforces this Query's *declared* cursor bound
 * (`^[A-Za-z0-9_-]{16,8192}$`). The carried served set grows with every page, so
 * a long chain can outgrow the declared capacity: that page then fails closed
 * instead of silently dropping carried observations the next continuation must
 * re-observe — a dropped observation would let a stale card stay served — and the
 * client restarts at page one.
 */
function encodeBoundedCursor(body: DirectoryCursorBody, macKey: Buffer): string {
  const token = encodeCursor(body, macKey);
  if (token.length < CURSOR_MIN_CHARS || token.length > CURSOR_MAX_CHARS) {
    entryError(QUERY_CURSOR_INVALID, CURSOR_CAPACITY_MESSAGE);
  }
  return token;
}

/**
 * Parses the fixed binary body a verified cursor MAC covers. Every read is
 * bounds-checked, the closed code tables reject an unknown Project spelling or
 * status and the final length must be exact, so a truncated, extended or
 * re-tagged body never parses.
 */
function parseCursorBody(payload: Buffer): DirectoryCursorBody {
  let offset = 0;
  const readByte = (): number => {
    if (offset >= payload.length) {
      entryError(QUERY_CURSOR_INVALID, 'cursor body is truncated');
    }
    const value = payload[offset];
    offset += 1;
    return value ?? 0;
  };
  const readBytes = (length: number): Buffer => {
    if (length <= 0 || offset + length > payload.length) {
      entryError(QUERY_CURSOR_INVALID, 'cursor body is truncated');
    }
    const value = payload.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const readDigest = (): string => readBytes(32).toString('hex');
  const readSortKey = (): DirectorySortKey => unpackSortKey(readBytes(32));
  const readUuid = (): string => formatUuid(readBytes(16).toString('hex'));
  const readNumber = (): number => {
    const value = readBytes(8).readBigUInt64BE(0);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      entryError(QUERY_CURSOR_INVALID, 'cursor number is out of range');
    }
    return Number(value);
  };
  const readServedObservation = (): DirectoryServedObservation => {
    const objectType = WORKSPACE_PROJECT_OBJECT_TYPES[readByte()];
    if (objectType === undefined) {
      entryError(QUERY_CURSOR_INVALID, 'cursor Project spelling is not registered');
    }
    const enterpriseId = readUuid();
    const projectId = readUuid();
    const aggregateVersion = readNumber();
    const status = DIRECTORY_STATUS_CODES[readByte()];
    if (status === undefined) {
      entryError(QUERY_CURSOR_INVALID, 'cursor status is not a registered value');
    }
    return { objectType, enterpriseId, projectId, aggregateVersion, status };
  };

  if (readByte() !== CURSOR_FORMAT_VERSION) {
    entryError(QUERY_CURSOR_INVALID, 'cursor format is not supported');
  }
  const operationLength = readByte();
  if (operationLength === 0 || operationLength > CURSOR_MAX_OPERATION_BYTES) {
    entryError(QUERY_CURSOR_INVALID, 'cursor operation tag is out of range');
  }
  const operation = readBytes(operationLength).toString('utf8');
  const versionLength = readByte();
  if (versionLength === 0 || versionLength > CURSOR_MAX_VERSION_BYTES) {
    entryError(QUERY_CURSOR_INVALID, 'cursor version tag is out of range');
  }
  const version = readBytes(versionLength).toString('utf8');
  const binding = readDigest();
  const authorizationFingerprint = readDigest();
  const lastSortKey = readSortKey();
  const firstDigest = readDigest();
  const servedCount = readBytes(2).readUInt16BE(0);
  if (servedCount > CURSOR_MAX_SERVED_OBSERVATIONS) {
    entryError(QUERY_CURSOR_INVALID, 'cursor served set is out of range');
  }
  const served: DirectoryServedObservation[] = [];
  for (let index = 0; index < servedCount; index += 1) {
    served.push(readServedObservation());
  }
  const ipSequence = readNumber();
  const snapshotMs = readNumber();
  const expiresMs = readNumber();
  if (offset !== payload.length) {
    entryError(QUERY_CURSOR_INVALID, 'cursor body has trailing bytes');
  }
  return {
    operation,
    version,
    binding,
    authorizationFingerprint,
    ipSequence,
    lastSortKey,
    firstDigest,
    served,
    snapshotMs,
    expiresMs,
  };
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
  return parseCursorBody(payload);
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

  /**
   * One IP self-discovery scan window. `startKey` positions the window strictly
   * after one candidate (the IP port's own opaque cursor, reconstructed from the
   * chain binding); `undefined` scans from the chain start.
   */
  async function scanWindow(input: {
    readonly session: WorkspaceDirectorySession;
    readonly resolution: VerifiedHumanResolution;
    readonly pageSize: number;
    readonly startKey: DirectorySortKey | undefined;
    readonly authorizationFingerprint: string | undefined;
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
    if (input.startKey !== undefined && input.authorizationFingerprint !== undefined) {
      scanCursor = Buffer.from(
        JSON.stringify({
          v: '1',
          fingerprint: input.authorizationFingerprint,
          principalId: input.resolution.principalRef.objectId,
          capabilityCode: config.capabilityCodes.workspaceProjectDiscoveryHumanV1,
          after: input.startKey,
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
        scanCursor !== undefined
      ) {
        // A valid-MAC cursor whose discovery authorization set changed: the
        // client must restart from page one.
        entryError(QUERY_CURSOR_SCOPE_MISMATCH, 'the discovery authorization set changed');
      }
      throw error;
    }
  }

  /**
   * Re-observes one carried served project. It mints a fresh PROJECT-scoped
   * Decision through the owning discovery Port over the *same* candidate identity
   * the serving page authorized — the registered Project spelling is carried
   * verbatim, because the owning Grant selector must equal the presented target
   * object type exactly — revalidates that Decision, reads the owning
   * EnterpriseProject summary in the carried exact Enterprise+Project scope and
   * compares the two facts a continuation must re-observe.
   *
   * The whole page fails on a lost Decision, a missing Project row or a changed
   * `aggregateVersion`/`status`: a card the chain already served must still be
   * reproducible before the next card is served. The re-authorized entry is
   * returned so the before-return checkpoint can re-check it again once this
   * page's own reads have completed.
   */
  async function reobserveServedObservation(input: {
    readonly resolution: VerifiedHumanResolution;
    readonly directoryQueryId: string;
    readonly normalizedFilter: NormalizedFilter;
    readonly pageBindingHash: string;
    readonly correlationId: string;
    readonly observation: DirectoryServedObservation;
  }): Promise<DirectoryCheckpointEntry> {
    const candidate: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: input.observation.objectType,
      objectId: input.observation.projectId,
      scope: {
        enterpriseId: input.observation.enterpriseId,
        projectId: input.observation.projectId,
      },
    };
    const authorized = await authorizeCandidate({
      resolution: input.resolution,
      candidate,
      directoryQueryId: input.directoryQueryId,
      normalizedFilter: input.normalizedFilter,
      pageBindingHash: input.pageBindingHash,
    });
    if (authorized === undefined) {
      entryError(
        QUERY_CURSOR_INVALID,
        'a summary the directory chain served is no longer authorized',
      );
    }
    await revalidateCandidate({
      resolution: input.resolution,
      decisionRef: authorized.decisionRef,
      scope: authorized.scope,
      candidate,
      directoryQueryId: input.directoryQueryId,
      normalizedFilter: input.normalizedFilter,
      pageBindingHash: input.pageBindingHash,
      actorSnapshotId: authorized.row.actor_snapshot_id,
    });
    const observed = await readWorkspaceProjectSummary(
      config.enterpriseProjectDb,
      boundary.enterpriseProjectContext(authorized.row, authorized.scope, input.correlationId),
      { enterpriseId: authorized.scope.enterpriseId, projectId: authorized.scope.projectId },
    );
    // A vanished Project row and a changed observation are the same failure: the
    // card can no longer be reproduced, so the whole page fails identically.
    if (
      observed?.aggregateVersion !== input.observation.aggregateVersion ||
      observed.status !== input.observation.status
    ) {
      entryError(QUERY_CURSOR_INVALID, 'a summary the directory chain served changed');
    }
    return {
      candidate,
      decisionRef: authorized.decisionRef,
      scope: authorized.scope,
      row: authorized.row,
      observed,
    };
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

  /**
   * The before-return checkpoint of one entry — a candidate this page just
   * authorized or a carried observation the start-of-continuation check
   * re-authorized. It runs after every awaited new-page read, so it covers a
   * change that happened *while* this request was working: the entry's Decision
   * must still revalidate and its owning EnterpriseProject summary must still be
   * readable with the same `aggregateVersion`/`status` it carried.
   *
   * One failure fails the whole page with `QUERY_CURSOR_INVALID`, so a failed
   * checkpoint never emits a page, a cursor or a `snapshotAt`/watermark.
   */
  async function checkpointEntry(input: {
    readonly resolution: VerifiedHumanResolution;
    readonly directoryQueryId: string;
    readonly normalizedFilter: NormalizedFilter;
    readonly pageBindingHash: string;
    readonly correlationId: string;
    readonly entry: DirectoryCheckpointEntry;
  }): Promise<void> {
    await revalidateCandidate({
      resolution: input.resolution,
      decisionRef: input.entry.decisionRef,
      scope: input.entry.scope,
      candidate: input.entry.candidate,
      directoryQueryId: input.directoryQueryId,
      normalizedFilter: input.normalizedFilter,
      pageBindingHash: input.pageBindingHash,
      actorSnapshotId: input.entry.row.actor_snapshot_id,
    });
    const observed = await readWorkspaceProjectSummary(
      config.enterpriseProjectDb,
      boundary.enterpriseProjectContext(input.entry.row, input.entry.scope, input.correlationId),
      {
        enterpriseId: input.entry.scope.enterpriseId,
        projectId: input.entry.scope.projectId,
      },
    );
    const observationChanged =
      observed?.aggregateVersion !== input.entry.observed.aggregateVersion ||
      observed.status !== input.entry.observed.status;
    if (observationChanged) {
      entryError(
        QUERY_CURSOR_INVALID,
        'the EnterpriseProject observation changed before the page returned',
      );
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

      // The carried entries the start-of-continuation check just re-authorized;
      // they are kept so the before-return checkpoint re-checks them once more
      // after this page's own awaited reads.
      const carried: DirectoryCheckpointEntry[] = [];

      let cursor: DirectoryCursorBody | undefined;
      if (incomingCursor !== undefined) {
        cursor = decodeCursor(incomingCursor, session.sessionBinding);
        if (
          cursor.operation !== WORKSPACE_DIRECTORY_QUERY ||
          cursor.version !== WORKSPACE_DIRECTORY_QUERY_VERSION
        ) {
          entryError(QUERY_CURSOR_INVALID, 'cursor belongs to another operation or version');
        }
        if (cursor.expiresMs <= now().getTime()) {
          entryError(QUERY_CURSOR_EXPIRED, 'cursor has expired');
        }
      }

      const scan = await scanWindow({
        session,
        resolution,
        pageSize,
        startKey: cursor?.lastSortKey,
        authorizationFingerprint: cursor?.authorizationFingerprint,
      });
      const snapshotAt = cursor === undefined ? now() : new Date(cursor.snapshotMs);
      if (cursor !== undefined) {
        const observedSequence = scan.sourceWatermarks[0]?.sequence;
        if (observedSequence !== cursor.ipSequence) {
          entryError(QUERY_CURSOR_INVALID, 'the IP source watermark advanced');
        }
        const expectedBinding = bindingDigest({
          operation: WORKSPACE_DIRECTORY_QUERY,
          version: WORKSPACE_DIRECTORY_QUERY_VERSION,
          principalBindingHash: principalBindingHash(resolution),
          sessionBindingHash,
          filterHash,
          authorizationFingerprint: cursor.authorizationFingerprint,
        });
        if (
          scan.authorizationFingerprint !== cursor.authorizationFingerprint ||
          cursor.binding !== expectedBinding
        ) {
          entryError(QUERY_CURSOR_SCOPE_MISMATCH, 'the cursor binding is no longer current');
        }

        // The continuation invariant, enforced before any new card is read:
        // *every* summary the chain has served is re-read in its exact
        // Enterprise+Project scope — a fresh per-candidate Decision, its
        // revalidation and the owning EnterpriseProject read — and compared with
        // the two facts the emitting page observed. A changed
        // `aggregateVersion`/`status`, a vanished Project row or a lost Decision
        // fails the whole page (`QUERY_CURSOR_INVALID`) instead of letting a stale
        // card stay served; the carried set is re-read in chain order so the check
        // never depends on how many pages the chain has already served.
        //
        // This pass rejects a change that already happened before the request.
        // The re-authorized entries are retained for the before-return checkpoint
        // below, which rejects a change that happens *during* this request's own
        // new-page reads.
        for (const observation of cursor.served) {
          carried.push(
            await reobserveServedObservation({
              resolution,
              directoryQueryId: queryId,
              normalizedFilter,
              pageBindingHash,
              correlationId,
              observation,
            }),
          );
        }
      }

      const startedAt = now().getTime();
      const items: WorkspaceProjectSummaryView[] = [];
      const used: DirectoryCheckpointEntry[] = [];
      let examined = 0;
      let hasMore = scan.nextCursor !== undefined;
      let lastKey = cursor === undefined ? undefined : cursor.lastSortKey;

      for (const candidate of scan.items) {
        // The per-request budget stops the read, but never discards a summary
        // this page already matched and is about to deliver: dropping them here
        // while the cursor advances past them would skip a card the client can
        // see. Only a page that accumulated no match may be an empty
        // intermediate page. At least one candidate is always examined, so a
        // request that still has candidates always produces a cursor.
        const budgetExhausted =
          examined > 0 && (examined >= maxCandidates || now().getTime() - startedAt > wallBudgetMs);
        if (budgetExhausted) {
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
      //
      // The checkpoint covers the *whole* chain, not only the page just scanned:
      // the carried entries the start-of-continuation check re-authorized are
      // re-checked here too, because the awaited new-page reads may have let an
      // earlier page's project change after that first check passed. Both sets
      // are re-checked in chain order so a failed checkpoint emits no page, no
      // cursor and no `snapshotAt`/watermark.
      for (const entry of [...carried, ...used]) {
        await checkpointEntry({
          resolution,
          directoryQueryId: queryId,
          normalizedFilter,
          pageBindingHash,
          correlationId,
          entry,
        });
      }

      // Every served summary keeps its own candidate identity: the candidate
      // object type is carried, never re-derived from the project id and never
      // converted into another spelling.
      const objectTypeByProject = new Map(
        used.map((entry) => [entry.scope.projectId, entry.candidate.objectType] as const),
      );
      const summaries = items.map((view) => ({
        enterpriseRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.project.enterprise',
          objectId: view.enterpriseId,
          scope: { enterpriseId: view.enterpriseId },
        },
        projectRef: {
          kind: 'OBJECT',
          objectType: projectIdentityOf(view.projectId),
          objectId: view.projectId,
          scope: { enterpriseId: view.enterpriseId, projectId: view.projectId },
        },
        enterpriseDisplayName: view.enterpriseDisplayName,
        displayCode: view.displayCode,
        title: view.title,
        status: view.status,
        aggregateVersion: view.aggregateVersion,
      }));

      // The served-observation digest of this page. It is the chain-stable
      // EnterpriseProject watermark source of the chain's first page, fixed once
      // there and carried verbatim from then on, so every page of one chain
      // reports the same EnterpriseProject watermark.
      const pageDigest = servedObservationDigest(items);
      const chainFirstDigest = cursor?.firstDigest ?? pageDigest;
      const sequence = scan.sourceWatermarks[0]?.sequence ?? 0;
      // The EP watermark is a chain-stable projection of the chain's real
      // first-page EnterpriseProject observation digest — never a copied count.
      const epSequence = enterpriseProjectWatermarkSequence(chainFirstDigest);
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
        // The emitted cursor carries the whole chain's served set: everything the
        // incoming cursor carried, in chain order, followed by this page's served
        // items. Nothing is ever dropped from the carried set — each observation
        // is the exact EnterpriseProject fact the next continuation re-reads
        // before it serves anything.
        const carried: DirectoryServedObservation[] = [
          ...(cursor?.served ?? []),
          ...items.map((view) => ({
            objectType: projectIdentityOf(view.projectId),
            enterpriseId: view.enterpriseId,
            projectId: view.projectId,
            aggregateVersion: view.aggregateVersion,
            status: view.status,
          })),
        ];
        nextCursor = encodeBoundedCursor(
          {
            operation: WORKSPACE_DIRECTORY_QUERY,
            version: WORKSPACE_DIRECTORY_QUERY_VERSION,
            binding: bindingDigest({
              operation: WORKSPACE_DIRECTORY_QUERY,
              version: WORKSPACE_DIRECTORY_QUERY_VERSION,
              principalBindingHash: principalBindingHash(resolution),
              sessionBindingHash,
              filterHash,
              authorizationFingerprint: scan.authorizationFingerprint,
            }),
            authorizationFingerprint: scan.authorizationFingerprint,
            ipSequence: sequence,
            lastSortKey: lastKey,
            firstDigest: chainFirstDigest,
            served: carried,
            snapshotMs: snapshotAt.getTime(),
            expiresMs: now().getTime() + CURSOR_TTL_MS,
          },
          session.sessionBinding,
        );
      }

      function projectIdentityOf(projectId: string): string {
        const objectType = objectTypeByProject.get(projectId);
        if (objectType === undefined) {
          entryError(
            DEPENDENCY_UNAVAILABLE,
            'the directory page no longer carries its candidate identity',
          );
        }
        return objectType;
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
