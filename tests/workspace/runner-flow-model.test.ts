import { describe, expect, it } from 'vitest';
import {
  addRunnerRound,
  latestRunnerRound,
  viewedRunnerRound,
  runnerRoundDrafts,
  runnerDraftKey,
  updateRunnerDraft,
  fileRouteId,
  roundRouteId,
  type RunnerDraft,
  type RunnerFlowState,
} from '../../apps/workspace-web/src/fixtures/runner-flow-model.js';
import type { RunnerReadingPackage } from '../../apps/workspace-web/src/fixtures/runner-package.js';

function round(number = 1, overrides: Partial<RunnerReadingPackage> = {}): RunnerReadingPackage {
  const reading = { ref: { relativePath: 'manual.md', sha256: 'd'.repeat(64) }, text: 'Original' };
  return {
    manifestSha256: String(number).repeat(64),
    identity: {
      taskId: 'TASK',
      stageId: 'STAGE',
      step: 'QUALITY_MANUAL',
      roundId: `ROUND-${number}`,
      roundNumber: number,
    },
    status: 'WAITING_INPUT',
    summary: 'Report',
    limitations: [],
    issues: [
      {
        id: 'Q1',
        fileIds: ['FILE'],
        title: 'Question',
        status: 'OPEN',
        blocking: 'EDIT',
        request: 'Please confirm',
        original: 'Please confirm',
        reason: 'Needed',
        correction: null,
      },
    ],
    files: [
      {
        id: 'FILE',
        level: 1,
        title: 'Manual',
        state: 'BLOCKED',
        completeness: 'PARTIAL',
        gaps: [],
        limitations: [],
        initial: reading,
        before: reading,
        candidate: null,
      },
    ],
    packageFileCount: 1,
    changeCount: 0,
    proposalCount: 0,
    ...overrides,
  };
}
const issue: RunnerDraft = { kind: 'ISSUE', targetId: 'Q1', label: 'Question', text: 'Answer' };
const file: RunnerDraft = {
  kind: 'FILE',
  targetId: 'FILE',
  label: 'Manual',
  text: 'Opinion',
  fileRole: 'before',
  fileSha256: 'd'.repeat(64),
};
function project(state: RunnerFlowState) {
  const value = state.projects[0];
  if (!value) throw new Error('Missing test project');
  return value;
}

