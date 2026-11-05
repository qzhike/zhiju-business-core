import { createHash } from 'node:crypto';
import { cp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

const fixture = resolve('tests/fixtures/runner-display/handoff');
const reportPath = 'snapshot/output/round-2/revision-round.json';
const candidatePath = 'snapshot/output/round-2/manual.md';
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = Record<string, Json>;
const object = (value: Json | undefined) => value as JsonObject;
const first = (value: Json | undefined) => object((value as Json[])[0]);
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function variant(directory: string, kind: 'blocked' | 'active' | 'broken' | 'wide') {
  await cp(fixture, directory, { recursive: true });
  const readJson = async (name: string) =>
    JSON.parse(await readFile(join(directory, name), 'utf8')) as JsonObject;
  const putJson = async (name: string, data: JsonObject) =>
    writeFile(join(directory, name), JSON.stringify(data));
  const report = await readJson(reportPath);
  const review = await readJson('review-data.json');
  if (kind === 'blocked') {
    report.status = review.status = 'WAITING_INPUT';
    report.changes = review.changes = [];
    first(report.files).candidate = null;
    first(report.files).state = first(review.files).state = 'BLOCKED';
    first(report.files).contentCompleteness = first(review.files).contentCompleteness = 'PARTIAL';
    first(review.files).after = first(review.files).before ?? null;
  }
  if (kind === 'active' || kind === 'wide') {
    await writeFile(
      join(directory, candidatePath),
      [
        '# Inert source',
        '<script>window.artifactExecuted=true</script>',
        '<style>@import "/artifact-resource/style";</style>',
        '<iframe src="/artifact-resource/frame"></iframe><object data="/artifact-resource/object"></object>',
        '<img src="/artifact-resource/image" onerror="window.artifactExecuted=true" alt="Local diagram">',
        '<table background="/artifact-resource/background"><tr><td onclick="window.artifactExecuted=true">Readable cell</td></tr></table>',
        '<a href="javascript:window.artifactExecuted=true">Untrusted link</a>',
      ].join('\n\n'),
    );
    if (kind === 'wide')
      await writeFile(
        join(directory, candidatePath),
        '<table><tr>' +
          Array.from({ length: 14 }, (_, index) => `<td>Column ${index}</td>`).join('') +
          '</tr></table>',
      );
    const digest = sha(await readFile(join(directory, candidatePath)));
    object(first(report.files).candidate).sha256 = digest;
    object(first(review.files).after).sha256 = digest;
  }
  await putJson(reportPath, report);
  const annotations = await readJson('annotations.json');
  annotations.reportSha256 = sha(await readFile(join(directory, reportPath)));
  await putJson('annotations.json', annotations);
  object(review.report).sha256 = sha(await readFile(join(directory, reportPath)));
  await putJson('review-data.json', review);
  const manifest = await readJson('handoff.json');
  const entries: Json[] = [];
  async function visit(relative: string) {
    for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (name !== 'handoff.json') {
        const bytes = await readFile(join(directory, name));
        entries.push({ relativePath: name, bytes: bytes.byteLength, sha256: sha(bytes) });
      }
    }
  }
  await visit('');
  manifest.entries = entries;
  object(manifest.report).sha256 = sha(await readFile(join(directory, reportPath)));
  object(manifest.review).sha256 = sha(await readFile(join(directory, 'review-data.json')));
  object(manifest.annotations).sha256 = sha(await readFile(join(directory, 'annotations.json')));
  await putJson('handoff.json', manifest);
  if (kind === 'broken') await writeFile(join(directory, candidatePath), 'Tampered');
  return directory;
}

