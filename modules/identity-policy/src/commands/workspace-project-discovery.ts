// IM-UI-01 (#258): the internal IdentityPolicy project-directory Port of the
// workspace trusted-Human entry. This module owns two things of
// Module-Spec-001 §"Workspace 可信 Human 入口与目录授权提案（#258）" and the
// Session Delta §2/§4:
//
//  1. the per-candidate scoped authorization entry `project.workspace.discover`
//     (plus the independently removable `project.get_project_board_slice` row),
//     reusing the owning target-bound Decision / single covering Grant machinery
//     of `work-order-validation-authorization.ts`; and
//  2. the internal read-only *self-discovery* scan `discoverWorkspaceProjectScopes`
//     that returns only the verified Human's current exact PROJECT Scope
//     candidates. It never returns another Principal, a Role/Grant condition, a
//     name or customer content.
//
// The scan runs under a dedicated DB role (`identity_workspace_discovery_reader`)
// whose RLS policies are self-only on the principal: the reader can see exactly
// the caller's own rows and nothing else. It is not a business Actor or
// Decision, it is not an empty-Scope business authorization, and it does not
// widen any existing scoped Port, Catalog entry or RLS policy. The transaction
// still establishes a technical RLS context — the platform RLS predicate
// requires a live context and a 32-byte decision hash — but that context is a
// *technical* read context (canonically derived from the verified
// `authenticationContextHash` and the discovery purpose) and never a
// business AuthorizationDecision: no Decision row, ActorSnapshot, Audit or
// Outbox fact is produced, and no ownership is transferred.

import { newUuidV7, sha256CanonicalJson } from '@zhiju/shared-kernel';
import type { Common } from '@zhiju/contracts';
import { sql, type Kysely } from 'kysely';
import {
  DECISION_DEFAULT_TTL_SECONDS,
  SnapshotBoundaryError,
  validateHash,
  type PrincipalKind,
  type IdentityCommandDeps,
} from './actor-snapshot.js';
import type { IdentityPolicyDb, IdentityTransaction } from '../persistence/identity-db.js';
import {
  issueEntryDecision,
  revalidateEntryDecision,
  type AuthorizationEntryBinding,
  type IssuedEntryDecision,
  type RevalidatedEntryDecision,
  type WorkOrderValidationAuthorizationConfig,
  type WorkOrderValidationEntryRequest,
  type WorkOrderValidationEntryRevalidation,
} from './work-order-validation-authorization.js';
import { assertSessionBindingHash } from './workspace-human-identity.js';

export const IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED =
  'IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED';
export const IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID =
  'IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID';
export const IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID =
  'IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID';
export const IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID =
  'IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID';

/** The published Purpose of the discovery entry (spec §258 mapping table). */
export const WORKSPACE_PROJECT_DISCOVERY_PURPOSE = 'project.workspace.discover';
/**
 * The already-registered Purpose of `project.get_project_board_slice@1.0`
 * (Session Delta §5). It is not re-invented here; the board row is kept in its
 * own removable map so it can be dropped independently of the discovery entry.
 */
export const PROJECT_BOARD_SLICE_READ_PURPOSE = 'enterprise.project.get_project_board_slice';

/** The two accepted Project identity spellings; each matches in its own shape. */
export const WORKSPACE_PROJECT_OBJECT_TYPES = Object.freeze([
  'project.project',
  'zhiju.project.project',
]);
/** Selector types of the shared machinery; discovery entries only use TARGET_TYPE. */
const TARGET_TYPE = 'TARGET_TYPE' as const;

/** Hard per-request candidate scan budget (Session Delta §4: 200 items/5s). */
export const WORKSPACE_PROJECT_DISCOVERY_SCAN_BUDGET = 200;

const namespaceCodePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/u;
const hex64Pattern = /^[0-9a-f]{64}$/u;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 50;

/**
 * Trusted configuration key of one entry of this slice. The two keys are
 * independent: no entry ever reads the other's capability code.
 */
export type WorkspaceProjectDiscoveryCapabilityKey =
  'workspaceProjectDiscoveryHumanV1' | 'projectBoardSliceReadHumanV1';

export type WorkspaceProjectDiscoveryBinding = AuthorizationEntryBinding & {
  readonly capabilityConfigKey: WorkspaceProjectDiscoveryCapabilityKey;
};