describe('Runner result session version boundaries', () => {
  it.each([issue, file])(
    'confirms, explicitly reopens and clears only the selected $kind draft',
    (draft) => {
      const value = round();
      let state = addRunnerRound({ projects: [] }, value).state;
      const id = project(state).id;
      state = updateRunnerDraft(state, id, value.manifestSha256, issue);
      state = updateRunnerDraft(state, id, value.manifestSha256, file);
      state = updateRunnerDraft(state, id, value.manifestSha256, draft, 'confirm');
      const key = runnerDraftKey(value, draft);
      expect(project(state).drafts[key]?.confirmed).toBe(true);
      expect(
        updateRunnerDraft(state, id, value.manifestSha256, {
          ...draft,
          text: 'Unexpected overwrite',
        }),
      ).toEqual(state);
      expect(updateRunnerDraft(state, id, value.manifestSha256, draft, 'confirm')).toEqual(state);
      state = updateRunnerDraft(state, id, value.manifestSha256, draft, 'modify');
      state = updateRunnerDraft(state, id, value.manifestSha256, {
        ...draft,
        text: 'Revised',
        confirmed: true,
      });
      expect(project(state).drafts[key]).toMatchObject({ text: 'Revised', confirmed: false });
      state = updateRunnerDraft(state, id, value.manifestSha256, draft, 'confirm');
      state = updateRunnerDraft(state, id, value.manifestSha256, draft, 'clear');
      expect(project(state).drafts[key]).toBeUndefined();
      expect(runnerRoundDrafts(project(state), value)).toHaveLength(1);
      expect(value.issues[0]?.status).toBe('OPEN');
      expect(value.files[0]?.candidate).toBeNull();
    },
  );
  it('rejects empty confirmations and mutations of confirmed drafts from old rounds or wrong versions', () => {
    const value = round();
    let state = addRunnerRound({ projects: [] }, value).state;
    const id = project(state).id;
    expect(updateRunnerDraft(state, id, value.manifestSha256, file, 'confirm')).toEqual(state);
    state = updateRunnerDraft(state, id, value.manifestSha256, { ...file, text: '  ' });
    expect(updateRunnerDraft(state, id, value.manifestSha256, file, 'confirm')).toEqual(state);
    state = updateRunnerDraft(state, id, value.manifestSha256, file);
    state = updateRunnerDraft(state, id, value.manifestSha256, file, 'confirm');
    for (const action of ['confirm', 'modify', 'clear'] as const) {
      expect(
        updateRunnerDraft(
          state,
          id,
          value.manifestSha256,
          { ...file, fileSha256: 'wrong' },
          action,
        ),
      ).toEqual(state);
    }
    state = addRunnerRound(state, round(2)).state;
    for (const action of ['confirm', 'modify', 'clear'] as const)
      expect(updateRunnerDraft(state, id, value.manifestSha256, file, action)).toEqual(state);
    expect(project(state).drafts[runnerDraftKey(value, file)]?.confirmed).toBe(true);
    expect(runnerRoundDrafts(project(state), round(2))).toEqual([]);
  });
  it('groups a task, orders rounds independently of import order and keeps the reading pin', () => {
    let state = addRunnerRound({ projects: [] }, round(2)).state;
    state = addRunnerRound(state, round(1)).state;
    state = addRunnerRound(state, round(3)).state;
    expect(state.projects).toHaveLength(1);
    expect(project(state).rounds.map((value) => value.identity.roundNumber)).toEqual([1, 2, 3]);
    expect(latestRunnerRound(project(state)).identity.roundNumber).toBe(3);
    expect(viewedRunnerRound(project(state)).identity.roundNumber).toBe(2);
    expect(addRunnerRound(state, round(2)).state).toBe(state);
  });
  it('rejects replaced identities and changed stage mappings without mutating history', () => {
    const value = round();
    const state = addRunnerRound({ projects: [] }, value).state;
    for (const identity of [
      value.identity,
      { ...value.identity, roundId: 'different' },
      { ...round(2).identity, stageId: 'different' },
      { ...round(2).identity, step: 'CONTROL_PROCEDURES' },
    ]) {
      expect(() => addRunnerRound(state, { ...round(2), identity })).toThrow();
    }
    expect(project(state).rounds).toEqual([value]);
  });
  it('separates tasks with overlapping file, stage and round IDs', () => {
    const value = round();
    let state = addRunnerRound({ projects: [] }, value).state;
    state = updateRunnerDraft(state, project(state).id, value.manifestSha256, file);
    state = addRunnerRound(state, {
      ...round(2),
      identity: { ...value.identity, taskId: 'OTHER' },
    }).state;
    expect(state.projects).toHaveLength(2);
    expect(state.projects[1]?.drafts).toEqual({});
    expect(state.projects[1]?.id).not.toBe(project(state).id);
  });
  it('pins drafts to the round and exact file role and bytes, then makes older rounds read only', () => {
    const value = round();
    let state = addRunnerRound({ projects: [] }, value).state;
    const id = project(state).id;
    for (const draft of [
      issue,
      file,
      { ...file, fileRole: 'initial' as const, text: 'Original opinion' },
    ])
      state = updateRunnerDraft(state, id, value.manifestSha256, draft);
    expect(runnerRoundDrafts(project(state), value)).toHaveLength(3);
    for (const invalid of [
      { ...file, fileSha256: 'wrong' },
      { ...file, fileRole: 'candidate' as const },
      { ...issue, targetId: 'missing' },
      { ...issue, fileSha256: 'wrong' },
    ]) {
      expect(updateRunnerDraft(state, id, value.manifestSha256, invalid)).toEqual(state);
    }
    state = addRunnerRound(state, round(2)).state;
    expect(runnerRoundDrafts(project(state), round(2))).toEqual([]);
    expect(
      updateRunnerDraft(state, id, value.manifestSha256, { ...file, text: 'Override' }),
    ).toEqual(state);
    expect(project(state).drafts[runnerDraftKey(value, file)]?.text).toBe('Opinion');
  });
  it('omits blank drafts and prevents replies to resolved issues', () => {
    const value = round();
    const state = addRunnerRound({ projects: [] }, value).state;
    const blank = updateRunnerDraft(state, project(state).id, value.manifestSha256, {
      ...issue,
      text: '  ',
    });
    expect(runnerRoundDrafts(project(blank), value)).toEqual([]);
    value.issues.forEach((entry) => {
      entry.status = 'RESOLVED';
    });
    expect(updateRunnerDraft(state, project(state).id, value.manifestSha256, issue)).toEqual(state);
  });
  it('uses supplied stage order without deriving approval or a candidate', () => {
    const initial = round(9);
    const next = {
      ...round(1),
      identity: { ...round(1).identity, stageId: 'STAGE-2', step: 'CONTROL_PROCEDURES' },
      status: 'COMPLETED',
    };
    const state = addRunnerRound(addRunnerRound({ projects: [] }, initial).state, next).state;
    expect(latestRunnerRound(project(state))).toBe(next);
    expect(
      project(state).rounds.every((entry) => entry.files.every((item) => item.candidate === null)),
    ).toBe(true);
  });
  it('encodes route tokens without exposing source IDs as route segments', () => {
    const value = round();
    expect(roundRouteId(value)).toMatch(/^R-[a-f0-9]{64}$/);
    const entry = value.files[0];
    if (!entry) throw new Error('Missing file');
    expect(fileRouteId({ ...entry, id: '../文件?"/#' })).toMatch(/^F-[a-f0-9]+$/);
    expect(fileRouteId({ ...entry, id: '文件' })).not.toBe(fileRouteId({ ...entry, id: 'File' }));
  });
});
