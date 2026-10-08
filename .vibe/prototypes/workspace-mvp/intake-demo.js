/* global $, esc, state, save, render, modal, toast */
/* global document, location, sessionStorage, crypto, window */
// Synthetic onboarding flow. Only fixed examples have matching suggestions.
// Real files remain local names; they are neither read nor uploaded.
function intakeResetDemo() { intakeState = { project: '青禾制造', projects: {} }; intakeSave(); }
const intakeKey = 'zhiju-intake-demo-v1';
const intakeProjects = ['青禾制造', '远山科技'];
const intakeChecklist = [
  { id: 'company', title: '企业与体系概况', chapter: '项目基础', help: '企业名称、产品范围及本次体系建设目标。' },
  { id: 'roles', title: '采购职责与分工', chapter: '7.4 采购', help: '谁提出申请、谁审核、谁批准，以及实际分工。' },
  { id: 'process', title: '现有采购流程', chapter: '7.4 采购', help: '从申请、供方选择到采购执行的现行做法。' },
  { id: 'suppliers', title: '合格供方名录', chapter: '7.4 采购', help: '已有供方清单及分类；一份资料可以支持多项清单。' },
  { id: 'evaluation', title: '供方评价记录', chapter: '7.4 采购', help: '初次评价、年度再评价或已有评价记录。' },
  { id: 'requests', title: '已有采购申请记录', chapter: '7.4 采购', help: '客户已经填写的采购申请记录；不能以空白模板代替。' },
  { id: 'requirements', title: '采购物料要求', chapter: '7.4 采购', help: '规格、数量、验收或其他适用的采购要求。' },
  { id: 'research', title: '研发样品采购说明', chapter: '7.4 采购', help: '是否涉及研发样品采购，以及相应的采购流程。' }
];
const intakeSampleGoal = '依据本轮采购资料，核对采购控制程序、供应商评价记录和采购申请单，保留客户签批栏。';
const intakeOutputs = ['采购控制程序', '供应商评价记录', '采购申请单'];
function intakeEmptyProject() {
  return { files: [], selected: 'unmatched', stage: 'upload', confirmed: false, filter: 'all', goal: '', sourceIds: null, scope: null, receipt: null, notApplicable: {}, notices: [] };
}
let intakeState;
try { intakeState = JSON.parse(sessionStorage.getItem(intakeKey)); } catch { /* Use a new demo state. */ }
if (!intakeState || !intakeState.projects) intakeState = { project: '青禾制造', projects: {} };
function intakeFocus(selector) { document.querySelector(selector)?.focus({ preventScroll: true }); }
function intakeSave() { sessionStorage.setItem(intakeKey, JSON.stringify(intakeState)); }
function intakeProject() {
  if (!intakeProjects.includes(intakeState.project)) return null;
  return intakeState.projects[intakeState.project] ||= intakeEmptyProject();
}
function intakeSamples() {
  const company = intakeState.project;
  return [
    { id: 'example-company', name: '企业与体系概况.md', items: ['company'], excerpt: `# 企业与体系概况\n\n${company} · 合成演示客户\n本轮目标：梳理采购管理文件。\n本段仅供交互演示，不构成客户事实。` },
    { id: 'example-process', name: '采购职责与现行流程.md', items: ['roles', 'process'], excerpt: '# 采购职责与现行流程\n\n使用部门提出采购需求，采购部门组织供方选择和执行。\n具体审核职责仍需根据项目资料核对。\n同一份资料在演示中同时对应职责和流程两项。' },
    { id: 'example-suppliers', name: '合格供方名录摘录.md', items: ['suppliers'], excerpt: '# 合格供方名录摘录\n\n| 供方 | 物料类别 |\n| --- | --- |\n| 演示供方甲 | 外购部件 |\n\n全部内容为合成示例。' },
    { id: 'example-evaluation', name: '年度供方评价摘录.md', items: ['evaluation'], excerpt: '# 年度供方评价摘录\n\n本示例演示一份已有记录如何对应资料清单。\n不包含真实客户评价、签字或批准事实。' },
    { id: 'example-other', name: '补充说明.md', items: [], excerpt: '# 补充说明\n\n演示物料要求：采购时核对物料规格、所需数量和验收要求。\n请人工核对这份资料应对应哪一项。' }
  ].map(file => ({ ...file, sample: true }));
}
function intakeItemFiles(project, id) { return project.files.filter(file => file.items.includes(id)); }
function intakeCounts(project) {
  const present = intakeChecklist.filter(item => intakeItemFiles(project, item.id).length).length;
  const excluded = intakeChecklist.filter(item => project.notApplicable[item.id] && !intakeItemFiles(project, item.id).length).length;
  return { present, excluded, missing: intakeChecklist.length - present - excluded, unmatched: project.files.filter(file => !file.items.length).length };
}
function intakeBack() { return '<a class="intake-back" href="#board">← 工作台</a>'; }
function intakeProjectPicker(title, route) {
  return `<div class="intake-shell intake-small">${intakeBack()}<div class="intake-heading"><div class="eyebrow">开始之前</div><h1>${title}</h1><p>先明确项目，再提交目标与资料。</p></div><section class="intake-panel intake-pick"><label for="intakeProjectSelect">所属项目</label><select id="intakeProjectSelect" data-route="${route}"><option value="">请选择项目</option>${intakeProjects.map(name => `<option>${name}</option>`).join('')}</select><p class="small muted">仅展示本原型中的两个演示项目。</p></section></div>`;
}
function intakeHeader(title, subtitle, step) {
  return `${intakeBack()}<div class="intake-heading"><div><div class="eyebrow">${esc(intakeState.project)} / 首轮资料梳理</div><h1>${title}</h1><p>${subtitle}</p></div><ol class="intake-steps" aria-label="资料梳理进度">${['提交资料', '核对清单', '进入项目'].map((name, i) => `<li ${i === step ? 'aria-current="step"' : ''}><span>${i < step ? '✓' : i + 1}</span>${name}</li>`).join('')}</ol></div>`;
}
function intakeFileInput() { return '<input id="intakeFiles" class="intake-file-input" type="file" accept=".md,.markdown,text/markdown" multiple tabindex="-1" aria-label="选择 Markdown 资料">'; }
function intakeUpload(project) {
  return `<div class="intake-shell">${intakeHeader('先把现有资料放进来', '一次提交多份 Markdown，随后集中核对清单对应关系。', 0)}<div class="intake-upload-layout"><section class="intake-panel intake-upload"><span class="intake-upload-icon" aria-hidden="true">↑</span><h2>集中提交，无需逐项添加</h2><p>服务器将建议对应的资料清单项，<br>由你核对后确认。</p><button class="primary" data-intake="choose">选择 Markdown 资料</button>${intakeFileInput()}<button data-intake="no-files">暂未收到资料，先核对清单</button><span class="small muted">本原型仅保留文件名，不上传、不解析文件正文。</span><div class="intake-example"><span>先体验完整流程</span><button data-intake="example">载入 5 份演示资料 →</button><small>固定示例包含多项对应、暂缺资料和一份待归类文件。</small></div>${project.notices.length ? `<p class="intake-warning" role="status">${esc(project.notices.join('；'))}</p>` : ''}</section><aside class="intake-panel intake-outline"><h2>这次先梳理什么</h2><p class="small muted">采购场景示意清单 · 8 项<br>正式清单由公司预设</p>${intakeChecklist.map((item, i) => `<div><span>${String(i + 1).padStart(2, '0')}</span>${item.title}</div>`).join('')}<p class="intake-note">不要求资料全部齐全。暂缺项保留，后续按工作需要补充。</p></aside></div></div>`;
}
function intakeStatus(project, item) {
  if (intakeItemFiles(project, item.id).length) return ['green', '有资料'];
  if (project.notApplicable[item.id]) return ['', '不适用'];
  return ['amber', '暂缺'];
}
function intakePreview(file, open = false) {
  return `<details class="intake-source" ${open ? 'open' : ''}><summary><span>${esc(file.name)}</span><small>${file.sample ? '演示资料' : '本地文件名'}</small></summary><pre>${esc(file.excerpt || '本原型没有读取或上传此文件正文。可以手动体验对应关系，正式内容核验尚未进行。')}</pre></details>`;
}
function intakeDetail(project) {
  if (project.selected === 'unmatched') {
    const files = project.files.filter(file => !file.items.length);
    return `<div class="intake-detail-head"><span class="eyebrow">需要你判断</span><h2>未归类的资料 <span class="muted">${files.length}</span></h2><p>这些资料暂未计入“有资料”。可以现在指定对应项，也可以保留待后续梳理。</p></div>${files.map(file => `<article class="intake-unmatched">${intakePreview(file, true)}<button data-intake="file-map" data-id="${file.id}">指定对应清单项</button></article>`).join('') || '<div class="intake-clear"><strong>已无未归类资料</strong><p>可继续核对左侧清单，或确认本轮梳理结果。</p></div>'}`;
  }
  const item = intakeChecklist.find(row => row.id === project.selected) || intakeChecklist[0];
  const files = intakeItemFiles(project, item.id);
  const [color, status] = intakeStatus(project, item);
  return `<div class="intake-detail-head"><div class="row between"><span class="eyebrow">${item.chapter}</span><span class="tag ${color}">${status}</span></div><h2>${item.title}</h2><p>${item.help}</p></div><div class="row between intake-detail-toolbar"><strong>对应资料 · ${files.length} 份</strong><button data-intake="item-map" data-id="${item.id}">${files.length ? '调整对应关系' : '关联已有资料'}</button></div>${files.map(file => intakePreview(file, files.length === 1)).join('') || `<div class="intake-clear"><strong>${project.notApplicable[item.id] ? '按已确认范围标记不适用' : '当前暂未收到对应资料'}</strong><p>${project.notApplicable[item.id] ? esc(project.notApplicable[item.id]) : '暂缺不会被解释为客户没有，也不妨碍完成本轮梳理。'}</p></div>`}<div class="intake-item-foot"><p class="small muted">${files.length ? '匹配建议仍需核对；一份资料可对应多个清单项。' : '“不适用”需要已确认的范围依据。'}</p>${project.notApplicable[item.id] ? `<button data-intake="restore-applicability" data-id="${item.id}">恢复为暂缺</button>` : !files.length ? `<button data-intake="applicability" data-id="${item.id}">查看不适用依据</button>` : ''}</div>`;
}
function intakeReview(project) {
  const counts = intakeCounts(project);
  const visibleItems = intakeChecklist.filter(item => project.filter !== 'missing' || (!intakeItemFiles(project, item.id).length && !project.notApplicable[item.id]));
  return `<div class="intake-shell intake-review-shell">${intakeHeader('核对资料清单', '先看未归类和暂缺项，再统一确认本轮梳理。', 1)}<div class="intake-summary"><span><b>${intakeChecklist.length}</b> 项清单</span><span class="intake-positive"><b>${counts.present}</b> 项有资料</span><span><b>${counts.missing}</b> 项暂缺</span>${counts.excluded ? `<span><b>${counts.excluded}</b> 项不适用</span>` : ''}<button data-intake="select" data-id="unmatched" class="${counts.unmatched ? 'intake-attention' : ''}">${counts.unmatched} 份未归类</button><button data-intake="choose">添加资料</button>${intakeFileInput()}</div>${project.notices.length ? `<p class="intake-warning" role="status">${esc(project.notices.join('；'))}</p>` : ''}<div class="intake-review-grid"><nav class="intake-list" aria-label="公司资料清单"><div class="intake-list-tools"><strong>公司预设清单</strong><select id="intakeListFilter" aria-label="筛选资料清单"><option value="all">全部 ${intakeChecklist.length} 项</option><option value="missing" ${project.filter === 'missing' ? 'selected' : ''}>暂缺 ${counts.missing} 项</option></select></div>${visibleItems.map(item => { const [color, status] = intakeStatus(project, item); return `<button data-intake="select" data-id="${item.id}" class="intake-list-item ${project.selected === item.id ? 'active' : ''}" aria-current="${project.selected === item.id ? 'true' : 'false'}"><span>${item.title}</span><span class="tag ${color}">${status}</span></button>`; }).join('') || '<p class="intake-note">没有暂缺项。</p>'}<p class="intake-note">这是采购场景示意清单。资料不齐也可以完成本轮梳理。</p></nav><section class="intake-detail" aria-label="当前资料与对应关系" tabindex="0">${intakeDetail(project)}</section></div><footer class="intake-footer"><p><strong>${project.confirmed ? '已确认过的清单可继续补充' : '确认本轮梳理结果'}</strong><span>${counts.missing} 项暂缺${counts.unmatched ? `，${counts.unmatched} 份未归类将保留待处理` : ''}。确认后进入项目，尚不生成或修改成果。</span></p><button class="primary" data-intake="confirm-materials">确认梳理并进入项目 →</button></footer></div>`;
}
function intakeSources(project) {
  if (project.sourceIds === null) project.sourceIds = project.files.filter(file => file.items.length).map(file => file.id);
  return project.files.filter(file => project.sourceIds.includes(file.id));
}
function intakeNewWork(project) {
  if (!project.confirmed) return `<div class="intake-shell intake-small">${intakeBack()}<div class="intake-heading"><div class="eyebrow">${esc(intakeState.project)}</div><h1>先完成首轮资料梳理</h1><p>梳理已收到的资料和缺口后，再发起这项工作；不要求全部齐全。</p></div><button class="primary" data-intake="materials">去梳理资料 →</button></div>`;
  const sources = intakeSources(project);
  return `<div class="intake-shell intake-small">${intakeBack()}<div class="intake-heading"><div><div class="eyebrow">${esc(intakeState.project)} / 发起工作</div><h1>这次希望完成什么？</h1><p>把目标说清楚，服务器整理范围后交给你确认。</p></div></div><section class="intake-panel intake-request"><div class="row between"><label for="intakeGoal">工作目标</label><button data-intake="sample-goal">填入采购演示目标</button></div><textarea id="intakeGoal" placeholder="描述希望完成的工作，以及需要保留或注意的内容。">${esc(project.goal)}</textarea><div class="row between intake-source-heading"><strong>使用资料 · ${sources.length} 份</strong><button data-intake="work-sources">选择资料</button></div><div class="intake-source-list">${sources.map(file => `<span>${esc(file.name)}</span>`).join('') || '<span>尚未选择资料</span>'}</div><p class="small muted">来自本轮已确认的资料清单。<a href="#materials">补充项目资料</a></p><div class="intake-request-bottom"><p class="small muted">下一步只整理范围，确认后才开始生成或修改文件。</p><button class="primary" data-intake="prepare-scope" ${!project.goal.trim() || !sources.length ? 'disabled' : ''}>整理工作范围 →</button></div></section><p class="intake-note">交互演示仅支持固定采购目标；自由输入会保留，但不会模拟理解其他需求。</p></div>`;
}
function intakeScope(project, receipt = false) {
  const scope = receipt ? project.receipt : project.scope;
  if (!scope) return intakeNewWork(project);
  return `<div class="intake-shell intake-small">${intakeBack()}<div class="intake-heading"><div><div class="eyebrow">${esc(intakeState.project)} / ${receipt ? '工作已提交' : '核对后开始'}</div><h1>${receipt ? '已接收，等待执行' : '确认这一次的工作范围'}</h1><p>${receipt ? '这是演示接收回执，尚未开始修改文件。' : '目标、资料和涉及的文件集中在这里，只确认一次。'}</p></div></div><section class="intake-panel intake-scope-card"><div class="intake-scope-line"><span>所属项目</span><strong>${esc(scope.project)}</strong></div><div class="intake-scope-line"><span>工作目标</span><p>${esc(scope.goal)}</p></div><div class="intake-scope-line"><span>使用资料 · ${scope.files.length} 份</span><div class="intake-source-list">${scope.files.map(file => `<span>${esc(file.name)}</span>`).join('')}</div></div><div class="intake-scope-line"><span>预计涉及 · ${scope.outputs.length} 份成果</span><ul class="intake-output-list">${scope.outputs.map(name => `<li><span>${name}</span><span class="tag">核对并提出新候选</span></li>`).join('')}</ul></div><div class="intake-scope-note">示例保留客户签批栏，不代替客户签字。扩大到其他文件时，仍需另行确认范围。</div><div class="intake-scope-actions">${receipt ? '<a href="#board" class="intake-button primary">返回工作台 →</a>' : '<button data-intake="edit-request">返回调整</button><button class="primary" data-intake="confirm-work">确认并开始</button>'}</div></section><p class="intake-note">范围卡与接收结果均为固定演示，没有业务服务或 Agent 执行。</p></div>`;
}
function intakeRoute() {
  const routes = ['#materials', '#new-work', '#scope', '#request-receipt'];
  if (!routes.includes(location.hash)) return null;
  const project = intakeProject();
  if (!project) return intakeProjectPicker(location.hash === '#materials' ? '梳理哪个项目的资料？' : '为哪个项目发起工作？', location.hash);
  if (location.hash === '#materials') return project.stage === 'upload' ? intakeUpload(project) : intakeReview(project);
  if (location.hash === '#scope') return intakeScope(project);
  if (location.hash === '#request-receipt') return intakeScope(project, true);
  return intakeNewWork(project);
}
function intakeBoardExtras() {
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  const actions = document.createElement('div');
  actions.className = 'intake-board-actions';
  actions.innerHTML = '<button data-intake="board-work">发起其他工作</button>';
  document.querySelector('.simple-board-more>div')?.append(actions);
  for (const name of intakeProjects) {
    const project = intakeState.projects[name];
    if (!project?.receipt || (state.filter !== '全部项目' && state.filter !== name)) continue;
    const column = document.querySelector('.column.waiting');
    column.insertAdjacentHTML('beforeend', `<button class="card" data-intake="receipt" data-project="${esc(name)}"><small class="muted">${esc(name)}</small><strong>采购成果核对</strong><p>工作范围已确认 · ${project.receipt.outputs.length} 份文件</p><span class="tag">已接收 · 等待执行（演示）</span></button>`);
    column.querySelector('.coltitle span').textContent = column.querySelectorAll('.card').length;
    column.querySelector('.empty')?.remove();
  }
}
function intakeNavigate(hash) {
  intakeSave();
  if (location.hash === hash) render(); else location.hash = hash;
}
function intakeMapping(kind, id) {
  const project = intakeProject();
  if (kind === 'file') {
    const file = project.files.find(row => row.id === id);
    modal('对应哪些清单项', `<p>${esc(file.name)} · 可以选择多项。</p><div class="intake-check-options">${intakeChecklist.map(item => `<label><input type="checkbox" value="${item.id}" ${file.items.includes(item.id) ? 'checked' : ''}>${item.title}</label>`).join('')}</div>`, `<button class="primary" data-intake="save-file-map" data-id="${id}">保存对应关系</button>`);
  } else {
    const item = intakeChecklist.find(row => row.id === id);
    modal('关联已有资料', `<p>${item.title} · 同一份资料可供多个清单项使用。</p><div class="intake-check-options">${project.files.map(file => `<label><input type="checkbox" value="${file.id}" ${file.items.includes(id) ? 'checked' : ''}>${esc(file.name)}</label>`).join('')}</div>`, `<button class="primary" data-intake="save-item-map" data-id="${id}">保存对应关系</button>`);
  }
}
function intakeInvalidate(project) {
  project.confirmed = false;
  project.scope = null;
  // A prior immutable receipt still represents only its confirmed input snapshot.
  project.sourceIds = null;
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-intake]');
  if (!button) return;
  const action = button.dataset.intake;
  if (action.startsWith('board-')) {
    intakeState.project = state.filter === '全部项目' ? '' : state.filter;
    intakeNavigate(action === 'board-work' ? '#new-work' : '#materials'); return;
  }
  if (action === 'receipt') { intakeState.project = button.dataset.project; intakeNavigate('#request-receipt'); return; }
  const project = intakeProject();
  if (!project) return;
  if (action === 'choose') { document.getElementById('intakeFiles').click(); return; }
  if (action === 'no-files') { project.stage = 'review'; project.selected = 'company'; intakeSave(); render(); return; }
  if (action === 'example') {
    project.files = intakeSamples(); project.stage = 'review'; project.selected = 'unmatched'; project.notices = [];
    intakeInvalidate(project); intakeSave(); render(); return;
  }
  if (action === 'select') { project.selected = button.dataset.id; intakeSave(); render(); const selected = [...document.querySelectorAll('[data-intake="select"]')].find(node => node.dataset.id === project.selected); selected?.focus({ preventScroll: true }); selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
  if (action === 'file-map' || action === 'item-map') { intakeMapping(action === 'file-map' ? 'file' : 'item', button.dataset.id); return; }
  if (action === 'save-file-map' || action === 'save-item-map') {
    const values = [...document.querySelectorAll('.intake-check-options input:checked')].map(input => input.value);
    if (action === 'save-file-map') project.files.find(file => file.id === button.dataset.id).items = values;
    else for (const file of project.files) file.items = values.includes(file.id) ? [...new Set([...file.items, button.dataset.id])] : file.items.filter(id => id !== button.dataset.id);
    for (const item of intakeChecklist) if (intakeItemFiles(project, item.id).length) delete project.notApplicable[item.id];
    intakeInvalidate(project); $('#dialog').close(); intakeSave(); render(); intakeFocus('.intake-detail'); toast('已调整对应关系，请核对后统一确认'); return;
  }
  if (action === 'applicability') {
    if (button.dataset.id !== 'research') { modal('不适用需要确认依据', '<p>这个演示项目没有该项的已确认不适用依据。当前保持暂缺，不将缺少资料自动判断为不适用。</p>', ''); return; }
    modal('核对不适用依据', '<p><strong>仅演示已取得确认的情况</strong></p><p>项目范围确认记录：本次演示项目不涉及独立研发样品采购。</p><p>这是一条合成的既有确认依据，并非根据文件缺失作出的判断。</p>', '<button class="primary" data-intake="confirm-applicability">按此演示依据标记不适用</button>'); return;
  }
  if (action === 'confirm-applicability') { project.notApplicable.research = '依据：项目范围确认记录（合成演示），本轮不涉及独立研发样品采购。'; intakeInvalidate(project); $('#dialog').close(); intakeSave(); render(); intakeFocus('.intake-detail'); return; }
  if (action === 'restore-applicability') { delete project.notApplicable[button.dataset.id]; intakeInvalidate(project); intakeSave(); render(); intakeFocus('.intake-detail'); return; }
  if (action === 'confirm-materials') {
    project.confirmed = true; state.filter = intakeState.project; save(); intakeNavigate('#board'); toast('本轮资料梳理已确认（演示），暂缺项继续保留'); return;
  }
  if (action === 'materials') { intakeNavigate('#materials'); return; }
  if (action === 'sample-goal') { project.goal = intakeSampleGoal; project.scope = null; intakeSave(); render(); $('#intakeGoal').focus(); return; }
  if (action === 'work-sources') {
    intakeSources(project);
    modal('选择本次使用的资料', '<p>只选择本次工作需要使用的资料。</p><div class="intake-check-options">' + project.files.filter(file => file.items.length).map(file => `<label><input type="checkbox" value="${file.id}" ${project.sourceIds.includes(file.id) ? 'checked' : ''}>${esc(file.name)}</label>`).join('') + '</div>', '<button class="primary" data-intake="save-work-sources">使用所选资料</button>'); return;
  }
  if (action === 'save-work-sources') { project.sourceIds = [...document.querySelectorAll('.intake-check-options input:checked')].map(input => input.value); project.scope = null; $('#dialog').close(); intakeSave(); render(); intakeFocus('[data-intake="work-sources"]'); return; }
  if (action === 'prepare-scope') {
    if (!project.confirmed || !intakeSources(project).length || !project.goal.trim()) return;
    if (project.goal.trim() !== intakeSampleGoal) { toast('目标已保留；本原型仅演示固定采购目标，请使用示例体验范围确认'); return; }
    project.scope = { project: intakeState.project, goal: project.goal, files: intakeSources(project).map(file => ({ id: file.id, name: file.name })), outputs: [...intakeOutputs] };
    intakeNavigate('#scope'); return;
  }
  if (action === 'edit-request') { intakeNavigate('#new-work'); return; }
  if (action === 'confirm-work') {
    if (!project.confirmed || !project.scope) return;
    project.receipt = JSON.parse(JSON.stringify(project.scope)); project.scope = null; state.filter = intakeState.project; save(); intakeNavigate('#request-receipt'); return;
  }
});
document.addEventListener('change', event => {
  if (event.target.id === 'intakeProjectSelect') { intakeState.project = event.target.value; intakeSave(); render(); return; }
  const project = intakeProject();
  if (!project) return;
  if (event.target.id === 'intakeListFilter') { project.filter = event.target.value; intakeSave(); render(); intakeFocus('#intakeListFilter'); return; }
  if (event.target.id !== 'intakeFiles') return;
  const files = [...event.target.files];
  if (!files.length) return;
  const unsupported = files.filter(file => !/\.(md|markdown)$/i.test(file.name));
  const supported = files.filter(file => /\.(md|markdown)$/i.test(file.name));
  project.notices = unsupported.length ? [`${unsupported.length} 份非 Markdown 文件未接纳；请在外部转换后提交。`] : [];
  for (const file of supported) project.files.push({ id: crypto.randomUUID(), name: file.name, items: [], sample: false });
  if (supported.length) { project.stage = 'review'; project.selected = 'unmatched'; intakeInvalidate(project); project.notices.push('文件名仅保存在本标签页；未上传、未解析。请选择对应项体验人工核对。'); }
  intakeSave(); render();
});
document.addEventListener('input', event => {
  if (event.target.id !== 'intakeGoal') return;
  const project = intakeProject(); project.goal = event.target.value; project.scope = null; intakeSave();
  document.querySelector('[data-intake="prepare-scope"]').disabled = !project.goal.trim() || !intakeSources(project).length;
});

Object.assign(window, { intakeResetDemo, intakeRoute, intakeBoardExtras, intakeSave });
