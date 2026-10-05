import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  TASK_BOARD_CURSOR_BYTES,
  assertTaskBoardCursorBinding,
  decodeTaskBoardCursor,
  encodeTaskBoardCursor,
  type TaskBoardCursorClaims,
  type TaskBoardCursorKey,
} from './task-board-cursor.js';

const key: TaskBoardCursorKey = { keyId: 7, secret: Buffer.alloc(32, 7) };
const NOW = new Date('2026-10-05T00:00:30.000Z');
const projectId = '0199b600-0000-7000-8000-000000000201';
const enterpriseId = '0199b600-0000-7000-8000-000000000202';

function failureCode(run: () => void): string | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string'
    )
      return error.code;
    return undefined;
  }
}

function claims(overrides: Partial<TaskBoardCursorClaims> = {}): TaskBoardCursorClaims {
  const now = NOW.getTime();
  return {
    queryType: 'execution.get_task_board_slice',
    queryVersion: '1.0',
    projectRef: {
      kind: 'OBJECT',
      objectType: 'zhiju.project.project',
      objectId: projectId,
      scope: { enterpriseId, projectId },
    },
    requesterPurposeHash: 'a'.repeat(64),
    authorizationSourceHash: 'b'.repeat(64),
    normalizedFilterHash: 'c'.repeat(64),
    pageSize: 20,
    consistency: 'PROJECTION_OK',
    policyRef: {
      kind: 'VERSIONED',
      objectType: 'zhiju.identity.policy',
      objectId: '0199b600-0000-7000-8000-000000000203',
      versionId: '0199b600-0000-7000-8000-000000000204',
      scope: { enterpriseId, projectId },
    },
    policyContentHash: 'd'.repeat(64),
    policyVersionRef: {
      kind: 'SNAPSHOT',
      objectType: 'zhiju.identity.policy_version',
      objectId: '0199b600-0000-7000-8000-000000000205',
      snapshotId: '0199b600-0000-7000-8000-000000000206',
      scope: { enterpriseId, projectId },
    },
    generationId: '0199b600-0000-7000-8000-000000000207',
    manifestHash: 'e'.repeat(64),
    sourceFingerprint: 'c'.repeat(64),
    snapshotAt: new Date(now - 60_000).toISOString(),
    watermarkSequence: 3,
    lastTaskId: '0199b600-0000-7000-8000-000000000208',
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 600_000).toISOString(),
    ...overrides,
  };
}

function authorityClaims(): TaskBoardCursorClaims {
  return claims({
    generationId: undefined,
    manifestHash: undefined,
    sourceFingerprint: 'f'.repeat(64),
    // An authority cursor carries no publication watermark.
    watermarkSequence: 0,
  });
}

