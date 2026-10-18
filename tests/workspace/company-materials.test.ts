import { describe, expect, it } from 'vitest';
import { locateTemplate } from '../../tools/workspace-environment/company-materials.mjs';

function selected(source: string, locator: string) {
  const bytes = Buffer.from(source);
  const span = locateTemplate(bytes, locator);
  return bytes.subarray(span.offset, span.offset + span.byteLength).toString('utf8');
}

describe('company template byte locators', () => {
  it('preserves UTF-8 byte boundaries and includes child sections without the next sibling', () => {
    const source = '# 文件控制\n## 1 总则\n中文要求\n### 1.1 范围\n子要求\n## 2 职责\n其它内容\n';
    expect(selected(source, '1')).toBe('## 1 总则\n中文要求\n### 1.1 范围\n子要求\n');
    expect(selected(source, '1.1')).toBe('### 1.1 范围\n子要求\n');
  });
  it('binds the stated table ordinal and rejects duplicate or absent rows', () => {
    const source =
      '## 1.3 依据\n| 序号 | 要求 |\n| --- | --- |\n| 1 | 第一项 |\n| 6 | 指定要求 |\n## 2 职责\n正文\n';
    expect(selected(source, '1.3#6')).toBe('| 6 | 指定要求 |\n');
    expect(() => selected(source, '1.3#4')).toThrow('ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS');
    expect(() => selected(source.replace('## 2', '| 6 | 重复要求 |\n## 2'), '1.3#6')).toThrow(
      'ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS',
    );
  });
  it('fails closed on missing or ambiguous headings and reversed ranges', () => {
    const source = '## 1 范围\n原文\n## 2 职责\n正文\n';
    expect(() => selected(source, '3')).toThrow('ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS');
    expect(() => selected(source + '## 1 范围\n另一个章节\n', '1')).toThrow(
      'ENV_B_TEMPLATE_LOCATOR_AMBIGUOUS',
    );
    expect(() => selected(source, '2-1')).toThrow('ENV_B_TEMPLATE_LOCATOR_INVALID');
  });
  it('binds a composite locator to its containing span without dropping intermediate bytes', () => {
    const source = '## 1 范围\n一\n## 2 职责\n二\n## 3 定义\n三\n## 4 流程\n四\n';
    expect(selected(source, '1/3')).toBe('## 1 范围\n一\n## 2 职责\n二\n## 3 定义\n三\n');
  });
});
