import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { MockControlsTarget } from './control-slot.js';
import './mock-panel.css';

export function FixtureMockPanel({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLDivElement | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const open = openFor === location.key;
  useEffect(() => {
    // Navigation closes immediately; a later effect must not undo a new explicit open.
    setOpenFor((current) => (current === location.key ? current : null));
  }, [location.key]);
  const close = () => {
    setOpenFor(null);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  return (
    <MockControlsTarget value={target}>
      {children}
      {createPortal(
        <aside
          className="mock-panel"
          data-page={location.pathname}
          aria-label="Mock 演练工具"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.stopPropagation();
              close();
            }
          }}
        >
          <section
            id="mock-controls-panel"
            className="mock-panel-surface"
            hidden={!open}
            aria-label="Mock 控制面板"
          >
            <div className="mock-panel-heading">
              <div>
                <h2>Mock 控制</h2>
                <p>仅用于演练 · 当前页面</p>
              </div>
              <button
                ref={closeButton}
                type="button"
                onClick={close}
                aria-label="收起 Mock 控制面板"
              >
                收起
              </button>
            </div>
            <p className="mock-panel-note">
              场景与回执只影响模拟会话。收起面板可审核主页面；刷新重置。
            </p>
            <div className="mock-panel-body" ref={setTarget} />
          </section>
          <button
            ref={trigger}
            className="mock-panel-trigger"
            type="button"
            aria-expanded={open}
            aria-controls="mock-controls-panel"
            onClick={() => {
              if (open) close();
              else setOpenFor(location.key);
            }}
          >
            <span aria-hidden="true">{open ? '−' : '+'}</span> Mock 控制
          </button>
        </aside>,
        document.body,
      )}
    </MockControlsTarget>
  );
}
