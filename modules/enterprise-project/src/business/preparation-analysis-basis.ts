import { createHash } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { isUuidV7, newUuidV7 } from '@zhiju/shared-kernel';
import {
  PreparationError,
  preparationHash,
  samePreparationValue,
  assertPreparationInstant,
  assertPreparationClosed,
  assertPreparationAnalysisBasis,
  assertPreparationAnalysisBasisSelection,
  type Common,
  type PreparationSession,
  type PreparationAuthorizationProof,
  type PreparationAnalysisBasisPayload,
  type PreparationAnalysisBasisSelection,
} from '@zhiju/contracts';
import {
  withEnterpriseProjectTransaction,
  type EnterpriseProjectDb,
} from '../persistence/enterprise-db.js';

const PLATFORM = '00000000-0000-7000-8000-000000000000';
const PURPOSE = 'project.preparation.analysis_basis.';
const TYPE = 'zhiju.project.preparation_analysis_basis';
type Trx = Parameters<Parameters<typeof withEnterpriseProjectTransaction>[2]>[0];
interface Fact {
  id: string;
  kind: string;
  identity_key: string;
  payload: unknown;
  payload_hash: Buffer;
  recorded_at: Date;
}
interface Publication extends PreparationAnalysisBasisSelection {
  effectiveFrom: string;
  actorSnapshotRef: Common.SnapshotRef;
  authorizationDecisionRef: Common.ContentAddressedRef;
  supersedesPublicationRef?: Common.ContentAddressedRef;
}
type PublicationPayload = Omit<Publication, 'publicationRef'>;
export interface PreparationAnalysisBasisPublishInput {
  basisId: string;
  versionId: string;
  payload: PreparationAnalysisBasisPayload;
  effectiveFrom: string;
  supersedesPublicationRef?: Common.ContentAddressedRef;
}
export interface PreparationAnalysisBasisConfig {
  db: Kysely<EnterpriseProjectDb>;
  authorize(
    session: PreparationSession,
    purpose: string,
    target: Common.ObjectRef,
    payload: unknown,
  ): Promise<PreparationAuthorizationProof>;
  check(
    proof: PreparationAuthorizationProof,
    purpose: string,
    target: Common.ObjectRef,
    payload: unknown,
  ): Promise<void>;
  sources: {
    readTemplate(ref: Common.ContentAddressedRef): Promise<Uint8Array>;
    readInstruction(bytesSha256: string): Promise<Uint8Array>;
    locate(bytes: Buffer, locator: string): Promise<readonly Buffer[]>;
  };
  /** Company-defined vocabulary, requirement codes and exact deployed report Schema. */
  validateDefinition(payload: PreparationAnalysisBasisPayload): void;
  clock?: () => Date;
}
function fail(code: string): never {
  throw new PreparationError(code);
}
const hash = preparationHash;
const equal = samePreparationValue;
const object = (type: string, id: string): Common.ObjectRef => ({
  kind: 'OBJECT',
  objectType: type,
  objectId: id,
  scope: {},
});
const content = (type: string, id: string, payload: unknown): Common.ContentAddressedRef => ({
  ...object(type, id),
  kind: 'CONTENT_ADDRESSED',
  contentHash: hash(payload),
});
function validInstant(v: unknown) {
  assertPreparationInstant(v);
}
function validFact(row: Fact | undefined): Fact {
  if (!row) fail('PREPARATION_ANALYSIS_BASIS_NOT_FOUND');
  if (hash(row.payload).digest !== row.payload_hash.toString('hex'))
    fail('PREPARATION_PERSISTED_HASH_MISMATCH');
  return row;
}
/** EP owns immutable template-analysis versions; no regulatory publication is synthesized. */
export function createPreparationAnalysisBasisService(config: PreparationAnalysisBasisConfig) {
  const now = config.clock ?? (() => new Date());
  async function transaction<T>(p: PreparationAuthorizationProof, fn: (trx: Trx) => Promise<T>) {
    return withEnterpriseProjectTransaction(
      config.db,
      {
        kind: 'REQUEST',
        principalId: p.session.principalId,
        principalKind: p.context.principalKind,
        actorSnapshotId: p.actorSnapshotRef.objectId,
        authorizationDecisionId: p.authorizationDecisionRef.objectId,
        authorizationDecisionHash: Buffer.from(
          p.authorizationDecisionRef.contentHash.digest,
          'hex',
        ),
        authorizationDecisionExpiresAt: new Date(p.context.authorizationDecisionExpiresAt),
        policySnapshotId: p.context.policySnapshotId,
        enterpriseId: PLATFORM,
        allowedProjectIds: [],
        correlationId: newUuidV7(),
      },
      fn,
    );
  }
  async function row(trx: Trx, kind: string, id: string) {
    return validFact(
      (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind=${kind} AND id=${id}`.execute(
          trx,
        )
      ).rows[0],
    );
  }
  async function insert(
    trx: Trx,
    proof: PreparationAuthorizationProof,
    id: string,
    kind: string,
    key: string,
    payload: unknown,
  ) {
    await sql`INSERT INTO enterprise_project.preparation_fact(id,kind,enterprise_id,creator_id,identity_key,payload,payload_hash,actor_ref,decision_ref)
      VALUES(${id},${kind},${PLATFORM},${proof.session.principalId},${key},${JSON.stringify(payload)}::jsonb,${Buffer.from(hash(payload).digest, 'hex')},${JSON.stringify(proof.actorSnapshotRef)}::jsonb,${JSON.stringify(proof.authorizationDecisionRef)}::jsonb)`.execute(
      trx,
    );
  }
  async function receipt(
    trx: Trx,
    proof: PreparationAuthorizationProof,
    id: string,
    op: string,
    target: Common.ObjectRef,
    request: unknown,
    result: unknown,
  ) {
    await trx
      .insertInto('enterprise_project.command_receipt')
      .values({
        command_id: id,
        command_type: op,
        command_version: '1.0',
        idempotency_scope: PLATFORM,
        idempotency_key: op + ':1.0:' + id,
        request_payload_hash: Buffer.from(hash(request).digest, 'hex'),
        enterprise_id: PLATFORM,
        project_id: null,
        target_type: target.objectType,
        target_id: target.objectId,
        outcome: 'COMMITTED',
        result_payload: JSON.stringify(result),
        result_payload_hash: Buffer.from(hash(result).digest, 'hex'),
        completed_at: now(),
        correlation_id: id,
        created_by_principal_id: proof.session.principalId,
        actor_snapshot_id: proof.actorSnapshotRef.objectId,
        authorization_decision_id: proof.authorizationDecisionRef.objectId,
      })
      .execute();
  }
  async function validateSources(
    trx: Trx,
    payload: PreparationAnalysisBasisPayload,
    guard: () => Promise<void>,
  ) {
    config.validateDefinition(payload);
    const templates = new Map<string, Buffer>();
    for (const binding of payload.templateBindings) {
      await guard();
      const ref = binding.templateRef;
      const template = await trx
        .selectFrom('enterprise_project.reference_template_version')
        .innerJoin(
          'enterprise_project.reference_template',
          'enterprise_project.reference_template.reference_template_id',
          'enterprise_project.reference_template_version.reference_template_id',
        )
        .selectAll('enterprise_project.reference_template_version')
        .select([
          'enterprise_project.reference_template.reference_code',
          'enterprise_project.reference_template.status',
        ])
        .where('reference_template_version_id', '=', ref.immutableVersionId ?? '')
        .executeTakeFirst();
      if (
        template?.reference_template_id !== ref.objectId ||
        template.reference_code !== binding.templateCode ||
        template.lifecycle !== 'PUBLISHED' ||
        template.status !== 'ACTIVE' ||
        template.content_hash.toString('hex') !== ref.contentHash.digest
      )
        fail('PREPARATION_ANALYSIS_TEMPLATE_UNUSABLE');
      const bytes = Buffer.from(
        await config.sources.readTemplate(template.content_ref as Common.ContentAddressedRef),
      );
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== binding.sourceBytesSha256 || actual !== ref.contentHash.digest)
        fail('PREPARATION_ANALYSIS_SOURCE_HASH_MISMATCH');
      templates.set(binding.templateCode, bytes);
    }
    for (const binding of payload.instructionBindings) {
      await guard();
      const bytes = await config.sources.readInstruction(binding.bytesSha256);
      if (
        bytes.byteLength !== binding.byteLength ||
        createHash('sha256').update(bytes).digest('hex') !== binding.bytesSha256
      )
        fail('PREPARATION_ANALYSIS_SOURCE_HASH_MISMATCH');
    }
    for (const binding of payload.requirementBindings) {
      await guard();
      const bytes = templates.get(binding.templateCode);
      if (!bytes) fail('PREPARATION_ANALYSIS_BASIS_INVALID');
      const located = await config.sources.locate(bytes, binding.locator);
      if (
        !located.length ||
        located.some(
          (part) =>
            !part.length ||
            bytes.indexOf(part) < 0 ||
            bytes.indexOf(part) !== bytes.lastIndexOf(part),
        )
      )
        fail('PREPARATION_ANALYSIS_LOCATOR_INVALID');
    }
    await guard();
  }
  async function publish(session: PreparationSession, input: PreparationAnalysisBasisPublishInput) {
    assertPreparationClosed(
      input,
      ['basisId', 'versionId', 'payload', 'effectiveFrom'],
      ['supersedesPublicationRef'],
    );
    assertPreparationAnalysisBasis(input.payload);
    validInstant(input.effectiveFrom);
    if (!isUuidV7(input.basisId) || !isUuidV7(input.versionId))
      fail('PREPARATION_ANALYSIS_BASIS_INVALID');
    const target = object(TYPE, input.basisId),
      op = PURPOSE + 'publish';
    const proof = await config.authorize(session, op, target, input);
    if (proof.context.principalKind !== 'HUMAN') fail('AUTHORIZATION_DENIED');
    const guard = () => config.check(proof, op, target, input);
    return transaction(proof, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${TYPE + ':' + input.payload.basisCode},0))`.execute(
        trx,
      );
      const existing = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='ANALYSIS_BASIS' AND identity_key=${input.payload.basisCode + ':' + input.payload.basisVersion}`.execute(
          trx,
        )
      ).rows[0];
      if (existing) {
        validFact(existing);
        const published = (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='ANALYSIS_BASIS_PUBLICATION' AND payload->'basisRef'->>'versionId'=${existing.id}`.execute(
            trx,
          )
        ).rows;
        if (published.length !== 1) fail('PREPARATION_PERSISTED_HASH_MISMATCH');
        const publication = validFact(published[0]);
        const prior = await trx
          .selectFrom('enterprise_project.command_receipt')
          .select(['request_payload_hash', 'result_payload', 'result_payload_hash'])
          .where('command_id', '=', publication.id)
          .executeTakeFirst();
        if (
          existing.id !== input.versionId ||
          prior?.request_payload_hash.toString('hex') !== hash(input).digest
        )
          fail('PREPARATION_ANALYSIS_BASIS_VERSION_EXISTS');
        const result = prior.result_payload;
        if (prior.result_payload_hash?.toString('hex') !== hash(result).digest)
          fail('PREPARATION_PERSISTED_HASH_MISMATCH');
        await guard();
        return result as PreparationAnalysisBasisSelection & {
          receiptRef: Common.ObjectRef;
        };
      }
      await validateSources(trx, input.payload, guard);
      if (input.supersedesPublicationRef) {
        const prev = await row(
          trx,
          'ANALYSIS_BASIS_PUBLICATION',
          input.supersedesPublicationRef.objectId,
        );
        if (
          !equal(
            content(TYPE + '_publication', prev.id, prev.payload),
            input.supersedesPublicationRef,
          )
        )
          fail('PREPARATION_ANALYSIS_BASIS_INVALID');
        const previous = prev.payload as PublicationPayload;
        const oldBasis = await row(trx, 'ANALYSIS_BASIS', previous.basisRef.versionId);
        if (
          (oldBasis.payload as PreparationAnalysisBasisPayload).basisCode !==
            input.payload.basisCode ||
          previous.basisRef.versionId === input.versionId ||
          Date.parse(input.effectiveFrom) < Date.parse(previous.effectiveFrom)
        )
          fail('PREPARATION_ANALYSIS_BASIS_INVALID');
        const successors = (
          await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='ANALYSIS_BASIS_PUBLICATION' AND payload->'supersedesPublicationRef'->>'objectId'=${prev.id}`.execute(
            trx,
          )
        ).rows;
        if (successors.length) fail('PREPARATION_SUPERSESSION_CONFLICT');
      }
      const basisRef: Common.VersionedRef = {
        ...target,
        kind: 'VERSIONED',
        versionId: input.versionId,
      };
      const pub: PublicationPayload = {
        basisRef,
        basisHash: hash(input.payload),
        effectiveFrom: input.effectiveFrom,
        actorSnapshotRef: proof.actorSnapshotRef,
        authorizationDecisionRef: proof.authorizationDecisionRef,
        ...(input.supersedesPublicationRef
          ? { supersedesPublicationRef: input.supersedesPublicationRef }
          : {}),
      };
      const publicationId = newUuidV7();
      const result = {
        basisRef,
        basisHash: pub.basisHash,
        publicationRef: content(TYPE + '_publication', publicationId, pub),
        receiptRef: object('CommandReceipt', publicationId),
      };
      await insert(
        trx,
        proof,
        input.versionId,
        'ANALYSIS_BASIS',
        input.payload.basisCode + ':' + input.payload.basisVersion,
        input.payload,
      );
      await insert(trx, proof, publicationId, 'ANALYSIS_BASIS_PUBLICATION', publicationId, pub);
      await receipt(trx, proof, publicationId, op, target, input, result);
      await guard();
      return result;
    });
  }
  async function resolve(
    session: PreparationSession,
    selection: PreparationAnalysisBasisSelection,
  ) {
    assertPreparationAnalysisBasisSelection(selection);
    const target = object(TYPE, selection.basisRef.objectId),
      op = PURPOSE + 'read';
    const proof = await config.authorize(session, op, target, selection),
      guard = () => config.check(proof, op, target, selection);
    return transaction(proof, async (trx) => {
      const basis = await row(trx, 'ANALYSIS_BASIS', selection.basisRef.versionId);
      const pub = await row(trx, 'ANALYSIS_BASIS_PUBLICATION', selection.publicationRef.objectId);
      assertPreparationAnalysisBasis(basis.payload);
      const publication = pub.payload as PublicationPayload;
      if (
        !equal(hash(basis.payload), selection.basisHash) ||
        !equal(publication.basisRef, selection.basisRef) ||
        !equal(publication.basisHash, selection.basisHash) ||
        !equal(content(TYPE + '_publication', pub.id, pub.payload), selection.publicationRef)
      )
        fail('PREPARATION_ANALYSIS_BASIS_HASH_MISMATCH');
      await validateSources(trx, basis.payload, guard);
      // Re-read mutable eligibility after source I/O. READ COMMITTED observes
      // withdrawals/successors committed while bytes were being checked.
      const changes = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE (kind='ANALYSIS_BASIS_WITHDRAWAL' AND payload->'publicationRef'->>'objectId'=${pub.id}) OR (kind='ANALYSIS_BASIS_PUBLICATION' AND payload->'supersedesPublicationRef'->>'objectId'=${pub.id}) ORDER BY id`.execute(
          trx,
        )
      ).rows;
      changes.forEach(validFact);
      // Status and time describe this final source observation, before the
      // mandatory return-time authorization check performs its own I/O.
      const checkedAt = now();
      const effective = changes.filter(
        (x) =>
          Date.parse((x.payload as { effectiveFrom: string }).effectiveFrom) <= checkedAt.getTime(),
      );
      const useStatus =
        Date.parse(publication.effectiveFrom) > checkedAt.getTime()
          ? 'NOT_YET_EFFECTIVE'
          : effective.some((x) => x.kind === 'ANALYSIS_BASIS_WITHDRAWAL')
            ? 'WITHDRAWN'
            : effective.length
              ? 'SUPERSEDED'
              : 'USABLE';
      await guard();
      return {
        payload: basis.payload,
        publicationRef: selection.publicationRef,
        useStatus,
        checkedAt: checkedAt.toISOString(),
        sourceWatermarks: hash({
          basis: selection,
          changes: changes.map((x) => ({ id: x.id, hash: hash(x.payload) })),
        }),
      };
    });
  }
  async function withdraw(
    session: PreparationSession,
    input: {
      publicationRef: Common.ContentAddressedRef;
      effectiveFrom: string;
      reasonCode: string;
    },
  ) {
    assertPreparationClosed(input, ['publicationRef', 'effectiveFrom', 'reasonCode']);
    validInstant(input.effectiveFrom);
    if (typeof input.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(input.reasonCode))
      fail('PREPARATION_ANALYSIS_BASIS_INVALID');
    const target = object(TYPE + '_publication', input.publicationRef.objectId),
      op = PURPOSE + 'withdraw';
    const proof = await config.authorize(session, op, target, input),
      guard = () => config.check(proof, op, target, input);
    if (proof.context.principalKind !== 'HUMAN') fail('AUTHORIZATION_DENIED');
    return transaction(proof, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${TYPE + ':withdraw:' + input.publicationRef.objectId},0))`.execute(
        trx,
      );
      const pub = await row(trx, 'ANALYSIS_BASIS_PUBLICATION', input.publicationRef.objectId);
      if (!equal(content(TYPE + '_publication', pub.id, pub.payload), input.publicationRef))
        fail('PREPARATION_ANALYSIS_BASIS_INVALID');
      const existing = (
        await sql<Fact>`SELECT * FROM enterprise_project.preparation_fact WHERE kind='ANALYSIS_BASIS_WITHDRAWAL' AND identity_key=${pub.id}`.execute(
          trx,
        )
      ).rows[0];
      if (existing) {
        validFact(existing);
        const prev = existing.payload as typeof input;
        if (
          !equal(
            {
              publicationRef: prev.publicationRef,
              effectiveFrom: prev.effectiveFrom,
              reasonCode: prev.reasonCode,
            },
            input,
          )
        )
          fail('IDEMPOTENCY_PAYLOAD_CONFLICT');
        await guard();
        return { receiptRef: object('CommandReceipt', existing.id) };
      }
      const id = newUuidV7(),
        payload = {
          ...input,
          actorSnapshotRef: proof.actorSnapshotRef,
          authorizationDecisionRef: proof.authorizationDecisionRef,
        };
      await insert(trx, proof, id, 'ANALYSIS_BASIS_WITHDRAWAL', pub.id, payload);
      const result = { receiptRef: object('CommandReceipt', id) };
      await receipt(trx, proof, id, op, target, input, result);
      await guard();
      return result;
    });
  }
  return { publish, resolve, withdraw };
}
export type PreparationAnalysisBasisService = ReturnType<
  typeof createPreparationAnalysisBasisService
>;
