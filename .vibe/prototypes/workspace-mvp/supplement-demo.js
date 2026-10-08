/* global esc, render */
/* global document, location, sessionStorage, clearTimeout, setTimeout, crypto, window */
// Fixed answer fixtures only. This page does not interpret arbitrary input or run an agent.
const supplementKey = 'zhiju-supplement-demo-v1';
const supplementQuestions = [
  { id: 'eq01', title: '设备 EQ-01 使用哪份校准记录？', source: '演示资料标识为 DEMO-CAL-01，请确认是否用于本次整理。', answer: '已核对：设备 EQ-01 使用演示资料 DEMO-CAL-01。' },
  { id: 'eq02', title: '设备 EQ-02 使用哪份校准记录？', source: '演示资料标识为 DEMO-CAL-02，请确认是否用于本次整理。', answer: '已核对：设备 EQ-02 使用演示资料 DEMO-CAL-02。' }
];
const supplementInitial = () => ({ draft: '', attachments: [], resolved: [], status: 'needs-input', submissions: [], pendingId: null, pane: 'questions', notice: '' });
let supplementState;
try { supplementState = JSON.parse(sessionStorage.getItem(supplementKey)); } catch { /* Start with the fixed scenario. */ }
if (!supplementState || !Array.isArray(supplementState.submissions)) supplementState = supplementInitial();
let supplementTimer;
function supplementSave() { sessionStorage.setItem(supplementKey, JSON.stringify(supplementState)); }
function supplementRemaining() { return supplementQuestions.filter(question => !supplementState.resolved.includes(question.id)); }
function supplementResetDemo() { clearTimeout(supplementTimer); supplementTimer = null; supplementState = supplementInitial(); supplementSave(); }
function supplementCanSubmit() { return supplementState.status === 'needs-input' && Boolean(supplementState.draft.trim() || supplementState.attachments.length); }
function supplementSchedule() {
  if (supplementState.status !== 'checking' || supplementTimer) return;
  const pending = supplementState.pendingId;
  supplementTimer = setTimeout(() => {
    supplementTimer = null;
    if (supplementState.status !== 'checking' || supplementState.pendingId !== pending) return;
    const submission = supplementState.submissions.find(item => item.id === pending);
    if (!submission) return;
    const lines = submission.text.split('\n').map(line => line.trim()).filter(Boolean);
    const supported = lines.length > 0 && !submission.attachments.length && lines.every(line => supplementQuestions.some(question => question.answer === line));
    const applied = [];
    if (supported) for (const question of supplementQuestions) {
      if (lines.includes(question.answer) && !supplementState.resolved.includes(question.id)) {
        supplementState.resolved.push(question.id);
        applied.push(question.id);
      }
    }
    const remaining = supplementRemaining();
    submission.result = !supported ? 'unhandled' : remaining.length ? 'partial' : 'accepted';
    submission.applied = applied;
    submission.remaining = remaining.map(question => question.id);
    supplementState.status = remaining.length ? 'needs-input' : 'queued';
    supplementState.pendingId = null;
    supplementSave();
    if (['#supplement', '#board', ''].includes(location.hash)) {
      const input = document.getElementById('supplementInput');
      const focus = input && document.activeElement === input;
      const selection = focus ? [input.selectionStart, input.selectionEnd] : null;
      render();
      if (focus) { const next = document.getElementById('supplementInput'); next?.focus({ preventScroll: true }); next?.setSelectionRange(...selection); }
    }
  }, 700);
}
function supplementBoardTask() {
  supplementSchedule();
  const count = supplementRemaining().length;
  const status = supplementState.status;
  return { id: 'equipment', project: '远山科技', title: '补充设备校准资料',
    desc: status === 'queued' ? '补充已核验，已请求继续原范围内的处理。' : status === 'checking' ? '补充内容已提交，等待核验结果。' : `${count} 台设备的资料仍待确认。`,
    group: status === 'needs-input' ? 'attention' : status === 'checking' ? 'running' : 'waiting',
    badge: status === 'queued' ? '等待继续执行（演示）' : status === 'checking' ? '正在核验（演示）' : `待补充 ${count} 项` };
}
function supplementResultText(submission) {
  if (!submission.result) return '已接收 · 正在核验（演示）';
  if (submission.result === 'unhandled') return '补充内容已保留，但本原型未解析；缺口保持不变。';
  if (submission.result === 'partial') return `本次补齐 ${submission.applied.length} 项，仍有 ${submission.remaining.length} 项需要补充。`;
  return '补充核验通过，已请求继续原范围内的工作，等待执行。';
}
function supplementStatus() {
  const latest = supplementState.submissions.at(-1);
  if (supplementState.status === 'checking') return '<div class="supplement-message" role="status"><strong>正在核验补充内容</strong><p>提交已接收，尚未解除阻塞。核验完成后自动更新。</p></div>';
  if (supplementState.status === 'queued') return '<div class="supplement-message success" role="status"><strong>已请求继续 · 等待执行</strong><p>两项补充已通过模拟核验，无需再点启动。后续工作尚未开始。</p></div>';
  if (!latest) return '';
  return `<div class="supplement-message ${latest.result === 'partial' ? '' : 'supplement-unhandled'}" role="status"><strong>${latest.result === 'partial' ? `还有 ${supplementRemaining().length} 项需要你` : '尚未补齐所需信息'}</strong><p>${esc(supplementResultText(latest))}</p>${latest.result === 'unhandled' ? '<p>仅支持页面提供的固定文字示例；附件只保留文件名，不会被自动理解。</p>' : ''}</div>`;
}
function supplementPage() {
  supplementSchedule();
  const remaining = supplementRemaining();
  const busy = supplementState.status !== 'needs-input';
  const latest = supplementState.submissions.at(-1);
  return `<div class="intake-shell supplement-shell"><a href="#board" class="intake-back">← 工作台</a><div class="intake-heading"><div><div class="eyebrow">远山科技 / 已确认的工作范围</div><h1>补充设备校准资料</h1><p>补齐本次整理需要的信息，核验通过后继续推进。</p></div><span class="tag ${remaining.length ? 'amber' : 'green'}">${supplementState.status === 'checking' ? '正在核验' : remaining.length ? `待补充 ${remaining.length} 项` : '等待继续执行'}</span></div><div class="supplement-overview"><span><b>2</b> 项确认事项</span><span><b>${supplementState.resolved.length}</b> 项已核对</span><span>本轮只涉及设备资料整理</span></div><div class="supplement-panes"><button data-supplement="pane" data-pane="questions" aria-pressed="${supplementState.pane === 'questions'}">待补充事项 · ${remaining.length}</button><button data-supplement="pane" data-pane="feedback" aria-pressed="${supplementState.pane === 'feedback'}">补充与处理</button></div><div class="supplement-layout ${supplementState.pane === 'feedback' ? 'supplement-feedback-visible' : ''}"><section class="supplement-questions" tabindex="0" aria-label="待补充事项与资料依据"><h2>需要确认什么</h2><p class="small muted">使用同一个补充框回答即可，不必逐项填写表单。</p>${supplementQuestions.map((question, i) => { const resolved = supplementState.resolved.includes(question.id); return `<article class="supplement-question ${resolved ? 'resolved' : ''}"><div><span class="supplement-number">${resolved ? '✓' : i + 1}</span><h3>${question.title}</h3></div><p>${question.source}</p><span class="tag ${resolved ? 'green' : 'amber'}">${resolved ? '已核对（演示）' : '需要确认'}</span></article>`; }).join('')}<details class="supplement-source"><summary>查看已有资料摘录</summary><p><strong>设备资料摘录.md · 合成演示</strong></p><p>设备 EQ-01 → DEMO-CAL-01<br>设备 EQ-02 → DEMO-CAL-02</p><p class="small muted">仅演示如何确认资料对应关系，不证明设备实际校准、有效性或客户批准。</p></details><p class="intake-note">补充只用于当前已确认范围。涉及其他文件或新增工作时，仍需确认范围。</p></section><aside class="supplement-feedback" aria-label="统一补充与处理">${supplementStatus()}<div class="row between"><label for="supplementInput">${busy ? '下轮补充草稿' : '统一补充信息'}</label><button data-supplement="example" ${busy ? 'disabled' : ''}>填入${supplementState.resolved.length ? '剩余' : '完整'}示例</button></div><textarea id="supplementInput" placeholder="回答上面的补充事项，也可以说明目前还无法提供哪些资料。">${esc(supplementState.draft)}</textarea><div class="supplement-attachments">${supplementState.attachments.map(file => `<span>${esc(file.name)}<button data-supplement="remove-file" data-id="${file.id}" aria-label="移除 ${esc(file.name)}" ${busy ? 'disabled' : ''}>×</button></span>`).join('')}</div><div class="row between"><button data-supplement="attach" ${busy ? 'disabled' : ''}>附上 Markdown 资料</button><small id="supplementSaveState" class="muted">${supplementState.draft ? '草稿已保留（模拟）' : '未提交内容不会自动发送'}</small></div><input id="supplementFiles" class="intake-file-input" type="file" accept=".md,.markdown,text/markdown" multiple tabindex="-1" aria-label="选择补充资料">${supplementState.notice ? `<p class="supplement-file-notice" role="status">${esc(supplementState.notice)}</p>` : ''}<button class="primary supplement-submit" data-supplement="submit" ${supplementCanSubmit() ? '' : 'disabled'}>${supplementState.status === 'checking' ? '核验中 · 草稿未提交' : supplementState.status === 'queued' ? '已请求继续，无需再次提交' : '提交并继续'}</button><p class="small muted">${busy ? '可继续记录草稿；不会自动并入已提交内容。' : '一次提交并请求继续。仍有缺口时，会明确提示还需要补什么。'}</p>${latest ? `<details class="supplement-history"><summary>最近一次提交 · ${latest.result ? '查看结果' : '核验中'}</summary><p class="supplement-submitted">${esc(latest.text || '仅提交了附件文件名')}</p>${latest.attachments.length ? `<p>${latest.attachments.map(file => esc(file.name)).join('、')}</p>` : ''}<p>${esc(supplementResultText(latest))}</p>${latest.result === 'unhandled' ? '<button data-supplement="reuse">带回补充框修改</button>' : ''}</details>` : ''}<details class="supplement-demo-tools"><summary>演示场景与边界</summary><p>固定示例模拟核验结果。任意文字和附件不会被自动解析；草稿只存于本标签页。</p><button data-supplement="partial" ${busy ? 'disabled' : ''}>只填入一项示例</button><button data-supplement="reset">重新体验此场景</button></details></aside></div></div>`;
}
function supplementRoute() { return location.hash === '#supplement' ? supplementPage() : null; }
document.addEventListener('click', event => {
  const button = event.target.closest('[data-supplement]');
  if (!button) return;
  const action = button.dataset.supplement;
  if (action === 'pane') { supplementState.pane = button.dataset.pane; supplementSave(); render(); document.querySelector(`[data-supplement="pane"][data-pane="${supplementState.pane}"]`)?.focus({ preventScroll: true }); return; }
  if (action === 'reset') { supplementResetDemo(); render(); return; }
  if (action === 'reuse') {
    const last = supplementState.submissions.at(-1);
    if (!last) return;
    supplementState.draft = [supplementState.draft, last.text].filter(Boolean).join('\n\n');
    supplementSave(); render(); document.getElementById('supplementInput').focus(); return;
  }
  if (action === 'example' || action === 'partial') {
    if (supplementState.status !== 'needs-input') return;
    const questions = action === 'partial' ? supplementRemaining().slice(0, 1) : supplementRemaining();
    supplementState.draft = questions.map(question => question.answer).join('\n');
    supplementState.pane = 'feedback'; supplementSave(); render(); document.getElementById('supplementInput').focus(); return;
  }
  if (action === 'attach') { if (supplementState.status === 'needs-input') document.getElementById('supplementFiles').click(); return; }
  if (action === 'remove-file') { if (supplementState.status !== 'needs-input') return; supplementState.attachments = supplementState.attachments.filter(file => file.id !== button.dataset.id); supplementSave(); render(); document.getElementById('supplementInput').focus(); return; }
  if (action === 'submit') {
    if (!supplementCanSubmit()) return;
    const submission = { id: crypto.randomUUID(), text: supplementState.draft.trim(), attachments: supplementState.attachments.map(file => ({ ...file })), result: null };
    supplementState.submissions.push(submission); supplementState.pendingId = submission.id;
    supplementState.draft = ''; supplementState.attachments = []; supplementState.notice = '';
    supplementState.status = 'checking'; supplementState.pane = 'feedback'; supplementSave(); render();
  }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'supplementInput') return;
  supplementState.draft = event.target.value; supplementSave();
  document.querySelector('[data-supplement="submit"]').disabled = !supplementCanSubmit();
  document.getElementById('supplementSaveState').textContent = supplementState.draft ? '草稿已保留（模拟）' : '未提交内容不会自动发送';
});
document.addEventListener('change', event => {
  if (event.target.id !== 'supplementFiles' || supplementState.status !== 'needs-input') return;
  const files = [...event.target.files];
  if (!files.length) return;
  const supported = files.filter(file => /\.(md|markdown)$/i.test(file.name));
  supplementState.attachments.push(...supported.map(file => ({ id: crypto.randomUUID(), name: file.name })));
  supplementState.notice = `${files.length > supported.length ? `${files.length - supported.length} 份非 Markdown 文件未接纳。` : ''}本原型仅保留文件名，未读取或上传正文。`;
  supplementSave(); render(); document.getElementById('supplementInput').focus();
});

Object.assign(window, { supplementRoute, supplementBoardTask, supplementResetDemo });
