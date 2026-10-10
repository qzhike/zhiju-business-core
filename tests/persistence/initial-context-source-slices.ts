import type { InitialContextEntry } from '@zhiju/api/composition';
import type { Common } from '@zhiju/contracts';
import {
  AUTHORIZATION_REVOKED,
  IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
} from '@zhiju/identity-policy';
import { type CanonicalJsonObject, newUuidV7 } from '@zhiju/shared-kernel';
import {
  API_VALUE_INVALID,
  assembleInitialContext,
  type CommandResult,
  digestCanonicalPayload,
  EXECUTION_CONTEXT_SOURCE_INVALID,
  REFERENCE_INVALID,
} from '@zhiju/task-execution';
import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import {
  ACTIONS,
  BUILD_COMMAND,
  BUILD_VERSION,
  COMPATIBILITY_BASELINE,
  contentHash,
  CONTEXT_SNAPSHOT_LEGACY_OBJECT,
  CONTEXT_SNAPSHOT_OBJECT,
  contextSnapshotCapabilityCodes,
  DRAFT_SNAPSHOT_OBJECT,
  failureOf,
  type LegacyImportRow,
  OPERATOR,
  OPERATOR_ACTOR,
  POLICY_SNAPSHOT_ID,
  type Principal,
  PRINCIPAL_OBJECT,
  PUBLIC_API_CATALOG,
  record,
  SLICE_OBJECT,
} from './initial-context-fixtures.js';
import type { InitialContextSuite } from './initial-context-suite.js';
export function registerSourceSlices(suite: InitialContextSuite): void {
  suite.itIntegration(
    'TE-217-D-001 reads the imported legacy snapshot by its original identity',
    async () => {
      // One committed canonical build supplies the historical body the
      // controlled import carries into the legacy store.
      const buildEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-217001-build' });
      const built = await suite.attemptBuild(buildEnvelope);
      expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
      if (built.result === undefined) throw new Error('the 217-001 build did not commit');
      const sourceRow = await suite.contextSnapshotRow(
        record(buildEnvelope.targetRef).objectId as string,
      );
      if (sourceRow === undefined) throw new Error('the 217-001 source snapshot row is missing');
      const sourceSnapshotRef = suite.contextSnapshotRefOf(built.result);

      // The controlled import: the schema-owner role under an established
      // Project-scoped context, the provenance manifest recorded on the row.
      const legacyCountBefore = await suite.countRows('task_execution.context_snapshot_legacy');
      const legacyObjectId = newUuidV7();
      const legacySnapshotId = newUuidV7();
      const legacy = suite.legacyFixtureOf(sourceRow.canonical_payload, legacySnapshotId);
      const baseImport: LegacyImportRow = {
        snapshotId: legacySnapshotId,
        objectId: legacyObjectId,
        enterpriseId: suite.fixture.enterpriseId,
        projectId: suite.fixture.projectId,
        payloadHash: Buffer.from(legacy.digest, 'hex'),
        canonicalPayload: legacy.payload,
        projectContextContract: legacy.payload,
        contractRef: suite.closedContractRef(legacySnapshotId, legacy.digest),
      };
      expect(await suite.importLegacySnapshot(baseImport)).toBeNull();
      expect(await suite.countRows('task_execution.context_snapshot_legacy')).toBe(
        legacyCountBefore + 1,
      );
      const legacyRef = suite.legacySnapshotRefOf(legacyObjectId, legacySnapshotId, legacy.digest);
      const legacyRow = await suite.legacySnapshotRow(legacyObjectId);
      if (legacyRow === undefined) throw new Error('the imported legacy row is missing');
      expect(legacyRow).toMatchObject({
        snapshot_id: legacySnapshotId,
        object_type: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        enterprise_id: suite.fixture.enterpriseId,
        project_id: suite.fixture.projectId,
        payload_hash_algorithm: 'SHA-256',
        canonicalization_version: '1',
        import_manifest_id: 'wi216-legacy-import-manifest',
        import_batch_id: 'wi216-legacy-import-batch',
        source_system: 'wi216-legacy-source-system',
        import_tool_version: 'wi216-import-tool-1.0.0',
      });
      expect(legacyRow.payload_hash.equals(Buffer.from(legacy.digest, 'hex'))).toBe(true);

      // The exact read-back by the original identity (the legacy read Grant of
      // other() from TE-214-D-014 serves every legacy read of this row): the
      // requested ref is echoed verbatim, the historical contract body and its
      // reference come from their own stored columns, and the read writes
      // nothing in either store.
      const factsBefore = await suite.teFactCounts();
      const legacyRead = await suite.attemptRead(
        await suite.preparedRead({
          snapshotRef: legacyRef,
          principal: suite.other(),
          targetObjectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        }),
        suite.initialContextEntry,
        suite.other(),
      );
      expect(legacyRead, JSON.stringify(legacyRead)).toMatchObject({
        code: 'COMMITTED',
        thrown: false,
      });
      if (legacyRead.result?.status !== 'COMMITTED') {
        throw new Error('the 217-001 legacy read did not close');
      }
      const legacyResult = record(legacyRead.result.resultPayload);
      expect(legacyResult.contextSnapshotRef).toEqual(legacyRef);
      expect(legacyResult.projectContextContract).toEqual(legacyRow.project_context_contract);
      expect(legacyResult.contractRef).toEqual(legacyRow.contract_ref);
      expect(await suite.teFactCounts()).toEqual(factsBefore);
      expect(await suite.countRows('task_execution.context_snapshot_legacy')).toBe(
        legacyCountBefore + 1,
      );

      // The legacy identity never pollutes the canonical namespace: no
      // canonical row exists under it, and the two one-member substitutions of
      // the spelling fail closed in their own store — never a fall-through.
      expect(await suite.contextSnapshotRow(legacyObjectId)).toBeUndefined();
      const readAs = async (
        ref: unknown,
        principal: Principal,
        targetObjectType: string,
      ): Promise<{ code: string; thrown: boolean; result?: CommandResult }> =>
        suite.attemptRead(
          await suite.preparedRead({
            snapshotRef: legacyRef,
            principal,
            refOverride: ref,
            targetObjectType,
          }),
          suite.initialContextEntry,
          principal,
        );
      expect(
        await readAs(
          { ...legacyRef, objectType: CONTEXT_SNAPSHOT_OBJECT },
          suite.operator(),
          CONTEXT_SNAPSHOT_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect(
        await readAs(
          { ...sourceSnapshotRef, objectType: CONTEXT_SNAPSHOT_LEGACY_OBJECT },
          suite.other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      // A substituted snapshot id, a foreign hash and a foreign Scope fail
      // closed the same way (the Scope one at the entry's exact-scope gate).
      expect(
        await readAs(
          { ...legacyRef, snapshotId: newUuidV7() },
          suite.other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect(
        await readAs(
          { ...legacyRef, contentHash: contentHash('0'.repeat(64)) },
          suite.other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
      expect(
        await readAs(
          { ...legacyRef, scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() } },
          suite.other(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
        ),
      ).toMatchObject({ code: REFERENCE_INVALID, thrown: true });

      // The runtime role is read-only on the store (V3004 §35 ACL row).
      const appInsert = await suite.appStatement(
        `INSERT INTO task_execution.context_snapshot_legacy (
         snapshot_id, object_type, object_id, enterprise_id, project_id,
         payload_hash, payload_hash_algorithm, canonicalization_version,
         canonical_payload, project_context_contract, contract_ref,
         import_manifest_id, import_batch_id, source_system, imported_at,
         import_tool_version)
       VALUES ($1, $2, $3, $4, $5, $6, 'SHA-256', '1', $7::jsonb, $8::jsonb, $9::jsonb,
               'm', 'b', 's', now(), 't')`,
        [
          newUuidV7(),
          CONTEXT_SNAPSHOT_LEGACY_OBJECT,
          newUuidV7(),
          suite.fixture.enterpriseId,
          suite.fixture.projectId,
          Buffer.from(legacy.digest, 'hex'),
          JSON.stringify(legacy.payload),
          JSON.stringify(legacy.payload),
          JSON.stringify(baseImport.contractRef),
        ],
      );
      expect(appInsert?.code).toBe('42501');
      const appUpdate = await suite.appStatement(
        'UPDATE task_execution.context_snapshot_legacy SET source_system = $2 WHERE object_id = $1',
        [legacyObjectId, 'tampered'],
      );
      expect(appUpdate?.code).toBe('42501');
      const appDelete = await suite.appStatement(
        'DELETE FROM task_execution.context_snapshot_legacy WHERE object_id = $1',
        [legacyObjectId],
      );
      expect(appDelete?.code).toBe('42501');

      // The owner-role closures: a content address or Scope that disagrees
      // with the stored bytes is the mirror guard's 22023; UPDATE and DELETE
      // close in two layers — under FORCE RLS the owner role sees no rows (no
      // UPDATE/DELETE policy exists), so its rewrite affects zero rows, and a
      // role that bypasses RLS meets the immutable guard's 23514; an import
      // outside the established context's coverage is RLS; the legacy spelling
      // and the provenance manifest are CHECK-closed. Every case below closes
      // its `contract_ref` against its own case identity first, so the extended
      // guard (PR #217 round 4) never preempts the closure the case targets.
      const tamperedHashId = newUuidV7();
      const tamperedHashFixture = suite.legacyFixtureOf(
        sourceRow.canonical_payload,
        tamperedHashId,
      );
      const wrongHash = await suite.importLegacySnapshot({
        ...baseImport,
        snapshotId: tamperedHashId,
        objectId: newUuidV7(),
        payloadHash: Buffer.alloc(32, 0),
        canonicalPayload: tamperedHashFixture.payload,
        projectContextContract: tamperedHashFixture.payload,
        contractRef: suite.closedContractRef(tamperedHashId, tamperedHashFixture.digest),
      });
      expect(wrongHash?.code).toBe('22023');
      expect(wrongHash?.message).toContain('context snapshot legacy promoted mirror mismatch');

      const tamperedScopeId = newUuidV7();
      const tamperedScopeFixture = suite.legacyFixtureOf(
        sourceRow.canonical_payload,
        tamperedScopeId,
      );
      record(tamperedScopeFixture.payload.projectRef).objectId = newUuidV7();
      const tamperedScopeDigest = digestCanonicalPayload(
        tamperedScopeFixture.payload as CanonicalJsonObject,
      ).hash.toString('hex');
      const wrongScope = await suite.importLegacySnapshot({
        ...baseImport,
        snapshotId: tamperedScopeId,
        objectId: newUuidV7(),
        payloadHash: Buffer.from(tamperedScopeDigest, 'hex'),
        canonicalPayload: tamperedScopeFixture.payload,
        projectContextContract: tamperedScopeFixture.payload,
        contractRef: suite.closedContractRef(tamperedScopeId, tamperedScopeDigest),
      });
      expect(wrongScope?.code).toBe('22023');
      expect(wrongScope?.message).toContain('context snapshot legacy promoted mirror mismatch');

      // The §35 contract closure (PR #217 round 4): the stored contract body
      // must not differ from the hashed canonical payload, and `contract_ref`
      // must name exactly the recomputed cv1 address of that body — the Snapshot
      // identity as objectId, the row's Project Scope, the SHA-256/'1'/lowercase
      // digest triple. Every violation is the same guard 22023, so no
      // closure-violating row can ever exist for the read boundary to return
      // (the read-side recomputation can never observe one — the same "no legal
      // fact producer" convention as the direct-forgery rows).
      const closedImportOf = (
        caseSnapshotId: string,
        caseFixture: { payload: Record<string, unknown>; digest: string },
      ): LegacyImportRow => ({
        ...baseImport,
        snapshotId: caseSnapshotId,
        objectId: newUuidV7(),
        payloadHash: Buffer.from(caseFixture.digest, 'hex'),
        canonicalPayload: caseFixture.payload,
        projectContextContract: caseFixture.payload,
        contractRef: suite.closedContractRef(caseSnapshotId, caseFixture.digest),
      });
      const closureCase = async (
        tag: string,
        mutate: (row: LegacyImportRow) => LegacyImportRow,
      ): Promise<void> => {
        const caseSnapshotId = newUuidV7();
        const caseFixture = suite.legacyFixtureOf(sourceRow.canonical_payload, caseSnapshotId);
        const failure = await suite.importLegacySnapshot(
          mutate(closedImportOf(caseSnapshotId, caseFixture)),
        );
        expect(failure?.code, tag).toBe('22023');
        expect(failure?.message, tag).toContain('context snapshot legacy promoted mirror mismatch');
      };
      const tamperedContractRef = (
        row: LegacyImportRow,
        mutate: (ref: Record<string, unknown>) => void,
      ): LegacyImportRow => {
        const ref = structuredClone(row.contractRef);
        mutate(ref);
        return { ...row, contractRef: ref };
      };
      // A second contract body the payload hash does not cover (the contractRef
      // stays closed against the tampered body, so exactly the contract≡payload
      // clause fires).
      await closureCase('contract-differs', (row) => {
        const contract = { ...row.projectContextContract, wi216TamperedMember: 'contract' };
        return {
          ...row,
          projectContextContract: contract,
          contractRef: suite.closedContractRef(
            row.snapshotId,
            digestCanonicalPayload(contract).hash.toString('hex'),
          ),
        };
      });
      await closureCase('contract-ref-digest', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).digest = '0'.repeat(64);
        }),
      );
      // The digest comparison is textual: the same bytes in uppercase hex are
      // not the stored spelling.
      await closureCase('contract-ref-digest-uppercase', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).digest = (record(ref.contentHash).digest as string).toUpperCase();
        }),
      );
      await closureCase('contract-ref-object-type', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.objectType = 'zhiju.contract.context_snapshot';
        }),
      );
      await closureCase('contract-ref-object-id', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.objectId = newUuidV7();
        }),
      );
      await closureCase('contract-ref-scope', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.scope).projectId = newUuidV7();
        }),
      );
      await closureCase('contract-ref-kind', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.kind = 'OBJECT';
        }),
      );
      await closureCase('contract-ref-algorithm', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).algorithm = 'SHA-512';
        }),
      );
      await closureCase('contract-ref-canonicalization-version', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).canonicalizationVersion = '2';
        }),
      );
      // Round 5: the guard additionally closes `contract_ref` against the
      // registered `contentAddressedRef` member sets — the root exactly the
      // five keys (which also forbids the schema-optional
      // `immutableVersionId`), `scope` exactly the Project pair,
      // `contentHash` exactly the triple. Each row is otherwise fully closed,
      // so exactly the key-set clause fires.
      await closureCase('contract-ref-root-extra-member', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.wi216UnknownMember = 'member';
        }),
      );
      await closureCase('contract-ref-scope-extra-member', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.scope).wi216UnknownMember = 'member';
        }),
      );
      await closureCase('contract-ref-content-hash-extra-member', (row) =>
        tamperedContractRef(row, (ref) => {
          record(ref.contentHash).wi216UnknownMember = 'member';
        }),
      );
      // A schema-legal uuidV7, still rejected: the canonical derivation never
      // emits `immutableVersionId` and no authority binds a version id here.
      await closureCase('contract-ref-immutable-version-id', (row) =>
        tamperedContractRef(row, (ref) => {
          ref.immutableVersionId = newUuidV7();
        }),
      );

      const ownerUpdate = await suite.ownerStatement(
        'UPDATE task_execution.context_snapshot_legacy SET source_system = $2 WHERE object_id = $1',
        [legacyObjectId, 'tampered'],
      );
      expect(ownerUpdate.failure).toBeNull();
      expect(ownerUpdate.rowCount).toBe(0);
      const ownerDelete = await suite.ownerStatement(
        'DELETE FROM task_execution.context_snapshot_legacy WHERE object_id = $1',
        [legacyObjectId],
      );
      expect(ownerDelete.failure).toBeNull();
      expect(ownerDelete.rowCount).toBe(0);
      const superuserUpdate = await suite.track(
        suite.admin
          .query(
            'UPDATE task_execution.context_snapshot_legacy SET source_system = $2 WHERE object_id = $1',
            [legacyObjectId, 'tampered'],
          )
          .then(
            () => null,
            (error: unknown) => failureOf(error),
          ),
      );
      expect(superuserUpdate?.code).toBe('23514');
      const superuserDelete = await suite.track(
        suite.admin
          .query('DELETE FROM task_execution.context_snapshot_legacy WHERE object_id = $1', [
            legacyObjectId,
          ])
          .then(
            () => null,
            (error: unknown) => failureOf(error),
          ),
      );
      expect(superuserDelete?.code).toBe('23514');

      const uncoveredId = newUuidV7();
      const uncoveredFixture = suite.legacyFixtureOf(sourceRow.canonical_payload, uncoveredId);
      const rlsDenied = await suite.importLegacySnapshot(
        {
          ...baseImport,
          snapshotId: uncoveredId,
          objectId: newUuidV7(),
          payloadHash: Buffer.from(uncoveredFixture.digest, 'hex'),
          canonicalPayload: uncoveredFixture.payload,
          projectContextContract: uncoveredFixture.payload,
          contractRef: suite.closedContractRef(uncoveredId, uncoveredFixture.digest),
        },
        { allowedProjectIds: [newUuidV7()] },
      );
      expect(rlsDenied?.code).toBe('42501');

      const mislabeledId = newUuidV7();
      const mislabeledFixture = suite.legacyFixtureOf(sourceRow.canonical_payload, mislabeledId);
      const wrongObjectType = await suite.importLegacySnapshot({
        ...baseImport,
        snapshotId: mislabeledId,
        objectId: newUuidV7(),
        objectType: CONTEXT_SNAPSHOT_OBJECT,
        payloadHash: Buffer.from(mislabeledFixture.digest, 'hex'),
        canonicalPayload: mislabeledFixture.payload,
        projectContextContract: mislabeledFixture.payload,
        contractRef: suite.closedContractRef(mislabeledId, mislabeledFixture.digest),
      });
      expect(wrongObjectType?.code).toBe('23514');

      const unprovenancedId = newUuidV7();
      const unprovenancedFixture = suite.legacyFixtureOf(
        sourceRow.canonical_payload,
        unprovenancedId,
      );
      const emptyProvenance = await suite.importLegacySnapshot({
        ...baseImport,
        snapshotId: unprovenancedId,
        objectId: newUuidV7(),
        payloadHash: Buffer.from(unprovenancedFixture.digest, 'hex'),
        canonicalPayload: unprovenancedFixture.payload,
        projectContextContract: unprovenancedFixture.payload,
        contractRef: suite.closedContractRef(unprovenancedId, unprovenancedFixture.digest),
        provenance: { manifestId: '' },
      });
      expect(emptyProvenance?.code).toBe('23514');

      // None of the failed imports left a row, and the imported row kept its
      // stored values through every tamper attempt.
      expect(await suite.countRows('task_execution.context_snapshot_legacy')).toBe(
        legacyCountBefore + 1,
      );
      expect((await suite.legacySnapshotRow(legacyObjectId))?.source_system).toBe(
        'wi216-legacy-source-system',
      );
    },
  );

  suite.itIntegration(
    'TE-217-D-002 authorizes the DRAFT dependency read on its own grant',
    async () => {
      // The published Purpose this entry reuses verbatim (Spec 001 §15.9:
      // `WORK_ORDER_DRAFT_READ_PURPOSE` of the owning IdentityPolicy module).
      const DRAFT_READ_PURPOSE = 'execution.work_order.draft.read';
      const draftCapability = contextSnapshotCapabilityCodes.contextSnapshotDraftReadV11;

      // The positive build: one COMMITTED build carries two Decisions — the
      // caller-presented build Decision and the fresh §15.9 DRAFT
      // dependency-read Decision, minted for the *complete* draftSnapshotRef
      // under this entry's own capability, never the build Decision reused.
      const decisionsBefore = await suite.draftReadDecisionRows();
      const positiveEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-217002-ok' });
      const buildDecisionId = record(positiveEnvelope.authorizationDecisionRef).objectId as string;
      const payloadDigest = digestCanonicalPayload(
        positiveEnvelope.payload as CanonicalJsonObject,
      ).hash;
      const positive = await suite.attemptBuild(positiveEnvelope);
      expect(positive, JSON.stringify(positive)).toMatchObject({
        code: 'COMMITTED',
        thrown: false,
      });
      const decisionsAfter = await suite.draftReadDecisionRows();
      expect(decisionsAfter).toHaveLength(decisionsBefore.length + 1);
      const draftDecision = decisionsAfter.find(
        (row) =>
          !decisionsBefore.some(
            (prior) => prior.authorization_decision_id === row.authorization_decision_id,
          ),
      );
      if (draftDecision === undefined)
        throw new Error('the DRAFT dependency-read Decision is missing');
      expect(draftDecision.authorization_decision_id).not.toBe(buildDecisionId);
      expect(draftDecision).toMatchObject({
        command_type: BUILD_COMMAND,
        command_version: BUILD_VERSION,
        purpose: DRAFT_READ_PURPOSE,
        requested_capability: draftCapability,
        target_object_type: DRAFT_SNAPSHOT_OBJECT,
        target_object_id: suite.goldenDraftRef.objectId,
        policy_snapshot_id: POLICY_SNAPSHOT_ID,
        principal_id: OPERATOR,
        actor_snapshot_id: OPERATOR_ACTOR,
      });
      expect(draftDecision.command_payload_hash.equals(payloadDigest)).toBe(true);
      // The canonical payload binds the complete draftSnapshotRef field by
      // field (Spec 001 §15.9 rule 2; an absent immutableVersionId stays absent).
      expect(record(draftDecision.canonical_payload).draftSnapshotRef).toEqual({
        kind: 'CONTENT_ADDRESSED',
        objectType: DRAFT_SNAPSHOT_OBJECT,
        objectId: suite.goldenDraftRef.objectId,
        scope: { enterpriseId: suite.fixture.enterpriseId, projectId: suite.fixture.projectId },
        contentHash: {
          algorithm: 'SHA-256',
          digest: suite.goldenDraftRef.contentHash.digest,
          canonicalizationVersion: '1',
        },
      });
      // Exactly one Receipt — the build's own; the dependency read leaves no
      // Receipt of its own and never replays a historical one.
      expect(await suite.receiptRows('wi216-217002-ok')).toHaveLength(1);

      // Every refusal before the handler leaves zero TaskExecution facts, zero
      // new DRAFT-purpose Decisions and no Receipt; a Grant-driven denial adds
      // exactly one masked IdentityPolicy DENIED audit.
      const denyCase = async (input: {
        tag: string;
        principal?: Principal;
        entry?: InitialContextEntry;
        draftRef?: unknown;
        decisionNow?: Date;
        code: string;
        auditError?: string;
      }): Promise<void> => {
        const principal = input.principal ?? suite.operator();
        const factsBefore = await suite.teFactCounts();
        const priorDecisions = await suite.draftReadDecisionRows();
        const priorAudits = await suite.ipDraftReadDeniedAudits(
          principal.principalId,
          suite.goldenDraftRef.objectId,
        );
        const envelope = await suite.preparedBuild({
          idempotencyKey: `wi216-217002-${input.tag}`,
          principal,
          ...(input.draftRef !== undefined ? { draftRef: input.draftRef } : {}),
          ...(input.decisionNow !== undefined ? { decisionNow: input.decisionNow } : {}),
        });
        const attempt = await suite.attemptBuild(
          envelope,
          input.entry ?? suite.initialContextEntry,
          principal,
        );
        expect(attempt, input.tag).toMatchObject({ code: input.code, thrown: true });
        expect(await suite.teFactCounts(), `${input.tag} moved TaskExecution facts`).toEqual(
          factsBefore,
        );
        expect(await suite.draftReadDecisionRows(), `${input.tag} minted a DRAFT Decision`).toEqual(
          priorDecisions,
        );
        const audits = await suite.ipDraftReadDeniedAudits(
          principal.principalId,
          suite.goldenDraftRef.objectId,
        );
        if (input.auditError === undefined) {
          expect(audits, `${input.tag} wrote an IdentityPolicy audit`).toEqual(priorAudits);
        } else {
          expect(audits).toHaveLength(priorAudits.length + 1);
          expect(audits.at(-1)).toMatchObject({
            outcome: 'DENIED',
            error_code: input.auditError,
            command_type: BUILD_COMMAND,
            target_type: DRAFT_SNAPSHOT_OBJECT,
            target_id: suite.goldenDraftRef.objectId,
            principal_id: principal.principalId,
          });
        }
        await suite.expectNoContextSnapshot(
          record(envelope.targetRef).objectId as string,
          `wi216-217002-${input.tag}`,
          'ABSENT',
        );
      };

      // Grant missing: the second principal holds the build Grant (TE-214-D-007
      // granted it and nothing revoked it — a second ACTIVE Grant of the same
      // capability and Scope would be IDENTITY_CAPABILITY_ALREADY_ACTIVE) but no
      // DRAFT dependency-read Grant at all. This case runs before the expired
      // one, which leaves the second principal an expired DRAFT Grant row.
      await denyCase({
        tag: 'missing',
        principal: suite.other(),
        code: AUTHORIZATION_REVOKED,
        auditError: 'NO_ACTIVE_GRANT',
      });

      // Grant expired: a DRAFT Grant whose validity window has ended by the
      // entry's trusted instant (the row exists — the denial is the expired
      // window, not the missing Grant of the case above).
      const expiringGrantId = await suite.grant({
        principal: suite.other(),
        capabilityCode: draftCapability,
        action: ACTIONS.ctxDraftRead,
        selectorType: 'TARGET_TYPE',
        targetObjectType: DRAFT_SNAPSHOT_OBJECT,
        validTo: new Date(Date.now() + 60_000),
      });
      const moved = new Date(Date.now() + 120_000);
      await denyCase({
        tag: 'expired',
        principal: suite.other(),
        entry: suite.entryFor({ now: () => moved }),
        decisionNow: new Date(),
        code: AUTHORIZATION_REVOKED,
        auditError: 'NO_ACTIVE_GRANT',
      });
      const expiringGrant = (
        await suite.admin.query<{ valid_to: Date | null }>(
          `SELECT valid_to FROM identity_policy.capability_grant
          WHERE id = $1`,
          [expiringGrantId],
        )
      ).rows.at(0);
      if (expiringGrant?.valid_to == null) {
        throw new Error('the expiring grant kept no valid_to');
      }
      expect(expiringGrant.valid_to.getTime()).toBeLessThan(moved.getTime());

      // Grant revoked between the Decision and the build.
      const revoked = await suite.revokeCapabilityTracked(
        suite.identityDeps([suite.fixture.projectId]),
        {
          targetId: suite.grantCtxDraftRead,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: suite.fixture.enterpriseId,
            projectId: suite.fixture.projectId,
          },
          reasonCode: 'WI216_REVOKE_DRAFT_READ',
          effectiveAt: new Date(suite.clock),
          idempotencyKey: `wi216:revoke:${suite.grantCtxDraftRead}`,
        },
      );
      expect(revoked.status).toBe('COMMITTED');
      await denyCase({
        tag: 'revoked',
        code: AUTHORIZATION_REVOKED,
        auditError: 'NO_ACTIVE_GRANT',
      });
      suite.grantCtxDraftRead = await suite.grant({
        capabilityCode: draftCapability,
        action: ACTIONS.ctxDraftRead,
        selectorType: 'TARGET_TYPE',
        targetObjectType: DRAFT_SNAPSHOT_OBJECT,
      });

      // Grant Policy Snapshot drift: the covering Grant is bound to a Policy
      // Snapshot that is not current (not yet effective at the trusted
      // instant), so no *current* Grant covers the read.
      const driftSnapshotId = newUuidV7();
      const driftSnapshot = await suite.recordPolicySnapshotTracked(suite.identityDeps([]), {
        policySnapshotId: driftSnapshotId,
        policySetVersion: `wi216-drift-policy-set-${newUuidV7()}`,
        policySchemaRefs: ['identity.PolicySnapshot@1.0'],
        effectiveFrom: new Date(suite.clock + 24 * 60 * 60 * 1000),
        policyDocument: { rules: ['initial-context-authorization'], version: 2 },
        idempotencyKey: `wi216:policy:${newUuidV7()}`,
      });
      expect(driftSnapshot.status).toBe('COMMITTED');
      const driftSnapshotRow = (
        await suite.admin.query<{ payload_hash: Buffer }>(
          'SELECT payload_hash FROM identity_policy.policy_snapshot WHERE policy_snapshot_id = $1',
          [driftSnapshotId],
        )
      ).rows.at(0);
      if (driftSnapshotRow === undefined)
        throw new Error('the drift Policy Snapshot row is missing');
      const revokeForDrift = await suite.revokeCapabilityTracked(
        suite.identityDeps([suite.fixture.projectId]),
        {
          targetId: suite.grantCtxDraftRead,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: suite.fixture.enterpriseId,
            projectId: suite.fixture.projectId,
          },
          reasonCode: 'WI216_DRIFT_DRAFT_READ',
          effectiveAt: new Date(suite.clock),
          idempotencyKey: `wi216:revoke:${suite.grantCtxDraftRead}`,
        },
      );
      expect(revokeForDrift.status).toBe('COMMITTED');
      const driftGrantId = await suite.grant({
        capabilityCode: draftCapability,
        action: ACTIONS.ctxDraftRead,
        selectorType: 'TARGET_TYPE',
        targetObjectType: DRAFT_SNAPSHOT_OBJECT,
        grantPolicySnapshot: { id: driftSnapshotId, hash: driftSnapshotRow.payload_hash },
      });
      await denyCase({
        tag: 'policy-drift',
        code: AUTHORIZATION_REVOKED,
        auditError: 'GRANT_POLICY_SNAPSHOT_NOT_CURRENT',
      });
      const revokeDrift = await suite.revokeCapabilityTracked(
        suite.identityDeps([suite.fixture.projectId]),
        {
          targetId: driftGrantId,
          expectedAggregateVersion: '1',
          scope: {
            scopeKind: 'PROJECT',
            enterpriseId: suite.fixture.enterpriseId,
            projectId: suite.fixture.projectId,
          },
          reasonCode: 'WI216_DRIFT_CLEANUP',
          effectiveAt: new Date(suite.clock),
          idempotencyKey: `wi216:revoke:${driftGrantId}`,
        },
      );
      expect(revokeDrift.status).toBe('COMMITTED');
      suite.grantCtxDraftRead = await suite.grant({
        capabilityCode: draftCapability,
        action: ACTIONS.ctxDraftRead,
        selectorType: 'TARGET_TYPE',
        targetObjectType: DRAFT_SNAPSHOT_OBJECT,
      });

      // Target substitution, shape layer: the registered Envelope pins the
      // object type spelling (the TE-214-D-002 legacy-spelling evidence), and
      // a foreign Scope fails the Port's Scope check (the TE-214-D-002
      // wrong-scope evidence) — both before any DRAFT fact read or Decision.
      await denyCase({
        tag: 'target-type',
        draftRef: { ...suite.goldenDraftRef, objectType: 'execution.work_order_draft_snapshot' },
        code: API_VALUE_INVALID,
      });
      await denyCase({
        tag: 'target-scope',
        draftRef: {
          ...suite.goldenDraftRef,
          scope: { enterpriseId: newUuidV7(), projectId: newUuidV7() },
        },
        code: IDENTITY_CONTEXT_SNAPSHOT_TARGET_INVALID,
      });

      // Target substitution, content layer (observed layer, header note): the
      // Port binds the substituted address into a fresh Decision of its own
      // and the owning store's by-identity read misses — never the build
      // Decision, never a silent pass.
      const handlerCase = async (tag: string, draftRef: unknown): Promise<void> => {
        const priorDecisions = await suite.draftReadDecisionRows();
        const envelope = await suite.preparedBuild({
          idempotencyKey: `wi216-217002-${tag}`,
          draftRef,
        });
        const attempt = await suite.attemptBuild(envelope);
        expect(attempt, tag).toMatchObject({ code: REFERENCE_INVALID, thrown: false });
        expect((await suite.draftReadDecisionRows()).length).toBe(priorDecisions.length + 1);
        await suite.expectNoContextSnapshot(
          record(envelope.targetRef).objectId as string,
          `wi216-217002-${tag}`,
        );
      };
      await handlerCase('target-id', { ...suite.goldenDraftRef, objectId: newUuidV7() });
      await handlerCase('target-hash', {
        ...suite.goldenDraftRef,
        contentHash: contentHash('0'.repeat(64)),
      });
    },
  );

  suite.itIntegration(
    'TE-217-D-003 validates the complete ContextSnapshotBuilt@1.1 envelope',
    async () => {
      const buildEnvelope = await suite.preparedBuild({ idempotencyKey: 'wi216-217003-build' });
      const built = await suite.attemptBuild(buildEnvelope);
      expect(built, JSON.stringify(built)).toMatchObject({ code: 'COMMITTED', thrown: false });
      if (built.result === undefined) throw new Error('the 217-003 build did not commit');
      const targetId = record(buildEnvelope.targetRef).objectId as string;
      const snapshotRow = await suite.contextSnapshotRow(targetId);
      if (snapshotRow === undefined) throw new Error('the 217-003 snapshot row is missing');
      const outbox = await suite.outboxRows(targetId);
      expect(outbox).toHaveLength(1);
      const event = outbox[0];
      if (event === undefined) throw new Error('the 217-003 outbox row is missing');
      expect(event).toMatchObject({
        event_type: 'execution.ContextSnapshotBuilt',
        event_version: '1.1',
        aggregate_version: '1',
        canonicalization_version: '1',
        correlation_id: record(buildEnvelope).correlationId,
        causation_id: record(buildEnvelope).commandId,
        source_command_id: record(buildEnvelope).commandId,
        created_by_principal_id: OPERATOR,
      });

      // The stored payload is exactly the closed four public members plus the
      // runner's two Scope mirrors, and the stored hash recomputes over those
      // six keys (§20.3).
      const storedPayload = record(event.payload);
      expect(Object.keys(storedPayload).sort()).toEqual([
        'contextSnapshotRef',
        'coverageStatus',
        'enterpriseId',
        'projectId',
        'projectionType',
        'workOrderRef',
      ]);
      expect(
        event.payload_hash.equals(
          digestCanonicalPayload(event.payload as CanonicalJsonObject).hash,
        ),
      ).toBe(true);
      const publicPayload = {
        contextSnapshotRef: storedPayload.contextSnapshotRef,
        workOrderRef: storedPayload.workOrderRef,
        projectionType: storedPayload.projectionType,
        coverageStatus: storedPayload.coverageStatus,
      } as unknown as CanonicalJsonObject;
      const integrityOf = (payload: CanonicalJsonObject): CanonicalJsonObject => ({
        canonicalizationVersion: '1',
        payloadHash: {
          algorithm: 'SHA-256',
          digest: digestCanonicalPayload(payload).hash.toString('hex'),
          canonicalizationVersion: '1',
        },
      });

      // The complete public Event envelope, rebuilt member-by-member from the
      // committed facts — the stored event id, causation, correlation, command
      // and creator columns, the stored instant (the Snapshot payload's own
      // `asOf`) and the four public payload members — validates strictly
      // against the real ContractRegistry.
      const occurredAt = event.occurred_at.toISOString();
      expect(record(snapshotRow.canonical_payload).asOf).toBe(occurredAt);
      const publicEnvelope = {
        eventId: event.event_id,
        eventType: 'execution.ContextSnapshotBuilt',
        eventVersion: '1.1',
        producerModule: 'task-execution',
        aggregateType: CONTEXT_SNAPSHOT_OBJECT,
        aggregateId: targetId,
        aggregateVersion: 1,
        scopeRef: { enterpriseId: suite.fixture.enterpriseId, projectId: suite.fixture.projectId },
        correlationId: event.correlation_id,
        causationId: event.causation_id,
        commandId: event.source_command_id,
        actorRef: {
          kind: 'OBJECT',
          objectType: PRINCIPAL_OBJECT,
          objectId: event.created_by_principal_id,
          scope: { enterpriseId: suite.fixture.enterpriseId },
        },
        occurredAt,
        dataClassification: 'INTERNAL',
        payload: publicPayload,
        integrity: integrityOf(publicPayload),
      } as unknown as CanonicalJsonObject;
      const validation = suite.registry.validateOperation(
        'execution.ContextSnapshotBuilt',
        '1.1',
        publicEnvelope,
      );
      expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);

      // A Scope member or any extra member inside the payload fails the closed
      // four-member Schema; an off-table enum value fails even when it is a
      // well-formed NamespaceCode.
      const withPayload = (mutate: (payload: Record<string, unknown>) => void) => {
        const mutated = structuredClone(publicPayload) as Record<string, unknown>;
        mutate(mutated);
        return suite.registry.validateOperation('execution.ContextSnapshotBuilt', '1.1', {
          ...publicEnvelope,
          payload: mutated,
          integrity: integrityOf(mutated as CanonicalJsonObject),
        });
      };
      expect(
        withPayload((mutated) => {
          mutated.enterpriseId = suite.fixture.enterpriseId;
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.projectId = suite.fixture.projectId;
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.unexpectedMember = 'wi216';
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.projectionType = 'coordinator';
        }).valid,
      ).toBe(false);
      expect(
        withPayload((mutated) => {
          mutated.coverageStatus = 'complete_for_purpose';
        }).valid,
      ).toBe(false);

      // @1.0 stays registered and frozen — its historical NamespaceCode fields
      // still validate against the unchanged @1.0 Schema — but the corrected
      // build never emits it: no @1.0 row of this event exists in the table.
      const frozenPayload = {
        contextSnapshotRef: storedPayload.contextSnapshotRef,
        workOrderRef: storedPayload.workOrderRef,
        projectionType: 'coordinator',
        coverageStatus: 'complete_for_purpose',
      } as unknown as CanonicalJsonObject;
      const frozen = suite.registry.validateOperation('execution.ContextSnapshotBuilt', '1.0', {
        ...publicEnvelope,
        eventVersion: '1.0',
        payload: frozenPayload,
        integrity: integrityOf(frozenPayload),
      });
      expect(frozen.valid, JSON.stringify(frozen.errors)).toBe(true);
      const legacyEvents = await suite.admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM task_execution.outbox_event
        WHERE event_type = 'execution.ContextSnapshotBuilt' AND event_version = '1.0'`,
      );
      expect(legacyEvents.rows.at(0)?.n).toBe(0);

      // The Catalog counts the matrix pins (also asserted in TE-214-D-016):
      // 221 operations total, 49 owned by TaskExecution, the historical
      // 200-entry v1.0 Baseline untouched.
      const catalog = JSON.parse(readFileSync(PUBLIC_API_CATALOG, 'utf8')) as {
        operations: { type: string; version: string; kind: string; owner: string }[];
      };
      expect(catalog.operations).toHaveLength(240);
      expect(
        catalog.operations.filter((operation) => operation.owner === 'task-execution'),
      ).toHaveLength(63);
      const baseline = JSON.parse(readFileSync(COMPATIBILITY_BASELINE, 'utf8')) as
        { type: string }[] | { operations: { type: string }[] };
      expect(Array.isArray(baseline) ? baseline : baseline.operations).toHaveLength(200);
    },
  );

  suite.itIntegration('TE-217-D-004 determinizes the Source Slice total order', async () => {
    // Unit layer on the real committed slice payloads (the TE-214-D-017
    // convention): the total order belongs to the owning assembly; the
    // entry-level permutation stability of a real build is TE-214-D-003③.
    const sliceA = await suite.slicePayloadOf(suite.sliceARef.objectId);
    const sliceB = await suite.slicePayloadOf(suite.sliceBRef.objectId);
    const refFor = (objectId: string, digest: string): Common.ContentAddressedRef =>
      ({
        kind: 'CONTENT_ADDRESSED',
        objectType: SLICE_OBJECT,
        objectId,
        scope: suite.scope(),
        contentHash: contentHash(digest),
      }) as unknown as Common.ContentAddressedRef;
    const payloadFor = (
      slice: Record<string, unknown>,
      objectId: string,
    ): Record<string, unknown> => {
      const cloned = structuredClone(slice);
      cloned.sliceId = objectId;
      return cloned;
    };

    // A'' carries the smaller objectId with the LARGER hash digest, B'' the
    // reverse: an implementation that compared any hash member before the
    // object identity would order them backwards.
    const aId = '00000000-0000-7000-8000-000000000001';
    const bId = 'ffffffff-ffff-7fff-bfff-ffffffffffff';
    const aRef = refFor(aId, 'f'.repeat(64));
    const bRef = refFor(bId, '0'.repeat(64));
    expect(
      suite.compareOrderTuples(suite.sliceOrderTuple(aRef), suite.sliceOrderTuple(bRef)),
    ).toBeLessThan(0);

    const pairForward = await suite.unitAssemblyInput({
      slices: [
        { ref: aRef, slice: payloadFor(sliceA, aId) },
        { ref: bRef, slice: payloadFor(sliceB, bId) },
      ],
    });
    const pairReverse = await suite.unitAssemblyInput({
      slices: [
        { ref: bRef, slice: payloadFor(sliceB, bId) },
        { ref: aRef, slice: payloadFor(sliceA, aId) },
      ],
    });
    const pairIdentity = {
      snapshotId: pairForward.snapshotId,
      asOf: pairForward.asOf,
      correlationId: pairForward.correlationId,
    };
    const forward = assembleInitialContext(pairForward);
    const reverse = assembleInitialContext({ ...pairReverse, ...pairIdentity });
    if (forward.outcome !== 'ASSEMBLED' || reverse.outcome !== 'ASSEMBLED') {
      throw new Error('the reverse-ordered fixture did not assemble');
    }
    // Every permutation produces the identical payload, metadata and hashes.
    expect(reverse.payload).toEqual(forward.payload);
    expect(reverse.metadata).toEqual(forward.metadata);
    expect(
      digestCanonicalPayload(reverse.payload).hash.equals(
        digestCanonicalPayload(forward.payload).hash,
      ),
    ).toBe(true);
    expect(
      digestCanonicalPayload(reverse.metadata).hash.equals(
        digestCanonicalPayload(forward.metadata).hash,
      ),
    ).toBe(true);
    // sourceSlices[] opens with A'' — the object identity decides, not the
    // reversed hash members.
    const pairSliceRefs = forward.metadata.sliceRefs as Record<string, unknown>[];
    expect(pairSliceRefs.map((ref) => ref.objectId)).toEqual([aId, bId]);
    // The fact order is the slice's own array order and the deterministic
    // contextItemIds recompute from A''.objectId at the in-slice indices —
    // the UUIDv7 inputs never see the request's permutation.
    const factItems = record(sliceA.source).factItems as unknown[];
    const items = forward.payload.contextItems as Record<string, unknown>[];
    expect(items).toHaveLength(factItems.length);
    const asOfMilliseconds = new Date(forward.payload.asOf as string).getTime();
    for (const [index, factItem] of factItems.entries()) {
      expect(items[index]?.contextItemId).toBe(
        suite.recomputeContextItemId(asOfMilliseconds, factItem, aId, index),
      );
    }

    // Three slices (C'' a second slice-B body under a middle identity) in
    // all six permutations: one outcome.
    const cId = '77777777-7777-7777-8777-777777777777';
    const cRef = refFor(cId, '7'.repeat(64));
    interface SliceEntry {
      ref: Common.ContentAddressedRef;
      slice: Record<string, unknown>;
    }
    const trio: [SliceEntry, SliceEntry, SliceEntry] = [
      { ref: aRef, slice: payloadFor(sliceA, aId) },
      { ref: cRef, slice: payloadFor(sliceB, cId) },
      { ref: bRef, slice: payloadFor(sliceB, bId) },
    ];
    const trioInput = await suite.unitAssemblyInput({ slices: trio });
    const trioIdentity = {
      snapshotId: trioInput.snapshotId,
      asOf: trioInput.asOf,
      correlationId: trioInput.correlationId,
    };
    const first = assembleInitialContext(trioInput);
    if (first.outcome !== 'ASSEMBLED') throw new Error('the trio fixture did not assemble');
    expect(
      (first.metadata.sliceRefs as Record<string, unknown>[]).map((ref) => ref.objectId),
    ).toEqual([aId, cId, bId]);
    for (const order of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ] as const) {
      const permuted = assembleInitialContext({
        ...(await suite.unitAssemblyInput({ slices: order.map((index) => trio[index]) })),
        ...trioIdentity,
      });
      expect(permuted.outcome).toBe('ASSEMBLED');
      if (permuted.outcome === 'ASSEMBLED') {
        expect(permuted.payload).toEqual(first.payload);
        expect(permuted.metadata).toEqual(first.metadata);
      }
    }

    // Fail closed: the exact duplicate pair, the tuple collision whose
    // canonical refs differ (`immutableVersionId` absent vs present-as-empty
    // bind to the same order key — no unranked-member tiebreak is invented),
    // and the duplicated fact inside one slice (two items, one subject
    // identity) all reject EXECUTION_CONTEXT_SOURCE_INVALID.
    const duplicate = assembleInitialContext(
      await suite.unitAssemblyInput({
        slices: [
          { ref: aRef, slice: payloadFor(sliceA, aId) },
          { ref: aRef, slice: payloadFor(sliceA, aId) },
        ],
      }),
    );
    expect(duplicate).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
    const collision = assembleInitialContext(
      await suite.unitAssemblyInput({
        slices: [
          { ref: aRef, slice: payloadFor(sliceA, aId) },
          { ref: { ...aRef, immutableVersionId: '' }, slice: payloadFor(sliceA, aId) },
        ],
      }),
    );
    expect(collision).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
    const duplicatedFacts = payloadFor(sliceA, aId);
    record(duplicatedFacts.source).factItems = [
      structuredClone(factItems[0]),
      ...factItems,
    ] as unknown[];
    const inSliceDuplicate = assembleInitialContext(
      await suite.unitAssemblyInput({
        slices: [
          { ref: aRef, slice: duplicatedFacts },
          { ref: bRef, slice: payloadFor(sliceB, bId) },
        ],
      }),
    );
    expect(inSliceDuplicate).toMatchObject({
      outcome: 'REJECTED',
      errorCode: EXECUTION_CONTEXT_SOURCE_INVALID,
    });
  });
}
