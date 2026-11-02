import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button } from '../components/ui/button.js';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog.js';
import './opinion-panel.css';

interface ReadingAnchor {
  selector: string;
  top: number;
}

/** Preserve a body line, rather than a pixel offset, when columns reflow. */
export function useOpinionLayout(
  root: RefObject<HTMLElement | null>,
  enabled: boolean,
  open: boolean,
) {
  const [width, setWidth] = useState(1400);
  const anchor = useRef<ReadingAnchor | null>(null);
  const rememberReading = () => {
    const node = root.current;
    if (!node) return;
    const toolbar = node.querySelector('.markdown-change-toolbar')?.getBoundingClientRect();
    const top = Math.max(0, toolbar?.bottom ?? 0);
    const rows = node.querySelectorAll<HTMLElement>('.document-diff-row, [data-unit-id]');
    const row = [...rows].find((item) => {
      const box = item.getBoundingClientRect();
      return box.bottom > top && box.top < window.innerHeight;
    });
    const attribute = row?.hasAttribute('data-after-line')
      ? 'data-after-line'
      : row?.hasAttribute('data-before-line')
        ? 'data-before-line'
        : 'data-unit-id';
    const value = row?.getAttribute(attribute);
    anchor.current =
      row && value
        ? {
            selector: `[${attribute}="${CSS.escape(value)}"]`,
            top: row.getBoundingClientRect().top,
          }
        : null;
  };
  useLayoutEffect(() => {
    if (!enabled || !root.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(root.current);
    let frame = 0;
    const scroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(rememberReading);
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
    };
  }, [enabled, root]);
  useLayoutEffect(() => {
    if (!enabled) return;
    const saved = anchor.current;
    if (!saved) return;
    const target = root.current?.querySelector(saved.selector);
    if (target) window.scrollBy(0, target.getBoundingClientRect().top - saved.top);
  }, [width, open, enabled, root]);
  return { width, rememberReading };
}

export function OpinionPanel({
  enabled,
  open,
  drawer,
  onClose,
  context,
  excerpt,
  children,
}: {
  enabled: boolean;
  open: boolean;
  drawer: boolean;
  onClose: () => void;
  context: string;
  excerpt: ReactNode;
  children: ReactNode;
}) {
  const rail = useRef<HTMLElement>(null);
  const [fits, setFits] = useState(false);
  useLayoutEffect(() => {
    if (!enabled || !open || drawer || !rail.current) return;
    const update = () => {
      setFits((rail.current?.offsetHeight ?? Infinity) + 24 <= window.innerHeight);
    };
    const observer = new ResizeObserver(update);
    observer.observe(rail.current);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [enabled, open, drawer]);
  useLayoutEffect(() => {
    if (enabled && open && !drawer)
      rail.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  }, [enabled, open, drawer]);
  const content = (
    <aside
      className={`markdown-opinion${enabled ? ' review-opinion-panel' : ''}${fits && !drawer ? ' is-sticky' : ''}`}
      aria-label="本文件意见与处理"
      ref={rail}
    >
      {enabled && (
        <Button className="review-opinion-close" onClick={onClose}>
          收起本文件意见
        </Button>
      )}
      {enabled && drawer && (
        <details className="review-opinion-excerpt" open>
          <summary>正在对照的修改</summary>
          {excerpt}
        </details>
      )}
      {children}
    </aside>
  );
  if (!enabled || !drawer) return content;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        className="review-opinion-drawer translate-x-0 translate-y-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          rail.current
            ?.querySelector<HTMLTextAreaElement>('textarea')
            ?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">本文件意见</DialogTitle>
        <DialogDescription className="sr-only">{context}</DialogDescription>
        {content}
      </DialogContent>
    </Dialog>
  );
}
