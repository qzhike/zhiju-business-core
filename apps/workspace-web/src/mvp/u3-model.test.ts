import { describe, expect, it } from 'vitest';
import type { MarkdownReviewData } from '../MarkdownReviewPage.js';
import type { StageFinalization } from './review-model.js';
import {
  attemptOutcome,
  candidateMarkdown,
  classifyLateResult,
  deliveryBlockers,
  deliveryIntentFromSelection,
  deliveryIntentKey,
  deliveryListKey,
  deliveryReceiptMatches,
  frozenFromIntent,
  packageMatchesFrozen,
  recordsReviewMatches,
  recordsReviewStale,
  retryIntentFor,
  retryReceiptMatches,
  retryableFiles,
  sameFrozenDelivery,
  selectionIssues,
  type DeliveryMember,
  type DeliveryProposal,
  type DeliverySelection,
  type ExecutionAttempt,
  type RecordsReviewMarker,
  type RetryReceipt,
} from './u3-model.js';

const finalization = (
  stage: 'MANUAL' | 'PROCEDURES',
  id: string,
  files: readonly { fileId: string; versionId: string }[],
  manualFinalizationId?: string,
): StageFinalization => ({
  classification: 'DEVELOPMENT_FIXTURE_ONLY',
  finalizationId: id,
  projectId: 'P',
  stage,
  planId: 'PLAN',
  planVersion: 1,
  files,
  ...(manualFinalizationId ? { manualFinalizationId } : {}),
  inputRefs: ['C01'],
  templateIds: ['T01'],
  confirmedAt: '2026-10-21T00:00:00.000Z',
});

const member = (
  fileId: string,
  versionId: string,
  content = `${fileId}:${versionId}`,
): DeliveryMember => ({
  fileId,
  title: fileId,
  stage: 'RECORDS',
  versionId,
  versionLabel: versionId,
  content,
});

const proposal: DeliveryProposal = {
  projectId: 'P',
  planId: 'PLAN',
  planVersion: 1,
  manualFinalizationId: 'M1',
  procedureFinalizationId: 'S1',
  recordsReviewId: 'R1',
  members: [member('A', 'V1'), member('B', 'V1')],
};

const review: RecordsReviewMarker = {
  classification: 'DEVELOPMENT_FIXTURE_ONLY',
  reviewId: 'R1',
  projectId: 'P',
  planId: 'PLAN',
  planVersion: 1,
  manualFinalizationId: 'M1',
  procedureFinalizationId: 'S1',
  files: [
    { fileId: 'A', versionId: 'V1' },
    { fileId: 'B', versionId: 'V1' },
  ],
  reviewedAt: '2026-10-21T00:00:00.000Z',
};

describe('records review marker', () => {
  it('matches only the exact project, plan and both upstream finalizations', () => {
    expect(
      recordsReviewMatches(review, {
        projectId: 'P',
        planId: 'PLAN',
        planVersion: 1,
        manualFinalizationId: 'M1',
        procedureFinalizationId: 'S1',
      }),
    ).toBe(true);
    expect(
      recordsReviewMatches(review, {
        projectId: 'P',
        planId: 'PLAN',
        planVersion: 2,
        manualFinalizationId: 'M1',
        procedureFinalizationId: 'S1',
      }),
    ).toBe(false);
    expect(
      recordsReviewMatches(review, {
        projectId: 'P',
        planId: 'PLAN',
        planVersion: 1,
        manualFinalizationId: 'M2',
        procedureFinalizationId: 'S1',
      }),
    ).toBe(false);
  });

  it('is stale when a reviewed file has a newer candidate', () => {
    expect(recordsReviewStale(review, review.files)).toBe(false);
    expect(
      recordsReviewStale(review, [
        { fileId: 'A', versionId: 'V1' },
        { fileId: 'B', versionId: 'V2' },
      ]),
    ).toBe(true);
  });
});

