import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const project = '/projects/DEMO-PROJECT-01';
const report = `${project}/analysis/DEMO-STARTUP-REPORT-01`;
const startup = `${project}/startup/DEMO-STARTUP-REPORT-01`;

test('production refuses business actions even with development switches', async ({ page }) => {
  await page.goto('/workbench');
  await expect(page.getByRole('alert')).toContainText('登录与公开业务服务尚未接入');
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toHaveCount(0);
  await expect(page.getByRole('note')).toHaveCount(0);
  const response = await page.request.post('/bff/fixture/execute', {
    data: { fixture: true, actorKind: 'HUMAN' },
  });
  expect(response.status()).toBe(503);
});

test('desktop built fixture journey, exact versions, refresh and history', async ({
  page,
  browser,
}) => {
  console.log(
    `Controlled browser: ${browser.version()} desktop 1440x900; development anonymous fixture only`,
  );
  await page.goto('/workbench');
  await expect(page.getByRole('heading', { name: '我的工作台' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('不上传或读取 ZIP 内容');
  await page.getByRole('link', { name: '准备客户资料 →' }).click();
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByRole('button', { name: '载入演示分析报告' }).click();
  await expect(page.getByRole('status')).toContainText('正在载入');
  await expect(page.getByRole('heading', { name: '分析总览', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择预防措施程序' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: '选择质量手册' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '选择纠正措施程序' }).check();
  await page.getByRole('checkbox', { name: '演示必要信息缺失' }).check();
  await expect(page.getByRole('alert')).toContainText('文件选择已保留');
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '演示必要信息缺失' }).uncheck();
  await page.getByRole('button', { name: '模拟新结果到达' }).click();
  await expect(page).toHaveURL(startup);
  await expect(page.getByRole('status')).toContainText('选择及第 1 版保持');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).toBeChecked();
  await page.goBack();
  await expect(page).toHaveURL(report);
  await page.goForward();
  await expect(page).toHaveURL(startup);
  await page.getByRole('button', { name: '确认信息与范围并开始' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('所选 1 份完整计划');
  await page.getByRole('button', { name: '返回核对', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeFocused();
  await page.getByRole('button', { name: '确认信息与范围并开始' }).click();
  await page.getByRole('button', { name: '确认并查看演示进度' }).click();
  await expect(page.getByRole('heading', { name: '本轮执行进度' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('不表示真实业务成功');
  const exactUrl = page.url();
  await expect(page.locator('main')).toContainText('DEMO-STARTUP-REPORT-01');
  await page.reload();
  await expect(page).toHaveURL(exactUrl);
  await expect(page.getByRole('heading', { name: '演示候选已就绪，等待检查' })).toBeVisible({
    timeout: 12_000,
  });
  await page.getByRole('link', { name: '查看本轮精确报告' }).click();
  await expect(page).toHaveURL(report);
  await page.getByRole('button', { name: '模拟新报告到达' }).click();
  await expect(page).toHaveURL(report);
  await page.getByRole('link', { name: '查看第 2 版' }).click();
  await expect(page).toHaveURL(`${project}/analysis/DEMO-STARTUP-REPORT-02`);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page.getByRole('checkbox', { name: '选择纠正措施程序' })).not.toBeChecked();
  await page.screenshot({ path: 'test-results/workspace-desktop.png', fullPage: true });
});

test('narrow navigation, keyboard focus, empty states and error recovery', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/workbench');
  await page.getByRole('button', { name: '查看空工作台' }).click();
  await expect(page.getByRole('heading', { name: '暂无待处理工作' })).toBeVisible();
  await page
    .getByRole('navigation', { name: '主要导航' })
    .getByRole('link', { name: '新建项目' })
    .focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '进入演示资料准备' }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  await page.getByLabel('客户企业名称', { exact: true }).fill('青禾制造（匿名）');
  await page.getByLabel('项目名称', { exact: true }).fill('体系升级（匿名）');
  await page.getByRole('button', { name: '进入演示资料准备' }).click();
  await page.getByRole('button', { name: '带入演示 ZIP 包' }).click();
  await page.getByRole('checkbox', { name: '演示加载失败' }).check();
  await page.getByRole('button', { name: '载入演示分析报告' }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  await page.getByRole('checkbox', { name: '演示加载失败' }).uncheck();
  await page.getByRole('button', { name: '载入演示分析报告' }).click();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await page.getByRole('searchbox', { name: '查找文件' }).fill('不存在的文件');
  await expect(page.getByRole('status')).toContainText('没有符合条件的文件');
  await page.getByRole('searchbox', { name: '查找文件' }).clear();
  const checkbox = page.getByRole('checkbox', { name: '选择预防措施程序' });
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: '确认信息与范围并开始' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '确认信息与范围并开始' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/workspace-narrow.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('safe content, exact deep links and fixture cache recovery', async ({ page }) => {
  await page.goto(`${project}/analysis/not-found`);
  await expect(page.getByRole('heading', { name: '无法打开此页面' })).toBeVisible();
  await page.goto('/projects/other/startup/DEMO-STARTUP-REPORT-01');
  await expect(page.getByRole('heading', { name: '无法打开此页面' })).toBeVisible();
  await page.goto(report);
  const violations = (await new AxeBuilder({ page }).analyze()).violations;
  expect(violations).toEqual([]);
  await page.goto(startup);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.evaluate(() => {
    sessionStorage.setItem('zhiju-workspace-development-fixture-v1', '{broken');
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('无法读取演示记录');
  await page.getByRole('button', { name: '清除演示记录并重试' }).click();
  await expect(page.getByRole('heading', { name: '核对信息，选择本轮文件' })).toBeVisible();
});
