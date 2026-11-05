import { sha256CanonicalJson, type CanonicalJsonValue } from '@zhiju/shared-kernel';
import { PREVIEW_PROFILE, PREVIEW_LIMITS, READER_FILES } from '../preview/profile.js';
import type { SourcePreview } from '../preview/types.js';
import type { ManifestEntry } from '../domain/types.js';
import type { ReadCheckResult } from './types.js';

export const READ_CHECK_PROFILE = 'mvp.batch-read-check@1';
export const READ_CHECK_TIME_MS = 60 * 60 * 1000;
export const READ_CHECK_RESULT_BYTES = 16 * 1024;
export const READ_CHECK_PROFILE_HASH = sha256CanonicalJson({
  profile: READ_CHECK_PROFILE,
  preview: PREVIEW_PROFILE,
  reader: READER_FILES,
  limits: PREVIEW_LIMITS,
  timeMs: READ_CHECK_TIME_MS,
  resultBytes: READ_CHECK_RESULT_BYTES,
});

/** Discard the extracted text after deriving a bound, bounded technical receipt. */
export function readCheckResult(
  entry: ManifestEntry,
  preview: SourcePreview | undefined,
  at: string,
): ReadCheckResult {
  const base = {
    entryId: entry.entryId,
    ordinal: entry.ordinal,
    profileId: READ_CHECK_PROFILE,
    checkedAt: at,
  };
  if (entry.status !== 'ACCEPTED') return { ...base, status: 'NOT_ELIGIBLE', limitations: [] };
  if (
    preview === undefined ||
    preview.manifestId.length === 0 ||
    preview.sourceRef.sourceId !== entry.sourceRef?.sourceId
  )
    throw new Error('READ_CHECK_RESULT_BINDING');
  const sections = preview.sections;
  if (sections === undefined)
    return {
      ...base,
      status: preview.status === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'FAILED',
      limitations: preview.limitations,
    };
  const counts =
    sections.format === 'MARKDOWN'
      ? {
          paragraphs: 0,
          tables: 0,
          comments: 0,
          revisions: 0,
          headersFooters: 0,
          characters: Array.from(sections.source).length,
        }
      : {
          paragraphs: sections.paragraphs.length,
          tables: sections.tables.length,
          comments: sections.comments.length,
          revisions: sections.revisions.length,
          headersFooters: sections.headersFooters.length,
          characters: sections.paragraphs.reduce((n, p) => n + Array.from(p.text).length, 0),
        };
  return {
    ...base,
    status: preview.status === 'AVAILABLE' ? 'AVAILABLE' : 'LIMITED',
    limitations: preview.limitations,
    counts,
    resultHash: sha256CanonicalJson({
      profileId: READ_CHECK_PROFILE,
      sourceRef: preview.sourceRef,
      manifestId: preview.manifestId,
      status: preview.status,
      limitations: preview.limitations,
      sections,
    } as unknown as CanonicalJsonValue),
  };
}
