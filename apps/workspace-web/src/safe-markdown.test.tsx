import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from './App.js';

describe('Workspace content boundary', () => {
  it('suppresses raw HTML, active links and external images while preserving readable text', () => {
    const html = renderToStaticMarkup(
      <SafeMarkdown>
        {[
          '<script>alert("secret")</script>',
          '<img src="https://customer.invalid/image" onerror="alert(1)">',
          '[active](javascript:alert%281%29)',
          '[data](data:text/html,secret)',
          '[credential](https://user:password@customer.invalid)',
          '![external](https://customer.invalid/tracking.png)',
          '[safe](https://example.com/reference)',
          '## 可安全阅读的内容',
        ].join('\n\n')}
      </SafeMarkdown>,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).not.toContain('password');
    expect(html).not.toContain('tracking.png');
    expect(html).toContain('https://example.com/reference');
    expect(html).toContain('可安全阅读的内容');
  });
});