describe('delivery selection and blockers', () => {
  it('reports missing required files and stale exact versions', () => {
    const selection: DeliverySelection = {
      proposalKey: 'stale-key',
      members: [member('A', 'V1')],
    };
    const issues = selectionIssues(selection, proposal, ['A', 'B']);
    expect(issues.missingRequired).toEqual(['B']);
    expect(issues.stale).toEqual(['A', 'B']);

    const exact: DeliverySelection = {
      proposalKey: deliveryListKey(proposal),
      members: proposal.members,
    };
    expect(selectionIssues(exact, proposal, ['A', 'B'])).toEqual({
      missingRequired: [],
      stale: [],
    });
  });

  it('blocks unresolved basis changes, stale review, active modifications and selection issues', () => {
    const base = {
      planReady: true,
      manual: finalization('MANUAL', 'M1', [{ fileId: 'M', versionId: 'V1' }]),
      procedures: finalization(
        'PROCEDURES',
        'S1',
        [
          { fileId: 'P1', versionId: 'V1' },
          { fileId: 'P2', versionId: 'V1' },
        ],
        'M1',
      ),
      manualExpectedFiles: ['M'],
      procedureExpectedFiles: ['P1', 'P2'],
      recordsReview: review,
      recordExpectedFiles: ['A', 'B'],
      currentRecordLatest: review.files,
      selection: { missingRequired: [], stale: [] },
    };
    expect(deliveryBlockers(base)).toEqual([]);
    expect(
      deliveryBlockers({
        ...base,
        procedures: finalization(
          'PROCEDURES',
          'S1',
          [
            { fileId: 'P1', versionId: 'V1' },
            { fileId: 'P2', versionId: 'V1' },
          ],
          'M0',
        ),
      }),
    ).toContain('第二阶段集合仍以旧质量手册为依据；请先按当前手册重新确认完整集合。');
    expect(
      deliveryBlockers({
        ...base,
        recordsReview: { ...review, manualFinalizationId: 'M0' },
      }),
    ).toContain('记录表单复核依据已变化；请重新核对受影响表单。');
    expect(
      deliveryBlockers({
        ...base,
        currentRecordLatest: [
          { fileId: 'A', versionId: 'V2' },
          { fileId: 'B', versionId: 'V1' },
        ],
      }),
    ).toContain('记录表单复核后又出现新候选；请重新核对精确版本。');
    expect(deliveryBlockers({ ...base, activeSubmission: 'REQ-1' })).toContain(
      '仍有待回执或待核验的修改请求 REQ-1；不能确认最终交付。',
    );
    expect(deliveryBlockers({ ...base, unresolvedRecovery: 'RETRY-1' })).toContain(
      '仍有待回执或待核验的恢复请求 RETRY-1；不能确认最终交付。',
    );
    expect(
      deliveryBlockers({
        ...base,
        selection: { missingRequired: ['B'], stale: ['A'] },
      }),
    ).toEqual(
      expect.arrayContaining([
        '最终清单缺少必需文件：B。',
        '所选版本或依据已变化（A）；请显式重新核对当前清单。',
      ]),
    );
  });
});

describe('delivery confirmation and packages', () => {
  const selection: DeliverySelection = {
    proposalKey: deliveryListKey(proposal),
    members: proposal.members,
  };
  const intent = deliveryIntentFromSelection(proposal, selection, {
    requestId: 'REQ',
    createdAt: '2026-10-21T00:00:00.000Z',
  });

  it('accepts only an exact receipt and freezes an immutable copy', () => {
    const receipt = {
      classification: 'DEVELOPMENT_FIXTURE_ONLY' as const,
      requestId: intent.requestId,
      proposalKey: 'not-the-intent-key',
      members: intent.members,
      packageRequestId: 'PKG-REQ',
      confirmedAt: '2026-10-21T00:00:00.000Z',
    };
    expect(deliveryReceiptMatches(intent, receipt)).toBe(false);
    const frozen = frozenFromIntent(intent);
    const exact = { ...receipt, proposalKey: deliveryIntentKey(intent) };
    expect(deliveryReceiptMatches(intent, exact)).toBe(true);
    expect(deliveryReceiptMatches(intent, { ...exact, members: [member('A', 'V2')] })).toBe(false);
    const pkg = {
      id: 'P1',
      label: 'P1',
      createdAt: '2026-10-21T00:00:00.000Z',
      frozen,
      availability: 'AVAILABLE' as const,
      reason: '',
      synthetic: true as const,
      downloads: [],
    };
    expect(packageMatchesFrozen(pkg, frozen)).toBe(true);
    expect(sameFrozenDelivery(frozen, frozenFromIntent(intent))).toBe(true);
    expect(
      sameFrozenDelivery(frozen, {
        ...frozen,
        members: [member('A', 'V2')],
      }),
    ).toBe(false);
  });
});

