import { describe, expect, it } from 'vitest';
import {
  type createEnterpriseProjectDatabase,
  handleRegisterSourceMaterial,
  PROJECT_MATERIAL_SOURCE_INVALID,
  type CommandEnvelope,
  type EnterpriseProjectTransactionContext,
} from '@zhiju/enterprise-project';
import { newUuidV7, type CanonicalJsonObject } from '@zhiju/shared-kernel';
const ENTERPRISE_A = 'a1a1a1a1-a1a1-71a1-81a1-a1a1a1a1a1a1';
const HUMAN_PRINCIPAL = 'd1d1d1d1-d1d1-71d1-81d1-d1d1d1d1d1d1';
const ACTOR_HUMAN = 'd3d3d3d3-d3d3-73d3-83d3-d3d3d3d3d3d3';
const DECISION = 'd5d5d5d5-d5d5-75d5-85d5-d5d5d5d5d5d5';
const POLICY = 'd6d6d6d6-d6d6-76d6-86d6-d6d6d6d6d6d6';
const DECISION_HASH = Buffer.alloc(32, 0x42);
const CORRELATION = 'd7d7d7d7-d7d7-77d7-87d7-d7d7d7d7d7d7';

let currentEnterpriseId = ENTERPRISE_A;

function contextFor(
  enterpriseId: string,
  allowedProjectIds: readonly string[] = [],
): EnterpriseProjectTransactionContext {
  return {
    kind: 'REQUEST',
    principalId: HUMAN_PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR_HUMAN,
    authorizationDecisionId: DECISION,
    authorizationDecisionHash: DECISION_HASH,
    authorizationDecisionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    policySnapshotId: POLICY,
    enterpriseId,
    allowedProjectIds,
    correlationId: CORRELATION,
  };
}

let envelopeCounter = 0;
function envelope(overrides: Partial<CommandEnvelope> = {}): CommandEnvelope {
  envelopeCounter += 1;
  const tail = envelopeCounter.toString(16).padStart(12, '0');
  return {
    commandId: `f4f4f4f4-f4f4-73f4-83f4-${tail}`,
    commandType: 'wi04.manual.command',
    commandVersion: '1.0',
    idempotencyScope: 'wi04',
    idempotencyKey: 'wi04-key-1',
    requestPayload: { op: 'manual' },
    enterpriseId: currentEnterpriseId,
    targetType: 'Project',
    targetId: '00000000-0000-7000-8000-000000000000',
    correlationId: CORRELATION,
    principalId: HUMAN_PRINCIPAL,
    principalKind: 'HUMAN',
    actorSnapshotId: ACTOR_HUMAN,
    authorizationDecisionId: DECISION,
    policySnapshotId: POLICY,
    ...overrides,
  };
}

function payloadEnvelope<TPayload extends object>(
  key: string,
  payload: TPayload,
  overrides: Partial<CommandEnvelope> = {},
): CommandEnvelope & { payload: TPayload } {
  return {
    ...envelope(overrides),
    requestPayload: { op: key, payload } as unknown as CanonicalJsonObject,
    idempotencyKey: `${key}-${overrides.idempotencyKey ?? 'k'}`,
    payload,
  };
}

describe('IM-03 WI-05 SourceMaterial unit validation', () => {
  it('EP-WI05-U-001 rejects an invalid descriptor before opening a database transaction', async () => {
    const enterpriseId = newUuidV7();
    const projectId = newUuidV7();
    currentEnterpriseId = enterpriseId;
    await expect(
      handleRegisterSourceMaterial(
        null as unknown as ReturnType<typeof createEnterpriseProjectDatabase>,
        contextFor(enterpriseId, [projectId]),
        payloadEnvelope(
          'wi05-unit-invalid-descriptor',
          {
            projectRef: {
              kind: 'OBJECT' as const,
              objectType: 'Project' as const,
              objectId: projectId,
              scope: { enterpriseId, projectId },
            },
            descriptor: {
              originRef: {
                system: 'feishu',
                resourceType: 'message_attachment',
                externalId: 'wi05-u001-origin',
                observedAt: '2026-08-26T00:00:00.000Z',
              },
              submittedBy: {
                kind: 'OBJECT' as const,
                objectType: 'Principal' as const,
                objectId: HUMAN_PRINCIPAL,
                scope: { enterpriseId },
              },
              receivedAt: '2026-08-26T00:00:00.000Z',
              originalName: 'u001.pdf',
              mediaType: 'application/pdf',
              byteLength: -1,
              checksum: {
                algorithm: 'SHA-256' as const,
                digest: 'a'.repeat(64),
                canonicalizationVersion: '1' as const,
              },
              stagedObjectRef: 'staging://wi05/u001',
              retentionClass: 'CUSTOMER_RECORD',
            },
          },
          { enterpriseId, projectId },
        ),
      ),
    ).rejects.toMatchObject({ code: PROJECT_MATERIAL_SOURCE_INVALID });
  });
});
