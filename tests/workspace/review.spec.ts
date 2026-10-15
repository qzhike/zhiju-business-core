// IM-UI-01 (#286): the bounded review workspace journey on the development fixture.
//
// It exercises the shared MarkdownReviewPage through the isolated development
// adapter: the bounded three-column layout, the 36-change/9-chapter navigation
// with its chapter-grouped location dialog, the paged 201-file directory, the
// single opinion area (draft/receipt/suggestion/approval states) and the narrow
// viewport pane switch. Synthetic content only; no real service is involved.
import { readdir, readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const workspace = '/review-workspace';
const controls = async (page: Page) => {
  const details = page.locator('details.review-controls');
  if ((await details.getAttribute('open')) === null) await details.locator('> summary').click();
  return details;
};
const position = (page: Page) => page.locator('.markdown-change-current small');
function requiredValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing review test evidence');
  return value;
}
const submit = (page: Page) =>
  page.locator('.markdown-opinion > button', { hasText: '提交并修改' }).first();
const approve = (page: Page) =>
  page.locator('.markdown-opinion > button', { hasText: '检查完成并批准' }).first();

test('keeps the bounded three-column layout and navigates 36 changes across 9 chapters', async ({
  page,
  browser,
}) => {
  console.log(
    `Review workspace controlled Chromium ${browser.version()}; production service/Chrome/Edge matrix NOT RUN`,
  );
  await page.goto(workspace);
  await expect(page.locator('.markdown-files')).toBeVisible();
  await expect(page.locator('.markdown-reader')).toBeVisible();
  await expect(page.locator('.markdown-opinion')).toBeVisible();
  await expect(page.getByRole('heading', { name: '预防措施程序（合成）' })).toBeVisible();
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await expect(position(page)).toContainText('当前 1 / 36');
  const note = page.getByRole('textbox', { name: '意见草稿' });
  await note.fill('未提交的本页意见');
  await page.getByRole('button', { name: '下一处变化' }).click();
  await expect(position(page)).toContainText('当前 2 / 36');
  await expect(note).toHaveValue('未提交的本页意见');
  await expect(page.getByText('逐处查看不代表检查完成')).toBeVisible();

  // The location dialog groups all changes by chapter and keeps its expansion.
  await page.getByRole('button', { name: '查看全部位置 ▤' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '全部修改位置 · 36 处' })).toBeVisible();
  await expect(dialog.locator('details')).toHaveCount(9);
  await expect(dialog.locator('details button')).toHaveCount(36);
  const chapterFive = dialog.locator('details', { hasText: '5 评估与确定措施' });
  await chapterFive.locator('summary').click();
  await expect(chapterFive).not.toHaveAttribute('open', '');
  await chapterFive.locator('summary').click();
  await expect(chapterFive).toHaveAttribute('open', '');
  await dialog.getByRole('searchbox', { name: '查找位置' }).fill('评估与确定措施');
  await expect(dialog.locator('details')).toHaveCount(1);
  await expect(dialog.locator('details button')).toHaveCount(4);
  await dialog.getByRole('searchbox', { name: '查找位置' }).fill('');
  await chapterFive.locator('button', { hasText: '计划时间填写' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(position(page)).toContainText('当前 20 / 36');
  await expect(note).toHaveValue('未提交的本页意见');
  await page.getByRole('button', { name: '查看全部位置 ▤' }).click();
  await expect(
    page.getByRole('dialog').locator('details', { hasText: '5 评估与确定措施' }),
  ).toHaveAttribute('open', '');
  await expect(page.getByRole('dialog').locator('button[aria-current="step"]')).toContainText(
    '计划时间填写',
  );
  await page.getByRole('dialog').getByRole('button', { name: '返回阅读' }).click();

  // The in-chapter disclosure stays expanded while navigating inside it.
  const chapter = page.locator('.markdown-chapter-context');
  await chapter.locator('summary').click();
  await expect(chapter).toHaveAttribute('open', '');
  await chapter.locator('button', { hasText: '责任安排引用' }).click();
  await expect(position(page)).toContainText('当前 19 / 36');
  await expect(chapter).toHaveAttribute('open', '');
  await expect(note).toHaveValue('未提交的本页意见');

  // Added, removed and moved content keep their own supplied location story.
  await page.getByRole('button', { name: '查看全部位置 ▤' }).click();
  const group = (name: string) => page.getByRole('dialog').locator('details', { hasText: name });
  await group('1 目的与适用范围').locator('button', { hasText: '术语说明' }).click();
  await expect(page.locator('.markdown-location-note').first()).toContainText('新增内容没有旧位置');
  await page.getByRole('button', { name: '查看全部位置 ▤' }).click();
  await group('8 相关文件与记录').locator('button', { hasText: '客户资料追溯' }).click();
  await expect(page.locator('.markdown-location-note').first()).toContainText(
    '已删除内容只保留在原版本位置',
  );
  await page.getByRole('button', { name: '查看全部位置 ▤' }).click();
  await group('9 修订与文件控制').locator('button', { hasText: '历史版本保留' }).click();
  await expect(page.locator('.markdown-location-note').first()).toContainText(
    '移动保留原位置与新位置',
  );
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: '查看全部位置 ▤' }).click();
  await expect(
    group('9 修订与文件控制').locator('button', { hasText: '历史版本保留' }),
  ).toContainText('位置待核对');
  await expect(page.locator('.markdown-location-note').last()).toContainText(
    '未自动改绑到相邻内容',
  );
  await page.getByRole('dialog').getByRole('button', { name: '返回阅读' }).click();

  // The full document keeps every column of the wide table.
  await page.getByRole('button', { name: '完整文件' }).click();
  const table = page.getByRole('region', { name: '完整表格，可横向滚动' });
  expect(await table.locator('th').count()).toBe(12);
  expect(await table.locator('tbody tr').first().locator('td').count()).toBe(12);
  expect(await table.locator('td').nth(0).innerText()).toBe('0');
  expect(await table.locator('td').nth(1).innerText()).toBe('');
  expect(await table.locator('td').last().innerText()).toBe('最后一列完整');
  expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: /摘要与依据/ }).click();
  await expect(page.locator('.markdown-summary')).toContainText('保留企业现行安排');
  await expect(page.locator('.markdown-summary')).toContainText('来源模板（合成）');
  await expect(note).toHaveValue('未提交的本页意见');
  await note.fill('');
});

