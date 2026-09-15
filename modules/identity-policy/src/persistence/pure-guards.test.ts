import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalize } from '@zhiju/shared-kernel';
import {
  assertHashMatches,
  authorizationDecisionIntegrityHolds,
  IDENTITY_PAYLOAD_HASH_MISMATCH,
  IDENTITY_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
} from './identity-policy-repository.js';
import { digestCanonicalPayload, type SelectedAuthorizationDecision } from './identity-db.js';
import type { CanonicalJsonObject } from '@zhiju/shared-kernel';

describe('promoted mirror validation', () => {
  const payload: CanonicalJsonObject = {
    outcome: 'ALLOW',
    enterpriseId: '12121212-1212-7121-8121-1212121212a1',
    commandType: 'wi05.demo.command',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  };

  it('accepts payload columns that match the promoted values', () => {
    expect(() => {
      validatePromotedMirror(payload, {
        outcome: 'ALLOW',
        enterpriseId: '12121212-1212-7121-8121-1212121212a1',
        commandType: 'wi05.demo.command',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      });
    }).not.toThrow();
  });

  it('rejects any promoted mismatch with a stable code', () => {
    try {
      validatePromotedMirror(payload, { outcome: 'DENY' });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
    try {
      validatePromotedMirror(payload, { enterpriseId: 'other' });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
    try {
      validatePromotedMirror(payload, { effectiveFrom: new Date('2027-01-01T00:00:00Z') });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
  });

  it('rejects a missing promoted field', () => {
    try {
      validatePromotedMirror(payload, { missing: 'value' });
      expect.unreachable('missing promoted field must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PROMOTED_MIRROR_MISMATCH);
    }
  });
});

describe('canonical payload digest', () => {
  it('is SHA-256 over the shared-kernel canonical JSON (v1)', () => {
    const payload: CanonicalJsonObject = { b: 1, a: 'x', nested: { y: true, x: null } };
    const digest = digestCanonicalPayload(payload);
    expect(digest.canonicalizationVersion).toBe('1');
    expect(digest.hashAlgorithm).toBe('SHA-256');
    expect(digest.canonicalJson).toBe(canonicalize({ a: 'x', b: 1, nested: { x: null, y: true } }));
    expect(digest.hash.equals(createHash('sha256').update(digest.canonicalJson).digest())).toBe(
      true,
    );
    expect(digest.sizeBytes).toBe(Buffer.byteLength(digest.canonicalJson, 'utf8'));
  });

  it('rejects a declared hash that disagrees with the canonical bytes', () => {
    const digest = digestCanonicalPayload({ a: 'x' });
    expect(() => {
      assertHashMatches(digest, digest.hash);
    }).not.toThrow();
    expect(() => {
      assertHashMatches(digest);
    }).not.toThrow();
    try {
      assertHashMatches(digest, Buffer.alloc(32, 1));
      expect.unreachable('hash mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(IDENTITY_PAYLOAD_HASH_MISMATCH);
    }
  });
});

describe('authorization decision read-side integrity', () => {
  const DECISION_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d101';
  const ACTOR_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d102';
  const PRINCIPAL_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d103';
  const POLICY_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d104';
  const TARGET_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d105';
  const SOURCE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d106';
  const ENTERPRISE_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d107';
  const PROJECT_ID = '018f22e2-7c15-7b2e-8d86-2de956a9d108';
  const EXPIRES_AT = '2026-09-15T00:10:00.000Z';

  const decisionPayload: Record<string, unknown> = {
    authorizationDecisionId: DECISION_ID,
    actorSnapshotId: ACTOR_ID,
    actorSnapshotPayloadHash: 'aa'.repeat(32),
    principalId: PRINCIPAL_ID,
    principalKind: 'HUMAN',
    outcome: 'ALLOW',
    reasonCodes: ['ALLOWED_BY_GRANT'],
    commandType: 'execution.create_task',
    commandVersion: '2.0',
    scopeKind: 'PROJECT',
    enterpriseId: ENTERPRISE_ID,
    projectId: PROJECT_ID,
    purpose: 'execution.task.create',
    requestedCapability: 'wi200.cap.task.v2',
    commandPayloadHash: 'bb'.repeat(32),
    policySnapshotId: POLICY_ID,
    policySnapshotPayloadHash: 'cc'.repeat(32),
    authenticationContextHash: 'dd'.repeat(32),
    expiresAt: EXPIRES_AT,
    targetRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.execution.task',
      objectId: TARGET_ID,
      scope: { enterpriseId: ENTERPRISE_ID, projectId: PROJECT_ID },
    },
  };

  /**
   * One committed row whose stored hash, size and algorithm are derived from
   * the given payload, so every case below diverges in exactly one dimension.
   */
  function decisionRow(
    payload: Record<string, unknown> = decisionPayload,
    overrides: Partial<SelectedAuthorizationDecision> = {},
  ): SelectedAuthorizationDecision {
    const digest = digestCanonicalPayload(payload as CanonicalJsonObject);
    return {
      authorization_decision_id: DECISION_ID,
      actor_snapshot_id: ACTOR_ID,
      actor_snapshot_payload_hash: Buffer.from('aa'.repeat(32), 'hex'),
      principal_id: PRINCIPAL_ID,
      principal_kind: 'HUMAN',
      outcome: 'ALLOW',
      reason_codes: ['ALLOWED_BY_GRANT'],
      command_type: 'execution.create_task',
      command_version: '2.0',
      scope_kind: 'PROJECT',
      enterprise_id: ENTERPRISE_ID,
      project_id: PROJECT_ID,
      purpose: 'execution.task.create',
      requested_capability: 'wi200.cap.task.v2',
      command_payload_hash: Buffer.from('bb'.repeat(32), 'hex'),
      policy_snapshot_id: POLICY_ID,
      policy_snapshot_payload_hash: Buffer.from('cc'.repeat(32), 'hex'),
      authentication_context_hash: Buffer.from('dd'.repeat(32), 'hex'),
      expires_at: new Date(EXPIRES_AT),
      target_object_type: 'zhiju.execution.task',
      target_object_id: TARGET_ID,
      contract_type: 'identity.AuthorizationDecision',
      contract_version: '1.0',
      canonicalization_version: digest.canonicalizationVersion,
      payload_hash_algorithm: digest.hashAlgorithm,
      payload_hash: digest.hash,
      payload_size_bytes: String(digest.sizeBytes),
      canonical_payload: payload,
      created_at: new Date('2026-09-15T00:00:00.000Z'),
      created_by_principal_id: PRINCIPAL_ID,
      source_command_id: SOURCE_ID,
      retention_class: 'REGULATED_AUDIT',
      ...overrides,
    };
  }

  function withPayload(mutate: (payload: Record<string, unknown>) => void) {
    const payload = structuredClone(decisionPayload);
    mutate(payload);
    return decisionRow(payload);
  }

  it('accepts a decision whose promoted columns mirror its canonical payload', () => {
    expect(authorizationDecisionIntegrityHolds(decisionRow())).toBe(true);
  });

  it('accepts a historical decision without a target binding', () => {
    const payload = structuredClone(decisionPayload);
    delete payload.targetRef;
    expect(
      authorizationDecisionIntegrityHolds(
        decisionRow(payload, { target_object_type: null, target_object_id: null }),
      ),
    ).toBe(true);
  });

  it('rejects a payload whose Decision id is not the promoted row identity', () => {
    const movedId = '018f22e2-7c15-7b2e-8d86-2de956a9d109';
    const row = withPayload((payload) => {
      payload.authorizationDecisionId = movedId;
    });
    expect(
      (row.canonical_payload as { authorizationDecisionId: string }).authorizationDecisionId,
    ).toBe(movedId);
    expect(authorizationDecisionIntegrityHolds(row)).toBe(false);
  });

  it('rejects reason codes that the row does not carry', () => {
    expect(
      authorizationDecisionIntegrityHolds(
        withPayload((payload) => {
          payload.reasonCodes = ['TAMPERED'];
        }),
      ),
    ).toBe(false);
  });

  it('rejects a target binding that is not the closed OBJECT shape', () => {
    expect(
      authorizationDecisionIntegrityHolds(
        withPayload((payload) => {
          (payload.targetRef as { kind: string }).kind = 'SNAPSHOT';
        }),
      ),
    ).toBe(false);
  });

  it('rejects a payload that no longer hashes to the stored metadata', () => {
    const row = decisionRow();
    expect(
      authorizationDecisionIntegrityHolds({
        ...row,
        canonical_payload: { ...decisionPayload, outcome: 'DENY' },
      }),
    ).toBe(false);
    expect(
      authorizationDecisionIntegrityHolds({
        ...row,
        payload_hash: Buffer.alloc(32, 0x11),
      }),
    ).toBe(false);
    expect(
      authorizationDecisionIntegrityHolds({
        ...row,
        payload_size_bytes: '1',
      }),
    ).toBe(false);
    expect(
      authorizationDecisionIntegrityHolds({
        ...row,
        payload_hash_algorithm: 'SHA-512',
      }),
    ).toBe(false);
    expect(
      authorizationDecisionIntegrityHolds({
        ...row,
        canonicalization_version: '2',
      }),
    ).toBe(false);
  });

  it('rejects a promoted target that the payload does not describe', () => {
    expect(
      authorizationDecisionIntegrityHolds(
        decisionRow(decisionPayload, {
          target_object_id: '018f22e2-7c15-7b2e-8d86-2de956a9d10a',
        }),
      ),
    ).toBe(false);
    expect(
      authorizationDecisionIntegrityHolds(decisionRow(decisionPayload, { target_object_id: null })),
    ).toBe(false);
  });
});
