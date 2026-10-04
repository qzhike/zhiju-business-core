// IM-06 (#246): the trusted composition entry of
// `execution.get_usage_and_provenance@1.0` (Spec 003 §13, Spec 001 §15.18).
//
// The transport presents the Human Query Envelope together with a trusted TE
// query-service session. This entry:
//
//   1. validates the registered Envelope, its AUTHORITATIVE requirement, its
//      exact Run reference and the Human Decision (operation/version/Purpose,
//      actor, Scope, payload hash and current covering Grant);
//   2. proves the independent SERVICE source Decision that covers the same Run
//      Root, so no Human context ever reads the TE service source;
//   3. mints one target-bound SERVICE Decision per dependency read (frozen
//      Contract, IG Binding, IG Adapter identity, IG final), from the Run's own
//      committed fields only;
//   4. revalidates the Human, source, Contract and every used IG Decision
//      before the owning handler returns, so a revocation between checkpoints
//      fails the whole query instead of being masked as UNKNOWN.
//
// The entry writes nothing: no Receipt, no Audit, no business row. The only
// technical writes are the IdentityPolicy read Decisions it signs and the
// platform transaction Context housekeeping of the owning reads.

import { getContractRegistry, type Common } from '@zhiju/contracts';
import {
  createUsageProvenanceAuthorizationPort,
  type IdentityTransactionContext,
  type UsageProvenanceCapabilityCodes,
} from '@zhiju/identity-policy';
import {
  handleGetUsageAndProvenance,
  handleGetWorkOrderContract,
  type TaskExecutionDb,
  type TaskExecutionTransactionContext,
} from '@zhiju/task-execution';
import {
  ControlledRuntimeDispatchService,
  type IntegrationRendererDb,
  type RenderObjectStoragePort,
  type SyntheticRuntimeDriver,
} from '@zhiju/integration-gateway';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';
import type { Kysely } from 'kysely';
import {
  assertActorBinding,
  createDecisionBoundary,
  decisionReference,
  entryError,
  payloadHashOf,
  record,
  sessionAuthenticationContextHash,
  type DecisionRow,
  type IdentityBoundaryConfig,
} from './decision-boundary.js';
import type { InitialContextSession } from './initial-context-entry.js';

/** The transport supplies trusted module handles and one code per approved boundary. */
export interface UsageProvenanceEntryConfig extends IdentityBoundaryConfig {
  readonly taskExecutionDb: Kysely<TaskExecutionDb>;
  readonly integrationGatewayDb: Kysely<IntegrationRendererDb>;
  readonly runtimeDriver: SyntheticRuntimeDriver;
  readonly receiptStorage: RenderObjectStoragePort;
  readonly capabilityCodes: UsageProvenanceCapabilityCodes;
}

/**
 * The trusted TE query-service session. Its own actor and authentication
 * context sign the source/Contract/IG dependency Decisions, independently of
 * the Human Query session; `sourceDecisionRef` is the SERVICE Decision the
 * transport obtained for the exact Run Root.
 */
export interface UsageProvenanceSession extends InitialContextSession {
  readonly serviceSession: {
    readonly authenticationContextHash: Buffer;
    readonly resolutionActorSnapshotRef: Common.SnapshotRef;
    readonly sourceDecisionRef: Common.ContentAddressedRef;
  };
}

type Boundary = keyof UsageProvenanceCapabilityCodes;

const QUERY = 'execution.get_usage_and_provenance';
const QUERY_VERSION = '1.0';
const SOURCE_OPERATION = 'execution.run.usage_provenance.source.read.v1';
const ADAPTER_IDENTITY_OPERATION =
  'integration.runtime.adapter_identity.read.for_usage_provenance.v1';

function identityContext(row: DecisionRow): IdentityTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: row.principal_id,
    actorSnapshotId: row.actor_snapshot_id,
    authorizationDecisionId: row.authorization_decision_id,
    authorizationDecisionHash: row.payload_hash,
    authorizationDecisionExpiresAt: row.expires_at,
    enterpriseId: row.enterprise_id,
    allowedProjectIds: row.project_id === null ? [] : [row.project_id],
    correlationId: row.authorization_decision_id,
  };
}

