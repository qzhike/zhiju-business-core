import type { Common, EnterpriseProject } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  EnterpriseBusinessError,
  GET_CONTEXT_SOURCE_SLICE_PURPOSE,
  GET_CONTEXT_SOURCE_SLICE_QUERY,
  PROJECT_QUERY_NOT_FOUND,
  handleGetContextSourceSlice,
  type CapturePolicyResolution,
  type CapturePolicyResolutionPort,
} from '@zhiju/enterprise-project';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_REVOKED,
  DEPENDENCY_UNAVAILABLE,
  SnapshotBoundaryError,
  authorizeCommand,
  resolvePolicy,
  type AuthorizationDecisionView,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
  type PolicyVersionResolutionView,
} from '@zhiju/identity-policy';
import type { ContextSourceSliceReadPort } from '@zhiju/task-execution';
import {
  AUTHORIZATION_DECISION_OBJECT_TYPE,
  contentHash,
  createDecisionBoundary,
  digest,
  entryError,
  payloadHashOf,
  policySnapshotReference,
  record,
  sessionAuthenticationContextHash,
  uuid,
  type DecisionRow,
} from './decision-boundary.js';
import { RESOLVE_POLICY_COMMAND, RESOLVE_POLICY_PURPOSE } from './context-source-slice-entry.js';
import type { InitialContextEntryConfig, InitialContextSession } from './initial-context-entry.js';
const CONTEXT_SOURCE_SLICE_OBJECT_TYPE = 'zhiju.project.context_source_slice';
const PRINCIPAL_OBJECT_TYPE = 'zhiju.identity.principal';

