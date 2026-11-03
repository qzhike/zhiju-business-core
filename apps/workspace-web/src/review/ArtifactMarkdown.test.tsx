import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactMarkdown } from './ArtifactMarkdown.js';
import { RawMarkdownDiff } from './RawMarkdownDiff.js';
import { physicalLines } from './physical-lines.js';

describe('read-only artifact rendering', () => {
  it('previews balanced sanitized markup without splitting Unicode or retaining hidden links', () => {
    const text = '**开头😀完整内容**\n\n[后续建议](https://example.com/next)';
    const excerpt = renderToStaticMarkup(
      <ArtifactMarkdown text={text} controls={false} collapseAfter={3} />,
    );
    expect(excerpt).toContain('<strong>开头😀…</strong>');
    expect(excerpt).toContain('data-excerpt-truncated');
    expect(excerpt).not.toContain('完整内容');
    expect(excerpt).not.toContain('https://example.com/next');
    const full = renderToStaticMarkup(<ArtifactMarkdown text={text} controls={false} />);
    expect(full).toContain('<strong>开头😀完整内容</strong>');
    expect(full).toContain('https://example.com/next');
    const short = renderToStaticMarkup(
      <ArtifactMarkdown text="**简短内容**" controls={false} collapseAfter={180} />,
    );
    expect(short).not.toContain('data-excerpt-truncated');
  });
  it('clips HTML only after sanitizing and parsing it into balanced reading elements', () => {
    const html = renderToStaticMarkup(
      <ArtifactMarkdown
        text={
          '<p onclick="alert(1)">开头<strong>重点建议</strong></p><p><a href="https://example.com/next">后续</a></p>'
        }
        controls={false}
        collapseAfter={4}
      />,
    );
    expect(html).toContain('<strong>重点…</strong></p>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('https://example.com/next');
  });
  it('keeps an expansion marker when only non-text content follows the preview boundary', () => {
    const text = '<p>开头😀<img alt="后续附件说明"></p><hr>';
    const excerpt = renderToStaticMarkup(
      <ArtifactMarkdown text={text} controls={false} collapseAfter={3} />,
    );
    expect(excerpt).toContain('开头😀…');
    expect(excerpt).toContain('data-excerpt-truncated');
    expect(excerpt).not.toContain('后续附件说明');
    const full = renderToStaticMarkup(<ArtifactMarkdown text={text} controls={false} />);
    expect(full).toContain('后续附件说明');
    expect(full).toContain('<hr/>');
  });
  it('preserves summary soft breaks and Markdown formatting without changing document defaults', () => {
    const text = '第一行 **重点**\n第二行 `字段`\n\n下一段\n\n- 条目一\n  续行\n- 条目二';
    const summary = renderToStaticMarkup(
      <ArtifactMarkdown text={text} controls={false} preserveLineBreaks />,
    );
    const document = renderToStaticMarkup(<ArtifactMarkdown text={text} controls={false} />);
    expect(summary.match(/<br\/>/gu)).toHaveLength(2);
    expect(summary).toContain('<strong>重点</strong>');
    expect(summary).toContain('<code>字段</code>');
    expect(summary).toContain('<ul>');
    expect(summary).toContain('artifact-summary');
    expect(document).not.toContain('<br/>');
    expect(document).not.toContain('artifact-summary');
  });
  it('keeps code and raw HTML line structure and does not double existing hard breaks', () => {
    const html = renderToStaticMarkup(
      <ArtifactMarkdown
        preserveLineBreaks
        controls={false}
        text={
          '一\r\n二  \n三\n\n```text\ncode one\ncode two\n```\n\n<table>\n<tr><td>cell</td></tr>\n</table>'
        }
      />,
    );
    expect(html.match(/<br\/>/gu)).toHaveLength(2);
    expect(html).toContain('code one\ncode two\n');
    expect(html).toContain('<table>');
    expect(html).toContain('cell</td>');
  });
  it('bounds extreme table spans with a visible source fallback', () => {
    const html = renderToStaticMarkup(
      <ArtifactMarkdown
        text={'<table><tr><td colspan="100000" rowspan="-1">Retained</td></tr></table>'}
      />,
    );
    expect(html).toContain('Retained');
    expect(html).toContain('合并属性超出阅读范围');
    expect(html).not.toContain('colSpan=');
    expect(html).not.toContain('rowSpan=');
  });
  it('keeps HTML table cells, spans and entities alongside Markdown and indented code', () => {
    const html = renderToStaticMarkup(
      <ArtifactMarkdown
        text={
          '# Complete source\n\n<table><caption>Roles</caption><tr><th rowspan="2">Owner &amp; deputy</th><th colspan="2">Review</th></tr><tr><td>A &lt; B</td><td>Record</td></tr></table>\n\n    original code\n\nLast paragraph.'
        }
      />,
    );
    expect(html).toContain('<table>');
    expect(html).toContain('rowSpan="2"');
    expect(html).toContain('colSpan="2"');
    expect(html).toContain('Owner &amp; deputy');
    expect(html).toContain('A &lt; B');
    expect(html).toContain('original code');
    expect(html).toContain('Last paragraph.');
    expect(html).toContain('aria-label="正文表格" tabindex="0"');
  });
  it('removes active HTML, resource URLs, styling and clobbering names', () => {
    const html = renderToStaticMarkup(
      <ArtifactMarkdown
        text={[
          '<script src="https://private.invalid/script">alert(1)</script>',
          '<style>@import "https://private.invalid/style";</style>',
          '<iframe src="https://private.invalid/frame"></iframe><object data="https://private.invalid/object"></object>',
          '<svg><image href="https://private.invalid/svg"/></svg>',
          '<table id="location" name="document" style="background:url(https://private.invalid/bg)" onclick="alert(2)"><tr><td onmouseover="alert(3)">Keep this cell</td></tr></table>',
          '<img src="https://private.invalid/pixel" srcset="https://private.invalid/pixel2" onerror="alert(4)" alt="original diagram">',
          '[bad](javascript:alert%281%29) [credentials](https://user:secret@private.invalid/) [safe](https://example.com/reference)',
          '<a href="jav&#x61;script:alert(5)">encoded link</a><input type="image" src="https://private.invalid/input">',
        ].join('\n\n')}
      />,
    );
    for (const forbidden of [
      '<script',
      '<style',
      '<iframe',
      '<object',
      '<svg',
      '<img',
      'private.invalid',
      'onclick',
      'onmouseover',
      'onerror',
      'id="location"',
      'name="document"',
      'javascript:',
      'secret',
    ])
      expect(html).not.toContain(forbidden);
    expect(html).toContain('Keep this cell');
    expect(html).toContain('original diagram');
    expect(html).toContain('https://example.com/reference');
  });
});

describe('physical Markdown coordinates', () => {
  it.each(['', 'a', 'a\n', 'a\n\n', '\n', '\uFEFFa\r\nb\r\n', 'a\rb\u2028c', '  a\t\n'])(
    'round-trips exact text %j',
    (value) => {
      const lines = physicalLines(value);
      expect(lines.map((line) => line.raw).join('')).toBe(value);
      expect(lines.map((line) => line.number)).toEqual(lines.map((_, index) => index + 1));
    },
  );
  it('does not invent a terminal empty line or split non-LF separators', () => {
    expect(physicalLines('')).toHaveLength(0);
    expect(physicalLines('a\n')).toHaveLength(1);
    expect(physicalLines('a\r\nb\r\n').map((line) => line.ending)).toEqual(['CRLF', 'CRLF']);
    expect(physicalLines('a\rb\u2028c')).toHaveLength(1);
    expect(physicalLines('\uFEFFa')[0]?.text).toBe('\uFEFFa');
  });
  it.each([
    ['a', 'a\n'],
    ['a\n', 'a\r\n'],
    ['a\n', 'a\n\n'],
  ])('shows real newline changes %j to %j', (before, after) => {
    const html = renderToStaticMarkup(<RawMarkdownDiff before={before} after={after} />);
    expect(html).toContain('data-kind="added"');
    expect(html).toContain('data-before-line="1"');
    expect(html).toContain('data-after-line="1"');
  });
});
