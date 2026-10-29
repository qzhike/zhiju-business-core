import { withMockControls } from './mock-controls.js';
import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFile, readdir } from 'node:fs/promises';

const base = '/projects/MVP-U1-PROJECT';
const overview = `${base}/overview`;
const intake = `${base}/intake`;
const reportOne = `${base}/analysis/U1-REPORT-01`;
const reportTwo = `${base}/analysis/U1-REPORT-02`;
const plan = `${base}/startup/U1-REPORT-02`;

async function openRehearsal(page: Page) {
  const details = page.locator('details.journey-rehearsal');
  await details.waitFor({ state: 'attached' });
  if ((await details.getAttribute('open')) === null)
    await withMockControls(page, async () => details.locator('summary').click());
}

async function rehearsalLink(page: Page, name: string) {
  const details = page.locator('details.journey-rehearsal');
  await details.waitFor({ state: 'attached' });
  await details.evaluate((element) => {
    element.setAttribute('open', '');
  });
  const link = details.locator('a', { hasText: name }).first();
  const href = await link.getAttribute('href');
  if (!href) throw new Error(`Missing href for ${name}`);
  await page.evaluate((path) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, href);
}

async function confirmPlan(page: Page, scenario = 'received') {
  const controls = page.locator('.fixture-options');
  if (scenario !== 'received')
    await withMockControls(page, async () =>
      controls.getByLabel('确认回执场景').selectOption(scenario),
    );
  await page.getByRole('button', { name: '确认这份修改范围' }).click();
  await page.getByRole('button', { name: '确认并生成模拟回执' }).click();
}

async function openAnalysisControls(page: Page) {
  const details = page.locator('details.fixture-options', { hasText: 'U1 分析演示控制' });
  await details.waitFor({ state: 'attached' });
  if ((await details.getAttribute('open')) === null)
    await withMockControls(page, async () => details.locator('summary').click());
}

async function openReportRecords(page: Page) {
  await page.locator('details.analysis-records').evaluate((element) => {
    element.setAttribute('open', '');
  });
}

async function acknowledgeSecondReport(page: Page) {
  await page.goto(reportOne);
  await openAnalysisControls(page);
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click(),
  );
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
}

