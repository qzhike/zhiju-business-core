import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownReviewPage, type MarkdownReviewData } from './MarkdownReviewPage.js';
import type { Change, ReviewContent, Unit } from './trusted/markdown.js';
import type { ReviewOpinionModel } from './review/model.js';

const hash = {
  algorithm: 'SHA-256' as const,
  digest: 'b'.repeat(64),
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
function content(revisionId: string, units: Unit[]): ReviewContent {
  return {
    revisionRef: {
      kind: 'CONTENT_ADDRESSED',
      objectType: 'artifact.artifact_revision',
      objectId: revisionId,
      scope,
      contentHash: hash,
    },
    canonicalContentHash: hash,
    document: { documentId: revisionId, title: '预防措施程序（合成）', units },
    authoritativeIdentityMap: {
      artifactRef: {
        kind: 'OBJECT',
        objectType: 'artifact.artifact',
        objectId: 'artifact',
        scope,
      },
    },
    currentUsability: 'USABLE',
  };
}
function data(change: Change): MarkdownReviewData {
  return {
    content: content('revision-1', [paragraph('paragraph-1', '当前阅读版本的内容')]),
    before: content('revision-0', [paragraph('paragraph-1-before', '原版本的内容')]),
    changes: {
      exactInputs: {
        toRevisionRef: content('revision-1', []).revisionRef,
        fromRevisionRef: content('revision-0', []).revisionRef,
        baselineKind: 'REVISION',
      },
      diffHash: hash,
      totalChanges: 1,
      changedUnitCount: 1,
      filteredChanges: 1,
      chapterGroups: [{ unitId: 'paragraph-1', title: '1 目的', changeCount: 1 }],
      entries: [change],
    },
  };
}
const changed: Change = {
  changeId: hash,
  unitId: 'paragraph-1',
  kind: 'CHANGED',
  beforeValue: paragraph('paragraph-1-before', '原版本的内容'),
  afterValue: paragraph('paragraph-1', '当前阅读版本的内容'),
  chapterUnitIds: ['paragraph-1'],
  contextUnitIds: ['paragraph-1'],
};
const opinion: ReviewOpinionModel = {
  context: '预防措施程序（合成） · 版本 revision-1',
  draft: { text: '本页未提交的意见', state: 'UNAVAILABLE', note: '仅在当前页面，尚未保存' },
  approval: { available: false, note: '批准能力尚未接入。' },
  unavailable: ['服务器个人草稿与提交并修改尚未接入。'],
};
function markup(overrides: Partial<Parameters<typeof MarkdownReviewPage>[0]> = {}) {
  return renderToStaticMarkup(
    <MarkdownReviewPage
      data={data(changed)}
      busy={false}
      directoryStatus=""
      onMore={() => Promise.resolve()}
      download={{
        hasRepresentation: true,
        status: '',
        note: '此链接未提供已登记表示，下载不可用',
        onDownload: () => Promise.resolve(),
      }}
      opinion={opinion}
      {...overrides}
    />,
  );
}

describe('bounded review workspace boundaries', () => {
  it('keeps unavailable operations disabled with the supplied input preserved', () => {
    const html = markup();
    expect(html).toContain('本页未提交的意见');
    expect(html).toContain('服务器个人草稿与提交并修改尚未接入。');
    expect(html).toContain('批准能力尚未接入。');
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(html)?.[0]).toContain('disabled');
    expect(/<button[^>]*>检查完成并批准<\/button>/u.exec(html)?.[0]).toContain('disabled');
    expect(html).toContain('跨文件成果目录读取尚未接入');
  });
  it('holds approval while an unsent draft exists and states it honestly', () => {
    const html = markup({
      opinion: {
        ...opinion,
        approval: { available: true, note: '已具备批准条件。' },
        draft: { text: '未提交的意见', state: 'SAVED', note: '' },
      },
      opinionActions: { onSubmit: () => undefined, onApprove: () => undefined },
    });
    expect(html).toContain('还有未提交的意见或改稿');
    expect(/<button[^>]*>检查完成并批准<\/button>/u.exec(html)?.[0]).toContain('disabled');
  });
  it('shows the owning denominator instead of the loaded page and disables files without a candidate', () => {
    const html = markup({
      workspace: {
        files: {
          list: {
            totalCount: 201,
            entries: [
              {
                fileId: 'one',
                code: 'QP23',
                title: '预防措施程序',
                state: 'READY',
                detail: '整理稿',
                openable: true,
              },
              {
                fileId: 'two',
                code: 'QH-002',
                title: '合成长清单文件 2',
                state: 'WAITING',
                detail: '本示例不提供合成候选',
                openable: false,
              },
            ],
            currentFileId: 'one',
            query: '',
            stateFilter: 'ALL',
            loading: false,
            nextCursor: 'page-40',
            status: '本轮共 201 份文件',
          },
          actions: { onMore: () => undefined, onSelect: () => undefined },
        },
      },
    });
    expect(html).toContain('已加载 2 / 共 201 份');
    expect(html).toContain('本轮共 201 份文件');
    expect(html).toContain('继续加载文件');
    expect(html).toMatch(/disabled=""[^>]*>[^<]*<strong>合成长清单文件 2/u);
    expect(html).not.toMatch(/disabled=""[^>]*>[^<]*<strong>预防措施程序/u);
  });
  it('keeps the submission status at the top of the opinion area with a frozen original', () => {
    const html = markup({
      opinionActions: { onSubmit: () => undefined, onQuerySubmission: () => undefined },
      opinion: {
        ...opinion,
        draft: { text: '', state: 'SAVED', note: '已提交的内容已冻结' },
        submission: {
          status: 'UNKNOWN',
          requestLabel: 'DEMO-REQUEST-1',
          originalText: '已提交的原意见',
          queries: { automatic: 3, budget: 3 },
          querying: false,
          canQuery: true,
          note: '自动核验已结束',
        },
      },
    });
    expect(html.indexOf('提交结果待核验')).toBeGreaterThan(-1);
    expect(html.indexOf('提交结果待核验')).toBeLessThan(html.indexOf('id="markdown-note"'));
    expect(html).toContain('已提交的原意见');
    expect(html).toContain('核验期间不能重复提交');
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(html)?.[0]).toContain('disabled');
    expect(html).toContain('重新查询');
  });
  it('never approves while a submission is being reconciled', () => {
    const html = markup({
      opinionActions: { onSubmit: () => undefined, onApprove: () => undefined },
      opinion: {
        ...opinion,
        approval: { available: true, note: '已具备批准条件。' },
        submission: {
          status: 'RUNNING',
          requestLabel: 'DEMO-REQUEST-2',
          originalText: '已提交的原意见',
          queries: { automatic: 1, budget: 3 },
          querying: false,
          canQuery: false,
          note: '已确认正在修改',
        },
      },
    });
    expect(/<button[^>]*>检查完成并批准<\/button>/u.exec(html)?.[0]).toContain('disabled');
  });
  it('keeps an unresolved location binding and its kind visible', () => {
    const removed: Change = {
      ...changed,
      kind: 'REMOVED',
      unitId: 'paragraph-1-before',
    };
    delete removed.afterValue;
    expect(markup({ data: data(removed) })).toContain('已删除内容只保留在原版本位置');
    const missing: Change = {
      ...changed,
      kind: 'MOVED',
      afterValue: paragraph('paragraph-missing', '未找到的新位置'),
    };
    const html = markup({ data: data(missing) });
    expect(html).toContain('未自动改绑到相邻内容');
    expect(html).toContain('移动保留原位置与新位置');
    expect(html).not.toContain('class="markdown-after"');
  });
  it('requires an explicitly chosen baseline before a suggestion can be submitted', () => {
    const suggestion = {
      name: '改稿.md',
      text: '# 合成改稿',
      baseline: {
        options: [
          { id: 'revision-1', label: '第 1 版', kind: 'OLDER' as const },
          { id: 'revision-2', label: '第 2 版', kind: 'LATEST' as const },
        ],
      },
      latestLabel: '第 2 版',
    };
    const blocked = markup({
      opinionActions: { onSubmit: () => undefined, onAttachSuggestion: () => undefined },
      opinion: {
        ...opinion,
        draft: { text: '', state: 'SAVED', note: '' },
        suggestion,
      },
    });
    expect(blocked).toContain('请先明确选择改稿的基准版本');
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(blocked)?.[0]).toContain('disabled');
    const selected = markup({
      opinionActions: { onSubmit: () => undefined, onAttachSuggestion: () => undefined },
      opinion: {
        ...opinion,
        draft: { text: '', state: 'SAVED', note: '' },
        suggestion: {
          ...suggestion,
          baseline: { ...suggestion.baseline, selectedId: 'revision-1' },
        },
      },
    });
    expect(selected).toContain('基准 第 1 版');
    expect(selected).toContain('提交时最新版本 第 2 版');
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(selected)?.[0]).not.toContain('disabled');
  });
});
