import { newUuidV7, isUuidV7 } from '@zhiju/shared-kernel';
import { sql, type Kysely, type Transaction, type Selectable } from 'kysely';
import {
  PreparationError,
  PREPARATION_SERVICE_AUTHORITY_OPERATIONS,
  preparationHash as hash,
  samePreparationValue as same,
  assertPreparationClosed as closed,
  assertPreparationHash as validHash,
  assertPreparationInstant as instant,
  type Common,
  type PreparationSession,
  type PreparationIdentityPort,
  type PreparationEnrollmentInput,
  type PreparationMembershipTemplate,
  type PreparationAdmission,
  type PreparationAdmissionResult,
  type PreparationAuthorizationProof,
  type PreparationMemberPolicy,
  type PreparationMemberPolicyResult,
  type PreparationProjectCreationProof,
  type PreparationProvisioningResult,
} from '@zhiju/contracts';
import {
  withPreparationTransaction as transaction,
  type PreparationIdentityDb,
  type PreparationFactTable,
} from '../persistence/preparation-db.js';
type Trx = Transaction<PreparationIdentityDb>;
type Fact = Selectable<PreparationFactTable>;
type Stored<T> = T & { kind: string; principalId: string };
export interface PreparationIdentityConfig {
  db: Kysely<PreparationIdentityDb>;
  grantAdministrators: readonly string[];
  administratorPolicySnapshotRef: Common.SnapshotRef;
  servicePrincipalIds: readonly string[];
  enterpriseCapabilities: { select: string; create: string };
  verifySession(session: PreparationSession): Promise<void>;
  /** Must read the EP owning Project/Claim/Receipt; validating supplied JSON is insufficient. */
  verifyProjectCreation(input: PreparationProjectCreationProof): Promise<void>;
  authorizeService(
    session: PreparationSession,
    input: {
      operation: string;
      admissionRef: Common.ContentAddressedRef;
      target: Common.ObjectRef;
      payloadHash: Common.ContentHash;
    },
  ): Promise<void>;
  authorizeCurrentOperation(
    session: PreparationSession,
    operation: string,
    target: Common.ObjectRef,
    payloadHash: Common.ContentHash,
    human?: PreparationSession,
  ): Promise<PreparationAuthorizationProof>;
  clock?: () => Date;
}
const bindings = [
  [
    'project.workspace.discover',
    'project.workspace.discover',
    'project.workspace.discover.v1',
    'zhiju.project.project',
  ],
  [
    'project.get_project_board_slice',
    'enterprise.project.get_project_board_slice',
    'project.get_project_board_slice.v1',
    'zhiju.project.project',
  ],
  [
    'project.get_project_preparation_request',
    'project.preparation.read',
    'project.get_project_preparation_request.v1',
    'zhiju.project.preparation_request',
  ],
  [
    'integration.request_customer_zip_intake',
    'integration.customer_zip.intake',
    'integration.request_customer_zip_intake.v1',
    'zhiju.integration.customer_zip_intake',
  ],
  [
    'integration.get_customer_zip_intake',
    'integration.customer_zip.read',
    'integration.get_customer_zip_intake.v1',
    'zhiju.integration.customer_zip_intake',
  ],
  [
    'integration.restart_customer_zip_upload',
    'integration.customer_zip.restart',
    'integration.restart_customer_zip_upload.v1',
    'zhiju.integration.customer_zip_intake',
  ],
  [
    'project.preparation.analysis.admit',
    'project.preparation.analysis.admit',
    'project.preparation.analysis.admit.v1',
    'zhiju.integration.customer_zip_intake',
  ],
] as const;
export const PREPARATION_CREATOR_BINDINGS = bindings;
export const PREPARATION_ANALYSIS_CREATOR_BINDINGS = [
  ...bindings,
  [
    'project.get_preparation_analysis_report',
    'project.preparation.report.read',
    'project.get_preparation_analysis_report.v1',
    'zhiju.project.project',
  ],
] as const;
export { PREPARATION_SERVICE_AUTHORITY_OPERATIONS } from '@zhiju/contracts';

