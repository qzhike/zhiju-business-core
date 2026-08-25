import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalize, type CanonicalJsonObject } from '@zhiju/shared-kernel';
import {
  assertHashMatches,
  ENTERPRISE_PAYLOAD_HASH_MISMATCH,
  ENTERPRISE_PROMOTED_MIRROR_MISMATCH,
  validatePromotedMirror,
} from './write-guards.js';
import { digestCanonicalPayload } from './enterprise-db.js';
import {
  assertEnvelopeMatchesContext,
  COMMAND_CONTEXT_MISMATCH,
  CommandExecutionError,
  type CommandEnvelope,
} from './command-runner.js';
import type { EnterpriseProjectTransactionContext } from './enterprise-db.js';

describe('promoted mirror validation', () => {
  const payload: CanonicalJsonObject = {
    enterpriseId: '12121212-1212-7121-8121-1212121212a1',
    projectId: '13131313-1313-7131-8131-1313131313b1',
    commandType: 'wi02.demo.command',
  };

  it('accepts payload columns that match the promoted values', () => {
    expect(() => {
      validatePromotedMirror(payload, {
        enterpriseId: '12121212-1212-7121-8121-1212121212a1',
        projectId: '13131313-1313-7131-8131-1313131313b1',
        commandType: 'wi02.demo.command',
      });
    }).not.toThrow();
  });

  it('accepts a null promoted projectId when the payload omits it', () => {
    expect(() => {
      validatePromotedMirror(
        { enterpriseId: '12121212-1212-7121-8121-1212121212a1' },
        {
          enterpriseId: '12121212-1212-7121-8121-1212121212a1',
          projectId: null,
        },
      );
    }).not.toThrow();
  });

  it('rejects any promoted mismatch with a stable code', () => {
    try {
      validatePromotedMirror(payload, { enterpriseId: 'other' });
      expect.unreachable('mirror mismatch must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ENTERPRISE_PROMOTED_MIRROR_MISMATCH);
    }
    try {
      validatePromotedMirror(payload, { missing: 'value' });
      expect.unreachable('missing promoted field must throw');
    } catch (error) {
      expect((error as { code?: string }).code).toBe(ENTERPRISE_PROMOTED_MIRROR_MISMATCH);
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
      expect((error as { code?: string }).code).toBe(ENTERPRISE_PAYLOAD_HASH_MISMATCH);
    }
  });
});

describe('trusted authorization snapshot binding', () => {
  const context: EnterpriseProjectTransactionContext = {
    kind: 'REQUEST',
    principalId: '14141414-1414-7141-8141-1414141414c1',
    principalKind: 'HUMAN',
    actorSnapshotId: '15151515-1515-7151-8151-1515151515d1',
    authorizationDecisionId: '16161616-1616-7161-8161-1616161616e1',
    authorizationDecisionHash: Buffer.alloc(32, 0x21),
    authorizationDecisionExpiresAt: new Date('2026-08-25T00:00:00.000Z'),
    policySnapshotId: '17171717-1717-7171-8171-1717171717f1',
    enterpriseId: '18181818-1818-7181-8181-1818181818a1',
    allowedProjectIds: ['19191919-1919-7191-8191-1919191919b1'] as const,
    correlationId: '1a1a1a1a-1a1a-71a1-81a1-1a1a1a1a1ac1',
  };

  const envelope: CommandEnvelope = {
    commandId: '1b1b1b1b-1b1b-71b1-81b1-1b1b1b1b1bd1',
    commandType: 'wi02.bind',
    commandVersion: '1.0',
    idempotencyScope: 'wi02',
    idempotencyKey: 'bind',
    requestPayload: { op: 'bind' },
    enterpriseId: context.enterpriseId,
    projectId: '19191919-1919-7191-8191-1919191919b1',
    targetType: 'ProcessInstance',
    targetId: '1c1c1c1c-1c1c-71c1-81c1-1c1c1c1c1ce1',
    correlationId: context.correlationId,
    principalId: context.principalId,
    principalKind: context.principalKind,
    actorSnapshotId: context.actorSnapshotId,
    authorizationDecisionId: context.authorizationDecisionId,
    policySnapshotId: context.policySnapshotId,
  };

  it('accepts an envelope that matches the trusted snapshots and allowed project', () => {
    expect(() => {
      assertEnvelopeMatchesContext(context, envelope);
    }).not.toThrow();
  });

  it('rejects forged actor, decision, policy or project scope with a stable code', () => {
    const mismatches: Partial<CommandEnvelope>[] = [
      { actorSnapshotId: '00000000-0000-7000-8000-000000000001' },
      { authorizationDecisionId: '00000000-0000-7000-8000-000000000002' },
      { policySnapshotId: '00000000-0000-7000-8000-000000000003' },
      { projectId: '00000000-0000-7000-8000-000000000004' },
    ];
    for (const mismatch of mismatches) {
      try {
        assertEnvelopeMatchesContext(context, { ...envelope, ...mismatch });
        expect.unreachable('forged snapshot must throw');
      } catch (error) {
        expect(error).toBeInstanceOf(CommandExecutionError);
        expect((error as CommandExecutionError).code).toBe(COMMAND_CONTEXT_MISMATCH);
      }
    }
  });
});
