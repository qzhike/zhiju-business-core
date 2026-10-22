import { test, expect, type Locator, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { readFile, readdir } from 'node:fs/promises';

const base = '/projects/MVP-U1-PROJECT';
const overview = `${base}/overview`;
const reportOne = `${base}/analysis/U1-REPORT-01`;
const plan = `${base}/startup/U1-REPORT-02`;
const manual = `${base}/stages/manual`;
const procedures = `${base}/stages/procedures`;
const records = `${base}/stages/records`;
const rework = `${base}/rework`;
const recovery = `${base}/recovery`;
const delivery = `${base}/delivery`;

function requestId(text: string | null): string {
  return text?.match(/U3-(?:RETRY|FINAL)-[0-9a-f]+/u)?.[0] ?? '';
}

function stageRequestId(text: string | null): string {
  return text?.match(/U2-REV-[0-9a-f]+/u)?.[0] ?? '';
}

function journeyLink(page: Page, name: string) {
  return page.getByRole('navigation', { name: '同一项目的页面路径' }).getByRole('link', { name });
}

async function openAnalysisControls(page: Page) {
  const details = page.locator('details.fixture-options', { hasText: 'U1 分析演示控制' });
  await details.waitFor({ state: 'attached' });
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

async function acknowledgeSecondReport(page: Page) {
  await page.goto(reportOne);
  await openAnalysisControls(page);
  await page.getByRole('button', { name: '带入固定客户答复（成功场景）' }).click();
  await page.getByRole('button', { name: '提交补充', exact: true }).click();
  await page.getByRole('link', { name: '主动查看第 2 版' }).click();
  await page.getByRole('button', { name: '标记已核对第 2 版' }).click();
}

async function confirmPlan(page: Page) {
  await page.getByRole('button', { name: '确认这份修改范围' }).click();
  await page.getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.locator('.plan-receipt')).toContainText('回执与计划、报告版本和输入依据匹配');
}

async function confirmScope(page: Page) {
  await acknowledgeSecondReport(page);
  await page.getByRole('link', { name: '核对信息与文件范围 →' }).click();
  await expect(page).toHaveURL(plan);
  await confirmPlan(page);
}

async function reachManual(page: Page) {
  await confirmScope(page);
  await page.getByRole('button', { name: '进入质量手册审阅（演示）' }).click();
  await expect(page).toHaveURL(manual);
}

async function generate(page: Page) {
  await page.getByRole('button', { name: '模拟生成本阶段候选' }).click();
  await expect(page.locator('.markdown-review')).toBeVisible();
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

async function reachRecordsWithCandidates(page: Page) {
  await reachManual(page);
  await generate(page);
  await finalizeStage(page, 'quality', '质量手册 · 第 1 版候选');
  await page.getByRole('link', { name: '进入控制程序与管理制度审阅' }).click();
  await expect(page).toHaveURL(procedures);
  await generate(page);
  await finalizeStage(page, 'set', '变更控制程序 · 第 1 版候选');
  await page.getByRole('link', { name: '进入记录表单审阅' }).click();
  await expect(page).toHaveURL(records);
  await generate(page);
}

async function reviewRecords(page: Page) {
  await page.getByRole('button', { name: '确认已复核受影响表单（模拟）' }).click();
  await expect(page.getByRole('link', { name: '进入最终交付确认（模拟）' })).toBeVisible();
}

async function reachDeliveryReady(page: Page) {
  await reachRecordsWithCandidates(page);
  await reviewRecords(page);
  await page.getByRole('link', { name: '进入最终交付确认（模拟）' }).click();
  await expect(page).toHaveURL(delivery);
  await expect(page.getByText('最终交付当前不可确认')).toHaveCount(0);
}

async function recheckAndConfirm(page: Page) {
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await expect(page.getByText('已选 6 / 6 份')).toBeVisible();
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('质量手册 · 第 1 版候选');
  await dialog.getByRole('button', { name: '确认并冻结清单' }).click();
  await expect(page.getByRole('heading', { name: '清单已冻结（模拟）' })).toBeVisible();
}

async function downloadBytes(page: Page, button: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path);
}

test('connected journey re-finalizes upstream, re-reviews downstream and prepares an exact delivery list', async ({
  page,
}) => {
  await reachRecordsWithCandidates(page);
  await reviewRecords(page);
  await page.getByRole('link', { name: '进入最终交付确认（模拟）' }).click();
  await expect(page).toHaveURL(delivery);
  await expect(page.getByText('最终交付当前不可确认')).toHaveCount(0);
  await expect(page.getByText('已选 0 / 6 份')).toBeVisible();

  await journeyLink(page, '返工与复核').click();
  await expect(page.getByRole('heading', { name: '返工与复核' })).toBeVisible();
  await expect(page.getByText('当前定稿：')).toBeVisible();
  await page.getByRole('button', { name: '模拟新手册草稿到达（第 3 版）' }).click();
  await expect(page.locator('.notice', { hasText: '新草稿已到达' })).toBeVisible();
  await expect(page.locator('.u3-page')).toContainText('在显式重新定稿并读回匹配回执之前');

  await page.getByRole('link', { name: '打开质量手册审阅并重新定稿' }).click();
  await expect(page.locator('.stage-rework-notice')).toContainText('仍以定稿');
  await page.getByRole('button', { name: '模拟已核对并采用本阶段全部最新候选' }).click();
  await expect(page.getByRole('button', { name: '重新确认质量手册定稿（模拟）' })).toBeEnabled();
  await page.getByRole('button', { name: '重新确认质量手册定稿（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
  await expect(page.locator('.stage-rework')).toContainText('上一版定稿');
  await expect(page.locator('.stage-rework')).toContainText('已由');

  await page.getByRole('link', { name: '进入控制程序与管理制度审阅' }).click();
  await expect(page.locator('.stage-rework-impact')).toContainText('质量手册重新定稿');
  await expect(page.locator('.stage-rework-impact')).toContainText('修改');
  await expect(page.locator('.stage-rework-impact')).toContainText('保留');
  await expect(page.locator('.stage-rework-impact')).toContainText('外来文件管理规定');
  await expect(page.getByRole('button', { name: '重新确认第二阶段完整集合（模拟）' })).toHaveCount(
    0,
  );

  await journeyLink(page, '返工与复核').click();
  await page.getByRole('button', { name: '模拟新手册依据下的程序候选（第 3 版）' }).click();
  await page.getByRole('link', { name: '打开第二阶段审阅并重新定稿' }).click();
  await page.getByRole('button', { name: '模拟已核对并采用本阶段全部最新候选' }).click();
  await expect(
    page.getByRole('button', { name: '重新确认第二阶段完整集合（模拟）' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: '重新确认第二阶段完整集合（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并生成模拟回执' }).click();
  await expect(page.getByRole('heading', { name: '模拟阶段定稿已完成' })).toBeVisible();
  await expect(page.locator('.stage-rework')).toContainText('上一版定稿');

  await page.getByRole('link', { name: '进入记录表单审阅' }).click();
  await expect(page.locator('.stage-rework-impact')).toContainText('第二阶段完整集合定稿');
  await page.getByRole('button', { name: '模拟已核对并采用本阶段全部最新候选' }).click();
  await page.getByRole('button', { name: '确认已复核受影响表单（模拟）' }).click();
  await expect(page.getByText('已记录到当前精确版本')).toBeVisible();
  await journeyLink(page, '返工与复核').click();
  await expect(page.getByText('两项上游依据与记录表单复核均已就绪')).toBeVisible();
  await journeyLink(page, '最终交付').click();
  await expect(page).toHaveURL(delivery);
  await expect(page.getByText('最终交付当前不可确认')).toHaveCount(0);
  await expect(page.locator('.u3-basis')).toContainText('记录表单复核');
  await expect(page.locator('.u3-page')).toContainText('待交付精确清单');
});

test('delivery preserves the selection when required files are missing or the basis changes before confirmation', async ({
  page,
}) => {
  await reachDeliveryReady(page);
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await page.getByRole('checkbox', { name: '选择 质量手册' }).uncheck();
  await expect(page.getByText('最终清单缺少必需文件：F-MANUAL。')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeDisabled();
  await page.getByRole('checkbox', { name: '选择 质量手册' }).check();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeEnabled();

  await page.getByLabel('确认回执场景').selectOption('changed');
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并冻结清单' }).click();
  await expect(page.getByText('确认前版本/依据已变化；未冻结')).toBeVisible();
  await expect(page.getByRole('heading', { name: '清单已冻结（模拟）' })).toHaveCount(0);
  await expect(page.getByText('记录表单复核后又出现新候选；请重新核对精确版本。')).toBeVisible();

  await journeyLink(page, '记录表单审阅').click();
  await page.getByRole('button', { name: '模拟已核对并采用本阶段全部最新候选' }).click();
  await page.getByRole('button', { name: '确认已复核受影响表单（模拟）' }).click();
  await page.getByRole('link', { name: '进入最终交付确认（模拟）' }).click();
  await page.getByLabel('确认回执场景').selectOption('matched');
  await recheckAndConfirm(page);
});

test('delivery confirmation is explicit and unknown packaging reconciles before download', async ({
  page,
}) => {
  await reachDeliveryReady(page);
  await expect(page.getByText('已选 0 / 6 份')).toBeVisible();
  await recheckAndConfirm(page);

  await page.getByLabel('打包回执场景').selectOption('UNKNOWN');
  await page.getByRole('button', { name: '开始打包（模拟）' }).click();
  await expect(page.getByText('打包结果待核验；只查询原打包请求。')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试同一冻结清单（模拟）' })).toBeDisabled();
  await page.getByRole('button', { name: '查询原打包请求' }).click();
  await expect(page.getByRole('heading', { name: '演练交付包 1' })).toBeVisible();
  await expect(page.getByText('已核对原打包请求')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toHaveCount(0);

  const firstBytes = await downloadBytes(
    page,
    page.getByRole('button', { name: '下载这个演练 ZIP' }).first(),
  );
  expect(firstBytes.includes(Buffer.from('SYNTHETIC-MANIFEST.md'))).toBe(true);
  expect(firstBytes.includes(Buffer.from('返工稿保留四层文件结构'))).toBe(false);
  expect(firstBytes.includes(Buffer.from('分别表达文件层级'))).toBe(true);
  expect(firstBytes.includes(Buffer.from('01-F-MANUAL.md'))).toBe(true);
  await expect(page.getByText('已请求下载，保存情况未知')).toBeVisible();
  await expect(page.getByText('浏览器已收到并开始保存响应；不表示客户已收到')).toBeVisible();
});

test('failed packaging retries the same frozen list without repeating confirmation', async ({
  page,
}) => {
  await reachDeliveryReady(page);
  await recheckAndConfirm(page);
  await page.getByLabel('打包回执场景').selectOption('FAILED');
  await page.getByRole('button', { name: '开始打包（模拟）' }).click();
  await expect(page.getByText('打包失败；冻结清单与确认未改变')).toBeVisible();
  await expect(page.getByRole('heading', { name: '演练交付包 1' })).toHaveCount(0);

  await page.getByLabel('打包回执场景').selectOption('AVAILABLE');
  await page.getByRole('button', { name: '重试同一冻结清单（模拟）' }).click();
  await expect(page.getByRole('heading', { name: '演练交付包 1' })).toBeVisible();
  await expect(page.getByText('清单已冻结（模拟）')).toBeVisible();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toHaveCount(0);

  const bytes = await downloadBytes(
    page,
    page.getByRole('button', { name: '下载这个演练 ZIP' }).first(),
  );
  expect(bytes.includes(Buffer.from('分别表达文件层级'))).toBe(true);
  await expect(page.getByText('浏览器已收到并开始保存响应；不表示客户已收到')).toBeVisible();
});

test('later record revision starts a new package without changing the historical package', async ({
  page,
}) => {
  await reachDeliveryReady(page);
  await recheckAndConfirm(page);
  await page.getByLabel('打包回执场景').selectOption('AVAILABLE');
  await page.getByRole('button', { name: '开始打包（模拟）' }).click();
  await expect(page.getByRole('heading', { name: '演练交付包 1' })).toBeVisible();
  const oldPackage = page.locator('.u3-package', { hasText: '演练交付包 1' });
  const oldBytes = await downloadBytes(
    page,
    oldPackage.getByRole('button', { name: '下载这个演练 ZIP' }),
  );

  await page.getByRole('button', { name: '模拟记录表单后续改稿（第 3 版）' }).click();
  await expect(page.getByText('记录表单出现后续改稿')).toBeVisible();
  await journeyLink(page, '记录表单审阅').click();
  await page.getByRole('button', { name: '模拟已核对并采用本阶段全部最新候选' }).click();
  await page.getByRole('button', { name: '确认已复核受影响表单（模拟）' }).click();
  await page.getByRole('link', { name: '进入最终交付确认（模拟）' }).click();

  await page.getByRole('button', { name: '开始新一轮最终交付确认（保留历史包）' }).click();
  await recheckAndConfirm(page);
  await page.getByLabel('打包回执场景').selectOption('AVAILABLE');
  await page.getByRole('button', { name: '开始打包（模拟）' }).click();
  await expect(page.getByRole('heading', { name: '演练交付包 2' })).toBeVisible();

  const historical = page.locator('.u3-package', { hasText: '演练交付包 1' });
  await expect(historical).toContainText('变更申请单');
  const oldAgain = await downloadBytes(
    page,
    historical.getByRole('button', { name: '下载这个演练 ZIP' }),
  );
  expect(oldAgain.equals(oldBytes)).toBe(true);
  const current = page.locator('.u3-package', { hasText: '演练交付包 2' });
  const currentBytes = await downloadBytes(
    page,
    current.getByRole('button', { name: '下载这个演练 ZIP' }),
  );
  expect(currentBytes.includes(Buffer.from('返工后的质量手册'))).toBe(true);
  expect(currentBytes.equals(oldBytes)).toBe(false);

  await page.getByRole('link', { name: '项目概览' }).click();
  await journeyLink(page, '最终交付').click();
  const historicalAfterReturn = page.locator('.u3-package', { hasText: '演练交付包 1' });
  await expect(historicalAfterReturn).toBeVisible();
  const oldAfterReturn = await downloadBytes(
    page,
    historicalAfterReturn.getByRole('button', { name: '下载这个演练 ZIP' }),
  );
  expect(oldAfterReturn.equals(oldBytes)).toBe(true);
});

test('recovery retries only failed files, reconciles unknown requests and keeps late results as history', async ({
  page,
}) => {
  await confirmScope(page);
  await journeyLink(page, '执行与恢复').click();
  await expect(page).toHaveURL(recovery);
  await expect(page.getByRole('heading', { name: '执行与恢复' })).toBeVisible();
  await expect(page.locator('.u3-page')).toContainText('部分成功（模拟）');
  await expect(page.locator('.u3-page')).toContainText('已知失败');
  await expect(page.locator('.u3-page')).toContainText('结果可审阅');
  await expect(page.locator('.u3-page')).toContainText('本项目同时只保留一个活动修改批次');

  await page.getByLabel('重试回执场景').selectOption('failed');
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  await expect(
    page.getByText('模拟重试失败；原尝试、成功候选与错误历史保留，可再次只重试失败文件。'),
  ).toBeVisible();
  const failedRequestId = requestId(await page.getByText(/原请求 U3-RETRY-/u).textContent());
  await expect(page.getByRole('button', { name: '仅重试失败文件（模拟）' })).toBeEnabled();

  await page.getByLabel('重试回执场景').selectOption('pending');
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  const firstRequestId = requestId(await page.getByText(/原请求 U3-RETRY-/u).textContent());
  expect(firstRequestId).not.toBe(failedRequestId);
  await expect(page.locator('.u3-page')).toContainText('已结束的重试请求');
  await expect(page.locator('.u3-page')).toContainText(failedRequestId);
  await expect(page.getByRole('button', { name: '仅重试失败文件（模拟）' })).toBeDisabled();
  await page.getByRole('link', { name: '项目概览' }).click();
  await page.getByRole('link', { name: '执行与恢复', exact: true }).click();
  await expect(page.locator('.u3-page')).toContainText(firstRequestId);
  await page.getByRole('button', { name: '模拟原重试回执到达' }).click();
  await page.getByRole('button', { name: '查询原重试请求' }).click();
  await expect(page.locator('.u3-attempt')).toHaveCount(2);
  await expect(page.locator('.u3-attempt').last()).toContainText('失败文件恢复尝试');
  const recoveredFiles = page.locator('.u3-attempt').last().locator('ul').first();
  await expect(recoveredFiles).toContainText('变更申请单');
  await expect(recoveredFiles).not.toContainText('质量手册');
  await expect(page.locator('.u3-page')).toContainText('部分成功已恢复（模拟）');

  await page.getByRole('button', { name: '模拟依据变化后的迟到结果' }).click();
  await page.getByRole('button', { name: '模拟较新尝试后的旧结果' }).click();
  await expect(page.locator('.u3-page')).toContainText('HISTORY_ONLY');
  await expect(page.locator('.u3-page')).toContainText('上游依据已变化');
  await expect(page.locator('.u3-page')).toContainText('较新尝试');

  await page.locator('#recovery-note').fill('恢复期间保存的下一轮意见');
  await page.getByRole('button', { name: '保存下一轮意见（模拟）' }).click();
  await page.getByRole('button', { name: '模拟原意见保存回执到达/查询' }).click();
  await expect(page.locator('.markdown-history')).toContainText('恢复期间保存的下一轮意见');
  await page.getByRole('link', { name: '项目概览' }).click();
  await page.getByRole('link', { name: '执行与恢复', exact: true }).click();
  await expect(page.locator('#recovery-note')).toHaveValue('恢复期间保存的下一轮意见');
  await expect(page.locator('.markdown-history')).toContainText('恢复期间保存的下一轮意见');
});

test('mismatched recovery receipt keeps the original request locked until a matching result', async ({
  page,
}) => {
  await confirmScope(page);
  await journeyLink(page, '执行与恢复').click();
  await page.getByLabel('重试回执场景').selectOption('mismatch');
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  const originalId = requestId(await page.getByText(/原请求 U3-RETRY-/u).textContent());
  await page.getByRole('button', { name: '查询原重试请求' }).click();
  await expect(page.getByText('回执属于其他项目/尝试或文件集合')).toBeVisible();
  await expect(page.locator('.u3-attempt')).toHaveCount(1);
  await expect(page.getByText('错绑回执不能证明原尝试结束')).toBeVisible();
  await expect(page.getByRole('button', { name: '仅重试失败文件（模拟）' })).toBeDisabled();
  expect(requestId(await page.getByText(/原请求 U3-RETRY-/u).textContent())).toBe(originalId);

  await page.getByRole('link', { name: '项目概览' }).click();
  await journeyLink(page, '执行与恢复').click();
  await expect(page.locator('.u3-page')).toContainText(originalId);
  await expect(page.getByRole('button', { name: '仅重试失败文件（模拟）' })).toBeDisabled();
  await page.getByRole('button', { name: '模拟原重试回执到达' }).click();
  await page.getByRole('button', { name: '查询原重试请求' }).click();
  await expect(page.locator('.u3-attempt')).toHaveCount(2);
  await expect(page.locator('.u3-page')).toContainText('原重试回执已核验');
  await expect(page.locator('.u3-page')).toContainText(originalId);
  await expect(page.getByRole('button', { name: '仅重试失败文件（模拟）' })).toBeDisabled();
});

test('unresolved final confirmation survives list operations and navigation', async ({ page }) => {
  await reachDeliveryReady(page);
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await page.getByLabel('确认回执场景').selectOption('unknown');
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并冻结清单' }).click();
  const originalId = requestId(await page.getByText(/原请求 U3-FINAL-/u).textContent());
  await expect(page.getByRole('checkbox', { name: '选择 质量手册' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '重新核对当前清单（模拟）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeDisabled();

  await page.getByRole('link', { name: '项目概览' }).click();
  await journeyLink(page, '最终交付').click();
  await expect(page.locator('.u3-page')).toContainText(originalId);
  await expect(page.getByRole('button', { name: '重新核对当前清单（模拟）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeDisabled();
  await page.getByRole('button', { name: '模拟原确认回执到达' }).click();
  await page.getByRole('button', { name: '重新查询原确认请求' }).click();
  await expect(page.getByRole('heading', { name: '清单已冻结（模拟）' })).toBeVisible();
});

test('mismatched final confirmation stays locked until explicitly ended', async ({ page }) => {
  await reachDeliveryReady(page);
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await page.getByLabel('确认回执场景').selectOption('mismatch');
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并冻结清单' }).click();
  await page.getByRole('button', { name: '重新查询原确认请求' }).click();
  await expect(page.getByText('确认回执与清单或依据不匹配')).toBeVisible();
  const originalId = requestId(await page.getByText(/原请求 U3-FINAL-/u).textContent());
  await expect(page.getByRole('button', { name: '重新核对当前清单（模拟）' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeDisabled();

  await page.getByRole('button', { name: '标记原确认请求已结束（模拟）' }).click();
  await expect(page.getByText('已显式标记原确认请求结束')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新核对当前清单（模拟）' })).toBeEnabled();
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await expect(page.getByText('已结束的确认请求')).toBeVisible();
  await expect(page.locator('.u3-page')).toContainText(originalId);
  await page.getByLabel('确认回执场景').selectOption('matched');
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并冻结清单' }).click();
  await expect(page.getByRole('heading', { name: '清单已冻结（模拟）' })).toBeVisible();
});

test('unresolved recovery request blocks final delivery until reconciled', async ({ page }) => {
  await reachDeliveryReady(page);
  await journeyLink(page, '执行与恢复').click();
  await page.getByLabel('重试回执场景').selectOption('unknown');
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  const retryId = requestId(await page.getByText(/原请求 U3-RETRY-/u).textContent());

  await journeyLink(page, '最终交付').click();
  await expect(
    page.getByText(`仍有待回执或待核验的恢复请求 ${retryId}；不能确认最终交付。`),
  ).toBeVisible();
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeDisabled();
  await page.getByRole('link', { name: '执行与恢复' }).first().click();
  await expect(page.locator('.u3-page')).toContainText(retryId);
  await page.getByRole('button', { name: '模拟原重试回执到达' }).click();
  await page.getByRole('button', { name: '查询原重试请求' }).click();
  await expect(page.locator('.u3-attempt')).toHaveCount(2);

  await journeyLink(page, '最终交付').click();
  await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
  await expect(page.getByRole('button', { name: '确认最终交付清单（模拟）' })).toBeEnabled();
  await page.getByLabel('确认回执场景').selectOption('matched');
  await page.getByRole('button', { name: '确认最终交付清单（模拟）' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认并冻结清单' }).click();
  await expect(page.getByRole('heading', { name: '清单已冻结（模拟）' })).toBeVisible();
});

test('unresolved recovery blocks a second stage modification and releases after convergence', async ({
  page,
}) => {
  await reachRecordsWithCandidates(page);
  await journeyLink(page, '执行与恢复').click();
  await page.getByLabel('重试回执场景').selectOption('unknown');
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  const retryId = requestId(await page.getByText(/原请求 U3-RETRY-/u).textContent());

  await journeyLink(page, '记录表单审阅').click();
  await page.locator('#markdown-note').fill('恢复未收敛时尝试的第二批次');
  await page.getByLabel('修改回执场景').selectOption('UNKNOWN');
  await expect(page.getByText(`本项目已有待回执或待核验的恢复请求 ${retryId}`)).toBeVisible();
  await expect(page.getByRole('button', { name: '提交并修改' })).toBeDisabled();
  await expect(page.locator('main')).not.toContainText('U2-REV-');

  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await journeyLink(page, '执行与恢复').click();
  await expect(page.locator('.u3-page')).toContainText(retryId);
  await page.getByRole('button', { name: '模拟原重试回执到达' }).click();
  await page.getByRole('button', { name: '查询原重试请求' }).click();
  await journeyLink(page, '记录表单审阅').click();
  await expect(page.getByRole('button', { name: '提交并修改' })).toBeEnabled();
  await page.getByRole('button', { name: '提交并修改' }).click();
  await expect(page.locator('.markdown-history')).toContainText('U2-REV-');
});

test('unresolved stage modification blocks recovery and releases after convergence', async ({
  page,
}) => {
  await reachRecordsWithCandidates(page);
  await page.locator('#markdown-note').fill('先创建的阶段修改批次');
  await page.getByLabel('修改回执场景').selectOption('UNKNOWN');
  await page.getByRole('button', { name: '提交并修改' }).click();
  const stageId = stageRequestId(await page.locator('.markdown-submission').textContent());

  await journeyLink(page, '执行与恢复').click();
  await page.getByLabel('重试回执场景').selectOption('pending');
  await expect(page.getByRole('button', { name: '仅重试失败文件（模拟）' })).toBeDisabled();
  await expect(page.getByText(`本项目已有待回执或待核验的修改请求 ${stageId}`)).toBeVisible();
  await expect(page.getByText(/原请求 U3-RETRY-/u)).toHaveCount(0);

  await journeyLink(page, '记录表单审阅').click();
  await page.getByRole('button', { name: '模拟原修订回执到达' }).click();
  await page.getByRole('button', { name: '重新查询原修订请求' }).click();
  await journeyLink(page, '执行与恢复').click();
  await page.getByRole('button', { name: '仅重试失败文件（模拟）' }).click();
  await expect(page.getByText(/原请求 U3-RETRY-/u)).toBeVisible();
});

test('deep links and missing prerequisites cannot fabricate the U3 journey', async ({ page }) => {
  await page.goto(rework);
  await expect(page.getByRole('heading', { name: '返工与复核' })).toBeVisible();
  await expect(page.locator('.u3-page')).toContainText('尚无质量手册模拟定稿');
  await expect(page.getByRole('link', { name: '打开最终交付（模拟）' })).toBeVisible();

  await page.goto(delivery);
  await expect(page.getByRole('heading', { name: '最终交付确认' })).toBeVisible();
  await expect(page.getByText('最终交付当前不可确认')).toBeVisible();
  const deliveryBasis = page.getByRole('region', { name: '交付依据' });
  await expect(deliveryBasis.getByRole('link', { name: '返工与复核' })).toBeVisible();
  await expect(deliveryBasis.getByRole('link', { name: '记录表单审阅' })).toBeVisible();

  await page.goto('/projects/OTHER/rework');
  await expect(page.getByRole('heading', { name: '无法打开此页面' })).toBeVisible();
  await page.goto('/projects/OTHER/delivery');
  await expect(page.getByRole('heading', { name: '无法打开此页面' })).toBeVisible();
});

test('narrow layouts and keyboard keep U3 tables, reasons, opinions and confirmations usable', async ({
  page,
  browser,
}) => {
  console.log(`U3 controlled Chromium ${browser.version()}; user U3 walkthrough still NOT RUN`);
  await reachDeliveryReady(page);
  for (const [width, height] of [
    [1440, 900],
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('note').filter({ hasText: '环境 A' })).toBeVisible();
    await expect(page.locator('.u3-basis')).toBeVisible();
    await expect(page.getByRole('region', { name: '待交付文件选择' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 900 });
    const confirm = page.getByRole('button', { name: '确认最终交付清单（模拟）' });
    await page.getByRole('button', { name: '重新核对当前清单（模拟）' }).click();
    await confirm.focus();
    await expect(confirm).toBeFocused();
    await confirm.press('Enter');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(confirm).toBeFocused();
  }

  await page.goto(rework);
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator('.u3-page')).toContainText('最终交付条件');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.goto(recovery);
  await expect(page.locator('.u3-page')).toContainText('失败文件恢复');
  await expect(page.locator('#recovery-note')).toBeVisible();
});

test('production build excludes the U3 adapter, rehearsal data and synthetic exporter', async ({
  page,
}) => {
  for (const file of await readdir('apps/workspace-web/dist/assets')) {
    if (!file.endsWith('.js')) continue;
    const source = await readFile(`apps/workspace-web/dist/assets/${file}`, 'utf8');
    for (const marker of [
      'DEVELOPMENT_U3_ADAPTER_ONLY',
      'U3-RETRY-',
      'U3-FINAL-',
      'U3-PKG-',
      'SYNTHETIC-MANIFEST.md',
      'U3 返工与恢复场景',
      'U3 执行恢复场景控制',
      'U3 交付场景控制',
      '返工与复核',
      '执行与恢复',
    ])
      expect(source.includes(marker), `Production bundle must exclude ${marker}`).toBe(false);
  }
  await page.goto(rework);
  await expect(page.getByRole('heading', { name: '返工与复核' })).toHaveCount(0);
  await page.goto(overview);
  await expect(page.getByRole('link', { name: '返工与复核' })).toHaveCount(0);
});
