// IM-UI-01 (#258/#266): the EnterpriseProject owning read behind one candidate
// card of the workspace trusted-Human project directory.
//
// The Core directory entry calls this once per candidate that the IdentityPolicy
// self-discovery scan returned and that already holds a current
// `project.workspace.discover` Decision. This read therefore runs inside the
// exact Enterprise+Project RLS transaction (never a full-schema scan, never a
// cross-schema join) and returns only the minimal display projection Module-Spec
// 002 §258 allows: the Project's own identity/lifecycle plus the Enterprise
// display name. No content, no source material, no other Project's existence
// and no completion inference leave this boundary.

import type { Kysely } from 'kysely';
import type { EnterpriseStatus, ProjectStatus } from '../persistence/enterprise-business-types.js';
import {
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import { DEPENDENCY_UNAVAILABLE } from './context-source-slice-policy.js';
import {
  EnterpriseBusinessError,
  PROJECT_QUERY_SCOPE_MISMATCH,
} from './enterprise-business-errors.js';

/**
 * The minimal per-candidate directory projection of §258. `status` is the
 * owning registered Project status verbatim; `aggregateVersion` is the Project
 * aggregate version as a JS safe integer.
 */
export interface WorkspaceProjectSummaryView {
  readonly enterpriseId: string;
  readonly projectId: string;
  readonly enterpriseDisplayName: string;
  readonly displayCode: string;
  readonly title: string;
  readonly status: 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
  readonly aggregateVersion: number;
}

/** Exact owning scope of one candidate read; the trusted context must mirror it. */
export interface WorkspaceProjectSummaryRequest {
  readonly enterpriseId: string;
  readonly projectId: string;
}

const PROJECT_STATUSES: Readonly<Record<string, true>> = {
  ACTIVE: true,
  SUSPENDED: true,
  ARCHIVED: true,
};
const ENTERPRISE_STATUSES: Readonly<Record<string, true>> = {
  ACTIVE: true,
  SUSPENDED: true,
  ARCHIVED: true,
};

function scopeDenied(message: string): never {
  throw new EnterpriseBusinessError(PROJECT_QUERY_SCOPE_MISMATCH, message);
}

function integrityViolation(message: string): never {
  throw new EnterpriseBusinessError(DEPENDENCY_UNAVAILABLE, message);
}

/**
 * The read must only ever observe the single Project the candidate Decision was
 * bound to. Any other trusted Enterprise or any Project set that is not exactly
 * `[request.projectId]` is a scope mismatch, never a wider read.
 */
function assertExactScope(
  context: EnterpriseProjectTransactionContext,
  request: WorkspaceProjectSummaryRequest,
): void {
  if (context.enterpriseId !== request.enterpriseId) {
    scopeDenied('request enterpriseId does not match the trusted Enterprise scope');
  }
  if (
    context.allowedProjectIds.length !== 1 ||
    context.allowedProjectIds[0] !== request.projectId
  ) {
    scopeDenied('request projectId is not exactly the single trusted Project scope');
  }
}

/** Converts the int8 `aggregate_version` (read as a string) to a JS safe integer. */
function toSafeAggregateVersion(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    integrityViolation('project aggregate_version is not a positive safe integer');
  }
  return parsed;
}

function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUSES[value] === true;
}

function isEnterpriseStatus(value: string): value is EnterpriseStatus {
  return ENTERPRISE_STATUSES[value] === true;
}

interface WorkspaceProjectSummaryRow {
  readonly project_id: string;
  readonly enterprise_id: string;
  readonly display_code: string;
  readonly project_title: string;
  readonly project_status: string;
  readonly project_aggregate_version: string;
  readonly enterprise_display_name: string;
  readonly enterprise_status: string;
}

/**
 * Reads the minimal directory summary of exactly one Project under its exact
 * Enterprise+Project RLS context. Returns `undefined` when no committed Project
 * row is visible (the caller treats that as "candidate no longer visible" and
 * skips it); it never fabricates a card.
 */
export async function readWorkspaceProjectSummary(
  db: Kysely<EnterpriseProjectDb>,
  context: EnterpriseProjectTransactionContext,
  request: WorkspaceProjectSummaryRequest,
): Promise<WorkspaceProjectSummaryView | undefined> {
  assertExactScope(context, request);
  return withEnterpriseProjectTransaction(db, context, async (trx) => {
    const row = (await trx
      .selectFrom('enterprise_project.project')
      .innerJoin(
        'enterprise_project.enterprise',
        'enterprise_project.enterprise.enterprise_id',
        'enterprise_project.project.enterprise_id',
      )
      .select((eb) => [
        'enterprise_project.project.project_id',
        'enterprise_project.project.enterprise_id',
        'enterprise_project.project.display_code',
        eb.ref('enterprise_project.project.title').as('project_title'),
        eb.ref('enterprise_project.project.status').as('project_status'),
        eb.ref('enterprise_project.project.aggregate_version').as('project_aggregate_version'),
        eb.ref('enterprise_project.enterprise.display_name').as('enterprise_display_name'),
        eb.ref('enterprise_project.enterprise.status').as('enterprise_status'),
      ])
      .where('enterprise_project.project.enterprise_id', '=', request.enterpriseId)
      .where('enterprise_project.project.project_id', '=', request.projectId)
      .executeTakeFirst()) as WorkspaceProjectSummaryRow | undefined;
    if (row === undefined) return undefined;
    if (!isEnterpriseStatus(row.enterprise_status)) {
      integrityViolation('enterprise row carries an unregistered status');
    }
    if (!isProjectStatus(row.project_status)) {
      integrityViolation('project row carries an unregistered status');
    }
    return {
      enterpriseId: row.enterprise_id,
      projectId: row.project_id,
      enterpriseDisplayName: row.enterprise_display_name,
      displayCode: row.display_code,
      title: row.project_title,
      status: row.project_status,
      aggregateVersion: toSafeAggregateVersion(row.project_aggregate_version),
    };
  });
}
