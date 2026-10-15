import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql, type Kysely } from 'kysely';
import { canonicalize, newUuidV7, isUuidV7, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { assertPreparationCommand, assertPreparationHash, type Common } from '@zhiju/contracts';
import type { PreparationSession, WorkspaceCommandInput } from '@zhiju/contracts';
import type {
  PreparationIdentityPort,
  PreparationAuthorizationProof,
  PreparationAdmissionResult,
  PreparationMemberPolicyResult,
} from '@zhiju/contracts';
import type {
  PreparationPresetPayload,
  PreparationEntrySelection,
  PreparationRequestPayload,
  PreparationStep,
  PreparationRequestSteps,
} from '@zhiju/contracts';
import {
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
  type EnterpriseProjectTransactionContext,
} from '../persistence/enterprise-db.js';
import { EnterpriseBusinessRepository } from '../persistence/enterprise-business-repository.js';

import {
  preparationTaskOperationsRegistered,
  assertRegisteredPreparationTaskResult,
  assertRegisteredPreparationTaskCommand,
  assertPreparationTaskReadback,
  type PreparationTaskPort,
  type PreparationTaskCommand,
  type PreparationAnalysisCommand,
  type PreparationTaskResult,
} from './preparation-task-port.js';
const PLATFORM = '00000000-0000-7000-8000-000000000000';
type Ref = Common.TypedReference;
interface Scope {
  enterpriseId: string;
  projectId: string;
}
interface Fact {
  id: string;
  kind: string;
  identity_key: string;
  payload: unknown;
  payload_hash: Buffer;
  recorded_at: Date;
}
export class PreparationProjectError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PreparationProjectError';
  }
}
function runtimeToken(value: unknown): string {
  if (typeof value !== 'string') fail('PREPARATION_PAYLOAD_INVALID');
  return value;
}
function requiredProjectId(scope: Common.ScopeRef): string {
  if (!scope.projectId) fail('PREPARATION_SCOPE_INVALID');
  return scope.projectId;
}
function fail(code: string): never {
  throw new PreparationProjectError(code);
}
const hash = (v: unknown): Common.ContentHash => ({
  algorithm: 'SHA-256',
  digest: createHash('sha256')
    .update(canonicalize(v as CanonicalJsonValue))
    .digest('hex'),
  canonicalizationVersion: '1',
});
const equal = isDeepStrictEqual;
const object = (type: string, id: string, scope: Common.ScopeRef): Common.ObjectRef => ({
  kind: 'OBJECT',
  objectType: type,
  objectId: id,
  scope,
});
const content = (
  type: string,
  id: string,
  scope: Common.ScopeRef,
  payload: unknown,
): Common.ContentAddressedRef => ({
  kind: 'CONTENT_ADDRESSED',
  objectType: type,
  objectId: id,
  scope,
  contentHash: hash(payload),
});
const closed = (value: unknown, keys: string[]) => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in value))
  )
    fail('PREPARATION_PAYLOAD_INVALID');
};
const text = (v: unknown) => {
  if (typeof v !== 'string' || !v.trim() || Buffer.byteLength(v) > 512)
    fail('PREPARATION_PAYLOAD_INVALID');
};
const step = (
  status: PreparationStep['status'] = 'NOT_STARTED',
  refs: Ref[] = [],
  receiptRefs: Ref[] = [],
  reasonCodes: string[] = [],
): PreparationStep => ({ status, refs, receiptRefs, reasonCodes });
export interface PreparationBoundSubmission {
  intakeRef: Common.ObjectRef;
  projectRef: Common.ObjectRef;
  preparationRequestRef: Common.ObjectRef;
  originalPreparationKey: string;
  originalSubmissionKey: string;
  submissionPayloadHash: Common.ContentHash;
  manifestRef: Common.TypedReference;
  sourceRefs: Common.TypedReference[];
  receiptRefs: readonly Common.TypedReference[];
  creatorId: string;
  manifest: { entries: { status: string }[] };
  noteSourceRef?: Common.TypedReference;
}
export interface PreparationSourceAcceptInput {
  intakeRef: Common.ObjectRef;
  submissionPayloadHash: Common.ContentHash;
  sourceId: string;
  validationId: string;
  registerCommandId: string;
  validateCommandId: string;
  acceptCommandId: string;
  kind: 'ZIP' | 'ENTRY' | 'NOTE';
  ordinal?: number;
  originalName: string;
  mediaType: string;
  bytesSha256: Common.ContentHash;
  byteLength: number;
  objectRef: { key: string; sha256: string; byteLength: number };
  scopeRef: Scope;
  creatorId: string;
  validation: { safety: 'PASS'; integrity: 'PASS'; analyzable: boolean };
}
export interface PreparationProjectConfig {
  db: Kysely<EnterpriseProjectDb>;
  identity: PreparationIdentityPort;
  verifySession(session: PreparationSession): Promise<void>;
  authorize(
    session: PreparationSession,
    operation: string,
    target: Common.ObjectRef,
    payload: unknown,
    human?: PreparationSession,
  ): Promise<PreparationAuthorizationProof>;
  check(
    proof: PreparationAuthorizationProof,
    operation: string,
    target: Common.ObjectRef,
    payload: unknown,
  ): Promise<void>;
  selection: PreparationEntrySelection;
  cursorKey: Buffer;
  validateDependencies(
    session: PreparationSession,
    payload: PreparationPresetPayload,
  ): Promise<{
    templateRefs: Common.ContentAddressedRef[];
    requirementRefs: Common.ContentAddressedRef[];
    sourceWatermarks: unknown;
  }>;
  /** Explicit, verified owning adapters. Each adapter must preserve these fixed IDs and keys. */
  createEnterprise?(
    session: PreparationSession,
    input: {
      admissionRef: Common.ContentAddressedRef;
      enterpriseId: string;
      displayCode: string;
      displayName: string;
      commandId: string;
      idempotencyKey: string;
    },
  ): Promise<{ enterpriseRef: Common.ObjectRef; receiptRef: Common.ObjectRef }>;
  serviceSession?: PreparationSession | (() => Promise<PreparationSession>);
  analysisAudience?: Common.ObjectRef;
  readSubmission?(
    serviceSession: PreparationSession,
    input: {
      intakeRef: Common.ObjectRef;
      manifestRef: Ref;
      submissionPayloadHash: Common.ContentHash;
    },
  ): Promise<PreparationBoundSubmission>;
  readSourceAdmission?(
    service: PreparationSession,
    input: {
      intakeRef: Common.ObjectRef;
      submissionPayloadHash: Common.ContentHash;
      sourceId: string;
    },
  ): Promise<{
    sourceInput: PreparationSourceAcceptInput;
    originalCommand: WorkspaceCommandInput<unknown>;
    creatorId: string;
    currentUsability: unknown;
    sourceWatermarks: readonly unknown[];
  }>;
  checkOriginalAnalysis?(
    service: PreparationSession,
    input: {
      creatorId: string;
      projectRef: Common.ObjectRef;
      intakeRef: Common.ObjectRef;
      submissionPayloadHash: Common.ContentHash;
    },
  ): Promise<void>;
  taskPort?: PreparationTaskPort;
  clock?: () => Date;
}
interface RequestFact {
  originalCommand: WorkspaceCommandInput<PreparationRequestPayload>;
  creatorId: string;
  selection: PreparationEntrySelection;
  admission: PreparationAdmissionResult;
  targets: {
    memberPolicyId: string;
    memberPolicyVersionId: string;
    enterpriseCommandId: string;
    projectCommandId: string;
    scopeClaimId: string;
    eventId: string;
  };
}
export function createPreparationProjectService(config: PreparationProjectConfig) {
  const now = config.clock ?? (() => new Date());
  const repo = new EnterpriseBusinessRepository();
  if (config.cursorKey.length < 32) fail('PREPARATION_CONFIGURATION_INVALID');
  async function currentService() {
    if (!config.serviceSession) fail('PREPARATION_SERVICE_UNAVAILABLE');
    const session =
      typeof config.serviceSession === 'function'
        ? await config.serviceSession()
        : config.serviceSession;
    await verified(session);
    return session;
  }
  const verified = async (s: PreparationSession) => {
    await config.verifySession(s);
    if (new Date(s.expiresAt) <= now()) fail('SESSION_EXPIRED');
  };
  const context = (
    p: PreparationAuthorizationProof,
    scope: Common.ScopeRef,
  ): EnterpriseProjectTransactionContext => ({
    kind: 'REQUEST',
    principalId: p.session.principalId,
    principalKind: p.context.principalKind,
    actorSnapshotId: p.actorSnapshotRef.objectId,
    authorizationDecisionId: p.authorizationDecisionRef.objectId,
    authorizationDecisionHash: Buffer.from(p.authorizationDecisionRef.contentHash.digest, 'hex'),
    authorizationDecisionExpiresAt: new Date(p.context.authorizationDecisionExpiresAt),
    policySnapshotId: p.context.policySnapshotId,
    enterpriseId: scope.enterpriseId ?? PLATFORM,
    allowedProjectIds: scope.projectId ? [scope.projectId] : [],
    correlationId: newUuidV7(),
  });
  async function transaction<T>(
    p: PreparationAuthorizationProof,
    scope: Common.ScopeRef,
    fn: (trx: Parameters<Parameters<typeof withEnterpriseProjectTransaction>[2]>[0]) => Promise<T>,
  ) {
    return withEnterpriseProjectTransaction(config.db, context(p, scope), fn);
  }
  async function technicalReceipt(
    trx: Parameters<Parameters<typeof withEnterpriseProjectTransaction>[2]>[0],
    p: PreparationAuthorizationProof,
    scope: Common.ScopeRef,
    input: {
      commandId: string;
      operation: string;
      key: string;
      target: Common.ObjectRef;
      payload: unknown;
      result: unknown;
      correlationId?: string;
    },
  ) {
    await trx
      .insertInto('enterprise_project.command_receipt')
      .values({
        command_id: input.commandId,
        command_type: input.operation,
        command_version: '1.0',
        idempotency_scope: scope.projectId ?? scope.enterpriseId ?? PLATFORM,
        idempotency_key: input.key,
        request_payload_hash: Buffer.from(hash(input.payload).digest, 'hex'),
        enterprise_id: scope.enterpriseId ?? PLATFORM,
        project_id: scope.projectId ?? null,
        target_type: input.target.objectType,
        target_id: input.target.objectId,
        outcome: 'COMMITTED',
        result_payload: JSON.stringify(input.result),
        result_payload_hash: Buffer.from(hash(input.result).digest, 'hex'),
        completed_at: now(),
        correlation_id: input.correlationId ?? input.commandId,
        created_by_principal_id: p.session.principalId,
        actor_snapshot_id: p.actorSnapshotRef.objectId,
        authorization_decision_id: p.authorizationDecisionRef.objectId,
      })
      .onConflict((oc) => oc.column('command_id').doNothing())
      .execute();
    const row = await trx
      .selectFrom('enterprise_project.command_receipt')
      .select(['command_type', 'request_payload_hash', 'result_payload_hash'])
      .where('command_id', '=', input.commandId)
      .executeTakeFirst();
    if (
      row?.command_type !== input.operation ||
      row.request_payload_hash.toString('hex') !== hash(input.payload).digest ||
      row.result_payload_hash?.toString('hex') !== hash(input.result).digest
    )
      fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
  }
  async function read(
    p: PreparationAuthorizationProof,
    scope: Common.ScopeRef,
    kind: string,
    key: string,
  ): Promise<Fact | undefined> {
    const row = await transaction(
      p,
      scope,
      async (trx) =>
        (
          await sql<Fact>`SELECT id,kind,identity_key,payload,payload_hash,recorded_at FROM enterprise_project.preparation_fact WHERE kind=${kind} AND identity_key=${key}`.execute(
            trx,
          )
        ).rows[0],
    );
    if (!row) return undefined;
    if (row.payload_hash.toString('hex') !== hash(row.payload).digest)
      fail('PREPARATION_PERSISTED_HASH_MISMATCH');
    return row;
  }
  async function append(
    p: PreparationAuthorizationProof,
    scope: Common.ScopeRef,
    kind: string,
    key: string,
    payload: unknown,
    id: string = newUuidV7(),
  ): Promise<Fact> {
    return transaction(p, scope, async (trx) => {
      await sql`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,project_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref) VALUES(${id},${kind},${scope.enterpriseId ?? PLATFORM},${scope.projectId ?? null},${p.session.principalId},${key},${JSON.stringify(payload)}::jsonb,${Buffer.from(hash(payload).digest, 'hex')},${JSON.stringify(p.actorSnapshotRef)}::jsonb,${JSON.stringify(p.authorizationDecisionRef)}::jsonb) ON CONFLICT(kind,identity_key) DO NOTHING`.execute(
        trx,
      );
      const row = (
        await sql<Fact>`SELECT id,kind,identity_key,payload,payload_hash,recorded_at FROM enterprise_project.preparation_fact WHERE kind=${kind} AND identity_key=${key}`.execute(
          trx,
        )
      ).rows[0];
      if (!row || !equal(row.payload, payload)) fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
      if (kind === 'REQUEST') {
        const request = payload as RequestFact;
        const c = request.originalCommand;
        await technicalReceipt(trx, p, scope, {
          commandId: c.commandId,
          operation: c.type,
          key: c.idempotencyKey,
          target: c.targetRef,
          payload: c.payload,
          result: {
            requestRef: c.targetRef,
            admissionRef: request.admission.admissionRef,
            scopeReservationRef: object(
              'zhiju.project.preparation_scope_reservation',
              row.id,
              scope,
            ),
          },
          correlationId: c.correlationId,
        });
      }
      if (kind === 'WITHDRAWAL') {
        await technicalReceipt(trx, p, scope, {
          commandId: row.id,
          operation: 'project.preparation.preset.withdraw',
          key: 'project.preparation.preset.withdraw:1.0:' + key,
          target: object('zhiju.project.preparation_preset_publication', key, {}),
          payload,
          result: {
            withdrawalRef: content(
              'zhiju.project.preparation_preset_withdrawal',
              row.id,
              {},
              payload,
            ),
          },
        });
      }
      return row;
    });
  }
  async function authorized(
    s: PreparationSession,
    op: string,
    target: Common.ObjectRef,
    payload: unknown,
    human?: PreparationSession,
  ) {
    await verified(s);
    return config.authorize(s, op, target, payload, human);
  }
  function assertPreset(p: PreparationPresetPayload) {
    closed(p, [
      'profile',
      'presetCode',
      'presetVersion',
      'creation',
      'memberPolicyTemplate',
      'intakePolicy',
      'companyRules',
      'analysisHandoff',
    ]);
    closed(p.creation, [
      'mode',
      'status',
      'enterpriseInitialStatus',
      'objective',
      'enterpriseCodePrefix',
      'projectCodePrefix',
    ]);
    if (
      runtimeToken(p.profile) !== 'ep.preparation_entry@1.0' ||
      runtimeToken(p.creation.mode) !== 'PREPARATION' ||
      runtimeToken(p.creation.status) !== 'PREPARING' ||
      runtimeToken(p.creation.enterpriseInitialStatus) !== 'ACTIVE' ||
      !/^zhiju\.[a-z0-9_.]+$/.test(p.presetCode) ||
      !/^\d+\.\d+\.\d+$/.test(p.presetVersion) ||
      ![p.creation.enterpriseCodePrefix, p.creation.projectCodePrefix].every((v) =>
        /^[A-Z0-9]{1,16}$/.test(v),
      )
    )
      fail('PREPARATION_PRESET_INVALID');
    text(p.creation.objective);
    closed(p.memberPolicyTemplate, ['ref', 'payloadHash']);
    closed(p.intakePolicy, ['ref', 'payloadHash']);
    closed(p.companyRules, ['ruleBundleRef', 'startupRulesRef', 'vocabularyRef', 'publicationRef']);
    closed(p.analysisHandoff, ['intent', 'analysisProfileRef', 'expectedReportProfileRef']);
    for (const entry of [p.memberPolicyTemplate, p.intakePolicy]) {
      assertPreparationHash(entry.payloadHash);
      if (
        runtimeToken(entry.ref.kind) !== 'VERSIONED' ||
        !isUuidV7(entry.ref.objectId) ||
        !isUuidV7(entry.ref.versionId) ||
        !equal(entry.ref.scope, {})
      )
        fail('PREPARATION_PRESET_INVALID');
    }
    for (const profile of [
      p.analysisHandoff.analysisProfileRef,
      p.analysisHandoff.expectedReportProfileRef,
    ]) {
      if (
        runtimeToken(profile.kind) !== 'VERSIONED' ||
        !isUuidV7(profile.objectId) ||
        !isUuidV7(profile.versionId) ||
        !equal(profile.scope, {})
      )
        fail('PREPARATION_PRESET_INVALID');
    }

    if (
      runtimeToken(p.analysisHandoff.intent) !== 'ANALYZE' ||
      p.memberPolicyTemplate.ref.objectType !== 'identity.policy' ||
      p.intakePolicy.ref.objectType !== 'zhiju.integration.customer_zip_policy'
    )
      fail('PREPARATION_PRESET_INVALID');
  }
  async function publishPreset(
    s: PreparationSession,
    input: {
      presetId: string;
      versionId: string;
      payload: PreparationPresetPayload;
      effectiveFrom: string;
      supersedesPublicationRef?: Common.ContentAddressedRef;
    },
  ) {
    assertPreset(input.payload);
    if (
      !isUuidV7(input.presetId) ||
      !isUuidV7(input.versionId) ||
      !Number.isFinite(Date.parse(input.effectiveFrom))
    )
      fail('PREPARATION_PRESET_INVALID');
    const target = object('zhiju.project.preparation_preset', input.presetId, {});
    const p = await authorized(s, 'project.preparation.preset.publish', target, input);
    await config.validateDependencies(s, input.payload);
    const ref: Common.VersionedRef = {
      kind: 'VERSIONED',
      objectType: target.objectType,
      objectId: input.presetId,
      versionId: input.versionId,
      scope: {},
    };
    const base = {
      preparationPresetRef: ref,
      preparationPresetHash: hash(input.payload),
      effectiveFrom: input.effectiveFrom,
      actorSnapshotRef: p.actorSnapshotRef,
      authorizationDecisionRef: p.authorizationDecisionRef,
      ...(input.supersedesPublicationRef
        ? { supersedesPublicationRef: input.supersedesPublicationRef }
        : {}),
    };
    if (input.supersedesPublicationRef) {
      const previous = await read(p, {}, 'PUBLICATION', input.supersedesPublicationRef.objectId);
      if (
        !previous ||
        !equal(
          content(
            'zhiju.project.preparation_preset_publication',
            previous.id,
            {},
            previous.payload,
          ),
          input.supersedesPublicationRef,
        )
      )
        fail('PREPARATION_PRESET_INVALID');
      const previousPayload = previous.payload as typeof base;
      const prev = await transaction(
        p,
        {},
        async (trx) =>
          (
            await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='PRESET' AND id=${previousPayload.preparationPresetRef.versionId}`.execute(
              trx,
            )
          ).rows[0],
      );
      if (
        !prev ||
        (prev.payload as PreparationPresetPayload).presetCode !== input.payload.presetCode
      )
        fail('PREPARATION_PRESET_INVALID');
      const successors = await transaction(
        p,
        {},
        async (trx) =>
          (
            await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='PUBLICATION' AND payload->'supersedesPublicationRef'->>'objectId'=${previous.id}`.execute(
              trx,
            )
          ).rows,
      );
      if (successors.length) fail('PREPARATION_SUPERSESSION_CONFLICT');
    }
    const publicationId = newUuidV7();
    await transaction(p, {}, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.payload.presetCode + ':' + input.payload.presetVersion},0))`.execute(
        trx,
      );
      if (input.supersedesPublicationRef) {
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.supersedesPublicationRef.objectId},0))`.execute(
          trx,
        );
        const successors = (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='PUBLICATION' AND payload->'supersedesPublicationRef'->>'objectId'=${input.supersedesPublicationRef.objectId}`.execute(
            trx,
          )
        ).rows;
        if (successors.length) fail('PREPARATION_SUPERSESSION_CONFLICT');
      }
      const existing = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='PRESET' AND identity_key=${input.payload.presetCode + ':' + input.payload.presetVersion}`.execute(
          trx,
        )
      ).rows[0];
      if (existing) fail('PREPARATION_PRESET_VERSION_EXISTS');
      for (const [id, kind, key, value] of [
        [
          input.versionId,
          'PRESET',
          input.payload.presetCode + ':' + input.payload.presetVersion,
          { ...input.payload },
        ],
        [publicationId, 'PUBLICATION', publicationId, base],
      ] as const) {
        await sql`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref) VALUES(${id},${kind},${PLATFORM},${s.principalId},${key},${JSON.stringify(value)}::jsonb,${Buffer.from(hash(value).digest, 'hex')},${JSON.stringify(p.actorSnapshotRef)}::jsonb,${JSON.stringify(p.authorizationDecisionRef)}::jsonb)`.execute(
          trx,
        );
      }
      await technicalReceipt(
        trx,
        p,
        {},
        {
          commandId: publicationId,
          operation: 'project.preparation.preset.publish',
          key: 'project.preparation.preset.publish:1.0:' + input.versionId,
          target,
          payload: input,
          result: {
            preparationPresetRef: ref,
            preparationPresetHash: hash(input.payload),
            publicationRef: content(
              'zhiju.project.preparation_preset_publication',
              publicationId,
              {},
              base,
            ),
          },
        },
      );
      await config.check(p, 'project.preparation.preset.publish', target, input);
    });
    return {
      preparationPresetRef: ref,
      preparationPresetHash: hash(input.payload),
      publicationRef: content(
        'zhiju.project.preparation_preset_publication',
        publicationId,
        {},
        base,
      ),
      receiptRef: object('CommandReceipt', publicationId, {}),
    };
  }
  async function resolvePreset(
    s: PreparationSession,
    selection: PreparationEntrySelection,
    options: { historical?: boolean } = {},
  ) {
    const target = object(
      'zhiju.project.preparation_preset',
      selection.preparationPresetRef.objectId,
      {},
    );
    const p = await authorized(s, 'project.preparation.preset.read', target, selection);
    return transaction(p, {}, async (trx) => {
      const preset = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='PRESET' AND id=${selection.preparationPresetRef.versionId}`.execute(
          trx,
        )
      ).rows[0];
      const publication = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='PUBLICATION' AND id=${selection.publicationRef.objectId}`.execute(
          trx,
        )
      ).rows[0];
      if (!preset || !publication) fail('PREPARATION_PRESET_NOT_FOUND');
      const payload = preset.payload as PreparationPresetPayload;
      assertPreset(payload);
      const pub = publication.payload as {
        preparationPresetRef: Common.VersionedRef;
        preparationPresetHash: Common.ContentHash;
        effectiveFrom: string;
      };
      if (
        !equal(hash(payload), selection.preparationPresetHash) ||
        !equal(pub.preparationPresetRef, selection.preparationPresetRef) ||
        !equal(pub.preparationPresetHash, selection.preparationPresetHash) ||
        !equal(
          content('zhiju.project.preparation_preset_publication', publication.id, {}, pub),
          selection.publicationRef,
        )
      )
        fail('PREPARATION_PRESET_HASH_MISMATCH');
      const changes = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE (kind='WITHDRAWAL' AND payload->'publicationRef'->>'objectId'=${publication.id}) OR (kind='PUBLICATION' AND payload->'supersedesPublicationRef'->>'objectId'=${publication.id})`.execute(
          trx,
        )
      ).rows;
      const effective = changes.filter(
        (x) => new Date((x.payload as { effectiveFrom: string }).effectiveFrom) <= now(),
      );
      const useStatus =
        new Date(pub.effectiveFrom) > now()
          ? 'NOT_YET_EFFECTIVE'
          : effective.some((x) => x.kind === 'WITHDRAWAL')
            ? 'WITHDRAWN'
            : effective.length
              ? 'SUPERSEDED'
              : 'USABLE';
      let dependencyState: 'USABLE' | 'UNUSABLE' | 'UNAVAILABLE' = 'USABLE';
      let dependencies: Awaited<ReturnType<PreparationProjectConfig['validateDependencies']>>;
      try {
        dependencies = await config.validateDependencies(s, payload);
      } catch (error) {
        if (!options.historical) throw error;
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        dependencyState = /UNUSABLE|WITHDRAWN|SUPERSEDED|NOT_YET_EFFECTIVE/.test(code)
          ? 'UNUSABLE'
          : 'UNAVAILABLE';
        dependencies = { templateRefs: [], requirementRefs: [], sourceWatermarks: [] };
      }

      await config.check(p, 'project.preparation.preset.read', target, selection);
      return {
        payload,
        publicationRef: selection.publicationRef,
        useStatus,
        dependencyState,
        checkedAt: now().toISOString(),
        sourceWatermarks: hash({
          publication: selection.publicationRef,
          changes: changes.map((x) => x.id),
          dependencies,
        }),
        dependencies,
      };
    });
  }
  async function withdrawPreset(
    s: PreparationSession,
    input: {
      publicationRef: Common.ContentAddressedRef;
      effectiveFrom: string;
      reasonCode: string;
    },
  ) {
    text(input.reasonCode);
    if (!Number.isFinite(Date.parse(input.effectiveFrom))) fail('PREPARATION_PAYLOAD_INVALID');
    const target = object(
      'zhiju.project.preparation_preset_publication',
      input.publicationRef.objectId,
      {},
    );
    const p = await authorized(s, 'project.preparation.preset.withdraw', target, input);
    const pub = await read(p, {}, 'PUBLICATION', target.objectId);
    if (!pub || !equal(content(target.objectType, pub.id, {}, pub.payload), input.publicationRef))
      fail('PREPARATION_PRESET_NOT_FOUND');
    const payload = {
      ...input,
      actorSnapshotRef: p.actorSnapshotRef,
      authorizationDecisionRef: p.authorizationDecisionRef,
    };
    const row = await append(p, {}, 'WITHDRAWAL', target.objectId, payload);
    await config.check(p, 'project.preparation.preset.withdraw', target, input);
    return content('zhiju.project.preparation_preset_withdrawal', row.id, {}, payload);
  }
  const binding = (selection: PreparationEntrySelection, preset: PreparationPresetPayload) => ({
    ...selection,
    intakePolicyRef: preset.intakePolicy.ref,
    intakePolicyHash: preset.intakePolicy.payloadHash,
  });
  async function findEnterprises(
    s: PreparationSession,
    input: { searchText: string; page: { limit: number; cursor?: string } },
  ) {
    if (
      typeof input.searchText !== 'string' ||
      Buffer.byteLength(input.searchText) > 512 ||
      !Number.isInteger(input.page.limit) ||
      input.page.limit < 1 ||
      input.page.limit > 50
    )
      fail('PREPARATION_PAYLOAD_INVALID');
    const selected = await resolvePreset(s, config.selection);
    if (selected.useStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
    const candidates = await config.identity.discover(s, {
      preparationPresetRef: config.selection.preparationPresetRef,
      preparationPresetHash: config.selection.preparationPresetHash,
    });
    const cursorBinding = {
      principalId: s.principalId,
      authenticationContextHash: s.authenticationContextHash,
      searchText: input.searchText,
      selection: config.selection,
      watermarks: candidates.sourceWatermarks,
    };
    let offset = 0;
    if (input.page.cursor) {
      const [body, mac] = input.page.cursor.split('.');
      if (!body || !mac) fail('PREPARATION_CURSOR_INVALID');
      const expected = createHmac('sha256', config.cursorKey).update(body).digest();
      const supplied = Buffer.from(mac, 'base64url');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
        fail('PREPARATION_CURSOR_INVALID');
      const decoded = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
        binding: unknown;
        offset: number;
      };
      if (
        !equal(decoded.binding, cursorBinding) ||
        !Number.isInteger(decoded.offset) ||
        decoded.offset < 0
      )
        fail('PREPARATION_CURSOR_INVALID');
      offset = decoded.offset;
    }
    const items: { enterpriseRef: Common.ObjectRef; displayName: string; displayCode: string }[] =
      [];
    const started = now().getTime();
    let scanned = 0;
    while (
      offset < candidates.enterpriseCandidates.length &&
      items.length < input.page.limit &&
      scanned < 200 &&
      now().getTime() - started < 5000
    ) {
      const ref = candidates.enterpriseCandidates[offset++];
      scanned++;
      if (!ref) continue;
      const p = await authorized(s, 'project.enterprise.select', ref, { enterpriseRef: ref });
      const row = await transaction(p, ref.scope, (trx) =>
        repo.getEnterpriseById(trx, ref.objectId),
      );
      await config.check(p, 'project.enterprise.select', ref, { enterpriseRef: ref });
      if (
        row?.status === 'ACTIVE' &&
        (row.display_name.toLocaleLowerCase().includes(input.searchText.toLocaleLowerCase()) ||
          row.display_code.toLocaleLowerCase().includes(input.searchText.toLocaleLowerCase()))
      )
        items.push({
          enterpriseRef: ref,
          displayName: row.display_name,
          displayCode: row.display_code,
        });
    }
    let nextCursor: string | undefined;
    if (offset < candidates.enterpriseCandidates.length) {
      const body = Buffer.from(JSON.stringify({ binding: cursorBinding, offset })).toString(
        'base64url',
      );
      nextCursor =
        body + '.' + createHmac('sha256', config.cursorKey).update(body).digest('base64url');
    }
    return {
      items,
      ...(nextCursor ? { nextCursor } : {}),
      snapshotAt: now().toISOString(),
      sourceWatermarks: [
        {
          sourceModule: 'zhiju.identity_policy',
          partition: s.principalId,
          sequence: Number.parseInt(candidates.sourceWatermarks.digest.slice(0, 12), 16),
          observedAt: selected.checkedAt,
        },
        {
          sourceModule: 'zhiju.enterprise_project',
          partition: hash({ selection: config.selection, searchText: input.searchText }).digest,
          sequence: Number.parseInt(hash(items).digest.slice(0, 12), 16),
          observedAt: now().toISOString(),
        },
      ],
      entryBinding: binding(config.selection, selected.payload),
      newCustomerAllowed: candidates.newCustomerAllowed,
    };
  }
  function validateCommand(command: WorkspaceCommandInput<unknown>) {
    assertPreparationCommand(
      command,
      'project.request_project_preparation',
      'zhiju.project.preparation_request',
      'CREATE',
    );
    const c = command as unknown as WorkspaceCommandInput<PreparationRequestPayload>;
    const p = c.payload;
    closed(p, ['customer', 'projectTitle', 'preparationPresetRef', 'preparationPresetHash']);
    if (p.customer.mode === 'NEW') {
      closed(p.customer, ['mode', 'displayName']);
      text(p.customer.displayName);
    } else if (runtimeToken(p.customer.mode) === 'EXISTING') {
      closed(p.customer, ['mode', 'enterpriseRef']);
      if (
        p.customer.enterpriseRef.objectId !== c.scopeRef.enterpriseId ||
        !equal(p.customer.enterpriseRef.scope, { enterpriseId: c.scopeRef.enterpriseId })
      )
        fail('PREPARATION_SCOPE_INVALID');
    } else fail('PREPARATION_PAYLOAD_INVALID');
    text(p.projectTitle);
    if (
      c.type !== 'project.request_project_preparation' ||
      runtimeToken(c.version) !== '1.0' ||
      runtimeToken(c.targetRef.kind) !== 'OBJECT' ||
      c.targetRef.objectType !== 'zhiju.project.preparation_request' ||
      !equal(c.scopeRef, c.targetRef.scope) ||
      !isUuidV7(c.targetRef.objectId) ||
      !isUuidV7(c.scopeRef.enterpriseId) ||
      !isUuidV7(c.scopeRef.projectId) ||
      c.idempotencyKey !== `project.request_project_preparation:1.0:${c.targetRef.objectId}` ||
      !equal(c.integrity.payloadHash, hash(p))
    )
      fail('PREPARATION_COMMAND_INVALID');
    return c;
  }
  async function requestProof(
    s: PreparationSession,
    request: RequestFact,
    operation = 'project.get_project_preparation_request',
  ) {
    const a =
      operation === 'project.get_project_preparation_request'
        ? await config.identity.lookupAdmission(s, {
            requestRef: request.originalCommand.targetRef,
            originalKey: request.originalCommand.idempotencyKey,
          })
        : await config.identity.revalidate(s, request.admission.admissionRef);
    if (
      request.creatorId !== s.principalId ||
      a.payload.requestRef.objectId !== request.originalCommand.targetRef.objectId
    )
      fail('PREPARATION_NOT_VISIBLE');
    return config.identity.authorizeBootstrap(s, {
      admissionRef: request.admission.admissionRef,
      operation,
      target: request.originalCommand.targetRef,
      payloadHash: hash(request.originalCommand.payload),
    });
  }
  async function loadRequest(
    s: PreparationSession,
    input: { requestRef: Common.ObjectRef; originalKey: string },
  ) {
    await verified(s);
    const admission = await config.identity.lookupAdmission(s, input);
    const p = await config.identity.authorizeBootstrap(s, {
      admissionRef: admission.admissionRef,
      operation: 'project.get_project_preparation_request',
      target: input.requestRef,
      payloadHash: admission.payload.payloadHash,
    });
    const row = await read(p, input.requestRef.scope, 'REQUEST', input.requestRef.objectId);
    if (!row) fail('PREPARATION_NOT_VISIBLE');
    const request = row.payload as RequestFact;
    if (
      request.creatorId !== s.principalId ||
      request.originalCommand.idempotencyKey !== input.originalKey ||
      !equal(request.originalCommand.targetRef, input.requestRef)
    )
      fail('PREPARATION_NOT_VISIBLE');
    await requestProof(s, request);
    return request;
  }
  async function readSteps(
    p: PreparationAuthorizationProof,
    r: RequestFact,
  ): Promise<PreparationRequestSteps> {
    const steps: PreparationRequestSteps = {
      ADMISSION: step('COMMITTED', [r.admission.admissionRef], [r.admission.receiptRef]),
      ENTERPRISE: step(),
      MEMBER_POLICY: step(),
      PROJECT: step(),
      CREATOR_ACCESS: step(),
    };
    for (const name of ['ENTERPRISE', 'MEMBER_POLICY', 'PROJECT', 'CREATOR_ACCESS'] as const) {
      const row = await read(
        p,
        r.originalCommand.scopeRef,
        'STEP',
        r.originalCommand.targetRef.objectId + ':' + name,
      );
      if (row) steps[name] = row.payload as PreparationStep;
    }
    return steps;
  }
  async function result(s: PreparationSession, r: RequestFact) {
    const p = await requestProof(s, r);
    const steps = await readSteps(p, r);
    const selected = await resolvePreset(
      config.serviceSession ? await currentService() : s,
      r.selection,
      { historical: true },
    );
    let access: {
      status: 'PENDING' | 'USABLE' | 'INCOMPLETE' | 'REVOKED';
      provisioningReceiptRef?: Common.ContentAddressedRef;
      checkedAt: string;
    } = { status: 'PENDING', checkedAt: now().toISOString() };
    if (steps.PROJECT.status === 'COMMITTED') {
      const current = await config.identity.currentCreatorAccess(s, r.admission.admissionRef);
      access = {
        status: current.access === 'COMPLETE' ? 'USABLE' : current.access,
        provisioningReceiptRef: current.provisioningReceiptRef,
        checkedAt: current.checkedAt,
      };
    }
    const disposition =
      selected.useStatus !== 'USABLE' || selected.dependencyState === 'UNUSABLE'
        ? 'STALE'
        : selected.dependencyState === 'UNAVAILABLE'
          ? 'UNKNOWN'
          : steps.PROJECT.status === 'COMMITTED' && access.status === 'USABLE'
            ? 'ACCEPTED'
            : Object.values(steps).some((x) => x.status === 'UNKNOWN')
              ? 'UNKNOWN'
              : 'PARTIAL';
    return {
      requestRef: r.originalCommand.targetRef,
      originalCommand: r.originalCommand,
      originalCommandId: r.originalCommand.commandId,
      originalKey: r.originalCommand.idempotencyKey,
      payloadHash: r.originalCommand.integrity.payloadHash,
      scopeRef: r.originalCommand.scopeRef,
      preparationPresetRef: r.selection.preparationPresetRef,
      preparationPresetHash: r.selection.preparationPresetHash,
      intakePolicyRef: selected.payload.intakePolicy.ref,
      intakePolicyHash: selected.payload.intakePolicy.payloadHash,
      disposition,
      steps,
      access,
      permittedActions:
        disposition === 'ACCEPTED'
          ? ['SUBMIT_ZIP']
          : disposition === 'PARTIAL'
            ? ['CONTINUE_ORIGINAL']
            : [],
      sourceWatermarks: [
        {
          sourceModule: 'zhiju.enterprise_project',
          partition: r.originalCommand.targetRef.objectId,
          sequence: Number.parseInt(hash({ steps, access }).digest.slice(0, 12), 16),
          observedAt: now().toISOString(),
        },
      ],
    };
  }
  async function createProject(
    s: PreparationSession,
    r: RequestFact,
    member: PreparationMemberPolicyResult,
    preset: PreparationPresetPayload,
  ) {
    const c = r.originalCommand;
    const scope = c.scopeRef;
    const projectRef = object('zhiju.project.project', scope.projectId, scope);
    const input = {
      enterpriseRef: object('zhiju.project.enterprise', scope.enterpriseId, {
        enterpriseId: scope.enterpriseId,
      }),
      displayCode: preset.creation.projectCodePrefix + '-' + scope.projectId,
      title: c.payload.projectTitle,
      objective: preset.creation.objective,
      memberPolicyRef: member.memberPolicyRef,
      memberPolicyHash: member.memberPolicyHash,
      preparationPresetRef: r.selection.preparationPresetRef,
      preparationPresetHash: r.selection.preparationPresetHash,
      preparationRequestRef: c.targetRef,
    };
    const proof = await config.identity.authorizeBootstrap(s, {
      admissionRef: r.admission.admissionRef,
      operation: 'project.create_preparing_project',
      target: projectRef,
      payloadHash: hash(input),
    });
    await config.identity.readMemberPolicy(s, {
      memberPolicyRef: member.memberPolicyRef,
      memberPolicyHash: member.memberPolicyHash,
    });
    return transaction(proof, scope, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${scope.projectId},0))`.execute(trx);
      const prior = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='STEP' AND identity_key=${c.targetRef.objectId + ':PROJECT'}`.execute(
          trx,
        )
      ).rows[0];
      if (prior) return prior.payload as PreparationStep;
      const enterprise = await repo.getEnterpriseById(trx, scope.enterpriseId);
      if (enterprise?.status !== 'ACTIVE') fail('PROJECT_ENTERPRISE_NOT_ACTIVE');
      await sql`INSERT INTO enterprise_project.project(project_id,enterprise_id,display_code,title,objective,status,creation_mode,member_policy_ref,member_policy_version_id,member_policy_payload_hash,created_by_principal_id,created_by_actor_snapshot_id,last_command_id) VALUES(${scope.projectId},${scope.enterpriseId},${input.displayCode},${input.title},${input.objective},'PREPARING','PREPARATION',${JSON.stringify(member.memberPolicyRef)}::jsonb,${member.memberPolicyRef.versionId},${Buffer.from(member.memberPolicyHash.digest, 'hex')},${s.principalId},${proof.actorSnapshotRef.objectId},${r.targets.projectCommandId})`.execute(
        trx,
      );
      const claim = {
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        scopeVersion: 1,
        status: 'ACTIVE',
        claimId: r.targets.scopeClaimId,
        claimedAt: now().toISOString(),
      };
      await repo.insertProjectScopeClaim(trx, {
        claimId: r.targets.scopeClaimId,
        ...scope,
        claimedByPrincipalId: s.principalId,
        claimedByActorSnapshotId: proof.actorSnapshotRef.objectId,
        authorizationDecisionId: proof.authorizationDecisionRef.objectId,
        payloadHash: Buffer.from(hash(claim).digest, 'hex'),
        payload: claim,
        sourceCommandId: r.targets.projectCommandId,
      });
      const receiptRef = object('CommandReceipt', r.targets.projectCommandId, scope);
      const claimRef = object('ProjectScopeClaim', r.targets.scopeClaimId, scope);
      const result = step('COMMITTED', [projectRef, claimRef], [receiptRef]);
      await trx
        .insertInto('enterprise_project.command_receipt')
        .values({
          command_id: r.targets.projectCommandId,
          command_type: 'project.create_preparing_project',
          command_version: '1.0',
          idempotency_scope: scope.projectId,
          idempotency_key: `${c.idempotencyKey}:PROJECT:${scope.projectId}`,
          request_payload_hash: Buffer.from(hash(input).digest, 'hex'),
          enterprise_id: scope.enterpriseId,
          project_id: scope.projectId,
          target_type: projectRef.objectType,
          target_id: scope.projectId,
          outcome: 'COMMITTED',
          result_payload: JSON.stringify({
            projectRef,
            projectScopeClaimRef: claimRef,
            aggregateVersion: 1,
            creationMode: 'PREPARATION',
            status: 'PREPARING',
            receiptRef,
          }),
          result_payload_hash: Buffer.from(
            hash({
              projectRef,
              projectScopeClaimRef: claimRef,
              aggregateVersion: 1,
              creationMode: 'PREPARATION',
              status: 'PREPARING',
              receiptRef,
            }).digest,
            'hex',
          ),
          completed_at: now(),
          correlation_id: c.correlationId,
          created_by_principal_id: s.principalId,
          actor_snapshot_id: proof.actorSnapshotRef.objectId,
          authorization_decision_id: proof.authorizationDecisionRef.objectId,
        })
        .execute();
      const event = {
        projectRef,
        enterpriseRef: object('zhiju.project.enterprise', scope.enterpriseId, {
          enterpriseId: scope.enterpriseId,
        }),
        creationMode: 'PREPARATION',
        createdAt: now().toISOString(),
      };
      await trx
        .insertInto('enterprise_project.outbox_event')
        .values({
          event_id: r.targets.eventId,
          event_type: 'project.PreparingProjectCreated',
          event_version: '1.0',
          aggregate_type: projectRef.objectType,
          aggregate_id: scope.projectId,
          aggregate_version: '1',
          enterprise_id: scope.enterpriseId,
          project_id: scope.projectId,
          correlation_id: c.correlationId,
          payload: JSON.stringify(event),
          payload_hash: Buffer.from(hash(event).digest, 'hex'),
          canonicalization_version: '1',
          occurred_at: now(),
          created_by_principal_id: s.principalId,
          source_command_id: r.targets.projectCommandId,
        })
        .execute();
      await sql`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,project_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref) VALUES(${newUuidV7()},'STEP',${scope.enterpriseId},${scope.projectId},${s.principalId},${c.targetRef.objectId + ':PROJECT'},${JSON.stringify(result)}::jsonb,${Buffer.from(hash(result).digest, 'hex')},${JSON.stringify(proof.actorSnapshotRef)}::jsonb,${JSON.stringify(proof.authorizationDecisionRef)}::jsonb)`.execute(
        trx,
      );
      await config.identity.checkBootstrap(proof, {
        admissionRef: r.admission.admissionRef,
        operation: 'project.create_preparing_project',
        target: projectRef,
        payloadHash: hash(input),
      });
      return result;
    });
  }
  async function createEnterprise(
    s: PreparationSession,
    input: {
      admissionRef: Common.ContentAddressedRef;
      enterpriseId: string;
      displayCode: string;
      displayName: string;
      commandId: string;
      idempotencyKey: string;
    },
  ) {
    const admission = await config.identity.revalidate(s, input.admissionRef);
    if (
      admission.payload.customerMode !== 'NEW' ||
      admission.payload.enterpriseRef.objectId !== input.enterpriseId
    )
      fail('PREPARATION_ADMISSION_INVALID');
    const target = object('zhiju.project.enterprise', input.enterpriseId, {
      enterpriseId: input.enterpriseId,
    });
    const proof = await config.identity.authorizeBootstrap(s, {
      admissionRef: input.admissionRef,
      operation: 'project.create_enterprise',
      target,
      payloadHash: hash(input),
    });
    return transaction(proof, target.scope, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.enterpriseId},0))`.execute(
        trx,
      );
      const existing = await trx
        .selectFrom('enterprise_project.command_receipt')
        .selectAll()
        .where('command_id', '=', input.commandId)
        .executeTakeFirst();
      if (existing) {
        if (existing.request_payload_hash.toString('hex') !== hash(input).digest)
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        return existing.result_payload as {
          enterpriseRef: Common.ObjectRef;
          receiptRef: Common.ObjectRef;
        };
      }
      if (
        !(await repo.insertEnterprise(trx, {
          enterpriseId: input.enterpriseId,
          displayCode: input.displayCode,
          displayName: input.displayName,
          createdByPrincipalId: s.principalId,
          createdByActorSnapshotId: proof.actorSnapshotRef.objectId,
          sourceCommandId: input.commandId,
        }))
      )
        fail('PROJECT_ENTERPRISE_DISPLAY_CODE_CONFLICT');
      const result = {
        enterpriseRef: object('zhiju.project.enterprise', input.enterpriseId, {
          enterpriseId: input.enterpriseId,
        }),
        receiptRef: object('CommandReceipt', input.commandId, target.scope),
      };
      await trx
        .insertInto('enterprise_project.command_receipt')
        .values({
          command_id: input.commandId,
          command_type: 'project.create_enterprise',
          command_version: '1.0',
          idempotency_scope: input.enterpriseId,
          idempotency_key: input.idempotencyKey,
          request_payload_hash: Buffer.from(hash(input).digest, 'hex'),
          enterprise_id: input.enterpriseId,
          target_type: 'Enterprise',
          target_id: input.enterpriseId,
          outcome: 'COMMITTED',
          result_payload: JSON.stringify(result),
          result_payload_hash: Buffer.from(hash(result).digest, 'hex'),
          completed_at: now(),
          correlation_id: input.commandId,
          created_by_principal_id: s.principalId,
          actor_snapshot_id: proof.actorSnapshotRef.objectId,
          authorization_decision_id: proof.authorizationDecisionRef.objectId,
        })
        .execute();
      const event = {
        enterpriseId: input.enterpriseId,
        enterpriseRef: result.enterpriseRef,
        displayCode: input.displayCode,
        status: 'ACTIVE',
      };
      await trx
        .insertInto('enterprise_project.outbox_event')
        .values({
          event_id: newUuidV7(),
          event_type: 'project.enterprise_created',
          event_version: '1.0',
          aggregate_type: 'Enterprise',
          aggregate_id: input.enterpriseId,
          aggregate_version: '1',
          enterprise_id: input.enterpriseId,
          correlation_id: input.commandId,
          payload: JSON.stringify(event),
          payload_hash: Buffer.from(hash(event).digest, 'hex'),
          canonicalization_version: '1',
          occurred_at: now(),
          created_by_principal_id: s.principalId,
          source_command_id: input.commandId,
        })
        .execute();
      await config.identity.checkBootstrap(proof, {
        admissionRef: input.admissionRef,
        operation: 'project.create_enterprise',
        target,
        payloadHash: hash(input),
      });
      return result;
    });
  }
  async function request(s: PreparationSession, command: WorkspaceCommandInput<unknown>) {
    await verified(s);
    const c = validateCommand(command);
    let priorAdmission: PreparationAdmissionResult | undefined;
    try {
      priorAdmission = await config.identity.lookupAdmission(s, {
        requestRef: c.targetRef,
        originalKey: c.idempotencyKey,
      });
    } catch (error) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'PREPARATION_NOT_VISIBLE'
      ))
        throw error;
    }
    const recovery = priorAdmission
      ? await config.identity.authorizeBootstrap(s, {
          admissionRef: priorAdmission.admissionRef,
          operation: 'project.get_project_preparation_request',
          target: c.targetRef,
          payloadHash: priorAdmission.payload.payloadHash,
        })
      : undefined;
    let row = recovery
      ? await read(recovery, c.scopeRef, 'REQUEST', c.targetRef.objectId)
      : undefined;
    let r: RequestFact;
    if (row) {
      r = row.payload as RequestFact;
      if (!equal(r.originalCommand, c) || r.creatorId !== s.principalId)
        fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
      await requestProof(s, r, 'project.request_project_preparation');
    } else {
      const selected = await resolvePreset(s, config.selection);
      if (
        !equal(c.payload.preparationPresetRef, config.selection.preparationPresetRef) ||
        !equal(c.payload.preparationPresetHash, config.selection.preparationPresetHash)
      )
        fail('PREPARATION_PRESET_SELECTION_MISMATCH');
      if (selected.useStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
      const admission = await config.identity.reserve(s, {
        requestRef: c.targetRef,
        originalCommandId: c.commandId,
        originalKey: c.idempotencyKey,
        payloadHash: c.integrity.payloadHash,
        customerMode: c.payload.customer.mode,
        enterpriseRef: object('zhiju.project.enterprise', c.scopeRef.enterpriseId, {
          enterpriseId: c.scopeRef.enterpriseId,
        }),
        projectRef: object('zhiju.project.project', c.scopeRef.projectId, c.scopeRef),
        preparationPresetRef: c.payload.preparationPresetRef,
        preparationPresetHash: c.payload.preparationPresetHash,
      });
      const proof = await config.identity.authorizeBootstrap(s, {
        admissionRef: admission.admissionRef,
        operation: 'project.request_project_preparation',
        target: c.targetRef,
        payloadHash: c.integrity.payloadHash,
      });
      r = {
        originalCommand: c,
        creatorId: s.principalId,
        selection: config.selection,
        admission,
        targets: {
          memberPolicyId: newUuidV7(),
          memberPolicyVersionId: newUuidV7(),
          enterpriseCommandId: newUuidV7(),
          projectCommandId: newUuidV7(),
          scopeClaimId: newUuidV7(),
          eventId: newUuidV7(),
        },
      };
      try {
        row = await append(
          proof,
          c.scopeRef,
          'REQUEST',
          c.targetRef.objectId,
          r,
          c.targetRef.objectId,
        );
      } catch (error) {
        row = await read(proof, c.scopeRef, 'REQUEST', c.targetRef.objectId);
        if (!row) throw error;
        const existing = row.payload as RequestFact;
        if (!equal(existing.originalCommand, c) || existing.creatorId !== s.principalId)
          throw error;
        r = existing;
      }
    }
    const p = await requestProof(s, r, 'project.request_project_preparation');
    const bound = await resolvePreset(s, r.selection, { historical: true });
    if (bound.useStatus !== 'USABLE' || bound.dependencyState !== 'USABLE') return result(s, r);
    let steps = await readSteps(p, r);
    if (steps.ENTERPRISE.status === 'NOT_STARTED') {
      let enterpriseStep: PreparationStep;
      if (c.payload.customer.mode === 'NEW') {
        const created = await (config.createEnterprise ?? createEnterprise)(s, {
          admissionRef: r.admission.admissionRef,
          enterpriseId: c.scopeRef.enterpriseId,
          displayCode: bound.payload.creation.enterpriseCodePrefix + '-' + c.scopeRef.enterpriseId,
          displayName: c.payload.customer.displayName,
          commandId: r.targets.enterpriseCommandId,
          idempotencyKey: c.idempotencyKey + ':ENTERPRISE:' + c.scopeRef.enterpriseId,
        });
        enterpriseStep = step('COMMITTED', [created.enterpriseRef], [created.receiptRef]);
      } else {
        const enterpriseRef = c.payload.customer.enterpriseRef;
        const ep = await authorized(s, 'project.enterprise.select', enterpriseRef, {
          enterpriseRef,
        });
        const existing = await transaction(ep, enterpriseRef.scope, (trx) =>
          repo.getEnterpriseById(trx, enterpriseRef.objectId),
        );
        if (existing?.status !== 'ACTIVE') fail('PROJECT_ENTERPRISE_NOT_ACTIVE');
        enterpriseStep = step('OBSERVED', [enterpriseRef]);
      }
      await append(p, c.scopeRef, 'STEP', c.targetRef.objectId + ':ENTERPRISE', enterpriseStep);
    }
    if (!config.serviceSession) return result(s, r);
    const provisioningService = await currentService();
    const member = await config.identity.materializeMemberPolicy(provisioningService, {
      admissionRef: r.admission.admissionRef,
      templateRef: bound.payload.memberPolicyTemplate.ref,
      templateHash: bound.payload.memberPolicyTemplate.payloadHash,
      memberPolicyId: r.targets.memberPolicyId,
      versionId: r.targets.memberPolicyVersionId,
    });
    if (steps.MEMBER_POLICY.status === 'NOT_STARTED')
      await append(
        p,
        c.scopeRef,
        'STEP',
        c.targetRef.objectId + ':MEMBER_POLICY',
        step('COMMITTED', [member.memberPolicyRef], [member.receiptRef]),
      );
    const project = await createProject(s, r, member, bound.payload);
    const projectReceipt = project.receiptRefs[0] as Common.ObjectRef;
    const claimRef = project.refs[1] as Common.ObjectRef;
    const provision = await config.identity.provisionCreatorAccess(provisioningService, {
      admissionRef: r.admission.admissionRef,
      memberPolicyRef: member.memberPolicyRef,
      memberPolicyHash: member.memberPolicyHash,
      projectCreationReceiptRef: projectReceipt,
      projectScopeClaimRef: claimRef,
    });
    steps = await readSteps(p, r);
    if (steps.CREATOR_ACCESS.status === 'NOT_STARTED' && provision.access === 'COMPLETE')
      await append(
        p,
        c.scopeRef,
        'STEP',
        c.targetRef.objectId + ':CREATOR_ACCESS',
        step('COMMITTED', provision.grantRefs, [provision.provisioningReceiptRef]),
      );
    return result(s, r);
  }
  async function getRequest(
    s: PreparationSession,
    input: { requestRef: Common.ObjectRef; originalKey: string },
  ) {
    return result(s, await loadRequest(s, input));
  }
  async function intakeBinding(
    service: PreparationSession,
    human: PreparationSession,
    input: {
      preparationRequestRef: Common.ObjectRef;
      originalPreparationKey: string;
      projectRef: Common.ObjectRef;
      intakeRef: Common.ObjectRef;
      intakePayloadHash: Common.ContentHash;
    },
  ) {
    const p = await authorized(
      service,
      'project.preparation.intake_binding.read',
      input.preparationRequestRef,
      input,
      human,
    );
    const r = await loadRequest(human, {
      requestRef: input.preparationRequestRef,
      originalKey: input.originalPreparationKey,
    });
    const resultView = await result(human, r);
    if (
      resultView.disposition !== 'ACCEPTED' ||
      !equal(
        input.projectRef,
        object(
          'zhiju.project.project',
          r.originalCommand.scopeRef.projectId,
          r.originalCommand.scopeRef,
        ),
      ) ||
      !equal(input.intakeRef.scope, r.originalCommand.scopeRef)
    )
      fail('PREPARATION_INTAKE_INELIGIBLE');
    const preset = await resolvePreset(human, r.selection);
    await config.check(
      p,
      'project.preparation.intake_binding.read',
      input.preparationRequestRef,
      input,
    );
    return {
      creatorId: r.creatorId,
      creatorRef: r.admission.payload.creatorRef,
      scopeRef: r.originalCommand.scopeRef,
      ...binding(r.selection, preset.payload),
      companyRules: preset.payload.companyRules,
      creationMode: 'PREPARATION' as const,
      status: 'PREPARING' as const,
      sourceWatermarks: resultView.sourceWatermarks,
    };
  }
  async function acceptSource(
    service: PreparationSession,
    human: PreparationSession,
    input: PreparationSourceAcceptInput,
  ) {
    const scope = input.intakeRef.scope;
    if (
      !scope.enterpriseId ||
      !scope.projectId ||
      !isUuidV7(input.sourceId) ||
      !isUuidV7(input.validationId) ||
      ![input.registerCommandId, input.validateCommandId, input.acceptCommandId].every(isUuidV7) ||
      !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 0 ||
      !input.originalName ||
      !input.mediaType ||
      !/^[a-f0-9]{64}$/.test(input.bytesSha256.digest) ||
      input.objectRef.sha256 !== input.bytesSha256.digest ||
      runtimeToken(input.validation.safety) !== 'PASS' ||
      runtimeToken(input.validation.integrity) !== 'PASS' ||
      !equal(input.scopeRef, scope) ||
      input.creatorId !== human.principalId ||
      input.objectRef.byteLength !== input.byteLength ||
      !input.objectRef.key
    )
      fail('PREPARATION_SOURCE_INVALID');
    const projectRef = object('zhiju.project.project', scope.projectId, scope);
    const sourceTarget = object('SourceMaterial', input.sourceId, scope);
    const registerProof = await authorized(
      service,
      'project.source_material.register',
      sourceTarget,
      input,
      human,
    );
    const p = await authorized(
      service,
      'project.source_material.accept',
      sourceTarget,
      input,
      human,
    );
    const h = await authorized(human, 'integration.customer_zip.intake', input.intakeRef, {
      intakeRef: input.intakeRef,
      submissionPayloadHash: input.submissionPayloadHash,
    });
    await config.check(h, 'integration.customer_zip.intake', input.intakeRef, {
      intakeRef: input.intakeRef,
      submissionPayloadHash: input.submissionPayloadHash,
    });
    if (!config.readSourceAdmission) fail('PREPARATION_SOURCE_ADMISSION_UNAVAILABLE');
    const admitted = await config.readSourceAdmission(service, {
      intakeRef: input.intakeRef,
      submissionPayloadHash: input.submissionPayloadHash,
      sourceId: input.sourceId,
    });
    if (
      !equal(admitted.sourceInput, input) ||
      admitted.creatorId !== human.principalId ||
      !equal(admitted.originalCommand.targetRef, input.intakeRef) ||
      !equal(admitted.originalCommand.integrity.payloadHash, input.submissionPayloadHash)
    )
      fail('PREPARATION_SOURCE_BINDING_INVALID');
    const existing = await read(p, scope, 'SOURCE_LINK', input.sourceId);
    if (existing) {
      const saved = existing.payload as {
        input: PreparationSourceAcceptInput;
        result: { sourceRef: Ref; validationRef: Ref; receiptRefs: Ref[] };
      };
      if (!equal(saved.input, input)) fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
      await config.check(p, 'project.source_material.accept', sourceTarget, input);
      return saved.result;
    }
    return transaction(p, scope, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.sourceId},0))`.execute(trx);
      const replay = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='SOURCE_LINK' AND identity_key=${input.sourceId}`.execute(
          trx,
        )
      ).rows[0];
      if (replay) {
        const saved = replay.payload as {
          input: PreparationSourceAcceptInput;
          result: { sourceRef: Ref; validationRef: Ref; receiptRefs: Ref[] };
        };
        if (!equal(saved.input, input)) fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        return saved.result;
      }
      const project = await trx
        .selectFrom('enterprise_project.project')
        .select(['status'])
        .where('project_id', '=', scope.projectId)
        .executeTakeFirst();
      if ((project?.status as string) !== 'PREPARING') fail('PREPARATION_SOURCE_PROJECT_INVALID');
      const actor = p.actorSnapshotRef.objectId;
      const principal = p.session.principalId;
      const submittedBy = object('identity.principal', human.principalId, {});
      const descriptor = {
        sourceMaterialId: input.sourceId,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        submittedByRef: submittedBy,
        originalName: input.originalName,
        mediaType: input.mediaType,
        byteLength: input.byteLength,
        contentHash: input.bytesSha256,
        stagedObjectRef: input.objectRef.key,
      };
      await repo.insertSourceMaterial(trx, {
        sourceMaterialId: input.sourceId,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        submittedByPrincipalId: human.principalId,
        submittedByRef: submittedBy,
        receivedAt: now(),
        originalName: input.originalName,
        mediaType: input.mediaType,
        byteLength: input.byteLength,
        contentHash: Buffer.from(input.bytesSha256.digest, 'hex'),
        stagedObjectRef: input.objectRef.key,
        descriptorPayloadHash: Buffer.from(hash(descriptor).digest, 'hex'),
        retentionClass: 'CUSTOMER_RECORD',
        createdByPrincipalId: principal,
        createdByActorSnapshotId: actor,
        sourceCommandId: input.registerCommandId,
      });
      const origin: Common.ExternalRef = {
        system: 'zhiju.integration',
        resourceType: 'zhiju.integration.customer_zip_intake',
        externalId: input.intakeRef.objectId,
        observedAt: now().toISOString(),
        payloadHash: input.submissionPayloadHash,
        adapterVersion: '1.0',
      };
      await repo.insertSourceMaterialOrigin(trx, {
        sourceMaterialOriginId: input.registerCommandId,
        sourceMaterialId: input.sourceId,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        originRef: origin,
        originRefHash: Buffer.from(hash(origin).digest, 'hex'),
        receivedAt: now(),
        recordedByPrincipalId: principal,
        recordedByActorSnapshotId: actor,
        authorizationDecisionId: registerProof.authorizationDecisionRef.objectId,
        sourceCommandId: input.registerCommandId,
      });
      const validation = {
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        validationId: input.validationId,
        sourceMaterialId: input.sourceId,
        validationKind: 'SECURITY',
        outcome: 'PASSED',
        validatedObjectRef: input.objectRef.key,
        validatedContentHash: input.bytesSha256.digest,
        validatedByteLength: input.byteLength,
        validatorId: 'customer-zip-admission',
        validatorVersion: '1.0',
        intakeRef: input.intakeRef,
        submissionPayloadHash: input.submissionPayloadHash,
      };
      await repo.insertSourceMaterialValidation(trx, {
        validationId: input.validationId,
        sourceMaterialId: input.sourceId,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        validationKind: 'SECURITY',
        outcome: 'PASSED',
        validatedObjectRef: input.objectRef.key,
        validatedContentHash: Buffer.from(input.bytesSha256.digest, 'hex'),
        validatedByteLength: input.byteLength,
        validatorId: 'customer-zip-admission',
        validatorVersion: '1.0',
        payload: validation,
        payloadHash: Buffer.from(hash(validation).digest, 'hex'),
        recordedByPrincipalId: principal,
        recordedByActorSnapshotId: actor,
        authorizationDecisionId: p.authorizationDecisionRef.objectId,
        sourceCommandId: input.validateCommandId,
      });
      const integrityId = input.validateCommandId;
      const integrity = { ...validation, validationId: integrityId, validationKind: 'INTEGRITY' };
      await repo.insertSourceMaterialValidation(trx, {
        validationId: integrityId,
        sourceMaterialId: input.sourceId,
        enterpriseId: scope.enterpriseId,
        projectId: scope.projectId,
        validationKind: 'INTEGRITY',
        outcome: 'PASSED',
        validatedObjectRef: input.objectRef.key,
        validatedContentHash: Buffer.from(input.bytesSha256.digest, 'hex'),
        validatedByteLength: input.byteLength,
        validatorId: 'customer-zip-admission',
        validatorVersion: '1.0',
        payload: integrity,
        payloadHash: Buffer.from(hash(integrity).digest, 'hex'),
        recordedByPrincipalId: principal,
        recordedByActorSnapshotId: actor,
        authorizationDecisionId: p.authorizationDecisionRef.objectId,
        sourceCommandId: input.validateCommandId,
      });
      const accepted = await repo.casSourceMaterialAccepted(
        trx,
        input.sourceId,
        '1',
        input.objectRef.key,
        now(),
      );
      if (!accepted.ok) fail('PREPARATION_SOURCE_CONCURRENCY');
      const sourceRef: Common.ContentAddressedRef = {
        kind: 'CONTENT_ADDRESSED',
        objectType: 'SourceMaterial',
        objectId: input.sourceId,
        scope,
        contentHash: input.bytesSha256,
      };
      const validationRef = content('ValidationResult', input.validationId, scope, validation);
      const receiptRefs = [
        input.registerCommandId,
        input.validateCommandId,
        input.acceptCommandId,
      ].map((id) => object('CommandReceipt', id, scope));
      const result = { sourceRef, validationRef, receiptRefs };
      for (const [index, commandId] of [
        input.registerCommandId,
        input.validateCommandId,
        input.acceptCommandId,
      ].entries()) {
        const operation =
          [
            'project.register_source_material',
            'project.validate_preparation_source',
            'project.accept_source_material',
          ][index] ?? fail('PREPARATION_SOURCE_INVALID');
        await trx
          .insertInto('enterprise_project.command_receipt')
          .values({
            command_id: commandId,
            command_type: operation,
            command_version: '1.0',
            idempotency_scope: scope.projectId,
            idempotency_key: `${input.intakeRef.objectId}:${input.sourceId}:${operation}`,
            request_payload_hash: Buffer.from(hash(input).digest, 'hex'),
            enterprise_id: scope.enterpriseId,
            project_id: scope.projectId,
            target_type: 'SourceMaterial',
            target_id: input.sourceId,
            outcome: 'COMMITTED',
            result_payload: JSON.stringify(result),
            result_payload_hash: Buffer.from(hash(result).digest, 'hex'),
            completed_at: now(),
            correlation_id: input.registerCommandId,
            created_by_principal_id: principal,
            actor_snapshot_id: actor,
            authorization_decision_id: p.authorizationDecisionRef.objectId,
          })
          .execute();
      }
      const acceptedEvent = {
        sourceMaterialRef: { ...sourceRef, objectType: 'zhiju.project.source_material' },
        projectRef,
        originRef: origin,
        acceptedAt: now().toISOString(),
      };
      await trx
        .insertInto('enterprise_project.outbox_event')
        .values({
          event_id: newUuidV7(),
          event_type: 'project.SourceMaterialAccepted',
          event_version: '1.0',
          aggregate_type: 'SourceMaterial',
          aggregate_id: input.sourceId,
          aggregate_version: accepted.nextVersion,
          enterprise_id: scope.enterpriseId,
          project_id: scope.projectId,
          correlation_id: input.acceptCommandId,
          payload: JSON.stringify(acceptedEvent),
          payload_hash: Buffer.from(hash(acceptedEvent).digest, 'hex'),
          canonicalization_version: '1',
          occurred_at: now(),
          created_by_principal_id: principal,
          source_command_id: input.acceptCommandId,
        })
        .execute();
      const payload = { input, result };
      await sql`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,project_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref) VALUES(${newUuidV7()},'SOURCE_LINK',${scope.enterpriseId},${scope.projectId},${human.principalId},${input.sourceId},${JSON.stringify(payload)}::jsonb,${Buffer.from(hash(payload).digest, 'hex')},${JSON.stringify(p.actorSnapshotRef)}::jsonb,${JSON.stringify(p.authorizationDecisionRef)}::jsonb)`.execute(
        trx,
      );
      await config.check(registerProof, 'project.source_material.register', sourceTarget, input);
      await config.check(p, 'project.source_material.accept', sourceTarget, input);
      return result;
    });
  }
  async function sourceLinks(service: PreparationSession, intakeRef: Common.ObjectRef) {
    const input = {
      projectRef: object(
        'zhiju.project.project',
        requiredProjectId(intakeRef.scope),
        intakeRef.scope,
      ),
      intakeRef,
    };
    const p = await authorized(service, 'project.preparation.handoff.read', intakeRef, input);
    const links = await transaction(
      p,
      intakeRef.scope,
      async (trx) =>
        (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='SOURCE_LINK' AND payload->'input'->'intakeRef'->>'objectId'=${intakeRef.objectId}`.execute(
            trx,
          )
        ).rows,
    );
    await config.check(p, 'project.preparation.handoff.read', intakeRef, input);
    return { hasLinks: links.length > 0 };
  }
  async function captureSource(
    s: PreparationSession,
    input: {
      sourceId: string;
      projectRef: Common.ObjectRef;
      intakeManifestRef: Ref;
      templateRefs: Common.ContentAddressedRef[];
      ruleBundleRef: Common.SnapshotRef;
      companyRulePublicationRef: Common.ContentAddressedRef;
      trustedDecisionRefs: Ref[];
      purpose: 'preparation.analysis';
      audience: Common.ObjectRef;
      sourceRefs: Ref[];
      noteSourceRef?: Ref;
    },
  ) {
    const p = await authorized(s, 'project.preparation.source.capture', input.projectRef, input);
    if (
      runtimeToken(input.purpose) !== 'preparation.analysis' ||
      input.trustedDecisionRefs.length ||
      !input.templateRefs.length ||
      !config.analysisAudience ||
      !equal(input.audience, config.analysisAudience)
    )
      fail('PREPARATION_SOURCE_INVALID');
    const scope = input.projectRef.scope;
    const handoffRows = await transaction(
      p,
      scope,
      async (trx) =>
        (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='HANDOFF' AND payload->>'sourceId'=${input.sourceId}`.execute(
            trx,
          )
        ).rows,
    );
    const handoff = handoffRows[0]?.payload as Handoff | undefined;
    if (!handoff) fail('PREPARATION_SOURCE_BINDING_INVALID');
    const locked = await resolvePreset(s, handoff.selection);
    if (
      locked.useStatus !== 'USABLE' ||
      !equal(input.projectRef, handoff.submission.projectRef) ||
      !equal(input.intakeManifestRef, handoff.submission.manifestRef) ||
      !equal(input.sourceRefs, handoff.submission.sourceRefs) ||
      !equal(input.templateRefs, locked.dependencies.templateRefs) ||
      !equal(input.ruleBundleRef, locked.payload.companyRules.ruleBundleRef) ||
      !equal(input.companyRulePublicationRef, locked.payload.companyRules.publicationRef) ||
      !equal(input.noteSourceRef ?? null, handoff.submission.noteSourceRef ?? null)
    )
      fail('PREPARATION_SOURCE_BINDING_INVALID');
    return transaction(p, scope, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.sourceId},0))`.execute(trx);
      const existing = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='SOURCE' AND identity_key=${input.sourceId}`.execute(
          trx,
        )
      ).rows[0];
      if (existing) {
        const saved = existing.payload as {
          input: typeof input;
          result: {
            preparationSourceRef: Common.SnapshotRef;
            inputRefs: Ref[];
            receiptRef: Ref;
            validUntil: string;
          };
        };
        if (!equal(saved.input, input)) fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        return saved.result;
      }
      const sources = [];
      for (const ref of input.sourceRefs) {
        if (
          !('kind' in ref) ||
          ref.kind !== 'CONTENT_ADDRESSED' ||
          !equal(ref.scope, scope) ||
          ref.objectType !== 'SourceMaterial'
        )
          fail('PREPARATION_SOURCE_INVALID');
        const row = await repo.getSourceMaterialById(trx, ref.objectId);
        if (
          row?.custody_status !== 'ACCEPTED' ||
          ref.contentHash.digest !== row.content_hash.toString('hex')
        )
          fail('PREPARATION_SOURCE_NOT_ACCEPTED');
        sources.push({
          sourceRef: ref,
          bytesSha256: row.content_hash.toString('hex'),
          byteLength: Number(row.byte_length),
          objectRef: row.accepted_object_ref,
          classification: 'CUSTOMER_MATERIAL',
          ...(input.noteSourceRef && equal(ref, input.noteSourceRef)
            ? { role: 'CUSTOMER_NOTE' }
            : {}),
        });
      }
      const payload = {
        projectRef: input.projectRef,
        intakeManifestRef: input.intakeManifestRef,
        templateRefs: input.templateRefs,
        ruleBundleRef: input.ruleBundleRef,
        companyRulePublicationRef: input.companyRulePublicationRef,
        purpose: input.purpose,
        audience: input.audience,
        sources,
        trustedDecisionRefs: [],
        coverage: { acceptedSources: sources.length },
        omissions: [],
        redactions: [],
        validUntil: s.expiresAt,
      };
      const ref: Common.SnapshotRef = {
        kind: 'SNAPSHOT',
        objectType: 'zhiju.project.preparation_source',
        objectId: input.sourceId,
        snapshotId: input.sourceId,
        scope,
        contentHash: hash(payload),
      };
      const result = {
        preparationSourceRef: ref,
        inputRefs: input.sourceRefs,
        receiptRef: object('CommandReceipt', handoff.sourceCommandId, scope),
        validUntil: s.expiresAt,
      };
      await technicalReceipt(trx, p, scope, {
        commandId: handoff.sourceCommandId,
        operation: 'project.capture_preparation_source',
        key: handoff.submission.intakeRef.objectId + ':SOURCE:' + input.sourceId,
        target: object('zhiju.project.preparation_source', input.sourceId, scope),
        payload: input,
        result,
      });
      const fact = { input, payload, result };
      await sql`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,project_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref) VALUES(${input.sourceId},'SOURCE',${scope.enterpriseId},${scope.projectId},${s.principalId},${input.sourceId},${JSON.stringify(fact)}::jsonb,${Buffer.from(hash(fact).digest, 'hex')},${JSON.stringify(p.actorSnapshotRef)}::jsonb,${JSON.stringify(p.authorizationDecisionRef)}::jsonb)`.execute(
        trx,
      );
      await config.check(p, 'project.preparation.source.capture', input.projectRef, input);
      return result;
    });
  }
  async function getSource(
    s: PreparationSession,
    input: {
      preparationSourceRef: Common.SnapshotRef;
      purpose: 'preparation.analysis';
      audience: Common.ObjectRef;
    },
  ) {
    const target = object(
      'zhiju.project.preparation_source',
      input.preparationSourceRef.objectId,
      input.preparationSourceRef.scope,
    );
    const p = await authorized(s, 'project.preparation.source.read', target, input);
    const row = await read(p, target.scope, 'SOURCE', target.objectId);
    if (!row) fail('PREPARATION_SOURCE_NOT_VISIBLE');
    const fact = row.payload as {
      input: { audience: Common.ObjectRef };
      payload: { validUntil: string };
      result: { preparationSourceRef: Common.SnapshotRef };
    };
    if (
      !equal(fact.result.preparationSourceRef, input.preparationSourceRef) ||
      runtimeToken(input.purpose) !== 'preparation.analysis' ||
      !equal(input.audience, fact.input.audience)
    )
      fail('PREPARATION_SOURCE_INVALID');
    const handoffRows = await transaction(
      p,
      target.scope,
      async (trx) =>
        (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='HANDOFF' AND payload->>'sourceId'=${target.objectId}`.execute(
            trx,
          )
        ).rows,
    );
    const handoff = handoffRows[0]?.payload as Handoff | undefined;
    if (!handoff) fail('PREPARATION_SOURCE_BINDING_INVALID');
    const current = await resolvePreset(s, handoff.selection, { historical: true });
    await config.check(p, 'project.preparation.source.read', target, input);
    return {
      payload: fact.payload,
      currentUsability:
        current.useStatus !== 'USABLE' || current.dependencyState === 'UNUSABLE'
          ? 'STALE'
          : current.dependencyState === 'UNAVAILABLE'
            ? 'UNKNOWN'
            : new Date(fact.payload.validUntil) > now()
              ? 'USABLE'
              : 'EXPIRED',
      reasons:
        current.useStatus !== 'USABLE' || current.dependencyState === 'UNUSABLE'
          ? ['PREPARATION_PRESET_UNUSABLE']
          : current.dependencyState === 'UNAVAILABLE'
            ? ['PREPARATION_DEPENDENCY_UNAVAILABLE']
            : new Date(fact.payload.validUntil) > now()
              ? []
              : ['SOURCE_EXPIRED'],
      validUntil: fact.payload.validUntil,
    };
  }
  interface Handoff {
    submission: PreparationBoundSubmission;
    selection: PreparationEntrySelection;
    sourceId: string;
    taskId: string;
    analysisRequestId: string;
    sourceCommandId: string;
    taskCommandId: string;
    analysisCommandId: string;
    version: 1;
  }
  async function handoffRead(service: PreparationSession, intakeRef: Common.ObjectRef) {
    const readInput = {
      projectRef: object(
        'zhiju.project.project',
        requiredProjectId(intakeRef.scope),
        intakeRef.scope,
      ),
      intakeRef,
    };
    const p = await authorized(service, 'project.preparation.handoff.read', intakeRef, readInput);
    const row = await read(p, intakeRef.scope, 'HANDOFF', intakeRef.objectId);
    if (!row) return { status: 'NOT_OBSERVED', sourceWatermarks: [] };
    const h = row.payload as Handoff;
    const steps: Record<'SOURCE' | 'TASK' | 'ANALYSIS_REQUEST', PreparationStep> = {
      SOURCE: step(),
      TASK: step(),
      ANALYSIS_REQUEST: step(),
    };
    for (const name of ['SOURCE', 'TASK', 'ANALYSIS_REQUEST'] as const) {
      const fact = await read(p, intakeRef.scope, 'HANDOFF_STEP', intakeRef.objectId + ':' + name);
      if (fact) steps[name] = fact.payload as PreparationStep;
      else if (await read(p, intakeRef.scope, 'HANDOFF_ATTEMPT', intakeRef.objectId + ':' + name))
        steps[name] = step('UNKNOWN', [], [], ['OWNING_RECEIPT_READBACK_REQUIRED']);
    }
    const missing =
      !config.serviceSession ||
      !config.analysisAudience ||
      !config.taskPort?.read ||
      !preparationTaskOperationsRegistered() ||
      !config.checkOriginalAnalysis;
    let eligibility: 'USABLE' | 'STALE' | 'UNKNOWN' | 'BLOCKED_AUTHORIZATION' = 'USABLE';
    const current = await resolvePreset(service, h.selection, { historical: true });
    if (current.useStatus !== 'USABLE' || current.dependencyState === 'UNUSABLE')
      eligibility = 'STALE';
    else if (current.dependencyState === 'UNAVAILABLE') eligibility = 'UNKNOWN';
    if (config.checkOriginalAnalysis) {
      try {
        await config.checkOriginalAnalysis(service, {
          creatorId: h.submission.creatorId,
          projectRef: h.submission.projectRef,
          intakeRef: h.submission.intakeRef,
          submissionPayloadHash: h.submission.submissionPayloadHash,
        });
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
        eligibility = /DENIED|REVOKED|EXPIRED|NOT_VISIBLE/.test(code)
          ? 'BLOCKED_AUTHORIZATION'
          : 'UNKNOWN';
      }
    }
    const status =
      eligibility !== 'USABLE'
        ? eligibility
        : steps.ANALYSIS_REQUEST.status === 'COMMITTED'
          ? 'ACCEPTED'
          : Object.values(steps).some((x) => x.status === 'UNKNOWN')
            ? 'UNKNOWN'
            : missing
              ? 'WAITING_CAPABILITY'
              : 'PENDING';
    await config.check(p, 'project.preparation.handoff.read', intakeRef, readInput);
    return {
      intakeRef,
      manifestRef: h.submission.manifestRef,
      status,
      steps,
      reasonCodes:
        eligibility !== 'USABLE'
          ? [
              eligibility === 'STALE'
                ? 'PREPARATION_PRESET_UNUSABLE'
                : eligibility === 'BLOCKED_AUTHORIZATION'
                  ? 'AUTHORIZATION_DENIED'
                  : 'DEPENDENCY_UNAVAILABLE',
            ]
          : missing
            ? ['PREPARATION_ANALYSIS_CAPABILITY_UNAVAILABLE']
            : [],
      sourceWatermarks: [
        {
          sourceModule: 'zhiju.enterprise_project',
          partition: intakeRef.objectId,
          sequence: Object.values(steps).filter((x) => x.status === 'COMMITTED').length,
          observedAt: now().toISOString(),
        },
      ],
    };
  }
  async function acceptHandoff(
    service: PreparationSession,
    input: {
      eventId: string;
      intakeRef: Common.ObjectRef;
      manifestRef: Ref;
      submissionPayloadHash: Common.ContentHash;
    },
  ) {
    const p = await authorized(
      service,
      'project.preparation.handoff.continue',
      input.intakeRef,
      input,
    );
    if (!config.readSubmission) fail('PREPARATION_SUBMISSION_READ_UNAVAILABLE');
    const submission = await config.readSubmission(service, {
      intakeRef: input.intakeRef,
      manifestRef: input.manifestRef,
      submissionPayloadHash: input.submissionPayloadHash,
    });
    if (
      !submission.manifest.entries.some((entry) => entry.status === 'ANALYZABLE') ||
      !equal(submission.manifestRef, input.manifestRef) ||
      !equal(submission.submissionPayloadHash, input.submissionPayloadHash)
    )
      fail('PREPARATION_HANDOFF_BINDING_INVALID');
    const requestRow = await read(
      p,
      input.intakeRef.scope,
      'REQUEST',
      submission.preparationRequestRef.objectId,
    );
    if (!requestRow) fail('PREPARATION_NOT_VISIBLE');
    const r = requestRow.payload as RequestFact;
    if (
      r.creatorId !== submission.creatorId ||
      r.originalCommand.idempotencyKey !== submission.originalPreparationKey ||
      !equal(r.originalCommand.scopeRef, submission.projectRef.scope)
    )
      fail('PREPARATION_HANDOFF_BINDING_INVALID');
    const existing = await read(p, input.intakeRef.scope, 'HANDOFF', input.intakeRef.objectId);
    if (!existing) {
      const payload: Handoff = {
        submission,
        selection: r.selection,
        sourceId: newUuidV7(),
        taskId: newUuidV7(),
        analysisRequestId: newUuidV7(),
        sourceCommandId: newUuidV7(),
        taskCommandId: newUuidV7(),
        analysisCommandId: newUuidV7(),
        version: 1,
      };
      try {
        await append(p, input.intakeRef.scope, 'HANDOFF', input.intakeRef.objectId, payload);
      } catch (error) {
        if (!(await read(p, input.intakeRef.scope, 'HANDOFF', input.intakeRef.objectId)))
          throw error;
      }
    }
    await append(p, input.intakeRef.scope, 'INBOX', input.eventId, input, input.eventId);
    return continueHandoff(service, {
      intakeRef: input.intakeRef,
      expectedProcessVersion: 1,
      originalSubmissionPayloadHash: input.submissionPayloadHash,
    });
  }
  async function remoteStep<T>(
    p: PreparationAuthorizationProof,
    service: PreparationSession,
    intakeRef: Common.ObjectRef,
    name: 'TASK' | 'ANALYSIS_REQUEST',
    originalCommand: PreparationTaskCommand | PreparationAnalysisCommand,
    invoke: () => Promise<T>,
  ): Promise<T | undefined> {
    const key = intakeRef.objectId + ':' + name;
    if (!preparationTaskOperationsRegistered() || !config.taskPort?.read) return undefined;
    assertRegisteredPreparationTaskCommand(name, originalCommand);
    const saved = await read(p, intakeRef.scope, 'HANDOFF_RESULT', key);
    if (saved) {
      assertRegisteredPreparationTaskResult(name, originalCommand, saved.payload);
      const observation = await config.taskPort.read(service, { operation: name, originalCommand });
      if (observation.status !== 'COMMITTED') return undefined;
      assertRegisteredPreparationTaskResult(name, originalCommand, observation.result);
      if (!equal(observation.result, saved.payload)) fail('PREPARATION_HANDOFF_RECEIPT_INVALID');
      return saved.payload as T;
    }
    const claimed = await transaction(
      p,
      intakeRef.scope,
      async (trx) =>
        (
          await sql<{
            id: string;
          }>`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,project_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref) VALUES(${newUuidV7()},'HANDOFF_ATTEMPT',${intakeRef.scope.enterpriseId},${intakeRef.scope.projectId},${service.principalId},${key},${JSON.stringify(originalCommand)}::jsonb,${Buffer.from(hash(originalCommand).digest, 'hex')},${JSON.stringify(p.actorSnapshotRef)}::jsonb,${JSON.stringify(p.authorizationDecisionRef)}::jsonb) ON CONFLICT(kind,identity_key) DO NOTHING RETURNING id`.execute(
            trx,
          )
        ).rows.length === 1,
    );
    let result: T;
    if (!claimed) {
      const attempt = await read(p, intakeRef.scope, 'HANDOFF_ATTEMPT', key);
      if (!attempt || !equal(attempt.payload, originalCommand))
        fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
      const observation = await config.taskPort.read(service, { operation: name, originalCommand });
      if (observation.status === 'UNKNOWN') return undefined;
      if (observation.status === 'COMMITTED') {
        if (!observation.result) fail('PREPARATION_HANDOFF_RECEIPT_INVALID');
        result = observation.result as T;
      } else result = await invoke();
    } else result = await invoke();
    assertRegisteredPreparationTaskResult(name, originalCommand, result);
    const confirmed = await config.taskPort.read(service, { operation: name, originalCommand });
    if (confirmed.status !== 'COMMITTED') return undefined;
    assertRegisteredPreparationTaskResult(name, originalCommand, confirmed.result);
    assertPreparationTaskReadback(name, originalCommand, result, confirmed.result);
    await append(p, intakeRef.scope, 'HANDOFF_RESULT', key, result);
    return result;
  }
  async function continueHandoff(
    service: PreparationSession,
    input: {
      intakeRef: Common.ObjectRef;
      expectedProcessVersion: number;
      originalSubmissionPayloadHash: Common.ContentHash;
      step?: 'SOURCE' | 'TASK' | 'ANALYSIS_REQUEST';
    },
  ) {
    const p = await authorized(
      service,
      'project.preparation.handoff.continue',
      input.intakeRef,
      input,
    );
    const row = await read(p, input.intakeRef.scope, 'HANDOFF', input.intakeRef.objectId);
    if (!row) fail('PREPARATION_HANDOFF_NOT_FOUND');
    const h = row.payload as Handoff;
    if (
      input.expectedProcessVersion !== h.version ||
      !equal(input.originalSubmissionPayloadHash, h.submission.submissionPayloadHash)
    )
      fail('PREPARATION_HANDOFF_CONCURRENCY');
    if (!config.serviceSession || !config.analysisAudience || !config.checkOriginalAnalysis)
      return handoffRead(service, input.intakeRef);
    await config.checkOriginalAnalysis(service, {
      creatorId: h.submission.creatorId,
      projectRef: h.submission.projectRef,
      intakeRef: h.submission.intakeRef,
      submissionPayloadHash: h.submission.submissionPayloadHash,
    });
    const selected = await resolvePreset(service, h.selection);
    if (selected.useStatus !== 'USABLE')
      return {
        ...(await handoffRead(service, input.intakeRef)),
        status: 'STALE',
        reasonCodes: ['PREPARATION_PRESET_UNUSABLE'],
      };
    const steps = await handoffRead(service, input.intakeRef);
    if (!('steps' in steps)) return steps;
    const projectRef = h.submission.projectRef;
    let source = await read(p, input.intakeRef.scope, 'SOURCE', h.sourceId);
    if (!source && (!input.step || input.step === 'SOURCE')) {
      await config.checkOriginalAnalysis(service, {
        creatorId: h.submission.creatorId,
        projectRef: h.submission.projectRef,
        intakeRef: h.submission.intakeRef,
        submissionPayloadHash: h.submission.submissionPayloadHash,
      });
      const captured = await captureSource(service, {
        sourceId: h.sourceId,
        projectRef,
        intakeManifestRef: h.submission.manifestRef,
        templateRefs: selected.dependencies.templateRefs,
        ruleBundleRef: selected.payload.companyRules.ruleBundleRef,
        companyRulePublicationRef: selected.payload.companyRules.publicationRef,
        trustedDecisionRefs: [],
        purpose: 'preparation.analysis',
        audience: config.analysisAudience,
        sourceRefs: h.submission.sourceRefs,
        ...(h.submission.noteSourceRef ? { noteSourceRef: h.submission.noteSourceRef } : {}),
      });
      await append(
        p,
        input.intakeRef.scope,
        'HANDOFF_STEP',
        input.intakeRef.objectId + ':SOURCE',
        step('COMMITTED', [captured.preparationSourceRef], [captured.receiptRef]),
      );
      source = await read(p, input.intakeRef.scope, 'SOURCE', h.sourceId);
    }
    if (!source || !config.taskPort?.read || !preparationTaskOperationsRegistered())
      return handoffRead(service, input.intakeRef);
    const captured = (
      source.payload as { result: { preparationSourceRef: Common.SnapshotRef; inputRefs: Ref[] } }
    ).result;
    const taskPayload = {
      projectRef,
      preparationSourceRef: captured.preparationSourceRef,
      analysisProfileRef: selected.payload.analysisHandoff.analysisProfileRef,
      definition: {
        kind: 'PREPARATION_ANALYSIS' as const,
        expectedReportProfileRef: selected.payload.analysisHandoff.expectedReportProfileRef,
        objective: selected.payload.creation.objective,
        inputRefs: captured.inputRefs,
      },
    };
    const taskInput: PreparationTaskCommand = {
      commandId: h.taskCommandId,
      type: 'execution.create_preparation_analysis_task',
      version: '1.0',
      scopeRef: {
        enterpriseId: input.intakeRef.scope.enterpriseId ?? fail('PREPARATION_SCOPE_INVALID'),
        projectId: requiredProjectId(input.intakeRef.scope),
      },
      idempotencyKey: `execution.create_preparation_analysis_task:1.0:${h.taskId}`,
      targetRef: object('zhiju.execution.task', h.taskId, input.intakeRef.scope),
      correlationId: h.submission.intakeRef.objectId,
      requestedAt: row.recorded_at.toISOString(),
      payload: taskPayload,
      integrity: { canonicalizationVersion: '1', payloadHash: hash(taskPayload) },
    };
    const taskKey = input.intakeRef.objectId + ':TASK';
    let task = await read(p, input.intakeRef.scope, 'HANDOFF_STEP', taskKey);
    if (!task && (!input.step || input.step === 'TASK')) {
      await config.checkOriginalAnalysis(service, {
        creatorId: h.submission.creatorId,
        projectRef: h.submission.projectRef,
        intakeRef: h.submission.intakeRef,
        submissionPayloadHash: h.submission.submissionPayloadHash,
      });
      const taskPort = config.taskPort;
      const taskResult = await remoteStep(p, service, input.intakeRef, 'TASK', taskInput, () =>
        taskPort.create(service, taskInput),
      );
      if (!taskResult) return handoffRead(service, input.intakeRef);
      const committed = {
        ...step(
          'COMMITTED',
          [taskResult.taskRef, taskResult.definitionSnapshotRef],
          [taskResult.receiptRef],
        ),
      };
      task = await append(p, input.intakeRef.scope, 'HANDOFF_STEP', taskKey, committed);
    }
    const analysis = await read(
      p,
      input.intakeRef.scope,
      'HANDOFF_STEP',
      input.intakeRef.objectId + ':ANALYSIS_REQUEST',
    );
    if (task && !analysis && (!input.step || input.step === 'ANALYSIS_REQUEST')) {
      await config.checkOriginalAnalysis(service, {
        creatorId: h.submission.creatorId,
        projectRef: h.submission.projectRef,
        intakeRef: h.submission.intakeRef,
        submissionPayloadHash: h.submission.submissionPayloadHash,
      });
      const committed = task.payload as PreparationStep;
      const taskDetails = await read(p, input.intakeRef.scope, 'HANDOFF_RESULT', taskKey);
      if (!taskDetails) fail('PREPARATION_HANDOFF_RECEIPT_INVALID');
      const aggregateVersion = (taskDetails.payload as { aggregateVersion: number })
        .aggregateVersion;
      const taskResult = taskDetails.payload as PreparationTaskResult;
      assertRegisteredPreparationTaskResult('TASK', taskInput, taskResult);
      if (!equal(committed.refs, [taskResult.taskRef, taskResult.definitionSnapshotRef]))
        fail('PREPARATION_HANDOFF_RECEIPT_INVALID');
      const analysisPayload = {
        taskRef: taskResult.taskRef,
        taskDefinitionSnapshotRef: taskResult.definitionSnapshotRef,
        expectedTaskAggregateVersion: aggregateVersion,
        preparationSourceRef: captured.preparationSourceRef,
        analysisProfileRef: selected.payload.analysisHandoff.analysisProfileRef,
      };
      const analysisInput: PreparationAnalysisCommand = {
        commandId: h.analysisCommandId,
        type: 'execution.request_preparation_analysis',
        version: '1.0',
        scopeRef: {
          enterpriseId: input.intakeRef.scope.enterpriseId ?? fail('PREPARATION_SCOPE_INVALID'),
          projectId: requiredProjectId(input.intakeRef.scope),
        },
        idempotencyKey: `execution.request_preparation_analysis:1.0:${h.analysisRequestId}`,
        targetRef: object(
          'zhiju.execution.preparation_analysis_request',
          h.analysisRequestId,
          input.intakeRef.scope,
        ),
        correlationId: h.submission.intakeRef.objectId,
        requestedAt: row.recorded_at.toISOString(),
        payload: analysisPayload,
        integrity: { canonicalizationVersion: '1', payloadHash: hash(analysisPayload) },
      };
      const taskPort = config.taskPort;
      const requested = await remoteStep(
        p,
        service,
        input.intakeRef,
        'ANALYSIS_REQUEST',
        analysisInput,
        () => taskPort.request(service, analysisInput),
      );
      if (!requested) return handoffRead(service, input.intakeRef);
      await append(
        p,
        input.intakeRef.scope,
        'HANDOFF_STEP',
        input.intakeRef.objectId + ':ANALYSIS_REQUEST',
        step('COMMITTED', [requested.analysisRequestRef], [requested.receiptRef]),
      );
    }
    return handoffRead(service, input.intakeRef);
  }
  async function queryHandoff(human: PreparationSession, intakeRef: Common.ObjectRef) {
    await verified(human);
    const service = await currentService();
    const serviceProof = await authorized(service, 'project.preparation.handoff.read', intakeRef, {
      projectRef: object(
        'zhiju.project.project',
        requiredProjectId(intakeRef.scope),
        intakeRef.scope,
      ),
      intakeRef,
    });
    const row = await read(serviceProof, intakeRef.scope, 'HANDOFF', intakeRef.objectId);
    if (!row) return { status: 'NOT_OBSERVED', sourceWatermarks: [] };
    const h = row.payload as Handoff;
    await loadRequest(human, {
      requestRef: h.submission.preparationRequestRef,
      originalKey: h.submission.originalPreparationKey,
    });
    if (!config.serviceSession)
      return {
        intakeRef,
        status: 'WAITING_CAPABILITY',
        reasonCodes: ['PREPARATION_SERVICE_UNAVAILABLE'],
        steps: { SOURCE: step(), TASK: step(), ANALYSIS_REQUEST: step() },
        sourceWatermarks: [],
      };
    return handoffRead(await currentService(), intakeRef);
  }
  async function boardEntry(session: PreparationSession, projectRef: Common.ObjectRef) {
    const input = { projectRef };
    const p = await authorized(
      session,
      'enterprise.project.get_project_board_slice',
      projectRef,
      input,
    );
    const rows = await transaction(
      p,
      projectRef.scope,
      async (trx) =>
        (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='REQUEST' AND project_id=${projectRef.objectId}`.execute(
            trx,
          )
        ).rows,
    );
    const row = rows[0];
    if (!row) return undefined;
    const r = row.payload as RequestFact;
    if (r.creatorId !== session.principalId) return undefined;
    await loadRequest(session, {
      requestRef: r.originalCommand.targetRef,
      originalKey: r.originalCommand.idempotencyKey,
    });
    await config.check(p, 'enterprise.project.get_project_board_slice', projectRef, input);
    return {
      preparationRequestRef: r.originalCommand.targetRef,
      originalPreparationKey: r.originalCommand.idempotencyKey,
    };
  }
  async function createPreparingProject(
    session: PreparationSession,
    command: WorkspaceCommandInput<unknown>,
  ) {
    const input = command.payload as {
      enterpriseRef: Common.ObjectRef;
      displayCode: string;
      title: string;
      objective: string;
      memberPolicyRef: Common.VersionedRef;
      memberPolicyHash: Common.ContentHash;
      preparationPresetRef: Common.VersionedRef;
      preparationPresetHash: Common.ContentHash;
      preparationRequestRef: Common.ObjectRef;
    };
    closed(input, [
      'enterpriseRef',
      'displayCode',
      'title',
      'objective',
      'memberPolicyRef',
      'memberPolicyHash',
      'preparationPresetRef',
      'preparationPresetHash',
      'preparationRequestRef',
    ]);
    const r = await loadRequest(session, {
      requestRef: input.preparationRequestRef,
      originalKey: `project.request_project_preparation:1.0:${input.preparationRequestRef.objectId}`,
    });
    const selected = await resolvePreset(session, r.selection);
    if (selected.useStatus !== 'USABLE') fail('PREPARATION_PRESET_UNUSABLE');
    const expected = {
      enterpriseRef: r.admission.payload.enterpriseRef,
      displayCode:
        selected.payload.creation.projectCodePrefix + '-' + r.originalCommand.scopeRef.projectId,
      title: r.originalCommand.payload.projectTitle,
      objective: selected.payload.creation.objective,
      memberPolicyRef: input.memberPolicyRef,
      memberPolicyHash: input.memberPolicyHash,
      preparationPresetRef: r.selection.preparationPresetRef,
      preparationPresetHash: r.selection.preparationPresetHash,
      preparationRequestRef: r.originalCommand.targetRef,
    };
    if (
      !equal(input, expected) ||
      command.type !== 'project.create_preparing_project' ||
      runtimeToken(command.version) !== '1.0' ||
      command.commandId !== r.targets.projectCommandId ||
      !equal(command.targetRef, r.admission.payload.projectRef) ||
      !equal(command.scopeRef, r.originalCommand.scopeRef) ||
      !equal(command.integrity.payloadHash, hash(input))
    )
      fail('PREPARATION_COMMAND_INVALID');
    const member = await config.identity.readMemberPolicy(session, {
      memberPolicyRef: input.memberPolicyRef,
      memberPolicyHash: input.memberPolicyHash,
    });
    if (
      !equal(member.payload.admissionRef, r.admission.admissionRef) ||
      !equal(member.payload.projectRef, r.admission.payload.projectRef)
    )
      fail('PREPARATION_MEMBER_POLICY_INVALID');
    await createProject(session, r, member, selected.payload);
    const p = await requestProof(session, r);
    return transaction(p, command.scopeRef, async (trx) => {
      const receipt = await trx
        .selectFrom('enterprise_project.command_receipt')
        .select(['result_payload'])
        .where('command_id', '=', r.targets.projectCommandId)
        .executeTakeFirst();
      if (!receipt) fail('PREPARATION_RECEIPT_NOT_VISIBLE');
      return receipt.result_payload;
    });
  }
  async function capturePreparationSource(
    session: PreparationSession,
    command: WorkspaceCommandInput<unknown>,
  ) {
    const input = command.payload as {
      projectRef: Common.ObjectRef;
      intakeManifestRef: Ref;
      templateRefs: Common.ContentAddressedRef[];
      ruleBundleRef: Common.SnapshotRef;
      companyRulePublicationRef: Common.ContentAddressedRef;
      trustedDecisionRefs: Ref[];
      purpose: 'preparation.analysis';
      audience: Common.ObjectRef;
      previousReportRef?: Ref;
    };
    if (
      input.previousReportRef ||
      command.type !== 'project.capture_preparation_source' ||
      !equal(command.scopeRef, command.targetRef.scope) ||
      command.targetRef.objectType !== 'zhiju.project.preparation_source' ||
      !equal(command.integrity.payloadHash, hash(input))
    )
      fail('PREPARATION_COMMAND_INVALID');
    const p = await authorized(
      session,
      'project.preparation.source.capture',
      input.projectRef,
      input,
    );
    const rows = await transaction(
      p,
      command.scopeRef,
      async (trx) =>
        (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='HANDOFF' AND payload->>'sourceId'=${command.targetRef.objectId}`.execute(
            trx,
          )
        ).rows,
    );
    const h = rows[0]?.payload as Handoff | undefined;
    if (command.commandId !== h?.sourceCommandId) fail('PREPARATION_SOURCE_BINDING_INVALID');
    return captureSource(session, {
      ...input,
      sourceId: h.sourceId,
      sourceRefs: h.submission.sourceRefs,
      ...(h.submission.noteSourceRef ? { noteSourceRef: h.submission.noteSourceRef } : {}),
    });
  }
  async function verifyProjectCreation(input: {
    requestRef: Common.ObjectRef;
    projectRef: Common.ObjectRef;
    enterpriseRef: Common.ObjectRef;
    preparationPresetRef: Common.VersionedRef;
    preparationPresetHash: Common.ContentHash;
    projectCreationReceiptRef: Common.ObjectRef;
    projectScopeClaimRef: Common.ObjectRef;
  }) {
    if (!config.serviceSession) fail('PREPARATION_SERVICE_UNAVAILABLE');
    const p = await authorized(
      await currentService(),
      'enterprise.project.get_project_board_slice',
      object('Project', input.projectRef.objectId, input.projectRef.scope),
      input,
    );
    return transaction(p, input.requestRef.scope, async (trx) => {
      const request = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='REQUEST' AND identity_key=${input.requestRef.objectId}`.execute(
          trx,
        )
      ).rows[0];
      if (!request) fail('PREPARATION_NOT_VISIBLE');
      const r = request.payload as RequestFact;
      if (
        !equal(r.selection.preparationPresetRef, input.preparationPresetRef) ||
        !equal(r.selection.preparationPresetHash, input.preparationPresetHash) ||
        r.targets.projectCommandId !== input.projectCreationReceiptRef.objectId ||
        r.targets.scopeClaimId !== input.projectScopeClaimRef.objectId ||
        r.originalCommand.scopeRef.projectId !== input.projectRef.objectId ||
        r.originalCommand.scopeRef.enterpriseId !== input.enterpriseRef.objectId
      )
        fail('PREPARATION_CREATION_PROOF_INVALID');
      const project = await trx
        .selectFrom('enterprise_project.project')
        .select(['status'])
        .where('project_id', '=', input.projectRef.objectId)
        .executeTakeFirst();
      const claim = await trx
        .selectFrom('enterprise_project.project_scope_claim')
        .select(['claim_id'])
        .where('claim_id', '=', input.projectScopeClaimRef.objectId)
        .executeTakeFirst();
      const receipt = await trx
        .selectFrom('enterprise_project.command_receipt')
        .select(['outcome'])
        .where('command_id', '=', input.projectCreationReceiptRef.objectId)
        .executeTakeFirst();
      if ((project?.status as string) !== 'PREPARING' || !claim || receipt?.outcome !== 'COMMITTED')
        fail('PREPARATION_CREATION_PROOF_INVALID');
    });
  }
  return {
    publishPreset,
    resolvePreset,
    withdrawPreset,
    findEnterprises,
    request,
    getRequest,
    intakeBinding,
    acceptSource,
    sourceLinks,
    captureSource,
    getSource,
    acceptHandoff,
    continueHandoff,
    queryHandoff,
    verifyProjectCreation,
    createPreparingProject,
    capturePreparationSource,
    boardEntry,
  };
}
