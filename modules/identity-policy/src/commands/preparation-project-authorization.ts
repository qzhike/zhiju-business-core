import {
  PreparationError,
  preparationHash,
  assertPreparationClosed,
  assertPreparationHash,
  assertPreparationProjectScope,
  samePreparationValue,
  type Common,
  type PreparationSession,
  type PreparationProjectScope,
  type PreparationAuthorizationProof,
} from '@zhiju/contracts';
import { createActorSnapshot, type IdentityCommandDeps } from './actor-snapshot.js';
import {
  issueEntryDecision,
  revalidateEntryDecision,
  type AuthorizationEntryBinding,
  type WorkOrderValidationAuthorizationConfig,
} from './work-order-validation-authorization.js';
import {
  withIdentityTransaction,
  type IdentityTransactionContext,
} from '../persistence/identity-db.js';
import {
  authorizationDecisionIntegrityHolds,
  policySnapshotIntegrityHolds,
} from '../persistence/identity-policy-repository.js';
import { PREPARATION_CREATOR_BINDINGS } from './preparation-identity.js';
export interface PreparationProjectAuthorizationInput {
  purpose: string;
  scopeRef: PreparationProjectScope;
  targetRef: Common.ObjectRef;
  payloadHash: Common.ContentHash;
}
export interface PreparationProjectAuthorizationConfig {
  verifySession(session: PreparationSession): Promise<void>;
  deps(session: PreparationSession, scope: PreparationProjectScope): Promise<IdentityCommandDeps>;
  capabilityCodes: Readonly<Record<string, string>>;
  servicePrincipalIds?: readonly string[];
  preparationServiceAuthorization?(
    session: PreparationSession,
    input: PreparationProjectAuthorizationInput,
  ): Promise<PreparationAuthorizationProof>;
  clock?: () => Date;
}
/** Closed preparation SERVICE steps; these do not grant creator or Runner authority. */
export const PREPARATION_SERVICE_BINDINGS = [
  [
    'project.register_source_material',
    'project.source_material.register',
    'project.register_source_material.v1',
    'SourceMaterial',
  ],
  [
    'project.accept_source_material',
    'project.source_material.accept',
    'project.accept_source_material.v1',
    'SourceMaterial',
  ],
  [
    'project.get_project_board_slice',
    'enterprise.project.get_project_board_slice',
    'project.get_project_board_slice.v1',
    'Project',
  ],
  [
    'identity.preparation.original_analysis.read',
    'identity.preparation.original_analysis.read',
    'identity.preparation.original_analysis.read',
    'zhiju.integration.customer_zip_intake',
  ],
  [
    'identity.preparation.admission.read',
    'identity.preparation.admission.read',
    'identity.preparation.admission.read',
    'zhiju.project.preparation_request',
  ],
  [
    'identity.preparation.membership.materialize',
    'identity.preparation.membership.materialize',
    'identity.preparation.membership.materialize',
    'zhiju.project.project',
  ],
  [
    'identity.preparation.membership.read',
    'identity.preparation.membership.read',
    'identity.preparation.membership.read',
    'zhiju.project.project',
  ],
  [
    'identity.preparation.creator_access.provision',
    'identity.preparation.creator_access.provision',
    'identity.preparation.creator_access.provision',
    'zhiju.project.project',
  ],
  [
    'project.preparation.intake_binding.read',
    'project.preparation.intake_binding.read',
    'project.preparation.intake_binding.read',
    'zhiju.project.preparation_request',
  ],
  [
    'project.preparation.creation.read',
    'project.preparation.creation.read',
    'project.preparation.creation.read',
    'zhiju.project.preparation_request',
  ],
  [
    'project.preparation.handoff.read',
    'project.preparation.handoff.read',
    'project.preparation.handoff.read',
    'zhiju.integration.customer_zip_intake',
  ],
  [
    'project.preparation.handoff.continue',
    'project.preparation.handoff.continue',
    'project.preparation.handoff.continue',
    'zhiju.integration.customer_zip_intake',
  ],
  [
    'project.capture_preparation_source',
    'project.preparation.source.capture',
    'project.capture_preparation_source.v1',
    'zhiju.project.project',
  ],
  [
    'project.get_preparation_source',
    'project.preparation.source.read',
    'project.get_preparation_source.v1',
    'zhiju.project.preparation_source',
  ],
  [
    'integration.customer_zip.submission.read',
    'integration.customer_zip.submission.read',
    'integration.customer_zip.submission.read',
    'zhiju.integration.customer_zip_intake',
  ],
] as const;
/** Explicit v2 source authorization; v1 action grants do not grant the new major. */
export const PREPARATION_SERVICE_V2_BINDINGS = [
  [
    'project.capture_preparation_source',
    'project.preparation.source_v2.capture',
    'project.capture_preparation_source.v2',
    'zhiju.project.project',
  ],
  [
    'project.get_preparation_source',
    'project.preparation.source_v2.read',
    'project.get_preparation_source.v2',
    'zhiju.project.preparation_source',
  ],
] as const;
export function createPreparationProjectAuthorizationPort(
  config: PreparationProjectAuthorizationConfig,
) {
  const now = config.clock ?? (() => new Date());
  function binding(
    input: PreparationProjectAuthorizationInput,
    service: boolean,
  ): AuthorizationEntryBinding {
    assertPreparationClosed(input, ['purpose', 'scopeRef', 'targetRef', 'payloadHash']);
    assertPreparationHash(input.payloadHash);
    assertPreparationProjectScope(input.scopeRef);
    const sourceV2 = service && PREPARATION_SERVICE_V2_BINDINGS.some((x) => x[1] === input.purpose);
    const row = (
      service
        ? sourceV2
          ? PREPARATION_SERVICE_V2_BINDINGS
          : PREPARATION_SERVICE_BINDINGS
        : PREPARATION_CREATOR_BINDINGS
    ).find((x) => x[1] === input.purpose);
    const requestLookup =
      !service &&
      input.purpose === 'integration.customer_zip.read' &&
      input.targetRef.objectType === 'zhiju.project.preparation_request';
    if (
      !row ||
      !samePreparationValue(input.targetRef.scope, input.scopeRef) ||
      (!requestLookup && input.targetRef.objectType !== row[3]) ||
      (input.targetRef as { kind: unknown }).kind !== 'OBJECT' ||
      !config.capabilityCodes[sourceV2 ? row[0] + '@2.0' : row[0]]
    )
      throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
    return {
      commandType: row[0],
      commandVersion: sourceV2 ? '2.0' : '1.0',
      authorizationPurpose: row[1],
      requiredGrantAction: row[2],
      targetKind: 'OBJECT',
      targetObjectTypes: requestLookup ? ['zhiju.project.preparation_request'] : [row[3]],
      selectorType: [
        'integration.request_customer_zip_intake',
        'project.register_source_material',
      ].includes(row[0])
        ? 'CREATE_TARGET_TYPE'
        : 'TARGET_TYPE',
      capabilityConfigKey: sourceV2 ? row[0] + '@2.0' : row[0],
      expectedPrincipalKind: service ? 'SERVICE' : 'HUMAN',
      ...(service && ['SourceMaterial', 'Project'].includes(row[3])
        ? { allowNativeTargetSelector: true }
        : {}),
      ...(service ? { allowedServicePrincipalIds: config.servicePrincipalIds ?? [] } : {}),
      forbidActingFor: true,
    };
  }
  const gateConfig = {
    capabilityCodes: config.capabilityCodes,
  } as unknown as WorkOrderValidationAuthorizationConfig;
  const port = {
    async authorize(
      session: PreparationSession,
      input: PreparationProjectAuthorizationInput,
    ): Promise<IdentityTransactionContext> {
      const service = (config.servicePrincipalIds ?? []).includes(session.principalId);
      const b = binding(input, service);
      await config.verifySession(session);
      const deps = await config.deps(session, input.scopeRef);
      if (
        deps.context.principalId !== session.principalId ||
        deps.context.enterpriseId !== input.scopeRef.enterpriseId ||
        deps.context.allowedProjectIds.length !== 1 ||
        deps.context.allowedProjectIds[0] !== input.scopeRef.projectId ||
        Date.parse(session.expiresAt) <= now().getTime()
      )
        throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
      const auth = Buffer.from(session.authenticationContextHash.digest, 'hex');
      const actor = await createActorSnapshot(deps, {
        actorSnapshotId: deps.context.actorSnapshotId,
        principalId: session.principalId,
        declaredPrincipalKind: service ? 'SERVICE' : 'HUMAN',
        authenticationContextHash: auth,
        scopeKind: 'PROJECT',
        enterpriseId: input.scopeRef.enterpriseId,
        projectId: input.scopeRef.projectId,
      });
      const decision = await issueEntryDecision(
        gateConfig,
        now,
        undefined,
        deps,
        {
          actorSnapshotRef: actor,
          commandType: b.commandType,
          commandVersion: b.commandVersion,
          commandPayloadHash: Buffer.from(input.payloadHash.digest, 'hex'),
          authenticationContextHash: auth,
        },
        input.targetRef,
        b,
      );
      if (decision.outcome !== 'ALLOW')
        throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
      await config.verifySession(session);
      return {
        ...deps.context,
        actorSnapshotId: actor.snapshotId,
        authorizationDecisionId: decision.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          decision.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(
          Math.min(Date.parse(decision.expiresAt), Date.parse(session.expiresAt)),
        ),
      };
    },
    async authorizeProof(
      session: PreparationSession,
      input: PreparationProjectAuthorizationInput,
    ): Promise<PreparationAuthorizationProof> {
      const context = await port.authorize(session, input);
      const deps = await config.deps(session, input.scopeRef);
      return withIdentityTransaction(deps.db, context, async (trx) => {
        const d = await trx
          .selectFrom('identity_policy.authorization_decision')
          .selectAll()
          .where('authorization_decision_id', '=', context.authorizationDecisionId)
          .executeTakeFirst();
        const a = await trx
          .selectFrom('identity_policy.actor_snapshot')
          .selectAll()
          .where('actor_snapshot_id', '=', context.actorSnapshotId)
          .executeTakeFirst();
        if (!d || !a || (a.principal_kind !== 'HUMAN' && a.principal_kind !== 'SERVICE'))
          throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
        return {
          session,
          context: {
            principalKind: a.principal_kind,
            policySnapshotId: d.policy_snapshot_id,
            authorizationDecisionExpiresAt: context.authorizationDecisionExpiresAt.toISOString(),
          },
          actorSnapshotRef: {
            kind: 'SNAPSHOT',
            objectType: 'identity.actor_snapshot',
            objectId: a.actor_snapshot_id,
            snapshotId: a.actor_snapshot_id,
            scope: input.scopeRef,
            contentHash: {
              algorithm: 'SHA-256',
              digest: a.payload_hash.toString('hex'),
              canonicalizationVersion: '1',
            },
          },
          authorizationDecisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: d.authorization_decision_id,
            scope: input.scopeRef,
            contentHash: {
              algorithm: 'SHA-256',
              digest: d.payload_hash.toString('hex'),
              canonicalizationVersion: '1',
            },
          },
        };
      });
    },
    async check(
      session: PreparationSession,
      input: PreparationProjectAuthorizationInput,
      context: IdentityTransactionContext,
    ): Promise<void> {
      const service = (config.servicePrincipalIds ?? []).includes(session.principalId);
      const b = binding(input, service);
      await config.verifySession(session);
      if (
        context.principalId !== session.principalId ||
        context.enterpriseId !== input.scopeRef.enterpriseId ||
        context.allowedProjectIds.length !== 1 ||
        context.allowedProjectIds[0] !== input.scopeRef.projectId ||
        context.authorizationDecisionExpiresAt <= now()
      )
        throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
      const deps = await config.deps(session, input.scopeRef);
      const d = await revalidateEntryDecision(
        gateConfig,
        now,
        undefined,
        { ...deps, context },
        {
          decisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'identity.authorization_decision',
            objectId: context.authorizationDecisionId,
            scope: input.scopeRef,
            contentHash: {
              algorithm: 'SHA-256',
              digest: context.authorizationDecisionHash.toString('hex'),
              canonicalizationVersion: '1',
            },
          },
          expectedCommandType: b.commandType,
          expectedCommandVersion: b.commandVersion,
          expectedCommandPayloadHash: Buffer.from(input.payloadHash.digest, 'hex'),
          expectedAuthenticationContextHash: Buffer.from(
            session.authenticationContextHash.digest,
            'hex',
          ),
        },
        input.targetRef,
        b,
      );
      if (!d.valid) throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
    },
  };
  return port;
}

