import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test('production login entry preserves the return route and fits desktop and narrow screens', async ({
  page,
}) => {
  await page.route('**/bff/session', (route) =>
    route.fulfill({ json: { accessState: 'REAUTH_REQUIRED' } }),
  );
  const path = '/custody/projects/01a1a3d0-2eb7-7e00-82a8-19e0332ecb3e';
  await page.goto(path);
  await expect(page.getByRole('heading', { name: '登录工作空间' })).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: '主要导航' })).toHaveCount(0);
  const login = page.getByRole('link', { name: '使用企业账号登录' });
  await expect(login).toHaveAttribute(
    'href',
    `/bff/auth/login?returnTo=${encodeURIComponent(path)}`,
  );
  await page.keyboard.press('Tab');
  await expect(login).toBeFocused();
  for (const width of [1920, 1440, 320]) {
    await page.setViewportSize({ width, height: 600 });
    await expect(login).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const centerOffset = await page.locator('.auth-panel').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
    });
    expect(centerOffset).toBeLessThanOrEqual(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `test-results/login-entry-${width}.png`, fullPage: true });
  }
});

test('production login separates expiry, callback failure, denied access and service recovery', async ({
  page,
}) => {
  let state = 'SESSION_EXPIRED';
  await page.route('**/bff/session', (route) =>
    route.fulfill({ json: { accessState: state, code: 'UI_SERVICE_NOT_CONFIGURED' } }),
  );
  await page.goto('/custody');
  await expect(page.getByRole('heading', { name: '需要重新登录' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('会话已过期');
  state = 'REAUTH_REQUIRED';
  await page.goto('/custody?error=private-callback-sentinel&code=private-code-sentinel');
  await expect(page.getByRole('heading', { name: '登录未完成' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('请重新登录');
  await expect(page).toHaveURL('/custody');
  await expect(page.locator('body')).not.toContainText('sentinel');
  await expect(page.getByRole('link', { name: '使用企业账号登录' })).toHaveAttribute(
    'href',
    '/bff/auth/login?returnTo=%2Fworkbench',
  );
  state = 'DENIED';
  await page.reload();
  await expect(page.getByRole('heading', { name: '没有可访问的工作空间' })).toBeVisible();
  await expect(page.getByRole('link', { name: '使用企业账号登录' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重试加载' })).toHaveCount(0);
  state = 'UNAVAILABLE';
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('暂时无法连接工作空间服务');
  state = 'REAUTH_REQUIRED';
  await page.getByRole('button', { name: '重试加载' }).click();
  await expect(page.getByRole('heading', { name: '登录工作空间' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
