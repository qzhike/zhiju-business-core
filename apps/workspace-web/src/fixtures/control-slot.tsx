import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const MockControlsTarget = createContext<HTMLElement | null>(null);

/** Keep controls in their owning React context while presenting them outside the page. */
export const MockControls =
  typeof __DEV_FIXTURE__ !== 'undefined' && __DEV_FIXTURE__ ? FixtureControls : () => null;

function FixtureControls({ children }: { children: ReactNode }) {
  const target = useContext(MockControlsTarget);
  return target ? createPortal(<div className="mock-control-group">{children}</div>, target) : null;
}
