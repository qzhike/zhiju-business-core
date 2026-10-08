/* global analysisReport, analysisView, analysisName, analysisOpenPlanFeedback, analysisPlanFeedbackPending, executionDemoStart, executionFileRound, executionCurrentRound, executionOpenRound, analysisReportLabel, esc, render, document, sessionStorage, window, location */
/* exported analysisScopeEntry, analysisScopeResetDemo */
// Fixed eligibility illustrates the UI. Only a real service can authorize execution.
const analysisScopeStorageKey = 'zhiju-analysis-scope-demo-v1';
const analysisScopeFixture = {
  'F-ROLE': { selectable: false, label: '需补资料并确认职责', reason: '请客户提供现行岗位职责文件，或确认尚无成文文件；还需可读组织图，并确认新制度不会擅自改变现有职责。' },
  'F-MANUAL': { selectable: false, label: '需补可读组织图', reason: '已上传手册中的组织图未可靠读取；需补充可阅读版本或组织关系说明。' },
  'F-CORR': { selectable: true, label: '本轮可处理', reason: '本轮拟保留客户现有纠正流程，并形成 Markdown 审核稿。' },
  'F-PREV': { selectable: true, label: '本轮可处理', reason: '本轮拟保留客户现有预防流程，并形成 Markdown 审核稿。' }
};
const analysisScopeCategories = [
  ['MANUAL', '质量手册'], ['PROCEDURE', '程序文件'], ['POLICY', '管理制度'], ['FORM', '记录表单']
];
const analysisScopeOrigins = {
  CUSTOMER_REVISION: '升级客户现有文件', CUSTOMER_CONVERSION: '保留客户内容', TEMPLATE_DERIVED: '参考模板新建'
};
const analysisScopeInitial = () => ({ reportKey: '', selected: [], query: '', category: 'ALL', filter: 'ALL', receipt: null });
let analysisScopeState;
try { analysisScopeState = JSON.parse(sessionStorage.getItem(analysisScopeStorageKey)); } catch { /* Use the initial demo selection. */ }
if (!analysisScopeState || !Array.isArray(analysisScopeState.selected)) analysisScopeState = analysisScopeInitial();
if (analysisScopeState.receipt && !Array.isArray(analysisScopeState.receipt.fileIds)) analysisScopeState.receipt = null;