test('continuous journey keeps one project, explicit versions and return paths', async ({
  page,
}) => {
  await page.goto('/workbench?enterprise=U1-ENTERPRISE&project=MVP-U1-PROJECT');
  const card = page.getByRole('article', { name: 'M1 连续演练 · 当前任务', exact: true });
  await expect(card).toContainText('待开始分析');
  await expect(card).toContainText('资料 1 批');
  await card.getByRole('link', { name: '进入当前工作' }).click();
  await expect(page).toHaveURL(`${base}/work`);
  await expect(page.getByRole('heading', { level: 1, name: '当前工作' })).toBeVisible();
  await rehearsalLink(page, '项目概览（阅读）');
  await expect(page).toHaveURL(overview);
  await expect(page.getByRole('heading', { level: 1, name: '变更控制体系文件升级' })).toBeVisible();
  await expect(page.locator('.overview-steps > li')).toHaveCount(3);
  await expect(page.locator('.overview-levels > li')).toHaveCount(4);
  await expect(page.locator('.overview-steps')).toContainText('未开始');
  await expect(page.locator('.overview-progress')).toContainText('尚未开始');
  await expect(page.locator('.overview-levels')).toContainText('记录表单');
  const stagePanel = page.getByRole('region', { name: '三个业务阶段' });
  const levelPanel = page.getByRole('region', { name: '四个文件层级' });
  const stageBox = await stagePanel.boundingBox();
  const levelBox = await levelPanel.boundingBox();
  expect(stageBox).not.toBeNull();
  expect(levelBox).not.toBeNull();
  if (!stageBox || !levelBox) throw new Error('overview panels are not visible');
  expect(stageBox.y).toBeLessThan(levelBox.y);
  expect(Math.abs(stageBox.x - levelBox.x)).toBeLessThan(2);
  const stepBoxes = await page.locator('.overview-steps > li').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width) };
    }),
  );
  expect(stepBoxes).toHaveLength(3);
  expect(new Set(stepBoxes.map((box) => box.y)).size).toBe(1);
  expect(new Set(stepBoxes.map((box) => box.x)).size).toBe(3);
  await rehearsalLink(page, '资料（阅读）');
  await expect(page).toHaveURL(intake);
  await expect(page.getByRole('heading', { name: '准备首轮客户资料' })).toBeVisible();
  await expect(page.locator('.intake-batch')).toHaveCount(1);
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '演示：提交补充批次' }).click(),
  );
  await expect(page.locator('.intake-batch')).toHaveCount(2);
  await expect(page.locator('.intake-batch').first()).toContainText('U1-BATCH-01');
  await expect(page.locator('.intake-batch').nth(1)).toContainText('U1-BATCH-02');
  await expect(page.locator('.intake-batch').nth(1)).toContainText('补充批次');
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '演示：加入失败与不支持条目' }).click(),
  );
  await expect(page.locator('.batch-entries tr[data-state="UNSUPPORTED"]')).toContainText('PDF');
  await expect(
    page.locator('.batch-entries tr[data-state="FAILED"]', { hasText: 'XLS' }),
  ).toContainText('XLS');
  await page.getByRole('link', { name: '查看分析并记录客户答复' }).click();
  await expect(page).toHaveURL(reportOne);
  await expect(page.getByRole('heading', { name: '分析总览' })).toBeVisible();
  await expect(page.locator('main')).toContainText('U1-REPORT-01');
  await expect(page.getByText('先记录客户答复并核对新报告')).toBeVisible();
  await openRehearsal(page);
  await expect(
    page
      .locator('details.journey-rehearsal')
      .getByRole('link', { name: '修改范围', exact: true, includeHidden: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.goto(reportTwo);
  await expect(page.getByRole('heading', { name: '第 2 版分析尚未到达' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回第 1 版' })).toBeVisible();
  await rehearsalLink(page, '项目概览（阅读）');
  await expect(page).toHaveURL(overview);
  await expect(page.getByText('MVP-U1-PROJECT', { exact: false }).first()).toBeVisible();
  await page.goto(`${base}/analysis/UNKNOWN-REPORT`);
  await expect(page.getByRole('heading', { name: '无法打开此页面' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回工作台' })).toBeVisible();
  await page.goto(`${base}/startup/U1-REPORT-01`);
  await expect(page.getByRole('heading', { name: '无法打开此页面' })).toBeVisible();
  await page.goto(plan);
  await expect(page.getByRole('heading', { name: '先核对第 2 版分析' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回核对第 2 版分析' })).toBeVisible();
});

test('inputs distinguish batches, formats and non-analysis receipts', async ({ page }) => {
  await page.goto(intake);
  await expect(page.getByText('接收状态不代表读取完成、分析成功或阶段完成。')).toBeVisible();
  await expect(page.locator('.format-rules')).toContainText('旧 XLS 需员工先转换为 XLSX');
  await expect(page.locator('.format-rules')).toContainText('PDF');
  await expect(page.locator('.format-rules')).toContainText('暂不支持');
  await expect(page.locator('.batch-entries tbody tr')).toHaveCount(12);
  await expect(page.locator('.batch-entries')).toContainText('嵌套 RAR');
  await expect(page.locator('.batch-entries')).toContainText('Markdown');
  await expect(page.locator('.batch-entries tr[data-state="FAILED"]')).toContainText('损坏');
  await expect(page.locator('.format-rules')).toContainText('RAR');
  await expect(page.locator('.batch-questions')).toContainText('U1-Q1');
  await expect(page.locator('.batch-questions')).toContainText('读取受限');
  for (const [value, label] of [
    ['WAITING', '已接收 · 等待分析'],
    ['UNKNOWN', '接收结果待核验'],
    ['FAILED', '存在失败条目'],
    ['RECEIVING', '正在接收'],
  ] as const) {
    await withMockControls(page, async () => page.getByLabel('批次状态').selectOption(value));
    await expect(page.locator('.intake-batch').first()).toContainText(label);
  }
  await expect(page.locator('.batch-limitations')).toContainText('批注/修订');
  await expect(page.getByRole('button', { name: '提交并分析' })).toBeDisabled();
  await expect(page.locator('main')).toContainText('不通过真实上传');
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '演示：加入失败与不支持条目' }).click(),
  );
  await expect(page.locator('.batch-entries tbody tr')).toHaveCount(14);
  await expect(page.locator('main')).not.toContainText('分析报告已就绪');
});

test('answer and supplement produce a second report without losing the first', async ({ page }) => {
  await page.goto(reportOne);
  await expect(page.locator('.understanding-groups')).toContainText('来源事实');
  await expect(page.locator('.understanding-groups')).toContainText('已有覆盖');
  await expect(page.locator('.understanding-groups')).toContainText('适用缺口');
  await expect(page.locator('.understanding-groups')).toContainText('不适用');
  await expect(page.locator('.understanding-groups')).toContainText('资料不足');
  await expect(page.locator('.understanding-groups')).toContainText('冲突');
  await expect(page.locator('.understanding-groups')).toContainText('读取限制');
  await expect(page.locator('.template-applicability')).toContainText('T03');
  await openAnalysisControls(page);
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click(),
  );
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await expect(page.locator('.analysis-receipt').first()).toContainText('第 2 版分析已到达');
  await expect(page).toHaveURL(reportOne);
  await expect(page.getByRole('heading', { name: '分析总览' })).toBeVisible();
  await rehearsalLink(page, '项目概览（阅读）');
  await expect(page.locator('main')).toContainText('当前分析报告 U1-REPORT-01');
  await rehearsalLink(page, '资料（阅读）');
  await page.getByRole('link', { name: '查看分析并记录客户答复' }).click();
  await expect(page).toHaveURL(reportOne);
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await expect(page).toHaveURL(reportTwo);
  await expect(page.getByText('第 2 版尚未核对')).toBeVisible();
  await expect(page.getByRole('link', { name: '核对信息与文件范围 →' })).toHaveCount(0);
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
  await expect(page.getByRole('link', { name: '核对信息与文件范围 →' })).toBeVisible();
  await expect(page.locator('main')).toContainText('本轮变化');
  await rehearsalLink(page, '项目概览（阅读）');
  await expect(page.locator('main')).toContainText('当前分析报告 U1-REPORT-02');
  await rehearsalLink(page, '资料（阅读）');
  await rehearsalLink(page, '分析与澄清');
  await expect(page).toHaveURL(reportTwo);
  await openReportRecords(page);
  await page.getByRole('link', { name: /查看第 1 版/u }).click();
  await expect(page).toHaveURL(reportOne);
  await page.getByRole('button', { name: '拟交付文件' }).click();
  await page
    .locator('.analysis-list')
    .getByRole('button', { name: /变更实施记录/u })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: '新增变更实施记录' })).toHaveCount(1);
  await expect(page.getByText('按正式模板形成')).toBeVisible();
  await openReportRecords(page);
  await page.getByRole('link', { name: /查看第 1 版/u }).click();
  await expect(page).toHaveURL(reportOne);
  await expect(page.locator('main')).toContainText('历史报告 · 只读');
  await expect(page.locator('.analysis-receipt').first()).toContainText('已接收意见');
});

test('a later supplement stays visible but is marked outside the earlier analysis round', async ({
  page,
}) => {
  await page.goto(reportOne);
  await openAnalysisControls(page);
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click(),
  );
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await rehearsalLink(page, '处理结果（阅读）');
  await page.getByLabel('结果类型', { exact: true }).selectOption('ANALYSIS');
  await page.getByLabel('轮次', { exact: true }).selectOption('ANALYSIS-1');
  const supplement = page.locator('.results-table tr', { hasText: '变更记录清单' });
  await expect(supplement).toContainText('未纳入本轮（补充批次后到达）');
  await page.getByRole('button', { name: '本轮涉及' }).click();
  await expect(supplement).toHaveCount(0);
  await page.getByLabel('轮次', { exact: true }).selectOption('ANALYSIS-2');
  await expect(supplement).toContainText('作为分析依据');
});

test('analysis failure is distinct and a received opinion locks the composer', async ({ page }) => {
  await page.goto(reportOne);
  await page.getByRole('button', { name: '针对整个项目提意见' }).click();
  await openAnalysisControls(page);
  await withMockControls(page, async () => page.getByLabel('分析回执场景').selectOption('failed'));
  await page.getByRole('textbox', { name: '说明与意见' }).fill('失败的合成意见');
  await page.getByRole('button', { name: '提交项目级意见' }).click();
  await expect(page.locator('.analysis-receipt').first()).toContainText('复核失败');
  await expect(page.getByRole('button', { name: '提交项目级意见' })).toBeEnabled();
  await withMockControls(page, async () =>
    page.getByLabel('分析回执场景').selectOption('received'),
  );
  await page.getByRole('button', { name: '提交项目级意见' }).click();
  await expect(page.locator('.analysis-receipt').last()).toContainText('已接收意见');
  await expect(page.getByRole('button', { name: '提交项目级意见' })).toBeDisabled();
  await expect(page.locator('.analysis-receipt')).toHaveCount(2);
});

test('project, question and file-plan feedback keep their exact context', async ({ page }) => {
  await page.goto(reportOne);
  await page.getByRole('button', { name: '针对整个项目提意见' }).click();
  await expect(page.getByRole('region', { name: '上下文意见与补充' })).toContainText('项目级意见');
  await page.getByRole('textbox', { name: '说明与意见' }).fill('项目级：请保留客户编号习惯');
  await page.getByRole('button', { name: '提交项目级意见' }).click();
  await expect(page.locator('.analysis-receipt').first()).toContainText('已接收意见');

  await page.getByRole('button', { name: '切换客户补充' }).click();
  await page.getByRole('button', { name: '客户需补充' }).click();
  await page
    .getByRole('button', { name: /四层文件结构与编号迁移/u })
    .first()
    .click();
  await page.getByRole('button', { name: '补充客户资料' }).click();
  await expect(page.getByRole('region', { name: '上下文意见与补充' })).toContainText(
    '客户资料补充',
  );
  await page.getByRole('textbox', { name: '说明与意见' }).fill('问题答复：同意迁移');
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await expect(page.locator('.analysis-receipt').last()).toContainText('已接收意见');

  await page.getByRole('button', { name: '拟交付文件' }).click();
  await page
    .locator('.analysis-list')
    .getByRole('button', { name: /质量手册/u })
    .first()
    .click();
  await page.getByRole('button', { name: '对这项计划提意见' }).click();
  await expect(page.getByRole('region', { name: '上下文意见与补充' })).toContainText(
    '文件计划意见 · 质量手册',
  );
  await page.getByRole('textbox', { name: '说明与意见' }).fill('文件计划：保留现有审批职责');
  await page.getByRole('button', { name: '提交意见并复核' }).click();
  await expect(page.locator('.analysis-receipt').last()).toContainText('已接收意见');
});

test('scope confirmation, in-scope revision and expanded scope behave distinctly', async ({
  page,
}) => {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page).toHaveURL(plan);
  await expect(page.getByRole('heading', { name: '确认修改范围' })).toBeVisible();
  await expect(page.locator('.plan-file-list > li')).toHaveCount(6);
  await expect(page.locator('.plan-basis')).toContainText('U1-BATCH-01');
  await expect(page.locator('.plan-basis')).toContainText('U1-BATCH-02');
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '进入质量手册审阅（演示）' })).toBeDisabled();
  await confirmPlan(page);
  await expect(page.locator('.plan-receipt')).toContainText('回执与计划、报告版本和输入依据匹配');
  await expect(page.locator('.plan-receipt')).toContainText('U1-PLAN-01');
  await expect(page.locator('.plan-receipt')).toContainText('F-MANUAL');
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeEnabled();
  await page.getByRole('button', { name: '进入模拟生成（演示）' }).click();
  await expect(page.getByText('已登记模拟生成意图')).toBeVisible();
  await page.getByRole('button', { name: '进入质量手册审阅（演示）' }).click();
  await expect(page).toHaveURL(`${base}/stages/manual`);
  await expect(page.getByRole('heading', { name: '质量手册审阅' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await rehearsalLink(page, '修改范围');
  await expect(page).toHaveURL(plan);
  await page.getByRole('textbox', { name: /范围内反馈/u }).fill('请保留客户 I/II/III 类术语');
  await page.getByRole('button', { name: '提交范围内反馈（模拟修订请求）' }).click();
  await expect(page.locator('.analysis-receipt').last()).toContainText('范围不变，不需要再次确认');
  await page.getByRole('textbox', { name: /范围内反馈/u }).fill('第二条范围内意见：补充培训说明');
  await page.getByRole('button', { name: '提交范围内反馈（模拟修订请求）' }).click();
  await expect(page.locator('.analysis-receipt')).toHaveCount(2);
  await expect(page.locator('main')).toContainText('请保留客户 I/II/III 类术语');
  await expect(page.locator('main')).toContainText('第二条范围内意见：补充培训说明');
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeEnabled();
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '扩大范围：新增变更通知单（演示）' }).click(),
  );
  await expect(page.locator('.plan-file-list > li')).toHaveCount(7);
  await expect(page.locator('.analysis-receipt')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: /范围内反馈/u })).toHaveValue('');
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
  await confirmPlan(page);
  await expect(page.locator('.plan-receipt')).toContainText('U1-PLAN-02');
  await expect(page.locator('.plan-receipt')).toContainText('F-FORM-NOTICE');
  await expect(page.getByRole('button', { name: '进入质量手册审阅（演示）' })).toBeEnabled();
  await page.getByRole('button', { name: '第 1 版 · 已确认 · 演示回执' }).click();
  await expect(page.locator('.analysis-receipt')).toHaveCount(2);
  await expect(page.locator('.analysis-receipt').nth(0)).toContainText(
    '请保留客户 I/II/III 类术语',
  );
  await expect(page.locator('.analysis-receipt').nth(1)).toContainText(
    '第二条范围内意见：补充培训说明',
  );
  await expect(page.locator('.analysis-receipt').nth(0)).toContainText(/U1-REV-/u);
  await expect(page.locator('.analysis-receipt').nth(1)).toContainText(/U1-REV-/u);
  await expect(page.getByText(/此计划已被第 2\s*版计划替代/u)).toBeVisible();
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
  await expect(page.locator('.plan-history')).toContainText('U1-REQUEST-');
});