describe('Task Board cursor codec', () => {
  it('encodes the fixed 264-character base64url spelling bound to the shared pattern', () => {
    const encoded = encodeTaskBoardCursor(claims(), key);
    expect(TASK_BOARD_CURSOR_BYTES).toBe(198);
    expect(encoded).toHaveLength(264);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]{16,512}$/u);
  });

  it('round-trips the paging state of a generation cursor', () => {
    const original = claims();
    const decoded = decodeTaskBoardCursor(encodeTaskBoardCursor(original, key), key, NOW);
    expect(decoded.mode).toBe('GENERATION');
    expect(decoded.generationId).toBe(original.generationId);
    expect(decoded.snapshotAt).toBe(original.snapshotAt);
    expect(decoded.watermarkSequence).toBe(3);
    expect(decoded.lastTaskId).toBe(original.lastTaskId);
    expect(() => {
      assertTaskBoardCursorBinding(decoded, original, key);
    }).not.toThrow();
  });

  it('binds an authority cursor to its source fingerprint', () => {
    const authority = authorityClaims();
    const decoded = decodeTaskBoardCursor(encodeTaskBoardCursor(authority, key), key, NOW);
    expect(decoded.mode).toBe('AUTHORITY');
    expect(decoded.generationId).toBeUndefined();
    expect(() => {
      assertTaskBoardCursorBinding(decoded, authority, key);
    }).not.toThrow();
    expect(
      failureCode(() => {
        assertTaskBoardCursorBinding(
          decoded,
          {
            ...authority,
            sourceFingerprint: '0'.repeat(64),
          },
          key,
        );
      }),
    ).toBe('QUERY_CURSOR_SCOPE_MISMATCH');
  });

  it('keeps the approved uint64 sequence range and byte offsets', () => {
    const claimsAt = (watermarkSequence: number) => claims({ watermarkSequence });
    const maxSafe = 9_007_199_254_740_991;
    expect(
      decodeTaskBoardCursor(encodeTaskBoardCursor(claimsAt(maxSafe), key), key, NOW)
        .watermarkSequence,
    ).toBe(maxSafe);
    expect(
      decodeTaskBoardCursor(encodeTaskBoardCursor(claimsAt(4_294_967_296), key), key, NOW)
        .watermarkSequence,
    ).toBe(4_294_967_296);
    // The approved offsets: keyId@2, requestBindingHash@6, sourceFingerprint@38,
    // generationId@70, manifestHash@86, sequence@118, snapshotAt@126,
    // lastTaskId@134, issuedAt@150, expiresAt@158.
    const raw = Buffer.from(encodeTaskBoardCursor(claimsAt(7), key), 'base64url');
    expect(raw.readUInt32BE(2)).toBe(key.keyId);
    expect(raw.subarray(70, 86).equals(Buffer.alloc(16))).toBe(false);
    expect(raw.readBigUInt64BE(118)).toBe(7n);
    expect(raw.readBigInt64BE(126)).toBe(BigInt(Date.parse(claims().snapshotAt)));
    expect(raw.subarray(134, 150).toString('hex')).toBe(claims().lastTaskId.replaceAll('-', ''));
    expect(raw.readBigInt64BE(150)).toBe(BigInt(Date.parse(claims().issuedAt)));
    expect(raw.readBigInt64BE(158)).toBe(BigInt(Date.parse(claims().expiresAt)));
  });

  it('rejects an authority cursor carrying generation evidence', () => {
    const authority = authorityClaims();
    const raw = Buffer.from(encodeTaskBoardCursor(authority, key), 'base64url');
    const withGeneration = Buffer.from(raw);
    Buffer.alloc(16, 7).copy(withGeneration, 70);
    const resign = (body: Buffer): string => {
      const tag = createHmac('sha256', key.secret).update(body.subarray(0, 166)).digest();
      return Buffer.concat([body.subarray(0, 166), tag]).toString('base64url');
    };
    expect(failureCode(() => void decodeTaskBoardCursor(resign(withGeneration), key, NOW))).toBe(
      'QUERY_CURSOR_INVALID',
    );
    expect(
      failureCode(() => void decodeTaskBoardCursor(resign(Buffer.from(raw)), key, NOW)),
    ).toBeUndefined();
  });

  it('preserves millisecond instants and binds the key id', () => {
    const original = claims({
      snapshotAt: '2026-10-04T00:00:00.123Z',
      issuedAt: '2026-10-05T00:00:00.456Z',
      expiresAt: '2026-10-05T01:00:00.789Z',
    });
    const decoded = decodeTaskBoardCursor(encodeTaskBoardCursor(original, key), key, NOW);
    expect(decoded.snapshotAt).toBe('2026-10-04T00:00:00.123Z');
    expect(decoded.issuedAt).toBe('2026-10-05T00:00:00.456Z');
    expect(decoded.expiresAt).toBe('2026-10-05T01:00:00.789Z');
    expect(
      failureCode(
        () =>
          void decodeTaskBoardCursor(
            encodeTaskBoardCursor(original, key),
            { ...key, keyId: 8 },
            NOW,
          ),
      ),
    ).toBe('QUERY_CURSOR_INVALID');
  });

  it('judges expiry against the trusted clock, not the process clock', () => {
    const original = claims({
      issuedAt: new Date(NOW.getTime() - 1000).toISOString(),
      expiresAt: new Date(NOW.getTime() - 1).toISOString(),
    });
    expect(
      failureCode(() => void decodeTaskBoardCursor(encodeTaskBoardCursor(original, key), key, NOW)),
    ).toBe('QUERY_CURSOR_EXPIRED');
  });

  it('rejects tampering, another key and non-canonical spelling', () => {
    const encoded = encodeTaskBoardCursor(claims(), key);
    const tampered = `${encoded.slice(0, 10)}${encoded[10] === 'A' ? 'B' : 'A'}${encoded.slice(11)}`;
    expect(failureCode(() => void decodeTaskBoardCursor(tampered, key, NOW))).toBe(
      'QUERY_CURSOR_INVALID',
    );
    expect(
      failureCode(
        () => void decodeTaskBoardCursor(encoded, { ...key, secret: Buffer.alloc(32, 9) }, NOW),
      ),
    ).toBe('QUERY_CURSOR_INVALID');
    expect(failureCode(() => void decodeTaskBoardCursor('short', key, NOW))).toBe(
      'QUERY_CURSOR_INVALID',
    );
    expect(failureCode(() => void decodeTaskBoardCursor(`${encoded}.extra`, key, NOW))).toBe(
      'QUERY_CURSOR_INVALID',
    );
  });

  it('rejects an expired cursor with the stable expiry error', () => {
    const now = NOW.getTime();
    const expired = claims({
      issuedAt: new Date(now - 7_200_000).toISOString(),
      expiresAt: new Date(now - 3_600_000).toISOString(),
    });
    expect(
      failureCode(() => void decodeTaskBoardCursor(encodeTaskBoardCursor(expired, key), key, NOW)),
    ).toBe('QUERY_CURSOR_EXPIRED');
  });

  it('rejects a changed scope, filter, page size or generation binding', () => {
    const original = claims();
    const decoded = decodeTaskBoardCursor(encodeTaskBoardCursor(original, key), key, NOW);
    expect(
      failureCode(() => {
        assertTaskBoardCursorBinding(
          decoded,
          { ...original, normalizedFilterHash: '1'.repeat(64) },
          key,
        );
      }),
    ).toBe('QUERY_CURSOR_SCOPE_MISMATCH');
    expect(
      failureCode(() => {
        assertTaskBoardCursorBinding(decoded, { ...original, pageSize: 10 }, key);
      }),
    ).toBe('QUERY_CURSOR_SCOPE_MISMATCH');
    expect(
      failureCode(() => {
        assertTaskBoardCursorBinding(
          decoded,
          { ...original, generationId: '0199b600-0000-7000-8000-000000000299' },
          key,
        );
      }),
    ).toBe('QUERY_CURSOR_SCOPE_MISMATCH');
  });
});
