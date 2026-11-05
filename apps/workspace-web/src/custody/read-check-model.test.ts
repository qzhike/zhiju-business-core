import { describe, expect, it } from 'vitest';
import { parseCheck, parseCheckPage } from './read-check-model.js';
const id = (n: number) => `0199a000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1),
  batchId = id(2),
  checkId = id(3);
const at = '2026-11-04T00:00:00.000Z';
const check = {
  projectId,
  batchId,
  checkId,
  manifestId: id(4),
  manifestHash: 'a'.repeat(64),
  profileId: 'mvp.batch-read-check@1',
  profileHash: 'b'.repeat(64),
  status: 'COMPLETED',
  resultVersion: 3,
  totalEntries: 1,
  counts: { available: 1, limited: 0, unsupported: 0, failed: 0, notEligible: 0, pending: 0 },
  createdAt: at,
  startedAt: at,
  endedAt: at,
  reasonCodes: [],
};
const entry = {
  entryId: id(5),
  ordinal: 0,
  originalName: 'sample.md',
  normalizedPath: 'sample.md',
  status: 'ACCEPTED',
  reasonCodes: [],
  byteLength: 100,
  sha256: 'a'.repeat(64),
  mediaType: 'text/markdown',
  sourceRef: {
    projectId,
    batchId,
    sourceId: id(6),
    kind: 'ACCEPTED_ENTRY',
    byteLength: 100,
    sha256: 'a'.repeat(64),
    mediaType: 'text/markdown',
  },
};
const result = {
  entryId: id(5),
  ordinal: 0,
  profileId: check.profileId,
  checkedAt: at,
  status: 'AVAILABLE',
  limitations: [],
  resultHash: 'c'.repeat(64),
  counts: {
    paragraphs: 0,
    tables: 0,
    comments: 0,
    revisions: 0,
    headersFooters: 0,
    characters: 100,
  },
};
const page = { check, filter: 'ALL', total: 1, entries: [{ entry, result }] };
describe('read-check response boundary', () => {
  it('accepts exact bounded metadata and rejects count, identity and terminal contradictions', () => {
    expect(parseCheck(check, projectId, batchId, checkId)).not.toBeNull();
    for (const bad of [
      { ...check, counts: { ...check.counts, pending: 1 } },
      { ...check, checkId: id(7) },
      { ...check, endedAt: undefined },
      { ...check, profileId: 'arbitrary' },
      { ...check, body: 'unexpected text' },
    ])
      expect(parseCheck(bad, projectId, batchId, checkId)).toBeNull();
  });
  it('rejects duplicate rows, foreign sources and body-bearing or incomplete results', () => {
    expect(parseCheckPage(page, projectId, batchId, checkId, 'ALL')).not.toBeNull();
    for (const rows of [
      [page.entries[0], page.entries[0]],
      [{ entry: { ...entry, sourceRef: { ...entry.sourceRef, batchId: id(8) } }, result }],
      [{ entry, result: { ...result, body: 'untrusted text' } }],
      [{ entry, result: { ...result, resultHash: undefined } }],
      [{ entry, result: { ...result, status: 'NOT_ELIGIBLE' } }],
    ])
      expect(
        parseCheckPage({ ...page, entries: rows }, projectId, batchId, checkId, 'ALL'),
      ).toBeNull();
  });
});
