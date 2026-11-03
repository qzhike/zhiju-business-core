import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { runnerFlowFixture } from './runner-flow-fixture.js';

async function add(page: Page, directory: string, conflict = false) {
  await page.getByLabel('选择一个 handoff 目录').setInputFiles(directory);
  await expect(page.getByRole('region', { name: '交接包状态' })).toBeVisible();
  await page.getByRole('button', { name: '加入项目并查看当前工作' }).click();
  if (!conflict)
    await expect(
      page.getByRole('heading', { name: '体系文件修订与审阅', exact: true }),
    ).toBeVisible();
}
async function expandQuestion(page: Page) {
  const trigger = page
    .getByRole('region', { name: '本轮问题与答复', exact: true })
    .getByRole('button', { name: /已缩小范围的请求/ });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) === 'false') await trigger.click();
}
async function prepareMore(page: Page) {
  await page.getByRole('button', { name: 'Mock 控制', exact: true }).click();
  await page.getByRole('link', { name: '准备其他轮次的结果' }).click();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function equalPanes(page: Page, width: number) {
  const left = await page.getByRole('complementary', { name: '项目文档' }).boundingBox();
  const right = await page.locator('.runner-flow-card').boundingBox();
  expect(left).toBeTruthy();
  expect(right).toBeTruthy();
  if (!left || !right) throw new Error('Missing panes');
  if (width >= 1280) expect(Math.abs(left.width - right.width)).toBeLessThan(2);
  else expect(right.y).toBeGreaterThanOrEqual(left.y + left.height);
  await noOverflow(page);
}

for (const width of [1440, 320]) {
  test(`Runner long summary expands and collapses with formatted content at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/runner-output');
    const summary = `开头 **重点建议**\n第二行 ${'请核对职责与适用范围。'.repeat(40)}\n\n- 最后一项完整建议\n- [建议参考](https://example.com/reference)`;
    await add(page, await runnerFlowFixture(info.outputPath('long-summary'), { summary }));
    const result = page.getByRole('region', { name: '本轮结果', exact: true });
    const reading = result.locator('.artifact-summary');
    const expand = result.getByRole('button', { name: '展开全部建议', exact: true });
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expect(reading).toContainText('开头');
    await expect(reading.locator('strong')).toHaveText('重点建议');
    await expect(reading).not.toContainText('最后一项完整建议');
    await expect(reading.getByRole('link')).toHaveCount(0);
    const previewHeight = await reading.evaluate((node) => node.getBoundingClientRect().height);
    expect(previewHeight).toBeLessThan(width === 320 ? 450 : 250);
    await expand.focus();
    const previewTop = await reading.evaluate((node) => node.getBoundingClientRect().top);
    await page.keyboard.press('Enter');
    const collapse = result.getByRole('button', { name: '收起', exact: true });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(collapse).toBeFocused();
    expect(
      Math.abs((await reading.evaluate((node) => node.getBoundingClientRect().top)) - previewTop),
    ).toBeLessThan(2);
    await expect(reading).toContainText('最后一项完整建议');
    await expect(reading.getByRole('link', { name: '建议参考' })).toBeVisible();
    await expect(reading.locator('li')).toHaveCount(2);
    expect(await reading.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(
      previewHeight,
    );
    await collapse.click();
    await expect(expand).toBeFocused();
    await expect(expand).toBeInViewport();
    await expect(reading.getByRole('link')).toHaveCount(0);
    await noOverflow(page);
    expect(
      (await new AxeBuilder({ page }).include('.runner-flow-card').analyze()).violations,
    ).toEqual([]);
    await page.getByRole('link', { name: '历史记录', exact: true }).click();
    await page.getByRole('link', { name: '质量手册 · 第 2 轮', exact: true }).click();
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.click();
    await expect(reading).toContainText('最后一项完整建议');
    await prepareMore(page);
    await add(
      page,
      await runnerFlowFixture(info.outputPath('short-summary'), {
        round: 3,
        summary: '简短 **结果**',
      }),
    );
    await expect(page.getByRole('button', { name: '查看当前轮次', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看当前轮次', exact: true }).click();
    await expect(reading).toHaveText('简短 结果');
    await expect(result.getByRole('button', { name: '展开全部建议', exact: true })).toHaveCount(0);
    await noOverflow(page);
  });

  test(`Runner summary breaks and per-entry confirmation controls stay local at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/runner-output');
    const summary = '## 本轮报告\n\n第一行 **重点**\n第二行 `依据`\n\n下一段\n\n- 第一项\n- 第二项';
    await add(page, await runnerFlowFixture(info.outputPath('handoff'), { summary }));
    const result = page.getByRole('region', { name: '本轮结果', exact: true });
    await expect(result.locator('.artifact-prose br')).toHaveCount(1);
    await expect(result.locator('strong')).toContainText('重点');
    await expect(result.locator('code')).toContainText('依据');
    await expect(result.locator('li')).toHaveCount(2);
    await expect(result.getByRole('button', { name: '展开全部建议', exact: true })).toHaveCount(0);
    await expandQuestion(page);
    const answer = page.getByLabel('答复草稿：已缩小范围的请求');
    const answerActions = page.getByRole('group', { name: '答复操作', exact: true });
    await expect(answerActions.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
    await answer.fill('  ');
    await expect(answerActions.getByRole('button', { name: '提交', exact: true })).toBeDisabled();
    await answer.fill('需要核对责任人');
    await answerActions.getByRole('button', { name: '提交', exact: true }).click();
    await expect(answer).toHaveAttribute('readonly', '');
    await expect(answer).toBeFocused();
    await expect(page.locator('.runner-issue-draft')).toHaveText('已确认（本地）');
    await expect(page.getByRole('region', { name: '本轮问题与答复', exact: true })).toContainText(
      '尚未发送给 Runner',
    );
    await answerActions.getByRole('button', { name: '修改', exact: true }).click();
    await expect(answer).not.toHaveAttribute('readonly', '');
    await expect(answer).toBeFocused();
    await answer.fill('已核对责任人');
    await answerActions.getByRole('button', { name: '提交', exact: true }).click();
    await page.getByRole('link', { name: '审阅本轮文件' }).click();
    await page.getByRole('button', { name: '打开本文件意见' }).click();
    const opinion = page.getByLabel('意见草稿', { exact: true });
    const opinionActions = page.getByRole('group', { name: '意见操作', exact: true });
    await opinion.fill('请调整文件职责');
    await opinionActions.getByRole('button', { name: '提交', exact: true }).click();
    await expect(opinion).toHaveAttribute('readonly', '');
    await opinionActions.getByRole('button', { name: '修改', exact: true }).click();
    await opinion.fill('请再次核对职责');
    await opinionActions.getByRole('button', { name: '提交', exact: true }).click();
    await page.getByRole('button', { name: '核对本轮意见与答复（2）' }).click();
    const dialog = page.getByRole('dialog', { name: '核对本轮意见与答复' });
    await expect(
      dialog.getByText('本次会话已确认 · 尚未发送给 Runner', { exact: true }),
    ).toHaveCount(2);
    await dialog.getByRole('button', { name: '返回编辑' }).click();
    await opinionActions.getByRole('button', { name: '清除', exact: true }).click();
    await expect(opinion).toHaveValue('');
    await expect(opinion).not.toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: '核对本轮意见与答复（1）' })).toBeEnabled();
    await opinion.fill('保留文件意见');
    await opinionActions.getByRole('button', { name: '提交', exact: true }).click();
    expect(
      (await new AxeBuilder({ page }).include('.review-opinion-panel').analyze()).violations,
    ).toEqual([]);
    await page
      .getByRole('complementary', { name: '本文件意见与处理' })
      .getByRole('button', { name: '收起本文件意见' })
      .click();
    await page.getByRole('link', { name: '← 返回当前工作' }).click();
    await expandQuestion(page);
    await expect(answer).toHaveValue('已核对责任人');
    await expect(answer).toHaveAttribute('readonly', '');
    await answerActions.getByRole('button', { name: '清除', exact: true }).click();
    await expect(answer).toHaveValue('');
    await expect(answer).not.toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: '核对本轮意见与答复（1）' })).toBeEnabled();
    await page.getByRole('link', { name: '历史记录', exact: true }).click();
    await page.getByRole('link', { name: '质量手册 · 第 2 轮', exact: true }).click();
    await page.getByRole('link', { name: '审阅本轮文件' }).click();
    await page.getByRole('button', { name: '打开本文件意见' }).click();
    await expect(opinion).toHaveValue('保留文件意见');
    await expect(opinion).toHaveAttribute('readonly', '');
    await expect(opinionActions).toHaveCount(0);
    await noOverflow(page);
  });
}

for (const width of [1440, 320]) {
  test(`Runner questions stay compact with single-item editing and draft filters at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/runner-output');
    await add(page, await runnerFlowFixture(info.outputPath('handoff'), { issues: 13 }));
    const questions = page.getByRole('region', { name: '本轮问题与答复', exact: true });
    await expect(questions.locator('.runner-issue')).toHaveCount(13);
    await expect(questions.getByRole('textbox')).toHaveCount(0);
    await expect(questions.getByRole('button', { name: '全部（13）', exact: true })).toBeVisible();
    await expect(questions.getByRole('button', { name: '待处理（8）', exact: true })).toBeVisible();
    await expect(questions.getByRole('button', { name: '有草稿（0）', exact: true })).toBeVisible();
    const height = await questions.evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeLessThan(width === 320 ? 1700 : 1200);
    await noOverflow(page);
    const second = questions.getByRole('button', { name: /2\. 待核对事项 2 / });
    await second.focus();
    await page.keyboard.press('Enter');
    await expect(second).toHaveAttribute('aria-expanded', 'true');
    await expect(questions.getByRole('heading', { name: '核对事项 2', exact: true })).toBeVisible();
    const answer = questions.getByLabel('答复草稿：待核对事项 2');
    await answer.fill('第二项答复草稿');
    await questions.getByRole('button', { name: /3\. 待核对事项 3 / }).click();
    await expect(second).toHaveAttribute('aria-expanded', 'false');
    await expect(questions.getByRole('textbox')).toHaveCount(1);
    await questions.getByLabel('答复草稿：待核对事项 3').fill('第三项答复草稿');
    await questions.getByRole('button', { name: '有草稿（2）', exact: true }).click();
    await expect(questions.locator('.runner-issue')).toHaveCount(2);
    await second.click();
    await expect(answer).toHaveValue('第二项答复草稿');
    await answer.fill('');
    await expect(answer).toBeFocused();
    await expect(questions.getByRole('button', { name: '有草稿（1）', exact: true })).toBeVisible();
    await second.click();
    await expect(questions.locator('.runner-issue')).toHaveCount(1);
    await expect(questions.getByRole('button', { name: '有草稿（1）', exact: true })).toBeFocused();
    await questions.getByRole('button', { name: '待处理（8）', exact: true }).click();
    await expect(questions.locator('.runner-issue')).toHaveCount(8);
    await questions.getByRole('button', { name: '全部（13）', exact: true }).click();
    await questions.getByRole('button', { name: /9\. 待核对事项 9 / }).click();
    await expect(questions.getByRole('textbox')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).include('.runner-issues').analyze()).violations).toEqual(
      [],
    );
    await page.getByRole('link', { name: '历史记录', exact: true }).click();
    await page.getByRole('link', { name: '质量手册 · 第 2 轮', exact: true }).click();
    await questions.getByRole('button', { name: '有草稿（1）', exact: true }).click();
    await questions.getByRole('button', { name: /3\. 待核对事项 3 / }).click();
    await expect(questions.getByLabel('答复草稿：待核对事项 3')).toHaveValue('第三项答复草稿');
    await expect(questions.getByLabel('答复草稿：待核对事项 3')).toHaveAttribute('readonly', '');
    await noOverflow(page);
  });
}

for (const width of [1440, 1280, 320]) {
  test(`Runner project workflow shares drafts, full-width file review and equal history panes at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/runner-output');
    await add(page, await runnerFlowFixture(info.outputPath('handoff')));
    await expect(page).toHaveURL(/\/projects\/RUNNER-[a-f0-9]+\/work$/);
    await equalPanes(page, width);
    await expect(page.getByRole('complementary', { name: '项目文档' })).toContainText(
      '1 - 质量手册',
    );
    await expandQuestion(page);
    await expect(page.getByRole('region', { name: '本轮问题与答复' })).toContainText(
      '仅确认当前责任人。',
    );
    await expandQuestion(page);
    await page.getByLabel('答复草稿：已缩小范围的请求').fill('由质量负责人确认。');
    await page.getByRole('link', { name: '审阅本轮文件' }).click();
    await expect(page.getByRole('complementary', { name: '项目文档' })).toHaveCount(0);
    await expect(page.getByRole('table', { name: '原始 Markdown 修订对照' })).toContainText(
      'Original procedure.',
    );
    await page.getByRole('button', { name: '本轮变化（前稿）' }).click();
    await expect(page.getByRole('table', { name: '原始 Markdown 修订对照' })).toContainText(
      'Procedure revision one.',
    );
    await page.getByRole('button', { name: '完整文件', exact: true }).click();
    await expect(page.getByRole('region', { name: '正文表格' })).toContainText('Responsibilities');
    await page.getByRole('button', { name: '打开本文件意见' }).click();
    await page.getByLabel('意见草稿', { exact: true }).fill('请确认修订后的职责。');
    await page.getByRole('button', { name: '核对本轮意见与答复（2）' }).click();
    const summary = page.getByRole('dialog', { name: '核对本轮意见与答复' });
    await expect(summary).toContainText('由质量负责人确认。');
    await expect(summary).toContainText('请确认修订后的职责。');
    await expect(summary.getByRole('button', { name: '提交并继续修订' })).toBeDisabled();
    expect(
      (await new AxeBuilder({ page }).include('.runner-draft-dialog').analyze()).violations,
    ).toEqual([]);
    await summary.getByRole('button', { name: '返回编辑' }).click();
    await page
      .getByRole('complementary', { name: '本文件意见与处理' })
      .getByRole('button', { name: '收起本文件意见' })
      .click();
    await expect(page.getByRole('button', { name: '打开本文件意见' })).toBeFocused();
    await noOverflow(page);
    await page.getByRole('link', { name: '← 返回当前工作' }).click();
    await expandQuestion(page);
    await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveValue('由质量负责人确认。');
    await page.getByRole('link', { name: '历史记录', exact: true }).click();
    await equalPanes(page, width);
    await expect(page.getByRole('list', { name: '业务阶段进度' })).toBeVisible();
    await page.getByRole('link', { name: '质量手册 · 第 2 轮', exact: true }).click();
    await expandQuestion(page);
    await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveAttribute('readonly', '');
    await page.getByRole('link', { name: '审阅本轮文件' }).click();
    await page.getByRole('button', { name: '打开本文件意见' }).click();
    await expect(page.getByLabel('意见草稿', { exact: true })).toHaveValue('请确认修订后的职责。');
    await expect(page.getByLabel('意见草稿', { exact: true })).toHaveAttribute('readonly', '');
    await noOverflow(page);
  });
}

test('Runner multi-round integration deduplicates, rejects conflicts and keeps old drafts pinned', async ({
  page,
}, info) => {
  await page.goto('/runner-output');
  const first = await runnerFlowFixture(info.outputPath('first/handoff'), {
    round: 1,
    blocked: true,
  });
  await add(page, first);
  const firstWork = page.url();
  await expect(page.getByRole('region', { name: '当前任务' })).toContainText('0 份候选稿');
  await expandQuestion(page);
  await page.getByLabel('答复草稿：已缩小范围的请求').fill('旧轮次答复');
  await page.getByRole('link', { name: '查看已有底稿' }).click();
  const firstFile = page.url();
  await expect(page.getByRole('button', { name: '修订对照', exact: true })).toHaveCount(0);
  await expect(page.locator('.runner-reading-body')).toContainText('Procedure revision one.');
  await page.getByRole('button', { name: '打开本文件意见' }).click();
  await page.getByLabel('意见草稿', { exact: true }).fill('旧底稿意见');
  await page
    .getByRole('complementary', { name: '本文件意见与处理' })
    .getByRole('button', { name: '收起本文件意见' })
    .click();
  await prepareMore(page);
  await add(page, await runnerFlowFixture(info.outputPath('next/handoff'), { round: 2 }));
  expect(page.url()).toBe(firstWork);
  await expect(page.getByRole('region', { name: '当前任务' })).toContainText('第 1 轮');
  await expandQuestion(page);
  await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveValue('旧轮次答复');
  await expandQuestion(page);
  await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: '查看当前轮次', exact: true }).click();
  await expect(page.getByRole('region', { name: '当前任务' })).toContainText('第 2 轮');
  await expandQuestion(page);
  await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveValue('');
  await expandQuestion(page);
  await page.getByLabel('答复草稿：已缩小范围的请求').fill('新轮次答复');
  await prepareMore(page);
  await add(page, first);
  await expect(page.getByText('本地结果 · 2 个已接入轮次', { exact: true })).toBeVisible();
  await prepareMore(page);
  await add(
    page,
    await runnerFlowFixture(info.outputPath('conflict/handoff'), { round: 2, conflict: true }),
    true,
  );
  await expect(page.locator('.runner-preview [role="alert"]')).toContainText(
    '同一轮次对应了不同交接包',
  );
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await expect(page.getByRole('note')).toContainText('工作台包含合成样例与已导入结果');
  const projectCard = page.locator('.wb-project-card').filter({
    has: page.getByRole('heading', { name: '体系文件修订与审阅 · 本地结果', exact: true }),
  });
  await expect(projectCard.getByRole('link', { name: '准备项目交付', exact: true })).toHaveCount(0);
  await projectCard.getByRole('button', { name: '查看该项目看板', exact: true }).click();
  await expect(page.getByRole('link', { name: '提交客户资料', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '查看当前工作', exact: true }).click();
  await expandQuestion(page);
  await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveValue('新轮次答复');
  await page.getByRole('link', { name: '我的工作台', exact: true }).click();
  await page
    .getByRole('article', { name: '体系文件修订与审阅 · 当前工作', exact: true })
    .getByRole('link', { name: '进入当前工作', exact: true })
    .click();
  await expandQuestion(page);
  await expect(page.getByLabel('答复草稿：已缩小范围的请求')).toHaveValue('新轮次答复');
  await page.getByRole('link', { name: '历史记录', exact: true }).click();
  await expect(page.getByRole('region', { name: '轮次列表' }).locator('tbody tr')).toHaveCount(2);
  await page.getByRole('link', { name: '质量手册 · 第 1 轮', exact: true }).click();
  await page.getByRole('link', { name: '查看已有底稿' }).click();
  expect(page.url().split('?')[0]).toBe(firstFile.split('?')[0]);
  await page.getByRole('button', { name: '打开本文件意见' }).click();
  await expect(page.getByLabel('意见草稿', { exact: true })).toHaveValue('旧底稿意见');
  await expect(page.getByLabel('意见草稿', { exact: true })).toHaveAttribute('readonly', '');
});

test('Runner project clearing and refresh show an explicit missing session without mock fallback', async ({
  page,
}, info) => {
  await page.goto('/runner-output');
  const fixture = await runnerFlowFixture(info.outputPath('handoff'));
  await add(page, fixture);
  await page.getByRole('button', { name: 'Mock 控制', exact: true }).click();
  await page.getByRole('button', { name: '移除本地项目及草稿', exact: true }).click();
  await page.getByRole('button', { name: '确认移除本地项目', exact: true }).click();
  await expect(page).toHaveURL(/\/workbench$/);
  await expect(
    page.getByRole('article', { name: '体系文件修订与审阅 · 当前工作', exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('heading', { name: '本地结果会话不可用' })).toBeVisible();
  await page.getByRole('link', { name: '重新载入本地结果' }).click();
  await add(page, fixture);
  await page.reload();
  await expect(page.getByRole('heading', { name: '本地结果会话不可用' })).toBeVisible();
});

test('Runner reading keeps a paragraph anchored across desktop opinion reflow and drawer resizing', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/runner-output');
  await add(page, await runnerFlowFixture(info.outputPath('handoff'), { long: true }));
  await page.getByRole('link', { name: '审阅本轮文件' }).click();
  await page.getByRole('button', { name: '完整文件', exact: true }).click();
  const paragraph = page.locator('.runner-reading-body [data-reading-anchor$=":reading-35"]');
  await paragraph.evaluate((node) => {
    node.scrollIntoView();
    const toolbar = document.querySelector('.markdown-change-toolbar');
    window.scrollBy(0, -(toolbar?.getBoundingClientRect().height ?? 0) - 2);
  });
  await expect
    .poll(() =>
      paragraph.evaluate((node) =>
        Math.abs(
          node.getBoundingClientRect().top -
            (document.querySelector('.markdown-change-toolbar')?.getBoundingClientRect().bottom ??
              0) -
            2,
        ),
      ),
    )
    .toBeLessThan(2);
  const top = await paragraph.evaluate((node) => node.getBoundingClientRect().top);
  await page.getByRole('button', { name: '打开本文件意见' }).click();
  await expect(page.locator('.runner-flow-file')).toHaveAttribute('data-opinion-layout', 'side');
  await expect(page.getByLabel('意见草稿', { exact: true })).toBeFocused();
  await expect
    .poll(() => paragraph.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(top, 0);
  await page.getByLabel('意见草稿', { exact: true }).fill('保持当前阅读');
  await page
    .getByRole('complementary', { name: '本文件意见与处理' })
    .getByRole('button', { name: '收起本文件意见' })
    .click();
  await expect
    .poll(() => paragraph.evaluate((node) => node.getBoundingClientRect().top))
    .toBeCloseTo(top, 0);
  await page.getByRole('button', { name: '打开本文件意见' }).click();
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(page.getByRole('dialog', { name: '本文件意见', exact: true })).toBeVisible();
  await expect(page.getByLabel('意见草稿', { exact: true })).toHaveValue('保持当前阅读');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '打开本文件意见' })).toBeFocused();
  await expect
    .poll(() =>
      paragraph.evaluate(
        (node, position) => Math.abs(node.getBoundingClientRect().top - position),
        top,
      ),
    )
    .toBeLessThan(5);
  await noOverflow(page);
});