/** Independently authorized owning reads for WorkOrder validation and freezing. */
export function createWorkOrderDependencyReads(
  config: Omit<InitialContextEntryConfig, 'capabilityCodes'>,
  row: DecisionRow,
  session: InitialContextSession,
) {
  const boundary = createDecisionBoundary(config),
    now = config.now ?? (() => new Date());
  const expiries: string[] = [];
  const currentReads: (() => Promise<void>)[] = [];
  async function authorizedRead<T>(
    row: DecisionRow,
    session: InitialContextSession,
    request: {
      readonly commandType: string;
      readonly commandVersion: string;
      readonly purpose: string;
      readonly capability: string;
      readonly scopeValue: CanonicalJsonObject;
      readonly scopeKind: 'ENTERPRISE' | 'PROJECT';
      readonly projectId?: string | undefined;
      readonly payloadHash: Buffer;
      readonly correlationId: string;
    },
    read: (deps: IdentityCommandDeps) => Promise<T>,
  ): Promise<T> {
    const baseContext: IdentityTransactionContext = {
      kind: 'REQUEST',
      principalId: row.principal_id,
      actorSnapshotId: session.resolutionActorSnapshotRef.snapshotId,
      authorizationDecisionId: row.authorization_decision_id,
      authorizationDecisionHash: row.payload_hash,
      authorizationDecisionExpiresAt: row.expires_at,
      enterpriseId: row.enterprise_id,
      allowedProjectIds: request.projectId === undefined ? [] : [request.projectId],
      correlationId: request.correlationId,
    };
    let authorized: AuthorizationDecisionView;
    try {
      authorized = await authorizeCommand(boundary.identityDeps(baseContext), {
        actorSnapshotRef: session.resolutionActorSnapshotRef,
        intent: {
          commandType: request.commandType,
          commandVersion: request.commandVersion,
          scopeKind: request.scopeKind,
          enterpriseId: row.enterprise_id,
          ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
          purpose: request.purpose,
          requestedCapability: request.capability,
          commandPayloadHash: request.payloadHash,
          requestedAt: now(),
          highRiskAction: false,
        },
        authenticationContextHash: sessionAuthenticationContextHash(session),
        policySnapshotRef: policySnapshotReference(row),
      });
    } catch (error) {
      if (error instanceof SnapshotBoundaryError) {
        throw new SnapshotBoundaryError(DEPENDENCY_UNAVAILABLE, 'owning read authorization failed');
      }
      throw error;
    }
    if (authorized.outcome !== 'ALLOW') {
      throw new SnapshotBoundaryError(
        AUTHORIZATION_REVOKED,
        'the current capability grant does not cover this owning read',
      );
    }
    expiries.push(authorized.expiresAt);
    currentReads.push(async () => {
      const result = await authorizeCommand(boundary.identityDeps(baseContext), {
        actorSnapshotRef: session.resolutionActorSnapshotRef,
        intent: {
          commandType: request.commandType,
          commandVersion: request.commandVersion,
          scopeKind: request.scopeKind,
          enterpriseId: row.enterprise_id,
          ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
          purpose: request.purpose,
          requestedCapability: request.capability,
          commandPayloadHash: request.payloadHash,
          requestedAt: now(),
          highRiskAction: false,
        },
        authenticationContextHash: sessionAuthenticationContextHash(session),
        policySnapshotRef: policySnapshotReference(row),
      });
      if (result.outcome !== 'ALLOW' || now().getTime() >= Date.parse(authorized.expiresAt))
        entryError(AUTHORIZATION_REVOKED, 'dependency authorization is no longer current');
    });
    return read(
      boundary.identityDeps({
        ...baseContext,
        authorizationDecisionId: authorized.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          authorized.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(authorized.expiresAt),
      }),
    );
  }

  /**
   * One Policy resolution through the owning `identity.resolve_policy@1.0`
   * entry, under a Decision minted for this read. The builder Policy Port and
   * the capture-Policy Port of the owning Slice read both need exactly this,
   * and neither inherits the build Decision: the resolution carries its own
   * purpose, capability and current grant.
   */
  function resolvePolicyView(
    row: DecisionRow,
    session: InitialContextSession,
    request: {
      readonly policyRef: Common.VersionedRef;
      readonly asOf: Date;
      readonly correlationId: string;
    },
  ): Promise<PolicyVersionResolutionView> {
    const policyScope = record(request.policyRef).scope;
    const projectId = uuid(record(policyScope).projectId);
    return authorizedRead(
      row,
      session,
      {
        commandType: RESOLVE_POLICY_COMMAND,
        commandVersion: '1.0',
        purpose: RESOLVE_POLICY_PURPOSE,
        capability: config.capabilities.resolvePolicy,
        scopeValue: policyScope as CanonicalJsonObject,
        scopeKind: projectId === undefined ? 'ENTERPRISE' : 'PROJECT',
        ...(projectId === undefined ? {} : { projectId }),
        payloadHash: payloadHashOf({ policyRef: request.policyRef }),
        correlationId: request.correlationId,
      },
      (deps) =>
        resolvePolicy(deps, {
          envelope: {
            queryId: newUuidV7(),
            queryType: RESOLVE_POLICY_COMMAND,
            queryVersion: '1.0',
            scopeRef: policyScope,
            requester: {
              kind: 'OBJECT',
              objectType: PRINCIPAL_OBJECT_TYPE,
              objectId: row.principal_id,
              scope: policyScope,
            },
            authenticationContextRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.identity.authentication_context',
              objectId: row.actor_snapshot_id,
              scope: policyScope,
              contentHash: contentHash(sessionAuthenticationContextHash(session).toString('hex')),
            },
            authorizationDecisionRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: AUTHORIZATION_DECISION_OBJECT_TYPE,
              objectId: deps.context.authorizationDecisionId,
              scope: policyScope,
              contentHash: contentHash(deps.context.authorizationDecisionHash.toString('hex')),
            },
            consistencyRequirement: 'AUTHORITATIVE',
            correlationId: request.correlationId,
            requestedAt: request.asOf.toISOString(),
            payload: { policyRef: request.policyRef },
          },
          asOf: request.asOf,
        }),
    );
  }

  /**
   * The builder Policy Port of §19.4 item 3: the only source of a Policy
   * observation is the owning `identity.resolve_policy@1.0` entry and the
   * fields are mapped one by one. A caller-supplied or fixture-derived
   * observation never enters here.
   */
  /** The capture-Policy Port the owning Slice read expects for its own re-check. */
  function sliceCapturePolicyPort(
    row: DecisionRow,
    session: InitialContextSession,
  ): CapturePolicyResolutionPort {
    return {
      async resolveCapturePolicy(request): Promise<CapturePolicyResolution> {
        try {
          const view = await resolvePolicyView(row, session, request);
          return {
            kind: 'RESOLVED',
            observation: {
              policyRef: view.policyRef,
              policyVersionRef: view.policyVersionRef,
              policySetVersion: view.policySetVersion,
              policySchemaRefs: view.policySchemaRefs,
              policyDocument: view.policyDocument,
              contentHash: view.contentHash,
              scopeRef: view.scopeRef,
              effectiveFrom: view.effectiveFrom,
              ...(view.supersededAt === undefined ? {} : { supersededAt: view.supersededAt }),
              useStatus: view.useStatus,
              checkedAt: view.checkedAt,
            },
          };
        } catch (error) {
          if (error instanceof SnapshotBoundaryError) return { kind: 'UNAVAILABLE' };
          throw error;
        }
      },
    };
  }

  /**
   * The Source Slice read of §19.3 item 3. The reference is dereferenced
   * through the owning AUTHORITATIVE `project.get_context_source_slice@1.0`
   * read, which re-checks the reference, Scope, purpose, audience and the
   * capture Policy lifecycle under its own Decision minted for this read; the
   * build only learns the owning observation. A missing committed Slice is the
   * Port's own `undefined` answer — the owning handler, not this entry,
   * decides that a missing or unusable Slice rejects the build — while an
   * unavailable read boundary fails closed as `DEPENDENCY_UNAVAILABLE`.
   */
  function sliceReadPort(
    row: DecisionRow,
    session: InitialContextSession,
  ): ContextSourceSliceReadPort {
    return {
      async getContextSourceSlice(request) {
        const ref = record(request.sourceSliceRef);
        const refScope = record(ref.scope);
        const enterpriseId = uuid(refScope.enterpriseId);
        const projectId = uuid(refScope.projectId);
        const sliceId = uuid(ref.objectId);
        const contentHashHex = digest(ref.contentHash);
        if (
          ref.kind !== 'CONTENT_ADDRESSED' ||
          ref.objectType !== CONTEXT_SOURCE_SLICE_OBJECT_TYPE ||
          sliceId === undefined ||
          enterpriseId === undefined ||
          projectId === undefined ||
          contentHashHex === undefined
        ) {
          throw new SnapshotBoundaryError(
            API_VALUE_INVALID,
            'the source slice reference is not a Slice content address',
          );
        }
        const payload: EnterpriseProject.ProjectGetContextSourceSlicePayload = {
          sourceSliceRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: CONTEXT_SOURCE_SLICE_OBJECT_TYPE,
            objectId: sliceId,
            scope: { enterpriseId, projectId },
            contentHash: contentHash(contentHashHex),
          },
        };
        let result: EnterpriseProject.ProjectGetContextSourceSliceResult;
        try {
          result = await authorizedRead(
            row,
            session,
            {
              commandType: GET_CONTEXT_SOURCE_SLICE_QUERY,
              commandVersion: '1.0',
              purpose: GET_CONTEXT_SOURCE_SLICE_PURPOSE,
              capability: config.capabilities.readContextSourceSlice,
              scopeValue: { enterpriseId, projectId },
              scopeKind: 'PROJECT',
              projectId,
              payloadHash: payloadHashOf(payload),
              correlationId: row.authorization_decision_id,
            },
            (deps) =>
              handleGetContextSourceSlice(
                config.enterpriseProjectDb,
                boundary.enterpriseProjectContext(
                  {
                    ...row,
                    authorization_decision_id: deps.context.authorizationDecisionId,
                    payload_hash: deps.context.authorizationDecisionHash,
                    expires_at: deps.context.authorizationDecisionExpiresAt,
                    purpose: GET_CONTEXT_SOURCE_SLICE_PURPOSE,
                  },
                  { scopeKind: 'PROJECT', enterpriseId, projectId },
                  row.authorization_decision_id,
                ),
                payload,
                {
                  policyResolution: sliceCapturePolicyPort(row, session),
                  now,
                },
              ),
          );
        } catch (error) {
          if (error instanceof EnterpriseBusinessError && error.code === PROJECT_QUERY_NOT_FOUND) {
            return undefined;
          }
          if (error instanceof SnapshotBoundaryError) {
            throw new SnapshotBoundaryError(
              DEPENDENCY_UNAVAILABLE,
              'the source slice read is unavailable',
            );
          }
          throw error;
        }
        return {
          slice: result.slice as unknown as CanonicalJsonObject,
          useStatus: result.useStatus,
          checkedAt: result.checkedAt,
        };
      },
    };
  }

  return {
    slices: sliceReadPort(row, session),
    resolvePolicy: (policyRef: CanonicalJsonObject) =>
      resolvePolicyView(row, session, {
        policyRef: policyRef as unknown as Common.VersionedRef,
        asOf: now(),
        correlationId: row.authorization_decision_id,
      }),
    decisionExpiries: () => [...expiries],
    async revalidate() {
      for (const check of currentReads) await check();
    },
  };
}