/**
 * The discovery mapping of spec §258. A separate map so the frozen
 * `project.workspace.discover` row is added additively without touching the
 * existing frozen binding arrays of `work-order-validation-authorization.ts`.
 */
export const WORKSPACE_PROJECT_DISCOVERY_BINDINGS: Readonly<
  Record<'workspaceProjectDiscoveryHumanV1', WorkspaceProjectDiscoveryBinding>
> = Object.freeze({
  workspaceProjectDiscoveryHumanV1: Object.freeze({
    commandType: 'project.workspace.discover',
    commandVersion: '1.0',
    authorizationPurpose: WORKSPACE_PROJECT_DISCOVERY_PURPOSE,
    requiredGrantAction: 'project.workspace.discover.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: WORKSPACE_PROJECT_OBJECT_TYPES,
    selectorType: TARGET_TYPE,
    expectedPrincipalKind: 'HUMAN',
    forbidActingFor: true,
    capabilityConfigKey: 'workspaceProjectDiscoveryHumanV1',
  }),
});

/**
 * The `project.get_project_board_slice@1.0` row, deliberately isolated so a
 * later decision can remove it without touching the discovery entry. It reuses
 * the registered board Purpose verbatim and the two accepted Project spellings.
 */
export const PROJECT_BOARD_SLICE_READ_BINDINGS: Readonly<
  Record<'projectBoardSliceReadHumanV1', WorkspaceProjectDiscoveryBinding>
> = Object.freeze({
  projectBoardSliceReadHumanV1: Object.freeze({
    commandType: 'project.get_project_board_slice',
    commandVersion: '1.0',
    authorizationPurpose: PROJECT_BOARD_SLICE_READ_PURPOSE,
    requiredGrantAction: 'project.get_project_board_slice.v1',
    targetKind: 'OBJECT',
    targetObjectTypes: WORKSPACE_PROJECT_OBJECT_TYPES,
    selectorType: TARGET_TYPE,
    expectedPrincipalKind: 'HUMAN',
    forbidActingFor: true,
    capabilityConfigKey: 'projectBoardSliceReadHumanV1',
  }),
});

/** Published Purpose of every trusted configuration key of this slice. */
export const WORKSPACE_PROJECT_DISCOVERY_PURPOSES: Readonly<
  Record<WorkspaceProjectDiscoveryCapabilityKey, string>
> = Object.freeze({
  workspaceProjectDiscoveryHumanV1: WORKSPACE_PROJECT_DISCOVERY_PURPOSE,
  projectBoardSliceReadHumanV1: PROJECT_BOARD_SLICE_READ_PURPOSE,
});

const allBindings: Readonly<
  Record<WorkspaceProjectDiscoveryCapabilityKey, WorkspaceProjectDiscoveryBinding>
> = Object.freeze({
  ...WORKSPACE_PROJECT_DISCOVERY_BINDINGS,
  ...PROJECT_BOARD_SLICE_READ_BINDINGS,
});

/** Exact target binding of one candidate. */
export interface WorkspaceProjectDiscoveryAuthorizationInput extends WorkOrderValidationEntryRequest {
  readonly targetRef: Common.ObjectRef;
}

export interface WorkspaceProjectDiscoveryRevalidationInput extends WorkOrderValidationEntryRevalidation {
  readonly expectedTargetRef: Common.ObjectRef;
}

export type WorkspaceProjectDiscoveryCapabilityCodes = Readonly<
  Record<WorkspaceProjectDiscoveryCapabilityKey, string>
>;

export interface WorkspaceProjectDiscoveryPortConfig {
  readonly capabilityCodes: WorkspaceProjectDiscoveryCapabilityCodes;
  /** Trusted server clock; defaults to the process clock. */
  readonly now?: (() => Date) | undefined;
}

