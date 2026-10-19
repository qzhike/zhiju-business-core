import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from 'pg';
import {
  PreparationError,
  samePreparationValue,
  companyObjectTarget,
  type Common,
  type PreparationSession,
  type PreparationEntrySelection,
  type AnyPreparationPresetPayload,
  type PreparationProjectScope,
  type PreparationAnalysisRuntimePort,
  type LocalAnalysisSource,
} from '@zhiju/contracts';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  createPreparationIdentityDatabase,
  createIdentityPolicyDatabase,
  createPreparationIdentityPort,
  createPreparationProjectAuthorizationPort,
  revalidateOriginalPreparationAnalysis,
  resolveVerifiedHuman,
  withIdentityTransaction,
  IdentityPolicyRepository,
  PREPARATION_ANALYSIS_CREATOR_BINDINGS,
  PREPARATION_SERVICE_BINDINGS,
  PREPARATION_ANALYSIS_SERVICE_BINDINGS,
  PREPARATION_SERVICE_V2_BINDINGS,
  type IdentityCryptoPorts,
  type IdentityCommandDeps,
  type IdentityTransactionContext,
  type VerifiedHumanResolution,
  type PreparationProjectAuthorizationConfig,
} from '@zhiju/identity-policy';
import {
  createEnterpriseProjectDatabase,
  createPreparationProjectService,
  createPreparationAnalysisBasisService,
  type PreparationAnalysisBasisConfig,
} from '@zhiju/enterprise-project';
import {
  createCustomerZipIntakeService,
  createCustomerZipPolicyRegistry,
  createCustomerZipTicketCodec,
  createCustomerZipS3ObjectStore,
  type CustomerZipPolicyArtifact,
  type CustomerZipObjectStore,
  type CustomerZipS3Configuration,
} from '@zhiju/integration-gateway';
import {
  createTaskExecutionDatabase,
  createPreparationAnalysisService,
  type PreparationSourceObservation,
} from '@zhiju/task-execution';
import type { WorkspaceVerifiedAccess } from '../workspace/controller.js';
import type { createCompanyRuleComposition } from './company-rule-entry.js';
import type { PreparationWorkspaceServices } from './preparation-workspace-entry.js';
export interface PreparationCompositionConfig {
  readonly identityPool: Pool;
  readonly enterprisePool: Pool;
  readonly integrationPool: Pool;
  readonly crypto: IdentityCryptoPorts;
  readonly grantAdministrators: readonly string[];
  readonly administratorPolicySnapshotRef: Common.SnapshotRef;
  readonly serviceSession: () => Promise<PreparationSession>;
  readonly verifyServiceSession?: (session: PreparationSession) => Promise<void>;
  readonly servicePrincipalIds: readonly string[];
  readonly enterpriseCapabilities: { readonly select: string; readonly create: string };
  readonly capabilityCodes: Readonly<Record<string, string>>;
  readonly selection: PreparationEntrySelection;
  readonly cursorKey: Buffer;
  readonly ticket: { readonly activeKeyId: string; readonly keys: ReadonlyMap<string, Uint8Array> };
  readonly policies: readonly CustomerZipPolicyArtifact[];
  readonly companyRules: ReturnType<typeof createCompanyRuleComposition>;
  readonly analysisBasis?: Pick<PreparationAnalysisBasisConfig, 'sources' | 'validateDefinition'>;
  /** The existing trusted OIDC bootstrap dependencies; never a browser field. */
  readonly identityResolutionDeps: (access: WorkspaceVerifiedAccess) => IdentityCommandDeps;
  readonly objectStore?: CustomerZipObjectStore;
  readonly s3?: CustomerZipS3Configuration;
  readonly analysisAudience?: Common.ObjectRef;
  readonly executionError?: (error: unknown) => void;
  readonly analysisRuntime?: PreparationAnalysisRuntimePort;
  readonly taskPort?: Parameters<typeof createPreparationProjectService>[0]['taskPort'];
  readonly clock?: () => Date;
}
const PLATFORM = '00000000-0000-7000-8000-000000000000';
function fail(code: string): never {
  throw new PreparationError(code);
}
/** Actual owning assembly, with no publication, enrollment or grant side effects. */
export function createPreparationComposition(config: PreparationCompositionConfig) {
  const now = config.clock ?? (() => new Date()),
    identityDb = createIdentityPolicyDatabase(config.identityPool),
    preparationDb = createPreparationIdentityDatabase(config.identityPool),
    enterpriseDb = createEnterpriseProjectDatabase(config.enterprisePool),
    repo = new IdentityPolicyRepository(config.crypto);
  const active = new AsyncLocalStorage<{
    access: WorkspaceVerifiedAccess;
    human: VerifiedHumanResolution;
  }>();
  if (
    config.servicePrincipalIds.length !== 1 ||
    !config.cursorKey.length ||
    (!config.objectStore && !config.s3)
  )
    fail('PREPARATION_CONFIGURATION_INVALID');
  function context(
    session: PreparationSession,
    scope: PreparationProjectScope | { enterpriseId: string; projectId?: string },
  ): IdentityTransactionContext {
    return {
      kind: 'REQUEST',
      principalId: session.principalId,
      actorSnapshotId: newUuidV7(),
      authorizationDecisionId: newUuidV7(),
      authorizationDecisionHash: Buffer.from(session.authenticationContextHash.digest, 'hex'),
      authorizationDecisionExpiresAt: new Date(session.expiresAt),
      enterpriseId: scope.enterpriseId,
      allowedProjectIds: scope.projectId ? [scope.projectId] : [],
      correlationId: newUuidV7(),
    };
  }
  function deps(
    session: PreparationSession,
    scope: PreparationProjectScope | { enterpriseId: string; projectId?: string },
  ): IdentityCommandDeps {
    return { db: identityDb, repo, crypto: config.crypto, context: context(session, scope) };
  }
  async function verifySession(session: PreparationSession): Promise<void> {
    if (Date.parse(session.expiresAt) <= now().getTime()) fail('SESSION_EXPIRED');
    if (config.servicePrincipalIds.includes(session.principalId)) {
      if (config.verifyServiceSession) await config.verifyServiceSession(session);
      else {
        const supplied = await config.serviceSession();
        if (
          !samePreparationValue(supplied, session) ||
          !config.servicePrincipalIds.includes(supplied.principalId)
        )
          fail('AUTHORIZATION_DENIED');
      }
      const d = deps(session, { enterpriseId: PLATFORM });
      const principal = await withIdentityTransaction(d.db, d.context, (trx) =>
        repo.getPrincipalById(trx, session.principalId),
      );
      if (principal?.status !== 'ACTIVE' || principal.principal_kind !== 'SERVICE')
        fail('AUTHORIZATION_DENIED');
      return;
    }
    const bound = active.getStore();
    if (!bound || bound.access.context.expiresAt <= now()) fail('AUTHENTICATION_REQUIRED');
    const current = await resolveVerifiedHuman(
      config.identityResolutionDeps(bound.access),
      bound.access.context,
    );
    if (
      current.principalKind !== 'HUMAN' ||
      current.principalRef.objectId !== bound.human.principalRef.objectId ||
      current.principalRef.objectId !== session.principalId ||
      current.authenticationContextHash.toString('hex') !==
        session.authenticationContextHash.digest ||
      session.expiresAt !== bound.access.context.expiresAt.toISOString()
    )
      fail('AUTHORIZATION_DENIED');
  }
  async function serviceSession() {
    const session = await config.serviceSession();
    await verifySession(session);
    return session;
  }
  const projectAuthorizationConfig: PreparationProjectAuthorizationConfig = {
    verifySession,
    deps: (session, scope) => Promise.resolve(deps(session, scope)),
    capabilityCodes: config.capabilityCodes,
    servicePrincipalIds: config.servicePrincipalIds,
    preparationServiceAuthorization: (session, input) =>
      identity.authorizeServiceBootstrap(session, {
        operation: input.purpose,
        target: input.targetRef,
        payloadHash: input.payloadHash,
      }),
    clock: now,
  };
  const projectAuthorization = createPreparationProjectAuthorizationPort(
    projectAuthorizationConfig,
  );
  function purpose(operation: string, service: boolean): string {
    const row = (
      service
        ? [
            ...PREPARATION_SERVICE_BINDINGS,
            ...PREPARATION_SERVICE_V2_BINDINGS,
            ...PREPARATION_ANALYSIS_SERVICE_BINDINGS,
          ]
        : PREPARATION_ANALYSIS_CREATOR_BINDINGS
    ).find((row) => row[0] === operation || row[1] === operation);
    return row?.[1] ?? fail('AUTHORIZATION_DECISION_INVALID');
  }
  function projectScope(target: Common.ObjectRef): PreparationProjectScope {
    if (!target.scope.enterpriseId || !target.scope.projectId) fail('SCOPE_MISMATCH');
    return { enterpriseId: target.scope.enterpriseId, projectId: target.scope.projectId };
  }
  const identity = createPreparationIdentityPort({
    db: preparationDb,
    grantAdministrators: config.grantAdministrators,
    administratorPolicySnapshotRef: config.administratorPolicySnapshotRef,
    servicePrincipalIds: config.servicePrincipalIds,
    enterpriseCapabilities: config.enterpriseCapabilities,
    verifySession,
    verifyProjectCreation: (input) => project.verifyProjectCreation(input),
    authorizeService: async (session, input) => {
      await projectAuthorization.authorize(session, {
        purpose: purpose(input.operation, true),
        scopeRef: projectScope(input.target),
        targetRef: input.target,
        payloadHash: input.payloadHash,
      });
    },
    authorizeCurrentOperation: (session, operation, target, payloadHash) =>
      projectAuthorization.authorizeProof(session, {
        purpose: purpose(operation, config.servicePrincipalIds.includes(session.principalId)),
        scopeRef: projectScope(target),
        targetRef: target,
        payloadHash,
      }),
    clock: now,
  });
  const analysisBasis = config.analysisBasis
    ? createPreparationAnalysisBasisService({
        ...config.analysisBasis,
        db: enterpriseDb,
        authorize: (session, op, target, payload) =>
          identity.authorizeOperation(session, op, target, payload),
        check: (proof, op, target, payload) => identity.checkOperation(proof, op, target, payload),
        clock: now,
      })
    : undefined;
  const policyResolver = createCustomerZipPolicyRegistry(config.policies);
  async function dependencies(_session: PreparationSession, preset: AnyPreparationPresetPayload) {
    const service = await serviceSession();
    const template = await identity.readMembershipTemplate(service, {
      templateRef: preset.memberPolicyTemplate.ref,
      templateHash: preset.memberPolicyTemplate.payloadHash,
    });
    if (template.useStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
    policyResolver.resolve(
      preset.intakePolicy.ref as unknown as Record<string, unknown>,
      preset.intakePolicy.payloadHash,
    );
    if (preset.profile === 'ep.preparation_entry@1.1') {
      if (!analysisBasis) fail('PREPARATION_ANALYSIS_CAPABILITY_UNAVAILABLE');
      const resolved = await analysisBasis.resolve(service, preset.analysisBasis);
      if (resolved.useStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
      return {
        templateRefs: resolved.payload.templateBindings.map((binding) => binding.templateRef),
        requirementRefs: [],
        sourceWatermarks: resolved.sourceWatermarks,
      };
    }
    const request = preset.companyRules,
      target = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        request.publicationRef.objectId,
      ),
      proof = await config.companyRules.authorization.authorize(
        service,
        'identity.company_rule.read',
        target,
        request,
      ),
      resolved = await config.companyRules.identity.resolve(proof, request);
    if (resolved.currentUseStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
    const bundle = resolved.snapshots.bundle.payload.policyDocument as unknown as {
      templateBindings: { templateRef: Common.ContentAddressedRef }[];
      requirementBindings: { requirementRef: Common.ContentAddressedRef }[];
    };
    return {
      templateRefs: bundle.templateBindings.map((binding) => binding.templateRef),
      requirementRefs: bundle.requirementBindings.map((binding) => binding.requirementRef),
      sourceWatermarks: resolved.sourceWatermarks,
    };
  }
  const objectStore =
    config.objectStore ??
    createCustomerZipS3ObjectStore(config.s3 ?? fail('PREPARATION_CONFIGURATION_INVALID'));
  const execution = config.analysisRuntime
    ? createPreparationAnalysisService({
        db: createTaskExecutionDatabase(config.enterprisePool),
        runtime: config.analysisRuntime,
        ...(config.executionError ? { onError: config.executionError } : {}),
        authorize: (s, op, target, payload) => identity.authorizeOperation(s, op, target, payload),
        check: (p, op, target, payload) => identity.checkOperation(p, op, target, payload),
        serviceSession,
        source: async (s, sourceRef) => {
          const source = await project.analysisSourceBinding(s, sourceRef);
          if (!analysisBasis) fail('PREPARATION_ANALYSIS_CAPABILITY_UNAVAILABLE');
          const resolved = await analysisBasis.resolve(s, source.preset.analysisBasis);
          if (resolved.useStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
          return {
            preparationSourceRef: sourceRef,
            payload: source.payload as unknown as PreparationSourceObservation['payload'],
            basis: resolved.payload,
            analysisProfileRef: source.preset.analysisHandoff.analysisProfileRef,
            expectedReportProfileRef: source.preset.analysisHandoff.expectedReportProfileRef,
          };
        },
        materialize: async (s, source) => {
          const current = await project.analysisSourceBinding(s, source.preparationSourceRef);
          if (!samePreparationValue(current.payload, source.payload) || !config.analysisBasis)
            fail('PREPARATION_SOURCE_BINDING_INVALID');
          const manifest = current.submission.manifest as unknown as {
            entries: {
              sourceRef?: Common.ContentAddressedRef;
              originalName: string;
              mediaType: string;
              status: string;
            }[];
          };
          const hashBytes = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
          const inputs: LocalAnalysisSource[] = [];
          for (const item of source.payload.sources) {
            const entry = manifest.entries.find((e) =>
              samePreparationValue(e.sourceRef, item.sourceRef),
            );
            if (item.role !== 'CUSTOMER_NOTE' && entry?.status !== 'ANALYZABLE') continue;
            const bytes = await objectStore.read(item.objectRef);
            if (bytes.length !== item.byteLength || hashBytes(bytes) !== item.bytesSha256)
              fail('PREPARATION_SOURCE_BINDING_INVALID');
            inputs.push({
              sourceId: item.sourceRef.objectId,
              sourceRef: item.sourceRef,
              role: 'CUSTOMER_MATERIAL',
              displayName: entry?.originalName ?? '顾问提交说明',
              format:
                entry?.mediaType ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  ? 'docx'
                  : 'md',
              sha256: item.bytesSha256,
              bytes,
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Recheck the owning profile at the execution boundary.
          if (!analysisBasis || current.preset.profile !== 'ep.preparation_entry@1.1')
            fail('PREPARATION_ANALYSIS_PROFILE_UNSUPPORTED');
          const templateBytes = await analysisBasis.materializeTemplates(
            s,
            current.preset.analysisBasis,
          );
          for (const template of source.basis.templateBindings) {
            const bytes = templateBytes.get(template.templateCode);
            if (!bytes) fail('PREPARATION_SOURCE_BINDING_INVALID');
            if (hashBytes(bytes) !== template.sourceBytesSha256)
              fail('PREPARATION_SOURCE_BINDING_INVALID');
            inputs.push({
              sourceId: template.templateRef.objectId,
              sourceRef: template.templateRef,
              role: 'TEMPLATE',
              displayName: template.templateCode + '.md',
              format: 'md',
              sha256: hashBytes(bytes),
              bytes,
            });
          }
          if (source.basis.instructionBindings.length !== 1)
            fail('PREPARATION_ANALYSIS_PROFILE_UNSUPPORTED');
          const instruction = source.basis.instructionBindings[0];
          if (!instruction) fail('PREPARATION_ANALYSIS_PROFILE_UNSUPPORTED');
          const bytes = await config.analysisBasis.sources.readInstruction(instruction.bytesSha256);
          if (
            hashBytes(bytes) !== instruction.bytesSha256 ||
            bytes.length !== instruction.byteLength
          )
            fail('PREPARATION_SOURCE_BINDING_INVALID');
          return { instructions: { sha256: instruction.bytesSha256, bytes }, sources: inputs };
        },
        onAccepted: async (s, command) => {
          await project.acceptPreparationReport(s, command);
        },
        clock: now,
      })
    : undefined;
  const project = createPreparationProjectService({
    db: enterpriseDb,
    identity,
    verifySession,
    authorize: (session, operation, target, payload, human) =>
      identity.authorizeOperation(session, operation, target, payload, human),
    check: (proof, operation, target, payload) =>
      identity.checkOperation(proof, operation, target, payload),
    selection: config.selection,
    cursorKey: config.cursorKey,
    validateDependencies: dependencies,
    serviceSession,
    readSubmission: async (session, input) => {
      if (!('kind' in input.manifestRef) || input.manifestRef.kind !== 'SNAPSHOT')
        fail('INTEGRATION_REPORT_BINDING_INVALID');
      const result = await integration.readSubmission(session, {
        ...input,
        manifestRef: input.manifestRef,
      });
      if (!result.manifest || !Array.isArray(result.manifest.entries))
        fail('INTEGRATION_REPORT_BINDING_INVALID');
      return {
        ...result,
        manifest: result.manifest as unknown as { entries: { status: string }[] },
      };
    },
    readSourceAdmission: (service, input) => integration.readSourceAdmission(service, input),
    checkOriginalAnalysis: (service, input) =>
      revalidateOriginalPreparationAnalysis(projectAuthorizationConfig, service, input),
    ...(config.analysisAudience ? { analysisAudience: config.analysisAudience } : {}),
    ...(execution
      ? {
          taskPort: execution,
          analysisResult: execution.getResult,
          executionProgress: execution.progress,
        }
      : config.taskPort
        ? { taskPort: config.taskPort }
        : {}),
    clock: now,
  });
  const integration = createCustomerZipIntakeService({
    pool: config.integrationPool,
    verifySession,
    authorize: async (session, input) => {
      if (!config.servicePrincipalIds.includes(session.principalId))
        return projectAuthorization.authorize(session, {
          purpose: input.purpose,
          scopeRef: input.scopeRef,
          targetRef: input.targetRef,
          payloadHash: input.payloadHash,
        });
      const proof = await identity.authorizeServiceBootstrap(session, {
        operation: input.purpose,
        target: input.targetRef,
        payloadHash: input.payloadHash,
      });
      return {
        kind: 'REQUEST' as const,
        principalId: session.principalId,
        actorSnapshotId: proof.actorSnapshotRef.objectId,
        authorizationDecisionId: proof.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          proof.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(proof.context.authorizationDecisionExpiresAt),
        enterpriseId: input.scopeRef.enterpriseId,
        allowedProjectIds: [input.scopeRef.projectId],
        correlationId: input.correlationId,
      };
    },
    policyResolver,
    ticketCodec: createCustomerZipTicketCodec(config.ticket),
    objectStore,
    owners: {
      resolvePreparation: async (human, input) =>
        project.intakeBinding(await serviceSession(), human, input),
      acceptSource: async (human, input) => {
        const result = await project.acceptSource(await serviceSession(), human, input);
        if (
          !('kind' in result.sourceRef) ||
          result.sourceRef.kind !== 'CONTENT_ADDRESSED' ||
          !('kind' in result.validationRef) ||
          result.validationRef.kind !== 'CONTENT_ADDRESSED'
        )
          fail('INTEGRATION_SOURCE_RECEIPT_INVALID');
        return { ...result, sourceRef: result.sourceRef, validationRef: result.validationRef };
      },
      sourceLinks: async (_human, intakeRef) =>
        project.sourceLinks(await serviceSession(), intakeRef),
      acceptHandoff: async (input) => project.acceptHandoff(await serviceSession(), input),
      queryHandoff: (human, intakeRef) => project.queryHandoff(human, intakeRef),
    },
    clock: now,
  });
  const run: PreparationWorkspaceServices['run'] = async (access, human, action) =>
    active.run({ access, human }, async () => {
      const session: PreparationSession = {
        principalId: human.principalRef.objectId,
        authenticationContextHash: {
          algorithm: 'SHA-256',
          canonicalizationVersion: '1',
          digest: human.authenticationContextHash.toString('hex'),
        },
        expiresAt: access.context.expiresAt.toISOString(),
      };
      await verifySession(session);
      return action(session);
    });
  return {
    analysisBasis,
    execution,
    close: async () => {
      await execution?.close();
    },
    project,
    integration,
    run,
    identity,
    projectAuthorization,
    verifySession,
    serviceSession,
    policyResolver,
  };
}