describe('execution recovery', () => {
  const attempt: ExecutionAttempt = {
    attemptId: 'A1',
    requestId: 'R1',
    projectId: 'P',
    planId: 'PLAN',
    planVersion: 1,
    label: 'A1',
    trigger: 'INITIAL',
    createdAt: '',
    fixedInputs: ['C01'],
    errors: ['failed A'],
    note: '',
    files: [
      {
        fileId: 'A',
        title: 'A',
        stage: 'RECORDS',
        state: 'SUCCEEDED',
        versionId: 'V1',
        provenance: '',
      },
      {
        fileId: 'B',
        title: 'B',
        stage: 'RECORDS',
        state: 'FAILED',
        error: 'timeout',
        provenance: '',
      },
      {
        fileId: 'C',
        title: 'C',
        stage: 'RECORDS',
        state: 'FAILED',
        error: 'conflict',
        provenance: '',
      },
    ],
  };

  it('keeps partial success distinct and retries only failed files', () => {
    expect(attemptOutcome(attempt)).toBe('PARTIAL');
    const retry = retryIntentFor(attempt, 'RETRY');
    expect(retry?.fileIds).toEqual(['B', 'C']);
    if (!retry) throw new Error('expected a retry intent for failed files');
    expect(retryableFiles(attempt).map((file) => file.fileId)).toEqual(['B', 'C']);
    const receipt: RetryReceipt = {
      classification: 'DEVELOPMENT_FIXTURE_ONLY',
      ...retry,
      status: 'ACCEPTED',
    };
    expect(retryReceiptMatches(retry, receipt)).toBe(true);
    expect(retryReceiptMatches(retry, { ...receipt, fileIds: ['A', 'B', 'C'] })).toBe(false);
    expect(retryReceiptMatches(retry, { ...receipt, attemptId: 'OTHER' })).toBe(false);
  });

  it('retains late or stale results as history only', () => {
    expect(
      classifyLateResult({
        projectId: 'P',
        planId: 'PLAN',
        planVersion: 1,
        basisKey: 'OLD',
        currentProjectId: 'P',
        currentPlanId: 'PLAN',
        currentPlanVersion: 1,
        currentBasisKey: 'NEW',
      }).disposition,
    ).toBe('HISTORY_ONLY');
    expect(
      classifyLateResult({
        projectId: 'P',
        planId: 'PLAN',
        planVersion: 1,
        basisKey: 'NEW',
        currentProjectId: 'P',
        currentPlanId: 'PLAN',
        currentPlanVersion: 1,
        currentBasisKey: 'NEW',
        newerAttemptId: 'A2',
      }).disposition,
    ).toBe('HISTORY_ONLY');
    expect(
      classifyLateResult({
        projectId: 'OTHER',
        planId: 'PLAN',
        planVersion: 1,
        basisKey: 'NEW',
        currentProjectId: 'P',
        currentPlanId: 'PLAN',
        currentPlanVersion: 1,
        currentBasisKey: 'NEW',
      }).disposition,
    ).toBe('HISTORY_ONLY');
    expect(
      classifyLateResult({
        projectId: 'P',
        planId: 'PLAN',
        planVersion: 1,
        basisKey: 'NEW',
        currentProjectId: 'P',
        currentPlanId: 'PLAN',
        currentPlanVersion: 1,
        currentBasisKey: 'NEW',
      }).disposition,
    ).toBe('ACCEPT');
  });
});

