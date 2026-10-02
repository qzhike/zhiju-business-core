import type { createBlockedInputRecoveryEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  EnterpriseBusinessRepository,
  handleAcceptSourceMaterial,
  handleRegisterSourceMaterial,
  withEnterpriseProjectTransaction,
} from '@zhiju/enterprise-project';
import { assignRole, BLOCKED_INPUT_RECOVERY_BINDINGS } from '@zhiju/identity-policy';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import { digestCanonicalPayload } from '@zhiju/task-execution';
import { expect } from 'vitest';
import {
  contentHash,
  CORRELATION,
  definedValue,
  objectRef,
  OPERATOR,
  OPERATOR_ACTOR,
  PAST,
  POLICY_SNAPSHOT_ID,
  type Principal,
  record,
  REQUEST_DECISION,
  WORK_ORDER_V11,
} from './initial-context-fixtures.js';
import type {
  ScenarioRecoveryEnvelope,
  ScenarioRecoveryVariant,
} from './initial-context-scenario-types.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export interface PrepareRecoveryAuthoritiesContext {
  readonly bounded: boolean;
  readonly operator: InitialContextSuite['operator'];
  service: Principal;
  readonly exerciseRecoveryFaultMatrix: boolean;
  readonly prepareIndependentGrants: InitialContextSuite['prepareIndependentGrants'];
  readonly formal: boolean;
  readonly recoveryVariant: ScenarioRecoveryVariant;
  readonly grant: InitialContextSuite['grant'];
  readonly recoveryCodes: Record<string, string>;
  readonly recoveryGrants: Map<string, string>;
  admin: InitialContextSuite['admin'];
  fixture: InitialContextSuite['fixture'];
  readonly identityDeps: InitialContextSuite['identityDeps'];
  readonly otherChildId: string | undefined;
  otherDraftChildId: string | undefined;
  readonly createWorkOrder: InitialContextSuite['createWorkOrder'];
  readonly taskId: string;
  readonly draft: Record<string, unknown>;
  readonly expiresAt: string;
  readonly recoveryEntryRaw: ReturnType<typeof createBlockedInputRecoveryEntry>;
  readonly recoveryEnvelope: ScenarioRecoveryEnvelope;
  readonly revised: Record<string, unknown>;
  readonly sessionFor: InitialContextSuite['sessionFor'];
  readonly scope: InitialContextSuite['scope'];
  readonly runnerContext: InitialContextSuite['runnerContext'];
  clock: InitialContextSuite['clock'];
  enterpriseProjectDb: InitialContextSuite['enterpriseProjectDb'];
  recoverySource: Common.ContentAddressedRef | undefined;
  readonly committedPayload: InitialContextSuite['committedPayload'];
  readonly registry: InitialContextSuite['registry'];
  recoveryProposeEnvelope: Record<string, unknown> | undefined;
  readonly recoveryEntry: ReturnType<typeof createBlockedInputRecoveryEntry>;
  candidateMaterial: Common.VersionedRef | undefined;
}