export interface WorkspaceProjectDiscoveryAuthorizationPort {
  /** Signs the exact scoped Decision of one approved entry, or denies it. */
  authorize(
    deps: IdentityCommandDeps,
    key: WorkspaceProjectDiscoveryCapabilityKey,
    input: WorkspaceProjectDiscoveryAuthorizationInput,
  ): Promise<IssuedEntryDecision>;
  /** Proves the presented Decision still covers this request now. */
  revalidate(
    deps: IdentityCommandDeps,
    key: WorkspaceProjectDiscoveryCapabilityKey,
    input: WorkspaceProjectDiscoveryRevalidationInput,
  ): Promise<RevalidatedEntryDecision>;
  /** Convenience wrapper for the `project.workspace.discover` entry. */
  authorizeCandidate(
    deps: IdentityCommandDeps,
    input: WorkspaceProjectDiscoveryAuthorizationInput,
  ): Promise<IssuedEntryDecision>;
  /** Convenience wrapper for the `project.workspace.discover` entry. */
  revalidateCandidate(
    deps: IdentityCommandDeps,
    input: WorkspaceProjectDiscoveryRevalidationInput,
  ): Promise<RevalidatedEntryDecision>;
}

function bindingFor(
  key: string,
  operation: unknown,
  version: unknown,
): WorkspaceProjectDiscoveryBinding {
  const binding = (allBindings as Readonly<Record<string, WorkspaceProjectDiscoveryBinding>>)[key];
  if (
    binding === undefined ||
    typeof operation !== 'string' ||
    typeof version !== 'string' ||
    binding.commandType !== operation ||
    binding.commandVersion !== version
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED,
      'workspace project discovery authorization must be an exact approved key/operation/version',
    );
  }
  return binding;
}

/**
 * The owning authorization Port of the discovery slice. It shares the exact
 * decision/grant machinery of the WorkOrder validation Port: the trusted
 * configuration is resolved for every call, the clock is never a caller
 * argument, and a key/operation/version drift fails closed before any dependency
 * is touched.
 */
export function createWorkspaceProjectDiscoveryPort(
  config: WorkspaceProjectDiscoveryPortConfig,
): WorkspaceProjectDiscoveryAuthorizationPort {
  for (const key of Object.keys(allBindings) as WorkspaceProjectDiscoveryCapabilityKey[]) {
    if (WORKSPACE_PROJECT_DISCOVERY_PURPOSES[key] !== allBindings[key].authorizationPurpose) {
      throw new SnapshotBoundaryError(
        IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED,
        'workspace project discovery binding Purpose does not match the published Purpose',
      );
    }
  }
  const configuredNow = (config as { readonly now?: unknown } | null | undefined)?.now;
  const now: () => Date =
    typeof configuredNow === 'function' ? (configuredNow as () => Date) : () => new Date();
  const commonConfig = config as unknown as WorkOrderValidationAuthorizationConfig;

  // Both entry points are async so a drift rejection is a rejected promise:
  // the declared return type is a Promise and callers must not have to guard a
  // synchronous throw from a key/operation mismatch.
  const authorize = async (
    deps: IdentityCommandDeps,
    key: WorkspaceProjectDiscoveryCapabilityKey,
    input: WorkspaceProjectDiscoveryAuthorizationInput,
  ) => {
    const binding = bindingFor(key, input.commandType, input.commandVersion);
    return issueEntryDecision(commonConfig, now, undefined, deps, input, input.targetRef, binding);
  };

  const revalidate = async (
    deps: IdentityCommandDeps,
    key: WorkspaceProjectDiscoveryCapabilityKey,
    input: WorkspaceProjectDiscoveryRevalidationInput,
  ) => {
    const binding = bindingFor(key, input.expectedCommandType, input.expectedCommandVersion);
    return revalidateEntryDecision(
      commonConfig,
      now,
      undefined,
      deps,
      input,
      input.expectedTargetRef,
      binding,
    );
  };

  return {
    authorize,
    revalidate,
    authorizeCandidate: (deps, input) => authorize(deps, 'workspaceProjectDiscoveryHumanV1', input),
    revalidateCandidate: (deps, input) =>
      revalidate(deps, 'workspaceProjectDiscoveryHumanV1', input),
  };
}

// ---------------------------------------------------------------------------
// Self-discovery scan
// ---------------------------------------------------------------------------

/**
 * The narrow shape of one committed `capability_grant` row the scan reads. It
 * is a structural subset of the owning `SelectedCapabilityGrant`, so the same
 * row object is accepted without re-declaring the owning type.
 */
