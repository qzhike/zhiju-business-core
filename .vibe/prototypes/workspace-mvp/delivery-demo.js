/* global esc, render, modal, toast */
/* global document, window, location, sessionStorage, TextEncoder, crypto, Blob, URL, setTimeout */
// Independent, fixed delivery fixtures. No release, export, or authorization service is connected.
const deliveryKey = 'zhiju-delivery-demo-v1';
const deliveryInitial = () => ({ section: 'prepare', scope: 'procurement', selected: true, packages: [], current: null, newer: false });
let deliveryState;
try { deliveryState = JSON.parse(sessionStorage.getItem(deliveryKey)); } catch { /* Use the fixed example. */ }
if (!deliveryState || !Array.isArray(deliveryState.packages)) deliveryState = deliveryInitial();
let deliveryBusy = false;
let deliveryOperation = 0;
let deliveryNotice = '';
function deliverySave() { sessionStorage.setItem(deliveryKey, JSON.stringify(deliveryState)); }
function deliveryResetDemo() { deliveryOperation++; deliveryBusy = false; deliveryNotice = ''; deliveryState = deliveryInitial(); deliverySave(); }
function deliveryTime(value) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function deliveryFiles() {
  return ['procedure', 'evaluation', 'application'].map(id => {
    const source = window.procurementFixtures[id];
    const revision = '交付示例第 3 版';
    const content = `> 合成演示文件：青禾制造 / ${revision}。仅用于交互设计，不作为实际客户成果、内部批准或发布证据。\n> 本示例交付程序及空白表单；客户业务记录与签字保持空白。\n\n${source.content.replaceAll('[公司代号]', 'DEMO-QH')}`;
    return { id, name: source.name, code: source.code, revision, kind: id === 'procedure' ? '程序文件' : '空白记录表单', filename: `${source.name}-交付示例第3版.md`, sourceHash: source.sourceHash, content };
  });
}
function deliveryFileList(files, frozen = false) {
  return `<div class="delivery-file-list" aria-label="本批文件与版本">${files.map(file => `<article class="delivery-file"><span class="delivery-file-icon" aria-hidden="true">MD</span><div><strong>${esc(file.name)}</strong><small>${esc(file.code)} · ${esc(file.kind)}</small></div><div class="delivery-file-version"><strong>${esc(file.revision)}</strong><small>${frozen ? '本包固定版本' : '已批准（演示）'}</small></div><button data-delivery="preview" data-id="${file.id}" data-frozen="${frozen}" aria-label="查看 ${esc(file.name)} ${esc(file.revision)}">查看</button></article>`).join('')}</div>`;
}
function deliveryPrepare() {
  const available = deliveryState.scope === 'procurement';
  const ready = deliveryState.selected && !deliveryState.newer;
  return `<div class="delivery-grid"><aside class="delivery-list" aria-label="按章节选择交付范围"><p class="delivery-list-title">本批范围</p><button class="delivery-scope ${available ? 'active' : ''}" data-delivery="scope" data-scope="procurement" aria-pressed="${available}"><small>7.4</small><span><strong>采购管理</strong><small>${deliveryState.newer ? '有新候选 · 需重新核对' : '3 份成果 · 可准备'}</small></span>${deliveryState.selected ? '<b aria-label="已加入本批">✓</b>' : ''}</button><button class="delivery-scope ${available ? '' : 'active'}" data-delivery="scope" data-scope="production" aria-pressed="${!available}"><small>7.5</small><span><strong>生产管理</strong><small>8 份成果 · 处理中</small></span></button><p class="delivery-aside-note">可按阶段分批准备。<br>其他章节继续推进。</p></aside><section class="delivery-detail" tabindex="0" aria-label="本批范围详情">${available ? `<div class="delivery-detail-heading"><div><h2>采购管理 · 3 份成果</h2><p>程序与配套空白表单作为本批示例，集中核对一次。</p></div><button data-delivery="select" aria-pressed="${deliveryState.selected}" ${deliveryBusy ? 'disabled' : ''}>${deliveryState.selected ? '✓ 已加入本批' : '加入本批'}</button></div>${deliveryState.newer ? '<div class="delivery-warning" role="status"><strong>采购控制程序有新候选，需重新核对交付条件</strong><p>本轮暂不能生成新包。已有包仍保留生成时的文件与版本。</p></div>' : '<div class="delivery-check"><span>✓ 已批准版本</span><span>✓ 配套条件通过</span><small>固定演示结果</small></div>'}${deliveryFileList(deliveryFiles())}<p class="delivery-footnote">本例交付的是程序与空白表单，不表示客户已经完成记录或签批。</p>` : '<div class="delivery-detail-heading"><div><h2>生产管理 · 暂不能加入本批</h2><p>8 份成果仍在处理，尚未形成符合交付条件的版本。</p></div><span class="tag amber">处理中</span></div><div class="delivery-empty"><span aria-hidden="true">↻</span><h3>采购部分可以先行</h3><p>这一章节保留在工作看板中继续推进，<br>不需要等待它完成再准备采购交付包。</p></div>'}</section></div><div class="delivery-footer"><p><strong>${deliveryState.selected ? '本批 · 采购管理 · 3 份文件' : '尚未选择本批范围'}</strong><span>${deliveryState.newer ? '存在待核对的新候选，暂不能生成。' : '确认后固定本批文件与版本，不随新候选自动变化。'}</span></p><button class="primary" data-delivery="generate" ${ready && !deliveryBusy ? '' : 'disabled'}>${deliveryBusy ? '正在生成演示包…' : '确认版本并生成包'}</button></div>`;
}
function deliveryHistory() {
  const pkg = deliveryState.packages.find(item => item.id === deliveryState.current) || deliveryState.packages.at(-1);
  if (!pkg) return '<div class="delivery-no-packages"><h2>还没有交付包</h2><p>先选择本批范围，核对文件版本后生成。</p><button data-delivery="section" data-section="prepare">准备本批交付</button></div>';
  return `<div class="delivery-grid"><aside class="delivery-list" aria-label="交付包列表"><p class="delivery-list-title">已生成的交付包</p>${[...deliveryState.packages].reverse().map(item => `<button class="delivery-package ${item.id === pkg.id ? 'active' : ''}" data-delivery="package" data-id="${item.id}" aria-pressed="${item.id === pkg.id}"><strong>第 ${item.number} 批 · 采购管理</strong><small>${esc(deliveryTime(item.createdAt))}</small><span>${item.files.length} 份文件 · ${item.downloads.length ? `已请求下载 ${item.downloads.length} 次` : '尚未请求下载'}</span></button>`).join('')}</aside><section class="delivery-detail" tabindex="0" aria-label="固定交付包详情"><div class="delivery-detail-heading"><div><h2>第 ${pkg.number} 批 · 采购管理</h2><p>${esc(pkg.label)} · ${pkg.files.length} 份 Markdown 文件与一份清单</p></div><span class="tag green">已生成（演示）</span></div>${deliveryState.newer ? '<div class="delivery-warning"><strong>项目中已有新候选</strong><p>本包仍是生成时确认的版本；没有自动替换文件。</p></div>' : ''}${deliveryFileList(pkg.files, true)}<details class="delivery-records" open><summary>下载记录 · ${pkg.downloads.length}</summary>${pkg.downloads.length ? `<ol>${[...pkg.downloads].reverse().map(item => `<li><span>${esc(deliveryTime(item.at))}</span><strong>林顾问 · 已请求下载</strong></li>`).join('')}</ol>` : '<p>尚未请求下载。</p>'}<p class="delivery-footnote">此处记录下载请求；浏览器是否保存完成，当前原型无法确认。</p></details><p class="delivery-footnote">下载后通过现有渠道发送。本工作台只保留交付包与下载情况。</p></section></div><div class="delivery-footer"><p><strong>版本已固定 · 可再次下载</strong><span>生成与下载不会改变项目完成进度。</span></p><button class="primary" data-delivery="download" data-id="${pkg.id}">下载演示包 .zip</button></div>`;
}
function deliveryPage() {
  return `<div class="intake-shell delivery-shell"><a href="#board" class="intake-back">← 工作台</a><div class="intake-heading delivery-heading"><div><div class="eyebrow">青禾制造 / 分批交付</div><h1>分批交付</h1><p>先核对范围与版本，再带走固定的交付包。</p></div><span class="tag">独立交付示例</span></div><nav class="delivery-tabs" aria-label="交付视图"><button data-delivery="section" data-section="prepare" aria-pressed="${deliveryState.section === 'prepare'}">准备新批次</button><button data-delivery="section" data-section="history" aria-pressed="${deliveryState.section === 'history'}">交付包 <span>${deliveryState.packages.length}</span></button></nav>${deliveryNotice ? `<p class="delivery-warning" role="alert">${esc(deliveryNotice)}</p>` : ''}${deliveryState.section === 'prepare' ? deliveryPrepare() : deliveryHistory()}<details class="delivery-demo-tools"><summary>演示场景与边界</summary><p>采用独立的已批准版本示例，不改变成果检查页的待办。包内含真实模板生成的合成示例与清单；所有批准、配套和发布条件均为固定模拟，不是正式受控导出。状态只保存在本标签页。</p><button data-delivery="newer" ${deliveryState.newer || !deliveryState.packages.length ? 'disabled' : ''}>模拟出现新候选</button><button data-delivery="reset">重新体验交付场景</button></details></div>`;
}
function deliveryRoute() { return location.hash === '#delivery' ? deliveryPage() : null; }
function deliveryBoardExtras() {
  const projects = [...document.querySelectorAll('.project')];
  const project = projects.find(item => item.querySelector('strong')?.textContent === '青禾制造');
  project?.insertAdjacentHTML('beforeend', '<div class="delivery-board-entry"><a href="#delivery">准备交付 / 查看交付包 →</a><small>独立交付示例</small></div>');
}
async function deliveryHash(content) {
  const bytes = new TextEncoder().encode(content);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function deliveryGenerate() {
  if (deliveryBusy || !deliveryState.selected || deliveryState.newer) return;
  const operation = ++deliveryOperation;
  deliveryBusy = true; deliveryNotice = ''; render();
  try {
    const files = await Promise.all(deliveryFiles().map(async file => ({ ...file, hash: await deliveryHash(file.content) })));
    if (operation !== deliveryOperation || deliveryState.newer || !deliveryState.selected) return;
    const number = deliveryState.packages.length + 1;
    const pkg = { id: crypto.randomUUID(), label: `DEMO-QH-${String(number).padStart(3, '0')}`, number, createdAt: new Date().toISOString(), project: '青禾制造', scope: '采购管理', files, downloads: [] };
    deliveryState.packages.push(pkg); deliveryState.current = pkg.id; deliveryState.section = 'history';
    try { deliverySave(); } catch (error) { deliveryState.packages.pop(); deliveryState.current = deliveryState.packages.at(-1)?.id || null; deliveryState.section = 'prepare'; throw error; }
  } catch { deliveryNotice = '演示包未能保存，请重试。未生成可用的交付包。'; }
  finally { if (operation === deliveryOperation) { deliveryBusy = false; if (location.hash === '#delivery') render(); } }
}
function deliveryManifest(pkg) {
  return `# ${pkg.label} 交付演示清单\n\n> 合成交互示例，不是正式 ReleasePackage、发布凭据或客户签收。\n\n- 项目：${pkg.project}\n- 本批范围：${pkg.scope}\n- 生成时间：${pkg.createdAt}\n- 文件数：${pkg.files.length}\n- 用途：程序与空白记录表单，客户业务记录和签字保持空白\n\n| 文件 | 固定版本 | SHA-256 | 源模板 SHA-256 |\n| --- | --- | --- | --- |\n${pkg.files.map(file => `| ${file.filename} | ${file.revision} | ${file.hash} | ${file.sourceHash} |`).join('\n')}\n\n此清单与文件随本包固定，再次下载不包含后续候选或下载事件。发送过程由顾问在外部渠道管理，MVP 不提供已发送标记。\n`;
}
// Store-only ZIP for three fixed Markdown fixtures. This is not a production export pipeline.
function deliveryZip(pkg, manifest = deliveryManifest(pkg)) {
  const encoder = new TextEncoder();
  const entries = [...pkg.files.map(file => ({ name: file.filename, text: file.content })), { name: '交付演示清单.md', text: manifest }];
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  const stamp = new Date(pkg.createdAt);
  const dosTime = (stamp.getUTCHours() << 11) | (stamp.getUTCMinutes() << 5) | (stamp.getUTCSeconds() >> 1);
  const dosDate = ((stamp.getUTCFullYear() - 1980) << 9) | ((stamp.getUTCMonth() + 1) << 5) | stamp.getUTCDate();
  for (const entry of entries) {
    const name = encoder.encode(entry.name), body = encoder.encode(entry.text);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true);
    h.setUint32(18, body.length, true); h.setUint32(22, body.length, true); h.setUint16(26, name.length, true);
    const directory = new Uint8Array(46), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true);
    d.setUint16(12, dosTime, true); d.setUint16(14, dosDate, true); d.setUint32(16, crc, true);
    d.setUint32(20, body.length, true); d.setUint32(24, body.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true);
    local.push(header, name, body); central.push(directory, name); offset += header.length + name.length + body.length; centralSize += directory.length + name.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
function deliveryDownload(pkg) {
  if (!pkg) return;
  let url;
  try {
    url = URL.createObjectURL(deliveryZip(pkg));
    const link = document.createElement('a'); link.href = url; link.download = `${pkg.label}-采购管理-演示.zip`;
    document.body.append(link); link.click(); link.remove();
    pkg.downloads.push({ at: new Date().toISOString() });
    try { deliverySave(); } catch { pkg.downloads.pop(); deliveryNotice = '下载已请求，但本标签页未能保存下载记录。'; }
    render(); toast('已请求下载演示包');
  } catch { deliveryNotice = '演示包下载未能发起，请重试。'; render(); }
  finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 5000); }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-delivery]');
  if (!button || button.disabled) return;
  const action = button.dataset.delivery;
  if (action === 'preview') {
    const pkg = deliveryState.packages.find(item => item.id === deliveryState.current) || deliveryState.packages.at(-1);
    const file = (button.dataset.frozen === 'true' ? pkg?.files || [] : deliveryFiles()).find(item => item.id === button.dataset.id);
    if (file) modal(`${esc(file.name)} · ${esc(file.revision)}`, `<p class="small muted">只读 Markdown 演示内容 · 模板版次与交付示例版本分别保留。</p><pre class="delivery-preview" tabindex="0">${esc(file.content)}</pre>`, '');
    return;
  }
  if (action === 'generate') { void deliveryGenerate(); return; }
  if (action === 'download') { deliveryNotice = ''; deliveryDownload(deliveryState.packages.find(item => item.id === button.dataset.id)); return; }
  if (action === 'reset') { deliveryResetDemo(); render(); return; }
  if (deliveryBusy) return;
  deliveryNotice = '';
  if (action === 'section') deliveryState.section = button.dataset.section;
  if (action === 'scope') deliveryState.scope = button.dataset.scope;
  if (action === 'select') deliveryState.selected = !deliveryState.selected;
  if (action === 'package') deliveryState.current = button.dataset.id;
  if (action === 'newer' && deliveryState.packages.length) deliveryState.newer = true;
  deliverySave(); render();
  const focus = [...document.querySelectorAll('[data-delivery]')].find(item => item.dataset.delivery === action && (action !== 'scope' || item.dataset.scope === deliveryState.scope) && (action !== 'section' || item.dataset.section === deliveryState.section) && (action !== 'package' || item.dataset.id === deliveryState.current));
  focus?.focus({ preventScroll: true });
});

Object.assign(window, { deliveryRoute, deliveryBoardExtras, deliveryResetDemo });
