/* eslint-disable @typescript-eslint/require-await -- Controlled asynchronous port without provider IO. */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { describe, it, expect } from 'vitest';
import { newUuidV7 } from '@zhiju/shared-kernel';
import {
  preparationHash,
  type Common,
  type PreparationAnalysisRuntimePort,
  type LocalAnalysisPackage,
  type LocalAnalysisOutput,
  type WorkspaceCommandInput,
  type CustomerZipIntakePayload,
} from '@zhiju/contracts';
import { zipCrc32 } from '@zhiju/integration-gateway';
import { createPreparationJourneyFixture } from './preparation-journey-fixture.js';
const databaseUrl = process.env.ZJU_PERSISTENCE_DATABASE_URL;
const bytesHash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
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

async function submitSynthetic(
  fixture: Awaited<ReturnType<typeof createPreparationJourneyFixture>>,
) {
  const creation = await fixture.preparationCommand({
    mode: 'NEW',
    displayName: 'Synthetic analysis customer',
  });
  const project = await fixture.run((s) => fixture.composition.project.request(s, creation));
  expect(project.disposition).toBe('ACCEPTED');
  const entry = await fixture.run((s) =>
    fixture.composition.project.getRequest(s, {
      requestRef: creation.targetRef,
      originalKey: creation.idempotencyKey,
    }),
  );
  const bytes = zip(),
    id = newUuidV7(),
    scope = creation.scopeRef;
  const projectRef: Common.ObjectRef = {
    kind: 'OBJECT',
    objectType: 'zhiju.project.project',
    objectId: scope.projectId,
    scope,
  };
  const payload: CustomerZipIntakePayload = {
    projectRef,
    preparationRequestRef: creation.targetRef,
    originalPreparationKey: creation.idempotencyKey,
    preparationPresetRef: entry.preparationPresetRef,
    preparationPresetHash: entry.preparationPresetHash,
    originalName: 'customer.zip',
    declaredByteLength: bytes.length,
    zipBytesSha256: {
      algorithm: 'SHA-256',
      canonicalizationVersion: '1',
      digest: bytesHash(bytes),
    },
    intakePolicyRef: entry.intakePolicyRef,
    intakePolicyHash: entry.intakePolicyHash,
    analysisIntent: 'ANALYZE',
  };
  const command: WorkspaceCommandInput<CustomerZipIntakePayload> = {
    commandId: newUuidV7(),
    type: 'integration.request_customer_zip_intake',
    version: '1.0',
    scopeRef: scope,
    targetRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.integration.customer_zip_intake',
      objectId: id,
      scope,
    },
    idempotencyKey: 'integration.request_customer_zip_intake:1.0:' + id,
    correlationId: newUuidV7(),
    requestedAt: new Date().toISOString(),
    payload,
    integrity: { canonicalizationVersion: '1', payloadHash: preparationHash(payload) },
  };
  const intake = await fixture.run((s) => fixture.composition.integration.request(s, command));
  if (!intake.upload) throw new Error('Upload missing');
  const upload = intake.upload;
  async function* stream() {
    yield bytes;
  }
  await fixture.run((s) =>
    fixture.composition.integration.upload(s, {
      intakeId: id,
      token: upload.token,
      stream: stream(),
      contentLength: bytes.length,
    }),
  );
  const accepted = await fixture.run((s) =>
    fixture.composition.integration.get(s, {
      scopeRef: scope,
      payload: { by: 'INTAKE', intakeRef: command.targetRef },
      correlationId: command.correlationId,
    }),
  );
  expect(accepted.analysis).toMatchObject({ status: 'ACCEPTED' });
  return { creation, scope, projectRef, command, id };
}

