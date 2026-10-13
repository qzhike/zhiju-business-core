import { expect, test, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
const intake = '/projects/DEMO-PROJECT-01/intake';
async function options(page: Page, scenario: string) {
  await page.getByText('演示选项', { exact: true }).click();
  await page.getByLabel('分析场景').selectOption(scenario);
}
test('creation binds a keyboard-selected customer ID and exact project without analysis', async ({
  page,
}) => {
  await page.goto('/projects/new');
  const customer = page.getByRole('combobox', { name: '客户企业名称' });
  await customer.fill('青禾制造');
  await page.getByLabel('项目名称', { exact: true }).fill('同名客户项目');
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await expect(page.getByRole('alert')).toContainText('明确选择');
  await customer.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toContainText('WB-ENTERPRISE-03');
  await page.getByRole('button', { name: '创建项目并继续' }).dblclick();
  await expect(page).toHaveURL(/DEMO-CREATED-.*\/intake$/u);
  await expect(page.locator('main')).toContainText('WB-ENTERPRISE-03');
  await expect(page.locator('main')).toContainText('同名客户项目');
  await expect(page.locator('.intake-receipt')).toHaveCount(0);
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByRole('button', { name: '提交并分析' }).click();
  await expect(page.locator('.intake-receipt')).toContainText('等待安排');
  await expect(page.getByRole('link', { name: '查看分析报告', exact: true })).toHaveCount(0);
});
test('explicit NEW and mismatched creation preserve inputs and do not navigate', async ({
  page,
}) => {
  await page.goto('/projects/new');
  await page.getByRole('button', { name: '新建客户', exact: true }).click();
  await page.getByLabel('客户企业名称').fill('新企业');
  await page.getByLabel('项目名称', { exact: true }).fill('新项目');
  await page.getByText('演示选项', { exact: true }).click();
  await page.getByLabel('创建回执').selectOption('mismatch');
  await page.getByRole('button', { name: '创建项目并继续' }).click();
  await expect(page.getByRole('alert')).toContainText('不匹配');
  await expect(page).toHaveURL('/projects/new');
  await expect(page.getByLabel('客户企业名称')).toHaveValue('新企业');
  await expect(page.getByLabel('项目名称', { exact: true })).toHaveValue('新项目');
});
test('arbitrary ZIP never fabricates a report, invalid choice keeps previous input, UNKNOWN freezes one intent', async ({
  page,
}) => {
  await page.goto(intake);
  const file = page.getByLabel('选择 ZIP 文件', { exact: true });
  await file.setInputFiles({
    name: 'local.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('local'),
  });
  await file.setInputFiles({
    name: 'bad.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('bad'),
  });
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.locator('.file-brief')).toContainText('local.zip');
  await page.getByLabel('补充说明（选填）').fill('原始说明\n保留原文');
  await options(page, 'unknown');
  await page.getByRole('button', { name: '提交并分析' }).dblclick();
  await expect(page.locator('.intake-receipt')).toContainText('UNKNOWN');
  await expect(page.getByLabel('补充说明（选填）')).toBeDisabled();
  await expect(page.getByLabel('补充说明（选填）')).toHaveValue('原始说明\n保留原文');
  await expect(page.getByRole('button', { name: '提交并分析' })).toBeDisabled();
  await expect(page.getByRole('link', { name: '查看分析报告', exact: true })).toHaveCount(0);
  await page.getByText('查看原始提交与失败历史', { exact: true }).click();
  await expect(page.locator('.submitted-note')).toHaveCount(1);
});
test('fixed ZIP stages stay on page and retry retains failed original input', async ({ page }) => {
  await page.goto(intake);
  await options(page, 'analysis-failure');
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByLabel('补充说明（选填）').fill('保留说明');
  await page.clock.install({ time: new Date('2026-10-13T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-13T00:00:01Z'));
  await page.getByRole('button', { name: '提交并分析' }).click();
  await expect(page.locator('.intake-receipt')).toContainText('正在接收资料');
  for (const text of ['正在准备资料', '等待安排', 'Runner 正在分析', '分析失败']) {
    await page.clock.runFor(350);
    await expect(page.locator('.intake-receipt')).toContainText(text);
  }
  await expect(page).toHaveURL(intake);
  await page.getByLabel('分析场景').selectOption('ready');
  await page.getByRole('button', { name: '重新分析这份资料' }).click();
  await page.clock.runFor(1050);
  await expect(page.locator('.intake-receipt')).toContainText('正在核验分析报告');
  await page.clock.runFor(350);
  await expect(page.getByRole('link', { name: '查看分析报告', exact: true })).toBeVisible();
  await expect(page).toHaveURL(intake);
  await expect(page.getByLabel('补充说明（选填）')).toHaveValue('保留说明');
  await page.getByText('查看原始提交与失败历史', { exact: true }).click();
  await expect(page.locator('.submitted-note')).toHaveCount(2);
  await expect(page.locator('main')).toContainText('Runner 分析失败');
  await page.getByRole('link', { name: '查看分析报告', exact: true }).click();
  await expect(page).toHaveURL('/projects/DEMO-PROJECT-01/analysis/DEMO-STARTUP-REPORT-01');
});
test('preparation replacement and denied analysis retry are explicit', async ({ page }) => {
  await page.goto(intake);
  await options(page, 'preparation-failure');
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByRole('button', { name: '提交并分析' }).click();
  await page.getByRole('button', { name: '更换 ZIP 包' }).click();
  await expect(page.getByLabel('选择 ZIP 文件', { exact: true })).toBeFocused();
  await page.getByLabel('分析场景').selectOption('analysis-denied');
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByRole('button', { name: '提交并分析' }).click();
  await expect(page.locator('.intake-receipt')).toContainText('分析失败');
  await expect(page.getByRole('button', { name: '重新分析这份资料' })).toHaveCount(0);
});
test('cross-project selection, late picker isolation, built viewport and accessibility baseline', async ({
  page,
  browser,
}) => {
  console.log(`Intake controlled Chromium ${browser.version()}; actual Chrome/Edge matrix NOT RUN`);
  await page.goto('/initial-analysis');
  await expect(page.getByLabel('选择项目')).toHaveValue('');
  await page.getByLabel('选择项目').selectOption('DEMO-PROJECT-01');
  const picker = await page.getByLabel('选择 ZIP 文件', { exact: true }).elementHandle();
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByRole('link', { name: '新建项目', exact: true }).click();
  await page.evaluate((element) => {
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, picker);
  await page.goto('/projects/DEMO-PROJECT-02/intake');
  await expect(page.locator('.file-brief')).toHaveCount(0);
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/projects/new');
    await expect(page.getByRole('heading', { name: '新建项目', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (width === 1440 || width === 360)
      await page.screenshot({ path: `test-results/project-new-${width}.png`, fullPage: true });
    await page.goto(intake);
    await expect(page.getByRole('heading', { name: '准备首轮客户资料' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (width === 1440 || width === 360)
      await page.screenshot({ path: `test-results/intake-${width}.png`, fullPage: true });
  }
});