test('new plan arrival keeps the old reading view until an explicit switch', async ({ page }) => {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await confirmPlan(page);
  await expect(page.locator('.plan-receipt')).toContainText('U1-PLAN-01');
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '模拟新计划到达（不切换当前视图）' }).click(),
  );
  await expect(page).toHaveURL(plan);
  await expect(page.locator('.plan-page .eyebrow').first()).toContainText('计划第 1 版');
  await expect(page.getByText('新计划已到达，当前仍是第 1 版。')).toBeVisible();
  await expect(page.locator('.plan-receipt')).toContainText('U1-PLAN-01');
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
  await page.getByRole('button', { name: '查看第 2 版' }).click();
  await expect(page.locator('.plan-page .eyebrow').first()).toContainText('计划第 2 版');
  await expect(page.getByRole('button', { name: '确认这份修改范围' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
  await expect(page.locator('.plan-history')).toContainText('U1-REQUEST-');
});

test('PENDING confirmation keeps one request and offers only the same query', async ({ page }) => {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page).toHaveURL(plan);
  await withMockControls(page, async () =>
    page.locator('.fixture-options').getByLabel('确认回执场景').selectOption('pending'),
  );
  await confirmPlan(page);
  await expect(page.getByRole('status').filter({ hasText: '确认请求待回执' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查询同一确认请求' })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认这份修改范围' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
});

test('FAILED confirmation preserves the plan and allows one explicit retry', async ({ page }) => {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await withMockControls(page, async () =>
    page.locator('.fixture-options').getByLabel('确认回执场景').selectOption('failed'),
  );
  await confirmPlan(page);
  await expect(page.getByRole('alert')).toContainText('确认失败');
  await expect(page.getByRole('button', { name: '重新确认这份计划' })).toBeVisible();
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeDisabled();
});

test('UNKNOWN keeps the original intent across navigation and recovers only that request', async ({
  page,
}) => {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await withMockControls(page, async () =>
    page.locator('.fixture-options').getByLabel('确认回执场景').selectOption('unknown'),
  );
  await confirmPlan(page);
  await expect(page.getByRole('alert')).toContainText('确认结果未知（UNKNOWN）');
  await rehearsalLink(page, '分析与澄清');
  await rehearsalLink(page, '修改范围');
  await expect(page.getByRole('alert')).toContainText('确认结果未知（UNKNOWN）');
  await expect(page.getByRole('button', { name: '确认这份修改范围' })).toBeDisabled();
  await page.getByRole('button', { name: '重新查询原请求' }).click();
  await expect(page.getByText('原模拟请求仍无可匹配回执')).toBeVisible();
  await withMockControls(page, async () =>
    page.getByRole('button', { name: '模拟原请求回执到达' }).click(),
  );
  await page.getByRole('button', { name: '重新查询原请求' }).click();
  await expect(page.locator('.plan-receipt')).toHaveCount(1);
  await expect(page.getByText('未创建第二个意图')).toBeVisible();
  expect(await page.locator('.plan-receipt').count()).toBe(1);
  await expect(page.getByRole('button', { name: '进入模拟生成（演示）' })).toBeEnabled();
});

test('development marker, layouts and keyboard focus remain usable', async ({ page, browser }) => {
  console.log(`U1 controlled Chromium ${browser.version()}; user walkthrough still NOT RUN`);
  for (const path of [overview, intake, reportOne, plan]) {
    for (const [width, height] of [
      [1440, 900],
      [700, 900],
      [641, 900],
      [360, 800],
      [320, 800],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(path);
      await expect(page.getByRole('note').first()).toContainText('开发');
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      if (path === overview) {
        const steps = await page.locator('.overview-steps').boundingBox();
        const levels = await page.locator('.overview-levels').boundingBox();
        expect(steps && levels && steps.y + steps.height <= levels.y + 1).toBe(true);
        for (const step of await page.locator('.overview-steps li').all()) {
          expect(
            await step.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
          ).toBe(true);
        }
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  const confirm = page.getByRole('button', { name: '确认这份修改范围' });
  await confirm.focus();
  await expect(confirm).toBeFocused();
  await confirm.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeFocused();
});

test('production build excludes the U1 adapter and rehearsal content', async ({ page }) => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of [
      'DEVELOPMENT_U1_ADAPTER_ONLY',
      'MVP-U1-PROJECT',
      'U1-REPORT-01',
      'U1-PLAN-01',
      'M1 连续演练',
      'PF-POLICY',
      'TC-STRUCT',
    ])
      expect(source.includes(marker), `Production bundle must exclude ${marker}`).toBe(false);
  }
  await page.goto(overview);
  await expect(page.getByRole('heading', { name: '变更控制体系文件升级' })).toHaveCount(0);
});