export async function prepareRecoveryAuthorities(
  scenarioState: PrepareRecoveryAuthoritiesContext,
): Promise<boolean> {
  if (scenarioState.bounded) {
    const grantEntries = BLOCKED_INPUT_RECOVERY_BINDINGS.flatMap((b) =>
      (b.expectedPrincipalKind === 'HUMAN'
        ? [scenarioState.operator()]
        : b.expectedPrincipalKind === 'SERVICE'
          ? [scenarioState.service]
          : b.capabilityConfigKey.startsWith('recovery.')
            ? scenarioState.exerciseRecoveryFaultMatrix &&
              b.capabilityConfigKey === 'recovery.request_resolve.human.v1'
              ? [scenarioState.operator(), scenarioState.service]
              : /^recovery\.(?:answer_submit|request_resolve|retry_schedule)\./u.test(
                    b.capabilityConfigKey,
                  )
                ? [scenarioState.operator()]
                : [scenarioState.service]
            : [scenarioState.operator(), scenarioState.service]
      ).map((principal) => ({ b, principal })),
    );
    await scenarioState.prepareIndependentGrants(grantEntries, async ({ b, principal }) => {
      if (
        !scenarioState.formal &&
        scenarioState.recoveryVariant === 'NORMAL' &&
        b.capabilityConfigKey === 'informationRequestResolveV1'
      )
        return;
      const targetObjectType = definedValue(b.targetObjectTypes[0]);
      const id = await scenarioState.grant({
        principal,
        capabilityCode: definedValue(scenarioState.recoveryCodes[b.capabilityConfigKey]),
        action: b.requiredGrantAction,
        ...(!scenarioState.formal &&
        scenarioState.recoveryVariant === 'NORMAL' &&
        b.capabilityConfigKey === 'informationAnswerSubmitV1'
          ? { actions: [b.requiredGrantAction, 'execution.information_request.resolve.v1'] }
          : {}),
        selectorType: b.selectorType,
        targetObjectType,
        targetObjectTypes: b.targetObjectTypes,
      });
      scenarioState.recoveryGrants.set(
        `${principal.principalId}:${b.capabilityConfigKey}:${targetObjectType}`,
        id,
      );
      if (
        !scenarioState.formal &&
        scenarioState.recoveryVariant === 'NORMAL' &&
        b.capabilityConfigKey === 'informationAnswerSubmitV1'
      )
        scenarioState.recoveryGrants.set(
          `${principal.principalId}:informationRequestResolveV1:${targetObjectType}`,
          id,
        );
    });
    if (
      (
        await scenarioState.admin.query(
          "SELECT id FROM identity_policy.role_assignment WHERE principal_id=$1 AND project_id=$2 AND role_code='project.customer_material.confirmer' AND status='ACTIVE'",
          [OPERATOR, scenarioState.fixture.projectId],
        )
      ).rows.length === 0
    ) {
      expect(
        await assignRole(scenarioState.identityDeps([scenarioState.fixture.projectId]), {
          assignmentId: newUuidV7(),
          principalId: OPERATOR,
          roleCode: 'project.customer_material.confirmer',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
          },
          validFrom: PAST,
          justification: 'Bounded recovery Human fixture',
          idempotencyKey: newUuidV7(),
        }),
      ).toMatchObject({ status: 'COMMITTED' });
    }
    if (scenarioState.otherChildId) {
      scenarioState.otherDraftChildId = await scenarioState.createWorkOrder({
        taskId: scenarioState.taskId,
        taskMajor: '2.0',
        customDraft: structuredClone(scenarioState.draft),
        expiresAt: scenarioState.expiresAt,
      });
      const state = await scenarioState.recoveryEntryRaw.read(
        await scenarioState.recoveryEnvelope(
          'taskStateReadV1',
          scenarioState.revised.taskRef as Common.ObjectRef,
          { taskRef: scenarioState.revised.taskRef } as CanonicalJsonObject,
          scenarioState.service,
          undefined,
          true,
        ),
        scenarioState.sessionFor(scenarioState.service),
      );
      expect(record(state).workOrderRefs).toHaveLength(3);
      expect(record(state).workOrderRefs).toContainEqual(
        objectRef(WORK_ORDER_V11, scenarioState.otherDraftChildId, scenarioState.scope()),
      );
    }
    const sourceId = newUuidV7(),
      epContext = {
        ...scenarioState.runnerContext(),
        authorizationPurposes: [
          'enterprise.project.register_source_material',
          'enterprise.project.accept_source_material',
        ],
      };
    const epEnv = (
      type: string,
      payload: CanonicalJsonObject,
      targetType: string,
      targetId: string,
      expectedAggregateVersion?: string,
    ) => ({
      commandId: newUuidV7(),
      commandType: type,
      commandVersion: '1.0',
      idempotencyScope: `wi231:${type}`,
      idempotencyKey: newUuidV7(),
      requestPayload: payload,
      payload,
      enterpriseId: scenarioState.fixture.enterpriseId,
      projectId: scenarioState.fixture.projectId,
      targetType,
      targetId,
      expectedAggregateVersion,
      correlationId: CORRELATION,
      principalId: OPERATOR,
      principalKind: 'HUMAN' as const,
      actorSnapshotId: OPERATOR_ACTOR,
      authorizationDecisionId: REQUEST_DECISION,
      policySnapshotId: POLICY_SNAPSHOT_ID,
    });
    const descriptor = {
      originRef: {
        system: 'synthetic',
        resourceType: 'document',
        externalId: newUuidV7(),
        tenantOrAccountRef: objectRef('FeishuTenant', newUuidV7(), {
          enterpriseId: scenarioState.fixture.enterpriseId,
        }),
        observedAt: new Date(scenarioState.clock).toISOString(),
      },
      submittedBy: objectRef('Principal', OPERATOR, {
        enterpriseId: scenarioState.fixture.enterpriseId,
      }),
      receivedAt: new Date(scenarioState.clock).toISOString(),
      originalName: 'recovery.pdf',
      mediaType: 'application/pdf',
      byteLength: 12,
      checksum: contentHash('a'.repeat(64)),
      stagedObjectRef: `staging/${sourceId}`,
      retentionClass: 'CUSTOMER_RECORD',
    };
    const registered = await handleRegisterSourceMaterial(
      scenarioState.enterpriseProjectDb,
      epContext,
      epEnv(
        'project.register_source_material',
        {
          projectRef: objectRef('Project', scenarioState.fixture.projectId, scenarioState.scope()),
          descriptor,
        } as unknown as CanonicalJsonObject,
        'SourceMaterial',
        sourceId,
      ) as unknown as Parameters<typeof handleRegisterSourceMaterial>[2],
    );
    scenarioState.recoverySource = {
      ...record(record(scenarioState.committedPayload(registered)).sourceMaterialRef),
      objectType: 'zhiju.project.source_material',
    } as unknown as Common.ContentAddressedRef;
    const refs: Common.ContentAddressedRef[] = [];
    const repo = new EnterpriseBusinessRepository();
    for (const validationKind of ['SECURITY', 'INTEGRITY'] as const) {
      const validationId = newUuidV7(),
        payload = {
          enterpriseId: scenarioState.fixture.enterpriseId,
          projectId: scenarioState.fixture.projectId,
          sourceMaterialId: scenarioState.recoverySource.objectId,
          validationKind,
          outcome: 'PASSED',
          validatedObjectRef: `accepted/${sourceId}`,
          validatedContentHash: 'a'.repeat(64),
          validatedByteLength: 12,
          validatorId: 'synthetic-validator',
          validatorVersion: '1.0',
        };
      const digest = digestCanonicalPayload(payload);
      await withEnterpriseProjectTransaction(
        scenarioState.enterpriseProjectDb,
        epContext,
        async (trx) => {
          await repo.insertSourceMaterialValidation(trx, {
            validationId,
            sourceMaterialId: definedValue(scenarioState.recoverySource).objectId,
            enterpriseId: scenarioState.fixture.enterpriseId,
            projectId: scenarioState.fixture.projectId,
            validationKind,
            outcome: 'PASSED',
            validatedObjectRef: `accepted/${sourceId}`,
            validatedContentHash: Buffer.from('a'.repeat(64), 'hex'),
            validatedByteLength: 12,
            validatorId: 'synthetic-validator',
            validatorVersion: '1.0',
            payload,
            payloadHash: digest.hash,
            recordedByPrincipalId: OPERATOR,
            recordedByActorSnapshotId: OPERATOR_ACTOR,
            authorizationDecisionId: REQUEST_DECISION,
            sourceCommandId: newUuidV7(),
          });
        },
      );
      refs.push({
        kind: 'CONTENT_ADDRESSED',
        objectType: 'ValidationResult',
        objectId: validationId,
        scope: scenarioState.scope(),
        contentHash: contentHash(digest.hash.toString('hex')),
      });
    }
    expect(
      await handleAcceptSourceMaterial(
        scenarioState.enterpriseProjectDb,
        epContext,
        epEnv(
          'project.accept_source_material',
          {
            securityValidationRefs: [definedValue(refs[0])],
            integrityValidationRef: definedValue(refs[1]),
            acceptedObjectRef: `accepted/${sourceId}`,
            acceptedAt: new Date(scenarioState.clock).toISOString(),
          } as unknown as CanonicalJsonObject,
          'SourceMaterial',
          scenarioState.recoverySource.objectId,
          '1',
        ) as unknown as Parameters<typeof handleAcceptSourceMaterial>[2],
      ),
    ).toMatchObject({ status: 'COMMITTED' });
    const evidence = { evidence: scenarioState.recoverySource, relation: 'SUPPORTS' },
      propose = await scenarioState.recoveryEnvelope(
        'customerMaterialProposeV1',
        objectRef(
          'zhiju.project.customer_material',
          newUuidV7(),
          scenarioState.scope(),
        ) as Common.ObjectRef,
        {
          projectRef: objectRef(
            'zhiju.project.project',
            scenarioState.fixture.projectId,
            scenarioState.scope(),
          ),
          proposal: {
            materialType: 'quality.procedure',
            title: 'Recovery input',
            language: 'zh-CN',
            completeness: 'PARTIAL',
            sourceSelections: [
              {
                sourceMaterialRef: scenarioState.recoverySource,
                role: 'primary',
                locator: 'section.1',
              },
            ],
            classificationRationale: {
              reasonCode: 'SOURCE_CLASSIFICATION',
              summary: 'Classify accepted source.',
              evidenceRefs: [evidence],
            },
          },
        } as unknown as CanonicalJsonObject,
        scenarioState.operator(),
      );
    const proposalValidation = scenarioState.registry.validateOperation(
      'project.propose_customer_material',
      '1.0',
      propose,
    );
    expect(proposalValidation.valid, JSON.stringify(proposalValidation.errors)).toBe(true);
    scenarioState.recoveryProposeEnvelope = propose;
    const proposed = await scenarioState.recoveryEntry.command(propose, scenarioState.sessionFor());
    expect(proposed).toMatchObject({ status: 'COMMITTED' });
    scenarioState.candidateMaterial = record(scenarioState.committedPayload(proposed))
      .customerMaterialRef as Common.VersionedRef;
  }
  return false;
}
