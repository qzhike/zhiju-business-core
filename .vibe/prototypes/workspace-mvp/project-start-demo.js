/* global esc, render, state, save, document, window, location, sessionStorage, crypto */
// Project onboarding fixture only. Names never become Core scope identifiers.
const projectStartKey = 'zhiju-project-start-demo-v1';
const projectStartZip = { name: '客户现行体系文件_匿名演示.zip', example: true };
const projectStartClients = [
  { id: 'demo-client-e7c9337a-fb4a-4a51-88c3-9c056034ca21', name: '青禾制造有限公司（演示）', code: 'DEMO-C01' },
  { id: 'demo-client-926f68fd-87b7-450f-9dbd-511f1fed23fe', name: '远山科技有限公司（演示）', code: 'DEMO-C02' }
];
function projectStartEmptyDraft() { return { company: '', title: '', clientId: null, clientMode: 'search' }; }
let projectStartState = { version: 2, draft: projectStartEmptyDraft(), clients: projectStartClients.map(client => ({ ...client })), projects: [] };
let projectStartError = '', projectStartCreating = false, projectStartPickerTarget = null, projectStartClientOpen = false, projectStartClientActive = -1;
function projectStartLegacyValid(value) {
  const fileValid = file => file === null || (typeof file?.name === 'string' && /\.zip$/i.test(file.name) && typeof file.example === 'boolean');
  const requestValid = (request, id) => request === null || (typeof request?.id === 'string' && request.projectId === id && fileValid(request.file) && request.file?.example === true && typeof request.note === 'string' && Number.isFinite(request.submittedAt));
  return value?.version === 1 && typeof value.draft?.company === 'string' && typeof value.draft?.title === 'string' && Array.isArray(value.projects) &&
    new Set(value.projects.map(project => project.id)).size === value.projects.length && value.projects.every(project => (
      /^demo-project-[0-9a-f-]{36}$/.test(project?.id) && typeof project.company === 'string' && typeof project.title === 'string' &&
      Number.isFinite(project.createdAt) && typeof project.intake?.note === 'string' && fileValid(project.intake.file) && requestValid(project.intake.request, project.id)
    ));
}
function projectStartValid(value) {
  if (value?.version !== 2 || !projectStartLegacyValid({ ...value, version: 1 }) || !Array.isArray(value.clients)) return false;
  if (new Set(value.clients.map(client => client.id)).size !== value.clients.length || new Set(value.clients.map(client => client.code)).size !== value.clients.length) return false;
  if (!value.clients.every(client => /^demo-client-[0-9a-f-]{36}$/.test(client?.id) && typeof client.name === 'string' && client.name.trim() && typeof client.code === 'string' && client.code.trim())) return false;
  const selected = value.clients.find(client => client.id === value.draft.clientId);
  return ['search', 'new'].includes(value.draft.clientMode) && (value.draft.clientId === null || (value.draft.clientMode === 'search' && selected?.name === value.draft.company)) &&
    value.projects.every(project => value.clients.some(client => client.id === project.clientId && client.name === project.company));
}
function projectStartMigrate(value) {
  if (!projectStartLegacyValid(value)) throw new Error('Invalid legacy fixture');
  const clients = projectStartClients.map(client => ({ ...client }));
  const projects = value.projects.map(project => {
    // Legacy names are display snapshots, never evidence that two clients match.
    const client = { id: `demo-client-${crypto.randomUUID()}`, name: project.company, code: `DEMO-C${String(clients.length + 1).padStart(2, '0')}` };
    clients.push(client); return { ...project, clientId: client.id };
  });
  const migrated = { version: 2, draft: { ...projectStartEmptyDraft(), ...value.draft }, clients, projects };
  if (!projectStartValid(migrated)) throw new Error('Invalid migrated fixture');
  sessionStorage.setItem(projectStartKey, JSON.stringify(migrated));
  return migrated;
}
try {
  const raw = sessionStorage.getItem(projectStartKey);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1) projectStartState = projectStartMigrate(parsed);
    else if (projectStartValid(parsed)) projectStartState = parsed;
    else throw new Error('Invalid fixture');
  }
} catch { projectStartError = '演示项目记录暂时无法恢复。为保留已有记录，创建入口已停用。'; }
function projectStartPersist() {
  if (projectStartError) return false;
  try { sessionStorage.setItem(projectStartKey, JSON.stringify(projectStartState)); return true; }
  catch { projectStartError = '本次演示变更未能保存。已填写内容仍在本页，请保留此页；尚未确认本次创建或提交。'; return false; }
}
function projectStartCurrent() {
  return projectStartState.projects.find(project => location.hash === `#project-intake/${project.id}`) ?? null;
}
function projectStartNotice(message) {
  const element = document.getElementById('projectStartNotice');
  if (element) element.textContent = message;
  if (projectStartError) document.querySelector('#projectStartForm button[type="submit"],#projectStartSubmitZip')?.setAttribute('disabled', '');
}
function projectStartNew() {
  projectStartCreating = false; projectStartClientOpen = false; projectStartClientActive = -1;
  if (location.hash === '#new-project') render(); else location.hash = 'new-project';
}
function projectStartOpen(id) {
  if (!projectStartState.projects.some(project => project.id === id)) return;
  state.filter = id; save();
  if (location.hash === `#project-intake/${id}`) render(); else location.hash = `project-intake/${id}`;
}
function projectStartCreate() {
  if (projectStartCreating || projectStartError) return;
  const draft = projectStartState.draft, company = draft.company.trim(), title = draft.title.trim();
  const existing = projectStartState.clients.find(client => client.id === draft.clientId && client.name === draft.company);
  if (draft.clientMode !== 'new' && !existing) {
    projectStartNotice('请在列表中选择已有客户，或明确点击“新建客户”。');
    document.getElementById('projectStartCompany')?.focus(); return;
  }
  if (!company || !title || company.length > 120 || title.length > 160) {
    projectStartNotice('请填写客户企业名称与项目名称；企业名称最多 120 字，项目名称最多 160 字。');
    document.getElementById(!company || company.length > 120 ? 'projectStartCompany' : 'projectStartTitle')?.focus(); return;
  }
  projectStartCreating = true;
  const isNew = draft.clientMode === 'new';
  const client = isNew ? { id: `demo-client-${crypto.randomUUID()}`, name: company, code: `DEMO-C${String(projectStartState.clients.length + 1).padStart(2, '0')}` } : existing;
  const project = { id: `demo-project-${crypto.randomUUID()}`, clientId: client.id, company: client.name, title, createdAt: Date.now(), intake: { file: null, note: '', request: null } };
  if (isNew) projectStartState.clients.push(client);
  projectStartState.projects.push(project); projectStartState.draft = projectStartEmptyDraft();
  if (!projectStartPersist()) {
    projectStartState.projects.pop(); if (isNew) projectStartState.clients.pop();
    projectStartState.draft = draft; projectStartCreating = false; projectStartNotice(projectStartError); return;
  }
  projectStartClientOpen = false; projectStartClientActive = -1; projectStartOpen(project.id);
}
function projectStartClientMatches() {
  const query = projectStartState.draft.company.trim().toLocaleLowerCase();
  return projectStartState.clients.filter(client => `${client.name} ${client.code}`.toLocaleLowerCase().includes(query));
}
function projectStartClientList() {
  const matches = projectStartClientMatches();
  return `<div class="project-start-client-list" id="projectStartClientList" role="listbox" aria-label="已有客户">${matches.length ? matches.map((client, index) => `<button type="button" role="option" tabindex="-1" id="projectStartClientOption-${client.id}" aria-selected="${index === projectStartClientActive}" data-project-start-client-id="${client.id}" class="${index === projectStartClientActive ? 'active' : ''}"><strong>${esc(client.name)}</strong><small>客户编号 ${esc(client.code)}</small></button>`).join('') : '<p class="project-start-client-empty">未找到匹配的已有客户</p>'}</div><button type="button" class="project-start-client-add" data-project-start-client="new">＋ 新建客户${projectStartState.draft.company.trim() ? `：${esc(projectStartState.draft.company.trim())}` : ''}</button>`;
}
function projectStartClientHelp() {
  const draft = projectStartState.draft, selected = projectStartState.clients.find(client => client.id === draft.clientId);
  if (draft.clientMode === 'new') {
    const names = projectStartState.clients.filter(client => client.name.trim() === draft.company.trim());
    return `<span>${names.length ? '存在同名客户，可改选已有客户；本次明确新建将使用独立身份。' : '新客户：填写名称，随本次项目一起建立。'}</span><button type="button" data-project-start-client="search">改选已有客户</button>`;
  }
  return `<span>${selected ? `已选择已有客户 · ${esc(selected.code)}，新项目单独保存。` : '搜索并选择已有客户；首次合作请点击“新建客户”。'}</span>${projectStartClientOpen ? '' : '<button type="button" data-project-start-client="new">新建客户</button>'}`;
}
function projectStartClientRefresh() {
  const input = document.getElementById('projectStartCompany'), panel = document.getElementById('projectStartClientPanel'), help = document.getElementById('projectStartClientHelp');
  if (!input || !panel || !help) return;
  const open = projectStartState.draft.clientMode === 'search' && projectStartClientOpen && !projectStartError;
  panel.hidden = !open; panel.innerHTML = open ? projectStartClientList() : '<div id="projectStartClientList" role="listbox" aria-label="已有客户"></div>';
  help.innerHTML = projectStartClientHelp();
  if (projectStartState.draft.clientMode === 'search') {
    input.setAttribute('aria-expanded', String(open));
    const active = open && projectStartClientActive >= 0 ? projectStartClientMatches()[projectStartClientActive] : null;
    if (active) { input.setAttribute('aria-activedescendant', `projectStartClientOption-${active.id}`); document.getElementById(`projectStartClientOption-${active.id}`)?.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
}
function projectStartClientSelect(id) {
  if (location.hash !== '#new-project' || projectStartError) return;
  const client = projectStartState.clients.find(item => item.id === id);
  if (!client) return;
  Object.assign(projectStartState.draft, { company: client.name, clientId: client.id, clientMode: 'search' });
  projectStartClientOpen = false; projectStartClientActive = -1; projectStartPersist(); render(); document.getElementById('projectStartTitle')?.focus();
}
function projectStartClientMode(mode) {
  if (location.hash !== '#new-project' || projectStartError || !['search', 'new'].includes(mode)) return;
  Object.assign(projectStartState.draft, { clientId: null, clientMode: mode });
  projectStartClientOpen = mode === 'search'; projectStartClientActive = -1; projectStartPersist(); render(); document.getElementById('projectStartCompany')?.focus();
}
function projectStartForm() {
  const draft = projectStartState.draft, searching = draft.clientMode === 'search';
  return `<section class="initial-analysis-shell project-start-shell"><a class="initial-analysis-back" href="#board">← 返回工作台</a><div class="initial-analysis-heading"><div class="initial-analysis-crumb">体系文件升级</div><h1>新建项目</h1><p>先明确项目归属，再提交客户的现有文件。</p></div><div class="initial-analysis-content"><ol class="project-start-steps" aria-label="开始项目"><li aria-current="step"><span>1</span>建立项目</li><li><span>2</span>提交客户资料</li></ol><form class="initial-analysis-card project-start-form" id="projectStartForm"><label for="projectStartCompany">客户企业名称</label><div class="project-start-client-field"><input id="projectStartCompany" name="company" maxlength="120" required autocomplete="off" ${searching ? `role="combobox" aria-autocomplete="list" aria-expanded="${projectStartClientOpen && !projectStartError}" aria-controls="projectStartClientList"` : ''} aria-describedby="projectStartClientHelp" placeholder="${searching ? '搜索已有客户，或新建客户' : '输入新客户的企业名称'}" value="${esc(draft.company)}">${searching ? '<span class="project-start-client-arrow" aria-hidden="true">⌄</span>' : ''}<div class="project-start-client-panel" id="projectStartClientPanel" ${searching && projectStartClientOpen && !projectStartError ? '' : 'hidden'}>${searching && projectStartClientOpen && !projectStartError ? projectStartClientList() : '<div id="projectStartClientList" role="listbox" aria-label="已有客户"></div>'}</div></div><div class="project-start-client-help" id="projectStartClientHelp">${projectStartClientHelp()}</div><label for="projectStartTitle">项目名称</label><input id="projectStartTitle" name="title" maxlength="160" required autocomplete="off" placeholder="例如：2026 体系文件升级（演示）" value="${esc(draft.title)}"><small>同一客户可以有多个项目，资料和成果按项目分别保留。</small><div class="project-start-preset"><strong>沿用公司预设方案</strong><p>客户文件交给 Runner 阅读，再对照公司模板形成分析计划。</p></div><div class="initial-analysis-submit"><p id="projectStartNotice" role="status">${esc(projectStartError || '创建后直接进入本项目的 ZIP 提交页。')}</p><button class="primary" type="submit" ${projectStartError ? 'disabled' : ''}>创建项目并继续 →</button></div></form><p class="project-start-demo-note">交互原型 · 客户、项目与草稿仅保存在当前标签页，正式企业与项目尚未创建。</p></div></section>`;
}
function projectStartFile(file, editable) {
  return `<div class="initial-analysis-file"><span class="initial-analysis-file-icon" aria-hidden="true">ZIP</span><div><strong>${esc(file.name)}</strong><small>${file.example ? '固定匿名演示包 · 不含真实客户资料' : '本地文件名 · 原型未上传或读取内容'}</small></div>${editable ? '<button data-project-start-action="remove" aria-label="移除已选 ZIP 包">移除</button>' : ''}</div>`;
}
function projectStartIntake(project) {
  const request = project.intake.request;
  return `<section class="initial-analysis-shell project-start-shell"><a class="initial-analysis-back" href="#board">← 返回工作台</a><div class="initial-analysis-heading"><div class="initial-analysis-crumb">${esc(project.company)} / 体系文件升级</div><h1>${request ? '客户资料分析' : '提交客户资料'}</h1><p>${request ? '首轮资料已记录，等待分析报告。' : '项目归属已带入，选择客户现行文件 ZIP 即可。'}</p></div><div class="initial-analysis-content"><ol class="project-start-steps" aria-label="开始项目"><li><span>✓</span>项目已建立（演示）</li><li aria-current="step"><span>2</span>提交客户资料</li></ol><section class="initial-analysis-card" aria-label="本项目首轮资料"><div class="project-start-context"><small>本次资料所属项目</small><strong>${esc(project.title)}</strong><span>${esc(project.company)}</span></div>${request ? `<div class="initial-analysis-status" role="status"><small>等待安排 · 演示</small><h2>首轮分析请求已接收</h2><p>等待服务器安排分析。原型没有调用 Runner，暂无客户分析报告。</p></div>${projectStartFile(request.file, false)}${request.note ? `<details class="project-start-submitted-note"><summary>提交时的补充说明</summary><p>${esc(request.note)}</p></details>` : ''}<p class="initial-analysis-limits">可以返回工作台处理其他项目；这份资料和提交记录保留在本项目中。</p><div class="initial-analysis-progress-actions"><a href="#board">返回工作台 →</a></div>` : `<div class="initial-analysis-upload-zone"><span class="initial-analysis-upload-symbol" aria-hidden="true">↑</span><h2>把客户现有体系文件放进一个 ZIP</h2><p>包内可包含多份 DOCX 和 Markdown，无需先逐份匹配模板。</p><button data-project-start-action="choose">${project.intake.file ? '更换 ZIP 包' : '选择 ZIP 包'}</button><input id="projectStartZip" class="initial-analysis-file-input" type="file" accept=".zip,application/zip" aria-label="选择客户 ZIP 包"><small>首轮一次提交一个 ZIP；分析后再按缺口补充资料。</small></div>${project.intake.file ? projectStartFile(project.intake.file, true) : ''}<label class="initial-analysis-note" for="projectStartNote">补充说明 <span>选填</span><textarea id="projectStartNote" rows="2" placeholder="例如：请保留企业现行组织与流程。">${esc(project.intake.note)}</textarea></label><div class="initial-analysis-preset"><span>本次分析</span><p>读取客户文件 → 对照公司预设模板 → 返回资料缺口与升级计划</p></div><div class="initial-analysis-submit"><p id="projectStartNotice" role="status">${esc(projectStartError || '项目已明确；提交分析不会直接生成或修改文件。')}</p><button class="primary" id="projectStartSubmitZip" data-project-start-action="submit" ${project.intake.file && !projectStartError ? '' : 'disabled'}>提交并分析</button></div>`}</section>${!request ? '<div class="initial-analysis-example"><span>体验固定匿名场景</span><button data-project-start-action="example">带入演示 ZIP 包</button><small>只演示本项目接收回执，不生成分析结论。</small></div>' : ''}<p class="project-start-demo-note">交互原型 · 未上传、解包或分析文件；正式项目初始化与 Runner 接入待完成。</p></div></section>`;
}
function projectStartRoute() {
  if (location.hash === '#new-project') return projectStartForm();
  if (!location.hash.startsWith('#project-intake/')) return null;
  const project = projectStartCurrent();
  return project ? projectStartIntake(project) : '<section class="initial-analysis-shell"><a class="initial-analysis-back" href="#board">← 返回工作台</a><div class="initial-analysis-card"><h1>暂时无法打开这个项目</h1><p>当前标签页没有可恢复的对应演示记录。请从工作台选择项目。</p></div></section>';
}
function projectStartBoardTasks() {
  return projectStartState.projects.map(project => ({
    id: `onboarding-${project.id}`, project: project.id, projectLabel: `${project.company} · ${project.title}`, projectStartId: project.id,
    title: project.intake.request ? '首轮客户资料分析' : '提交首轮客户资料',
    desc: project.intake.request ? `${project.intake.request.file.name} · 分析请求已接收（演示），等待服务器安排。` : project.intake.file ? `${project.intake.file.name} 已选择，尚未提交。` : '项目已建立（演示）；提交客户现行文件 ZIP，开始首轮分析。',
    group: project.intake.request ? 'waiting' : 'attention', badge: project.intake.request ? '查看提交记录' : '提交客户资料'
  }));
}
function projectStartFilterOptions() { return projectStartState.projects.map(project => `<option value="${project.id}" ${state.filter === project.id ? 'selected' : ''}>${esc(project.company)} · ${esc(project.title)}</option>`).join(''); }
function projectStartEntry() {
  const project = projectStartState.projects.find(item => item.id === state.filter);
  return `<button data-project-start-action="new">新建项目</button>${project ? `<button class="primary initial-analysis-open-button" data-project-start-id="${project.id}">${project.intake.request ? '查看资料分析' : '提交客户资料'}</button>` : '<button class="primary initial-analysis-open-button" data-initial-analysis="open">提交客户资料</button>'}`;
}
function projectStartSubmitZip(project) {
  if (project.intake.request || !project.intake.file || projectStartError) return;
  if (!project.intake.file.example) { projectStartNotice('本地 ZIP 的文件名已保留。原型未上传或分析它；可带入演示 ZIP 体验提交回执。'); return; }
  const request = { id: `demo-intake-${crypto.randomUUID()}`, projectId: project.id, file: { ...project.intake.file }, note: project.intake.note, submittedAt: Date.now() };
  project.intake.request = request;
  if (!projectStartPersist()) { project.intake.request = null; projectStartNotice(projectStartError); return; }
  render(); document.querySelector('.initial-analysis-status')?.setAttribute('tabindex', '-1'); document.querySelector('.initial-analysis-status')?.focus();
}
document.addEventListener('submit', event => {
  if (location.hash !== '#new-project' || event.target.id !== 'projectStartForm') return;
  event.preventDefault(); projectStartCreate();
});
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.projectStartClientId) { projectStartClientSelect(button.dataset.projectStartClientId); return; }
  if (button.dataset.projectStartClient) { projectStartClientMode(button.dataset.projectStartClient); return; }
  if (button.dataset.projectStartId) { projectStartOpen(button.dataset.projectStartId); return; }
  if (button.dataset.projectStartAction === 'new') { projectStartNew(); return; }
  const project = projectStartCurrent();
  if (!project || project.intake.request) return;
  const action = button.dataset.projectStartAction;
  if (action === 'choose') { projectStartPickerTarget = project.id; document.getElementById('projectStartZip').click(); }
  if (action === 'submit') projectStartSubmitZip(project);
  if (action === 'example' || action === 'remove') {
    const previous = project.intake.file;
    project.intake.file = action === 'example' ? { ...projectStartZip } : null;
    if (!projectStartPersist()) { project.intake.file = previous; projectStartNotice(projectStartError); return; }
    render(); document.querySelector(action === 'example' ? '#projectStartSubmitZip' : '[data-project-start-action="choose"]')?.focus();
  }
});
document.addEventListener('input', event => {
  if (location.hash === '#new-project' && ['projectStartCompany', 'projectStartTitle'].includes(event.target.id)) {
    const companyInput = event.target.id === 'projectStartCompany';
    projectStartState.draft[companyInput ? 'company' : 'title'] = event.target.value;
    if (companyInput) { projectStartState.draft.clientId = null; projectStartClientOpen = projectStartState.draft.clientMode === 'search'; projectStartClientActive = -1; }
    projectStartPersist(); projectStartNotice(projectStartError || '创建后直接进入本项目的 ZIP 提交页。');
    if (companyInput && !event.isComposing) projectStartClientRefresh();
  }
  const project = projectStartCurrent();
  if (project && !project.intake.request && event.target.id === 'projectStartNote') { project.intake.note = event.target.value; projectStartPersist(); projectStartNotice(projectStartError || '补充说明已在本标签页保留（演示），尚未提交。'); }
});
document.addEventListener('change', event => {
  if (event.target.id !== 'projectStartZip') return;
  const targetId = projectStartPickerTarget; projectStartPickerTarget = null;
  const project = projectStartCurrent();
  if (!project || project.id !== targetId || project.intake.request || projectStartError) return;
  const file = event.target.files?.[0];
  if (!file) return;
  if (!/\.zip$/i.test(file.name) || file.size === 0) { projectStartNotice('请选择非空 ZIP 文件；原先的选择已保留。'); event.target.value = ''; return; }
  const previous = project.intake.file;
  project.intake.file = { name: file.name, example: false };
  if (!projectStartPersist()) { project.intake.file = previous; projectStartNotice(projectStartError); return; }
  render(); document.getElementById('projectStartSubmitZip')?.focus();
});
Object.assign(window, { projectStartRoute, projectStartBoardTasks, projectStartFilterOptions, projectStartEntry });

