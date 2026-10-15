import { describe, expect, it } from 'vitest';
import {
  changeBinding,
  changeKindNotices,
  focusUnit,
  submissionStatusCopy,
  type ReviewDraftState,
  reviewDraftStateLabels,
} from './model.js';
import type { Change, Document, ReviewContent, Unit } from '../trusted/markdown.js';

const hash = {
  algorithm: 'SHA-256' as const,
  digest: 'a'.repeat(64),
  canonicalizationVersion: '1' as const,
};
const scope = { enterpriseId: 'enterprise', projectId: 'project' };
const paragraph = (unitId: string, text: string): Unit => ({
  unitId,
  unitType: 'PARAGRAPH',
  ordinal: 0,
  childUnitIds: [],
  text,
  semanticMetadata: { markdown: {} },
});
const document: Document = {
  documentId: 'document',
  title: '预防措施程序',
  units: [
    { ...paragraph('section-1', '1 目的'), unitType: 'SECTION', childUnitIds: ['paragraph-1'] },
    paragraph('paragraph-1', '本程序用于预防措施管理。'),
    {
      unitId: 'table-1',
      unitType: 'TABLE',
      ordinal: 1,
      childUnitIds: ['row-1'],
      semanticMetadata: { markdown: {} },
    },
    {
      unitId: 'row-1',
      unitType: 'TABLE_ROW',
      parentUnitId: 'table-1',
      ordinal: 0,
      childUnitIds: ['cell-1'],
      semanticMetadata: { markdown: {} },
    },
    {
      unitId: 'cell-1',
      unitType: 'TABLE_CELL',
      parentUnitId: 'row-1',
      ordinal: 0,
      childUnitIds: [],
      text: '0',
      semanticMetadata: { markdown: {} },
    },
  ],
};
const content = {
  revisionRef: {
    kind: 'CONTENT_ADDRESSED' as const,
    objectType: 'artifact.artifact_revision' as const,
    objectId: 'revision',
    scope,
    contentHash: hash,
  },
  canonicalContentHash: hash,
  document,
  authoritativeIdentityMap: {
    artifactRef: {
      kind: 'OBJECT' as const,
      objectType: 'artifact.artifact' as const,
      objectId: 'artifact',
      scope,
    },
  },
  currentUsability: 'USABLE',
} satisfies ReviewContent;
const change = (kind: Change['kind'], unitId: string): Change => ({
  changeId: hash,
  unitId,
  kind,
  afterValue: paragraph(unitId, '新的文本'),
  chapterUnitIds: ['section-1'],
  contextUnitIds: ['section-1'],
});

describe('review workspace presentation helpers', () => {
  it('resolves a change through its owning table so a table change still renders', () => {
    expect(focusUnit(document, 'cell-1')?.unitId).toBe('table-1');
    expect(focusUnit(document, 'row-1')?.unitId).toBe('table-1');
  });
  it('keeps a missing location binding visible instead of rebinding to neighbouring content', () => {
    expect(changeBinding(content, change('CHANGED', 'paragraph-1'))).toEqual({
      unitId: 'paragraph-1',
      present: true,
    });
    const missing = changeBinding(content, change('MOVED', 'paragraph-404'));
    expect(missing.present).toBe(false);
    expect(missing.unitId).toBe('paragraph-404');
  });
  it('gives added, removed and moved content their own location semantics', () => {
    expect(changeKindNotices.ADDED).toContain('没有旧位置');
    expect(changeKindNotices.REMOVED).toContain('原版本位置');
    expect(changeKindNotices.MOVED).toContain('不会自动迁移');
    expect(changeKindNotices.CHANGED).toBe('');
  });
  it('never turns an uncertain receipt into failure, non-receipt or success', () => {
    const copy = submissionStatusCopy('UNKNOWN', { automatic: 3, budget: 3 });
    expect(copy).toContain('只针对原提交');
    expect(copy).toContain('已自动查询 3 / 3 次');
    expect(copy).not.toContain('提交失败');
    expect(copy).not.toContain('未接收');
    expect(copy).not.toContain('提交成功');
    expect(submissionStatusCopy('ACCEPTED', { automatic: 0, budget: 3 })).toContain('已记录');
    expect(submissionStatusCopy('RUNNING', { automatic: 0, budget: 3 })).toContain('已开始处理');
  });
  it('keeps draft save states distinct, including conflict and unknown outcomes', () => {
    const states: ReviewDraftState[] = [
      'UNAVAILABLE',
      'SAVING',
      'SAVED',
      'UNSAVED',
      'CONFLICT',
      'UNKNOWN',
    ];
    expect(new Set(states.map((state) => reviewDraftStateLabels[state])).size).toBe(states.length);
    expect(reviewDraftStateLabels.SAVED).toContain('已保存');
    expect(reviewDraftStateLabels.UNKNOWN).toContain('待核验');
  });
});
