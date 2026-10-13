import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
const base = '/projects/DEMO-PROJECT-01';
const report = `${base}/analysis/DEMO-STARTUP-REPORT-01`;
const newer = `${base}/analysis/DEMO-STARTUP-REPORT-02`;
test('four summaries, request selection, edited preview and manual copy retain selection across details', async ({
  page,
}) => {
  await page.goto(report);
  await expect(page.locator('.analysis-card')).toHaveCount(4);
  await page.getByRole('button', { name: '客户需补充', exact: true }).click();
  await page.getByRole('checkbox', { name: '索取现行岗位职责文件' }).check();
  await page.getByRole('button', { name: '现行岗位职责文件 REQ-ROLE' }).click();
  await expect(page.locator('.analysis-item')).toContainText('U16');
  await expect(page.locator('.analysis-item')).toContainText('U17');
  await page.getByRole('button', { name: '返回分析总览' }).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    }),
  );
  await page.getByRole('button', { name: '复制全部索取清单' }).click();
  const original = await page.getByLabel('复制文本').inputValue();
  expect(original).toContain('软件使用情况');
  expect(original).not.toContain('新制度不得');
  await page.getByLabel('复制文本').fill(`${original}\n顾问调整措辞`);
  await page.getByRole('button', { name: '复制文本', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '无法自动复制' })).toBeVisible();
  await expect(page.getByLabel('复制文本')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '复制全部索取清单' })).toBeFocused();
  await page.getByRole('button', { name: '客户需补充', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '索取现行岗位职责文件' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '索取软件使用情况' })).not.toBeChecked();
  await page.getByRole('searchbox').fill('找不到');
  await expect(page.getByRole('status')).toContainText('原选择');
});
test('one composer retains separate customer, judgment and plan drafts; submitted snapshot stays frozen', async ({
  page,
}) => {
  await page.goto(report);
  await page.getByLabel('说明与意见').fill('客户未提交草稿');
  await page.getByRole('button', { name: '新制度不得擅自改变组织职责' }).click();
  await page.getByRole('button', { name: '写意见并提交复核' }).click();
  await expect(page.getByLabel('说明与意见')).toBeFocused();
  await page.getByLabel('说明与意见').fill('顾问意见：保留现有职责');
  await page.getByRole('button', { name: '提交意见并复核' }).dblclick();
  await page.getByLabel('说明与意见').fill('顾问下一稿');
  await expect(page.locator('.analysis-receipt')).toHaveCount(1);
  await page.getByText('查看原提交快照', { exact: true }).click();
  await expect(page.locator('.analysis-receipt pre')).toHaveText('顾问意见：保留现有职责');
  await page.getByRole('button', { name: '切换客户补充' }).click();
  await expect(page.getByLabel('说明与意见')).toHaveValue('客户未提交草稿');
  await page.getByRole('button', { name: '拟交付文件', exact: true }).click();
  await page.getByRole('button', { name: '纠正措施程序 F-CORR' }).click();
  await page.getByRole('button', { name: '对这项计划提意见' }).click();
  await page.getByLabel('说明与意见').fill('此文件计划需复核');
  await page.getByRole('button', { name: '提交意见并复核' }).click();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '选择预防措施程序' })).toBeEnabled();
  await page.getByRole('link', { name: '返回分析总览' }).click();
  await expect(page.getByLabel('说明与意见')).toHaveValue('此文件计划需复核');
  await page.getByRole('button', { name: '切换客户补充' }).click();
  await expect(page.getByLabel('说明与意见')).toHaveValue('客户未提交草稿');
  await page.getByText('分析演示控制', { exact: true }).click();
  await page.getByRole('button', { name: '模拟新报告到达' }).click();
  await page.getByRole('button', { name: '应用更新到当前总览' }).click();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '选择预防措施程序' })).toBeEnabled();
});
test('fixed report update is explicit, preserves next draft and makes historical report read-only', async ({
  page,
}) => {
  await page.goto(report);
  await page.getByText('分析演示控制', { exact: true }).click();
  await page.getByRole('button', { name: '带入固定补充示例' }).click();
  await page.getByRole('button', { name: '提交补充' }).click();
  await page.getByLabel('说明与意见').fill('下一稿保留');
  await expect(page.getByRole('button', { name: '应用更新到当前总览' })).toBeVisible();
  await expect(page).toHaveURL(report);
  await page.getByRole('button', { name: '应用更新到当前总览' }).click();
  await expect(page).toHaveURL(newer);
  await expect(page.locator('.analysis-card')).toHaveCount(4);
  await expect(page.getByRole('alert')).toContainText('上下文已过期');
  await expect(page.getByLabel('说明与意见')).toHaveValue('下一稿保留');
  await page.getByText('报告记录', { exact: true }).click();
  await page.getByRole('link', { name: '查看第 1 版（历史只读）' }).click();
  await expect(page.locator('main')).toContainText('历史报告 · 只读');
  await expect(page.getByLabel('说明与意见')).toBeDisabled();
  await expect(page.getByRole('link', { name: '核对信息与文件范围 →' })).toHaveCount(0);
  await page.goto(`${base}/startup/DEMO-STARTUP-REPORT-01`);
  // A reload starts a new isolated development session, not persistent business state.
  await expect(page.getByRole('heading', { name: '核对信息，选择本轮文件' })).toBeVisible();
});
for (const scenario of ['failed', 'unavailable', 'unknown', 'mismatch']) {
  test(`arbitrary input with ${scenario} retains original report and draft without fabricated conclusion`, async ({
    page,
  }) => {
    await page.goto(report);
    await page.getByText('分析演示控制', { exact: true }).click();
    await page.getByLabel('复核结果').selectOption(scenario);
    await page.getByLabel('说明与意见').fill('任意文本不能关闭缺口');
    await page.getByLabel('附上补充资料（DOCX / Markdown / ZIP）').setInputFiles({
      name: 'local.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('arbitrary'),
    });
    await page.getByRole('button', { name: '提交补充' }).click();
    await page.getByLabel('说明与意见').fill('下一稿');
    await expect(page.locator('.analysis-receipt')).toContainText(
      scenario === 'failed' ? '复核失败' : scenario === 'unavailable' ? '操作暂不可用' : 'UNKNOWN',
    );
    await expect(page.getByLabel('说明与意见')).toHaveValue('下一稿');
    await expect(page).toHaveURL(report);
    await expect(page.getByRole('button', { name: '应用更新到当前总览' })).toHaveCount(0);
    if (scenario === 'failed' || scenario === 'unavailable')
      await expect(page.getByRole('button', { name: '提交补充' })).toBeEnabled();
    else await expect(page.getByRole('button', { name: '提交补充' })).toBeDisabled();
  });
}
test('arrival preserves detailed reading and controlled viewport/focus/reflow baseline', async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  console.log(
    `Analysis controlled Chromium ${browser.version()}; Windows/macOS Chrome/Edge matrix NOT RUN`,
  );
  await page.goto(report);
  await page.getByLabel('说明与意见').fill('窄屏保留草稿');
  await page.getByText('分析演示控制', { exact: true }).click();
  await page.getByRole('button', { name: '模拟新报告到达' }).click();
  await page.getByRole('button', { name: '客户需补充', exact: true }).click();
  await page.getByRole('button', { name: '组织图的可读版本 REQ-ORG' }).click();
  await expect(page.locator('.analysis-item')).toContainText('已提供但读取受限');
  await expect(page).toHaveURL(/view=customer&item=REQ-ORG/u);
  await expect(page.getByRole('link', { name: '查看第 2 版' })).toBeVisible();
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
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (width < 700) {
      await expect(page.locator('.analysis-list')).toBeHidden();
      await page.getByRole('button', { name: '返回清单' }).click();
      await expect(page.locator('.analysis-list')).toBeVisible();
      await page.getByRole('button', { name: '组织图的可读版本 REQ-ORG' }).click();
    }
    await page.getByRole('button', { name: '返回分析总览' }).click();
    const heading = page.getByRole('heading', { name: '分析总览', exact: true });
    await expect(heading).toBeFocused();
    if (width < 700) {
      await page.getByRole('button', { name: '意见与补充', exact: true }).click();
      await expect(page.getByLabel('说明与意见')).toBeFocused();
      await expect(page.getByLabel('说明与意见')).toHaveValue('窄屏保留草稿');
      await page.getByRole('button', { name: '查看报告', exact: true }).click();
    }
    if (width >= 1280)
      expect(
        await page.locator('.analysis-reading').evaluate((element) => {
          const last = element.querySelector('.analysis-card:last-child');
          return (
            !!last &&
            last.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom + 1
          );
        }),
      ).toBe(true);
    expect(
      await page
        .locator('.analysis-page')
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBeLessThan(height);
    if (width === 1440 || width === 360)
      await page.screenshot({ path: `test-results/analysis-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '客户需补充', exact: true }).click();
    await page.getByRole('button', { name: '组织图的可读版本 REQ-ORG' }).click();
  }
});

test('real clipboard export and detail reading position survive return navigation', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(report);
  await page.getByRole('button', { name: '复制全部索取清单' }).click();
  const text = await page.getByLabel('复制文本').inputValue();
  await page.getByRole('button', { name: '复制文本', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '已复制' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '报告依据', exact: true }).click();
  const reading = page.locator('.analysis-item');
  await reading.evaluate((element) => {
    element.scrollTop = 160;
  });
  await expect.poll(() => reading.evaluate((element) => element.scrollTop)).toBe(160);
  await page.getByRole('button', { name: '返回分析总览' }).click();
  await page.getByRole('button', { name: '报告依据', exact: true }).click();
  await expect.poll(() => reading.evaluate((element) => element.scrollTop)).toBe(160);
});
