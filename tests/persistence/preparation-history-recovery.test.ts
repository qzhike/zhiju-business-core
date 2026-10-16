// A withdrawn dependency blocks future writes while preserving authorized history.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { zipCrc32 } from '@zhiju/integration-gateway';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  type Common,
  type CustomerZipIntakePayload,
  type WorkspaceCommandInput,
} from '@zhiju/contracts';
import { createPreparationJourneyFixture } from './preparation-journey-fixture.js';
function zip(): Buffer {
  const name = Buffer.from('customer.md'),
    bytes = Buffer.from('# Customer materials\n'),
    crc = zipCrc32(bytes),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(bytes.length, 18);
  local.writeUInt32LE(bytes.length, 22);
  local.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x800, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(bytes.length, 20);
  central.writeUInt32LE(bytes.length, 24);
  central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + bytes.length, 16);
  return Buffer.concat([local, name, bytes, central, name, end]);
}
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
describe.skipIf(!databaseUrl)(
  'preparation original-request historical recovery after template withdrawal',
  () => {
    let fixture: Awaited<ReturnType<typeof createPreparationJourneyFixture>>;
    beforeAll(async () => {
      fixture = await createPreparationJourneyFixture(databaseUrl ?? '');
    }, 120000);
    afterAll(async () => {
      await fixture.close();
    });
    it('reads the original immutable command and bound tuples as STALE, but cannot create an intake', async () => {
      const command = await fixture.preparationCommand({
        mode: 'NEW',
        displayName: 'Historical preparation customer',
      });
      const created = await fixture.run((session) =>
        fixture.composition.project.request(session, command),
      );
      expect(created.disposition).toBe('ACCEPTED');
      const preset = await fixture.composition.project.resolvePreset(
        fixture.serviceSession,
        fixture.presetSelection,
      );
      await fixture.run((session) =>
        fixture.composition.identity.withdrawMembershipTemplate(session, {
          templateRef: preset.payload.memberPolicyTemplate.ref,
          templateHash: preset.payload.memberPolicyTemplate.payloadHash,
          reasonCode: 'CONTROLLED_TEMPLATE_WITHDRAWAL',
          effectiveFrom: new Date().toISOString(),
        }),
      );
      const recovered = await fixture.run((session) =>
        fixture.composition.project.getRequest(session, {
          requestRef: command.targetRef,
          originalKey: command.idempotencyKey,
        }),
      );
      expect(recovered.disposition).toBe('STALE');
      expect(recovered.originalCommand).toEqual(command);
      expect(recovered.preparationPresetRef).toEqual(created.preparationPresetRef);
      expect(recovered.preparationPresetHash).toEqual(created.preparationPresetHash);
      expect(recovered.intakePolicyRef).toEqual(created.intakePolicyRef);
      expect(recovered.intakePolicyHash).toEqual(created.intakePolicyHash);
      expect(recovered.permittedActions).not.toContain('SUBMIT_ZIP');
      expect(recovered.steps.PROJECT.status).toBe('COMMITTED');
      expect(recovered.steps.CREATOR_ACCESS.status).toBe('COMMITTED');
      const intakeRef: Common.ObjectRef = {
        kind: 'OBJECT',
        objectType: 'zhiju.integration.customer_zip_intake',
        objectId: newUuidV7(),
        scope: command.scopeRef,
      };
      // Byte validation belongs to upload; this negative case must reject the
      // fully valid intake command at the withdrawn-dependency boundary first.
      const payload: CustomerZipIntakePayload = {
        projectRef: {
          kind: 'OBJECT',
          objectType: 'zhiju.project.project',
          objectId: command.scopeRef.projectId,
          scope: command.scopeRef,
        },
        preparationRequestRef: command.targetRef,
        originalPreparationKey: command.idempotencyKey,
        preparationPresetRef: recovered.preparationPresetRef,
        preparationPresetHash: recovered.preparationPresetHash,
        originalName: 'history.zip',
        declaredByteLength: 100,
        zipBytesSha256: {
          algorithm: 'SHA-256',
          digest: createHash('sha256').update(Buffer.alloc(100)).digest('hex'),
          canonicalizationVersion: '1',
        },
        intakePolicyRef: recovered.intakePolicyRef,
        intakePolicyHash: recovered.intakePolicyHash,
        analysisIntent: 'ANALYZE',
      };
      const intake: WorkspaceCommandInput<CustomerZipIntakePayload> = {
        commandId: newUuidV7(),
        type: 'integration.request_customer_zip_intake',
        version: '1.0',
        scopeRef: command.scopeRef,
        targetRef: intakeRef,
        idempotencyKey: `integration.request_customer_zip_intake:1.0:${intakeRef.objectId}`,
        correlationId: newUuidV7(),
        requestedAt: new Date().toISOString(),
        payload,
        integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
      };
      await expect(
        fixture.run((session) => fixture.composition.integration.request(session, intake)),
      ).rejects.toMatchObject({ code: 'PREPARATION_DEPENDENCY_STALE' });
      await expect(
        fixture.run((session) =>
          fixture.composition.integration.get(session, {
            scopeRef: command.scopeRef,
            payload: {
              by: 'PREPARATION_REQUEST',
              preparationRequestRef: command.targetRef,
              originalPreparationKey: command.idempotencyKey,
            },
            correlationId: newUuidV7(),
          }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }, 120000);
    it('returns the captured immutable source as STALE after withdrawal while retaining exact current SERVICE read authorization', async () => {
      const isolated = await createPreparationJourneyFixture(databaseUrl ?? '');
      expect(isolated.principalId).not.toBe(fixture.principalId);
      try {
        const command = await isolated.preparationCommand({
          mode: 'NEW',
          displayName: 'Historical source customer',
        });
        const created = await isolated.run((session) =>
          isolated.composition.project.request(session, command),
        );
        const bytes = zip();
        const intakeRef: Common.ObjectRef = {
          kind: 'OBJECT',
          objectType: 'zhiju.integration.customer_zip_intake',
          objectId: newUuidV7(),
          scope: command.scopeRef,
        };
        const payload: CustomerZipIntakePayload = {
          projectRef: {
            kind: 'OBJECT',
            objectType: 'zhiju.project.project',
            objectId: command.scopeRef.projectId,
            scope: command.scopeRef,
          },
          preparationRequestRef: command.targetRef,
          originalPreparationKey: command.idempotencyKey,
          preparationPresetRef: created.preparationPresetRef,
          preparationPresetHash: created.preparationPresetHash,
          intakePolicyRef: created.intakePolicyRef,
          intakePolicyHash: created.intakePolicyHash,
          originalName: 'source.zip',
          declaredByteLength: bytes.length,
          zipBytesSha256: {
            algorithm: 'SHA-256',
            canonicalizationVersion: '1',
            digest: createHash('sha256').update(bytes).digest('hex'),
          },
          submittedNote: 'Immutable source history note',
          analysisIntent: 'ANALYZE',
        };
        const intake: WorkspaceCommandInput<CustomerZipIntakePayload> = {
          commandId: newUuidV7(),
          type: 'integration.request_customer_zip_intake',
          version: '1.0',
          scopeRef: command.scopeRef,
          targetRef: intakeRef,
          idempotencyKey: `integration.request_customer_zip_intake:1.0:${intakeRef.objectId}`,
          correlationId: newUuidV7(),
          requestedAt: new Date().toISOString(),
          payload,
          integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
        };
        const receipt = await isolated.run((session) =>
          isolated.composition.integration.request(session, intake),
        );
        if (!receipt.upload) throw new Error('Missing actual upload ticket');
        const token = receipt.upload.token;
        async function* stream() {
          yield await Promise.resolve(bytes);
        }
        await isolated.run((session) =>
          isolated.composition.integration.upload(session, {
            intakeId: intakeRef.objectId,
            token,
            stream: stream(),
            contentLength: bytes.length,
          }),
        );
        const handoff = await isolated.run((session) =>
          isolated.composition.project.queryHandoff(session, intakeRef),
        );
        if (!('steps' in handoff)) throw new Error('Missing actual source handoff');
        expect(handoff.steps.SOURCE.status).toBe('COMMITTED');
        const preparationSourceRef = handoff.steps.SOURCE.refs[0] as Common.SnapshotRef;
        const input = {
          preparationSourceRef,
          purpose: 'preparation.analysis' as const,
          audience: isolated.analysisAudience,
        };
        const original = await isolated.composition.project.getSource(
          isolated.serviceSession,
          input,
        );
        expect(original.currentUsability).toBe('USABLE');
        const preset = await isolated.composition.project.resolvePreset(
          isolated.serviceSession,
          isolated.presetSelection,
        );
        await isolated.run((session) =>
          isolated.composition.identity.withdrawMembershipTemplate(session, {
            templateRef: preset.payload.memberPolicyTemplate.ref,
            templateHash: preset.payload.memberPolicyTemplate.payloadHash,
            reasonCode: 'CONTROLLED_TEMPLATE_WITHDRAWAL',
            effectiveFrom: new Date().toISOString(),
          }),
        );
        const recovered = await isolated.composition.project.getSource(
          isolated.serviceSession,
          input,
        );
        expect(recovered.currentUsability).toBe('STALE');
        expect(recovered.payload).toEqual(original.payload);
        await expect(
          isolated.composition.project.getSource(isolated.serviceSession, {
            ...input,
            preparationSourceRef: {
              ...preparationSourceRef,
              scope: { ...command.scopeRef, projectId: newUuidV7() },
            },
          }),
        ).rejects.toBeDefined();
      } finally {
        await isolated.close();
      }
    }, 120000);
  },
);
