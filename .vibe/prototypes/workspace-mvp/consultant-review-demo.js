/* global analysisReportLabel, analysisReport, analysisView, analysisPlanFeedback, analysisPlanFeedbackSave, analysisPlanFeedbackReportKey, analysisRefresh, esc, render, modal */
/* global document, window, location, sessionStorage, crypto, setTimeout, clearTimeout */
// Consultant opinions stay separate from customer materials and authoritative decisions.
const consultantReviewStorageKey = 'zhiju-analysis-consultant-review-demo-v1';
const consultantReviewExampleText = '保留企业现有组织与职责，不按模板新设部门或变更汇报关系。请按客户现状适配职责条款；组织图的可读版本仍需客户补充，不能用模板代替企业依据。';
const consultantReviewExampleFile = '组织职责核对说明.md';
const consultantReviewInitial = () => ({ context: null, drafts: {}, submissions: [], outcome: 'feedback', notice: '' });
let consultantReview;
try { consultantReview = JSON.parse(sessionStorage.getItem(consultantReviewStorageKey)); } catch { /* Start with empty tab-local records. */ }
if (!consultantReview || !consultantReview.drafts || typeof consultantReview.drafts !== 'object' || !Array.isArray(consultantReview.submissions)) consultantReview = consultantReviewInitial();
let consultantReviewTimer = null;
function consultantReviewSave() { try { sessionStorage.setItem(consultantReviewStorageKey, JSON.stringify(consultantReview)); } catch { /* Prototype drafts are not server persistence. */ } }
function analysisConsultantReviewReset() {
  clearTimeout(consultantReviewTimer); consultantReviewTimer = null;
  consultantReview = consultantReviewInitial(); consultantReviewSave();
}
function analysisConsultantReviewClearContext() { consultantReview.context = null; consultantReview.notice = ''; consultantReviewSave(); }
function consultantReviewKey(context) { return `${context.reportKey}:${context.issueId}`; }
function consultantReviewDraft(context) {
  const key = consultantReviewKey(context);
  const draft = consultantReview.drafts[key];
  if (!draft || typeof draft.text !== 'string' || !Array.isArray(draft.attachments)) consultantReview.drafts[key] = { text: '', attachments: [] };
  return consultantReview.drafts[key];
}
function consultantReviewLatest(context) { return consultantReview.submissions.findLast(item => item.reportKey === context.reportKey && item.issueId === context.issueId); }
function consultantReviewBusy(context) { return ['queued', 'checking'].includes(consultantReviewLatest(context)?.status); }
function consultantReviewContextValid(context = consultantReview.context) {
  return Boolean(context && analysisReport && !analysisView.historyMode && context.reportKey === analysisPlanFeedbackReportKey()
    && analysisReport.attentionItems.some(item => item.id === context.issueId && item.audience === 'CONSULTANT'));
}
function consultantReviewCanSubmit() {
  const context = consultantReview.context;
  return consultantReviewContextValid(context) && !consultantReviewBusy(context) && Boolean(consultantReviewDraft(context).text.trim());
}
function consultantReviewContext(item) {
  return { reportKey: analysisPlanFeedbackReportKey(), reportEdition: analysisView.reportEdition || 'initial', issueId: item.id, issueTitle: item.title,
    fileIds: [...item.affectedPlannedFileIds], fileTitles: item.affectedPlannedFileIds.map(id => analysisReport.plannedFiles.find(file => file.id === id)?.title || id),
    protectedFactIds: [...item.protectedFactIds], evidenceIds: [...item.evidenceIds] };
}
function analysisOpenConsultantReview(issueId) {
  const issue = analysisReport?.attentionItems.find(item => item.id === issueId && item.audience === 'CONSULTANT');
  if (!issue || analysisView.historyMode) return;
  consultantReview.context = consultantReviewContext(issue); consultantReview.notice = ''; consultantReviewSave();
  analysisPlanFeedback.context = null; analysisPlanFeedbackSave();
  analysisView.section = 'overview'; analysisRefresh('analysisRecheckInput');
  document.getElementById('analysisRecheckInput')?.scrollIntoView({ block: 'nearest' });
}
function consultantReviewStatusText(submission) {
  return { queued: '意见已提交，等待 Runner 复核', checking: 'Runner 正在复核意见与依据', needs_evidence: '复核已返回：企业依据仍不足', failed: '本次复核未成功', unhandled: '意见已记录，原型未分析这份输入' }[submission.status] || '等待复核反馈';
}
function consultantReviewReceipt(context, compact = false) {
  const submission = consultantReviewLatest(context);
  if (!submission) return compact ? '' : '<p class="consultant-review-empty">提交后，在这里查看意见处理结果。企业现有安排继续保留。</p>';
  if (compact) return `<p class="consultant-review-overview-note">${esc(consultantReviewStatusText(submission))}</p>`;
  const reason = submission.status === 'needs_evidence'
    ? '已收到“保留企业现有组织与职责”的要求。组织图仍未可靠读取，这份顾问说明不能替代客户原件；岗位职责文件仍需企业依据，本项继续等待。'
    : submission.status === 'failed' ? '原报告、意见和附件记录已保留；未取得复核结果，相关问题继续等待。'
      : submission.status === 'unhandled' ? '本原型只保留意见和附件名称，不读取任意文件或推断复核结论。原报告、资料缺口和文件处理条件保持原样。'
        : '提交内容已单独记录。可以继续写下一份草稿；新草稿不会自动提交，也不会并入本次复核。';
  const sameComposer = consultantReview.context && consultantReviewKey(consultantReview.context) === consultantReviewKey(context) && consultantReviewContextValid();
  const draft = sameComposer ? consultantReviewDraft(context) : null;
  const restore = submission.status === 'failed' && sameComposer ? `<button data-consultant-review="restore" ${draft.text || draft.attachments.length ? 'disabled' : ''}>带回上次意见</button>` : '';
  return `<div class="consultant-review-receipt ${submission.status === 'needs_evidence' || submission.status === 'failed' ? 'consultant-review-waiting' : ''}" role="status"><strong>${esc(consultantReviewStatusText(submission))}${submission.fixedExample ? '（演示）' : '（仅记录）'}</strong><p>${esc(reason)}</p><button data-consultant-review="records" data-issue-id="${esc(context.issueId)}">查看已提交意见与依据 →</button>${restore}</div>`;
}
function analysisConsultantReviewOverview() {
  return '<div data-consultant-review-overview>' + consultantReviewOverviewContent() + '</div>';
}
function consultantReviewOverviewContent() {
  if (!analysisReport) return '';
  return analysisReport.attentionItems.filter(item => item.audience === 'CONSULTANT').slice(0, 1).map(item => consultantReviewReceipt(consultantReviewContext(item), true)).join('');
}
function analysisConsultantReviewDetail(issue) {
  const context = consultantReviewContext(issue);
  return `<section class="consultant-review-detail"><div data-consultant-review-status="${esc(issue.id)}">${consultantReviewReceipt(context)}</div>${analysisView.historyMode ? '<p class="analysis-fine-print">历史报告仅供查看，请在当前报告回复。</p>' : `<button class="primary" data-consultant-review="open" data-issue-id="${esc(issue.id)}">写意见并提交复核 →</button>`}</section>`;
}
function analysisConsultantReviewBoardInfo() {
  const current = consultantReview.submissions.filter(item => !analysisReport || item.reportKey === analysisPlanFeedbackReportKey());
  const latest = current.at(-1);
  if (!latest) return { text: '', busy: false };
  const busy = current.some(item => ['queued', 'checking'].includes(item.status));
  return { busy, text: busy ? '顾问意见正在复核；其他独立文件和客户资料可继续处理。' : latest.status === 'needs_evidence' ? '顾问意见复核已返回；企业依据仍不足，查看反馈后继续补充。' : latest.status === 'failed' ? '顾问意见复核未成功；原意见和报告保留，相关问题继续等待。' : '顾问意见已记录（演示）；报告与文件处理条件未改变。' };
}
function analysisConsultantReviewComposer() {
  const context = consultantReview.context;
  if (!context) return '';
  const draft = consultantReviewDraft(context);
  const valid = consultantReviewContextValid(context);
  const busy = consultantReviewBusy(context);
  return `<section class="analysis-composer analysis-composer-plan consultant-review-composer" aria-label="顾问判断意见"><div class="analysis-compose-context"><div><span>回复顾问判断 · ${context.reportEdition === 'followup' ? '复核报告' : '首轮报告'}</span><strong>${esc(context.issueTitle)}</strong><small>关联文件：${context.fileTitles.map(esc).join('、')}</small></div><button data-consultant-review="exit">返回资料补充</button></div><div data-consultant-review-status="${esc(context.issueId)}">${valid ? consultantReviewReceipt(context) : '<div class="consultant-review-receipt consultant-review-waiting" role="status"><strong>报告已更新，请在当前事项重新定位</strong><p>原意见草稿与附件记录已保留，不会自动套用到新报告。</p></div>'}</div><div class="analysis-compose-row"><button data-consultant-review="attach" ${valid ? '' : 'disabled'}>＋ 依据</button><label for="analysisRecheckInput" class="sr-only">顾问处理意见及依据</label><textarea id="analysisRecheckInput" rows="1" placeholder="说明处理要求，并注明客户文件或其他依据…" ${valid ? '' : 'disabled'}>${esc(draft.text)}</textarea><button class="primary" data-consultant-review="submit" ${consultantReviewCanSubmit() ? '' : 'disabled'}>${busy ? '复核中' : '提交复核'}</button></div><input id="analysisConsultantFiles" class="analysis-recheck-file-input" type="file" accept=".docx,.md,.markdown,.zip" multiple aria-label="选择顾问意见依据">${draft.attachments.length ? `<div class="analysis-compose-files">${draft.attachments.map(file => `<span>${esc(file.name)}${file.example ? '<small>演示说明</small>' : ''}<button data-consultant-review="remove" data-id="${esc(file.id)}" aria-label="移除${esc(file.name)}" ${valid ? '' : 'disabled'}>×</button></span>`).join('')}</div>` : ''}<div class="analysis-compose-status"><p role="status"><span id="consultantReviewNotice">${esc(consultantReview.notice || '意见不是企业事实确认；提交后等待 Runner 复核。')}</span><span id="analysisRecheckDraftState">${draft.text || draft.attachments.length ? ' · 草稿未提交，仅当前标签页保留' : ''}</span></p><details class="analysis-demo-options"><summary>演示选项</summary><div><p>固定匿名示例，未接入 Runner。原报告和企业保护要求不变。</p><button data-consultant-review="example" ${valid && !busy && !draft.text && !draft.attachments.length && context.issueId === 'P03' ? '' : 'disabled'}>带入意见与依据示例</button><a href="consultant-review-source.example.md" download>查看示例依据</a><label>复核反馈<select id="consultantReviewOutcome" ${busy ? 'disabled' : ''}><option value="feedback" ${consultantReview.outcome !== 'failure' ? 'selected' : ''}>仍需企业依据</option><option value="failure" ${consultantReview.outcome === 'failure' ? 'selected' : ''}>复核未成功</option></select></label></div></details></div></section>`;
}
function consultantReviewRefreshStatus() {
  const focused = document.activeElement;
  const focusedAction = focused?.dataset.consultantReview;
  const focusedIssue = focused?.dataset.issueId;
  if (location.hash === '#board' || !location.hash) { render(); return; }
  if (!['#analysis', '#analysis-supplement'].includes(location.hash) || !analysisReport) return;
  for (const region of document.querySelectorAll('[data-consultant-review-status]')) {
    const item = analysisReport.attentionItems.find(issue => issue.id === region.dataset.consultantReviewStatus && issue.audience === 'CONSULTANT');
    const composer = region.closest('.consultant-review-composer');
    if (!item || (composer && !consultantReviewContextValid())) continue;
    region.innerHTML = consultantReviewReceipt(composer ? consultantReview.context : consultantReviewContext(item));
  }
  const overview = document.querySelector('[data-consultant-review-overview]');
  if (overview) overview.innerHTML = consultantReviewOverviewContent();
  const submit = document.querySelector('[data-consultant-review="submit"]');
  if (submit) { submit.disabled = !consultantReviewCanSubmit(); submit.textContent = consultantReviewBusy(consultantReview.context) ? '复核中' : '提交复核'; }
  const example = document.querySelector('[data-consultant-review="example"]');
  if (example && consultantReview.context) {
    const draft = consultantReviewDraft(consultantReview.context);
    example.disabled = !consultantReviewContextValid() || consultantReviewBusy(consultantReview.context) || Boolean(draft.text || draft.attachments.length) || consultantReview.context.issueId !== 'P03';
  }
  const restore = document.querySelector('[data-consultant-review="restore"]');
  if (restore && consultantReview.context) {
    const draft = consultantReviewDraft(consultantReview.context);
    restore.hidden = consultantReviewLatest(consultantReview.context)?.status !== 'failed';
    restore.disabled = !consultantReviewContextValid() || Boolean(draft.text || draft.attachments.length);
  }
  if (focusedAction === 'records' && focusedIssue && focused && !focused.isConnected) {
    const replacement = [...document.querySelectorAll('[data-consultant-review="records"]')].find(button => button.dataset.issueId === focusedIssue);
    replacement?.focus({ preventScroll: true });
  }
  const outcome = document.getElementById('consultantReviewOutcome');
  if (outcome && consultantReview.context) outcome.disabled = consultantReviewBusy(consultantReview.context);
}
function analysisConsultantReviewSchedule() {
  if (consultantReviewTimer) return;
  const pending = consultantReview.submissions.filter(item => ['queued', 'checking'].includes(item.status));
  if (!pending.length) return;
  const nextAt = Math.min(...pending.map(item => item.status === 'queued' ? item.startedAt : item.returnedAt));
  consultantReviewTimer = setTimeout(() => {
    consultantReviewTimer = null;
    for (const submission of consultantReview.submissions) {
      if (!['queued', 'checking'].includes(submission.status)) continue;
      if (Date.now() >= submission.returnedAt) submission.status = submission.outcome === 'failure' ? 'failed' : 'needs_evidence';
      else if (Date.now() >= submission.startedAt) submission.status = 'checking';
    }
    consultantReviewSave(); consultantReviewRefreshStatus(); analysisConsultantReviewSchedule();
  }, Math.max(0, nextAt - Date.now()));
}
function analysisConsultantReviewInput(value) {
  if (!consultantReview.context) return false;
  if (!consultantReviewContextValid()) return true;
  const draft = consultantReviewDraft(consultantReview.context); draft.text = value; consultantReviewSave();
  consultantReviewRefreshStatus();
  document.getElementById('analysisRecheckDraftState').textContent = draft.text || draft.attachments.length ? ' · 草稿未提交，仅当前标签页保留' : '';
  return true;
}
function consultantReviewRecords(issueId) {
  const records = consultantReview.submissions.filter(item => item.issueId === issueId);
  modal('顾问意见与复核记录', `<div class="analysis-recheck-changes">${[...records].reverse().map(submission => `<section><h3>${esc(consultantReviewStatusText(submission))}</h3><p class="analysis-fine-print">基于${analysisReportLabel(submission.reportEdition)} · ${esc(submission.issueTitle)}</p><p>${esc(submission.text)}</p>${submission.attachments.map(file => `<span class="analysis-submitted-file">${esc(file.name)}${file.example ? ' · 顾问说明示例' : ' · 仅记录文件名'}</span>`).join('')}<p>关联文件：${submission.fileTitles.map(esc).join('、')}</p>${submission.status === 'needs_evidence' ? '<p class="consultant-review-record-result">复核反馈（演示）：保留企业现状的要求已记录；可读组织图仍待客户补充，相关问题继续等待。没有形成正式解决或生成授权。</p>' : ''}</section>`).join('') || '<p>还没有提交记录。</p>'}</div>`, '');
}
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-consultant-review]');
  if (!button) return;
  const action = button.dataset.consultantReview;
  if (action === 'open') { analysisOpenConsultantReview(button.dataset.issueId); return; }
  if (action === 'records') { consultantReviewRecords(button.dataset.issueId); return; }
  if (action === 'exit') { analysisConsultantReviewClearContext(); analysisRefresh('analysisRecheckInput'); return; }
  const context = consultantReview.context;
  if (!consultantReviewContextValid(context)) return;
  const draft = consultantReviewDraft(context);
  if (action === 'attach') document.getElementById('analysisConsultantFiles')?.click();
  if (action === 'remove') {
    draft.attachments = draft.attachments.filter(file => file.id !== button.dataset.id); consultantReviewSave(); analysisRefresh('analysisRecheckInput');
  }
  if (action === 'example' && !consultantReviewBusy(context) && !draft.text && !draft.attachments.length && context.issueId === 'P03') {
    draft.text = consultantReviewExampleText; draft.attachments = [{ id: crypto.randomUUID(), name: consultantReviewExampleFile, example: true }];
    consultantReview.notice = '已带入意见与依据示例，点击“提交复核”才会提交。'; consultantReviewSave(); analysisRefresh('analysisRecheckInput');
  }
  if (action === 'submit' && consultantReviewCanSubmit()) {
    const text = draft.text.trim();
    const attachments = draft.attachments.map(file => ({ ...file }));
    const fixedExample = context.issueId === 'P03' && text === consultantReviewExampleText && attachments.length === 1 && attachments[0].example === true && attachments[0].name === consultantReviewExampleFile;
    const now = Date.now();
    consultantReview.submissions.push({ id: crypto.randomUUID(), ...context, text, attachments, fixedExample, outcome: consultantReview.outcome,
      status: fixedExample ? 'queued' : 'unhandled', submittedAt: now, startedAt: now + 1500, returnedAt: now + 6500 });
    draft.text = ''; draft.attachments = []; consultantReview.notice = ''; consultantReviewSave(); analysisRefresh('analysisRecheckInput'); analysisConsultantReviewSchedule();
  }
  if (action === 'restore' && !draft.text && !draft.attachments.length) {
    const latest = consultantReviewLatest(context);
    if (latest?.status !== 'failed') return;
    draft.text = latest.text; draft.attachments = latest.attachments.map(file => ({ ...file, id: crypto.randomUUID() }));
    consultantReview.notice = '上次意见已带回草稿，需重新点击提交；旧失败记录保留。'; consultantReviewSave(); analysisRefresh('analysisRecheckInput');
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'consultantReviewOutcome') { consultantReview.outcome = event.target.value; consultantReviewSave(); event.target.closest('details').open = false; }
  if (event.target.id !== 'analysisConsultantFiles' || !consultantReviewContextValid()) return;
  const files = [...event.target.files];
  const accepted = files.filter(file => /\.(docx|md|markdown|zip)$/i.test(file.name));
  consultantReviewDraft(consultantReview.context).attachments.push(...accepted.map(file => ({ id: crypto.randomUUID(), name: file.name, example: false })));
  consultantReview.notice = `${files.length - accepted.length ? `${files.length - accepted.length} 份不支持格式未加入。` : ''}本原型只记录附件名称，未读取或上传依据。`;
  consultantReviewSave(); analysisRefresh('analysisRecheckInput');
});
Object.assign(window, { analysisOpenConsultantReview, analysisConsultantReviewComposer, analysisConsultantReviewInput, analysisConsultantReviewClearContext, analysisConsultantReviewReset, analysisConsultantReviewDetail, analysisConsultantReviewOverview, analysisConsultantReviewBoardInfo, analysisConsultantReviewSchedule });
// A refresh continues this tab's pending fixture instead of adding another request.
analysisConsultantReviewSchedule();