document.addEventListener('focusin', event => {
  if (location.hash !== '#new-project' || projectStartState.draft.clientMode !== 'search') return;
  if (event.target.id === 'projectStartCompany') { projectStartClientOpen = true; projectStartClientRefresh(); }
  else if (!event.target.closest('.project-start-client-field,.project-start-client-help')) { projectStartClientOpen = false; projectStartClientActive = -1; projectStartClientRefresh(); }
});
document.addEventListener('keydown', event => {
  if (location.hash !== '#new-project' || event.target.id !== 'projectStartCompany' || projectStartState.draft.clientMode !== 'search' || projectStartError || event.isComposing) return;
  const matches = projectStartClientMatches();
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); projectStartClientOpen = true;
    projectStartClientActive = matches.length ? (projectStartClientActive < 0 ? (event.key === 'ArrowDown' ? 0 : matches.length - 1) : (projectStartClientActive + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length) : -1;
    projectStartClientRefresh();
  }
  if (event.key === 'Enter' && (projectStartClientOpen || !projectStartState.draft.clientId)) {
    event.preventDefault();
    if (projectStartClientOpen && projectStartClientActive >= 0 && matches[projectStartClientActive]) projectStartClientSelect(matches[projectStartClientActive].id);
    else { projectStartClientOpen = true; projectStartClientRefresh(); projectStartNotice('请选择已有客户，或点击“新建客户”。'); }
  }
  if (event.key === 'Escape') { event.preventDefault(); projectStartClientOpen = false; projectStartClientActive = -1; projectStartClientRefresh(); }
});
