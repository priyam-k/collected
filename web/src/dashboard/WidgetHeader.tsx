import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The header bar's right-hand slot of the frame a widget renders in. */
export const WidgetHeaderSlot = createContext<HTMLElement | null>(null);

/** Renders its children in the widget's header bar (counts, view switchers, actions) instead of the body. */
export function WidgetHeader({ children }: { children: ReactNode }) {
  const el = useContext(WidgetHeaderSlot);
  return el ? createPortal(children, el) : null;
}
