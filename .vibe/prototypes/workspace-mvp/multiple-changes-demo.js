/* global esc, modal, render, document, window, location */
// Isolated layout and receipt fixtures. Execution artifacts and actual drafts are untouched.
const multiChangeGroups = [
  ['1 目的与适用范围', [
    ['目的表述', '本程序用于预防措施管理。', '本程序用于预防措施管理，文件与记录分别维护。'],
    ['适用范围', '适用于预防措施。', '适用于预防措施的识别、评估、实施与效果验证。'],
    ['与纠正措施的区别', '按相关程序执行。', '预防措施与纠正措施分别执行，关联事项保留交叉引用。'],
    ['术语说明', '潜在问题按本程序处理。', '“潜在问题”指尚未发生、但已有识别依据的问题。']
  ]],
  ['2 企业现有职责', [
    ['职责来源说明', '职责按企业现行安排执行。', '职责按企业现行安排执行；本次整理不采用模板中的示例岗位替换。'],
    ['部门名称核对', '使用现行部门名称。', '使用客户文件中的现行部门名称，引用处保持一致。'],
    ['汇报关系说明', '汇报关系保持不变。', '汇报关系保持不变；仅补充现有组织文件的引用位置。'],
    ['签批角色保留', '按原有角色签批。', '按原有角色签批，空白签字栏不得预填。']
  ]],
  ['3 信息来源', [
    ['客户反馈来源', '收集反馈信息。', '收集已有客户反馈信息，并保留来源文件与记录编号。'],
    ['内部记录引用', '查阅内部记录。', '查阅内部已有记录；缺失记录列入待补资料。'],
    ['历史数据时间范围', '使用历史数据。', '使用客户提供的历史数据，并注明数据所属时间范围。'],
    ['资料缺失说明', '资料不足时补充。', '资料不足时记录缺口，不以模板示例替代客户事实。']
  ]],
  ['4 潜在问题识别', [
    ['识别依据', '依据资料识别问题。', '依据已提供资料识别潜在问题，关联到具体来源位置。'],
    ['问题描述字段', '填写问题描述。', '填写问题描述、来源与影响范围；无依据内容保持待确认。'],
    ['产品流程边界', '遵循产品流程。', '遵循企业现有产品流程，本次整理不改变产品相关工艺与规定。'],
    ['关联文件说明', '查看相关文件。', '查看相关文件并保留引用；存在关联不等于授权修改。']
  ]],
  ['5 评估与确定措施', [
    ['评估记录引用', '记录评估过程。', '在现有评估记录中保留问题、依据与结论的对应关系。'],
    ['措施描述格式', '列明措施。', '按现有记录格式列明措施，缺失字段标注待补。'],
    ['责任安排引用', '按现有安排确定责任。', '按现有安排确定责任，并引用现行职责文件；不新增岗位。'],
    ['计划时间填写', '确定计划时间。', '计划时间由实际安排填写；模板日期不作为客户计划。']
  ]],
  ['6 实施与跟踪', [
    ['实施记录来源', '保留实施记录。', '保留企业已有实施记录，并注明本程序对应位置。'],
    ['进展说明字段', '记录实施进展。', '记录已有实施进展；未知状态标注待确认，不推定已完成。'],
    ['配套文件编号', '注明相关编号。', '注明配套文件原有编号；编号更新时保留原编号对应关系。'],
    ['异常情况记录', '记录异常情况。', '记录异常情况与现有处置依据，缺少依据时提出补充请求。']
  ]],
  ['7 效果验证', [
    ['验证记录关联', '保存验证记录。', '保存已有验证记录，并关联到相应预防措施。'],
    ['验证结果表述', '记录验证结果。', '按真实记录表述验证结果；文档升级不等于措施已有效。'],
    ['待验证情况', '必要时继续验证。', '尚未验证的事项保持待验证，不从模板复制通过结论。'],
    ['签字与日期空白', '填写签字日期。', '签字与日期由实际执行人员填写；现有空白继续保留。']
  ]],
  ['8 相关文件与记录', [
    ['记录编号显示', '使用预防措施记录。', '使用企业现有预防措施记录，并显示其原编号。'],
    ['程序引用名称', '参照纠正措施程序。', '参照企业现有纠正措施程序，保留准确的名称与编号。'],
    ['归档路径说明', '按规定归档。', '按企业现行规定归档，注明原有文件类别。'],
    ['客户资料追溯', '保存资料。', '保存客户提供的资料原件与来源信息，便于核对。']
  ]],
  ['9 修订与文件控制', [
    ['修订记录说明', '记录文件修订。', '记录本次文本整理的位置，便于顾问逐处核对。'],
    ['版本标识格式', '更新版本号。', '版本标识统一显示；正式生效仍依企业现行文件控制程序。'],
    ['历史版本保留', '保存旧版本。', '保留旧版本及对应改稿，不直接覆盖已批准文件。'],
    ['交付说明', '整理后提供文件。', '整理稿需检查与批准，下载本身不表示已生效或客户已收到。']
  ]]
];
const multiChanges = multiChangeGroups.flatMap(([chapter, rows]) => rows.map(([title, before, after]) => ({ chapter, title, before, after })));
const multiChangeState = { current: 0, tab: 'changes', pane: 'document', draft: '', query: '', chapterOpen: false };
function multiChangeDifference(before, after) {
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const middle = before.slice(prefix, before.length - suffix);
  const added = after.slice(prefix, after.length - suffix);
  return {
    before: `${esc(before.slice(0, prefix))}${middle ? `<del>${esc(middle)}</del>` : ''}${esc(before.slice(before.length - suffix))}`,
    after: `${esc(after.slice(0, prefix))}${added ? `<ins>${esc(added)}</ins>` : ''}${esc(after.slice(after.length - suffix))}`
  };
}
function multiChangeBody() {
  if (multiChangeState.tab === 'full') return `<div class="execution-document multi-change-document"><h2>预防措施程序（合成示例）</h2><p class="muted">全部 ${multiChanges.length} 处的修改后文本，用于查看完整文档效果。</p>${multiChangeGroups.map(([chapter, rows]) => `<h3>${esc(chapter)}</h3>${rows.map(([title, , after]) => `<section><h4>${esc(title)}</h4><p>${esc(after)}</p></section>`).join('')}`).join('')}</div>`;
  const item = multiChanges[multiChangeState.current], diff = multiChangeDifference(item.before, item.after);
  return `<article class="execution-change multi-change-detail"><div class="execution-change-heading"><strong id="multiChangeHeading" tabindex="-1">第 ${multiChangeState.current + 1} 处 · ${esc(item.title)}</strong><button data-multi-change="quote">对此处提意见</button></div><p class="muted">${esc(item.chapter)} · 文本整理示例</p><div class="multi-change-legend"><del>删除内容</del><ins>新增内容</ins><span>其余为未改动的文字</span></div><div class="execution-diff"><section><small>修改前（合成）</small><p>${diff.before}</p></section><section><small>修改后（合成）</small><p>${diff.after}</p></section></div><h3>上下文</h3><p>本节按企业现有文件安排执行。企业的岗位、组织关系、质量方针、质量目标和产品流程保持原样；缺少客户依据的内容继续待确认。</p><details class="multi-change-context" ${multiChangeState.chapterOpen ? 'open' : ''}><summary>本章节修改位置 · 4 处</summary>${multiChanges.map((change, index) => ({ ...change, index })).filter(change => change.chapter === item.chapter).map(change => `<button data-multi-change-index="${change.index}" aria-current="${change.index === multiChangeState.current ? 'step' : 'false'}"><span class="multi-chapter-number">${change.index + 1}</span><span><strong>${esc(change.title)}</strong><small>${esc(change.after)}</small></span><small>${change.index === multiChangeState.current ? '当前' : '查看变化 →'}</small></button>`).join('')}</details></article>`;
}
function multiChangeNavigation() {
  const index = multiChangeState.current, item = multiChanges[index];
  return `<nav class="multi-change-navigation" aria-label="本文件修改位置"><div class="multi-change-nav-title"><strong>本文件共 <b>${multiChanges.length}</b> 处修改</strong><button data-multi-change="directory" aria-haspopup="dialog">查看全部位置 ▤</button></div>${multiChangeState.tab === 'full' ? '<p class="multi-change-fixture-note">正在阅读完整文件；从目录选择位置可返回相应变化详情。</p>' : `<div class="multi-change-current"><span><small>当前 ${index + 1} / ${multiChanges.length}</small><strong>${esc(item.chapter)} · ${esc(item.title)}</strong></span><div class="row"><button data-multi-change="previous" ${index === 0 ? 'disabled' : ''}>↑ 上一处</button><button data-multi-change="next" ${index === multiChanges.length - 1 ? 'disabled' : ''}>下一处 ↓</button></div></div>`}</nav>`;
}
function multiChangesRoute() {
  if (!['#changes-preview', '#submission-preview'].includes(location.hash)) return null;
  const receipt = location.hash === '#submission-preview';
  return `<section class="execution-shell execution-review-shell multi-changes-shell ${receipt ? 'submission-preview-shell' : ''}"><div class="execution-heading"><div><div class="execution-crumb"><a href="${receipt ? '#changes-preview' : '#execution-review'}">${receipt ? '← 返回多处修改示例' : '← 返回刚才的文件检查'}</a><span>青禾制造 / 多处修改布局示例</span></div><h1>文件检查 · ${receipt ? '提交核验示例' : '多处修改示例'}</h1></div><p>1 份文件 · ${multiChanges.length} 处修改</p></div><div class="execution-pane-switch"><button data-multi-change-pane="document" aria-pressed="${multiChangeState.pane === 'document'}">查看文档</button><button data-multi-change-pane="feedback" aria-pressed="${multiChangeState.pane === 'feedback'}">意见与处理</button></div><div class="execution-review-grid pane-${multiChangeState.pane}"><nav class="execution-review-files" aria-label="示例文件"><button aria-current="true" disabled><strong>预防措施程序</strong><small>${multiChanges.length} 处修改 · 布局示例</small></button><p class="multi-change-fixture-note">内容为合成示例。用于体验多处变化的阅读与定位。</p></nav><section class="execution-review-content"><div class="execution-file-heading"><h2>预防措施程序</h2><p>QP23 · Markdown · 修改前 → 升级草稿（合成）</p>${!receipt ? '<a class="multi-preview-entry" href="#submission-preview">体验提交核验 ↗</a>' : ''}</div><nav class="execution-review-tabs" aria-label="示例内容"><button data-multi-change-tab="changes" aria-pressed="${multiChangeState.tab === 'changes'}">变化详情 · ${multiChanges.length}</button><button data-multi-change-tab="full" aria-pressed="${multiChangeState.tab === 'full'}">完整文件</button></nav><div class="execution-review-paper" tabindex="0" aria-label="多处变化阅读区">${multiChangeBody()}</div>${multiChangeNavigation()}</section><aside class="execution-review-feedback">${receipt ? window.receiptDemoFeedback() : `<label for="multiChangeFeedback">意见与处理</label><p>预防措施程序 · 多处修改示例</p><textarea id="multiChangeFeedback" placeholder="可以引用不同修改位置，在这里一起写意见…">${esc(multiChangeState.draft)}</textarea><small id="multiChangeDraftState">示例意见仅在本页保留，不提交执行</small><p class="execution-feedback-state">逐处查看不代表已检查完成。整份文件检查后，仍只提交一次意见或批准一次。</p><button class="primary" disabled>提交并修改</button><button disabled>检查完成并批准</button><p class="multi-change-fixture-note">本页仅演示布局，未发起修改或批准。</p>`}</aside></div></section>`;
}
function multiChangeDirectory() {
  const query = multiChangeState.query.toLowerCase();
  const filtered = multiChanges.map((item, index) => ({ ...item, index })).filter(item => `${item.chapter} ${item.title} ${item.before} ${item.after}`.toLowerCase().includes(query));
  return filtered.length ? multiChangeGroups.map(([chapter]) => {
    const items = filtered.filter(item => item.chapter === chapter);
    return items.length ? `<section><h3>${esc(chapter)}<small>${items.length} 处</small></h3>${items.map(item => `<button data-multi-change-index="${item.index}" aria-current="${item.index === multiChangeState.current ? 'step' : 'false'}"><span>${item.index + 1}</span><strong>${esc(item.title)}</strong>${item.index === multiChangeState.current ? '<small>当前</small>' : ''}</button>`).join('')}</section>` : '';
  }).join('') : '<p class="multi-change-empty">没有找到匹配位置，试试“编号”“职责”或“验证”。</p>';
}
function multiChangeOpenDirectory() {
  multiChangeState.query = '';
  modal(`全部修改位置 · ${multiChanges.length} 处`, `<p class="small muted">按章节查找，点击定位；不会标记检查完成。</p><label class="multi-change-search">查找修改位置<input id="multiChangeSearch" type="search" placeholder="输入章节、字段或关键词" autocomplete="off"></label><div class="multi-change-directory" id="multiChangeDirectory">${multiChangeDirectory()}</div>`, '');
  document.getElementById('multiChangeSearch').focus();
}
function multiChangeMove(index) {
  multiChangeState.current = Math.max(0, Math.min(multiChanges.length - 1, index));
  multiChangeState.tab = 'changes'; multiChangeState.pane = 'document'; render();
  document.getElementById('multiChangeHeading').focus({ preventScroll: true });
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || button.disabled || !['#changes-preview', '#submission-preview'].includes(location.hash)) return;
  multiChangeState.chapterOpen = Boolean(document.querySelector('.multi-change-context')?.open);
  const action = button.dataset.multiChange;
  if (action === 'directory') multiChangeOpenDirectory();
  if (action === 'previous' || action === 'next') multiChangeMove(multiChangeState.current + (action === 'next' ? 1 : -1));
  if (button.dataset.multiChangeIndex !== undefined) { document.getElementById('dialog').close(); multiChangeMove(Number(button.dataset.multiChangeIndex)); }
  if (button.dataset.multiChangeTab) { multiChangeState.tab = button.dataset.multiChangeTab; render(); }
  if (button.dataset.multiChangePane) { multiChangeState.pane = button.dataset.multiChangePane; render(); }
  if (action === 'quote') {
    const item = multiChanges[multiChangeState.current], reference = `关于第 ${multiChangeState.current + 1} 处 · ${item.chapter} / ${item.title}（布局示例）：`;
    const draft = location.hash === '#submission-preview' ? window.receiptDemoDraft() : multiChangeState.draft;
    const next = draft.includes(reference) ? draft : `${draft ? `${draft}\n\n` : ''}${reference}\n`;
    if (location.hash === '#submission-preview') window.receiptDemoDraft(next); else multiChangeState.draft = next;
    multiChangeState.pane = 'feedback'; render(); document.getElementById('multiChangeFeedback').focus();
  }
});
document.addEventListener('input', event => {
  if (!['#changes-preview', '#submission-preview'].includes(location.hash)) return;
  if (event.target.id === 'multiChangeFeedback') {
    if (location.hash === '#submission-preview') window.receiptDemoDraft(event.target.value);
    else { multiChangeState.draft = event.target.value; document.getElementById('multiChangeDraftState').textContent = '示例意见仅在本页保留，不提交执行'; }
  }
  if (event.target.id === 'multiChangeSearch') { multiChangeState.query = event.target.value.trim(); document.getElementById('multiChangeDirectory').innerHTML = multiChangeDirectory(); }
});
Object.assign(window, { multiChangesRoute });
