/* global analysisReport, analysisView, analysisName, esc, render, toast */
/* global document, window, location, sessionStorage, setTimeout, clearTimeout */
/* exported executionRoute, executionBoardTasks, executionDemoStart, executionDemoReset, executionFileRound, executionCurrentRound, executionOpenRound */
// Synthetic file-progress and review fixtures only. No Runner or business command is invoked.
const executionDemoKey = 'zhiju-execution-demo-v1';
const executionLabels = { queued: '等待安排', processing: '处理中', review: '待检查', failed: '处理失败', approved: '已批准' };
let executionStored;
try { executionStored = JSON.parse(sessionStorage.getItem(executionDemoKey)); } catch { /* Optional tab-local demo state. */ }
// Lift the legacy single round without replacing its candidates, approvals or drafts.
const executionDemoRounds = Array.isArray(executionStored?.rounds) ? executionStored.rounds : executionStored?.files?.length ? [{ ...executionStored, id: 'ROUND-1', number: 1 }] : [];
let executionDemoState = executionDemoRounds.find(round => round.id === executionStored?.activeRoundId) || executionDemoRounds[0] || null;
let executionApprovalTarget = null;
const executionReturnTimers = new Map();
const executionRetryTimers = new Map();

function executionDemoSave() {
  try { sessionStorage.setItem(executionDemoKey, JSON.stringify({ version: 2, activeRoundId: executionDemoState?.id || null, rounds: executionDemoRounds })); } catch { /* Never imply server persistence. */ }
}
function executionDemoReset() {
  window.externalRevisionReset?.();
  for (const timer of executionReturnTimers.values()) clearTimeout(timer);
  executionReturnTimers.clear();
  for (const timer of executionRetryTimers.values()) clearTimeout(timer);
  executionRetryTimers.clear();
  executionDemoRounds.length = 0;
  executionDemoState = null;
  executionApprovalTarget = null;
  try { sessionStorage.removeItem(executionDemoKey); } catch { /* Optional demo state. */ }
}
function executionFileRound(fileId) {
  const round = executionDemoRounds.find(item => item.files.some(file => file.id === fileId));
  return round ? { id: round.id, number: round.number, reportKey: round.reportKey } : null;
}
function executionCurrentRound() {
  return executionDemoState ? { id: executionDemoState.id, number: executionDemoState.number } : null;
}
function executionOpenRound(id) {
  const round = executionDemoRounds.find(item => item.id === id);
  if (!round) return false;
  executionDemoState = round;
  executionDemoSave();
  return true;
}
function executionDemoStart(reportKey, ids) {
  const same = executionDemoRounds.find(round => round.reportKey === reportKey && ids.length === round.files.length && ids.every(id => round.files.some(file => file.id === id)));
  if (same) { executionOpenRound(same.id); return true; }
  const files = ids.map(id => analysisReport.plannedFiles.find(file => file.id === id));
  const currentReportKey = `${analysisView.reportEdition || 'initial'}:${analysisReport.narrative.sha256}`;
  if (!files.length || new Set(ids).size !== ids.length || files.some(file => !file) || reportKey !== currentReportKey || analysisView.historyMode) return false;
  if (ids.some(id => executionFileRound(id))) { toast('文件已纳入已有轮次，请查看原轮次；新增范围不能重复提交。'); return false; }
  const number = executionDemoRounds.length + 1;
  const queued = number > 1;
  executionDemoState = {
    id: `ROUND-${number}`, number, reportKey,
    reportLabel: analysisView.reportEdition === 'orgfollowup' ? '补齐组织图后的报告' : analysisView.reportEdition === 'followup' ? '补充职责后的报告' : '首轮报告',
    // Freeze the selected plans rather than reading a newer report for an older round.
    scopeSnapshot: JSON.parse(JSON.stringify({ narrative: analysisReport.narrative, files, changes: analysisReport.changes.filter(change => change.targetPlannedFileIds.some(id => ids.includes(id))) })),
    query: '', filter: 'ALL', current: null, viewedRevision: null, reviewTab: 'changes', pane: 'document',
    files: files.map(file => ({ id: file.id, title: file.title, code: file.customerCode, sourceNames: file.customerSourceIds.map(analysisName), status: queued ? 'queued' : 'processing', revision: 0, drafts: {}, submissions: [] })),
    events: [`第 ${number} 轮请求已记录，绑定确认时的报告和完整文件计划（演示）。`, queued ? '请求已提交，等待服务器安排；已有轮次继续，未开始这批文件。' : '正在按本轮完整处理计划模拟处理；尚未调用 Runner。']
  };
  executionDemoRounds.push(executionDemoState);
  executionDemoSave();
  return true;
}
function executionRoundPicker() {
  return executionDemoRounds.length > 1 ? `<label class="execution-round-picker">查看轮次<select id="executionRoundSelect">${executionDemoRounds.map(round => `<option value="${esc(round.id)}" ${round === executionDemoState ? 'selected' : ''}>${esc(executionRoundOption(round))}</option>`).join('')}</select></label>` : '';
}
function executionRoundOption(round) {
  const count = executionCounts(round.files);
  return `第 ${round.number} 轮 · ${round.files.length} 份${count.queued ? ' · 等待安排' : count.review ? ' · 有文件待检查' : count.processing ? ' · 处理中' : count.failed ? ' · 处理失败' : ' · 已内部批准'}`;
}
function executionCounts(files = executionDemoState?.files || []) {
  return Object.fromEntries(Object.keys(executionLabels).map(status => [status, files.filter(file => file.status === status).length]));
}
function executionRetryPendingCount(files = executionDemoState?.files || []) {
  return files.filter(file => file.status === 'failed' && file.retryRequest?.state === 'pending').length;
}
function executionBoardTasks() {
  if (!executionDemoState) return [];
  const files = executionDemoRounds.flatMap(round => round.files);
  const count = executionCounts(files);
  const retryPending = executionRetryPendingCount(files);
  const failed = count.failed - retryPending;
  const desc = [`${executionDemoRounds.length} 轮`, `${count.review} 份待检查`, `${count.processing} 份处理中`, count.queued ? `${count.queued} 份等待安排` : '', failed ? `${failed} 份处理失败` : '', retryPending ? `${retryPending} 份重试待核验` : '', count.approved ? `${count.approved} 份已批准` : ''].filter(Boolean).join(' · ');
  return [{ id: 'execution', project: '青禾制造', title: '体系文件升级 · 文件进度', desc, group: count.review || failed ? 'attention' : count.processing || count.queued || retryPending ? 'running' : 'done', badge: '查看文件进度' }];
}
function executionSummary() {
  const count = executionCounts();
  if (count.queued) return `第 ${executionDemoState.number} 轮请求已提交，${count.queued} 份文件等待服务器安排；尚未开始处理。已有轮次继续，进度和成果保留。`;
  const retryPending = executionRetryPendingCount();
  if (retryPending) return `${retryPending} 份文件的重试请求待核验，尚未重新执行${count.review ? `；${count.review} 份仍可检查` : ''}${count.processing ? `；另有 ${count.processing} 份正在处理` : ''}${count.failed > retryPending ? `；另有 ${count.failed - retryPending} 份处理失败` : ''}。`;
  if (count.review) return `已有 ${count.review} 份文件可以检查${count.processing ? `，另有 ${count.processing} 份仍在处理` : ''}${count.failed ? `，${count.failed} 份处理失败` : ''}。`;
  if (count.failed) return `${count.failed} 份文件处理失败，请查看文件下方的原因${count.processing ? `；其余 ${count.processing} 份仍在处理` : ''}。`;
  if (count.processing) return `${count.processing} 份文件正在处理。候选交回后，可以逐份检查。`;
  return '本轮文件已完成内部批准；尚未发布或交付。';
}
function executionDemoFile() {
  return executionDemoState?.files.find(file => file.id === executionDemoState.current);
}
function executionFailure(file) {
  const pending = file.retryRequest?.state === 'pending';
  const allowed = file.failure?.retryAllowed === true;
  const reason = file.failure?.reason || '尚未收到可核验的失败原因；请等待服务端返回结果。';
  return `<div class="execution-file-failure"><div><strong>本文件处理失败</strong><p>${esc(reason)}</p><small>本轮其他文件的已有结果保留；这份文件不计为待检查或已完成。</small>${pending ? '<p role="status">重试请求已提交，等待服务器核验（演示）；尚未重新执行。</p>' : !allowed ? '<p>重试条件尚未确认，当前不能直接重新处理。</p>' : ''}</div>${pending ? '<button disabled>重试请求待核验</button>' : allowed ? `<button data-execution-action="retry-file" data-execution-file="${esc(file.id)}">重新处理本文件</button>` : ''}</div>`;
}
function executionRow(file) {
  const message = file.status === 'queued' ? '已确认本轮范围，等待服务器安排；尚未开始生成。' : file.status === 'review' ? `候选第 ${file.revision} 版已交回，等待顾问检查。` : file.status === 'processing' ? file.processingReason === 'retry' ? '正在按本轮范围模拟重试；已有候选与意见保留。' : file.revision ? '正在模拟处理已提交意见；下轮草稿不会自动发送。' : '按本轮已确认的完整计划处理，尚无可检查候选。' : file.status === 'approved' ? `第 ${file.approvedRevision} 版已批准，尚未发布或交付。` : file.retryRequest?.state === 'pending' ? '重试请求已提交，等待核验；尚未重新执行。' : '本次未交回可检查的候选。';
  return `<article class="execution-file-row ${file.status === 'failed' ? 'is-failed' : ''}" data-execution-row="${esc(file.id)}">
    <div class="execution-file-name"><strong>${esc(file.title)}</strong><small>${file.code ? `${esc(file.code)} · ` : ''}Markdown${file.revision ? ` · 候选 ${file.revision}` : ''}</small></div>
    <div class="execution-file-status ${file.status}"><span aria-hidden="true"></span>${executionLabels[file.status]}</div>
    <p class="execution-file-message">${message}</p>
    <div class="execution-file-action">${file.status === 'review' ? `<button class="primary" data-execution-action="open-file" data-execution-file="${esc(file.id)}">检查文件 →</button>` : file.revision ? `<button data-execution-action="open-file" data-execution-file="${esc(file.id)}">查看已交回版本</button>` : `<span>${file.status === 'failed' ? '暂无候选' : file.status === 'queued' ? '等待安排' : '等待候选'}</span>`}</div>
    ${file.status === 'failed' ? executionFailure(file) : ''}
  </article>`;
}
function executionVisibleFiles() {
  const query = executionDemoState.query.trim().toLocaleLowerCase('zh-CN');
  return executionDemoState.files.filter(file => (executionDemoState.filter === 'ALL' || file.status === executionDemoState.filter) && `${file.title} ${file.code || ''}`.toLocaleLowerCase('zh-CN').includes(query));
}
function executionFilesMarkup() {
  const visible = executionVisibleFiles();
  return visible.length ? visible.map(executionRow).join('') : '<div class="execution-empty"><strong>没有匹配的文件</strong><p>调整名称或状态筛选；本轮范围不会改变。</p></div>';
}
function executionDemoControls() {
  const count = executionCounts();
  return `<details class="execution-demo-tools"><summary>演示控制</summary><div><small>以下操作只改变本标签页的合成状态，不会调用 Runner。</small><div class="row">${count.queued ? '<button data-execution-action="start-queued">模拟服务器开始本轮</button>' : ''}<button data-execution-action="return-one" ${count.processing ? '' : 'disabled'}>模拟一份交回</button><button data-execution-action="return-later" ${count.processing && !executionReturnTimers.has(executionDemoState.id) ? '' : 'disabled'}>5 秒后交回一份</button><button data-execution-action="return-all" ${count.processing ? '' : 'disabled'}>模拟其余交回</button><button data-execution-action="fail-one" ${count.processing ? '' : 'disabled'}>模拟一份失败</button></div>${window.externalRevisionTools?.(executionDemoFile()) || ''}</div></details>`;
}
function executionProgressPage() {
  const count = executionCounts();
  return `<section class="execution-shell"><div class="execution-heading"><div><div class="execution-crumb"><a href="#board">← 返回工作台</a><span>青禾制造 / 体系文件升级</span></div><h1>文件升级进度</h1><p>第 ${executionDemoState.number} 轮 · 共 ${executionDemoState.files.length} 份文件 · ${executionDemoState.reportLabel}确认范围（演示）</p></div><div class="execution-heading-actions">${executionRoundPicker()}<a href="#project-delivery">准备项目交付 ↗</a><a href="#analysis">查看分析总览 ↗</a></div></div>
    <p class="execution-summary" id="executionSummary" role="status">${executionSummary()}</p>
    <section class="execution-list-panel" aria-label="本轮文件进度"><div class="execution-toolbar"><div class="execution-filters" role="group" aria-label="筛选处理状态">${[['ALL', '全部'], ['review', '待检查'], ['processing', '处理中'], ['queued', '等待安排'], ['failed', '处理失败'], ['approved', '已批准']].map(([key, label]) => `<button data-execution-filter="${key}" aria-pressed="${executionDemoState.filter === key}">${label}<span>${key === 'ALL' ? executionDemoState.files.length : count[key]}</span></button>`).join('')}</div><label><span class="sr-only">搜索本轮文件</span><input id="executionSearch" type="search" placeholder="搜索文件名或编号" value="${esc(executionDemoState.query)}"></label></div>
    <div class="execution-table-heading" aria-hidden="true"><span>文件</span><span>处理状态</span><span>最新进展</span><span>操作</span></div><div class="execution-file-list" id="executionFileList" tabindex="0" aria-label="本轮文件清单">${executionFilesMarkup()}</div><p class="execution-list-foot" id="executionListCount">显示 ${executionVisibleFiles().length} / ${executionDemoState.files.length} 份 · 文件交回不等于批准或交付</p></section>
    <div class="execution-secondary"><details><summary>本轮范围与运行记录</summary><div class="execution-run-detail"><p>本轮依据：${executionDemoState.reportLabel}（演示）。仅处理顾问已选的 ${executionDemoState.files.length} 份文件；未选与暂不能处理的文件不计入本轮进度。</p><ul>${executionDemoState.files.map(file => `<li><strong>${esc(file.title)}</strong> ← ${file.sourceNames.map(esc).join('、')}</li>`).join('')}</ul><ol id="executionRunEvents">${executionDemoState.events.map(event => `<li>${esc(event)}</li>`).join('')}</ol><p class="muted">真实运行时信息、日志、授权与候选接纳仍由服务器提供；本页没有连接运行时。</p></div></details>${executionDemoControls()}</div>
  </section>`;
}
function executionCandidateExcerpt(file) {
  const manual = file.id === 'F-MANUAL';
  const kind = file.id === 'F-CORR' ? '纠正' : '预防';
  return manual ? '依据本轮补充的组织关系说明保留企业现有安排；不按公司模板重写岗位或汇报关系。' : `保持企业既有${kind}措施流程及职责分工；与另一份程序分别维护。`;
}
function executionCandidateMarkdown(file, revision) {
  if (file.candidateVersions?.[revision]) return file.candidateVersions[revision];
  return `# ${file.title}\n\n${file.code || ''} · 候选第 ${revision} 版 · 合成 Markdown 示例\n\n## 1 目的\n\n此内容仅用于验证文件进度到检查页面的衔接。\n\n## 2 处理程序\n\n${executionCandidateExcerpt(file)}\n\n## 3 本轮处理说明\n\n整理为 Markdown 检查稿；不模拟法规分析或企业真实流程。\n`;
}
function executionDeliveryFiles() {
  return executionDemoRounds.flatMap(round => round.files.map(file => ({
    key: `${round.id}:${file.id}:${file.revision}`, id: file.id, name: file.title, code: file.code || '',
    revision: file.revision, approvedRevision: file.approvedRevision || null, status: file.status,
    roundId: round.id, roundNumber: round.number, reportKey: round.reportKey, reportLabel: round.reportLabel,
    content: file.revision ? (file.status === 'approved' && file.approvedRevision === file.revision && file.approvedContent ? file.approvedContent : executionCandidateMarkdown(file, file.revision)) : null
  })));
}
function executionCandidateBody(file, revision, full) {
  const manual = file.id === 'F-MANUAL';
  const excerpt = executionCandidateExcerpt(file);
  if (full && file.candidateVersions?.[revision]) return `<div class="execution-document">${file.candidateVersions[revision].split('\n').filter(line => line.trim()).map(line => line.startsWith('# ') ? `<h2>${esc(line.slice(2))}</h2>` : line.startsWith('## ') ? `<h3>${esc(line.slice(3))}</h3>` : `<p>${esc(line)}</p>`).join('')}</div>`;
  const returned = file.externalCandidateResults?.[revision];
  if (!full && returned) return `<div class="execution-change"><div class="execution-change-heading"><strong>第 1 处 · 改稿复核说明</strong><span>固定合成复核结果</span></div><p class="muted">原改稿基于第 ${returned.baselineRevision} 版；本次变化对照提交时第 ${returned.latestRevision} 版。</p><div class="execution-diff"><section><small>提交时成果第 ${returned.latestRevision} 版（合成）</small><p>${excerpt}</p></section><section><small>复核候选第 ${revision} 版（合成）</small><p>${excerpt}</p><p><ins>${esc(returned.note)}</ins></p></section></div><p>企业既有职责保持原样。仅演示格式与说明补充，不代表真实法规、质量或授权核验。</p></div>`;
  // Deliberately synthetic excerpts: the analysis report contains no generated candidate bytes.
  if (full) return `<div class="execution-document"><h2>${esc(file.title)}</h2><p class="muted">${esc(file.code || '')} · 候选第 ${revision} 版 · 合成 Markdown 示例</p><h3>1 目的</h3><p>此内容仅用于验证文件进度到检查页面的衔接。</p><h3>2 处理程序</h3><p>${excerpt}</p><h3>3 本轮处理说明</h3><p>整理为 Markdown 检查稿；不模拟法规分析或企业真实流程。</p></div>`;
  return `<div class="execution-change"><div class="execution-change-heading"><strong>第 1 处 · 保留既有流程</strong><span>Markdown 整理示例</span></div><p class="muted">本轮计划“${manual ? '保留企业组织与职责' : '保持纠正与预防分立'}”。以下两侧为合成节选，不是客户原文或真实 Runner 输出。</p><div class="execution-diff"><section><small>原文件（合成节选）</small><p>${excerpt}</p></section><section><small>候选第 ${revision} 版（合成节选）</small><p>${excerpt}</p></section></div><h3>上下文</h3><p>${manual ? '组织资料已补充；职责制度的保护冲突仍单独等待。' : '两份程序独立保留。'}本处演示格式整理，未新增企业流程或修改职责。</p></div>`;
}
function executionReviewNotice(file) {
  return file.revision > executionDemoState.viewedRevision ? `<div class="execution-revision-notice"><strong>候选第 ${file.revision} 版已交回</strong><p>仍在查看第 ${executionDemoState.viewedRevision} 版；当前意见已保留。</p><button data-execution-action="switch-revision">查看第 ${file.revision} 版</button></div>` : '';
}
function executionReviewPage() {
  const file = executionDemoFile();
  if (!file?.revision) return executionEmptyPage('本文件尚无可检查候选', '返回本轮进度，先检查已经交回的文件。');
  const revision = executionDemoState.viewedRevision;
  const draft = file.drafts[revision] || '';
  const canSubmit = file.status === 'review' && revision === file.revision;
  return `<section class="execution-shell execution-review-shell"><div class="execution-heading"><div><div class="execution-crumb"><a href="#execution">← 返回第 ${executionDemoState.number} 轮文件</a><span>青禾制造 / 体系文件升级</span></div><h1>文件检查</h1></div><p id="executionReviewCount">${executionCounts().review} 份待检查 · ${executionCounts().processing} 份处理中</p></div>
    <div class="execution-pane-switch"><button data-execution-pane="document" aria-pressed="${executionDemoState.pane === 'document'}">查看文档</button><button data-execution-pane="feedback" aria-pressed="${executionDemoState.pane === 'feedback'}">意见与处理</button></div>
    <div class="execution-review-grid pane-${executionDemoState.pane}"><nav class="execution-review-files" aria-label="本轮成果">${executionDemoState.files.map(item => `<button data-execution-action="open-file" data-execution-file="${esc(item.id)}" aria-current="${item.id === file.id ? 'true' : 'false'}" ${item.revision ? '' : 'disabled'}><strong>${esc(item.title)}</strong><small data-execution-nav-status="${esc(item.id)}">${executionLabels[item.status]}</small></button>`).join('')}</nav>
    <section class="execution-review-content"><div class="execution-file-heading"><h2>${esc(file.title)}</h2><p>${esc(file.code || '')} · Markdown · 正在查看候选 ${revision}（合成）<a class="multi-preview-entry" href="#changes-preview">查看多处修改示例 ↗</a></p></div><div id="executionReviewUpdate">${executionReviewNotice(file)}</div><nav class="execution-review-tabs" aria-label="候选内容"><button data-execution-tab="changes" aria-pressed="${executionDemoState.reviewTab === 'changes'}">变化详情</button><button data-execution-tab="full" aria-pressed="${executionDemoState.reviewTab === 'full'}">完整文件</button></nav><div class="execution-review-paper" tabindex="0" aria-label="候选内容阅读区">${executionCandidateBody(file, revision, executionDemoState.reviewTab === 'full')}</div></section>
    <aside class="execution-review-feedback"><label for="executionFeedback">意见与处理</label><p>${esc(file.title)} · 候选第 ${revision} 版</p><textarea id="executionFeedback" placeholder="${file.externalDraft ? '可选：补充改稿要求或依据…' : '写下这份文件需要调整的内容…'}">${esc(draft)}</textarea><small id="executionDraftState">草稿仅保存在本标签页（演示）</small>${window.externalRevisionPanel?.(file, executionDemoState) || ''}<p class="execution-feedback-state" id="executionFeedbackState">${file.status === 'processing' ? '本轮模拟处理中。可以继续写下轮草稿，草稿不会自动发送。' : file.status === 'failed' ? '最近一次处理失败，已有候选和草稿保留；返回本轮文件可查看原因与重试入口。' : file.status === 'approved' ? `第 ${file.approvedRevision} 版已批准（演示），尚未发布或交付。` : '修改意见需明确提交；批准仍逐份确认具体版本。'}</p><button class="primary" data-execution-action="submit-feedback" ${canSubmit && draft.trim() ? '' : 'disabled'}>提交并修改</button><button class="execution-approve" data-execution-action="approve" ${canSubmit && !draft.trim() ? '' : 'disabled'}>批准第 ${revision} 版</button><small class="execution-approve-mobile">复杂检查与批准请在桌面完成。</small>${executionDemoControls()}</aside></div>
  </section>`;
}
function executionEmptyPage(title, message) {
  return `<section class="execution-shell"><div class="execution-crumb"><a href="#board">← 返回工作台</a></div><div class="execution-empty"><h1>${title}</h1><p>${message}</p><a href="#analysis">前往分析总览选择本轮文件 →</a></div></section>`;
}
function executionRoute() {
  if (!['#execution', '#execution-review'].includes(location.hash)) return null;
  if (!executionDemoState) return executionEmptyPage('尚未确认本轮文件', '先从分析总览选择本轮要处理的文件。');
  return location.hash === '#execution-review' ? executionReviewPage() : executionProgressPage();
}
function executionRefreshBoard() {
  const card = document.querySelector('[data-task="execution"]');
  if (!card) return;
  const task = executionBoardTasks()[0];
  const focused = document.activeElement === card;
  card.querySelector('p').textContent = task.desc;
  const target = document.querySelector(`.simple-board .column.${task.group}`);
  if (target && card.parentElement !== target) { target.querySelector('.empty')?.remove(); target.append(card); }
  for (const column of document.querySelectorAll('.simple-board .column')) {
    const count = column.querySelector('.coltitle span');
    if (count) count.textContent = column.querySelectorAll('.card').length;
    if (!column.querySelector('.card') && !column.querySelector('.empty')) column.insertAdjacentHTML('beforeend', '<div class="empty">暂无工作</div>');
  }
  const completed = document.querySelector('.simple-board-completed>summary');
  if (completed) completed.textContent = `已处理 · ${document.querySelectorAll('.simple-board .column.done .card').length}`;
  if (focused) card.focus({ preventScroll: true });
}
function executionRefreshList() {
  const list = document.getElementById('executionFileList');
  if (!list) return;
  const scroll = list.scrollTop;
  const focusedFile = document.activeElement?.closest('[data-execution-row]')?.dataset.executionRow;
  const focusedAction = document.activeElement?.dataset.executionAction;
  list.innerHTML = executionFilesMarkup();
  list.scrollTop = scroll;
  if (focusedFile) {
    const row = [...list.querySelectorAll('[data-execution-row]')].find(item => item.dataset.executionRow === focusedFile);
    const button = row && [...row.querySelectorAll('button')].find(item => item.dataset.executionAction === focusedAction && !item.disabled);
    if (button) button.focus({ preventScroll: true });
    else if (row) { row.tabIndex = -1; row.focus({ preventScroll: true }); }
    else list.focus({ preventScroll: true });
  }
  document.getElementById('executionSummary').textContent = executionSummary();
  document.getElementById('executionListCount').textContent = `显示 ${executionVisibleFiles().length} / ${executionDemoState.files.length} 份 · 文件交回不等于批准或交付`;
  const count = executionCounts();
  for (const button of document.querySelectorAll('[data-execution-filter]')) {
    button.setAttribute('aria-pressed', String(executionDemoState.filter === button.dataset.executionFilter));
    button.querySelector('span').textContent = button.dataset.executionFilter === 'ALL' ? executionDemoState.files.length : count[button.dataset.executionFilter];
  }
}
function executionDemoRefresh() {
  window.projectDeliveryRefresh?.();
  if (!executionDemoState) return;
  for (const option of document.querySelectorAll('#executionRoundSelect option')) {
    const round = executionDemoRounds.find(item => item.id === option.value);
    if (round) option.textContent = executionRoundOption(round);
  }
  if (location.hash === '#board' || !location.hash) executionRefreshBoard();
  if (location.hash === '#execution') executionRefreshList();
  if (location.hash === '#execution-review' && document.getElementById('executionReviewCount')) {
    const count = executionCounts();
    document.getElementById('executionReviewCount').textContent = `${count.review} 份待检查 · ${count.processing} 份处理中`;
    for (const status of document.querySelectorAll('[data-execution-nav-status]')) {
      const item = executionDemoState.files.find(file => file.id === status.dataset.executionNavStatus);
      status.textContent = executionLabels[item.status];
      status.closest('button').disabled = !item.revision;
    }
    const file = executionDemoFile();
    const update = document.getElementById('executionReviewUpdate');
    if (update) update.innerHTML = executionReviewNotice(file);
    const submit = document.querySelector('[data-execution-action="submit-feedback"]');
    const approve = document.querySelector('[data-execution-action="approve"]');
    const canSubmit = file.status === 'review' && executionDemoState.viewedRevision === file.revision;
    const draft = file.drafts[executionDemoState.viewedRevision] || '';
    if (submit) submit.disabled = !canSubmit || !draft.trim();
    if (approve) approve.disabled = !canSubmit || Boolean(draft.trim());
    const feedbackState = document.getElementById('executionFeedbackState');
    if (feedbackState) feedbackState.textContent = file.revision > executionDemoState.viewedRevision ? '新候选已交回。核对新内容与原引用后，再明确提交下一轮意见。' : file.status === 'processing' ? '本轮模拟处理中。可以继续写下轮草稿，草稿不会自动发送。' : file.status === 'failed' ? '最近一次处理失败，已有候选和草稿保留；返回本轮文件可查看原因与重试入口。' : file.status === 'approved' ? `第 ${file.approvedRevision} 版已批准（演示），尚未发布或交付。` : '修改意见需明确提交；批准仍逐份确认具体版本。';
  }
  const events = document.getElementById('executionRunEvents');
  if (events) events.innerHTML = executionDemoState.events.map(event => `<li>${esc(event)}</li>`).join('');
  for (const button of document.querySelectorAll('[data-execution-action="return-one"], [data-execution-action="return-all"], [data-execution-action="fail-one"]')) button.disabled = !executionCounts().processing;
  const later = document.querySelector('[data-execution-action="return-later"]');
  if (later) later.disabled = !executionCounts().processing || executionReturnTimers.has(executionDemoState.id);
  window.externalRevisionUpdate?.();
}
function executionDemoReturn(all = false, round = executionDemoState) {
  const files = round?.files.filter(file => file.status === 'processing') || [];
  for (const file of all ? files : files.slice(0, 1)) {
    file.revision += 1;
    file.status = 'review';
    round.events.push(`${file.title} · 候选第 ${file.revision} 版交回，待检查（演示）。`);
  }
  executionDemoSave();
  // Patch only progress surfaces. Never replace the document or composer on arrival.
  executionDemoRefresh();
}
function executionScheduleRetries() {
  for (const snapshot of executionDemoRounds) for (const file of snapshot.files) {
    const timerKey = `${snapshot.id}:${file.id}`;
    const request = file.retryRequest;
    if (file.status !== 'failed' || request?.state !== 'pending' || executionRetryTimers.has(timerKey)) continue;
    // A fixed service-response fixture, not authorization or retry policy in the UI.
    const timer = setTimeout(() => {
      executionRetryTimers.delete(timerKey);
      if (!executionDemoRounds.includes(snapshot) || file.retryRequest !== request || request.state !== 'pending' || file.status !== 'failed') return;
      if (file.failure?.retryAllowed !== true || request.reportKey !== snapshot.reportKey || request.baselineRevision !== file.revision) {
        request.state = 'rejected';
        snapshot.events.push(`${file.title} · 重试核验未通过（演示），保留失败状态与已有候选。`);
      } else {
        request.state = 'started'; file.status = 'processing'; file.processingReason = 'retry';
        snapshot.events.push(`${file.title} · 第 ${request.sequence} 次重试已开始（演示）；旧失败记录和候选保留。`);
      }
      executionDemoSave(); executionDemoRefresh();
    }, 2000);
    executionRetryTimers.set(timerKey, timer);
  }
}
function executionOpenFile(id) {
  const file = executionDemoState.files.find(item => item.id === id);
  if (!file?.revision) return;
  executionDemoState.current = file.id;
  executionDemoState.viewedRevision = file.revision;
  executionDemoState.reviewTab = 'changes';
  executionDemoState.pane = 'document';
  executionDemoSave();
  if (location.hash === '#execution-review') render(); else location.hash = 'execution-review';
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || !executionDemoState) return;
  if (button.dataset.executionFilter) {
    executionDemoState.filter = button.dataset.executionFilter; executionDemoSave(); executionRefreshList(); return;
  }
  if (button.dataset.executionTab || button.dataset.executionPane) {
    if (button.dataset.executionTab) executionDemoState.reviewTab = button.dataset.executionTab;
    if (button.dataset.executionPane) executionDemoState.pane = button.dataset.executionPane;
    executionDemoSave(); render();
    document.querySelector(button.dataset.executionTab ? `[data-execution-tab="${executionDemoState.reviewTab}"]` : `[data-execution-pane="${executionDemoState.pane}"]`)?.focus();
    return;
  }
  const action = button.dataset.executionAction;
  if (action === 'open-file') { executionOpenFile(button.dataset.executionFile); return; }
  if (action === 'return-one' || action === 'return-all') { executionDemoReturn(action === 'return-all'); return; }
  if (action === 'start-queued' && executionCounts().queued) {
    for (const item of executionDemoState.files) if (item.status === 'queued') item.status = 'processing';
    executionDemoState.events.push('模拟服务器已安排本轮执行；其他轮次的范围与成果未改变。');
    executionDemoSave(); render(); return;
  }
  if (action === 'return-later' && !executionReturnTimers.has(executionDemoState.id) && executionCounts().processing) {
    const round = executionDemoState;
    executionReturnTimers.set(round.id, setTimeout(() => { executionReturnTimers.delete(round.id); if (executionDemoRounds.includes(round)) executionDemoReturn(false, round); }, 5000));
    executionDemoRefresh(); toast('演示：5 秒后交回一份，期间可以返回工作台或查看其他文件。'); return;
  }
  if (action === 'fail-one') {
    const file = executionDemoState.files.find(item => item.status === 'processing');
    if (!file) return;
    file.status = 'failed';
    file.failure = { reason: '演示原因：运行结束时未收到本次约定的候选文件。', retryAllowed: true };
    executionDemoState.events.push(`${file.title}未交回候选（模拟失败）；演示服务结果允许请求重试，其他文件结果保留。`);
    executionDemoSave(); executionDemoRefresh(); return;
  }
  if (action === 'retry-file') {
    const target = executionDemoState.files.find(item => item.id === button.dataset.executionFile);
    if (!target || target.status !== 'failed' || target.failure?.retryAllowed !== true || target.retryRequest?.state === 'pending') return;
    target.retryRequest = { state: 'pending', sequence: (target.retryRequest?.sequence || 0) + 1, reportKey: executionDemoState.reportKey, fileId: target.id, baselineRevision: target.revision };
    executionDemoState.events.push(`${target.title} · 第 ${target.retryRequest.sequence} 次重试请求已提交（演示），等待核验。`);
    executionDemoSave(); executionScheduleRetries(); executionDemoRefresh(); return;
  }
  const file = executionDemoFile();
  if (!file) return;
  if (action === 'switch-revision') { executionDemoState.viewedRevision = file.revision; executionDemoState.reviewTab = 'changes'; executionDemoSave(); render(); return; }
  if (action === 'submit-feedback' && window.externalRevisionBlocked?.(file)) {
    if (window.externalRevisionCanSubmit(file, executionDemoState)) void window.externalRevisionSubmit(executionDemoState, file);
    return;
  }
  if (action === 'submit-feedback') {
    const revision = executionDemoState.viewedRevision;
    const text = file.drafts[revision]?.trim();
    if (!text || file.status !== 'review' || revision !== file.revision) return;
    file.submissions.push({ revision, text }); file.drafts[revision] = ''; file.status = 'processing'; file.processingReason = 'feedback';
    executionDemoState.events.push(`${file.title} · 第 ${revision} 版意见已提交，模拟处理中。`);
    executionDemoSave(); render(); toast('意见已提交（演示）；仍在当前文件，可以继续写下轮草稿。'); return;
  }
  if (action === 'approve') {
    if (window.externalRevisionBlocked?.(file) || window.innerWidth <= 700 || file.status !== 'review' || executionDemoState.viewedRevision !== file.revision || file.drafts[file.revision]?.trim()) return;
    executionApprovalTarget = { roundId: executionDemoState.id, id: file.id, revision: file.revision };
    const dialog = document.getElementById('dialog');
    dialog.innerHTML = `<h2 id="dialogTitle">批准此版本（演示）</h2><p><strong>${esc(file.title)} · 候选第 ${file.revision} 版</strong></p><p>仅演示智举内部批准，不代表客户签批、发布或交付。正式质量与授权校验尚未运行。</p><p>明确批准成功后，自动进入下一份待检查文件。</p><div class="row"><button data-execution-action="cancel-approve">返回检查</button><button class="primary" data-execution-action="confirm-approve">确认批准第 ${file.revision} 版（演示）</button></div>`;
    dialog.showModal(); return;
  }
  if (action === 'cancel-approve') { executionApprovalTarget = null; document.getElementById('dialog').close(); return; }
  if (action === 'confirm-approve') {
    const target = executionDemoState.files.find(item => item.id === executionApprovalTarget?.id);
    if (!target || executionDemoState.id !== executionApprovalTarget.roundId || target.revision !== executionApprovalTarget.revision || target.status !== 'review' || window.externalRevisionBlocked?.(target) || target.drafts[target.revision]?.trim()) { document.getElementById('dialog').close(); executionApprovalTarget = null; return; }
    target.approvedRevision = target.revision; target.approvedContent = executionCandidateMarkdown(target, target.revision); target.status = 'approved'; executionApprovalTarget = null;
    document.getElementById('dialog').close();
    executionDemoState.events.push(`${target.title} · 第 ${target.revision} 版批准成功（演示），未发布或交付。`);
    const next = executionDemoState.files.find(item => item.status === 'review');
    executionDemoSave();
    if (next) executionOpenFile(next.id); else render();
    toast(next ? '批准成功（演示），已进入下一份待检查文件。' : '批准成功（演示）；本轮暂无其他待检查文件。');
  }
});
document.addEventListener('change', event => {
  if (event.target.id !== 'executionRoundSelect' || location.hash !== '#execution') return;
  if (executionOpenRound(event.target.value)) { render(); document.getElementById('executionRoundSelect')?.focus(); }
});
document.addEventListener('input', event => {
  if (!executionDemoState) return;
  if (event.target.id === 'executionSearch' && !event.isComposing) { executionDemoState.query = event.target.value; executionDemoSave(); executionRefreshList(); }
  if (event.target.id === 'executionFeedback') { executionDemoFile().drafts[executionDemoState.viewedRevision] = event.target.value; executionDemoSave(); executionDemoRefresh(); }
});
document.addEventListener('compositionend', event => {
  if (executionDemoState && event.target.id === 'executionSearch') { executionDemoState.query = event.target.value; executionDemoSave(); executionRefreshList(); }
});
Object.assign(window, { executionRoute, executionBoardTasks, executionDemoStart, executionDemoReset, executionFileRound, executionCurrentRound, executionOpenRound, executionDeliveryFiles, executionCandidateMarkdown });
// Resume the same pending fixture receipt after a reload; do not submit a new request.
executionScheduleRetries();
