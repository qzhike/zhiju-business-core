import { describe, expect, it } from 'vitest';
import {
  activeSubmission,
  candidateVersion,
  draftAfterEdit,
  draftAfterSaveReceipt,
  draftBasisChanged,
  draftWhileSaving,
  duplicateFileIds,
  evaluateFinalizationReceipt,
  fileVersionScope,
  finalizationBlocker,
  finalizationIntentMatchesReceipt,
  finalizationMatchesBasis,
  manualBasis,
  mvpDraftStateLabels,
  mvpStageLabels,
  planReady,
  procedureBasis,
  projectScope,
  revisionReceiptMatches,
  sameScope,
  sameVersionSet,
  stageScope,
  stageSetBlockers,
  viewedVersionSet,
  type FinalizationIntent,
  type FinalizationReceipt,
  type MvpSubmission,
  type RevisionIntent,
  type RevisionReceipt,
  type StageFileAvailability,
  type StageFinalization,
} from './review-model.js';

const projectId = 'MVP-U1-PROJECT';
const plan = {
  planId: 'U1-PLAN-01',
  version: 1,
  state: 'CONFIRMED',
  receiptMatches: true,
  inputRefs: ['C01', 'C02', 'A1'],
  templateIds: ['T01', 'T02', 'T03'],
};
const manualFiles = [{ fileId: 'F-MANUAL', versionId: 'V2' }];
const procedureFile = { fileId: 'F-PROCEDURE', versionId: 'V2' };
const ruleFile = { fileId: 'F-EXTERNAL-RULE', versionId: 'V2' };
const procedureFiles = [procedureFile, ruleFile];
const manualFinalization: StageFinalization = {
  classification: 'DEVELOPMENT_FIXTURE_ONLY',
  finalizationId: 'U2-FINAL-01',
  projectId,
  stage: 'MANUAL',
  planId: plan.planId,
  planVersion: plan.version,
  files: manualFiles,
  inputRefs: plan.inputRefs,
  templateIds: plan.templateIds,
  confirmedAt: '2026-10-21T00:00:00.000Z',
};
const procedureFinalization: StageFinalization = {
  ...manualFinalization,
  finalizationId: 'U2-FINAL-02',
  stage: 'PROCEDURES',
  files: procedureFiles,
  manualFinalizationId: manualFinalization.finalizationId,
};

function intent(overrides: Partial<FinalizationIntent> = {}): FinalizationIntent {
  return {
    requestId: 'U2-FINAL-REQ-01',
    projectId,
    stage: 'MANUAL',
    planId: plan.planId,
    planVersion: plan.version,
    files: manualFiles,
    inputRefs: plan.inputRefs,
    templateIds: plan.templateIds,
    ...overrides,
  };
}

function receipt(overrides: Partial<FinalizationReceipt> = {}): FinalizationReceipt {
  return {
    classification: 'DEVELOPMENT_FIXTURE_ONLY',
    requestId: 'U2-FINAL-REQ-01',
    finalizationId: 'U2-FINAL-01',
    projectId,
    stage: 'MANUAL',
    planId: plan.planId,
    planVersion: plan.version,
    files: manualFiles,
    inputRefs: plan.inputRefs,
    templateIds: plan.templateIds,
    confirmedAt: '2026-10-21T00:00:00.000Z',
    ...overrides,
  };
}

function file(
  fileId: string,
  versions: readonly string[],
  viewedVersionId?: string,
): StageFileAvailability {
  const viewed = viewedVersionId ?? versions.at(-1);
  return {
    fileId,
    versionId: viewed ?? '',
    versions,
    ...(viewed ? { viewedVersionId: viewed } : {}),
  };
}

