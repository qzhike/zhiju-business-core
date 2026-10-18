// Owning command regression with an offline SQL transport; not PostgreSQL/RLS evidence.
import { readFileSync } from 'node:fs';
import { Kysely, PostgresDialect } from 'kysely';
import type { EnterpriseProjectDb } from '../persistence/enterprise-db.js';
import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash as hash,
  type Common,
  type PreparationAuthorizationProof,
  type TemplatePreparationPresetPayload,
} from '@zhiju/contracts';
import {
  createPreparationProjectService,
  type PreparationProjectConfig,
} from './preparation-project.js';

const object = (
  objectType: string,
  objectId: string,
  scope: Common.ScopeRef = {},
): Common.ObjectRef => ({ kind: 'OBJECT', objectType, objectId, scope });
const version = (type: string): Common.VersionedRef => ({
  ...object(type, newUuidV7()),
  kind: 'VERSIONED',
  versionId: newUuidV7(),
});
const content = (
  type: string,
  id: string,
  payload: unknown,
  scope: Common.ScopeRef = {},
): Common.ContentAddressedRef => ({
  ...object(type, id, scope),
  kind: 'CONTENT_ADDRESSED',
  contentHash: hash(payload),
});
const fact = (id: string, kind: string, payload: unknown) => ({
  id,
  kind,
  payload,
  payload_hash: Buffer.from(hash(payload).digest, 'hex'),
});
interface SourceInput {
  projectRef: Common.ObjectRef;
  intakeManifestRef: Common.SnapshotRef;
  templateRefs: Common.ContentAddressedRef[];
  analysisBasisRef: Common.VersionedRef;
  analysisBasisHash: Common.ContentHash;
  analysisBasisPublicationRef: Common.ContentAddressedRef;
  trustedDecisionRefs: Common.TypedReference[];
  purpose: 'preparation.analysis';
  audience: Common.ObjectRef;
}
function setup(status: string | undefined) {
  const input = JSON.parse(
    readFileSync(
      new URL(
        '../../../../tests/fixtures/contracts/template-preparation/source-v2.payload.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as SourceInput;
  const { enterpriseId, projectId } = input.projectRef.scope;
  if (!enterpriseId || !projectId) throw new Error('Project fixture scope is incomplete');
  const scope = { enterpriseId, projectId },
    sourceId = newUuidV7(),
    commandId = newUuidV7();
  const intakeRef = object('zhiju.integration.customer_zip_intake', newUuidV7(), scope);
  const material = content('SourceMaterial', newUuidV7(), { bytes: 'customer' }, scope);
  const preset: TemplatePreparationPresetPayload = {
    profile: 'ep.preparation_entry@1.1',
    presetCode: 'controlled.offline',
    presetVersion: '1.0.0',
    creation: {
      mode: 'PREPARATION',
      status: 'PREPARING',
      enterpriseInitialStatus: 'ACTIVE',
      objective: 'Controlled source guard test',
      enterpriseCodePrefix: 'E',
      projectCodePrefix: 'P',
    },
    memberPolicyTemplate: { ref: version('identity.policy'), payloadHash: hash({}) },
    intakePolicy: { ref: version('zhiju.integration.customer_zip_policy'), payloadHash: hash({}) },
    analysisBasis: {
      basisRef: input.analysisBasisRef,
      basisHash: input.analysisBasisHash,
      publicationRef: input.analysisBasisPublicationRef,
    },
    analysisHandoff: {
      intent: 'ANALYZE',
      analysisProfileRef: version('zhiju.task.analysis_profile'),
      expectedReportProfileRef: version('zhiju.project.report_profile'),
    },
  };
  const presetRef = version('zhiju.project.preparation_preset'),
    publicationId = newUuidV7();
  const publication = {
    preparationPresetRef: presetRef,
    preparationPresetHash: hash(preset),
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  };
  const selection = {
    preparationPresetRef: presetRef,
    preparationPresetHash: hash(preset),
    publicationRef: content(
      'zhiju.project.preparation_preset_publication',
      publicationId,
      publication,
    ),
  };
  const handoff = {
    sourceId,
    sourceCommandId: commandId,
    selection,
    submission: {
      projectRef: input.projectRef,
      manifestRef: input.intakeManifestRef,
      sourceRefs: [material],
      intakeRef,
    },
  };
  const observed = {
    projectStatus: status,
    projectReads: 0,
    projectQuery: '',
    sourceWrites: 0,
    receiptWrites: 0,
  };
  let receipt: Record<string, unknown> | undefined;
  let source: ReturnType<typeof fact> | undefined;
  const client = {
    release() {
      /* Offline transport owns no connection. */
    },
    query(query: string | { text: string; values?: unknown[] }, values?: unknown[]) {
      const text = typeof query === 'string' ? query : query.text;
      const parameters = (typeof query === 'string' ? values : query.values) ?? [];
      let rows: unknown[] = [];
      if (text.includes("kind='HANDOFF'")) rows = [fact(intakeRef.objectId, 'HANDOFF', handoff)];
      else if (text.includes("kind='PRESET'")) rows = [fact(presetRef.versionId, 'PRESET', preset)];
      else if (text.includes("kind='PUBLICATION' AND id="))
        rows = [fact(publicationId, 'PUBLICATION', publication)];
      else if (text.includes("kind='SOURCE' AND identity_key=")) rows = source ? [source] : [];
      else if (text.includes('from "enterprise_project"."source_material"'))
        rows = [
          {
            custody_status: 'ACCEPTED',
            content_hash: Buffer.from(material.contentHash.digest, 'hex'),
            byte_length: '8',
            accepted_object_ref: { key: 'customer-zip/controlled' },
          },
        ];
      else if (text.includes('from "enterprise_project"."project"')) {
        observed.projectReads++;
        observed.projectQuery = text;
        expect(parameters).toContain(scope.enterpriseId);
        expect(parameters).toContain(scope.projectId);
        rows = observed.projectStatus === undefined ? [] : [{ status: observed.projectStatus }];
      } else if (text.startsWith('insert into "enterprise_project"."command_receipt"')) {
        observed.receiptWrites++;
        const keys = [...text.slice(0, text.indexOf('values')).matchAll(/"([a-z_]+)"/g)]
          .map((match) => match[1])
          .slice(2);
        receipt = Object.fromEntries(keys.map((key, i) => [key, parameters[i]]));
      } else if (text.includes('from "enterprise_project"."command_receipt"'))
        rows = receipt ? [receipt] : [];
      else if (text.startsWith('INSERT INTO enterprise_project.preparation_fact')) {
        observed.sourceWrites++;
        source = fact(sourceId, 'SOURCE', JSON.parse(String(parameters[5])) as unknown);
      }
      return Promise.resolve({ rows, command: 'SELECT', rowCount: rows.length });
    },
  };
  const pool = { connect: () => Promise.resolve(client), end: () => Promise.resolve() };
  const db = new Kysely<EnterpriseProjectDb>({
    dialect: new PostgresDialect({
      pool: pool as unknown as ConstructorParameters<typeof PostgresDialect>[0]['pool'],
    }),
  });
  const session = {
    principalId: newUuidV7(),
    authenticationContextHash: hash({ offline: true }),
    expiresAt: '2099-01-01T00:00:00.000Z',
  };
  const actorId = newUuidV7();
  const proof: PreparationAuthorizationProof = {
    session,
    context: {
      principalKind: 'SERVICE',
      policySnapshotId: newUuidV7(),
      authorizationDecisionExpiresAt: session.expiresAt,
    },
    actorSnapshotRef: {
      ...object('identity.actor_snapshot', actorId),
      kind: 'SNAPSHOT',
      snapshotId: actorId,
      contentHash: hash({}),
    },
    authorizationDecisionRef: content('identity.authorization_decision', newUuidV7(), {}),
  };
  const service = createPreparationProjectService({
    db,
    identity: {} as PreparationProjectConfig['identity'],
    verifySession: () => Promise.resolve(),
    authorize: () => Promise.resolve(proof),
    check: () => Promise.resolve(),
    selection,
    cursorKey: Buffer.alloc(32),
    analysisAudience: input.audience,
    validateDependencies: () =>
      Promise.resolve({
        templateRefs: input.templateRefs,
        requirementRefs: [],
        sourceWatermarks: [],
      }),
  });
  const command = {
    commandId,
    type: 'project.capture_preparation_source',
    version: '2.0' as const,
    scopeRef: scope,
    targetRef: object('zhiju.project.preparation_source', sourceId, scope),
    payload: input,
    idempotencyKey: 'controlled:' + sourceId,
    correlationId: newUuidV7(),
    requestedAt: new Date().toISOString(),
    integrity: { canonicalizationVersion: '1' as const, payloadHash: hash(input) },
  };
  return {
    observed,
    capture: () => service.capturePreparationSourceV2(session, command),
    close: () => db.destroy(),
  };
}
describe('preparation source v2 owning Project guard', () => {
  it.each(['ACTIVE', 'COMPLETED', undefined])(
    'rejects %s before writing a new source or receipt',
    async (status) => {
      const fixture = setup(status);
      try {
        await expect(fixture.capture()).rejects.toMatchObject({
          code: 'PREPARATION_SOURCE_PROJECT_INVALID',
        });
        expect(fixture.observed.projectReads).toBe(1);
        expect(fixture.observed.projectQuery).toContain('for share');
        expect(fixture.observed.sourceWrites).toBe(0);
        expect(fixture.observed.receiptWrites).toBe(0);
      } finally {
        await fixture.close();
      }
    },
  );
  it('captures PREPARING once and preserves the exact historical receipt after a later state change', async () => {
    const fixture = setup('PREPARING');
    try {
      const first = await fixture.capture();
      expect(fixture.observed.sourceWrites).toBe(1);
      expect(fixture.observed.receiptWrites).toBe(1);
      fixture.observed.projectStatus = 'ACTIVE';
      expect(await fixture.capture()).toEqual(first);
      expect(fixture.observed.projectReads).toBe(1);
      expect(fixture.observed.sourceWrites).toBe(1);
      expect(fixture.observed.receiptWrites).toBe(1);
    } finally {
      await fixture.close();
    }
  });
});
