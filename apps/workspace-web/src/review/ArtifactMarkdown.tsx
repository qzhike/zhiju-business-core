import { useId, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { Button } from '../components/ui/button.js';
import './artifact-markdown.css';

// Parse to an inert tree, then rebuild only reading elements. Never insert source HTML.
const readingSchema: NonNullable<Parameters<typeof rehypeSanitize>[0]> = {
  tagNames: [
    'a',
    'blockquote',
    'br',
    'caption',
    'code',
    'del',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'img',
    'input',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'ul',
  ],
  attributes: {
    a: ['href', 'title'],
    img: ['alt'],
    input: [['type', 'checkbox'], 'checked', 'disabled'],
    ol: ['start'],
    li: ['value'],
    td: ['colSpan', 'rowSpan'],
    th: ['colSpan', 'rowSpan', ['scope', 'row', 'col', 'rowgroup', 'colgroup']],
  },
  required: { input: { type: 'checkbox', disabled: true } },
  protocols: { href: ['http', 'https'] },
  strip: ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template'],
  clobber: ['id', 'name'],
};

function readingUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? url
      : '';
  } catch {
    return '';
  }
}

// These anchors are generated after sanitization and identify only reading positions.
function readingAnchors({ prefix }: { prefix: string }) {
  return (tree: unknown) => {
    let index = 0;
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const node = value as {
        tagName?: string;
        properties?: Record<string, unknown>;
        children?: unknown[];
      };
      if (node.tagName && /^(p|h[1-6]|tr|pre)$/.test(node.tagName)) {
        node.properties = { ...node.properties, dataReadingAnchor: `${prefix}:reading-${index++}` };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function ReadingCell({
  tag: Tag,
  rowSpan,
  colSpan,
  children,
  scope,
}: ComponentPropsWithoutRef<'th'> & { tag: 'th' | 'td' }) {
  const validRow =
    rowSpan === undefined || (Number.isInteger(rowSpan) && rowSpan >= 0 && rowSpan <= 1000);
  const validColumn =
    colSpan === undefined || (Number.isInteger(colSpan) && colSpan >= 1 && colSpan <= 100);
  return (
    <Tag
      rowSpan={validRow ? rowSpan : undefined}
      colSpan={validColumn ? colSpan : undefined}
      scope={scope}
    >
      {children}
      {(!validRow || !validColumn) && (
        <span className="artifact-resource-note">
          （合并属性超出阅读范围，请核对原始 Markdown）
        </span>
      )}
    </Tag>
  );
}

// Convert only Markdown text-node soft breaks; leave code and raw HTML structure intact.
function summaryLineBreaks() {
  interface Node {
    type?: string;
    value?: string;
    children?: Node[];
  }
  return (tree: unknown) => {
    const visit = (node: Node) => {
      if (!node.children) return;
      node.children = node.children.flatMap((child) =>
        child.type === 'text' && child.value?.includes('\n')
          ? child.value
              .split(/\r\n|\r|\n/u)
              .flatMap((value, index): Node[] =>
                index ? [{ type: 'break' }, { type: 'text', value }] : [{ type: 'text', value }],
              )
          : [child],
      );
      node.children.forEach(visit);
    };
    visit(tree as Node);
  };
}

// Shorten the sanitized reading tree, keeping markup balanced and the source intact.
function readingExcerpt({ length }: { length: number }) {
  interface Node {
    type?: string;
    value?: string;
    tagName?: string;
    properties?: Record<string, unknown>;
    children?: Node[];
  }
  return (tree: unknown) => {
    const excerpt: { remaining: number; truncated: boolean; lastText?: Node } = {
      remaining: length,
      truncated: false,
    };
    const visit = (node: Node): boolean => {
      if (node.type === 'text' && node.value) {
        const characters = Array.from(node.value);
        if (characters.length > excerpt.remaining) excerpt.truncated = true;
        node.value = characters.slice(0, excerpt.remaining).join('');
        excerpt.remaining = Math.max(0, excerpt.remaining - characters.length);
        if (node.value) excerpt.lastText = node;
        return Boolean(node.value);
      }
      const visible = excerpt.remaining > 0;
      if (!visible && node.type === 'element') excerpt.truncated = true;
      if (node.children) node.children = node.children.filter(visit);
      return visible;
    };
    const root = tree as Node;
    visit(root);
    if (excerpt.truncated && excerpt.lastText) {
      excerpt.lastText.value = `${excerpt.lastText.value ?? ''}…`;
      root.children?.push({
        type: 'element',
        tagName: 'span',
        properties: { dataExcerptTruncated: true },
        children: [],
      });
    }
  };
}

export function ArtifactMarkdown({
  text,
  controls = true,
  preserveLineBreaks = false,
  collapseAfter,
}: {
  text: string;
  controls?: boolean;
  preserveLineBreaks?: boolean;
  collapseAfter?: number;
}) {
  const readingId = useId();
  const [source, setSource] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const reading = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!expanded) setHasMore(Boolean(reading.current?.querySelector('[data-excerpt-truncated]')));
  }, [text, collapseAfter, expanded, source]);
  return (
    <div className="artifact-markdown">
      {controls && (
        <div role="group" aria-label="正文显示方式" className="artifact-reading-tools">
          <Button
            aria-pressed={!source}
            onClick={() => {
              setSource(false);
            }}
          >
            阅读预览
          </Button>
          <Button
            aria-pressed={source}
            onClick={() => {
              setSource(true);
            }}
          >
            原始 Markdown
          </Button>
        </div>
      )}
      {source ? (
        <pre className="artifact-source" tabIndex={0} aria-label="原始 Markdown 正文">
          {text}
        </pre>
      ) : (
        <div
          ref={reading}
          id={readingId}
          className={`artifact-prose markdown${preserveLineBreaks ? ' artifact-summary' : ''}`}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm, ...(preserveLineBreaks ? [summaryLineBreaks] : [])]}
            rehypePlugins={[
              rehypeRaw,
              [rehypeSanitize, readingSchema],
              ...(collapseAfter !== undefined && !expanded
                ? [
                    [readingExcerpt, { length: collapseAfter }] as [
                      typeof readingExcerpt,
                      { length: number },
                    ],
                  ]
                : []),
              [readingAnchors, { prefix: readingId }],
            ]}
            urlTransform={readingUrl}
            components={{
              td: (props) => <ReadingCell {...props} tag="td" />,
              th: (props) => <ReadingCell {...props} tag="th" />,
              pre: ({ children, node }) => (
                <pre tabIndex={0} data-reading-anchor={node?.properties.dataReadingAnchor}>
                  {children}
                </pre>
              ),
              table: ({ children }) => (
                <div className="artifact-table" role="region" aria-label="正文表格" tabIndex={0}>
                  <table>{children}</table>
                </div>
              ),
              img: ({ alt }) => (
                <span className="artifact-resource-note">
                  （图片未加载{alt ? `：${alt}` : ''}，请核对原件）
                </span>
              ),
              a: ({ href, children }) =>
                href ? (
                  <a href={href} rel="noreferrer noopener">
                    {children}
                  </a>
                ) : (
                  <span>{children}</span>
                ),
            }}
          >
            {text}
          </ReactMarkdown>
        </div>
      )}
      {hasMore && !source && (
        <Button
          variant="link"
          className="px-0"
          aria-expanded={expanded}
          aria-controls={readingId}
          onClick={(event) => {
            setExpanded(!expanded);
            const button = event.currentTarget;
            if (expanded)
              requestAnimationFrame(() => {
                button.scrollIntoView({ block: 'nearest' });
              });
          }}
        >
          {expanded ? '收起' : '展开全部建议'}
        </Button>
      )}
      {controls && (
        <p className="muted artifact-reading-note">
          图片及嵌入对象需结合原件核对；原始 Markdown 保留文件正文。
        </p>
      )}
    </div>
  );
}