describe('U2 plan and version binding', () => {
  it('enables review only for the exact confirmed plan with a matching receipt', () => {
    expect(planReady(plan)).toEqual({ ready: true });
    expect(planReady({ ...plan, state: 'DRAFT' }).reason).toContain('尚未确认');
    expect(planReady({ ...plan, state: 'PENDING' }).ready).toBe(false);
    expect(planReady({ ...plan, supersededBy: 'U1-PLAN-02' }).reason).toContain('已被新计划替代');
    expect(planReady({ ...plan, receiptMatches: false }).reason).toContain('回执');
  });

  it('compares exact version sets without accepting missing or extra members', () => {
    expect(sameVersionSet([...procedureFiles].reverse(), procedureFiles)).toBe(true);
    expect(sameVersionSet([procedureFile], procedureFiles)).toBe(false);
    expect(
      sameVersionSet(
        [...procedureFiles, { fileId: 'F-FORM-NOTICE', versionId: 'V1' }],
        procedureFiles,
      ),
    ).toBe(false);
    expect(
      sameVersionSet(
        [{ fileId: 'F-PROCEDURE', versionId: 'V1' }],
        [{ fileId: 'F-PROCEDURE', versionId: 'V2' }],
      ),
    ).toBe(false);
  });

  it('reports missing and duplicate members explicitly', () => {
    expect(duplicateFileIds([...procedureFiles, procedureFile])).toEqual(['F-PROCEDURE']);
    expect(
      stageSetBlockers([
        file('F-PROCEDURE', ['V1']),
        { fileId: 'F-EXTERNAL-RULE', versionId: '', versions: [] },
      ]),
    ).toEqual(['缺少文件或版本：F-EXTERNAL-RULE。']);
    expect(stageSetBlockers([])).toEqual(['当前计划没有该阶段的文件。']);
  });
});

describe('U2 upstream finalization', () => {
  it('requires an exact manual finalization for the same project and plan', () => {
    const expected = {
      projectId,
      planId: plan.planId,
      planVersion: plan.version,
      inputRefs: plan.inputRefs,
      templateIds: plan.templateIds,
      manualFileIds: ['F-MANUAL'],
    };
    expect(manualBasis(manualFinalization, expected)).toEqual({ ok: true });
    expect(manualBasis(undefined, expected).reason).toContain('尚无质量手册模拟定稿');
    expect(manualBasis({ ...manualFinalization, planVersion: 2 }, expected).reason).toContain(
      '不匹配',
    );
    expect(manualBasis({ ...manualFinalization, files: [] }, expected).reason).toContain(
      '文件集合',
    );
  });

  it('requires the second-stage set to keep the same manual finalization', () => {
    const expected = {
      projectId,
      planId: plan.planId,
      planVersion: plan.version,
      inputRefs: plan.inputRefs,
      templateIds: plan.templateIds,
      manualFinalizationId: manualFinalization.finalizationId,
      procedureFileIds: procedureFiles.map((entry) => entry.fileId),
    };
    expect(procedureBasis(procedureFinalization, expected)).toEqual({ ok: true });
    expect(
      procedureBasis(procedureFinalization, { ...expected, manualFinalizationId: 'OTHER' }).reason,
    ).toContain('质量手册版本');
    expect(
      procedureBasis(procedureFinalization, {
        ...expected,
        procedureFileIds: ['F-PROCEDURE'],
      }).reason,
    ).toContain('完整版本集合');
  });

  it('keeps finalization receipts bound to their original request and basis', () => {
    expect(finalizationIntentMatchesReceipt(intent(), receipt())).toBe(true);
    expect(
      finalizationIntentMatchesReceipt(intent(), receipt({ requestId: 'U2-FINAL-REQ-02' })),
    ).toBe(false);
    expect(
      finalizationIntentMatchesReceipt(
        intent({ files: [{ fileId: 'F-MANUAL', versionId: 'V1' }] }),
        receipt(),
      ),
    ).toBe(false);
    expect(finalizationIntentMatchesReceipt(intent(), receipt({ templateIds: ['T01'] }))).toBe(
      false,
    );
    const basis = {
      projectId,
      stage: 'MANUAL' as const,
      planId: plan.planId,
      planVersion: plan.version,
      inputRefs: plan.inputRefs,
      templateIds: plan.templateIds,
    };
    expect(finalizationMatchesBasis(manualFinalization, basis)).toBe(true);
    expect(finalizationMatchesBasis(manualFinalization, { ...basis, inputRefs: ['C01'] })).toBe(
      false,
    );
  });

  it('rejects a matching receipt once the current set or upstream basis changed', () => {
    expect(
      evaluateFinalizationReceipt({
        intent: intent(),
        receipt: receipt(),
        currentFiles: manualFiles,
      }),
    ).toEqual({ ok: true });
    expect(
      evaluateFinalizationReceipt({
        intent: intent(),
        receipt: receipt(),
        currentFiles: [{ fileId: 'F-MANUAL', versionId: 'V1' }],
      }).reason,
    ).toContain('版本集合已变化');
    expect(
      evaluateFinalizationReceipt({
        intent: intent({ stage: 'PROCEDURES', manualFinalizationId: 'U2-FINAL-01' }),
        receipt: receipt({ stage: 'PROCEDURES', manualFinalizationId: 'U2-FINAL-01' }),
        currentFiles: manualFiles,
        currentManualFinalizationId: 'U2-FINAL-OTHER',
      }).reason,
    ).toContain('上游依据已变化');
  });

  it('blocks finalization for a stale candidate, active batch, missing file or records', () => {
    const base = {
      supported: true,
      plan: { ready: true },
      upstream: { ok: true },
      files: [file('F-MANUAL', ['V1', 'V2'], 'V2')],
      active: false,
      finalized: false,
    };
    expect(finalizationBlocker(base)).toBeUndefined();
    expect(
      finalizationBlocker({
        ...base,
        files: [file('F-MANUAL', ['V1', 'V2'], 'V1')],
      }),
    ).toContain('新候选已到达');
    expect(finalizationBlocker({ ...base, active: true })).toContain('不能跨过');
    expect(
      finalizationBlocker({
        ...base,
        files: [
          file('F-MANUAL', ['V1']),
          { fileId: 'F-EXTERNAL-RULE', versionId: '', versions: [] },
        ],
      }),
    ).toContain('缺少文件或版本');
    expect(finalizationBlocker({ ...base, supported: false })).toContain('不设单独定稿关卡');
  });
});

