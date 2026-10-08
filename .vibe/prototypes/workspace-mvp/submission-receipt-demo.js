/* global esc, document, window, location, sessionStorage, setTimeout, clearTimeout */
// Synthetic receipt queries only. No execution command or customer file is sent.
const receiptDemoKey = 'zhiju-submission-receipt-demo-v1';
const receiptDemoContext = { projectId: 'DEMO-QINGHE', fileId: 'DEMO-QP23', baseRevision: 4 };
const receiptDemoAttachment = { name: 'QP23-第4版-演示改稿.md', markdown: '# 预防措施程序\n\n保留企业现有岗位安排，补充原有记录的引用位置。\n' };
let receiptDemoState = { draft: '', attachment: null, request: null, history: [], response: 'unknown' };
let receiptDemoStorageError = '', receiptDemoTimer = null, receiptDemoQuerying = false;
function receiptDemoValid(state) {
  const validAttachment = value => value === null || (value?.name === receiptDemoAttachment.name && value.markdown === receiptDemoAttachment.markdown && (value.id === undefined || typeof value.id === 'string'));
  const validRequest = request => request === null || (
    typeof request?.id === 'string' && request.id.startsWith('receipt-demo-') &&
    Object.entries(receiptDemoContext).every(([key, value]) => request.context?.[key] === value) &&
    typeof request.original?.draft === 'string' && validAttachment(request.original.attachment) &&
    ['unknown', 'queued', 'running'].includes(request.status) &&
    Number.isFinite(request.submittedAt) && Number.isInteger(request.autoQueries) && request.autoQueries >= 0 && request.autoQueries <= 2 &&
    Number.isInteger(request.queries) && request.queries >= request.autoQueries
  );
  return typeof state?.draft === 'string' && validAttachment(state.attachment) && validRequest(state.request) &&
    Array.isArray(state.history) && state.history.every(validRequest) && ['unknown', 'queued', 'running'].includes(state.response);
}
try {
  const stored = sessionStorage.getItem(receiptDemoKey);
  if (stored) {
    const value = JSON.parse(stored);
    if (!receiptDemoValid(value)) throw new Error('Invalid fixture state');
    receiptDemoState = value;
  }
} catch {
  receiptDemoStorageError = '未能恢复本次演示记录。为避免重复提交，提交入口已停用；现有记录不会被覆盖。';
}
function receiptDemoPersist() {
  if (receiptDemoStorageError) return false;
  try { sessionStorage.setItem(receiptDemoKey, JSON.stringify(receiptDemoState)); return true; }
  catch { receiptDemoStorageError = '演示记录保存失败。当前意见仍在本页，提交入口已停用，请保留此页。'; return false; }
}
function receiptDemoDraft(value) {
  if (value !== undefined) { receiptDemoState.draft = value; receiptDemoPersist(); receiptDemoRefresh(); }
  return receiptDemoState.draft;
}
function receiptDemoAutoActive(request = receiptDemoState.request) {
  return request?.status === 'unknown' && request.autoQueries < 2 && Date.now() < request.submittedAt + 6500;
}
function receiptDemoStatus() {
  const request = receiptDemoState.request;
  if (receiptDemoStorageError) return `<strong>演示记录需要保留</strong><p>${esc(receiptDemoStorageError)}</p>`;
  if (!request) return '<strong>体验提交后断网</strong><p>写下意见或附上演示改稿，点击一次“提交并修改”。本例会模拟未收到提交回执。</p>';
  if (request.status === 'queued') return '<strong>修改请求已接收</strong><p>等待服务器安排，尚未开始修改。刚才的意见与附件已记录；新写的内容仅是下轮草稿。</p>';
  if (request.status === 'running') return '<strong>服务器确认正在修改</strong><p>本次请求已开始处理。你可以继续写下轮草稿，新内容不会并入这次修改。</p>';
  const active = receiptDemoAutoActive(request);
  return `<strong>提交结果待核验</strong><p>未收到回执，还不能确定服务器是否接收。意见与附件已保留。</p><p class="receipt-query-note">${receiptDemoQuerying ? '正在查询原提交，不会再次发起修改…' : active ? `正在短时自动核验 · 已查询 ${request.autoQueries} / 2 次` : '自动核验已结束，暂未取得确认。可以稍后重新查询。'}</p>${!active ? `<button data-receipt-action="query" ${receiptDemoQuerying ? 'disabled' : ''}>${receiptDemoQuerying ? '查询中…' : '重新查询'}</button>` : ''}`;
}
function receiptDemoOriginal() {
  const request = receiptDemoState.request;
  if (!request) return '';
  return `<details class="receipt-original"><summary>查看本次提交的意见与附件</summary><p>预防措施程序 · 基准第 ${request.context.baseRevision} 版（合成）</p><pre>${esc(request.original.draft || '未填写文字意见')}</pre>${request.original.attachment ? `<p>附件：${esc(request.original.attachment.name)}</p><pre>${esc(request.original.attachment.markdown)}</pre>` : '<p>未附改稿</p>'}<small>此处保留提交时的内容；下面的新草稿不会改写它。</small></details>`;
}
function receiptDemoFeedback() {
  return `<div class="receipt-status" id="receiptDemoStatus" role="status" aria-live="polite" aria-atomic="true">${receiptDemoStatus()}</div><div id="receiptDemoOriginal">${receiptDemoOriginal()}</div><label for="multiChangeFeedback" id="receiptDraftLabel">${receiptDemoState.request ? '下轮意见草稿' : '意见与处理'}</label><p>预防措施程序 · 基准第 4 版（合成）</p><textarea id="multiChangeFeedback" placeholder="写下修改要求，也可以引用文档中的位置…">${esc(receiptDemoState.draft)}</textarea><small id="multiChangeDraftState">演示草稿仅在当前浏览器标签页保留</small><div id="receiptDemoAttachment" class="receipt-attachment"></div><button data-receipt-action="attach">附上演示改稿</button><button class="primary" id="receiptDemoSubmit" data-receipt-action="submit">提交并修改</button><p class="receipt-submit-note" id="receiptDemoSubmitNote"></p><button disabled>检查完成并批准</button><details class="execution-demo-tools receipt-controls"><summary>演示控制与边界</summary><div><label for="receiptDemoResponse">原请求的查询结果（合成）</label><select id="receiptDemoResponse"><option value="unknown" ${receiptDemoState.response === 'unknown' ? 'selected' : ''}>暂时仍查不到回执</option><option value="queued" ${receiptDemoState.response === 'queued' ? 'selected' : ''}>已接收，等待安排</option><option value="running" ${receiptDemoState.response === 'running' ? 'selected' : ''}>已开始修改</option></select><p>选择结果只设置后续核验的演示回执，不会提交、执行或自动更新文档。自动核验最多两次，约 6.5 秒内结束；时长为演示设定。</p><p id="receiptDemoCounters"></p><button data-receipt-action="replay" id="receiptDemoReplay">重新体验提交</button><p>本例不接收真实附件，不连接业务服务或 Runner。服务器个人草稿和真实回执查询尚未接入。</p></div></details>`;
}
function receiptDemoRefresh() {
  if (location.hash !== '#submission-preview') return;
  const status = document.getElementById('receiptDemoStatus');
  if (!status) return;
  const request = receiptDemoState.request;
  status.className = `receipt-status ${request?.status === 'unknown' ? 'is-unknown' : request ? 'is-confirmed' : ''}`;
  // Patch only feedback status; keep document scroll, focus and draft selection.
  const statusHtml = receiptDemoStatus();
  if (status.innerHTML !== statusHtml) status.innerHTML = statusHtml;
  const original = document.getElementById('receiptDemoOriginal');
  if (original.dataset.request !== (request?.id ?? '')) {
    original.innerHTML = receiptDemoOriginal(); original.dataset.request = request?.id ?? '';
  }
  document.getElementById('receiptDraftLabel').textContent = request ? '下轮意见草稿' : '意见与处理';
  document.getElementById('multiChangeDraftState').textContent = receiptDemoStorageError ? '当前意见仍在本页，未能保存演示草稿' : '演示草稿仅在当前浏览器标签页保留';
  const attachment = document.getElementById('receiptDemoAttachment');
  attachment.innerHTML = receiptDemoState.attachment ? `<strong>${esc(receiptDemoState.attachment.name)}</strong><small>演示改稿 · 基于第 4 版</small><button data-receipt-action="remove">移除草稿附件</button>` : '';
  document.getElementById('receiptDemoSubmit').disabled = Boolean(request || receiptDemoStorageError || (!receiptDemoState.draft.trim() && !receiptDemoState.attachment));
  document.getElementById('receiptDemoSubmitNote').textContent = request?.status === 'unknown' ? '核验期间不能重复提交；仍可写下轮草稿。' : request ? '等待本次处理返回，再核对新版本与下轮草稿。' : '本例仅模拟提交回执，不执行文件修改或批准。';
  document.getElementById('receiptDemoCounters').textContent = request ? `本次模拟提交 1 次 · 查询 ${request.queries} 次 · 编号 ${request.id}` : '尚未模拟提交';
  document.getElementById('receiptDemoReplay').disabled = !request || request.status === 'unknown' || receiptDemoQuerying || Boolean(receiptDemoStorageError);
  const pane = document.querySelector('[data-multi-change-pane="feedback"]');
  pane.textContent = request?.status === 'unknown' ? '意见与处理 · 待核验' : '意见与处理';
  receiptDemoSchedule();
}
function receiptDemoSchedule() {
  if (receiptDemoTimer !== null || receiptDemoQuerying || receiptDemoStorageError || !receiptDemoAutoActive()) return;
  const request = receiptDemoState.request;
  const due = request.submittedAt + [2000, 5000][request.autoQueries];
  receiptDemoTimer = setTimeout(() => {
    receiptDemoTimer = null;
    if (receiptDemoAutoActive()) receiptDemoQuery('auto');
    else receiptDemoRefresh();
  }, Math.max(0, due - Date.now()));
}
function receiptDemoSubmit() {
  if (receiptDemoState.request || receiptDemoStorageError || (!receiptDemoState.draft.trim() && !receiptDemoState.attachment)) return;
  const submittedAt = Date.now();
  const request = {
    id: `receipt-demo-${submittedAt}-${Math.random().toString(36).slice(2, 8)}`,
    context: { ...receiptDemoContext }, original: { draft: receiptDemoState.draft, attachment: receiptDemoState.attachment && { ...receiptDemoState.attachment } },
    submittedAt, status: 'unknown', autoQueries: 0, queries: 0
  };
  receiptDemoState.request = request;
  if (!receiptDemoPersist()) { receiptDemoState.request = null; receiptDemoRefresh(); return; }
  receiptDemoRefresh();
}
function receiptDemoApplyResponse(id, response) {
  const request = receiptDemoState.request;
  if (!request || request.id !== id || request.status !== 'unknown') return;
  const matches = response.id === id && Object.entries(request.context).every(([key, value]) => response.context?.[key] === value);
  if (!matches || !['queued', 'running'].includes(response.status)) return;
  const priorDraft = receiptDemoState.draft, priorAttachment = receiptDemoState.attachment;
  request.status = response.status;
  // Only retire the unchanged submitted input. Later draft edits remain intact.
  if (receiptDemoState.draft === request.original.draft) receiptDemoState.draft = '';
  if (receiptDemoState.attachment?.id === request.original.attachment?.id && receiptDemoState.attachment?.name === request.original.attachment?.name && receiptDemoState.attachment?.markdown === request.original.attachment?.markdown) receiptDemoState.attachment = null;
  if (!receiptDemoPersist()) { request.status = 'unknown'; receiptDemoState.draft = priorDraft; receiptDemoState.attachment = priorAttachment; return; }
  const textarea = document.getElementById('multiChangeFeedback');
  if (location.hash === '#submission-preview' && textarea && textarea.value !== receiptDemoState.draft) textarea.value = receiptDemoState.draft;
}
function receiptDemoQuery(mode) {
  const request = receiptDemoState.request;
  if (!request || request.status !== 'unknown' || receiptDemoQuerying || receiptDemoStorageError) return;
  if (mode === 'auto' && !receiptDemoAutoActive(request)) return;
  if (mode === 'manual' && receiptDemoAutoActive(request)) return;
  request.queries++; if (mode === 'auto') request.autoQueries++;
  if (!receiptDemoPersist()) { request.queries--; if (mode === 'auto') request.autoQueries--; receiptDemoRefresh(); return; }
  const id = request.id, response = { id, context: { ...request.context }, status: receiptDemoState.response };
  receiptDemoQuerying = true; receiptDemoRefresh();
  setTimeout(() => {
    receiptDemoApplyResponse(id, response);
    receiptDemoQuerying = false; receiptDemoRefresh(); receiptDemoSchedule();
  }, 400);
}
function receiptDemoReplay() {
  const request = receiptDemoState.request;
  if (!request || request.status === 'unknown' || receiptDemoQuerying || receiptDemoStorageError) return;
  const previous = JSON.parse(JSON.stringify(receiptDemoState));
  receiptDemoState.history.push(request); receiptDemoState.request = null;
  if (!receiptDemoState.draft) receiptDemoState.draft = request.original.draft;
  if (!receiptDemoState.attachment) receiptDemoState.attachment = request.original.attachment;
  if (!receiptDemoPersist()) { receiptDemoState = previous; receiptDemoRefresh(); return; }
  if (receiptDemoTimer !== null) clearTimeout(receiptDemoTimer);
  receiptDemoTimer = null;
  document.getElementById('multiChangeFeedback').value = receiptDemoState.draft;
  receiptDemoRefresh();
}
document.addEventListener('click', event => {
  if (location.hash !== '#submission-preview') return;
  const button = event.target.closest('[data-receipt-action]');
  if (!button || button.disabled) return;
  if (button.dataset.receiptAction === 'submit') receiptDemoSubmit();
  if (button.dataset.receiptAction === 'query') receiptDemoQuery('manual');
  if (button.dataset.receiptAction === 'replay') receiptDemoReplay();
  if (['attach', 'remove'].includes(button.dataset.receiptAction)) {
    const previous = receiptDemoState.attachment;
    receiptDemoState.attachment = button.dataset.receiptAction === 'attach' ? { ...receiptDemoAttachment, id: `receipt-attachment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` } : null;
    if (!receiptDemoPersist()) receiptDemoState.attachment = previous;
    receiptDemoRefresh();
  }
});
document.addEventListener('change', event => {
  if (location.hash !== '#submission-preview' || event.target.id !== 'receiptDemoResponse') return;
  receiptDemoState.response = event.target.value; receiptDemoPersist();
});
Object.assign(window, { receiptDemoDraft, receiptDemoFeedback, receiptDemoRefresh });
receiptDemoSchedule();
