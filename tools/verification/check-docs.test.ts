import { describe, expect, it } from 'vitest';

import { validateMarkdown } from './check-docs.mts';

describe('documentation integrity checks', () => {
  it('accepts balanced Markdown fences', () => {
    expect(validateMarkdown('example.md', '# Example\n\n```ts\nconst value = 1;\n```\n')).toEqual(
      [],
    );
  });

  it('reports unresolved conflict markers', () => {
    expect(validateMarkdown('example.md', '# Example\n<<<<<<< HEAD\n')).toEqual([
      'example.md:2: unresolved conflict marker',
    ]);
  });

  it('does not confuse a Setext heading with a conflict marker', () => {
    expect(validateMarkdown('example.md', 'Example\n=======\n')).toEqual([]);
  });

  it('reports an unclosed Markdown fence', () => {
    expect(validateMarkdown('example.md', '# Example\n\n```ts\n')).toEqual([
      'example.md:3: unclosed Markdown fence',
    ]);
  });
});