describe('U2 opinion binding and recovery', () => {
  it('keeps project, stage and file-version scopes distinct and explicit', () => {
    const project = projectScope(projectId);
    const stage = stageScope('PROCEDURES');
    const fileScope = fileVersionScope('PROCEDURES', {
      fileId: 'F-PROCEDURE',
      title: '变更控制程序',
      versionId: 'V2',
      versionLabel: '第 2 版候选',
    });
    expect(new Set([project.id, stage.id, fileScope.id]).size).toBe(3);
    expect(project.label).toContain(projectId);
    expect(stage.label).toContain(mvpStageLabels.PROCEDURES);
    expect(fileScope.label).toContain('第 2 版');
    expect(sameScope(stage, stageScope('PROCEDURES'))).toBe(true);
    expect(sameScope(stage, stageScope('MANUAL'))).toBe(false);
  });

  it('never lets an old receipt bind to a newer opinion scope or basis', () => {
    const oldScope = fileVersionScope('MANUAL', {
      fileId: 'F-MANUAL',
      title: '质量手册',
      versionId: 'V1',
      versionLabel: '第 1 版候选',
    });
    const revisionIntent: RevisionIntent = {
      requestId: 'U2-REV-01',
      projectId,
      stage: 'MANUAL',
      scope: oldScope,
      text: '保留客户质量目标',
      basis: {
        planId: plan.planId,
        planVersion: plan.version,
        files: manualFiles,
      },
    };
    const matching: RevisionReceipt = {
      classification: 'DEVELOPMENT_FIXTURE_ONLY',
      requestId: revisionIntent.requestId,
      projectId,
      stage: 'MANUAL',
      scope: revisionIntent.scope,
      basis: revisionIntent.basis,
    };
    expect(revisionReceiptMatches(revisionIntent, matching)).toBe(true);
    expect(
      revisionReceiptMatches(revisionIntent, {
        ...matching,
        scope: fileVersionScope('MANUAL', {
          fileId: 'F-MANUAL',
          title: '质量手册',
          versionId: 'V2',
          versionLabel: '第 2 版候选',
        }),
      }),
    ).toBe(false);
    expect(
      revisionReceiptMatches(revisionIntent, {
        ...matching,
        basis: { ...revisionIntent.basis, planVersion: 2 },
      }),
    ).toBe(false);
  });

  it('allows at most one active modification batch while keeping FAILED distinct', () => {
    const scope = stageScope('MANUAL');
    const submission = (status: MvpSubmission['status']): MvpSubmission => ({
      submissionId: `SUB-${status}`,
      requestId: `REQ-${status}`,
      scope,
      text: '意见',
      basis: { planId: plan.planId, planVersion: plan.version, files: manualFiles },
      status,
      note: '',
      submittedAt: '2026-10-21T00:00:00.000Z',
    });
    expect(activeSubmission([submission('RECEIVED'), submission('FAILED')])).toBeUndefined();
    expect(activeSubmission([submission('PENDING'), submission('FAILED')])?.status).toBe('PENDING');
    expect(activeSubmission([submission('UNKNOWN')])?.status).toBe('UNKNOWN');
  });

  it('keeps simulated save states distinct and memory-only', () => {
    const edited = draftAfterEdit('请保留客户编号');
    expect(edited.state).toBe('UNSAVED');
    expect(edited.note).toContain('本页内存');
    const saving = draftWhileSaving(edited, 'U2-SAVE-1');
    expect(saving.state).toBe('SAVING');
    expect(saving.requestLabel).toBe('U2-SAVE-1');
    const states = (['SAVED', 'FAILED', 'UNKNOWN'] as const).map((outcome) =>
      draftAfterSaveReceipt(edited, outcome),
    );
    expect(new Set(states.map((draft) => mvpDraftStateLabels[draft.state])).size).toBe(3);
    expect(states[0]?.note).toContain('刷新');
    expect(states[1]?.note).toContain('输入仍留');
    expect(states[2]?.note).toContain('未知');
  });

  it('keeps a saved draft on its original basis until an explicit rebind', () => {
    const original = {
      planId: plan.planId,
      planVersion: plan.version,
      files: manualFiles,
    };
    const newer = {
      planId: plan.planId,
      planVersion: plan.version,
      files: [{ fileId: 'F-MANUAL', versionId: 'V3' }],
    };
    const draft = draftAfterEdit('阶段意见', original);
    expect(draftBasisChanged(draft, original)).toBe(false);
    expect(draftBasisChanged(draft, newer)).toBe(true);
    const saved = draftAfterSaveReceipt(draftWhileSaving(draft, 'U2-SAVE-2'), 'UNKNOWN');
    expect(saved.basis).toEqual(original);
    expect(saved.requestLabel).toBe('U2-SAVE-2');
    expect(draftBasisChanged(saved, newer)).toBe(true);
    expect(draftBasisChanged({ ...saved, basis: newer }, newer)).toBe(false);
  });
});

describe('U2 candidate arrival', () => {
  it('announces a newer candidate without changing the viewed version', () => {
    const viewed = file('F-MANUAL', ['V1', 'V2'], 'V1');
    expect(candidateVersion(viewed)).toBe('V2');
    expect(viewed.viewedVersionId).toBe('V1');
    expect(candidateVersion(file('F-MANUAL', ['V1'], 'V1'))).toBeUndefined();
    expect(candidateVersion(file('F-MANUAL', ['V1']))).toBeUndefined();
  });

  it('resolves the exact viewed set only when every stage file has a version', () => {
    const files = [file('F-PROCEDURE', ['V2']), file('F-EXTERNAL-RULE', ['V2'])];
    expect(viewedVersionSet(files)).toEqual(procedureFiles);
    expect(
      viewedVersionSet([
        file('F-PROCEDURE', ['V2']),
        { fileId: 'F-EXTERNAL-RULE', versionId: '', versions: [] },
      ]),
    ).toBeUndefined();
  });
});
