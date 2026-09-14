// IM-06 (#192): real PostgreSQL acceptance for the authoritative Revision
// execution eligibility Query.
//
// Positive facts are established through the real owning QualityGovernance
// path (QualityProfile draft/activation, GateResult recording, Revision
// acceptance evaluation, Approval Request/Decision and the Approval Bundle
// snapshot), and reads enter through the composition entry in
// `@zhiju/api/composition` — the same boundary a transport uses — with a real
// IdentityPolicy Decision minted for
// `quality.revision.execution_eligibility.read` and the current covering
// capability grant. The negative cases prove that a historical READY /
// FULLY_APPROVED pair stops authorizing new execution once a Gate is
// invalidated or an Approval is revoked, that mismatched or foreign bindings
// and wrong Purposes are refused, and that the Query never rewrites history.

import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { Kysely } from 'kysely';
import {
  createRevisionEligibilityEntry,
  type RevisionEligibilityEntry,
} from '@zhiju/api/composition';
import {
  API_VALUE_INVALID,
  AUTHORIZATION_DECISION_INVALID,
  AUTHORIZATION_REVOKED,
  authorizeCommand,
  createActorSnapshot,
  createIdentityPolicyDatabase,
  digestCanonicalPayload as digestIdentityPayload,
  grantCapability,
  IdentityPolicyRepository,
  recordPolicySnapshot,
  revokeCapability,
  SCOPE_MISMATCH,
  withIdentityTransaction,
  type IdentityCommandDeps,
  type IdentityCryptoPorts,
  type IdentityPolicyDb,
  type IdentityTransactionContext,
} from '@zhiju/identity-policy';
import {
  createQualityGovernanceDatabase,
  digestCanonicalPayload,
  handleActivateQualityProfile,
  handleCreateQualityProfileDraft,
  handleEvaluateRevisionReadiness,
  handleGetApprovalBundleSnapshot,
  handleGetRevisionAcceptanceSnapshot,
  handleGetRevisionExecutionEligibility,
  handleInvalidateGateResult,
  handleRecordGateResult,
  handleRequestApproval,
  handleRevokeApproval,
  handleSubmitApprovalDecision,
  QUALITY_APPROVAL_GATE_BUNDLE_INVALID,
  QUALITY_APPROVAL_INVALID,
  QUALITY_APPROVAL_QUERY_NOT_FOUND,
  QUALITY_EXECUTION_ELIGIBILITY_UNAUTHORIZED,
  QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND,
  QualityBusinessRepository,
  REVISION_EXECUTION_ELIGIBILITY_PURPOSE,
  REVISION_EXECUTION_ELIGIBILITY_QUERY,
  withQualityGovernanceTransaction,
  type CommandEnvelope,
  type CommandResult,
  type QualityCommandEnvelope,
  type QualityGovernanceDb,
  type QualityTransactionContext,
} from '@zhiju/quality-governance';
import { ContractRegistry, type Common, type Core, type QualityGovernance } from '@zhiju/contracts';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';

const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const gateEnabled = Boolean(databaseUrl);
const registry = new ContractRegistry();

const PROBE_ROLE = 'im06_wi192_probe';
const PROBE_PASSWORD = 'im06-wi192-probe';

const ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9e001';
const PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9e002';
const OTHER_ENTERPRISE = '018f22e2-7c15-7b2e-8d86-2de956a9e003';
const OTHER_PROJECT = '018f22e2-7c15-7b2e-8d86-2de956a9e004';

const AUTHOR = '018f22e2-7c15-7b2e-8d86-2de956a9e005';
const AUTHOR_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9e006';
const AUTHOR_DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9e007';
const AUTHOR_CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9e008';
const FIRST_APPROVER = '018f22e2-7c15-7b2e-8d86-2de956a9e009';
const FIRST_APPROVER_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9e00a';
const FIRST_APPROVER_DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9e00b';
const FIRST_APPROVER_CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9e00c';
const SECOND_APPROVER = '018f22e2-7c15-7b2e-8d86-2de956a9e00d';
const SECOND_APPROVER_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9e00e';
const SECOND_APPROVER_DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9e00f';
const SECOND_APPROVER_CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9e010';

const EVALUATOR_PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9e011';
const EVALUATOR_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9e012';
const REVOCABLE_GRANT = '018f22e2-7c15-7b2e-8d86-2de956a9e013';
const ELIGIBILITY_GRANT = '018f22e2-7c15-7b2e-8d86-2de956a9e014';
const OTHER_PURPOSE_GRANT = '018f22e2-7c15-7b2e-8d86-2de956a9e015';
const POLICY_SNAPSHOT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9e016';
const POLICY_SNAPSHOT_SET_VERSION = 'wi192-grant-policy-set';
const SEED_DECISION = '018f22e2-7c15-7b2e-8d86-2de956a9e017';
const AUTH_CONTEXT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9e018';
const CORRELATION = '018f22e2-7c15-7b2e-8d86-2de956a9e019';

// Non-Human/Service principals. IdentityPolicy's generic grant path admits
// them for this capability, so the operation-specific allowlist has to refuse
// them with an exact Purpose, Scope, payload and active grant.
const AGENT_PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9e021';
const AGENT_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9e022';
const AGENT_GRANT = '018f22e2-7c15-7b2e-8d86-2de956a9e023';
const RUNTIME_PRINCIPAL = '018f22e2-7c15-7b2e-8d86-2de956a9e024';
const RUNTIME_ACTOR = '018f22e2-7c15-7b2e-8d86-2de956a9e025';
const RUNTIME_GRANT = '018f22e2-7c15-7b2e-8d86-2de956a9e026';

const ARTIFACT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9e01a';
const REVISION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9e01b';
const INVALIDATED_REVISION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9e01c';
const FOREIGN_REVISION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9e01d';

const DECISION_HASH = Buffer.alloc(32, 0x31);
const AUTH_HASH = Buffer.alloc(32, 0x32);
const OTHER_SESSION_HASH = Buffer.alloc(32, 0x33);
const PAST = new Date('2026-01-01T00:00:00.000Z');

const ELIGIBILITY_CAPABILITY = REVISION_EXECUTION_ELIGIBILITY_PURPOSE;
const REVOCABLE_CAPABILITY = 'wi192.revocable.read';
const OTHER_PURPOSE = 'wi192.other.read';

interface Scope {
  readonly enterpriseId: string;
  readonly projectId: string;
}

/**
 * Any reference Scope: an Enterprise-only Scope or an Enterprise/Project one.
 * Type aliases (not interfaces) are used so a Scope stays assignable to the
 * canonical JSON payload positions of the commands that carry it.
 */
interface RefScope {
  readonly enterpriseId: string;
  readonly projectId?: string;
}

interface ProfileFixture {
  readonly profileRef: Common.VersionedRef;
  readonly revisionGateId: string;
  readonly approvalRequirementId: string;
}

interface ReadinessFixture {
  readonly snapshotRef: Common.SnapshotRef;
  readonly snapshot: Core.RevisionAcceptanceSnapshot;
}

interface EligibilityOutcome {
  revisionAcceptanceUsable: boolean;
  approvalBundleUsable: { presence: string; value?: boolean };
  reasonCodes: readonly string[];
  approvalBundleRef?: Common.SnapshotRef;
  observedAt: string;
  sourceWatermarks: readonly {
    sourceModule: string;
    partition?: string;
    sequence: number;
    observedAt: string;
  }[];
}

function testCrypto(): IdentityCryptoPorts {
  return {
    lookupHash: {
      computeKeyedLookupHash(input: string) {
        return {
          hash: createHmac('sha256', Buffer.alloc(32, 0x6c)).update(input, 'utf8').digest(),
          algorithm: 'HMAC-SHA-256' as const,
          keyVersion: 1,
        };
      },
    },
    fieldEncryption: {
      encryptField() {
        throw new Error('not needed');
      },
      decryptField() {
        throw new Error('not needed');
      },
    },
  };
}

