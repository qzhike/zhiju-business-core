import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const base = '/projects/MVP-U1-PROJECT';
const reportOne = `${base}/analysis/U1-REPORT-01`;
const plan = `${base}/startup/U1-REPORT-02`;

async function openAnalysisControls(page: Page) {
  const details = page.locator('details.fixture-options', { hasText: 'U1 分析演示控制' });
  await details.waitFor({ state: 'attached' });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

async function confirmPlan(page: Page) {
  await page.getByRole('button', { name: '确认这份修改范围' }).click();
  await page.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.locator('.plan-receipt')).toContainText('回执与计划、报告版本和输入依据匹配');
}

async function generate(page: Page) {
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
  await expect(page.locator('.markdown-review')).toBeVisible();
}

async function finalize(page: Page, button: string, versionText: string) {
  await page.getByLabel('定稿回执场景').selectOption('matched');
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(versionText);
  await dialog.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
}

async function homeCard(page: Page) {
  await page.getByRole('link', { name: '我的工作台' }).click();
  await expect(page).toHaveURL(/\/workbench/u);
  const card = page.getByRole('article', { name: 'M1 连续演练 · 当前下一步', exact: true });
  await expect(card).toBeVisible();
  return card;
}

async function downloadBytes(page: Page, button: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path);
}

test('home-to-ZIP journey keeps one project, reflects board progress and downloads exact simulated Markdown', async ({
  page,
  browser,
}) => {
  console.log(`M1 controlled Chromium ${browser.version()}; human walkthrough still NOT RUN`);
  await page.goto('/workbench?enterprise=U1-ENTERPRISE&project=MVP-U1-PROJECT');
  const initial = page.getByRole('article', { name: 'M1 连续演练 · 当前下一步', exact: true });
  await expect(initial).toContainText('待确认修改范围');
  await expect(initial).toContainText('阶段定稿 0/3');
  await expect(initial).toContainText('U1-REPORT-01');

  await page.goto(reportOne);
  await openAnalysisControls(page);
  await page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click();
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page).toHaveURL(plan);
  await confirmPlan(page);
  await page.getByRole('button', { name: '进入质量手册审阅（演示）' }).click();
  await generate(page);
  await finalize(page, '确认质量手册定稿（模拟）', '质量手册 · 第 1 版候选');

  const afterManual = await homeCard(page);
  await expect(afterManual).toContainText('待控制程序审阅');
  await expect(afterManual).toContainText('阶段定稿 1/3');
  await afterManual.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '进入控制程序审阅' }).click();
  await generate(page);
  await finalize(page, '确认控制程序完整集合（模拟）', '变更控制程序 · 第 1 版候选');

  const afterProcedure = await homeCard(page);
  await expect(afterProcedure).toContainText('待管理制度及记录表单审阅');
  await expect(afterProcedure).toContainText('阶段定稿 2/3');
  await afterProcedure.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '进入管理制度及记录表单审阅' }).click();
  await generate(page);
  await finalize(page, '确认管理制度及记录表单完整集合（模拟）', '外来文件管理规定 · 第 1 版候选');

  const afterRules = await homeCard(page);
  await expect(afterRules).toContainText('待最终交付确认');
  await expect(afterRules).toContainText('阶段定稿 3/3');
  await afterRules.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '确认最终交付清单' }).click();
  await expect(page).toHaveURL(`${base}/delivery`);
  await expect(page.getByText('最终交付当前不可确认')).toHaveCount(0);
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await expect(page.getByText('已选 6 / 6 份')).toBeVisible();
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('质量手册 · 第 1 版候选');
  await expect(dialog).toContainText('变更控制程序 · 第 1 版候选');
  await expect(dialog).toContainText('管理制度及记录表单');
  await dialog.getByRole('button', { name: '确认并冻结清单' }).click();
  await expect(page.getByRole('heading', { name: '清单已冻结（模拟）' })).toBeVisible();

  const afterFreeze = await homeCard(page);
  await expect(afterFreeze).toContainText('清单已冻结，待打包');
  await expect(afterFreeze).toContainText('待打包');
  await expect(afterFreeze).not.toContainText('交付包已生成');
  await afterFreeze.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '开始打包冻结清单' }).click();
  await expect(page).toHaveURL(`${base}/delivery`);

  await page.getByLabel('打包回执场景').selectOption('FAILED');
  await page.getByRole('button', { name: '开始打包（模拟）' }).click();
  await expect(page.getByText('打包失败；冻结清单与确认未改变')).toBeVisible();
  const afterFailure = await homeCard(page);
  await expect(afterFailure).toContainText('打包失败，待重试');
  await expect(afterFailure).toContainText('打包失败');
  await afterFailure.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '重试同一冻结清单' }).click();
  await expect(page).toHaveURL(`${base}/delivery`);

  await page.getByLabel('打包回执场景').selectOption('UNKNOWN');
  await page.getByRole('button', { name: '再次打包同一冻结清单（模拟）' }).click();
  await expect(page.getByText('打包结果待核验；只查询原打包请求。')).toBeVisible();
  const afterUnknown = await homeCard(page);
  await expect(afterUnknown).toContainText('打包结果待核验');
  await afterUnknown.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '核对原打包请求' }).click();
  await expect(page).toHaveURL(`${base}/delivery`);
  await page.getByRole('button', { name: '查询原打包请求' }).click();
  await expect(page.getByRole('heading', { name: '演练交付包 1' })).toBeVisible();

  const afterPackage = await homeCard(page);
  await expect(afterPackage).toContainText('交付包已生成（模拟）');
  await expect(afterPackage).toContainText('交付包可用');
  await afterPackage.getByRole('link', { name: '查看项目概览' }).click();
  await page.getByRole('link', { name: '查看最终交付包' }).click();
  await expect(page).toHaveURL(`${base}/delivery`);
  await expect(page.getByText('包可用（模拟）').first()).toBeVisible();
  const bytes = await downloadBytes(
    page,
    page.getByRole('button', { name: '下载这个演练 ZIP' }).first(),
  );
  expect(bytes.includes(Buffer.from('SYNTHETIC-MANIFEST.md'))).toBe(true);
  expect(bytes.includes(Buffer.from('SYNTHETIC DEVELOPMENT SAMPLE ONLY'))).toBe(true);
  expect(bytes.includes(Buffer.from('01-F-MANUAL.md'))).toBe(true);
  expect(bytes.includes(Buffer.from('02-F-PROCEDURE.md'))).toBe(true);
  expect(bytes.includes(Buffer.from('03-F-EXTERNAL-RULE.md'))).toBe(true);
  expect(bytes.includes(Buffer.from('分别表达文件层级'))).toBe(true);
  await expect(page.getByText('下载不表示客户已收到')).toBeVisible();
});