test('pages the 201-file directory, keeps each draft and asks to recheck after an explicit switch', async ({
  page,
}) => {
  await page.goto(workspace);
  const files = page.locator('.markdown-files');
  await expect(files).toContainText('已加载 40 / 共 201 份');
  await expect(files).toContainText('本轮共 201 份文件');
  await files.getByRole('button', { name: '继续加载文件' }).click();
  await expect(files).toContainText('已加载 80 / 共 201 份');
  await page.getByLabel('文件状态').selectOption('READY');
  await expect(files).toContainText('已加载 2 / 共 2 份');
  await expect(files).toContainText('预防措施程序');
  await expect(files).toContainText('质量手册');
  await page.getByLabel('文件状态').selectOption('APPROVED');
  await expect(files).toContainText('已加载 0 / 共 0 份');
  await expect(files).toContainText('没有符合条件的文件');
  await page.getByLabel('文件状态').selectOption('ALL');
  await page.getByLabel('查找文件').fill('QH-SC-01');
  await expect(files).toContainText('已加载 1 / 共 1 份');
  const note = page.getByRole('textbox', { name: '意见草稿' });
  await note.fill('第 1 份文件的本页草稿');
  await page.getByRole('button', { name: '完整文件' }).click();
  await expect(page.locator('.canonical-document')).toBeVisible();
  await files.getByRole('button', { name: /质量手册/ }).click();
  await expect(page.getByRole('heading', { name: '质量手册（合成）' })).toBeVisible();
  await expect(page.locator('.markdown-reading-scroll .notice')).toContainText(
    '请重新核对引用位置与草稿后再提交',
  );
  await expect(page.getByRole('textbox', { name: '意见草稿' })).toHaveValue('');
  await expect(page.locator('.markdown-files')).toContainText('已切换到「质量手册」');
  // A different file opens on its change details, not on the previous full view.
  await expect(page.getByRole('button', { name: /变化详情/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '变化详情 · 1' }).click();
  // Markdown links and raw HTML stay literal text; nothing becomes executable.
  await expect(page.locator('.markdown-after')).toContainText('https://example.invalid/');
  await expect(page.locator('.markdown-after')).toContainText('<a href="javascript:alert(1)">');
  expect(await page.locator('.markdown-reader a[href]').count()).toBe(0);
  await page.getByLabel('查找文件').fill('');
  await page.locator('.markdown-files button', { hasText: '预防措施程序' }).click();
  await expect(page.getByRole('textbox', { name: '意见草稿' })).toHaveValue(
    '第 1 份文件的本页草稿',
  );
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await page.getByRole('textbox', { name: '意见草稿' }).fill('');
});

test('retains the reading version and draft when a new candidate arrives, then switches explicitly', async ({
  page,
}) => {
  await page.goto(workspace);
  const note = page.getByRole('textbox', { name: '意见草稿' });
  await note.fill('针对第 1 版的引用');
  await page.getByRole('button', { name: '下一处变化' }).click();
  await controls(page);
  await page.getByRole('button', { name: '模拟本文件新候选到达' }).click();
  await expect(page.locator('.markdown-reading-scroll')).toContainText('新候选已到达');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await expect(position(page)).toContainText('当前 2 / 36');
  await expect(note).toHaveValue('针对第 1 版的引用');
  await expect(page).toHaveURL(workspace);
  // An ordinary edit of the viewed version is stale once a newer candidate exists.
  await expect(submit(page)).toBeDisabled();
  await expect(page.locator('.markdown-opinion')).toContainText('已被新候选替代');
  await expect(approve(page)).toBeDisabled();
  // The explicit switch still asks for a recheck, resets to the change-first
  // view and keeps this version's own draft separate.
  await page.getByRole('button', { name: '摘要与依据' }).click();
  await expect(page.getByRole('button', { name: /摘要与依据/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '显式切换并核对引用' }).click();
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 1 处修改');
  await expect(page.locator('.markdown-reading-scroll')).toContainText('请重新核对引用位置与草稿');
  await expect(page.getByRole('button', { name: /变化详情/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.markdown-change')).toBeVisible();
  await expect(note).toHaveValue('');
  await note.fill('针对第 2 版的意见');
  await expect(submit(page)).toBeEnabled();
  await page.getByLabel('查看本文件版本').selectOption('DEMO-WS-REV-01');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await expect(note).toHaveValue('针对第 1 版的引用');
  await note.fill('');
});

test('freezes the submitted input, keeps the next-round draft and reconciles the original request', async ({
  page,
}) => {
  await page.goto(workspace);
  const note = page.getByRole('textbox', { name: '意见草稿' });
  await note.fill('第一条：请核对目的表述。');
  await controls(page);
  await page.getByRole('button', { name: '返回草稿保存回执' }).click();
  await expect(page.locator('.markdown-draft-state')).toContainText('个人草稿已保存');
  await submit(page).click();
  const status = page.locator('.markdown-submission');
  await expect(status).toContainText('提交结果待核验');
  const box = await page.locator('.markdown-opinion').boundingBox();
  const statusBox = await status.boundingBox();
  expect(statusBox?.y).toBeLessThan((box?.y ?? 0) + 200);
  await expect(submit(page)).toBeDisabled();
  await expect(page.locator('.markdown-original')).toContainText('第一条：请核对目的表述。');
  await note.fill('下轮草稿：补充第 3 处。');
  await expect(page.locator('.markdown-original')).toContainText('第一条：请核对目的表述。');
  await expect(page.locator('.markdown-original')).not.toContainText('下轮草稿');
  await expect(page.getByRole('button', { name: '检查完成并批准' })).toBeDisabled();
  await expect(status).toContainText('自动核验已结束', { timeout: 15_000 });
  await expect(status).toContainText('已查询 3 次');
  await page.getByLabel('原提交的查询结果').selectOption('accepted');
  await status.getByRole('button', { name: '重新查询' }).click();
  await expect(status).toContainText('修改请求已接收，等待安排', { timeout: 10_000 });
  await expect(status).toContainText('已查询 4 次');
  await expect(page.locator('.markdown-original')).toContainText('第一条：请核对目的表述。');
  await expect(note).toHaveValue('下轮草稿：补充第 3 处。');
  await expect(submit(page)).toBeDisabled();
  await note.fill('');
});

test('requires an explicitly chosen baseline for a Markdown suggestion and never executes its text', async ({
  page,
}) => {
  await page.goto(workspace);
  const opinion = page.locator('.markdown-opinion');
  await opinion.locator('input[type="file"]').setInputFiles({
    name: '改稿.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 合成改稿\n\n<script>window.__reviewXss = 1</script>\n', 'utf8'),
  });
  await expect(opinion).toContainText('改稿.md');
  await expect(page.getByLabel('改稿基准版本（必须明确选择）')).toBeVisible();
  await expect(opinion).toContainText('提交时最新版本');
  await opinion.locator('details', { hasText: '预览改稿文本' }).locator('summary').click();
  await expect(opinion.locator('pre')).toContainText('<script>window.__reviewXss = 1</script>');
  expect(await page.evaluate(() => Object.hasOwn(window, '__reviewXss'))).toBe(false);
  await expect(submit(page)).toBeDisabled();
  await expect(opinion).toContainText('请先明确选择改稿的基准版本');
  await page.getByLabel('改稿基准版本（必须明确选择）').selectOption('DEMO-WS-REV-01');
  await expect(submit(page)).toBeEnabled();
  await submit(page).click();
  await expect(page.locator('.markdown-original')).toContainText('改稿.md');
  await expect(page.locator('.markdown-original')).toContainText('基准 第 1 版');
  await expect(page.locator('.markdown-submission')).toContainText('未收到本次提交的回执');
  // A newer candidate keeps the submitted snapshot readable and never auto-switches.
  await controls(page);
  await page.getByRole('button', { name: '模拟本文件新候选到达' }).click();
  await expect(page.locator('.markdown-original')).toContainText('改稿.md');
  await expect(page.locator('.markdown-reading-scroll')).toContainText('新候选已到达');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
});

test('advances only after a matching approval receipt and keeps unknown results in place', async ({
  page,
}) => {
  await page.goto(workspace);
  const files = page.locator('.markdown-files');
  await page.getByLabel('查找文件').fill('QP23');
  await files.getByRole('button', { name: /预防措施程序/ }).click();
  await expect(page.getByRole('button', { name: '检查完成并批准' })).toBeEnabled();
  await controls(page);
  await page.getByLabel('单文件批准回执').selectOption('hold');
  await approve(page).click();
  await expect(page.locator('.markdown-opinion')).toContainText('批准结果待核验');
  await expect(page.locator('.markdown-opinion')).toContainText('不会按点击或未知结果切换文件');
  // A second click cannot create another intent while the first is unresolved.
  await expect(approve(page)).toBeDisabled();
  await page.getByLabel('单文件批准回执').selectOption('unknown');
  await page.getByRole('button', { name: '返回批准的选定回执' }).click();
  await expect(page.locator('.markdown-opinion')).toContainText('批准结果待核验');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await expect(page.locator('details.review-controls')).toContainText('已批准 0 份');
  // A matching receipt is the only path that advances to the next file.
  await page.getByLabel('单文件批准回执').selectOption('accepted');
  await page.getByRole('button', { name: '返回批准的选定回执' }).click();
  await expect(page.locator('.markdown-files')).toContainText('匹配批准成功（演示）');
  await expect(page.locator('details.review-controls')).toContainText('已批准 1 份');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 1 处修改');
  await page.getByLabel('查找文件').fill('QP23');
  await expect(page.locator('.markdown-files button', { hasText: '预防措施程序' })).toContainText(
    '已批准',
  );
  await page.getByLabel('查找文件').fill('QH-SC-01');
  await expect(page.locator('.markdown-files button', { hasText: '质量手册' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await page.getByLabel('查找文件').fill('');
  // Directory filter, count and page agree with the effective state after approval.
  await page.getByLabel('文件状态').selectOption('READY');
  await expect(files).toContainText('已加载 1 / 共 1 份');
  await expect(files).toContainText('质量手册');
  await expect(files).not.toContainText('预防措施程序');
  await page.getByLabel('文件状态').selectOption('APPROVED');
  await expect(files).toContainText('已加载 1 / 共 1 份');
  await expect(files.locator('button', { hasText: '预防措施程序' })).toContainText('已批准');
  await page.getByLabel('文件状态').selectOption('ALL');
  await expect(files).toContainText('已加载 40 / 共 201 份');
});

test('keeps the download state separate from reading and reports unavailable representations', async ({
  page,
}) => {
  await page.goto(workspace);
  await expect(page.getByRole('button', { name: '下载 Markdown' })).toBeEnabled();
  await page.getByRole('button', { name: '下载 Markdown' }).click();
  await expect(page.locator('.markdown-download-status')).toContainText('下载响应已完整接收');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await controls(page);
  await page.getByLabel('下载状态').selectOption('UNAVAILABLE');
  await expect(page.getByRole('button', { name: '下载 Markdown' })).toBeDisabled();
  await expect(page.locator('.markdown-download')).toContainText('未提供已登记表示');
  await expect(page.locator('.markdown-change-toolbar')).toContainText('本文件共 36 处修改');
  await expect(page.getByRole('button', { name: '检查完成并批准' })).toBeEnabled();
});

test('switches reader and opinion panes on narrow viewports with the same exact context', async ({
  page,
}) => {
  await page.goto(workspace);
  // The workspace starts below this page's own heading and still ends inside the
  // approved desktop viewports: no part of the columns is pushed off screen.
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const box = requiredValue(await page.locator('.markdown-review').boundingBox());
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1),
    ).toBe(true);
    for (const column of ['.markdown-file-list', '.markdown-reading-scroll', '.markdown-opinion']) {
      expect(
        await page.locator(column).evaluate((element) => getComputedStyle(element).overflowY),
      ).toBe('auto');
    }
    expect(
      await page
        .locator('.markdown-file-list')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
  }
  for (const [width, height] of [
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(approve(page)).toBeEnabled();
  await page.getByRole('button', { name: '下一处变化' }).click();
  await page.getByRole('button', { name: '对此处提意见' }).click();
  const note = page.getByRole('textbox', { name: '意见草稿' });
  await expect(note).toBeFocused();
  await expect(note).toHaveValue(/第 2 \/ 36 处 · 1 目的与适用范围 \/ 适用范围/u);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '查看文档' })).toBeVisible();
  await expect(page.getByRole('button', { name: '意见与处理' })).toBeVisible();
  await expect(note).toBeVisible();
  await page.getByRole('button', { name: '查看文档' }).click();
  await expect(page.locator('.markdown-reader')).toBeVisible();
  await expect(page.locator('.markdown-opinion')).toBeHidden();
  await expect(page.getByRole('button', { name: '下一处变化' })).toBeVisible();
  await page.getByRole('button', { name: '下一处变化' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.markdown-change-current small')).toContainText('当前 3 / 36');
  await expect(page.locator('.markdown-change h2')).toBeFocused();
  await page.getByRole('button', { name: '意见与处理' }).click();
  await expect(page.getByRole('textbox', { name: '意见草稿' })).toHaveValue(/第 2 \/ 36 处/u);
  // Desktop approval restrictions stay in force on the narrow layout.
  await page.getByRole('textbox', { name: '意见草稿' }).fill('');
  await expect(approve(page)).toBeDisabled();
  await expect(page.locator('.markdown-opinion')).toContainText('窄屏只支持查看与意见');
});

test('shows supplied draft save states truthfully and never loses the input', async ({ page }) => {
  await page.goto(workspace);
  const note = page.getByRole('textbox', { name: '意见草稿' });
  await note.fill('保存状态示例意见');
  await expect(page.locator('.markdown-draft-state')).toContainText('正在保存个人草稿');
  const panel = await controls(page);
  for (const [value, expected] of [
    ['UNSAVED', '保存失败'],
    ['CONFLICT', '另一设备也保存了此草稿'],
    ['UNKNOWN', '保存结果待核验'],
    ['UNAVAILABLE', '服务器草稿能力尚未接入'],
    ['SAVED', '个人草稿已保存'],
  ] as const) {
    await panel.getByLabel('个人草稿保存回执').selectOption(value);
    await note.fill(`保存状态示例意见 · ${value}`);
    await panel.getByRole('button', { name: '返回草稿保存回执' }).click();
    await expect(page.locator('.markdown-draft-state')).toContainText(expected);
    await expect(note).toHaveValue(`保存状态示例意见 · ${value}`);
  }
  // An unsent draft holds approval and states why.
  await expect(approve(page)).toBeDisabled();
  await expect(page.locator('.markdown-opinion')).toContainText('还有未提交的意见或改稿');
  await note.fill('');
});

test('keeps the reader visible, scrollable, navigable and quotable on narrow viewports', async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 800],
    [320, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(workspace);
    const reader = page.locator('.markdown-reader');
    // The reader keeps real height instead of being clipped by a bounded parent,
    // and the page can scroll the whole workspace into reach.
    expect(await reader.evaluate((element) => element.clientHeight)).toBeGreaterThan(160);
    expect(
      await page
        .locator('.markdown-reading-scroll')
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    ).toBe(true);
    const toolbar = page.locator('.markdown-change-toolbar');
    await toolbar.scrollIntoViewIfNeeded();
    await expect(toolbar).toBeInViewport();
    await expect(page.locator('.markdown-change')).toBeInViewport();
    // Navigation operates inside the visible reader.
    await page.getByRole('button', { name: '下一处变化' }).click();
    await expect(position(page)).toContainText('当前 2 / 36');
    // Quoting a change opens the same opinion view with the exact version reference.
    await page.getByRole('button', { name: '对此处提意见' }).click();
    const note = page.getByRole('textbox', { name: '意见草稿' });
    await expect(note).toBeVisible();
    await expect(note).toHaveValue(/第 2 \/ 36 处 · 1 目的与适用范围 \/ 适用范围/u);
    // Switching panes preserves the input and the document view keeps working.
    await page.getByRole('button', { name: '查看文档' }).click();
    await page.locator('.markdown-change-toolbar').scrollIntoViewIfNeeded();
    await expect(page.locator('.markdown-change')).toBeInViewport();
    await expect(note).toBeHidden();
    await page.getByRole('button', { name: '意见与处理' }).click();
    await expect(note).toHaveValue(/第 2 \/ 36 处 · 1 目的与适用范围 \/ 适用范围/u);
    await note.fill('');
  }
});

test('production build excludes the review workspace fixture and cannot fall back to it', async ({
  page,
}) => {
  for (const asset of await readdir('apps/workspace-web/dist/assets')) {
    if (!asset.endsWith('.js')) continue;
    const bytes = await readFile(`apps/workspace-web/dist/assets/${asset}`, 'utf8');
    expect(bytes).not.toContain('REVIEW_DEVELOPMENT_WORKSPACE_ONLY');
    expect(bytes).not.toContain('模拟本文件新候选到达');
    expect(bytes).not.toContain('合成长清单文件');
    expect(bytes).not.toContain('多处修改示例');
  }
  await page.goto(workspace);
  await expect(page.getByRole('alert')).toContainText('登录与公开业务服务尚未接入');
  await expect(page.locator('.review-controls')).toHaveCount(0);
  await expect(page.locator('.markdown-review')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /提交并修改/ })).toHaveCount(0);
});