function hash(byte: number): Common.ContentHash {
  return {
    algorithm: 'SHA-256',
    digest: Buffer.alloc(32, byte).toString('hex'),
    canonicalizationVersion: '1',
  };
}

function enterpriseScope(): Scope {
  return { enterpriseId: ENTERPRISE, projectId: PROJECT };
}

describe.skipIf(!gateEnabled)(
  'Revision execution eligibility Query (real PostgreSQL, IM-06 #192)',
  { concurrent: false },
  () => {
    const crypto = testCrypto();
    let admin: pg.Client;
    let qualityPool: pg.Pool;
    let identityPool: pg.Pool;
    let db: Kysely<QualityGovernanceDb>;
    let identityDb: Kysely<IdentityPolicyDb>;
    let identityRepo: IdentityPolicyRepository;
    let grantPolicyHash: Buffer;
    let evaluatorActorRef: Common.SnapshotRef;
    let agentActorRef: Common.SnapshotRef;
    let runtimeActorRef: Common.SnapshotRef;
    let entry: RevisionEligibilityEntry;
    let revocableEntry: RevisionEligibilityEntry;
    let otherPurposeEntry: RevisionEligibilityEntry;

    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        `DO $do$
         BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${PROBE_ROLE}') THEN
             CREATE ROLE ${PROBE_ROLE} LOGIN PASSWORD '${PROBE_PASSWORD}'
               NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
           END IF;
         END $do$`,
      );
      await admin.query(
        `GRANT platform_context_establisher, quality_governance_app, identity_policy_app TO ${PROBE_ROLE}`,
      );
      const url = new URL(databaseUrl ?? '');
      url.username = PROBE_ROLE;
      url.password = PROBE_PASSWORD;
      const probeUrl = url.toString();
      qualityPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
      identityPool = new pg.Pool({ connectionString: probeUrl, max: 6 });
      db = createQualityGovernanceDatabase(qualityPool);
      identityDb = createIdentityPolicyDatabase(identityPool);
      identityRepo = new IdentityPolicyRepository(crypto);
      await registerIdentityFacts();
      const identity = { db: identityDb, repo: identityRepo, crypto };
      entry = createRevisionEligibilityEntry({
        qualityDb: db,
        identity,
        capabilities: { read: ELIGIBILITY_CAPABILITY },
      });
      revocableEntry = createRevisionEligibilityEntry({
        qualityDb: db,
        identity,
        capabilities: { read: REVOCABLE_CAPABILITY },
      });
      otherPurposeEntry = createRevisionEligibilityEntry({
        qualityDb: db,
        identity,
        capabilities: { read: OTHER_PURPOSE },
      });
    });

    afterAll(async () => {
      await qualityPool.end();
      await identityPool.end();
      await admin.end();
    });

    // -----------------------------------------------------------------------
    // Identity fixtures: the TE Evaluator Service principal, its current
    // capability grants and the ActorSnapshot its Decisions are issued for.
    // -----------------------------------------------------------------------

    function identityContext(
      allowedProjectIds: readonly string[] = [],
      enterpriseId = ENTERPRISE,
    ): IdentityTransactionContext {
      return {
        kind: 'REQUEST',
        principalId: EVALUATOR_PRINCIPAL,
        actorSnapshotId: EVALUATOR_ACTOR,
        authorizationDecisionId: SEED_DECISION,
        authorizationDecisionHash: DECISION_HASH,
        authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        enterpriseId,
        allowedProjectIds,
        correlationId: CORRELATION,
      };
    }

    function identityDeps(context: IdentityTransactionContext): IdentityCommandDeps {
      return { db: identityDb, repo: identityRepo, crypto, context };
    }

    function grantPolicySnapshotReference(): Common.SnapshotRef {
      return {
        kind: 'SNAPSHOT',
        objectType: 'identity.policy_snapshot',
        objectId: POLICY_SNAPSHOT_ID,
        snapshotId: POLICY_SNAPSHOT_ID,
        scope: {},
        contentHash: {
          algorithm: 'SHA-256',
          digest: grantPolicyHash.toString('hex'),
          canonicalizationVersion: '1',
        },
      };
    }

    async function registerIdentityFacts(): Promise<void> {
      for (const principal of [
        {
          id: EVALUATOR_PRINCIPAL,
          kind: 'SERVICE' as const,
          name: 'WI192 TE evaluator service fixture',
        },
        { id: AGENT_PRINCIPAL, kind: 'AGENT' as const, name: 'WI192 agent fixture' },
        { id: RUNTIME_PRINCIPAL, kind: 'RUNTIME' as const, name: 'WI192 runtime fixture' },
      ]) {
        await withIdentityTransaction(identityDb, identityContext(), (trx) =>
          identityRepo.insertPrincipal(trx, {
            id: principal.id,
            principalKind: principal.kind,
            displayName: principal.name,
            createdByPrincipalId: EVALUATOR_PRINCIPAL,
            createdByActorSnapshotId: EVALUATOR_ACTOR,
          }),
        );
      }
      const platformPolicy = await recordPolicySnapshot(identityDeps(identityContext()), {
        policySnapshotId: POLICY_SNAPSHOT_ID,
        policySetVersion: POLICY_SNAPSHOT_SET_VERSION,
        policySchemaRefs: ['identity.PolicySnapshot@1.0'],
        effectiveFrom: PAST,
        policyDocument: { rules: ['wi192-grant-policy'], version: 1 },
        idempotencyKey: 'wi192:policy-snapshot',
      });
      expect(platformPolicy).toMatchObject({ status: 'COMMITTED' });
      const snapshot = await admin.query<{ payload_hash: Buffer }>(
        `SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1`,
        [POLICY_SNAPSHOT_ID],
      );
      grantPolicyHash = snapshot.rows[0]?.payload_hash ?? Buffer.alloc(0);
      expect(grantPolicyHash).toHaveLength(32);
      // The eligibility capability is not registered as Human-only, so every
      // one of these grants is accepted for its principal kind.
      for (const grant of [
        { id: ELIGIBILITY_GRANT, code: ELIGIBILITY_CAPABILITY, principalId: EVALUATOR_PRINCIPAL },
        { id: REVOCABLE_GRANT, code: REVOCABLE_CAPABILITY, principalId: EVALUATOR_PRINCIPAL },
        { id: OTHER_PURPOSE_GRANT, code: OTHER_PURPOSE, principalId: EVALUATOR_PRINCIPAL },
        { id: AGENT_GRANT, code: ELIGIBILITY_CAPABILITY, principalId: AGENT_PRINCIPAL },
        { id: RUNTIME_GRANT, code: ELIGIBILITY_CAPABILITY, principalId: RUNTIME_PRINCIPAL },
      ]) {
        const result = await grantCapability(identityDeps(identityContext([PROJECT])), {
          grantId: grant.id,
          principalId: grant.principalId,
          capabilityCode: grant.code,
          scope: {
            scopeKind: 'PROJECT' as const,
            enterpriseId: ENTERPRISE,
            projectId: PROJECT,
          },
          resourceSelectors: [],
          actions: [grant.code],
          validFrom: PAST,
          grantPolicySnapshotId: POLICY_SNAPSHOT_ID,
          grantPolicySnapshotHash: grantPolicyHash,
          justification: 'wi192 fixture',
          idempotencyKey: `wi192:grant:${grant.id}`,
        });
        expect(result).toMatchObject({ status: 'COMMITTED' });
      }
      evaluatorActorRef = await createActorSnapshot(identityDeps(identityContext([PROJECT])), {
        actorSnapshotId: EVALUATOR_ACTOR,
        principalId: EVALUATOR_PRINCIPAL,
        declaredPrincipalKind: 'SERVICE',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
      });
      agentActorRef = await createActorSnapshot(identityDeps(identityContext([PROJECT])), {
        actorSnapshotId: AGENT_ACTOR,
        principalId: AGENT_PRINCIPAL,
        declaredPrincipalKind: 'AGENT',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
      });
      runtimeActorRef = await createActorSnapshot(identityDeps(identityContext([PROJECT])), {
        actorSnapshotId: RUNTIME_ACTOR,
        principalId: RUNTIME_PRINCIPAL,
        declaredPrincipalKind: 'RUNTIME',
        authenticationContextHash: AUTH_HASH,
        scopeKind: 'PROJECT',
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
      });
    }

    /** Mints one Decision for the exact eligibility Query payload. */
    async function eligibilityDecisionRef(
      payload: CanonicalJsonObject,
      overrides: {
        readonly purpose?: string;
        readonly capability?: string;
        readonly actorRef?: Common.SnapshotRef;
      } = {},
    ): Promise<Common.ContentAddressedRef> {
      const decision = await authorizeCommand(identityDeps(identityContext([PROJECT])), {
        actorSnapshotRef: overrides.actorRef ?? evaluatorActorRef,
        intent: {
          commandType: REVISION_EXECUTION_ELIGIBILITY_QUERY,
          commandVersion: '1.0',
          scopeKind: 'PROJECT',
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
          purpose: overrides.purpose ?? ELIGIBILITY_CAPABILITY,
          requestedCapability: overrides.capability ?? ELIGIBILITY_CAPABILITY,
          commandPayloadHash: digestIdentityPayload(payload).hash,
          requestedAt: new Date(),
          highRiskAction: false,
        },
        authenticationContextHash: AUTH_HASH,
        policySnapshotRef: grantPolicySnapshotReference(),
        ttlSeconds: 900,
      });
      expect(decision.outcome).toBe('ALLOW');
      return decision.authorizationDecisionRef;
    }

    // -----------------------------------------------------------------------
    // QualityGovernance fixtures built through the real owning handlers.
    // -----------------------------------------------------------------------

    function qualityContext(
      principalId: string,
      actorSnapshotId: string,
      authorizationDecisionId: string,
      correlationId: string,
      scope: Scope = enterpriseScope(),
    ): QualityTransactionContext {
      return {
        kind: 'REQUEST',
        principalId,
        principalKind: 'HUMAN',
        actorSnapshotId,
        authorizationDecisionId,
        authorizationDecisionHash: Buffer.alloc(32, 0x21),
        authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        policySnapshotId: POLICY_SNAPSHOT_ID,
        enterpriseId: scope.enterpriseId,
        allowedProjectIds: [scope.projectId],
        correlationId,
      };
    }

    function objectRef(scope: Scope, objectType: string, objectId: string): Common.ObjectRef {
      return { kind: 'OBJECT', objectType, objectId, scope };
    }

    function contentRef(
      scope: Scope,
      objectType: string,
      objectId: string,
      byte: number,
    ): Common.ContentAddressedRef {
      return {
        kind: 'CONTENT_ADDRESSED',
        objectType,
        objectId,
        scope,
        contentHash: hash(byte),
      };
    }

    function snapshotRef(scope: RefScope, objectType: string, byte: number): Common.SnapshotRef {
      const snapshotId = newUuidV7();
      return {
        kind: 'SNAPSHOT',
        objectType,
        objectId: newUuidV7(),
        snapshotId,
        scope: {
          enterpriseId: scope.enterpriseId,
          ...(scope.projectId === undefined ? {} : { projectId: scope.projectId }),
        },
        contentHash: hash(byte),
      };
    }

    function envelope<TPayload extends object>(
      current: QualityTransactionContext,
      targetType: string,
      targetId: string,
      payload: TPayload,
      overrides: Partial<CommandEnvelope> = {},
    ): QualityCommandEnvelope<TPayload> {
      const commandType = `quality.${targetType}`;
      const projectId = current.allowedProjectIds[0];
      return {
        commandId: newUuidV7(),
        commandType,
        commandVersion: '1.0',
        idempotencyScope: 'im06.wi192',
        idempotencyKey: `${targetType}:${targetId}:${newUuidV7()}`,
        requestPayload: { commandType, payload } as unknown as CanonicalJsonObject,
        enterpriseId: current.enterpriseId,
        ...(targetType === 'quality.quality_profile' || projectId === undefined
          ? {}
          : { projectId }),
        targetType,
        targetId,
        correlationId: current.correlationId,
        principalId: current.principalId,
        principalKind: current.principalKind,
        actorSnapshotId: current.actorSnapshotId,
        authorizationDecisionId: current.authorizationDecisionId,
        policySnapshotId: current.policySnapshotId,
        ...overrides,
        payload,
      };
    }

    function committed(result: CommandResult): CanonicalJsonObject {
      expect(result.status).toBe('COMMITTED');
      if (result.status !== 'COMMITTED') {
        throw new Error(`expected COMMITTED, got ${result.status}`);
      }
      return result.resultPayload;
    }

    function resultRef(payload: CanonicalJsonObject, key: string): Common.TypedReference {
      const value = payload[key];
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${key} is not a typed reference`);
      }
      return value as unknown as Common.TypedReference;
    }

    function profileGate(gateSpecId: string, mandatory: boolean): CanonicalJsonObject {
      return {
        gateSpecId,
        gateType: 'STRUCTURAL_SCHEMA',
        gateVersion: '1.0.0',
        evaluationStage: 'REVISION_ACCEPTANCE',
        mandatory,
        applicabilityRule: { kind: 'always' },
        inputContract: { objectType: 'ArtifactRevision' },
        evaluatorPolicy: { principalKind: 'SERVICE' },
        passCriteria: { outcome: 'PASS' },
        failureSeverity: 'MAJOR',
        blockingRule: { outcomes: ['FAIL', 'ERROR'] },
        dependencyGateSpecIds: [],
        rerunRule: { onChange: 'IMPACT_ANALYSIS' },
        resultRetentionRule: { retain: 'regulated' },
      };
    }

    function profileDefinition(
      scope: Scope,
      mandatoryGateId: string,
      optionalGateId: string,
      name: string,
    ): QualityGovernance.QualityProfileDefinition {
      return {
        name,
        profileVersion: '1.0.0',
        applicableArtifactTypes: ['artifact.dhf_section'],
        riskApplicability: { riskLevels: ['MEDIUM'] },
        gateSpecs: [profileGate(mandatoryGateId, true), profileGate(optionalGateId, false)],
        gateDependencies: [],
        rerunPolicy: { allowImpactReuse: true, reusableOutcomes: ['PASS'] },
        issuePolicy: { blockingLevels: ['CRITICAL', 'MAJOR'] },
        separationOfDutiesPolicy: { authorMayReviewOwnWork: false },
        approvalRequirements: [
          { requiredRole: 'quality.reviewer', requiredCount: 1, approverKind: 'HUMAN' },
        ],
        releaseRequirements: [
          {
            purpose: 'formal_release',
            formats: ['DOCX'],
            recipientScope: { enterpriseId: scope.enterpriseId },
            validity: { validFrom: '2026-01-01T00:00:00Z', validTo: '2027-01-01T00:00:00Z' },
            receiptRequired: true,
          },
        ],
      };
    }

    async function createProfile(
      current: QualityTransactionContext,
      name: string,
      scope: Scope = enterpriseScope(),
    ): Promise<ProfileFixture> {
      const profileId = newUuidV7();
      const mandatoryGateId = newUuidV7();
      const optionalGateId = newUuidV7();
      const draft = committed(
        await handleCreateQualityProfileDraft(
          db,
          current,
          envelope(current, 'quality.quality_profile', profileId, {
            definition: profileDefinition(
              scope,
              mandatoryGateId,
              optionalGateId,
              `${name}_${profileId}`,
            ),
          }),
        ),
      );
      const profileRef = resultRef(draft, 'qualityProfileRef') as Common.VersionedRef;
      const activation = committed(
        await handleActivateQualityProfile(
          db,
          current,
          envelope(
            current,
            'quality.quality_profile',
            profileId,
            {
              profileVersionRef: profileRef,
              reviewSnapshotRef: snapshotRef(
                { enterpriseId: scope.enterpriseId },
                'quality.quality_profile_review',
                0x11,
              ),
              validationSnapshotRef: snapshotRef(
                { enterpriseId: scope.enterpriseId },
                'quality.quality_profile_validation',
                0x12,
              ),
              activatedAt: '2026-09-14T00:10:00Z',
            },
            { expectedAggregateVersion: '1' },
          ),
        ),
      );
      expect(activation).toMatchObject({ status: 'ACTIVE' });
      const requirements = await withQualityGovernanceTransaction(db, current, (trx) =>
        trx
          .selectFrom('quality_governance.quality_profile_approval_requirement')
          .selectAll()
          .where('profile_version_id', '=', profileRef.versionId)
          .execute(),
      );
      const approvalRequirementId = requirements[0]?.approval_requirement_id;
      if (approvalRequirementId === undefined) {
        throw new Error('approval requirement was not persisted');
      }
      return { profileRef, revisionGateId: mandatoryGateId, approvalRequirementId };
    }

    async function recordGate(
      current: QualityTransactionContext,
      profile: ProfileFixture,
      scope: Scope,
      revisionRef: Common.ContentAddressedRef,
      evaluatedAt: string,
    ): Promise<Common.ContentAddressedRef> {
      const gateResultId = newUuidV7();
      const result = committed(
        await handleRecordGateResult(
          db,
          current,
          envelope(current, 'quality.gate_result', gateResultId, {
            submission: {
              artifactRef: objectRef(scope, 'artifact.artifact', ARTIFACT_ID),
              gateTarget: { kind: 'REVISION', revisionRef },
              evaluationStage: 'REVISION_ACCEPTANCE',
              qualityProfileRef: profile.profileRef,
              gateSpecId: profile.revisionGateId,
              gateVersion: '1.0.0',
              evaluationAttempt: 1,
              evaluatedScope: { enterpriseId: scope.enterpriseId, projectId: scope.projectId },
              inputSnapshotRef: snapshotRef(scope, 'quality.gate_input', 0x20),
              evaluator: { evaluatorId: 'synthetic_gate', evaluatorVersion: '1.0.0' },
              outcome: 'PASS',
              findings: [],
              evidenceRefs: [],
              startedAt: evaluatedAt,
              completedAt: evaluatedAt,
            } satisfies QualityGovernance.GateResultSubmission,
          }),
        ),
      );
      return resultRef(result, 'gateResultRef') as Common.ContentAddressedRef;
    }

    async function evaluateReadiness(
      current: QualityTransactionContext,
      profile: ProfileFixture,
      scope: Scope,
      revisionRef: Common.ContentAddressedRef,
      gateResultRefs: readonly Common.ContentAddressedRef[],
      evaluatedAt: string,
    ): Promise<ReadinessFixture> {
      const payload = committed(
        await handleEvaluateRevisionReadiness(
          db,
          current,
          envelope(current, 'quality.revision_acceptance_snapshot', newUuidV7(), {
            revisionRef,
            qualityProfileRef: profile.profileRef,
            gateResultRefs,
            evidenceStatusSnapshotRef: snapshotRef(scope, 'quality.evidence_status_snapshot', 0x30),
            issueSnapshotRef: snapshotRef(scope, 'quality.issue_snapshot', 0x31),
            evaluatorVersions: [{ evaluatorId: 'synthetic_readiness', evaluatorVersion: '1.0.0' }],
            evaluatedAt,
          }),
        ),
      );
      const snapshot = payload.snapshot as unknown as Core.RevisionAcceptanceSnapshot;
      expect(snapshot.readiness.status).toBe('READY');
      return {
        snapshotRef: resultRef(payload, 'snapshotRef') as Common.SnapshotRef,
        snapshot,
      };
    }

    async function openApprovalRequest(
      current: QualityTransactionContext,
      scope: Scope,
      profile: ProfileFixture,
      revisionRef: Common.ContentAddressedRef,
      acceptanceRef: Common.SnapshotRef,
      nonce: number,
    ): Promise<{ readonly requestId: string; readonly requestRef: Common.ObjectRef }> {
      const requestId = newUuidV7();
      const payload = committed(
        await handleRequestApproval(
          db,
          current,
          envelope(current, 'quality.approval_request', requestId, {
            definition: {
              artifactRef: objectRef(scope, 'artifact.artifact', ARTIFACT_ID),
              revisionRef,
              revisionAcceptanceSnapshotRef: acceptanceRef,
              qualityProfileRef: profile.profileRef,
              approvalRequirementId: profile.approvalRequirementId,
              requestedApproverRole: 'quality.reviewer',
              expiresAt: '2026-12-31T00:00:00Z',
              requestNonceHash: hash(nonce),
            },
          }),
        ),
      );
      return {
        requestId,
        requestRef: resultRef(payload, 'requestRef') as Common.ObjectRef,
      };
    }

    async function submitApproval(
      current: QualityTransactionContext,
      scope: Scope,
      requestId: string,
      requestRef: Common.ObjectRef,
      revisionRef: Common.ContentAddressedRef,
      acceptanceRef: Common.SnapshotRef,
      profile: ProfileFixture,
      decidedAt: string,
      decision: QualityGovernance.ApprovalSubmission['decision'] = 'APPROVED',
    ): Promise<{
      readonly approvalRef: Common.ContentAddressedRef;
      readonly bundleRef: Common.SnapshotRef;
    }> {
      const payload = committed(
        await handleSubmitApprovalDecision(
          db,
          current,
          envelope(current, 'quality.approval_request', requestId, {
            submission: {
              requestRef,
              revisionRef,
              revisionAcceptanceSnapshotRef: acceptanceRef,
              approvalRequirementId: profile.approvalRequirementId,
              decision,
              decisionComment: 'Synthetic independent Human approval for technical verification.',
              approverHumanPrincipalRef: {
                principalKind: 'HUMAN',
                principalId: current.principalId,
              },
              approverRoleSnapshotRef: snapshotRef(scope, 'identity.role_assignment', 0x61),
              authorizationDecisionRef: contentRef(
                scope,
                'identity.authorization_decision',
                newUuidV7(),
                0x62,
              ),
              separationCheckRef: contentRef(scope, 'quality.separation_check', newUuidV7(), 0x63),
              decidedAt,
            } satisfies QualityGovernance.ApprovalSubmission,
          }),
        ),
      );
      return {
        approvalRef: resultRef(payload, 'approvalRef') as Common.ContentAddressedRef,
        bundleRef: resultRef(payload, 'approvalBundleSnapshotRef') as Common.SnapshotRef,
      };
    }

    async function qualityFactCounts(current: QualityTransactionContext) {
      return withQualityGovernanceTransaction(db, current, async (trx) => {
        const acceptance = await trx
          .selectFrom('quality_governance.revision_acceptance_snapshot')
          .select(({ fn }) => fn.countAll().as('total'))
          .executeTakeFirstOrThrow();
        const bundles = await trx
          .selectFrom('quality_governance.approval_bundle_snapshot')
          .select(({ fn }) => fn.countAll().as('total'))
          .executeTakeFirstOrThrow();
        const approvals = await trx
          .selectFrom('quality_governance.approval')
          .select(({ fn }) => fn.countAll().as('total'))
          .executeTakeFirstOrThrow();
        const invalidations = await trx
          .selectFrom('quality_governance.gate_invalidation')
          .select(({ fn }) => fn.countAll().as('total'))
          .executeTakeFirstOrThrow();
        return {
          acceptance: String(acceptance.total),
          bundles: String(bundles.total),
          approvals: String(approvals.total),
          invalidations: String(invalidations.total),
        };
      });
    }

    // -----------------------------------------------------------------------
    // The composition entry surface: a registered Envelope plus the trusted
    // session, exactly as a transport would present them.
    // -----------------------------------------------------------------------

    function queryPayload(input: {
      readonly revisionRef: Common.ContentAddressedRef;
      readonly revisionAcceptanceRef: Common.SnapshotRef;
      readonly approvalBundleRef?: Common.SnapshotRef;
    }): CanonicalJsonObject {
      return {
        revisionRef: input.revisionRef,
        revisionAcceptanceRef: input.revisionAcceptanceRef,
        ...(input.approvalBundleRef === undefined
          ? {}
          : { approvalBundleRef: input.approvalBundleRef }),
      } as unknown as CanonicalJsonObject;
    }

    function eligibilityEnvelope(input: {
      readonly payload: CanonicalJsonObject;
      readonly decisionRef: Common.ContentAddressedRef;
      readonly scope: Scope;
      readonly authenticationContextHash?: Buffer;
      readonly queryType?: string;
      readonly requester?: Common.SnapshotRef;
    }): Record<string, unknown> {
      const sessionHash = input.authenticationContextHash ?? AUTH_HASH;
      return {
        queryId: newUuidV7(),
        queryType: input.queryType ?? REVISION_EXECUTION_ELIGIBILITY_QUERY,
        queryVersion: '1.0',
        scopeRef: input.scope,
        requester: input.requester ?? evaluatorActorRef,
        authenticationContextRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'zhiju.identity.authentication_context',
          objectId: AUTH_CONTEXT_ID,
          scope: input.scope,
          contentHash: {
            algorithm: 'SHA-256',
            digest: sessionHash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
        authorizationDecisionRef: input.decisionRef,
        consistencyRequirement: 'AUTHORITATIVE',
        correlationId: CORRELATION,
        requestedAt: new Date().toISOString(),
        payload: input.payload,
      };
    }

    async function readThroughEntry(input: {
      readonly revisionRef: Common.ContentAddressedRef;
      readonly revisionAcceptanceRef: Common.SnapshotRef;
      readonly approvalBundleRef?: Common.SnapshotRef;
      readonly purpose?: string;
      readonly capability?: string;
      readonly target?: RevisionEligibilityEntry;
      readonly scope?: Scope;
      readonly authenticationContextHash?: Buffer;
      readonly sessionHash?: Buffer;
      readonly actorRef?: Common.SnapshotRef;
    }): Promise<EligibilityOutcome> {
      const scope = input.scope ?? enterpriseScope();
      const payload = queryPayload(input);
      const decisionRef = await eligibilityDecisionRef(payload, {
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        ...(input.capability === undefined ? {} : { capability: input.capability }),
        ...(input.actorRef === undefined ? {} : { actorRef: input.actorRef }),
      });
      const result = await (input.target ?? entry).read(
        eligibilityEnvelope({
          payload,
          decisionRef,
          scope,
          ...(input.actorRef === undefined ? {} : { requester: input.actorRef }),
          ...(input.authenticationContextHash === undefined
            ? {}
            : { authenticationContextHash: input.authenticationContextHash }),
        }),
        { authenticationContextHash: input.sessionHash ?? AUTH_HASH },
      );
      const contract = registry.validateOperationResult(
        REVISION_EXECUTION_ELIGIBILITY_QUERY,
        '1.0',
        result,
      );
      expect(contract, JSON.stringify(contract.errors, null, 2)).toEqual({
        valid: true,
        errors: [],
      });
      return result;
    }

    it('QG-TD-001 reports current eligibility for the exact Revision with trusted watermarks', async () => {
      const scope = enterpriseScope();
      const author = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      const approver = qualityContext(
        FIRST_APPROVER,
        FIRST_APPROVER_ACTOR,
        FIRST_APPROVER_DECISION,
        FIRST_APPROVER_CORRELATION,
      );
      const profile = await createProfile(author, 'IM06_WI192');
      const revisionRef = contentRef(scope, 'artifact.artifact_revision', REVISION_ID, 0x41);
      const gateRef = await recordGate(author, profile, scope, revisionRef, '2026-09-14T00:11:00Z');
      const readiness = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T00:12:00Z',
      );
      const request = await openApprovalRequest(
        author,
        scope,
        profile,
        revisionRef,
        readiness.snapshotRef,
        0x51,
      );
      const approval = await submitApproval(
        approver,
        scope,
        request.requestId,
        request.requestRef,
        revisionRef,
        readiness.snapshotRef,
        profile,
        '2026-09-14T00:20:00Z',
      );
      expect(
        await handleGetApprovalBundleSnapshot(db, approver, {
          snapshotRef: approval.bundleRef,
        }),
      ).toMatchObject({ completeness: { status: 'FULLY_APPROVED' } });

      const countsBefore = await qualityFactCounts(author);
      const outcome = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: readiness.snapshotRef,
        approvalBundleRef: approval.bundleRef,
      });

      expect(outcome).toMatchObject({
        revisionAcceptanceUsable: true,
        approvalBundleUsable: { presence: 'PRESENT', value: true },
        reasonCodes: [],
      });
      expect(outcome.approvalBundleRef).toEqual(approval.bundleRef);
      expect(outcome.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
      expect(outcome.sourceWatermarks).toHaveLength(1);
      expect(outcome.sourceWatermarks[0]).toMatchObject({
        sourceModule: 'quality_governance',
        partition: revisionRef.objectId,
        observedAt: outcome.observedAt,
      });
      expect(outcome.sourceWatermarks[0]?.sequence).toBeGreaterThan(0);

      // The observation is read-only: no acceptance, bundle, approval or
      // invalidation row is created, updated or deleted by the Query.
      expect(await qualityFactCounts(author)).toEqual(countsBefore);
      const storedAcceptance = await withQualityGovernanceTransaction(db, author, (trx) =>
        trx
          .selectFrom('quality_governance.revision_acceptance_snapshot')
          .select(['status', 'payload_hash'])
          .where('snapshot_id', '=', readiness.snapshotRef.snapshotId)
          .executeTakeFirstOrThrow(),
      );
      expect(storedAcceptance.status).toBe('READY');
      expect(storedAcceptance.payload_hash).toEqual(
        Buffer.from(readiness.snapshotRef.contentHash.digest, 'hex'),
      );
      await expect(
        handleGetRevisionAcceptanceSnapshot(db, author, { snapshotRef: readiness.snapshotRef }),
      ).resolves.toMatchObject({ readiness: { status: 'READY' } });

      // A later READY acceptance for the same Revision/Profile supersedes the
      // requested one: the historical pair is no longer current eligibility.
      const laterReadiness = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T00:30:00Z',
      );
      const superseded = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: readiness.snapshotRef,
        approvalBundleRef: approval.bundleRef,
      });
      expect(superseded).toMatchObject({
        revisionAcceptanceUsable: false,
        approvalBundleUsable: { presence: 'PRESENT', value: false },
      });
      expect(superseded.reasonCodes).toContain('QUALITY_REVISION_ACCEPTANCE_NOT_READY');

      const current = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: laterReadiness.snapshotRef,
      });
      expect(current).toMatchObject({
        revisionAcceptanceUsable: true,
        approvalBundleUsable: { presence: 'NOT_APPLICABLE' },
      });
      expect(current.approvalBundleRef).toBeUndefined();
    }, 30000);

    it('QG-TD-002 stops authorizing once a Gate is invalidated or an Approval is revoked', async () => {
      const scope = enterpriseScope();
      const author = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      const approver = qualityContext(
        SECOND_APPROVER,
        SECOND_APPROVER_ACTOR,
        SECOND_APPROVER_DECISION,
        SECOND_APPROVER_CORRELATION,
      );
      const profile = await createProfile(author, 'IM06_WI192_GATE');
      const revisionRef = contentRef(
        scope,
        'artifact.artifact_revision',
        INVALIDATED_REVISION_ID,
        0x42,
      );
      const gateRef = await recordGate(author, profile, scope, revisionRef, '2026-09-14T01:11:00Z');
      const readiness = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T01:12:00Z',
      );
      expect(
        (
          await readThroughEntry({
            revisionRef,
            revisionAcceptanceRef: readiness.snapshotRef,
          })
        ).revisionAcceptanceUsable,
      ).toBe(true);

      const invalidated = committed(
        await handleInvalidateGateResult(
          db,
          author,
          envelope(author, 'quality.gate_result', gateRef.objectId, {
            invalidationReason: {
              reasonCode: 'QUALITY_UPSTREAM_CHANGED',
              summary: 'Synthetic upstream change invalidated the prior result.',
              evidenceRefs: [],
            },
            impactAssessmentRef: contentRef(scope, 'quality.impact_assessment', newUuidV7(), 0x54),
            invalidatedAt: '2026-09-14T01:13:00Z',
          }),
        ),
      );
      expect(invalidated.validityStatus).toBe('INVALIDATED');

      const afterInvalidation = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: readiness.snapshotRef,
      });
      expect(afterInvalidation.revisionAcceptanceUsable).toBe(false);
      expect(afterInvalidation.reasonCodes).toContain('STALE_GATE_RESULT');
      expect(afterInvalidation.approvalBundleUsable).toEqual({ presence: 'NOT_APPLICABLE' });

      // The historical snapshot keeps its recorded READY state and stays
      // readable through the legacy exact Query; only eligibility changes.
      await expect(
        handleGetRevisionAcceptanceSnapshot(db, author, { snapshotRef: readiness.snapshotRef }),
      ).resolves.toMatchObject({ readiness: { status: 'READY' } });
      expect(
        (
          await readThroughEntry({
            revisionRef,
            revisionAcceptanceRef: readiness.snapshotRef,
          })
        ).revisionAcceptanceUsable,
      ).toBe(false);

      // A revoked Approval makes the historical FULLY_APPROVED bundle stop
      // being a current approval set for the same exact Revision.
      const approvalProfile = await createProfile(author, 'IM06_WI192_APPROVAL');
      const approvalRevisionRef = contentRef(
        scope,
        'artifact.artifact_revision',
        REVISION_ID,
        0x43,
      );
      const approvalGateRef = await recordGate(
        author,
        approvalProfile,
        scope,
        approvalRevisionRef,
        '2026-09-14T02:11:00Z',
      );
      const approvalReadiness = await evaluateReadiness(
        author,
        approvalProfile,
        scope,
        approvalRevisionRef,
        [approvalGateRef],
        '2026-09-14T02:12:00Z',
      );
      const firstApprover = qualityContext(
        FIRST_APPROVER,
        FIRST_APPROVER_ACTOR,
        FIRST_APPROVER_DECISION,
        FIRST_APPROVER_CORRELATION,
      );
      const request = await openApprovalRequest(
        author,
        scope,
        approvalProfile,
        approvalRevisionRef,
        approvalReadiness.snapshotRef,
        0x52,
      );
      await submitApproval(
        firstApprover,
        scope,
        request.requestId,
        request.requestRef,
        approvalRevisionRef,
        approvalReadiness.snapshotRef,
        approvalProfile,
        '2026-09-14T02:20:00Z',
      );
      const second = await submitApproval(
        approver,
        scope,
        request.requestId,
        request.requestRef,
        approvalRevisionRef,
        approvalReadiness.snapshotRef,
        approvalProfile,
        '2026-09-14T02:21:00Z',
      );
      expect(
        (
          await readThroughEntry({
            revisionRef: approvalRevisionRef,
            revisionAcceptanceRef: approvalReadiness.snapshotRef,
            approvalBundleRef: second.bundleRef,
          })
        ).approvalBundleUsable,
      ).toEqual({ presence: 'PRESENT', value: true });

      const revoked = committed(
        await handleRevokeApproval(db, approver, {
          ...envelope(approver, 'quality.approval', second.approvalRef.objectId, {
            revocationReason: {
              reasonCode: 'QUALITY_APPROVAL_REVOKED',
              summary: 'Synthetic upstream impact invalidates one approval.',
              evidenceRefs: [],
            },
            impactAssessmentRef: contentRef(scope, 'quality.impact_assessment', newUuidV7(), 0x71),
            revokedAt: '2026-09-14T02:22:00Z',
          }),
          expectedAggregateVersion: '1',
        }),
      );
      expect(revoked).toMatchObject({ status: 'REVOKED' });

      const afterRevocation = await readThroughEntry({
        revisionRef: approvalRevisionRef,
        revisionAcceptanceRef: approvalReadiness.snapshotRef,
        approvalBundleRef: second.bundleRef,
      });
      expect(afterRevocation.revisionAcceptanceUsable).toBe(true);
      expect(afterRevocation.approvalBundleUsable).toEqual({ presence: 'PRESENT', value: false });
      expect(afterRevocation.reasonCodes).toContain(QUALITY_APPROVAL_GATE_BUNDLE_INVALID);
      expect(afterRevocation.reasonCodes).toContain(QUALITY_APPROVAL_INVALID);

      // The revoked Approval and the superseded bundle stay immutable and
      // readable exactly as recorded.
      await expect(
        handleGetApprovalBundleSnapshot(db, approver, { snapshotRef: second.bundleRef }),
      ).resolves.toMatchObject({ completeness: { status: 'FULLY_APPROVED' } });
    }, 30000);

    it('QG-TD-003 refuses wrong bindings, foreign facts and unauthorized Purposes', async () => {
      const scope = enterpriseScope();
      const author = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      const profile = await createProfile(author, 'IM06_WI192_NEGATIVE');
      const revisionRef = contentRef(scope, 'artifact.artifact_revision', REVISION_ID, 0x61);
      const gateRef = await recordGate(author, profile, scope, revisionRef, '2026-09-14T03:11:00Z');
      const readiness = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T03:12:00Z',
      );

      // A substituted Acceptance hash is unresolvable, not "not usable".
      await expect(
        readThroughEntry({
          revisionRef,
          revisionAcceptanceRef: { ...readiness.snapshotRef, contentHash: hash(0x7f) },
        }),
      ).rejects.toMatchObject({ code: QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND });

      // An Acceptance of another Revision never answers for this Revision.
      const otherRevisionRef = contentRef(
        scope,
        'artifact.artifact_revision',
        FOREIGN_REVISION_ID,
        0x62,
      );
      const otherGateRef = await recordGate(
        author,
        profile,
        scope,
        otherRevisionRef,
        '2026-09-14T03:13:00Z',
      );
      const otherReadiness = await evaluateReadiness(
        author,
        profile,
        scope,
        otherRevisionRef,
        [otherGateRef],
        '2026-09-14T03:14:00Z',
      );
      await expect(
        readThroughEntry({ revisionRef, revisionAcceptanceRef: otherReadiness.snapshotRef }),
      ).rejects.toMatchObject({ code: QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND });

      // A caller whose trusted Scope does not cover the reference is refused
      // before any Quality fact is read.
      await expect(
        readThroughEntry({
          revisionRef,
          revisionAcceptanceRef: {
            ...readiness.snapshotRef,
            scope: { enterpriseId: ENTERPRISE, projectId: OTHER_PROJECT },
          },
        }),
      ).rejects.toMatchObject({ code: SCOPE_MISMATCH });
      await expect(
        readThroughEntry({
          revisionRef: {
            ...revisionRef,
            scope: { enterpriseId: OTHER_ENTERPRISE, projectId: OTHER_PROJECT },
          },
          revisionAcceptanceRef: readiness.snapshotRef,
          scope: { enterpriseId: OTHER_ENTERPRISE, projectId: OTHER_PROJECT },
        }),
      ).rejects.toMatchObject({ code: SCOPE_MISMATCH });

      // Another Enterprise's accepted Revision is invisible rather than
      // "empty": the caller sees the uniform unresolvable answer and no fact.
      const foreignScope: Scope = {
        enterpriseId: OTHER_ENTERPRISE,
        projectId: OTHER_PROJECT,
      };
      const foreignAuthor = qualityContext(
        AUTHOR,
        AUTHOR_ACTOR,
        AUTHOR_DECISION,
        AUTHOR_CORRELATION,
        foreignScope,
      );
      const foreignProfile = await createProfile(foreignAuthor, 'IM06_WI192_FOREIGN', foreignScope);
      const foreignRevisionRef = contentRef(
        foreignScope,
        'artifact.artifact_revision',
        FOREIGN_REVISION_ID,
        0x63,
      );
      const foreignGateRef = await recordGate(
        foreignAuthor,
        foreignProfile,
        foreignScope,
        foreignRevisionRef,
        '2026-09-14T03:15:00Z',
      );
      const foreignReadiness = await evaluateReadiness(
        foreignAuthor,
        foreignProfile,
        foreignScope,
        foreignRevisionRef,
        [foreignGateRef],
        '2026-09-14T03:16:00Z',
      );
      const foreignCounts = await qualityFactCounts(foreignAuthor);
      // The reference is presented as this caller's Scope while it names the
      // other Enterprise's row: the caller gets the uniform unresolvable
      // answer and learns nothing about the foreign fact.
      await expect(
        readThroughEntry({
          revisionRef,
          revisionAcceptanceRef: {
            ...foreignReadiness.snapshotRef,
            scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
          },
        }),
      ).rejects.toMatchObject({ code: QUALITY_READINESS_SNAPSHOT_QUERY_NOT_FOUND });
      await expect(
        readThroughEntry({
          revisionRef: foreignRevisionRef,
          revisionAcceptanceRef: foreignReadiness.snapshotRef,
        }),
      ).rejects.toMatchObject({ code: SCOPE_MISMATCH });
      expect(await qualityFactCounts(foreignAuthor)).toEqual(foreignCounts);

      // The owning handler refuses a caller whose pinned Decision does not
      // cover the exact registered Purpose, even inside the trusted Scope.
      const unpinned = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      await expect(
        handleGetRevisionExecutionEligibility(db, unpinned, {
          revisionRef,
          revisionAcceptanceRef: readiness.snapshotRef,
        }),
      ).rejects.toMatchObject({ code: QUALITY_EXECUTION_ELIGIBILITY_UNAUTHORIZED });
      await expect(
        handleGetRevisionExecutionEligibility(
          db,
          {
            ...unpinned,
            authorizationPurposes: [`${REVISION_EXECUTION_ELIGIBILITY_PURPOSE}.all`],
          },
          { revisionRef, revisionAcceptanceRef: readiness.snapshotRef },
        ),
      ).rejects.toMatchObject({ code: QUALITY_EXECUTION_ELIGIBILITY_UNAUTHORIZED });

      // An Envelope that declares another Query type never reaches the owning
      // module: it fails against the registered operation it claims to be.
      const payload = queryPayload({ revisionRef, revisionAcceptanceRef: readiness.snapshotRef });
      await expect(
        entry.read(
          eligibilityEnvelope({
            payload,
            decisionRef: await eligibilityDecisionRef(payload),
            scope,
            queryType: 'quality.get_revision_eligibility',
          }),
          { authenticationContextHash: AUTH_HASH },
        ),
      ).rejects.toMatchObject({ code: API_VALUE_INVALID });

      // An unregistered payload member is rejected by the registered schema.
      await expect(
        entry.read(
          eligibilityEnvelope({
            payload: { ...payload, current: true },
            decisionRef: await eligibilityDecisionRef(payload),
            scope,
          }),
          { authenticationContextHash: AUTH_HASH },
        ),
      ).rejects.toMatchObject({ code: API_VALUE_INVALID });

      // A Decision issued for another Purpose never passes the boundary.
      await expect(
        readThroughEntry({
          revisionRef,
          revisionAcceptanceRef: readiness.snapshotRef,
          purpose: OTHER_PURPOSE,
          capability: OTHER_PURPOSE,
          target: otherPurposeEntry,
        }),
      ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

      // A Decision issued for another session is not replayable.
      await expect(
        readThroughEntry({
          revisionRef,
          revisionAcceptanceRef: readiness.snapshotRef,
          sessionHash: OTHER_SESSION_HASH,
        }),
      ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });

      // A requested Approval Bundle of another Revision is refused.
      const otherRequest = await openApprovalRequest(
        author,
        scope,
        profile,
        otherRevisionRef,
        otherReadiness.snapshotRef,
        0x53,
      );
      const otherApproval = await submitApproval(
        qualityContext(
          FIRST_APPROVER,
          FIRST_APPROVER_ACTOR,
          FIRST_APPROVER_DECISION,
          FIRST_APPROVER_CORRELATION,
        ),
        scope,
        otherRequest.requestId,
        otherRequest.requestRef,
        otherRevisionRef,
        otherReadiness.snapshotRef,
        profile,
        '2026-09-14T03:17:00Z',
      );
      await expect(
        readThroughEntry({
          revisionRef,
          revisionAcceptanceRef: readiness.snapshotRef,
          approvalBundleRef: otherApproval.bundleRef,
        }),
      ).rejects.toMatchObject({ code: QUALITY_APPROVAL_QUERY_NOT_FOUND });
    }, 30000);

    it('QG-TD-004 keeps a revoked capability grant from authorizing the read', async () => {
      const scope = enterpriseScope();
      const author = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      const profile = await createProfile(author, 'IM06_WI192_REVOCABLE');
      const revisionRef = contentRef(scope, 'artifact.artifact_revision', REVISION_ID, 0x71);
      const gateRef = await recordGate(author, profile, scope, revisionRef, '2026-09-14T04:11:00Z');
      const readiness = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T04:12:00Z',
      );
      const payload = queryPayload({ revisionRef, revisionAcceptanceRef: readiness.snapshotRef });
      const decisionRef = await eligibilityDecisionRef(payload, {
        capability: REVOCABLE_CAPABILITY,
      });
      const allowed = await revocableEntry.read(
        eligibilityEnvelope({ payload, decisionRef, scope }),
        { authenticationContextHash: AUTH_HASH },
      );
      expect(allowed.revisionAcceptanceUsable).toBe(true);

      const revoked = await revokeCapability(identityDeps(identityContext([PROJECT])), {
        targetId: REVOCABLE_GRANT,
        expectedAggregateVersion: '1',
        scope: {
          scopeKind: 'PROJECT',
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
        },
        reasonCode: 'WI192_REVOKED',
        effectiveAt: new Date(),
        idempotencyKey: 'wi192:revoke:read',
      });
      expect(revoked).toMatchObject({ status: 'COMMITTED' });

      // The same Decision that was valid a moment ago no longer authorizes
      // the read, because the covering capability is re-evaluated now.
      await expect(
        revocableEntry.read(eligibilityEnvelope({ payload, decisionRef, scope }), {
          authenticationContextHash: AUTH_HASH,
        }),
      ).rejects.toMatchObject({ code: AUTHORIZATION_REVOKED });
    }, 30000);

    it('QG-TD-006 keeps Approvals of a superseded Acceptance out of a new Bundle', async () => {
      const scope = enterpriseScope();
      const author = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      const firstApprover = qualityContext(
        FIRST_APPROVER,
        FIRST_APPROVER_ACTOR,
        FIRST_APPROVER_DECISION,
        FIRST_APPROVER_CORRELATION,
      );
      const secondApprover = qualityContext(
        SECOND_APPROVER,
        SECOND_APPROVER_ACTOR,
        SECOND_APPROVER_DECISION,
        SECOND_APPROVER_CORRELATION,
      );
      const profile = await createProfile(author, 'IM06_WI192_SUPERSEDED');
      const revisionRef = contentRef(scope, 'artifact.artifact_revision', REVISION_ID, 0x81);
      const gateRef = await recordGate(author, profile, scope, revisionRef, '2026-09-14T05:11:00Z');

      // RAS-1 is READY and fully approved by one independent Human.
      const firstAcceptance = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T05:12:00Z',
      );
      const firstRequest = await openApprovalRequest(
        author,
        scope,
        profile,
        revisionRef,
        firstAcceptance.snapshotRef,
        0x57,
      );
      const firstApproval = await submitApproval(
        firstApprover,
        scope,
        firstRequest.requestId,
        firstRequest.requestRef,
        revisionRef,
        firstAcceptance.snapshotRef,
        profile,
        '2026-09-14T05:13:00Z',
      );
      expect(
        (
          await readThroughEntry({
            revisionRef,
            revisionAcceptanceRef: firstAcceptance.snapshotRef,
            approvalBundleRef: firstApproval.bundleRef,
          })
        ).approvalBundleUsable,
      ).toEqual({ presence: 'PRESENT', value: true });

      // A newer Acceptance for the same Revision/Profile supersedes RAS-1, and
      // the decision on RAS-2 is not an approval.
      const secondAcceptance = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T05:20:00Z',
      );
      const secondRequest = await openApprovalRequest(
        author,
        scope,
        profile,
        revisionRef,
        secondAcceptance.snapshotRef,
        0x58,
      );
      const rejected = await submitApproval(
        secondApprover,
        scope,
        secondRequest.requestId,
        secondRequest.requestRef,
        revisionRef,
        secondAcceptance.snapshotRef,
        profile,
        '2026-09-14T05:21:00Z',
        'CHANGES_REQUESTED',
      );

      // The Approval recorded against RAS-1 is not part of the current
      // approval set, so the new Bundle cannot become FULLY_APPROVED and the
      // Query never reports an usable approval bundle for it.
      const currentBundle = await handleGetApprovalBundleSnapshot(db, secondApprover, {
        snapshotRef: rejected.bundleRef,
      });
      expect(currentBundle.completeness.status).not.toBe('FULLY_APPROVED');
      expect(currentBundle.approvalRefs).toEqual([]);
      const current = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: secondAcceptance.snapshotRef,
        approvalBundleRef: rejected.bundleRef,
      });
      expect(current.revisionAcceptanceUsable).toBe(true);
      expect(current.approvalBundleUsable).toEqual({ presence: 'PRESENT', value: false });
      expect(current.reasonCodes).toContain(QUALITY_APPROVAL_GATE_BUNDLE_INVALID);

      // The historical pair stays immutable and readable, but is no longer
      // current execution eligibility.
      const superseded = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: firstAcceptance.snapshotRef,
        approvalBundleRef: firstApproval.bundleRef,
      });
      expect(superseded).toMatchObject({
        revisionAcceptanceUsable: false,
        approvalBundleUsable: { presence: 'PRESENT', value: false },
      });
      await expect(
        handleGetApprovalBundleSnapshot(db, firstApprover, {
          snapshotRef: firstApproval.bundleRef,
        }),
      ).resolves.toMatchObject({ completeness: { status: 'FULLY_APPROVED' } });

      // A Bundle recorded before this fix could bind RAS-2 while counting the
      // Approval anchored to RAS-1. The eligibility recheck refuses that
      // stored artifact too, instead of trusting its FULLY_APPROVED record.
      // Every fact it references is a real owning-Handler artifact; only the
      // Bundle row itself reproduces the historical shape, written through the
      // same owning insert boundary the handler uses.
      const businessRepository = new QualityBusinessRepository();
      const legacySnapshotId = newUuidV7();
      const storedCurrent = await handleGetApprovalBundleSnapshot(db, secondApprover, {
        snapshotRef: rejected.bundleRef,
      });
      const legacySnapshot = {
        ...storedCurrent,
        snapshotId: legacySnapshotId,
        approvalRefs: [firstApproval.approvalRef],
        completeness: { status: 'FULLY_APPROVED', reasons: [] },
        evaluatedAt: '2026-09-14T05:22:00Z',
      } as unknown as Core.ApprovalBundleSnapshot;
      const legacyHash = digestCanonicalPayload(
        legacySnapshot as unknown as CanonicalJsonObject,
      ).hash;
      const legacyWrite = await withQualityGovernanceTransaction(db, author, (trx) =>
        businessRepository.insertApprovalBundleSnapshot(trx, {
          snapshotId: legacySnapshotId,
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
          snapshot: legacySnapshot,
          revisionContentHash: Buffer.from(revisionRef.contentHash.digest, 'hex'),
          payloadHash: legacyHash,
          createdByPrincipalId: author.principalId,
          createdByActorSnapshotId: author.actorSnapshotId,
          createdAuthorizationDecisionId: author.authorizationDecisionId,
          sourceCommandId: newUuidV7(),
        }),
      );
      expect(legacyWrite).toBe('OK');
      const legacy = await readThroughEntry({
        revisionRef,
        revisionAcceptanceRef: secondAcceptance.snapshotRef,
        approvalBundleRef: {
          kind: 'SNAPSHOT',
          objectType: 'quality.approval_bundle_snapshot',
          objectId: legacySnapshotId,
          snapshotId: legacySnapshotId,
          scope: { enterpriseId: ENTERPRISE, projectId: PROJECT },
          contentHash: {
            algorithm: 'SHA-256',
            digest: legacyHash.toString('hex'),
            canonicalizationVersion: '1',
          },
        },
      });
      expect(legacy.approvalBundleUsable).toEqual({ presence: 'PRESENT', value: false });
      expect(legacy.reasonCodes).toContain(QUALITY_APPROVAL_INVALID);
    }, 30000);

    it('QG-TD-007 admits only a Service or Human principal for the eligibility Query', async () => {
      const scope = enterpriseScope();
      const author = qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION);
      const profile = await createProfile(author, 'IM06_WI192_PRINCIPAL');
      const revisionRef = contentRef(scope, 'artifact.artifact_revision', REVISION_ID, 0x91);
      const gateRef = await recordGate(author, profile, scope, revisionRef, '2026-09-14T06:11:00Z');
      const readiness = await evaluateReadiness(
        author,
        profile,
        scope,
        revisionRef,
        [gateRef],
        '2026-09-14T06:12:00Z',
      );

      // The TE Evaluator Service keeps reading the exact payload.
      await expect(
        readThroughEntry({ revisionRef, revisionAcceptanceRef: readiness.snapshotRef }),
      ).resolves.toMatchObject({ revisionAcceptanceUsable: true });

      // `quality.revision.execution_eligibility.read` is not registered as a
      // Human-only capability, so IdentityPolicy grants these principals an
      // ALLOW Decision (`eligibilityDecisionRef` asserts the outcome) for the
      // exact Purpose, Scope and payload. The operation still refuses them.
      for (const actorRef of [agentActorRef, runtimeActorRef]) {
        const payload = queryPayload({
          revisionRef,
          revisionAcceptanceRef: readiness.snapshotRef,
        });
        const decisionRef = await eligibilityDecisionRef(payload, { actorRef });
        await expect(
          entry.read(eligibilityEnvelope({ payload, decisionRef, scope, requester: actorRef }), {
            authenticationContextHash: AUTH_HASH,
          }),
        ).rejects.toMatchObject({ code: AUTHORIZATION_DECISION_INVALID });
      }

      // The owning handler enforces the same allowlist on its trusted context,
      // so a non-admitted principal kind is refused even with the exact
      // registered Purpose pinned.
      for (const principalKind of ['AGENT', 'RUNTIME', 'EXTERNAL_PARTY'] as const) {
        await expect(
          handleGetRevisionExecutionEligibility(
            db,
            {
              ...qualityContext(AUTHOR, AUTHOR_ACTOR, AUTHOR_DECISION, AUTHOR_CORRELATION),
              principalKind,
              authorizationPurposes: [REVISION_EXECUTION_ELIGIBILITY_PURPOSE],
            },
            { revisionRef, revisionAcceptanceRef: readiness.snapshotRef },
          ),
        ).rejects.toMatchObject({ code: QUALITY_EXECUTION_ELIGIBILITY_UNAUTHORIZED });
      }
    }, 30000);
  },
);
