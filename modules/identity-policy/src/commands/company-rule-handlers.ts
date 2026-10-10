import { sql, type Kysely, type Transaction } from 'kysely';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  COMPANY_STARTUP_PROFILES,
  CompanyStartupError,
  assertCompanyClosed,
  assertCompanyHash,
  assertCompanyReference,
  assertCompanySnapshotRead,
  assertCompanySnapshotRecord,
  assertCompanySnapshotView,
  canonicalCompanyInstant,
  companyHash,
  companyString,
  companyObjectTarget,
  companySnapshotReadRequest,
  sameCompanyValue,
  type Common,
  type CompanyRuleAuthorizationPort,
  type CompanyRuleAuthorizationProof,
  type CompanyRuleReferences,
  type CompanyRuleSemanticValidation,
  type CompanyRuleSnapshotReadRequest,
  type CompanyRuleSnapshotView,
  type CompanyStartupPayload,
} from '@zhiju/contracts';
import { withCompanyRuleTransaction, type CompanyRuleDb } from '../persistence/company-rule-db.js';

export interface CompanyRulePublicationRequest extends CompanyRuleReferences {
  publicationId: string;
  approvedDefinitionHash: Common.ContentHash;
  approvedRangeHash: Common.ContentHash;
  effectiveFrom: string;
  supersedesPublicationRef?: Common.ContentAddressedRef;
}
export interface CompanyRuleResolutionRequest extends CompanyRuleReferences {
  publicationRef: Common.ContentAddressedRef;
}
export interface CompanyRulePublicationView {
  publicationRef: Common.ContentAddressedRef;
  payload: CompanyRuleReferences & {
    bundleCode: string;
    bundleVersion: string;
    approvedDefinitionHash: Common.ContentHash;
    approvedRangeHash: Common.ContentHash;
    semanticValidation: CompanyRuleSemanticValidation;
    actorSnapshotRef: Common.SnapshotRef;
    authorizationDecisionRef: Common.ContentAddressedRef;
    effectiveFrom: string;
    recordedAt: string;
    supersedesPublicationRef?: Common.ContentAddressedRef;
  };
}
export interface CompanyRuleResolutionView {
  snapshots: {
    bundle: CompanyRuleSnapshotView;
    rules: CompanyRuleSnapshotView;
    vocabulary: CompanyRuleSnapshotView;
  };
  publication: CompanyRulePublicationView;
  currentUseStatus: 'USABLE' | 'NOT_YET_EFFECTIVE' | 'SUPERSEDED' | 'WITHDRAWN';
  checkedAt: string;
  sourceWatermarks: {
    owner: 'identity-policy' | 'enterprise-project';
    sourceRef: Common.ContentAddressedRef | Common.SnapshotRef;
    checkedAt: string;
    effectiveFrom?: string;
  }[];
  reasons: string[];
}
export interface CompanyRuleSnapshotConfig {
  db: Kysely<CompanyRuleDb>;
  authorization: CompanyRuleAuthorizationPort;
  /** Composition obtains independent, current EP authority and invokes its owning Port. */
  validateDefinition(request: {
    snapshotId: string;
    payload: CompanyStartupPayload;
  }): Promise<CompanyRuleSemanticValidation>;
  readAuthorization(
    request: CompanyRuleSnapshotReadRequest,
  ): Promise<CompanyRuleAuthorizationProof>;
  clock?: () => Date;
  /** Optional wiring-level result contract for rollback diagnostics. */
  validateResult?(result: unknown): void;
}
function invalid(code = 'COMPANY_RULE_INVALID'): never {
  throw new CompanyStartupError(code);
}
async function dependency<T>(invoke: () => Promise<T>): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    if (error instanceof CompanyStartupError) throw error;
    invalid('DEPENDENCY_UNAVAILABLE');
  }
}
function publicationRef(id: string, payload: unknown): Common.ContentAddressedRef {
  return {
    kind: 'CONTENT_ADDRESSED',
    objectType: 'zhiju.identity.company_rule_publication',
    objectId: id,
    scope: {},
    contentHash: companyHash(payload),
  };
}
function validateSemantic(
  result: CompanyRuleSemanticValidation,
  payload: CompanyStartupPayload,
): void {
  assertCompanyClosed(result, [
    'validatorProfileRef',
    'validatedPayloadHash',
    'validatedChildRefs',
    'validatedAt',
  ]);
  if (
    !sameCompanyValue(result.validatorProfileRef, payload.policySchemaRefs[0]) ||
    !sameCompanyValue(result.validatedPayloadHash, companyHash(payload)) ||
    !canonicalCompanyInstant(result.validatedAt)
  )
    invalid();
  const expected =
    payload.profileKey === COMPANY_STARTUP_PROFILES.bundle
      ? [payload.policyDocument.startupRulesRef, payload.policyDocument.vocabularyRef]
      : [];
  if (!sameCompanyValue(result.validatedChildRefs, expected)) invalid();
}
export function createCompanyRuleCapabilities(config: CompanyRuleSnapshotConfig) {
  const clock = config.clock ?? (() => new Date());
  const { db, authorization: auth } = config;
  async function write<T>(
    proof: CompanyRuleAuthorizationProof,
    operation:
      | 'identity.company_rule.snapshot.record'
      | 'identity.company_rule.publish'
      | 'identity.company_rule.withdraw',
    target: Common.ObjectRef,
    key: string,
    request: unknown,
    body: (trx: Transaction<CompanyRuleDb>, commandId: string) => Promise<T>,
    validateResult: (result: T) => void,
  ): Promise<T> {
    if (!key.trim()) invalid();
    await auth.check(proof, operation, target, request);
    const result = await withCompanyRuleTransaction(db, proof.session, proof, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(267001::bigint)`.execute(trx);
      await auth.check(proof, operation, target, request);
      const receipt = await trx
        .selectFrom('identity_policy.company_rule_receipt')
        .selectAll()
        .where('operation', '=', operation)
        .where('idempotency_key', '=', key)
        .executeTakeFirst();
      if (receipt) {
        if (receipt.request_hash.toString('hex') !== companyHash(request).digest)
          invalid('IDEMPOTENCY_PAYLOAD_CONFLICT');
        if (receipt.result_hash.toString('hex') !== companyHash(receipt.result).digest) invalid();
        const saved = receipt.result as T;
        validateResult(saved);
        config.validateResult?.(saved);
        await auth.check(proof, operation, target, request);
        return saved;
      }
      const id = newUuidV7();
      const value = await body(trx, id);
      validateResult(value);
      config.validateResult?.(value);
      await auth.check(proof, operation, target, request);
      await trx
        .insertInto('identity_policy.company_rule_receipt')
        .values({
          id,
          operation,
          idempotency_key: key,
          request_hash: Buffer.from(companyHash(request).digest, 'hex'),
          result: JSON.stringify(value),
          result_hash: Buffer.from(companyHash(value).digest, 'hex'),
          actor_id: proof.actorSnapshotRef.objectId,
          decision_id: proof.authorizationDecisionRef.objectId,
        })
        .execute();
      await trx
        .insertInto('identity_policy.company_rule_audit')
        .values({
          id: newUuidV7(),
          operation,
          principal_id: proof.session.principalId,
          actor_id: proof.actorSnapshotRef.objectId,
          decision_id: proof.authorizationDecisionRef.objectId,
          request_hash: Buffer.from(companyHash(request).digest, 'hex'),
          target_id: target.objectId,
          recorded_at: clock(),
        })
        .execute();
      await auth.check(proof, operation, target, request);
      return value;
    });
    await auth.check(proof, operation, target, request);
    return result;
  }
  async function read(
    proof: CompanyRuleAuthorizationProof,
    request: CompanyRuleSnapshotReadRequest,
  ): Promise<CompanyRuleSnapshotView> {
    assertCompanySnapshotRead(request);
    const target = companyObjectTarget(
      'identity.policy_snapshot',
      request.policySnapshotRef.objectId,
    );
    await auth.check(proof, 'identity.company_rule.snapshot.read', target, request);
    const result = await withCompanyRuleTransaction(db, proof.session, proof, async (trx) => {
      const row = await trx
        .selectFrom('identity_policy.company_rule_snapshot')
        .selectAll()
        .where('id', '=', request.policySnapshotRef.snapshotId)
        .executeTakeFirst();
      if (row?.payload_hash.toString('hex') !== request.policySnapshotRef.contentHash.digest)
        invalid('COMPANY_RULE_NOT_FOUND');
      const view: CompanyRuleSnapshotView = {
        policySnapshotRef: request.policySnapshotRef,
        payload: row.payload as CompanyStartupPayload,
      };
      assertCompanySnapshotView(view);
      if (
        row.registry_version !== request.registryVersion ||
        row.profile_key !== request.profileKey ||
        view.payload.profileKey !== request.profileKey ||
        !sameCompanyValue(view.payload.policySchemaRefs, [request.policySchemaRef])
      )
        invalid('COMPANY_RULE_NOT_FOUND');
      const role =
        request.profileKey === COMPANY_STARTUP_PROFILES.bundle
          ? 'bundle'
          : request.profileKey === COMPANY_STARTUP_PROFILES.rules
            ? 'rules'
            : 'vocabulary';
      if (
        row.document_code !== view.payload.policyDocument[`${role}Code`] ||
        row.document_version !== view.payload.policyDocument[`${role}Version`]
      )
        invalid();
      return view;
    });
    await auth.check(proof, 'identity.company_rule.snapshot.read', target, request);
    return result;
  }
  async function readOwn(
    ref: Common.SnapshotRef,
    profile: (typeof COMPANY_STARTUP_PROFILES)[keyof typeof COMPANY_STARTUP_PROFILES],
  ): Promise<CompanyRuleSnapshotView> {
    const request = companySnapshotReadRequest(ref, profile);
    return read(await dependency(() => config.readAuthorization(request)), request);
  }
  async function bundleViews(refs: CompanyRuleReferences, guard: () => Promise<void>) {
    await guard();
    const bundle = await readOwn(refs.ruleBundleRef, COMPANY_STARTUP_PROFILES.bundle);
    if (
      !sameCompanyValue(bundle.payload.policyDocument.startupRulesRef, refs.startupRulesRef) ||
      !sameCompanyValue(bundle.payload.policyDocument.vocabularyRef, refs.vocabularyRef)
    )
      invalid();
    await guard();
    const rules = await readOwn(refs.startupRulesRef, COMPANY_STARTUP_PROFILES.rules);
    await guard();
    const vocabulary = await readOwn(refs.vocabularyRef, COMPANY_STARTUP_PROFILES.vocabulary);
    return { bundle, rules, vocabulary };
  }
  function assertPublication(view: CompanyRulePublicationView): void {
    assertCompanyClosed(view, ['publicationRef', 'payload']);
    assertCompanyReference(
      view.publicationRef,
      'CONTENT_ADDRESSED',
      'zhiju.identity.company_rule_publication',
    );
    assertCompanyClosed(
      view.payload,
      [
        'bundleCode',
        'bundleVersion',
        'ruleBundleRef',
        'startupRulesRef',
        'vocabularyRef',
        'approvedDefinitionHash',
        'approvedRangeHash',
        'semanticValidation',
        'actorSnapshotRef',
        'authorizationDecisionRef',
        'effectiveFrom',
        'recordedAt',
      ],
      ['supersedesPublicationRef'],
    );
    if (!sameCompanyValue(view.publicationRef.contentHash, companyHash(view.payload))) invalid();
  }
  async function publication(
    trx: Transaction<CompanyRuleDb>,
    ref: Common.ContentAddressedRef,
  ): Promise<CompanyRulePublicationView> {
    assertCompanyReference(ref, 'CONTENT_ADDRESSED', 'zhiju.identity.company_rule_publication');
    const row = await trx
      .selectFrom('identity_policy.company_rule_publication')
      .selectAll()
      .where('id', '=', ref.objectId)
      .executeTakeFirst();
    if (row?.payload_hash.toString('hex') !== ref.contentHash.digest)
      invalid('COMPANY_RULE_NOT_FOUND');
    const view = {
      publicationRef: ref,
      payload: row.payload as CompanyRulePublicationView['payload'],
    };
    assertPublication(view);
    if (
      row.bundle_code !== view.payload.bundleCode ||
      row.bundle_version !== view.payload.bundleVersion ||
      row.bundle_id !== view.payload.ruleBundleRef.objectId ||
      row.predecessor_id !== (view.payload.supersedesPublicationRef?.objectId ?? null) ||
      row.effective_from.toISOString() !== view.payload.effectiveFrom
    )
      invalid();
    return view;
  }
  return {
    read,
    async record(
      proof: CompanyRuleAuthorizationProof,
      key: string,
      request: { snapshotId: string; payload: CompanyStartupPayload },
    ): Promise<CompanyRuleSnapshotView> {
      assertCompanySnapshotRecord(request);
      const target = companyObjectTarget('identity.policy_snapshot', request.snapshotId);
      return write(
        proof,
        'identity.company_rule.snapshot.record',
        target,
        key,
        request,
        async (trx, commandId) => {
          const validation = await dependency(() => config.validateDefinition(request));
          validateSemantic(validation, request.payload);
          const role =
            request.payload.profileKey === COMPANY_STARTUP_PROFILES.bundle
              ? 'bundle'
              : request.payload.profileKey === COMPANY_STARTUP_PROFILES.rules
                ? 'rules'
                : 'vocabulary';
          const hash = companyHash(request.payload);
          const policySnapshotRef: Common.SnapshotRef = {
            kind: 'SNAPSHOT',
            objectType: 'identity.policy_snapshot',
            objectId: request.snapshotId,
            snapshotId: request.snapshotId,
            scope: {},
            contentHash: hash,
          };
          const conflict = await trx
            .selectFrom('identity_policy.company_rule_snapshot')
            .select('id')
            .where((eb) =>
              eb.or([
                eb('id', '=', request.snapshotId),
                eb.and([
                  eb('profile_key', '=', request.payload.profileKey),
                  eb(
                    'document_code',
                    '=',
                    companyString(request.payload.policyDocument[`${role}Code`]),
                  ),
                  eb(
                    'document_version',
                    '=',
                    companyString(request.payload.policyDocument[`${role}Version`]),
                  ),
                ]),
              ]),
            )
            .executeTakeFirst();
          if (conflict) invalid('COMPANY_RULE_IDENTITY_CONFLICT');
          await trx
            .insertInto('identity_policy.company_rule_snapshot')
            .values({
              id: request.snapshotId,
              registry_version: request.payload.registryVersion,
              profile_key: request.payload.profileKey,
              document_code: companyString(request.payload.policyDocument[`${role}Code`]),
              document_version: companyString(request.payload.policyDocument[`${role}Version`]),
              payload: JSON.stringify(request.payload),
              payload_hash: Buffer.from(hash.digest, 'hex'),
              actor_id: proof.actorSnapshotRef.objectId,
              decision_id: proof.authorizationDecisionRef.objectId,
              source_command_id: commandId,
            })
            .execute();
          return { policySnapshotRef, payload: request.payload };
        },
        assertCompanySnapshotView,
      );
    },
    async publish(
      proof: CompanyRuleAuthorizationProof,
      key: string,
      request: CompanyRulePublicationRequest,
    ): Promise<CompanyRulePublicationView> {
      assertCompanyClosed(
        request,
        [
          'publicationId',
          'ruleBundleRef',
          'startupRulesRef',
          'vocabularyRef',
          'approvedDefinitionHash',
          'approvedRangeHash',
          'effectiveFrom',
        ],
        ['supersedesPublicationRef'],
      );
      if (!canonicalCompanyInstant(request.effectiveFrom)) invalid();
      for (const [ref, profile] of [
        [request.ruleBundleRef, COMPANY_STARTUP_PROFILES.bundle],
        [request.startupRulesRef, COMPANY_STARTUP_PROFILES.rules],
        [request.vocabularyRef, COMPANY_STARTUP_PROFILES.vocabulary],
      ] as const)
        assertCompanySnapshotRead(companySnapshotReadRequest(ref, profile));
      assertCompanyHash(request.approvedDefinitionHash);
      assertCompanyHash(request.approvedRangeHash);
      if (request.supersedesPublicationRef)
        assertCompanyReference(
          request.supersedesPublicationRef,
          'CONTENT_ADDRESSED',
          'zhiju.identity.company_rule_publication',
        );
      const target = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        request.publicationId,
      );
      return write(
        proof,
        'identity.company_rule.publish',
        target,
        key,
        request,
        async (trx, commandId) => {
          const human = await auth.humanApproval(
            proof,
            'identity.company_rule.publish',
            target,
            request,
          );
          const snapshots = await bundleViews(request, () =>
            auth.check(proof, 'identity.company_rule.publish', target, request),
          );
          const b = snapshots.bundle.payload.policyDocument;
          if (
            !sameCompanyValue(
              request.approvedDefinitionHash,
              companyHash(snapshots.rules.payload.policyDocument),
            ) ||
            !sameCompanyValue(request.approvedRangeHash, companyHash(b.supportedRange)) ||
            request.effectiveFrom !== snapshots.bundle.payload.effectiveFrom ||
            snapshots.rules.payload.effectiveFrom !== request.effectiveFrom ||
            snapshots.vocabulary.payload.effectiveFrom !== request.effectiveFrom
          )
            invalid();
          const semanticValidation = await dependency(() =>
            config.validateDefinition({
              snapshotId: request.ruleBundleRef.snapshotId,
              payload: snapshots.bundle.payload,
            }),
          );
          validateSemantic(semanticValidation, snapshots.bundle.payload);
          if (
            (request.supersedesPublicationRef === undefined) !==
            (b.supersedesBundleRef === undefined)
          )
            invalid();
          if (request.supersedesPublicationRef) {
            const previous = await publication(trx, request.supersedesPublicationRef);
            if (
              previous.payload.bundleCode !== b.bundleCode ||
              !sameCompanyValue(previous.payload.ruleBundleRef, b.supersedesBundleRef) ||
              previous.publicationRef.objectId === request.publicationId
            )
              invalid('COMPANY_RULE_SUPERSESSION_INVALID');
            if (
              await trx
                .selectFrom('identity_policy.company_rule_publication')
                .select('id')
                .where('predecessor_id', '=', previous.publicationRef.objectId)
                .executeTakeFirst()
            )
              invalid('COMPANY_RULE_SUPERSESSION_INVALID');
          }
          const payload: CompanyRulePublicationView['payload'] = {
            bundleCode: companyString(b.bundleCode),
            bundleVersion: companyString(b.bundleVersion),
            ruleBundleRef: request.ruleBundleRef,
            startupRulesRef: request.startupRulesRef,
            vocabularyRef: request.vocabularyRef,
            approvedDefinitionHash: request.approvedDefinitionHash,
            approvedRangeHash: request.approvedRangeHash,
            semanticValidation,
            actorSnapshotRef: human.actorSnapshotRef,
            authorizationDecisionRef: human.authorizationDecisionRef,
            effectiveFrom: request.effectiveFrom,
            recordedAt: clock().toISOString(),
            ...(request.supersedesPublicationRef
              ? { supersedesPublicationRef: request.supersedesPublicationRef }
              : {}),
          };
          const conflict = await trx
            .selectFrom('identity_policy.company_rule_publication')
            .select('id')
            .where((eb) =>
              eb.or([
                eb('id', '=', request.publicationId),
                eb('bundle_id', '=', request.ruleBundleRef.objectId),
                eb.and([
                  eb('bundle_code', '=', payload.bundleCode),
                  eb('bundle_version', '=', payload.bundleVersion),
                ]),
              ]),
            )
            .executeTakeFirst();
          if (conflict) invalid('COMPANY_RULE_IDENTITY_CONFLICT');
          const ref = publicationRef(request.publicationId, payload);
          await trx
            .insertInto('identity_policy.company_rule_publication')
            .values({
              id: request.publicationId,
              bundle_code: payload.bundleCode,
              bundle_version: payload.bundleVersion,
              bundle_id: request.ruleBundleRef.objectId,
              predecessor_id: request.supersedesPublicationRef?.objectId ?? null,
              effective_from: new Date(payload.effectiveFrom),
              payload: JSON.stringify(payload),
              payload_hash: Buffer.from(ref.contentHash.digest, 'hex'),
              actor_id: proof.actorSnapshotRef.objectId,
              decision_id: proof.authorizationDecisionRef.objectId,
              source_command_id: commandId,
            })
            .execute();
          return { publicationRef: ref, payload };
        },
        assertPublication,
      );
    },
    async withdraw(
      proof: CompanyRuleAuthorizationProof,
      key: string,
      request: {
        withdrawalId: string;
        publicationRef: Common.ContentAddressedRef;
        reason: string;
        effectiveFrom: string;
      },
    ) {
      assertCompanyClosed(request, ['withdrawalId', 'publicationRef', 'reason', 'effectiveFrom']);
      assertCompanyReference(
        request.publicationRef,
        'CONTENT_ADDRESSED',
        'zhiju.identity.company_rule_publication',
      );
      companyObjectTarget('zhiju.identity.company_rule_withdrawal', request.withdrawalId);
      companyString(request.reason);
      if (!canonicalCompanyInstant(request.effectiveFrom)) invalid();
      const target = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        request.publicationRef.objectId,
      );
      return write(
        proof,
        'identity.company_rule.withdraw',
        target,
        key,
        request,
        async (trx, commandId) => {
          const human = await auth.humanApproval(
            proof,
            'identity.company_rule.withdraw',
            target,
            request,
          );
          await publication(trx, request.publicationRef);
          const payload = {
            publicationRef: request.publicationRef,
            reason: request.reason,
            effectiveFrom: request.effectiveFrom,
            recordedAt: clock().toISOString(),
            actorSnapshotRef: human.actorSnapshotRef,
            authorizationDecisionRef: human.authorizationDecisionRef,
          };
          const conflict = await trx
            .selectFrom('identity_policy.company_rule_withdrawal')
            .select('id')
            .where((eb) =>
              eb.or([
                eb('id', '=', request.withdrawalId),
                eb('publication_id', '=', request.publicationRef.objectId),
              ]),
            )
            .executeTakeFirst();
          if (conflict) invalid('COMPANY_RULE_IDENTITY_CONFLICT');
          await trx
            .insertInto('identity_policy.company_rule_withdrawal')
            .values({
              id: request.withdrawalId,
              publication_id: request.publicationRef.objectId,
              effective_from: new Date(request.effectiveFrom),
              payload: JSON.stringify(payload),
              payload_hash: Buffer.from(companyHash(payload).digest, 'hex'),
              actor_id: proof.actorSnapshotRef.objectId,
              decision_id: proof.authorizationDecisionRef.objectId,
              source_command_id: commandId,
            })
            .execute();
          return {
            withdrawalRef: {
              kind: 'CONTENT_ADDRESSED' as const,
              objectType: 'zhiju.identity.company_rule_withdrawal',
              objectId: request.withdrawalId,
              scope: {},
              contentHash: companyHash(payload),
            },
            payload,
          };
        },
        (value) => {
          assertCompanyReference(
            value.withdrawalRef,
            'CONTENT_ADDRESSED',
            'zhiju.identity.company_rule_withdrawal',
          );
          if (!sameCompanyValue(value.withdrawalRef.contentHash, companyHash(value.payload)))
            invalid();
        },
      );
    },
    async resolve(
      proof: CompanyRuleAuthorizationProof,
      request: CompanyRuleResolutionRequest,
    ): Promise<CompanyRuleResolutionView> {
      assertCompanyClosed(request, [
        'ruleBundleRef',
        'startupRulesRef',
        'vocabularyRef',
        'publicationRef',
      ]);
      assertCompanyReference(
        request.publicationRef,
        'CONTENT_ADDRESSED',
        'zhiju.identity.company_rule_publication',
      );
      for (const [ref, profile] of [
        [request.ruleBundleRef, COMPANY_STARTUP_PROFILES.bundle],
        [request.startupRulesRef, COMPANY_STARTUP_PROFILES.rules],
        [request.vocabularyRef, COMPANY_STARTUP_PROFILES.vocabulary],
      ] as const)
        assertCompanySnapshotRead(companySnapshotReadRequest(ref, profile));
      const target = companyObjectTarget(
        'zhiju.identity.company_rule_publication',
        request.publicationRef.objectId,
      );
      await auth.check(proof, 'identity.company_rule.read', target, request);
      const snapshots = await bundleViews(request, () =>
        auth.check(proof, 'identity.company_rule.read', target, request),
      );
      // Exact semantic/source checks are current; historical payloads are never recomputed.
      const semantic = await dependency(() =>
        config.validateDefinition({
          snapshotId: request.ruleBundleRef.snapshotId,
          payload: snapshots.bundle.payload,
        }),
      );
      validateSemantic(semantic, snapshots.bundle.payload);
      await auth.check(proof, 'identity.company_rule.read', target, request);
      const result = await withCompanyRuleTransaction(db, proof.session, proof, async (trx) => {
        const p = await publication(trx, request.publicationRef);
        if (
          !sameCompanyValue(p.payload.ruleBundleRef, request.ruleBundleRef) ||
          !sameCompanyValue(p.payload.startupRulesRef, request.startupRulesRef) ||
          !sameCompanyValue(p.payload.vocabularyRef, request.vocabularyRef) ||
          !sameCompanyValue(
            p.payload.approvedDefinitionHash,
            companyHash(snapshots.rules.payload.policyDocument),
          ) ||
          !sameCompanyValue(
            p.payload.approvedRangeHash,
            companyHash(snapshots.bundle.payload.policyDocument.supportedRange),
          )
        )
          invalid();
        validateSemantic(p.payload.semanticValidation, snapshots.bundle.payload);
        // The historical Human proof is checked for integrity, not its publisher's current grant.
        const actor = await trx
          .selectFrom('identity_policy.company_rule_authority')
          .selectAll()
          .where('id', '=', p.payload.actorSnapshotRef.objectId)
          .where('kind', '=', 'ACTOR')
          .executeTakeFirst();
        const decision = await trx
          .selectFrom('identity_policy.company_rule_authority')
          .selectAll()
          .where('id', '=', p.payload.authorizationDecisionRef.objectId)
          .where('kind', '=', 'DECISION')
          .executeTakeFirst();
        if (
          !actor ||
          !decision ||
          !sameCompanyValue(companyHash(actor.payload), p.payload.actorSnapshotRef.contentHash) ||
          !sameCompanyValue(
            companyHash(decision.payload),
            p.payload.authorizationDecisionRef.contentHash,
          )
        )
          invalid();
        const a = actor.payload as { principalKind: string },
          d = decision.payload as {
            principalKind: string;
            operation: string;
            outcome: string;
            actorSnapshotRef: Common.SnapshotRef;
            target: Common.ObjectRef;
            requestHash: Common.ContentHash;
          };
        const approvedRequest: CompanyRulePublicationRequest = {
          publicationId: p.publicationRef.objectId,
          ruleBundleRef: p.payload.ruleBundleRef,
          startupRulesRef: p.payload.startupRulesRef,
          vocabularyRef: p.payload.vocabularyRef,
          approvedDefinitionHash: p.payload.approvedDefinitionHash,
          approvedRangeHash: p.payload.approvedRangeHash,
          effectiveFrom: p.payload.effectiveFrom,
          ...(p.payload.supersedesPublicationRef
            ? { supersedesPublicationRef: p.payload.supersedesPublicationRef }
            : {}),
        };
        if (
          a.principalKind !== 'HUMAN' ||
          d.principalKind !== 'HUMAN' ||
          d.operation !== 'identity.company_rule.publish' ||
          d.outcome !== 'ALLOW' ||
          !sameCompanyValue(d.actorSnapshotRef, p.payload.actorSnapshotRef) ||
          !sameCompanyValue(d.target, target) ||
          !sameCompanyValue(d.requestHash, companyHash(approvedRequest))
        )
          invalid();
        const checkedAt = clock().toISOString();
        const withdrawal = await trx
          .selectFrom('identity_policy.company_rule_withdrawal')
          .selectAll()
          .where('publication_id', '=', p.publicationRef.objectId)
          .executeTakeFirst();
        const successor = await trx
          .selectFrom('identity_policy.company_rule_publication')
          .selectAll()
          .where('predecessor_id', '=', p.publicationRef.objectId)
          .executeTakeFirst();
        const watermarks: CompanyRuleResolutionView['sourceWatermarks'] = [
          {
            owner: 'identity-policy',
            sourceRef: p.publicationRef,
            checkedAt,
            effectiveFrom: p.payload.effectiveFrom,
          },
          ...Object.values(snapshots).map((snapshot) => ({
            owner: 'identity-policy' as const,
            sourceRef: snapshot.policySnapshotRef,
            checkedAt,
            effectiveFrom: snapshot.payload.effectiveFrom,
          })),
        ];
        const definition = snapshots.bundle.payload.policyDocument as unknown as {
          templateBindings: { templateRef: Common.ContentAddressedRef }[];
          requirementBindings: { requirementRef: Common.ContentAddressedRef }[];
          supportedRange: {
            standardTargets: Common.ContentAddressedRef[];
            upgradeTargetRef: Common.ContentAddressedRef;
          };
        };
        for (const sourceRef of [
          ...definition.templateBindings.map((binding) => binding.templateRef),
          ...definition.requirementBindings.map((binding) => binding.requirementRef),
          ...definition.supportedRange.standardTargets,
          definition.supportedRange.upgradeTargetRef,
        ])
          watermarks.push({
            owner: 'enterprise-project',
            sourceRef,
            checkedAt: semantic.validatedAt,
          });
        if (withdrawal) {
          if (companyHash(withdrawal.payload).digest !== withdrawal.payload_hash.toString('hex'))
            invalid();
          watermarks.push({
            owner: 'identity-policy',
            sourceRef: {
              kind: 'CONTENT_ADDRESSED',
              objectType: 'zhiju.identity.company_rule_withdrawal',
              objectId: withdrawal.id,
              scope: {},
              contentHash: companyHash(withdrawal.payload),
            },
            checkedAt,
            effectiveFrom: withdrawal.effective_from.toISOString(),
          });
        }
        if (successor) {
          const s = await publication(trx, publicationRef(successor.id, successor.payload));
          if (s.payload.bundleCode !== p.payload.bundleCode) invalid();
          watermarks.push({
            owner: 'identity-policy',
            sourceRef: s.publicationRef,
            checkedAt,
            effectiveFrom: s.payload.effectiveFrom,
          });
        }
        const currentUseStatus =
          withdrawal && withdrawal.effective_from <= new Date(checkedAt)
            ? 'WITHDRAWN'
            : new Date(p.payload.effectiveFrom) > new Date(checkedAt)
              ? 'NOT_YET_EFFECTIVE'
              : successor && successor.effective_from <= new Date(checkedAt)
                ? 'SUPERSEDED'
                : 'USABLE';
        return {
          snapshots,
          publication: p,
          currentUseStatus,
          checkedAt,
          sourceWatermarks: watermarks,
          reasons: currentUseStatus === 'USABLE' ? [] : [currentUseStatus],
        } satisfies CompanyRuleResolutionView;
      });
      await auth.check(proof, 'identity.company_rule.read', target, request);
      return result;
    },
  };
}
