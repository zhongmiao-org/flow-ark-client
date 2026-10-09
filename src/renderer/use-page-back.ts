import { useEffect } from 'react';

/** Use the page's existing return action, including its unsaved-change guard. */
export function usePageBack(back: (() => void) | undefined, active = true) {
  useEffect(() => {
    if (!active || !back) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.shiftKey) return;
      const shortcut =
        (event.altKey && !event.metaKey && event.key === 'ArrowLeft') ||
        (event.metaKey && !event.altKey && event.key === '[');
      if (!shortcut) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],.monaco-editor',
        )
      )
        return;
      event.preventDefault();
      // A modal owns navigation until it closes. Never leave its underlying page.
      if (
        event.repeat ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
      )
        return;
      back();
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, back]);
}