async function choose(page: Page, directory = fixture) {
  await page.getByLabel('选择一个 handoff 目录').setInputFiles(directory);
  await expect(page.getByRole('region', { name: '交接包状态' })).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('production excludes the local Runner reader', async ({ page, request }) => {
  const response = await request.get('/runner-output', { headers: { Accept: 'text/html' } });
  expect(response.status()).toBe(404);
  await page.goto('/workbench');
  await expect(page.getByRole('link', { name: 'Runner 产物核对（本地只读）' })).toHaveCount(0);
  for (const asset of await readdir('apps/workspace-web/dist/assets')) {
    if (!asset.endsWith('.js')) continue;
    const source = await readFile(join('apps/workspace-web/dist/assets', asset), 'utf8');
    for (const marker of [
      'Runner 产物核对',
      '选择一个 handoff 目录',
      '交接包清单长度不一致',
      '原始 Markdown 物理行对照',
      '本地结果会话不可用',
      '同一轮次对应了不同交接包',
      '加入项目并查看当前工作',
    ]) {
      expect(source).not.toContain(marker);
    }
  }
});

for (const width of [1440, 1280, 320]) {
  test(`Runner reader preserves tables, raw source and both comparison baselines at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/runner-output');
    await choose(page);
    await expect(page.locator('.runner-status')).toContainText('1 份候选稿');
    const table = page.getByRole('region', { name: '正文表格' });
    await expect(table).toContainText('Responsibilities');
    await expect(table.locator('th[rowspan="2"]')).toHaveText('Role');
    await expect(table.locator('th[colspan="2"]')).toHaveText('Review');
    await table.focus();
    await expect(table).toBeFocused();
    await noOverflow(page);
    await page.getByRole('button', { name: '原始 Markdown', exact: true }).click();
    expect(await page.getByLabel('原始 Markdown 正文').textContent()).toBe(
      await readFile(join(fixture, candidatePath), 'utf8'),
    );
    await noOverflow(page);
    await page.getByRole('button', { name: '修订对照', exact: true }).click();
    const diff = page.getByRole('table', { name: '原始 Markdown 修订对照' });
    await expect(diff).toContainText('Original procedure.');
    await expect(diff).toContainText('Procedure revision two.');
    await expect(diff).not.toContainText('Procedure revision one.');
    await expect(diff).toContainText('⟪CRLF⟫');
    await expect(diff).toContainText('⟪末尾无换行⟫');
    await page.getByRole('button', { name: '本轮变化（前稿）' }).click();
    await expect(diff).toContainText('Procedure revision one.');
    await expect(diff).not.toContainText('Original procedure.');
    await expect(diff.locator('[data-before-line="4"][data-kind="removed"]')).toContainText(
      'Procedure revision one.',
    );
    await expect(diff.locator('[data-after-line="4"][data-kind="added"]')).toContainText(
      'Procedure revision two.',
    );
    await noOverflow(page);
    await page.getByText('已缩小范围的请求 · 待处理 · 非阻断', { exact: true }).click();
    await expect(page.getByRole('region', { name: '本轮问题' })).toContainText(
      '仅确认当前责任人。',
    );
    const accessibility = await new AxeBuilder({ page }).include('.runner-preview').analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

test('Runner import stays local, renders active content inert and clears failed or removed reading', async ({
  page,
}, testInfo) => {
  await page.goto('/workbench');
  await page.getByRole('button', { name: 'Mock 控制', exact: true }).click();
  await page.getByRole('link', { name: 'Runner 产物核对（本地只读）' }).click();
  await expect(page.getByRole('heading', { name: 'Runner 产物核对', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await choose(page, await variant(testInfo.outputPath('active/handoff'), 'active'));
  await expect(page.getByRole('cell', { name: 'Readable cell' })).toBeVisible();
  await expect(page.locator('.artifact-prose')).toContainText(['Inert source']);
  await page.getByRole('cell', { name: 'Readable cell' }).click();
  await page.getByText('Untrusted link', { exact: true }).click();
  expect(await page.evaluate(() => 'artifactExecuted' in window)).toBe(false);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  const broken = await variant(testInfo.outputPath('broken/handoff'), 'broken');
  await page.getByLabel('选择一个 handoff 目录').setInputFiles(broken);
  await expect(page.locator('.runner-preview [role="alert"]')).toBeVisible();
  await expect(page.getByRole('region', { name: '交接包状态' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Readable cell' })).toHaveCount(0);
  await choose(page, await variant(testInfo.outputPath('blocked/handoff'), 'blocked'));
  await expect(page.locator('.runner-status')).toContainText('等待输入 · 1 份文件 · 0 份候选稿');
  await expect(page.getByRole('region', { name: '文件阅读' })).toContainText(
    '受阻 · 内容部分完整 · 尚无新稿',
  );
  await expect(page.getByRole('button', { name: '修订对照', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '文件阅读' })).toContainText(
    'Procedure revision one.',
  );
  await page.getByRole('button', { name: '清除本地阅读' }).click();
  await expect(page.getByRole('region', { name: '交接包状态' })).toHaveCount(0);
  await choose(page);
  await page.reload();
  await expect(page.getByRole('region', { name: '交接包状态' })).toHaveCount(0);
});

test('Runner reader ignores a late successful read after a newer selection fails or clears', async ({
  page,
}, testInfo) => {
  await page.goto('/runner-output');
  await page.evaluate(() => {
    const original = (file: File) => Blob.prototype.arrayBuffer.call(file);
    let delayed = false;
    File.prototype.arrayBuffer = async function () {
      if (!delayed) {
        delayed = true;
        await new Promise<void>((resolve) => {
          Object.assign(window, { releaseArtifactRead: resolve });
        });
      }
      return original(this);
    };
  });
  await page.getByLabel('选择一个 handoff 目录').setInputFiles(fixture);
  await expect(page.getByRole('status')).toContainText('正在核对');
  const broken = await variant(testInfo.outputPath('broken/handoff'), 'broken');
  await page.getByLabel('选择一个 handoff 目录').setInputFiles(broken);
  await expect(page.locator('.runner-preview [role="alert"]')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { releaseArtifactRead: () => void }).releaseArtifactRead();
  });
  await expect(page.getByRole('region', { name: '交接包状态' })).toHaveCount(0);
  await expect(page.locator('.runner-preview [role="alert"]')).toBeVisible();
  await page.getByRole('button', { name: '清除本地阅读' }).click();
  await expect(page.locator('.runner-preview [role="alert"]')).toHaveCount(0);
});

test('Runner wide tables scroll within the keyboard-accessible reading region', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/runner-output');
  await choose(page, await variant(testInfo.outputPath('wide/handoff'), 'wide'));
  const table = page.getByRole('region', { name: '正文表格' });
  expect(await table.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  await noOverflow(page);
});
