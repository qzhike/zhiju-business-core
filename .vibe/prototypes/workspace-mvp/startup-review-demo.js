/* global esc, render, document, sessionStorage, window, location, fetch */
/* exported startupReviewRoute, startupReviewAfterRender */
// Isolated, synthetic startup review. It never creates a Core fact or Runner call.
const startupReviewStorageKey = 'zhiju-startup-review-demo-v1';
const startupReviewInitial = () => ({ version: 1, revision: 1, selected: [], query: '', category: 'ALL', filter: 'ALL', status: 'draft', outcome: 'accepted', missingProduct: false, request: null, receipt: null });
let startupReviewState = startupReviewInitial();
let startupReviewFixture = null;
let startupReviewStorageError = '';
let startupReviewLoadError = '';
let startupReviewShown = false;
let startupReviewTimer = null;
try {
  const stored = sessionStorage.getItem(startupReviewStorageKey);
  if (stored !== null) {
    const parsed = JSON.parse(stored);
    const statuses = ['draft', 'checking', 'received', 'failed', 'unknown', 'stale'];
    if (parsed.version !== 1 || ![1, 2].includes(parsed.revision) || !Array.isArray(parsed.selected) || parsed.selected.some(id => typeof id !== 'string') || !statuses.includes(parsed.status) || !['accepted', 'failed', 'unknown', 'stale'].includes(parsed.outcome) || typeof parsed.query !== 'string' || typeof parsed.category !== 'string' || typeof parsed.filter !== 'string' || typeof parsed.missingProduct !== 'boolean' || (parsed.status !== 'draft' && !parsed.request) || (parsed.status === 'received' && !parsed.receipt)) throw new Error('Invalid demo state');
    startupReviewState = parsed;
  }
} catch {
  startupReviewStorageError = '无法读取本页演示记录。原记录保留，本页暂不提交。';
}
function startupReviewSave() {
  if (startupReviewStorageError) return false;
  try { sessionStorage.setItem(startupReviewStorageKey, JSON.stringify(startupReviewState)); return true; }
  catch { startupReviewStorageError = '无法保存本页演示记录。你的选择保留，请先不要重复提交。'; return false; }
}
function startupReviewFiles() { return startupReviewFixture?.files || []; }
function startupReviewCurrentFixture() { return startupReviewState.revision === 2 ? { ...startupReviewFixture, ...startupReviewFixture.followup } : startupReviewFixture; }
function startupReviewCanConfirm() {
  const valid = new Set(startupReviewFiles().filter(file => file.selectable).map(file => file.id));
  return Boolean(startupReviewFixture && !startupReviewStorageError && !startupReviewState.missingProduct && startupReviewState.status === 'draft' && startupReviewState.selected.length && startupReviewState.selected.every(id => valid.has(id)));
}
function startupReviewDialog() {
  let dialog = document.getElementById('startupReviewDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'startupReviewDialog';
  dialog.className = 'analysis-scope-dialog startup-review-dialog';
  dialog.setAttribute('aria-labelledby', 'startupReviewTitle');
  dialog.addEventListener('close', () => document.querySelector('[data-startup-review="open"]')?.focus());
  document.body.append(dialog);
  return dialog;
}
function startupReviewInformation() {
  return `<section class="startup-review-information" aria-labelledby="startupReviewInformationTitle"><div class="startup-review-info-heading"><div><h3 id="startupReviewInformationTitle">开始前，核对这 3 类信息</h3><p>由 Runner 提议，点击依据可核对客户原文；未确认的组织与职责问题继续保留。</p></div><span>项目仍在资料准备</span></div>
    <div class="startup-review-info-grid">${startupReviewCurrentFixture().information.map(item => {
      const blocked = item.id === 'product' && startupReviewState.missingProduct;
      return `<details class="startup-review-info-item ${blocked ? 'is-missing' : ''}" data-startup-detail="info-${esc(item.id)}"><summary><span class="startup-review-info-label">${esc(item.title)}</span><strong>${blocked ? '缺少产品范围依据，需客户补充' : esc(item.summary)}</strong><span class="startup-review-evidence">${blocked ? '查看缺口' : '查看客户依据'} <span aria-hidden="true">⌄</span></span></summary><div class="startup-review-source"><strong>${esc(item.sourceTitle)} · ${esc(item.locator)}</strong><p>${blocked ? '当前没有可确认的产品范围候选。其他分析结果仍可查看，需补充本项目涉及的产品及销售市场。' : esc(item.excerpt)}</p><a href="startup-review-source.example.md" download>查看匿名资料示例</a></div></details>`;
    }).join('')}</div>${startupReviewState.missingProduct ? '<div class="startup-review-blocker" role="status"><strong>暂不能正式启动项目</strong><p>请先补充产品范围依据；文件选择已保留，补充后需 Runner 重新分析。本页仍可查看计划。</p></div>' : ''}</section>`;
}
function startupReviewVisibleFiles() {
  const query = startupReviewState.query.trim().toLocaleLowerCase('zh-CN');
  return startupReviewFiles().filter(file => (startupReviewState.category === 'ALL' || startupReviewState.category === file.chapter) && (startupReviewState.filter === 'ALL' || (startupReviewState.filter === 'READY') === file.selectable) && `${file.title} ${file.code} ${file.chapter}`.toLocaleLowerCase('zh-CN').includes(query));
}
function startupReviewFile(file) {
  const checked = startupReviewState.selected.includes(file.id);
  const editable = startupReviewState.status === 'draft' && !startupReviewStorageError;
  return `<article class="analysis-scope-file ${file.selectable ? '' : 'is-waiting'}"><div class="analysis-scope-file-main"><label class="analysis-scope-check"><input type="checkbox" data-startup-file="${esc(file.id)}" aria-label="选择${esc(file.title)}" aria-describedby="startupReason-${esc(file.id)}" ${checked ? 'checked' : ''} ${file.selectable && editable ? '' : 'disabled'}></label><div class="analysis-scope-file-copy"><small>${esc(file.code || '拟新建')} · ${esc(file.chapter)}</small><strong>${esc(file.title)}</strong>${file.selectable ? `<p id="startupReason-${esc(file.id)}">${esc(file.reason)}</p>` : ''}</div>${file.selectable ? '<span class="analysis-scope-file-state">本轮可处理</span>' : ''}</div>${file.selectable ? '' : `<div class="analysis-scope-blocker" id="startupReason-${esc(file.id)}"><span class="analysis-scope-blocker-icon" aria-hidden="true">!</span><div><strong>暂不能处理</strong><p>${esc(file.reason)}</p></div></div>`}<details class="analysis-scope-detail" data-startup-detail="file-${esc(file.id)}"><summary>查看本轮计划与依据</summary><p>${esc(file.plan)}</p><p><strong>客户资料：</strong>${esc(file.source)}</p></details></article>`;
}
function startupReviewFeedback() {
  const status = startupReviewState.status;
  if (startupReviewStorageError) return `<div class="startup-review-message is-error" role="alert">${esc(startupReviewStorageError)}</div>`;
  if (status === 'draft') return '';
  const messages = {
    checking: ['正在核验启动信息与文件范围（演示）', '核验期间可以继续查看依据。所选内容已锁定，尚未开始文件升级。'],
    received: ['启动信息与本轮范围已记录（演示）', `本轮 ${startupReviewState.request.fileIds.length} 份文件等待服务器安排。此回执为合成示例，未调用 Core 或 Runner。`],
    failed: ['启动核验失败（演示）', '所选文件和信息保留。确认未提交成功后，可以按原请求重试。'],
    unknown: ['提交结果待核实（演示）', '先回读原请求结果，不重新提交、不改变文件范围。'],
    stale: ['所依据的报告已更新（演示）', '所选文件保留。请重新核对受影响的产品范围及当前报告，再确认本轮范围。']
  };
  const [title, summary] = messages[status];
  return `<div class="startup-review-message ${['failed', 'unknown', 'stale'].includes(status) ? 'is-error' : ''}" role="status"><strong>${title}</strong><p>${esc(summary)}</p></div>`;
}
function startupReviewBody() {
  const visible = startupReviewVisibleFiles();
  const ready = startupReviewFiles().filter(file => file.selectable).length;
  const categories = [...new Set(startupReviewFiles().map(file => file.chapter))].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
  const waiting = startupReviewFiles().length - ready;
  const footerHint = startupReviewState.missingProduct ? '启动信息有缺口，先补资料。' : ({ draft: '点击确认，同时核对以上信息及本轮文件范围。', checking: '范围已锁定，等待核验结果。', received: '本轮范围已记录，等待服务器安排。', failed: '重试沿用原请求与文件范围。', unknown: '先核实原请求，不重新提交。', stale: '选择已保留，请先重新核对当前信息。' })[startupReviewState.status];
  const action = startupReviewState.status === 'unknown' ? '<button class="primary" data-startup-review="reconcile">核实原提交结果</button>' : startupReviewState.status === 'failed' ? '<button class="primary" data-startup-review="retry">按原请求重试</button>' : startupReviewState.status === 'stale' ? '<button class="primary" data-startup-review="recheck">重新核对当前信息</button>' : startupReviewState.status === 'received' ? '<button class="primary" data-startup-review="close">完成查看</button>' : `<button class="primary" data-startup-review="confirm" ${startupReviewCanConfirm() ? '' : 'disabled'}>${startupReviewState.status === 'checking' ? '正在核验' : '确认信息与范围并开始'} <span aria-hidden="true">→</span></button>`;
  return `<div class="analysis-scope-head"><div><small>${esc(startupReviewFixture.projectLabel)} · 固定匿名启动示例</small><h2 id="startupReviewTitle">核对信息，选择本轮文件</h2><p>沿用同一个项目；本次同时确认必要信息与所选文件的完整处理计划。</p></div><button class="analysis-scope-close" data-startup-review="close" aria-label="关闭启动核对面板">×</button></div>
    <div class="analysis-scope-counts"><strong>${ready} 份本轮可处理</strong><span>${waiting} 份暂不能处理</span><small>报告第 ${startupReviewState.revision} 版 · 启动信息为新增匿名示例。</small></div>
    <div class="startup-review-workspace">${startupReviewInformation()}<div class="analysis-scope-body"><nav class="analysis-scope-categories" aria-label="文件章节"><button data-startup-category="ALL" aria-pressed="${startupReviewState.category === 'ALL'}">全部文件 <span>${startupReviewFiles().length}</span></button>${categories.map(category => `<button data-startup-category="${esc(category)}" aria-pressed="${startupReviewState.category === category}">${esc(category)} <span>${startupReviewFiles().filter(file => file.chapter === category).length}</span></button>`).join('')}</nav><div class="analysis-scope-content"><div class="analysis-scope-toolbar"><label><span class="sr-only">查找文件</span><input id="startupReviewSearch" type="search" placeholder="查找文件、编号或章节" value="${esc(startupReviewState.query)}"></label><div aria-label="按处理条件筛选">${[['ALL', '全部'], ['READY', '本轮可处理'], ['WAITING', '暂不能处理']].map(([key, label]) => `<button data-startup-filter="${key}" aria-pressed="${startupReviewState.filter === key}">${label}</button>`).join('')}</div></div><p class="analysis-scope-list-count">显示 ${visible.length} / ${startupReviewFiles().length} 份 · 未勾选的文件本轮不处理</p><div class="analysis-scope-list" tabindex="0" aria-label="本轮文件计划">${visible.length ? visible.map(startupReviewFile).join('') : '<div class="analysis-scope-empty">没有符合条件的文件</div>'}</div></div></div>${startupReviewFeedback()}</div>
    <footer class="analysis-scope-footer startup-review-footer"><div><strong>已选 ${startupReviewState.selected.length} / ${ready} 份</strong><span>${esc(footerHint)}</span><button data-startup-review="supplement">信息有误或缺依据，返回总览补充 →</button></div>${action}</footer>
    <details class="startup-review-options" data-startup-detail="options"><summary>演示选项</summary><div><label>必要产品依据<input type="checkbox" id="startupReviewMissing" ${startupReviewState.missingProduct ? 'checked' : ''} ${startupReviewState.status === 'draft' ? '' : 'disabled'}>模拟缺失</label><label>提交返回<select id="startupReviewOutcome" ${startupReviewState.status === 'draft' ? '' : 'disabled'}>${[['accepted', '记录本轮范围'], ['failed', '核验失败'], ['unknown', '结果待核实'], ['stale', '报告已更新']].map(([key, label]) => `<option value="${key}" ${startupReviewState.outcome === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button data-startup-review="reset">重新演示本面板</button></div></details>`;
}
function startupReviewRender(focus) {
  const dialog = startupReviewDialog();
  if (!startupReviewFixture) return;
  const scroll = dialog.querySelector('.analysis-scope-list')?.scrollTop || 0;
  const workspaceScroll = dialog.querySelector('.startup-review-workspace')?.scrollTop || 0;
  const openItems = [...dialog.querySelectorAll('details[open]')].map(detail => detail.dataset.startupDetail);
  const search = dialog.querySelector('#startupReviewSearch');
  const selection = search && document.activeElement === search ? [search.selectionStart, search.selectionEnd] : null;
  dialog.innerHTML = startupReviewBody();
  for (const detail of dialog.querySelectorAll('details')) if (openItems.includes(detail.dataset.startupDetail)) detail.open = true;
  dialog.querySelector('.analysis-scope-list').scrollTop = scroll;
  dialog.querySelector('.startup-review-workspace').scrollTop = workspaceScroll;
  const target = focus ? dialog.querySelector(focus) : null;
  target?.focus();
  if (focus === '#startupReviewSearch' && selection) target?.setSelectionRange(...selection);
}
function startupReviewOpen() {
  if (!startupReviewFixture) return;
  const dialog = startupReviewDialog();
  startupReviewRender();
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.startup-review-info-item summary')?.focus();
}
function startupReviewFinish(requestId) {
  if (startupReviewState.status !== 'checking' || startupReviewState.request?.id !== requestId) return;
  const before = { ...startupReviewState };
  const outcome = startupReviewState.request.outcome;
  startupReviewState.status = outcome === 'accepted' ? 'received' : outcome;
  if (outcome === 'stale') startupReviewState.revision = 2;
  startupReviewState.receipt = outcome === 'accepted' ? { id: `${requestId}-receipt`, requestId, reportKey: startupReviewState.request.reportKey, fileIds: [...startupReviewState.request.fileIds], informationRefs: [...startupReviewState.request.informationRefs], classification: 'SYNTHETIC_DEMO_ONLY' } : null;
  if (!startupReviewSave()) startupReviewState = before;
  if (document.getElementById('startupReviewDialog')?.open) startupReviewRender('[data-startup-review="close"]');
}
function startupReviewSchedule() {
  if (startupReviewStorageError || startupReviewTimer || startupReviewState.status !== 'checking') return;
  const id = startupReviewState.request.id;
  startupReviewTimer = window.setTimeout(() => { startupReviewTimer = null; startupReviewFinish(id); }, 1200);
}
function startupReviewConfirm() {
  if (!startupReviewCanConfirm()) return;
  const before = { ...startupReviewState };
  const fixture = startupReviewCurrentFixture();
  startupReviewState.request = { id: `DEMO-START-${fixture.reportKey}`, reportKey: fixture.reportKey, fileIds: [...startupReviewState.selected], informationRefs: fixture.information.map(item => item.candidateRef), outcome: startupReviewState.outcome, classification: 'SYNTHETIC_DEMO_ONLY' };
  startupReviewState.status = 'checking';
  if (!startupReviewSave()) startupReviewState = before;
  startupReviewRender('[data-startup-review="close"]');
  startupReviewSchedule();
}
function startupReviewRoute() {
  if (location.hash !== '#startup-review') { startupReviewShown = false; return null; }
  return `<div class="wrap startup-review-background"><a href="#board">← 返回我的工作台</a><div><small>项目资料准备 · 固定匿名演示</small><h1>首轮分析报告已返回</h1><p>先核对必要启动信息，再选择本轮文件。资料和后续文件始终归属于同一个项目。</p><button class="primary" data-startup-review="open" ${startupReviewFixture ? '' : 'disabled'}>核对信息并选择文件 →</button><p role="status">${esc(startupReviewLoadError || (startupReviewFixture ? '当前示例：2 份程序可先处理，手册和岗位职责继续等待。' : '正在读取匿名演示内容…'))}</p></div></div>`;
}
function startupReviewAfterRender() {
  if (location.hash !== '#startup-review') { document.getElementById('startupReviewDialog')?.close(); return; }
  if (!startupReviewFixture || startupReviewShown) return;
  startupReviewShown = true;
  startupReviewOpen();
  startupReviewSchedule();
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  const action = button?.dataset.startupReview;
  if (!action && !button?.dataset.startupCategory && !button?.dataset.startupFilter) return;
  if (action === 'open') { startupReviewOpen(); return; }
  if (!document.getElementById('startupReviewDialog')?.open) return;
  if (action === 'close') { document.getElementById('startupReviewDialog').close(); return; }
  if (action === 'confirm') { startupReviewConfirm(); return; }
  if (action === 'supplement') { document.getElementById('startupReviewDialog').close(); location.hash = 'analysis'; return; }
  if (action === 'reset' && !startupReviewStorageError) { if (startupReviewTimer) window.clearTimeout(startupReviewTimer); startupReviewTimer = null; startupReviewState = startupReviewInitial(); startupReviewSave(); startupReviewRender('[data-startup-review="close"]'); return; }
  if (action === 'reconcile' && startupReviewState.status === 'unknown' && !startupReviewStorageError) {
    const before = { ...startupReviewState };
    startupReviewState.status = 'received';
    startupReviewState.receipt = { id: `${startupReviewState.request.id}-receipt`, requestId: startupReviewState.request.id, reportKey: startupReviewState.request.reportKey, fileIds: [...startupReviewState.request.fileIds], informationRefs: [...startupReviewState.request.informationRefs], classification: 'SYNTHETIC_DEMO_ONLY' };
    if (!startupReviewSave()) startupReviewState = before;
    startupReviewRender('[data-startup-review="close"]'); return;
  }
  if (action === 'retry' && startupReviewState.status === 'failed' && !startupReviewStorageError) { const before = { ...startupReviewState }; startupReviewState.request = { ...startupReviewState.request, outcome: 'accepted' }; startupReviewState.status = 'checking'; if (startupReviewSave()) startupReviewSchedule(); else startupReviewState = before; startupReviewRender('[data-startup-review="close"]'); return; }
  if (action === 'recheck' && startupReviewState.status === 'stale' && !startupReviewStorageError) { const before = { ...startupReviewState }; startupReviewState.status = 'draft'; startupReviewState.request = null; startupReviewState.receipt = null; startupReviewState.outcome = 'accepted'; if (!startupReviewSave()) startupReviewState = before; startupReviewRender('.startup-review-info-item summary'); return; }
  const category = button?.dataset.startupCategory;
  const filter = button?.dataset.startupFilter;
  if (category) startupReviewState.category = category;
  if (filter) startupReviewState.filter = filter;
  if (category || filter) { startupReviewSave(); startupReviewRender(category ? `[data-startup-category="${category}"]` : `[data-startup-filter="${filter}"]`); }
});
document.addEventListener('change', event => {
  if (!document.getElementById('startupReviewDialog')?.open) return;
  const id = event.target.dataset.startupFile;
  if (id && startupReviewState.status === 'draft' && !startupReviewStorageError && startupReviewFiles().some(file => file.id === id && file.selectable)) { startupReviewState.selected = event.target.checked ? [...new Set([...startupReviewState.selected, id])] : startupReviewState.selected.filter(value => value !== id); startupReviewSave(); startupReviewRender(`[data-startup-file="${id}"]`); }
  if (event.target.id === 'startupReviewMissing' && startupReviewState.status === 'draft') { startupReviewState.missingProduct = event.target.checked; startupReviewSave(); startupReviewRender('#startupReviewMissing'); }
  if (event.target.id === 'startupReviewOutcome' && startupReviewState.status === 'draft' && ['accepted', 'failed', 'unknown', 'stale'].includes(event.target.value)) { startupReviewState.outcome = event.target.value; startupReviewSave(); startupReviewRender('#startupReviewOutcome'); }
});
function startupReviewSearch(event) {
  if (event.target.id !== 'startupReviewSearch' || event.isComposing) return;
  startupReviewState.query = event.target.value; startupReviewSave(); startupReviewRender('#startupReviewSearch');
}
document.addEventListener('input', startupReviewSearch);
document.addEventListener('compositionend', startupReviewSearch);
Object.assign(window, { startupReviewRoute, startupReviewAfterRender });
fetch('startup-review.example.json').then(response => {
  if (!response.ok) throw new Error('Unavailable fixture');
  return response.json();
}).then(fixture => {
  if (fixture.classification !== 'SYNTHETIC_DEMO_ONLY' || !Array.isArray(fixture.information) || fixture.information.length !== 3 || !Array.isArray(fixture.files) || !fixture.followup || fixture.followup.information.length !== 3) throw new Error('Invalid fixture');
  startupReviewFixture = fixture;
  const valid = new Set(fixture.files.filter(file => file.selectable).map(file => file.id));
  const request = startupReviewState.request;
  const requestFixture = request?.reportKey === fixture.reportKey ? fixture : request?.reportKey === fixture.followup.reportKey ? fixture.followup : null;
  const receipt = startupReviewState.receipt;
  if (startupReviewState.selected.some(id => !valid.has(id)) || (request && (!requestFixture || request.id !== `DEMO-START-${request.reportKey}` || !['accepted', 'failed', 'unknown', 'stale'].includes(request.outcome) || request.classification !== 'SYNTHETIC_DEMO_ONLY' || !Array.isArray(request.fileIds) || !request.fileIds.length || request.fileIds.some(id => !valid.has(id)) || new Set(request.fileIds).size !== request.fileIds.length || JSON.stringify(request.fileIds) !== JSON.stringify(startupReviewState.selected) || !Array.isArray(request.informationRefs) || JSON.stringify(request.informationRefs) !== JSON.stringify(requestFixture.information.map(item => item.candidateRef)))) || (receipt && (!request || receipt.classification !== 'SYNTHETIC_DEMO_ONLY' || receipt.requestId !== request.id || receipt.reportKey !== request.reportKey || JSON.stringify(receipt.fileIds) !== JSON.stringify(request.fileIds) || JSON.stringify(receipt.informationRefs) !== JSON.stringify(request.informationRefs)))) startupReviewStorageError = '演示记录与当前输入不一致。原记录保留，本页暂不提交。';
  if (location.hash === '#startup-review') render();
}).catch(() => { startupReviewLoadError = '匿名演示内容暂时不可用，请刷新重试。'; if (location.hash === '#startup-review') render(); });
