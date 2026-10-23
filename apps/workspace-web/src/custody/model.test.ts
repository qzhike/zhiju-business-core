import { describe, expect, it } from 'vitest';

import {
  newUuidV7,
  parseBatch,
  parseBatchDetail,
  parseEntryPage,
  parseSession,
  stableFingerprint,
  statusLabel,
} from './model.js';

describe('MVP custody UI model', () => {
  it('generates UUIDv7 identifiers accepted by the server', () => {
    const value = newUuidV7();
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(newUuidV7()).not.toBe(value);
  });

  it('parses only closed server shapes', () => {
    expect(
      parseSession({
        ownerId: '0199a000-0000-7000-8000-000000000001',
        displayName: '员工',
        authEpoch: 1,
        instanceId: '0123456789abcdef',
      }),
    ).toMatchObject({ displayName: '员工', authEpoch: 1 });
    expect(parseSession({ ownerId: 'x' })).toBeNull();
    expect(
      parseBatch({
        batchId: '0199a000-0000-7000-8000-000000000002',
        projectId: '0199a000-0000-7000-8000-000000000001',
        batchNo: 1,
        kind: 'INITIAL',
        originalName: 'materials.zip',
        declaredBytes: 10,
        zipSha256: 'a'.repeat(64),
        status: 'PARTIAL',
        version: 3,
        createdAt: '2026-10-22T00:00:00.000Z',
        manifestId: '0199a000-0000-7000-8000-000000000003',
        reasonCodes: ['UNSUPPORTED_MEDIA_TYPE'],
      }),
    ).toMatchObject({ status: 'PARTIAL', batchNo: 1 });
    expect(parseBatch({ batchNo: 1 })).toBeNull();
  });

  it('parses a batch detail and entry page without inventing sources', () => {
    const detail = parseBatchDetail({
      batch: {
        batchId: '0199a000-0000-7000-8000-000000000002',
        projectId: '0199a000-0000-7000-8000-000000000001',
        batchNo: 1,
        kind: 'INITIAL',
        originalName: 'materials.zip',
        declaredBytes: 10,
        zipSha256: 'a'.repeat(64),
        status: 'RECEIVED',
        version: 4,
        createdAt: '2026-10-22T00:00:00.000Z',
        reasonCodes: [],
        originalRequestId: '0199a000-0000-7000-8000-000000000004',
        currentAttempt: {
          attemptId: '0199a000-0000-7000-8000-000000000005',
          kind: 'EXTRACT',
          number: 1,
          generation: 2,
          status: 'SUCCEEDED',
          startedAt: '2026-10-22T00:00:00.000Z',
        },
      },
      attempts: [],
      permittedActions: ['CONTINUE_EXTRACTION'],
    });
    expect(detail?.permittedActions).toEqual(['CONTINUE_EXTRACTION']);
    expect(detail?.manifest).toBeNull();
    const page = parseEntryPage({
      manifest: {
        manifestId: '0199a000-0000-7000-8000-000000000003',
        manifestHash: 'b'.repeat(64),
        batchId: '0199a000-0000-7000-8000-000000000002',
        originalZip: {
          sourceId: '0199a000-0000-7000-8000-000000000006',
          sha256: 'c'.repeat(64),
          byteLength: 10,
          mediaType: 'application/zip',
        },
        totalEntries: 1,
        acceptedEntries: 0,
        limitedEntries: 1,
        createdAt: '2026-10-22T00:00:00.000Z',
      },
      entries: [
        {
          entryId: '0199a000-0000-7000-8000-000000000007',
          ordinal: 0,
          originalName: 'x.pdf',
          normalizedPath: 'x.pdf',
          status: 'UNSUPPORTED',
          reasonCodes: ['UNSUPPORTED_MEDIA_TYPE'],
        },
      ],
    });
    expect(page?.entries[0]?.sourceId).toBeUndefined();
    expect(page?.manifest.acceptedEntries).toBe(0);
  });

  it('fingerprints re-entered intent fields stably', async () => {
    const left = await stableFingerprint({ title: 't', customerName: 'c' });
    const right = await stableFingerprint({ customerName: 'c', title: 't' });
    expect(left).toBe(right);
    expect(await stableFingerprint({ customerName: 'c', title: 'u' })).not.toBe(left);
  });

  it('labels every batch status rather than showing a raw wire value', () => {
    const statuses = [
      'AWAITING_UPLOAD',
      'RECEIVING',
      'STAGED',
      'EXTRACTING',
      'RECEIVED',
      'PARTIAL',
      'FAILED',
      'REJECTED',
      'ABANDONED',
      'UNKNOWN',
    ] as const;
    for (const status of statuses) expect(statusLabel(status).length).toBeGreaterThan(0);
  });
});
