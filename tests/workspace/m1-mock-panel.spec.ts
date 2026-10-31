import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFile, readdir } from 'node:fs/promises';

const work = '/projects/MVP-U1-PROJECT/work';

test('mock panel is collapsed, keeps business drafts, and replaces controls on navigation', async ({
  page,
}) => {
  await page.goto(work);
  const trigger = page.getByRole('button', { name: 'Mock 控制', exact: true });
  const panel = page.getByRole('region', { name: 'Mock 控制面板' });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toBeHidden();
  await expect(page.locator('#main .fixture-options, #main .journey-rehearsal')).toHaveCount(0);
  await page.getByRole('button', { name: '开始分析资料' }).click();
  const answer = page.getByLabel('资料问题答复');
  await answer.fill('审核中的答复草稿');
  const position = await page.locator('.task-next').boundingBox();
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: '收起 Mock 控制面板' })).toBeFocused();
  expect(await page.locator('.task-next').boundingBox()).toEqual(position);
  await panel.locator('details.task-dev summary').click();
  await panel.getByLabel('范围确认场景').selectOption('unknown');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(answer).toHaveValue('审核中的答复草稿');
  await trigger.click();
  await expect(panel.getByLabel('范围确认场景')).toHaveValue('unknown');
  await panel.locator('.journey-rehearsal summary').click();
  await panel.getByRole('link', { name: '资料（阅读）', exact: true }).click();
  await expect(page).toHaveURL('/projects/MVP-U1-PROJECT/intake');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(panel.getByLabel('范围确认场景')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '演示：加入失败与不支持条目' })).toBeVisible();
  await panel.getByRole('button', { name: '演示：加入失败与不支持条目' }).click();
  await page.getByRole('button', { name: '收起 Mock 控制面板' }).click();
  await expect(page.locator('#main')).toContainText('不支持');
  await expect(page.locator('#main button', { hasText: '演示：' })).toHaveCount(0);
});

test('mock panel fits desktop and narrow screens, scrolls internally, and stays keyboard accessible', async ({
  page,
}) => {
  for (const width of [1440, 360, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(work);
    const trigger = page.getByRole('button', { name: 'Mock 控制', exact: true });
    await trigger.click();
    const panel = page.getByRole('region', { name: 'Mock 控制面板' });
    await panel.locator('details.task-dev summary').click();
    const bounds = await panel.boundingBox();
    if (!bounds) throw new Error('Mock panel has no visible bounds');
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(720);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await panel
      .getByRole('button', { name: '扩大范围：新增变更通知单（演示）' })
      .scrollIntoViewIfNeeded();
    expect(
      await page.locator('.mock-panel-body').evaluate((element) => element.scrollTop),
    ).toBeGreaterThan(0);
    const violations = (await new AxeBuilder({ page }).include('.mock-panel').analyze()).violations;
    expect(violations).toEqual([]);
    await page.getByRole('button', { name: '收起 Mock 控制面板' }).click();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest('#mock-controls-panel'))),
    ).toBe(false);
  }
});

test('production assets exclude the mock panel and scenario controls', async () => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!/\.(js|css)$/u.test(file)) continue;
    const content = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of ['mock-panel-trigger', 'mock-control-group', 'Mock 控制面板']) {
      expect(content.includes(marker), `${file} contains ${marker}`).toBe(false);
    }
  }
});
