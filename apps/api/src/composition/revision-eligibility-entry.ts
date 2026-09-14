// IM-06 (#192) composition entry for the Revision execution eligibility Query.
//
// The executing service (the TE Evaluator) or an authorized Human holds its
// own current Decision for `quality.revision.execution_eligibility.read`; this
// entry proves that Decision through the shared composition boundary
// (registered Envelope, exact operation, payload hash, actor, Scope, session
// and the current covering capability grant) and only then calls the owning
// QualityGovernance handler. The exact Revision, the Revision acceptance
// snapshot and the optional Approval Bundle are bound with their Scope and
// content hashes before the owning read runs, so a Decision issued for another
// operation, session, Scope or payload can never be replayed here, and an
// unregistered or wildcard Purpose never reaches the owning module.

import type { Kysely } from 'kysely';
import { ContractRegistry, type Common, type QualityGovernance } from '@zhiju/contracts';
import {
  handleGetRevisionExecutionEligibility,
  REVISION_EXECUTION_ELIGIBILITY_PURPOSE,
  REVISION_EXECUTION_ELIGIBILITY_QUERY,
  type QualityGovernanceDb,
} from '@zhiju/quality-governance';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  SCOPE_MISMATCH,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityPolicyRepository,
} from '@zhiju/identity-policy';
import {
  contentHash,
  contractViolation,
  createDecisionBoundary,
  decisionReference,
  digest,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  uuid,
  type DecisionBoundary,
  type RequestScope,
} from './decision-boundary.js';

const ARTIFACT_REVISION_OBJECT_TYPE = 'artifact.artifact_revision';
const REVISION_ACCEPTANCE_OBJECT_TYPE = 'quality.revision_acceptance_snapshot';
const APPROVAL_BUNDLE_OBJECT_TYPE = 'quality.approval_bundle_snapshot';

export interface RevisionEligibilityEntryConfig {
  /** Owning QualityGovernance database handle over an application-owned pool. */
  readonly qualityDb: Kysely<QualityGovernanceDb>;
  /** Owning IdentityPolicy dependencies; the Decision ports live here. */
  readonly identity: {
    readonly db: Kysely<IdentityPolicyDb>;
    readonly repo: IdentityPolicyRepository;
    readonly crypto: IdentityCryptoPorts;
  };
  /** Capability code the transport evaluates for the registered purpose. */
  readonly capabilities: {
    readonly read: string;
  };
  /** Trusted server clock. */
  readonly now?: (() => Date) | undefined;
}

export interface RevisionEligibilitySession {
  /**
   * Authentication-context hash pinned by the transport for this caller
   * session. The presented Decision must have been issued for exactly this
   * authentication context.
   */
  readonly authenticationContextHash: Buffer;
}

export interface RevisionEligibilityEntry {
  /** `quality.get_revision_execution_eligibility@1.0` through the boundary. */
  read(
    envelope: unknown,
    session: RevisionEligibilitySession,
  ): Promise<QualityGovernance.RevisionExecutionEligibilityResult>;
}

interface EligibilityRequest {
  readonly revisionRef: Common.ContentAddressedRef;
  readonly revisionAcceptanceRef: Common.SnapshotRef;
  readonly approvalBundleRef?: Common.SnapshotRef;
  readonly scope: RequestScope;
}

/**
 * The requested exact Revision content address: the registered Artifact
 * Revision object type, an exact Project scope and a complete content hash.
 * The Revision Scope must also be the Envelope Scope, so the Decision is
 * validated for exactly the Project whose Revision eligibility is read.
 */
function revisionReference(
  payloadRef: unknown,
  envelopeScope: Record<string, unknown> | null,
): { readonly ref: Common.ContentAddressedRef; readonly scope: RequestScope } {
  const ref = record(payloadRef);
  const refScope = record(ref.scope);
  const objectId = uuid(ref.objectId);
  const enterpriseId = uuid(refScope.enterpriseId);
  const projectId = uuid(refScope.projectId);
  const hash = digest(ref.contentHash);
  if (
    ref.kind !== 'CONTENT_ADDRESSED' ||
    ref.objectType !== ARTIFACT_REVISION_OBJECT_TYPE ||
    objectId === undefined ||
    enterpriseId === undefined ||
    projectId === undefined ||
    hash === undefined
  ) {
    entryError(API_VALUE_INVALID, 'revisionRef must be an exact Revision content address');
  }
  if (envelopeScope?.enterpriseId !== enterpriseId || envelopeScope.projectId !== projectId) {
    entryError(SCOPE_MISMATCH, 'scopeRef must carry the requested Revision Project scope');
  }
  return {
    ref: {
      kind: 'CONTENT_ADDRESSED',
      objectType: ARTIFACT_REVISION_OBJECT_TYPE,
      objectId,
      scope: { enterpriseId, projectId },
      contentHash: contentHash(hash),
    },
    scope: { scopeKind: 'PROJECT', enterpriseId, projectId },
  };
}