test('protected content, template conflicts and reading limits require explicit version-bound simulated decisions', async ({
  page,
}) => {
  await page.goto(reportOne);
  const governance = page.getByRole('region', { name: '受保护内容与模板冲突' });
  await expect(governance).toBeVisible();
  for (const category of ['质量方针', '质量目标', '人员架构', '组织架构', '关联流程', '产品流程']) {
    await expect(governance.locator('.governance-card', { hasText: category })).toContainText(
      '只读',
    );
  }
  await expect(page.getByText('普通意见不会改变受保护客户内容')).toBeVisible();

  const policy = governance.locator('.governance-card', { hasText: '质量方针' });
  await policy.getByRole('button', { name: '提议变更受保护内容（模拟）' }).click();
  await expect(policy).toContainText('已登记受保护内容变更提议');
  await policy.getByRole('button', { name: '记录版本绑定决定：保留客户既有方针（模拟）' }).click();
  await expect(policy).toContainText('已记录模拟决定');
  await expect(policy).toContainText('绑定报告第 1 版');

  const structure = governance.locator('.governance-card', {
    hasText: '客户三层文件结构与模板四层结构并存',
  });
  await expect(structure).toContainText('客户现有依据');
  await expect(structure).toContainText('正式模板依据（只读）');
  await structure
    .getByRole('button', { name: '记录模拟决定：保留客户结构并补编号映射（模拟）' })
    .click();
  await expect(structure).toContainText('已记录模拟人工处理决定');
  await expect(structure).toContainText('绑定报告第 1 版');

  await page.getByRole('link', { name: '资料批次' }).click();
  await expect(page.locator('.intake-batch')).toContainText('嵌套 RAR');
  await expect(page.locator('.batch-entries tr[data-state="FAILED"]')).toContainText('损坏');
  await expect(page.locator('.batch-limitations')).toContainText('RAR 成员未解包');

  await page.getByRole('link', { name: '查看分析并记录客户答复' }).click();
  await openAnalysisControls(page);
  await page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click();
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
  await expect(page.getByRole('region', { name: '受保护内容与模板冲突' })).toContainText(
    '客户既有记录编号与模板 QR 编号并存',
  );
  const secondPolicy = page
    .getByRole('region', { name: '受保护内容与模板冲突' })
    .locator('.governance-card', { hasText: '质量方针' });
  await expect(secondPolicy).not.toContainText('已记录模拟决定');
  await expect(page.locator('.understanding-groups')).toContainText('读取限制');
});
