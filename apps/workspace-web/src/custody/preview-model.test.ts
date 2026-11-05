import { describe, expect, it } from 'vitest';
import { parseSourcePreview } from './preview-model.js';

const identity = { projectId: 'p', batchId: 'b', sourceId: 's', manifestId: 'm' };
const base = {
  sourceRef: {
    projectId: 'p',
    batchId: 'b',
    sourceId: 's',
    kind: 'ACCEPTED_ENTRY',
    sha256: 'a'.repeat(64),
    byteLength: 12,
    mediaType: 'text/markdown',
  },
  manifestId: 'm',
  fileName: 'source.md',
  profileId: 'mvp.source-preview@1',
  status: 'AVAILABLE',
  limitations: [],
  sections: { format: 'MARKDOWN', source: 'A\r\nB\rC\n' },
};
describe('source preview trust boundary', () => {
  it('keeps source line endings and rejects changed project, batch, manifest or source identity', () => {
    expect(parseSourcePreview(base, identity)?.sections).toEqual(base.sections);
    for (const key of ['projectId', 'batchId', 'sourceId', 'manifestId'])
      expect(parseSourcePreview(base, { ...identity, [key]: 'other' })).toBeNull();
    expect(
      parseSourcePreview(
        { ...base, sourceRef: { ...base.sourceRef, kind: 'ORIGINAL_ZIP' } },
        identity,
      ),
    ).toBeNull();
  });
  it('rejects unknown properties, fabricated success states and an excessive rowspan', () => {
    expect(
      parseSourcePreview({ ...base, sections: { ...base.sections, html: '<script/>' } }, identity),
    ).toBeNull();
    expect(parseSourcePreview({ ...base, status: 'READ' }, identity)).toBeNull();
    expect(parseSourcePreview({ ...base, status: 'UNAVAILABLE' }, identity)).toBeNull();
    expect(parseSourcePreview({ ...base, profileId: 'unreviewed' }, identity)).toBeNull();
    const sections = {
      format: 'DOCX',
      paragraphs: [],
      comments: [],
      revisions: [],
      headersFooters: [],
      fields: [],
      tables: [
        {
          position: 1,
          rows: [{ cells: [{ text: 'bad', column: 1, colSpan: 1, rowSpan: 99999999 }] }],
        },
      ],
    };
    expect(
      parseSourcePreview(
        { ...base, status: 'LIMITED', limitations: ['EXTRACTED_VIEW_ONLY'], sections },
        identity,
      ),
    ).toBeNull();
  });
});