function operationBinding(value: string): {
  operation: string;
  purpose: string;
  action: string;
  version: '1.0' | '2.0';
} {
  const mapping: Record<string, readonly [string, string, string]> = {
    'project.enterprise.select': [
      'project.find_preparation_enterprises',
      'project.enterprise.select',
      'project.find_preparation_enterprises.v1',
    ],
    'project.source_material.register': [
      'project.register_source_material',
      'project.source_material.register',
      'project.register_source_material.v1',
    ],
    'project.source_material.accept': [
      'project.accept_source_material',
      'project.source_material.accept',
      'project.accept_source_material.v1',
    ],
    'enterprise.project.get_project_board_slice': [
      'project.get_project_board_slice',
      'enterprise.project.get_project_board_slice',
      'project.get_project_board_slice.v1',
    ],
    'project.preparation.source.capture': [
      'project.capture_preparation_source',
      'project.preparation.source.capture',
      'project.capture_preparation_source.v1',
    ],
    'project.preparation.source.read': [
      'project.get_preparation_source',
      'project.preparation.source.read',
      'project.get_preparation_source.v1',
    ],
    'project.preparation.source_v2.capture': [
      'project.capture_preparation_source',
      'project.preparation.source_v2.capture',
      'project.capture_preparation_source.v2',
    ],
    'project.preparation.source_v2.read': [
      'project.get_preparation_source',
      'project.preparation.source_v2.read',
      'project.get_preparation_source.v2',
    ],
    'project.request_project_preparation': [
      'project.request_project_preparation',
      'project.preparation.request',
      'project.request_project_preparation.v1',
    ],
    'project.get_project_preparation_request': [
      'project.get_project_preparation_request',
      'project.preparation.read',
      'project.get_project_preparation_request.v1',
    ],
    'project.create_preparing_project': [
      'project.create_preparing_project',
      'project.project.prepare.create',
      'project.create_preparing_project.v1',
    ],
    'project.create_enterprise': [
      'project.create_enterprise',
      'enterprise.project.create_enterprise',
      'project.create_enterprise.v1',
    ],
  };
  Object.assign(mapping, {
    'execution.preparation.task.create': [
      'execution.create_preparation_analysis_task',
      'execution.preparation.task.create',
      'execution.create_preparation_analysis_task.v1',
    ],
    'execution.preparation.context.build': [
      'execution.build_preparation_context',
      'execution.preparation.context.build',
      'execution.build_preparation_context.v1',
    ],
    'execution.preparation.analysis.request': [
      'execution.request_preparation_analysis',
      'execution.preparation.analysis.request',
      'execution.request_preparation_analysis.v1',
    ],
    'execution.preparation.result.read': [
      'execution.get_preparation_analysis_result',
      'execution.preparation.result.read',
      'execution.get_preparation_analysis_result.v1',
    ],
    'project.preparation.report.accept': [
      'project.accept_preparation_report',
      'project.preparation.report.accept',
      'project.accept_preparation_report.v1',
    ],
    'execution.preparation.process.step': [
      'execution.preparation.process.step',
      'execution.preparation.process.step',
      'execution.preparation.process.step.v1',
    ],
    'project.preparation.report.read': [
      'project.get_preparation_analysis_report',
      'project.preparation.report.read',
      'project.get_preparation_analysis_report.v1',
    ],
  });
  const row = mapping[value];
  return row
    ? {
        operation: row[0],
        purpose: row[1],
        action: row[2],
        version: value.startsWith('project.preparation.source_v2.') ? '2.0' : '1.0',
      }
    : { operation: value, purpose: value, action: value, version: '1.0' };
}
function deny(code = 'AUTHORIZATION_DECISION_INVALID'): never {
  throw new PreparationError(code);
}
function ref(
  id: string,
  type: string,
  payload: unknown,
  scope: Common.ScopeRef = {},
): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: type,
    objectId: id,
    scope,
    contentHash: hash(payload),
  };
}
function object(id: string, type: string, scope: Common.ScopeRef = {}): Common.ObjectRef {
  return { kind: 'OBJECT', objectType: type, objectId: id, scope };
}
function checkRef(
  r: Common.ObjectRef | Common.VersionedRef | Common.ContentAddressedRef | Common.SnapshotRef,
  kind: string,
  type: string,
): void {
  const extra =
    kind === 'VERSIONED'
      ? ['versionId']
      : kind === 'SNAPSHOT'
        ? ['snapshotId', 'contentHash']
        : kind === 'CONTENT_ADDRESSED'
          ? ['contentHash']
          : [];
  closed(r, ['kind', 'objectType', 'objectId', 'scope', ...extra]);
  if (r.kind !== kind || r.objectType !== type || !isUuidV7(r.objectId)) deny('API_VALUE_INVALID');
  if ('contentHash' in r) validHash(r.contentHash);
  if (
    'snapshotId' in r &&
    (typeof r.snapshotId !== 'string' || r.snapshotId !== r.objectId || !isUuidV7(r.snapshotId))
  )
    deny('API_VALUE_INVALID');
  if ('versionId' in r && (typeof r.versionId !== 'string' || !isUuidV7(r.versionId)))
    deny('API_VALUE_INVALID');
}
function templateValid(p: PreparationMembershipTemplate): void {
  closed(p, [
    'profile',
    'templateCode',
    'templateVersion',
    'creatorBindings',
    'grantPolicySnapshotRef',
    'maxGrantLifetimeSeconds',
  ]);
  if (
    !['ip.preparation_membership_template@1.0', 'ip.preparation_membership_template@1.1'].includes(
      p.profile,
    ) ||
    !p.templateCode.trim() ||
    !/^\d+\.\d+\.\d+$/.test(p.templateVersion) ||
    !Number.isSafeInteger(p.maxGrantLifetimeSeconds) ||
    p.maxGrantLifetimeSeconds < 1 ||
    p.creatorBindings.length !==
      (p.profile === 'ip.preparation_membership_template@1.1'
        ? PREPARATION_ANALYSIS_CREATOR_BINDINGS
        : bindings
      ).length
  )
    deny('PREPARATION_TEMPLATE_INVALID');
  const seen = new Set<string>(),
    codes = new Set<string>();
  for (const b of p.creatorBindings) {
    closed(b, ['operation', 'version', 'purpose', 'action', 'capabilityCode', 'targetObjectType']);
    const required = (
      p.profile === 'ip.preparation_membership_template@1.1'
        ? PREPARATION_ANALYSIS_CREATOR_BINDINGS
        : bindings
    ).find((x) => x[0] === b.operation);
    if (
      !required ||
      (b as { version: unknown }).version !== '1.0' ||
      b.purpose !== required[1] ||
      b.action !== required[2] ||
      b.targetObjectType !== required[3] ||
      !/^[a-z][a-z0-9]*(?:[._][a-z0-9]+)*$/.test(b.capabilityCode) ||
      seen.has(b.operation) ||
      codes.has(b.capabilityCode)
    )
      deny('PREPARATION_TEMPLATE_INVALID');
    seen.add(b.operation);
    codes.add(b.capabilityCode);
  }
  if (
    p.creatorBindings.map((b) => b.operation).join('|') !==
    p.creatorBindings
      .map((b) => b.operation)
      .sort()
      .join('|')
  )
    deny('PREPARATION_TEMPLATE_INVALID');
}
export function createPreparationIdentityPort(
  config: PreparationIdentityConfig,
): PreparationIdentityPort {
  const now = config.clock ?? (() => new Date());
  async function session(s: PreparationSession): Promise<void> {
    closed(s, ['principalId', 'authenticationContextHash', 'expiresAt']);
    validHash(s.authenticationContextHash);
    instant(s.expiresAt);
    if (!isUuidV7(s.principalId) || Date.parse(s.expiresAt) <= now().getTime()) deny();
    await config.verifySession(s);
  }
  async function principal(
    t: Trx,
    id: string,
    kind?: 'HUMAN' | 'SERVICE',
  ): Promise<'HUMAN' | 'SERVICE'> {
    const p = await t
      .selectFrom('identity_policy.principal')
      .select(['principal_kind', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (
      p?.status !== 'ACTIVE' ||
      (p.principal_kind !== 'HUMAN' && p.principal_kind !== 'SERVICE') ||
      (kind && p.principal_kind !== kind)
    )
      deny();
    return p.principal_kind;
  }
  async function policy(t: Trx, r: Common.SnapshotRef): Promise<void> {
    checkRef(r, 'SNAPSHOT', 'identity.policy_snapshot');
    const p = await t
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', r.snapshotId)
      .executeTakeFirst();
    if (
      p?.schema_registry_version !== 'im02-static-v1' ||
      p.effective_from > now() ||
      (p.superseded_at && p.superseded_at <= now()) ||
      p.payload_hash.toString('hex') !== r.contentHash.digest ||
      !same(hash(p.canonical_payload), r.contentHash)
    )
      deny();
  }
  async function insert(
    t: Trx,
    id: string,
    kind: string,
    principalId: string,
    payload: Record<string, unknown>,
    parentId: string | null = null,
    scope?: { enterpriseId: string; projectId: string },
  ): Promise<Fact> {
    const stored = { ...payload, kind, principalId, ...(scope ? { scope } : {}) };
    await t
      .insertInto('identity_policy.preparation_fact')
      .values({
        id,
        kind,
        principal_id: principalId,
        parent_id: parentId,
        enterprise_id: scope?.enterpriseId ?? null,
        project_id: scope?.projectId ?? null,
        payload: JSON.stringify(stored),
        payload_hash: Buffer.from(hash(stored).digest, 'hex'),
      })
      .execute();
    return {
      id,
      kind,
      principal_id: principalId,
      parent_id: parentId,
      enterprise_id: scope?.enterpriseId ?? null,
      project_id: scope?.projectId ?? null,
      payload: stored,
      payload_hash: Buffer.from(hash(stored).digest, 'hex'),
    };
  }
  async function fact(t: Trx, id: string, kind: string): Promise<Fact> {
    const f = await t
      .selectFrom('identity_policy.preparation_fact')
      .selectAll()
      .where('id', '=', id)
      .where('kind', '=', kind)
      .executeTakeFirst();
    if (!f) deny();
    if (hash(f.payload).digest !== f.payload_hash.toString('hex')) deny();
    return f;
  }
  function factRef(f: Fact, type: string): Common.ContentAddressedRef {
    return ref(
      f.id,
      type,
      f.payload,
      f.enterprise_id
        ? { enterpriseId: f.enterprise_id, ...(f.project_id ? { projectId: f.project_id } : {}) }
        : {},
    );
  }
  async function provenance(
    t: Trx,
    s: PreparationSession,
    operation: string,
    target: Common.ObjectRef,
    request: unknown,
    grantRef?: Common.ContentAddressedRef | Common.ObjectRef,
    authorityContext?: PreparationAuthorizationProof['context'],
  ): Promise<PreparationAuthorizationProof> {
    const kind = await principal(t, s.principalId);
    const actualContext =
      authorityContext ??
      (kind === 'SERVICE' &&
      ['project.preparation.preset.read', 'project.preparation.analysis_basis.read'].includes(
        operation,
      )
        ? await platformService(t, s, operation, target)
        : undefined);
    const scopedGrant =
      grantRef?.objectType === 'identity.capability_grant'
        ? await t
            .selectFrom('identity_policy.capability_grant')
            .selectAll()
            .where('id', '=', grantRef.objectId)
            .executeTakeFirst()
        : undefined;
    const ownGrant =
      grantRef && !scopedGrant
        ? ((
            await fact(
              t,
              grantRef.objectId,
              grantRef.objectType === 'identity.preparation_bootstrap_grant'
                ? 'BOOTSTRAP'
                : 'ENROLLMENT',
            )
          ).payload as {
            policySnapshotRef: Common.SnapshotRef;
            validUntil?: string;
            effectivePeriod?: { to: string };
          })
        : undefined;
    const policyId =
      actualContext?.policySnapshotId ??
      scopedGrant?.grant_policy_snapshot_id ??
      ownGrant?.policySnapshotRef.snapshotId ??
      config.administratorPolicySnapshotRef.snapshotId;
    const authorityPolicy = await t
      .selectFrom('identity_policy.policy_snapshot')
      .selectAll()
      .where('policy_snapshot_id', '=', policyId)
      .executeTakeFirst();
    if (!authorityPolicy) deny();
    const authorizationContext: PreparationAuthorizationProof['context'] = {
      principalKind: kind,
      policySnapshotId: policyId,
      authorizationDecisionExpiresAt: new Date(
        Math.min(
          Date.parse(s.expiresAt),
          now().getTime() + 300000,
          authorityPolicy.superseded_at?.getTime() ?? Infinity,
          scopedGrant?.valid_to?.getTime() ?? Infinity,
          ownGrant?.validUntil
            ? Date.parse(ownGrant.validUntil)
            : ownGrant?.effectivePeriod?.to
              ? Date.parse(ownGrant.effectivePeriod.to)
              : Infinity,
          actualContext ? Date.parse(actualContext.authorizationDecisionExpiresAt) : Infinity,
        ),
      ).toISOString(),
    };
    const aid = newUuidV7(),
      did = newUuidV7();
    const a = await insert(t, aid, 'ACTOR', s.principalId, {
      principalKind: kind,
      authenticationContextHash: s.authenticationContextHash,
      expiresAt: s.expiresAt,
      scope: target.scope,
    });
    const ar: Common.SnapshotRef = {
      kind: 'SNAPSHOT',
      objectType: 'identity.actor_snapshot',
      objectId: aid,
      snapshotId: aid,
      scope: target.scope,
      contentHash: hash(a.payload),
    };
    const d = await insert(t, did, 'DECISION', s.principalId, {
      actorSnapshotRef: ar,
      ...operationBinding(operation),
      target,
      requestHash: hash(request),
      outcome: 'ALLOW',
      issuedAt: now().toISOString(),
      expiresAt: authorizationContext.authorizationDecisionExpiresAt,
      authorizationContext,
      ...(grantRef ? { grantRef } : {}),
    });
    return {
      context: authorizationContext,
      session: s,
      actorSnapshotRef: ar,
      authorizationDecisionRef: factRef(d, 'identity.authorization_decision'),
    };
  }
  async function receipt(
    t: Trx,
    s: PreparationSession,
    operation: string,
    request: unknown,
    result: unknown,
    proof: PreparationAuthorizationProof,
  ): Promise<Common.ContentAddressedRef> {
    const f = await insert(t, newUuidV7(), 'RECEIPT', s.principalId, {
      operation,
      requestHash: hash(request),
      result,
      ...proof,
    });
    return factRef(f, 'identity.preparation_receipt');
  }
  async function admin(t: Trx, s: PreparationSession): Promise<void> {
    await principal(t, s.principalId, 'HUMAN');
    if (!config.grantAdministrators.includes(s.principalId)) deny();
    await policy(t, config.administratorPolicySnapshotRef);
  }
  async function service(t: Trx, s: PreparationSession): Promise<void> {
    await principal(t, s.principalId, 'SERVICE');
    if (!config.servicePrincipalIds.includes(s.principalId)) deny();
  }
  async function template(
    t: Trx,
    r: Common.VersionedRef,
    h: Common.ContentHash,
  ): Promise<{
    payload: PreparationMembershipTemplate;
    useStatus: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'WITHDRAWN';
    stored: Fact;
  }> {
    checkRef(r, 'VERSIONED', 'identity.policy');
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${r.versionId},0))`.execute(t);
    validHash(h);
    const row = await fact(t, r.versionId, 'TEMPLATE');
    const p = row.payload as Stored<{
      templateId: string;
      versionId: string;
      payload: PreparationMembershipTemplate;
      effectiveFrom: string;
    }>;
    if (p.templateId !== r.objectId || !same(r.scope, {}) || !same(hash(p.payload), h))
      deny('PREPARATION_TEMPLATE_INVALID');
    templateValid(p.payload);
    await policy(t, p.payload.grantPolicySnapshotRef);
    const w = await t
      .selectFrom('identity_policy.preparation_fact')
      .selectAll()
      .where('kind', '=', 'WITHDRAWAL')
      .where('parent_id', '=', row.id)
      .executeTakeFirst();
    const status =
      w && Date.parse((w.payload as { effectiveFrom: string }).effectiveFrom) <= now().getTime()
        ? 'WITHDRAWN'
        : Date.parse(p.effectiveFrom) > now().getTime()
          ? 'NOT_YET_EFFECTIVE'
          : 'USABLE';
    return { payload: p.payload, useStatus: status, stored: row };
  }
  async function enrollment(
    t: Trx,
    f: Fact,
    requireTemplate = true,
  ): Promise<PreparationEnrollmentInput> {
    const p = f.payload as Stored<PreparationEnrollmentInput>;
    if (
      f.kind !== 'ENROLLMENT' ||
      Date.parse(p.effectivePeriod.from) > now().getTime() ||
      Date.parse(p.effectivePeriod.to) <= now().getTime() ||
      (await t
        .selectFrom('identity_policy.preparation_fact')
        .select('id')
        .where('kind', '=', 'REVOCATION')
        .where('parent_id', '=', f.id)
        .executeTakeFirst())
    )
      deny();
    await principal(t, p.principalRef.objectId, 'HUMAN');
    await policy(t, p.policySnapshotRef);
    if (
      requireTemplate &&
      (await template(t, p.membershipTemplateRef, p.membershipTemplateHash)).useStatus !== 'USABLE'
    )
      deny('PREPARATION_DEPENDENCY_STALE');
    return p;
  }
  async function enterprisePermissions(
    t: Trx,
    id: string,
    enterpriseId: string,
  ): Promise<Common.ObjectRef[]> {
    const rows = await t
      .selectFrom('identity_policy.capability_grant')
      .selectAll()
      .where('principal_id', '=', id)
      .where('scope_kind', '=', 'ENTERPRISE')
      .where('enterprise_id', '=', enterpriseId)
      .where('status', '=', 'ACTIVE')
      .where('valid_from', '<=', now())
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', now())]))
      .execute();
    const found: Common.ObjectRef[] = [];
    for (const [cap, action, type] of [
      [
        config.enterpriseCapabilities.select,
        'project.find_preparation_enterprises.v1',
        'zhiju.project.enterprise',
      ],
      [
        config.enterpriseCapabilities.create,
        'project.create_project.v1',
        'zhiju.project.enterprise',
      ],
    ]) {
      let good = false;
      for (const g of rows) {
        if (
          g.capability_code !== cap ||
          !g.actions.includes(action ?? '') ||
          g.max_uses !== null ||
          !same(g.constraints, {}) ||
          !same(g.resource_selectors, [{ selectorType: 'TARGET_TYPE', objectType: type }])
        )
          continue;
        await policy(t, {
          kind: 'SNAPSHOT',
          objectType: 'identity.policy_snapshot',
          objectId: g.grant_policy_snapshot_id,
          snapshotId: g.grant_policy_snapshot_id,
          scope: {},
          contentHash: {
            algorithm: 'SHA-256',
            digest: g.grant_policy_snapshot_hash.toString('hex'),
            canonicalizationVersion: '1',
          },
        });
        found.push(object(g.id, 'identity.capability_grant', { enterpriseId }));
        good = true;
        break;
      }
      if (!good) deny();
    }
    return found;
  }
  async function loadAdmission(
    t: Trx,
    s: PreparationSession,
    r: Common.ContentAddressedRef,
    allowStaleDependencies = false,
  ): Promise<{ f: Fact; p: PreparationAdmission }> {
    checkRef(r, 'CONTENT_ADDRESSED', 'zhiju.identity.preparation_admission');
    const f = await fact(t, r.objectId, 'ADMISSION');
    if (!same(factRef(f, r.objectType), r)) deny();
    const p = (f.payload as Stored<{ admission: PreparationAdmission }>).admission;
    const kind = await principal(t, s.principalId);
    if (kind === 'HUMAN' && p.creatorRef.objectId !== s.principalId) deny();
    if (kind === 'SERVICE') {
      await service(t, s);
      await platformService(
        t,
        s,
        'identity.preparation.admission.read',
        object(p.preparationPresetRef.objectId, 'zhiju.project.preparation_preset'),
      );
    }
    await principal(t, p.creatorRef.objectId, 'HUMAN');
    if (
      kind === 'SERVICE' &&
      !(await t
        .selectFrom('identity_policy.external_identity_link')
        .select('id')
        .where('principal_id', '=', p.creatorRef.objectId)
        .where('status', '=', 'ACTIVE')
        .executeTakeFirst())
    )
      deny();
    if (Date.parse(p.validUntil) <= now().getTime()) deny();
    const e = await enrollment(
      t,
      await fact(t, p.enrollmentGrantRef.objectId, 'ENROLLMENT'),
      !allowStaleDependencies,
    );
    if (
      !same(e.preparationPresetRef, p.preparationPresetRef) ||
      !same(e.preparationPresetHash, p.preparationPresetHash)
    )
      deny();
    if (p.customerMode === 'EXISTING')
      await enterprisePermissions(t, p.creatorRef.objectId, p.enterpriseRef.objectId);
    return { f, p };
  }
  async function result(
    t: Trx,
    f: Fact,
    p: PreparationAdmission,
  ): Promise<PreparationAdmissionResult> {
    const all = await t
      .selectFrom('identity_policy.preparation_fact')
      .selectAll()
      .where('parent_id', '=', f.id)
      .where('kind', '=', 'BOOTSTRAP')
      .where('principal_id', '=', f.principal_id)
      .execute();
    const rp = (f.payload as { receiptRef: Common.ContentAddressedRef }).receiptRef;
    return {
      admissionRef: factRef(f, 'zhiju.identity.preparation_admission'),
      receiptRef: rp,
      grantRefs: all.map((g) => factRef(g, 'identity.preparation_bootstrap_grant')),
      payload: p,
      currentUseStatus: 'USABLE',
      checkedAt: now().toISOString(),
      validUntil: p.validUntil,
    };
  }
  async function platformService(
    t: Trx,
    s: PreparationSession,
    operation: string,
    target: Common.ObjectRef,
  ): Promise<PreparationAuthorizationProof['context'] & { grantRef: Common.ContentAddressedRef }> {
    await service(t, s);
    const rows = await t
      .selectFrom('identity_policy.preparation_fact')
      .selectAll()
      .where('kind', '=', 'GRANT')
      .where('principal_id', '=', s.principalId)
      .execute();
    for (const f of rows) {
      const p = f.payload as {
        operation: string;
        target: Common.ObjectRef;
        policySnapshotRef: Common.SnapshotRef;
        effectivePeriod: { from: string; to: string };
      };
      if (
        p.operation !== operation ||
        !same(p.target, target) ||
        Date.parse(p.effectivePeriod.from) > now().getTime() ||
        Date.parse(p.effectivePeriod.to) <= now().getTime()
      )
        continue;
      if (
        await t
          .selectFrom('identity_policy.preparation_fact')
          .select('id')
          .where('kind', '=', 'REVOCATION')
          .where('parent_id', '=', f.id)
          .executeTakeFirst()
      )
        continue;
      await policy(t, p.policySnapshotRef);
      return {
        grantRef: factRef(f, 'identity.preparation_authority_grant'),
        principalKind: 'SERVICE',
        policySnapshotId: p.policySnapshotRef.snapshotId,
        authorizationDecisionExpiresAt: new Date(
          Math.min(Date.parse(s.expiresAt), Date.parse(p.effectivePeriod.to)),
        ).toISOString(),
      };
    }
    deny();
  }
  async function serviceBootstrap(
    t: Trx,
    s: PreparationSession,
    input: {
      admissionRef?: Common.ContentAddressedRef;
      operation: string;
      target: Common.ObjectRef;
      payloadHash: Common.ContentHash;
    },
    request?: unknown,
  ): Promise<PreparationAuthorizationProof> {
    await service(t, s);
    validHash(input.payloadHash);
    checkRef(input.target, 'OBJECT', input.target.objectType);
    const scope = input.target.scope;
    if (!scope.enterpriseId || !scope.projectId) deny('SCOPE_MISMATCH');
    let admissionRef = input.admissionRef;
    if (!admissionRef) {
      const row = await t
        .selectFrom('identity_policy.preparation_fact')
        .selectAll()
        .where('kind', '=', 'ADMISSION')
        .where(sql<string>`payload->'projectRef'->>'objectId'`, '=', scope.projectId)
        .where(sql<string>`payload->'enterpriseRef'->>'objectId'`, '=', scope.enterpriseId)
        .executeTakeFirst();
      if (!row) deny();
      admissionRef = factRef(row, 'zhiju.identity.preparation_admission');
    }
    // These closed reads preserve existing immutable custody while current
    // service authority, original Human eligibility and enrollment remain required.
    const historicalRead = new Set([
      'project.preparation.source.read',
      'project.preparation.source_v2.read',
      'project.preparation.handoff.read',
      'integration.customer_zip.submission.read',
    ]).has(input.operation);
    const { p } = await loadAdmission(t, s, admissionRef, historicalRead);
    const expected: Record<string, readonly string[]> = {
      'execution.preparation.task.create': ['zhiju.execution.task'],
      'execution.preparation.context.build': ['zhiju.execution.preparation_context'],
      'execution.preparation.analysis.request': ['zhiju.execution.preparation_analysis_request'],
      'execution.preparation.result.read': ['execution.agent_result'],
      'project.preparation.report.accept': ['zhiju.project.preparation_report'],
      'execution.preparation.process.step': ['zhiju.execution.preparation_analysis_request'],

      'identity.preparation.admission.read': ['zhiju.project.preparation_request'],
      'identity.preparation.membership.materialize': ['zhiju.project.project'],
      'identity.preparation.membership.read': ['zhiju.project.project'],
      'identity.preparation.creator_access.provision': ['zhiju.project.project'],
      'project.preparation.intake_binding.read': ['zhiju.project.preparation_request'],
      'project.preparation.creation.read': ['zhiju.project.preparation_request'],
      'project.preparation.handoff.read': ['zhiju.integration.customer_zip_intake'],
      'project.preparation.handoff.continue': ['zhiju.integration.customer_zip_intake'],
      'project.preparation.source.capture': ['zhiju.project.project'],
      'project.preparation.source_v2.capture': ['zhiju.project.project'],
      'project.preparation.source.read': ['zhiju.project.preparation_source'],
      'project.preparation.source_v2.read': ['zhiju.project.preparation_source'],
      'project.source_material.register': ['SourceMaterial'],
      'project.source_material.accept': ['SourceMaterial'],
      'enterprise.project.get_project_board_slice': ['Project'],
      'integration.customer_zip.submission.read': ['zhiju.integration.customer_zip_intake'],
      'identity.preparation.original_analysis.read': ['zhiju.integration.customer_zip_intake'],
    };
    if (
      !expected[input.operation]?.includes(input.target.objectType) ||
      !same(scope, p.projectRef.scope)
    )
      deny();
    if (
      input.target.objectType === 'zhiju.project.preparation_request' &&
      !same(input.target, p.requestRef)
    )
      deny();
    if (
      ['Project', 'zhiju.project.project'].includes(input.target.objectType) &&
      input.target.objectId !== p.projectRef.objectId
    )
      deny();
    const authority = await platformService(
      t,
      s,
      input.operation,
      object(p.preparationPresetRef.objectId, 'zhiju.project.preparation_preset'),
    );
    const policyRef: Common.SnapshotRef = {
      kind: 'SNAPSHOT',
      objectType: 'identity.policy_snapshot',
      objectId: authority.policySnapshotId,
      snapshotId: authority.policySnapshotId,
      scope: {},
      contentHash: {
        algorithm: 'SHA-256',
        digest: (
          await t
            .selectFrom('identity_policy.policy_snapshot')
            .select('payload_hash')
            .where('policy_snapshot_id', '=', authority.policySnapshotId)
            .executeTakeFirstOrThrow()
        ).payload_hash.toString('hex'),
        canonicalizationVersion: '1',
      },
    };
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${admissionRef.objectId + s.principalId + input.operation + input.target.objectId + input.payloadHash.digest},0))`.execute(
      t,
    );
    let priorQuery = t
      .selectFrom('identity_policy.preparation_fact')
      .selectAll()
      .where('kind', '=', 'BOOTSTRAP')
      .where('principal_id', '=', s.principalId)
      .where('parent_id', '=', admissionRef.objectId)
      .where(sql<string>`payload->>'operation'`, '=', input.operation)
      .where(sql<string>`payload->'target'->>'objectId'`, '=', input.target.objectId)
      .where(sql<string>`payload->'payloadHash'->>'digest'`, '=', input.payloadHash.digest);
    const membership = await template(t, p.membershipTemplateRef, p.membershipTemplateHash);
    if (membership.payload.profile === 'ip.preparation_membership_template@1.1') {
      // A fresh current authority proof may mint a new short-lived grant. Never
      // extend an expired grant or treat the longer source lifetime as authority.
      // The legacy membership profile retains its original recovery semantics.
      const requiredUntil = new Date(
        Math.min(Date.parse(authority.authorizationDecisionExpiresAt), Date.parse(p.validUntil)),
      );
      priorQuery = priorQuery.where(
        sql<boolean>`(payload->>'validUntil')::timestamptz >= ${requiredUntil}`,
      );
    }
    const prior = await priorQuery.executeTakeFirst();
    if (prior) {
      const b = prior.payload as {
        serviceAuthorityGrantRef: Common.ContentAddressedRef;
        target: Common.ObjectRef;
        validUntil: string;
      };
      if (
        !same(b.serviceAuthorityGrantRef, authority.grantRef) ||
        !same(b.target, input.target) ||
        Date.parse(b.validUntil) <= now().getTime()
      )
        deny();
    }
    const bootstrap =
      prior ??
      (await insert(
        t,
        newUuidV7(),
        'BOOTSTRAP',
        s.principalId,
        {
          admissionRef,
          operation: input.operation,
          target: input.target,
          payloadHash: input.payloadHash,
          serviceAuthorityGrantRef: authority.grantRef,
          enrollmentGrantRef: p.enrollmentGrantRef,
          policySnapshotRef: policyRef,
          validUntil: new Date(
            Math.min(
              Date.parse(authority.authorizationDecisionExpiresAt),
              Date.parse(p.validUntil),
            ),
          ).toISOString(),
        },
        admissionRef.objectId,
      ));
    return provenance(
      t,
      s,
      input.operation,
      input.target,
      request ?? input,
      factRef(bootstrap, 'identity.preparation_bootstrap_grant'),
      authority,
    );
  }
  async function currentOperation(
    s: PreparationSession,
    operation: string,
    target: Common.ObjectRef,
    payload: unknown,
    human?: PreparationSession,
  ): Promise<PreparationAuthorizationProof | undefined> {
    const platformOps = [
      'project.preparation.analysis_basis.publish',
      'project.preparation.analysis_basis.withdraw',
      'project.preparation.analysis_basis.read',
      'project.preparation.preset.publish',
      'project.preparation.preset.withdraw',
      'project.preparation.preset.read',
    ];
    const scopedOps = [
      'project.preparation.report.read',
      'identity.preparation.membership_template.read',
      'project.preparation.read',
      'integration.customer_zip.intake',
      'project.source_material.register',
      'project.source_material.accept',
      'enterprise.project.get_project_board_slice',
      'project.enterprise.select',
      'project.preparation.binding.read',
      'project.preparation.intake_binding.read',
      'integration.customer_zip.submission.read',
      'project.preparation.creation.read',
      'project.preparation.source.capture',
      'project.preparation.source.read',
      'project.preparation.source_v2.capture',
      'project.preparation.source_v2.read',
      'project.preparation.handoff.read',
      'project.preparation.handoff.continue',
      'project.preparation.handoff.consume',
      'identity.preparation.membership.materialize',
      'identity.preparation.membership.read',
      'identity.preparation.creator_access.provision',
    ];
    if (
      !platformOps.includes(operation) &&
      !scopedOps.includes(operation) &&
      !(PREPARATION_SERVICE_AUTHORITY_OPERATIONS as readonly string[]).includes(operation)
    )
      deny();
    checkRef(target, 'OBJECT', target.objectType);
    await session(s);
    if (human) {
      await session(human);
      if (same(human.principalId, s.principalId)) deny();
    }
    if (operation === 'project.enterprise.select') {
      closed(payload, ['enterpriseRef']);
      if (
        !same(payload.enterpriseRef, target) ||
        target.objectType !== 'zhiju.project.enterprise' ||
        !same(target.scope, { enterpriseId: target.objectId })
      )
        deny();
      return transaction(config.db, s, undefined, async (t) => {
        await principal(t, s.principalId, 'HUMAN');
        const grants = await enterprisePermissions(t, s.principalId, target.objectId);
        const selected = grants[0];
        if (!selected) deny();
        return provenance(t, s, operation, target, payload, selected);
      });
    }
    if (!platformOps.includes(operation) && config.servicePrincipalIds.includes(s.principalId)) {
      return transaction(config.db, s, undefined, (t) =>
        serviceBootstrap(t, s, { operation, target, payloadHash: hash(payload) }, payload),
      );
    }
    if (platformOps.includes(operation)) {
      if (
        !same(target.scope, {}) ||
        !(
          operation.startsWith('project.preparation.analysis_basis.')
            ? [
                operation.endsWith('.withdraw')
                  ? 'zhiju.project.preparation_analysis_basis_publication'
                  : 'zhiju.project.preparation_analysis_basis',
              ]
            : ['zhiju.project.preparation_preset', 'zhiju.project.preparation_preset_publication']
        ).includes(target.objectType)
      )
        deny();
      await transaction(config.db, s, undefined, async (t) => {
        const k = await principal(t, s.principalId);
        if (
          !['project.preparation.preset.read', 'project.preparation.analysis_basis.read'].includes(
            operation,
          )
        ) {
          await admin(t, s);
          return;
        }
        if (k === 'SERVICE') {
          await service(t, s);
          await platformService(t, s, operation, target);
          return;
        }
        if (config.grantAdministrators.includes(s.principalId)) {
          await admin(t, s);
          return;
        }
        // Basis content is resolved by the exactly granted service; preset enrollment is not a platform basis grant.
        if (operation === 'project.preparation.analysis_basis.read') deny();
        const rows = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'ENROLLMENT')
          .where('principal_id', '=', s.principalId)
          .execute();
        for (const f of rows) {
          const p = f.payload as PreparationEnrollmentInput;
          if (p.preparationPresetRef.objectId !== target.objectId) continue;
          try {
            await enrollment(t, f);
            return;
          } catch (e) {
            if (!(e instanceof PreparationError)) throw e;
          }
        }
        deny();
      });
    } else {
      let currentHash = hash(payload);
      if (operation === 'integration.customer_zip.intake') {
        closed(payload, ['intakeRef', 'submissionPayloadHash']);
        if (!same(payload.intakeRef, target)) deny();
        validHash(payload.submissionPayloadHash);
        currentHash = payload.submissionPayloadHash;
      }
      const delegated = await config.authorizeCurrentOperation(
        s,
        operation,
        target,
        currentHash,
        human,
      );
      return delegated;
    }
    return undefined;
  }
  const port: PreparationIdentityPort = {
    async authorizeServiceBootstrap(s, input) {
      closed(input, ['operation', 'target', 'payloadHash'], ['admissionRef']);
      await session(s);
      return transaction(config.db, s, undefined, (t) => serviceBootstrap(t, s, input));
    },
    async grantAuthority(s, input) {
      closed(input, [
        'grantId',
        'principalRef',
        'operation',
        'target',
        'policySnapshotRef',
        'effectivePeriod',
      ]);
      checkRef(input.principalRef, 'OBJECT', 'identity.principal');
      checkRef(
        input.target,
        'OBJECT',
        input.operation === 'identity.preparation.membership_template.read'
          ? 'identity.policy'
          : input.operation === 'project.preparation.analysis_basis.read'
            ? 'zhiju.project.preparation_analysis_basis'
            : 'zhiju.project.preparation_preset',
      );
      closed(input.effectivePeriod, ['from', 'to']);
      instant(input.effectivePeriod.from);
      instant(input.effectivePeriod.to);
      if (
        !isUuidV7(input.grantId) ||
        (![
          'project.preparation.analysis_basis.read',
          'project.preparation.source_v2.capture',
          'project.preparation.source_v2.read',
        ].includes(input.operation) &&
          !(PREPARATION_SERVICE_AUTHORITY_OPERATIONS as readonly string[]).includes(
            input.operation,
          )) ||
        !same(input.target.scope, {}) ||
        !same(input.principalRef.scope, {}) ||
        Date.parse(input.effectivePeriod.to) <=
          Math.max(now().getTime(), Date.parse(input.effectivePeriod.from))
      )
        deny();
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await admin(t, s);
        await principal(t, input.principalRef.objectId, 'SERVICE');
        await policy(t, input.policySnapshotRef);
        const old = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('id', '=', input.grantId)
          .executeTakeFirst();
        if (old) {
          if (!same((old.payload as { input: unknown }).input, input))
            deny('PREPARATION_IDENTITY_CONFLICT');
          return factRef(old, 'identity.preparation_authority_grant');
        }
        const proof = await provenance(
          t,
          s,
          'identity.preparation.authority.grant',
          input.target,
          input,
        );
        return factRef(
          await insert(t, input.grantId, 'GRANT', input.principalRef.objectId, {
            ...input,
            input,
            ...proof,
          }),
          'identity.preparation_authority_grant',
        );
      });
    },
    async revokeAuthority(s, input) {
      closed(input, ['grantRef', 'reasonCode']);
      checkRef(input.grantRef, 'CONTENT_ADDRESSED', 'identity.preparation_authority_grant');
      if (!input.reasonCode.trim()) deny();
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await admin(t, s);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.grantRef.objectId},0))`.execute(
          t,
        );
        const f = await fact(t, input.grantRef.objectId, 'GRANT');
        if (!same(factRef(f, 'identity.preparation_authority_grant'), input.grantRef)) deny();
        const old = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'REVOCATION')
          .where('parent_id', '=', f.id)
          .executeTakeFirst();
        if (old) return factRef(old, 'identity.preparation_receipt');
        const proof = await provenance(
          t,
          s,
          'identity.preparation.authority.revoke',
          object(f.id, 'identity.preparation_authority_grant'),
          input,
        );
        return factRef(
          await insert(t, newUuidV7(), 'REVOCATION', f.principal_id, { ...input, ...proof }, f.id),
          'identity.preparation_receipt',
        );
      });
    },
    async authorizeOperation(s, operation, target, payload, human) {
      const delegated = await currentOperation(s, operation, target, payload, human);
      if (
        delegated &&
        (config.servicePrincipalIds.includes(s.principalId) ||
          operation === 'project.enterprise.select')
      )
        return delegated;
      return transaction(config.db, s, undefined, async (t) =>
        provenance(t, s, operation, target, payload, undefined, delegated?.context),
      );
    },
    async checkOperation(proof, operation, target, payload) {
      await currentOperation(proof.session, operation, target, payload);
      await transaction(config.db, proof.session, undefined, async (t) => {
        const actor = await fact(t, proof.actorSnapshotRef.objectId, 'ACTOR'),
          decision = await fact(t, proof.authorizationDecisionRef.objectId, 'DECISION');
        const a = actor.payload as { authenticationContextHash: Common.ContentHash },
          d = decision.payload as {
            operation: string;
            version: string;
            target: Common.ObjectRef;
            requestHash: Common.ContentHash;
            expiresAt: string;
            actorSnapshotRef: Common.SnapshotRef;
          };
        if (
          actor.principal_id !== proof.session.principalId ||
          decision.principal_id !== proof.session.principalId ||
          !same(hash(actor.payload), proof.actorSnapshotRef.contentHash) ||
          !same(
            factRef(decision, 'identity.authorization_decision'),
            proof.authorizationDecisionRef,
          ) ||
          !same(a.authenticationContextHash, proof.session.authenticationContextHash) ||
          !same(
            (decision.payload as { authorizationContext: unknown }).authorizationContext,
            proof.context,
          ) ||
          d.operation !== operationBinding(operation).operation ||
          d.version !== operationBinding(operation).version ||
          !same(d.target, target) ||
          !same(d.requestHash, hash(payload)) ||
          !same(d.actorSnapshotRef, proof.actorSnapshotRef) ||
          Date.parse(d.expiresAt) <= now().getTime()
        )
          deny();
      });
    },
    async grantEnrollment(s, input) {
      closed(input, [
        'grantId',
        'principalRef',
        'allowedModes',
        'preparationPresetRef',
        'preparationPresetHash',
        'membershipTemplateRef',
        'membershipTemplateHash',
        'policySnapshotRef',
        'effectivePeriod',
        'maxUses',
      ]);
      checkRef(input.principalRef, 'OBJECT', 'identity.principal');
      checkRef(input.preparationPresetRef, 'VERSIONED', 'zhiju.project.preparation_preset');
      validHash(input.preparationPresetHash);
      closed(input.effectivePeriod, ['from', 'to']);
      instant(input.effectivePeriod.from);
      instant(input.effectivePeriod.to);
      if (
        !isUuidV7(input.grantId) ||
        !same(input.principalRef.scope, {}) ||
        !Number.isSafeInteger(input.maxUses) ||
        input.maxUses < 1 ||
        !Array.isArray(input.allowedModes) ||
        !input.allowedModes.length ||
        new Set(input.allowedModes).size !== input.allowedModes.length ||
        input.allowedModes.some((m) => !(['NEW', 'EXISTING'] as unknown[]).includes(m)) ||
        Date.parse(input.effectivePeriod.to) <=
          Math.max(Date.parse(input.effectivePeriod.from), now().getTime())
      )
        deny('API_VALUE_INVALID');
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await admin(t, s);
        await principal(t, input.principalRef.objectId, 'HUMAN');
        await policy(t, input.policySnapshotRef);
        if (
          (await template(t, input.membershipTemplateRef, input.membershipTemplateHash))
            .useStatus !== 'USABLE'
        )
          deny();
        const proof = await provenance(
          t,
          s,
          'identity.preparation.enrollment.grant',
          object(input.grantId, 'identity.preparation_enrollment'),
          input,
        );
        const existing = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('id', '=', input.grantId)
          .executeTakeFirst();
        if (existing) {
          const e = existing.payload as { input: unknown; receiptRef: Common.ContentAddressedRef };
          if (!same(e.input, input)) deny('PREPARATION_IDENTITY_CONFLICT');
          return {
            grantRef: factRef(existing, 'identity.preparation_enrollment'),
            receiptRef: e.receiptRef,
          };
        }
        const rr = await receipt(
          t,
          s,
          'identity.preparation.enrollment.grant',
          input,
          { grantId: input.grantId },
          proof,
        );
        const f = await insert(t, input.grantId, 'ENROLLMENT', input.principalRef.objectId, {
          ...input,
          input,
          administratorActorRef: proof.actorSnapshotRef,
          administratorDecisionRef: proof.authorizationDecisionRef,
          receiptRef: rr,
        });
        await session(s);
        return { grantRef: factRef(f, 'identity.preparation_enrollment'), receiptRef: rr };
      });
    },
    async revokeEnrollment(s, input) {
      closed(input, ['grantRef', 'reasonCode']);
      if (!input.reasonCode.trim()) deny();
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await admin(t, s);
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.grantRef.objectId},0))`.execute(
          t,
        );
        const f = await fact(t, input.grantRef.objectId, 'ENROLLMENT');
        if (!same(factRef(f, 'identity.preparation_enrollment'), input.grantRef)) deny();
        const proof = await provenance(
          t,
          s,
          'identity.preparation.enrollment.revoke',
          object(f.id, 'identity.preparation_enrollment'),
          input,
        );
        const prior = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'REVOCATION')
          .where('parent_id', '=', f.id)
          .executeTakeFirst();
        if (prior) return factRef(prior, 'identity.preparation_receipt');
        const rr = await receipt(
          t,
          s,
          'identity.preparation.enrollment.revoke',
          input,
          { grantRef: input.grantRef },
          proof,
        );
        await insert(
          t,
          newUuidV7(),
          'REVOCATION',
          f.principal_id,
          { ...input, receiptRef: rr, ...proof },
          f.id,
        );
        return rr;
      });
    },
    async publishMembershipTemplate(s, input) {
      closed(input, ['templateId', 'versionId', 'payload', 'effectiveFrom']);
      templateValid(input.payload);
      instant(input.effectiveFrom);
      if (!isUuidV7(input.templateId) || !isUuidV7(input.versionId)) deny();
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await admin(t, s);
        await policy(t, input.payload.grantPolicySnapshotRef);
        const existing = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('id', '=', input.versionId)
          .executeTakeFirst();
        const tr: Common.VersionedRef = {
          kind: 'VERSIONED',
          objectType: 'identity.policy',
          objectId: input.templateId,
          versionId: input.versionId,
          scope: {},
        };
        if (existing) {
          const p = existing.payload as { input: unknown; receiptRef: Common.ContentAddressedRef };
          if (!same(p.input, input)) deny('PREPARATION_IDENTITY_CONFLICT');
          return { templateRef: tr, templateHash: hash(input.payload), receiptRef: p.receiptRef };
        }
        const proof = await provenance(
          t,
          s,
          'identity.preparation.membership_template.publish',
          object(input.templateId, 'identity.policy'),
          input,
        );
        const rr = await receipt(
          t,
          s,
          'identity.preparation.membership_template.publish',
          input,
          { templateRef: tr, templateHash: hash(input.payload) },
          proof,
        );
        await insert(t, input.versionId, 'TEMPLATE', s.principalId, {
          ...input,
          input,
          receiptRef: rr,
          ...proof,
        });
        return { templateRef: tr, templateHash: hash(input.payload), receiptRef: rr };
      });
    },
    async readMembershipTemplate(s, input) {
      closed(input, ['templateRef', 'templateHash']);
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        const kind = await principal(t, s.principalId);
        if (kind === 'SERVICE')
          await platformService(
            t,
            s,
            'identity.preparation.membership_template.read',
            object(input.templateRef.objectId, 'identity.policy'),
          );
        else if (!config.grantAdministrators.includes(s.principalId)) {
          const rows = await t
            .selectFrom('identity_policy.preparation_fact')
            .selectAll()
            .where('kind', '=', 'ENROLLMENT')
            .where('principal_id', '=', s.principalId)
            .execute();
          let ok = false;
          for (const r of rows) {
            const e = r.payload as PreparationEnrollmentInput;
            if (
              same(e.membershipTemplateRef, input.templateRef) &&
              same(e.membershipTemplateHash, input.templateHash)
            ) {
              await enrollment(t, r);
              ok = true;
              break;
            }
          }
          if (!ok) deny();
        }
        if (kind === 'HUMAN' && config.grantAdministrators.includes(s.principalId))
          await admin(t, s);
        const r = await template(t, input.templateRef, input.templateHash);
        return { payload: r.payload, useStatus: r.useStatus, checkedAt: now().toISOString() };
      });
    },
    async withdrawMembershipTemplate(s, input) {
      closed(input, ['templateRef', 'templateHash', 'reasonCode', 'effectiveFrom']);
      instant(input.effectiveFrom);
      if (!input.reasonCode.trim()) deny();
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await admin(t, s);
        const f = (await template(t, input.templateRef, input.templateHash)).stored;
        const prior = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'WITHDRAWAL')
          .where('parent_id', '=', f.id)
          .executeTakeFirst();
        if (prior) {
          const p = prior.payload as { input: unknown; receiptRef: Common.ContentAddressedRef };
          if (!same(p.input, input)) deny('PREPARATION_IDENTITY_CONFLICT');
          return p.receiptRef;
        }
        const proof = await provenance(
          t,
          s,
          'identity.preparation.membership_template.withdraw',
          object(input.templateRef.objectId, 'identity.policy'),
          input,
        );
        const rr = await receipt(
          t,
          s,
          'identity.preparation.membership_template.withdraw',
          input,
          {},
          proof,
        );
        await insert(
          t,
          newUuidV7(),
          'WITHDRAWAL',
          s.principalId,
          { ...input, input, ...proof, receiptRef: rr },
          f.id,
        );
        return rr;
      });
    },
    async discover(s, input) {
      closed(input, ['preparationPresetRef', 'preparationPresetHash']);
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await principal(t, s.principalId, 'HUMAN');
        const rows = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'ENROLLMENT')
          .where('principal_id', '=', s.principalId)
          .execute();
        let allowNew = false,
          allowExisting = false;
        for (const r of rows) {
          try {
            const e = await enrollment(t, r);
            if (
              !same(e.preparationPresetRef, input.preparationPresetRef) ||
              !same(e.preparationPresetHash, input.preparationPresetHash)
            )
              continue;
            const used = await t
              .selectFrom('identity_policy.preparation_fact')
              .select('id')
              .where('parent_id', '=', r.id)
              .where('kind', '=', 'ADMISSION')
              .execute();
            if (used.length >= e.maxUses) continue;
            allowNew ||= e.allowedModes.includes('NEW');
            allowExisting ||= e.allowedModes.includes('EXISTING');
          } catch (e) {
            if (!(e instanceof PreparationError)) throw e;
          }
        }
        await sql.raw('SET LOCAL ROLE identity_preparation_self_reader').execute(t);
        const gs = await t
          .selectFrom('identity_policy.capability_grant')
          .select(['enterprise_id'])
          .where('principal_id', '=', s.principalId)
          .where('scope_kind', '=', 'ENTERPRISE')
          .execute();
        await sql.raw('SET LOCAL ROLE identity_policy_preparation_writer').execute(t);
        const candidates: Common.ObjectRef[] = [];
        if (allowExisting)
          for (const id of [...new Set(gs.map((g) => g.enterprise_id))].sort()) {
            try {
              await enterprisePermissions(t, s.principalId, id);
              candidates.push(object(id, 'zhiju.project.enterprise', { enterpriseId: id }));
            } catch (e) {
              if (!(e instanceof PreparationError)) throw e;
            }
          }
        return {
          newCustomerAllowed: allowNew,
          enterpriseCandidates: candidates,
          sourceWatermarks: hash({
            enrollments: rows.map((r) => r.payload_hash.toString('hex')),
            candidates,
          }),
        };
      });
    },
    async lookupAdmission(s, input) {
      closed(input, ['requestRef', 'originalKey']);
      checkRef(input.requestRef, 'OBJECT', 'zhiju.project.preparation_request');
      if (!input.originalKey.trim()) deny();
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await principal(t, s.principalId, 'HUMAN');
        const f = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'ADMISSION')
          .where('principal_id', '=', s.principalId)
          .where(sql<string>`payload->>'originalKey'`, '=', input.originalKey)
          .where(sql<string>`payload->'requestRef'->>'objectId'`, '=', input.requestRef.objectId)
          .executeTakeFirst();
        if (!f) deny('PREPARATION_NOT_VISIBLE');
        const p = (f.payload as { admission: PreparationAdmission }).admission;
        if (!same(p.requestRef, input.requestRef)) deny();
        await loadAdmission(t, s, factRef(f, 'zhiju.identity.preparation_admission'), true);
        return result(t, f, p);
      });
    },
    async reserve(s, input) {
      closed(input, [
        'requestRef',
        'originalCommandId',
        'originalKey',
        'payloadHash',
        'customerMode',
        'enterpriseRef',
        'projectRef',
        'preparationPresetRef',
        'preparationPresetHash',
      ]);
      checkRef(input.requestRef, 'OBJECT', 'zhiju.project.preparation_request');
      checkRef(input.enterpriseRef, 'OBJECT', 'zhiju.project.enterprise');
      checkRef(input.projectRef, 'OBJECT', 'zhiju.project.project');
      checkRef(input.preparationPresetRef, 'VERSIONED', 'zhiju.project.preparation_preset');
      validHash(input.payloadHash);
      validHash(input.preparationPresetHash);
      const scope = {
        enterpriseId: input.enterpriseRef.objectId,
        projectId: input.projectRef.objectId,
      };
      if (
        !same(input.requestRef.scope, scope) ||
        !same(input.projectRef.scope, scope) ||
        !same(input.enterpriseRef.scope, { enterpriseId: scope.enterpriseId }) ||
        !same(input.preparationPresetRef.scope, {}) ||
        !isUuidV7(input.originalCommandId) ||
        !input.originalKey.trim() ||
        !['NEW', 'EXISTING'].includes(input.customerMode)
      )
        deny('SCOPE_MISMATCH');
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        await principal(t, s.principalId, 'HUMAN');
        await sql`SELECT pg_advisory_xact_lock(hashtextextended(${s.principalId},0))`.execute(t);
        const old = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'ADMISSION')
          .where('principal_id', '=', s.principalId)
          .where(sql<string>`payload->>'originalKey'`, '=', input.originalKey)
          .executeTakeFirst();
        if (old) {
          const stored = old.payload as { input: unknown; admission: PreparationAdmission };
          if (!same(stored.input, input)) deny('PREPARATION_IDENTITY_CONFLICT');
          await loadAdmission(t, s, factRef(old, 'zhiju.identity.preparation_admission'));
          return result(t, old, stored.admission);
        }
        const es = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'ENROLLMENT')
          .where('principal_id', '=', s.principalId)
          .orderBy('id')
          .execute();
        let selected: { f: Fact; e: PreparationEnrollmentInput } | undefined;
        for (const f of es) {
          try {
            const e = await enrollment(t, f);
            if (
              !e.allowedModes.includes(input.customerMode) ||
              !same(e.preparationPresetRef, input.preparationPresetRef) ||
              !same(e.preparationPresetHash, input.preparationPresetHash)
            )
              continue;
            await sql`SELECT pg_advisory_xact_lock(hashtextextended(${f.id},0))`.execute(t);
            const uses = await t
              .selectFrom('identity_policy.preparation_fact')
              .select('id')
              .where('kind', '=', 'ADMISSION')
              .where('parent_id', '=', f.id)
              .execute();
            if (uses.length >= e.maxUses) continue;
            selected = { f, e };
            break;
          } catch (e) {
            if (!(e instanceof PreparationError)) throw e;
          }
        }
        if (!selected) deny();
        const er =
          input.customerMode === 'EXISTING'
            ? await enterprisePermissions(t, s.principalId, scope.enterpriseId)
            : [];
        const aid = newUuidV7();
        const proof = await provenance(
          t,
          s,
          'identity.preparation.admission.reserve',
          input.requestRef,
          input,
          factRef(selected.f, 'identity.preparation_enrollment'),
        );
        const dependencyPolicies = await t
          .selectFrom('identity_policy.policy_snapshot')
          .select('superseded_at')
          .where('policy_snapshot_id', 'in', [
            selected.e.policySnapshotRef.snapshotId,
            (await template(t, selected.e.membershipTemplateRef, selected.e.membershipTemplateHash))
              .payload.grantPolicySnapshotRef.snapshotId,
          ])
          .execute();
        const admissionValidUntil = new Date(
          Math.min(
            Date.parse(selected.e.effectivePeriod.to),
            ...dependencyPolicies.map((d) => d.superseded_at?.getTime() ?? Infinity),
          ),
        ).toISOString();
        const p: PreparationAdmission = {
          ...input,
          creatorRef: object(s.principalId, 'identity.principal'),
          membershipTemplateRef: selected.e.membershipTemplateRef,
          membershipTemplateHash: selected.e.membershipTemplateHash,
          enrollmentGrantRef: factRef(selected.f, 'identity.preparation_enrollment'),
          enterprisePermissionRefs: er,
          actorSnapshotRef: proof.actorSnapshotRef,
          authorizationDecisionRef: proof.authorizationDecisionRef,
          createdAt: now().toISOString(),
          validUntil: admissionValidUntil,
        };
        const rr = await receipt(
          t,
          s,
          'identity.preparation.admission.reserve',
          input,
          { admissionId: aid },
          proof,
        );
        const f = await insert(
          t,
          aid,
          'ADMISSION',
          s.principalId,
          { ...input, input, admission: p, receiptRef: rr },
          selected.f.id,
        );
        for (const [operation, target, purpose] of [
          ['project.request_project_preparation', input.requestRef, 'project.preparation.request'],
          ['project.get_project_preparation_request', input.requestRef, 'project.preparation.read'],
          ['project.create_preparing_project', input.projectRef, 'project.project.prepare.create'],
          ...(input.customerMode === 'NEW'
            ? [
                [
                  'project.create_enterprise',
                  input.enterpriseRef,
                  'enterprise.project.create_enterprise',
                ],
              ]
            : []),
        ] as [string, Common.ObjectRef, string][]) {
          await insert(
            t,
            newUuidV7(),
            'BOOTSTRAP',
            s.principalId,
            {
              operation,
              version: '1.0',
              purpose,
              action: `${operation}.v1`,
              target,
              payloadHash: input.payloadHash,
              enrollmentGrantRef: p.enrollmentGrantRef,
              policySnapshotRef: selected.e.policySnapshotRef,
              actorSnapshotRef: proof.actorSnapshotRef,
              authorizationDecisionRef: proof.authorizationDecisionRef,
              validUntil: p.validUntil,
            },
            aid,
          );
        }
        await session(s);
        await enrollment(t, selected.f);
        return result(t, f, p);
      });
    },
    async revalidate(s, r) {
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        const { f, p } = await loadAdmission(t, s, r);
        return result(t, f, p);
      });
    },
    async authorizeBootstrap(s, input) {
      closed(input, ['admissionRef', 'operation', 'target', 'payloadHash']);
      validHash(input.payloadHash);
      await session(s);
      return transaction(config.db, s, undefined, async (t) => {
        const { f, p } = await loadAdmission(
          t,
          s,
          input.admissionRef,
          input.operation === 'project.get_project_preparation_request',
        );
        if (
          [
            'project.request_project_preparation',
            'project.get_project_preparation_request',
          ].includes(input.operation) &&
          !same(p.payloadHash, input.payloadHash)
        )
          deny();
        const gs = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'BOOTSTRAP')
          .where('principal_id', '=', p.creatorRef.objectId)
          .where('parent_id', '=', f.id)
          .execute();
        const g = gs.find((g) => {
          const b = g.payload as { operation: string; target: Common.ObjectRef };
          return b.operation === input.operation && same(b.target, input.target);
        });
        if (!g) deny();
        const proof = await provenance(
          t,
          s,
          input.operation,
          input.target,
          input,
          factRef(g, 'identity.preparation_bootstrap_grant'),
        );
        return proof;
      });
    },
    async checkBootstrap(proof, input) {
      await session(proof.session);
      return transaction(config.db, proof.session, undefined, async (t) => {
        await loadAdmission(
          t,
          proof.session,
          input.admissionRef,
          input.operation === 'project.get_project_preparation_request',
        );
        const a = await fact(t, proof.actorSnapshotRef.objectId, 'ACTOR'),
          d = await fact(t, proof.authorizationDecisionRef.objectId, 'DECISION');
        const p = d.payload as {
          actorSnapshotRef: Common.SnapshotRef;
          operation: string;
          target: Common.ObjectRef;
          requestHash: Common.ContentHash;
          expiresAt: string;
        };
        if (
          a.principal_id !== proof.session.principalId ||
          d.principal_id !== proof.session.principalId ||
          !same(hash(a.payload), proof.actorSnapshotRef.contentHash) ||
          !same(factRef(d, 'identity.authorization_decision'), proof.authorizationDecisionRef) ||
          !same(p.actorSnapshotRef, proof.actorSnapshotRef) ||
          !same(p.requestHash, hash(input)) ||
          !same(
            (d.payload as { authorizationContext: unknown }).authorizationContext,
            proof.context,
          ) ||
          p.operation !== operationBinding(input.operation).operation ||
          !same(p.target, input.target) ||
          Date.parse(p.expiresAt) <= now().getTime() ||
          !same(
            (a.payload as { authenticationContextHash: Common.ContentHash })
              .authenticationContextHash,
            proof.session.authenticationContextHash,
          )
        )
          deny();
      });
    },
    async materializeMemberPolicy(s, input) {
      closed(input, ['admissionRef', 'templateRef', 'templateHash', 'memberPolicyId', 'versionId']);
      if (!isUuidV7(input.memberPolicyId) || !isUuidV7(input.versionId)) deny();
      await session(s);
      const a = await port.revalidate(s, input.admissionRef);
      if (
        !same(input.templateRef, a.payload.membershipTemplateRef) ||
        !same(input.templateHash, a.payload.membershipTemplateHash)
      )
        deny();
      const templateRead = await port.readMembershipTemplate(s, {
        templateRef: input.templateRef,
        templateHash: input.templateHash,
      });
      if (templateRead.useStatus !== 'USABLE') deny();
      const scope = {
        enterpriseId: a.payload.enterpriseRef.objectId,
        projectId: a.payload.projectRef.objectId,
      };
      const p: PreparationMemberPolicy = {
        profile: 'ip.preparation_membership@1.0',
        templateRef: input.templateRef,
        templateHash: input.templateHash,
        admissionRef: input.admissionRef,
        creatorRef: a.payload.creatorRef,
        enterpriseRef: a.payload.enterpriseRef,
        projectRef: a.payload.projectRef,
        creatorBindings: templateRead.payload.creatorBindings,
        grantPolicySnapshotRef: templateRead.payload.grantPolicySnapshotRef,
        validUntil: new Date(
          Math.min(
            Date.parse(a.validUntil),
            now().getTime() + templateRead.payload.maxGrantLifetimeSeconds * 1000,
          ),
        ).toISOString(),
      };
      const serviceProof = await port.authorizeServiceBootstrap(s, {
        admissionRef: input.admissionRef,
        operation: 'identity.preparation.membership.materialize',
        target: a.payload.projectRef,
        payloadHash: hash(input),
      });
      return transaction(config.db, s, scope, async (t) => {
        await service(t, s);
        await policy(t, p.grantPolicySnapshotRef);
        const existing = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'MEMBER_POLICY')
          .where('parent_id', '=', input.admissionRef.objectId)
          .executeTakeFirst();
        if (existing) {
          const v = existing.payload as { input: unknown; result: PreparationMemberPolicyResult };
          if (!same(v.input, input)) deny('PREPARATION_IDENTITY_CONFLICT');
          return v.result;
        }
        const mr: Common.VersionedRef = {
          kind: 'VERSIONED',
          objectType: 'identity.policy',
          objectId: input.memberPolicyId,
          versionId: input.versionId,
          scope: { enterpriseId: scope.enterpriseId },
        };
        const receiptFact = await insert(
          t,
          newUuidV7(),
          'RECEIPT',
          s.principalId,
          { operation: 'identity.preparation.membership.materialize', input, ...serviceProof },
          null,
          scope,
        );
        const rr = factRef(receiptFact, 'identity.preparation_receipt');
        const r = { memberPolicyRef: mr, memberPolicyHash: hash(p), payload: p, receiptRef: rr };
        await insert(
          t,
          input.versionId,
          'MEMBER_POLICY',
          s.principalId,
          { input, payload: p, result: r, ...serviceProof },
          input.admissionRef.objectId,
          scope,
        );
        await session(s);
        return r;
      });
    },
    async readMemberPolicy(s, input) {
      closed(input, ['memberPolicyRef', 'memberPolicyHash']);
      await session(s);
      checkRef(input.memberPolicyRef, 'VERSIONED', 'identity.policy');
      const enterpriseId = input.memberPolicyRef.scope.enterpriseId;
      if (!enterpriseId) deny();
      /* Resolve exact project only through original admission, never a caller selector. */ const admissions =
        await transaction(config.db, s, undefined, async (t) => {
          const rows = await t
            .selectFrom('identity_policy.preparation_fact')
            .selectAll()
            .where('kind', '=', 'ADMISSION')
            .execute();
          return rows.filter((r) => {
            const p = (r.payload as { admission: PreparationAdmission }).admission;
            return (
              p.enterpriseRef.objectId === enterpriseId &&
              (p.creatorRef.objectId === s.principalId ||
                config.servicePrincipalIds.includes(s.principalId))
            );
          });
        });
      for (const af of admissions) {
        const ar = factRef(af, 'zhiju.identity.preparation_admission');
        const a = await port.revalidate(s, ar);
        const scope = { enterpriseId, projectId: a.payload.projectRef.objectId };
        const found = await transaction(config.db, s, scope, async (t) =>
          t
            .selectFrom('identity_policy.preparation_fact')
            .selectAll()
            .where('kind', '=', 'MEMBER_POLICY')
            .where('id', '=', input.memberPolicyRef.versionId)
            .executeTakeFirst(),
        );
        if (found) {
          if (config.servicePrincipalIds.includes(s.principalId))
            await port.authorizeServiceBootstrap(s, {
              admissionRef: ar,
              operation: 'identity.preparation.membership.read',
              target: a.payload.projectRef,
              payloadHash: hash(input),
            });
          const r = (found.payload as { result: PreparationMemberPolicyResult }).result;
          if (
            !same(r.memberPolicyRef, input.memberPolicyRef) ||
            !same(r.memberPolicyHash, input.memberPolicyHash) ||
            !same(hash(r.payload), input.memberPolicyHash) ||
            Date.parse(r.payload.validUntil) <= now().getTime()
          )
            deny();
          return r;
        }
      }
      deny();
    },
    async provisionCreatorAccess(s, input) {
      closed(input, [
        'admissionRef',
        'memberPolicyRef',
        'memberPolicyHash',
        'projectCreationReceiptRef',
        'projectScopeClaimRef',
      ]);
      await session(s);
      const a = await port.revalidate(s, input.admissionRef),
        m = await port.readMemberPolicy(s, {
          memberPolicyRef: input.memberPolicyRef,
          memberPolicyHash: input.memberPolicyHash,
        });
      if (!same(m.payload.admissionRef, input.admissionRef)) deny();
      await config.verifyProjectCreation({
        requestRef: a.payload.requestRef,
        enterpriseRef: a.payload.enterpriseRef,
        projectRef: a.payload.projectRef,
        preparationPresetRef: a.payload.preparationPresetRef,
        preparationPresetHash: a.payload.preparationPresetHash,
        projectCreationReceiptRef: input.projectCreationReceiptRef,
        projectScopeClaimRef: input.projectScopeClaimRef,
      });
      const scope = {
        enterpriseId: a.payload.enterpriseRef.objectId,
        projectId: a.payload.projectRef.objectId,
      };
      for (const b of m.payload.creatorBindings) {
        const serviceProof = await port.authorizeServiceBootstrap(s, {
          admissionRef: input.admissionRef,
          operation: 'identity.preparation.creator_access.provision',
          target: a.payload.projectRef,
          payloadHash: hash(input),
        });
        await port.revalidate(s, input.admissionRef);
        await session(s);
        await transaction(config.db, s, scope, async (t) => {
          await service(t, s);
          await principal(t, a.payload.creatorRef.objectId, 'HUMAN');
          await policy(t, m.payload.grantPolicySnapshotRef);
          await sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.admissionRef.objectId + b.operation},0))`.execute(
            t,
          );
          const old = await t
            .selectFrom('identity_policy.preparation_fact')
            .selectAll()
            .where('kind', '=', 'PROVISIONING')
            .where('parent_id', '=', input.admissionRef.objectId)
            .where(sql<string>`payload->>'operation'`, '=', b.operation)
            .executeTakeFirst();
          if (old) return;
          const gid = newUuidV7();
          await t
            .insertInto('identity_policy.capability_grant')
            .values({
              id: gid,
              principal_id: a.payload.creatorRef.objectId,
              capability_code: b.capabilityCode,
              scope_kind: 'PROJECT',
              enterprise_id: scope.enterpriseId,
              project_id: scope.projectId,
              resource_selectors: JSON.stringify([
                {
                  selectorType:
                    b.operation === 'integration.request_customer_zip_intake'
                      ? 'CREATE_TARGET_TYPE'
                      : 'TARGET_TYPE',
                  objectType: b.targetObjectType,
                },
                ...(b.operation === 'integration.get_customer_zip_intake'
                  ? [
                      {
                        selectorType: 'TARGET_TYPE',
                        objectType: 'zhiju.project.preparation_request',
                      },
                    ]
                  : []),
              ]),
              actions: [b.action],
              valid_from: now(),
              valid_to: new Date(m.payload.validUntil),
              max_uses: null,
              grant_policy_snapshot_id: m.payload.grantPolicySnapshotRef.snapshotId,
              grant_policy_snapshot_hash: Buffer.from(
                m.payload.grantPolicySnapshotRef.contentHash.digest,
                'hex',
              ),
              justification: 'Preparation creator membership',
              created_by_principal_id: s.principalId,
              created_by_actor_snapshot_id: serviceProof.actorSnapshotRef.objectId,
            })
            .execute();
          await insert(
            t,
            newUuidV7(),
            'PROVISIONING',
            a.payload.creatorRef.objectId,
            {
              operation: b.operation,
              ...serviceProof,
              grantRef: object(gid, 'identity.capability_grant', scope),
              memberPolicyRef: input.memberPolicyRef,
              memberPolicyHash: input.memberPolicyHash,
              projectCreationReceiptRef: input.projectCreationReceiptRef,
              projectScopeClaimRef: input.projectScopeClaimRef,
            },
            input.admissionRef.objectId,
            scope,
          );
        });
      }
      return port.currentCreatorAccess(s, input.admissionRef);
    },
    async currentCreatorAccess(s, r) {
      await session(s);
      const a = await transaction(config.db, s, undefined, async (t) => {
        const { f, p } = await loadAdmission(t, s, r, true);
        return result(t, f, p);
      });
      const scope = {
        enterpriseId: a.payload.enterpriseRef.objectId,
        projectId: a.payload.projectRef.objectId,
      };
      return transaction(config.db, s, scope, async (t) => {
        const fs = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'PROVISIONING')
          .where('parent_id', '=', r.objectId)
          .execute();
        const steps = fs.map((f) => f.payload as { operation: string; grantRef: Common.ObjectRef });
        const memberPolicy = await t
          .selectFrom('identity_policy.preparation_fact')
          .selectAll()
          .where('kind', '=', 'MEMBER_POLICY')
          .where('parent_id', '=', r.objectId)
          .executeTakeFirst();
        const membership = memberPolicy
          ? (memberPolicy.payload as { payload: PreparationMemberPolicy }).payload
          : undefined;
        if (
          membership &&
          (!same(membership.admissionRef, r) ||
            !same(membership.templateRef, a.payload.membershipTemplateRef) ||
            !same(membership.templateHash, a.payload.membershipTemplateHash))
        )
          deny();
        const expected = membership?.creatorBindings.map((binding) => binding.operation) ?? [];
        const complete =
          expected.length > 0 &&
          steps.length === expected.length &&
          expected.every(
            (operation) => steps.filter((step) => step.operation === operation).length === 1,
          );
        let revoked = false;
        for (const step of steps) {
          const g = await t
            .selectFrom('identity_policy.capability_grant')
            .selectAll()
            .where('id', '=', step.grantRef.objectId)
            .executeTakeFirst();
          if (
            g?.status !== 'ACTIVE' ||
            g.valid_from > now() ||
            (g.valid_to && g.valid_to <= now())
          ) {
            revoked = true;
            continue;
          }
          await policy(t, {
            kind: 'SNAPSHOT',
            objectType: 'identity.policy_snapshot',
            objectId: g.grant_policy_snapshot_id,
            snapshotId: g.grant_policy_snapshot_id,
            scope: {},
            contentHash: {
              algorithm: 'SHA-256',
              digest: g.grant_policy_snapshot_hash.toString('hex'),
              canonicalizationVersion: '1',
            },
          });
        }
        const out: PreparationProvisioningResult = {
          provisioningReceiptRef: fs.length
            ? factRef(fs.at(-1) as Fact, 'identity.preparation_receipt')
            : a.receiptRef,
          grantRefs: steps.map((x) => x.grantRef),
          steps: steps.map((x) => ({ operation: x.operation, grantRef: x.grantRef })),
          access: revoked ? 'REVOKED' : complete ? 'COMPLETE' : 'INCOMPLETE',
          checkedAt: now().toISOString(),
        };
        return out;
      });
    },
  };
  return port;
}