/** One requested Quality snapshot, exactly scoped to the trusted Project. */
function snapshotReference(
  value: unknown,
  objectType: string,
  scope: RequestScope,
  label: string,
): Common.SnapshotRef {
  const ref = record(value);
  const refScope = record(ref.scope);
  const objectId = uuid(ref.objectId);
  const snapshotId = uuid(ref.snapshotId);
  const hash = digest(ref.contentHash);
  if (
    ref.kind !== 'SNAPSHOT' ||
    ref.objectType !== objectType ||
    objectId === undefined ||
    snapshotId === undefined ||
    hash === undefined
  ) {
    entryError(API_VALUE_INVALID, `${label} must be an exact Quality snapshot reference`);
  }
  if (refScope.enterpriseId !== scope.enterpriseId || refScope.projectId !== scope.projectId) {
    entryError(SCOPE_MISMATCH, `${label} is outside the requested Project scope`);
  }
  return {
    kind: 'SNAPSHOT',
    objectType,
    objectId,
    snapshotId,
    scope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
    contentHash: contentHash(hash),
  };
}

/**
 * The complete registered payload of one eligibility Query. Every reference
 * carries the Envelope's Project scope, and an absent Approval Bundle stays
 * absent so the owning module answers the approved NOT_APPLICABLE branch
 * instead of inferring an approval result.
 */
function eligibilityRequest(
  payload: Record<string, unknown> | null,
  envelopeScope: Record<string, unknown> | null,
): EligibilityRequest {
  const revision = revisionReference(payload?.revisionRef, envelopeScope);
  const scope = revision.scope;
  return {
    revisionRef: revision.ref,
    revisionAcceptanceRef: snapshotReference(
      payload?.revisionAcceptanceRef,
      REVISION_ACCEPTANCE_OBJECT_TYPE,
      scope,
      'revisionAcceptanceRef',
    ),
    ...(payload?.approvalBundleRef === undefined
      ? {}
      : {
          approvalBundleRef: snapshotReference(
            payload.approvalBundleRef,
            APPROVAL_BUNDLE_OBJECT_TYPE,
            scope,
            'approvalBundleRef',
          ),
        }),
    scope,
  };
}

export function createRevisionEligibilityEntry(
  config: RevisionEligibilityEntryConfig,
): RevisionEligibilityEntry {
  const registry = new ContractRegistry();
  const boundary: DecisionBoundary = createDecisionBoundary(config);

  return {
    async read(envelope, session) {
      const violation = contractViolation(registry, REVISION_EXECUTION_ELIGIBILITY_QUERY, envelope);
      if (violation !== null) {
        entryError(violation, 'the read Envelope does not satisfy its registered contract');
      }
      const query = record(envelope);
      if (query.consistencyRequirement !== 'AUTHORITATIVE') {
        entryError(API_VALUE_INVALID, 'the eligibility Query must be AUTHORITATIVE');
      }
      const request = eligibilityRequest(record(query.payload), record(query.scopeRef));
      // The trusted session is the only accepted source of the authentication
      // context: the Envelope reference and the Decision must both belong to
      // exactly this session, so a Decision issued for another session can
      // never be replayed through this entry.
      const sessionHash = sessionAuthenticationContextHash(session);
      const authenticationContext = record(query.authenticationContextRef);
      const envelopeAuthenticationContextHash = digest(authenticationContext.contentHash);
      if (envelopeAuthenticationContextHash === undefined) {
        entryError(AUTHORIZATION_DECISION_INVALID, 'the Query must pin an authentication context');
      }
      if (envelopeAuthenticationContextHash !== sessionHash.toString('hex')) {
        entryError(
          AUTHORIZATION_DECISION_INVALID,
          'the Query authentication context is not the trusted session',
        );
      }
      const decision = await boundary.validatedDecision({
        decisionRef: decisionReference(query.authorizationDecisionRef),
        commandType: REVISION_EXECUTION_ELIGIBILITY_QUERY,
        purpose: REVISION_EXECUTION_ELIGIBILITY_PURPOSE,
        capability: config.capabilities.read,
        scope: request.scope,
        payloadHash: payloadHashOf(query.payload),
        authenticationContextHash: sessionHash,
        actorRef: query.requester,
      });
      return handleGetRevisionExecutionEligibility(
        config.qualityDb,
        boundary.qualityGovernanceContext(decision, request.scope, query.correlationId as string),
        {
          revisionRef: request.revisionRef,
          revisionAcceptanceRef: request.revisionAcceptanceRef,
          ...(request.approvalBundleRef === undefined
            ? {}
            : { approvalBundleRef: request.approvalBundleRef }),
        },
      );
    },
  };
}
