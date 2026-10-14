import { describe, expect, it } from 'vitest';
import {
  candidatePath,
  matchingReceipt,
  scopedFiles,
  type ExecutionRound,
  type ProgressFile,
} from './model.js';
const file: ProgressFile = {
  id: 'selected',
  title: '程序',
  code: 'CX-01',
  state: 'READY',
  update: '返回',
  updatedAt: 'time',
  failures: [],
  retryAllowed: false,
  candidate: {
    projectId: 'project',
    requestId: 'request',
    fileId: 'selected',
    revisionId: 'rev-1',
  },
};
const round: ExecutionRound = {
  projectId: 'project',
  requestId: 'request',
  label: '1',
  reportId: 'report-1',
  reportVersion: 1,
  confirmedFileIds: ['selected'],
  files: [file],
  summary: '',
  logs: [],
};
describe('execution presentation trust boundaries', () => {
  it('excludes unselected or blocked report files from displayed states and totals', () => {
    expect(scopedFiles({ ...round, files: [file, { ...file, id: 'blocked' }] })).toEqual([file]);
  });
  it.each(['projectId', 'requestId', 'fileId', 'revisionId'] as const)(
    'does not invent ready candidates for an invalid %s',
    (field) => {
      const candidate = {
        ...{ projectId: 'project', requestId: 'request', fileId: 'selected', revisionId: 'rev-1' },
        [field]: field === 'revisionId' ? '' : 'wrong',
      };
      const observation = { ...file, candidate };
      expect(candidatePath(round, observation)).toBeNull();
      expect(scopedFiles({ ...round, files: [observation] })[0]?.state).toBe('UNCERTAIN');
    },
  );
  it('marks missing and duplicated observations uncertain while retaining scope membership', () => {
    expect(scopedFiles({ ...round, files: [] })[0]?.state).toBe('UNCERTAIN');
    expect(scopedFiles({ ...round, files: [file, file] })[0]?.state).toBe('UNCERTAIN');
  });
  it('keeps a supplied prior candidate available during a later failed run', () => {
    expect(candidatePath(round, { ...file, state: 'FAILED' })).toBe(
      '/projects/project/files/selected/revisions/rev-1',
    );
  });
  it.each(['id', 'projectId', 'requestId', 'fileId'] as const)(
    'rejects retry receipts that change %s',
    (field) => {
      const intent = {
        id: 'intent-1',
        projectId: 'project',
        requestId: 'request',
        fileId: 'selected',
      };
      expect(matchingReceipt(intent, { ...intent, [field]: 'wrong', state: 'ACCEPTED' })).toBe(
        false,
      );
      expect(matchingReceipt(intent, { ...intent, state: 'ACCEPTED' })).toBe(true);
    },
  );
});