/** Revalidates a retained Human intent without manufacturing a live Human session. */
export async function revalidateOriginalPreparationAnalysis(
  config: PreparationProjectAuthorizationConfig,
  service: PreparationSession,
  input: {
    creatorId: string;
    projectRef: Common.ObjectRef;
    intakeRef: Common.ObjectRef;
    submissionPayloadHash: Common.ContentHash;
  },
): Promise<void> {
  assertPreparationClosed(input, ['creatorId', 'projectRef', 'intakeRef', 'submissionPayloadHash']);
  assertPreparationProjectScope(input.projectRef.scope);
  assertPreparationHash(input.submissionPayloadHash);
  const scope = input.projectRef.scope;
  if (
    !samePreparationValue(input.intakeRef.scope, scope) ||
    input.projectRef.objectId !== scope.projectId ||
    input.projectRef.objectType !== 'zhiju.project.project' ||
    input.intakeRef.objectType !== 'zhiju.integration.customer_zip_intake' ||
    !(config.servicePrincipalIds ?? []).includes(service.principalId)
  )
    throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
  const gate = createPreparationProjectAuthorizationPort(config);
  const serviceInput: PreparationProjectAuthorizationInput = {
    purpose: 'identity.preparation.original_analysis.read',
    scopeRef: scope,
    targetRef: input.intakeRef,
    payloadHash: preparationHash(input),
  };
  const deps = await config.deps(service, scope),
    now = config.clock ?? (() => new Date());
  const proof = config.preparationServiceAuthorization
    ? await config.preparationServiceAuthorization(service, serviceInput)
    : undefined;
  const context: IdentityTransactionContext = proof
    ? {
        ...deps.context,
        actorSnapshotId: proof.actorSnapshotRef.snapshotId,
        authorizationDecisionId: proof.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          proof.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(proof.context.authorizationDecisionExpiresAt),
      }
    : await gate.authorize(service, serviceInput);
  await withIdentityTransaction(deps.db, context, async (trx) => {
    const p = await deps.repo.getPrincipalById(trx, input.creatorId);
    if (p?.principal_kind !== 'HUMAN' || p.status !== 'ACTIVE')
      throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
    const link = await trx
      .selectFrom('identity_policy.external_identity_link')
      .select('id')
      .where('principal_id', '=', input.creatorId)
      .where('status', '=', 'ACTIVE')
      .executeTakeFirst();
    if (!link) throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
    const histories = await trx
      .selectFrom('identity_policy.authorization_decision')
      .selectAll()
      .where('principal_id', '=', input.creatorId)
      .where('principal_kind', '=', 'HUMAN')
      .where('purpose', '=', 'project.preparation.analysis.admit')
      .where('outcome', '=', 'ALLOW')
      .where('enterprise_id', '=', scope.enterpriseId)
      .where('project_id', '=', scope.projectId)
      .where('command_payload_hash', '=', Buffer.from(input.submissionPayloadHash.digest, 'hex'))
      .where('target_object_id', '=', input.intakeRef.objectId)
      .execute();
    let historical = false;
    for (const d of histories) {
      if (!authorizationDecisionIntegrityHolds(d)) continue;
      const a = await deps.repo.getActorSnapshotByIdAndHash(
        trx,
        d.actor_snapshot_id,
        d.actor_snapshot_payload_hash,
      );
      if (
        a?.hashMatched &&
        a.row.principal_id === input.creatorId &&
        a.row.principal_kind === 'HUMAN' &&
        a.row.acting_for_principal_id === null
      ) {
        historical = true;
        break;
      }
    }
    if (!historical) throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
    const analysisCapability = config.capabilityCodes['project.preparation.analysis.admit'];
    if (!analysisCapability) throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
    const grants = await deps.repo.listActiveCapabilityGrants(
      trx,
      input.creatorId,
      scope.enterpriseId,
      now(),
      analysisCapability,
    );
    let current = false;
    for (const g of grants) {
      if (
        g.capability_code !== analysisCapability ||
        g.scope_kind !== 'PROJECT' ||
        g.project_id !== scope.projectId ||
        !g.actions.includes('project.preparation.analysis.admit.v1') ||
        g.max_uses !== null ||
        !samePreparationValue(g.constraints, {}) ||
        !samePreparationValue(g.resource_selectors, [
          { selectorType: 'TARGET_TYPE', objectType: input.intakeRef.objectType },
        ])
      )
        continue;
      const policy = await deps.repo.getPolicySnapshotById(trx, g.grant_policy_snapshot_id);
      if (
        policy &&
        policySnapshotIntegrityHolds(policy) &&
        policy.payload_hash.equals(g.grant_policy_snapshot_hash) &&
        policy.effective_from <= now() &&
        (!policy.superseded_at || policy.superseded_at > now())
      ) {
        current = true;
        break;
      }
    }
    if (!current) throw new PreparationError('AUTHORIZATION_DECISION_INVALID');
  });
  if (config.preparationServiceAuthorization)
    await config.preparationServiceAuthorization(service, serviceInput);
  else await gate.check(service, serviceInput, context);
}
