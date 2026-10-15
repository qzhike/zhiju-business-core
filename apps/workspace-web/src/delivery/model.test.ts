import { describe, expect, it } from 'vitest';
import {
  matchingReceipt,
  selectionIssues,
  type DeliveryData,
  type DeliveryFile,
  type DeliveryIntent,
  type Selection,
} from './model.js';
const file: DeliveryFile = {
  id: 'file-1',
  title: '程序',
  code: 'P1',
  chapter: '8.5',
  chapterTitle: '改进',
  revisionId: 'rev-1',
  version: '第1版',
  provenance: { round: 'R1', reportId: 'report-1', reportVersion: 1 },
  qualification: { key: 'qual-1', eligible: true, reason: '来源核验通过' },
};
const selection: Selection = {
  projectId: 'project-1',
  contextKey: 'plan-1',
  recipient: 'customer-1',
  files: [file],
};
const data: DeliveryData = {
  ...selection,
  projectTitle: '项目',
  observedAt: '',
  completeness: 'COMPLETE',
  packages: [],
};
const intent: DeliveryIntent = { id: 'intent-1', selection, checkToken: 'check-1' };
describe('exact project delivery presentation', () => {
  it('blocks lost, duplicate, replaced or revoked observations without changing selected versions', () => {
    expect(selectionIssues(selection, data)).toEqual([]);
    for (const files of [
      [],
      [file, file],
      [{ ...file, revisionId: 'rev-2' }],
      [{ ...file, qualification: { ...file.qualification, eligible: false } }],
      [{ ...file, qualification: { ...file.qualification, key: 'qual-2' } }],
      [{ ...file, provenance: { ...file.provenance, reportVersion: 2 } }],
    ])
      expect(selectionIssues(selection, { ...data, files })).toEqual([
        '程序：版本或交付条件已变化，请重新核对',
      ]);
    expect(selection.files[0]?.revisionId).toBe('rev-1');
  });
  it('blocks changed project/plan/recipient, partial and stale reads', () => {
    for (const change of [
      { projectId: 'other' },
      { contextKey: 'other' },
      { recipient: 'other' },
      { completeness: 'PARTIAL' as const },
      { completeness: 'STALE' as const },
    ])
      expect(selectionIssues(selection, { ...data, ...change })).not.toEqual([]);
  });
  it('accepts only the same intent, check, exact members and provenance in ready receipts', () => {
    const pkg = {
      id: 'package-1',
      label: '固定包',
      createdAt: '',
      selection,
      availability: 'AVAILABLE' as const,
      reason: '',
      synthetic: true,
      downloads: [],
    };
    expect(matchingReceipt(intent, { intent, state: 'PACKAGE_READY', package: pkg })).toBe(true);
    expect(matchingReceipt(intent, { intent, state: 'PACKAGE_READY' })).toBe(false);
    expect(
      matchingReceipt(intent, { intent: { ...intent, id: 'wrong' }, state: 'CONFIRMED' }),
    ).toBe(false);
    expect(
      matchingReceipt(intent, { intent: { ...intent, checkToken: 'wrong' }, state: 'CONFIRMED' }),
    ).toBe(false);
    expect(
      matchingReceipt(intent, {
        intent,
        state: 'PACKAGE_READY',
        package: { ...pkg, selection: { ...selection, files: [] } },
      }),
    ).toBe(false);
    expect(
      matchingReceipt(intent, {
        intent,
        state: 'PACKAGE_READY',
        package: { ...pkg, selection: { ...selection, recipient: 'other' } },
      }),
    ).toBe(false);
  });
});