export interface WorkspaceProjectDiscoveryGrantRow {
  readonly id: string;
  readonly principal_id: string;
  readonly capability_code: string;
  readonly scope_kind: string;
  readonly enterprise_id: string;
  readonly project_id: string | null;
  readonly resource_selectors: unknown;
  readonly actions: readonly string[];
  readonly valid_from: Date;
  readonly valid_to: Date | null;
  readonly status: string;
  readonly aggregate_version: string;
  readonly grant_policy_snapshot_id: string;
  readonly grant_policy_snapshot_hash: Buffer;
}

export interface WorkspaceProjectDiscoveryScanInput {
  readonly authenticationContextHash: Buffer;
  readonly sessionBindingHash: Buffer;
  readonly principalId: string;
  readonly principalKind: PrincipalKind;
  readonly pageSize: number;
  readonly cursor?: string | undefined;
}

/** Deployment-locked configuration of one scan; never caller-chosen. */
export interface WorkspaceProjectDiscoveryScanConfig {
  /** The configured discovery capability code resolved by the deployment. */
  readonly capabilityCode: string;
  /** The exact Grant action a covering discovery Grant must carry. */
  readonly requiredGrantAction: string;
  readonly now?: (() => Date) | undefined;
}

export interface WorkspaceProjectDiscoveryCandidate {
  readonly projectRef: Common.ObjectRef;
  readonly sourceWatermark: Common.SourceWatermark;
}

export interface WorkspaceProjectDiscoveryScanResult {
  readonly items: readonly WorkspaceProjectDiscoveryCandidate[];
  readonly nextCursor?: string | undefined;
  /** `cv1` hash over the covering Grant facts, the principal and the code. */
  readonly authorizationFingerprint: string;
  readonly sourceWatermarks: readonly Common.SourceWatermark[];
}

/** One covering Grant, as it enters the authorization fingerprint. */
interface GrantFingerprintFact {
  readonly grantId: string;
  readonly aggregateVersion: string;
  readonly scopeKind: string;
  readonly enterpriseId: string;
  readonly projectId: string | null;
  readonly actions: readonly string[];
  readonly selectors: readonly { readonly selectorType: string; readonly objectType: string }[];
  readonly grantPolicySnapshotId: string;
  readonly grantPolicySnapshotHash: string;
}

interface Candidate {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly objectType: string;
}

