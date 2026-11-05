import { describe, expect, it } from 'vitest';

import {
  newUuidV7,
  parseBatch,
  parseBatchDetail,
  parseEntryPage,
  parseProject,
  parseProjectList,
  parseSession,
  stableFingerprint,
  statusLabel,
} from './model.js';

describe('MVP custody UI model', () => {
  it('reads project summaries without inventing detail-only batch fields', () => {
    const summary = {
      projectId: '0199a000-0000-7000-8000-000000000001',
      customerName: '客户',
      title: '资料项目',
      createdAt: '2026-10-22T00:00:00.000Z',
      version: 3,
    };
    expect(parseProjectList({ items: [summary] })).toEqual({ items: [summary] });
    expect(parseProject(summary)).toBeNull();
    expect(parseProject({ ...summary, lastBatchNo: 1 })).toMatchObject({ lastBatchNo: 1 });
  });

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

  it('keeps bounded rejection paths as text and rejects malformed detail shapes', () => {
    const detail = {
      batch: {
        batchId: 'batch',
        projectId: 'project',
        batchNo: 1,
        kind: 'INITIAL',
        originalName: 'input.zip',
        declaredBytes: 10,
        zipSha256: 'a'.repeat(64),
        status: 'REJECTED',
        version: 3,
        createdAt: '2026-11-03T00:00:00.000Z',
        reasonCodes: ['NESTED_ARCHIVE_NOT_ALLOWED'],
      },
      attempts: [],
      permittedActions: [],
      rejectedArchivePaths: ['dir/<archive>.rar'],
    };
    expect(parseBatchDetail(detail)?.rejectedArchivePaths).toEqual(['dir/<archive>.rar']);
    for (const paths of [
      null,
      [],
      [1],
      [''],
      ['界'.repeat(81)],
      Array.from({ length: 1001 }, () => 'a.zip'),
    ])
      expect(parseBatchDetail({ ...detail, rejectedArchivePaths: paths })).toBeNull();
    expect(
      parseBatchDetail({ ...detail, batch: { ...detail.batch, status: 'RECEIVED' } }),
    ).toBeNull();
  });

  it.each(['mvp.zip-input@3', 'mvp.zip-input@4'])(
    'requires precise %s details while preserving old rejection history',
    (policyVersion) => {
      const batch = {
        batchId: 'batch',
        projectId: 'project',
        batchNo: 1,
        kind: 'INITIAL',
        originalName: 'input.zip',
        declaredBytes: 10,
        zipSha256: 'a'.repeat(64),
        status: 'REJECTED',
        version: 5,
        createdAt: '2026-11-04T00:00:00.000Z',
        policyVersion,
        reasonCodes: ['ZIP_LIMIT_EXCEEDED'],
      };
      const detail = { batch, attempts: [], permittedActions: [] };
      const limitViolation = {
        metric: 'OFFICE_ENTRIES',
        actual: 20001,
        limit: 20000,
        documentPath: '资料/<file>.docx',
      };
      expect(parseBatchDetail(detail)).toBeNull();
      expect(parseBatchDetail({ ...detail, limitViolation })?.limitViolation).toEqual(
        limitViolation,
      );
      for (const invalid of [
        null,
        {},
        { ...limitViolation, limit: 1000 },
        { ...limitViolation, extra: true },
      ])
        expect(parseBatchDetail({ ...detail, limitViolation: invalid })).toBeNull();
      for (const policyVersion of ['mvp.zip-input@1', 'mvp.zip-input@2']) {
        const historical = { ...detail, batch: { ...batch, policyVersion } };
        expect(parseBatchDetail(historical)?.limitViolation).toBeUndefined();
        expect(parseBatchDetail({ ...historical, limitViolation })).toBeNull();
      }
      expect(
        parseBatchDetail({ ...detail, batch: { ...batch, status: 'FAILED' }, limitViolation }),
      ).toBeNull();
      expect(
        parseBatchDetail({
          ...detail,
          batch: { ...batch, manifestId: 'manifest' },
          limitViolation,
        }),
      ).toBeNull();
    },
  );

  it('preserves accepted template explanations and rejects mismatched explanation/source states', () => {
    const mediaType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const originalZip = {
      sourceId: 'original',
      sha256: 'a'.repeat(64),
      byteLength: 100,
      mediaType: 'application/zip',
    };
    const manifest = {
      manifestId: 'manifest',
      manifestHash: 'b'.repeat(64),
      batchId: 'batch',
      originalZip,
      totalEntries: 2,
      acceptedEntries: 1,
      limitedEntries: 1,
      createdAt: '2026-11-04T00:00:00.000Z',
    };
    const template = {
      entryId: 'document',
      ordinal: 0,
      originalName: 'manual.docx',
      normalizedPath: 'manual.docx',
      status: 'ACCEPTED',
      reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED'],
      mediaType,
      byteLength: 20,
      sha256: 'c'.repeat(64),
      sourceRef: {
        projectId: 'project',
        batchId: 'batch',
        sourceId: 'source',
        kind: 'ACCEPTED_ENTRY',
        mediaType,
        byteLength: 20,
        sha256: 'c'.repeat(64),
      },
    };
    const metadata = {
      entryId: 'metadata',
      ordinal: 1,
      originalName: '._manual.docx',
      normalizedPath: '._manual.docx',
      status: 'UNSUPPORTED',
      reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'],
    };
    expect(parseEntryPage({ manifest, entries: [template, metadata] })?.entries).toMatchObject([
      { status: 'ACCEPTED', reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED'], sourceId: 'source' },
      { status: 'UNSUPPORTED', reasonCodes: ['SYSTEM_METADATA_NOT_DOCUMENT'] },
    ]);
    for (const entry of [
      { ...template, sourceRef: undefined },
      { ...template, status: 'READ_LIMITED' },
      { ...template, mediaType: 'application/zip' },
      { ...template, sourceRef: { ...template.sourceRef, kind: 'ORIGINAL_ZIP' } },
      { ...template, sourceRef: { ...template.sourceRef, sha256: 'd'.repeat(64) } },
      {
        ...template,
        reasonCodes: ['EXTERNAL_TEMPLATE_NOT_LOADED', 'EXTERNAL_REFERENCE_REQUIRES_REVIEW'],
      },
      { ...metadata, status: 'ACCEPTED' },
      { ...metadata, sourceRef: template.sourceRef },
    ])
      expect(parseEntryPage({ manifest, entries: [entry] })).toBeNull();
    expect(
      parseEntryPage({
        manifest,
        entries: [{ ...metadata, reasonCodes: ['INVALID_DOCX'], status: 'CORRUPT' }],
      })?.entries[0],
    ).toMatchObject({ reasonCodes: ['INVALID_DOCX'], status: 'CORRUPT' });
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