describe.skipIf(!databaseUrl)('preparing project analysis through actual owning modules', () => {
  it.each([
    'accepted',
    'renewed-session',
    'wrong-hash',
    'wrong-run',
    'provider-error',
    'readback-drift',
    'unknown',
  ] as const)(
    'keeps the real preparation chain bounded: %s',
    async (mode) => {
      const pending: Common.ObjectRef[] = [],
        errors: unknown[] = [],
        outputs = new Map<string, LocalAnalysisOutput>();
      let calls = 0,
        offset = 0;
      let unknownAttempt: string | undefined;
      const clock = () => new Date(Date.now() + offset);
      const runtime: PreparationAnalysisRuntimePort = {
        profileHash: preparationHash({ test: 'CONTROLLED_ANALYSIS_RUNTIME_ONLY' }),
        binding: {
          profile: 'workspace.macos_manual_omp@1',
          profileHash: preparationHash({ test: 'CONTROLLED_ANALYSIS_RUNTIME_ONLY' }),
          provider: 'controlled-test',
          modelId: 'no-provider',
        },
        verify: async () => undefined,
        enqueue: async (ref) => {
          pending.push(ref);
        },
        pending: async () => pending,
        read: async (input) => {
          if (
            mode === 'unknown' &&
            (!unknownAttempt || unknownAttempt === input.attemptRef.objectId)
          ) {
            unknownAttempt = input.attemptRef.objectId;
            return { status: 'UNKNOWN' };
          }
          const output = outputs.get(input.attemptRef.objectId);
          return output
            ? {
                status: 'COMPLETE',
                output:
                  mode === 'readback-drift' ? { ...output, jsonSha256: 'f'.repeat(64) } : output,
              }
            : { status: 'NOT_INVOKED' };
        },
        invoke: async (input: LocalAnalysisPackage, revalidate) => {
          await revalidate();
          calls++;
          if (mode === 'renewed-session') {
            // Cross the five-minute authorization boundary while retaining the
            // original source and renewing the bounded Run lease each time.
            for (let round = 0; round < 3; round++) {
              offset += 240000;
              await revalidate();
            }
          }
          const narrative = '# Controlled report\nSynthetic runtime observation only.\n';
          const manifestSha256 = bytesHash(JSON.stringify(input.sources.map((s) => s.sha256)));
          const report = {
            schemaVersion: '0.2.0',
            stage: 'ANALYSIS',
            context: {
              analysisRequestKey: input.analysisRequestKey,
              inputManifestSha256: manifestSha256,
              previousReportSha256: null,
              sourceReportIds: [],
            },
            title: 'Controlled report',
            analysisCompleteness: 'PARTIAL',
            summary: 'Synthetic runtime response; business analysis is not asserted.',
            narrative: { relativePath: 'analysis-report.md', sha256: bytesHash(narrative) },
            limitations: ['CONTROLLED_TEST_ONLY'],
            readCoverage: input.sources.map((s) => ({
              sourceId: s.sourceId,
              readState: 'PARTIAL',
              scopeDescription: 'Controlled observation',
              limitations: ['CONTROLLED_TEST_ONLY'],
            })),
            evidence: [],
            protectedFacts: [],
            attentionItems: [],
            resolutionProposals: [],
            plannedFiles: [],
            templateCoverage: [],
            changes: [],
            checks: [],
            startupCandidates: [],
          };
          const reportJson = JSON.stringify(report),
            output: LocalAnalysisOutput = {
              runRef: input.runRef,
              attemptRef: input.attemptRef,
              adapterRef: input.adapterRef,
              runFencingToken: 1,
              packageHash: preparationHash({ test: input.attemptRef.objectId }),
              profileHash: runtime.profileHash,
              manifestSha256,
              jsonSha256: bytesHash(reportJson),
              markdownSha256: bytesHash(narrative),
              extractionSha256: 'a'.repeat(64),
              validationContextSha256: 'b'.repeat(64),
              observation: {
                sessionId: 'controlled-' + input.runRef.objectId,
                systemPromptSha256: 'c'.repeat(64),
                promptStatus: 'completed',
                processStopped: true,
                providerCancellationAcknowledged: false,
                eventBytes: 1,
                eventSha256: 'd'.repeat(64),
              },
              reportJson,
              narrativeMarkdown: narrative,
            };
          if (mode === 'wrong-hash') output.jsonSha256 = 'f'.repeat(64);
          if (mode === 'wrong-run') output.runRef = { ...output.runRef, objectId: newUuidV7() };
          if (mode === 'provider-error') output.observation.promptStatus = 'error';
          outputs.set(input.attemptRef.objectId, output);
          return output;
        },
      };
      const fixture = await createPreparationJourneyFixture(databaseUrl ?? '', {
        analysisRuntime: runtime,
        clock,
        shortServiceSessions: mode === 'renewed-session',
        executionError: (error) => errors.push(error),
      });
      const admin = new pg.Client({ connectionString: databaseUrl });
      await admin.connect();
      const execution = fixture.composition.execution;
      if (!execution) throw new Error('Execution missing');
      try {
        const { scope, projectRef, command } = await submitSynthetic(fixture);
        if (mode !== 'accepted' && mode !== 'renewed-session') {
          for (let i = 0; i < 100; i++) {
            const row = (
              await admin.query(
                'SELECT state FROM task_execution.preparation_analysis_request WHERE project_id=$1',
                [scope.projectId],
              )
            ).rows[0];
            if (['FAILED', 'UNKNOWN'].includes(row?.state)) break;
            await execution.tick();
            await new Promise((r) => setTimeout(r, 100));
          }
          const row = (
            await admin.query(
              'SELECT state FROM task_execution.preparation_analysis_request WHERE project_id=$1',
              [scope.projectId],
            )
          ).rows[0];
          expect(row?.state).toBe(mode === 'unknown' ? 'UNKNOWN' : 'FAILED');
          expect(calls).toBe(mode === 'unknown' ? 0 : 1);
          await execution.tick();
          await new Promise((r) => setTimeout(r, 100));
          expect(calls).toBe(mode === 'unknown' ? 0 : 1);
          await expect(
            fixture.run((s) =>
              fixture.composition.project.getPreparationAnalysisReport(s, { projectRef }),
            ),
          ).rejects.toThrow('PREPARATION_ANALYSIS_REPORT_UNAVAILABLE');
          const facts = await admin.query(
            'SELECT count(*)::int AS count FROM task_execution.agent_result_acceptance WHERE project_id=$1',
            [scope.projectId],
          );
          expect(facts.rows[0].count).toBe(0);
          if (mode === 'unknown') {
            const next = await submitSynthetic(fixture);
            for (let i = 0; i < 100; i++) {
              const reports = await admin.query(
                'SELECT report_ref FROM enterprise_project.preparation_report_head WHERE project_id=$1',
                [next.scope.projectId],
              );
              if (reports.rows[0]?.report_ref) break;
              await execution.tick();
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
            const nextReport = await fixture.run((session) =>
              fixture.composition.project.getPreparationAnalysisReport(session, {
                projectRef: next.projectRef,
              }),
            );
            expect(nextReport.content.report).toMatchObject({ title: 'Controlled report' });
            expect(calls).toBe(1);
            const original = await admin.query(
              'SELECT state FROM task_execution.preparation_analysis_request WHERE project_id=$1',
              [scope.projectId],
            );
            expect(original.rows[0].state).toBe('UNKNOWN');
          }
          return;
        }
        for (let i = 0; i < 100; i++) {
          if (errors.length) throw errors[0];
          const rows = await admin.query(
            'SELECT report_ref FROM enterprise_project.preparation_report_head WHERE project_id=$1',
            [scope.projectId],
          );
          if (rows.rows[0]?.report_ref) break;
          await execution.tick();
          await new Promise((r) => setTimeout(r, 100));
        }
        if (errors.length) throw errors[0];
        const report = await fixture.run((s) =>
          fixture.composition.project.getPreparationAnalysisReport(s, { projectRef }),
        );
        expect(report.content.report).toMatchObject({
          schemaVersion: '0.2.0',
          title: 'Controlled report',
        });
        expect(report.currentUsability.usable).toBe(true);
        expect(calls).toBe(1);
        await execution.tick();
        expect(calls).toBe(1);
        const repeated = await fixture.run((s) =>
          fixture.composition.integration.get(s, {
            scopeRef: scope,
            payload: { by: 'INTAKE', intakeRef: command.targetRef },
            correlationId: command.correlationId,
          }),
        );
        expect(repeated.analysis).toMatchObject({
          status: 'ACCEPTED',
          execution: { state: 'ACCEPTED' },
        });
        expect(calls).toBe(1);
        const reloaded = await fixture.run((s) =>
          fixture.composition.project.getPreparationAnalysisReport(s, { projectRef }),
        );
        expect(reloaded.binding).toEqual(report.binding);
        const sourceRows = await admin.query(
          "SELECT payload->'payload'->>'validUntil' AS expires FROM enterprise_project.preparation_fact WHERE kind='SOURCE' AND project_id=$1",
          [scope.projectId],
        );
        expect(new Date(sourceRows.rows[0].expires).getTime() - Date.now()).toBeGreaterThan(
          50 * 60 * 1000,
        );
        const facts = await admin.query(
          'SELECT p.status AS project_status,t.status AS task_status,w.status AS work_status,r.status AS run_status FROM enterprise_project.project p JOIN task_execution.task t USING(project_id) JOIN task_execution.work_order w USING(task_id) JOIN task_execution.run r USING(work_order_id) WHERE p.project_id=$1',
          [scope.projectId],
        );
        expect(facts.rows).toEqual([
          {
            project_status: 'PREPARING',
            task_status: 'IN_PROGRESS',
            work_status: 'COMPLETION_PENDING',
            run_status: 'SUCCEEDED',
          },
        ]);
        const deniedProject = { ...projectRef, scope: { ...scope, enterpriseId: newUuidV7() } };
        await expect(
          fixture.run((s) =>
            fixture.composition.project.getPreparationAnalysisReport(s, {
              projectRef: deniedProject,
            }),
          ),
        ).rejects.toThrow();
      } finally {
        await fixture.close();
        await admin.end();
      }
    },
    120000,
  );
});