interface DiscoveryCursorPayload {
  readonly v: '1';
  readonly fingerprint: string;
  readonly principalId: string;
  readonly capabilityCode: string;
  readonly after: { readonly enterpriseId: string; readonly projectId: string };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Parses `resource_selectors` and returns the exact Project object type, or `undefined`. */
function exactProjectSelectorObjectType(selectors: unknown): string | undefined {
  let parsed: unknown = selectors;
  if (typeof selectors === 'string') {
    try {
      parsed = JSON.parse(selectors);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  let first: string | undefined;
  for (const selector of parsed) {
    if (selector === null || typeof selector !== 'object' || Array.isArray(selector)) {
      return undefined;
    }
    const candidate = selector as Record<string, unknown>;
    const keys = Object.keys(candidate);
    // A wildcard, an alias, an unknown field or a selector of another type
    // fails closed: an exact Project selector has exactly these two members.
    if (
      keys.length !== 2 ||
      !keys.every((key) => key === 'selectorType' || key === 'objectType') ||
      candidate.selectorType !== TARGET_TYPE ||
      typeof candidate.objectType !== 'string' ||
      !WORKSPACE_PROJECT_OBJECT_TYPES.includes(candidate.objectType)
    ) {
      return undefined;
    }
    first ??= candidate.objectType;
  }
  return first;
}

function grantFingerprintFact(
  grant: WorkspaceProjectDiscoveryGrantRow,
): GrantFingerprintFact | undefined {
  const objectType = exactProjectSelectorObjectType(grant.resource_selectors);
  if (objectType === undefined) return undefined;
  const parsed = (
    typeof grant.resource_selectors === 'string'
      ? (JSON.parse(grant.resource_selectors) as unknown[])
      : (grant.resource_selectors as unknown[])
  ) as readonly { readonly selectorType: string; readonly objectType: string }[];
  return {
    grantId: grant.id,
    aggregateVersion: grant.aggregate_version,
    scopeKind: grant.scope_kind,
    enterpriseId: grant.enterprise_id,
    projectId: grant.project_id,
    actions: [...grant.actions].sort(compareText),
    selectors: parsed.map((selector) => ({
      selectorType: selector.selectorType,
      objectType: selector.objectType,
    })),
    grantPolicySnapshotId: grant.grant_policy_snapshot_id,
    grantPolicySnapshotHash: grant.grant_policy_snapshot_hash.toString('hex'),
  };
}

/**
 * The pure page computation of the scan. The DB-touching entry point feeds the
 * candidate rows from the self-only reader; this function applies every closed
 * rule — capability code, exact Grant action, PROJECT scope only (Enterprise
 * Grants never produce candidates), the exact Project selector (a wildcard is
 * refused), the trusted validity window, stable `(enterprise_id, project_id)`
 * ordering, the 200-candidate scan budget, the bound cursor and the
 * authorization fingerprint.
 */
export function computeWorkspaceProjectDiscoveryPage(
  grants: readonly WorkspaceProjectDiscoveryGrantRow[],
  input: WorkspaceProjectDiscoveryScanInput,
  config: {
    readonly capabilityCode: string;
    readonly requiredGrantAction: string;
    readonly now: Date;
  },
): WorkspaceProjectDiscoveryScanResult {
  const { now } = config;
  const covering: GrantFingerprintFact[] = [];
  const candidates: Candidate[] = [];
  for (const grant of grants) {
    if (grant.principal_id !== input.principalId) continue;
    if (grant.capability_code !== config.capabilityCode) continue;
    if (grant.status !== 'ACTIVE') continue;
    // Enterprise-scope Grants are never expanded into Project candidates.
    if (grant.scope_kind !== 'PROJECT') continue;
    if (grant.project_id === null) continue;
    if (!(grant.valid_from <= now)) continue;
    if (grant.valid_to !== null && !(grant.valid_to > now)) continue;
    if (!grant.actions.includes(config.requiredGrantAction)) continue;
    const objectType = exactProjectSelectorObjectType(grant.resource_selectors);
    if (objectType === undefined) continue;
    const fact = grantFingerprintFact(grant);
    if (fact === undefined) continue;
    covering.push(fact);
    candidates.push({
      enterpriseId: grant.enterprise_id,
      projectId: grant.project_id,
      objectType,
    });
  }

  covering.sort((left, right) => compareText(left.grantId, right.grantId));
  const authorizationFingerprint = sha256CanonicalJson({
    principalId: input.principalId,
    capabilityCode: config.capabilityCode,
    grants: covering.map((fact) => ({
      grantId: fact.grantId,
      aggregateVersion: fact.aggregateVersion,
      scopeKind: fact.scopeKind,
      enterpriseId: fact.enterpriseId,
      projectId: fact.projectId,
      actions: [...fact.actions],
      selectors: fact.selectors.map((selector) => ({
        selectorType: selector.selectorType,
        objectType: selector.objectType,
      })),
      grantPolicySnapshotId: fact.grantPolicySnapshotId,
      grantPolicySnapshotHash: fact.grantPolicySnapshotHash,
    })),
  });

  const deduped: Candidate[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const identity = `${candidate.enterpriseId}\u0000${candidate.projectId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(candidate);
  }
  deduped.sort((left, right) => {
    const byEnterprise = compareText(left.enterpriseId, right.enterpriseId);
    return byEnterprise !== 0 ? byEnterprise : compareText(left.projectId, right.projectId);
  });

  let startIndex = 0;
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (
      cursor.principalId !== input.principalId ||
      cursor.capabilityCode !== config.capabilityCode
    ) {
      throw new SnapshotBoundaryError(
        IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID,
        'cursor belongs to another principal or capability',
      );
    }
    if (cursor.fingerprint !== authorizationFingerprint) {
      throw new SnapshotBoundaryError(
        IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID,
        'cursor is invalidated by a changed discovery authorization set',
      );
    }
    const found = deduped.findIndex(
      (candidate) =>
        compareText(candidate.enterpriseId, cursor.after.enterpriseId) > 0 ||
        (candidate.enterpriseId === cursor.after.enterpriseId &&
          compareText(candidate.projectId, cursor.after.projectId) > 0),
    );
    startIndex = found === -1 ? deduped.length : found;
  }

  // The 200-candidate scan budget bounds THIS request only, starting after the
  // bound cursor. A candidate beyond the first window stays reachable by
  // following the cursor instead of being silently dropped, and the cursor must
  // therefore be resolved against the complete ordered candidate set.
  const scanned = deduped.slice(startIndex, startIndex + WORKSPACE_PROJECT_DISCOVERY_SCAN_BUDGET);
  const page = scanned.slice(0, input.pageSize);
  const partition = `workspace_project_discovery:${input.principalId}`;
  const watermark: Common.SourceWatermark = {
    sourceModule: 'identity_policy',
    partition,
    sequence: covering.length,
    observedAt: now.toISOString(),
  };
  const items = page.map((candidate) => ({
    projectRef: {
      kind: 'OBJECT',
      objectType: candidate.objectType,
      objectId: candidate.projectId,
      scope: { enterpriseId: candidate.enterpriseId, projectId: candidate.projectId },
    } satisfies Common.ObjectRef,
    sourceWatermark: watermark,
  }));

  const hasMore = startIndex + page.length < deduped.length;
  const result: {
    items: readonly WorkspaceProjectDiscoveryCandidate[];
    authorizationFingerprint: string;
    sourceWatermarks: readonly Common.SourceWatermark[];
    nextCursor?: string;
  } = { items, authorizationFingerprint, sourceWatermarks: [watermark] };
  const last = page[page.length - 1];
  if (hasMore && last !== undefined) {
    const cursorPayload: DiscoveryCursorPayload = {
      v: '1',
      fingerprint: authorizationFingerprint,
      principalId: input.principalId,
      capabilityCode: config.capabilityCode,
      after: { enterpriseId: last.enterpriseId, projectId: last.projectId },
    };
    result.nextCursor = Buffer.from(JSON.stringify(cursorPayload), 'utf8').toString('base64url');
  }
  return result;
}

function decodeCursor(cursor: string): DiscoveryCursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    parsed = undefined;
  }
  const candidate = parsed as
    | {
        v?: unknown;
        fingerprint?: unknown;
        principalId?: unknown;
        capabilityCode?: unknown;
        after?: { enterpriseId?: unknown; projectId?: unknown };
      }
    | null
    | undefined;
  if (
    candidate === null ||
    candidate === undefined ||
    typeof candidate !== 'object' ||
    candidate.v !== '1' ||
    typeof candidate.fingerprint !== 'string' ||
    !hex64Pattern.test(candidate.fingerprint) ||
    typeof candidate.principalId !== 'string' ||
    typeof candidate.capabilityCode !== 'string' ||
    typeof candidate.after?.enterpriseId !== 'string' ||
    typeof candidate.after.projectId !== 'string'
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CURSOR_INVALID,
      'cursor shape is invalid',
    );
  }
  return candidate as DiscoveryCursorPayload;
}

/**
 * A non-null `uuid` sentinel for the platform RLS context. The V1008 reader RLS
 * policies use only `context_is_valid()` and `context_principal_id()`, so the
 * Enterprise/Project members do not widen or narrow the reader's visibility;
 * they exist solely because the establisher rejects NULL.
 */
const DISCOVERY_TECHNICAL_ENTERPRISE_SENTINEL = '00000000-0000-7000-8000-000000000000';

/**
 * Runs `fn` in one transaction whose reading role is
 * `identity_workspace_discovery_reader` and whose RLS context is established
 * from the *verified* principal only. The technical decision hash is derived
 * canonically from the verified `authenticationContextHash` and the discovery
 * purpose — it is a technical read context, not a business
 * AuthorizationDecision: it is never persisted, never issued by
 * `authorize_command`, and never authorizes a business operation.
 */
async function withWorkspaceDiscoveryTransaction<T>(
  db: Kysely<IdentityPolicyDb>,
  context: {
    readonly principalId: string;
    readonly authenticationContextHash: Buffer;
    readonly now: Date;
  },
  fn: (trx: IdentityTransaction) => Promise<T>,
): Promise<T> {
  const technicalDecisionHash = Buffer.from(
    sha256CanonicalJson({
      authenticationContextHash: context.authenticationContextHash.toString('hex'),
      purpose: WORKSPACE_PROJECT_DISCOVERY_PURPOSE,
    }),
    'hex',
  );
  const expiresAt = new Date(context.now.getTime() + DECISION_DEFAULT_TTL_SECONDS * 1000);
  const result = await db.connection().execute(async (connection) => {
    const transaction = connection.transaction();
    return transaction.execute(async (trx) => {
      await sql.raw('SET LOCAL ROLE platform_context_establisher').execute(trx);
      await sql`SELECT platform_security.establish_transaction_context(
          ${'REQUEST'},
          ${context.principalId},
          ${newUuidV7()},
          ${newUuidV7()},
          ${technicalDecisionHash},
          ${expiresAt},
          ${DISCOVERY_TECHNICAL_ENTERPRISE_SENTINEL},
          ${[] as string[]},
          ${newUuidV7()},
          ${null})`.execute(trx);
      await sql.raw('SET LOCAL ROLE identity_workspace_discovery_reader').execute(trx);
      return fn(trx);
    });
  });
  return result;
}

function assertScanConfig(config: WorkspaceProjectDiscoveryScanConfig): void {
  if (!namespaceCodePattern.test(config.capabilityCode)) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID,
      'discovery capability code is missing or invalid',
    );
  }
  if (config.requiredGrantAction.length === 0) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORKSPACE_PROJECT_DISCOVERY_CAPABILITY_CONFIG_INVALID,
      'discovery Grant action is missing or invalid',
    );
  }
}

function assertScanInput(input: WorkspaceProjectDiscoveryScanInput): void {
  assertSessionBindingHash(input.sessionBindingHash);
  validateHash(
    input.authenticationContextHash,
    IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID,
    'authentication context hash',
  );
  if (input.principalKind !== 'HUMAN') {
    throw new SnapshotBoundaryError(
      IDENTITY_WORKSPACE_PROJECT_DISCOVERY_UNSUPPORTED,
      'workspace project discovery is a Human-only self-discovery entry',
    );
  }
  if (
    !Number.isInteger(input.pageSize) ||
    input.pageSize < MIN_PAGE_SIZE ||
    input.pageSize > MAX_PAGE_SIZE
  ) {
    throw new SnapshotBoundaryError(
      IDENTITY_WORKSPACE_PROJECT_DISCOVERY_INPUT_INVALID,
      `pageSize must be an integer in [${MIN_PAGE_SIZE}, ${MAX_PAGE_SIZE}]`,
    );
  }
}

/**
 * The internal read-only self-discovery scan. The principal is the verified
 * one only — the caller can never choose another Principal — and the scan
 * returns only that Principal's current exact PROJECT Scope candidates, an
 * opaque bound `nextCursor` and a read-observation watermark. No business fact
 * is written, no Episode/Decision is produced and Enterprise-Project is never
 * read.
 */
export async function discoverWorkspaceProjectScopes(
  deps: IdentityCommandDeps,
  config: WorkspaceProjectDiscoveryScanConfig,
  input: WorkspaceProjectDiscoveryScanInput,
): Promise<WorkspaceProjectDiscoveryScanResult> {
  assertScanConfig(config);
  assertScanInput(input);
  const now = config.now?.() ?? new Date();
  const result = await withWorkspaceDiscoveryTransaction(
    deps.db,
    {
      principalId: input.principalId,
      authenticationContextHash: input.authenticationContextHash,
      now,
    },
    async (trx) => {
      // Explicit column list: the read surface of the self-discovery reader
      // role is exactly what the candidate fingerprint consumes, never `*`.
      const rows = await trx
        .selectFrom('identity_policy.capability_grant')
        .select([
          'id',
          'principal_id',
          'capability_code',
          'scope_kind',
          'enterprise_id',
          'project_id',
          'resource_selectors',
          'actions',
          'valid_from',
          'valid_to',
          'status',
          'aggregate_version',
          'grant_policy_snapshot_id',
          'grant_policy_snapshot_hash',
        ])
        .where('principal_id', '=', input.principalId)
        .where('capability_code', '=', config.capabilityCode)
        .where('status', '=', 'ACTIVE')
        .where('scope_kind', '=', 'PROJECT')
        .where('valid_from', '<=', now)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', now)]))
        .orderBy('enterprise_id', 'asc')
        .orderBy('project_id', 'asc')
        .execute();
      return computeWorkspaceProjectDiscoveryPage(rows, input, {
        capabilityCode: config.capabilityCode,
        requiredGrantAction: config.requiredGrantAction,
        now,
      });
    },
  );
  return result;
}