describe('candidate markdown', () => {
  it('renders exact section, paragraph and table content for package members', () => {
    const data: MarkdownReviewData = {
      content: {
        revisionRef: {
          kind: 'CONTENT_ADDRESSED',
          objectType: 'artifact.artifact_revision',
          objectId: 'REV',
          scope: { enterpriseId: 'E', projectId: 'P' },
          contentHash: {
            algorithm: 'SHA-256',
            digest: '0'.repeat(64),
            canonicalizationVersion: '1',
          },
        },
        canonicalContentHash: {
          algorithm: 'SHA-256',
          digest: '0'.repeat(64),
          canonicalizationVersion: '1',
        },
        document: {
          documentId: 'D',
          title: 'Title',
          units: [
            {
              unitId: 's1',
              unitType: 'SECTION',
              ordinal: 0,
              text: 'Section',
              childUnitIds: ['p1', 't1'],
              semanticMetadata: { markdown: { headingLevel: 1 } },
            },
            {
              unitId: 'p1',
              unitType: 'PARAGRAPH',
              ordinal: 0,
              parentUnitId: 's1',
              childUnitIds: [],
              text: 'Exact paragraph',
              semanticMetadata: { markdown: { blockKind: 'PARAGRAPH' } },
            },
            {
              unitId: 't1',
              unitType: 'TABLE',
              ordinal: 1,
              parentUnitId: 's1',
              childUnitIds: ['r1', 'r2'],
              semanticMetadata: { markdown: { blockKind: 'TABLE' } },
            },
            {
              unitId: 'r1',
              unitType: 'TABLE_ROW',
              ordinal: 0,
              parentUnitId: 't1',
              childUnitIds: ['c1', 'c2'],
              semanticMetadata: { markdown: {} },
            },
            {
              unitId: 'c1',
              unitType: 'TABLE_CELL',
              ordinal: 0,
              parentUnitId: 'r1',
              childUnitIds: [],
              text: 'Header',
              semanticMetadata: { markdown: { blockKind: 'PARAGRAPH' } },
            },
            {
              unitId: 'c2',
              unitType: 'TABLE_CELL',
              ordinal: 1,
              parentUnitId: 'r1',
              childUnitIds: [],
              text: 'Value',
              semanticMetadata: { markdown: { blockKind: 'PARAGRAPH' } },
            },
            {
              unitId: 'r2',
              unitType: 'TABLE_ROW',
              ordinal: 1,
              parentUnitId: 't1',
              childUnitIds: ['d1', 'd2'],
              semanticMetadata: { markdown: {} },
            },
            {
              unitId: 'd1',
              unitType: 'TABLE_CELL',
              ordinal: 0,
              parentUnitId: 'r2',
              childUnitIds: [],
              text: 'A',
              semanticMetadata: { markdown: { blockKind: 'PARAGRAPH' } },
            },
            {
              unitId: 'd2',
              unitType: 'TABLE_CELL',
              ordinal: 1,
              parentUnitId: 'r2',
              childUnitIds: [],
              text: 'B',
              semanticMetadata: { markdown: { blockKind: 'PARAGRAPH' } },
            },
          ],
        },
        authoritativeIdentityMap: {
          artifactRef: {
            kind: 'OBJECT',
            objectType: 'artifact.artifact',
            objectId: 'A',
            scope: { enterpriseId: 'E', projectId: 'P' },
          },
        },
        currentUsability: 'USABLE',
      },
      changes: {
        exactInputs: {
          toRevisionRef: {
            kind: 'CONTENT_ADDRESSED',
            objectType: 'artifact.artifact_revision',
            objectId: 'REV',
            scope: { enterpriseId: 'E', projectId: 'P' },
            contentHash: {
              algorithm: 'SHA-256',
              digest: '0'.repeat(64),
              canonicalizationVersion: '1',
            },
          },
          baselineKind: 'EMPTY_INITIAL',
        },
        diffHash: {
          algorithm: 'SHA-256',
          digest: '0'.repeat(64),
          canonicalizationVersion: '1',
        },
        totalChanges: 0,
        changedUnitCount: 0,
        filteredChanges: 0,
        chapterGroups: [],
        entries: [],
      },
    };
    const markdown = candidateMarkdown(data);
    expect(markdown).toContain('# Section');
    expect(markdown).toContain('Exact paragraph');
    expect(markdown).toContain('| Header | Value |');
    expect(markdown).toContain('| A | B |');
  });
});
