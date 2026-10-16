import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  ContractRegistry,
  operationPayloadSchemaRef,
  preparationHash,
  type Common,
  type CustomerZipIntakePayload,
  type WorkspaceCommandInput,
} from '@zhiju/contracts';
import { zipCrc32 } from '@zhiju/integration-gateway';
import { createPreparationJourneyFixture } from './preparation-journey-fixture.js';
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
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
describe.skipIf(!databaseUrl)('actual IP EP IG preparation owning journey', () => {
  const unregisteredTaskPort = {
    create: vi.fn(() => Promise.reject(new Error('UNREGISTERED_TE_MUST_NOT_RUN'))),
    request: vi.fn(() => Promise.reject(new Error('UNREGISTERED_TE_MUST_NOT_RUN'))),
    read: vi.fn(() => Promise.reject(new Error('UNREGISTERED_TE_MUST_NOT_RUN'))),
  };
  let initialized: Awaited<ReturnType<typeof createPreparationJourneyFixture>> | undefined;
  function current() {
    if (!initialized) throw new Error('Journey fixture unavailable');
    return initialized;
  }
  beforeAll(async () => {
    initialized = await createPreparationJourneyFixture(databaseUrl ?? '', {
      taskPort: unregisteredTaskPort,
    });
  }, 120000);
  afterAll(async () => {
    await initialized?.close();
  });
  it('publishes actual dependencies, discovers only permitted existing enterprises and creates both customer modes', async () => {
    const fixture = current();
    const registry = new ContractRegistry();
    const entry = await fixture.run((session) =>
      fixture.composition.project.findEnterprises(session, { searchText: '', page: { limit: 20 } }),
    );
    expect(
      entry.items.some(
        (item) => item.enterpriseRef.objectId === fixture.existingEnterpriseRef.objectId,
      ),
    ).toBe(true);
    expect(
      registry.validateOperationResult('project.find_preparation_enterprises', '1.0', entry),
    ).toMatchObject({ valid: true });
    for (const customer of [
      { mode: 'NEW' as const, displayName: 'New real customer' },
      { mode: 'EXISTING' as const, enterpriseRef: fixture.existingEnterpriseRef },
    ]) {
      const command = await fixture.preparationCommand(customer);
      const created = await fixture.run((session) =>
        fixture.composition.project.request(session, command),
      );
      expect(created.disposition).toBe('ACCEPTED');
      expect(
        registry.validateOperationResult('project.request_project_preparation', '1.0', created),
      ).toMatchObject({ valid: true });
      const restored = await fixture.run((session) =>
        fixture.composition.project.getRequest(session, {
          requestRef: command.targetRef,
          originalKey: command.idempotencyKey,
        }),
      );
      expect(restored.originalCommand).toEqual(command);
      expect(restored.access.status).toBe('USABLE');
    }
  }, 120000);
  it('recovers a lost actual source response without duplicate sources, then commits manifest and reads original intake after relogin', async () => {
    const fixture = current();
    const create = await fixture.preparationCommand({
        mode: 'EXISTING',
        enterpriseRef: fixture.existingEnterpriseRef,
      }),
      created = await fixture.run((session) =>
        fixture.composition.project.request(session, create),
      );
    expect(created.disposition).toBe('ACCEPTED');
    const bytes = zip();
    const { createHash } = await import('node:crypto');
    const bytesHash: Common.ContentHash = {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: createHash('sha256').update(bytes).digest('hex'),
    };
    const binding = await fixture.run((session) =>
      fixture.composition.project.getRequest(session, {
        requestRef: create.targetRef,
        originalKey: create.idempotencyKey,
      }),
    );
    const intakeRef: Common.ObjectRef = {
      kind: 'OBJECT',
      objectType: 'zhiju.integration.customer_zip_intake',
      objectId: newUuidV7(),
      scope: create.scopeRef,
    };
    const payload: CustomerZipIntakePayload = {
      projectRef: {
        kind: 'OBJECT',
        objectType: 'zhiju.project.project',
        objectId: create.scopeRef.projectId,
        scope: create.scopeRef,
      },
      preparationRequestRef: create.targetRef,
      originalPreparationKey: create.idempotencyKey,
      preparationPresetRef: binding.preparationPresetRef,
      preparationPresetHash: binding.preparationPresetHash,
      originalName: 'customer.zip',
      declaredByteLength: bytes.length,
      zipBytesSha256: bytesHash,
      intakePolicyRef: binding.intakePolicyRef,
      intakePolicyHash: binding.intakePolicyHash,
      submittedNote: 'Untrusted customer note\n原始说明',
      analysisIntent: 'ANALYZE',
    };
    const command: WorkspaceCommandInput<CustomerZipIntakePayload> = {
      commandId: newUuidV7(),
      type: 'integration.request_customer_zip_intake',
      version: '1.0',
      scopeRef: create.scopeRef,
      targetRef: intakeRef,
      idempotencyKey: `integration.request_customer_zip_intake:1.0:${intakeRef.objectId}`,
      correlationId: newUuidV7(),
      requestedAt: new Date().toISOString(),
      payload,
      integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
    };
    const receipt = await fixture.run((session) =>
      fixture.composition.integration.request(session, command),
    );
    const registry = new ContractRegistry();
    expect(registry.validateOperationResult(command.type, '1.0', receipt)).toMatchObject({
      valid: true,
    });
    if (!receipt.upload) throw new Error('Missing original upload ticket');
    const token = receipt.upload.token;
    async function* stream() {
      yield await Promise.resolve(bytes);
    }
    const acceptSource = fixture.composition.project.acceptSource.bind(fixture.composition.project);
    let responseLost = false;
    const sourceResponse = vi
      .spyOn(fixture.composition.project, 'acceptSource')
      .mockImplementation(async (...args) => {
        const committed = await acceptSource(...args);
        if (!responseLost) {
          responseLost = true;
          throw new Error('CONTROLLED_SOURCE_RESPONSE_LOSS');
        }
        return committed;
      });
    try {
      await expect(
        fixture.run((session) =>
          fixture.composition.integration.upload(session, {
            intakeId: intakeRef.objectId,
            token,
            stream: stream(),
            contentLength: bytes.length,
          }),
        ),
      ).rejects.toThrow('CONTROLLED_SOURCE_RESPONSE_LOSS');
    } finally {
      sourceResponse.mockRestore();
    }
    // The original EP source really committed. Replay resumes the persisted owning steps.
    const replay = await fixture.run((session) =>
      fixture.composition.integration.request(session, command),
    );
    expect(replay.upload).toEqual(receipt.upload);
    const relogin = await fixture.relogin();
    const result = await fixture.composition.run(relogin.access, relogin.human, (session) =>
      fixture.composition.integration.get(session, {
        scopeRef: create.scopeRef,
        payload: { by: 'INTAKE', intakeRef },
        correlationId: command.correlationId,
      }),
    );
    expect(result.custody.status).toBe('READY');
    expect(result.analysis).toMatchObject({
      status: 'WAITING_CAPABILITY',
      steps: {
        SOURCE: { status: 'COMMITTED' },
        TASK: { status: 'NOT_STARTED' },
        ANALYSIS_REQUEST: { status: 'NOT_STARTED' },
      },
    });
    expect(unregisteredTaskPort.create).not.toHaveBeenCalled();
    expect(unregisteredTaskPort.request).not.toHaveBeenCalled();
    expect(unregisteredTaskPort.read).not.toHaveBeenCalled();
    expect(result.submittedNote).toBe(payload.submittedNote);
    expect(result.originalCommand).toEqual(command);
    expect(
      registry.validateOperationResult('integration.get_customer_zip_intake', '1.0', result),
    ).toMatchObject({ valid: true });
    expect(JSON.stringify(result)).not.toContain(token);
    const operation = registry.getOperation('project.SourceMaterialAccepted', '1.0');
    if (!operation) throw new Error('Missing registered source event');
    const schema = operationPayloadSchemaRef(operation);
    if (!schema) throw new Error('Missing source event schema');
    const events = await fixture.sourceEvents(create.scopeRef.projectId);
    expect(events).toHaveLength(3);
    for (const event of events)
      expect(registry.validateCoreContract(schema, event)).toMatchObject({ valid: true });
  }, 120000);
});
