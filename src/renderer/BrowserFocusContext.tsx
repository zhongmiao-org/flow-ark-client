import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import type { FocusedTarget } from '../shared/browser-observation';
import type { ElementTarget } from '../shared/element-picker';

type Entry = FocusedTarget & {
  apply: (target: ElementTarget) => boolean | Promise<boolean>;
  origin: HTMLElement | null;
};
const BrowserFocusContext = createContext<{
  entry?: Entry;
  open: (target: FocusedTarget, apply: Entry['apply']) => void;
  close: (requestId: string) => void;
} | null>(null);

export function BrowserFocusProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<Entry>();
  const current = useRef<Entry | undefined>(undefined);
  const open = useCallback((target: FocusedTarget, apply: Entry['apply']) => {
    const next = {
      ...target,
      apply,
      origin: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    current.current = next;
    setEntry(next);
    window.dispatchEvent(new Event('flowark:open-browser'));
  }, []);
  const close = useCallback((requestId: string) => {
    const previous = current.current;
    if (previous?.requestId !== requestId) return;
    current.current = undefined;
    setEntry(undefined);
    requestAnimationFrame(() => {
      if (previous.origin?.isConnected) previous.origin.focus({ preventScroll: true });
    });
  }, []);
  return (
    <BrowserFocusContext.Provider value={{ entry, open, close }}>
      {children}
    </BrowserFocusContext.Provider>
  );
}
export const useBrowserFocus = () => useContext(BrowserFocusContext);
