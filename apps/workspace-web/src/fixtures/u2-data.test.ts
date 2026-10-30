import { expect, it } from 'vitest';
import { candidateMarkdown } from '../mvp/u3-model.js';
import { u2Candidate, u2RevisionBytes, u2VersionsFor } from './u2-data.js';

const fileIds = [
  'F-MANUAL',
  'F-PROCEDURE',
  'F-EXTERNAL-RULE',
  'F-FORM-APPLY',
  'F-FORM-REVIEW',
  'F-FORM-IMPLEMENT',
] as const;

it('binds every revision size to the shared Markdown export used by ZIP members', () => {
  for (const fileId of fileIds) {
    for (const versionId of u2VersionsFor(fileId)) {
      const data = u2Candidate(fileId, versionId);
      expect(data).toBeDefined();
      if (!data) continue;
      const expected = new TextEncoder().encode(candidateMarkdown(data)).length;
      expect(u2RevisionBytes(fileId, versionId)).toBe(expected);
    }
  }
  expect(u2RevisionBytes('F-MANUAL', 'V2')).toBe(1357);
  expect(u2RevisionBytes('F-MANUAL', 'V3')).toBe(1263);
});
