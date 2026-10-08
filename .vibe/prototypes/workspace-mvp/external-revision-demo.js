/* global esc, render, modal, deliveryHash, executionDemoState, executionDemoRounds */
/* global executionDemoFile, executionDemoSave, executionDemoRefresh, executionCandidateMarkdown */
/* global document, window, location, sessionStorage, TextDecoder, crypto */
// Revision suggestions are synthetic requests, never direct content replacement.
const externalRevisionNote = '保持企业现有预防措施职责分工，补充记录编号核对说明。';
let externalRevisionPicker = null;
let externalRevisionReadToken = 0;
const externalRevisionBusy = new Set();
const externalRevisionErrors = new Map();
const externalRevisionContextKey = (round, file) => `${round.id}:${file.id}`;
const externalRevisionPending = file => file.externalRequests?.findLast(request => request.state === 'pending');
const externalRevisionJudgment = file => file.externalRequests?.findLast(request => request.state === 'judgment' && !request.supersededBy);
function externalRevisionBlocked(file) { return Boolean(file.externalDraft || externalRevisionPending(file) || externalRevisionJudgment(file)); }
function externalRevisionCanSubmit(file, round) {
  if (!round || file.status !== 'review' || externalRevisionPending(file) || externalRevisionBusy.has(externalRevisionContextKey(round, file))) return false;
  return Boolean(file.externalDraft || (externalRevisionJudgment(file) && file.drafts[round.viewedRevision]?.trim()));
}
function externalRevisionPersist() {
  sessionStorage.setItem('zhiju-execution-demo-v1', JSON.stringify({ version: 2, activeRoundId: executionDemoState?.id || null, rounds: executionDemoRounds }));
}
function externalRevisionPanel(file, round) {
  const draft = file.externalDraft;
  const latest = file.externalRequests?.at(-1);
  const error = externalRevisionErrors.get(externalRevisionContextKey(round, file));
  return `<section class="external-revision-input" aria-label="本文件 Markdown 改稿建议"><div class="external-revision-entry"><button data-external-revision="choose" ${externalRevisionBusy.has(externalRevisionContextKey(round, file)) ? 'disabled' : ''}>${draft ? '更换 Markdown 改稿' : '附上 Markdown 改稿'}</button><small>每次一份 · 作为建议提交</small></div><input id="externalRevisionFile" type="file" accept=".md,.markdown,text/markdown" hidden>${draft ? `<div class="external-revision-card"><strong>${esc(draft.name)}</strong><label>改稿基于<select id="externalRevisionBaseline" ${externalRevisionBusy.has(externalRevisionContextKey(round, file)) ? 'disabled' : ''}>${Array.from({ length: file.revision }, (_, i) => i + 1).map(revision => `<option value="${revision}" ${revision === draft.baselineRevision ? 'selected' : ''}>候选第 ${revision} 版</option>`).join('')}</select></label><p>${draft.sample ? '固定合成改稿示例' : '本地文件 · 只在标签页保存'} · 尚未提交</p><div id="externalRevisionBaselineNotice">${externalRevisionBaselineNotice(file)}</div><div class="row"><button data-external-revision="preview-draft">查看改稿</button><button data-external-revision="remove">移除本次附件</button></div></div>` : ''}${error ? `<p class="external-revision-error" role="alert">${esc(error)}</p>` : ''}<div id="externalRevisionResult" aria-live="polite">${latest ? externalRevisionResult(file, latest) : ''}</div></section>`;
}
function externalRevisionBaselineNotice(file) {
  const draft = file.externalDraft;
  if (!draft) return '';
  return draft.baselineRevision < file.revision ? `<div class="external-revision-old"><strong>旧基准建议：第 ${draft.baselineRevision} 版 → 当前第 ${file.revision} 版</strong><p>改稿仍绑定第 ${draft.baselineRevision} 版。提交后由 Runner 对照新旧版本复核，不直接覆盖当前成果。</p></div>` : `<p>绑定候选第 ${draft.baselineRevision} 版，提交后由 Runner 复核。</p>`;
}
function externalRevisionResult(file, request) {
  const message = request.state === 'pending' ? '修改建议已记录，等待复核（演示）' : request.state === 'candidate' ? `复核交回候选第 ${request.returnedRevision} 版（演示）` : request.state === 'judgment' ? '复核需要顾问判断（演示）' : '复核依据已有更新，需重新提交';
  return `<div class="external-revision-result ${request.state === 'judgment' ? 'needs-judgment' : ''}"><strong>${message}</strong><p>${esc(request.name)} · 原基准第 ${request.baselineRevision} 版 · 提交时当前第 ${request.latestRevision} 版</p>${request.state === 'pending' ? `<p>${request.sample ? '原稿与提交时的新旧版本分别保留；尚未交回新候选。' : '本原型只记录这次输入，未运行 Runner，也不会为自由输入编造结论。'}</p>` : request.state === 'candidate' ? '<p>固定示例沿用记录编号核对建议，企业职责保持原样。新候选仍需逐份检查与批准。</p>' : request.state === 'judgment' ? '<p>固定示例发现一处职责要求无法从当前依据确定。当前候选保持原样；在上方同一个意见框补充依据后，再明确提交复核。</p>' : '<p>这次请求与原稿仍可查看，未改变当前候选。重新带回改稿后再明确提交。</p>'}<details><summary>查看已提交改稿与说明</summary><p>${request.comment ? esc(request.comment) : '未填写补充说明'}</p><pre tabindex="0">${esc(request.content)}</pre></details>${request.state === 'candidate' && file.revision > executionDemoState.viewedRevision ? '<button data-execution-action="switch-revision">查看新候选</button>' : request.state === 'stale' ? `<button data-external-revision="restore">带回原改稿</button>` : ''}</div>`;
}
function externalRevisionTools(file) {
  if (!file || location.hash !== '#execution-review') return '';
  const pending = externalRevisionPending(file);
  return `<div class="external-revision-demo"><small>改稿固定示例（不运行 Runner）</small><div class="row"><button data-external-revision="sample" ${file.id === 'F-PREV' && file.revision >= 2 ? '' : 'disabled'}>附上第 2 版演示改稿</button><button data-external-revision="candidate" ${pending?.sample ? '' : 'disabled'}>模拟复核交回新候选</button><button data-external-revision="judgment" ${pending?.sample ? '' : 'disabled'}>模拟复核需顾问判断</button></div></div>`;
}
function externalRevisionUpdate() {
  if (location.hash !== '#execution-review') return;
  const file = executionDemoFile(), round = executionDemoState;
  if (!file || !round) return;
  const notice = document.getElementById('externalRevisionBaselineNotice');
  if (notice) notice.innerHTML = externalRevisionBaselineNotice(file);
  const result = document.getElementById('externalRevisionResult');
  if (result) result.innerHTML = file.externalRequests?.length ? externalRevisionResult(file, file.externalRequests.at(-1)) : '';
  const submit = document.querySelector('[data-execution-action="submit-feedback"]');
  const approve = document.querySelector('[data-execution-action="approve"]');
  if (submit && externalRevisionBlocked(file)) {
    submit.textContent = file.externalDraft ? '提交改稿并复核' : externalRevisionJudgment(file) ? '提交补充并复核' : '等待改稿复核';
    submit.disabled = !externalRevisionCanSubmit(file, round);
  } else if (submit) submit.textContent = '提交并修改';
  if (approve && externalRevisionBlocked(file)) approve.disabled = true;
  for (const button of document.querySelectorAll('[data-external-revision="candidate"], [data-external-revision="judgment"]')) button.disabled = !externalRevisionPending(file)?.sample;
}
function externalRevisionSetDraft(round, file, draft) {
  const previous = file.externalDraft;
  file.externalDraft = draft;
  try { externalRevisionPersist(); externalRevisionErrors.delete(externalRevisionContextKey(round, file)); }
  catch { file.externalDraft = previous; externalRevisionErrors.set(externalRevisionContextKey(round, file), '改稿未能保存在本标签页，原附件与草稿保留。请重试；不要把此提示视为已上传。'); }
  if (executionDemoState === round && executionDemoFile() === file && location.hash === '#execution-review') render();
}
function externalRevisionSample(round, file) {
  if (file.id !== 'F-PREV' || file.revision < 2) return;
  const content = `${executionCandidateMarkdown(file, 2)}\n## 改稿建议（合成）\n\n${externalRevisionNote}\n`;
  externalRevisionSetDraft(round, file, { name: '预防措施程序-第2版改稿-演示.md', content, baselineRevision: 2, baselineContent: executionCandidateMarkdown(file, 2), sample: true });
}
async function externalRevisionRead(files, context) {
  if (!context || !executionDemoRounds.includes(context.round) || !context.round.files.includes(context.file)) return;
  if (files.length !== 1 || !/\.(md|markdown)$/i.test(files[0].name)) { externalRevisionErrors.set(externalRevisionContextKey(context.round, context.file), '请选择一份 Markdown 改稿（.md 或 .markdown）。原附件保留。'); if (executionDemoState === context.round && executionDemoFile() === context.file && location.hash === '#execution-review') render(); return; }
  const token = ++externalRevisionReadToken;
  try {
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await files[0].arrayBuffer());
    if (!content.trim()) throw new Error('Empty content');
    if (token !== externalRevisionReadToken || !executionDemoRounds.includes(context.round) || !context.round.files.includes(context.file)) return;
    externalRevisionSetDraft(context.round, context.file, { name: files[0].name, content, baselineRevision: context.revision, baselineContent: context.baselineContent, sample: false });
  } catch { if (token !== externalRevisionReadToken || !executionDemoRounds.includes(context.round) || !context.round.files.includes(context.file)) return; externalRevisionErrors.set(externalRevisionContextKey(context.round, context.file), '未能读取有效的 UTF-8 Markdown 内容，原附件与草稿保留。'); if (executionDemoState === context.round && executionDemoFile() === context.file && location.hash === '#execution-review') render(); }
}
async function externalRevisionSubmit(round, file) {
  if (!externalRevisionCanSubmit(file, round)) return;
  const revision = round.viewedRevision;
  const comment = file.drafts[revision] || '';
  const judgment = externalRevisionJudgment(file);
  const originalAttachment = file.externalDraft;
  const reportKey = round.reportKey;
  const draft = file.externalDraft || (judgment && { name: judgment.name, content: judgment.content, baselineRevision: judgment.baselineRevision, baselineContent: judgment.baselineContent, sample: false });
  if (!draft) return;
  const latestRevision = file.revision;
  const latestContent = executionCandidateMarkdown(file, latestRevision);
  const key = externalRevisionContextKey(round, file);
  externalRevisionBusy.add(key); externalRevisionUpdate();
  try {
    const hashes = await Promise.all([draft.baselineContent, draft.content, latestContent].map(deliveryHash));
    if (!executionDemoRounds.includes(round) || !round.files.includes(file) || file.revision !== latestRevision || file.status !== 'review' || round.reportKey !== reportKey || executionCandidateMarkdown(file, latestRevision) !== latestContent || file.externalDraft !== originalAttachment || (file.drafts[revision] || '') !== comment || externalRevisionPending(file)) throw new Error('Changed target');
    const request = { id: crypto.randomUUID(), reportKey: round.reportKey, fileId: file.id, name: draft.name, content: draft.content, baselineRevision: draft.baselineRevision, baselineContent: draft.baselineContent, baselineHash: hashes[0], contentHash: hashes[1], latestRevision, latestContent, latestHash: hashes[2], comment, commentRevision: revision, sample: draft.sample && !comment.trim(), state: 'pending', createdAt: new Date().toISOString(), priorRequestId: judgment?.id || null };
    const previous = { externalDraft: file.externalDraft, externalRequests: file.externalRequests, status: file.status, processingReason: file.processingReason, comment, eventsLength: round.events.length, supersededBy: judgment?.supersededBy };
    file.externalRequests = [...(file.externalRequests || []), request]; file.externalDraft = null; file.drafts[revision] = '';
    file.status = 'processing'; file.processingReason = 'external-revision';
    if (judgment) judgment.supersededBy = request.id;
    round.events.push(`${file.title} · 基于第 ${request.baselineRevision} 版的改稿已作为建议记录，绑定提交时第 ${latestRevision} 版，等待复核（演示）。`);
    try { externalRevisionPersist(); }
    catch { file.externalDraft = previous.externalDraft; file.externalRequests = previous.externalRequests; file.status = previous.status; file.processingReason = previous.processingReason; file.drafts[revision] = previous.comment; round.events.length = previous.eventsLength; if (judgment) judgment.supersededBy = previous.supersededBy; throw new Error('Not saved'); }
    externalRevisionErrors.delete(key);
  } catch { externalRevisionErrors.set(key, '未提交：版本、输入或保存条件已变化。改稿与说明保留，请核对后重新提交。'); }
  finally {
    externalRevisionBusy.delete(key);
    if (executionDemoState === round && executionDemoFile() === file && location.hash === '#execution-review') render();
    executionDemoRefresh();
  }
}
function externalRevisionReturn(round, file, outcome) {
  const request = externalRevisionPending(file);
  if (!request?.sample) return;
  if (file.status !== 'processing' || file.revision !== request.latestRevision || round.reportKey !== request.reportKey || executionCandidateMarkdown(file, file.revision) !== request.latestContent) {
    request.state = 'stale'; externalRevisionPersist(); executionDemoRefresh(); return;
  }
  // This fixed response does not merge or interpret arbitrary local Markdown.
  if (outcome === 'candidate') {
    const revision = request.latestRevision + 1;
    file.candidateVersions = { ...(file.candidateVersions || {}), [request.baselineRevision]: request.baselineContent, [request.latestRevision]: request.latestContent, [revision]: `${request.latestContent.replace(`候选第 ${request.latestRevision} 版`, `候选第 ${revision} 版`)}\n## 改稿复核说明（合成）\n\n${externalRevisionNote}\n` };
    file.externalCandidateResults = { ...(file.externalCandidateResults || {}), [revision]: { requestId: request.id, baselineRevision: request.baselineRevision, latestRevision: request.latestRevision, note: externalRevisionNote } };
    file.revision = revision; request.returnedRevision = revision; request.state = 'candidate';
  } else request.state = 'judgment';
  file.status = 'review';
  round.events.push(`${file.title} · 旧基准改稿复核返回${outcome === 'candidate' ? `候选第 ${file.revision} 版` : '待顾问判断事项'}（固定演示）；未自动批准。`);
  executionDemoSave(); executionDemoRefresh();
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-external-revision]');
  const round = executionDemoState, file = executionDemoFile();
  if (!button || button.disabled || !file || !round) return;
  const action = button.dataset.externalRevision;
  if (action === 'choose') { externalRevisionPicker = { round, file, revision: round.viewedRevision, baselineContent: executionCandidateMarkdown(file, round.viewedRevision) }; document.getElementById('externalRevisionFile').click(); return; }
  if (action === 'sample') { externalRevisionSample(round, file); return; }
  if (action === 'remove') { externalRevisionReadToken++; externalRevisionSetDraft(round, file, null); return; }
  if (action === 'preview-draft' && file.externalDraft) { modal(`${esc(file.externalDraft.name)} · 只读改稿`, `<p>原基准：候选第 ${file.externalDraft.baselineRevision} 版。附件尚未提交，不代表受控成果。</p><pre class="external-revision-preview" tabindex="0">${esc(file.externalDraft.content)}</pre>`, ''); return; }
  if (action === 'restore' && !file.externalDraft) { const request = file.externalRequests?.at(-1); if (request) externalRevisionSetDraft(round, file, { name: request.name, content: request.content, baselineRevision: request.baselineRevision, baselineContent: request.baselineContent, sample: false }); return; }
  if (action === 'candidate' || action === 'judgment') { externalRevisionReturn(round, file, action); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'externalRevisionFile') { const context = externalRevisionPicker; externalRevisionPicker = null; void externalRevisionRead([...event.target.files], context); }
  if (event.target.id === 'externalRevisionBaseline') {
    const file = executionDemoFile(), round = executionDemoState, revision = Number(event.target.value);
    if (file?.externalDraft && Number.isSafeInteger(revision) && revision > 0 && revision <= file.revision) externalRevisionSetDraft(round, file, { ...file.externalDraft, baselineRevision: revision, baselineContent: executionCandidateMarkdown(file, revision), sample: false });
  }
});
function externalRevisionReset() { externalRevisionReadToken++; externalRevisionPicker = null; externalRevisionBusy.clear(); externalRevisionErrors.clear(); }
Object.assign(window, { externalRevisionReset, externalRevisionPanel, externalRevisionTools, externalRevisionBlocked, externalRevisionCanSubmit, externalRevisionSubmit, externalRevisionUpdate });