export function createUsageProvenanceEntry(config: UsageProvenanceEntryConfig) {
  const registry = getContractRegistry();
  const boundary = createDecisionBoundary(config);
  const auth = createUsageProvenanceAuthorizationPort({
    capabilityCodes: config.capabilityCodes,
    ...(config.now === undefined ? {} : { now: config.now }),
  });
  const now = config.now ?? (() => new Date());

  return {
    async getUsageAndProvenance(value: unknown, session: UsageProvenanceSession) {
      const envelope = record(structuredClone(value));
      if (envelope.queryType !== QUERY || envelope.queryVersion !== QUERY_VERSION)
        entryError('API_CONTRACT_TYPE_UNKNOWN', 'unsupported usage provenance query');
      if (!registry.validateOperation(QUERY, QUERY_VERSION, envelope).valid)
        entryError('API_VALUE_INVALID', 'invalid usage provenance envelope');
      if (envelope.consistencyRequirement !== 'AUTHORITATIVE')
        entryError('API_VALUE_INVALID', 'usage provenance requires an AUTHORITATIVE read');
      const payload = record(envelope.payload) as CanonicalJsonObject;
      const runRef = record(payload.runRef) as CanonicalJsonObject;
      const subjectScope = record(runRef.scope);
      if (
        typeof subjectScope.enterpriseId !== 'string' ||
        typeof subjectScope.projectId !== 'string'
      )
        entryError('SCOPE_MISMATCH', 'Project scope required');
      const queryScope = record(envelope.scopeRef);
      if (
        queryScope.enterpriseId !== subjectScope.enterpriseId ||
        queryScope.projectId !== subjectScope.projectId
      )
        entryError('SCOPE_MISMATCH', 'the Run reference is outside the query scope');

      const payloadHash = payloadHashOf(payload);
      const humanSessionHash = sessionAuthenticationContextHash(session);
      if (
        record(record(envelope.authenticationContextRef).contentHash).digest !==
        humanSessionHash.toString('hex')
      )
        entryError('AUTHORIZATION_DECISION_INVALID', 'query authentication mismatch');
      const humanDecisionRef = decisionReference(envelope.authorizationDecisionRef);
      const humanRow = await boundary.readDecisionRow(humanDecisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId: subjectScope.enterpriseId,
        projectId: subjectScope.projectId,
      });
      assertActorBinding(envelope.requester, humanRow);
      assertActorBinding(session.resolutionActorSnapshotRef, humanRow);
      const humanDeps = boundary.identityDeps(identityContext(humanRow));
      const humanRevalidation = {
        decisionRef: humanDecisionRef,
        expectedCommandType: QUERY,
        expectedCommandVersion: QUERY_VERSION,
        expectedCommandPayloadHash: payloadHash,
        expectedAuthenticationContextHash: humanSessionHash,
        expectedTargetRef: runRef as unknown as Common.ObjectRef,
      };
      const revalidateHuman = async () => {
        const result = await auth.revalidate(
          humanDeps,
          'runUsageProvenanceReadHumanV1',
          humanRevalidation,
        );
        if (!result.valid)
          entryError('AUTHORIZATION_REVOKED', 'Human usage read authority is no longer current');
      };
      await revalidateHuman();

      // The independent SERVICE source Decision covers the same Run Root.
      const serviceSessionHash = sessionAuthenticationContextHash(session.serviceSession);
      const sourceDecisionRef = decisionReference(session.serviceSession.sourceDecisionRef);
      const sourceRow = await boundary.readDecisionRow(sourceDecisionRef, {
        scopeKind: 'PROJECT',
        enterpriseId: subjectScope.enterpriseId,
        projectId: subjectScope.projectId,
      });
      if (sourceRow.principal_kind !== 'SERVICE')
        entryError('AUTHORIZATION_REVOKED', 'usage source read requires a Service principal');
      assertActorBinding(session.serviceSession.resolutionActorSnapshotRef, sourceRow);
      const sourceDeps = boundary.identityDeps(identityContext(sourceRow));
      const sourceRevalidation = {
        decisionRef: sourceDecisionRef,
        expectedCommandType: SOURCE_OPERATION,
        expectedCommandVersion: QUERY_VERSION,
        expectedCommandPayloadHash: payloadHash,
        expectedAuthenticationContextHash: serviceSessionHash,
        expectedTargetRef: runRef as unknown as Common.ObjectRef,
      };
      const revalidateSource = async () => {
        const result = await auth.revalidate(
          sourceDeps,
          'runUsageProvenanceSourceReadV1',
          sourceRevalidation,
        );
        if (!result.valid)
          entryError('AUTHORIZATION_REVOKED', 'usage source read authority is no longer current');
      };
      await revalidateSource();

      const sourceContext: TaskExecutionTransactionContext = {
        ...identityContext(sourceRow),
        principalKind: 'SERVICE',
        policySnapshotId: sourceRow.policy_snapshot_id,
        correlationId: String(envelope.correlationId),
      };
      const checks: Parameters<typeof auth.revalidateBatch>[1][number][] = [];
      const mint = async (
        key: Boundary,
        commandType: string,
        ref: CanonicalJsonObject,
        dependencyPayload: CanonicalJsonObject,
      ) => {
        const dependencyHash = payloadHashOf(dependencyPayload);
        const result = await auth.authorize(sourceDeps, key, {
          actorSnapshotRef: session.serviceSession.resolutionActorSnapshotRef,
          commandType,
          commandVersion: QUERY_VERSION,
          commandPayloadHash: dependencyHash,
          authenticationContextHash: serviceSessionHash,
          targetRef: ref as unknown as Common.ObjectRef,
        });
        if (result.outcome !== 'ALLOW')
          entryError('AUTHORIZATION_REVOKED', 'usage dependency read denied');
        const checkInput = {
          decisionRef: result.authorizationDecisionRef,
          expectedCommandType: commandType,
          expectedCommandVersion: QUERY_VERSION,
          expectedCommandPayloadHash: dependencyHash,
          expectedAuthenticationContextHash: serviceSessionHash,
          expectedTargetRef: ref as unknown as Common.ObjectRef,
        };
        const proof = async () => {
          const validity = await auth.revalidate(sourceDeps, key, checkInput);
          if (!validity.valid) entryError('AUTHORIZATION_REVOKED', 'usage dependency read revoked');
        };
        await proof();
        checks.push({ key, input: checkInput });
        const context: TaskExecutionTransactionContext = {
          ...sourceContext,
          authorizationDecisionId: result.authorizationDecisionRef.objectId,
          authorizationDecisionHash: Buffer.from(
            result.authorizationDecisionRef.contentHash.digest,
            'hex',
          ),
          authorizationDecisionExpiresAt: new Date(result.expiresAt),
        };
        return { proof, context };
      };
      const revalidateAll = async () => {
        await revalidateHuman();
        await revalidateSource();
        if (checks.length === 0) return;
        const batch = await auth.revalidateBatch(sourceDeps, checks);
        if (!batch.valid) entryError('AUTHORIZATION_REVOKED', 'usage dependency read revoked');
      };
      const runtimeService = (proof: { proof: () => Promise<void> }) =>
        new ControlledRuntimeDispatchService(
          config.integrationGatewayDb,
          config.runtimeDriver,
          config.receiptStorage,
          {
            now,
            revalidateAuthorization: proof.proof,
            readDispatchBinding: () => Promise.reject(new Error('unused')),
            readBundle: () => Promise.reject(new Error('unused')),
            authorizeReceipt: () => Promise.reject(new Error('unused')),
          },
        );

      return handleGetUsageAndProvenance(config.taskExecutionDb, sourceContext, runRef, {
        now,
        revalidateAuthorization: revalidateAll,
        readContract: async (workOrderRef) => {
          const proof = await mint(
            'usageProvenanceContractReadV1',
            'execution.get_work_order_contract',
            workOrderRef,
            { workOrderRef },
          );
          return handleGetWorkOrderContract(
            config.taskExecutionDb,
            proof.context,
            workOrderRef,
            proof.proof,
          );
        },
        readBinding: async (attemptRef) => {
          const proof = await mint(
            'usageProvenanceBindingReadV1',
            'integration.get_runtime_attempt_binding',
            attemptRef,
            { attemptRef },
          );
          return runtimeService(proof).getUsageRuntimeBinding(
            proof.context,
            attemptRef as unknown as Common.ObjectRef,
          ) as unknown as Promise<CanonicalJsonObject>;
        },
        readRuntimeAdapterIdentity: async (attemptRef) => {
          const proof = await mint(
            'usageProvenanceAdapterIdentityReadV1',
            ADAPTER_IDENTITY_OPERATION,
            attemptRef,
            { attemptRef },
          );
          return runtimeService(proof).getUsageRuntimeAdapterIdentity(
            proof.context,
            attemptRef as unknown as Common.ObjectRef,
          );
        },
        readFinal: async (attemptRef) => {
          const proof = await mint(
            'usageProvenanceFinalReadV1',
            'integration.get_runtime_final_observation',
            attemptRef,
            { attemptRef },
          );
          try {
            return await runtimeService(proof).getUsageFinalObservation(
              proof.context,
              attemptRef as unknown as Common.ObjectRef,
            );
          } catch (error) {
            if (
              error !== null &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'INTEGRATION_RUNTIME_FINAL_NOT_FOUND'
            )
              return undefined;
            throw error;
          }
        },
      });
    },
  };
}