function analysisScopeSave() {
  try { sessionStorage.setItem(analysisScopeStorageKey, JSON.stringify(analysisScopeState)); } catch { /* Demo selections are optional. */ }
}
function analysisScopeResetDemo() {
  analysisScopeState = analysisScopeInitial();
  try { sessionStorage.removeItem(analysisScopeStorageKey); } catch { /* Optional demo storage. */ }
  const dialog = document.getElementById('analysisScopeDialog');
  if (dialog?.open) dialog.close();
}
function analysisScopeStatus(file) {
  const existingRound = file && executionFileRound(file.id);
  if (existingRound) return { selectable: false, included: true, label: `已纳入第 ${existingRound.number} 轮`, reason: '在原轮次查看进度、候选和意见；本次新增范围不重复提交这份文件。' };
  if (file && analysisPlanFeedbackPending(file.id)) return { selectable: false, label: '计划意见待复核', reason: '顾问已对这份文件的处理计划提出意见。需等待 Runner 返回修订计划后重新核对，本轮先不要处理。' };
  if (file?.id === 'F-MANUAL' && analysisView.reportEdition === 'orgfollowup' && !file.attentionItemIds.length) return { selectable: true, label: '本轮可处理', reason: '演示服务结果：已补充可读组织关系说明；按新报告完整计划保留企业现状并整理手册。' };
  if (file?.id === 'F-ROLE' && analysisView.reportEdition === 'orgfollowup') return { selectable: false, label: '职责保护冲突仍待复核', reason: '组织资料已补充，但模板职责与企业现行安排的冲突仍需顾问意见和 Runner 复核；本次不处理这份制度。' };
  return (file && analysisScopeFixture[file.id]) || { selectable: false, label: '尚未核验', reason: '演示未给出此文件的处理条件核验结果。' };
}
function analysisScopeEnsureReport() {
  const reportKey = `${analysisView.reportEdition || 'initial'}:${analysisReport.narrative.sha256}`;
  if (analysisScopeState.reportKey !== reportKey) {
    analysisScopeState = { ...analysisScopeInitial(), reportKey };
    analysisScopeSave();
  }
  const valid = new Set(analysisReport.plannedFiles.filter(file => analysisScopeStatus(file).selectable).map(file => file.id));
  const selected = analysisScopeState.selected.filter(id => valid.has(id));
  if (selected.length !== analysisScopeState.selected.length || analysisScopeState.receipt?.fileIds.some(id => !analysisReport.plannedFiles.some(file => file.id === id))) {
    analysisScopeState.selected = selected;
    if (analysisScopeState.receipt?.fileIds.some(id => !analysisReport.plannedFiles.some(file => file.id === id))) analysisScopeState.receipt = null;
    analysisScopeSave();
  }
}
function analysisScopeEntry() {
  if (!analysisReport || analysisView.historyMode) return '';
  analysisScopeEnsureReport();
  const available = analysisReport.plannedFiles.filter(file => analysisScopeStatus(file).selectable).length;
  const included = analysisReport.plannedFiles.filter(file => analysisScopeStatus(file).included).length;
  const waiting = analysisReport.plannedFiles.length - available - included;
  const current = executionCurrentRound();
  return `<section class="analysis-scope-entry" aria-label="文件处理范围"><span class="analysis-scope-entry-mark">文件升级</span><div class="analysis-scope-entry-copy"><strong>${available ? `${available} 份${current ? '新增文件' : '文件'}可处理` : '暂无新增可处理文件'}</strong><span>${included ? `${included} 份已纳入已有轮次 · ` : ''}${waiting ? `${waiting} 份暂不能处理 · ` : ''}${current ? '已有轮次继续；新增文件另行确认' : '逐份勾选后，再确认完整文件计划'}</span></div><div class="analysis-scope-entry-actions">${current ? '<button data-analysis-scope-action="progress">查看文件进度</button>' : ''}<button class="primary" data-analysis-scope-action="open">${current ? available ? '选择新增文件' : '查看剩余文件' : '选择本轮文件'} →</button></div></section>`;
}
let analysisScopeReturnFocus = true;
function analysisScopeDialog() {
  let dialog = document.getElementById('analysisScopeDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'analysisScopeDialog';
  dialog.className = 'analysis-scope-dialog';
  dialog.setAttribute('aria-labelledby', 'analysisScopeTitle');
  dialog.addEventListener('close', () => {
    if (analysisScopeReturnFocus) document.querySelector('[data-analysis-scope-action="open"]')?.focus();
    analysisScopeReturnFocus = true;
  });
  document.body.append(dialog);
  return dialog;
}
function analysisScopePlan(file) {
  const changes = analysisReport.changes.filter(change => change.targetPlannedFileIds.includes(file.id));
  const issues = analysisReport.attentionItems.filter(item => file.attentionItemIds.includes(item.id));
  return `<details class="analysis-scope-detail"><summary>查看本轮计划与依据</summary>
    ${changes.map(change => `<div class="analysis-scope-action"><strong>${esc(change.title)}</strong><p>${esc(change.description)}</p><button data-analysis-scope-action="plan-feedback" data-file-id="${esc(file.id)}" data-change-id="${esc(change.id)}">对这项计划提意见 →</button></div>`).join('') || '<p>报告尚未列出具体修改项目。</p>'}
    <p><strong>客户资料：</strong>${file.customerSourceIds.map(id => esc(analysisName(id))).join('、') || '未关联'}</p>
    <p><strong>参考模板：</strong>${file.templateSourceIds.map(id => esc(analysisName(id))).join('、') || '未关联'}</p>
    ${issues.length ? `<p><strong>等待事项：</strong>${issues.map(item => esc(item.title)).join('；')}</p>` : ''}
  </details>`;
}
function analysisScopeFile(file) {
  const status = analysisScopeStatus(file);
  const checked = analysisScopeState.selected.includes(file.id);
  const reasonId = `analysisScopeReason-${esc(file.id)}`;
  return `<article class="analysis-scope-file ${status.selectable ? '' : status.included ? 'is-included' : 'is-waiting'}" data-analysis-scope-file="${esc(file.id)}">
    <div class="analysis-scope-file-main">
      <label class="analysis-scope-check"><input type="checkbox" data-analysis-scope-select="${esc(file.id)}" aria-label="选择${esc(file.title)}" aria-describedby="${reasonId}" ${checked ? 'checked' : ''} ${status.selectable ? '' : 'disabled'}></label>
      <div class="analysis-scope-file-copy"><small>${file.customerCode ? `${esc(file.customerCode)} · ` : ''}${esc(analysisScopeOrigins[file.origin] || file.origin)}</small><strong>${esc(file.title)}</strong>${status.selectable ? `<p id="${reasonId}">${esc(status.reason)}</p>` : ''}</div>
      ${status.selectable ? `<span class="analysis-scope-file-state">${esc(status.label)}</span>` : ''}
    </div>${status.selectable ? '' : `<div class="analysis-scope-blocker ${status.included ? 'is-included' : ''}" id="${reasonId}"><span class="analysis-scope-blocker-icon" aria-hidden="true">!</span><div><strong>${status.included ? '' : '暂不能处理 · '}${esc(status.label)}</strong><p>${esc(status.reason)}</p></div></div>`}${analysisScopePlan(file)}
  </article>`;
}
function analysisScopeVisibleFiles() {
  const query = analysisScopeState.query.trim().toLocaleLowerCase('zh-CN');
  return analysisReport.plannedFiles.filter(file => {
    if (analysisScopeState.category !== 'ALL' && file.category !== analysisScopeState.category) return false;
    if (analysisScopeState.filter === 'SELECTABLE' && !analysisScopeStatus(file).selectable) return false;
    if (analysisScopeState.filter === 'WAITING' && (analysisScopeStatus(file).selectable || analysisScopeStatus(file).included)) return false;
    const haystack = [file.title, file.customerCode, file.proposedOutputPath, ...file.customerSourceIds.map(analysisName)].filter(Boolean).join(' ').toLocaleLowerCase('zh-CN');
    return haystack.includes(query);
  });
}
function analysisScopeSelectionView() {
  const files = analysisReport.plannedFiles;
  const visible = analysisScopeVisibleFiles();
  const available = files.filter(file => analysisScopeStatus(file).selectable).length;
  const included = files.filter(file => analysisScopeStatus(file).included).length;
  const waiting = files.length - available - included;
  const categories = analysisScopeCategories.filter(([key]) => files.some(file => file.category === key));
  const groups = categories.map(([key, label]) => {
    const members = visible.filter(file => file.category === key);
    return members.length ? `<section class="analysis-scope-group"><h3>${label}<span>${members.length}</span></h3>${members.map(analysisScopeFile).join('')}</section>` : '';
  }).join('');
  return `<div class="analysis-scope-head"><div><small>青禾制造 / 体系文件升级 · ${analysisReportLabel()}</small><h2 id="analysisScopeTitle">${executionCurrentRound() ? '选择新增文件' : '选择本轮文件'}</h2><p>逐份勾选；选中即采用该文件当前报告的完整处理计划。暂不能处理的原因见文件下方。</p></div><button class="analysis-scope-close" data-analysis-scope-action="close" aria-label="关闭选择面板">×</button></div>
    <div class="analysis-scope-counts"><strong>${available} 份本轮可处理</strong><span>${waiting} 份暂不能处理</span>${included ? `<span>${included} 份已纳入已有轮次</span>` : ''}<small>本页为演示；正式启动前仍由服务端核验。</small></div>
    <div class="analysis-scope-body"><nav class="analysis-scope-categories" aria-label="文件类别"><button data-analysis-scope-category="ALL" aria-pressed="${analysisScopeState.category === 'ALL'}">全部文件 <span>${files.length}</span></button>${categories.map(([key, label]) => `<button data-analysis-scope-category="${key}" aria-pressed="${analysisScopeState.category === key}">${label} <span>${files.filter(file => file.category === key).length}</span></button>`).join('')}</nav>
      <div class="analysis-scope-content"><div class="analysis-scope-toolbar"><label><span class="sr-only">搜索文件</span><input id="analysisScopeSearch" type="search" placeholder="搜索文件名或编号" value="${esc(analysisScopeState.query)}"></label><div role="group" aria-label="筛选文件状态">${[['ALL', '全部'], ['SELECTABLE', '本轮可处理'], ['WAITING', '暂不能处理']].map(([key, label]) => `<button data-analysis-scope-filter="${key}" aria-pressed="${analysisScopeState.filter === key}">${label}</button>`).join('')}</div></div><p class="analysis-scope-list-count" role="status">显示 ${visible.length} / ${files.length} 份文件</p><div class="analysis-scope-list" tabindex="0" aria-label="本轮文件清单">${groups || '<div class="analysis-scope-empty"><strong>没有匹配的文件</strong><p>试试其他名称或切换筛选；已选文件仍会保留。</p></div>'}</div></div>
    </div><footer class="analysis-scope-footer"><div><strong id="analysisScopeSelectedCount">已选 ${analysisScopeState.selected.length} / ${available} 份</strong><span>${executionCurrentRound() ? '新增文件形成后续一轮请求；已有轮次继续。' : '勾选即按当前报告的完整计划处理；有异议的文件先不要选。'}</span></div><button class="primary" data-analysis-scope-action="confirm" ${analysisScopeState.selected.length ? '' : 'disabled'}>${executionCurrentRound() ? '确认新增文件' : '确认并开始'} <span aria-hidden="true">→</span></button></footer>`;
}
function analysisScopeReceiptView() {
  const ids = analysisScopeState.receipt.fileIds;
  const files = ids.map(id => analysisReport.plannedFiles.find(file => file.id === id)).filter(Boolean);
  return `<div class="analysis-scope-head"><div><small>青禾制造 / 体系文件升级</small><h2 id="analysisScopeTitle">本轮选择已记录（演示）</h2><p>以下文件按当前报告对应的完整计划纳入本轮（演示）。</p></div><button class="analysis-scope-close" data-analysis-scope-action="close" aria-label="关闭选择面板">×</button></div><div class="analysis-scope-receipt"><div class="analysis-scope-receipt-count">${files.length}<span>份文件</span></div><ul>${files.map(file => `<li><strong>${esc(file.title)}</strong><span>${file.customerCode ? `${esc(file.customerCode)} · ` : ''}${esc(analysisScopeOrigins[file.origin] || file.origin)}</span></li>`).join('')}</ul><p>本原型只记录本页的选择，没有调用服务端或启动 Runner。正式执行仍需校验计划版本、授权和依赖。</p></div><footer class="analysis-scope-footer"><button data-analysis-scope-action="restart">重新选择（演示）</button><button class="primary" data-analysis-scope-action="close">返回总览</button></footer>`;
}
function analysisScopeRenderDialog(focusTarget) {
  const dialog = analysisScopeDialog();
  const priorScroll = dialog.querySelector('.analysis-scope-list')?.scrollTop || 0;
  const openDetails = new Set([...dialog.querySelectorAll('[data-analysis-scope-file] details[open]')].map(details => details.closest('[data-analysis-scope-file]').dataset.analysisScopeFile));
  const search = dialog.querySelector('#analysisScopeSearch');
  const selection = search && document.activeElement === search ? [search.selectionStart, search.selectionEnd] : null;
  dialog.innerHTML = analysisScopeState.receipt ? analysisScopeReceiptView() : analysisScopeSelectionView();
  const list = dialog.querySelector('.analysis-scope-list');
  if (list) list.scrollTop = priorScroll;
  for (const file of dialog.querySelectorAll('[data-analysis-scope-file]')) if (openDetails.has(file.dataset.analysisScopeFile)) file.querySelector('details').open = true;
  if (focusTarget === 'search') {
    const input = dialog.querySelector('#analysisScopeSearch');
    input?.focus();
    if (selection && input) input.setSelectionRange(...selection);
  } else if (focusTarget?.startsWith('file:')) {
    const id = focusTarget.slice(5);
    [...dialog.querySelectorAll('[data-analysis-scope-select]')].find(input => input.dataset.analysisScopeSelect === id)?.focus();
  } else if (focusTarget) dialog.querySelector(focusTarget)?.focus();
}
function analysisScopeOpen() {
  if (!analysisReport || analysisView.historyMode) return;
  analysisScopeEnsureReport();
  analysisScopeState.receipt = null;
  analysisScopeSave();
  const dialog = analysisScopeDialog();
  analysisScopeRenderDialog();
  if (!dialog.open) dialog.showModal();
  (dialog.querySelector('#analysisScopeSearch') || dialog.querySelector('.analysis-scope-close'))?.focus();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const action = button.dataset.analysisScopeAction;
  if (action === 'open') { analysisScopeOpen(); return; }
  if (action === 'progress') { location.hash = 'execution'; return; }
  if (action === 'execution') {
    analysisScopeEnsureReport();
    const receipt = analysisScopeState.receipt;
    if (receipt?.roundId && executionOpenRound(receipt.roundId)) { location.hash = 'execution'; return; }
    if (receipt && executionDemoStart(receipt.reportKey, receipt.fileIds)) location.hash = 'execution';
    return;
  }
  const dialog = document.getElementById('analysisScopeDialog');
  if (!dialog?.open) return;
  if (action === 'close') { dialog.close(); return; }
  if (action === 'plan-feedback') {
    const file = analysisReport.plannedFiles.find(item => item.id === button.dataset.fileId);
    const change = analysisReport.changes.find(item => item.id === button.dataset.changeId && item.targetPlannedFileIds.includes(file?.id));
    if (!file || !change) return;
    analysisScopeReturnFocus = false;
    dialog.close();
    analysisOpenPlanFeedback(file.id, change.id);
    return;
  }
  if (action === 'confirm') {
    const valid = new Set(analysisReport.plannedFiles.filter(file => analysisScopeStatus(file).selectable).map(file => file.id));
    if (!analysisScopeState.selected.length || analysisScopeState.selected.some(id => !valid.has(id))) return;
    if (!executionDemoStart(analysisScopeState.reportKey, analysisScopeState.selected)) return;
    analysisScopeState.receipt = { reportKey: analysisScopeState.reportKey, fileIds: [...analysisScopeState.selected], roundId: executionCurrentRound().id };
    analysisScopeSave();
    analysisScopeReturnFocus = false;
    dialog.close();
    location.hash = 'execution';
    return;
  }
  if (action === 'restart') { analysisScopeState.selected = []; analysisScopeState.receipt = null; analysisScopeSave(); render(); analysisScopeRenderDialog('#analysisScopeSearch'); return; }
  if (button.dataset.analysisScopeCategory) { analysisScopeState.category = button.dataset.analysisScopeCategory; analysisScopeSave(); analysisScopeRenderDialog(`[data-analysis-scope-category="${analysisScopeState.category}"]`); }
  if (button.dataset.analysisScopeFilter) { analysisScopeState.filter = button.dataset.analysisScopeFilter; analysisScopeSave(); analysisScopeRenderDialog(`[data-analysis-scope-filter="${analysisScopeState.filter}"]`); }
});
document.addEventListener('change', event => {
  const id = event.target.dataset?.analysisScopeSelect;
  if (!id || !document.getElementById('analysisScopeDialog')?.open) return;
  if (!analysisScopeStatus(analysisReport.plannedFiles.find(file => file.id === id)).selectable) return;
  analysisScopeState.selected = event.target.checked ? [...new Set([...analysisScopeState.selected, id])] : analysisScopeState.selected.filter(value => value !== id);
  analysisScopeSave();
  analysisScopeRenderDialog(`file:${id}`);
});
document.addEventListener('input', event => {
  if (event.target.id !== 'analysisScopeSearch' || event.isComposing) return;
  analysisScopeState.query = event.target.value;
  analysisScopeSave();
  analysisScopeRenderDialog('search');
});
document.addEventListener('compositionend', event => {
  if (event.target.id !== 'analysisScopeSearch') return;
  analysisScopeState.query = event.target.value;
  analysisScopeSave();
  analysisScopeRenderDialog('search');
});
Object.assign(window, { analysisScopeEntry, analysisScopeResetDemo });
