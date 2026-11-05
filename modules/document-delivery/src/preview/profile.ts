export const PREVIEW_PROFILE = 'mvp.source-preview@1' as const;
export const PREVIEW_LIMITS = Object.freeze({
  sourceBytes: 50 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024,
  parts: 1000,
  depth: 128,
  nodes: 200000,
  outputBytes: 8 * 1024 * 1024,
  indexBytes: 256 * 1024,
  pipeBytes: 64 * 1024,
  temporaryBytes: 80 * 1024 * 1024,
  memoryBytes: 512 * 1024 * 1024,
  timeMs: 30000,
});

export const READER_FILES = Object.freeze({
  '__init__.py': 'c7f42bcb90f5988386d9f43c100d5d2ad29b43b42d65a7505d7476db9af81a79',
  'common.py': 'e43bb39396aa9044e427f3493cbb69c09f40cf63a2ab27fee51dfd70dace06d1',
  'reader.py': 'cdb41d2cfd3f393b6f64d70f541a397248b65604b53b3e1407f74a6a4380168f',
});

export const PREVIEW_REASONS = [
  'EXTERNAL_TEMPLATE_NOT_LOADED',
  'EXTRACTED_VIEW_ONLY',
  'TABLE_TEXT_REPEATED',
  'NUMBERING_NOT_RENDERED',
  'TEXT_REVISIONS_ONLY',
  'MEDIA_NOT_INTERPRETED',
  'INCOMPLETE_EXTRACTION',
  'FORMAT_NOT_SUPPORTED',
  'NESTED_TABLE_NOT_SUPPORTED',
  'EMPTY_CONTENT',
  'UNSAFE_CONTENT',
  'RESOURCE_LIMIT',
  'TIMEOUT',
  'BUSY',
  'DEPENDENCY_UNAVAILABLE',
  'INVALID_READER_OUTPUT',
  'CANCELLED',
] as const;
export type PreviewReason = (typeof PREVIEW_REASONS)[number];
export class PreviewFailure extends Error {
  constructor(readonly reason: PreviewReason) {
    super(reason);
  }
}
export function previewLimit(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new PreviewFailure('RESOURCE_LIMIT');
}
