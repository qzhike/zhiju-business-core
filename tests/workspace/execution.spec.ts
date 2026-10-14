import { readdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
const first = '/projects/DEMO-PROJECT-01/executions/WB-SCOPE-01';
const controls = async (page: Page) => {
  const details = page.locator('.execution-controls');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
};
test('mixed file results, exact candidates, uncertain retries and intact failure history', async ({
  page,
}) => {
  await page.goto(first);
  await controls(page);
  await expect(page.locator('.execution-counts')).toContainText('本轮 2 份');
  await expect(page.locator('.execution-counts')).toContainText('等待安排 2');
  await page.getByRole('button', { name: '模拟本轮实际处理' }).click();
  await page.getByRole('button', { name: '模拟首份候选到达' }).click();
  await expect(page.locator('.execution-counts')).toContainText('正在处理 1 · 待检查 1');
  await expect(page.locator('.execution-file')).toHaveCount(2);
  await expect(page.locator('.execution-list')).not.toContainText('质量手册');
  await page.getByRole('button', { name: '模拟第二份失败' }).click();
  const failed = page.locator('.execution-file').filter({ hasText: '预防措施程序' });
  await expect(failed).toContainText('失败原因：源文件读取受限');
  await page.getByRole('combobox', { name: '重试回执', exact: true }).selectOption('HOLD');
  await failed.getByRole('button', { name: '重新处理本文件' }).dblclick();
  await expect(failed).toContainText('重试请求等待回执');
  await expect(failed.getByRole('button', { name: '重新处理本文件' })).toHaveCount(0);
  await page.getByRole('button', { name: '返回待核验重试回执' }).click();
  await expect(failed).toContainText('重试结果待核验');
  const intent = await failed.getByRole('status').innerText();
  await page.getByLabel('原请求查询结果').selectOption('ACCEPTED');
  await failed.getByRole('button', { name: '查询原重试请求' }).click();
  await expect(failed).toContainText('重试请求已接收，等待安排');
  expect(await failed.getByRole('status').innerText()).toContain(
    requiredValue(/原意图 ([^ ]+)/u.exec(intent)?.[1]),
  );
  await expect(failed.getByRole('button', { name: '重新处理本文件' })).toHaveCount(0);
  await expect(failed).toContainText('处理失败');
  await failed.getByText('失败历史（1）').click();
  await expect(failed).toContainText('原运行：源文件读取受限');
  await page.getByRole('link', { name: '检查文件 · DEMO-REV-01' }).click();
  await expect(page).toHaveURL('/projects/DEMO-PROJECT-01/files/DEMO-CORR/revisions/DEMO-REV-01');
  await page.getByRole('link', { name: '返回本轮文件进度' }).click();
  await expect(failed).toContainText('重试请求已接收，等待安排');
});
test('round navigation retains search, filter, disclosures and does not steal focus on events', async ({
  page,
}) => {
  await page.goto(first);
  await controls(page);
  await page.getByRole('button', { name: '模拟本轮实际处理' }).click();
  await page.getByText('本轮范围与报告依据', { exact: true }).click();
  await page.getByText('运行日志', { exact: true }).click();
  const search = page.getByRole('searchbox', { name: '查找本轮文件' });
  await search.fill('CX');
  await page.getByLabel('文件状态').selectOption('PROCESSING');
  await page.getByRole('button', { name: '带入已确认后轮示例' }).click();
  await page.getByLabel('查看轮次').selectOption('WB-SCOPE-02');
  await expect(page.locator('.execution-counts')).toContainText('等待安排 1');
  await search.fill('手册');
  await controls(page);
  await search.focus();
  await page
    .getByRole('button', { name: '模拟前轮新候选到达' })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
    });
  await expect(search).toBeFocused();
  await expect(page).toHaveURL('/projects/DEMO-PROJECT-01/executions/WB-SCOPE-02');
  await expect(search).toHaveValue('手册');
  await page.getByLabel('查看轮次').selectOption('WB-SCOPE-01');
  await expect(search).toHaveValue('CX');
  await expect(page.getByLabel('文件状态')).toHaveValue('PROCESSING');
  await expect(page.locator('.execution-secondary details').nth(0)).toHaveAttribute('open', '');
  await expect(page.locator('.execution-secondary details').nth(2)).toHaveAttribute('open', '');
  await page.getByLabel('文件状态').selectOption('ALL');
  await search.clear();
  await expect(page.getByRole('link', { name: '检查文件 · DEMO-REV-02' })).toBeVisible();
  await page.getByLabel('查看轮次').selectOption('WB-SCOPE-02');
  await expect(search).toHaveValue('手册');
  await expect(page.locator('.execution-secondary')).toContainText('DEMO-STARTUP-REPORT-02');
});
test('read/access/empty states, permission denial and mismatched retry cannot claim success', async ({
  page,
}) => {
  await page.goto(first);
  await controls(page);
  await page.getByRole('button', { name: '模拟第二份失败' }).click();
  await page.getByRole('button', { name: '模拟撤回重试许可' }).click();
  await expect(page.getByRole('button', { name: '重新处理本文件' })).toHaveCount(0);
  await expect(page.locator('.execution-list')).toContainText('当前未获服务端重试许可');
  await page.getByRole('button', { name: '模拟第二份失败' }).click();
  await page.getByRole('combobox', { name: '重试回执', exact: true }).selectOption('MISMATCH');
  await page.getByRole('button', { name: '重新处理本文件' }).click();
  await expect(page.locator('.execution-list')).toContainText('重试结果待核验');
  await page.getByLabel('读取场景').selectOption('ERROR');
  await expect(page.getByRole('alert')).toContainText('读取失败');
  await page.getByRole('button', { name: '重新读取进度' }).click();
  await expect(page.locator('.execution-list')).toContainText('重试结果待核验');
  await controls(page);
  await page.getByLabel('读取场景').selectOption('EXPIRED');
  await expect(page.getByRole('alert')).toContainText('访问已失效');
  await expect(page.locator('.execution-file')).toHaveCount(0);
  await controls(page);
  await page.getByLabel('读取场景').selectOption('AVAILABLE');
  await controls(page);
  await page.getByRole('button', { name: '带入空范围示例' }).click();
  await page.getByLabel('查看轮次').selectOption('WB-EMPTY-SCOPE');
  await expect(page.locator('.execution-list')).toContainText('本轮没有已确认文件');
  await page.goto('/projects/other/executions/WB-SCOPE-01');
  await expect(page.locator('main')).toContainText('无法读取此精确请求');
  await expect(page.locator('.execution-file')).toHaveCount(0);
});
test('built desktop and narrow reflow, bounded scrolling, keyboard entry and accessibility', async ({
  page,
  browser,
}) => {
  console.log(
    `Execution controlled Chromium ${browser.version()}; production service/Chrome/Edge matrix NOT RUN`,
  );
  await page.goto(first);
  await controls(page);
  await page.getByRole('button', { name: '模拟首份候选到达' }).click();
  await page.locator('.execution-controls > summary').click();
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = await page.locator('.execution-panel').boundingBox();
    expect(requiredValue(box).height).toBeLessThan(height);
    expect(
      requiredValue(await page.locator('.execution-list').boundingBox()).height,
    ).toBeGreaterThan(160);
    expect(
      await page.locator('.execution-list').evaluate((list) => getComputedStyle(list).overflowY),
    ).toBe('auto');
    await page.screenshot({ path: `test-results/execution-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const search = page.getByRole('searchbox', { name: '查找本轮文件' });
  await search.fill('无此文件');
  await expect(page.locator('.execution-list')).toContainText('没有符合条件的文件');
  await search.clear();
  const link = page.getByRole('link', { name: '检查文件 · DEMO-REV-01' });
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/projects/DEMO-PROJECT-01/files/DEMO-CORR/revisions/DEMO-REV-01');
});
test('long confirmed list scrolls within its bounded area and restores its round position', async ({
  page,
}) => {
  await page.goto(first);
  await controls(page);
  await page.getByRole('button', { name: '带入长清单示例' }).click();
  await page.getByLabel('查看轮次').selectOption('WB-LONG-SCOPE');
  await expect(page.locator('.execution-counts')).toContainText('本轮 40 份');
  const list = page.locator('.execution-list');
  await list.evaluate((element) => {
    element.scrollTop = 600;
  });
  await expect.poll(async () => list.evaluate((element) => element.scrollTop)).toBe(600);
  await page.getByLabel('查看轮次').selectOption('WB-SCOPE-01');
  await page.getByLabel('查看轮次').selectOption('WB-LONG-SCOPE');
  await expect.poll(async () => list.evaluate((element) => element.scrollTop)).toBe(600);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
});

test('ready candidate opens the shared reader and newer arrivals retain the exact reading version and draft', async ({
  page,
}) => {
  await page.goto(first);
  await controls(page);
  await page.getByRole('button', { name: '模拟首份候选到达' }).click();
  await page.getByRole('link', { name: '检查文件 · DEMO-REV-01' }).click();
  await expect(page.getByRole('heading', { name: '纠正措施程序（合成候选）' })).toBeVisible();
  const draft = page.getByRole('textbox', { name: '意见草稿' });
  await draft.fill('未提交的下一轮意见');
  await page.getByText('候选到达演示事件', { exact: true }).click();
  await draft.focus();
  await page
    .getByRole('button', { name: '模拟阅读期间新候选到达' })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
    });
  await expect(draft).toBeFocused();
  await expect(draft).toHaveValue('未提交的下一轮意见');
  await expect(page).toHaveURL('/projects/DEMO-PROJECT-01/files/DEMO-CORR/revisions/DEMO-REV-01');
  await expect(page.locator('.markdown-reader')).toContainText('合成候选 DEMO-REV-01');
  await expect(page.locator('.markdown-reader')).not.toContainText('合成候选 DEMO-REV-02');
  await expect(page.getByRole('button', { name: '下载 Markdown' })).toBeDisabled();
  await draft.clear();
  await page.getByRole('link', { name: '返回本轮文件进度' }).click();
  await expect(page.getByRole('link', { name: '检查文件 · DEMO-REV-02' })).toBeVisible();
  await page.goBack();
  await expect(page.locator('.markdown-reader')).toContainText('合成候选 DEMO-REV-01');
});
test('production execution route excludes event fixtures and cannot invent ready candidates', async ({
  page,
}) => {
  for (const asset of await readdir('apps/workspace-web/dist/assets')) {
    if (!asset.endsWith('.js')) continue;
    const bytes = await readFile(`apps/workspace-web/dist/assets/${asset}`, 'utf8');
    expect(bytes).not.toContain('EXECUTION_DEVELOPMENT_EVENTS_ONLY');
    expect(bytes).not.toContain('模拟首份候选到达');
    expect(bytes).not.toContain('DEMO-LIST-');
  }
  await page.goto(first);
  await expect(page.getByRole('alert')).toContainText('登录与公开业务服务尚未接入');
  await expect(page.getByRole('button', { name: '重新处理本文件' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /检查文件 ·/ })).toHaveCount(0);
  await expect(page.locator('.execution-controls')).toHaveCount(0);
});

function requiredValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing test evidence');
  return value;
}
