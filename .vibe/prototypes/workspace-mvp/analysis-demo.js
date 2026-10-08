/* global esc, render, modal */
/* global analysisScopeEntry, analysisScopeResetDemo */
/* global analysisConsultantReviewReset, analysisConsultantReviewClearContext, analysisConsultantReviewComposer, analysisConsultantReviewInput */
/* global analysisConsultantReviewOverview, analysisConsultantReviewDetail, analysisConsultantReviewBoardInfo, analysisConsultantReviewSchedule */
/* global document, window, location, sessionStorage, navigator, fetch, crypto, setTimeout, clearTimeout */
/* exported analysisRoute, analysisBoardTask, analysisResetDemo */
// A presentation of the checked-in report fixture, not document analysis or a business command.
const analysisStorageKey = 'zhiju-analysis-demo-v1';
const analysisInitial = () => ({ layoutVersion: 3, section: 'overview', active: null, selected: null, query: '', kind: 'ALL', detail: false });
let analysisView;
try { analysisView = JSON.parse(sessionStorage.getItem(analysisStorageKey)); } catch { /* Use default view preferences. */ }
if (!analysisView || !['overview', 'customer', 'consultant', 'plan', 'report'].includes(analysisView.section)) analysisView = analysisInitial();
// Preserve selected requests while opening the new report overview once.
if (analysisView.layoutVersion !== 3) analysisView = { ...analysisView, layoutVersion: 3, section: 'overview', active: null, detail: false };
let analysisReport = null;
const analysisReports = {};
let analysisLoadState = 'idle';
let analysisGroups = [];
let analysisCopyOperation = 0;
// Synthetic display names belong to the input manifest, not to the Runner's semantic report.
const analysisSourceNames = {
  'C-ORG-NEW': '可读组织关系说明.md', 'C-ROLE': '现行岗位职责.md', 'C-MANUAL': '质量手册.docx', 'C-CORRECTION': '纠正措施程序.docx', 'C-PREVENTION': '预防措施程序.docx',
  'T-ROLE': '岗位职责模板.md', 'T-CAPA': '纠正与预防模板.md', 'T-SOFTWARE': '软件管理模板.md'
};
const analysisKindNames = { MISSING_MATERIAL: '本轮未提供', UNREADABLE_MATERIAL: '读取受限', FACT_QUESTION: '需要确认事实', PROTECTION_CONFLICT: '企业安排待核对' };
const analysisReadNames = { READ: '相关内容已读', PARTIAL: '部分读取', UNREAD: '尚未读取', FAILED: '读取失败' };
const analysisUnique = values => [...new Set(values)];
const analysisName = id => analysisSourceNames[id] || id;
const analysisFile = id => analysisReport.plannedFiles.find(file => file.id === id);
function analysisLatestEdition() { return analysisRecheck.hasOrgReport ? 'orgfollowup' : analysisRecheck.hasReport ? 'followup' : 'initial'; }
function analysisReportLabel(edition = analysisView.reportEdition) { return edition === 'orgfollowup' ? '补齐组织图后的报告' : edition === 'followup' ? '补充职责后的报告' : '首轮报告'; }
function analysisSave() { try { sessionStorage.setItem(analysisStorageKey, JSON.stringify(analysisView)); } catch { /* View preferences are optional, never business persistence. */ } }
function analysisResetDemo() { analysisView = analysisInitial(); analysisRecheckReset(); analysisPlanFeedbackReset(); analysisConsultantReviewReset(); analysisScopeResetDemo(); analysisSave(); }
function analysisGroupRequests(items) {
  const groups = new Map();
  for (const item of items) {
    if (item.audience !== 'CUSTOMER' || !item.customerRequest) continue;
    const request = item.customerRequest;
    if (!groups.has(request.key)) groups.set(request.key, { ...request, items: [] });
    const group = groups.get(request.key);
    if (group.text !== request.text || group.title !== request.title) throw new Error('Conflicting request fixture');
    group.items.push(item);
  }
  return [...groups.values()];
}
async function analysisLoad() {
  if (analysisLoadState === 'loading' || analysisLoadState === 'ready') return;
  analysisLoadState = 'loading';
  const desiredEdition = analysisView.section === 'overview' && !analysisView.historyMode ? analysisLatestEdition() : analysisView.reportEdition || 'initial';
  try {
    const response = await fetch('analysis-report.example.json?v=17', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Example unavailable');
    const report = await response.json();
    if (report.schemaVersion !== '0.1.0' || report.stage !== 'ANALYSIS') throw new Error('Unsupported example');
    if (desiredEdition !== 'initial') {
      analysisView.reportSelections ||= {};
      analysisView.reportSelections[desiredEdition] = analysisView.selected;
      analysisView.selected = null;
    }
    analysisReports.initial = report;
    analysisApplyReport(report, 'initial');
    if (analysisRecheck.hasReport) {
      try { const followup = await analysisEnsureFollowup(); if (desiredEdition === 'followup') analysisApplyReport(followup, 'followup'); }
      catch { analysisRecheck.notice = '复核报告暂时无法载入，保留首轮报告供查看。'; analysisRecheckSave(); }
    }
    if (analysisRecheck.hasOrgReport) {
      const report = await analysisEnsureOrgReport();
      if (desiredEdition === 'orgfollowup') analysisApplyReport(report, 'orgfollowup');
    }
    analysisLoadState = 'ready';
    analysisRecheckSchedule();
  } catch { analysisLoadState = 'error'; }
  if (analysisIsReportRoute()) render();
}
function analysisBoardTask() {
  const consultant = analysisConsultantReviewBoardInfo();
  const busy = analysisRecheckBusy() || consultant.busy;
  const pendingCount = new Set(analysisPlanFeedback.submissions.map(submission => submission.fileId).filter(Boolean)).size;
  const desc = consultant.text ? `${consultant.text}${pendingCount ? ` 另有 ${pendingCount} 份文件计划待复核。` : ''}` : pendingCount
    ? `${pendingCount} 份文件计划待复核；${busy ? '补充资料正在重新分析。' : '可从总览处理其他文件或资料。'}`
    : busy ? '补充资料正在重新分析，完成后查看更新的报告。' : analysisRecheck.hasReport ? '复核报告已返回；从总览选择本轮文件或继续补充资料。' : '分析报告已返回；从总览选择本轮文件或补充客户资料。';
  return { id: 'analysis', project: '青禾制造', title: '体系文件升级 · 分析报告', desc, group: busy ? 'running' : 'attention', badge: '分析报告示例' };
}
function analysisHeader() {
  return `<div class="analysis-heading"><div><a href="#board" class="analysis-back">← 返回工作台</a><div class="analysis-breadcrumb">青禾制造（演示） / 体系文件升级</div><h1>分析报告<span class="analysis-version">${analysisReportLabel()} · 演示</span></h1></div>${analysisRoundControls()}</div>${analysisView.section === 'overview' && analysisLoadState === 'ready' ? analysisScopeEntry() : ''}`;
}
function analysisRoute() {
  if (!analysisIsReportRoute()) return null;
  if (analysisLoadState === 'idle') void analysisLoad();
  if (analysisLoadState !== 'ready') return `<section class="analysis-shell">${analysisHeader()}<div class="analysis-load" ${analysisLoadState === 'loading' ? 'aria-busy="true"' : ''}><h2>${analysisLoadState === 'error' ? '暂时无法载入报告' : '正在载入报告'}</h2><p>${analysisLoadState === 'error' ? '尚未取得报告内容，无法判断是否存在资料缺口。请重试。' : '正在打开本地示例。'}</p>${analysisLoadState === 'error' ? '<button class="primary" data-analysis-action="retry">重新载入</button>' : ''}</div></section>`;
  if (location.hash === '#analysis-supplement') analysisView.section = 'overview';
  analysisRecheckSchedule(); analysisConsultantReviewSchedule();
  const latestEdition = analysisLatestEdition();
  if (analysisView.section === 'overview' && !analysisView.historyMode && analysisReports[latestEdition] && !document.getElementById('dialog').open && analysisView.reportEdition !== latestEdition) analysisApplyReport(analysisReports[latestEdition], latestEdition);
  const consultantCount = analysisReport.attentionItems.filter(item => item.audience === 'CONSULTANT').length;
  const section = analysisView.section;
  return `<section class="analysis-shell ${section === 'overview' ? 'analysis-overview-shell' : ''}">${analysisHeader()}${section === 'overview' ? '' : `<nav class="analysis-nav" aria-label="分析报告视图">${[['overview', '总览', null], ['customer', '客户需补充', analysisGroups.length], ['consultant', '顾问需判断', consultantCount], ['plan', '拟交付文件', analysisReport.plannedFiles.length], ['report', '报告依据', null]].map(([key, title, count]) => `<button data-analysis-section="${key}" aria-pressed="${section === key}">${title}${count === null ? '' : `<span>${count}</span>`}</button>`).join('')}</nav>`}${section === 'overview' ? analysisOverview() : section === 'customer' ? analysisCustomer() : section === 'consultant' ? analysisConsultant() : section === 'plan' ? analysisPlan() : analysisReportView()}</section>`;
}
function analysisOverview() {
  const consultant = analysisReport.attentionItems.filter(item => item.audience === 'CONSULTANT');
  const files = analysisReport.plannedFiles;
  const coverage = analysisReport.readCoverage;
  const limited = coverage.filter(item => item.readState !== 'READ');
  const readSummary = ['PARTIAL', 'UNREAD', 'FAILED'].map(state => { const count = coverage.filter(item => item.readState === state).length; return count ? `${count} 份${analysisReadNames[state]}` : ''; }).filter(Boolean).join('、');
  const unchecked = analysisReport.checks.filter(item => item.result === 'NOT_RUN');
  const pendingTemplates = analysisReport.templateCoverage.filter(item => item.disposition === 'PENDING').length;
  const customerCount = coverage.filter(item => item.sourceId.startsWith('C-')).length;
  const templateCount = coverage.filter(item => item.sourceId.startsWith('T-')).length;
  const heading = (section, title, count) => `<div class="analysis-overview-heading"><h2>${title}${count === null ? '' : `<span>${count}</span>`}</h2><div class="analysis-overview-tools">${section === 'customer' ? '<button data-recheck="copy-requests">复制索取清单</button>' : ''}<button data-analysis-section="${section}" aria-label="查看${title}详情">查看 <span aria-hidden="true">↗</span></button></div></div>`;
  return `<div class="analysis-overview" aria-label="分析报告总览"><section class="analysis-overview-card analysis-overview-priority" aria-label="客户需补充摘要">${heading('customer', '客户需补充', analysisGroups.length)}<div class="analysis-overview-rows">${analysisGroups.slice(0, 3).map(group => `<button data-analysis-request="${esc(group.key)}"><strong>${esc(group.title)}</strong><span>${esc(analysisKindNames[group.items[0].kind])}</span></button>`).join('') || '<p class="analysis-overview-note">报告未列出客户补充事项。</p>'}</div>${analysisGroups.length > 3 ? `<p class="analysis-overview-note">展示前 3 项，另有 ${analysisGroups.length - 3} 项可进入清单查看。</p>` : ''}${analysisResolutionHint()}</section><section class="analysis-overview-card" aria-label="顾问需判断摘要">${heading('consultant', '顾问需判断', consultant.length)}${consultant.slice(0, 1).map(item => `<button class="analysis-overview-decision" data-analysis-consultant="${esc(item.id)}"><strong>${esc(item.title)} <span aria-hidden="true">↗</span></strong><span>${esc(item.reason)}</span></button>`).join('') || '<p class="analysis-overview-note">报告未列出顾问判断项。</p>'}<p class="analysis-overview-note">${consultant.length > 1 ? `另有 ${consultant.length - 1} 项待判断。` : ''}保留企业现有安排，意见与依据交给 Runner 复核。</p>${analysisConsultantReviewOverview()}</section><section class="analysis-overview-card" aria-label="拟交付文件摘要">${heading('plan', '拟交付文件', files.length)}<div class="analysis-overview-files">${files.slice(0, 4).map(file => `<button data-analysis-file="${esc(file.id)}"><strong>${esc(file.title)}</strong><span>${file.origin === 'TEMPLATE_DERIVED' ? '拟新增' : '沿用客户文件'}</span></button>`).join('') || '<p class="analysis-overview-note">报告尚未列出拟交付文件。</p>'}</div><p class="analysis-overview-note">${files.length > 4 ? `另有 ${files.length - 4} 份拟交付文件。` : ''}${pendingTemplates ? `${pendingTemplates} 项模板适用性待确认；可独立文件可分批确认` : '拟交付范围仍需人工确认'}</p></section><section class="analysis-overview-card" aria-label="报告依据摘要">${heading('report', '报告依据', null)}<p class="analysis-overview-inputs">客户资料 <strong>${customerCount}</strong> 份<span>·</span>公司模板 <strong>${templateCount}</strong> 份</p><div class="analysis-overview-evidence"><p>${limited.length ? `<strong>${esc(readSummary)}</strong> · ${esc(limited.slice(0, 1).map(item => analysisName(item.sourceId)).join('、'))}` : '报告声明：相关内容已读'}</p><p>${unchecked.length ? `${esc(unchecked.map(check => check.title).join('、'))}：<strong>未执行</strong>` : '检查结论来自执行端报告，业务审核另行记录。'}</p></div></section></div>${analysisComposer()}`;
}

function analysisCustomer() {
  const filtered = analysisGroups.filter(group => {
    const items = group.items;
    const search = [group.title, group.text, ...items.map(item => item.reason), ...items.flatMap(item => item.affectedPlannedFileIds).map(id => analysisFile(id)?.title || id)].join(' ').toLowerCase();
    return (analysisView.kind === 'ALL' || items.some(item => item.kind === analysisView.kind)) && search.includes(analysisView.query.trim().toLowerCase());
  });
  const current = filtered.find(group => group.key === analysisView.active) || filtered[0];
  const selected = analysisView.selected || [];
  return `<div class="analysis-intro"><p><strong>${analysisGroups.length} 项</strong>需要向客户补充<span>相同资料已合并，勾选本次要索取的内容。</span></p><span class="analysis-reading-note">${analysisView.reportEdition === 'orgfollowup' ? '新增组织说明已读，原图读取限制保留' : '组织图已收到，读取受限'}</span></div><div class="analysis-grid ${analysisView.detail ? 'analysis-show-detail' : ''}"><aside class="analysis-list" aria-label="客户补充清单"><div class="analysis-list-tools"><label class="analysis-search"><span class="sr-only">搜索补充事项</span><input id="analysisSearch" type="search" placeholder="搜索资料或关联文件" value="${esc(analysisView.query)}"></label><div class="analysis-list-controls"><label><span class="sr-only">筛选补充类别</span><select id="analysisKind">${[['ALL', '全部类别'], ['MISSING_MATERIAL', '本轮未提供'], ['UNREADABLE_MATERIAL', '读取受限'], ['FACT_QUESTION', '需要确认事实']].map(([key, label]) => `<option value="${key}" ${analysisView.kind === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button data-analysis-action="${selected.length === analysisGroups.length ? 'clear' : 'all'}">${selected.length === analysisGroups.length ? '取消全选' : '选取全部'}</button></div><p class="analysis-search-count" role="status">${filtered.length === analysisGroups.length ? `共 ${analysisGroups.length} 项` : `找到 ${filtered.length} / ${analysisGroups.length} 项`}</p></div><div class="analysis-list-scroll">${filtered.map(group => `<div class="analysis-item ${current?.key === group.key ? 'active' : ''}"><input type="checkbox" aria-label="选取${esc(group.title)}" data-analysis-select="${esc(group.key)}" ${selected.includes(group.key) ? 'checked' : ''}><button data-analysis-open="${esc(group.key)}" aria-current="${current?.key === group.key ? 'true' : 'false'}"><strong>${esc(group.title)}</strong><span>${esc(analysisKindNames[group.items[0].kind])}</span><small>${group.items[0].affectedPlannedFileIds.length ? `涉及 ${esc(analysisFile(group.items[0].affectedPlannedFileIds[0]).title)}${analysisUnique(group.items.flatMap(item => item.affectedPlannedFileIds)).length > 1 ? '等文件' : ''}` : '涉及适用范围确认'}</small></button></div>`).join('') || '<div class="analysis-empty"><strong>没有匹配的事项</strong><p>试试其他名称或取消筛选。</p><button data-analysis-action="clearFilter">清除筛选</button></div>'}</div></aside><article id="analysisDetail" class="analysis-detail" tabindex="0" aria-label="当前补充事项详情">${current ? analysisCustomerDetail(current) : '<div class="analysis-empty"><h2>当前筛选下没有事项</h2><p>这不代表报告中的资料缺口已解决。已选内容仍保留。</p><button data-analysis-action="clearFilter">查看全部事项</button></div>'}</article></div><footer class="analysis-footer"><p><strong id="analysisSelectedCount">已选 ${selected.length} / ${analysisGroups.length} 项</strong><span>仅复制内容，由你通过现有渠道发送。</span></p><button id="analysisCopyButton" class="primary" data-analysis-action="previewCopy" ${selected.length ? '' : 'disabled'}>预览并复制索取内容 <span aria-hidden="true">→</span></button></footer>`;
}
function analysisBackToList() { return '<button class="analysis-mobile-back" data-analysis-action="list">← 返回清单</button>'; }
function analysisCustomerDetail(group) {
  const items = group.items;
  const first = items[0];
  const fileIds = analysisUnique(items.flatMap(item => item.affectedPlannedFileIds));
  const evidenceIds = analysisUnique(items.flatMap(item => item.evidenceIds));
  return `${analysisBackToList()}<div class="analysis-detail-label">${esc(analysisKindNames[first.kind])}${items.length > 1 ? ` · ${items.length} 条报告事项已合并` : ''}</div><h2>${esc(group.title)}</h2><div class="analysis-request"><h3>需要客户提供</h3><p>${esc(group.text)}</p></div><section class="analysis-text-section"><h3>为什么需要</h3>${analysisUnique(items.map(item => item.reason)).map(reason => `<p>${esc(reason)}</p>`).join('')}${first.material ? `<p class="analysis-fine-print">${esc(first.material.searchScopeNote)}</p>` : ''}</section><section class="analysis-text-section"><h3>关联拟交付文件</h3>${fileIds.length ? `<div class="analysis-file-links">${fileIds.map(id => `<button data-analysis-file="${esc(id)}">${esc(analysisFile(id).title)} <span aria-hidden="true">↗</span></button>`).join('')}</div><p class="analysis-fine-print">这些文件的相关内容生成前，需要处理本项。</p>` : '<p>软件管理是否纳入本轮，待企业实际使用情况确认。</p>'}</section>${analysisEvidence(evidenceIds)}${analysisProtected(analysisUnique(items.flatMap(item => item.protectedFactIds)))}`;
}
function analysisEvidence(ids) {
  if (!ids.length) return '';
  return `<details class="analysis-disclosure"><summary>查看判断依据 <span>${ids.length} 处</span></summary>${ids.map(id => {
    const evidence = analysisReport.evidence.find(item => item.id === id);
    return `<div class="analysis-evidence"><strong>${esc(analysisName(evidence.sourceId))}</strong><span>${esc(evidence.locator.value)}${evidence.representation === 'EXTRACTED' ? ' · 提取件定位' : ''}</span>${evidence.quote ? `<blockquote>${esc(evidence.quote)}</blockquote>` : ''}<p>${esc(evidence.note)}</p></div>`;
  }).join('')}<p class="analysis-fine-print">以上为执行端报告中的依据说明；本原型未连接客户原件。</p></details>`;
}
function analysisProtected(ids) {
  if (!ids.length) return '';
  return `<details class="analysis-disclosure"><summary>需要保留的企业安排</summary>${ids.map(id => { const fact = analysisReport.protectedFacts.find(item => item.id === id); return `<div class="analysis-evidence"><strong>${esc(fact.title)} <span>${fact.sourceState === 'UNCONFIRMED' ? '待核对' : '报告已识别'}</span></strong><p>${esc(fact.statement)}</p></div>`; }).join('')}</details>`;
}
function analysisConsultant() {
  const items = analysisReport.attentionItems.filter(item => item.audience === 'CONSULTANT');
  const current = items.find(item => item.id === analysisView.active) || items[0];
  return `<div class="analysis-intro"><p>核对企业原有安排<span>保留企业现有安排，按客户依据适配升级要求。</span></p></div><div class="analysis-grid ${analysisView.detail ? 'analysis-show-detail' : ''}"><aside class="analysis-list"><div class="analysis-list-scroll">${items.map(item => `<button class="analysis-plan-item ${item.id === current?.id ? 'active' : ''}" data-analysis-open="${esc(item.id)}"><span>需要顾问判断</span><strong>${esc(item.title)}</strong><small>涉及 ${item.affectedPlannedFileIds.length} 份拟交付文件</small></button>`).join('')}</div></aside><article class="analysis-detail" tabindex="0" aria-label="顾问判断详情">${current ? `${analysisBackToList()}<div class="analysis-detail-label">企业安排待核对</div><h2>${esc(current.title)}</h2><div class="analysis-request"><h3>需要判断</h3><p>${esc(current.question)}</p></div><section class="analysis-text-section"><h3>报告提示</h3><p>${esc(current.reason)}</p></section>${analysisProtected(current.protectedFactIds)}${analysisEvidence(current.evidenceIds)}${analysisConsultantReviewDetail(current)}<div class="analysis-next"><p>顾问意见与客户补充资料分别记录，企业现有组织与职责继续保留。</p><button data-analysis-section="customer">先查看客户需补充的资料</button></div>` : '<p>报告未列出顾问判断项。</p>'}</article></div><footer class="analysis-footer"><p><span>本页展示分析建议，尚未作出业务决定。</span></p></footer>`;
}
function analysisPlan() {
  const files = analysisReport.plannedFiles;
  const current = files.find(file => file.id === analysisView.active) || files[0];
  const pending = analysisReport.templateCoverage.filter(item => item.disposition === 'PENDING').length;
  const originNames = { TEMPLATE_DERIVED: '参考模板形成新文件', CUSTOMER_REVISION: '升级客户现有文件', CUSTOMER_CONVERSION: '保留内容，转换格式' };
  return `<div class="analysis-intro"><p>报告列出 <strong>${files.length} 份</strong>拟交付文件<span>${pending} 项模板适用性仍待确认，当前范围尚未定稿。</span></p></div><div class="analysis-grid ${analysisView.detail ? 'analysis-show-detail' : ''}"><aside class="analysis-list"><div class="analysis-list-scroll">${files.map(file => `<button class="analysis-plan-item ${file.id === current?.id ? 'active' : ''}" data-analysis-open="${esc(file.id)}"><span>${esc(originNames[file.origin] || file.origin)}</span><strong>${esc(file.title)}</strong><small>${file.attentionItemIds.length ? '相关事项待处理' : '报告未列出前置缺口'}</small></button>`).join('')}</div></aside><article class="analysis-detail" tabindex="0" aria-label="拟交付文件详情">${current ? `${analysisBackToList()}<div class="analysis-detail-label">${esc(originNames[current.origin] || current.origin)} · Markdown</div><h2>${esc(current.title)}</h2><section class="analysis-text-section"><h3>客户原有文件</h3><p>${current.customerSourceIds.map(id => esc(analysisName(id))).join('、') || '报告未关联客户文件'}</p></section><section class="analysis-text-section"><h3>参考模板</h3><p>${current.templateSourceIds.map(id => esc(analysisName(id))).join('、') || '本项未关联模板'}</p></section>${analysisReport.changes.filter(change => change.targetPlannedFileIds.includes(current.id)).map(change => `<div class="analysis-request"><h3>${esc(change.title)}</h3><p>${esc(change.description)}</p><p class="analysis-fine-print">${esc(change.reason)}</p></div>`).join('')}${current.attentionItemIds.length ? `<section class="analysis-text-section"><h3>相关待处理事项</h3><div class="analysis-related">${analysisRelatedRequests(current.attentionItemIds)}</div></section>` : '<p class="analysis-fine-print">尚未确认生成；报告未列出缺口不代表已获批准。</p>'}${analysisProtected(analysisUnique(analysisReport.changes.filter(change => change.targetPlannedFileIds.includes(current.id)).flatMap(change => change.protectedFactIds)))}` : '<p>报告尚未列出拟交付文件。</p>'}</article></div><footer class="analysis-footer"><p><strong>计划待核对</strong><span>确认工作范围后，才请求生成或修改文件。</span></p><button data-analysis-section="customer">返回资料缺口</button></footer>`;
}
function analysisRelatedRequests(ids) {
  const customer = analysisGroups.filter(group => group.items.some(item => ids.includes(item.id)));
  const consultant = analysisReport.attentionItems.filter(item => item.audience === 'CONSULTANT' && ids.includes(item.id));
  return customer.map(group => `<button data-analysis-request="${esc(group.key)}">${esc(group.title)} <span>客户补充 ↗</span></button>`).join('') + consultant.map(item => `<button data-analysis-consultant="${esc(item.id)}">${esc(item.title)} <span>顾问判断 ↗</span></button>`).join('');
}
function analysisReportView() {
  const checkNames = { PASS: '执行端自报通过', FAIL: '执行端自报未通过', LIMITED: '存在限制', NOT_RUN: '未执行' };
  const customerCount = analysisReport.readCoverage.filter(item => item.sourceId.startsWith('C-')).length;
  const templateCount = analysisReport.readCoverage.length - customerCount;
  const narrative = analysisView.reportEdition === 'orgfollowup' ? analysisReport.narrative.relativePath : analysisView.reportEdition === 'followup' ? 'analysis-report.followup.example.md' : 'analysis-report.example.md';
  return `<div class="analysis-report-pane" tabindex="0" aria-label="报告依据与读取范围"><div class="analysis-report-top"><h2>本次分析的范围与限制</h2><a href="${narrative}" download>下载示例报告原文 ↗</a></div><p>${esc(analysisReport.summary)}</p><p class="analysis-fine-print">匿名合成的 ${analysisReport.readCoverage.length} 份输入示例：${customerCount} 份客户资料、${templateCount} 份模板。不是独立测试的完整结果。</p><section class="analysis-text-section"><h3>读取情况 <span class="analysis-inline-note">执行端报告</span></h3><div class="analysis-coverage">${analysisReport.readCoverage.map(item => `<div><strong>${esc(analysisName(item.sourceId))}</strong><span class="${item.readState !== 'READ' ? 'analysis-limited' : ''}">${esc(analysisReadNames[item.readState])}</span><p>${esc(item.scopeDescription)}${item.limitations.length ? `；${esc(item.limitations.join('；'))}` : ''}</p></div>`).join('')}</div></section><details class="analysis-disclosure"><summary>模板与拟交付文件的对应 <span>${analysisReport.templateCoverage.length} 项</span></summary>${analysisReport.templateCoverage.map(item => `<div class="analysis-evidence"><strong>${esc(analysisName(item.templateSourceId))}</strong><p>${esc(item.explanation)}</p><span>拟交付：${item.plannedFileIds.map(id => esc(analysisFile(id).title)).join('、') || '待确认'}</span></div>`).join('')}</details><section class="analysis-text-section"><h3>报告自检与未执行的检查</h3>${analysisReport.checks.map(check => `<div class="analysis-check"><div><strong>${esc(check.title)}</strong><span>${esc(checkNames[check.result])}</span></div><p>${esc(check.limitations.join('；') || check.scope)}</p></div>`).join('')}</section></div><footer class="analysis-footer"><p><span>读取情况和分析建议来自执行端；正式审核另行记录。</span></p></footer>`;
}
function analysisRefresh(focusId) {
  analysisSave();
  render();
  if (focusId) document.getElementById(focusId)?.focus();
}
function analysisOpenCopy(all = false) {
  const groups = analysisGroups.filter(group => all || analysisView.selected.includes(group.key));
  if (!groups.length) return;
  const text = `您好，为继续整理本次体系升级文件，请协助补充以下资料或说明：\n\n${groups.map((group, index) => `${index + 1}. ${group.title}\n${group.text}`).join('\n\n')}\n\n谢谢！`;
  modal('复制资料索取内容', `<p>已选 ${groups.length} 项，相同资料已合并。可以调整措辞后复制。</p><label for="analysisCopyText" class="analysis-copy-label">发给客户的内容</label><textarea id="analysisCopyText" class="analysis-copy-text">${esc(text)}</textarea><p id="analysisCopyStatus" role="status" class="analysis-copy-status">复制后，由你通过飞书、邮件等现有渠道发送。</p>`, '<button data-analysis-action="selectText">选中文本</button><button class="primary" data-analysis-action="copy">复制内容</button>');
  document.getElementById('dialog').classList.add('analysis-dialog');
  document.getElementById('dialog').addEventListener('close', () => { analysisCopyOperation++; document.getElementById('dialog').classList.remove('analysis-dialog'); }, { once: true });
}
async function analysisCopy(button) {
  const operation = ++analysisCopyOperation;
  const text = document.getElementById('analysisCopyText').value;
  const status = document.getElementById('analysisCopyStatus');
  button.disabled = true;
  try {
    await navigator.clipboard.writeText(text);
    if (operation !== analysisCopyOperation) return;
    status.textContent = '已复制。可粘贴到现有沟通渠道；资料缺口仍保留。';
  } catch {
    if (operation !== analysisCopyOperation) return;
    status.textContent = '浏览器未允许自动复制。请点击“选中文本”，再使用系统复制快捷键。';
  } finally { if (operation === analysisCopyOperation) button.disabled = false; }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.task === 'analysis') { analysisView.section = 'overview'; analysisView.historyMode = false; analysisSave(); }
  if (button.dataset.analysisSection) {
    analysisView.section = button.dataset.analysisSection;
    analysisView.active = null;
    analysisView.detail = false;
    analysisRefresh();
    document.querySelector(`[data-analysis-section="${analysisView.section}"]`)?.focus();
  }
  if (button.dataset.analysisOpen) { analysisView.active = button.dataset.analysisOpen; analysisView.detail = true; analysisRefresh(); document.querySelector('.analysis-detail')?.focus(); }
  for (const [key, section] of [['analysisFile', 'plan'], ['analysisRequest', 'customer'], ['analysisConsultant', 'consultant']]) {
    if (button.dataset[key]) { analysisView.section = section; analysisView.active = button.dataset[key]; analysisView.detail = true; if (section === 'customer') { analysisView.query = ''; analysisView.kind = 'ALL'; } analysisRefresh(); document.querySelector('.analysis-detail')?.focus(); }
  }
  const action = button.dataset.analysisAction;
  if (action === 'retry') { analysisLoadState = 'idle'; render(); }
  if (action === 'all' || action === 'clear') { analysisView.selected = action === 'all' ? analysisGroups.map(group => group.key) : []; analysisRefresh(); document.querySelector('[data-analysis-action="all"], [data-analysis-action="clear"]')?.focus(); }
  if (action === 'clearFilter') { analysisView.query = ''; analysisView.kind = 'ALL'; analysisRefresh('analysisSearch'); }
  if (action === 'list') { analysisView.detail = false; analysisRefresh(); document.querySelector('[data-analysis-open][aria-current="true"], .analysis-plan-item.active')?.focus(); }
  if (action === 'previewCopy') analysisOpenCopy();
  if (action === 'copy') void analysisCopy(button);
  if (action === 'selectText') { const textarea = document.getElementById('analysisCopyText'); textarea.focus(); textarea.select(); }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'analysisSearch' || event.isComposing) return;
  analysisView.query = event.target.value;
  analysisView.detail = false;
  analysisRefresh('analysisSearch');
});
document.addEventListener('compositionend', event => {
  if (event.target.id !== 'analysisSearch') return;
  analysisView.query = event.target.value; analysisView.detail = false; analysisRefresh('analysisSearch');
});
document.addEventListener('change', event => {
  if (event.target.id === 'analysisKind') { analysisView.kind = event.target.value; analysisView.detail = false; analysisRefresh('analysisKind'); }
  if (event.target.dataset.analysisSelect) {
    const key = event.target.dataset.analysisSelect;
    analysisView.selected = event.target.checked ? analysisUnique([...analysisView.selected, key]) : analysisView.selected.filter(value => value !== key);
    analysisSave();
    document.getElementById('analysisSelectedCount').textContent = `已选 ${analysisView.selected.length} / ${analysisGroups.length} 项`;
    document.getElementById('analysisCopyButton').disabled = !analysisView.selected.length;
    const all = document.querySelector('[data-analysis-action="all"], [data-analysis-action="clear"]');
    all.dataset.analysisAction = analysisView.selected.length === analysisGroups.length ? 'clear' : 'all';
    all.textContent = analysisView.selected.length === analysisGroups.length ? '取消全选' : '选取全部';
  }
});
Object.assign(window, { analysisRoute, analysisBoardTask, analysisResetDemo, analysisOpenPlanFeedback, analysisPlanFeedbackPending });

// Fixed supplementary-input scenario. No upload, extraction, analysis or business resolution occurs here.
const analysisRecheckKey = 'zhiju-analysis-recheck-demo-v1';
const analysisRecheckExampleText = '补充现行岗位职责文件。组织图的可读版本和软件使用情况仍在向客户确认。';
const analysisRecheckInitial = () => ({ draft: '', attachments: [], submissions: [], status: 'draft', hasReport: false, notice: '', pane: 'input', demoOutcome: 'report' });
let analysisRecheck;
try { analysisRecheck = JSON.parse(sessionStorage.getItem(analysisRecheckKey)); } catch { /* Use the initial fixture state. */ }
if (!analysisRecheck || !Array.isArray(analysisRecheck.submissions) || !Array.isArray(analysisRecheck.attachments)) analysisRecheck = analysisRecheckInitial();
let analysisRecheckTimer = null;
let analysisRecheckFinishing = false;
let analysisRecheckEpoch = 0;
let analysisFollowupLoading = null;
function analysisRecheckSave() { try { sessionStorage.setItem(analysisRecheckKey, JSON.stringify(analysisRecheck)); } catch { /* Prototype preferences are not server drafts. */ } }
// Plan feedback is a separate consultant record; it never enters customer-material reanalysis.
const analysisPlanFeedbackKey = 'zhiju-analysis-plan-feedback-demo-v1';
const analysisPlanFeedbackInitial = () => ({ context: null, drafts: {}, submissions: [], notice: '' });
let analysisPlanFeedback;
try { analysisPlanFeedback = JSON.parse(sessionStorage.getItem(analysisPlanFeedbackKey)); } catch { /* Use an empty demo record. */ }
if (!analysisPlanFeedback || !Array.isArray(analysisPlanFeedback.submissions) || !analysisPlanFeedback.drafts || typeof analysisPlanFeedback.drafts !== 'object') analysisPlanFeedback = analysisPlanFeedbackInitial();
function analysisPlanFeedbackSave() { try { sessionStorage.setItem(analysisPlanFeedbackKey, JSON.stringify(analysisPlanFeedback)); } catch { /* Demo records are not server persistence. */ } }
function analysisPlanFeedbackReset() { analysisPlanFeedback = analysisPlanFeedbackInitial(); try { sessionStorage.removeItem(analysisPlanFeedbackKey); } catch { /* Optional demo storage. */ } }
function analysisPlanFeedbackReportKey() { return `${analysisView.reportEdition || 'initial'}:${analysisReport?.narrative.sha256 || ''}`; }
function analysisPlanFeedbackDraftKey(context) { return `${context.reportKey}:${context.fileId}:${context.changeId}`; }
function analysisPlanFeedbackContextValid() {
  const context = analysisPlanFeedback.context;
  return Boolean(context && !analysisView.historyMode && context.reportKey === analysisPlanFeedbackReportKey()
    && analysisReport.plannedFiles.some(file => file.id === context.fileId)
    && analysisReport.changes.some(change => change.id === context.changeId && change.targetPlannedFileIds.includes(context.fileId)));
}
function analysisPlanFeedbackPending(fileId) { return analysisPlanFeedback.submissions.some(submission => submission.fileId === fileId); }
function analysisOpenPlanFeedback(fileId, changeId) {
  if (!analysisReport || analysisView.historyMode) return;
  const file = analysisReport.plannedFiles.find(item => item.id === fileId);
  const change = analysisReport.changes.find(item => item.id === changeId && item.targetPlannedFileIds.includes(fileId));
  if (!file || !change) return;
  analysisConsultantReviewClearContext();
  analysisPlanFeedback.context = { reportKey: analysisPlanFeedbackReportKey(), fileId, changeId, fileTitle: file.title, changeTitle: change.title };
  analysisPlanFeedback.notice = '';
  analysisPlanFeedbackSave();
  analysisView.section = 'overview';
  analysisRefresh('analysisRecheckInput');
  document.getElementById('analysisRecheckInput')?.scrollIntoView({ block: 'nearest' });
}
function analysisIsReportRoute() { return ['#analysis', '#analysis-supplement'].includes(location.hash); }
function analysisApplyReport(report, edition) {
  analysisView.reportSelections ||= {};
  if (analysisReport && Array.isArray(analysisView.selected)) analysisView.reportSelections[analysisView.reportEdition || 'initial'] = [...analysisView.selected];
  const priorSelection = analysisView.reportSelections[edition] ?? (!analysisReport ? analysisView.selected : null);
  analysisReport = report;
  analysisGroups = analysisGroupRequests(report.attentionItems);
  analysisView.reportEdition = edition;
  analysisView.selected = Array.isArray(priorSelection) ? priorSelection.filter(key => analysisGroups.some(group => group.key === key)) : analysisGroups.map(group => group.key);
  analysisSave();
}
async function analysisEnsureFollowup() {
  if (analysisReports.followup) return analysisReports.followup;
  if (!analysisFollowupLoading) analysisFollowupLoading = (async () => {
    const response = await fetch('analysis-report.followup.example.json?v=17', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Follow-up example unavailable');
    const report = await response.json();
    if (report.schemaVersion !== '0.1.0' || report.stage !== 'ANALYSIS' || report.context.previousReportSha256 !== 'f026ff916b100524bd117f32070f650ed2d6819a56675bd260aadd693e49ee6f') throw new Error('Invalid fixed follow-up');
    analysisGroupRequests(report.attentionItems);
    analysisReports.followup = report;
    return report;
  })().finally(() => { analysisFollowupLoading = null; });
  return analysisFollowupLoading;
}
async function analysisEnsureOrgReport(baseEdition = analysisRecheck.orgReportBase || 'initial') {
  const previousDigest = { initial: 'f026ff916b100524bd117f32070f650ed2d6819a56675bd260aadd693e49ee6f', followup: 'ec5ba806d5c972b1984ca0a1f2524f24127201fd1ce08c227a7184b502ad6598' }[baseEdition];
  if (!previousDigest) throw new Error('Unsupported base edition');
  if (analysisReports.orgfollowup && analysisReports.orgfollowup.context.previousReportSha256 === previousDigest) return analysisReports.orgfollowup;
  const base = baseEdition === 'followup' ? await analysisEnsureFollowup() : analysisReports.initial;
  if (!base) throw new Error('Missing base report');
  const response = await fetch(`analysis-report.org-${baseEdition}.example.json?v=25`, { cache: 'no-cache' });
  if (!response.ok) throw new Error('Organization supplement example unavailable');
  const report = await response.json();
  if (report.schemaVersion !== '0.1.0' || report.stage !== 'ANALYSIS' || report.context.previousReportSha256 !== previousDigest) throw new Error('Invalid organization supplement binding');
  analysisGroupRequests(report.attentionItems);
  analysisReports.orgfollowup = report;
  return report;
}
async function analysisReturnOrgExample() {
  if (analysisRecheckBusy() || analysisView.historyMode || analysisRecheck.hasOrgReport) return;
  const baseEdition = analysisView.reportEdition || 'initial';
  if (!['initial', 'followup'].includes(baseEdition)) return;
  const baseKey = analysisPlanFeedbackReportKey();
  try {
    const report = await analysisEnsureOrgReport(baseEdition);
    if (analysisPlanFeedbackReportKey() !== baseKey || analysisRecheckBusy() || analysisView.historyMode) return;
    analysisRecheck.orgReportBase = baseEdition;
    analysisRecheck.hasOrgReport = true;
    analysisRecheck.status = 'ready';
    analysisRecheck.notice = '演示：组织资料补充后的报告已返回；已有轮次和未提交草稿保留。';
    analysisRecheckSave();
    analysisApplyReport(report, 'orgfollowup');
    analysisView.section = 'overview';
    analysisRefresh();
  } catch { analysisRecheck.notice = '补充示例报告无法载入，原报告与草稿保持不变。'; analysisRecheckSave(); analysisRenderRecheck(); }
}
function analysisRecheckBusy() { return ['queued', 'checking'].includes(analysisRecheck.status); }
function analysisRecheckCanSubmit() { return !(analysisView.historyMode && analysisView.reportEdition !== analysisLatestEdition()) && !analysisRecheckBusy() && Boolean(analysisRecheck.draft.trim() || analysisRecheck.attachments.length); }
function analysisRecheckReset() {
  clearTimeout(analysisRecheckTimer); analysisRecheckTimer = null;
  analysisRecheckEpoch++; analysisRecheckFinishing = false;
  analysisRecheck = analysisRecheckInitial();
  delete analysisReports.orgfollowup;
  if (analysisReports.initial) { analysisReport = null; analysisApplyReport(analysisReports.initial, 'initial'); }
  analysisRecheckSave();
}
function analysisRenderRecheck() {
  if (!analysisIsReportRoute()) { if (location.hash === '#board' || !location.hash) render(); return; }
  const input = document.getElementById('analysisRecheckInput');
  const focused = input && document.activeElement === input;
  const selection = focused ? [input.selectionStart, input.selectionEnd] : null;
  render();
  if (focused) { const next = document.getElementById('analysisRecheckInput'); next?.focus({ preventScroll: true }); next?.setSelectionRange(...selection); }
}
function analysisRecheckSchedule() {
  if (!analysisRecheckBusy() || analysisRecheckTimer || analysisRecheckFinishing) return;
  const submission = analysisRecheck.submissions.at(-1);
  if (!submission) { analysisRecheck.status = 'failed'; analysisRecheckSave(); return; }
  if (analysisRecheck.status === 'queued' && Date.now() >= submission.startedAt) { analysisRecheck.status = 'checking'; analysisRecheckSave(); }
  const due = analysisRecheck.status === 'queued' ? submission.startedAt : submission.returnedAt;
  analysisRecheckTimer = setTimeout(() => {
    analysisRecheckTimer = null;
    if (analysisRecheck.submissions.at(-1)?.id !== submission.id || !analysisRecheckBusy()) return;
    if (Date.now() >= submission.returnedAt) void analysisFinishRecheck(submission);
    else { analysisRecheck.status = 'checking'; analysisRecheckSave(); analysisRenderRecheck(); analysisRecheckSchedule(); }
  }, Math.max(0, due - Date.now()));
}
async function analysisFinishRecheck(submission) {
  if (analysisRecheckFinishing) return;
  analysisRecheckFinishing = true;
  const epoch = analysisRecheckEpoch;
  const current = () => epoch === analysisRecheckEpoch && analysisRecheck.submissions.at(-1)?.id === submission.id;
  try {
    if (submission.demoOutcome === 'failure') throw new Error('Simulated failure');
    if (!submission.fixedExample) {
      if (!current()) return;
      submission.result = 'unhandled'; analysisRecheck.status = 'unhandled';
    } else {
      const report = await analysisEnsureFollowup();
      if (!current()) return;
      submission.result = 'report'; analysisRecheck.status = 'ready'; analysisRecheck.hasReport = true;
      if (analysisIsReportRoute() && analysisView.section === 'overview' && !analysisView.historyMode && !document.getElementById('dialog').open) analysisApplyReport(report, 'followup');
    }
  } catch {
    if (!current()) return;
    submission.result = 'failed'; analysisRecheck.status = 'failed';
  } finally {
    if (current()) { analysisRecheckFinishing = false; analysisRecheckSave(); analysisRenderRecheck(); }
  }
}
function analysisRoundControls() {
  const latest = analysisView.reportEdition === analysisLatestEdition();
  const history = analysisView.historyMode && !latest;
  const pending = !latest && !history;
  return `<div class="analysis-round-actions"><span role="status">${esc(history ? `正在查看${analysisReportLabel()}` : analysisRecheck.notice || (analysisView.reportEdition === 'orgfollowup' ? '新增组织说明已读 · 范围需再次确认' : analysisView.reportEdition === 'followup' ? '本轮已补充职责资料 · 解决建议待核对' : pending ? '新报告已返回，返回总览即可查看' : '先补齐资料，再确认升级范围'))}</span><details class="analysis-history"><summary>报告记录</summary><div class="analysis-history-menu">${analysisLatestEdition() !== 'initial' ? `<button data-recheck="${latest ? 'view-initial' : 'view-latest'}">${latest ? '查看首轮报告' : '返回当前报告'}</button>` : '<p>当前为首轮报告</p>'}${analysisRecheck.hasOrgReport && analysisRecheck.hasReport && analysisView.reportEdition !== 'followup' ? '<button data-recheck="view-duties">查看补充职责后的报告</button>' : ''}${latest && analysisLatestEdition() !== 'initial' ? '<button data-recheck="changes">本轮变化与依据</button>' : ''}<button data-recheck="submissions" ${analysisRecheck.submissions.length ? '' : 'disabled'}>补充记录${analysisRecheck.submissions.length ? ` · ${analysisRecheck.submissions.length}` : ''}</button></div></details></div>`;
}

function analysisResolutionHint() {
  if (analysisView.reportEdition === 'orgfollowup') return '<button class="analysis-resolution-hint" data-recheck="changes">本轮变化：新增组织说明；质量手册可另行确认 →</button>';
  if (analysisView.reportEdition !== 'followup') return '';
  return '<button class="analysis-resolution-hint" data-recheck="changes">岗位职责资料：建议已解决，待核对 <span aria-hidden="true">↗</span></button>';
}
function analysisShowChanges() {
  if (analysisView.reportEdition === 'orgfollowup') {
    modal('补齐组织资料后的变化（演示）', '<div class="analysis-recheck-changes"><section><h3>新增可读组织关系说明</h3><p>组织图读取需求建议已解决，仍需正式核对。原 DOCX 的读取限制保留；本轮使用新增说明作为补充依据。</p><a href="analysis-org-source.example.md" download>查看匿名补充资料</a></section><section><h3>质量手册新增可处理条件</h3><p>顾问可以逐份勾选并确认，将手册提交为后续一轮请求。已有轮次继续；实际执行由服务器安排。</p></section><section><h3>岗位职责制度仍需等待</h3><p>保护冲突没有解除。软件使用事实仍待客户回复；已有候选、批准与草稿不改变。</p></section></div>', '');
    return;
  }
  const report = analysisReports.followup;
  if (!report) return;
  modal('本轮复核变化', `<div class="analysis-recheck-changes"><p class="analysis-change-status">首轮报告 → 补充职责资料后的复核报告（演示）</p><section><h3>1 项资料需求：建议已解决，待核对</h3><p>现行岗位职责文件已有新增依据。首轮两条相关事项合并为同一项资料需求，Runner 建议不再索取。</p><p class="analysis-fine-print">这是报告中的解决建议，尚未形成正式关闭记录。</p></section><section><h3>仍需客户补充 2 项</h3><p>组织图的可读版本；软件与电子记录使用情况。</p></section><section><h3>拟交付范围有一处建议调整</h3><p>岗位职责制度由“参考模板新建”改为“适配客户现有文件”。拟交付仍为 4 份；组织职责冲突保留，尚未确认生成。</p></section><details class="analysis-disclosure"><summary>查看新增依据与原问题</summary><p>新增资料：现行岗位职责.md · 职责条款示例</p><blockquote>${esc(report.evidence.find(item => item.id === 'E-ROLE-NEW').quote)}</blockquote><p>首轮事项：补充引用的职责制度；职责制度派生稿缺少企业依据。</p><a href="analysis-supplement-source.example.md" download>下载匿名资料示例</a></details></div>`, '<button data-recheck="changed-file">查看职责文件计划</button>');
}
function analysisSubmissionHistory() {
  modal('补充记录', `<div class="analysis-recheck-changes">${[...analysisRecheck.submissions].reverse().map((submission, index) => `<section><h3>第 ${analysisRecheck.submissions.length - index} 次补充 · ${submission.result === 'report' ? '报告已返回' : submission.result === 'failed' ? '分析未成功' : submission.result === 'unhandled' ? '原型未分析' : '等待结果'}</h3><p>${esc(submission.text || '本次仅添加资料，未填写说明。')}</p>${submission.attachments.map(file => `<span class="analysis-submitted-file">${esc(file.name)}</span>`).join('')}<p class="analysis-fine-print">基于${analysisReportLabel(submission.baseEdition)}提交，未包含之后填写的草稿。</p></section>`).join('')}</div>`, '');
}
function analysisComposer() {
  if (analysisView.reportEdition !== analysisLatestEdition() && analysisView.historyMode) return '<footer class="analysis-history-footer"><p>正在查看历史报告，补充内容请提交到当前报告。</p><button data-recheck="view-latest">返回当前报告 →</button></footer>';
  const consultantComposer = analysisConsultantReviewComposer();
  if (consultantComposer) return consultantComposer;
  const context = analysisPlanFeedback.context;
  if (context) {
    const valid = analysisPlanFeedbackContextValid();
    const draft = analysisPlanFeedback.drafts[analysisPlanFeedbackDraftKey(context)] || '';
    const status = valid ? analysisPlanFeedback.notice || '意见会引用这份文件的当前处理事项；提交后需等待 Runner 返回修订计划。' : '报告已更新，原事项引用不再适用。草稿仍保留；请回到当前计划重新定位。';
    return `<section class="analysis-composer analysis-composer-plan" aria-label="顾问计划意见"><div class="analysis-compose-context"><div><span>顾问计划意见 · ${esc(analysisReportLabel())}</span><strong>${esc(context.fileTitle)} / ${esc(context.changeTitle)}</strong></div><button data-plan-feedback="exit">返回资料补充</button></div><div class="analysis-compose-row"><label for="analysisRecheckInput" class="sr-only">对该处理事项的意见</label><textarea id="analysisRecheckInput" rows="1" placeholder="说明不同意的原因，以及建议如何调整计划…" ${valid ? '' : 'disabled'}>${esc(draft)}</textarea><button class="primary" data-plan-feedback="submit" ${valid && draft.trim() ? '' : 'disabled'}>提交计划意见</button></div><div class="analysis-compose-status"><p role="status">${esc(status)}<span id="analysisRecheckDraftState">${draft ? ' · 草稿未提交' : ''}</span></p><small>仅演示记录；不作为客户资料，也不自动修改报告。</small></div></section>`;
  }
  const busy = analysisRecheckBusy();
  const hasDraft = Boolean(analysisRecheck.draft || analysisRecheck.attachments.length);
  const earlierResult = analysisView.reportEdition === 'orgfollowup' && analysisRecheck.submissions.at(-1)?.baseEdition !== 'orgfollowup';
  const status = busy ? '正在分析补充资料，完成后在此更新。新草稿不会自动提交。' : !earlierResult && analysisRecheck.status === 'failed' ? '本次分析未成功，原报告和提交内容已保留。' : !earlierResult && analysisRecheck.status === 'unhandled' ? '内容已保留；原型未分析任意输入，报告未改变。' : analysisView.reportEdition !== 'initial' ? `总览已更新，仍需客户补充 ${analysisGroups.length} 项。新增文件仍须确认范围。` : '可以先补充一部分，提交后更新分析报告。';
  return `<section class="analysis-composer" aria-labelledby="analysisSupplementTitle"><div class="analysis-compose-context"><div><strong id="analysisSupplementTitle">补充客户资料，更新分析报告</strong></div></div><div class="analysis-compose-row"><button data-recheck="attach" title="添加 DOCX、Markdown 或 ZIP">＋ 资料</button><label for="analysisRecheckInput" class="sr-only">说明本次新增资料或客户回复（选填）</label><textarea id="analysisRecheckInput" rows="1" placeholder="说明本次新增资料或客户回复（选填）">${esc(analysisRecheck.draft)}</textarea><button class="primary" data-recheck="submit" ${analysisRecheckCanSubmit() ? '' : 'disabled'}>${busy ? '正在分析' : '提交补充'}</button></div><input id="analysisRecheckFiles" class="analysis-recheck-file-input" type="file" accept=".docx,.md,.markdown,.zip" multiple aria-label="选择补充资料">${analysisRecheck.attachments.length ? `<div class="analysis-compose-files">${analysisRecheck.attachments.map(file => `<span>${esc(file.name)}${file.example ? '<small>演示</small>' : ''}<button data-recheck="remove" data-id="${esc(file.id)}" aria-label="移除${esc(file.name)}">×</button></span>`).join('')}</div>` : ''}<div class="analysis-compose-status"><p role="status">${esc(status)}${!earlierResult && analysisRecheck.status === 'failed' ? ' <button data-recheck="retry">重试</button>' : ''}<span id="analysisRecheckDraftState">${hasDraft ? ' · 草稿未提交，仅当前页保留' : ''}</span></p><details class="analysis-demo-options"><summary>演示选项</summary><div><p>固定匿名示例，未接入上传或 Runner。</p><button data-recheck="org-report" ${busy || analysisView.historyMode || analysisRecheck.hasOrgReport ? 'disabled' : ''}>模拟组织资料补充后的报告返回</button><a href="analysis-org-source.example.md" download>查看匿名资料示例</a><button data-recheck="example" ${busy || analysisRecheck.hasReport || analysisRecheck.hasOrgReport || hasDraft ? 'disabled' : ''}>带入职责资料示例</button><label>返回结果<select id="analysisRecheckOutcome" ${busy ? 'disabled' : ''}><option value="report" ${analysisRecheck.demoOutcome === 'report' ? 'selected' : ''}>返回报告</option><option value="failure" ${analysisRecheck.demoOutcome === 'failure' ? 'selected' : ''}>分析失败</option></select></label><button data-recheck="restart-example" ${busy || hasDraft ? 'disabled' : ''}>从首轮重新演示</button></div></details></div></section>`;
}

async function analysisOpenFollowup() {
  if (analysisLatestEdition() === 'initial') return;
  try {
    const edition = analysisLatestEdition();
    const report = edition === 'orgfollowup' ? await analysisEnsureOrgReport() : await analysisEnsureFollowup();
    analysisApplyReport(report, edition);
    analysisView.historyMode = false;
    analysisRecheck.notice = ''; analysisRecheckSave();
    analysisView.section = 'overview'; analysisView.active = null; analysisView.detail = false;
    analysisSave();
    if (location.hash === '#analysis') render(); else location.hash = 'analysis';
  } catch { analysisRecheck.notice = '复核报告暂时无法载入，当前报告保持不变。'; analysisRecheckSave(); analysisRenderRecheck(); }
}
document.addEventListener('click', event => {
  const button = event.target.closest('button[data-recheck]');
  if (!button) return;
  const action = button.dataset.recheck;
  if (action === 'org-report') void analysisReturnOrgExample();
  if (action === 'view-duties' && analysisReports.followup) { analysisView.historyMode = true; analysisApplyReport(analysisReports.followup, 'followup'); analysisView.section = 'overview'; analysisRefresh(); }
  if (action === 'open') { analysisView.section = 'overview'; analysisRefresh('analysisRecheckInput'); }
  if (action === 'copy-requests') analysisOpenCopy(true);
  if (action === 'submissions') analysisSubmissionHistory();
  if (action === 'restart-example' && !analysisRecheckBusy() && !analysisRecheck.draft && !analysisRecheck.attachments.length) { analysisResetDemo(); render(); }
  if (action === 'view-latest') { document.getElementById('dialog').close(); void analysisOpenFollowup(); }
  if (action === 'view-initial') { analysisView.historyMode = true; analysisApplyReport(analysisReports.initial, 'initial'); analysisView.section = 'overview'; analysisRefresh(); }
  if (action === 'changes') analysisShowChanges();
  if (action === 'changed-file') { document.getElementById('dialog').close(); analysisView.section = 'plan'; analysisView.active = 'F-ROLE'; analysisView.detail = true; analysisRefresh(); document.querySelector('.analysis-detail')?.focus(); }
  if (action === 'example') {
    if (analysisRecheckBusy() || analysisRecheck.hasReport || analysisRecheck.draft || analysisRecheck.attachments.length) return;
    analysisRecheck.draft = analysisRecheckExampleText;
    analysisRecheck.attachments = [{ id: crypto.randomUUID(), name: '现行岗位职责.md', example: true }];
    analysisRecheck.notice = '已带入固定匿名示例；仍需点击提交，不会立即更新报告。';
    analysisRecheckSave(); render(); document.getElementById('analysisRecheckInput')?.focus();
  }
  if (action === 'attach') document.getElementById('analysisRecheckFiles').click();
  if (action === 'remove') { analysisRecheck.attachments = analysisRecheck.attachments.filter(file => file.id !== button.dataset.id); analysisRecheckSave(); render(); document.querySelector('[data-recheck="attach"]')?.focus(); }
  if (action === 'submit') {
    if (!analysisRecheckCanSubmit()) return;
    const text = analysisRecheck.draft.trim();
    const attachments = analysisRecheck.attachments.map(file => ({ ...file }));
    const fixedExample = !analysisRecheck.hasOrgReport && !analysisRecheck.hasReport && analysisView.reportEdition !== 'followup' && text === analysisRecheckExampleText && attachments.length === 1 && attachments[0].example === true && attachments[0].name === '现行岗位职责.md';
    const now = Date.now();
    analysisRecheck.submissions.push({ id: crypto.randomUUID(), text, attachments, baseEdition: analysisView.reportEdition || 'initial', fixedExample, demoOutcome: analysisRecheck.demoOutcome, result: null, startedAt: now + 700, returnedAt: now + 1800 });
    analysisRecheck.draft = ''; analysisRecheck.attachments = []; analysisRecheck.notice = ''; analysisRecheck.status = 'queued';
    analysisRecheckSave(); render();
  }
  if (action === 'retry') {
    const submission = analysisRecheck.submissions.at(-1);
    if (!submission || analysisRecheck.status !== 'failed') return;
    submission.demoOutcome = 'report'; submission.result = null; submission.startedAt = Date.now() + 300; submission.returnedAt = Date.now() + 1200;
    analysisRecheck.status = 'queued'; analysisRecheckSave(); render();
  }
});
document.addEventListener('click', event => {
  const action = event.target.closest('button[data-plan-feedback]')?.dataset.planFeedback;
  if (!action) return;
  if (action === 'exit') {
    analysisPlanFeedback.context = null; analysisPlanFeedback.notice = ''; analysisPlanFeedbackSave();
    analysisRefresh('analysisRecheckInput');
  }
  if (action === 'submit' && analysisPlanFeedbackContextValid()) {
    const context = analysisPlanFeedback.context;
    const key = analysisPlanFeedbackDraftKey(context);
    const text = (analysisPlanFeedback.drafts[key] || '').trim();
    if (!text) return;
    analysisPlanFeedback.submissions.push({ id: crypto.randomUUID(), ...context, text, submittedAt: Date.now() });
    analysisPlanFeedback.drafts[key] = '';
    analysisPlanFeedback.notice = '计划意见已记录（演示）；原报告未修改，这份文件等待 Runner 返回修订计划。';
    analysisPlanFeedbackSave();
    analysisRefresh('analysisRecheckInput');
  }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'analysisRecheckInput') return;
  if (analysisConsultantReviewInput(event.target.value)) return;
  if (analysisPlanFeedback.context) {
    if (!analysisPlanFeedbackContextValid()) return;
    analysisPlanFeedback.drafts[analysisPlanFeedbackDraftKey(analysisPlanFeedback.context)] = event.target.value;
    analysisPlanFeedbackSave();
    document.querySelector('[data-plan-feedback="submit"]').disabled = !event.target.value.trim();
    document.getElementById('analysisRecheckDraftState').textContent = event.target.value ? ' · 草稿未提交' : '';
    return;
  }
  analysisRecheck.draft = event.target.value; analysisRecheckSave();
  document.querySelector('[data-recheck="submit"]').disabled = !analysisRecheckCanSubmit();
  document.getElementById('analysisRecheckDraftState').textContent = analysisRecheck.draft || analysisRecheck.attachments.length ? ' · 草稿未提交，仅当前页保留' : '';
  const restart = document.querySelector('[data-recheck="restart-example"]');
  if (restart) restart.disabled = analysisRecheckBusy() || Boolean(analysisRecheck.draft || analysisRecheck.attachments.length);
  const example = document.querySelector('[data-recheck="example"]');
  if (example) example.disabled = analysisRecheckBusy() || analysisRecheck.hasReport || Boolean(analysisRecheck.draft || analysisRecheck.attachments.length);
});
document.addEventListener('change', event => {
  if (event.target.id === 'analysisRecheckOutcome') { analysisRecheck.demoOutcome = event.target.value; analysisRecheckSave(); event.target.closest('details').open = false; }
  if (event.target.id !== 'analysisRecheckFiles') return;
  const files = [...event.target.files];
  const accepted = files.filter(file => /\.(docx|md|markdown|zip)$/i.test(file.name));
  analysisRecheck.attachments.push(...accepted.map(file => ({ id: crypto.randomUUID(), name: file.name, example: false })));
  analysisRecheck.notice = `${files.length - accepted.length ? `${files.length - accepted.length} 份不支持格式未加入。` : ''}本原型只保留文件名，未读取、解压或上传资料。`;
  analysisRecheckSave(); render(); document.querySelector('[data-recheck="attach"]')?.focus();
});

// A report refresh waits until the consultant closes a copy/evidence dialog.
document.getElementById('dialog').addEventListener('close', () => {
  if (analysisIsReportRoute() && analysisView.section === 'overview' && !analysisView.historyMode && analysisView.reportEdition !== analysisLatestEdition()) analysisRenderRecheck();
});
