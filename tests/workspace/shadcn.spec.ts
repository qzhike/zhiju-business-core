import { test, expect } from '@playwright/test';

function luminance(color: string) {
  const channels = color
    .match(/[\d.]+/gu)
    ?.slice(0, 3)
    .map(Number);
  if (channels?.length !== 3) throw new Error(`Unexpected color: ${color}`);
  return channels.reduce((sum, value, index) => {
    const channel = value / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
  }, 0);
}

test('blue controls keep readable text, native selection and keyboard focus at desktop and narrow widths', async ({
  page,
}) => {
  for (const width of [1440, 360, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/workbench');
    const action = page.getByRole('button', { name: '选择项目提交资料', exact: true });
    await expect(action).toBeVisible();
    await expect(page.locator('.wb-project-card')).toHaveCount(3);
    const colors = await action.evaluate((element) => {
      const style = getComputedStyle(element);
      return { foreground: style.color, background: style.backgroundColor };
    });
    expect(colors.background).toBe('rgb(29, 78, 216)');
    const a = luminance(colors.foreground);
    const b = luminance(colors.background);
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);

    await action.focus();
    await page.keyboard.press('Enter');
    const projects = page.getByLabel('筛选项目');
    await expect(projects).toBeFocused();
    expect(await projects.evaluate((element) => element.tagName)).toBe('SELECT');
    // Drive the native menu through Playwright; headless macOS does not dispatch
    // OS popup selection with ArrowDown/Enter, including for a bare select.
    await projects.selectOption({ index: 1 });
    await expect(projects).not.toHaveValue('');
    await expect(page.locator('.wb-project-card')).toHaveCount(1);

    // Project navigation restores focus after rendering the selected view.
    // Continue from that observable state instead of racing its animation frame.
    await expect(projects).toBeFocused();
    const search = page.getByLabel('查找工作');
    await page.keyboard.press('Tab');
    await expect(search).toBeFocused();
    await search.fill('迁移后仍保留的检索');
    const clear = page.getByRole('button', { name: '清除搜索', exact: true });
    await expect(clear).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(clear).toBeFocused();
    await expect
      .poll(() => clear.evaluate((element) => element.matches(':focus-visible')))
      .toBe(true);
    const focus = await clear.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        shadow: style.boxShadow,
        outline: style.outlineStyle,
      };
    });
    expect(focus.shadow !== 'none' || focus.outline !== 'none').toBe(true);
    await page.keyboard.press('Enter');
    await expect(search).toHaveValue('');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
