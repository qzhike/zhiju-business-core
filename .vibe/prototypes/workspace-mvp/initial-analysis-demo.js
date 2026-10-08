/* global esc, render, toast, state, analysisBoardTask, analysisLoad, analysisLoadState */
/* global analysisReports, analysisView, analysisRecheck, analysisApplyReport, analysisSave */
/* global document, window, location, sessionStorage, setTimeout, clearTimeout, crypto, fetch */
/* exported initialAnalysisRoute, initialAnalysisBoardTask, initialAnalysisEnter, initialAnalysisReset */
// Fixed initial-intake fixtures only. Selected file bytes are never read or uploaded.
const initialAnalysisKey = 'zhiju-initial-analysis-demo-v1';
const initialAnalysisEmpty = () => ({ project: '', file: null, note: '', notice: '', outcome: 'report', run: null, previousRuns: [] });
let initialAnalysisState;
try { initialAnalysisState = JSON.parse(sessionStorage.getItem(initialAnalysisKey)); } catch { /* Optional tab-local demonstration. */ }
if (!initialAnalysisState || !['', '青禾制造', '远山科技'].includes(initialAnalysisState.project)) initialAnalysisState = initialAnalysisEmpty();
if (!Array.isArray(initialAnalysisState.previousRuns)) initialAnalysisState.previousRuns = [];
let initialAnalysisTimer = null;
let initialAnalysisFinishing = false;
let initialAnalysisFixture = null;
const initialAnalysisStages = [
  { key: 'receiving', title: '正在接收资料', detail: '等待本次 ZIP 的接收结果；尚未开始分析。', duration: 1800 },
  { key: 'preparing', title: '正在准备客户资料', detail: '后台检查 ZIP、整理文件清单与工作目录，再交给 Runner。', duration: 2200 },
  { key: 'queued', title: '等待分析开始', detail: '资料已准备，等待服务器执行；还没有分析结论。', duration: 2000 },
  { key: 'analyzing', title: 'Runner 正在分析', detail: '先读客户现有文件，识别需要保留的企业安排，再比对公司模板。', duration: 6500 },
  { key: 'checking', title: '正在核验返回报告', detail: '平台核对报告格式、来源及引用；分析意见来自 Runner。', duration: 1500 }
];
const initialAnalysisExampleFiles = ['质量手册.docx', '纠正措施程序.docx', '预防措施程序.docx'];
function initialAnalysisSave() {
  try { sessionStorage.setItem(initialAnalysisKey, JSON.stringify(initialAnalysisState)); } catch { /* Never imply server persistence. */ }
}
function initialAnalysisReset() {
  clearTimeout(initialAnalysisTimer); initialAnalysisTimer = null;
  initialAnalysisState = initialAnalysisEmpty(); initialAnalysisSave();
}
function initialAnalysisBusy() { return initialAnalysisStages.some(stage => stage.key === initialAnalysisState.run?.stage); }
function initialAnalysisBoardTask() {
  const run = initialAnalysisState.run;
  if (!run || run.stage === 'ready') return analysisBoardTask();
  const stage = initialAnalysisStages.find(item => item.key === run.stage);
  return { id: 'initial-analysis', project: run.project, title: '体系文件升级 · 客户资料分析',
    desc: run.stage === 'failed' ? `${run.failure.title}：${run.failure.reason}` : `${stage.title}；${run.file.name}。可以离开页面，稍后查看。`,
    group: run.stage === 'failed' ? 'attention' : 'running', badge: run.stage === 'failed' ? '查看原因并处理' : '查看分析进度' };
}
function initialAnalysisEnter() {
  if (!initialAnalysisState.run && !initialAnalysisState.project && state.filter !== '全部项目') initialAnalysisState.project = state.filter;
  initialAnalysisSave();
  if (location.hash === '#initial-analysis') render(); else location.hash = 'initial-analysis';
}
function initialAnalysisFileMarkup(file, editable = false) {
  return `<div class="initial-analysis-file"><span class="initial-analysis-file-icon" aria-hidden="true">ZIP</span><div><strong>${esc(file.name)}</strong><small>${file.example ? '固定匿名示例 · 3 份客户 DOCX' : '本地文件名 · 原型未读取文件内容'}</small></div>${editable ? '<button data-initial-analysis="remove" aria-label="移除已选 ZIP 包">移除</button>' : ''}</div>`;
}
function initialAnalysisUpload() {
  const selected = initialAnalysisState.file;
  const validProject = initialAnalysisState.project === '青禾制造';
  return `<section class="initial-analysis-card initial-analysis-upload" aria-label="首轮客户资料提交"><div class="initial-analysis-project"><label for="initialAnalysisProject">所属项目</label><select id="initialAnalysisProject"><option value="">先选择项目</option>${['青禾制造', '远山科技'].map(project => `<option ${project === initialAnalysisState.project ? 'selected' : ''}>${project}</option>`).join('')}</select></div>${initialAnalysisState.project === '远山科技' ? '<p class="initial-analysis-message">远山科技尚无首轮分析示例。请选择青禾制造体验，避免把其他项目的报告混入。</p>' : ''}
    <div class="initial-analysis-upload-zone"><span class="initial-analysis-upload-symbol" aria-hidden="true">↑</span><h2>把客户现有体系文件放进一个 ZIP</h2><p>包内可包含多份 DOCX 和 Markdown，无需先逐份匹配模板。</p><button data-initial-analysis="choose" ${initialAnalysisState.project ? '' : 'disabled'}>${selected ? '更换 ZIP 包' : '选择 ZIP 包'}</button><input id="initialAnalysisZip" class="initial-analysis-file-input" type="file" accept=".zip,application/zip" aria-label="选择客户 ZIP 包"><small>首轮一次提交一个 ZIP；后续资料在分析总览补充。</small></div>
    ${selected ? initialAnalysisFileMarkup(selected, true) : ''}<label class="initial-analysis-note" for="initialAnalysisNote">补充说明 <span>选填</span><textarea id="initialAnalysisNote" rows="2" placeholder="例如：这套文件已使用多年，请保留企业现行组织和流程。">${esc(initialAnalysisState.note)}</textarea></label>
    <div class="initial-analysis-preset"><span>本次分析</span><p>读取客户文件 → 对照公司预设模板 → 返回资料缺口与升级计划</p></div>
    <div class="initial-analysis-submit"><p id="initialAnalysisNotice" role="status">${esc(initialAnalysisState.notice || '提交启动分析；生成或修改文件仍需另行确认范围。')}</p><button class="primary" data-initial-analysis="submit" ${selected && validProject ? '' : 'disabled'}>提交并分析</button></div></section>
    <div class="initial-analysis-example"><span>体验固定匿名场景</span><button data-initial-analysis="example">带入演示 ZIP 包</button><small>只使用合成资料清单及已有报告示例，不上传本地文件。</small></div>${initialAnalysisDemoOptions()}`;
}
function initialAnalysisDemoOptions() {
  const run = initialAnalysisState.run;
  return `<details class="initial-analysis-demo"><summary>演示选项</summary><div><p>这里的阶段反馈均为合成状态，不代表真实上传、解包或 Runner 执行。</p>${!run ? `<label for="initialAnalysisOutcome">返回结果</label><select id="initialAnalysisOutcome">${[['report', '返回分析报告'], ['prepare-failure', 'ZIP 准备失败'], ['runner-failure', 'Runner 分析失败']].map(([key, name]) => `<option value="${key}" ${initialAnalysisState.outcome === key ? 'selected' : ''}>${name}</option>`).join('')}</select>` : `${initialAnalysisBusy() ? '<button data-initial-analysis="finish">立即返回演示结果</button>' : ''}<button data-initial-analysis="reset" ${initialAnalysisBusy() ? 'disabled' : ''}>重新体验首轮提交</button>`}</div></details>`;
}
function initialAnalysisProgressMarkup() {
  const run = initialAnalysisState.run;
  const stage = initialAnalysisStages.find(item => item.key === run.stage);
  const failed = run.stage === 'failed';
  const ready = run.stage === 'ready';
  const index = initialAnalysisStages.findIndex(item => item.key === (failed ? run.failure.stage : run.stage));
  const step = ready ? 3 : index <= 0 ? 0 : index === 1 ? 1 : index < 4 ? 2 : 3;
  const labels = ['接收资料', '准备资料', 'Runner 分析', '报告返回'];
  const title = failed ? run.failure.title : ready ? '分析报告已就绪' : stage.title;
  const detail = failed ? run.failure.reason : ready ? '先查看客户仍需补充的资料，再核对拟交付文件和升级计划。' : stage.detail;
  return `<div class="initial-analysis-status ${failed ? 'is-failed' : ready ? 'is-ready' : ''}" role="status" aria-live="polite"><small>${failed ? '需要你处理' : ready ? '可以核对报告' : '首轮分析进行中'} · 演示</small><h2>${esc(title)}</h2><p>${esc(detail)}</p></div><ol class="initial-analysis-steps" aria-label="首轮分析阶段">${labels.map((label, position) => `<li class="${ready || position < step ? 'is-complete' : position === step ? failed ? 'is-failed' : 'is-current' : ''}" ${position === step && !ready ? 'aria-current="step"' : ''}><span aria-hidden="true">${ready || position < step ? '✓' : position + 1}</span><strong>${label}</strong><small>${ready || position < step ? '已完成（演示）' : position === step ? failed ? '未成功' : '当前阶段' : '尚未开始'}</small></li>`).join('')}</ol>
    ${ready ? `<div class="initial-analysis-result"><p><strong>${run.result.customerRequests} 项</strong>客户需补充</p><p><strong>${run.result.consultantItems} 项</strong>顾问需判断</p><p><strong>${run.result.plannedFiles} 份</strong>拟交付文件</p></div><p class="initial-analysis-limits">报告存在读取限制及待确认事项。分析报告就绪不代表资料齐全或文件已升级。</p>` : failed ? '<p class="initial-analysis-limits">这次未形成可用的新分析报告，原 ZIP 引用与补充说明保留；其他工作不受影响。</p>' : '<p class="initial-analysis-limits">可以返回工作台继续其他工作。报告返回时更新工作卡片，保留你当前所在的页面。</p>'}
    <div class="initial-analysis-progress-actions">${ready ? '<button class="primary" data-initial-analysis="report">查看分析报告 →</button>' : failed ? run.failure.retryAllowed ? '<button class="primary" data-initial-analysis="retry">重新分析这份资料</button>' : '<button class="primary" data-initial-analysis="replace">更换 ZIP 包</button>' : '<a href="#board">返回工作台，稍后查看 →</a>'}</div>`;
}
function initialAnalysisRunDetails() {
  const run = initialAnalysisState.run;
  return `${initialAnalysisFileMarkup(run.file)}<p>所属项目：${esc(run.project)} · 第 ${run.attempt} 次演示请求</p>${run.note ? `<p>提交时说明：${esc(run.note)}</p>` : ''}<p>公司模板与执行方案由项目预设，不在这里选择运行时。</p>${run.prepared ? `<div class="initial-analysis-manifest"><strong>示例客户文件清单 · ${initialAnalysisExampleFiles.length} 份</strong><ul>${initialAnalysisExampleFiles.map(name => `<li>${esc(name)}</li>`).join('')}</ul><small>固定清单与匿名首轮报告一致；并非对本地 ZIP 的解包结果。</small></div>` : '<p>尚无可展示的准备结果。</p>'}<ol>${run.events.map(event => `<li>${esc(event)}</li>`).join('')}</ol>${initialAnalysisState.previousRuns.length ? `<details><summary>先前请求记录 · ${initialAnalysisState.previousRuns.length}</summary>${initialAnalysisState.previousRuns.map(prior => `<p><strong>第 ${prior.attempt} 次 · ${esc(prior.file.name)}</strong><br>${esc(prior.failure?.reason || '已有记录保留')}<br>提交说明：${esc(prior.note || '未填写')}</p>`).join('')}</details>` : ''}`;
}
function initialAnalysisPage() {
  const run = initialAnalysisState.run;
  return `<section class="initial-analysis-shell"><a class="initial-analysis-back" href="#board">← 返回工作台</a><div class="initial-analysis-heading"><div><div class="initial-analysis-crumb">${run ? `${esc(run.project)} / ` : ''}体系文件升级</div><h1>${run ? '客户资料分析' : '提交客户资料'}</h1><p>${run ? '先分析现行文件，再确认本轮升级范围。' : '提交一次，后台读取客户文件并返回分析计划。'}</p></div></div><div class="initial-analysis-content">${run ? `<section class="initial-analysis-card initial-analysis-progress" aria-label="客户资料分析进度"><div class="initial-analysis-run-context">${esc(run.project)}<span>${esc(run.file.name)}</span></div><div id="initialAnalysisProgress">${initialAnalysisProgressMarkup()}</div><details class="initial-analysis-run-details"><summary>本次资料与运行记录</summary><div id="initialAnalysisRunDetails">${initialAnalysisRunDetails()}</div></details></section>${initialAnalysisDemoOptions()}` : initialAnalysisUpload()}</div></section>`;
}
function initialAnalysisRoute() { return location.hash === '#initial-analysis' ? initialAnalysisPage() : null; }
function initialAnalysisRefresh() {
  if (location.hash === '#initial-analysis') {
    const progress = document.getElementById('initialAnalysisProgress');
    if (!progress) return;
    const focusedAction = progress.contains(document.activeElement) ? document.activeElement.dataset.initialAnalysis : null;
    progress.innerHTML = initialAnalysisProgressMarkup();
    document.getElementById('initialAnalysisRunDetails').innerHTML = initialAnalysisRunDetails();
    if (focusedAction) {
      const button = [...progress.querySelectorAll('button')].find(item => item.dataset.initialAnalysis === focusedAction);
      if (button) button.focus({ preventScroll: true });
      else { progress.tabIndex = -1; progress.focus({ preventScroll: true }); }
    }
    const finish = document.querySelector('[data-initial-analysis="finish"]');
    if (finish) finish.disabled = !initialAnalysisBusy();
    const reset = document.querySelector('[data-initial-analysis="reset"]');
    if (reset) reset.disabled = initialAnalysisBusy();
  } else if (location.hash === '#board' || !location.hash) {
    const card = document.querySelector('[data-task="initial-analysis"]');
    if (!card) return;
    const focused = document.activeElement === card;
    const task = initialAnalysisBoardTask();
    card.dataset.task = task.id;
    card.querySelector('strong').textContent = task.title;
    card.querySelector('p').textContent = task.desc;
    card.querySelector('.card-next').textContent = `${task.id === 'analysis' ? '查看分析报告' : task.badge} →`;
    const column = document.querySelector(`.simple-board .column.${task.group}`);
    if (column && card.parentElement !== column) { column.querySelector('.empty')?.remove(); column.append(card); }
    for (const item of document.querySelectorAll('.simple-board .column')) {
      item.querySelector('.coltitle span')?.replaceChildren(String(item.querySelectorAll('.card').length));
      if (!item.querySelector('.card') && !item.querySelector('.empty')) item.insertAdjacentHTML('beforeend', '<div class="empty">暂无工作</div>');
    }
    if (focused) card.focus({ preventScroll: true });
  }
}
function initialAnalysisFail(run, stage, reason, retryAllowed) {
  if (initialAnalysisState.run !== run) return;
  clearTimeout(initialAnalysisTimer); initialAnalysisTimer = null;
  run.stage = 'failed';
  run.failure = { stage, title: stage === 'receiving' || stage === 'preparing' ? '客户资料准备未成功' : '本次分析未成功', reason, retryAllowed };
  run.events.push(`${run.failure.title}（演示）：${reason}`);
  initialAnalysisSave(); initialAnalysisRefresh();
}
async function initialAnalysisFinish(run) {
  if (initialAnalysisFinishing || initialAnalysisState.run !== run || run.stage !== 'checking') return;
  initialAnalysisFinishing = true;
  try {
    if (!initialAnalysisFixture) {
      const response = await fetch('analysis-report.example.json?v=17', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Missing fixture');
      const report = await response.json();
      if (report.stage !== 'ANALYSIS' || report.schemaVersion !== '0.1.0' || !Array.isArray(report.attentionItems) || !Array.isArray(report.plannedFiles)) throw new Error('Unsupported fixture');
      initialAnalysisFixture = report;
    }
    if (initialAnalysisState.run !== run || run.stage !== 'checking') return;
    const report = initialAnalysisFixture;
    run.result = { customerRequests: new Set(report.attentionItems.filter(item => item.audience === 'CUSTOMER' && item.customerRequest).map(item => item.customerRequest.key)).size,
      consultantItems: report.attentionItems.filter(item => item.audience === 'CONSULTANT').length, plannedFiles: report.plannedFiles.length };
    run.stage = 'ready'; run.events.push('已取得可展示的固定匿名首轮报告（演示）；尚未生成或修改文件。');
    initialAnalysisSave(); initialAnalysisRefresh();
    if (location.hash !== '#initial-analysis') toast('客户资料分析报告已就绪（演示），可从工作台查看。');
  } catch {
    initialAnalysisFail(run, 'checking', '演示报告暂时无法载入，尚不能展示分析结论。', true);
  } finally { initialAnalysisFinishing = false; }
}
function initialAnalysisSchedule() {
  const run = initialAnalysisState.run;
  if (!run || !initialAnalysisBusy() || initialAnalysisTimer || initialAnalysisFinishing) return;
  initialAnalysisTimer = setTimeout(() => {
    initialAnalysisTimer = null;
    if (initialAnalysisState.run !== run || !initialAnalysisBusy()) return;
    if (run.stage === 'preparing' && run.outcome === 'prepare-failure') { initialAnalysisFail(run, 'preparing', '演示 ZIP 无法解开；本次尚未交给 Runner。请更换可读取的 ZIP 包。', false); return; }
    if (run.stage === 'analyzing' && run.outcome === 'runner-failure') { initialAnalysisFail(run, 'analyzing', '演示 Runner 本次未返回约定的分析报告；资料已经准备，服务反馈允许重新分析。', true); return; }
    if (run.stage === 'checking') { void initialAnalysisFinish(run); return; }
    const index = initialAnalysisStages.findIndex(stage => stage.key === run.stage);
    const next = initialAnalysisStages[index + 1];
    if (run.stage === 'preparing') run.prepared = true;
    run.stage = next.key; run.nextAt = Date.now() + next.duration;
    run.events.push(`${next.title}（演示）。`);
    initialAnalysisSave(); initialAnalysisRefresh(); initialAnalysisSchedule();
  }, Math.max(0, run.nextAt - Date.now()));
}
function initialAnalysisSubmit(retry = false) {
  if (initialAnalysisBusy()) return;
  const previous = initialAnalysisState.run;
  if (retry && (!previous?.failure?.retryAllowed || previous.stage !== 'failed')) return;
  const file = retry ? previous.file : initialAnalysisState.file;
  const project = retry ? previous.project : initialAnalysisState.project;
  if (!file || project !== '青禾制造') return;
  if (!file.example) {
    initialAnalysisState.notice = '本地 ZIP 的文件名已保留；原型未上传、解包或分析它。请带入演示 ZIP 体验后续流程。';
    initialAnalysisSave(); document.getElementById('initialAnalysisNotice').textContent = initialAnalysisState.notice; return;
  }
  const run = { id: crypto.randomUUID(), project, file: { ...file }, note: retry ? previous.note : initialAnalysisState.note,
    stage: 'receiving', outcome: retry ? 'report' : initialAnalysisState.outcome, prepared: false, attempt: retry ? previous.attempt + 1 : 1,
    events: retry ? ['根据同一份已提交资料请求重新分析（演示），未重复上传或覆盖旧记录。'] : ['已明确提交并请求首轮分析（演示），尚未生成文件。'] };
  // Reuse prepared materials on the fixed retry; never rewrite the failed record.
  if (retry) { initialAnalysisState.previousRuns.push(previous); run.stage = 'queued'; run.prepared = true; }
  run.nextAt = Date.now() + initialAnalysisStages.find(stage => stage.key === run.stage).duration;
  initialAnalysisState.run = run; initialAnalysisState.notice = '';
  initialAnalysisSave(); render();
  const progress = document.getElementById('initialAnalysisProgress');
  if (progress) { progress.tabIndex = -1; progress.focus({ preventScroll: true }); }
  initialAnalysisSchedule();
}
async function initialAnalysisOpenReport() {
  if (initialAnalysisState.run?.stage !== 'ready') return;
  if (analysisLoadState !== 'ready') await analysisLoad();
  if (initialAnalysisState.run?.stage !== 'ready') return;
  if (!analysisReports.initial || analysisLoadState !== 'ready') { toast('示例报告暂时无法打开，请稍后重试；资料与回执保留。'); return; }
  // Open the exact initial fixture. Preserve an existing follow-up as the current report.
  analysisView.historyMode = analysisRecheck.hasReport || analysisRecheck.hasOrgReport;
  analysisView.section = 'overview'; analysisView.active = null; analysisView.detail = false;
  analysisApplyReport(analysisReports.initial, 'initial'); analysisSave();
  location.hash = 'analysis';
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button?.dataset.initialAnalysis) return;
  const action = button.dataset.initialAnalysis;
  if (action === 'open') { initialAnalysisEnter(); return; }
  if (action === 'choose' && !initialAnalysisState.run) { document.getElementById('initialAnalysisZip').click(); return; }
  if (action === 'example' && !initialAnalysisState.run) {
    initialAnalysisState.project = '青禾制造'; initialAnalysisState.file = { name: '青禾制造_现行体系文件_演示.zip', example: true };
    initialAnalysisState.notice = ''; initialAnalysisSave(); render();
    document.querySelector('[data-initial-analysis="submit"]')?.focus({ preventScroll: true }); return;
  }
  if (action === 'remove' && !initialAnalysisState.run) { initialAnalysisState.file = null; initialAnalysisState.notice = ''; initialAnalysisSave(); render(); document.querySelector('[data-initial-analysis="choose"]')?.focus(); return; }
  if (action === 'submit') { initialAnalysisSubmit(); return; }
  if (action === 'retry') { initialAnalysisSubmit(true); return; }
  if (action === 'report') { void initialAnalysisOpenReport(); return; }
  if (action === 'replace' && initialAnalysisState.run?.stage === 'failed') {
    initialAnalysisState.previousRuns.push(initialAnalysisState.run);
    initialAnalysisState.file = null; initialAnalysisState.run = null; initialAnalysisState.notice = '请更换 ZIP 包，再明确提交；原型尚未分析任何真实文件。';
    initialAnalysisSave(); render(); document.querySelector('[data-initial-analysis="choose"]')?.focus(); return;
  }
  if (action === 'reset' && !initialAnalysisBusy()) { initialAnalysisReset(); render(); return; }
  if (action === 'finish' && initialAnalysisBusy()) {
    const run = initialAnalysisState.run;
    clearTimeout(initialAnalysisTimer); initialAnalysisTimer = null;
    if (run.outcome === 'prepare-failure') { initialAnalysisFail(run, 'preparing', '演示 ZIP 无法解开；本次尚未交给 Runner。请更换可读取的 ZIP 包。', false); return; }
    if (run.outcome === 'runner-failure') { run.prepared = true; initialAnalysisFail(run, 'analyzing', '演示 Runner 本次未返回约定的分析报告；资料已经准备，服务反馈允许重新分析。', true); return; }
    run.prepared = true; run.stage = 'checking'; run.events.push('演示控制请求立即返回固定结果；并非真实运行进度。');
    initialAnalysisSave(); initialAnalysisRefresh(); void initialAnalysisFinish(run);
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'initialAnalysisNote' && !initialAnalysisState.run) { initialAnalysisState.note = event.target.value; initialAnalysisSave(); }
});
document.addEventListener('change', event => {
  if (initialAnalysisState.run) return;
  if (event.target.id === 'initialAnalysisProject') { initialAnalysisState.project = event.target.value; initialAnalysisState.notice = ''; initialAnalysisSave(); render(); document.getElementById('initialAnalysisProject')?.focus(); }
  if (event.target.id === 'initialAnalysisOutcome') { initialAnalysisState.outcome = event.target.value; initialAnalysisSave(); }
  if (event.target.id === 'initialAnalysisZip') {
    const files = Array.from(event.target.files || []);
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      initialAnalysisState.file = { name: files[0].name, example: false }; initialAnalysisState.notice = '';
    } else if (files.length) initialAnalysisState.notice = '首轮请选择一个 ZIP 包；DOCX 和 Markdown 可放在包内。原有选择保留。';
    event.target.value = ''; initialAnalysisSave(); render();
    document.querySelector('[data-initial-analysis="choose"]')?.focus({ preventScroll: true });
  }
});
Object.assign(window, { initialAnalysisRoute, initialAnalysisBoardTask, initialAnalysisEnter, initialAnalysisReset });
// A reload reconciles the same tab-local fixture; it never submits another request.
initialAnalysisSchedule();
