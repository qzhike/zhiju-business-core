/* eslint-disable @typescript-eslint/require-await -- Controlled stream/object protocol doubles return immediate asynchronous values. */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  type Common,
  type CustomerZipIntakePayload,
  type CustomerZipRestartPayload,
  type WorkspaceCommandInput,
  type PreparationSession,
} from '@zhiju/contracts';
import {
  createCustomerZipIntakeService,
  createCustomerZipPolicyRegistry,
  createCustomerZipTicketCodec,
  ZIP_LIMITS,
  zipCrc32,
  type CustomerZipSourceInput,
  type CustomerZipAuthorizationContext,
} from '@zhiju/integration-gateway';
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing committed result');
  return value;
}
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const enabled = Boolean(databaseUrl);
const human = newUuidV7(),
  enterprise = newUuidV7(),
  project = newUuidV7();
const scope = { enterpriseId: enterprise, projectId: project };
const ref = (objectType: string, objectId: string): Common.ObjectRef => ({
  kind: 'OBJECT',
  objectType,
  objectId,
  scope,
});
const hashBytes = (bytes: Uint8Array): Common.ContentHash => ({
  algorithm: 'SHA-256',
  canonicalizationVersion: '1',
  digest: createHash('sha256').update(bytes).digest('hex'),
});
const session: PreparationSession = {
  principalId: human,
  authenticationContextHash: preparationHash({ controlledSession: true }),
  expiresAt: '2099-01-01T00:00:00.000Z',
};
function zip(): Buffer {
  const bytes = Buffer.from('# Customer source\n'),
    name = Buffer.from('input.md'),
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
describe.skipIf(!enabled)(
  'IG preparation intake owning PostgreSQL boundary with controlled EP/object ports',
  () => {
    let admin: pg.Client, pool: pg.Pool;
    beforeAll(async () => {
      admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      await admin.query(
        "CREATE ROLE preparation_intake_probe LOGIN PASSWORD 'preparation-intake-probe' NOSUPERUSER NOBYPASSRLS",
      );
      await admin.query(
        'GRANT platform_context_establisher,integration_gateway_app TO preparation_intake_probe',
      );
      const url = new URL(databaseUrl ?? '');
      url.username = 'preparation_intake_probe';
      url.password = 'preparation-intake-probe';
      pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
    });
    afterAll(async () => {
      await pool.end();
      await admin.query('DROP ROLE preparation_intake_probe');
      await admin.end();
    });
    function fixture(inputBytes?: Buffer) {
      let clock = new Date();
      const objects = new Map<string, Buffer>(),
        sourceCalls = new Map<string, number>();
      let failHandoff = false;
      const policyRef = {
        ...ref('zhiju.integration.customer_zip_policy', newUuidV7()),
        kind: 'VERSIONED' as const,
        versionId: newUuidV7(),
      };
      const payload = {
        profile: 'zip-intake-limits@1' as const,
        limits: ZIP_LIMITS,
        allowedFormats: ['DOCX', 'UTF8_MARKDOWN'] as const,
        rejectRules: [
          'MULTI_DISK',
          'ENCRYPTED',
          'UNSAFE_PATH',
          'LINK_OR_DEVICE',
          'PATH_COLLISION',
          'CRC_MISMATCH',
          'ZIP_BOMB',
        ] as const,
        retainOriginalBytes: true as const,
        noteIsUntrustedMaterial: true as const,
        extractorProfileRef: {
          ...ref('zhiju.integration.extractor_profile', newUuidV7()),
          kind: 'VERSIONED',
          versionId: newUuidV7(),
        },
      };
      const policyHash = preparationHash(payload),
        presetRef = {
          ...ref('zhiju.project.preparation_preset', newUuidV7()),
          kind: 'VERSIONED' as const,
          versionId: newUuidV7(),
        },
        presetHash = preparationHash({ controlledPreset: true });
      const intake = ref('zhiju.integration.customer_zip_intake', newUuidV7()),
        preparation = ref('zhiju.project.preparation_request', newUuidV7()),
        bytes = inputBytes ?? zip();
      const p: CustomerZipIntakePayload = {
        projectRef: ref('zhiju.project.project', project),
        preparationRequestRef: preparation,
        originalPreparationKey: `project.request_preparation:1.0:${preparation.objectId}`,
        preparationPresetRef: presetRef,
        preparationPresetHash: presetHash,
        originalName: 'customer.zip',
        declaredByteLength: bytes.length,
        zipBytesSha256: hashBytes(bytes),
        intakePolicyRef: policyRef,
        intakePolicyHash: policyHash,
        submittedNote: 'Original\ncustomer note',
        analysisIntent: 'ANALYZE',
      };
      const original: WorkspaceCommandInput<CustomerZipIntakePayload> = {
        commandId: newUuidV7(),
        type: 'integration.request_customer_zip_intake',
        version: '1.0',
        scopeRef: scope,
        targetRef: intake,
        idempotencyKey: `integration.request_customer_zip_intake:1.0:${intake.objectId}`,
        correlationId: newUuidV7(),
        requestedAt: clock.toISOString(),
        payload: p,
        integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(p) },
      };
      const context: CustomerZipAuthorizationContext = {
        kind: 'REQUEST',
        principalId: human,
        actorSnapshotId: newUuidV7(),
        authorizationDecisionId: newUuidV7(),
        authorizationDecisionHash: Buffer.alloc(32, 42),
        authorizationDecisionExpiresAt: new Date(Date.now() + 3600000),
        enterpriseId: enterprise,
        allowedProjectIds: [project],
        correlationId: original.correlationId,
      };
      const service = createCustomerZipIntakeService({
        pool,
        clock: () => clock,
        ticketCodec: createCustomerZipTicketCodec({
          activeKeyId: 'controlled',
          keys: new Map([['controlled', Buffer.alloc(32, 12)]]),
        }),
        policyResolver: createCustomerZipPolicyRegistry([
          { policyRef, payloadHash: policyHash, payload },
        ]),
        verifySession: (s) =>
          s.principalId === human
            ? Promise.resolve()
            : Promise.reject(new Error('AUTHORIZATION_DENIED')),
        authorize: () => Promise.resolve(context),
        objectStore: {
          async put(key, value) {
            const existing = objects.get(key);
            if (existing && !existing.equals(value)) throw new Error('OBJECT_CONFLICT');
            objects.set(key, Buffer.from(value));
            return { key, sha256: hashBytes(value).digest, byteLength: value.length };
          },
          read: (key) =>
            objects.has(key)
              ? Promise.resolve(required(objects.get(key)))
              : Promise.reject(new Error('NOT_FOUND')),
          inspect: (key) =>
            Promise.resolve(
              objects.has(key)
                ? {
                    state: 'COMPLETE' as const,
                    receipt: {
                      key,
                      sha256: hashBytes(required(objects.get(key))).digest,
                      byteLength: required(objects.get(key)).length,
                    },
                  }
                : { state: 'ABSENT' as const },
            ),
        },
        owners: {
          resolvePreparation: () =>
            Promise.resolve({
              creatorId: human,
              scopeRef: scope,
              preparationPresetRef: presetRef,
              preparationPresetHash: presetHash,
              intakePolicyRef: policyRef,
              intakePolicyHash: policyHash,
              sourceWatermarks: [],
            }),
          acceptSource: (_s, input: CustomerZipSourceInput) => {
            sourceCalls.set(input.sourceId, (sourceCalls.get(input.sourceId) ?? 0) + 1);
            return Promise.resolve({
              sourceRef: {
                ...ref('SourceMaterial', input.sourceId),
                kind: 'CONTENT_ADDRESSED' as const,
                contentHash: input.bytesSha256,
              },
              validationRef: {
                ...ref('ValidationResult', input.validationId),
                kind: 'CONTENT_ADDRESSED' as const,
                contentHash: preparationHash(input.validation),
              },
              receiptRefs: [
                input.registerCommandId,
                input.validateCommandId,
                input.acceptCommandId,
              ].map((id) => ref('CommandReceipt', id)),
            });
          },
          sourceLinks: () => Promise.resolve({ hasLinks: sourceCalls.size > 0 }),
          acceptHandoff: () =>
            failHandoff
              ? Promise.reject(new Error('EP_UNAVAILABLE'))
              : Promise.resolve({ status: 'WAITING_CAPABILITY' }),
          queryHandoff: () => Promise.resolve({ status: 'WAITING_CAPABILITY' }),
        },
      });
      const restart = (query: {
        aggregateVersion: number;
        uploadState: { generation: number };
      }): WorkspaceCommandInput<CustomerZipRestartPayload> => {
        const payload: CustomerZipRestartPayload = {
          intakeRef: intake,
          originalKey: original.idempotencyKey,
          originalPayloadHash: original.integrity.payloadHash,
          expectedUploadGeneration: 1,
        };
        return {
          commandId: newUuidV7(),
          type: 'integration.restart_customer_zip_upload',
          version: '1.0',
          scopeRef: scope,
          targetRef: intake,
          expectedAggregateVersion: query.aggregateVersion,
          idempotencyKey: `integration.restart_customer_zip_upload:1.0:${intake.objectId}:2`,
          correlationId: original.correlationId,
          requestedAt: clock.toISOString(),
          payload,
          integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
        };
      };
      const query = () =>
        service.get(session, {
          scopeRef: scope,
          payload: { by: 'INTAKE', intakeRef: intake },
          correlationId: original.correlationId,
        });
      return {
        service,
        original,
        intake,
        bytes,
        query,
        restart,
        sourceCalls,
        objects,
        setClock: (value: Date) => {
          clock = value;
        },
        failHandoff: () => {
          failHandoff = true;
        },
      };
    }
    it('creates exactly one original intake/receipt and replays the same encrypted ticket under concurrent clicks', async () => {
      const f = fixture();
      const [a, b] = await Promise.all([
        f.service.request(session, f.original),
        f.service.request(session, f.original),
      ]);
      expect(a.upload).toEqual(b.upload);
      const recovered = await f.query();
      expect(recovered.originalCommand).toEqual(f.original);
      expect(recovered.submittedNote).toBe(f.original.payload.submittedNote);
      expect(JSON.stringify(recovered)).not.toContain(a.upload?.token);
      const byPreparation = await f.service.get(session, {
        scopeRef: scope,
        payload: {
          by: 'PREPARATION_REQUEST',
          preparationRequestRef: f.original.payload.preparationRequestRef,
          originalPreparationKey: f.original.payload.originalPreparationKey,
        },
        correlationId: f.original.correlationId,
      });
      expect(byPreparation).toEqual(recovered);
      expect(
        (
          await admin.query(
            'SELECT count(*) FROM integration_gateway.command_receipt WHERE target_id=$1',
            [f.intake.objectId],
          )
        ).rows[0]?.count,
      ).toBe('1');
      await expect(
        f.service.request({ ...session, principalId: newUuidV7() }, f.original),
      ).rejects.toThrow('AUTHORIZATION_DENIED');
    });
    it('proves a closed empty stream before one concurrent CAS restart and fences the old token', async () => {
      const f = fixture(),
        created = await f.service.request(session, f.original);
      async function* interrupted() {
        yield f.bytes.subarray(0, 10);
        throw new Error('DISCONNECTED');
      }
      await expect(
        f.service.upload(session, {
          intakeId: f.intake.objectId,
          token: required(created.upload).token,
          stream: interrupted(),
          contentLength: f.bytes.length,
        }),
      ).rejects.toThrow('DISCONNECTED');
      const q = await f.query();
      expect(q.uploadState.state).toBe('CLOSED_NO_OBJECT');
      expect(q.allowedActions).toEqual(['RESTART']);
      const command = f.restart(q),
        [a, b] = await Promise.all([
          f.service.restart(session, command),
          f.service.restart(session, command),
        ]);
      expect(a.upload).toEqual(b.upload);
      expect(a.upload?.generation).toBe(2);
      expect((await f.query()).restartCommand).toEqual(command);
      async function* whole() {
        yield f.bytes;
      }
      await expect(
        f.service.upload(session, {
          intakeId: f.intake.objectId,
          token: required(created.upload).token,
          stream: whole(),
          contentLength: f.bytes.length,
        }),
      ).rejects.toThrow();
      const stale = { ...command, commandId: newUuidV7(), expectedAggregateVersion: 1 };
      await expect(f.service.restart(session, stale)).rejects.toThrow(
        'IDEMPOTENCY_PAYLOAD_CONFLICT',
      );
      expect((await f.query()).uploadState.generation).toBe(2);
    });
    it('rejects restart while the old stream is still receiving, then commits real IG custody and preserves it across unavailable handoff', async () => {
      const f = fixture(),
        created = await f.service.request(session, f.original);
      let release: () => void = () => {
        throw new Error('Stream not ready');
      };
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let opened: () => void = () => {
        throw new Error('Stream not ready');
      };
      const started = new Promise<void>((resolve) => {
        opened = resolve;
      });
      async function* paused() {
        opened();
        await gate;
        yield f.bytes;
      }
      f.failHandoff();
      const uploading = f.service.upload(session, {
        intakeId: f.intake.objectId,
        token: required(created.upload).token,
        stream: paused(),
        contentLength: f.bytes.length,
      });
      await started;
      const q = await f.query();
      expect(q.uploadState.state).toBe('RECEIVING');
      expect(q.allowedActions).toEqual([]);
      await expect(f.service.restart(session, f.restart(q))).rejects.toThrow(
        'INTEGRATION_ZIP_UPLOAD_RESTART_NOT_ALLOWED',
      );
      release();
      await expect(uploading).rejects.toThrow('EP_UNAVAILABLE');
      const committed = await f.query();
      expect(committed.custody.status).toBe('READY');
      expect(committed.custody.manifestRef).toBeDefined();
      expect(committed.analysis).toEqual({ status: 'WAITING_CAPABILITY' });
      expect(f.sourceCalls.size).toBe(3);
      expect([...f.sourceCalls.values()]).toEqual([1, 1, 1]);
      expect(
        (
          await admin.query(
            'SELECT count(*) FROM integration_gateway.customer_zip_manifest WHERE intake_id=$1',
            [f.intake.objectId],
          )
        ).rows[0]?.count,
      ).toBe('1');
      expect(
        (
          await admin.query(
            "SELECT count(*) FROM integration_gateway.outbox_event WHERE aggregate_id=$1 AND event_type='integration.CustomerZipManifestCommitted'",
            [f.intake.objectId],
          )
        ).rows[0]?.count,
      ).toBe('1');
    });
    it('rolls back manifest plus receipt/outbox on an injected outbox failure and resumes only persisted source steps', async () => {
      const f = fixture(),
        created = await f.service.request(session, f.original);
      await admin.query(
        "CREATE FUNCTION integration_gateway.preparation_test_outbox_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.aggregate_id='" +
          f.intake.objectId +
          "'::uuid THEN RAISE EXCEPTION 'controlled outbox failure'; END IF; RETURN NEW; END $$",
      );
      await admin.query(
        'CREATE TRIGGER preparation_test_outbox_failure BEFORE INSERT ON integration_gateway.outbox_event FOR EACH ROW EXECUTE FUNCTION integration_gateway.preparation_test_outbox_failure()',
      );
      try {
        async function* whole() {
          yield f.bytes;
        }
        await expect(
          f.service.upload(session, {
            intakeId: f.intake.objectId,
            token: required(created.upload).token,
            stream: whole(),
            contentLength: f.bytes.length,
          }),
        ).rejects.toThrow('controlled outbox failure');
        expect(
          (
            await admin.query(
              'SELECT count(*) FROM integration_gateway.customer_zip_manifest WHERE intake_id=$1',
              [f.intake.objectId],
            )
          ).rows[0]?.count,
        ).toBe('0');
        expect(
          (
            await admin.query(
              'SELECT count(*) FROM integration_gateway.command_receipt WHERE target_id=$1',
              [f.intake.objectId],
            )
          ).rows[0]?.count,
        ).toBe('1');
      } finally {
        await admin.query(
          'DROP TRIGGER preparation_test_outbox_failure ON integration_gateway.outbox_event',
        );
        await admin.query('DROP FUNCTION integration_gateway.preparation_test_outbox_failure()');
      }
      await f.service.request(session, f.original);
      expect((await f.query()).custody.status).toBe('READY');
      expect([...f.sourceCalls.values()]).toEqual([1, 1, 1]);
    });
    it.each(['UNSAFE', 'LIMIT', 'NO_ANALYZABLE', 'CORRUPT'] as const)(
      'keeps %s content failures terminal and rejects actual owner restart',
      async (kind) => {
        const bytes = zip();
        if (kind === 'UNSAFE' || kind === 'NO_ANALYZABLE') {
          const replacement = kind === 'UNSAFE' ? '../ab.md' : 'input.tx';
          let offset = bytes.indexOf('input.md');
          while (offset >= 0) {
            bytes.write(replacement, offset, 'utf8');
            offset = bytes.indexOf('input.md', offset + 8);
          }
        } else if (kind === 'CORRUPT') {
          bytes[38] = (bytes[38] ?? 0) ^ 1;
        } else {
          const directory = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
          bytes.writeUInt32LE(52428801, directory + 24);
        }
        const f = fixture(bytes),
          created = await f.service.request(session, f.original);
        async function* stream() {
          yield bytes;
        }
        await expect(
          f.service.upload(session, {
            intakeId: f.intake.objectId,
            token: required(created.upload).token,
            stream: stream(),
            contentLength: bytes.length,
          }),
        ).rejects.toThrow();
        const query = await f.query();
        expect(query.uploadState.state).toBe('CLOSED_NO_OBJECT');
        expect(query.allowedActions).toEqual([]);
        expect(query.custody.status).toBe('FAILED');
        expect(f.sourceCalls.size).toBe(0);
        expect(f.objects.size).toBe(0);
        await expect(f.service.restart(session, f.restart(query))).rejects.toThrow(
          'INTEGRATION_ZIP_UPLOAD_RESTART_NOT_ALLOWED',
        );
        expect(
          (
            await admin.query(
              'SELECT count(*) FROM integration_gateway.customer_zip_manifest WHERE intake_id=$1',
              [f.intake.objectId],
            )
          ).rows[0]?.count,
        ).toBe('0');
      },
    );
  },
);
