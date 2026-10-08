/* global esc, render, modal, toast, deliveryHash, deliveryZip, deliveryTime */
/* global executionDeliveryFiles, executionCandidateMarkdown */
/* global document, window, location, sessionStorage, crypto, URL, setTimeout */
// Tab-local export fixtures only. Qualification is an explicit simulated service receipt.
const projectDeliveryKey = 'zhiju-project-delivery-demo-v1';
const projectDeliveryInitial = () => ({ section: 'prepare', example: false, selections: { project: [], example: [] }, qualifications: {}, packages: [], current: null, filter: 'ready', query: '' });
let projectDeliveryState;
try { projectDeliveryState = JSON.parse(sessionStorage.getItem(projectDeliveryKey)); } catch { /* Optional tab-local state. */ }
if (!projectDeliveryState?.selections || !Array.isArray(projectDeliveryState.packages)) projectDeliveryState = projectDeliveryInitial();
let projectDeliveryBusy = false;
let projectDeliveryOperation = 0;
let projectDeliveryNotice = '';
let projectDeliveryConfirmation = null;
function projectDeliverySave() { sessionStorage.setItem(projectDeliveryKey, JSON.stringify(projectDeliveryState)); }
function projectDeliveryReset() {
  projectDeliveryOperation++; projectDeliveryBusy = false; projectDeliveryConfirmation = null; projectDeliveryNotice = '';
  projectDeliveryState = projectDeliveryInitial(); projectDeliverySave();
}
const projectDeliveryChapters = { 'F-MANUAL': ['4.2', '文件要求'], 'F-CORR': ['8.5', '改进'], 'F-PREV': ['8.5', '改进'] };
function projectDeliveryExample() {
  return [
    { id: 'F-MANUAL', title: '质量手册', code: 'QM-01', roundId: 'EXAMPLE-2', roundNumber: 2, reportLabel: '补齐组织图后的报告', revision: 1, approvedRevision: 1, status: 'approved' },
    { id: 'F-CORR', title: '纠正措施控制程序', code: 'QP-22', roundId: 'EXAMPLE-1', roundNumber: 1, reportLabel: '首轮报告', revision: 1, approvedRevision: 1, status: 'approved' },
    { id: 'F-PREV', title: '预防措施控制程序', code: 'QP-23', roundId: 'EXAMPLE-1', roundNumber: 1, reportLabel: '首轮报告', revision: 2, approvedRevision: 1, status: 'review' }
  ].map(file => ({ ...file, name: file.title, key: `${file.roundId}:${file.id}:${file.revision}`, reportKey: `fixed-example:${file.roundId}`, content: executionCandidateMarkdown(file, file.revision) }));
}
function projectDeliverySources() {
  return (projectDeliveryState.example ? projectDeliveryExample() : executionDeliveryFiles()).map(file => {
    const chapter = projectDeliveryChapters[file.id] || ['未归类', '等待章节对应'];
    const qualification = projectDeliveryState.example && ['F-CORR', 'F-MANUAL'].includes(file.id)
      ? { state: 'ready', reportKey: file.reportKey, content: file.content, reason: '固定演示服务结果：本版本配套与适用发布条件通过。' }
      : projectDeliveryState.qualifications[file.key];
    let reason = '交付条件尚未核验：已批准版本仍需服务器确认配套与适用发布条件。';
    if (file.status !== 'approved' || file.approvedRevision !== file.revision) reason = ({ queued: '等待服务器安排处理，尚无获批成果。', processing: '文件仍在处理，等待新候选交回并逐份批准。', review: `候选第 ${file.revision} 版尚未批准，请先完成文件检查。`, failed: '本次处理失败，需先处理失败原因并取得可批准的候选。' })[file.status] || '尚无可交付的获批版本。';
    const qualified = qualification?.reportKey === file.reportKey && qualification.content === file.content;
    const ready = Boolean(file.status === 'approved' && file.approvedRevision === file.revision && file.content && qualified && qualification.state === 'ready');
    if (!ready && file.status === 'approved' && qualified && qualification.state === 'blocked') reason = qualification.reason;
    if (!projectDeliveryChapters[file.id]) reason = '尚未取得体系章节对应及交付资格结果。';
    const batches = projectDeliveryState.packages.filter(pkg => pkg.example === projectDeliveryState.example && pkg.files.some(item => item.key === file.key)).map(pkg => pkg.number);
    return { ...file, chapter: chapter[0], chapterName: chapter[1], ready: ready && Boolean(projectDeliveryChapters[file.id]), reason, batches };
  }).sort((a, b) => a.chapter.localeCompare(b.chapter, 'zh-CN', { numeric: true }) || a.code.localeCompare(b.code));
}
function projectDeliverySelection() { return projectDeliveryState.selections[projectDeliveryState.example ? 'example' : 'project']; }
function projectDeliverySelected() { const selection = projectDeliverySelection(); return projectDeliverySources().filter(file => selection.includes(file.key)); }
function projectDeliveryFileRow(file, frozen = false) {
  const selected = projectDeliverySelection().includes(file.key);
  const versionLabel = file.revision ? `第 ${file.revision} 版` : '尚无候选';
  return `<article class="project-delivery-file ${!frozen && !file.ready ? 'waiting' : ''}">${frozen ? '<span class="delivery-file-icon" aria-hidden="true">MD</span>' : `<input type="checkbox" data-project-delivery-select="${esc(file.key)}" aria-label="加入本批：${esc(file.name)} · ${versionLabel}" ${selected ? 'checked' : ''} ${!file.ready || projectDeliveryBusy ? 'disabled' : ''}>`}<div class="project-delivery-file-main"><strong>${esc(file.name)}</strong><small>${esc(file.code || '编号待确认')} · Markdown · 来源第 ${file.roundNumber} 轮</small>${!frozen && file.batches.length ? `<small>本版本已加入第 ${file.batches.join('、')} 批，可按需要再次选择。</small>` : ''}${!frozen && !file.ready ? `<p class="project-delivery-reason"><strong>暂不能交付</strong>${esc(file.reason)}</p>` : ''}</div><div class="delivery-file-version"><strong>${versionLabel}</strong><small>${frozen ? '本包固定版本' : file.ready ? '可加入本批' : file.approvedRevision ? `上次批准：第 ${file.approvedRevision} 版` : '尚未批准'}</small></div><button data-project-delivery="preview" data-key="${esc(file.key)}" data-frozen="${frozen}" ${!file.content ? 'disabled' : ''} aria-label="查看 ${esc(file.name)} ${versionLabel}">查看</button></article>`;
}
function projectDeliveryListMarkup() {
  const query = projectDeliveryState.query.trim().toLocaleLowerCase('zh-CN');
  const files = projectDeliverySources().filter(file => (projectDeliveryState.filter === 'all' || (projectDeliveryState.filter === 'ready' ? file.ready : !file.ready)) && `${file.name} ${file.code} ${file.chapter} ${file.chapterName}`.toLocaleLowerCase('zh-CN').includes(query));
  const chapters = [...new Set(files.map(file => file.chapter))];
  return chapters.length ? chapters.map(chapter => {
    const group = files.filter(file => file.chapter === chapter);
    return `<section class="project-delivery-chapter"><h2><span>${esc(chapter)}</span>${esc(group[0].chapterName)}<small>${group.length} 份</small></h2>${group.map(file => projectDeliveryFileRow(file)).join('')}</section>`;
  }).join('') : '<div class="delivery-empty"><h3>当前没有符合条件的文件</h3><p>可查看“暂不能交付”，了解需要先处理的事项。</p></div>';
}
function projectDeliveryFooter() {
  const files = projectDeliverySelected();
  const rounds = new Set(files.map(file => file.roundId)).size;
  const stale = projectDeliverySelection().length !== files.length;
  const blocked = stale || files.some(file => !file.ready);
  return `<p><strong>${files.length ? `本批已选 ${files.length} 份 · 来自 ${rounds} 轮` : '尚未选择本批文件'}</strong><span>${blocked ? '已选文件的版本或交付条件已变化，请重新核对。' : '确认后固定文件与版本；新候选不会替换已有包。'}</span></p><div class="project-delivery-footer-actions">${stale ? '<button data-project-delivery="clear-stale">清除已失效的选择</button>' : ''}<button class="primary" data-project-delivery="confirm" ${files.length && !blocked && !projectDeliveryBusy ? '' : 'disabled'}>${projectDeliveryBusy ? '正在生成演示包…' : `核对本批版本${files.length ? `（${files.length}）` : ''}`}</button></div>`;
}
function projectDeliveryPrepare() {
  const files = projectDeliverySources(), ready = files.filter(file => file.ready).length;
  return `<section class="project-delivery-panel" aria-label="按体系章节选择本批文件"><div class="project-delivery-toolbar"><div role="group" aria-label="按交付条件筛选">${[['ready', '可加入本批', ready], ['waiting', '暂不能交付', files.length - ready], ['all', '全部', files.length]].map(([key, label, count]) => `<button data-project-delivery="filter" data-filter="${key}" aria-pressed="${projectDeliveryState.filter === key}">${label}<span>${count}</span></button>`).join('')}</div><label><span class="sr-only">搜索交付文件</span><input id="projectDeliverySearch" type="search" placeholder="搜索文件或章节" value="${esc(projectDeliveryState.query)}"></label></div><div class="project-delivery-file-scroll" id="projectDeliveryList" tabindex="0" aria-label="项目文件与交付条件">${projectDeliveryListMarkup()}</div><p class="project-delivery-list-foot">默认不选文件 · 跨轮次集中准备 · 章节对应为固定演示</p></section><footer class="delivery-footer" id="projectDeliveryFooter">${projectDeliveryFooter()}</footer>`;
}
function projectDeliveryHistory() {
  const pkg = projectDeliveryState.packages.find(item => item.id === projectDeliveryState.current) || projectDeliveryState.packages.at(-1);
  if (!pkg) return '<div class="delivery-no-packages"><h2>尚未生成项目交付包</h2><p>选择本批文件后，集中核对版本并确认生成。</p><button data-project-delivery="section" data-section="prepare">准备本批交付</button></div>';
  return `<div class="delivery-grid"><aside class="delivery-list" aria-label="项目交付包列表"><p class="delivery-list-title">交付包记录</p>${[...projectDeliveryState.packages].reverse().map(item => `<button class="delivery-package ${item.id === pkg.id ? 'active' : ''}" data-project-delivery="package" data-id="${item.id}" aria-pressed="${item.id === pkg.id}"><strong>第 ${item.number} 批 · ${item.files.length} 份文件</strong><small>${esc(deliveryTime(item.createdAt))}</small><span>来源 ${new Set(item.files.map(file => file.roundId)).size} 轮${item.example ? ' · 固定示例' : ''}</span></button>`).join('')}</aside><section class="delivery-detail" tabindex="0" aria-label="项目固定交付包详情"><div class="delivery-detail-heading"><div><h2>第 ${pkg.number} 批 · 版本已固定</h2><p>${esc(pkg.label)} · ${pkg.files.length} 份 Markdown 文件＋一份清单</p></div></div>${pkg.files.map(file => projectDeliveryFileRow(file, true)).join('')}<details class="delivery-records" open><summary>下载记录 · ${pkg.downloads.length}</summary>${pkg.downloads.length ? `<ol>${[...pkg.downloads].reverse().map(item => `<li><span>${esc(deliveryTime(item.at))}</span><strong>林顾问 · 已请求下载</strong></li>`).join('')}</ol>` : '<p>尚未请求下载。</p>'}<p>只记录下载请求；不代表浏览器保存完成、已发送或客户已收到。</p></details></section></div><footer class="delivery-footer"><p><strong>取得本包后，通过已有渠道发送</strong><span>后续候选与下载记录不会改变包内文件和清单。</span></p><button class="primary" data-project-delivery="download" data-id="${pkg.id}">下载演示包 .zip</button></footer>`;
}
function projectDeliveryRoute() {
  if (location.hash !== '#project-delivery') return null;
  return `<div class="intake-shell delivery-shell project-delivery-shell"><a href="#execution" class="intake-back">← 返回文件进度</a><div class="intake-heading delivery-heading"><div><div class="eyebrow">青禾制造 / 项目交付</div><h1>准备项目交付</h1><p>沿体系章节选择本批文件，不需要按执行轮次分别打包。</p></div><a href="#board">返回工作台 ↗</a></div>${projectDeliveryState.example ? '<p class="project-delivery-example" role="status"><span class="project-delivery-example-long">跨轮次固定示例：第 1 轮程序＋第 2 轮手册。当前执行记录与草稿保持原样。</span><span class="project-delivery-example-short">固定示例 · 第 1 轮程序＋第 2 轮手册</span></p>' : ''}<nav class="delivery-tabs" aria-label="项目交付视图"><button data-project-delivery="section" data-section="prepare" aria-pressed="${projectDeliveryState.section === 'prepare'}">准备本批</button><button data-project-delivery="section" data-section="history" aria-pressed="${projectDeliveryState.section === 'history'}">交付包记录 <span>${projectDeliveryState.packages.length}</span></button></nav>${projectDeliveryNotice ? `<p class="delivery-warning" role="alert">${esc(projectDeliveryNotice)}</p>` : ''}${projectDeliveryState.section === 'prepare' ? projectDeliveryPrepare() : projectDeliveryHistory()}<details class="delivery-demo-tools"><summary>演示选项与边界</summary><p>合成 Markdown、章节对应、内部批准及交付核验均为演示；未运行真实发布、授权或受控导出。正式页面的资格结果由服务器提供。已有采购演示包单独保留。</p><button data-project-delivery="example">${projectDeliveryState.example ? '返回当前项目成果' : '查看跨轮次交付示例'}</button>${!projectDeliveryState.example ? '<button data-project-delivery="qualify">模拟已批准版本的交付核验通过</button><button data-project-delivery="block">模拟配套条件待核验</button>' : ''}<a href="#delivery">旧采购交付示例 ↗</a></details></div>`;
}
function projectDeliveryRefreshList() {
  const list = document.getElementById('projectDeliveryList');
  if (list) { const scroll = list.scrollTop; list.innerHTML = projectDeliveryListMarkup(); list.scrollTop = scroll; }
  const files = projectDeliverySources();
  for (const button of document.querySelectorAll('[data-project-delivery="filter"]')) {
    const filter = button.dataset.filter;
    button.querySelector('span').textContent = files.filter(file => filter === 'all' || (filter === 'ready' ? file.ready : !file.ready)).length;
  }
  const footer = document.getElementById('projectDeliveryFooter');
  if (footer) footer.innerHTML = projectDeliveryFooter();
}
function projectDeliveryConfirm() {
  const files = projectDeliverySelected();
  if (!files.length || projectDeliverySelection().length !== files.length || files.some(file => !file.ready) || projectDeliveryBusy) return;
  projectDeliveryConfirmation = { example: projectDeliveryState.example, files: JSON.parse(JSON.stringify(files)) };
  modal('核对本批交付版本', `<p>青禾制造 · ${files.length} 份文件 · 来源 ${new Set(files.map(file => file.roundId)).size} 轮</p><div class="project-delivery-confirm-list">${files.map(file => `<p><strong>${esc(file.name)} · 第 ${file.revision} 版</strong><small>${esc(file.code)} · ${esc(file.chapter)} ${esc(file.chapterName)} · 第 ${file.roundNumber} 轮</small></p>`).join('')}</div><p class="small muted">确认后固定本批文件内容与清单，取得演示下载包。生成或下载不表示已对外发送。</p>`, '<button class="primary" data-project-delivery="generate">确认版本并生成演示包</button>');
}
function projectDeliveryConfirmationCurrent(target) {
  if (!target || target.example !== projectDeliveryState.example) return false;
  const files = projectDeliverySelected();
  return projectDeliverySelection().length === files.length && files.length === target.files.length && target.files.every(file => files.some(current => current.key === file.key && current.ready && current.reportKey === file.reportKey && current.content === file.content));
}
async function projectDeliveryGenerate() {
  const target = projectDeliveryConfirmation;
  if (projectDeliveryBusy || !projectDeliveryConfirmationCurrent(target)) { projectDeliveryNotice = '文件版本或交付条件已变化，请返回重新核对本批。'; document.getElementById('dialog').close(); render(); return; }
  const operation = ++projectDeliveryOperation;
  projectDeliveryBusy = true; projectDeliveryNotice = ''; document.getElementById('dialog').close(); render();
  try {
    const files = await Promise.all(target.files.map(async file => ({ ...file, filename: `${file.code || file.id}-${file.name}-第${file.revision}版.md`, hash: await deliveryHash(file.content) })));
    if (operation !== projectDeliveryOperation) return;
    if (!projectDeliveryConfirmationCurrent(target)) throw new Error('Changed version or qualification');
    const number = projectDeliveryState.packages.length + 1;
    const pkg = { id: crypto.randomUUID(), label: `DEMO-QH-PROJECT-${String(number).padStart(3, '0')}`, number, project: '青禾制造', createdAt: new Date().toISOString(), example: target.example, files, downloads: [] };
    projectDeliveryState.packages.push(pkg);
    const previous = { section: projectDeliveryState.section, current: projectDeliveryState.current };
    projectDeliveryState.current = pkg.id; projectDeliveryState.section = 'history';
    try { projectDeliverySave(); } catch (error) { projectDeliveryState.packages.pop(); Object.assign(projectDeliveryState, previous); throw error; }
    projectDeliveryConfirmation = null;
  } catch { projectDeliveryNotice = '演示包未能生成或保存，请重新核对版本与交付条件。已有包保留。'; }
  finally { if (operation === projectDeliveryOperation) { projectDeliveryBusy = false; if (location.hash === '#project-delivery') render(); } }
}
function projectDeliveryManifest(pkg) {
  return `# ${pkg.label} 项目交付演示清单\n\n> 合成交互示例，不是正式 ReleasePackage、发布凭据或客户签收。\n\n- 项目：${pkg.project}\n- 生成时间：${pkg.createdAt}\n- 文件数：${pkg.files.length}\n\n| 体系章节 | 文件 | 固定版本 | 来源轮次 | 报告绑定 | SHA-256 |\n| --- | --- | --- | --- | --- | --- |\n${pkg.files.map(file => `| ${file.chapter} ${file.chapterName} | ${file.filename} | 第 ${file.revision} 版 | 第 ${file.roundNumber} 轮 | ${file.reportKey} | ${file.hash} |`).join('\n')}\n\n文件与清单在生成时固定；再次下载不包含后续候选或下载事件。实际发送由顾问在外部渠道管理。\n`;
}
function projectDeliveryDownload(pkg) {
  if (!pkg) return;
  let url;
  try {
    url = URL.createObjectURL(deliveryZip(pkg, projectDeliveryManifest(pkg)));
    const link = document.createElement('a'); link.href = url; link.download = `${pkg.label}-项目交付-演示.zip`;
    document.body.append(link); link.click(); link.remove();
    pkg.downloads.push({ at: new Date().toISOString() });
    try { projectDeliverySave(); } catch { pkg.downloads.pop(); projectDeliveryNotice = '下载已请求，但本标签页未能保存下载记录。'; }
    render(); toast('已请求下载项目交付演示包');
  } catch { projectDeliveryNotice = '演示下载未能发起，请重试。已有包保留。'; render(); }
  finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-project-delivery]');
  if (!button || button.disabled) return;
  const action = button.dataset.projectDelivery;
  if (action === 'preview') {
    const pkg = projectDeliveryState.packages.find(item => item.id === projectDeliveryState.current) || projectDeliveryState.packages.at(-1);
    const file = (button.dataset.frozen === 'true' ? pkg?.files || [] : projectDeliverySources()).find(item => item.key === button.dataset.key);
    if (file?.content) modal(`${esc(file.name)} · 第 ${file.revision} 版`, `<p class="small muted">来源第 ${file.roundNumber} 轮 · 只读合成 Markdown 内容</p><pre class="delivery-preview" tabindex="0">${esc(file.content)}</pre>`, '');
    return;
  }
  if (action === 'generate') { void projectDeliveryGenerate(); return; }
  if (projectDeliveryBusy) return;
  projectDeliveryNotice = '';
  if (action === 'confirm') { projectDeliveryConfirm(); return; }
  if (action === 'download') { projectDeliveryDownload(projectDeliveryState.packages.find(item => item.id === button.dataset.id)); return; }
  if (action === 'clear-stale') {
    const currentKeys = new Set(projectDeliverySources().map(file => file.key));
    const selection = projectDeliverySelection();
    selection.splice(0, selection.length, ...selection.filter(key => currentKeys.has(key)));
  }
  if (action === 'example') { projectDeliveryState.example = !projectDeliveryState.example; projectDeliveryState.section = 'prepare'; projectDeliveryState.filter = 'ready'; }
  if (action === 'section') projectDeliveryState.section = button.dataset.section;
  if (action === 'package') projectDeliveryState.current = button.dataset.id;
  if (action === 'filter') projectDeliveryState.filter = button.dataset.filter;
  if (action === 'qualify' || action === 'block') {
    for (const file of executionDeliveryFiles().filter(file => file.status === 'approved' && file.approvedRevision === file.revision && file.content && projectDeliveryChapters[file.id])) projectDeliveryState.qualifications[file.key] = { state: action === 'qualify' ? 'ready' : 'blocked', content: file.content, reportKey: file.reportKey, reason: '配套条件仍待核验：服务器尚未确认相关材料完整性（固定演示结果）。' };
    projectDeliveryNotice = action === 'qualify' ? '固定演示服务反馈已返回，仅对应当前获批版本；未执行真实发布核验。' : '固定演示服务反馈：相关配套条件尚未通过，本版本暂不能加入交付包。';
  }
  projectDeliverySave(); render();
  if (action === 'filter' || action === 'section') document.querySelector(`[data-project-delivery="${action}"][data-${action}="${action === 'filter' ? projectDeliveryState.filter : projectDeliveryState.section}"]`)?.focus({ preventScroll: true });
});
document.addEventListener('change', event => {
  const key = event.target.dataset.projectDeliverySelect;
  if (!key || projectDeliveryBusy) return;
  const file = projectDeliverySources().find(item => item.key === key);
  if (!file?.ready) { event.target.checked = false; return; }
  const selection = projectDeliverySelection();
  if (event.target.checked && !selection.includes(key)) selection.push(key);
  else if (!event.target.checked && selection.includes(key)) selection.splice(selection.indexOf(key), 1);
  projectDeliverySave();
  document.getElementById('projectDeliveryFooter').innerHTML = projectDeliveryFooter();
});
document.addEventListener('input', event => {
  if (event.target.id !== 'projectDeliverySearch') return;
  projectDeliveryState.query = event.target.value; projectDeliverySave(); projectDeliveryRefreshList();
});
function projectDeliveryRefresh() {
  if (location.hash === '#project-delivery' && !projectDeliveryState.example && projectDeliveryState.section === 'prepare' && !projectDeliveryBusy) projectDeliveryRefreshList();
}
Object.assign(window, { projectDeliveryRoute, projectDeliveryReset, projectDeliveryRefresh });
