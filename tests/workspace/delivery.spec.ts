import { readFile, readdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
const route = '/projects/DEMO-PROJECT-01/delivery';
const controls = async (page: Page) => {
  const details = page.locator('.delivery-controls');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
};
const choose = async (page: Page, name = '纠正措施程序') =>
  page.getByRole('checkbox', { name: `加入本批：${name} · 第 1 版`, exact: true }).check();
const openReview = async (page: Page) => {
  await page.getByRole('button', { name: '核对本批版本', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('固定合成配套规则', { exact: true }),
  ).toBeVisible();
};
const createPackage = async (page: Page) => {
  await choose(page);
  await choose(page, '质量手册');
  await openReview(page);
  await page.getByRole('button', { name: '确认版本并生成交付包', exact: true }).click();
  await expect(page.locator('.delivery-receipt')).toContainText('交付包已可用');
  await page.getByRole('link', { name: '查看本批交付包' }).click();
};
test('delivery gathers exact versions, blocks missing supporting files and keeps dialog on updates', async ({
  page,
}) => {
  await page.goto(route);
  await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /预防措施/ })).toBeDisabled();
  await expect(page.locator('.delivery-file-list')).toContainText('内部已批准，待发布授权');
  await expect(page.locator('.delivery-file-list')).toContainText('Human 手工编制');
  await page.getByRole('combobox', { name: '交付条件', exact: true }).selectOption('WAITING');
  await expect(page.locator('.delivery-file')).toHaveCount(1);
  await page.getByRole('combobox', { name: '交付条件', exact: true }).selectOption('ALL');
  await choose(page, '质量手册');
  await openReview(page);
  await expect(page.getByRole('dialog')).toContainText('缺少本批配套');
  await expect(page.getByRole('button', { name: '确认版本并生成交付包' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '核对本批版本', exact: true })).toBeFocused();
  await choose(page);
  await controls(page);
  await openReview(page);
  await expect(page.getByRole('dialog')).toContainText('REPORT-第 1 轮');
  await page
    .getByRole('button', { name: '模拟手册新版本', includeHidden: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
    });
  await expect(page.getByRole('dialog')).toContainText('质量手册：版本或交付条件已变化');
  await expect(page.getByRole('dialog')).toContainText('MANUAL-REV-01');
  await expect(page.getByRole('button', { name: '确认版本并生成交付包' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox', { name: /纠正措施/, checked: true })).toHaveCount(1);
  await page.getByRole('button', { name: '移除 质量手册 · 第 1 版' }).click();
  await expect(page.locator('.delivery-selection')).toContainText('本批已选 1 份');
  await openReview(page);
  await expect(page.getByRole('button', { name: '确认版本并生成交付包' })).toBeEnabled();
});
test('delivery pending and UNKNOWN only query one original intent, fixed package and synthetic ZIP', async ({
  page,
}) => {
  await page.goto(route);
  await controls(page);
  await page.getByRole('combobox', { name: '确认回执', exact: true }).selectOption('HOLD');
  await choose(page);
  await choose(page, '质量手册');
  await openReview(page);
  await page.getByRole('button', { name: '确认版本并生成交付包' }).dblclick();
  await expect(page.locator('.delivery-receipt')).toContainText('正在确认本批版本');
  await expect(page.getByRole('button', { name: '核对本批版本', exact: true })).toBeDisabled();
  await expect(page.locator('.delivery-controls')).toContainText('确认调用数：1');
  await page.getByRole('button', { name: '返回待核实回执' }).click();
  await expect(page.locator('.delivery-receipt')).toContainText('生成结果待核实');
  const intent = /原意图 ([^ ]+)/u.exec(await page.locator('.delivery-receipt').innerText())?.[1];
  expect(intent).toBeTruthy();
  for (const [state, label] of [
    ['CONFIRMED', '本批版本已确认，待生成交付包'],
    ['GENERATING', '正在生成交付包'],
    ['PACKAGE_READY', '交付包已可用'],
  ] as const) {
    await page.getByLabel('原意图查询结果').selectOption(state);
    await page.getByRole('button', { name: '查询原生成意图' }).click();
    await expect(page.locator('.delivery-receipt')).toContainText(label);
    await expect(page.locator('.delivery-receipt')).toContainText(`原意图 ${intent}`);
  }
  await page.getByRole('link', { name: '查看本批交付包' }).click();
  await expect(page.locator('.delivery-detail')).toContainText('MANUAL-REV-01');
  await page.getByRole('button', { name: '模拟手册新版本' }).click();
  await expect(page.locator('.delivery-detail')).toContainText('MANUAL-REV-01');
  await expect(page.locator('.delivery-detail')).not.toContainText('MANUAL-REV-02');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载合成示例包 .zip' }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain('SYNTHETIC.zip');
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path);
  expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
  expect(bytes.toString()).toContain('SYNTHETIC-MANIFEST.md');
  expect(bytes.toString()).toContain('MANUAL-REV-01');
  expect(bytes.toString()).not.toContain('MANUAL-REV-02');
  await expect(page.locator('.delivery-detail')).toContainText('已请求下载，保存情况未知');
  await page.getByRole('button', { name: '模拟包许可过期' }).click();
  await expect(page.locator('.delivery-detail')).toContainText('下载链接已过期');
  await expect(page.getByRole('button', { name: '下载合成示例包 .zip' })).toBeDisabled();
  await page.getByRole('button', { name: '模拟包不可下载' }).click();
  await expect(page.locator('.delivery-detail')).toContainText('当前无法下载');
  await page.getByRole('button', { name: '模拟包校验失败' }).click();
  await expect(page.locator('.delivery-detail')).toContainText('交付包校验失败');
  await page.getByRole('button', { name: '恢复同一包可下载' }).click();
  for (const [state, label] of [
    ['THROW', '下载结果待核实'],
    ['FAILED', '下载响应失败或中断'],
    ['RESPONSE_STARTED', '服务端已开始下载响应'],
    ['RESPONSE_SENT', '服务端已发送下载响应'],
  ] as const) {
    await page.getByLabel('下载观察').selectOption(state);
    await page.getByRole('button', { name: '下载合成示例包 .zip' }).click();
    await expect(page.locator('.delivery-detail')).toContainText(label);
  }
  await page.getByRole('button', { name: '开始新的批次核对' }).click();
  await expect(page.locator('.delivery-detail')).toContainText('MANUAL-REV-01');
  await expect(page.getByRole('link', { name: '交付包记录（1）' })).toBeVisible();
});
test('delivery rejects failures and mismatched receipts, partial/stale/access expiration never succeeds', async ({
  page,
}) => {
  for (const [outcome, label] of [
    ['REJECTED', '本批确认被拒绝'],
    ['FAILED', '交付包未能生成'],
    ['MISMATCH', '生成结果待核实'],
  ] as const) {
    await page.goto(route);
    await controls(page);
    await page.getByRole('combobox', { name: '确认回执', exact: true }).selectOption(outcome);
    await choose(page);
    await openReview(page);
    await page.getByRole('button', { name: '确认版本并生成交付包' }).click();
    await expect(page.locator('.delivery-receipt')).toContainText(label);
    await expect(page.getByRole('link', { name: '查看本批交付包' })).toHaveCount(0);
  }
  await page.goto(route);
  await controls(page);
  await choose(page);
  await openReview(page);
  await page
    .getByRole('button', { name: '模拟程序资格失效', includeHidden: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
    });
  await expect(page.getByRole('dialog')).toContainText('版本或交付条件已变化');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '模拟部分读取' }).click();
  await expect(page.locator('.delivery-observation')).toContainText('PARTIAL');
  await expect(page.getByRole('button', { name: '核对本批版本', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '模拟陈旧读取' }).click();
  await expect(page.locator('.delivery-observation')).toContainText('STALE');
  await page.getByLabel('交付读取场景').selectOption('ERROR');
  await expect(page.getByRole('alert').first()).toContainText('读取失败');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByLabel('交付读取场景').selectOption('EXPIRED');
  await expect(page.locator('.delivery-gate')).toContainText('访问已失效');
  await expect(page.locator('.delivery-file')).toHaveCount(0);
  await controls(page);
  await page.getByLabel('交付读取场景').selectOption('AVAILABLE');
  await expect(page.locator('.delivery-selection')).toContainText('本批已选 0 份');
  await controls(page);
  await page.getByRole('button', { name: '模拟空清单' }).click();
  await expect(page.locator('.delivery-file-list')).toContainText('当前没有项目交付文件');
});
test('delivery bounded desktop and narrow history, keyboard focus, 200 files and accessibility', async ({
  page,
  browser,
}) => {
  console.log(
    `Delivery controlled Chromium ${browser.version()}; actual Chrome/Edge matrix NOT RUN`,
  );
  await page.goto(route);
  await controls(page);
  await page.getByRole('button', { name: '带入 200 份文件' }).click();
  await page.locator('.delivery-controls > summary').click();
  await expect(page.locator('.delivery-file')).toHaveCount(200);
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
    const box = await page.locator('.delivery-panel').boundingBox();
    expect(box?.height).toBeLessThan(height);
    expect(
      await page
        .locator('.delivery-file-list')
        .evaluate(
          (list) =>
            list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto',
        ),
    ).toBe(true);
    await page.screenshot({ path: `test-results/delivery-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: '查看 质量手册', exact: true }).click();
  await expect(page.getByRole('region', { name: '文件详情' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '文件详情', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '返回文件清单' }).click();
  await expect(page.getByRole('button', { name: '核对本批版本', exact: true })).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  const search = page.getByRole('searchbox', { name: '搜索交付文件' });
  await search.fill('不存在');
  await expect(page.locator('.delivery-file-list')).toContainText('没有符合条件');
  await search.clear();
  await choose(page);
  await page.getByRole('button', { name: '核对本批版本', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  expect(
    await page.getByRole('dialog').evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '核对本批版本', exact: true })).toBeFocused();
  await createPackage(page);
  const link = page.url();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole('region', { name: '固定交付包详情' })).toBeVisible();
  await page.getByRole('link', { name: '返回交付包列表' }).click();
  await expect(page.getByRole('link', { name: /合成项目交付批次/ })).toBeVisible();
  await page.getByRole('link', { name: /合成项目交付批次/ }).click();
  await expect(page).toHaveURL(link);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test('production delivery bundle excludes development exporter and synthetic data', async () => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const content = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of [
      'DELIVERY_DEVELOPMENT_ADAPTER_ONLY',
      'SYNTHETIC-MANIFEST.md',
      '合成项目交付批次',
      'MANUAL-QUAL-01',
    ])
      expect(content).not.toContain(marker);
  }
});

test('delivery ignores late original receipts after readback and access expiration', async ({
  page,
}) => {
  await page.goto(route);
  await controls(page);
  await page.getByRole('combobox', { name: '确认回执', exact: true }).selectOption('HOLD');
  await choose(page);
  await openReview(page);
  await page.getByRole('button', { name: '确认版本并生成交付包' }).click();
  await page.getByLabel('原意图查询结果').selectOption('CONFIRMED');
  await page.getByRole('button', { name: '查询原生成意图' }).click();
  await expect(page.locator('.delivery-receipt')).toContainText('本批版本已确认，待生成交付包');
  await page.getByRole('button', { name: '返回待核实回执' }).click();
  await expect(page.locator('.delivery-receipt')).toContainText('本批版本已确认，待生成交付包');
  await page.getByLabel('交付读取场景').selectOption('EXPIRED');
  await expect(page.locator('.delivery-file')).toHaveCount(0);
  await controls(page);
  await page.getByLabel('交付读取场景').selectOption('AVAILABLE');
  await expect(page.locator('.delivery-receipt')).toHaveCount(0);
  await expect(page.locator('.delivery-selection')).toContainText('本批已选 0 份');
  await controls(page);
  await choose(page);
  await openReview(page);
  await page.getByRole('button', { name: '确认版本并生成交付包' }).click();
  await page.getByLabel('交付读取场景').selectOption('EXPIRED');
  await controls(page);
  await page.getByRole('button', { name: '返回待核实回执' }).click();
  await expect(page.locator('.delivery-receipt')).toHaveCount(0);
  await page.getByLabel('交付读取场景').selectOption('AVAILABLE');
  await expect(page.locator('.delivery-receipt')).toHaveCount(0);
});
