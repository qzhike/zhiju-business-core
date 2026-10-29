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
    // The shared project catalog is the file column; the reader no longer
    // renders a duplicate round-only directory.
    expect(html).toContain('markdown-review-layout without-files');
    expect(html).not.toContain('本轮文件');
  });
  it('marks an ordinary edit stale when a newer candidate arrived and keeps the suggests-only exception', () => {
    const candidate = {
      label: '新候选已到达',
      note: '当前阅读版本保持不变。',
      onSwitch: () => undefined,
    };
    const stale = markup({
      workspace: { candidate },
      opinionActions: { onSubmit: () => undefined },
    });
    expect(stale).toContain('当前阅读版本已被新候选替代');
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(stale)?.[0]).toContain('disabled');
    expect(/<button[^>]*>检查完成并批准<\/button>/u.exec(stale)?.[0]).toContain('disabled');
    const suggestion = {
      name: '改稿.md',
      text: '# 合成改稿',
      baseline: {
        options: [
          { id: 'revision-1', label: '第 1 版', kind: 'OLDER' as const },
          { id: 'revision-2', label: '第 2 版', kind: 'LATEST' as const },
        ],
        selectedId: 'revision-1',
      },
      latestLabel: '第 2 版',
    };
    const exception = markup({
      workspace: { candidate },
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
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(exception)?.[0]).not.toContain('disabled');
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
  it('states the opinion scope, keeps save distinct from submit and blocks a second batch', () => {
    const html = markup({
      opinionActions: {
        onSubmit: () => undefined,
        onSaveDraft: () => undefined,
        onSelectScope: () => undefined,
      },
      opinion: {
        ...opinion,
        draft: { text: '本轮意见', state: 'UNSAVED', note: '仅在本页内存' },
        scope: {
          options: [
            { id: 'project:p', label: '项目 p', kind: 'PROJECT' },
            { id: 'stage:MANUAL', label: '阶段 质量手册', kind: 'STAGE' },
            { id: 'file:manual:v1', label: '文件 质量手册 · 第 1 版', kind: 'FILE_VERSION' },
          ],
          selectedId: 'stage:MANUAL',
          note: '保存、提交和阶段定稿是不同动作。',
        },
        submitBlocked: '本项目已有待回执的修改请求；可以继续保存下轮草稿。',
      },
    });
    expect(html).toContain('意见作用范围');
    expect(html).toContain('阶段 质量手册');
    expect(html).toContain('保存意见草稿（模拟）');
    expect(html).toContain('本项目已有待回执的修改请求');
    expect(/<button[^>]*>提交并修改<\/button>/u.exec(html)?.[0]).toContain('disabled');
    expect(/<button[^>]*>保存意见草稿（模拟）<\/button>/u.exec(html)?.[0]).not.toContain(
      'disabled',
    );
  });
  it('hides per-file approval for stage-finalization journeys but keeps append-only history', () => {
    const html = markup({
      opinion: {
        ...opinion,
        approval: { available: false, note: '阶段定稿在完整集合中确认。', visible: false },
        history: [
          {
            id: 'opinion-1',
            scopeLabel: '文件 质量手册 · 第 1 版',
            status: 'RECEIVED',
            text: '保留客户质量目标',
            requestLabel: 'U2-REV-01',
            basis: 'U1-PLAN-01 · F-MANUAL@V1',
          },
          {
            id: 'opinion-2',
            scopeLabel: '阶段 控制程序与管理制度',
            status: 'FAILED',
            text: '补充编号映射',
            requestLabel: 'U2-REV-02',
            basis: 'U1-PLAN-01 · F-MANUAL@V2',
          },
        ],
      },
    });
    expect(html).not.toContain('检查完成并批准');
    expect(html).toContain('意见与请求历史 · 2 条');
    expect(html).toContain('保留客户质量目标');
    expect(html).toContain('U2-REV-01');
    expect(html).toContain('不会自动迁移到新版本');
  });
});
