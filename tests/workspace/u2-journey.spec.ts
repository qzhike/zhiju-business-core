import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFile, readdir } from 'node:fs/promises';

const base = '/projects/MVP-U1-PROJECT';
const overview = `${base}/overview`;
const reportOne = `${base}/analysis/U1-REPORT-01`;
const plan = `${base}/startup/U1-REPORT-02`;
const manual = `${base}/stages/manual`;
const procedures = `${base}/stages/procedures`;
const records = `${base}/stages/records`;

async function acknowledgeSecondReport(page: Page) {
  await page.goto(reportOne);
  await page.locator('summary', { hasText: 'U1 分析演示控制' }).click();
  await page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click();
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
}

async function confirmPlan(page: Page, scenario = 'received') {
  const controls = page.locator('.fixture-options');
  if (scenario !== 'received') await controls.getByLabel('确认回执场景').selectOption(scenario);
  await page.getByRole('button', { name: '确认这份修改范围' }).click();
  await page.getByRole('button', { name: '确认并生成模拟回执' }).click();
}

async function reachManual(page: Page) {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page).toHaveURL(plan);
  await confirmPlan(page);
  await expect(page.locator('.plan-receipt')).toContainText('回执与计划、报告版本和输入依据匹配');
  await page.getByRole('button', { name: '进入质量手册审阅（演示）' }).click();
  await expect(page).toHaveURL(manual);
  await expect(page.getByRole('heading', { name: '质量手册审阅' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

async function generate(page: Page) {
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
  await expect(page.locator('.markdown-review')).toBeVisible();
}

async function submitOpinion(page: Page, text: string, scopeLabel?: string) {
  if (scopeLabel) await page.getByLabel('意见作用范围').selectOption({ label: scopeLabel });
  await page.locator('#markdown-note').fill(text);
  await page.getByRole('button', { name: '提交并修改' }).click();
}

async function finalizeStage(page: Page, stage: 'quality' | 'set', versionText: string) {
  await page.getByLabel('定稿回执场景').selectOption('matched');
  await page
    .getByRole('button', {
      name: stage === 'quality' ? '确认质量手册定稿（模拟）' : '确认第二阶段完整集合（模拟）',
    })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(versionText);
  await dialog.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
}

async function switchFileVersion(page: Page, fileTitle: string) {
  await page
    .locator('.markdown-files')
    .getByRole('button', { name: new RegExp(fileTitle, 'u') })
    .click();
  const switchButton = page.getByRole('button', { name: '显式切换并核对引用' });
  if (await switchButton.isVisible().catch(() => false)) await switchButton.click();
}

test('manual feedback, candidate switch and stage finalization bind exact versions', async ({
  page,
  browser,
}) => {
  console.log(`U2 controlled Chromium ${browser.version()}; user U2 walkthrough still NOT RUN`);
  await reachManual(page);
  await expect(page.locator('.journey-nav')).toContainText('程序与制度审阅 · 待前置');
  await expect(page.locator('.journey-nav')).toContainText('记录表单审阅 · 待前置');
  await expect(page.getByRole('button', { name: '检查完成并批准' })).toHaveCount(0);
  await expect(page.getByText('尚未生成本阶段候选；请先生成并核对候选。')).toBeVisible();

  await generate(page);
  await expect(page.getByRole('heading', { name: '质量手册 · 第 1 版候选' }).first()).toBeVisible();
  await expect(page.locator('.markdown-opinion')).not.toContainText('检查完成并批准');
  await expect(page.locator('.markdown-opinion-context')).toContainText('第 1 版候选');

  await page.locator('#markdown-note').fill('第一轮：保留客户质量目标与现有职责');
  await page.getByRole('button', { name: '保存意见草稿（模拟）' }).click();
  await expect(page.locator('.markdown-draft-state')).toContainText('正在模拟保存');
  await page.getByLabel('模拟保存回执').selectOption('SAVED');
  await page.getByRole('button', { name: '返回草稿保存回执' }).click();
  await expect(page.locator('.markdown-draft-state')).toContainText('模拟草稿已保存到本页内存');
  await page.getByRole('button', { name: '提交并修改' }).click();
  await expect(page.locator('.markdown-history')).toContainText(
    '第一轮：保留客户质量目标与现有职责',
  );

  await submitOpinion(page, '第二轮：补充编号映射待核对说明');
  await expect(page.locator('.markdown-history')).toContainText('意见与请求历史 · 2 条');
  await expect(page.locator('.markdown-history')).toContainText('第二轮：补充编号映射待核对说明');
  await expect(page.locator('.markdown-history')).toContainText('原请求 U2-REV-');

  await page.locator('#markdown-note').fill('下轮草稿：切换候选后仍应保留');
  await page.getByRole('button', { name: '模拟下一轮候选到达' }).click();
  await expect(page.getByText('新候选已到达（模拟）')).toBeVisible();
  await expect(page.locator('.markdown-reader')).toContainText('新候选已到达');
  await expect(page.locator('.markdown-opinion-context')).toContainText('第 1 版候选');
  await expect(page.locator('#markdown-note')).toHaveValue('下轮草稿：切换候选后仍应保留');
  await expect(page.locator('.markdown-draft-state')).toContainText('未保存（仅本页内存）');

  await page.getByRole('button', { name: '显式切换并核对引用' }).click();
  await expect(page.getByRole('heading', { name: '质量手册 · 第 2 版候选' }).first()).toBeVisible();
  await expect(page.locator('.markdown-opinion-context')).toContainText('第 2 版候选');
  await expect(page.locator('#markdown-note')).toHaveValue('');
  await expect(page.getByText('已显式切换到本精确版本')).toBeVisible();

  await page.getByLabel('查看当前文件版本').selectOption('V1');
  await expect(page.locator('#markdown-note')).toHaveValue('下轮草稿：切换候选后仍应保留');
  await page.getByLabel('查看当前文件版本').selectOption('V2');
  await expect(page.locator('#markdown-note')).toHaveValue('');

  await page.getByLabel('定稿回执场景').selectOption('matched');
  await page.getByRole('button', { name: '确认质量手册定稿（模拟）' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('质量手册 · 第 2 版候选');
  await expect(dialog).toContainText('U1-PLAN-01 第 1 版');
  await dialog.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
  await expect(page.locator('.stage-finalization-result')).toContainText('U2-STAGE-');
  await expect(page.locator('.stage-finalization-result')).toContainText('质量手册 · 第 2 版候选');
  await expect(page.getByRole('link', { name: '进入控制程序与管理制度审阅' })).toBeVisible();
});

test('procedure and rule finalize as one complete set against the finalized manual', async ({
  page,
}) => {
  await reachManual(page);
  await generate(page);
  await finalizeStage(page, 'quality', '质量手册 · 第 1 版候选');
  await page.getByRole('link', { name: '进入控制程序与管理制度审阅' }).click();
  await expect(page).toHaveURL(procedures);
  await expect(page.getByRole('heading', { name: '控制程序与管理制度审阅' })).toBeVisible();
  await expect(page.locator('.stage-upstream')).toContainText('质量手册定稿');
  await expect(page.locator('.stage-upstream')).toContainText('U2-STAGE-');

  await generate(page);
  await expect(
    page.getByRole('heading', { name: '变更控制程序 · 第 1 版候选' }).first(),
  ).toBeVisible();
  await expect(page.locator('.stage-set')).toContainText('外来文件管理规定');
  await submitOpinion(page, '本轮联动：统一编号引用与通知职责', '阶段 控制程序与管理制度');
  await expect(page.locator('.markdown-history')).toContainText('本轮联动：统一编号引用与通知职责');

  await page.getByRole('button', { name: '模拟下一轮候选到达' }).click();
  await expect(page.getByText('新候选已到达（模拟）')).toBeVisible();
  await switchFileVersion(page, '变更控制程序');
  await switchFileVersion(page, '外来文件管理规定');
  await expect(page.locator('.stage-set')).toContainText('第 2 版候选');

  await page.getByRole('button', { name: '模拟缺少一份文件' }).click();
  await expect(page.locator('.stage-finalize')).toContainText('缺少文件或版本');
  await expect(page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交并修改' })).toBeDisabled();
  await expect(page.getByText('当前阶段缺少文件或版本')).toBeVisible();
  await page.getByRole('button', { name: '恢复缺失文件（演示）' }).click();
  await expect(page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' })).toBeEnabled();

  await page.getByLabel('定稿回执场景').selectOption('mismatch');
  await page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并生成模拟回执' }).click();
  await page.getByRole('button', { name: '重新查询原定稿请求' }).click();
  await expect(page.getByText('回执与原定稿请求或依据不匹配').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toHaveCount(0);
  await expect(page.locator('.stage-set')).toContainText('第 2 版候选');
  await expect(page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' })).toBeDisabled();
  await page.getByRole('button', { name: '重新核对后重试定稿（模拟）' }).click();
  await expect(page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' })).toBeEnabled();

  await page.getByLabel('定稿回执场景').selectOption('changed');
  await page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并生成模拟回执' }).click();
  await page.getByRole('button', { name: '重新查询原定稿请求' }).click();
  await expect(page.getByText('确认期间文件版本集合已变化').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toHaveCount(0);
  await page.getByRole('button', { name: '重新核对后重试定稿（模拟）' }).click();
  await page.getByLabel('查看当前文件版本').selectOption('V2');
  await expect(page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' })).toBeEnabled();

  await page.getByLabel('定稿回执场景').selectOption('matched');
  await page.getByRole('button', { name: '确认第二阶段完整集合（模拟）' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('变更控制程序 · 第 2 版候选');
  await expect(dialog).toContainText('外来文件管理规定 · 第 2 版候选');
  await expect(dialog).toContainText('质量手册定稿');
  await dialog.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
  await expect(page.locator('.stage-finalization-result')).toContainText(
    '变更控制程序 · 第 2 版候选',
  );
  await expect(page.locator('.stage-finalization-result')).toContainText(
    '外来文件管理规定 · 第 2 版候选',
  );
  await page.getByRole('link', { name: '进入记录表单审阅' }).click();
  await expect(page).toHaveURL(records);
});

test('records review shows both upstream bases and offers no separate finalization gate', async ({
  page,
}) => {
  await reachManual(page);
  await generate(page);
  await finalizeStage(page, 'quality', '质量手册 · 第 1 版候选');
  await page.getByRole('link', { name: '进入控制程序与管理制度审阅' }).click();
  await generate(page);
  await finalizeStage(page, 'set', '变更控制程序 · 第 1 版候选');
  await page.getByRole('link', { name: '进入记录表单审阅' }).click();
  await expect(page).toHaveURL(records);
  await expect(page.getByRole('heading', { name: '记录表单审阅' })).toBeVisible();
  await expect(page.locator('.stage-upstream')).toContainText('质量手册定稿');
  await expect(page.locator('.stage-upstream')).toContainText('第二阶段完整集合');

  await generate(page);
  await page
    .locator('.markdown-files')
    .getByRole('button', { name: /变更申请单/u })
    .click();
  await page.getByRole('button', { name: '完整文件' }).click();
  await expect(page.getByRole('region', { name: '完整表格，可横向滚动' })).toBeVisible();
  await expect(page.locator('.markdown-wide-table table')).toContainText('初步判定');
  await expect(page.locator('.markdown-wide-table table')).toContainText('变更事项');

  await submitOpinion(page, '记录表单：保留客户编号映射待核对', '阶段 记录表单');
  await page.getByRole('button', { name: '模拟下一轮候选到达' }).click();
  await page.getByRole('button', { name: '显式切换并核对引用' }).click();
  await expect(page.locator('.markdown-opinion')).not.toContainText('检查完成并批准');
  await expect(page.getByRole('button', { name: /确认.*定稿/u })).toHaveCount(0);
  await expect(page.locator('.stage-finalize')).toContainText('记录表单不设单独定稿关卡');
  await expect(page.locator('.stage-finalize')).toContainText('U3');
  await expect(page.getByRole('link', { name: /ZIP/u })).toHaveCount(0);
});

test('deep links cannot invent a missing plan or upstream finalization', async ({ page }) => {
  await page.goto(manual);
  await expect(page.getByRole('heading', { name: '缺少本阶段前置依据' })).toBeVisible();
  await expect(page.getByRole('link', { name: '返回修改范围' })).toBeVisible();

  await reachManual(page);
  await page.getByRole('link', { name: '演练：直接打开程序与制度审阅' }).click();
  await expect(page).toHaveURL(procedures);
  await expect(page.getByRole('heading', { name: '缺少本阶段前置依据' })).toBeVisible();
  await expect(page.locator('main')).toContainText('尚无与计划匹配的手册定稿');
  await expect(page.getByRole('link', { name: '返回质量手册审阅' })).toBeVisible();

  await page.getByRole('link', { name: '返回质量手册审阅' }).click();
  await page.getByRole('link', { name: '演练：直接打开记录表单审阅' }).click();
  await expect(page).toHaveURL(records);
  await expect(page.getByRole('heading', { name: '缺少本阶段前置依据' })).toBeVisible();
  await expect(page.locator('main')).toContainText('需要先有质量手册定稿');
  await expect(page.getByRole('link', { name: '返回质量手册审阅' })).toBeVisible();

  await page.getByRole('link', { name: '项目概览' }).click();
  await expect(page).toHaveURL(overview);
  await expect(page.locator('.overview-next')).toContainText('进入质量手册审阅');
  await expect(page.locator('.journey-nav')).toContainText('程序与制度审阅 · 待前置');
});

test('save, submission and finalization recovery keep one original request', async ({ page }) => {
  await reachManual(page);
  await generate(page);

  await page.locator('#markdown-note').fill('保存失败测试草稿');
  await page.getByRole('button', { name: '保存意见草稿（模拟）' }).click();
  await page.getByLabel('模拟保存回执').selectOption('FAILED');
  await page.getByRole('button', { name: '返回草稿保存回执' }).click();
  await expect(page.locator('.markdown-draft-state')).toContainText('模拟保存失败');
  await expect(page.locator('#markdown-note')).toHaveValue('保存失败测试草稿');

  await page.getByLabel('修改回执场景').selectOption('UNKNOWN');
  await page.getByRole('button', { name: '提交并修改' }).click();
  await expect(page.locator('.markdown-submission')).toContainText('提交结果待核验');
  await expect(page.getByRole('button', { name: '提交并修改' })).toBeDisabled();
  await expect(page.getByText('本项目已有待回执或待核验的修改请求')).toHaveCount(0);
  await page.getByRole('link', { name: '项目概览' }).click();
  await page.getByRole('link', { name: '质量手册审阅', exact: true }).click();
  await expect(page.locator('.markdown-submission')).toContainText('提交结果待核验');
  await page.getByRole('button', { name: '重新查询原修订请求' }).click();
  await expect(page.getByText('原修订请求仍无可匹配回执')).toBeVisible();
  await page.getByRole('button', { name: '模拟原修订回执到达' }).click();
  await page.getByRole('button', { name: '重新查询原修订请求' }).click();
  await expect(page.locator('.markdown-history')).toContainText('已接收（模拟）');
  await expect(page.locator('.markdown-submission')).toHaveCount(0);

  await page.getByLabel('修改回执场景').selectOption('FAILED');
  await page.locator('#markdown-note').fill('失败意见保留在历史');
  await page.getByRole('button', { name: '提交并修改' }).click();
  await expect(page.locator('.markdown-history')).toContainText('失败（模拟）');
  await expect(page.getByRole('button', { name: '提交并修改' })).toBeEnabled();

  await page.getByLabel('定稿回执场景').selectOption('mismatch');
  await page.getByRole('button', { name: '确认质量手册定稿（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并生成模拟回执' }).click();
  await page.getByRole('button', { name: '重新查询原定稿请求' }).click();
  await expect(page.getByText('回执与原定稿请求或依据不匹配').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toHaveCount(0);
  await page.getByRole('button', { name: '重新核对后重试定稿（模拟）' }).click();

  await page.getByLabel('定稿回执场景').selectOption('pending');
  await page.getByRole('button', { name: '确认质量手册定稿（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(
    page.locator('.stage-finalize').getByText('定稿请求待回执', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '确认质量手册定稿（模拟）' })).toBeDisabled();
  await page.getByRole('link', { name: '项目概览' }).click();
  await page.getByRole('link', { name: '质量手册审阅', exact: true }).click();
  await expect(
    page.locator('.stage-finalize').getByText('定稿请求待回执', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '重新查询原定稿请求' }).click();
  await expect(page.getByText('原定稿请求仍无可匹配回执').first()).toBeVisible();
  await page.getByRole('button', { name: '模拟原定稿回执到达' }).click();
  await page.getByRole('button', { name: '重新查询原定稿请求' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
  await expect(page.locator('.stage-finalization-result')).toHaveCount(1);
});

test('desktop and narrow layouts keep reading, opinions, basis and return actions usable', async ({
  page,
  browser,
}) => {
  console.log(`U2 layout controlled Chromium ${browser.version()}; platform matrix still NOT RUN`);
  await reachManual(page);
  await generate(page);
  for (const [width, height] of [
    [1440, 900],
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('note').first()).toContainText('开发');
    await expect(page.locator('.stage-basis')).toContainText('输入依据');
    await expect(
      page.locator('.journey-nav').getByRole('link', { name: '修改范围', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.stage-set')).toBeVisible();
    if (width <= 900) {
      await page.getByRole('button', { name: '意见与处理' }).click();
      await expect(page.locator('#markdown-note')).toBeVisible();
      await page.getByRole('button', { name: '查看文档' }).click();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const finalize = page.getByRole('button', { name: '确认质量手册定稿（模拟）' });
    await finalize.focus();
    await expect(finalize).toBeFocused();
    await finalize.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(finalize).toBeFocused();
  }
});

test('production build excludes the U2 adapter and rehearsal content', async ({ page }) => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of [
      'DEVELOPMENT_U2_ADAPTER_ONLY',
      'MVP-U2-',
      'U2 三阶段审阅演练',
      'U2 显式场景控制',
      '模拟生成本阶段候选',
    ])
      expect(source.includes(marker), `Production bundle must exclude ${marker}`).toBe(false);
  }
  await page.goto(manual);
  await expect(page.getByRole('heading', { name: '质量手册审阅' })).toHaveCount(0);
});
